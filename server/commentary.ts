/**
 * Commentaries by verse.
 *
 * For one passage of a base text, list every commentary the library can find
 * keyed to that passage, and fetch the text of one of them on request:
 *
 * - Sefaria's links, for the Tanakh, Mishnah, Talmud and other works Sefaria
 *   serves (and for the Christian Old Testament, read against the Hebrew
 *   Bible's verse numbers).
 * - Barnes' Notes on the New Testament, held in the library. Its paragraphs
 *   are marked "THE GOSPEL ACCORDING TO JOHN - Chapter 3 - Verse 16"; an
 *   index built once from those markers finds the paragraphs for a verse.
 * - The tafsir works on the shelf (al-Tabari, Ibn Kathir, al-Qurtubi), keyed
 *   by surah and ayah like the Qur'an itself and streamed from Quran.com.
 *
 * The library's own `commentaries` table is returned with the passage by the
 * reader and is not repeated here.
 *
 * Nothing fetched here is stored on disk: Sefaria and Quran.com text is held
 * in memory for a while, as streamed reading text is.
 */
import { getDb } from "./db";
import { fetchJson, getStreamChapter, providerLabel, streamWork, toSegments, TAFSIR_GAP_MARKER } from "./stream";

type Row = Record<string, any>;

export type CommentaryGroup = {
  /** Stable id within the response: `sefaria:<index title>`, `barnes`, `tafsir:<slug>`. */
  id: string;
  title: string;
  titleNative?: string;
  /** Short name of the commentator, where the host gives one ("Rashi"). */
  author?: string;
  /** Grouping shown in the panel: Commentary, Midrash, Tafsir, … */
  category: string;
  provider: string;
  providerLabel: string;
  /** Number of linked comments on this passage. Null when not known before the text is read. */
  count: number | null;
  hasEnglish: boolean;
  /** Composition year, where known (Sefaria). */
  year?: number | null;
  /** A work on the library shelf this commentary can be opened in. */
  libraryHref?: string;
  externalUrl?: string;
};

export type CommentaryEntry = {
  ref: string;
  label: string;
  /** Translation, when the host has one. */
  text: string;
  /** Original-language text, when the host gives it separately. */
  original?: string;
  originalLanguage?: string;
  direction?: "rtl" | "ltr";
  href?: string;
  externalUrl?: string;
};

export type CommentaryText = {
  id: string;
  title: string;
  entries: CommentaryEntry[];
  edition?: string;
  editionOriginal?: string;
  license?: string;
  source: { name: string; url: string };
  notice?: string;
};

// ---------------------------------------------------------------------------
// Which book is this?
// ---------------------------------------------------------------------------

/** Sefaria's titles for the 39 books, in the Christian (KJV) order Bolls numbers them by. */
const SEFARIA_TANAKH_BY_KJV = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth", "I Samuel", "II Samuel",
  "I Kings", "II Kings", "I Chronicles", "II Chronicles", "Ezra", "Nehemiah", "Esther", "Job", "Psalms", "Proverbs",
  "Ecclesiastes", "Song of Songs", "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
  "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
];

/** The catalogue's own sample gospels are not streamed; name their books here. */
const CORPUS_BOOKS: Record<string, number> = {
  "gospel-of-matthew": 40,
  "gospel-of-mark": 41,
  "gospel-of-luke": 42,
  "gospel-of-john": 43,
};

/** The Bible book (1–66, KJV order) a work holds, if it is one. */
export function bibleBook(slug: string): number | null {
  if (CORPUS_BOOKS[slug]) return CORPUS_BOOKS[slug];
  const stream = streamWork(slug);
  if (!stream) return null;
  if (stream.provider === "bolls") {
    const n = Number(stream.upstream);
    return Number.isInteger(n) && n >= 1 && n <= 66 ? n : null;
  }
  if (stream.provider === "sefaria") {
    const i = SEFARIA_TANAKH_BY_KJV.indexOf(stream.upstream);
    return i >= 0 ? i + 1 : null;
  }
  return null;
}

function isQuran(slug: string): boolean {
  if (slug === "quran") return true;
  return streamWork(slug)?.provider === "alquran-cloud";
}

/** "3.16" → [3, 16]; anything else → null. */
function chapterVerse(reference: string): [string, number] | null {
  const m = /^([0-9]+[ab]?)\.([0-9]+)$/.exec(reference.trim());
  return m ? [m[1], Number(m[2])] : null;
}

/** The Sefaria reference for a passage of a base work, or null if Sefaria cannot address it. */
export function sefariaRefFor(slug: string, reference: string): string | null {
  const cv = chapterVerse(reference);
  if (!cv) return null;
  const stream = streamWork(slug);
  if (stream?.provider === "sefaria") {
    // A "complex" work is addressed by section name; only the Tanakh books
    // among them (Psalms) are still plain chapter and verse.
    if (stream.mode !== "numbered" && !SEFARIA_TANAKH_BY_KJV.includes(stream.upstream)) return null;
    return `${stream.upstream} ${cv[0]}:${cv[1]}`;
  }
  const book = bibleBook(slug);
  if (book && book <= 39) return `${SEFARIA_TANAKH_BY_KJV[book - 1]} ${cv[0]}:${cv[1]}`;
  return null;
}

// ---------------------------------------------------------------------------
// A small memory cache, shared by everything below
// ---------------------------------------------------------------------------

const TTL = 6 * 60 * 60 * 1000;
const MAX = 400;
const cache = new Map<string, { at: number; value: any }>();
const inflight = new Map<string, Promise<any>>();

async function cached<T>(key: string, load: () => Promise<T>, keep: (v: T) => boolean = () => true): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as T;
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const task = (async () => {
    try {
      const value = await load();
      if (keep(value)) {
        if (cache.size >= MAX) cache.delete(cache.keys().next().value!);
        cache.set(key, { at: Date.now(), value });
      }
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, task);
  return task;
}

export function clearCommentaryCache() {
  cache.clear();
  barnesIndex = null;
}

// ---------------------------------------------------------------------------
// Sefaria
// ---------------------------------------------------------------------------

type SefariaLink = {
  ref: string;
  indexTitle: string;
  heTitle: string;
  collectiveTitle: string;
  category: string;
  type: string;
  anchorRef: string;
  hasEnglish: boolean;
  year: number | null;
};

/** The classic running commentaries first, in the order Sefaria's own sidebar leads with them. */
const SEFARIA_CLASSICS = [
  "Rashi", "Ramban", "Ibn Ezra", "Rashbam", "Sforno", "Kli Yakar", "Or HaChaim", "Baal HaTurim", "Radak", "Tur",
  "Abarbanel", "Malbim", "Shadal", "Ralbag", "Chizkuni", "Metzudat David", "Metzudat Zion", "Tosafot", "Rif", "Rosh",
  "Rambam", "Meiri", "Ran", "Rashba", "Ritva", "Bartenura", "Tosafot Yom Tov", "Onkelos", "Targum Jonathan",
];

/** Category order in the panel; anything not named sorts after, alphabetically. */
const CATEGORY_ORDER = [
  "Commentary", "Tafsir", "Targum", "Mishnah", "Talmud", "Midrash", "Halakhah", "Tanakh", "Quoting Commentary",
  "Kabbalah", "Chasidut", "Musar", "Jewish Thought", "Liturgy", "Responsa", "Second Temple", "Reference",
];

async function sefariaLinks(ref: string): Promise<SefariaLink[]> {
  return cached(
    `sefaria-links:${ref}`,
    async () => {
      const url = `https://www.sefaria.org/api/links/${encodeURIComponent(ref)}?with_text=0`;
      const { status, body } = await fetchJson(url, { timeoutMs: 20_000 });
      if (status !== 200 || !Array.isArray(body)) throw new Error(`Sefaria returned ${status} for links to ${ref}`);
      return body
        .map((l: any): SefariaLink => {
          const collective = l?.collectiveTitle && typeof l.collectiveTitle === "object" ? l.collectiveTitle : {};
          const comp = Array.isArray(l?.compDate) ? l.compDate[0] : l?.compDate;
          return {
            ref: String(l?.ref ?? l?.sourceRef ?? ""),
            indexTitle: String(l?.index_title ?? ""),
            heTitle: String(l?.heTitle ?? ""),
            collectiveTitle: String(collective.en ?? (typeof l?.collectiveTitle === "string" ? l.collectiveTitle : "")),
            category: String(l?.category ?? ""),
            type: String(l?.type ?? ""),
            anchorRef: String(l?.anchorRef ?? ""),
            hasEnglish: !!l?.sourceHasEn,
            year: Number.isFinite(Number(comp)) ? Number(comp) : null,
          };
        })
        .filter((l: SefariaLink) => l.ref && l.indexTitle && l.category);
    },
  );
}

function sefariaUrl(ref: string): string {
  return `https://www.sefaria.org/${encodeURIComponent(ref.replaceAll(" ", "_")).replace(/%3A/g, ":")}`;
}

/**
 * Commentaries on this very book come first, the classics in their usual
 * order; a classic commentator's notes on another book ("Rashi on Taanit",
 * quoting the verse) follow with everything else.
 */
export function classicRank(name: string, title: string, book: string): number {
  const onThisBook = title.endsWith(` on ${book}`) || title === book;
  if (!onThisBook) return SEFARIA_CLASSICS.length + 1;
  const i = SEFARIA_CLASSICS.findIndex((key) => name === key || name.startsWith(`${key} `) || title.startsWith(key));
  return i >= 0 ? i : SEFARIA_CLASSICS.length;
}

/** Drop Sefaria's inline footnotes (a marker and the note itself), which would run into the text. */
export function stripSefariaFootnotes(html: string): string {
  let out = html.replace(/<sup[^>]*class="[^"]*footnote-marker[^"]*"[^>]*>[\s\S]*?<\/sup>/gi, "");
  for (;;) {
    const start = out.search(/<i[^>]*class="[^"]*footnote[^"]*"[^>]*>/i);
    if (start < 0) break;
    const tag = /<\/?i\b[^>]*>/gi;
    tag.lastIndex = start;
    let depth = 0;
    let end = -1;
    for (let m = tag.exec(out); m; m = tag.exec(out)) {
      depth += m[0][1] === "/" ? -1 : 1;
      if (depth === 0) {
        end = m.index + m[0].length;
        break;
      }
    }
    if (end < 0) break;
    out = out.slice(0, start) + " " + out.slice(end);
  }
  return out;
}

function cleanTree(value: any): any {
  if (typeof value === "string") return stripSefariaFootnotes(value);
  if (Array.isArray(value)) return value.map(cleanTree);
  return value;
}

async function sefariaGroups(baseRef: string): Promise<CommentaryGroup[]> {
  const links = await sefariaLinks(baseRef);
  const book = baseRef.replace(/\s[0-9]+[ab]?:[0-9]+$/, "");
  const groups = new Map<string, CommentaryGroup & { rank: number }>();
  for (const l of links) {
    let g = groups.get(l.indexTitle);
    if (!g) {
      g = {
        id: `sefaria:${l.indexTitle}`,
        title: l.indexTitle,
        titleNative: l.heTitle || undefined,
        author: l.collectiveTitle || undefined,
        category: l.category,
        provider: "sefaria",
        providerLabel: providerLabel("sefaria"),
        count: 0,
        hasEnglish: false,
        year: l.year,
        externalUrl: sefariaUrl(l.ref),
        rank: classicRank(l.collectiveTitle || l.indexTitle, l.indexTitle, book),
      };
      groups.set(l.indexTitle, g);
    }
    g.count = (g.count ?? 0) + 1;
    if (l.hasEnglish) g.hasEnglish = true;
  }
  return [...groups.values()]
    .sort((a, b) => a.rank - b.rank || (a.year ?? 1200) - (b.year ?? 1200) || (b.count ?? 0) - (a.count ?? 0))
    .map(({ rank: _rank, ...g }) => g);
}

/**
 * The refs to read for one linked work. A running commentary links each of
 * its comments on a verse separately ("Rashi on Genesis 1:1:1", "…:2"); one
 * read of "Rashi on Genesis 1:1" returns them all, in order.
 */
function sefariaReadRefs(links: SefariaLink[], baseRef: string): string[] {
  const suffix = baseRef.replace(/^.*?\s(?=[0-9]+[ab]?:[0-9]+$)/, "");
  const out: string[] = [];
  for (const l of links) {
    const parent = `${l.indexTitle} ${suffix}`;
    const ref = l.ref.startsWith(`${parent}:`) ? parent : l.ref;
    if (!out.includes(ref)) out.push(ref);
  }
  return out.slice(0, 8);
}

async function sefariaText(baseRef: string, indexTitle: string): Promise<CommentaryText> {
  const links = (await sefariaLinks(baseRef)).filter((l) => l.indexTitle === indexTitle);
  if (!links.length) throw Object.assign(new Error("That commentary is not linked to this passage"), { status: 404 });
  const refs = sefariaReadRefs(links, baseRef);
  let edition = "";
  let editionOriginal = "";
  let license = "";
  const results = await Promise.all(
    refs.map((ref) =>
      cached(`sefaria-text:${ref}`, async () => {
        const url = `https://www.sefaria.org/api/v3/texts/${encodeURIComponent(ref)}?version=english&version=source`;
        const { status, body } = await fetchJson(url, { timeoutMs: 20_000 });
        if (status !== 200 || !body) throw new Error(`Sefaria returned ${status} for ${ref}`);
        return body;
      }).catch(() => null),
    ),
  );
  const entries: CommentaryEntry[] = [];
  results.forEach((body, i) => {
    if (!body) return;
    const versions: any[] = Array.isArray(body.versions) ? body.versions : [];
    const en = versions.find((v) => v?.language === "en" && v?.text && toSegments(v.text).length);
    const src = versions.find((v) => v?.language !== "en" && v?.text && toSegments(v.text).length);
    const enSegs = en ? toSegments(cleanTree(en.text)) : [];
    const srcSegs = src ? toSegments(cleanTree(src.text)) : [];
    if (en && !edition) {
      edition = String(en.versionTitle ?? "");
      license = String(en.license ?? "");
    }
    if (src && !editionOriginal) {
      editionOriginal = String(src.versionTitle ?? "");
      if (!license) license = String(src.license ?? "");
    }
    const n = Math.max(enSegs.length, srcSegs.length);
    const ref = String(body.ref ?? refs[i]);
    for (let k = 0; k < n; k++) {
      const entryRef = n > 1 ? `${ref}:${k + 1}` : ref;
      entries.push({
        ref: entryRef,
        label: n > 1 ? `${ref} · ${k + 1}` : ref,
        text: enSegs[k] ?? "",
        original: srcSegs[k] || undefined,
        originalLanguage: src?.language || undefined,
        direction: src?.direction === "ltr" ? "ltr" : src ? "rtl" : undefined,
        externalUrl: sefariaUrl(entryRef),
      });
    }
  });
  return {
    id: `sefaria:${indexTitle}`,
    title: indexTitle,
    entries,
    edition: edition || undefined,
    editionOriginal: editionOriginal || undefined,
    license: license || undefined,
    source: { name: "Sefaria", url: sefariaUrl(refs[0]) },
    notice: entries.length ? undefined : "Sefaria did not return text for this commentary just now.",
  };
}

// ---------------------------------------------------------------------------
// Barnes' Notes on the New Testament
// ---------------------------------------------------------------------------

const BARNES = "barnes-ntnotes";
const BARNES_MARKER = /^(.+?) - Chapter (\d+) - Verse (\d+)\s*$/;

/** Barnes' book headings → KJV book number. */
export function barnesBook(heading: string): number | null {
  const h = heading.toUpperCase();
  const nth = /\bTHIRD\b/.test(h) ? 3 : /\bSECOND\b/.test(h) ? 2 : /\bFIRST\b/.test(h) ? 1 : 0;
  if (/REVELATION/.test(h)) return 66;
  if (/\bJUDE\b/.test(h)) return 65;
  if (/EPISTLE/.test(h) && /\bJOHN\b/.test(h)) return 61 + (nth || 1);
  if (/\bPETER\b/.test(h)) return 59 + (nth || 1);
  if (/\bJAMES\b/.test(h)) return 59;
  if (/HEBREWS/.test(h)) return 58;
  if (/PHILEMON/.test(h)) return 57;
  if (/\bTITUS\b/.test(h)) return 56;
  if (/TIMOTHY/.test(h)) return 53 + (nth || 1);
  if (/THESSALONIANS/.test(h)) return 51 + (nth || 1);
  if (/COLOSSIANS/.test(h)) return 51;
  if (/PHILIPPIANS/.test(h)) return 50;
  if (/EPHESIANS/.test(h)) return 49;
  if (/GALATIANS/.test(h)) return 48;
  if (/CORINTHIANS/.test(h)) return 45 + (nth || 1);
  if (/ROMANS/.test(h)) return 45;
  if (/\bACTS\b/.test(h)) return 44;
  if (/\bJOHN\b/.test(h)) return 43;
  if (/\bLUKE\b/.test(h)) return 42;
  if (/\bMARK\b/.test(h)) return 41;
  if (/MATTHEW/.test(h)) return 40;
  return null;
}

type BarnesIndex = { workId: number; verses: Map<string, number[]> };
let barnesIndex: BarnesIndex | null | undefined = null;

/**
 * Walk Barnes' paragraphs once and file each under the verse whose marker
 * precedes it. A new section of the work (its chapter) ends the run, so the
 * "Remarks on chapter …" sections are not filed under a last verse. The first
 * verse of a book often has no marker of its own: paragraphs that open a
 * section and begin "1." go to verse 1 when the section's first marker is
 * verse 2.
 */
export function buildBarnesIndex(rows: { id: number; chapter_ref: string | null; content: string }[]) {
  const verses = new Map<string, number[]>();
  let current: string | null = null;
  let section: string | null = null;
  let pending: number[] = [];
  let pendingStarted = false;
  for (const row of rows) {
    const sec = row.chapter_ref ?? "";
    if (sec !== section) {
      section = sec;
      current = null;
      pending = [];
      pendingStarted = false;
    }
    const text = row.content.trim();
    const m = BARNES_MARKER.exec(text);
    if (m) {
      const book = barnesBook(m[1]);
      current = book ? `${book}:${m[2]}.${m[3]}` : null;
      if (book && m[3] === "2" && pending.length) {
        const first = `${book}:${m[2]}.1`;
        if (!verses.has(first)) verses.set(first, pending);
      }
      pending = [];
      pendingStarted = false;
      continue;
    }
    if (current) {
      if (!verses.has(current)) verses.set(current, []);
      verses.get(current)!.push(row.id);
    } else if (pendingStarted || /^1\.\s/.test(text)) {
      pendingStarted = true;
      pending.push(row.id);
    }
  }
  return verses;
}

function loadBarnesIndex(): BarnesIndex | null {
  if (barnesIndex !== null) return barnesIndex ?? null;
  const db = getDb();
  const work = db.query("SELECT id FROM works WHERE slug = ?").get(BARNES) as Row | null;
  if (!work) {
    barnesIndex = undefined;
    return null;
  }
  const rows = db
    .query(
      `SELECT p.id, p.chapter_ref, pt.content FROM passages p
       JOIN passage_texts pt ON pt.passage_id = p.id
       WHERE p.work_id = ? ORDER BY p.sort_order, pt.id`,
    )
    .all(work.id) as { id: number; chapter_ref: string | null; content: string }[];
  // One text per passage: the first edition's.
  const seen = new Set<number>();
  const unique = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  barnesIndex = { workId: work.id, verses: buildBarnesIndex(unique) };
  return barnesIndex;
}

function barnesKey(slug: string, reference: string): string | null {
  const book = bibleBook(slug);
  const cv = chapterVerse(reference);
  if (!book || book < 40 || !cv) return null;
  return `${book}:${cv[0]}.${cv[1]}`;
}

function barnesWork(): Row | null {
  return getDb()
    .query(
      `SELECT w.slug, w.title, li.name AS license_name, so.name AS source_name, so.url AS source_url
       FROM works w LEFT JOIN editions e ON e.work_id = w.id
       LEFT JOIN licenses li ON li.id = e.license_id LEFT JOIN sources so ON so.id = e.source_id
       WHERE w.slug = ? LIMIT 1`,
    )
    .get(BARNES) as Row | null;
}

function barnesText(slug: string, reference: string): CommentaryText {
  const index = loadBarnesIndex();
  const key = barnesKey(slug, reference);
  const ids = (index && key && index.verses.get(key)) || [];
  const work = barnesWork();
  const rows = ids.length
    ? (getDb()
        .query(
          `SELECT p.id, p.reference, p.label, (SELECT content FROM passage_texts WHERE passage_id = p.id ORDER BY id LIMIT 1) AS content
           FROM passages p WHERE p.id IN (${ids.map(() => "?").join(",")}) ORDER BY p.sort_order`,
        )
        .all(...ids) as Row[])
    : [];
  return {
    id: "barnes",
    title: work?.title ?? "Barnes' New Testament Notes",
    entries: rows.map((r) => ({
      ref: String(r.reference),
      label: "",
      text: String(r.content ?? ""),
      href: `/read/${BARNES}/${encodeURIComponent(r.reference)}`,
    })),
    edition: work?.title,
    license: work?.license_name ?? "Public domain",
    source: { name: work?.source_name ?? "Christian Classics Ethereal Library", url: work?.source_url ?? "https://www.ccel.org/" },
  };
}

// ---------------------------------------------------------------------------
// Tafsir
// ---------------------------------------------------------------------------

/** Death years of the mufassirun (CE), so the tafsirs list oldest first. */
const TAFSIR_YEARS: Record<string, number> = {
  "tafsir-al-tabari": 923,
  "tafsir-al-qurtubi": 1273,
  "tafsir-ibn-kathir": 1373,
};

function tafsirWorks(): Row[] {
  return getDb()
    .query(
      `SELECT w.slug, w.title, w.original_title, ws.config_json FROM work_streams ws JOIN works w ON w.slug = ws.work_slug
       WHERE ws.provider = 'quran-tafsir' ORDER BY w.title`,
    )
    .all() as Row[];
}

async function tafsirText(tafsirSlug: string, reference: string): Promise<CommentaryText> {
  const db = getDb();
  const work = db.query("SELECT id, title FROM works WHERE slug = ?").get(tafsirSlug) as Row | null;
  const stream = streamWork(tafsirSlug);
  const cv = chapterVerse(reference);
  if (!work || !stream || stream.provider !== "quran-tafsir" || !cv) {
    throw Object.assign(new Error("That tafsir is not on the shelf"), { status: 404 });
  }
  const rows = db
    .query("SELECT reference, label FROM passages WHERE work_id = ? AND chapter_ref = ? ORDER BY sort_order")
    .all(work.id, cv[0]) as Row[];
  const chapter = await getStreamChapter(
    tafsirSlug,
    { ref: cv[0], label: `Surah ${cv[0]}`, labels: rows.map((r) => String(r.label)) },
    rows.length,
  );
  const edition = chapter?.editions.find((e) => e.segments.length);
  const raw = edition?.segments[cv[1] - 1] ?? "";
  const text = raw && !raw.includes(TAFSIR_GAP_MARKER) ? raw : "";
  const sourceUrl = String(stream.config?.sourceUrl ?? "https://quran.com/");
  return {
    id: `tafsir:${tafsirSlug}`,
    title: String(work.title),
    entries: text
      ? [
          {
            ref: reference,
            label: `${cv[0]}:${cv[1]}`,
            text: "",
            original: text,
            originalLanguage: "ar",
            direction: "rtl",
            href: `/read/${tafsirSlug}/${encodeURIComponent(reference)}`,
            externalUrl: `https://quran.com/${cv[0]}:${cv[1]}/tafsirs`,
          },
        ]
      : [],
    editionOriginal: edition?.versionTitle || String(stream.config?.edition ?? ""),
    license: edition?.license || stream.licence || undefined,
    source: { name: "Quran.com", url: sourceUrl },
    notice: chapter
      ? text
        ? undefined
        : "This tafsir has no comment on this ayah in the text Quran.com serves."
      : "Quran.com did not answer just now. Try again in a moment.",
  };
}

// ---------------------------------------------------------------------------
// The two calls the API makes
// ---------------------------------------------------------------------------

function passageExists(slug: string, reference: string): boolean {
  return !!getDb()
    .query("SELECT 1 FROM passages p JOIN works w ON w.id = p.work_id WHERE w.slug = ? AND p.reference = ?")
    .get(slug, reference);
}

export async function listCommentaries(slug: string, rawRef: string) {
  const reference = rawRef.replace(/:/g, ".").trim();
  if (!passageExists(slug, reference)) return null;
  const groups: CommentaryGroup[] = [];
  const notices: string[] = [];

  if (isQuran(slug) && chapterVerse(reference)) {
    const tafsirs = tafsirWorks().sort((a, b) => (TAFSIR_YEARS[a.slug] ?? 9999) - (TAFSIR_YEARS[b.slug] ?? 9999));
    for (const t of tafsirs) {
      groups.push({
        id: `tafsir:${t.slug}`,
        title: String(t.title),
        titleNative: t.original_title || undefined,
        category: "Tafsir",
        provider: "quran-tafsir",
        providerLabel: "Quran.com",
        count: null,
        hasEnglish: false,
        year: TAFSIR_YEARS[t.slug] ?? null,
        libraryHref: `/read/${t.slug}/${encodeURIComponent(reference)}`,
      });
    }
  }

  const bKey = barnesKey(slug, reference);
  if (bKey) {
    const index = loadBarnesIndex();
    const n = index?.verses.get(bKey)?.length ?? 0;
    if (n) {
      const work = barnesWork();
      groups.push({
        id: "barnes",
        title: work?.title ?? "Barnes' New Testament Notes",
        author: "Albert Barnes",
        category: "Commentary",
        provider: "library",
        providerLabel: "This library",
        count: n,
        hasEnglish: true,
        year: 1832,
      });
    }
  }

  const sRef = sefariaRefFor(slug, reference);
  let sefariaRefUsed: string | null = null;
  if (sRef) {
    sefariaRefUsed = sRef;
    try {
      groups.push(...(await sefariaGroups(sRef)));
    } catch {
      notices.push("Sefaria did not answer, so its commentaries are not listed. Try again in a moment.");
    }
    const book = bibleBook(slug);
    if (book && streamWork(slug)?.provider !== "sefaria") {
      notices.push("Sefaria's links follow the Hebrew Bible's verse numbers, which differ from this translation's in a few places.");
    }
  }

  const rank = (c: string) => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i >= 0 ? i : CATEGORY_ORDER.length;
  };
  const categories = [...new Set(groups.map((g) => g.category))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return {
    work: slug,
    reference,
    sefariaRef: sefariaRefUsed,
    categories: categories.map((name) => ({ name, count: groups.filter((g) => g.category === name).length })),
    groups,
    notices,
  };
}

export async function readCommentary(slug: string, rawRef: string, id: string): Promise<CommentaryText | null> {
  const reference = rawRef.replace(/:/g, ".").trim();
  if (!passageExists(slug, reference)) return null;
  if (id === "barnes") {
    if (!barnesKey(slug, reference)) return null;
    return barnesText(slug, reference);
  }
  if (id.startsWith("tafsir:")) {
    if (!isQuran(slug)) return null;
    return tafsirText(id.slice("tafsir:".length), reference);
  }
  if (id.startsWith("sefaria:")) {
    const sRef = sefariaRefFor(slug, reference);
    if (!sRef) return null;
    return sefariaText(sRef, id.slice("sefaria:".length));
  }
  return null;
}
