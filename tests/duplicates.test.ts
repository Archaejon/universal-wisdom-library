import { describe, expect, test } from "bun:test";
import { classifyTextPair, setSimilarity, shingleSet, textSimilarity } from "../server/duplicates";

const psalm = "The Lord is my shepherd; I shall not want. He maketh me to lie down in green pastures: he leadeth me beside the still waters.";
const longerPsalm = `${psalm} He restoreth my soul: he leadeth me in the paths of righteousness for his name's sake.`;

describe("passage comparison", () => {
  test("byte equality is the strict case", () => {
    const relation = classifyTextPair(psalm, psalm);
    expect(relation.kind).toBe("identical");
    expect(relation.similarity).toBe(1);
  });

  test("punctuation and case differences are equivalent, not near", () => {
    const modern = psalm.replace(/;/g, ",").replace(/:/g, ".").toUpperCase();
    const relation = classifyTextPair(psalm, modern);
    expect(relation.kind).toBe("equivalent");
    expect(relation.similarity).toBe(1);
  });

  test("diacritics and script variants fold before comparison", () => {
    // The registry folds Greek final sigma and Latin ligatures, so a text that
    // differs only in those is the same text for review purposes.
    expect(classifyTextPair("λόγος", "λόγοσ").kind).toBe("equivalent");
    expect(classifyTextPair("Æthelred", "Aethelred").kind).toBe("equivalent");
  });

  test("a changed word in a paragraph leaves the text near", () => {
    const relation = classifyTextPair(longerPsalm, longerPsalm.replace("green", "lush"));
    expect(relation.kind).toBe("near");
    expect(relation.similarity).toBeGreaterThanOrEqual(0.8);
    expect(relation.similarity).toBeLessThan(1);
  });

  test("an unrelated text is different", () => {
    const relation = classifyTextPair(psalm, "Blessed are the poor in spirit, for theirs is the kingdom of heaven.");
    expect(relation.kind).toBe("different");
    expect(relation.similarity).toBeLessThan(0.5);
  });

  test("a threshold decides where near begins", () => {
    const changed = longerPsalm.replace("green", "lush");
    expect(classifyTextPair(longerPsalm, changed, 0.999).kind).toBe("different");
    expect(classifyTextPair(longerPsalm, changed, 0.5).kind).toBe("near");
  });
});

describe("shingle sets", () => {
  test("use word trigrams for spaced scripts", () => {
    expect(shingleSet("one two three").size).toBe(1);
    expect(shingleSet("one two").size).toBe(1);
    expect(shingleSet("one").size).toBe(1);
    expect(shingleSet("").size).toBe(0);
  });

  test("use character trigrams for CJK, where spaces do not separate words", () => {
    expect(shingleSet("仁者愛人").size).toBe(2);
    expect(textSimilarity("仁者愛人", "仁者愛人")).toBe(1);
  });

  test("similarity is symmetric and bounded", () => {
    const a = shingleSet(psalm);
    const b = shingleSet(psalm.replace("green", "lush"));
    expect(setSimilarity(a, b)).toBe(setSimilarity(b, a));
    expect(setSimilarity(a, b)).toBeGreaterThan(0);
    expect(setSimilarity(a, b)).toBeLessThanOrEqual(1);
    expect(setSimilarity(new Set(), new Set())).toBe(1);
    expect(setSimilarity(new Set([1]), new Set())).toBe(0);
  });
});
