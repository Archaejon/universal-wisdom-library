// Builds data/registry/streams.json, the map the reader uses to fetch a
// chapter from the project that hosts it instead of from a local copy.
//
// Every streamed work keeps only its catalogue record, its chapter outline and
// its passage index in the library. The text itself is requested from the
// upstream API at read time.
//
//   bun run scripts/dev/build-stream-manifest.ts
//   bun run scripts/dev/build-stream-manifest.ts --provider=sefaria
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");
const OUT = join(ROOT, "data", "registry", "streams.json");
const args = process.argv.slice(2);
const providerFilter = args.find((a) => a.startsWith("--provider="))?.split("=")[1];

type Edition = {
  slug: string;
  language: string;
  languageName: string;
  version: string;
  license: string;
  sourceUrl: string;
};

type StreamWork = {
  provider: string;
  upstream: string;
  mode: "numbered" | "complex";
  licence: string;
  editions: Edition[];
};

const LANGUAGE_NAMES: Record<string, string> = { he: "hebrew", en: "english", ar: "arabic", yi: "yiddish" };

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Sefaria's own `version` parameter takes the language's English name, not the
// ISO code, followed by the exact version title.
function upstreamTitle(slug: string, fallback: string): string | null {
  if (existsSync(join(ROOT, "data", "imports", "sefaria-library.json"))) {
    const library = readJson(join(ROOT, "data", "imports", "sefaria-library.json"));
    const hit = (library.works ?? []).find((w: any) => w.slug === slug);
    if (hit?.title) return hit.title;
  }
  if (existsSync(join(ROOT, "data", "imports", "sefaria-tanakh.json"))) {
    const tanakh = readJson(join(ROOT, "data", "imports", "sefaria-tanakh.json"));
    const hit = (tanakh.books ?? []).find((b: any) => b.slug === slug);
    if (hit?.title) return hit.title;
  }
  if (existsSync(join(ROOT, "data", "imports", "sefaria-mishnah.json"))) {
    const mishnah = readJson(join(ROOT, "data", "imports", "sefaria-mishnah.json"));
    const hit = (mishnah.tractates ?? []).find((t: any) => t.slug === slug);
    if (hit?.title) return hit.title;
  }
  // Some hand-maintained works name the upstream volume in the slug.
  return fallback || null;
}

// A work whose chapters are numbered ("Chapter 1", "Daf 2a", "1") is addressed
// as Title.chapter. A work whose chapters are named sections is addressed as
// Title,_Section. The guess is a hint only: the reader falls back to the other
// form when the response does not line up with the local passage index.
function modeFor(chapter: { ref: string; label: string }): "numbered" | "complex" {
  if (/^(chapter|daf|mishnah|siman|parasha|book|part|volume|letter)\b/i.test(chapter.label.trim())) return "numbered";
  if (/^\d+[ab]?$/.test(chapter.ref) && /^\d/.test(chapter.label.trim())) return "numbered";
  return "complex";
}

// Entries for other providers (SuttaCentral, and any future host) are written
// by their own importers and preserved when this Sefaria map is rebuilt.
const existing = existsSync(OUT) ? readJson(OUT) : { works: {} };
const kept: Record<string, StreamWork> = {};
for (const [slug, work] of Object.entries(existing.works ?? {})) {
  if ((work as StreamWork).provider !== "sefaria") kept[slug] = work as StreamWork;
}

const manifest: { version: number; generatedAt: string; note: string; works: Record<string, StreamWork> } = {
  version: 1,
  generatedAt: new Date().toISOString().slice(0, 10),
  note:
    "Works whose text is fetched from the project that hosts it at read time. The library stores the catalogue record, chapter outline and passage index only; it does not hold a copy of the text.",
  works: kept,
};

const skipped: string[] = [];
for (const file of readdirSync(WORKS).filter((f) => f.endsWith(".json"))) {
  const work = readJson(join(WORKS, file));
  const sefariaEditions: any[] = (work.editions ?? []).filter((e: any) => e.source === "sefaria");
  if (!sefariaEditions.length) continue;
  if (providerFilter && providerFilter !== "sefaria") continue;
  const chapters = work.chapters ?? [];
  if (!chapters.length) {
    skipped.push(`${work.slug}: no chapter outline`);
    continue;
  }
  const upstream = upstreamTitle(work.slug, work.translatorTitle ?? "");
  if (!upstream) {
    skipped.push(`${work.slug}: no upstream title`);
    continue;
  }
  const editions: Edition[] = [];
  for (const e of sefariaEditions) {
    const languageName = LANGUAGE_NAMES[e.language];
    if (!languageName || !e.title) {
      skipped.push(`${work.slug}: edition ${e.slug} has no addressable version`);
      continue;
    }
    editions.push({
      slug: e.slug,
      language: e.language,
      languageName,
      version: e.title,
      license: e.license ?? "",
      sourceUrl: e.sourceUrl ?? "",
    });
  }
  if (!editions.length) {
    skipped.push(`${work.slug}: no addressable edition`);
    continue;
  }
  manifest.works[work.slug] = {
    provider: "sefaria",
    upstream,
    mode: modeFor(chapters[0]),
    licence: String(work.licence ?? ""),
    editions,
  };
}

writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`);
const modes = Object.values(manifest.works).reduce<Record<string, number>>((acc, w) => {
  acc[w.mode] = (acc[w.mode] ?? 0) + 1;
  return acc;
}, {});
console.log(`Wrote ${Object.keys(manifest.works).length} streamed works to ${OUT}`);
console.log(`Modes: ${JSON.stringify(modes)}; skipped ${skipped.length}`);
for (const s of skipped.slice(0, 20)) console.log(`  - ${s}`);
