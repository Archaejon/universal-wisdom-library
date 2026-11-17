// Adds the Jainism shelf: the four works of Hermann Jacobi's Jaina Sutras
// (Sacred Books of the East, volumes 22 and 45, 1884 and 1895).
//
//   bun run import:jain
//   bun run import:jain --report          # read the cached views, print the plan
//   bun run import:jain --only=kalpa-sutra
//   bun run import:jain --force           # re-read the reading views
//
// The texts are streamed from sacred-texts.com, whose current site serves each
// printed chapter as a reading view backed by one JSON document. Only the
// catalogue record, the chapter outline and the passage index are written here;
// the reader asks the archive for the views a chapter needs.
//
// The archive's transcription carries the marks of the printed page it was
// scanned from: a page number stands in the text where the page turned, a run
// of blank paragraphs sits around it, and the paragraph it interrupts continues
// on the far side. `sacredTextsPage` in server/stream.ts drops the numbers and
// the blanks and rejoins the paragraphs, and the importer indexes exactly what
// that function returns, so search and the reader cannot disagree about where a
// page break fell.
//
// Chapters follow the volumes' own tables of contents: the twenty-four lectures
// of the Acaranga, the twelve divisions of the Kalpa Sutra, the thirty-six
// lectures of the Uttaradhyayana and the twenty-three lectures of the
// Sutrakritanga. A lecture printed across several reading views (the Acaranga's
// lessons, the Sutrakritanga's chapters) is one chapter whose address is the
// list of views that carry it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchTextWithCurl, sacredTextsPage, svelteKitData } from "../../server/stream";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");
const STREAMS = join(ROOT, "data", "registry", "streams.json");
const FUNCTIONS = join(ROOT, "data", "corpus", "text-functions.json");
const META = join(ROOT, "data", "corpus", "meta.json");
const MANIFEST = join(ROOT, "data", "imports", "jain.json");
const ACQUISITION = join(ROOT, "data", "registry", "acquisition.json");
const CACHE = join(ROOT, "data", "imports", "cache", "sacred-texts-json");
const SITE = "https://sacred-texts.com/book";
const RETRIEVED_AT = new Date().toISOString().slice(0, 10);
// The archive refuses a client that is not a browser, and Bun's own TLS stack is
// refused whatever headers it carries, so the views are read through curl. A
// short burst also raises its filter, which lifts again after a pause.
const PAGE_DELAY_MS = 1_200;

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.split("=").slice(1).join("=") ?? "";
const force = args.includes("--force");
const reportOnly = args.includes("--report");

type Row = Record<string, any>;
type Volume = {
  book: string;
  title: string;
  /** The work a volume opens with, before any page says otherwise. */
  opening: string;
};

const VOLUMES: Volume[] = [
  { book: "jaina-sutras-part-i", title: "Jaina Sutras, Part I (SBE 22)", opening: "acaranga-sutra" },
  { book: "jaina-sutras-part-ii", title: "Jaina Sutras, Part II (SBE 45)", opening: "uttaradhyayana-sutra" },
];

const FURNITURE =
  /^(?:start-reading|page-index|contents|introduction|index|special-pages-errata|index-of-names-and-subjects|index-of-sanskrit-and-prakrit-words-occurring-in-the-text-and-the-notes)$/;

// ---------------------------------------------------------------------------
// Reading the archive
// ---------------------------------------------------------------------------

async function getJson(url: string): Promise<any> {
  let last: Error | null = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const { status, body } = await fetchTextWithCurl(url);
      // A refusal here is the archive's filter rather than a missing page, and
      // it lifts: the burst is what raised it, so the wait grows.
      if (status === 403 || status === 429 || status >= 500) {
        last = new Error(`${url} answered ${status}`);
        await Bun.sleep(8_000 * attempt);
        continue;
      }
      if (status !== 200) throw new Error(`${url} answered ${status}`);
      return JSON.parse(body);
    } catch (err) {
      last = err as Error;
      if (attempt < 6) await Bun.sleep(2_000 * attempt);
    }
  }
  throw last ?? new Error(`${url} failed`);
}

/** Every reading view of a volume, in the archive's own order. */
async function volumeViews(book: string): Promise<{ slug: string; title: string }[]> {
  const seen = new Map<string, string>();
  for (let page = 1; page <= 8; page++) {
    const url = `${SITE}/${book}/__data.json${page > 1 ? `?chaptersPage=${page}` : ""}`;
    const data = svelteKitData(await getJson(url));
    let fresh = 0;
    for (const chapter of Array.isArray(data?.chapters) ? data.chapters : []) {
      const slug = String(chapter?.chapterSlug ?? "");
      if (!slug || seen.has(slug)) continue;
      seen.set(slug, String(chapter?.chapterTitle ?? ""));
      fresh++;
    }
    if (!fresh) break;
  }
  return [...seen.entries()].map(([slug, title]) => ({ slug, title }));
}

type CachedPage = {
  book: string;
  slug: string;
  url: string;
  title: string;
  /** The reading view as it arrived, so a cleaning rule can be revised offline. */
  html: string;
  headings: string[];
  segments: string[];
  /** The printed page numbers the transcription carried inline. */
  pages: number[];
  /** Paragraphs a page turn cut in two, rejoined into one. */
  rejoined: number;
};

/**
 * The contents page's table. It is kept as the raw view rather than as cleaned
 * paragraphs because the printed table is what names the chapters; the rows are
 * read from the HTML, not from its prose.
 */
async function readContents(book: string): Promise<string> {
  const file = join(CACHE, "views", book, "contents.html");
  if (!force && existsSync(file)) return readFileSync(file, "utf8");
  const data = svelteKitData(await getJson(`${SITE}/${book}/contents/__data.json`));
  const html = String(data?.chapterContent?.contentHtml ?? "");
  if (!html) throw new Error(`${book}: the contents page carried no text`);
  mkdirSync(join(CACHE, "views", book), { recursive: true });
  writeFileSync(file, html);
  await Bun.sleep(PAGE_DELAY_MS);
  return html;
}

function pageCachePath(book: string, slug: string) {
  return join(CACHE, "views", book, `${slug}.json`);
}

async function readView(book: string, slug: string, title: string): Promise<CachedPage> {
  const file = pageCachePath(book, slug);
  if (!force && existsSync(file)) {
    const cached = JSON.parse(readFileSync(file, "utf8")) as CachedPage;
    // The view is re-cleaned from the transcription it was read from, so a
    // revised rule applies to everything already fetched without asking the
    // archive again.
    return cached.html ? { ...cached, ...sacredTextsPage(cached.html) } : cached;
  }
  const url = `${SITE}/${book}/${slug}`;
  const data = svelteKitData(await getJson(`${url}/__data.json`));
  const html = String(data?.chapterContent?.contentHtml ?? "");
  if (!html) throw new Error(`${url} carried no text`);
  const cleaned = sacredTextsPage(html);
  if (!cleaned.segments.length) throw new Error(`${url} carried no paragraphs`);
  const page: CachedPage = { book, slug, url, title, html, ...cleaned };
  mkdirSync(join(CACHE, "views", book), { recursive: true });
  // Written one view at a time: an interrupted run keeps what it has read.
  writeFileSync(file, `${JSON.stringify(page, null, 2)}\n`);
  await Bun.sleep(PAGE_DELAY_MS);
  return page;
}

// ---------------------------------------------------------------------------
// The printed tables of contents
// ---------------------------------------------------------------------------

/**
 * A chapter as the volume's own contents page prints it: the work it belongs
 * to, its book, the lecture number the table prints beside it, and its title.
 * The page links in the table point at the printed page a chapter opens on,
 * which is not always the view it opens: a lecture can begin inside an earlier
 * lecture's view, so the links are not used to group the text.
 */
type TocRow = { work: string | null; book: number; lecture: number | null; title: string };

function decodeText(input: string): string {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The rows of a volume's contents page, in printed order. A row names a chapter
 * when it links to the view that chapter begins at; a row that only carries a
 * section heading ("FIRST BOOK.", "LIVES OF THE GINAS") has no link and is not a
 * chapter.
 */
export function contentsRows(html: string): TocRow[] {
  const out: TocRow[] = [];
  let work: string | null = null;
  let book = 1;
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...(row[1] ?? "").matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((cell) => decodeText((cell[1] ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "")))
      .filter(Boolean);
    const text = plain(cells.join(" "));
    if (!text) continue;
    // A row that names a work or a book opens a new section rather than a
    // chapter of its own.
    const section = workOf(text);
    if (section) {
      work = section;
      book = 1;
      continue;
    }
    if (/^(?:LIVES OF THE GINAS|TRANSLITERATION OF ORIENTAL)/.test(text)) continue;
    const bookMatch = /^(FIRST|SECOND|THIRD|FOURTH) BOOK/.exec(text);
    if (bookMatch) {
      book = ordinalValue(bookMatch[1]!);
      continue;
    }
    // A row under a lecture names one of its chapters; the lecture is the unit
    // this library holds.
    if (/^CHAPTER\b/.test(text)) continue;
    const lecture = cells.map((cell) => /^(\d+)\.$/.exec(cell)).find(Boolean)?.[1];
    const titles = cells.filter(
      (cell) =>
        !/^(?:lec(?:ture)?\.?|page|["'”’]|\d+\.?|[ivxlcdm]+|\d+[-–]\d+|chapter\b.*)$/i.test(cell),
    );
    // Prefer the cell set in lower case: an all-capitals cell is a section
    // heading the table prints above the title.
    const titled = titles.filter((cell) => /[a-z]/.test(cell));
    const title = (titled.length ? titled : titles).sort((a, b) => b.length - a.length)[0] ?? "";
    // "Lecture 1", the ditto marks that follow it, and the front and back
    // matter are not chapters.
    if (!title || /^(?:["'”’]\s*\d*\.?|lecture\s*\d+\.?|introduction|contents|index|errata)$/i.test(title)) continue;
    out.push({
      work,
      book,
      lecture: lecture ? Number(lecture) : null,
      title: chapterTitle(title),
    });
  }
  return out;
}

/** The work a contents row or a heading names, if it names one. */
function workOf(text: string): string | null {
  if (/KALPA SUTRA/.test(text)) return "kalpa-sutra";
  if (/UTTARADHYAYANA/.test(text)) return "uttaradhyayana-sutra";
  if (/SUTRAKRITANGA/.test(text)) return "sutrakritanga";
  if (/AKARANGA/.test(text)) return "acaranga-sutra";
  return null;
}

/** The title as a chapter label carries it: the printed heading, without the
 * translator's editorial note in brackets. */
function chapterTitle(printed: string): string {
  return printed
    .replace(/\s*\((?:[^()]|\([^()]*\))*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[.,;:\s]+$/, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Chapter structure
// ---------------------------------------------------------------------------

const UNITS = ["FIRST", "SECOND", "THIRD", "FOURTH", "FIFTH", "SIXTH", "SEVENTH", "EIGHTH", "NINTH"];
const TEENS = [
  "TENTH", "ELEVENTH", "TWELFTH", "THIRTEENTH", "FOURTEENTH",
  "FIFTEENTH", "SIXTEENTH", "SEVENTEENTH", "EIGHTEENTH", "NINETEENTH",
];
const TENS: Record<string, number> = { TWENTY: 20, THIRTY: 30, FORTY: 40 };
const TENS_ORDINAL: Record<string, number> = { TWENTIETH: 20, THIRTIETH: 30, FORTIETH: 40 };

/** "THIRTIETH" → 30, from the ordinal headings the volumes print. */
export function ordinalValue(word: string): number {
  // The volumes write twenty-one and above with a hyphen ("THIRTY-FIFTH").
  const upper = word.toUpperCase().replace(/-/g, "");
  const unit = UNITS.indexOf(upper);
  if (unit >= 0) return unit + 1;
  const teen = TEENS.indexOf(upper);
  if (teen >= 0) return teen + 10;
  const tens = TENS_ORDINAL[upper];
  if (tens) return tens;
  const compound = /^(TWENTY|THIRTY|FORTY)(FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH)?$/.exec(upper);
  if (!compound) return 0;
  return (TENS[compound[1]!] ?? 0) + (compound[2] ? UNITS.indexOf(compound[2]) + 1 : 0);
}

/** Diacritics folded away, so a heading can be matched whatever its accents. */
function plain(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function declaredWork(headings: string[]): string | null {
  for (const heading of headings) {
    const work = workOf(plain(heading));
    if (work) return work;
  }
  return null;
}

function declaredBook(headings: string[]): number | null {
  for (const heading of headings) {
    const match = /^(FIRST|SECOND|THIRD) BOOK/.exec(plain(heading));
    if (match) return ordinalValue(match[1]!);
  }
  return null;
}

function declaredLecture(headings: string[]): number | null {
  for (const heading of headings) {
    const match = /^([A-Z-]+) LECTURE/.exec(plain(heading));
    if (match) {
      const value = ordinalValue(match[1]!);
      if (value) return value;
    }
  }
  return null;
}

const ROMAN: Record<number, string> = { 1: "I", 2: "II", 3: "III" };

/** The chapters each work is printed in, checked after planning. */
const EXPECTED: Record<string, number> = {
  "acaranga-sutra": 24,
  "kalpa-sutra": 11,
  "uttaradhyayana-sutra": 36,
  "sutrakritanga": 23,
};

type Chapter = { work: string; ref: string; label: string; pages: CachedPage[] };


/**
 * The chapters of one volume. The views carry their own printed headings — the
 * work, the book, the number of the lecture — and those headings are what the
 * chapters are built from, since the archive's addresses are not always in the
 * printed order (one view of the Acaranga's second book is filed two lectures
 * late). The contents page supplies the titles: it numbers its rows, and a
 * number matches the heading the view prints.
 *
 * The Kalpa Sutra is the exception: its contents list the lives and the lists,
 * and each reading view under them is a chapter of its own, since the life of
 * Mahavira alone runs to five.
 */
export function planVolume(volume: Volume, views: CachedPage[], contents: TocRow[]): Chapter[] {
  const titles = new Map<string, string>();
  for (const row of contents) {
    if (!row.work || !row.lecture) continue;
    titles.set(`${row.work}|${row.book}|${row.lecture}`, row.title);
  }
  const kalpaTitles = contents
    .filter((row) => row.work === "kalpa-sutra" && !row.lecture)
    .map((row) => row.title);

  const chapters: Chapter[] = [];
  const byKey = new Map<string, Chapter>();
  const countByWork = new Map<string, number>();
  let work = volume.opening;
  let book = 1;
  let lecture = 0;
  let kalpaTitle = 0;

  for (const view of views) {
    const detected = declaredWork(view.headings);
    if (detected) work = detected;
    const headingBook = declaredBook(view.headings);
    if (headingBook) book = headingBook;
    const headingLecture = declaredLecture(view.headings);
    if (headingLecture) lecture = headingLecture;
    const position = (countByWork.get(work) ?? 0) + 1;
    countByWork.set(work, position);

    if (work === "kalpa-sutra") {
      // A heading set in lower case names the chapter the view continues (the
      // life of Mahavira's second lecture says so); an all-capitals heading is
      // the chapter's opening, and its title is the next one the contents give.
      const own = view.headings.find(
        (heading) => /[a-z]/.test(heading) && /^(?:Life|List|Rules|Epochs)\b/.test(heading),
      );
      const title = own ?? kalpaTitles[kalpaTitle] ?? `Chapter ${position}`;
      if (!own) kalpaTitle++;
      chapters.push({
        work,
        ref: String(position),
        label: chapterTitle(title),
        pages: [view],
      });
      continue;
    }

    const number = lecture || 1;
    const key = `${work}|${book}|${number}`;
    let chapter = byKey.get(key);
    if (!chapter) {
      // Seven lectures of the Acaranga's second book are printed in the table of
      // contents without a title, and the text gives none either; the number is
      // the whole of their name.
      const title = titles.get(key) ?? "";
      const label =
        work === "uttaradhyayana-sutra"
          ? `Lecture ${number}${title ? ` — ${title}` : ""}`
          : `Book ${ROMAN[book] ?? book}, Lecture ${number}${title ? ` — ${title}` : ""}`;
      chapter = {
        work,
        ref: work === "uttaradhyayana-sutra" ? String(number) : `${book}.${number}`,
        label,
        pages: [],
      };
      byKey.set(key, chapter);
      chapters.push(chapter);
    }
    chapter.pages.push(view);
  }
  return chapters;
}

// ---------------------------------------------------------------------------
// The works
// ---------------------------------------------------------------------------

type WorkSpec = {
  slug: string;
  title: string;
  originalTitle: string;
  transliteration: string;
  altTitles: string[];
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
  refScheme: string;
  volume: string;
  volumeNumber: string;
  translationTitle: string;
  translationYear: number;
  editionSlug: string;
  editionNotes: string;
  structureScheme: string;
  functions: string[];
  functionStatus: string;
  functionNote: string;
};

const WORKS_SPEC: WorkSpec[] = [
  {
    slug: "acaranga-sutra",
    title: "Acaranga Sutra",
    originalTitle: "आचाराङ्ग सूत्र",
    transliteration: "Ācārāṅga Sūtra",
    altTitles: ["Akaranga Sutra", "Āyāraṃga Sutta", "The Conduct of the Monks"],
    genre: "Scripture",
    textType: "Monastic discipline and teaching",
    category: "Scripture",
    subcategory: "Monastic discipline and teaching",
    originalLanguage: "pra",
    dateStart: -400,
    dateEnd: -300,
    dateDisplay: "c. 4th–3rd centuries BCE (traditional dating earlier)",
    authorshipStatus: "composite",
    author: "mahavira",
    attributionNote:
      "Traditionally preserves the teaching of Mahāvīra as transmitted by his disciple Sudharman, in whose voice the lectures are spoken. The text reached its present form through a long process of transmission and canon formation.",
    description:
      "The first and oldest of the Śvetāmbara canon's twelve Aṅgas, in two books: eight lectures on the discipline of the mendicant and the harm done by the passions, and sixteen on the begging of food, drink, clothes and a couch, the postures of the ascetic and the rules of conduct. Its first lecture, 'Knowledge of the Weapon', examines the causes of injury, and the whole work is the classical statement of ahiṃsā as a daily discipline.",
    historicalContext:
      "The Śvetāmbara canon was fixed at the council of Valabhī in the fifth century CE, drawing on older oral tradition. The Acaranga is the oldest layer of that canon and the standard source for the early Jain ascetic ethic; its attention to life in earth, water, fire and plants has made it central to modern Jain identity and to environmental readings of Jainism.",
    availabilityNote:
      "Streamed from the Internet Sacred Text Archive view by view at read time. Jacobi's 1884 translation is public domain; the Prakrit text is not included.",
    refScheme: "book.lecture.paragraph",
    volume: "jaina-sutras-part-i",
    volumeNumber: "22",
    translationTitle: "Jaina Sutras, Part I (Sacred Books of the East, vol. 22)",
    translationYear: 1884,
    editionSlug: "acaranga-en-jacobi",
    editionNotes:
      "Jacobi's 1884 translation for the Sacred Books of the East, with his introduction. The printed page numbers the scan carried in the text are dropped and the paragraphs a page turn cut in two are rejoined; Jacobi's footnotes are the volume's apparatus and are not carried. The verse numbers he prints in parentheses are kept.",
    structureScheme: "two books of lectures, one chapter per lecture",
    functions: ["canonical_scripture", "religious_law_practice"],
    functionStatus: "disputed",
    functionNote:
      "A Śvetāmbara Aṅga. The Digambara canon and its recensions differ, so the classification is not universal to all Jains.",
  },
  {
    slug: "kalpa-sutra",
    title: "Kalpa Sutra",
    originalTitle: "कल्पसूत्र",
    transliteration: "Kalpa Sūtra",
    altTitles: ["Kalpasutra of Bhadrabahu", "The Book of Sacred Ritual"],
    genre: "Scripture",
    textType: "Lives of the Jinas and monastic rule",
    category: "Scripture",
    subcategory: "Lives of the Jinas and monastic rule",
    originalLanguage: "pra",
    dateStart: -300,
    dateEnd: 400,
    dateDisplay: "c. 3rd century BCE–4th century CE (traditional dating earlier)",
    authorshipStatus: "traditional",
    author: "bhadrabahu",
    attributionNote:
      "Traditionally ascribed to Bhadrabāhu, the fourth of the Śvetāmbara patriarchs. The attribution is traditional rather than documentary, and the work as received is a compilation.",
    description:
      "The Śvetāmbara handbook of the lives of the Jinas and the rule of the rainy-season retreat, in twelve chapters: five lectures on the life of Mahāvīra from his descent into the womb to his liberation, the lives of Pārśva, Ariṣṭanemi and Ṛṣabha, the epochs of the intermediate Tīrthaṅkaras, the list of the patriarchs, and the rules for the mendicants' annual confession. It is the text most often copied and illuminated in western India, and the reading of the life of Mahāvīra from it is the centre of the Paryuṣaṇa festival.",
    historicalContext:
      "The Kalpa Sūtra belongs to the Śvetāmbara liturgical canon rather than to the twelve Aṅgas, and its text grew over centuries: the lives draw on older hagiography, and the list of patriarchs was continued as the community's history lengthened. Its public reading at Paryuṣaṇa made it the most widely known of all Jain books.",
    availabilityNote:
      "Streamed from the Internet Sacred Text Archive view by view at read time. Jacobi's 1884 translation is public domain; the Prakrit text is not included.",
    refScheme: "chapter.paragraph",
    volume: "jaina-sutras-part-i",
    volumeNumber: "22",
    translationTitle: "Jaina Sutras, Part I (Sacred Books of the East, vol. 22)",
    translationYear: 1884,
    editionSlug: "kalpa-sutra-en-jacobi",
    editionNotes:
      "Jacobi's 1884 translation for the Sacred Books of the East, printed after the Acaranga in the same volume. The printed page numbers the scan carried in the text are dropped and the paragraphs a page turn cut in two are rejoined; Jacobi's footnotes are the volume's apparatus and are not carried.",
    structureScheme: "one chapter per life or list, the life of Mahavira in five lectures",
    functions: ["canonical_scripture", "religious_law_practice"],
    functionStatus: "disputed",
    functionNote:
      "A Śvetāmbara liturgical work outside the twelve Aṅgas. Digambara tradition does not receive it, so its scriptural status is not universal to all Jains.",
  },
  {
    slug: "uttaradhyayana-sutra",
    title: "Uttaradhyayana Sutra",
    originalTitle: "उत्तराध्ययन सूत्र",
    transliteration: "Uttarādhyayana Sūtra",
    altTitles: ["Uttarajjhayaṇa Sutta", "The Later Lectures"],
    genre: "Scripture",
    textType: "Didactic verse",
    category: "Scripture",
    subcategory: "Didactic verse",
    originalLanguage: "pra",
    dateStart: -300,
    dateEnd: 200,
    dateDisplay: "c. 3rd century BCE–2nd century CE",
    authorshipStatus: "composite",
    author: null,
    attributionNote:
      "A compilation of older material drawn from the tradition of Mahāvīra's teaching, framed in the voice of his disciple Sudharman. No single author is recorded, and the last lecture is a later addition.",
    description:
      "The most widely read of the Śvetāmbara scriptures after the Kalpa Sūtra: thirty-six lectures in verse, on discipline, the hardships of the ascetic life, the four requisites, death, the false ascetic, the parable of the ram, the pravrajyā of King Nami, the leaf of the tree, the very learned monk, the true monk, the ten conditions of chastity, the nature of karman, the leśyās, the houseless monk, and the road of penance. Its stories and similes made it the standard primer of Jain doctrine.",
    historicalContext:
      "The Uttarādhyayana is not one of the twelve Aṅgas but an independent collection, quoted by both Śvetāmbara and Digambara authors and translated early into several Indian languages. Its thirty-sixth lecture, a summary of the whole, is generally recognised as a later supplement.",
    availabilityNote:
      "Streamed from the Internet Sacred Text Archive view by view at read time. Jacobi's 1895 translation is public domain; the Prakrit text is not included.",
    refScheme: "lecture.paragraph",
    volume: "jaina-sutras-part-ii",
    volumeNumber: "45",
    translationTitle: "Jaina Sutras, Part II (Sacred Books of the East, vol. 45)",
    translationYear: 1895,
    editionSlug: "uttaradhyayana-en-jacobi",
    editionNotes:
      "Jacobi's 1895 translation for the Sacred Books of the East. The printed page numbers the scan carried in the text are dropped and the paragraphs a page turn cut in two are rejoined; Jacobi's footnotes are the volume's apparatus and are not carried. The verse numbers he prints in parentheses are kept.",
    structureScheme: "thirty-six lectures",
    functions: ["canonical_scripture", "religious_law_practice"],
    functionStatus: "disputed",
    functionNote:
      "Received as scripture by the Śvetāmbara and, in part, by the Digambara tradition, but outside the twelve Aṅgas; its status and the extent of the canon differ between the schools.",
  },
  {
    slug: "sutrakritanga",
    title: "Sutrakritanga",
    originalTitle: "सूत्रकृताङ्ग",
    transliteration: "Sūtrakṛtāṅga",
    altTitles: ["Suyagaḍaṃga", "The Scripture of the Doctrine"],
    genre: "Scripture",
    textType: "Doctrine and disputation",
    category: "Scripture",
    subcategory: "Doctrine and disputation",
    originalLanguage: "pra",
    dateStart: -300,
    dateEnd: -200,
    dateDisplay: "c. 3rd–2nd centuries BCE",
    authorshipStatus: "composite",
    author: null,
    attributionNote:
      "Traditionally the teaching of Mahāvīra transmitted by Sudharman, in whose voice the dialogue is spoken. The second book is generally held to be the later of the two.",
    description:
      "The second Aṅga of the Śvetāmbara canon, in two books: sixteen lectures on the doctrine and on the refutation of rival teachers — the Kriyāvādins, Akriyāvādins, Ajñānikas and Vinayavādins — and seven on activity, food, the renunciation of activity, freedom from error and the debates at Nālandā. It is the canon's principal work of argument, and a principal source for what early Jain authors knew of other schools.",
    historicalContext:
      "The Sūtrakṛtāṅga preserves one of the oldest Jain accounts of the philosophical landscape of northern India, classifying and answering the fatalists, the eternalists and the sceptics. Its second book, with the Nālandā debates, is later in style and doctrine than the first.",
    availabilityNote:
      "Streamed from the Internet Sacred Text Archive view by view at read time. Jacobi's 1895 translation is public domain; the Prakrit text is not included.",
    refScheme: "book.lecture.paragraph",
    volume: "jaina-sutras-part-ii",
    volumeNumber: "45",
    translationTitle: "Jaina Sutras, Part II (Sacred Books of the East, vol. 45)",
    translationYear: 1895,
    editionSlug: "sutrakritanga-en-jacobi",
    editionNotes:
      "Jacobi's 1895 translation for the Sacred Books of the East. The printed page numbers the scan carried in the text are dropped and the paragraphs a page turn cut in two are rejoined; Jacobi's footnotes are the volume's apparatus and are not carried.",
    structureScheme: "two books of lectures",
    functions: ["canonical_scripture"],
    functionStatus: "disputed",
    functionNote:
      "A Śvetāmbara Aṅga. The Digambara canon and its recensions differ, so the classification is not universal to all Jains.",
  },
];

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

// The build runs only when this file is executed; the helpers above are read by
// the tests, which must not find the archive being fetched because they imported
// the rules that read it.
async function main() {
const streams = JSON.parse(readFileSync(STREAMS, "utf8"));
const functions = JSON.parse(readFileSync(FUNCTIONS, "utf8"));
const meta = JSON.parse(readFileSync(META, "utf8"));
const acquisition: Row = existsSync(ACQUISITION) ? JSON.parse(readFileSync(ACQUISITION, "utf8")) : { targets: [] };
const manifest: Row = existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, "utf8"))
  : {
      source: "sacred-texts",
      retrieved_at: RETRIEVED_AT,
      note:
        "Catalogue records, chapter outlines and passage indexes only. The four works of Jacobi's Jaina Sutras are streamed from sacred-texts.com at read time and are not stored in this corpus.",
      hosts: [
        {
          id: "sacred-texts",
          name: "Internet Sacred Text Archive",
          url: "https://sacred-texts.com/",
          licence: "public-domain translations",
        },
      ],
      works: [] as Row[],
      totals: { works: 0, chapters: 0, passages: 0 },
    };
manifest.retrieved_at = RETRIEVED_AT;

// The Kalpa Sutra's traditional author is not in the library's author list yet.
if (!meta.authors.some((author: Row) => author.slug === "bhadrabahu")) {
  meta.authors.push({
    slug: "bhadrabahu",
    name: "Bhadrabāhu",
    sort_name: "Bhadrabahu",
    date_display: "Traditional: 4th century BCE",
    description:
      "The fourth Śvetāmbara patriarch, to whom the Kalpa Sūtra is traditionally ascribed. Tradition transmits his name rather than documentary evidence of authorship.",
    is_attributed: true,
  });
  meta.authors.sort((a: Row, b: Row) => String(a.sort_name).localeCompare(String(b.sort_name)));
}

const started = Date.now();
const planned: Chapter[] = [];

for (const volume of VOLUMES) {
  const views = await volumeViews(volume.book);
  const text = views.filter((view) => !FURNITURE.test(view.slug));
  console.log(`${volume.title}: ${views.length} views, ${text.length} carrying text`);
  const contents = contentsRows(await readContents(volume.book));
  if (!contents.length) throw new Error(`${volume.title}: the contents page yielded no chapters`);
  console.log(`  ${contents.length} chapters named on the contents page; first: ${contents[0]!.title}`);

  const pages: CachedPage[] = [];
  for (const view of text) pages.push(await readView(volume.book, view.slug, view.title));
  const chapters = planVolume(volume, pages, contents);
  planned.push(...chapters);
  const byWork = new Map<string, number>();
  for (const chapter of chapters) byWork.set(chapter.work, (byWork.get(chapter.work) ?? 0) + 1);
  console.log(`  plans ${[...byWork.entries()].map(([work, n]) => `${work} ${n}`).join(", ")}`);
}

// A work whose chapters do not match the print means the headings or the
// contents page changed shape, and a silently short shelf is worse than a
// failed import.
for (const [work, expected] of Object.entries(EXPECTED)) {
  const found = planned.filter((chapter) => chapter.work === work).length;
  if (found !== expected) {
    throw new Error(`${work}: planned ${found} chapters, but the volume prints ${expected}`);
  }
}

for (const spec of WORKS_SPEC) {
  if (only && only !== spec.slug) continue;
  const plan = planned.filter((chapter) => chapter.work === spec.slug);
  if (!plan.length) {
    console.log(`${spec.title}: nothing planned`);
    continue;
  }
  const chapters: Row[] = [];
  const passages: Row[] = [];
  const indexed: { ref: string; label: string; segments: string[] }[] = [];
  let words = 0;
  let views = 0;
  let printedPages = 0;
  let rejoined = 0;

  for (const chapter of plan) {
    const segments = chapter.pages.flatMap((page) => page.segments);
    views += chapter.pages.length;
    for (const page of chapter.pages) {
      printedPages += page.pages.length;
      rejoined += page.rejoined;
    }
    words += segments.join(" ").split(/\s+/).filter(Boolean).length;
    chapters.push({ ref: chapter.ref, label: chapter.label });
    indexed.push({ ref: chapter.ref, label: chapter.label, segments });
    for (const [index] of segments.entries()) {
      passages.push({
        reference: `${chapter.ref}.${index + 1}`,
        label: `${chapter.label} §${index + 1}`,
        chapterRef: chapter.ref,
      });
    }
  }

  const work = {
    slug: spec.slug,
    title: spec.title,
    originalTitle: spec.originalTitle,
    transliteration: spec.transliteration,
    altTitles: spec.altTitles,
    tradition: "jainism",
    school: "svetambara",
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
    refScheme: spec.refScheme,
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
        translator: "Hermann Jacobi",
        publisher: "Clarendon Press",
        publicationYear: spec.translationYear,
        source: "sacred-texts",
        license: "public-domain",
        rightsStatus: "Public domain in the United States",
        attributionText: `${spec.translationTitle}, translated by Hermann Jacobi (${spec.translationYear}). Public domain in the United States. Read from the Internet Sacred Text Archive, sacred-texts.com.`,
        structureScheme: spec.structureScheme,
        isSample: false,
        notes: spec.editionNotes,
      },
    ],
  };

  streams.works[spec.slug] = {
    provider: "sacred-texts-json",
    upstream: spec.translationTitle,
    mode: "numbered",
    licence: "public-domain",
    config: {
      book: spec.volume,
      chapters: Object.fromEntries(
        plan.map((chapter) => [
          chapter.ref,
          { label: chapter.label, pages: chapter.pages.map((page) => page.slug) },
        ]),
      ),
    },
    editions: [
      {
        slug: spec.editionSlug,
        language: "en",
        languageName: "english",
        version: spec.translationTitle,
        license: "public-domain",
        sourceUrl: `https://sacred-texts.com/book/${spec.volume}`,
      },
    ],
  };
  functions.works[spec.slug] = {
    functions: spec.functions,
    status: spec.functionStatus,
    assignedBy: "UWL editors (comparative taxonomy)",
    note: spec.functionNote,
  };

  console.log(
    `${spec.title}: ${chapters.length} chapters, ${passages.length} passages, ${words} words ` +
      `(${views} reading views, ${printedPages} printed page numbers dropped, ${rejoined} paragraphs rejoined)`,
  );
  if (reportOnly) continue;

  writeFileSync(join(WORKS, `${spec.slug}.json`), `${JSON.stringify(work, null, 2)}\n`);
  // The search indexer reads this summary rather than crawling the host again,
  // and refuses a chapter whose cached segments no longer line up with the
  // passage index, so the two cannot drift apart unwatched.
  const cache = { version: 1, slug: spec.slug, provider: "sacred-texts-json", generatedAt: RETRIEVED_AT, chapters: indexed };
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(join(CACHE, `${spec.slug}.json`), `${JSON.stringify(cache, null, 2)}\n`);

  const entry = {
    slug: spec.slug,
    host: "sacred-texts",
    upstream: spec.translationTitle,
    translator: "Hermann Jacobi",
    chapters: chapters.length,
    passages: passages.length,
    firstChapter: chapters[0]?.label ?? "",
    lastChapter: chapters.at(-1)?.label ?? "",
  };
  const at = (manifest.works as Row[]).findIndex((row) => row.slug === spec.slug);
  if (at >= 0) manifest.works[at] = entry;
  else manifest.works.push(entry);

  const target = {
    slug: spec.slug,
    title: spec.title,
    original_title: spec.originalTitle,
    transliteration: spec.transliteration,
    author: spec.author ?? "",
    tradition: "jainism",
    school: "svetambara",
    genre: spec.genre,
    category: spec.category,
    status: "imported",
    priority: 3,
    languages: ["pra", "en"],
    source_leads: [
      {
        source: "Internet Sacred Text Archive",
        url: `https://sacred-texts.com/book/${spec.volume}`,
        note: `Hermann Jacobi's translation (SBE ${spec.volumeNumber}, ${spec.translationYear}).`,
      },
    ],
    rights_note:
      "Jacobi's translation is public domain in the United States. The reading views are served by sacred-texts.com, whose transcription is used under its site terms.",
    note: `Imported complete: ${chapters.length} chapters and ${passages.length} passages, streamed from the archive one reading view at a time.`,
  };
  const targetAt = Array.isArray(acquisition.targets)
    ? (acquisition.targets as Row[]).findIndex((row) => row.slug === spec.slug)
    : -1;
  if (targetAt >= 0) acquisition.targets[targetAt] = { ...acquisition.targets[targetAt], ...target };
  else {
    acquisition.targets = acquisition.targets ?? [];
    acquisition.targets.push(target);
  }
}

if (!reportOnly) {
  manifest.totals.works = (manifest.works as Row[]).length;
  manifest.totals.chapters = (manifest.works as Row[]).reduce((sum, w) => sum + Number(w.chapters ?? 0), 0);
  manifest.totals.passages = (manifest.works as Row[]).reduce((sum, w) => sum + Number(w.passages ?? 0), 0);
  streams.generatedAt = RETRIEVED_AT;
  acquisition.updated_at = RETRIEVED_AT;
  writeFileSync(STREAMS, `${JSON.stringify(streams, null, 2)}\n`);
  writeFileSync(FUNCTIONS, `${JSON.stringify(functions, null, 2)}\n`);
  writeFileSync(META, `${JSON.stringify(meta, null, 2)}\n`);
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(ACQUISITION, `${JSON.stringify(acquisition, null, 2)}\n`);
  console.log(
    `${manifest.totals.works} works, ${manifest.totals.chapters} chapters, ${manifest.totals.passages} indexed passages ` +
      `written in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
  );
}
}

if (import.meta.main) await main();
