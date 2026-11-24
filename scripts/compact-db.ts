// Reclaims free space in the library database (VACUUM).
//
// Dropping or rebuilding a large table, such as the search-index rebuild in
// server/db.ts, leaves the freed pages inside data/uwl.db: the file stays the
// same size. This rewrites it at its real size. It needs free disk about the
// size of the database while it runs, and the server should be stopped.
//
//   bun run db:compact
import { statSync } from "node:fs";
import { DB_PATH, getDb } from "../server/db";

const before = statSync(DB_PATH).size;
const db = getDb();
const free = (db.query("PRAGMA freelist_count").get() as { freelist_count: number }).freelist_count;
const page = (db.query("PRAGMA page_size").get() as { page_size: number }).page_size;
console.log(`${DB_PATH}: ${(before / 1e9).toFixed(2)} GB, of which ${((free * page) / 1e9).toFixed(2)} GB is free space.`);
if (!free) {
  console.log("Nothing to reclaim.");
  process.exit(0);
}
console.log("Compacting… (this can take several minutes)");
db.run("PRAGMA wal_checkpoint(TRUNCATE)");
db.run("VACUUM");
db.run("PRAGMA wal_checkpoint(TRUNCATE)");
db.close();
console.log(`Done: ${(statSync(DB_PATH).size / 1e9).toFixed(2)} GB.`);
