import { describe, expect, test } from "bun:test";
import { orderedSubcategories, sortShelfWorks } from "../server/canon";

const work = (slug: string, subcategory: string, title = slug) => ({ slug, subcategory, title });

describe("canonical shelf order", () => {
  test("Tanakh runs Torah → Nevi'im → Ketuvim and not alphabetically", () => {
    const shelf = [
      work("amos", "Prophets (Nevi'im)", "Amos"),
      work("ezekiel", "Prophets (Nevi'im)", "Ezekiel"),
      work("isaiah", "Prophets (Nevi'im)", "Isaiah"),
      work("genesis", "Torah", "Genesis"),
      work("exodus", "Torah", "Exodus"),
      work("deuteronomy", "Torah", "Deuteronomy"),
      work("psalms", "Writings (Ketuvim)", "Psalms"),
      work("ruth", "Writings (Ketuvim)", "Ruth"),
      work("proverbs", "Writings (Ketuvim)", "Proverbs"),
    ];
    expect(sortShelfWorks("Tanakh", shelf).map((w) => w.slug)).toEqual([
      "genesis",
      "exodus",
      "deuteronomy",
      "isaiah",
      "ezekiel",
      "amos",
      "psalms",
      "proverbs",
      "ruth",
    ]);
  });

  test("the headings themselves keep the tripartite order", () => {
    expect(
      orderedSubcategories("Tanakh", ["Writings (Ketuvim)", "Torah", "Prophets (Nevi'im)"]),
    ).toEqual(["Torah", "Prophets (Nevi'im)", "Writings (Ketuvim)"]);
  });

  test("Mishnah follows seder order, then tractate order", () => {
    const shelf = [
      work("mishnah-zevachim", "Kodashim", "Mishnah Zevachim"),
      work("mishnah-berakhot", "Zeraim", "Mishnah Berakhot"),
      work("mishnah-shabbat", "Moed", "Mishnah Shabbat"),
      work("mishnah-bava-batra", "Nezikin", "Mishnah Bava Batra"),
      work("mishnah-bava-kamma", "Nezikin", "Mishnah Bava Kamma"),
      work("mishnah-yevamot", "Nashim", "Mishnah Yevamot"),
      work("mishnah-kelim", "Tahorot", "Mishnah Kelim"),
    ];
    expect(sortShelfWorks("Mishnah", shelf).map((w) => w.slug)).toEqual([
      "mishnah-berakhot",
      "mishnah-shabbat",
      "mishnah-yevamot",
      "mishnah-bava-kamma",
      "mishnah-bava-batra",
      "mishnah-zevachim",
      "mishnah-kelim",
    ]);
  });

  test("Talmud runs Berakhot first and keeps the Bava sequence", () => {
    const shelf = [
      work("talmud-bava-metzia", "Bavli", "Bava Metzia"),
      work("talmud-bava-kamma", "Bavli", "Bava Kamma"),
      work("talmud-berakhot", "Bavli", "Berakhot"),
      work("talmud-pesachim", "Bavli", "Pesachim"),
    ];
    expect(sortShelfWorks("Talmud", shelf).map((w) => w.slug)).toEqual([
      "talmud-berakhot",
      "talmud-pesachim",
      "talmud-bava-kamma",
      "talmud-bava-metzia",
    ]);
  });

  test("Yerushalmi slugs resolve to the same tractate order", () => {
    const shelf = [
      work("yerushalmi-jerusalem-talmud-berakhot", "Yerushalmi", "Jerusalem Talmud Berakhot"),
      work("yerushalmi-jerusalem-talmud-peah", "Yerushalmi", "Jerusalem Talmud Peah"),
      work("yerushalmi-jerusalem-talmud-shekalim", "Yerushalmi", "Jerusalem Talmud Shekalim"),
    ];
    expect(sortShelfWorks("Talmud", shelf).map((w) => w.slug)).toEqual([
      "yerushalmi-jerusalem-talmud-berakhot",
      "yerushalmi-jerusalem-talmud-peah",
      "yerushalmi-jerusalem-talmud-shekalim",
    ]);
  });

  test("Tosefta 'Seder X' headings match the Mishnah seder order", () => {
    const shelf = [
      work("tosefta-berakhot", "Seder Zeraim", "Tosefta Berakhot"),
      work("tosefta-kelim", "Seder Tahorot", "Tosefta Kelim"),
      work("tosefta-shabbat", "Seder Moed", "Tosefta Shabbat"),
    ];
    expect(sortShelfWorks("Tosefta", shelf).map((w) => w.slug)).toEqual([
      "tosefta-berakhot",
      "tosefta-shabbat",
      "tosefta-kelim",
    ]);
  });

  test("Midrash Rabbah runs Torah volumes before the Megillot", () => {
    const shelf = [
      work("midrash-bamidbar-rabbah", "Midrash Rabbah", "Bamidbar Rabbah"),
      work("midrash-bereshit-rabbah", "Midrash Rabbah", "Bereshit Rabbah"),
      work("midrash-esther-rabbah", "Midrash Rabbah", "Esther Rabbah"),
      work("midrash-shemot-rabbah", "Midrash Rabbah", "Shemot Rabbah"),
    ];
    expect(sortShelfWorks("Midrash", shelf).map((w) => w.slug)).toEqual([
      "midrash-bereshit-rabbah",
      "midrash-shemot-rabbah",
      "midrash-bamidbar-rabbah",
      "midrash-esther-rabbah",
    ]);
  });

  test("Mishneh Torah follows the order of its books, not the alphabet", () => {
    const shelf = [
      work("halakhah-kings", "Mishneh Torah", "Mishneh Torah, Kings and Wars"),
      work("halakhah-sabbath", "Mishneh Torah", "Mishneh Torah, Sabbath"),
      work("halakhah-foundations", "Mishneh Torah", "Mishneh Torah, Foundations of the Torah"),
      work("halakhah-marriage", "Mishneh Torah", "Mishneh Torah, Marriage"),
    ];
    expect(sortShelfWorks("Halakhah", shelf).map((w) => w.slug)).toEqual([
      "halakhah-foundations",
      "halakhah-sabbath",
      "halakhah-marriage",
      "halakhah-kings",
    ]);
  });

  test("unknown works keep an alphabetical fallback instead of vanishing", () => {
    const shelf = [
      work("zeta", "Other", "Zeta"),
      work("alpha", "Other", "Alpha"),
      work("genesis", "Torah", "Genesis"),
    ];
    // Headings without a canonical position sort alphabetically; works inside
    // them fall back to their titles.
    expect(sortShelfWorks("Scripture", shelf).map((w) => w.slug)).toEqual(["alpha", "zeta", "genesis"]);
  });
});
