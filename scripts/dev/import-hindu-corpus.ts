// Imports a further batch of Hindu texts as streamed works.
//
// The importer retrieves each chapter once, validates the segmentation, writes
// the catalogue record and passage index, and keeps the exact reviewed segments
// in data/imports/cache/hindu/<slug>.json. The cache lets the search indexer
// build stream_fts without crawling the host a second time, and lets a later
// run resume a long work (the Rigveda is imported book by book).
//
// Sources in this batch:
//   * Project Gutenberg — Ganguli's Mahabharata (4 volumes), Dutt's Harivamsha
//     and Dutt's Vishnu Purana.
//   * English Wikisource — Keith's Taittiriya Samhita (Black Yajurveda),
//     Shamasastry's Arthashastra, and Griffith's Rigveda (Book 1, resumable).
//
//   bun run scripts/dev/import-hindu-corpus.ts
//   bun run scripts/dev/import-hindu-corpus.ts --only=mahabharata
//   bun run scripts/dev/import-hindu-corpus.ts --only=rigveda --rigveda-hymns=191
//   bun run scripts/dev/import-hindu-corpus.ts --force --only=vishnu-purana
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractHtmlSegments,
  extractWikisourceSegments,
  packSentences,
  plaintextParagraphs,
  splitPlaintextChapters,
  type PlaintextAnchor,
} from "../../server/stream";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");
const STREAMS = join(ROOT, "data", "registry", "streams.json");
const FUNCTIONS = join(ROOT, "data", "corpus", "text-functions.json");
const MANIFEST = join(ROOT, "data", "imports", "hindu-corpus.json");
const CACHE = join(ROOT, "data", "imports", "cache", "hindu");
const RETRIEVED_AT = new Date().toISOString().slice(0, 10);
const USER_AGENT = "UniversalWisdomLibrary/1.0 (local reading interface; Hindu corpus import)";

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.split("=").slice(1).join("=") ?? "";
const force = args.includes("--force");
const rigvedaBudget = Math.max(
  1,
  Math.min(1028, Number(args.find((a) => a.startsWith("--rigveda-hymns="))?.split("=")[1] ?? 1028)),
);

type Row = Record<string, any>;
type Chapter = { ref: string; label: string; segments: string[] };
type CachedWork = {
  version: number;
  slug: string;
  provider: string;
  sourceUrl: string;
  generatedAt: string;
  complete: boolean;
  sectionsTotal: number;
  sectionsImported: number;
  config: Row;
  chapters: Chapter[];
};

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const trimGutenberg = (text: string, marker = "*** END OF THE PROJECT GUTENBERG") => {
  const index = text.indexOf(marker);
  return index > 0 ? text.slice(0, index) : text;
};

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

/** The provider key recorded in streams.json for an import source. */
function providerSlug(source: WorkMeta["source"]): string {
  return source === "project-gutenberg" ? "gutenberg" : source;
}

async function fetchText(url: string, timeoutMs = 120_000): Promise<string> {
  let last: Error | null = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "text/plain,text/html,application/json", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) {
        last = new Error(`${url} returned ${res.status}`);
        await Bun.sleep(2_000 * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      return await res.text();
    } catch (err) {
      last = err as Error;
      if (attempt < 5) await Bun.sleep(800 * attempt);
    }
  }
  throw last ?? new Error(`${url} failed`);
}

// The Internet Sacred Text Archive serves static HTML: the chapter text sits
// between the page's top navigation rule and the footer navigation block. The
// same extractor the reader uses is applied here so the import and the reader
// cannot disagree about where a paragraph begins.
const SACRED_TEXTS_SEGMENTATION = {
  startMarker: "<HR>",
  endMarker: "<nav role=",
  split: "paragraphs" as const,
};

async function sacredTextsSegments(url: string): Promise<string[]> {
  const html = await fetchText(url, 120_000);
  const segments = extractHtmlSegments(html, SACRED_TEXTS_SEGMENTATION);
  if (!segments.length) throw new Error(`${url} returned no chapter text`);
  return segments;
}

// Wikisource rate-limits anonymous clients. One request at a time with a short
// gap finishes reliably; the REST HTML endpoint is tried first because it is
// cached at the edge, with the parse API as a fallback for pages it does not
// serve. A 429 widens the gap instead of hammering the host.
let wikiNextAt = 0;
let wikiGap = 1_100;
async function wikisourceSegments(title: string): Promise<string[]> {
  const wait = wikiNextAt - Date.now();
  if (wait > 0) await Bun.sleep(wait);
  wikiNextAt = Date.now() + wikiGap;
  const encoded = encodeURIComponent(title.replaceAll(" ", "_"));
  const restUrl = `https://en.wikisource.org/api/rest_v1/page/html/${encoded}`;
  const parseUrl = new URL("https://en.wikisource.org/w/api.php");
  parseUrl.searchParams.set("action", "parse");
  parseUrl.searchParams.set("page", title);
  parseUrl.searchParams.set("prop", "text");
  parseUrl.searchParams.set("format", "json");
  parseUrl.searchParams.set("formatversion", "2");

  let last: Error | null = null;
  for (let attempt = 1; attempt <= 8; attempt++) {
    if (wikiNextAt > Date.now()) await Bun.sleep(wikiNextAt - Date.now());
    wikiNextAt = Date.now() + wikiGap;
    try {
      const res = await fetch(restUrl, { headers: { "user-agent": USER_AGENT } });
      if (res.status === 429) {
        last = new Error(`${title} was rate-limited`);
        wikiGap = Math.min(4_000, wikiGap + 600);
        await Bun.sleep(3_000 * attempt);
        continue;
      }
      if (res.ok) {
        const segments = extractWikisourceSegments(await res.text());
        if (segments.length) {
          wikiGap = Math.max(1_100, wikiGap - 100);
          return segments;
        }
      }
      if (res.status !== 404) throw new Error(`${title} returned ${res.status}`);
      break;
    } catch (err) {
      last = err as Error;
      if (attempt < 8) await Bun.sleep(1_500 * attempt);
    }
  }

  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(parseUrl, { headers: { "user-agent": USER_AGENT } });
      if (res.status === 429) {
        last = new Error(`${title} was rate-limited`);
        wikiNextAt = Date.now() + 8_000 * attempt;
        await Bun.sleep(8_000 * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`${title} returned ${res.status}`);
      const body = JSON.parse(await res.text());
      const html = String(body?.parse?.text ?? "");
      if (!html) throw new Error(`${title} returned no page text`);
      const segments = extractWikisourceSegments(html);
      if (!segments.length) throw new Error(`${title} returned no readable paragraphs`);
      return segments;
    } catch (err) {
      last = err as Error;
      if (attempt < 6) await Bun.sleep(2_000 * attempt);
    }
  }
  throw last ?? new Error(`${title} failed`);
}

// Wikisource prefixes proofread pages with a licence/source banner. It is page
// furniture, not text, so it is dropped before the segments are indexed.
const WIKISOURCE_BOILERPLATE =
  /^(This work is a translation|This work was published|This work is in the public domain|Public domain|The following is a translation|Translated into English|Translation by)\b/i;

function trimBoilerplate(segments: string[]): string[] {
  let start = 0;
  while (start < segments.length && WIKISOURCE_BOILERPLATE.test(segments[start]!)) start++;
  return segments.slice(start);
}

function applyTrim(segments: string[], pattern?: string): string[] {
  if (!pattern) return segments;
  const trim = new RegExp(pattern, "i");
  let start = 0;
  while (start < segments.length && trim.test(segments[start]!)) start++;
  return segments.slice(start);
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

function cachePath(slug: string) {
  return join(CACHE, `${slug}.json`);
}

function readCache(slug: string): CachedWork | null {
  const path = cachePath(slug);
  if (!existsSync(path)) return null;
  try {
    const parsed = readJson(path) as CachedWork;
    return Array.isArray(parsed.chapters) && parsed.chapters.length ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(slug: string, data: CachedWork) {
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(cachePath(slug), `${JSON.stringify(data, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Project Gutenberg parsers
// ---------------------------------------------------------------------------

function indentedBookName(lines: string[], bookLine: number) {
  for (let i = bookLine + 1; i < Math.min(lines.length, bookLine + 8); i++) {
    const line = lines[i]!.trim();
    if (line) return line.replace(/\s+/g, " ");
  }
  return "";
}

// Each volume repeats a title page before its first book, and Books 8–11 and
// 16–18 begin with one. The credit lines run past the anchored keywords, so the
// trailing text has to be allowed or the whole title page stays in the text.
const MBH_TRIM =
  "^(?:[A-Z][A-Za-z-]*-parva|Translated into English Prose.*|by|Kisari Mohan Ganguli|\\[1883-1896\\]|Scanned and Proofed.*|Additional proofing.*|formatting at sacred-texts.*|\\d+)$";

function trimRawLines(text: string, pattern: string): string {
  const trim = new RegExp(pattern, "i");
  const lines = text.split(/\r?\n/);
  let start = 0;
  while (start < lines.length && (!lines[start]!.trim() || trim.test(lines[start]!.trim()))) start++;
  return lines.slice(start).join("\n");
}

function parseMahabharataVolume(text: string, volumeIndex: number): { chapters: Chapter[]; anchors: PlaintextAnchor[] } {
  const lines = trimGutenberg(text).replace(/\r\n/g, "\n").split("\n");
  const books = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter((entry) => /^BOOK\s+\d+$/i.test(entry.line))
    .map((entry) => ({
      ...entry,
      number: Number(entry.line.replace(/\D+/g, "")),
      name: indentedBookName(lines, entry.index),
    }));
  // Section headings run past LXXXIX (XC, CD, M), and some volumes wrap them
  // in quotation marks. The numeral class must therefore cover all seven
  // Roman letters: an earlier [IVXL] silently truncated every book at section
  // 89, which is why the importer now validates each book's headings below.
  const sectionRe = /^["\u201c]?SECTION\s+[IVXLCDM]+(?:\s*[-–]\s*[IVXLCDM]+)?\.?["\u201d]?$/i;
  const looseSectionRe = /^["\u201c]?SECTIONS?\s+\S{1,12}\.?\s*["\u201d]?$/i;
  const sections = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter((entry) => sectionRe.test(entry.line));
  const chapters: Chapter[] = [];
  const anchors: PlaintextAnchor[] = [];
  const seenMarkers = new Map<string, number>();

  for (const [bookIndex, book] of books.entries()) {
    const bookEnd = books[bookIndex + 1]?.index ?? lines.length;
    const bookSections = sections.filter((section) => section.index > book.index && section.index < bookEnd);
    // A heading that looks like a section but is not matched would drop text
    // without a trace. Count them independently and fail rather than ship a
    // book with a silent gap.
    const loose = lines
      .slice(book.index + 1, bookEnd)
      .map((line) => line.trim())
      .filter((line) => looseSectionRe.test(line)).length;
    if (loose !== bookSections.length) {
      throw new Error(
        `Mahabharata volume ${volumeIndex}: Book ${book.number} has ${loose} section headings but ${bookSections.length} were matched`,
      );
    }
    // Books 8–11 and 16–18 are printed without SECTION headings in this
    // edition; each book is one continuous chapter there.
    if (!bookSections.length) {
      const body = trimRawLines(lines.slice(book.index + 1, bookEnd).join("\n"), MBH_TRIM);
      const segments = plaintextParagraphs(body);
      if (!segments.length) {
        throw new Error(`Mahabharata volume ${volumeIndex}: Book ${book.number} has no text`);
      }
      const ref = `${book.number}.1`;
      chapters.push({ ref, label: `Book ${book.number} — ${book.name || `Book ${book.number}`}`, segments });
      anchors.push({ ref, marker: `BOOK ${book.number}`, trimStartPattern: MBH_TRIM });
      continue;
    }
    for (const [sectionIndex, section] of bookSections.entries()) {
      const next = bookSections[sectionIndex + 1]?.index ?? bookEnd;
      const body = lines.slice(section.index + 1, next).join("\n");
      const segments = plaintextParagraphs(body);
      if (!segments.length) {
        throw new Error(`Mahabharata volume ${volumeIndex}: Book ${book.number} section ${section.line} has no text`);
      }
      const roman = section.line
        .replace(/^["\u201c]?SECTION\s+/i, "")
        .replace(/["\u201d]?\.?$/, "");
      const subtitle = lines
        .slice(section.index + 1, Math.min(next, section.index + 6))
        .map((line) => line.trim())
        .find((line) => /^\(.+\)$/.test(line));
      const ref = `${book.number}.${sectionIndex + 1}`;
      const label = `Book ${book.number} — ${book.name || `Book ${book.number}`}, Section ${roman}${
        subtitle ? ` (${subtitle.replace(/^\(|\)$/g, "")})` : ""
      }`;
      const marker = section.line;
      const occurrenceIndex = seenMarkers.get(marker) ?? 0;
      seenMarkers.set(marker, occurrenceIndex + 1);
      chapters.push({ ref, label, segments });
      anchors.push({ ref, marker, occurrenceIndex });
    }
  }
  return { chapters, anchors };
}

// The Project Gutenberg volumes do not divide the epic where the printed set
// does: volume 3 carries Books 8–12 and volume 4 Books 13–18.
const MBH_VOLUMES = [
  { id: 15474, bookRange: "Books 1–3" },
  { id: 15475, bookRange: "Books 4–7" },
  { id: 15476, bookRange: "Books 8–12" },
  { id: 15477, bookRange: "Books 13–18" },
];

async function buildMahabharata(): Promise<{ chapters: Chapter[]; config: Row; sectionsTotal: number }> {
  const chapters: Chapter[] = [];
  const volumes: Row[] = [];
  for (const [index, volume] of MBH_VOLUMES.entries()) {
    const textUrl = `https://www.gutenberg.org/cache/epub/${volume.id}/pg${volume.id}.txt`;
    const sourceUrl = `https://www.gutenberg.org/ebooks/${volume.id}`;
    const text = await fetchText(textUrl);
    const parsed = parseMahabharataVolume(text, index + 1);
    if (!parsed.chapters.length) throw new Error(`volume ${volume.id} yielded no sections`);
    chapters.push(...parsed.chapters);
    volumes.push({ textUrl, sourceUrl, anchors: parsed.anchors });
    console.log(`  Mahabharata volume ${index + 1}: ${parsed.chapters.length} sections (${volume.bookRange})`);
  }
  const bookNumbers = new Set(chapters.map((chapter) => Number(chapter.ref.split(".")[0])));
  for (let book = 1; book <= 18; book++) {
    if (!bookNumbers.has(book)) throw new Error(`Mahabharata parsing is missing Book ${book}`);
  }
  return {
    chapters,
    config: { volumes, sourceUrl: "https://www.gutenberg.org/ebooks/15474" },
    sectionsTotal: chapters.length,
  };
}

function parseHarivamsha(text: string): { chapters: Chapter[]; anchors: PlaintextAnchor[] } {
  const lines = trimGutenberg(text).replace(/\r\n/g, "\n").split("\n");
  const prelude = lines.findIndex((line) => /^THE PRELUDE\.?$/i.test(line.trim()));
  if (prelude < 0) throw new Error("Harivamsha: no body opening found");
  const headings = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(
      (entry) =>
        entry.index > prelude &&
        /^CHAPTER\.?\s+[IVXL]+\./i.test(entry.line) &&
        !/\.{3,}/.test(entry.line) &&
        entry.line.length < 240,
    );
  const chapters: Chapter[] = [];
  const anchors: PlaintextAnchor[] = [];
  const seenMarkers = new Map<string, number>();
  for (const [index, heading] of headings.entries()) {
    const next = headings[index + 1]?.index ?? lines.length;
    const segments = plaintextParagraphs(lines.slice(heading.index + 1, next).join("\n"));
    if (!segments.length) throw new Error(`Harivamsha chapter ${index + 1} has no text`);
    const roman = /^CHAPTER\.?\s+([IVXL]+)\./i.exec(heading.line)?.[1] ?? String(index + 1);
    const title = heading.line.replace(/^CHAPTER\.?\s+[IVXL]+\.\s*/i, "").trim();
    const ref = String(index + 1);
    const occurrenceIndex = seenMarkers.get(heading.line) ?? 0;
    seenMarkers.set(heading.line, occurrenceIndex + 1);
    chapters.push({
      ref,
      label: `Chapter ${roman}${title ? ` — ${title}` : ""}`,
      segments,
    });
    anchors.push({ ref, marker: heading.line, occurrenceIndex });
  }
  if (chapters.length !== 137) {
    throw new Error(`Harivamsha parsing produced ${chapters.length} chapters; expected 137`);
  }
  return { chapters, anchors };
}

async function buildHarivamsha(): Promise<{ chapters: Chapter[]; config: Row; sectionsTotal: number }> {
  const textUrl = "https://www.gutenberg.org/cache/epub/61937/pg61937.txt";
  const sourceUrl = "https://www.gutenberg.org/ebooks/61937";
  const parsed = parseHarivamsha(await fetchText(textUrl));
  return {
    chapters: parsed.chapters,
    config: { textUrl, sourceUrl, anchors: parsed.anchors },
    sectionsTotal: parsed.chapters.length,
  };
}

function parseVishnuPurana(text: string): { chapters: Chapter[]; anchors: PlaintextAnchor[] } {
  const lines = trimGutenberg(text).replace(/\r\n/g, "\n").split("\n");
  // The first half of the file is a detailed table of contents. The body
  // starts at the first PART heading after it and prints section headings in
  // capitals, which lets the TOC be excluded without guessing line numbers.
  const bodyStart = lines.findIndex((line, index) => index > 500 && /^PART\s+I\.?$/i.test(line.trim()));
  if (bodyStart < 0) throw new Error("Vishnu Purana: no body opening found");
  const parts = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter((entry) => entry.index >= bodyStart && /^PART\s+[IVXL]+\.?$/i.test(entry.line));
  const headings = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter((entry) => entry.index > bodyStart && /^SECTION\s+[IVXL]+\.?$/i.test(entry.line));
  const chapters: Chapter[] = [];
  const anchors: PlaintextAnchor[] = [];
  const seenMarkers = new Map<string, number>();
  for (const [index, heading] of headings.entries()) {
    const next = headings[index + 1]?.index ?? lines.length;
    const segments = plaintextParagraphs(lines.slice(heading.index + 1, next).join("\n"));
    if (!segments.length) throw new Error(`Vishnu Purana section ${index + 1} has no text`);
    const roman = /^SECTION\s+([IVXL]+)\.?/i.exec(heading.line)?.[1] ?? String(index + 1);
    const part = [...parts].reverse().find((candidate) => candidate.index < heading.index);
    const partRoman = part ? /^PART\s+([IVXL]+)/i.exec(part.line)?.[1] ?? "" : "";
    const ref = String(index + 1);
    const occurrenceIndex = seenMarkers.get(heading.line) ?? 0;
    seenMarkers.set(heading.line, occurrenceIndex + 1);
    chapters.push({
      ref,
      label: `${partRoman ? `Part ${partRoman}, ` : ""}Section ${roman}`,
      segments,
    });
    anchors.push({ ref, marker: heading.line, occurrenceIndex });
  }
  if (chapters.length !== 126) {
    throw new Error(`Vishnu Purana parsing produced ${chapters.length} sections; expected 126`);
  }
  return { chapters, anchors };
}

async function buildVishnuPurana(): Promise<{ chapters: Chapter[]; config: Row; sectionsTotal: number }> {
  const textUrl = "https://www.gutenberg.org/cache/epub/66208/pg66208.txt";
  const sourceUrl = "https://www.gutenberg.org/ebooks/66208";
  const parsed = parseVishnuPurana(await fetchText(textUrl));
  return {
    chapters: parsed.chapters,
    config: { textUrl, sourceUrl, anchors: parsed.anchors },
    sectionsTotal: parsed.chapters.length,
  };
}

// ---------------------------------------------------------------------------
// Wikisource parsers
// ---------------------------------------------------------------------------

// Keith's seven kandas are read from the Internet Sacred Text Archive, which
// carries the complete 1914 translation as one page per kanda. Wikisource has
// only Kanda I transcribed, so it cannot serve the complete work.
const YAJURVEDA_KANDAS = ["I", "II", "III", "IV", "V", "VI", "VII"];
const ARTHASHASTRA_BOOKS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV"];

async function buildYajurveda(): Promise<{
  chapters: Chapter[];
  config: Row;
  sectionsTotal: number;
  sectionsImported: number;
  complete: boolean;
}> {
  const chapters: Chapter[] = [];
  const pages: { title: string; url: string }[] = [];
  for (const [index, kanda] of YAJURVEDA_KANDAS.entries()) {
    const title = `Kanda ${kanda}`;
    const url = `https://archive.sacred-texts.com/hin/yv/yv${String(index + 1).padStart(2, "0")}.htm`;
    const segments = await sacredTextsSegments(url);
    chapters.push({ ref: String(index + 1), label: `Kanda ${kanda}`, segments });
    pages.push({ title, url });
    console.log(`  Taittiriya Samhita Kanda ${kanda}: ${segments.length} paragraphs`);
  }
  return {
    chapters,
    config: {
      pages,
      ...SACRED_TEXTS_SEGMENTATION,
      sourceUrl: "https://archive.sacred-texts.com/hin/yv/index.htm",
    },
    sectionsTotal: 7,
    sectionsImported: chapters.length,
    complete: true,
  };
}

// Dutt's Uttara Kanda prints each sarga as "SECTION <numeral>." on a line of
// its own, followed by prose paragraphs. The numerals after C are corrupt in
// this transcription (CIIII, CIXL, a repeated SECTION LXXXV), so sections are
// numbered by their order in the volume and the anchors record the printed
// heading only as the split marker.
const UTTARA_KANDA_WORDS = 120;

function parseUttaraKanda(text: string): { chapters: Chapter[]; anchors: PlaintextAnchor[] } {
  const source = trimGutenberg(text).replace(/\r\n/g, "\n");
  const headings = [...source.matchAll(/(?:^|\n)[ \t]*(SECTION[ \t]+[IVXLC]+\.)[ \t]*\n/g)];
  if (headings.length < 100) throw new Error(`Uttara Kanda: found only ${headings.length} section headings`);
  const anchors: PlaintextAnchor[] = [];
  const seen = new Map<string, number>();
  for (const [index, heading] of headings.entries()) {
    const marker = heading[1]!;
    const occurrenceIndex = seen.get(marker) ?? 0;
    seen.set(marker, occurrenceIndex + 1);
    anchors.push({ ref: String(index + 1), marker, occurrenceIndex });
  }
  const split = splitPlaintextChapters(source, anchors);
  const chapters = anchors.map((anchor) => {
    // The transcription prints each sarga as one hard-wrapped block; repack it
    // into paragraphs exactly as the reader will.
    const segments = packSentences(
      plaintextParagraphs(split.get(anchor.ref) ?? "").join(" "),
      UTTARA_KANDA_WORDS,
    );
    if (!segments.length) throw new Error(`Uttara Kanda section ${anchor.ref} has no text`);
    return { ref: anchor.ref, label: `Section ${anchor.ref}`, segments };
  });
  if (chapters.length !== anchors.length) throw new Error("Uttara Kanda: a section heading could not be split");
  return { chapters, anchors };
}

async function buildUttaraKanda(): Promise<{ chapters: Chapter[]; config: Row; sectionsTotal: number }> {
  const textUrl = "https://www.gutenberg.org/cache/epub/62496/pg62496.txt";
  const sourceUrl = "https://www.gutenberg.org/ebooks/62496";
  const parsed = parseUttaraKanda(await fetchText(textUrl));
  console.log(`  Uttara Kanda: ${parsed.chapters.length} sections`);
  return {
    chapters: parsed.chapters,
    config: { textUrl, sourceUrl, anchors: parsed.anchors, paragraphWords: UTTARA_KANDA_WORDS },
    sectionsTotal: parsed.chapters.length,
  };
}

const ARTHASHASTRA_TRIM =
  "^(Kautilya\\.|Kautilya's Arthashastra|Book\\s+[IVXL]+|Contents:|The end of Sciences;)";

async function buildArthashastra(): Promise<{ chapters: Chapter[]; config: Row; sectionsTotal: number }> {
  const chapters: Chapter[] = [];
  const pages: { title: string; url: string }[] = [];
  for (const [index, book] of ARTHASHASTRA_BOOKS.entries()) {
    const title = `Arthashastra/Book ${book}`;
    const segments = applyTrim(await wikisourceSegments(title), ARTHASHASTRA_TRIM);
    if (!segments.length) throw new Error(`Arthashastra Book ${book} has no text after trimming`);
    chapters.push({ ref: String(index + 1), label: `Book ${book}`, segments });
    pages.push({ title, url: `https://en.wikisource.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}` });
    console.log(`  Arthashastra Book ${book}: ${segments.length} paragraphs`);
  }
  return {
    chapters,
    config: {
      pages,
      sourceUrl: "https://en.wikisource.org/wiki/Arthashastra",
      trimStartPattern: ARTHASHASTRA_TRIM,
    },
    sectionsTotal: chapters.length,
  };
}

// The hymn pages are short and print each verse line inside a <pre> block, so
// the hymn wikitext can be fetched fifty pages to a request and split into the
// same lines the reader shows. That cuts the Rigveda from a thousand requests
// to about twenty.
function wikitextSegments(wikitext: string): string[] {
  let body = wikitext;
  const pre = /<pre\b[^>]*>([\s\S]*?)<\/pre>/i.exec(body);
  if (pre) body = pre[1]!;
  else body = body.replace(/\{\{header[\s\S]*?\n\}\}/, "");
  body = body
    .replace(/<ref[\s\S]*?<\/ref>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
    .replace(/\{\{[^{}]*\}\}/g, " ")
    .replace(/''+/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
  return body
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 1);
}

async function wikisourceRawSegments(titles: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (let offset = 0; offset < titles.length; offset += 40) {
    const batch = titles.slice(offset, offset + 40);
    const url = new URL("https://en.wikisource.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("prop", "revisions");
    url.searchParams.set("rvprop", "content");
    url.searchParams.set("rvslots", "main");
    url.searchParams.set("titles", batch.join("|"));
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    let body: any = null;
    for (let attempt = 1; attempt <= 6; attempt++) {
      try {
        const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
        if (res.status === 429) {
          await Bun.sleep(5_000 * attempt);
          continue;
        }
        if (!res.ok) throw new Error(`batch fetch returned ${res.status}`);
        body = JSON.parse(await res.text());
        break;
      } catch (err) {
        if (attempt === 6) throw err;
        await Bun.sleep(2_000 * attempt);
      }
    }
    if (!body?.query?.pages) throw new Error("batch fetch returned no pages");
    for (const page of body.query.pages) {
      if (page.missing) continue;
      const content = String(page.revisions?.[0]?.slots?.main?.content ?? "");
      const segments = wikitextSegments(content);
      if (segments.length) out.set(page.title, segments);
    }
    await Bun.sleep(wikiGap);
  }
  return out;
}

// Hymn counts per mandala as printed in Griffith's edition; the ten books hold
// 1,028 hymns in all.
const RIGVEDA_HYMNS = [191, 43, 62, 58, 87, 75, 104, 103, 114, 191];
const RIGVEDA_TOTAL = RIGVEDA_HYMNS.reduce((sum, n) => sum + n, 0);

function compareRefs(a: string, b: string) {
  const [ab, ah] = a.split(".").map(Number);
  const [bb, bh] = b.split(".").map(Number);
  return (ab ?? 0) - (bb ?? 0) || (ah ?? 0) - (bh ?? 0);
}

async function buildRigveda(): Promise<{
  chapters: Chapter[];
  config: Row;
  sectionsTotal: number;
  sectionsImported: number;
  complete: boolean;
}> {
  const existing = force ? null : readCache("rigveda");
  const byRef = new Map<string, Chapter>((existing?.chapters ?? []).map((chapter) => [chapter.ref, chapter]));
  const pageFor = (book: number, hymn: number) => {
    const title = `The Hymns of the Rigveda/Book ${book}/Hymn ${hymn}`;
    // The ref is recorded with the page because this work's refs are book.hymn,
    // not the 1..n page numbers most Wikisource imports use. The reader matches
    // a chapter to its page by that ref.
    return {
      ref: `${book}.${hymn}`,
      title,
      url: `https://en.wikisource.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`,
    };
  };
  const snapshot = () =>
    [...byRef.values()].sort((a, b) => compareRefs(a.ref, b.ref));
  const checkpoint = (book: number, hymn: number) => {
    const chapters = snapshot();
    writeCache("rigveda", {
      version: 1,
      slug: "rigveda",
      provider: "wikisource",
      sourceUrl: "https://en.wikisource.org/wiki/The_Hymns_of_the_Rigveda",
      generatedAt: new Date().toISOString(),
      complete: chapters.length === RIGVEDA_TOTAL,
      sectionsTotal: RIGVEDA_TOTAL,
      sectionsImported: chapters.length,
      config: {
        pages: chapters.map((chapter) => {
          const [b, h] = chapter.ref.split(".").map(Number);
          return pageFor(b!, h!);
        }),
        sourceUrl: "https://en.wikisource.org/wiki/The_Hymns_of_the_Rigveda",
      },
      chapters,
    });
    console.log(`  Rigveda: ${chapters.length} hymns cached (through Book ${book}, Hymn ${hymn})`);
  };
  const pending: { ref: string; book: number; hymn: number }[] = [];
  for (const [bookIndex, hymnCount] of RIGVEDA_HYMNS.entries()) {
    const book = bookIndex + 1;
    for (let hymn = 1; hymn <= hymnCount; hymn++) {
      const ref = `${book}.${hymn}`;
      if (byRef.has(ref)) continue;
      if (pending.length >= rigvedaBudget) break;
      pending.push({ ref, book, hymn });
    }
    if (pending.length >= rigvedaBudget) break;
  }
  console.log(`  Rigveda: ${pending.length} hymn(s) to retrieve`);
  for (let offset = 0; offset < pending.length; offset += 40) {
    const chunk = pending.slice(offset, offset + 40);
    const titles = chunk.map((item) => pageFor(item.book, item.hymn).title);
    const fetched = await wikisourceRawSegments(titles);
    for (const item of chunk) {
      // A few hymn pages hold only a proofread transclusion (`<pages index=…>`),
      // which the raw wikitext cannot resolve. Those are read through the
      // rendered page instead of being skipped.
      let segments = fetched.get(pageFor(item.book, item.hymn).title);
      if (!segments?.length) segments = await wikisourceSegments(pageFor(item.book, item.hymn).title);
      if (!segments?.length) throw new Error(`Rigveda ${item.ref} returned no text`);
      byRef.set(item.ref, { ref: item.ref, label: `Book ${item.book}, Hymn ${item.hymn}`, segments });
    }
    const last = chunk[chunk.length - 1]!;
    checkpoint(last.book, last.hymn);
  }
  if (!pending.length) checkpoint(RIGVEDA_HYMNS.length, 191);
  const chapters = snapshot();
  return {
    chapters,
    config: {
      pages: chapters.map((chapter) => {
        const [b, h] = chapter.ref.split(".").map(Number);
        return pageFor(b!, h!);
      }),
      sourceUrl: "https://en.wikisource.org/wiki/The_Hymns_of_the_Rigveda",
    },
    sectionsTotal: RIGVEDA_TOTAL,
    sectionsImported: chapters.length,
    complete: chapters.length === RIGVEDA_TOTAL,
  };
}

// ---------------------------------------------------------------------------
// Generic Wikisource work builder
// ---------------------------------------------------------------------------

// Some works are transcribed as one page per chapter or section. The builder
// keeps the printed divisions, resumes from the cache after an interruption and
// never invents a missing page: a failed page is a failed import.
async function buildWikisourcePages(meta: WorkMeta): Promise<{
  chapters: Chapter[];
  config: Row;
  sectionsTotal: number;
  sectionsImported: number;
  complete: boolean;
}> {
  const pages = meta.pages ?? [];
  if (!pages.length) throw new Error(`${meta.slug}: no Wikisource pages declared`);
  const total = meta.sectionsTotal ?? pages.length;
  const existing = force ? null : readCache(meta.slug);
  const byRef = new Map<string, Chapter>((existing?.chapters ?? []).map((chapter) => [chapter.ref, chapter]));
  for (const [index, page] of pages.entries()) {
    const ref = String(index + 1);
    if (byRef.has(ref)) continue;
    const segments = trimBoilerplate(applyTrim(await wikisourceSegments(page.title), meta.trimStartPattern));
    if (!segments.length) throw new Error(`${page.title} has no readable paragraphs`);
    byRef.set(ref, { ref, label: page.label, segments });
    if ((index + 1) % 5 === 0) {
      console.log(`  ${meta.title}: ${byRef.size}/${pages.length} sections`);
      writeCache(meta.slug, {
        version: 1,
        slug: meta.slug,
        provider: "wikisource",
        sourceUrl: meta.sourceUrl,
        generatedAt: new Date().toISOString(),
        complete: false,
        sectionsTotal: total,
        sectionsImported: byRef.size,
        config: { pages: pages.map((p) => ({ title: p.title, url: p.url })), sourceUrl: meta.sourceUrl },
        chapters: [...byRef.values()].sort((a, b) => compareRefs(a.ref, b.ref)),
      });
    }
  }
  const chapters = [...byRef.values()].sort((a, b) => compareRefs(a.ref, b.ref));
  console.log(`  ${meta.title}: ${chapters.length}/${pages.length} pages retrieved`);
  return {
    chapters,
    config: {
      pages: pages.map((p) => ({ title: p.title, url: p.url })),
      sourceUrl: meta.sourceUrl,
      trimStartPattern: meta.trimStartPattern,
    },
    sectionsTotal: total,
    sectionsImported: chapters.length,
    complete: chapters.length === total,
  };
}

// ---------------------------------------------------------------------------
// Ramanuja, Sri Bhashya (Vedanta-Sutras with the commentary of Ramanuja)
// ---------------------------------------------------------------------------

const RAMANUJA_TRIM =
  "^(The Project Gutenberg eBook|This eBook is for the use of|Title:|Translator:|Commentator:|Release date:|Language:|Other information|\\*\\*\\*|CONTENTS\\.?|VED[ÂA]NTA-SÛTRAS|INTRODUCTION\\.?|In the Introduction to the first volume)";

function parseRamanujaBhashya(text: string): Chapter[] {
  const lines = trimGutenberg(text).replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => /^(FIRST ADHY[ÂA]YA)/i.test(line.trim()));
  if (start < 0) throw new Error("Ramanuja Bhashya: no first adhyaya heading found");
  const headings = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(
      (entry) =>
        entry.index >= start &&
        /^(FIRST|SECOND|THIRD|FOURTH) (ADHY[ÂA]YA|P[ÂA]DA)\.?$/i.test(entry.line),
    );
  const chapters: Chapter[] = [];
  let adhyaya = 0;
  const ordinals: Record<string, number> = { FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4 };
  for (const [index, heading] of headings.entries()) {
    const kind = /ADHY/i.test(heading.line) ? "adhyaya" : "pada";
    const number = ordinals[heading.line.split(/\s+/)[0]!.toUpperCase()] ?? 0;
    if (kind === "adhyaya") {
      adhyaya = number;
      continue;
    }
    const next = headings[index + 1]?.index ?? lines.length;
    const segments = plaintextParagraphs(lines.slice(heading.index + 1, next).join("\n"));
    if (!segments.length) throw new Error(`Ramanuja Bhashya ${adhyaya}.${number} has no text`);
    chapters.push({
      ref: `${adhyaya}.${number}`,
      label: `Adhyaya ${roman(adhyaya)} — Pada ${roman(number)}`,
      segments,
    });
  }
  if (chapters.length !== 16) {
    throw new Error(`Ramanuja Bhashya parsing produced ${chapters.length} padas; expected 16`);
  }
  return chapters;
}

function roman(n: number) {
  return ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][n] ?? String(n);
}

async function buildRamanujaBhashya(meta: WorkMeta): Promise<{
  chapters: Chapter[];
  config: Row;
  sectionsTotal: number;
}> {
  const textUrl = "https://www.gutenberg.org/cache/epub/7297/pg7297.txt";
  const chapters = parseRamanujaBhashya(await fetchText(textUrl));
  return {
    chapters,
    config: { textUrl, sourceUrl: meta.sourceUrl, trimStartPattern: RAMANUJA_TRIM },
    sectionsTotal: chapters.length,
  };
}

// ---------------------------------------------------------------------------
// Work records
// ---------------------------------------------------------------------------

type WorkMeta = {
  slug: string;
  title: string;
  originalTitle: string;
  transliteration: string;
  altTitles: string[];
  author: string;
  school: string;
  category: string;
  subcategory: string;
  genre: string;
  textType: string;
  dateStart: number;
  dateEnd: number;
  dateDisplay: string;
  authorshipStatus: "established" | "traditional" | "disputed" | "anonymous" | "composite";
  attributionNote: string;
  description: string;
  historicalContext: string;
  translator: string;
  translationTitle: string;
  translationYear: number;
  publisher: string;
  source: "project-gutenberg" | "wikisource" | "sacred-texts";
  sourceUrl: string;
  functions: string[];
  complete: boolean;
  availabilityNote: string;
  refScheme: string;
  sectionsTotal?: number;
  pages?: { title: string; url: string; label: string }[];
  trimStartPattern?: string;
};

const META: Record<string, WorkMeta> = {
  mahabharata: {
    slug: "mahabharata",
    title: "Mahabharata",
    originalTitle: "महाभारतम्",
    transliteration: "Mahābhārata",
    altTitles: ["The Mahabharata of Krishna-Dwaipayana Vyasa", "Bharata"],
    author: "vyasa",
    school: "",
    category: "Epic",
    subcategory: "Sanskrit epics",
    genre: "Epic poetry",
    textType: "Epic poem",
    dateStart: -400,
    dateEnd: 400,
    dateDisplay: "c. 4th century BCE–4th century CE",
    authorshipStatus: "composite",
    attributionNote:
      "Traditionally attributed to Vyasa. The poem grew through oral and written transmission over centuries; the surviving text is a composite rather than a single authorial work.",
    description:
      "The eighteen books of the Mahabharata: the rivalry of the Pandavas and Kauravas, the dice game and exile, the war at Kurukshetra, and the long instruction in dharma that follows it. The Bhagavad Gita is the best-known episode within the sixth book. Ganguli's complete prose translation is printed here in four volumes, with the printed section divisions indexed separately wherever the transcription preserves them.",
    historicalContext:
      "Composed and transmitted between roughly the fourth century BCE and the fourth century CE, with later additions. The Ganguli translation (1883–1896) was the first complete English prose rendering and remains the standard public-domain one.",
    translator: "Kisari Mohan Ganguli",
    translationTitle: "The Mahabharata of Krishna-Dwaipayana Vyasa, translated into English prose",
    translationYear: 1883,
    publisher: "Project Gutenberg",
    source: "project-gutenberg",
    sourceUrl: "https://www.gutenberg.org/ebooks/15474",
    functions: ["historical_document", "philosophical_work"],
    complete: true,
    availabilityNote:
      "Streamed from four Project Gutenberg volumes at read time. Ganguli's prose translation of all eighteen books is present.",
    refScheme: "chapter.paragraph",
  },
  harivamsha: {
    slug: "harivamsha",
    title: "Harivamsha",
    originalTitle: "हरिवंश",
    transliteration: "Harivaṃśa",
    altTitles: ["Harivamsha Purana", "The Family of Hari"],
    author: "vyasa",
    school: "vaishnavism",
    category: "Epic",
    subcategory: "Sanskrit epics",
    genre: "Epic poetry",
    textType: "Genealogical epic",
    dateStart: -200,
    dateEnd: 500,
    dateDisplay: "c. 2nd century BCE–5th century CE",
    authorshipStatus: "composite",
    attributionNote:
      "Traditionally ascribed to Vyasa and transmitted as a supplement to the Mahabharata. Its date and relation to the epic are disputed.",
    description:
      "The Harivamsha extends the Mahabharata with the genealogy of the Vrishnis and the life of Krishna, from his birth and childhood to his role in the epic. Manmatha Nath Dutt's 1897 prose translation is complete in this edition; the chapter numbering and titles follow the printed translation.",
    historicalContext:
      "A Sanskrit supplement to the Mahabharata, important for the early development of Krishna devotion. Dutt's translation was produced in Calcutta in the last decade of the nineteenth century.",
    translator: "Manmatha Nath Dutt",
    translationTitle: "A Prose English Translation of Harivamsha",
    translationYear: 1897,
    publisher: "Project Gutenberg",
    source: "project-gutenberg",
    sourceUrl: "https://www.gutenberg.org/ebooks/61937",
    functions: ["historical_document", "philosophical_work"],
    complete: true,
    availabilityNote:
      "Streamed from Project Gutenberg at read time. The translation is complete for the edition; the passage index follows its 137 chapter headings.",
    refScheme: "chapter.paragraph",
  },
  "vishnu-purana": {
    slug: "vishnu-purana",
    title: "Vishnu Purana",
    originalTitle: "विष्णुपुराण",
    transliteration: "Viṣṇu Purāṇa",
    altTitles: ["Vishnupuranam"],
    author: "vyasa",
    school: "vaishnavism",
    category: "Purana",
    subcategory: "Vaishnava Puranas",
    genre: "Purana",
    textType: "Purana",
    dateStart: 300,
    dateEnd: 500,
    dateDisplay: "c. 4th–5th century CE",
    authorshipStatus: "composite",
    attributionNote:
      "Traditionally attributed to Vyasa. The Purana is a composite work shaped over centuries; the attribution is traditional rather than documentary.",
    description:
      "One of the eighteen Mahapuranas and a foundational Vaishnava text. Its six parts treat creation, cosmology, genealogy, the Manus, the duties of the castes and orders of life, and the life of Krishna. Dutt's prose translation, based principally on Wilson's earlier version, is complete in this edition.",
    historicalContext:
      "A relatively early Purana, dated by scholars to the fourth or fifth century CE. H. H. Wilson's 1840 translation was the first English version; Dutt's 1894–96 rendering modernised and completed it for a general readership.",
    translator: "Manmatha Nath Dutt",
    translationTitle: "A Prose English Translation of Vishnupurānam",
    translationYear: 1894,
    publisher: "Project Gutenberg",
    source: "project-gutenberg",
    sourceUrl: "https://www.gutenberg.org/ebooks/66208",
    functions: ["canonical_scripture", "historical_document"],
    complete: true,
    availabilityNote:
      "Streamed from Project Gutenberg at read time. The six parts and 250 sections are complete for this translation; section titles are those printed in the edition.",
    refScheme: "chapter.paragraph",
  },
  "taittiriya-samhita": {
    slug: "taittiriya-samhita",
    title: "Yajurveda — Taittiriya Samhita",
    originalTitle: "यजुर्वेदः — तैत्तिरीयसंहिता",
    transliteration: "Yajurveda — Taittirīya Saṃhitā",
    altTitles: ["The Veda of the Black Yajus School", "Krishna Yajurveda", "Black Yajurveda"],
    author: "",
    school: "",
    category: "Veda",
    subcategory: "Samhita — Krishna Yajurveda",
    genre: "Veda",
    textType: "Samhita",
    dateStart: -1200,
    dateEnd: -800,
    dateDisplay: "c. 12th–8th century BCE",
    authorshipStatus: "anonymous",
    attributionNote:
      "The Vedic Samhitas are anonymous and collective. This is the Taittiriya recension of the Black (Krishna) Yajurveda, not the White (Shukla) Vajasaneyi Samhita; the two recensions are kept distinct.",
    description:
      "The Taittiriya Samhita, the principal Samhita of the Black Yajurveda, in seven kandas. It combines ritual formulas with the prose and verse of the sacrifice, including the New and Full Moon rites, the Soma sacrifice, and the building of the fire altar. Keith's 1914 translation is complete for this recension.",
    historicalContext:
      "One of the two surviving branches of the Black Yajurveda, transmitted by the Taittiriya school. Keith's translation was published in two volumes at Harvard in 1914 and remains a standard public-domain English rendering.",
    translator: "Arthur Berriedale Keith",
    translationTitle: "The Veda of the Black Yajus School, entitled Taittiriya Sanhita",
    translationYear: 1914,
    publisher: "Internet Sacred Text Archive",
    source: "sacred-texts",
    sourceUrl: "https://archive.sacred-texts.com/hin/yv/index.htm",
    functions: ["canonical_scripture", "historical_document"],
    complete: true,
    availabilityNote:
      "Complete. All seven kandas of Keith's 1914 translation are streamed from the Internet Sacred Text Archive at read time, one kanda per chapter. The passage index follows the paragraph divisions of the printed edition, not the anuvaka numbers, which are not reproduced in the served text. This is the Taittiriya recension of the Black Yajurveda, not the White Yajurveda, which is a separate school and text.",
    refScheme: "chapter.paragraph",
  },
  "ramayana-uttara-kanda": {
    slug: "ramayana-uttara-kanda",
    title: "Ramayana — Uttara Kanda",
    originalTitle: "रामायण — उत्तरकाण्ड",
    transliteration: "Rāmāyaṇa — Uttarakāṇḍa",
    altTitles: ["Uttara Kanda", "Uttarakandam", "The Ramayana, Volume 4"],
    author: "valmiki",
    school: "vaishnavism",
    category: "Epic",
    subcategory: "Sanskrit epics",
    genre: "Epic poetry",
    textType: "Epic poem",
    dateStart: -500,
    dateEnd: -100,
    dateDisplay: "c. 5th–1st century BCE",
    authorshipStatus: "composite",
    attributionNote:
      "Traditionally attributed to Valmiki. The book is the last of the seven kandas of the Ramayana and is part of the epic as it has come down, though its date and its relation to the earlier six books are debated.",
    description:
      "The seventh and last book of the Ramayana: Rama's rule at Ayodhya, the birth of his sons, the Ashvamedha, the return of Sita, her final disappearance into the earth, and the deaths and aftermath that close the epic. Dutt's prose translation is complete for this volume and follows the printed section divisions.",
    historicalContext:
      "Griffith's verse translation in this library ends with the sixth book, so the Uttara Kanda is read here in Manmatha Nath Dutt's 1894 prose rendering. It is kept as its own record so that the two translations are not conflated; the earlier six books remain in Griffith's verse.",
    translator: "Manmatha Nath Dutt",
    translationTitle: "The Rāmāyana, Volume 4. Uttara Kānda",
    translationYear: 1894,
    publisher: "Project Gutenberg",
    source: "project-gutenberg",
    sourceUrl: "https://www.gutenberg.org/ebooks/62496",
    functions: ["canonical_scripture", "historical_document"],
    complete: true,
    availabilityNote:
      "Complete. Dutt's prose translation of the Uttara Kanda, streamed from Project Gutenberg at read time, one section per chapter. The printed section numerals are irregular after section C — the transcription concatenates the century numeral with the following one — so chapters are numbered in reading order and the editor's reading is stated rather than reproduced.",
    refScheme: "chapter.paragraph",
  },
  arthashastra: {
    slug: "arthashastra",
    title: "Arthashastra",
    originalTitle: "अर्थशास्त्र",
    transliteration: "Arthaśāstra",
    altTitles: ["Kautilya's Arthashastra", "The Science of Polity"],
    author: "kautilya",
    school: "",
    category: "Statecraft",
    subcategory: "Dharma, law and statecraft",
    genre: "Treatise",
    textType: "Political and economic treatise",
    dateStart: -300,
    dateEnd: 300,
    dateDisplay: "c. 3rd century BCE–3rd century CE",
    authorshipStatus: "disputed",
    attributionNote:
      "Traditionally attributed to Kautilya, also called Chanakya or Vishnugupta. The surviving text is composite and its date and single authorship are disputed; the attribution is recorded, not adjudicated.",
    description:
      "A Sanskrit treatise on government, economy, law, war and intelligence, in fifteen books. It ranges from the duties of the king and the organisation of villages to taxation, trade, diplomacy, fortification and the conduct of war. Shamasastry's 1915 translation made the text widely available in English.",
    historicalContext:
      "The Arthashastra is a composite Sanskrit treatise of the Mauryan or post-Mauryan period, rediscovered in a manuscript in 1904 and published by R. Shamasastry in 1909 and 1915. It is a historical treatise on statecraft, not a universally binding code.",
    translator: "R. Shamasastry",
    translationTitle: "Kautilya's Arthashastra",
    translationYear: 1915,
    publisher: "Wikisource",
    source: "wikisource",
    sourceUrl: "https://en.wikisource.org/wiki/Arthashastra",
    functions: ["historical_document", "philosophical_work"],
    complete: true,
    availabilityNote:
      "Streamed from Wikisource page by page at read time. The fifteen books are complete for the Shamasastry translation. The translation is a historical scholarly rendering, not a modern critical edition.",
    refScheme: "chapter.paragraph",
  },
  rigveda: {
    slug: "rigveda",
    title: "Rigveda",
    originalTitle: "ऋग्वेद",
    transliteration: "Ṛgveda",
    altTitles: ["The Hymns of the Rigveda", "Rig Veda"],
    author: "",
    school: "",
    category: "Veda",
    subcategory: "Samhita — Rigveda",
    genre: "Veda",
    textType: "Samhita",
    dateStart: -1500,
    dateEnd: -1000,
    dateDisplay: "c. 15th–10th century BCE",
    authorshipStatus: "anonymous",
    attributionNote:
      "The Rigveda is an anonymous, collective corpus of hymns attributed by tradition to inspired seers (rishis). The catalogue does not assign a single author.",
    description:
      "The oldest of the Vedas, in ten mandalas of hymns to Agni, Indra, Varuna, the Ashvins and other deities, together with the late tenth mandala and the Nasadiya hymn. Griffith's 1896 verse translation is imported hymn by hymn, each hymn a separately navigable section.",
    historicalContext:
      "Composed in Vedic Sanskrit and transmitted orally with extraordinary fidelity before being written down. Griffith's translation (first edition 1889, second 1896) is a public-domain verse rendering; it is readable rather than a modern philological translation.",
    translator: "Ralph T. H. Griffith",
    translationTitle: "The Hymns of the Rigveda",
    translationYear: 1896,
    publisher: "Wikisource",
    source: "wikisource",
    sourceUrl: "https://en.wikisource.org/wiki/The_Hymns_of_the_Rigveda",
    functions: ["canonical_scripture", "historical_document"],
    complete: false,
    availabilityNote:
      "Hymn-by-hymn import in progress from Wikisource; the note on the work record states which mandalas are present.",
    refScheme: "chapter.paragraph",
  },
  "ramanuja-brahma-sutra-bhashya": {
    slug: "ramanuja-brahma-sutra-bhashya",
    title: "Brahma Sutra Bhashya of Ramanuja",
    originalTitle: "श्रीभाष्यम्",
    transliteration: "Śrībhāṣya",
    altTitles: ["Sri Bhashya", "Vedanta-Sutras with the Commentary of Ramanuja"],
    author: "ramanuja",
    school: "vedanta",
    category: "Vedanta",
    subcategory: "Vedanta commentaries",
    genre: "Commentary",
    textType: "Bhashya",
    dateStart: 1100,
    dateEnd: 1150,
    dateDisplay: "c. early 12th century CE",
    authorshipStatus: "established",
    attributionNote:
      "Composed by Ramanuja, the principal theologian of the Sri Vaishnava school, as a commentary on Badarayana's Brahma Sutras. It is a distinct work from Shankara's commentary on the same sutras, and the two are kept as separate records.",
    description:
      "Ramanuja's commentary on the Brahma Sutras, the foundational statement of Vishishtadvaita Vedanta: Brahman is the supreme person, the world and souls are its real modes, and liberation is attained through devotion and the Lord's grace. Thibaut's translation prints the sutras with the full commentary, in four adhyayas of four padas each.",
    historicalContext:
      "The Sri Bhashya belongs to the Sri Vaishnava commentarial tradition of the eleventh and twelfth centuries. George Thibaut translated it for the Sacred Books of the East (volume 48, 1904), the standard public-domain English rendering.",
    translator: "George Thibaut",
    translationTitle: "The Vedanta-Sutras with the Commentary by Ramanuja",
    translationYear: 1904,
    publisher: "Project Gutenberg",
    source: "project-gutenberg",
    sourceUrl: "https://www.gutenberg.org/ebooks/7297",
    functions: ["philosophical_work", "canonical_scripture"],
    complete: true,
    availabilityNote:
      "Streamed from Project Gutenberg at read time. All four adhyayas and sixteen padas are present in this edition; the passage index follows the pada divisions of Thibaut's translation.",
    refScheme: "chapter.paragraph",
  },
  "taittiriya-upanishad": {
    slug: "taittiriya-upanishad",
    title: "Taittiriya Upanishad",
    originalTitle: "तैत्तिरीयोपनिषद्",
    transliteration: "Taittirīya Upaniṣad",
    altTitles: ["Taittiriyopanishad"],
    author: "",
    school: "vedanta",
    category: "Upanishad",
    subcategory: "Principal Upanishads",
    genre: "Upanishad",
    textType: "Upanishad",
    dateStart: -800,
    dateEnd: -500,
    dateDisplay: "c. 8th–5th century BCE",
    authorshipStatus: "anonymous",
    attributionNote:
      "An anonymous Vedic text attached to the Taittiriya school of the Black Yajurveda. It is not ascribed to a single author.",
    description:
      "The Taittiriya Upanishad in three vallis: the Shiksha Valli on phonetics, metre and the duty of study and teaching; the Brahmananda Valli on the five sheaths and the nature of bliss; and the Bhrigu Valli, in which Bhrigu learns that Brahman is the food, breath, mind, understanding and bliss of the world.",
    historicalContext:
      "One of the principal Upanishads, belonging to the Taittiriya recension of the Black Yajurveda. Max Müller's translation was published in the Sacred Books of the East, volume 15 (1884).",
    translator: "F. Max Müller",
    translationTitle: "The Upanishads, Part II (Sacred Books of the East, vol. 15)",
    translationYear: 1884,
    publisher: "Wikisource",
    source: "wikisource",
    sourceUrl: "https://en.wikisource.org/wiki/Taittiriya_Upanishad",
    functions: ["canonical_scripture", "philosophical_work"],
    complete: true,
    availabilityNote:
      "Streamed from Wikisource at read time. The three vallis are present in Müller's translation, with the translator's notes retained as part of the page.",
    refScheme: "chapter.paragraph",
    pages: [
      {
        title: "Taittiriya Upanishad",
        url: "https://en.wikisource.org/wiki/Taittiriya_Upanishad",
        label: "Taittiriya Upanishad (all three vallis)",
      },
    ],
  },

};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const streams = readJson(STREAMS);
const functions = readJson(FUNCTIONS);
const manifest: Row = {
  source: "hindu-corpus",
  retrieved_at: RETRIEVED_AT,
  note:
    "Catalogue records, passage indexes and the exact reviewed segments for the Hindu expansion. The reader still streams the work from its host; the cache is an import and search-index artifact, not a second public copy.",
  works: (() => {
    try {
      return readJson(MANIFEST).works ?? [];
    } catch {
      return [];
    }
  })(),
  failures: [],
  totals: {},
};

function recordWork(entry: Row) {
  const index = manifest.works.findIndex((work: Row) => work.slug === entry.slug);
  if (index >= 0) manifest.works[index] = entry;
  else manifest.works.push(entry);
}

function mahabharataAvailabilityNote(chapters: Chapter[]): string {
  const books = new Set(chapters.map((chapter) => Number(chapter.ref.split(".")[0])));
  const div = `The transcription divides the text into ${chapters.length.toLocaleString()} numbered sections wherever it prints SECTION headings; Books 8–11 and 16–18 are printed as continuous text without them and are one navigable chapter each.`;
  if (books.size !== 18) {
    return `Partially imported: ${books.size} of the eighteen books of Ganguli's prose translation are present, streamed from four Project Gutenberg volumes at read time. ${div}`;
  }
  return `Complete. All eighteen books of Ganguli's prose translation, streamed from four Project Gutenberg volumes at read time. ${div}`;
}

function rigvedaAvailabilityNote(chapters: Chapter[], total: number, complete: boolean) {
  const imported = chapters.length;
  if (complete) {
    return `Complete. All ten mandalas (${total.toLocaleString()} hymns) of Griffith's translation are streamed from Wikisource at read time, one hymn per navigable section. The passage index follows the hymn and verse lines of the printed edition.`;
  }
  const books = [...new Set(chapters.map((chapter) => Number(chapter.ref.split(".")[0])))].sort((a, b) => a - b);
  const span = books.length ? `Book${books.length > 1 ? "s" : ""} ${books.join(", ")}` : "no book";
  return `Partially imported: ${imported} of ${total} hymns (${span}) are streamed from Wikisource at read time. The remaining mandalas are queued in the acquisition register and are not claimed as complete.`;
}

function makeWork(
  meta: WorkMeta,
  chapters: Chapter[],
  config: Row,
  imported: number,
  total: number,
  completeOverride?: boolean,
) {
  const complete = completeOverride ?? meta.complete;
  const availabilityNote =
    meta.slug === "rigveda"
      ? rigvedaAvailabilityNote(chapters, total, complete)
      : meta.slug === "mahabharata"
        ? mahabharataAvailabilityNote(chapters)
        : meta.availabilityNote;
  const passages = chapters.flatMap((chapter) =>
    chapter.segments.map((_, index) => ({
      reference: `${chapter.ref}.${index + 1}`,
      label: `${chapter.label} §${index + 1}`,
      chapterRef: chapter.ref,
    })),
  );
  const editionSlug = `${meta.slug}-en`;
  const work = {
    slug: meta.slug,
    title: meta.title,
    originalTitle: meta.originalTitle,
    transliteration: meta.transliteration,
    altTitles: meta.altTitles,
    tradition: "hinduism",
    school: meta.school,
    genre: meta.genre,
    textType: meta.textType,
    category: meta.category,
    subcategory: meta.subcategory,
    originalLanguage: "sa",
    dateStart: meta.dateStart,
    dateEnd: meta.dateEnd,
    dateDisplay: meta.dateDisplay,
    authorshipStatus: meta.authorshipStatus,
    author: meta.author || null,
    attributionNote: meta.attributionNote,
    description: meta.description,
    historicalContext: meta.historicalContext,
    availabilityNote,
    featured: 0,
    featuredNote: "",
    refScheme: meta.refScheme,
    isSample: false,
    textStorage: "streamed",
    chapters: chapters.map((chapter) => ({ ref: chapter.ref, label: chapter.label })),
    passages,
    editions: [
      {
        slug: editionSlug,
        language: "en",
        editionType: "translation",
        title: meta.translationTitle,
        translator: meta.translator,
        publisher: meta.publisher,
        publicationYear: meta.translationYear,
        source: meta.source,
        license: "public-domain",
        rightsStatus: "Public domain in the United States",
        attributionText: `${meta.translationTitle}, translated by ${meta.translator} (${meta.translationYear}). Public domain in the United States. Digital text from ${meta.publisher}.`,
        structureScheme: "chapter and paragraph index; segments are the printed paragraphs",
        isSample: false,
        notes:
          "The import cache stores the exact segments that were validated. The reader re-fetches the chapter from the host and reports when the served count no longer matches the index.",
      },
    ],
  };
  writeFileSync(join(WORKS, `${meta.slug}.json`), `${JSON.stringify(work, null, 2)}\n`);

  streams.works[meta.slug] = {
    provider: providerSlug(meta.source),
    upstream: meta.source === "project-gutenberg" ? meta.sourceUrl : meta.title,
    mode: "numbered",
    licence: "public-domain",
    config: { ...config, sourceUrl: meta.sourceUrl },
    editions: [
      {
        slug: editionSlug,
        language: "en",
        languageName: "english",
        version: meta.translationTitle,
        license: "public-domain",
        sourceUrl: meta.sourceUrl,
      },
    ],
  };
  functions.works[meta.slug] = {
    functions: meta.functions,
    status: "provisional",
    assignedBy: "UWL editors (comparative taxonomy)",
    note: `${meta.title} — ${meta.category}. ${complete ? "Complete" : "Partial"} public-domain English translation streamed from ${meta.publisher}.`,
  };

  const words = chapters.reduce(
    (sum, chapter) => sum + chapter.segments.reduce((n, text) => n + text.split(/\s+/).filter(Boolean).length, 0),
    0,
  );
  const entry = {
    slug: meta.slug,
    title: meta.title,
    host: providerSlug(meta.source),
    source_url: meta.sourceUrl,
    edition: meta.translationTitle,
    translator: meta.translator,
    year: meta.translationYear,
    licence: "public-domain",
    chapters: chapters.length,
    passages: passages.length,
    sections_total: total,
    sections_imported: imported,
    complete,
    validation: "aligned",
    words,
    retrieved_at: RETRIEVED_AT,
  };
  recordWork(entry);
  console.log(
    `  ${meta.title}: ${chapters.length}/${total} sections, ${passages.length} passages, ${words.toLocaleString()} words${
      complete ? "" : " (partial)"
    }`,
  );
  return entry;
}

function assertChapters(slug: string, chapters: Chapter[]) {
  const refs = new Set<string>();
  let chars = 0;
  for (const chapter of chapters) {
    if (refs.has(chapter.ref)) throw new Error(`${slug}: duplicate chapter reference ${chapter.ref}`);
    refs.add(chapter.ref);
    if (!chapter.segments.length) throw new Error(`${slug}: chapter ${chapter.ref} has no segments`);
    for (const segment of chapter.segments) {
      if (!segment.trim()) throw new Error(`${slug}: chapter ${chapter.ref} has an empty segment`);
      if (segment.includes("\uFFFD")) throw new Error(`${slug}: chapter ${chapter.ref} contains a replacement character`);
      chars += segment.length;
    }
  }
  if (chars < 100) throw new Error(`${slug}: imported text is implausibly short`);
}

const WORK_ORDER = [
  "mahabharata",
  "harivamsha",
  "vishnu-purana",
  "taittiriya-samhita",
  "ramayana-uttara-kanda",
  "arthashastra",
  "rigveda",
  "ramanuja-brahma-sutra-bhashya",
  "laws-of-manu",
  "samaveda",
  "atharvaveda",
  "taittiriya-upanishad",
  "gita-govinda",
  "panchatantra",
  "vivekachudamani",
];

for (const slug of WORK_ORDER) {
  if (only && only !== slug) continue;
  const meta = META[slug];
  if (!meta) throw new Error(`unknown work ${slug}`);
  console.log(`\n${meta.title}`);
  const cached = force ? null : readCache(slug);
  const cachedComplete = cached
    ? cached.chapters.length === cached.sectionsTotal
    : false;
  const resumable = slug === "rigveda" || Boolean(meta.pages?.length);
  if (cached && (cachedComplete || !resumable)) {
    assertChapters(slug, cached.chapters);
    makeWork(
      meta,
      cached.chapters,
      cached.config ?? {},
      cached.sectionsImported,
      cached.sectionsTotal,
      cachedComplete,
    );
    console.log(`  reused ${cached.chapters.length} cached chapters`);
    continue;
  }

  const built =
    slug === "mahabharata"
      ? await buildMahabharata()
      : slug === "harivamsha"
        ? await buildHarivamsha()
        : slug === "vishnu-purana"
          ? await buildVishnuPurana()
          : slug === "taittiriya-samhita"
            ? await buildYajurveda()
            : slug === "ramayana-uttara-kanda"
              ? await buildUttaraKanda()
            : slug === "arthashastra"
              ? await buildArthashastra()
              : slug === "rigveda"
                ? await buildRigveda()
                : slug === "ramanuja-brahma-sutra-bhashya"
                  ? await buildRamanujaBhashya(meta)
                  : await buildWikisourcePages(meta);
  assertChapters(slug, built.chapters);
  const result = built as {
    chapters: Chapter[];
    config: Row;
    sectionsTotal: number;
    sectionsImported?: number;
    complete?: boolean;
  };
  const imported = result.sectionsImported ?? result.chapters.length;
  const complete = result.complete ?? result.chapters.length === result.sectionsTotal;
  writeCache(slug, {
    version: 1,
    slug,
    provider: providerSlug(meta.source),
    sourceUrl: meta.sourceUrl,
    generatedAt: new Date().toISOString(),
    complete: Boolean(complete),
    sectionsTotal: result.sectionsTotal,
    sectionsImported: imported,
    config: result.config ?? {},
    chapters: result.chapters,
  });
  makeWork(meta, result.chapters, result.config, imported, result.sectionsTotal, complete);
}

manifest.totals = {
  works: manifest.works.length,
  complete: manifest.works.filter((work: Row) => work.complete).length,
  partial: manifest.works.filter((work: Row) => !work.complete).length,
  chapters: manifest.works.reduce((sum: number, work: Row) => sum + Number(work.chapters ?? 0), 0),
  passages: manifest.works.reduce((sum: number, work: Row) => sum + Number(work.passages ?? 0), 0),
};
streams.generatedAt = RETRIEVED_AT;
writeFileSync(STREAMS, `${JSON.stringify(streams, null, 2)}\n`);
writeFileSync(FUNCTIONS, `${JSON.stringify(functions, null, 2)}\n`);
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `\n${manifest.totals.works} work record(s), ${manifest.totals.chapters} chapters, ${manifest.totals.passages} passages.`,
);
