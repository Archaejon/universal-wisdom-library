// Adds the Dīgha and Majjhima Nikāyas to the catalogue as streamed works.
//
// Only structure is imported: each sutta's segment list (the reading order and
// reference labels) is recorded, while the Pali root text and Bhikkhu Sujato's
// CC0 translation are fetched from SuttaCentral when someone opens the sutta.
// Nothing from the suttas is written into the library database.
//
//   bun run scripts/dev/import-suttacentral-suttas.ts
//   bun run scripts/dev/import-suttacentral-suttas.ts --nikaya=dn
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");
const STREAMS = join(ROOT, "data", "registry", "streams.json");
const FUNCTIONS = join(ROOT, "data", "corpus", "text-functions.json");
const MANIFEST = join(ROOT, "data", "imports", "suttacentral-suttas.json");
const RETRIEVED_AT = new Date().toISOString().slice(0, 10);

const args = process.argv.slice(2);
const nikayaArg = args.find((a) => a.startsWith("--nikaya="))?.split("=")[1];
const concurrency = Math.max(1, Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? 4));

type Nikaya = {
  key: "dn" | "mn";
  pali: string;
  english: string;
  category: string;
  max: number;
  description: string;
  context: string;
};

const NIKAYAS: Nikaya[] = [
  {
    key: "dn",
    pali: "Dīgha Nikāya",
    english: "Long Discourses",
    category: "Dīgha Nikāya",
    max: 34,
    description:
      "The Long Discourses collect thirty-four suttas of the Pali canon, including the Brahmajāla, the Sāmaññaphala and the Mahāparinibbāna. They are preserved in Pali and translated here by Bhikkhu Sujato.",
    context:
      "The Dīgha Nikāya belongs to the Sutta Piṭaka of the Theravada canon. The discourses were transmitted orally and written down in Sri Lanka in the first century BCE; the collection as it survives reflects that transmission.",
  },
  {
    key: "mn",
    pali: "Majjhima Nikāya",
    english: "Middle Length Discourses",
    category: "Majjhima Nikāya",
    max: 152,
    description:
      "The Middle Length Discourses gather 152 suttas of the Pali canon, among them the Satipaṭṭhāna, the Alagaddūpama and the Cūḷamālukya suttas. They are preserved in Pali and translated here by Bhikkhu Sujato.",
    context:
      "The Majjhima Nikāya belongs to the Sutta Piṭaka of the Theravada canon. Its discourses are central to the study of early Buddhist doctrine and practice in every Buddhist tradition that preserves them.",
  },
];

function slugFor(uid: string) {
  return `sutta-${uid}`;
}

async function fetchSutta(uid: string) {
  const url = `https://suttacentral.net/api/bilarasuttas/${uid}/sujato`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "UniversalWisdomLibrary/1.0 (catalogue structure only)" },
        signal: AbortSignal.timeout(45_000),
      });
      if (res.status === 429 || res.status >= 500) {
        await Bun.sleep(800 * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`${uid}: HTTP ${res.status}`);
      return (await res.json()) as any;
    } catch (err) {
      if (attempt === 4) throw err;
      await Bun.sleep(500 * attempt);
    }
  }
  throw new Error(`${uid}: fetch failed`);
}

const streams = JSON.parse(readFileSync(STREAMS, "utf8"));
const functions = JSON.parse(readFileSync(FUNCTIONS, "utf8"));
const manifest: any = {
  source: "suttacentral",
  source_url: "https://suttacentral.net/",
  retrieved_at: RETRIEVED_AT,
  translator: "Bhikkhu Sujato",
  licence: "CC0 1.0",
  note:
    "Sutta structure only. Pali root text and the CC0 English translation are streamed from suttacentral.net at read time; no sutta text is stored in this corpus.",
  suttas: [],
  totals: { suttas: 0, passages: 0 },
};

const selected = nikayaArg ? NIKAYAS.filter((n) => n.key === nikayaArg) : NIKAYAS;
if (!selected.length) throw new Error(`Unknown --nikaya=${nikayaArg}; expected dn or mn`);

let done = 0;
async function importSutta(nikaya: Nikaya, number: number) {
  const uid = `${nikaya.key}${number}`;
  const slug = slugFor(uid);
  const body = await fetchSutta(uid);
  const english: Record<string, string> = body?.translation_text ?? {};
  const pali: Record<string, string> = body?.root_text ?? {};
  const keys: string[] = Array.isArray(body?.keys_order) ? body.keys_order : Object.keys(english);
  if (!keys.length) throw new Error(`${uid}: no segments`);

  // Keep only segments that carry translated text. The Pali edition keeps a
  // blank slot where the translator has no counterpart, so both editions stay
  // aligned with the passage index.
  // Segment ids ending in `:0.1`/`:0.2` are the collection and sutta titles
  // SuttaCentral renders as a heading, not as part of the discourse.
  const readingKeys = keys.filter(
    (key) => String(english[key] ?? "").trim().length > 0 && !/:0\.\d+$/.test(key),
  );
  if (!readingKeys.length) throw new Error(`${uid}: no translated segments`);

  const title = String(english[`${uid}:0.2`] ?? english[`${uid}:0.1`] ?? uid).trim();
  const paliTitle = String(pali[`${uid}:0.2`] ?? uid).trim();
  const label = `${uid.toUpperCase()} · ${title}`;

  const work = {
    slug,
    title: `${title} (${uid.toUpperCase()})`,
    originalTitle: paliTitle,
    transliteration: "",
    altTitles: [title],
    tradition: "buddhism",
    school: "theravada",
    genre: "Scripture",
    textType: "Discourse",
    category: "Sutta",
    subcategory: nikaya.category,
    originalLanguage: "pi",
    dateStart: -400,
    dateEnd: -100,
    dateDisplay: "Composed c. 4th–2nd centuries BCE; written down in the 1st century BCE",
    authorshipStatus: "anonymous",
    author: "buddha",
    attributionNote:
      "The discourse is presented in the canonical collection as the Buddha's teaching, transmitted by the early Buddhist community. Authorship of the surviving Pali text is collective and anonymous.",
    description: `${title} is sutta ${number} of the ${nikaya.pali} (${nikaya.english}). ${nikaya.description}`,
    historicalContext: nikaya.context,
    availabilityNote: "",
    featured: false,
    featuredNote: "",
    refScheme: "chapter.paragraph",
    isSample: false,
    textStorage: "streamed",
    chapters: [{ ref: uid, label }],
    passages: readingKeys.map((key, index) => ({
      reference: String(index + 1),
      label: key,
      chapterRef: uid,
    })),
    editions: [
      {
        slug: `${slug}-pi-sc`,
        language: "pi",
        editionType: "original",
        title: `${nikaya.pali} ${number} — Pali root text`,
        translator: "",
        publisher: "SuttaCentral",
        source: "suttacentral",
        license: "cc0-1.0",
        rightsStatus: "CC0 1.0 public-domain dedication",
        attributionText: `Pali root text from SuttaCentral (${nikaya.pali} ${number}).`,
        structureScheme: "SuttaCentral segment ids",
        isSample: false,
      },
      {
        slug: `${slug}-en-sujato`,
        language: "en",
        editionType: "translation",
        title: `${title} — Bhikkhu Sujato`,
        translator: "Bhikkhu Sujato",
        publisher: "SuttaCentral",
        publicationYear: 2018,
        source: "suttacentral",
        license: "cc0-1.0",
        rightsStatus: "CC0 1.0 public-domain dedication",
        attributionText: `Translation by Bhikkhu Sujato, SuttaCentral (${uid.toUpperCase()}), released under CC0 1.0.`,
        structureScheme: "SuttaCentral segment ids",
        isSample: false,
      },
    ],
  };

  writeFileSync(join(WORKS, `${slug}.json`), `${JSON.stringify(work, null, 2)}\n`);
  streams.works[slug] = {
    provider: "suttacentral",
    upstream: uid,
    mode: "numbered",
    licence: "cc0-1.0",
    config: { translator: "sujato", rootTranslator: "sujato" },
    editions: [
      {
        slug: `${slug}-pi-sc`,
        language: "pi",
        languageName: "pi",
        version: "Pali root text (SuttaCentral)",
        license: "cc0-1.0",
        sourceUrl: "https://suttacentral.net/",
      },
      {
        slug: `${slug}-en-sujato`,
        language: "en",
        languageName: "english",
        version: "Bhikkhu Sujato (SuttaCentral)",
        license: "cc0-1.0",
        sourceUrl: "https://suttacentral.net/",
      },
    ],
  };
  functions.works[slug] = {
    functions: ["canonical_scripture", "philosophical_work"],
    status: "provisional",
    note:
      "A discourse of the Pali Sutta Piṭaka, canonical for Theravada Buddhism and widely studied across Buddhist traditions. The English translation is CC0; the Pali root text is streamed from SuttaCentral.",
  };
  manifest.suttas.push({
    uid,
    slug,
    title: work.title,
    pali_title: paliTitle,
    nikaya: nikaya.category,
    passages: work.passages.length,
    licence: "CC0 1.0",
    translator: "Bhikkhu Sujato",
  });
  manifest.totals.suttas++;
  manifest.totals.passages += work.passages.length;
  done++;
  if (done % 10 === 0) console.log(`  ${done} suttas imported (${uid})`);
}

const queue: { nikaya: Nikaya; number: number }[] = [];
for (const nikaya of selected) {
  for (let n = 1; n <= nikaya.max; n++) queue.push({ nikaya, number: n });
}
let cursor = 0;
async function worker() {
  while (cursor < queue.length) {
    const item = queue[cursor++];
    await importSutta(item.nikaya, item.number);
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));

streams.generatedAt = RETRIEVED_AT;
writeFileSync(STREAMS, `${JSON.stringify(streams, null, 2)}\n`);
writeFileSync(FUNCTIONS, `${JSON.stringify(functions, null, 2)}\n`);
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `Imported ${manifest.totals.suttas} suttas (${manifest.totals.passages} segments) as streamed works. ` +
    `No sutta text was stored.`,
);
