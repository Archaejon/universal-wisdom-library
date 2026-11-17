// Earlier Sefaria imports prefixed a title that already contained its category,
// producing slugs such as midrash-midrash-tanchuma. This migration keeps URLs
// readable without re-fetching the texts.
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");
const MANIFEST = join(ROOT, "data", "imports", "sefaria-library.json");
const FUNCTIONS = join(ROOT, "data", "corpus", "text-functions.json");

const functions = JSON.parse(readFileSync(FUNCTIONS, "utf8"));
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
let changed = 0;
for (const entry of manifest.works) {
  const oldSlug = entry.slug;
  const newSlug = oldSlug.replace(/^(midrash|tosefta|yerushalmi|talmud)-\1-/, "$1-");
  if (newSlug === oldSlug) continue;
  const oldPath = join(WORKS, `${oldSlug}.json`);
  const newPath = join(WORKS, `${newSlug}.json`);
  if (!existsSync(oldPath) || existsSync(newPath)) continue;
  const work = JSON.parse(readFileSync(oldPath, "utf8"));
  work.slug = newSlug;
  work.editions = (work.editions ?? []).map((e: any) => ({ ...e, slug: String(e.slug).replace(oldSlug, newSlug) }));
  const serialized = JSON.stringify(work, null, 2) + "\n";
  writeFileSync(newPath, serialized);
  unlinkSync(oldPath);
  entry.slug = newSlug;
  entry.sha256 = new Bun.CryptoHasher("sha256").update(serialized).digest("hex");
  if (functions.works[oldSlug]) {
    functions.works[newSlug] = functions.works[oldSlug];
    delete functions.works[oldSlug];
  }
  changed++;
}
manifest.works.sort((a: any, b: any) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
writeFileSync(FUNCTIONS, JSON.stringify(functions, null, 2) + "\n");
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Renamed ${changed} generated work slugs.`);
