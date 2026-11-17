export class ApiError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    credentials: "same-origin",
    headers: opts.body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  });
  let data: any = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError("The server returned an unreadable response.", res.status, "invalid_response");
  }
  if (!res.ok) {
    throw new ApiError(data?.error?.message ?? `Request failed (${res.status})`, res.status, data?.error?.code ?? "error");
  }
  return data as T;
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "" || v === false) continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return "";
  const then = new Date(iso.replace(" ", "T") + (iso.includes("Z") ? "" : "Z")).getTime();
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(then).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
