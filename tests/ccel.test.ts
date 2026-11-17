import { describe, expect, test } from "bun:test";
import {
  ccelCard,
  isCcelHeading,
  markerTitle,
  normalizeTitle,
  parseCcel,
  parseCcelPlainText,
  titlesAgree,
  withoutCcelApparatus,
  withoutCcelHeader,
} from "../server/ccel";

const CARD = [
  "     __________________________________________________________________",
  "",
  "           Title: Confessions and Enchiridion, newly translated and edited by",
  "                  Albert C. Outler",
  "      Creator(s): Augustine, Saint, Bishop of Hippo (345-430)",
  "                  Outler, Albert C. (Translator and Editor)",
  "     Print Basis: Philadelphia: Westminster Press [1955] (Library of",
  "                  Christian Classics, v. 7)",
  "          Rights: Public Domain",
  "   CCEL Subjects: All; Classic; Early Church; Proofed",
  "     __________________________________________________________________",
  "",
  "",
].join("\n");

const file = (body: string) => `${CARD}${body}`;

describe("the catalogue card", () => {
  test("reads the fields, wrapped values and all", () => {
    const card = ccelCard(file("   TEXT\n"));
    expect(card.title).toBe("Confessions and Enchiridion, newly translated and edited by Albert C. Outler");
    expect(card["creator(s)"]).toContain("Outler, Albert C. (Translator and Editor)");
    expect(card["print basis"]).toBe("Philadelphia: Westminster Press [1955] (Library of Christian Classics, v. 7)");
    expect(card.rights).toBe("Public Domain");
    expect(card["ccel subjects"]).toBe("All; Classic; Early Church; Proofed");
  });

  test("the card is dropped before the text is read", () => {
    const lines = withoutCcelHeader(file("   AUGUSTINE: CONFESSIONS\n\n   First words.\n"));
    expect(lines[1]).toBe("   AUGUSTINE: CONFESSIONS");
  });
});

describe("headings", () => {
  test("takes the divisions these editions print", () => {
    for (const line of ["BOOK ONE", "CHAPTER I", "Chapter I.", "Sermon 12", "Psalm 23", "THE APOLOGY", "ELUCIDATIONS"]) {
      expect(isCcelHeading(line)).toBe(true);
    }
  });

  test("leaves the text's own numbering alone", () => {
    for (const line of [
      "II.",
      "1. The date of the Apology, however, is perhaps at once the most",
      "Apology.",
      "This book, however, considerably overruns the promised number of pages",
      "fabricius of the next century, referred to in p. xv. above, and then",
    ]) {
      expect(isCcelHeading(line)).toBe(false);
    }
  });
});

describe("the site's trailing index", () => {
  const lines = [
    "   The Apology. [77]",
    "",
    "   Index to Tertullian's works given in the Codex Agobardi; but the tracts",
    "   are named there without dates.",
    "",
    "Index of Scripture References",
    "1. file:///ccel/schaff/anf03/cache/anf03.html3?scrBook=Gen&scrCh=1&scrV=1",
    "",
  ];

  test("is cut at its heading, not at prose about an index", () => {
    const body = withoutCcelApparatus(lines);
    expect(body.join("\n")).toContain("Index to Tertullian's works");
    expect(body.join("\n")).not.toContain("Index of Scripture References");
  });
});

describe("matching the catalogue's titles", () => {
  test("reads two ways of naming one work as the same", () => {
    expect(normalizeTitle("The Confessions of St. Augustine (1901)")).toBe("confessions st augustine");
    expect(normalizeTitle("NPNF2-04. Athanasius: Select Works and Letters")).toBe("athanasius select works letters");
  });

  test("accepts a title the file states in more words", () => {
    expect(titlesAgree("The Apostolic Fathers", "Apostolic Fathers")).toBe(true);
    expect(titlesAgree("Confessions and Enchiridion, newly translated and edited by Albert C. Outler", "Confessions and Enchiridion")).toBe(true);
  });

  test("refuses a file that holds a volume instead of the work", () => {
    expect(
      titlesAgree(
        "ANF09. The Gospel of Peter, The Diatessaron of Tatian, The Apocalypse of Peter, the Vision of Paul",
        "Acts of Xanthippe and Polyxena",
      ),
    ).toBe(false);
  });
});

describe("a work divided by its own headings", () => {
  const parsed = parseCcel(
    file(
      [
        "AUGUSTINE: CONFESSIONS",
        "",
        "A note by the editor, long enough to survive the chapter's minimum length.",
        "",
        "BOOK ONE",
        "",
        "CHAPTER I",
        "",
        '"Great art thou, O Lord, and greatly to be praised; great is thy power, and infinite is thy wisdom."',
        "",
        "CHAPTER II",
        "",
        "And how shall I call upon my God, my God and my Lord, seeing that when I call on him I ask him to come into me?",
        "",
        "BOOK TWO",
        "",
        "CHAPTER I",
        "",
        "I will now call to mind my past foulness, and the carnal corruptions of my soul, not because I love them.",
        "",
      ].join("\n"),
    ),
    "Confessions",
  );

  test("names a chapter for the book it stands in", () => {
    expect(parsed.scheme).toBe("chapter.paragraph");
    expect(parsed.chapters.map((chapter) => chapter.label)).toEqual([
      "AUGUSTINE: CONFESSIONS",
      "BOOK ONE, CHAPTER I",
      "BOOK ONE, CHAPTER II",
      "BOOK TWO, CHAPTER I",
    ]);
  });

  test("keeps the paragraphs of each chapter", () => {
    expect(parsed.chapters[1]!.paragraphs).toHaveLength(1);
    expect(parsed.chapters[1]!.paragraphs[0]).toStartWith('"Great art thou, O Lord');
  });
});

describe("a volume of collected works", () => {
  const parsed = parseCcel(
    file(
      [
        "   The Writings of the Fathers Down to A.D. 325",
        "",
        "   tertullian apology anf03 tertullian-apology The Apology",
        "   /ccel/schaff/anf03.iv.i.html",
        "     __________________________________________________________________",
        "",
        "   I.",
        "",
        "   Apology.",
        "",
        "   [Translated by the Rev. S. Thelwall, late scholar of Christ's College.]",
        "",
        "   The Apology. [77]",
        "",
        "   Chapter I.",
        "",
        "   Rulers of the Roman Empire, if seated for the administration of justice on your lofty tribunal, you may not openly inquire.",
        "",
        "   Chapter II.",
        "",
        "   We are accused of being Christians when we ought to be defended for being innocent of what is laid to our charge.",
        "",
        "   tertullian spectaculis anf03 tertullian-spectaculis The Shows, or De",
        "   Spectaculis /ccel/schaff/anf03.iv.v.html",
        "     __________________________________________________________________",
        "",
        "   Chapter I.",
        "",
        "   The shows of the theatre are the property of the devil, and the Christian has no part in them, however innocent they look.",
        "",
      ].join("\n"),
    ),
    "Latin Christianity",
  );

  test("separates the works it contains", () => {
    const labels = parsed.chapters.map((chapter) => chapter.label);
    expect(labels).toContain("The Apology, Chapter I");
    expect(labels).toContain("The Shows, or De Spectaculis, Chapter I");
  });

  test("reads a marker's title from the line above it", () => {
    expect(markerTitle("   /ccel/schaff/anf03.iv.i.html", ["   tertullian apology anf03 tertullian-apology The Apology"])).toBe(
      "The Apology",
    );
    expect(
      markerTitle("   Spectaculis /ccel/schaff/anf03.iv.v.html", [
        "   tertullian spectaculis anf03 tertullian-spectaculis The Shows, or De",
      ]),
    ).toBe("The Shows, or De Spectaculis");
    expect(markerTitle("/ccel/schaff/anf03.iv.i.html", ["   Rulers of the Roman Empire, if seated"])).toBeNull();
  });
});

describe("a Bible file", () => {
  const chapter = (name: string, verses: number) => [
    `  ${name}`,
    "",
    ...Array.from({ length: verses }, (_, index) => `   ${index + 1} ^${index + 1}And the word of verse ${index + 1} stood in the text.`),
    "",
    "",
  ];
  const parsed = parseCcel(
    file(
      [
        "                                 Old Testament",
        "     __________________________________________________________________",
        "",
        "The First Book of Moses, called Genesis",
        "     __________________________________________________________________",
        "",
        ...Array.from({ length: 8 }, (_, index) => chapter(`Genesis ${index + 1}`, 10)).flat(),
      ].join("\n"),
    ),
    "The American Standard Version of the Holy Bible (1901)",
  );

  test("reads chapters and verses", () => {
    expect(parsed.scheme).toBe("chapter.verse");
    expect(parsed.chapters).toHaveLength(8);
    expect(parsed.chapters[0]!.label).toBe("Genesis 1");
    expect(parsed.chapters[0]!.verses![0]).toBe(1);
    expect(parsed.chapters[0]!.paragraphs[0]).toBe("And the word of verse 1 stood in the text.");
    expect(parsed.chapters[7]!.label).toBe("Genesis 8");
  });

  test("reads a book whose name is not all title case", () => {
    // `Song of Songs` and `Psalms` carry a small word inside the book's name;
    // its chapters are chapters of their own and not verses of the one before.
    const song = parseCcel(
      file(
        [
          "The First Book of Moses, called Genesis",
          "     __________________________________________________________________",
          "",
          ...chapter("Genesis 50", 30).flat(),
          ...chapter("Song of Songs 1", 20).flat(),
          ...chapter("Song of Songs 2", 20).flat(),
          ...chapter("Psalms 23", 6).flat(),
        ].join("\n"),
      ),
      "The American Standard Version of the Holy Bible (1901)",
    );
    expect(song.scheme).toBe("chapter.verse");
    expect(song.chapters.map((entry) => entry.label)).toEqual(["Genesis 50", "Song of Songs 1", "Song of Songs 2", "Psalms 23"]);
    expect(song.chapters[0]!.paragraphs).toHaveLength(30);
  });
});

describe("a text with no divisions", () => {
  const parsed = parseCcelPlainText(
    file(
      [
        "   made its way in the face of opposition, and at the cost of its original",
        "   subtle consistency, through the councils of the fourth century.",
        "",
        "   On the other hand, very many of Origen's pupils started from the other side",
        "   of Origen's teaching, and held tenaciously to the coeternity of the Son.",
        "",
      ].join("\n"),
    ),
    "Athanasius: Select Works and Letters",
  );

  test("keeps the whole text as one chapter named for the work", () => {
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.label).toBe("Athanasius: Select Works and Letters");
    expect(parsed[0]!.paragraphs).toHaveLength(2);
    expect(parsed[0]!.paragraphs[0]).toStartWith("made its way in the face of opposition");
  });

  test("drops a heading with no text under it", () => {
    const onlyTitlePage = parseCcelPlainText(file("BOOK ONE.\n\nEDINBURGH\n\n"), "A Work");
    expect(onlyTitlePage).toHaveLength(0);
  });
});
