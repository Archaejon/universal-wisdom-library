// Imports the Gita Supersite's corpus, as Heritage IITKanpur serves it.
//
//   bun run import:gita --catalogue          # the corpus list the server publishes
//   bun run import:gita --list               # what the catalogue holds
//   bun run import:gita --text=SBG           # one text
//   bun run import:gita --codes=SBG,ISU,CHU  # named texts
//   bun run import:gita --all --limit=20     # the whole corpus, a few texts at a time
//
// The Gita Supersite was built at IIT Kanpur and is continued at Heritage
// IITKanpur, where the same corpus — the Bhagavad Gita with its classical
// commentaries and translations, the Upanishads, the minor Gitas, the Ramayana,
// the Mahabharata, the Yoga-Vasishtha and the works of Shankara and Madhva — is
// served from a Scripture Server with a documented, read-only REST API.
//
//   https://heritage.iitk.ac.in/api/v1/            discovery
//   https://heritage.iitk.ac.in/api/v1/license/     HCAL-1.1, the licence
//   https://heritage.iitk.ac.in/api/schema/         the OpenAPI schema
//   https://heritage.iitk.ac.in/api/texts/          every text in the corpus
//   https://heritage.iitk.ac.in/api/texts/<CODE>/   one text: its author, its
//                                                   shelf, its chapters
//   https://heritage.iitk.ac.in/api/groups/         the collections
//
// The catalogue and the chapters are open: the server publishes its texts, their
// sections and the address of every verse it holds without a key. The verses
// themselves — `/{text}/{ref}/moolam/`, and beside it the transliterations, the
// AI and community translations and the Sanskrit commentaries — answer only a key
// that Heritage issues on request, and they are metered: moolam one unit a verse,
// transliterations and translations two, Sanskrit bhāṣya three, against a daily
// allowance of fifty units on the Free tier up to ten thousand on a partner key.
//
// A corpus of 165,091 verses cannot be copied inside that allowance, and HCAL-1.1
// forbids bulk harvesting and database reconstruction outright, so this import
// holds what the licence allows a reading library to hold: the catalogue, the
// chapter structure and the address of every verse. The text is streamed from the
// API when a reader opens it, with the attribution the licence requires — the
// work, the author, "Accessed via Heritage Scripture Server" and HCAL-1.1 — and
// the licence's watermark and quota notice are left as the server sends them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");
const META = join(ROOT, "data", "corpus", "meta.json");
const FUNCTIONS = join(ROOT, "data", "corpus", "text-functions.json");
const STREAMS = join(ROOT, "data", "registry", "streams.json");
const ACQUISITION = join(ROOT, "data", "registry", "acquisition.json");
const CATALOGUE = join(ROOT, "data", "imports", "gita-catalogue.json");
const MANIFEST = join(ROOT, "data", "imports", "gita.json");
const CACHE = join(ROOT, "data", "imports", "cache", "gita");

const SITE = "https://heritage.iitk.ac.in";
const API = `${SITE}/api`;
const V1 = `${API}/v1`;
const RETRIEVED_AT = new Date().toISOString().slice(0, 10);
const USER_AGENT =
  "UniversalWisdomLibrary/1.0 (local, non-commercial reading library; Heritage Scripture Server corpus import; one request at a time, cached)";
// The code the corpus files this licence under, as `data/corpus/meta.json`
// records it; the attribution text below keeps the licence's published name.
const LICENCE = "hcal-1-1";
const ATTRIBUTION = "Accessed via Heritage Scripture Server (heritage.iitk.ac.in), licence HCAL-1.1.";

const args = process.argv.slice(2);
function arg(name: string): string {
  return args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? "";
}
const listOnly = args.includes("--list");
const catalogueOnly = args.includes("--catalogue");
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const textOnly = arg("text").toUpperCase();
const codes = arg("codes")
  .split(",")
  .map((code) => code.trim().toUpperCase())
  .filter(Boolean);
const limit = Math.max(0, Number(arg("limit") ?? 0) || 0);
const DELAY_MS = Math.max(400, Number(arg("delay") ?? 0) || 1200);

type Row = Record<string, any>;
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Row;
const writeJson = (path: string, data: unknown) => writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);

/** One JSON document from the server, read once and kept on disk. */
async function apiJson(path: string, cacheFile?: string): Promise<Row> {
  const file = cacheFile ? join(CACHE, cacheFile) : "";
  if (file && !force && existsSync(file)) return readJson(file) as Row;
  const key = process.env.HERITAGE_API_KEY ?? "";
  const res = await fetch(`${API}${path}`, {
    headers: {
      accept: "application/json",
      "user-agent": USER_AGENT,
      ...(key ? { authorization: `Api-Key ${key}` } : {}),
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `${path} answered ${res.status}: the content routes need an API key. Request one at ${V1}/request-access/ and set HERITAGE_API_KEY.`,
    );
  }
  if (res.status === 429) throw new Error(`${path} answered 429: the daily or per-minute quota is spent.`);
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  const body = (await res.json()) as Row;
  if (file && !dryRun) {
    mkdirSync(CACHE, { recursive: true });
    writeJson(file, body);
  }
  await Bun.sleep(DELAY_MS);
  return body;
}

/** One file of a sitemap, which is how every verse address is published. */
async function sitemap(url: string, cacheFile: string): Promise<string> {
  const file = join(CACHE, cacheFile);
  if (!force && existsSync(file)) return readFileSync(file, "utf8");
  const res = await fetch(url, { headers: { accept: "application/xml", "user-agent": USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  const body = await res.text();
  if (!dryRun) {
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, body);
  }
  await Bun.sleep(DELAY_MS);
  return body;
}

/**
 * The corpus the server publishes: every text it holds, with its code, its names
 * in Devanagari, IAST and English, its language and script, the shelf it is
 * filed on, its author and how many verses and chapters it is divided into, and
 * the collections the texts are grouped into. This is Heritage's own catalogue of
 * itself, and it is open: the verses are the part a key is needed for.
 */
async function buildCatalogue() {
  const texts = (await apiJson("/texts/")) as Row[];
  const groups = (await apiJson("/groups/")) as Row[];
  const taxonomies = await apiJson("/taxonomies/");
  const licence = await apiJson("/v1/license/");
  const catalogue = {
    version: 1,
    source: "gita-supersite",
    sourceName: "Heritage Scripture Server, IIT Kanpur (the Gita Supersite continued)",
    sourceUrl: `${SITE}/gitasupersite`,
    api: `${V1}/`,
    docsUrl: `${SITE}/docs`,
    schemaUrl: `${API}/schema/`,
    licence,
    licenceId: LICENCE,
    attribution: ATTRIBUTION,
    accessNote:
      "The catalogue, the chapters and the address of every verse are open. The verses themselves are served one at a " +
      "time to an API key that Heritage issues on request: moolam one unit a verse, transliterations and translations " +
      "two, Sanskrit bhāṣya three, against a daily allowance of 50 units on the Free tier, 500 on Research, 2,000 on " +
      "Developer and 10,000 on a partner key. HCAL-1.1 forbids bulk harvesting and database reconstruction, so the " +
      "library stores the outline and streams the text as it is read.",
    generatedAt: RETRIEVED_AT,
    counts: {
      texts: texts.length,
      groups: groups.length,
      verses: texts.reduce((sum: number, text: Row) => sum + Number(text.verse_count ?? 0), 0),
    },
    texts,
    groups,
    taxonomies,
  };
  if (!dryRun) writeJson(CATALOGUE, catalogue);
  console.log(
    `catalogue: ${catalogue.counts.texts} text(s), ${catalogue.counts.verses.toLocaleString()} verses, ` +
      `${catalogue.counts.groups} collection(s)`,
  );
  return catalogue;
}

// ---------------------------------------------------------------------------
// The works of the corpus
// ---------------------------------------------------------------------------

const meta: Row = existsSync(META) ? readJson(META) : { authors: [] };
meta.authors ??= [];
const streams: Row = readJson(STREAMS);
const functions: Row = readJson(FUNCTIONS);
const acquisition: Row = existsSync(ACQUISITION) ? readJson(ACQUISITION) : { targets: [] };
const manifest: Row = existsSync(MANIFEST)
  ? readJson(MANIFEST)
  : {
      version: 1,
      source: "gita-supersite",
      sourceUrl: `${SITE}/gitasupersite`,
      api: `${V1}/`,
      licence: LICENCE,
      attribution: ATTRIBUTION,
      note:
        "Catalogue records, chapter outlines and verse indexes for the Heritage Scripture Server corpus, read from the " +
        "server's own open catalogue. No text is stored: the verses are streamed from the API when a work is read, with " +
        "the attribution HCAL-1.1 requires.",
      works: [],
      leads: [],
      totals: {},
    };
manifest.leads ??= [];

/**
 * A language as the server names it, in the code the corpus files it under. The
 * catalogue gives some texts "sa" and others "Sanskrit", and a work whose
 * language the corpus does not know cannot be loaded into the library at all.
 */
const LANGUAGE_CODES: Record<string, string> = {
  sanskrit: "sa",
  english: "en",
  hindi: "hi",
  nepali: "ne",
  telugu: "te",
  tamil: "ta",
  bengali: "bn",
  marathi: "mr",
  kannada: "kn",
  malayalam: "ml",
  odia: "or",
  gujarati: "gu",
  awadhi: "awa",
};

function languageCode(value: unknown): string {
  const key = String(value ?? "")
    .trim()
    .toLowerCase();
  if (LANGUAGE_CODES[key]) return LANGUAGE_CODES[key]!;
  return /^[a-z]{2,3}$/.test(key) ? key : "sa";
}

/** Where a work sits in this library, from the shelf Heritage files it on. */
type Shelf = { category: string; school: string | null; functions: string[]; genre: string };

const GROUP_FUNCTIONS: Record<string, string[]> = {
  upanishads: ["canonical_scripture", "philosophical_work"],
  "minor-gitas": ["philosophical_work", "mystical_contemplative"],
  shankara: ["philosophical_work", "commentary_exegesis"],
  madhva: ["philosophical_work", "commentary_exegesis"],
  nepali: ["mystical_contemplative", "prayer_liturgy"],
  srmd: ["mystical_contemplative", "prayer_liturgy"],
};

/**
 * The corpus keeps its own school vocabulary, and a work has to be filed under a
 * school the library knows. Heritage's taxonomy is a finer one than this library
 * keeps, so it is mapped onto it: the six darśanas keep their own names, and the
 * Upanishads and the Vedānta literature — Advaita and Dvaita alike — are filed
 * under Vedānta, which is the school they belong to here. A work whose shelf
 * names no such school is filed without one.
 */
const SCHOOL_SLUGS: [RegExp, string][] = [
  [/upani|advaita|dvaita|vedānta|vedanta/i, "vedanta"],
  [/darśana|darsana|yoga/i, "yoga"],
  [/sāṃkhya|samkhya/i, "samkhya"],
  [/nyāya|nyaya/i, "nyaya"],
  [/mīmāṃsā|mimamsa/i, "mimamsa"],
  [/vaiśeṣika|vaisheshika/i, "vaisheshika"],
  [/bhakti|vaiṣṇava|vaishnav/i, "vaishnavism"],
  [/śaiva|shaiva/i, "shaivism"],
  [/śākta|shakta/i, "shaktism"],
  [/purāṇa|purana/i, "puranic"],
];

function schoolSlug(taxonomyName: string): string | null {
  for (const [pattern, slug] of SCHOOL_SLUGS) if (pattern.test(taxonomyName)) return slug;
  return null;
}

function shelfFor(text: Row, groups: Row[]): Shelf {
  const group = groups.find((entry: Row) => (entry.codes ?? []).includes(text.code));
  const taxonomyEn = String(text.taxonomy?.name_en ?? "").trim();
  const category = String(text.taxonomy_name ?? "").trim() || taxonomyEn || String(text.tradition ?? "").trim() || "Hindu text";
  const school = schoolSlug(taxonomyEn);
  const name = String(text.name_en ?? "");
  // The Complete Works of Shankara and the Madhva corpus are half hymns of
  // praise and half commentary, and the shelf alone does not separate them: the
  // published form of the work does. A short hymn is devotion; a bhāṣya is
  // exegesis.
  const devotional =
    /stotra|stava|stuti|aṣṭaka|astaka|laharī|lahari|bhujaṅga|bhujanga|ratna|daśaka|dasaka|pūjā|puja|nāmāvalī|namavali|mānasa|manasa|sam|am$/i.test(
      name,
    );
  const functions = devotional
    ? ["prayer_liturgy", "mystical_contemplative"]
    : (GROUP_FUNCTIONS[String(group?.slug ?? "")] ??
      (/Upani/i.test(category) || /Itihāsa|Purāṇa/i.test(category)
        ? ["canonical_scripture", "philosophical_work"]
        : /Vedānta|Dvaita|Advaita|Bhāṣya/i.test(category)
          ? ["philosophical_work", "commentary_exegesis"]
          : ["canonical_scripture"]));
  const genre = devotional
    ? "Devotion"
    : /Itihāsa|Purāṇa|Subhāṣita|Upani/i.test(category) || /Gītā|Gita|Rāmāyaṇa|Ramayana|Mahābhārata|Mahabharata/i.test(`${name} ${category}`)
      ? "Scripture"
      : /Vedānta|Dvaita|Advaita|Darśana/i.test(category)
        ? "Philosophy"
        : "Scripture";
  return { category, school, functions, genre };
}

const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

/**
 * The address of every verse of a text, from the verse sitemaps the server
 * publishes: `/SBG/1.1`, `/SBG/1.2` … one page per text where the text is small,
 * and many where it is not. Those addresses are the passage index of the work,
 * and they are read without a key.
 */
async function verseReferences(code: string, expected: number): Promise<string[]> {
  const references = new Set<string>();
  const collect = (body: string) => {
    const before = references.size;
    for (const match of body.matchAll(/<loc>[^<]*\/([A-Z0-9]+)\/([0-9]+(?:\.[0-9]+)*)<\/loc>/g)) {
      if (match[1] === code) references.add(match[2]!);
    }
    return references.size - before;
  };
  // The sitemap index names the verse maps of the larger texts, page by page;
  // the rest are asked for by name, a page at a time, until the server stops
  // serving them or the text's own verse count is accounted for.
  const index = await sitemap(`${SITE}/sitemap.xml`, "sitemap-index.xml");
  const listed = [...index.matchAll(new RegExp(`<loc>([^<]*sitemap-verses-${code}\\.xml[^<]*)</loc>`, "g"))].map(
    (match) => match[1]!,
  );
  for (const [position, url] of listed.entries()) {
    try {
      collect(await sitemap(url, `verses-${code}-listed-${position + 1}.xml`));
    } catch {
      break;
    }
  }
  if (listed.length && (!expected || references.size >= expected)) return [...references];
  for (let page = 0; page < 400; page++) {
    const url = `${SITE}/sitemap-verses-${code}.xml${page ? `?p=${page}` : ""}`;
    let body: string;
    try {
      body = await sitemap(url, `verses-${code}-p${page}.xml`);
    } catch {
      break;
    }
    const added = collect(body);
    if (!added || (expected && references.size >= expected)) break;
  }
  return [...references];
}

/** The chapter a verse reference stands in: everything but its last number. */
const chapterOf = (reference: string) => reference.split(".").slice(0, -1).join(".");

/**
 * The verse addresses of a text whose verses are not published as a sitemap,
 * built from what the catalogue does publish: each chapter's own verse count,
 * numbered from one, which is how the server addresses them — the Gita's 47
 * verses of chapter 1 are `/SBG/1.1` to `/SBG/1.47`. Where a text numbers its
 * verses continuously through a book rather than restarting them in each part,
 * the count is that running number, and the addresses are built the same way.
 */
function outlineFromSections(sections: Row[]): string[] {
  const references: string[] = [];
  sections.forEach((section: Row, position: number) => {
    const label = String(section.hierarchical_label ?? "").trim() || String(section.order ?? position + 1);
    const count = Math.max(0, Number(section.verse_count ?? 0));
    for (let verse = 1; verse <= count; verse++) references.push(`${label}.${verse}`);
  });
  return references;
}

/**
 * One work: the catalogue record, the chapter outline, the passage index, the
 * stream entry the reader follows to the API, the classification and the
 * acquisition entry that records the rights position of every verse served.
 */
function buildWork(text: Row, references: string[], shelf: Shelf, group: Row | undefined) {
  const code = String(text.code);
  const chaptersSeen = new Map<string, string[]>();
  for (const reference of references) {
    const chapter = chapterOf(reference) || "1";
    chaptersSeen.set(chapter, [...(chaptersSeen.get(chapter) ?? []), reference]);
  }
  const sections: Row[] = Array.isArray(text.sections) ? text.sections : [];
  const labelFor = (chapter: string) => {
    const section =
      sections.find((entry: Row) => String(entry.hierarchical_label ?? "").trim() === chapter) ??
      sections[Number(chapter) - 1];
    const name = String(section?.title_iast ?? "").trim() || String(section?.title_en ?? "").trim() || String(section?.title ?? "").trim();
    return name ? `${chapter}. ${name}` : `Chapter ${chapter}`;
  };
  const chapters = [...chaptersSeen.keys()].map((chapter) => ({ ref: chapter, label: labelFor(chapter) }));
  const passages = [...chaptersSeen.entries()].flatMap(([chapter, verses]) =>
    verses.map((reference) => ({
      reference,
      label: `${labelFor(chapter)} · verse ${reference.split(".").at(-1)}`,
      chapterRef: chapter,
    })),
  );
  const title = String(text.name_en ?? "").trim() || String(text.name_iast ?? "").trim() || code;
  const author = text.author ? slugify(String(text.author.slug ?? text.author.display_name ?? "")) : null;
  const provenance = text.metadata?.description_provenance ?? null;
  const description = String(text.description ?? "").trim();
  const work = {
    slug: `${slugify(title)}-${code.toLowerCase()}`,
    title,
    originalTitle: String(text.name ?? "").trim(),
    transliteration: String(text.name_iast ?? "").trim(),
    altTitles: [],
    tradition: "hinduism",
    school: shelf.school,
    genre: shelf.genre,
    textType: `${String(text.language) === "sa" ? "Sanskrit" : String(text.language)} ${String(text.form) === "padya" ? "verse" : "text"}${
      text.unit_type ? ` (${text.unit_type})` : ""
    }`,
    category: shelf.category,
    subcategory: group ? String(group.name_en ?? "") : "",
    originalLanguage: languageCode(text.language),
    dateStart: null,
    dateEnd: null,
    dateDisplay: "",
    authorshipStatus: author ? "traditional" : "anonymous",
    author,
    attributionNote:
      `${title}${text.author ? `, attributed to ${String(text.author.display_name ?? text.author.name)}` : ""}, as Heritage ` +
      `IITKanpur's Scripture Server catalogues it (${code}), on its own shelf${group ? ` (${group.name_en})` : ""}.`,
    description:
      `${description ? `${description} ` : ""}The summary above is the one Heritage IITKanpur's Scripture Server ` +
      `publishes for the text${provenance?.ai_generated ? `, and the server's own metadata records it as AI-assisted (${String(provenance.ai_model ?? "a language model")})` : ""}; ` +
      "an editor's note for the work itself is still to be written.",
    historicalContext:
      "Read in the Heritage Scripture Server corpus, which continues the Gita Supersite built at IIT Kanpur: the text, " +
      "its classical commentaries and the translations the server may serve are held together there.",
    availabilityNote:
      `The outline is held: ${chapters.length} chapter(s) and ${passages.length} verse address(es), read from the ` +
      "server's own catalogue. The verses are not stored — the licence forbids bulk harvesting and database " +
      "reconstruction — and are streamed from the API one verse at a time as the work is read, with the attribution " +
      "HCAL-1.1 requires and the server's own quota and licence notice.",
    outlineSource: "published",
    featured: 0,
    featuredNote: "",
    refScheme: "chapter.verse",
    isSample: false,
    textStorage: "streamed",
    chapters,
    passages,
    editions: [
      {
        slug: `${slugify(title)}-${code.toLowerCase()}-sa`,
        language: languageCode(text.language),
        editionType: "original",
        title: `${title} (Heritage Scripture Server transcription)`,
        translator: "",
        publisher: "Heritage IITKanpur, Heritage Scripture Server",
        publicationYear: null,
        source: "gita-supersite",
        license: LICENCE,
        rightsStatus:
          "Tier A (the moolam and its transliterations): no modern copyright, freely redistributable. Where the API " +
          "serves Tier B — the Sanskrit bhāṣya and the AI-generated, community and editorially authored translations — " +
          "it is displayed non-commercially with attribution and is not relicensed here. Tier C, the authoritative " +
          "modern-language translations and commentaries, is not served by the API and is not imported.",
        attributionText:
          `${title}${text.author ? `, ${String(text.author.display_name ?? text.author.name)}` : ""}. ` +
          `${ATTRIBUTION} Source: ${SITE}/${code}`,
        structureScheme: "chapter and verse, as the server's own sections and verse addresses divide the text",
        isSample: false,
        notes:
          "The verse index was built from the server's published verse addresses. The verses themselves are fetched " +
          "from the API at read time and are shown with the licence's attribution; the licence identifier and any " +
          "watermark the server returns are left in place.",
      },
    ],
  };
  return work;
}

/** The person or institution a work is attributed to, if the corpus is meeting them. */
function ensureAuthor(text: Row) {
  if (!text.author) return;
  const slug = slugify(String(text.author.slug ?? text.author.display_name ?? ""));
  if (!slug || meta.authors.some((author: Row) => author.slug === slug)) return;
  meta.authors.push({
    slug,
    name: String(text.author.display_name ?? text.author.name ?? slug),
    sort_name: String(text.author.name ?? slug),
    birth_year: null,
    death_year: null,
    date_display: String(text.author.period ?? ""),
    description: `The author Heritage IITKanpur's Scripture Server records for its texts: ${String(text.author.name ?? slug)}.`,
    is_attributed: true,
  });
}

/** A work of the corpus whose text the library will stream, once a key is held. */
function recordWork(work: Row, text: Row, group: Row | undefined, shelf: Shelf) {
  const code = String(text.code);
  if (!dryRun) writeJson(join(WORKS, `${work.slug}.json`), work);
  const verses = work.passages as Row[];
  streams.works[work.slug] = {
    provider: "heritage",
    upstream: `Heritage Scripture Server ${code}`,
    mode: "numbered",
    licence: LICENCE,
    config: {
      api: `${V1}`,
      text: code,
      workUrl: `${SITE}/${code}`,
      attribution: ATTRIBUTION,
      note:
        "The verses are fetched from the Heritage Scripture Server API one verse at a time, in the chapter being read, " +
        "and shown with the attribution HCAL-1.1 requires. Nothing is stored.",
      chapters: Object.fromEntries(
        (work.chapters as Row[]).map((chapter: Row) => [
          chapter.ref,
          {
            label: chapter.label,
            verses: verses.filter((passage: Row) => passage.chapterRef === chapter.ref).map((passage: Row) => passage.reference),
          },
        ]),
      ),
    },
    editions: [
      {
        slug: (work.editions as Row[])[0]!.slug,
        language: languageCode(text.language),
        languageName: languageCode(text.language) === "sa" ? "sanskrit" : String(text.language),
        version: `${work.title} (Heritage Scripture Server transcription)`,
        license: LICENCE,
        sourceUrl: `${SITE}/${code}`,
      },
    ],
  };
  functions.works[work.slug] = {
    functions: shelf.functions,
    status: "provisional",
    assignedBy: "UWL editors (Heritage shelf and taxonomy)",
    note: `${work.title} — ${shelf.category}, from Heritage IITKanpur's own shelf${group ? ` (${group.name_en})` : ""} and taxonomy.`,
  };
  ensureAuthor(text);
  const target = {
    slug: work.slug,
    title: work.title,
    original_title: work.originalTitle,
    transliteration: work.transliteration,
    author: work.author ?? "",
    tradition: "hinduism",
    school: shelf.school ?? "",
    genre: shelf.genre,
    category: shelf.category,
    status: "imported",
    priority: ["sbg", "SVU", "KNU"].some((known) => code.toLowerCase() === known.toLowerCase()) ? 1 : 3,
    languages: [languageCode(text.language)],
    source_leads: [
      {
        source: "Heritage Scripture Server (IIT Kanpur)",
        url: `${SITE}/${code}`,
        note:
          "The corpus behind the Gita Supersite, served from a documented REST API. The outline is held; the verses " +
          "are read through the API's content routes one verse at a time.",
      },
      {
        source: "Heritage Scripture Server — API access",
        url: `${SITE}/api-access`,
        note:
          "Content routes answer an API key issued on request. Moolam 1 unit a verse, transliterations and translations " +
          "2, Sanskrit bhāṣya 3; 50 units a day on the Free tier to 10,000 on a partner key.",
      },
    ],
    rights_note:
      "Tier A, the moolam and its transliterations, carries no modern copyright and may be redistributed without " +
      "restriction. Tier B — the Sanskrit bhāṣya and the AI-generated, community and editorially authored translations — " +
      "is displayed non-commercially with attribution, is never relicensed, and is not harvested or used to train " +
      "models. Tier C, the authoritative modern-language translations and commentaries, is platform reading only and is " +
      "not imported. Attribution: the work, its author, " +
      `${ATTRIBUTION}`,
    note: `Imported as a streamed work from the Heritage Scripture Server (${code}), outline only.`,
  };
  const at = (acquisition.targets as Row[]).findIndex((entry: Row) => entry.slug === work.slug);
  if (at >= 0) acquisition.targets[at] = { ...acquisition.targets[at], ...target };
  else acquisition.targets.push(target);
  const found = (manifest.works as Row[]).findIndex((entry: Row) => entry.slug === work.slug);
  const entry = {
    slug: work.slug,
    title: work.title,
    code,
    shelf: shelf.category,
    group: group ? group.name_en : "",
    chapters: (work.chapters as Row[]).length,
    verses: verses.length,
    outline: String((work as Row).outlineSource ?? "published"),
    licence: LICENCE,
    retrieved_at: RETRIEVED_AT,
  };
  if (found >= 0) manifest.works[found] = entry;
  else manifest.works.push(entry);
}

/** Writes the registries this import shares with the others, merging what is on disk. */
function saveRegistry() {
  // One lead a text, however many times the corpus is swept: the import is
  // repeatable, and a second pass over the same catalogue must not leave the
  // same gap listed twice.
  const leads = new Map<string, Row>();
  for (const lead of manifest.leads as Row[]) leads.set(String(lead.code ?? lead.slug), lead);
  manifest.leads = [...leads.values()];
  manifest.totals = {
    works: (manifest.works as Row[]).length,
    verses: (manifest.works as Row[]).reduce((sum: number, work: Row) => sum + Number(work.verses ?? 0), 0),
  };
  acquisition.updated_at = RETRIEVED_AT;
  if (dryRun) return;
  const onDisk = (path: string): Row | null => {
    try {
      return existsSync(path) ? readJson(path) : null;
    } catch {
      return null;
    }
  };
  const functionsOnDisk = onDisk(FUNCTIONS);
  if (functionsOnDisk?.works) {
    for (const [slug, entry] of Object.entries(functionsOnDisk.works as Row)) functions.works[slug] ??= entry;
  }
  const streamsOnDisk = onDisk(STREAMS);
  if (streamsOnDisk?.works) {
    for (const [slug, entry] of Object.entries(streamsOnDisk.works as Row)) streams.works[slug] ??= entry;
  }
  const metaOnDisk = onDisk(META);
  if (metaOnDisk?.authors) {
    const known = new Set((meta.authors as Row[]).map((author: Row) => author.slug));
    for (const author of metaOnDisk.authors as Row[]) if (!known.has(author.slug)) meta.authors.push(author);
  }
  const acquisitionOnDisk = onDisk(ACQUISITION);
  if (acquisitionOnDisk?.targets) {
    const known = new Set((acquisition.targets as Row[]).map((entry: Row) => entry.slug));
    for (const target of acquisitionOnDisk.targets as Row[]) if (!known.has(target.slug)) acquisition.targets.push(target);
  }
  writeJson(MANIFEST, manifest);
  writeJson(STREAMS, streams);
  writeJson(FUNCTIONS, functions);
  writeJson(META, meta);
  writeJson(ACQUISITION, acquisition);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

mkdirSync(CACHE, { recursive: true });

if (catalogueOnly) {
  await buildCatalogue();
  process.exit(0);
}

const catalogue: Row | null = existsSync(CATALOGUE) ? readJson(CATALOGUE) : null;

if (listOnly) {
  const held = catalogue ?? (await buildCatalogue());
  console.log(`\n${held.counts.texts} text(s), ${held.counts.verses.toLocaleString()} verses, licence ${held.licenceId}`);
  for (const group of held.groups as Row[]) {
    console.log(`[${group.slug}] ${group.name_en} — ${group.text_count} text(s)`);
  }
  process.exit(0);
}

if (!catalogue) {
  console.error(`No catalogue at ${CATALOGUE}. Run --catalogue first.`);
  process.exit(1);
}

const texts = (catalogue.texts as Row[]).filter((text: Row) => {
  const code = String(text.code).toUpperCase();
  if (textOnly) return code === textOnly;
  if (codes.length) return codes.includes(code);
  return true;
});
if (!texts.length) {
  console.error(`No text in the catalogue matches ${textOnly || "(all)"}.`);
  process.exit(1);
}

let written = 0;
let failed = 0;
for (const text of texts) {
  if (limit && written >= limit) break;
  const code = String(text.code);
  try {
    const detail = await apiJson(`/texts/${code}/`, `text-${code}.json`);
    const group = (catalogue.groups as Row[]).find((entry: Row) => (entry.codes ?? []).includes(code));
    const shelf = shelfFor(detail, catalogue.groups as Row[]);
    // The verse addresses the server publishes are the passage index where they
    // exist; where they do not, the index is built from the verse count the
    // catalogue states for each chapter, and the record says which it was.
    let references = await verseReferences(code, Number(detail.verse_count ?? text.verse_count ?? 0));
    let outline = "published";
    if (!references.length) {
      references = outlineFromSections(Array.isArray(detail.sections) ? (detail.sections as Row[]) : []);
      outline = "from the catalogue's chapter verse counts";
    }
    if (!references.length) {
      manifest.leads.push({
        slug: `${slugify(String(text.name_en ?? code))}-${code.toLowerCase()}`,
        code,
        title: text.name_en,
        reason: "no verse addresses and no verse counts on the site",
        note: "the server publishes the text but neither verse addresses nor per-chapter verse counts for it, so there is no passage index to build",
        at: RETRIEVED_AT,
      });
      console.log(`  ${code}: no verse addresses or counts published; recorded as a lead`);
      continue;
    }
    const work = buildWork(detail, references, shelf, group);
    (work as Row).outlineSource = outline;
    if (dryRun) {
      console.log(
        `${code} ${work.title}: ${(work.chapters as Row[]).length} chapter(s), ${(work.passages as Row[]).length} verse(s), ${shelf.category}, ` +
          `${shelf.functions.join("+")} [index ${outline}]`,
      );
      written++;
      continue;
    }
    recordWork(work, detail, group, shelf);
    written++;
    console.log(
      `  ${work.slug}: ${(work.chapters as Row[]).length} chapter(s), ${(work.passages as Row[]).length} verse(s) [${shelf.category}]`,
    );
    if (written % 10 === 0) saveRegistry();
  } catch (err) {
    failed++;
    console.error(`  ${code}: ${(err as Error).message}`);
  }
}

saveRegistry();
console.log(
  `\nHeritage: ${written} work(s) written, ${failed} failure(s), ${(manifest.leads as Row[]).length} lead(s). ` +
    `${manifest.totals.works} work(s) and ${Number(manifest.totals.verses).toLocaleString()} verse addresses held in all.`,
);
if (!process.env.HERITAGE_API_KEY) {
  console.log(
    `The verses themselves need an API key: request one at ${V1}/request-access/ and set HERITAGE_API_KEY. ` +
      "Until then these works show their outline, their licence and the notice that the key is needed.",
  );
}
