import { describe, expect, test } from "bun:test";
import { retrievalQuery, selectTiered, tierFor, type Tier } from "../server/assistant";

describe("reading tiers", () => {
  test("a work takes the highest tier among its text functions", () => {
    expect(tierFor(["historical_document", "canonical_scripture"])).toBe("scripture");
    expect(tierFor(["commentary_exegesis", "philosophical_work"])).toBe("commentary");
    expect(tierFor(["religious_law_practice"])).toBe("law");
    expect(tierFor(["mystical_contemplative"])).toBe("thought");
    expect(tierFor(["historical_document"])).toBe("other");
    expect(tierFor([])).toBe("other");
  });

  const row = (passageId: number, work: string, tier: Tier) => ({ passageId, work: { slug: work }, tier });

  test("reserves slots per tier, so one kind of text cannot fill the answer", () => {
    // Ten law paragraphs rank first; scripture and commentary rank last.
    const candidates = [
      ...Array.from({ length: 10 }, (_, i) => row(i + 1, `law-${i}`, "law")),
      row(20, "bible", "scripture"),
      row(21, "rashi", "commentary"),
    ];
    const picked = selectTiered(candidates);
    expect(picked).toHaveLength(6);
    expect(picked.map((p) => p.tier)).toEqual(["scripture", "commentary", "law", "law", "law", "law"]);
  });

  test("no work takes more than two slots", () => {
    const candidates = Array.from({ length: 8 }, (_, i) => row(i + 1, i < 6 ? "one-work" : `other-${i}`, "scripture"));
    const picked = selectTiered(candidates);
    expect(picked.filter((p) => p.work.slug === "one-work")).toHaveLength(2);
    expect(picked).toHaveLength(4);
  });

  test("keeps rank order within a tier, and lists tiers in reading order", () => {
    const picked = selectTiered([
      row(1, "a", "thought"),
      row(2, "b", "scripture"),
      row(3, "c", "scripture"),
      row(4, "d", "commentary"),
    ]);
    expect(picked.map((p) => p.passageId)).toEqual([2, 3, 4, 1]);
  });
});

describe("asking about a selection", () => {
  test("searches the selection's words, not the words that ask about it", () => {
    const q = retrievalQuery("Where else is this idea found?", { quote: "In the beginning was the Word" });
    expect(q).toBe("In the beginning was the Word");
  });

  test("keeps what the question adds", () => {
    const q = retrievalQuery("How does this relate to creation?", { quote: "In the beginning was the Word" });
    expect(q).toBe("In the beginning was the Word relate creation");
  });

  test("leaves a question without a selection alone", () => {
    expect(retrievalQuery("What does mercy require?", null)).toBe("What does mercy require?");
  });
});
