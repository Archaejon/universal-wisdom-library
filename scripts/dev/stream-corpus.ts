// Converts the Sefaria portion of the corpus from stored copies to streamed
// text. It rewrites the work JSONs without their `editions[].texts`, registers
// the works in `work_streams`, and removes the corresponding rows from
// SQLite (including the full-text indexes) so the text is not held locally.
//
//   bun run scripts/dev/stream-corpus.ts --dry-run
//   bun run scripts/dev/stream-corpus.ts
//   bun run scripts/dev/stream-corpus.ts --skip-vacuum
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDb, migrate, ROOT } from "../../server/db";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipVacuum = args.includes("--skip-vacuum");
// When the database is rebuilt from the stripped corpus, deleting rows first is
// wasted work. This flag rewrites the work files and stops there.
const jsonOnly = args.includes("--json-only");
const WORKS = join(ROOT, "data", "corpus", "works");
const manifestPath = join(ROOT, "data", "registry", "streams.json");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  version: number;
  generatedAt: string;
  works: Record<string, any>;
};
const slugs = Object.keys(manifest.works);
console.log(`${slugs.length} streamed works in the manifest`);

migrate();
const db = getDb();

// 1. Register the stream configuration so the reader can resolve upstream.
const upsert = db.query(
  `INSERT INTO work_streams (work_slug, provider, upstream_id, mode, config_json, generated_at)
   VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(work_slug) DO UPDATE SET
     provider = excluded.provider, upstream_id = excluded.upstream_id,
     mode = excluded.mode, config_json = excluded.config_json,
     generated_at = excluded.generated_at`,
);

// 2. Remove any locally stored text and search index entries.
let removedTexts = 0;
let removedFts = 0;
let removedTrigram = 0;
let written = 0;

const transaction = db.transaction(() => {
  for (const [index, slug] of slugs.entries()) {
    if (index > 0 && index % 100 === 0) {
      console.log(`  ${index}/${slugs.length} works…`);
    }
    const stream = manifest.works[slug];
    const row = db.query("SELECT id FROM works WHERE slug = ?").get(slug) as { id: number } | null;
    if (!row) {
      console.warn(`  ! ${slug} is not in the database; skipping`);
      continue;
    }
    upsert.run(
      slug,
      stream.provider,
      stream.upstream,
      stream.mode === "complex" ? "complex" : "numbered",
      JSON.stringify({ ...(stream.config ?? {}), licence: stream.licence ?? "", editions: stream.editions ?? [] }),
      manifest.generatedAt ?? null,
    );
    if (jsonOnly || dryRun) {
      if (dryRun && !jsonOnly) {
        removedTexts += (
          db.query("SELECT COUNT(*) AS n FROM passage_texts WHERE passage_id IN (SELECT id FROM passages WHERE work_id = ?)").get(row.id) as any
        ).n;
      }
    } else {
      // Scoping by work is much faster than deleting passage ids in batches;
      // these statements are the only place the local text rows are removed.
      removedFts += db.query("DELETE FROM passage_fts WHERE work_id = ?").run(row.id).changes;
      removedTrigram += db
        .query("DELETE FROM passage_trigram WHERE passage_id IN (SELECT id FROM passages WHERE work_id = ?)")
        .run(row.id).changes;
      removedTexts += db
        .query("DELETE FROM passage_texts WHERE passage_id IN (SELECT id FROM passages WHERE work_id = ?)")
        .run(row.id).changes;
    }

    // 3. Strip the text from the version-controlled corpus file, keeping the
    // chapter outline and passage index that the reader and links depend on.
    const file = join(WORKS, `${slug}.json`);
    let work: any;
    try {
      work = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    let changed = false;
    for (const edition of work.editions ?? []) {
      if (edition.texts && Object.keys(edition.texts).length) {
        delete edition.texts;
        changed = true;
      }
    }
    if (changed) {
      work.textStorage = "streamed";
      if (!dryRun) writeFileSync(file, `${JSON.stringify(work, null, 2)}\n`);
      written++;
    }
  }
});

transaction();

console.log(
  `${dryRun ? "Would register" : "Registered"} ${slugs.length} works; ` +
    `${dryRun ? "would remove" : "removed"} ${removedTexts} passage texts, ${removedFts} full-text rows, ${removedTrigram} trigram rows; ` +
    `${written} corpus files rewritten.`,
);

if (!dryRun && !skipVacuum) {
  console.log("Vacuuming the database to reclaim the released space (this can take several minutes)…");
  db.run("VACUUM");
  console.log("Vacuum complete.");
}
db.close();
