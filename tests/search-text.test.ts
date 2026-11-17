import { describe, expect, test } from "bun:test";
import { contentTerms, indexText, normalizeForSearch, searchVariants } from "../server/text";

describe("multilingual search normalisation", () => {
  test("folds Arabic pointing, alef forms and ta marbuta", () => {
    expect(normalizeForSearch("الصَّلَاةُ")).toBe("الصلاه");
    expect(normalizeForSearch("إِيمَان")).toBe("ايمان");
    expect(normalizeForSearch("مُصْطَفَى")).toBe("مصطفي");
    expect(normalizeForSearch("١٢٣")).toBe("123");
  });

  test("folds Hebrew pointing and final letters", () => {
    expect(normalizeForSearch("בְּרֵאשִׁית")).toBe("בראשית");
    expect(normalizeForSearch("שָׁלוֹם")).toBe("שלומ");
    expect(normalizeForSearch("מֶלֶךְ")).toBe("מלכ");
    expect(normalizeForSearch("דָּבָר")).toBe("דבר");
  });

  test("folds Greek final sigma and Latin ligatures", () => {
    expect(normalizeForSearch("λόγος")).toBe("λογοσ");
    expect(normalizeForSearch("Αἴσχυλος")).toBe("αισχυλοσ");
    expect(normalizeForSearch("Æthelred")).toBe("aethelred");
  });

  test("keeps Indic combining marks inside the word", () => {
    expect(normalizeForSearch("अग्नि")).toBe("अग्नि");
    expect(normalizeForSearch("ऋग्वेद")).toBe("ऋग्वेद");
    expect(normalizeForSearch("திருக்குறள்")).toBe("திருக்குறள்");
  });

  test("folds Pali diacritics for SuttaCentral search", () => {
    expect(normalizeForSearch("dukkhā")).toBe("dukkha");
    expect(normalizeForSearch("Sāvatthī")).toBe("savatthi");
    expect(normalizeForSearch("dhammānupassanā")).toBe("dhammanupassana");
  });
});

describe("CJK indexing", () => {
  test("indexes every character beside the bigrams", () => {
    const indexed = indexText("仁者愛人");
    const tokens = new Set(indexed.text.split(" "));
    // The run itself is one token, so the bigrams answer two-character queries
    // and the characters answer one-character queries without a corpus scan.
    for (const char of "仁者愛人") expect(tokens.has(char)).toBe(true);
    for (const bigram of ["仁者", "者愛", "愛人"]) expect(tokens.has(bigram)).toBe(true);
  });

  test("keeps a one- or two-character query as written", () => {
    expect(contentTerms("仁")).toEqual(["仁"]);
    expect(contentTerms("君子")).toEqual(["君子"]);
    // Longer CJK runs are still searched as their bigrams.
    expect(contentTerms("仁者愛人")).toEqual(["仁者", "者愛", "愛人"]);
  });

  test("leaves non-CJK text unchanged", () => {
    expect(indexText("mercy").text).toBe("mercy");
  });
});

describe("Semitic prefix variants", () => {
  test("indexes the Arabic article and preposition forms", () => {
    const variants = searchVariants("الصلاة", "ar").split(" ");
    expect(variants).toContain("صلاه");
    const prefixed = searchVariants("وبالصلاة", "ar").split(" ");
    expect(prefixed).toContain("صلاه");
  });

  test("indexes Hebrew prefixes", () => {
    const variants = searchVariants("בראשית", "he").split(" ");
    expect(variants).toContain("ראשית");
    const article = searchVariants("התורה", "he").split(" ");
    expect(article).toContain("תורה");
  });

  test("does not strip prefixes from unrelated languages", () => {
    expect(searchVariants("الصلاة", "en")).toBe("");
    expect(searchVariants("logos", "grc")).toBe("");
  });
});
