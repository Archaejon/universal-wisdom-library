// The writings of Bahá’u’lláh, read from the Bahá’í Reference Library.
//
//   bun run import:bahai --catalogue     # the library's own indexes, cached
//   bun run import:bahai --all           # every work the library publishes
//   bun run import:bahai --all --limit=5 # the next five works
//   bun run import:bahai                 # the works written out by hand
//   bun run import:bahai --only=hidden-words
//   bun run import:bahai --list
//   bun run import:bahai --force
//   bun run import:bahai --dry-run
//
// Options:
//   --catalogue             walk the library's index pages and its works' own
//                           tables of contents into data/imports/bahai-catalogue.json
//   --all                   import every catalogued work not already held
//   --reregister            rewrite every catalogued work from its cached
//                           chapters without asking the library for anything
//   --limit=<n>             stop after n works
//   --only=<slug>           import one work
//   --section=<name>        walk one of the library's sections
//   --force                 re-read the views rather than the import cache
//   --dry-run               read and report, write nothing
//   --list                  print the works this import knows
//   --delay=<ms>            the gap between index and work pages (never below 1000)
//
// The Reference Library publishes each work as a series of numbered reading
// views (/1, /2, /3 …) and marks up the printed publication inside them: a part
// or chapter title is a heading, a numbered paragraph carries the number the
// library prints, and an unnumbered paragraph carries none. This script walks
// the views a work needs, groups what it finds into the work's own chapters,
// and writes
//   data/corpus/works/<slug>.json            the catalogue record, chapter
//                                            outline and passage index
//   data/imports/cache/bahai/<slug>.json     the paragraphs that were validated,
//                                            for the search index
// and adds the stream record, textual-function classification and manifest
// entry. The text itself is never written to the corpus: the reader fetches the
// views again and shows the copyright notice the library's terms require.
//
// Access was authorised by the project owner on 2026-10-26. The works remain the
// copyright of the Bahá’í International Community; they are streamed from
// bahai.org with its notice and attribution and are not relicensed here.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bahaiBlocks } from "../../server/stream";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");
const STREAMS = join(ROOT, "data", "registry", "streams.json");
const FUNCTIONS = join(ROOT, "data", "corpus", "text-functions.json");
const MANIFEST = join(ROOT, "data", "imports", "bahai.json");
const CACHE = join(ROOT, "data", "imports", "cache", "bahai");
const ACQUISITION = join(ROOT, "data", "registry", "acquisition.json");
// The root of the library: a work's path is what follows /library/ in its own
// address (authoritative-texts/bahaullah/hidden-words, other-literature/…).
const BASE = "https://www.bahai.org/library";
const RETRIEVED_AT = new Date().toISOString().slice(0, 10);
const USER_AGENT = "UniversalWisdomLibrary/1.0 (local reading interface; Baha'i Reference Library import)";
const LICENCE = "bahai-reference-library-terms";
const COPYRIGHT = "Copyright © Bahá’í International Community.";

const args = process.argv.slice(2);
function arg(name: string): string {
  return args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? "";
}
const only = arg("only");
const sectionOnly = arg("section");
const force = args.includes("--force");
const dryRun = args.includes("--dry-run");
const listOnly = args.includes("--list");
const catalogueOnly = args.includes("--catalogue");
const allWorks = args.includes("--all");
// The library is read slowly and never in parallel: index and work pages are
// fetched one at a time, cached on disk, and left alone on a later run.
const PAGE_DELAY_MS = Math.max(1000, Number(arg("delay") ?? 0) || 2000);

type Row = Record<string, any>;
type Block = { heading: string; number: string; text: string };
/** A chapter, and where its paragraphs sit in the views it was read from. */
type Chapter = { ref: string; label: string; fragments: number[]; from: number; to: number; segments: string[]; references: string[] };

/**
 * A group of reading views that forms part of a work. A labelled group is one
 * chapter; an unlabelled group is divided at the work's own headings, so a
 * collection of selections becomes one chapter per selection.
 */
type Group = { label?: string; views: [number, number] };

type Spec = {
  slug: string;
  /** The publication's path under /library/authoritative-texts. */
  path: string;
  title: string;
  originalTitle: string;
  transliteration: string;
  altTitles: string[];
  author: string | null;
  dateStart: number | null;
  dateEnd: number | null;
  dateDisplay: string;
  authorshipStatus: string;
  genre: string;
  textType: string;
  category: string;
  subcategory: string;
  originalLanguage: string;
  attributionNote: string;
  description: string;
  historicalContext: string;
  availabilityNote: string;
  translator: string;
  /**
   * The languages the work was revealed in, as the attribution line names
   * them. Most works are of one language; the later compilations gather both,
   * and the edition record has to say so rather than pick one.
   */
  languageNote?: string;
  /** The whole opening sentence of the attribution line, for a work whose
   * author or manner of composition the default sentence would misstate. */
  attributionLine?: string;
  functions: string[];
  /**
   * How a bare Roman numeral heading reads as a chapter title. The library
   * prints the numbered units of some compilations as a numeral of its own —
   * Gleanings numbers its selections “— LXXXIII —”, Prayers and Meditations
   * numbers its prayers “— C —” — and the numeral is turned into a label with
   * this word. Without it the heading is used as it stands.
   */
  romanLabel?: string;
  groups: Group[];
};

const SPECS: Spec[] = [
  {
    slug: "hidden-words",
    path: "authoritative-texts/bahaullah/hidden-words",
    title: "The Hidden Words",
    originalTitle: "الكلمات المكنونة",
    transliteration: "al-Kalimát al-Maknúnih",
    altTitles: ["Kalimat-i-Maknunih"],
    author: "bahaullah",
    dateStart: 1857,
    dateEnd: 1858,
    dateDisplay: "1857–58",
    authorshipStatus: "established",
    genre: "Scripture",
    textType: "Short passages revealed in Arabic and Persian",
    category: "Scripture",
    subcategory: "Mystical writings",
    originalLanguage: "ar",
    attributionNote:
      "Revealed by Bahá’u’lláh in Baghdad in 1857/58 — the first part in Arabic, the second in Persian — and translated by Shoghi Effendi.",
    description:
      "The Hidden Words is a book of short passages, each one or two sentences long, in which Bahá’u’lláh sets out the inner meaning of the scriptures: that the human being is made to know and to love God, that the world is a veil and the heart the place of revelation, and that justice, truthfulness, contentment and detachment are the conditions of that knowledge. The first part was revealed in Arabic and the second in Persian, and each part numbers its passages from one.",
    historicalContext:
      "Revealed in Baghdad while Bahá’u’lláh was in exile there, the Hidden Words were described by Him as the essence of what the prophets of old had uttered, and they became the first text by which the new teaching was known outside Iran. They are recited by heart across the Bahá’í world.",
    availabilityNote:
      "Complete: both parts — the seventy-one passages from the Arabic and the eighty-two from the Persian — from the Bahá’í Reference Library's authorised English translation, streamed from bahai.org at read time one part at a time, with the library's copyright notice shown with the text.",
    translator: "Shoghi Effendi",
    functions: ["canonical_scripture", "mystical_contemplative"],
    groups: [
      { label: "Part One — From the Arabic", views: [2, 2] },
      { label: "Part Two — From the Persian", views: [3, 3] },
    ],
  },
  {
    slug: "kitab-i-aqdas",
    path: "authoritative-texts/bahaullah/kitab-i-aqdas",
    title: "The Kitáb-i-Aqdas",
    originalTitle: "الكتاب الأقدس",
    transliteration: "al-Kitáb al-Aqdas",
    altTitles: ["The Most Holy Book"],
    author: "bahaullah",
    dateStart: 1873,
    dateEnd: 1873,
    dateDisplay: "1873",
    authorshipStatus: "established",
    genre: "Scripture",
    textType: "Law and doctrine revealed as verses",
    category: "Scripture",
    subcategory: "Law and ordinances",
    originalLanguage: "ar",
    attributionNote:
      "Revealed by Bahá’u’lláh at ‘Akká in 1873, in Arabic, and translated by Shoghi Effendi. The publication also carries texts revealed supplementary to it and the Questions and Answers.",
    description:
      "The Kitáb-i-Aqdas is the book of laws of the Bahá’í Faith: prayer and fasting, marriage and inheritance, the education of children, the appointment of the House of Justice and the treatment of the poor are set out in the same book that abolishes the sword, slavery and the dissolution of marriage without provision, and that addresses the rulers of the earth and tells them what the coming of a new revelation requires of them. Its verses are the source of the ordinances the community lives by, and the institution of the Universal House of Justice is grounded in them.",
    historicalContext:
      "Written while Bahá’u’lláh was imprisoned at ‘Akká and circulated in manuscript before its publication in Bombay, the book is the charter of the Bahá’í order. Shoghi Effendi's authorised translation was published in 1992 with a synopsis and codification of its laws and with the Questions and Answers long treated as part of it.",
    availabilityNote:
      "Complete: the book's 190 numbered paragraphs, the texts revealed supplementary to it, and the Questions and Answers, from the Bahá’í Reference Library's authorised English translation, streamed from bahai.org at read time one chapter at a time. The preface, the introduction, Shoghi Effendi's description of the book, the synopsis and codification, the notes and the key to passages are the publication's editorial apparatus and are not imported.",
    translator: "Shoghi Effendi",
    functions: ["canonical_scripture", "religious_law_practice"],
    groups: [
      { label: "The Kitáb-i-Aqdas", views: [5, 7] },
      { label: "Some Texts Revealed by Bahá’u’lláh Supplementary to the Kitáb-i-Aqdas", views: [8, 8] },
      { label: "Questions and Answers", views: [9, 10] },
    ],
  },
  {
    slug: "kitab-i-iqan",
    path: "authoritative-texts/bahaullah/kitab-i-iqan",
    title: "The Kitáb-i-Íqán: The Book of Certitude",
    originalTitle: "كتاب إيقان",
    transliteration: "Kitáb-i-Íqán",
    altTitles: ["The Book of Certitude"],
    author: "bahaullah",
    dateStart: 1861,
    dateEnd: 1861,
    dateDisplay: "1861",
    authorshipStatus: "established",
    genre: "Scripture",
    textType: "Treatise in prose",
    category: "Scripture",
    subcategory: "Doctrinal writings",
    originalLanguage: "fa",
    attributionNote:
      "Revealed by Bahá’u’lláh in Baghdad in 1861, in Persian, in answer to the uncle of the Báb, and translated by Shoghi Effendi.",
    description:
      "The Book of Certitude answers a question about the return promised in the scriptures, and answers it by reading the scriptures themselves: how the prophets of the past were rejected by the religious leaders of their day for the same reasons, what the language of revelation means when it speaks of the sun rising in the west or of the seal of the prophets, and what it is to know the manifestation of God in the day of the manifestation. It is the book in which the Bahá’í teaching about the unity of the revelations is argued out from the Qur’an, the Bible and the traditions of both.",
    historicalContext:
      "Written in two days in Baghdad in answer to a leading Persian cleric, the Book of Certitude became the doctrinal foundation of the new religion: nearly all later Bahá’í writing on the continuity of revelation and on the interpretation of scripture works from it, and it is the text most often read by those examining the claim itself.",
    availabilityNote:
      "Complete: both parts, 290 paragraphs, from the Bahá’í Reference Library's authorised English translation, streamed from bahai.org at read time one part at a time. The translator's foreword and the notes are the publication's apparatus and are not imported. The library's reading text does not print paragraph numbers, so the index numbers the paragraphs in reading order.",
    translator: "Shoghi Effendi",
    functions: ["canonical_scripture", "philosophical_work"],
    groups: [
      { label: "Part One", views: [2, 4] },
      { label: "Part Two", views: [5, 9] },
    ],
  },
  {
    slug: "seven-valleys",
    path: "authoritative-texts/bahaullah/call-divine-beloved",
    title: "The Seven Valleys",
    originalTitle: "هفت وادی",
    transliteration: "Haft-Vádí",
    altTitles: ["The Seven Valleys and the Four Valleys"],
    author: "bahaullah",
    dateStart: 1856,
    dateEnd: 1860,
    dateDisplay: "c. 1856–60",
    authorshipStatus: "established",
    genre: "Scripture",
    textType: "Mystical treatise in prose",
    category: "Scripture",
    subcategory: "Mystical writings",
    originalLanguage: "fa",
    attributionNote:
      "Revealed by Bahá’u’lláh in Baghdad in Persian, and translated by Shoghi Effendi; the Reference Library publishes it in the collection The Call of the Divine Beloved.",
    description:
      "The Seven Valleys is a Sufi treatise in the form of an answer to a question: the seeker passes through search, love, knowledge, unity, contentment, wonder, and true poverty and annihilation, and at each stage Bahá’u’lláh describes what is seen and how the language of the mystics is to be understood. The earlier Sufi poets and their stories are quoted throughout, and the treatise ends where the mystics end — in what cannot be told.",
    historicalContext:
      "Revealed in Baghdad while the new teaching was being given shape after the Báb, the Seven Valleys is the principal mystical work of the Bahá’í writings, read both as a statement of the Sufi path and as the Bahá’í account of how that path leads further than the stage at which the older teachers stopped.",
    availabilityNote:
      "Complete: the whole treatise as the Bahá’í Reference Library publishes it in The Call of the Divine Beloved, streamed from bahai.org at read time. The companion treatise revealed with it, The Four Valleys, is a separate record in this library; the other tablets in that collection are not imported.",
    translator: "Shoghi Effendi",
    functions: ["canonical_scripture", "mystical_contemplative"],
    groups: [{ label: "The Seven Valleys", views: [4, 4] }],
  },
  {
    slug: "four-valleys",
    path: "authoritative-texts/bahaullah/call-divine-beloved",
    title: "The Four Valleys",
    originalTitle: "چهار وادی",
    transliteration: "Chahár-Vádí",
    altTitles: ["The Seven Valleys and the Four Valleys"],
    author: "bahaullah",
    dateStart: 1856,
    dateEnd: 1860,
    dateDisplay: "c. 1856–60",
    authorshipStatus: "established",
    genre: "Scripture",
    textType: "Mystical treatise in prose",
    category: "Scripture",
    subcategory: "Mystical writings",
    originalLanguage: "fa",
    attributionNote:
      "Revealed by Bahá’u’lláh in Baghdad in Persian, and translated by Shoghi Effendi; the Reference Library publishes it in the collection The Call of the Divine Beloved.",
    description:
      "The Four Valleys describes the ways by which the seeker reaches the goal: through the heart and the loved one, through the spirit and the beauty of God, through the mind and the infinite, and through what the treatise leaves unnamed. It is addressed to a Sufi teacher, draws its argument from the Qur’an and the Persian poets, and stands as the companion to the Seven Valleys.",
    historicalContext:
      "Revealed in the same Baghdad period as the Seven Valleys and addressed to a Sufi leader, it is read with it as the second of the two mystical treatises of the Bahá’í writings, describing the same path by another set of stages.",
    availabilityNote:
      "Complete: the whole treatise as the Bahá’í Reference Library publishes it in The Call of the Divine Beloved, streamed from bahai.org at read time.",
    translator: "Shoghi Effendi",
    functions: ["canonical_scripture", "mystical_contemplative"],
    groups: [{ label: "The Four Valleys", views: [9, 9] }],
  },
  {
    slug: "gleanings-writings-bahaullah",
    path: "authoritative-texts/bahaullah/gleanings-writings-bahaullah",
    title: "Gleanings from the Writings of Bahá’u’lláh",
    originalTitle: "منتخباتی از آثار حضرت بهاءالله",
    transliteration: "Muntakhabátí az Áthár-i-Haḍrat-i-Bahá’u’lláh",
    altTitles: ["Gleanings"],
    author: "bahaullah",
    dateStart: 1853,
    dateEnd: 1892,
    dateDisplay: "Revealed 1853–92; compiled 1935",
    authorshipStatus: "established",
    genre: "Scripture",
    textType: "Compilation of passages from the writings",
    category: "Scripture",
    subcategory: "Compilations",
    originalLanguage: "ar",
    attributionNote:
      "Passages revealed by Bahá’u’lláh between 1853 and 1892, selected and translated by Shoghi Effendi, who published the compilation in 1935 and arranged its selections in an order of his own.",
    description:
      "Gleanings gathers the selections from Bahá’u’lláh's writings — from the Book of Certitude, the Epistle to the Son of the Wolf and the Kitáb-i-Aqdas, and from tablets addressed to kings and to individual believers — into a single book arranged by the Guardian of the Cause as a compendium of the teaching. It is the work through which the writings became generally known in English.",
    historicalContext:
      "The first compilation of the writings of Bahá’u’lláh made in English, published in 1935 by Shoghi Effendi, and still the standard introduction to the writings; the order of its selections is the translator-compiler's rather than the order of revelation.",
    availabilityNote:
      "Complete: all one hundred and sixty-six selections of the compilation, streamed from bahai.org at read time one selection at a time. The library's reading text does not carry the printed selection numbers, so each selection is indexed by its own heading.",
    translator: "Shoghi Effendi",
    functions: ["canonical_scripture"],
    romanLabel: "Selection",
    groups: [{ views: [2, 8] }],
  },
  {
    slug: "some-answered-questions",
    path: "authoritative-texts/abdul-baha/some-answered-questions",
    title: "Some Answered Questions",
    originalTitle: "مفاوضات",
    transliteration: "Mufáviḍát",
    altTitles: ["Mufávidát"],
    author: "abdul-baha",
    dateStart: 1904,
    dateEnd: 1906,
    dateDisplay: "1904–06",
    authorshipStatus: "established",
    genre: "Scripture",
    textType: "Answers and discourses in prose",
    category: "Scripture",
    subcategory: "Doctrinal writings",
    originalLanguage: "fa",
    attributionNote:
      "Talks given by ‘Abdu’l-Bahá at ‘Akká in 1904–06, taken down and translated from the Persian by Laura Clifford Barney and newly revised by a committee at the Bahá’í World Centre.",
    description:
      "Some Answered Questions is the book in which the Bahá’í teaching is set out in the form of answers to questions: a Western visitor put her questions to ‘Abdu’l-Bahá at ‘Akká over two years and the answers were written down and arranged as eighty-four chapters in five parts. The first part argues the influence of the prophets in the evolution of humanity and the proofs of the existence of an educator sent from God; the second answers Christian subjects — the Trinity, the return of Christ, baptism, the Eucharist, the meaning of the resurrection and of the miracles; the third treats the powers and conditions of the Manifestations of God; the fourth the origin and powers of man — the soul and its immortality, free will and predestination, healing, dreams, the degrees of existence; and the fifth miscellaneous subjects, from the non-existence of evil and the unity of the human race to the influence of the press and of civilisation. It is the standard reference for the Bahá’í position on Christian doctrine, on science and religion, and on the reading of scripture.",
    historicalContext:
      "The talks were given while ‘Abdu’l-Bahá was still confined at ‘Akká, before His journeys to the West, and they are the first systematic presentation of the teachings to a Western audience. Translated by the visitor who asked the questions and published in English in 1908, the book was revised at the Bahá’í World Centre, and it remains the work most often cited for what the Bahá’í writings teach on the questions raised against them.",
    availabilityNote:
      "Complete: all eighty-four chapters of the five parts, streamed from bahai.org at read time one part at a time, with the library's copyright notice. The foreword, the author's preface to the first edition and the notes at the end are the publication's apparatus and are not imported. The chapters and the paragraphs within them are numbered as the publication numbers them, and those numbers are the passage references.",
    translator: "Laura Clifford Barney, revised at the Bahá’í World Centre",
    attributionLine:
      "Some Answered Questions, talks given by ‘Abdu’l-Bahá at ‘Akká in 1904–06, collected and translated from the Persian by Laura Clifford Barney and newly revised by a committee at the Bahá’í World Centre",
    functions: ["canonical_scripture", "philosophical_work"],
    groups: [{ views: [4, 13] }],
  },
  {
    slug: "epistle-son-wolf",
    path: "authoritative-texts/bahaullah/epistle-son-wolf",
    title: "The Epistle to the Son of the Wolf",
    originalTitle: "لوح ابن الذئب",
    transliteration: "Lawḥ-i-Ibn-i-Dhiʼb",
    altTitles: ["Epistle to the Son of the Wolf"],
    author: "bahaullah",
    dateStart: 1891,
    dateEnd: 1891,
    dateDisplay: "1891",
    authorshipStatus: "established",
    genre: "Scripture",
    textType: "Epistle in prose",
    category: "Scripture",
    subcategory: "Epistles and tablets",
    originalLanguage: "fa",
    attributionNote:
      "Revealed by Bahá’u’lláh at ‘Akká in 1891, in Persian and Arabic, addressed to the son of the Wolf — the son of the cleric who had put the Báb to death and who persecuted the believers of Isfahán — and translated by Shoghi Effendi.",
    description:
      "The Epistle to the Son of the Wolf is the last of the major works of Bahá’u’lláh, written a year before His death and addressed to the son of the persecutor. It recounts the wrongs He suffered, from the dungeon of Ṭihrán to the prison of ‘Akká, and it argues its case out of His own writings: long passages of the Kitáb-i-Aqdas, the Book of Certitude, the Hidden Words and the tablets of the later years are gathered into it, with the summons to the divines to judge with justice, the testimony of the world's scriptures, and the moral teaching — that the peoples of the earth are one, that they are to consort in friendliness, that knowledge and craftsmanship are worship, and that the rulers are answerable for the order of the world. It is read both as the summary of the revelation and as the record of what the community had borne.",
    historicalContext:
      "Written at Bahjí in 1891, when the writings had been given their law in the Kitáb-i-Aqdas and its author was near the end of His life, the epistle takes the form of a letter to Shaykh Muhammad-Báqir, the son of the Wolf, and was carried to him. Shoghi Effendi's English translation, published in 1941, has been the standard English text since.",
    availabilityNote:
      "Complete: the whole epistle, streamed from bahai.org at read time, with the library's copyright notice. The publication's reading text carries no paragraph numbers, so the paragraphs are indexed in reading order.",
    translator: "Shoghi Effendi",
    languageNote: "Persian and Arabic",
    functions: ["canonical_scripture", "historical_document"],
    groups: [{ label: "The Epistle to the Son of the Wolf", views: [2, 4] }],
  },
  {
    slug: "tablets-bahaullah",
    path: "authoritative-texts/bahaullah/tablets-bahaullah",
    title: "Tablets of Bahá’u’lláh Revealed after the Kitáb-i-Aqdas",
    originalTitle: "",
    transliteration: "",
    altTitles: ["Tablets of Bahá’u’lláh"],
    author: "bahaullah",
    dateStart: 1873,
    dateEnd: 1892,
    dateDisplay: "1873–92",
    authorshipStatus: "established",
    genre: "Scripture",
    textType: "Tablets and letters revealed after the Kitáb-i-Aqdas",
    category: "Scripture",
    subcategory: "Epistles and tablets",
    originalLanguage: "fa",
    attributionNote:
      "Tablets revealed by Bahá’u’lláh at ‘Akká and Bahjí after the Kitáb-i-Aqdas, between about 1873 and 1892, in Persian and Arabic; the collection was compiled by the Research Department of the Universal House of Justice and translated by Habib Taherzadeh with the assistance of a committee at the Bahá’í World Centre.",
    description:
      "The Tablets of Bahá’u’lláh gathers the sixteen tablets revealed after the Kitáb-i-Aqdas, with an appendix of excerpts from other tablets, that define the order the book of laws left to be established: the Tablet of Carmel and the Lawḥ-i-Arḍ-i-Bá on the station of the Holy Land, the Tablet of the World, Glad-Tidings and the Words of Paradise on the ordinances of the community and its institutions, the Tablet of Wisdom on knowledge and the arts, the Tablet of Maqṣúd and the Words of Wisdom on the moral life, the Tablet of the Proof and the tablet to Siyyid Mihdíy-i-Dahají on those who had turned away, and the Kitáb-i-‘Ahd, the Book of the Covenant, in which the line of authority after Bahá’u’lláh is written down. Read together with the Kitáb-i-Aqdas they are the constitutional writings of the Faith.",
    historicalContext:
      "The tablets belong to the ‘Akká and Bahjí years, when the laws of the Kitáb-i-Aqdas were being applied and the community was being given its shape; the Kitáb-i-‘Ahd appoints ‘Abdu’l-Bahá as the Centre of the Covenant and is the charter of the unity of the community. The collection was published in English in 1978 as the standard companion to the Kitáb-i-Aqdas, and its translations are by Habib Taherzadeh with a committee at the Bahá’í World Centre.",
    availabilityNote:
      "Complete: the seventeen sections of the compilation — the sixteen tablets and the excerpts from other tablets — streamed from bahai.org at read time one tablet at a time, with the library's copyright notice. The note on the translations of Shoghi Effendi and the notes at the end are the publication's apparatus and are not imported. The collection is a compilation made in English and has no original title of its own; each tablet keeps the name the publication gives it.",
    translator: "Habib Taherzadeh, with a committee at the Bahá’í World Centre",
    languageNote: "Persian and Arabic",
    functions: ["canonical_scripture", "religious_law_practice"],
    groups: [{ views: [2, 7] }],
  },
  {
    slug: "prayers-meditations",
    path: "authoritative-texts/bahaullah/prayers-meditations",
    title: "Prayers and Meditations by Bahá’u’lláh",
    originalTitle: "مناجات",
    transliteration: "Munáját",
    altTitles: ["Prayers and Meditations"],
    author: "bahaullah",
    dateStart: 1853,
    dateEnd: 1892,
    dateDisplay: "Revealed 1853–92; compiled 1938",
    authorshipStatus: "established",
    genre: "Scripture",
    textType: "Prayers and meditations revealed in Persian and Arabic",
    category: "Scripture",
    subcategory: "Prayers and meditations",
    originalLanguage: "ar",
    attributionNote:
      "Prayers and meditations revealed by Bahá’u’lláh between 1853 and 1892, in Arabic and Persian, selected and translated by Shoghi Effendi, who published the compilation in 1938.",
    description:
      "Prayers and Meditations is the devotional book of the Bahá’í writings: the prayers and meditations revealed by Bahá’u’lláh through the years of exile, arranged by Shoghi Effendi as a book of devotion. They are the voice of a servant before God — confession of poverty and of sin, petition for forgiveness and for steadfastness under persecution, praise of the beauty of the Beloved, and the meditation on what prayer is, including the long meditations of the last years in which the Manifestation speaks of the fire of separation and the cup of bounty. Bahá’ís recite them daily and in the observances of the community, and they are the source of most of the prayers used in Bahá’í worship.",
    historicalContext:
      "The compilation draws on prayers and meditations of all the periods of Bahá’u’lláh's ministry, from the Baghdad years and the exile to Adrianople and ‘Akká; Shoghi Effendi's arrangement of them, published in English in 1938, is the standard text, and its numbering is the one Bahá’í reference works cite.",
    availabilityNote:
      "Complete: all one hundred and eighty-four prayers and meditations of the compilation, streamed from bahai.org at read time one prayer at a time, with the library's copyright notice. The publication numbers the prayers but not their paragraphs, so each prayer is indexed by the library's own numeral and its paragraphs in reading order.",
    translator: "Shoghi Effendi",
    languageNote: "Arabic and Persian",
    functions: ["canonical_scripture", "prayer_liturgy"],
    romanLabel: "Prayer",
    groups: [{ views: [2, 7] }],
  },
];

// ---------------------------------------------------------------------------
// Reading the Reference Library
// ---------------------------------------------------------------------------

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

// A view is read once per run: the importer asks for a work's views twice — once
// to find where the work ends, once to build its chapters — and a work of this
// library can run to a dozen views.
const viewCache = new Map<string, string>();

async function fetchView(url: string): Promise<string> {
  const seen = viewCache.get(url);
  if (seen) return seen;
  let last: Error | null = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "text/html", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status === 404) throw new Error(`${url} returned 404`);
      if (res.status === 429 || res.status >= 500) {
        last = new Error(`${url} returned ${res.status}`);
        await Bun.sleep(1200 * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      const body = await res.text();
      viewCache.set(url, body);
      return body;
    } catch (err) {
      last = err as Error;
      if (attempt < 4) await Bun.sleep(700 * attempt);
    }
  }
  throw last ?? new Error(`${url} failed`);
}

const viewUrl = (spec: Spec, view: number) => `${BASE}/${spec.path}/${view}`;

// ---------------------------------------------------------------------------
// The library's catalogue
//
// The Reference Library is a sectioned catalogue of its own: two landing pages
// name the sections (the writings by author, the prayers, the compilations, and
// the literature that is not authoritative text), each section page lists the
// works on it, and each work's own page carries the table of contents the reader
// is offered — one entry per part, chapter or tablet, each pointing at the
// reading view it opens in. This walks those three levels once and keeps what it
// finds, so that the import can be driven by the site's catalogue rather than by
// a list written out by hand.
// ---------------------------------------------------------------------------

const LIBRARY = "https://www.bahai.org/library";
const CATALOGUE = join(ROOT, "data", "imports", "bahai-catalogue.json");
const PAGES = join(CACHE, "pages");

/** A page's own text, with its entities decoded and its whitespace collapsed. */
function describe(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&#0?39;|&rsquo;|&#8217;/g, "’")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every anchor of a page, with its text, as the page prints it. */
function anchorsOf(html: string): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]{0,300}?)<\/a>/g)) {
    const text = (match[2] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#39;|&rsquo;/g, "’")
      .replace(/\s+/g, " ")
      .trim();
    out.push({ href: match[1]!, text });
  }
  return out;
}

/** A page of the library, read once and kept on disk for the next run. */
async function cachedPage(url: string): Promise<string> {
  mkdirSync(PAGES, { recursive: true });
  const file = join(PAGES, `${url.replace(/^https?:\/\//, "").replace(/[?#].*$/, "").replace(/[^a-z0-9.]+/gi, "-").replace(/-+$/, "")}.html`);
  if (!force && existsSync(file)) return readFileSync(file, "utf8");
  const html = await fetchView(url);
  writeFileSync(file, html);
  await Bun.sleep(PAGE_DELAY_MS);
  return html;
}

/**
 * The parts a work's own table of contents names, in reading order: the reading
 * view each one opens in and the anchor that marks where in that view it begins.
 * A part whose view is not stated is not a part but a download, and is left out.
 */
function tocOf(html: string, path: string): { view: number; anchor: string; label: string }[] {
  const prefix = `/library/${path}/`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const seen = new Set<string>();
  const parts: { view: number; anchor: string; label: string }[] = [];
  for (const link of anchorsOf(html)) {
    const match = new RegExp(`^${prefix}(\\d+)(?:#([^#]*))?$`).exec(link.href);
    if (!match) continue;
    const key = `${match[1]}#${match[2] ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push({ view: Number(match[1]), anchor: match[2] ?? "", label: link.text.replace(/\s*»\s*$/, "") });
  }
  return parts;
}

/** The library's own section pages: the writings by author, and the rest. */
async function librarySections(): Promise<{ url: string; section: string; subsection: string; label: string }[]> {
  const sections: { url: string; section: string; subsection: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const section of ["authoritative-texts", "other-literature"]) {
    const html = await cachedPage(`${LIBRARY}/${section}`);
    for (const link of anchorsOf(html)) {
      const href = link.href.replace(/[?#].*$/, "").replace(/\/+$/, "");
      if (!href.startsWith(`/library/${section}/`)) continue;
      const rest = href.slice(`/library/${section}/`.length).split("/");
      if (rest.length !== 1 || !rest[0]) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      sections.push({ url: `https://www.bahai.org${href}`, section, subsection: rest[0]!, label: link.text });
    }
  }
  return sections;
}

/**
 * Walks the library: the two landing pages, the section pages, and each work's
 * own page for its title and the parts its table of contents names. The result is
 * a catalogue of works, not of texts: it records where a work is published, how
 * many reading views it needs and what its parts are called, and nothing of what
 * it says.
 */
async function buildCatalogue() {
  const sections = await librarySections();
  console.log(`sections: ${sections.length}`);
  const works = new Map<string, Row>();
  for (const section of sections) {
    if (sectionOnly && section.subsection !== sectionOnly) continue;
    const html = await cachedPage(section.url);
    const base = `/library/${section.section}/${section.subsection}`;
    let added = 0;
    for (const link of anchorsOf(html)) {
      const href = link.href.replace(/[?#].*$/, "").replace(/\/+$/, "");
      if (!href.startsWith(`${base}/`)) continue;
      if (href.slice(base.length + 1).includes("/")) continue;
      const path = href.slice("/library/".length);
      if (works.has(path)) continue;
      works.set(path, {
        slug: path.split("/").pop()!,
        path,
        url: `https://www.bahai.org${href}`,
        section: section.section,
        subsection: section.subsection,
        sectionLabel: section.label.replace(/\s*»\s*$/, ""),
        title: link.text.replace(/\s*»\s*$/, ""),
      });
      added++;
    }
    console.log(`  ${section.subsection} (${section.label}): ${added} work(s) (${works.size} so far)`);
  }

  let withoutContents = 0;
  for (const work of works.values()) {
    const html = await cachedPage(String(work.url));
    const parts = tocOf(html, String(work.path));
    await Bun.sleep(PAGE_DELAY_MS);
    work.parts = parts;
    work.views = parts.length ? Math.max(...parts.map((part) => part.view)) : 0;
    // The library's own one-line description of the work, which its pages carry
    // for search engines: the invented part of a record built by this pass, and
    // the only biographical matter the site states about a work in one place.
    const described = /<meta\s+name="description"\s+content="([^"]*)"/i.exec(html)?.[1] ?? "";
    work.description = describe(described);
    work.pageTitle = parts[0]?.label || String(work.title);
    if (!parts.length) withoutContents++;
  }

  const catalogue = {
    version: 1,
    source: "bahai-reference-library",
    sourceUrl: `${LIBRARY}/`,
    generatedAt: new Date().toISOString().slice(0, 10),
    note:
      "Every work the Bahá’í Reference Library publishes under Authoritative Writings and Guidance and " +
      "Other Bahá’í Literature, as the library's own index pages list them, with the parts its works' tables " +
      "of contents name and the reading view each part opens in. The catalogue records where a work is " +
      "published and how it is divided, not what it says; the texts remain the copyright of the Bahá’í " +
      "International Community and are streamed, not copied.",
    counts: { sections: sections.length, works: works.size, withoutContents, views: [...works.values()].reduce((n, w) => n + Number(w.views ?? 0), 0) },
    works: [...works.values()],
  };
  if (!dryRun) writeFileSync(CATALOGUE, `${JSON.stringify(catalogue, null, 2)}\n`);
  console.log(
    `catalogue: ${works.size} work(s) in ${sections.length} sections, ${catalogue.counts.views} reading views ` +
      `${withoutContents ? `(${withoutContents} without a table of contents) ` : ""}written to ${CATALOGUE}`,
  );
  return catalogue;
}

/** The chapters of one work, in the order the reader will meet them. */
async function buildChapters(spec: Spec): Promise<{ chapters: Chapter[]; fragments: string[] }> {
  const fragments: string[] = [];
  const chapters: Chapter[] = [];
  let index = 0;
  for (const group of spec.groups) {
    const ownFragments: number[] = [];
    const blocks: Block[] = [];
    for (let view = group.views[0]; view <= group.views[1]; view++) {
      const url = viewUrl(spec, view);
      ownFragments.push(fragments.length);
      fragments.push(url);
      const html = await fetchView(url);
      blocks.push(...bahaiBlocks(html));
      await Bun.sleep(250);
    }
    // The paragraphs of the group, in order: this is what the reader rebuilds
    // when it fetches the same views again.
    const paragraphs = blocks.filter((block) => block.text);
    if (!paragraphs.length) throw new Error(`${spec.slug}: views ${group.views.join("–")} yielded no paragraphs`);

    const slices: { label: string; from: number; to: number }[] = [];
    if (group.label) {
      slices.push({ label: group.label, from: 0, to: paragraphs.length - 1 });
    } else {
      // An unlabelled group is a collection of selections: the work's own
      // headings divide it, each heading opening a new selection. A heading
      // that follows another before any paragraph belongs to the same title
      // (a part and then its chapter name).
      let current: { label: string; from: number; to: number } | null = null;
      let seen = 0;
      const labelOf = (heading: string) => {
        const clean = heading.replace(/^[\s–—·-]+/, "").replace(/[\s–—·-]+$/, "").trim();
        if (spec.romanLabel && /^[IVXLCDM]+$/i.test(clean)) return `${spec.romanLabel} ${clean.toUpperCase()}`;
        return clean || heading;
      };
      for (const block of blocks) {
        if (block.heading) {
          if (current && current.to >= current.from) {
            slices.push(current);
            current = { label: labelOf(block.heading), from: seen, to: seen - 1 };
          } else if (current) {
            current.label = `${current.label} — ${labelOf(block.heading)}`;
          } else {
            current = { label: labelOf(block.heading), from: seen, to: seen - 1 };
          }
          continue;
        }
        if (!block.text) continue;
        if (!current) current = { label: `Selection ${slices.length + 1}`, from: seen, to: seen };
        current.to = seen;
        seen++;
      }
      if (current && current.to >= current.from) slices.push(current);
    }

    for (const slice of slices) {
      const taken = paragraphs.slice(slice.from, slice.to + 1);
      if (!taken.length) continue;
      // A chapter that carries the library's own numbers is indexed by them.
      // The invocation and the closing lines of such a chapter are printed
      // without a number, so they are indexed u1, u2 … in reading order; a
      // chapter the library numbers nowhere is indexed in reading order.
      const numbered = taken.some((block) => block.number);
      const used = new Set<string>();
      const segments = taken.map((block, position) => {
        let reference = numbered ? block.number || `u${position + 1}` : String(position + 1);
        while (used.has(reference)) reference = `${reference}#${used.size + 1}`;
        used.add(reference);
        return { reference, text: block.text };
      });
      chapters.push({
        ref: String(++index),
        label: slice.label.trim(),
        fragments: ownFragments,
        from: slice.from,
        to: slice.to,
        segments: segments.map((segment) => segment.text),
        references: segments.map((segment) => segment.reference),
      });
    }
  }
  if (!chapters.length) throw new Error(`${spec.slug}: no chapters were built`);
  return { chapters, fragments };
}

function assertChapters(slug: string, chapters: Chapter[]) {
  const refs = new Set<string>();
  let chars = 0;
  for (const chapter of chapters) {
    if (refs.has(chapter.ref)) throw new Error(`${slug}: duplicate chapter reference ${chapter.ref}`);
    refs.add(chapter.ref);
    if (!chapter.segments.length) throw new Error(`${slug}: chapter ${chapter.ref} has no paragraphs`);
    if (chapter.segments.length !== chapter.references.length) {
      throw new Error(`${slug}: chapter ${chapter.ref} has ${chapter.segments.length} paragraphs and ${chapter.references.length} references`);
    }
    for (const text of chapter.segments) {
      if (!text.trim()) throw new Error(`${slug}: chapter ${chapter.ref} has an empty paragraph`);
      if (/<[a-z/]/.test(text)) throw new Error(`${slug}: chapter ${chapter.ref} still carries markup`);
      if (/\u0000/.test(text)) throw new Error(`${slug}: chapter ${chapter.ref} carries an index separator`);
      chars += text.length;
    }
  }
  if (chars < 400) throw new Error(`${slug}: the imported text is implausibly short`);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const streams = readJson(STREAMS);
const functions = readJson(FUNCTIONS);
const acquisition: Row = existsSync(ACQUISITION) ? readJson(ACQUISITION) : { targets: [] };
const manifest: Row = existsSync(MANIFEST)
  ? readJson(MANIFEST)
  : {
      source: "bahai-reference-library",
      work_url: `${BASE}/`,
      retrieved_at: RETRIEVED_AT,
      note:
        "Catalogue records, chapter outlines, passage indexes and the paragraphs that were reviewed from the Bahá’í writings published by the Bahá’í Reference Library. The reader streams each work from bahai.org at read time with the library's copyright notice; the cache is an import and search-index artifact, not a second public copy, and nothing is relicensed.",
      works: [],
      totals: {},
    };

manifest.leads ??= [];

function recordWork(entry: Row) {
  const at = manifest.works.findIndex((work: Row) => work.slug === entry.slug);
  if (at >= 0) manifest.works[at] = entry;
  else manifest.works.push(entry);
}

/**
 * A work the library catalogues but serves only as a download: it has no reading
 * views, so there is nothing to stream and nothing to index. It is kept as a
 * lead, with the reason the import could not take it, rather than being dropped
 * and looked for again.
 */
function recordLead(spec: Spec, reason: string, note: string) {
  const lead: Row = {
    slug: spec.slug,
    path: spec.path,
    title: spec.title,
    author: spec.author,
    category: spec.category,
    url: `${BASE}/${spec.path}`,
    reason,
    note,
    at: RETRIEVED_AT,
  };
  const at = manifest.leads.findIndex((item: Row) => item.path === lead.path);
  if (at >= 0) manifest.leads[at] = lead;
  else manifest.leads.push(lead);
  console.log(`  ${spec.path}: ${reason} — ${note}`);
}

/**
 * The acquisition register carries the editorial trail: a work the register
 * already asked for keeps its own entry, and a work it never listed is added as
 * soon as it is imported, so that every streamed Bahá’í text has a recorded
 * rights position and source lead rather than appearing from nowhere.
 */
function recordTarget(spec: Spec) {
  const workUrl = `${BASE}/${spec.path}`;
  const entry: Row = {
    slug: spec.slug,
    title: spec.title,
    original_title: spec.originalTitle,
    transliteration: spec.transliteration,
    author: spec.author,
    tradition: "bahai",
    school: "",
    genre: spec.genre,
    category: spec.category,
    status: "imported",
    priority: ["hidden-words", "kitab-i-aqdas", "kitab-i-iqan"].includes(spec.slug) ? 1 : 2,
    languages: ["en"],
    source_leads: [
      {
        source: "Bahá’í Reference Library",
        url: workUrl,
        note:
          "The Community's own publication of the work, read a chapter at a time at read time. The authorised English translation is the edition held.",
      },
      {
        source: "Bahá’í Reference Library — downloads",
        url: `${BASE}/downloads`,
        note:
          "The library also serves per-publication PDF, DOCX and HTML downloads. They are not imported: the reading views are what the reader streams, and the cache holds only the paragraph index.",
      },
    ],
    rights_note:
      `The work is the copyright of the Bahá’í International Community and is not relicensed here. It is displayed from bahai.org under the library's legal terms with the Community's copyright notice, the title of the work and the translator named, and is not used commercially. Access was authorised by the project owner on 2026-10-26; no Bahá’í text is copied into the local corpus.`,
    note: `Imported as a streamed work from the Bahá’í Reference Library (${spec.path}). ${
      spec.availabilityNote.split(". ")[0]!.replace(/\.$/, "")
    }.`,
  };
  const at = Array.isArray(acquisition.targets)
    ? acquisition.targets.findIndex((target: Row) => target.slug === spec.slug)
    : -1;
  if (at >= 0) acquisition.targets[at] = { ...acquisition.targets[at], ...entry };
  else {
    acquisition.targets = acquisition.targets ?? [];
    acquisition.targets.push(entry);
  }
}

function writeWork(spec: Spec, chapters: Chapter[], fragments: string[]) {
  let passages = 0;
  const work = {
    slug: spec.slug,
    title: spec.title,
    originalTitle: spec.originalTitle,
    transliteration: spec.transliteration,
    altTitles: spec.altTitles,
    tradition: "bahai",
    school: null,
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
    chapters: chapters.map((chapter) => ({ ref: chapter.ref, label: chapter.label })),
    passages: chapters.flatMap((chapter) =>
      chapter.segments.map((_, position) => {
        passages++;
        return {
          reference: `${chapter.ref}.${chapter.references[position]}`,
          label: `${chapter.label} §${chapter.references[position]}`,
          chapterRef: chapter.ref,
        };
      }),
    ),
    editions: [
      {
        slug: `${spec.slug}-en`,
        language: "en",
        editionType: "translation",
        title: `${spec.title} (authorised English translation)`,
        translator: spec.translator,
        publisher: "Bahá’í International Community, Bahá’í Reference Library",
        publicationYear: null,
        source: "bahai-reference-library",
        license: LICENCE,
        rightsStatus: COPYRIGHT,
        attributionText:
          `${spec.attributionLine ?? `${spec.title}, revealed by Bahá’u’lláh in ${spec.languageNote ?? (spec.originalLanguage === "ar" ? "Arabic" : "Persian")}${spec.translator ? `, translated by ${spec.translator}` : ""}`}. ${COPYRIGHT} Read from the Bahá’í Reference Library, the official online source of the Bahá’í writings: ${BASE}/${spec.path}`,
        structureScheme:
          "the library's own paragraph numbering where it prints one; otherwise reading order within the chapter",
        isSample: false,
        notes:
          "The text is streamed from the Bahá’í Reference Library under its legal terms: it is displayed with the Community's copyright notice and attribution, is not relicensed, and is not used commercially. The import cache holds only the paragraphs that were validated, for the search index.",
      },
    ],
  };
  writeFileSync(join(WORKS, `${spec.slug}.json`), `${JSON.stringify(work, null, 2)}\n`);

  streams.works[spec.slug] = {
    provider: "bahai",
    upstream: `Bahá’í Reference Library ${spec.path}`,
    mode: "numbered",
    licence: LICENCE,
    config: {
      workUrl: `${BASE}/${spec.path}`,
      fragments,
      chapters: Object.fromEntries(
        chapters.map((chapter) => [
          chapter.ref,
          { label: chapter.label, fragments: chapter.fragments, from: chapter.from, to: chapter.to },
        ]),
      ),
    },
    editions: [
      {
        slug: `${spec.slug}-en`,
        language: "en",
        languageName: "english",
        version: `${spec.title} (authorised English translation)`,
        license: LICENCE,
        sourceUrl: `${BASE}/${spec.path}`,
      },
    ],
  };
  functions.works[spec.slug] = {
    functions: spec.functions,
    status: "provisional",
    assignedBy: "UWL editors (comparative taxonomy)",
    note: `${spec.title} — ${spec.category}. The authorised English translation as the Bahá’í Reference Library publishes it, streamed from bahai.org (${spec.path}).`,
  };
  const words = chapters.reduce(
    (sum, chapter) => sum + chapter.segments.reduce((n, text) => n + text.split(/\s+/).filter(Boolean).length, 0),
    0,
  );
  console.log(`  ${spec.title}: ${chapters.length} chapters, ${passages} passages, ${words.toLocaleString()} words`);
  const first = chapters[0]!.segments[0] ?? "";
  console.log(`    first paragraph reads: ${first.slice(0, 88)}${first.length > 88 ? "…" : ""}`);
  recordTarget(spec);
  recordWork({
    slug: spec.slug,
    title: spec.title,
    host: "bahai-reference-library",
    path: spec.path,
    language: "en",
    original_language: spec.originalLanguage,
    translator: spec.translator,
    views: [...new Set(fragments)],
    chapters: chapters.length,
    passages,
    words,
    validation: "aligned",
    retrieved_at: RETRIEVED_AT,
  });
}

// ---------------------------------------------------------------------------
// The rest of the library
//
// Ten works were imported first, each with its divisions written out by hand.
// The library publishes eighty-eight, and an import that holds only what someone
// has typed out stops where the typing stopped. This reads the library's own
// catalogue instead: for every work it lists, it finds the reading views the work
// needs, groups them at the publication's own headings, drops the publication's
// front matter and notes, and writes the record with the library's own summary of
// the work. The rights position is the same for every work on the site and is
// recorded on each of them; nothing is copied into the corpus, and the reader
// streams the views as it does for the ten works already held.
// ---------------------------------------------------------------------------

const META = join(ROOT, "data", "corpus", "meta.json");
const meta: Row = existsSync(META) ? readJson(META) : { authors: [] };
meta.authors ??= [];

/** How a section of the library is shelved and classified in this library. */
type Plan = {
  author: string | null;
  category: string;
  genre: string;
  subcategory: string;
  textType: string;
  functions: string[];
  originalLanguage: string;
};

const PLANS: Record<string, Plan> = {
  "authoritative-texts/bahaullah": {
    author: "bahaullah",
    category: "Scripture",
    genre: "Scripture",
    subcategory: "Writings of Bahá’u’lláh",
    textType: "Authoritative text revealed by Bahá’u’lláh",
    functions: ["canonical_scripture"],
    originalLanguage: "ar",
  },
  "authoritative-texts/the-bab": {
    author: "the-bab",
    category: "Scripture",
    genre: "Scripture",
    subcategory: "Writings of the Báb",
    textType: "Authoritative text revealed by the Báb",
    functions: ["canonical_scripture", "foundational_revelation"],
    originalLanguage: "fa",
  },
  "authoritative-texts/abdul-baha": {
    author: "abdul-baha",
    category: "Scripture",
    genre: "Scripture",
    subcategory: "Writings and talks of ‘Abdu’l‑Bahá",
    textType: "Authoritative text and recorded talk of ‘Abdu’l‑Bahá",
    functions: ["canonical_scripture", "denominational_guidance"],
    originalLanguage: "fa",
  },
  "authoritative-texts/prayers": {
    author: null,
    category: "Scripture",
    genre: "Scripture",
    subcategory: "Prayers and meditations",
    textType: "Prayers revealed by Bahá’u’lláh, the Báb and ‘Abdu’l‑Bahá",
    functions: ["prayer_liturgy", "canonical_scripture"],
    originalLanguage: "ar",
  },
  "authoritative-texts/shoghi-effendi": {
    author: "shoghi-effendi",
    category: "Guidance",
    genre: "Guidance",
    subcategory: "Writings of Shoghi Effendi",
    textType: "Interpretation and guidance by the Guardian of the Bahá’í Faith",
    functions: ["denominational_guidance", "historical_document"],
    originalLanguage: "en",
  },
  "authoritative-texts/the-universal-house-of-justice": {
    author: "universal-house-of-justice",
    category: "Guidance",
    genre: "Guidance",
    subcategory: "Messages of the Universal House of Justice",
    textType: "Message of the Universal House of Justice",
    functions: ["denominational_guidance", "community_statement"],
    originalLanguage: "en",
  },
  "authoritative-texts/compilations": {
    author: null,
    category: "Compilation",
    genre: "Compilation",
    subcategory: "Compilations from the Bahá’í writings",
    textType: "Compilation of extracts from the Bahá’í writings",
    functions: ["canonical_scripture", "denominational_guidance"],
    originalLanguage: "en",
  },
  "other-literature/official-statements-commentaries": {
    author: "bahai-international-community",
    category: "Institutional text",
    genre: "Institutional text",
    subcategory: "Official statements and commentaries",
    textType: "Statement or commentary issued by a Bahá’í institution",
    functions: ["community_statement", "denominational_guidance"],
    originalLanguage: "en",
  },
  "other-literature/periodicals-supplementary-materials": {
    author: "bahai-international-community",
    category: "Institutional text",
    genre: "Institutional text",
    subcategory: "Periodicals and supplementary materials",
    textType: "Periodical or supplementary publication of the Bahá’í community",
    functions: ["community_statement", "historical_document"],
    originalLanguage: "en",
  },
  "other-literature/publications-individual-authors": {
    author: null,
    category: "Secondary literature",
    genre: "Secondary literature",
    subcategory: "Publications by individual authors",
    textType: "Book about the Bahá’í Faith by an individual author",
    functions: ["academic_scholarship"],
    originalLanguage: "en",
  },
};

const DEFAULT_PLAN: Plan = {
  author: null,
  category: "Other literature",
  genre: "Other literature",
  subcategory: "Bahá’í literature",
  textType: "Bahá’í text in English",
  functions: ["non_canonical_religious_text"],
  originalLanguage: "en",
};

/** The works whose author is not the section's: the library shelves by writer,
 * and these are the exceptions its own catalogue records. */
const WORK_AUTHORS: Record<string, string> = {
  "other-literature/publications-individual-authors/bahaullah-new-era": "esslemont",
};

const AUTHOR_NAMES: Record<string, string> = {
  bahaullah: "Bahá’u’lláh",
  "the-bab": "the Báb",
  "abdul-baha": "‘Abdu’l‑Bahá",
  "shoghi-effendi": "Shoghi Effendi",
  "universal-house-of-justice": "the Universal House of Justice",
  "bahai-international-community": "the Bahá’í International Community",
  esslemont: "John Ebenezer Esslemont",
};

/** A person or institution the corpus does not know yet. A work whose author is
 * not registered fails the corpus validation, so the record is written with the
 * work. */
const PEOPLE: Record<string, Row> = {
  "universal-house-of-justice": {
    slug: "universal-house-of-justice",
    name: "The Universal House of Justice",
    sort_name: "Universal House of Justice",
    birth_year: null,
    death_year: null,
    date_display: "1963–",
    description:
      "The international governing council of the Bahá’í Faith, ordained by Bahá’u’lláh in the Kitáb-i-Aqdas and first elected in 1963; it legislates on matters not covered by the writings and guides the community.",
    is_attributed: true,
  },
  "bahai-international-community": {
    slug: "bahai-international-community",
    name: "Bahá’í International Community",
    sort_name: "Bahá’í International Community",
    birth_year: null,
    death_year: null,
    date_display: "",
    description:
      "The body through which the Bahá’í community is represented internationally, which issues statements and commentaries in its own name.",
    is_attributed: true,
  },
  esslemont: {
    slug: "esslemont",
    name: "John Ebenezer Esslemont",
    sort_name: "Esslemont, John Ebenezer",
    birth_year: 1874,
    death_year: 1925,
    date_display: "1874–1925",
    description:
      "Scottish physician, Bahá’í author and Hand of the Cause of God, whose introduction to the Bahá’í Faith was read by ‘Abdu’l‑Bahá and published in 1923.",
    is_attributed: true,
  },
};

/** A title as titles are compared here: letters and digits, in lower case. */
function bareTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The catalogue's record of one work, read as the spec the importer writes. */
function specFor(row: Row): Spec {
  const path = String(row.path);
  const plan = PLANS[`${row.section}/${row.subsection}`] ?? DEFAULT_PLAN;
  const title = String(row.title);
  const sectionLabel = String(row.sectionLabel ?? "");
  // The library states each work's translator, language and setting in the one
  // summary it publishes about it; what it does not state is left unsaid.
  const description = String(row.description ?? "");
  const translator =
    /translat(?:ed|ion)\s+by\s+([^.;(]{3,90})/i.exec(description)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  const author = WORK_AUTHORS[path] ?? plan.author;
  const authorName = author ? AUTHOR_NAMES[author] ?? author : "";
  return {
    slug: String(row.slug),
    path,
    title,
    originalTitle: "",
    transliteration: "",
    altTitles: [],
    author,
    dateStart: null,
    dateEnd: null,
    dateDisplay: "",
    authorshipStatus: author ? "established" : "institutional",
    genre: plan.genre,
    textType: plan.textType,
    category: plan.category,
    subcategory: plan.subcategory,
    originalLanguage: plan.originalLanguage,
    attributionNote:
      `${title}${authorName ? `, by ${authorName}` : ""}${translator ? `, translated by ${translator}` : ""}: the Bahá’í ` +
      `Reference Library's own record of the work${sectionLabel ? `, on its ${sectionLabel} shelf` : ""}.`,
    description:
      `${description ? `${description} ` : ""}The record was created by the Bahá’í import from the Reference Library's own ` +
      "catalogue and reading views; the summary above is the library's own description of the work, and an editor's note for " +
      "the work itself is still to be written.",
    historicalContext:
      `Read in the Bahá’í Reference Library, in the section where the Bahá’í International Community publishes the ` +
      `authorised English text${sectionLabel ? ` (${sectionLabel})` : ""}.`,
    availabilityNote:
      "Complete as the Reference Library publishes it: the library's reading views for this work are streamed from bahai.org " +
      "at read time, one chapter at a time, with the Community's copyright notice. The chapters are the divisions of the " +
      "library's own reading text; the publication's front matter and its notes are not imported.",
    attributionLine: `${title}${authorName ? `, by ${authorName}` : ""}${translator ? `, translated by ${translator}` : ""}`,
    translator,
    functions: plan.functions,
    groups: [],
  };
}

/** A view the library serves, or does not. */
async function viewExists(spec: Spec, view: number): Promise<boolean> {
  try {
    await fetchView(viewUrl(spec, view));
    await Bun.sleep(200);
    return true;
  } catch {
    return false;
  }
}

/**
 * The last reading view a work has. The library numbers its views and stops, so
 * the end of a work is the view after which the next number is not served.
 * Nothing about the work's length is written down anywhere else, which is why
 * the import asks.
 */
async function lastViewOf(spec: Spec, start: number): Promise<number> {
  let last = start - 1;
  for (let view = start; view < start + 60; view++) {
    if (!(await viewExists(spec, view))) break;
    last = view;
  }
  return last;
}

// The publication's apparatus: front matter, endnotes, and the descriptive
// pieces the library prints around a text. Its table of contents names them
// like anything else.
const APPARATUS_LABEL =
  /^(?:preface|foreword|introduction|introductory|a note\b|note\b|notes\b|synopsis|codification|contents|transliteration|key to|index|bibliograph|glossary|about\b|a description of|appendix|supplement)/i;

/**
 * What is left of a work's divisions once the edition around it is dropped: the
 * front matter, the endnotes and the entry that names the work itself (the
 * library opens its works with a title view). A work whose every division read
 * as apparatus keeps them all rather than being imported empty.
 */
function textChapters(title: string, chapters: Chapter[]): Chapter[] {
  const bare = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const work = bare(title);
  const kept = chapters.filter((chapter) => {
    const label = chapter.label.trim();
    if (!label) return true;
    if (APPARATUS_LABEL.test(label)) return false;
    const own = bare(label);
    return !(own && work && (own === work || work.startsWith(`${own} `) || own.startsWith(`${work} `)));
  });
  const chosen = kept.length ? kept : chapters;
  return chosen.map((chapter, index) => ({ ...chapter, ref: String(index + 1) }));
}

/**
 * A chapter reads the views it stands in, not the whole work. The chapters of a
 * catalogue-built work are grouped over all the work's views at once, which is
 * what makes a division that spans two views come out whole; each of them is
 * narrowed here to the views its own paragraphs are printed in, so that opening
 * a prayer in a collection of a hundred prayers asks for one view. The views are
 * already in hand: they were read to build the chapters, so this asks for
 * nothing.
 */
function narrowChapters(chapters: Chapter[], fragments: string[]): Chapter[] {
  const counts = fragments.map((url) => bahaiBlocks(viewCache.get(url) ?? "").filter((block) => block.text).length);
  const offsets: number[] = [];
  let running = 0;
  for (const count of counts) {
    offsets.push(running);
    running += count;
  }
  return chapters.map((chapter) => {
    let first = -1;
    let last = -1;
    counts.forEach((count, index) => {
      const from = offsets[index]!;
      const to = from + count - 1;
      if (chapter.to >= from && chapter.from <= to) {
        if (first < 0) first = index;
        last = index;
      }
    });
    if (first < 0) return chapter;
    const base = offsets[first]!;
    return {
      ...chapter,
      fragments: fragments.slice(first, last + 1).map((_, index) => index),
      from: chapter.from - base,
      to: chapter.to - base,
    };
  });
}

/** Registers an author or institution the corpus is meeting for the first time. */
function ensurePerson(slug: string | null) {
  if (!slug) return;
  const person = PEOPLE[slug];
  if (!person) return;
  meta.authors ??= [];
  if (meta.authors.some((author: Row) => author.slug === person.slug)) return;
  meta.authors.push(person);
}

/**
 * Puts the textual-function map back in step with the works already on disk. A
 * run of the whole library reads for hours, and a work is written to the corpus
 * before the registry that classifies it, so a run stopped in between leaves a
 * work with no classification — which the corpus's own consistency check calls
 * a failure. This reads the works back and classifies the ones that name
 * themselves, so a stopped run is only a stopped run.
 */
function reconcile(): number {
  if (!existsSync(CATALOGUE)) return 0;
  let healed = 0;
  for (const row of (readJson(CATALOGUE) as Row).works ?? []) {
    const spec = specFor(row);
    if (!existsSync(join(WORKS, `${spec.slug}.json`))) continue;
    if (functions.works[spec.slug]) continue;
    functions.works[spec.slug] = {
      functions: spec.functions,
      status: "provisional",
      assignedBy: "UWL editors (comparative taxonomy)",
      note: `${spec.title} — ${spec.category}. Recovered by the Bahá’í import from the work already on disk.`,
    };
    healed++;
  }
  if (healed) console.log(`reconciled from disk: ${healed} classification(s)`);
  return healed;
}

/**
 * Imports every work the library catalogues that this import does not already
 * hold. A work's views are read once: the chapters that come out of them are
 * cached beside the other imports, so a second run rebuilds the shelf without
 * asking the host for anything, and the registry is written as the run goes
 * rather than at the end.
 */
async function importLibrary(limit: number) {
  if (!existsSync(CATALOGUE)) throw new Error(`no catalogue at ${CATALOGUE}; run --catalogue first`);
  const catalogue = readJson(CATALOGUE) as Row;
  reconcile();
  // The works written out by hand are addressed by their path under
  // /authoritative-texts, which is how the catalogue's paths read once the
  // section is dropped.
  const covered = new Set(SPECS.map((spec) => spec.path));
  const coveredPath = (path: string) => path.replace(/^authoritative-texts\//, "");
  mkdirSync(CACHE, { recursive: true });
  let written = 0;
  let held = 0;
  let overlapped = 0;
  let leads = 0;
  let failed = 0;
  const reregister = args.includes("--reregister");
  for (const row of catalogue.works ?? []) {
    if (limit && written >= limit) break;
    if (covered.has(coveredPath(String(row.path)))) continue;
    if (only && String(row.slug) !== only) continue;
    if (sectionOnly && String(row.subsection) !== sectionOnly) continue;
    const spec = specFor(row);
    if (!force && !reregister && manifest.works.some((work: Row) => work.slug === spec.slug)) {
      held++;
      continue;
    }
    // The library publishes some works twice, once alone and once inside a
    // collection. A work whose title is the title of a work already held, with
    // the rest of the collection named after it, is that same work again.
    const sameWork = manifest.works.find((work: Row) => {
      // A work is not another edition of itself: without this, a run that
      // revisits the works already held skips every one of them as an overlap.
      if (String(work.slug) === spec.slug) return false;
      const own = bareTitle(String(work.title));
      return own.length >= 12 && bareTitle(spec.title).startsWith(own);
    });
    if (!force && sameWork) {
      overlapped++;
      console.log(`  ${spec.path}: ${spec.title} is already held as ${sameWork.slug}; this record was not written again.`);
      continue;
    }
    try {
      let chapters: Chapter[];
      let fragments: string[];
      const cachedPath = join(CACHE, `${spec.slug}.json`);
      if (!force && existsSync(cachedPath)) {
        const cached = readJson(cachedPath) as { chapters: Chapter[]; fragments: string[] };
        chapters = cached.chapters;
        fragments = cached.fragments;
      } else {
        const start = (await viewExists(spec, 2)) ? 2 : 1;
        const last = await lastViewOf(spec, start);
        if (last < start) {
          recordLead(
            spec,
            "no reading views on the site",
            "the library catalogues this work but publishes it only as a download (PDF, DOCX, HTML), not as the reading " +
              "views this import streams; the download is a copy of the publication and was not taken",
          );
          leads++;
          continue;
        }
        const built = await buildChapters({ ...spec, groups: [{ views: [start, last] }] });
        chapters = narrowChapters(textChapters(spec.title, built.chapters), built.fragments);
        fragments = built.fragments;
        assertChapters(spec.slug, chapters);
        if (dryRun) {
          console.log(
            `${spec.title} [${spec.category}] views ${start}–${last} → ${chapters.length} chapters: ` +
              chapters.map((chapter) => chapter.label).slice(0, 10).join(" | "),
          );
          written++;
          continue;
        }
        writeFileSync(
          cachedPath,
          `${JSON.stringify(
            {
              version: 1,
              slug: spec.slug,
              provider: "bahai",
              path: spec.path,
              generatedAt: new Date().toISOString(),
              complete: true,
              fragments,
              chapters,
            },
            null,
            2,
          )}\n`,
        );
      }
      assertChapters(spec.slug, chapters);
      console.log(`\n${spec.title}`);
      ensurePerson(spec.author);
      writeWork(spec, chapters, fragments);
      written++;
      if (written % 10 === 0) saveRegistry();
    } catch (err) {
      failed++;
      console.error(`  ${spec.path}: ${(err as Error).message}`);
    }
  }
  console.log(
    `\nThe library: ${written} work(s) written, ${held} already held, ${overlapped} held as another edition, ` +
      `${leads} lead(s), ${failed} failure(s).`,
  );
}

if (catalogueOnly) {
  await buildCatalogue();
  process.exit(0);
}

if (listOnly) {
  for (const spec of SPECS) console.log(`${spec.slug.padEnd(32)} ${spec.path.padEnd(34)} ${spec.title}`);
  process.exit(0);
}

const selected = allWorks ? [] : SPECS.filter((spec) => !only || spec.slug === only);
if (!selected.length && !allWorks) {
  console.error(`No Bahá’í work matches ${only}.`);
  process.exit(1);
}
if (allWorks) await importLibrary(Number(arg("limit")) || 0);

for (const spec of selected) {
  console.log(`\n${spec.title}`);
  const cachedPath = join(CACHE, `${spec.slug}.json`);
  if (!force && existsSync(cachedPath)) {
    const cached = readJson(cachedPath) as { chapters: Chapter[]; fragments: string[] };
    assertChapters(spec.slug, cached.chapters);
    if (dryRun) {
      console.log(`  cache holds ${cached.chapters.length} chapters`);
      continue;
    }
    writeWork(spec, cached.chapters, cached.fragments);
    console.log(`  reused ${cached.chapters.length} cached chapters`);
    continue;
  }
  const { chapters, fragments } = await buildChapters(spec);
  assertChapters(spec.slug, chapters);
  if (dryRun) {
    console.log(`  ${chapters.length} chapters, ${chapters.reduce((n, c) => n + c.segments.length, 0)} paragraphs`);
    continue;
  }
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(
    cachedPath,
    `${JSON.stringify(
      {
        version: 1,
        slug: spec.slug,
        provider: "bahai",
        path: spec.path,
        generatedAt: new Date().toISOString(),
        complete: true,
        fragments,
        chapters,
      },
      null,
      2,
    )}\n`,
  );
  writeWork(spec, chapters, fragments);
}

/**
 * Writes everything this import holds: the manifest, the stream registry, the
 * classifications, the author list and the acquisition register. The library is
 * read over hours, so the registry is written as the run goes and not only when
 * it stops.
 */
function saveRegistry() {
  manifest.totals = {
    works: manifest.works.length,
    chapters: manifest.works.reduce((n: number, w: Row) => n + w.chapters, 0),
    passages: manifest.works.reduce((n: number, w: Row) => n + w.passages, 0),
    words: manifest.works.reduce((n: number, w: Row) => n + w.words, 0),
  };
  acquisition.updated_at = RETRIEVED_AT;
  if (dryRun) return;
  // The registry is shared with the other importers, and one of them may have
  // written to it since it was read: what goes back is the file as it now stands
  // plus this import's entries, so that two imports running together — a library
  // read over hours, another pass beside it — cannot delete each other's work.
  const onDisk = (path: string) => {
    try {
      return existsSync(path) ? (readJson(path) as Row) : null;
    } catch {
      return null;
    }
  };
  const functionsOnDisk = onDisk(FUNCTIONS);
  if (functionsOnDisk?.works) {
    for (const [slug, entry] of Object.entries(functionsOnDisk.works as Row)) {
      functions.works[slug] ??= entry;
    }
  }
  const streamsOnDisk = onDisk(STREAMS);
  if (streamsOnDisk?.works) {
    for (const [slug, entry] of Object.entries(streamsOnDisk.works as Row)) {
      streams.works[slug] ??= entry;
    }
  }
  const metaOnDisk = onDisk(META);
  if (metaOnDisk?.authors) {
    const known = new Set((meta.authors as Row[]).map((author: Row) => author.slug));
    for (const author of metaOnDisk.authors as Row[]) {
      if (!known.has(author.slug)) meta.authors.push(author);
    }
  }
  const acquisitionOnDisk = onDisk(ACQUISITION);
  if (acquisitionOnDisk?.targets) {
    const known = new Set((acquisition.targets ?? []).map((target: Row) => target.slug));
    for (const target of acquisitionOnDisk.targets as Row[]) {
      if (!known.has(target.slug)) acquisition.targets.push(target);
    }
  }
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(STREAMS, `${JSON.stringify(streams, null, 2)}\n`);
  writeFileSync(FUNCTIONS, `${JSON.stringify(functions, null, 2)}\n`);
  writeFileSync(META, `${JSON.stringify(meta, null, 2)}\n`);
  writeFileSync(ACQUISITION, `${JSON.stringify(acquisition, null, 2)}\n`);
}

saveRegistry();
console.log(
  `\nManifest: ${manifest.totals.works} works, ${manifest.totals.chapters} chapters, ${manifest.totals.passages} passages, ${manifest.totals.words.toLocaleString()} words.`,
);
