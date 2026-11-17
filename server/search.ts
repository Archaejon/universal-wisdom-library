import { getDb } from "./db";
import { excerpt, isCjk, normalizeForSearch, contentTerms, phraseFor } from "./text";
import { facets } from "./library";
import { searchStreamed } from "./stream";
import { searchStreamIndex } from "./stream-search";
import { baseJoins, filterSql } from "./search-filters";

type Row = Record<string, any>;

const CONCEPTS: { slug: string; name: string; terms: string[] }[] = [
  { slug: "compassion", name: "compassion and mercy", terms: ["compassion", "mercy", "merciful", "kindness", "love", "hatred", "pity"] },
  { slug: "justice", name: "justice and righteousness", terms: ["justice", "righteousness", "fair", "fairness", "judgment", "oppression", "peace"] },
  { slug: "wisdom", name: "wisdom and knowledge", terms: ["wisdom", "wise", "knowledge", "learning", "understanding", "truth"] },
  { slug: "mortality", name: "death and mortality", terms: ["death", "die", "dying", "mortality", "life", "impermanence", "end"] },
  { slug: "love", name: "love and devotion", terms: ["love", "loving", "devotion", "beloved", "friendship", "charity"] },
  { slug: "self-discipline", name: "desire and self-discipline", terms: ["desire", "discipline", "self-control", "passion", "temptation", "restraint", "ascetic"] },
  { slug: "ultimate-reality", name: "the divine and ultimate reality", terms: ["god", "divine", "dao", "logos", "ultimate", "eternal", "reality", "heaven"] },
  { slug: "suffering", name: "suffering and resilience", terms: ["suffering", "pain", "sorrow", "grief", "evil", "affliction", "dukkha", "resilience"] },
  { slug: "humility", name: "humility and pride", terms: ["humility", "humble", "meek", "pride", "status", "lowly", "water"] },
  { slug: "truth", name: "truthfulness and speech", terms: ["truth", "truthful", "sincere", "sincerity", "speech", "word", "light"] },
  { slug: "human-nature", name: "human nature", terms: ["human", "nature", "mind", "intention", "heart", "self", "person"] },
  { slug: "community", name: "community and responsibility", terms: ["community", "people", "tribes", "neighbour", "neighbor", "family", "friends", "peacemakers"] },
];

function conceptMatches(q: string) {
  const tokens = new Set(contentTerms(q));
  const norm = normalizeForSearch(q);
  const matched: { slug: string; name: string; terms: string[] }[] = [];
  for (const c of CONCEPTS) {
    const nameHit = c.name.split(/\s+/).some((w) => norm.includes(w) && w.length > 3);
    const termHit = c.terms.some((t) => tokens.has(t) || norm.includes(t));
    if (nameHit || termHit) matched.push(c);
  }
  if (matched.length === 0) {
    // The theme descriptions can rescue a question that uses different vocabulary.
    const db = getDb();
    const themes = db.query("SELECT slug, name, description, question FROM themes").all() as Row[];
    for (const t of themes) {
      const hay = normalizeForSearch(`${t.name} ${t.description} ${t.question}`);
      const hits = [...tokens].filter((tok) => tok.length > 3 && hay.includes(tok));
      if (hits.length >= 2) {
        const known = CONCEPTS.find((c) => c.slug === t.slug);
        matched.push({ slug: t.slug, name: t.name, terms: known?.terms ?? hits });
      }
    }
  }
  return matched.slice(0, 4);
}



function matchTermsFor(original: string, terms: string[]): string[] {
  const n = normalizeForSearch(original);
  return terms.filter((t) => n.includes(normalizeForSearch(t))).slice(0, 8);
}

type SearchRow = {
  passageId: number;
  editionId: number;
  rank: number;
  mode: string;
  terms: string[];
  concepts: { slug: string; name: string; terms: string[] }[];
};

// bm25 has to score every matching row before the best of them can be kept, and
// a term such as "God" matches 411,963 passages. The catalogue joins below
// exist only to answer the filters, so an unfiltered search runs without them:
// bm25(passage_fts) is a property of the row alone, and the ranking is the same
// (0.44s instead of 2.7s for that term).
function runFts(match: string, mode: string, params: URLSearchParams, terms: string[], concepts: any[], limit = 120): SearchRow[] {
  const db = getDb();
  const alias = { f: "f", p: "p", w: "w", t: "t", s: "s", e: "e", so: "so", li: "li" };
  const filters = filterSql(params, alias);
  const sql = `SELECT f.passage_id, f.edition_id, bm25(passage_fts) AS rank
    FROM passage_fts f ${filters.sql ? baseJoins(alias) : ""}
    WHERE passage_fts MATCH ?${filters.sql}
    ORDER BY rank LIMIT ?`;
  const rows = db.query(sql).all(match, ...filters.args, limit) as Row[];
  return rows.map((r) => ({ passageId: r.passage_id, editionId: r.edition_id, rank: r.rank, mode, terms, concepts }));
}

function runTrigram(match: string, mode: string, params: URLSearchParams, terms: string[], concepts: any[], limit = 120): SearchRow[] {
  const db = getDb();
  const alias = { f: "f", p: "p", w: "w", t: "t", s: "s", e: "e", so: "so", li: "li" };
  const filters = filterSql(params, alias);
  const sql = `SELECT f.passage_id, f.edition_id, bm25(passage_trigram) AS rank
    FROM passage_trigram f ${filters.sql ? baseJoins(alias) : ""}
    WHERE passage_trigram MATCH ?${filters.sql}
    ORDER BY rank LIMIT ?`;
  const rows = db.query(sql).all(match, ...filters.args, limit) as Row[];
  return rows.map((r) => ({ passageId: r.passage_id, editionId: r.edition_id, rank: r.rank, mode, terms, concepts }));
}

// The substring fallback answers "this word inside a longer word", which the
// word index cannot. It used to ask that question with LIKE, which reads every
// edition text in the corpus: 5.9s for a filtered miss, and up to a minute on a
// cold page cache. The trigram index holds the same text and answers the same
// question from its own index in about 0.45s, with the same hits. A trigram is
// three characters, so a term shorter than that has nothing to look up and
// keeps the scan.
function runSubstring(terms: string[], mode: string, params: URLSearchParams, concepts: any[], limit = 120): SearchRow[] {
  const db = getDb();
  const alias = { f: "f", p: "p", w: "w", t: "t", s: "s", e: "e", so: "so", li: "li" };
  const filters = filterSql(params, alias);
  const normalized = terms.map((t) => normalizeForSearch(t)).filter(Boolean);
  if (!normalized.length) return [];
  let rows: Row[];
  if (normalized.every((t) => t.length >= 3)) {
    const match = normalized.map((t) => `"${t.replaceAll('"', '""')}"`).join(" OR ");
    rows = db
      .query(
        `SELECT f.passage_id, f.edition_id, 0 AS rank
         FROM passage_trigram f ${filters.sql ? baseJoins(alias) : ""}
         WHERE passage_trigram MATCH ?${filters.sql} LIMIT ?`,
      )
      .all(match, ...filters.args, limit) as Row[];
  } else {
    const likeAlias = { ...alias, f: "pt" };
    const like = normalized.map(() => `pt.normalized_text LIKE ?`).join(" OR ");
    rows = db
      .query(
        `SELECT pt.passage_id, pt.edition_id, 0 AS rank
         FROM passage_texts pt ${filters.sql ? baseJoins(likeAlias) : ""}
         WHERE (${like})${filters.sql} LIMIT ?`,
      )
      .all(...normalized.map((t) => `%${t}%`), ...filters.args, limit) as Row[];
  }
  return rows.map((r) => ({ passageId: r.passage_id, editionId: r.edition_id, rank: 0, mode, terms, concepts }));
}

// Sefaria answers a live search in anywhere from half a second to twenty, and
// the library does not control that host. The local corpus and the indexed
// streamed editions are therefore answered on their own, and this section is
// asked for separately: the page renders its results while the host is still
// thinking, and the live hits fill in when they arrive.
export async function searchLive(params: URLSearchParams) {
  const q = (params.get("q") ?? "").trim();
  // A query the page itself refuses is not sent to the host either, so the live
  // section never lists something the search would not have run.
  const refused = !contentTerms(q).length && params.get("mode") !== "phrase" && !isCjk(q);
  if (!q || refused) return { streamed: null };
  return { streamed: await searchStreamed(q, 12) };
}

// The work filter is one slug; the select needs its label even when the list of
// every work has not been fetched yet.
function workFilterOption(params: URLSearchParams) {
  const slug = (params.get("work") ?? "").trim();
  if (!slug) return null;
  const row = getDb().query("SELECT slug, title FROM works WHERE slug = ?").get(slug) as Row | null;
  return row ? { value: row.slug, label: row.title } : null;
}

export async function search(params: URLSearchParams) {
  const db = getDb();
  const q = (params.get("q") ?? "").trim();
  const modeParam = params.get("mode") ?? "keyword";
  const mode = ["keyword", "phrase", "concept"].includes(modeParam) ? modeParam : "keyword";
  if (!q) {
    return {
      query: "", mode, terms: [], concepts: [], groups: [], works: [], total: 0, page: 1, pages: 0,
      facets: facets({ works: false }), workOption: workFilterOption(params), note: "",
    };
  }
  const streamScoped = Boolean(params.get("provider") || params.get("shelf"));
  const pageNumber = (value: string | null, fallback = 1) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback;
  };
  const page = pageNumber(params.get("page"));
  const streamPage = streamScoped ? page : pageNumber(params.get("streamPage"));
  const pageSize = 20;
  const normalized = normalizeForSearch(q);
  const terms = contentTerms(q);
  const concepts = mode === "concept" ? conceptMatches(q) : [];
  const expansions = concepts.flatMap((c) => c.terms);
  const allTerms = [...new Set([...terms, ...(mode === "concept" ? expansions : [])])];
  if (!allTerms.length && mode !== "phrase" && !isCjk(q)) {
    return {
      query: q,
      mode,
      terms: [],
      concepts,
      groups: [],
      works: [],
      streamed: null,
      streamIndex: null,
      total: 0,
      page: 1,
      pageSize: 20,
      pages: 0,
      facets: facets({ works: false }),
      workOption: workFilterOption(params),
      note: "Enter at least two characters, or use exact phrase mode for a one-character term.",
    };
  }

  let rows: SearchRow[] = [];
  let engineUsed = "";
  if (streamScoped) {
    // A provider or shelf filter belongs to the streamed index. Excluding the
    // local corpus and Sefaria live results keeps the counts and result list
    // honest about what the reader has actually selected.
    engineUsed = "streamed-text index";
  } else {
    if (mode === "phrase") {
      rows = runFts(`"${phraseFor(q, normalized).replaceAll('"', '""')}"`, "phrase", params, [q], []);
      engineUsed = "exact phrase";
    } else if (isCjk(q) && normalized.length >= 3) {
      rows = runTrigram(`"${normalized.replaceAll('"', '""')}"`, mode, params, allTerms, concepts);
      engineUsed = "CJK trigram index";
    } else if (mode === "concept") {
      const match = allTerms.map((t) => `"${t.replaceAll('"', '""')}"`).join(" OR ");
      rows = runFts(match, "concept", params, allTerms, concepts);
      engineUsed = "concept lexicon + full-text index";
    } else {
      const andMatch = terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(" AND ");
      if (terms.length > 1) rows = runFts(andMatch, "keyword", params, allTerms, []);
      if (rows.length === 0 && allTerms.length) {
        const match = allTerms.map((t) => `"${t.replaceAll('"', '""')}"`).join(" OR ");
        rows = runFts(match, "keyword", params, allTerms, []);
      }
      engineUsed = "full-text index";
    }

    // The CJK index carries every character and bigram, so a short CJK query is
    // an index lookup: scanning the corpus for it was 5.4s for one character.
    if (rows.length === 0 && !isCjk(q)) {
      rows = runSubstring(allTerms.length ? allTerms : [q], mode, params, concepts);
      if (rows.length) engineUsed = "substring fallback";
    }
  }

  // Keep the best-ranked edition for each canonical passage.
  const best = new Map<number, SearchRow>();
  for (const row of rows) {
    if (!best.has(row.passageId)) best.set(row.passageId, row);
  }
  const deduped = [...best.values()];
  const paged = deduped.slice((page - 1) * pageSize, page * pageSize);

  const results = paged.map((r) => {
    const detail = db
      .query(
        `SELECT p.id AS passage_id, p.reference, p.label, w.slug AS work_slug, w.title AS work_title,
                w.date_display, t.slug AS tradition_slug, t.name AS tradition_name, s.name AS school_name,
                e.slug AS edition_slug, e.title AS edition_title, e.edition_type, e.translator,
                e.publication_year, l.code AS language_code, l.name AS language_name, l.direction,
                pt.content AS content, so.name AS source_name, so.slug AS source_slug,
                li.name AS license_name, li.code AS license_code
         FROM passage_texts pt JOIN passages p ON p.id = pt.passage_id
         JOIN works w ON w.id = p.work_id JOIN traditions t ON t.id = w.tradition_id
         LEFT JOIN schools s ON s.id = w.school_id JOIN editions e ON e.id = pt.edition_id
         JOIN languages l ON l.code = e.language_code
         LEFT JOIN sources so ON so.id = e.source_id LEFT JOIN licenses li ON li.id = e.license_id
         WHERE pt.passage_id = ? AND pt.edition_id = ?`,
      )
      .get(r.passageId, r.editionId) as Row | null;
    if (!detail) return null;
    // A CJK query is searched as bigrams; the reader is shown the words typed.
    const matched = isCjk(q) ? [q] : matchTermsFor(detail.content, r.mode === "phrase" ? [q] : r.terms);
    const why =
      r.mode === "concept"
        ? `Retrieved by concept ${r.concepts.map((c) => c.name).join(", ") || "matching terms"} in the ${detail.language_name} ${detail.edition_type}.`
        : r.mode === "phrase"
          ? `Contains the exact phrase “${q}” in the ${detail.language_name} ${detail.edition_type}.`
          : `Matched ${matched.length ? matched.map((t) => `“${t}”`).join(", ") : "the query"} in the ${detail.language_name} ${detail.edition_type}.`;
    return {
      passageId: detail.passage_id,
      reference: detail.reference,
      label: detail.label,
      work: { slug: detail.work_slug, title: detail.work_title, dateDisplay: detail.date_display },
      tradition: { slug: detail.tradition_slug, name: detail.tradition_name },
      school: detail.school_name,
      edition: {
        slug: detail.edition_slug, title: detail.edition_title, editionType: detail.edition_type,
        translator: detail.translator, publicationYear: detail.publication_year,
        language: { code: detail.language_code, name: detail.language_name, direction: detail.direction },
        source: { slug: detail.source_slug, name: detail.source_name },
        license: { code: detail.license_code, name: detail.license_name },
      },
      snippet: excerpt(detail.content, matched.length ? matched : r.terms),
      matchedTerms: matched,
      why,
      retrieval: { mode: r.mode, terms: r.terms, concepts: r.concepts.map((c) => ({ slug: c.slug, name: c.name })), engine: engineUsed },
    };
  }).filter(Boolean) as any[];

  const groupsMap = new Map<string, { tradition: any; works: Map<string, any> }>();
  for (const r of results) {
    if (!groupsMap.has(r.tradition.slug)) groupsMap.set(r.tradition.slug, { tradition: r.tradition, works: new Map() });
    const g = groupsMap.get(r.tradition.slug)!;
    if (!g.works.has(r.work.slug)) g.works.set(r.work.slug, { work: r.work, results: [] });
    g.works.get(r.work.slug).results.push(r);
  }
  const groups = [...groupsMap.values()].map((g) => ({ tradition: g.tradition, works: [...g.works.values()] }));

  // Metadata matches: works, authors, traditions and schools.
  const like = `%${q}%`;
  const workRows: Row[] = streamScoped
    ? []
    : (db
        .query(
          `SELECT w.slug, w.title, t.name AS tradition, a.name AS author, w.date_display,
                  (SELECT COUNT(*) FROM passages p WHERE p.work_id = w.id) AS passages
           FROM works w JOIN traditions t ON t.id = w.tradition_id LEFT JOIN authors a ON a.id = w.author_id
           WHERE w.title LIKE ? OR w.original_title LIKE ? OR w.transliteration LIKE ? OR w.alt_titles_json LIKE ?
                 OR a.name LIKE ? OR t.name LIKE ? OR w.genre LIKE ?
           ORDER BY w.title LIMIT 8`,
        )
        .all(like, like, like, like, like, like, like) as Row[]);
  const workMatches = workRows.map((r) => ({ slug: r.slug, title: r.title, tradition: r.tradition, author: r.author, dateDisplay: r.date_display, passages: r.passages }));

  const total = deduped.length;
  // The indexed stream and locally held editions paginate independently. A
  // shelf/provider scope is stream-only, so the ordinary `page` parameter
  // controls it; an unscoped search uses `streamPage` and leaves local
  // pagination on `page`.
  const streamIndex = await searchStreamIndex(
    q,
    mode,
    params,
    allTerms.length ? allTerms : normalized ? [normalized] : [],
    { page: streamPage, pageSize },
  );
  return {
    query: q,
    mode,
    terms: allTerms,
    concepts,
    engine: engineUsed,
    groups,
    works: workMatches,
    // Text the library streams is searched at the host, by its own request (see
    // searchLive), so that a slow host cannot delay the results above. The page
    // reports the two sets separately so a live hit is never counted as local.
    streamed: null,
    streamIndex,
    total,
    page,
    pageSize,
    pages: Math.ceil(total / pageSize),
    facets: facets({ works: false }),
    workOption: workFilterOption(params),
    note: streamScoped
      ? "Results are limited to the selected indexed streamed shelf or provider. Locally held editions and Sefaria live results are not included."
      : mode === "concept"
        ? "Concept search uses a curated theme lexicon and the full-text index. It is not semantic vector search and does not treat similarity as equivalence."
        : isCjk(q) && normalized.length === 1
          ? "A one-character CJK query is answered from the character index: every passage containing that character, in any edition."
          : "",
  };
}
