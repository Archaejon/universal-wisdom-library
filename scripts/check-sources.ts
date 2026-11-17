// Periodic, polite availability check for approved registry sources.
//
// Availability is not a licence verification: this script records whether the
// documented URL answers today. It never changes licence terms, approval status
// or ingestion status, and it does not crawl or copy text.
//
// Only sources that are *due* are checked — those whose newest recorded check is
// older than UWL_CHECK_INTERVAL_DAYS (30 by default), or that were never checked
// at all. Before, the first N approved sources were re-checked on every run and
// the rest were never reached.
//
// Run: bun run check:sources
//      bun run check:sources -- --dry-run
//      UWL_CHECK_LIMIT=5 bun run check:sources
//      UWL_CHECK_INTERVAL_DAYS=7 bun run check:sources
//
// serve.ts starts the same pass on a schedule; UWL_CHECK_SCHEDULE=off turns that
// schedule off without disabling this command.

import { getDb, migrate } from "../server/db";
import { checkIntervalDays, dueSources, runDueChecks } from "../server/verification";

const dryRun = process.argv.includes("--dry-run");
const limit = Math.max(1, Math.min(50, Number(process.env.UWL_CHECK_LIMIT ?? 10)));
const days = checkIntervalDays();

migrate();

if (dryRun) {
  const rows = dueSources(limit, days);
  if (rows.length === 0) console.log(`No approved source is due; the interval is ${days} days.`);
  else console.log(`Would check ${rows.length} due source(s); availability does not establish reuse rights.`);
  for (const row of rows) {
    console.log(`- ${row.sourceId} (priority ${row.priority}, last checked ${row.lastChecked ?? "never"}): ${row.url}`);
  }
  getDb().close();
  process.exit(0);
}

const sources = dueSources(limit, days);
if (sources.length === 0) {
  console.log(`No approved source is due for a check; the interval is ${days} days.`);
  getDb().close();
  process.exit(0);
}

console.log(`Checking ${sources.length} due approved source(s); availability does not establish reuse rights.`);
const run = await runDueChecks({ limit, days });
console.log(`Recorded ${run.ok} successful and ${run.failed} failed availability checks. last_verified_at was not changed.`);
getDb().close();
