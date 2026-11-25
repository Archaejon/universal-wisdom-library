import { getDb } from "./db";

export type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

export function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function fail(message: string, status = 400, code = "bad_request", extra: Record<string, unknown> = {}) {
  return json({ error: { code, message, ...extra } }, status);
}

export function safeText(value: unknown, max = 4000): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254;
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function intParam(url: URL, name: string, fallback: number, min = 0, max = 500): number {
  const raw = url.searchParams.get(name);
  const n = raw == null ? fallback : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// Counters live in the rate_limits table, not in a map: two server processes on
// the same database used to grant each caller the full allowance twice, and a
// restart reset every window. The upsert starts a new window when the old one
// has expired and otherwise increments, returning the count that now applies.
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const db = getDb();
  const now = Date.now();
  const row = db
    .query(
      `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN reset_at <= ? THEN 1 ELSE count + 1 END,
         reset_at = CASE WHEN reset_at <= ? THEN ? ELSE reset_at END
       RETURNING count`,
    )
    .get(key, now + windowMs, now, now, now + windowMs) as { count: number } | null;
  return (row?.count ?? 1) <= limit;
}

// The address Bun accepted the connection from. serve.ts records it here for
// every request; unlike a header it cannot be written by the caller.
const peerAddresses = new WeakMap<Request, string>();

export function setPeerAddress(req: Request, address: string | null | undefined): void {
  if (address) peerAddresses.set(req, address);
}

// Which peers may be believed when they set X-Forwarded-For. Off unless the
// operator names them: `1` (or `true`) trusts every peer, anything else is a
// comma-separated list of proxy addresses (UWL_TRUST_PROXY=127.0.0.1,::1).
function trustsForwardedFor(peer: string): boolean {
  const raw = (process.env.UWL_TRUST_PROXY ?? "").trim();
  if (!raw) return false;
  if (raw === "1" || raw === "true") return true;
  return raw.split(",").map((entry) => entry.trim()).includes(peer);
}

export function clientIp(req: Request): string {
  const peer = peerAddresses.get(req) ?? "local";
  if (!trustsForwardedFor(peer)) return peer;
  // Only the last entry is read. A proxy appends the address it received the
  // connection from, so everything to its left comes from the caller and would
  // let a forged header mint a fresh rate-limit bucket on every request.
  const hops = (req.headers.get("x-forwarded-for") ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  return hops.at(-1) ?? peer;
}

export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients; auth still requires a session cookie
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

/**
 * True when the request came straight from this machine: the connection's own
 * address is loopback and no proxy says it is forwarding someone else. Used to
 * let the person sitting at the desktop app change machine-wide settings.
 */
export function isLoopbackRequest(req: Request): boolean {
  const peer = peerAddresses.get(req);
  if (!peer) return false;
  const loopback = peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
  return loopback && !req.headers.get("x-forwarded-for") && !req.headers.get("forwarded");
}
