// Packs the library data the desktop app downloads on its first run.
//
// Output: one gzip of JSON lines. The first line is a header
// { format: "uwl-library", version, files }; each further line is
// { path, content } for one file under data/corpus or data/registry.
//
// Text held under a permission that forbids redistribution ("by-permission",
// such as the Gurbani-CD Guru Granth Sahib) is left out: the work, its outline
// and its passage index ship, but not the text.
//
//   bun run pack:library                       # dist/uwl-library-<version>.jsonl.gz
//   bun run pack:library --out=some/file.gz
import { createWriteStream, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { createGzip } from "node:zlib";
import pkg from "../package.json" with { type: "json" };

const ROOT = join(import.meta.dir, "..");
const VERSION = pkg.version;
const out =
  process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length) ||
  join(ROOT, "dist", `uwl-library-${VERSION}.jsonl.gz`);

const RESTRICTED = new Set(["by-permission"]);

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (name.endsWith(".json")) found.push(full);
  }
  return found;
}

const files = [...walk(join(ROOT, "data", "corpus")), ...walk(join(ROOT, "data", "registry"))];
if (!files.some((f) => f.includes(`${join("corpus", "works")}`))) {
  console.error("No corpus works found under data/corpus/works.");
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });
const gzip = createGzip({ level: 9 });
const sink = createWriteStream(out);
gzip.pipe(sink);
const write = (line: string) =>
  new Promise<void>((resolve) => {
    if (gzip.write(line + "\n")) resolve();
    else gzip.once("drain", resolve);
  });

await write(JSON.stringify({ format: "uwl-library", version: VERSION, files: files.length }));

let withheld = 0;
for (const file of files) {
  const rel = relative(ROOT, file).split("\\").join("/");
  let content = readFileSync(file, "utf8");
  if (rel.startsWith("data/corpus/works/")) {
    const work = JSON.parse(content);
    let changed = false;
    for (const edition of work.editions ?? []) {
      if (RESTRICTED.has(edition.license) && edition.texts && Object.keys(edition.texts).length) {
        edition.texts = {};
        edition.notes = [
          edition.notes,
          "The text of this edition is held under a permission that does not allow redistribution, so it is not included in the downloadable library.",
        ]
          .filter(Boolean)
          .join(" ");
        withheld++;
        changed = true;
      }
    }
    if (changed) content = JSON.stringify(work);
  }
  await write(JSON.stringify({ path: rel, content }));
}

gzip.end();
await new Promise<void>((resolve, reject) => {
  sink.on("finish", resolve);
  sink.on("error", reject);
});
console.log(`Packed ${files.length} files into ${relative(ROOT, out)} (${(statSync(out).size / 1e6).toFixed(1)} MB).`);
if (withheld) console.log(`Withheld the text of ${withheld} edition(s) whose permission forbids redistribution.`);
