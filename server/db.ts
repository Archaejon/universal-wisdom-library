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
  db.run("PRAGMA journal_mode = WAL");
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
  ensurePassageFtsColumns();
}

// `CREATE VIRTUAL TABLE IF NOT EXISTS` cannot add a column to an older FTS
// table. The variants column was added for Arabic and Hebrew prefix forms, so
// rebuild the local index from passage_texts when an older database is opened.
function ensurePassageFtsColumns() {
  const cols = getDb().query("PRAGMA table_info(passage_fts)").all() as { name: string }[];
  if (cols.some((c) => c.name === "variants")) return;
  getDb().run("DROP TABLE IF EXISTS passage_fts");
  getDb().run(
    `CREATE VIRTUAL TABLE passage_fts USING fts5(
       passage_id UNINDEXED, edition_id UNINDEXED, work_id UNINDEXED,
       language UNINDEXED, reference UNINDEXED, text, variants,
       tokenize = 'unicode61 remove_diacritics 2')`,
  );
  const rows = getDb()
    .query(
      `SELECT pt.passage_id, pt.edition_id, p.work_id, e.language_code, p.reference, pt.content
       FROM passage_texts pt JOIN passages p ON p.id = pt.passage_id
       JOIN editions e ON e.id = pt.edition_id`,
    )
    .all() as Record<string, any>[];
  const insert = getDb().query(
    "INSERT INTO passage_fts (passage_id, edition_id, work_id, language, reference, text, variants) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const load = getDb().transaction(() => {
    for (const row of rows) {
      const indexed = indexText(String(row.content ?? ""), String(row.language_code ?? ""));
      insert.run(
        row.passage_id,
        row.edition_id,
        row.work_id,
        row.language_code,
        row.reference,
        indexed.text,
        indexed.variants,
      );
    }
  });
  load();
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
