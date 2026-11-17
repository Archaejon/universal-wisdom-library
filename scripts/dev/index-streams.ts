// Builds the full-text index for text that is streamed rather than stored.
//
// The reader still fetches an edition from its host. This script asks the same
// providers the reader uses, maps every segment to the passage index already in
// SQLite and writes only the normalised search form plus a short excerpt. It
// never writes the work's display text to the database.
//
//   bun run index:streams
//   bun run index:streams --only=hadith-bukhari
//   bun run index:streams --provider=hadith,quran,suttacentral
//   bun run index:streams --provider=suttacentral --concurrency=3
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDb, migrate } from "../../server/db";
import { openitiChapters, parseOpeniti } from "../../server/openiti";
import {
  TAFSIR_GAP_MARKER,
  clearStreamCache,
  getStreamChapter,
  providerLabel,
  type StreamWork,
} from "../../server/stream";
import { indexText } from "../../server/text";

const ROOT = join(import.meta.dir, "..", "..");
const STREAMS = join(ROOT, "data", "registry", "streams.json");
const USER_AGENT = "UniversalWisdomLibrary/1.0 (local reading interface; search index)";

type Row = Record<string, any>;
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? "";

const only = arg("only");
const providerFilter = arg("provider")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const concurrency = Math.max(1, Math.min(12, Number(arg("concurrency") || 6) || 6));
// A host that rate-limits anonymous clients (Wikisource) can need one request
// at a time with a gap between them, rather than three fast retries.
const paceMs = Math.max(0, Number(arg("pace") || 0) || 0);

// Provider groups keep the command readable: `quran` covers the Qur'an text and
// the Qur'an.com tafsir resources because they occupy one shelf in the library.
const PROVIDER_GROUPS: Record<string, string[]> = {
  quran: ["alquran-cloud", "quran-tafsir"],
};

const SUPPORTED = new Set<string>([
  "openiti",
  "hadith",
  "alquran-cloud",
  "quran-tafsir",
  "suttacentral",
  "gutenberg",
  "wikisource",
  "sacred-texts",
  "gretil",
  "bahai",
  "ctext",
  "sacred-texts-json",
]);
// Heritage serves its verses only to a key that Heritage IITKanpur issues on
// request, and meters them against a small daily allowance. Without a key there
// is nothing to index, so the shelf joins the run only when one is set.
if ((process.env.HERITAGE_API_KEY ?? "").trim()) SUPPORTED.add("heritage");
const IMPORT_CACHES = [
  join(ROOT, "data", "imports", "cache", "sacred-texts"),
  join(ROOT, "data", "imports", "cache", "hindu"),
  join(ROOT, "data", "imports", "cache", "gretil"),
  join(ROOT, "data", "imports", "cache", "bahai"),
  join(ROOT, "data", "imports", "cache", "ctext"),
  join(ROOT, "data", "imports", "cache", "wikisource-shinto"),
  join(ROOT, "data", "imports", "cache", "sacred-texts-json"),
];

function providerMatches(provider: string) {
  if (!providerFilter.length) return true;
  return providerFilter.some(
    (filter) => filter === provider || (PROVIDER_GROUPS[filter] ?? []).includes(provider),
  );
}

async function getText(url: string): Promise<string> {
  let last: Error | null = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "text/plain", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(180_000),
      });
      if (res.status === 404) throw new Error(`${url} returned 404`);
      if (res.status === 429 || res.status >= 500) {
        last = new Error(`${url} returned ${res.status}`);
        await Bun.sleep(1200 * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      return await res.text();
    } catch (err) {
      last = err as Error;
      if (attempt < 4) await Bun.sleep(600 * attempt);
    }
  }
  throw last ?? new Error(`${url} failed`);
}

/** Run async work with a small concurrency cap while preserving input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

type IndexRow = {
  passageId: number;
  editionId: number;
  workSlug: string;
  language: string;
  reference: string;
  text: string;
  variants: string;
  excerpt: string;
};

function indexInsert(db: ReturnType<typeof getDb>) {
  return db.query(
    "INSERT INTO stream_fts (passage_id, edition_id, work_slug, language, reference, text, variants, excerpt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
}

function writeWork(db: ReturnType<typeof getDb>, slug: string, rows: IndexRow[]) {
  const insert = indexInsert(db);
  const load = db.transaction(() => {
    db.query("DELETE FROM stream_fts WHERE work_slug = ?").run(slug);
    for (const row of rows) {
      insert.run(
        row.passageId,
        row.editionId,
        row.workSlug,
        row.language,
        row.reference,
        row.text,
        row.variants,
        row.excerpt,
      );
    }
  });
  load();
}

function excerptOf(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 320);
}

// An import records the exact segments it validated, chapter by chapter.
// Indexing from that cache keeps search aligned with the reviewed text and
// avoids a second crawl of the host. If a work has no cache (the older
// Gutenberg and Wikisource shelf), the network path below is used unchanged.
// Several providers can hold a cache for the same slug when a work changed
// hands, and their outlines differ, so the cache of the provider the registry
// now streams from is the one that must be read.
function importCachePath(slug: string, provider = ""): string | null {
  let fallback: string | null = null;
  for (const dir of IMPORT_CACHES) {
    const path = join(dir, `${slug}.json`);
    if (!existsSync(path)) continue;
    fallback ??= path;
    if (provider && (readJson(path) as { provider?: string }).provider === provider) return path;
  }
  return fallback;
}

function indexCachedWork(
  db: ReturnType<typeof getDb>,
  slug: string,
  provider: string,
): { passages: number; words: number; skipped: number; unaligned: number } {
  const cache = readJson(importCachePath(slug, provider)!) as {
    chapters: { ref: string; label: string; segments: string[] }[];
  };
  if (!Array.isArray(cache.chapters) || !cache.chapters.length) {
    throw new Error("the import cache has no chapters");
  }
  const editionSlug = db
    .query("SELECT e.slug FROM editions e JOIN works w ON w.id = e.work_id WHERE w.slug = ? ORDER BY e.id LIMIT 1")
    .get(slug) as Row | null;
  if (!editionSlug) throw new Error("the work has no edition in the database; run db:reset first");
  const edition = db.query("SELECT id, language_code FROM editions WHERE slug = ?").get(editionSlug.slug) as Row;
  const passageRows = db
    .query(
      "SELECT p.id, p.reference, p.chapter_ref FROM passages p JOIN works w ON w.id = p.work_id WHERE w.slug = ? ORDER BY p.sort_order",
    )
    .all(slug) as Row[];
  const byChapter = new Map<string, Row[]>();
  for (const passage of passageRows) {
    const key = String(passage.chapter_ref ?? "1");
    if (!byChapter.has(key)) byChapter.set(key, []);
    byChapter.get(key)!.push(passage);
  }
  if (byChapter.size !== cache.chapters.length) {
    throw new Error(
      `the cache holds ${cache.chapters.length} chapters but the catalogue has ${byChapter.size}`,
    );
  }

  const rows: IndexRow[] = [];
  let words = 0;
  let skipped = 0;
  for (const chapter of cache.chapters) {
    const passageGroup = byChapter.get(String(chapter.ref));
    if (!passageGroup) throw new Error(`chapter ${chapter.ref} has no passages in the corpus`);
    if (passageGroup.length !== chapter.segments.length) {
      throw new Error(
        `chapter ${chapter.ref} has ${chapter.segments.length} cached segments but ${passageGroup.length} indexed passages`,
      );
    }
    for (const [index, passage] of passageGroup.entries()) {
      const segment = chapter.segments[index] ?? "";
      const indexed = indexText(segment, String(edition.language_code));
      if (!indexed.text) {
        skipped++;
        continue;
      }
      rows.push({
        passageId: passage.id,
        editionId: edition.id,
        workSlug: slug,
        language: String(edition.language_code),
        reference: String(passage.reference),
        text: indexed.text,
        variants: indexed.variants,
        excerpt: excerptOf(segment),
      });
      words += segment.split(/\s+/).filter(Boolean).length;
    }
  }
  if (!rows.length) throw new Error("the import cache yielded no usable search text");
  writeWork(db, slug, rows);
  return { passages: new Set(rows.map((row) => row.passageId)).size, words, skipped, unaligned: 0 };
}

// OpenITI publishes one whole-work mARkdown file. Fetching it once and parsing
// it with the reader's own grouping rule is much cheaper than one request per
// chapter, so this provider keeps its dedicated path.
async function indexOpeniti(
  db: ReturnType<typeof getDb>,
  slug: string,
  spec: Row,
): Promise<{ passages: number; words: number; skipped: number; unaligned: number }> {
  const config = spec.config ?? {};
  const textUrl = String(config.textUrl ?? "");
  const rule = config.chapter;
  if (!textUrl || !rule) throw new Error("no text URL or chapter rule");

  const chapters = openitiChapters(parseOpeniti(await getText(textUrl)), rule);
  if (!chapters.length) throw new Error("the provider returned no chapters");

  const editionSlug = spec.editions?.[0]?.slug;
  const edition = db.query("SELECT id, language_code FROM editions WHERE slug = ?").get(editionSlug) as Row | null;
  if (!edition) throw new Error(`edition ${editionSlug} is not in the database; run db:reset first`);
  const passageRows = db
    .query(
      "SELECT p.id, p.reference, p.chapter_ref FROM passages p JOIN works w ON w.id = p.work_id WHERE w.slug = ? ORDER BY p.sort_order",
    )
    .all(slug) as Row[];
  const passagesByChapter = new Map<string, Row[]>();
  for (const p of passageRows) {
    const key = String(p.chapter_ref ?? "");
    if (!passagesByChapter.has(key)) passagesByChapter.set(key, []);
    passagesByChapter.get(key)!.push(p);
  }

  const rows: IndexRow[] = [];
  let words = 0;
  let skipped = 0;
  let unaligned = 0;
  for (const [i, chapter] of chapters.entries()) {
    const chapterRef = String(i + 1);
    const passageGroup = passagesByChapter.get(chapterRef);
    if (!passageGroup) throw new Error(`chapter ${chapterRef} has no passages in the corpus`);
    if (passageGroup.length !== chapter.paragraphs.length) {
      unaligned++;
      throw new Error(
        `chapter ${chapterRef} has ${chapter.paragraphs.length} paragraphs but ${passageGroup.length} indexed passages`,
      );
    }
    for (const [j, paragraph] of chapter.paragraphs.entries()) {
      const passage = passageGroup[j]!;
      const indexed = indexText(paragraph, edition.language_code as string);
      if (!indexed.text) {
        skipped++;
        continue;
      }
      rows.push({
        passageId: passage.id,
        editionId: edition.id,
        workSlug: slug,
        language: String(edition.language_code),
        reference: String(passage.reference),
        text: indexed.text,
        variants: indexed.variants,
        excerpt: excerptOf(paragraph),
      });
      words += paragraph.split(/\s+/).filter(Boolean).length;
    }
  }
  writeWork(db, slug, rows);
  return { passages: rows.length, words, skipped, unaligned };
}

// Every other indexed provider exposes one chapter per request. Calling the
// reader's entry point keeps the index aligned with what a reader actually
// sees, including provider fallbacks and bilingual editions.
async function indexHostedWork(
  db: ReturnType<typeof getDb>,
  slug: string,
  spec: Row,
): Promise<{ passages: number; words: number; skipped: number; unaligned: number }> {
  const editionRows = new Map<string, Row>();
  for (const row of db
    .query("SELECT id, slug, language_code FROM editions WHERE work_id = (SELECT id FROM works WHERE slug = ?)")
    .all(slug) as Row[]) {
    editionRows.set(String(row.slug), row);
  }
  if (!editionRows.size) throw new Error("the work has no editions in the database; run db:reset first");

  const passages = db
    .query(
      "SELECT p.id, p.reference, p.label, p.chapter_ref FROM passages p JOIN works w ON w.id = p.work_id WHERE w.slug = ? ORDER BY p.sort_order",
    )
    .all(slug) as Row[];
  if (!passages.length) throw new Error("the work has no passages in the database");

  const byChapter = new Map<string, Row[]>();
  for (const passage of passages) {
    const key = String(passage.chapter_ref ?? "1");
    if (!byChapter.has(key)) byChapter.set(key, []);
    byChapter.get(key)!.push(passage);
  }
  const chapters = [...byChapter.entries()];

  const editionSlugs: string[] = (spec.editions ?? []).map((edition: { slug: string }) =>
    String(edition.slug),
  );
  const incomplete = (result: Awaited<ReturnType<typeof getStreamChapter>>) => {
    if (!result) return true;
    return editionSlugs.some((editionSlug) => {
      const streamed = result.editions.find((edition) => edition.slug === editionSlug);
      return !streamed || streamed.segments.length === 0;
    });
  };

  const fetched = await mapLimit(chapters, concurrency, async ([ref, rows]) => {
    let result: Awaited<ReturnType<typeof getStreamChapter>> = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      // A provider can rate-limit one of a chapter's editions while returning
      // the other. Retry an incomplete chapter instead of silently indexing a
      // bilingual work with one language missing.
      if (attempt > 1) clearStreamCache();
      result = await getStreamChapter(
        slug,
        { ref, label: `Chapter ${ref}`, labels: rows.map((row) => String(row.label)) },
        rows.length,
      );
      if (!incomplete(result)) break;
      if (attempt < 3) await Bun.sleep(500 * attempt);
    }
    if (paceMs) await Bun.sleep(paceMs);
    return { ref, rows, result };
  });

  const rows: IndexRow[] = [];
  let words = 0;
  let skipped = 0;
  let unaligned = 0;
  for (const { ref, rows: passageGroup, result } of fetched) {
    if (!result) throw new Error(`the provider returned no text for chapter ${ref}`);
    if (!result.aligned) unaligned++;
    for (const editionSpec of spec.editions ?? []) {
      const edition = editionRows.get(String(editionSpec.slug));
      const streamed = result.editions.find((candidate) => candidate.slug === editionSpec.slug);
      if (!edition || !streamed) continue;
      for (const [index, passage] of passageGroup.entries()) {
        const segment = streamed.segments[index];
        // Quran.com marks ayahs without commentary with a sentence addressed
        // to the reader. It is page furniture, not the commentator's text.
        if (!segment || segment.startsWith(TAFSIR_GAP_MARKER)) {
          skipped++;
          continue;
        }
        const indexed = indexText(segment, String(edition.language_code));
        if (!indexed.text) {
          skipped++;
          continue;
        }
        rows.push({
          passageId: passage.id,
          editionId: edition.id,
          workSlug: slug,
          language: String(edition.language_code),
          reference: String(passage.reference),
          text: indexed.text,
          variants: indexed.variants,
          excerpt: excerptOf(segment),
        });
        words += segment.split(/\s+/).filter(Boolean).length;
      }
    }
  }
  if (!rows.length) throw new Error("the provider returned no usable search text");
  writeWork(db, slug, rows);
  return { passages: new Set(rows.map((row) => row.passageId)).size, words, skipped, unaligned };
}

migrate();
const db = getDb();
const streams = readJson(STREAMS) as { works: Record<string, StreamWork> };
const candidates = Object.entries(streams.works).filter(
  ([slug, spec]) =>
    (!only || slug === only) &&
    SUPPORTED.has(String(spec.provider)) &&
    providerMatches(String(spec.provider)),
);
if (!candidates.length) {
  console.error(
    only
      ? `No indexable streamed work matches ${only}.`
      : `No indexable streamed works match ${providerFilter.join(", ") || "the supported providers"}.`,
  );
  if (!(process.env.HERITAGE_API_KEY ?? "").trim() && (!providerFilter.length || providerFilter.includes("heritage"))) {
    console.error(
      "The Heritage Scripture Server shelf is left out: its verses are served only to a key that Heritage IITKanpur issues on request. Set HERITAGE_API_KEY to index it.",
    );
  }
  process.exit(1);
}

console.log(
  `Indexing ${candidates.length} streamed work(s) from ${[
    ...new Set(candidates.map(([, spec]) => providerLabel(String(spec.provider)))),
  ].join(", ")}…`,
);
let works = 0;
let passages = 0;
let skipped = 0;
const failures: { slug: string; error: string }[] = [];
for (const [slug, spec] of candidates) {
  const started = Date.now();
  try {
    const cached =
      (        spec.provider === "gutenberg" ||
        spec.provider === "wikisource" ||
        spec.provider === "sacred-texts" ||
        spec.provider === "sacred-texts-json" ||
        spec.provider === "gretil" ||
        spec.provider === "bahai" ||
        spec.provider === "ctext") &&
      importCachePath(slug, spec.provider) !== null;
    const result =
      spec.provider === "openiti"
        ? await indexOpeniti(db, slug, spec)
        : cached
          ? indexCachedWork(db, slug, spec.provider)
          : await indexHostedWork(db, slug, spec);
    works++;
    passages += result.passages;
    skipped += result.skipped;
    const notes = [
      `${result.passages} passages`,
      `${result.words} words`,
      result.skipped ? `${result.skipped} empty segments` : "",
      result.unaligned ? `${result.unaligned} unaligned chapter(s)` : "",
    ].filter(Boolean);
    console.log(`  ${slug}: ${notes.join(", ")} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (err) {
    const error = (err as Error).message;
    failures.push({ slug, error });
    console.error(`  ${slug}: ${error}`);
  }
}

const now = new Date().toISOString();
const totals = db
  .query(
    `SELECT COUNT(DISTINCT passage_id) AS passages, COUNT(DISTINCT work_slug) AS works,
            SUM(LENGTH(text) - LENGTH(REPLACE(text, ' ', '')) + 1) AS words
     FROM stream_fts`,
  )
  .get() as Row;
const providerRows = db
  .query(
    `SELECT ws.provider, COUNT(DISTINCT sf.work_slug) AS works, COUNT(DISTINCT sf.passage_id) AS passages
     FROM stream_fts sf JOIN work_streams ws ON ws.work_slug = sf.work_slug
     GROUP BY ws.provider
     ORDER BY ws.provider`,
  )
  .all() as Row[];
const providerStats = providerRows.map((row) => ({
  provider: row.provider,
  works: Number(row.works),
  passages: Number(row.passages),
}));
db.query("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)").run("stream_indexed_at", now);
db.query("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)").run("stream_indexed_works", String(totals.works));
db.query("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)").run(
  "stream_indexed_passages",
  String(totals.passages),
);
db.query("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)").run("stream_indexed_words", String(totals.words));
db.query("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)").run(
  "stream_indexed_providers",
  JSON.stringify(providerStats),
);
console.log(
  `Indexed ${works} work(s), ${passages} passage(s) in this run; ${skipped} empty segment(s) skipped. ` +
    `The index now holds ${totals.works} work(s), ${totals.passages} passages.`,
);
if (failures.length) {
  console.error(`${failures.length} work(s) could not be indexed.`);
  process.exit(1);
}
db.close();
