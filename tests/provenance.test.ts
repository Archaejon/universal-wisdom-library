import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describeManifest } from "../ingest/manifests";
import { ADAPTERS } from "../ingest/adapters";

const ROOT = join(import.meta.dir, "..");
const IMPORTS = join(ROOT, "data/imports");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));

// These files describe what a host offers, not what this library took, and must
// not be recorded as import runs: the balance would claim text that was only
// listed. Any other manifest is a pass and has to be readable.
const NOT_RUNS = /-(catalogue|authors|state)\.json$/;

describe("import manifests", () => {
  const files = readdirSync(IMPORTS).filter((f) => f.endsWith(".json")).sort();

  test("every pass is read, and catalogue dumps are not", () => {
    const unread: string[] = [];
    const recorded: string[] = [];
    for (const file of files) {
      const run = describeManifest(file, read(join(IMPORTS, file)));
      if (run) recorded.push(file);
      else if (!NOT_RUNS.test(file)) unread.push(file);
      if (NOT_RUNS.test(file)) expect(run).toBeNull();
    }
    expect(unread).toEqual([]);
    // Twenty-seven files were on disk while the page showed two runs; the floor
    // below is what keeps a new manifest shape from silently falling through.
    expect(recorded.length).toBeGreaterThanOrEqual(18);
    expect(recorded).toContain("sefaria-library.json");
    expect(recorded).toContain("ccel.json");
    expect(recorded).toContain("gretil.json");
    expect(recorded).toContain("openiti.json");
  });

  test("each run carries a source, an adapter and a positive count", () => {
    for (const file of files) {
      const run = describeManifest(file, read(join(IMPORTS, file)));
      if (!run) continue;
      expect(run.sourceSlug).toMatch(/^[a-z0-9-]+$/);
      expect(run.adapter.length).toBeGreaterThan(0);
      expect(run.records).toBeGreaterThan(0);
      expect(run.note).toContain(file);
      expect(run.log.manifestFile).toBe(file);
      expect(["succeeded", "partial"]).toContain(run.status);
    }
  });

  test("a compound source is filed under its first host", () => {
    const run = describeManifest("tao-te-ching.json", read(join(IMPORTS, "tao-te-ching.json")));
    expect(run?.source).toBe("project-gutenberg + wikisource");
    expect(run?.sourceSlug).toBe("project-gutenberg");
  });
});

describe("adapter registry", () => {
  const sources = new Set<string>(read(join(ROOT, "data/registry/sources.json")).sources.map((s: any) => s.source_id));
  const streams = read(join(ROOT, "data/registry/streams.json")).works as Record<string, { provider: string }>;

  test("names the source-registry row it files its runs under", () => {
    for (const adapter of ADAPTERS) {
      if (!adapter.source) continue;
      expect(sources.has(adapter.source)).toBe(true);
    }
  });

  test("covers every provider the streamed shelf actually uses", () => {
    const named = new Set(ADAPTERS.flatMap((a) => [a.id, ...a.providers]));
    const missing = [...new Set(Object.values(streams).map((w) => w.provider))].filter((p) => !named.has(p));
    expect(missing).toEqual([]);
  });

  test("keeps the planned sources out of the connected set", () => {
    const planned = ADAPTERS.filter((a) => a.status === "planned").map((a) => a.id);
    expect(planned).toContain("bdrc");
    expect(planned).toContain("quran-com");
    expect(ADAPTERS.find((a) => a.id === "gretil")?.status).toBe("connected");
    expect(ADAPTERS.find((a) => a.id === "sacred-texts")?.status).toBe("connected");
  });
});
