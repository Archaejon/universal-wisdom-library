import { describe, expect, test } from "bun:test";
import { decodeEntities, parseXml, readTei, textOf } from "../ingest/tei";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt><title>Sample</title></titleStmt>
  <publicationStmt><availability><licence target="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</licence></availability></publicationStmt>
  </fileDesc></teiHeader>
  <text><body><div type="edition" xml:lang="grc">
    <div type="textpart" subtype="chapter" n="1">
      <div type="textpart" subtype="section" n="1"><p>Ἐν ἀρχῇ ἦν ὁ λό- γος<note>editorial</note> &amp; φῶς.</p></div>
      <div type="textpart" subtype="section" n="2"><p>Δεύτερον.</p></div>
    </div>
    <div type="textpart" subtype="chapter" n="2">
      <div type="textpart" subtype="section" n="1"><p>Τρίτον.</p></div>
    </div>
  </div></body></text>
</TEI>`;

describe("TEI reader", () => {
  test("decodes entities", () => {
    expect(decodeEntities("a &amp; b &#x3B1; &#946;")).toBe("a & b α β");
  });

  test("drops notes and joins line-break hyphens", () => {
    const root = parseXml(`<p>λό- γος<note>x</note> καλός</p>`);
    expect(textOf(root)).toBe("λόγος καλός");
  });

  test("reads chapters and passages with i.j references", () => {
    const edition = readTei(SAMPLE);
    expect(edition.language).toBe("grc");
    expect(edition.chapters.map((c) => c.cite)).toEqual(["1", "2"]);
    expect(edition.chapters[0].passages).toHaveLength(2);
    expect(edition.chapters[0].passages[0].text).toBe("Ἐν ἀρχῇ ἦν ὁ λόγος & φῶς.");
    expect(edition.licence).toContain("by-sa");
  });
});
