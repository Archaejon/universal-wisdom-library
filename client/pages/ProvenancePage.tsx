import { useEffect, useState } from "react";
import { Link } from "../router";
import { api } from "../api";
import { Badge, ErrorState, Loading, PageIntro, SampleBadge, type Site } from "../components";

// "In use" is read from the corpus, not typed into the adapter record: local
// works, works streamed from the provider, and the runs filed under the source.
function usageLabel(adapter: any): string {
  const usage = adapter.usage ?? {};
  const parts: string[] = [];
  if (usage.local) parts.push(`${usage.local} local`);
  if (usage.streamed) parts.push(`${usage.streamed} streamed`);
  if (usage.runs) parts.push(`${usage.runs} run${usage.runs === 1 ? "" : "s"}`);
  if (parts.length) return parts.join(" · ");
  if (adapter.status === "planned") return "Not in use";
  // The curated seed is not an edition source: no edition is filed under it.
  return adapter.status === "sample" ? "Seed only" : "None recorded";
}

function importTone(status: string): "green" | "warn" | "muted" {
  if (status === "succeeded") return "green";
  if (status === "partial" || status === "failed") return "warn";
  return "muted";
}

export function ProvenancePage({ site }: { site: Site }) {
  const [data, setData] = useState<any>(null);
  const [editions, setEditions] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  useEffect(() => {
    api<any>("/api/provenance").then(setData).catch((e) => setError(e.message));
  }, []);

  // The edition ledger is thousands of rows of notes and attribution text, so it
  // is asked for a page at a time: the rest of the page paints without waiting
  // for it, and every edition is still one click away.
  useEffect(() => {
    let current = true;
    api<any>(`/api/provenance/editions?page=${page}`)
      .then((result) => { if (current) setEditions(result); })
      .catch(() => { if (current) setEditions({ error: true, editions: [], page: 1, pages: 1, total: 0 }); });
    return () => { current = false; };
  }, [page]);

  if (error) return <div className="container page"><ErrorState message={error} /></div>;
  if (!data) return <div className="container page"><Loading label="Loading provenance records" /></div>;

  const connected = data.sources.filter((s: any) => s.status === "connected");
  const planned = data.sources.filter((s: any) => s.status !== "connected" && s.status !== "sample");

  return (
    <div className="container page provenance-page">
      <PageIntro
        eyebrow="Sources & provenance"
        title="Where every text comes from"
        lede="This page is the audit trail: each edition, its translator, source, licence, import run and any unresolved quality issue. Nothing here should be taken on trust; it is recorded so it can be checked."
      >
        <div className="provenance-notice">
          <Badge tone="muted">{site.corpusLabel}</Badge>
          <p>{site.corpusNotice}</p>
          <p className="small muted">
            Corpus version {site.corpusVersion}. Works marked streamed are fetched from their host when read; a timeout or an outage
            at the host is shown as such and is not filled in from a local copy.
          </p>
        </div>
      </PageIntro>

      <section className="provenance-summary">
        <div><strong>{data.editionCount}</strong><span>editions recorded</span></div>
        <div><strong>{connected.length}</strong><span>sources connected for import or streaming</span></div>
        <div><strong>{data.redistributableCount}</strong><span>editions with redistribution permitted</span></div>
        <div><strong>{data.streaming?.works ?? 0}</strong><span>works streamed from their host</span></div>
        <div><strong>{data.imports.length}</strong><span>import runs recorded from their manifests</span></div>
        <div><strong>{data.unpublished.length}</strong><span>catalogue-only works</span></div>
      </section>

      <section className="prose-section">
        <h2>Source integrations</h2>
        <p>
          “Connected” means the source was reached during corpus assembly or is used to stream text at read time. Streamed works
          keep their catalogue record, chapter outline and passage index here; the text stays with the project that publishes it.
        </p>
        <div className="source-list">
          {data.sources.map((s: any) => (
            <article key={s.slug} className="source-card">
              <div className="source-head">
                <h3>{s.name}</h3>
                <div className="catalogue-badges">
                  <Badge tone={s.status === "connected" ? "green" : s.status === "sample" ? "accent" : s.status === "unavailable" ? "warn" : "muted"}>{s.status}</Badge>
                  <Badge tone="muted">{s.isLive ? "API reached" : "file / manual import"}</Badge>
                </div>
              </div>
              <p>{s.description}</p>
              <p className="small muted">{s.accessNotes}</p>
              {s.url && <a className="text-link" href={s.url} target="_blank" rel="noopener noreferrer">{s.url}</a>}
              {s.retrievedAt && <p className="small muted">Retrieved {s.retrievedAt}</p>}
            </article>
          ))}
        </div>
      </section>

      <section className="prose-section">
        <h2>Adapter readiness</h2>
        <p>
          The ingestion layer maps each source to the canonical schema. “In use” is counted from this corpus when the page loads —
          the works held locally, the works streamed from that provider, and the import runs filed under it — so the column cannot
          describe an adapter more generously than the shelves do.
        </p>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Adapter</th><th>Status</th><th>In use</th><th>Licence</th><th>Still required</th></tr></thead>
            <tbody>
              {data.adapters.map((a: any) => (
                <tr key={a.id}>
                  <td><strong>{a.label}</strong><br /><span className="muted small">{a.provider}</span></td>
                  <td><Badge tone={a.status === "connected" ? "green" : a.status === "sample" ? "accent" : a.status === "unavailable" ? "warn" : "muted"}>{a.status}</Badge></td>
                  <td className="small">
                    {usageLabel(a)}
                    {a.usage?.lastRun && <><br /><span className="muted">last run {a.usage.lastRun.slice(0, 10)}</span></>}
                  </td>
                  <td className="small">{a.licence}</td>
                  <td className="small">{a.requires.length ? a.requires.join("; ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="prose-section">
        <h2>Editions and rights</h2>
        <p>
          Rights are recorded at edition level because a work can mix public-domain and restricted editions. Sample editions are excerpts,
          not complete critical editions. The ledger runs in shelf order, {editions?.pageSize ?? 100} editions to a page.
        </p>
        {!editions ? (
          <p className="muted">Loading the edition ledger…</p>
        ) : editions.error ? (
          <p className="muted">The edition ledger could not be loaded. The rest of the record above is unaffected.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Work</th><th>Edition</th><th>Language</th><th>Source</th><th>Licence</th><th>Redistribution</th><th>Passages</th></tr>
                </thead>
                <tbody>
                  {editions.editions.map((e: any) => (
                    <tr key={e.slug}>
                      <td><Link to={`/work/${e.work.slug}`}>{e.work.title}</Link><br /><span className="muted small">{e.work.tradition}</span></td>
                      <td>{e.title}<br /><span className="muted small">{e.editionType}{e.publicationYear ? ` · ${e.publicationYear}` : ""}</span>{e.isSample && <><br /><SampleBadge /></>}</td>
                      <td>{e.language}</td>
                      <td>{e.source?.name ?? "—"}</td>
                      <td className="small">{e.license?.name ?? "Not recorded"}</td>
                      <td>{e.license?.redistributionAllowed ? <Badge tone="green">Permitted</Badge> : <Badge tone="warn">Not permitted</Badge>}</td>
                      <td>{e.textCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="button-row">
              <button className="button ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={editions.page <= 1}>Previous</button>
              <span className="muted small">Page {editions.page} of {editions.pages} · {editions.total} editions</span>
              <button className="button ghost" onClick={() => setPage((p) => Math.min(editions.pages, p + 1))} disabled={editions.page >= editions.pages}>Next</button>
            </div>
          </>
        )}
      </section>

      <section className="prose-section">
        <h2>Licence records</h2>
        <div className="licence-grid">
          {data.licenses.map((l: any) => (
            <article key={l.code} className="licence-card">
              <h3>{l.name}</h3>
              <code>{l.code}</code>
              <p className="small">{l.notes}</p>
              <div className="catalogue-badges">
                <Badge tone={l.redistributionAllowed ? "green" : "warn"}>{l.redistributionAllowed ? "Redistribution allowed" : "No redistribution"}</Badge>
                {l.attributionRequired && <Badge tone="muted">Attribution required</Badge>}
                {l.shareAlike && <Badge tone="muted">Share-alike</Badge>}
              </div>
              {l.url && <a className="text-link small" href={l.url} target="_blank" rel="noopener noreferrer">Licence text</a>}
            </article>
          ))}
        </div>
      </section>

      <section className="prose-section">
        <h2>Import runs</h2>
        <p>
          One row for every manifest an importer left under <code>data/imports</code>: what the pass took, from which host, and when.
          A manifest that only lists a host's own catalogue, or its crawl state, is not a run and is not counted.
        </p>
        {data.imports.length === 0 ? <p className="muted">No import runs recorded.</p> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Adapter</th><th>Status</th><th>Seen</th><th>Imported</th><th>Failed</th><th>Finished</th></tr></thead>
              <tbody>
                {data.imports.map((i: any) => (
                  <tr key={i.id}>
                    <td>
                      {i.adapter}<br /><span className="muted small">{i.source ?? "local"}</span>
                      {i.manifest && <><br /><span className="muted small">data/imports/{i.manifest}</span></>}
                    </td>
                    <td><Badge tone={importTone(i.status)}>{i.status}</Badge></td>
                    <td>{i.seen}</td>
                    <td>{i.imported}</td>
                    <td>{i.failed}</td>
                    <td className="small">{i.finishedAt ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data.issues.length > 0 && (
        <section className="prose-section">
          <h2>Quality flags</h2>
          <p>Validation issues are recorded rather than silently repaired. Errors block an import; warnings are held for review.</p>
          <ul className="issue-list">
            {data.issues.map((i: any) => (
              <li key={i.id}>
                <Badge tone={i.severity === "error" ? "warn" : "muted"}>{i.severity}</Badge>
                <div><code>{i.code}</code><p>{i.message}</p>{i.record && <p className="small muted">Record: {i.record}</p>}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="prose-section">
        <h2>Catalogue-only works</h2>
        <p>These works have catalogue records but no imported text. They appear in the library for context; the reader will not invent content for them.</p>
        {data.unpublished.length === 0 ? <p className="muted">None.</p> : (
          <ul className="unpublished-list">
            {data.unpublished.map((w: any) => (
              <li key={w.slug}>
                <Link to={`/work/${w.slug}`}>{w.title}</Link>
                <span className="muted small">{w.tradition} · {w.reason || "No permitted edition imported."}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="prose-section">
        <h2>Limits of this record</h2>
        <ul className="plain-list">
          <li>Translations are excerpted for demonstration; check the cited edition before quoting at length.</li>
          <li>Licence statements describe the source as recorded at import time and are not legal advice.</li>
          <li>Attribution and share-alike obligations travel with the text; this page records them but does not satisfy them for downstream reuse.</li>
          <li>Planned sources are not connected. “Unavailable” means automated retrieval was refused or terms were not met.</li>
          <li>Editorial notes and AI-assisted synthesis are labelled in the reader and are not presented as historical sources.</li>
        </ul>
      </section>
    </div>
  );
}
