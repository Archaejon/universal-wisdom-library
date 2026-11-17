// Adds the category shelf to pre-existing work records. New importers write
// category and subcategory directly; this keeps older records addressable by
// the same Tradition → Category → Work → Chapter browser.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");

let changed = 0;
for (const file of readdirSync(WORKS).filter((f) => f.endsWith(".json"))) {
  const path = join(WORKS, file);
  const work = JSON.parse(readFileSync(path, "utf8"));
  if (work.category) continue;

  const genre = work.genre ?? "";
  if (work.tradition === "judaism" && ["Torah", "Prophets", "Writings"].includes(genre)) {
    work.category = "Tanakh";
    work.subcategory = work.textType || genre;
  } else if (work.tradition === "judaism" && genre === "Mishnah") {
    work.category = "Mishnah";
    work.subcategory = work.textType?.replace(/^Mishnah · /, "") || "Mishnah";
  } else {
    work.category = genre || "Other";
    work.subcategory = work.textType || "";
  }
  writeFileSync(path, JSON.stringify(work, null, 2) + "\n");
  changed++;
}
console.log(`Added category metadata to ${changed} work records.`);
