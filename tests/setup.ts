// Runs before every test file (bunfig.toml [test] preload).
//
// Tests get a throwaway database with the current schema, so they never write
// to the library in data/uwl.db and they work on a fresh checkout (or in CI),
// where that database doesn't exist.
import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "uwl-test-"));
process.env.UWL_DB_PATH = join(dir, "test.db");
process.env.UWL_CHECK_SCHEDULE = "off";

const { migrate, getDb } = await import("../server/db");
migrate();

// A hook registered in a preload file runs once, after every test file.
afterAll(() => {
  try {
    getDb().close();
  } catch {}
  rmSync(dir, { recursive: true, force: true });
});
