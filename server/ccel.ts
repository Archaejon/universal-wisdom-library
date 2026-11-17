// Reading a Christian Classics Ethereal Library plain-text file.
//
// The site publishes each work it can as one plain-text file
// (`/ccel/a/<author>/<work>/cache/<work>.txt`): a catalogue card, then the text
// with its print wrappings reduced to headings and blank lines, then the site's
// own index of scriptural references. Three things divide those files:
//
//   - a heading line — `BOOK ONE`, `CHAPTER I`, `SERMON V`, `THE APOLOGY` —
//     which opens a division of the work, and often nests (a chapter inside a
//     book, a question inside a treatise);
//   - the section markers of the site's own XML, which a few files keep
//     (`/ccel/schaff/anf03.iv.i.html`, with the section's title on the line
//     above). In a volume of collected works this is what separates one work
//     from the next, and in the rest of the corpus it does not appear;
//   - in the Bible files, a line naming the chapter (`Genesis 1`) above verses
//     marked `^1In the beginning…`.
//
// Blank lines separate paragraphs everywhere. This module turns such a file
// into chapters and paragraphs; the importer is its only caller, and the
// library stores the result rather than asking ccel.org again.

/**
 * A title reduced to the words it is known by: `The Confessions of St.
 * Augustine (1901)` and `confessions of st augustine` agree.
 */
export function normalizeTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\((?:[^()]*)\)/g, " ")
    .replace(/^(?:anf|npnf)\d*(?:-\d+)?\.?\s*/i, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\b(?:the|a|an|of|and|or|to|in|on|by|for|its|his|her)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether a file's own title is the title that was asked for. Several of the
 * site's catalogue entries are sections of a collected volume — `anonymous/
 * acts_xanthippe` is a chapter of ANF09 — and the plain text the site serves
 * for them is the whole volume's. One title is then the other's beginning (the
 * volume's card leads with the volume's title, which the section's title is
 * not), and a work whose file belongs to another work is recorded as a lead
 * rather than stored under the wrong name.
 */
export function titlesAgree(cardTitle: string, rowTitle: string): boolean {
  const card = normalizeTitle(cardTitle);
  const row = normalizeTitle(rowTitle);
  if (!card || !row) return true;
  return card === row || card.startsWith(row) || row.startsWith(card);
}

export type CcelChapter = { label: string; paragraphs: string[]; verses?: number[] };
export type CcelRefScheme = "chapter.paragraph" | "chapter.verse";
export type CcelText = { chapters: CcelChapter[]; scheme: CcelRefScheme };

const RULE = /^\s*_{5,}\s*$/;
// A line of nothing but rules or punctuation is the print edition's ornament.
const ORNAMENT = /^[\s\-=~*_.·•–—―]+$/;
// The site's index headings are whole lines and name what they index — `INDEX`,
// `Indexes`, `Index of Scripture References`, `Index of Pages of the Print
// Edition`. A wrapped line that happens to end in the word `Index.` is prose,
// not a heading, which is why the bare word is not enough.
const INDEX_HEADING =
  /^\s*(?:index(?:es)?|general index|scripture index|subject index|index of [a-z][\w'’. -]*)\s*$/i;
// The site's own file links: the scriptural index prints them, and the section
// markers carry them. `isCcelMarker` and `withoutCcelApparatus` tell them apart.
const CCEL_LINK = /file:\/\/\/ccel\//i;
const SECTION_MARKER = /^(.*?)(\S*\/ccel\/\S+\.html)\s*$/;
const VERSE_MARKER = /\^(\d{1,3})\s?/;

/**
 * The catalogue card at the top of a file — title, creator, print basis,
 * rights, subject headings — ends with a ruled line of its own, normally the
 * second in the file. It is bibliographic apparatus, not the work.
 */
export function withoutCcelHeader(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const rules: number[] = [];
  lines.forEach((line, index) => {
    if (RULE.test(line)) rules.push(index);
  });
  const start = rules.length >= 2 ? rules[1]! + 1 : 0;
  return lines.slice(start);
}

/**
 * The catalogue card at the head of a file, field by field: `Title:`,
 * `Creator(s):`, `Print Basis:`, `Rights:`, `CCEL Subjects:`. The values wrap,
 * so a line that is not a field continues the one above it.
 */
export function ccelCard(text: string): Record<string, string> {
  const lines = text.split(/\r?\n/);
  const rules: number[] = [];
  lines.forEach((line, index) => {
    if (RULE.test(line) && rules.length < 2) rules.push(index);
  });
  const start = rules[0] ?? -1;
  const end = rules[1] ?? Math.min(lines.length, 80);
  const out: Record<string, string> = {};
  let key: string | null = null;
  for (const line of lines.slice(start + 1, end)) {
    const field = line.match(/^\s{0,12}([A-Za-z][A-Za-z0-9 ().,'’/-]{1,28}):\s*(.*)$/);
    if (field) {
      key = field[1]!.trim().toLowerCase();
      out[key] = (field[2] ?? "").replace(/\s+/g, " ").trim();
      continue;
    }
    if (key && line.trim()) out[key] = `${out[key]} ${line.trim()}`.replace(/\s+/g, " ").trim();
  }
  return out;
}

/**
 * The apparatus at the end: the site's index of scripture references, which is
 * a finding aid for the edition rather than part of the work. Its own file
 * links go with it.
 */
export function withoutCcelApparatus(lines: string[]): string[] {
  const cut = lines.findIndex((line) => line.trim().length <= 48 && INDEX_HEADING.test(line));
  const body = cut > 0 ? lines.slice(0, cut) : lines;
  return body.filter((line) => !CCEL_LINK.test(line));
}

// The words these editions use for a division, and the divisions that carry
// the ones inside them (a chapter belongs to a book, a question to a treatise).
const DIVISION_WORD =
  "book|part|volume|vol\\.?|division|treatise|chapter|chap\\.?|section|sermon|homilies?|homily|lecture|discourse|essay|meditation|letter|dialogue|canon|article|question|psalm|hymn|ode|prayer|confession|catechism|preface|introduction|prologue|epilogue|prolegomena|appendix|address|oration|tract|thesis|exposition|elucidation";
// `Chapter I.`, `Sermon 12`, `Psalm 23`, `Book IV.—Of the Trinity`: the
// division's own word, a number, and at most a short title after it.
const NUMBERED_DIVISION = new RegExp(`^(?:${DIVISION_WORD})s?\\s+(?:[IVXLCDM]+|\\d+)\\s*(?:[.—:–-]\\s*\\S.*)?$`, "i");
const CONTAINER_WORD = /^(?:book|part|volume|vol\.|division|treatise|prolegomena)s?\b/i;
const SECTION_WORD = new RegExp(`^(?:${DIVISION_WORD})s?\\b`, "i");
const ALL_CAPS = /^[A-Z0-9][A-Z0-9 ,'’\-–—:;!?()[\]&]*$/;

/**
 * A division of the work: a numbered one (`Chapter I.`, `Sermon 12`), or an
 * all-capitals line (`BOOK ONE`, `THE APOLOGY`). A line's own numbering — `II.`,
 * `Apology.`, `1. The date of the Apology` — is not one.
 */
export function isCcelHeading(line: string): boolean {
  const text = line.trim().replace(/\.$/, "");
  if (!text || text.length > 96) return false;
  const words = text.split(/\s+/);
  if (words.length > 14) return false;
  if (NUMBERED_DIVISION.test(text)) return true;
  if (!ALL_CAPS.test(text) || !/[A-Z]{2}/.test(text)) return false;
  if (words.length >= 2) return true;
  // A single all-capitals word is a division when it is a word of the
  // edition's apparatus ("ELUCIDATIONS"), not a roman numeral or a letter.
  return /^[A-Z][A-Z'-]{7,}$/.test(text) && !/^[IVXLCDM]+$/.test(text);
}

type Level = "container" | "section" | "title";

function levelOf(label: string): Level {
  if (CONTAINER_WORD.test(label)) return "container";
  if (SECTION_WORD.test(label)) return "section";
  return "title";
}

function joinLabel(container: string, section: string, fallback: string): string {
  const parts = [container, section].filter(Boolean);
  const label = parts.join(", ") || fallback;
  if (label.length <= 120) return label;
  const last = parts[parts.length - 1] ?? label;
  if (last.length <= 120) return last;
  const slice = last.slice(0, 120);
  return `${slice.slice(0, slice.lastIndexOf(" ") > 60 ? slice.lastIndexOf(" ") : 120).replace(/[,;:.\s]+$/, "")}…`;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code))).replace(
    /&[a-z#0-9]+;/gi,
    (entity) => ENTITIES[entity.toLowerCase()] ?? entity,
  );
}

function cleanParagraph(lines: string[]): string {
  const text = lines.join(" ").replace(/\s+/g, " ").trim();
  return decodeEntities(text)
    .replace(/\s*\[\d{1,3}\]/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^[\s–—-]+/, "")
    .trim();
}

/**
 * A section marker: a line ending in one of the site's own file paths, whose
 * title is on the line above (and, when it wrapped in print, on the marker line
 * itself before the path). The title line carries the volume and the work id as
 * lower-case fields — `tertullian apology anf03 tertullian-apology The Apology`
 * — so those fields are dropped and what remains is the title.
 */
export function markerTitle(line: string, recent: string[]): string | null {
  const match = line.match(SECTION_MARKER);
  if (!match) return null;
  const path = match[2]!;
  const volume = path.split("/").pop()!.split(".")[0] ?? "";
  const prefix = decodeEntities((match[1] ?? "").replace(/\s+/g, " ").trim());
  const candidate = [...recent].reverse().find((previous) => volume && new RegExp(`\\b${volume}\\b`).test(previous));
  if (!candidate) return null;
  const joined = `${candidate} ${prefix}`.replace(/\s+/g, " ").trim();
  // The marker's own fields are lower-case; the title starts at the first word
  // that is not.
  const title = joined.replace(/^(?:[a-z0-9_'-]+\s+)+/, "").trim();
  if (!title || title.length > 120) return null;
  return title.replace(/\s+([,.;:])/g, "$1");
}

function dropShort(chapters: CcelChapter[]): CcelChapter[] {
  return chapters.filter((chapter) => chapter.paragraphs.join(" ").length >= 40);
}

/**
 * A plain-text work with headings: the heading opens a chapter, a blank line
 * closes a paragraph, and the wrapped lines between are one paragraph. A
 * `BOOK` (or `PART`, `TREATISE`) heading is carried into the chapters beneath
 * it, so a chapter is named for the division it belongs to — "Book One,
 * Chapter I" — rather than for its own bare number.
 */
function parseSectioned(lines: string[], fallbackTitle: string): CcelChapter[] {
  const chapters: CcelChapter[] = [];
  let container = "";
  let section = "";
  let block: string[] = [];
  let recent: string[] = [];
  let pending = true;
  // A division is a line of its own, standing between blank lines. This is
  // what keeps a wrapped sentence that begins with a division's word —
  // "Chap. v. §1) Kölling's Geschichte der Apologetik" — from being read as one.
  let atBoundary = true;

  const flush = () => {
    const paragraph = cleanParagraph(block);
    block = [];
    if (!paragraph) return;
    if (pending || !chapters.length) {
      chapters.push({ label: joinLabel(container, section, fallbackTitle), paragraphs: [] });
      pending = false;
    }
    chapters[chapters.length - 1]!.paragraphs.push(paragraph);
  };

  for (const line of lines) {
    if (!line.trim() || ORNAMENT.test(line)) {
      flush();
      atBoundary = true;
      continue;
    }
    const marker = markerTitle(line, recent);
    if (marker && !isCcelHeading(line)) {
      // The line above a marker is the site's own record of the section — its
      // ids and its title — not text of the work, so it is taken back out of
      // the paragraph it was read into.
      while (recent.length && block.length && block[block.length - 1] === recent[recent.length - 1]) {
        block.pop();
        recent.pop();
      }
      flush();
      container = marker;
      section = "";
      pending = true;
      recent = [];
      continue;
    }
    if (atBoundary && isCcelHeading(line)) {
      flush();
      const label = decodeEntities(line.trim().replace(/\.$/, "").replace(/\s+/g, " "));
      const level = levelOf(label);
      if (level === "container") {
        container = label;
        section = "";
      } else if (level === "section") {
        section = label;
      } else if (!container) {
        container = label;
      } else {
        section = label;
      }
      pending = true;
      recent = [];
      continue;
    }
    block.push(line.trim());
    recent = [...recent.slice(-2), line.trim()];
    atBoundary = false;
  }
  flush();
  return dropShort(chapters);
}

// The Bible files: `Old Testament` and `The First Book of Moses, called
// Genesis` stand between ruled lines, a chapter is named `Genesis 1`, and its
// verses are marked `^1`, `^2`, … with no blank line between them. A book's name
// is title case with the small words of a title in lower case — `Song of Songs
// 3`, `Psalms 23` — so those words are accepted inside it; a line of prose that
// merely ends in a number is still not a chapter, because its other words are
// lower case and not among them.
const BIBLE_BOOK_WORD = "[A-Z][A-Za-z.]*|of|the|and|in|on|to|for|upon|de";
const BIBLE_CHAPTER = new RegExp(
  `^\\s*([1-3]?\\s?[A-Z][A-Za-z.]*(?:\\s+(?:${BIBLE_BOOK_WORD}))*)\\s+(\\d{1,3})\\s*$`,
);

function bibleLook(file: string[]): boolean {
  let marked = 0;
  let chapters = 0;
  for (const line of file) {
    if (VERSE_MARKER.test(line)) marked++;
    else if (BIBLE_CHAPTER.test(line)) chapters++;
  }
  return marked >= 60 && chapters >= 3;
}

function parseBible(lines: string[], fallbackTitle: string): CcelChapter[] {
  const chapters: CcelChapter[] = [];
  let block: string[] = [];
  let verses: string[] = [];
  let numbers: number[] = [];
  let verse: number | null = null;
  let chapterLabel: string | null = null;

  const flushVerse = () => {
    const paragraph = cleanParagraph(block);
    block = [];
    if (!paragraph) return;
    verses.push(paragraph);
    numbers.push(verse ?? numbers.length + 1);
  };
  const flushChapter = () => {
    flushVerse();
    if (!verses.length) return;
    chapters.push({ label: chapterLabel ?? fallbackTitle, paragraphs: verses, verses: numbers });
    verses = [];
    numbers = [];
    verse = null;
  };

  for (const line of lines) {
    if (!line.trim() || RULE.test(line) || ORNAMENT.test(line)) {
      flushVerse();
      continue;
    }
    const chapter = !VERSE_MARKER.test(line) ? line.match(BIBLE_CHAPTER) : null;
    if (chapter) {
      flushChapter();
      chapterLabel = `${chapter[1]!.replace(/\s+/g, " ").trim()} ${chapter[2]}`;
      continue;
    }
    if (!VERSE_MARKER.test(line)) {
      // A book title or a division between rule lines, either way not a verse.
      flushVerse();
      continue;
    }
    flushVerse();
    // The print edition prints the verse number before the marker as well.
    const marked = line.replace(/^\s*\d{1,3}\s+/, "");
    verse = Number(marked.match(VERSE_MARKER)?.[1] ?? 0) || null;
    block.push(marked.replace(VERSE_MARKER, "").trim());
  }
  flushChapter();
  return chapters;
}

/**
 * Read one plain-text file: its divisions, its paragraphs, and whether the
 * division is a chapter-and-paragraph or a chapter-and-verse one.
 */
export function parseCcel(text: string, fallbackTitle: string): CcelText {
  const lines = withoutCcelApparatus(withoutCcelHeader(text));
  const bible = bibleLook(lines);
  const chapters = bible ? parseBible(lines, fallbackTitle) : parseSectioned(lines, fallbackTitle);
  if (chapters.length) return { chapters, scheme: bible ? "chapter.verse" : "chapter.paragraph" };
  // Nothing in the file was long enough to be a division of a work: a title
  // page, a card and nothing else. The importer records such a work as a lead
  // rather than storing the file's wrappings as its text.
  const body = cleanParagraph(lines);
  return {
    chapters: body.length >= 200 ? [{ label: fallbackTitle, paragraphs: [body] }] : [],
    scheme: "chapter.paragraph",
  };
}

/** The old name, kept for callers that only want the chapters. */
export function parseCcelPlainText(text: string, fallbackTitle: string): CcelChapter[] {
  return parseCcel(text, fallbackTitle).chapters;
}
