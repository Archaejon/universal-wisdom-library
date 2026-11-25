/**
 * The generated-text engine: one way in for every task that asks a model to
 * write (the assistant's synthesis, on-request translation), whichever model
 * does the writing.
 *
 * Adapted from Sefaria Lens's llm.js (MIT). What it adds over calling Ollama
 * directly:
 *
 * - A gate: the local model writes one answer at a time. A second request
 *   waits its turn (and is told it is waiting); beyond a short queue it is
 *   refused with a plain message rather than piling up behind a minute-long
 *   answer. A cancelled request leaves the queue.
 * - Task profiles: each kind of request has its own output ceiling and
 *   temperature, smaller for a local model, so a translation batch cannot
 *   run on for minutes.
 * - One context size per session: every local request uses the configured
 *   num_ctx, so Ollama never reloads the model because a task asked for a
 *   different window.
 * - Prompt fitting: a prompt is checked against the context window before it
 *   is sent, and the caller is told how much room there is.
 * - JSON output: a JSON schema is passed to Ollama as a grammar, and to an
 *   OpenAI-compatible service as JSON mode; the reply is parsed tolerantly.
 * - Identical JSON requests in flight are shared, not run twice.
 * - What is loaded, and freeing its memory, on request.
 * - A cloud provider (any OpenAI-compatible service), only when chosen.
 */
import { createHash } from "node:crypto";
import { aiSettings, CLOUD_PRESETS, publicSettings } from "./ai-settings";
import { generate, isModelInstalled, listModels, ollamaConfig, releaseModel, type OllamaConfig, type OllamaEvent } from "./ollama";

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export class BusyError extends Error {
  code = "ai_busy";
}
export class CancelledError extends Error {
  code = "cancelled";
}

export class Gate {
  active = 0;
  private waiting: { resolve: () => void; reject: (e: Error) => void; signal?: AbortSignal; onAbort?: () => void }[] = [];
  constructor(
    public limit = 1,
    public maxQueue = 2,
  ) {}

  get queued() {
    return this.waiting.length;
  }

  /**
   * Resolves with a release function once a slot is free. `onQueued` is called
   * when the request has to wait, with its place in the queue.
   */
  acquire(signal?: AbortSignal, onQueued?: (position: number) => void): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new CancelledError("Cancelled."));
    const release = () => {
      let done = false;
      return () => {
        if (done) return;
        done = true;
        this.active = Math.max(0, this.active - 1);
        this.drain();
      };
    };
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve(release());
    }
    if (this.waiting.length >= this.maxQueue) {
      return Promise.reject(
        new BusyError("The model is already writing another answer and others are waiting. Wait for them to finish, or stop one first."),
      );
    }
    return new Promise((resolve, reject) => {
      const entry: (typeof this.waiting)[number] = {
        resolve: () => resolve(release()),
        reject,
        signal,
      };
      if (signal) {
        entry.onAbort = () => {
          const at = this.waiting.indexOf(entry);
          if (at >= 0) this.waiting.splice(at, 1);
          reject(new CancelledError("Cancelled."));
        };
        signal.addEventListener("abort", entry.onAbort, { once: true });
      }
      this.waiting.push(entry);
      onQueued?.(this.waiting.length);
    });
  }

  private drain() {
    while (this.active < this.limit && this.waiting.length) {
      const entry = this.waiting.shift()!;
      if (entry.signal && entry.onAbort) entry.signal.removeEventListener("abort", entry.onAbort);
      if (entry.signal?.aborted) {
        entry.reject(new CancelledError("Cancelled."));
        continue;
      }
      this.active++;
      entry.resolve();
    }
  }
}

const gates = new Map<string, Gate>();

/** The gate for an engine: one per local daemon, a wider one per cloud service. */
export function gateFor(engine: Engine): Gate {
  const key = engine.kind === "local" ? `local:${engine.config.baseUrl}` : `cloud:${engine.baseUrl}`;
  const limit = engine.kind === "local" ? engine.config.concurrency : 2;
  const queue = engine.kind === "local" ? engine.config.queue : 4;
  let gate = gates.get(key);
  if (!gate || gate.limit !== limit || gate.maxQueue !== queue) {
    gate = new Gate(limit, queue);
    gates.set(key, gate);
  }
  return gate;
}

/** Tests start from an empty gate. */
export function resetGates() {
  gates.clear();
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type Task = "synthesis" | "translate";

/**
 * Output ceilings. A local 8B model writes roughly eight tokens a second on a
 * laptop, so the ceiling is the difference between a twenty-second answer and
 * a two-minute one; a cloud model gets more room.
 */
export const TASKS: Record<Task, { local: number; cloud: number; temperature: number }> = {
  synthesis: { local: 0, cloud: 600, temperature: 0.2 }, // local: the configured numPredict
  translate: { local: 900, cloud: 2000, temperature: 0.1 },
};

export function outputCeiling(engine: Engine, task: Task): number {
  if (engine.kind === "cloud") return TASKS[task].cloud;
  return TASKS[task].local || engine.config.numPredict;
}

/** A rough token count: about 3.2 characters a token across these scripts. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.2);
}

/**
 * Room for the prompt: the context window, less the answer's ceiling and a
 * margin for the chat template. Cloud context windows are large; this is the
 * budget a request is kept under so it stays quick.
 */
export function promptBudget(engine: Engine, task: Task): number {
  const ctx = engine.kind === "local" ? engine.config.numCtx : 16_000;
  return Math.max(256, ctx - outputCeiling(engine, task) - 200);
}

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------

export type Engine =
  | { kind: "local"; config: OllamaConfig; model: string; label: string }
  | { kind: "cloud"; label: string; baseUrl: string; model: string; apiKey: string; timeoutMs: number };

export type EngineProblem = { status: number; code: string; message: string };

/**
 * The engine to use now, checked: the daemon answers and the model is there,
 * or the cloud service has an address, model and key. `requestedModel` picks
 * among local models; a cloud model is set in the settings.
 */
export async function resolveEngine(requestedModel?: string | null): Promise<Engine | EngineProblem> {
  const settings = aiSettings();
  if (settings.provider === "cloud") {
    if (!settings.baseUrl || !settings.model || !settings.apiKey) {
      return {
        status: 409,
        code: "ai_not_configured",
        message: "A cloud AI service is selected but has no address, model or key. Finish it in the AI settings, or switch back to the local model.",
      };
    }
    return {
      kind: "cloud",
      label: settings.preset !== "custom" && CLOUD_PRESETS[settings.preset] ? CLOUD_PRESETS[settings.preset].label : new URL(settings.baseUrl).host,
      baseUrl: settings.baseUrl,
      model: settings.model,
      apiKey: settings.apiKey,
      timeoutMs: 90_000,
    };
  }
  const config = ollamaConfig();
  if (!config.enabled) {
    return { status: 409, code: "ai_disabled", message: "Local AI is switched off on this server." };
  }
  const listing = await listModels(config);
  if (!listing.ok) return { status: 503, code: "ai_unavailable", message: listing.error };
  let model = requestedModel || config.model;
  // Nobody chose a model and the default is not installed: use one that is,
  // rather than refusing a reader who has exactly one model.
  if (!requestedModel && !isModelInstalled(listing.models, model) && listing.models.length) model = listing.models[0].name;
  if (!isModelInstalled(listing.models, model)) {
    const installed = listing.models.map((m) => m.name).slice(0, 4).join(", ");
    return {
      status: 409,
      code: "model_missing",
      message: `The model ${model} is not installed. Run \`ollama pull ${model}\`${installed ? `, or choose one of: ${installed}` : ""}.`,
    };
  }
  return { kind: "local", config, model, label: "Ollama on this computer" };
}

export function isProblem(x: Engine | EngineProblem): x is EngineProblem {
  return "code" in x && !("kind" in x);
}

/** The sentence shown with anything the engine wrote. */
export function engineDisclosure(engine: Engine): string {
  return engine.kind === "local"
    ? `Written on this machine by ${engine.model} through Ollama. Nothing was sent to an external AI provider.`
    : `Written by ${engine.model} at ${engine.label}. The passages it used were sent to ${engine.label} to write it.`;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export type StreamRequest = {
  task: Task;
  system: string;
  prompt: string;
  signal?: AbortSignal;
  /** A JSON schema: the answer must be one JSON value of this shape. */
  schema?: Record<string, unknown>;
};

/** Stream an answer. Ends with a `final` or an `error` event, like generate(). */
export async function* streamText(engine: Engine, req: StreamRequest): AsyncGenerator<OllamaEvent> {
  if (engine.kind === "local") {
    yield* generate(engine.config, {
      model: engine.model,
      system: req.system,
      prompt: req.prompt,
      signal: req.signal,
      format: req.schema,
      options: {
        numCtx: engine.config.numCtx,
        numPredict: outputCeiling(engine, req.task),
        temperature: TASKS[req.task].temperature,
      },
    });
    return;
  }
  yield* cloudStream(engine, req);
}

function cloudMessage(status: number, detail: string, engine: Extract<Engine, { kind: "cloud" }>): EngineProblem {
  if (status === 401 || status === 403) return { status, code: "bad_key", message: `${engine.label} refused the API key: ${detail}` };
  if (status === 429) return { status, code: "rate_limited", message: `${engine.label} is limiting requests just now. Wait a moment and try again.` };
  if (status === 404) return { status, code: "model_missing", message: `${engine.label} has no model called ${engine.model}: ${detail}` };
  return { status, code: "provider_error", message: `${engine.label} returned an error (${status}): ${detail}` };
}

async function* cloudStream(engine: Extract<Engine, { kind: "cloud" }>, req: StreamRequest): AsyncGenerator<OllamaEvent> {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  req.signal?.addEventListener("abort", onAbort);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, engine.timeoutMs);
  const body: Record<string, unknown> = {
    model: engine.model,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.prompt },
    ],
    temperature: TASKS[req.task].temperature,
    max_tokens: outputCeiling(engine, req.task),
    stream: true,
  };
  if (req.schema) body.response_format = { type: "json_object" };
  try {
    let res: Response;
    try {
      res = await fetch(`${engine.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          authorization: `Bearer ${engine.apiKey}`,
          "x-title": "Universal Wisdom Library",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      if (req.signal?.aborted) return;
      yield timedOut
        ? { type: "error", code: "timeout", message: `${engine.label} did not answer in time. Try again, or a shorter request.` }
        : { type: "error", code: "unavailable", message: `${engine.label} could not be reached at ${engine.baseUrl}.` };
      return;
    }
    if (!res.ok || !res.body) {
      let detail = "";
      try {
        const raw = await res.text();
        try {
          const j = JSON.parse(raw);
          detail = String(j?.error?.message ?? j?.error ?? raw).slice(0, 240);
        } catch {
          detail = raw.slice(0, 240);
        }
      } catch {}
      const problem = cloudMessage(res.status, detail || res.statusText, engine);
      yield { type: "error", code: problem.code, message: problem.message };
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let emitted = false;
    let tokens = 0;
    for (;;) {
      let chunk: { done: boolean; value?: Uint8Array };
      try {
        chunk = await reader.read();
      } catch {
        if (req.signal?.aborted) return;
        yield { type: "error", code: timedOut ? "timeout" : "interrupted", message: `The connection to ${engine.label} was interrupted.` };
        return;
      }
      if (chunk.done) break;
      if (chunk.value) buffer += decoder.decode(chunk.value, { stream: true });
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf("\n");
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const j = JSON.parse(data);
          if (j?.error) {
            yield { type: "error", code: "provider_error", message: String(j.error.message ?? j.error) };
            return;
          }
          const text = j?.choices?.[0]?.delta?.content;
          if (typeof text === "string" && text) {
            emitted = true;
            tokens++;
            yield { type: "delta", text };
          }
        } catch {
          // A keep-alive comment or a partial line; the next read completes it.
        }
      }
    }
    if (req.signal?.aborted) return;
    if (!emitted) {
      yield { type: "error", code: "empty", message: `${engine.label} returned no text.` };
      return;
    }
    yield { type: "final", evalCount: tokens };
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener("abort", onAbort);
  }
}

/** Parse a model's JSON answer, tolerating code fences and text around it. */
export function extractJson(text: string): any {
  if (!text) return null;
  const s = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(s);
  } catch {}
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch {}
  }
  return null;
}

const inFlight = new Map<string, Promise<any>>();

/**
 * One JSON answer, through the gate. The same request already being written is
 * shared rather than run again. Throws an Error with a `code` on failure.
 */
export async function completeJson(
  engine: Engine,
  req: StreamRequest & { schema: Record<string, unknown> },
  onQueued?: (position: number) => void,
): Promise<any> {
  const key = createHash("sha1")
    .update(JSON.stringify([engine.kind, engine.model, engine.kind === "cloud" ? engine.baseUrl : engine.config.baseUrl, req.task, req.system, req.prompt]))
    .digest("hex");
  const running = inFlight.get(key);
  if (running) return running;
  const task = (async () => {
    const release = await gateFor(engine).acquire(req.signal, onQueued);
    try {
      let text = "";
      for await (const event of streamText(engine, req)) {
        if (event.type === "delta") text += event.text;
        else if (event.type === "error") throw Object.assign(new Error(event.message), { code: event.code });
      }
      if (req.signal?.aborted) throw new CancelledError("Cancelled.");
      const parsed = extractJson(text);
      if (parsed === null) throw Object.assign(new Error("The model's answer was not valid JSON."), { code: "bad_json" });
      return parsed;
    } finally {
      release();
    }
  })();
  inFlight.set(key, task);
  task.then(
    () => inFlight.delete(key),
    () => inFlight.delete(key),
  );
  return task;
}

// ---------------------------------------------------------------------------
// What is loaded, and giving memory back
// ---------------------------------------------------------------------------

export type LoadedModel = { name: string; sizeBytes: number; vramBytes: number; expiresAt: string | null; contextLength: number | null };

export async function loadedModels(config: OllamaConfig = ollamaConfig()): Promise<LoadedModel[] | null> {
  try {
    const res = await fetch(`${config.baseUrl}/api/ps`, { signal: AbortSignal.timeout(2_500) });
    if (!res.ok) return null;
    const data: any = await res.json();
    return (Array.isArray(data?.models) ? data.models : []).map((m: any) => ({
      name: String(m?.name ?? m?.model ?? ""),
      sizeBytes: Number(m?.size ?? 0),
      vramBytes: Number(m?.size_vram ?? 0),
      expiresAt: typeof m?.expires_at === "string" ? m.expires_at : null,
      contextLength: Number.isFinite(Number(m?.context_length)) ? Number(m.context_length) : null,
    }));
  } catch {
    return null;
  }
}

/** Unload every model this daemon holds. */
export async function freeMemory(config: OllamaConfig = ollamaConfig()): Promise<{ unloaded: string[] }> {
  const loaded = (await loadedModels(config)) ?? [];
  const unloaded: string[] = [];
  for (const m of loaded) if (await releaseModel(config, m.name)) unloaded.push(m.name);
  return { unloaded };
}

/** Status for the settings panel: the provider, what is loaded, the queue. */
export async function engineOverview() {
  const settings = publicSettings();
  const config = ollamaConfig();
  const loaded = settings.provider === "local" ? await loadedModels(config) : null;
  const engineKey = settings.provider === "local" ? `local:${config.baseUrl}` : `cloud:${settings.baseUrl}`;
  const gate = gates.get(engineKey);
  return {
    settings,
    loaded,
    queue: { active: gate?.active ?? 0, waiting: gate?.queued ?? 0, limit: gate?.limit ?? config.concurrency },
    local: { numCtx: config.numCtx, keepAlive: config.keepAlive },
  };
}
