// Imports the complete Hebrew Tanakh and the public-domain JPS 1917
// translation from Sefaria. Run from the project root:
//
//   bun run scripts/dev/import-sefaria-tanakh.ts
//
// The importer refuses a response when the edition or licence is not the one
// recorded here. It writes work JSON plus data/imports/sefaria-tanakh.json so
// the corpus can be regenerated without relying on a browser session.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");
const FUNCTIONS = join(ROOT, "data", "corpus", "text-functions.json");
const MANIFEST = join(ROOT, "data", "imports", "sefaria-tanakh.json");

const HEBREW_VERSION = "hebrew|Miqra according to the Masorah";
const ENGLISH_VERSION = "english|The Holy Scriptures: A New Translation (JPS 1917)";

type Division = "Torah" | "Prophets" | "Writings";

const BOOKS: { title: string; slug: string; division: Division }[] = [
  { title: "Genesis", slug: "genesis", division: "Torah" },
  { title: "Exodus", slug: "exodus", division: "Torah" },
  { title: "Leviticus", slug: "leviticus", division: "Torah" },
  { title: "Numbers", slug: "numbers", division: "Torah" },
  { title: "Deuteronomy", slug: "deuteronomy", division: "Torah" },
  { title: "Joshua", slug: "joshua", division: "Prophets" },
  { title: "Judges", slug: "judges", division: "Prophets" },
  { title: "I Samuel", slug: "i-samuel", division: "Prophets" },
  { title: "II Samuel", slug: "ii-samuel", division: "Prophets" },
  { title: "I Kings", slug: "i-kings", division: "Prophets" },
  { title: "II Kings", slug: "ii-kings", division: "Prophets" },
  { title: "Isaiah", slug: "isaiah", division: "Prophets" },
  { title: "Jeremiah", slug: "jeremiah", division: "Prophets" },
  { title: "Ezekiel", slug: "ezekiel", division: "Prophets" },
  { title: "Hosea", slug: "hosea", division: "Prophets" },
  { title: "Joel", slug: "joel", division: "Prophets" },
  { title: "Amos", slug: "amos", division: "Prophets" },
  { title: "Obadiah", slug: "obadiah", division: "Prophets" },
  { title: "Jonah", slug: "jonah", division: "Prophets" },
  { title: "Micah", slug: "micah", division: "Prophets" },
  { title: "Nahum", slug: "nahum", division: "Prophets" },
  { title: "Habakkuk", slug: "habakkuk", division: "Prophets" },
  { title: "Zephaniah", slug: "zephaniah", division: "Prophets" },
  { title: "Haggai", slug: "haggai", division: "Prophets" },
  { title: "Zechariah", slug: "zechariah", division: "Prophets" },
  { title: "Malachi", slug: "malachi", division: "Prophets" },
  { title: "Psalms", slug: "psalms", division: "Writings" },
  { title: "Proverbs", slug: "proverbs", division: "Writings" },
  { title: "Job", slug: "job", division: "Writings" },
  { title: "Song of Songs", slug: "song-of-songs", division: "Writings" },
  { title: "Ruth", slug: "ruth", division: "Writings" },
  { title: "Lamentations", slug: "lamentations", division: "Writings" },
  { title: "Ecclesiastes", slug: "ecclesiastes", division: "Writings" },
  { title: "Esther", slug: "esther", division: "Writings" },
  { title: "Daniel", slug: "daniel", division: "Writings" },
  { title: "Ezra", slug: "ezra", division: "Writings" },
  { title: "Nehemiah", slug: "nehemiah", division: "Writings" },
  { title: "I Chronicles", slug: "i-chronicles", division: "Writings" },
  { title: "II Chronicles", slug: "ii-chronicles", division: "Writings" },
];

const DIVISION_LABEL: Record<Division, string> = {
  Torah: "Torah",
  Prophets: "Prophets (Nevi'im)",
  Writings: "Writings (Ketuvim)",
};

function decode(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&#8203;/g, "")
    .replace(/&#8206;/g, "")
    .replace(/&#8207;/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&thinsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/\s+/g, " ")
    .trim();
}

function parseText(raw: unknown): string[][] {
  if (typeof raw === "string") return [[decode(raw)]];
  if (!Array.isArray(raw)) return [];
  if (raw.every((x) => typeof x === "string")) return [raw.map((x) => decode(String(x)))];
  return raw.map((chapter) => {
    if (typeof chapter === "string") return [decode(chapter)];
    if (Array.isArray(chapter)) {
      if (chapter.every((x) => typeof x === "string")) return chapter.map((x) => decode(String(x)));
      return chapter.map((x) => (Array.isArray(x) ? x.map(String).join(" ") : String(x ?? ""))).map(decode);
    }
    return [String(chapter ?? "")].map(decode);
  });
}

async function fetchBook(title: string, version: string) {
  const url = new URL(`https://www.sefaria.org/api/v3/texts/${encodeURIComponent(title)}`);
  url.searchParams.set("version", version);
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (res.status === 429) {
        await Bun.sleep(1500 * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`${title}: HTTP ${res.status}`);
      const data = (await res.json()) as any;
      const edition = data.versions?.[0];
      if (!edition) throw new Error(`${title}: no version returned for ${version}`);
      return {
        title: String(edition.versionTitle ?? ""),
        language: String(edition.language ?? ""),
        license: String(edition.license ?? ""),
        versionSource: String(edition.versionSource ?? ""),
        text: parseText(edition.text),
      };
    } catch (err) {
      if (attempt === 4) throw err;
      await Bun.sleep(700 * attempt);
    }
  }
  throw new Error(`${title}: fetch failed`);
}

function hash(input: string): string {
  return new Bun.CryptoHasher("sha256").update(input).digest("hex");
}

function existingWork(slug: string): any | null {
  const path = join(WORKS, `${slug}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function buildWork(book: (typeof BOOKS)[number], meta: any, he: any, en: any) {
  const heTexts: Record<string, string> = {};
  const enTexts: Record<string, string> = {};
  const chapters: { ref: string; label: string }[] = [];
  const passages: { reference: string; label: string; chapterRef: string }[] = [];
  const chapterCount = Math.max(he.text.length, en.text.length);

  for (let c = 0; c < chapterCount; c++) {
    const chapterRef = String(c + 1);
    const verseCount = Math.max(he.text[c]?.length ?? 0, en.text[c]?.length ?? 0);
    if (!verseCount) continue;
    chapters.push({
      ref: chapterRef,
      label: book.slug === "psalms" ? `Psalm ${chapterRef}` : `Chapter ${chapterRef}`,
    });
    for (let v = 0; v < verseCount; v++) {
      const reference = `${chapterRef}.${v + 1}`;
      passages.push({ reference, label: `${chapterRef}:${v + 1}`, chapterRef });
      const heVerse = he.text[c]?.[v];
      const enVerse = en.text[c]?.[v];
      if (heVerse) heTexts[reference] = heVerse;
      if (enVerse) enTexts[reference] = enVerse;
    }
  }

  const previous = existingWork(book.slug);
  const description =
    previous?.description ??
    `${meta.enShortDesc ?? ""} The complete Hebrew text and JPS 1917 translation are included in this imported edition.`.trim();
  const dateRange =
    book.division === "Torah" ? [-1000, -400] :
    book.division === "Prophets" ? [-800, -400] :
    [-1000, -100];

  const work = {
    ...(previous ?? {}),
    slug: book.slug,
    title: book.title,
    originalTitle: previous?.originalTitle ?? meta.heTitle ?? "",
    transliteration: previous?.transliteration ?? "",
    altTitles: previous?.altTitles ?? [],
    tradition: "judaism",
    school: "rabbinic-judaism",
    genre: book.division,
    textType: DIVISION_LABEL[book.division],
    category: "Tanakh",
    subcategory: DIVISION_LABEL[book.division],
    originalLanguage: "he",
    dateStart: previous?.dateStart ?? dateRange[0],
    dateEnd: previous?.dateEnd ?? dateRange[1],
    dateDisplay: previous?.dateDisplay ?? "Composite; dates debated",
    authorshipStatus: previous?.authorshipStatus ?? "composite",
    author: previous?.author,
    attributionNote:
      previous?.attributionNote ??
      "Traditional attributions are recorded as tradition, not as settled modern authorship. The book is a composite edited text.",
    description,
    historicalContext:
      previous?.historicalContext ??
      `Part of the ${book.division} division of the Tanakh. Its composition, editing and dating are debated; the catalogue records the text without claiming a single uncontested origin.`,
    featured: previous?.featured ?? 0,
    featuredNote: previous?.featuredNote ?? "",
    refScheme: "chapter.verse",
    isSample: false,
    chapters,
    passages,
    editions: [
      {
        slug: `${book.slug}-hebrew-mam`,
        language: "he",
        editionType: "original",
        title: "Miqra according to the Masorah",
        translator: "",
        publisher: "Digital edition based on the Aleppo Codex tradition",
        publicationYear: null,
        source: "sefaria",
        license: "cc-by-sa",
        rightsStatus: "CC BY-SA (as reported by Sefaria)",
        attributionText:
          "Miqra according to the Masorah (MAM), Hebrew Bible text, CC BY-SA, accessed via Sefaria. Vocalisation and accents are reproduced as supplied by the edition.",
        structureScheme: "chapter and verse",
        notes: "Complete book. The text is displayed verbatim, including niqqud and cantillation.",
        isSample: false,
        texts: heTexts,
      },
      {
        slug: `${book.slug}-en-jps1917`,
        language: "en",
        editionType: "translation",
        title: "The Holy Scriptures: A New Translation (JPS 1917)",
        translator: "Jewish Publication Society of America",
        publisher: "Jewish Publication Society of America",
        publicationYear: 1917,
        source: "sefaria",
        license: "public-domain",
        rightsStatus: "Public domain",
        attributionText:
          "The Holy Scriptures: A New Translation (JPS 1917), Jewish Publication Society of America. Public domain. Accessed via Sefaria.",
        structureScheme: "chapter and verse",
        notes: "Complete book. Public-domain translation; verse numbering follows the supplied edition.",
        isSample: false,
        texts: enTexts,
      },
    ],
    _importStats: {
      hebrewVerses: Object.keys(heTexts).length,
      englishVerses: Object.keys(enTexts).length,
      chapters: chapters.length,
    },
  };
  return work;
}

const indexRes = await fetch("https://www.sefaria.org/api/index/", { headers: { accept: "application/json" } });
if (!indexRes.ok) throw new Error(`Sefaria index returned ${indexRes.status}`);
const index = (await indexRes.json()) as any[];
const tanakh = index.find((x) => x.category === "Tanakh");
const metaByTitle = new Map<string, any>();
function walk(node: any) {
  if (node.title && node.categories?.length === 2 && node.categories[0] === "Tanakh") {
    metaByTitle.set(node.title, node);
  }
  for (const child of node.contents ?? []) walk(child);
}
walk(tanakh);

const manifest: any = {
  source: "sefaria",
  source_url: "https://www.sefaria.org/",
  fetched_at: new Date().toISOString(),
  versions: {
    hebrew: { title: "Miqra according to the Masorah", licence: "CC-BY-SA" },
    english: { title: "The Holy Scriptures: A New Translation (JPS 1917)", licence: "Public Domain" },
  },
  books: [],
};
const functions = JSON.parse(readFileSync(FUNCTIONS, "utf8"));
const addedFunctions: string[] = [];

for (const book of BOOKS) {
  const meta = metaByTitle.get(book.title) ?? {};
  const [he, en] = await Promise.all([
    fetchBook(book.title, HEBREW_VERSION),
    fetchBook(book.title, ENGLISH_VERSION),
  ]);
  if (he.license !== "CC-BY-SA") throw new Error(`${book.title}: expected CC-BY-SA, got ${he.license}`);
  if (en.license !== "Public Domain") throw new Error(`${book.title}: expected Public Domain, got ${en.license}`);
  if (!he.text.length || !en.text.length) throw new Error(`${book.title}: empty text`);

  const work = buildWork(book, meta, he, en);
  const { _importStats, ...stored } = work;
  const serialized = JSON.stringify(stored, null, 2) + "\n";
  writeFileSync(join(WORKS, `${book.slug}.json`), serialized);
  manifest.books.push({
    title: book.title,
    slug: book.slug,
    division: book.division,
    chapters: _importStats.chapters,
    hebrewVerses: _importStats.hebrewVerses,
    englishVerses: _importStats.englishVerses,
    sha256: hash(serialized),
    hebrew_licence: he.license,
    english_licence: en.license,
  });

  if (!functions.works[book.slug]) {
    const debated = ["song-of-songs", "ecclesiastes", "esther", "daniel"].includes(book.slug);
    functions.works[book.slug] = {
      functions: ["canonical_scripture"],
      assignedBy: "UWL editors (comparative taxonomy)",
      status: debated ? "disputed" : book.division === "Writings" ? "provisional" : "affirmed",
      note: debated
        ? `Canonical in the Jewish Tanakh, but its canonicity or status was debated in some communities. Christian canons may place it differently.`
        : `Canonical in the Jewish Tanakh (${book.division}). Christian canons may order or classify the book differently.`,
    };
    addedFunctions.push(book.slug);
  }
  console.log(`${book.slug}: ${_importStats.chapters} chapters, ${_importStats.hebrewVerses} Hebrew verses, ${_importStats.englishVerses} English verses`);
}

manifest.totals = {
  books: manifest.books.length,
  chapters: manifest.books.reduce((n: number, b: any) => n + b.chapters, 0),
  hebrewVerses: manifest.books.reduce((n: number, b: any) => n + b.hebrewVerses, 0),
  englishVerses: manifest.books.reduce((n: number, b: any) => n + b.englishVerses, 0),
};
functions.note = functions.note ?? "Textual-function classifications are editorial and multi-valued. They describe how a work functions in a tradition, not a ranking of value.";
writeFileSync(FUNCTIONS, JSON.stringify(functions, null, 2) + "\n");
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${manifest.books.length} books and ${addedFunctions.length} new classifications.`);
