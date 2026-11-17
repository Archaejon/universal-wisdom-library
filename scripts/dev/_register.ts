// One-off generator for the Hindu acquisition register. Kept out of the runtime
// path: it reads the existing register, replaces the Hindu entries and writes it
// back with the same shape the seed pipeline expects.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const PATH = join(ROOT, "data", "registry", "acquisition.json");
const register = JSON.parse(readFileSync(PATH, "utf8"));

const GRETIL = (note: string) => ({
  source: "GRETIL",
  url: "https://gretil.sub.uni-goettingen.de/",
  note,
});
const SARIT = (note: string) => ({
  source: "SARIT",
  url: "https://sarit.indology.info/",
  note,
});
const WIKISOURCE = (url: string, note: string) => ({ source: "Wikisource", url, note });
const GUTENBERG = (id: number, note: string) => ({
  source: "Project Gutenberg",
  url: `https://www.gutenberg.org/ebooks/${id}`,
  note,
});

type Entry = {
  slug: string;
  title: string;
  original_title: string;
  transliteration: string;
  author: string;
  school: string;
  genre: string;
  category: string;
  status: "imported" | "located" | "wanted" | "rights_blocked";
  priority: number;
  languages: string[];
  source_leads: { source: string; url: string; note: string }[];
  rights_note: string;
  note: string;
};

const entries: Entry[] = [];
const add = (entry: Entry) => entries.push(entry);

const NOT_TRANSCRIBED =
  "The page is a landing page or an untranscribed scan; no running text was available to import, so nothing was claimed.";

// ---------------------------------------------------------------------------
// Imported in this pass
// ---------------------------------------------------------------------------

add({
  slug: "rigveda",
  title: "Rigveda",
  original_title: "ऋग्वेद",
  transliteration: "Ṛgveda",
  author: "",
  school: "",
  genre: "Veda",
  category: "Veda",
  status: "imported",
  priority: 1,
  languages: ["sa", "en"],
  source_leads: [
    WIKISOURCE(
      "https://en.wikisource.org/wiki/The_Hymns_of_the_Rigveda",
      "Griffith's 1896 verse translation, one page per hymn. All ten mandalas (1,028 hymns) were retrieved from the page wikitext in batches and the verses are indexed line by line.",
    ),
  ],
  rights_note:
    "Griffith's translation (1896) is public domain in the United States. Wikisource's transcription is under CC BY-SA; the translation text itself is reused as public domain with the source named.",
  note: "Imported and searchable: 10 books, 1,028 hymns, 21,005 passages. The Sanskrit original is not part of this edition; the English verse translation is.",
});

add({
  slug: "taittiriya-upanishad",
  title: "Taittiriya Upanishad",
  original_title: "तैत्तिरीयोपनिषद्",
  transliteration: "Taittirīya Upaniṣad",
  author: "",
  school: "vedanta",
  genre: "Upanishad",
  category: "Upanishad",
  status: "imported",
  priority: 1,
  languages: ["sa", "en"],
  source_leads: [
    WIKISOURCE(
      "https://en.wikisource.org/wiki/Taittiriya_Upanishad",
      "Max Müller's Sacred Books of the East translation (vol. 15, 1884), with the translator's notes.",
    ),
  ],
  rights_note: "Müller's translation (1884) is public domain in the United States.",
  note: "Imported and searchable: the three vallis in one reading view, 122 passages. Not one of the seven Upanishads that were already in the library, so no duplicate record was created.",
});

add({
  slug: "ramanuja-brahma-sutra-bhashya",
  title: "Brahma Sutra Bhashya of Ramanuja",
  original_title: "श्रीभाष्यम्",
  transliteration: "Śrībhāṣya",
  author: "ramanuja",
  school: "vedanta",
  genre: "Commentary",
  category: "Vedanta",
  status: "imported",
  priority: 2,
  languages: ["sa", "en"],
  source_leads: [
    GUTENBERG(
      7297,
      "Thibaut's translation of the Sri Bhashya (Sacred Books of the East vol. 48), four adhyayas and sixteen padas.",
    ),
  ],
  rights_note: "Thibaut's translation (1904) is public domain in the United States.",
  note: "Imported and searchable: 16 padas, 2,068 passages. Kept as a separate record from Shankara's commentary on the same sutras.",
});

add({
  slug: "tirukkural",
  title: "Tirukkural",
  original_title: "திருக்குறள்",
  transliteration: "Tirukkuṟaḷ",
  author: "tiruvalluvar",
  school: "",
  genre: "Poetry",
  category: "Ethics",
  status: "located",
  priority: 3,
  languages: ["ta", "en"],
  source_leads: [
    WIKISOURCE(
      "https://en.wikisource.org/wiki/Tirukural",
      "The 1886 English verse translation (Pope, with Drew, Lazarus and Ellis). Only 66 of the 133 chapter pages exist, and their numbering does not match their content.",
    ),
  ],
  rights_note: "The 1886 translation is public domain in the United States.",
  note:
    "Located, not imported. A trial import was made and then withdrawn: only 66 of the 133 chapters are transcribed, and the page titles disagree with the verses they hold — the page named 'Chapter 60' contains kurals 631–640 and 'Chapter 64' contains 1301–1330. Importing them under the page titles would have mislabelled hundreds of couplets, so the work stays a target until a consistently numbered transcription or the Tamil original is available.",
});

add({
  slug: "mahabharata",
  title: "Mahabharata",
  original_title: "महाभारतम्",
  transliteration: "Mahābhārata",
  author: "vyasa",
  school: "",
  genre: "Epic poetry",
  category: "Epic",
  status: "imported",
  priority: 1,
  languages: ["sa", "en"],
  source_leads: [
    GUTENBERG(
      15474,
      "Ganguli's complete prose translation, four volumes; all eighteen books and the 1,892 printed section headings imported. The four Gutenberg volumes divide the epic as Books 1–3, 4–7, 8–12 and 13–18, not where the printed set does.",
    ),
  ],
  rights_note: "Ganguli's translation (1883–1896) is public domain in the United States.",
  note: "Imported and searchable: 18 books, 1,892 sections, 11,700 passages. Books 8–11 and 16–18 carry no SECTION headings in this transcription and are one continuous chapter each. The Bhagavad Gita passages are cross-linked to Book 6, sections 25–42, where Ganguli prints them.",
});

add({
  slug: "harivamsha",
  title: "Harivamsha",
  original_title: "हरिवंश",
  transliteration: "Harivaṃśa",
  author: "vyasa",
  school: "vaishnavism",
  genre: "Epic poetry",
  category: "Epic",
  status: "imported",
  priority: 2,
  languages: ["sa", "en"],
  source_leads: [GUTENBERG(61937, "Dutt's prose translation, 137 chapters imported in full.")],
  rights_note: "Dutt's translation (1897) is public domain in the United States.",
  note: "Imported and searchable: 137 chapters, 1,674 passages.",
});

add({
  slug: "vishnu-purana",
  title: "Vishnu Purana",
  original_title: "विष्णुपुराण",
  transliteration: "Viṣṇu Purāṇa",
  author: "vyasa",
  school: "vaishnavism",
  genre: "Purana",
  category: "Purana",
  status: "imported",
  priority: 1,
  languages: ["sa", "en"],
  source_leads: [GUTENBERG(66208, "Dutt's prose translation, six parts and 126 sections imported in full.")],
  rights_note: "Dutt's translation (1894–96) is public domain in the United States.",
  note: "Imported and searchable. One of the twelve requested Puranas; the other eleven have no verified running text yet.",
});

add({
  slug: "taittiriya-samhita",
  title: "Yajurveda — Taittiriya Samhita",
  original_title: "यजुर्वेदः — तैत्तिरीयसंहिता",
  transliteration: "Yajurveda — Taittirīya Saṃhitā",
  author: "",
  school: "",
  genre: "Veda",
  category: "Veda",
  status: "imported",
  priority: 1,
  languages: ["sa", "en"],
  source_leads: [
    WIKISOURCE(
      "https://en.wikisource.org/wiki/The_Veda_of_the_Black_Yajus_School",
      "Keith's 1914 translation. Only Kanda I is transcribed on Wikisource; Kandas II–VII are not.",
    ),
  ],
  rights_note: "Keith's translation (1914) is public domain in the United States.",
  note: "Imported only in part: Kanda I of seven. The record and the reader both say partial, and the remaining kandas stay in this register. This is the Taittiriya (Black Yajurveda) recension, not the White Yajurveda.",
});

add({
  slug: "arthashastra",
  title: "Arthashastra",
  original_title: "अर्थशास्त्र",
  transliteration: "Arthaśāstra",
  author: "kautilya",
  school: "",
  genre: "Treatise",
  category: "Statecraft",
  status: "imported",
  priority: 3,
  languages: ["sa", "en"],
  source_leads: [
    WIKISOURCE("https://en.wikisource.org/wiki/Arthashastra", "Shamasastry's 1915 translation, fifteen books imported in full."),
  ],
  rights_note: "Shamasastry's translation (1915) is public domain in the United States.",
  note: "Imported and searchable: 15 books, 3,174 passages. Classified as statecraft, not scripture.",
});

// ---------------------------------------------------------------------------
// Located: the source exists, the text could not be imported honestly
// ---------------------------------------------------------------------------

add({
  slug: "samaveda",
  title: "Samaveda",
  original_title: "सामवेद",
  transliteration: "Sāmaveda",
  author: "",
  school: "",
  genre: "Veda",
  category: "Veda",
  status: "located",
  priority: 1,
  languages: ["sa", "en"],
  source_leads: [
    WIKISOURCE(
      "https://en.wikisource.org/wiki/The_Hymns_of_the_Samaveda",
      "Griffith's 1893 translation is listed, but every chapter link on the page is a red link: the text has not been transcribed.",
    ),
    GRETIL("A Sanskrit text may be available; it would need checking against a printed edition."),
  ],
  rights_note: "Griffith's translation is public domain in the United States.",
  note: `Located, not imported. ${NOT_TRANSCRIBED} The Samaveda is also largely a liturgical arrangement of Rigvedic verses, so a translation should name its recension (Kauthuma, Ranayaniya or Jaiminiya).`,
});

add({
  slug: "atharvaveda",
  title: "Atharvaveda",
  original_title: "अथर्ववेद",
  transliteration: "Atharvaveda",
  author: "",
  school: "",
  genre: "Veda",
  category: "Veda",
  status: "located",
  priority: 1,
  languages: ["sa", "en"],
  source_leads: [
    WIKISOURCE(
      "https://en.wikisource.org/wiki/Atharvaveda",
      "A landing page listing English translations. No transcribed text is present.",
    ),
  ],
  rights_note: "Whitney's 1905 translation is public domain in the United States, but no clean transcription was verified.",
  note: `Located, not imported. ${NOT_TRANSCRIBED}`,
});

add({
  slug: "laws-of-manu",
  title: "Manusmriti",
  original_title: "मनुस्मृति",
  transliteration: "Manusmṛti",
  author: "manu",
  school: "",
  genre: "Dharmashastra",
  category: "Dharma and law",
  status: "located",
  priority: 3,
  languages: ["sa", "en"],
  source_leads: [
    WIKISOURCE(
      "https://en.wikisource.org/wiki/Sacred_Books_of_the_East/Volume_25/Laws_of_Manu/Chapter_1",
      "Bühler's 1886 translation. Chapter 1 is transcribed; chapters 2–12 are not present under this page naming.",
    ),
    GUTENBERG(15474, "Checked: the Gutenberg catalogue does not carry Bühler's Laws of Manu."),
  ],
  rights_note: "Bühler's translation (1886) is public domain in the United States.",
  note: "Located, not imported in full. Only chapter 1 is transcribed on Wikisource, and a one-chapter import would misrepresent the work. It is a historically situated dharma text, not a universally binding code.",
});

add({
  slug: "yoga-vasishtha",
  title: "Yoga Vasistha",
  original_title: "योगवासिष्ठ",
  transliteration: "Yogavāsiṣṭha",
  author: "valmiki",
  school: "vedanta",
  genre: "Philosophical epic",
  category: "Vedanta",
  status: "located",
  priority: 2,
  languages: ["sa", "en"],
  source_leads: [
    GUTENBERG(71326, "Mitra's translation, vol. 1 of 4. Further volumes: 71063, 71064, 46531, 71248, 71249."),
  ],
  rights_note: "Mitra's translation (1891–99) is public domain in the United States.",
  note: "Located, not imported. The Gutenberg set is incomplete — no volume 3, part 1 was found in the catalogue — so importing the available files would produce a work with a missing middle. Needs either the missing volume or a complete alternative edition.",
});

add({
  slug: "gita-govinda",
  title: "Gita Govinda",
  original_title: "गीतगोविन्द",
  transliteration: "Gītagovinda",
  author: "jayadeva",
  school: "vaishnavism",
  genre: "Poetry",
  category: "Bhakti literature",
  status: "located",
  priority: 2,
  languages: ["sa", "en"],
  source_leads: [
    WIKISOURCE(
      "https://en.wikisource.org/wiki/Gita_Govinda",
      "Arnold's 1875 translation is present only as an untranscribed scan (Index:The Indian Song of Songs).",
    ),
    GRETIL("The Sanskrit text is likely available; the English verse translation would still need a transcription."),
  ],
  rights_note: "Arnold's translation (1875) is public domain in the United States.",
  note: `Located, not imported. ${NOT_TRANSCRIBED}`,
});

add({
  slug: "vivekachudamani",
  title: "Vivekachudamani",
  original_title: "विवेकचूडामणि",
  transliteration: "Vivekacūḍāmaṇi",
  author: "",
  school: "vedanta",
  genre: "Philosophical poem",
  category: "Vedanta",
  status: "located",
  priority: 2,
  languages: ["sa", "en"],
  source_leads: [
    WIKISOURCE(
      "https://en.wikisource.org/wiki/Vivekachudamani_(Swami_Madhavananda)",
      "Madhavananda's 1921 translation, flagged on Wikisource as an incomplete text without a source; only two subpages exist.",
    ),
  ],
  rights_note:
    "Madhavananda's translation (1921) is public domain in the United States, but the Wikisource transcription is incomplete and unsourced.",
  note: "Located, not imported. Traditional attribution to Shankara is disputed in modern scholarship, and the record would need to say so.",
});

add({
  slug: "panchatantra",
  title: "Panchatantra",
  original_title: "पञ्चतन्त्र",
  transliteration: "Pañcatantra",
  author: "",
  school: "",
  genre: "Fable collection",
  category: "Niti literature",
  status: "located",
  priority: 3,
  languages: ["sa", "en"],
  source_leads: [
    WIKISOURCE(
      "https://en.wikisource.org/wiki/Panchatantra",
      "A landing page listing English translations; no transcribed text.",
    ),
  ],
  rights_note: "Several nineteenth-century translations are public domain; none was verified as a clean transcription.",
  note: `Located, not imported. ${NOT_TRANSCRIBED}`,
});

add({
  slug: "autobiography-of-a-yogi",
  title: "Autobiography of a Yogi",
  original_title: "",
  transliteration: "Autobiography of a Yogi",
  author: "",
  school: "",
  genre: "Memoir",
  category: "Modern Hindu thought",
  status: "located",
  priority: 4,
  languages: ["en"],
  source_leads: [GUTENBERG(7452, "Project Gutenberg hosts the text; its US public-domain basis must be checked before import.")],
  rights_note:
    "The 1946 edition's US copyright status needs verification against the renewal records before any import; Project Gutenberg's listing is not by itself proof.",
  note: "Located, not imported. Phase 4 work, and licence verification is a precondition.",
});

add({
  slug: "complete-works-vivekananda",
  title: "The Complete Works of Swami Vivekananda",
  original_title: "",
  transliteration: "Complete Works of Swami Vivekananda",
  author: "",
  school: "",
  genre: "Collected works",
  category: "Modern Hindu thought",
  status: "located",
  priority: 4,
  languages: ["en"],
  source_leads: [
    GUTENBERG(72368, "Only 'Jnana Yoga, Part II: Seven Lectures' is in the Gutenberg catalogue; the nine-volume Collected Works are not."),
  ],
  rights_note: "Vivekananda's own pre-1929 lectures are public domain in the United States; later editorial matter in the Collected Works may not be.",
  note: "Located in part. Only one lecture volume is available as clean text; importing it as 'the Complete Works' would be false.",
});

// ---------------------------------------------------------------------------
// Wanted: no clean reusable text verified
// ---------------------------------------------------------------------------

const wanted = (
  slug: string,
  title: string,
  original: string,
  translit: string,
  author: string,
  school: string,
  genre: string,
  category: string,
  priority: number,
  languages: string[],
  note: string,
  leads: { source: string; url: string; note: string }[] = [GRETIL("Search for the Sanskrit text; GRETIL's terms of use apply."), SARIT("Search for a TEI edition; SARIT editions carry their own licences.")],
) =>
  add({
    slug, title, original_title: original, transliteration: translit, author, school, genre, category,
    status: "wanted", priority, languages,
    source_leads: leads,
    rights_note:
      "Public-domain translations may exist, but none was verified as a complete, clean transcription in this pass.",
    note,
  });

wanted("shatapatha-brahmana", "Shatapatha Brahmana", "शतपथब्राह्मण", "Śatapatha Brāhmaṇa", "", "", "Brahmana", "Veda", 1, ["sa", "en"],
  "Not imported. The complete English translation (Eggeling, Sacred Books of the East) exists in print and in scans, but no clean transcription was verified. The Madhyandina and Kanva recensions must be kept distinct.");
wanted("aitareya-brahmana", "Aitareya Brahmana", "ऐतरेयब्राह्मण", "Aitareya Brāhmaṇa", "", "", "Brahmana", "Veda", 1, ["sa", "en"],
  "Not imported. Only partial or antiquarian renderings were found; the text needs a verified complete edition.");
wanted("taittiriya-brahmana", "Taittiriya Brahmana", "तैत्तिरीयब्राह्मण", "Taittirīya Brāhmaṇa", "", "", "Brahmana", "Veda", 1, ["sa", "en"],
  "Not imported. No complete public-domain English translation was located.");
wanted("aitareya-aranyaka", "Aitareya Aranyaka", "ऐतरेयारण्यक", "Aitareya Āraṇyaka", "", "", "Aranyaka", "Veda", 1, ["sa", "en"],
  "Not imported. The Aranyaka is partly covered by the Aitareya Upanishad already in the library, but the Aranyaka itself has no verified complete text.");
wanted("taittiriya-aranyaka", "Taittiriya Aranyaka", "तैत्तिरीयारण्यक", "Taittirīya Āraṇyaka", "", "", "Aranyaka", "Veda", 1, ["sa", "en"],
  "Not imported. No complete English translation verified.");

wanted("adhyatma-ramayana", "Adhyatma Ramayana", "अध्यात्मरामायण", "Adhyātmarāmāyaṇa", "", "vaishnavism", "Devotional epic", "Epic", 2, ["sa", "en"],
  "Not imported. Usually transmitted as part of the Brahmanda Purana; the attribution and its relation to the Valmiki Ramayana need stating before import.");
wanted("brihadaranyaka-upanishad", "Brihadaranyaka Upanishad", "बृहदारण्यकोपनिषद्", "Bṛhadāraṇyaka Upaniṣad", "", "vedanta", "Upanishad", "Upanishad", 1, ["sa", "en"],
  "Not imported. It is not one of the seven Upanishads already in the library and no standalone transcribed translation was found on Wikisource or Gutenberg.");
wanted("mandukya-upanishad", "Mandukya Upanishad", "माण्डूक्योपनिषद्", "Māṇḍūkya Upaniṣad", "", "vedanta", "Upanishad", "Upanishad", 1, ["sa", "en"],
  "Not imported. The usual English editions carry Gaudapada's Karika and are in copyright; a public-domain text of the twelve verses alone was not verified.");
wanted("shvetashvatara-upanishad", "Shvetashvatara Upanishad", "श्वेताश्वतरोपनिषद्", "Śvetāśvatara Upaniṣad", "", "vedanta", "Upanishad", "Upanishad", 1, ["sa", "en"],
  "Not imported. No standalone transcribed public-domain translation was found.");
wanted("maitri-upanishad", "Maitri Upanishad", "मैत्री उपनिषद्", "Maitrī Upaniṣad", "", "vedanta", "Upanishad", "Upanishad", 2, ["sa", "en"],
  "Not imported. Also called Maitrayana; the recension and the relationship to the Maitrayaniya school need recording.");
wanted("kaushitaki-upanishad", "Kaushitaki Upanishad", "कौषीतकि उपनिषद्", "Kauṣītaki Upaniṣad", "", "vedanta", "Upanishad", "Upanishad", 2, ["sa", "en"],
  "Not imported. No standalone transcribed translation verified.");
wanted("jabala-upanishad", "Jabala Upanishad", "जाबालोपनिषद्", "Jābāla Upaniṣad", "", "vedanta", "Upanishad", "Upanishad", 3, ["sa", "en"],
  "Not imported. A minor Upanishad; a verified edition such as the 1914 'Thirty Minor Upanishads' would be the likely route.");
wanted("narada-parivrajaka-upanishad", "Narada Parivrajaka Upanishad", "नारदपरिव्राजकोपनिषद्", "Nāradaparivrājaka Upaniṣad", "", "vedanta", "Upanishad", "Upanishad", 3, ["sa", "en"],
  "Not imported. Minor Upanishad on renunciation; no verified digital text located.");

wanted("samkhya-karika", "Samkhya Karika", "सांख्यकारिका", "Sāṃkhyakārikā", "ishvarakrishna", "samkhya", "Philosophical treatise", "Philosophy", 1, ["sa", "en"],
  "Not imported. The existing Sarva-Darsana-Samgraha summarises Samkhya but is not a substitute for the Karika itself.");
wanted("nyaya-sutra", "Nyaya Sutra", "न्यायसूत्र", "Nyāyasūtra", "gautama", "nyaya", "Philosophical sutras", "Philosophy", 1, ["sa", "en"],
  "Not imported. No complete public-domain English translation verified.");
wanted("vaisheshika-sutra", "Vaisheshika Sutra", "वैशेषिकसूत्र", "Vaiśeṣikasūtra", "kanada", "vaisheshika", "Philosophical sutras", "Philosophy", 1, ["sa", "en"],
  "Not imported. The Nyaya-Vaisheshika literature is poorly served by clean public-domain translations.");
wanted("mimamsa-sutra", "Mimamsa Sutra", "मीमांसासूत्र", "Mīmāṃsāsūtra", "jaimini", "mimamsa", "Philosophical sutras", "Philosophy", 1, ["sa", "en"],
  "Not imported. No complete verified translation located.");
wanted("yoga-bhashya", "Yoga Bhashya", "योगभाष्य", "Yogabhāṣya", "vyasa", "yoga", "Commentary", "Philosophy", 2, ["sa", "en"],
  "Not imported. Vyasa's commentary on Patanjali's sutras; the existing Yoga Sutras record is the sutras alone, so this would be a separate work.");
wanted("nyaya-bhashya", "Nyaya Bhashya", "न्यायभाष्य", "Nyāyabhāṣya", "vatsyayana", "nyaya", "Commentary", "Philosophy", 2, ["sa", "en"],
  "Not imported. Vatsyayana's commentary on the Nyaya Sutras; no verified English text.");
wanted("shabara-bhashya", "Shabara Bhashya", "शाबरभाष्य", "Śābarabhāṣya", "shabara", "mimamsa", "Commentary", "Philosophy", 2, ["sa", "en"],
  "Not imported. The foundational Mimamsa commentary; no complete English translation verified.");
wanted("padarthadharmasamgraha", "Padarthadharmasamgraha", "पदार्थधर्मसंग्रह", "Padārthadharmasaṃgraha", "prashastapada", "vaisheshika", "Philosophical treatise", "Philosophy", 2, ["sa", "en"],
  "Not imported. Also known as the Prashastapada Bhashya; often printed with a commentary that must be recorded separately.");

wanted("madhva-brahma-sutra-bhashya", "Brahma Sutra Bhashya of Madhva", "ब्रह्मसूत्रभाष्यम्", "Brahmasūtrabhāṣya", "madhva", "vedanta", "Commentary", "Vedanta", 2, ["sa", "en"],
  "Not imported. Madhva's commentary (the Brahma Sutra Bhashya) is distinct from his Gita Bhashya and from Ramanuja's Sri Bhashya; no verified English text.");
wanted("panchadashi", "Panchadashi", "पञ्चदशी", "Pañcadaśī", "vidyaranya", "vedanta", "Philosophical treatise", "Vedanta", 2, ["sa", "en"],
  "Not imported. No public-domain English translation verified.");
wanted("vedantasara", "Vedantasara", "वेदान्तसार", "Vedāntasāra", "sadananda", "vedanta", "Manual", "Vedanta", 2, ["sa", "en"],
  "Not imported. Two works share this title; the attribution to Sadananda and the Advaita manual must be stated explicitly.");
wanted("vedarthasamgraha", "Vedarthasamgraha", "वेदार्थसंग्रह", "Vedārthasaṃgraha", "ramanuja", "vedanta", "Treatise", "Vedanta", 2, ["sa", "en"],
  "Not imported. Ramanuja's short work; no verified public-domain English translation.");
wanted("tattvaviveka", "Tattvaviveka", "तत्त्वविवेक", "Tattvaviveka", "", "vedanta", "Treatise", "Vedanta", 3, ["sa", "en"],
  "Not imported. Several works carry this title; the author and school must be established before a record is created.");
wanted("ramanuja-gita-bhashya", "Bhagavad Gita Bhashya of Ramanuja", "गीता भाष्य", "Gītābhāṣya", "ramanuja", "vedanta", "Commentary", "Vedanta", 2, ["sa", "en"],
  "Not imported. A separate work from the Sri Bhashya; no verified English translation.");
wanted("madhva-gita-bhashya", "Bhagavad Gita Bhashya of Madhva", "गीता भाष्यम्", "Gītābhāṣya", "madhva", "vedanta", "Commentary", "Vedanta", 2, ["sa", "en"],
  "Not imported. Shares a title with Ramanuja's Gita commentary; kept as its own target so the two are never merged.");

const puranas: [string, string, string, string, string, string][] = [
  ["bhagavata-purana", "Bhagavata Purana", "भागवतपुराण", "Bhāgavatapurāṇa", "vaishnavism", "The most influential Vaishnava Purana, in twelve skandhas. Only a study of it is on Gutenberg, not the text."],
  ["shiva-purana", "Shiva Purana", "शिवपुराण", "Śivapurāṇa", "shaivism", "No complete verified English translation in the public-domain corpora searched."],
  ["linga-purana", "Linga Purana", "लिङ्गपुराण", "Liṅgapurāṇa", "shaivism", "No complete verified English translation located."],
  ["devi-bhagavata-purana", "Devi Bhagavata Purana", "देवीभागवतपुराण", "Devībhāgavatapurāṇa", "shaktism", "No complete verified English translation located."],
  ["markandeya-purana", "Markandeya Purana", "मार्कण्डेयपुराण", "Mārkaṇḍeyapurāṇa", "shaktism", "Contains the Devi Mahatmya; the two must be linked rather than merged."],
  ["agni-purana", "Agni Purana", "अग्निपुराण", "Agnipurāṇa", "", "No complete verified English translation located."],
  ["brahmanda-purana", "Brahmanda Purana", "ब्रह्माण्डपुराण", "Brahmāṇḍapurāṇa", "", "No complete verified English translation located."],
  ["matsya-purana", "Matsya Purana", "मत्स्यपुराण", "Matsyapurāṇa", "", "No complete verified English translation located."],
  ["garuda-purana", "Garuda Purana", "गरुडपुराण", "Garuḍapurāṇa", "vaishnavism", "English 'Garuda Purana' books in circulation are usually summaries or translations of a small portion."],
  ["skanda-purana", "Skanda Purana", "स्कन्दपुराण", "Skandapurāṇa", "shaivism", "The largest Purana; no complete translation exists, so any import must state which khandas are covered."],
  ["narada-purana", "Narada Purana", "नारदपुराण", "Nāradapurāṇa", "vaishnavism", "No complete verified English translation located."],
];
for (const [slug, title, original, translit, school, note] of puranas) {
  wanted(slug, title, original, translit, "vyasa", school, "Purana", "Purana", 1, ["sa", "en"], `Not imported. ${note}`);
}

wanted("narada-bhakti-sutra", "Narada Bhakti Sutra", "नारदभक्तिसूत्र", "Nāradabhaktisūtra", "narada", "vaishnavism", "Sutras", "Bhakti literature", 2, ["sa", "en"],
  "Not imported. A short text; the obstacle is a verified public-domain translation, not length.");
wanted("shandilya-bhakti-sutra", "Shandilya Bhakti Sutra", "शाण्डिल्यभक्तिसूत्र", "Śāṇḍilyabhaktisūtra", "shandilya", "vaishnavism", "Sutras", "Bhakti literature", 2, ["sa", "en"],
  "Not imported. No verified English translation located.");
wanted("ramcharitmanas", "Ramcharitmanas", "रामचरितमानस", "Rāmacaritamānasa", "tulsidas", "vaishnavism", "Devotional epic", "Bhakti literature", 2, ["hi", "en"],
  "Not imported. The Awadhi original and its English translations are not in the public-domain corpora searched; a partial rendering would misrepresent the work.");
wanted("tiruvaymozhi", "Tiruvaymozhi", "திருவாய்மொழி", "Tiruvāymoḻi", "nammalvar", "vaishnavism", "Devotional poetry", "Bhakti literature", 2, ["ta", "en"],
  "Not imported. Tamil Shaiva and Vaishnava corpora are poorly represented in the sources searched; a Tamil source with a reuse licence is needed.");
wanted("tevaram", "Tevaram", "தேவாரம்", "Tēvāram", "sambandar", "shaivism", "Devotional poetry", "Bhakti literature", 2, ["ta", "en"],
  "Not imported. Part of the Tamil Shaiva canon; no verified digital text with a reuse licence.");
wanted("divya-prabandham", "Divya Prabandham", "நாலாயிரத் திவ்வியப் பிரபந்தம்", "Nālāyira Divya Prabandham", "", "vaishnavism", "Devotional anthology", "Bhakti literature", 2, ["ta", "en"],
  "Not imported. The collected Tamil Vaishnava anthology; no complete verified text.");
wanted("tukaram-abhangas", "Abhangas of Tukaram", "अभंग", "Abhaṅga", "tukaram", "vaishnavism", "Devotional poetry", "Bhakti literature", 3, ["mr", "en"],
  "Not imported. Marathi bhakti corpus; no verified digital edition with a reuse licence.");
wanted("jnaneshwari", "Jnaneshwari", "ज्ञानेश्वरी", "Jñāneśvarī", "jnaneshwar", "vaishnavism", "Commentary in verse", "Bhakti literature", 3, ["mr", "en"],
  "Not imported. Marathi verse commentary on the Gita; no verified complete translation.");
wanted("sursagar", "Sursagar", "सूरसागर", "Sūrsāgar", "surdas", "vaishnavism", "Devotional poetry", "Bhakti literature", 3, ["hi", "en"],
  "Not imported. Braj Bhasha corpus; no verified text.");

wanted("shiva-sutras", "Shiva Sutras", "शिवसूत्र", "Śivasūtra", "", "kashmir-shaivism", "Sutras", "Shaivism", 2, ["sa", "en"],
  "Not imported. The Kashmir Shaiva corpus (Muktabodha) is accessible but its texts are not openly licensed for redistribution.");
wanted("spandakarika", "Spandakarika", "स्पन्दकारिका", "Spandakārikā", "vasugupta", "kashmir-shaivism", "Philosophical poem", "Shaivism", 2, ["sa", "en"],
  "Not imported. No openly licensed verified text.");
wanted("pratyabhijnahridayam", "Pratyabhijnahridayam", "प्रत्यभिज्ञाहृदयम्", "Pratyabhijñāhṛdaya", "kshemaraja", "kashmir-shaivism", "Manual", "Shaivism", 2, ["sa", "en"],
  "Not imported. A short manual; the obstacle is licence and a verified translation.");
wanted("shivajnanabodham", "Shivajnanabodham", "சிவஞானபோதம்", "Civañāṉapōtam", "meikandar", "shaiva-siddhanta", "Treatise", "Shaivism", 2, ["ta", "en"],
  "Not imported. Tamil Shaiva Siddhanta; no verified digital text.");
wanted("tirumantiram", "Tirumantiram", "திருமந்திரம்", "Tirumantiram", "tirumular", "shaiva-siddhanta", "Tantric poetry", "Shaivism", 2, ["ta", "en"],
  "Not imported. No verified complete digital text.");
wanted("vijnana-bhairava-tantra", "Vijnana Bhairava Tantra", "विज्ञानभैरवतन्त्र", "Vijñānabhairavatantra", "", "kashmir-shaivism", "Tantra", "Shaivism", 2, ["sa", "en"],
  "Not imported. Tantric texts are frequently edited in copyright and the recension must be named.");
wanted("tantraloka", "Tantraloka", "तन्त्रालोक", "Tantrāloka", "abhinavagupta", "kashmir-shaivism", "Tantric treatise", "Shaivism", 2, ["sa", "en"],
  "Not imported. A very large work; no openly licensed complete text or translation.");
wanted("devi-mahatmya", "Devi Mahatmya", "देवीमाहात्म्य", "Devīmāhātmya", "", "shaktism", "Devotional text", "Shaktism", 2, ["sa", "en"],
  "Not imported. Also called Durga Saptashati; it belongs inside the Markandeya Purana and should be linked there.");
wanted("lalita-sahasranama", "Lalita Sahasranama", "ललितासहस्रनाम", "Lalitāsahasranāma", "", "shaktism", "Hymn", "Shaktism", 2, ["sa", "en"],
  "Not imported. From the Brahmanda Purana; no verified public-domain translation.");
wanted("saundarya-lahari", "Saundarya Lahari", "सौन्दर्यलहरी", "Saundaryalaharī", "", "shaktism", "Hymn", "Shaktism", 2, ["sa", "en"],
  "Not imported. Attribution to Shankara is traditional and disputed; licence and attribution both need care.");
wanted("devi-gita", "Devi Gita", "देवीगीता", "Devīgītā", "", "shaktism", "Devotional text", "Shaktism", 2, ["sa", "en"],
  "Not imported. Embedded in the Devi Bhagavata Purana; no verified text.");
wanted("tripura-rahasya", "Tripura Rahasya", "त्रिपुरारहस्य", "Tripurarahasya", "", "shaktism", "Philosophical text", "Shaktism", 3, ["sa", "en"],
  "Not imported. No verified public-domain translation.");
wanted("kularnava-tantra", "Kularnava Tantra", "कुलार्णवतन्त्र", "Kūlārṇavatantra", "", "shaktism", "Tantra", "Shaktism", 3, ["sa", "en"],
  "Not imported. Woodroffe's edition is public domain in the US but was not verified as a clean transcription.");

wanted("narada-pancharatra", "Narada Pancharatra", "नारदपञ्चरात्र", "Nāradapañcarātra", "", "vaishnavism", "Samhita", "Vaishnava theology", 2, ["sa", "en"],
  "Not imported. Pancaratra literature is largely unedited and unlicensed digitally.");
wanted("ahirbudhnya-samhita", "Ahirbudhnya Samhita", "अहिर्बुध्न्यसंहिता", "Ahirbudhnyasaṃhitā", "", "vaishnavism", "Samhita", "Vaishnava theology", 2, ["sa", "en"],
  "Not imported. No verified English text.");
wanted("parameshvara-samhita", "Parameshvara Samhita", "पारमेश्वरसंहिता", "Parameśvarasaṃhitā", "", "vaishnavism", "Samhita", "Vaishnava theology", 2, ["sa", "en"],
  "Not imported. No verified English text.");
wanted("brahma-samhita", "Brahma Samhita", "ब्रह्मसंहिता", "Brahma Saṃhitā", "", "vaishnavism", "Hymn", "Vaishnava theology", 2, ["sa", "en"],
  "Not imported. The text survives through a later commentary tradition; that edition history must be stated.");
wanted("gopala-tapani-upanishad", "Gopala Tapani Upanishad", "गोपालतापनी उपनिषद्", "Gopālatāpanī Upaniṣad", "", "vaishnavism", "Upanishad", "Vaishnava theology", 2, ["sa", "en"],
  "Not imported. A sectarian Upanishad; no verified public-domain translation.");
wanted("bhakti-rasamrita-sindhu", "Bhakti-rasamrita-sindhu", "भक्तिरसामृतसिन्धु", "Bhaktirasāmṛtasindhu", "rupa-goswami", "vaishnavism", "Treatise", "Vaishnava theology", 2, ["sa", "en"],
  "Not imported. Gaudiya Vaishnava theology; modern translations are in copyright.");
wanted("chaitanya-charitamrita", "Chaitanya Charitamrita", "चैतन्यचरितामृत", "Caitanyacaritāmṛta", "krishnadasa-kaviraja", "vaishnavism", "Hagiography", "Vaishnava theology", 2, ["bn", "en"],
  "Not imported. Bengali original; no verified public-domain English text.");

wanted("yajnavalkya-smriti", "Yajnavalkya Smriti", "याज्ञवल्क्यस्मृति", "Yājñavalkyasmṛti", "yajnavalkya", "", "Dharmashastra", "Dharma and law", 3, ["sa", "en"],
  "Not imported. No verified complete English translation.");
wanted("narada-smriti", "Narada Smriti", "नारदस्मृति", "Nāradasmṛti", "narada", "", "Dharmashastra", "Dharma and law", 3, ["sa", "en"],
  "Not imported. No verified complete English translation.");
wanted("hitopadesha", "Hitopadesha", "हितोपदेश", "Hitopadeśa", "", "", "Fable collection", "Niti literature", 3, ["sa", "en"],
  "Not imported. No transcribed public-domain text located.");
wanted("viduraniti", "Viduraniti", "विदुरनीति", "Viduranīti", "", "", "Niti", "Niti literature", 3, ["sa", "en"],
  "Not imported as a separate work: it is a section of the Udyoga Parva and is already readable inside the imported Mahabharata. A separate record would need a clear editorial reason and a link to that section.");
wanted("shukraniti", "Shukraniti", "शुक्रनीति", "Śukranīti", "", "", "Niti", "Niti literature", 3, ["sa", "en"],
  "Not imported. No verified English text.");

wanted("charaka-samhita", "Charaka Samhita", "चरकसंहिता", "Carakasaṃhitā", "charaka", "ayurveda", "Medical treatise", "Medicine", 3, ["sa", "en"],
  "Not imported. No verified complete English translation in the public-domain corpora searched.");
wanted("sushruta-samhita", "Sushruta Samhita", "सुश्रुतसंहिता", "Suśrutasaṃhitā", "sushruta", "ayurveda", "Medical treatise", "Medicine", 3, ["sa", "en"],
  "Not imported. No verified complete English translation.");
wanted("ashtanga-hridaya", "Ashtanga Hridaya", "अष्टाङ्गहृदय", "Aṣṭāṅgahṛdaya", "vagbhata", "ayurveda", "Medical compendium", "Medicine", 3, ["sa", "en"],
  "Not imported. No verified English text.");
wanted("natyashastra", "Natyashastra", "नाट्यशास्त्र", "Nāṭyaśāstra", "bharata", "", "Treatise on drama", "Aesthetics", 3, ["sa", "en"],
  "Not imported. No verified complete English translation.");
wanted("abhinavabharati", "Abhinavabharati", "अभिनवभारती", "Abhinavabhāratī", "abhinavagupta", "", "Commentary", "Aesthetics", 3, ["sa", "en"],
  "Not imported. Abhinavagupta's commentary on the Natyashastra; survives incomplete, and that must be stated if imported.");
wanted("sahityadarpana", "Sahityadarpana", "साहित्यदर्पण", "Sāhityadarpaṇa", "vishvanatha", "", "Poetics", "Aesthetics", 3, ["sa", "en"],
  "Not imported. No verified English translation.");
wanted("vakyapadiya", "Vakyapadiya", "वाक्यपदीय", "Vākyapadīya", "bhartrihari", "", "Grammar and philosophy of language", "Language", 3, ["sa", "en"],
  "Not imported. No verified complete English translation.");
wanted("ashtadhyayi", "Ashtadhyayi", "अष्टाध्यायी", "Aṣṭādhyāyī", "panini", "", "Grammar", "Language", 3, ["sa", "en"],
  "Not imported. Panini's sutras are usually read with a commentary; the edition and any accompanying commentary must be recorded.");
wanted("aryabhatiya", "Aryabhatiya", "आर्यभटीय", "Āryabhaṭīya", "aryabhata", "", "Astronomy and mathematics", "Science", 3, ["sa", "en"],
  "Not imported. No verified English text.");
wanted("surya-siddhanta", "Surya Siddhanta", "सूर्यसिद्धान्त", "Sūryasiddhānta", "", "", "Astronomy", "Science", 3, ["sa", "en"],
  "Not imported. Burgess's 1860 translation is public domain but was not verified as a clean transcription.");

// ---------------------------------------------------------------------------
// Rights-blocked (Phase 4)
// ---------------------------------------------------------------------------

const blocked = (
  slug: string,
  title: string,
  note: string,
  rights: string,
  source: string,
  url: string,
) =>
  add({
    slug, title, original_title: "", transliteration: title, author: "", school: "", genre: "Modern work",
    category: "Modern Hindu thought", status: "rights_blocked", priority: 4, languages: ["en"],
    source_leads: [{ source, url, note }],
    rights_note: rights,
    note,
  });

blocked("life-divine", "The Life Divine — Sri Aurobindo",
  "Not imported. Sri Aurobindo's collected works are published by the Sri Aurobindo Ashram Trust; the text is in copyright in most jurisdictions.",
  "In copyright. The Ashram's own online edition is free to read but not licensed for redistribution or local storage.",
  "Sri Aurobindo Ashram Trust (Complete Works online)", "https://incarnateword.in/");
blocked("hind-swaraj", "Hind Swaraj — M. K. Gandhi",
  "Not imported. The 1909 pamphlet is public domain in the United States, but the standard Collected Works text carries later editorial matter and the Navajivan Trust asserts rights over Gandhi's writings in India.",
  "Mixed: the 1909 text is PD in the US; the Collected Works edition is not clearly reusable. Licence review needed before any import.",
  "Gandhi Heritage Portal", "https://www.gandhiheritageportal.org/");
blocked("gospel-of-sri-ramakrishna", "The Gospel of Sri Ramakrishna",
  "Not imported. Swami Nikhilananda's 1942 translation is in copyright and is the standard English text.",
  "In copyright (Nikhilananda, 1942). No public-domain alternative translation was verified.",
  "Internet Archive (search for the 1942 edition)", "https://archive.org/");
blocked("dayananda-saraswati", "Selected works of Dayananda Saraswati",
  "Not imported. The Arya Samaj editions and their English translations are not openly licensed.",
  "Copyright status unclear; the Hindi/Sanskrit originals are old enough for public domain, but the standard English renderings are not verified as reusable.",
  "Internet Archive (search for Arya Samaj editions)", "https://archive.org/");
blocked("ramana-maharshi", "Selected works of Ramana Maharshi",
  "Not imported. The Sri Ramanasramam editions are in copyright.",
  "In copyright. No openly licensed edition located.",
  "Sri Ramanasramam", "https://www.sriramanamaharshi.org/");
blocked("ambedkar-buddha-and-his-dhamma", "The Buddha and His Dhamma — B. R. Ambedkar",
  "Not imported. Published posthumously in 1957 by the Government of Maharashtra; often read freely online, but no explicit reuse licence was verified.",
  "Copyright administered by the Government of Maharashtra; reuse permission not verified.",
  "Government of Maharashtra", "https://www.maharashtra.gov.in/");

// ---------------------------------------------------------------------------

const hindu = entries.map((entry) => ({
  slug: entry.slug,
  title: entry.title,
  original_title: entry.original_title,
  transliteration: entry.transliteration,
  author: entry.author,
  tradition: "hinduism",
  school: entry.school,
  genre: entry.genre,
  category: entry.category,
  status: entry.status,
  priority: entry.priority,
  languages: entry.languages,
  source_leads: entry.source_leads,
  rights_note: entry.rights_note,
  note: entry.note,
}));
const others = register.targets.filter((t: any) => t.tradition !== "hinduism");
register.version = 2;
register.updated_at = "2026-10-21";
register.note =
  "Works from the editorial request lists that are not yet imported, with the source leads, rights position and next action for each. An 'imported' entry records how much of the work is actually present; 'located' means a source was found but the text could not be imported honestly; 'wanted' means no verified reusable text was found; 'rights_blocked' means the available editions are in copyright.";
const bySlug = new Map<string, any>();
for (const target of [...others, ...hindu]) bySlug.set(target.slug, target);
register.targets = [...bySlug.values()];
writeFileSync(PATH, `${JSON.stringify(register, null, 2)}\n`);
const counts: Record<string, number> = {};
for (const t of register.targets) counts[t.status] = (counts[t.status] ?? 0) + 1;
console.log(register.targets.length, counts, "hindu:", hindu.length);
