import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");
const STREAMS = join(ROOT, "data", "registry", "streams.json");
const FUNCTIONS = join(ROOT, "data", "corpus", "text-functions.json");
const MANIFEST = join(ROOT, "data", "imports", "srigranth.json");
const DOCX = join(ROOT, "data", "imports", "cache", "srigranth", "sggs-sbs-uni.docx");
const WORK_SLUG = "guru-granth-sahib";
const TOTAL_ANGS = 1430;
const RETRIEVED_AT = new Date().toISOString().slice(0, 10);

const args = process.argv.slice(2);
const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0);
const dryRun = args.includes("--dry-run");

type Sentence = { gurmukhi: string; transliteration: string; english: string };
type Ang = { ang: number; sentences: Sentence[] };
type Row = Record<string, any>;

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

// ---------------------------------------------------------------------------
// The source is the sentence-by-sentence DOCX published with the Gurbani-CD
// files: Gurmukhi, Kulbir Singh Thind's phonetic transliteration and Sant
// Singh Khalsa's English, one paragraph per unit. Reading it needs only the
// one ZIP member that holds the document, so a minimal reader avoids a
// dependency and keeps the import reproducible from the cached file.
// ---------------------------------------------------------------------------
function readZipEntry(file: string, entryName: string): Buffer {
  const buf = readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${file} is not a ZIP archive`);
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error("corrupt ZIP central directory");
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (name === entryName) {
      const localNameLength = buf.readUInt16LE(localOffset + 26);
      const localExtraLength = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const data = buf.subarray(start, start + compressedSize);
      return method === 0 ? data : inflateRawSync(data);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`${entryName} not found in ${file}`);
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name) => named[name.toLowerCase()] ?? whole);
}

function paragraphText(xml: string): string {
  // Runs are joined without a separator: Word splits a single word across runs
  // for proofing and language marks. A tab or line break, however, separates
  // words and becomes a space so the two sides do not fuse.
  const pieces = xml.match(/<w:t[^>]*>[\s\S]*?<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g) ?? [];
  const joined = pieces
    .map((piece) => (piece.startsWith("<w:t") ? piece.replace(/<[^>]+>/g, "") : " "))
    .join("");
  return decodeEntities(joined).replace(/\s+/g, " ").trim();
}

const STYLE = /<w:pStyle w:val="([^"]+)"/;

export function parseDocument(documentXml: string): Ang[] {
  const angs: Ang[] = [];
  let current: Ang | null = null;
  let pending: { gurmukhi: string; transliteration: string; english: string } | null = null;

  for (const paragraph of documentXml.split(/<w:p[ >]/).slice(1)) {
    const style = STYLE.exec(paragraph)?.[1] ?? "";
    const text = paragraphText(paragraph);

    if (style === "PannaNumber") {
      const match = /^Page\s+(\d+)$/i.exec(text);
      if (!match) throw new Error(`unreadable page label: ${JSON.stringify(text)}`);
      const ang = Number(match[1]);
      if (ang !== angs.length + 1) throw new Error(`expected ang ${angs.length + 1}, found ${ang}`);
      current = { ang, sentences: [] };
      angs.push(current);
      continue;
    }
    if (style === "SGGSText2") {
      if (!current) throw new Error(`Gurmukhi text before the first page: ${text.slice(0, 40)}`);
      if (pending) throw new Error(`ang ${current.ang}: Gurmukhi line without an English translation`);
      pending = { gurmukhi: text, transliteration: "", english: "" };
      continue;
    }
    if (style === "Romanizing") {
      if (!pending) throw new Error(`ang ${current?.ang}: transliteration without a Gurmukhi line`);
      pending.transliteration = text;
      continue;
    }
    if (style === "TranslationText") {
      if (!pending) throw new Error(`ang ${current?.ang}: translation without a Gurmukhi line`);
      pending.english = text;
      current!.sentences.push(pending);
      pending = null;
    }
  }
  if (pending) throw new Error(`ang ${current?.ang}: last sentence is incomplete`);
  return angs;
}

function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

function build(angs: Ang[]) {
  const chapters: Row[] = [];
  const passages: Row[] = [];
  const gurmukhiTexts: Record<string, string> = {};
  const englishTexts: Record<string, string> = {};
  let gurmukhiWords = 0;
  let englishWords = 0;
  const angRows: Row[] = [];

  for (const ang of angs) {
    const ref = String(ang.ang);
    chapters.push({ ref, label: `Ang ${ang.ang}` });
    let gWords = 0;
    let eWords = 0;
    ang.sentences.forEach((sentence, index) => {
      const passageRef = `${ref}.${index + 1}`;
      passages.push({ reference: passageRef, label: `Ang ${ang.ang} §${index + 1}`, chapterRef: ref });
      if (sentence.gurmukhi) {
        gurmukhiTexts[passageRef] = sentence.gurmukhi;
        gWords += wordCount(sentence.gurmukhi);
      }
      if (sentence.english) {
        englishTexts[passageRef] = sentence.english;
        eWords += wordCount(sentence.english);
      }
    });
    gurmukhiWords += gWords;
    englishWords += eWords;
    angRows.push({ ang: ang.ang, sentences: ang.sentences.length, gurmukhiWords: gWords, englishWords: eWords });
  }

  return { chapters, passages, gurmukhiTexts, englishTexts, gurmukhiWords, englishWords, angRows };
}

if (!existsSync(DOCX)) throw new Error(`missing source document: ${DOCX}`);
const documentXml = readZipEntry(DOCX, "word/document.xml").toString("utf8");
const allAngs = parseDocument(documentXml);
if (!limit && allAngs.length !== TOTAL_ANGS) throw new Error(`expected ${TOTAL_ANGS} angs, found ${allAngs.length}`);

const target = limit > 0 ? Math.min(limit, allAngs.length) : allAngs.length;
const angs = allAngs.slice(0, target);
const sentences = angs.reduce((n, ang) => n + ang.sentences.length, 0);
console.log(`Parsed ${angs.length} ang(s), ${sentences} sentences from ${DOCX.split(/[\\/]/).pop()}.`);

if (limit > 0) {
  console.log(JSON.stringify(angs.slice(0, 2), null, 1).slice(0, 1500));
  process.exit(0);
}

const { chapters, passages, gurmukhiTexts, englishTexts, gurmukhiWords, englishWords, angRows } = build(angs);
if (passages.length !== Object.keys(gurmukhiTexts).length) throw new Error("a passage lacks Gurmukhi text");
if (passages.length !== Object.keys(englishTexts).length) throw new Error("a passage lacks English text");
for (const ang of angs) {
  if (!ang.sentences.length) throw new Error(`ang ${ang.ang} has no sentences`);
}

const workPath = join(WORKS, `${WORK_SLUG}.json`);
const existing = existsSync(workPath) ? readJson(workPath) : {};
const work = {
  ...existing,
  slug: WORK_SLUG,
  title: "Guru Granth Sahib",
  originalTitle: "ਗੁਰੂ ਗ੍ਰੰਥ ਸਾਹਿਬ",
  transliteration: "Gurū Granth Sāhib",
  altTitles: ["Adi Granth", "Sri Guru Granth Sahib"],
  tradition: "sikhism",
  school: null,
  genre: "Scripture",
  textType: "Hymns and liturgical poetry",
  category: "Scripture",
  subcategory: "Hymns and liturgical poetry",
  originalLanguage: "pa",
  dateStart: 1604,
  dateEnd: 1708,
  dateDisplay: "Compiled 1604; final form 1708",
  authorshipStatus: "composite",
  author: "guru-nanak",
  attributionNote:
    "A compilation of hymns by Guru Nanak, the succeeding Gurus and other saints, first compiled by Guru Arjan in 1604 and given its final form by Guru Gobind Singh in 1708. It is revered as the eternal Guru in Sikh tradition.",
  description:
    "The Guru Granth Sahib is the central scripture of Sikhism: 1,430 angs of devotional hymns arranged by raga, with the compositions of Guru Nanak, the succeeding Gurus and the saints and reformers whose voices the Gurus received. This edition carries the complete Gurmukhi text and Sant Singh Khalsa's English translation, ang by ang, sentence by sentence.",
  historicalContext:
    "Guru Arjan compiled the Adi Granth in 1604; Guru Gobind Singh gave the collection its final form in 1708 and vested the Guruship in the book itself. Its hymns are organised by musical mode rather than by author, and the text is read as a living Guru, not as a historical document. The Gurmukhi text here descends from the Gurbani-CD, the transcription edited by Kulbir S. Thind, MD, for SriGranth.org; the English is Khalsa's rendering. Thind's phonetic transliteration exists in the same source file but is not imported as an edition.",
  availabilityNote:
    "Complete. All 1,430 angs are held locally in Gurmukhi with Sant Singh Khalsa's English translation, one passage per sentence. The text was acquired from the Gurbani-CD files served by SriGranth.org and gurbanifiles.net under written permission from the rights holders; the permission basis is recorded on both editions. The modern Punjabi, Hindi and Professor Sahib Singh's teeka on that site are not part of this edition.",
  featured: 0,
  featuredNote: "",
  refScheme: "ang.sentence",
  isSample: false,
  chapters,
  passages,
  editions: [
    {
      slug: "guru-granth-sahib-pa",
      language: "pa",
      editionType: "original",
      title: "Sri Guru Granth Sahib — Gurmukhi text",
      translator: "",
      publisher: "SriGranth.org / Gurbani-CD",
      publicationYear: 1708,
      source: "srigranth",
      license: "by-permission",
      rightsStatus: "Used with written permission from the rights holders; not relicensed.",
      attributionText:
        "Gurmukhi text from the Gurbani-CD of Kulbir S. Thind, MD, edited for SriGranth.org and used with written permission (2026). Digitisation credits: Kulbir S. Thind, Jaswant Singh, Baljinder Singh and the Gurbani-CD proofreaders. Do not redistribute without permission.",
      structureScheme: "one chapter per ang; passages follow the sentence-by-sentence division of the source file",
      isSample: false,
      notes:
        "Unicode Gurmukhi from the sentence-by-sentence edition. Raag headings and colophons are kept as they stand in the source; ang numbers are the source's page labels.",
      texts: gurmukhiTexts,
    },
    {
      slug: "guru-granth-sahib-en",
      language: "en",
      editionType: "translation",
      title: "Sri Guru Granth Sahib — English translation",
      translator: "Sant Singh Khalsa",
      publisher: "SriGranth.org",
      publicationYear: 2003,
      source: "srigranth",
      license: "by-permission",
      rightsStatus: "Translation © Sant Singh Khalsa; used with written permission.",
      attributionText:
        "English translation by Sant Singh Khalsa, MD (2003), published with the Gurbani-CD files and used with written permission from the rights holder (2026). Do not redistribute without permission.",
      structureScheme: "one chapter per ang; one passage per translated sentence",
      isSample: false,
      notes:
        "Khalsa's sentence-by-sentence rendering, aligned to the Gurmukhi of the same source file. Bhai Manmohan Singh's alternative translation is not included.",
      texts: englishTexts,
    },
  ],
};

if (!dryRun) {
  writeFileSync(workPath, `${JSON.stringify(work, null, 2)}\n`);

  const streams = readJson(STREAMS);
  delete streams.works[WORK_SLUG];
  writeFileSync(STREAMS, `${JSON.stringify(streams, null, 2)}\n`);

  const functions = readJson(FUNCTIONS);
  functions.works[WORK_SLUG] = {
    functions: ["canonical_scripture", "prayer_liturgy"],
    status: "provisional",
    assignedBy: "UWL editors (comparative taxonomy)",
    note:
      "Sikhs treat the Guru Granth Sahib as the living Guru, not merely as a book. The complete Gurmukhi and Khalsa English text is held locally under written permission from the Gurbani-CD rights holders.",
  };
  writeFileSync(FUNCTIONS, `${JSON.stringify(functions, null, 2)}\n`);

  const bytes = readFileSync(DOCX);
  writeFileSync(
    MANIFEST,
    `${JSON.stringify(
      {
        source: "srigranth",
        work: WORK_SLUG,
        generated_at: new Date().toISOString(),
        retrieved_at: RETRIEVED_AT,
        file: {
          name: "Gurmukhi to English translation & transliterat of SGGS, SBS (Uni).docx",
          url: "https://www.gurbanifiles.net/translations/",
          bytes: bytes.length,
          sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
        },
        permission:
          "Acquired under written permission from the rights holders (Kulbir S. Thind / Gurbani-CD and Sant Singh Khalsa). The permission letter is held by the project owner and is not stored in this repository.",
        editions: ["guru-granth-sahib-pa (Gurmukhi)", "guru-granth-sahib-en (Sant Singh Khalsa)"],
        totals: {
          angs: chapters.length,
          passages: passages.length,
          gurmukhiWords,
          englishWords,
        },
        angs: angRows,
      },
      null,
      2,
    )}\n`,
  );
}

console.log(
  `${WORK_SLUG}: ${chapters.length} angs, ${passages.length} passages, ` +
    `${gurmukhiWords.toLocaleString()} Gurmukhi words, ${englishWords.toLocaleString()} English words`,
);
