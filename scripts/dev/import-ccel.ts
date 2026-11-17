// Imports the Christian Classics Ethereal Library (ccel.org) into the library.
//
// CCEL is the largest free collection of classic Christian literature on the
// web: the Ante-Nicene, Nicene and Post-Nicene Fathers, the Reformers, the
// mystics, the sermons, the hymnals and the Bibles, in public-domain English
// translation. The site's terms set the pace: its robots.txt asks every crawler
// for ten seconds between requests, and its own catalogue cards state the
// rights of each work, so a text the site carries by a publisher's permission
// rather than in public domain is recorded as a lead and not reproduced.
//
// One CCEL text becomes one work, read in full. The catalogue comes from the
// site's own browse indexes — by title, by author and by genre — and the text
// of each work comes from the plain-text file the site publishes beside every
// book it can offer in that format:
//
//   https://ccel.org/ccel/a/<author>/<work>/cache/<work>.txt
//
// That one request per work carries the whole text, the site's catalogue card,
// its headings and its paragraph breaks, so the library stores the edition
// instead of asking the site for it again at read time. server/ccel.ts reads
// the file: its headings divide the work, its blank lines separate paragraphs,
// its section markers separate the works inside a collected volume, and a
// Bible's verses are read verse by verse. A work the site carries without a
// plain-text file, or whose rights it does not state as public domain, is
// recorded as a lead rather than invented.
//
//   bun run import:ccel --catalogue          # the site's indexes, all three
//   bun run import:ccel --genre="Early Church" --limit=60
//   bun run import:ccel --all --limit=200    # walk the catalogue, next 200
//   bun run import:ccel --path=augustine/confessions
//   bun run import:ccel --from-cache         # re-register from the cache
//   bun run import:ccel --list               # the manifest and the crawl state
//
// Options:
//   --path=<author>/<work>  import one work
//   --genre=<name>          walk one of the site's genres instead of all
//   --all                   walk the catalogue
//   --limit=<n>             stop after n imported works
//   --force                 import works that are already done again
//   --dry-run               read and report, write nothing
//   --list                  print the manifest and the crawl state
//   --catalogue             refresh the title, author and genre indexes
//   --from-cache            re-register the plain text already on disk
//   --delay=<ms>            raise the gap between requests (never below 10000)
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ccelCard, normalizeTitle, parseCcel, titlesAgree, type CcelText } from "../../server/ccel";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");
const META = join(ROOT, "data", "corpus", "meta.json");
const CACHE = join(ROOT, "data", "imports", "cache", "ccel");
const TEXT_CACHE = join(CACHE, "text");
const INDEX_CACHE = join(CACHE, "index");
const CATALOGUE = join(ROOT, "data", "imports", "ccel-catalogue.json");
const AUTHORS = join(ROOT, "data", "imports", "ccel-authors.json");
const MANIFEST = join(ROOT, "data", "imports", "ccel.json");
const STATE = join(ROOT, "data", "imports", "ccel-state.json");
const STREAMS = join(ROOT, "data", "registry", "streams.json");
const FUNCTIONS = join(ROOT, "data", "corpus", "text-functions.json");
const ACQUISITION = join(ROOT, "data", "registry", "acquisition.json");

const RETRIEVED_AT = new Date().toISOString();
const USER_AGENT =
  "UniversalWisdomLibrary/1.0 (local reading interface; Christian Classics Ethereal Library import; ten seconds between requests, as robots.txt asks)";

const args = process.argv.slice(2);
function arg(name: string): string {
  return args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? "";
}
// robots.txt states `Crawl-delay: 10` for every agent. The delay is never
// shortened here, whatever the environment says.
const DELAY_MS = Math.max(10_000, Number(process.env.CCEL_DELAY_MS ?? 0) || 0, Number(arg("delay") || 0) || 0);

const pathOnly = arg("path");
const genreOnly = arg("genre");
const force = args.includes("--force");
const dryRun = args.includes("--dry-run");
const listOnly = args.includes("--list");
const catalogueOnly = args.includes("--catalogue");
const fromCache = args.includes("--from-cache");
const limit = Math.max(0, Number(arg("limit") ?? 0) || 0);

type Row = Record<string, any>;
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Row;
const writeJson = (path: string, data: unknown) => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);

// ---------------------------------------------------------------------------
// Fetching: one request at a time, ten seconds apart, with a descriptive agent.
// ---------------------------------------------------------------------------

let lastFetch = 0;
const metrics = { requests: 0, failures: 0 };

class NotFound extends Error {}

async function spacedFetch(url: string): Promise<string> {
  const wait = DELAY_MS - (Date.now() - lastFetch);
  if (wait > 0) await Bun.sleep(wait);
  lastFetch = Date.now();
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      metrics.requests++;
      const res = await fetch(url, {
        headers: { accept: "text/html,text/plain;q=0.9,*/*;q=0.5", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(120_000),
      });
      if (res.status === 404) throw new NotFound(`${url} returned 404`);
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`${url} returned ${res.status}`);
        await Bun.sleep(20_000 * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      return await res.text();
    } catch (err) {
      if (err instanceof NotFound) throw err;
      lastError = err as Error;
      metrics.failures++;
      await Bun.sleep(10_000 * attempt);
    }
  }
  throw lastError ?? new Error(`${url} could not be read`);
}

const pageCache = new Map<string, string>();
const PAGE_CACHE_LIMIT = 60;

async function getPage(url: string): Promise<string> {
  const hit = pageCache.get(url);
  if (hit !== undefined) return hit;
  const body = await spacedFetch(url);
  if (pageCache.size >= PAGE_CACHE_LIMIT) pageCache.delete(pageCache.keys().next().value as string);
  pageCache.set(url, body);
  return body;
}

/** The cached copy of a page, or the site. */
async function cachedPage(file: string, url: string): Promise<string> {
  if (existsSync(file) && !force) return readFileSync(file, "utf8");
  const body = await getPage(url);
  if (!dryRun) writeFileSync(file, body);
  return body;
}

// ---------------------------------------------------------------------------
// The site's indexes
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&rsquo;": "’",
  "&lsquo;": "‘",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&mdash;": "—",
  "&ndash;": "–",
  "&nbsp;": " ",
  "&hellip;": "…",
};

function cleanText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}

// The site's works are two path segments under /ccel/; a third or a dotted name
// is a page inside a work (a chapter, a TOC, a search result), not a work.
const CCEL_WORK = /^\/ccel\/([^/]+)\/([a-z0-9_-]+)\.html?$/i;

/** The works a browse-index page lists, as the site's own links to them. */
function indexedWorks(html: string): { author: string; work: string; title: string }[] {
  const out: { author: string; work: string; title: string }[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a[^>]+href="(\/ccel\/[^"]+?)"[^>]*>([\s\S]{0,160}?)<\/a>/gi)) {
    const parts = match[1]!.match(CCEL_WORK);
    if (!parts) continue;
    const title = cleanText(match[2] ?? "");
    const key = `${parts[1]}/${parts[2]}`;
    if (!title || seen.has(key)) continue;
    seen.add(key);
    out.push({ author: parts[1]!, work: parts[2]!, title });
  }
  return out;
}

/** The authors a browse-index page lists: `Aaberg, Jens Christian (1877-1970)`. */
function indexedAuthors(html: string): { slug: string; label: string; dates: string }[] {
  const out: { slug: string; label: string; dates: string }[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/href="\/ccel\/([a-z0-9_]+)\?show=worksBy"[^>]*>([\s\S]{0,160}?)<\/a>/gi)) {
    const slug = match[1]!;
    const label = cleanText(match[2] ?? "");
    if (!label || seen.has(slug)) continue;
    seen.add(slug);
    const dates = label.match(/\(([^)]*)\)\s*$/)?.[1] ?? "";
    out.push({ slug, label: label.replace(/\(([^)]*)\)\s*$/, "").replace(/,\s*$/, "").trim(), dates });
  }
  return out;
}

/** `Augustine, Saint, Bishop of Hippo` reads as a name, not as a sort name. */
function displayName(label: string): string {
  const comma = label.indexOf(",");
  if (comma < 0) return label;
  const head = label.slice(0, comma).trim();
  const rest = label.slice(comma + 1).replace(/,\s*$/, "").trim();
  if (!rest || !/^[A-Z]/.test(rest) || /\b(?:Saint|St\.?|Pope|Sir|Blessed|Venerable|the Great)\b/i.test(rest)) return label;
  return `${rest} ${head}`;
}

/** A person as the library records authors: sort name, display name, years. */
function personOf(slug: string, label: string, dates: string) {
  const sortName = label.replace(/\s+/g, " ").trim();
  const years = [...dates.matchAll(/(\d{3,4})/g)].map((match) => Number(match[1]));
  const birth = years[0] ?? null;
  const death = years[1] ?? years[0] ?? null;
  const flourished = years.length < 2 || /fl\.|d\.|\?/i.test(dates);
  return {
    slug: slug.replace(/_+/g, "-"),
    name: displayName(sortName) || sortName,
    sort_name: sortName,
    birth_year: flourished ? null : birth,
    death_year: flourished ? null : death,
    date_display: dates.trim(),
  };
}

// ---------------------------------------------------------------------------
// Shelves: the site's genres, mapped onto the library's traditions.
// ---------------------------------------------------------------------------

type Shelf = { school: string | null; category: string; functions: string[] };

const GENRE_SHELVES: { match: RegExp; shelf: Shelf }[] = [
  { match: /^commentaries$/i, shelf: { school: null, category: "Commentaries", functions: ["commentary_exegesis"] } },
  { match: /^early church$/i, shelf: { school: "patristics", category: "Patristic theology", functions: ["historical_document"] } },
  { match: /^bibles$/i, shelf: { school: null, category: "Scripture", functions: ["canonical_scripture"] } },
  { match: /^apologetics$/i, shelf: { school: null, category: "Apologetics", functions: ["historical_document"] } },
  { match: /^biographies$/i, shelf: { school: null, category: "Biographies", functions: ["historical_document"] } },
  { match: /^christian life$/i, shelf: { school: null, category: "Christian life", functions: ["contemporary_spiritual_writing"] } },
  { match: /^creeds and catechisms$/i, shelf: { school: null, category: "Creeds and catechisms", functions: ["creed_confession"] } },
  // The site's own fiction shelf — Bunyan's allegory, the religious novels of
  // Tolstoy, MacDonald, Chesterton and Defoe — is religious literature outside
  // any canon, which is how the corpus's vocabulary describes such a work.
  { match: /^fiction$/i, shelf: { school: null, category: "Christian fiction", functions: ["non_canonical_religious_text"] } },
  { match: /^histories$/i, shelf: { school: null, category: "Church history", functions: ["historical_document"] } },
  { match: /^hymns$|^liturgical books$/i, shelf: { school: null, category: "Hymns and liturgy", functions: ["prayer_liturgy"] } },
  { match: /^language tools$|^reference$/i, shelf: { school: null, category: "Reference", functions: ["academic_scholarship"] } },
  { match: /^mysticism$/i, shelf: { school: null, category: "Christian mysticism", functions: ["mystical_contemplative"] } },
  { match: /^philosophy$/i, shelf: { school: null, category: "Philosophy", functions: ["philosophical_work"] } },
  { match: /^prayer$/i, shelf: { school: null, category: "Devotional", functions: ["prayer_liturgy"] } },
  { match: /^sermons$/i, shelf: { school: null, category: "Sermons", functions: ["sermon_speech"] } },
  { match: /^theology$/i, shelf: { school: null, category: "Theology", functions: ["philosophical_work"] } },
];

function shelfFor(genres: string[]): Shelf {
  for (const genre of genres) {
    const hit = GENRE_SHELVES.find((entry) => entry.match.test(genre));
    if (hit) return hit.shelf;
  }
  return { school: null, category: "Christian texts", functions: ["historical_document"] };
}

// ---------------------------------------------------------------------------
// Works already held
// ---------------------------------------------------------------------------

const STOP = new Set(["the", "a", "an", "of", "and", "or", "to", "in", "on", "by", "for", "saint", "st"]);

/** The words a title is known by, for matching a work held in another edition. */
function keyWords(value: string): string[] {
  return normalizeTitle(value)
    .split(" ")
    .filter((word) => word.length >= 5 && !STOP.has(word));
}

type Held = { slug: string; title: string; norm: string };

function loadHeld(): { byTitle: Map<string, Held>; list: Held[] } {
  const byTitle = new Map<string, Held>();
  const list: Held[] = [];
  for (const file of readdirSync(WORKS)) {
    if (!file.endsWith(".json")) continue;
    const slug = file.replace(/\.json$/, "");
    let head: string;
    try {
      head = readFileSync(join(WORKS, file), "utf8").slice(0, 3000);
    } catch {
      continue;
    }
    const raw = /"title":\s*"((?:[^"\\]|\\.)*)"/.exec(head)?.[1];
    if (!raw) continue;
    let title: string;
    try {
      title = JSON.parse(`"${raw}"`) as string;
    } catch {
      continue;
    }
    const alt = /"altTitles":\s*\[([^\]]*)\]/.exec(head)?.[1] ?? "";
    const names = [title, ...[...alt.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`) as string)];
    const norm = normalizeTitle(title);
    const held: Held = { slug, title, norm };
    list.push(held);
    for (const name of names) {
      const key = normalizeTitle(name);
      if (key && !byTitle.has(key)) byTitle.set(key, held);
    }
  }
  return { byTitle, list };
}

// ---------------------------------------------------------------------------
// Corpus records
// ---------------------------------------------------------------------------

const slugFor = (author: string, work: string) =>
  `${author}-${work}`
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const textUrl = (author: string, work: string) => `https://ccel.org/ccel/a/${author}/${work}/cache/${work}.txt`;
const workUrl = (author: string, work: string) => `https://ccel.org/ccel/${author}/${work}`;

type Entry = {
  author: string;
  work: string;
  slug: string;
  title: string;
  genres: string[];
  card: Record<string, string>;
  head: string;
  person: Row | null;
  parsed: CcelText;
};

function writeWork(entry: Entry, ctx: { streams: Row; functions: Row; meta: Row; acquisition: Row }) {
  const shelf = shelfFor(entry.genres);
  const parsed = entry.parsed;
  const editionSlug = `${entry.slug}-en`;
  const verse = parsed.scheme === "chapter.verse";
  const authorName = entry.person?.name ?? displayName(entry.author.replace(/[_-]+/g, " "));
  // The reference is the position in the work, so it is unique and stable; a
  // Bible's verse number belongs in the label ("Genesis 1:31"), as the library's
  // other Bible books print it, and not in the reference.
  const passages = parsed.chapters.flatMap((chapter, chapterIndex) =>
    chapter.paragraphs.map((text, index) => ({
      reference: `${chapterIndex + 1}.${index + 1}`,
      label: verse ? `${chapter.label}:${chapter.verses?.[index] ?? index + 1}` : `${chapter.label} §${index + 1}`,
      chapterRef: String(chapterIndex + 1),
      text,
    })),
  );
  const words = passages.reduce((sum, passage) => sum + passage.text.split(/\s+/).filter(Boolean).length, 0);
  const cardTitle = entry.card.title ?? entry.title;
  const printBasis = entry.card["print basis"] ?? "";
  const rights = entry.card.rights ?? "";
  // The translator is named on the card, in the title or in the edition's own
  // front matter (`Translated by …`), and nowhere else in the file.
  const translator =
    `${entry.card.title ?? ""} ${entry.card["print basis"] ?? ""} ${entry.card["creator(s)"] ?? ""} ${entry.head}`
      .match(/translat(?:ed|ion|or)\s+(?:and\s+edited\s+)?by\s+([^.;,()\n]{3,90})/i)?.[1]
      ?.replace(/\s+/g, " ")
      .trim() ?? "";

  const work = {
    slug: entry.slug,
    title: cardTitle,
    originalTitle: "",
    transliteration: "",
    altTitles: entry.title && entry.title !== cardTitle ? [entry.title] : [],
    tradition: "christianity",
    school: shelf.school,
    genre: shelf.category,
    textType: shelf.category === "Scripture" ? "Biblical text" : "Christian text in English translation",
    category: shelf.category,
    subcategory: entry.genres[0] ?? entry.card["ccel subjects"]?.split(";").map((s) => s.trim())[1] ?? "",
    originalLanguage: "en",
    dateStart: null,
    dateEnd: null,
    dateDisplay: "",
    authorshipStatus: entry.person ? "traditional" : "anonymous",
    author: entry.person ? entry.person.slug : null,
    attributionNote:
      `Recorded in the Christian Classics Ethereal Library under ${authorName}` +
      `${entry.person?.date_display ? ` (${entry.person.date_display})` : ""}. ` +
      `The site catalogues the work at ${workUrl(entry.author, entry.work)}, whose own card names the print edition ` +
      "transcribed here; where the site carries a title by a publisher's permission rather than in public domain, " +
      "this library does not take it.",
    description:
      `${cardTitle} — the English text the Christian Classics Ethereal Library publishes for this work` +
      `${entry.genres.length ? `, on the site's ${entry.genres.join(", ")} shelf` : ""}. ` +
      "The record was created by the CCEL import from the site's own catalogue and plain text; an editor's note for " +
      "the work itself is still to be written.",
    historicalContext:
      "Read in the Christian Classics Ethereal Library's catalogue, whose shelves follow the site's own division of " +
      `Christian literature${printBasis ? `, and whose transcription follows the print edition ${printBasis}` : ""}.`,
    availabilityNote:
      `Complete in the Christian Classics Ethereal Library's plain-text edition: ${parsed.chapters.length} ` +
      `chapter(s), ${passages.length} ${verse ? "verse(s)" : "paragraph(s)"}, ${words.toLocaleString()} words. ` +
      "The divisions are the headings of the site's own text, which the library stores rather than asking the site " +
      "for again when the work is read. The text is public domain and is displayed with the library's credit.",
    featured: 0,
    featuredNote: "",
    refScheme: parsed.scheme,
    isSample: false,
    chapters: parsed.chapters.map((chapter, index) => ({ ref: String(index + 1), label: chapter.label })),
    passages: passages.map(({ reference, label, chapterRef }) => ({ reference, label, chapterRef })),
    editions: [
      {
        slug: editionSlug,
        language: "en",
        editionType: "translation",
        title: cardTitle,
        translator,
        publisher: "Christian Classics Ethereal Library",
        publicationYear: null,
        source: "ccel",
        license: "public-domain",
        rightsStatus: rights
          ? `${rights}, as the Christian Classics Ethereal Library states for this work on its own card`
          : "Public domain. The site's card for this work states no rights field; ccel.org's own copyright page " +
            "records its books as public domain, with a few carried by a publisher's permission and marked as such.",
        attributionText:
          `Text from the Christian Classics Ethereal Library (ccel.org), which transcribed and published this ` +
          `edition${printBasis ? ` from ${printBasis}` : ""}. The translation is public domain; the transcription is ` +
          "credited to the library.",
        structureScheme: verse
          ? "book, chapter and verse, as the site's plain text divides it"
          : "chapter and paragraph, the chapters being the divisions of the site's plain text",
        isSample: false,
        texts: Object.fromEntries(passages.map((passage) => [passage.reference, passage.text])),
        notes:
          "Imported from the plain-text file the CCEL publishes for this work; its headings divide the work, its " +
          "blank lines separate the paragraphs, and nothing is fetched from ccel.org when the work is read.",
      },
    ],
  };
  writeFileSync(join(WORKS, `${entry.slug}.json`), `${JSON.stringify(work, null, 2)}\n`);

  // The text is held locally, so nothing is registered as a stream; an entry
  // left from an earlier streaming pass would only confuse the reader.
  delete ctx.streams.works[entry.slug];

  ctx.functions.works[entry.slug] = {
    functions: shelf.functions,
    status: "provisional",
    assignedBy: "UWL editors (CCEL genre map)",
    note:
      `${cardTitle} — ${shelf.category}. The CCEL genre this record was shelved from is ` +
      `${entry.genres.length ? entry.genres.join(", ") : "not stated on the site"}.`,
  };

  ensureAuthor(entry.person, ctx.meta, cardTitle);

  return {
    slug: entry.slug,
    title: cardTitle,
    author: entry.person?.name ?? "",
    path: `${entry.author}/${entry.work}`,
    url: workUrl(entry.author, entry.work),
    textUrl: textUrl(entry.author, entry.work),
    tradition: "christianity",
    category: shelf.category,
    genres: entry.genres,
    chapters: parsed.chapters.length,
    passages: passages.length,
    words,
    scheme: parsed.scheme,
    printBasis,
    rights,
    rightsUnstated: !rights,
    retrieved_at: RETRIEVED_AT,
  };
}

/**
 * A person the corpus did not know is added from the site's own author index.
 * A work whose author is not registered would fail the corpus validation, so
 * this is what keeps `db:reset` loading after an import.
 */
function ensureAuthor(person: Row | null, meta: Row, read: string) {
  if (!person) return;
  meta.authors ??= [];
  if (meta.authors.some((author: Row) => author.slug === person.slug)) return;
  meta.authors.push({
    slug: person.slug,
    name: person.name,
    sort_name: person.sort_name ?? person.name,
    birth_year: person.birth_year ?? null,
    death_year: person.death_year ?? null,
    date_display: person.date_display ?? "",
    description: `Recorded in the Christian Classics Ethereal Library's author index, where this library read ${read}.`,
    is_attributed: false,
  });
}

/** The acquisition register keeps a target where it already holds one. */
function markTarget(record: Row, acquisition: Row) {
  for (const target of acquisition.targets ?? []) {
    const sameSlug = target.slug === record.slug;
    const sameTitle =
      target.title && normalizeTitle(String(target.title)) === normalizeTitle(String(record.title));
    if (!sameSlug && !sameTitle) continue;
    target.status = "imported";
    target.note = `${record.title}: the English text is imported from the Christian Classics Ethereal Library (${record.path}).`;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

mkdirSync(CACHE, { recursive: true });
mkdirSync(TEXT_CACHE, { recursive: true });
mkdirSync(INDEX_CACHE, { recursive: true });
if (!existsSync(MANIFEST)) {
  writeJson(MANIFEST, { version: 1, source: "ccel", generatedAt: RETRIEVED_AT, works: [], leads: [], totals: {} });
}
if (!existsSync(STATE)) writeJson(STATE, { version: 1, done: {}, failed: {}, updatedAt: RETRIEVED_AT });

const manifest = readJson(MANIFEST);
manifest.leads ??= [];
let catalogueRows: Row[] = [];
const streams = readJson(STREAMS);
const functions = readJson(FUNCTIONS);
const acquisition = readJson(ACQUISITION);
const meta = readJson(META);
const state = readJson(STATE);
state.done ??= {};
state.failed ??= {};

function recordWork(entry: Row) {
  const at = manifest.works.findIndex((work: Row) => work.slug === entry.slug);
  if (at >= 0) manifest.works[at] = entry;
  else manifest.works.push(entry);
}

function recordLead(row: Row, reason: string, note: string) {
  const path = `${row.author}/${row.work}`;
  const lead = {
    path,
    slug: slugFor(String(row.author), String(row.work)),
    title: row.title,
    author: row.author,
    genres: row.genres ?? [],
    url: workUrl(String(row.author), String(row.work)),
    reason,
    note,
    at: RETRIEVED_AT,
  };
  const at = manifest.leads.findIndex((item: Row) => item.path === path);
  if (at >= 0) manifest.leads[at] = lead;
  else manifest.leads.push(lead);
  console.log(`  ${path}: ${reason} — ${note}`);
}

if (listOnly) {
  const byReason = new Map<string, number>();
  for (const lead of manifest.leads) byReason.set(lead.reason, (byReason.get(lead.reason) ?? 0) + 1);
  console.log(`ccel manifest: ${manifest.works.length} work(s), ${manifest.leads.length} lead(s)`);
  console.log(`crawl state: ${Object.keys(state.done).length} done, ${Object.keys(state.failed).length} failed`);
  console.log(`catalogue: ${existsSync(CATALOGUE) ? (readJson(CATALOGUE).counts?.works ?? "?") : "not built"}`);
  for (const [reason, count] of [...byReason].sort((a, b) => b[1] - a[1])) console.log(`  ${count} × ${reason}`);
  for (const work of manifest.works.slice(-10)) {
    console.log(
      `  ${String(work.slug).padEnd(44)} ${String(work.chapters).padStart(5)} ch ${String(work.passages).padStart(7)} p  ${work.category}`,
    );
  }
  process.exit(0);
}

// The site's own indexes are the catalogue: titles, authors and genres, three
// sets of letter pages and one page per genre, cached so a later run does not
// ask again.
async function buildCatalogue() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const works = new Map<string, Row>();
  const authors = new Map<string, Row>();
  for (const letter of letters) {
    const titleHtml = await cachedPage(join(INDEX_CACHE, `title-${letter}.html`), `https://ccel.org/index/title/${letter}`);
    let added = 0;
    for (const work of indexedWorks(titleHtml)) {
      const key = `${work.author}/${work.work}`;
      if (works.has(key)) continue;
      works.set(key, {
        author: work.author,
        work: work.work,
        title: work.title,
        path: key,
        url: workUrl(work.author, work.work),
        textUrl: textUrl(work.author, work.work),
        genres: [] as string[],
      });
      added++;
    }
    console.log(`  titles ${letter}: ${added} new work(s) (${works.size} so far)`);

    const authorHtml = await cachedPage(join(INDEX_CACHE, `author-${letter}.html`), `https://ccel.org/index/author/${letter}`);
    for (const author of indexedAuthors(authorHtml)) {
      if (authors.has(author.slug)) continue;
      authors.set(author.slug, { slug: author.slug, label: author.label, dates: author.dates, works: 0 });
    }
  }

  // The genres name works by their path, which is how a work gets its shelf.
  const genreHtml = await cachedPage(join(INDEX_CACHE, "genre-index.html"), "https://ccel.org/index/genre");
  const genres = [
    ...genreHtml.matchAll(/href="(\/index\/genre\/[^"]+)"[^>]*>([\s\S]{0,80}?)<span[^>]*>\((\d+)\)/g),
  ].map((match) => ({ path: match[1]!, name: cleanText(match[2] ?? ""), count: Number(match[3]) }));
  console.log(`genres: ${genres.length}`);
  for (const genre of genres) {
    const file = join(INDEX_CACHE, `genre-${genre.path.split("/").pop()}.html`);
    const html = await cachedPage(file, `https://ccel.org${genre.path}`);
    let tagged = 0;
    for (const work of indexedWorks(html)) {
      const row = works.get(`${work.author}/${work.work}`);
      if (!row) continue;
      if (!Array.isArray(row.genres)) row.genres = [];
      if (!row.genres.includes(genre.name)) row.genres.push(genre.name);
      tagged++;
    }
    console.log(`  genre ${genre.name}: ${tagged} work(s) tagged`);
  }

  for (const work of works.values()) {
    const author = authors.get(String(work.author));
    if (author) author.works++;
  }

  const catalogue = {
    version: 1,
    source: "ccel",
    sourceUrl: "https://ccel.org/",
    generatedAt: RETRIEVED_AT,
    note:
      "Every work the Christian Classics Ethereal Library lists in its title index, with the authors and genres its " +
      "own browse pages record and the plain-text address of each work where the site publishes one.",
    counts: { works: works.size, authors: authors.size, genres: genres.length },
    works: [...works.values()],
    authors: [...authors.values()],
  };
  if (!dryRun) {
    writeJson(CATALOGUE, catalogue);
    writeJson(AUTHORS, {
      version: 1,
      source: "ccel",
      generatedAt: RETRIEVED_AT,
      note:
        "The site's author index. Names and dates are the Christian Classics Ethereal Library's own; a person is " +
        "added to the corpus by the importer when one of their works is imported, not by the catalogue.",
      authors: catalogue.authors,
    });
  }
  console.log(`catalogue: ${works.size} work(s), ${authors.size} author(s) written to ${CATALOGUE}`);
  return catalogue;
}

function catalogueWorks(): Row[] {
  if (!existsSync(CATALOGUE)) throw new Error(`no catalogue at ${CATALOGUE}; run --catalogue first`);
  return (readJson(CATALOGUE).works ?? []) as Row[];
}

function personFor(author: string): Row | null {
  if (!existsSync(AUTHORS)) return null;
  const row = (readJson(AUTHORS).authors ?? []).find((entry: Row) => entry.slug === author) as Row | undefined;
  if (!row) return null;
  return personOf(String(row.slug), String(row.label ?? row.slug), String(row.dates ?? ""));
}

let imported = 0;
let failed = 0;
let skipped = 0;
let overlapped = 0;
const budgetSpent = () => limit > 0 && imported >= limit;

/** A work the library already holds, under this slug or another of its editions. */
function overlapFor(row: Row, person: Row | null, held: { byTitle: Map<string, Held>; list: Held[] }) {
  const title = String(row.title);
  const norm = normalizeTitle(title);
  const exact = held.byTitle.get(norm);
  if (exact) return { held: exact, kind: "the same title" };
  if (!person) return null;
  const words = keyWords(title);
  if (!words.length) return null;
  const prefix = `${person.slug}-`;
  for (const candidate of held.list) {
    if (!candidate.slug.startsWith(prefix)) continue;
    if (words.some((word) => candidate.norm.includes(word))) return { held: candidate, kind: "another edition of a work already held" };
  }
  return null;
}

function register(entry: Entry, ctx: { streams: Row; functions: Row; meta: Row; acquisition: Row }) {
  const record = writeWork(entry, ctx);
  state.done[`${entry.author}/${entry.work}`] = {
    slug: entry.slug,
    title: record.title,
    chapters: entry.parsed.chapters.length,
    passages: record.passages,
    words: record.words,
    scheme: entry.parsed.scheme,
    category: record.category,
    genres: entry.genres,
    at: RETRIEVED_AT,
  };
  delete state.failed[`${entry.author}/${entry.work}`];
  // A work that is imported is not a lead; a lead left from an earlier pass may
  // still stand in the manifest until the sweep in saveAll drops it.
  manifest.leads = manifest.leads.filter((lead: Row) => lead.slug !== entry.slug);
  imported++;
  saveShared();
  recordWork(record);
  markTarget(record, ctx.acquisition);
  console.log(
    `  ${entry.slug}: ${entry.parsed.chapters.length} chapter(s), ${record.passages} ${record.scheme === "chapter.verse" ? "verse(s)" : "paragraph(s)"}, ${record.words.toLocaleString()} words [${record.category}]`,
  );
  return record;
}

function readCachedOrFetch(slug: string, _row: Row): string | null {
  const file = join(TEXT_CACHE, `${slug}.txt`);
  if (existsSync(file) && !force) return readFileSync(file, "utf8");
  return null;
}

/** A JSON string field near the head of a work file, without parsing the text. */
function headField(head: string, name: string): string | null {
  const raw = new RegExp(`"${name}":\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(head)?.[1];
  if (!raw) return null;
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return null;
  }
}

/**
 * Puts the manifest, the function map and the author list back in step with the
 * corpus. A crawl of hundreds of works runs for hours and can be interrupted —
 * by a closed terminal, a machine gone to sleep, a stopped container — and the
 * records of the works already written live in three files that are written at
 * the end of a run. This reads back what the works on disk already say, so a
 * stopped crawl is only a stopped crawl and not lost work.
 */
function reconcile(ctx: { streams: Row; functions: Row; meta: Row; acquisition: Row }) {
  const people = new Map<string, Row>();
  if (existsSync(AUTHORS)) {
    for (const row of readJson(AUTHORS).authors ?? []) {
      people.set(String(row.slug), personOf(String(row.slug), String(row.label ?? row.slug), String(row.dates ?? "")));
    }
  }
  let works = 0;
  let functions = 0;
  let authors = 0;
  for (const row of catalogueRows) {
    const path = `${row.author}/${row.work}`;
    const slug = slugFor(String(row.author), String(row.work));
    const file = join(WORKS, `${slug}.json`);
    if (!existsSync(file)) continue;
    const info = (state.done as Record<string, Row>)[path] ?? null;
    if (info?.overlap || info?.lead) continue;
    const person = people.get(String(row.author)) ?? null;
    const genres = Array.isArray(info?.genres) ? info.genres.map(String) : (row.genres ?? []).map(String);
    let title = String(info?.title ?? "") || String(row.title ?? slug);
    let work: Row | null = null;
    if (!manifest.works.some((entry: Row) => entry.slug === slug)) {
      try {
        work = readJson(file);
      } catch {
        continue;
      }
      title = String(work.title ?? title);
      manifest.works.push({
        slug,
        title,
        author: person?.name ?? String(row.author),
        path,
        url: workUrl(String(row.author), String(row.work)),
        textUrl: textUrl(String(row.author), String(row.work)),
        tradition: "christianity",
        category: String(work.category ?? ""),
        genres,
        chapters: Array.isArray(work.chapters) ? work.chapters.length : 0,
        passages: Array.isArray(work.passages) ? work.passages.length : 0,
        words: Number(info?.words ?? 0),
        scheme: String(work.refScheme ?? "chapter.paragraph"),
        printBasis: "",
        rights: "",
        retrieved_at: RETRIEVED_AT,
        reconciled: true,
      });
      works++;
    } else if (info) {
      title = String(info.title ?? title);
    }
    const before = ctx.meta.authors.length;
    ensureAuthor(person, ctx.meta, title);
    if (ctx.meta.authors.length > before) authors++;
    // A work with no function at all is not classified: an entry that names no
    // function leaves the corpus's own check nothing to read.
    if (!ctx.functions.works[slug]?.functions?.length) {
      const shelf = shelfFor(genres);
      ctx.functions.works[slug] = {
        functions: shelf.functions,
        status: "provisional",
        assignedBy: "UWL editors (CCEL genre map)",
        note: `${title} — ${shelf.category}. Recovered by the CCEL import from the text already on disk.`,
      };
      functions++;
    }
  }
  if (works || functions || authors) {
    console.log(`reconciled from disk: ${works} work record(s), ${functions} function entry/entries, ${authors} author(s)`);
  }
}

async function importOne(row: Row, held: { byTitle: Map<string, Held>; list: Held[] }, ctx: { streams: Row; functions: Row; meta: Row; acquisition: Row }) {
  const path = `${row.author}/${row.work}`;
  const slug = slugFor(String(row.author), String(row.work));
  if (!force && (state.done[path] || existsSync(join(WORKS, `${slug}.json`)))) {
    skipped++;
    return;
  }
  const person = personFor(String(row.author));
  const overlap = overlapFor(row, person, held);
  if (overlap) {
    overlapped++;
    const note = `${row.title} is already held as ${overlap.held.slug} (${overlap.kind}); this record was not written again.`;
    console.log(`  ${path}: ${note}`);
    const at = manifest.leads.findIndex((item: Row) => item.path === path);
    const lead = {
      path,
      slug,
      title: row.title,
      author: row.author,
      url: workUrl(String(row.author), String(row.work)),
      reason: "already held",
      note,
      heldAs: overlap.held.slug,
      at: RETRIEVED_AT,
    };
    if (at >= 0) manifest.leads[at] = lead;
    else manifest.leads.push(lead);
    state.done[path] = { slug: overlap.held.slug, overlap: true, at: RETRIEVED_AT };
    return;
  }
  try {
    const cached = readCachedOrFetch(slug, row);
    const text = cached ?? (await getPage(textUrl(String(row.author), String(row.work))));
    if (!cached && !dryRun) writeFileSync(join(TEXT_CACHE, `${slug}.txt`), text);
    const card = ccelCard(text);
    if (card.title && !titlesAgree(card.title, String(row.title))) {
      recordLead(
        row,
        "no text of its own on the site",
        `the plain-text file the site serves for this work is its volume's text, “${card.title.slice(0, 90)}…”`, 
      );
      state.done[path] = { slug, lead: true, at: RETRIEVED_AT };
      state.updatedAt = RETRIEVED_AT;
      return;
    }
    // The site's own copyright page records its books as public domain, some of
    // them carried by a publisher's permission and marked as such on the work's
    // card. A card that names another rights position is a lead, not an import;
    // a card that states none is read as public domain on that page's word, with
    // the silence recorded on the edition.
    const rights = (card.rights ?? "").trim();
    if (rights && !/public domain|public-domain|cc0|creative commons/i.test(rights)) {
      recordLead(row, "rights not public domain", `the site's card states: “${rights}”`);
      state.failed[path] = { error: `rights: ${rights}`, at: RETRIEVED_AT };
      return;
    }
    const parsed = parseCcel(text, String(row.title));
    if (!parsed.chapters.length) {
      recordLead(row, "no text", "the plain-text file the site publishes holds no paragraphs");
      state.failed[path] = { error: "empty plain text", at: RETRIEVED_AT };
      return;
    }
    const entry: Entry = {
      author: String(row.author),
      work: String(row.work),
      slug,
      title: String(row.title),
      genres: Array.isArray(row.genres) ? row.genres.map(String) : [],
      card,
      head: text.slice(0, 4000),
      person,
      parsed,
    };
    if (dryRun) {
      console.log(
        `  ${path}: ${parsed.chapters.length} chapter(s), ${parsed.chapters.reduce((n, c) => n + c.paragraphs.length, 0)} paragraph(s) [${parsed.scheme}] ${rights}`,
      );
      console.log(`    ${parsed.chapters[0]!.label}: ${parsed.chapters[0]!.paragraphs[0]!.slice(0, 110)}`);
      return;
    }
    register(entry, ctx);
  } catch (err) {
    if (err instanceof NotFound) {
      recordLead(row, "no plain text on the site", "the site offers no plain-text file for this work; a PDF or ebook edition is catalogued at its own page");
    } else {
      failed++;
      state.failed[path] = { error: (err as Error).message, at: RETRIEVED_AT };
      console.error(`  ${path}: ${(err as Error).message}`);
    }
  }
  state.updatedAt = RETRIEVED_AT;
}

/**
 * The three files the corpus's own consistency rests on — the function map and
 * the authors (which `db:reset` validates), and the crawl state — are written
 * after every work, so the corpus is consistent at any moment a run is stopped.
 */
function saveShared() {
  if (dryRun) return;
  state.updatedAt = RETRIEVED_AT;
  writeJson(STATE, state);
  writeJson(FUNCTIONS, functions);
  writeJson(META, meta);
}

/** Writes everything a run has changed, so a long crawl loses nothing. */
function saveAll() {
  // A work is either held or a lead, never both.
  const held = new Set(manifest.works.map((work: Row) => work.slug));
  manifest.leads = manifest.leads.filter((lead: Row) => !held.has(lead.slug));
  manifest.totals = {
    works: manifest.works.length,
    chapters: manifest.works.reduce((sum: number, work: Row) => sum + (work.chapters ?? 0), 0),
    passages: manifest.works.reduce((sum: number, work: Row) => sum + (work.passages ?? 0), 0),
    words: manifest.works.reduce((sum: number, work: Row) => sum + (work.words ?? 0), 0),
    leads: manifest.leads.length,
  };
  manifest.generatedAt = RETRIEVED_AT;
  state.updatedAt = RETRIEVED_AT;
  if (dryRun) return;
  writeJson(MANIFEST, manifest);
  writeJson(STREAMS, streams);
  writeJson(FUNCTIONS, functions);
  writeJson(ACQUISITION, acquisition);
  writeJson(META, meta);
  writeJson(STATE, state);
}

if (catalogueOnly) {
  await buildCatalogue();
} else {
  const catalogue = catalogueWorks();
  catalogueRows = catalogue;
  const ctx = { streams, functions, meta, acquisition };
  const held = loadHeld();
  console.log(`corpus already holds ${held.list.length} work(s); ${DELAY_MS / 1000}s between requests`);
  if (pathOnly) {
    const [author, work] = pathOnly.split("/");
    const row =
      catalogue.find((candidate: Row) => candidate.author === author && candidate.work === work) ?? {
        author,
        work,
        title: work,
        genres: [],
      };
    await importOne(row, held, ctx);
  } else if (fromCache) {
    reconcile(ctx);
    saveAll();
    for (const row of catalogue) {
      if (budgetSpent()) break;
      const slug = slugFor(String(row.author), String(row.work));
      if (!existsSync(join(TEXT_CACHE, `${slug}.txt`))) continue;
      if (!force && state.done[`${row.author}/${row.work}`]) continue;
      await importOne(row, held, ctx);
    }
  } else {
    const selected = genreOnly
      ? catalogue.filter((row: Row) =>
          (row.genres ?? []).some((genre: string) => genre.toLowerCase() === genreOnly.toLowerCase()),
        )
      : catalogue;
    if (genreOnly && !selected.length) {
      console.error(`No catalogue work carries the genre ${genreOnly}.`);
      process.exit(1);
    }
    console.log(`${selected.length} catalogue work(s) to consider${dryRun ? " (dry run)" : ""}`);
    reconcile(ctx);
    saveAll();
    let sinceSave = 0;
    for (const row of selected) {
      if (budgetSpent()) break;
      await importOne(row, held, ctx);
      if (++sinceSave >= 10) {
        sinceSave = 0;
        saveAll();
      }
    }
  }
}

if (!catalogueOnly) saveAll();
if (catalogueOnly) process.exit(0);

console.log(
  `\nImported ${imported} work(s) this run; ${skipped} already held; ${overlapped} held as another edition; ` +
    `${failed} failure(s), ${manifest.leads.length} lead(s) in all; ${metrics.requests} request(s), ${metrics.failures} retr${metrics.failures === 1 ? "y" : "ies"}.`,
);
console.log(
  `ccel now holds ${manifest.totals.works} work(s), ${manifest.totals.chapters} chapter(s), ` +
    `${manifest.totals.passages.toLocaleString()} passage(s).`,
);
