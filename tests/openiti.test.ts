import { describe, expect, test } from "bun:test";
import { groupOpeniti, openitiChapters, parseOpeniti, selectOpeniti } from "../server/openiti";

const SAMPLE = `######OpenITI#
#META# 020.BookTITLE :: كتاب تجريبي

# PageV00P000
### | الباب الأول
# الفقرة الأولى
~~وتكملتها في السطر التالي
# PageV00P001
### || فصل في شيء
### | AUTO ### | AUTO الباب الثاني
# الفقرة الثانية
# | ...........
# نص بعد العنوان الزخرفي
`;

describe("OpenITI mARkdown", () => {
  test("reads pipes as heading depth and merges continuation lines", () => {
    const sections = parseOpeniti(SAMPLE);
    expect(sections.map((s) => [s.level, s.title])).toEqual([
      [1, "الباب الأول"],
      [2, "فصل في شيء"],
      [1, "الباب الثاني"],
    ]);
    expect(sections[0]!.paragraphs).toEqual(["الفقرة الأولى وتكملتها في السطر التالي"]);
  });

  test("strips page markers and repeated conversion markers", () => {
    const sections = parseOpeniti(SAMPLE);
    expect(sections[2]!.title).toBe("الباب الثاني");
    expect(sections.flatMap((s) => s.paragraphs).join(" ")).not.toContain("PageV");
    expect(sections.flatMap((s) => s.paragraphs).join(" ")).not.toContain("###");
  });

  test("a decorative heading does not swallow the text after it", () => {
    const sections = parseOpeniti(SAMPLE);
    expect(sections[2]!.paragraphs).toEqual(["الفقرة الثانية", "نص بعد العنوان الزخرفي"]);
  });

  test("grouping by a book pattern keeps chapter headings and their text", () => {
    const sections = parseOpeniti(SAMPLE);
    const chapters = groupOpeniti(sections, /^الباب/);
    expect(chapters.map((c) => c.title)).toEqual(["الباب الأول", "الباب الثاني"]);
    expect(chapters[0]!.paragraphs).toEqual([
      "الفقرة الأولى وتكملتها في السطر التالي",
      "فصل في شيء",
    ]);
  });

  test("selecting a heading level keeps deeper headings as paragraphs", () => {
    const sections = parseOpeniti(SAMPLE);
    const chapters = selectOpeniti(sections, 1);
    expect(chapters.map((c) => c.title)).toEqual(["الباب الأول", "الباب الثاني"]);
    expect(chapters[0]!.paragraphs).toContain("فصل في شيء");
  });

  test("the stored chapter rule is applied consistently", () => {
    const sections = parseOpeniti(SAMPLE);
    expect(openitiChapters(sections, { mode: "level", level: 1 }).length).toBe(2);
    expect(openitiChapters(sections, { mode: "pattern", pattern: "^الباب" }).length).toBe(2);
  });
});
