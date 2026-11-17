// Availability checks for the source registry, and the escalation figures that
// tell an editor what has gone unattended.
//
// Availability is not a licence verification: a check records whether the
// documented URL answers today. It never changes licence terms, approval status
// or ingestion status, and it does not crawl or copy text.
//
// The same code serves the command line (`bun run check:sources`) and the
// in-process schedule that serve.ts starts, so a scheduled run and a manual one
// record exactly the same rows.
import { getDb } from "./db";

type Row = Record<string, any>;

const USER_AGENT = "UniversalWisdomLibrary/0.1 (source-availability check; contact: local operator)";

/** A source is due again this many days after its newest recorded check. */
export function checkIntervalDays(): number {
  const value = Number(process.env.UWL_CHECK_INTERVAL_DAYS ?? 30);
  return Number.isFinite(value) && value > 0 ? value : 30;
}

/** How long an open rights request may sit before it is called overdue. */
export const RIGHTS_REQUEST_ESCALATION_DAYS = 14;

export type DueSource = {
  sourceId: string;
  sourceName: string;
  url: string;
  priority: number;
  lastChecked: string | null;
};

/**
 * Approved sources whose newest recorded check is older than the interval, or
 * that have never been checked. Never-checked ones come first within a priority,
 * because a source nobody has looked at is the worse gap.
 */
export function dueSources(limit = 10, days = checkIntervalDays()): DueSource[] {
  const db = getDb();
  const rows = db
    .query(
      `SELECT r.source_id, r.source_name, r.base_url, r.priority,
              (SELECT MAX(c.checked_at) FROM source_checks c WHERE c.source_id = r.source_id) AS last_checked
         FROM source_registry r
        WHERE r.approval_status = 'approved'
          AND r.ingestion_status NOT IN ('restricted','unavailable')
          AND r.base_url <> ''
          AND (last_checked IS NULL OR datetime(last_checked) < datetime('now', ?))
        ORDER BY r.priority, last_checked IS NOT NULL, last_checked, r.source_name COLLATE NOCASE
        LIMIT ?`,
    )
    .all(`-${Math.round(days)} days`, limit) as Row[];
  return rows.map((r) => ({
    sourceId: String(r.source_id),
    sourceName: String(r.source_name),
    url: String(r.base_url),
    priority: Number(r.priority) || 3,
    lastChecked: r.last_checked ?? null,
  }));
}

/** One recorded availability check; returns whether the host answered. */
export async function checkSource(source: { sourceId: string; url: string }, timeoutMs = 10_000) {
  const db = getDb();
  let httpStatus: number | null = null;
  let status: "ok" | "error" = "error";
  let note = "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res = await fetch(source.url, {
      method: "HEAD",
      redirect: "follow",
      headers: { "user-agent": USER_AGENT },
      signal: controller.signal,
    });
    // Some servers reject HEAD even when the page is available.
    if (res.status === 405 || res.status === 501) {
      res = await fetch(source.url, {
        method: "GET",
        redirect: "follow",
        headers: { "user-agent": USER_AGENT, range: "bytes=0-2048" },
        signal: controller.signal,
      });
    }
    httpStatus = res.status;
    status = res.status >= 200 && res.status < 400 ? "ok" : "error";
    note = `Automated availability check: HTTP ${res.status}. This does not verify licence terms or permission to copy.`;
  } catch (err: any) {
    note = `Automated availability check failed: ${
      err?.name === "AbortError" ? `timeout after ${Math.round(timeoutMs / 1000)}s` : String(err?.message ?? err)
    }. No licence inference.`;
  } finally {
    clearTimeout(timer);
  }
  db.query(
    "INSERT INTO source_checks (source_id, method, status, http_status, notes) VALUES (?, 'http', ?, ?, ?)",
  ).run(source.sourceId, status, httpStatus, note);
  return { status, httpStatus };
}

export type VerificationRun = { checked: number; ok: number; failed: number };

/**
 * Check the sources that are due, one at a time and paced, so a scheduled run is
 * as polite as the command-line one.
 */
export async function runDueChecks(options: { limit?: number; days?: number; paceMs?: number } = {}): Promise<VerificationRun> {
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 10)));
  const days = options.days ?? checkIntervalDays();
  const paceMs = Math.max(0, options.paceMs ?? 1_500);
  const sources = dueSources(limit, days);
  let ok = 0;
  let failed = 0;
  for (const source of sources) {
    const result = await checkSource({ sourceId: source.sourceId, url: source.url });
    if (result.status === "ok") ok++;
    else failed++;
    if (paceMs) await Bun.sleep(paceMs);
  }
  return { checked: sources.length, ok, failed };
}

export type Attention = {
  sourcesTotal: number;
  sourcesDue: number;
  sourcesNeverChecked: number;
  rightsRequestsOpen: number;
  rightsRequestsOverdue: number;
  oldestOpenRequestDays: number | null;
  approvalsPending: { priority: number; count: number }[];
};

/**
 * What has gone unattended: sources past their check interval, and rights
 * requests nobody has answered. This is the escalation a deployment without a
 * mail server can act on — it is shown to editors and logged at start-up.
 */
export function attention(): Attention {
  const db = getDb();
  const counts = db
    .query(
      `SELECT (SELECT COUNT(*) FROM source_registry WHERE approval_status = 'approved') AS total,
              (SELECT COUNT(*) FROM source_checks) AS checks,
              (SELECT COUNT(*) FROM rights_requests WHERE status IN ('received','under_review')) AS open_requests,
              (SELECT COUNT(*) FROM rights_requests
                WHERE status IN ('received','under_review')
                  AND datetime(created_at) < datetime('now', ?)) AS overdue_requests,
              (SELECT CAST(julianday('now') - julianday(MIN(created_at)) AS INTEGER) FROM rights_requests
                WHERE status IN ('received','under_review')) AS oldest_days`,
    )
    .get(`-${RIGHTS_REQUEST_ESCALATION_DAYS} days`) as Row;
  const neverChecked = (
    db
      .query(
        `SELECT COUNT(*) AS n FROM source_registry r
          WHERE r.approval_status = 'approved'
            AND NOT EXISTS (SELECT 1 FROM source_checks c WHERE c.source_id = r.source_id)`,
      )
      .get() as Row
  ).n;
  const due = dueSources(500).length;
  const pending = db
    .query("SELECT priority, COUNT(*) AS n FROM source_registry WHERE approval_status = 'pending' GROUP BY priority ORDER BY priority")
    .all() as Row[];
  return {
    sourcesTotal: Number(counts.total) || 0,
    sourcesDue: due,
    sourcesNeverChecked: Number(neverChecked) || 0,
    rightsRequestsOpen: Number(counts.open_requests) || 0,
    rightsRequestsOverdue: Number(counts.overdue_requests) || 0,
    oldestOpenRequestDays: counts.oldest_days == null ? null : Number(counts.oldest_days),
    approvalsPending: pending.map((r) => ({ priority: Number(r.priority), count: Number(r.n) })),
  };
}
