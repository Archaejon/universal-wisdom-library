import { join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { getDb, ROOT, migrate, resetDb } from "../server/db";
import { describeManifest } from "./manifests";
import { indexText, normalizeForSearch } from "../server/text";

type Issue = {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  recordRef?: string;
};

// A half-written corpus file must stop a rebuild that names the file: the raw
// JSON.parse error says only "Unexpected end of JSON input".
const readJson = (path: string) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Corpus file ${path} could not be read: ${(err as Error).message}`);
  }
};
// The corpus directory is the seed input and the exporter's output. It can be
// pointed elsewhere so a rebuild or a test reads a corpus other than the one
// this checkout ships with: UWL_CORPUS_DIR for the whole corpus (as the
// desktop library build does), UWL_CORPUS_WORKS_DIR for just the work files.
const CORPUS = process.env.UWL_CORPUS_DIR || join(ROOT, "data", "corpus");
const WORKS_DIR = process.env.UWL_CORPUS_WORKS_DIR || join(CORPUS, "works");

// A rebuild replaces the database with whatever that directory holds. When it
// has been pruned, or an export was interrupted halfway, a rebuild would swap a
// full library for a smaller one and report success. Any shrink is therefore
// refused unless the operator asks for it by name.
//
// Recovery is `bun run export:corpus`, which writes the directory back out of
// the database.
export function existingWorkCount(): number {
  try {
    const row = getDb().query("SELECT COUNT(*) AS n FROM works").get() as { n: number } | null;
    return Number(row?.n ?? 0);
  } catch {
    return 0; // No works table yet: a fresh database has nothing to protect.
  }
}

export function assertCorpusSizeSafe(incoming: number): void {
  // An empty directory is never a library, whatever the database holds.
  if (incoming === 0) {
    throw new Error(
      "Refusing to rebuild: the corpus directory holds no work files, so the database would come out empty. " +
        "Run `bun run export:corpus` to write it back out of the database.",
    );
  }
  if (process.env.UWL_ALLOW_CORPUS_SHRINK === "1") return;
  const existing = existingWorkCount();
  if (incoming >= existing) return;
  throw new Error(
    `Refusing to rebuild: the corpus holds ${incoming} work(s) but the database already has ${existing}. ` +
      `That is what a pruned or half-written corpus looks like, and rebuilding would delete the ${existing - incoming} work(s) it no longer contains. ` +
      `Run \`bun run export:corpus\` to write the full corpus back out of the database, ` +
      `or set UWL_ALLOW_CORPUS_SHRINK=1 to accept the smaller corpus deliberately.`,
  );
}

// Short aliases are accepted in curated data, but the canonical key uses the work slug.
const WORK_ALIASES: Record<string, string> = {
  matthew: "gospel-of-matthew",
  john: "gospel-of-john",
  tao: "tao-te-ching",
  acaranga: "acaranga-sutra",
  gita: "bhagavad-gita",
  dhp: "dhammapada",
};
function canonicalPassageKey(raw: string): string {
  const [work, ...rest] = raw.split(":");
  return `${WORK_ALIASES[work] ?? work}:${rest.join(":")}`;
}

function checksum(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

function wordCount(text: string): number {
  if (/[\u3400-\u9fff]/.test(text)) return [...text.replace(/\s/g, "")].length;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function refMatchesScheme(ref: string, scheme: string): boolean {
  if (scheme === "Stephanus page") return /^\d+[a-e]?$/.test(ref);
  if (scheme === "daf.line") return /^\d+[ab]\.\d+$/.test(ref);
  return /^\d+(\.\d+)*(-\d+)?$/.test(ref);
}

export function loadRegistry() {
  const path = join(ROOT, "data", "registry", "sources.json");
  return JSON.parse(readFileSync(path, "utf8")) as { version: string; note: string; sources: any[] };
}

export function loadCorpus() {
  const meta = readJson(join(CORPUS, "meta.json"));
  const works = readdirSync(WORKS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => readJson(join(WORKS_DIR, f)));
  const themes = readJson(join(CORPUS, "themes.json"));
  const commentaries = readJson(join(CORPUS, "commentaries.json"));
  const relationships = readJson(join(CORPUS, "relationships.json"));
  const collections = readJson(join(CORPUS, "collections.json"));
  // Works whose text is streamed from the hosting project keep only their
  // catalogue record, chapter outline and passage index in the corpus.
  const streamsPath = join(ROOT, "data", "registry", "streams.json");
  const streams = existsSync(streamsPath)
    ? readJson(streamsPath)
    : { version: 1, works: {} };
  const textFunctions = readJson(join(CORPUS, "text-functions.json"));
  const acquisitionPath = join(ROOT, "data", "registry", "acquisition.json");
  const acquisition = existsSync(acquisitionPath)
    ? readJson(acquisitionPath)
    : { version: 1, targets: [] };
  return { meta, works, themes, commentaries, relationships, collections, textFunctions, streams, acquisition };
}

export function seedDatabase(opts: { reset?: boolean } = {}) {
  // Read and vet the corpus first: nothing is dropped until the incoming work
  // count has been checked against the database it would replace.
  const corpus = loadCorpus();
  assertCorpusSizeSafe(corpus.works.length);

  if (opts.reset) resetDb();
  else migrate();

  const db = getDb();
  const issues: Issue[] = [];
  const imported = { languages: 0, traditions: 0, works: 0, editions: 0, passages: 0, texts: 0, commentaries: 0, themes: 0, relationships: 0, collections: 0, registrySources: 0, manifestImports: 0, textFunctions: 0, streamWorks: 0, acquisitionTargets: 0 };
  const streamedSlugs = new Set(Object.keys(corpus.streams?.works ?? {}));
  const validTextFunctions = new Set([
    "canonical_scripture", "non_canonical_religious_text", "foundational_revelation", "prayer_liturgy",
    "commentary_exegesis", "religious_law_practice", "historical_document", "sermon_speech",
    "philosophical_work", "mystical_contemplative", "ethical_humanist_manifesto", "community_statement",
    "creed_confession", "denominational_guidance", "academic_scholarship", "contemporary_spiritual_writing",
    "oral_history_transcription", "community_authorised_knowledge",
  ]);
  const classifications = new Map<string, any>(Object.entries(corpus.textFunctions.works ?? {}));
  let seen = 0;

  const insertMany = db.transaction(() => {
    const now = new Date().toISOString();
    const metaSet = db.query("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)");
    metaSet.run("site_name", corpus.meta.site.name);
    metaSet.run("site_tagline", corpus.meta.site.tagline);
    metaSet.run("site_description", corpus.meta.site.description);
    metaSet.run("corpus_version", corpus.meta.site.corpusVersion);
    metaSet.run("corpus_label", corpus.meta.site.corpusLabel);
    metaSet.run("corpus_notice", corpus.meta.site.corpusNotice);
    metaSet.run("seeded_at", now);

    for (const l of corpus.meta.languages) {
      db.query("INSERT INTO languages (code, name, native_name, direction) VALUES (?, ?, ?, ?)").run(
        l.code, l.name, l.native_name, l.direction,
      );
      imported.languages++;
    }

    const traditionIds = new Map<string, number>();
    for (const t of corpus.meta.traditions) {
      const res = db
        .query(
          "INSERT INTO traditions (slug, name, short_name, description, permissions_note, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(t.slug, t.name, t.short_name, t.description, t.permissions_note ?? "", t.sort_order ?? 0);
      traditionIds.set(t.slug, Number(res.lastInsertRowid));
      imported.traditions++;
    }

    const schoolIds = new Map<string, number>();
    for (const s of corpus.meta.schools) {
      const traditionId = traditionIds.get(s.tradition);
      if (!traditionId) {
        issues.push({ severity: "error", code: "unknown_tradition", message: `School ${s.slug} refers to unknown tradition ${s.tradition}`, recordRef: s.slug });
        continue;
      }
      const res = db
        .query("INSERT INTO schools (slug, tradition_id, name, description) VALUES (?, ?, ?, ?)")
        .run(s.slug, traditionId, s.name, s.description ?? "");
      schoolIds.set(s.slug, Number(res.lastInsertRowid));
    }

    const authorIds = new Map<string, number>();
    for (const a of corpus.meta.authors) {
      const res = db
        .query(
          "INSERT INTO authors (slug, name, sort_name, birth_year, death_year, date_display, description, is_attributed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          a.slug, a.name, a.sort_name ?? "", a.birth_year ?? null, a.death_year ?? null,
          a.date_display ?? "", a.description ?? "", a.is_attributed ? 1 : 0,
        );
      authorIds.set(a.slug, Number(res.lastInsertRowid));
    }

    const registry = loadRegistry();
    const registryIds = new Set(registry.sources.map((s) => s.source_id));
    const importableSources = new Set(
      registry.sources
        .filter((s) => s.approval_status === "approved" && !["restricted", "unavailable"].includes(s.ingestion_status))
        .map((s) => s.source_id),
    );
    const importableLicenses = new Set(
      corpus.meta.licenses.filter((l: any) => l.redistribution_allowed === true || l.redistribution_allowed === 1).map((l: any) => l.code),
    );
    const validRegistryStatuses = ["discovered", "under_review", "licence_verified", "ready_for_integration", "connected", "import_tested", "active", "restricted", "unavailable"];
    for (const s of registry.sources) {
      if (!s.source_id || !s.source_name) {
        issues.push({ severity: "error", code: "registry_invalid", message: "A source-registry entry is missing source_id or source_name.", recordRef: s.source_id ?? "" });
        continue;
      }
      if (!validRegistryStatuses.includes(s.ingestion_status)) {
        issues.push({ severity: "error", code: "registry_status", message: `Registry source ${s.source_id} has invalid ingestion_status ${s.ingestion_status}.`, recordRef: s.source_id });
        continue;
      }
      db.query(
        `INSERT INTO source_registry (source_id, source_name, base_url, organisation, traditions_covered_json, schools_covered_json,
           languages_json, source_type, content_types_json, api_documentation_url, download_url, access_method, licence_url,
           licence_status, commercial_use_allowed, redistribution_allowed, attribution_requirements, authentication_required,
           rate_limits, ingestion_status, last_verified_at, source_reliability_notes, editorial_notes, priority, approval_status,
           review_note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        s.source_id, s.source_name, s.base_url ?? "", s.organisation ?? "", JSON.stringify(s.traditions_covered ?? []),
        JSON.stringify(s.schools_covered ?? []), JSON.stringify(s.languages ?? []), s.source_type ?? "",
        JSON.stringify(s.content_types ?? []), s.api_documentation_url ?? "", s.download_url ?? "", s.access_method ?? "",
        s.licence_url ?? "", s.licence_status ?? "not_verified",
        s.commercial_use_allowed == null ? null : s.commercial_use_allowed ? 1 : 0,
        s.redistribution_allowed == null ? null : s.redistribution_allowed ? 1 : 0,
        s.attribution_requirements ?? "", s.authentication_required == null ? null : s.authentication_required ? 1 : 0,
        s.rate_limits ?? "", s.ingestion_status, s.last_verified_at ?? null,
        s.source_reliability_notes ?? "", s.editorial_notes ?? "", s.priority ?? 3, s.approval_status ?? "pending",
        s.review_note ?? "",
      );
      imported.registrySources++;
      const checkStatus = ["active", "import_tested", "connected"].includes(s.ingestion_status)
        ? "ok"
        : s.ingestion_status === "unavailable" || s.ingestion_status === "restricted"
          ? "blocked"
          : "unverified";
      db.query(
        "INSERT INTO source_checks (source_id, checked_at, method, status, notes) VALUES (?, ?, 'manual', ?, ?)",
      ).run(
        s.source_id,
        s.last_verified_at ?? now,
        checkStatus,
        s.last_verified_at
          ? `Registry review recorded ${s.last_verified_at}. See licence and editorial notes.`
          : "Not independently verified. Treated as unverified until reviewed.",
      );
    }
    if (registryIds.size !== imported.registrySources) {
      issues.push({ severity: "warning", code: "registry_duplicates", message: "Some source-registry IDs were duplicated or invalid; not all entries were loaded." });
    }

    for (const target of corpus.acquisition?.targets ?? []) {
      if (!target.slug || !target.title) {
        issues.push({ severity: "error", code: "acquisition_invalid", message: "An acquisition target is missing its slug or title.", recordRef: target.slug ?? "" });
        continue;
      }
      if (!["wanted", "located", "rights_blocked", "imported"].includes(target.status ?? "wanted")) {
        issues.push({ severity: "error", code: "acquisition_status", message: `Acquisition target ${target.slug} has invalid status ${target.status}.`, recordRef: target.slug });
        continue;
      }
      db.query(
        `INSERT OR REPLACE INTO acquisition_targets
           (slug, title, original_title, transliteration, author, tradition, school, genre, category, status,
            priority, languages_json, source_leads_json, rights_note, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        target.slug, target.title, target.original_title ?? "", target.transliteration ?? "", target.author ?? "",
        target.tradition ?? "islam", target.school ?? "", target.genre ?? "", target.category ?? "",
        target.status ?? "wanted", target.priority ?? 3, JSON.stringify(target.languages ?? []),
        JSON.stringify(target.source_leads ?? []), target.rights_note ?? "", target.note ?? "",
      );
      imported.acquisitionTargets++;
    }

    const sourceIds = new Map<string, number>();
    for (const s of corpus.meta.sources) {
      const res = db
        .query(
          "INSERT INTO sources (slug, name, provider, url, description, access_notes, retrieved_at, is_live, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          s.slug, s.name, s.provider, s.url ?? "", s.description ?? "", s.access_notes ?? "",
          s.retrieved_at ?? null, s.is_live ? 1 : 0, s.status ?? "planned",
        );
      sourceIds.set(s.slug, Number(res.lastInsertRowid));
    }

    const licenseIds = new Map<string, number>();
    for (const l of corpus.meta.licenses) {
      const res = db
        .query(
          "INSERT INTO licenses (code, name, url, redistribution_allowed, attribution_required, share_alike, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          l.code, l.name, l.url ?? "", l.redistribution_allowed ? 1 : 0,
          l.attribution_required ? 1 : 0, l.share_alike ? 1 : 0, l.notes ?? "",
        );
      licenseIds.set(l.code, Number(res.lastInsertRowid));
    }

    const workIds = new Map<string, number>();
    const passageIds = new Map<string, number>();
    const editionIds = new Map<string, number>();
    const textChecksums = new Map<string, string>();

    for (const w of corpus.works) {
      seen++;
      const traditionId = traditionIds.get(w.tradition);
      if (!traditionId) {
        issues.push({ severity: "error", code: "unknown_tradition", message: `Work ${w.slug} refers to unknown tradition ${w.tradition}`, recordRef: w.slug });
        continue;
      }
      if (w.school && !schoolIds.has(w.school)) {
        issues.push({ severity: "error", code: "unknown_school", message: `Work ${w.slug} refers to unknown school ${w.school}`, recordRef: w.slug });
      }
      if (w.author && !authorIds.has(w.author)) {
        issues.push({ severity: "error", code: "unknown_author", message: `Work ${w.slug} refers to unknown author ${w.author}`, recordRef: w.slug });
      }
      if (!corpus.meta.languages.some((l: any) => l.code === w.originalLanguage)) {
        issues.push({ severity: "error", code: "unknown_language", message: `Work ${w.slug} refers to unknown language ${w.originalLanguage}`, recordRef: w.slug });
      }

      const res = db
        .query(
          `INSERT INTO works (slug, tradition_id, school_id, title, original_title, transliteration, alt_titles_json,
             genre, text_type, category, subcategory, original_language, date_start, date_end, date_display, authorship_status, author_id,
             attribution_note, description, historical_context, availability_note, is_sample, featured, featured_note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          w.slug, traditionId, w.school ? schoolIds.get(w.school) ?? null : null, w.title,
          w.originalTitle ?? "", w.transliteration ?? "", JSON.stringify(w.altTitles ?? []),
          w.genre ?? "", w.textType ?? "", w.category ?? w.genre ?? "", w.subcategory ?? "", w.originalLanguage, w.dateStart ?? null, w.dateEnd ?? null,
          w.dateDisplay ?? "", w.authorshipStatus ?? "traditional",
          w.author ? authorIds.get(w.author) ?? null : null,
          w.attributionNote ?? "", w.description ?? "", w.historicalContext ?? "",
          w.availabilityNote ?? "", w.isSample === false ? 0 : 1, w.featured ? 1 : 0, w.featuredNote ?? "",
        );
      const workId = Number(res.lastInsertRowid);
      workIds.set(w.slug, workId);
      imported.works++;

      const stream = corpus.streams?.works?.[w.slug];
      if (stream) {
        db.query(
          "INSERT INTO work_streams (work_slug, provider, upstream_id, mode, config_json, generated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(
          w.slug,
          stream.provider,
          stream.upstream,
          stream.mode === "complex" ? "complex" : "numbered",
          JSON.stringify({ ...(stream.config ?? {}), licence: stream.licence ?? "", editions: stream.editions ?? [] }),
          corpus.streams.generatedAt ?? null,
        );
        imported.streamWorks++;
      }

      const classification = classifications.get(w.slug);
      if (!classification || !Array.isArray(classification.functions) || classification.functions.length === 0) {
        issues.push({
          severity: "error",
          code: "missing_text_function",
          message: `Work ${w.slug} has no textual-function classification.`,
          recordRef: w.slug,
        });
      } else {
        const seenFunctions = new Set<string>();
        for (const [fnIndex, fn] of classification.functions.entries()) {
          if (!validTextFunctions.has(fn)) {
            issues.push({ severity: "error", code: "invalid_text_function", message: `Work ${w.slug} uses unknown textual function ${fn}.`, recordRef: w.slug });
            continue;
          }
          if (seenFunctions.has(fn)) {
            issues.push({ severity: "warning", code: "duplicate_text_function", message: `Work ${w.slug} repeats textual function ${fn}.`, recordRef: w.slug });
            continue;
          }
          seenFunctions.add(fn);
          db.query(
            "INSERT INTO work_text_functions (work_id, function, assigned_by, status, note, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
          ).run(
            workId,
            fn,
            classification.assignedBy ?? "UWL editors (comparative taxonomy)",
            classification.status ?? "provisional",
            classification.note ?? "",
            fnIndex,
          );
          imported.textFunctions++;
        }
        classifications.delete(w.slug);
      }

      const chapterIds = new Map<string, number>();
      const editions = w.editions ?? [];
      if (editions.length === 0) {
        issues.push({
          severity: "warning",
          code: "no_edition",
          message: w.availabilityNote
            ? `Work ${w.slug} is catalogue-only: ${w.availabilityNote}`
            : `Work ${w.slug} has no imported edition.`,
          recordRef: w.slug,
        });
      }

      // A streamed work has no local text, but its passage index is what makes
      // references, bookmarks, themes and links stable. Record it here.
      if (streamedSlugs.has(w.slug)) {
        for (const [index, p] of (w.passages ?? []).entries()) {
          const key = `${w.slug}:${p.reference}`;
          if (passageIds.has(key)) continue;
          const pres = db
            .query(
              "INSERT INTO passages (work_id, reference, label, chapter_ref, section_ref, sort_order, ref_scheme) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .run(workId, p.reference, p.label, p.chapterRef ?? null, p.sectionRef ?? null, index, w.refScheme ?? "");
          passageIds.set(key, Number(pres.lastInsertRowid));
          imported.passages++;
        }
      }

      for (const e of editions) {
        const sourceId = sourceIds.get(e.source) ?? null;
        const licenseId = licenseIds.get(e.license) ?? null;
        if (!sourceId) issues.push({ severity: "error", code: "unknown_source", message: `Edition ${e.slug} refers to unknown source ${e.source}`, recordRef: e.slug });
        if (!licenseId) issues.push({ severity: "error", code: "unknown_license", message: `Edition ${e.slug} refers to unknown licence ${e.license}`, recordRef: e.slug });
        if (!importableSources.has(e.source)) {
          issues.push({
            severity: "error",
            code: "source_not_approved",
            message: `Edition ${e.slug} uses ${e.source}, which is not approved for import or is restricted/unavailable.`,
            recordRef: e.slug,
          });
        }
        if (!importableLicenses.has(e.license)) {
          // This build is a reading interface over imported copies. Every text
          // still records its exact edition, source and licence, but a licence
          // that withholds redistribution does not block display.
          issues.push({
            severity: "info",
            code: "display_only_licence",
            message: `Edition ${e.slug} uses licence ${e.license}; text is displayed with its source and rights notice, not relicensed.`,
            recordRef: e.slug,
          });
        }
        const eres = db
          .query(
            `INSERT INTO editions (slug, work_id, language_code, edition_type, title, translator, translator_author_id,
               publisher, publication_year, source_id, license_id, rights_status, attribution_text, structure_scheme,
               is_available, is_sample, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .run(
            e.slug, workId, e.language, e.editionType, e.title, e.translator ?? "", null,
            e.publisher ?? "", e.publicationYear ?? null, sourceId, licenseId, e.rightsStatus ?? "",
            e.attributionText ?? "", e.structureScheme ?? "", e.isSample === false ? 0 : 1, e.notes ?? "",
          );
        const editionId = Number(eres.lastInsertRowid);
        editionIds.set(e.slug, editionId);
        imported.editions++;

        for (const [i, ch] of (w.chapters ?? []).entries()) {
          const ures = db
            .query(
              "INSERT INTO text_units (edition_id, parent_id, depth, sequence, label, reference, unit_type, title) VALUES (?, NULL, 0, ?, ?, ?, 'chapter', ?)",
            )
            .run(editionId, i, ch.label, ch.ref, ch.title ?? "");
          chapterIds.set(ch.ref, Number(ures.lastInsertRowid));
        }

        const seenChecksums = new Map<string, string>();
        for (const p of w.passages ?? []) {
          const text = e.texts?.[p.reference];
          // Bilingual works do not always segment every line identically. A
          // passage only needs text in at least one edition; the later orphan
          // check catches a passage with no text at all.
          if (typeof text !== "string" || text.trim().length === 0) continue;
          const passageKey = `${w.slug}:${p.reference}`;
          let passageId = passageIds.get(passageKey);
          if (!passageId) {
            const pres = db
              .query(
                "INSERT INTO passages (work_id, reference, label, chapter_ref, section_ref, sort_order, ref_scheme) VALUES (?, ?, ?, ?, ?, ?, ?)",
              )
              .run(
                workId, p.reference, p.label, p.chapterRef ?? null, p.sectionRef ?? null,
                (w.passages as any[]).indexOf(p), w.refScheme ?? "",
              );
            passageId = Number(pres.lastInsertRowid);
            passageIds.set(passageKey, passageId);
            imported.passages++;
          }
          const sum = checksum(text);
          const location = `${e.slug}:${p.reference}`;
          const earlier = textChecksums.get(sum);
          if (earlier && earlier !== location) {
            issues.push({
              severity: "info",
              code: "duplicate_text_across_editions",
              message: `Identical text appears at ${earlier} and ${location}. In a full canon this is often a repeated formula or parallel passage; record it for review rather than treating it as an error.`,
              recordRef: location,
            });
          } else {
            textChecksums.set(sum, location);
          }
          if (seenChecksums.has(sum)) {
            issues.push({
              severity: "info",
              code: "duplicate_text",
              message: `Edition ${e.slug} repeats identical text at ${seenChecksums.get(sum)} and ${p.reference}. Repeated liturgical formulae are expected in complete books.`,
              recordRef: `${e.slug}:${p.reference}`,
            });
          } else {
            seenChecksums.set(sum, p.reference);
          }
          const normalized = normalizeForSearch(text);
          db.query(
            `INSERT INTO passage_texts (passage_id, edition_id, text_unit_id, content, normalized_text, checksum, word_count)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            passageId, editionId, chapterIds.get(p.chapterRef ?? "") ?? null, text, normalized, sum, wordCount(text),
          );
          const indexed = indexText(text, e.language);
          db.query(
            "INSERT INTO passage_fts (passage_id, edition_id, work_id, language, reference, text, variants) VALUES (?, ?, ?, ?, ?, ?, ?)",
          ).run(passageId, editionId, workId, e.language, `${w.slug}:${p.reference}`, indexed.text, indexed.variants);
          db.query("INSERT INTO passage_trigram (passage_id, edition_id, text) VALUES (?, ?, ?)").run(
            passageId, editionId, normalized,
          );
          imported.texts++;
        }
      }

      for (const p of w.passages ?? []) {
        if (!refMatchesScheme(p.reference, w.refScheme ?? "")) {
          issues.push({
            severity: "warning",
            code: "reference_scheme",
            message: `Reference "${p.reference}" does not match declared scheme "${w.refScheme}".`,
            recordRef: `${w.slug}:${p.reference}`,
          });
        }
        // A streamed work has no local text by design; its passage index is
        // still required so references, bookmarks and links stay stable.
        if (!passageIds.has(`${w.slug}:${p.reference}`) && !streamedSlugs.has(w.slug)) {
          issues.push({ severity: "error", code: "orphan_passage", message: `Passage ${w.slug}:${p.reference} has no text in any edition.`, recordRef: `${w.slug}:${p.reference}` });
        }
      }

      if (w.passages?.length && editions.length && !editions.some((e: any) => e.language === w.originalLanguage)) {
        issues.push({
          severity: "info",
          code: "no_original_edition",
          message: `Work ${w.slug} has translations but no imported ${w.originalLanguage} original.`,
          recordRef: w.slug,
        });
      }
    }

    for (const slug of classifications.keys()) {
      issues.push({
        severity: "error",
        code: "orphan_text_function",
        message: `Textual-function classification refers to unknown work ${slug}.`,
        recordRef: slug,
      });
    }

    const editorialSourceId = sourceIds.get("uwl-editorial") ?? null;
    const editorialLicenseId = licenseIds.get("cc-by-4.0") ?? null;
    for (const t of corpus.themes) {
      const tres = db
        .query("INSERT INTO themes (slug, name, description, question, sort_order) VALUES (?, ?, ?, ?, ?)")
        .run(t.slug, t.name, t.description ?? "", t.question ?? "", t.sortOrder ?? 0);
      const themeId = Number(tres.lastInsertRowid);
      imported.themes++;
      for (const link of t.passages ?? []) {
        const passageId = passageIds.get(canonicalPassageKey(link.passage));
        if (!passageId) {
          issues.push({ severity: "error", code: "unknown_passage", message: `Theme ${t.slug} links to unknown passage ${link.passage}`, recordRef: t.slug });
          continue;
        }
        db.query(
          "INSERT INTO passage_themes (passage_id, theme_id, note, relevance, curator) VALUES (?, ?, ?, ?, ?)",
        ).run(passageId, themeId, link.note ?? "", link.relevance ?? "curated", "UWL editors");
      }
    }

    for (const c of corpus.commentaries) {
      const passageId = passageIds.get(canonicalPassageKey(`${c.work}:${c.passage}`));
      if (!passageId) {
        issues.push({ severity: "error", code: "unknown_passage", message: `Commentary targets unknown passage ${c.work}:${c.passage}`, recordRef: `${c.work}:${c.passage}` });
        continue;
      }
      db.query(
        `INSERT INTO commentaries (passage_id, work_id, content_type, author_id, author_display, source_id, content,
           is_quotation, language_code, interpretive_tradition, date_display, license_id, source_url, provenance_note,
           is_sample, review_status)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'en', ?, ?, ?, '', ?, 1, 'published')`,
      ).run(
        passageId, workIds.get(c.work)!, c.contentType, c.authorDisplay ?? "UWL editors", editorialSourceId,
        c.content, c.isQuotation ? 1 : 0, c.interpretiveTradition ?? "", c.dateDisplay ?? "",
        editorialLicenseId, c.provenanceNote ?? "",
      );
      imported.commentaries++;
    }

    for (const r of corpus.relationships) {
      const from = passageIds.get(canonicalPassageKey(r.from));
      const to = passageIds.get(canonicalPassageKey(r.to));
      if (!from || !to) {
        issues.push({ severity: "error", code: "unknown_passage", message: `Relationship refers to unknown passage ${!from ? r.from : r.to}`, recordRef: `${r.from}->${r.to}` });
        continue;
      }
      const fromWorkId = db.query("SELECT work_id FROM passages WHERE id = ?").get(from) as { work_id: number };
      const toWorkId = db.query("SELECT work_id FROM passages WHERE id = ?").get(to) as { work_id: number };
      db.query(
        `INSERT INTO text_relationships (from_passage_id, to_passage_id, from_work_id, to_work_id, relationship_type,
           confidence, description, evidence, curator, review_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UWL editors', 'published')`,
      ).run(
        from, to, fromWorkId.work_id, toWorkId.work_id, r.type, r.confidence ?? "thematic",
        r.description, r.evidence ?? "",
      );
      imported.relationships++;
    }

    for (const c of corpus.collections) {
      const cres = db
        .query(
          "INSERT INTO collections (user_id, title, description, kind, is_public, share_token, curator, is_curated) VALUES (NULL, ?, ?, ?, 1, ?, ?, 1)",
        )
        .run(c.title, c.description ?? "", c.kind ?? "comparison", c.token, c.curator ?? "UWL editors");
      const collectionId = Number(cres.lastInsertRowid);
      for (const [i, item] of (c.items ?? []).entries()) {
        const passageId = passageIds.get(canonicalPassageKey(item.passage));
        if (!passageId) {
          issues.push({ severity: "error", code: "unknown_passage", message: `Collection ${c.token} refers to unknown passage ${item.passage}`, recordRef: c.token });
          continue;
        }
        db.query(
          "INSERT INTO collection_items (collection_id, passage_id, edition_id, position, annotation) VALUES (?, ?, NULL, ?, ?)",
        ).run(collectionId, passageId, i, item.annotation ?? "");
      }
      imported.collections++;
    }

    const errors = issues.filter((i) => i.severity === "error");
    if (errors.length) {
      throw new Error(`Corpus validation failed with ${errors.length} error(s): ${errors.slice(0, 5).map((e) => e.message).join(" | ")}`);
    }

    const importRes = db
      .query(
        "INSERT INTO imports (source_id, adapter, finished_at, status, records_seen, records_imported, records_failed, notes, log_json) VALUES (NULL, 'local-corpus', ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        now,
        issues.some((i) => i.severity === "warning") ? "partial" : "succeeded",
        seen,
        imported.works + imported.editions + imported.passages + imported.commentaries,
        issues.filter((i) => i.severity === "error").length,
        `Curated demonstration corpus loaded from version-controlled JSON, with ${imported.registrySources} source-registry entries. Warnings record coverage gaps and catalogue-only works.`,
        JSON.stringify(imported),
      );
    const importId = Number(importRes.lastInsertRowid);
    for (const issue of issues) {
      db.query(
        "INSERT INTO import_issues (import_id, severity, code, message, record_ref) VALUES (?, ?, ?, ?, ?)",
      ).run(importId, issue.severity, issue.code, issue.message, issue.recordRef ?? "");
    }
  });

  insertMany();
  imported.manifestImports = recordImportManifests();
  return { imported, issues };
}

// Every importer writes a manifest under data/imports before its text enters the
// corpus, and each pass grew its own shape. describeManifest reads all of them;
// this function files each one as an import run so the provenance page can show
// what was taken, from where, and when, without re-fetching the remote file.
//
// Files already named in an existing run are skipped without being parsed: the
// manifests together are several megabytes, and this runs at start-up. `dir` is
// a parameter so a caller can record a different directory of manifests.
export function recordImportManifests(dir = join(ROOT, "data", "imports")): number {
  if (!existsSync(dir)) return 0;
  const db = getDb();
  const recordedFiles = new Set<string>();
  for (const row of db.query("SELECT notes FROM imports").all() as { notes: string }[]) {
    for (const match of String(row.notes).matchAll(/([\w.-]+\.json)/g)) recordedFiles.add(match[1]);
  }
  let recorded = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    if (recordedFiles.has(file)) continue;
    let manifest: unknown;
    try {
      manifest = readJson(join(dir, file));
    } catch {
      continue;
    }
    const run = describeManifest(file, manifest);
    if (!run) continue;
    // A pass that gathered from several hosts at once (the Christian and Hindu
    // expansions did) has no single registry row, so its run is filed without a
    // source and keeps the manifest's own key for display.
    const source = db.query("SELECT id FROM sources WHERE slug = ?").get(run.sourceSlug) as { id: number } | null;
    const res = db
      .query(
        "INSERT INTO imports (source_id, adapter, finished_at, status, records_seen, records_imported, records_failed, notes, log_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        source?.id ?? null,
        run.adapter,
        run.finishedAt,
        run.status,
        run.records,
        run.records,
        run.failed,
        run.note,
        JSON.stringify(run.log),
      );
    if (run.failed) {
      const importId = Number(res.lastInsertRowid);
      db.query(
        "INSERT INTO import_issues (import_id, severity, code, message, record_ref) VALUES (?, 'warning', 'records_failed', ?, ?)",
      ).run(
        importId,
        `Manifest ${file} records ${run.failed} failed record(s) alongside ${run.records} ${run.unit}.`,
        run.source,
      );
    }
    recorded++;
  }
  return recorded;
}
