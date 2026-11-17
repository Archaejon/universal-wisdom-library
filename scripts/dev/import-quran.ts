// Complete Qur'an import from AlQuran Cloud, which serves the Tanzil Uthmani
// text and a public-domain English translation.
//
//   bun run scripts/dev/import-quran.ts
//
// The earlier corpus carried three sample passages. This replaces that sample
// with all 114 surahs and 6,236 ayahs, keeping the Arabic and the translation
// as separate editions so neither is mistaken for the other. The Tanzil terms
// require verbatim reproduction, so the ayah text is copied unchanged.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const WORK = join(ROOT, "data", "corpus", "works", "quran.json");
const FUNCTIONS = join(ROOT, "data", "corpus", "text-functions.json");
const MANIFEST = join(ROOT, "data", "imports", "quran-alquran-cloud.json");
const RETRIEVED_AT = new Date().toISOString().slice(0, 10);

type Surah = {
  number: number;
  name: string;
  englishName: string;
  englishNameTranslation: string;
  revelationType: string;
  ayahs: { numberInSurah: number; text: string }[];
};

async function fetchEdition(edition: string): Promise<Surah[]> {
  const url = `https://api.alquran.cloud/v1/quran/${edition}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as any;
      const surahs = data?.data?.surahs as Surah[] | undefined;
      if (!surahs?.length) throw new Error("no surahs returned");
      return surahs;
    } catch (err) {
      if (attempt === 4) throw err;
      console.log(`  ${edition}: ${(err as Error).message}; retrying`);
      await Bun.sleep(1500 * attempt);
    }
  }
  throw new Error(`${edition}: fetch failed`);
}

function clean(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\s+/g, " ").trim();
}

const arabic = await fetchEdition("quran-uthmani");
const english = await fetchEdition("en.pickthall");
const totalAyahs = arabic.reduce((n, s) => n + s.ayahs.length, 0);
const englishAyahs = english.reduce((n, s) => n + s.ayahs.length, 0);
if (totalAyahs !== englishAyahs) {
  throw new Error(`ayah counts differ: Arabic ${totalAyahs}, English ${englishAyahs}`);
}
if (arabic.length !== 114 || english.length !== 114) {
  throw new Error(`expected 114 surahs, got ${arabic.length} and ${english.length}`);
}

const existing = JSON.parse(readFileSync(WORK, "utf8"));
const chapters = arabic.map((surah) => ({
  ref: String(surah.number),
  label: `Surah ${surah.number} — ${surah.englishName} (${surah.englishNameTranslation})`,
}));
const passages: { reference: string; label: string; chapterRef: string }[] = [];
const arabicTexts: Record<string, string> = {};
const englishTexts: Record<string, string> = {};

for (const surah of arabic) {
  const translation = english.find((s) => s.number === surah.number)!;
  for (const ayah of surah.ayahs) {
    const reference = `${surah.number}.${ayah.numberInSurah}`;
    passages.push({ reference, label: `${surah.number}:${ayah.numberInSurah}`, chapterRef: String(surah.number) });
    arabicTexts[reference] = clean(ayah.text);
    const translated = translation.ayahs.find((a) => a.numberInSurah === ayah.numberInSurah);
    if (translated) englishTexts[reference] = clean(translated.text);
  }
}

const work = {
  ...existing,
  title: "The Qur’an",
  originalTitle: "القرآن الكريم",
  altTitles: ["Koran", "Al-Qur'an", "Al-Qur’ān"],
  attributionNote:
    "Muslims confess the Qur’an as the word of God revealed to the Prophet Muhammad. The work record does not reduce that claim to ordinary human authorship. Historical scholarship studies the text’s composition and transmission in its late antique context.",
  description:
    "The Qur’an is recited in Arabic across the Muslim world and consists of 114 surahs. This edition presents the complete text: the Tanzil Uthmani Arabic and M. M. Pickthall’s English translation as separate editions, each with its own attribution.",
  featuredNote: "Mercy, sovereignty and human difference",
  refScheme: "surah.ayah",
  isSample: false,
  chapters,
  passages,
  editions: [
    {
      slug: "quran-ar-uthmani",
      language: "ar",
      editionType: "original",
      title: "Tanzil Quran Text (Uthmani)",
      publisher: "Tanzil Project",
      publicationYear: null,
      source: "alquran-cloud",
      license: "cc-by-3.0",
      rightsStatus: "Tanzil text terms: verbatim copying permitted, modification not allowed",
      attributionText:
        "Tanzil Quran Text (Uthmani), Copyright (C) 2007–2024 Tanzil Project, CC BY 3.0. Retrieved via AlQuran Cloud. Reproduced verbatim without modification.",
      structureScheme: "surah and ayah",
      isSample: false,
      notes: "Arabic text only. No translation is mixed into this edition.",
      texts: arabicTexts,
    },
    {
      slug: "quran-en-pickthall",
      language: "en",
      editionType: "translation",
      title: "The Meaning of the Glorious Koran, translated by M. M. Pickthall",
      translator: "Mohammed Marmaduke William Pickthall",
      publisher: "AlQuran Cloud digital edition",
      publicationYear: 1930,
      source: "alquran-cloud",
      license: "public-domain",
      rightsStatus: "Public domain (translator died 1936; translation published 1930)",
      attributionText:
        "The Meaning of the Glorious Koran, translated by Mohammed Marmaduke Pickthall (1930). Public domain. Text retrieved via AlQuran Cloud.",
      structureScheme: "surah and ayah",
      isSample: false,
      notes:
        "An early twentieth-century English translation by a British Muslim scholar. Its diction reflects its period; it is presented as one translator's reading, not as a neutral rendering.",
      texts: englishTexts,
    },
  ],
};

// The text is streamed from AlQuran Cloud at read time. Keep the surah/ayah
// index and the edition record; drop the copied verses from the corpus.
for (const edition of work.editions) delete (edition as any).texts;
(work as any).textStorage = "streamed";

const STREAMS = join(ROOT, "data", "registry", "streams.json");
const streams = JSON.parse(readFileSync(STREAMS, "utf8"));
streams.works.quran = {
  provider: "alquran-cloud",
  upstream: "quran",
  mode: "numbered",
  licence: "cc-by-3.0",
  config: {},
  editions: work.editions.map((e: any) => ({
    slug: e.slug,
    language: e.language,
    languageName: e.language === "ar" ? "arabic" : "english",
    version: e.slug === "quran-ar-uthmani" ? "quran-uthmani" : "en.pickthall",
    license: e.license,
    sourceUrl: "https://alquran.cloud/",
  })),
};
writeFileSync(STREAMS, `${JSON.stringify(streams, null, 2)}\n`);

const serialized = JSON.stringify(work, null, 2) + "\n";
writeFileSync(WORK, serialized);
const sha256 = new Bun.CryptoHasher("sha256").update(serialized).digest("hex");

const functions = JSON.parse(readFileSync(FUNCTIONS, "utf8"));
functions.works.quran = {
  functions: ["canonical_scripture", "foundational_revelation", "prayer_liturgy"],
  assignedBy: "UWL editors (comparative taxonomy)",
  status: "affirmed",
  note:
    "Muslims confess the Qur’an as revealed scripture; recitation is central to worship. The classification records that claim and the text’s liturgical use.",
};
writeFileSync(FUNCTIONS, JSON.stringify(functions, null, 2) + "\n");

writeFileSync(
  MANIFEST,
  JSON.stringify(
    {
      source: "alquran-cloud",
      source_url: "https://api.alquran.cloud/",
      upstream_text: "Tanzil Quran Text (Uthmani)",
      retrieved_at: RETRIEVED_AT,
      licence: {
        arabic: "Tanzil text terms: verbatim copying permitted, modification not allowed (CC BY 3.0 as published by Tanzil)",
        english: "Public domain: The Meaning of the Glorious Koran, M. M. Pickthall (1930)",
      },
      totals: { surahs: chapters.length, ayahs: passages.length, arabicAyahs: Object.keys(arabicTexts).length, englishAyahs: Object.keys(englishTexts).length },
      sha256,
    },
    null,
    2,
  ) + "\n",
);

console.log(`Imported the Qur’an: ${chapters.length} surahs, ${passages.length} ayahs, 2 editions.`);
