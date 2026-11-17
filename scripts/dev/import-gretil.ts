// Sanskrit texts from GRETIL, the Göttingen Register of Electronic Texts in
// Indian Languages.
//
// Run: bun run import:gretil
//      bun run import:gretil --only=bhagavata-purana
//      bun run import:gretil --list
//      bun run import:gretil --force           (ignore the import cache)
//      bun run import:gretil --dry-run
//
// Each work is streamed from GRETIL at read time: this script fetches the
// plain-text transformation of one file per work, splits it at the reference
// markers GRETIL prints at the end of every unit ("// bhp_01.01.004 //"), and
// writes
//   data/corpus/works/<slug>.json          the catalogue record, chapter
//                                          outline and passage index
//   data/imports/cache/gretil/<slug>.json  the exact segments that were
//                                          validated, for the search index
// and adds the stream record, textual-function classification and acquisition
// status for the work. The text itself is never written to the corpus.
//
// GRETIL's files are heterogeneous: the marker abbreviation and the depth of
// the reference scheme differ from work to work, so every spec names its own
// abbreviation, how many components its references carry and what to call the
// chapters and units.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gretilChapterRef, gretilComponents, parseGretilUnits, stripGretilHeader } from "../../server/stream";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");
const STREAMS = join(ROOT, "data", "registry", "streams.json");
const FUNCTIONS = join(ROOT, "data", "corpus", "text-functions.json");
const ACQUISITION = join(ROOT, "data", "registry", "acquisition.json");
const MANIFEST = join(ROOT, "data", "imports", "gretil.json");
const CACHE = join(ROOT, "data", "imports", "cache", "gretil");
const RETRIEVED_AT = new Date().toISOString().slice(0, 10);
const USER_AGENT = "UniversalWisdomLibrary/1.0 (local reading interface; GRETIL import)";
const INDEX_URL = "https://gretil.sub.uni-goettingen.de/gretil.html";
const PLAIN_BASE = "https://gretil.sub.uni-goettingen.de/gretil/corpustei/transformations/plaintext";
const ANALYTIC_BASE = "https://gretil.sub.uni-goettingen.de/gretil/corpustei/transformations/html";

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.split("=").slice(1).join("=") ?? "";
const force = args.includes("--force");
const dryRun = args.includes("--dry-run");
const listOnly = args.includes("--list");

type Row = Record<string, any>;
// A chapter carries the exact GRETIL reference of every segment, so the
// passage index repeats the numbering the reader will see on the page.
type Chapter = { ref: string; label: string; segments: string[]; references: string[] };

type Spec = {
  slug: string;
  /** The GRETIL file stem, as listed in gretil.html and served under /corpustei. */
  stem: string;
  /** The abbreviation GRETIL prints before each reference in this file. */
  abbrev: string;
  title: string;
  originalTitle: string;
  transliteration: string;
  altTitles: string[];
  /** The religion the work belongs to; GRETIL's Sanskrit corpus is not only Hindu. */
  tradition?: string;
  school: string;
  genre: string;
  textType: string;
  category: string;
  subcategory: string;
  dateStart: number;
  dateEnd: number;
  dateDisplay: string;
  authorshipStatus: string;
  author: string;
  attributionNote: string;
  description: string;
  historicalContext: string;
  availabilityNote: string;
  /** What the reference scheme is called on this shelf. */
  refScheme: string;
  /** One label pattern per component of a chapter reference, e.g. "Skandha {v}". */
  componentLabels: string[];
  /** The single chapter label for a work numbered only by unit (karika, sutra). */
  singleChapterLabel?: string;
  /** Leading lines of the file that are furniture rather than text. */
  skipLeadLines?: number;
  /**
   * A reference prefix that belongs to the file's own preface rather than to
   * the work — the Hitopadesha's auspicious verses are numbered 0.x and the
   * Gopatha Brahmana's opening colophon is 0.0.0. Units with this prefix are
   * dropped and the count is recorded in the import log.
   */
  dropRefPrefix?: string;
  /**
   * The regular expression whose first group is a unit's number, for the files
   * that print no abbreviation of their own beside the reference (the
   * Spandakārikā and the Vijñānabhairava number "|| 1 ||", the
   * Vivekacūḍāmaṇi "// 1 //"). Such a work is one chapter numbered by verse.
   */
  refPattern?: string;
  /**
   * Whether the e-text prints its own apparatus beside the marker, which the
   * reader then trims off the ends of every unit rather than showing as text:
   * Gautama's file prints a second reference in brackets beside the first, the
   * Mahāvastu's wraps the marker in underscores, the Udānavarga's and
   * Praśastapāda's split a word at it.
   */
  trimDecorations?: boolean;
  /**
   * The words its letters stand for, for a file that numbers its chapters
   * inside named parts — the Nāradasmṛti's "NarS_m1.1" is the first verse of
   * the first mātṛkā, "NarS_v3.4" the fourth verse of the third vyavahārapada.
   */
  partLabels?: Record<string, string>;
  /**
   * How many components a passage reference of this work carries — two for
   * adhyāya.verse, three for kāṇḍa.sūkta.verse. Some files mark their chapters
   * and colophons as well as their passages (the Saddharmapuṇḍarika prints
   * "saddhp_1: nidānaparivartaḥ" above each parivarta and a colophon at its
   * end), and a truncated verse marker such as the Harivamsha's "HV_58" carries
   * the chapter number alone. A marker whose reference has any other number of
   * components is not a passage: it is dropped here and by the reader, which
   * reads the same depth from the stream configuration. Omit the field for a
   * file whose references vary.
   */
  unitDepth?: number;
  /** The edition this e-text was transcribed from, when the header names it. */
  editionTitle: string;
  functions: string[];
  /**
   * A second (or third) text read from the same file under its own marker.
   * GRETIL prints some root texts together with their commentary in one file,
   * each unit carrying its own abbreviation, so the commentary is imported as a
   * second edition of the same work and the reader shows the two panes together.
   */
  variants?: Variant[];
};

type Variant = {
  /** Suffix that makes the edition slug: <work>-<suffix>. */
  slug: string;
  /** How the pane is titled in the reader. */
  title: string;
  /** The abbreviation GRETIL prints in front of this text's references. */
  abbrev: string;
  /** Who the variant's text is attributed to, for the pane's attribution line. */
  attribution: string;
};

const headerOf = (raw: {
  versionDate: string;
  source: string;
  dataEntry: string;
  licence: string;
  structure: string;
}): Row => ({
  versionDate: raw.versionDate,
  source: raw.source,
  dataEntry: raw.dataEntry,
  licence: raw.licence,
  structure: raw.structure,
});

const SPECS: Spec[] = [
  {
    slug: "bhagavata-purana",
    stem: "sa_bhAgavatapurANa",
    abbrev: "bhp",
    title: "The Bhagavata Purana",
    originalTitle: "भागवतपुराण",
    transliteration: "Bhāgavatapurāṇa",
    altTitles: ["Srimad Bhagavatam", "Bhagavata", "Śrīmad Bhāgavatam"],
    school: "vaishnavism",
    genre: "Purana",
    textType: "Narrative scripture in verse",
    category: "Purana",
    subcategory: "Vaishnava Puranas",
    dateStart: 800,
    dateEnd: 1000,
    dateDisplay: "c. 9th–10th century CE",
    authorshipStatus: "composite",
    author: "vyasa",
    attributionNote:
      "The Purana is ascribed to Vyasa and presents itself as the mature statement of his teaching, but it is a composite work of several hands, most likely composed in south India between the ninth and tenth centuries.",
    description:
      "The Bhagavata Purana tells the deeds of Vishnu and above all of Krishna: the creation and the cosmic ages, the genealogies of the solar and lunar houses, the dwarf and boar and man-lion avatars, and then, in its tenth book, the childhood, the flute, the dance and the teaching of Krishna in Vrindavan. Its verses are the foundation of Krishna devotion, and its final books set out the yogic and devotional disciplines by which the story is to be entered.",
    historicalContext:
      "Composed in Sanskrit after the earlier Puranas, the Bhagavata became the scripture of the Bhagavata communities and of the Gaudiya, Vallabha and Bhagavata traditions. Commentaries from Sridhara onward made it a school text, and its tenth book has been translated, retold and sung across India for a thousand years.",
    availabilityNote:
      "Complete: the Sanskrit text of all twelve skandhas as GRETIL publishes it, streamed from GRETIL at read time, one chapter at a time. This is the original Sanskrit, not a translation.",
    refScheme: "skandha.chapter.verse",
    componentLabels: ["Skandha {v}", "Adhyāya {v}"],
    editionTitle: "Bhāgavatapurāṇa (GRETIL e-text)",
    functions: ["canonical_scripture", "mystical_contemplative"],
  },
  {
    slug: "garuda-purana",
    stem: "sa_garuDapurANa",
    abbrev: "garp",
    title: "The Garuda Purana",
    originalTitle: "गरुडपुराण",
    transliteration: "Garuḍapurāṇa",
    altTitles: ["Garuda Puranam"],
    school: "vaishnavism",
    genre: "Purana",
    textType: "Narrative scripture in verse",
    category: "Purana",
    subcategory: "Vaishnava Puranas",
    dateStart: 800,
    dateEnd: 1100,
    dateDisplay: "c. 9th–11th century CE",
    authorshipStatus: "composite",
    author: "vyasa",
    attributionNote:
      "Ascribed to Vyasa, like the other Puranas, and compiled over centuries: its chapters on Vishnu's incarnations sit beside later additions on ritual, pilgrimage, medicine and the fate of the dead.",
    description:
      "The Garuda Purana is the Purana of death, judgement and release, framed as a dialogue in which Garuda asks Vishnu about the fate of the soul. It describes the journey after death, the realms and their punishments, the funeral rites a son owes his parents, and, with them, cosmology, ethics, astrology, medicine and the worship of Vishnu and Shiva.",
    historicalContext:
      "The text took shape mainly in Bengal and is recited beside the dead across northern India, which fixed its reputation as a book of mourning. It also preserves a great deal of practical lore: the diamond and gem chapters were consulted by jewellers, and its chapters on medicine circulated among physicians.",
    availabilityNote:
      "Complete: the Sanskrit text of all three khandas as GRETIL publishes it, streamed from GRETIL at read time, one chapter at a time. This is the original Sanskrit, not a translation.",
    refScheme: "khanda.chapter.verse",
    componentLabels: ["Khaṇḍa {v}", "Adhyāya {v}"],
    editionTitle: "Garuḍapurāṇa (GRETIL e-text)",
    functions: ["canonical_scripture", "religious_law_practice"],
  },
  {
    slug: "narada-purana",
    stem: "sa_nAradapurANa",
    abbrev: "narp",
    title: "The Narada Purana",
    originalTitle: "नारदपुराण",
    transliteration: "Nāradapurāṇa",
    altTitles: ["Narada Puranam"],
    school: "vaishnavism",
    genre: "Purana",
    textType: "Narrative scripture in verse",
    category: "Purana",
    subcategory: "Vaishnava Puranas",
    dateStart: 800,
    dateEnd: 1100,
    dateDisplay: "c. 9th–11th century CE",
    authorshipStatus: "composite",
    author: "vyasa",
    attributionNote:
      "Ascribed to Vyasa and compiled over several centuries, with a second part that is largely a manual of Vaishnava devotion, law and pilgrimage.",
    description:
      "The Narada Purana opens with the sages questioning Sanatkumara and turns into a wide survey of Vaishnava teaching: the greatness of Vishnu and his devotees, cosmology and the ages, the duties of the four stages of life, the rites owed to the dead, the sacred places of pilgrimage, gifts and vows, and the practice of repeating the divine name.",
    historicalContext:
      "It is one of the Puranas most concerned with practice rather than story, and it preserves in passing a good deal of the religious life of medieval north India: ritual law, the tirthas, and the vratas by which ordinary worshippers lived.",
    availabilityNote:
      "Complete: the Sanskrit text of both parts as GRETIL publishes it, streamed from GRETIL at read time, one chapter at a time. This is the original Sanskrit, not a translation.",
    refScheme: "part.chapter.verse",
    componentLabels: ["Part {v}", "Adhyāya {v}"],
    editionTitle: "Nāradapurāṇa (GRETIL e-text)",
    functions: ["canonical_scripture", "religious_law_practice"],
  },
  {
    slug: "brahmanda-purana",
    stem: "sa_brahmANDapurANa",
    abbrev: "bndp",
    title: "The Brahmanda Purana",
    originalTitle: "ब्रह्माण्डपुराण",
    transliteration: "Brahmāṇḍapurāṇa",
    altTitles: ["Brahmanda Puranam"],
    school: "puranic",
    genre: "Purana",
    textType: "Narrative scripture in verse",
    category: "Purana",
    subcategory: "Shakta Puranas",
    dateStart: 300,
    dateEnd: 700,
    dateDisplay: "c. 4th–7th century CE",
    authorshipStatus: "composite",
    author: "vyasa",
    attributionNote:
      "Ascribed to Vyasa. Its core is early, while the Lalitopakhyana and other Goddess material were added later, which is why the Purana is read both as a Vaishnava and as a Shakta text.",
    description:
      "The Brahmanda Purana, the Purana of the cosmic egg, narrates creation and the ages, the genealogies of the gods and kings, and the geography of the earth, and it carries the Lalitopakhyana, the long account of the Goddess Lalita and her war with Bhandasura. Its opening chapters preserve material as old as any Purana.",
    historicalContext:
      "The Lalitopakhyana made this Purana a central text of Shri Vidya, the Shakta tradition of South India, whose worship of Lalita Tripurasundari and her Shri Chakra derives much of its scripture from this book.",
    availabilityNote:
      "Complete: the Sanskrit text of all three parts as GRETIL publishes it, streamed from GRETIL at read time, one chapter at a time. This is the original Sanskrit, not a translation.",
    refScheme: "part.chapter.verse",
    componentLabels: ["Part {v}", "Adhyāya {v}"],
    editionTitle: "Brahmāṇḍapurāṇa (GRETIL e-text)",
    functions: ["canonical_scripture", "mystical_contemplative"],
  },
  {
    slug: "linga-purana",
    stem: "sa_liGgapurANa1-108",
    abbrev: "LiP",
    title: "The Linga Purana",
    originalTitle: "लिङ्गपुराण",
    transliteration: "Liṅgapurāṇa",
    altTitles: ["Linga Puranam"],
    school: "shaivism",
    genre: "Purana",
    textType: "Narrative scripture in verse",
    category: "Purana",
    subcategory: "Shaiva Puranas",
    dateStart: 700,
    dateEnd: 1000,
    dateDisplay: "c. 8th–10th century CE",
    authorshipStatus: "composite",
    author: "vyasa",
    attributionNote:
      "Ascribed to Vyasa and compiled over several centuries. Its name comes from the linga, the aniconic form of Shiva that its first part explains and glorifies.",
    description:
      "The Linga Purana teaches the worship of Shiva under the sign of the linga: the greatness of Shiva and of his devotees, the cosmic cycles and the dissolution of the worlds, the incarnations of Shiva and the destruction of Daksha's sacrifice, and then the rules for the linga's installation, the recitation of its thousand names and the observance of Shivaratri.",
    historicalContext:
      "Composed for the growing Shaiva communities of early medieval India, it belongs with the Shiva, Skanda and Matsya Puranas as the scriptural library of Shiva worship, and its ritual chapters record how the linga came to stand at the centre of a temple.",
    availabilityNote:
      "Complete: the Sanskrit text of all 108 chapters of the first part as GRETIL publishes it, streamed from GRETIL at read time, one chapter at a time. This is the original Sanskrit, not a translation.",
    refScheme: "part.chapter.verse",
    componentLabels: ["Part {v}", "Adhyāya {v}"],
    editionTitle: "Liṅgapurāṇa (GRETIL e-text)",
    functions: ["canonical_scripture", "prayer_liturgy"],
  },
  {
    slug: "matsya-purana",
    stem: "sa_matsyapurANa1-176",
    abbrev: "MatsP",
    title: "The Matsya Purana",
    originalTitle: "मत्स्यपुराण",
    transliteration: "Matsyapurāṇa",
    altTitles: ["Matsya Puranam"],
    school: "vaishnavism",
    genre: "Purana",
    textType: "Narrative scripture in verse",
    category: "Purana",
    subcategory: "Vaishnava Puranas",
    dateStart: 300,
    dateEnd: 600,
    dateDisplay: "c. 4th–6th century CE",
    authorshipStatus: "composite",
    author: "vyasa",
    attributionNote:
      "Ascribed to Vyasa. It presents itself as the teaching given by Vishnu in his fish incarnation to Manu, the survivor of the flood, and was compiled over several centuries.",
    description:
      "The Matsya Purana begins with the flood and the fish that tows Manu's boat, and continues into a survey of the old learning: creation and the ages, the genealogies, the duties of kings, the laws of inheritance, the making and ornament of images and temples, and the meritorious gifts, vows and pilgrimage of an ordinary religious life.",
    historicalContext:
      "Among the older Puranas, the Matsya is a principal source for the history of Indian art and architecture: its chapters on the measurements of the temple and on the proportion of images are quoted by later builders' manuals and by modern historians of art.",
    availabilityNote:
      "Complete: the Sanskrit text of chapters 1 to 176 as GRETIL publishes it, streamed from GRETIL at read time, one chapter at a time. This is the original Sanskrit, not a translation.",
    refScheme: "chapter.verse",
    componentLabels: ["Adhyāya {v}"],
    skipLeadLines: 1,
    editionTitle: "Matsyapurāṇa, adhyāyas 1–176 (GRETIL e-text)",
    functions: ["canonical_scripture", "religious_law_practice"],
  },
  {
    slug: "markandeya-purana",
    stem: "sa_mArkaNDeyapurANa1-93",
    abbrev: "markp",
    title: "The Markandeya Purana",
    originalTitle: "मार्कण्डेयपुराण",
    transliteration: "Mārkaṇḍeyapurāṇa",
    altTitles: ["Markandeya Puranam"],
    school: "puranic",
    genre: "Purana",
    textType: "Narrative scripture in verse",
    category: "Purana",
    subcategory: "Shakta Puranas",
    dateStart: 300,
    dateEnd: 600,
    dateDisplay: "c. 4th–6th century CE",
    authorshipStatus: "composite",
    author: "vyasa",
    attributionNote:
      "Ascribed to Vyasa and narrated by the sage Markandeya. Its later chapters, the Devi Mahatmya, are among the earliest Sanskrit scriptures of the Goddess.",
    description:
      "The Markandeya Purana opens with questions about the duties of the four stages of life and the trouble of a childless king, and moves through cosmology, the ages of the world and the genealogies, closing with the Devi Mahatmya: the Goddess's victory over Madhu and Kaitabha, over Mahishasura and over Shumbha and Nishumbha, recited wherever Durga is worshipped.",
    historicalContext:
      "The Devi Mahatmya, its chapters 78 to 90, is recited in full at the autumn festival of Navaratri and is the foundational text of Shakta devotion. The Purana's frame narrative and its treatment of ethics and rebirth were also drawn on by later compendia.",
    availabilityNote:
      "Complete: the Sanskrit text of chapters 1 to 93 as GRETIL publishes it, streamed from GRETIL at read time, one chapter at a time. This is the original Sanskrit, not a translation.",
    refScheme: "chapter.verse",
    componentLabels: ["Adhyāya {v}"],
    skipLeadLines: 1,
    editionTitle: "Mārkaṇḍeyapurāṇa, adhyāyas 1–93 (GRETIL e-text)",
    functions: ["canonical_scripture", "mystical_contemplative"],
  },
  {
    slug: "agni-purana",
    stem: "sa_agnipurANa",
    abbrev: "ap",
    title: "The Agni Purana",
    originalTitle: "अग्निपुराण",
    transliteration: "Agnipurāṇa",
    altTitles: ["Agni Puranam"],
    school: "puranic",
    genre: "Purana",
    textType: "Encyclopaedic compendium in verse",
    category: "Purana",
    subcategory: "General Puranas",
    dateStart: 700,
    dateEnd: 1100,
    dateDisplay: "c. 8th–11th century CE",
    authorshipStatus: "composite",
    author: "vyasa",
    attributionNote:
      "Ascribed to Vyasa and taught, in the fiction of its frame, by Agni to the sage Vasishtha. It is a compilation, and its chapters draw on older Puranas, law books and technical treatises.",
    description:
      "The Agni Purana is the most encyclopaedic of the Puranas: in 382 chapters it covers cosmology and the avatars, the duties of kings and the art of war, law and penance, the making of images and the building of temples, ritual and pilgrimage, grammar, prosody, poetics and lexicography, medicine, the marks of gems, and the worship of Vishnu, Shiva and the Goddess.",
    historicalContext:
      "Written as a summary of the learning a learned householder might need, it is a key witness for the state of many Indian disciplines around the turn of the first millennium and is quoted as such by historians of law, art, medicine and literature.",
    availabilityNote:
      "Complete: the Sanskrit text of all 382 chapters as GRETIL publishes it, streamed from GRETIL at read time, one chapter at a time. This is the original Sanskrit, not a translation.",
    refScheme: "chapter.verse",
    componentLabels: ["Adhyāya {v}"],
    skipLeadLines: 3,
    editionTitle: "Agnipurāṇa (GRETIL e-text)",
    functions: ["canonical_scripture", "religious_law_practice"],
  },
  {
    slug: "samkhya-karika",
    stem: "sa_IzvarakRSNa-sAMkhyakArikA",
    abbrev: "SK",
    title: "The Samkhya Karika",
    originalTitle: "सांख्यकारिका",
    transliteration: "Sāṃkhyakārikā",
    altTitles: ["Samkhyakarika", "Sankhya Karika", "Samkhyasaptati"],
    school: "samkhya",
    genre: "Philosophy",
    textType: "Philosophical verses",
    category: "Darshana",
    subcategory: "Sankhya",
    dateStart: 300,
    dateEnd: 500,
    dateDisplay: "c. 4th–5th century CE",
    authorshipStatus: "established",
    author: "isvarakrishna",
    attributionNote:
      "Seventy-two or seventy-three verses by Isvarakrishna, who names himself in the last verse, written as a summary of the older Samkhya teaching that had been carried in now-lost sutras.",
    description:
      "The Samkhya Karika states the classical Samkhya in seventy verses: the twenty-five principles from material nature to consciousness, the three constituents of nature, the evolution of intellect, ego, mind and the senses, the nature of bondage and the recognition by which the conscious principle is released from nature. It is the shortest complete statement of one of India's oldest philosophical systems.",
    historicalContext:
      "The Karika displaced earlier Samkhya sutras to become the school's standard text, and its commentary tradition runs from Gaudapada and Mathara through Vachaspati Mishra. Its analysis of consciousness and nature was absorbed into Vedanta, medicine and the yoga tradition.",
    availabilityNote:
      "Complete: all seventy-three verses of the Sanskrit text as GRETIL publishes it, streamed from GRETIL at read time. This is the original Sanskrit, not a translation.",
    refScheme: "verse",
    componentLabels: [],
    singleChapterLabel: "Verses",
    editionTitle: "Sāṃkhyakārikā (GRETIL e-text)",
    functions: ["philosophical_work"],
  },
  {
    slug: "vaisheshika-sutra",
    stem: "sa_kaNAda-vaizeSikasUtra",
    abbrev: "kvs",
    title: "The Vaisheshika Sutra",
    originalTitle: "वैशेषिकसूत्र",
    transliteration: "Vaiśeṣikasūtra",
    altTitles: ["Vaisesika Sutra", "Kanada Sutra"],
    school: "vaisheshika",
    genre: "Philosophy",
    textType: "Aphorisms",
    category: "Darshana",
    subcategory: "Vaisheshika",
    dateStart: -200,
    dateEnd: 200,
    dateDisplay: "c. 2nd century BCE–2nd century CE",
    authorshipStatus: "traditional",
    author: "kanada",
    attributionNote:
      "Traditionally ascribed to the sage Kanada, whose name means atom-eater. The extant sutra is a compilation, and its ten books grew over time.",
    description:
      "The Vaisheshika Sutra sets out a philosophy of nature under six categories of reality: substance, quality, action, the universal, the particular and inherence. Within substance it argues that the material world is built from eternal atoms combined by an unseen force, and it joins that atomism to a theory of knowledge and to a religious account of duty and liberation.",
    historicalContext:
      "With the Nyaya school it became the Nyaya-Vaisheshika tradition, whose categories and atomism were debated for a thousand years and which became the reference point for Indian logic and philosophy of nature.",
    availabilityNote:
      "Complete: the Sanskrit text of all ten books as GRETIL publishes it, streamed from GRETIL at read time, one chapter at a time. This is the original Sanskrit, not a translation.",
    refScheme: "adhyaya.ahnika.sutra",
    componentLabels: ["Adhyāya {v}", "Āhnika {v}"],
    editionTitle: "Vaiśeṣikasūtra (GRETIL e-text)",
    functions: ["philosophical_work"],
  },
  {
    slug: "mimamsa-sutra",
    stem: "sa_jaimini-mImAMsAsUtra",
    abbrev: "jaim",
    title: "The Mimamsa Sutra",
    originalTitle: "मीमांसासूत्र",
    transliteration: "Mīmāṃsāsūtra",
    altTitles: ["Purva Mimamsa Sutra", "Jaimini Sutra", "Mimamsa Sutra"],
    school: "mimamsa",
    genre: "Philosophy",
    textType: "Aphorisms",
    category: "Darshana",
    subcategory: "Mimamsa",
    dateStart: -300,
    dateEnd: 200,
    dateDisplay: "c. 3rd century BCE–2nd century CE",
    authorshipStatus: "traditional",
    author: "jaimini",
    attributionNote:
      "Ascribed to Jaimini, a pupil of Vyasa in the epic tradition and the traditional founder of the Mimamsa school. The text was fixed over centuries and is partly lost in its middle books.",
    description:
      "The Mimamsa Sutra is the foundational text of Purva Mimamsa, the analysis of Vedic ritual and of the interpretation of the revealed word. In twelve chapters it lays down the rules by which injunction, permission, prohibition and the naming of a rite are told apart, arguing that the commands of the Veda are authoritative and independent of any author, and turning interpretation itself into a technical science.",
    historicalContext:
      "Mimamsa's rules of interpretation were the classical method by which Indian lawyers, theologians and grammarians argued about difficult texts, and its account of language influenced the philosophy of grammar. Its central claims were contested by Shankara and others, but its hermeneutics were never superseded.",
    availabilityNote:
      "Complete: the Sanskrit text of all twelve chapters as GRETIL publishes it, streamed from GRETIL at read time, one chapter at a time. This is the original Sanskrit, not a translation.",
    refScheme: "adhyaya.pada.sutra",
    componentLabels: ["Adhyāya {v}", "Pāda {v}"],
    editionTitle: "Mīmāṃsāsūtra (GRETIL e-text)",
    functions: ["philosophical_work", "religious_law_practice"],
  },
  {
    slug: "ashtadhyayi",
    stem: "sa_pANini-aSTAdhyAyI",
    abbrev: "ps",
    title: "The Astadhyayi",
    originalTitle: "अष्टाध्यायी",
    transliteration: "Aṣṭādhyāyī",
    altTitles: ["Panini's Grammar", "Astadhyayi", "Pāṇini Sūtra"],
    school: "vyakarana",
    genre: "Grammar",
    textType: "Aphorisms",
    category: "Grammar",
    subcategory: "Vyakarana",
    dateStart: -500,
    dateEnd: -400,
    dateDisplay: "c. 5th–4th century BCE",
    authorshipStatus: "established",
    author: "panini",
    attributionNote:
      "Composed by Panini, of whom little is known beyond the work itself, which names him in its closing verse and describes the language of his own region as one of its objects.",
    description:
      "The Astadhyayi describes Sanskrit in almost four thousand rules, ordered so that each rule applies after the ones before it and is overridden by the ones after. It gives the sounds, the morphology and the composition of the language, defines the technical operations by which forms are derived, and closes with rules for Vedic forms. Written in aphorisms of extraordinary economy, it is the founding work of Indian linguistics.",
    historicalContext:
      "Panini's grammar set the vocabulary of all later Sanskrit grammar and of Sanskrit literary culture, and its rule-ordering and formal style have been read by modern linguists as an early formal grammar. It survives as the centre of a tradition that runs through Katyayana's varttikas and Patanjali's Mahabhashya.",
    availabilityNote:
      "Complete: the Sanskrit sutras of all eight chapters in the transliteration GRETIL publishes, streamed from GRETIL at read time, one chapter at a time. This is the original Sanskrit, not a translation; the rules are unexpanded and are read with the traditional aids.",
    refScheme: "adhyaya.pada.sutra",
    componentLabels: ["Adhyāya {v}", "Pāda {v}"],
    editionTitle: "Aṣṭādhyāyī (GRETIL e-text)",
    functions: ["philosophical_work"],
  },
  {
    slug: "aryabhatiya",
    stem: "sa_AryabhaTa-AryabhaTIya",
    abbrev: "AB",
    title: "The Aryabhatiya",
    originalTitle: "आर्यभटीय",
    transliteration: "Āryabhaṭīya",
    altTitles: ["Aryabhatiya of Aryabhata", "Aryabhatiyam"],
    school: "jyotisha",
    genre: "Astronomy",
    textType: "Verses on mathematics and astronomy",
    category: "Science",
    subcategory: "Astronomy",
    dateStart: 499,
    dateEnd: 499,
    dateDisplay: "499 CE",
    authorshipStatus: "established",
    author: "aryabhata",
    attributionNote:
      "Written by Aryabhata of Kusumapura in 499 CE, who states his date, his school and the tradition he follows in the work itself.",
    description:
      "The Aryabhatiya is the oldest surviving Sanskrit work of mathematics and astronomy to treat both systematically: in four parts it gives the alphabetic notation of numbers, the arithmetic of squares, cubes, roots and proportions, the rules of interest and progressions, sines of arcs, the rotation of the earth, the sizes and periods of the sun, moon and planets and the calculation of eclipses.",
    historicalContext:
      "Aryabhata's earth rotates, his sines are tabulated for astronomy, and his place-value system with a written zero reached the Arab world and beyond — the arithmetic algorithms of medieval Europe are called after his name. Commentaries by Bhaskara I and Someshvara carried the work into the astronomical tradition that his critics and successors shaped.",
    availabilityNote:
      "Complete: all four parts (the ten-verse summary and the three divisions) in the Sanskrit text GRETIL publishes, streamed from GRETIL at read time, one part at a time. This is the original Sanskrit, not a translation.",
    refScheme: "part.verse",
    componentLabels: ["Pāda {v}"],
    editionTitle: "Āryabhaṭīya (GRETIL e-text)",
    functions: ["philosophical_work"],
  },
  {
    slug: "vedarthasamgraha",
    stem: "sa_rAmAnuja-vedArthasaMgraha",
    abbrev: "RVas",
    title: "The Vedarthasamgraha",
    originalTitle: "वेदार्थसंग्रह",
    transliteration: "Vedārthasaṃgraha",
    altTitles: ["Vedarthasangraha", "Summary of the Meaning of the Vedanta"],
    school: "vedanta",
    genre: "Philosophy",
    textType: "Prose treatise",
    category: "Vedanta",
    subcategory: "Vedanta treatises",
    dateStart: 1100,
    dateEnd: 1150,
    dateDisplay: "c. first half of the 12th century CE",
    authorshipStatus: "established",
    author: "ramanuja",
    attributionNote:
      "Written by Ramanuja as an independent summary of his reading of the Vedanta, before or beside his commentary on the Brahma Sutras.",
    description:
      "The Vedarthasamgraha gathers the meaning of the Vedanta into a single argument: that the Upanishads teach one reality, Brahman, which is the self of all things and is known through Scripture; that the individual soul and the material world are real modes of it, not illusions; and that devotion, understood as uninterrupted remembrance informed by knowledge, is the means of release. It is the compact statement of Vishishtadvaita.",
    historicalContext:
      "Ramanuja's teaching became the philosophical foundation of the Shri Vaishnava tradition and one of the three great schools of Vedanta; the Vedarthasamgraha is the shortest way into it, and was written for those who had studied the Upanishads but wanted their sense drawn together.",
    availabilityNote:
      "Complete: the Sanskrit prose text as GRETIL publishes it, streamed from GRETIL at read time. This is the original Sanskrit, not a translation.",
    refScheme: "section",
    componentLabels: [],
    singleChapterLabel: "Sections",
    editionTitle: "Vedārthasaṃgraha (GRETIL e-text)",
    functions: ["philosophical_work"],
  },
  {
    slug: "ramanuja-gita-bhashya",
    stem: "sa_rAmAnuja-bhagavadgItAbhASya",
    abbrev: "BhG",
    title: "Ramanuja's Commentary on the Bhagavad Gita",
    originalTitle: "गीताभाष्य",
    transliteration: "Gītābhāṣya",
    altTitles: ["Bhagavadgitabhashya", "Gita Bhashya of Ramanuja"],
    school: "vedanta",
    genre: "Commentary",
    textType: "Verse with prose commentary",
    category: "Vedanta",
    subcategory: "Gita commentary",
    dateStart: 1100,
    dateEnd: 1150,
    dateDisplay: "c. first half of the 12th century CE",
    authorshipStatus: "established",
    author: "ramanuja",
    attributionNote:
      "Commentary by Ramanuja on all eighteen chapters of the Bhagavad Gita, written from the standpoint of Vishishtadvaita and drawing on the older commentary attributed to Yamuna.",
    description:
      "Ramanuja reads the Gita as a single argument: that action performed as worship, knowable through knowledge of the self as a mode of Brahman, leads to the vision of the Lord, and that devotion to the Lord is both the means and the goal. Each verse is printed with his prose commentary on it, chapter by chapter and verse by verse.",
    historicalContext:
      "The Gita Bhashya is the Gita commentary of the Shri Vaishnava tradition and one of the three most influential readings of the poem, standing beside Shankara's Advaita commentary and Madhva's Dvaita commentary.",
    availabilityNote:
      "Complete: the Sanskrit verses of the Gita with Ramanuja's commentary on them, streamed from GRETIL at read time, one chapter at a time. This is the original Sanskrit, not a translation, and the commentary is printed with the verse it explains.",
    refScheme: "chapter.verse",
    componentLabels: ["Adhyāya {v}"],
    editionTitle: "Gītābhāṣya (GRETIL e-text)",
    functions: ["commentary_exegesis", "philosophical_work"],
  },
  {
    slug: "tantraloka",
    stem: "sa_abhinavagupta-tantrAloka",
    abbrev: "AbhT",
    title: "The Tantraloka",
    originalTitle: "तन्त्रालोक",
    transliteration: "Tantrāloka",
    altTitles: ["Tantraloka of Abhinavagupta", "Tantrāloka"],
    school: "shaivism",
    genre: "Philosophy",
    textType: "Verses with auto-commentary",
    category: "Tantra",
    subcategory: "Kashmir Shaiva tantra",
    dateStart: 990,
    dateEnd: 1015,
    dateDisplay: "c. 990–1015 CE",
    authorshipStatus: "established",
    author: "abhinavagupta",
    attributionNote:
      "Written by Abhinavagupta, who names himself and his teachers in its closing chapters. The verses are supported by his own prose commentary, the Tantralokaviveka.",
    description:
      "The Tantraloka is the great summary of Kashmir Shaiva tantra: in thirty-seven chapters (ahnikas) it sets out the nature of the absolute as consciousness and its freedom, the means of knowledge and the hierarchy of the tattvas, initiation and the transmission of doctrine, ritual, the ways of individual and universal experience, and finally the recognition in which the world is known as Shiva's own play.",
    historicalContext:
      "Abhinavagupta's synthesis gathered the tantric lineages of Kashmir into one philosophical system, and the Tantraloka became its authoritative statement — read in the twentieth century, alongside his commentaries, as one of the most elaborate accounts of consciousness in any Indian tradition.",
    availabilityNote:
      "Complete: the Sanskrit verses of all thirty-seven ahnikas, with the auto-commentary interleaved as GRETIL publishes it, streamed from GRETIL at read time, one ahnika at a time. This is the original Sanskrit, not a translation.",
    refScheme: "ahnika.verse",
    componentLabels: ["Āhnika {v}"],
    editionTitle: "Tantrāloka (GRETIL e-text)",
    functions: ["philosophical_work", "mystical_contemplative"],
  },
  {
    slug: "saundarya-lahari",
    stem: "sa_zaMkara-saundaryalaharI",
    abbrev: "Saul",
    title: "The Saundarya Lahari",
    originalTitle: "सौन्दर्यलहरी",
    transliteration: "Saundaryalaharī",
    altTitles: ["Saundarya Lahari", "The Wave of Beauty", "Anandalahari"],
    school: "shaktism",
    genre: "Hymn",
    textType: "Devotional and tantric verses",
    category: "Tantra",
    subcategory: "Shakta devotional",
    dateStart: 700,
    dateEnd: 900,
    dateDisplay: "c. 8th–9th century CE (attributed to Shankara)",
    authorshipStatus: "disputed",
    author: "shankara",
    attributionNote:
      "Traditionally ascribed to Shankara, and read as his hymn to the Goddess; a second, teaching the use of the circular diagram and the mantras, is regarded by many scholars as the work of a later Shri Vidya author.",
    description:
      "The Saundarya Lahari is a hundred verses in praise of the Goddess as Tripurasundari: her form, her ornaments and her court, the vision of her beauty granted to the devotee, and, in its second half, the worship of her Shri Chakra and the mantras and the discipline of the Shakta tradition. It is at once a poem of devotion and a tantric manual in verse.",
    historicalContext:
      "The hymn became the central devotional text of Shri Vidya and is recited wherever the Goddess is worshipped in the south of India; it is also the work through which the beauty of Sanskrit devotional verse has been most widely translated.",
    availabilityNote:
      "Complete: all 103 verses of the Sanskrit text as GRETIL publishes it, streamed from GRETIL at read time. This is the original Sanskrit, not a translation.",
    refScheme: "verse",
    componentLabels: [],
    singleChapterLabel: "Verses",
    editionTitle: "Saundaryalaharī (GRETIL e-text)",
    functions: ["prayer_liturgy", "mystical_contemplative"],
  },
  {
    slug: "devi-gita",
    stem: "sa_devIgItA",
    abbrev: "dg",
    title: "The Devi Gita",
    originalTitle: "देवीगीता",
    transliteration: "Devīgītā",
    altTitles: ["Devi Gita", "Song of the Goddess"],
    school: "shaktism",
    genre: "Purana",
    textType: "Dialogue in verse",
    category: "Tantra",
    subcategory: "Shakta texts",
    dateStart: 1000,
    dateEnd: 1200,
    dateDisplay: "c. 11th–12th century CE",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "The tenth book of the Devi Bhagavata Purana and its philosophical climax, in which the Goddess herself teaches the king Himalaya on the mountain of the gods.",
    description:
      "The Devi Gita presents the Goddess as the supreme reality and the world as her manifestation: she describes her own nature and the light of consciousness, the creation and dissolution of the worlds, the pilgrimage to her true seat, and the worship, breath-control and renunciation by which a devotee reaches her. It is the Shakta counterpart of the Bhagavad Gita.",
    historicalContext:
      "Composed in Bengal within the Devi Bhagavata Purana, the Devi Gita gave Shaktism a philosophical scripture of its own, and it is studied today as the tradition's systematic account of the Goddess as Brahman.",
    availabilityNote:
      "Complete: the ten chapters of the Sanskrit text as GRETIL publishes it, streamed from GRETIL at read time, one chapter at a time. This is the original Sanskrit, not a translation.",
    refScheme: "chapter.verse",
    componentLabels: ["Adhyāya {v}"],
    editionTitle: "Devīgītā (GRETIL e-text)",
    functions: ["canonical_scripture", "mystical_contemplative"],
  },
  {
    slug: "natyashastra",
    stem: "sa_bharata-nATyazAstra-1-1618-303335-37",
    abbrev: "bhn",
    title: "The Natyashastra",
    originalTitle: "नाट्यशास्त्र",
    transliteration: "Nāṭyaśāstra",
    altTitles: ["Natyasastra", "Bharata's Natyashastra", "Treatise on Drama"],
    school: "",
    genre: "Treatise",
    textType: "Aphorisms and verses",
    category: "Aesthetics",
    subcategory: "Dramaturgy",
    dateStart: -200,
    dateEnd: 200,
    dateDisplay: "c. 2nd century BCE–2nd century CE",
    authorshipStatus: "composite",
    author: "bharata",
    attributionNote:
      "Ascribed to the sage Bharata, to whom tradition also gives a hundred sons who recited it. The text is a compilation that grew over centuries.",
    description:
      "The Natyashastra is the oldest surviving treatise on drama, dance and music in the world: the origin of the theatre and its sacred uses, the training of actors, the structure of plays and the theory of plot, the gestures of the hands and the movements of the body, the modes and the emotions with their corresponding states, costume, ornament, make-up, the stage and its architecture, and music with its scales and rhythms.",
    historicalContext:
      "Everything later written on Indian performance takes the Natyashastra as its point of departure: classical dance, Sanskrit drama and Indian music theory all name its chapters. Its theory of the eight or nine rasa, the emotions a performance should evoke, became the central idea of Indian aesthetics.",
    availabilityNote:
      "Complete: the Sanskrit verses of the chapters GRETIL publishes, streamed from GRETIL at read time, one chapter at a time. This is the original Sanskrit, not a translation.",
    refScheme: "chapter.verse",
    componentLabels: ["Adhyāya {v}"],
    editionTitle: "Nāṭyaśāstra (GRETIL e-text)",
    functions: ["philosophical_work"],
  },
  {
    slug: "sahityadarpana",
    stem: "sa_vizvanAthakavirAja-sAhityadarpaNa",
    abbrev: "vissd",
    title: "The Sahityadarpana",
    originalTitle: "साहित्यदर्पण",
    transliteration: "Sāhityadarpaṇa",
    altTitles: ["Sahityadarpana", "Mirror of Literature"],
    school: "",
    genre: "Poetics",
    textType: "Aphorisms with examples",
    category: "Aesthetics",
    subcategory: "Poetics",
    dateStart: 1350,
    dateEnd: 1450,
    dateDisplay: "c. 14th–15th century CE",
    authorshipStatus: "established",
    author: "vishvanatha-kaviraja",
    attributionNote:
      "Written by Vishvanatha Kaviraja, a poet and scholar of Odisha, who wrote it as a manual for students of poetics.",
    description:
      "The Sahityadarpana treats Sanskrit literary criticism as a single system in ten chapters: the definition of poetry and its language, the imagination the poet works with, the figures of speech with examples of each, the emotions and the states that carry them, the qualities and faults of a poem, the genres of drama and poem, and the conventions a reader is asked to accept.",
    historicalContext:
      "Popular for its clarity and its balanced definition of poetry as language that conveys beauty and emotion, the work became the standard handbook of poetics in eastern India and is the account of Sanskrit literary theory most often read today.",
    availabilityNote:
      "Complete: the ten chapters of the Sanskrit text as GRETIL publishes it, streamed from GRETIL at read time, one chapter at a time. This is the original Sanskrit, not a translation.",
    refScheme: "chapter.verse",
    componentLabels: ["Pariccheda {v}"],
    editionTitle: "Sāhityadarpaṇa (GRETIL e-text)",
    functions: ["philosophical_work"],
  },
  {
    slug: "gita-govinda",
    stem: "sa_jayadeva-gItagovinda",
    abbrev: "GG",
    title: "The Gita Govinda",
    originalTitle: "गीतगोविन्द",
    transliteration: "Gītagovinda",
    altTitles: ["Gita Govinda", "Song of the Cowherd", "Gita Gobindam"],
    school: "vaishnavism",
    genre: "Poetry",
    textType: "Lyric poem with songs",
    category: "Poetry",
    subcategory: "Devotional poetry",
    dateStart: 1150,
    dateEnd: 1200,
    dateDisplay: "c. late 12th century CE",
    authorshipStatus: "established",
    author: "jayadeva",
    attributionNote:
      "Written by Jayadeva, a poet of Bengal, who names himself in the poem's verses and whose verses carry the musical modes and rythms to which they were sung.",
    description:
      "The Gita Govinda is a poem of twelve cantos on Krishna and Radha: the joy of their meeting, Radha's grief and jealousy at Krishna's absence, her friend's pleading, the moonlit night on the Yamuna, and the reconciliation in which the poem's devotional and erotic senses are inseparable. Each canto closes in a song marked with its melody and rhythm.",
    historicalContext:
      "Singing the Gita Govinda became part of temple worship in Odisha and Bengal, where it was performed for centuries; its treatment of divine love shaped the Vaishnava poetry of the whole of eastern India and the devotional theology written around Radha.",
    availabilityNote:
      "Complete: the twelve cantos of the Sanskrit text as GRETIL publishes it, in the transliteration GRETIL prints from its source edition, streamed from GRETIL at read time, one canto at a time.",
    refScheme: "sarga.verse",
    componentLabels: ["Sarga {v}"],
    editionTitle: "Gītagovinda (GRETIL e-text)",
    functions: ["prayer_liturgy", "mystical_contemplative"],
  },
  {
    slug: "bhakti-rasamrita-sindhu",
    stem: "sa_rUpagosvAmin-haribhaktirasAmRtasindhu",
    abbrev: "rbhrs",
    title: "The Bhaktirasamritasindhu",
    originalTitle: "भक्तिरसामृतसिन्धु",
    transliteration: "Bhaktirasāmṛtasindhu",
    altTitles: ["Bhakti-rasamrita-sindhu", "Ocean of the Nectar of Devotion"],
    school: "vaishnavism",
    genre: "Philosophy",
    textType: "Verses with prose commentary",
    category: "Bhakti",
    subcategory: "Vaishnava theology",
    dateStart: 1540,
    dateEnd: 1560,
    dateDisplay: "c. mid-16th century CE",
    authorshipStatus: "established",
    author: "rupa-gosvamin",
    attributionNote:
      "Written by Rupa Gosvamin at Vrindavan, one of the six Gosvamins who systematised the teaching of Chaitanya. His own commentary, the Durgamasangamani, accompanies the verses.",
    description:
      "The Bhaktirasamritasindhu is the systematic theology of devotion in the Gaudiya Vaishnava tradition: it defines devotion and its varieties, sets out the practices that lead to it, analyses the emotional states and the stages through which love of Krishna matures, and ranks the different forms that love takes — concluding that the love of the cowherd women of Vrindavan, and of Radha above all, is the highest.",
    historicalContext:
      "The work turned the devotional movement around Chaitanya into a school with a theology, and its vocabulary for the emotions of love became the common property of later Vaishnava writing in Bengal and Braj.",
    availabilityNote:
      "Complete: the Sanskrit verses of all four divisions as GRETIL publishes them, streamed from GRETIL at read time, one chapter at a time. This is the original Sanskrit, not a translation.",
    refScheme: "division.chapter.verse",
    componentLabels: ["Vibhāga {v}", "Laharī {v}"],
    editionTitle: "Bhaktirasāmṛtasindhu (GRETIL e-text)",
    functions: ["philosophical_work", "mystical_contemplative"],
  },
  {
    slug: "shvetashvatara-upanishad",
    stem: "sa_zvetAzvataropaniSad",
    abbrev: "SvetUp",
    title: "The Shvetashvatara Upanishad",
    originalTitle: "श्वेताश्वतरोपनिषद्",
    transliteration: "Śvetāśvataropaniṣad",
    altTitles: ["Svetasvatara Upanishad", "Shvetashvatara Upanishad"],
    school: "vedanta",
    genre: "Upanishad",
    textType: "Philosophical verses",
    category: "Upanishad",
    subcategory: "Principal Upanishads",
    dateStart: -400,
    dateEnd: -200,
    dateDisplay: "c. 4th–2nd century BCE",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "Attributed by tradition to the teacher Shvetashvatara, who is named in the last chapter. The text is the work of a theistic circle within the Vedic schools.",
    description:
      "The Shvetashvatara Upanishad teaches a personal Lord who is the cause of the world and the self within every being: it describes the one who pervades all things, the wheel of becoming with its one and its many, the powers of nature and the individual soul that depend on him, and the disciplines — truth, austerity, meditation and the grace of the Lord — by which he is known. It is the Upanishad in which the yoga of meditation and the worship of a supreme Lord meet.",
    historicalContext:
      "One of the later principal Upanishads, it was important to the devotional Vedanta of Ramanuja and Madhva and is quoted for its description of the Lord and for its verses on yoga and the mind as the lamp of a steady flame.",
    availabilityNote:
      "Complete: the six chapters of the Sanskrit text as GRETIL publishes it, streamed from GRETIL at read time, one chapter at a time. This is the original Sanskrit, not a translation.",
    refScheme: "chapter.verse",
    componentLabels: ["Adhyāya {v}"],
    editionTitle: "Śvetāśvataropaniṣad (GRETIL e-text)",
    functions: ["canonical_scripture", "philosophical_work"],
  },
  {
    slug: "rigveda-samhita",
    stem: "sa_Rgveda-edAufrecht",
    abbrev: "RV",
    title: "The Rigveda — the Samhita text in Sanskrit",
    originalTitle: "ऋग्वेदसंहिता",
    transliteration: "Ṛgvedasaṃhitā",
    altTitles: ["Rig Veda Samhita", "Ṛgveda Saṃhitā"],
    school: "",
    genre: "Veda",
    textType: "Hymns in verse",
    category: "Veda",
    subcategory: "Samhita — Rigveda",
    dateStart: -1500,
    dateEnd: -1000,
    dateDisplay: "c. 1500–1000 BCE",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "The hymns were composed by many priestly families over centuries and are attributed within the text to named seers, one family of seers to each hymn. No single author is claimed for the collection, and the tradition of the seer of each hymn is carried in the index rather than asserted here.",
    description:
      "The Rigveda is the oldest of the Vedas and the oldest religious poetry in an Indo-European language: 1,028 hymns to Agni the fire, Indra the thunderer, Soma the drink of the sacrifice, Varuna the guardian of the oath, Ushas the dawn and the other powers, with the hymns of creation and of the cosmic order in the tenth book. The text here is the Samhita — the continuous collection of the hymns as they were recited, without the priestly prose of the Brahmanas or the rules of the Vedangas.",
    historicalContext:
      "The hymns were composed in the northwest of the subcontinent and were fixed as a canonical collection with the accent and the word-by-word recitation preserved. The Aufrecht edition of 1877 is the standard grapheme-level text still cited by Vedic scholars, and the digital form used here is the one prepared by Van Nooten and Holland, checked against it rather than copied from a single printed page.",
    availabilityNote:
      "Complete: the ten mandalas and 1,028 hymns of the Samhita in the Aufrecht edition, streamed from GRETIL at read time one hymn at a time. This is the Sanskrit original; the English verse translation the library already holds (Griffith, 1896) is a separate record.",
    refScheme: "mandala.hymn.verse",
    componentLabels: ["Maṇḍala {v}", "Hymn {v}"],
    editionTitle: "Ṛgvedasaṃhitā (Aufrecht's edition, GRETIL e-text)",
    functions: ["canonical_scripture", "prayer_liturgy"],
  },
  {
    slug: "ramayana-valmiki-sanskrit",
    stem: "sa_rAmAyaNa",
    abbrev: "R",
    title: "The Ramayana of Valmiki — the Sanskrit text",
    originalTitle: "रामायणम्",
    transliteration: "Vālmīkirāmāyaṇa",
    altTitles: ["Valmiki Ramayana", "Rāmāyaṇa"],
    school: "",
    genre: "Epic",
    textType: "Epic in verse",
    category: "Epic",
    subcategory: "Sanskrit epics",
    dateStart: -400,
    dateEnd: 200,
    dateDisplay: "c. 4th century BCE – 2nd century CE",
    authorshipStatus: "traditional",
    author: "valmiki",
    attributionNote:
      "Attributed to Valmiki, who is named in the epic itself as the first poet and whose verses are recited within the story. The poem grew by addition, and the first and seventh books are the latest strata.",
    description:
      "The Ramayana tells of Rama, exiled from Ayodhya for fourteen years, of Sita carried off to Lanka by Ravana, of the alliance with the monkeys and bears, of Hanuman's leap, and of the war that ends in Ravana's death and Sita's trial. Told in seven books, it joins a heroic adventure to a treatise on dharma: the duties of a king, a son, a wife and a brother are argued out in the midst of the action, and Rama is presented as the human who holds to them.",
    historicalContext:
      "Composed and transmitted by recitation over several centuries, the Ramayana became the scripture of kingship and of Rama devotion across South and Southeast Asia, and it exists in many regional recensions. This is Tokunaga's e-text of the northern recension, the Sanskrit that the printed editions and the translations follow.",
    availabilityNote:
      "Complete: all seven kandas, 606 sargas and 18,761 verses of the Sanskrit text as GRETIL publishes it, streamed from GRETIL at read time one sarga at a time. Unlike Griffith's translation held elsewhere in the library, this text includes the seventh book, the Uttara Kanda.",
    refScheme: "kanda.sarga.verse",
    componentLabels: ["Kāṇḍa {v}", "Sarga {v}"],
    editionTitle: "Vālmīkirāmāyaṇa (Tokunaga's e-text, GRETIL)",
    functions: ["canonical_scripture", "historical_document"],
  },
  {
    slug: "brihadaranyaka-upanishad",
    stem: "sa_bRhadAraNyakopaniSadkANva-recension-comm",
    abbrev: "brhup",
    title: "The Brihadaranyaka Upanishad, with Shankara's commentary",
    originalTitle: "बृहदारण्यकोपनिषद्",
    transliteration: "Bṛhadāraṇyakopaniṣad",
    altTitles: ["Brhadaranyaka Upanishad", "Brihadaranyaka Upanisad"],
    school: "vedanta",
    genre: "Upanishad",
    textType: "Prose and verse Upanishad",
    category: "Upanishad",
    subcategory: "Principal Upanishads",
    dateStart: -700,
    dateEnd: -500,
    dateDisplay: "c. 7th–6th century BCE",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "The Upanishad is anonymous; its central teaching is placed in the mouth of the sage Yajnavalkya at the court of king Janaka, and the text preserves that dialogue rather than claiming a single author. The commentary carried beside the text is ascribed to Shankara.",
    description:
      "The longest and oldest of the principal Upanishads, the Brihadaranyaka opens with the sacrifice of the horse as a figure of the cosmos and then pursues the self: in Yajnavalkya's answers to his wife Maitreyi and to the assembly at Janaka's court, being is described as the one to be heard, reflected on and known — not this, not this, the self that is the light of every act of knowing. It ends with the prayer to lead the reader from darkness to light.",
    historicalContext:
      "Its teaching is the basis of the Advaita Vedanta the commentaries elaborate and of much of later Indian thought about consciousness. Shankara's Bhashya is the commentary through which the Upanishad was read in the monastic schools, and the Kanva recension printed here is the one the commentary follows.",
    availabilityNote:
      "Complete: the six adhyayas of the Kanva recension from the GRETIL e-text, streamed at read time one brahmana at a time, with the commentary ascribed to Shankara in a second pane. Both texts are read from the same GRETIL file under their own reference markers.",
    refScheme: "adhyaya.brahmana.verse",
    componentLabels: ["Adhyāya {v}", "Brāhmaṇa {v}"],
    editionTitle: "Bṛhadāraṇyakopaniṣad (Kanva recension, GRETIL e-text)",
    variants: [
      {
        slug: "shankara-bhashya",
        title: "Śaṅkarabhāṣya on the Bṛhadāraṇyaka Upaniṣad",
        abbrev: "brhupbh",
        attribution: "Commentary ascribed to Shankara.",
      },
    ],
    functions: ["canonical_scripture", "philosophical_work"],
  },
  {
    slug: "chandogya-upanishad",
    stem: "sa_chAndogyopaniSad-comm",
    abbrev: "chup",
    title: "The Chandogya Upanishad, with Shankara's commentary",
    originalTitle: "छान्दोग्योपनिषद्",
    transliteration: "Chāndogyopaniṣad",
    altTitles: ["Chandogya Upanishad"],
    school: "vedanta",
    genre: "Upanishad",
    textType: "Prose and verse Upanishad",
    category: "Upanishad",
    subcategory: "Principal Upanishads",
    dateStart: -700,
    dateEnd: -500,
    dateDisplay: "c. 7th–6th century BCE",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "Anonymous, and — like the other Vedic Upanishads — transmitted as the teaching of several named teachers, Uddalaka Aruni above all. The commentary beside the text is ascribed to Shankara.",
    description:
      "The Chandogya teaches the identity of the self with the ground of the world through the analogy of salt dissolved in water and through the instruction of Uddalaka to his son Shvetaketu: that thou art. Beside those verses it carries the oldest Indian account of the states of the self, the chant of the udgitha, the story of Satyakama the truthful and the doctrine of the five fires.",
    historicalContext:
      "Historically one of the first Upanishads to be translated into a European language, and the Upanishad that gave the nineteenth-century West the sentence tat tvam asi. In the Vedanta schools Shankara's commentary is the reading against which the other commentaries define themselves.",
    availabilityNote:
      "Complete: the eight adhyayas and 154 khandas of the GRETIL e-text, streamed at read time one khanda at a time, with the commentary ascribed to Shankara in a second pane.",
    refScheme: "adhyaya.khanda.verse",
    componentLabels: ["Adhyāya {v}", "Khaṇḍa {v}"],
    editionTitle: "Chāndogyopaniṣad (GRETIL e-text)",
    variants: [
      {
        slug: "shankara-bhashya",
        title: "Śaṅkarabhāṣya on the Chāndogya Upaniṣad",
        abbrev: "chupbh",
        attribution: "Commentary ascribed to Shankara.",
      },
    ],
    functions: ["canonical_scripture", "philosophical_work"],
  },
  {
    slug: "aitareya-upanishad",
    stem: "sa_aitareyopaniSad-comm",
    abbrev: "aitup",
    title: "The Aitareya Upanishad, with Shankara's commentary",
    originalTitle: "ऐतरेयोपनिषद्",
    transliteration: "Aitareyopaniṣad",
    altTitles: ["Aitareya Upanishad"],
    school: "vedanta",
    genre: "Upanishad",
    textType: "Prose Upanishad",
    category: "Upanishad",
    subcategory: "Principal Upanishads",
    dateStart: -600,
    dateEnd: -400,
    dateDisplay: "c. 6th–4th century BCE",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "Anonymous. It is the fourth book of the Aitareya Aranyaka of the Rigveda and is named after its traditional teacher, Mahidasa Aitareya. The commentary beside the text is ascribed to Shankara.",
    description:
      "In a few pages the Aitareya tells how the self first thought the worlds and the guardians of the worlds, and then entered in: the gods tried to eat and could not until he gave them the bodies they work through, and from the same self grew speech, sight, hearing, mind and breath and the food that sustains them. Its first verse, that all this was the self alone before creation, is the sentence of the Upanishad.",
    historicalContext:
      "Placed fourth among the principal Upanishads and read with the Rigveda, it is cited in the Vedanta literature for its account of the self as the maker and the knower. Being short, it is one of the Upanishads chanted most often at the close of study.",
    availabilityNote:
      "Complete: the three adhyayas of the GRETIL e-text, streamed at read time one khanda at a time, with the commentary ascribed to Shankara in a second pane.",
    refScheme: "adhyaya.khanda.verse",
    componentLabels: ["Adhyāya {v}", "Khaṇḍa {v}"],
    editionTitle: "Aitareyopaniṣad (GRETIL e-text)",
    variants: [
      {
        slug: "shankara-bhashya",
        title: "Śaṅkarabhāṣya on the Aitareya Upaniṣad",
        abbrev: "aitupbh",
        attribution: "Commentary ascribed to Shankara.",
      },
    ],
    functions: ["canonical_scripture", "philosophical_work"],
  },
  {
    slug: "isha-upanishad",
    stem: "sa_IzopaniSad-or-IzAvAsyopaniSadkANva-recension-comm",
    abbrev: "isup",
    title: "The Isha Upanishad, with Shankara's commentary",
    originalTitle: "ईशोपनिषद्",
    transliteration: "Īśāvāsyopaniṣad",
    altTitles: ["Isha Upanishad", "Isavasya Upanishad", "Isa Upanisad"],
    school: "vedanta",
    genre: "Upanishad",
    textType: "Upanishad in verse",
    category: "Upanishad",
    subcategory: "Principal Upanishads",
    dateStart: -600,
    dateEnd: -400,
    dateDisplay: "c. 6th–4th century BCE",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "Anonymous, and the last chapter of the Shukla Yajurveda; no author is claimed. The commentary beside the text is ascribed to Shankara.",
    description:
      "Eighteen verses teach that the whole world is to be inhabited as the dwelling of the Lord, that the one who sees all beings in the self and the self in all beings is free of grief, and that knowledge and action, learning and birth are not enemies but are to be held together. It is the shortest and, for many readers, the most concentrated of the principal Upanishads.",
    historicalContext:
      "Chanted as the closing chapter of the Shukla Yajurveda and quoted at the beginning of the Isa Upanishad's school commentaries, these verses became a standard text of Vedanta teaching and of modern Indian thought about action.",
    availabilityNote:
      "Complete: all eighteen verses of the Kanva recension from the GRETIL e-text, streamed at read time, with the commentary ascribed to Shankara in a second pane.",
    refScheme: "verse",
    componentLabels: [],
    singleChapterLabel: "Īśāvāsyopaniṣad — the eighteen verses",
    editionTitle: "Īśāvāsyopaniṣad (Kanva recension, GRETIL e-text)",
    variants: [
      {
        slug: "shankara-bhashya",
        title: "Śaṅkarabhāṣya on the Īśāvāsyopaniṣad",
        abbrev: "isupbh",
        attribution: "Commentary ascribed to Shankara.",
      },
    ],
    functions: ["canonical_scripture", "philosophical_work"],
  },
  {
    slug: "katha-upanishad",
    stem: "sa_kathopaniSad",
    abbrev: "kau",
    title: "The Katha Upanishad",
    originalTitle: "कठोपनिषद्",
    transliteration: "Kaṭhopaniṣad",
    altTitles: ["Katha Upanishad"],
    school: "vedanta",
    genre: "Upanishad",
    textType: "Upanishad in verse",
    category: "Upanishad",
    subcategory: "Principal Upanishads",
    dateStart: -500,
    dateEnd: -300,
    dateDisplay: "c. 5th–3rd century BCE",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "Anonymous, and part of the Katha school of the Krishna Yajurveda. Its teaching is given as a dialogue between the boy Nachiketas and Yama, the lord of the dead.",
    description:
      "Nachiketas is offered three boons by Death and asks for the knowledge of what remains when the body is gone. Nothing is gained by wealth, Yama answers, and the path is the one the wise have called the choice of the good over the pleasant: the self is not born and does not die, it is not to be reached by argument but by the one who seeks it, and the senses must be held in the mind as horses in the reins.",
    historicalContext:
      "The Upanishad from which the verse about the chariot and the rider comes, and among the most retold of the Vedanta texts; it was the first Upanishad to appear separately in English in the nineteenth century and is still the one most often taught first.",
    availabilityNote:
      "Complete: the six vallis of the GRETIL e-text, streamed at read time one valli at a time. This is the Sanskrit text; the English translation held elsewhere in the library is a separate edition by a named translator.",
    refScheme: "valli.verse",
    componentLabels: ["Vallī {v}"],
    editionTitle: "Kaṭhopaniṣad (GRETIL e-text)",
    functions: ["canonical_scripture", "philosophical_work"],
  },
  {
    slug: "prashna-upanishad",
    stem: "sa_praznopaniSad-comm",
    abbrev: "prup",
    title: "The Prashna Upanishad, with Shankara's commentary",
    originalTitle: "प्रश्नोपनिषद्",
    transliteration: "Praśnopaniṣad",
    altTitles: ["Prashna Upanishad"],
    school: "vedanta",
    genre: "Upanishad",
    textType: "Prose Upanishad",
    category: "Upanishad",
    subcategory: "Principal Upanishads",
    dateStart: -500,
    dateEnd: -300,
    dateDisplay: "c. 5th–3rd century BCE",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "Anonymous, and belonging to the Pippalada school of the Atharvaveda; the teaching is given to six questioners by the teacher Pippalada. The commentary beside the text is ascribed to Shankara.",
    description:
      "Six students come to the sage Pippalada and each asks a question: where are all beings born from, how many powers keep the body, what is the relation of breath to the self, what sleeps and what watches in sleep, what is meditation, and what is the sixteen-part person. The answers move through the hierarchy of the senses and the breaths to the one who is the seer, and close with the counsel that this teaching is not to be given to anyone who has not lived it.",
    historicalContext:
      "Coming from the Atharvaveda, the Prashna is one of the later additions to the principal ten, and is read with the Mundaka and Mandukya in the Vedanta schools.",
    availabilityNote:
      "Complete: all six questions, sixty-seven units of the GRETIL e-text, streamed at read time one question at a time, with the commentary ascribed to Shankara in a second pane.",
    refScheme: "prashna.verse",
    componentLabels: ["Praśna {v}"],
    editionTitle: "Praśnopaniṣad (GRETIL e-text)",
    variants: [
      {
        slug: "shankara-bhashya",
        title: "Śaṅkarabhāṣya on the Praśnopaniṣad",
        abbrev: "prupbh",
        attribution: "Commentary ascribed to Shankara.",
      },
    ],
    functions: ["canonical_scripture", "philosophical_work"],
  },
  {
    slug: "nyaya-sutra",
    stem: "sa_gautama-nyAyasUtra-comm",
    abbrev: "nys",
    title: "The Nyaya Sutras, with Vatsyayana's Bhashya",
    originalTitle: "न्यायसूत्र",
    transliteration: "Nyāyasūtra",
    altTitles: ["Nyaya Sutra", "Gautama's Nyaya Sutras"],
    school: "nyaya",
    genre: "Philosophy",
    textType: "Aphorisms with commentary",
    category: "Philosophy",
    subcategory: "Nyaya",
    dateStart: -200,
    dateEnd: 200,
    dateDisplay: "c. 2nd century BCE – 2nd century CE",
    authorshipStatus: "traditional",
    author: "gautama",
    attributionNote:
      "The sutras are ascribed to Gautama, also called Akshapada, and were given their received form over several centuries. The Bhashya beside them is the work of Vatsyayana, also called Pakshilasvamin, and is the base text of the whole later Nyaya literature.",
    description:
      "The Nyaya Sutras set out the means by which anything is known at all — perception, inference, comparison and testimony — and then the objects to be known, the body, the senses, the self and its liberation. They define debate itself: what counts as a reason, where an argument goes wrong, how a question is answered, what makes a rejoinder a mere quibble. Vatsyayana's Bhashya works through each aphorism with examples drawn from daily life and from the schools he refutes.",
    historicalContext:
      "With the Vaisheshika school the Nyaya formed the analytical wing of Indian philosophy, and in the Navya-Nyaya of later Bengal its logic was carried further than any other Indian school. The Bhashya is the oldest commentary that survives and the standard of correctness for all that followed.",
    availabilityNote:
      "Complete: all five adhyayas with their ahnikas and 529 units of the GRETIL e-text, streamed at read time one ahnika at a time. The sutras and Vatsyayana's Bhashya are read from the same GRETIL file under their own reference markers and shown in separate panes; the file is a plain transcription and has not been proof-read by the inputter.",
    refScheme: "adhyaya.ahnika.sutra",
    componentLabels: ["Adhyāya {v}", "Āhnika {v}"],
    editionTitle: "Nyāyasūtra with Vātsyāyana's Bhāṣya (GRETIL e-text)",
    variants: [
      {
        slug: "vatsyayana-bhashya",
        title: "Vātsyāyana's Nyāyabhāṣya",
        abbrev: "nysbh",
        attribution: "Commentary by Vatsyayana (Pakshilasvamin).",
      },
    ],
    functions: ["philosophical_work", "commentary_exegesis"],
  },
  {
    slug: "yoga-bhashya",
    stem: "sa_pataJjali-yogasUtra-with-bhASya",
    abbrev: "ys",
    title: "The Yoga Sutras with the Bhashya attributed to Vyasa",
    originalTitle: "पातञ्जलयोगशास्त्र",
    transliteration: "Pātañjalayogaśāstra",
    altTitles: ["Yoga Sutras with the Yoga Bhashya", "Patanjala Yoga Sastra"],
    school: "yoga",
    genre: "Philosophy",
    textType: "Aphorisms with commentary",
    category: "Philosophy",
    subcategory: "Yoga",
    dateStart: -100,
    dateEnd: 400,
    dateDisplay: "c. 1st century BCE – 4th century CE",
    authorshipStatus: "traditional",
    author: "patanjali",
    attributionNote:
      "The sutras are ascribed to Patanjali and the commentary that accompanies them to Vyasa, an author otherwise unknown who cannot be the compiler of the Mahabharata. The two were already transmitted as one text, the Patanjalayogasastra, and the edition followed here is the one Agashe printed at Poona in 1904.",
    description:
      "The Yoga Sutras define yoga as the stilling of the movements of the mind and then set out what stands in the way, what practice does, what the mind becomes in concentration, and the discipline of dispassion that ends in the isolation of the seer. The Bhashya explains each aphorism in prose, supplying the argument and the illustrations the sutras leave out, and it is the reason the text became a system rather than a collection of maxims.",
    historicalContext:
      "The combined text is the founding work of the Yoga school, and its reading of liberation as the isolation of pure awareness is the classical alternative to the Vedanta account. Its descriptions of practice were taken up by later compendia such as the Hatha Yoga Pradipika, which the library holds in translation.",
    availabilityNote:
      "Complete: all four padas and 195 units of the GRETIL e-text, streamed at read time one pada at a time. The sutras are printed in bold within the commentary in the source file and the two cannot be separated without losing the sense, so they are read as one continuous text; the commentary is not carried in a pane of its own.",
    refScheme: "pada.sutra",
    componentLabels: ["Pāda {v}"],
    editionTitle: "Pātañjalayogaśāstra (Agashe's edition, GRETIL e-text)",
    functions: ["philosophical_work", "commentary_exegesis"],
  },
  {
    slug: "shiva-sutras",
    stem: "sa_zivasUtra-with-vArttika",
    abbrev: "sivs",
    title: "The Shiva Sutras, with the Varttika",
    originalTitle: "शिवसूत्र",
    transliteration: "Śivasūtra",
    altTitles: ["Siva Sutras", "Shiva Sutras"],
    school: "shaivism",
    genre: "Tantra",
    textType: "Aphorisms with commentary",
    category: "Tantra",
    subcategory: "Kashmir Shaiva tantra",
    dateStart: 850,
    dateEnd: 900,
    dateDisplay: "c. 9th century CE",
    authorshipStatus: "traditional",
    author: "vasugupta",
    attributionNote:
      "The tradition holds that Vasugupta received these sutras in a dream and found them inscribed on a rock at the foot of a tree; they were written down in the ninth century. The Varttika read beside them is the commentary of the tenth-century Kashmiri tradition.",
    description:
      "In seventy-two aphorisms the Shiva Sutras teach that consciousness is the one reality and that its freedom is the power of acting: the bound soul is that same consciousness contracted, gnawing at the food of its own ignorance. The path is given as practice, knowledge and will, and the reader is told that the self is the actor and the act, and that entering the highest state is a matter of recognition rather than attainment.",
    historicalContext:
      "The base text of Kashmirian Shaivism, and the short scripture that Kshemaraja, Abhinavagupta's disciple, expanded into the commentary the school's practice rests on. The Tantraloka of Abhinavagupta, held elsewhere in this library, is its long philosophical development.",
    availabilityNote:
      "Complete: all three sections of the sutras (75 units) from the GRETIL e-text, each sutra streamed at read time, with the Varttika commentary in a second pane. The commentary repeats each sutra's reference with several units of its own, so its pane carries more lines than the root text.",
    refScheme: "unmesha.sutra",
    componentLabels: ["Unmeṣa {v}"],
    editionTitle: "Śivasūtra with Vārttika (GRETIL e-text)",
    variants: [
      {
        slug: "varttika",
        title: "Śivasūtravārttika",
        abbrev: "sivsv",
        attribution: "Commentary transmitted with the sutras in the Kashmiri Varttika.",
      },
    ],
    functions: ["canonical_scripture", "mystical_contemplative"],
  },
  {
    slug: "yajnavalkya-smriti",
    stem: "sa_yAjJavalkyasmRti",
    abbrev: "S",
    title: "The Yajnavalkya Smriti",
    originalTitle: "याज्ञवल्क्यस्मृति",
    transliteration: "Yājñavalkyasmṛti",
    altTitles: ["Yajnavalkya Smriti", "Yajnavalkya Dharmasastra"],
    school: "",
    genre: "Dharmasastra",
    textType: "Dharma text in verse",
    category: "Dharmasastra",
    subcategory: "Smriti",
    dateStart: 200,
    dateEnd: 500,
    dateDisplay: "c. 3rd–5th century CE",
    authorshipStatus: "traditional",
    author: "yajnavalkya",
    attributionNote:
      "Ascribed to the Vedic sage Yajnavalkya; the text was compiled centuries after him and carries the rules of the schools rather than the speech of the sage.",
    description:
      "The Yajnavalkya Smriti sets out dharma in three books: conduct — study, the sacraments, marriage, gifts and the duties of the stages of life; the rules of a state, of procedure and of evidence, and of the sale of goods, pledges and servants; and expiation. Its second book is the most systematic treatment of law in the older smritis and became the working law of much of India through the commentary upon it.",
    historicalContext:
      "Where the Laws of Manu are the smriti quoted most often, the Yajnavalkya Smriti is the one used most often in court, because it states the rules more clearly and in a better order. In Bengal it was read with the Mitaksara and in northern India with the Balakrida, and the British Indian courts took it — with those commentaries — as the Hindu law they were bound to apply.",
    availabilityNote:
      "Complete: all three kandas, 1,011 verses of the GRETIL e-text, streamed at read time one kanda at a time. This is the Sanskrit text; no English translation is imported here.",
    refScheme: "kanda.verse",
    componentLabels: ["Kāṇḍa {v}"],
    editionTitle: "Yājñavalkyasmṛti (GRETIL e-text)",
    functions: ["religious_law_practice", "historical_document"],
  },
  {
    slug: "hitopadesha",
    stem: "sa_nArAyaNa-hitopadeza",
    abbrev: "hit",
    title: "The Hitopadesha",
    originalTitle: "हितोपदेश",
    transliteration: "Hitopadeśa",
    altTitles: ["Hitopadesa", "The Book of Good Counsel"],
    school: "",
    genre: "Fable",
    textType: "Fables in prose and verse",
    category: "Poetry",
    subcategory: "Narrative literature",
    dateStart: 1100,
    dateEnd: 1400,
    dateDisplay: "c. 12th–14th century CE",
    authorshipStatus: "traditional",
    author: "narayana",
    attributionNote:
      "Ascribed to a Narayana, of whom nothing further is known. He drew the stories from the Panchatantra and the Mahabharata and arranged them as a course of instruction for a prince.",
    description:
      "A teacher, Vishnusharman, undertakes to educate three princes who learn nothing from books, and does it with stories: the loss of friends, the winning of friends, war and peace. A crow, a turtle, a lion, a jackal and a louse argue out trust, flattery, counsel and the limits of cleverness, each tale closing in a verse that states the lesson.",
    historicalContext:
      "The Sanskrit version of the animal fables of the Panchatantra, and the one that travelled: it was translated into Persian for the Mughal court and thence into European languages, and it is the form in which the Indian beast fable reached the West.",
    availabilityNote:
      "Complete: all four books and 715 verses of the GRETIL e-text, with the opening verses of the author's salutation, which the source numbers 0.x, dropped as the file's own preface rather than part of the work. Streamed one book at a time; the prose framing is carried with the verse that closes each story.",
    refScheme: "book.verse",
    componentLabels: ["Book {v}"],
    dropRefPrefix: "0.",
    editionTitle: "Hitopadeśa (GRETIL e-text)",
    functions: ["ethical_humanist_manifesto", "contemporary_spiritual_writing"],
  },
  {
    slug: "vakyapadiya",
    stem: "sa_bhartRhari-vAkyapadIya",
    abbrev: "BVaky",
    title: "Bhartrihari's Vakyapadiya",
    originalTitle: "वाक्यपदीय",
    transliteration: "Vākyapadīya",
    altTitles: ["Vakyapadiya"],
    school: "vyakarana",
    genre: "Grammar",
    textType: "Verse treatise",
    category: "Grammar",
    subcategory: "Vyakarana",
    dateStart: 450,
    dateEnd: 550,
    dateDisplay: "c. 5th century CE",
    authorshipStatus: "traditional",
    author: "bhartrhari",
    attributionNote:
      "By Bhartrihari, the grammarian and philosopher. The second book appears to have lost part of its middle in transmission, and the commentary on the work is not part of this text.",
    description:
      "The Vakyapadiya argues that language is not a tool the mind uses but the substance of what is known: a word is an indivisible unit that appears to be analysed into parts, meaning arises in the sentence rather than the word, and behind grammar stands the same reality the Vedanta calls brahman. Its first book sets out the doctrine of the word-principle in verse; the second and third work through the categories of time, substance and negation.",
    historicalContext:
      "The chief work of the school of grammar as a philosophy, and the source of the doctrine that all knowledge is shot through with language that the later Kashmirian Shaiva authors took over. It is read both as grammar's account of its own object and as a metaphysics.",
    availabilityNote:
      "Complete as GRETIL publishes it: 1,997 units of the three khandas, streamed at read time one section at a time. The e-text numbers the verses in a mixed scheme, so some sections are addressed by khanda and samuddesha and others by khanda alone; the reader follows the file.",
    refScheme: "khanda.samuddesha.karika",
    componentLabels: ["Kāṇḍa {v}", "Samuddeśa {v}"],
    editionTitle: "Vākyapadīya (GRETIL e-text)",
    functions: ["philosophical_work", "academic_scholarship"],
  },
  {
    slug: "ashtavakra-gita",
    stem: "sa_aSTAvakragItA",
    abbrev: "Avg",
    title: "The Ashtavakra Gita",
    originalTitle: "अष्टावक्रगीता",
    transliteration: "Aṣṭāvakragītā",
    altTitles: ["Ashtavakra Samhita", "Song of Ashtavakra"],
    school: "vedanta",
    genre: "Gita",
    textType: "Dialogue in verse",
    category: "Scripture",
    subcategory: "Gitas",
    dateStart: 200,
    dateEnd: 900,
    dateDisplay: "c. 3rd–9th century CE",
    authorshipStatus: "traditional",
    author: "ashtavakra",
    attributionNote:
      "Attributed to the sage Ashtavakra, whom the Mahabharata places at the court of king Janaka. The verses were composed centuries later in the non-dual teaching of the Upanishads.",
    description:
      "The sage Ashtavakra answers king Janaka in twenty short chapters, and the answer never moves: there is no bondage and no liberation, no seeker and no sought, and the freedom that is wanted is the recognition of what one already is. Practice, purification and effort are put aside less as useless than as belonging to a self that was never bound — a teaching delivered, in the exchange that opens the book, while the king sits on his throne.",
    historicalContext:
      "A late Upanishadic text, and among the minor Gitas of the Vedic tradition. It became one of the texts most often carried between India and the West in the twentieth century, and is read in the Advaita and the neo-Vedanta line alike with the Bhagavad Gita, which sets out the same freedom through duty instead.",
    availabilityNote:
      "Complete: all twenty chapters and 298 verses of the GRETIL e-text, streamed at read time one chapter at a time. This is the Sanskrit text; the library holds no English edition, and the translation is not supplied here.",
    refScheme: "chapter.verse",
    componentLabels: ["Adhyāya {v}"],
    editionTitle: "Aṣṭāvakragītā (GRETIL e-text)",
    functions: ["canonical_scripture", "mystical_contemplative"],
  },
  {
    slug: "narada-pancharatra",
    stem: "sa_jJAnAmRtasArasaMhitA",
    abbrev: "jss",
    title: "The Jnanamritasara Samhita (the Narada Pancharatra)",
    originalTitle: "ज्ञानामृतसारसंहिता",
    transliteration: "Jñānāmṛtasārasaṃhitā",
    altTitles: ["Narada Pancharatra", "Naradiya Pancharatra", "Jnanamrtasara Samhita"],
    school: "vaishnavism",
    genre: "Samhita",
    textType: "Scripture in prose and verse",
    category: "Scripture",
    subcategory: "Pancharatra",
    dateStart: 500,
    dateEnd: 900,
    dateDisplay: "c. 6th–9th century CE",
    authorshipStatus: "traditional",
    author: "narada",
    attributionNote:
      "Presented as the teaching of the sage Narada to the sages at Naimisharanya, and so broadcast as the Narada Pancharatra. It was compiled by the Vaishnava Pancharatra schools over several centuries and its first book is the one carried here.",
    description:
      "The Narada Pancharatra sets out the ritual and the theology of the Pancharatra Vaishnavas: how Vishnu is to be known in his five forms, how an image is to be consecrated and worshipped, the initiations that make a worshipper, the mantras and their repetition, and the discipline of a teacher of the tradition. Its first book gathers the teaching on knowledge and on liberation into a single statement of what the sect holds.",
    historicalContext:
      "The Pancharatra samhitas are the textual foundation of temple Vaishnavism, and their devotional theology underlies the Vedanta of Ramanuja, who held them to be as authoritative as the Upanishads. The Narada Pancharatra was one of the texts on the earlier acquisition register that had no verified edition; the GRETIL e-text supplies the Sanskrit of its first book.",
    availabilityNote:
      "Book 1 only: the GRETIL e-text carries the first book of the samhita, 1,004 units, streamed at read time one section at a time, as the register's entry records. The remaining books are not published in this transcription and the work is not claimed as complete.",
    refScheme: "patala.adhyaya.verse",
    componentLabels: ["Paṭala {v}", "Adhyāya {v}"],
    editionTitle: "Jñānāmṛtasārasaṃhitā, Book 1 (GRETIL e-text)",
    functions: ["canonical_scripture", "prayer_liturgy", "religious_law_practice"],
  },
  {
    slug: "gopatha-brahmana",
    stem: "sa_gopathabrAhmaNa",
    abbrev: "gbr",
    title: "The Gopatha Brahmana",
    originalTitle: "गोपथब्राह्मण",
    transliteration: "Gopathabrāhmaṇa",
    altTitles: ["Gopatha Brahmanam"],
    school: "",
    genre: "Brahmana",
    textType: "Priestly prose with verse",
    category: "Veda",
    subcategory: "Brahmana",
    dateStart: -900,
    dateEnd: -600,
    dateDisplay: "c. 9th–6th century BCE",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "Anonymous priestly prose of the Atharvaveda tradition, named after the sage Gopatha and transmitted without an author's name.",
    description:
      "The Gopatha Brahmana is the only Brahmana of the Atharvaveda: it explains the sacrificial formulas of that Veda, the duties of the brahman priest who supervises the rite, the ceremonies of the year, the anointing of a king, and the verses by which each offering is understood. Its two parts move from the order of the sacrifice to the Veda itself and the persons who may keep it.",
    historicalContext:
      "The Atharvaveda had no Brahmana of its own in the older series, and the Gopatha was composed late to supply the lack; it is therefore a Brahmana written after the period of the Brahmanas, and its account of the Veda and its reciters is read as evidence for how the corpus was understood in the last centuries before the common era.",
    availabilityNote:
      "Complete: both prapathakas and 5,242 units of the GRETIL e-text, which follows Arlo Griffiths's transcription, streamed at read time one anuvaka at a time. The file's opening colophon, which it numbers 0.0.0, is dropped.",
    refScheme: "prapathaka.anuvaka.kandika",
    componentLabels: ["Prapāṭhaka {v}", "Anuvāka {v}"],
    dropRefPrefix: "0.0.0",
    // The file wraps each marker in brackets and letters its sections —
    // "a) … || (gbr_1,1.1)" — so the e-text's own apparatus is trimmed off the
    // ends of each unit.
    trimDecorations: true,
    editionTitle: "Gopathabrāhmaṇa (GRETIL e-text)",
    functions: ["canonical_scripture", "historical_document"],
  },
  {
    slug: "kaushitaki-brahmana",
    stem: "sa_kauSItakibrAhmaNa",
    abbrev: "KB",
    title: "The Kaushitaki Brahmana",
    originalTitle: "कौषीतकिब्राह्मण",
    transliteration: "Kauṣītakibrāhmaṇa",
    altTitles: ["Kausitaki Brahmana", "Sankhayana Brahmana"],
    school: "",
    genre: "Brahmana",
    textType: "Priestly prose with verse",
    category: "Veda",
    subcategory: "Brahmana",
    dateStart: -900,
    dateEnd: -700,
    dateDisplay: "c. 9th–7th century BCE",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "Anonymous priestly prose of the Rigveda, also called the Sankhayana Brahmana after the school that carried it. No author is named or claimed.",
    description:
      "The Kaushitaki Brahmana explains the hymns of the Rigveda as they are used: which verse accompanies the pressing of the soma, the kindling of the fire, the offering of the cake, the sacrifices of the new and full moon and the horse sacrifice, and the ceremonies by which a sacrificer is made fit for each. It is the prose commentary through which the Rigveda was actually performed.",
    historicalContext:
      "One of the two great Brahmanas of the Rigveda, and the source — together with the Aitareya — of the oldest surviving prose in Sanskrit and of the ritual rules the Shrauta Sutras later codified.",
    availabilityNote:
      "Complete: all thirty adhyayas, 6,914 units of the GRETIL e-text following Muneo Tokunaga's input, streamed at read time one section at a time.",
    refScheme: "adhyaya.khanda.kandika",
    componentLabels: ["Adhyāya {v}", "Khaṇḍa {v}"],
    trimDecorations: true,
    editionTitle: "Kauṣītakibrāhmaṇa (GRETIL e-text)",
    functions: ["canonical_scripture", "religious_law_practice"],
  },
  {
    slug: "shiva-purana",
    stem: "sa_zivapurANabooks-1-and-7",
    abbrev: "ivp",
    title: "The Shiva Purana — books one and seven",
    originalTitle: "शिवपुराण",
    transliteration: "Śivapurāṇa",
    altTitles: ["Siva Purana", "Shiva Puranam"],
    school: "shaivism",
    genre: "Purana",
    textType: "Narrative scripture in verse",
    category: "Purana",
    subcategory: "Shaiva Puranas",
    dateStart: 800,
    dateEnd: 1200,
    dateDisplay: "c. 9th–12th century CE",
    authorshipStatus: "composite",
    author: "vyasa",
    attributionNote:
      "Ascribed to Vyasa like the other Puranas. The text as it survives is the product of the Shaiva communities of northern India, compiled and enlarged over several centuries.",
    description:
      "The Shiva Purana is the great narrative scripture of Shiva: the creation and the dissolution of the worlds, the linga, the destruction of Daksha's sacrifice, the marriage of Shiva and Parvati, the birth and wars of Skanda and Ganesha, the deeds of the avatars and the great pilgrimage centres. It teaches the worship of the linga and the observance of the days and vows of the Shaiva year.",
    historicalContext:
      "The Purana the Shaiva Siddhanta and the Shaiva traditions of north India read: its seven samhitas collect older material, and its teaching on devotion to Shiva shaped temple worship and pilgrimage across the subcontinent.",
    availabilityNote:
      "Partial: the GRETIL e-text carries books one and seven only, in the edition of the Anandashrama, and they are streamed at read time one chapter at a time. Books two to six are not published in this transcription and the work is not claimed as complete; the availability note is part of the record rather than a defect of the import.",
    refScheme: "book.samhita.adhyaya.verse",
    componentLabels: ["Book {v}", "Saṃhitā {v}", "Adhyāya {v}"],
    editionTitle: "Śivapurāṇa, Books 1 and 7 (GRETIL e-text)",
    functions: ["canonical_scripture", "prayer_liturgy"],
  },
  {
    slug: "paippalada-samhita",
    stem: "sa_paippalAdasaMhitA",
    abbrev: "PS",
    title: "The Paippalada Samhita of the Atharvaveda",
    originalTitle: "पैप्पलादसंहिता",
    transliteration: "Paippalādasaṃhitā",
    altTitles: ["Atharvaveda, Paippalāda recension", "Paippalada Samhita"],
    school: "",
    genre: "Veda",
    textType: "Hymns, charms and speculative verses with prose",
    category: "Veda",
    subcategory: "Samhita — Atharvaveda (Paippalāda)",
    dateStart: -900,
    dateEnd: -400,
    dateDisplay: "c. 9th–5th century BCE; manuscripts from Kashmir and Orissa",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "The recension of the Atharvaveda handed down by the Paippalāda school rather than the Śaunaka school, transmitted in a Kashmir manuscript and in a living tradition in Orissa. GRETIL's e-text follows the critical editions of Durgamohan and Dipak Bhattacharya and the kāṇḍa editions of Zehnder, Lubotsky, Griffiths and Kubisch, and was entered by Arlo Griffiths with Thomas Zehnder, Philipp Kubisch, Duccio Lelli, Alexander Lubotsky, Carmen Spiers and Michael Witzel.",
    description:
      "The Paippalāda Saṃhitā is the second great recension of the Atharvaveda: twenty kāṇḍas of hymns and spells — healing and protection, the winning of a wife or a king's favour, the appeasement of demons and the punishment of enemies, royal consecration, and hymns on the breath, the sun and the cosmic orders — that run parallel to the Śaunaka text, share its core with it and differ from it in wording, order and the presence of verses the received Atharvaveda does not have.",
    historicalContext:
      "The Paippalāda school is known from the ritual literature of the Atharvaveda and survives as a reciting community in Orissa, whose manuscripts gave the text its second half. The Kashmir manuscript, obtained in 1875, introduced the recension to scholarship, and the twentieth-century editions shown here made it readable alongside the Śaunaka text as the other Atharvaveda.",
    availabilityNote:
      "Complete as GRETIL publishes it: the whole recension in twenty kāṇḍas, 910 hymns and 7,674 units, streamed from GRETIL one hymn at a time. Each passage is the verse or prose section of one hymn, addressed as kāṇḍa.hymn.verse. This is the original Sanskrit, not a translation.",
    refScheme: "kanda.sukta.verse",
    componentLabels: ["Kāṇḍa {v}", "Sūkta {v}"],
    unitDepth: 3,
    editionTitle: "Paippalādasaṃhitā (GRETIL e-text)",
    functions: ["canonical_scripture", "prayer_liturgy"],
  },
  {
    slug: "rigveda-khilani",
    stem: "sa_RgvedakhilAni",
    abbrev: "RvKh",
    title: "The Rigveda Khilani",
    originalTitle: "ऋग्वेदखिलानि",
    transliteration: "Ṛgvedakhilāni",
    altTitles: ["Khilani", "The apocrypha of the Rigveda"],
    school: "",
    genre: "Veda",
    textType: "Hymns in verse outside the received recension",
    category: "Veda",
    subcategory: "Samhita — Rigveda (Khila)",
    dateStart: -600,
    dateEnd: -200,
    dateDisplay: "late Vedic; collected and edited 1906",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "The hymns that stand outside the received Śākala recension of the Ṛgveda and were transmitted beside it: the appendices on the marriage and funeral rites, the Kuntāpa hymns, the Āprī and other additions. GRETIL's e-text follows J. Scheftelowitz, Die Apokryphen des Rgveda (Khilani), Breslau 1906, and was input by Muneo Tokunaga.",
    description:
      "The Khilāni are the Ṛgveda's own supplements: the verses recited over the wedding and the funeral, the Kuntāpa songs of the sacrificial ground, the Śrī hymns to fortune and the additions on the metre and the divine ordering of the sacrifice. They are hymns the Vedic ritual needed and the school recension did not carry, and they were recovered from the ritual sutras and the manuscripts that preserve them.",
    historicalContext:
      "Vedic ritual books quote verses as Ṛgvedic that the received text does not contain; Scheftelowitz collected them from the Vedic ritual and ancillary literature, which is why the collection stands in the corpus as the outer edge of the Ṛgveda rather than as a school recension.",
    availabilityNote:
      "Complete as GRETIL publishes it: the 584 verses of the Khilāni, divided into book and hymn, streamed from GRETIL at read time. A second, shorter series of marks the same file carries for the appendix of the appendix is not published as a division of the work and no markers of that series are indexed.",
    refScheme: "book.hymn.verse",
    componentLabels: ["Book {v}", "Hymn {v}"],
    unitDepth: 3,
    skipLeadLines: 2,
    editionTitle: "Ṛgvedakhilāni (GRETIL e-text)",
    functions: ["canonical_scripture", "prayer_liturgy"],
  },
  {
    slug: "rigvidhana",
    stem: "sa_RgvidhAna",
    abbrev: "RgV",
    title: "The Rigvidhana",
    originalTitle: "ऋग्विधान",
    transliteration: "Ṛgvidhāna",
    altTitles: ["Rigvidhana"],
    school: "",
    genre: "Vedanga",
    textType: "Ritual compendium in verse",
    category: "Veda",
    subcategory: "Vedanga — Vidhana",
    dateStart: 200,
    dateEnd: 600,
    dateDisplay: "late Vedic–early centuries CE (date unsettled)",
    authorshipStatus: "traditional",
    author: "",
    attributionNote:
      "A vidhāna text of the Ṛgveda tradition, ascribed to Śaunaka in the tradition that copied it. Its date is unsettled; like the other vidhānas it is later than the ritual sutras it summarises and earlier than the medieval compendia that quote it as a Ṛgvedic authority. GRETIL's e-text was input by Muneo Tokunaga.",
    description:
      "The Ṛgvidhāna is the ritual index of the Ṛgveda: for each purpose a sacrifice can serve — long life, children, kingship, rain, the defeat of an enemy, the aversion of misfortune — it names the hymn or the single verse to recite, the deity addressed and the offering that accompanies it. It turns a liturgical collection into a manual of practical uses, chapter by chapter, mantra by mantra.",
    historicalContext:
      "The vidhāna literature marks the point where the Vedic corpus is treated as a store of effective speech available for chosen ends; the Ṛgvidhāna is one of the earliest such handbooks and was quoted by later ritual and astrological works as the Ṛgveda's own prescription.",
    availabilityNote:
      "Complete as GRETIL publishes it: the whole compendium of 749 verses, streamed from GRETIL at read time. Each passage is one verse, addressed as adhyāya.verse, with the section of the adhyāya as its chapter.",
    refScheme: "adhyaya.section.verse",
    componentLabels: ["Adhyāya {v}", "Khaṇḍa {v}"],
    unitDepth: 3,
    editionTitle: "Ṛgvidhāna (GRETIL e-text)",
    functions: ["canonical_scripture", "religious_law_practice"],
  },
  {
    slug: "mandukya-karika",
    stem: "sa_mANDUkyopaniSatkArikA",
    abbrev: "mandupk",
    title: "Gaudapada's Mandukya Karika",
    originalTitle: "माण्डूक्यकारिका",
    transliteration: "Māṇḍūkyakārikā",
    altTitles: ["Gauḍapādakārikā", "Agamasastra", "Mandukya Karika"],
    school: "vedanta",
    genre: "Philosophy",
    textType: "Philosophical verses",
    category: "Vedanta",
    subcategory: "Advaita Vedanta",
    dateStart: 400,
    dateEnd: 700,
    dateDisplay: "c. 6th century CE (date unsettled)",
    authorshipStatus: "traditional",
    author: "gaudapada",
    attributionNote:
      "The four books of verses on the Māṇḍūkya Upaniṣad ascribed to Gauḍapāda, the teacher of Śaṅkara's teacher's teacher. GRETIL's e-text is taken from the commented edition, where the names of the verses come from the text as the tradition transmitted it; it was input by members of the Sansknet project.",
    description:
      "The Kārikā is the earliest systematic exposition of Advaita: it reads the four states of the self in the Māṇḍūkya as the four quarters of om and argues that the world of experience is, like a dream and like a rope seen as a snake, a construction that the knowledge of the unborn, non-dual self dissolves. Its second book works through illusion and causality, its third expounds non-dualism, and its last, the alātaśānti, argues with the firebrand whose moving spark traces a circle that exists nowhere.",
    historicalContext:
      "The Kārikā is the hinge of the Advaita tradition: the first Advaita text to argue its case philosophically, it was commented on by Śaṅkara and, in the school's teaching, is bound to the Upaniṣad it interprets. Its doctrine of non-origination was answered by the Buddhist philosophers and by Rāmānuja.",
    availabilityNote:
      "Complete: all four books of the Kārikā, 215 verses in four chapters, streamed from GRETIL at read time. Each passage is one verse, addressed as book.verse.",
    refScheme: "chapter.verse",
    componentLabels: ["Prakaraṇa {v}"],
    unitDepth: 2,
    editionTitle: "Māṇḍūkyopaniṣatkārikā (GRETIL e-text)",
    functions: ["philosophical_work", "canonical_scripture"],
  },
  {
    slug: "taittiriya-upanishad",
    stem: "sa_taittirIyopaniSad-zaMkarabhASya",
    abbrev: "TaittU",
    title: "The Taittiriya Upanishad",
    originalTitle: "तैत्तिरीयोपनिषद्",
    transliteration: "Taittirīyopaniṣad",
    altTitles: ["Taittiriya Upanishad"],
    school: "vedanta",
    genre: "Upanishad",
    textType: "Prose and verse scripture",
    category: "Upanishad",
    subcategory: "Principal Upanishads",
    dateStart: -700,
    dateEnd: -400,
    dateDisplay: "c. 6th–5th century BCE",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "Belonging to the Taittirīya school of the Kṛṣṇa Yajurveda and transmitted without an author's name: the śikṣā, brahmānanda and bhṛgu vallīs of the school's āraṇyaka. GRETIL's e-text was input by Ivan Andrijanić.",
    description:
      "The Taittirīya Upaniṣad opens with the rules of the teacher and the pupil — truth, austerity, self-control, the sacrifice, hospitality, and the call to keep the line of the Vedas unbroken — and moves through the five sheaths of the self to the teaching given to Bhrigu: the knower of Brahman attains the highest, and Brahman is that from which beings are born, by which they live and into which they return. It is the Upanishad of the pupil's obligations and of the joy of the one who has understood.",
    historicalContext:
      "The Upanishad of the Yajurveda's Taittirīya school, read with the school's āraṇyaka and given its place in the Advaita curriculum by the commentary attributed to Śaṅkara; its chapters on conduct make it the Upanishad most often read at the beginning of a course of study.",
    availabilityNote:
      "Complete as GRETIL publishes it: the whole Upaniṣad in three vallīs, 51 passages, streamed from GRETIL at read time. The file also carries Śaṅkara's commentary on part of the text — the fourth anuvākas of the third vallī have no commentary in this transcription — so the commentary is not shown as a second pane and the reader's notice names the edition being read.",
    refScheme: "valli.anuvaka.paragraph",
    componentLabels: ["Vallī {v}", "Anuvāka {v}"],
    unitDepth: 3,
    // The file prints its own title above the text and wraps each marker in
    // parentheses — "(TaittU_1,1.1)" — so the title line is dropped and the
    // leftover brackets are trimmed off the units.
    skipLeadLines: 1,
    trimDecorations: true,
    editionTitle: "Taittirīyopaniṣad with Śaṅkarabhāṣya (GRETIL e-text)",
    functions: ["canonical_scripture", "philosophical_work"],
  },
  {
    slug: "brahmabindu-upanishad",
    stem: "sa_brahmabindUpaniSad",
    abbrev: "brbup",
    title: "The Brahmabindu Upanishad",
    originalTitle: "ब्रह्मबिन्दूपनिषद्",
    transliteration: "Brahmabindūpaniṣad",
    altTitles: ["Brahmabindu Upanishad"],
    school: "yoga",
    genre: "Upanishad",
    textType: "Verses on mind and liberation",
    category: "Upanishad",
    subcategory: "Minor Upanishads — Atharvana",
    dateStart: 100,
    dateEnd: 600,
    dateDisplay: "early centuries CE (date unsettled)",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "One of the Atharvana (minor) Upanishads, transmitted without an author's name. GRETIL's e-text follows Ramamaya Tarkaratna's edition of the Atharvana-Upanishads, Calcutta 1872 (Bibliotheca Indica 76), and was input by Oliver Hellwig.",
    description:
      "The Brahmabindu Upaniṣad is a short teaching on the mind as the cause of both bondage and release: mind alone is the cause of men's bondage and liberation — bound when it is attached to objects, released when it is without them. It distinguishes the impure from the pure mind, describes the practice by which the mind is brought to rest and the sound of the inner ātman heard, and closes with the knower who neither comes nor goes.",
    historicalContext:
      "The text stands with the other Atharvana Upanishads on yoga and liberation — the Nādabindu, the Amṛtabindu, the Dhyānabindu — which the yoga and Vedanta traditions read as the scriptural form of their practice; the Brahmabindu is quoted for its teaching that purification of the mind is the whole of yoga.",
    availabilityNote:
      "Complete: the 22 verses are streamed from GRETIL at read time and indexed in reading order, because the Upanishad is a single continuous text without the divisions a chapter reference would name.",
    refScheme: "verse",
    componentLabels: [],
    singleChapterLabel: "The Upanishad",
    editionTitle: "Brahmabindūpaniṣad (GRETIL e-text)",
    functions: ["canonical_scripture", "mystical_contemplative"],
  },
  {
    slug: "harivamsha-sanskrit",
    stem: "sa_harivaMza",
    abbrev: "HV",
    title: "The Harivamsha — the Sanskrit text",
    originalTitle: "हरिवंश",
    transliteration: "Harivaṃśa",
    altTitles: ["Harivamsa", "Harivaṃśapurāṇa"],
    school: "vaishnavism",
    genre: "Epic",
    textType: "Genealogical epic in verse",
    category: "Epic",
    subcategory: "Sanskrit epics",
    dateStart: 100,
    dateEnd: 400,
    dateDisplay: "c. 2nd–4th century CE",
    authorshipStatus: "composite",
    author: "vyasa",
    attributionNote:
      "The Harivaṃśa is ascribed to Vyasa and transmitted as an appendix to the Mahabharata; its core is later than the epic's narrative books and the text was extended by the Krishna-worshipping communities that read it. GRETIL's e-text is the constituted text with the star passages of the Bhandarkar edition (Parashuram Lakshman Vaidya, Poona 1969) and was entered by a large team of scholars led by Peter Schreiner.",
    description:
      "The Harivaṃśa is the genealogy of the house of Krishna, told as a continuation of the Mahabharata: the creation and the ages, the solar and lunar lineages, the births of the gods, and then the life of Krishna — his birth in Mathura, the exchange that carried him to Vrindavan, the killing of the tyrant Kamsa, the founding of Dvaraka and his wars, the war of the Pandavas told in brief, and finally the destruction of the Yadavas and the departure of Krishna. Its Vishnu Parvan identifies Krishna with the supreme god and is the earliest long statement of that identification.",
    historicalContext:
      "The text stands at the point where the epic's hero becomes the object of worship: in it Krishna is narrated as a man of the Yadava house and praised as the god who sustains the world, and the devotional traditions of Mathura and Dvaraka trace their scriptural line to it. It was translated into English as the Harivamsa by Manmatha Nath Dutt and, in the same spirit, by the Poona editors whose constituted text GRETIL follows.",
    availabilityNote:
      "Complete as GRETIL publishes it: the constituted text with its star passages, the 118 chapters of the Harivaṃśa together with the opening invocation the file numbers 0, 6,071 verses in all, streamed from GRETIL one chapter at a time. The appendix the same edition prints as Appendix I is a separate file in GRETIL and is not published as part of this work, and the reader's notice names the edition being read. This is the original Sanskrit, not a translation.",
    refScheme: "adhyaya.verse",
    componentLabels: ["Adhyāya {v}"],
    unitDepth: 2,
    editionTitle: "Harivaṃśa, constituted text with star passages (GRETIL e-text)",
    functions: ["canonical_scripture", "mystical_contemplative"],
  },
  {
    slug: "narayaniya",
    stem: "sa_nArAyaNIya",
    abbrev: "MBh",
    title: "The Narayaniya of the Mahabharata",
    originalTitle: "नारायणीय",
    transliteration: "Nārāyaṇīya",
    altTitles: ["Narayaniya", "Mahābhārata 12.321–339"],
    school: "vaishnavism",
    genre: "Epic",
    textType: "Devotional and doctrinal verses",
    category: "Epic",
    subcategory: "Sanskrit epics",
    dateStart: 100,
    dateEnd: 400,
    dateDisplay: "c. 2nd–4th century CE",
    authorshipStatus: "composite",
    author: "vyasa",
    attributionNote:
      "The Nārāyaṇīya stands inside the Mahabharata's book of instruction (parvan 12, chapters 321–339), narrated to Arjuna on the field by Bhishma; it is part of the epic's didactic layer and is read in the Pāñcarātra tradition as one of its earliest authorities. GRETIL's e-text was input by Peter Schreiner.",
    description:
      "The Nārāyaṇīya teaches the worship of Nārāyaṇa as the origin and the end of all things: the seers ask how a man may reach the highest good, and the answer is the doctrine of the single god who pervades the worlds, the four conditions of the devotee, the rite of the twelve-day sacrifice, the thousand names of Vishnu and the dedication of every act to him. It is the point in the epic where Krishna is not only the counsellor of the Pandavas but the god whose knowledge the epic's teaching serves.",
    historicalContext:
      "Quoted and commented on in the Vedanta and Pāñcarātra literature — Rāmānuja cites it as scripture in his Vedārthasaṃgraha — the Nārāyaṇīya is where the epic and the devotional theology of the temple traditions meet; its verses are invoked in ritual and its recitation counted as merit.",
    availabilityNote:
      "Complete: the twenty chapters of the Nārāyaṇīya (Mahābhārata 12.321–339), 1,217 verses, streamed from GRETIL at read time. Each passage is one verse, addressed by the epic's own reference (parvan 12, adhyāya 321, verse 1), so the numbering is the one every Mahabharata edition and concordance uses.",
    refScheme: "parvan.adhyaya.verse",
    componentLabels: ["Parvan {v}", "Adhyāya {v}"],
    unitDepth: 3,
    editionTitle: "Nārāyaṇīya, Mahābhārata 12.321–339 (GRETIL e-text)",
    functions: ["canonical_scripture", "mystical_contemplative"],
  },
  {
    slug: "kurma-purana",
    stem: "sa_kUrmapurANa",
    abbrev: "kūrmp",
    title: "The Kurma Purana",
    originalTitle: "कूर्मपुराण",
    transliteration: "Kūrmapurāṇa",
    altTitles: ["Kurma Puranam"],
    school: "puranic",
    genre: "Purana",
    textType: "Narrative scripture in verse",
    category: "Purana",
    subcategory: "Shaiva Puranas",
    dateStart: 500,
    dateEnd: 900,
    dateDisplay: "c. 6th–9th century CE",
    authorshipStatus: "composite",
    author: "vyasa",
    attributionNote:
      "Ascribed to Vyasa like the other Puranas. The Kūrma Purāṇa is a Shaiva compilation, mainly of northern origin, that has taken in Vaishnava and Shakta material as well; its two parts, pūrva and uttara, were formed at different times.",
    description:
      "The Kūrma Purāṇa is spoken by Vishnu in his tortoise form to the king Indradyumna and then to the sages: it tells the creation and the four ages, the genealogy of the gods and kings, the sacred places of the earth and the duties of the castes and the stages of life, and then the Śiva chapter, in which Shiva declares himself the one to be known and worshipped. Its second part turns to the teaching of release, to the terrible goddesses and their worship, and to the doctrines of the Śaiva schools in a summary that has made the text important for the history of Shaiva thought.",
    historicalContext:
      "The Purana's Śiva-gītā is quoted by the Śaiva Siddhānta as one of its scriptural authorities, and its chapters on the sacred sites of the Narmada and the north give the pilgrim geography of the Shaiva traditions; it was also used by the compilers of later legal and ritual digests.",
    availabilityNote:
      "Complete as GRETIL publishes it: the whole Purāṇa in its two parts, 96 chapters and 5,823 verses, streamed from GRETIL at read time. Each passage is one verse, addressed as part.chapter.verse; the auspicious opening, which the edition numbers separately and lettered, forms the first chapter of part one.",
    refScheme: "part.chapter.verse",
    componentLabels: ["Part {v}", "Adhyāya {v}"],
    unitDepth: 3,
    editionTitle: "Kūrmapurāṇa (GRETIL e-text)",
    functions: ["canonical_scripture", "religious_law_practice"],
  },
  {
    slug: "narasimha-purana",
    stem: "sa_narasiMhapurANa",
    abbrev: "NsP",
    title: "The Narasimha Purana",
    originalTitle: "नरसिंहपुराण",
    transliteration: "Narasiṃhapurāṇa",
    altTitles: ["Narasimha Puranam"],
    school: "vaishnavism",
    genre: "Purana",
    textType: "Narrative scripture in verse",
    category: "Purana",
    subcategory: "Vaishnava Puranas",
    dateStart: 500,
    dateEnd: 1000,
    dateDisplay: "c. 5th–10th century CE",
    authorshipStatus: "composite",
    author: "vyasa",
    attributionNote:
      "Ascribed to Vyasa; the Narasiṃha Purāṇa is one of the shorter Puranas, a Vaishnava compilation of northern India whose contents overlap the Vishnu Purana and the Vishnudharmottara. GRETIL's e-text follows Siddheswar Jena's edition (Delhi 1987).",
    description:
      "The Narasiṃha Purāṇa is the Purana of the man-lion: drawn from older material on Vishnu's avatars, it narrates the deeds of the boar, the dwarf and above all Narasiṃha, the avatars of the fish and the tortoise, the churning of the ocean, the genealogies of the solar and lunar houses, and the killing of Hiranyakashipu, and with the stories it treats the worship of Vishnu, the sacred days and months, the duties of the castes and stages of life, and the practice of repeating the divine name.",
    historicalContext:
      "Its chapters on the avatars and on the calendar of vows were used by the Vaishnava communities of north India and by the compilers of later Puranic anthologies; the text is a witness to how the narrative Puranas were reworked into manuals of devotion and observance.",
    availabilityNote:
      "Complete as GRETIL publishes it: 68 chapters and 3,507 verses, streamed from GRETIL at read time. Each passage is one verse, addressed as chapter.verse.",
    refScheme: "adhyaya.verse",
    componentLabels: ["Adhyāya {v}"],
    unitDepth: 2,
    editionTitle: "Narasiṃhapurāṇa (GRETIL e-text)",
    functions: ["canonical_scripture", "prayer_liturgy"],
  },
  {
    slug: "vishnu-purana-sanskrit",
    stem: "sa_viSNupurANa-crit",
    abbrev: "ViP",
    title: "The Vishnu Purana — the Sanskrit text",
    originalTitle: "विष्णुपुराण",
    transliteration: "Viṣṇupurāṇa",
    altTitles: ["Vishnu Purana", "Viṣṇupurāṇam"],
    school: "vaishnavism",
    genre: "Purana",
    textType: "Narrative scripture in verse",
    category: "Purana",
    subcategory: "Vaishnava Puranas",
    dateStart: -100,
    dateEnd: 400,
    dateDisplay: "c. 1st century BCE–4th century CE",
    authorshipStatus: "composite",
    author: "vyasa",
    attributionNote:
      "Ascribed to Vyasa and one of the oldest of the Puranas; the critical edition followed here is M. M. Pathak's, published by the Oriental Institute, Vadodara, 1997–1999. GRETIL's e-text is the critically edited text without commentaries.",
    description:
      "The Vishnu Purana is the Purana of Vishnu and of the world he orders: the six books take the reader from the creation and the divisions of time through the genealogies of the patriarchs, the solar and lunar dynasties and the deeds of the avatars, to the description of the earth, the heavens, the ages and the final dissolution, with the last book devoted to the teaching of yoga and of release through the knowledge of Vishnu. Its account of Krishna's life in the fifth book is the earliest sustained one after the Harivamsha.",
    historicalContext:
      "Together with the Bhagavata it is the scripture of Vaishnava devotion, and it is the Purana the modern study of the tradition began from: H. H. Wilson's translation (1840) made it the first Purana read in Europe, and its table of contents is the model for the five subjects every Purana claims to treat.",
    availabilityNote:
      "Complete: the whole Purāṇa in six books, 127 chapters and 6,341 verses, in the critically edited text, streamed from GRETIL at read time. Each passage is one verse, addressed as book.chapter.verse. The transliterated Bombay edition, which carries the Śrīdhara commentary material, is a separate file on GRETIL and is not imported.",
    refScheme: "book.chapter.verse",
    componentLabels: ["Aṃśa {v}", "Adhyāya {v}"],
    unitDepth: 3,
    editionTitle: "Viṣṇupurāṇa, critical edition (GRETIL e-text)",
    functions: ["canonical_scripture", "philosophical_work"],
  },
  {
    slug: "vamana-purana",
    stem: "sa_vAmanapurANa1-69",
    abbrev: "vamp",
    title: "The Vamana Purana — chapters 1–69",
    originalTitle: "वामनपुराण",
    transliteration: "Vāmanapurāṇa",
    altTitles: ["Vamana Puranam"],
    school: "shaivism",
    genre: "Purana",
    textType: "Narrative scripture in verse",
    category: "Purana",
    subcategory: "Shaiva Puranas",
    dateStart: 700,
    dateEnd: 1100,
    dateDisplay: "c. 8th–11th century CE",
    authorshipStatus: "composite",
    author: "vyasa",
    attributionNote:
      "Ascribed to Vyasa; the Vāmanapurāṇa as it survives is a Shaiva text of north India, and GRETIL's e-text follows A. S. Gupta's edition (Varanasi 1967), which carries chapters 1–69 of the Purana.",
    description:
      "The Vāmana Purāṇa tells the deeds of Vishnu's dwarf incarnation and, around them, the pilgrimage geography of north India and the worship of Shiva: the birth of the dwarf and the sacrifice of Bali that he brought to an end, the great pilgrimage places on the Sarasvati and in the Himalaya, the destruction of Daksha's sacrifice, and the vows, gifts and purifications the reader is to observe. Its chapters on the tīrthas are among the fullest of any Purana.",
    historicalContext:
      "The Purana is a witness to the meeting of Vaishnava narrative and Shaiva worship in the medieval north, and it preserves in its pilgrimage chapters a description of the sacred landscape before the modern sites were settled.",
    availabilityNote:
      "Partial: chapters 1–69 of the Purana in the edition GRETIL publishes, 4,516 verses, streamed from GRETIL at read time. The edition's text stops at chapter 69 and the remaining chapters are not published in this transcription; the work is not claimed as complete, and the availability note is part of the record rather than a defect of the import.",
    refScheme: "adhyaya.verse",
    componentLabels: ["Adhyāya {v}"],
    unitDepth: 2,
    editionTitle: "Vāmanapurāṇa, Adhyāyas 1–69 (GRETIL e-text)",
    functions: ["canonical_scripture", "religious_law_practice"],
  },
  {
    slug: "skanda-purana-revakhanda",
    stem: "sa_skandapurANa-revAkhaNDa-rks",
    abbrev: "rks",
    title: "The Revakhanda of the Skanda Purana",
    originalTitle: "स्कन्दपुराण — रेवाखण्ड",
    transliteration: "Skandapurāṇa — Revākhaṇḍa",
    altTitles: ["RKS", "Revakhanda", "Bṛhat Śrīnarmadāpurāṇam"],
    school: "puranic",
    genre: "Purana",
    textType: "Narrative scripture in verse",
    category: "Purana",
    subcategory: "Pilgrimage and place Puranas",
    dateStart: 1200,
    dateEnd: 1700,
    dateDisplay: "c. 13th–17th century CE",
    authorshipStatus: "composite",
    author: "vyasa",
    attributionNote:
      "The Revākhaṇḍa is the Narmada section of the Skandapurāṇa tradition, transmitted as the Bṛhat Śrīnarmadāpurāṇa; the edition followed here is Oṅkārānanda Giri's (Jñānasatru Prakāśana), and it was input by Jürgen Neuss, whose study of the text established its place beside the Vāyu Purāṇa's Revākhaṇḍa.",
    description:
      "The Revākhaṇḍa is the Purana of the Narmada: it narrates the origin of the river and the pilgrimage along its banks, the sacred places from Omkareshvara and Maheshvara to the mouth of the river, the vratas and gifts performed there, the greatness of the linga of Omkara, the story of the river's descent and of the sages who bathed in it, and the merit that follows from hearing it. It is a place-Purana, one region's scripture of its river.",
    historicalContext:
      "The text is a late compilation that belonged to the Narmada's pilgrimage cult, and its transmission shows how a regional place-Purana was attached to the Skandapurāṇa and printed as part of it; Jürgen Neuss's work on the two Revākhaṇḍas separated the Skanda Purāṇa's text from the Vāyu Purāṇa's.",
    availabilityNote:
      "Complete as GRETIL publishes it: the 116 chapters and 6,724 verses of the Revākhaṇḍa, streamed from GRETIL at read time. Each passage is one verse, addressed as chapter.verse. GRETIL also publishes the Revākhaṇḍa that the Vāyupurāṇa tradition carries, and the library holds it as its own work.",
    refScheme: "adhyaya.verse",
    componentLabels: ["Adhyāya {v}"],
    unitDepth: 2,
    // The file prints its own title and the first chapter's heading above the
    // opening verse.
    skipLeadLines: 2,
    editionTitle: "Skandapurāṇa, Revākhaṇḍa (GRETIL e-text)",
    functions: ["canonical_scripture", "prayer_liturgy"],
  },
  {
    slug: "vayu-purana-revakhanda",
    stem: "sa_revAkhANDa-of-the-vAyupurANa-rkv",
    abbrev: "rkv",
    title: "The Revakhanda of the Vayu Purana",
    originalTitle: "वायुपुराण — रेवाखण्ड",
    transliteration: "Vāyupurāṇa — Revākhaṇḍa",
    altTitles: ["RKV", "Revakhanda of the Vayupurana"],
    school: "puranic",
    genre: "Purana",
    textType: "Narrative scripture in verse",
    category: "Purana",
    subcategory: "Pilgrimage and place Puranas",
    dateStart: 1200,
    dateEnd: 1800,
    dateDisplay: "c. 13th–18th century CE",
    authorshipStatus: "composite",
    author: "vyasa",
    attributionNote:
      "The Revākhaṇḍa that belongs to the Vāyupurāṇa tradition but was printed inside the Veṅkateśvara edition of the Skandapurāṇa, where it stood at the head of that Purana's Revākhaṇḍa. GRETIL follows the Veṅkateśvara Steam Press edition (Bombay 1910) and its reprints, and the file was input by Jürgen Neuss.",
    description:
      "This Revākhaṇḍa is the older of the two Narmada Puranas: it tells how the river came to the earth, the pilgrimage to its banks and to the shrines of its valley, the greatness of Omkāreśvara and of the sage Kapila's hermitage, the gifts, fasts and baths the pilgrim undertakes, and the lineage of the royal houses that ruled the region. Much of its material on the sacred sites is shared with the Purana of the Vāyu tradition it belongs to.",
    historicalContext:
      "The text's history is a case study in Puranic transmission: because the printer placed it inside the Skanda Purāṇa, later catalogues counted it as that Purana's own Revākhaṇḍa, and only the comparison of the manuscripts showed that it is the Vāyu Purāṇa's. GRETIL publishes it under that finding.",
    availabilityNote:
      "Complete as GRETIL publishes it: 232 chapters and 7,776 verses, streamed from GRETIL at read time. Each passage is one verse, addressed as chapter.verse. The library holds the Skandapurāṇa's own Revākhaṇḍa as a separate work, and the two are read side by side.",
    refScheme: "adhyaya.verse",
    componentLabels: ["Adhyāya {v}"],
    unitDepth: 2,
    // The file prints its own title above the opening invocation.
    skipLeadLines: 1,
    editionTitle: "Revākhaṇḍa of the Vāyupurāṇa (GRETIL e-text)",
    functions: ["canonical_scripture", "prayer_liturgy"],
  },
  // -------------------------------------------------------------------------
  // The dharma literature
  // -------------------------------------------------------------------------
  {
    slug: "manusmriti",
    stem: "sa_manusmRti",
    abbrev: "Manu",
    title: "The Manusmriti — the Sanskrit text",
    originalTitle: "मनुस्मृति",
    transliteration: "Manusmṛti",
    altTitles: ["Mānava-Dharmaśāstra", "Laws of Manu", "Manavadharmashastra"],
    school: "",
    genre: "Dharmasastra",
    textType: "Law code in verse",
    category: "Dharmasastra",
    subcategory: "Smriti",
    dateStart: -200,
    dateEnd: 200,
    dateDisplay: "c. 2nd century BCE–2nd century CE",
    authorshipStatus: "traditional",
    author: "manu",
    attributionNote:
      "The dharma text the tradition ascribes to Manu, the first of men, who is said to have received it from Brahma and to have taught it to the sages; it is a compilation of several hands, in which the older dharma of the schools was reshaped into the systematic code that later smriti literature quotes as its authority. GRETIL's e-text was input by Michio Yano and Yasuke Iriki.",
    description:
      "The Manusmṛti is the law book of classical India: the creation and the ages, the sources of dharma, the sacraments and stages of life, the duties of the student, the householder, the ascetic and the king, marriage, inheritance, the law of debt and contract, the punishments of the court, the law of the castes and of the mixed castes, purification and penance, and the law of women and of the household. Its verses carry both the ritual and the legal order, and its chapters on the king's court and on the evidence of witnesses made it the foundation of the Sanskrit legal tradition.",
    historicalContext:
      "Composed in the centuries around the turn of the era and commented on by Medhātithi, Kullūka, Govindarāja and others, the Manusmṛti became the text through which dharma was taught in the Sanskrit schools and the work the British administrators translated first. Every later smriti and digest refers to it, and Bühler's translation of it is one of the library's own English dharma texts.",
    availabilityNote:
      "Complete as GRETIL publishes it: all twelve adhyāyas and 2,688 verses, streamed from GRETIL at read time, one chapter at a time. This is the original Sanskrit, not a translation; the library holds Bühler's English translation as The Laws of Manu.",
    refScheme: "adhyaya.verse",
    componentLabels: ["Adhyāya {v}"],
    unitDepth: 2,
    editionTitle: "Manusmṛti (GRETIL e-text)",
    functions: ["religious_law_practice", "canonical_scripture"],
  },
  {
    slug: "vishnu-smriti",
    stem: "sa_viSNusmRti",
    abbrev: "ViS",
    title: "The Vishnu Smriti — the Sanskrit text",
    originalTitle: "विष्णुस्मृति",
    transliteration: "Viṣṇusmṛti",
    altTitles: ["Vaishnava Dharmasastra", "Vishnusmriti"],
    school: "vaishnavism",
    genre: "Dharmasastra",
    textType: "Dharma text in verse",
    category: "Dharmasastra",
    subcategory: "Smriti",
    dateStart: -300,
    dateEnd: 300,
    dateDisplay: "c. 3rd century BCE–3rd century CE (date unsettled)",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "A dharma text transmitted without an author's name, taught in it by Vishnu himself to the goddess of the earth: the rules of conduct and penance that a Vaishnava household kept. Different from the four dharma sutras in that its aphorisms are set out in verse, and later in date. GRETIL's e-text follows the edition of V. Krishnamacharya (Madras 1964, Adyar Library Series 93, 1–2), whose commentary by Nandapaṇḍita is not part of the file, and was input by I. Shima.",
    description:
      "The Viṣṇusmṛti sets out the duties of the castes and the stages of life, the sacraments of birth, initiation, marriage and death, the law of the king and of the court, the rules of purification and the penances that expiate each offence, fasting, pilgrimage, the gifts owed to Brahmins, and the worship of Vishnu. It is the most orderly of the smritis, arranged in a hundred adhyāyas whose verses were chanted and cited in the ritual digests of south India.",
    historicalContext:
      "Composed for the Vaishnava communities of the late ancient period, the text belongs with the Puranas and the sectarian dharmas that shaped the practice of temple and household; it was carried to the West by Julius Jolly's translation, which the library holds as The Institutes of Vishnu.",
    availabilityNote:
      "Complete as GRETIL publishes it: all 100 adhyāyas and 2,854 verses, streamed from GRETIL at read time, one chapter at a time. The commentary printed with the edition is not part of the e-text. This is the original Sanskrit, not a translation.",
    refScheme: "adhyaya.verse",
    componentLabels: ["Adhyāya {v}"],
    unitDepth: 2,
    editionTitle: "Viṣṇusmṛti (GRETIL e-text)",
    functions: ["religious_law_practice", "canonical_scripture"],
  },
  {
    slug: "gautama-dharmasutra",
    stem: "sa_gautama-dharmasUtra",
    abbrev: "GautSt",
    title: "The Dharmasutra of Gautama",
    originalTitle: "गौतमधर्मसूत्र",
    transliteration: "Gautamadharmasūtra",
    altTitles: ["Gautamadharmasutra", "Institutes of Gautama"],
    school: "",
    genre: "Dharmasastra",
    textType: "Aphorisms on dharma",
    category: "Dharmasastra",
    subcategory: "Dharmasutra",
    dateStart: -600,
    dateEnd: -200,
    dateDisplay: "c. 6th–3rd century BCE",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The dharma sutra of the school that bears the name of Gautama: transmitted without an author's name, and older than the metrical smritis that quote it. The library records no author for it, since the Gautama of the dharma text is not the same figure as the Gautama credited with the Nyaya sutras. GRETIL's e-text follows Ganesa Sastrin Gokhale's edition (Pune 1910, Anandashrama Sanskrit Series 61) with the variants of Stenzler's Institutes of Gautama (London 1876), and was input by Nobuyuki Watase.",
    description:
      "The Gautama Dharmasūtra is the oldest of the surviving dharma sutras and the shortest: the sources of dharma, the sacraments, the duties of the student, the householder's marriage and daily rites, the law of inheritance, the king's justice and the penances that answer each transgression, all in aphorisms meant to be learned with the Veda. Its rules on initiation, food, purification and the evidence of witnesses were the seed of the legal literature that followed it.",
    historicalContext:
      "Whitney, Bühler and Stenzler brought the text into European scholarship in the nineteenth century, and it was among the first Sanskrit law books to be translated; the Ānandāśrama and Stenzler editions number it differently, which is why GRETIL prints two references beside each sūtra.",
    availabilityNote:
      "Complete as GRETIL publishes it: 1,017 sūtras in 28 adhyāyas, streamed from GRETIL at read time. Each passage is one sūtra, addressed as adhyāya.sūtra in the numbering of Stenzler's edition; the file prints the reference of the Ānandāśrama edition beside it, and the reader trims that apparatus from the text it shows. This is the original Sanskrit, not a translation.",
    refScheme: "adhyaya.sutra",
    componentLabels: ["Adhyāya {v}"],
    unitDepth: 2,
    trimDecorations: true,
    editionTitle: "Gautamadharmasūtra (GRETIL e-text)",
    functions: ["religious_law_practice", "historical_document"],
  },
  {
    slug: "narada-smriti",
    stem: "sa_nAradasmRti",
    abbrev: "NarS",
    title: "The Naradasmriti — the Sanskrit text",
    originalTitle: "नारदस्मृति",
    transliteration: "Nāradasmṛti",
    altTitles: ["Narada Smriti", "Naradiyasmriti"],
    school: "",
    genre: "Dharmasastra",
    textType: "Law book in verse and prose",
    category: "Dharmasastra",
    subcategory: "Smriti",
    dateStart: 100,
    dateEnd: 400,
    dateDisplay: "c. 1st–4th century CE",
    authorshipStatus: "traditional",
    author: "narada",
    attributionNote:
      "The law book ascribed to the divine sage Nārada, the messenger of the gods; in its own frame the sages ask Nārada what procedure the courts followed before men fell away from dharma. GRETIL's e-text follows Richard W. Lariviere's critical edition (Philadelphia 1989, University of Pennsylvania Studies on South Asia 4–5) and was input by Yasuke Iriki.",
    description:
      "The Nāradasmṛti is the procedural law book of classical India: its mātṛkā on the grounds of a lawsuit and the conduct of the parties, its eighteen titles of law treating debt, deposits, partnership, sale without ownership, boundaries, marriage and the marital offences, inheritance, robbery, defamation, assault and gambling, and its appendix on documents — with the rules of pleading, of witnesses and of ordeals that made it the authority on procedure rather than on substantive law.",
    historicalContext:
      "Composed after the Manusmṛti and cited by every legal digest from the medieval period onward, the text was central to the Anglo-Indian reconstruction of Hindu law: Lariviere's edition and translation replaced the older ones, and the vyavahāra chapters are the fullest statement of Indian civil procedure to survive.",
    availabilityNote:
      "Complete as GRETIL publishes it: the mātṛkā, the eighteen vyavahārapadas and the pariśiṣṭa, 1,530 verses in all, streamed from GRETIL at read time. The file numbers the work inside its three parts — m for the mātṛkā, v for the vyavahārapada, p for the pariśiṣṭa — and the reader keeps those letters, naming each chapter with the part it belongs to. This is the original Sanskrit, not a translation.",
    refScheme: "part.chapter.verse",
    componentLabels: ["{v}"],
    partLabels: { m: "Mātṛkā", v: "Vyavahārapada", p: "Pariśiṣṭa" },
    unitDepth: 2,
    skipLeadLines: 2,
    editionTitle: "Nāradasmṛti, critical edition (GRETIL e-text)",
    functions: ["religious_law_practice", "historical_document"],
  },
  // -------------------------------------------------------------------------
  // The Sanskrit Buddhist canon
  // -------------------------------------------------------------------------
  {
    slug: "lotus-sutra-sanskrit",
    stem: "sa_saddharmapuNDarIkasUtra",
    abbrev: "saddhp",
    title: "The Lotus Sutra — the Sanskrit text",
    originalTitle: "सद्धर्मपुण्डरीकसूत्र",
    transliteration: "Saddharmapuṇḍarīkasūtra",
    altTitles: ["Saddharma-pundarika", "Lotus of the True Law"],
    tradition: "buddhism",
    school: "",
    genre: "Scripture",
    textType: "Mahayana sutra in prose and verse",
    category: "Mahayana",
    subcategory: "Saddharma-puṇḍarīka",
    dateStart: -100,
    dateEnd: 200,
    dateDisplay: "c. 1st century BCE–2nd century CE",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "A Mahayana sutra transmitted without an author and presented as the Buddha's own teaching on the Vulture Peak, assembled in the early centuries of the common era from layers of older verse and prose. GRETIL's e-text follows P. L. Vaidya's edition (Darbhanga 1960, Buddhist Sanskrit Texts 6) and was input by the Digital Sanskrit Buddhist Canon Input Project.",
    description:
      "The Saddharmapuṇḍarīkasūtra teaches that there is one vehicle and not three, that the Buddha's own awakening is immeasurable in age, and that a Buddha's lifespan and skilful means are beyond the measure of his hearers: the parable of the burning house and the three carts, the parable of the prodigal son, the jewelled stupa that opens to reveal the Buddha of the distant past, the dragon king's daughter who attains awakening, and the Bodhisattva Never Disparaging who salutes every being as a future Buddha. Its chapters on the duration of the Buddha's life and on the universal capacity to attain Buddhahood became the doctrinal centre of East Asian Buddhism.",
    historicalContext:
      "Composed in India and carried to China by Kumārajīva's translation of 406 and to Tibet later, the sutra was the ground of the Tiantai and Tendai schools and of the Japanese devotion to the Lotus that gave rise to Nichiren. Its Sanskrit text survives in Nepalese manuscripts and in the Central Asian fragments that the Vaidya edition collects.",
    availabilityNote:
      "Complete as GRETIL publishes it: all twenty-seven parivartas with their prose and verse, 1,230 passages, streamed from GRETIL at read time, one chapter at a time. This is the original Sanskrit, not a translation; the library holds Kern's English translation of the same sutra as The Lotus Sutra.",
    refScheme: "parivarta.verse",
    componentLabels: ["Parivarta {v}"],
    unitDepth: 2,
    editionTitle: "Saddharmapuṇḍarīkasūtra, Vaidya edition (GRETIL e-text)",
    functions: ["canonical_scripture", "mystical_contemplative"],
  },
  {
    slug: "lalitavistara",
    stem: "sa_lalitavistara",
    abbrev: "lal",
    title: "The Lalitavistara — the Sanskrit text",
    originalTitle: "ललितविस्तर",
    transliteration: "Lalitavistara",
    altTitles: ["Lalitavistara Sutra", "The Extensive Play"],
    tradition: "buddhism",
    school: "",
    genre: "Scripture",
    textType: "Mahayana sutra in prose and verse",
    category: "Mahayana",
    subcategory: "Buddha biography",
    dateStart: -100,
    dateEnd: 300,
    dateDisplay: "c. 1st century BCE–3rd century CE",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "A Mahayana sutra on the life of the Buddha, transmitted without an author: the Sarvāstivāda life of the Buddha elaborated with the Bodhisattva's career and the pure lands, and read as scripture rather than as biography. GRETIL's e-text follows P. L. Vaidya's edition (Darbhanga 1958, Buddhist Sanskrit Texts 1) and was input by the Digital Sanskrit Buddhist Canon Input Project.",
    description:
      "The Lalitavistara tells the Buddha's life as a cosmic play: the descent from the Tuṣita heaven, the conception and the dream of Māyā, the birth in Lumbinī and the terrestrial signs, the childhood and the lessons that outran his teachers, the women of the palace, the four encounters, the departure, the six years of asceticism, the defeat of Māra, the awakening, and the sermons of the first turning and of the great assembly at Varanasi, closing with the Bodhisattva's vows and the cosmic audiences that surround them — the fullest biography of the Buddha in the Sanskrit canon of the Mahayana.",
    historicalContext:
      "The text took its present form in the centuries around the turn of the era and was translated into Chinese in the third century and into Tibetan soon after; it shaped Buddhist art from Gandhara to Borobudur, and is the source through which the Buddha's life was told as scripture rather than as legend.",
    availabilityNote:
      "Complete as GRETIL publishes it: all twenty-seven parivartas, 1,515 passages of prose and verse, streamed from GRETIL at read time, one chapter at a time. This is the original Sanskrit, not a translation.",
    refScheme: "parivarta.verse",
    componentLabels: ["Parivarta {v}"],
    unitDepth: 2,
    // The file prints a homage, its own title, a second homage and the first
    // chapter's heading and name above the opening passage.
    skipLeadLines: 5,
    editionTitle: "Lalitavistara, Vaidya edition (GRETIL e-text)",
    functions: ["canonical_scripture"],
  },
  {
    slug: "samadhiraja-sutra",
    stem: "sa_samAdhirAjasUtra",
    abbrev: "srs",
    title: "The Samadhiraja Sutra — the Sanskrit text",
    originalTitle: "समाधिराजसूत्र",
    transliteration: "Samādhirājasūtra",
    altTitles: ["Samadhirajasutra", "The King of Meditations"],
    tradition: "buddhism",
    school: "",
    genre: "Scripture",
    textType: "Mahayana sutra in prose and verse",
    category: "Mahayana",
    subcategory: "Sūtras and śāstra",
    dateStart: 100,
    dateEnd: 400,
    dateDisplay: "c. 2nd–4th century CE",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "One of the nine dharmaparyāyas of the Nepalese Buddhist canon, transmitted without an author and closely related to the Samādhirāja verses quoted at length by Śāntideva's Śikṣāsamuccaya. GRETIL's e-text follows P. L. Vaidya's edition (Darbhanga 1961, Buddhist Sanskrit Texts 2) and was input by the Digital Sanskrit Buddhist Canon Input Project.",
    description:
      "The Samādhirājasūtra is the sutra of the samādhi that the Buddhas of the past, present and future enter, and of the vision of all phenomena as like the moon in water, like a mirage, like a dream: it teaches that the dharmas taught in the assemblies of the Buddha are to be found in the emptiness of all things, that the great compassion of a Bodhisattva is the entrance to this samādhi, and that a verse of it recited with faith outweighs immeasurable offerings. Its thirty-nine chapters of prose and verse, with the long verse sequences in which the Buddha answers Candraprabha, are among the deepest meditative sutras of the Mahayana.",
    historicalContext:
      "The sutra was quoted by the Madhyamaka and the Yogācāra alike, cited by Śāntideva and by the compilers of the Tibetan canon, and preserved in Sanskrit in Nepalese manuscripts whose publication by Vaidya made it available in the original.",
    availabilityNote:
      "Complete as GRETIL publishes it: all thirty-nine chapters with their prose and verse, 2,063 passages, streamed from GRETIL at read time, one chapter at a time. The file prints the title and the first chapter's heading above the opening lines and the reader drops them from the text. This is the original Sanskrit, not a translation.",
    refScheme: "parivarta.verse",
    componentLabels: ["Parivarta {v}"],
    unitDepth: 2,
    skipLeadLines: 2,
    editionTitle: "Samādhirājasūtra, Vaidya edition (GRETIL e-text)",
    functions: ["canonical_scripture", "mystical_contemplative"],
  },
  {
    slug: "suvarnaprabhasa-sutra",
    stem: "sa_suvarNaprabhAsasUtra",
    abbrev: "suv",
    title: "The Suvarnaprabhasa Sutra — the Sanskrit text",
    originalTitle: "सुवर्णप्रभाससूत्र",
    transliteration: "Suvarṇaprabhāsasūtra",
    altTitles: ["Suvarṇaprabhāsottamasūtra", "Sutra of Golden Light", "Suvarnabhasottama"],
    tradition: "buddhism",
    school: "",
    genre: "Scripture",
    textType: "Mahayana sutra in prose and verse",
    category: "Mahayana",
    subcategory: "Sūtras and śāstra",
    dateStart: 200,
    dateEnd: 400,
    dateDisplay: "c. 3rd–4th century CE",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "The Sutra of Golden Light, transmitted without an author and expanded as it was copied: in East Asia and Tibet it became a scripture of state protection and of the daily confession, while its dhāraṇī chapters were carried as amulets. GRETIL's e-text follows S. Bagchi's edition (Darbhanga 1967, Buddhist Sanskrit Texts 8) and was input by the Digital Sanskrit Buddhist Canon Input Project.",
    description:
      "The Suvarṇaprabhāsasūtra teaches that the Buddha's teaching endures in the world as a golden light that shines over the realm of the king who protects it: its chapters praise the sutra itself and promise the protection of the four great kings, the goddess Sarasvatī, the nāga kings and the earth goddesses to those who keep it; they set out the confession of sins and the conduct of a Bodhisattva, the story of the earth goddess Dṛḍhā and of the prince Jalavāhāna who gives his body for the sake of a hungry tigress, the healing of the sick by the Bodhisattva Sarvasattvapriyadarśana, and the great assembly of the Buddhas in the closing chapter.",
    historicalContext:
      "The sutra was translated into Chinese in the fifth century and was recited in Japan as the Golden Light Sutra whose protection the state invoked against famine and rebellion; its Tibetan translation and the verses of its closing chapter are among the best known of all Buddhist texts.",
    availabilityNote:
      "Complete as GRETIL publishes it: all fifteen chapters with their prose and verse, 546 passages, streamed from GRETIL at read time, one chapter at a time. The file prints its title and the first chapter's heading above the opening, and the reader drops them from the text. This is the original Sanskrit, not a translation.",
    refScheme: "parivarta.verse",
    componentLabels: ["Parivarta {v}"],
    unitDepth: 2,
    skipLeadLines: 3,
    editionTitle: "Suvarṇaprabhāsasūtra, Bagchi edition (GRETIL e-text)",
    functions: ["canonical_scripture", "prayer_liturgy"],
  },
  {
    slug: "lankavatara-sutra",
    stem: "sa_saddharmalaGkAvatArasUtra",
    abbrev: "lank",
    title: "The Lankavatara Sutra — the Sanskrit text",
    originalTitle: "सद्धर्मलङ्कावतारसूत्र",
    transliteration: "Saddharmalaṅkāvatārasūtra",
    altTitles: ["Laṅkāvatārasūtra", "Lankavatara Sutra"],
    tradition: "buddhism",
    school: "",
    genre: "Scripture",
    textType: "Mahayana sutra in prose and verse",
    category: "Mahayana",
    subcategory: "Sūtras and śāstra",
    dateStart: 300,
    dateEnd: 450,
    dateDisplay: "c. 4th century CE",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "A Mahayana sutra transmitted without an author, studied above all in the Yogācāra schools: the Buddha is asked at Laṅkā by the lord of the yakṣas for the teaching he keeps at heart. GRETIL's e-text follows P. L. Vaidya's edition (Darbhanga 1963, Buddhist Sanskrit Texts 3) and was input by the Digital Sanskrit Buddhist Canon Input Project.",
    description:
      "The Laṅkāvatāra is the sutra of the mind and of what it constructs: that the world of objects is nothing but the storehouse consciousness and the discriminating mind, that the tathāgatagarbha is present in every being, that the doctrines of the śrāvakas, the other philosophical schools and the mistaken teachers are answered by the teaching of no-self and of the emptiness of what is dependently arisen, and, in its chapter on meat eating, that the Bodhisattva out of compassion eats no flesh. Its verses on the pure mind, the stages of the Bodhisattva and the entrance into the wisdom of the Buddha run through the traditions of Chan, Zen and the Tibetans.",
    historicalContext:
      "Compiled over several centuries and translated into Chinese and Tibetan, the sutra became the scripture of Bodhidharma's line and the object of a long commentarial tradition in East Asia; the Sanskrit text survives in the Nepalese manuscripts Vaidya edited.",
    availabilityNote:
      "Complete as GRETIL publishes it: all nine chapters with their prose and verse, 1,313 passages, streamed from GRETIL at read time, one chapter at a time. The file prints its own title and the first chapter's heading above the text, and the reader drops them. This is the original Sanskrit, not a translation.",
    refScheme: "parivarta.verse",
    componentLabels: ["Parivarta {v}"],
    unitDepth: 2,
    skipLeadLines: 4,
    editionTitle: "Saddharmalaṅkāvatārasūtra, Vaidya edition (GRETIL e-text)",
    functions: ["canonical_scripture", "philosophical_work"],
  },
  {
    slug: "udanavarga",
    stem: "sa_udAnavarga",
    abbrev: "Uv",
    title: "The Udanavarga — the Sanskrit Dharmapada",
    originalTitle: "उदानवर्ग",
    transliteration: "Udānavarga",
    altTitles: ["Udanavarga", "Dharmapada in Sanskrit", "Udanavarga of the Sarvastivadins"],
    tradition: "buddhism",
    school: "",
    genre: "Scripture",
    textType: "Buddhist verse anthology",
    category: "Scripture",
    subcategory: "Verse anthology",
    dateStart: 200,
    dateEnd: 400,
    dateDisplay: "c. 2nd–4th century CE",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "The Sanskrit counterpart of the Pali Dhammapada, kept by the Sarvāstivāda and Mūlasarvāstivāda schools; transmitted without an author as the Buddha's own verses collected under subject headings. GRETIL's e-text follows Franz Bernhard's edition (Göttingen 1965), which is based on the Central Asian manuscripts, and was input by Muneo Tokunaga.",
    description:
      "The Udānavarga gathers the Buddha's awakening verses under thirty-three headings: impermanence, desire, anger, heedlessness, the wise and the fool, the sage, the awakened, suffering, the ending of craving, and the last section on the way to the deathless. Its verses are the close kin of those the Theravada schools chant — the pairs of the first chapter, the unfolding of the wise man's teaching, the elephant that bears the arrow, the wish-fulfilling jewel of the mind well-trained — here in the wording the Sanskrit schools transmitted and cited in their abhidharma literature.",
    historicalContext:
      "The manuscripts of the Udānavarga recovered from Central Asia and the Gilgit region showed nineteenth and twentieth century scholars that the Dhammapada was not one book but a textual family, and Bernhard's edition is the standard critical text of its Sanskrit branch.",
    availabilityNote:
      "Complete as GRETIL publishes it: all thirty-three vargas and their 944 verses, streamed from GRETIL at read time. Each passage is one verse, addressed as varga.verse. The e-text follows Bernhard's printed presentation, which separates the words of a verse with dots; the reader trims the e-text's own apparatus from the ends of a passage but keeps the edition's word separation. This is the original Sanskrit, not a translation.",
    refScheme: "varga.verse",
    componentLabels: ["Varga {v}"],
    unitDepth: 2,
    trimDecorations: true,
    editionTitle: "Udānavarga, Bernhard edition (GRETIL e-text)",
    functions: ["canonical_scripture", "mystical_contemplative"],
  },
  {
    slug: "jataka-mala",
    stem: "sa_AryazUra-jAtakamAlA",
    abbrev: "jm",
    title: "Aryasura's Garland of Birth Stories — the Sanskrit text",
    originalTitle: "जातकमाला",
    transliteration: "Jātakamālā",
    altTitles: ["Jatakamala", "Garland of the Buddha's Birth Stories", "Bodhisattvavadanamala"],
    tradition: "buddhism",
    school: "",
    genre: "Scripture",
    textType: "Buddhist narrative poetry in prose and verse",
    category: "Jataka",
    subcategory: "Jātakamālā",
    dateStart: 300,
    dateEnd: 400,
    dateDisplay: "c. 4th century CE",
    authorshipStatus: "traditional",
    author: "aryasura",
    attributionNote:
      "Ascribed to the poet Āryaśūra, in the tradition a Buddhist monk of the fourth century; the work retells the former births of the Buddha as a polished kāvya, and its thirty-four stories are quoted in the Sanskrit anthologies as models of the style. GRETIL's e-text follows P. L. Vaidya's edition (Darbhanga 1959, Buddhist Sanskrit Texts 21) and was input by the Digital Sanskrit Buddhist Canon Input Project.",
    description:
      "The Jātakamālā tells the Bodhisattva's former lives as a series of offerings: the elephant that gives its tusks and then breaks them off, the quail that stops a forest fire, the monkey king who makes itself a bridge across the Ganges, the king Śibi who gives his eyes and then his flesh, the prince who throws himself from a cliff, the starving tigress fed with a prince's body, the sage who gives his own body for a stag — each story in prose framed by verse, and each ending with the vow that carries the Bodhisattva toward awakening. It is both scripture of the perfections and one of the finest narrative poems in Sanskrit.",
    historicalContext:
      "Āryaśūra's work was translated into Chinese, Tibetan and later into European languages, and its stories travelled into the Buddhist art and the literature of Asia; Haribhaṭṭa, Gopadatta and Kṣemendra later imitated it, and the library holds the Pali Jātaka collection whose stories it retells in classical Sanskrit.",
    availabilityNote:
      "Complete as GRETIL publishes it: all thirty-four jātakas in prose and verse, 1,432 passages, streamed from GRETIL at read time, one story at a time. The file prints its own title and homage above the opening verses, and the reader drops them from the text. This is the original Sanskrit, not a translation.",
    refScheme: "jataka.verse",
    componentLabels: ["Jātaka {v}"],
    unitDepth: 2,
    skipLeadLines: 2,
    editionTitle: "Jātakamālā, Vaidya edition (GRETIL e-text)",
    functions: ["non_canonical_religious_text", "mystical_contemplative"],
  },
  {
    slug: "mahavastu",
    stem: "sa_mahAvastu-avAdana",
    abbrev: "mvu",
    title: "The Mahavastu — the Sanskrit text",
    originalTitle: "महावस्तु",
    transliteration: "Mahāvastu-avādana",
    altTitles: ["Mahāvastu", "Mahavastu Avadana", "Great Story of the Vinaya"],
    tradition: "buddhism",
    school: "",
    genre: "Vinaya",
    textType: "Monastic narrative in prose and verse",
    category: "Vinaya",
    subcategory: "Mahāvastu",
    dateStart: -200,
    dateEnd: 200,
    dateDisplay: "c. 2nd century BCE–2nd century CE",
    authorshipStatus: "composite",
    author: "",
    attributionNote:
      "The Mahāvastu-avādana of the Mahāsāṃghika-Lokottaravāda school, transmitted without an author as part of that school's discipline: its Sanskrit is a mixed dialect, older in its verses and modernised in the prose that frames them. GRETIL's e-text follows Émile Senart's edition in three volumes (Paris 1882–1897) and was input by Emmanuel Fauré.",
    description:
      "The Mahāvastu is the great story of the Buddha's career as the Mahāsāṃghikas told it: previous Buddhas and the vow that sets the Bodhisattva on the way, his lives in the heavens and the descent into the world, the birth and the naming of Gotama, the palaces, the four encounters, the departure and the six years of effort, the awakening, and the first conversions, with the lives of the first disciples told around them. Its chapters on the ten stages of the Bodhisattva and on the pomp of the birth are among the earliest Mahayana material to survive in the original, and its narrative is the richest of the older biographies.",
    historicalContext:
      "The work's school disappeared, but its text was preserved in the manuscripts found in Nepal; Senart's edition made it the principal witness to the Sanskrit of the Mahāsāṃghika canon, and it is read today beside the Pali Mahāvagga and the Lalitavistara for what the schools of early Buddhism shared and where they parted.",
    availabilityNote:
      "Complete as GRETIL publishes it: the whole work in Senart's three volumes, 1,324 sections, streamed from GRETIL at read time, one volume at a time. The file marks each volume above its text and wraps each reference in underscores; the reader drops the apparatus and keeps the section. This is the original Sanskrit, not a translation.",
    refScheme: "volume.section",
    componentLabels: ["Volume {v}"],
    unitDepth: 2,
    trimDecorations: true,
    editionTitle: "Mahāvastu-avādana, Senart edition (GRETIL e-text)",
    functions: ["canonical_scripture", "non_canonical_religious_text"],
  },
  // -------------------------------------------------------------------------
  // The philosophical schools
  // -------------------------------------------------------------------------
  {
    slug: "madhyamakakarika",
    stem: "sa_nAgArjuna-mUlamadhyamakakArikA",
    abbrev: "mmk",
    title: "Nagarjuna's Verses on the Middle Way",
    originalTitle: "मूलमध्यमककारिका",
    transliteration: "Mūlamadhyamakakārikā",
    altTitles: ["Madhyamakakārikā", "Mūlamadhyamakakārikā", "Fundamental Verses on the Middle Way"],
    tradition: "buddhism",
    school: "",
    genre: "Philosophy",
    textType: "Philosophical verses with a commentary",
    category: "Mahayana",
    subcategory: "Madhyamaka",
    dateStart: 150,
    dateEnd: 250,
    dateDisplay: "c. 2nd–3rd century CE",
    authorshipStatus: "traditional",
    author: "nagarjuna",
    attributionNote:
      "Ascribed to Nāgārjuna, the philosopher of the Madhyamaka school and, in the Tibetan tradition, the founder of its lineage; the verses are the root text of the school and were commented on by Buddhapālita, Bhāviveka and Candrakīrti. GRETIL's e-text was input by the Digital Sanskrit Buddhist Canon Input Project.",
    description:
      "The Mūlamadhyamakakārikā examines what it is for anything to exist: causation and the four conditions, motion and rest, the senses and their objects, the arising and enduring of what is conditioned, agents and actions, fire and fuel, the self, the twelvefold chain of dependent arising, the tathāgata and the noble truths, and finally nirvana, which Nāgārjuna shows cannot be either an existing thing or a different one. Its twenty-seven chapters work by refutation rather than by proof, and its verses on emptiness as dependent arising became the standard of Buddhist philosophy in Tibet and East Asia.",
    historicalContext:
      "Nāgārjuna's verses reorganised the Buddha's teaching on dependent arising into a systematic critique of the schools of his own day; with the commentaries they founded the Madhyamaka and the whole Tibetan curriculum of Buddhist philosophy, and they are read in the West as one of the sharpest works of ancient dialectic.",
    availabilityNote:
      "Complete as GRETIL publishes it: the root verses of all twenty-seven chapters, 448 passages, streamed from GRETIL at read time, one chapter at a time. This is the original Sanskrit of the root text; the commentaries are not part of this file.",
    refScheme: "chapter.verse",
    componentLabels: ["Chapter {v}"],
    unitDepth: 2,
    editionTitle: "Mūlamadhyamakakārikā (GRETIL e-text)",
    functions: ["philosophical_work", "canonical_scripture"],
  },
  {
    slug: "bodhicaryavatara-sanskrit",
    stem: "sa_zAntideva-bodhicaryAvatAra",
    abbrev: "Bca",
    title: "Shantideva's Way of the Bodhisattva — the Sanskrit text",
    originalTitle: "बोधिचर्यावतार",
    transliteration: "Bodhicaryāvatāra",
    altTitles: ["Bodhicaryāvatāra", "Bodhicharyavatara", "Entering the Path of Enlightenment"],
    tradition: "buddhism",
    school: "",
    genre: "Philosophy",
    textType: "Devotional and philosophical verses",
    category: "Mahayana",
    subcategory: "Bodhicaryāvatāra",
    dateStart: 700,
    dateEnd: 800,
    dateDisplay: "c. 8th century CE",
    authorshipStatus: "traditional",
    author: "shantideva",
    attributionNote:
      "Śāntideva, monk of Nālandā, is named in the tradition as the author of the verses and of the Śikṣāsamuccaya; the work was commented on by Prajñākaramati, whose Pañjikā GRETIL publishes separately, and it is one of the few Indian Buddhist poems still recited daily in Tibetan monasteries. GRETIL's e-text was input by the Digital Sanskrit Buddhist Canon Input Project.",
    description:
      "The Bodhicaryāvatāra is the manual of the Bodhisattva's course in ten chapters: the praise of the awakened mind and the confession of faults, the keeping of awareness, the guarding of the mind and of the doors of the senses, the perfection of patience, the making of effort, the perfection of meditation and the exchange of self and other, the perfection of wisdom with its analysis of the two truths and of the emptiness of all things, and finally the dedication of the merit of the poem to all beings. It is the most widely loved of all Buddhist philosophical poems, recited as prayer as much as read as argument.",
    historicalContext:
      "Written at Nālandā and carried to Tibet within a few centuries, where it became the central text of the Bodhisattva training, the work was translated into Tibetan by Sarvajñādeva and Dharmākaraśrī with the help of its Sanskrit commentaries; its Sanskrit text survived in the Nepalese manuscripts and was published in the nineteenth century. The library holds L. D. Barnett's English rendering of 1909 as The Path of Light.",
    availabilityNote:
      "Complete as GRETIL publishes it: the ten chapters and their 913 verses, streamed from GRETIL at read time, one chapter at a time. The file prints the chapter number and the opening homage above each chapter's verses, and the reader drops them. This is the original Sanskrit, not a translation.",
    refScheme: "chapter.verse",
    componentLabels: ["Chapter {v}"],
    unitDepth: 2,
    skipLeadLines: 2,
    editionTitle: "Bodhicaryāvatāra (GRETIL e-text)",
    functions: ["philosophical_work", "mystical_contemplative"],
  },
  {
    slug: "abhidharmakosha",
    stem: "sa_vasubandhu-abhidharmakoza",
    abbrev: "vakk",
    title: "Vasubandhu's Treasury of Abhidharma — the Sanskrit text",
    originalTitle: "अभिधर्मकोशभाष्य",
    transliteration: "Abhidharmakośabhāṣya",
    altTitles: ["Abhidharmakośa", "Treasury of Abhidharma", "Kośa"],
    tradition: "buddhism",
    school: "",
    genre: "Philosophy",
    textType: "Verses with an auto-commentary in prose",
    category: "Philosophy",
    subcategory: "Abhidharma",
    dateStart: 350,
    dateEnd: 450,
    dateDisplay: "c. 4th–5th century CE",
    authorshipStatus: "traditional",
    author: "vasubandhu",
    attributionNote:
      "Ascribed to Vasubandhu, the great abhidharma master who turned afterwards to the Yogācāra; the root verses are his own and the prose that follows them is his commentary on them, in which he reports the views of the Vaibhāṣika school and answers them from the Sautrāntika position. The e-text follows the edition of P. Pradhan (Patna 1975, Tibetan Sanskrit Works Series 8) and its source is recorded by GRETIL as unknown; it was input by the Digital Sanskrit Buddhist Canon Input Project.",
    description:
      "The Abhidharmakośa is the great summa of Buddhist scholasticism: its eight kośas treat the elements of experience and the faculties, the functioning of the mind and the mental states, the structure of the world and its beings, the karma that produces the world, the latencies that bind beings to it, the paths and the persons who walk them, the knowledges won on the way, and the meditative attainments that end in the destruction of the defilements. Each verse is followed by the prose of the author, so the reader has both the mnemonic and the argument on one page.",
    historicalContext:
      "Vasubandhu's Treasury reorganised the Sarvāstivāda teaching and became the standard abhidharma of the Sanskrit, Chinese and Tibetan schools; its Chinese translation by Xuanzang and its Tibetan translation made it the foundation of the monastic curriculum, and it remains the clearest account of what Buddhist scholasticism held the world to be.",
    availabilityNote:
      "Complete as GRETIL publishes it: all eight kośasthānas with Vasubandhu's own commentary on each verse, 598 passages, streamed from GRETIL at read time, one kośasthāna at a time. The file prints the work's title, the name of the first kośasthāna and its homage above the opening verses, and the reader drops them. This is the original Sanskrit, not a translation.",
    refScheme: "kosasthana.verse",
    componentLabels: ["Kośasthāna {v}"],
    unitDepth: 2,
    skipLeadLines: 3,
    editionTitle: "Abhidharmakośabhāṣya (GRETIL e-text)",
    functions: ["philosophical_work", "commentary_exegesis"],
  },
  {
    slug: "spandakarika",
    stem: "sa_vasugupta-spandakArikA",
    abbrev: "",
    title: "The Spandakarika",
    originalTitle: "स्पन्दकारिका",
    transliteration: "Spandakārikā",
    altTitles: ["Spanda Kārikā", "The Stanzas on Vibration"],
    school: "shaivism",
    // The file numbers its verses afresh in each of the poem's four sections,
    // so the reader keeps reading order and distinguishes a repeated number.
    genre: "Philosophy",
    textType: "Philosophical and devotional verses",
    category: "Tantra",
    subcategory: "Kashmir Shaiva tantra",
    dateStart: 800,
    dateEnd: 900,
    dateDisplay: "c. 9th century CE",
    authorshipStatus: "traditional",
    author: "vasugupta",
    attributionNote:
      "Ascribed to Vasugupta, who is said in the tradition to have found the Shiva Sutras on the rock at Mahādeva near Srinagar; the verses of the Spanda tradition were arranged and commented on by his followers, and Kṣemarāja wrote the longer commentary the library holds beside other works of the school. GRETIL's e-text carries the verses alone, in the file's own numbering.",
    description:
      "The Spandakārikā is the poem of the school of recognition: that the universe is the vibration of a single consciousness, that this vibration is present in every act of perception and in every breath, and that the yogi who recognises it in the moment of a desire, a fear or a wonder sees the whole world as Shiva's own play. Its fifty-three verses, in four sections of the outpouring, the arising, the descent into the individual and the recognition of one's own nature, are among the most quoted stanzas of Kashmiri Shaivism.",
    historicalContext:
      "The Spanda tradition took shape in Kashmir in the ninth century around the work of Vasugupta's line, and Kṣemarāja's commentary made its verses a classical statement of the school beside the Śivasūtra and the Tantrāloka; Sri Aurobindo's later translations brought the text into modern Indian philosophy.",
    availabilityNote:
      "Complete as GRETIL publishes it: the fifty-three verses of the whole poem, streamed from GRETIL at read time and indexed in reading order. The file prints no reference abbreviation beside its verses, so the reader follows the number the edition prints at the end of each verse, and the file's own opening heading is not indexed. Because the edition numbers the verses afresh in each of the four sections, a number that occurs again is kept distinct in the index and the reading order decides. This is the original Sanskrit, not a translation.",
    refScheme: "verse",
    componentLabels: [],
    singleChapterLabel: "Verses",
    refPattern: "[|/]{2}\\s*(\\d+)\\s*[|/]{2}",
    unitDepth: 1,
    skipLeadLines: 1,
    editionTitle: "Spandakārikā (GRETIL e-text)",
    functions: ["philosophical_work", "mystical_contemplative"],
  },
  {
    slug: "vijnana-bhairava-tantra",
    stem: "sa_vijJAnabhairava",
    abbrev: "",
    title: "The Vijnana Bhairava Tantra",
    originalTitle: "विज्ञानभैरव",
    transliteration: "Vijñānabhairava",
    altTitles: ["Vijñānabhairava Tantra", "The Doctrine of the Recognition of Bhairava"],
    school: "shaivism",
    genre: "Tantra",
    textType: "Dialogue of the goddess and Bhairava in verse",
    category: "Tantra",
    subcategory: "Kashmir Shaiva tantra",
    dateStart: 800,
    dateEnd: 1000,
    dateDisplay: "c. 9th–10th century CE",
    authorshipStatus: "anonymous",
    author: "",
    attributionNote:
      "A tantra of the Bhairava revelation transmitted without an author, presented as the goddess's question and Bhairava's answer: the practices it teaches belong to the same Kashmiri tradition of recognition as the Spandakārikā and the Śivasūtra, and its later commentaries, the Kaumadī of Ananda Bhaṭṭa and the editions of the Kashmir series, made it the most widely used manual of its school.",
    description:
      "The Vijñānabhairava answers the goddess's question of what Bhairava's own nature is with 162 contemplations: to attend to the gap between two breaths, to the space between two thoughts, to the moment of extreme fear or delight, to the experience of hunger and satisfaction, to the sound of a lute and the sound of the wind, to the boundary between waking and sleep, to the whole body as one consciousness, and to the light that is perceived even when the eyes are closed. It is the great collection of the means by which the Shaiva yogi recognises the absolute in the ordinary, and the text from which the later Indian and modern manuals of contemplation drew most.",
    historicalContext:
      "The tantra circulated in Kashmir and in the Deccan and was recomposed in such famous modern works as the Radiance Sutras; its verses are taught today in the lineages of Kashmir Shaivism and read in the West as one of the most practical texts of Indian mysticism.",
    availabilityNote:
      "Complete as GRETIL publishes it: the whole dialogue of 162 verses, streamed from GRETIL at read time and indexed in reading order. The file prints no reference abbreviation beside its verses, so the reader follows the number the edition prints at the end of each verse; the goddess's opening question is part of the first verse. This is the original Sanskrit, not a translation.",
    refScheme: "verse",
    componentLabels: [],
    singleChapterLabel: "Verses",
    refPattern: "[|/]{2}\\s*(\\d+)\\s*[|/]{2}",
    unitDepth: 1,
    editionTitle: "Vijñānabhairava (GRETIL e-text)",
    functions: ["canonical_scripture", "mystical_contemplative"],
  },
  {
    slug: "vivekachudamani",
    stem: "sa_zaMkara-vivekacuDAmaNi",
    abbrev: "",
    title: "The Crest Jewel of Discrimination",
    originalTitle: "विवेकचूडामणि",
    transliteration: "Vivekacūḍāmaṇi",
    altTitles: ["Vivekachudamani", "The Crest-Jewel of Wisdom"],
    school: "vedanta",
    genre: "Philosophy",
    textType: "Philosophical verses",
    category: "Vedanta",
    subcategory: "Vedanta treatises",
    dateStart: 700,
    dateEnd: 800,
    dateDisplay: "c. 8th century CE (attributed to Shankara; date unsettled)",
    authorshipStatus: "traditional",
    author: "shankara",
    attributionNote:
      "Attributed to Śaṅkara, the commentator of the Upanishads and founder of the Advaita school; modern scholarship doubts the attribution, since the poem's metre and teaching look later than his commentaries, but the tradition of the Advaita order has transmitted it under his name and reads it as his own instruction. GRETIL publishes the verses alone in the file's numbering.",
    description:
      "The Vivekacūḍāmaṇi teaches the whole Advaita path in verse: the qualifications of the pupil and the marks of the teacher, the discrimination of the eternal from the transitory, the four means of liberation and the yearning for release, the five sheaths and the analysis of the self that is not body, breath or mind, the all-pervading consciousness witnessed in waking, dream and deep sleep, the identity of the self with Brahman, the removal of the ignorance the texts call beginningless, the renunciation that follows, and the joy of the one who knows. Its verses on the unbroken light of consciousness are the most quoted expression of Advaita in modern India.",
    historicalContext:
      "Read in the Advaita monasteries as a manual for the disciple and translated by Śrī Chandrasekharendra Sarasvatī's line and by modern teachers such as Chinmayananda and Dayananda, the poem became the classical statement of Vedantic self-enquiry for a wider public than the commentaries commanded, and the library holds Śaṅkara's Upanishad commentaries from the same school as a second voice.",
    availabilityNote:
      "Complete as GRETIL publishes it: 580 verses in the numbering the edition prints, streamed from GRETIL at read time and indexed in reading order. The file carries no reference abbreviation beside its verses and prints its own title above the opening invocation, which the library does not index as text. This is the original Sanskrit, not a translation.",
    refScheme: "verse",
    componentLabels: [],
    singleChapterLabel: "Verses",
    refPattern: "[|/]{2}\\s*(\\d+)\\s*[|/]{2}",
    unitDepth: 1,
    skipLeadLines: 1,
    editionTitle: "Vivekacūḍāmaṇi (GRETIL e-text)",
    functions: ["philosophical_work", "mystical_contemplative"],
  },
  {
    slug: "tarkasangraha",
    stem: "sa_annaMbhatta-tarkasaMgraha",
    abbrev: "AnTs",
    title: "Annambhatta's Compendium of Reasoning",
    originalTitle: "तर्कसंग्रह",
    transliteration: "Tarkasaṃgraha",
    altTitles: ["Tarkasangraha", "Compendium of Logic"],
    school: "nyaya",
    genre: "Philosophy",
    textType: "Aphorisms for students",
    category: "Darshana",
    subcategory: "Nyaya",
    dateStart: 1600,
    dateEnd: 1700,
    dateDisplay: "c. 17th century CE",
    authorshipStatus: "traditional",
    author: "annambhatta",
    attributionNote:
      "Annaṃbhaṭṭa, a South Indian author of the seventeenth century of the nyāya-vaiśeṣika school, wrote the aphorisms as an introduction for beginners and then commented on them himself in the Dīpikā; the two are printed together in most editions and the work became the standard first reader of the school. GRETIL's e-text carries the aphorisms, in the numbering of the edition.",
    description:
      "The Tarkasaṃgraha sets out the seven categories of the nyāya-vaiśeṣika school — substance, quality, action, the universal, the particular, inherence and absence — with their divisions, and then the four means of knowledge: perception, inference with its members and its fallacies, comparison and verbal testimony, and the objects of knowledge, the self, the body, the senses, and the erroneous knowledge that binds. Its aphorisms are short enough to be learned by heart and exact enough to be argued over, and they are still the first text put into the hands of a student of Indian logic.",
    historicalContext:
      "Written for the schools of Andhra and the Tamil country and carried through the Indian college curricula of the nineteenth and twentieth centuries, the Tarkasaṃgraha is the work through which Indian logic and epistemology were taught in modern India, and its categories were the terms in which the tradition explained itself to the new universities.",
    availabilityNote:
      "Complete as GRETIL publishes it: the whole compendium of 81 aphorisms, streamed from GRETIL at read time and indexed in reading order, since the work has no chapter division of its own. The library indexes each aphorism by the number the edition prints. This is the original Sanskrit, not a translation.",
    refScheme: "aphorism",
    componentLabels: [],
    singleChapterLabel: "Aphorisms",
    refPattern: "AnTs_(\\d+)",
    unitDepth: 1,
    editionTitle: "Tarkasaṃgraha (GRETIL e-text)",
    functions: ["philosophical_work", "academic_scholarship"],
  },
  // -------------------------------------------------------------------------
  // The classical poetry of Kalidasa
  // -------------------------------------------------------------------------
  {
    slug: "raghuvamsha",
    stem: "sa_kAlidAsa-raghuvaMza",
    abbrev: "Ragh",
    title: "Kalidasa's Dynasty of Raghu — the Sanskrit text",
    originalTitle: "रघुवंश",
    transliteration: "Raghuvaṃśa",
    altTitles: ["Raghuvamśa", "Raghuvamsa", "The Lineage of Raghu"],
    school: "",
    genre: "Poetry",
    textType: "Court epic in verse (mahākāvya)",
    category: "Poetry",
    subcategory: "Sanskrit kavya",
    dateStart: 350,
    dateEnd: 450,
    dateDisplay: "c. 4th–5th century CE",
    authorshipStatus: "traditional",
    author: "kalidasa",
    attributionNote:
      "The mahākāvya of Kālidāsa, the greatest of the Sanskrit poets, who is placed in the fourth or fifth century and connected with the court of the Guptas; the poem follows the kings of the solar dynasty from Dilipa to Agnivarṇa and was commented on by Mallinātha, whose commentary fixed its place in the schools. GRETIL's e-text follows the vocabulary of the Kalidasa Lexicon of A. Scharpé (Brugge 1964).",
    description:
      "The Raghuvaṃśa tells the solar dynasty in nineteen sargas: Dilipa and the cow of fortune, Raghu's conquest of the world and his sacrifice, Aja and the theft of Indumatī at her own marriage, Dasharatha and the birth of the four brothers, Rama's youth, Sita's abduction, the war with Lanka and the return to Ayodhya, and then the later kings down to Agnivarṇa's corruption — the book in which Kālidāsa answers the epic by telling its family as a poem, and the model of the mahākāvya for a thousand years of Sanskrit court poetry.",
    historicalContext:
      "Composed in the golden age of the Gupta court, the poem's verses on the seasons, on love in separation and on the duty of the king were imitated by Bhavabhūti, Rājaśekhara and the whole later tradition; it is the work through which the classical Sanskrit poem was defined, and its ninth sarga on the hunt was a school text for a millennium.",
    availabilityNote:
      "Complete as GRETIL publishes it: all nineteen sargas and 1,637 verses, streamed from GRETIL at read time, one sarga at a time. This is the original Sanskrit, not a translation.",
    refScheme: "sarga.verse",
    componentLabels: ["Sarga {v}"],
    unitDepth: 2,
    editionTitle: "Raghuvaṃśa (GRETIL e-text)",
    functions: ["non_canonical_religious_text", "mystical_contemplative"],
  },
  {
    slug: "kumarasambhava",
    stem: "sa_kAlidAsa-kumArasaMbhava",
    abbrev: "Ks",
    title: "Kalidasa's Birth of Kumara — the Sanskrit text",
    originalTitle: "कुमारसम्भव",
    transliteration: "Kumārasaṃbhava",
    altTitles: ["Kumarasambhava", "The Birth of the War God"],
    school: "shaivism",
    genre: "Poetry",
    textType: "Court epic in verse (mahākāvya)",
    category: "Poetry",
    subcategory: "Sanskrit kavya",
    dateStart: 350,
    dateEnd: 450,
    dateDisplay: "c. 4th–5th century CE",
    authorshipStatus: "traditional",
    author: "kalidasa",
    attributionNote:
      "The mahākāvya of Kālidāsa on the marriage of Shiva and Pārvatī and the birth of their son, and one of the two poems of his the tradition counted as its models; the eighth sarga was famous enough to be quoted as a test of style. The text as GRETIL publishes it has eight sargas.",
    description:
      "The Kumārasaṃbhava tells how the Himalaya's daughter was born and grew, how the god of love was burnt when he aimed his arrow at Shiva's meditation, how Pārvatī won the great ascetic by her own penance and was married with the gods as guests, and how Kumāra, the war god who defeats the demon Tāraka, was conceived and born in the reeds of the Ganges. Its descriptions of the Himalaya, of the spring, of the burning of Kāma and of the wedding are the finest nature and love poetry in Sanskrit, and it ends with the child of the destroying god as the protector of the world.",
    historicalContext:
      "The poem shaped the Shaiva devotional sensibility of the classical and medieval periods — the bridal mysticism of later Indian literature begins in it — and it was translated and imitated from Java to Kashmir; a substantial Tamil, Kannada and Marathi tradition of retelling it attests its popularity beyond Sanskrit.",
    availabilityNote:
      "Partial as GRETIL publishes it: the eight sargas it gives, 613 verses, streamed from GRETIL at read time, one sarga at a time. Later sargas have been doubted or assigned to other hands and are not part of this transcription, and the work is not claimed as complete. This is the original Sanskrit, not a translation.",
    refScheme: "sarga.verse",
    componentLabels: ["Sarga {v}"],
    unitDepth: 2,
    editionTitle: "Kumārasaṃbhava (GRETIL e-text)",
    functions: ["non_canonical_religious_text", "mystical_contemplative"],
  },
  {
    slug: "meghaduta",
    stem: "sa_kAlidAsa-meghadUta",
    abbrev: "KMgD",
    title: "Kalidasa's Cloud Messenger — the Sanskrit text",
    originalTitle: "मेघदूत",
    transliteration: "Meghadūta",
    altTitles: ["Meghaduta", "The Cloud Messenger", "Meghasandeśa"],
    school: "shaivism",
    genre: "Poetry",
    textType: "Messenger poem in verse",
    category: "Poetry",
    subcategory: "Sanskrit kavya",
    dateStart: 350,
    dateEnd: 450,
    dateDisplay: "c. 4th–5th century CE",
    authorshipStatus: "traditional",
    author: "kalidasa",
    attributionNote:
      "The messenger poem of Kālidāsa: a yakṣa banished from his home for a year asks a monsoon cloud to carry his message to his wife in the Himalayas, and the poem's 111 verses are the description of the route the cloud must take. GRETIL's e-text has the 111 verses of the standard recension and was input by the Digital Sanskrit Buddhist Canon Input Project.",
    description:
      "The Meghadūta is one of the most famous poems in any Indian language: the exiled yakṣa on Mount Rāma first describes the cloud, then the journey it must make from the Vindhyas north over the Narmada and the Ganges plain to the Himalaya and Alakā, warning it of the cities, the mountains and the rivers it will pass, and finally gives it the message of a lover to a wife who has not slept, closing with the shared grief that makes a message a consolation. Its combination of landscape description and longing became a genre of its own — the sandeśa poems of the following centuries all derive from it.",
    historicalContext:
      "Composed under the Guptas and translated and imitated across Asia, the poem was commented on by Mallinātha and by the whole tradition of Sanskrit poetics as the exemplar of the description of nature and of unfulfilled love; its verses on the cloud as a bearer of news were recited and set to music in every Indian language.",
    availabilityNote:
      "Complete as GRETIL publishes it: the 111 verses of the standard recension, streamed from GRETIL at read time and indexed in reading order, since the poem has no chapter division of its own. This is the original Sanskrit, not a translation.",
    refScheme: "verse",
    componentLabels: [],
    singleChapterLabel: "Verses",
    unitDepth: 1,
    editionTitle: "Meghadūta (GRETIL e-text)",
    functions: ["non_canonical_religious_text", "mystical_contemplative"],
  },
  {
    slug: "abhijnanashakuntala",
    stem: "sa_kAlidAsa-abhijJAnazakuntala",
    abbrev: "KSak",
    title: "Kalidasa's Shakuntala — the Sanskrit text",
    originalTitle: "अभिज्ञानशाकुन्तलम्",
    transliteration: "Abhijñānaśākuntala",
    altTitles: ["Shakuntala", "Abhijnana Shakuntala", "The Recognition of Shakuntala"],
    school: "",
    genre: "Drama",
    textType: "Drama in verse and prose",
    category: "Drama",
    subcategory: "Sanskrit drama",
    dateStart: 350,
    dateEnd: 450,
    dateDisplay: "c. 4th–5th century CE",
    authorshipStatus: "traditional",
    author: "kalidasa",
    attributionNote:
      "The drama of Kālidāsa in seven acts, drawn from the Shakuntala episode of the Mahabharata and the story of the ring that reveals the heroine to her husband; it was the first Sanskrit work translated into a European language, by William Jones in 1789. GRETIL's e-text follows M. R. Kale's edition (Bombay 1898; ninth edition 1961).",
    description:
      "Abhijñānaśākuntala tells of Shakuntala, the daughter of the sage Vishvamitra and the nymph Menaka, who grows up in the forest hermitage of Kanva; of king Dushyanta, who meets her there, marries her in the manner of the forest and returns to his city; of the ring he has given her, lost in a river and swallowed by a fish, without which he cannot remember her; of her rejection at court and the birth of her son Bharata in the hermitage of Marichi; and of the reunion when the ring is recovered and the king recognises his wife and the child who is to be the ancestor of the epic's kings. Its seven acts turn a memory into a drama of what is lost and found, and its heroine became the model of the Indian stage.",
    historicalContext:
      "The play represents the classic form of Sanskrit drama — the nāṭaka in seven acts, with its vidūṣaka, its aerial journeys and its happy ending — and its translation by William Jones in 1789 began the European reading of Indian literature; Goethe's epigram on Shakuntala and the play's enthusiasm in Germany and Russia made it the most famous Indian literary work in the West.",
    availabilityNote:
      "Complete as GRETIL publishes it: all seven acts with their verses and prose, streamed from GRETIL at read time, one act at a time. The file marks each verse and each prose speech with the act's reference, so a chapter holds the passages in the order the edition prints them. This is the original Sanskrit, not a translation.",
    refScheme: "anka.verse",
    componentLabels: ["Aṅka {v}"],
    unitDepth: 2,
    editionTitle: "Abhijñānaśākuntalam, Kale edition (GRETIL e-text)",
    functions: ["non_canonical_religious_text", "mystical_contemplative"],
  },
];

// ---------------------------------------------------------------------------
// Reading GRETIL's plain-text transformations
// ---------------------------------------------------------------------------

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

async function fetchText(url: string, timeoutMs = 180_000): Promise<string> {
  let last: Error | null = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "text/plain", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 404) throw new Error(`${url} returned 404`);
      if (res.status === 429 || res.status >= 500) {
        last = new Error(`${url} returned ${res.status}`);
        await Bun.sleep(1000 * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      return await res.text();
    } catch (err) {
      last = err as Error;
      if (attempt < 4) await Bun.sleep(500 * attempt);
    }
  }
  throw last ?? new Error(`${url} failed`);
}

type Header = {
  versionDate: string;
  source: string;
  dataEntry: string;
  licence: string;
  structure: string;
};

/** The TEI-derived header GRETIL prints above the text of every file. */
function parseHeader(raw: string): Header {
  const before = raw.slice(0, raw.indexOf("\n# Text") >= 0 ? raw.indexOf("\n# Text") : raw.length);
  const lines = before.split(/\r?\n/);
  const value = (label: string) => {
    const at = lines.findIndex((line) => line.trimStart().startsWith(`## ${label}`));
    if (at < 0) return "";
    const inline = lines[at]!.split(":").slice(1).join(":").trim();
    const rest: string[] = [];
    for (let i = at + 1; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.trimStart().startsWith("## ")) break;
      if (line.trim()) rest.push(line.trim().replace(/^-\s*/, ""));
    }
    return [inline, ...rest].filter(Boolean).join(" ").trim();
  };
  return {
    versionDate: value("Date of this version"),
    source: value("Source"),
    dataEntry: value("Data entry"),
    licence: value("Licence"),
    structure: value("Structure of references"),
  };
}

function chapterLabelOf(spec: Spec, chapterRef: string): string {
  if (!spec.componentLabels.length) return spec.singleChapterLabel ?? "Text";
  const parts = gretilComponents(chapterRef).map((value, index) => {
    // A chapter numbered inside a named part is labelled with the part's name
    // rather than with its letter: "NarS_m1" is called Mātṛkā 1, and a reference
    // two chapters share is spelled out as a range, "NarS_v15-16" being called
    // Vyavahārapada 15–16.
    const word = spec.partLabels?.[value.slice(0, 1)];
    const named =
      word && /^[a-z]\d+(?:-\d+)?$/.test(value) ? `${word} ${value.slice(1).replace("-", "–")}` : value;
    const template = spec.componentLabels[index] ?? "{v}";
    return template.replace("{v}", named);
  });
  return parts.join(", ");
}

function unitLabelOf(chapterLabel: string, ref: string): string {
  const verse = gretilComponents(ref).pop() ?? ref;
  return `${chapterLabel} §${verse}`;
}

// A work's reference depth is recorded in the spec and in the stream
// configuration because GRETIL's files disagree about what they number: most
// mark every verse, some mark chapter headings and colophons too, and a few
// truncate a verse marker to the chapter number. Each side of the reader — the
// importer that builds the passage index and the reader that re-fetches the
// text — keeps only the references that carry the work's own number of
// components, so the index and the page stay in step.
function unitsAtDepth<T extends { ref: string }>(units: T[], depth?: number): T[] {
  if (!depth) return units;
  return units.filter((unit) => unit.ref.split(".").length === depth);
}

async function buildWork(spec: Spec): Promise<{ chapters: Chapter[]; config: Row; header: Header; units: number }> {
  const text = await fetchText(`${PLAIN_BASE}/${spec.stem}.txt`);
  const header = parseHeader(text);
  const all = parseGretilUnits(stripGretilHeader(text), spec.abbrev, spec.skipLeadLines ?? 0, {
    refPattern: spec.refPattern,
    trimDecorations: spec.trimDecorations,
  });
  const parsed = spec.dropRefPrefix ? all.filter((unit) => !unit.ref.startsWith(spec.dropRefPrefix!)) : all;
  if (spec.dropRefPrefix && parsed.length !== all.length) {
    console.log(`  dropped ${all.length - parsed.length} unit(s) numbered ${spec.dropRefPrefix}* (the file's own preface)`);
  }
  const kept = unitsAtDepth(parsed, spec.unitDepth);
  if (kept.length !== parsed.length) {
    console.log(`  dropped ${parsed.length - kept.length} marker(s) whose reference is not a passage of this work`);
  }
  if (!kept.length) {
    throw new Error(
      spec.refPattern
        ? `${spec.stem}: no reference matched ${spec.refPattern}`
        : `${spec.stem}: no ${spec.abbrev}_ references were found`,
    );
  }

  const chapters: Chapter[] = [];
  const index = new Map<string, Chapter>();
  for (const unit of kept) {
    const ref = gretilChapterRef(unit.ref);
    let chapter = index.get(ref);
    if (!chapter) {
      chapter = { ref, label: chapterLabelOf(spec, ref), segments: [], references: [] };
      index.set(ref, chapter);
      chapters.push(chapter);
    }
    chapter.segments.push(unit.text);
    chapter.references.push(unit.ref);
  }
  const labels = chapters.map((chapter) => chapter.label);
  if (new Set(labels).size !== labels.length) {
    const seen = new Map<string, number>();
    for (const chapter of chapters) {
      const count = (seen.get(chapter.label) ?? 0) + 1;
      seen.set(chapter.label, count);
      if (count > 1) chapter.label = `${chapter.label} (${count})`;
    }
  }
  return {
    chapters,
    header,
    units: kept.length,
    config: {
      textUrl: `${PLAIN_BASE}/${spec.stem}.txt`,
      sourceUrl: `${ANALYTIC_BASE}/${spec.stem}.htm`,
      indexUrl: INDEX_URL,
      abbreviation: spec.abbrev,
      skipLeadLines: spec.skipLeadLines ?? 0,
      ...(spec.unitDepth ? { unitDepth: spec.unitDepth } : {}),
      ...(spec.refPattern ? { refPattern: spec.refPattern } : {}),
      ...(spec.trimDecorations ? { trimDecorations: true } : {}),
    },
  };
}

function cachePath(slug: string) {
  return join(CACHE, `${slug}.json`);
}

function readCache(slug: string): Row | null {
  const path = cachePath(slug);
  if (!existsSync(path)) return null;
  const data = readJson(path) as Row;
  if (!Array.isArray(data.chapters) || !data.chapters.length) return null;
  return data;
}

function writeCache(data: Row) {
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(cachePath(data.slug), `${JSON.stringify(data, null, 2)}\n`);
}

function assertChapters(slug: string, chapters: Chapter[]) {
  const refs = new Set<string>();
  let chars = 0;
  for (const chapter of chapters) {
    if (refs.has(chapter.ref)) throw new Error(`${slug}: duplicate chapter reference ${chapter.ref}`);
    refs.add(chapter.ref);
    if (!chapter.segments.length) throw new Error(`${slug}: chapter ${chapter.ref} has no segments`);
    if (chapter.references.length !== chapter.segments.length) {
      throw new Error(`${slug}: chapter ${chapter.ref} has ${chapter.segments.length} segments and ${chapter.references.length} references`);
    }
    for (const segment of chapter.segments) {
      if (!segment.trim()) throw new Error(`${slug}: chapter ${chapter.ref} has an empty segment`);
      if (segment.includes("\uFFFD")) throw new Error(`${slug}: chapter ${chapter.ref} contains a replacement character`);
      chars += segment.length;
    }
  }
  if (chars < 500) throw new Error(`${slug}: imported text is implausibly short`);
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const streams = readJson(STREAMS);
const functions = readJson(FUNCTIONS);
const acquisition = existsSync(ACQUISITION) ? readJson(ACQUISITION) : { targets: [] };
const manifest: Row = existsSync(MANIFEST)
  ? readJson(MANIFEST)
  : {
      source: "gretil",
      index_url: INDEX_URL,
      retrieved_at: RETRIEVED_AT,
      note:
        "Catalogue records, passage indexes and the exact reviewed segments for the Sanskrit texts GRETIL publishes. The reader still streams each work from GRETIL; the cache is an import and search-index artifact, not a second public copy. Each e-text's own header records the scholar who input it, the edition followed and the licence.",
      works: [],
      totals: {},
    };

function recordWork(entry: Row) {
  const index = manifest.works.findIndex((work: Row) => work.slug === entry.slug);
  if (index >= 0) manifest.works[index] = entry;
  else manifest.works.push(entry);
}

function makeWork(spec: Spec, chapters: Chapter[], config: Row, header: Header) {
  const passages = chapters.flatMap((chapter) => {
    const taken = new Set<string>();
    return chapter.segments.map((_, index) => {
      // A reference GRETIL repeats for a two-part verse is kept distinct so the
      // passage index stays one row per printed unit.
      const base = chapter.references[index] ?? `${chapter.ref}.${index + 1}`;
      let reference = base;
      let repeat = 1;
      while (taken.has(reference)) reference = `${base}#${++repeat}`;
      taken.add(reference);
      return { reference, label: unitLabelOf(chapter.label, base), chapterRef: chapter.ref };
    });
  });
  const editionSlug = `${spec.slug}-sa`;
  const words = chapters.reduce(
    (sum, chapter) => sum + chapter.segments.reduce((n, text) => n + text.split(/\s+/).filter(Boolean).length, 0),
    0,
  );
  const sourceLine = header.source ? ` Source edition: ${header.source}` : "";
  const entryLine = header.dataEntry ? ` Input by ${header.dataEntry}.` : "";
  const licenceLine = header.licence.replace(/\s+/g, " ").trim();
  const editionOf = (variant?: Variant) => ({
    slug: variant ? `${spec.slug}-${variant.slug}` : editionSlug,
    language: "sa",
    editionType: "original",
    title: variant ? variant.title : spec.editionTitle,
    translator: "",
    publisher: "GRETIL, Göttingen State and University Library",
    publicationYear: header.versionDate ? Number(header.versionDate.slice(0, 4)) : null,
    source: "gretil",
    license: "cc-by-nc-sa-4.0",
    rightsStatus: "CC BY-NC-SA 4.0 as recorded in the e-text header",
    attributionText: variant
      ? `${variant.attribution} GRETIL e-text ${header.versionDate || "(undated)"}, Göttingen Register of Electronic Texts in Indian Languages. The two texts share one file on GRETIL and are indexed under their own reference markers.${sourceLine}${entryLine}`.trim()
      : `${spec.title}. GRETIL e-text ${header.versionDate || "(undated)"}, Göttingen Register of Electronic Texts in Indian Languages.${sourceLine}${entryLine}`.trim(),
    structureScheme: `reference index; each passage is one ${spec.refScheme.split(".").pop()} as GRETIL numbers it`,
    isSample: false,
    notes:
      `${licenceLine} ${header.structure ? `GRETIL describes the reference scheme as: ${header.structure}. ` : ""}` +
      "The import cache stores the exact segments that were validated. The reader re-fetches the work from GRETIL and reports when the served count no longer matches the index.",
  });
  const work = {
    slug: spec.slug,
    title: spec.title,
    originalTitle: spec.originalTitle,
    transliteration: spec.transliteration,
    altTitles: spec.altTitles,
    tradition: spec.tradition ?? "hinduism",
    school: spec.school || null,
    genre: spec.genre,
    textType: spec.textType,
    category: spec.category,
    subcategory: spec.subcategory,
    originalLanguage: "sa",
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
    editions: [editionOf(), ...(spec.variants ?? []).map((variant) => editionOf(variant))],
  };
  writeFileSync(join(WORKS, `${spec.slug}.json`), `${JSON.stringify(work, null, 2)}\n`);

  const variantAbbreviations: Record<string, { abbreviation: string }> = {};
  for (const variant of spec.variants ?? []) {
    variantAbbreviations[`${spec.slug}-${variant.slug}`] = { abbreviation: variant.abbrev };
  }
  streams.works[spec.slug] = {
    provider: "gretil",
    upstream: `GRETIL ${spec.stem}`,
    mode: "numbered",
    licence: "cc-by-nc-sa-4.0",
    config: { ...config, editions: variantAbbreviations },
    editions: [
      {
        slug: editionSlug,
        language: "sa",
        languageName: "sanskrit",
        version: spec.editionTitle,
        license: "cc-by-nc-sa-4.0",
        sourceUrl: config.sourceUrl,
      },
      ...(spec.variants ?? []).map((variant) => ({
        slug: `${spec.slug}-${variant.slug}`,
        language: "sa",
        languageName: "sanskrit",
        version: variant.title,
        license: "cc-by-nc-sa-4.0",
        sourceUrl: config.sourceUrl,
      })),
    ],
  };
  functions.works[spec.slug] = {
    functions: spec.functions,
    status: "provisional",
    assignedBy: "UWL editors (comparative taxonomy)",
    note: `${spec.title} — ${spec.category}. The Sanskrit text as GRETIL publishes it, streamed from GRETIL (${spec.stem}).`,
  };

  const target = acquisition.targets?.find((item: Row) => item.slug === spec.slug);
  if (target) {
    target.status = "imported";
    target.note = `${spec.title}: the Sanskrit text is imported as a streamed work from GRETIL (${spec.stem}).`;
  }

  const entry = {
    slug: spec.slug,
    title: spec.title,
    host: "gretil",
    stem: spec.stem,
    abbreviation: spec.abbrev,
    ...(spec.variants?.length
      ? { variants: spec.variants.map((variant) => ({ slug: variant.slug, abbreviation: variant.abbrev, title: variant.title })) }
      : {}),
    source_url: config.sourceUrl,
    licence: "cc-by-nc-sa-4.0",
    version_date: header.versionDate,
    source_edition: header.source,
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
  const first = chapters[0]!.segments[0]!;
  console.log(`    first unit reads: ${first.slice(0, 90)}${first.length > 90 ? "…" : ""}`);
  return entry;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (listOnly) {
  for (const spec of SPECS) console.log(`${spec.slug.padEnd(30)} ${spec.stem.padEnd(40)} ${spec.title}`);
  process.exit(0);
}

const selected = SPECS.filter((spec) => !only || spec.slug === only);
if (!selected.length) {
  console.error(`No GRETIL work matches ${only}.`);
  process.exit(1);
}

for (const spec of selected) {
  console.log(`\n${spec.title}`);
  const cached = force ? null : readCache(spec.slug);
  if (cached) {
    assertChapters(spec.slug, cached.chapters);
    if (dryRun) {
      console.log(`  cache holds ${cached.chapters.length} chapters`);
      continue;
    }
    makeWork(spec, cached.chapters, cached.config ?? {}, cached.header ?? {
      versionDate: "",
      source: "",
      dataEntry: "",
      licence: "",
      structure: "",
    });
    console.log(`  reused ${cached.chapters.length} cached chapters`);
    continue;
  }
  const { chapters, config, header, units } = await buildWork(spec);
  assertChapters(spec.slug, chapters);
  if (dryRun) {
    console.log(`  ${chapters.length} chapters, ${units} references`);
    continue;
  }
  writeCache({
    version: 1,
    slug: spec.slug,
    provider: "gretil",
    stem: spec.stem,
    sourceUrl: config.sourceUrl,
    generatedAt: new Date().toISOString(),
    complete: true,
    sectionsTotal: chapters.length,
    sectionsImported: chapters.length,
    header: headerOf(header),
    config,
    chapters,
  });
  makeWork(spec, chapters, config, header);
  await Bun.sleep(200);
}

manifest.totals = {
  works: manifest.works.length,
  chapters: manifest.works.reduce((n: number, work: Row) => n + (work.chapters ?? 0), 0),
  passages: manifest.works.reduce((n: number, work: Row) => n + (work.passages ?? 0), 0),
  words: manifest.works.reduce((n: number, work: Row) => n + (work.words ?? 0), 0),
};
if (!dryRun) {
  mkdirSync(join(ROOT, "data", "imports"), { recursive: true });
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(STREAMS, `${JSON.stringify(streams, null, 2)}\n`);
  writeFileSync(FUNCTIONS, `${JSON.stringify(functions, null, 2)}\n`);
  writeFileSync(ACQUISITION, `${JSON.stringify(acquisition, null, 2)}\n`);
}
console.log(
  `\nManifest: ${manifest.totals.works} works, ${manifest.totals.passages.toLocaleString()} passages, ` +
    `${manifest.totals.words.toLocaleString()} words.`,
);
