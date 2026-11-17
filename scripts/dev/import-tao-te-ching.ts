// Imports the complete Daodejing: the eighty-one chapters of the received text,
// in Wang Bi's Chinese recension (Wikisource) and James Legge's English
// translation (Project Gutenberg eBook #216, 1891).
//
// The Daodejing is held locally rather than streamed: the two editions are
// aligned chapter by chapter so the reader can show the Chinese and the
// English in parallel, and the work carries one passage per chapter because
// "Daodejing 1" and "Daodejing 81" are the units the rest of the corpus cites.
//
//   bun run scripts/dev/import-tao-te-ching.ts
//
// Output:
//   data/corpus/works/tao-te-ching.json
//   data/imports/tao-te-ching.json   (provenance, checksums, chapter counts)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchGutenbergText } from "../../ingest/adapters/gutenberg";
import { ROOT } from "../../server/db";

const USER_AGENT = "UniversalWisdomLibrary/1.0 (local reading interface; Daodejing import)";
const WIKISOURCE_PAGE = "道德經 (王弼本)";
const WIKISOURCE_URL = `https://zh.wikisource.org/wiki/${encodeURIComponent(WIKISOURCE_PAGE)}`;
const CHAPTER_COUNT = 81;

function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Legge, The Tao Teh King (Project Gutenberg #216)
// ---------------------------------------------------------------------------

/**
 * Legge prints each chapter under its number: "1. 1. The Tao that…" for the
 * chapters he numbers verse by verse, "6." on a line of its own where the
 * chapter is a single rhymed stanza, and "11. The thirty spokes…" where the
 * chapter runs on from the numeral. A verse number inside a chapter can also
 * stand at the start of a line, so a line is only taken as a chapter opening
 * when its number is the one the sequence expects next.
 */
export function leggeChapters(source: string): string[] {
  const text = source.replace(/\r\n/g, "\n");
  const start = text.indexOf("Ch. 1. 1.");
  if (start < 0) throw new Error("The Gutenberg file does not open the Tao Teh King at chapter 1");
  const end = text.indexOf("*** END OF THE PROJECT GUTENBERG");
  const body = text.slice(start, end > start ? end : text.length);
  const lines = body.split("\n");
  const openings: number[] = [];
  let expected = 1;
  for (const [index, line] of lines.entries()) {
    const match = /^(?:Ch\.\s*)?(\d{1,2})\.(\s|$)/.exec(line);
    if (!match || Number(match[1]) !== expected) continue;
    const rest = line.slice(match[0].length);
    const numbered = /^1\.\s/.test(rest);
    const bare = rest.trim() === "";
    // From chapter 11 the numeral runs straight into the text; before that a
    // bare verse number would be ambiguous with the chapter number.
    if (numbered || bare || expected > 10) {
      openings.push(index);
      expected++;
    }
  }
  if (openings.length !== CHAPTER_COUNT) {
    throw new Error(`Legge's text yielded ${openings.length} chapters, not ${CHAPTER_COUNT}`);
  }
  return openings.map((from, index) => {
    const to = openings[index + 1] ?? lines.length;
    const chapter = lines
      .slice(from, to)
      .join("\n")
      .replace(/^(?:Ch\.\s*)?\d{1,2}\.\s*/, "")
      .trim();
    // A page break inside a chapter leaves a run of several blank lines.
    return chapter.replace(/\n{3,}/g, "\n\n");
  });
}

// ---------------------------------------------------------------------------
// Wang Bi's Chinese text (Wikisource)
// ---------------------------------------------------------------------------

const CHINESE_NUMERALS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** "八十一" → 81, "三十六" → 36, "十" → 10. */
export function chineseNumber(text: string): number {
  let total = 0;
  let current = 0;
  for (const character of text) {
    if (character === "十") {
      total += (current || 1) * 10;
      current = 0;
    } else if (character === "百") {
      total += (current || 1) * 100;
      current = 0;
    } else {
      const digit = CHINESE_NUMERALS[character];
      if (digit == null) throw new Error(`Cannot read the numeral “${text}”`);
      current = digit;
    }
  }
  return total + current;
}

function wikitextToChinese(wikitext: string): string {
  const lines = wikitext
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    // Wang Bi's interlinear commentary sits on indented lines that open with a
    // colon; the templates and reference blocks are volume apparatus.
    .filter((line) => line && !line.startsWith(":") && !line.startsWith("{{") && !line.startsWith("|"))
    // Headings of the volume's own apparatus (the colophons after chapter 81).
    .filter((line) => !/^=.+=$/.test(line) && !/^=+$/.test(line));
  return lines
    .join("\n")
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, "")
    .trim();
}

/** The eighty-one chapters of the Wang Bi recension, in order. */
export function wangBiChapters(wikitext: string): string[] {
  const headings = [...wikitext.matchAll(/^==\s*([一二三四五六七八九十百]+)章\s*==\s*$/gm)];
  // The volume's own apparatus (colophon, sound glossaries, notes) follows the
  // last chapter under its own headings; a chapter ends at the next heading of
  // any kind, not only at the next numbered chapter.
  const sectionStarts = [...wikitext.matchAll(/^=+[^=]/gm)].map((match) => match.index ?? 0);
  const chapters: string[] = [];
  for (const heading of headings) {
    const number = chineseNumber(heading[1] ?? "");
    if (number > CHAPTER_COUNT) continue;
    const from = (heading.index ?? 0) + heading[0].length;
    const to = sectionStarts.find((start) => start > (heading.index ?? 0)) ?? wikitext.length;
    const body = wikitextToChinese(wikitext.slice(from, to));
    if (!body) throw new Error(`Chapter ${number} of the Chinese text is empty`);
    chapters[number - 1] = body;
  }
  const missing = chapters.map((chapter, index) => (chapter ? "" : String(index + 1))).filter(Boolean);
  if (missing.length) throw new Error(`The Chinese text is missing chapters ${missing.join(", ")}`);
  return chapters;
}

async function fetchWangBiWikitext(): Promise<string> {
  const url =
    "https://zh.wikisource.org/w/api.php?action=parse&prop=wikitext&format=json&formatversion=2&page=" +
    encodeURIComponent(WIKISOURCE_PAGE);
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" } });
  if (!res.ok) throw new Error(`Wikisource returned HTTP ${res.status}`);
  const body = (await res.json()) as { parse?: { wikitext?: string }; error?: { info?: string } };
  const wikitext = body.parse?.wikitext;
  if (!wikitext) throw new Error(`Wikisource returned no wikitext: ${body.error?.info ?? "unknown error"}`);
  return wikitext;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const englishSource = await fetchGutenbergText(216);
const english = leggeChapters(englishSource);
const chineseSource = await fetchWangBiWikitext();
const chinese = wangBiChapters(chineseSource);

for (const [index, text] of english.entries()) {
  if (text.split(/\s+/).filter(Boolean).length < 20) {
    throw new Error(`Chapter ${index + 1} of Legge's translation is implausibly short`);
  }
  if (text.includes("*** END OF")) throw new Error(`Chapter ${index + 1} runs into the Gutenberg footer`);
}
for (const [index, text] of chinese.entries()) {
  if (text.replace(/\s/g, "").length < 20) throw new Error(`Chapter ${index + 1} of the Chinese text is implausibly short`);
}

const chapters = Array.from({ length: CHAPTER_COUNT }, (_, index) => ({
  ref: String(index + 1),
  label: `Chapter ${index + 1}`,
}));
const passages = chapters.map((chapter) => ({
  reference: chapter.ref,
  label: `Chapter ${chapter.ref}`,
  chapterRef: chapter.ref,
}));
const englishTexts = Object.fromEntries(chapters.map((chapter, index) => [chapter.ref, english[index] ?? ""]));
const chineseTexts = Object.fromEntries(chapters.map((chapter, index) => [chapter.ref, chinese[index] ?? ""]));

const work = {
  slug: "tao-te-ching",
  title: "Tao Te Ching",
  originalTitle: "道德經",
  transliteration: "Daodejing",
  altTitles: ["Daodejing", "Laozi", "The Classic of the Way and Virtue", "Lao Tzu"],
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
    "Traditionally attributed to Laozi. The text is generally regarded as composite, with layers composed over several centuries. The received 81-chapter edition is later than the oldest manuscript witnesses, and the Guodian and Mawangdui manuscripts differ from it in order and wording.",
  description:
    "The Daodejing is the foundational classic of Daoist thought and one of the most translated books in the world: eighty-one short chapters on the Dao that cannot be named, on non-striving (wuwei), softness and water, emptiness and use, the sage's government and the plain life of the small state. Its aphorisms move between cosmology, ethics and politics, and its paradoxical style has been read as mysticism, as statecraft and as a philosophy of life. This edition carries the complete text in Wang Bi's Chinese recension with James Legge's 1891 translation beside it, chapter for chapter.",
  historicalContext:
    "The text arose in the Warring States period and was transmitted with commentaries in Daoist and imperial contexts. Wang Bi's third-century commentary became the standard received edition; manuscripts from Guodian (c. 300 BCE) and Mawangdui (c. 168 BCE) have reshaped scholarly understanding of its formation. Legge's translation, printed in the Sacred Books of the East in 1891, was the first complete English rendering of the whole book and remains the standard Victorian witness to the text.",
  availabilityNote:
    "Complete. All eighty-one chapters are held locally in two editions: the Chinese text of Wang Bi's recension, with modern punctuation and without his interlinear commentary, and Legge's complete English translation. Each chapter is one passage, so the two editions line up chapter by chapter for parallel reading.",
  featured: 1,
  featuredNote: "The Way, water and emptiness",
  refScheme: "chapter",
  isSample: false,
  chapters,
  passages,
  editions: [
    {
      slug: "tao-zh-wangbi",
      language: "zh",
      editionType: "original",
      title: "老子道德經 (王弼本)",
      publisher: "Wang Bi recension, via Wikisource",
      publicationYear: null,
      source: "wikisource",
      license: "public-domain",
      rightsStatus: "Public domain",
      attributionText:
        "老子道德經, Wang Bi recension (王弼本), via Wikisource (道德經 (王弼本)). Public domain. Punctuation is the transcription's; Wang Bi's interlinear commentary is not included.",
      structureScheme: "chapter",
      isSample: false,
      notes:
        "Wang Bi's third-century edition and commentary established the received text. This transcription supplies modern punctuation and is reproduced without the commentary, so the chapter is the classic itself. Chapter headings are the received numbering, not titles.",
      texts: chineseTexts,
    },
    {
      slug: "tao-en-legge",
      language: "en",
      editionType: "translation",
      title: "The Tao Teh King, or the Tao and its Characteristics",
      translator: "James Legge",
      publisher: "Project Gutenberg eBook #216",
      publicationYear: 1891,
      source: "project-gutenberg",
      license: "public-domain",
      rightsStatus: "Public domain in the United States",
      attributionText:
        "The Tao Teh King, or the Tao and its Characteristics, translated by James Legge (1891), Sacred Books of the East, vol. 39. Public domain in the United States. Plain text from Project Gutenberg eBook #216.",
      structureScheme: "chapter",
      isSample: false,
      notes:
        "Legge numbers the verses within each chapter, and those numbers are kept. His translation is literal and Victorian, with transliterated Chinese terms; Legge's notes and introduction are not part of the work. The Gutenberg transcription prints a few chapters as a single rhymed stanza, which is Legge's own verse paraphrase rather than a separate poem.",
      texts: englishTexts,
    },
  ],
  category: "Philosophy",
  subcategory: "Daoist classics",
};

const words = (texts: Record<string, string>) =>
  Object.values(texts).reduce((sum, text) => sum + text.split(/\s+/).filter(Boolean).length, 0);
const characters = (texts: Record<string, string>) =>
  Object.values(texts).reduce((sum, text) => sum + text.replace(/\s/g, "").length, 0);

writeFileSync(join(ROOT, "data", "corpus", "works", "tao-te-ching.json"), `${JSON.stringify(work, null, 2)}\n`);

mkdirSync(join(ROOT, "data", "imports"), { recursive: true });
writeFileSync(
  join(ROOT, "data", "imports", "tao-te-ching.json"),
  `${JSON.stringify(
    {
      source: "project-gutenberg + wikisource",
      retrieved_at: new Date().toISOString().slice(0, 10),
      note:
        "The complete Daodejing: Legge's translation from Project Gutenberg eBook #216 and the Chinese text of Wang Bi's recension from Wikisource. Both are public domain. The work file holds the text locally because the two editions are read in parallel and the corpus cites the book by chapter.",
      works: [
        {
          slug: "tao-te-ching",
          title: "Tao Te Ching",
          chapters: CHAPTER_COUNT,
          passages: CHAPTER_COUNT,
          editions: [
            {
              slug: "tao-zh-wangbi",
              language: "zh",
              source: "wikisource",
              source_url: WIKISOURCE_URL,
              page: WIKISOURCE_PAGE,
              characters: characters(chineseTexts),
              checksum: sha256(JSON.stringify(chineseTexts)),
            },
            {
              slug: "tao-en-legge",
              language: "en",
              source: "project-gutenberg",
              source_url: "https://www.gutenberg.org/ebooks/216.txt.utf-8",
              ebook: 216,
              words: words(englishTexts),
              checksum: sha256(JSON.stringify(englishTexts)),
            },
          ],
          validation: "aligned",
        },
      ],
      totals: {
        works: 1,
        chapters: CHAPTER_COUNT,
        passages: CHAPTER_COUNT,
        words: words(englishTexts),
        characters: characters(chineseTexts),
      },
    },
    null,
    2,
  )}\n`,
);

console.log("Tao Te Ching: 81 chapters in two editions");
console.log(`  ${words(englishTexts).toLocaleString()} English words (Legge, 1891)`);
console.log(`  ${characters(chineseTexts).toLocaleString()} Chinese characters (Wang Bi recension)`);
