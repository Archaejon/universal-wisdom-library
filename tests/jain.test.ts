// The Jainism shelf is four streamed works of Jacobi's Jaina Sutras, read from
// sacred-texts.com one printed chapter at a time. These checks hold three things
// together that would otherwise drift apart silently: the cleaning rules that
// take the scan's page numbers out of the text, the chapter outline the volume
// prints, and the passage index the reader resolves a citation against.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sacredTextsPage, svelteKitData } from "../server/stream";
import { contentsRows, ordinalValue } from "../scripts/dev/import-jain";

const ROOT = join(import.meta.dir, "..");
const readJson = (path: string) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

const streams = readJson("data/registry/streams.json") as {
  works: Record<
    string,
    {
      provider: string;
      licence: string;
      config: { book: string; chapters: Record<string, { label: string; pages: string[] }> };
      editions: { slug: string; license: string; sourceUrl: string }[];
    }
  >;
};

type Work = {
  slug: string;
  tradition: string;
  school: string;
  textStorage?: string;
  isSample?: boolean;
  refScheme: string;
  chapters: { ref: string; label: string }[];
  passages: { reference: string; label: string; chapterRef: string }[];
  editions: {
    slug: string;
    source: string;
    license: string;
    translator: string;
    publicationYear: number;
    rightsStatus: string;
  }[];
};

const WORKS: [slug: string, chapters: number][] = [
  ["acaranga-sutra", 24],
  ["kalpa-sutra", 11],
  ["uttaradhyayana-sutra", 36],
  ["sutrakritanga", 23],
];

describe("sacred-texts: cleaning a reading view", () => {
  test("drops the printed page number and rejoins the paragraph a turn cut in two", () => {
    const html =
      "<h2>SECOND PART.</h2> <p>I shall choose something inanimate, and lean</p>" +
      " <p> </p> <p> </p> <p><a>p. 179</a></p>" +
      " <p>against it; changing the position of the body. (2)</p> <p>This is the second rule. (3)</p>";
    const page = sacredTextsPage(html);
    expect(page.headings).toEqual(["SECOND PART."]);
    expect(page.pages).toEqual([179]);
    expect(page.rejoined).toBe(1);
    expect(page.segments).toEqual([
      "I shall choose something inanimate, and lean against it; changing the position of the body. (2)",
      "This is the second rule. (3)",
    ]);
  });

  test("takes a turn that prints two numbers at once", () => {
    const html = "<p><a>p. 216</a> <a>p. 217</a></p> <p>Obeisance to the Arhats!</p>";
    const page = sacredTextsPage(html);
    expect(page.pages).toEqual([216, 217]);
    expect(page.segments).toEqual(["Obeisance to the Arhats!"]);
  });

  test("puts a word hyphenated over the page back together", () => {
    const html = "<p>the mendicant should not postu-</p> <p><a>p. 12</a></p> <p>re in the road.</p>";
    expect(sacredTextsPage(html).segments).toEqual(["the mendicant should not posture in the road."]);
  });

  test("removes the footnote markers with the notes they point at", () => {
    const html =
      '<p>conceit <a href="#fn-p33-sbe4532-2" id="fnref" data-footnote-ref="174:2">2</a>, and delusion ' +
      '<a href="/book/jaina-sutras-part-ii/x#fn_520">3</a>.</p>' +
      '<p>End of the First Lecture <a href="/book/jaina-sutras-part-i/y#fn_521">2</a>.</p>';
    expect(sacredTextsPage(html).segments).toEqual([
      "conceit, and delusion.",
      "End of the First Lecture.",
    ]);
  });

  test("drops the rules the printer drew as a line", () => {
    const html = "<p>Thus I say.</p> <p>_______________________</p> <p>The End.</p>";
    expect(sacredTextsPage(html).segments).toEqual(["Thus I say.", "The End."]);
  });

  test("leaves two paragraphs apart when no page turned between them", () => {
    const html = "<p>This is the first rule:</p> <p>I shall stand there.</p>";
    const page = sacredTextsPage(html);
    expect(page.segments).toHaveLength(2);
    expect(page.rejoined).toBe(0);
  });
});

describe("sacred-texts: reading the archive's payload", () => {
  test("resolves the flattened references of a view", () => {
    const raw = {
      nodes: [
        { type: "data", data: [] },
        { type: "data", data: [{ book: 1, chapters: 2 }, "Jaina Sutras", [3], { slug: 4 }, "book-i"] },
      ],
    };
    expect(svelteKitData(raw)).toEqual({ book: "Jaina Sutras", chapters: [{ slug: "book-i" }] });
  });

  test("reads the ordinal a volume prints", () => {
    expect(ordinalValue("FIRST")).toBe(1);
    expect(ordinalValue("NINTH")).toBe(9);
    expect(ordinalValue("TENTH")).toBe(10);
    expect(ordinalValue("TWENTIETH")).toBe(20);
    expect(ordinalValue("THIRTY-FIFTH")).toBe(35);
    expect(ordinalValue("THIRTY-SIXTH")).toBe(36);
    expect(ordinalValue("PREFACE")).toBe(0);
  });

  test("takes its chapters from the printed contents, not from the page links", () => {
    const html =
      '<tr><td colspan="3"><p><br> SÛTRAK<i>RI</i>TÂṄGA.</p></td><td><p> </p></td></tr>' +
      '<tr><td colspan="3"><p><br> FIRST BOOK.</p></td><td><p> </p></td></tr>' +
      '<tr><td><p>LECTURE</p></td><td><p>1.</p></td><td><p>The doctrine. (On some heretical doctrines)</p></td>' +
      '<td><p><a href="/book/x/book-1-lecture-1-chapter-1#page_235">235</a></p></td></tr>' +
      '<tr><td><p> </p></td><td><p> </p></td><td><p>Chapter 2. (Fatalists)</p></td>' +
      '<td><p><a href="/book/x/book-1-lecture-1-chapter-2#page_239">239</a></p></td></tr>' +
      '<tr><td><p>"</p></td><td><p>2.</p></td><td><p>The destruction of Karman; (how to lead a holy life)</p></td>' +
      '<td><p><a href="/book/x/book-1-lecture-2-chapter-1#page_249">249</a></p></td></tr>';
    expect(contentsRows(html)).toEqual([
      { work: "sutrakritanga", book: 1, lecture: 1, title: "The doctrine" },
      { work: "sutrakritanga", book: 1, lecture: 2, title: "The destruction of Karman" },
    ]);
  });
});

describe("Jainism: the four works of Jacobi's Jaina Sutras", () => {
  test.each(WORKS)("%s is a streamed work read from the archive", (slug, chapters) => {
    const work = readJson(`data/corpus/works/${slug}.json`) as Work;
    const stream = streams.works[slug]!;
    expect(work.tradition).toBe("jainism");
    expect(work.school).toBe("svetambara");
    expect(work.textStorage).toBe("streamed");
    expect(work.isSample).toBe(false);
    expect(work.chapters).toHaveLength(chapters);
    expect(stream, `${slug} has no stream entry`).toBeDefined();
    expect(stream.provider).toBe("sacred-texts-json");
    expect(stream.licence).toBe("public-domain");
    expect(Object.keys(stream.config.chapters)).toHaveLength(chapters);
    expect(work.editions[0]!.source).toBe("sacred-texts");
    expect(work.editions[0]!.license).toBe("public-domain");
    expect(work.editions[0]!.translator).toBe("Hermann Jacobi");
    expect(work.editions[0]!.rightsStatus).toContain("Public domain");
  });

  test("the Acaranga keeps its two books of lectures", () => {
    const work = readJson("data/corpus/works/acaranga-sutra.json") as Work;
    expect(work.refScheme).toBe("book.lecture.paragraph");
    expect(work.chapters[0]!.label).toBe("Book I, Lecture 1 — Knowledge of the Weapon");
    expect(work.chapters.at(-1)!.label).toBe("Book II, Lecture 16 — The Liberation");
    expect(work.chapters.filter((c) => c.ref.startsWith("1."))).toHaveLength(8);
    expect(work.chapters.filter((c) => c.ref.startsWith("2."))).toHaveLength(16);
    expect(work.passages[0]!.reference).toBe("1.1.1");
  });

  test("the Kalpa Sutra holds the five lectures of the life of Mahavira", () => {
    const work = readJson("data/corpus/works/kalpa-sutra.json") as Work;
    expect(work.chapters[0]!.label).toBe("Life of Mahâvîra");
    expect(work.chapters.slice(0, 5).map((c) => c.label)).toEqual([
      "Life of Mahâvîra",
      "Life of Mahâvîra, Lecture 2",
      "Life of Mahâvîra, Lecture 3",
      "Life of Mahâvîra, Lecture 4",
      "Life of Mahâvîra, Lecture 5",
    ]);
    expect(work.chapters.at(-1)!.label).toBe("RULES FOR YATIS");
    expect(work.chapters.map((c) => c.ref)).toEqual(
      Array.from({ length: 11 }, (_, index) => String(index + 1)),
    );
  });

  test("the Uttaradhyayana runs through its thirty-six lectures in order", () => {
    const work = readJson("data/corpus/works/uttaradhyayana-sutra.json") as Work;
    expect(work.refScheme).toBe("lecture.paragraph");
    expect(work.chapters.map((c) => c.ref)).toEqual(
      Array.from({ length: 36 }, (_, index) => String(index + 1)),
    );
    expect(work.chapters[0]!.label).toBe("Lecture 1 — On discipline");
    expect(work.chapters[29]!.label).toBe("Lecture 30 — The road of penance");
    expect(work.chapters.at(-1)!.label).toStartWith("Lecture 36 — ");
  });

  test("the Sutrakritanga keeps its two books of sixteen and seven lectures", () => {
    const work = readJson("data/corpus/works/sutrakritanga.json") as Work;
    expect(work.chapters[0]!.label).toBe("Book I, Lecture 1 — The doctrine");
    expect(work.chapters.filter((c) => c.ref.startsWith("1."))).toHaveLength(16);
    expect(work.chapters.filter((c) => c.ref.startsWith("2."))).toHaveLength(7);
    expect(work.chapters.at(-1)!.label).toBe("Book II, Lecture 7 — Nâlandâ");
  });

  // The import cache (data/imports/cache) is not in git, so these comparisons
  // run only where the importer has been run.
  const hasCache = existsSync(join(ROOT, "data/imports/cache/sacred-texts-json"));
  test.skipIf(!hasCache).each(WORKS)("%s is indexed exactly as the views were reviewed", (slug, chapters) => {
    const work = readJson(`data/corpus/works/${slug}.json`) as Work;
    const cache = readJson(`data/imports/cache/sacred-texts-json/${slug}.json`) as {
      provider: string;
      chapters: { ref: string; label: string; segments: string[] }[];
    };
    expect(cache.provider).toBe("sacred-texts-json");
    expect(cache.chapters).toHaveLength(chapters);
    const byChapter = new Map<string, string[]>();
    for (const passage of work.passages) {
      const list = byChapter.get(passage.chapterRef) ?? [];
      list.push(passage.reference);
      byChapter.set(passage.chapterRef, list);
    }
    expect(byChapter.size).toBe(chapters);
    for (const chapter of cache.chapters) {
      const references = byChapter.get(chapter.ref)!;
      expect(references).toHaveLength(chapter.segments.length);
      chapter.segments.forEach((segment, index) => {
        expect(references[index]).toBe(`${chapter.ref}.${index + 1}`);
        // The cleaning pass is the promise of this shelf: no printed page
        // number, no rule of underscores and no markup reaches the index.
        expect(segment).not.toMatch(/^p\.\s*\d/i);
        expect(segment).not.toMatch(/^[_.~*=+-]{4,}$/);
        expect(segment).not.toContain("<");
        expect(segment).not.toMatch(/\s[,.;:!?]/);
        expect(segment.trim()).toBe(segment);
        expect(segment.length).toBeGreaterThan(1);
      });
    }
    // The reading views a chapter names are the pages the reader will ask for,
    // and every one of them was reviewed at import time.
    const stream = streams.works[slug]!;
    const dir = join(ROOT, "data", "imports", "cache", "sacred-texts-json", "views", stream.config.book);
    for (const chapter of work.chapters) {
      const section = stream.config.chapters[chapter.ref]!;
      expect(section, `${slug} ${chapter.ref} has no address`).toBeDefined();
      expect(section.label).toBe(chapter.label);
      expect(section.pages.length).toBeGreaterThan(0);
      for (const page of section.pages) {
        expect(existsSync(join(dir, `${page}.json`)), `${slug} ${chapter.ref}: ${page} was never read`).toBe(true);
      }
    }
  });
});
