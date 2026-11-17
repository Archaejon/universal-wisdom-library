import { useEffect, useState } from "react";
import { Link, useNavigate } from "../router";
import { api } from "../api";
import { Badge, ErrorState, Icon, Loading, PageIntro, SampleBadge, useToast } from "../components";

export function ThemesPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<any>("/api/themes").then(setData).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="container page">
      <PageIntro
        eyebrow="Themes & concepts"
        title="Recurring questions across traditions"
        lede="Themes are editorial entry points, not claims that traditions agree. Each passage is presented inside its own work and commentary."
      />
      {error && <ErrorState message={error} />}
      {!data && !error && <Loading label="Loading themes" />}
      {data && (
        <div className="theme-index">
          {data.themes.map((t: any) => (
            <Link key={t.slug} className="theme-index-item" to={`/themes/${t.slug}`}>
              <div className="theme-index-head">
                <h2>{t.name}</h2>
                <span className="theme-count">{t.passages} {t.passages === 1 ? "passage" : "passages"}</span>
              </div>
              {t.question && <p className="theme-question">{t.question}</p>}
              <p>{t.description}</p>
              <span className="text-link">Explore theme <Icon name="arrow-right" size={14} /></span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function ThemePage({ slug }: { slug: string }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const { push } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    setData(null);
    setError("");
    api<any>(`/api/themes/${encodeURIComponent(slug)}`).then(setData).catch((e) => setError(e.message));
  }, [slug]);

  const addToCompare = (work: string, reference: string) => {
    const key = `${work}:${reference}`;
    try {
      const list = JSON.parse(localStorage.getItem("uwl_compare") || "[]");
      if (!list.includes(key)) list.push(key);
      localStorage.setItem("uwl_compare", JSON.stringify(list.slice(-8)));
      push("Added to the comparison workspace.", "success");
    } catch { push("Could not update the comparison workspace.", "error"); }
  };

  const compareAll = () => {
    const keys = (data?.groups ?? []).flatMap((g: any) => g.passages.slice(0, 1).map((p: any) => `${p.work}:${p.reference}`)).slice(0, 6);
    if (!keys.length) return;
    navigate(`/compare?p=${encodeURIComponent(keys.join(","))}`);
  };

  if (error) return <div className="container page"><ErrorState message={error} /></div>;
  if (!data) return <div className="container page"><Loading label="Loading theme" /></div>;

  return (
    <div className="container page">
      <nav className="breadcrumb"><Link to="/themes">Themes</Link> / <span>{data.theme.name}</span></nav>
      <header className="theme-header">
        <p className="eyebrow">Theme</p>
        <h1>{data.theme.name}</h1>
        {data.theme.question && <p className="theme-question large">{data.theme.question}</p>}
        <p className="lede">{data.theme.description}</p>
        <div className="button-row">
          <button className="button primary" onClick={compareAll} disabled={!data.groups.length}>Compare one passage per tradition</button>
          <Link className="button" to={`/search?q=${encodeURIComponent(data.theme.name)}&mode=concept`}>Search this theme</Link>
        </div>
        <p className="caution">
          A shared theme is not a claim of equivalence, dependence or historical influence. Read each passage with its own commentary and context.
        </p>
      </header>

      {data.groups.length === 0 && <p className="muted">No passages are currently associated with this theme.</p>}
      <div className="theme-groups">
        {data.groups.map((g: any) => (
          <section key={g.traditionSlug} className="theme-group">
            <div className="theme-group-head">
              <h2>{g.tradition}</h2>
              <Link className="text-link" to={`/library?tradition=${encodeURIComponent(g.traditionSlug)}`}>Browse {g.tradition} <Icon name="arrow-right" size={14} /></Link>
            </div>
            {g.passages.map((p: any) => (
              <article key={p.passageId} className="theme-passage">
                <div className="theme-passage-head">
                  <div>
                    <h3><Link to={`/read/${p.work}?ref=${encodeURIComponent(p.reference)}`}>{p.workTitle} {p.reference}</Link></h3>
                    <p className="muted small">{p.label}{p.school ? ` · ${p.school}` : ""}{p.dateDisplay ? ` · ${p.dateDisplay}` : ""}</p>
                  </div>
                  <Badge>{g.tradition}</Badge>
                </div>
                {p.text ? (
                  <blockquote className="theme-quote">{p.text}</blockquote>
                ) : (
                  <p className="muted small">
                    {p.streaming
                      ? `This passage is streamed from ${p.streaming}; open it to read the text with its edition and source.`
                      : "Text unavailable for this passage."}
                  </p>
                )}
                {p.note && <p className="theme-note"><strong>Editorial note:</strong> {p.note}</p>}
                {p.relevance && <p className="small muted">Relevance: {p.relevance}</p>}
                <div className="button-row">
                  <Link className="button small" to={`/read/${p.work}?ref=${encodeURIComponent(p.reference)}`}>Read in context</Link>
                  <button className="button small ghost" onClick={() => addToCompare(p.work, p.reference)}>Add to comparison</button>
                </div>
              </article>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
