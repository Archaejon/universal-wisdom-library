// Write the catalogue back out as data/corpus/works/<slug>.json.
//
// data/corpus/works is the seed input: `bun run db:rebuild` drops the database
// and reloads it from those files. When the files and the database drift apart
// (the directory was pruned, or an importer wrote only to the database) a
// rebuild silently produces a much smaller library. This script is the way
// back: it exports exactly what the database holds, in the shape the seeder
// reads and the tests assert on.
//
//   bun run export:corpus                        # rewrite data/corpus/works
//   UWL_CORPUS_WORKS_DIR=/tmp/works bun run export:corpus
//
// A streamed work keeps its chapter outline and passage index but no text; a
// locally held work carries an edition-by-edition `texts` map.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDb, ROOT } from "../../server/db";

type Row = Record<string, any>;

const WORKS_DIR = process.env.UWL_CORPUS_WORKS_DIR || join(ROOT, "data", "corpus", "works");
const db = getDb();

function parseJson(value: string | null, fallback: unknown) {
  try {
    const parsed = JSON.parse(value ?? "");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

const works = db
  .query(
    `SELECT w.*, t.slug AS tradition_slug, s.slug AS school_slug, a.slug AS author_slug
     FROM works w
     JOIN traditions t ON t.id = w.tradition_id
     LEFT JOIN schools s ON s.id = w.school_id
     LEFT JOIN authors a ON a.id = w.author_id
     ORDER BY w.slug`,
  )
  .all() as Row[];

const streamedSlugs = new Set(
  (db.query("SELECT work_slug FROM work_streams").all() as Row[]).map((row) => String(row.work_slug)),
);

const editionsFor = db.query(
  `SELECT e.*, l.code AS license_code, so.slug AS source_slug
   FROM editions e
   LEFT JOIN licenses l ON l.id = e.license_id
   LEFT JOIN sources so ON so.id = e.source_id
   WHERE e.work_id = ? ORDER BY e.id`,
);
const chaptersFor = db.query(
  `SELECT reference, label, title FROM text_units
   WHERE edition_id IN (SELECT id FROM editions WHERE work_id = ?)
   ORDER BY id`,
);
const passagesFor = db.query(
  `SELECT reference, label, chapter_ref, section_ref, ref_scheme FROM passages
   WHERE work_id = ? ORDER BY sort_order, id`,
);
const textsFor = db.query(
  `SELECT p.reference, pt.content FROM passage_texts pt
   JOIN passages p ON p.id = pt.passage_id
   WHERE pt.edition_id = ? ORDER BY pt.id`,
);

mkdirSync(WORKS_DIR, { recursive: true });

let workCount = 0;
let passageCount = 0;
let textCount = 0;
let byteCount = 0;

for (const w of works) {
  const isStreamed = streamedSlugs.has(w.slug);
  const passageRows = passagesFor.all(w.id) as Row[];

  // text_units are stored once per edition; the corpus keeps one outline per work.
  const chapterMap = new Map<string, Row>();
  for (const chapter of chaptersFor.all(w.id) as Row[]) {
    if (!chapterMap.has(chapter.reference)) chapterMap.set(chapter.reference, chapter);
  }
  const chapters = [...chapterMap.values()].map((chapter) => {
    const out: Row = { ref: chapter.reference, label: chapter.label };
    if (chapter.title) out.title = chapter.title;
    return out;
  });

  const editions = (editionsFor.all(w.id) as Row[]).map((e) => {
    const out: Row = {
      slug: e.slug,
      language: e.language_code,
      editionType: e.edition_type,
      title: e.title,
      translator: e.translator,
      publisher: e.publisher,
      publicationYear: e.publication_year,
      source: e.source_slug,
      license: e.license_code,
      rightsStatus: e.rights_status,
      attributionText: e.attribution_text,
      structureScheme: e.structure_scheme,
      isSample: e.is_sample === 0 ? false : true,
    };
    if (e.notes) out.notes = e.notes;
    if (!isStreamed) {
      const texts: Record<string, string> = {};
      for (const row of textsFor.all(e.id) as Row[]) texts[row.reference] = row.content;
      out.texts = texts;
      textCount += Object.keys(texts).length;
    }
    return out;
  });

  const record = {
    slug: w.slug,
    title: w.title,
    originalTitle: w.original_title,
    transliteration: w.transliteration,
    altTitles: parseJson(w.alt_titles_json, []),
    tradition: w.tradition_slug,
    school: w.school_slug ?? "",
    genre: w.genre,
    textType: w.text_type,
    category: w.category,
    subcategory: w.subcategory,
    originalLanguage: w.original_language,
    dateStart: w.date_start,
    dateEnd: w.date_end,
    dateDisplay: w.date_display,
    authorshipStatus: w.authorship_status,
    author: w.author_slug ?? "",
    attributionNote: w.attribution_note,
    description: w.description,
    historicalContext: w.historical_context,
    availabilityNote: w.availability_note,
    featured: w.featured === 1,
    featuredNote: w.featured_note,
    refScheme: passageRows[0]?.ref_scheme ?? "",
    isSample: w.is_sample === 0 ? false : true,
    textStorage: isStreamed ? "streamed" : "local",
    chapters,
    passages: passageRows.map((p) => {
      const out: Row = { reference: p.reference, label: p.label };
      if (p.chapter_ref) out.chapterRef = p.chapter_ref;
      if (p.section_ref) out.sectionRef = p.section_ref;
      return out;
    }),
    editions,
  };

  const body = `${JSON.stringify(record, null, 2)}\n`;
  writeFileSync(join(WORKS_DIR, `${w.slug}.json`), body, "utf8");
  workCount++;
  passageCount += passageRows.length;
  byteCount += body.length;
}

console.log(`Exported ${workCount} works, ${passageCount} passages, ${textCount} texts to ${WORKS_DIR}`);
console.log(`Wrote ${(byteCount / 1_048_576).toFixed(1)} MB of corpus JSON.`);
