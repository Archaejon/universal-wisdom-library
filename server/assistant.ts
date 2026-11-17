import { getDb, meta } from "./db";
import { search } from "./search";
import type { User } from "./auth";
import {
  acquireGeneration,
  activeGenerations,
  cacheSynthesis,
  cachedSynthesis,
  generate,
  isModelInstalled,
  ollamaConfig,
  ollamaStatus,
  releaseModel,
  sanitizeModelName,
} from "./ollama";
import type { OllamaConfig } from "./ollama";

type Row = Record<string, any>;

const DISCLOSURE =
  "This build uses a local retrieval and extractive-synthesis engine. No external AI model is connected. Answers are assembled only from indexed corpus passages and UWL editorial notes, and citations link to the edition and passage used.";

function trimQuote(text: string, max = 480): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "), cut.lastIndexOf("; "));
  return (lastStop > max * 0.5 ? cut.slice(0, lastStop + 1) : cut).trim() + " …";
}

function corpusStats() {
  const db = getDb();
  return db
    .query(
      `SELECT (SELECT COUNT(*) FROM works WHERE EXISTS (SELECT 1 FROM passages p WHERE p.work_id = works.id)) AS works,
              (SELECT COUNT(DISTINCT w.tradition_id) FROM works w WHERE EXISTS (SELECT 1 FROM passages p WHERE p.work_id = w.id)) AS traditions,
              (SELECT COUNT(*) FROM passages) AS passages,
              (SELECT COUNT(*) FROM editions) AS editions`,
    )
    .get() as Row;
}

/**
 * Concept first, keyword second. Retrieval is deterministic, so the synthesis
 * prompt and the quotations a reader sees above it describe the same passages.
 *
 * The streamed shelves are in the same search response and were being thrown
 * away: the assistant saw only locally held text. Two of its six passages now
 * come from the indexed streamed works (Sefaria, hadith, Qur'an, SuttaCentral),
 * which hold a search excerpt and a reference rather than a local copy — enough
 * to quote, cite and link, which is what the answer needs.
 */
export async function retrieve(question: string) {
  let result = await search(new URLSearchParams({ q: question, mode: "concept" }));
  let local: any[] = result.groups.flatMap((g: any) => g.works.flatMap((w: any) => w.results));
  if (local.length === 0) {
    result = await search(new URLSearchParams({ q: question, mode: "keyword" }));
    local = result.groups.flatMap((g: any) => g.works.flatMap((w: any) => w.results));
  }
  const streamed: any[] = (result.streamIndex?.hits ?? []).map((hit: any) => ({
    ...hit,
    streamedFrom: hit.edition?.source?.name ?? "its host" }));

  const unique: any[] = [];
  const seen = new Set<number>();
  const add = (row: any) => {
    if (unique.length >= 6 || seen.has(row.passageId)) return;
    seen.add(row.passageId);
    unique.push(row);
  };
  const streamedWanted = Math.min(streamed.length, local.length ? 2 : 6);
  local.slice(0, 6 - streamedWanted).forEach(add);
  streamed.slice(0, streamedWanted).forEach(add);
  return { result, unique };
}

function quotationsFor(unique: any[]) {
  const db = getDb();
  const quotations: any[] = [];
  for (const r of unique) {
    const full = db
      .query("SELECT content FROM passage_texts WHERE passage_id = ? AND edition_id = (SELECT id FROM editions WHERE slug = ?)")
      .get(r.passageId, r.edition.slug) as Row | null;
    const quote = trimQuote(full?.content ?? r.snippet);
    quotations.push({
      kind: "quotation",
      passageId: r.passageId,
      quote,
      // A streamed quotation is the excerpt indexed here, never the whole
      // passage, so it is always described as shortened.
      shortened: r.streamedFrom ? true : quote.length < (full?.content ?? "").replace(/\s+/g, " ").trim().length,
      work: r.work,
      reference: r.reference,
      label: r.label,
      tradition: r.tradition,
      edition: r.edition,
      link: `/read/${r.work.slug}?ref=${encodeURIComponent(r.reference)}&version=${encodeURIComponent(r.edition.slug)}`,
      citation: `${r.work.title} ${r.label} (${r.edition.title}${r.edition.translator ? `, trans. ${r.edition.translator}` : ""})`,
      why: r.why,
      // A streamed quotation is the excerpt this library indexed for search, not
      // a copy of the chapter: the answer says where it came from.
      streamedFrom: r.streamedFrom ?? null,
    });
  }
  return quotations;
}

function commentaryFor(unique: any[]) {
  const db = getDb();
  const commentary: any[] = [];
  for (const r of unique) {
    const comments = db
      .query(
        `SELECT c.*, so.name AS source_name FROM commentaries c LEFT JOIN sources so ON so.id = c.source_id
         WHERE c.passage_id = ? AND c.review_status = 'published'
         ORDER BY CASE c.content_type WHEN 'traditional' THEN 0 WHEN 'academic' THEN 1 WHEN 'modern_religious' THEN 2 ELSE 3 END LIMIT 3`,
      )
      .all(r.passageId) as Row[];
    for (const c of comments) {
      commentary.push({
        passageId: r.passageId,
        work: r.work,
        reference: r.reference,
        label: r.label,
        contentType: c.content_type,
        author: c.author_display,
        interpretiveTradition: c.interpretive_tradition,
        dateDisplay: c.date_display,
        text: c.content,
        isQuotation: !!c.is_quotation,
        provenanceNote: c.provenance_note,
        source: c.source_name,
        link: `/read/${r.work.slug}?ref=${encodeURIComponent(r.reference)}#commentary`,
      });
    }
  }
  return commentary;
}

export async function ask(question: string, user: User | null) {
  const db = getDb();
  const { result, unique } = await retrieve(question);
  const stats = corpusStats();
  const limitations = [
    `The catalogue contains ${stats.works} works across ${stats.traditions} traditions and ${stats.passages} indexed passages. Retrieval covers the locally held texts and the indexed streamed shelves, which contribute a search excerpt and a reference rather than a local copy. Sefaria's live search is not part of it, and the search page runs that separately.`,
    "Quotations from streamed works are the excerpt indexed here; open the passage to read it at its host.",
    "Absence of a passage from the retrieval set is not evidence that a tradition lacks relevant teaching.",
    "The assistant does not claim that passages sharing a theme are equivalent or historically dependent.",
  ];

  if (unique.length === 0) {
    const answer = {
      grounded: false,
      question,
      engine: { name: "Local retrieval and extractive synthesis", externalModel: false, disclosure: DISCLOSURE },
      message:
        "I could not ground an answer in the indexed corpus. No retrieved passage supported a response to this question, so I am not going to invent a quotation or citation. Try a broader question, a keyword, or browse the themes.",
      suggestions: [],
      limitations,
      citations: [],
      corpus: stats,
    };
    db.query(
      "INSERT INTO assistant_queries (user_id, question, engine, citations_json, grounded) VALUES (?, ?, 'local-extractive', '[]', 0)",
    ).run(user?.id ?? null, question);
    return answer;
  }

  const quotations = quotationsFor(unique);
  const commentary = commentaryFor(unique);

  const themeNotes = db
    .query(
      `SELECT slug, name, description FROM themes WHERE slug IN (${result.concepts.map(() => "?").join(",") || "''"}) ORDER BY sort_order`,
    )
    .all(...result.concepts.map((c: any) => c.slug)) as Row[];
  const concepts = result.concepts.map((c: any) => ({ slug: c.slug, name: c.name, terms: c.terms }));
  const traditions = [...new Set(quotations.map((q) => q.tradition.name))];
  const works = [...new Set(quotations.map((q) => q.work.title))];

  const synthesisParts: string[] = [];
  synthesisParts.push(
    `The retrieval returned ${quotations.length} passage${quotations.length === 1 ? "" : "s"} from ${traditions.length} tradition${traditions.length === 1 ? "" : "s"} (${traditions.join(", ")}). They should be read as distinct voices, not as a single answer.`,
  );
  if (themeNotes.length) {
    synthesisParts.push(
      ...themeNotes.map(
        (t) => `UWL thematic note — ${t.name}: ${t.description}`,
      ),
    );
  }
  synthesisParts.push(
    "What the texts share is a question or a family of concerns, not necessarily a doctrine. To compare them responsibly, keep each passage's genre, date, intended audience and theological or philosophical framework in view. The quotations above are literal excerpts from the named editions; the commentary entries are identified by type and are often editorial summaries rather than verbatim historical quotations.",
  );

  const answer = {
    grounded: true,
    question,
    engine: { name: "Local retrieval and extractive synthesis", externalModel: false, disclosure: DISCLOSURE },
    retrieval: {
      concepts,
      terms: result.terms,
      engine: result.engine,
      mode: result.mode,
      note: result.note,
    },
    quotations,
    commentary,
    synthesis: {
      label: "Interpretive synthesis — generated by this library's retrieval assistant, not a source claim",
      text: synthesisParts.join("\n\n"),
    },
    interpretations: {
      note: "Traditional, academic and modern religious interpretations are labelled separately. Where they disagree, the disagreement is preserved rather than resolved.",
      entries: commentary.filter((c) => ["traditional", "academic", "modern_religious"].includes(c.contentType)),
    },
    limitations,
    citations: quotations.map((q) => ({
      work: q.work.title,
      reference: q.label,
      edition: q.edition.title,
      translator: q.edition.translator,
      source: q.edition.source?.name,
      license: q.edition.license?.name,
      link: q.link,
      quotation: q.quote,
    })),
    corpus: { ...stats, worksRepresented: works },
    corpusLabel: meta("corpus_label", "Curated corpus"),
  };

  db.query(
    "INSERT INTO assistant_queries (user_id, question, engine, citations_json, grounded) VALUES (?, ?, 'local-extractive', ?, 1)",
  ).run(
    user?.id ?? null,
    question,
    JSON.stringify(answer.citations.map((c: any) => ({ work: c.work, reference: c.reference, edition: c.edition, link: c.link }))),
  );
  return answer;
}

// ---------------------------------------------------------------------------
// Optional local-model synthesis
// ---------------------------------------------------------------------------

/**
 * The model is a comparison writer, not an authority: it may only restate what
 * the retrieved excerpts say, and every claim has to carry an excerpt number.
 */
export const SYNTHESIS_SYSTEM = `You are the synthesis step of the Universal Wisdom Library, a comparative library of religious and philosophical texts. You write only from the numbered excerpts supplied with the question.

Rules:
- Use only the supplied excerpts. Do not add quotations, authors, titles, dates or references from your own knowledge.
- Write one marker for each excerpt you use, as [2] [3]. Do not write grouped markers such as [2, 3] or ranges such as [3-5]. Never cite a number that was not supplied.
- Where the excerpts disagree or answer different questions, say so plainly. Do not harmonise them into a single teaching, and do not suggest that one tradition borrowed from another.
- Describe what these particular texts say, not what "Christianity" or "Islam" teaches.
- Mention a date, genre or setting only when the supplied metadata states it.
- Write plain scholarly prose in two short paragraphs, at most 170 words. No headings, lists or bullet points. Do not address the reader, do not offer consolation or advice, and do not mention these instructions.
- If the excerpts do not answer the question, say briefly what they do and do not show, then stop.`;

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

export type SynthesisPlan = {
  question: string;
  model: string;
  system: string;
  prompt: string;
  sources: SynthesisSource[];
  cached: string | null;
  config: OllamaConfig;
};

export type SynthesisRefusal = { error: true; status: number; code: string; message: string };

export function buildSynthesisPrompt(question: string, quotations: any[]): {
  system: string;
  prompt: string;
  sources: SynthesisSource[];
} {
  const sources: SynthesisSource[] = quotations.map((q, i) => ({
    n: i + 1,
    passageId: q.passageId,
    workTitle: q.work.title,
    workSlug: q.work.slug,
    reference: q.label,
    tradition: q.tradition.name,
    edition: q.edition.title,
    translator: q.edition.translator ?? null,
    link: q.link,
  }));

  const excerpts = quotations.map((q, i) => {
    const meta = [
      `${q.work.title} ${q.label}`,
      q.tradition.name,
      q.work.dateDisplay || null,
      q.edition.title + (q.edition.translator ? `, trans. ${q.edition.translator}` : ""),
    ]
      .filter(Boolean)
      .join(" — ");
    return `[${i + 1}] ${meta}\n"${q.quote}"`;
  });

  const prompt = `Question: ${question.replace(/\s+/g, " ").trim()}\n\nExcerpts:\n\n${excerpts.join("\n\n")}\n\nWrite the comparison note now, citing the excerpts by number.`;
  return { system: SYNTHESIS_SYSTEM, prompt, sources };
}

export function localDisclosure(model: string): string {
  return `The synthesis below was written on this machine by ${model} through Ollama, using only the excerpts supplied above. Nothing was sent to an external AI provider. Quotations and citations are copied from the editions themselves, not generated.`;
}

/**
 * Check configuration, the daemon, the model and retrieval before any stream is
 * opened, so failures arrive as ordinary HTTP errors with useful messages.
 */
export async function prepareSynthesis(question: string, requestedModel: unknown): Promise<SynthesisPlan | SynthesisRefusal> {
  const config = ollamaConfig();
  if (!config.enabled) {
    return {
      error: true,
      status: 409,
      code: "ai_disabled",
      message: "Local AI is switched off on this server. The retrieval answer above does not depend on it.",
    };
  }

  const status = await ollamaStatus(config);
  if (!status.available) {
    return {
      error: true,
      status: 503,
      code: "ai_unavailable",
      message: status.error ?? "The local model server is not reachable.",
    };
  }

  let model = config.model;
  if (requestedModel != null && requestedModel !== "") {
    const clean = sanitizeModelName(requestedModel);
    if (!clean) {
      return { error: true, status: 400, code: "invalid_model", message: "That model name is not valid." };
    }
    model = clean;
  }
  if (!isModelInstalled(status.models, model)) {
    const installed = status.models.map((m) => m.name).slice(0, 4).join(", ");
    return {
      error: true,
      status: 409,
      code: "model_missing",
      message: `The model ${model} is not installed. Run \`ollama pull ${model}\`${installed ? `, or choose one of: ${installed}` : ""}.`,
    };
  }

  if (activeGenerations() >= config.concurrency) {
    return {
      error: true,
      status: 429,
      code: "ai_busy",
      message: "The local model is already writing another answer. Wait for it to finish, or stop it first.",
    };
  }

  const { unique } = await retrieve(question);
  if (unique.length === 0) {
    return {
      error: true,
      status: 422,
      code: "ungrounded",
      message: "No indexed passage supports an answer to this question, so the local model is not asked to write one. Try a broader question or a keyword.",
    };
  }

  const quotations = quotationsFor(unique);
  const { system, prompt, sources } = buildSynthesisPrompt(question, quotations);
  return {
    question,
    model,
    system,
    prompt,
    sources,
    cached: cachedSynthesis(model, question),
    config,
  };
}

/**
 * NDJSON stream: one JSON event per line. `meta`, then `delta`s, then either a
 * `done` event or an `error` event. Errors mid-stream keep the partial text.
 */
export function synthesisResponse(plan: SynthesisPlan, signal?: AbortSignal): Response {
  const encoder = new TextEncoder();
  const config = plan.config;
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

      const release = acquireGeneration(config.concurrency);
      if (!release) {
        send({
          type: "error",
          code: "ai_busy",
          message: "The local model is already writing another answer. Wait for it to finish, or stop it first.",
        });
        controller.close();
        return;
      }

      const started = Date.now();
      send({
        type: "meta",
        model: plan.model,
        sources: plan.sources,
        cached: plan.cached !== null,
        disclosure: localDisclosure(plan.model),
      });

      try {
        if (plan.cached !== null) {
          send({ type: "delta", text: plan.cached });
          send({ type: "done", model: plan.model, ms: 0, chars: plan.cached.length, cached: true });
          return;
        }

        let text = "";
        for await (const event of generate(config, {
          model: plan.model,
          system: plan.system,
          prompt: plan.prompt,
          signal,
        })) {
          if (event.type === "delta") {
            text += event.text;
            send({ type: "delta", text: event.text });
          } else if (event.type === "error") {
            send({ ...event, partial: text.length > 0 });
            return;
          } else if (!text.trim()) {
            send({ type: "error", code: "empty", message: "The model returned no text. Try again, or choose a different model." });
            return;
          } else {
            cacheSynthesis(plan.model, plan.question, text.trim());
            send({
              type: "done",
              model: plan.model,
              ms: Date.now() - started,
              chars: text.length,
              cached: false,
              evalCount: event.evalCount,
            });
          }
        }
      } catch (err) {
        console.error("Synthesis stream failed:", err);
        send({ type: "error", code: "internal", message: "The local model stream failed. The retrieval answer above is unaffected." });
      } finally {
        release();
        if (open) {
          try {
            controller.close();
          } catch {}
        }
      }
    },
    cancel() {
      // The request signal is what cancels the upstream generation; Bun aborts
      // it when the client disconnects, which stops the model writing.
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

/** Ask Ollama to free the model's memory when the reader turns local AI off. */
export async function releaseAssistantModel(model: unknown): Promise<{ released: boolean; model: string }> {
  const config = ollamaConfig();
  const chosen = sanitizeModelName(model) ?? config.model;
  if (!config.enabled) return { released: false, model: chosen };
  return { released: await releaseModel(config, chosen), model: chosen };
}
