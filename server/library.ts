import { getDb } from "./db";
import { meta } from "./db";
import { sortShelfWorks } from "./canon";
import { providerLabel, streamWork, streamedWorkCount } from "./stream";
import { ADAPTERS, type SourceAdapter } from "../ingest/adapters";

type Row = Record<string, any>;

const site = () => ({
  name: meta("site_name", "Universal Wisdom Library"),
  tagline: meta("site_tagline", ""),
  description: meta("site_description", ""),
  corpusVersion: meta("corpus_version", ""),
  corpusLabel: meta("corpus_label", "Curated corpus"),
  corpusNotice: meta("corpus_notice", ""),
});

function mapWork(r: Row) {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    originalTitle: r.original_title,
    transliteration: r.transliteration,
    altTitles: JSON.parse(r.alt_titles_json || "[]"),
    tradition: { slug: r.tradition_slug, name: r.tradition_name },
    school: r.school_slug ? { slug: r.school_slug, name: r.school_name } : null,
    author: r.author_name ? { slug: r.author_slug, name: r.author_name, attributed: !!r.author_attributed } : null,
    genre: r.genre,
    textType: r.text_type,
    category: r.category || r.genre || "Other",
    subcategory: r.subcategory || "",
    originalLanguage: {
      code: r.original_language,
      name: r.original_language_name,
      nativeName: r.original_language_native,
      direction: r.original_language_direction,
    },
    dateStart: r.date_start,
    dateEnd: r.date_end,
    dateDisplay: r.date_display,
    authorshipStatus: r.authorship_status,
    attributionNote: r.attribution_note,
    description: r.description,
    historicalContext: r.historical_context,
    availabilityNote: r.availability_note,
    isSample: !!r.is_sample,
    featured: !!r.featured,
    featuredNote: r.featured_note,
    editionCount: Number(r.edition_count ?? 0),
    translationCount: Number(r.translation_count ?? 0),
    passageCount: Number(r.passage_count ?? 0),
    chapterCount: Number(r.chapter_count ?? 0),
    languages: String(r.languages ?? "").split(",").filter(Boolean),
    rights: String(r.rights ?? "").split(",").filter(Boolean),
    hasOriginal: Number(r.has_original ?? 0) > 0,
  };
}

const WORK_SELECT = `
  SELECT w.*, t.slug AS tradition_slug, t.name AS tradition_name,
         s.slug AS school_slug, s.name AS school_name,
         a.slug AS author_slug, a.name AS author_name, a.is_attributed AS author_attributed,
         l.name AS original_language_name, l.native_name AS original_language_native, l.direction AS original_language_direction,
         (SELECT COUNT(*) FROM editions e WHERE e.work_id = w.id) AS edition_count,
         (SELECT COUNT(*) FROM editions e WHERE e.work_id = w.id AND e.edition_type = 'translation') AS translation_count,
         (SELECT COUNT(*) FROM passages p WHERE p.work_id = w.id) AS passage_count,
         (SELECT COUNT(DISTINCT p.chapter_ref) FROM passages p WHERE p.work_id = w.id) AS chapter_count,
         (SELECT GROUP_CONCAT(DISTINCT e.language_code) FROM editions e WHERE e.work_id = w.id) AS languages,
         (SELECT GROUP_CONCAT(DISTINCT li.name) FROM editions e JOIN licenses li ON li.id = e.license_id WHERE e.work_id = w.id) AS rights,
         (SELECT COUNT(*) FROM editions e WHERE e.work_id = w.id AND e.edition_type = 'original') AS has_original
  FROM works w
  JOIN traditions t ON t.id = w.tradition_id
  LEFT JOIN schools s ON s.id = w.school_id
  LEFT JOIN authors a ON a.id = w.author_id
  LEFT JOIN languages l ON l.code = w.original_language
`;

// The search response carried this whole object on every query — 826 KB of it,
// 758 KB a list of every work for one dropdown. The work list is now asked for
// once, when a reader reaches for the filter, and search sends the rest only.
export function facets(options: { works?: boolean } = {}) {
  const db = getDb();
  const traditions = db
    .query(
      `SELECT t.slug, t.name, COUNT(w.id) AS works FROM traditions t
       LEFT JOIN works w ON w.tradition_id = t.id GROUP BY t.id ORDER BY t.sort_order`,
    )
    .all() as Row[];
  const rows = db
    .query(
      `SELECT w.genre, w.text_type, w.category, w.subcategory, w.date_start, w.date_end, e.language_code, lang.name AS language_name,
              so.slug AS source_slug, so.name AS source_name,
              li.code AS license_code, li.name AS license_name, a.slug AS author_slug, a.name AS author_name,
              s.slug AS school_slug, s.name AS school_name, w.slug AS work_slug, w.title AS work_title,
              w.tradition_id, t.slug AS tradition_slug, t.name AS tradition_name
       FROM works w
       LEFT JOIN authors a ON a.id = w.author_id
       LEFT JOIN schools s ON s.id = w.school_id
       LEFT JOIN traditions t ON t.id = w.tradition_id
       LEFT JOIN editions e ON e.work_id = w.id
       LEFT JOIN languages lang ON lang.code = e.language_code
       LEFT JOIN sources so ON so.id = e.source_id
       LEFT JOIN licenses li ON li.id = e.license_id`,
    )
    .all() as Row[];
  const uniq = (pairs: [string, string][]) => {
    const m = new Map<string, string>();
    for (const [v, l] of pairs) if (v) m.set(v, l);
    return [...m.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  };
  return {
    traditions: traditions.map((t) => ({ value: t.slug, label: t.name, count: t.works })),
    schools: uniq(rows.map((r) => [r.school_slug, r.school_name])),
    authors: uniq(rows.map((r) => [r.author_slug, r.author_name])),
    languages: uniq(rows.map((r) => [r.language_code, r.language_name ?? r.language_code])),
    genres: uniq(rows.map((r) => [r.genre, r.genre])),
    textTypes: uniq(rows.map((r) => [r.text_type, r.text_type])),
    categories: uniq(rows.map((r) => [r.category || r.genre, r.category || r.genre])),
    subcategories: uniq(rows.map((r) => [r.subcategory, r.subcategory])),
    sources: uniq(rows.map((r) => [r.source_slug, r.source_name])),
    licenses: uniq(rows.map((r) => [r.license_code, r.license_name])),
    works: options.works === false ? [] : rows
      .filter((r) => r.work_slug)
      .map((r) => ({
        value: r.work_slug,
        label: r.work_title,
        tradition: r.tradition_slug,
        traditionLabel: r.tradition_name,
        school: r.school_slug,
        schoolLabel: r.school_name,
        genre: r.genre,
        textType: r.text_type,
        category: r.category || r.genre,
        subcategory: r.subcategory,
      }))
      .filter((v, i, arr) => arr.findIndex((x) => x.value === v.value) === i)
      .sort((a, b) => a.label.localeCompare(b.label)),
    eras: [
      { value: "ancient", label: "Ancient (to 499 CE)" },
      { value: "medieval", label: "Medieval (500–1499)" },
      { value: "modern", label: "Modern (1500–)" },
    ],
  };
}

export function listWorks(params: URLSearchParams) {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  const add = (sql: string, value: any) => {
    where.push(sql);
    args.push(value);
  };
  const tradition = params.get("tradition");
  if (tradition) add("t.slug = ?", tradition);
  const school = params.get("school");
  if (school) add("s.slug = ?", school);
  const author = params.get("author");
  if (author) add("a.slug = ?", author);
  const genre = params.get("genre");
  if (genre) add("w.genre = ?", genre);
  const textType = params.get("textType");
  if (textType) add("w.text_type = ?", textType);
  const category = params.get("category");
  if (category) add("w.category = ?", category);
  const subcategory = params.get("subcategory");
  if (subcategory) add("w.subcategory = ?", subcategory);
  const language = params.get("language");
  if (language) add("EXISTS (SELECT 1 FROM editions e WHERE e.work_id = w.id AND e.language_code = ?)", language);
  const source = params.get("source");
  if (source) add("EXISTS (SELECT 1 FROM editions e JOIN sources so ON so.id = e.source_id WHERE e.work_id = w.id AND so.slug = ?)", source);
  const license = params.get("license");
  if (license) add("EXISTS (SELECT 1 FROM editions e JOIN licenses li ON li.id = e.license_id WHERE e.work_id = w.id AND li.code = ?)", license);
  const hasTranslation = params.get("hasTranslation");
  if (hasTranslation === "1") where.push("EXISTS (SELECT 1 FROM editions e WHERE e.work_id = w.id AND e.edition_type = 'translation')");
  const available = params.get("available");
  if (available === "1") where.push("EXISTS (SELECT 1 FROM passages p WHERE p.work_id = w.id)");
  if (available === "0") where.push("NOT EXISTS (SELECT 1 FROM passages p WHERE p.work_id = w.id)");
  const era = params.get("era");
  const ranges: Record<string, [number, number]> = { ancient: [-5000, 499], medieval: [500, 1499], modern: [1500, 2100] };
  if (era && ranges[era]) {
    add("w.date_start <= ?", ranges[era][1]);
    add("COALESCE(w.date_end, w.date_start) >= ?", ranges[era][0]);
  }
  const q = (params.get("q") ?? "").trim();
  if (q) {
    add(
      `(w.title LIKE ? OR w.original_title LIKE ? OR w.transliteration LIKE ? OR w.alt_titles_json LIKE ?
        OR w.description LIKE ? OR a.name LIKE ? OR t.name LIKE ? OR s.name LIKE ?)`,
      `%${q}%`,
    );
    // The helper above adds one placeholder; add the remaining seven.
    for (let i = 0; i < 7; i++) args.push(`%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const totalRow = db
    .query(
      `SELECT COUNT(*) AS n FROM works w JOIN traditions t ON t.id = w.tradition_id
       LEFT JOIN schools s ON s.id = w.school_id LEFT JOIN authors a ON a.id = w.author_id ${whereSql}`,
    )
    .get(...args) as Row;
  const page = Math.max(1, Number(params.get("page") ?? 1));
  const pageSize = Math.min(48, Math.max(6, Number(params.get("pageSize") ?? 12)));
  const rows = db
    .query(`${WORK_SELECT} ${whereSql} ORDER BY w.featured DESC, t.sort_order, w.title LIMIT ? OFFSET ?`)
    .all(...args, pageSize, (page - 1) * pageSize) as Row[];
  return {
    works: rows.map(mapWork),
    total: totalRow.n,
    page,
    pageSize,
    pages: Math.ceil(totalRow.n / pageSize),
    facets: facets(),
  };
}

// Categories carry a reading order per tradition, not a global rank: the
// numbers only compare headings that appear on the same tradition's shelf.
// A Christian shelf opens with the gospels; an Islamic shelf with the Qur’an.
const CATEGORY_ORDER = `CASE w.category
  WHEN 'New Testament' THEN 1 WHEN 'Old Testament' THEN 2
  WHEN 'Patristic theology' THEN 3 WHEN 'Arian controversy' THEN 4 WHEN 'Church history' THEN 5
  WHEN 'Scholastic theology' THEN 6 WHEN 'Gnostic literature' THEN 7
  WHEN 'Non-canonical Christian literature' THEN 8
  WHEN 'Qur’an' THEN 1 WHEN 'Hadith' THEN 2 WHEN 'Theology (Kalam)' THEN 3
  WHEN 'Philosophy (Falsafa)' THEN 4 WHEN 'Jurisprudence (Fiqh)' THEN 5 WHEN 'Sufism' THEN 6
  WHEN 'Tanakh' THEN 10 WHEN 'Torah' THEN 11 WHEN 'Prophets' THEN 12 WHEN 'Writings' THEN 13
  WHEN 'Mishnah' THEN 20 WHEN 'Talmud' THEN 30 WHEN 'Midrash' THEN 40 WHEN 'Tosefta' THEN 50
  WHEN 'Halakhah' THEN 60 WHEN 'Kabbalah' THEN 70 WHEN 'Liturgy' THEN 80
  WHEN 'Jewish Thought' THEN 90 WHEN 'Chasidut' THEN 100 WHEN 'Musar' THEN 110
  WHEN 'Responsa' THEN 120 WHEN 'Second Temple' THEN 130 WHEN 'Reference' THEN 140 ELSE 200 END`;

/**
 * The staged shelf used by the library: tradition counts first, then the
 * categories inside one tradition, then the works in one category, then the
 * chapters of one work. Every level is queried separately so a large corpus
 * never has to be sent to the browser in one payload.
 */
export function getBrowse(params: URLSearchParams) {
  const db = getDb();
  const traditionSlug = (params.get("tradition") ?? "").trim();
  const category = (params.get("category") ?? "").trim();
  const workSlug = (params.get("work") ?? "").trim();

  // The board asks for this on every click, so the passage totals come from one
  // grouped count per work rather than a re-scan per tradition.
  const traditions = db
    .query(
      `WITH passage_counts AS (SELECT work_id, COUNT(*) AS n FROM passages GROUP BY work_id)
       SELECT t.slug, t.name, t.short_name, t.description,
              COUNT(w.id) AS works, COALESCE(SUM(passage_counts.n), 0) AS passages,
              COUNT(DISTINCT w.category) AS categories
       FROM traditions t
       LEFT JOIN works w ON w.tradition_id = t.id
       LEFT JOIN passage_counts ON passage_counts.work_id = w.id
       GROUP BY t.id ORDER BY t.sort_order`,
    )
    .all() as Row[];
  const tradition = traditions.find((t) => t.slug === traditionSlug) ?? null;

  const categories = tradition
    ? (db
        .query(
          `SELECT w.category AS slug, w.category AS label, COUNT(*) AS works,
                  SUM((SELECT COUNT(*) FROM passages p WHERE p.work_id = w.id)) AS passages,
                  COUNT(DISTINCT w.subcategory) AS subcategories
           FROM works w JOIN traditions t ON t.id = w.tradition_id
           WHERE t.slug = ? AND w.category != ''
           GROUP BY w.category ORDER BY ${CATEGORY_ORDER}, w.category COLLATE NOCASE`,
        )
        .all(traditionSlug) as Row[])
    : [];
  const selectedCategory = categories.find((c) => c.slug === category) ?? null;

  // The shelf follows the collection's own reading order (Torah → Nevi'im →
  // Ketuvim, seder by seder, tractate by tractate), not the alphabet.
  const works =
    tradition && selectedCategory
      ? sortShelfWorks(
          category,
          (db
            .query(`${WORK_SELECT} WHERE t.slug = ? AND w.category = ?`)
            .all(traditionSlug, category) as Row[]).map((row) => {
            const work = mapWork(row);
            return { ...work, category: work.category, subcategory: work.subcategory };
          }),
        )
      : [];
  const selectedWorkRow = workSlug ? (db.query(`${WORK_SELECT} WHERE w.slug = ?`).get(workSlug) as Row | null) : null;
  const work = selectedWorkRow ? mapWork(selectedWorkRow) : null;
  const chapters = selectedWorkRow
    ? (db
        .query(
          `SELECT p.chapter_ref AS ref, COUNT(*) AS passages, MIN(p.sort_order) AS sort_order,
                  COALESCE((SELECT tu.label FROM text_units tu JOIN editions e ON e.id = tu.edition_id
                    WHERE e.work_id = p.work_id AND tu.reference = p.chapter_ref ORDER BY tu.id LIMIT 1), p.chapter_ref) AS label
           FROM passages p WHERE p.work_id = ? GROUP BY p.chapter_ref ORDER BY sort_order`,
        )
        .all(selectedWorkRow.id) as Row[])
    : [];
  const editions = selectedWorkRow
    ? (db
        .query(
          `SELECT e.slug, e.title, e.edition_type, e.language_code, e.rights_status, e.attribution_text,
                  l.name AS language_name, l.direction, so.name AS source_name, so.url AS source_url,
                  li.name AS license_name, li.code AS license_code
           FROM editions e JOIN languages l ON l.code = e.language_code
           LEFT JOIN sources so ON so.id = e.source_id LEFT JOIN licenses li ON li.id = e.license_id
           WHERE e.work_id = ? AND e.is_available = 1 ORDER BY e.edition_type DESC, l.code`,
        )
        .all(selectedWorkRow.id) as Row[])
    : [];

  return {
    traditions: traditions.map((t) => ({
      slug: t.slug,
      name: t.name,
      shortName: t.short_name,
      description: t.description,
      works: t.works,
      passages: t.passages,
      categories: t.categories,
    })),
    selected: {
      tradition: tradition
        ? { slug: tradition.slug, name: tradition.name, shortName: tradition.short_name, description: tradition.description }
        : null,
      category: selectedCategory
        ? { slug: selectedCategory.slug, label: selectedCategory.label, works: selectedCategory.works, passages: selectedCategory.passages }
        : null,
      work: work ? { slug: work.slug, title: work.title, category: work.category } : null,
    },
    categories: categories.map((c) => ({
      slug: c.slug,
      label: c.label,
      works: c.works,
      passages: c.passages,
      subcategories: c.subcategories,
    })),
    works,
    work,
    chapters: chapters.map((c) => ({ ref: c.ref, label: c.label, passages: c.passages })),
    editions: editions.map((e) => ({
      slug: e.slug,
      title: e.title,
      editionType: e.edition_type,
      language: { code: e.language_code, name: e.language_name, direction: e.direction },
      rightsStatus: e.rights_status,
      attribution: e.attribution_text,
      source: e.source_name ? { name: e.source_name, url: e.source_url } : null,
      license: e.license_name ? { name: e.license_name, code: e.license_code } : null,
    })),
  };
}

export function getWork(slug: string) {
  const db = getDb();
  const row = db.query(`${WORK_SELECT} WHERE w.slug = ?`).get(slug) as Row | null;
  if (!row) return null;
  const work = mapWork(row);
  const editions = db
    .query(
      `SELECT e.*, l.name AS language_name, l.native_name AS language_native, l.direction,
              so.slug AS source_slug, so.name AS source_name, so.url AS source_url, so.provider AS source_provider,
              so.access_notes, so.status AS source_status, so.retrieved_at,
              li.code AS license_code, li.name AS license_name, li.url AS license_url,
              li.redistribution_allowed, li.attribution_required, li.share_alike, li.notes AS license_notes
       FROM editions e
       JOIN languages l ON l.code = e.language_code
       LEFT JOIN sources so ON so.id = e.source_id
       LEFT JOIN licenses li ON li.id = e.license_id
       WHERE e.work_id = ? AND e.is_available = 1 ORDER BY e.edition_type DESC, e.language_code`,
    )
    .all(row.id) as Row[];
  const stream = streamWork(slug);
  // A streamed work has no local text rows, so every passage carries the
  // languages its upstream editions offer.
  const streamLanguages = stream ? stream.editions.map((e) => e.language).join(",") : "";
  const passages = db
    .query(
      `SELECT p.id, p.reference, p.label, p.chapter_ref, p.section_ref, p.sort_order, p.ref_scheme,
              (SELECT GROUP_CONCAT(ed.language_code) FROM passage_texts pt JOIN editions ed ON ed.id = pt.edition_id WHERE pt.passage_id = p.id) AS available_languages
       FROM passages p WHERE p.work_id = ? ORDER BY p.sort_order`,
    )
    .all(row.id) as Row[];
  const chapters: { ref: string; label: string; passages: any[] }[] = [];
  for (const p of passages) {
    const ref = p.chapter_ref ?? "1";
    let ch = chapters.find((c) => c.ref === ref);
    if (!ch) {
      ch = { ref, label: p.label?.includes(":") ? `Chapter ${ref}` : `Section ${ref}`, passages: [] };
      chapters.push(ch);
    }
    const languages = streamLanguages
      ? [...new Set(streamLanguages.split(","))]
      : String(p.available_languages ?? "").split(",").filter(Boolean);
    ch.passages.push({ id: p.id, reference: p.reference, label: p.label, languages });
  }
  // Chapter labels come from the work's declared chapters where possible.
  const declared = db.query("SELECT DISTINCT reference, label FROM text_units WHERE edition_id IN (SELECT id FROM editions WHERE work_id = ?) ORDER BY reference").all(row.id) as Row[];
  for (const ch of chapters) {
    const found = declared.find((d) => d.reference === ch.ref);
    if (found) ch.label = found.label;
  }
  const textFunctions = db
    .query("SELECT function, assigned_by, status, note FROM work_text_functions WHERE work_id = ? ORDER BY sort_order")
    .all(row.id) as Row[];
  const commentaryCount = (db.query("SELECT COUNT(*) AS n FROM commentaries WHERE work_id = ? AND review_status = 'published'").get(row.id) as Row).n;
  const themeRows = db
    .query(
      `SELECT DISTINCT th.slug, th.name FROM passage_themes pt JOIN themes th ON th.id = pt.theme_id
       JOIN passages p ON p.id = pt.passage_id WHERE p.work_id = ? ORDER BY th.sort_order`,
    )
    .all(row.id) as Row[];
  const relationships = db
    .query(
      `SELECT r.*, fp.reference AS from_reference, fp.label AS from_label, fw.slug AS from_work_slug, fw.title AS from_work_title,
              tp.reference AS to_reference, tp.label AS to_label, tw.slug AS to_work_slug, tw.title AS to_work_title
       FROM text_relationships r
       LEFT JOIN passages fp ON fp.id = r.from_passage_id
       LEFT JOIN works fw ON fw.id = r.from_work_id
       LEFT JOIN passages tp ON tp.id = r.to_passage_id
       LEFT JOIN works tw ON tw.id = r.to_work_id
       WHERE (r.from_work_id = ? OR r.to_work_id = ?) AND r.review_status = 'published'`,
    )
    .all(row.id, row.id) as Row[];
  return {
    work,
    streaming: stream
      ? {
          provider: stream.provider,
          providerLabel: providerLabel(stream.provider),
          upstream: stream.upstream,
          mode: stream.mode,
          editions: stream.editions.map((e) => ({ slug: e.slug, version: e.version, language: e.language })),
        }
      : null,
    textFunctions: textFunctions.map((f) => ({
      function: f.function,
      assignedBy: f.assigned_by,
      status: f.status,
      note: f.note,
    })),
    editions: editions.map((e) => ({
      id: e.id,
      slug: e.slug,
      language: { code: e.language_code, name: e.language_name, nativeName: e.language_native, direction: e.direction },
      editionType: e.edition_type,
      title: e.title,
      translator: e.translator,
      publisher: e.publisher,
      publicationYear: e.publication_year,
      rightsStatus: e.rights_status,
      attributionText: e.attribution_text,
      structureScheme: e.structure_scheme,
      notes: e.notes,
      isSample: !!e.is_sample,
      source: e.source_slug
        ? { slug: e.source_slug, name: e.source_name, url: e.source_url, provider: e.source_provider, accessNotes: e.access_notes, status: e.source_status, retrievedAt: e.retrieved_at }
        : null,
      license: e.license_code
        ? {
            code: e.license_code,
            name: e.license_name,
            url: e.license_url,
            redistributionAllowed: !!e.redistribution_allowed,
            attributionRequired: !!e.attribution_required,
            shareAlike: !!e.share_alike,
            notes: e.license_notes,
          }
        : null,
    })),
    passages: passages.map((p) => ({ id: p.id, reference: p.reference, label: p.label, chapterRef: p.chapter_ref })),
    chapters,
    commentaryCount,
    themes: themeRows,
    relationships: relationships.map((r) => ({
      id: r.id,
      type: r.relationship_type,
      confidence: r.confidence,
      description: r.description,
      evidence: r.evidence,
      from: r.from_passage_id ? { work: r.from_work_slug, title: r.from_work_title, reference: r.from_reference, label: r.from_label } : null,
      to: r.to_passage_id ? { work: r.to_work_slug, title: r.to_work_title, reference: r.to_reference, label: r.to_label } : null,
    })),
    site: site(),
  };
}

export function getHome() {
  const db = getDb();
  const stats = db
    .query(
      `SELECT (SELECT COUNT(*) FROM works) AS works, (SELECT COUNT(*) FROM traditions) AS traditions,
              (SELECT COUNT(*) FROM passages) AS passages, (SELECT COUNT(*) FROM editions) AS editions,
              (SELECT COUNT(*) FROM commentaries WHERE review_status = 'published') AS commentaries,
              (SELECT COUNT(*) FROM themes) AS themes`,
    )
    .get() as Row;
  const featured = db
    .query(`${WORK_SELECT} WHERE w.featured = 1 ORDER BY t.sort_order, w.title LIMIT 6`)
    .all() as Row[];
  // WORK_SELECT describes a work by counting its editions and passages. Applied
  // before LIMIT, it does that for every work in the catalogue — 2,686 of them
  // over 4.7 million passages — before the six most recent are chosen. Pick the
  // six rows first, then describe only those.
  const recentIds = db
    .query(
      `SELECT w.id FROM works w WHERE EXISTS (SELECT 1 FROM passages p WHERE p.work_id = w.id)
       ORDER BY w.created_at DESC, w.id DESC LIMIT 6`,
    )
    .all() as Row[];
  const recent = recentIds.length
    ? (db
        .query(
          `${WORK_SELECT} WHERE w.id IN (${recentIds.map(() => "?").join(",")})
           ORDER BY w.created_at DESC, w.id DESC`,
        )
        .all(...recentIds.map((r) => r.id)) as Row[])
    : [];
  // Counting the joined passages row by row walks all 4.7 million of them. One
  // grouped count per work, then a sum, reads the same index once.
  const traditions = db
    .query(
      `WITH passage_counts AS (SELECT work_id, COUNT(*) AS n FROM passages GROUP BY work_id)
       SELECT t.slug, t.name, t.short_name, t.description, t.permissions_note,
              COUNT(w.id) AS works, COALESCE(SUM(passage_counts.n), 0) AS passages
       FROM traditions t
       LEFT JOIN works w ON w.tradition_id = t.id
       LEFT JOIN passage_counts ON passage_counts.work_id = w.id
       GROUP BY t.id ORDER BY t.sort_order`,
    )
    .all() as Row[];
  const themes = db
    .query(
      `SELECT th.slug, th.name, th.question, th.description, COUNT(pt.passage_id) AS passages,
              GROUP_CONCAT(DISTINCT t.slug) AS traditions
       FROM themes th LEFT JOIN passage_themes pt ON pt.theme_id = th.id
       LEFT JOIN passages p ON p.id = pt.passage_id LEFT JOIN works w ON w.id = p.work_id
       LEFT JOIN traditions t ON t.id = w.tradition_id
       GROUP BY th.id ORDER BY th.sort_order`,
    )
    .all() as Row[];
  const comparisons = db
    .query(
      `SELECT c.id, c.title, c.description, c.share_token, c.curator,
              (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.id) AS item_count
       FROM collections c WHERE c.is_curated = 1 AND c.kind = 'comparison' ORDER BY c.id`,
    )
    .all() as Row[];
  const featuredItems = db
    .query(
      `SELECT ci.collection_id, p.reference, p.label, w.slug, w.title, t.name AS tradition
       FROM collection_items ci JOIN passages p ON p.id = ci.passage_id JOIN works w ON w.id = p.work_id
       JOIN traditions t ON t.id = w.tradition_id
       ORDER BY ci.collection_id, ci.position`,
    )
    .all() as Row[];
  return {
    site: site(),
    stats,
    featured: featured.map(mapWork),
    recent: recent.map(mapWork),
    traditions: traditions.map((t) => ({
      slug: t.slug, name: t.name, shortName: t.short_name, description: t.description,
      permissionsNote: t.permissions_note, works: t.works, passages: t.passages,
    })),
    themes: themes.map((t) => ({
      slug: t.slug, name: t.name, question: t.question, description: t.description,
      passages: t.passages, traditions: String(t.traditions ?? "").split(",").filter(Boolean),
    })),
    comparisons: comparisons.map((c) => ({
      id: c.id, title: c.title, description: c.description, token: c.share_token, curator: c.curator,
      itemCount: c.item_count,
      passages: featuredItems
        .filter((i) => i.collection_id === c.id)
        .map((i) => ({ work: i.slug, workTitle: i.title, reference: i.reference, label: i.label, tradition: i.tradition })),
    })),
    corpus: {
      label: meta("corpus_label", "Curated corpus"),
      notice: meta("corpus_notice", ""),
      version: meta("corpus_version", ""),
    },
  };
}

export function getSiteInfo() {
  return { site: site() };
}

export function getTraditions() {
  const db = getDb();
  const rows = db
    .query(
      `WITH passage_counts AS (SELECT work_id, COUNT(*) AS n FROM passages GROUP BY work_id)
       SELECT t.*, COUNT(w.id) AS works, COALESCE(SUM(passage_counts.n), 0) AS passages
       FROM traditions t
       LEFT JOIN works w ON w.tradition_id = t.id
       LEFT JOIN passage_counts ON passage_counts.work_id = w.id
       GROUP BY t.id ORDER BY t.sort_order`,
    )
    .all() as Row[];
  return rows.map((t) => ({
    slug: t.slug, name: t.name, shortName: t.short_name, description: t.description,
    permissionsNote: t.permissions_note, works: t.works, passages: t.passages,
  }));
}

export function getThemes() {
  const db = getDb();
  const rows = db
    .query(
      `SELECT th.slug, th.name, th.question, th.description, COUNT(pt.passage_id) AS passages
       FROM themes th LEFT JOIN passage_themes pt ON pt.theme_id = th.id GROUP BY th.id ORDER BY th.sort_order`,
    )
    .all() as Row[];
  return rows.map((t) => ({ slug: t.slug, name: t.name, question: t.question, description: t.description, passages: t.passages }));
}

export function getTheme(slug: string) {
  const db = getDb();
  const theme = db.query("SELECT * FROM themes WHERE slug = ?").get(slug) as Row | null;
  if (!theme) return null;
  const rows = db
    .query(
      `SELECT p.id AS passage_id, p.reference, p.label, pt.note, pt.relevance,
              w.slug AS work_slug, w.title AS work_title, w.date_display, w.original_language,
              t.slug AS tradition_slug, t.name AS tradition_name, s.name AS school_name,
              ws.provider AS stream_provider,
              (SELECT pt2.content FROM passage_texts pt2 JOIN editions e2 ON e2.id = pt2.edition_id
                WHERE pt2.passage_id = p.id AND e2.language_code = 'en' LIMIT 1) AS english_text,
              (SELECT ed.slug FROM passage_texts pt2 JOIN editions ed ON ed.id = pt2.edition_id
                WHERE pt2.passage_id = p.id AND ed.language_code = 'en' LIMIT 1) AS english_edition
       FROM passage_themes pt JOIN passages p ON p.id = pt.passage_id
       JOIN works w ON w.id = p.work_id JOIN traditions t ON t.id = w.tradition_id
       LEFT JOIN schools s ON s.id = w.school_id
       LEFT JOIN work_streams ws ON ws.work_slug = w.slug
       WHERE pt.theme_id = ? ORDER BY t.sort_order, w.title, p.sort_order`,
    )
    .all(theme.id) as Row[];
  const groups = new Map<string, { tradition: string; passages: any[] }>();
  for (const r of rows) {
    if (!groups.has(r.tradition_slug)) groups.set(r.tradition_slug, { tradition: r.tradition_name, passages: [] });
    groups.get(r.tradition_slug)!.passages.push({
      passageId: r.passage_id,
      work: r.work_slug,
      workTitle: r.work_title,
      reference: r.reference,
      label: r.label,
      note: r.note,
      relevance: r.relevance,
      dateDisplay: r.date_display,
      school: r.school_name,
      text: r.english_text,
      edition: r.english_edition,
      streaming: r.stream_provider ? providerLabel(r.stream_provider) : null,
    });
  }
  return {
    theme: { slug: theme.slug, name: theme.name, question: theme.question, description: theme.description },
    groups: [...groups.entries()].map(([slug, g]) => ({ traditionSlug: slug, ...g })),
  };
}

// What each adapter is actually carrying, read from the corpus rather than kept
// as a number beside it. The table had drifted badly when it was hand-written:
// GRETIL was still "planned, not connected" with eighty works indexed from it.
// A provider that work_streams uses but no adapter claims is appended below, so
// a new pass shows up here as soon as it is indexed.
function adapterTable(): (SourceAdapter & { usage: AdapterUsage })[] {
  const db = getDb();
  const streamed = new Map<string, number>(
    (db.query("SELECT provider, COUNT(*) AS works FROM work_streams GROUP BY provider").all() as Row[]).map((r) => [r.provider, r.works]),
  );
  const local = new Map<string, number>(
    (
      db
        .query(
          `SELECT s.slug, COUNT(DISTINCT w.id) AS works FROM works w
             JOIN editions e ON e.work_id = w.id JOIN sources s ON s.id = e.source_id
            WHERE EXISTS (SELECT 1 FROM passage_texts pt WHERE pt.edition_id = e.id)
            GROUP BY s.slug`,
        )
        .all() as Row[]
    ).map((r) => [r.slug, r.works]),
  );
  const runs = new Map<string, { runs: number; last: string | null }>(
    (
      db
        .query(
          `SELECT s.slug, COUNT(*) AS runs, MAX(i.finished_at) AS last FROM imports i
             JOIN sources s ON s.id = i.source_id GROUP BY s.slug`,
        )
        .all() as Row[]
    ).map((r) => [r.slug, { runs: r.runs, last: r.last }]),
  );
  const usage = (source: string, providers: string[]): AdapterUsage => ({
    local: local.get(source) ?? 0,
    streamed: providers.reduce((total, provider) => total + (streamed.get(provider) ?? 0), 0),
    runs: runs.get(source)?.runs ?? 0,
    lastRun: runs.get(source)?.last ?? null,
  });
  const rows: (SourceAdapter & { usage: AdapterUsage })[] = ADAPTERS.map((a) => ({ ...a, usage: usage(a.source, a.providers) }));
  const named = new Set(ADAPTERS.flatMap((a) => [a.source, ...a.providers]));
  for (const [provider, works] of streamed) {
    if (named.has(provider)) continue;
    rows.push({
      id: provider,
      label: providerLabel(provider),
      provider: providerLabel(provider),
      status: "connected",
      licence: "Recorded per edition",
      description: `Streamed from ${providerLabel(provider)}; no adapter entry describes it yet.`,
      requires: [],
      canImport: false,
      source: "",
      providers: [provider],
      usage: { local: 0, streamed: works, runs: 0, lastRun: null },
    });
  }
  return rows;
}

type AdapterUsage = { local: number; streamed: number; runs: number; lastRun: string | null };

// The dropdown's options, cut to what a <select> needs: 2,686 rows of ten fields
// each was the payload problem, not the number of works itself.
// `q` filters by title so a caller can ask for a slice instead of the list.
export function workOptions(params: URLSearchParams = new URLSearchParams()) {
  const db = getDb();
  const q = (params.get("q") ?? "").trim();
  const rows = (
    q
      ? db.query("SELECT slug, title FROM works WHERE title LIKE ? ORDER BY title LIMIT 400").all(`%${q}%`)
      : db.query("SELECT slug, title FROM works ORDER BY title").all()
  ) as Row[];
  return { works: rows.map((r) => ({ value: r.slug, label: r.title })) };
}

export function getProvenance() {
  const db = getDb();
  const sources = db.query("SELECT * FROM sources ORDER BY CASE status WHEN 'connected' THEN 0 WHEN 'sample' THEN 1 WHEN 'planned' THEN 2 ELSE 3 END, name").all() as Row[];
  const licenses = db.query("SELECT * FROM licenses ORDER BY name").all() as Row[];
  // The editions are the audit trail, but there are thousands of them and their
  // notes and attribution text run to megabytes: the whole list was 3.6 MB of a
  // 3.58 MB response. Counts are taken here and the rows are paged separately
  // (getProvenanceEditions), so the page paints at once and every edition is
  // still reachable.
  const editionCounts = db
    .query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN li.redistribution_allowed = 1 THEN 1 ELSE 0 END), 0) AS redistributable
         FROM editions e LEFT JOIN licenses li ON li.id = e.license_id`,
    )
    .get() as Row;
  const imports = db
    .query(
      `SELECT i.*, s.name AS source_name, s.slug AS source_slug FROM imports i LEFT JOIN sources s ON s.id = i.source_id ORDER BY i.id DESC LIMIT 60`,
    )
    .all() as Row[];
  // Errors first, then warnings. The informational notes are kept in the table
  // as the record of what was checked, but there are hundreds of thousands of
  // them and none belong on this page, so they are filtered before the sort.
  const issues = db
    .query(
      `SELECT ii.*, i.adapter, i.finished_at FROM import_issues ii JOIN imports i ON i.id = ii.import_id
       WHERE ii.severity IN ('error','warning')
       ORDER BY CASE ii.severity WHEN 'error' THEN 0 ELSE 1 END, ii.id DESC LIMIT 60`,
    )
    .all() as Row[];
  const unpublished = db
    .query(
      `SELECT w.slug, w.title, w.availability_note, t.name AS tradition_name FROM works w
       JOIN traditions t ON t.id = w.tradition_id
       WHERE NOT EXISTS (SELECT 1 FROM passages p WHERE p.work_id = w.id) ORDER BY t.sort_order, w.title`,
    )
    .all() as Row[];
  return {
    site: site(),
    sources: sources.map((s) => ({
      slug: s.slug, name: s.name, provider: s.provider, url: s.url, description: s.description,
      accessNotes: s.access_notes, retrievedAt: s.retrieved_at, isLive: !!s.is_live, status: s.status,
    })),
    licenses: licenses.map((l) => ({
      code: l.code, name: l.name, url: l.url, redistributionAllowed: !!l.redistribution_allowed,
      attributionRequired: !!l.attribution_required, shareAlike: !!l.share_alike, notes: l.notes,
    })),
    editionCount: editionCounts.total,
    redistributableCount: editionCounts.redistributable,
    imports: imports.map((i) => {
      let log: Row = {};
      try { log = JSON.parse(i.log_json || "{}") as Row; } catch { log = {}; }
      return {
        id: i.id, adapter: i.adapter, status: i.status, seen: i.records_seen,
        imported: i.records_imported, failed: i.records_failed, notes: i.notes, startedAt: i.started_at, finishedAt: i.finished_at,
        source: i.source_name ?? log.source ?? null,
        sourceSlug: i.source_slug ?? log.sourceSlug ?? null,
        manifest: log.manifestFile ?? null,
      };
    }),
    issues: issues.map((i) => ({ id: i.id, severity: i.severity, code: i.code, message: i.message, record: i.record_ref, adapter: i.adapter })),
    unpublished: unpublished.map((w) => ({ slug: w.slug, title: w.title, reason: w.availability_note, tradition: w.tradition_name })),
    adapters: adapterTable(),
    streaming: {
      works: streamedWorkCount(),
      note: "Streamed works keep a catalogue record, chapter outline and passage index here. Their text is requested from the hosting project when read and is never copied into this database.",
    },
  };
}

// One page of the edition ledger. The ordering ends in the edition id so a page
// boundary cannot repeat or skip a row when two editions share a work and type.
export function getProvenanceEditions(params: URLSearchParams) {
  const db = getDb();
  const pageSize = 100;
  const total = (db.query("SELECT COUNT(*) AS c FROM editions").get() as Row).c as number;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const requested = Number(params.get("page") ?? 1);
  const page = Math.min(pages, Math.max(1, Number.isFinite(requested) ? Math.floor(requested) : 1));
  const rows = db
    .query(
      `SELECT e.id, e.slug, e.title, e.edition_type, e.language_code, e.publication_year, e.rights_status,
              e.attribution_text, e.notes, e.is_sample,
              w.slug AS work_slug, w.title AS work_title, w.date_display, t.name AS tradition_name,
              so.slug AS source_slug, so.name AS source_name, so.status AS source_status,
              li.code AS license_code, li.name AS license_name, li.redistribution_allowed,
              (SELECT COUNT(*) FROM passage_texts pt WHERE pt.edition_id = e.id) AS text_count,
              ws.provider AS stream_provider, ws.upstream_id AS stream_upstream
       FROM editions e JOIN works w ON w.id = e.work_id JOIN traditions t ON t.id = w.tradition_id
       LEFT JOIN sources so ON so.id = e.source_id LEFT JOIN licenses li ON li.id = e.license_id
       LEFT JOIN work_streams ws ON ws.work_slug = w.slug
       ORDER BY t.sort_order, w.title, e.edition_type DESC, e.id
       LIMIT ? OFFSET ?`,
    )
    .all(pageSize, (page - 1) * pageSize) as Row[];
  return {
    total,
    page,
    pageSize,
    pages,
    editions: rows.map((e) => ({
      slug: e.slug, title: e.title, editionType: e.edition_type, language: e.language_code,
      publicationYear: e.publication_year, rightsStatus: e.rights_status, attribution: e.attribution_text,
      notes: e.notes, isSample: !!e.is_sample, work: { slug: e.work_slug, title: e.work_title, dateDisplay: e.date_display, tradition: e.tradition_name },
      source: { slug: e.source_slug, name: e.source_name, status: e.source_status },
      license: { code: e.license_code, name: e.license_name, redistributionAllowed: !!e.redistribution_allowed },
      textCount: e.text_count,
      streamed: e.stream_provider ? { provider: e.stream_provider, upstream: e.stream_upstream } : null,
    })),
  };
}

export function getCuratedCollections() {
  const db = getDb();
  return db
    .query("SELECT id, title, description, share_token, curator, kind FROM collections WHERE is_curated = 1 ORDER BY id")
    .all();
}
