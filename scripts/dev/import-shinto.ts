// Adds the Shinto shelf: the Kojiki in Basil Hall Chamberlain's 1882
// translation and the Nihongi (Nihon Shoki) in W. G. Aston's 1896 translation.
//
// Both volumes are transcribed page by page on Wikisource, one printed section
// or book per page, so the chapter outline follows the printed divisions and
// the reader fetches only the page it needs. As with the other streamed
// shelves, only the catalogue record, chapter outline and passage index are
// written here; the text stays with Wikisource.
//
// The reviewed page segments are cached under
// data/imports/cache/wikisource-shinto/<slug>/<page>.json, one file per page,
// so an interrupted run resumes where it stopped and the counts of that cache
// are what the passage index is built from.
//
//   bun run scripts/dev/import-shinto.ts
//   bun run scripts/dev/import-shinto.ts --only=kojiki
//   bun run scripts/dev/import-shinto.ts --force
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractWikisourceSegments } from "../../server/stream";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");
const STREAMS = join(ROOT, "data", "registry", "streams.json");
const FUNCTIONS = join(ROOT, "data", "corpus", "text-functions.json");
const MANIFEST = join(ROOT, "data", "imports", "shinto.json");
const CACHE = join(ROOT, "data", "imports", "cache", "wikisource-shinto");
const RETRIEVED_AT = new Date().toISOString().slice(0, 10);
const USER_AGENT = "UniversalWisdomLibrary/1.0 (local reading interface; Shinto import)";
const API = "https://en.wikisource.org/w/api.php";

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.split("=").slice(1).join("=") ?? "";
const force = args.includes("--force");
const concurrency = Math.max(1, Math.min(6, Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? 3) || 3));

type Row = Record<string, any>;
type Chapter = { ref: string; label: string };
type Passage = { reference: string; label: string; chapterRef: string };
type CachedPage = { title: string; url: string; label: string; segments: string[]; headingIndex?: number };

type Spec = {
  slug: string;
  title: string;
  originalTitle: string;
  transliteration: string;
  altTitles: string[];
  school: string;
  genre: string;
  textType: string;
  category: string;
  subcategory: string;
  originalLanguage: string;
  dateStart: number;
  dateEnd: number;
  dateDisplay: string;
  authorshipStatus: string;
  author: string | null;
  attributionNote: string;
  description: string;
  historicalContext: string;
  availabilityNote: string;
  translator: string;
  translationTitle: string;
  translationYear: number;
  publisher: string;
  editionNotes: string;
  editionSlug: string;
  /** Wikisource subpage prefix, e.g. "Nihongi/Book ". */
  prefix: string;
  /** Keep only the pages that carry the work's running text. */
  include: RegExp;
  /** Printed order of the pages that pass `include`. */
  order: (title: string) => number;
  /** Chapter label, from the page title rather than the page's own heading. */
  label: (title: string) => string;
  /**
   * Printed heading that opens the page. It is the chapter title the reader
   * already sees above the text, so it is not repeated as a paragraph; the
   * same pattern is stored with the work and applied at read time. A page can
   * also open with a volume marker, so the heading is looked for in the first
   * couple of segments.
   */
  heading?: { match: RegExp; label: (heading: string, fallback: string) => string; trimStartPattern: string };
  /** A printed page header (publisher, pages) that precedes the text proper. */
  trimStartPattern?: string;
  functions: string[];
  functionNote: string;
};

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

function romanValue(value: string): number {
  let total = 0;
  for (let i = 0; i < value.length; i++) {
    const current = ROMAN[value[i]!] ?? 0;
    const next = ROMAN[value[i + 1]!] ?? 0;
    total += current < next ? -current : current;
  }
  return total;
}

// «[ Sect. XLIV.—The Palace of the Ocean-Possessor.]» prints the section number
// in roman and the story title after a rule. Three pages of the transcription
// omit the opening bracket, so it is optional here.
const KOJIKI_HEADING = /^\[?\s*Sect\.\s*([IVXLCDM]+)[\s.—–-]*(.*?)\s*\.?\s*\]?\s*$/;

function kojikiLabel(heading: string, fallback: string): string {
  const match = KOJIKI_HEADING.exec(heading);
  if (!match) return fallback;
  const title = match[2]!.replace(/\.$/, "").trim();
  return title ? `Section ${match[1]} — ${title}` : `Section ${match[1]}`;
}

/**
 * The opening heading of a page, which the reader does not repeat as text.
 * A page that starts a volume prints its marker first ("Vol. II.[1]"), so the
 * heading can sit one segment further in.
 */
function findHeading(segments: string[], match: RegExp, scan = 2): { index: number; text: string } | null {
  for (const [index, segment] of segments.slice(0, scan).entries()) {
    if (match.test(segment)) return { index, text: segment };
  }
  return null;
}

const SPECS: Spec[] = [
  {
    slug: "kojiki",
    title: "Kojiki",
    originalTitle: "古事記",
    transliteration: "Kojiki",
    altTitles: ["Records of Ancient Matters", "Furukoto Fumi"],
    school: "shinto",
    genre: "Chronicle",
    textType: "Myth and dynastic history",
    category: "Chronicle",
    subcategory: "Myth and dynastic history",
    originalLanguage: "ja",
    dateStart: 712,
    dateEnd: 712,
    dateDisplay: "712 CE",
    authorshipStatus: "established",
    author: "ono-yasumaro",
    attributionNote:
      "Compiled by Ō no Yasumaro in 712 CE at imperial command, drawing on earlier oral and written traditions. The compiler is historically established; the underlying myths are traditional.",
    description:
      "Japan's oldest surviving chronicle, in three books: the age of the kami from the first deities through the creation of the islands, the descent of the heavenly grandchild and the founding of the imperial line, and the reigns of the early emperors down to 628 CE. Chamberlain's translation prints the work in 180 numbered sections.",
    historicalContext:
      "The Kojiki was compiled in the Nara period as part of the state's consolidation of myth, genealogy and legitimacy, and was presented to the court in 712. Long studied as a philological monument of the Japanese language, it became central to Shinto and to later Japanese nationalism.",
    availabilityNote:
      "Streamed from Wikisource section by section at read time. Chamberlain's 1882 translation is public domain; the classical Japanese and Chinese source text is not included.",
    translator: "Basil Hall Chamberlain",
    translationTitle: "Kojiki: Records of Ancient Matters",
    translationYear: 1882,
    publisher: "Asiatic Society of Japan; Wikisource",
    editionNotes:
      "Chamberlain's 1882 translation, the first complete English rendering, keeps his romanisation and his archaic register. His brackets mark words supplied for English syntax, and the translator's footnotes stand on the page as printed.",
    editionSlug: "kojiki-en-chamberlain",
    prefix: "Kojiki (Chamberlain, 1882)/Section ",
    include: /^Kojiki \(Chamberlain, 1882\)\/Section (\d+)$/,
    order: (title) => Number(/(\d+)$/.exec(title)?.[1] ?? 0),
    label: (title) => `Section ${/(\d+)$/.exec(title)?.[1] ?? ""}`,
    heading: {
      match: KOJIKI_HEADING,
      label: kojikiLabel,
      // A volume marker opens three of the pages and is not part of the text
      // either.
      trimStartPattern: "^\\[?\\s*(?:Vol\\.\\s+[IVXLCDM]+\\.?|Sect\\.)",
    },
    functions: ["historical_document", "non_canonical_religious_text"],
    functionNote:
      "Kojiki — a court chronicle of myth and dynastic history. Shinto has no closed canon, so the chronicle is catalogued as a religiously authoritative historical document rather than as scripture.",
  },
  {
    slug: "nihongi",
    title: "Nihongi",
    originalTitle: "日本書紀",
    transliteration: "Nihon Shoki",
    altTitles: ["Nihon Shoki", "Chronicles of Japan"],
    school: "shinto",
    genre: "Chronicle",
    textType: "Myth and dynastic history",
    category: "Chronicle",
    subcategory: "Myth and dynastic history",
    originalLanguage: "ja",
    dateStart: 720,
    dateEnd: 720,
    dateDisplay: "720 CE",
    authorshipStatus: "established",
    author: null,
    attributionNote:
      "Completed in 720 CE under imperial commission, with Prince Toneri among its chief editors and Ō no Yasumaro among the compilers. The work is a court compilation rather than the book of a single author, so no single author is recorded.",
    description:
      "The Nihon Shoki, completed eight years after the Kojiki, is the first of the six national histories. In thirty books it covers the age of the gods and then the reigns from Jimmu to the abdication of Empress Suiko in 628, quoting variant traditions side by side and drawing on continental chronicles for its dating.",
    historicalContext:
      "Written in classical Chinese at the court's command, the Nihongi was meant to stand beside the Kojiki as the official record of the realm's origins. Its reign-by-reign annalistic form, its variant readings ('in one writing it is said') and its use of Chinese chronological models make it both a religious and a historiographical document.",
    availabilityNote:
      "Streamed from Wikisource book by book at read time. Aston's 1896 translation is public domain; the classical Chinese text is not included.",
    translator: "William George Aston",
    translationTitle: "Nihongi: Chronicles of Japan from the Earliest Times to A.D. 697",
    translationYear: 1896,
    publisher: "Japan Society; Wikisource",
    editionNotes:
      "Aston's 1896 translation for the Japan Society, with his introductions, notes and appendices; this shelf carries the thirty books of the chronicle itself. Square brackets mark his supplied words.",
    editionSlug: "nihongi-en-aston",
    prefix: "Nihongi/Book ",
    include: /^Nihongi\/Book ([IVXLCDM]+)$/,
    order: (title) => romanValue(/([IVXLCDM]+)$/.exec(title)?.[1] ?? ""),
    label: (title) => `Book ${/([IVXLCDM]+)$/.exec(title)?.[1] ?? ""}`,
    trimStartPattern: "^Pub\\. for the Society",
    functions: ["historical_document", "non_canonical_religious_text"],
    functionNote:
      "Nihongi — the court's annalistic history from the age of the gods to 628 CE. Catalogued as a religiously authoritative historical document; Shinto has no closed canon of scripture.",
  },
];

// ---------------------------------------------------------------------------
// Fetch and cache
// ---------------------------------------------------------------------------

async function getText(url: string, timeoutMs = 60_000): Promise<string> {
  let last: Error | null = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429) {
        last = new Error(`${url} returned 429`);
        await Bun.sleep(4_000 * attempt);
        continue;
      }
      if (res.status >= 500) {
        last = new Error(`${url} returned ${res.status}`);
        await Bun.sleep(700 * attempt * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      return await res.text();
    } catch (err) {
      last = err as Error;
      if (attempt < 5) await Bun.sleep(400 * attempt);
    }
  }
  throw last ?? new Error(`${url} failed`);
}

async function subpages(prefix: string): Promise<string[]> {
  const out: string[] = [];
  let cont = "";
  for (let page = 0; page < 6; page++) {
    const params: Record<string, string> = {
      action: "query",
      list: "allpages",
      apprefix: prefix,
      aplimit: "500",
      apnamespace: "0",
      format: "json",
      formatversion: "2",
    };
    if (cont) params.apcontinue = cont;
    const data = JSON.parse(await getText(`${API}?${new URLSearchParams(params)}`));
    for (const entry of data?.query?.allpages ?? []) out.push(String(entry.title));
    cont = data?.continue?.apcontinue ?? "";
    if (!cont) break;
  }
  return out;
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return out;
}

function pageUrl(title: string) {
  return `https://en.wikisource.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`;
}

function labelFor(spec: Spec, segments: string[], title: string): string {
  const fallback = spec.label(title);
  if (!spec.heading) return fallback;
  const heading = findHeading(segments, spec.heading.match);
  return heading ? spec.heading.label(heading.text, fallback) : fallback;
}

function trimLeading(segments: string[], pattern?: string): string[] {
  if (!pattern) return segments;
  const trim = new RegExp(pattern, "i");
  const out = [...segments];
  while (out.length && trim.test(out[0]!)) out.shift();
  return out;
}

function pageCachePath(slug: string, title: string) {
  return join(CACHE, slug, `${title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}.json`);
}

async function loadWorkPages(spec: Spec): Promise<CachedPage[]> {
  const titles = (await subpages(spec.prefix))
    .filter((title) => spec.include.test(title))
    .sort((a, b) => spec.order(a) - spec.order(b));
  if (!titles.length) throw new Error(`${spec.title}: no pages found under ${spec.prefix}`);
  console.log(`  ${spec.title}: ${titles.length} pages in ${spec.prefix}`);

  const dir = join(CACHE, spec.slug);
  mkdirSync(dir, { recursive: true });
  let reused = 0;
  let fetched = 0;

  const pages = await pool(titles, concurrency, async (title) => {
    const file = pageCachePath(spec.slug, title);
    if (!force && existsSync(file)) {
      reused++;
      return JSON.parse(readFileSync(file, "utf8")) as CachedPage;
    }
    let last: Error | null = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      await Bun.sleep(600);
      try {
        const data = JSON.parse(
          await getText(`${API}?${new URLSearchParams({ action: "parse", page: title, prop: "text", format: "json", formatversion: "2" })}`),
        );
        const segments = extractWikisourceSegments(String(data?.parse?.text ?? ""));
        if (!segments.length) throw new Error("the page returned no text");
        const heading = spec.heading ? findHeading(segments, spec.heading.match) : null;
        const page = {
          title,
          url: pageUrl(title),
          label: labelFor(spec, segments, title),
          segments,
          ...(heading ? { headingIndex: heading.index } : {}),
        } satisfies CachedPage;
        // Written page by page: an interrupted import keeps everything it has
        // already reviewed, and the next run asks only for what is missing.
        writeFileSync(file, `${JSON.stringify(page, null, 2)}\n`);
        fetched++;
        return page;
      } catch (err) {
        last = err as Error;
        await Bun.sleep(5_000 * attempt);
      }
    }
    throw new Error(`${spec.title}: ${title} — ${last?.message ?? "failed"}`);
  });

  console.log(`  ${spec.title}: ${reused} pages reused, ${fetched} fetched`);
  return pages;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const streams = JSON.parse(readFileSync(STREAMS, "utf8"));
const functions = JSON.parse(readFileSync(FUNCTIONS, "utf8"));
const manifest: Row = existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, "utf8"))
  : {
      source: "shinto",
      retrieved_at: RETRIEVED_AT,
      note:
        "Catalogue records, chapter outlines and passage indexes only. The Kojiki and the Nihongi are streamed from Wikisource at read time and are not stored in this corpus.",
      hosts: [
        { id: "wikisource", name: "Wikisource", url: "https://en.wikisource.org/", licence: "public-domain translations" },
      ],
      works: [] as Row[],
      totals: { works: 0, chapters: 0, passages: 0 },
    };
manifest.retrieved_at = RETRIEVED_AT;

function recordWork(entry: Row) {
  const index = (manifest.works as Row[]).findIndex((w) => w.slug === entry.slug);
  if (index >= 0) manifest.works[index] = entry;
  else manifest.works.push(entry);
}

async function buildWork(spec: Spec) {
  const pages = await loadWorkPages(spec);
  const chapters: Chapter[] = [];
  const passages: Passage[] = [];
  const indexed: { ref: string; label: string; segments: string[] }[] = [];

  for (const [index, page] of pages.entries()) {
    const chapterRef = String(index + 1);
    // The heading is already printed above the chapter, so it is trimmed here
    // exactly as the reader trims it: a shift on either side would move every
    // later passage number.
    const segments = trimLeading(page.segments, spec.heading?.trimStartPattern ?? spec.trimStartPattern);
    if (!segments.length) throw new Error(`${spec.title}: ${page.title} has a heading but no text`);
    // The label is taken from the page's own heading rather than from the
    // cached copy of it, so a corrected rule applies to pages already fetched.
    const label = labelFor(spec, page.segments, page.title);
    chapters.push({ ref: chapterRef, label });
    indexed.push({ ref: chapterRef, label, segments });    for (const [i] of segments.entries()) {
      passages.push({
        reference: `${chapterRef}.${i + 1}`,
        label: `${label} §${i + 1}`,
        chapterRef,
      });
    }
  }

  // The search indexer reads this summary rather than crawling the host again,
  // and refuses a chapter whose cached segments no longer line up with the
  // passage index, so the two cannot drift apart unwatched.
  writeFileSync(
    join(CACHE, `${spec.slug}.json`),
    `${JSON.stringify(
      { version: 1, slug: spec.slug, provider: "wikisource", generatedAt: RETRIEVED_AT, chapters: indexed },
      null,
      2,
    )}\n`,
  );

  const work = {
    slug: spec.slug,
    title: spec.title,
    originalTitle: spec.originalTitle,
    transliteration: spec.transliteration,
    altTitles: spec.altTitles,
    tradition: "shinto",
    school: spec.school,
    genre: spec.genre,
    textType: spec.textType,
    category: spec.category,
    subcategory: spec.subcategory,
    originalLanguage: spec.originalLanguage,
    dateStart: spec.dateStart,
    dateEnd: spec.dateEnd,
    dateDisplay: spec.dateDisplay,
    authorshipStatus: spec.authorshipStatus,
    author: spec.author,
    attributionNote: spec.attributionNote,
    description: spec.description,
    historicalContext: spec.historicalContext,
    availabilityNote: spec.availabilityNote,
    featured: 0,
    featuredNote: "",
    refScheme: "chapter.paragraph",
    isSample: false,
    textStorage: "streamed",
    chapters,
    passages,
    editions: [
      {
        slug: spec.editionSlug,
        language: "en",
        editionType: "translation",
        title: spec.translationTitle,
        translator: spec.translator,
        publisher: spec.publisher,
        publicationYear: spec.translationYear,
        source: "wikisource",
        license: "public-domain",
        rightsStatus: "Public domain in the United States",
        attributionText: `${spec.translationTitle}, translated by ${spec.translator} (${spec.translationYear}). Public domain in the United States. Page text from Wikisource, whose editorial contributions are CC BY-SA.`,
        structureScheme: "one Wikisource page per printed division",
        isSample: false,
        notes: spec.editionNotes,
      },
    ],
  };

  writeFileSync(join(WORKS, `${spec.slug}.json`), `${JSON.stringify(work, null, 2)}\n`);
  streams.works[spec.slug] = {
    provider: "wikisource",
    upstream: spec.translationTitle,
    mode: "numbered",
    licence: "public-domain",
    config: {
      pages: pages.map((page, index) => ({ ref: String(index + 1), title: page.title, url: page.url })),
      trimStartPattern: spec.heading?.trimStartPattern ?? spec.trimStartPattern,
    },
    editions: [
      {
        slug: spec.editionSlug,
        language: "en",
        languageName: "english",
        version: spec.translationTitle,
        license: "public-domain",
        sourceUrl: pageUrl(pages[0]!.title),
      },
    ],
  };
  functions.works[spec.slug] = {
    functions: spec.functions,
    status: "provisional",
    assignedBy: "UWL editors (comparative taxonomy)",
    note: spec.functionNote,
  };
  recordWork({
    slug: spec.slug,
    host: "wikisource",
    upstream: spec.translationTitle,
    translator: spec.translator,
    chapters: chapters.length,
    passages: passages.length,
    firstChapter: chapters[0]?.label ?? "",
    lastChapter: chapters.at(-1)?.label ?? "",
  });
  console.log(`  ${spec.title}: ${chapters.length} chapters, ${passages.length} passages`);
  return { chapters: chapters.length, passages: passages.length };
}

const started = Date.now();
for (const spec of SPECS) {
  if (only && only !== spec.slug) continue;
  console.log(`${spec.title} (Wikisource, ${spec.translator}, ${spec.translationYear})`);
  await buildWork(spec);
}

manifest.totals.works = (manifest.works as Row[]).length;
manifest.totals.chapters = (manifest.works as Row[]).reduce((sum, w) => sum + Number(w.chapters ?? 0), 0);
manifest.totals.passages = (manifest.works as Row[]).reduce((sum, w) => sum + Number(w.passages ?? 0), 0);
streams.generatedAt = RETRIEVED_AT;

writeFileSync(STREAMS, `${JSON.stringify(streams, null, 2)}\n`);
writeFileSync(FUNCTIONS, `${JSON.stringify(functions, null, 2)}\n`);
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `${manifest.totals.works} works, ${manifest.totals.chapters} chapters, ${manifest.totals.passages} indexed passages ` +
    `written in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
);
