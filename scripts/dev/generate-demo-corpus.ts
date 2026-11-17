// One-off corpus assembly helper. It reads source snapshots downloaded from
// Project Gutenberg, Wikisource, Sefaria, SuttaCentral and AlQuran Cloud and
// writes the version-controlled corpus JSON. It is not part of the runtime and
// is kept so the provenance of each excerpt can be reproduced.
//
// Run from the project root:  UWL_SOURCE_DIR=/tmp/uwl-src bun run scripts/dev/generate-demo-corpus.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SRC = process.env.UWL_SOURCE_DIR || "/tmp/uwl-src";
const OUT = join(import.meta.dir, "..", "..", "data", "corpus", "works");
mkdirSync(OUT, { recursive: true });

const read = (name: string) => readFileSync(join(SRC, name), "utf8");
const lines = (name: string) => read(name).split(/\r?\n/);

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&#8203;/g, "")
    .replace(/&#32;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#91;/g, "[")
    .replace(/&#93;/g, "]")
    .replace(/&thinsp;/g, " ")
    .replace(/&#8203;/g, "");
}
function stripHtml(s: string): string {
  return decode(
    s
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}
function tidy(s: string): string {
  return s.replace(/\[\s*\d+\s*\]/g, "").replace(/\s+/g, " ").trim();
}
function block(name: string, from: number, to: number): string {
  return lines(name).slice(from - 1, to).join("\n");
}
function stripLeadingVerseNumbers(s: string): string {
  return s.replace(/^\s*\d+\s+/, "").trim();
}

function kjvVerses(chapter: number, from: number, to: number): Record<string, string> {
  const all = block("pg10.txt", 100, 47000 + 2000).replace(/\s+/g, " ");
  const out: Record<string, string> = {};
  const re = new RegExp(`(?:^|\\s)${chapter}:(\\d+)\\s+([\\s\\S]*?)(?=\\s${chapter}:\\d+\\s|$)`, "g");
  for (const m of all.matchAll(re)) {
    const n = Number(m[1]);
    if (n >= from && n <= to) out[`${chapter}.${n}`] = tidy(m[2]);
  }
  return out;
}
function kjvFromBlock(blockText: string, chapter: number, from: number, to: number): Record<string, string> {
  const text = blockText.replace(/\s+/g, " ");
  const out: Record<string, string> = {};
  const re = new RegExp(`(?:^|\\s)${chapter}:(\\d+)\\s+([\\s\\S]*?)(?=\\s${chapter}:\\d+\\s|$)`, "g");
  for (const m of text.matchAll(re)) {
    const n = Number(m[1]);
    if (n >= from && n <= to) out[`${chapter}.${n}`] = tidy(m[2]);
  }
  return out;
}

const sefariaHebrew = (file: string, from: number, to: number): Record<string, string> => {
  const j = JSON.parse(read(file));
  const arr: string[] = j.versions[0].text;
  const out: Record<string, string> = {};
  arr.slice(from - 1, to).forEach((raw, i) => {
    const clean = tidy(decode(raw.replace(/<[^>]+>/g, "")).replace(/\{[פס]\}/g, ""));
    out[`${from + i}`] = clean;
  });
  return out;
};

// ---------- Genesis (Hebrew + JPS 1917) ----------
const genesisJpsText = read("jps_genesis.txt");
const genStart = genesisJpsText.indexOf("1 In the beginning God created");
const genRaw = genesisJpsText.slice(genStart, genesisJpsText.indexOf("one day.", genStart) + 8);
const genJpsParts = genRaw.split(/\s(?=[2-5]\s[A-Z])/);
const genesisJps: Record<string, string> = {};
genJpsParts.slice(0, 5).forEach((p, i) => (genesisJps[`1.${i + 1}`] = tidy(stripLeadingVerseNumbers(p))));
if (Object.keys(genesisJps).length !== 5) throw new Error(`Genesis JPS extraction failed: ${JSON.stringify(genesisJps)}`);

const genesisHebrewRaw = sefariaHebrew("sef_gen1.json", 1, 5);
const genesisHebrew: Record<string, string> = {};
Object.entries(genesisHebrewRaw).forEach(([k, v], i) => (genesisHebrew[`1.${i + 1}`] = v));

// ---------- Psalms (Hebrew + JPS 1917) ----------
const psText = read("jps_psalms.txt");
const psStart = psText.indexOf("The Lord is my shepherd");
const psRaw = psText.slice(psStart, psText.indexOf("for ever.", psStart) + 9);
const psParts = psRaw.split(/\s(?=[2-6]\s[A-Z])/);
const psJps: Record<string, string> = {};
psParts.slice(0, 6).forEach((p, i) => (psJps[`23.${i + 1}`] = tidy(stripLeadingVerseNumbers(p))));
const psHebrewRaw = sefariaHebrew("sef_ps23.json", 1, 6);
const psHebrew: Record<string, string> = {};
Object.entries(psHebrewRaw).forEach(([k, v], i) => (psHebrew[`23.${i + 1}`] = v));

// ---------- John (Greek + KJV) ----------
const johnGreekText = stripHtml(JSON.parse(read("john_el.json")).parse.text);
const jgStart = johnGreekText.indexOf("Ἐν ἀρχῇ ἦν ὁ λόγος");
const jgRaw = johnGreekText.slice(jgStart, johnGreekText.indexOf("οὐ κατέλαβεν", jgStart) + 14);
const jgParts = jgRaw.split(/\s(?=[2-5]\s)/);
const johnGreek: Record<string, string> = {};
jgParts.slice(0, 5).forEach((p, i) => (johnGreek[`1.${i + 1}`] = tidy(stripLeadingVerseNumbers(p).replace(/\s+/g, " "))));
const johnKjv = kjvFromBlock(block("pg10.txt", 84774, 84790), 1, 1, 5);

// ---------- Matthew (KJV) ----------
const mattKjv = kjvFromBlock(block("pg10.txt", 76660, 76695), 5, 3, 12);

// ---------- Qur'an ----------
const quranArabic: Record<string, string> = {};
for (const [surah, ayahs] of [
  [1, [1, 2, 3, 4, 5, 6, 7]],
  [2, [255]],
  [49, [13]],
] as const) {
  const j = JSON.parse(read(`quran_${surah}.json`));
  for (const n of ayahs) {
    const a = j.data.ayahs.find((x: any) => x.numberInSurah === n);
    quranArabic[`${surah}.${n}`] = decode(a.text.replace(/^\uFEFF/, "")).trim();
  }
}

const rodwell = lines("pg3434.txt");
const fatihaBlock = rodwell.slice(1553, 1582).join("\n");
const fatihaStart = fatihaBlock.indexOf("In the Name of God");
const fatihaEnd = fatihaBlock.indexOf("go not astray", fatihaStart) + 14;
const fatihaText = fatihaBlock.slice(fatihaStart, fatihaEnd);
const fatihaParts = fatihaText
  .split(/\n\s*\n/)
  .map((p) => tidy(p.replace(/\d+$/g, "")))
  .filter(Boolean)
  .slice(0, 7);
const quranEnglish: Record<string, string> = {};
fatihaParts.forEach((p, i) => (quranEnglish[`1.${i + 1}`] = p));

const kursiStart = rodwell.findIndex((l) => l.startsWith("God! There is no God but He; the Living, the Eternal"));
const kursi = tidy(rodwell.slice(kursiStart, kursiStart + 8).join(" "));
quranEnglish["2.255"] = kursi.replace(/\s+\d+(?=\s|$)/g, "");

const hujuratStart = rodwell.findIndex((l) => l.startsWith("O men! verily, we have created you of a male and a female"));
const hujurat = tidy(rodwell.slice(hujuratStart, hujuratStart + 4).join(" "));
quranEnglish["49.13"] = hujurat.replace(/\s+\d+(?=\s|$)/g, "").replace("most.8", "most.");

// ---------- Bhagavad Gita (Arnold 1885) ----------
const gita247 = tidy(block("pg2388.txt", 512, 519).replace(/^\s+/gm, ""));
const gita262 = tidy(
  block("pg2388.txt", 574, 580).replace(/^\s+/gm, "").replace(/^.*?If one\s+/, "If one ").replace("If one Ponders", "If one ponders"),
);

// ---------- Dhammapada (Pali + Sujato) ----------
const sc = JSON.parse(read("sc.json"));
const dhp: Record<string, { pi: string; en: string }> = {};
for (let v = 1; v <= 5; v++) {
  const keys = (sc.keys_order as string[]).filter(
    (k) => k.startsWith(`dhp${v}:`) && !/:0(\.|$)/.test(k),
  );
  const pi = keys.map((k) => String(sc.root_text[k] ?? "")).join("").replace(/\s+/g, " ").trim();
  const en = keys.map((k) => String(sc.translation_text[k] ?? "")).join("").replace(/\s+/g, " ").trim();
  dhp[`${v}`] = { pi, en };
}

// ---------- Daodejing (Legge 1891 + Daozang Chinese) ----------
const taoLeggeLines = lines("pg216.txt");
const taoLeggeChapter = (from: number, to: number) =>
  tidy(taoLeggeLines.slice(from - 1, to).join(" ").replace(/\s+/g, " "));

const taoZh = {
  "1": "道可道非常道名可名非常名無名天地之始有名萬物之母常無欲以觀其妙常有欲以觀其徼此兩者同出而異名同謂之玄玄之又玄衆妙之門",
  "8": "上善若水水善利萬物而不爭處衆人之所惡故幾於道居善地心善淵與善仁言善信政善治事善能動善時夫惟不爭故無尤",
  "11": "三十輻共一轂當其無有車之用埏埴以為器當其無有器之用鑿户牖以為室當其無有室之用故有之以為利無之以為用",
  "81": "信言不美美言不信善者不辯辯者不善知者不博博者不知聖人不積旣以與人己愈有旣以與人己愈多天之道利而不害聖人之道為而不爭",
};

// ---------- Analects (Legge 1861, Chinese + English) ----------
const analects = JSON.parse(read("ws_The_Chinese_Classics_Volume_1_Confucian_Analects_I.json"));
const aw = analects.parse.wikitext;
const zhBlocks = [...aw.matchAll(/\{\{lang(?: block)?\|zh\|([\s\S]*?)\}\}/g)]
  .map((m) => m[1].replace(/【[^】]*】/g, "").replace(/\s+/g, "").trim())
  .filter((s) => s.startsWith("【") || /^[子曰有曾]/.test(s));
const enChapters: Record<string, string> = {};
for (const m of aw.matchAll(/\{\{sc\|Chapter\}\}\s+([IVX]+)\.\s+([\s\S]*?)(?=\n\n\n\{\{lang|\n\n\n\{\{sc|\n\n\nRetrieved|$)/g)) {
  enChapters[m[1]] = tidy(
    m[2]
      .replace(/\{\{[^}]*\}\}/g, "")
      .replace(/''/g, "")
      .replace(/\n+/g, " "),
  );
}
const romanToNumber: Record<string, number> = {};
["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI"].forEach(
  (r, i) => (romanToNumber[r] = i + 1),
);
const analectsPicked = [1, 2, 4, 8, 12, 15, 16];
const analectsEn: Record<string, string> = {};
const analectsZh: Record<string, string> = {};
for (const n of analectsPicked) {
  const roman = Object.keys(romanToNumber).find((r) => romanToNumber[r] === n)!;
  analectsEn[`1.${n}`] = enChapters[roman] ?? "";
  analectsZh[`1.${n}`] = zhBlocks[n - 1] ?? "";
}

// ---------- Kojiki (Chamberlain 1882) ----------
const kojikiHtml = JSON.parse(read("html_Kojiki__Chamberlain,_1882__Section_1.json")).parse.text;
const kojikiText = tidy(stripHtml(kojikiHtml));
const kjStart = kojikiText.indexOf("The names of the Deities");
const kjEnd = kojikiText.indexOf("separate Heavenly Deities", kjStart) + 25;
const kojiki1 = tidy(kojikiText.slice(kjStart, kjEnd));

const kojiki12Html = JSON.parse(read("html_Kojiki__Chamberlain,_1882__Section_12.json")).parse.text;
const kojiki12Text = tidy(stripHtml(kojiki12Html));
const k12Start = kojiki12Text.indexOf("So while [the other two Deities]");
const k12End = kojiki12Text.indexOf("in Afumi", k12Start) + 9;
const kojiki12 = tidy(kojiki12Text.slice(k12Start, k12End));

// ---------- Acaranga Sutra (Jacobi 1884) ----------
const acarangaText = tidy(read("acaranga.txt").replace(/&#91;/g, "[").replace(/&#93;/g, "]"));
const ac1Start = acarangaText.indexOf("O long-lived (Gambûsvâmin");
const ac1End = acarangaText.indexOf("Second lesson", ac1Start);
const acaranga1 = tidy(acarangaText.slice(ac1Start, ac1End)).replace(/\s+\)/g, ")");
const ac2Start = acarangaText.indexOf("The (living) world is afflicted", acarangaText.indexOf("Second lesson"));
const ac2End = acarangaText.indexOf("Third lesson", ac2Start);
const acaranga2 = tidy(acarangaText.slice(ac2Start, ac2End)).replace(/\s+\)/g, ")");

// ---------- Meditations (Long) ----------
const medLines = lines("pg2680.txt");
const med1 = tidy(medLines.slice(911, 923).join(" ").replace(/^THE SECOND BOOK\s*/, "").replace(/^I\.\s*/, ""));
const med15Joined = medLines.join(" ");
const med15Start = med15Joined.indexOf("XV. The time of a man's life");
const med15End = med15Joined.indexOf("_Whilst I was at Carnuntum._", med15Start);
const med15 = tidy(med15Joined.slice(med15Start, med15End).replace(/^XV\.\s*/, ""));

// ---------- Apology (Jowett) ----------
const apologyLines = lines("pg1656.txt");
const apStart = apologyLines.findIndex((l) => l.includes("For if I tell you that to do as you say"));
const apPar = apologyLines.slice(apStart, apStart + 16).join(" ");
const apMatch = apPar.match(/For if I tell you that to do as you say[\s\S]*?believe me\./);
const apologyText = tidy(apMatch ? apMatch[0] : apPar);

// ---------- Work definitions ----------
function chaptersFromPassages(passages: { reference: string; label: string; chapterRef: string }[], labels: Record<string, string>) {
  const map = new Map<string, string>();
  for (const p of passages) if (!map.has(p.chapterRef)) map.set(p.chapterRef, labels[p.chapterRef] ?? p.chapterRef);
  return [...map.entries()].map(([ref, label]) => ({ ref, label }));
}

const genesisPassages = ["1.1", "1.2", "1.3", "1.4", "1.5"].map((ref) => ({
  reference: ref,
  label: `1:${ref.split(".")[1]}`,
  chapterRef: "1",
}));
const psalmPassages = ["23.1", "23.2", "23.3", "23.4", "23.5", "23.6"].map((ref) => ({
  reference: ref,
  label: `23:${ref.split(".")[1]}`,
  chapterRef: "23",
}));
const johnPassages = ["1.1", "1.2", "1.3", "1.4", "1.5"].map((ref) => ({
  reference: ref,
  label: `1:${ref.split(".")[1]}`,
  chapterRef: "1",
}));
const mattPassages = ["5.3", "5.4", "5.5", "5.6", "5.7", "5.8", "5.9", "5.10", "5.11", "5.12"].map((ref) => ({
  reference: ref,
  label: `5:${ref.split(".")[1]}`,
  chapterRef: "5",
}));
const quranPassages = [
  ...["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7"].map((ref) => ({ reference: ref, label: `1:${ref.split(".")[1]}`, chapterRef: "1" })),
  { reference: "2.255", label: "2:255", chapterRef: "2" },
  { reference: "49.13", label: "49:13", chapterRef: "49" },
];
const gitaPassages = [
  { reference: "2.47-48", label: "2:47–48", chapterRef: "2" },
  { reference: "2.62-63", label: "2:62–63", chapterRef: "2" },
];
const dhpPassages = ["1", "2", "3", "4", "5"].map((ref) => ({ reference: ref, label: `Verse ${ref}`, chapterRef: "1" }));
const taoPassages = ["1", "8", "11", "81"].map((ref) => ({ reference: ref, label: `Chapter ${ref}`, chapterRef: ref }));
const analectsPassages = analectsPicked.map((n) => ({ reference: `1.${n}`, label: `1:${n}`, chapterRef: "1" }));
const kojikiPassages = [
  { reference: "1", label: "Section I", chapterRef: "1" },
  { reference: "12", label: "Section XII", chapterRef: "12" },
];
const acarangaPassages = [
  { reference: "1.1.1", label: "Book 1, Lecture 1, Lesson 1", chapterRef: "1" },
  { reference: "1.1.2", label: "Book 1, Lecture 1, Lesson 2", chapterRef: "1" },
];
const medPassages = [
  { reference: "2.1", label: "Book II, §1", chapterRef: "2" },
  { reference: "2.15", label: "Book II, §15", chapterRef: "2" },
];
const apologyPassages = [{ reference: "38a", label: "38a", chapterRef: "38" }];

const works: any[] = [
  {
    slug: "genesis",
    title: "Genesis",
    originalTitle: "בְּרֵאשִׁית",
    transliteration: "Bereshit",
    altTitles: ["The Book of Genesis", "Bereshit"],
    tradition: "judaism",
    school: "rabbinic-judaism",
    genre: "Scripture",
    textType: "Narrative and law",
    originalLanguage: "he",
    dateStart: -1000,
    dateEnd: -400,
    dateDisplay: "Composite; c. 10th–5th centuries BCE",
    authorshipStatus: "composite",
    author: "moses",
    attributionNote:
      "Traditionally attributed to Moses. Modern scholarship treats Genesis as a composite work shaped by multiple authors and editors over centuries. The attribution is recorded as traditional, not established.",
    description:
      "The opening book of the Tanakh, moving from creation and the first human families to the ancestral narratives of Abraham, Isaac, Jacob and Joseph. This sample presents the opening creation account.",
    historicalContext:
      "Genesis reached its present form in the Persian or early Hellenistic period, drawing on older traditions shared across the ancient Near East. Its creation language has close neighbours in Mesopotamian literature, while its theological claims are distinctive.",
    featured: 1,
    featuredNote: "Creation, language and the ordering of the world",
    refScheme: "chapter.verse",
    chapters: chaptersFromPassages(genesisPassages, { "1": "Chapter 1" }),
    passages: genesisPassages,
    editions: [
      {
        slug: "genesis-hebrew-mam",
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
        notes: "Original-language edition. The text is displayed verbatim, including niqqud and cantillation.",
        texts: genesisHebrew,
      },
      {
        slug: "genesis-en-jps1917",
        language: "en",
        editionType: "translation",
        title: "The Holy Scriptures: A New Translation (JPS 1917)",
        translator: "Jewish Publication Society of America",
        publisher: "Jewish Publication Society of America",
        publicationYear: 1917,
        source: "wikisource",
        license: "public-domain",
        rightsStatus: "Public domain",
        attributionText: "The Holy Scriptures: A New Translation (JPS 1917), Jewish Publication Society of America. Public domain.",
        structureScheme: "chapter and verse",
        notes: "A public-domain Jewish translation. This is an excerpt, not a complete edition.",
        texts: genesisJps,
      },
    ],
  },
  {
    slug: "psalms",
    title: "Psalms",
    originalTitle: "תְּהִלִּים",
    transliteration: "Tehillim",
    altTitles: ["The Psalter", "Tehillim"],
    tradition: "judaism",
    school: "rabbinic-judaism",
    genre: "Scripture",
    textType: "Poetry and prayer",
    originalLanguage: "he",
    dateStart: -1000,
    dateEnd: -200,
    dateDisplay: "Composite; c. 10th–2nd centuries BCE",
    authorshipStatus: "composite",
    author: "david",
    attributionNote:
      "Many psalms carry headings associating them with David, but the Psalter is a composite collection with multiple authors and editors. The Davidic attribution is traditional.",
    description:
      "The Psalter is the prayer book of the Hebrew Bible: 150 poems of praise, lament, petition and thanksgiving. Psalm 23 is one of the most widely read passages in the collection.",
    historicalContext:
      "The psalms were composed and collected over several centuries, with the final collection taking shape in the Second Temple period. They became central to Jewish liturgy and to Christian monastic and devotional practice.",
    featured: 1,
    featuredNote: "The shepherd psalm and the language of trust",
    refScheme: "chapter.verse",
    chapters: chaptersFromPassages(psalmPassages, { "23": "Psalm 23" }),
    passages: psalmPassages,
    editions: [
      {
        slug: "psalms-hebrew-mam",
        language: "he",
        editionType: "original",
        title: "Miqra according to the Masorah",
        publisher: "Digital edition based on the Aleppo Codex tradition",
        publicationYear: null,
        source: "sefaria",
        license: "cc-by-sa",
        rightsStatus: "CC BY-SA (as reported by Sefaria)",
        attributionText: "Miqra according to the Masorah (MAM), Hebrew Bible text, CC BY-SA, accessed via Sefaria.",
        structureScheme: "chapter and verse",
        notes: "Original-language excerpt.",
        texts: psHebrew,
      },
      {
        slug: "psalms-en-jps1917",
        language: "en",
        editionType: "translation",
        title: "The Holy Scriptures: A New Translation (JPS 1917)",
        translator: "Jewish Publication Society of America",
        publisher: "Jewish Publication Society of America",
        publicationYear: 1917,
        source: "wikisource",
        license: "public-domain",
        rightsStatus: "Public domain",
        attributionText: "The Holy Scriptures: A New Translation (JPS 1917), Jewish Publication Society of America. Public domain.",
        structureScheme: "chapter and verse",
        notes: "Public-domain translation; excerpt only.",
        texts: psJps,
      },
    ],
  },
  {
    slug: "gospel-of-john",
    title: "Gospel of John",
    originalTitle: "Εὐαγγέλιον κατὰ Ἰωάννην",
    transliteration: "Euangelion kata Ioannen",
    altTitles: ["The Fourth Gospel", "John"],
    tradition: "christianity",
    school: "early-christianity",
    genre: "Scripture",
    textType: "Gospel",
    originalLanguage: "grc",
    dateStart: 90,
    dateEnd: 110,
    dateDisplay: "c. 90–110 CE",
    authorshipStatus: "disputed",
    author: "john-evangelist",
    attributionNote:
      "Traditionally attributed to John the Evangelist. The text itself is anonymous, and its authorship is disputed in modern scholarship. The traditional attribution is labelled as such.",
    description:
      "The Fourth Gospel opens with a poetic prologue identifying the Word (Logos) with God and with the light entering the world. This sample presents the prologue's first five verses.",
    historicalContext:
      "John is generally dated to the late first or early second century and reflects a community in dialogue with Jewish and emerging Christian traditions. Its Logos language also resonates with Greek philosophical vocabulary.",
    featured: 0,
    featuredNote: "",
    refScheme: "chapter.verse",
    chapters: chaptersFromPassages(johnPassages, { "1": "Chapter 1" }),
    passages: johnPassages,
    editions: [
      {
        slug: "john-greek-wikisource",
        language: "grc",
        editionType: "original",
        title: "Greek New Testament text (Wikisource transcription)",
        publisher: "Wikisource",
        publicationYear: null,
        source: "wikisource",
        license: "public-domain",
        rightsStatus: "Public domain",
        attributionText: "Greek text of the Gospel of John, Wikisource transcription of a public-domain edition. Punctuation and orthography follow the source.",
        structureScheme: "chapter and verse",
        notes: "Original-language excerpt; not a critical edition.",
        texts: johnGreek,
      },
      {
        slug: "john-en-kjv",
        language: "en",
        editionType: "translation",
        title: "The Holy Bible, King James Version",
        translator: "King James Version translators",
        publisher: "Project Gutenberg edition",
        publicationYear: 1611,
        source: "project-gutenberg",
        license: "public-domain",
        rightsStatus: "Public domain",
        attributionText: "The Holy Bible, King James Version (1611). Public domain. Text from Project Gutenberg eBook #10.",
        structureScheme: "chapter and verse",
        notes: "Public-domain translation. Early modern spelling and punctuation are retained.",
        texts: johnKjv,
      },
    ],
  },
  {
    slug: "gospel-of-matthew",
    title: "Gospel of Matthew",
    originalTitle: "Εὐαγγέλιον κατὰ Ματθαῖον",
    transliteration: "Euangelion kata Maththaion",
    altTitles: ["The First Gospel", "Matthew"],
    tradition: "christianity",
    school: "early-christianity",
    genre: "Scripture",
    textType: "Gospel",
    originalLanguage: "grc",
    dateStart: 80,
    dateEnd: 100,
    dateDisplay: "c. 80–100 CE",
    authorshipStatus: "disputed",
    author: "matthew-evangelist",
    attributionNote:
      "Traditionally attributed to Matthew the Evangelist. Most modern scholars regard the Gospel as anonymous and composed by a later author using Mark and other traditions.",
    description:
      "The Gospel of Matthew presents Jesus as a teacher and fulfilments of Israel's scriptures. The Sermon on the Mount opens with the Beatitudes, a compact portrait of the life the Gospel commends.",
    historicalContext:
      "Matthew was likely written after the destruction of the Jerusalem Temple (70 CE), in a community negotiating its relationship with Judaism and the wider Greco-Roman world.",
    featured: 1,
    featuredNote: "The Beatitudes and the ethics of mercy",
    refScheme: "chapter.verse",
    chapters: chaptersFromPassages(mattPassages, { "5": "Chapter 5 — the Sermon on the Mount" }),
    passages: mattPassages,
    editions: [
      {
        slug: "matthew-en-kjv",
        language: "en",
        editionType: "translation",
        title: "The Holy Bible, King James Version",
        translator: "King James Version translators",
        publisher: "Project Gutenberg edition",
        publicationYear: 1611,
        source: "project-gutenberg",
        license: "public-domain",
        rightsStatus: "Public domain",
        attributionText: "The Holy Bible, King James Version (1611). Public domain. Text from Project Gutenberg eBook #10.",
        structureScheme: "chapter and verse",
        notes:
          "Demonstration edition contains English only. A Greek original for Matthew is not yet included in the corpus; the work record still identifies Greek as its original language.",
        texts: mattKjv,
      },
    ],
  },
  {
    slug: "quran",
    title: "The Qur'an",
    originalTitle: "القرآن",
    transliteration: "al-Qurʾān",
    altTitles: ["Koran", "Al-Qur'an"],
    tradition: "islam",
    school: null,
    genre: "Scripture",
    textType: "Recitation and revelation",
    originalLanguage: "ar",
    dateStart: 610,
    dateEnd: 632,
    dateDisplay: "c. 610–632 CE (compiled shortly after)",
    authorshipStatus: "traditional",
    author: null,
    attributionNote:
      "Muslims confess the Qur'an as the word of God revealed to the Prophet Muhammad. The work record does not reduce that claim to ordinary human authorship. Historical scholarship studies the text's composition and transmission in its late antique context.",
    description:
      "The Qur'an is recited in Arabic across the Muslim world and consists of 114 surahs. This sample includes al-Fatiha, the opening prayer; Ayat al-Kursi (2:255); and the verse of mutual recognition (49:13).",
    historicalContext:
      "The Qur'an emerged in seventh-century Arabia and was collected in written form within the early Muslim community. Its language, rhetoric and engagement with biblical and Arabian traditions are central to both religious and academic study.",
    featured: 1,
    featuredNote: "Mercy, sovereignty and human difference",
    refScheme: "surah.ayah",
    chapters: chaptersFromPassages(quranPassages, {
      "1": "Surah 1 — al-Fatiha",
      "2": "Surah 2 — al-Baqarah",
      "49": "Surah 49 — al-Hujurat",
    }),
    passages: quranPassages,
    editions: [
      {
        slug: "quran-ar-uthmani",
        language: "ar",
        editionType: "original",
        title: "Tanzil Quran Text (Uthmani)",
        publisher: "Tanzil Project",
        publicationYear: null,
        source: "alquran-cloud",
        license: "cc-by-3.0",
        rightsStatus: "Tanzil text terms: verbatim copying permitted, modification not allowed",
        attributionText:
          "Tanzil Quran Text (Uthmani), Copyright (C) 2007–2024 Tanzil Project, CC BY 3.0. Retrieved via AlQuran Cloud. Reproduced verbatim without modification.",
        structureScheme: "surah and ayah",
        notes: "Arabic text only; no translation is bundled with this edition.",
        texts: quranArabic,
      },
      {
        slug: "quran-en-rodwell",
        language: "en",
        editionType: "translation",
        title: "The Koran, translated by J. M. Rodwell",
        translator: "John Medows Rodwell",
        publisher: "Project Gutenberg edition",
        publicationYear: 1861,
        source: "project-gutenberg",
        license: "public-domain",
        rightsStatus: "Public domain",
        attributionText: "The Koran, translated from the Arabic by J. M. Rodwell (1861). Public domain. Text from Project Gutenberg eBook #3434.",
        structureScheme: "surah and ayah (as divided in this edition)",
        notes:
          "A nineteenth-century public-domain translation. It is not a modern scholarly translation and its English reflects its period. Verse divisions follow the source.",
        texts: quranEnglish,
      },
    ],
  },
  {
    slug: "bhagavad-gita",
    title: "Bhagavad Gita",
    originalTitle: "भगवद्गीता",
    transliteration: "Bhagavadgītā",
    altTitles: ["The Song of the Lord", "Gita"],
    tradition: "hinduism",
    school: "vaishnavism",
    genre: "Scripture",
    textType: "Philosophical dialogue in verse",
    originalLanguage: "sa",
    dateStart: -200,
    dateEnd: 200,
    dateDisplay: "c. 2nd century BCE–2nd century CE",
    authorshipStatus: "composite",
    author: "vyasa",
    attributionNote:
      "Traditionally attributed to Vyasa and embedded in the Mahabharata. Modern scholarship treats the Gita as a composite philosophical poem shaped within the epic tradition.",
    description:
      "Set on the eve of battle, the Gita records Krishna's instruction to Arjuna on duty, action, knowledge and devotion. These excerpts concern detachment from the fruits of action and the chain from sense-contact to ruin.",
    historicalContext:
      "The Gita synthesises strands of Brahmanical, Samkhya, Yoga and devotional thought. It has been interpreted by competing schools and has become one of the most widely translated Hindu texts.",
    featured: 1,
    featuredNote: "Action without attachment",
    refScheme: "chapter.verse",
    chapters: chaptersFromPassages(gitaPassages, { "2": "Chapter 2 — Sāṃkhya Yoga" }),
    passages: gitaPassages,
    editions: [
      {
        slug: "gita-en-arnold",
        language: "en",
        editionType: "translation",
        title: "The Song Celestial; or, Bhagavad-Gîtâ",
        translator: "Edwin Arnold",
        publisher: "Project Gutenberg edition",
        publicationYear: 1885,
        source: "project-gutenberg",
        license: "public-domain",
        rightsStatus: "Public domain",
        attributionText:
          "The Song Celestial; or, Bhagavad-Gîtâ, translated by Edwin Arnold (1885). Public domain. Text from Project Gutenberg eBook #2388.",
        structureScheme: "chapter and verse (verse ranges assigned to this excerpt)",
        notes:
          "A Victorian verse translation. Demonstration edition contains English only; no Sanskrit source text has been imported. Verse ranges are supplied by the library and correspond to the standard Gita numbering.",
        texts: { "2.47-48": gita247, "2.62-63": gita262 },
      },
    ],
  },
  {
    slug: "dhammapada",
    title: "Dhammapada",
    originalTitle: "धम्मपद",
    transliteration: "Dhammapada",
    altTitles: ["Words of the Dhamma", "The Path of Truth"],
    tradition: "buddhism",
    school: "theravada",
    genre: "Scripture",
    textType: "Verse anthology",
    originalLanguage: "pi",
    dateStart: -300,
    dateEnd: -100,
    dateDisplay: "Compiled c. 3rd–1st centuries BCE",
    authorshipStatus: "anonymous",
    author: "buddha",
    attributionNote:
      "The verses are traditionally attributed to the Buddha but were collected and arranged by later editors. The Pali recension is used here.",
    description:
      "The Dhammapada is a compact anthology of 423 verses on mind, conduct, suffering and liberation. The opening twin verses make the ethical quality of intention the hinge of the path.",
    historicalContext:
      "The Dhammapada belongs to the Khuddaka Nikaya of the Pali canon. It circulated widely across Buddhist Asia and has been translated many times; the Pali text and a modern CC0 translation are shown here.",
    featured: 1,
    featuredNote: "Mind, intention and the ending of hatred",
    refScheme: "verse",
    chapters: chaptersFromPassages(dhpPassages, { "1": "Chapter 1 — The Twin Verses" }),
    passages: dhpPassages,
    editions: [
      {
        slug: "dhammapada-pi-sc",
        language: "pi",
        editionType: "original",
        title: "Dhammapada (Pali root text)",
        publisher: "SuttaCentral / Pali Canon",
        publicationYear: null,
        source: "suttacentral",
        license: "public-domain",
        rightsStatus: "Public domain (Pali root text)",
        attributionText: "Pali root text of the Dhammapada, verses 1–5, from SuttaCentral's segmented edition of the Pali Canon. Public domain.",
        structureScheme: "verse",
        notes: "Pali root text, verses 1–5.",
        texts: Object.fromEntries(Object.entries(dhp).map(([k, v]) => [k, v.pi])),
      },
      {
        slug: "dhammapada-en-sujato",
        language: "en",
        editionType: "translation",
        title: "Dhammapada, translated by Bhikkhu Sujato",
        translator: "Bhikkhu Sujato",
        publisher: "SuttaCentral",
        publicationYear: 2018,
        source: "suttacentral",
        license: "cc0-1.0",
        rightsStatus: "CC0 1.0",
        attributionText: "Dhammapada, translated by Bhikkhu Sujato, SuttaCentral, CC0 1.0. Verses 1–5.",
        structureScheme: "verse",
        notes: "A contemporary translation released CC0. Attribution is retained as a scholarly courtesy.",
        texts: Object.fromEntries(Object.entries(dhp).map(([k, v]) => [k, v.en])),
      },
    ],
  },
  {
    slug: "tao-te-ching",
    title: "Tao Te Ching",
    originalTitle: "道德經",
    transliteration: "Daodejing",
    altTitles: ["Daodejing", "Laozi", "The Classic of the Way and Virtue"],
    tradition: "taoism",
    school: "daoist",
    genre: "Philosophy",
    textType: "Aphoristic poem",
    originalLanguage: "zh",
    dateStart: -400,
    dateEnd: -300,
    dateDisplay: "c. 4th–3rd centuries BCE (received text later)",
    authorshipStatus: "disputed",
    author: "laozi",
    attributionNote:
      "Traditionally attributed to Laozi. The text is generally regarded as composite, with layers composed over several centuries. The received 81-chapter edition is later than the oldest manuscript witnesses.",
    description:
      "The Daodejing is a short, enigmatic classic on the Dao, non-striving, softness and political order. This sample includes the opening chapter, the image of water, the usefulness of emptiness, and the closing chapter.",
    historicalContext:
      "The text arose in the Warring States period and was transmitted with commentaries in Daoist and imperial contexts. Manuscripts from Guodian and Mawangdui have reshaped scholarly understanding of its formation.",
    featured: 1,
    featuredNote: "The Way, water and emptiness",
    refScheme: "chapter",
    chapters: chaptersFromPassages(taoPassages, {
      "1": "Chapter 1",
      "8": "Chapter 8",
      "11": "Chapter 11",
      "81": "Chapter 81",
    }),
    passages: taoPassages,
    editions: [
      {
        slug: "tao-zh-daozang",
        language: "zh",
        editionType: "original",
        title: "道德真經 (正統道藏本)",
        publisher: "Zhengtong Daozang",
        publicationYear: null,
        source: "wikisource",
        license: "public-domain",
        rightsStatus: "Public domain",
        attributionText: "道德真經, Zhengtong Daozang edition, via Wikisource. Public domain.",
        structureScheme: "chapter",
        notes: "Traditional Chinese text shown without modern punctuation. The source is a Ming-dynasty Daozang edition.",
        texts: taoZh,
      },
      {
        slug: "tao-en-legge",
        language: "en",
        editionType: "translation",
        title: "The Tao Teh King, or the Tao and its Characteristics",
        translator: "James Legge",
        publisher: "Project Gutenberg edition",
        publicationYear: 1891,
        source: "project-gutenberg",
        license: "public-domain",
        rightsStatus: "Public domain",
        attributionText:
          "The Tao Teh King, translated by James Legge (1891). Public domain. Text from Project Gutenberg eBook #216.",
        structureScheme: "chapter",
        notes: "A nineteenth-century scholarly translation with Legge's section numbering retained.",
        texts: {
          "1": taoLeggeChapter(57, 76),
          "8": taoLeggeChapter(169, 183),
          "11": taoLeggeChapter(213, 221),
          "81": taoLeggeChapter(1479, 1495),
        },
      },
    ],
  },
  {
    slug: "analects",
    title: "Analects",
    originalTitle: "論語",
    transliteration: "Lunyu",
    altTitles: ["Lunyu", "Selected Sayings"],
    tradition: "confucianism",
    school: "confucian",
    genre: "Philosophy",
    textType: "Dialogues and aphorisms",
    originalLanguage: "zh",
    dateStart: -479,
    dateEnd: -249,
    dateDisplay: "Compiled c. 5th–3rd centuries BCE",
    authorshipStatus: "composite",
    author: "confucius",
    attributionNote:
      "The Analects record sayings of Confucius and his disciples. They were compiled by later followers and contain multiple layers; the work is not an autograph by Confucius.",
    description:
      "The Analects is the central text of Confucian ethics, concerned with learning, ritual propriety, filial conduct and the formation of the exemplary person (junzi). This sample presents selected passages from Book I.",
    historicalContext:
      "The text took shape during the Warring States period and became a foundational classic of the imperial examination tradition. Its interpretation was transformed by later Neo-Confucian commentators.",
    featured: 0,
    featuredNote: "",
    refScheme: "book.chapter",
    chapters: chaptersFromPassages(analectsPassages, { "1": "Book I — Xue Er" }),
    passages: analectsPassages,
    editions: [
      {
        slug: "analects-zh-wikisource",
        language: "zh",
        editionType: "original",
        title: "論語 (Wikisource transcription)",
        publisher: "Wikisource",
        publicationYear: null,
        source: "wikisource",
        license: "public-domain",
        rightsStatus: "Public domain",
        attributionText: "論語, Book I, Wikisource transcription. Public domain.",
        structureScheme: "book and chapter",
        notes: "Chinese text shown without the source's chapter/verse brackets or modern punctuation.",
        texts: analectsZh,
      },
      {
        slug: "analects-en-legge",
        language: "en",
        editionType: "translation",
        title: "The Chinese Classics, Volume 1: Confucian Analects",
        translator: "James Legge",
        publisher: "Trübner & Co.",
        publicationYear: 1861,
        source: "wikisource",
        license: "public-domain",
        rightsStatus: "Public domain",
        attributionText: "The Chinese Classics, Vol. 1, Confucian Analects, translated by James Legge (1861). Public domain. Via Wikisource.",
        structureScheme: "book and chapter",
        notes: "Legge's nineteenth-century translation. Chapters are complete even where the reader label points to the opening verse.",
        texts: analectsEn,
      },
    ],
  },
  {
    slug: "kojiki",
    title: "Kojiki",
    originalTitle: "古事記",
    transliteration: "Kojiki",
    altTitles: ["Records of Ancient Matters"],
    tradition: "shinto",
    school: "shinto",
    genre: "Chronicle",
    textType: "Myth and dynastic history",
    originalLanguage: "ja",
    dateStart: 712,
    dateEnd: 712,
    dateDisplay: "712 CE",
    authorshipStatus: "established",
    author: "ono-yasumaro",
    attributionNote:
      "Compiled by Ō no Yasumaro in 712 CE at imperial command, drawing on earlier oral and written traditions. The compiler is historically established; the underlying myths are traditional.",
    description:
      "The Kojiki is Japan's oldest surviving chronicle, narrating the age of the kami and the origins of the imperial line. This sample includes the opening account of the first deities and the weeping of Susanoo.",
    historicalContext:
      "The Kojiki was compiled in the Nara period as part of the state's consolidation of myth, genealogy and legitimacy. It became a central text for Shinto and for later Japanese nationalism and philology.",
    featured: 0,
    featuredNote: "",
    refScheme: "section",
    chapters: chaptersFromPassages(kojikiPassages, { "1": "Section I", "12": "Section XII" }),
    passages: kojikiPassages,
    editions: [
      {
        slug: "kojiki-en-chamberlain",
        language: "en",
        editionType: "translation",
        title: "Kojiki: Records of Ancient Matters",
        translator: "Basil Hall Chamberlain",
        publisher: "Asiatic Society of Japan",
        publicationYear: 1882,
        source: "wikisource",
        license: "public-domain",
        rightsStatus: "Public domain",
        attributionText: "Kojiki, translated by Basil Hall Chamberlain (1882). Public domain. Via Wikisource.",
        structureScheme: "section",
        notes:
          "Chamberlain's translation is a landmark of Victorian Japanology and retains his romanisation and archaic register. The classical Japanese/Chinese source text is not included in this demonstration edition.",
        texts: { "1": kojiki1, "12": kojiki12 },
      },
    ],
  },
  {
    slug: "acaranga-sutra",
    title: "Acaranga Sutra",
    originalTitle: "आचाराङ्ग सूत्र",
    transliteration: "Ācārāṅga Sūtra",
    altTitles: ["Akaranga Sutra", "The Conduct of the Monks"],
    tradition: "jainism",
    school: "svetambara",
    genre: "Scripture",
    textType: "Monastic discipline and teaching",
    originalLanguage: "pra",
    dateStart: -400,
    dateEnd: -300,
    dateDisplay: "c. 4th–3rd centuries BCE (traditional dating earlier)",
    authorshipStatus: "composite",
    author: "mahavira",
    attributionNote:
      "Traditionally preserves teaching of Mahavira as transmitted by his disciple Sudharman. The text reached its present form through a long process of transmission and canon formation.",
    description:
      "The Acaranga Sutra is among the oldest surviving Jain scriptures, concerned with non-violence and the discipline of the mendicant. Its first lecture, 'Knowledge of the Weapon', examines the causes of harm.",
    historicalContext:
      "The Śvetāmbara canon was fixed in the fifth century CE, drawing on older oral traditions. The Acaranga's ascetic and ecological ethic has become central to modern Jain identity and to environmental readings of Jainism.",
    featured: 0,
    featuredNote: "",
    refScheme: "book.lecture.lesson",
    chapters: chaptersFromPassages(acarangaPassages, { "1": "Book 1, Lecture 1" }),
    passages: acarangaPassages,
    editions: [
      {
        slug: "acaranga-en-jacobi",
        language: "en",
        editionType: "translation",
        title: "Jaina Sutras, Part I (Sacred Books of the East, vol. 22)",
        translator: "Hermann Jacobi",
        publisher: "Clarendon Press",
        publicationYear: 1884,
        source: "wikisource",
        license: "public-domain",
        rightsStatus: "Public domain",
        attributionText: "Jaina Sutras, Part I, translated by Hermann Jacobi (1884). Sacred Books of the East, vol. 22. Public domain. Via Wikisource.",
        structureScheme: "book, lecture, lesson",
        notes:
          "English excerpt only. The source transcription shows occasional OCR artefacts; these have not been silently corrected. A Prakrit edition is not yet imported.",
        texts: { "1.1.1": acaranga1, "1.1.2": acaranga2 },
      },
    ],
  },
  {
    slug: "meditations",
    title: "Meditations",
    originalTitle: "Τὰ εἰς ἑαυτόν",
    transliteration: "Ta eis heauton",
    altTitles: ["To Himself", "The Meditations of Marcus Aurelius"],
    tradition: "greek-roman",
    school: "stoicism",
    genre: "Philosophy",
    textType: "Private notebook",
    originalLanguage: "grc",
    dateStart: 161,
    dateEnd: 180,
    dateDisplay: "c. 161–180 CE",
    authorshipStatus: "established",
    author: "marcus-aurelius",
    attributionNote:
      "Written by the Roman emperor Marcus Aurelius in Greek. The work is a private notebook, not a treatise prepared for publication.",
    description:
      "The Meditations are notes on Stoic practice: mortality, duty, the discipline of judgement and the small span of a human life. This sample includes two reflections from Book II.",
    historicalContext:
      "Written during military campaigns on the Danube frontier, the Meditations draw on Epictetus and Stoic physics. They are among the most widely read works of ancient philosophy.",
    featured: 0,
    featuredNote: "",
    refScheme: "book.section",
    chapters: chaptersFromPassages(medPassages, { "2": "Book II" }),
    passages: medPassages,
    editions: [
      {
        slug: "meditations-en-long",
        language: "en",
        editionType: "translation",
        title: "The Thoughts of the Emperor Marcus Aurelius Antoninus",
        translator: "George Long",
        publisher: "Project Gutenberg edition",
        publicationYear: 1862,
        source: "project-gutenberg",
        license: "public-domain",
        rightsStatus: "Public domain",
        attributionText:
          "The Thoughts of the Emperor Marcus Aurelius Antoninus, translated by George Long (1862). Public domain. Text from Project Gutenberg eBook #2680.",
        structureScheme: "book and section",
        notes:
          "Long's Victorian translation. Demonstration edition contains English only; a Greek source text is not yet imported. Book and section numbers follow Long's edition.",
        texts: { "2.1": med1, "2.15": med15 },
      },
    ],
  },
  {
    slug: "apology",
    title: "Apology of Socrates",
    originalTitle: "Ἀπολογία Σωκράτους",
    transliteration: "Apologia Sōkratous",
    altTitles: ["Plato's Apology", "The Apology"],
    tradition: "greek-roman",
    school: "platonism",
    genre: "Philosophy",
    textType: "Defence speech / dialogue",
    originalLanguage: "grc",
    dateStart: -399,
    dateEnd: -390,
    dateDisplay: "c. 399–390 BCE",
    authorshipStatus: "established",
    author: "plato",
    attributionNote:
      "Written by Plato as a literary account of Socrates' defence before the Athenian court. It is not a verbatim transcript, and its relationship to the historical Socrates is debated.",
    description:
      "Plato's Apology dramatises Socrates' defence against charges of impiety and corrupting the young. Near the end, Socrates explains why he would not abandon his examined life even to avoid death.",
    historicalContext:
      "The trial took place in 399 BCE amid Athens' post-war instability. The Apology became a foundational text for the philosophical life and for later debates about civil disobedience and free inquiry.",
    featured: 0,
    featuredNote: "",
    refScheme: "Stephanus page",
    chapters: chaptersFromPassages(apologyPassages, { "38": "Stephanus 38" }),
    passages: apologyPassages,
    editions: [
      {
        slug: "apology-en-jowett",
        language: "en",
        editionType: "translation",
        title: "Apology, translated by Benjamin Jowett",
        translator: "Benjamin Jowett",
        publisher: "Project Gutenberg edition",
        publicationYear: 1871,
        source: "project-gutenberg",
        license: "public-domain",
        rightsStatus: "Public domain",
        attributionText: "Apology, translated by Benjamin Jowett (1871). Public domain. Text from Project Gutenberg eBook #1656.",
        structureScheme: "Stephanus page",
        notes:
          "Jowett's Victorian translation. Demonstration edition contains English only; a Greek source text is not yet imported. The reference '38a' follows the standard Stephanus pagination.",
        texts: { "38a": apologyText },
      },
    ],
  },
  {
    slug: "guru-granth-sahib",
    title: "Guru Granth Sahib",
    originalTitle: "ਗੁਰੂ ਗ੍ਰੰਥ ਸਾਹਿਬ",
    transliteration: "Gurū Granth Sāhib",
    altTitles: ["Adi Granth", "Sri Guru Granth Sahib"],
    tradition: "sikhism",
    school: null,
    genre: "Scripture",
    textType: "Hymns and liturgical poetry",
    originalLanguage: "pa",
    dateStart: 1604,
    dateEnd: 1708,
    dateDisplay: "Compiled 1604; final form 1708",
    authorshipStatus: "composite",
    author: "guru-nanak",
    attributionNote:
      "A compilation of hymns by Guru Nanak, the succeeding Gurus and other saints, first compiled by Guru Arjan in 1604. It is revered as the eternal Guru in Sikh tradition.",
    description:
      "The Guru Granth Sahib is the central scripture of Sikhism, containing devotional hymns in Gurmukhi and related languages. It is treated as a living Guru, not merely a book.",
    historicalContext:
      "The Adi Granth was compiled in 1604 and given its final form by Guru Gobind Singh in 1708. Its hymns are organised by musical mode (raga) and include voices from multiple religious backgrounds.",
    featured: 0,
    featuredNote: "",
    refScheme: "raga and hymn",
    chapters: [],
    passages: [],
    editions: [],
    availabilityNote:
      "No text is displayed. The available English translations are under copyright, and the Gurmukhi edition requires editorial and community review. This catalogue record is metadata only; it is not an imported edition.",
  },
  {
    slug: "gathas",
    title: "The Gathas",
    originalTitle: "𐬔𐬁𐬚𐬁",
    transliteration: "Gāthās",
    altTitles: ["Hymns of Zarathushtra", "Gathas of Zoroaster"],
    tradition: "zoroastrianism",
    school: null,
    genre: "Scripture",
    textType: "Hymns",
    originalLanguage: "ae",
    dateStart: -1500,
    dateEnd: -1000,
    dateDisplay: "Traditional: c. 1500–1000 BCE (dating debated)",
    authorshipStatus: "disputed",
    author: "zoroaster",
    attributionNote:
      "Traditionally attributed to Zarathushtra. The date, authorship and interpretation of the Gathas are debated; the Avestan text is difficult and translations differ substantially.",
    description:
      "The Gathas are the oldest hymns of the Avesta, attributed to Zarathushtra and embedded in the Yasna liturgy. They are central to Zoroastrian theology and ritual.",
    historicalContext:
      "The Gathas were transmitted orally for centuries before being written down. Their archaic Avestan language and complex poetic form make translation and interpretation unusually contested.",
    featured: 0,
    featuredNote: "",
    refScheme: "Yasna and verse",
    chapters: [],
    passages: [],
    editions: [],
    availabilityNote:
      "No text is displayed in this build. A reliable Avestan edition and a public-domain translation are under review; no unverified quotation is presented as scripture.",
  },
];

const report: string[] = [];
for (const w of works) {
  const file = join(OUT, `${w.slug}.json`);
  writeFileSync(file, JSON.stringify(w, null, 2) + "\n");
  const editionCount = w.editions?.length ?? 0;
  const passageCount = w.passages?.length ?? 0;
  report.push(`${w.slug}: ${editionCount} editions, ${passageCount} passages`);
}
console.log(report.join("\n"));
