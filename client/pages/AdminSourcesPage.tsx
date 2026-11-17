import { useEffect, useState } from "react";
import { Link } from "../router";
import { api } from "../api";
import { useAuth } from "../auth";
import { Badge, ErrorState, Icon, Loading, PageIntro, useToast } from "../components";
import { statusTone } from "./SourcesPage";

const STATUS_LABELS: Record<string, string> = {
  active: "Active import",
  import_tested: "Import tested",
  connected: "Connected",
  licence_verified: "Licence verified",
  ready_for_integration: "Ready for integration",
  under_review: "Under review",
  discovered: "Discovered",
  restricted: "Restricted",
  unavailable: "Unavailable",
};

const EMPTY_INTAKE = {
  sourceId: "",
  sourceName: "",
  organisation: "",
  baseUrl: "",
  apiDocumentationUrl: "",
  sourceType: "",
  accessMethod: "",
  licenceUrl: "",
  licenceStatus: "not_verified",
  attributionRequirements: "",
  priority: 3,
  traditions: [] as string[],
  languages: [] as string[],
  contentTypes: [] as string[],
  reliabilityNotes: "",
  editorialNotes: "",
};

export function AdminSourcesPage() {
  const { user, loading: authLoading } = useAuth();
  const { push } = useToast();
  const [summary, setSummary] = useState<any>(null);
  const [sources, setSources] = useState<any[] | null>(null);
  const [facets, setFacets] = useState<any>(null);
  const [queue, setQueue] = useState<any[] | null>(null);
  const [rights, setRights] = useState<any[] | null>(null);
  const [duplicates, setDuplicates] = useState<any>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"overview" | "approvals" | "queue" | "rights" | "discover" | "duplicates">("overview");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [queueNotes, setQueueNotes] = useState<Record<number, string>>({});
  const [rightsNotes, setRightsNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [intake, setIntake] = useState({ ...EMPTY_INTAKE });
  const [createdSource, setCreatedSource] = useState<string | null>(null);

  const isAdmin = user?.role === "admin";
  const isEditor = user?.role === "editor" || isAdmin;

  const load = async () => {
    if (!isEditor) return;
    setError("");
    try {
      const [s, q, rr] = await Promise.all([
        api<any>("/api/admin/summary"),
        api<any>("/api/admin/queue"),
        api<any>("/api/admin/rights-requests"),
      ]);
      setSummary(s);
      setQueue(q.queue);
      setRights(rr.requests);
      const [src, dup] = await Promise.all([
        api<any>(isAdmin ? "/api/admin/sources?approval=pending&pageSize=50&sort=priority" : "/api/sources?approval=pending&pageSize=50&sort=priority"),
        api<any>("/api/admin/duplicates").catch(() => null),
      ]);
      setSources(src.sources);
      setFacets(src.facets);
      setDuplicates(dup);
      setStatuses(Object.fromEntries(src.sources.map((x: any) => [x.sourceId, x.ingestionStatus])));
    } catch (e: any) { setError(e.message); }
  };

  const submitIntake = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("intake");
    setCreatedSource(null);
    try {
      const result = await api<any>("/api/admin/sources", { method: "POST", body: intake });
      setCreatedSource(result.sourceId);
      setIntake({ ...EMPTY_INTAKE });
      if (result.warning) push(result.warning, "error");
      else push("Source recorded for review.", "success");
      await load();
    } catch (err: any) { push(err.message, "error"); } finally { setBusy(null); }
  };

  useEffect(() => { load(); }, [user?.role]);

  const reviewSource = async (sourceId: string, approvalStatus: string) => {
    if (!isAdmin) return;
    setBusy(sourceId);
    try {
      await api(`/api/admin/sources/${encodeURIComponent(sourceId)}`, {
        method: "PATCH",
        body: {
          approvalStatus,
          ingestionStatus: statuses[sourceId],
          reviewNote: notes[sourceId] || "",
          lastVerifiedAt: approvalStatus === "approved" ? new Date().toISOString().slice(0, 10) : undefined,
        },
      });
      push(`Source ${approvalStatus}.`, "success");
      await load();
    } catch (e: any) { push(e.message, "error"); } finally { setBusy(null); }
  };

  const reviewRights = async (id: number, status: string) => {
    setBusy(`r${id}`);
    try {
      await api(`/api/admin/rights-requests/${id}/review`, { method: "POST", body: { status, note: rightsNotes[id] || "" } });
      push(`Rights request marked ${status.replaceAll("_", " ")}.`, "success");
      await load();
    } catch (e: any) { push(e.message, "error"); } finally { setBusy(null); }
  };

  const reviewQueue = async (id: number, action: string) => {
    if (!isAdmin) return;
    setBusy(`q${id}`);
    try {
      await api(`/api/admin/queue/${id}/review`, { method: "POST", body: { action, note: queueNotes[id] || "" } });
      push(`Import request marked ${action}.`, "success");
      await load();
    } catch (e: any) { push(e.message, "error"); } finally { setBusy(null); }
  };

  if (authLoading) return <div className="container page"><Loading label="Checking permissions" /></div>;
  if (!user) {
    return (
      <div className="container page">
        <div className="empty-panel">
          <h3>Sign in with an editor or administrator account.</h3>
          <p>The registry workflow is permissioned. Reader accounts can submit corrections through the editorial page.</p>
          <Link className="button primary" to="/account?next=%2Fadmin%2Fsources">Sign in</Link>
        </div>
      </div>
    );
  }
  if (!isEditor) {
    return (
      <div className="container page">
        <div className="empty-panel">
          <h3>Editor access required.</h3>
          <p>Your account is a reader account. Source approval and import queues are restricted to editors and administrators.</p>
          <Link className="button" to="/sources">Browse the public registry</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container page admin-page">
      <PageIntro
        eyebrow="Registry administration"
        title="Source approvals &amp; ingestion"
        lede="Discovery is not approval, and approval is not publication. This queue records decisions without importing or publishing text."
      >
        <div className="button-row">
          <Link className="button" to="/sources">Public registry</Link>
          <Link className="button ghost" to="/provenance">Import log</Link>
          {isAdmin && <Badge tone="accent">Administrator</Badge>}
          {!isAdmin && <Badge tone="muted">Editor — read-only approvals</Badge>}
        </div>
      </PageIntro>

      {error && <ErrorState message={error} onRetry={load} />}

      <div className="tab-row page-tabs" role="tablist">
        <button className={tab === "overview" ? "tab active" : "tab"} onClick={() => setTab("overview")}>Overview</button>
        <button className={tab === "approvals" ? "tab active" : "tab"} onClick={() => setTab("approvals")}>Pending approvals {sources ? `(${sources.length})` : ""}</button>
        <button className={tab === "queue" ? "tab active" : "tab"} onClick={() => setTab("queue")}>Ingestion queue {queue ? `(${queue.filter((q) => q.status === "pending").length} pending)` : ""}</button>
        <button className={tab === "rights" ? "tab active" : "tab"} onClick={() => setTab("rights")}>Rights requests {rights ? `(${rights.filter((r) => r.status === "received" || r.status === "under_review").length} open)` : ""}</button>
        <button className={tab === "discover" ? "tab active" : "tab"} onClick={() => setTab("discover")}>Record a discovery</button>
        <button className={tab === "duplicates" ? "tab active" : "tab"} onClick={() => setTab("duplicates")}>Near duplicates {duplicates?.scan ? `(${duplicates.scan.pairsRecorded})` : ""}</button>
      </div>

      {tab === "overview" && (
        <>
          {!summary ? <Loading label="Loading registry summary" /> : (
            <>
              <div className="admin-stats">
                <div><strong>{summary.counts.pending_sources}</strong><span>Pending source approvals</span></div>
                <div><strong>{summary.counts.under_review}</strong><span>Under rights review</span></div>
                <div><strong>{summary.counts.restricted}</strong><span>Restricted / no reuse</span></div>
                <div><strong>{summary.counts.integrated}</strong><span>Active or import-tested</span></div>
                <div><strong>{summary.counts.pending_imports}</strong><span>Pending import requests</span></div>
                <div><strong>{summary.counts.stale_checks}</strong><span>Checks older than 180 days</span></div>
              </div>
              <div className="admin-columns">
                <section>
                  <h2>Pending sources</h2>
                  {summary.pending.length === 0 ? <p className="muted">Nothing pending.</p> : (
                    <ul className="admin-mini-list">
                      {summary.pending.map((s: any) => (
                        <li key={s.source_id}>
                          <Link to={`/sources/${s.source_id}`}>{s.source_name}</Link>
                          <span className="muted small">{s.organisation} · priority {s.priority}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section>
                  <h2>Restricted sources</h2>
                  {summary.restricted.length === 0 ? <p className="muted">None.</p> : (
                    <ul className="admin-mini-list">
                      {summary.restricted.map((s: any) => (
                        <li key={s.source_id}>
                          <Link to={`/sources/${s.source_id}`}>{s.source_name}</Link>
                          <span className="muted small">{s.licence_status.replaceAll("_", " ")}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
              <p className="caution">Only an administrator can approve a source or advance an import request. Editors can record verification checks and request imports. No request in this queue triggers an automatic crawl.</p>
            </>
          )}
        </>
      )}

      {tab === "approvals" && (
        <section>
          {!sources ? <Loading label="Loading pending sources" /> : sources.length === 0 ? <p className="muted">No pending approvals.</p> : (
            <div className="approval-list">
              {sources.map((s: any) => (
                <article key={s.sourceId} className="approval-card">
                  <header>
                    <div>
                      <div className="catalogue-badges">
                        <Badge tone={statusTone(s.ingestionStatus)}>{STATUS_LABELS[s.ingestionStatus] ?? s.ingestionStatus}</Badge>
                        <Badge tone="muted">Priority {s.priority}</Badge>
                      </div>
                      <h2><Link to={`/sources/${s.sourceId}`}>{s.sourceName}</Link></h2>
                      <p className="muted small">{s.organisation} · {s.licenceStatus.replaceAll("_", " ")}</p>
                    </div>
                    <Link className="text-link" to={`/sources/${s.sourceId}`}>Open record <Icon name="arrow-right" size={14} /></Link>
                  </header>
                  <p>{s.reliabilityNotes}</p>
                  <div className="approval-form">
                    <label className="field">
                      <span>Ingestion status</span>
                      <select value={statuses[s.sourceId] ?? s.ingestionStatus} onChange={(e) => setStatuses((x) => ({ ...x, [s.sourceId]: e.target.value }))} disabled={!isAdmin}>
                        {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label className="field">
                      <span>Review note</span>
                      <input value={notes[s.sourceId] ?? ""} onChange={(e) => setNotes((x) => ({ ...x, [s.sourceId]: e.target.value }))} placeholder="Evidence reviewed, permission obtained, or reason for rejection" maxLength={4000} disabled={!isAdmin} />
                    </label>
                    {isAdmin ? (
                      <div className="button-row">
                        <button className="button small primary" onClick={() => reviewSource(s.sourceId, "approved")} disabled={busy === s.sourceId}>Approve</button>
                        <button className="button small" onClick={() => reviewSource(s.sourceId, "rejected")} disabled={busy === s.sourceId}>Reject</button>
                      </div>
                    ) : <p className="small muted">Administrator approval required.</p>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "rights" && (
        <section>
          {!rights ? <Loading label="Loading rights requests" /> : rights.length === 0 ? <p className="muted">No rights requests have been submitted.</p> : (
            <div className="queue-admin-list">
              {rights.map((r: any) => (
                <article key={r.id} className="queue-admin-card">
                  <header>
                    <div>
                      <div className="catalogue-badges">
                        <Badge tone={r.status === "received" ? "accent" : r.status === "under_review" ? "warn" : r.status === "resolved" ? "green" : "muted"}>{r.status.replaceAll("_", " ")}</Badge>
                        <Badge tone="muted">{r.kind}</Badge>
                      </div>
                      <h3>{r.sourceName ?? "General request"}{r.workSlug ? ` · ${r.workSlug}` : ""}</h3>
                      <p className="muted small">{r.contactName || "Unnamed contact"} · {r.contactEmail} · {r.createdAt}</p>
                    </div>
                    {r.sourceId && <Link className="text-link" to={`/sources/${r.sourceId}`}>Open source <Icon name="arrow-right" size={14} /></Link>}
                  </header>
                  <p>{r.message}</p>
                  {r.reviewNote && <p className="small muted">Review: {r.reviewNote} · {r.reviewer ?? "editor"}</p>}
                  {(r.status === "received" || r.status === "under_review") ? (
                    <div className="review-actions">
                      <input value={rightsNotes[r.id] ?? ""} onChange={(e) => setRightsNotes((x) => ({ ...x, [r.id]: e.target.value }))} placeholder="Review note" maxLength={4000} />
                      {r.status === "received" && <button className="button small" onClick={() => reviewRights(r.id, "under_review")} disabled={busy === `r${r.id}`}>Under review</button>}
                      <button className="button small primary" onClick={() => reviewRights(r.id, "resolved")} disabled={busy === `r${r.id}`}>Resolve</button>
                      <button className="button small ghost" onClick={() => reviewRights(r.id, "declined")} disabled={busy === `r${r.id}`}>Decline</button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
          <p className="caution">Resolving a takedown request records a decision; it does not silently delete editions or rewrite source text. Any restriction must be applied through the source review and revision workflow.</p>
        </section>
      )}

      {tab === "queue" && (
        <section>
          {!queue ? <Loading label="Loading import queue" /> : queue.length === 0 ? <p className="muted">The ingestion queue is empty.</p> : (
            <div className="queue-admin-list">
              {queue.map((q: any) => (
                <article key={q.id} className="queue-admin-card">
                  <header>
                    <div>
                      <div className="catalogue-badges">
                        <Badge tone={q.status === "succeeded" ? "green" : q.status === "failed" || q.status === "rejected" ? "warn" : q.status === "pending" ? "accent" : "muted"}>{q.status}</Badge>
                        <Badge tone={statusTone(q.sourceStatus)}>{STATUS_LABELS[q.sourceStatus] ?? q.sourceStatus}</Badge>
                      </div>
                      <h3><Link to={`/sources/${q.sourceId}`}>{q.sourceName}</Link></h3>
                      <p className="muted small">Adapter: <code>{q.adapter}</code> · requested by {q.requester ?? "unknown"} · {q.createdAt}</p>
                    </div>
                    <span className="muted small">#{q.id}</span>
                  </header>
                  <p>{q.requestNote || "No request note."}</p>
                  {q.reviewNote && <p className="small muted">Review: {q.reviewNote}</p>}
                  {q.error && <p className="form-error">{q.error}</p>}
                  {q.status === "pending" || q.status === "approved" || q.status === "running" || q.status === "needs_review" ? (
                    <div className="review-actions">
                      {isAdmin ? (
                        <>
                          <input value={queueNotes[q.id] ?? ""} onChange={(e) => setQueueNotes((x) => ({ ...x, [q.id]: e.target.value }))} placeholder="Review note" maxLength={2000} />
                          {q.status === "pending" && <button className="button small primary" onClick={() => reviewQueue(q.id, "approved")} disabled={busy === `q${q.id}`}>Approve</button>}
                          <button className="button small" onClick={() => reviewQueue(q.id, "needs_review")} disabled={busy === `q${q.id}`}>Needs review</button>
                          <button className="button small ghost" onClick={() => reviewQueue(q.id, "rejected")} disabled={busy === `q${q.id}`}>Reject</button>
                        </>
                      ) : <span className="muted small">Awaiting administrator action.</span>}
                    </div>
                  ) : null}
                  {q.status === "approved" && (
                    <p className="small muted">Approved. No automatic import is triggered by this interface; a successful adapter run and validation are still required.</p>
                  )}
                </article>
              ))}
            </div>
          )}
          <p className="caution">The queue is an audit mechanism, not an execution engine. Actual imports run through the adapter scripts and are validated before publication; results appear in the provenance log.</p>
        </section>
      )}

      {tab === "discover" && (
        <section>
          <h2>Record a source you have found</h2>
          <p className="muted small">
            A discovery is a lead, not an approval and not an integration. The entry starts as “discovered” and awaiting
            approval; an administrator must approve it, and a separate adapter run must import and validate any text. The
            record is written to <code>data/registry/sources.json</code> as well as the database, so a corpus rebuild keeps it.
          </p>
          {createdSource && (
            <div className="success-banner" role="status">
              <h3>Recorded {createdSource}</h3>
              <p>
                It is pending approval and has no availability or licence check yet.{" "}
                <Link className="text-link" to={`/sources/${createdSource}`}>Open the source record</Link>
              </p>
            </div>
          )}
          <form className="stack" onSubmit={submitIntake}>
            <div className="form-row">
              <label className="field">
                <span>Source ID</span>
                <input
                  value={intake.sourceId}
                  onChange={(e) => setIntake({ ...intake, sourceId: e.target.value })}
                  placeholder="e.g. bodleian-sanskrit"
                  pattern="[a-z0-9][a-z0-9-]{1,62}"
                  required
                  maxLength={63}
                />
                <span className="small muted">Lowercase letters, digits and hyphens; used in URLs.</span>
              </label>
              <label className="field">
                <span>Name</span>
                <input
                  value={intake.sourceName}
                  onChange={(e) => setIntake({ ...intake, sourceName: e.target.value })}
                  placeholder="The name the host publishes"
                  required
                  maxLength={200}
                />
              </label>
            </div>
            <div className="form-row">
              <label className="field">
                <span>Organisation</span>
                <input
                  value={intake.organisation}
                  onChange={(e) => setIntake({ ...intake, organisation: e.target.value })}
                  placeholder="Institution or community behind the source"
                  maxLength={200}
                />
              </label>
              <label className="field">
                <span>Priority</span>
                <select value={intake.priority} onChange={(e) => setIntake({ ...intake, priority: Number(e.target.value) })}>
                  <option value={1}>1 — foundational text, pursued first</option>
                  <option value={2}>2 — substantial but not urgent</option>
                  <option value={3}>3 — opportunistic</option>
                </select>
              </label>
            </div>
            <div className="form-row">
              <label className="field">
                <span>Address</span>
                <input
                  value={intake.baseUrl}
                  onChange={(e) => setIntake({ ...intake, baseUrl: e.target.value })}
                  placeholder="https://…"
                  maxLength={300}
                  type="url"
                />
              </label>
              <label className="field">
                <span>API or download documentation</span>
                <input
                  value={intake.apiDocumentationUrl}
                  onChange={(e) => setIntake({ ...intake, apiDocumentationUrl: e.target.value })}
                  placeholder="https://…"
                  maxLength={300}
                  type="url"
                />
              </label>
            </div>
            <div className="form-row">
              <label className="field">
                <span>Source type</span>
                <input
                  value={intake.sourceType}
                  onChange={(e) => setIntake({ ...intake, sourceType: e.target.value })}
                  placeholder="e.g. academic digital library"
                  maxLength={120}
                />
              </label>
              <label className="field">
                <span>How text is read</span>
                <input
                  value={intake.accessMethod}
                  onChange={(e) => setIntake({ ...intake, accessMethod: e.target.value })}
                  placeholder="e.g. static HTML, one page per chapter"
                  maxLength={200}
                />
              </label>
            </div>
            <div className="form-row">
              <label className="field">
                <span>Licence terms URL</span>
                <input
                  value={intake.licenceUrl}
                  onChange={(e) => setIntake({ ...intake, licenceUrl: e.target.value })}
                  placeholder="https://…"
                  maxLength={300}
                  type="url"
                />
              </label>
              <label className="field">
                <span>Licence status</span>
                <input
                  value={intake.licenceStatus}
                  onChange={(e) => setIntake({ ...intake, licenceStatus: e.target.value })}
                  placeholder="e.g. not_verified, cc_by_4_0, site_copyright"
                  maxLength={120}
                />
              </label>
            </div>
            <label className="field">
              <span>Attribution requirements</span>
              <input
                value={intake.attributionRequirements}
                onChange={(e) => setIntake({ ...intake, attributionRequirements: e.target.value })}
                placeholder="What the host asks to be named or linked"
                maxLength={2000}
              />
            </label>
            <div className="form-row">
              <label className="field">
                <span>Traditions covered</span>
                <select
                  multiple
                  size={6}
                  value={intake.traditions}
                  onChange={(e) => setIntake({ ...intake, traditions: [...e.target.selectedOptions].map((o) => o.value) })}
                >
                  {(facets?.traditions ?? []).map((t: any) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <span className="small muted">Hold Ctrl or Cmd to select several.</span>
              </label>
              <label className="field">
                <span>Languages</span>
                <select
                  multiple
                  size={6}
                  value={intake.languages}
                  onChange={(e) => setIntake({ ...intake, languages: [...e.target.selectedOptions].map((o) => o.value) })}
                >
                  {(facets?.languages ?? []).map((l: any) => <option key={l.value} value={l.value}>{l.label} ({l.value})</option>)}
                </select>
                <span className="small muted">Codes are the registry's two- or three-letter labels.</span>
              </label>
              <label className="field">
                <span>Content types</span>
                <select
                  multiple
                  size={6}
                  value={intake.contentTypes}
                  onChange={(e) => setIntake({ ...intake, contentTypes: [...e.target.selectedOptions].map((o) => o.value) })}
                >
                  {(facets?.contentTypes ?? []).map((c: any) => <option key={c.value} value={c.value}>{c.value.replaceAll("_", " ")}</option>)}
                </select>
              </label>
            </div>
            <label className="field">
              <span>What the source holds, and why it matters</span>
              <textarea
                value={intake.reliabilityNotes}
                onChange={(e) => setIntake({ ...intake, reliabilityNotes: e.target.value })}
                rows={4}
                minLength={10}
                maxLength={4000}
                required
                placeholder="Which texts, in which editions, and how you found it. Reliability and hosting details belong here."
              />
            </label>
            <label className="field">
              <span>Editorial notes (optional)</span>
              <textarea
                value={intake.editorialNotes}
                onChange={(e) => setIntake({ ...intake, editorialNotes: e.target.value })}
                rows={2}
                maxLength={4000}
                placeholder="Known rights questions, duplication with an existing source, contacts"
              />
            </label>
            <button
              className="button primary"
              disabled={busy === "intake" || intake.sourceId.length < 2 || intake.sourceName.length < 2 || intake.reliabilityNotes.trim().length < 10}
            >
              {busy === "intake" ? "Recording…" : "Record for review"}
            </button>
            <p className="small muted">Nothing here is fetched, approved, imported or published. The availability check reads the address later, and never infers licence terms from a reachable page.</p>
          </form>
        </section>
      )}

      {tab === "duplicates" && (
        <section>
          <h2>Near-duplicate editions</h2>
          <p className="muted small">
            The ingest check compares exact checksums, so a text that differs by a quotation mark or a spelling is
            “new”. This scan groups editions that repeat substantive passages, then compares a sample of the
            references they share with a fuzzy similarity. An <em>equivalent</em> text matches after punctuation, case,
            diacritics and script variants are folded; a <em>near</em> text is at least {" "}
            {duplicates?.scan ? `${Math.round(duplicates.scan.threshold * 100)}%` : "90%"} similar on word shingles.
            A scan is a report: nothing is merged, deleted or re-catalogued.
          </p>
          {!duplicates ? (
            <Loading label="Loading the latest scan" />
          ) : !duplicates.scan ? (
            <div className="empty-panel">
              <h3>No scan has been stored yet.</h3>
              <p>Run <code>{duplicates.command}</code> on the server. It reads the whole local corpus, so it takes about a minute, and stores its findings here.</p>
            </div>
          ) : (
            <>
              <div className="admin-stats">
                <div><strong>{duplicates.scan.pairsRecorded}</strong><span>pairs recorded</span></div>
                <div><strong>{duplicates.scan.candidatePairs}</strong><span>candidate pairs compared</span></div>
                <div><strong>{duplicates.scan.editions.toLocaleString()}</strong><span>editions in the catalogue</span></div>
                <div><strong>{duplicates.pairs.reduce((total: number, p: any) => total + p.equivalent, 0)}</strong><span>equivalent passages</span></div>
                <div><strong>{duplicates.pairs.reduce((total: number, p: any) => total + p.near, 0)}</strong><span>near passages</span></div>
                <div><strong>{(duplicates.scan.durationMs / 1000).toFixed(0)}s</strong><span>scan time</span></div>
              </div>
              <p className="small muted">
                Scan #{duplicates.scan.id}, finished {duplicates.scan.finishedAt}. Pairs are recorded at {" "}
                {Math.round(duplicates.scan.recordThreshold * 100)}% similarity or above, and only when the two editions
                repeat at least {duplicates.scan.minRepeated} substantive passages. Refresh with <code>{duplicates.command}</code>.
              </p>
              {duplicates.pairs.length === 0 ? (
                <p className="muted">The last scan found no near-duplicate pairs above the recording threshold.</p>
              ) : (
                <div className="queue-admin-list">
                  {duplicates.pairs.map((p: any) => (
                    <article key={p.id} className="queue-admin-card">
                      <header>
                        <div>
                          <div className="catalogue-badges">
                            <Badge tone={p.similarity >= 0.95 ? "warn" : p.similarity >= 0.8 ? "accent" : "muted"}>
                              {(p.similarity * 100).toFixed(1)}% similar
                            </Badge>
                            <Badge tone="muted">{p.repeated} repeated passages</Badge>
                            <Badge tone="muted">{p.sampled} sampled</Badge>
                          </div>
                          <h3>
                            <Link to={`/work/${p.left.workSlug}`}>{p.left.workTitle}</Link>{" ↔ "}
                            <Link to={`/work/${p.right.workSlug}`}>{p.right.workTitle}</Link>
                          </h3>
                          <p className="muted small">
                            <code>{p.left.editionSlug}</code> ({p.left.language}){" ↔ "}
                            <code>{p.right.editionSlug}</code> ({p.right.language})
                          </p>
                        </div>
                        <Link className="text-link" to={`/read/${p.left.workSlug}?version=${encodeURIComponent(p.left.editionSlug)}`}>
                          Read left edition <Icon name="arrow-right" size={14} />
                        </Link>
                      </header>
                      <p className="small">
                        {p.identical} identical · {p.equivalent} equivalent · {p.near} near · {p.different} different
                      </p>
                      {p.examples.length > 0 && (
                        <ul className="plain-list duplicate-examples">
                          {p.examples.slice(0, 4).map((example: any, index: number) => (
                            <li key={`${p.id}-${index}`}>
                              <p className="small muted">
                                {example.reference} · {example.kind} · {Math.round(example.similarity * 100)}%
                              </p>
                              <p className="small">{example.left}</p>
                              <p className="small">{example.right}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
          <p className="caution">
            A candidate pair must already share substantive text, so two editions that were reworded on every line are
            not paired automatically. Text streamed from its host is not compared: only locally held passages carry a
            checksum and a copy to sample.
          </p>
        </section>
      )}
    </div>
  );
}
