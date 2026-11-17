// The Shinto shelf is two streamed chronicles. These checks keep the catalogue
// record, the chapter outline, the passage index and the reviewed page cache in
// step: a Wikisource page is addressed by its position in the stream config, so
// a page that moved or a heading that stopped being trimmed would silently
// shift every later reference.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const readJson = (path: string) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

const streams = readJson("data/registry/streams.json") as {
  works: Record<string, { provider: string; config: { pages: { ref: string; title: string }[]; trimStartPattern?: string } }>;
};

type Work = {
  slug: string;
  tradition: string;
  textStorage?: string;
  isSample?: boolean;
  refScheme: string;
  chapters: { ref: string; label: string }[];
  passages: { reference: string; label: string; chapterRef: string }[];
  editions: { slug: string; source: string; license: string; translator: string; publicationYear: number }[];
};

const WORKS: [slug: string, chapters: number][] = [
  ["kojiki", 180],
  ["nihongi", 30],
];

describe("Shinto: the Kojiki and the Nihongi", () => {
  test.each(WORKS)("%s is a streamed work with one page per printed division", (slug, chapters) => {
    const work = readJson(`data/corpus/works/${slug}.json`) as Work;
    const stream = streams.works[slug]!;
    expect(work.tradition).toBe("shinto");
    expect(work.textStorage).toBe("streamed");
    expect(work.isSample).toBe(false);
    expect(stream, `${slug} has no stream entry`).toBeDefined();
    expect(stream.provider).toBe("wikisource");
    expect(work.chapters).toHaveLength(chapters);
    expect(stream.config.pages).toHaveLength(chapters);
    // The chunker in the reader trims the printed heading with the same
    // pattern the importer used, so the pattern has to travel with the work.
    expect(stream.config.trimStartPattern).toBeString();
    expect(work.editions[0]!.source).toBe("wikisource");
    expect(work.editions[0]!.license).toBe("public-domain");
  });

  test("the Kojiki runs from the beginning of heaven and earth to Empress Suiko", () => {
    const work = readJson("data/corpus/works/kojiki.json") as Work;
    expect(work.chapters[0]!.ref).toBe("1");
    expect(work.chapters[0]!.label).toBe("Section I — The Beginning of Heaven and Earth");
    expect(work.chapters[1]!.label).toStartWith("Section II");
    expect(work.chapters.at(-1)!.label).toStartWith("Section CLXXX");
    expect(work.editions[0]!.translator).toBe("Basil Hall Chamberlain");
    expect(work.editions[0]!.publicationYear).toBe(1882);
    // Each section is a story of a paragraph or two, so the shelf is a long
    // series of short chapters rather than three undivided books.
    expect(work.passages.length).toBeGreaterThan(300);
  });

  test("the Nihongi keeps its thirty books in printed order", () => {
    const work = readJson("data/corpus/works/nihongi.json") as Work;
    expect(work.chapters[0]!.label).toBe("Book I");
    expect(work.chapters.at(-1)!.label).toBe("Book XXX");
    expect(work.chapters.map((c) => c.label)).toEqual([
      "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
      "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX",
      "XXI", "XXII", "XXIII", "XXIV", "XXV", "XXVI", "XXVII", "XXVIII", "XXIX", "XXX",
    ].map((roman) => `Book ${roman}`));
    expect(work.editions[0]!.translator).toBe("William George Aston");
  });

  test.each(WORKS)("%s fits the reviewed pages it was built from", (slug, chapters) => {
    const work = readJson(`data/corpus/works/${slug}.json`) as Work;
    const cache = readJson(`data/imports/cache/wikisource-shinto/${slug}.json`) as {
      provider: string;
      chapters: { ref: string; label: string; segments: string[] }[];
    };
    expect(cache.provider).toBe("wikisource");
    expect(cache.chapters).toHaveLength(chapters);
    const byChapter = new Map<string, string[]>();
    for (const passage of work.passages) {
      const list = byChapter.get(passage.chapterRef) ?? [];
      list.push(passage.reference);
      byChapter.set(passage.chapterRef, list);
    }
    expect(byChapter.size).toBe(chapters);
    for (const chapter of cache.chapters) {
      // The indexed page is exactly the cache's segments: no heading left in
      // front of the text, and nothing dropped between the two.
      const references = byChapter.get(chapter.ref)!;
      expect(references.length).toBeGreaterThan(0);
      expect(references).toHaveLength(chapter.segments.length);
      chapter.segments.forEach((segment, index) => {
        expect(references[index]).toBe(`${chapter.ref}.${index + 1}`);
        expect(segment.length).toBeGreaterThan(1);
        if (slug === "kojiki") expect(segment).not.toStartWith("[ Sect.");
      });
    }
    // Page titles and chapter labels come from the same page, and the reader
    // looks pages up by the ref the plumbing writes here.
    const stream = streams.works[slug]!;
    expect(stream.config.pages.map((page) => page.ref)).toEqual(cache.chapters.map((chapter) => chapter.ref));
    expect(stream.config.pages.map((page) => page.title)).toHaveLength(chapters);
  });
});
