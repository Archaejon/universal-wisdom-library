// Expands the Islamic shelf with requested works that have a verifiable text
// source. Nothing is copied into this repository: the catalogue record, the
// surah/hadith outline and the passage index are written here, and the text is
// requested from the host when someone reads.
//
//   * Tafsir al-Tabari, Tafsir Ibn Kathir and al-Qurtubi's Jami' are classical
//     Arabic commentaries. The Arabic works are public domain; Quran.com's
//     tafsir resources serve one surah at a time, aligned ayah by ayah with the
//     library's own Qur'an edition.
//   * Al-Arba'in al-Nawawiyya is served by the Hadith API, Arabic beside the
//     English translation.
//
//   bun run scripts/dev/import-islamic-expansion.ts
//   bun run scripts/dev/import-islamic-expansion.ts --only=tafsir
//   bun run scripts/dev/import-islamic-expansion.ts --only=nawawi-forty
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");
const META = join(ROOT, "data", "corpus", "meta.json");
const STREAMS = join(ROOT, "data", "registry", "streams.json");
const FUNCTIONS = join(ROOT, "data", "corpus", "text-functions.json");
const MANIFEST = join(ROOT, "data", "imports", "islamic-sources.json");
const RETRIEVED_AT = new Date().toISOString().slice(0, 10);
const USER_AGENT = "UniversalWisdomLibrary/1.0 (local reading interface; import and streaming)";

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.split("=")[1] ?? "";

async function getJson(url: string): Promise<any> {
  let last: Error | null = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(90_000),
      });
      if (res.status === 429 || res.status >= 500) {
        last = new Error(`${url} returned ${res.status}`);
        await Bun.sleep(800 * attempt * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      return await res.json();
    } catch (err) {
      last = err as Error;
      if (attempt < 4) await Bun.sleep(500 * attempt);
    }
  }
  throw last ?? new Error(`${url} failed`);
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

const meta = readJson(META);
const streams = readJson(STREAMS);
const functions = readJson(FUNCTIONS);
const manifest = readJson(MANIFEST);
const quran = readJson(join(WORKS, "quran.json"));

// ---------------------------------------------------------------------------
// Authors and source records
// ---------------------------------------------------------------------------

const AUTHORS = [
  {
    slug: "al-tabari",
    name: "Abu Ja'far al-Tabari",
    sort_name: "Tabari, Abu Ja'far al-",
    birth_year: 839,
    death_year: 923,
    date_display: "839–923",
    description:
      "Historian, Qur'an commentator and jurist of Baghdad, whose Jami' al-Bayan gathers the readings, transmitters and legal opinions behind each verse.",
    is_attributed: false,
  },
  {
    slug: "ibn-kathir",
    name: "Isma'il ibn Kathir",
    sort_by: "",
    sort_name: "Ibn Kathir, Isma'il",
    birth_year: 1301,
    death_year: 1373,
    date_display: "c. 1301–1373",
    description:
      "Damascene historian, jurist and Qur'an commentator, a student of Ibn Taymiyya whose Tafsir al-Qur'an al-'Azim reads the Qur'an through hadith and the reports of the first generations.",
    is_attributed: false,
  },
  {
    slug: "al-qurtubi",
    name: "Abu Abd Allah al-Qurtubi",
    sort_name: "Qurtubi, Abu Abd Allah al-",
    birth_year: 1214,
    death_year: 1273,
    date_display: "1214–1273",
    description:
      "Andalusian commentator who settled in Egypt, best known for al-Jami' li-Ahkam al-Qur'an, a tafsir organised around the legal rulings a verse yields.",
    is_attributed: false,
  },
  {
    slug: "al-nawawi",
    name: "Yahya ibn Sharaf al-Nawawi",
    sort_name: "Nawawi, Yahya ibn Sharaf al-",
    birth_year: 1233,
    death_year: 1277,
    date_display: "1233–1277",
    description:
      "Damascene Shafi'i jurist and hadith scholar, author of the Forty Hadith, the Riyad al-Salihin and the most widely used commentary on Sahih Muslim.",
    is_attributed: false,
  },
];

function ensureMeta() {
  const authors: any[] = meta.authors;
  let added = 0;
  for (const author of AUTHORS) {
    if (authors.some((a) => a.slug === author.slug)) continue;
    const clean: any = { ...author };
    delete clean.sort_by;
    authors.push(clean);
    added++;
  }
  const sources: any[] = meta.sources;
  if (!sources.some((s) => s.slug === "quran-com-tafsir")) {
    sources.push({
      slug: "quran-com-tafsir",
      name: "Quran.com tafsir resources",
      provider: "Quran.com",
      url: "https://quran.com/",
      description:
        "Arabic commentary on the Qur'an, served surah by surah from Quran.com's tafsir resources.",
      access_notes:
        "The Arabic commentaries are public-domain works. The digital text is served by Quran.com and is not relicensed by this library; the catalogue records the resource used for each work.",
      retrieved_at: RETRIEVED_AT,
      is_live: 1,
      status: "connected",
    });
    added++;
  }
  if (added) writeFileSync(META, `${JSON.stringify(meta, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Tafsir works (Quran.com)
// ---------------------------------------------------------------------------

type TafsirSpec = {
  slug: string;
  resourceId: number;
  title: string;
  originalTitle: string;
  transliteration: string;
  altTitles: string[];
  author: string;
  dateStart: number;
  dateEnd: number;
  dateDisplay: string;
  editionTitle: string;
  description: string;
  historicalContext: string;
};

const TAFSIRS: TafsirSpec[] = [
  {
    slug: "tafsir-al-tabari",
    resourceId: 15,
    title: "Jami' al-Bayan 'an Ta'wil Ay al-Qur'an",
    originalTitle: "جامع البيان عن تأويل آي القرآن",
    transliteration: "Jāmiʿ al-Bayān ʿan Taʾwīl Āy al-Qurʾān",
    altTitles: ["Tafsir al-Tabari", "The Commentary of al-Tabari"],
    author: "al-tabari",
    dateStart: 896,
    dateEnd: 923,
    dateDisplay: "composed c. 896–923 CE",
    editionTitle: "Jami' al-Bayan (Arabic text served by Quran.com)",
    description:
      "Al-Tabari's commentary proceeds verse by verse, gathering the readings of the Qur'an, the reports of the Companions and Successors, and the opinions of the early jurists before stating which reading he prefers and why. It is the earliest surviving commentary of this scope and the source from which much later tafsir quotes.",
    historicalContext:
      "Composed in Baghdad over the last decades of al-Tabari's life, when the city was the centre of Qur'anic and legal scholarship. The work's method — transmission first, judgement second — became a model for Sunni tafsir, and its reports are still cited as evidence for how the earliest generations read individual verses.",
  },
  {
    slug: "tafsir-ibn-kathir",
    resourceId: 14,
    title: "Tafsir al-Qur'an al-'Azim",
    originalTitle: "تفسير القرآن العظيم",
    transliteration: "Tafsīr al-Qurʾān al-ʿAẓīm",
    altTitles: ["Tafsir Ibn Kathir"],
    author: "ibn-kathir",
    dateStart: 1340,
    dateEnd: 1373,
    dateDisplay: "composed c. 1340–1373 CE",
    editionTitle: "Tafsir al-Qur'an al-'Azim (Arabic text served by Quran.com)",
    description:
      "Ibn Kathir's commentary reads each verse through the Qur'an itself, then the sound hadith, then the reports of the Companions and Successors, and uses the tools of hadith criticism to weigh them. Its combination of narrative and legal material made it one of the most widely circulated tafsirs in the later Sunni world.",
    historicalContext:
      "Written in Damascus in the fourteenth century by a historian and hadith scholar trained in the circle of Ibn Taymiyya. Its preference for transmitted reports over speculative theology gave it a central place in later reformist and Salafi reading, while its comparative material keeps it useful to historians of exegesis.",
  },
  {
    slug: "tafsir-al-qurtubi",
    resourceId: 90,
    title: "Al-Jami' li-Ahkam al-Qur'an",
    originalTitle: "الجامع لأحكام القرآن",
    transliteration: "al-Jāmiʿ li-Aḥkām al-Qurʾān",
    altTitles: ["Tafsir al-Qurtubi"],
    author: "al-qurtubi",
    dateStart: 1240,
    dateEnd: 1273,
    dateDisplay: "composed c. 1240–1273 CE",
    editionTitle: "Al-Jami' li-Ahkam al-Qur'an (Arabic text served by Quran.com)",
    description:
      "Al-Qurtubi's commentary is organised around the legal and ethical rulings a verse yields, with the readings, grammar, abrogation and the disagreements of the schools set out before his own position. It is the standard tafsir of the Maliki tradition and a major source for comparative fiqh.",
    historicalContext:
      "Written in Egypt by an Andalusian scholar who had moved east. Its attention to the legal consequences of the text reflects the maturity of the Maliki school in the thirteenth century, and its quotations preserve opinions of earlier jurists whose own works are lost.",
  },
];

function chapterOutline() {
  return (quran.chapters as any[]).map((c) => ({ ref: c.ref, label: c.label }));
}

function passageOutline() {
  return (quran.passages as any[]).map((p) => ({
    reference: p.reference,
    label: p.label,
    chapterRef: p.chapterRef,
  }));
}

function recordWork(entry: any) {
  const index = (manifest.works as any[]).findIndex((w) => w.slug === entry.slug);
  if (index >= 0) manifest.works[index] = entry;
  else manifest.works.push(entry);
}

function buildTafsir(spec: TafsirSpec) {
  const chapters = chapterOutline();
  const passages = passageOutline();
  const editionSlug = `${spec.slug}-ar`;
  const editionTitle = spec.editionTitle;

  const work = {
    slug: spec.slug,
    title: spec.title,
    originalTitle: spec.originalTitle,
    transliteration: spec.transliteration,
    altTitles: spec.altTitles,
    tradition: "islam",
    school: "sunni-tradition",
    genre: "Qur'an commentary",
    textType: "Tafsir",
    category: "Qur'anic studies",
    subcategory: "Tafsir",
    originalLanguage: "ar",
    dateStart: spec.dateStart,
    dateEnd: spec.dateEnd,
    dateDisplay: spec.dateDisplay,
    authorshipStatus: "established",
    author: spec.author,
    attributionNote:
      "The commentary is the author's own work; the reports and opinions it quotes are attributed within the text to their transmitters.",
    description: spec.description,
    historicalContext: spec.historicalContext,
    availabilityNote:
      "Streamed from Quran.com at read time: the Arabic commentary for one surah is requested and aligned ayah by ayah with this library's Qur'an passage index. Only the catalogue record, the surah outline and the passage index are held here.",
    featured: false,
    featuredNote: "",
    refScheme: "surah.ayah",
    isSample: false,
    textStorage: "streamed",
    chapters,
    passages,
    editions: [
      {
        slug: editionSlug,
        language: "ar",
        editionType: "original",
        title: editionTitle,
        translator: "",
        publisher: "Quran.com",
        publicationYear: null,
        source: "quran-com-tafsir",
        license: "public-domain",
        rightsStatus: "The Arabic commentary is a public-domain work; the digital text is served by Quran.com",
        attributionText: `${spec.title} by ${AUTHORS.find((a) => a.slug === spec.author)?.name ?? spec.author}. Arabic text served by Quran.com. The work is public domain; the digital transcription is credited to the host and is not relicensed here.`,
        structureScheme: "surah and ayah; one commentary segment per ayah",
        isSample: false,
        notes:
          "The Arabic commentary is shown as received. No English translation is included, because no public-domain English translation was verified.",
      },
    ],
  };

  writeFileSync(join(WORKS, `${spec.slug}.json`), `${JSON.stringify(work, null, 2)}\n`);
  streams.works[spec.slug] = {
    provider: "quran-tafsir",
    upstream: `Quran.com tafsir ${spec.resourceId}`,
    mode: "numbered",
    licence: "public-domain",
    config: {
      resourceId: spec.resourceId,
      api: "https://api.quran.com/api/v4",
      sourceUrl: "https://quran.com/",
      edition: editionTitle,
    },
    editions: [
      {
        slug: editionSlug,
        language: "ar",
        languageName: "arabic",
        version: editionTitle,
        license: "public-domain",
        sourceUrl: "https://quran.com/",
      },
    ],
  };
  functions.works[spec.slug] = {
    functions: ["commentary_exegesis", "canonical_scripture"],
    status: "provisional",
    assignedBy: "UWL editors (comparative taxonomy)",
    note: `${spec.title} — Qur'anic studies. Arabic commentary streamed from Quran.com, one surah at a time.`,
  };
  recordWork({
    slug: spec.slug,
    host: "quran-com-tafsir",
    upstream: `https://quran.com/tafsirs/${spec.resourceId}`,
    chapters: chapters.length,
    passages: passages.length,
    translator: "",
  });
  console.log(`  ${spec.title}: ${chapters.length} surahs, ${passages.length} ayahs indexed`);
}

// ---------------------------------------------------------------------------
// Al-Arba'in al-Nawawiyya (Hadith API)
// ---------------------------------------------------------------------------

async function buildNawawi() {
  const [english, arabic] = await Promise.all([
    getJson("https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/eng-nawawi.min.json"),
    getJson("https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-nawawi.min.json"),
  ]);
  const englishHadiths = Array.isArray(english?.hadiths) ? english.hadiths : [];
  if (!englishHadiths.length) throw new Error("The Hadith API returned no Nawawi reports");
  const chapters = [{ ref: "1", label: "Forty Hadith of an-Nawawi" }];
  const passages = englishHadiths.map((h: any, i: number) => ({
    reference: `1.${i + 1}`,
    label: `al-Nawawi ${h.hadithnumber ?? i + 1}`,
    chapterRef: "1",
  }));

  const slug = "nawawi-forty";
  const work = {
    slug,
    title: "Al-Arba'un al-Nawawiyya",
    originalTitle: "الأربعون النووية",
    transliteration: "al-Arbaʿūn al-Nawawiyya",
    altTitles: ["The Forty Hadith of al-Nawawi"],
    tradition: "islam",
    school: "sunni-tradition",
    genre: "Hadith",
    textType: "Hadith collection",
    category: "Hadith",
    subcategory: "Forty hadith",
    originalLanguage: "ar",
    dateStart: 1260,
    dateEnd: 1270,
    dateDisplay: "composed c. 1260s CE",
    authorshipStatus: "established",
    author: "al-nawawi",
    attributionNote:
      "Al-Nawawi selected and arranged the reports; each report is attributed within its text to the Companion or transmitter who heard it.",
    description:
      "Forty-two short reports chosen by al-Nawawi to summarise the foundations of the religion, beginning with 'Actions are judged by intentions' and closing with the verse on the heart's turning. The collection became a standard first text in madrasa teaching and one of the most widely memorised hadith works.",
    historicalContext:
      "Compiled in Damascus in the thirteenth century, when al-Nawawi was teaching hadith and law. Its forty reports were chosen for concision and legal weight rather than for exhaustiveness; later scholars wrote hundreds of commentaries on it, and its numbering is still used across schools.",
    availabilityNote:
      "Streamed section by section from the Hadith API at read time, Arabic beside the English translation. The English translator is not identified by the host, so the translation is streamed and credited rather than relicensed.",
    featured: false,
    featuredNote: "",
    refScheme: "book.hadith",
    isSample: false,
    textStorage: "streamed",
    chapters,
    passages,
    editions: [
      {
        slug: `${slug}-ar`,
        language: "ar",
        editionType: "original",
        title: "Arabic text (as served by the Hadith API)",
        translator: "",
        publisher: "Hadith API (fawazahmed0)",
        source: "hadith-api",
        license: "public-domain",
        rightsStatus: "Public domain (classical Arabic text)",
        attributionText:
          "Al-Arba'un al-Nawawiyya by Yahya ibn Sharaf al-Nawawi, Arabic text served by the Hadith API (fawazahmed0, via jsDelivr).",
        structureScheme: "one book, forty-two reports",
        isSample: false,
        notes: "Arabic and English are separate editions sharing the collection's numbering.",
      },
      {
        slug: `${slug}-en`,
        language: "en",
        editionType: "translation",
        title: "Forty Hadith of an-Nawawi (English text served by the Hadith API)",
        translator: "Not stated by the host",
        publisher: "Hadith API (fawazahmed0)",
        source: "hadith-api",
        license: "streamed-host-terms",
        rightsStatus: "Streamed from the host; translation rights are not held by this library",
        attributionText:
          "English translation of al-Arba'un al-Nawawiyya served by the Hadith API (fawazahmed0, via jsDelivr). The translator is not identified by the host.",
        structureScheme: "one book, forty-two reports",
        isSample: false,
        notes:
          "The host does not identify the translator. The translation is streamed with attribution to the host and is not relicensed.",
      },
    ],
  };

  writeFileSync(join(WORKS, `${slug}.json`), `${JSON.stringify(work, null, 2)}\n`);
  streams.works[slug] = {
    provider: "hadith",
    upstream: "nawawi",
    mode: "numbered",
    licence: "public-domain",
    config: { book: "nawawi", arabic: "ara-nawawi", english: "eng-nawawi" },
    editions: [
      {
        slug: `${slug}-ar`,
        language: "ar",
        languageName: "arabic",
        version: "ara-nawawi",
        license: "public-domain",
        sourceUrl: "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-nawawi",
      },
      {
        slug: `${slug}-en`,
        language: "en",
        languageName: "english",
        version: "eng-nawawi",
        license: "streamed-host-terms",
        sourceUrl: "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/eng-nawawi",
      },
    ],
  };
  functions.works[slug] = {
    functions: ["canonical_scripture", "religious_law_practice"],
    status: "provisional",
    assignedBy: "UWL editors (comparative taxonomy)",
    note: "Al-Arba'un al-Nawawiyya — Hadith. Arabic and English are streamed from the Hadith API.",
  };
  recordWork({
    slug,
    host: "hadith-api",
    upstream: "eng-nawawi",
    chapters: chapters.length,
    passages: passages.length,
    translator: "Not stated by the host",
  });
  console.log(`  ${work.title}: ${chapters.length} book, ${passages.length} reports (${arabic?.hadiths?.length ?? 0} Arabic)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

ensureMeta();

if (!only || only === "tafsir" || TAFSIRS.some((t) => t.slug === only)) {
  console.log("Qur'an commentaries (Quran.com)");
  for (const spec of TAFSIRS) {
    if (only && only !== "tafsir" && only !== spec.slug) continue;
    try {
      buildTafsir(spec);
    } catch (err) {
      console.error(`  ! ${spec.slug}: ${(err as Error).message}`);
      throw err;
    }
  }
}

if (!only || only === "nawawi-forty") {
  console.log("Al-Arba'in al-Nawawiyya (Hadith API)");
  await buildNawawi();
}

manifest.totals.works = manifest.works.length;
manifest.totals.chapters = manifest.works.reduce((sum: number, w: any) => sum + w.chapters, 0);
manifest.totals.passages = manifest.works.reduce((sum: number, w: any) => sum + w.passages, 0);
streams.generatedAt = RETRIEVED_AT;

writeFileSync(STREAMS, `${JSON.stringify(streams, null, 2)}\n`);
writeFileSync(FUNCTIONS, `${JSON.stringify(functions, null, 2)}\n`);
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log("Islamic expansion records written.");
