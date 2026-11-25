/**
 * AI translation, on request, of passages that have no English translation.
 *
 * This is a reading aid, never an edition:
 * - It is written only when a reader asks, for the passages they are reading.
 * - Every segment comes back labelled with the model that wrote it, and the
 *   reader shows it as "AI translation", apart from the editions.
 * - It is held in memory for a while so a reader can come back to it, and is
 *   never written to the database, never indexed for search, and never quoted
 *   by the assistant.
 * - Passages that already have an English edition are not translated.
 *
 * The source text is read on the server (held or streamed, as the reader
 * shows it), so what is translated is what the library holds, not what a page
 * sent.
 */
import { createHash } from "node:crypto";
import { getReader } from "./reader";
import { BusyError, CancelledError, engineDisclosure, gateFor, isProblem, outputCeiling, resolveEngine, streamText, type Engine } from "./llm";
import { extractJson } from "./llm";

export const TRANSLATE_SYSTEM = `You translate passages of religious, legal and philosophical texts into clear, faithful English.

Rules:
- Translate each numbered segment on its own, completely, in order. Do not merge, split, skip or reorder segments.
- Translate; do not explain. No notes, headings, glosses in brackets, commentary or summaries.
- Keep proper names, and transliterate technical terms you cannot translate.
- Keep the register of the original: scripture reads as scripture, law as law.
- If a segment is only a heading, a number or a reference, translate it as such.
- Answer with JSON only: {"translations":[{"id":"1","text":"…"}]}, one entry for every id you were given.`;

export const TRANSLATE_SCHEMA = {
  type: "object",
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, text: { type: "string" } },
        required: ["id", "text"],
      },
    },
  },
  required: ["translations"],
};

const MAX_REFERENCES = 40;

// ---------------------------------------------------------------------------
// Splitting and batching
// ---------------------------------------------------------------------------

/** Split a long text at paragraph, then sentence, boundaries into pieces of at most `max` characters. */
export function chunkText(text: string, max: number): string[] {
  const clean = text.trim();
  if (clean.length <= max) return clean ? [clean] : [];
  const pieces: string[] = [];
  const units = clean.split(/(?<=\n\n)|(?<=[.!?؟।׃:;。])\s+/).filter((u) => u.trim());
  let current = "";
  for (const unit of units) {
    if (unit.length > max) {
      if (current) pieces.push(current.trim());
      current = "";
      for (let i = 0; i < unit.length; i += max) pieces.push(unit.slice(i, i + max).trim());
      continue;
    }
    if (current && current.length + unit.length + 1 > max) {
      pieces.push(current.trim());
      current = "";
    }
    current += (current ? " " : "") + unit;
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces;
}

/**
 * Whether a model's answer reads as English rather than a copy of the source:
 * when the source is written in a non-Latin script, fewer than a fifth of the
 * answer's letters may be in that script.
 */
export function isEnglishLike(answer: string, source: string): boolean {
  const nonLatin = /[\u0370-\u03FF\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u3040-\u30FF\u3400-\u9FFF]/gu;
  if (!nonLatin.test(source)) return true;
  const letters = answer.match(/\p{L}/gu)?.length ?? 0;
  const foreign = answer.match(nonLatin)?.length ?? 0;
  return letters > 0 && foreign / letters < 0.2;
}

export type Piece = { id: string; reference: string; part: number; parts: number; text: string };

/** Group pieces into requests that fit the model's output ceiling. */
export function batchPieces(pieces: Piece[], maxChars: number, maxItems: number): Piece[][] {
  const batches: Piece[][] = [];
  let current: Piece[] = [];
  let size = 0;
  for (const piece of pieces) {
    if (current.length && (size + piece.text.length > maxChars || current.length >= maxItems)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(piece);
    size += piece.text.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

/**
 * Characters of source per request. An English translation runs about one
 * and a half times the characters of a Hebrew or Arabic original, and a
 * token is about 3.2 characters; the answer must fit the output ceiling.
 */
export function sourceBudget(engine: Engine): { chars: number; items: number } {
  const outChars = outputCeiling(engine, "translate") * 3.2;
  return { chars: Math.max(400, Math.floor(outChars / 1.7)), items: engine.kind === "local" ? 4 : 14 };
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

const MEMORY_MAX = 3000;
const memory = new Map<string, string>();

function memoryKey(engine: Engine, lang: string, text: string) {
  const where = engine.kind === "local" ? "local" : engine.baseUrl;
  return createHash("sha1").update(`${where}|${engine.model}|${lang}|${text}`).digest("hex");
}

function remember(key: string, value: string) {
  if (memory.size >= MEMORY_MAX) memory.delete(memory.keys().next().value!);
  memory.set(key, value);
}

export function clearTranslationMemory() {
  memory.clear();
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

export type TranslateInput = { work: string; chapter: string; references: string[]; edition?: string | null; model?: string | null };

type Source = { reference: string; label: string; text: string; lang: string; language: string };

/** The passages to translate, read as the reader shows them. */
async function sourcesFor(input: TranslateInput): Promise<{ sources: Source[]; skipped: string[]; title: string } | { error: string; status: number }> {
  const view: any = await getReader(input.work, input.chapter, input.edition ?? undefined, null);
  if (!view) return { error: "Work not found", status: 404 };
  if (view.type === "stream_unavailable") return { error: "The text's host did not answer, so there is nothing to translate yet.", status: 503 };
  if (view.type !== "chapter") return { error: "Translation works on a chapter's passages.", status: 400 };
  const wanted = new Set(input.references.slice(0, MAX_REFERENCES));
  const sources: Source[] = [];
  const skipped: string[] = [];
  for (const p of view.chapter.passages as any[]) {
    if (!wanted.has(p.reference)) continue;
    const hasEnglish = [p.translation, p.edition].some((e: any) => e?.language?.code === "en");
    const source = p.original ?? p.edition;
    if (hasEnglish || !source?.text || source.language?.code === "en") {
      skipped.push(p.reference);
      continue;
    }
    sources.push({ reference: p.reference, label: p.label, text: String(source.text), lang: source.language.code, language: source.language.name });
  }
  return { sources, skipped, title: String(view.work?.title ?? input.work) };
}

function promptFor(title: string, language: string, batch: Piece[]) {
  const lines = batch.map((p) => `[${p.id}] ${p.text.replace(/\s+/g, " ").trim()}`);
  return `Work: ${title}\nLanguage: ${language}\n\nSegments:\n\n${lines.join("\n\n")}\n\nTranslate every segment into English and answer with the JSON object.`;
}

/**
 * NDJSON stream: `meta`, possibly `queued`, then `segment` events as each batch
 * is written (a passage split into pieces arrives whole), `failed` for a batch
 * the model could not do, and finally `done` or `error`.
 */
export async function translateResponse(input: TranslateInput, signal?: AbortSignal): Promise<Response> {
  const engine = await resolveEngine(input.model);
  if (isProblem(engine)) {
    return Response.json({ error: { message: engine.message, code: engine.code } }, { status: engine.status });
  }
  const found = await sourcesFor(input);
  if ("error" in found) return Response.json({ error: { message: found.error, code: "bad_request" } }, { status: found.status });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          open = false;
        }
      };
      const close = () => {
        if (!open) return;
        open = false;
        try {
          controller.close();
        } catch {}
      };

      send({
        type: "meta",
        model: engine.model,
        provider: engine.kind,
        providerLabel: engine.label,
        disclosure: `AI translation, not an edition. ${engineDisclosure(engine)} It may be wrong; compare it with the original.`,
        total: found.sources.length,
        skipped: found.skipped,
      });

      // Passages already translated in this session come back at once.
      const todo: Source[] = [];
      for (const s of found.sources) {
        const hit = memory.get(memoryKey(engine, s.lang, s.text));
        if (hit) send({ type: "segment", reference: s.reference, text: hit, cached: true });
        else todo.push(s);
      }
      if (!todo.length) {
        send({ type: "done", translated: found.sources.length });
        close();
        return;
      }

      // A local model writes about eight tokens a second: a passage the length
      // of al-Tabari on the Fatiha would hold the computer for half an hour.
      const longest = engine.kind === "local" ? 8_000 : 40_000;
      const tooLong = todo.filter((s) => s.text.length > longest);
      if (tooLong.length) {
        send({
          type: "failed",
          references: tooLong.map((s) => s.reference),
          message:
            engine.kind === "local"
              ? "Too long to translate on this computer in reasonable time. A cloud model in the AI settings can do it."
              : "Too long to translate in one request.",
        });
      }
      todo.splice(0, todo.length, ...todo.filter((s) => s.text.length <= longest));

      const budget = sourceBudget(engine);
      const pieces: Piece[] = [];
      todo.forEach((s, i) => {
        const parts = chunkText(s.text, budget.chars);
        // A passage split into pieces is "3a", "3b": a dotted id would read as a reference.
        parts.forEach((text, k) =>
          pieces.push({ id: parts.length > 1 ? `${i + 1}${String.fromCharCode(97 + (k % 26))}${k >= 26 ? Math.floor(k / 26) : ""}` : String(i + 1), reference: s.reference, part: k, parts: parts.length, text }),
        );
      });
      const batches = batchPieces(pieces, budget.chars, budget.items);
      const done = new Map<string, string[]>();
      const bySource = new Map(todo.map((s) => [s.reference, s]));

      let release: (() => void) | null = null;
      try {
        release = await gateFor(engine).acquire(signal, (position) =>
          send({ type: "queued", position, message: "The model is busy; the translation starts when it is free." }),
        );
      } catch (err) {
        if (err instanceof BusyError) send({ type: "error", code: "ai_busy", message: err.message });
        else if (!(err instanceof CancelledError)) send({ type: "error", code: "internal", message: "The translation could not start." });
        close();
        return;
      }

      let translated = found.sources.length - todo.length;
      try {
        /** One request to the model; the pieces it answered, or the engine's failure. */
        const runBatch = async (batch: Piece[]) => {
          let text = "";
          let failure: { code: string; message: string } | null = null;
          for await (const event of streamText(engine, {
            task: "translate",
            system: TRANSLATE_SYSTEM,
            prompt: promptFor(found.title, bySource.get(batch[0].reference)?.language ?? "the original", batch),
            schema: TRANSLATE_SCHEMA,
            signal,
          })) {
            if (event.type === "delta") text += event.text;
            else if (event.type === "error") failure = { code: event.code, message: event.message };
          }
          const parsed = extractJson(text);
          const rows: any[] = Array.isArray(parsed?.translations) ? parsed.translations : [];
          const answers = new Map<string, string>();
          for (const r of rows) {
            if (!r || typeof r.text !== "string") continue;
            const id = String(r.id).replace(/^\[|\]$/g, "").trim();
            const piece = batch.find((p) => p.id === id);
            // An "English" answer still mostly in the source script is a copy, not a translation.
            if (piece && r.text.trim() && isEnglishLike(r.text, piece.text)) answers.set(id, r.text.trim());
          }
          if (process.env.UWL_DEBUG_TRANSLATE && answers.size < batch.length) {
            console.error("Translation missing ids:", batch.map((p) => p.id), text.slice(0, 600));
          }
          return { answers, failure };
        };

        const accept = (piece: Piece, out: string) => {
          const list = done.get(piece.reference) ?? new Array(piece.parts).fill("");
          list[piece.part] = out;
          done.set(piece.reference, list);
          if (list.every(Boolean)) {
            const whole = list.join(" ");
            const s = bySource.get(piece.reference)!;
            remember(memoryKey(engine, s.lang, s.text), whole);
            send({ type: "segment", reference: piece.reference, text: whole, cached: false });
            translated++;
          }
        };

        for (const batch of batches) {
          if (signal?.aborted) break;
          const first = await runBatch(batch);
          if (signal?.aborted) break;
          if (first.failure && !first.answers.size) {
            // The engine itself failed (stopped, unreachable): nothing more will work.
            send({ type: "error", code: first.failure.code, message: first.failure.message });
            return;
          }
          for (const piece of batch) if (first.answers.has(piece.id)) accept(piece, first.answers.get(piece.id)!);
          // A small model often drops an item from a batch; each one it missed
          // gets one more try on its own.
          const missing: string[] = [];
          for (const piece of batch.filter((p) => !first.answers.has(p.id))) {
            if (signal?.aborted) break;
            const again = batch.length > 1 ? await runBatch([{ ...piece, id: "1" }]) : { answers: new Map<string, string>(), failure: null };
            const out = again.answers.get("1");
            if (out) accept(piece, out);
            else missing.push(piece.reference);
          }
          if (missing.length) {
            send({
              type: "failed",
              references: [...new Set(missing)],
              message: "The model did not return a usable translation for these passages. Try again, or a larger model.",
            });
          }
        }
        if (!signal?.aborted) send({ type: "done", translated });
      } catch (err) {
        console.error("Translation stream failed:", err);
        send({ type: "error", code: "internal", message: "The translation stopped unexpectedly." });
      } finally {
        release?.();
        close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
