// OpenITI mARkdown.
//
// The OpenITI century repositories publish Arabic works as mARkdown: one line
// per source line, `### |` / `### ||` headings, `#` starting a paragraph and
// `~~` continuing the one before it. Page markers (`PageV01P012`) and Shamela
// line ids (`ms0001`) sit inside the text. This module turns that into the
// sections and paragraphs the reader can serve.
//
// Only text is read here; nothing is written to the database. The importer uses
// the same function to count paragraphs, so the index and the served text
// cannot drift apart.

export type OpenitiSection = {
  /** Heading depth, taken from the number of pipes in the heading marker. */
  level: number;
  title: string;
  paragraphs: string[];
};

function clean(value: string): string {
  return value
    .replace(/PageV\d+P\d+/g, " ")
    .replace(/\bms\d+\b/g, " ")
    .replace(/@Q[BE]@/g, " ")
    .replace(/~~/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([،؛:,.!?])/g, "$1")
    .trim();
}

function headingTitle(value: string): string {
  let title = clean(value);
  // Some transcriptions repeat the heading marker after a conversion tag
  // (`### || AUTO ### || AUTO فصل`). Peel the wrappers until none remain.
  for (let i = 0; i < 4; i++) {
    const next = title
      .replace(/^(AUTO|CHECK|PARATEXT|EDITOR)\s*\|?\s*/i, "")
      .replace(/^#{1,6}\s+/, "")
      .replace(/^\|+\s*/, "")
      .trim();
    if (next === title) break;
    title = next;
  }
  const bracketed = title.match(/^\[(.*)\]$/);
  if (bracketed) title = bracketed[1]!.trim();
  // OpenITI often appends the printed book number to the heading.
  title = title.replace(/\s+\d+$/, "").trim();
  // Skip transcriptions' decorative headings (dotted rules, bare numbers).
  return /\p{L}/u.test(title) ? title : "";
}

/**
 * Every heading starts a new section. Grouping into readable chapters is a
 * separate step, because sources differ: a legal manual has books, a tafsir
 * has surahs and verse headings, and a short treatise has only sections.
 */
export function parseOpeniti(text: string): OpenitiSection[] {
  const sections: OpenitiSection[] = [];
  let current: OpenitiSection | null = null;
  let paragraph: string[] = [];

  const flush = () => {
    const body = clean(paragraph.join(" "));
    paragraph = [];
    if (body && current) current.paragraphs.push(body);
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\u00a0/g, " ").trimEnd();
    if (!line.trim() || line.startsWith("#META#") || line.startsWith("######OpenITI")) continue;

    const heading = line.match(/^(#{1,6})\s+(\|+)\s*(.*)$/);
    if (heading) {
      flush();
      const title = headingTitle(heading[3] ?? "");
      // A decorative heading ends the current paragraph but does not open a
      // section, so the text that follows stays with its chapter.
      if (!title) continue;
      current = { level: heading[2]!.length, title, paragraphs: [] };
      sections.push(current);
      continue;
    }

    if (line.startsWith("~~")) {
      paragraph.push(line.replace(/^~~+\s*/, ""));
      continue;
    }

    // Page markers are written as a `#` line in some transcriptions.
    if (/^#\s+PageV\d+P\d+\s*$/.test(line)) continue;

    if (line.startsWith("#")) {
      flush();
      const body = line.replace(/^#+\s*/, "");
      if (body.trim()) paragraph.push(body);
      continue;
    }

    if (current) paragraph.push(line);
  }
  flush();

  return sections;
}

/**
 * Collapse a flat section list into chapters. A heading whose title matches
 * `chapterPattern` opens a chapter; every section until the next match belongs
 * to it. Nested headings are kept as paragraphs so the text keeps its shape.
 */
export function groupOpeniti(
  sections: OpenitiSection[],
  chapterPattern: RegExp,
): OpenitiSection[] {
  const chapters: OpenitiSection[] = [];
  let current: OpenitiSection | null = null;

  for (const section of sections) {
    if (chapterPattern.test(section.title)) {
      current = { level: 1, title: section.title, paragraphs: [...section.paragraphs] };
      chapters.push(current);
      continue;
    }
    if (!current) continue;
    if (section.title) current.paragraphs.push(section.title);
    current.paragraphs.push(...section.paragraphs);
  }

  return chapters.filter((chapter) => chapter.paragraphs.length > 0);
}

/**
 * Start a chapter at every heading down to `maxLevel`; deeper headings stay in
 * the text as paragraphs. Used for sources whose headings already form a
 * usable table of contents.
 */
export function selectOpeniti(
  sections: OpenitiSection[],
  maxLevel: number,
): OpenitiSection[] {
  const chapters: OpenitiSection[] = [];
  let current: OpenitiSection | null = null;

  for (const section of sections) {
    if (section.level <= maxLevel) {
      current = { level: section.level, title: section.title, paragraphs: [...section.paragraphs] };
      chapters.push(current);
      continue;
    }
    if (!current) continue;
    if (section.title) current.paragraphs.push(section.title);
    current.paragraphs.push(...section.paragraphs);
  }

  return chapters.filter((chapter) => chapter.paragraphs.length > 0);
}

/** Apply the chapter rule stored on a streamed work's config. */
export function openitiChapters(
  sections: OpenitiSection[],
  rule: { mode: "level"; level: number } | { mode: "pattern"; pattern: string },
): OpenitiSection[] {
  return rule.mode === "level"
    ? selectOpeniti(sections, rule.level)
    : groupOpeniti(sections, new RegExp(rule.pattern));
}
