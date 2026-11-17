// Near-duplicate review across editions.
//
// The ingest pipeline's duplicate check is exact: it compares a text checksum
// with the checksums already imported. This script finds the pairs that pass
// that check and are still the same text — punctuation, spelling or OCR noise
// apart — by grouping editions that repeat substantive passages and comparing
// a sample of their shared references with a fuzzy similarity.
//
// Run: bun run duplicates
//      bun run duplicates -- --dry-run
//      bun run duplicates -- --threshold=0.85 --min-repeated=50
//
// A scan is a report. It never merges editions or deletes text.

import { closeDb, migrate } from "../server/db";
import { recordDuplicateScan, scanNearDuplicates } from "../server/duplicates";

const arg = (name: string): string | undefined => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const number = (name: string): number | undefined => {
  const raw = arg(name);
  if (raw == null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const dryRun = process.argv.includes("--dry-run");
const options = {
  threshold: number("threshold"),
  recordThreshold: number("record-threshold"),
  minRepeated: number("min-repeated"),
  sample: number("sample"),
  maxPairs: number("max-pairs"),
};

migrate();

console.log(
  `${dryRun ? "Scanning" : "Scanning and recording"} near-duplicate editions` +
    (options.threshold ? ` (near at ${options.threshold})` : "") +
    "…",
);

const result = scanNearDuplicates(options, (message) => console.log(`- ${message}`));

console.log("");
console.log(
  `${result.candidatePairs} candidate pair(s) compared, ${result.pairs.length} recorded` +
    ` in ${(result.durationMs / 1000).toFixed(1)}s.`,
);
console.log(
  `Near threshold ${result.threshold}; pairs are recorded at ${result.recordThreshold} similarity or above; ` +
    `each pair must repeat at least ${result.minRepeated} substantive passages.`,
);

if (result.pairs.length === 0) {
  console.log("No near-duplicate edition pairs were found.");
} else {
  console.log("");
  for (const pair of result.pairs) {
    console.log(
      `${(pair.similarity * 100).toFixed(1)}%  ${pair.left.workSlug} (${pair.left.editionSlug})` +
        `  ↔  ${pair.right.workSlug} (${pair.right.editionSlug})`,
    );
    console.log(
      `       ${pair.repeated} repeated passage(s); ${pair.sampled} sampled:` +
        ` ${pair.identical} identical, ${pair.equivalent} equivalent, ${pair.near} near, ${pair.different} different.`,
    );
    for (const example of pair.examples.slice(0, 3)) {
      console.log(`       ${example.reference} (${example.kind} ${example.similarity})`);
      console.log(`         - ${example.left.slice(0, 160)}`);
      console.log(`         + ${example.right.slice(0, 160)}`);
    }
  }
}

if (!dryRun) {
  const scanId = recordDuplicateScan(result);
  console.log("");
  console.log(`Stored as scan #${scanId}. The admin page lists it; nothing was merged or deleted.`);
}

closeDb();
