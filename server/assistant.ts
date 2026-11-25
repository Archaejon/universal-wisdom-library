import { getDb, meta } from "./db";
import { search } from "./search";
import type { User } from "./auth";
import { cacheSynthesis, cachedSynthesis, ollamaConfig, releaseModel, sanitizeModelName } from "./ollama";
import {
  BusyError,
  engineDisclosure,
  estimateTokens,
  gateFor,
  isProblem,
  promptBudget,
  resolveEngine,
  streamText,
  type Engine,
} from "./llm";

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

/** Where a question is asked: the whole library, one tradition, or one work. */
export type AskScope = { tradition?: string; work?: string };

/**
 * A passage the reader selected in the reader and carried into the question.
 * The selection is the reader's own text; it is checked against a held copy
 * where the library has one.
 */
export type AskContext = { work: string; reference: string; selection: string };

/**
 * Reading tiers. A work's text functions (an editorial classification, see
 * data/corpus/text-functions.json) say what kind of text it is; the tier
 * decides how many of an answer's slots that kind may take, so a question
 * about mercy is not answered by six law-code paragraphs.
 */
export type Tier = "scripture" | "commentary" | "law" | "thought" | "other";
export const TIER_ORDER: Tier[] = ["scripture", "commentary", "law", "thought", "other"];
export const TIER_LABELS: Record<Tier, string> = {
  scripture: "Scripture",
  commentary: "Commentary",
  law: "Law and practice",
  thought: "Thought and devotion",
  other: "Other sources",
};
const TIER_OF_FUNCTION: Record<string, Tier> = {
  canonical_scripture: "scripture",
  foundational_revelation: "scripture",
  commentary_exegesis: "commentary",
  religious_law_practice: "law",
  denominational_guidance: "law",
  creed_confession: "law",
  prayer_liturgy: "law",
  community_statement: "law",
  philosophical_work: "thought",
  mystical_contemplative: "thought",
  contemporary_spiritual_writing: "thought",
  sermon_speech: "thought",
  ethical_humanist_manifesto: "thought",
};
/** Slots reserved per tier in a six-passage answer; the rest go by rank. */
export const TIER_QUOTA: Record<Tier, number> = { scripture: 2, commentary: 2, law: 1, thought: 1, other: 0 };
const ANSWER_SIZE = 6;
const PER_WORK = 2;

/** The highest tier among a work's functions. */
export function tierFor(functions: string[]): Tier {
  let best: Tier = "other";
  for (const f of functions) {
    const t = TIER_OF_FUNCTION[f];
    if (t && TIER_ORDER.indexOf(t) < TIER_ORDER.indexOf(best)) best = t;
  }
  return best;
}

function tiersForWorks(slugs: string[]): Map<string, Tier> {
  const out = new Map<string, Tier>();
  if (!slugs.length) return out;
  const rows = getDb()
    .query(
      `SELECT w.slug, f.function FROM work_text_functions f JOIN works w ON w.id = f.work_id
       WHERE w.slug IN (${slugs.map(() => "?").join(",")})`,
    )
    .all(...slugs) as Row[];
  const byWork = new Map<string, string[]>();
  for (const r of rows) {
    if (!byWork.has(r.slug)) byWork.set(r.slug, []);
    byWork.get(r.slug)!.push(String(r.function));
  }
  for (const slug of slugs) out.set(slug, tierFor(byWork.get(slug) ?? []));
  return out;
}

/**
 * Pick an answer's passages from ranked candidates: first each tier's reserved
 * slots, in rank order, then the best of what is left. No work takes more than
 * two slots. The result is ordered by tier, then rank.
 */
export function selectTiered<T extends { passageId: number; work: { slug: string }; tier: Tier }>(
  candidates: T[],
  size = ANSWER_SIZE,
): T[] {
  const chosen = new Set<number>();
  const perWork = new Map<string, number>();
  const picked: { row: T; rank: number }[] = [];
  const take = (row: T, rank: number) => {
    if (picked.length >= size || chosen.has(row.passageId)) return false;
    if ((perWork.get(row.work.slug) ?? 0) >= PER_WORK) return false;
    chosen.add(row.passageId);
    perWork.set(row.work.slug, (perWork.get(row.work.slug) ?? 0) + 1);
    picked.push({ row, rank });
    return true;
  };
  for (const tier of TIER_ORDER) {
    let n = 0;
    candidates.forEach((row, rank) => {
      if (n < TIER_QUOTA[tier] && row.tier === tier && take(row, rank)) n++;
    });
  }
  candidates.forEach((row, rank) => take(row, rank));
  return picked
    .sort((a, b) => TIER_ORDER.indexOf(a.row.tier) - TIER_ORDER.indexOf(b.row.tier) || a.rank - b.rank)
    .map((p) => p.row);
}

function scopeParams(scope: AskScope): Record<string, string> {
  const out: Record<string, string> = {};
  if (scope.work) out.work = scope.work;
  else if (scope.tradition) out.tradition = scope.tradition;
  return out;
}

/**
 * Concept first, keyword second. Retrieval is deterministic, so the synthesis
 * prompt and the quotations a reader sees above it describe the same passages.
 *
 * Candidates come from both the locally held text and the indexed streamed
 * shelves (Sefaria, hadith, Qur'an, SuttaCentral), which hold a search excerpt
 * and a reference rather than a local copy. Each is given its work's reading
 * tier, and the answer's six slots are shared out by tier (see selectTiered).
 */
export async function retrieve(
  question: string,
  scope: AskScope = {},
  exclude: number[] = [],
  first: "concept" | "keyword" = "concept",
) {
  const extra = scopeParams(scope);
  const second = first === "concept" ? "keyword" : "concept";
  let result = await search(new URLSearchParams({ q: question, mode: first, ...extra }));
  let local: any[] = result.groups.flatMap((g: any) => g.works.flatMap((w: any) => w.results));
  if (local.length === 0) {
    result = await search(new URLSearchParams({ q: question, mode: second, ...extra }));
    local = result.groups.flatMap((g: any) => g.works.flatMap((w: any) => w.results));
  }
  const streamed: any[] = (result.streamIndex?.hits ?? []).map((hit: any) => ({
    ...hit,
    streamedFrom: hit.edition?.source?.name ?? "its host" }));

  // Two local passages to one streamed, so a strong streamed hit is not
  // always ranked below every local one.
  const merged: any[] = [];
  for (let i = 0, j = 0; i < local.length || j < streamed.length; ) {
    if (i < local.length) merged.push(local[i++]);
    if (i < local.length) merged.push(local[i++]);
    if (j < streamed.length) merged.push(streamed[j++]);
  }

  const skip = new Set(exclude);
  const candidates = merged.filter((r) => !skip.has(r.passageId));
  const tiers = tiersForWorks([...new Set(candidates.map((r) => r.work.slug as string))]);
  for (const r of candidates) {
    r.tier = tiers.get(r.work.slug) ?? "other";
  }
  const unique = selectTiered(candidates);
  return { result, unique };
}

/** One line on why a passage was chosen: its tier and what matched. */
function reasonFor(r: any): string {
  const tier = TIER_LABELS[(r.tier as Tier) ?? "other"];
  const why = String(r.why ?? "").replace(/\.$/, "");
  return `${tier}. ${why || "Matched the question"}.`;
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
      tier: r.tier ?? "other",
      tierLabel: TIER_LABELS[(r.tier as Tier) ?? "other"],
      reason: reasonFor(r),
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

const normalise = (t: string) => t.normalize("NFC").replace(/[\u0591-\u05c7]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Turn the reader's selection into the first quotation of the answer. Where
 * the library holds the passage, the selection must be found in one of its
 * editions and is attributed to that edition; a streamed passage has no held
 * copy to check, and says so.
 */
export function contextQuotation(ctx: AskContext | null | undefined) {
  if (!ctx?.work || !ctx.reference || !ctx.selection) return null;
  const db = getDb();
  const reference = ctx.reference.replace(/:/g, ".").trim();
  const p = db
    .query(
      `SELECT p.id, p.reference, p.label, w.slug AS work_slug, w.title AS work_title, w.date_display,
              t.slug AS tradition_slug, t.name AS tradition_name
       FROM passages p JOIN works w ON w.id = p.work_id JOIN traditions t ON t.id = w.tradition_id
       WHERE w.slug = ? AND p.reference = ?`,
    )
    .get(ctx.work, reference) as Row | null;
  if (!p) return null;
  const selection = ctx.selection.replace(/\s+/g, " ").trim().slice(0, 600);
  if (selection.length < 2) return null;
  const held = db
    .query(
      `SELECT pt.content, e.slug, e.title, e.translator, e.edition_type, so.name AS source_name, li.name AS license_name
       FROM passage_texts pt JOIN editions e ON e.id = pt.edition_id
       LEFT JOIN sources so ON so.id = e.source_id LEFT JOIN licenses li ON li.id = e.license_id
       WHERE pt.passage_id = ?`,
    )
    .all(p.id) as Row[];
  const wanted = normalise(selection);
  const match = held.find((h) => normalise(String(h.content)).includes(wanted));
  const tier = tiersForWorks([p.work_slug]).get(p.work_slug) ?? "other";
  const edition = match
    ? { slug: match.slug, title: match.title, translator: match.translator, editionType: match.edition_type, source: { name: match.source_name }, license: { name: match.license_name } }
    : { slug: "", title: "as shown in the reader", translator: null, editionType: "", source: { name: null }, license: { name: null } };
  return {
    kind: "quotation",
    isContext: true,
    verified: !!match,
    passageId: p.id as number,
    quote: trimQuote(selection, 600),
    shortened: false,
    work: { slug: p.work_slug, title: p.work_title, dateDisplay: p.date_display },
    reference: p.reference,
    label: p.label,
    tradition: { slug: p.tradition_slug, name: p.tradition_name },
    edition,
    link: `/read/${p.work_slug}?ref=${encodeURIComponent(p.reference)}${match ? `&version=${encodeURIComponent(match.slug)}` : ""}`,
    citation: `${p.work_title} ${p.label}${match ? ` (${match.title}${match.translator ? `, trans. ${match.translator}` : ""})` : ""}`,
    why: "The passage you selected in the reader.",
    tier,
    tierLabel: TIER_LABELS[tier],
    reason: match
      ? "The passage you asked about, as selected in the reader."
      : "The passage you asked about. The library streams this text and holds no copy to check the selection against.",
    streamedFrom: null,
  };
}

export type AskOptions = { scope?: AskScope; context?: AskContext | null };

/**
 * Words that ask *about* a selection ("what does this mean", "where else is
 * this found") rather than name its subject. Left in, they match any passage
 * that happens to say "mean" or "found".
 */
const ABOUT_WORDS =
  /\b(what|where|else|who|whom|why|how|does|do|did|is|are|was|this|that|these|those|it|its|passage|verse|text|line|selection|mean|means|meaning|say|says|said|explain|explained|found|find|idea|ideas|other|others|traditions?|elsewhere|about|of|in|the|a|an|and|to|by|on|read|interpret|interpreted|commentators?)\b/gi;

/** The retrieval query: the question, or the selection's words and what is left of the question. */
export function retrievalQuery(question: string, ctx: { quote: string } | null) {
  if (!ctx) return question;
  const rest = question.replace(ABOUT_WORDS, " ").replace(/[?.!,;:"“”]/g, " ").replace(/\s+/g, " ").trim();
  return `${ctx.quote.replace(/ …$/, "").slice(0, 300)} ${rest}`.trim();
}

function scopeLabel(scope: AskScope): string | null {
  const db = getDb();
  if (scope.work) {
    const w = db.query("SELECT title FROM works WHERE slug = ?").get(scope.work) as Row | null;
    return w ? String(w.title) : null;
  }
  if (scope.tradition) {
    const t = db.query("SELECT name FROM traditions WHERE slug = ?").get(scope.tradition) as Row | null;
    return t ? String(t.name) : null;
  }
  return null;
}

export async function ask(question: string, user: User | null, options: AskOptions = {}) {
  const db = getDb();
  const scope = options.scope ?? {};
  const ctx = contextQuotation(options.context);
  const { result, unique } = await retrieve(retrievalQuery(question, ctx), scope, ctx ? [ctx.passageId] : [], ctx ? "keyword" : "concept");
  const scopeName = scopeLabel(scope);
  const stats = corpusStats();
  const limitations = [
    `The catalogue contains ${stats.works} works across ${stats.traditions} traditions and ${stats.passages} indexed passages. Retrieval covers the locally held texts and the indexed streamed shelves, which contribute a search excerpt and a reference rather than a local copy. Sefaria's live search is not part of it, and the search page runs that separately.`,
    "Quotations from streamed works are the excerpt indexed here; open the passage to read it at its host.",
    "Absence of a passage from the retrieval set is not evidence that a tradition lacks relevant teaching.",
    "The assistant does not claim that passages sharing a theme are equivalent or historically dependent.",
  ];

  if (unique.length === 0 && !ctx) {
    const answer = {
      grounded: false,
      question,
      scope: { ...scope, label: scopeName },
      engine: { name: "Local retrieval and extractive synthesis", externalModel: false, disclosure: DISCLOSURE },
      message:
        `I could not ground an answer in the indexed corpus${scopeName ? ` within ${scopeName}` : ""}. No retrieved passage supported a response to this question, so I am not going to invent a quotation or citation. Try a broader question, a keyword, ${scopeName ? "the whole library, " : ""}or browse the themes.`,
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

  const quotations = [...(ctx ? [ctx] : []), ...quotationsFor(unique)];
  const commentary = commentaryFor(ctx ? [ctx, ...unique] : unique);

  const themeNotes = db
    .query(
      `SELECT slug, name, description FROM themes WHERE slug IN (${result.concepts.map(() => "?").join(",") || "''"}) ORDER BY sort_order`,
    )
    .all(...result.concepts.map((c: any) => c.slug)) as Row[];
  const concepts = result.concepts.map((c: any) => ({ slug: c.slug, name: c.name, terms: c.terms }));
  const traditions = [...new Set(quotations.map((q) => q.tradition.name))];
  const works = [...new Set(quotations.map((q) => q.work.title))];

  const synthesisParts: string[] = [];
  if (ctx) {
    synthesisParts.push(
      unique.length
        ? `You asked about ${ctx.work.title} ${ctx.label}. The passages below it were retrieved with your question and the words of your selection${scopeName ? `, within ${scopeName}` : ""}.`
        : `You asked about ${ctx.work.title} ${ctx.label}. No other indexed passage${scopeName ? ` in ${scopeName}` : ""} matched your question and selection.`,
    );
  } else if (scopeName) {
    synthesisParts.push(`The search was limited to ${scopeName}.`);
  }
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
    scope: { ...scope, label: scopeName },
    context: ctx ? { work: ctx.work, reference: ctx.reference, label: ctx.label, verified: ctx.verified } : null,
    tiers: TIER_ORDER.map((t) => ({ tier: t, label: TIER_LABELS[t], count: quotations.filter((q) => q.tier === t).length })).filter((t) => t.count),
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
  cacheKey: string;
  model: string;
  system: string;
  prompt: string;
  sources: SynthesisSource[];
  cached: string | null;
  engine: Engine;
  /** How the excerpts were shortened to fit the model's context window, if they were. */
  fitted?: { quoteChars: number; dropped: number } | null;
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

  const about = quotations[0]?.isContext
    ? "\n\nExcerpt [1] is the passage the reader selected and is asking about. Answer about it first, then relate the other excerpts to it."
    : "";
  const prompt = `Question: ${question.replace(/\s+/g, " ").trim()}${about}\n\nExcerpts:\n\n${excerpts.join("\n\n")}\n\nWrite the comparison note now, citing the excerpts by number.`;
  return { system: SYNTHESIS_SYSTEM, prompt, sources };
}

export function localDisclosure(model: string): string {
  return `The synthesis below was written on this machine by ${model} through Ollama, using only the excerpts supplied above. Nothing was sent to an external AI provider. Quotations and citations are copied from the editions themselves, not generated.`;
}

export function synthesisDisclosure(engine: Engine): string {
  if (engine.kind === "local") return localDisclosure(engine.model);
  return `${engineDisclosure(engine)} It used only the excerpts supplied above. Quotations and citations are copied from the editions themselves, not generated.`;
}

/**
 * Keep the prompt inside the model's window: shorten every excerpt, then, if
 * that is not enough, leave out the last ones (never the passage asked about).
 */
export function fitSynthesisPrompt(question: string, quotations: any[], budget: number) {
  let quoteChars = 480;
  let kept = quotations;
  let built = buildSynthesisPrompt(question, kept);
  const size = () => estimateTokens(built.system + built.prompt);
  while (size() > budget && quoteChars > 160) {
    quoteChars -= 80;
    kept = quotations.map((q) => ({ ...q, quote: trimQuote(q.quote, quoteChars) }));
    built = buildSynthesisPrompt(question, kept);
  }
  while (size() > budget && kept.length > 2) {
    kept = kept.slice(0, -1);
    built = buildSynthesisPrompt(question, kept);
  }
  const fitted = quoteChars < 480 || kept.length < quotations.length ? { quoteChars, dropped: quotations.length - kept.length } : null;
  return { ...built, fitted };
}

/**
 * Check the engine (the local daemon and model, or the cloud settings) and
 * retrieval before any stream is opened, so failures arrive as ordinary HTTP
 * errors with useful messages.
 */
export async function prepareSynthesis(
  question: string,
  requestedModel: unknown,
  options: AskOptions = {},
): Promise<SynthesisPlan | SynthesisRefusal> {
  let model: string | null = null;
  if (requestedModel != null && requestedModel !== "") {
    model = sanitizeModelName(requestedModel);
    if (!model) return { error: true, status: 400, code: "invalid_model", message: "That model name is not valid." };
  }
  const engine = await resolveEngine(model);
  if (isProblem(engine)) return { error: true, ...engine };

  const scope = options.scope ?? {};
  const ctx = contextQuotation(options.context);
  const { unique } = await retrieve(retrievalQuery(question, ctx), scope, ctx ? [ctx.passageId] : [], ctx ? "keyword" : "concept");
  if (unique.length === 0 && !ctx) {
    return {
      error: true,
      status: 422,
      code: "ungrounded",
      message: "No indexed passage supports an answer to this question, so the model is not asked to write one. Try a broader question or a keyword.",
    };
  }

  const quotations = [...(ctx ? [ctx] : []), ...quotationsFor(unique)];
  const { system, prompt, sources, fitted } = fitSynthesisPrompt(question, quotations, promptBudget(engine, "synthesis"));
  // The same question asked about another passage, or in another scope, is a
  // different answer; so is one written by another engine.
  const base = ctx || scope.work || scope.tradition
    ? `${question}\u0000${JSON.stringify({ scope, context: ctx ? [ctx.passageId, ctx.quote] : null })}`
    : question;
  const cacheKey = engine.kind === "cloud" ? `${base}\u0000cloud:${engine.baseUrl}` : base;
  return {
    question,
    cacheKey,
    model: engine.model,
    system,
    prompt,
    sources,
    cached: cachedSynthesis(engine.model, cacheKey),
    engine,
    fitted,
  };
}

/**
 * NDJSON stream: one JSON event per line. `meta`, then (if the model is busy)
 * `queued`, then `delta`s, then either a `done` event or an `error` event.
 * Errors mid-stream keep the partial text.
 */
export function synthesisResponse(plan: SynthesisPlan, signal?: AbortSignal): Response {
  const encoder = new TextEncoder();
  const engine = plan.engine;
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
        model: plan.model,
        provider: engine.kind,
        providerLabel: engine.label,
        sources: plan.sources,
        cached: plan.cached !== null,
        disclosure: synthesisDisclosure(engine),
        fitted: plan.fitted ?? null,
      });

      if (plan.cached !== null) {
        send({ type: "delta", text: plan.cached });
        send({ type: "done", model: plan.model, ms: 0, chars: plan.cached.length, cached: true });
        close();
        return;
      }

      let release: (() => void) | null = null;
      try {
        release = await gateFor(engine).acquire(signal, (position) =>
          send({ type: "queued", position, message: "The model is writing another answer; this one starts when it finishes." }),
        );
      } catch (err) {
        if (err instanceof BusyError) send({ type: "error", code: "ai_busy", message: err.message });
        close();
        return;
      }

      const started = Date.now();
      try {
        let text = "";
        for await (const event of streamText(engine, { task: "synthesis", system: plan.system, prompt: plan.prompt, signal })) {
          if (event.type === "delta") {
            text += event.text;
            send({ type: "delta", text: event.text });
          } else if (event.type === "error") {
            send({ ...event, partial: text.length > 0 });
            return;
          } else if (event.type === "final") {
            if (!text.trim()) {
              send({ type: "error", code: "empty", message: "The model returned no text. Try again, or choose a different model." });
              return;
            }
            cacheSynthesis(plan.model, plan.cacheKey, text.trim());
            send({ type: "done", model: plan.model, ms: Date.now() - started, chars: text.length, cached: false, evalCount: event.evalCount });
          }
        }
      } catch (err) {
        console.error("Synthesis stream failed:", err);
        send({ type: "error", code: "internal", message: "The model stream failed. The retrieval answer above is unaffected." });
      } finally {
        release?.();
        close();
      }
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
