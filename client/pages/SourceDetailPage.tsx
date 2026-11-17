import { useEffect, useState } from "react";
import { Link, useLocation } from "../router";
import { api } from "../api";
import { useAuth } from "../auth";
import { Badge, ErrorState, Icon, Loading, useToast } from "../components";
import { rightsLabel, statusTone } from "./SourcesPage";

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

export function SourceDetailPage({ sourceId }: { sourceId: string }) {
  const { user } = useAuth();
  const { push } = useToast();
  const location = useLocation();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [checkStatus, setCheckStatus] = useState("ok");
  const [checkMethod, setCheckMethod] = useState("manual");
  const [checkNotes, setCheckNotes] = useState("");
  const [markVerified, setMarkVerified] = useState(false);
  const [adapter, setAdapter] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    setError("");
    api<any>(`/api/sources/${encodeURIComponent(sourceId)}`).then(setData).catch((e) => setError(e.message));
  };
  useEffect(load, [sourceId]);

  const isEditor = user?.role === "editor" || user?.role === "admin";

  const submitCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/admin/sources/${encodeURIComponent(sourceId)}/check`, { method: "POST", body: { method: checkMethod, status: checkStatus, notes: checkNotes, markVerified } });
      push("Verification check recorded.", "success");
      setCheckNotes("");
      setMarkVerified(false);
      load();
    } catch (err: any) { push(err.message, "error"); } finally { setBusy(false); }
  };

  const requestImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/admin/queue", { method: "POST", body: { sourceId, adapter, note: requestNote } });
      push("Import request queued. Publication still requires validation and review.", "success");
      setRequestNote("");
      load();
    } catch (err: any) { push(err.message, "error"); } finally { setBusy(false); }
  };

  if (error) return <div className="container page"><ErrorState message={error} onRetry={load} /></div>;
  if (!data) return <div className="container page"><Loading label="Opening the source record" /></div>;
  const s = data.source;

  return (
    <div className="container page source-detail-page">
      <nav className="breadcrumb">
        <Link to="/sources">Sources</Link> / <span>{s.sourceName}</span>
      </nav>

      <header className="source-detail-header">
        <div>
          <div className="catalogue-badges">
            <Badge tone={statusTone(s.ingestionStatus)}>{STATUS_LABELS[s.ingestionStatus] ?? s.ingestionStatus}</Badge>
            <Badge tone={s.approvalStatus === "approved" ? "green" : s.approvalStatus === "rejected" ? "warn" : "muted"}>{s.approvalStatus} for import</Badge>
            <Badge tone="muted">Priority {s.priority}</Badge>
          </div>
          <h1>{s.sourceName}</h1>
          <p className="source-org">{s.organisation}</p>
          <div className="button-row">
            {s.baseUrl && <a className="button" href={s.baseUrl} target="_blank" rel="noopener noreferrer">Visit source <Icon name="external" size={14} /></a>}
            {s.apiDocumentationUrl && <a className="button ghost" href={s.apiDocumentationUrl} target="_blank" rel="noopener noreferrer">API documentation</a>}
            {s.downloadUrl && <a className="button ghost" href={s.downloadUrl} target="_blank" rel="noopener noreferrer">Download page</a>}
          </div>
        </div>
        <aside className="source-verdict">
          <p className="eyebrow">Rights verdict</p>
          <p className="source-verdict-main">{s.licenceStatus.replaceAll("_", " ")}</p>
          <div className="verdict-row"><span>Redistribution</span><strong className={s.redistributionAllowed === false ? "warn-text" : s.redistributionAllowed === true ? "ok-text" : ""}>{rightsLabel(s.redistributionAllowed)}</strong></div>
          <div className="verdict-row"><span>Commercial use</span><strong className={s.commercialUseAllowed === false ? "warn-text" : s.commercialUseAllowed === true ? "ok-text" : ""}>{rightsLabel(s.commercialUseAllowed)}</strong></div>
          <div className="verdict-row"><span>Last verified</span><strong>{s.lastVerifiedAt ?? "Not verified"}</strong></div>
          {s.reviewer && <div className="verdict-row"><span>Reviewed by</span><strong>{s.reviewer}</strong></div>}
        </aside>
      </header>

      {s.approvalStatus !== "approved" && (
        <div className="source-warning">
          <strong>Not approved for text import.</strong> This source may be catalogued and linked, but its text must not be copied into the public corpus until rights review is complete and an administrator approves it.
        </div>
      )}

      <div className="source-detail-grid">
        <section className="source-section">
          <h2>What this source covers</h2>
          <div className="chip-row">
            {s.traditions.map((t: any) => <Link key={t.slug} className="chip" to={`/sources?tradition=${encodeURIComponent(t.slug)}`}>{t.name}</Link>)}
            {s.traditions.length === 0 && <span className="muted">No tradition listed.</span>}
          </div>
          <dl className="detail-list">
            <div><dt>Source type</dt><dd>{s.sourceType}</dd></div>
            <div><dt>Content types</dt><dd>{s.contentTypes.map((c: string) => c.replaceAll("_", " ")).join(", ") || "—"}</dd></div>
            <div><dt>Languages</dt><dd>{s.languages.join(", ") || "—"}</dd></div>
            <div><dt>Access method</dt><dd>{s.accessMethod}</dd></div>
            <div><dt>Authentication</dt><dd>{s.authenticationRequired == null ? "Not verified" : s.authenticationRequired ? "Required" : "Not required"}</dd></div>
            <div><dt>Rate limits</dt><dd>{s.rateLimits || "Not recorded"}</dd></div>
          </dl>
        </section>

        <section className="source-section">
          <h2>Licence &amp; attribution</h2>
          <div className="detail-list">
            <div><dt>Licence status</dt><dd>{s.licenceStatus.replaceAll("_", " ")}</dd></div>
            <div><dt>Licence page</dt><dd>{s.licenceUrl ? <a href={s.licenceUrl} target="_blank" rel="noopener noreferrer">Open licence terms <Icon name="external" size={12} /></a> : "No licence page recorded"}</dd></div>
            <div><dt>Attribution</dt><dd>{s.attributionRequirements || "Not established"}</dd></div>
          </div>
          <p className="caution">Rights are recorded per source and, where possible, per edition. A permissive source may still contain restricted translations. This record is not legal advice.</p>
        </section>
      </div>

      <section className="source-section">
        <h2>Reliability &amp; editorial notes</h2>
        <p>{s.reliabilityNotes}</p>
        {s.editorialNotes && <p className="editorial-note">{s.editorialNotes}</p>}
      </section>

      {data.editions.length > 0 && (
        <section className="source-section">
          <h2>Editions imported from this source</h2>
          <ul className="source-edition-list">
            {data.editions.map((e: any) => (
              <li key={e.slug}>
                <Link to={`/work/${e.work.slug}`}>{e.work.title}</Link>
                <span>{e.title}{e.publicationYear ? ` · ${e.publicationYear}` : ""}</span>
                <span className="muted small">{e.textCount} passages</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(data.imports.length > 0 || data.queue.length > 0) && (
        <section className="source-section">
          <h2>Import history &amp; queue</h2>
          {data.imports.length > 0 && (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Adapter</th><th>Status</th><th>Imported</th><th>Failed</th><th>Finished</th></tr></thead>
                <tbody>
                  {data.imports.map((i: any) => (
                    <tr key={i.id}>
                      <td>{i.adapter}</td>
                      <td><Badge tone={i.status === "succeeded" ? "green" : i.status === "partial" ? "warn" : "muted"}>{i.status}</Badge></td>
                      <td>{i.imported}</td><td>{i.failed}</td><td className="small">{i.finishedAt ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.queue.length > 0 && (
            <ul className="queue-list">
              {data.queue.map((q: any) => (
                <li key={q.id}>
                  <Badge tone={q.status === "succeeded" ? "green" : q.status === "failed" || q.status === "rejected" ? "warn" : q.status === "pending" ? "accent" : "muted"}>{q.status}</Badge>
                  <div><strong>{q.adapter}</strong><p>{q.requestNote || "No request note."}</p></div>
                  <span className="muted small">#{q.id} · {q.createdAt}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="source-section">
        <h2>Verification checks</h2>
        {data.checks.length === 0 ? <p className="muted">No checks recorded.</p> : (
          <ul className="check-list">
            {data.checks.map((c: any) => (
              <li key={c.id}>
                <Badge tone={c.status === "ok" ? "green" : c.status === "blocked" ? "warn" : "muted"}>{c.status}</Badge>
                <div>
                  <p>{c.notes}</p>
                  <p className="small muted">{c.method}{c.httpStatus ? ` · HTTP ${c.httpStatus}` : ""} · {c.checkedAt}{c.checker ? ` · ${c.checker}` : ""}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {isEditor && (
          <form className="inline-form" onSubmit={submitCheck}>
            <h3>Record a check</h3>
            <div className="form-row">
              <label className="field"><span>Method</span><select value={checkMethod} onChange={(e) => setCheckMethod(e.target.value)}><option value="manual">Manual</option><option value="http">HTTP</option><option value="api">API</option></select></label>
              <label className="field"><span>Result</span><select value={checkStatus} onChange={(e) => setCheckStatus(e.target.value)}><option value="ok">OK</option><option value="blocked">Blocked</option><option value="error">Error</option><option value="unverified">Unverified</option></select></label>
            </div>
            <label className="field"><span>Notes</span><textarea value={checkNotes} onChange={(e) => setCheckNotes(e.target.value)} rows={2} maxLength={2000} placeholder="What was checked, and what did the terms say?" /></label>
            <label className="check-row"><input type="checkbox" checked={markVerified} onChange={(e) => setMarkVerified(e.target.checked)} /><span>Mark the source as verified today</span></label>
            <button className="button small" disabled={busy || checkNotes.trim().length < 3}>Record check</button>
          </form>
        )}
      </section>

      {isEditor && (
        <section className="source-section">
          <h2>Request an import</h2>
          <p>This queues a request; it does not run or publish an import. An administrator must review it, and the adapter must still validate and record provenance.</p>
          <form className="inline-form" onSubmit={requestImport}>
            <label className="field">
              <span>Adapter</span>
              <select value={adapter} onChange={(e) => setAdapter(e.target.value)} required>
                <option value="">Choose an adapter…</option>
                {data.adapters.map((a: any) => <option key={a.id} value={a.id} disabled={!a.canImport && a.status !== "connected"}>{a.label} ({a.status})</option>)}
              </select>
            </label>
            <label className="field"><span>Scope and note</span><textarea value={requestNote} onChange={(e) => setRequestNote(e.target.value)} rows={2} maxLength={2000} placeholder="Which works, editions or collection? What rights evidence is attached?" /></label>
            <button className="button small" disabled={busy || !adapter || s.approvalStatus !== "approved"}>Queue request</button>
            {s.approvalStatus !== "approved" && <p className="small warn-text">Administrator approval is required first.</p>}
          </form>
        </section>
      )}

      <section className="source-section source-links">
        {s.traditions[0] && (
          <Link to={`/sources?tradition=${encodeURIComponent(s.traditions[0].slug)}`}>More sources for {s.traditions[0].name}</Link>
        )}
        <Link to="/provenance">Edition-level provenance</Link>
        <Link to="/editorial">Report a metadata problem</Link>
        <Link to={`/rights?source=${encodeURIComponent(s.sourceId)}`}>Rights, attribution or takedown request</Link>
      </section>
    </div>
  );
}
