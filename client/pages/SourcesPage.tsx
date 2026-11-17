import { useEffect, useMemo, useState } from "react";
import { Link, navigate, useLocation } from "../router";
import { api } from "../api";
import { useAuth } from "../auth";
import { Badge, ErrorState, Icon, Loading, PageIntro } from "../components";

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

export function statusTone(status: string): "green" | "blue" | "warn" | "muted" | "accent" {
  if (status === "active" || status === "import_tested") return "green";
  if (status === "connected" || status === "licence_verified" || status === "ready_for_integration") return "blue";
  if (status === "under_review" || status === "discovered") return "warn";
  if (status === "restricted" || status === "unavailable") return "muted";
  return "accent";
}

export function rightsLabel(value: boolean | null): string {
  if (value === true) return "Permitted";
  if (value === false) return "Not permitted";
  return "Not verified";
}

export function SourcesPage() {
  const location = useLocation();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [acquisitions, setAcquisitions] = useState<any>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState(params.get("q") || "");

  const apply = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in patch)) next.delete("page");
    navigate(`/sources?${next.toString()}`);
  };

  useEffect(() => {
    setQ(params.get("q") || "");
    setError("");
    api<any>(`/api/sources?${location.search.replace(/^\?/, "")}`).then(setData).catch((e) => setError(e.message));
  }, [location.search]);

  useEffect(() => {
    api<any>("/api/acquisitions").then(setAcquisitions).catch(() => {});
  }, []);

  return (
    <div className="container page sources-page">
      <PageIntro
        eyebrow="Global source registry"
        title="Where texts can—and cannot—come from"
        lede="A structured registry of repositories across traditions. Discovery, rights verification, ingestion and publication are separate steps. No source is described as connected merely because its website exists."
      >
        <div className="button-row">
          <Link className="button" to="/provenance">Edition provenance log</Link>
          {(user?.role === "editor" || user?.role === "admin") && <Link className="button" to="/admin/sources">Registry &amp; ingestion admin</Link>}
        </div>
        {data && (
          <>
            <div className="registry-stats">
              <div><strong>{data.stats.total}</strong><span>sources registered</span></div>
              <div><strong>{data.stats.importTested}</strong><span>import tested</span></div>
              <div><strong>{data.stats.underReview}</strong><span>under review</span></div>
              <div><strong>{data.stats.restricted}</strong><span>restricted / unavailable</span></div>
              <div><strong>{data.stats.pendingApproval}</strong><span>awaiting approval</span></div>
              <div><strong>{data.stats.dueForCheck}</strong><span>due for an availability check</span></div>
            </div>
            {data.stats.dueForCheck > 0 && (
              <p className="small muted">
                {data.stats.neverChecked > 0
                  ? `${data.stats.neverChecked} of those approved sources have never been checked. `
                  : ""}
                Availability checks record whether the documented address answers; they do not verify licence terms. The
                server runs the due ones on a schedule, and <code>bun run check:sources -- --dry-run</code> lists them.
              </p>
            )}
          </>
        )}
        <p className="small muted">
          Texts are read from the project that hosts them when you open them: this library keeps each work’s
          catalogue record, chapter outline and passage index, not a copy of the text. Editions held locally are
          named in the <Link to="/provenance">edition provenance log</Link>.
        </p>
      </PageIntro>

      <form
        className="registry-search"
        onSubmit={(e) => { e.preventDefault(); apply({ q: q.trim() || null }); }}
        role="search"
      >
        <Icon name="search" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a source, organisation or access note" aria-label="Search source registry" />
        <button className="button small" type="submit">Search</button>
      </form>

      <div className="registry-layout">
        <aside className="filters" aria-label="Source filters">
          <div className="filter-group">
            <label htmlFor="r-tradition">Traditions covered</label>
            <select id="r-tradition" value={params.get("tradition") || ""} onChange={(e) => apply({ tradition: e.target.value || null })}>
              <option value="">All traditions</option>
              {data?.facets.traditions.map((t: any) => <option key={t.value} value={t.value}>{t.label} ({t.count})</option>)}
            </select>
          </div>
          <div className="filter-group">
            <label htmlFor="r-status">Ingestion status</label>
            <select id="r-status" value={params.get("status") || ""} onChange={(e) => apply({ status: e.target.value || null })}>
              <option value="">Any status</option>
              {data?.facets.statuses.map((s: any) => <option key={s.value} value={s.value}>{STATUS_LABELS[s.value] ?? s.value} ({s.count})</option>)}
            </select>
          </div>
          <div className="filter-group">
            <label htmlFor="r-language">Language</label>
            <select id="r-language" value={params.get("language") || ""} onChange={(e) => apply({ language: e.target.value || null })}>
              <option value="">Any language</option>
              {data?.facets.languages.map((l: any) => <option key={l.value} value={l.value}>{l.label} ({l.count})</option>)}
            </select>
          </div>
          <div className="filter-group">
            <label htmlFor="r-content">Content type</label>
            <select id="r-content" value={params.get("contentType") || ""} onChange={(e) => apply({ contentType: e.target.value || null })}>
              <option value="">Any content</option>
              {data?.facets.contentTypes.map((c: any) => <option key={c.value} value={c.value}>{c.value.replaceAll("_", " ")} ({c.count})</option>)}
            </select>
          </div>
          <div className="filter-group">
            <label htmlFor="r-access">Access method</label>
            <select id="r-access" value={params.get("access") || ""} onChange={(e) => apply({ access: e.target.value || null })}>
              <option value="">Any access</option>
              <option value="API">API</option>
              <option value="download">Download</option>
              <option value="web">Web reading</option>
              <option value="local">Local dataset</option>
            </select>
          </div>
          <div className="filter-group">
            <label htmlFor="r-priority">Priority</label>
            <select id="r-priority" value={params.get("priority") || ""} onChange={(e) => apply({ priority: e.target.value || null })}>
              <option value="">Any priority</option>
              <option value="1">Priority 1</option>
              <option value="2">Priority 2</option>
              <option value="3">Priority 3</option>
            </select>
          </div>
          <button className="button ghost small" onClick={() => navigate("/sources")}>Clear filters</button>
          <p className="filter-note">
            “Restricted” means no reuse permission was found or the terms prohibit copying. It is not a judgement about the tradition.
          </p>
        </aside>

        <div className="registry-results">
          {error && <ErrorState message={error} />}
          {!data && !error && <Loading label="Loading the source registry" />}
          {data && (
            <>
              <div className="results-bar">
                <p><strong>{data.total}</strong> {data.total === 1 ? "source" : "sources"}{params.get("tradition") ? " for this tradition" : ""}</p>
                <p className="muted small">{data.stats.approved} approved for metadata/import workflow · {data.stats.withApi} with documented API</p>
              </div>
              {data.total === 0 ? (
                <div className="empty-panel">
                  <h3>No source matches these filters.</h3>
                  <p>Try a broader search. The registry deliberately records unverified and restricted sources instead of hiding them.</p>
                  <button className="button" onClick={() => navigate("/sources")}>Clear filters</button>
                </div>
              ) : (
                <div className="registry-list">
                  {data.sources.map((s: any) => (
                    <article key={s.sourceId} className="registry-card">
                      <div className="registry-card-head">
                        <div>
                          <div className="catalogue-badges">
                            <Badge tone={statusTone(s.ingestionStatus)}>{STATUS_LABELS[s.ingestionStatus] ?? s.ingestionStatus}</Badge>
                            <Badge tone={s.approvalStatus === "approved" ? "green" : s.approvalStatus === "rejected" ? "warn" : "muted"}>
                              {s.approvalStatus} for import
                            </Badge>
                            <Badge tone="muted">Priority {s.priority}</Badge>
                          </div>
                          <h2><Link to={`/sources/${s.sourceId}`}>{s.sourceName}</Link></h2>
                          <p className="registry-org">{s.organisation}{s.baseUrl ? <> · <a href={s.baseUrl} target="_blank" rel="noopener noreferrer">{s.baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")} <Icon name="external" size={11} /></a></> : null}</p>
                        </div>
                      </div>
                      <p className="registry-notes">{s.reliabilityNotes}</p>
                      <div className="chip-row">
                        {s.traditions.slice(0, 6).map((t: any) => <span key={t.slug} className="chip">{t.name}</span>)}
                        {s.traditions.length > 6 && <span className="chip">+{s.traditions.length - 6}</span>}
                        {s.traditions.length === 0 && <span className="muted small">No specific tradition recorded</span>}
                      </div>
                      <dl className="registry-facts">
                        <div><dt>Licence</dt><dd>{s.licenceStatus.replaceAll("_", " ")}</dd></div>
                        <div><dt>Redistribution</dt><dd className={s.redistributionAllowed === true ? "ok-text" : s.redistributionAllowed === false ? "warn-text" : ""}>{rightsLabel(s.redistributionAllowed)}</dd></div>
                        <div><dt>Commercial use</dt><dd className={s.commercialUseAllowed === true ? "ok-text" : s.commercialUseAllowed === false ? "warn-text" : ""}>{rightsLabel(s.commercialUseAllowed)}</dd></div>
                        <div><dt>Access</dt><dd>{s.accessMethod}</dd></div>
                        <div><dt>Verified</dt><dd>{s.lastVerifiedAt ?? "Not verified"}</dd></div>
                      </dl>
                      <div className="registry-card-foot">
                        <Link className="text-link" to={`/sources/${s.sourceId}`}>Source detail &amp; conditions <Icon name="arrow-right" size={14} /></Link>
                        {s.apiDocumentationUrl && <a className="text-link" href={s.apiDocumentationUrl} target="_blank" rel="noopener noreferrer">API docs <Icon name="external" size={12} /></a>}
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {data.pages > 1 && (
                <nav className="pagination" aria-label="Source registry pages">
                  <button className="button small" disabled={data.page <= 1} onClick={() => apply({ page: String(data.page - 1) })}><Icon name="arrow-left" size={15} /> Previous</button>
                  <span>Page {data.page} of {data.pages}</span>
                  <button className="button small" disabled={data.page >= data.pages} onClick={() => apply({ page: String(data.page + 1) })}>Next <Icon name="arrow-right" size={15} /></button>
                </nav>
              )}
              <p className="caution">{data.note}</p>
            </>
          )}
        </div>
      </div>

      {acquisitions && acquisitions.total > 0 && (
        <section className="section" aria-labelledby="acquisitions-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Acquisition register</p>
              <h2 id="acquisitions-heading">Works requested, not yet acquired</h2>
            </div>
            <p>
              {acquisitions.stats.wanted} wanted · {acquisitions.stats.located} located · {acquisitions.stats.rightsBlocked} blocked by rights.
              A lead is a place to look, not a verified edition.
            </p>
          </div>
          <div className="registry-list">
            {acquisitions.targets.map((target: any) => (
              <article key={target.slug} className="registry-card">
                <div className="registry-card-head">
                  <div>
                    <div className="catalogue-badges">
                      <Badge tone={target.status === "wanted" ? "warn" : target.status === "located" ? "blue" : "muted"}>
                        {target.status.replaceAll("_", " ")}
                      </Badge>
                      <Badge tone="muted">Priority {target.priority}</Badge>
                      {target.languages.map((lang: string) => <span key={lang} className="chip">{lang}</span>)}
                    </div>
                    <h2>{target.title}</h2>
                    <p className="registry-org">
                      {target.author || "Author not recorded"} · {target.tradition} · {target.category}
                      {target.originalTitle ? ` · ${target.originalTitle}` : ""}
                    </p>
                  </div>
                </div>
                <p className="registry-notes">{target.note}</p>
                {target.rightsNote && <p className="filter-note"><strong>Rights:</strong> {target.rightsNote}</p>}
                <div className="registry-card-foot">
                  {target.sourceLeads.map((lead: any) => (
                    <a key={lead.url} className="text-link" href={lead.url} target="_blank" rel="noopener noreferrer">
                      {lead.source} <Icon name="external" size={12} />
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>
          <p className="caution">{acquisitions.note}</p>
        </section>
      )}
    </div>
  );
}
