import { getDb } from "./db";

type Row = Record<string, any>;

export type AcquisitionTarget = {
  slug: string;
  title: string;
  originalTitle: string;
  transliteration: string;
  author: string;
  tradition: string;
  school: string;
  genre: string;
  category: string;
  status: string;
  priority: number;
  languages: string[];
  sourceLeads: { source: string; url: string; note: string }[];
  rightsNote: string;
  note: string;
};

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function mapRow(r: Row): AcquisitionTarget {
  return {
    slug: r.slug,
    title: r.title,
    originalTitle: r.original_title,
    transliteration: r.transliteration,
    author: r.author,
    tradition: r.tradition,
    school: r.school,
    genre: r.genre,
    category: r.category,
    status: r.status,
    priority: r.priority,
    languages: parseJson<string[]>(r.languages_json, []),
    sourceLeads: parseJson<{ source: string; url: string; note: string }[]>(r.source_leads_json, []),
    rightsNote: r.rights_note,
    note: r.note,
  };
}

export function listAcquisitionTargets(params: URLSearchParams): {
  targets: AcquisitionTarget[];
  total: number;
  stats: { wanted: number; located: number; rightsBlocked: number; imported: number };
  note: string;
} {
  const db = getDb();
  const clauses: string[] = [];
  const args: any[] = [];
  if (params.get("status")) {
    clauses.push("status = ?");
    args.push(params.get("status"));
  }
  if (params.get("tradition")) {
    clauses.push("tradition = ?");
    args.push(params.get("tradition"));
  }
  const q = (params.get("q") ?? "").trim();
  if (q) {
    const like = `%${q}%`;
    clauses.push("(title LIKE ? OR original_title LIKE ? OR transliteration LIKE ? OR author LIKE ? OR note LIKE ?)");
    args.push(like, like, like, like, like);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .query(
      `SELECT * FROM acquisition_targets${where}
       ORDER BY CASE status WHEN 'wanted' THEN 0 WHEN 'located' THEN 1 WHEN 'rights_blocked' THEN 2 ELSE 3 END,
                priority, title`,
    )
    .all(...args) as Row[];
  const counts = db
    .query("SELECT status, COUNT(*) AS n FROM acquisition_targets GROUP BY status")
    .all() as Row[];
  const stats = { wanted: 0, located: 0, rightsBlocked: 0, imported: 0 };
  for (const row of counts) {
    if (row.status === "wanted") stats.wanted = row.n;
    else if (row.status === "located") stats.located = row.n;
    else if (row.status === "rights_blocked") stats.rightsBlocked = row.n;
    else if (row.status === "imported") stats.imported = row.n;
  }
  return {
    targets: rows.map(mapRow),
    total: rows.length,
    stats,
    note:
      "These are acquisition targets, not editions. A lead records where a text might be found; it does not mean the text has been verified or licensed. Imported targets stay here with their status so the editorial trail is not lost.",
  };
}
