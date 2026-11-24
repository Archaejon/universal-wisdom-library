// Builds the ready-made library database that the desktop app downloads.
//
//   bun run build:library            # writes dist/uwl-library-<version>.*
//
// Steps:
//  1. Stage a copy of data/corpus for distribution. A work whose only local
//     text is held under a permission that forbids redistribution
//     ("by-permission", such as the Gurbani-CD Guru Granth Sahib) is left out,
//     with its text-function entry and any collection items that point at it.
//  2. Seed a new database from that copy (bulk-load mode: no journal).
//  3. Compress it with zstd and split it into parts under GitHub's 2 GB limit
//     per release file.
//  4. Write a manifest the app reads: the parts with their sizes and SHA-256
//     hashes, and the size and hash of the database itself.
//
// Needs the zstd command, and free disk of about twice the database size.
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };

const ROOT = join(import.meta.dir, "..");
const VERSION = pkg.version;
const DIST = join(ROOT, "dist");
const STAGE = join(DIST, "library-corpus");
const DB = join(DIST, `uwl-library-${VERSION}.db`);
const ZST = `${DB}.zst`;
const PART_SIZE = 1_900_000_000;
const RESTRICTED = new Set(["by-permission"]);

/**
 * Splits `path` into numbered parts of at most PART_SIZE bytes in dist/, each
 * read as an explicit byte range, and checks they add up to the whole file.
 */
export async function splitFile(path: string, base: string) {
  const total = statSync(path).size;
  const parts: { name: string; size: number; sha256: string }[] = [];
  for (let i = 0, start = 0; start < total; i++, start += PART_SIZE) {
    const name = `${base}.${String(i + 1).padStart(3, "0")}`;
    const target = join(DIST, name);
    const end = Math.min(total, start + PART_SIZE) - 1; // inclusive
    const out = createWriteStream(target);
    for await (const chunk of createReadStream(path, { start, end, highWaterMark: 8 << 20 })) {
      if (!out.write(chunk)) await once(out, "drain");
    }
    out.end();
    await once(out, "finish");
    parts.push({ name, size: statSync(target).size, sha256: await sha256(target) });
  }
  const sum = parts.reduce((n, p) => n + p.size, 0);
  if (sum !== total) throw new Error(`split produced ${sum} bytes, expected ${total}`);
  return parts;
}

const log = (line: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`);

async function sha256(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of createReadStream(path, { highWaterMark: 8 << 20 })) hasher.update(chunk as Buffer);
  return hasher.digest("hex");
}

// The build runs only when this file is executed, so splitFile can be reused.
if (import.meta.main) {
  // 1. Stage the corpus.
  log("Staging the corpus…");
  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(join(STAGE, "works"), { recursive: true });
  const SOURCE = join(ROOT, "data", "corpus");
  const withheld: string[] = [];
  for (const name of readdirSync(join(SOURCE, "works")).sort()) {
    if (!name.endsWith(".json")) continue;
    const raw = readFileSync(join(SOURCE, "works", name), "utf8");
    const work = JSON.parse(raw);
    const withText = (work.editions ?? []).filter((e: any) => e.texts && Object.keys(e.texts).length);
    if (withText.length && withText.every((e: any) => RESTRICTED.has(e.license))) {
      withheld.push(work.slug);
      continue;
    }
    let changed = false;
    for (const edition of withText) {
      if (RESTRICTED.has(edition.license)) {
        edition.texts = {};
        changed = true;
      }
    }
    writeFileSync(join(STAGE, "works", name), changed ? JSON.stringify(work) : raw);
  }
  const isWithheld = (ref: string) => withheld.includes(String(ref).split(":")[0]);
  for (const name of readdirSync(SOURCE)) {
    if (!name.endsWith(".json")) continue;
    let data = JSON.parse(readFileSync(join(SOURCE, name), "utf8"));
    if (name === "text-functions.json") {
      for (const slug of withheld) delete data.works[slug];
    }
    if (name === "collections.json") {
      data = data.map((c: any) => ({ ...c, items: (c.items ?? []).filter((i: any) => !isWithheld(i.passage)) }));
    }
    writeFileSync(join(STAGE, name), JSON.stringify(data, null, 1));
  }
  log(`Staged ${readdirSync(join(STAGE, "works")).length} works; withheld ${withheld.length}: ${withheld.join(", ") || "none"}.`);

  // 2. Seed.
  rmSync(DB, { force: true });
  process.env.UWL_DB_PATH = DB;
  process.env.UWL_CORPUS_DIR = STAGE;
  process.env.UWL_BULK_LOAD = "1";
  process.env.UWL_CHECK_SCHEDULE = "off";
  log("Building the database (this takes a while)…");
  const { seedDatabase } = await import("../ingest/pipeline");
  const { getDb } = await import("../server/db");
  const { imported, issues } = seedDatabase();
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length) {
    for (const e of errors.slice(0, 20)) console.error(` - ${e.message}`);
    console.error(`Seeding reported ${errors.length} error(s).`);
    process.exit(1);
  }
  const db = getDb();
  db.run("PRAGMA optimize");
  db.run("PRAGMA journal_mode = DELETE");
  db.close();
  rmSync(STAGE, { recursive: true, force: true });
  const dbSize = statSync(DB).size;
  log(`Built ${imported.works} works, ${imported.texts} texts: ${(dbSize / 1e9).toFixed(2)} GB.`);
  const dbSha = await sha256(DB);

  // 3. Compress and split.
  log("Compressing…");
  const zstd = Bun.spawn(["zstd", "-T0", "-12", "-q", "-f", DB, "-o", ZST], { stdout: "inherit", stderr: "inherit" });
  if ((await zstd.exited) !== 0) throw new Error("zstd failed");
  rmSync(DB, { force: true });
  const zstSize = statSync(ZST).size;
  const parts = await splitFile(ZST, `uwl-library-${VERSION}.db.zst`);
  rmSync(ZST, { force: true });

  // 4. Manifest.
  const manifest = {
    format: "uwl-library-db",
    version: VERSION,
    compression: "zstd",
    database: { size: dbSize, sha256: dbSha },
    parts,
    works: imported.works,
    withheld,
    builtAt: new Date().toISOString(),
  };
  const manifestPath = join(DIST, `uwl-library-${VERSION}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  log(`Compressed to ${(zstSize / 1e9).toFixed(2)} GB in ${parts.length} part(s); manifest ${manifestPath.replace(ROOT + "/", "")}.`);
  if (!existsSync(manifestPath)) process.exit(1);
}
