import { clearSessionCookie, createSession, destroySession, getUser, hashPassword, publicUser, requireAdmin, requireEditor, requireUser, sessionCookie, verifyPassword } from "./auth";
import type { User } from "./auth";
import { fail, isEmail, json, rateLimit, sameOrigin, safeText, clientIp } from "./util";
import { getBrowse, getHome, getProvenance, getProvenanceEditions, getSiteInfo, getTheme, getThemes, getTraditions, getWork, listWorks, facets, workOptions, getCuratedCollections } from "./library";
import { getCompare, getReader } from "./reader";
import { search, searchLive } from "./search";
import { listAcquisitionTargets } from "./acquisition";
import { ask, prepareSynthesis, releaseAssistantModel, synthesisResponse } from "./assistant";
import { ollamaConfig, ollamaStatus } from "./ollama";
import {
  addCollectionItem,
  createCollection,
  createNote,
  deleteCollection,
  deleteNote,
  getCollection,
  getStudy,
  listBookmarks,
  listCollections,
  listNotes,
  listProgress,
  listSubmissions,
  recordProgress,
  removeCollectionItem,
  reviewSubmission,
  submitCorrection,
  toggleBookmark,
  updateCollection,
  updateNote,
} from "./study";
import { getDb } from "./db";
import { addRegistrySource, getAdminSummary, getSource, listQueue, listRightsRequests, listSources, recordCheck, requestIngestion, reviewQueue, reviewRightsRequest, reviewSource, submitRightsRequest } from "./registry";
import { latestDuplicateReport } from "./duplicates";

const MAX_BODY = 64 * 1024;

async function readBody(req: Request): Promise<Record<string, any>> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    throw Object.assign(new Error("Expected application/json"), { status: 415 });
  }
  const text = await req.text();
  if (text.length > MAX_BODY) throw Object.assign(new Error("Request body too large"), { status: 413 });
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) throw new Error("invalid");
    return parsed;
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { status: 400 });
  }
}

function methodNotAllowed() {
  return fail("Method not allowed", 405, "method_not_allowed");
}

const REGISTRY_MESSAGES: Record<string, string> = {
  invalid_source_id: "Use a lowercase slug of letters, digits and hyphens, 2 to 63 characters long.",
  invalid_source_name: "Give the source a name between 2 and 200 characters.",
  notes_required: "Describe what the source holds and why it matters, in at least 10 characters.",
  invalid_priority: "Priority must be 1, 2 or 3.",
  invalid_url: "Enter a complete http or https address.",
  invalid_tradition: "That tradition is not in the catalogue.",
  invalid_language: "That language code is not in the registry's labels.",
  invalid_content_type: "Content types are lowercase slugs such as primary_text or translation.",
  source_exists: "A source with that ID already exists.",
};

function registryFailure(result: { error?: string; field?: string }) {
  const code = result.error ?? "bad_request";
  const status =
    code === "forbidden" ? 403
    : code === "not_found" || code === "source_not_found" ? 404
    : code === "not_approved" || code === "restricted" || code === "source_exists" ? 409
    : 400;
  const message = REGISTRY_MESSAGES[code] ?? code.replaceAll("_", " ");
  return fail(message, status, code, result.field ? { field: result.field } : {});
}

export async function api(req: Request, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method.toUpperCase();
  const isMutation = method !== "GET" && method !== "HEAD";
  if (isMutation && !sameOrigin(req)) {
    return fail("Cross-origin request rejected", 403, "cross_origin");
  }

  try {
    return await route(req, url, path, method);
  } catch (err: any) {
    if (err?.status) return fail(err.message, err.status, err.code ?? "error");
    console.error("API error:", err);
    return fail("Internal server error", 500, "internal_error");
  }
}

async function route(req: Request, url: URL, path: string, method: string): Promise<Response> {
  if (path === "/api/health" && method === "GET") {
    return json({ ok: true, service: "universal-wisdom-library" });
  }

  if (path === "/api/site" && method === "GET") return json(getSiteInfo());
  if (path === "/api/home" && method === "GET") return json(getHome());
  if (path === "/api/traditions" && method === "GET") return json({ traditions: getTraditions() });
  if (path === "/api/facets" && method === "GET") return json(facets());
  if (path === "/api/facets/works" && method === "GET") return json(workOptions(url.searchParams));
  if (path === "/api/library" && method === "GET") return json(listWorks(url.searchParams));
  if (path === "/api/browse" && method === "GET") return json(getBrowse(url.searchParams));
  if (path === "/api/search" && method === "GET") return json(await search(url.searchParams));
  if (path === "/api/search/live" && method === "GET") return json(await searchLive(url.searchParams));
  if (path === "/api/themes" && method === "GET") return json({ themes: getThemes() });
  if (path === "/api/compare" && method === "GET") {
    const result = await getCompare(url.searchParams, getUser(req));
    if ("error" in result) return result.error === "forbidden" ? fail("This collection is private", 403, "forbidden") : fail("Not found", 404, "not_found");
    return json(result);
  }
  if (path === "/api/provenance" && method === "GET") {
    return json(getProvenance());
  }
  if (path === "/api/provenance/editions" && method === "GET") {
    return json(getProvenanceEditions(url.searchParams));
  }
  if (path === "/api/collections/curated" && method === "GET") {
    return json({ collections: getCuratedCollections() });
  }

  if (path === "/api/sources" && method === "GET") {
    return json(listSources(url.searchParams));
  }
  if (path === "/api/acquisitions" && method === "GET") {
    return json(listAcquisitionTargets(url.searchParams));
  }
  const sourceMatch = path.match(/^\/api\/sources\/([^/]+)$/);
  if (sourceMatch && method === "GET") {
    const source = getSource(decodeURIComponent(sourceMatch[1]));
    return source ? json(source) : fail("Source not found", 404, "not_found");
  }

  if (path === "/api/rights-requests" && method === "POST") {
    if (!rateLimit(`rights-request:${clientIp(req)}`, 5, 60 * 60_000)) return fail("Too many requests. Try again later.", 429, "rate_limited");
    const body = await readBody(req);
    const kind = safeText(body.kind, 30);
    const contactEmail = safeText(body.contactEmail, 254).toLowerCase();
    const message = safeText(body.message, 5000);
    if (!["permission", "attribution", "takedown", "consultation", "metadata"].includes(kind)) {
      return fail("Choose a request type.", 400, "invalid_kind");
    }
    if (!isEmail(contactEmail)) return fail("Enter a valid contact email.", 400, "invalid_email");
    if (message.length < 30) return fail("Describe the request in at least 30 characters.", 400, "invalid_message");
    const result = submitRightsRequest({
      sourceId: safeText(body.sourceId, 120),
      workSlug: safeText(body.workSlug, 200),
      kind,
      contactName: safeText(body.contactName, 120),
      contactEmail,
      message,
    });
    if ("error" in result) return registryFailure(result);
    return json(result, 201);
  }

  if (path === "/api/admin/rights-requests" && method === "GET") {
    const user = requireEditor(req);
    const result = listRightsRequests(user);
    if ("error" in result) return fail("Editor access required", 403, "forbidden");
    return json(result);
  }
  const rightsReviewMatch = path.match(/^\/api\/admin\/rights-requests\/(\d+)\/review$/);
  if (rightsReviewMatch && method === "POST") {
    const user = requireEditor(req);
    const body = await readBody(req);
    const result = reviewRightsRequest(user, Number(rightsReviewMatch[1]), safeText(body.status, 30), safeText(body.note, 4000));
    if ("error" in result) return registryFailure(result);
    return json(result);
  }

  if (path === "/api/admin/summary" && method === "GET") {
    const user = requireEditor(req);
    const summary = getAdminSummary(user);
    if ("error" in summary) return fail("Editor access required", 403, "forbidden");
    return json(summary);
  }
  if (path === "/api/admin/sources" && method === "GET") {
    requireAdmin(req);
    return json(listSources(url.searchParams));
  }
  // A discovery is recorded, never approved: the new row starts as pending and
  // only an administrator can move it forward.
  if (path === "/api/admin/sources" && method === "POST") {
    const user = requireEditor(req);
    const body = await readBody(req);
    const list = (value: unknown, max: number) =>
      (Array.isArray(value) ? value : []).map((item) => safeText(item, max)).filter(Boolean);
    const result = addRegistrySource(user, {
      sourceId: safeText(body.sourceId, 63),
      sourceName: safeText(body.sourceName, 200),
      organisation: safeText(body.organisation, 200),
      baseUrl: safeText(body.baseUrl, 300),
      sourceType: safeText(body.sourceType, 120),
      accessMethod: safeText(body.accessMethod, 200),
      licenceUrl: safeText(body.licenceUrl, 300),
      licenceStatus: safeText(body.licenceStatus, 120),
      attributionRequirements: safeText(body.attributionRequirements, 2000),
      apiDocumentationUrl: safeText(body.apiDocumentationUrl, 300),
      downloadUrl: safeText(body.downloadUrl, 300),
      traditions: list(body.traditions, 60),
      languages: list(body.languages, 10),
      contentTypes: list(body.contentTypes, 40),
      priority: Number(body.priority ?? 3),
      reliabilityNotes: safeText(body.reliabilityNotes, 4000),
      editorialNotes: safeText(body.editorialNotes, 4000),
    });
    if ("error" in result) return registryFailure(result);
    return json(result, 201);
  }
  if (path === "/api/admin/duplicates" && method === "GET") {
    const user = requireEditor(req);
    if (user.role !== "editor" && user.role !== "admin") return fail("Editor access required", 403, "forbidden");
    return json({ ...latestDuplicateReport(), command: "bun run duplicates" });
  }
  const adminSourceMatch = path.match(/^\/api\/admin\/sources\/([^/]+)$/);
  if (adminSourceMatch && method === "PATCH") {
    const user = requireAdmin(req);
    const body = await readBody(req);
    const result = reviewSource(user, decodeURIComponent(adminSourceMatch[1]), {
      approvalStatus: body.approvalStatus,
      ingestionStatus: body.ingestionStatus,
      licenceStatus: body.licenceStatus == null ? undefined : safeText(body.licenceStatus, 80),
      reviewNote: body.reviewNote == null ? undefined : safeText(body.reviewNote, 4000),
      editorialNotes: body.editorialNotes == null ? undefined : safeText(body.editorialNotes, 8000),
      lastVerifiedAt: body.lastVerifiedAt == null ? undefined : safeText(body.lastVerifiedAt, 40),
    });
    if ("error" in result) return registryFailure(result);
    return json(result);
  }
  const checkMatch = path.match(/^\/api\/admin\/sources\/([^/]+)\/check$/);
  if (checkMatch && method === "POST") {
    const user = requireEditor(req);
    const body = await readBody(req);
    const result = recordCheck(user, decodeURIComponent(checkMatch[1]), {
      method: safeText(body.method, 20),
      status: safeText(body.status, 20),
      httpStatus: body.httpStatus,
      notes: safeText(body.notes, 2000),
      markVerified: !!body.markVerified,
    });
    if ("error" in result) return registryFailure(result);
    return json(result);
  }
  if (path === "/api/admin/queue" && method === "GET") {
    const user = requireEditor(req);
    const result = listQueue(user);
    if ("error" in result) return fail("Editor access required", 403, "forbidden");
    return json(result);
  }
  if (path === "/api/admin/queue" && method === "POST") {
    const user = requireEditor(req);
    const body = await readBody(req);
    const result = requestIngestion(
      user,
      safeText(body.sourceId, 120),
      safeText(body.adapter, 120),
      safeText(body.note, 2000),
    );
    if ("error" in result) return registryFailure(result);
    return json(result, 201);
  }
  const queueMatch = path.match(/^\/api\/admin\/queue\/(\d+)\/review$/);
  if (queueMatch && method === "POST") {
    const user = requireAdmin(req);
    const body = await readBody(req);
    const result = reviewQueue(user, Number(queueMatch[1]), safeText(body.action, 30), safeText(body.note, 2000));
    if ("error" in result) return registryFailure(result);
    return json(result);
  }

  const themeMatch = path.match(/^\/api\/themes\/([^/]+)$/);
  if (themeMatch && method === "GET") {
    const theme = getTheme(decodeURIComponent(themeMatch[1]));
    return theme ? json(theme) : fail("Theme not found", 404, "not_found");
  }

  const workMatch = path.match(/^\/api\/works\/([^/]+)$/);
  if (workMatch && method === "GET") {
    const work = getWork(decodeURIComponent(workMatch[1]));
    return work ? json(work) : fail("Work not found", 404, "not_found");
  }

  const readMatch = path.match(/^\/api\/read\/([^/]+)(?:\/([^/]+))?$/);
  if (readMatch && method === "GET") {
    const user = getUser(req);
    const result = await getReader(
      decodeURIComponent(readMatch[1]),
      readMatch[2] ? decodeURIComponent(readMatch[2]) : url.searchParams.get("ref") ?? undefined,
      url.searchParams.get("version") ?? undefined,
      user,
    );
    return result ? json(result) : fail("Work not found", 404, "not_found");
  }

  if (path === "/api/auth/me" && method === "GET") {
    const user = getUser(req);
    if (!user) return json({ user: null });
    const study = getStudy(user);
    return json({
      user: publicUser(user),
      counts: { bookmarks: study.bookmarks.length, notes: study.notes.length, collections: study.collections.filter((c: any) => !c.isCurated).length },
    });
  }

  if (path === "/api/auth/register" && method === "POST") {
    if (!rateLimit(`register:${clientIp(req)}`, 8, 60 * 60_000)) return fail("Too many attempts. Try again later.", 429, "rate_limited");
    const body = await readBody(req);
    const email = safeText(body.email, 254).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const displayName = safeText(body.displayName, 60);
    if (!isEmail(email)) return fail("Enter a valid email address.", 400, "invalid_email");
    if (password.length < 10 || password.length > 200) return fail("Use a password of at least 10 characters.", 400, "weak_password");
    if (displayName.length < 2) return fail("Display name must be at least 2 characters.", 400, "invalid_name");
    const db = getDb();
    if (db.query("SELECT id FROM users WHERE email = ?").get(email)) return fail("An account with that email already exists.", 409, "email_taken");
    const hash = await hashPassword(password);
    const result = db.query("INSERT INTO users (email, password_hash, display_name, role) VALUES (?, ?, ?, 'reader')").run(email, hash, displayName);
    const userId = Number(result.lastInsertRowid);
    const token = await createSession(userId);
    const user = db.query("SELECT id, email, display_name, role, created_at FROM users WHERE id = ?").get(userId) as User;
    return json({ user: publicUser(user) }, 201, { "set-cookie": sessionCookie(token) });
  }

  if (path === "/api/auth/login" && method === "POST") {
    if (!rateLimit(`login:${clientIp(req)}`, 12, 15 * 60_000)) return fail("Too many attempts. Try again later.", 429, "rate_limited");
    const body = await readBody(req);
    const email = safeText(body.email, 254).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const db = getDb();
    const row = db.query("SELECT * FROM users WHERE email = ?").get(email) as any;
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      return fail("Email or password is incorrect.", 401, "invalid_credentials");
    }
    const token = await createSession(row.id);
    const user = { id: row.id, email: row.email, display_name: row.display_name, role: row.role, created_at: row.created_at };
    return json({ user: publicUser(user) }, 200, { "set-cookie": sessionCookie(token) });
  }

  if (path === "/api/auth/logout" && method === "POST") {
    const cookie = req.headers.get("cookie") ?? "";
    const token = /uwl_session=([^;]+)/.exec(cookie)?.[1];
    destroySession(token);
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  }

  if (path === "/api/bookmarks" && method === "GET") {
    const user = requireUser(req);
    return json({ bookmarks: listBookmarks(user) });
  }
  if (path === "/api/bookmarks/toggle" && method === "POST") {
    const user = requireUser(req);
    const body = await readBody(req);
    const passageId = Number(body.passageId);
    if (!Number.isInteger(passageId)) return fail("passageId is required", 400, "invalid_input");
    const result = toggleBookmark(user, passageId);
    if ("error" in result) return fail("Passage not found", 404, "not_found");
    return json(result);
  }

  if (path === "/api/notes" && method === "GET") {
    const user = requireUser(req);
    return json({ notes: listNotes(user) });
  }
  if (path === "/api/notes" && method === "POST") {
    const user = requireUser(req);
    const body = await readBody(req);
    const passageId = Number(body.passageId);
    const text = safeText(body.body, 5000);
    if (!Number.isInteger(passageId) || text.length < 1) return fail("A passage and note body are required.", 400, "invalid_input");
    const editionId = body.editionId == null ? null : Number(body.editionId);
    const result = createNote(user, passageId, text, Number.isInteger(editionId) ? editionId : null);
    if ("error" in result) return fail("Passage not found", 404, "not_found");
    return json(result, 201);
  }
  const noteMatch = path.match(/^\/api\/notes\/(\d+)$/);
  if (noteMatch && (method === "PATCH" || method === "DELETE")) {
    const user = requireUser(req);
    const id = Number(noteMatch[1]);
    if (method === "DELETE") {
      const result = deleteNote(user, id);
      if ("error" in result) return result.error === "forbidden" ? fail("Not your note", 403, "forbidden") : fail("Note not found", 404, "not_found");
      return json(result);
    }
    const body = await readBody(req);
    const text = safeText(body.body, 5000);
    if (text.length < 1) return fail("Note body is required.", 400, "invalid_input");
    const result = updateNote(user, id, text);
    if ("error" in result) return result.error === "forbidden" ? fail("Not your note", 403, "forbidden") : fail("Note not found", 404, "not_found");
    return json(result);
  }

  if (path === "/api/collections" && method === "GET") {
    const user = requireUser(req);
    return json({ collections: listCollections(user) });
  }
  if (path === "/api/collections" && method === "POST") {
    const user = requireUser(req);
    const body = await readBody(req);
    const title = safeText(body.title, 120);
    if (title.length < 2) return fail("Give the collection a title.", 400, "invalid_title");
    const kind = ["reading_list", "comparison", "thematic"].includes(body.kind) ? body.kind : "reading_list";
    const items = Array.isArray(body.items)
      ? body.items
          .slice(0, 50)
          .filter((i: any) => Number.isInteger(Number(i.passageId)))
          .map((i: any) => ({ passageId: Number(i.passageId), annotation: safeText(i.annotation, 1000) }))
      : [];
    const result = createCollection(user, {
      title,
      description: safeText(body.description, 2000),
      kind,
      isPublic: !!body.isPublic,
      items,
    });
    if ("error" in result) return fail("Could not create collection", 400, "invalid_input");
    return json(result, 201);
  }
  const collectionMatch = path.match(/^\/api\/collections\/([^/]+)$/);
  if (collectionMatch && method === "GET") {
    const result = getCollection(getUser(req), decodeURIComponent(collectionMatch[1]));
    if ("error" in result) return result.error === "forbidden" ? fail("This collection is private", 403, "forbidden") : fail("Collection not found", 404, "not_found");
    return json(result);
  }
  if (collectionMatch && (method === "PATCH" || method === "DELETE")) {
    const user = requireUser(req);
    const id = Number(collectionMatch[1]);
    if (!Number.isInteger(id)) return fail("Invalid collection", 400, "invalid_input");
    if (method === "DELETE") {
      const result = deleteCollection(user, id);
      if ("error" in result) return result.error === "forbidden" ? fail("Not your collection", 403, "forbidden") : fail("Collection not found", 404, "not_found");
      return json(result);
    }
    const body = await readBody(req);
    const items = Array.isArray(body.items)
      ? body.items
          .slice(0, 50)
          .filter((i: any) => Number.isInteger(Number(i.passageId)))
          .map((i: any) => ({ passageId: Number(i.passageId), annotation: safeText(i.annotation, 1000) }))
      : undefined;
    const result = updateCollection(user, id, {
      title: body.title == null ? undefined : safeText(body.title, 120),
      description: body.description == null ? undefined : safeText(body.description, 2000),
      isPublic: body.isPublic == null ? undefined : !!body.isPublic,
      items,
    });
    if ("error" in result) return result.error === "forbidden" ? fail("Not your collection", 403, "forbidden") : fail("Collection not found", 404, "not_found");
    return json(result);
  }
  const collectionItemMatch = path.match(/^\/api\/collections\/(\d+)\/items(?:\/(\d+))?$/);
  if (collectionItemMatch && (method === "POST" || method === "DELETE")) {
    const user = requireUser(req);
    const id = Number(collectionItemMatch[1]);
    if (method === "POST") {
      const body = await readBody(req);
      const passageId = Number(body.passageId);
      if (!Number.isInteger(passageId)) return fail("passageId is required", 400, "invalid_input");
      const result = addCollectionItem(user, id, passageId, safeText(body.annotation, 1000));
      if ("error" in result) return result.error === "forbidden" ? fail("Not your collection", 403, "forbidden") : fail("Not found", 404, "not_found");
      return json(result);
    }
    const passageId = Number(collectionItemMatch[2]);
    if (!Number.isInteger(passageId)) return fail("passageId is required", 400, "invalid_input");
    const result = removeCollectionItem(user, id, passageId);
    if ("error" in result) return result.error === "forbidden" ? fail("Not your collection", 403, "forbidden") : fail("Not found", 404, "not_found");
    return json(result);
  }

  if (path === "/api/study" && method === "GET") {
    const user = requireUser(req);
    return json(getStudy(user));
  }

  if (path === "/api/progress" && method === "GET") {
    const user = requireUser(req);
    return json({ progress: listProgress(user) });
  }
  if (path === "/api/progress" && method === "POST") {
    const user = requireUser(req);
    const body = await readBody(req);
    const passageId = Number(body.passageId);
    if (!Number.isInteger(passageId)) return fail("passageId is required", 400, "invalid_input");
    const result = recordProgress(user, passageId);
    if ("error" in result) return fail("Passage not found", 404, "not_found");
    return json(result);
  }

  if (path === "/api/corrections" && method === "POST") {
    const user = requireUser(req);
    if (!rateLimit(`correction:${user.id}`, 10, 60 * 60_000)) return fail("Too many submissions. Try again later.", 429, "rate_limited");
    const body = await readBody(req);
    const targetType = safeText(body.targetType, 30);
    const kind = safeText(body.kind, 30);
    const message = safeText(body.message, 4000);
    if (!["passage", "work", "commentary", "edition"].includes(targetType)) return fail("Invalid target type", 400, "invalid_input");
    if (!["correction", "metadata", "annotation"].includes(kind)) return fail("Invalid submission type", 400, "invalid_input");
    if (message.length < 10) return fail("Describe the correction in at least 10 characters.", 400, "invalid_input");
    const result = submitCorrection(user, {
      targetType,
      targetId: safeText(body.targetId, 200),
      kind,
      message,
      proposedText: safeText(body.proposedText, 10000),
    });
    return json(result, 201);
  }

  if (path === "/api/editorial/submissions" && method === "GET") {
    const user = requireEditor(req);
    const result = listSubmissions(user);
    if ("error" in result) return fail("Editor access required", 403, "forbidden");
    return json(result);
  }
  const reviewMatch = path.match(/^\/api\/editorial\/submissions\/(\d+)\/review$/);
  if (reviewMatch && method === "POST") {
    const user = requireEditor(req);
    const body = await readBody(req);
    const action = safeText(body.action, 30);
    const note = safeText(body.note, 2000);
    const result = reviewSubmission(user, Number(reviewMatch[1]), action, note);
    if ("error" in result) return result.error === "forbidden" ? fail("Editor access required", 403, "forbidden") : result.error === "not_found" ? fail("Submission not found", 404, "not_found") : fail("Invalid action", 400, "invalid_action");
    return json(result);
  }

  if (path === "/api/assistant/engine" && method === "GET") {
    // Only read when a reader opens the local-model controls or retries; never
    // touched during page load or navigation.
    return json(await ollamaStatus(ollamaConfig(), { fresh: url.searchParams.get("fresh") === "1" }));
  }

  if (path === "/api/assistant/synthesise" && method === "POST") {
    const user = getUser(req);
    if (!rateLimit(`assistant:write:${user?.id ?? clientIp(req)}`, 12, 60_000)) {
      return fail("Too many generated answers. Try again in a minute.", 429, "rate_limited");
    }
    const body = await readBody(req);
    const question = safeText(body.question, 500);
    if (question.length < 3) return fail("Ask a question or enter a topic.", 400, "invalid_question");
    const plan = await prepareSynthesis(question, body.model);
    if ("error" in plan) return fail(plan.message, plan.status, plan.code);
    return synthesisResponse(plan, req.signal);
  }

  if (path === "/api/assistant/release" && method === "POST") {
    const body = await readBody(req);
    return json(await releaseAssistantModel(body.model));
  }

  if (path === "/api/assistant/ask" && method === "POST") {
    const user = getUser(req);
    if (!rateLimit(`assistant:${user?.id ?? clientIp(req)}`, 20, 60_000)) return fail("Too many questions. Try again in a minute.", 429, "rate_limited");
    const body = await readBody(req);
    const question = safeText(body.question, 500);
    if (question.length < 3) return fail("Ask a question or enter a topic.", 400, "invalid_question");
    return json(await ask(question, user));
  }

  if (path.startsWith("/api/")) return fail("API route not found", 404, "not_found");
  return fail("Method not allowed", 405, "method_not_allowed");
}
