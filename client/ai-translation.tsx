import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Icon } from "./components";
import { loadAiPrefs } from "./ai";

/**
 * AI translation of the passages on screen, on request. The server reads the
 * text itself and writes the translation with whichever model the AI
 * settings choose; nothing is stored. Each passage arrives as its batch is
 * written. Translations are kept in this tab for the session so a reader can
 * leave a chapter and come back to it.
 */

type Meta = { model: string; provider: "local" | "cloud"; providerLabel: string; disclosure: string; total: number; skipped: string[] };

export type AiTranslationState = {
  status: "idle" | "running" | "done" | "stopped" | "error";
  meta: Meta | null;
  texts: Map<string, string>;
  failed: Map<string, string>;
  message: string;
  queued: string;
};

const memory = new Map<string, { meta: Meta | null; texts: Map<string, string> }>();

const MAX_PER_REQUEST = 40;

export function useAiTranslation(slug: string, chapter: string, edition?: string | null) {
  const key = `${slug}|${chapter}|${edition ?? ""}`;
  const saved = memory.get(key);
  const [state, setState] = useState<AiTranslationState>(() => ({
    status: saved?.texts.size ? "done" : "idle",
    meta: saved?.meta ?? null,
    texts: saved?.texts ?? new Map(),
    failed: new Map(),
    message: "",
    queued: "",
  }));
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const s = memory.get(key);
    setState({ status: s?.texts.size ? "done" : "idle", meta: s?.meta ?? null, texts: s?.texts ?? new Map(), failed: new Map(), message: "", queued: "" });
    return () => abort.current?.abort();
  }, [key]);

  const start = async (references: string[]) => {
    const wanted = references.filter((r) => !state.texts.has(r)).slice(0, MAX_PER_REQUEST);
    if (!wanted.length) return;

    // Before anything is sent to a cloud service, say so and ask.
    try {
      const settings = await api<{ provider: string; providerLabel: string; model: string }>("/api/ai/settings");
      if (
        settings.provider === "cloud" &&
        !window.confirm(`These ${wanted.length} passages will be sent to ${settings.providerLabel} (${settings.model}) to be translated. Continue?`)
      ) {
        return;
      }
    } catch {
      // If the settings cannot be read, the server still decides; it refuses an unconfigured cloud service.
    }

    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState((s) => ({ ...s, status: "running", message: "", queued: "", failed: new Map() }));

    const remember = (meta: Meta | null, texts: Map<string, string>) => memory.set(key, { meta, texts });
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", accept: "application/x-ndjson" },
        body: JSON.stringify({ work: slug, chapter, references: wanted, edition: edition ?? undefined, model: loadAiPrefs().model || undefined }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        let message = `The translation could not start (${res.status}).`;
        try {
          const data: any = await res.json();
          message = data?.error?.message ?? message;
        } catch {}
        setState((s) => ({ ...s, status: "error", message }));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handle = (event: any) => {
        setState((s) => {
          if (event.type === "meta") return { ...s, meta: event };
          if (event.type === "queued") return { ...s, queued: event.message };
          if (event.type === "segment") {
            const texts = new Map(s.texts).set(event.reference, event.text);
            remember(s.meta, texts);
            return { ...s, texts, queued: "" };
          }
          if (event.type === "failed") {
            const failed = new Map(s.failed);
            for (const r of event.references) failed.set(r, event.message);
            return { ...s, failed, queued: "" };
          }
          if (event.type === "done") return { ...s, status: "done", queued: "" };
          if (event.type === "error") return { ...s, status: "error", message: event.message, queued: "" };
          return s;
        });
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf("\n");
        while (nl >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf("\n");
          if (line) handle(JSON.parse(line));
        }
      }
      setState((s) => (s.status === "running" ? { ...s, status: "done" } : s));
    } catch (err: any) {
      if (controller.signal.aborted) {
        setState((s) => ({ ...s, status: "stopped", queued: "" }));
        return;
      }
      setState((s) => ({ ...s, status: "error", message: err?.message ?? "The translation stopped." }));
    }
  };

  const stop = () => abort.current?.abort();

  return { state, start, stop };
}

/** The bar above the rows: progress, the disclosure, failures, and Stop. */
export function AiTranslationStatus({
  state,
  visible,
  onTranslate,
  onStop,
}: {
  state: AiTranslationState;
  visible: string[];
  onTranslate: (refs: string[]) => void;
  onStop: () => void;
}) {
  const pending = visible.filter((r) => !state.texts.has(r) && !state.failed.has(r));
  const done = visible.filter((r) => state.texts.has(r)).length;
  return (
    <div className="ai-translation-status" role="status">
      <p>
        {state.meta?.disclosure ??
          "AI translation, not an edition: written by a model when you ask, kept only in this tab, never stored or searched. It may be wrong; compare it with the original."}
      </p>
      {state.status === "running" && (
        <p className="muted small">
          {state.queued || `Translating… ${done} of ${visible.length} passages shown so far. A model on this computer writes a few passages every half minute.`}{" "}
          <button className="link-button" onClick={onStop}>Stop</button>
        </p>
      )}
      {state.status === "error" && <p className="error-note">{state.message}</p>}
      {state.status === "stopped" && <p className="muted small">Stopped. Passages already translated stay.</p>}
      {state.failed.size > 0 && state.status !== "running" && (
        <p className="muted small">
          {state.failed.size} passage{state.failed.size === 1 ? "" : "s"} not translated: {[...new Set(state.failed.values())][0]}{" "}
          <button className="link-button" onClick={() => onTranslate([...state.failed.keys()])}>Try again</button>
        </p>
      )}
      {state.status !== "running" && pending.length > 0 && state.texts.size > 0 && (
        <p className="muted small">
          <button className="link-button" onClick={() => onTranslate(pending)}>
            <Icon name="plus" size={12} /> Translate the {Math.min(pending.length, MAX_PER_REQUEST)} passages not yet translated
          </button>
        </p>
      )}
    </div>
  );
}
