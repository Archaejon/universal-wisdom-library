// Adds the single CJK characters to indexes built before they were indexed.
//
// `indexText` now writes each CJK character beside the run and its bigrams, so a
// one-character query (仁, 道) is an index lookup rather than a LIKE scan of
// every text in the corpus — 5.4s for one character. Indexes built before that
// change hold only the runs and bigrams, and rebuilding them means re-reading
// every host; this pass reads the stored search text instead and appends what is
// missing. It is safe to run again: characters already present are not repeated.
//
//   bun run backfill:cjk
//
// Only the streamed index (stream_fts) needs it now. The local index is
// contentless, so its text can't be read back, and `migrate()` rebuilds any
// local index made in an older layout with the current indexing, characters
// included. Run it once per database; `bun run index:streams` writes the
// characters itself.
import { getDb, migrate } from "../../server/db";
import { cjkChars } from "../../server/text";

type Table = "stream_fts";

const CJK_GLOB = "*[\u4e00-\u9fff]*";
const KANA_GLOB = "*[\u3040-\u30ff]*";
const HANGUL_GLOB = "*[\uac00-\ud7af]*";

function addCharacters(table: Table) {
  const db = getDb();
  const started = performance.now();
  const rows = db
    .query(
      `SELECT rowid AS id, text FROM ${table}
        WHERE text GLOB ? OR text GLOB ? OR text GLOB ?`,
    )
    .all(CJK_GLOB, KANA_GLOB, HANGUL_GLOB) as { id: number; text: string }[];

  let updated = 0;
  let charsAdded = 0;
  const update = db.query(`UPDATE ${table} SET text = ? WHERE rowid = ?`);
  const apply = db.transaction(() => {
    for (const row of rows) {
      const text = String(row.text ?? "");
      const present = new Set(text.split(/\s+/));
      const missing = cjkChars(text).filter((char) => !present.has(char));
      if (!missing.length) continue;
      update.run(`${text} ${missing.join(" ")}`, row.id);
      updated++;
      charsAdded += missing.length;
    }
  });
  apply();

  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`  ${table}: ${rows.length} row(s) hold CJK text, ${updated} updated with ${charsAdded} character(s) in ${seconds}s`);
  return updated;
}

migrate();
console.log("Backfilling CJK characters into the streamed search index…");
const streamed = addCharacters("stream_fts");
if (!streamed) console.log("  nothing to add: the index already holds its characters.");
else console.log(`Done: ${streamed} index row(s) updated.`);
