import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { indexText } from "./text";
// Imported as text so the schema travels inside a compiled executable, where
// there is no source tree on disk to read it from.
import SCHEMA_SQL from "./schema.sql" with { type: "text" };

// The folder that holds data/ (corpus, registry, database). It is the checkout
// by default; the desktop app points it at a per-user folder with UWL_HOME.
export const ROOT = process.env.UWL_HOME || join(import.meta.dir, "..");
export const DB_PATH = process.env.UWL_DB_PATH || join(ROOT, "data", "uwl.db");

let db: Database | null = null;

export function getDb(): Database {
  if (db) return db;
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  db = new Database(DB_PATH, { create: true });
  if (process.env.UWL_BULK_LOAD === "1") {
    // A one-off build into a new file (scripts/build-library-db.ts): no journal,
    // no syncing. Much faster, and no write-ahead log the size of the database.
    // A crash leaves a broken file, which the build simply deletes and redoes.
    db.run("PRAGMA journal_mode = OFF");
    db.run("PRAGMA synchronous = OFF");
  } else {
    db.run("PRAGMA journal_mode = WAL");
  }
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000");
  return db;
}

export function migrate() {
  getDb().run(SCHEMA_SQL);
  // The category shelf was added after the first corpus build. CREATE TABLE IF
  // NOT EXISTS leaves an existing database unchanged, so add the columns here.
  const workColumns = new Set(
    (getDb().query("PRAGMA table_info(works)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!workColumns.has("category")) getDb().run("ALTER TABLE works ADD COLUMN category TEXT NOT NULL DEFAULT ''");
  if (!workColumns.has("subcategory")) getDb().run("ALTER TABLE works ADD COLUMN subcategory TEXT NOT NULL DEFAULT ''");
  getDb().run("CREATE INDEX IF NOT EXISTS idx_works_category ON works(category, subcategory, title)");
  ensureContentlessSearchIndexes();
}

// `CREATE VIRTUAL TABLE IF NOT EXISTS` leaves an index made in an older layout
// as it is. The local indexes are now contentless (see schema.sql), and before
// that passage_fts gained a `variants` column, so an index in any earlier
// layout is dropped, recreated from the schema and refilled from passage_texts.
// The freed space stays in the file until `bun run db:compact`.
const CONTENTLESS = "contentless_unindexed";

function tableSql(name: string): string {
  const row = getDb().query("SELECT sql FROM sqlite_master WHERE name = ?").get(name) as { sql: string } | null;
  return row?.sql ?? "";
}

function ensureContentlessSearchIndexes() {
  const stale = ["passage_fts", "passage_trigram"].filter((name) => !tableSql(name).includes(CONTENTLESS));
  if (!stale.length) return;
  const d = getDb();
  const total = (d.query("SELECT COUNT(*) AS n FROM passage_texts").get() as { n: number }).n;
  if (total) console.log(`Rebuilding the search index (${stale.join(", ")}) for ${total.toLocaleString()} passages; this runs once…`);
  for (const name of stale) d.run(`DROP TABLE IF EXISTS ${name}`);
  d.run(SCHEMA_SQL);
  if (!total) return;

  const fts = stale.includes("passage_fts")
    ? d.query(
        "INSERT INTO passage_fts (passage_id, edition_id, work_id, language, reference, text, variants) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
    : null;
  const trigram = stale.includes("passage_trigram")
    ? d.query("INSERT INTO passage_trigram (passage_id, edition_id, text) VALUES (?, ?, ?)")
    : null;
  const rows = d.query(
    `SELECT pt.passage_id, pt.edition_id, p.work_id, e.language_code, w.slug, p.reference, pt.content, pt.normalized_text
     FROM passage_texts pt
     JOIN passages p ON p.id = pt.passage_id
     JOIN editions e ON e.id = pt.edition_id
     JOIN works w ON w.id = p.work_id`,
  );
  let done = 0;
  d.transaction(() => {
    for (const row of rows.iterate() as IterableIterator<Record<string, any>>) {
      if (fts) {
        const indexed = indexText(String(row.content ?? ""), String(row.language_code ?? ""));
        fts.run(
          row.passage_id, row.edition_id, row.work_id, row.language_code, `${row.slug}:${row.reference}`,
          indexed.text, indexed.variants,
        );
      }
      if (trigram) trigram.run(row.passage_id, row.edition_id, String(row.normalized_text ?? ""));
      if (++done % 250_000 === 0) console.log(`  ${done.toLocaleString()} of ${total.toLocaleString()}`);
    }
  })();
  console.log("Search index rebuilt.");
}

export function resetDb() {
  const d = getDb();
  d.run("PRAGMA foreign_keys = OFF");
  const tables = d
    .query("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  for (const { name } of tables) {
    d.run(`DROP TABLE IF EXISTS "${name.replaceAll('"', '""')}"`);
  }
  d.run("PRAGMA foreign_keys = ON");
  migrate();
}

export function isSeeded(): boolean {
  try {
    const row = getDb().query("SELECT COUNT(*) AS n FROM works").get() as { n: number };
    return row.n > 0;
  } catch {
    return false;
  }
}

export function meta(key: string, fallback = ""): string {
  try {
    const row = getDb().query("SELECT value FROM app_meta WHERE key = ?").get(key) as
      | { value: string }
      | null;
    return row?.value ?? fallback;
  } catch {
    return fallback;
  }
}

export function closeDb() {
  db?.close();
  db = null;
}
