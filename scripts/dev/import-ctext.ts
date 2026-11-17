// Imports the Chinese Text Project (ctext.org) into the library.
//
// One ctext book becomes one work: its chapters are the chapters the site
// lists, each passage is a paragraph of the site's reading page, and the text
// itself is streamed from ctext.org when a reader opens the chapter. The
// validated paragraphs are cached in data/imports/cache/ctext/, which is what
// the search index is built from, and every page credits the project's
// transcription.
//
// The crawl is polite and resumable: one request every two seconds with a
// descriptive user agent, a state file recording what is done, and a work that
// is already imported is never fetched twice. Run it as often as you like; it
// continues where it stopped.
//
//   bun run import:ctext                      # the curated shelves
//   bun run import:ctext --urn=ctp:analects    # one catalogue entry
//   bun run import:ctext --all --limit=200     # the whole catalogue, next 200
//   bun run import:ctext --catalogue           # refresh the site's full index
//   bun run import:ctext --from-cache          # register what the cache holds
//   bun run import:ctext --list                # what has been imported
//
// Options:
//   --urn=<urn>    import one catalogue entry (ctp:analects, ctp:wb295946)
//   --path=<path>  import one ctext path (analects, shiji/1)
//   --all          walk the whole catalogue instead of the curated shelves
//   --limit=<n>    stop after n imported works
//   --force        import works that are already done again
//   --dry-run      read and report, write nothing
//   --list         print the manifest and the crawl state
//   --catalogue    fetch api.ctext.org/gettexttitles and record the whole index
//   --from-cache   register every cached work without touching the network
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ctextChapters, ctextParagraphs, ctextUrl } from "../../server/stream";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");
const CACHE = join(ROOT, "data", "imports", "cache", "ctext");
const MANIFEST = join(ROOT, "data", "imports", "ctext.json");
const CATALOGUE = join(ROOT, "data", "imports", "ctext-catalogue.json");
const STATE = join(ROOT, "data", "imports", "ctext-state.json");
const STREAMS = join(ROOT, "data", "registry", "streams.json");
const FUNCTIONS = join(ROOT, "data", "corpus", "text-functions.json");
const ACQUISITION = join(ROOT, "data", "registry", "acquisition.json");

const RETRIEVED_AT = new Date().toISOString();
const USER_AGENT =
  "UniversalWisdomLibrary/1.0 (local reading interface; Chinese Text Project import; one request every two seconds)";
// The site asks for a crawl delay of two seconds and forbids bulk download
// software; the delay is never shortened below that, whatever the environment
// says, so a long run stays inside the terms the register records.
const DELAY_MS = Math.max(2000, Number(process.env.CTEXT_DELAY_MS ?? 2000) || 2000);

const args = process.argv.slice(2);
const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? "";
const urnOnly = arg("urn");
const pathOnly = arg("path");
const walkAll = args.includes("--all");
const force = args.includes("--force");
const dryRun = args.includes("--dry-run");
const listOnly = args.includes("--list");
const catalogueOnly = args.includes("--catalogue");
const fromCache = args.includes("--from-cache");
const limit = Math.max(0, Number(arg("limit") ?? 0) || 0);
const shelfArg = arg("shelf");

type Row = Record<string, any>;
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Row;
const writeJson = (path: string, data: unknown) => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);

// ---------------------------------------------------------------------------
// Fetching: one request at a time, spaced, with a descriptive agent.
// ---------------------------------------------------------------------------

let lastFetch = 0;
const metrics = { requests: 0, failures: 0 };

// The site refuses a whole network, not a page: once this is set every further
// request fails at once instead of walking tens of thousands of URLs into the
// same wall. See docs/ctext-expansion.md.
let siteBlocked: string | null = null;

class SiteUnavailable extends Error {}

const BLOCK_PAGE = /Access unavailable|Access to ctext\.org is unavailable/i;

async function spacedFetch(url: string, accept: string): Promise<string> {
  if (siteBlocked) throw new SiteUnavailable(siteBlocked);
  const wait = DELAY_MS - (Date.now() - lastFetch);
  if (wait > 0) await Bun.sleep(wait);
  lastFetch = Date.now();
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      metrics.requests++;
      const res = await fetch(url, {
        headers: { accept, "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`${url} returned ${res.status}`);
        await Bun.sleep(3000 * attempt * attempt);
        continue;
      }
      if (res.status === 403) {
        // A 403 that carries the site's "Access unavailable" page is a network
        // ban, not a transient refusal: retrying only deepens it.
        const body = await res.text();
        if (BLOCK_PAGE.test(body)) {
          siteBlocked =
            `ctext.org answered "Access unavailable" for ${url}: the site has blocked this network ` +
            "(its terms forbid automatic download software). Lift the ban at https://ctext.org/requestaccess.pl " +
            "or read through the API from a registered IP or key — docs/ctext-expansion.md records both routes.";
          throw new SiteUnavailable(siteBlocked);
        }
        lastError = new Error(`${url} returned 403 (the site refused the request)`);
        await Bun.sleep(30_000);
        continue;
      }
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      return await res.text();
    } catch (err) {
      if (err instanceof SiteUnavailable) throw err;
      lastError = err as Error;
      metrics.failures++;
      await Bun.sleep(1500 * attempt * attempt);
    }
  }
  throw lastError ?? new Error(`${url} could not be read`);
}

// A page read once is kept while it is still useful: the walk inspects a page
// before it imports it, and a big catalogue would otherwise fetch every index
// twice. The cache is small on purpose.
const pageCache = new Map<string, string>();
const PAGE_CACHE_LIMIT = 120;

async function getPage(path: string): Promise<string> {
  const hit = pageCache.get(path);
  if (hit !== undefined) return hit;
  const html = await spacedFetch(ctextUrl(path), "text/html");
  if (pageCache.size >= PAGE_CACHE_LIMIT) pageCache.delete(pageCache.keys().next().value as string);
  pageCache.set(path, html);
  return html;
}

// ---------------------------------------------------------------------------
// Shelves: the site's categories, mapped onto the library's traditions.
//
// The library groups works by tradition, and ctext's catalogue is wider than
// the three traditions its own register names. The Confucian, Daoist and
// Buddhist shelves keep those traditions; the histories, poetry, medicine,
// mathematics and encyclopedias keep a shelf of their own under
// "chinese-classics".
// ---------------------------------------------------------------------------

const SHELF_ROOTS = [
  { path: "pre-qin-and-han", label: "先秦兩漢", category: "Pre-Qin and Han" },
  { path: "post-han", label: "漢代之後", category: "Post-Han" },
];

type Shelf = { tradition: string; school: string | null; category: string; functions: string[] };

const SHELVES: { match: RegExp; shelf: Shelf }[] = [
  {
    match: /儒家|經部|經學|四書|五經|論語|孟子|荀子|禮記|孝經|詩經|尚書|春秋|易經|小學/,
    shelf: {
      tradition: "confucianism",
      school: "confucian",
      category: "Confucian classics",
      functions: ["canonical_scripture", "philosophical_work"],
    },
  },
  {
    match: /道藏|道教/,
    shelf: {
      tradition: "taoism",
      school: "daoist",
      category: "Daoist canon",
      functions: ["canonical_scripture", "mystical_contemplative"],
    },
  },
  {
    // The library already files Zhuangzi and the Tao Te Ching under this name.
    match: /道家|老莊|莊子|列子|老子/,
    shelf: {
      tradition: "taoism",
      school: "daoist",
      category: "Daoist classics",
      functions: ["canonical_scripture", "mystical_contemplative"],
    },
  },
  {
    match: /佛家|釋家|佛教|禪宗|禪/,
    shelf: {
      tradition: "buddhism",
      school: null,
      category: "Chinese Buddhism",
      functions: ["canonical_scripture", "commentary_exegesis"],
    },
  },
  {
    match: /醫|藥/,
    shelf: { tradition: "chinese-classics", school: null, category: "Medicine", functions: ["academic_scholarship"] },
  },
  {
    match: /算|天文|曆|數學/,
    shelf: {
      tradition: "chinese-classics",
      school: null,
      category: "Science and mathematics",
      functions: ["academic_scholarship"],
    },
  },
  {
    match: /史|編年|紀傳/,
    shelf: { tradition: "chinese-classics", school: null, category: "Histories", functions: ["historical_document"] },
  },
  {
    match: /詩|文|集|詞|曲|賦/,
    shelf: { tradition: "chinese-classics", school: null, category: "Poetry and prose", functions: [] },
  },
  {
    match: /兵|武|軍/,
    shelf: { tradition: "chinese-classics", school: null, category: "Military texts", functions: ["historical_document"] },
  },
  {
    match: /法|刑/,
    shelf: {
      tradition: "chinese-classics",
      school: null,
      category: "Legal texts",
      functions: ["religious_law_practice", "historical_document"],
    },
  },
  {
    match: /類書|百科|叢書/,
    shelf: { tradition: "chinese-classics", school: null, category: "Encyclopedias", functions: [] },
  },
  {
    match: /小說|話本|演義/,
    shelf: { tradition: "chinese-classics", school: null, category: "Fiction", functions: [] },
  },
];

function shelfFor(label: string, fallbackCategory: string): Shelf {
  for (const entry of SHELVES) if (entry.match.test(label)) return entry.shelf;
  return {
    tradition: "chinese-classics",
    school: null,
    category: fallbackCategory || "Chinese texts",
    functions: ["philosophical_work"],
  };
}

// ---------------------------------------------------------------------------
// Corpus records
// ---------------------------------------------------------------------------

const slugFor = (path: string) =>
  `${path
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()}-zh`;

type Chapter = { ref: string; label: string; pages: string[]; paragraphs: string[] };

type WorkEntry = {
  path: string;
  title: string;
  /** The site's own Chinese title, used to name the edition. */
  originalTitle?: string;
  shelfLabel: string;
  category: string;
  chapters: Chapter[];
};

/** Every page of one chapter, following one level of nested section pages. */
async function chapterPages(book: string, page: string, depth = 0): Promise<{ pages: string[]; paragraphs: string[] }> {
  const html = await getPage(page ? `${book}/${page}` : book);
  const paragraphs = ctextParagraphs(html);
  if (paragraphs.length || depth >= 2) return { pages: [page], paragraphs };
  const children = ctextChapters(html, page ? `${book}/${page}` : book);
  if (!children.length) return { pages: [page], paragraphs };
  const pages: string[] = [];
  const collected: string[] = [];
  for (const child of children) {
    const nested = await chapterPages(book, page ? `${page}/${child.path}` : child.path, depth + 1);
    pages.push(...nested.pages);
    collected.push(...nested.paragraphs);
  }
  return { pages, paragraphs: collected };
}

function writeWork(entry: WorkEntry, streams: Row, functions: Row) {
  const slug = slugFor(entry.path);
  const shelf = shelfFor(`${entry.shelfLabel} ${entry.category}`, entry.category);
  const passages = entry.chapters.flatMap((chapter) =>
    chapter.paragraphs.map((_, index) => ({
      reference: `${chapter.ref}.${index + 1}`,
      label: `${chapter.label} ${index + 1}`,
      chapterRef: chapter.ref,
    })),
  );
  const editionSlug = `${slug}-ctext`;
  const attribution =
    "Chinese text from the Chinese Text Project (ctext.org). The transcription and punctuation are the project's " +
    "editorial work and are credited on every page; the pre-modern text itself is out of copyright.";

  const chineseTitle = entry.originalTitle ?? entry.title;
  const work = {
    slug,
    title: entry.title,
    originalTitle: chineseTitle,
    transliteration: "",
    altTitles: [],
    tradition: shelf.tradition,
    school: shelf.school,
    genre: shelf.category,
    textType: "Classical Chinese text",
    category: shelf.category,
    subcategory: entry.shelfLabel || shelf.category,
    originalLanguage: "zh",
    dateStart: null,
    dateEnd: null,
    dateDisplay: "pre-modern",
    authorshipStatus: "traditional",
    author: null,
    attributionNote:
      `Transmitted in the Chinese Text Project's transcription (${entry.path}) without a modern author's name. ` +
      "The site states the edition its transcription follows on the work's own page there.",
    description:
      `${entry.title} — a Chinese text on the ${entry.shelfLabel || shelf.category} shelf of the Chinese Text Project, ` +
      "imported as the original text. The library holds no translation of this work, so the reader shows the Chinese " +
      "alone, with the site's transcription credited on every page.",
    historicalContext:
      "Read in the Chinese Text Project's catalogue, whose shelves follow the traditional division of Chinese letters; " +
      "the site's own notes on the work record the edition transcribed.",
    availabilityNote:
      `Complete as the Chinese Text Project serves it: ${entry.chapters.length} chapter(s), ${passages.length} ` +
      "paragraph(s), streamed from ctext.org at read time, one chapter at a time. This is the original Chinese, not a " +
      "translation.",
    featured: 0,
    featuredNote: "",
    refScheme: "chapter.paragraph",
    isSample: false,
    textStorage: "streamed",
    chapters: entry.chapters.map((chapter) => ({ ref: chapter.ref, label: chapter.label })),
    passages,
    editions: [
      {
        slug: editionSlug,
        language: "zh",
        editionType: "original",
        title: `${chineseTitle} — Chinese Text Project transcription`,
        translator: "",
        publisher: "Chinese Text Project (ctext.org)",
        publicationYear: null,
        source: "ctext",
        license: "ctext-site-terms",
        rightsStatus:
          "Pre-modern text out of copyright; the transcription, punctuation and apparatus are the Chinese Text " +
          "Project's editorial work and are credited on every page",
        attributionText: attribution,
        structureScheme: "chapter.paragraph as the reading pages print them",
        isSample: false,
        notes:
          "The import cache stores the paragraphs that were validated; the reader re-fetches the chapter from " +
          "ctext.org and reports when the served count no longer matches the index.",
      },
    ],
  };
  writeFileSync(join(WORKS, `${slug}.json`), `${JSON.stringify(work, null, 2)}\n`);

  writeJson(join(CACHE, `${slug}.json`), {
    version: 1,
    slug,
    provider: "ctext",
    path: entry.path,
    sourceUrl: ctextUrl(entry.path),
    generatedAt: RETRIEVED_AT,
    complete: true,
    chapters: entry.chapters.map((chapter) => ({
      ref: chapter.ref,
      label: chapter.label,
      pages: chapter.pages,
      segments: chapter.paragraphs,
    })),
  });

  return registerWork(entry, shelf, streams, functions);
}

type Registered = { slug: string; chapters: Chapter[]; passages: number; words: number; shelf: Shelf };

/**
 * The registry half of an import: the streamed-work record the reader resolves,
 * the text-function taxonomy and the word count. Kept apart from writeWork so a
 * cached work can be registered again without a single request to the site.
 */
function registerWork(entry: WorkEntry, shelf: Shelf, streams: Row, functions: Row): Registered {
  const slug = slugFor(entry.path);
  const editionSlug = `${slug}-ctext`;
  const passages = entry.chapters.reduce((sum, chapter) => sum + chapter.paragraphs.length, 0);

  streams.works[slug] = {
    provider: "ctext",
    upstream: `ctext ${entry.path}`,
    mode: "numbered",
    licence: "ctext-site-terms",
    config: {
      book: entry.path,
      sourceUrl: ctextUrl(entry.path),
      chapters: Object.fromEntries(
        entry.chapters.map((chapter) => [
          chapter.ref,
          {
            label: chapter.label,
            pages: chapter.pages,
            from: 0,
            to: Math.max(0, chapter.paragraphs.length - 1),
          },
        ]),
      ),
    },
    editions: [
      {
        slug: editionSlug,
        language: "zh",
        languageName: "chinese",
        version: `${entry.originalTitle ?? entry.title} — Chinese Text Project transcription`,
        license: "ctext-site-terms",
        sourceUrl: ctextUrl(entry.path),
      },
    ],
  };

  functions.works[slug] = {
    functions: shelf.functions,
    status: "provisional",
    assignedBy: "UWL editors (comparative taxonomy)",
    note: `${entry.title} — ${shelf.category}. The Chinese text as the Chinese Text Project transcribes it (${entry.path}).`,
  };

  const words = entry.chapters.reduce(
    (sum, chapter) => sum + chapter.paragraphs.reduce((n, text) => n + String(text).replace(/\s+/g, "").length, 0),
    0,
  );
  return { slug, chapters: entry.chapters, passages, words, shelf };
}

// ---------------------------------------------------------------------------
// The catalogue and the walk
// ---------------------------------------------------------------------------

async function buildCatalogue() {
  // This is the one API function the site serves without a key or a registered
  // IP: it returns the whole index — every text the site holds, title and URN —
  // in a single 4 MB answer.
  const body = await spacedFetch("https://api.ctext.org/gettexttitles", "application/json");
  const parsed = JSON.parse(body) as { books?: { title: string; urn: string }[] };
  const works = (parsed.books ?? []).filter((book) => String(book.urn ?? "").startsWith("ctp:"));
  const canonical = works.filter((book) => !String(book.urn).startsWith("ctp:wb"));
  writeJson(CATALOGUE, {
    version: 1,
    source: "ctext",
    requestUrl: "https://api.ctext.org/gettexttitles",
    generatedAt: RETRIEVED_AT,
    note:
      "Every top-level item api.ctext.org/gettexttitles lists. ctp:<stem> entries are the canonical books the " +
      "site presents under its own names; ctp:wb… entries are the texts of the site's library and wiki, mostly the " +
      "Siku Quanshu and other collected editions.",
    counts: { total: works.length, canonical: canonical.length, wiki: works.length - canonical.length },
    works,
  });
  console.log(
    `catalogue: ${works.length} item(s) (${canonical.length} canonical, ` +
      `${works.length - canonical.length} library/wiki) written to ${CATALOGUE}`,
  );
  return works;
}

const SKIP = /^(?:introduction|font-test-page|help-us|faq|instructions|tools|system-statistics|digital-humanities|library|wiki|search|about|donate|user|account|media|special|dictionary|dynasties|calendar|parallel-passages|texts|pre-qin-and-han|post-han|ancient-and-modern|republican-era)$/;

type QueueItem = { path: string; title: string; shelf: string; category: string };

/** The entries an index page lists, as the site's own menu links. */
function menuChildren(html: string, path: string) {
  const out: { path: string; title: string }[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a class="menuitem"[^>]*href="([^"]+?)\/zh"[^>]*>([^<]*)<\/a>/g)) {
    const child = (match[1] ?? "").replace(/^https?:\/\/ctext\.org\//, "").replace(/^\/+/, "");
    const title = (match[2] ?? "").trim();
    if (!child || !title || child === path || seen.has(child) || SKIP.test(child)) continue;
    seen.add(child);
    out.push({ path: child, title });
  }
  return out;
}

type Kind = "work" | "index" | "empty";

/** Whether a page holds a text, a shelf of links, or neither. */
async function classify(path: string): Promise<{ kind: Kind; chapters: number; paragraphs: number }> {
  const html = await getPage(path);
  const paragraphs = ctextParagraphs(html);
  const chapters = ctextChapters(html, path);
  if (paragraphs.length || chapters.length) return { kind: "work", chapters: chapters.length, paragraphs: paragraphs.length };
  if (menuChildren(html, path).length) return { kind: "index", chapters: 0, paragraphs: 0 };
  return { kind: "empty", chapters: 0, paragraphs: 0 };
}

async function importBook(item: QueueItem, streams: Row, functions: Row) {
  const html = await getPage(item.path);
  const direct = ctextParagraphs(html);
  const links = ctextChapters(html, item.path);
  const chapters: Chapter[] = [];

  if (links.length) {
    let ref = 0;
    for (const link of links) {
      const page = await chapterPages(item.path, link.path);
      if (!page.paragraphs.length) continue;
      ref++;
      const label = link.english ? `${link.title} (${link.english})` : link.title;
      chapters.push({ ref: String(ref), label, pages: page.pages, paragraphs: page.paragraphs });
    }
  } else if (direct.length) {
    chapters.push({ ref: "1", label: item.title, pages: [""], paragraphs: direct });
  }

  if (!chapters.length) throw new Error("the page held neither paragraphs nor chapter links");
  return writeWork(
    { path: item.path, title: item.title, shelfLabel: item.shelf, category: item.category, chapters },
    streams,
    functions,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

mkdirSync(CACHE, { recursive: true });
if (!existsSync(MANIFEST)) {
  writeJson(MANIFEST, { version: 1, source: "ctext", generatedAt: RETRIEVED_AT, works: [], totals: {} });
}
if (!existsSync(STATE)) writeJson(STATE, { version: 1, done: {}, failed: {}, updatedAt: RETRIEVED_AT });

const manifest = readJson(MANIFEST);
const streams = readJson(STREAMS);
const functions = readJson(FUNCTIONS);
const acquisition = readJson(ACQUISITION);
const state = readJson(STATE);
state.done ??= {};
state.failed ??= {};

function recordWork(entry: Row) {
  const at = manifest.works.findIndex((work: Row) => work.slug === entry.slug);
  if (at >= 0) manifest.works[at] = entry;
  else manifest.works.push(entry);
}

if (listOnly) {
  console.log(`ctext manifest: ${manifest.works.length} work(s)`);
  console.log(`crawl state: ${Object.keys(state.done).length} done, ${Object.keys(state.failed).length} failed`);
  for (const work of manifest.works.slice(-15)) {
    console.log(
      `  ${String(work.slug).padEnd(30)} ${String(work.chapters).padStart(5)} ch ${String(work.passages).padStart(6)} p  ${work.path}`,
    );
  }
  process.exit(0);
}

let imported = 0;
let failed = 0;
const seen = new Set<string>();

function budgetSpent() {
  return limit > 0 && imported >= limit;
}

/** The bookkeeping every successful import leaves behind, whatever read it. */
function recordImport(item: QueueItem, result: Registered) {
  state.done[item.path] = {
    slug: result.slug,
    chapters: result.chapters.length,
    passages: result.passages,
    shelf: result.shelf.category,
    at: RETRIEVED_AT,
  };
  delete state.failed[item.path];
  imported++;
  recordWork({
    slug: result.slug,
    title: item.title,
    path: item.path,
    url: ctextUrl(item.path),
    tradition: result.shelf.tradition,
    category: result.shelf.category,
    chapters: result.chapters.length,
    passages: result.passages,
    words: result.words,
    validation: "aligned",
    retrieved_at: RETRIEVED_AT,
  });
  const target = (acquisition.targets ?? []).find((entry: Row) => entry.slug === result.slug);
  if (target) {
    target.status = "imported";
    target.note = `${item.title}: the Chinese text is imported as a streamed work from the Chinese Text Project (${item.path}).`;
  }
  console.log(
    `  ${result.slug}: ${result.chapters.length} chapter(s), ${result.passages} paragraph(s) ` +
      `[${result.shelf.tradition}/${result.shelf.category}]`,
  );
}

async function importOne(item: QueueItem) {
  const slug = slugFor(item.path);
  if (!force && (state.done[item.path] || existsSync(join(WORKS, `${slug}.json`)))) return;
  try {
    recordImport(item, await importBook(item, streams, functions));
  } catch (err) {
    if (err instanceof SiteUnavailable) throw err;
    failed++;
    state.failed[item.path] = { error: (err as Error).message, at: RETRIEVED_AT };
    console.error(`  ${item.path}: ${(err as Error).message}`);
  }
  state.updatedAt = RETRIEVED_AT;
  writeJson(STATE, state);
}

/**
 * Register everything the import cache already holds, without a request. A run
 * that was cut short (by the site closing, by the machine sleeping) leaves
 * validated chapters in data/imports/cache/ctext/ and nothing in the registry;
 * this reads them back into the stream manifest, the taxonomy and the corpus
 * register, and is also how a fresh checkout indexes a cache it was given.
 */
function registerCached() {
  const files = readdirSync(CACHE)
    .filter((file) => file.endsWith(".json"))
    .sort();
  for (const file of files) {
    const cache = readJson(join(CACHE, file));
    const slug = String(cache.slug ?? file.slice(0, -5));
    const path = String(cache.path ?? "");
    if (!path || !Array.isArray(cache.chapters) || !cache.chapters.length) continue;
    // The cache can be ahead of the registry: a run that was cut short wrote the
    // chapters and the corpus record but never reached the end of the walk.
    if (!force && streams.works[slug]) continue;
    const workPath = join(WORKS, `${slug}.json`);
    if (!existsSync(workPath)) {
      console.error(`  ${slug}: the cache has chapters but the corpus record ${workPath} is missing`);
      continue;
    }
    const work = readJson(workPath);
    const chapters: Chapter[] = cache.chapters.map((chapter: Row) => ({
      ref: String(chapter.ref),
      label: String(chapter.label ?? chapter.ref),
      pages: Array.isArray(chapter.pages) ? chapter.pages.map(String) : [""],
      paragraphs: Array.isArray(chapter.segments) ? chapter.segments.map(String) : [],
    }));
    const category = String(work.category ?? "Chinese texts");
    const entry: WorkEntry = {
      path,
      title: String(work.title ?? slug),
      originalTitle: String(work.originalTitle ?? work.title ?? slug),
      shelfLabel: String(work.subcategory ?? category),
      category,
      chapters,
    };
    const shelf = shelfFor(`${entry.shelfLabel} ${category}`, category);
    const result = registerWork(entry, shelf, streams, functions);
    recordImport({ path, title: entry.title, shelf: entry.shelfLabel, category }, result);
    state.updatedAt = RETRIEVED_AT;
    writeJson(STATE, state);
  }
}

/**
 * Walk a page: a text is imported under the shelf it was found in, a shelf of
 * links is walked one level down, and the shelf's own name becomes the shelf of
 * the works beneath it.
 */
async function walk(item: QueueItem, depth = 0) {
  if (budgetSpent() || depth > 3 || seen.has(item.path)) return;
  seen.add(item.path);
  const kind = await classify(item.path);
  if (kind.kind === "work") {
    if (dryRun) {
      console.log(`  ${item.path}: ${kind.paragraphs} paragraph(s), ${kind.chapters} chapter link(s)`);
      return;
    }
    await importOne(item);
    return;
  }
  if (kind.kind !== "index") return;
  for (const child of menuChildren(await getPage(item.path), item.path)) {
    try {
      const childKind = await classify(child.path);
      await walk(
        {
          path: child.path,
          title: child.title,
          shelf: childKind.kind === "index" ? child.title : item.shelf,
          category: item.category,
        },
        depth + 1,
      );
    } catch (err) {
      if (err instanceof SiteUnavailable) throw err;
      failed++;
      state.failed[child.path] = { error: (err as Error).message, at: RETRIEVED_AT };
      console.error(`  ${child.path}: ${(err as Error).message}`);
      writeJson(STATE, state);
    }
  }
}

if (catalogueOnly) {
  await buildCatalogue();
} else if (fromCache) {
  registerCached();
} else {
  try {
    if (urnOnly || pathOnly) {
      const path = pathOnly || urnOnly.replace(/^ctp:/, "");
      const kind = await classify(path);
      if (kind.kind !== "work") {
        console.error(`${path} is ${kind.kind === "index" ? "an index page" : "empty"}, not a text`);
        process.exit(1);
      }
      await importOne({ path, title: shelfArg || path, shelf: shelfArg, category: shelfArg || "Chinese texts" });
    } else if (walkAll) {
      const catalogue = existsSync(CATALOGUE) ? (readJson(CATALOGUE).works ?? []) : await buildCatalogue();
      console.log(`${catalogue.length} catalogue entr${catalogue.length === 1 ? "y" : "ies"} to consider`);
      for (const entry of catalogue) {
        if (budgetSpent()) break;
        const urn = String(entry.urn ?? "");
        if (!urn.startsWith("ctp:")) continue;
        const path = urn.slice(4);
        if (seen.has(path)) continue;
        const slug = slugFor(path);
        if (!force && (state.done[path] || existsSync(join(WORKS, `${slug}.json`)))) continue;
        seen.add(path);
        try {
          const kind = await classify(path);
          if (kind.kind !== "work") continue;
          await importOne({ path, title: String(entry.title ?? path), shelf: "", category: "Chinese texts" });
        } catch (err) {
          if (err instanceof SiteUnavailable) throw err;
          failed++;
          state.failed[path] = { error: (err as Error).message, at: RETRIEVED_AT };
          console.error(`  ${path}: ${(err as Error).message}`);
          writeJson(STATE, state);
        }
      }
    } else {
      for (const root of SHELF_ROOTS) {
        if (budgetSpent()) break;
        console.log(`walking ${root.path} (${root.label})`);
        try {
          await walk({ path: root.path, title: root.label, shelf: root.label, category: root.category });
        } catch (err) {
          if (err instanceof SiteUnavailable) throw err;
          failed++;
          console.error(`  ${root.path}: ${(err as Error).message}`);
        }
      }
    }
  } catch (err) {
    if (!(err instanceof SiteUnavailable)) throw err;
    console.error(`\nstopping: ${(err as Error).message}`);
  }
}

manifest.totals = {
  works: manifest.works.length,
  chapters: manifest.works.reduce((sum: number, work: Row) => sum + (work.chapters ?? 0), 0),
  passages: manifest.works.reduce((sum: number, work: Row) => sum + (work.passages ?? 0), 0),
  words: manifest.works.reduce((sum: number, work: Row) => sum + (work.words ?? 0), 0),
};
manifest.generatedAt = RETRIEVED_AT;

if (!dryRun) {
  writeJson(MANIFEST, manifest);
  writeJson(STREAMS, streams);
  writeJson(FUNCTIONS, functions);
  writeJson(ACQUISITION, acquisition);
  writeJson(STATE, state);
}

console.log(
  `\nImported ${imported} work(s) this run; ${failed} failure(s); ${metrics.requests} request(s), ` +
    `${metrics.failures} retr${metrics.failures === 1 ? "y" : "ies"}.`,
);
console.log(
  `ctext now holds ${manifest.totals.works} work(s), ${manifest.totals.chapters} chapter(s), ` +
    `${manifest.totals.passages} paragraph(s).`,
);
