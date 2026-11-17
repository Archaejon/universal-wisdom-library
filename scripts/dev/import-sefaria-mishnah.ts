// Imports the 63 tractates of the Mishnah from Sefaria: the public-domain
// Hebrew Torat Emet edition and the CC-BY-NC William Davidson English edition.
// Run from the project root:
//
//   bun run scripts/dev/import-sefaria-mishnah.ts
//
// Both are display copies. The exact edition, source and licence are recorded
// on every edition; the library does not relicense Sefaria's text.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");
const FUNCTIONS = join(ROOT, "data", "corpus", "text-functions.json");
const MANIFEST = join(ROOT, "data", "imports", "sefaria-mishnah.json");

type Tractate = { title: string; slug: string; seder: string; description: string };

function decode(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&#160;/g, " ")
    .replace(/&#8203;/g, "")
    .replace(/&#8206;/g, "")
    .replace(/&#8207;/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&thinsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/['’]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseText(raw: unknown): string[][] {
  if (!Array.isArray(raw)) return [];
  return raw.map((chapter) => {
    if (typeof chapter === "string") return [decode(chapter)];
    if (Array.isArray(chapter)) {
      if (chapter.every((x) => typeof x === "string")) return chapter.map((x) => decode(String(x)));
      return chapter.map((x) => (Array.isArray(x) ? x.map(String).join(" ") : String(x ?? ""))).map(decode);
    }
    return [decode(String(chapter ?? ""))];
  });
}

async function fetchTractate(title: string, version: "hebrew" | "english") {
  const url = new URL(`https://www.sefaria.org/api/v3/texts/${encodeURIComponent(title.replaceAll(" ", "_"))}`);
  url.searchParams.set("version", version);
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (res.status === 429) {
        await Bun.sleep(1500 * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`${title}: HTTP ${res.status}`);
      const data = (await res.json()) as any;
      const edition = data.versions?.[0];
      if (!edition) throw new Error(`${title}: no ${version} version returned`);
      return {
        ref: data.ref,
        title: String(edition.versionTitle ?? ""),
        license: String(edition.license ?? ""),
        versionSource: String(edition.versionSource ?? ""),
        versionNotes: String(edition.versionNotes ?? ""),
        text: parseText(edition.text),
      };
    } catch (err) {
      if (attempt === 4) throw err;
      await Bun.sleep(700 * attempt);
    }
  }
  throw new Error(`${title}: fetch failed`);
}

const indexRes = await fetch("https://www.sefaria.org/api/index/", { headers: { accept: "application/json" } });
if (!indexRes.ok) throw new Error(`Sefaria index returned ${indexRes.status}`);
const index = (await indexRes.json()) as any[];
const mishnah = index.find((x) => x.category === "Mishnah");
const tractates: Tractate[] = [];

function walk(node: any, seder = "") {
  const categories: string[] = node.categories ?? [];
  const currentSeder = categories[1] ?? seder;
  if (
    node.title &&
    node.corpus === "Mishnah" &&
    categories.length === 2 &&
    categories[0] === "Mishnah" &&
    (node.title.startsWith("Mishnah ") || node.title === "Pirkei Avot")
  ) {
    tractates.push({
      title: node.title,
      slug: node.title === "Pirkei Avot" ? "pirkei-avot" : slugify(node.title),
      seder: currentSeder.replace(/^Seder /, ""),
      description: String(node.enShortDesc ?? ""),
    });
  }
  for (const child of node.contents ?? []) walk(child, currentSeder);
}
walk(mishnah);

if (tractates.length !== 63) throw new Error(`Expected 63 tractates, found ${tractates.length}`);

const manifest: any = {
  source: "sefaria",
  source_url: "https://www.sefaria.org/",
  fetched_at: new Date().toISOString(),
  editions: {
    hebrew: { title: "Torat Emet 357", licence: "Public Domain" },
    english: { title: "William Davidson Edition - English", licence: "CC-BY-NC" },
  },
  tractates: [],
};
const functions = JSON.parse(readFileSync(FUNCTIONS, "utf8"));
const addedFunctions: string[] = [];

for (const tractate of tractates) {
  const hebrew = await fetchTractate(tractate.title, "hebrew");
  if (hebrew.license !== "Public Domain") {
    throw new Error(`${tractate.title}: expected Public Domain Hebrew, got ${hebrew.license}`);
  }
  if (!hebrew.text.length) throw new Error(`${tractate.title}: empty Hebrew text`);
  let english: Awaited<ReturnType<typeof fetchTractate>> | null = null;
  try {
    english = await fetchTractate(tractate.title, "english");
    if (!english.text.length) english = null;
  } catch (err) {
    console.warn(`  ${tractate.title}: English edition unavailable (${(err as Error).message})`);
  }

  const texts: Record<string, string> = {};
  const englishTexts: Record<string, string> = {};
  const chapters: { ref: string; label: string }[] = [];
  const passages: { reference: string; label: string; chapterRef: string }[] = [];
  for (let c = 0; c < hebrew.text.length; c++) {
    const chapterRef = String(c + 1);
    const mishnayot = hebrew.text[c];
    if (!mishnayot.length) continue;
    chapters.push({ ref: chapterRef, label: `Chapter ${chapterRef}` });
    for (let m = 0; m < mishnayot.length; m++) {
      const reference = `${chapterRef}.${m + 1}`;
      passages.push({ reference, label: `${chapterRef}:${m + 1}`, chapterRef });
      if (mishnayot[m]) texts[reference] = mishnayot[m];
      const translated = english?.text[c]?.[m];
      if (translated) englishTexts[reference] = translated;
    }
  }

  const work = {
    slug: tractate.slug,
    title: tractate.title,
    originalTitle: "",
    transliteration: "",
    altTitles: [],
    tradition: "judaism",
    school: "rabbinic-judaism",
    genre: "Mishnah",
    textType: `Mishnah · Seder ${tractate.seder}`,
    category: "Mishnah",
    subcategory: tractate.seder,
    originalLanguage: "he",
    dateStart: 200,
    dateEnd: 220,
    dateDisplay: "Compiled c. 200 CE",
    authorshipStatus: "composite",
    attributionNote:
      "Traditionally compiled by Rabbi Judah ha-Nasi from earlier rabbinic traditions. The Mishnah is a composite legal corpus, not a single-author book.",
    description:
      `${tractate.description || `Tractate ${tractate.title.replace(/^Mishnah /, "")} of the Mishnah.`} The complete tractate is imported in Hebrew and, where available, in the William Davidson English translation.`.trim(),
    historicalContext:
      "The Mishnah is the foundational compilation of rabbinic oral law, arranged in six sedarim. It is authoritative in traditional Judaism but is not part of the Tanakh.",
    featured: 0,
    featuredNote: "",
    refScheme: "chapter.mishnah",
    isSample: false,
    chapters,
    passages,
    editions: [
      {
        slug: `${tractate.slug}-hebrew-torat-emet`,
        language: "he",
        editionType: "original",
        title: "Torat Emet 357",
        translator: "",
        publisher: "Torat Emet edition, via Sefaria",
        publicationYear: null,
        source: "sefaria",
        license: "public-domain",
        rightsStatus: "Public domain (as reported by Sefaria)",
        attributionText:
          "Mishnah, Torat Emet 357 edition, public domain, accessed via Sefaria. Hebrew text is reproduced as supplied.",
        structureScheme: "chapter and mishnah",
        notes: "Complete tractate in Hebrew. Text is displayed as supplied by the named edition.",
        isSample: false,
        texts,
      },
      ...(english ? [{
        slug: `${tractate.slug}-english-william-davidson`,
        language: "en",
        editionType: "translation",
        title: english.title || "William Davidson Edition - English",
        translator: "William Davidson Edition",
        publisher: "Koren Publishers, via Sefaria",
        publicationYear: null,
        source: "sefaria",
        license: "cc-by-nc",
        rightsStatus: english.license || "CC-BY-NC",
        attributionText:
          `${english.title || "William Davidson Edition - English"}, licence ${english.license || "CC-BY-NC"}, source ${english.versionSource || "Sefaria"}. Retrieved via Sefaria. The translation is displayed with attribution and is not relicensed by this library.`,
        structureScheme: "chapter and mishnah",
        notes: `${english.versionNotes || "Complete tractate in English."} Text is displayed as supplied; HTML markup has been removed.`,
        isSample: false,
        texts: englishTexts,
      }] : []),
    ],
  };

  const serialized = JSON.stringify(work, null, 2) + "\n";
  writeFileSync(join(WORKS, `${tractate.slug}.json`), serialized);
  manifest.tractates.push({
    title: tractate.title,
    slug: tractate.slug,
    seder: tractate.seder,
    chapters: chapters.length,
    mishnayot: Object.keys(texts).length,
    english_mishnayot: Object.keys(englishTexts).length,
    sha256: new Bun.CryptoHasher("sha256").update(serialized).digest("hex"),
    licence: hebrew.license,
    english_licence: english?.license ?? null,
  });

  if (!functions.works[tractate.slug]) {
    functions.works[tractate.slug] = {
      functions: ["religious_law_practice"],
      assignedBy: "UWL editors (comparative taxonomy)",
      status: "affirmed",
      note: "Foundational compilation of rabbinic oral law. Authoritative in traditional Judaism, but not part of the Tanakh.",
    };
    addedFunctions.push(tractate.slug);
  }
  console.log(`${tractate.slug}: ${chapters.length} chapters, ${Object.keys(texts).length} mishnayot`);
}

manifest.totals = {
  tractates: manifest.tractates.length,
  chapters: manifest.tractates.reduce((n: number, t: any) => n + t.chapters, 0),
  mishnayot: manifest.tractates.reduce((n: number, t: any) => n + t.mishnayot, 0),
};
writeFileSync(FUNCTIONS, JSON.stringify(functions, null, 2) + "\n");
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${manifest.totals.tractates} tractates, ${manifest.totals.chapters} chapters, ${manifest.totals.mishnayot} mishnayot; ${addedFunctions.length} new classifications.`);
