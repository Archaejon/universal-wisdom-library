import { describe, expect, test } from "bun:test";
import { barnesBook, buildBarnesIndex, classicRank, stripSefariaFootnotes } from "../server/commentary";
import { stripMarkup } from "../server/stream";

describe("Barnes' Notes book headings", () => {
  test("every New Testament heading Barnes uses maps to its book", () => {
    const headings: [string, number][] = [
      ["THE GOSPEL ACCORDING TO MATTHEW", 40],
      ["THE GOSPEL ACCORDING TO MARK", 41],
      ["THE GOSPEL ACCORDING TO LUKE", 42],
      ["THE GOSPEL ACCORDING TO JOHN", 43],
      ["THE ACTS OF THE APOSTLES", 44],
      ["THE EPISTLE TO THE ROMANS", 45],
      ["THE FIRST EPISTLE OF PAUL THE APOSTLE TO THE CORINTHIANS", 46],
      ["THE SECOND EPISTLE OF PAUL THE APOSTLE TO THE CORINTHIANS", 47],
      ["THE EPISTLE OF PAUL THE APOSTLE TO THE GALATIANS", 48],
      ["EPHESIANS", 49],
      ["EPISTLE TO THE PHILIPPIANS", 50],
      ["THE EPISTLE OF PAUL TO THE COLOSSIANS", 51],
      ["THE FIRST EPISTLE TO THE THESSALONIANS", 52],
      ["THE SECOND EPISTLE TO THE THESSALONIANS", 53],
      ["THE FIRST EPISTLE OF PAUL TO TIMOTHY", 54],
      ["THE SECOND EPISTLE OF PAUL TO TIMOTHY", 55],
      ["THE EPISTLE OF PAUL TO TITUS", 56],
      ["EPISTLE OF PAUL TO PHILEMON", 57],
      ["THE EPISTLE OF PAUL THE APOSTLE TO THE HEBREWS", 58],
      ["THE GENERAL EPISTLE OF JAMES", 59],
      ["THE FIRST EPISTLE GENERAL OF PETER", 60],
      ["THE SECOND EPISTLE GENERAL OF PETER", 61],
      ["THE FIRST EPISTLE GENERAL OF JOHN", 62],
      ["SECOND EPISTLE OF JOHN", 63],
      ["THIRD EPISTLE OF JOHN", 64],
      ["THE GENERAL EPISTLE OF JUDE", 65],
      ["REVELATION OF ST. JOHN THE DIVINE", 66],
    ];
    for (const [heading, book] of headings) expect([heading, barnesBook(heading)]).toEqual([heading, book]);
  });
});

describe("Barnes' Notes verse index", () => {
  const row = (id: number, chapter_ref: string, content: string) => ({ id, chapter_ref, content });

  test("files paragraphs under the verse marker before them", () => {
    const index = buildBarnesIndex([
      row(1, "7", "THE GOSPEL ACCORDING TO JOHN - Chapter 3 - Verse 16"),
      row(2, "7", "Verse 16. For God so loved."),
      row(3, "7", "The world. All mankind."),
      row(4, "7", "THE GOSPEL ACCORDING TO JOHN - Chapter 3 - Verse 17"),
      row(5, "7", "Verse 17. To condemn the world."),
    ]);
    expect(index.get("43:3.16")).toEqual([2, 3]);
    expect(index.get("43:3.17")).toEqual([5]);
  });

  test("gives a book's unmarked first verse the paragraphs that open it", () => {
    const index = buildBarnesIndex([
      row(1, "5", "GOSPEL ACCORDING TO MATTHEW"),
      row(2, "5", "1. The book of the generation."),
      row(3, "5", "Jesus. See Mt 1:21."),
      row(4, "5", "THE GOSPEL ACCORDING TO MATTHEW - Chapter 1 - Verse 2"),
      row(5, "5", "Abraham begat Isaac."),
    ]);
    expect(index.get("40:1.1")).toEqual([2, 3]);
    expect(index.get("40:1.2")).toEqual([5]);
  });

  test("a new section ends the last verse, so closing remarks are not filed under it", () => {
    const index = buildBarnesIndex([
      row(1, "11", "THE GOSPEL ACCORDING TO MATTHEW - Chapter 7 - Verse 29"),
      row(2, "11", "Verse 29. As one having authority."),
      row(3, "12", "REMARKS ON CHAPTER 7"),
      row(4, "12", "1. We learn the duty of judging charitably."),
    ]);
    expect(index.get("40:7.29")).toEqual([2]);
    expect([...index.values()].flat()).not.toContain(4);
  });
});

describe("Sefaria commentary text", () => {
  test("drops inline footnotes, nested markup included", () => {
    const html =
      'The power of His deeds<sup class="footnote-marker">6</sup><i class="footnote">The account of <i>Creation</i>.</i> He told to His people';
    expect(stripMarkup(stripSefariaFootnotes(html))).toBe("The power of His deeds He told to His people");
  });

  test("decodes the spacing entities in pointed Hebrew", () => {
    expect(stripMarkup("וַֽיְהִי&thinsp;עֶ֖רֶב")).toBe("וַֽיְהִי עֶ֖רֶב");
  });

  test("lists commentaries on this book first, the classics in their usual order", () => {
    const book = "Genesis";
    const rashi = classicRank("Rashi", "Rashi on Genesis", book);
    const ramban = classicRank("Ramban", "Ramban on Genesis", book);
    const other = classicRank("Haamek Davar", "Haamek Davar on Genesis", book);
    const elsewhere = classicRank("Rashi", "Rashi on Taanit", book);
    expect(rashi).toBeLessThan(ramban);
    expect(ramban).toBeLessThan(other);
    expect(other).toBeLessThan(elsewhere);
  });
});
