import { getDb } from "./db";
import { parseCookies } from "./util";

export const SESSION_COOKIE = "uwl_session";
const SESSION_DAYS = 30;

export type User = {
  id: number;
  email: string;
  display_name: string;
  role: "reader" | "editor" | "admin";
  created_at: string;
};

function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

function cookieSecure(): boolean {
  return process.env.UWL_SECURE_COOKIES === "1";
}

export function sessionCookie(token: string, maxAge = SESSION_DAYS * 86400): string {
  const bits = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (cookieSecure()) bits.push("Secure");
  return bits.join("; ");
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecure() ? "; Secure" : ""}`;
}

export async function createSession(userId: number): Promise<string> {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  getDb()
    .query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(hashToken(token), userId, expires);
  return token;
}

export function destroySession(token: string | undefined) {
  if (!token) return;
  getDb().query("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function getUser(req: Request): User | null {
  const token = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
  if (!token) return null;
  const db = getDb();
  const row = db
    .query(
      `SELECT u.id, u.email, u.display_name, u.role, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
    )
    .get(hashToken(token)) as User | null;
  return row ?? null;
}

export function requireUser(req: Request): User {
  const user = getUser(req);
  if (!user) {
    const err = new Error("Authentication required") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  return user;
}

export function requireEditor(req: Request): User {
  const user = requireUser(req);
  if (user.role !== "editor" && user.role !== "admin") {
    const err = new Error("Editorial permission required") as Error & { status?: number };
    err.status = 403;
    throw err;
  }
  return user;
}

export function requireAdmin(req: Request): User {
  const user = requireUser(req);
  if (user.role !== "admin") {
    const err = new Error("Administrator permission required") as Error & { status?: number };
    err.status = 403;
    throw err;
  }
  return user;
}

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    return false;
  }
}

export function publicUser(user: User) {
  return {
    id: user.id,
    displayName: user.display_name,
    email: user.email,
    role: user.role,
    createdAt: user.created_at,
  };
}
