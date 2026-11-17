// Importers leave a manifest under data/imports for every pass: the works they
// read, the counts they recorded, and the host's licence where it states one.
// The files do not share a shape — each pass grew its own (`works`, `books`,
// `suttas`, or only `totals`, and the dates are spelled four different ways) —
// so the reader below accepts all of them. Asking every importer to be rewritten
// would leave the older passes unrecorded, which is how the provenance page came
// to show two runs out of twenty-seven files.
//
// Two kinds of file are deliberately not runs: the host's own catalogue dumps
// (`-catalogue.json`, `-authors.json`) describe what the source offers, and
// `-state.json` is crawl bookkeeping. Recording either as an import would claim
// text was taken when it was only listed.

export type ManifestRun = {
  file: string;
  /** The source key exactly as the manifest writes it, e.g. "project-gutenberg + wikisource". */
  source: string;
  /** The first host in `source`, normalised to a source-registry slug. */
  sourceSlug: string;
  adapter: string;
  finishedAt: string | null;
  records: number;
  unit: string;
  failed: number;
  status: "succeeded" | "partial";
  note: string;
  log: Record<string, unknown>;
};

const NOT_A_RUN = /-(catalogue|authors|state)\.json$/;

// Ordered from the most specific unit of work to the least, so a manifest that
// carries several totals reports the one that describes what it imported.
const UNITS = [
  "works",
  "books",
  "suttas",
  "texts",
  "editions",
  "tractates",
  "surahs",
  "chapters",
  "angs",
  "verses",
  "passages",
];

function slugifyHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function textField(manifest: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = manifest[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function describeManifest(file: string, manifest: unknown): ManifestRun | null {
  if (NOT_A_RUN.test(file)) return null;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return null;
  const record = manifest as Record<string, unknown>;

  const source = textField(record, ["sourceId", "source"]);
  if (!source) return null;
  const host = source.split("+")[0] ?? source;
  const sourceSlug = slugifyHost(host);
  if (!sourceSlug) return null;

  const totals = record.totals && typeof record.totals === "object" ? (record.totals as Record<string, unknown>) : {};
  let records = 0;
  let unit = "records";
  for (const key of UNITS) {
    const list = record[key];
    if (Array.isArray(list) && list.length) {
      records = list.length;
      unit = key;
      break;
    }
    const total = totals[key];
    if (typeof total === "number" && total > 0) {
      records = total;
      unit = key;
      break;
    }
  }
  if (!records) return null;

  const failures = record.failures;
  const failed = Array.isArray(failures) ? failures.length : 0;
  const licence = typeof record.licence === "string" ? record.licence : "";
  const permission = typeof record.permission === "string" ? record.permission : "";

  return {
    file,
    source,
    sourceSlug,
    adapter: typeof record.adapter === "string" && record.adapter ? record.adapter : `${sourceSlug}-importer`,
    finishedAt: textField(record, ["importedAt", "retrievedAt", "retrieved_at", "generatedAt", "generated_at", "fetched_at"]),
    records,
    unit,
    failed,
    status: failed ? "partial" : "succeeded",
    note: `Import manifest ${file} records ${records} ${records === 1 ? unit.replace(/s$/, "") : unit}${failed ? `, ${failed} failed` : ""}.`,
    log: {
      manifestFile: file,
      source,
      sourceSlug,
      totals,
      failed,
      licence,
      permission,
      adapterVersion: record.adapterVersion ?? null,
    },
  };
}
