// Reconciles the passage index of streamed works with their corpus records.
//
// A streamed work's passages live in two places: the catalogue JSON in
// data/corpus/works (the index the importer writes and the seed loads) and the
// `passages` table of a database seeded before that JSON changed. When an
// importer is re-run with --force, the JSON moves ahead of the database, and
// the reader then asks a provider for a chapter whose expected passage count no
// longer matches what the host serves.
//
// This script reports every streamed work whose database passages do not match
// its catalogue record, and with --apply deletes the rows the catalogue no
// longer lists (together with their rows in the stream search index). Re-run
// `bun run index:streams --only=<slug>` for each work it changed.
//
//   bun run scripts/dev/sync-stream-passages.ts
//   bun run scripts/dev/sync-stream-passages.ts --apply
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getDb, migrate } from "../../server/db";

const ROOT = join(import.meta.dir, "..", "..");
const STREAMS = join(ROOT, "data", "registry", "streams.json");
const WORKS = join(ROOT, "data", "corpus", "works");

type Row = Record<string, any>;

const apply = process.argv.includes("--apply");
const streams: Record<string, Row> = JSON.parse(readFileSync(STREAMS, "utf8")).works;

migrate();
const db = getDb();

let drifted = 0;
let removed = 0;
for (const slug of Object.keys(streams).sort()) {
  const work = db.query("SELECT id FROM works WHERE slug = ?").get(slug) as Row | null;
  if (!work) continue;
  const catalogue: { reference: string }[] = JSON.parse(readFileSync(join(WORKS, `${slug}.json`), "utf8")).passages;
  const known = new Set(catalogue.map((passage) => passage.reference));
  const stored = db
    .query("SELECT id, reference FROM passages WHERE work_id = ? ORDER BY sort_order")
    .all(work.id) as Row[];
  const extra = stored.filter((passage) => !known.has(String(passage.reference)));
  const absent = [...known].filter((reference) => !stored.some((passage) => String(passage.reference) === reference));
  if (!extra.length && !absent.length) continue;
  drifted++;
  console.log(
    `${slug}: catalogue lists ${catalogue.length} passages, the database has ${stored.length}` +
      `${extra.length ? `, ${extra.length} not in the catalogue (${extra.slice(0, 4).map((p) => String(p.reference)).join(", ")}${extra.length > 4 ? ", …" : ""})` : ""}` +
      `${absent.length ? `, ${absent.length} missing from the database (${absent.slice(0, 4).join(", ")}${absent.length > 4 ? ", …" : ""})` : ""}`,
  );
  if (!apply || !extra.length) continue;
  const del = db.transaction((ids: number[]) => {
    for (const id of ids) {
      db.query("DELETE FROM stream_fts WHERE passage_id = ?").run(id);
      db.query("DELETE FROM passages WHERE id = ?").run(id);
    }
  });
  del(extra.map((passage) => Number(passage.id)));
  removed += extra.length;
  console.log(`  removed ${extra.length} passage(s); re-index with: bun run index:streams --only=${slug}`);
}

console.log(
  apply
    ? `\n${drifted} work(s) had drifted; removed ${removed} passage(s).`
    : `\n${drifted} work(s) have drifted from their catalogue records. Run with --apply to remove the extra rows.`,
);
db.close();
