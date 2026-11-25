/**
 * Client helpers for the optional local model.
 *
 * The preference is stored in localStorage and defaults to off: no model is
 * contacted until a reader turns it on and asks a question.
 */

export type EngineModel = { name: string; parameterSize?: string; quantization?: string; sizeBytes?: number };

export type EngineStatus = {
  enabled: boolean;
  available: boolean;
  baseUrl: string;
  model: string;
  modelInstalled: boolean;
  models: EngineModel[];
  error?: string;
  settings: { numCtx: number; numPredict: number; keepAlive: string; timeoutMs: number };
};

export type AiPrefs = { enabled: boolean; model: string };

export type SynthesisSource = {
  n: number;
  passageId: number;
  workTitle: string;
  workSlug: string;
  reference: string;
  tradition: string;
  edition: string;
  translator: string | null;
  link: string;
};

export type SynthesisEvent =
  | {
      type: "meta";
      model: string;
      provider?: "local" | "cloud";
      providerLabel?: string;
      sources: SynthesisSource[];
      cached: boolean;
      disclosure: string;
      fitted?: { quoteChars: number; dropped: number } | null;
    }
  | { type: "queued"; position: number; message: string }
  | { type: "delta"; text: string }
  | { type: "done"; model: string; ms: number; chars: number; cached: boolean; evalCount?: number }
  | { type: "error"; code: string; message: string; partial?: boolean };

/**
 * Expands the inside of a citation marker into excerpt numbers: "3", "3, 4"
 * and "3–5" all become numbers. Only the supplied sources are linked later.
 */
export function citationNumbers(body: string, maxSpan = 6): number[] {
  const out: number[] = [];
  for (const piece of body.split(/\s*,\s*/)) {
    const range = /^(\d+)\s*[–-]\s*(\d+)$/.exec(piece);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to >= from && to - from < maxSpan) {
        for (let n = from; n <= to; n++) out.push(n);
      } else {
        out.push(from);
      }
      continue;
    }
    if (/^\d+$/.test(piece)) out.push(Number(piece));
  }
  return [...new Set(out)];
}

const KEY = "uwl.assistant.ai.v1";
const DEFAULT: AiPrefs = { enabled: false, model: "" };

export function loadAiPrefs(): AiPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { enabled: saved.enabled === true, model: typeof saved.model === "string" ? saved.model : "" };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveAiPrefs(prefs: AiPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ enabled: prefs.enabled, model: prefs.model }));
  } catch {
    // A blocked localStorage should not break the page.
  }
}

export class SynthesisError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "SynthesisError";
    this.code = code;
  }
}

/** Reads the daemon's model list. Only called on an explicit user action. */
export async function checkEngine(fresh = false): Promise<EngineStatus> {
  const res = await fetch(`/api/assistant/engine${fresh ? "?fresh=1" : ""}`, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    throw new SynthesisError(data?.error?.message ?? "Could not check the local model server.", data?.error?.code ?? "error");
  }
  return data as EngineStatus;
}

export async function releaseModel(model: string): Promise<void> {
  try {
    await fetch("/api/assistant/release", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ model }),
    });
  } catch {
    // Freeing memory is best effort; the model also unloads on its own.
  }
}

/**
 * Streams a local-model synthesis. Resolves when the stream ends; individual
 * events (including errors the server reports mid-stream) arrive via onEvent.
 */
export async function streamSynthesis(opts: {
  question: string;
  model?: string;
  /** Scope and reader context, sent as given to the ask endpoint. */
  extra?: Record<string, unknown>;
  signal: AbortSignal;
  onEvent: (event: SynthesisEvent) => void;
}): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/assistant/synthesise", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/x-ndjson" },
      body: JSON.stringify({ ...(opts.extra ?? {}), question: opts.question, model: opts.model || undefined }),
      signal: opts.signal,
    });
  } catch (err: any) {
    if (opts.signal.aborted) return;
    throw new SynthesisError("The local model server could not be reached from this page.", "unavailable");
  }

  if (!res.ok) {
    let message = `The local model request failed (${res.status}).`;
    let code = "error";
    try {
      const data: any = await res.json();
      message = data?.error?.message ?? message;
      code = data?.error?.code ?? code;
    } catch {}
    throw new SynthesisError(message, code);
  }

  if (!res.body) throw new SynthesisError("The local model returned an empty stream.", "malformed");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        try {
          opts.onEvent(JSON.parse(line) as SynthesisEvent);
        } catch {
          // A malformed line is skipped rather than breaking the whole answer.
        }
      }
      newline = buffer.indexOf("\n");
    }
  }
  const trailing = buffer.trim();
  if (trailing) {
    try {
      opts.onEvent(JSON.parse(trailing) as SynthesisEvent);
    } catch {}
  }
}
