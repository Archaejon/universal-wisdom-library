// Imports complete Sefaria works into the corpus as display copies. Every
// edition keeps the exact Sefaria version title, source URL and licence so the
// reader can acknowledge the origin of each text rather than treating the
// library as the owner of the edition.
//
//   bun run scripts/dev/import-sefaria-library.ts
//   bun run scripts/dev/import-sefaria-library.ts --categories=talmud,midrash
//   bun run scripts/dev/import-sefaria-library.ts --work=Berakhot
//
// Sefaria's index is the authority for which leaf nodes are works and which
// nodes are commentaries. Commentaries are skipped: they have their own
// authors and are not merged into the base text.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");
const FUNCTIONS = join(ROOT, "data", "corpus", "text-functions.json");
const MANIFEST = join(ROOT, "data", "imports", "sefaria-library.json");
const RETRIEVED_AT = new Date().toISOString().slice(0, 10);

type CategoryKey =
  | "talmud"
  | "midrash"
  | "tosefta"
  | "halakhah"
  | "kabbalah"
  | "liturgy"
  | "jewish-thought"
  | "chasidut"
  | "musar"
  | "responsa"
  | "second-temple"
  | "reference";

type CategoryConfig = {
  key: CategoryKey;
  label: string;
  prefix: string;
  genre: string;
  textType: string;
  functions: string[];
  dateStart: number;
  dateEnd: number;
  dateDisplay: string;
  historicalContext: string;
  authorshipStatus?: string;
  refScheme?: "chapter.paragraph" | "chapter.mishnah" | "daf.line";
  includes: (node: any) => boolean;
  subcategory: (node: any) => string;
};

// Sefaria nests a base work and its commentaries as sibling leaves. The library
// imports base texts only: a commentary has its own author and must not be
// merged into the text it explains.
function isCommentary(node: any): boolean {
  const categories: string[] = node.categories ?? [];
  return (
    categories.some((c) => /commentary|commentaries/i.test(c)) ||
    /^(annotations|commentary|commentaries|notes|index|concordance)\b/i.test(node.title ?? "")
  );
}

function baseTextIncludes(label: string) {
  return (node: any) =>
    (node.categories ?? [])[0] === label &&
    !isCommentary(node) &&
    // Sefaria files several Zohar commentaries as Kabbalah base texts rather
    // than under a Commentary category. They belong to the commentary layer.
    !(label === "Kabbalah" && /\bon Zohar\b/i.test(node.title ?? ""));
}

type ParsedChapter = { ref: string; label: string; units: string[] };
type ParsedText = { chapters: ParsedChapter[]; sectionNames: string[]; isDaf: boolean };

const args = process.argv.slice(2);
const categoryArg = args.find((a) => a.startsWith("--categories="))?.split("=")[1];
const workFilter = args.find((a) => a.startsWith("--work="))?.split("=").slice(1).join("=");
const skipArg = args.find((a) => a.startsWith("--skip="))?.split("=").slice(1).join("=");
const skipTitles = new Set((skipArg ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const limitArg = args.find((a) => a.startsWith("--limit="))?.split("=")[1];
const limit = limitArg ? Math.max(1, Number(limitArg)) : Infinity;

const CATEGORIES: CategoryConfig[] = [
  {
    key: "talmud",
    label: "Talmud",
    prefix: "talmud",
    genre: "Talmud",
    textType: "Talmud",
    functions: ["religious_law_practice", "commentary_exegesis"],
    dateStart: 200,
    dateEnd: 600,
    dateDisplay: "Compiled c. 400–600 CE",
    historicalContext:
      "The Talmud records rabbinic debate, law and narrative from late antiquity. The Bavli and Yerushalmi are separate compilations with different structure and transmission histories.",
    includes: (n) => n.corpus === "Bavli" || n.corpus === "Yerushalmi",
    subcategory: (n) => (n.corpus === "Yerushalmi" ? "Yerushalmi" : "Bavli"),
  },
  {
    key: "midrash",
    label: "Midrash",
    prefix: "midrash",
    genre: "Midrash",
    textType: "Midrash",
    functions: ["commentary_exegesis", "non_canonical_religious_text"],
    dateStart: 200,
    dateEnd: 1200,
    dateDisplay: "Classical and medieval rabbinic compilation",
    historicalContext:
      "Midrash is a family of rabbinic works that interpret scripture through legal exposition, narrative expansion and homily. The genre spans several centuries and several distinct collections.",
    includes: (n) =>
      (n.categories ?? [])[0] === "Midrash" &&
      !(n.categories ?? []).includes("Commentary") &&
      !/notes|footnotes|corrections|introduction/i.test(n.title ?? ""),
    subcategory: (n) => {
      const cats: string[] = n.categories ?? [];
      return cats.includes("Midrash Rabbah") ? "Midrash Rabbah" : cats[1] ?? "Midrash";
    },
  },
  {
    key: "tosefta",
    label: "Tosefta",
    prefix: "tosefta",
    genre: "Tosefta",
    textType: "Tosefta",
    functions: ["religious_law_practice"],
    dateStart: 200,
    dateEnd: 300,
    dateDisplay: "Compiled c. 250 CE",
    historicalContext:
      "The Tosefta is a collection of rabbinic traditions parallel to and supplementing the Mishnah. Its relationship to the Mishnah is debated; it is presented here as a distinct legal corpus.",
    includes: (n) =>
      (n.categories ?? [])[0] === "Tosefta" &&
      (n.categories ?? []).includes("Vilna Edition") &&
      !(n.categories ?? []).includes("Commentary"),
    subcategory: (n) => {
      const cats: string[] = n.categories ?? [];
      return cats.find((c) => c.startsWith("Seder ")) ?? "Tosefta";
    },
  },
  {
    key: "halakhah",
    label: "Halakhah",
    prefix: "halakhah",
    genre: "Halakhah",
    textType: "Legal code and legal commentary",
    functions: ["religious_law_practice"],
    dateStart: 200,
    dateEnd: 1600,
    dateDisplay: "Rabbinic legal literature, c. 200–1600 CE",
    historicalContext:
      "Halakhah is the body of Jewish law and its literature: the codes that arrange it and the works that argue it. Codes compress centuries of debate, so they are presented as their own genre rather than as scripture.",
    authorshipStatus: "established",
    includes: baseTextIncludes("Halakhah"),
    subcategory: (n) => (n.categories ?? [])[1] ?? "Halakhah",
  },
  {
    key: "kabbalah",
    label: "Kabbalah",
    prefix: "kabbalah",
    genre: "Kabbalah",
    textType: "Kabbalistic literature",
    functions: ["mystical_contemplative", "commentary_exegesis"],
    dateStart: 1100,
    dateEnd: 1900,
    dateDisplay: "Medieval and early modern, c. 1100–1900 CE",
    historicalContext:
      "Kabbalah is the Jewish mystical and theosophical tradition. Its works range from short speculative treatises to the multi-volume Zohar, and its language is symbolic rather than propositional.",
    authorshipStatus: "traditional",
    includes: baseTextIncludes("Kabbalah"),
    subcategory: (n) => (n.categories ?? [])[1] ?? "Kabbalah",
  },
  {
    key: "liturgy",
    label: "Liturgy",
    prefix: "liturgy",
    genre: "Liturgy",
    textType: "Liturgical text",
    functions: ["prayer_liturgy"],
    dateStart: 800,
    dateEnd: 1950,
    dateDisplay: "Liturgy in use, c. 800–1950 CE",
    historicalContext:
      "Liturgy is the recited text of prayer and ritual. Its wording varies by rite and community, so each imported text names its rite and edition instead of being harmonised into a single service.",
    authorshipStatus: "traditional",
    includes: baseTextIncludes("Liturgy"),
    subcategory: (n) => (n.categories ?? [])[1] ?? "Liturgy",
  },
  {
    key: "jewish-thought",
    label: "Jewish Thought",
    prefix: "jewish-thought",
    genre: "Jewish Thought",
    textType: "Theology and philosophy",
    functions: ["philosophical_work", "commentary_exegesis"],
    dateStart: 900,
    dateEnd: 1950,
    dateDisplay: "Medieval and modern Jewish thought",
    historicalContext:
      "Jewish philosophy and theology argue about God, revelation, law and the human good. These works belong to their own schools and arguments; the library does not flatten them into a single Jewish doctrine.",
    authorshipStatus: "established",
    includes: baseTextIncludes("Jewish Thought"),
    subcategory: (n) => (n.categories ?? [])[1] ?? "Jewish Thought",
  },
  {
    key: "chasidut",
    label: "Chasidut",
    prefix: "chasidut",
    genre: "Chasidut",
    textType: "Hasidic homily and teaching",
    functions: ["mystical_contemplative", "sermon_speech"],
    dateStart: 1750,
    dateEnd: 1950,
    dateDisplay: "Hasidic literature, c. 1750–1950 CE",
    historicalContext:
      "Hasidic literature gathers sermons, letters and teachings from the movement's dynasties and schools. Individual works are attributed to specific rebbes and schools rather than to Chasidut as a whole.",
    authorshipStatus: "established",
    includes: baseTextIncludes("Chasidut"),
    subcategory: (n) => (n.categories ?? [])[1] ?? "Chasidut",
  },
  {
    key: "musar",
    label: "Musar",
    prefix: "musar",
    genre: "Musar",
    textType: "Ethical literature",
    functions: ["denominational_guidance", "philosophical_work"],
    dateStart: 1000,
    dateEnd: 1950,
    dateDisplay: "Medieval to modern ethical literature",
    historicalContext:
      "Musar is Jewish ethical and devotional literature concerned with character, discipline and the conduct of ordinary life. Its genre ranges from short letters to systematic treatises.",
    authorshipStatus: "established",
    includes: baseTextIncludes("Musar"),
    subcategory: (n) => (n.categories ?? [])[1] ?? "Musar",
  },
  {
    key: "responsa",
    label: "Responsa",
    prefix: "responsa",
    genre: "Responsa",
    textType: "Responsa collection",
    functions: ["religious_law_practice"],
    dateStart: 700,
    dateEnd: 1950,
    dateDisplay: "Responsa literature, c. 700–1950 CE",
    historicalContext:
      "Responsa are written answers to specific legal questions, addressed by a scholar to a community or an individual. A responsum is a dated, situated ruling and is presented with its collection rather than as a universal statute.",
    authorshipStatus: "established",
    includes: baseTextIncludes("Responsa"),
    subcategory: (n) => (n.categories ?? [])[1] ?? "Responsa",
  },
  {
    key: "second-temple",
    label: "Second Temple",
    prefix: "second-temple",
    genre: "Second Temple",
    textType: "Second Temple literature",
    functions: ["non_canonical_religious_text", "commentary_exegesis"],
    dateStart: -300,
    dateEnd: 100,
    dateDisplay: "c. 300 BCE – 100 CE",
    historicalContext:
      "Second Temple literature includes the Apocrypha and the works of Philo and Josephus, surviving mostly in Greek, Latin and other translations. Its texts are evidence for Jewish thought and practice in the period, not a later rabbinic canon.",
    authorshipStatus: "traditional",
    includes: baseTextIncludes("Second Temple"),
    subcategory: (n) => (n.categories ?? [])[1] ?? "Second Temple",
  },
  {
    key: "reference",
    label: "Reference",
    prefix: "reference",
    genre: "Reference",
    textType: "Lexicography and grammar",
    functions: ["academic_scholarship"],
    dateStart: 900,
    dateEnd: 1950,
    dateDisplay: "Reference works, c. 900–1950 CE",
    historicalContext:
      "Dictionaries, grammars and encyclopedic works are tools for reading the other shelves. They are catalogued as reference literature and are not presented as revealed or normative texts.",
    authorshipStatus: "established",
    includes: baseTextIncludes("Reference"),
    subcategory: (n) => (n.categories ?? [])[1] ?? "Reference",
  },
];

const selected = categoryArg
  ? new Set(categoryArg.split(",").map((s) => s.trim().toLowerCase()))
  : new Set<CategoryKey>(CATEGORIES.map((c) => c.key));
const configs = CATEGORIES.filter((c) => selected.has(c.key));
if (!configs.length) throw new Error(`No known categories in ${categoryArg}`);

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

function flatten(value: unknown): string {
  if (typeof value === "string") return decode(value);
  if (Array.isArray(value)) return value.map(flatten).filter(Boolean).join(" ");
  if (value == null) return "";
  return decode(String(value));
}

function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/['’]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseText(raw: unknown, sectionNames: string[]): ParsedText {
  const isDaf = sectionNames[0]?.toLowerCase() === "daf";
  const chapters: ParsedChapter[] = [];
  if (!Array.isArray(raw) || raw.length === 0) return { chapters, sectionNames, isDaf };

  const source = raw.every((x) => typeof x === "string") ? [raw] : raw;
  for (let i = 0; i < source.length; i++) {
    const chapter = source[i];
    const units = Array.isArray(chapter)
      ? chapter.every((x) => typeof x === "string")
        ? chapter.map((x) => decode(String(x))).filter(Boolean)
        : chapter.map((x) => flatten(x)).filter(Boolean)
      : [flatten(chapter)].filter(Boolean);
    if (!units.length) continue;
    const ref = isDaf ? `${Math.floor(i / 2) + 1}${i % 2 === 0 ? "a" : "b"}` : String(i + 1);
    chapters.push({
      ref,
      label: isDaf ? `Daf ${ref}` : `${sectionNames[0] || "Chapter"} ${i + 1}`,
      units,
    });
  }
  return { chapters, sectionNames, isDaf };
}

const schemaCache = new Map<string, any>();
async function fetchSchema(title: string) {
  if (schemaCache.has(title)) return schemaCache.get(title);
  const res = await fetch(`https://www.sefaria.org/api/index/${encodeURIComponent(title.replaceAll(" ", "_"))}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`${title}: index HTTP ${res.status}`);
  const data = (await res.json()) as any;
  if (!data?.schema?.nodes?.length) throw new Error(`${title}: no section schema`);
  schemaCache.set(title, data);
  return data;
}

// Complex Sefaria works (for example Midrash Tanchuma) cannot be fetched by
// book-level ref. Their index schema lists the named sections, so fetch each
// section and present it as one chapter of the same work.
async function fetchComplexVersion(title: string, version: "hebrew" | "english") {
  const schema = await fetchSchema(title);
  const chapters: ParsedChapter[] = [];
  let edition: any = null;
  let consecutiveFailures = 0;
  for (const [i, node] of (schema.schema.nodes as any[]).entries()) {
    const ref = `${title.replaceAll(" ", "_")},_${String(node.title).replaceAll(" ", "_")}`;
    const url = new URL(`https://www.sefaria.org/api/v3/texts/${encodeURIComponent(ref)}`);
    url.searchParams.set("version", version);
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(90000) });
        if (res.status === 429 || res.status >= 500) {
          await Bun.sleep(1200 * attempt);
          continue;
        }
        const data = (await res.json()) as any;
        if (!res.ok || data?.error) {
          const message = `${title}, ${node.title}: ${data?.error ?? `HTTP ${res.status}`}`;
          if (res.status === 429 || res.status >= 500) throw new Error(message);
          throw Object.assign(new Error(message), { fatal: true });
        }
        const current = data.versions?.[0];
        if (!current) throw new Error(`${title}, ${node.title}: no ${version} version`);
        if (!edition) edition = current;
        const parsed = parseText(current.text, data.sectionNames ?? []);
        const units = parsed.chapters.flatMap((c) => c.units);
        if (units.length) chapters.push({ ref: String(i + 1), label: String(node.title), units });
        consecutiveFailures = 0;
        break;
      } catch (err) {
        if ((err as any).fatal || attempt === 4) {
          // A section-addressed work whose first sections do not resolve will
          // not resolve later either. Fail fast rather than issuing hundreds of
          // doomed requests for the rest of the volume.
          consecutiveFailures += 1;
          if (consecutiveFailures >= 3) {
            throw new Error(`${title}: complex structure unsupported (${(err as Error).message})`);
          }
          break;
        }
        await Bun.sleep(600 * attempt);
      }
    }
    await Bun.sleep(70);
  }
  if (!chapters.length || !edition) throw new Error(`${title}: no usable complex sections`);
  return {
    ref: title,
    title: String(edition.versionTitle ?? ""),
    language: String(edition.language ?? (version === "hebrew" ? "he" : "en")),
    license: String(edition.license ?? "unknown"),
    versionSource: String(edition.versionSource ?? ""),
    versionNotes: String(edition.versionNotes ?? ""),
    parsed: { chapters, sectionNames: ["Section", "Paragraph"], isDaf: false },
  };
}

async function fetchVersion(title: string, version: "hebrew" | "english") {
  const url = new URL(`https://www.sefaria.org/api/v3/texts/${encodeURIComponent(title.replaceAll(" ", "_"))}`);
  url.searchParams.set("version", version);
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(90000) });
      if (res.status === 429 || res.status >= 500) {
        await Bun.sleep(1500 * attempt);
        continue;
      }
      const data = (await res.json()) as any;
      if (!res.ok || data?.error) {
        const message = `${title}: ${data?.error ?? `HTTP ${res.status}`}`;
        // A permission or structure error will not succeed on retry. Only
        // throttling and server faults are worth backing off for.
        if (res.status === 429 || res.status >= 500) throw new Error(message);
        throw Object.assign(new Error(message), { fatal: true });
      }
      const edition = data.versions?.[0];
      if (!edition) throw new Error(`${title}: no ${version} version returned`);
      const parsed = parseText(edition.text, data.sectionNames ?? []);
      if (!parsed.chapters.length) throw new Error(`${title}: empty ${version} text`);
      return {
        ref: String(data.ref ?? title),
        title: String(edition.versionTitle ?? ""),
        language: String(edition.language ?? (version === "hebrew" ? "he" : "en")),
        license: String(edition.license ?? "unknown"),
        versionSource: String(edition.versionSource ?? ""),
        versionNotes: String(edition.versionNotes ?? ""),
        parsed,
      };
    } catch (err) {
      if ((err as any).fatal) throw err;
      if (attempt === 5) throw err;
      await Bun.sleep(700 * attempt);
    }
  }
  throw new Error(`${title}: fetch failed`);
}

function licenseCode(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value || value === "unknown") return "unknown";
  if (value.includes("public domain")) return "public-domain";
  if (value === "cc0" || value.startsWith("cc0")) return "cc0-1.0";
  if (value.includes("by-sa")) return "cc-by-sa";
  if (value.includes("by-nc")) return "cc-by-nc";
  if (value.startsWith("cc-by") || value === "cc-by") return "cc-by";
  return "unknown";
}

function editionSlug(slug: string, language: string, index: number) {
  return `${slug}-${language === "he" ? "hebrew" : language === "en" ? "english" : language}-sefaria${index ? `-${index}` : ""}`;
}

function parseIndex() {
  return fetch("https://www.sefaria.org/api/index/", { headers: { accept: "application/json" } }).then(async (res) => {
    if (!res.ok) throw new Error(`Sefaria index returned ${res.status}`);
    return (await res.json()) as any[];
  });
}

function collectLeaves(node: any, out: any[]) {
  if (node.title && (!node.contents || node.contents.length === 0)) out.push(node);
  for (const child of node.contents ?? []) collectLeaves(child, out);
}

const index = await parseIndex();
const candidates: { node: any; config: CategoryConfig }[] = [];
for (const config of configs) {
  const root = index.find((n) => n.category === config.label);
  if (!root) {
    console.warn(`No Sefaria index category named ${config.label}`);
    continue;
  }
  const leaves: any[] = [];
  collectLeaves(root, leaves);
  for (const node of leaves) {
    if (!node.title || !config.includes(node)) continue;
    if (workFilter && node.title !== workFilter) continue;
    if (skipTitles.has(node.title)) continue;
    candidates.push({ node, config });
  }
}
const unique = [...new Map(candidates.map((c) => [`${c.config.key}:${c.node.title}`, c])).values()];
if (!unique.length) throw new Error("No Sefaria works matched the requested import.");

const manifest: any = {
  source: "sefaria",
  source_url: "https://www.sefaria.org/",
  retrieved_at: RETRIEVED_AT,
  note:
    "Complete works copied for display in the Universal Wisdom Library. Each edition records the Sefaria version title, version source and licence. The library does not relicense the text.",
  categories: configs.map((c) => ({ key: c.key, label: c.label })),
  works: [],
  skipped: [],
};
const functions = JSON.parse(readFileSync(FUNCTIONS, "utf8"));
let imported = 0;
let failed = 0;

// Sefaria serves each version as one request, so a few works can be fetched at
// once. The pool keeps a whole category from taking hours without hammering the
// API; retries inside fetchVersion already back off on 429s.
const concurrency = Math.max(1, Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? 5));
let cursor = 0;

async function importWork(position: number, node: any, config: CategoryConfig) {
  const label = `[${position + 1}/${unique.length}] ${config.label}: ${node.title}`;
  try {
    const versions: any[] = [];
    for (const version of ["hebrew", "english"] as const) {
      try {
        let data: any;
        try {
          data = await fetchVersion(node.title, version);
        } catch (err) {
          if (!/complex/i.test((err as Error).message)) throw err;
          data = await fetchComplexVersion(node.title, version);
        }
        versions.push({ version, data });
      } catch (err) {
        // Many works have only one language. A missing English edition is not
        // a failure; an empty Hebrew edition still leaves the English usable.
        if (version === "hebrew" && (err as Error).message.includes("empty")) throw err;
      }
      await Bun.sleep(120);
    }
    if (!versions.length) throw new Error("no usable version");

    const primary = versions.find((v) => v.data.language === "he") ?? versions[0];
    const sectionNames = primary.data.parsed.sectionNames;
    const chapterMap = new Map<string, { ref: string; label: string; count: number }>();
    for (const v of versions) {
      for (const ch of v.data.parsed.chapters) {
        const current = chapterMap.get(ch.ref);
        chapterMap.set(ch.ref, {
          ref: ch.ref,
          label: current?.label ?? ch.label,
          count: Math.max(current?.count ?? 0, ch.units.length),
        });
      }
    }
    const chapters = [...chapterMap.values()];
    const chapterOrder = new Map(chapters.map((c, i) => [c.ref, i]));
    chapters.sort((a, b) => {
      const ai = Number(a.ref.match(/^\d+/)?.[0] ?? 0);
      const bi = Number(b.ref.match(/^\d+/)?.[0] ?? 0);
      return ai - bi || (chapterOrder.get(a.ref) ?? 0) - (chapterOrder.get(b.ref) ?? 0);
    });
    const passages: { reference: string; label: string; chapterRef: string }[] = [];
    const textMaps = versions.map(() => ({} as Record<string, string>));
    for (const ch of chapters) {
      for (let i = 0; i < ch.count; i++) {
        const reference = `${ch.ref}.${i + 1}`;
        passages.push({ reference, label: `${ch.ref}:${i + 1}`, chapterRef: ch.ref });
      }
    }
    for (const [vIndex, v] of versions.entries()) {
      for (const ch of v.data.parsed.chapters) {
        ch.units.forEach((unit: string, i: number) => {
          if (unit) textMaps[vIndex][`${ch.ref}.${i + 1}`] = unit;
        });
      }
    }

    const prefix =
      node.corpus === "Yerushalmi" ? "yerushalmi" : config.prefix;
    const slugBase = slugify(node.title.replace(/^(Midrash|Tosefta|Yerushalmi)\s+/, ""));
    const slug = `${prefix}-${slugBase}`;
    const isYerushalmi = node.corpus === "Yerushalmi";
    const originalLanguage = versions.some((v) => v.data.language === "he") ? "he" : "en";
    const work = {
      slug,
      title: node.title,
      originalTitle: node.heTitle ?? "",
      transliteration: "",
      altTitles: node.titleVariants ?? [],
      tradition: "judaism",
      school: "rabbinic-judaism",
      genre: config.genre,
      textType: config.textType,
      category: config.label,
      subcategory: isYerushalmi ? "Yerushalmi" : config.subcategory(node),
      originalLanguage,
      dateStart: isYerushalmi ? 350 : config.dateStart,
      dateEnd: isYerushalmi ? 450 : config.dateEnd,
      dateDisplay: isYerushalmi ? "Compiled c. 400 CE" : config.dateDisplay,
      authorshipStatus: config.authorshipStatus ?? "composite",
      attributionNote:
        "Authorship follows the Sefaria catalogue record for this work. Where a text is traditionally attributed or collectively compiled, the library does not assert a single author beyond the source's own metadata.",
      description:
        `${node.enShortDesc ?? node.description ?? node.title} Complete ${config.label} text imported from Sefaria; the exact edition and licence are shown with each version.`.trim(),
      historicalContext: isYerushalmi
        ? "The Jerusalem Talmud is a separate rabbinic compilation from the Babylonian Talmud, shaped by the academies of the Land of Israel."
        : config.historicalContext,
      availabilityNote: `Imported from Sefaria. Version, source and licence are recorded per edition.`,
      featured: 0,
      featuredNote: "",
      refScheme: config.refScheme ?? (primary.data.parsed.isDaf ? "daf.line" : "chapter.paragraph"),
      isSample: false,
      chapters: chapters.map((c) => ({ ref: c.ref, label: c.label })),
      passages,
      editions: versions.map((v, i) => {
        const language = v.data.language === "he" ? "he" : v.data.language === "en" ? "en" : v.data.language;
        return {
          slug: editionSlug(slug, language, i),
          language,
          editionType: language === originalLanguage ? "original" : "translation",
          title: v.data.title || `Sefaria ${v.version} edition`,
          translator: "",
          publisher: v.data.versionSource || "Sefaria",
          publicationYear: null,
          source: "sefaria",
          license: licenseCode(v.data.license),
          rightsStatus: v.data.license || "Unknown (as recorded by Sefaria)",
          attributionText:
            `${v.data.title || "Sefaria edition"}; licence: ${v.data.license || "unknown"}; source: ${v.data.versionSource || "Sefaria"}. Retrieved via Sefaria on ${RETRIEVED_AT}.`,
          structureScheme: primary.data.parsed.isDaf ? "daf and line" : "chapter and paragraph",
          notes:
            `${v.data.versionNotes || "Complete work imported from Sefaria."} Text is displayed as supplied by the named edition; HTML markup has been removed.`,
          isSample: false,
          texts: textMaps[i],
        };
      }),
    };

    const serialized = JSON.stringify(work, null, 2) + "\n";
    writeFileSync(join(WORKS, `${slug}.json`), serialized);
    manifest.works.push({
      title: node.title,
      slug,
      category: config.label,
      subcategory: work.subcategory,
      chapters: chapters.length,
      passages: passages.length,
      versions: versions.map((v) => ({
        language: v.data.language,
        title: v.data.title,
        licence: v.data.license,
        source: v.data.versionSource,
      })),
      sha256: new Bun.CryptoHasher("sha256").update(serialized).digest("hex"),
    });
    if (!functions.works[slug]) {
      functions.works[slug] = {
        functions: config.functions,
        assignedBy: "UWL editors (comparative taxonomy)",
        status: "affirmed",
        note: `${config.label} work imported from Sefaria. Classification describes its function in rabbinic Judaism, not a ranking of value.`,
      };
    }
    imported++;
    console.log(`${label} — ${chapters.length} chapters, ${passages.length} passages, ${versions.length} versions`);
  } catch (err) {
    failed++;
    manifest.skipped.push({ title: node.title, category: config.label, reason: (err as Error).message });
    console.log(`${label} — skipped: ${(err as Error).message}`);
  }
}

await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (imported + failed < limit) {
      const index = cursor++;
      if (index >= unique.length) return;
      await importWork(index, unique[index].node, unique[index].config);
    }
  }),
);

// A retry for one skipped work should not discard the receipts of the other
// works imported in an earlier run. Merge by slug/title and recompute totals.
const previous = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : null;
const mergedWorks = new Map<string, any>((previous?.works ?? []).map((w: any) => [w.slug, w]));
for (const work of manifest.works) mergedWorks.set(work.slug, work);
const skipped = new Map<string, any>((previous?.skipped ?? []).map((s: any) => [s.title, s]));
for (const work of manifest.works) skipped.delete(work.title);
for (const entry of manifest.skipped) skipped.set(entry.title, entry);
manifest.works = [...mergedWorks.values()].sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
manifest.skipped = [...skipped.values()].sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
manifest.totals = {
  works: manifest.works.length,
  skipped: manifest.skipped.length,
  chapters: manifest.works.reduce((n: number, w: any) => n + w.chapters, 0),
  passages: manifest.works.reduce((n: number, w: any) => n + w.passages, 0),
};
writeFileSync(FUNCTIONS, JSON.stringify(functions, null, 2) + "\n");
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Imported ${imported} works (${manifest.totals.chapters} chapters, ${manifest.totals.passages} passages); skipped ${failed}.`);
