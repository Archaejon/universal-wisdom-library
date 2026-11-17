// Adds the Islamic shelf beyond the Qur'an: hadith collections, Sufi texts,
// kalam, falsafa and jurisprudence.
//
// As with the Christian shelf, only the catalogue record, the chapter outline
// and the passage index are written here. The text stays with the project that
// hosts it and is requested when someone reads:
//
//   * Hadith API (fawazahmed0, served from jsDelivr) — one section of a
//     collection per request, Arabic beside the English translation.
//   * Wikisource — one page per poem or chapter of a public-domain
//     translation (Nicholson's Tarjumán al-Ashwáq, Homes's Alchemy of
//     Happiness).
//   * Project Gutenberg — a single plain-text edition, split at the chapter
//     headings it prints (al-Ghazali's Confessions, Ibn Sina's Compendium on
//     the Soul, the Averroes tracts).
//
//   bun run scripts/dev/import-islamic-sources.ts
//   bun run scripts/dev/import-islamic-sources.ts --only=hadith
//   bun run scripts/dev/import-islamic-sources.ts --only=bukhari
//   bun run scripts/dev/import-islamic-sources.ts --only=sufi
//   bun run scripts/dev/import-islamic-sources.ts --only=kalam
//   bun run scripts/dev/import-islamic-sources.ts --only=falsafa
//   bun run scripts/dev/import-islamic-sources.ts --only=catalogue
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractWikisourceSegments,
  plaintextLines,
  plaintextParagraphs,
  splitPlaintextChapters,
  stripMarkup,
  type PlaintextAnchor,
} from "../../server/stream";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");
const STREAMS = join(ROOT, "data", "registry", "streams.json");
const FUNCTIONS = join(ROOT, "data", "corpus", "text-functions.json");
const MANIFEST = join(ROOT, "data", "imports", "islamic-sources.json");
const RETRIEVED_AT = new Date().toISOString().slice(0, 10);

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.split("=")[1] ?? "";
const concurrency = Math.max(1, Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? 6));

const USER_AGENT = "UniversalWisdomLibrary/1.0 (local reading interface; import and streaming)";

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function getText(url: string, timeoutMs = 45_000): Promise<string> {
  let last: Error | null = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "text/html,application/json,text/plain", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 404) throw Object.assign(new Error(`${url} returned 404`), { status: 404 });
      if (res.status === 429) {
        // Wikimedia rate-limits by IP; back off far enough for the window to clear.
        last = new Error(`${url} returned 429`);
        await Bun.sleep(5_000 * attempt);
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
      if ((err as any).status === 404) break;
      if (attempt < 4) await Bun.sleep(400 * attempt);
    }
  }
  throw last ?? new Error(`${url} failed`);
}

async function getJson(url: string): Promise<any> {
  return JSON.parse(await getText(url, 90_000));
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

function clean(value: string): string {
  return stripMarkup(value).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Hadith collections (fawazahmed0/hadith-api)
// ---------------------------------------------------------------------------

type HadithSpec = {
  slug: string;
  book: string;
  title: string;
  originalTitle: string;
  transliteration: string;
  shortTitle: string;
  author: string;
  category: string;
  genre: string;
  textType: string;
  subcategory: string;
  dateStart: number;
  dateEnd: number;
  dateDisplay: string;
  description: string;
  historicalContext: string;
  translator: string;
  translationTitle: string;
  rightsNote: string;
  functions: string[];
};

const HADITH: HadithSpec[] = [
  {
    slug: "hadith-bukhari",
    book: "bukhari",
    title: "Sahih al-Bukhari",
    originalTitle: "صحيح البخاري",
    transliteration: "Ṣaḥīḥ al-Bukhārī",
    shortTitle: "al-Bukhari",
    author: "al-bukhari",
    category: "Hadith",
    genre: "Hadith",
    textType: "Hadith collection",
    subcategory: "The six canonical collections",
    dateStart: 846,
    dateEnd: 870,
    dateDisplay: "compiled 846–870 CE",
    description:
      "The most widely received collection of reports attributed to the Prophet Muhammad, arranged by legal and devotional topic from the first revelation to the unity of God. Al-Bukhari is said to have selected its reports from a far larger body of material, and the collection's arrangement is itself an argument about which reports are sound.",
    historicalContext:
      "Compiled in the ninth century, when the criticism of transmission chains (isnād) had become a discipline. Its authority differs between communities: Sunni Muslims place it beside Sahih Muslim as the most authentic collection after the Qur'an, while other schools do not treat it as canonical in the same sense.",
    translator: "Muhsin Khan",
    translationTitle: "Sahih al-Bukhari — Muhsin Khan",
    rightsNote:
      "The English translation is the one the API serves under Muhsin Khan's name. Its rights remain with the translator or his publisher; this library does not relicense it and streams the text from the host.",
    functions: ["canonical_scripture", "religious_law_practice"],
  },
  {
    slug: "hadith-muslim",
    book: "muslim",
    title: "Sahih Muslim",
    originalTitle: "صحيح مسلم",
    transliteration: "Ṣaḥīḥ Muslim",
    shortTitle: "Muslim",
    author: "muslim-ibn-al-hajjaj",
    category: "Hadith",
    genre: "Hadith",
    textType: "Hadith collection",
    subcategory: "The six canonical collections",
    dateStart: 850,
    dateEnd: 875,
    dateDisplay: "compiled c. 850–875 CE",
    description:
      "Muslim ibn al-Hajjaj's collection of sound reports, arranged by topic and with the variants of each report gathered together. Its introduction is one of the earliest surviving treatises on the criticism of transmitters.",
    historicalContext:
      "Compiled at Nishapur in the second half of the ninth century. With al-Bukhari's collection it forms the pair Sunni tradition regards as the most reliable after the Qur'an.",
    translator: "Abdul Hamid Siddiqui",
    translationTitle: "Sahih Muslim — Abdul Hamid Siddiqui",
    rightsNote:
      "The English translation is the one the API serves under Abdul Hamid Siddiqui's name. Its rights remain with the translator or his publisher; the text is streamed from the host, not relicensed.",
    functions: ["canonical_scripture", "religious_law_practice"],
  },
  {
    slug: "hadith-abu-dawud",
    book: "abudawud",
    title: "Sunan Abi Dawud",
    originalTitle: "سنن أبي داود",
    transliteration: "Sunan Abī Dāwūd",
    shortTitle: "Abu Dawud",
    author: "abu-dawud",
    category: "Hadith",
    genre: "Hadith",
    textType: "Hadith collection",
    subcategory: "The six canonical collections",
    dateStart: 860,
    dateEnd: 889,
    dateDisplay: "compiled c. 860–889 CE",
    description:
      "Abu Dawud al-Sijistani's collection of reports bearing on law and worship, selected for legal content rather than for the fullest possible coverage. It is the fourth of the six collections Sunni tradition counts as canonical.",
    historicalContext:
      "Compiled in Basra and Baghdad in the late ninth century. Abu Dawud says he gathered reports whose legal bearing was disputed as well as those that were agreed, which is why the collection includes material later critics graded weak.",
    translator: "Not stated by the host",
    translationTitle: "Sunan Abi Dawud (English text served by the Hadith API)",
    rightsNote:
      "The host does not identify the translator of this English text. Its rights are therefore unverified; the library streams the text with attribution to the host and does not relicense it.",
    functions: ["canonical_scripture", "religious_law_practice"],
  },
  {
    slug: "hadith-tirmidhi",
    book: "tirmidhi",
    title: "Jami' at-Tirmidhi",
    originalTitle: "جامع الترمذي",
    transliteration: "Jāmiʿ al-Tirmidhī",
    shortTitle: "al-Tirmidhi",
    author: "at-tirmidhi",
    category: "Hadith",
    genre: "Hadith",
    textType: "Hadith collection",
    subcategory: "The six canonical collections",
    dateStart: 864,
    dateEnd: 892,
    dateDisplay: "compiled c. 864–892 CE",
    description:
      "Al-Tirmidhi's collection is distinguished by its grading of each report — sound, good or weak — and by its notes on how the jurists of different schools used it. It is as much a work of criticism as a collection.",
    historicalContext:
      "Compiled in Termez, in present-day Uzbekistan, in the late ninth century. Its technical vocabulary for grading reports became standard in later hadith scholarship.",
    translator: "Not stated by the host",
    translationTitle: "Jami' at-Tirmidhi (English text served by the Hadith API)",
    rightsNote:
      "The host does not identify the translator. Rights are unverified; the text is streamed with attribution to the host and is not relicensed.",
    functions: ["canonical_scripture", "religious_law_practice"],
  },
  {
    slug: "hadith-nasai",
    book: "nasai",
    title: "Sunan al-Nasa'i",
    originalTitle: "سنن النسائي",
    transliteration: "Sunan al-Nasāʾī",
    shortTitle: "al-Nasa'i",
    author: "an-nasai",
    category: "Hadith",
    genre: "Hadith",
    textType: "Hadith collection",
    subcategory: "The six canonical collections",
    dateStart: 875,
    dateEnd: 915,
    dateDisplay: "compiled c. 875–915 CE",
    description:
      "Ahmad ibn Shu'ayb al-Nasa'i's collection, known for the severity of its criticism of transmitters and for the care with which it distinguishes the wording of otherwise similar reports.",
    historicalContext:
      "Compiled in Egypt and Damascus around the turn of the tenth century. The work survives in a recension arranged by topic; the transmission history of its editions is unusually complicated.",
    translator: "Not stated by the host",
    translationTitle: "Sunan al-Nasa'i (English text served by the Hadith API)",
    rightsNote:
      "The host does not identify the translator. Rights are unverified; the text is streamed with attribution to the host and is not relicensed.",
    functions: ["canonical_scripture", "religious_law_practice"],
  },
  {
    slug: "hadith-ibn-majah",
    book: "ibnmajah",
    title: "Sunan Ibn Majah",
    originalTitle: "سنن ابن ماجه",
    transliteration: "Sunan Ibn Mājah",
    shortTitle: "Ibn Majah",
    author: "ibn-majah",
    category: "Hadith",
    genre: "Hadith",
    textType: "Hadith collection",
    subcategory: "The six canonical collections",
    dateStart: 880,
    dateEnd: 887,
    dateDisplay: "compiled c. 880–887 CE",
    description:
      "Muhammad ibn Yazid Ibn Majah's collection, the last of the six to be included in the Sunni canon. It adds material on topics the earlier collections treat briefly, and later critics debated the soundness of part of it.",
    historicalContext:
      "Compiled at Qazvin in the late ninth century. Its place among the six was settled by later consensus rather than by the compiler's own claim.",
    translator: "Not stated by the host",
    translationTitle: "Sunan Ibn Majah (English text served by the Hadith API)",
    rightsNote:
      "The host does not identify the translator. Rights are unverified; the text is streamed with attribution to the host and is not relicensed.",
    functions: ["canonical_scripture", "religious_law_practice"],
  },
  {
    slug: "muwatta-malik",
    book: "malik",
    title: "Al-Muwatta",
    originalTitle: "الموطأ",
    transliteration: "al-Muwaṭṭaʾ",
    shortTitle: "Malik",
    author: "malik-ibn-anas",
    category: "Jurisprudence (Fiqh)",
    genre: "Jurisprudence",
    textType: "Legal compendium",
    subcategory: "Early legal compendia",
    dateStart: 750,
    dateEnd: 795,
    dateDisplay: "compiled c. 750–795 CE",
    description:
      "Malik ibn Anas's arrangement of the practice of Medina by legal topic: prayer, alms, fasting, pilgrimage, marriage, trade, inheritance and the penalties. It combines reports attributed to the Prophet with the practice of the city, and is the earliest surviving compendium of Islamic law.",
    historicalContext:
      "Compiled in Medina in the eighth century, before the classical legal schools had taken shape. It is the foundation of the Maliki school and is received as a hadith collection by others.",
    translator: "Not stated by the host",
    translationTitle: "Al-Muwatta (English text served by the Hadith API)",
    rightsNote:
      "The host does not identify the translator of this English text. Rights are unverified; the text is streamed with attribution to the host and is not relicensed.",
    functions: ["religious_law_practice", "historical_document"],
  },
];

async function buildHadith(spec: HadithSpec) {
  const edition = await getJson(`https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/eng-${spec.book}.min.json`);
  const sections: Record<string, string> = edition?.metadata?.sections ?? {};
  const byBook = new Map<number, any[]>();
  let total = 0;
  for (const hadith of edition?.hadiths ?? []) {
    const text = clean(String(hadith?.text ?? ""));
    if (!text) continue;
    const book = Number(hadith?.reference?.book ?? 0);
    if (!byBook.has(book)) byBook.set(book, []);
    byBook.get(book)!.push({ number: Number(hadith?.hadithnumber ?? 0), text });
    total++;
  }
  if (!byBook.size) throw new Error(`${spec.title}: the API returned no hadiths`);

  // Book 0 with no section name is not a section of the collection: the host
  // leaves those reports unassigned. They are kept, ordered last and labelled
  // as what they are, rather than being presented as an opening book.
  const unnamedZero = !(sections["0"] ?? "").trim();
  const books = [...byBook.keys()].sort((a, b) => (a === 0 && unnamedZero ? 1 : b === 0 && unnamedZero ? -1 : a - b));
  const chapters = books.map((book) => {
    const name = (sections[String(book)] ?? "").trim();
    if (!name && book === 0) return { ref: "0", label: "Reports the host leaves without a section" };
    return {
      ref: String(book),
      label: !name ? `Book ${book}` : book === 0 ? name : `Book ${book} — ${name}`,
    };
  });
  const passages = books.flatMap((book) =>
    (byBook.get(book) ?? []).map((hadith, i) => ({
      reference: `${book}.${i + 1}`,
      label: `${spec.shortTitle} ${hadith.number}`,
      chapterRef: String(book),
    })),
  );

  const arabicEdition = `${spec.slug}-ar`;
  const englishEdition = `${spec.slug}-en`;
  const work = {
    slug: spec.slug,
    title: spec.title,
    originalTitle: spec.originalTitle,
    transliteration: spec.transliteration,
    altTitles: [],
    tradition: "islam",
    school: "sunni-tradition",
    genre: spec.genre,
    textType: spec.textType,
    category: spec.category,
    subcategory: spec.subcategory,
    originalLanguage: "ar",
    dateStart: spec.dateStart,
    dateEnd: spec.dateEnd,
    dateDisplay: spec.dateDisplay,
    authorshipStatus: "established",
    author: spec.author,
    attributionNote:
      "The compiler selected, arranged and in places commented on the reports; the reports themselves are attributed within each text to their transmitters. The catalogue distinguishes the compiler's work from the material compiled.",
    description: spec.description,
    historicalContext: spec.historicalContext,
    availabilityNote: `Streamed section by section from the Hadith API at read time, Arabic beside the English translation. ${spec.rightsNote}`,
    featured: false,
    featuredNote: "",
    refScheme: "book.hadith",
    isSample: false,
    textStorage: "streamed",
    chapters,
    passages,
    editions: [
      {
        slug: arabicEdition,
        language: "ar",
        editionType: "original",
        title: "Arabic text (as served by the Hadith API)",
        translator: "",
        publisher: "Hadith API (fawazahmed0)",
        source: "hadith-api",
        license: "public-domain",
        rightsStatus: "Public domain (classical Arabic text)",
        attributionText: `The Arabic text of ${spec.title}, served by the Hadith API (fawazahmed0, via jsDelivr).`,
        structureScheme: "book, section, hadith",
        isSample: false,
        notes: "Arabic and English are separate editions with separate numbering; the reader pairs them section by section.",
      },
      {
        slug: englishEdition,
        language: "en",
        editionType: "translation",
        title: spec.translationTitle,
        translator: spec.translator,
        publisher: "Hadith API (fawazahmed0)",
        source: "hadith-api",
        license: "streamed-host-terms",
        rightsStatus: "Streamed from the host; translation rights are not held by this library",
        attributionText: `${spec.translationTitle}. Served by the Hadith API (fawazahmed0, via jsDelivr). ${spec.rightsNote}`,
        structureScheme: "book, section, hadith",
        isSample: false,
        notes: spec.rightsNote,
      },
    ],
  };

  writeFileSync(join(WORKS, `${spec.slug}.json`), `${JSON.stringify(work, null, 2)}\n`);
  streams.works[spec.slug] = {
    provider: "hadith",
    upstream: spec.book,
    mode: "numbered",
    licence: "public-domain",
    config: { book: spec.book, arabic: `ara-${spec.book}`, english: `eng-${spec.book}` },
    editions: [
      {
        slug: arabicEdition,
        language: "ar",
        languageName: "arabic",
        version: `ara-${spec.book}`,
        license: "public-domain",
        sourceUrl: `https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-${spec.book}`,
      },
      {
        slug: englishEdition,
        language: "en",
        languageName: "english",
        version: `eng-${spec.book}`,
        license: "streamed-host-terms",
        sourceUrl: `https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/eng-${spec.book}`,
      },
    ],
  };
  functions.works[spec.slug] = {
    functions: spec.functions,
    status: "provisional",
    assignedBy: "UWL editors (comparative taxonomy)",
    note: `${spec.title} — ${spec.category}. Arabic and English are streamed from the Hadith API; the English translation is not relicensed here.`,
  };
  recordWork({
    slug: spec.slug,
    host: "hadith-api",
    upstream: `eng-${spec.book}`,
    chapters: chapters.length,
    passages: passages.length,
    translator: spec.translator,
  });
  console.log(`  ${spec.title}: ${chapters.length} books, ${passages.length} hadiths (${total} indexed)`);
  return { chapters: chapters.length, passages: passages.length };
}

// ---------------------------------------------------------------------------
// Wikisource (public-domain translations, one page per chapter)
// ---------------------------------------------------------------------------

type WikisourceSpec = {
  slug: string;
  school?: string;
  title: string;
  originalTitle: string;
  transliteration: string;
  author: string;
  category: string;
  genre: string;
  textType: string;
  originalLanguage: string;
  dateStart: number;
  dateEnd: number;
  dateDisplay: string;
  authorshipStatus: "established" | "traditional" | "disputed" | "anonymous" | "composite";
  description: string;
  historicalContext: string;
  translator: string;
  translationTitle: string;
  translationYear: number;
  pages: { title: string; label: string }[];
  // Poetry set as one paragraph per poem with a <br> at every line break.
  splitBreaks?: boolean;
  functions: string[];
};

const TARJUMAN_PAGES = [
  { title: "The Tarjumán al-Ashwáq/Preface", label: "Preface" },
  { title: "The Tarjumán al-Ashwáq/Introduction", label: "Introduction" },
  ...Array.from({ length: 61 }, (_, i) => ({
    title: `The Tarjumán al-Ashwáq/Poem_${i + 1}`,
    label: `Poem ${i + 1}`,
  })),
];

const ALCHEMY_PAGES = [
  { title: "The Alchemy of Happiness (Homes)/Introductory_Notice", label: "Introductory Notice" },
  { title: "The Alchemy of Happiness (Homes)/On_Knowledge_of_the_Soul", label: "On Knowledge of the Soul" },
  { title: "The Alchemy of Happiness (Homes)/On_Knowledge_of_God", label: "On Knowledge of God" },
  { title: "The Alchemy of Happiness (Homes)/On_Knowledge_of_the_World", label: "On Knowledge of the World" },
  { title: "The Alchemy of Happiness (Homes)/On_Knowledge_of_the_Future_World", label: "On Knowledge of the Future World" },
  { title: "The Alchemy of Happiness (Homes)/On_the_Love_of_God", label: "On the Love of God" },
];

const MASNAVI_PAGES = [
  { title: "Masnavi I Ma'navi/Book I", label: "Book I" },
  { title: "Masnavi I Ma'navi/Book II", label: "Book II" },
  { title: "Masnavi I Ma'navi/Book III", label: "Book III" },
  { title: "Masnavi I Ma'navi/Book IV", label: "Book IV" },
  { title: "Masnavi I Ma'navi/Book V", label: "Book V" },
  { title: "Masnavi I Ma'navi/Book VI", label: "Book VI" },
];

const SHORT_CREED_PAGES = [{ title: "A Short Creed", label: "A Short Creed" }];

const WIKISOURCE: WikisourceSpec[] = [
  {
    slug: "rumi-masnavi",
    title: "Masnavi i Ma'navi",
    originalTitle: "مثنوی معنوی",
    transliteration: "Mathnawī-yi Maʿnawī",
    author: "rumi",
    category: "Sufism",
    genre: "Poetry",
    textType: "Mystical epic poem",
    originalLanguage: "fa",
    dateStart: 1258,
    dateEnd: 1273,
    dateDisplay: "c. 1258–1273 CE",
    authorshipStatus: "established",
    description:
      "Rumi's six-book poem of stories, dialogues and lyric passages, in which a tale about a king or a bird turns into an argument about the soul. Whinfield's English abridgement keeps the narrative sequence of all six books while shortening the discourses, so it is a reader's Masnavi rather than a literal rendering of every line.",
    historicalContext:
      "Composed in Konya over the last two decades of Rumi's life and dictated to his disciple Husam al-Din Chelebi. The poem became the central teaching text of the Mevlevi tradition and one of the most widely translated works of Persian literature. Whinfield's abridgement was first published in 1898.",
    translator: "E. H. Whinfield",
    translationTitle: "Masnavi i Ma'navi: The Spiritual Couplets of Maulána Jalálu-'d-Dín Muhammad Rúmí",
    translationYear: 1898,
    pages: MASNAVI_PAGES,
    splitBreaks: true,
    functions: ["mystical_contemplative"],
  },
  {
    slug: "al-ghazali-short-creed",
    title: "A Short Creed",
    originalTitle: "العقيدة",
    transliteration: "al-ʿAqīda",
    author: "al-ghazali",
    category: "Theology (Kalam)",
    genre: "Theology",
    textType: "Creed",
    originalLanguage: "ar",
    dateStart: 1095,
    dateEnd: 1111,
    dateDisplay: "late 11th–early 12th century CE",
    authorshipStatus: "established",
    description:
      "A compact statement of Ash'ari belief, setting out what a Muslim is to affirm about God, prophecy and the last things. Al-Ghazali wrote it as a summary for ordinary believers rather than as a scholastic treatise, which makes it the clearest short statement of the theology behind his longer works.",
    historicalContext:
      "Translated by Duncan Black Macdonald in 1903 as an appendix to his study of Muslim theology, jurisprudence and constitutional theory. The translation is public domain and is reproduced by Wikisource.",
    translator: "Duncan Black Macdonald",
    translationTitle: "A Short Creed, by al-Ghazzali",
    translationYear: 1903,
    pages: SHORT_CREED_PAGES,
    school: "kalam",
    functions: ["commentary_exegesis", "denominational_guidance"],
  },
  {
    slug: "ibn-arabi-tarjuman-al-ashwaq",
    title: "The Tarjumán al-Ashwáq",
    originalTitle: "ترجمان الأشواق",
    transliteration: "Tarjumān al-Ashwāq",
    author: "ibn-arabi",
    category: "Sufism",
    genre: "Poetry",
    textType: "Mystical odes with commentary",
    originalLanguage: "ar",
    dateStart: 1214,
    dateEnd: 1215,
    dateDisplay: "1214–1215 CE",
    authorshipStatus: "established",
    description:
      "Sixty-one love poems written in Mecca, published with Ibn Arabi's own commentary, which reads the beloved, the desert and the pilgrimage as figures of the divine. The double reading is the work's argument: the same poem is erotic and metaphysical, and the commentary says which is meant.",
    historicalContext:
      "Written while Ibn Arabi was in Mecca on pilgrimage. Nicholson's 1911 edition presented the Arabic poems with an English translation and the author's commentary, and remains the standard English access to the work.",
    translator: "Reynold A. Nicholson",
    translationTitle: "The Tarjumán al-Ashwáq: A Collection of Mystical Odes",
    translationYear: 1911,
    pages: TARJUMAN_PAGES,
    functions: ["mystical_contemplative", "commentary_exegesis"],
  },
  {
    slug: "al-ghazali-alchemy-of-happiness",
    title: "The Alchemy of Happiness",
    originalTitle: "كيمياء السعادة",
    transliteration: "Kīmiyāʾ al-Saʿāda",
    author: "al-ghazali",
    category: "Sufism",
    genre: "Ethics and mysticism",
    textType: "Devotional treatise",
    originalLanguage: "fa",
    dateStart: 1105,
    dateEnd: 1105,
    dateDisplay: "c. 1105 CE",
    authorshipStatus: "established",
    description:
      "A short Persian companion to al-Ghazali's Revival of the Religious Sciences, treating the soul, the knowledge of God, the world, the world to come and the love of God. It is written for a reader who wants the argument of the Revival without its length.",
    historicalContext:
      "Written late in al-Ghazali's life, after he had left his teaching post in Baghdad. The English translation is Henry Homes's 1873 version, made from a Turkish rendering rather than directly from the Persian.",
    translator: "Henry A. Homes",
    translationTitle: "The Alchemy of Happiness",
    translationYear: 1873,
    pages: ALCHEMY_PAGES,
    functions: ["mystical_contemplative", "ethical_humanist_manifesto"],
  },
];

async function buildWikisource(spec: WikisourceSpec) {
  // Wikisource throttles parallel API use; two at a time with a pause is
  // slower than the other hosts but does not get the importer blocked. A page
  // that still fails is retried before giving up: dropping it would shift
  // every later chapter number, which is worse than a slow import.
  const fetched = await pool(spec.pages, Math.min(2, concurrency), async (page) => {
    const url = `https://en.wikisource.org/wiki/${encodeURIComponent(page.title.replaceAll(" ", "_"))}`;
    let last: Error | null = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      await Bun.sleep(500 * attempt);
      try {
        const raw = await getText(
          `https://en.wikisource.org/w/api.php?action=parse&page=${encodeURIComponent(page.title)}&prop=text&format=json&formatversion=2`,
        );
        const html = String(JSON.parse(raw)?.parse?.text ?? "");
        const segments = extractWikisourceSegments(html, { splitBreaks: spec.splitBreaks });
        if (segments.length) return { ...page, url, segments };
        last = new Error("the page returned no text");
      } catch (err) {
        last = err as Error;
      }
      await Bun.sleep(6_000 * attempt);
    }
    console.warn(`  ! ${page.title}: ${last?.message ?? "failed"}`);
    return { ...page, url, segments: [] as string[] };
  });
  const usable = fetched.filter((page) => page.segments.length > 0);
  if (usable.length !== spec.pages.length) {
    const missing = fetched.filter((page) => !page.segments.length).map((page) => page.label);
    throw new Error(`${spec.title}: ${missing.length} page(s) did not return text (${missing.slice(0, 6).join(", ")})`);
  }

  const chapters = usable.map((page, index) => ({ ref: String(index + 1), label: page.label }));
  const passages = usable.flatMap((page, index) =>
    page.segments.map((_, i) => ({
      reference: `${index + 1}.${i + 1}`,
      label: `${page.label} §${i + 1}`,
      chapterRef: String(index + 1),
    })),
  );

  const editionSlug = `${spec.slug}-en`;
  const work = {
    slug: spec.slug,
    title: spec.title,
    originalTitle: spec.originalTitle,
    transliteration: spec.transliteration,
    altTitles: [],
    tradition: "islam",
    school: spec.school ?? "sufi-tradition",
    genre: spec.genre,
    textType: spec.textType,
    category: spec.category,
    subcategory: "",
    originalLanguage: spec.originalLanguage,
    dateStart: spec.dateStart,
    dateEnd: spec.dateEnd,
    dateDisplay: spec.dateDisplay,
    authorshipStatus: spec.authorshipStatus,
    author: spec.author,
    attributionNote: "The attribution is the one the edition and the scholarly consensus give; the catalogue does not adjudicate disputed cases.",
    description: spec.description,
    historicalContext: spec.historicalContext,
    availabilityNote: `Streamed from Wikisource page by page at read time. The ${spec.translationYear} translation by ${spec.translator} is public domain; the page text is served by Wikisource under its own terms.`,
    featured: false,
    featuredNote: "",
    refScheme: "chapter.paragraph",
    isSample: false,
    textStorage: "streamed",
    chapters,
    passages,
    editions: [
      {
        slug: editionSlug,
        language: "en",
        editionType: "translation",
        title: spec.translationTitle,
        translator: spec.translator,
        publisher: "Wikisource",
        publicationYear: spec.translationYear,
        source: "wikisource",
        license: "public-domain",
        rightsStatus: "Public-domain translation",
        attributionText: `${spec.translationTitle}, translated by ${spec.translator} (${spec.translationYear}). Public domain. Digital text served by Wikisource.`,
        structureScheme: "one Wikisource page per chapter",
        isSample: false,
        notes: `Only the English translation is hosted; the ${spec.translationYear} translation is public domain and is streamed page by page from Wikisource.`,
      },
    ],
  };

  writeFileSync(join(WORKS, `${spec.slug}.json`), `${JSON.stringify(work, null, 2)}\n`);
  streams.works[spec.slug] = {
    provider: "wikisource",
    upstream: spec.title,
    mode: "numbered",
    licence: "public-domain",
    config: {
      pages: usable.map((page) => ({ title: page.title, url: page.url })),
      ...(spec.splitBreaks ? { splitBreaks: true } : {}),
    },
    editions: [
      {
        slug: editionSlug,
        language: "en",
        languageName: "english",
        version: spec.translationTitle,
        license: "public-domain",
        sourceUrl: `https://en.wikisource.org/wiki/${encodeURIComponent(spec.pages[0]!.title)}`,
      },
    ],
  };
  functions.works[spec.slug] = {
    functions: spec.functions,
    status: "provisional",
    assignedBy: "UWL editors (comparative taxonomy)",
    note: `${spec.title} — ${spec.category}. Public-domain English translation streamed from Wikisource.`,
  };
  recordWork({
    slug: spec.slug,
    host: "wikisource",
    upstream: spec.title,
    chapters: chapters.length,
    passages: passages.length,
    translator: spec.translator,
  });
  console.log(`  ${spec.title}: ${chapters.length} chapters, ${passages.length} paragraphs`);
  return { chapters: chapters.length, passages: passages.length };
}

// ---------------------------------------------------------------------------
// Project Gutenberg (one plain-text edition, split at its chapter headings)
// ---------------------------------------------------------------------------

type GutenbergSpec = {
  slug: string;
  host?: "archive";
  item?: string;
  file?: string;
  school?: string;
  title: string;
  originalTitle: string;
  transliteration: string;
  author: string;
  category: string;
  genre: string;
  textType: string;
  originalLanguage: string;
  dateStart: number;
  dateEnd: number;
  dateDisplay: string;
  authorshipStatus: "established" | "traditional" | "disputed" | "anonymous" | "composite";
  description: string;
  historicalContext: string;
  translator: string;
  translationTitle: string;
  translationYear: number;
  textUrl: string;
  sourceUrl: string;
  anchors: (PlaintextAnchor & { label: string })[];
  // Verse editions keep one line per segment instead of one paragraph.
  poem?: boolean;
  // Appended publisher catalogues and notes stop before this line.
  endMarker?: string;
  functions: string[];
};

const GUTENBERG: GutenbergSpec[] = [
  {
    slug: "al-ghazali-confessions",
    title: "The Confessions of al-Ghazali",
    originalTitle: "المنقذ من الضلال",
    transliteration: "al-Munqidh min al-Ḍalāl",
    author: "al-ghazali",
    category: "Theology (Kalam)",
    genre: "Autobiography and theology",
    textType: "Intellectual autobiography",
    originalLanguage: "ar",
    dateStart: 1105,
    dateEnd: 1111,
    dateDisplay: "c. 1105–1111 CE",
    authorshipStatus: "established",
    description:
      "Al-Ghazali's account of how he lost confidence in the certainties he had been taught and how he recovered it: through scholastic theology, which he found insufficient; through philosophy, which he divided into mathematics, logic, natural science, metaphysics and politics; and finally through the Sufi claim to direct experience. It is a first-person map of the intellectual options of the eleventh century.",
    historicalContext:
      "Written late in life, after al-Ghazali had left his professorship in Baghdad and travelled to Damascus, Jerusalem and Mecca. The Latin translation circulated in medieval Europe as the Algazel of the philosophers.",
    translator: "Claud Field",
    translationTitle: "The Confessions of Al Ghazzali",
    translationYear: 1909,
    textUrl: "https://www.gutenberg.org/cache/epub/58977/pg58977.txt",
    sourceUrl: "https://www.gutenberg.org/ebooks/58977",
    anchors: [
      { ref: "1", marker: "INTRODUCTION", occurrence: "last", label: "Introduction" },
      { ref: "2", marker: "GHAZZALI’S SEARCH FOR TRUTH", label: "Ghazzali’s Search for Truth" },
      { ref: "3", marker: "THE SUBTERFUGES OF THE SOPHISTS", label: "The Subterfuges of the Sophists" },
      { ref: "4", marker: "THE DIFFERENT KINDS OF SEEKERS AFTER TRUTH", label: "The Different Kinds of Seekers after Truth" },
      { ref: "5", marker: "THE AIM OF SCHOLASTIC THEOLOGY AND ITS RESULTS", label: "The Aim of Scholastic Theology and Its Results" },
      {
        ref: "6",
        marker: "CONCERNING THE PHILOSOPHICAL SECTS AND THE STIGMA OF INFIDELITY WHICH",
        label: "Concerning the Philosophical Sects and the Stigma of Infidelity",
      },
      { ref: "7", marker: "DIVISIONS OF THE PHILOSOPHIC SCIENCES", label: "Divisions of the Philosophic Sciences" },
      { ref: "8", marker: "SUFISM", label: "Sufism" },
      {
        ref: "9",
        marker: "THE REALITY OF INSPIRATION: ITS IMPORTANCE FOR THE HUMAN RACE",
        label: "The Reality of Inspiration: Its Importance for the Human Race",
      },
    ],
    functions: ["mystical_contemplative", "historical_document"],
  },
  {
    slug: "ibn-sina-compendium-on-the-soul",
    title: "A Compendium on the Soul",
    originalTitle: "مقالة في النفس",
    transliteration: "Maqāla fī al-Nafs",
    author: "ibn-sina",
    category: "Philosophy (Falsafa)",
    genre: "Philosophy",
    textType: "Philosophical treatise",
    originalLanguage: "ar",
    dateStart: 1020,
    dateEnd: 1027,
    dateDisplay: "early 11th century CE",
    authorshipStatus: "established",
    description:
      "Ibn Sina's short treatise on the soul, in ten sections: the existence of the spiritual faculties, their division, the vegetative and animal powers, the five senses, the inward senses, and the argument that the soul is an immaterial substance. It is a compact route into the psychology that Avicenna's Latin readers inherited.",
    historicalContext:
      "Translated for the first time into English in 1906 from an Arabic manuscript, as part of the early twentieth-century recovery of Arabic philosophy in Europe.",
    translator: "Edward Abbott van Dyck",
    translationTitle: "A Compendium on the Soul",
    translationYear: 1906,
    textUrl: "https://www.gutenberg.org/cache/epub/58186/pg58186.txt",
    sourceUrl: "https://www.gutenberg.org/ebooks/58186",
    anchors: [
      { ref: "1", marker: "PREFACE", label: "Preface" },
      { ref: "2", marker: "INTRODUCTION", label: "Introduction" },
      { ref: "3", marker: "SECTION FIRST", label: "Section First: The Existence of the Spiritual Faculties" },
      { ref: "4", marker: "SECTION SECOND", label: "Section Second: The Division of the Spiritual Faculties" },
      { ref: "5", marker: "SECTION THIRD", label: "Section Third: The Faculties Have No Common Origin" },
      { ref: "6", marker: "SECTION FOURTH", label: "Section Fourth: The Vegetable Powers" },
      { ref: "7", marker: "SECTION FIFTH", label: "Section Fifth: The Animal Powers" },
      { ref: "8", marker: "SECTION SIXTH", label: "Section Sixth: The Five Senses" },
      { ref: "9", marker: "SECTION SEVENTH", label: "Section Seventh: The Inward Senses" },
      { ref: "10", marker: "SECTION EIGHTH", label: "Section Eighth: A Sketch of the Human Soul" },
      { ref: "11", marker: "SECTION NINTH", label: "Section Ninth: The Essentiality of the Soul" },
      { ref: "12", marker: "SECTION TENTH", label: "Section Tenth: A Mental Essence Distinct from the Body" },
    ],
    functions: ["philosophical_work"],
  },
  {
    slug: "averroes-philosophy-and-theology",
    title: "The Philosophy and Theology of Averroes",
    originalTitle: "فلسفة ابن رشد",
    transliteration: "Falsafat Ibn Rushd",
    author: "ibn-rushd",
    category: "Philosophy (Falsafa)",
    genre: "Philosophy and jurisprudence",
    textType: "Treatises",
    originalLanguage: "ar",
    dateStart: 1170,
    dateEnd: 1195,
    dateDisplay: "late 12th century CE",
    authorshipStatus: "established",
    description:
      "Three treatises by Ibn Rushd on the relation between religion and philosophy. The Decisive Discourse argues that the Law commands the study of creation and that demonstrative reasoning cannot contradict it; the Appendix takes up the problem of eternal knowledge; the Exposition of the Methods of Argument examines the doctrines of the faith and the damage done by rival interpretations.",
    historicalContext:
      "Written in Almohad Spain and Morocco in the late twelfth century, when the public role of philosophy was contested. The Arabic text of the Decisive Discourse was edited by D. H. Muller in 1859; this English translation was published at Baroda in 1921.",
    translator: "Mohammad Jamil-ur-Rehman",
    translationTitle: "The Philosophy and Theology of Averroes",
    translationYear: 1921,
    textUrl: "https://www.gutenberg.org/cache/epub/65708/pg65708.txt",
    sourceUrl: "https://www.gutenberg.org/ebooks/65708",
    anchors: [
      {
        ref: "1",
        marker: "RELATION BETWEEN RELIGION AND PHILOSOPHY.[1]",
        occurrence: "last",
        label: "A Decisive Discourse on the Relation between Religion and Philosophy",
      },
      {
        ref: "2",
        marker: "HIS DECISIVE DISCOURSE.",
        occurrence: "last",
        label: "Appendix on the Problem of Eternal Knowledge",
      },
      {
        ref: "3",
        marker: "MISLEADING INNOVATIONS IN INTERPRETATIONS.[25]",
        occurrence: "last",
        label: "An Exposition of the Methods of Argument concerning the Beliefs of the Faith",
      },
    ],
    functions: ["philosophical_work", "religious_law_practice"],
  },
  {
    slug: "al-hujwiri-kashf-al-mahjub",
    title: "The Kashf al-Mahjub",
    originalTitle: "كشف المحجوب",
    transliteration: "Kashf al-Maḥjūb",
    author: "al-hujwiri",
    category: "Sufism",
    genre: "Mysticism",
    textType: "Treatise",
    originalLanguage: "fa",
    dateStart: 1045,
    dateEnd: 1075,
    dateDisplay: "mid-11th century CE",
    authorshipStatus: "established",
    description:
      "The oldest surviving Persian treatise on Sufism, written for a questioner who asked what the Sufis mean by their doctrines and practices. Al-Hujwiri answers with the lives of the early teachers, the rules of poverty and companionship, and eleven 'veils' that set out the path from knowledge to audition.",
    historicalContext:
      "Written at Lahore in the eleventh century by a Sufi who had travelled through Persia, Iraq and Central Asia. Nicholson's 1911 translation, made for the Gibb Memorial Series, is still the standard English text and the source of most later citation.",
    translator: "Reynold A. Nicholson",
    translationTitle: "The Kashf al-Mahjúb: The Oldest Persian Treatise on Ṣúfiism",
    translationYear: 1911,
    textUrl: "https://www.gutenberg.org/cache/epub/64786/pg64786.txt",
    sourceUrl: "https://www.gutenberg.org/ebooks/64786",
    anchors: [
      { ref: "1", marker: "CHAPTER I.", label: "On the Affirmation of Knowledge" },
      { ref: "2", marker: "CHAPTER II.", label: "On Poverty" },
      { ref: "3", marker: "CHAPTER III.", label: "On Sufiism" },
      { ref: "4", marker: "CHAPTER IV.", label: "On the Wearing of Patched Frocks" },
      { ref: "5", marker: "CHAPTER V.", label: "On the Opinions held concerning Poverty and Purity" },
      { ref: "6", marker: "CHAPTER VI.", label: "On Blame" },
      { ref: "7", marker: "CHAPTER VII.", label: "The Imams who belonged to the Companions" },
      { ref: "8", marker: "CHAPTER VIII.", label: "The Imams who belonged to the House of the Prophet" },
      { ref: "9", marker: "CHAPTER IX.", label: "The People of the Veranda" },
      { ref: "10", marker: "CHAPTER X.", label: "The Imams who belonged to the Followers" },
      { ref: "11", marker: "CHAPTER XI.", label: "The Imams after the Followers down to the Author's Day" },
      { ref: "12", marker: "CHAPTER XII.", label: "The Principal Sufis of Recent Times" },
      { ref: "13", marker: "CHAPTER XIII.", label: "The Modern Sufis in Different Countries" },
      { ref: "14", marker: "CHAPTER XIV.", label: "The Doctrines held by the Different Sects of Sufis" },
      { ref: "15", marker: "CHAPTER XV.", label: "The First Veil: the Gnosis of God" },
      { ref: "16", marker: "CHAPTER XVI.", label: "The Second Veil: Unification" },
      { ref: "17", marker: "CHAPTER XVII.", label: "The Third Veil: Faith" },
      { ref: "18", marker: "CHAPTER XVIII.", label: "The Fourth Veil: Purification from Foulness" },
      { ref: "19", marker: "CHAPTER XIX.", label: "The Fifth Veil: Prayer" },
      { ref: "20", marker: "CHAPTER XX.", label: "The Sixth Veil: Alms" },
      { ref: "21", marker: "CHAPTER XXI.", label: "The Seventh Veil: Fasting" },
      { ref: "22", marker: "CHAPTER XXII.", label: "The Eighth Veil: Pilgrimage" },
      { ref: "23", marker: "CHAPTER XXIII.", label: "The Ninth Veil: Companionship and its Rules" },
      { ref: "24", marker: "CHAPTER XXIV.", label: "The Tenth Veil: the Sufi Vocabulary" },
      { ref: "25", marker: "CHAPTER XXV.", label: "The Eleventh Veil: Audition" },
    ],
    functions: ["mystical_contemplative"],
  },
  {
    slug: "saadi-gulistan",
    title: "The Gulistan",
    originalTitle: "گلستان",
    transliteration: "Gulistān",
    author: "saadi",
    category: "Sufism",
    genre: "Poetry and prose",
    textType: "Moral miscellany",
    originalLanguage: "fa",
    dateStart: 1258,
    dateEnd: 1258,
    dateDisplay: "1258 CE",
    authorshipStatus: "established",
    description:
      "Saadi's book of stories, aphorisms and poems in eight chapters, moving from the conduct of kings to the morals of dervishes, contentment, silence, love, old age, education and society. A story is usually followed by a verse that turns it into a judgement, and the two are meant to be read together.",
    historicalContext:
      "Written in Shiraz in 1258, after Saadi's travels through Iraq, Syria and Asia Minor. It became a school text in Persian-speaking lands and one of the first Persian works translated into European languages. Ross's English version, first published in 1823, is a selection rather than a complete rendering; the Gutenberg text also notes that some passages were omitted by its transcriber.",
    translator: "James Ross",
    translationTitle: "The Gulistan, or Rose Garden, of Sa'di",
    translationYear: 1823,
    textUrl: "https://www.gutenberg.org/cache/epub/13060/pg13060.txt",
    sourceUrl: "https://www.gutenberg.org/ebooks/13060",
    anchors: [
      { ref: "1", marker: "CHAPTER I", label: "Of the Customs of Kings" },
      { ref: "2", marker: "CHAPTER II", label: "Of the Morals of Dervishes" },
      { ref: "3", marker: "CHAPTER III", label: "On the Preciousness of Contentment" },
      { ref: "4", marker: "CHAPTER IV", label: "On the Benefit of Being Silent" },
      { ref: "5", marker: "CHAPTER V", label: "On Love and Youth" },
      { ref: "6", marker: "CHAPTER VI", label: "Of Imbecility and Old Age" },
      { ref: "7", marker: "CHAPTER VII", label: "Of the Impressions of Education" },
      { ref: "8", marker: "CHAPTER VIII", label: "Of the Duties of Society" },
    ],
    functions: ["mystical_contemplative", "ethical_humanist_manifesto"],
  },
  {
    slug: "hafiz-divan",
    title: "Poems from the Divan of Hafiz",
    originalTitle: "دیوان حافظ",
    transliteration: "Dīvān-i Ḥāfiẓ",
    author: "hafiz",
    category: "Sufism",
    genre: "Poetry",
    textType: "Lyric poems",
    originalLanguage: "fa",
    dateStart: 1350,
    dateEnd: 1390,
    dateDisplay: "14th century CE",
    authorshipStatus: "established",
    description:
      "Gertrude Bell's selection from Hafiz's Divan: ghazals of wine, the beloved, the tavern and the garden, in which the erotic and the mystical readings are held together rather than resolved. Bell's introduction reads the poems as the work of a man who kept the pleasure of the world and the hope of something beyond it in the same frame.",
    historicalContext:
      "Hafiz lived in Shiraz in the fourteenth century. Bell's translations were published in 1897 and were among the first English renderings by a woman of a major Persian poet; they are verse translations of selected ghazals, not the complete Divan.",
    translator: "Gertrude Lowthian Bell",
    translationTitle: "Poems from the Divan of Hafiz",
    translationYear: 1897,
    textUrl: "https://www.gutenberg.org/cache/epub/74883/pg74883.txt",
    sourceUrl: "https://www.gutenberg.org/ebooks/74883",
    anchors: [{ ref: "1", marker: "POEMS FROM THE", occurrence: "last", label: "Poems from the Divan" }],
    poem: true,
    functions: ["mystical_contemplative"],
  },
  {
    slug: "jami-salaman-and-absal",
    title: "Salaman and Absal",
    originalTitle: "سلامان و ابسال",
    transliteration: "Salāmān wa Absāl",
    author: "jami",
    category: "Sufism",
    genre: "Poetry",
    textType: "Allegorical poem",
    originalLanguage: "fa",
    dateStart: 1460,
    dateEnd: 1480,
    dateDisplay: "15th century CE",
    authorshipStatus: "established",
    description:
      "Jami's allegorical poem of the prince Salaman and his nurse Absal, whose love ends in separation and whose story is read as the soul's attachment to the world of sense. FitzGerald's English rendering, in the metre he had used for Omar Khayyam, compresses the narrative and makes the allegory explicit in its prologue and closing sections.",
    historicalContext:
      "Written by the last great classical Persian poet, who died in Herat in 1492. FitzGerald published his anonymous verse translation in 1856, twenty-three years before his Rubaiyat; the Gutenberg edition prints it with the Rubaiyat and FitzGerald's life.",
    translator: "Edward FitzGerald",
    translationTitle: "Salámán and Absál, rendered into English verse",
    translationYear: 1856,
    textUrl: "https://www.gutenberg.org/cache/epub/22535/pg22535.txt",
    sourceUrl: "https://www.gutenberg.org/ebooks/22535",
    anchors: [
      {
        ref: "1",
        marker: "SALÁMÁN AND ABSÁL",
        occurrence: "last",
        label: "Salaman and Absal",
      },
    ],
    poem: true,
    functions: ["mystical_contemplative"],
  },
  {
    slug: "al-ghazali-moral-teachings",
    title: "Some Religious and Moral Teachings of al-Ghazzali",
    originalTitle: "إحياء علوم الدين (مختارات)",
    transliteration: "Iḥyāʾ ʿUlūm al-Dīn (selections)",
    author: "al-ghazali",
    category: "Sufism",
    genre: "Ethics and mysticism",
    textType: "Selected treatises",
    originalLanguage: "ar",
    dateStart: 1095,
    dateEnd: 1111,
    dateDisplay: "c. 1095–1111 CE",
    authorshipStatus: "established",
    description:
      "Eight chapters drawn from al-Ghazali's Revival of the Religious Sciences, on the nature of man, freedom and responsibility, pride, friendship, love, the unity of God and joyful submission. They are the ethical core of the Revival presented for a general reader.",
    historicalContext:
      "Selected and translated by Syed Nawab Ali in 1921 for the Gaekwad Studies in Religion and Philosophy. The translation is a selection, not the complete Revival, and the Gutenberg edition preserves the translator's preface and his list of al-Ghazali's works.",
    translator: "Syed Nawab Ali",
    translationTitle: "Some Religious and Moral Teachings of Al-Ghazzali",
    translationYear: 1921,
    textUrl: "https://www.gutenberg.org/cache/epub/73140/pg73140.txt",
    sourceUrl: "https://www.gutenberg.org/ebooks/73140",
    anchors: [
      { ref: "1", marker: "THE NATURE OF MAN[12]", label: "The Nature of Man" },
      { ref: "2", marker: "HUMAN FREEDOM AND RESPONSIBILITY[18]", label: "Human Freedom and Responsibility" },
      { ref: "3", marker: "PRIDE AND VANITY[39]", label: "Pride and Vanity" },
      { ref: "4", marker: "FRIENDSHIP AND SINCERITY[49]", label: "Friendship and Sincerity" },
      { ref: "5", marker: "THE NATURE OF LOVE[58]", label: "The Nature of Love, and Man's Highest Happiness" },
      { ref: "6", marker: "THE UNITY OF GOD[73]", label: "The Unity of God" },
      { ref: "7", marker: "THE LOVE OF GOD AND ITS SIGNS[78]", label: "The Love of God and its Signs" },
      {
        ref: "8",
        marker: "“RIZA” OR JOYOUS SUBMISSION TO HIS WILL[98]",
        label: "Riza, or Joyous Submission to His Will",
      },
    ],
    functions: ["mystical_contemplative", "ethical_humanist_manifesto"],
  },
  {
    slug: "ibn-tufail-hayy-ibn-yaqzan",
    title: "The Awakening of the Soul",
    originalTitle: "حي بن يقظان",
    transliteration: "Ḥayy ibn Yaqẓān",
    author: "ibn-tufail",
    category: "Philosophy (Falsafa)",
    genre: "Philosophy",
    textType: "Philosophical novel",
    originalLanguage: "ar",
    dateStart: 1160,
    dateEnd: 1185,
    dateDisplay: "12th century CE",
    authorshipStatus: "established",
    description:
      "Ibn Tufail's story of a child raised alone on an island who, without language or teachers, reasons his way from the body to the soul and from the soul to the necessary being. It is a thought experiment about whether philosophy can be reached without revelation, and it ends with the philosopher returning to society and finding that its language cannot carry what he has seen.",
    historicalContext:
      "Written in Almohad Spain in the twelfth century, when Ibn Tufail was physician and courtier to the Almohad caliph. It was translated into Latin and English in the seventeenth century and influenced European discussions of natural religion; Brönnle's 1904 rendering is the version printed here.",
    translator: "Paul Brönnle",
    translationTitle: "The Awakening of the Soul",
    translationYear: 1904,
    textUrl: "https://www.gutenberg.org/cache/epub/34572/pg34572.txt",
    sourceUrl: "https://www.gutenberg.org/ebooks/34572",
    anchors: [
      {
        ref: "1",
        marker: "THE AWAKENING OF THE SOUL",
        occurrence: "last",
        label: "The Awakening of the Soul",
      },
    ],
    endMarker: "THE WISDOM OF THE EAST SERIES",
    functions: ["philosophical_work"],
  },
  {
    slug: "attar-bird-parliament",
    host: "archive",
    item: "BirdParliamentEnglishFareeduddinAttaarFitzgerald",
    file: "bird-parliament-english Fareeduddin Attar Fitzgerald_djvu.txt",
    title: "The Bird Parliament",
    originalTitle: "منطق الطیر",
    transliteration: "Manṭiq al-Ṭayr",
    author: "attar",
    category: "Sufism",
    genre: "Poetry",
    textType: "Allegorical poem",
    originalLanguage: "fa",
    dateStart: 1177,
    dateEnd: 1177,
    dateDisplay: "c. 1177 CE",
    authorshipStatus: "established",
    description:
      "The birds of the world gather to choose a king and set out under the hoopoe, Tajidar, to find the Simurgh beyond the mountain of Qaf. Each bird confesses the fault that holds it back, and the thirty who survive the journey discover that the Simurgh they sought is themselves. FitzGerald's abridged rendering keeps the frame and many of the tales in a verse that is closer to his Omar Khayyam than to a literal Persian edition.",
    historicalContext:
      "Attar's Conference of the Birds was composed in Nishapur in the twelfth century. FitzGerald worked on this abridgement in 1857; it was published posthumously in the Letters and Literary Remains of Edward FitzGerald (1889). The text used here is the proofed public-domain transcription made for sacred-texts.com in 2007.",
    translator: "Edward FitzGerald",
    translationTitle: "Bird Parliament",
    translationYear: 1889,
    textUrl: "https://ia800903.us.archive.org/22/items/BirdParliamentEnglishFareeduddinAttaarFitzgerald/bird-parliament-english%20Fareeduddin%20Attar%20Fitzgerald_djvu.txt",
    sourceUrl: "https://archive.org/details/BirdParliamentEnglishFareeduddinAttaarFitzgerald",
    anchors: [{ ref: "1", marker: "Bird Parliament", occurrence: "last", label: "The Bird Parliament" }],
    poem: true,
    functions: ["mystical_contemplative"],
  },
];

async function buildGutenberg(spec: GutenbergSpec) {
  const isArchive = spec.host === "archive";
  const raw = await getText(spec.textUrl, 60_000);
  const text = spec.endMarker ? raw.split(spec.endMarker)[0]! : raw;
  const split = splitPlaintextChapters(text, spec.anchors);
  const chapters: { ref: string; label: string }[] = [];
  const passages: { reference: string; label: string; chapterRef: string }[] = [];
  for (const anchor of spec.anchors) {
    const section = split.get(anchor.ref) ?? "";
    const paragraphs = spec.poem ? plaintextLines(section) : plaintextParagraphs(section);
    if (!paragraphs.length) {
      console.warn(`  ! ${spec.slug}: chapter ${anchor.ref} (${anchor.marker}) returned no paragraphs`);
      continue;
    }
    chapters.push({ ref: anchor.ref, label: anchor.label });
    for (const [i] of paragraphs.entries()) {
      passages.push({
        reference: `${anchor.ref}.${i + 1}`,
        label: `${anchor.label} §${i + 1}`,
        chapterRef: anchor.ref,
      });
    }
  }
  if (!chapters.length) throw new Error(`${spec.slug}: no chapter headings matched`);

  const editionSlug = `${spec.slug}-en`;
  const work = {
    slug: spec.slug,
    title: spec.title,
    originalTitle: spec.originalTitle,
    transliteration: spec.transliteration,
    altTitles: [],
    tradition: "islam",
    school:
      spec.school ??
      (spec.category === "Philosophy (Falsafa)"
        ? "falsafa"
        : spec.category === "Sufism"
          ? "sufi-tradition"
          : "kalam"),
    genre: spec.genre,
    textType: spec.textType,
    category: spec.category,
    subcategory: "",
    originalLanguage: spec.originalLanguage,
    dateStart: spec.dateStart,
    dateEnd: spec.dateEnd,
    dateDisplay: spec.dateDisplay,
    authorshipStatus: spec.authorshipStatus,
    author: spec.author,
    attributionNote: "The attribution is not disputed in the scholarship this catalogue follows.",
    description: spec.description,
    historicalContext: spec.historicalContext,
    availabilityNote: isArchive
      ? `Streamed from the Internet Archive at read time: the proofed plain-text derivative of the scan is fetched and split at the chapter headings it prints. The ${spec.translationYear} translation by ${spec.translator} is public domain in the United States.`
      : `Streamed from Project Gutenberg at read time: the whole plain-text edition is fetched and split at the chapter headings it prints. The ${spec.translationYear} translation by ${spec.translator} is public domain in the United States.`,
    featured: false,
    featuredNote: "",
    refScheme: "chapter.paragraph",
    isSample: false,
    textStorage: "streamed",
    chapters,
    passages,
    editions: [
      {
        slug: editionSlug,
        language: "en",
        editionType: "translation",
        title: spec.translationTitle,
        translator: spec.translator,
        publisher: isArchive ? "Internet Archive" : "Project Gutenberg",
        publicationYear: spec.translationYear,
        source: isArchive ? "internet-archive-pd" : "project-gutenberg",
        license: "public-domain",
        rightsStatus: isArchive
          ? "Public-domain text; the transcription asks for attribution and non-commercial reuse"
          : "Public domain in the United States",
        attributionText: isArchive
          ? `${spec.translationTitle}, translated by ${spec.translator} (${spec.translationYear}). Public domain in the United States. Digital text from the Internet Archive scan; transcription proofed by sacred-texts.com, whose notice asks for attribution and non-commercial reuse.`
          : `${spec.translationTitle}, translated by ${spec.translator} (${spec.translationYear}). Public domain in the United States. Digital text from Project Gutenberg.`,
        structureScheme: isArchive
          ? "one proofed plain-text derivative of a scanned edition, split at printed headings"
          : "single plain-text edition, split at printed chapter headings",
        isSample: false,
        notes: "The chapter split is performed on the edition as served; the reader is told when the served text no longer matches the indexed passages.",
      },
    ],
  };

  writeFileSync(join(WORKS, `${spec.slug}.json`), `${JSON.stringify(work, null, 2)}\n`);
  streams.works[spec.slug] = {
    provider: isArchive ? "archive" : "gutenberg",
    upstream: isArchive ? `Internet Archive ${spec.item}` : `Project Gutenberg #${spec.sourceUrl.split("/").pop()}`,
    mode: "numbered",
    licence: "public-domain",
    config: {
      textUrl: spec.textUrl,
      sourceUrl: spec.sourceUrl,
      anchors: spec.anchors.map((anchor) => ({
        ref: anchor.ref,
        marker: anchor.marker,
        occurrence: anchor.occurrence,
      })),
      ...(spec.poem ? { poem: true } : {}),
      ...(spec.endMarker ? { endMarker: spec.endMarker } : {}),
      ...(isArchive ? { item: spec.item, file: spec.file } : {}),
    },
    editions: [
      {
        slug: editionSlug,
        language: "en",
        languageName: "english",
        version: spec.translationTitle,
        license: "public-domain",
        sourceUrl: spec.sourceUrl,
      },
    ],
  };
  functions.works[spec.slug] = {
    functions: spec.functions,
    status: "provisional",
    assignedBy: "UWL editors (comparative taxonomy)",
    note: `${spec.title} — ${spec.category}. Public-domain English translation streamed from Project Gutenberg.`,
  };
  recordWork({
    slug: spec.slug,
    host: isArchive ? "internet-archive" : "project-gutenberg",
    upstream: spec.sourceUrl,
    chapters: chapters.length,
    passages: passages.length,
    translator: spec.translator,
  });
  console.log(`  ${spec.title}: ${chapters.length} chapters, ${passages.length} paragraphs`);
  return { chapters: chapters.length, passages: passages.length };
}

// ---------------------------------------------------------------------------
// Catalogue-only records
// ---------------------------------------------------------------------------

// Al-Risala, Kitab al-Umm and al-Mughni were catalogue-only while only English
// translations were considered. Their Arabic texts are now imported and
// streamed from OpenITI by import-openiti.ts, so there are no records left for
// this pass to downgrade. The array remains because the importer supports it.
const CATALOGUE_ONLY: any[] = [];

let streams: any;
let functions: any;
let manifest: any;

function buildCatalogueOnly() {
  for (const entry of CATALOGUE_ONLY) {
    const work = {
      slug: entry.slug,
      title: entry.title,
      originalTitle: entry.originalTitle,
      transliteration: entry.transliteration,
      altTitles: [],
      tradition: "islam",
      school: entry.school,
      genre: "Jurisprudence",
      textType: "Legal treatise",
      category: "Jurisprudence (Fiqh)",
      subcategory: "Classical manuals",
      originalLanguage: entry.originalLanguage,
      dateStart: entry.dateStart,
      dateEnd: entry.dateEnd,
      dateDisplay: entry.dateDisplay,
      authorshipStatus: "established",
      author: entry.author,
      attributionNote: "The attribution is the one the manuscript tradition and the scholarship give.",
      description: entry.description,
      historicalContext: "",
      availabilityNote: entry.availabilityNote,
      featured: false,
      featuredNote: "",
      refScheme: "chapter.paragraph",
      isSample: false,
      textStorage: "none",
      chapters: [],
      passages: [],
      editions: [],
    };
    writeFileSync(join(WORKS, `${entry.slug}.json`), `${JSON.stringify(work, null, 2)}\n`);
    functions.works[entry.slug] = {
      functions: ["religious_law_practice", "historical_document"],
      status: "provisional",
      assignedBy: "UWL editors (comparative taxonomy)",
      note: entry.availabilityNote,
    };
    delete streams.works[entry.slug];
    recordCatalogue({ slug: entry.slug, title: entry.title, note: entry.availabilityNote });
    console.log(`  ${entry.title}: catalogue record only`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

streams = JSON.parse(readFileSync(STREAMS, "utf8"));
functions = JSON.parse(readFileSync(FUNCTIONS, "utf8"));
const previousManifest = (() => {
  try {
    return JSON.parse(readFileSync(MANIFEST, "utf8"));
  } catch {
    return null;
  }
})();
manifest = {
  source: "islamic-sources",
  retrieved_at: RETRIEVED_AT,
  note:
    "Catalogue records, chapter outlines and passage indexes only. Hadith, Sufi, kalam and falsafa texts are streamed from their hosts at read time and are not stored in this corpus.",
  hosts: [
    { id: "hadith-api", name: "Hadith API (fawazahmed0)", url: "https://github.com/fawazahmed0/hadith-api", licence: "Unlicense for the repository; translations mixed" },
    { id: "wikisource", name: "Wikisource", url: "https://en.wikisource.org/", licence: "public-domain translations" },
    { id: "project-gutenberg", name: "Project Gutenberg", url: "https://www.gutenberg.org/", licence: "public-domain in the United States" },
    { id: "internet-archive", name: "Internet Archive", url: "https://archive.org/", licence: "public-domain editions; per-item status recorded" },
  ],
  works: (previousManifest?.works ?? []) as any[],
  // A work that has since been imported from OpenITI is no longer a
  // catalogue-only record, even if an older manifest still lists it.
  catalogueOnly: (previousManifest?.catalogueOnly ?? []).filter((w: any) => !streams.works[w.slug]) as any[],
  failures: [] as any[],
  totals: { works: 0, chapters: 0, passages: 0 },
};

function recordWork(entry: any) {
  const index = manifest.works.findIndex((w: any) => w.slug === entry.slug);
  if (index >= 0) manifest.works[index] = entry;
  else manifest.works.push(entry);
}

function recordCatalogue(entry: any) {
  const index = manifest.catalogueOnly.findIndex((w: any) => w.slug === entry.slug);
  if (index >= 0) manifest.catalogueOnly[index] = entry;
  else manifest.catalogueOnly.push(entry);
}

const started = Date.now();
if (!only || only === "hadith" || HADITH.some((h) => h.slug === only || h.book === only || h.slug === `hadith-${only}`)) {
  console.log("Hadith and legal collections");
  for (const spec of HADITH) {
    if (only && only !== "hadith" && only !== spec.slug && only !== spec.book) continue;
    try {
      await buildHadith(spec);
    } catch (err) {
      console.error(`  ! ${spec.slug}: ${(err as Error).message}`);
      manifest.failures.push({ slug: spec.slug, reason: (err as Error).message });
    }
  }
}
if (!only || only === "sufi" || WIKISOURCE.some((w) => w.slug === only)) {
  console.log("Sufi texts (Wikisource)");
  for (const spec of WIKISOURCE) {
    if (only && only !== "sufi" && only !== spec.slug) continue;
    try {
      await buildWikisource(spec);
    } catch (err) {
      console.error(`  ! ${spec.slug}: ${(err as Error).message}`);
      manifest.failures.push({ slug: spec.slug, reason: (err as Error).message });
    }
  }
}
if (!only || only === "kalam" || only === "falsafa" || only === "sufi" || GUTENBERG.some((w) => w.slug === only)) {
  console.log("Sufi, kalam and falsafa texts (Project Gutenberg)");
  for (const spec of GUTENBERG) {
    if (only && only !== "kalam" && only !== "falsafa" && only !== "sufi" && only !== spec.slug) continue;
    if (only === "kalam" && spec.category !== "Theology (Kalam)") continue;
    if (only === "falsafa" && spec.category !== "Philosophy (Falsafa)") continue;
    if (only === "sufi" && spec.category !== "Sufism") continue;
    try {
      await buildGutenberg(spec);
    } catch (err) {
      console.error(`  ! ${spec.slug}: ${(err as Error).message}`);
      manifest.failures.push({ slug: spec.slug, reason: (err as Error).message });
    }
  }
}
if (!only || only === "catalogue") {
  console.log("Jurisprudence catalogue records");
  buildCatalogueOnly();
}

manifest.totals.works = manifest.works.length;
manifest.totals.chapters = manifest.works.reduce((sum: number, w: any) => sum + w.chapters, 0);
manifest.totals.passages = manifest.works.reduce((sum: number, w: any) => sum + w.passages, 0);
streams.generatedAt = RETRIEVED_AT;

writeFileSync(STREAMS, `${JSON.stringify(streams, null, 2)}\n`);
writeFileSync(FUNCTIONS, `${JSON.stringify(functions, null, 2)}\n`);
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `${manifest.totals.works} works, ${manifest.totals.chapters} chapters, ${manifest.totals.passages} indexed passages ` +
    `written in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
);
