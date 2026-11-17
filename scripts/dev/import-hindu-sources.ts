// Adds the Hindu shelf: the complete Gita, the principal Upanishads that are
// transcribed in the Sacred Books of the East, the Yoga Sutras, the Brahma
// Sutras, the Sarva-Darsana-Samgraha and the Ramayana.
//
// As with the other streamed shelves, only the catalogue record, chapter
// outline and passage index are written here. The text stays with the project
// that hosts it and is requested when someone reads:
//
//   * Project Gutenberg — one public-domain plain-text edition, split at the
//     chapter headings it prints.
//   * Wikisource — one page per chapter of the 1879/1884 Max Müller
//     translations in the Sacred Books of the East.
//
//   bun run scripts/dev/import-hindu-sources.ts
//   bun run scripts/dev/import-hindu-sources.ts --only=gutenberg
//   bun run scripts/dev/import-hindu-sources.ts --only=upanishads
//   bun run scripts/dev/import-hindu-sources.ts --only=bhagavad-gita
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractWikisourceSegments,
  plaintextParagraphs,
  splitPlaintextChapters,
  type PlaintextAnchor,
} from "../../server/stream";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");
const STREAMS = join(ROOT, "data", "registry", "streams.json");
const FUNCTIONS = join(ROOT, "data", "corpus", "text-functions.json");
const MANIFEST = join(ROOT, "data", "imports", "hindu-sources.json");
const RETRIEVED_AT = new Date().toISOString().slice(0, 10);

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.split("=")[1] ?? "";
const concurrency = Math.max(1, Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? 3));

const USER_AGENT = "UniversalWisdomLibrary/1.0 (local reading interface; import and streaming)";

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function getText(url: string, timeoutMs = 60_000): Promise<string> {
  let last: Error | null = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "text/html,application/json,text/plain", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 404) throw Object.assign(new Error(`${url} returned 404`), { status: 404 });
      if (res.status === 429) {
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

// ---------------------------------------------------------------------------
// Project Gutenberg
// ---------------------------------------------------------------------------

type GutenbergSpec = {
  slug: string;
  title: string;
  originalTitle: string;
  transliteration: string;
  altTitles?: string[];
  author?: string;
  school: string;
  category: string;
  subcategory: string;
  genre: string;
  textType: string;
  originalLanguage: string;
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
  textUrl: string;
  sourceUrl: string;
  anchors: (PlaintextAnchor & { label: string })[];
  functions: string[];
  notice?: string;
};

const GITA_CHAPTERS: { label: string }[] = [
  { label: "The Distress of Arjuna" },
  { label: "The Book of Doctrines" },
  { label: "Virtue in Work" },
  { label: "The Religion of Knowledge" },
  { label: "The Book of Renunciation" },
  { label: "The Book of Religion by Self-Restraint" },
  { label: "The Book of Religion by Discernment" },
  { label: "The Book of Religion by Devotion to the One Supreme God" },
  { label: "The Book of Religion by the Kingly Knowledge and the Kingly Mystery" },
  { label: "The Book of Religion by the Heavenly Perfections" },
  { label: "The Book of the Manifesting of the One and Manifold" },
  { label: "The Book of the Religion of Faith" },
  { label: "The Book of Religion by Separation of Matter and Spirit" },
  { label: "The Book of Religion by Separation from the Qualities" },
  { label: "The Book of Religion by Attaining the Supreme" },
  { label: "The Book of the Separateness of the Divine and Undivine" },
  { label: "The Book of Religion by the Threefold Faith" },
  { label: "The Book of Religion by Deliverance and Renunciation" },
];

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII"];

const GUTENBERG: GutenbergSpec[] = [
  {
    slug: "bhagavad-gita",
    title: "Bhagavad Gita",
    originalTitle: "भगवद्गीता",
    transliteration: "Bhagavadgītā",
    altTitles: ["The Song of the Lord", "Gita"],
    author: "vyasa",
    school: "vaishnavism",
    category: "Scripture",
    subcategory: "Philosophical dialogue in verse",
    genre: "Scripture",
    textType: "Philosophical dialogue in verse",
    originalLanguage: "sa",
    dateStart: -200,
    dateEnd: 200,
    dateDisplay: "c. 2nd century BCE–2nd century CE",
    authorshipStatus: "composite",
    attributionNote:
      "Traditionally attributed to Vyasa and embedded in the Mahabharata. Modern scholarship treats the Gita as a composite philosophical poem shaped within the epic tradition.",
    description:
      "Set on the eve of battle, the Gita records Krishna's instruction to Arjuna on duty, action, knowledge and devotion. The complete eighteen chapters are read here in Edwin Arnold's 1885 verse translation, from the opening distress of Arjuna to the final account of renunciation.",
    historicalContext:
      "The Gita synthesises strands of Brahmanical, Samkhya, Yoga and devotional thought. It has been interpreted by competing schools and has become one of the most widely translated Hindu texts. Arnold's The Song Celestial was one of the first English verse translations to reach a general readership.",
    translator: "Edwin Arnold",
    translationTitle: "The Song Celestial; or, Bhagavad-Gîtâ",
    translationYear: 1885,
    textUrl: "https://www.gutenberg.org/cache/epub/2388/pg2388.txt",
    sourceUrl: "https://www.gutenberg.org/ebooks/2388",
    anchors: GITA_CHAPTERS.map((chapter, index) => ({
      ref: String(index + 1),
      marker: `CHAPTER ${ROMAN[index]}`,
      label: `Chapter ${index + 1} — ${chapter.label}`,
    })),
    functions: ["canonical_scripture", "philosophical_work"],
  },
  {
    slug: "patanjali-yoga-sutras",
    title: "The Yoga Sutras of Patanjali",
    originalTitle: "योगसूत्र",
    transliteration: "Yogasūtra",
    author: "patanjali",
    school: "yoga",
    category: "Philosophy",
    subcategory: "Yoga",
    genre: "Philosophy",
    textType: "Aphorisms with commentary",
    originalLanguage: "sa",
    dateStart: -200,
    dateEnd: 400,
    dateDisplay: "c. 2nd century BCE–4th century CE",
    authorshipStatus: "composite",
    attributionNote:
      "Traditionally ascribed to Patanjali. The text was probably compiled from earlier material over several centuries, and its classical commentary is later than the sutras themselves.",
    description:
      "The four books of the Yoga Sutras set out the discipline of stilling the mind: the modifications of consciousness, the obstacles to practice, the powers that follow concentration, and the isolation of the seer from what is seen. Charles Johnston's 1912 edition prints each sutra with an interpretive commentary.",
    historicalContext:
      "The foundational text of the Yoga school, composed in Sanskrit and transmitted with a commentary attributed to Vyasa. Johnston's edition was written for general readers and presents the sutras as a sequence of spiritual aphorisms rather than as a philological edition.",
    translator: "Charles Johnston",
    translationTitle: "The Yoga Sutras of Patanjali: The Book of the Spiritual Man",
    translationYear: 1912,
    textUrl: "https://www.gutenberg.org/cache/epub/2526/pg2526.txt",
    sourceUrl: "https://www.gutenberg.org/ebooks/2526",
    anchors: [
      { ref: "1", marker: "BOOK I", occurrence: "last", label: "Book I — Samadhi Pada" },
      { ref: "2", marker: "BOOK II", occurrence: "last", label: "Book II — Sadhana Pada" },
      { ref: "3", marker: "BOOK III", occurrence: "last", label: "Book III — Vibhuti Pada" },
      { ref: "4", marker: "BOOK IV", occurrence: "last", label: "Book IV — Kaivalya Pada" },
    ],
    functions: ["philosophical_work"],
  },
  {
    slug: "madhava-sarva-darsana-samgraha",
    title: "Sarva-Darsana-Samgraha",
    originalTitle: "सर्वदर्शनसंग्रह",
    transliteration: "Sarva-Darśana-Saṃgraha",
    author: "madhava",
    school: "vedanta",
    category: "Philosophy",
    subcategory: "Survey of schools",
    genre: "Philosophy",
    textType: "Survey of philosophical systems",
    originalLanguage: "sa",
    dateStart: 1300,
    dateEnd: 1380,
    dateDisplay: "14th century CE",
    authorshipStatus: "established",
    attributionNote:
      "Attributed to Madhava Acharya, usually identified with the Advaita author and statesman Madhavacharya. The attribution is traditional rather than documentary.",
    description:
      "A survey of the Indian philosophical schools in fifteen chapters, from the materialist Charvaka through the Buddhist and Jain systems to the six Brahmanical schools and finally Vedanta. Each system is presented through its own arguments before the author answers them from an Advaita position, which makes the work a history of philosophy and a polemic at once.",
    historicalContext:
      "Written in fourteenth-century Vijayanagara. Cowell and Gough's 1882 translation was the first complete English rendering and remains the standard one; it arranges the chapters in the order of the printed Sanskrit editions.",
    translator: "E. B. Cowell and A. E. Gough",
    translationTitle: "Sarva-Darsana-Samgraha, or Review of the Different Systems of Hindu Philosophy",
    translationYear: 1882,
    textUrl: "https://www.gutenberg.org/cache/epub/34125/pg34125.txt",
    sourceUrl: "https://www.gutenberg.org/ebooks/34125",
    anchors: [
      { ref: "1", marker: "CHAPTER I.", label: "The Charvaka System" },
      { ref: "2", marker: "CHAPTER II.", label: "The Bauddha System" },
      { ref: "3", marker: "CHAPTER III.", label: "The Jaina System" },
      { ref: "4", marker: "CHAPTER IV.", label: "The Ramanuja System" },
      { ref: "5", marker: "CHAPTER V.", label: "The Purnaprajna System" },
      { ref: "6", marker: "CHAPTER VI.", label: "The Pashupata System" },
      { ref: "7", marker: "CHAPTER VII.", label: "The Shaiva System" },
      { ref: "8", marker: "CHAPTER VIII.", label: "The Pratyabhijna System" },
      { ref: "9", marker: "CHAPTER IX.", label: "The Raseshvara System" },
      { ref: "10", marker: "CHAPTER X.", label: "The Vaisheshika System" },
      { ref: "11", marker: "CHAPTER XI.", label: "The Nyaya System" },
      { ref: "12", marker: "CHAPTER XII.", label: "The Mimamsa System" },
      { ref: "13", marker: "CHAPTER XIII.", label: "The Sankhya System" },
      { ref: "14", marker: "CHAPTER XIV.", label: "The Patanjala System" },
      { ref: "15", marker: "CHAPTER XV.", label: "The Vedanta System" },
    ],
    functions: ["philosophical_work", "historical_document"],
  },
  // Sankara's Brahma Sutra commentary is not built here: it is held locally
  // from both parts of Thibaut's translation by
  // scripts/dev/import-brahma-sutras.ts. The old streamed record split the
  // Gutenberg file on its table-of-contents headings and mislabelled the text.
  {
    slug: "valmiki-ramayana",
    title: "The Ramayana of Valmiki",
    originalTitle: "रामायण",
    transliteration: "Rāmāyaṇa",
    author: "valmiki",
    school: "vaishnavism",
    category: "Epic",
    subcategory: "Sanskrit epics",
    genre: "Epic poetry",
    textType: "Epic poem",
    originalLanguage: "sa",
    dateStart: -500,
    dateEnd: -100,
    dateDisplay: "c. 5th–1st century BCE",
    authorshipStatus: "composite",
    attributionNote:
      "Traditionally attributed to Valmiki. The poem grew through oral transmission and the surviving recensions differ, so the work is best described as a tradition rather than a single authorial text.",
    description:
      "The story of Rama, Sita and Ravana in six books: the boyhood and marriage of Rama, his exile, the abduction of Sita, the search through the southern forests, the alliance with the vanaras, and the war at Lanka. Griffith's blank-verse translation follows the Sanskrit cantos closely enough to be quoted by canto.",
    historicalContext:
      "One of the two great Sanskrit epics, composed and transmitted between roughly the fifth and first centuries BCE. Griffith's translation (1870–1874) was the first complete English verse rendering. The Project Gutenberg edition ends with the sixth book, the Yuddha Kanda; the seventh book is held separately in Manmatha Nath Dutt's 1894 prose translation.",
    translator: "Ralph T. H. Griffith",
    translationTitle: "The Rámáyan of Válmíki, translated into English verse",
    translationYear: 1870,
    textUrl: "https://www.gutenberg.org/cache/epub/24869/pg24869.txt",
    sourceUrl: "https://www.gutenberg.org/ebooks/24869",
    anchors: [
      { ref: "1", marker: "BOOK I.(6)", label: "Book I — Bala Kanda" },
      { ref: "2", marker: "BOOK II.", occurrence: "last", label: "Book II — Ayodhya Kanda" },
      { ref: "3", marker: "BOOK III.", occurrence: "last", label: "Book III — Aranya Kanda" },
      { ref: "4", marker: "BOOK IV.", occurrence: "last", label: "Book IV — Kishkindha Kanda" },
      { ref: "5", marker: "BOOK V.(787)", label: "Book V — Sundara Kanda" },
      { ref: "6", marker: "BOOK VI.(895)", label: "Book VI — Yuddha Kanda" },
    ],
    notice:
      "The Project Gutenberg edition of Griffith's translation ends with the sixth book, so the Uttara Kanda is read in Dutt's prose translation in the separate record 'Ramayana — Uttara Kanda'.",
    functions: ["canonical_scripture", "historical_document"],
  },
];

async function buildGutenberg(spec: GutenbergSpec) {
  const text = await getText(spec.textUrl, 90_000);
  const split = splitPlaintextChapters(text, spec.anchors);
  const chapters: { ref: string; label: string }[] = [];
  const passages: { reference: string; label: string; chapterRef: string }[] = [];
  for (const anchor of spec.anchors) {
    const paragraphs = plaintextParagraphs(split.get(anchor.ref) ?? "");
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
    altTitles: spec.altTitles ?? [],
    tradition: "hinduism",
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
    author: spec.author ?? null,
    attributionNote: spec.attributionNote,
    description: spec.description,
    historicalContext: spec.historicalContext,
    availabilityNote:
      `Streamed from Project Gutenberg at read time: the whole plain-text edition is fetched and split at the chapter headings it prints. ` +
      `The ${spec.translationYear} translation by ${spec.translator} is public domain in the United States.${spec.notice ? ` ${spec.notice}` : ""}`,
    featured: 0,
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
        publisher: "Project Gutenberg",
        publicationYear: spec.translationYear,
        source: "project-gutenberg",
        license: "public-domain",
        rightsStatus: "Public domain in the United States",
        attributionText: `${spec.translationTitle}, translated by ${spec.translator} (${spec.translationYear}). Public domain in the United States. Digital text from Project Gutenberg.`,
        structureScheme: "single plain-text edition, split at printed chapter headings",
        isSample: false,
        notes: "The chapter split is performed on the edition as served; the reader is told when the served text no longer matches the indexed paragraphs.",
      },
    ],
  };

  writeFileSync(join(WORKS, `${spec.slug}.json`), `${JSON.stringify(work, null, 2)}\n`);
  streams.works[spec.slug] = {
    provider: "gutenberg",
    upstream: `Project Gutenberg #${spec.sourceUrl.split("/").pop()}`,
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
    host: "project-gutenberg",
    upstream: spec.sourceUrl,
    chapters: chapters.length,
    passages: passages.length,
    translator: spec.translator,
  });
  console.log(`  ${spec.title}: ${chapters.length} chapters, ${passages.length} paragraphs`);
  return { chapters: chapters.length, passages: passages.length };
}

// ---------------------------------------------------------------------------
// Wikisource — the Upanishads in the Sacred Books of the East
// ---------------------------------------------------------------------------

type WikisourceSpec = {
  slug: string;
  title: string;
  originalTitle: string;
  transliteration: string;
  school: string;
  category: string;
  subcategory: string;
  genre: string;
  textType: string;
  dateStart: number;
  dateEnd: number;
  dateDisplay: string;
  authorshipStatus: "established" | "traditional" | "disputed" | "anonymous" | "composite";
  description: string;
  historicalContext: string;
  translationYear: number;
  pages: { title: string; label: string }[];
  functions: string[];
};

const CHANDOGYA_PAGES = [
  "First",
  "Second",
  "Third",
  "Fourth",
  "Fifth",
  "Sixth",
  "Seventh",
  "Eighth",
].map((ordinal, index) => ({
  title: `Sacred Books of the East/Volume 1/Khândogya-upanishad/${ordinal} Prapâthaka`,
  label: `Prapathaka ${index + 1} — ${ordinal}`,
}));

const WIKISOURCE: WikisourceSpec[] = [
  {
    slug: "chandogya-upanishad",
    title: "Chandogya Upanishad",
    originalTitle: "छान्दोग्योपनिषद्",
    transliteration: "Chāndogya Upaniṣad",
    school: "vedanta",
    category: "Scripture",
    subcategory: "Upanishads",
    genre: "Scripture",
    textType: "Upanishad",
    dateStart: -800,
    dateEnd: -600,
    dateDisplay: "c. 8th–6th century BCE",
    authorshipStatus: "composite",
    description:
      "One of the oldest and longest Upanishads, in eight chapters of dialogue and instruction. Its themes include the syllable Om, the identity of the self with Brahman, the five fires, and the teaching of the threefold duty to sacrifice, study and offspring.",
    historicalContext:
      "Part of the Chandogya Brahmana of the Samaveda. Max Müller's translation in the Sacred Books of the East (1879) was the first widely read English version; the Wikisource transcription follows the 1879 volume.",
    translationYear: 1879,
    pages: CHANDOGYA_PAGES,
    functions: ["canonical_scripture", "philosophical_work"],
  },
  {
    slug: "kena-upanishad",
    title: "Kena Upanishad",
    originalTitle: "केनोपनिषद्",
    transliteration: "Kena Upaniṣad",
    school: "vedanta",
    category: "Scripture",
    subcategory: "Upanishads",
    genre: "Scripture",
    textType: "Upanishad",
    dateStart: -800,
    dateEnd: -500,
    dateDisplay: "c. 8th–5th century BCE",
    authorshipStatus: "anonymous",
    description:
      "A short Upanishad on the power that moves the mind and the senses but cannot itself be reached by them. Its closing parable of the gods and the yaksha turns the abstract question into a story about who recognises Brahman.",
    historicalContext:
      "Belonging to the Talavakara Brahmana of the Samaveda, and therefore also called the Talavakara Upanishad. Max Müller's translation is printed in the first volume of the Sacred Books of the East.",
    translationYear: 1879,
    pages: [{ title: "Sacred Books of the East/Volume 1/Talavakâra-upanishad", label: "Kena Upanishad" }],
    functions: ["canonical_scripture", "philosophical_work"],
  },
  {
    slug: "aitareya-upanishad",
    title: "Aitareya Upanishad",
    originalTitle: "ऐतरेयोपनिषद्",
    transliteration: "Aitareya Upaniṣad",
    school: "vedanta",
    category: "Scripture",
    subcategory: "Upanishads",
    genre: "Scripture",
    textType: "Upanishad",
    dateStart: -800,
    dateEnd: -600,
    dateDisplay: "c. 8th–6th century BCE",
    authorshipStatus: "anonymous",
    description:
      "The Upanishad of the Aitareya Aranyaka, on the creation of the worlds and the organs, the entry of the self into the body, and the recognition that consciousness is Brahman.",
    historicalContext:
      "Embedded in the Aitareya Aranyaka of the Rigveda. The Wikisource page prints Max Müller's translation of the aranyaka, in which the Upanishad is the concluding portion.",
    translationYear: 1879,
    pages: [{ title: "Sacred Books of the East/Volume 1/Aitareya-âranyaka", label: "Aitareya Aranyaka and Upanishad" }],
    functions: ["canonical_scripture", "philosophical_work"],
  },
  {
    slug: "isha-upanishad",
    title: "Isha Upanishad",
    originalTitle: "ईशोपनिषद्",
    transliteration: "Īśa Upaniṣad",
    school: "vedanta",
    category: "Scripture",
    subcategory: "Upanishads",
    genre: "Scripture",
    textType: "Upanishad",
    dateStart: -600,
    dateEnd: -400,
    dateDisplay: "c. 6th–4th century BCE",
    authorshipStatus: "anonymous",
    description:
      "Eighteen verses on the presence of the Lord in everything that moves, on action without attachment, and on the relation between knowledge and ignorance. It is the shortest of the principal Upanishads and the one most often quoted in isolation.",
    historicalContext:
      "The concluding portion of the Vajasaneyi Samhita of the Shukla Yajurveda, and therefore also called the Vajasaneyi Samhita Upanishad. Max Müller's translation is in the first volume of the Sacred Books of the East.",
    translationYear: 1879,
    pages: [{ title: "Sacred Books of the East/Volume 1/Vâgasaneyi-samhitâ-upanishad", label: "Isha Upanishad" }],
    functions: ["canonical_scripture", "philosophical_work"],
  },
  {
    slug: "katha-upanishad",
    title: "Katha Upanishad",
    originalTitle: "कठोपनिषद्",
    transliteration: "Kaṭha Upaniṣad",
    school: "vedanta",
    category: "Scripture",
    subcategory: "Upanishads",
    genre: "Scripture",
    textType: "Upanishad",
    dateStart: -500,
    dateEnd: -300,
    dateDisplay: "c. 5th–3rd century BCE",
    authorshipStatus: "anonymous",
    description:
      "The dialogue between the boy Nachiketas and Death, who offers him three boons and then answers his question about what remains after the body dies. It is the Upanishad of the chariot simile, the self as rider and the senses as horses.",
    historicalContext:
      "Belonging to the Katha school of the Krishna Yajurveda. Max Müller's translation is in the second volume of the Sacred Books of the East (1884).",
    translationYear: 1884,
    pages: [{ title: "Sacred Books of the East/Volume 15/Katha-upanishad", label: "Katha Upanishad" }],
    functions: ["canonical_scripture", "philosophical_work"],
  },
  {
    slug: "mundaka-upanishad",
    title: "Mundaka Upanishad",
    originalTitle: "मुण्डकोपनिषद्",
    transliteration: "Muṇḍaka Upaniṣad",
    school: "vedanta",
    category: "Scripture",
    subcategory: "Upanishads",
    genre: "Scripture",
    textType: "Upanishad",
    dateStart: -500,
    dateEnd: -300,
    dateDisplay: "c. 5th–3rd century BCE",
    authorshipStatus: "anonymous",
    description:
      "Three chapters distinguishing the lower knowledge of the Vedas and sciences from the higher knowledge by which the imperishable is known. Its image of the two birds on one tree, one eating the fruit and one watching, is among the most quoted passages in the Upanishads.",
    historicalContext:
      "Belonging to the Atharvaveda. Max Müller's translation is in the second volume of the Sacred Books of the East (1884).",
    translationYear: 1884,
    pages: [{ title: "Sacred Books of the East/Volume 15/Mundaka-upanishad", label: "Mundaka Upanishad" }],
    functions: ["canonical_scripture", "philosophical_work"],
  },
  {
    slug: "prashna-upanishad",
    title: "Prashna Upanishad",
    originalTitle: "प्रश्नोपनिषद्",
    transliteration: "Praśna Upaniṣad",
    school: "vedanta",
    category: "Scripture",
    subcategory: "Upanishads",
    genre: "Scripture",
    textType: "Upanishad",
    dateStart: -500,
    dateEnd: -300,
    dateDisplay: "c. 5th–3rd century BCE",
    authorshipStatus: "anonymous",
    description:
      "Six questions put to the teacher Pippalada by six students, on the origin of creatures, the relation of breath to the self, the nature of life, sleep and dream, meditation on Om, and the sixteen parts of the person. The Upanishad is organised as a sequence of answers rather than as a single discourse.",
    historicalContext:
      "Belonging to the Atharvaveda. Max Müller's translation is in the second volume of the Sacred Books of the East (1884).",
    translationYear: 1884,
    pages: [{ title: "Sacred Books of the East/Volume 15/Prasña-upanishad", label: "Prashna Upanishad" }],
    functions: ["canonical_scripture", "philosophical_work"],
  },
];

async function buildWikisource(spec: WikisourceSpec) {
  const fetched = await pool(spec.pages, Math.min(2, concurrency), async (page) => {
    const url = `https://en.wikisource.org/wiki/${encodeURIComponent(page.title.replaceAll(" ", "_"))}`;
    let last: Error | null = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      await Bun.sleep(600 * attempt);
      try {
        const raw = await getText(
          `https://en.wikisource.org/w/api.php?action=parse&page=${encodeURIComponent(page.title)}&prop=text&format=json&formatversion=2`,
        );
        const html = String(JSON.parse(raw)?.parse?.text ?? "");
        const segments = extractWikisourceSegments(html);
        if (segments.length) return { ...page, url, segments };
        last = new Error("the page returned no text");
      } catch (err) {
        last = err as Error;
      }
      await Bun.sleep(7_000 * attempt);
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
    tradition: "hinduism",
    school: spec.school,
    genre: spec.genre,
    textType: spec.textType,
    category: spec.category,
    subcategory: spec.subcategory,
    originalLanguage: "sa",
    dateStart: spec.dateStart,
    dateEnd: spec.dateEnd,
    dateDisplay: spec.dateDisplay,
    authorshipStatus: spec.authorshipStatus,
    author: null,
    attributionNote:
      "The Upanishads are anonymous and composite texts. The catalogue records the school of the Veda to which the text belongs and does not assign an author.",
    description: spec.description,
    historicalContext: spec.historicalContext,
    availabilityNote: `Streamed from Wikisource page by page at read time. The ${spec.translationYear} translation by F. Max Müller is public domain; the page text is served by Wikisource under its own terms.`,
    featured: 0,
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
        title: `The Upanishads, translated by F. Max Müller (Sacred Books of the East, ${spec.translationYear})`,
        translator: "F. Max Müller",
        publisher: "Wikisource",
        publicationYear: spec.translationYear,
        source: "wikisource",
        license: "public-domain",
        rightsStatus: "Public-domain translation",
        attributionText: `The Upanishads, translated by F. Max Müller (${spec.translationYear}). Public domain. Digital text served by Wikisource.`,
        structureScheme: "one Wikisource page per chapter",
        isSample: false,
        notes: "Only the English translation is hosted; the Sanskrit text is not reproduced. The edition is the Sacred Books of the East volume named in the translation title.",
      },
    ],
  };

  writeFileSync(join(WORKS, `${spec.slug}.json`), `${JSON.stringify(work, null, 2)}\n`);
  streams.works[spec.slug] = {
    provider: "wikisource",
    upstream: spec.title,
    mode: "numbered",
    licence: "public-domain",
    config: { pages: usable.map((page) => ({ title: page.title, url: page.url })) },
    editions: [
      {
        slug: editionSlug,
        language: "en",
        languageName: "english",
        version: `The Upanishads (Max Müller, ${spec.translationYear})`,
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
    translator: "F. Max Müller",
  });
  console.log(`  ${spec.title}: ${chapters.length} chapters, ${passages.length} paragraphs`);
  return { chapters: chapters.length, passages: passages.length };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const streams = JSON.parse(readFileSync(STREAMS, "utf8"));
const functions = JSON.parse(readFileSync(FUNCTIONS, "utf8"));
const previousManifest = (() => {
  try {
    return JSON.parse(readFileSync(MANIFEST, "utf8"));
  } catch {
    return null;
  }
})();
const manifest: any = {
  source: "hindu-sources",
  retrieved_at: RETRIEVED_AT,
  note:
    "Catalogue records, chapter outlines and passage indexes only. The Gita, the Upanishads, the Yoga Sutras, the Brahma Sutras, the Sarva-Darsana-Samgraha and the Ramayana are streamed from their hosts at read time and are not stored in this corpus.",
  hosts: [
    { id: "project-gutenberg", name: "Project Gutenberg", url: "https://www.gutenberg.org/", licence: "public-domain in the United States" },
    { id: "wikisource", name: "Wikisource", url: "https://en.wikisource.org/", licence: "public-domain translations" },
  ],
  works: (previousManifest?.works ?? []) as any[],
  failures: [] as any[],
  totals: { works: 0, chapters: 0, passages: 0 },
};

function recordWork(entry: any) {
  const index = manifest.works.findIndex((w: any) => w.slug === entry.slug);
  if (index >= 0) manifest.works[index] = entry;
  else manifest.works.push(entry);
}

const started = Date.now();

if (!only || only === "gutenberg" || only === "upanishads" || GUTENBERG.some((w) => w.slug === only) || WIKISOURCE.some((w) => w.slug === only)) {
  if (!only || only === "gutenberg" || GUTENBERG.some((w) => w.slug === only)) {
    console.log("Gita, Yoga Sutras, Sarva-Darsana-Samgraha, Brahma Sutras and Ramayana (Project Gutenberg)");
    for (const spec of GUTENBERG) {
      if (only && only !== "gutenberg" && only !== spec.slug) continue;
      try {
        await buildGutenberg(spec);
      } catch (err) {
        console.error(`  ! ${spec.slug}: ${(err as Error).message}`);
        manifest.failures.push({ slug: spec.slug, reason: (err as Error).message });
      }
    }
  }
  if (!only || only === "upanishads" || WIKISOURCE.some((w) => w.slug === only)) {
    console.log("Upanishads (Wikisource, Sacred Books of the East)");
    for (const spec of WIKISOURCE) {
      if (only && only !== "upanishads" && only !== spec.slug) continue;
      try {
        await buildWikisource(spec);
      } catch (err) {
        console.error(`  ! ${spec.slug}: ${(err as Error).message}`);
        manifest.failures.push({ slug: spec.slug, reason: (err as Error).message });
      }
    }
  }
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
