import { describe, expect, test } from "bun:test";
import { cleanWord, flattenSenses } from "../server/words";

describe("word study", () => {
  test("a clicked word keeps its vowels and loses accents and punctuation", () => {
    expect(cleanWord("אֱלֹהִ֑ים׃")).toBe("אֱלֹהִים");
    expect(cleanWord("וַיֹּ֥אמֶר,")).toBe("וַיֹּאמֶר");
    expect(cleanWord("hello")).toBe("");
  });

  test("senses are flattened with their depth, markup removed", () => {
    const senses = flattenSenses({
      senses: [
        { definition: "to create, shape", senses: [{ definition: "<i>of heaven</i>", grammar: { verbal_stem: "Qal" } }] },
      ],
    });
    expect(senses).toEqual([
      { depth: 0, text: "to create, shape" },
      { depth: 1, text: "Qal: of heaven" },
    ]);
  });
});
