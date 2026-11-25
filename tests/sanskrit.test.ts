import { describe, expect, test } from "bun:test";
import { devanagariToIast, iastToDevanagari, looksLikeIast } from "../client/translit/sanskrit";

describe("Devanagari to IAST", () => {
  const cases: [string, string][] = [
    ["धर्मक्षेत्रे कुरुक्षेत्रे", "dharmakṣetre kurukṣetre"],
    ["अर्जुन उवाच ।", "arjuna uvāca |"],
    ["ॐ नमः शिवाय", "oṃ namaḥ śivāya"],
    ["संस्कृतम्", "saṃskṛtam"],
    ["ज्ञानं", "jñānaṃ"],
    ["कृष्ण", "kṛṣṇa"],
    ["योगः कर्मसु कौशलम् ॥२-५०॥", "yogaḥ karmasu kauśalam ||2-50||"],
    ["सोऽहम्", "so'ham"],
    ["ऐश्वर्य औषधि", "aiśvarya auṣadhi"],
  ];
  for (const [deva, iast] of cases) test(deva, () => expect(devanagariToIast(deva)).toBe(iast));
});

describe("IAST to Devanagari", () => {
  const cases: [string, string][] = [
    ["dharmakṣetre kurukṣetre", "धर्मक्षेत्रे कुरुक्षेत्रे"],
    ["arjuna uvāca |", "अर्जुन उवाच ।"],
    ["oṃ namaḥ śivāya", "ओं नमः शिवाय"],
    ["saṃskṛtam", "संस्कृतम्"],
    ["jñānaṃ", "ज्ञानं"],
    ["śāntipāṭhaḥ", "शान्तिपाठः"],
    ["so'ham", "सोऽहम्"],
    ["kaivalya", "कैवल्य"],
  ];
  for (const [iast, deva] of cases) test(iast, () => expect(iastToDevanagari(iast)).toBe(deva));

  test("keeps references and tags as written", () => {
    expect(iastToDevanagari("aitupbh_1,1.1 ātmā (1 / 2 / 1)")).toBe("aitupbh_1,1.1 आत्मा (1 / 2 / 1)");
  });

  test("round-trips a verse", () => {
    const verse = "yadā yadā hi dharmasya glānir bhavati bhārata";
    expect(devanagariToIast(iastToDevanagari(verse))).toBe(verse);
  });

  test("tells IAST from English", () => {
    expect(looksLikeIast("śāntipāṭhaḥ oṃ")).toBe(true);
    expect(looksLikeIast("In the beginning")).toBe(false);
  });
});
