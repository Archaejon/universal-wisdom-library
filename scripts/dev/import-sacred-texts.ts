// Imports public-domain translations hosted by the Internet Sacred Text Archive
// as streamed works: the catalogue record, chapter outline and passage index
// live in the library, and the reader fetches a chapter from the archive.
//
// The volumes come from the archive's Sacred Books of the East shelves, its
// Hinduism, Buddhism and Zoroastrianism sections, and its Christianity section
// (the Ante-Nicene Fathers, the Dionysian corpus, Anselm, the Cloud of
// Unknowing and the Imitation of Christ).
//
// Volume indexes on archive.sacred-texts.com list one link per printed chapter,
// so a volume is described here by the first and last link of the text proper.
// Front matter (title page, contents, preface, introduction, index) is skipped;
// the translator's notes that stand on the chapter pages are kept, because they
// are part of the printed page the reader sees.
//
// The exact reviewed segments are written to
// data/imports/cache/sacred-texts/<slug>.json. The search indexer reads that
// cache instead of crawling the host a second time, and a later run resumes
// from it.
//
//   bun run scripts/dev/import-sacred-texts.ts
//   bun run scripts/dev/import-sacred-texts.ts --only=vendidad
//   bun run scripts/dev/import-sacred-texts.ts --force --only=yasna
//   bun run scripts/dev/import-sacred-texts.ts --list
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cutBlocks, extractHtmlSegments, sliceHtml, stripMarkup } from "../../server/stream";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");
const STREAMS = join(ROOT, "data", "registry", "streams.json");
const FUNCTIONS = join(ROOT, "data", "corpus", "text-functions.json");
const MANIFEST = join(ROOT, "data", "imports", "sacred-texts.json");
const CACHE = join(ROOT, "data", "imports", "cache", "sacred-texts");
const RETRIEVED_AT = new Date().toISOString().slice(0, 10);
const USER_AGENT = "UniversalWisdomLibrary/1.0 (local reading interface; Sacred Text Archive import)";

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.split("=").slice(1).join("=") ?? "";
const force = args.includes("--force");
const dryRun = args.includes("--dry-run");
const listOnly = args.includes("--list");

type Row = Record<string, any>;
type Chapter = { ref: string; label: string; segments: string[] };
type Range = {
  from: string;
  to: string;
  prefix?: string;
  indexUrl?: string;
  /**
   * Take the chapter number from the page's printed heading instead of the
   * volume index. Used where the index restarts its numbering for each
   * khandhaka, and where it repeats or skips a number.
   */
  printedChapterNumbers?: boolean;
  /**
   * The index links to a contents page (one printed book) rather than to a
   * chapter. Expand it into the chapter links it lists, in printed order.
   */
  contents?: boolean;
  /**
   * Shorten the index label before it becomes a chapter title. The Ante-Nicene
   * Fathers and the Cloud of Unknowing print a summary after the chapter
   * number, which makes a contents list of a hundred unreadable lines; the
   * pattern keeps the printed designation and drops the summary.
   */
  labelPattern?: string;
};
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

type Spec = {
  slug: string;
  title: string;
  originalTitle: string;
  transliteration: string;
  altTitles: string[];
  tradition: "hinduism" | "buddhism" | "zoroastrianism" | "christianity" | "sikhism" | "taoism" | "confucianism";
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
  author: string;
  attributionNote: string;
  description: string;
  historicalContext: string;
  availabilityNote: string;
  translator: string;
  translationTitle: string;
  translationYear: number;
  volume: string;
  indexUrl: string;
  ranges: Range[];
  refScheme: string;
  functions: string[];
  /** A printed chapter page whose running text is one hard-wrapped block. */
  editionNote?: string;
  /**
   * Take the chapter label from the page's own heading. The Yasna index on the
   * archive is off by one in places (it labels the page that prints Yasna LXIV
   * as Yasna LXIX), while the page headings are the printed designations.
   */
  labelsFromHeadings?: boolean;
  /** Full labels for pages whose printed chapter differs from the page's number. */
  labelOverrides?: Record<string, string>;
  /**
   * The volume is an English work of its author, not a translation of an older
   * text. Used for the histories and introductions on the Sikh shelf.
   */
  authored?: boolean;
  /** Where the printed text ends; older transcriptions close with their own rule. */
  endMarker?: string;
  /**
   * Begin the page's text at this marker rather than at the archive's banner
   * rule. The appendixes to Legge's second Taoist volume open with his
   * introduction and only then print the translation; the introduction is
   * volume apparatus, not part of the work.
   */
  textStartMarker?: string;
  /**
   * A work printed as one long page (Griffith's Samaveda, Macdonell's Vedic
   * Reader). The page is split into chapters at headings of this level, and
   * each chapter records the slice of the page's segments it covers.
   */
  singlePage?: {
    splitHeading: 1 | 2 | 3;
    /** Start the text here instead of at the volume's first rule. */
    startMarker?: string;
    /** Prefix a chapter with the nearest higher-level heading (the printed part). */
    partHeading?: 1 | 2;
    /** Headings that are volume furniture, not chapters of the work. */
    skip?: string[];
  };
  /**
   * A volume the archive transcribed as plain text, printing the Chinese and
   * Legge's English in alternating blocks. The page is read once: the English
   * blocks are the translation, the Chinese blocks the original, and the
   * printed book headings group both.
   */
  bilingualPage?: {
    /** Line that opens one English chapter. */
    englishPattern: string;
    /** Line that opens one Chinese chapter. */
    chinesePattern: string;
    /** Line that opens a book; the chapters after it belong to that book. */
    bookPattern: string;
    /** Lines the English reader drops: the Chinese half of the page. */
    englishSkipPattern: string;
    /** Lines the Chinese reader drops: the English half, and the titles. */
    chineseSkipPattern: string;
    /** How the edition record describes the Chinese half. */
    chineseEdition: Row;
    /** The stream record of the Chinese edition. */
    chineseStream: Row;
  };
  /**
   * A work the archive now serves from its current book pages rather than from
   * the older transcribed volume: one page per chapter, listed on the book's
   * own page.
   */
  newStyle?: {
    /** The book's page, e.g. https://sacred-texts.com/book/the-i-ching. */
    bookUrl: string;
    /** First and last chapter slug to include. */
    from?: string;
    to?: string;
    /** Chapter slugs that are the volume's furniture, not the work. */
    exclude?: string[];
    /** Chapter slugs whose page heading is too general to name them. */
    labelFromSlug?: string[];
  };
};

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const SBE = "https://archive.sacred-texts.com";
const CFU = `${SBE}/cfu`;

// Printed chapter designations, used to drop the editorial summary the archive
// prints after the number ("Chapter I.—The salutation. Praise of …").
const CHAPTER_LABEL = "^(Chapter\\s+[IVXLCDM]+)\\b.*$";
const CAPUT_LABEL = "^(Caput\\s+[IVXLCDM]+)\\.?$";
const LETTER_LABEL = "^(Letter\\s+[IVXLCDM]+)\\b.*$";

const SPECS: Spec[] = [
  {
    slug: "vendidad",
    title: "Avesta — Vendidad",
    originalTitle: "",
    transliteration: "Vīdēvdād (Vendīdād)",
    altTitles: ["Vendidad", "The Law against the Demons"],
    tradition: "zoroastrianism",
    school: "",
    genre: "Scripture",
    textType: "Law and purity code",
    category: "Avesta",
    subcategory: "Vendidad",
    originalLanguage: "ae",
    dateStart: -1000,
    dateEnd: -500,
    dateDisplay: "c. 1st millennium BCE; written down in the Sasanian period",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The Vendidad is an anonymous priestly compilation. It is traditionally ascribed to Zarathushtra's revelation but was assembled long after the Gathas; the surviving Avestan text is a fragment of a larger collection.",
    description:
      "The Vendidad, the only complete book of the Avesta, in twenty-two fargards. It opens with the creation of sixteen lands by Ahura Mazda and their counter-creations, and then sets out the purity law of the community: the treatment of corpses and the dead, the cleansing of pollution, the care of dogs and fires, contracts and assaults, and the ritual that restores a person to the sacred order.",
    historicalContext:
      "The Vendidad was transmitted with the Yasna in the Zoroastrian liturgy and was written down in the Sasanian period from much older material. James Darmesteter's translation was published in the Sacred Books of the East, volume 4 (1880), with an introduction that founded the modern study of the text.",
    availabilityNote:
      "Complete. All twenty-two fargards of Darmesteter's translation are streamed from the Internet Sacred Text Archive at read time, one fargard per chapter. The volume's introduction is not part of the work; the translator's footnotes printed on each fargard page are kept.",
    translator: "James Darmesteter",
    translationTitle: "The Zend Avesta, Part I: The Vendîdâd",
    translationYear: 1880,
    volume: "Sacred Books of the East, vol. 4",
    indexUrl: `${SBE}/zor/sbe04/index.htm`,
    ranges: [{ from: "sbe0407.htm", to: "sbe0428.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture", "religious_law_practice"],
  },
  {
    slug: "yasna",
    title: "Avesta — Yasna",
    originalTitle: "",
    transliteration: "Yasna",
    altTitles: ["The Yasna", "Yasna, Visparad, Âfrînagân and Gâhs"],
    tradition: "zoroastrianism",
    school: "",
    genre: "Scripture",
    textType: "Liturgy",
    category: "Avesta",
    subcategory: "Yasna",
    originalLanguage: "ae",
    dateStart: -1200,
    dateEnd: -500,
    dateDisplay: "Gathas c. 1200–1000 BCE; liturgical prose c. 6th–4th century BCE",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The Yasna is a liturgical compilation. Its seventeen Gathas are traditionally ascribed to Zarathushtra himself; the surrounding chapters are anonymous priestly compositions, and the Visparad, Âfrînagân and Gâh prayers belong to the same ritual corpus.",
    description:
      "The Yasna is the chief liturgy of Zoroastrianism, in seventy-two chapters: the consecration of the sacred drink, the recital of the Ahuna Vairya and other prayers, confession of faith, invocations of the Bountiful Immortals, and at its centre the Gathas, the seventeen hymns ascribed to Zarathushtra. This volume adds the Visparad, the Âfrînagân blessings and the Gâh prayers that are recited with it.",
    historicalContext:
      "The Yasna preserves the oldest Zoroastrian material in the Gathas, composed in archaic Avestan and transmitted orally for centuries before being written down. L. H. Mills translated the volume for the Sacred Books of the East (volume 31, 1887); his rendering is literal to the point of obscurity, but it remains a standard public-domain witness to the text.",
    availabilityNote:
      "Complete for this volume. The Yasna (including the Gathas), Visparad, Âfrînagân and Gâh prayers are streamed from the Internet Sacred Text Archive at read time, one chapter per page. The volume's introduction and the fragments printed after the Gâhs are not part of the work.",
    translator: "Lawrence H. Mills",
    translationTitle: "The Zend Avesta, Part III: The Yasna, Visparad, Âfrînagân, Gâhs and Miscellaneous Fragments",
    translationYear: 1887,
    volume: "Sacred Books of the East, vol. 31",
    indexUrl: `${SBE}/zor/sbe31/index.htm`,
    ranges: [{ from: "sbe31006.htm", to: "sbe31108.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture", "prayer_liturgy"],
    labelsFromHeadings: true,
  },
  {
    slug: "avesta-yashts",
    title: "Avesta — Sîrôzahs, Yashts and Nyâyis",
    originalTitle: "",
    transliteration: "Sîrôzah, Yašt, Nyāyiš",
    altTitles: ["The Yashts", "Hymns of the Zoroastrian gods"],
    tradition: "zoroastrianism",
    school: "",
    genre: "Scripture",
    textType: "Hymns",
    category: "Avesta",
    subcategory: "Yashts",
    originalLanguage: "ae",
    dateStart: -1000,
    dateEnd: -400,
    dateDisplay: "c. 1st millennium BCE, with later additions",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The Yashts are anonymous hymns addressed to individual divine beings. They were composed over several centuries and collected in the Avestan corpus; none is ascribed to a named author.",
    description:
      "The Sîrôzahs, Yashts and Nyâyis are the devotional hymns of the Avesta: invocations of the thirty days of the month, twenty-four longer hymns addressed to Mithra, Anâhita, Tishtrya, the Fravashis, Verethraghna and the other Yazatas, and the short Nyâyis prayers to the sun, moon, water and fire. They preserve Zoroastrian myth and cultic poetry outside the liturgy of the Yasna.",
    historicalContext:
      "The Yashts are the principal surviving source for Zoroastrian mythology and for the cult of the Yazatas. James Darmesteter translated them for the Sacred Books of the East, volume 23 (1883), with the Sîrôzahs and Nyâyis, and his notes identify the Vedic and later Iranian parallels.",
    availabilityNote:
      "Complete for this volume. The Sîrôzahs, all twenty-four Yashts and the five Nyâyis are streamed from the Internet Sacred Text Archive at read time, one hymn per chapter. The volume's introduction and preliminary observations are not part of the work.",
    translator: "James Darmesteter",
    translationTitle: "The Zend Avesta, Part II: The Sîrôzahs, Yasts and Nyâyis",
    translationYear: 1883,
    volume: "Sacred Books of the East, vol. 23",
    indexUrl: `${SBE}/zor/sbe23/index.htm`,
    ranges: [{ from: "sbe2304.htm", to: "sbe2334.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture", "prayer_liturgy"],
  },
  {
    slug: "laws-of-manu",
    title: "The Laws of Manu",
    originalTitle: "मानवधर्मशास्त्र",
    transliteration: "Mānava-Dharmaśāstra",
    altTitles: ["Manusmriti", "Mānava Dharmaśāstra", "The Code of Manu"],
    tradition: "hinduism",
    school: "",
    genre: "Dharmasastra",
    textType: "Law code",
    category: "Dharmasastra",
    subcategory: "Smriti",
    originalLanguage: "sa",
    dateStart: -200,
    dateEnd: 200,
    dateDisplay: "c. 2nd century BCE – 2nd century CE",
    authorshipStatus: "traditional",
    author: "manu",
    attributionNote:
      "The text presents itself as the teaching of Manu, the primordial lawgiver, to the sages. Its actual composition is anonymous and cumulative, the work of Brahmanical circles over several centuries.",
    description:
      "The Laws of Manu is the most influential Sanskrit treatise on dharma: the social order of the four classes and their stages of life, marriage and inheritance, the duties of the king and the conduct of law, purity and food, penance and expiation, and the teaching of transmigration and final release. It shaped Hindu, Buddhist and Southeast Asian legal practice for more than a millennium.",
    historicalContext:
      "The Manusmriti was compiled in its surviving form around the turn of the era and commented on by Medhatithi, Govindaraja and Kulluka. Georg Bühler's translation, published in the Sacred Books of the East, volume 25 (1886), was the first complete English rendering and remains the standard public-domain edition.",
    availabilityNote:
      "Complete. All twelve chapters of Bühler's translation are streamed from the Internet Sacred Text Archive at read time, one chapter per page. The translator's notes and the volume's preface and index are not part of the work.",
    translator: "Georg Bühler",
    translationTitle: "The Laws of Manu",
    translationYear: 1886,
    volume: "Sacred Books of the East, vol. 25",
    indexUrl: `${SBE}/hin/manu.htm`,
    ranges: [{ from: "manu/manu01.htm", to: "manu/manu12.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["religious_law_practice", "historical_document"],
  },
  {
    slug: "sankhya-aphorisms",
    title: "The Sânkhya Aphorisms of Kapila",
    originalTitle: "सांख्यसूत्र",
    transliteration: "Sāṃkhya-sūtra",
    altTitles: ["Sankhya Sutras", "Kapila's Aphorisms"],
    tradition: "hinduism",
    school: "",
    genre: "Philosophy",
    textType: "Aphorisms with commentary",
    category: "Darshana",
    subcategory: "Sankhya",
    originalLanguage: "sa",
    dateStart: 300,
    dateEnd: 600,
    dateDisplay: "c. 4th–6th century CE (the aphorisms themselves are older)",
    authorshipStatus: "traditional",
    author: "",
    attributionNote:
      "The aphorisms are traditionally ascribed to Kapila, the legendary founder of Sankhya. The surviving sutra collection is a later compilation, and the text translated here carries an anonymous commentary printed with it.",
    description:
      "The Sânkhya Aphorisms set out the classical Sankhya system in six books: the existence and plurality of the selves, the three constituents of nature, the emergence of the world from unmanifest nature, the means of knowledge, the refutation of rival views, and the isolation of the self that is liberation. Ballantyne's translation presents the sutras with the commentary that explains them.",
    historicalContext:
      "Sankhya is one of the oldest of the six Hindu philosophical systems; its classical formulation is the Sankhya-karika of Ishvarakrishna, while the sutras attributed to Kapila represent a later, more scholastic stage. James R. Ballantyne's translation was first published in 1852 and revised for the third edition of 1885.",
    availabilityNote:
      "Complete. All six books of Ballantyne's translation are streamed from the Internet Sacred Text Archive at read time, one book per chapter. The advertisement and preface of the printed volume are not part of the work.",
    translator: "James R. Ballantyne",
    translationTitle: "The Sânkhya Aphorisms of Kapila",
    translationYear: 1885,
    volume: "third edition",
    indexUrl: `${SBE}/hin/sak/index.htm`,
    ranges: [{ from: "sak1.htm", to: "sak6.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["philosophical_work", "canonical_scripture"],
  },
  {
    slug: "hatha-yoga-pradipika",
    title: "The Hatha Yoga Pradipika",
    originalTitle: "हठयोगप्रदीपिका",
    transliteration: "Haṭha Yoga Pradīpikā",
    altTitles: ["Hathayogapradipika", "Light on Hatha Yoga"],
    tradition: "hinduism",
    school: "",
    genre: "Yoga manual",
    textType: "Treatise",
    category: "Yoga",
    subcategory: "Hatha yoga",
    originalLanguage: "sa",
    dateStart: 1400,
    dateEnd: 1600,
    dateDisplay: "c. 15th century CE",
    authorshipStatus: "traditional",
    author: "",
    attributionNote:
      "The treatise is ascribed to Svātmārāma, a disciple of Gorakṣanātha. Little is known of the author, and the text draws on earlier Nath and Siddha traditions.",
    description:
      "The Hatha Yoga Pradipika is the classic manual of hatha yoga in four chapters: the postures and the place and manner of practice; breath control and the purification of the channels; the seals and locks that raise the vital breath; and the states of absorption that lead to liberation. It is the source of much of the posture and breath practice now taught worldwide.",
    historicalContext:
      "Svātmārāma compiled the Pradipika in the fifteenth century from earlier Yoga Upanishads and Nath works. Pancham Sinh's English translation, published in 1914, is the first complete rendering and remains a standard public-domain edition; it is a literal translation with the author's own explanatory notes.",
    availabilityNote:
      "Complete. All four chapters of Pancham Sinh's translation are streamed from the Internet Sacred Text Archive at read time, one chapter per page. The volume's introduction and table of contents are not part of the work.",
    translator: "Pancham Sinh",
    translationTitle: "The Hatha Yoga Pradipika",
    translationYear: 1914,
    volume: "second edition",
    indexUrl: `${SBE}/hin/hyp/index.htm`,
    ranges: [{ from: "hyp03.htm", to: "hyp06.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["religious_law_practice", "mystical_contemplative"],
  },
  {
    slug: "sutta-nipata",
    title: "The Sutta-Nipâta",
    originalTitle: "सुत्तनिपात",
    transliteration: "Sutta Nipāta",
    altTitles: ["Suttanipata", "The Group of Discourses"],
    tradition: "buddhism",
    school: "theravada",
    genre: "Scripture",
    textType: "Discourses in verse",
    category: "Sutta",
    subcategory: "Khuddaka Nikāya",
    originalLanguage: "pi",
    dateStart: -400,
    dateEnd: -100,
    dateDisplay: "Composed c. 4th–2nd centuries BCE",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The Sutta-Nipâta is an anthology of early Buddhist discourses, transmitted anonymously within the Khuddaka Nikâya. Individual suttas are presented as the Buddha's teaching but the collection as a whole is the work of the early community.",
    description:
      "The Sutta-Nipâta gathers some of the oldest Buddhist poetry in five vaggas: the Uragavagga on the snake, the chariot and the farmer; the Kūlavagga of the charcoal-burner and the outcaste; the Mahāvagga with the discourse on friendliness and the going forth; the Aṭṭhakavagga on the abandonment of views; and the Pārāyanavagga of the questions of the brahmin youths. It is a primary witness to early Buddhist ethics and meditation.",
    historicalContext:
      "The Sutta-Nipâta was translated by Viggo Fausböll for the Sacred Books of the East, volume 10 (1881), together with Müller's Dhammapada. Its archaic language and its treatment of brahmanical sacrifice make it central to the study of early Buddhism.",
    availabilityNote:
      "Complete. All five vaggas of Fausböll's translation are streamed from the Internet Sacred Text Archive at read time, one vagga per chapter. Each page is long because the printed edition prints a whole vagga at a time; the passage index follows its paragraphs. The volume's glossary and introduction are not part of the work.",
    translator: "Viggo Fausböll",
    translationTitle: "The Dhammapada and The Sutta-Nipâta (Sacred Books of the East, vol. 10, part II)",
    translationYear: 1881,
    volume: "Sacred Books of the East, vol. 10",
    indexUrl: `${SBE}/bud/sbe10/index.htm`,
    ranges: [{ from: "sbe1033.htm", to: "sbe1037.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture"],
  },
  {
    slug: "buddhist-suttas",
    title: "Buddhist Suttas",
    originalTitle: "",
    transliteration: "",
    altTitles: ["Sacred Books of the East, vol. 11"],
    tradition: "buddhism",
    school: "theravada",
    genre: "Scripture",
    textType: "Discourses",
    category: "Sutta",
    subcategory: "Dīgha Nikāya and Majjhima Nikāya selections",
    originalLanguage: "pi",
    dateStart: -400,
    dateEnd: -100,
    dateDisplay: "Composed c. 4th–2nd centuries BCE",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The discourses are presented in the canon as the Buddha's teaching, transmitted by the early Buddhist community. The Pali text is anonymous and collective.",
    description:
      "This volume collects seven discourses that stand at the centre of Theravada scripture: the Book of the Great Decease, the Buddha's last journey and final instructions; the Foundation of the Kingdom of Righteousness, his first sermon; the Tevigga on knowledge of the Vedas; the Akankheyya on desire; the Ketokhila on barrenness and bondage; the Mahā-Sudassana legend of the great king of glory; and the Sabbāsava on the destruction of the intoxicants.",
    historicalContext:
      "T. W. Rhys Davids translated these suttas for the Sacred Books of the East, volume 11 (1881). The Mahāparinibbāna-Suttanta in particular remains a standard English rendering and shaped the modern understanding of the Buddha's final days.",
    availabilityNote:
      "Complete for this volume. All seven suttas are streamed from the Internet Sacred Text Archive at read time, one sutta per chapter. The volume's general introduction is not part of the work.",
    translator: "T. W. Rhys Davids",
    translationTitle: "Buddhist Suttas (Sacred Books of the East, vol. 11)",
    translationYear: 1881,
    volume: "Sacred Books of the East, vol. 11",
    indexUrl: `${SBE}/bud/sbe11/index.htm`,
    ranges: [{ from: "sbe1103.htm", to: "sbe1109.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture"],
  },
  {
    slug: "milindapanha",
    title: "The Questions of King Milinda",
    originalTitle: "मिलिन्दपञ्ह",
    transliteration: "Milindapañha",
    altTitles: ["Milindapanha", "The Milinda Questions"],
    tradition: "buddhism",
    school: "theravada",
    genre: "Dialogue",
    textType: "Philosophical dialogue",
    category: "Paracanonical text",
    subcategory: "Milindapañha",
    originalLanguage: "pi",
    dateStart: -100,
    dateEnd: 200,
    dateDisplay: "c. 1st century BCE – 2nd century CE",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The dialogue is anonymous. It presents questions put by the Indo-Greek king Menander (Milinda) to the monk Nāgasena; the king is a historical figure, the monk may be a literary creation.",
    description:
      "The Questions of King Milinda is the longest and most philosophical of the paracanonical Pali books: a dialogue in which the Greek king Menander tests the monk Nāgasena on the self, rebirth, karma, the nature of the Buddha, and the practice of the path, using the famous simile of the chariot to show that a person is a convenient designation rather than a substance. It is a bridge between Greek and Buddhist thought.",
    historicalContext:
      "The Milindapañha survives in Pali, with a Chinese recension and a Sanskrit parallel; it is canonical in the Burmese tradition but excluded from the Sinhalese canon. T. W. Rhys Davids translated it in two volumes for the Sacred Books of the East (volumes 35 and 36, 1890 and 1894).",
    availabilityNote:
      "Complete. Both Sacred Books of the East volumes (35 and 36) are combined here and streamed from the Internet Sacred Text Archive at read time, one chapter per page. Chapter labels carry the source volume because the printed numbering restarts between them. The introductions, addenda and indexes are not part of the work.",
    translator: "T. W. Rhys Davids",
    translationTitle: "The Questions of King Milinda (Sacred Books of the East, vols. 35–36)",
    translationYear: 1894,
    volume: "Sacred Books of the East, vols. 35–36",
    indexUrl: `${SBE}/bud/sbe35/index.htm`,
    ranges: [
      { from: "sbe3503.htm", to: "sbe3516.htm", prefix: "SBE 35 · " },
      {
        from: "sbe3603.htm",
        to: "sbe3615.htm",
        prefix: "SBE 36 · ",
        indexUrl: `${SBE}/bud/sbe36/index.htm`,
      },
    ],
    refScheme: "chapter.paragraph",
    functions: ["non_canonical_religious_text", "philosophical_work"],
  },
  {
    slug: "buddhist-mahayana-texts",
    title: "Buddhist Mahâyâna Texts",
    originalTitle: "",
    transliteration: "",
    altTitles: ["Sacred Books of the East, vol. 49"],
    tradition: "buddhism",
    school: "",
    genre: "Scripture",
    textType: "Treatise and sutras",
    category: "Mahayana",
    subcategory: "Sūtras and śāstra",
    originalLanguage: "sa",
    dateStart: 100,
    dateEnd: 700,
    dateDisplay: "Composed c. 2nd–7th century CE",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The volume gathers anonymous Mahayana texts. The Awakening of Faith is traditionally ascribed to Aśvaghoṣa, but its authorship and Chinese origin are disputed; the sutras are anonymous compositions of the Mahayana movement.",
    description:
      "This volume is the classic English introduction to Mahayana scripture: Aśvaghoṣa's Discourse on the Awakening of Faith in the Mahâyâna in seventeen books, the Larger and Smaller Sukhâvatî-vyûha on the Pure Land of Amitâbha, the Vajrakkhedikâ (Diamond Sutra), the Larger and Smaller Prajñâ-pâramitâ-hridaya (Heart Sutra), and the Amitâyur-dhyâna-sûtra on the meditation of Amitâyus.",
    historicalContext:
      "The texts were translated by E. B. Cowell, F. Max Müller and J. Takakusu for the Sacred Books of the East, volume 49 (1894). Together they introduced the Pure Land, Perfection of Wisdom and tathāgatagarbha traditions to English readers.",
    availabilityNote:
      "Complete for this volume. The Awakening of Faith and the five sutras are streamed from the Internet Sacred Text Archive at read time, one book or sutra per chapter. The volume's introduction and notes are not part of the work.",
    translator: "E. B. Cowell, F. Max Müller and J. Takakusu",
    translationTitle: "Buddhist Mahâyâna Texts (Sacred Books of the East, vol. 49)",
    translationYear: 1894,
    volume: "Sacred Books of the East, vol. 49",
    indexUrl: `${SBE}/bud/sbe49/index.htm`,
    ranges: [
      { from: "sbe4903.htm", to: "sbe4919.htm" },
      { from: "sbe4924.htm", to: "sbe4933.htm" },
    ],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture"],
  },
  {
    slug: "lotus-sutra",
    title: "The Lotus Sutra",
    originalTitle: "सद्धर्मपुण्डरीकसूत्र",
    transliteration: "Saddharma-puṇḍarīka-sūtra",
    altTitles: ["Saddharma-pundarika", "The Lotus of the True Law"],
    tradition: "buddhism",
    school: "",
    genre: "Scripture",
    textType: "Mahayana sutra",
    category: "Mahayana",
    subcategory: "Saddharma-puṇḍarīka",
    originalLanguage: "sa",
    dateStart: 50,
    dateEnd: 200,
    dateDisplay: "c. 1st–2nd century CE",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The sutra is anonymous, composed in India over several generations and expanded as it travelled through Central Asia and East Asia. It is not ascribed to a single author.",
    description:
      "The Lotus Sutra is the most influential Mahayana scripture in East Asia, in twenty-seven chapters: the Buddha's declaration that all beings can attain Buddhahood, the parable of the burning house, the jewel in the robe, the story of the dragon king's daughter, the appearance of the stupa of Many Treasures, the cosmic lifespan of the Buddha, and the bodhisattva practices of the universal gate. Its teaching of the one vehicle shaped Tiantai, Tendai, Nichiren and much of Chinese and Japanese Buddhism.",
    historicalContext:
      "The Saddharma-puṇḍarīka survives in Sanskrit, Tibetan and Chinese recensions; the Chinese translation of Kumārajīva (406) became the standard East Asian text. H. Kern's translation, published in the Sacred Books of the East, volume 21 (1884), is the first complete English rendering from the Sanskrit and remains a standard public-domain edition.",
    availabilityNote:
      "Complete. All twenty-seven chapters of Kern's translation are streamed from the Internet Sacred Text Archive at read time, one chapter per page. The volume's introduction is not part of the work.",
    translator: "H. Kern",
    translationTitle: "The Saddharma-pundarîka, or The Lotus of the True Law",
    translationYear: 1884,
    volume: "Sacred Books of the East, vol. 21",
    indexUrl: `${SBE}/bud/lotus/index.htm`,
    ranges: [{ from: "lot01.htm", to: "lot27.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture"],
  },
  {
    slug: "pahlavi-texts-bundahis",
    title: "Pahlavi Texts, Part I: Bundahis, Bahman Yast and Shayast la-Shayast",
    originalTitle: "",
    transliteration: "Bundahišn, Bahman Yašt, Šāyist nē Šāyist",
    altTitles: ["Pahlavi Texts, Part I", "Bundahishn"],
    tradition: "zoroastrianism",
    school: "",
    genre: "Scripture",
    textType: "Cosmogony, apocalypse and law",
    category: "Pahlavi literature",
    subcategory: "Bundahis and related texts",
    originalLanguage: "pal",
    dateStart: 800,
    dateEnd: 1000,
    dateDisplay: "9th century CE, from older oral and written sources",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "These Pahlavi books are anonymous compilations of the Zoroastrian priesthood, written down in the ninth century from earlier Middle Persian tradition. They are not Avestan scripture and are not ascribed to Zarathushtra.",
    description:
      "The first volume of West's Pahlavi Texts contains the Bundahis, the Zoroastrian account of creation: the primal conflict of Ohrmazd and Ahriman, the making of the sky, water, earth, plants, animals and humanity, and the final renovation. With it are the Selections of Zad-sparam, the apocalyptic Bahman Yast, and the Shayast la-Shayast, the Pahlavi manual of religious law and penance.",
    historicalContext:
      "The Bundahis and its companion texts survive only in ninth-century Pahlavi compilations, though they preserve much older Mazdean teaching. E. W. West translated them for the Sacred Books of the East, volume 5 (1880), the first volume of his five-volume Pahlavi series.",
    availabilityNote:
      "Complete for this volume. The Bundahis (34 chapters), the Selections of Zad-sparam, the Bahman Yast and the Shayast la-Shayast are streamed from the Internet Sacred Text Archive at read time, one chapter per page. The volume's introduction and editorial observations are not part of the work.",
    translator: "E. W. West",
    translationTitle: "Pahlavi Texts, Part I: The Bundahis, Bahman Yast, and Shayâst Lâ-Shâyast",
    translationYear: 1880,
    volume: "Sacred Books of the East, vol. 5",
    indexUrl: `${SBE}/zor/sbe05/index.htm`,
    ranges: [
      { from: "sbe0510.htm", to: "sbe0543.htm", prefix: "Bundahis · " },
      { from: "sbe0545.htm", to: "sbe0555.htm", prefix: "Zad-sparam · " },
      { from: "sbe0557.htm", to: "sbe0559.htm", prefix: "Bahman Yast · " },
      { from: "sbe0561.htm", to: "sbe0583.htm", prefix: "Shayast la-Shayast · " },
    ],
    refScheme: "chapter.paragraph",
    functions: ["non_canonical_religious_text", "religious_law_practice"],
  },
  {
    slug: "pahlavi-texts-dadistan",
    title: "Pahlavi Texts, Part II: The Dadistan-i Dinik and the Epistles of Manuskihar",
    originalTitle: "",
    transliteration: "Dādestān ī Dēnīg, Nāmagīhā ī Manuščihr",
    altTitles: ["Pahlavi Texts, Part II", "Dadestan-i Denig"],
    tradition: "zoroastrianism",
    school: "",
    genre: "Scripture",
    textType: "Religious questions and answers",
    category: "Pahlavi literature",
    subcategory: "Dadistan-i Dinik",
    originalLanguage: "pal",
    dateStart: 800,
    dateEnd: 900,
    dateDisplay: "9th century CE",
    authorshipStatus: "traditional",
    author: "",
    attributionNote:
      "The Dadistan-i Dinik is attributed to Manushchihr, the high priest of Pars and Kirman. The Epistles are his letters to his brother Zad-sparam; both survive in ninth-century Pahlavi.",
    description:
      "The Dadistan-i Dinik is a book of religious judgement in ninety-four chapters: questions put to the high priest Manushchihr on ritual, purity, marriage, sin, death and the fate of the soul, with his answers. The volume adds the Epistles of Manushchihar, the same author's defence of his authority and rulings against his brother, and the appendix that accompanies them.",
    historicalContext:
      "Manushchihr was a leading Zoroastrian authority in ninth-century Iran; his decisions are a primary source for the lived law of the community under Islamic rule. E. W. West translated the volume for the Sacred Books of the East (volume 18, 1882).",
    availabilityNote:
      "Complete for this volume, with one gap in the source transcription: the Dadistan-i Dinik's printed chapter XXII is absent, so the archive's numbering jumps from XXI to XXIII. Every other chapter, the three Epistles of Manushchihar and their appendix are streamed from the Internet Sacred Text Archive at read time, one chapter per page. The volume's introduction is not part of the work.",
    translator: "E. W. West",
    translationTitle: "Pahlavi Texts, Part II: The Dâdistân-î Dînîk and the Epistles of Mânûskîhar",
    translationYear: 1882,
    volume: "Sacred Books of the East, vol. 18",
    indexUrl: `${SBE}/zor/sbe18/index.htm`,
    ranges: [
      { from: "sbe18009.htm", to: "sbe18101.htm", prefix: "Dadistan-i Dinik · " },
      { from: "sbe18102.htm", to: "sbe18112.htm", prefix: "Epistle I · " },
      { from: "sbe18113.htm", to: "sbe18121.htm", prefix: "Epistle II · " },
      { from: "sbe18122.htm", to: "sbe18127.htm", prefix: "Epistle III · " },
    ],
    refScheme: "chapter.paragraph",
    functions: ["non_canonical_religious_text", "religious_law_practice"],
  },
  {
    slug: "pahlavi-texts-mainog-i-khirad",
    title: "Pahlavi Texts, Part III: Dina-i Mainog-i Khirad, Sikand-Gumanik Vigar and Sad Dar",
    originalTitle: "",
    transliteration: "Dēnkard III, Šikand-gumānīg wizār, Sad Dar",
    altTitles: ["Pahlavi Texts, Part III", "Mainog-i Khirad"],
    tradition: "zoroastrianism",
    school: "",
    genre: "Scripture",
    textType: "Wisdom literature, apology and law",
    category: "Pahlavi literature",
    subcategory: "Mainog-i Khirad and related texts",
    originalLanguage: "pal",
    dateStart: 800,
    dateEnd: 1600,
    dateDisplay: "9th century CE; the Sad Dar is a later compilation (c. 16th century)",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The Mainog-i Khirad and the Sikand-Gumanik Vigar are anonymous ninth-century Pahlavi works. The Sad Dar is a later Middle Persian/New Persian compendium of religious law; none is ascribed to a named author.",
    description:
      "The third volume of West's series contains the Dina-i Mainog-i Khirad, a dialogue in sixty-three chapters in which the soul of wisdom answers questions on the origin of evil, the nature of the world, fate, sin and salvation; the Sikand-Gumanik Vigar, a systematic refutation of Judaism, Christianity, Islam, Manichaeism and other religions; and the Sad Dar, one hundred chapters of Zoroastrian law and custom.",
    historicalContext:
      "These are the principal theological and apologetic works of ninth-century Zoroastrianism, written when the community was a minority under Islamic rule. The Sad Dar, added in this volume, is a later summary of the same legal tradition. E. W. West translated the volume for the Sacred Books of the East (volume 24, 1885).",
    availabilityNote:
      "Complete for this volume. The Mainog-i Khirad (63 chapters), the Sikand-Gumanik Vigar (16 chapters) and the Sad Dar (100 chapters) are streamed from the Internet Sacred Text Archive at read time, one chapter per page. The volume's introduction and editorial observations are not part of the work.",
    translator: "E. W. West",
    translationTitle: "Pahlavi Texts, Part III: Dînâ-î Maînôg-î Khirad, Sikand-Gûmânîk Vigâr, and the Sad Dar",
    translationYear: 1885,
    volume: "Sacred Books of the East, vol. 24",
    indexUrl: `${SBE}/zor/sbe24/index.htm`,
    ranges: [
      { from: "sbe24007.htm", to: "sbe24069.htm", prefix: "Mainog-i Khirad · " },
      { from: "sbe24071.htm", to: "sbe24086.htm", prefix: "Sikand-Gumanik Vigar · " },
      { from: "sbe24089.htm", to: "sbe24188.htm", prefix: "Sad Dar · " },
    ],
    refScheme: "chapter.paragraph",
    functions: ["non_canonical_religious_text", "philosophical_work"],
  },
  {
    slug: "pahlavi-texts-nasks",
    title: "Pahlavi Texts, Part IV: Contents of the Nasks",
    originalTitle: "",
    transliteration: "Dēnkard VIII",
    altTitles: ["Pahlavi Texts, Part IV", "Denkard Book VIII"],
    tradition: "zoroastrianism",
    school: "",
    genre: "Scripture",
    textType: "Catalogue and excerpts",
    category: "Pahlavi literature",
    subcategory: "Denkard",
    originalLanguage: "pal",
    dateStart: 800,
    dateEnd: 1000,
    dateDisplay: "9th–10th century CE",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The Denkard is an anonymous ninth-century Pahlavi encyclopaedia of Zoroastrian learning, compiled by several hands. Book VIII summarises the lost Nasks, the twenty-one books of the Avesta.",
    description:
      "Book VIII of the Denkard is the ancient world's most detailed catalogue of a scripture: it summarises, book by book, the contents of the twenty-one Nasks of the Avesta, most of which are lost. The volume adds selections from the Denkard and Zad-sparam on the same Nasks, including the Vistasp Nask, the Vendidad Nask and the Hadokht Nask, and the Rivayat excerpts that preserve their memory.",
    historicalContext:
      "The Denkard was compiled in the ninth century to preserve Zoroastrian learning under Islamic rule. Because the Nasks themselves survive only in fragments, West's translation (Sacred Books of the East, volume 37, 1892) remains a primary source for the lost Avesta.",
    availabilityNote:
      "Complete for this volume. Book VIII of the Denkard (46 chapters) and Book IX (69 chapters), with the accompanying selections from Zad-sparam and the Rivayats, are streamed from the Internet Sacred Text Archive at read time, one chapter per page. The volume's introduction and editorial observations are not part of the work.",
    translator: "E. W. West",
    translationTitle: "Pahlavi Texts, Part IV: Contents of the Nasks",
    translationYear: 1892,
    volume: "Sacred Books of the East, vol. 37",
    indexUrl: `${SBE}/zor/sbe37/index.htm`,
    ranges: [
      { from: "sbe37004.htm", to: "sbe37049.htm", prefix: "Denkard VIII · " },
      { from: "sbe37050.htm", to: "sbe37118.htm", prefix: "Denkard IX · " },
      { from: "sbe37120.htm", to: "sbe37149.htm" },
    ],
    refScheme: "chapter.paragraph",
    functions: ["non_canonical_religious_text", "historical_document"],
  },
  {
    slug: "pahlavi-texts-marvels",
    title: "Pahlavi Texts, Part V: Marvels of Zoroastrianism",
    originalTitle: "",
    transliteration: "Dēnkard VII",
    altTitles: ["Pahlavi Texts, Part V", "Denkard Book VII"],
    tradition: "zoroastrianism",
    school: "",
    genre: "Scripture",
    textType: "Hagiography and apocalypse",
    category: "Pahlavi literature",
    subcategory: "Denkard",
    originalLanguage: "pal",
    dateStart: 800,
    dateEnd: 1000,
    dateDisplay: "9th–10th century CE",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The Denkard is an anonymous ninth-century Pahlavi compilation. Book VII retells the life of Zarathushtra and the history of the faith; Book V treats the same themes in a shorter form.",
    description:
      "Book VII of the Denkard is the Zoroastrian story of salvation: the creation of Zarathushtra, the marvels of his conception and birth, his reception of the religion from Ohrmazd, the trials of the faith under its mythical kings, and the final renovation of the world. The volume adds Book V of the Denkard and the Selections of Zad-sparam on the same subject.",
    historicalContext:
      "These are the fullest surviving Pahlavi accounts of Zarathushtra's life, written centuries after the Avesta and shaping later Zoroastrian legend. E. W. West translated them for the Sacred Books of the East, volume 47 (1897), the last of his Pahlavi volumes.",
    availabilityNote:
      "Complete for this volume. The Denkard's Marvels (Book VII, chapters I–XI), Book V and the Selections of Zad-sparam are streamed from the Internet Sacred Text Archive at read time, one chapter per page. The volume's introduction and editorial observations are not part of the work.",
    translator: "E. W. West",
    translationTitle: "Pahlavi Texts, Part V: Marvels of Zoroastrianism",
    translationYear: 1897,
    volume: "Sacred Books of the East, vol. 47",
    indexUrl: `${SBE}/zor/sbe47/index.htm`,
    ranges: [
      { from: "sbe4705.htm", to: "sbe4715.htm", prefix: "Denkard VII · " },
      { from: "sbe4716.htm", to: "sbe4719.htm", prefix: "Denkard V · " },
      { from: "sbe4720.htm", to: "sbe4732.htm", prefix: "Zad-sparam · " },
    ],
    refScheme: "chapter.paragraph",
    functions: ["non_canonical_religious_text", "mystical_contemplative"],
  },
  {
    slug: "satapatha-brahmana",
    title: "Satapatha Brahmana",
    originalTitle: "शतपथब्राह्मण",
    transliteration: "Śatapatha Brāhmaṇa",
    altTitles: ["Shatapatha Brahmana", "The Brahmana of One Hundred Paths"],
    tradition: "hinduism",
    school: "",
    genre: "Brahmana",
    textType: "Ritual exegesis",
    category: "Brahmana",
    subcategory: "Satapatha — Madhyandina recension",
    originalLanguage: "sa",
    dateStart: -800,
    dateEnd: -600,
    dateDisplay: "c. 8th–6th century BCE",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The Satapatha Brahmana is an anonymous Vedic prose text attached to the White Yajurveda. Its teaching is traditionally ascribed to Yajnavalkya, but the work is a collective priestly composition.",
    description:
      "The Satapatha Brahmana is the longest and most important of the Vedic Brahmanas, in fourteen kandas. It explains the ritual of the White Yajurveda — the fire altar, the soma sacrifice, the horse sacrifice, the agnihotra and the royal consecration — and embeds in its exegesis the creation hymns, the doctrine of the sacrifice as the making of the world, and the earliest form of the Brihadaranyaka Upanishad. It is the bridge between the Vedic hymns and the Upanishads.",
    historicalContext:
      "The Satapatha survives in the Madhyandina and Kanva recensions; Eggeling translated the Madhyandina text for the Sacred Books of the East in five volumes (12, 26, 41, 43 and 44; 1882–1900). His is still the only complete English translation.",
    availabilityNote:
      "Complete. All fourteen kandas of Eggeling's translation are streamed from the Internet Sacred Text Archive at read time. Each printed brahmana is one chapter, labelled with its kanda, adhyaya and brahmana numbers, so the five printed volumes are read as one work. The volumes' introductions are not part of the work.",
    translator: "Julius Eggeling",
    translationTitle: "The Satapatha-Brâhmana, according to the Text of the Mâdhyandina School",
    translationYear: 1900,
    volume: "Sacred Books of the East, vols. 12, 26, 41, 43 and 44",
    indexUrl: `${SBE}/hin/sbr/sbe12/index.htm`,
    ranges: [
      { from: "sbe1203.htm", to: "sbe1263.htm", indexUrl: `${SBE}/hin/sbr/sbe12/index.htm` },
      { from: "sbe2603.htm", to: "sbe2678.htm", indexUrl: `${SBE}/hin/sbr/sbe26/index.htm` },
      { from: "sbe4103.htm", to: "sbe4166.htm", indexUrl: `${SBE}/hin/sbr/sbe41/index.htm` },
      { from: "sbe4303.htm", to: "sbe4375.htm", indexUrl: `${SBE}/hin/sbr/sbe43/index.htm` },
      { from: "sbe44003.htm", to: "sbe44124.htm", indexUrl: `${SBE}/hin/sbr/sbe44/index.htm` },
    ],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture", "commentary_exegesis"],
    editionNote: "chapter and paragraph index; each chapter is one printed brahmana",
  },
  {
    slug: "vinaya-texts",
    title: "Vinaya Texts",
    originalTitle: "",
    transliteration: "Vinaya Piṭaka",
    altTitles: ["The Vinaya Piṭaka", "Vinaya Texts (Sacred Books of the East, vols. 13, 17 and 20)"],
    tradition: "buddhism",
    school: "theravada",
    genre: "Scripture",
    textType: "Monastic law and procedure",
    category: "Vinaya",
    subcategory: "Pātimokkha, Mahāvagga and Kullavagga",
    originalLanguage: "pi",
    dateStart: -400,
    dateEnd: -300,
    dateDisplay: "c. 4th–3rd century BCE; written down in Sri Lanka in the 1st century BCE",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The Vinaya Piṭaka is an anonymous compilation of the Theravada monastic order, traditionally recited at the first council after the Buddha's death. Its rules are presented as the Buddha's own enactments, each occasioned by a case in the community, but the collection took its present shape over generations.",
    description:
      "The Vinaya Piṭaka is the monastic law of the Theravada canon: the Pātimokkha, the 227 rules recited at the fortnightly assembly, with the narrative that explains each one; the Mahāvagga, on admission to the order, the uposatha, the rains retreat, the closing ceremony, medicines, robes, the kaṭhina, schisms and the duties of teachers; and the Kullavagga, on the minor proceedings, probation and penance, the settlement of disputes, dwellings, the duties of nuns, and the two councils at Rājagaha and Vesālī. It is the fullest surviving picture of early Buddhist monastic life.",
    historicalContext:
      "The Pali Vinaya was transmitted orally and written down in Sri Lanka in the first century BCE. T. W. Rhys Davids and Hermann Oldenberg translated it in three volumes for the Sacred Books of the East (13, 1881; 17, 1882; 20, 1885). Their work made the monastic law of the Theravada available in English for the first time and remains the standard public-domain translation.",
    availabilityNote:
      "Complete. All three Sacred Books of the East volumes (13, 17 and 20) are combined here and streamed from the Internet Sacred Text Archive at read time, one printed page per chapter. Part I holds the Pātimokkha and the first four Mahāvagga khandhakas; Part II the Fifth to Tenth khandhakas and the first three of the Kullavagga; Part III the Fourth to Twelfth kullavagga khandhakas. Chapter labels carry the khandhaka and the chapter number printed on the page. A page can print two chapters (for example Kullavagga I, chapters 26 and 27); it is labelled with both, and the one page that carries the end of Mahāvagga VIII, chapter 32 together with the opening of Mahāvagga IX says so. The volumes' introductions, notes and indexes are not part of the work.",
    translator: "T. W. Rhys Davids and Hermann Oldenberg",
    translationTitle: "Vinaya Texts (Sacred Books of the East, vols. 13, 17 and 20)",
    translationYear: 1885,
    volume: "Sacred Books of the East, vols. 13, 17 and 20",
    indexUrl: `${SBE}/bud/sbe13/index.htm`,
    ranges: [
      { from: "sbe1303.htm", to: "sbe1311.htm", prefix: "Patimokkha · " },
      { from: "sbe1312.htm", to: "sbe1315.htm", prefix: "Mahavagga · " },
      {
        from: "sbe17002.htm",
        to: "sbe17014.htm",
        prefix: "Mahavagga V, ",
        indexUrl: `${SBE}/bud/sbe17/index.htm`,
        printedChapterNumbers: true,
      },
      {
        from: "sbe17015.htm",
        to: "sbe17054.htm",
        prefix: "Mahavagga VI, ",
        indexUrl: `${SBE}/bud/sbe17/index.htm`,
        printedChapterNumbers: true,
      },
      {
        from: "sbe17055.htm",
        to: "sbe17067.htm",
        prefix: "Mahavagga VII, ",
        indexUrl: `${SBE}/bud/sbe17/index.htm`,
        printedChapterNumbers: true,
      },
      {
        from: "sbe17068.htm",
        to: "sbe17099.htm",
        prefix: "Mahavagga VIII, ",
        indexUrl: `${SBE}/bud/sbe17/index.htm`,
        printedChapterNumbers: true,
      },
      {
        from: "sbe17100.htm",
        to: "sbe17105.htm",
        prefix: "Mahavagga IX, ",
        indexUrl: `${SBE}/bud/sbe17/index.htm`,
        printedChapterNumbers: true,
      },
      {
        from: "sbe17106.htm",
        to: "sbe17111.htm",
        prefix: "Mahavagga X, ",
        indexUrl: `${SBE}/bud/sbe17/index.htm`,
        printedChapterNumbers: true,
      },
      {
        from: "sbe17112.htm",
        to: "sbe17145.htm",
        prefix: "Kullavagga I, ",
        indexUrl: `${SBE}/bud/sbe17/index.htm`,
        printedChapterNumbers: true,
      },
      {
        from: "sbe17146.htm",
        to: "sbe17154.htm",
        prefix: "Kullavagga II, ",
        indexUrl: `${SBE}/bud/sbe17/index.htm`,
        printedChapterNumbers: true,
      },
      {
        from: "sbe17155.htm",
        to: "sbe17189.htm",
        prefix: "Kullavagga III, ",
        indexUrl: `${SBE}/bud/sbe17/index.htm`,
        printedChapterNumbers: true,
      },
      {
        from: "sbe20002.htm",
        to: "sbe20015.htm",
        prefix: "Kullavagga IV, ",
        indexUrl: `${SBE}/bud/sbe20/index.htm`,
        printedChapterNumbers: true,
      },
      {
        from: "sbe20016.htm",
        to: "sbe20052.htm",
        prefix: "Kullavagga V, ",
        indexUrl: `${SBE}/bud/sbe20/index.htm`,
        printedChapterNumbers: true,
      },
      {
        from: "sbe20053.htm",
        to: "sbe20073.htm",
        prefix: "Kullavagga VI, ",
        indexUrl: `${SBE}/bud/sbe20/index.htm`,
        printedChapterNumbers: true,
      },
      {
        from: "sbe20074.htm",
        to: "sbe20078.htm",
        prefix: "Kullavagga VII, ",
        indexUrl: `${SBE}/bud/sbe20/index.htm`,
        printedChapterNumbers: true,
      },
      {
        from: "sbe20079.htm",
        to: "sbe20086.htm",
        prefix: "Kullavagga VIII, ",
        indexUrl: `${SBE}/bud/sbe20/index.htm`,
        printedChapterNumbers: true,
      },
      {
        from: "sbe20087.htm",
        to: "sbe20091.htm",
        prefix: "Kullavagga IX, ",
        indexUrl: `${SBE}/bud/sbe20/index.htm`,
        printedChapterNumbers: true,
      },
      {
        from: "sbe20092.htm",
        to: "sbe20118.htm",
        prefix: "Kullavagga X, ",
        indexUrl: `${SBE}/bud/sbe20/index.htm`,
        printedChapterNumbers: true,
      },
      {
        from: "sbe20119.htm",
        to: "sbe20119.htm",
        prefix: "Kullavagga XI, ",
        indexUrl: `${SBE}/bud/sbe20/index.htm`,
        printedChapterNumbers: true,
      },
      {
        from: "sbe20120.htm",
        to: "sbe20121.htm",
        prefix: "Kullavagga XII, ",
        indexUrl: `${SBE}/bud/sbe20/index.htm`,
        printedChapterNumbers: true,
      },
    ],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture", "religious_law_practice"],
    editionNote: "chapter and paragraph index; each chapter is one printed page of the translation",
    labelOverrides: {
      "sbe1303.htm": "Patimokkha · Nidāna",
      "sbe1304.htm": "Patimokkha · The Pārājika Rules",
      "sbe1305.htm": "Patimokkha · The Saṃghādisesa Rules",
      "sbe1306.htm": "Patimokkha · The Aniyata Rules",
      "sbe1307.htm": "Patimokkha · The Nissaggiya Pācittiya Rules",
      "sbe1308.htm": "Patimokkha · The Pācittiya Rules",
      "sbe1309.htm": "Patimokkha · The Pāṭidesanīya Rules",
      "sbe1310.htm": "Patimokkha · The Sekhiya Rules",
      "sbe1311.htm": "Patimokkha · The Adhikaraṇa-samatha Rules",
      "sbe17099.htm": "Mahavagga VIII, Chapter 32 and Mahavagga IX, Chapter 1",
    },
  },
  {
    slug: "jataka",
    title: "The Jataka",
    originalTitle: "",
    transliteration: "Jātaka",
    altTitles: ["Jātaka", "The Jataka, or Stories of the Buddha's Former Births", "Birth Stories"],
    tradition: "buddhism",
    school: "theravada",
    genre: "Scripture",
    textType: "Birth stories with verse commentary",
    category: "Jataka",
    subcategory: "Khuddaka Nikāya",
    originalLanguage: "pi",
    dateStart: -300,
    dateEnd: 500,
    dateDisplay: "Verses c. 3rd century BCE; prose commentary c. 5th century CE",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The Jātaka verses are anonymous and belong to the oldest strata of the Pali canon; the prose stories that frame them were composed later and are traditionally ascribed to Buddhaghosa's commentary. The collection as translated here is the work of the editors of the Cambridge edition, not of a single author.",
    description:
      "The Jataka is the great storybook of Buddhism: 547 tales of the Buddha's former births, from the hare that offered itself to a hungry brahmin to the long Vessantara story of the prince who gave away everything he had. Each story is told as an occasion in the Buddha's life, followed by the verses it illustrates and an identification of the characters as earlier and later births. The collection preserves a vast range of Indian narrative — animal fables, farce, romance, legal puzzles and the Bodhisatta's gradual perfection of generosity, virtue and wisdom.",
    historicalContext:
      "The Jātaka belongs to the Khuddaka Nikāya of the Pali canon; its verses are among the oldest Buddhist poetry, while the prose commentary was compiled in Sri Lanka and is traditionally attributed to Buddhaghosa (5th century CE). E. B. Cowell edited the six-volume English translation (1895–1907), with Robert Chalmers, W. H. D. Rouse, H. T. Francis and R. A. Neil translating the several volumes.",
    availabilityNote:
      "Complete. All 547 stories in the six volumes of Cowell's edition are streamed from the Internet Sacred Text Archive at read time, one story per chapter, in the printed order of the collection from No. 1 to No. 547. The volumes' prefaces, contents lists and indexes of names are not part of the work; the stories themselves include the verses, the prose frame and the identification of the characters.",
    translator: "E. B. Cowell (editor), with Robert Chalmers, W. H. D. Rouse, H. T. Francis and R. A. Neil",
    translationTitle: "The Jataka, or Stories of the Buddha's Former Births",
    translationYear: 1907,
    volume: "The Jataka, 6 vols. (Cambridge, 1895–1907)",
    indexUrl: `${SBE}/bud/j1/index.htm`,
    ranges: [
      { from: "j1004.htm", to: "j1153.htm" },
      { from: "j2004.htm", to: "j2153.htm", indexUrl: `${SBE}/bud/j2/index.htm` },
      { from: "j3002.htm", to: "j3139.htm", indexUrl: `${SBE}/bud/j3/index.htm` },
      { from: "j4003.htm", to: "j4074.htm", indexUrl: `${SBE}/bud/j4/index.htm` },
      { from: "j5004.htm", to: "j5030.htm", indexUrl: `${SBE}/bud/j5/index.htm` },
      { from: "j6004.htm", to: "j6013.htm", indexUrl: `${SBE}/bud/j6/index.htm` },
    ],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture"],
    editionNote: "chapter and paragraph index; each chapter is one printed jataka",
    labelOverrides: {
      // The index prints "No. 3841" and "Jātaba"; the page itself is headed
      // "No. 384. DHAMMADDHAJA-JĀTABA".
      "j3085.htm": "No. 384. Dhammaddhaja-Jātaka",
    },
  },
  {
    slug: "samaveda",
    title: "Hymns of the Samaveda",
    originalTitle: "सामवेद",
    transliteration: "Sāmaveda",
    altTitles: ["The Sāmaveda", "Samaveda Samhita", "Sama Veda"],
    tradition: "hinduism",
    school: "",
    genre: "Scripture",
    textType: "Liturgical chant collection",
    category: "Veda",
    subcategory: "Samaveda",
    originalLanguage: "sa",
    dateStart: -1200,
    dateEnd: -800,
    dateDisplay: "c. 1200–800 BCE (the collection is older than its surviving schools)",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The Samaveda has no single author. Its verses are drawn almost entirely from the Rigveda and arranged for sung ritual, with the Soma sacrifice at the centre; the melodies were transmitted orally and are not fully recoverable from the printed text.",
    description:
      "The Samaveda is the Veda of chant. Its verses, most of them Rigvedic, are set out in the order the Udgatri priest sings them at the Soma sacrifice, grouped into decades and books with the melodies' names noted. Griffith's translation gives the hymns in their liturgical order with a popular commentary, so the collection reads as a handbook of Vedic ritual song rather than as a sequence of poems.",
    historicalContext:
      "The Samaveda as it survives belongs to the Kauthuma and Ranayaniya schools and is the basis of the later Samavedic chant traditions of Gujarat, Maharashtra and South India. Ralph T. H. Griffith published this translation with a popular commentary in 1895; it remains the standard complete English rendering of the collection.",
    availabilityNote:
      "Complete. Griffith's translation and commentary are streamed from the Internet Sacred Text Archive at read time; the archive serves the work as one page, so the library splits it at the fifteen printed books — First Part, Books I–VI, and Second Part, Books I–IX — and serves one book per chapter. The volume's preface and the running commentary printed with the hymns are part of the page.",
    translator: "Ralph T. H. Griffith",
    translationTitle: "Hymns of the Samaveda",
    translationYear: 1895,
    volume: "Hymns of the Samaveda, translated with a popular commentary",
    indexUrl: `${SBE}/hin/sv.htm`,
    ranges: [{ from: "sv.htm", to: "sv.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture", "prayer_liturgy"],
    editionNote: "book and paragraph index; each chapter is one printed book of the collection",
    singlePage: { splitHeading: 2, partHeading: 1, skip: ["PREFACE"] },
  },
  {
    slug: "vedic-reader",
    title: "A Vedic Reader for Students",
    originalTitle: "",
    transliteration: "Rgveda-pāṭha",
    altTitles: ["A Vedic Reader", "Macdonell's Vedic Reader"],
    tradition: "hinduism",
    school: "",
    genre: "Anthology",
    textType: "Selected hymns with introduction and notes",
    category: "Veda",
    subcategory: "Rigveda",
    originalLanguage: "sa",
    dateStart: -1500,
    dateEnd: -1000,
    dateDisplay: "Hymns composed c. 1500–1000 BCE; the reader published 1917",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The hymns are anonymous. The selection, the introduction and the grammatical and explanatory notes are Arthur Anthony Macdonell's, written for students beginning Sanskrit and Vedic poetry.",
    description:
      "Macdonell's reader introduces the Rigveda through thirty hymns chosen to illustrate its gods, its style and its thought, headed by the deities addressed — Agni, Indra, the Maruts, Varuna, Ushas, the funeral hymns, the gambler and the hymn of creation. An introductory essay on age, arrangement, language, metre and religion, and a glossary, make the volume a compact course in Vedic poetry rather than a complete translation.",
    historicalContext:
      "Arthur Anthony Macdonell (1854–1930) was Boden Professor of Sanskrit at Oxford and one of the editors of the Vedic index. His reader, first published in 1917, trained several generations of Sanskritists and is still used for the study of Vedic grammar and metre.",
    availabilityNote:
      "Complete as published: the introduction, thirty selected hymns with notes and the glossary, streamed from the Internet Sacred Text Archive at read time. The archive serves the reader as one page, so the library splits it at the printed headings — the introduction's ten sections and each hymn — and serves one heading per chapter. This is a selection from the Rigveda, not the whole collection.",
    translator: "Arthur Anthony Macdonell",
    translationTitle: "A Vedic Reader for Students",
    translationYear: 1917,
    volume: "A Vedic Reader for Students",
    indexUrl: `${SBE}/hin/vedaread.htm`,
    ranges: [{ from: "vedaread.htm", to: "vedaread.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture", "academic_scholarship"],
    editionNote: "heading and paragraph index; each chapter is one introductory section or one selected hymn",
    singlePage: { splitHeading: 1, startMarker: "<H1 ALIGN=\"CENTER\">INTRODUCTION", skip: ["PREFACE"] },
  },
  {
    slug: "white-yajurveda",
    title: "The Texts of the White Yajurveda",
    originalTitle: "शुक्लयजुर्वेद",
    transliteration: "Śukla Yajurveda (Vājasaneyi Saṃhitā)",
    altTitles: ["Vajasaneyi Samhita", "White Yajurveda", "Shukla Yajurveda"],
    tradition: "hinduism",
    school: "",
    genre: "Scripture",
    textType: "Liturgical formulae and prose",
    category: "Veda",
    subcategory: "Yajurveda",
    originalLanguage: "sa",
    dateStart: -1200,
    dateEnd: -800,
    dateDisplay: "c. 1200–800 BCE",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The Vajasaneyi Samhita is anonymous. Tradition associates its arrangement with the sage Yajnavalkya; the text itself is the liturgical corpus of the White Yajurveda school.",
    description:
      "The White Yajurveda is the Vajasaneyi Samhita, the collection of formulae spoken by the Adhvaryu priest at the soma and animal sacrifices, with the verses of the Rigveda embedded in its prose. Unlike the Black Yajurveda, it separates the samhita from the Brahmana: the formulas are given here in forty books, from the new- and full-moon offerings through the Agnihotra, the soma sacrifice and the horse sacrifice to the Purusha hymn and the final expiation rites.",
    historicalContext:
      "The Vajasaneyi Samhita survives in the Madhyandina and Kanva recensions; Griffith translates the Madhyandina text. His translation of 1899 was the first complete English rendering of the White Yajurveda and remains the standard public-domain one.",
    availabilityNote:
      "Complete. All forty books of Griffith's translation are streamed from the Internet Sacred Text Archive at read time, one book per chapter. The volume's preface, contents and the index of Rigvedic and Atharvan verses are not part of the work.",
    translator: "Ralph T. H. Griffith",
    translationTitle: "The Texts of the White Yajurveda",
    translationYear: 1899,
    volume: "The Texts of the White Yajurveda",
    indexUrl: `${SBE}/hin/wyv/index.htm`,
    ranges: [{ from: "wyvbk01.htm", to: "wyvbk40.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture", "prayer_liturgy"],
    editionNote: "book and paragraph index; each chapter is one printed book",
  },
  {
    slug: "atharvaveda",
    title: "The Hymns of the Atharvaveda",
    originalTitle: "अथर्ववेद",
    transliteration: "Atharvaveda",
    altTitles: ["Atharva Veda", "Atharvaveda Samhita"],
    tradition: "hinduism",
    school: "",
    genre: "Scripture",
    textType: "Hymns and charms",
    category: "Veda",
    subcategory: "Atharvaveda",
    originalLanguage: "sa",
    dateStart: -1200,
    dateEnd: -800,
    dateDisplay: "c. 1200–800 BCE (with later material in Books XIX–XX)",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The Atharvaveda is anonymous and composite. Its hymns are the work of the Atharvan and Angirasa priestly families, and Books XIX and XX contain later additions drawn partly from the Rigveda.",
    description:
      "The Atharvaveda is the fourth Veda and the least liturgical of them: a collection of charms, exorcisms, prayers for health, prosperity and victory, speculative hymns on brahman, time and the primordial giant, and the great funeral and marriage rites. It preserves a side of Vedic religion that the Rigveda barely shows — the everyday fears and hopes of householders, and the specialist knowledge of the healing and sorcery priest.",
    historicalContext:
      "The collection survives in the Saunaka and Paippalada recensions; Griffith translates the Saunaka text in twenty books. His two-volume translation of 1895–96 was the first complete English rendering and remains the standard public-domain one; the archive serves the twenty books as twenty pages.",
    availabilityNote:
      "Complete. All twenty books of Griffith's translation are streamed from the Internet Sacred Text Archive at read time, one book per chapter. The volume's preface and errata are not part of the work.",
    translator: "Ralph T. H. Griffith",
    translationTitle: "The Hymns of the Atharvaveda",
    translationYear: 1895,
    volume: "The Hymns of the Atharvaveda, 2 vols.",
    indexUrl: `${SBE}/hin/av/index.htm`,
    ranges: [{ from: "avbook01.htm", to: "avbook20.htm", contents: true }],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture", "prayer_liturgy"],
    editionNote: "book and paragraph index; each chapter is one printed book",
  },
  {
    slug: "atharva-veda-hymns",
    title: "Hymns of the Atharva-Veda (SBE 42)",
    originalTitle: "अथर्ववेद",
    transliteration: "Atharvaveda",
    altTitles: ["Atharva-Veda Sanhita (Bloomfield)", "Sacred Books of the East, vol. 42"],
    tradition: "hinduism",
    school: "",
    genre: "Scripture",
    textType: "Selected hymns with notes",
    category: "Veda",
    subcategory: "Atharvaveda",
    originalLanguage: "sa",
    dateStart: -1200,
    dateEnd: -800,
    dateDisplay: "c. 1200–800 BCE",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The hymns are anonymous. The selection, the translation and the explanatory notes are Maurice Bloomfield's, made for the Sacred Books of the East.",
    description:
      "Bloomfield's selection presents the Atharvaveda by subject rather than in the order of the printed collection: charms against fever and disease, spells for the healing of wounds and for protection in battle, hymns to the plants and to the earth, the great speculative hymns on brahman, time, life-breath and the primordial power, and the funeral and marriage formulae. The full translation and notes of SBE 42 make the volume the scholarly counterpart to Griffith's complete text.",
    historicalContext:
      "Maurice Bloomfield (1855–1928) was professor of Sanskrit at Johns Hopkins and one of the founders of Vedic philology in America. His translation appeared in 1897 as volume 42 of the Sacred Books of the East, with an introduction on the text and its religion and a body of notes drawing on the Kauśika Sutra and the commentary of Sayana.",
    availabilityNote:
      "Complete as published: the selected hymns with translation and notes, streamed from the Internet Sacred Text Archive at read time, one hymn per chapter. This is Bloomfield's selection for SBE 42, not the whole twenty-book collection; the complete text is the Griffith translation in this library.",
    translator: "Maurice Bloomfield",
    translationTitle: "Hymns of the Atharva-Veda",
    translationYear: 1897,
    volume: "Sacred Books of the East, vol. 42",
    indexUrl: `${SBE}/hin/sbe42/index.htm`,
    ranges: [{ from: "av002.htm", to: "av216.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture", "academic_scholarship"],
    editionNote: "hymn and paragraph index; each chapter is one hymn with its translation and notes",
  },
  {
    slug: "vedic-hymns-maruts",
    title: "Vedic Hymns, Part I: Hymns to the Maruts, Rudra, Vayu and Vata",
    originalTitle: "",
    transliteration: "Ṛgveda — Maruts, Rudra, Vāyu, Vāta",
    altTitles: ["Vedic Hymns I", "Sacred Books of the East, vol. 32"],
    tradition: "hinduism",
    school: "",
    genre: "Scripture",
    textType: "Hymns with translation and notes",
    category: "Veda",
    subcategory: "Rigveda",
    originalLanguage: "sa",
    dateStart: -1500,
    dateEnd: -1000,
    dateDisplay: "Hymns composed c. 1500–1000 BCE; translation published 1891",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The hymns are anonymous. The selection, translation, introduction and notes are F. Max Müller's, the first volume of his planned translation of the whole Rigveda for the Sacred Books of the East.",
    description:
      "The first volume of Müller's Vedic Hymns translates the Rigvedic hymns to the storm-gods and the winds: the Maruts, Rudra, Vayu and Vata, with the hymn to the unknown god that opens the selection. Müller's introductions and notes discuss the gods, the metres and the difficulties of the text, and the volume is as much a work of Vedic scholarship as a translation.",
    historicalContext:
      "Friedrich Max Müller (1823–1900) edited the Rigveda with Sayana's commentary and was the general editor of the Sacred Books of the East. This volume appeared in 1891 as SBE 32; his death left the projected complete translation unfinished, and SBE 46 continued the series with Oldenberg's hymns to Agni.",
    availabilityNote:
      "Complete as published: the introduction, the hymns to the Maruts, Rudra, Vayu and Vata with translation and notes, streamed from the Internet Sacred Text Archive at read time, one hymn per chapter. The volume's appendices, indexes and corrigenda are not part of the work.",
    translator: "F. Max Müller",
    translationTitle: "Vedic Hymns, Part I",
    translationYear: 1891,
    volume: "Sacred Books of the East, vol. 32",
    indexUrl: `${SBE}/hin/sbe32/index.htm`,
    ranges: [{ from: "sbe3215.htm", to: "sbe3263.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture", "academic_scholarship"],
    editionNote: "hymn and paragraph index; each chapter is one Rigvedic hymn",
  },
  {
    slug: "vedic-hymns-agni",
    title: "Vedic Hymns, Part II: Hymns to Agni",
    originalTitle: "",
    transliteration: "Ṛgveda — Agni",
    altTitles: ["Vedic Hymns II", "Sacred Books of the East, vol. 46"],
    tradition: "hinduism",
    school: "",
    genre: "Scripture",
    textType: "Hymns with translation and notes",
    category: "Veda",
    subcategory: "Rigveda",
    originalLanguage: "sa",
    dateStart: -1500,
    dateEnd: -1000,
    dateDisplay: "Hymns composed c. 1500–1000 BCE; translation published 1897",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The hymns are anonymous. The selection, translation and notes are Hermann Oldenberg's, continuing Max Müller's Vedic Hymns for the Sacred Books of the East.",
    description:
      "The second volume of Vedic Hymns translates the Rigvedic hymns to Agni, the priest of the sacrifice and the fire that carries the offering. Oldenberg's selection follows the god through the first book and beyond — the kindling and the invitation, the oblation, the household fire, the funeral pyre — with a philological introduction and notes on the text.",
    historicalContext:
      "Hermann Oldenberg (1854–1920) was one of the leading Vedic and Buddhist scholars of his generation, known for his work on the Rigveda, the Pali canon and Vedic religion. He completed the Vedic Hymns volume in 1897 as SBE 46.",
    availabilityNote:
      "Complete as published: the hymns to Agni with translation and notes, streamed from the Internet Sacred Text Archive at read time, one hymn per chapter. The volume's appendices, indexes and corrigenda are not part of the work.",
    translator: "Hermann Oldenberg",
    translationTitle: "Vedic Hymns, Part II",
    translationYear: 1897,
    volume: "Sacred Books of the East, vol. 46",
    indexUrl: `${SBE}/hin/sbe46/index.htm`,
    ranges: [{ from: "sbe46003.htm", to: "sbe46132.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture", "academic_scholarship"],
    editionNote: "hymn and paragraph index; each chapter is one Rigvedic hymn",
  },
  {
    slug: "thirty-minor-upanishads",
    title: "Thirty Minor Upanishads",
    originalTitle: "",
    transliteration: "Upaniṣad-saṃgraha",
    altTitles: ["Thirty Minor Upanishads", "Minor Upanishads"],
    tradition: "hinduism",
    school: "",
    genre: "Scripture",
    textType: "Upanishads",
    category: "Upanishad",
    subcategory: "Minor Upanishads",
    originalLanguage: "sa",
    dateStart: -400,
    dateEnd: 1200,
    dateDisplay: "c. 4th century BCE – 12th century CE",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The Upanishads are anonymous and belong to different Vedic schools; several of the texts here are sectarian and late, and their attribution to particular schools is traditional rather than historical.",
    description:
      "This collection gathers thirty shorter Upanishads, most of them concerned with yoga, renunciation and the disciplines of the ascetic life: the Mahanarayana and the Yogakundalini, the Amritabindu and the Dhyanabindu, the Sandilya and the Varaha, the Rama-tapaniya and the Narayana. Some are brief meditations on the syllable Om or the self; others are manuals of breath, posture and the inner sound. Together they show the range of the later Upanishadic literature beyond the twelve or thirteen principal texts.",
    historicalContext:
      "The minor Upanishads were composed over many centuries, most of them after the principal Upanishads and some as late as the medieval period; they belong to the Atharva, Yajur, Sama and Rigvedic schools. K. Narayanasvami Aiyar's English translation was published in 1914 and is the standard public-domain collection of these texts.",
    availabilityNote:
      "Complete. All thirty Upanishads of Aiyar's collection are streamed from the Internet Sacred Text Archive at read time, one Upanishad per chapter. The volume's title page, contents and index of proper names are not part of the work.",
    translator: "K. Narayanasvami Aiyar",
    translationTitle: "Thirty Minor Upanishads",
    translationYear: 1914,
    volume: "Thirty Minor Upanishads",
    indexUrl: `${SBE}/hin/tmu/index.htm`,
    ranges: [{ from: "tmu03.htm", to: "tmu32.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture", "mystical_contemplative"],
    editionNote: "Upanishad and paragraph index; each chapter is one Upanishad",
  },
  {
    slug: "sacred-laws-aryas-1",
    title: "The Sacred Laws of the Âryas, Part I: Âpastamba and Gautama",
    originalTitle: "",
    transliteration: "Āpastamba- and Gautama-dharmasūtra",
    altTitles: ["Sacred Laws of the Aryas I", "Sacred Books of the East, vol. 2"],
    tradition: "hinduism",
    school: "",
    genre: "Dharmasastra",
    textType: "Law sutras",
    category: "Dharmasastra",
    subcategory: "Dharmasutra",
    originalLanguage: "sa",
    dateStart: -600,
    dateEnd: -200,
    dateDisplay: "c. 6th–3rd centuries BCE",
    authorshipStatus: "traditional",
    author: "",
    attributionNote:
      "The sutras are ascribed to the sages Apastamba and Gautama and belong to their respective Vedic schools. They are cumulative school texts rather than the work of a single hand, and the surviving recensions are later than the names they carry.",
    description:
      "The two oldest surviving dharmasutras set out the whole of the twice-born householder's duty: the stages of life and the student's discipline, marriage and the rules of inheritance, the daily oblations and the ancestral rites, purity and food, the law of kings and witnesses, and the penances by which offences are expiated. Apastamba's sutras are the longer and more systematic; Gautama's are terser and often older in substance.",
    historicalContext:
      "The Dharmasutras are the prose forerunners of the metrical law books such as Manu, and they preserve the ritual and legal teaching of the Vedic schools of Apastamba and Gautama. Georg Bühler translated both for the Sacred Books of the East in 1879, with an introduction on the place of the texts in Indian law.",
    availabilityNote:
      "Complete. Apastamba's and Gautama's law sutras with Bühler's introductions and notes are streamed from the Internet Sacred Text Archive at read time, one printed chapter per chapter. The volume's title page, contents and index are not part of the work.",
    translator: "Georg Bühler",
    translationTitle: "The Sacred Laws of the Âryas, Part I",
    translationYear: 1879,
    volume: "Sacred Books of the East, vol. 2",
    indexUrl: `${SBE}/hin/sbe02/index.htm`,
    ranges: [{ from: "sbe0204.htm", to: "sbe0292.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["religious_law_practice", "historical_document"],
    editionNote: "chapter and paragraph index; each chapter is one printed chapter of the sutras",
  },
  {
    slug: "sacred-laws-aryas-2",
    title: "The Sacred Laws of the Âryas, Part II: Vâsishtha and Baudhâyana",
    originalTitle: "",
    transliteration: "Vasiṣṭha- and Baudhāyana-dharmasūtra",
    altTitles: ["Sacred Laws of the Aryas II", "Sacred Books of the East, vol. 14"],
    tradition: "hinduism",
    school: "",
    genre: "Dharmasastra",
    textType: "Law sutras",
    category: "Dharmasastra",
    subcategory: "Dharmasutra",
    originalLanguage: "sa",
    dateStart: -600,
    dateEnd: -100,
    dateDisplay: "c. 6th–2nd centuries BCE",
    authorshipStatus: "traditional",
    author: "",
    attributionNote:
      "The sutras are ascribed to the sages Vasishtha and Baudhayana and belong to their schools. Both texts are composite, and the Vasishtha recension in particular has absorbed later metrical material.",
    description:
      "The second volume of the Sacred Laws completes Bühler's dharmasutras with Vasishtha and Baudhayana. Vasishtha is a compact treatise in thirty chapters on the sources of law, the duties of the king, purity, women, inheritance, homicide and penance, much of it in verse and close in substance to Manu. Baudhayana is the longest of the dharmasutras, covering the sacred student's training, the householder's rites, the law of evidence and debt, and an elaborate system of penances.",
    historicalContext:
      "Vasishtha and Baudhayana stand at the end of the dharmasutra tradition and show the transition to the metrical smritis. Bühler's translation appeared in 1882 as SBE 14, completing the corpus of dharmasutras begun in SBE 2.",
    availabilityNote:
      "Complete. Vasishtha's and Baudhayana's law sutras with Bühler's introduction and notes are streamed from the Internet Sacred Text Archive at read time, one printed chapter (prasna) per chapter. The volume's title page, contents and index are not part of the work.",
    translator: "Georg Bühler",
    translationTitle: "The Sacred Laws of the Âryas, Part II",
    translationYear: 1882,
    volume: "Sacred Books of the East, vol. 14",
    indexUrl: `${SBE}/hin/sbe14/index.htm`,
    ranges: [{ from: "sbe1404.htm", to: "sbe1491.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["religious_law_practice", "historical_document"],
    editionNote: "chapter and paragraph index; each chapter is one printed chapter or prasna",
  },
  {
    slug: "institutes-of-vishnu",
    title: "The Institutes of Vishnu",
    originalTitle: "विष्णुस्मृति",
    transliteration: "Viṣṇu-smṛti",
    altTitles: ["Vishnu Smriti", "The Vishnu Dharmasastra"],
    tradition: "hinduism",
    school: "",
    genre: "Dharmasastra",
    textType: "Law code",
    category: "Dharmasastra",
    subcategory: "Smriti",
    originalLanguage: "sa",
    dateStart: 100,
    dateEnd: 600,
    dateDisplay: "c. 2nd–6th century CE",
    authorshipStatus: "traditional",
    author: "",
    attributionNote:
      "The code presents itself as the teaching of Vishnu, and its verses are attributed to him throughout. Its actual composition is anonymous, and the surviving text is a compilation of earlier dharmasutra material in metrical form.",
    description:
      "The Vishnu Smriti is one of the major metrical law books, arranged in a hundred short chapters. It treats the sources of dharma and the conduct of the king, the duties of the four classes and the stages of life, impurity and mourning, the rites for the dead, the law of witnesses and ordeals, and a long series of penances. It is also a ritual handbook: its descriptions of expiatory vows and of the yogic disciplines of the dying are among the most distinctive in the legal literature.",
    historicalContext:
      "The Vishnu Smriti is later than Manu and draws on the dharmasutras, while its chapter on the self's departure through the veins and the sacred syllables shows the growing influence of yogic and devotional thought on law. Julius Jolly translated it in 1880 as SBE 7, with an introduction and comparative notes.",
    availabilityNote:
      "Complete. All hundred chapters of Jolly's translation are streamed from the Internet Sacred Text Archive at read time, one chapter per chapter. The volume's title page, contents, introduction and index are not part of the work.",
    translator: "Julius Jolly",
    translationTitle: "The Institutes of Vishnu",
    translationYear: 1880,
    volume: "Sacred Books of the East, vol. 7",
    indexUrl: `${SBE}/hin/sbe07/index.htm`,
    ranges: [{ from: "sbe07003.htm", to: "sbe07102.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["religious_law_practice", "historical_document"],
    editionNote: "chapter and paragraph index; each chapter is one printed chapter",
  },
  {
    slug: "minor-law-books",
    title: "The Minor Law Books: Nârada and Brihaspati",
    originalTitle: "",
    transliteration: "Nārada- and Bṛhaspati-smṛti",
    altTitles: ["The Minor Law Books", "Sacred Books of the East, vol. 33"],
    tradition: "hinduism",
    school: "",
    genre: "Dharmasastra",
    textType: "Law code",
    category: "Dharmasastra",
    subcategory: "Smriti",
    originalLanguage: "sa",
    dateStart: 100,
    dateEnd: 700,
    dateDisplay: "c. 2nd–7th century CE",
    authorshipStatus: "traditional",
    author: "",
    attributionNote:
      "The treatises are ascribed to the sages Narada and Brihaspati. Both are anonymous compilations of earlier legal material, and the Brihaspati text survives only in the form reconstructed by its editors.",
    description:
      "The Minor Law Books present the classical Hindu law of procedure. Narada, in eighteen chapters, is almost entirely concerned with courts and disputes: the judge and the assessors, plaints and answers, the burden of proof, documents, witnesses, ordeals, and the law of deposit, loans, partnership, wages, sale, boundaries, defamation and assault. Brihaspati, recovered fragmentarily, covers the same ground and adds a distinctive treatise on the duties of the king and the administration of justice.",
    historicalContext:
      "Narada and Brihaspati belong to the later smriti period, when the legal process itself rather than ritual duty became the central subject of the texts. Julius Jolly translated them in 1889 as SBE 33; his introduction reconstructs the relation between the two treatises and the earlier schools.",
    availabilityNote:
      "Complete as published. Narada's eighteen chapters and the recovered text of Brihaspati are streamed from the Internet Sacred Text Archive at read time, one printed chapter per chapter. The volume's introduction, abbreviations and addenda are not part of the work.",
    translator: "Julius Jolly",
    translationTitle: "The Minor Law Books",
    translationYear: 1889,
    volume: "Sacred Books of the East, vol. 33",
    indexUrl: `${SBE}/hin/sbe33/index.htm`,
    ranges: [{ from: "sbe3305.htm", to: "sbe3385.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["religious_law_practice", "historical_document"],
    editionNote: "chapter and paragraph index; each chapter is one printed chapter",
  },
  {
    slug: "grihya-sutras-1",
    title: "The Grihya Sutras, Part I: Sânkhâyana and Âsvalâyana",
    originalTitle: "",
    transliteration: "Śāṅkhāyana- and Āśvalāyana-gṛhyasūtra",
    altTitles: ["Grihya Sutras I", "Sacred Books of the East, vol. 29"],
    tradition: "hinduism",
    school: "",
    genre: "Kalpa",
    textType: "Domestic ritual sutras",
    category: "Kalpa",
    subcategory: "Grihya Sutra",
    originalLanguage: "sa",
    dateStart: -600,
    dateEnd: -200,
    dateDisplay: "c. 6th–3rd centuries BCE",
    authorshipStatus: "traditional",
    author: "",
    attributionNote:
      "The sutras are ascribed to the teachers Sankhayana and Asvalayana and belong to their Vedic schools. They are school texts, transmitting ritual practice rather than the work of a single author.",
    description:
      "The Grihya Sutras are the manuals of the householder's ritual: the domestic fire and its daily offerings, the initiation of the student, betrothal and marriage, the birth and naming of children, the first feeding and the tonsure, the offerings to the ancestors, the rules of hospitality and the ceremonies of the seasons. Sankhayana and Asvalayana are the two surviving sutras of the Rigvedic schools, and their texts are the fullest account of the private religion of the Vedic household.",
    historicalContext:
      "The grihya sutras form one branch of the Kalpa, the Vedic literature of ritual, alongside the srauta sutras for the great public sacrifices. Hermann Oldenberg translated the Sankhayana and Asvalayana texts for the Sacred Books of the East in 1886, with an introduction on the place of domestic ritual in Vedic religion.",
    availabilityNote:
      "Complete. All four adhyayas of Sankhayana and the four of Asvalayana are streamed from the Internet Sacred Text Archive at read time, one printed section per chapter. The volume's title page, contents and introduction are not part of the work.",
    translator: "Hermann Oldenberg",
    translationTitle: "The Grihya Sutras, Part I",
    translationYear: 1886,
    volume: "Sacred Books of the East, vol. 29",
    indexUrl: `${SBE}/hin/sbe29/index.htm`,
    ranges: [{ from: "sbe29003.htm", to: "sbe29226.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["prayer_liturgy", "religious_law_practice"],
    editionNote: "section and paragraph index; each chapter is one printed section of the sutras",
  },
  {
    slug: "grihya-sutras-2",
    title: "The Grihya Sutras, Part II: Gobhila, Hiraṇyakeśin and Âpastamba",
    originalTitle: "",
    transliteration: "Gobhila-, Hiraṇyakeśin- and Āpastamba-gṛhyasūtra",
    altTitles: ["Grihya Sutras II", "Sacred Books of the East, vol. 30"],
    tradition: "hinduism",
    school: "",
    genre: "Kalpa",
    textType: "Domestic ritual sutras",
    category: "Kalpa",
    subcategory: "Grihya Sutra",
    originalLanguage: "sa",
    dateStart: -600,
    dateEnd: -100,
    dateDisplay: "c. 6th–2nd centuries BCE",
    authorshipStatus: "traditional",
    author: "",
    attributionNote:
      "The sutras are ascribed to Gobhila, Hiranyakesin and Apastamba and belong to the Sama and Yajur Vedic schools. They are cumulative school texts, not the work of one author.",
    description:
      "The second volume of the Grihya Sutras carries the domestic ritual of the Sama and Yajur schools: Gobhila's manual of the Sama Veda, Hiranyakesin's and Apastamba's sutras of the Black Yajurveda, and the short Yajnaparibhasha-sutras on the order of the sacrifice. Marriage, the daily and seasonal offerings, the rites of the ancestors and the expiations for ritual error are set out in their school variants, so the volume shows how far practice differed between Vedic traditions.",
    historicalContext:
      "Oldenberg completed his translation of the domestic ritual in 1892 as SBE 30, adding the Sama Vedic Gobhila and the Yajurvedic Hiranyakesin and Apastamba to the Rigvedic texts of SBE 29. The volume remains the standard English rendering of these sutras.",
    availabilityNote:
      "Complete. Gobhila, Hiranyakesin and Apastamba's grihya sutras with the Yajnaparibhasha-sutras are streamed from the Internet Sacred Text Archive at read time, one printed section per chapter. The volume's title page, contents, introduction and index are not part of the work.",
    translator: "Hermann Oldenberg",
    translationTitle: "The Grihya Sutras, Part II",
    translationYear: 1892,
    volume: "Sacred Books of the East, vol. 30",
    indexUrl: `${SBE}/hin/sbe30/index.htm`,
    ranges: [{ from: "sbe30004.htm", to: "sbe30125.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["prayer_liturgy", "religious_law_practice"],
    editionNote: "section and paragraph index; each chapter is one printed section of the sutras",
  },
  {
    slug: "udana",
    title: "The Udāna",
    originalTitle: "उदान",
    transliteration: "Udāna",
    altTitles: ["The Solemn Utterances of the Buddha", "Udana"],
    tradition: "buddhism",
    school: "theravada",
    genre: "Scripture",
    textType: "Inspired utterances",
    category: "Sutta",
    subcategory: "Khuddaka Nikāya",
    originalLanguage: "pi",
    dateStart: -300,
    dateEnd: -100,
    dateDisplay: "Verses c. 3rd–2nd century BCE; commentary c. 5th century CE",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The Udāna is a canonical collection without an author. Its eighty discourses are ascribed to the Buddha and were assembled by the early Buddhist community; the verse at the end of each discourse is the udāna, the solemn utterance that gives the book its name.",
    description:
      "The Udāna gathers eighty short discourses in eight chapters, each closing with a verse the Buddha is said to have spoken on that occasion. The subjects are the whole range of the early teaching: the chain of dependent origination under the Bodhi tree, the monk who cannot be shaken by Māra, the leper Suppabuddha, the quarrelsome monks of Kosambī, the blind men and the elephant, and the Buddha's refusal to name a successor. It is one of the most quoted books of the Pali canon, and its stories are among the oldest surviving Buddhist narratives.",
    historicalContext:
      "The Udāna belongs to the Khuddaka Nikāya, the miscellaneous collection of the Pali canon, and its oldest verses go back to the oral period. Major-General G. M. Strong's translation, published in London in 1902, was the first complete English Udāna and remains the version the archive carries, with the translator's notes on Pali terms and on the commentarial tradition.",
    availabilityNote:
      "Complete. All eight chapters and eighty discourses of Strong's translation are streamed from the Internet Sacred Text Archive at read time, one chapter (vagga) per chapter. The volume's title page, preface and introduction are not part of the work; the footnotes printed on each page are kept.",
    translator: "G. M. Strong",
    translationTitle: "The Udāna, or The Solemn Utterances of the Buddha",
    translationYear: 1902,
    volume: "Luzac & Co., London",
    indexUrl: `${SBE}/bud/udn/index.htm`,
    ranges: [{ from: "udn1.htm", to: "udn8.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture"],
    editionNote: "chapter and paragraph index; each chapter is one printed vagga",
  },
  {
    slug: "therigatha",
    title: "Psalms of the Sisters (Therīgāthā)",
    originalTitle: "थेरीगाथा",
    transliteration: "Therīgāthā",
    altTitles: ["Therigatha", "Psalms of the Sisters", "Verses of the Elder Nuns"],
    tradition: "buddhism",
    school: "theravada",
    genre: "Scripture",
    textType: "Verses of the elder nuns",
    category: "Sutta",
    subcategory: "Khuddaka Nikāya",
    originalLanguage: "pi",
    dateStart: -300,
    dateEnd: -100,
    dateDisplay: "Verses c. 3rd–2nd century BCE; commentary c. 5th century CE",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "The Therīgāthā is a collection of verses by many named nuns, from the Buddha's wife and his former nurses to women who joined the order late in life. The poems were transmitted orally and gathered by the community; the prose introductions that frame each poem in this edition come from the commentarial tradition.",
    description:
      "The Therīgāthā is the earliest surviving anthology of women's religious poetry in any language: seventy-three poems, arranged by length from single verses to the long songs of the great chapter, in which the first Buddhist nuns describe their going forth, their struggles with grief, family and desire, and the freedom they found. The voices are distinct — Paṭācārā who lost her family, Kisāgotamī with the mustard seed, the former courtesan Ambapālī, the aged Sundarī — and the collection is the principal source for the religious lives of women in early Buddhism.",
    historicalContext:
      "The verses belong to the Khuddaka Nikāya and are traditionally paired with the Theragāthā, the poems of the monks. Caroline Rhys Davids translated them for the Pali Text Society in 1909 under the title Psalms of the Sisters, with an introduction on the position of women in early Buddhism; her translation, and the commentary she drew on, remain the standard English access to the collection.",
    availabilityNote:
      "Complete. All sixteen cantos of Rhys Davids's translation are streamed from the Internet Sacred Text Archive at read time, one canto per chapter. The cantos group the poems by the number of verses they contain, so a chapter holds many nuns' poems; the volume's dedication, contents, introduction and index are not part of the work.",
    translator: "C. A. F. Rhys Davids",
    translationTitle: "Psalms of the Sisters",
    translationYear: 1909,
    volume: "Pali Text Society",
    indexUrl: `${SBE}/bud/pos/index.htm`,
    ranges: [{ from: "pos06.htm", to: "pos21.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture"],
    editionNote: "canto and paragraph index; each chapter is one printed canto",
  },
  {
    slug: "buddhacarita",
    title: "A Life of Buddha (Buddhacarita)",
    originalTitle: "बुद्धचरित",
    transliteration: "Buddhacarita",
    altTitles: ["The Fo-Sho-Hing-Tsan-King", "Life of Buddha", "Buddhacarita"],
    tradition: "buddhism",
    school: "",
    genre: "Epic poetry",
    textType: "Verse biography of the Buddha",
    category: "Mahayana",
    subcategory: "Buddha biography",
    originalLanguage: "sa",
    dateStart: 100,
    dateEnd: 200,
    dateDisplay: "c. 2nd century CE",
    authorshipStatus: "established",
    author: "asvaghosha",
    attributionNote:
      "The Buddhacarita is ascribed to Aśvaghoṣa, the poet and dramatist of the early Kuṣāṇa period. The Sanskrit original survives only for the first half; this translation is Beal's English rendering of the Chinese version made by Dharmarakṣa in 420 CE, which preserves all twenty-eight chapters.",
    description:
      "Aśvaghoṣa's Life of the Buddha is the great Buddhist epic: the birth at Lumbinī, the palace years and the four sights, the departure from the city, the years of austerity, the defeat of Māra and the enlightenment, the first sermon, the conversion of the disciples and the Buddha's final extinction. Written in the polished Sanskrit of the kāvya court poets, it turns the Buddha's biography into a meditation on impermanence and kingship, and its Chinese version made it one of the most influential narratives in East Asian Buddhism.",
    historicalContext:
      "Aśvaghoṣa wrote at the court of Kaniṣka in the 2nd century CE, and the Buddhacarita is the earliest complete Buddhist biography in classical Sanskrit. Dharmarakṣa's Chinese translation of 420 CE, the Fo-Sho-Hing-Tsan-King, was rendered into English by Samuel Beal for the Sacred Books of the East in 1883; Beal's version, with its notes on the Sanskrit and Chinese readings, is the text streamed here.",
    availabilityNote:
      "Complete. All twenty-eight vargas of Beal's translation are streamed from the Internet Sacred Text Archive at read time, one varga per chapter. The volume's title page, contents, introduction and index are not part of the work; the translator's notes on each page are kept.",
    translator: "Samuel Beal",
    translationTitle: "The Fo-Sho-Hing-Tsan-King: A Life of Buddha by Aśvaghoṣa Bodhisattva",
    translationYear: 1883,
    volume: "Sacred Books of the East, vol. 19",
    indexUrl: `${SBE}/bud/sbe19/index.htm`,
    ranges: [{ from: "sbe1903.htm", to: "sbe1930.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["non_canonical_religious_text", "historical_document"],
    editionNote: "varga and paragraph index; each chapter is one printed varga",
  },
  {
    slug: "bodhicaryavatara",
    title: "The Path of Light (Bodhicaryāvatāra)",
    originalTitle: "बोधिचर्यावतार",
    transliteration: "Bodhicaryāvatāra",
    altTitles: ["Bodhicaryavatara", "A Guide to the Bodhisattva's Way of Life", "The Path of Light"],
    tradition: "buddhism",
    school: "",
    genre: "Poetry",
    textType: "Verse treatise on the bodhisattva path",
    category: "Mahayana",
    subcategory: "Bodhicaryāvatāra",
    originalLanguage: "sa",
    dateStart: 700,
    dateEnd: 800,
    dateDisplay: "c. 8th century CE",
    authorshipStatus: "established",
    author: "shantideva",
    attributionNote:
      "The Bodhicaryāvatāra is the work of Śāntideva, the Nālandā monk and poet of the 8th century. It is preserved in Sanskrit and in Tibetan translation, where it became the standard verse treatise on the bodhisattva's vow.",
    description:
      "Śāntideva's guide to the bodhisattva's way begins with praise of the awakening mind and the confession of faults, and then works through the cultivation of that mind: heedfulness, watchfulness, patience under injury, energetic effort, meditative concentration, and the perfection of wisdom. Its eighth chapter contains the famous meditation on the equality of self and other, and its ninth sets out the Madhyamaka analysis of persons and phenomena. Barnett's nine chapters are a compact rendering of one of the most read devotional poems of Mahayana Buddhism.",
    historicalContext:
      "Śāntideva taught at Nālandā in the 8th century, and the Bodhicaryāvatāra entered Tibet with the first wave of Indian Buddhist translation, where it anchored the lojong literature on exchanging self and other. L. D. Barnett's translation appeared in the Wisdom of the East series in 1909 and was the first English version of the work; it renders nine of the ten Sanskrit chapters, the tenth being the dedication.",
    availabilityNote:
      "Barnett's translation in nine chapters is complete as published; the Sanskrit tenth chapter, a dedication of merit, is not part of his selection and is not included. The chapters are streamed from the Internet Sacred Text Archive at read time, one chapter per chapter. The volume's editorial note, introduction, notes and appendix are not part of the work.",
    translator: "L. D. Barnett",
    translationTitle: "The Path of Light: Rendered for the First Time into English from the Bodhicharyāvatāra of Śānti-Deva",
    translationYear: 1909,
    volume: "The Wisdom of the East",
    indexUrl: `${SBE}/bud/tpol/index.htm`,
    ranges: [{ from: "tpol04.htm", to: "tpol12.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["philosophical_work", "mystical_contemplative"],
    editionNote: "chapter and paragraph index; each chapter is one printed chapter",
  },
  {
    slug: "apostolic-fathers",
    title: "The Apostolic Fathers",
    originalTitle: "",
    transliteration: "Patres apostolici",
    altTitles: ["The Apostolic Fathers with Justin Martyr and Irenaeus", "Ante-Nicene Fathers, vol. 1"],
    tradition: "christianity",
    school: "patristics",
    genre: "Patristic literature",
    textType: "Letters, exhortations and a martyrdom",
    category: "Patristic theology",
    subcategory: "",
    originalLanguage: "grc",
    dateStart: 90,
    dateEnd: 140,
    dateDisplay: "c. 90–140 CE",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "The Apostolic Fathers is a modern collection, not a single book: Clement of Rome's letter to the Corinthians, the letter to Diognetus, Polycarp's letter to the Philippians and the account of his martyrdom, the seven letters of Ignatius of Antioch, the letter of Barnabas and the fragments of Papias. Their authors are named by the manuscripts and the tradition, and the collection itself was assembled by 17th-century editors.",
    description:
      "The Apostolic Fathers are the Christian writings closest to the New Testament: a letter from the church of Rome to Corinth written before the end of the first century, the letters Ignatius wrote on his way to martyrdom at Rome, Polycarp's instructions to a divided congregation and the eyewitness account of his death, the allegorical letter of Barnabas, the apologetic address to Diognetus, and the fragments of Papias on the origins of the Gospels. They show the churches finding their institutions, their creeds and their relation to Judaism in the generation after the apostles.",
    historicalContext:
      "The collection stands between the apostolic age and the great patristic writers. Clement writes in the aftermath of a Corinthian quarrel, Ignatius in the last weeks of his life under Trajan, and Papias records traditions about Mark and Matthew that the later church preserved. The texts are translated in the Ante-Nicene Fathers, the 1885 Edinburgh series edited by Alexander Roberts and James Donaldson, from the Greek except where only a Latin or Syriac version survives.",
    availabilityNote:
      "The archive's transcription of the Apostolic Fathers is complete for the documents it carries: 1 Clement, Diognetus, Polycarp, the Martyrdom of Polycarp, the seven letters of Ignatius, Barnabas and the fragments of Papias, read as one continuous outline with each document prefixed to its chapter labels. Two omissions are the source's: 2 Clement is not in this transcription, and the Syriac recensions and the spurious Ignatian letters printed later in the volume are not included here. Each Ignatian chapter prints the shorter and the longer Latin recension together, as the printed volume does.",
    translator: "Alexander Roberts and James Donaldson",
    translationTitle: "The Ante-Nicene Fathers, Vol. I: The Apostolic Fathers with Justin Martyr and Irenaeus",
    translationYear: 1885,
    volume: "Ante-Nicene Fathers, vol. 1",
    indexUrl: `${SBE}/chr/ecf/001/index.htm`,
    ranges: [
      { from: "0010006.htm", to: "0010064.htm", prefix: "1 Clement — ", labelPattern: CHAPTER_LABEL },
      { from: "0010068.htm", to: "0010079.htm", prefix: "Diognetus — ", labelPattern: CHAPTER_LABEL },
      { from: "0010083.htm", to: "0010096.htm", prefix: "Polycarp, Philippians — ", labelPattern: CHAPTER_LABEL },
      { from: "0010099.htm", to: "0010120.htm", prefix: "Martyrdom of Polycarp — ", labelPattern: CHAPTER_LABEL },
      { from: "0010124.htm", to: "0010145.htm", prefix: "Ignatius, Ephesians — ", labelPattern: CHAPTER_LABEL },
      { from: "0010147.htm", to: "0010161.htm", prefix: "Ignatius, Magnesians — ", labelPattern: CHAPTER_LABEL },
      { from: "0010163.htm", to: "0010175.htm", prefix: "Ignatius, Trallians — ", labelPattern: CHAPTER_LABEL },
      { from: "0010177.htm", to: "0010186.htm", prefix: "Ignatius, Romans — ", labelPattern: CHAPTER_LABEL },
      { from: "0010188.htm", to: "0010198.htm", prefix: "Ignatius, Philadelphians — ", labelPattern: CHAPTER_LABEL },
      { from: "0010200.htm", to: "0010212.htm", prefix: "Ignatius, Smyrnaeans — ", labelPattern: CHAPTER_LABEL },
      { from: "0010214.htm", to: "0010221.htm", prefix: "Ignatius, Polycarp — ", labelPattern: CHAPTER_LABEL },
      { from: "0010337.htm", to: "0010357.htm", prefix: "Barnabas — ", labelPattern: CHAPTER_LABEL },
      { from: "0010361.htm", to: "0010370.htm", prefix: "Papias — ", labelPattern: "^([IVXLCDM]+\\.).*$" },
    ],
    refScheme: "chapter.paragraph",
    functions: ["non_canonical_religious_text", "historical_document"],
    editionNote: "chapter and paragraph index; each chapter is one printed chapter, prefixed with the document it belongs to",
  },
  {
    slug: "dionysius-areopagite",
    title: "The Works of Dionysius the Areopagite",
    originalTitle: "",
    transliteration: "Corpus Dionysiacum",
    altTitles: ["Pseudo-Dionysius", "On the Divine Names", "Mystical Theology"],
    tradition: "christianity",
    school: "patristics",
    genre: "Mystical theology",
    textType: "Treatises and letters",
    category: "Patristic theology",
    subcategory: "",
    originalLanguage: "grc",
    dateStart: 480,
    dateEnd: 530,
    dateDisplay: "c. 480–530 CE",
    authorshipStatus: "disputed",
    author: "pseudo-dionysius",
    attributionNote:
      "The corpus is presented as the work of Dionysius the Areopagite, the Athenian converted by Paul in Acts 17. Since the 6th century it has been recognised as the work of a later writer, probably a Syrian monk of around 500 CE, and is now called Pseudo-Dionysius.",
    description:
      "The Dionysian corpus is the foundation of Christian mystical theology: On the Divine Names, which thinks God through the names Scripture gives him; the Celestial and Ecclesiastical Hierarchies, which order angels and liturgy in a single ascending scale; the Mystical Theology, a few pages on the God beyond affirmation and denial; and ten letters on prayer, pastors and the hiddenness of God. Its language of hierarchy, deification and the cloud of unknowing shaped Byzantine theology, Aquinas, the medieval English mystics and the whole tradition of apophatic prayer.",
    historicalContext:
      "The corpus first appears in the early 6th century and was defended as apostolic at a council in 532; its dependence on Proclus was established in the 19th century. John Parker's translation, published at Oxford in 1897, was the first complete English edition of all the works and is the version the archive carries, with the translator's prefaces and notes.",
    availabilityNote:
      "Complete. The five works of the corpus — the Divine Names, the Mystic Theology, the Letters, the Celestial Hierarchy and the Ecclesiastical Hierarchy — are streamed from the Internet Sacred Text Archive at read time, one chapter (caput) or letter per chapter. The two volumes' title pages, prefaces, bibliographies and indexes are not part of the work; each chapter label carries the treatise it belongs to.",
    translator: "John Parker",
    translationTitle: "The Works of Dionysius the Areopagite",
    translationYear: 1897,
    volume: "James Parker & Co., Oxford",
    indexUrl: `${SBE}/chr/dio/index.htm`,
    ranges: [
      { from: "dio04.htm", to: "dio16.htm", prefix: "The Divine Names — ", labelPattern: CAPUT_LABEL },
      { from: "dio19.htm", to: "dio23.htm", prefix: "Mystic Theology — ", labelPattern: CAPUT_LABEL },
      { from: "dio25.htm", to: "dio35.htm", prefix: "Letters — ", labelPattern: LETTER_LABEL },
      { from: "dio44.htm", to: "dio58.htm", prefix: "The Celestial Hierarchy — ", labelPattern: CAPUT_LABEL },
      { from: "dio59.htm", to: "dio65.htm", prefix: "The Ecclesiastical Hierarchy — ", labelPattern: CAPUT_LABEL },
    ],
    refScheme: "chapter.paragraph",
    functions: ["mystical_contemplative", "philosophical_work"],
    editionNote: "chapter and paragraph index; each chapter is one printed caput or letter",
  },
  {
    slug: "anselm",
    title: "Proslogium, Monologium and Cur Deus Homo",
    originalTitle: "",
    transliteration: "Proslogion, Monologion, Cur Deus Homo",
    altTitles: ["Works of St. Anselm", "Proslogion", "Why God Became Man"],
    tradition: "christianity",
    school: "scholasticism",
    genre: "Theology",
    textType: "Theological treatises",
    category: "Scholastic theology",
    subcategory: "",
    originalLanguage: "la",
    dateStart: 1076,
    dateEnd: 1098,
    dateDisplay: "1076–1098",
    authorshipStatus: "established",
    author: "anselm",
    attributionNote:
      "Anselm wrote these treatises as abbot of Bec and archbishop of Canterbury. The appendix prints Gaunilo of Marmoutiers' reply on behalf of the fool and Anselm's answer to it, both of which circulated with the Proslogium from the beginning.",
    description:
      "Anselm's three treatises are the beginning of scholastic theology. The Monologium argues from the existence of good things to a single highest good; the Proslogium seeks one argument that needs nothing beyond itself, the famous proof that God is that than which nothing greater can be thought, and ends in the prayer that God may be known and loved; Cur Deus Homo asks why God became man and answers with the theory of satisfaction that shaped Western soteriology. With them the volume prints Gaunilo's objection and Anselm's reply, the first philosophical critique of the ontological argument.",
    historicalContext:
      "Anselm wrote the Monologium and Proslogium at Bec in the 1070s and Cur Deus Homo in England at the end of the century. Sidney Norton Deane's translation, published by the Open Court Publishing Company in 1903, made the treatises available to English readers with the objections of Gaunilo and the later philosophers on the ontological argument.",
    availabilityNote:
      "Complete. The Proslogium, the Monologium, the appendix with Gaunilo and Anselm's reply, and both books of Cur Deus Homo are streamed from the Internet Sacred Text Archive at read time, one chapter per chapter. The archive prints each book of Cur Deus Homo as a single page, so the two books are two long chapters; the rest of the volume (introduction, bibliography, indexes) is not part of the work.",
    translator: "Sidney Norton Deane",
    translationTitle: "Proslogium; Monologium; An Appendix in Behalf of the Fool by Gaunilon; and Cur Deus Homo",
    translationYear: 1903,
    volume: "Open Court Publishing Company, Chicago",
    indexUrl: `${SBE}/chr/ans/index.htm`,
    ranges: [
      { from: "ans007.htm", to: "ans032.htm", prefix: "Proslogium — ", labelPattern: CHAPTER_LABEL },
      { from: "ans033.htm", to: "ans112.htm", prefix: "Monologium — ", labelPattern: CHAPTER_LABEL },
      { from: "ans113.htm", to: "ans114.htm", prefix: "Appendix — " },
      { from: "ans116.htm", to: "ans118.htm", prefix: "Cur Deus Homo — " },
    ],
    refScheme: "chapter.paragraph",
    functions: ["philosophical_work"],
    editionNote: "chapter and paragraph index; each chapter is one printed chapter, prefixed with the treatise it belongs to",
    endMarker: "<p><hr/>",
  },
  {
    slug: "cloud-of-unknowing",
    title: "The Cloud of Unknowing",
    originalTitle: "",
    transliteration: "The Cloud of Unknowing",
    altTitles: ["A Book of Contemplation the Which Is Called the Cloud of Unknowing"],
    tradition: "christianity",
    school: "",
    genre: "Mystical theology",
    textType: "Contemplative manual",
    category: "Christian mysticism",
    subcategory: "",
    originalLanguage: "enm",
    dateStart: 1370,
    dateEnd: 1400,
    dateDisplay: "c. 1370–1400",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The book is anonymous. Its author, a 14th-century English priest writing for a young disciple, is unknown; the Cloud has been attributed to Walter Hilton and to other contemplatives, but no attribution is secure.",
    description:
      "The Cloud of Unknowing is the classic English manual of contemplative prayer: a series of short chapters teaching the disciple to forget all creatures and all thoughts and to press into the cloud of unknowing with a blind stirring of love. It is practical and unsentimental, warning against false fervour, bodily techniques and the presumption of beginners, and its image of the cloud, taken from Dionysius, became the central metaphor of Western apophatic spirituality. The volume also carries the author's prayer and prologue.",
    historicalContext:
      "The Cloud belongs to the flowering of English vernacular mysticism in the late 14th century, alongside the writings of Julian of Norwich and Walter Hilton. Evelyn Underhill's 1922 edition modernised the Middle English spelling and added an introduction that made the book a founding text of the modern contemplative revival.",
    availabilityNote:
      "Complete. The prayer, the prologue and all seventy-five chapters are streamed from the Internet Sacred Text Archive at read time, one chapter per chapter. The edition's introduction, glossary and table of chapters are not part of the work, and the modernised Middle English of Underhill's text is reproduced as the archive serves it.",
    translator: "Evelyn Underhill",
    translationTitle: "A Book of Contemplation the Which Is Called the Cloud of Unknowing",
    translationYear: 1922,
    volume: "Evelyn Underhill (ed.), London",
    indexUrl: `${SBE}/chr/cou/index.htm`,
    ranges: [
      { from: "cou03.htm", to: "cou04.htm" },
      { from: "cou06.htm", to: "cou80.htm", labelPattern: "^(Chapter\\s+\\d+)\\b.*$" },
    ],
    refScheme: "chapter.paragraph",
    functions: ["mystical_contemplative"],
    editionNote: "chapter and paragraph index; each chapter is one printed chapter",
    endMarker: "<p><hr/>",
  },
  {
    slug: "imitation-of-christ",
    title: "The Imitation of Christ",
    originalTitle: "De imitatione Christi",
    transliteration: "De Imitatione Christi",
    altTitles: ["Imitation of Christ", "De Imitatione Christi"],
    tradition: "christianity",
    school: "",
    genre: "Devotional literature",
    textType: "Devotional manual",
    category: "Christian mysticism",
    subcategory: "",
    originalLanguage: "la",
    dateStart: 1418,
    dateEnd: 1427,
    dateDisplay: "c. 1418–1427",
    authorshipStatus: "disputed",
    author: "thomas-a-kempis",
    attributionNote:
      "The Imitation is traditionally ascribed to Thomas à Kempis, an Augustinian canon of Mount St Agnes near Zwolle, and that attribution has been the majority view since the 15th century. Its authorship was disputed for centuries among the houses of the Devotio Moderna, and the question is still argued.",
    description:
      "The Imitation of Christ is the most widely read devotional book in the Christian West: four books of short chapters on the interior life, the contempt of the world, the following of Christ and the sacrament of communion. Book I treats humility, temptation and self-knowledge; Book II the inward kingdom; Book III, the longest, is a dialogue between the soul and Christ on consolation, suffering and the love of the cross; Book IV prepares the reader for communion. Its sober, direct prose has kept it in print for six centuries.",
    historicalContext:
      "Thomas à Kempis wrote within the Devotio Moderna, the movement of common-life piety that arose in the Low Countries around Geert Groote and the Brethren of the Common Life. William Benham's translation of 1886, printed in London with an introductory note, is the version the archive carries.",
    availabilityNote:
      "Complete. All four books — 115 chapters with the devotional exhortation that opens Book IV — are streamed from the Internet Sacred Text Archive at read time, one printed chapter per chapter. Chapter labels carry the book they belong to, because the printed numbering restarts in each book. The edition's introductory note is not part of the work.",
    translator: "William Benham",
    translationTitle: "The Imitation of Christ",
    translationYear: 1886,
    volume: "London",
    indexUrl: `${SBE}/chr/ioc/index.htm`,
    ranges: [
      { from: "ioc002.htm", to: "ioc026.htm", prefix: "Book I — ", labelPattern: CHAPTER_LABEL },
      { from: "ioc027.htm", to: "ioc038.htm", prefix: "Book II — ", labelPattern: CHAPTER_LABEL },
      { from: "ioc039.htm", to: "ioc097.htm", prefix: "Book III — ", labelPattern: CHAPTER_LABEL },
      { from: "ioc098.htm", to: "ioc116.htm", prefix: "Book IV — ", labelPattern: CHAPTER_LABEL },
    ],
    refScheme: "chapter.paragraph",
    functions: ["mystical_contemplative", "denominational_guidance"],
    editionNote: "chapter and paragraph index; each chapter is one printed chapter, prefixed with the book it belongs to",
  },
  {
    slug: "the-sikh-religion",
    title: "The Sikh Religion",
    originalTitle: "",
    transliteration: "The Sikh Religion: Its Gurus, Sacred Writings and Authors",
    altTitles: ["The Sikh Religion, Volume 1", "Sikh Religion"],
    tradition: "sikhism",
    school: "",
    genre: "History",
    textType: "Hagiography and translated hymns",
    category: "Sikhism",
    subcategory: "Guru Nanak",
    originalLanguage: "en",
    dateStart: 1909,
    dateEnd: 1909,
    dateDisplay: "1909",
    authorshipStatus: "established",
    author: "max-arthur-macauliffe",
    attributionNote:
      "Max Arthur MacAuliffe (1842–1913), an Irish civil servant in the Punjab, wrote this six-volume account of the Sikh Gurus and their writings. Volume 1, the only volume the archive carries, is devoted to Guru Nanak: a long introduction on the Punjab and the religious setting, a life in seventeen chapters, and translations of the Japji, Asa ki War, the Rahiras, the Sohila and a selection of hymns and sloks.",
    description:
      "The Sikh Religion is the first comprehensive English account of the Sikh tradition and its scriptures. Volume 1 sets the scene in the Punjab of Guru Nanak's time, follows his life through the traditional janamsakhi material, and then gives the reader the Guru's own words: the Japji, the evening and morning liturgies, Asa ki War, and a large body of hymns and additional sloks translated in full. MacAuliffe writes as a nineteenth-century historian, weighing the janamsakhis against one another; the book is valuable both for its narrative and for making the early Gurbani available in English before the modern translations.",
    historicalContext:
      "MacAuliffe served in the Punjab administration and spent years with the texts and with Sikh scholars. Oxford University Press published the six volumes between 1909 and his death in 1913, with the last volumes seen through the press by his colleagues. Volume 1 remains a standard Victorian introduction to Guru Nanak; its translations are the ones later writers often quote, and its account of the sources is still cited in janamsakhi scholarship.",
    availabilityNote:
      "Volume 1 only. The Internet Sacred Text Archive carries the introduction, the seventeen chapters on Guru Nanak's life, and the translations of the Japji, Asa ki War, Rahiras, Sohila, hymns and additional sloks — twenty-four chapters in all, streamed at read time. Volumes 2–6, which cover the later Gurus, are not on the archive and are recorded in the acquisition register.",
    translator: "Max Arthur MacAuliffe",
    translationTitle: "The Sikh Religion: Its Gurus, Sacred Writings and Authors, Volume 1",
    translationYear: 1909,
    volume: "Volume 1 of six, Oxford University Press",
    authored: true,
    indexUrl: `${SBE}/skh/tsr1/index.htm`,
    ranges: [{ from: "tsr103.htm", to: "tsr126.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["historical_document", "academic_scholarship", "non_canonical_religious_text"],
    editionNote: "chapter and paragraph index; each chapter is one printed chapter or hymn collection",
  },
  {
    slug: "religion-of-the-sikhs",
    title: "The Religion of the Sikhs",
    originalTitle: "",
    transliteration: "The Religion of the Sikhs",
    altTitles: [],
    tradition: "sikhism",
    school: "",
    genre: "Introduction",
    textType: "Introduction to Sikh belief and history",
    category: "Sikhism",
    subcategory: "Doctrine and history",
    originalLanguage: "en",
    dateStart: 1914,
    dateEnd: 1914,
    dateDisplay: "1914",
    authorshipStatus: "established",
    author: "dorothy-field",
    attributionNote:
      "Dorothy Field wrote this short introduction for the Wisdom of the East series, edited by L. Cranmer-Byng and S. A. Kapadia. She writes as a sympathetic outside observer of the early twentieth-century Punjab, not as a Sikh authority.",
    description:
      "A compact introduction to Sikhism in four chapters: the lives of the ten Gurus, the religious origins of the tradition in Hindu monotheism and its contact with Islam, the doctrines of the Sikhs, and a selection of hymns from the Guru Granth Sahib and from the Dasam Granth. Field explains the Khalsa, the Guru's authority, the place of the Granth, and the daily religious practice of the community, and she quotes the hymns at length in English.",
    historicalContext:
      "The Wisdom of the East series introduced Asian religions to a popular British readership before the First World War. Field's volume appeared in 1914, when the Punjab was still the centre of the Sikh world and the Singh Sabha reforms were recent; her account reflects the colonial-era presentation of Sikhism as a monotheistic reform movement.",
    availabilityNote:
      "Complete. The four chapters are streamed from the Internet Sacred Text Archive at read time. The acknowledgement, contents and editorial note of the series are not part of the work.",
    translator: "Dorothy Field",
    translationTitle: "The Religion of the Sikhs",
    translationYear: 1914,
    volume: "The Wisdom of the East Series, London",
    authored: true,
    indexUrl: `${SBE}/skh/rosi/index.htm`,
    ranges: [{ from: "rosi04.htm", to: "rosi07.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["academic_scholarship", "historical_document"],
    editionNote: "chapter and paragraph index; each chapter is one printed chapter",
  },
  {
    slug: "zhuangzi",
    title: "Zhuangzi",
    originalTitle: "莊子",
    transliteration: "Zhuāngzǐ",
    altTitles: ["Chuang Tzu", "Chuang-tse", "The Writings of Kwang-dze", "Nanhua zhenjing"],
    tradition: "taoism",
    school: "daoist",
    genre: "Philosophy",
    textType: "Parables, dialogues and anecdotes",
    category: "Philosophy",
    subcategory: "Daoist classics",
    originalLanguage: "zh",
    dateStart: -350,
    dateEnd: -250,
    dateDisplay: "c. 4th–3rd centuries BCE (received recension, 3rd century CE)",
    authorshipStatus: "composite",
    author: "zhuangzi",
    attributionNote:
      "The book is named for Zhuang Zhou (c. 369–286 BCE), a minor official of the state of Song. Scholarship distinguishes the seven 'inner' books, which may be close to his own writing, from the outer and miscellaneous books compiled by later followers; the thirty-three-book recension was fixed by Guo Xiang in the third century CE from a larger collection of fifty-two.",
    description:
      "The Zhuangzi is the second classic of Daoist philosophy: thirty-three books of parables, dialogues and anecdotes in which cooks and cicadas, cripples and shamans, Confucius and Laozi argue about the usefulness of the useless, the transformation of things, the limits of language and the art of living without harm. The inner books develop the teaching of the Dao as an unnameable process; the outer and miscellaneous books extend it into politics, death, craft and the strange. Its humour and imaginative range made it a foundation of Chinese literature as well as of Daoist thought.",
    historicalContext:
      "The text grew over several centuries in the Warring States and early imperial periods, and its layers are visible in style and doctrine. Guo Xiang's edition and commentary (c. 300 CE) displaced the earlier recensions and became the received text. James Legge translated it for the Sacred Books of the East in 1891, the first complete English rendering; his introduction weighs the authenticity of the books and the meaning of the Dao, and his notes identify the Chinese commentators he follows.",
    availabilityNote:
      "Complete. All thirty-three books of Legge's translation are streamed from the Internet Sacred Text Archive at read time, one printed book per chapter: books I–XVII from volume 39 and books XVIII–XXXIII from volume 40. The two volumes' introductions and the appendixes printed after the text in volume 40 are not part of the work. The archive's index prints Book XXIX, 'The Robber Kih', as Book XXIV; the chapter label follows the book's own heading and position.",
    translator: "James Legge",
    translationTitle: "The Texts of Taoism, Part I–II: The Writings of Kwang-dze",
    translationYear: 1891,
    volume: "Sacred Books of the East, vols. 39–40",
    indexUrl: `${SBE}/tao/sbe39/index.htm`,
    ranges: [
      { from: "sbe39122.htm", to: "sbe39138.htm" },
      { from: "sbe4002.htm", to: "sbe4017.htm", indexUrl: `${SBE}/tao/sbe40/index.htm` },
    ],
    refScheme: "book.paragraph",
    functions: ["philosophical_work", "non_canonical_religious_text", "mystical_contemplative"],
    editionNote: "book and paragraph index; each chapter is one printed book of the thirty-three",
    labelOverrides: { "sbe4013.htm": "Book XXIX. Tâo Kih, or 'The Robber Kih'" },
  },
  {
    slug: "liehzi",
    title: "Liezi",
    originalTitle: "列子",
    transliteration: "Lièzǐ",
    altTitles: ["Lieh Tzu", "The Book of Lieh-Tzü", "Taoist Teachings from the Book of Lieh-Tzü", "Chongxu zhenjing"],
    tradition: "taoism",
    school: "daoist",
    genre: "Philosophy",
    textType: "Parables and speculative anecdotes",
    category: "Philosophy",
    subcategory: "Daoist classics",
    originalLanguage: "zh",
    dateStart: -400,
    dateEnd: -300,
    dateDisplay: "c. 4th century BCE, with later layers",
    authorshipStatus: "composite",
    author: "liezi",
    attributionNote:
      "The book is named for Lie Yukou, a shadowy figure of the fourth century BCE whom the Zhuangzi presents as a master of the Dao. The received text is a later compilation, probably assembled in the third or fourth century CE from older material; its eight books were edited and annotated by Zhang Zhan.",
    description:
      "The Liezi is the third of the classical Daoist books: a collection of stories and arguments on cosmogony, the Yellow Emperor's dream journeys, the relativity of waking and dreaming, Confucius as a teacher of the Dao, the questions of Pang, effort and destiny, and causality. Its fables are among the most famous in Chinese literature, and its calm, sceptical voice extends the Zhuangzi's themes into a distinct metaphysics of change.",
    historicalContext:
      "Zhang Zhan's fourth-century edition and commentary established the text, whose antiquity and authenticity have been debated since the Song. Lionel Giles translated this selection for the Wisdom of the East series in 1912. His seven books follow the eight-book recension but omit the seventh, the Yang Chu chapter, which he published separately as Yang Chu's Garden of Pleasure.",
    availabilityNote:
      "Selected translation. The seven books Giles translated are streamed from the Internet Sacred Text Archive at read time, one book per chapter. The omitted Yang Chu book is a separate work in this library in the same translator's version; the eighth book, 'Explaining Conjunctions', is not in this edition. Giles's editorial note and introduction are not part of the work.",
    translator: "Lionel Giles",
    translationTitle: "Taoist Teachings from the Book of Lieh-Tzü",
    translationYear: 1912,
    volume: "The Wisdom of the East Series, London",
    indexUrl: `${SBE}/tao/tt/index.htm`,
    ranges: [{ from: "tt04.htm", to: "tt10.htm" }],
    refScheme: "book.paragraph",
    functions: ["philosophical_work", "non_canonical_religious_text"],
    editionNote: "book and paragraph index; each chapter is one printed book",
  },
  {
    slug: "yang-chu",
    title: "Yang Chu's Garden of Pleasure",
    originalTitle: "楊朱",
    transliteration: "Yáng Zhū",
    altTitles: ["Yang Chu", "The Garden of Pleasure", "Yang Zhu"],
    tradition: "taoism",
    school: "daoist",
    genre: "Philosophy",
    textType: "Ethical dialogues and anecdotes",
    category: "Philosophy",
    subcategory: "Daoist classics",
    originalLanguage: "zh",
    dateStart: -300,
    dateEnd: -200,
    dateDisplay: "c. 4th–3rd centuries BCE, as transmitted in the Liezi",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "The chapters present the teaching of Yang Zhu (c. 440–360 BCE), whom Mencius attacked for refusing to sacrifice a hair of his body for the world. The text itself is the seventh book of the Liezi, compiled centuries later by followers; it is not a surviving work of Yang Zhu's own hand.",
    description:
      "Yang Chu's Garden of Pleasure is the Liezi's book on the individual life: the vanity of fame, the brevity of consciousness, death as the great leveller, false virtue, duty to the living and the dead, the art of life, the happy voluptuaries, the joys of Tuan-mu Shu and the folly of craving long life. Its hedonism is not licence but a consistent refusal to trade the present for reputation or for an imaginary future, and it preserves one of the sharpest alternatives to the Confucian and Mohist ethics of its time.",
    historicalContext:
      "Yang Zhu's position is known chiefly from his critics, Mencius above all; the Liezi chapter is the fullest surviving statement attributed to him, though its date and fidelity are disputed. Lionel Giles translated it for the Wisdom of the East series in 1912 as a companion to his Lieh-Tzü selection.",
    availabilityNote:
      "Complete. All nineteen chapters of Giles's translation are streamed from the Internet Sacred Text Archive at read time, one chapter per page. The volume's introduction and contents are not part of the work.",
    translator: "Lionel Giles",
    translationTitle: "Yang Chu's Garden of Pleasure",
    translationYear: 1912,
    volume: "The Wisdom of the East Series, London",
    indexUrl: `${SBE}/tao/ycgp/index.htm`,
    ranges: [{ from: "ycgp01.htm", to: "ycgp19.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["philosophical_work", "non_canonical_religious_text"],
    editionNote: "chapter and paragraph index; each chapter is one printed chapter",
    labelOverrides: {
      "ycgp01.htm": "Chapter I — The Vanity of Fame",
      "ycgp02.htm": "Chapter II — Real and False Greatness",
      "ycgp03.htm": "Chapter III — The Brevity of Conscious Life",
      "ycgp04.htm": "Chapter IV — Death the Equaliser",
      "ycgp05.htm": "Chapter V — False Virtues",
      "ycgp06.htm": "Chapter VI — The Ideal Life",
      "ycgp07.htm": "Chapter VII — Duty to the Living and the Dead",
      "ycgp08.htm": "Chapter VIII — The Art of Life",
      "ycgp09.htm": "Chapter IX — The Happy Voluptuaries",
      "ycgp10.htm": "Chapter X — The Joyous Life of Tuan-mu Shu",
      "ycgp11.htm": "Chapter XI — The Folly of Desire for Long Life",
      "ycgp12.htm": "Chapter XII — Self-sacrifice and Self-aggrandisement",
      "ycgp13.htm": "Chapter XIII — The Vanity of Reputation",
      "ycgp14.htm": "Chapter XIV — Difficulty and Ease of Government",
      "ycgp15.htm": "Chapter XV — All Things Pass",
      "ycgp16.htm": "Chapter XVI — The Nature of Man",
      "ycgp17.htm": "Chapter XVII — The Four Chimeras",
      "ycgp18.htm": "Chapter XVIII — All Pleasures Are Relative",
      "ycgp19.htm": "Chapter XIX — The Wisdom of Contentment",
    },
  },
  {
    slug: "tai-shang-tractate",
    title: "The Tai Shang Tractate of Actions and Their Retributions",
    originalTitle: "太上感應篇",
    transliteration: "Tàishàng gǎnyìng piān",
    altTitles: ["Tai Shang Kan Ying P'ien", "T'ai Shang Kan-Ying P'ien", "Treatise on Response and Retribution", "Kan Ying P'ien"],
    tradition: "taoism",
    school: "daoist",
    genre: "Scripture",
    textType: "Moral tract",
    category: "Scripture",
    subcategory: "Morality book (shanshu)",
    originalLanguage: "zh",
    dateStart: 1100,
    dateEnd: 1200,
    dateDisplay: "c. 11th–12th century CE (Song dynasty)",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The tract is presented as the instruction of Tai Shang, the Most High Lord Lao, and was widely circulated as a revelation. Its actual composition is anonymous, usually placed in the Song dynasty, and it became the model for the later morality books.",
    description:
      "The Tai Shang Tractate is the most influential of the Chinese morality books: a short scripture on the working of retribution, in which the Most High Lord Lao teaches that good and evil deeds are answered, that the spirits of the household and the heavens keep account, and that the good are rewarded with long life, honour and peace while the wicked are visited with misfortune. It became a school text for ethical instruction and the parent of a whole genre of moral tracts.",
    historicalContext:
      "The Kan Ying P'ien circulated widely in the Song and later, was commented on by Confucian and Buddhist as well as Daoist writers, and was printed in enormous editions for moral instruction. Legge printed a translation at the end of the second volume of his Texts of Taoism (1891), with a note on the tractate's character and its place in Chinese religion.",
    availabilityNote:
      "Complete. Legge's translation of the tractate is streamed from the Internet Sacred Text Archive at read time; it is a single printed text, presented here as one chapter with its paragraphs indexed. The volume's introduction and the appendixes that follow are not part of the work.",
    translator: "James Legge",
    translationTitle: "The Texts of Taoism, Part II: The Thâi-Shang Tractate of Actions and Their Retributions",
    translationYear: 1891,
    volume: "Sacred Books of the East, vol. 40",
    indexUrl: `${SBE}/tao/sbe40/index.htm`,
    ranges: [{ from: "sbe4018.htm", to: "sbe4018.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["non_canonical_religious_text", "religious_law_practice"],
    editionNote: "chapter and paragraph index; the whole tractate is one chapter",
    endMarker: "<H3 ALIGN=\"CENTER\">Footnotes</H3>",
    labelOverrides: { "sbe4018.htm": "The Tractate" },
  },
  {
    slug: "qingjing-jing",
    title: "The Classic of Purity",
    originalTitle: "清靜經",
    transliteration: "Qīngjìng jīng",
    altTitles: ["Qingjing Jing", "Khing Kâng King", "The Classic of Purity and Rest", "Taishang Laojun shuo chang qingjing jing"],
    tradition: "taoism",
    school: "daoist",
    genre: "Scripture",
    textType: "Contemplative scripture",
    category: "Scripture",
    subcategory: "Short Daoist classics",
    originalLanguage: "zh",
    dateStart: 700,
    dateEnd: 900,
    dateDisplay: "Tang dynasty recension of earlier material",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The scripture is presented as the teaching of the Most High Lord Lao to the Perfected One of the Eastern Florescence. Its date is uncertain; the received text is usually placed in the Tang and was transmitted with a commentary attributed to Ge Xuan.",
    description:
      "The Classic of Purity is one of the most widely recited short scriptures of Daoism: a compact teaching on the pure and still heart as the root of the Dao, on the desires and disturbances that obscure it, and on the return to stillness in which the true Dao is known. It is chanted in temples and used as a primer of Daoist contemplation, and its phrases circulate far beyond monastic settings.",
    historicalContext:
      "The Qingjing jing was transmitted with a commentary ascribed to Ge Xuan and became a standard liturgical and devotional text in the Tang and Song. Legge printed a translation among the appendixes to his second volume of Texts of Taoism (1891), where it illustrates the devotional literature that grew around the philosophical classics.",
    availabilityNote:
      "Complete. Legge's translation of the classic is streamed from the Internet Sacred Text Archive at read time; it is a single short page, presented here as one chapter. The appendixes and notes of the volume are not part of the work.",
    translator: "James Legge",
    translationTitle: "The Texts of Taoism, Part II: Appendix I, Khing Kâng King, or 'The Classic of Purity'",
    translationYear: 1891,
    volume: "Sacred Books of the East, vol. 40",
    indexUrl: `${SBE}/tao/sbe40/index.htm`,
    ranges: [{ from: "sbe4019.htm", to: "sbe4019.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture", "mystical_contemplative", "prayer_liturgy"],
    editionNote: "chapter and paragraph index; the whole classic is one chapter",
    textStartMarker: "<P ALIGN=\"CENTER\">______________</P>",
    endMarker: "<H3 ALIGN=\"CENTER\">Footnotes</H3>",
    labelOverrides: { "sbe4019.htm": "The Classic of Purity" },
  },
  {
    slug: "yinfu-jing",
    title: "The Yin Fu King",
    originalTitle: "陰符經",
    transliteration: "Yīnfú jīng",
    altTitles: ["Yin Fu Jing", "The Classic of the Harmony of the Seen and the Unseen", "Huangdi Yinfu jing"],
    tradition: "taoism",
    school: "daoist",
    genre: "Scripture",
    textType: "Cosmological scripture",
    category: "Scripture",
    subcategory: "Short Daoist classics",
    originalLanguage: "zh",
    dateStart: 700,
    dateEnd: 800,
    dateDisplay: "Attributed to the Yellow Emperor; the received text is usually dated to the Tang",
    authorshipStatus: "traditional",
    author: "",
    attributionNote:
      "The scripture is traditionally ascribed to the Yellow Emperor, but its language and ideas place the received text in the Tang dynasty, when it circulated with commentaries. It is not a Warring States work despite its legendary attribution.",
    description:
      "The Yin Fu King is a short, dense scripture on the patterned correspondence between heaven, earth and the human person: the observation of the natural order, the timing of action, the relation of the seen and the unseen, and the inward discipline by which the sage aligns himself with the workings of heaven. Its terse lines were commented on by strategists, alchemists and philosophers, and it became a classic of both Daoist self-cultivation and Chinese military thought.",
    historicalContext:
      "The text was transmitted with commentaries from the Tang onward and was especially valued in military and alchemical circles; Li Quan's commentary made it a handbook of strategy, while later Daoist writers read it as a manual of inner cultivation. Legge printed a translation among the appendixes to his second volume of Texts of Taoism (1891).",
    availabilityNote:
      "Complete. Legge's translation of the scripture is streamed from the Internet Sacred Text Archive at read time; it is a single short page, presented here as one chapter. The appendixes and notes of the volume are not part of the work.",
    translator: "James Legge",
    translationTitle: "The Texts of Taoism, Part II: Appendix II, Yin Fû King, or 'Classic of the Harmony of the Seen and the Unseen'",
    translationYear: 1891,
    volume: "Sacred Books of the East, vol. 40",
    indexUrl: `${SBE}/tao/sbe40/index.htm`,
    ranges: [{ from: "sbe4020.htm", to: "sbe4020.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture", "philosophical_work", "mystical_contemplative"],
    editionNote: "chapter and paragraph index; the whole scripture is one chapter",
    textStartMarker: "with passages that are incapable of any satisfactory explanation.</P>",
    endMarker: "<H3 ALIGN=\"CENTER\">Footnotes</H3>",
    labelOverrides: { "sbe4020.htm": "The Yin Fu King" },
  },
  {
    slug: "yin-chih-wen",
    title: "Yin Chih Wen: The Tract of the Quiet Way",
    originalTitle: "陰騭文",
    transliteration: "Yīnzhì wén",
    altTitles: ["Yin Chih Wen", "The Tract of the Quiet Way", "Wenchang dijun yinzhi wenzhu"],
    tradition: "taoism",
    school: "daoist",
    genre: "Scripture",
    textType: "Moral tract",
    category: "Scripture",
    subcategory: "Morality book (shanshu)",
    originalLanguage: "zh",
    dateStart: 1600,
    dateEnd: 1700,
    dateDisplay: "Attributed to Wenchang; widely circulated from the 17th century",
    authorshipStatus: "traditional",
    author: "",
    attributionNote:
      "The tract is presented as the revelation of Wenchang, the god of literature, and was widely printed by moral-instruction societies in the Qing. Its composition is anonymous and its attribution traditional.",
    description:
      "The Tract of the Quiet Way is a Qing-dynasty morality book in the tradition of the Tai Shang Tractate: a list of the good deeds that heaven secretly rewards and the evils it punishes, addressed to ordinary households and offered as a guide to hidden virtue. It recommends compassion for the poor, respect for life, honesty in trade, and the quiet accumulation of merit that does not seek recognition.",
    historicalContext:
      "The Yin Chih Wen circulated through the charitable and moral-instruction societies of the Qing, often printed together with the Kan Ying P'ien. Teitaro Suzuki and Paul Carus translated it, with the Chinese commentator's notes and their own, for the Open Court Publishing Company in 1906, as part of their effort to present Chinese religion to Western readers.",
    availabilityNote:
      "Complete text. The tract itself is streamed from the Internet Sacred Text Archive at read time and presented as one chapter; the Chinese commentator's notes, the translators' notes and the index printed with it are not part of the work.",
    translator: "Teitaro Suzuki and Paul Carus",
    translationTitle: "Yin Chih Wen, The Tract of the Quiet Way",
    translationYear: 1906,
    volume: "Open Court Publishing Company, Chicago",
    indexUrl: `${SBE}/tao/ycw/index.htm`,
    ranges: [{ from: "ycw03.htm", to: "ycw03.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["non_canonical_religious_text", "religious_law_practice"],
    editionNote: "chapter and paragraph index; the whole tract is one chapter",
    endMarker: "<H3 ALIGN=\"CENTER\">Footnotes</H3>",
    labelOverrides: { "ycw03.htm": "The Tract of the Quiet Way" },
  },
  {
    slug: "canon-of-reason-and-virtue",
    title: "The Canon of Reason and Virtue",
    originalTitle: "道德經",
    transliteration: "Dàodé jīng",
    altTitles: ["Lao-tze's Tao Teh King", "Tao Teh King (Carus)", "The Canon of Reason and Virtue, Chinese and English"],
    tradition: "taoism",
    school: "daoist",
    genre: "Philosophy",
    textType: "Aphoristic poem in translation",
    category: "Philosophy",
    subcategory: "Daoist classics",
    originalLanguage: "zh",
    dateStart: -400,
    dateEnd: -300,
    dateDisplay: "c. 4th–3rd centuries BCE (received text later); this translation 1913",
    authorshipStatus: "disputed",
    author: "laozi",
    attributionNote:
      "Traditional attribution to Laozi; the text is composite. Carus follows the received eighty-one-chapter edition and gives each chapter a descriptive title of his own ('Reason's Realization', 'Self-Culture'), which is how the translation is cited.",
    description:
      "Paul Carus's English Daodejing, made with the young Teitaro Suzuki: eighty-one chapters in his own numbered paragraphs, each chapter headed with a title that states its theme. Carus reads the book as a universal philosophy of reason and says so plainly, translating Dao as 'Reason' and de as 'Virtue', and the result is a clear, deliberately modern rendering rather than a literal one. It was one of the first American translations of the whole text and remained the version many English readers met first.",
    historicalContext:
      "Carus, the editor of the Open Court Publishing Company at La Salle, Illinois, published the translation in 1898 with the Chinese text facing the English; the edition printed here is the 1913 issue. Teitaro Suzuki, then working at Open Court, assisted with the Chinese. The book belongs to the same enterprise as the Suzuki–Carus translations of the Kan Ying P'ien and the Yin Chih Wen, which present Chinese religion to a Western readership through the categories of comparative religion.",
    availabilityNote:
      "Complete. All eighty-one chapters of Carus's English translation are streamed from the Internet Sacred Text Archive at read time, one printed chapter per chapter, with his numbered paragraphs indexed. The archive serves the Chinese text of the facing pages as images, so it is not part of this edition; Carus's introduction, his notes and the appendices printed with the volume are likewise not part of the work.",
    translator: "Teitaro Suzuki and Paul Carus",
    translationTitle: "The Canon of Reason and Virtue (Lao-tze's Tao Teh King), Chinese and English",
    translationYear: 1913,
    volume: "Open Court Publishing Company, La Salle, Illinois",
    indexUrl: `${SBE}/tao/crv/index.htm`,
    ranges: [{ from: "crv007.htm", to: "crv087.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["philosophical_work", "non_canonical_religious_text"],
    editionNote: "chapter and paragraph index; each chapter is one printed chapter with Carus's numbered paragraphs",
  },
  {
    slug: "taoist-texts",
    title: "Taoist Texts: Ethical, Political, and Speculative",
    originalTitle: "",
    transliteration: "Taoist Texts",
    altTitles: ["Taoist Texts", "Balfour's Taoist Texts"],
    tradition: "taoism",
    school: "daoist",
    genre: "Anthology",
    textType: "Collected scriptures in translation",
    category: "Scripture",
    subcategory: "Collected Daoist texts",
    originalLanguage: "zh",
    dateStart: 1884,
    dateEnd: 1884,
    dateDisplay: "Texts of various dates, collected and translated in 1884",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "Balfour's volume gathers ten Chinese texts in translation. The Tao Te Ching, the Yin Fu Ching and the Kan Ying Pien are canonical or widely circulated; the T'ai Hsi, Hsin Yin, Ta T'ung, Ch'ih Wen T'ung and Su Shu are short scriptures and tracts of the Daoist canon, and the extract from the Hung Lieh Chuan is a Han-dynasty anecdote about Huai-nan Tsze. The individual texts are anonymous or traditionally attributed; the volume is Balfour's.",
    description:
      "Frederic Henry Balfour's collection was the first English anthology to treat Daoist scripture as a literature rather than a curiosity. It opens with his own translation of the Tao Te Ching and then prints the short classics that the temples actually used: the Yin Fu Ching on the harmony of the seen and the unseen, the T'ai Hsi and Hsin Yin Ching on the nourishing of life and the seal of the heart, the Ta T'ung Ching on the great harmony, the Ch'ih Wen T'ung and the Ch'ing Ching Ching on purity and the settling of the mind, the Su Shu, or 'Book of Rewards', and the Kan Ying Pien on retribution. Together they show the devotional and moral side of Daoism that the philosophical classics do not.",
    historicalContext:
      "Balfour edited the North-China Herald in Shanghai and wrote on Chinese religion and literature for English readers. Trübner published the volume in London and Kelly and Walsh in Shanghai in 1884, when the Daozang was still almost unknown in Europe and the morality books were being printed by the million for household use. His translations are plain and sometimes stiff, but they made a body of scripture available a generation before Legge's appendixes.",
    availabilityNote:
      "Complete for this volume. All ten texts are streamed from the Internet Sacred Text Archive at read time, one text per chapter. Balfour's introduction and the notes he prints with each text stand with it, as in the printed volume; the volume's front matter is not part of the work.",
    translator: "Frederic Henry Balfour",
    translationTitle: "Taoist Texts: Ethical, Political, and Speculative",
    translationYear: 1884,
    volume: "Trübner and Co., London, and Kelly and Walsh, Shanghai",
    indexUrl: `${SBE}/tao/ttx/index.htm`,
    ranges: [{ from: "ttx02.htm", to: "ttx11.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["non_canonical_religious_text", "philosophical_work", "religious_law_practice"],
    editionNote: "chapter and paragraph index; each chapter is one text of the ten",
    labelOverrides: {
      "ttx02.htm": "The Tao Te Ching",
      "ttx03.htm": "The Yin Fu Ching",
      "ttx04.htm": "The T'ai Hsi Ching",
      "ttx05.htm": "The Hsin Yin Ching",
      "ttx06.htm": "The Ta T'ung Ching",
      "ttx07.htm": "The Ch'ih Wen T'ung",
      "ttx08.htm": "The Ch'ing Ching Ching",
      "ttx09.htm": "A Chapter from the Hung Lieh Chuan, by Huai-nan Tsze, Prince of Kuang Ling",
      "ttx10.htm": "The Su Shu",
      "ttx11.htm": "The Kan Ying Pien",
    },
  },
  {
    slug: "sayings-of-lao-tzu",
    title: "The Sayings of Lao Tzŭ",
    originalTitle: "道德經 (選)",
    transliteration: "Laozi",
    altTitles: ["The Sayings of Lao Tzu", "Lao Tzŭ on Himself"],
    tradition: "taoism",
    school: "daoist",
    genre: "Anthology",
    textType: "Thematic selection of translated passages",
    category: "Philosophy",
    subcategory: "Daoist classics",
    originalLanguage: "zh",
    dateStart: -400,
    dateEnd: -300,
    dateDisplay: "Sayings from a 4th–3rd century BCE text; selection 1905",
    authorshipStatus: "disputed",
    author: "laozi",
    attributionNote:
      "The sayings are from the Daodejing, traditionally ascribed to Laozi. Lionel Giles arranges extracts from the eighty-one chapters under nine themes rather than in chapter order, so the book is a selection and not a translation of the whole text.",
    description:
      "Lionel Giles's small anthology takes the Daodejing apart and reassembles it by subject: Tao in its transcendental aspect, Tao as a moral principle, the doctrine of inaction, lowliness and humility, government, war, paradoxes, miscellaneous precepts, and Lao Tzŭ on himself. The effect is a portrait of the teaching rather than of the book, and it was for many readers in the first half of the twentieth century the way into Laozi's thought.",
    historicalContext:
      "Giles, keeper of the Department of Oriental Printed Books and Manuscripts at the British Museum, wrote this volume for the Wisdom of the East series, which introduced Asian classics to a popular British readership before the First World War. It appeared in 1905, the same year as his book on Sun Tzŭ, and reflects the era's interest in Daoism as a philosophy of quietism rather than a religion.",
    availabilityNote:
      "Complete. All nine thematic chapters are streamed from the Internet Sacred Text Archive at read time. The series' editorial note and Giles's introduction are not part of the work.",
    translator: "Lionel Giles",
    translationTitle: "The Sayings of Lao Tzŭ",
    translationYear: 1905,
    volume: "The Wisdom of the East Series, London",
    indexUrl: `${SBE}/tao/salt/index.htm`,
    ranges: [{ from: "salt04.htm", to: "salt12.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["philosophical_work", "non_canonical_religious_text"],
    editionNote: "chapter and paragraph index; each chapter is one thematic section",
    labelOverrides: {
      "salt04.htm": "I. Tao in its Transcendental Aspect, and in its Physical Manifestation",
      "salt05.htm": "II. Tao as a Moral Principle, or 'Virtue'",
      "salt06.htm": "III. The Doctrine of Inaction",
      "salt07.htm": "IV. Lowliness and Humility",
      "salt08.htm": "V. Government",
      "salt09.htm": "VI. War",
      "salt10.htm": "VII. Paradoxes",
      "salt11.htm": "VIII. Miscellaneous Sayings and Precepts",
      "salt12.htm": "IX. Lao Tzŭ on Himself",
    },
  },
  {
    slug: "yushu-jing",
    title: "The Yu Shu King",
    originalTitle: "玉樞經",
    transliteration: "Yùshū jīng",
    altTitles: ["Yü Shû King", "The Classic of the Pivot of Jade", "The True Classic of the Pivot of Jade"],
    tradition: "taoism",
    school: "daoist",
    genre: "Scripture",
    textType: "Revealed scripture",
    category: "Scripture",
    subcategory: "Short Daoist classics",
    originalLanguage: "zh",
    dateStart: 1280,
    dateEnd: 1367,
    dateDisplay: "Yuan dynasty (1280–1367), as Legge dates it",
    authorshipStatus: "traditional",
    author: "",
    attributionNote:
      "The scripture is presented as the teaching of the Heaven-Honoured One who produces universal transformation by the sound of his thunder. Legge, following Wylie, takes the author to have been a Hsüan-yang Dze of the Yuan dynasty, in the time of the Mongol court.",
    description:
      "The Pivot of Jade is a short revealed scripture on the discipline and refinement of the spirit: the body is carried round by the spirit as the heavens are carried round the North Star, and when the spirit is refined until it is free of every obscuring influence it becomes solid, soft and strong as jade. It is recited in Daoist temples and belongs with the Khing Kâng King and the Yin Fû King among the brief classics that Legge printed as appendixes to his Texts of Taoism.",
    historicalContext:
      "The text is attributed to the Heaven-Honoured One and was transmitted with a commentary; Legge translates it from the Daozang recension and dates its composition to the Yuan. He printed it, with an introductory notice, as the third appendix to the second volume of The Texts of Taoism (1891).",
    availabilityNote:
      "Complete. Legge's translation is streamed from the Internet Sacred Text Archive at read time; it is one printed page, presented here as one chapter with its numbered paragraphs indexed. Legge's introductory notice and the notes printed at the foot of the page are not part of the work.",
    translator: "James Legge",
    translationTitle: "The Texts of Taoism, Part II: Appendix III, Yü Shû King, or 'The Classic of the Pivot of Jade'",
    translationYear: 1891,
    volume: "Sacred Books of the East, vol. 40",
    indexUrl: `${SBE}/tao/sbe40/index.htm`,
    ranges: [{ from: "sbe4021.htm", to: "sbe4021.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture", "mystical_contemplative", "prayer_liturgy"],
    editionNote: "chapter and paragraph index; the whole scripture is one chapter",
    textStartMarker: "<P ALIGN=\"CENTER\">_____________________</P>",
    endMarker: "<H3 ALIGN=\"CENTER\">Footnotes</H3>",
    labelOverrides: { "sbe4021.htm": "The Pivot of Jade" },
  },
  {
    slug: "zah-yung-jing",
    title: "The Zah Yung King",
    originalTitle: "",
    transliteration: "Zäh Yung King",
    altTitles: ["The Classic of the Directory for a Day", "Zah Yung Jing"],
    tradition: "taoism",
    school: "daoist",
    genre: "Scripture",
    textType: "Contemplative scripture",
    category: "Scripture",
    subcategory: "Short Daoist classics",
    originalLanguage: "zh",
    dateStart: 1000,
    dateEnd: 1400,
    dateDisplay: "Date unknown; Legge places it after the Tang",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "Legge found no mention of the author or date of this brief composition. Its use of Buddhist expressions shows, he says, that it cannot be very early; he groups it with the Khing Kâng King among the short contemplative texts of the later Daoist canon.",
    description:
      "The Directory for a Day is a short manual of daily contemplation: once the day's eating and drinking are arranged, sit upright with the mouth closed, let no thought arise, forget everything, press the lips and teeth together, look at nothing and listen to nothing, and draw long breaths that are gradually released. The text promises that the water of the kidneys will rise and the saliva form in the mouth, and that in this way one learns to prolong life; it ends with the instruction to keep the thoughts fixed on absolute purity through the twelve hours of the day.",
    historicalContext:
      "The tract belongs to the literature of Daoist self-cultivation that circulated with the morality books and the short classics, and it was translated by Legge with the appendixes to the second volume of The Texts of Taoism (1891). Its physiology is the traditional Chinese one, in which the kidneys and the saliva stand for the vital essences.",
    availabilityNote:
      "Complete. Legge's translation is streamed from the Internet Sacred Text Archive at read time; it is one printed page, presented here as one chapter with its numbered paragraphs indexed. Legge's introductory notice and his notes are not part of the work. The transcription breaks two sentences where the printed page turned, so a paragraph may begin or end mid-sentence.",
    translator: "James Legge",
    translationTitle: "The Texts of Taoism, Part II: Appendix IV, Zäh Yung King, or 'Classic of the Directory for a Day'",
    translationYear: 1891,
    volume: "Sacred Books of the East, vol. 40",
    indexUrl: `${SBE}/tao/sbe40/index.htm`,
    ranges: [{ from: "sbe4022.htm", to: "sbe4022.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture", "mystical_contemplative", "religious_law_practice"],
    editionNote: "chapter and paragraph index; the whole tract is one chapter",
    textStartMarker: "<P ALIGN=\"CENTER\">______________________________</P>",
    endMarker: "<H3 ALIGN=\"CENTER\">Footnotes</H3>",
    labelOverrides: { "sbe4022.htm": "The Directory for a Day" },
  },
  {
    slug: "analects",
    title: "Analects",
    originalTitle: "論語",
    transliteration: "Lúnyǔ",
    altTitles: ["Lunyu", "The Confucian Analects", "Selected Sayings"],
    tradition: "confucianism",
    school: "confucian",
    genre: "Philosophy",
    textType: "Dialogues and aphorisms",
    category: "Classics",
    subcategory: "Confucian classics",
    originalLanguage: "zh",
    dateStart: -479,
    dateEnd: -249,
    dateDisplay: "Compiled c. 5th–3rd centuries BCE",
    authorshipStatus: "composite",
    author: "confucius",
    attributionNote:
      "The Analects record sayings of Confucius and his disciples. They were compiled by followers over two centuries and contain several layers; the work is not an autograph by Confucius.",
    description:
      "The Analects is the central book of Confucian ethics: twenty books of short sayings and exchanges on learning, ritual propriety, filial conduct, government and the formation of the exemplary person (junzi). Legge's translation is printed here book by book and chapter by chapter, with the Chinese text of the archive's bilingual page beside it, so a saying can be read in the translator's Victorian English and in the received Chinese at once.",
    historicalContext:
      "The sayings took shape during the Warring States period and were edited into their present twenty books in the Han. Zhu Xi's twelfth-century selection of the Analects with the Great Learning, the Doctrine of the Mean and Mencius fixed the Four Books that governed Chinese education and the imperial examinations from 1315. James Legge printed the Analects, with the Chinese text, his translation and his exegetical notes, as the first volume of The Chinese Classics (1893), the edition the archive transcribes here.",
    availabilityNote:
      "Complete in Legge's translation: all twenty books and 496 numbered chapters, streamed from the Internet Sacred Text Archive at read time, one book per chapter of the library's index. The Chinese is the same page's source text, which the archive transcribes for the first ten chapters of each book only; where the Chinese stops, the pane is empty. Legge's exegetical notes, his prolegomena and the volume's other apparatus are not part of the work.",
    translator: "James Legge",
    translationTitle: "The Confucian Analects",
    translationYear: 1893,
    volume: "The Chinese Classics, vol. 1",
    indexUrl: `${CFU}/cfu.htm`,
    ranges: [],
    refScheme: "book.chapter",
    functions: ["canonical_scripture", "philosophical_work"],
    editionNote: "book and chapter index; each chapter is one printed book of the twenty, each passage one of Legge's numbered chapters",
    textStartMarker: "<HR>",
    bilingualPage: {
      englishPattern: "^(?:CHAPTER|CHAP\\.?)\\s+[IVXLCDM]+\\.",
      chinesePattern: "^【第[^】]+章】",
      bookPattern: "^BOOK\\s+[IVXLCDM]+\\.",
      // The English reader drops every line of the Chinese half; the Chinese
      // reader drops the English half and the sheet's own Chinese titles.
      englishSkipPattern: "[\\u3400-\\u9fff]",
      chineseSkipPattern: "^(?:(?![\\u3400-\\u9fff]).)*$|^[\\u4e00-\\u9fff]{1,6}$",
      chineseEdition: {
        slug: "analects-zh",
        language: "zh",
        editionType: "original",
        title: "論語",
        publisher: "Internet Sacred Text Archive",
        publicationYear: null,
        source: "sacred-texts",
        license: "public-domain",
        rightsStatus: "Public domain in the United States",
        attributionText: "論語, the Chinese text printed with Legge's translation in The Chinese Classics, vol. 1. Public domain in the United States. Digital text from the Internet Sacred Text Archive.",
        structureScheme: "book.chapter",
        isSample: false,
        notes: "The archive's bilingual page transcribes the Chinese of the first ten chapters of each book; the remaining chapters carry Legge's English alone.",
      },
      chineseStream: {
        slug: "analects-zh",
        language: "zh",
        languageName: "chinese",
        version: "論語 (Legge's Chinese Classics, vol. 1)",
        license: "public-domain",
        sourceUrl: `${CFU}/cfu.htm`,
      },
    },
  },
  {
    slug: "great-learning",
    title: "The Great Learning",
    originalTitle: "大學",
    transliteration: "Dàxué",
    altTitles: ["Ta Hsüeh", "Da Xue"],
    tradition: "confucianism",
    school: "confucian",
    genre: "Philosophy",
    textType: "Ethical treatise",
    category: "Classics",
    subcategory: "Confucian classics",
    originalLanguage: "zh",
    dateStart: -500,
    dateEnd: -200,
    dateDisplay: "c. 5th–3rd centuries BCE",
    authorshipStatus: "composite",
    author: "confucius",
    attributionNote:
      "The short treatise was transmitted as a chapter of the Book of Rites and was taken up as a separate classic by the Cheng brothers and Zhu Xi, who attributed its text to Confucius and its commentary to his disciple Zengzi. Its composition is usually dated to the Warring States period.",
    description:
      "The Great Learning is the shortest of the Four Books and the one that sets out a programme: to illustrate illustrious virtue, to renovate the people, and to rest in the highest excellence. Its eight steps run from the investigation of things through sincerity and the cultivation of the person to the regulation of the family, the ordering of the state and peace under heaven, and Legge prints the classic with the commentary that accompanies each part.",
    historicalContext:
      "The text circulated inside the Book of Rites until Zhu Xi printed it with the Analects, the Doctrine of the Mean and Mencius as the Four Books, after which it was studied by every candidate for the examinations. Legge translated it for the first volume of The Chinese Classics (1893) with the Chinese text and his own commentary beside it.",
    availabilityNote:
      "Complete in Legge's translation, streamed from the Internet Sacred Text Archive at read time and read as one printed page of the volume, with Legge's paragraphs indexed. The page's Chinese text and the translator's notes belong to the volume's apparatus and are not part of the work.",
    translator: "James Legge",
    translationTitle: "The Great Learning",
    translationYear: 1893,
    volume: "The Chinese Classics, vol. 1",
    indexUrl: "https://sacred-texts.com/book/cfu-conf2/the-great-learning",
    ranges: [],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture", "philosophical_work"],
    editionNote: "chapter and paragraph index; the treatise is one printed page",
    newStyle: { bookUrl: "https://sacred-texts.com/book/cfu-conf2" },
  },
  {
    slug: "doctrine-of-the-mean",
    title: "The Doctrine of the Mean",
    originalTitle: "中庸",
    transliteration: "Zhōngyōng",
    altTitles: ["Chung Yung", "Zhongyong", "The State of Equilibrium and Harmony"],
    tradition: "confucianism",
    school: "confucian",
    genre: "Philosophy",
    textType: "Metaphysical treatise",
    category: "Classics",
    subcategory: "Confucian classics",
    originalLanguage: "zh",
    dateStart: -450,
    dateEnd: -200,
    dateDisplay: "c. 5th–3rd centuries BCE",
    authorshipStatus: "composite",
    author: "confucius",
    attributionNote:
      "Tradition attributes the treatise to Confucius's grandson Zisi, and Zhu Xi read it that way; modern scholarship treats the thirty-three chapters as a composite work of the Warring States period, transmitted as a chapter of the Book of Rites.",
    description:
      "The Doctrine of the Mean is the most metaphysical of the Four Books: the path that may not be left for an instant, equilibrium and harmony as the root and branch of the world, the sincerity by which one may assist the transforming and nourishing powers of heaven and earth, and the portrait of the sage who is 'the equal of heaven'. Legge translates it in thirty-three chapters with the commentary that accompanies them.",
    historicalContext:
      "Like the Great Learning it was lifted out of the Book of Rites and set among the Four Books by Zhu Xi, whose reading gave it a central place in Neo-Confucian thought. Legge translated it for the first volume of The Chinese Classics (1893).",
    availabilityNote:
      "Complete in Legge's translation, streamed from the Internet Sacred Text Archive at read time and read as one printed page of the volume, with Legge's paragraphs indexed. The page's Chinese text and the translator's notes are volume apparatus and are not part of the work.",
    translator: "James Legge",
    translationTitle: "The Doctrine of the Mean",
    translationYear: 1893,
    volume: "The Chinese Classics, vol. 1",
    indexUrl: "https://sacred-texts.com/book/cfu-conf3/the-doctrine-of-the-mean",
    ranges: [],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture", "philosophical_work", "mystical_contemplative"],
    editionNote: "chapter and paragraph index; the treatise is one printed page",
    newStyle: { bookUrl: "https://sacred-texts.com/book/cfu-conf3" },
  },
  {
    slug: "mencius",
    title: "Mencius",
    originalTitle: "孟子",
    transliteration: "Mèngzǐ",
    altTitles: ["Mengzi", "The Works of Mencius"],
    tradition: "confucianism",
    school: "confucian",
    genre: "Philosophy",
    textType: "Dialogues and arguments",
    category: "Classics",
    subcategory: "Confucian classics",
    originalLanguage: "zh",
    dateStart: -320,
    dateEnd: -250,
    dateDisplay: "c. 4th–3rd centuries BCE",
    authorshipStatus: "composite",
    author: "mencius",
    attributionNote:
      "The book is named for Mencius (Meng Ke, c. 371–289 BCE) and was compiled by him and his disciples; the seven books record his arguments with rulers and rival teachers, and their editorship is debated.",
    description:
      "Mencius is the second book of the Four Books: seven books of argument and anecdote in which Meng Ke tells King Hui of Liang what a benevolent government would be, contends that human nature is good and that compassion is its seed, distinguishes the great man from the petty, defends Confucius against the Mohists and the agriculturalists, and sets out the people's right to judge a ruler who has lost heaven's mandate.",
    historicalContext:
      "The book circulated as a separate classic and was elevated into the Four Books by Zhu Xi, who read its teaching of the goodness of human nature as the foundation of Neo-Confucian ethics. James Legge published his translation, with the Chinese text and extensive notes, as the second volume of The Chinese Classics (1895).",
    availabilityNote:
      "Complete in Legge's translation: all seven books as the archive prints them in twenty-eight chapters, streamed from the Internet Sacred Text Archive at read time. Legge's prolegomena, his exegetical notes and the Chinese text are volume apparatus and are not part of the work.",
    translator: "James Legge",
    translationTitle: "The Works of Mencius",
    translationYear: 1895,
    volume: "The Chinese Classics, vol. 2",
    indexUrl: `${CFU}/menc/index.htm`,
    ranges: [{ from: "menc01.htm", to: "menc28.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture", "philosophical_work"],
    editionNote: "chapter and paragraph index; each chapter is one printed chapter of the translation",
    labelsFromHeadings: true,
  },
  {
    slug: "shu-king",
    title: "The Book of Documents",
    originalTitle: "書經",
    transliteration: "Shūjīng",
    altTitles: ["Shu King", "Shu Ching", "The Book of Historical Records", "Classic of History"],
    tradition: "confucianism",
    school: "confucian",
    genre: "Classics",
    textType: "Historical speeches and documents",
    category: "Classics",
    subcategory: "Five Classics",
    originalLanguage: "zh",
    dateStart: -1000,
    dateEnd: -300,
    dateDisplay: "Documents attributed to c. 1000–300 BCE, edited later",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "The documents are speeches and charges attributed to rulers from Yao to the early Zhou; the classic was compiled and edited in the Warring States and Han periods, and a substantial part of the received text is later than the events it reports.",
    description:
      "The Book of Documents is the oldest of the Confucian classics: the canon of Yao and Shun, the counsels of the great Yu, the announcements and charges of the Shang and Zhou kings, the great plan of government, the metal-bound coffer and the marquis of Lü on punishments. Its speeches were the model of Chinese political rhetoric, and Legge translates the whole of the received text in the order of its five parts.",
    historicalContext:
      "The classic was studied as the record of the sage kings and as a source of political models throughout the imperial period. Legge translated it in the Sacred Books of the East, volume 3 (1879), with the Chinese text, a long introduction on its history and credibility, and notes.",
    availabilityNote:
      "Complete in Legge's translation: the thirty books of the five parts, streamed from the Internet Sacred Text Archive at read time, one printed book per chapter. The translator's prolegomena and his use of the chart are volume apparatus and are not part of the work.",
    translator: "James Legge",
    translationTitle: "The Shû King, the Religious Portions of the Shih King, and the Hsiâo King",
    translationYear: 1879,
    volume: "Sacred Books of the East, vol. 3",
    indexUrl: `${CFU}/sbe03/index.htm`,
    ranges: [{ from: "sbe03008.htm", to: "sbe03057.htm" }],
    refScheme: "book.paragraph",
    functions: ["canonical_scripture", "historical_document", "religious_law_practice"],
    editionNote: "book and paragraph index; each chapter is one printed book of the five parts",
    labelsFromHeadings: true,
  },
  {
    slug: "shih-king",
    title: "The Religious Portions of the Book of Poetry",
    originalTitle: "詩經",
    transliteration: "Shījīng",
    altTitles: ["Shih King", "Shi Jing", "The Book of Odes", "Classic of Poetry"],
    tradition: "confucianism",
    school: "confucian",
    genre: "Poetry",
    textType: "Odes and hymns",
    category: "Classics",
    subcategory: "Five Classics",
    originalLanguage: "zh",
    dateStart: -1000,
    dateEnd: -600,
    dateDisplay: "c. 1000–600 BCE",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "The collection gathered court and folk songs, dynastic hymns and sacrificial odes over several centuries. Tradition says Confucius edited the collection down to its present three hundred and five odes; the received text was fixed in the Han.",
    description:
      "The Book of Poetry is the classic of Chinese verse: the airs of the fifteen states, the minor and greater odes of the royal domain, and the sacrificial hymns of Zhou. Its songs of courtship, marriage, war, harvest, feasting and mourning were read by Confucian commentators as moral allegory and are the foundation of Chinese poetry. Legge prints the odes with their religious portions and his own notes.",
    historicalContext:
      "The odes were memorised and quoted by every educated man, and the tradition of reading them as moral instruction runs from the Zuo commentary to Zhu Xi. Legge's translation with the Chinese text forms the Shih King of the Sacred Books of the East, volume 3 (1879), whose prolegomena trace the collection's formation.",
    availabilityNote:
      "Selected: the religious odes and hymns that Legge printed in the Sacred Books of the East, with his introductory sections, streamed from the Internet Sacred Text Archive at read time, one printed ode or section per chapter. The translator's prolegomena are volume apparatus and are not part of the work. His complete Book of Poetry of 1876 is a separate work in this library.",
    translator: "James Legge",
    translationTitle: "The Shih King, or Book of Poetry",
    translationYear: 1879,
    volume: "Sacred Books of the East, vol. 3",
    indexUrl: `${CFU}/sbe03/index.htm`,
    ranges: [{ from: "sbe03065.htm", to: "sbe03175.htm" }],
    refScheme: "ode.paragraph",
    functions: ["canonical_scripture", "religious_law_practice"],
    editionNote: "ode and paragraph index; each chapter is one printed ode or one of Legge's introductory sections",
  },
  {
    slug: "hsiao-king",
    title: "The Classic of Filial Piety",
    originalTitle: "孝經",
    transliteration: "Xiàojīng",
    altTitles: ["Hsiao King", "Xiao Jing", "The Book of Filial Piety"],
    tradition: "confucianism",
    school: "confucian",
    genre: "Classics",
    textType: "Ethical treatise",
    category: "Classics",
    subcategory: "Confucian classics",
    originalLanguage: "zh",
    dateStart: -300,
    dateEnd: -100,
    dateDisplay: "c. 3rd–2nd centuries BCE",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "The treatise is traditionally ascribed to Zengzi recording the words of Confucius, but is generally dated to the Warring States or early Han. Its eighteen short chapters set out the duty of filial piety from the son of heaven down to the common people.",
    description:
      "The Classic of Filial Piety is the short text that made filial duty the root of Confucian ethics: filial piety in the son of heaven, the princes, the ministers, the officers and the common people, the three powers, government by the sages, the five punishments, remonstrance, and mourning for parents. It was read in every school and used by rulers to argue that the state is a family writ large.",
    historicalContext:
      "The classic was commented on by emperors and became one of the most widely printed books in China; its place in the examination canon was secured with the rest of the Confucian corpus. Legge translated it, with the Chinese text, for the Sacred Books of the East, volume 3 (1879).",
    availabilityNote:
      "Complete: the eighteen printed chapters in Legge's translation, streamed from the Internet Sacred Text Archive at read time, one chapter per page. The translator's introduction and his note on the translation are volume apparatus and are not part of the work.",
    translator: "James Legge",
    translationTitle: "The Hsiâo King",
    translationYear: 1879,
    volume: "Sacred Books of the East, vol. 3",
    indexUrl: `${CFU}/sbe03/index.htm`,
    ranges: [{ from: "sbe03181.htm", to: "sbe03198.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture", "religious_law_practice"],
    editionNote: "chapter and paragraph index; each chapter is one printed chapter",
  },
  {
    slug: "li-ki-i",
    title: "The Book of Rites, Part I",
    originalTitle: "禮記",
    transliteration: "Lǐjì",
    altTitles: ["Li Ki", "Li Ji", "The Book of Rites", "Record of Rites"],
    tradition: "confucianism",
    school: "confucian",
    genre: "Classics",
    textType: "Ritual and cosmological texts",
    category: "Classics",
    subcategory: "Five Classics",
    originalLanguage: "zh",
    dateStart: -500,
    dateEnd: 100,
    dateDisplay: "Compiled c. 5th century BCE–1st century CE",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "The Li Ki is a compilation of separate treatises on ritual, government, music and cosmology, drawn from the older texts on rites and edited in the Han; it is not the work of a single author and is not the ritual code it was once taken for.",
    description:
      "The Book of Rites is the great description of Chinese religious and social practice: the rules of propriety and their meaning, mourning and its grades, the monthly ordinances, the state of equilibrium and harmony, royal regulations, the evolution of rites, music, and the conduct of the scholar. Its chapters on the Great Learning and the Doctrine of the Mean were lifted out to become two of the Four Books. This first volume carries books I to X.",
    historicalContext:
      "The compilation was numbered among the Five Classics and shaped the ritual practice of the imperial state. Legge translated the whole of it, with the Chinese text, for the Sacred Books of the East, volumes 27 and 28 (1885).",
    availabilityNote:
      "Complete: books I to X in Legge's translation, streamed from the Internet Sacred Text Archive at read time, one printed book per chapter. The translator's long introduction and his notes are volume apparatus and are not part of the work.",
    translator: "James Legge",
    translationTitle: "The Lî Kî (The Book of Rites), Part I",
    translationYear: 1885,
    volume: "Sacred Books of the East, vol. 27",
    indexUrl: `${CFU}/liki/index.htm`,
    ranges: [{ from: "liki01.htm", to: "liki10.htm" }],
    refScheme: "book.paragraph",
    functions: ["canonical_scripture", "religious_law_practice", "philosophical_work"],
    editionNote: "book and paragraph index; each chapter is one printed book",
  },
  {
    slug: "li-ki-ii",
    title: "The Book of Rites, Part II",
    originalTitle: "禮記",
    transliteration: "Lǐjì",
    altTitles: ["Li Ki, Part II", "Li Ji", "The Book of Rites", "Record of Rites"],
    tradition: "confucianism",
    school: "confucian",
    genre: "Classics",
    textType: "Ritual and cosmological texts",
    category: "Classics",
    subcategory: "Five Classics",
    originalLanguage: "zh",
    dateStart: -500,
    dateEnd: 100,
    dateDisplay: "Compiled c. 5th century BCE–1st century CE",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "The second half of the Li Ki continues the compilation of separate treaties on rites, music, mourning and the state of the empire, edited in the Han and transmitted with Zheng Xuan's commentary.",
    description:
      "Books XI to XLVI of the Record of Rites: the jade-bead pendants and the places in the hall of distinction, the great treatise, the smaller and greater records of mourning, the law and meaning of sacrifices, Confucius at home at ease, the record of the dykes, the state of equilibrium and harmony, the meaning of capping, marriage, archery and the banquet, and the four principles underlying the mourning rites. This volume carries books XI to XLVI.",
    historicalContext:
      "Zheng Xuan's second-century edition and commentary fixed the text, which supplied the ritual chapters of the imperial codes. Legge's translation of the second half forms volumes 28 of the Sacred Books of the East (1885).",
    availabilityNote:
      "Complete: books XI to XLVI in Legge's translation, streamed from the Internet Sacred Text Archive at read time, one printed book per chapter. The volume's title page and Legge's notes are volume apparatus and are not part of the work.",
    translator: "James Legge",
    translationTitle: "The Lî Kî (The Book of Rites), Part II",
    translationYear: 1885,
    volume: "Sacred Books of the East, vol. 28",
    indexUrl: `${CFU}/liki2/index.htm`,
    ranges: [{ from: "liki211.htm", to: "liki246.htm" }],
    refScheme: "book.paragraph",
    functions: ["canonical_scripture", "religious_law_practice", "philosophical_work"],
    editionNote: "book and paragraph index; each chapter is one printed book",
  },
  {
    slug: "yi-king",
    title: "The Yi King",
    originalTitle: "易經",
    transliteration: "Yìjīng",
    altTitles: ["I Ching", "Yijing", "The Book of Changes", "Classic of Changes"],
    tradition: "confucianism",
    school: "confucian",
    genre: "Classics",
    textType: "Divination text with treatises",
    category: "Classics",
    subcategory: "Five Classics",
    originalLanguage: "zh",
    dateStart: -1000,
    dateEnd: -200,
    dateDisplay: "Text c. 1000–800 BCE; appendixes c. 5th–3rd centuries BCE",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "The lineal figures and their judgements are older than Confucius, who is credited by tradition with the appendixes but certainly did not write all of them; the text and the treatises that explain it were formed over centuries and are printed together here.",
    description:
      "The Yi King is the classic of change: sixty-four hexagrams built from broken and unbroken lines, each with its judgement and the texts of its individual lines, followed by the appendixes that read the figures as a cosmology of heaven, earth and man. Confucians studied it as a book of wisdom and of divination at once, and Legge's translation prints the text with the treatises that were ascribed to Confucius.",
    historicalContext:
      "The book escaped the Qin book-burning as a work of divination and was read in the Han through the commentaries of the school of images and numbers; Wang Bi's third-century reading made it a philosophical text again. Legge translated it, with Prolegomena on its history and subject matter, for the Sacred Books of the East, volume 16 (1882).",
    availabilityNote:
      "The text and the appendixes as Legge prints them: the sixty-four hexagrams and the treatises on the trigrams, the sequence of the hexagrams and the appended explanations, streamed from the Internet Sacred Text Archive at read time, one printed section per chapter. Legge's prolegomena, the printed plates and the errata are volume apparatus and are not part of the work.",
    translator: "James Legge",
    translationTitle: "The Yî King",
    translationYear: 1882,
    volume: "Sacred Books of the East, vol. 16",
    indexUrl: "https://sacred-texts.com/book/the-i-ching",
    ranges: [],
    refScheme: "hexagram.paragraph",
    functions: ["canonical_scripture", "philosophical_work", "mystical_contemplative"],
    editionNote: "hexagram and paragraph index; each chapter is one printed hexagram or appendix",
    newStyle: {
      bookUrl: "https://sacred-texts.com/book/the-i-ching",
      from: "i-the-khien-hexagram",
      to: "appendix-vii",
      exclude: ["errata"],
    },
  },
  {
    slug: "book-of-poetry",
    title: "The Book of Poetry",
    originalTitle: "詩經",
    transliteration: "Shījīng",
    altTitles: ["The She King", "Shih Ching", "The Book of Odes"],
    tradition: "confucianism",
    school: "confucian",
    genre: "Poetry",
    textType: "Odes and hymns",
    category: "Classics",
    subcategory: "Five Classics",
    originalLanguage: "zh",
    dateStart: -1000,
    dateEnd: -600,
    dateDisplay: "c. 1000–600 BCE",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "The odes gathered folk and court songs, dynastic hymns and sacrificial verses over several centuries; the collection was fixed at three hundred and five pieces by the Han.",
    description:
      "Legge's 1876 translation of the Shih Ching, the first complete English rendering of the classic with the Chinese text and his commentary: the airs of the states, the odes of the royal domain and the sacrificial hymns, with the introduction that traces the collection's formation and the notes that explain each ode's occasion.",
    historicalContext:
      "Legge's separate translation of the Book of Poetry appeared between his editions of the Four Books and the Sacred Books of the East volumes and carries the fuller scholarly apparatus of the two. It prints the odes with the Chinese text facing the English.",
    availabilityNote:
      "Complete as the volume prints it: the odes of the four parts, streamed from the Internet Sacred Text Archive at read time, one printed ode per chapter. The volume's preface and its introduction are not part of the work; Legge's notes and the Chinese text stand on the pages themselves and are kept, because they are part of the printed page the reader sees.",
    translator: "James Legge",
    translationTitle: "The She King, or the Book of Poetry",
    translationYear: 1876,
    volume: "The Chinese Classics, vol. 4",
    indexUrl: `${CFU}/bop/index.htm`,
    ranges: [{ from: "bop004.htm", to: "bop314.htm" }],
    refScheme: "ode.paragraph",
    functions: ["canonical_scripture", "philosophical_work"],
    editionNote: "ode and paragraph index; each chapter is one printed ode",
  },
  {
    slug: "ethics-of-confucius",
    title: "The Ethics of Confucius",
    originalTitle: "",
    transliteration: "",
    altTitles: ["The Ethics of Confucius: The Sayings of the Master and His Disciples"],
    tradition: "confucianism",
    school: "confucian",
    genre: "Scholarship",
    textType: "Anthology with commentary",
    category: "Scholarship",
    subcategory: "Modern studies",
    originalLanguage: "en",
    dateStart: 1915,
    dateEnd: 1915,
    dateDisplay: "1915",
    authorshipStatus: "established",
    author: "miles-menander-dawson",
    attributionNote:
      "A compilation of translated sayings from the Confucian books, arranged by topic and introduced by Miles Menander Dawson, an American actuary and writer on ethics.",
    description:
      "The Ethics of Confucius arranges the sayings of Confucius and his disciples by theme: what constitutes the superior man, self-development, human relations, the family, the state, the cultivation of the fine arts and universal relations. Dawson's anthology, drawn from the standard translations, was one of the books through which Confucian ethics reached English-speaking readers in the early twentieth century.",
    historicalContext:
      "Published in New York in 1915, the book belongs to the first wave of popular Confucian anthologies written for Western readers. Dawson's chapter heads and his grouping of the sayings, not the arrangement of the Chinese books, govern the order of the text here.",
    availabilityNote:
      "Complete: the seven chapters and the appendix, streamed from the Internet Sacred Text Archive at read time, one chapter per page. The foreword and introduction are the author's own framing and are not part of the work.",
    translator: "",
    translationTitle: "The Ethics of Confucius",
    translationYear: 1915,
    volume: "G. P. Putnam's Sons, New York",
    indexUrl: `${CFU}/eoc/index.htm`,
    ranges: [{ from: "eoc06.htm", to: "eoc13.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["academic_scholarship", "ethical_humanist_manifesto"],
    authored: true,
    editionNote: "chapter and paragraph index; each chapter is one of the author's chapters",
  },
  {
    slug: "confucianism-and-its-rivals",
    title: "Confucianism and Its Rivals",
    originalTitle: "",
    transliteration: "",
    altTitles: ["The Story of Confucianism and Its Rivals"],
    tradition: "confucianism",
    school: "confucian",
    genre: "History",
    textType: "Lectures",
    category: "Scholarship",
    subcategory: "Modern studies",
    originalLanguage: "en",
    dateStart: 1915,
    dateEnd: 1915,
    dateDisplay: "1915",
    authorshipStatus: "established",
    author: "herbert-giles",
    attributionNote:
      "Eight lectures by Herbert Allen Giles (1845–1935), the Cambridge sinologist who also translated the Zhuangzi, the Liezi and much of Chinese literature.",
    description:
      "Confucianism and Its Rivals tells the history of Chinese religion in eight lectures, from the earliest times to 1915: the rise of Confucianism, the challenge of the Taoists and the Buddhists, the fortunes of the literati under Buddhist and Mongol rule, and the state cult of Confucius in the last imperial centuries. Giles writes as a historian of institutions and beliefs rather than as a theologian.",
    historicalContext:
      "The lectures were delivered at the Lowell Institute in Boston and published in London in 1915, a decade before the examination system's Confucian curriculum was dismantled. They record how a nineteenth-century sinologist read the tradition's rivals, and where his judgments have dated.",
    availabilityNote:
      "Complete: the eight lectures, streamed from the Internet Sacred Text Archive at read time, one lecture per chapter. The author's preface is not part of the work.",
    translator: "",
    translationTitle: "Confucianism and Its Rivals",
    translationYear: 1915,
    volume: "Williams and Norgate, London",
    indexUrl: `${CFU}/cair/index.htm`,
    ranges: [{ from: "cair03.htm", to: "cair10.htm" }],
    refScheme: "lecture.paragraph",
    functions: ["academic_scholarship", "historical_document"],
    authored: true,
    editionNote: "lecture and paragraph index; each chapter is one printed lecture",
  },
  {
    slug: "book-of-filial-duty",
    title: "The Book of Filial Duty",
    originalTitle: "孝經",
    transliteration: "Xiàojīng",
    altTitles: ["The Hsiao Ching", "Ivan Chen's Hsiâo Ching"],
    tradition: "confucianism",
    school: "confucian",
    genre: "Classics",
    textType: "Ethical treatise with tales",
    category: "Classics",
    subcategory: "Confucian classics",
    originalLanguage: "zh",
    dateStart: -300,
    dateEnd: -100,
    dateDisplay: "c. 3rd–2nd centuries BCE, with later tales",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "The classic of filial piety is a composite treatise of the Warring States or early Han, traditionally ascribed to Zengzi; the twenty-four tales that follow it are later moral exempla, edited with the text in this edition.",
    description:
      "Ivan Chen's translation of the Classic of Filial Piety, with the twenty-four examples of filial children that Chinese primers attached to it: the emperor who tasted his mother's medicine, the son who carried rice for his parents over a hundred li, the children who warmed the bed or exposed themselves to mosquitoes for their elders. The tales carry the treatise's ethics into the household and show how it was taught.",
    historicalContext:
      "The Hsiao Ching's eighteen chapters circulated with a commentary by the Tang emperor Xuanzong and were used to teach the duty of children to parents and subjects to rulers. The twenty-four examples form a separate popular tradition that was bound with the classic in village schools; Chen's English version, with the Chinese text, was printed in London in 1908.",
    availabilityNote:
      "Complete: the classic's eighteen chapters and the twenty-four examples, streamed from the Internet Sacred Text Archive at read time, one chapter or tale per page. The editorial note and the translator's introduction are volume apparatus and are not part of the work.",
    translator: "Ivan Chen",
    translationTitle: "The Book of Filial Duty",
    translationYear: 1908,
    volume: "John Murray, London",
    indexUrl: `${CFU}/bfd/index.htm`,
    ranges: [{ from: "bfd04.htm", to: "bfd45.htm" }],
    refScheme: "chapter.paragraph",
    functions: ["canonical_scripture", "religious_law_practice", "ethical_humanist_manifesto"],
    editionNote: "chapter and paragraph index; each chapter is one printed chapter of the classic or one of the tales",
  },
  {
    slug: "feast-of-lanterns",
    title: "A Feast of Lanterns",
    originalTitle: "",
    transliteration: "",
    altTitles: ["A Feast of Lanterns: Translations from the Chinese"],
    tradition: "confucianism",
    school: "confucian",
    genre: "Poetry",
    textType: "Translations with commentary",
    category: "Poetry",
    subcategory: "Chinese poetry in translation",
    originalLanguage: "zh",
    dateStart: -1000,
    dateEnd: 1916,
    dateDisplay: "Poems from antiquity to the early 20th century; published 1916",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "A selection of Chinese poems translated by Launcelot Cranmer-Byng, with his introductory essays on Chinese verse form and the epochs of Chinese poetry. The poems are English renderings of Chinese originals, not the work of the translator alone.",
    description:
      "A Feast of Lanterns is an anthology of Chinese poetry in English: the tomb inscriptions and anonymous airs of the earliest period, Tang and Song poems of parting, wine, moonlight and the frontier, and the palace verse of later dynasties, with Cranmer-Byng's essays on how Chinese verse is built and on the periods of its history. Its taste for the short lyric shaped the English reading of Chinese poetry for a generation.",
    historicalContext:
      "Cranmer-Byng edited the Wisdom of the East series, in which this and his Book of Odes appeared; his translations are free, verse-paraphrases rather than literal renderings, and are presented here as English poems made from Chinese originals. The volume was published in London in 1916.",
    availabilityNote:
      "Complete: the poems and the essays on Chinese verse, streamed from the Internet Sacred Text Archive at read time, one poem or section per chapter. The editorial note, the table of contents and the advertisements at the end of the volume are not part of the work.",
    translator: "L. Cranmer-Byng",
    translationTitle: "A Feast of Lanterns",
    translationYear: 1916,
    volume: "John Murray, London",
    indexUrl: `${CFU}/fol/index.htm`,
    ranges: [{ from: "fol11.htm", to: "fol70.htm" }],
    refScheme: "poem.paragraph",
    functions: ["academic_scholarship", "philosophical_work"],
    editionNote: "poem and paragraph index; each chapter is one printed poem or essay",
  },
  {
    slug: "shundai-zatsuwa",
    title: "The Shundai Zatsuwa (A Japanese Philosopher)",
    originalTitle: "春臺雑話",
    transliteration: "Shundai zatsuwa",
    altTitles: ["A Japanese Philosopher", "Shundai Miscellany", "Talks of Shundai"],
    tradition: "confucianism",
    school: "confucian",
    genre: "Philosophy",
    textType: "Discourses",
    category: "Philosophy",
    subcategory: "Japanese Confucianism",
    originalLanguage: "ja",
    dateStart: 1700,
    dateEnd: 1800,
    dateDisplay: "18th century",
    authorshipStatus: "established",
    author: "muro-kyuso",
    attributionNote:
      "Murō Kyūsō (1658–1734) compiled the Shundai zatsuwa from the conversations of his teacher Dazai Shundai and his own notes; the book records the teaching of the Japanese school of Ancient Learning, which read the Confucian texts without the Neo-Confucian commentaries.",
    description:
      "The Shundai Zatsuwa is the record of a Japanese Confucian teacher's talk on the five virtues: benevolence, righteousness, propriety, wisdom and sincerity. Its five books argue that the way of the Chinese sages is the way for Japan, attack Buddhist and Daoist claims, and describe the duties of the samurai and of government. It is the clearest English window on the school of Ancient Learning in Tokugawa Japan.",
    historicalContext:
      "The text was translated by George William Knox and printed in the Transactions of the Asiatic Society of Japan in 1892, and it was this version that the archive transcribed. Its Confucianism is Japanese and Tokugawa: the same classics read in a society organised around warriors and daimyo.",
    availabilityNote:
      "Complete: the five books on the virtues, streamed from the Internet Sacred Text Archive at read time, one book per chapter. The translator's introduction, a separate essay on Japanese Neo-Confucian thought, is not part of the work.",
    translator: "George William Knox",
    translationTitle: "The Shundai Zatsuwa (A Japanese Philosopher)",
    translationYear: 1892,
    volume: "Transactions of the Asiatic Society of Japan, vol. 20",
    indexUrl: `${CFU}/sz/index.htm`,
    ranges: [{ from: "tasj2002.htm", to: "tasj2006.htm" }],
    refScheme: "book.paragraph",
    functions: ["philosophical_work", "academic_scholarship"],
    editionNote: "book and paragraph index; each chapter is one printed book",
  },
];

// ---------------------------------------------------------------------------
// Fetching and page discovery
// ---------------------------------------------------------------------------

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

type Link = { href: string; label: string };

function indexLinks(html: string): Link[] {
  const out: Link[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1] ?? "";
    if (!href || /^(?:https?:|#|mailto:|\/)/i.test(href) || href.includes("../")) continue;
    if (!/\.htm$/i.test(href)) continue;
    // Volume furniture: the running navigation of a transcribed page.
    if (/^(?:index|pageidx|errata)\.htm$/i.test(href)) continue;
    const label = stripMarkup(match[2] ?? "");
    if (!label) continue;
    if (/^(?:next|previous|start reading|title page|contents|index)\b/i.test(label)) continue;
    // Some volume indexes list a page number at the top that points into the
    // middle of the book; taking it would break the printed order.
    if (/^p\.\s*(?:\d+|[ivxlcdm]+)$/i.test(label)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ href, label });
  }
  return out;
}

type RangePage = Link & { prefix?: string; printedChapterNumbers?: boolean; labelPattern?: string };

/** Pages between the first and last link of a range, in printed order. */
function rangePages(links: Link[], range: Range): RangePage[] {
  const start = links.findIndex((link) => link.href === range.from);
  if (start < 0) throw new Error(`the index has no link ${range.from}`);
  const end = links.findIndex((link, index) => index >= start && link.href === range.to);
  if (end < 0) throw new Error(`the index has no link ${range.to} after ${range.from}`);
  return links
    .slice(start, end + 1)
    .map((link) => ({
      href: link.href,
      label: link.label,
      prefix: range.prefix,
      printedChapterNumbers: range.printedChapterNumbers,
      labelPattern: range.labelPattern,
    }));
}

/**
 * The chapter number printed on the page: a numbered heading, or the numbered
 * paragraph some volumes use when a new chapter opens mid-page. A page can
 * carry two chapters, so a range is reported rather than a single number.
 */
function printedChapterLabel(html: string, startMarker: string): string {
  const start = html.indexOf(startMarker);
  if (start < 0) return "";
  const body = html.slice(start);
  const numbers: string[] = [];
  const add = (value: string) => {
    if (!numbers.includes(value)) numbers.push(value);
  };
  for (const match of body.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)) {
    // Footnote anchors print their number after the chapter number ("16 1 .").
    const hit = /^(\d+)(?:\s+\d+)?\s*\.$/.exec(stripMarkup(match[1] ?? ""));
    if (hit) add(hit[1] ?? "");
  }
  for (const match of body.matchAll(/<p[^>]*>\s*(\d{1,3})\.\s*<\/p>/gi)) add(match[1] ?? "");
  if (!numbers.length) return "";
  if (numbers.length === 1) return `Chapter ${numbers[0]}`;
  return `Chapters ${numbers.join(" and ")}`;
}

function resolveUrl(indexUrl: string, href: string): string {
  return new URL(href, indexUrl).toString();
}

/** Two printed pages can share a heading; keep the labels distinguishable. */
/** The printed chapter designation, taken from the page's own heading. */
function headingLabel(html: string, startMarker: string): string {
  const start = html.indexOf(startMarker);
  if (start < 0) return "";
  const fragment = html.slice(start);
  const headingsAt = (level: number) =>
    [...fragment.matchAll(new RegExp(`<h${level}[^>]*>([\\s\\S]*?)<\\/h${level}>`, "gi"))]
      .map((match) =>
        stripMarkup(match[1] ?? "")
          // Footnote anchors print their number after the heading.
          .replace(/\s+\d{1,2}$/, "")
          .replace(/[\s.]+$/, ""),
      )
      .filter((text) => text && !/^footnotes?$/i.test(text));
  // The third-level heading names the chapter (Yasna XXIX), while the fourth
  // is its editorial subtitle. Prefer the designation over the description.
  return headingsAt(3).at(-1) ?? headingsAt(2).at(-1) ?? headingsAt(4).at(-1) ?? "";
}

function distinctLabels(labels: string[]): string[] {
  const counts = new Map<string, number>();
  return labels.map((label) => {
    const seen = (counts.get(label) ?? 0) + 1;
    counts.set(label, seen);
    return seen === 1 ? label : `${label} (${seen})`;
  });
}

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

function writeCache(data: CachedWork) {
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(cachePath(data.slug), `${JSON.stringify(data, null, 2)}\n`);
}

// Newer transcriptions mark the start of the text with the closing rule of the
// site banner (`<HR></p>`); older ones keep only a plain rule after the
// breadcrumb. The marker is chosen from the first page and carried in the
// config, so the reader segments the page exactly as the import did.
const BASE_SEGMENTATION = {
  endMarker: "<nav role=",
  split: "paragraphs" as const,
  dropPageNumbers: true,
};

// The opening rule of a transcribed page, newest form first. A newer banner is
// closed by `<HR></p>`; an older one ends with the rule itself, which keeps the
// banner out of the text; a few pages open under a dotted rule or a plain one.
const START_MARKERS = ["<HR></p>", "at sacred-texts.com</font></p><hr/>", "<HR>.</p>", "<HR>"];

async function buildWork(spec: Spec): Promise<{ chapters: Chapter[]; config: Row }> {
  // A multi-volume work (Milinda, the Vinaya, the Jataka) has one index per
  // volume, so ranges are grouped by the index they come from while keeping
  // the printed order.
  type Page = RangePage & { url: string };
  const pages: Page[] = [];
  const groups = new Map<string, Range[]>();
  for (const range of spec.ranges) {
    const key = range.indexUrl ?? spec.indexUrl;
    groups.set(key, [...(groups.get(key) ?? []), range]);
  }
  for (const [indexUrl, ranges] of groups) {
    const links = indexLinks(await fetchText(indexUrl, 120_000));
    for (const range of ranges) {
      for (const page of rangePages(links, range)) {
        const url = resolveUrl(indexUrl, page.href);
        if (!range.contents) {
          pages.push({ ...page, url });
          continue;
        }
        // A book page lists its hymns between its opening rule and the
        // running navigation; only that body lists chapters (the page header
        // links to the next book and back to the shelf).
        const contentsHtml = await fetchText(url, 120_000);
        const openedAt = contentsHtml.includes("<HR></p>") ? "<HR></p>" : "<HR>";
        const from = contentsHtml.indexOf(openedAt);
        const bodyFrom = from >= 0 ? from + openedAt.length : 0;
        const bodyTo = contentsHtml.indexOf(BASE_SEGMENTATION.endMarker, bodyFrom);
        const body = bodyTo > bodyFrom ? contentsHtml.slice(bodyFrom, bodyTo) : contentsHtml.slice(bodyFrom);
        const contents = indexLinks(body);
        if (!contents.length) throw new Error(`${url} lists no chapters`);
        for (const link of contents) pages.push({ ...link, url: resolveUrl(url, link.href) });
        await Bun.sleep(120);
      }
    }
  }
  if (!pages.length) throw new Error("the index yielded no chapter pages");
  const endMarker = spec.endMarker ?? BASE_SEGMENTATION.endMarker;
  const shortLabel = (page: RangePage) => {
    const raw = page.label ?? "";
    return page.labelPattern ? raw.replace(new RegExp(page.labelPattern), "$1") : raw;
  };
  const titles = distinctLabels(pages.map((page) => (page.prefix ? `${page.prefix}${shortLabel(page)}` : shortLabel(page))));
  const chapters: Chapter[] = [];
  const pageMarkers: string[] = [];
  let startMarker = "";
  for (const [index, page] of pages.entries()) {
    const html = await fetchText(page.url, 120_000);
    // Most pages of a volume open with the same rule, but the archive serves a
    // few older transcriptions with a different one. Each page records the
    // marker that actually opens its text, so the reader segments it the same
    // way the import did.
    const candidates = [
      ...new Set(
        [spec.textStartMarker, startMarker, ...START_MARKERS].filter(
          (candidate): candidate is string => Boolean(candidate),
        ),
      ),
    ];
    let pageMarker = "";
    let segments: string[] = [];
    for (const candidate of candidates) {
      if (!html.includes(candidate)) continue;
      const attempt = extractHtmlSegments(html, { ...BASE_SEGMENTATION, endMarker, startMarker: candidate });
      if (attempt.length) {
        pageMarker = candidate;
        segments = attempt;
        break;
      }
    }
    if (!segments.length) throw new Error(`${page.url} returned no readable text`);
    if (!startMarker) startMarker = pageMarker;
    pageMarkers.push(pageMarker);
    const printed = spec.labelsFromHeadings ? headingLabel(html, pageMarker) : "";
    const numbered = page.printedChapterNumbers ? printedChapterLabel(html, pageMarker) : "";
    const base = printed || numbered || shortLabel(page) || `Chapter ${index + 1}`;
    const label = spec.labelOverrides?.[page.href] ?? (page.prefix ? `${page.prefix}${base}` : base);
    chapters.push({ ref: String(index + 1), label, segments });
    await Bun.sleep(120);
  }
  const finalLabels = distinctLabels(chapters.map((chapter) => chapter.label));
  chapters.forEach((chapter, index) => (chapter.label = finalLabels[index] ?? chapter.label));
  return {
    chapters,
    config: {
      ...BASE_SEGMENTATION,
      ...(spec.endMarker ? { endMarker: spec.endMarker } : {}),
      startMarker,
      pages: pages.map((page, index) => ({
        title: titles[index],
        url: page.url,
        ...(pageMarkers[index] && pageMarkers[index] !== startMarker ? { startMarker: pageMarkers[index] } : {}),
      })),
      sourceUrl: spec.indexUrl,
    },
  };
}

type PageSlice = { title: string; url: string; from: number; to: number };

/** Title-case an all-caps printed heading ("FIRST PART" → "First Part"), keeping roman numerals. */
function titleCaseHeading(text: string): string {
  if (text !== text.toUpperCase()) return text;
  return text
    .split(/(\s+)/)
    .map((word) => {
      if (!word.trim()) return word;
      if (/^[IVXLCDM]+$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join("");
}

/**
 * Import a work that the archive prints as a single page. The page is read
 * once, split at the printed headings, and each chapter records the range of
 * segments it occupies so the reader can serve one chapter at a time from the
 * same page.
 */
async function buildSinglePageWork(spec: Spec): Promise<{ chapters: Chapter[]; config: Row }> {
  const url = spec.indexUrl;
  const html = await fetchText(url, 180_000);
  let startMarker = spec.singlePage?.startMarker ?? "<HR></p>";
  if (!html.includes(startMarker)) startMarker = "<HR>";
  let full = extractHtmlSegments(html, { ...BASE_SEGMENTATION, startMarker });
  if (!full.length) {
    for (const candidate of ["<HR>.</p>", "<HR>"]) {
      const attempt = extractHtmlSegments(html, { ...BASE_SEGMENTATION, startMarker: candidate });
      if (attempt.length) {
        startMarker = candidate;
        full = attempt;
        break;
      }
    }
  }
  if (!full.length) throw new Error(`${url} returned no readable text`);

  const bodyStart = html.indexOf(startMarker) + startMarker.length;
  const bodyEnd = html.indexOf(BASE_SEGMENTATION.endMarker, bodyStart);
  const fragment = bodyEnd > bodyStart ? html.slice(bodyStart, bodyEnd) : html.slice(bodyStart);
  const level = spec.singlePage?.splitHeading ?? 2;
  const partLevel = spec.singlePage?.partHeading;
  const headingPattern = new RegExp(`<h${level}[^>]*>([\\s\\S]*?)<\\/h${level}>`, "gi");
  const headings: { at: number; title: string }[] = [...fragment.matchAll(headingPattern)]
    .map((match) => ({ at: match.index ?? 0, title: stripMarkup(match[1] ?? "") }))
    .filter((heading) => heading.title);
  if (!headings.length) throw new Error(`${url} has no level-${level} headings to split on`);
  // When the text opens at a heading (Macdonell's Reader opens at
  // INTRODUCTION), the matter before the first following heading is that
  // chapter and not a preface, so it is kept rather than dropped.
  // The marker is the opening heading itself, so its text runs to the end of
  // the marker string ("<H1 …>INTRODUCTION").
  const opener = /<h[1-6][^>]*>([\s\S]*)$/i.exec(startMarker)?.[1];
  if (opener && (headings[0]?.at ?? 0) > 0) {
    headings.unshift({ at: 0, title: stripMarkup(opener) });
  }

  const partPattern = partLevel
    ? new RegExp(`<h${partLevel}[^>]*>([\\s\\S]*?)<\\/h${partLevel}>`, "gi")
    : null;
  const parts = partPattern
    ? [...fragment.matchAll(partPattern)].map((match) => ({ at: match.index ?? 0, text: stripMarkup(match[1] ?? "") }))
    : [];

  const chapters: Chapter[] = [];
  const pages: PageSlice[] = [];
  // The reader extracts the whole page and then takes the recorded slice, so
  // each chapter's slice has to exist in the page's own segment sequence. The
  // page's title matter and any skipped preface are simply not covered.
  let cursor = 0;
  for (const [index, heading] of headings.entries()) {
    const at = heading.at;
    const nextAt = headings[index + 1]?.at ?? fragment.length;
    const title = heading.title;
    if (spec.singlePage?.skip?.some((skip) => title.toUpperCase().startsWith(skip.toUpperCase()))) continue;
    const slice = extractHtmlSegments(`${fragment.slice(at, nextAt)}${BASE_SEGMENTATION.endMarker}`, {
      ...BASE_SEGMENTATION,
      startMarker: "",
    });
    if (!slice.length) continue;
    let found = -1;
    for (let candidate = cursor; candidate + slice.length <= full.length && found < 0; candidate++) {
      if (full[candidate] === slice[0] && slice.every((segment, offset) => full[candidate + offset] === segment)) {
        found = candidate;
      }
    }
    if (found < 0) throw new Error(`${spec.slug}: chapter “${title}” is not a slice of the page`);
    const part = [...parts].reverse().find((candidate) => candidate.at < at)?.text ?? "";
    const label = part ? `${titleCaseHeading(part)} — ${titleCaseHeading(title)}` : titleCaseHeading(title);
    chapters.push({ ref: String(chapters.length + 1), label, segments: slice });
    pages.push({ title: label, url, from: found, to: found + slice.length });
    cursor = found + slice.length;
  }
  if (!chapters.length) throw new Error(`${url} yielded no chapters`);
  const finalLabels = distinctLabels(chapters.map((chapter) => chapter.label));
  chapters.forEach((chapter, index) => (chapter.label = finalLabels[index] ?? chapter.label));
  pages.forEach((page, index) => (page.title = finalLabels[index] ?? page.title));
  return {
    chapters,
    config: {
      ...BASE_SEGMENTATION,
      startMarker,
      pages,
      sourceUrl: spec.indexUrl,
    },
  };
}

// ---------------------------------------------------------------------------
// Plain-text volumes and the archive's current book pages
// ---------------------------------------------------------------------------

const NS_SEGMENTATION = {
  startMarker: "<article",
  endMarker: "<nav role=",
  split: "paragraphs" as const,
  dropPageNumbers: true,
};

// The archive's current pages open with the work's date, its title and the
// translator's credit, and close with the site's own furniture. Neither belongs
// to the work.
const CHROME_LEAD = [
  /^\d{1,4}\s*(?:b\.?c\.?e?\.?|a\.?d\.?|ce|bce)$/i,
  /^[^a-z]{3,}$/,
  /^(?:translated|rendered)\s+by\b/i,
  /^(?:[A-Z][a-z]+\s+)?translated\s+by\s/i,
];
const CHROME_TAIL = [
  /^(?:no bookmarks yet|add one from the reader toolbar)/i,
  /^a quiet place in cyberspace/i,
  /^copyright\b/i,
  /^advertisement$/i,
  /^(?:sign in|sign up|toggle theme|chapter|back to book)$/i,
];

function trimPageChrome(segments: string[]): { from: number; to: number } {
  let from = 0;
  let to = segments.length;
  while (from < to && from < 6 && CHROME_LEAD.some((pattern) => pattern.test(segments[from] ?? ""))) from++;
  while (to > from && CHROME_TAIL.some((pattern) => pattern.test(segments[to - 1] ?? ""))) to--;
  return { from, to };
}

/** A chapter slug such as `i-the-khien-hexagram` as a printed title. */
function slugLabel(slug: string): string {
  const small = new Set(["of", "the", "on", "in", "a", "an", "to", "for", "and", "or", "its"]);
  const tokens = slug.split("-").filter(Boolean);
  const parts = tokens.map((token, index) => {
    if (/^[ivxlcdm]{2,}$/.test(token)) return token.toUpperCase();
    if (token === "i" && index === 0) return "I.";
    if (index > 0 && small.has(token)) return token;
    return token.charAt(0).toUpperCase() + token.slice(1);
  });
  return parts.join(" ");
}

function pageHeading(html: string): string {
  const article = html.indexOf("<article");
  const body = article >= 0 ? html.slice(article) : html;
  return stripMarkup(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(body)?.[1] ?? "");
}

/** The printed chapter title of a page on the archive's current site. */
function newStyleLabel(slug: string, heading: string): string {
  if (!heading || /^text section/i.test(heading) || /^the appendixes$/i.test(heading)) return slugLabel(slug);
  const kind = /^appendix\s+[IVXLCDM]+$/i.exec(heading)?.[0];
  if (kind) {
    const rest = slug.replace(/^appendix-[ivxlcdm]+-?/i, "");
    return rest ? `${titleCaseHeading(kind)} — ${slugLabel(rest)}` : titleCaseHeading(kind);
  }
  return titleCaseHeading(heading);
}

/**
 * Import a work the archive now serves from its current book pages: the book's
 * page lists one chapter per page, in printed order, and each page carries the
 * chapter's paragraphs. The page's own chrome is cut away and the slice that
 * remains is recorded, so the reader serves exactly the indexed passages.
 */
async function buildNewStyleWork(spec: Spec): Promise<{ chapters: Chapter[]; config: Row }> {
  const settings = spec.newStyle!;
  const base = settings.bookUrl.replace(/\/+$/, "");
  const path = new URL(base).pathname.replace(/\/+$/, "");
  const seen: string[] = [];
  for (let page = 1; page <= 8; page++) {
    const url = page === 1 ? base : `${base}?chaptersPage=${page}`;
    const html = await fetchText(url, 120_000);
    let fresh = 0;
    for (const match of html.matchAll(new RegExp(`href="${path}/([a-z0-9-]+)"`, "gi"))) {
      const slug = match[1] ?? "";
      if (!slug || seen.includes(slug)) continue;
      seen.push(slug);
      fresh++;
    }
    if (!fresh) break;
    await Bun.sleep(150);
  }
  const start = settings.from ? seen.indexOf(settings.from) : 0;
  if (start < 0) throw new Error(`${base} does not list the chapter ${settings.from}`);
  const end = settings.to ? seen.indexOf(settings.to, start) : seen.length - 1;
  if (end < 0) throw new Error(`${base} does not list the chapter ${settings.to}`);
  const excluded = new Set(settings.exclude ?? []);
  const chosen = seen.slice(start, end + 1).filter((slug) => !excluded.has(slug));
  if (!chosen.length) throw new Error(`${base} listed no chapters`);

  const chapters: Chapter[] = [];
  const pages: PageSlice[] = [];
  for (const slug of chosen) {
    const url = `${base}/${slug}`;
    const html = await fetchText(url, 120_000);
    const all = extractHtmlSegments(html, NS_SEGMENTATION);
    if (!all.length) throw new Error(`${url} returned no readable text`);
    const { from, to } = trimPageChrome(all);
    const segments = all.slice(from, to);
    if (!segments.length) throw new Error(`${url} yielded no text beyond its page furniture`);
    const heading = settings.labelFromSlug?.includes(slug) ? "" : pageHeading(html);
    const label = newStyleLabel(slug, heading);
    chapters.push({ ref: String(chapters.length + 1), label, segments });
    pages.push({ title: label, url, from, to });
    await Bun.sleep(150);
  }
  const finalLabels = distinctLabels(chapters.map((chapter) => chapter.label));
  chapters.forEach((chapter, index) => (chapter.label = finalLabels[index] ?? chapter.label));
  pages.forEach((page, index) => (page.title = finalLabels[index] ?? page.title));
  return {
    chapters,
    config: {
      ...NS_SEGMENTATION,
      pages,
      sourceUrl: base,
    },
  };
}

type ClassicGroup = { label: string; from: number; to: number };

/** A printed book heading ("BOOK II. WEI CHANG.") as a chapter title. */
function bookLabel(heading: string): string {
  const text = heading.replace(/\s+/g, " ").trim();
  return text
    .split(" ")
    .map((word) => (/^[A-Z'\-]+$/i.test(word) ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word))
    .join(" ")
    .replace(/^Book\s+([ivxlcdm]+)/i, "Book $1");
}

/**
 * Read one language out of a bilingual page. Each edition cuts the page with
 * its own chapter markers and drops the other language's lines, so the two
 * editions are two passes over the same transcription; the printed book
 * headings, which are the same lines in both passes, group their chapters.
 */
function scanClassic(
  fragment: string,
  pattern: string,
  skipPattern: string,
  bookPattern: string,
  fallbackLabel: string,
): { blocks: string[]; groups: ClassicGroup[] } {
  const cuts = cutBlocks(fragment, pattern, { dropPattern: bookPattern, skipPattern });
  const blocks = cuts.filter((cut) => !cut.dropped).map((cut) => cut.text);
  const groups: ClassicGroup[] = [];
  let index = 0;
  let current: ClassicGroup | null = null;
  for (const cut of cuts) {
    if (cut.dropped) {
      current = { label: cut.text, from: index, to: index };
      groups.push(current);
      continue;
    }
    if (!current) {
      current = { label: fallbackLabel, from: index, to: index };
      groups.push(current);
    }
    index++;
    current.to = index;
  }
  return { blocks, groups: groups.filter((group) => group.to > group.from) };
}

/**
 * Import a volume the archive transcribed as plain text, with the Chinese and
 * Legge's English printed in alternating blocks. The page is read once: the
 * English blocks are the translation, the Chinese blocks the original (the
 * archive prints the first ten chapters of each book), and the printed book
 * headings group both.
 */
async function buildBilingualPageWork(spec: Spec): Promise<{ chapters: Chapter[]; config: Row }> {
  const settings = spec.bilingualPage!;
  const url = spec.indexUrl;
  const html = await fetchText(url, 180_000);
  const startMarker = [spec.textStartMarker, ...START_MARKERS].find((candidate) => candidate && html.includes(candidate));
  if (!startMarker) throw new Error(`${url} has no opening rule to start the text at`);
  const endMarker = spec.endMarker ?? BASE_SEGMENTATION.endMarker;
  const fragment = sliceHtml(html, startMarker, endMarker);
  if (!fragment) throw new Error(`${url} yielded no body`);

  const english = scanClassic(
    fragment,
    settings.englishPattern,
    settings.englishSkipPattern,
    settings.bookPattern,
    spec.title,
  );
  const chinese = scanClassic(
    fragment,
    settings.chinesePattern,
    settings.chineseSkipPattern,
    settings.bookPattern,
    spec.title,
  );
  if (!english.groups.length) throw new Error(`${url} yielded no English chapters`);
  if (chinese.groups.length !== english.groups.length) {
    throw new Error(
      `${url} groups ${chinese.groups.length} Chinese chapters against ${english.groups.length} English ones`,
    );
  }
  const short = english.groups.findIndex((group, index) => (chinese.groups[index]?.to ?? 0) - (chinese.groups[index]?.from ?? 0) > group.to - group.from);
  if (short >= 0) {
    throw new Error(`${url} prints more Chinese than English chapters in group ${short + 1}`);
  }

  const chapters: Chapter[] = [];
  const pages: PageSlice[] = [];
  const chinesePages: PageSlice[] = [];
  for (const [index, group] of english.groups.entries()) {
    const label = bookLabel(group.label);
    const groups = chinese.groups[index]!;
    chapters.push({
      ref: String(chapters.length + 1),
      label,
      segments: english.blocks.slice(group.from, group.to),
    });
    pages.push({ title: label, url, from: group.from, to: group.to });
    chinesePages.push({ title: label, url, from: groups.from, to: groups.to });
  }
  const finalLabels = distinctLabels(chapters.map((chapter) => chapter.label));
  chapters.forEach((chapter, index) => (chapter.label = finalLabels[index] ?? chapter.label));
  for (const list of [pages, chinesePages]) list.forEach((page, index) => (page.title = finalLabels[index] ?? page.title));

  return {
    chapters,
    config: {
      ...BASE_SEGMENTATION,
      split: "blocks",
      blockPattern: settings.englishPattern,
      blockDropPattern: settings.bookPattern,
      blockSkipPattern: settings.englishSkipPattern,
      startMarker,
      endMarker,
      pages,
      editions: {
        [String(settings.chineseStream.slug)]: {
          pages: chinesePages,
          blockPattern: settings.chinesePattern,
          blockSkipPattern: settings.chineseSkipPattern,
        },
      },
      sourceUrl: url,
    },
  };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const streams = readJson(STREAMS);
const functions = readJson(FUNCTIONS);
const manifest: Row = existsSync(MANIFEST)
  ? readJson(MANIFEST)
  : {
      source: "sacred-texts",
      retrieved_at: RETRIEVED_AT,
      note:
        "Catalogue records, passage indexes and the exact reviewed segments for the Sacred Books of the East volumes. The reader still streams each work from the Internet Sacred Text Archive; the cache is an import and search-index artifact, not a second public copy.",
      works: [],
      totals: {},
    };

function recordWork(entry: Row) {
  const index = manifest.works.findIndex((work: Row) => work.slug === entry.slug);
  if (index >= 0) manifest.works[index] = entry;
  else manifest.works.push(entry);
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
  if (chars < 500) throw new Error(`${slug}: imported text is implausibly short`);
}

/** The extra editions a bilingual volume contributes. */
function extraEditions(spec: Spec): { editions: Row[]; streamEditions: Row[] } {
  const settings = spec.bilingualPage;
  if (!settings) return { editions: [], streamEditions: [] };
  return { editions: [settings.chineseEdition], streamEditions: [settings.chineseStream] };
}

function makeWork(
  spec: Spec,
  chapters: Chapter[],
  config: Row,
  extras: { editions: Row[]; streamEditions: Row[] } = { editions: [], streamEditions: [] },
) {
  const passages = chapters.flatMap((chapter) =>
    chapter.segments.map((_, index) => ({
      reference: `${chapter.ref}.${index + 1}`,
      label: `${chapter.label} §${index + 1}`,
      chapterRef: chapter.ref,
    })),
  );
  const editionSlug = `${spec.slug}-en`;
  const work = {
    slug: spec.slug,
    title: spec.title,
    originalTitle: spec.originalTitle,
    transliteration: spec.transliteration,
    altTitles: spec.altTitles,
    tradition: spec.tradition,
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
    author: spec.author || null,
    attributionNote: spec.attributionNote,
    description: spec.description,
    historicalContext: spec.historicalContext,
    availabilityNote: spec.availabilityNote,
    featured: 0,
    featuredNote: "",
    refScheme: spec.refScheme,
    isSample: false,
    textStorage: "streamed",
    chapters: chapters.map((chapter) => ({ ref: chapter.ref, label: chapter.label })),
    passages,
    editions: [
      {
        slug: editionSlug,
        language: "en",
        editionType: spec.authored ? "original" : "translation",
        title: spec.translationTitle,
        translator: spec.translator,
        publisher: "Internet Sacred Text Archive",
        publicationYear: spec.translationYear,
        source: "sacred-texts",
        license: "public-domain",
        rightsStatus: "Public domain in the United States",
        attributionText: `${spec.translationTitle}${spec.authored ? " by " : ", translated by "}${spec.translator} (${spec.translationYear}). ${spec.volume}. Public domain in the United States. Digital text from the Internet Sacred Text Archive.`,
        structureScheme: spec.editionNote ?? "chapter and paragraph index; segments are the printed paragraphs",
        isSample: false,
        notes:
          "The import cache stores the exact segments that were validated. The reader re-fetches the chapter from the host and reports when the served count no longer matches the index.",
      },
      ...extras.editions,
    ],
  };
  writeFileSync(join(WORKS, `${spec.slug}.json`), `${JSON.stringify(work, null, 2)}\n`);

  streams.works[spec.slug] = {
    provider: "sacred-texts",
    upstream: spec.title,
    mode: "numbered",
    licence: "public-domain",
    config,
    editions: [
      {
        slug: editionSlug,
        language: "en",
        languageName: "english",
        version: spec.translationTitle,
        license: "public-domain",
        sourceUrl: spec.indexUrl,
      },
      ...extras.streamEditions,
    ],
  };
  functions.works[spec.slug] = {
    functions: spec.functions,
    status: "provisional",
    assignedBy: "UWL editors (comparative taxonomy)",
    note: `${spec.title} — ${spec.category}. ${spec.authored ? "Public-domain English study" : "Complete public-domain English translation"} streamed from the Internet Sacred Text Archive (${spec.volume}).`,
  };

  const words = chapters.reduce(
    (sum, chapter) => sum + chapter.segments.reduce((n, text) => n + text.split(/\s+/).filter(Boolean).length, 0),
    0,
  );
  const entry = {
    slug: spec.slug,
    title: spec.title,
    host: "sacred-texts",
    source_url: spec.indexUrl,
    edition: spec.translationTitle,
    translator: spec.translator,
    year: spec.translationYear,
    volume: spec.volume,
    licence: "public-domain",
    chapters: chapters.length,
    passages: passages.length,
    words,
    validation: "aligned",
    retrieved_at: RETRIEVED_AT,
  };
  recordWork(entry);
  console.log(
    `  ${spec.title}: ${chapters.length} chapters, ${passages.length} passages, ${words.toLocaleString()} words`,
  );
  return entry;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (listOnly) {
  for (const spec of SPECS) console.log(`${spec.slug.padEnd(28)} ${spec.title} (${spec.volume})`);
  process.exit(0);
}

const selected = SPECS.filter((spec) => !only || spec.slug === only);
if (!selected.length) {
  console.error(`No Sacred Books of the East volume matches ${only}.`);
  process.exit(1);
}

for (const spec of selected) {
  console.log(`\n${spec.title}`);
  const cached = force ? null : readCache(spec.slug);
  if (cached) {
    assertChapters(spec.slug, cached.chapters);
    if (dryRun) {
      console.log(`  cache holds ${cached.chapters.length} chapters, ${cached.sectionsTotal} sections`);
      continue;
    }
    makeWork(spec, cached.chapters, cached.config ?? {}, extraEditions(spec));
    console.log(`  reused ${cached.chapters.length} cached chapters`);
    continue;
  }
  const { chapters, config } = spec.bilingualPage
    ? await buildBilingualPageWork(spec)
    : spec.newStyle
      ? await buildNewStyleWork(spec)
      : spec.singlePage
        ? await buildSinglePageWork(spec)
        : await buildWork(spec);
  assertChapters(spec.slug, chapters);
  if (dryRun) {
    console.log(
      `  ${chapters.length} chapters, ${chapters.reduce((n, c) => n + c.segments.length, 0)} segments`,
    );
    continue;
  }
  writeCache({
    version: 1,
    slug: spec.slug,
    provider: "sacred-texts",
    sourceUrl: spec.indexUrl,
    generatedAt: new Date().toISOString(),
    complete: true,
    sectionsTotal: chapters.length,
    sectionsImported: chapters.length,
    config,
    chapters,
  });
  makeWork(spec, chapters, config, extraEditions(spec));
}

manifest.totals = {
  works: manifest.works.length,
  chapters: manifest.works.reduce((n: number, work: Row) => n + (work.chapters ?? 0), 0),
  passages: manifest.works.reduce((n: number, work: Row) => n + (work.passages ?? 0), 0),
  words: manifest.works.reduce((n: number, work: Row) => n + (work.words ?? 0), 0),
};
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(STREAMS, `${JSON.stringify(streams, null, 2)}\n`);
writeFileSync(FUNCTIONS, `${JSON.stringify(functions, null, 2)}\n`);
console.log(
  `\nManifest: ${manifest.totals.works} works, ${manifest.totals.passages.toLocaleString()} passages, ` +
    `${manifest.totals.words.toLocaleString()} words.`,
);
