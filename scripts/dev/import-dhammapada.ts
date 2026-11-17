// Complete Dhammapada from SuttaCentral's Bilara data: Pali root text beside
// Bhikkhu Sujato's CC0 translation, all 423 verses in 26 vaggas.
//
//   bun run scripts/dev/import-dhammapada.ts
//
// The earlier corpus held verses 1–5 of the first chapter. This replaces that
// sample with the whole anthology so the Buddhist shelf has a complete work
// rather than an excerpt.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const WORK = join(ROOT, "data", "corpus", "works", "dhammapada.json");
const FUNCTIONS = join(ROOT, "data", "corpus", "text-functions.json");
const MANIFEST = join(ROOT, "data", "imports", "dhammapada-suttacentral.json");
const RETRIEVED_AT = new Date().toISOString().slice(0, 10);

const VAGGAS: { range: string; name: string }[] = [
  { range: "dhp1-20", name: "Yamaka Vagga — The Twin Verses" },
  { range: "dhp21-32", name: "Appamāda Vagga — Heedfulness" },
  { range: "dhp33-43", name: "Citta Vagga — The Mind" },
  { range: "dhp44-59", name: "Puppha Vagga — Flowers" },
  { range: "dhp60-75", name: "Bāla Vagga — The Fool" },
  { range: "dhp76-89", name: "Paṇḍita Vagga — The Wise" },
  { range: "dhp90-99", name: "Arahanta Vagga — The Perfected" },
  { range: "dhp100-115", name: "Sahassa Vagga — Thousands" },
  { range: "dhp116-128", name: "Pāpa Vagga — Evil" },
  { range: "dhp129-145", name: "Daṇḍa Vagga — The Rod" },
  { range: "dhp146-156", name: "Jara Vagga — Old Age" },
  { range: "dhp157-166", name: "Atta Vagga — The Self" },
  { range: "dhp167-178", name: "Loka Vagga — The World" },
  { range: "dhp179-196", name: "Buddha Vagga — The Buddha" },
  { range: "dhp197-208", name: "Sukha Vagga — Happiness" },
  { range: "dhp209-220", name: "Piya Vagga — Affection" },
  { range: "dhp221-234", name: "Kodha Vagga — Anger" },
  { range: "dhp235-255", name: "Mala Vagga — Stains" },
  { range: "dhp256-272", name: "Dhammaṭṭha Vagga — The Just" },
  { range: "dhp273-289", name: "Magga Vagga — The Path" },
  { range: "dhp290-305", name: "Pakiṇṇaka Vagga — Miscellaneous" },
  { range: "dhp306-319", name: "Niraya Vagga — Hell" },
  { range: "dhp320-333", name: "Nāga Vagga — The Elephant" },
  { range: "dhp334-359", name: "Taṇhā Vagga — Craving" },
  { range: "dhp360-382", name: "Bhikkhu Vagga — The Mendicant" },
  { range: "dhp383-423", name: "Brāhmaṇa Vagga — The Brahmin" },
];

function text(value: unknown): string {
  const raw = Array.isArray(value) ? value.join(" ") : String(value ?? "");
  return raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchRange(range: string) {
  const url = `https://suttacentral.net/api/bilarasuttas/${range}/sujato`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as any;
      if (!data?.keys_order?.length) throw new Error("no segments returned");
      return data;
    } catch (err) {
      if (attempt === 4) throw err;
      await Bun.sleep(1000 * attempt);
    }
  }
  throw new Error(`${range}: fetch failed`);
}

const chapters = VAGGAS.map((v, i) => ({ ref: String(i + 1), label: `Chapter ${i + 1} — ${v.name}` }));
const passages: { reference: string; label: string; chapterRef: string }[] = [];
const paliTexts: Record<string, string> = {};
const englishTexts: Record<string, string> = {};

for (const [index, vagga] of VAGGAS.entries()) {
  const data = await fetchRange(vagga.range);
  const byVerse = new Map<number, { key: string; pali: string[]; english: string[] }>();
  for (const key of data.keys_order as string[]) {
    const match = /^dhp(\d+):(.+)$/.exec(key);
    if (!match) continue;
    const verse = Number(match[1]);
    const segment = match[2];
    // Segment 0.x carries the chapter heading, not a verse.
    if (segment.startsWith("0")) continue;
    if (!byVerse.has(verse)) byVerse.set(verse, { key, pali: [], english: [] });
    const entry = byVerse.get(verse)!;
    const pali = text(data.root_text?.[key]);
    const english = text(data.translation_text?.[key]);
    if (pali) entry.pali.push(pali);
    if (english) entry.english.push(english);
  }
  for (const verse of [...byVerse.keys()].sort((a, b) => a - b)) {
    const entry = byVerse.get(verse)!;
    const reference = String(verse);
    passages.push({ reference, label: `Verse ${verse}`, chapterRef: String(index + 1) });
    if (entry.pali.length) paliTexts[reference] = entry.pali.join(" ");
    if (entry.english.length) englishTexts[reference] = entry.english.join(" ");
  }
  await Bun.sleep(80);
}

passages.sort((a, b) => Number(a.reference) - Number(b.reference));
const missing = passages.filter((p) => !paliTexts[p.reference] || !englishTexts[p.reference]);
if (missing.length) throw new Error(`${missing.length} verses lack text, e.g. ${missing[0].reference}`);
if (passages.length !== 423) throw new Error(`expected 423 verses, got ${passages.length}`);

const existing = JSON.parse(readFileSync(WORK, "utf8"));
const work = {
  ...existing,
  description:
    "The Dhammapada is a compact anthology of 423 verses on mind, conduct, suffering and liberation, arranged in 26 chapters. This edition presents the complete Pali root text beside Bhikkhu Sujato's English translation.",
  refScheme: "verse",
  isSample: false,
  chapters,
  passages,
  editions: [
    {
      slug: "dhammapada-pi-sc",
      language: "pi",
      editionType: "original",
      title: "Dhammapada (Pali root text)",
      publisher: "SuttaCentral (Mahāsaṅgīti Tipiṭaka)",
      publicationYear: null,
      source: "suttacentral",
      license: "public-domain",
      rightsStatus: "Public domain root text as published by SuttaCentral",
      attributionText:
        "Dhammapada root text, Mahāsaṅgīti Tipiṭaka edition, retrieved from SuttaCentral. Root text reproduced without modification.",
      structureScheme: "chapter and verse",
      isSample: false,
      notes: "Segmented Pali text; SuttaCentral segment numbers are not shown in the reader.",
      texts: paliTexts,
    },
    {
      slug: "dhammapada-en-sujato",
      language: "en",
      editionType: "translation",
      title: "Dhammapada, translated by Bhikkhu Sujato",
      translator: "Bhikkhu Sujato",
      publisher: "SuttaCentral",
      publicationYear: 2018,
      source: "suttacentral",
      license: "cc0-1.0",
      rightsStatus: "CC0 1.0 public domain dedication",
      attributionText:
        "Dhammapada, translated by Bhikkhu Sujato, SuttaCentral, CC0 1.0. Retrieved from the Bilara translation data.",
      structureScheme: "chapter and verse",
      isSample: false,
      notes: "A modern translation released under CC0. Segmentation follows the Pali source.",
      texts: englishTexts,
    },
  ],
};

// The verses are streamed from SuttaCentral at read time. Keep the chapter and
// verse index; drop the copied text from the corpus.
for (const edition of work.editions) delete (edition as any).texts;
(work as any).textStorage = "streamed";

const STREAMS = join(ROOT, "data", "registry", "streams.json");
const streams = JSON.parse(readFileSync(STREAMS, "utf8"));
streams.works.dhammapada = {
  provider: "suttacentral",
  upstream: "dhammapada",
  mode: "numbered",
  licence: "cc0-1.0",
  config: {
    mode: "dhammapada",
    translator: "sujato",
    rootTranslator: "sujato",
    ranges: VAGGAS.map((v) => v.range),
  },
  editions: work.editions.map((e: any) => ({
    slug: e.slug,
    language: e.language,
    languageName: e.language === "pi" ? "pi" : "english",
    version: e.language === "pi" ? "Pali root text (SuttaCentral)" : "Bhikkhu Sujato (SuttaCentral)",
    license: e.license,
    sourceUrl: "https://suttacentral.net/",
  })),
};
writeFileSync(STREAMS, `${JSON.stringify(streams, null, 2)}\n`);

const serialized = JSON.stringify(work, null, 2) + "\n";
writeFileSync(WORK, serialized);

const functions = JSON.parse(readFileSync(FUNCTIONS, "utf8"));
functions.works.dhammapada = {
  ...functions.works.dhammapada,
  note:
    "Part of the Theravada Khuddaka Nikaya; its status and arrangement differ in other Buddhist canons. The complete Pali text and a CC0 translation are presented side by side.",
};
writeFileSync(FUNCTIONS, JSON.stringify(functions, null, 2) + "\n");

writeFileSync(
  MANIFEST,
  JSON.stringify(
    {
      source: "suttacentral",
      source_url: "https://suttacentral.net/",
      retrieved_at: RETRIEVED_AT,
      translator: "Bhikkhu Sujato",
      licence: { root: "public domain (Mahāsaṅgīti Tipiṭaka)", translation: "CC0 1.0" },
      totals: { chapters: chapters.length, verses: passages.length, paliVerses: Object.keys(paliTexts).length, englishVerses: Object.keys(englishTexts).length },
      sha256: new Bun.CryptoHasher("sha256").update(serialized).digest("hex"),
    },
    null,
    2,
  ) + "\n",
);

console.log(`Imported the Dhammapada: ${chapters.length} chapters, ${passages.length} verses, 2 editions.`);
