/**
 * The optional local-model layer.
 *
 * Everything here talks to an Ollama daemon on the same machine as this server.
 * Nothing in the application imports this module except the assistant's
 * synthesis step, and nothing calls out until a reader explicitly asks for a
 * generated answer. A missing or slow Ollama is an ordinary error condition,
 * never a startup dependency.
 */
import { getDb } from "./db";

export type OllamaConfig = {
  baseUrl: string;
  model: string;
  enabled: boolean;
  timeoutMs: number;
  numCtx: number;
  numPredict: number;
  temperature: number;
  keepAlive: string;
  concurrency: number;
};

export type OllamaOptions = { numCtx?: number; numPredict?: number; temperature?: number };

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
// A small general-purpose instruct model: quantised, ~5 GB, comfortable on a
// laptop. It is only a default; the reader can point the app at any installed
// model, and the UI lists what is actually present before anything is sent.
const DEFAULT_MODEL = "llama3.1:8b";

function readInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function readFloat(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseFloat(value ?? "");
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function readBaseUrl(value: string | undefined): string {
  if (!value) return DEFAULT_BASE_URL;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return DEFAULT_BASE_URL;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return DEFAULT_BASE_URL;
  }
}

export function ollamaConfig(env: Record<string, string | undefined> = process.env): OllamaConfig {
  return {
    baseUrl: readBaseUrl(env.UWL_OLLAMA_URL),
    model: env.UWL_OLLAMA_MODEL?.trim() || DEFAULT_MODEL,
    enabled: env.UWL_OLLAMA_ENABLED !== "0",
    timeoutMs: readInt(env.UWL_OLLAMA_TIMEOUT_MS, 120_000, 5_000, 600_000),
    numCtx: readInt(env.UWL_OLLAMA_NUM_CTX, 4096, 512, 131_072),
    numPredict: readInt(env.UWL_OLLAMA_NUM_PREDICT, 280, 32, 4096),
    temperature: readFloat(env.UWL_OLLAMA_TEMPERATURE, 0.2, 0, 2),
    keepAlive: env.UWL_OLLAMA_KEEP_ALIVE?.trim() || "5m",
    concurrency: readInt(env.UWL_OLLAMA_CONCURRENCY, 1, 1, 4),
  };
}

export type OllamaModel = {
  name: string;
  parameterSize?: string;
  quantization?: string;
  sizeBytes?: number;
};

export type OllamaStatus = {
  enabled: boolean;
  available: boolean;
  baseUrl: string;
  model: string;
  modelInstalled: boolean;
  models: OllamaModel[];
  error?: string;
  settings: { numCtx: number; numPredict: number; keepAlive: string; timeoutMs: number };
};

type TagListing = { ok: true; models: OllamaModel[] } | { ok: false; error: string };

// Model lists change rarely and this call is only made when a reader opens the
// local-model controls or asks for a synthesis. A short cache keeps repeated
// questions from re-listing the same models.
const tagCache = new Map<string, { at: number; listing: TagListing }>();
const TAG_TTL_MS = 30_000;

export function unreachableMessage(config: OllamaConfig): string {
  return `Ollama is not responding at ${config.baseUrl}. Start it with \`ollama serve\`, then check again.`;
}

export async function listModels(config: OllamaConfig, opts: { fresh?: boolean } = {}): Promise<TagListing> {
  const cached = tagCache.get(config.baseUrl);
  if (!opts.fresh && cached && Date.now() - cached.at < TAG_TTL_MS) return cached.listing;
  let listing: TagListing;
  try {
    const res = await fetch(`${config.baseUrl}/api/tags`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(Math.min(config.timeoutMs, 3_000)),
    });
    if (!res.ok) {
      listing = { ok: false, error: unreachableMessage(config) };
    } else {
      const data: any = await res.json();
      const rows = Array.isArray(data?.models) ? data.models : [];
      listing = {
        ok: true,
        models: rows
          .filter((m: any) => typeof m?.name === "string")
          .map((m: any) => ({
            name: m.name,
            parameterSize: typeof m?.details?.parameter_size === "string" ? m.details.parameter_size : undefined,
            quantization: typeof m?.details?.quantization_level === "string" ? m.details.quantization_level : undefined,
            sizeBytes: typeof m?.size === "number" ? m.size : undefined,
          })),
      };
    }
  } catch {
    listing = { ok: false, error: unreachableMessage(config) };
  }
  // Failures are not cached, so a reader who starts Ollama can retry at once.
  if (listing.ok) tagCache.set(config.baseUrl, { at: Date.now(), listing });
  return listing;
}

export function isModelInstalled(models: OllamaModel[], wanted: string): boolean {
  const bare = (name: string) => name.replace(/:latest$/, "");
  return models.some((m) => m.name === wanted || bare(m.name) === bare(wanted));
}

export async function ollamaStatus(config: OllamaConfig, opts: { fresh?: boolean } = {}): Promise<OllamaStatus> {
  const settings = {
    numCtx: config.numCtx,
    numPredict: config.numPredict,
    keepAlive: config.keepAlive,
    timeoutMs: config.timeoutMs,
  };
  if (!config.enabled) {
    return {
      enabled: false,
      available: false,
      baseUrl: config.baseUrl,
      model: config.model,
      modelInstalled: false,
      models: [],
      error: "Local AI is switched off on this server (UWL_OLLAMA_ENABLED=0).",
      settings,
    };
  }
  const listing = await listModels(config, opts);
  if (!listing.ok) {
    return {
      enabled: true,
      available: false,
      baseUrl: config.baseUrl,
      model: config.model,
      modelInstalled: false,
      models: [],
      error: listing.error,
      settings,
    };
  }
  return {
    enabled: true,
    available: true,
    baseUrl: config.baseUrl,
    model: config.model,
    modelInstalled: isModelInstalled(listing.models, config.model),
    models: listing.models,
    settings,
  };
}

/** Never accept a model name straight from a request body. */
export function sanitizeModelName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name || name.length > 120) return null;
  return /^[A-Za-z0-9][A-Za-z0-9._:\/-]*$/.test(name) ? name : null;
}

// ---------------------------------------------------------------------------
// Concurrency and result cache
// ---------------------------------------------------------------------------

let active = 0;

/** Returns a release function, or null when the machine is already busy. */
export function acquireGeneration(limit: number): (() => void) | null {
  if (active >= limit) return null;
  active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active = Math.max(0, active - 1);
  };
}

export function activeGenerations(): number {
  return active;
}

// A synthesis that took half a minute to write should survive a restart, and a
// second server process should see it too, so the cache is a table rather than a
// map. Same key, same 15-minute life, same cap.
const CACHE_TTL_MS = 15 * 60_000;
const CACHE_MAX = 30;

function cacheKey(model: string, question: string): string {
  const hash = new Bun.CryptoHasher("sha256").update(`${model}\u0000${question}`).digest("hex");
  return hash.slice(0, 32);
}

export function cachedSynthesis(model: string, question: string): string | null {
  const db = getDb();
  const key = cacheKey(model, question);
  const row = db.query("SELECT text, created_at FROM synthesis_cache WHERE cache_key = ?").get(key) as
    | { text: string; created_at: number }
    | null;
  if (!row) return null;
  if (Date.now() - Number(row.created_at) > CACHE_TTL_MS) {
    db.query("DELETE FROM synthesis_cache WHERE cache_key = ?").run(key);
    return null;
  }
  return String(row.text);
}

export function cacheSynthesis(model: string, question: string, text: string): void {
  if (!text.trim()) return;
  const db = getDb();
  db.query(
    "INSERT OR REPLACE INTO synthesis_cache (cache_key, model, question, text, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(cacheKey(model, question), model, question, text, Date.now());
  db.query(
    "DELETE FROM synthesis_cache WHERE cache_key NOT IN (SELECT cache_key FROM synthesis_cache ORDER BY created_at DESC LIMIT ?)",
  ).run(CACHE_MAX);
}

export function clearSynthesisCache(): void {
  getDb().query("DELETE FROM synthesis_cache").run();
}

// ---------------------------------------------------------------------------
// Streaming generation
// ---------------------------------------------------------------------------

export type OllamaEvent =
  | { type: "delta"; text: string }
  | { type: "final"; evalCount: number }
  | { type: "error"; code: string; message: string };

type ParsedLine = OllamaEvent | { type: "ignore" };

/** Parse one NDJSON line from /api/generate. Exported for the tests. */
export function parseOllamaLine(line: string, config: OllamaConfig): ParsedLine {
  let data: any;
  try {
    data = JSON.parse(line);
  } catch {
    return { type: "ignore" };
  }
  if (typeof data?.error === "string" && data.error) {
    const missing = /not found|try pulling/i.test(data.error);
    return {
      type: "error",
      code: missing ? "model_missing" : "model_error",
      message: missing
        ? `The model is not installed. Run \`ollama pull ${config.model}\` and try again.`
        : `Ollama reported a problem: ${data.error}`,
    };
  }
  if (typeof data?.response === "string" && data.response.length > 0) {
    return { type: "delta", text: data.response };
  }
  if (data?.done === true) {
    return { type: "final", evalCount: typeof data.eval_count === "number" ? data.eval_count : 0 };
  }
  return { type: "ignore" };
}

export type GenerateRequest = {
  model: string;
  system: string;
  prompt: string;
  signal?: AbortSignal;
  options?: OllamaOptions;
};

/**
 * Stream a completion from Ollama. The generator ends with either a `final`
 * event or an `error` event; a client disconnect simply ends it.
 */
export async function* generate(config: OllamaConfig, req: GenerateRequest): AsyncGenerator<OllamaEvent> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  req.signal?.addEventListener("abort", abort);
  if (req.signal?.aborted) controller.abort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.timeoutMs);

  try {
    let res: Response;
    try {
      res = await fetch(`${config.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/x-ndjson" },
        body: JSON.stringify({
          model: req.model,
          system: req.system,
          prompt: req.prompt,
          stream: true,
          keep_alive: config.keepAlive,
          options: {
            num_ctx: req.options?.numCtx ?? config.numCtx,
            num_predict: req.options?.numPredict ?? config.numPredict,
            temperature: req.options?.temperature ?? config.temperature,
          },
        }),
        signal: controller.signal,
      });
    } catch {
      if (req.signal?.aborted) return;
      yield {
        type: "error",
        code: timedOut ? "timeout" : "unavailable",
        message: timedOut
          ? "The local model took too long to respond. The request was cancelled; try a shorter question."
          : unreachableMessage(config),
      };
      return;
    }

    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 400);
      } catch {}
      if (res.status === 404 && /not found|pull/i.test(detail)) {
        yield {
          type: "error",
          code: "model_missing",
          message: `The model ${req.model} is not installed. Run \`ollama pull ${req.model}\` and try again.`,
        };
      } else {
        yield {
          type: "error",
          code: "model_error",
          message: `Ollama refused the request (HTTP ${res.status}). Check that the model ${req.model} is installed and the daemon is healthy.`,
        };
      }
      return;
    }

    if (!res.body) {
      yield { type: "error", code: "malformed", message: "Ollama returned an empty response stream." };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let evalCount = 0;
    let emitted = false;

    const handle = (line: string): OllamaEvent | null => {
      const parsed = parseOllamaLine(line, config);
      if (parsed.type === "delta") {
        emitted = true;
        return parsed;
      }
      if (parsed.type === "final") {
        evalCount = parsed.evalCount;
      }
      if (parsed.type === "error") return parsed;
      return null;
    };

    while (true) {
      let chunk: { done: boolean; value?: Uint8Array };
      try {
        chunk = await reader.read();
      } catch {
        if (req.signal?.aborted) return;
        yield {
          type: "error",
          code: timedOut ? "timeout" : "interrupted",
          message: timedOut
            ? "The local model took too long to respond. The request was cancelled; try a shorter question."
            : "The connection to Ollama was interrupted before the answer was finished.",
        };
        return;
      }
      if (chunk.done) break;
      if (chunk.value) buffer += decoder.decode(chunk.value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          const event = handle(line);
          if (event) {
            yield event;
            if (event.type === "error") return;
          }
        }
        newline = buffer.indexOf("\n");
      }
    }

    const trailing = buffer.trim();
    if (trailing) {
      const event = handle(trailing);
      if (event) {
        yield event;
        if (event.type === "error") return;
      }
    }

    if (req.signal?.aborted) return;
    if (!emitted) {
      yield { type: "error", code: "empty", message: "The model returned no text. Try asking again, or choose a different model." };
      return;
    }
    yield { type: "final", evalCount };
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener("abort", abort);
  }
}

/**
 * Ask Ollama to unload the model, releasing RAM/VRAM as soon as the reader
 * stops using local AI. Best effort; a failure is not surfaced.
 */
export async function releaseModel(config: OllamaConfig, model: string): Promise<boolean> {
  try {
    const res = await fetch(`${config.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, keep_alive: 0 }),
      signal: AbortSignal.timeout(2_500),
    });
    return res.ok;
  } catch {
    return false;
  }
}
