// Near-duplicate review across editions.
//
// The ingest pipeline compares a passage checksum against the checksums already
// seen, which catches a text repeated byte for byte. That is the strictest
// possible equality: a quotation mark, a hyphen or a corrected spelling makes
// the text "new", so two copies of one work can sit in the corpus under
// different catalogue records without either pass noticing.
//
// A scan works in two steps.
//
// 1. Candidate pairs are editions that repeat substantive passages. The tally
//    runs in SQLite as one grouping pass over the text table, so a pair is only
//    compared when the two editions already share text — not when they merely
//    number their passages the same way. A shared "1.1" is not evidence; a
//    shared verse is.
// 2. For each candidate pair the scan samples the references both editions
//    number, and compares the two texts at each sampled reference. Byte
//    equality is checked first, then equality after search normalisation
//    (punctuation, case, diacritics and orthographic variants), then a Jaccard
//    similarity over word shingles. A text that survives normalisation is
//    equivalent; one above the threshold is near; anything else differs.
//
// A scan only reports. It never merges editions, deletes text or changes a
// catalogue record: a near duplicate is a question for an editor.

import { getDb } from "./db";
import { isCjk, normalizeForSearch } from "./text";

export type ScanOptions = {
  /** Similarity at which a passage pair counts as near. */
  threshold?: number;
  /** Pair similarity at which the pair is recorded as worth reviewing. */
  recordThreshold?: number;
  /** Substantive passages an edition pair must share before it is compared. */
  minRepeated?: number;
  /** Passages compared per edition pair. */
  sample?: number;
  /** Most candidate pairs compared in one scan. */
  maxPairs?: number;
  /** Shortest text, in words, counted as a repeated passage. */
  minWords?: number;
};

export type EditionRef = {
  editionId: number;
  editionSlug: string;
  workSlug: string;
  workTitle: string;
  language: string;
};

export type DuplicateExample = {
  reference: string;
  kind: "equivalent" | "near";
  similarity: number;
  left: string;
  right: string;
};

export type DuplicatePairResult = {
  left: EditionRef;
  right: EditionRef;
  repeated: number;
  sampled: number;
  identical: number;
  equivalent: number;
  near: number;
  different: number;
  similarity: number;
  examples: DuplicateExample[];
};

export type DuplicateScanResult = {
  startedAt: string;
  finishedAt: string;
  threshold: number;
  recordThreshold: number;
  minRepeated: number;
  editions: number;
  candidatePairs: number;
  durationMs: number;
  pairs: DuplicatePairResult[];
};

const DEFAULTS = {
  // Word trigrams are a coarse texture: one changed word in a forty-word
  // passage costs about 0.85. A near threshold of 0.9 only caught trailing
  // clauses trimmed from a long verse, so the default is 0.8 and the examples
  // in the report show what crossed it.
  threshold: 0.8,
  recordThreshold: 0.5,
  minRepeated: 20,
  sample: 200,
  maxPairs: 200,
  minWords: 8,
};

/** A stable 32-bit hash for a shingle. */
function hashShingle(value: string): number {
  const hashed = Bun.hash(value);
  return Number(typeof hashed === "bigint" ? hashed & 0xffffffffn : Math.trunc(hashed)) >>> 0;
}

/**
 * The shingle set used for similarity: word trigrams for spaced scripts, and
 * character trigrams for CJK, where whitespace does not separate words.
 */
export function shingleSet(text: string): Set<number> {
  const normalized = normalizeForSearch(text);
  const out = new Set<number>();
  if (!normalized) return out;
  if (isCjk(normalized)) {
    const chars = normalized.replace(/\s+/g, "");
    for (let i = 0; i + 3 <= chars.length; i++) out.add(hashShingle(chars.slice(i, i + 3)));
    if (out.size === 0) out.add(hashShingle(chars));
    return out;
  }
  const words = normalized.split(" ").filter(Boolean);
  for (let i = 0; i + 3 <= words.length; i++) out.add(hashShingle(words.slice(i, i + 3).join(" ")));
  if (out.size === 0 && words.length) out.add(hashShingle(words.join(" ")));
  return out;
}

/** Jaccard similarity of two shingle sets, from 0 to 1. */
export function setSimilarity(a: Set<number>, b: Set<number>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const value of small) if (large.has(value)) shared++;
  return shared / (a.size + b.size - shared);
}

export function textSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  return setSimilarity(shingleSet(left), shingleSet(right));
}

export type TextRelation = { kind: "identical" | "equivalent" | "near" | "different"; similarity: number };

/**
 * Classify two texts: byte-identical, equivalent after normalisation, near
 * above the threshold, or different. Similarity is computed once here so a
 * caller does not repeat the work to score the pair.
 */
export function classifyTextPair(left: string, right: string, threshold = DEFAULTS.threshold): TextRelation {
  if (left === right) return { kind: "identical", similarity: 1 };
  const normalizedLeft = normalizeForSearch(left);
  const normalizedRight = normalizeForSearch(right);
  if (normalizedLeft && normalizedLeft === normalizedRight) return { kind: "equivalent", similarity: 1 };
  const similarity = setSimilarity(shingleSet(left), shingleSet(right));
  return { kind: similarity >= threshold ? "near" : "different", similarity };
}

function wordsIn(text: string): number {
  const normalized = normalizeForSearch(text);
  if (!normalized) return 0;
  return isCjk(normalized) ? [...normalized.replace(/\s+/g, "")].length : normalized.split(" ").filter(Boolean).length;
}

function trim(text: string, max = 300): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

type EditionRow = { id: number; slug: string; work_id: number; language_code: string; work_slug: string; work_title: string };

function loadEditions(): Map<number, EditionRef> {
  const rows = getDb()
    .query(
      `SELECT e.id, e.slug, e.work_id, e.language_code, w.slug AS work_slug, w.title AS work_title
       FROM editions e JOIN works w ON w.id = e.work_id`,
    )
    .all() as EditionRow[];
  return new Map(
    rows.map((row) => [
      row.id,
      {
        editionId: row.id,
        editionSlug: row.slug,
        workSlug: row.work_slug,
        workTitle: row.work_title,
        language: row.language_code,
      },
    ]),
  );
}

/**
 * Candidate edition pairs: editions that repeat substantive passages. The
 * grouping is done in SQLite so only the repeated checksums — tens of
 * thousands of rows, not millions — reach the caller.
 */
function candidatePairs(minWords: number): Map<string, number> {
  const db = getDb();
  const rows = db
    .query(
      `SELECT checksum, GROUP_CONCAT(DISTINCT edition_id) AS editions
       FROM passage_texts
       WHERE word_count >= ?
       GROUP BY checksum
       HAVING COUNT(DISTINCT edition_id) > 1`,
    )
    .all(minWords) as { checksum: string; editions: string }[];

  const tally = new Map<string, number>();
  for (const row of rows) {
    const ids = [...new Set(String(row.editions).split(",").map(Number))].filter(Number.isFinite).sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}:${ids[j]}`;
        tally.set(key, (tally.get(key) ?? 0) + 1);
      }
    }
  }
  return tally;
}

/** Compare one edition pair on the references both editions number. */
function comparePair(
  left: EditionRef,
  right: EditionRef,
  repeated: number,
  options: Required<Pick<ScanOptions, "threshold" | "sample" | "minWords">>,
): DuplicatePairResult | null {
  const db = getDb();
  const leftWork = (db.query("SELECT work_id FROM editions WHERE id = ?").get(left.editionId) as { work_id: number }).work_id;
  const rightWork = (db.query("SELECT work_id FROM editions WHERE id = ?").get(right.editionId) as { work_id: number }).work_id;
  const refCount = (db.query("SELECT COUNT(*) AS n FROM passages WHERE work_id = ?").get(leftWork) as { n: number }).n;
  if (!refCount) return null;

  // Sample evenly across the work: modulo on the stored sort order keeps the
  // sample deterministic between scans without loading every reference.
  const step = Math.max(1, Math.floor(refCount / options.sample));
  const rows = db
    .query(
      `SELECT p1.reference, ta.content AS left_text, tb.content AS right_text
       FROM passages p1
       JOIN passages p2 ON p2.work_id = ? AND p2.reference = p1.reference
       JOIN passage_texts ta ON ta.passage_id = p1.id AND ta.edition_id = ?
       JOIN passage_texts tb ON tb.passage_id = p2.id AND tb.edition_id = ?
       WHERE p1.work_id = ? AND p1.sort_order % ? = 0
       LIMIT ?`,
    )
    .all(rightWork, left.editionId, right.editionId, leftWork, step, options.sample) as {
    reference: string;
    left_text: string;
    right_text: string;
  }[];

  let identical = 0;
  let equivalent = 0;
  let near = 0;
  let different = 0;
  let sampled = 0;
  let total = 0;
  const examples: DuplicateExample[] = [];

  for (const row of rows) {
    // A one-line heading or a page placeholder cannot be judged for near
    // duplication: it is too short to have a stable texture.
    if (wordsIn(row.left_text) < options.minWords && wordsIn(row.right_text) < options.minWords) continue;
    sampled++;
    const relation = classifyTextPair(row.left_text, row.right_text, options.threshold);
    total += relation.similarity;
    if (relation.kind === "identical") identical++;
    else if (relation.kind === "equivalent") equivalent++;
    else if (relation.kind === "near") near++;
    else different++;

    if ((relation.kind === "equivalent" || relation.kind === "near") && examples.length < 6) {
      examples.push({
        reference: row.reference,
        kind: relation.kind,
        similarity: Number(relation.similarity.toFixed(3)),
        left: trim(row.left_text),
        right: trim(row.right_text),
      });
    }
  }

  if (sampled < 5) return null;
  return {
    left,
    right,
    repeated,
    sampled,
    identical,
    equivalent,
    near,
    different,
    similarity: Number((total / sampled).toFixed(4)),
    examples: examples.sort((a, b) => a.similarity - b.similarity),
  };
}

/**
 * Run the scan without writing anything. `onProgress` receives coarse progress
 * lines for a CLI; the scan itself is one grouping pass plus one query per
 * candidate pair.
 */
export function scanNearDuplicates(
  options: ScanOptions = {},
  onProgress: (message: string) => void = () => {},
): DuplicateScanResult {
  const settings = {
    threshold: options.threshold ?? DEFAULTS.threshold,
    recordThreshold: options.recordThreshold ?? DEFAULTS.recordThreshold,
    minRepeated: options.minRepeated ?? DEFAULTS.minRepeated,
    sample: options.sample ?? DEFAULTS.sample,
    maxPairs: options.maxPairs ?? DEFAULTS.maxPairs,
    minWords: options.minWords ?? DEFAULTS.minWords,
  };
  const db = getDb();
  const startedAt = new Date().toISOString();
  const started = performance.now();

  const editions = loadEditions();
  onProgress(`Loaded ${editions.size} editions.`);

  const tally = candidatePairs(settings.minWords);
  onProgress(`${tally.size} edition pair(s) repeat substantive passages.`);

  const candidates = [...tally.entries()]
    .map(([key, repeated]) => {
      const [leftId, rightId] = key.split(":").map(Number);
      return { leftId, rightId, repeated };
    })
    .filter(({ leftId, rightId, repeated }) => {
      const left = editions.get(leftId);
      const right = editions.get(rightId);
      return !!left && !!right && left.language === right.language && repeated >= settings.minRepeated;
    })
    .sort((a, b) => b.repeated - a.repeated)
    .slice(0, settings.maxPairs);

  onProgress(`Comparing ${candidates.length} candidate pair(s) on sampled shared references.`);

  const pairs: DuplicatePairResult[] = [];
  for (const [index, candidate] of candidates.entries()) {
    const left = editions.get(candidate.leftId)!;
    const right = editions.get(candidate.rightId)!;
    const result = comparePair(left, right, candidate.repeated, settings);
    if (result && result.similarity >= settings.recordThreshold) pairs.push(result);
    if ((index + 1) % 25 === 0) onProgress(`Compared ${index + 1}/${candidates.length} pairs; ${pairs.length} recorded so far.`);
  }

  pairs.sort((a, b) => b.similarity - a.similarity || b.repeated - a.repeated);
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    threshold: settings.threshold,
    recordThreshold: settings.recordThreshold,
    minRepeated: settings.minRepeated,
    editions: editions.size,
    candidatePairs: candidates.length,
    durationMs: Math.round(performance.now() - started),
    pairs,
  };
}

/** Persist a scan and its pairs. A scan is a record, not a change to the corpus. */
export function recordDuplicateScan(result: DuplicateScanResult): number {
  const db = getDb();
  const save = db.transaction(() => {
    const scan = db
      .query(
        `INSERT INTO duplicate_scans
           (started_at, finished_at, threshold, record_threshold, min_repeated, editions,
            candidate_pairs, pairs_recorded, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        result.startedAt,
        result.finishedAt,
        result.threshold,
        result.recordThreshold,
        result.minRepeated,
        result.editions,
        result.candidatePairs,
        result.pairs.length,
        result.durationMs,
      );
    const scanId = Number(scan.lastInsertRowid);
    const insert = db.query(
      `INSERT INTO duplicate_pairs
         (scan_id, left_edition_id, right_edition_id, repeated_passages, sampled,
          identical, equivalent, near, different, similarity, examples_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const pair of result.pairs) {
      insert.run(
        scanId,
        pair.left.editionId,
        pair.right.editionId,
        pair.repeated,
        pair.sampled,
        pair.identical,
        pair.equivalent,
        pair.near,
        pair.different,
        pair.similarity,
        JSON.stringify(pair.examples),
      );
    }
    return scanId;
  });
  return save();
}

/** The latest stored scan, with its pairs, for the admin page. */
export function latestDuplicateReport() {
  const db = getDb();
  const scan = db.query("SELECT * FROM duplicate_scans ORDER BY id DESC LIMIT 1").get() as any;
  if (!scan) return { scan: null, pairs: [] as any[] };
  const rows = db
    .query(
      `SELECT dp.*, le.id AS le_id, le.slug AS le_slug, le.language_code AS le_language, le.work_id AS le_work,
              lw.slug AS le_work_slug, lw.title AS le_work_title,
              re.id AS re_id, re.slug AS re_slug, re.language_code AS re_language, re.work_id AS re_work,
              rw.slug AS re_work_slug, rw.title AS re_work_title
       FROM duplicate_pairs dp
       JOIN editions le ON le.id = dp.left_edition_id
       JOIN works lw ON lw.id = le.work_id
       JOIN editions re ON re.id = dp.right_edition_id
       JOIN works rw ON rw.id = re.work_id
       WHERE dp.scan_id = ?
       ORDER BY dp.similarity DESC, dp.repeated_passages DESC`,
    )
    .all(scan.id) as any[];

  const parse = (value: string) => {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  return {
    scan: {
      id: scan.id,
      startedAt: scan.started_at,
      finishedAt: scan.finished_at,
      threshold: scan.threshold,
      recordThreshold: scan.record_threshold,
      minRepeated: scan.min_repeated,
      editions: scan.editions,
      candidatePairs: scan.candidate_pairs,
      pairsRecorded: scan.pairs_recorded,
      durationMs: scan.duration_ms,
    },
    pairs: rows.map((row) => ({
      id: row.id,
      similarity: row.similarity,
      repeated: row.repeated_passages,
      sampled: row.sampled,
      identical: row.identical,
      equivalent: row.equivalent,
      near: row.near,
      different: row.different,
      left: {
        editionId: row.le_id,
        editionSlug: row.le_slug,
        workSlug: row.le_work_slug,
        workTitle: row.le_work_title,
        language: row.le_language,
      },
      right: {
        editionId: row.re_id,
        editionSlug: row.re_slug,
        workSlug: row.re_work_slug,
        workTitle: row.re_work_title,
        language: row.re_language,
      },
      examples: parse(row.examples_json),
    })),
  };
}
