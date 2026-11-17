// Completes Shankara's Brahma Sutra commentary as one locally held work.
//
// Part I (adhyayas 1–2, padas 1–2) comes from Thibaut's Sacred Books of the
// East volume 34 as Project Gutenberg proofreads it; Part II (padas ii.3–iv.4)
// comes from the Internet Sacred Text Archive's transcription of volume 38,
// which prints one page per sutra section. The two parts are one edition, so
// they are held together as sixteen padas rather than streamed from two hosts
// with two different providers.
//
//   bun run scripts/dev/import-brahma-sutras.ts
//   bun run scripts/dev/import-brahma-sutras.ts --force
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  plaintextParagraphs,
  splitPlaintextChapters,
  stripMarkup,
  type PlaintextAnchor,
} from "../../server/stream";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");
const STREAMS = join(ROOT, "data", "registry", "streams.json");
const CACHE = join(ROOT, "data", "imports", "cache", "hindu");
const SLUG = "badarayana-brahma-sutras";
const USER_AGENT = "UniversalWisdomLibrary/1.0 (local reading interface; Hindu corpus import)";
const force = process.argv.includes("--force");

type Row = Record<string, any>;
type Chapter = { ref: string; label: string; segments: string[] };

const GUTENBERG_TEXT = "https://www.gutenberg.org/cache/epub/16295/pg16295.txt";
const GUTENBERG_PAGE = "https://www.gutenberg.org/ebooks/16295";
const SBE38_INDEX = "https://archive.sacred-texts.com/hin/sbe38/index.htm";
const SBE38_BASE = "https://archive.sacred-texts.com/hin/sbe38/";
const SBE38_SOURCE = "https://archive.sacred-texts.com/hin/sbe38/index.htm";
const PART_I_PADAS = ["1.1", "1.2", "1.3", "1.4", "2.1", "2.2"];
const PADA_LABEL: Record<string, string> = {
  "1.1": "Adhyaya I — Pada I",
  "1.2": "Adhyaya I — Pada II",
  "1.3": "Adhyaya I — Pada III",
  "1.4": "Adhyaya I — Pada IV",
  "2.1": "Adhyaya II — Pada I",
  "2.2": "Adhyaya II — Pada II",
  "2.3": "Adhyaya II — Pada III",
  "2.4": "Adhyaya II — Pada IV",
  "3.1": "Adhyaya III — Pada I",
  "3.2": "Adhyaya III — Pada II",
  "3.3": "Adhyaya III — Pada III",
  "3.4": "Adhyaya III — Pada IV",
  "4.1": "Adhyaya IV — Pada I",
  "4.2": "Adhyaya IV — Pada II",
  "4.3": "Adhyaya IV — Pada III",
  "4.4": "Adhyaya IV — Pada IV",
};
const ADHYAYA_LABEL: Record<string, string> = {
  "1": "Adhyaya I",
  "2": "Adhyaya II",
  "3": "Adhyaya III",
  "4": "Adhyaya IV",
};

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

async function fetchText(url: string, timeoutMs = 120_000): Promise<string> {
  let last: Error | null = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "text/html,text/plain", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) {
        last = new Error(`${url} returned ${res.status}`);
        await Bun.sleep(1_500 * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      return await res.text();
    } catch (err) {
      last = err as Error;
      if (attempt < 5) await Bun.sleep(700 * attempt);
    }
  }
  throw last ?? new Error(`${url} failed`);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function romanToNumber(roman: string): number {
  const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let total = 0;
  const upper = roman.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    const value = values[upper[i]!] ?? 0;
    const next = values[upper[i + 1]!] ?? 0;
    total += value < next ? -value : value;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Part I — Project Gutenberg plain text
// ---------------------------------------------------------------------------

/** Gutenberg prints footnote references as bracketed numbers inside words,
 * and collects the notes themselves in a block at the end of each pada. */
function cleanPartOneParagraphs(section: string): string[] {
  const noteBlock = section.search(/\n\s*\[Footnote \d+:/);
  const body = noteBlock > 0 ? section.slice(0, noteBlock) : section;
  const paragraphs = plaintextParagraphs(body).map((paragraph) =>
    paragraph
      .replace(/\s?\[\d+\]/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
  // The trailing glossary and index are not part of the commentary.
  return paragraphs.filter(
    (paragraph) =>
      !/^(?:FOOTNOTES|INDEX|GLOSSARY|TRANSLITERATION|ABBREVIATIONS)\b/i.test(paragraph) &&
      !/^\[Footnote \d+:/.test(paragraph) &&
      !/^\[?\d+\]?$/.test(paragraph),
  );
}

function buildPartOne(text: string): Map<string, string[]> {
  const source = text.replace(/\r\n/g, "\n");
  const body = source.indexOf("\n*** END OF THE PROJECT GUTENBERG") >= 0
    ? source.slice(0, source.indexOf("\n*** END OF THE PROJECT GUTENBERG"))
    : source;
  const anchors: PlaintextAnchor[] = [
    { ref: "1.1", marker: "FIRST PÂDA.", occurrenceIndex: 0 },
    { ref: "1.2", marker: "SECOND PÂDA.", occurrenceIndex: 0 },
    { ref: "1.3", marker: "THIRD PÂDA.", occurrenceIndex: 0 },
    { ref: "1.4", marker: "FOURTH PÂDA.", occurrenceIndex: 0 },
    { ref: "2.1", marker: "FIRST PÂDA.", occurrenceIndex: 1 },
    { ref: "2.2", marker: "SECOND PADA.", occurrenceIndex: 0 },
  ];
  const split = splitPlaintextChapters(body, anchors);
  const byPada = new Map<string, string[]>();
  for (const anchor of anchors) {
    const section = split.get(anchor.ref) ?? "";
    const segments = cleanPartOneParagraphs(section);
    if (!segments.length) throw new Error(`Part I pada ${anchor.ref} has no paragraphs`);
    byPada.set(anchor.ref, segments);
  }
  return byPada;
}

// ---------------------------------------------------------------------------
// Part II — Internet Sacred Text Archive, one page per sutra section
// ---------------------------------------------------------------------------

function sbe38Segments(html: string): string[] {
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    // Inline footnote markers are links to the page's footnote block; the
    // marker is a printed number, not part of the sentence.
    .replace(/<A NAME="fr_\d+">\s*<\/A>/gi, "")
    .replace(/<A HREF="#fn_\d+">[\s\S]*?<\/A>/gi, "");
  const pageMarker = body.indexOf('<A NAME="page_');
  if (pageMarker > 0) body = body.slice(pageMarker);
  const footnotes = body.search(/<H3[^>]*>\s*Footnotes/i);
  if (footnotes > 0) body = body.slice(0, footnotes);
  const nav = body.indexOf("<nav");
  if (nav > 0) body = body.slice(0, nav);

  const out: string[] = [];
  for (const match of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = stripMarkup(match[1] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    if (/^p\.\s*\d+$/i.test(text)) continue;
    if (/^\d+$/.test(text)) continue;
    if (/^(?:Sacred Texts|Hinduism|Index|Previous|Next|Contents)$/i.test(text)) continue;
    out.push(text);
  }
  return out;
}

type Sbe38Page = { title: string; url: string; parts: string[] };

async function sbe38Index(): Promise<{ title: string; url: string }[]> {
  const html = await fetchText(SBE38_INDEX);
  const pages: { title: string; url: string }[] = [];
  for (const match of html.matchAll(/HREF="(sbe38\d+\.htm)"[^>]*>([\s\S]{0,80}?)<\/A>/gi)) {
    const title = stripMarkup(match[2] ?? "").replace(/\s+/g, " ").trim();
    if (!/^[IVX]+,\s*\d+,\s*\d+/.test(title)) continue;
    pages.push({ title, url: `${SBE38_BASE}${match[1]}` });
  }
  if (pages.length < 300) throw new Error(`the SBE 38 index yielded only ${pages.length} sutra pages`);
  return pages;
}

async function buildPartTwo(): Promise<Map<string, string[]>> {
  const cachePath = join(CACHE, `${SLUG}-part2.json`);
  let pages: Sbe38Page[];
  if (!force && existsSync(cachePath)) {
    pages = readJson(cachePath).pages as Sbe38Page[];
  } else {
    const index = await sbe38Index();
    let done = 0;
    pages = await mapLimit(index, 5, async (page) => {
      const parts = sbe38Segments(await fetchText(page.url));
      done++;
      if (done % 40 === 0) console.log(`  SBE 38 pages fetched: ${done}/${index.length}`);
      return { ...page, parts };
    });
    writeFileSync(cachePath, `${JSON.stringify({ retrievedAt: new Date().toISOString(), pages }, null, 1)}\n`);
  }

  const byPada = new Map<string, string[]>();
  for (const page of pages) {
    const [adhyayaRoman, pada, sutra] = page.title.split(",").map((part) => part.trim());
    const adhyaya = romanToNumber(adhyayaRoman ?? "");
    const padaNumber = Number(pada);
    if (!adhyaya || !padaNumber || !sutra) throw new Error(`unreadable SBE 38 page title: ${page.title}`);
    const ref = `${adhyaya}.${padaNumber}`;
    if (!byPada.has(ref)) byPada.set(ref, []);
    const segments = page.parts.length ? page.parts : [`[${page.title} — the page carried no text]`];
    byPada.get(ref)!.push(...segments);
  }
  return byPada;
}

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------

const partOne = buildPartOne(await fetchText(GUTENBERG_TEXT));
console.log(`Part I: ${[...partOne.values()].reduce((n, s) => n + s.length, 0)} paragraphs in ${partOne.size} padas`);
const partTwo = await buildPartTwo();
console.log(
  `Part II: ${[...partTwo.values()].reduce((n, s) => n + s.length, 0)} paragraphs in ${partTwo.size} padas`,
);

const chapters: Chapter[] = [];
for (const [ref, segments] of [...partOne, ...partTwo]) {
  if (!segments.length) throw new Error(`pada ${ref} is empty`);
  if (segments.some((segment) => !segment.trim() || segment.includes("\uFFFD"))) {
    throw new Error(`pada ${ref} has an empty or corrupted segment`);
  }
  chapters.push({ ref, label: PADA_LABEL[ref] ?? `Adhyaya ${ref}`, segments });
}
chapters.sort((a, b) => {
  const [aa, ap] = a.ref.split(".").map(Number);
  const [ba, bp] = b.ref.split(".").map(Number);
  return (aa ?? 0) - (ba ?? 0) || (ap ?? 0) - (bp ?? 0);
});
if (chapters.length !== 16) throw new Error(`expected sixteen padas, assembled ${chapters.length}`);

const passages = chapters.flatMap((chapter) =>
  chapter.segments.map((_, index) => ({
    reference: `${chapter.ref}.${index + 1}`,
    label: `${chapter.label} §${index + 1}`,
    chapterRef: chapter.ref,
  })),
);
const texts = new Map<string, string>();
for (const chapter of chapters) {
  chapter.segments.forEach((segment, index) => texts.set(`${chapter.ref}.${index + 1}`, segment));
}

const workPath = join(WORKS, `${SLUG}.json`);
if (!existsSync(workPath)) throw new Error(`the catalogue record ${workPath} is missing`);
const work: Row = readJson(workPath);
delete work.textStorage;
work.refScheme = "chapter.paragraph";
work.chapters = chapters.map((chapter) => ({ ref: chapter.ref, label: chapter.label }));
work.passages = passages;
work.availabilityNote =
  "Complete. Parts I and II of Thibaut's translation are held in this library, so all four adhyayas and sixteen padas of Shankara's commentary are readable and searchable: Part I (adhyayas 1–2) from Project Gutenberg's text of Sacred Books of the East volume 34, Part II (padas ii.3–iv.4) from the Internet Sacred Text Archive's transcription of volume 38. The passage index follows the pada and paragraph divisions of the printed edition.";
work.historicalContext =
  "One of the three foundational texts of Vedanta, alongside the Upanishads and the Bhagavad Gita. Thibaut translated Shankara's commentary for the Sacred Books of the East in two volumes (1890 and 1904); this record holds both. The sutras are printed with the commentary, so the reader sees the aphorism and the argument by which Advaita reads it.";
const edition = work.editions[0];
edition.title = "The Vedanta-Sutras with the Commentary by Sankaracharya, Parts I and II";
edition.publisher = "Project Gutenberg; Internet Sacred Text Archive";
edition.publicationYear = 1890;
edition.source = "project-gutenberg";
edition.attributionText =
  "The Vedanta-Sutras with the Commentary by Sankaracharya, translated by George Thibaut (Part I, 1890; Part II, 1904). Public domain in the United States. Part I from Project Gutenberg eBook #16295; Part II from the Internet Sacred Text Archive transcription of Sacred Books of the East volume 38.";
edition.structureScheme = "adhyaya — pada — paragraph";
edition.notes =
  "Both parts of Thibaut's translation are held locally, so the work reads without a network request. Part I retains Gutenberg's paragraphing with the printed footnote references removed; Part II follows the Sacred Text Archive's page-per-section transcription, whose paragraph breaks are kept. The commentary's own footnotes are not included in either part.";
edition.texts = Object.fromEntries(texts);
work.editions = [edition];
writeFileSync(workPath, `${JSON.stringify(work, null, 2)}\n`);

const streams = readJson(STREAMS);
if (streams.works[SLUG]) {
  delete streams.works[SLUG];
  streams.generatedAt = new Date().toISOString().slice(0, 10);
  writeFileSync(STREAMS, `${JSON.stringify(streams, null, 2)}\n`);
}

const words = [...texts.values()].reduce((n, text) => n + text.split(/\s+/).filter(Boolean).length, 0);
console.log(
  `Sankaracharya's Brahma Sutra commentary: ${chapters.length} padas, ${passages.length} passages, ${words.toLocaleString()} words.`,
);
