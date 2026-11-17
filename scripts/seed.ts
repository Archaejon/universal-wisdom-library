import { getDb, isSeeded, migrate } from "../server/db";
import { DB_PATH } from "../server/db";
import { seedDatabase } from "../ingest/pipeline";

const reset = process.argv.includes("--reset");
migrate();

if (!reset && isSeeded()) {
  console.log(`Database already seeded at ${DB_PATH}. Use --reset to rebuild.`);
  process.exit(0);
}

const { imported, issues } = seedDatabase({ reset });
const errors = issues.filter((i) => i.severity === "error");
const warnings = issues.filter((i) => i.severity === "warning");
console.log(`Seeded ${DB_PATH}`);
console.log(
  `${imported.works} works, ${imported.editions} editions, ${imported.passages} passages, ${imported.texts} texts, ` +
    `${imported.commentaries} commentary entries, ${imported.themes} themes, ${imported.relationships} relationships, ` +
    `${imported.acquisitionTargets} acquisition targets.`,
);
if (warnings.length) console.log(`${warnings.length} validation warning(s); see /provenance in the app.`);
if (errors.length) {
  console.error(`${errors.length} validation error(s):`);
  for (const e of errors) console.error(` - ${e.message}`);
  process.exit(1);
}
getDb().close();
