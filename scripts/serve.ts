import { join, normalize, sep } from "node:path";
import { existsSync } from "node:fs";
import { api } from "../server/api";
import { DB_PATH, getDb, isSeeded, migrate } from "../server/db";
import { setPeerAddress } from "../server/util";

const ROOT = join(import.meta.dir, "..");
// The built client. The desktop app unpacks its embedded copy elsewhere and
// points here with UWL_PUBLIC_DIR.
const PUBLIC = process.env.UWL_PUBLIC_DIR || join(ROOT, "public");
const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? "127.0.0.1";
const IS_PROD = process.env.NODE_ENV === "production";

migrate();

if (!isSeeded()) {
  console.log("Empty database detected; importing the demonstration corpus…");
  const { seedDatabase } = await import("../ingest/pipeline");
  const { imported, issues } = seedDatabase();
  const errors = issues.filter((i) => i.severity === "error");
  console.log(`Seeded ${imported.works} works, ${imported.passages} passages, ${imported.texts} texts.`);
  if (errors.length) {
    console.error("Corpus import produced errors:");
    for (const e of errors) console.error(` - ${e.message}`);
  }
} else {
  // Importer manifests written since the last seed are filed as import runs so
  // the provenance page shows them; files already recorded are skipped unread.
  const { recordImportManifests } = await import("../ingest/pipeline");
  const recorded = recordImportManifests();
  if (recorded) console.log(`Recorded ${recorded} import manifest(s) for the provenance page.`);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function securityHeaders(headers: Headers, path: string) {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join("; "),
  );
  if (path.startsWith("/assets/")) headers.set("Cache-Control", "public, max-age=31536000, immutable");
  else if (path.startsWith("/api/")) headers.set("Cache-Control", "no-store");
  else headers.set("Cache-Control", "no-cache");
}

function fileResponse(filePath: string, path: string, status = 200, head = false): Response {
  const file = Bun.file(filePath);
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const headers = new Headers({
    "content-type": MIME[ext] ?? "application/octet-stream",
    "content-length": String(file.size),
  });
  securityHeaders(headers, path);
  return new Response(head ? null : file, { status, headers });
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  idleTimeout: 30,
  async fetch(req, srv) {
    // Record the connection's own address before anything reads a header, so
    // rate limits key on the peer rather than on a value the caller supplies.
    setPeerAddress(req, srv.requestIP(req)?.address);
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/api" || path.startsWith("/api/")) {
      try {
        const res = await api(req, url);
        const headers = new Headers(res.headers);
        securityHeaders(headers, path);
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
      } catch (err) {
        console.error("Unhandled API failure:", err);
        const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
        securityHeaders(headers, path);
        return new Response(JSON.stringify({ error: { code: "internal_error", message: "Internal server error" } }), {
          status: 500,
          headers,
        });
      }
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      const headers = new Headers({ "content-type": "text/plain; charset=utf-8" });
      securityHeaders(headers, path);
      return new Response("Method not allowed", { status: 405, headers });
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const relative = normalize(decoded).replace(/^([/\\])+/, "");
    const candidate = join(PUBLIC, relative);
    if (!candidate.startsWith(PUBLIC + sep) && candidate !== PUBLIC) {
      return new Response("Not found", { status: 404 });
    }

    if (relative && !relative.endsWith("/")) {
      const file = Bun.file(candidate);
      if (await file.exists()) {
        const stat = await file.stat();
        if (stat.isFile()) return fileResponse(candidate, path, 200, req.method === "HEAD");
      }
    }

    // SPA fallback: known page routes and extensionless paths load the app shell.
    if (!relative.includes(".")) {
      const index = join(PUBLIC, "index.html");
      if (existsSync(index)) return fileResponse(index, path, 200, req.method === "HEAD");
      return new Response("The client has not been built. Run: bun run build", { status: 503 });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Universal Wisdom Library listening at http://${HOST}:${server.port} (${IS_PROD ? "production" : "development"})`);
console.log(`Database: ${DB_PATH}`);

// The availability check used to be a script nobody ran. It now runs here, on the
// schedule the registry needs: the first pass shortly after start-up, then every
// UWL_CHECK_INTERVAL_HOURS (12 by default). Only sources that are due are
// checked, so a run is usually a handful of requests. UWL_CHECK_SCHEDULE=off
// disables it, and a failing host never stops the server.
if (process.env.UWL_CHECK_SCHEDULE !== "off" && process.env.NODE_ENV !== "test") {
  const { attention, runDueChecks, RIGHTS_REQUEST_ESCALATION_DAYS } = await import("../server/verification");
  const intervalHours = Math.max(1, Number(process.env.UWL_CHECK_INTERVAL_HOURS ?? 12));
  const tick = async () => {
    try {
      const state = attention();
      if (state.rightsRequestsOverdue > 0) {
        console.warn(
          `Escalation: ${state.rightsRequestsOverdue} rights request(s) open for more than ${RIGHTS_REQUEST_ESCALATION_DAYS} days` +
            (state.oldestOpenRequestDays != null ? ` (oldest ${state.oldestOpenRequestDays} days).` : "."),
        );
      }
      if (!state.sourcesDue) return;
      const run = await runDueChecks({ limit: 5 });
      if (run.checked) {
        console.log(`Source availability: checked ${run.checked} due source(s), ${run.ok} answered, ${run.failed} did not.`);
      }
    } catch (err) {
      console.error("Scheduled source check failed:", err);
    }
  };
  setTimeout(tick, 15_000);
  setInterval(tick, intervalHours * 60 * 60_000);
}

const shutdown = () => {
  console.log("\nShutting down…");
  try { getDb().close(); } catch {}
  server.stop(true);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
