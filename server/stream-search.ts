// Full-text search over streamed works.
//
// The provider's text is not stored. `stream_fts` holds the normalised search
// form, prefix variants and a short display excerpt, built by
// scripts/dev/index-streams.ts. Reading still happens at the host.
import { getDb } from "./db";
import { excerpt, normalizeForSearch, phraseFor } from "./text";
import { baseJoins, filterSql, type SearchAlias } from "./search-filters";
import { providerLabel } from "./stream";

type Row = Record<string, any>;

export type StreamIndexHit = {
  passageId: number;
  reference: string;
  label: string;
  work: { slug: string; title: string; dateDisplay: string };
  tradition: { slug: string; name: string };
  school: string | null;
  edition: {
    slug: string;
    title: string;
    editionType: string;
    translator: string;
    publicationYear: number | null;
    language: { code: string; name: string; direction: string };
    source: { slug: string | null; name: string | null };
    license: { code: string | null; name: string | null };
  };
  snippet: string;
  matchedTerms: string[];
  why: string;
  retrieval: { mode: string; terms: string[]; engine: string };
};

export type StreamIndexProvider = {
  provider: string;
  label: string;
  works: number;
  passages: number;
};

export type StreamShelfProvider = {
  provider: string;
  label: string;
  shortLabel: string;
};

export type StreamShelf = {
  slug: string;
  label: string;
  providers: StreamShelfProvider[];
};

export type StreamProviderCount = {
  provider: string;
  label: string;
  shortLabel: string;
  hits: number;
};

export type StreamIndexSearch = {
  available: boolean;
  hits: StreamIndexHit[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  note: string;
  providers: StreamIndexProvider[];
  providerCounts: StreamProviderCount[];
  shelves: StreamShelf[];
  stats: { works: number; passages: number; indexedAt: string; label: string };
};

const SHORT_PROVIDER_LABELS: Record<string, string> = {
  hadith: "Hadith API",
  "quran-tafsir": "Quran.com tafsir",
};

function shortProviderLabel(provider: string) {
  return SHORT_PROVIDER_LABELS[provider] ?? providerLabel(provider);
}

const COUNT_CACHE_LIMIT = 500;
const BROAD_TERM_MIN_HITS = 5_000;
// The ranked raw scan is useful only while it can still avoid reading the whole
// match set. Past this many rows the partition query is the safer choice.
const BROAD_RAW_ROW_LIMIT = 50_000;
let countCacheVersion = "";

function ensureCountCache(db: ReturnType<typeof getDb>, version: string) {
  db.run(
    `CREATE TABLE IF NOT EXISTS stream_count_cache (
       cache_key TEXT PRIMARY KEY,
       index_version TEXT NOT NULL,
       counts_json TEXT NOT NULL,
       created_at INTEGER NOT NULL
     )`,
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_stream_count_cache_version ON stream_count_cache(index_version, created_at)",
  );
  if (countCacheVersion !== version) {
    db.run("DELETE FROM stream_count_cache WHERE index_version <> ?", [version]);
    countCacheVersion = version;
  }
}

function countCacheKey(version: string, match: string, filters: { sql: string; args: any[] }) {
  // The match and filter SQL both matter: the same argument values can belong
  // to different filters, and those filters can produce different counts.
  return JSON.stringify([version, match, filters.sql, filters.args]);
}

function readCountCache(db: ReturnType<typeof getDb>, key: string) {
  const row = db.query("SELECT counts_json FROM stream_count_cache WHERE cache_key = ?").get(key) as
    | { counts_json: string }
    | null;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.counts_json);
    if (!Array.isArray(parsed)) return null;
    return new Map(parsed.map((entry) => [String(entry[0]), Number(entry[1])]));
  } catch {
    return null;
  }
}

function writeCountCache(
  db: ReturnType<typeof getDb>,
  key: string,
  version: string,
  counts: Map<string, number>,
) {
  db.run(
    "INSERT OR REPLACE INTO stream_count_cache (cache_key, index_version, counts_json, created_at) VALUES (?, ?, ?, ?)",
    [key, version, JSON.stringify([...counts.entries()]), Date.now()],
  );
  const total = (db.query("SELECT COUNT(*) AS n FROM stream_count_cache").get() as { n: number }).n;
  if (total > COUNT_CACHE_LIMIT) {
    db.run(
      `DELETE FROM stream_count_cache WHERE rowid NOT IN (
         SELECT rowid FROM stream_count_cache ORDER BY created_at DESC LIMIT ?
       )`,
      [COUNT_CACHE_LIMIT],
    );
  }
}

// A shelf is what the library presents to a reader; a provider is the host
// behind it. The Qur'an shelf deliberately spans two hosts so a reader can
// search the scripture and its commentaries together or separately.
const SHELF_DEFINITIONS: { slug: string; label: string; providers: string[] }[] = [
  { slug: "quran", label: "Qur'an and tafsir", providers: ["alquran-cloud", "quran-tafsir"] },
  { slug: "hadith", label: "Hadith", providers: ["hadith"] },
  { slug: "suttacentral", label: "SuttaCentral", providers: ["suttacentral"] },
  { slug: "openiti", label: "OpenITI", providers: ["openiti"] },
  { slug: "ctext", label: "Chinese Text Project", providers: ["ctext"] },
];

export const STREAM_SHELVES: StreamShelf[] = SHELF_DEFINITIONS.map((shelf) => ({
  ...shelf,
  providers: shelf.providers.map((provider) => ({
    provider,
    label: providerLabel(provider),
    shortLabel: shortProviderLabel(provider),
  })),
}));

type StreamMeta = {
  works: number;
  passages: number;
  indexedAt: string;
  providers: StreamIndexProvider[];
  label: string;
};

let metaCache: { at: number; value: StreamMeta } | null = null;

function listLabel(labels: string[]) {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

function indexMeta(db: ReturnType<typeof getDb>): StreamMeta {
  if (metaCache && Date.now() - metaCache.at < 60_000) return metaCache.value;
  const read = (key: string) =>
    (db.query("SELECT value FROM app_meta WHERE key = ?").get(key) as Row | null)?.value ?? "";
  const works = Number(read("stream_indexed_works") || 0);
  const passages = Number(read("stream_indexed_passages") || 0);
  let stored: { provider: string; works: number; passages: number }[] = [];
  try {
    const parsed = JSON.parse(read("stream_indexed_providers") || "[]");
    if (Array.isArray(parsed)) stored = parsed;
  } catch {
    stored = [];
  }
  // An index built before provider breakdowns were recorded is OpenITI-only.
  if (!stored.length && works > 0) stored = [{ provider: "openiti", works, passages }];
  const shelfOrder = ["openiti", "hadith", "alquran-cloud", "quran-tafsir", "suttacentral"];
  const providers = stored
    .map((entry) => ({
      provider: String(entry.provider),
      label: providerLabel(String(entry.provider)),
      works: Number(entry.works) || 0,
      passages: Number(entry.passages) || 0,
    }))
    .sort((a, b) => {
      const orderA = shelfOrder.indexOf(a.provider);
      const orderB = shelfOrder.indexOf(b.provider);
      return (orderA < 0 ? shelfOrder.length : orderA) - (orderB < 0 ? shelfOrder.length : orderB);
    });
  const value = {
    works,
    passages,
    indexedAt: read("stream_indexed_at"),
    providers,
    label: providers.length
      ? `${listLabel(providers.map((entry) => entry.label))} — ${works.toLocaleString()} works, ${passages.toLocaleString()} indexed passages`
      : "No streamed editions are indexed yet",
  };
  metaCache = { at: Date.now(), value };
  return value;
}

export async function searchStreamIndex(
  q: string,
  mode: string,
  params: URLSearchParams,
  terms: string[],
  options: { page?: number; pageSize?: number } = {},
): Promise<StreamIndexSearch> {
  const db = getDb();
  const meta = indexMeta(db);
  const pageSize = Math.min(50, Math.max(1, Math.floor(options.pageSize ?? 20)));
  const requestedPage = Math.max(1, Math.floor(options.page ?? 1));
  const emptyCounts: StreamProviderCount[] = meta.providers.map((provider) => ({
    provider: provider.provider,
    label: provider.label,
    shortLabel: shortProviderLabel(provider.provider),
    hits: 0,
  }));
  const empty: StreamIndexSearch = {
    available: meta.works > 0,
    hits: [],
    total: 0,
    page: requestedPage,
    pageSize,
    pages: 0,
    note:
      meta.works > 0
        ? "No indexed streamed passage matched this query."
        : "The streamed-text index has not been built. Run `bun run index:streams` to index streamed works.",
    providers: meta.providers,
    providerCounts: meta.works > 0 ? emptyCounts : [],
    shelves: meta.works > 0 ? STREAM_SHELVES : [],
    stats: { works: meta.works, passages: meta.passages, indexedAt: meta.indexedAt, label: meta.label },
  };
  if (!q.trim() || meta.works === 0) return empty;

  const normalized = normalizeForSearch(q);
  if (!normalized) return empty;
  const andMatch = terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(" AND ");
  const orMatch = terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(" OR ");
  const phraseMatch = `"${phraseFor(q, normalized).replaceAll('"', '""')}"`;
  const match =
    mode === "phrase" ? phraseMatch : mode === "concept" ? orMatch : terms.length > 1 ? andMatch : orMatch;
  if (!match) return empty;

  const alias: SearchAlias = { f: "sf", p: "p", w: "w", t: "t", s: "s", e: "e", so: "so", li: "li" };
  const filters = filterSql(params, alias);
  const engine = "streamed-text index";

  const indexedProviders = new Set(meta.providers.map((provider) => provider.provider));
  const shelfSlug = (params.get("shelf") ?? "").trim();
  const explicitProviders = (params.get("provider") ?? "")
    .split(",")
    .map((provider) => provider.trim())
    .filter(Boolean);
  let allowed = new Set(indexedProviders);
  if (shelfSlug) {
    const shelf = STREAM_SHELVES.find((candidate) => candidate.slug === shelfSlug);
    allowed = new Set(
      (shelf?.providers ?? [])
        .map((provider) => provider.provider)
        .filter((provider) => indexedProviders.has(provider)),
    );
  }
  if (explicitProviders.length) {
    allowed = new Set([...allowed].filter((provider) => explicitProviders.includes(provider)));
  }
  const filtered = Boolean(shelfSlug || explicitProviders.length);
  const allowedList = [...allowed];
  const providerArgs = filtered ? allowedList : [];
  const providerSql = !filtered
    ? ""
    : allowedList.length
      ? ` AND ws.provider IN (${allowedList.map(() => "?").join(", ")})`
      : " AND 0";

  // FTS can return several editions for one passage. Rank each passage once,
  // then page the distinct passages so a page always contains the requested
  // number of results rather than a varying number of duplicate editions.
  const queryRows = (needle: string, page: number) =>
    db
      .query(
        `SELECT passage_id, edition_id, excerpt, rank FROM (
           SELECT sf.passage_id, sf.edition_id, sf.excerpt, sf.rank AS rank, sf.rowid AS rowid,
                  ROW_NUMBER() OVER (PARTITION BY sf.passage_id ORDER BY sf.rank, sf.rowid) AS rn
           FROM stream_fts sf
           JOIN work_streams ws ON ws.work_slug = sf.work_slug
           ${baseJoins(alias)}
           WHERE stream_fts MATCH ?${filters.sql}${providerSql}
         ) WHERE rn = 1
         ORDER BY rank, rowid LIMIT ? OFFSET ?`,
      )
      .all(needle, ...filters.args, ...providerArgs, pageSize, (page - 1) * pageSize) as Row[];

  // A broad single term can match hundreds of thousands of raw editions. The
  // window query above partitions and sorts all of them just to find the first
  // twenty distinct passages. FTS can return rows in rank order cheaply, so the
  // broad-term path reads ranked ids in chunks, keeps the first edition of each
  // passage, and fetches excerpts only for the page it will display.
  const rawFrom = filters.sql
    ? `FROM stream_fts sf JOIN work_streams ws ON ws.work_slug = sf.work_slug ${baseJoins(alias)}`
    : filtered
      ? "FROM stream_fts sf JOIN work_streams ws ON ws.work_slug = sf.work_slug"
      : "FROM stream_fts sf";

  const queryRankedRows = (needle: string, limit: number) =>
    db
      .query(
        `SELECT sf.rowid AS rowid, sf.passage_id, sf.edition_id
         ${rawFrom}
         WHERE stream_fts MATCH ?${filters.sql}${providerSql}
         ORDER BY sf.rank, sf.rowid LIMIT ?`,
      )
      .all(needle, ...filters.args, ...providerArgs, limit) as Row[];

  const addExcerpts = (rows: Row[]) => {
    if (!rows.length) return rows;
    const excerpts = new Map(
      (
        db
          .query(
            `SELECT rowid, excerpt FROM stream_fts WHERE rowid IN (${rows.map(() => "?").join(", ")})`,
          )
          .all(...rows.map((row) => row.rowid)) as Row[]
      ).map((row) => [Number(row.rowid), String(row.excerpt ?? "")]),
    );
    return rows.map((row) => ({ ...row, excerpt: excerpts.get(Number(row.rowid)) ?? "" }));
  };

  const queryBroadPage = (needle: string, page: number): Row[] | null => {
    const offset = (page - 1) * pageSize;
    const needed = offset + pageSize;
    // Leave headroom for passages with more than one indexed edition. Deep
    // pages that cannot fit in the ranked windows should go straight to the
    // partition query rather than scanning the raw cap and then falling back.
    if (needed * 2 + 32 > BROAD_RAW_ROW_LIMIT) return null;
    let limit = Math.max(pageSize * 2 + 32, needed * 2 + 32);
    while (true) {
      const raw = queryRankedRows(needle, limit);
      const best = new Map<number, Row>();
      for (const row of raw) {
        if (!best.has(row.passage_id)) best.set(row.passage_id, row);
      }
      if (best.size >= needed || raw.length < limit) {
        return addExcerpts([...best.values()].slice(offset, offset + pageSize));
      }
      if (limit >= BROAD_RAW_ROW_LIMIT) return null;
      limit = Math.min(BROAD_RAW_ROW_LIMIT, limit * 2);
    }
  };

  const queryProviderCounts = (needle: string) => {
    const version = meta.indexedAt || `${meta.works}:${meta.passages}`;
    const key = countCacheKey(version, needle, filters);
    ensureCountCache(db, version);
    const cached = readCountCache(db, key);
    if (cached) return cached;

    let counts: Map<string, number>;
    // Without catalogue filters, count directly on the FTS table and attribute
    // each work to its provider. Avoiding four joins matters on common words
    // such as الله, which match hundreds of thousands of rows.
    if (!filters.sql) {
      const workProviders = new Map(
        (db.query("SELECT work_slug, provider FROM work_streams").all() as Row[]).map((row) => [
          String(row.work_slug),
          String(row.provider),
        ]),
      );
      counts = new Map<string, number>();
      for (const row of db
        .query(
          `SELECT work_slug, COUNT(DISTINCT passage_id) AS hits
           FROM stream_fts WHERE stream_fts MATCH ? GROUP BY work_slug`,
        )
        .all(needle) as Row[]) {
        const provider = workProviders.get(String(row.work_slug));
        if (!provider) continue;
        counts.set(provider, (counts.get(provider) ?? 0) + Number(row.hits));
      }
    } else {
      const rows = db
        .query(
          `SELECT ws.provider, COUNT(DISTINCT sf.passage_id) AS hits
           FROM stream_fts sf
           JOIN work_streams ws ON ws.work_slug = sf.work_slug
           ${baseJoins(alias)}
           WHERE stream_fts MATCH ?${filters.sql}
           GROUP BY ws.provider`,
        )
        .all(needle, ...filters.args) as Row[];
      counts = new Map(rows.map((row) => [String(row.provider), Number(row.hits)]));
    }
    writeCountCache(db, key, version, counts);
    return counts;
  };

  const scopedProviders = filtered
    ? allowedList
    : meta.providers.map((provider) => provider.provider);
  const totalFor = (counts: Map<string, number>) =>
    scopedProviders.reduce((sum, provider) => sum + (counts.get(provider) ?? 0), 0);

  let usedMatch = match;
  let countMap = queryProviderCounts(usedMatch);
  let total = totalFor(countMap);
  if (total === 0 && mode !== "phrase" && terms.length > 1) {
    usedMatch = terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(" OR ");
    countMap = queryProviderCounts(usedMatch);
    total = totalFor(countMap);
  }
  const providerCounts: StreamProviderCount[] = meta.providers.map((provider) => ({
    provider: provider.provider,
    label: provider.label,
    shortLabel: shortProviderLabel(provider.provider),
    hits: countMap.get(provider.provider) ?? 0,
  }));
  const pages = total > 0 ? Math.ceil(total / pageSize) : 0;
  const page = pages > 0 ? Math.min(pages, requestedPage) : 1;

  const broadPage =
    total >= BROAD_TERM_MIN_HITS && terms.length === 1 ? queryBroadPage(usedMatch, page) : null;
  const rows = total > 0 ? broadPage ?? queryRows(usedMatch, page) : [];
  const best = new Map<number, Row>();
  for (const row of rows) {
    if (!best.has(row.passage_id)) best.set(row.passage_id, row);
  }
  const deduped = [...best.values()];
  if (deduped.length === 0) {
    return { ...empty, available: true, total, page, pages, providerCounts };
  }

  const detail = db.query(
    `SELECT p.id AS passage_id, p.reference, p.label, w.slug AS work_slug, w.title AS work_title,
            w.date_display, t.slug AS tradition_slug, t.name AS tradition_name, s.name AS school_name,
            e.slug AS edition_slug, e.title AS edition_title, e.edition_type, e.translator,
            e.publication_year, l.code AS language_code, l.name AS language_name, l.direction,
            so.slug AS source_slug, so.name AS source_name, li.code AS license_code, li.name AS license_name
     FROM passages p JOIN works w ON w.id = p.work_id JOIN traditions t ON t.id = w.tradition_id
     LEFT JOIN schools s ON s.id = w.school_id JOIN editions e ON e.id = ?
     JOIN languages l ON l.code = e.language_code
     LEFT JOIN sources so ON so.id = e.source_id LEFT JOIN licenses li ON li.id = e.license_id
     WHERE p.id = ?`,
  );
  const hits: StreamIndexHit[] = [];
  for (const row of deduped) {
    const d = detail.get(row.edition_id, row.passage_id) as Row | null;
    if (!d) continue;
    const displayTerms = q.split(/\s+/).map((t) => t.trim()).filter((t) => t.length > 1).slice(0, 8);
    const matched = displayTerms.length ? displayTerms : terms;
    hits.push({
      passageId: d.passage_id,
      reference: d.reference,
      label: d.label,
      work: { slug: d.work_slug, title: d.work_title, dateDisplay: d.date_display },
      tradition: { slug: d.tradition_slug, name: d.tradition_name },
      school: d.school_name,
      edition: {
        slug: d.edition_slug,
        title: d.edition_title,
        editionType: d.edition_type,
        translator: d.translator,
        publicationYear: d.publication_year,
        language: { code: d.language_code, name: d.language_name, direction: d.direction },
        source: { slug: d.source_slug, name: d.source_name },
        license: { code: d.license_code, name: d.license_name },
      },
      snippet: excerpt(String(row.excerpt ?? ""), matched.length ? matched : terms),
      matchedTerms: matched,
      why: `Matched ${matched.length ? matched.map((t) => `“${t}”`).join(", ") : "the query"} in the ${d.language_name} edition, indexed for search and streamed from ${d.source_name ?? "its host"}.`,
      retrieval: {
        mode,
        terms: matched,
        engine,
      },
    });
  }

  return {
    ...empty,
    available: true,
    hits,
    total,
    page,
    pages,
    providerCounts,
  };
}
