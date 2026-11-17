import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDb, ROOT } from "./db";
import type { User } from "./auth";
import { ADAPTERS } from "../ingest/adapters";
import { attention } from "./verification";

type Row = Record<string, any>;

// Registry languages are not limited to languages present in the corpus, so the
// registry keeps its own display labels rather than depending on seeded rows.
const LANGUAGE_LABELS: Record<string, string> = {
  ae: "Avestan",
  am: "Amharic",
  ar: "Arabic",
  arc: "Aramaic",
  bn: "Bengali",
  bo: "Tibetan",
  de: "German",
  en: "English",
  es: "Spanish",
  fa: "Persian",
  fr: "French",
  grc: "Ancient Greek",
  he: "Hebrew",
  hi: "Hindi",
  hy: "Armenian",
  id: "Indonesian",
  it: "Italian",
  ja: "Japanese",
  ka: "Georgian",
  ko: "Korean",
  ku: "Kurdish",
  la: "Latin",
  ml: "Malayalam",
  ms: "Malay",
  my: "Burmese",
  ne: "Nepali",
  pa: "Punjabi (Gurmukhi)",
  pal: "Middle Persian",
  pi: "Pali",
  pl: "Polish",
  pra: "Prakrit",
  ru: "Russian",
  sa: "Sanskrit",
  si: "Sinhala",
  syr: "Syriac",
  ta: "Tamil",
  te: "Telugu",
  th: "Thai",
  tr: "Turkish",
  ur: "Urdu",
  vi: "Vietnamese",
  yi: "Yiddish",
  zh: "Chinese",
};

function languageLabel(code: string): string {
  return LANGUAGE_LABELS[code] ?? code;
}

const VALID_STATUS = [
  "discovered",
  "under_review",
  "licence_verified",
  "ready_for_integration",
  "connected",
  "import_tested",
  "active",
  "restricted",
  "unavailable",
] as const;

const VALID_APPROVAL = ["pending", "approved", "rejected"] as const;
const VALID_CHECKS = ["ok", "blocked", "error", "unverified"] as const;
const VALID_METHODS = ["manual", "http", "api"] as const;
const VALID_QUEUE_STATUS = ["pending", "approved", "running", "succeeded", "failed", "rejected", "needs_review"] as const;

function parseJson(value: string | null): any[] {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapSource(r: Row) {
  return {
    sourceId: r.source_id,
    sourceName: r.source_name,
    baseUrl: r.base_url,
    organisation: r.organisation,
    traditions: parseJson(r.traditions_covered_json),
    schools: parseJson(r.schools_covered_json),
    languages: parseJson(r.languages_json).map(languageLabel),
    languageCodes: parseJson(r.languages_json),
    sourceType: r.source_type,
    contentTypes: parseJson(r.content_types_json),
    apiDocumentationUrl: r.api_documentation_url,
    downloadUrl: r.download_url,
    accessMethod: r.access_method,
    licenceUrl: r.licence_url,
    licenceStatus: r.licence_status,
    commercialUseAllowed: r.commercial_use_allowed == null ? null : !!r.commercial_use_allowed,
    redistributionAllowed: r.redistribution_allowed == null ? null : !!r.redistribution_allowed,
    attributionRequirements: r.attribution_requirements,
    authenticationRequired: r.authentication_required == null ? null : !!r.authentication_required,
    rateLimits: r.rate_limits,
    ingestionStatus: r.ingestion_status,
    lastVerifiedAt: r.last_verified_at,
    reliabilityNotes: r.source_reliability_notes,
    editorialNotes: r.editorial_notes,
    priority: r.priority,
    approvalStatus: r.approval_status,
    reviewedAt: r.reviewed_at,
    reviewNote: r.review_note,
    reviewer: r.reviewer_name ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listSources(params: URLSearchParams) {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  const add = (sql: string, value: any) => {
    where.push(sql);
    args.push(value);
  };

  const q = (params.get("q") ?? "").trim();
  if (q) {
    add(
      `(source_name LIKE ? OR organisation LIKE ? OR base_url LIKE ? OR source_reliability_notes LIKE ? OR editorial_notes LIKE ?)`,
      `%${q}%`,
    );
    for (let i = 0; i < 4; i++) args.push(`%${q}%`);
  }
  const tradition = params.get("tradition");
  if (tradition) add("traditions_covered_json LIKE ?", `%\"${tradition}\"%`);
  const language = params.get("language");
  if (language) add("languages_json LIKE ?", `%\"${language}\"%`);
  const contentType = params.get("contentType");
  if (contentType) add("content_types_json LIKE ?", `%\"${contentType}\"%`);
  const status = params.get("status");
  if (status && (VALID_STATUS as readonly string[]).includes(status)) add("ingestion_status = ?", status);
  const approval = params.get("approval");
  if (approval && (VALID_APPROVAL as readonly string[]).includes(approval)) add("approval_status = ?", approval);
  const priority = Number(params.get("priority"));
  if (priority >= 1 && priority <= 3) add("priority = ?", priority);
  const access = params.get("access");
  if (access) add("access_method LIKE ?", `%${access}%`);

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (db.query(`SELECT COUNT(*) AS n FROM source_registry ${whereSql}`).get(...args) as Row).n;
  const page = Math.max(1, Number(params.get("page") ?? 1));
  const pageSize = Math.min(60, Math.max(8, Number(params.get("pageSize") ?? 24)));
  const sort = params.get("sort") ?? "priority";
  const order =
    sort === "name" ? "source_name COLLATE NOCASE"
    : sort === "verified" ? "last_verified_at DESC NULLS LAST, source_name"
    : sort === "status" ? "ingestion_status, priority, source_name"
    : "priority, CASE ingestion_status WHEN 'active' THEN 0 WHEN 'import_tested' THEN 1 WHEN 'connected' THEN 2 WHEN 'licence_verified' THEN 3 WHEN 'under_review' THEN 4 WHEN 'restricted' THEN 5 WHEN 'unavailable' THEN 6 ELSE 7 END, source_name COLLATE NOCASE";

  const rows = db
    .query(
      `SELECT r.*, u.display_name AS reviewer_name FROM source_registry r
       LEFT JOIN users u ON u.id = r.reviewed_by
       ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, (page - 1) * pageSize) as Row[];

  const all = db.query("SELECT source_id, source_name, traditions_covered_json, schools_covered_json, languages_json, content_types_json, api_documentation_url, ingestion_status, approval_status, priority FROM source_registry").all() as Row[];
  const traditionNames = new Map<string, string>(
    (db.query("SELECT slug, name FROM traditions").all() as Row[]).map((t) => [t.slug, t.name]),
  );
  const countBy = (key: "ingestion_status" | "approval_status" | "priority") => {
    const m = new Map<string, number>();
    for (const r of all) m.set(String(r[key]), (m.get(String(r[key])) ?? 0) + 1);
    return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value));
  };
  const jsonCount = (field: string) => {
    const m = new Map<string, number>();
    for (const r of all) for (const value of parseJson(r[field])) m.set(value, (m.get(value) ?? 0) + 1);
    return [...m.entries()].map(([value, count]) => ({ value, label: traditionNames.get(value) ?? value, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  };

  const upkeep = attention();
  return {
    sources: rows.map(mapSource).map((s) => ({
      ...s,
      traditions: (s.traditions as string[]).map((slug) => ({ slug, name: traditionNames.get(slug) ?? slug })),
    })),
    total,
    page,
    pages: Math.ceil(total / pageSize),
    stats: {
      total: all.length,
      approved: all.filter((r) => r.approval_status === "approved").length,
      importTested: all.filter((r) => r.ingestion_status === "import_tested").length,
      restricted: all.filter((r) => r.ingestion_status === "restricted" || r.ingestion_status === "unavailable").length,
      underReview: all.filter((r) => r.ingestion_status === "under_review").length,
      withApi: all.filter((r) => r.api_documentation_url).length,
      // Availability history, kept apart from rights: a due source is one whose
      // last recorded check has aged out, not one whose licence has changed.
      dueForCheck: upkeep.sourcesDue,
      neverChecked: upkeep.sourcesNeverChecked,
      pendingApproval: upkeep.approvalsPending.reduce((total, entry) => total + entry.count, 0),
    },
    facets: {
      traditions: jsonCount("traditions_covered_json"),
      languages: (() => {
        const m = new Map<string, number>();
        for (const r of all) for (const v of parseJson(r.languages_json)) m.set(v, (m.get(v) ?? 0) + 1);
        return [...m.entries()].map(([value, count]) => ({ value, label: languageLabel(value), count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      })(),
      contentTypes: jsonCount("content_types_json"),
      statuses: countBy("ingestion_status"),
      approvals: countBy("approval_status"),
      priorities: countBy("priority"),
    },
    note:
      "A registry entry is not an integration. 'Import tested' means the source was actually fetched and an excerpt validated. 'Restricted' means no reuse permission was found or the terms prohibit copying.",
  };
}

export function getSource(sourceId: string) {
  const db = getDb();
  const row = db
    .query(
      `SELECT r.*, u.display_name AS reviewer_name FROM source_registry r
       LEFT JOIN users u ON u.id = r.reviewed_by WHERE r.source_id = ?`,
    )
    .get(sourceId) as Row | null;
  if (!row) return null;
  const source = mapSource(row);
  const checks = (db
    .query(
      `SELECT c.*, u.display_name AS checker FROM source_checks c LEFT JOIN users u ON u.id = c.checked_by
       WHERE c.source_id = ? ORDER BY c.checked_at DESC, c.id DESC LIMIT 20`,
    )
    .all(sourceId) as Row[]).map((c: Row) => ({
      id: c.id, checkedAt: c.checked_at, method: c.method, status: c.status,
      httpStatus: c.http_status, notes: c.notes, checker: c.checker ?? null,
    }));
  const sourceRow = db.query("SELECT id, slug FROM sources WHERE slug = ?").get(sourceId) as Row | null;
  const imports = sourceRow
    ? (db.query("SELECT * FROM imports WHERE source_id = ? ORDER BY id DESC LIMIT 10").all(sourceRow.id) as Row[]).map((i) => ({
        id: i.id, adapter: i.adapter, status: i.status, seen: i.records_seen, imported: i.records_imported,
        failed: i.records_failed, notes: i.notes, startedAt: i.started_at, finishedAt: i.finished_at,
      }))
    : [];
  const queue = (db.query("SELECT * FROM ingestion_queue WHERE source_id = ? ORDER BY id DESC LIMIT 20").all(sourceId) as Row[]).map((q) => ({
    id: q.id, adapter: q.adapter, status: q.status, requestNote: q.request_note, reviewNote: q.review_note,
    recordsSeen: q.records_seen, recordsImported: q.records_imported, recordsFailed: q.records_failed,
    error: q.error, createdAt: q.created_at, startedAt: q.started_at, finishedAt: q.finished_at,
  }));
  const editions = sourceRow
    ? (db.query(
        `SELECT e.slug, e.title, e.publication_year, e.edition_type, w.title AS work_title, w.slug AS work_slug,
                CASE WHEN EXISTS (SELECT 1 FROM work_streams ws WHERE ws.work_slug = w.slug)
                     THEN (SELECT COUNT(*) FROM passages p WHERE p.work_id = w.id)
                     ELSE (SELECT COUNT(*) FROM passage_texts pt WHERE pt.edition_id = e.id)
                END AS text_count
         FROM editions e JOIN works w ON w.id = e.work_id WHERE e.source_id = ? ORDER BY w.title`,
      ).all(sourceRow.id) as Row[]).map((e) => ({
        slug: e.slug, title: e.title, publicationYear: e.publication_year, editionType: e.edition_type,
        work: { slug: e.work_slug, title: e.work_title }, textCount: e.text_count,
      }))
    : [];
  const traditionNames = new Map<string, string>(
    (db.query("SELECT slug, name FROM traditions").all() as Row[]).map((t) => [t.slug, t.name]),
  );
  return {
    source: {
      ...source,
      traditions: source.traditions.map((slug) => ({ slug, name: traditionNames.get(slug) ?? slug })),
    },
    checks,
    imports,
    queue,
    editions,
    linked: !!sourceRow,
    adapters: ADAPTERS.map((a) => ({ id: a.id, label: a.label, status: a.status, canImport: a.canImport })),
  };
}

export function reviewSource(user: User, sourceId: string, input: Record<string, any>) {
  if (user.role !== "admin") return { error: "forbidden" as const };
  const db = getDb();
  const row = db.query("SELECT * FROM source_registry WHERE source_id = ?").get(sourceId) as Row | null;
  if (!row) return { error: "not_found" as const };

  const patch: string[] = [];
  const args: any[] = [];
  if (input.approvalStatus != null) {
    if (!(VALID_APPROVAL as readonly string[]).includes(input.approvalStatus)) return { error: "invalid_approval" as const };
    patch.push("approval_status = ?"); args.push(input.approvalStatus);
    patch.push("reviewed_by = ?"); args.push(user.id);
    patch.push("reviewed_at = datetime('now')");
  }
  if (input.ingestionStatus != null) {
    if (!(VALID_STATUS as readonly string[]).includes(input.ingestionStatus)) return { error: "invalid_status" as const };
    patch.push("ingestion_status = ?"); args.push(input.ingestionStatus);
  }
  if (input.licenceStatus != null) { patch.push("licence_status = ?"); args.push(String(input.licenceStatus).slice(0, 80)); }
  if (input.reviewNote != null) { patch.push("review_note = ?"); args.push(String(input.reviewNote).slice(0, 4000)); }
  if (input.editorialNotes != null) { patch.push("editorial_notes = ?"); args.push(String(input.editorialNotes).slice(0, 8000)); }
  if (input.lastVerifiedAt != null) { patch.push("last_verified_at = ?"); args.push(String(input.lastVerifiedAt).slice(0, 40)); }
  if (!patch.length) return { error: "empty" as const };
  patch.push("updated_at = datetime('now')");
  db.query(`UPDATE source_registry SET ${patch.join(", ")} WHERE source_id = ?`).run(...args, sourceId);
  if (input.ingestionStatus || input.approvalStatus) {
    db.query(
      "INSERT INTO source_checks (source_id, method, status, notes, checked_by) VALUES (?, 'manual', ?, ?, ?)",
    ).run(
      sourceId,
      input.ingestionStatus === "restricted" || input.ingestionStatus === "unavailable" ? "blocked" : input.approvalStatus === "approved" ? "ok" : "unverified",
      `Administrative review by ${user.display_name}. ${input.reviewNote ?? ""}`.trim(),
      user.id,
    );
  }
  return { ok: true, source: getSource(sourceId)?.source };
}

export function recordCheck(user: User, sourceId: string, input: Record<string, any>) {
  if (user.role !== "editor" && user.role !== "admin") return { error: "forbidden" as const };
  if (!(VALID_CHECKS as readonly string[]).includes(input.status)) return { error: "invalid_status" as const };
  if (!(VALID_METHODS as readonly string[]).includes(input.method)) return { error: "invalid_method" as const };
  const db = getDb();
  if (!db.query("SELECT 1 FROM source_registry WHERE source_id = ?").get(sourceId)) return { error: "not_found" as const };
  db.query(
    "INSERT INTO source_checks (source_id, method, status, http_status, notes, checked_by) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    sourceId, input.method, input.status,
    Number.isInteger(Number(input.httpStatus)) ? Number(input.httpStatus) : null,
    String(input.notes ?? "").slice(0, 2000), user.id,
  );
  if (input.status === "ok" && input.markVerified) {
    db.query("UPDATE source_registry SET last_verified_at = date('now'), updated_at = datetime('now') WHERE source_id = ?").run(sourceId);
  }
  return { ok: true };
}

export function requestIngestion(user: User, sourceId: string, adapter: string, note: string) {
  if (user.role !== "editor" && user.role !== "admin") return { error: "forbidden" as const };
  const db = getDb();
  const source = db.query("SELECT * FROM source_registry WHERE source_id = ?").get(sourceId) as Row | null;
  if (!source) return { error: "not_found" as const };
  if (source.approval_status !== "approved") return { error: "not_approved" as const };
  if (source.ingestion_status === "restricted" || source.ingestion_status === "unavailable") return { error: "restricted" as const };
  if (!adapter || adapter.length > 120) return { error: "invalid_adapter" as const };
  const res = db.query(
    "INSERT INTO ingestion_queue (source_id, adapter, request_note, requested_by) VALUES (?, ?, ?, ?)",
  ).run(sourceId, adapter, note.slice(0, 2000), user.id);
  return { ok: true, id: Number(res.lastInsertRowid), status: "pending" };
}

export function listQueue(user: User) {
  if (user.role !== "editor" && user.role !== "admin") return { error: "forbidden" as const };
  const rows = getDb()
    .query(
      `SELECT q.*, r.source_name, r.ingestion_status, r.approval_status, u.display_name AS requester, v.display_name AS reviewer
       FROM ingestion_queue q JOIN source_registry r ON r.source_id = q.source_id
       LEFT JOIN users u ON u.id = q.requested_by LEFT JOIN users v ON v.id = q.reviewed_by
       ORDER BY CASE q.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, q.id DESC LIMIT 100`,
    )
    .all() as Row[];
  return {
    queue: rows.map((q) => ({
      id: q.id, sourceId: q.source_id, sourceName: q.source_name, adapter: q.adapter, status: q.status,
      requestNote: q.request_note, reviewNote: q.review_note, requester: q.requester ?? null,
      reviewer: q.reviewer ?? null, sourceStatus: q.ingestion_status, approvalStatus: q.approval_status,
      recordsSeen: q.records_seen, recordsImported: q.records_imported, recordsFailed: q.records_failed,
      error: q.error, createdAt: q.created_at, startedAt: q.started_at, finishedAt: q.finished_at,
    })),
  };
}

export function reviewQueue(user: User, id: number, action: string, note: string) {
  if (user.role !== "admin") return { error: "forbidden" as const };
  const allowed = ["approved", "rejected", "needs_review", "running", "succeeded", "failed"];
  if (!allowed.includes(action)) return { error: "invalid_action" as const };
  const db = getDb();
  const row = db.query("SELECT * FROM ingestion_queue WHERE id = ?").get(id) as Row | null;
  if (!row) return { error: "not_found" as const };
  const started = action === "running" ? "datetime('now')" : "started_at";
  const finished = ["succeeded", "failed", "rejected"].includes(action) ? "datetime('now')" : "finished_at";
  db.query(
    `UPDATE ingestion_queue SET status = ?, review_note = ?, reviewed_by = ?,
       started_at = ${started}, finished_at = ${finished} WHERE id = ?`,
  ).run(action, note.slice(0, 2000), user.id, id);
  return { ok: true, status: action };
}

const RIGHTS_KINDS = ["permission", "attribution", "takedown", "consultation", "metadata"] as const;
const RIGHTS_STATUSES = ["received", "under_review", "resolved", "declined"] as const;

export function submitRightsRequest(input: {
  sourceId: string;
  workSlug: string;
  kind: string;
  contactName: string;
  contactEmail: string;
  message: string;
}) {
  if (!(RIGHTS_KINDS as readonly string[]).includes(input.kind)) return { error: "invalid_kind" as const };
  const db = getDb();
  if (input.sourceId && !db.query("SELECT 1 FROM source_registry WHERE source_id = ?").get(input.sourceId)) {
    return { error: "source_not_found" as const };
  }
  const res = db.query(
    "INSERT INTO rights_requests (source_id, work_slug, kind, contact_name, contact_email, message) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    input.sourceId || null,
    input.workSlug,
    input.kind,
    input.contactName,
    input.contactEmail,
    input.message,
  );
  return { ok: true, id: Number(res.lastInsertRowid), status: "received" };
}

export function listRightsRequests(user: User) {
  if (user.role !== "editor" && user.role !== "admin") return { error: "forbidden" as const };
  const rows = getDb()
    .query(
      `SELECT r.*, s.source_name, u.display_name AS reviewer
       FROM rights_requests r LEFT JOIN source_registry s ON s.source_id = r.source_id
       LEFT JOIN users u ON u.id = r.reviewed_by
       ORDER BY CASE r.status WHEN 'received' THEN 0 WHEN 'under_review' THEN 1 ELSE 2 END, r.id DESC LIMIT 100`,
    )
    .all() as Row[];
  return {
    requests: rows.map((r) => ({
      id: r.id, sourceId: r.source_id, sourceName: r.source_name ?? null, workSlug: r.work_slug,
      kind: r.kind, contactName: r.contact_name, contactEmail: r.contact_email, message: r.message,
      status: r.status, createdAt: r.created_at, reviewer: r.reviewer ?? null,
      reviewedAt: r.reviewed_at, reviewNote: r.review_note,
    })),
  };
}

export function reviewRightsRequest(user: User, id: number, status: string, note: string) {
  if (user.role !== "editor" && user.role !== "admin") return { error: "forbidden" as const };
  if (!(RIGHTS_STATUSES as readonly string[]).includes(status) || status === "received") return { error: "invalid_status" as const };
  const db = getDb();
  const row = db.query("SELECT id FROM rights_requests WHERE id = ?").get(id) as Row | null;
  if (!row) return { error: "not_found" as const };
  db.query(
    "UPDATE rights_requests SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), review_note = ? WHERE id = ?",
  ).run(status, user.id, note.slice(0, 4000), id);
  return { ok: true, status };
}

export function getAdminSummary(user: User) {
  if (user.role !== "editor" && user.role !== "admin") return { error: "forbidden" as const };
  const db = getDb();
  const counts = db.query(
    `SELECT
      (SELECT COUNT(*) FROM source_registry WHERE approval_status = 'pending') AS pending_sources,
      (SELECT COUNT(*) FROM source_registry WHERE ingestion_status = 'under_review') AS under_review,
      (SELECT COUNT(*) FROM source_registry WHERE ingestion_status = 'restricted') AS restricted,
      (SELECT COUNT(*) FROM source_registry WHERE ingestion_status IN ('active','import_tested')) AS integrated,
      (SELECT COUNT(*) FROM ingestion_queue WHERE status = 'pending') AS pending_imports,
      (SELECT COUNT(*) FROM ingestion_queue WHERE status = 'failed') AS failed_imports,
      (SELECT COUNT(*) FROM source_checks WHERE checked_at < datetime('now','-180 days')) AS stale_checks`,
  ).get() as Row;
  const pending = db.query(
    `SELECT source_id, source_name, organisation, ingestion_status, priority, last_verified_at
     FROM source_registry WHERE approval_status = 'pending' ORDER BY priority, source_name LIMIT 12`,
  ).all();
  const restricted = db.query(
    `SELECT source_id, source_name, licence_status, editorial_notes
     FROM source_registry WHERE ingestion_status = 'restricted' ORDER BY source_name LIMIT 12`,
  ).all();
  // What has gone unattended, alongside the counts an editor already works from.
  return { counts, pending, restricted, attention: attention() };
}

// ---------------------------------------------------------------------------
// Source intake
//
// Discovery used to mean editing data/registry/sources.json by hand, which put
// the registry's only writable path outside the application and outside the
// audit trail. The intake form records a lead instead: a new row, a check row
// naming the person who filed it, and the same entry appended to the registry
// file so a corpus rebuild keeps it. It is never an approval.
// ---------------------------------------------------------------------------

export type SourceIntake = {
  sourceId: string;
  sourceName: string;
  organisation: string;
  baseUrl: string;
  sourceType: string;
  accessMethod: string;
  licenceUrl: string;
  licenceStatus: string;
  attributionRequirements: string;
  apiDocumentationUrl: string;
  downloadUrl: string;
  traditions: string[];
  languages: string[];
  contentTypes: string[];
  priority: number;
  reliabilityNotes: string;
  editorialNotes: string;
};

const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;
const CONTENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9_-]{1,40}$/;

export function registryFilePath() {
  return process.env.UWL_REGISTRY_PATH || join(ROOT, "data", "registry", "sources.json");
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Append one entry to the registry file, preserving the file's formatting and
 * writing through a temporary copy so a half-written registry is not left
 * behind. Returns false when the ID is already present.
 */
export function appendRegistrySource(
  entry: Record<string, unknown>,
  filePath = registryFilePath(),
): boolean {
  const registry = JSON.parse(readFileSync(filePath, "utf8"));
  const sources: Record<string, unknown>[] = Array.isArray(registry.sources) ? registry.sources : [];
  if (sources.some((source) => source.source_id === entry.source_id)) return false;
  sources.push(entry);
  registry.sources = sources;
  const temporary = `${filePath}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  renameSync(temporary, filePath);
  return true;
}

function registryFileHasSource(sourceId: string, filePath: string): boolean {
  try {
    const registry = JSON.parse(readFileSync(filePath, "utf8"));
    return Array.isArray(registry.sources) && registry.sources.some((source: any) => source.source_id === sourceId);
  } catch {
    return false;
  }
}

export function addRegistrySource(user: User, input: SourceIntake) {
  if (user.role !== "editor" && user.role !== "admin") return { error: "forbidden" as const };

  const sourceId = input.sourceId.trim().toLowerCase();
  const sourceName = input.sourceName.trim();
  if (!SOURCE_ID_PATTERN.test(sourceId)) return { error: "invalid_source_id" as const };
  if (sourceName.length < 2 || sourceName.length > 200) return { error: "invalid_source_name" as const };
  if (input.reliabilityNotes.trim().length < 10) return { error: "notes_required" as const };
  const priority = Number(input.priority);
  if (![1, 2, 3].includes(priority)) return { error: "invalid_priority" as const };
  for (const [label, value] of [
    ["base_url", input.baseUrl],
    ["licence_url", input.licenceUrl],
    ["api_documentation_url", input.apiDocumentationUrl],
    ["download_url", input.downloadUrl],
  ] as const) {
    if (value.trim() && !isHttpUrl(value.trim())) return { error: "invalid_url" as const, field: label };
  }

  const db = getDb();
  const traditions = [...new Set(input.traditions.map((value) => value.trim()).filter(Boolean))];
  const knownTraditions = new Set((db.query("SELECT slug FROM traditions").all() as Row[]).map((row) => row.slug));
  for (const tradition of traditions) if (!knownTraditions.has(tradition)) return { error: "invalid_tradition" as const, field: tradition };

  const languages = [...new Set(input.languages.map((value) => value.trim()).filter(Boolean))];
  for (const language of languages) if (!(language in LANGUAGE_LABELS)) return { error: "invalid_language" as const, field: language };

  const contentTypes = [...new Set(input.contentTypes.map((value) => value.trim()).filter(Boolean))];
  for (const type of contentTypes) if (!CONTENT_TYPE_PATTERN.test(type)) return { error: "invalid_content_type" as const, field: type };

  const filePath = registryFilePath();
  if (
    db.query("SELECT 1 FROM source_registry WHERE source_id = ?").get(sourceId) ||
    registryFileHasSource(sourceId, filePath)
  ) {
    return { error: "source_exists" as const };
  }

  const filedAt = new Date().toISOString().slice(0, 10);
  const reviewNote =
    `Recorded through the registry intake form by ${user.display_name} on ${filedAt}. ` +
    "Not yet checked for availability or licence.";
  const entry = {
    source_id: sourceId,
    source_name: sourceName,
    base_url: input.baseUrl.trim(),
    organisation: input.organisation.trim(),
    traditions_covered: traditions,
    schools_covered: [],
    languages,
    source_type: input.sourceType.trim(),
    content_types: contentTypes,
    api_documentation_url: input.apiDocumentationUrl.trim(),
    download_url: input.downloadUrl.trim(),
    access_method: input.accessMethod.trim(),
    licence_url: input.licenceUrl.trim(),
    licence_status: input.licenceStatus.trim() || "not_verified",
    commercial_use_allowed: null,
    redistribution_allowed: null,
    attribution_requirements: input.attributionRequirements.trim(),
    authentication_required: null,
    rate_limits: "",
    ingestion_status: "discovered",
    last_verified_at: null,
    source_reliability_notes: input.reliabilityNotes.trim(),
    editorial_notes: input.editorialNotes.trim(),
    priority,
    approval_status: "pending",
    review_note: reviewNote,
  };

  const insert = db.transaction(() => {
    db.query(
      `INSERT INTO source_registry (source_id, source_name, base_url, organisation, traditions_covered_json,
         schools_covered_json, languages_json, source_type, content_types_json, api_documentation_url, download_url,
         access_method, licence_url, licence_status, attribution_requirements, ingestion_status, source_reliability_notes,
         editorial_notes, priority, approval_status, review_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.source_id,
      entry.source_name,
      entry.base_url,
      entry.organisation,
      JSON.stringify(entry.traditions_covered),
      JSON.stringify(entry.schools_covered),
      JSON.stringify(entry.languages),
      entry.source_type,
      JSON.stringify(entry.content_types),
      entry.api_documentation_url,
      entry.download_url,
      entry.access_method,
      entry.licence_url,
      entry.licence_status,
      entry.attribution_requirements,
      entry.ingestion_status,
      entry.source_reliability_notes,
      entry.editorial_notes,
      entry.priority,
      entry.approval_status,
      entry.review_note,
    );
    db.query(
      "INSERT INTO source_checks (source_id, method, status, notes, checked_by) VALUES (?, 'manual', 'unverified', ?, ?)",
    ).run(
      sourceId,
      `Recorded through the registry intake form by ${user.display_name}. No availability check or licence review has been performed.`,
      user.id,
    );
  });
  insert();

  let persisted: "registry" | "database" = "registry";
  let warning = "";
  try {
    if (!appendRegistrySource(entry, filePath)) {
      persisted = "database";
      warning = "The registry file already contained this ID; the database row was still recorded.";
    }
  } catch (err: any) {
    persisted = "database";
    warning = `The registry file could not be updated (${err?.message ?? err}); the source is recorded in the database only.`;
  }

  return { ok: true as const, sourceId, persisted, warning, source: getSource(sourceId)?.source };
}
