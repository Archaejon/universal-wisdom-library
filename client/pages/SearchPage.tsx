import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "../router";
import { api } from "../api";
import { Badge, ErrorState, Icon, Loading, PageIntro, SearchForm, SearchResultSnippet } from "../components";

const FILTER_KEYS = new Set(["q", "mode", "tradition", "work", "language", "era", "shelf", "provider"]);

export function SearchPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const q = params.get("q") || "";
  const mode = params.get("mode") || "keyword";
  const tradition = params.get("tradition") || "";
  const work = params.get("work") || "";
  const language = params.get("language") || "";
  const era = params.get("era") || "";
  const shelf = params.get("shelf") || "";
  const provider = params.get("provider") || "";
  const page = Math.max(1, Number(params.get("page") || 1));
  const streamScoped = Boolean(shelf || provider);

  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  // Every work is 758 KB of a search response, so the dropdown asks for its
  // options when it is first used — or at once when the URL already filters by
  // one, so the select can show the selection.
  const [workOptions, setWorkOptions] = useState<{ value: string; label: string }[] | null>(null);
  const loadWorkOptions = () => {
    if (workOptions) return;
    setWorkOptions([]);
    api<{ works: { value: string; label: string }[] }>("/api/facets/works")
      .then((result) => setWorkOptions(result.works ?? []))
      .catch(() => setWorkOptions([]));
  };

  useEffect(() => {
    if (work) loadWorkOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work]);

  useEffect(() => {
    if (!q) { setData(null); return; }
    setError("");
    const qs = new URLSearchParams(location.search);
    api<any>(`/api/search?${qs.toString()}`).then(setData).catch((e) => setError(e.message));
  }, [location.search, q]);

  // Sefaria is a host this library does not run, and it can take seconds to
  // answer. Asking for those results separately lets the local and indexed
  // results render at once; the live section fills in when they arrive, and a
  // search that is replaced before then is ignored.
  useEffect(() => {
    if (!q || streamScoped || page !== 1) return;
    let current = true;
    api<any>(`/api/search/live?q=${encodeURIComponent(q)}`)
      .then((live) => {
        if (current && live?.streamed) setData((previous: any) => (previous ? { ...previous, streamed: live.streamed } : previous));
      })
      .catch(() => {});
    return () => { current = false; };
  }, [location.search, q, streamScoped, page]);

  const providerHits = (key: string) =>
    data?.streamIndex?.providerCounts?.find((entry: any) => entry.provider === key)?.hits ?? 0;
  const shelfHits = (entry: any) =>
    entry.providers.reduce((total: number, item: any) => total + providerHits(item.provider), 0);
  const singleProviderShelf = data?.streamIndex?.shelves?.find(
    (entry: any) => entry.providers.length === 1 && entry.providers[0].provider === provider,
  );
  const streamFilter = shelf
    ? `shelf:${shelf}`
    : provider
      ? singleProviderShelf
        ? `shelf:${singleProviderShelf.slug}`
        : `provider:${provider}`
      : "";

  const apply = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    // A new query or filter starts both result sets at page one. Paging one
    // set otherwise leaves the other exactly where the reader left it.
    if (Object.keys(patch).some((key) => FILTER_KEYS.has(key))) {
      next.delete("page");
      next.delete("streamPage");
    }
    navigate(`/search?${next.toString()}`);
  };

  const goToStreamPage = (target: number) =>
    apply(streamScoped ? { page: String(target) } : { streamPage: String(target) });

  return (
    <div className="container page search-page">
      <PageIntro
        eyebrow="Universal search"
        title="Search across traditions"
        lede="Full-text search across locally held editions, the OpenITI Arabic shelf, and the Qur'an, hadith and SuttaCentral shelves indexed for search, alongside Sefaria's live API. Arabic, Hebrew, Pali and Latin scripts are normalised for retrieval without changing the displayed text. Results show which edition matched and why."
      />
      <SearchForm initial={q} mode={mode} onSearch={(value, m) => apply({ q: value, mode: m, page: null })} />

      {q && (
        <div className="search-layout">
          <aside className="filters" aria-label="Search filters">
            <div className="filter-group">
              <label htmlFor="s-tradition">Tradition</label>
              <select id="s-tradition" value={tradition} onChange={(e) => apply({ tradition: e.target.value || null })}>
                <option value="">All traditions</option>
                {data?.facets.traditions.map((t: any) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="filter-group">
              <label htmlFor="s-work">Work</label>
              <select id="s-work" value={work} onFocus={loadWorkOptions} onChange={(e) => apply({ work: e.target.value || null })}>
                <option value="">All works</option>
                {workOptions
                  ? workOptions.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)
                  : data?.workOption
                    ? <option value={data.workOption.value}>{data.workOption.label}</option>
                    : null}
              </select>
            </div>
            {data?.streamIndex?.shelves?.length > 0 && (
              <div className="filter-group">
                <label htmlFor="s-shelf">Shelf / provider</label>
                <select
                  id="s-shelf"
                  value={streamFilter}
                  onChange={(e) => {
                    if (!e.target.value) return apply({ shelf: null, provider: null });
                    const [kind, key] = e.target.value.split(":");
                    if (kind === "shelf") apply({ shelf: key, provider: null });
                    else apply({ provider: key, shelf: null });
                  }}
                >
                  <option value="">All indexed providers</option>
                  {data.streamIndex.shelves.map((entry: any) => (
                    <optgroup key={entry.slug} label={entry.label}>
                      {entry.providers.length === 1 ? (
                        <option value={`shelf:${entry.slug}`}>
                          {entry.label} — {shelfHits(entry)} hits
                        </option>
                      ) : (
                        <>
                          <option value={`shelf:${entry.slug}`}>
                            {entry.label} — {shelfHits(entry)} hits
                          </option>
                          {entry.providers.map((item: any) => (
                            <option key={item.provider} value={`provider:${item.provider}`}>
                              {item.shortLabel} — {providerHits(item.provider)} hits
                            </option>
                          ))}
                        </>
                      )}
                    </optgroup>
                  ))}
                </select>
                <p className="filter-hint">
                  Counts follow the current query. Selecting a shelf hides locally held editions and Sefaria's live results.
                </p>
              </div>
            )}
            <div className="filter-group">
              <label htmlFor="s-language">Edition language</label>
              <select id="s-language" value={language} onChange={(e) => apply({ language: e.target.value || null })}>
                <option value="">All languages</option>
                {data?.facets.languages.map((l: any) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
            <div className="filter-group">
              <label htmlFor="s-era">Historical period</label>
              <select id="s-era" value={era} onChange={(e) => apply({ era: e.target.value || null })}>
                <option value="">Any period</option>
                {data?.facets.eras.map((e: any) => <option key={e.value} value={e.value}>{e.label}</option>)}
              </select>
            </div>
            <button className="button ghost small" onClick={() => navigate(`/search?q=${encodeURIComponent(q)}&mode=${mode}`)}>Clear filters</button>
            <p className="filter-note">
              Filters apply to the edition that matched. A passage may have other editions without the term.
            </p>
          </aside>

          <div className="search-results">
            {error && <ErrorState message={error} />}
            {!data && !error && <Loading label="Searching the corpus" />}
            {data && (
              <>
                <div className="results-bar">
                  <p>
                    <strong>{data.total}</strong> {data.total === 1 ? "passage" : "passages"} in local editions
                    {data.streamIndex && data.streamIndex.hits.length > 0 && (
                      <>
                        {" · "}
                        {data.streamIndex.pages > 1 ? (
                          <>
                            <strong>
                              {((data.streamIndex.page - 1) * data.streamIndex.pageSize + 1).toLocaleString()}
                              –{(data.streamIndex.page - 1) * data.streamIndex.pageSize + data.streamIndex.hits.length}
                            </strong>{" "}
                            of <strong>{data.streamIndex.total.toLocaleString()}</strong>{" "}
                          </>
                        ) : (
                          <><strong>{data.streamIndex.total.toLocaleString()}</strong>{" "}</>
                        )}
                        in indexed streamed editions
                        {data.streamIndex.pages > 1 && <> · page {data.streamIndex.page} of {data.streamIndex.pages}</>}
                      </>
                    )}{" "}
                    {data.streamed && data.streamed.hits.length > 0 && (
                      <> · <strong>{data.streamed.hits.length}</strong> streamed from {data.streamed.providerLabel}</>
                    )}{" "}for <em>“{data.query}”</em>
                  </p>
                  <p className="muted small">
                    {data.engine && <>Retrieved by {data.engine}. </>}
                    {data.mode === "concept" ? "Concept mode" : data.mode === "phrase" ? "Exact phrase" : "Keyword mode"}
                  </p>
                </div>
                {data.note && <p className="search-note">{data.note}</p>}
                {data.streamIndex && !data.streamIndex.available && (
                  <p className="filter-note">{data.streamIndex.note}</p>
                )}

                {data.streamIndex?.providerCounts?.length > 0 && (
                  <div className="provider-hit-row" aria-label="Indexed hits by provider">
                    <span className="provider-hit-label">Indexed hits</span>
                    {data.streamIndex.providerCounts.map((entry: any) => {
                      const active = provider === entry.provider;
                      return (
                        <button
                          key={entry.provider}
                          type="button"
                          className={`chip${active ? " active" : ""}`}
                          aria-pressed={active}
                          onClick={() =>
                            apply(active ? { provider: null } : { provider: entry.provider, shelf: null })
                          }
                        >
                          {entry.shortLabel} <span className="chip-meta">{entry.hits}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {data.works.length > 0 && (
                  <section className="metadata-matches">
                    <h2>Works & authors</h2>
                    <div className="chip-row">
                      {data.works.map((w: any) => (
                        <Link key={w.slug} className="chip" to={`/work/${w.slug}`}>
                          {w.title} <span className="chip-meta">{w.tradition}{w.author ? ` · ${w.author}` : ""}</span>
                        </Link>
                      ))}
                    </div>
                  </section>
                )}

                {data.streamIndex && data.streamIndex.hits.length > 0 && (
                  <section className="metadata-matches streamed-results">
                    <h2>
                      Indexed streamed editions <Badge tone="neutral">full text</Badge>
                    </h2>
                    <p className="filter-note">
                      {data.streamIndex.stats.label}. Text is indexed from the providers that host it; the displayed
                      edition is unchanged. Pointing, diacritics and common Arabic and Hebrew prefixes are handled by the index.
                    </p>
                    <div className="streamed-list">
                      {data.streamIndex.hits.map((h: any) => (
                        <article key={`${h.work.slug}:${h.reference}`} className="result-item">
                          <div className="result-item-head">
                            <Link className="result-ref" to={`/read/${h.work.slug}?ref=${encodeURIComponent(h.reference)}`}>
                              {h.work.title} {h.reference} <span>{h.label}</span>
                            </Link>
                            <Badge tone="neutral">{h.tradition.name}</Badge>
                          </div>
                          <p className="result-snippet"><SearchResultSnippet text={h.snippet} terms={h.matchedTerms.length ? h.matchedTerms : [data.query]} /></p>
                          <p className="result-why">{h.why}</p>
                          <p className="result-source">
                            {h.edition.title}{h.edition.source?.name ? ` · ${h.edition.source.name}` : ""}
                            {h.edition.license?.name ? ` · ${h.edition.license.name}` : ""}
                          </p>
                          <Link className="text-link" to={`/read/${h.work.slug}?ref=${encodeURIComponent(h.reference)}`}>
                            Open in reader <Icon name="arrow-right" size={14} />
                          </Link>
                        </article>
                      ))}
                    </div>
                    {data.streamIndex.pages > 1 && (
                      <nav className="pagination stream-pagination" aria-label="Indexed streamed result pages">
                        <button
                          className="button small"
                          disabled={data.streamIndex.page <= 1}
                          onClick={() => goToStreamPage(data.streamIndex.page - 1)}
                        >
                          <Icon name="arrow-left" size={15} /> Previous
                        </button>
                        <span>Page {data.streamIndex.page} of {data.streamIndex.pages}</span>
                        <button
                          className="button small"
                          disabled={data.streamIndex.page >= data.streamIndex.pages}
                          onClick={() => goToStreamPage(data.streamIndex.page + 1)}
                        >
                          Next <Icon name="arrow-right" size={15} />
                        </button>
                      </nav>
                    )}
                  </section>
                )}

                {data.streamed && data.streamed.hits.length > 0 && (
                  <section className="metadata-matches streamed-results">
                    <h2>
                      Live from {data.streamed.providerLabel} <Badge tone="neutral">streamed</Badge>
                    </h2>
                    <p className="filter-note">{data.streamed.note}</p>
                    <div className="streamed-list">
                      {data.streamed.hits.map((h: any) => (
                        <article key={`${h.workSlug}:${h.reference}`} className="result-item">
                          <div className="result-item-head">
                            <Link className="result-ref" to={`/read/${h.workSlug}?ref=${encodeURIComponent(h.reference)}`}>
                              {h.workTitle} {h.reference} <span>{h.label}</span>
                            </Link>
                            <Badge tone="neutral">{h.tradition}</Badge>
                          </div>
                          <p className="result-snippet">{h.snippet}</p>
                          <p className="result-source">
                            {h.editionTitle || "Edition chosen by the hosting project"} · via {data.streamed.providerLabel}
                          </p>
                          <Link className="text-link" to={`/read/${h.workSlug}?ref=${encodeURIComponent(h.reference)}`}>
                            Open in reader <Icon name="arrow-right" size={14} />
                          </Link>
                        </article>
                      ))}
                    </div>
                    <a className="text-link" href={data.streamed.externalUrl} target="_blank" rel="noreferrer noopener">
                      See the full result set at {data.streamed.providerLabel} <Icon name="arrow-right" size={14} />
                    </a>
                  </section>
                )}

                {data.total === 0 && (!data.streamIndex || data.streamIndex.hits.length === 0) && (!data.streamed || data.streamed.hits.length === 0) ? (
                  <div className="empty-panel">
                    <h3>No passage matched.</h3>
                    <p>
                      Try fewer words, a different form of the word, or switch to <strong>Concept</strong> mode.
                      {data.mode !== "phrase" && " Exact phrase mode requires the words in the same order."}
                    </p>
                    <div className="button-row">
                      <button className="button" onClick={() => apply({ mode: "concept", page: null })}>Try concept search</button>
                      <button className="button ghost" onClick={() => apply({ mode: "keyword", page: null })}>Try keyword search</button>
                    </div>                      <p className="small muted">
                        {shelf || provider
                          ? "No indexed passage in the selected shelf matched. Choose another shelf or All indexed providers."
                          : `Locally held text and the indexed streamed works are searched here. Works streamed from Sefaria are searched directly at the source; ${data.streamed ? "no Sefaria reference matched this query." : "nothing was matched there either."}`}
                        {data.streamIndex && !data.streamIndex.available && ` ${data.streamIndex.note}`}
                      </p>
                  </div>
                ) : data.total > 0 ? (
                  <div className="result-groups">
                    {data.groups.map((group: any) => (
                      <section key={group.tradition.slug} className="result-group">
                        <div className="result-group-head">
                          <h2>{group.tradition.name}</h2>
                          <Link className="text-link" to={`/library?tradition=${encodeURIComponent(group.tradition.slug)}`}>Browse tradition <Icon name="arrow-right" size={14} /></Link>
                        </div>
                        {group.works.map((wg: any) => (
                          <div key={wg.work.slug} className="result-work">
                            <h3><Link to={`/work/${wg.work.slug}`}>{wg.work.title}</Link> {wg.work.dateDisplay && <span className="muted small">{wg.work.dateDisplay}</span>}</h3>
                            {wg.results.map((r: any) => (
                              <article key={r.passageId} className="result-item">
                                <div className="result-item-head">
                                  <Link className="result-ref" to={`/read/${r.work.slug}?ref=${encodeURIComponent(r.reference)}${r.edition?.slug ? `&version=${encodeURIComponent(r.edition.slug)}` : ""}`}>
                                    {r.reference} <span>{r.label}</span>
                                  </Link>
                                  <Badge tone="neutral">{r.edition.language.name}{r.edition.editionType === "original" ? " original" : ""}</Badge>
                                </div>
                                <p className="result-snippet"><SearchResultSnippet text={r.snippet} terms={r.matchedTerms.length ? r.matchedTerms : [data.query]} /></p>
                                <p className="result-why">{r.why}</p>
                                <p className="result-source">
                                  {r.edition.title}{r.edition.translator ? ` · trans. ${r.edition.translator}` : ""}{r.edition.publicationYear ? ` · ${r.edition.publicationYear}` : ""}
                                  {r.edition.source?.name ? ` · ${r.edition.source.name}` : ""}
                                  {r.edition.license?.name ? ` · ${r.edition.license.name}` : ""}
                                </p>
                                <Link className="text-link" to={`/read/${r.work.slug}?ref=${encodeURIComponent(r.reference)}`}>Open in reader <Icon name="arrow-right" size={14} /></Link>
                              </article>
                            ))}
                          </div>
                        ))}
                      </section>
                    ))}
                  </div>
                ) : null}

                {data.pages > 1 && (
                  <nav className="pagination" aria-label="Search result pages">
                    <button className="button small" disabled={page <= 1} onClick={() => apply({ page: String(page - 1) })}><Icon name="arrow-left" size={15} /> Previous</button>
                    <span>Page {page} of {data.pages}</span>
                    <button className="button small" disabled={page >= data.pages} onClick={() => apply({ page: String(page + 1) })}>Next <Icon name="arrow-right" size={15} /></button>
                  </nav>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {!q && (
        <div className="search-start">
          <h2>What you can search</h2>
          <div className="three-col">
            <div><h3>Words</h3><p>Keyword search matches across originals and translations. Arabic pointing, Hebrew niqqud, final letters and common attached prefixes are normalised for retrieval but never altered in the reader.</p></div>
            <div><h3>Phrases</h3><p>Exact phrase mode finds adjacent words in a single edition, useful for tracing a quotation or a known translation.</p></div>
            <div><h3>Concepts</h3><p>A curated lexicon maps a question to themes and search terms. It shows why a passage was retrieved and does not claim passages are equivalent.</p></div>
          </div>
        </div>
      )}
    </div>
  );
}
