import { getDb } from "./db";
import type { User } from "./auth";

type Row = Record<string, any>;

export function toggleBookmark(user: User, passageId: number) {
  const db = getDb();
  const passage = db.query("SELECT id, work_id FROM passages WHERE id = ?").get(passageId) as Row | null;
  if (!passage) return { error: "passage_not_found" as const };
  const existing = db.query("SELECT id FROM bookmarks WHERE user_id = ? AND passage_id = ?").get(user.id, passageId) as Row | null;
  if (existing) {
    db.query("DELETE FROM bookmarks WHERE id = ?").run(existing.id);
    return { bookmarked: false };
  }
  db.query("INSERT INTO bookmarks (user_id, passage_id) VALUES (?, ?)").run(user.id, passageId);
  return { bookmarked: true };
}

export function listBookmarks(user: User) {
  return (getDb()
    .query(
      `SELECT b.id, b.created_at, p.id AS passage_id, p.reference, p.label, w.slug AS work_slug, w.title AS work_title,
              t.name AS tradition_name, t.slug AS tradition_slug
       FROM bookmarks b JOIN passages p ON p.id = b.passage_id JOIN works w ON w.id = p.work_id
       JOIN traditions t ON t.id = w.tradition_id WHERE b.user_id = ? ORDER BY b.created_at DESC`,
    )
    .all(user.id) as Row[]).map((r) => ({
      id: r.id, passageId: r.passage_id, reference: r.reference, label: r.label,
      work: { slug: r.work_slug, title: r.work_title }, tradition: { slug: r.tradition_slug, name: r.tradition_name },
      createdAt: r.created_at,
    }));
}

export function createNote(user: User, passageId: number, body: string, editionId: number | null) {
  const db = getDb();
  const passage = db.query("SELECT id FROM passages WHERE id = ?").get(passageId) as Row | null;
  if (!passage) return { error: "passage_not_found" as const };
  const res = db
    .query("INSERT INTO notes (user_id, passage_id, edition_id, body, is_private) VALUES (?, ?, ?, ?, 1)")
    .run(user.id, passageId, editionId, body);
  return { id: Number(res.lastInsertRowid) };
}

export function updateNote(user: User, id: number, body: string) {
  const note = getDb().query("SELECT id, user_id FROM notes WHERE id = ?").get(id) as Row | null;
  if (!note) return { error: "not_found" as const };
  if (note.user_id !== user.id) return { error: "forbidden" as const };
  getDb().query("UPDATE notes SET body = ?, updated_at = datetime('now') WHERE id = ?").run(body, id);
  return { ok: true };
}

export function deleteNote(user: User, id: number) {
  const note = getDb().query("SELECT id, user_id FROM notes WHERE id = ?").get(id) as Row | null;
  if (!note) return { error: "not_found" as const };
  if (note.user_id !== user.id) return { error: "forbidden" as const };
  getDb().query("DELETE FROM notes WHERE id = ?").run(id);
  return { ok: true };
}

export function listNotes(user: User) {
  return (getDb()
    .query(
      `SELECT n.id, n.body, n.is_private, n.created_at, n.updated_at, p.id AS passage_id, p.reference, p.label,
              w.slug AS work_slug, w.title AS work_title, t.name AS tradition_name, t.slug AS tradition_slug
       FROM notes n JOIN passages p ON p.id = n.passage_id JOIN works w ON w.id = p.work_id
       JOIN traditions t ON t.id = w.tradition_id WHERE n.user_id = ? ORDER BY n.updated_at DESC`,
    )
    .all(user.id) as Row[]).map((r) => ({
      id: r.id, body: r.body, isPrivate: !!r.is_private, createdAt: r.created_at, updatedAt: r.updated_at,
      passageId: r.passage_id, reference: r.reference, label: r.label,
      work: { slug: r.work_slug, title: r.work_title }, tradition: { slug: r.tradition_slug, name: r.tradition_name },
    }));
}

function collectionSummary(c: Row) {
  const items = getDb()
    .query(
      `SELECT ci.position, ci.annotation, p.id AS passage_id, p.reference, p.label, w.slug AS work_slug, w.title AS work_title,
              t.name AS tradition_name
       FROM collection_items ci JOIN passages p ON p.id = ci.passage_id JOIN works w ON w.id = p.work_id
       JOIN traditions t ON t.id = w.tradition_id WHERE ci.collection_id = ? ORDER BY ci.position`,
    )
    .all(c.id) as Row[];
  return {
    id: c.id, title: c.title, description: c.description, kind: c.kind, isPublic: !!c.is_public,
    shareToken: c.share_token, curator: c.curator, isCurated: !!c.is_curated, createdAt: c.created_at, updatedAt: c.updated_at,
    itemCount: items.length,
    items: items.map((i) => ({
      passageId: i.passage_id, reference: i.reference, label: i.label, annotation: i.annotation,
      work: { slug: i.work_slug, title: i.work_title }, tradition: i.tradition_name,
    })),
  };
}

export function listCollections(user: User) {
  return (getDb()
    .query("SELECT * FROM collections WHERE user_id = ? ORDER BY updated_at DESC")
    .all(user.id) as Row[]).map(collectionSummary);
}

export function getCollection(user: User | null, idOrToken: string) {
  const db = getDb();
  const numeric = /^\d+$/.test(idOrToken);
  const c = db
    .query(`SELECT * FROM collections WHERE ${numeric ? "id = ?" : "share_token = ?"}`)
    .get(numeric ? Number(idOrToken) : idOrToken) as Row | null;
  if (!c) return { error: "not_found" as const };
  const owner = !!user && c.user_id === user.id;
  if (!c.is_public && !owner) return { error: "forbidden" as const };
  return { collection: collectionSummary(c), owner };
}

export function createCollection(
  user: User,
  input: { title: string; description: string; kind: "reading_list" | "comparison" | "thematic"; isPublic: boolean; items: { passageId: number; annotation?: string }[] },
) {
  const db = getDb();
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(9))).toString("hex");
  const collection = db
    .query("INSERT INTO collections (user_id, title, description, kind, is_public, share_token) VALUES (?, ?, ?, ?, ?, ?)")
    .run(user.id, input.title, input.description, input.kind, input.isPublic ? 1 : 0, token);
  const id = Number(collection.lastInsertRowid);
  for (const [i, item] of input.items.entries()) {
    const passage = db.query("SELECT id FROM passages WHERE id = ?").get(item.passageId) as Row | null;
    if (!passage) continue;
    db.query("INSERT OR IGNORE INTO collection_items (collection_id, passage_id, position, annotation) VALUES (?, ?, ?, ?)").run(
      id, item.passageId, i, item.annotation ?? "",
    );
  }
  return getCollection(user, String(id));
}

export function updateCollection(
  user: User,
  id: number,
  patch: { title?: string; description?: string; isPublic?: boolean; items?: { passageId: number; annotation?: string }[] },
) {
  const db = getDb();
  const c = db.query("SELECT * FROM collections WHERE id = ?").get(id) as Row | null;
  if (!c) return { error: "not_found" as const };
  if (c.user_id !== user.id) return { error: "forbidden" as const };
  if (patch.title != null) db.query("UPDATE collections SET title = ?, updated_at = datetime('now') WHERE id = ?").run(patch.title, id);
  if (patch.description != null) db.query("UPDATE collections SET description = ?, updated_at = datetime('now') WHERE id = ?").run(patch.description, id);
  if (patch.isPublic != null) db.query("UPDATE collections SET is_public = ?, updated_at = datetime('now') WHERE id = ?").run(patch.isPublic ? 1 : 0, id);
  if (patch.items) {
    db.query("DELETE FROM collection_items WHERE collection_id = ?").run(id);
    for (const [i, item] of patch.items.entries()) {
      const passage = db.query("SELECT id FROM passages WHERE id = ?").get(item.passageId) as Row | null;
      if (!passage) continue;
      db.query("INSERT OR IGNORE INTO collection_items (collection_id, passage_id, position, annotation) VALUES (?, ?, ?, ?)").run(
        id, item.passageId, i, item.annotation ?? "",
      );
    }
    db.query("UPDATE collections SET updated_at = datetime('now') WHERE id = ?").run(id);
  }
  return getCollection(user, String(id));
}

export function deleteCollection(user: User, id: number) {
  const db = getDb();
  const c = db.query("SELECT user_id FROM collections WHERE id = ?").get(id) as Row | null;
  if (!c) return { error: "not_found" as const };
  if (c.user_id !== user.id) return { error: "forbidden" as const };
  db.query("DELETE FROM collections WHERE id = ?").run(id);
  return { ok: true };
}

export function addCollectionItem(user: User, id: number, passageId: number, annotation: string) {
  const db = getDb();
  const c = db.query("SELECT user_id FROM collections WHERE id = ?").get(id) as Row | null;
  if (!c) return { error: "not_found" as const };
  if (c.user_id !== user.id) return { error: "forbidden" as const };
  const passage = db.query("SELECT id FROM passages WHERE id = ?").get(passageId) as Row | null;
  if (!passage) return { error: "passage_not_found" as const };
  const pos = (db.query("SELECT COALESCE(MAX(position), -1) + 1 AS n FROM collection_items WHERE collection_id = ?").get(id) as Row).n;
  db.query("INSERT OR IGNORE INTO collection_items (collection_id, passage_id, position, annotation) VALUES (?, ?, ?, ?)").run(
    id, passageId, pos, annotation,
  );
  db.query("UPDATE collections SET updated_at = datetime('now') WHERE id = ?").run(id);
  return { ok: true };
}

export function removeCollectionItem(user: User, id: number, passageId: number) {
  const db = getDb();
  const c = db.query("SELECT user_id FROM collections WHERE id = ?").get(id) as Row | null;
  if (!c) return { error: "not_found" as const };
  if (c.user_id !== user.id) return { error: "forbidden" as const };
  db.query("DELETE FROM collection_items WHERE collection_id = ? AND passage_id = ?").run(id, passageId);
  db.query("UPDATE collections SET updated_at = datetime('now') WHERE id = ?").run(id);
  return { ok: true };
}

export function recordProgress(user: User, passageId: number) {
  const db = getDb();
  const passage = db.query("SELECT id, work_id, sort_order FROM passages WHERE id = ?").get(passageId) as Row | null;
  if (!passage) return { error: "passage_not_found" as const };
  const total = (db.query("SELECT COUNT(*) AS n FROM passages WHERE work_id = ?").get(passage.work_id) as Row).n;
  const percent = total ? Math.min(100, Math.round(((passage.sort_order + 1) / total) * 100)) : 0;
  db.query(
    `INSERT INTO reading_progress (user_id, work_id, passage_id, percent, last_viewed_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, work_id) DO UPDATE SET passage_id = excluded.passage_id, percent = excluded.percent, last_viewed_at = datetime('now')`,
  ).run(user.id, passage.work_id, passage.id, percent);
  return { percent };
}

export function listProgress(user: User) {
  return (getDb()
    .query(
      `SELECT rp.percent, rp.last_viewed_at, w.slug AS work_slug, w.title AS work_title, p.reference, p.label,
              t.name AS tradition_name
       FROM reading_progress rp JOIN works w ON w.id = rp.work_id JOIN traditions t ON t.id = w.tradition_id
       LEFT JOIN passages p ON p.id = rp.passage_id WHERE rp.user_id = ? ORDER BY rp.last_viewed_at DESC`,
    )
    .all(user.id) as Row[]).map((r) => ({
      percent: r.percent, lastViewedAt: r.last_viewed_at,
      work: { slug: r.work_slug, title: r.work_title, tradition: r.tradition_name },
      passage: r.reference ? { reference: r.reference, label: r.label } : null,
    }));
}

export function getStudy(user: User) {
  return {
    bookmarks: listBookmarks(user),
    notes: listNotes(user),
    collections: listCollections(user),
    progress: listProgress(user),
    privacy: {
      notes: "Private by default. Notes are returned only to their owner; there is no public notes endpoint.",
      collections: "Collections are private unless explicitly made public. Public collections are readable by anyone with the link.",
    },
  };
}

export function submitCorrection(
  user: User,
  input: { targetType: string; targetId: string; kind: string; message: string; proposedText: string },
) {
  const db = getDb();
  const res = db
    .query(
      "INSERT INTO editorial_submissions (user_id, target_type, target_id, kind, message, proposed_text) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(user.id, input.targetType, input.targetId, input.kind, input.message, input.proposedText);
  return { id: Number(res.lastInsertRowid), status: "pending" };
}

export function listSubmissions(user: User) {
  if (user.role !== "editor" && user.role !== "admin") return { error: "forbidden" as const };
  const rows = getDb()
    .query(
      `SELECT s.*, u.display_name AS submitter, u.email AS submitter_email
       FROM editorial_submissions s JOIN users u ON u.id = s.user_id ORDER BY
       CASE s.status WHEN 'pending' THEN 0 ELSE 1 END, s.created_at DESC LIMIT 100`,
    )
    .all() as Row[];
  return {
    submissions: rows.map((s) => ({
      id: s.id, targetType: s.target_type, targetId: s.target_id, kind: s.kind, message: s.message,
      proposedText: s.proposed_text, status: s.status, createdAt: s.created_at, reviewedAt: s.reviewed_at,
      reviewNote: s.review_note, submitter: s.submitter,
    })),
  };
}

export function reviewSubmission(user: User, id: number, action: string, note: string) {
  if (user.role !== "editor" && user.role !== "admin") return { error: "forbidden" as const };
  if (!["accepted", "rejected", "needs_discussion"].includes(action)) return { error: "invalid_action" as const };
  const db = getDb();
  const s = db.query("SELECT * FROM editorial_submissions WHERE id = ?").get(id) as Row | null;
  if (!s) return { error: "not_found" as const };
  db.query(
    "UPDATE editorial_submissions SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), review_note = ? WHERE id = ?",
  ).run(action, user.id, note, id);
  if (action === "accepted") {
    db.query("INSERT INTO revisions (entity_type, entity_id, snapshot_json, editor_id, note) VALUES (?, ?, ?, ?, ?)").run(
      s.target_type, s.target_id, JSON.stringify({ submission: s, decision: action, note }), user.id,
      "Accepted editorial correction. Applied through reviewed revision; source text is never overwritten automatically.",
    );
  }
  return { ok: true, status: action };
}
