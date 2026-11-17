import { useEffect, useState } from "react";
import { Link, navigate } from "../router";
import { api } from "../api";
import { useAuth } from "../auth";
import {
  Badge, ErrorState, Icon, Loading, SearchForm, SectionHeading, type Site,
} from "../components";

type HomeData = {
  featured: any[];
  recent: any[];
  traditions: any[];
  themes: any[];
  comparisons: any[];
  stats: { works: number; passages: number; traditions: number; commentaries: number; themes: number };
};

export function HomePage({ site }: { site: Site }) {
  const { user } = useAuth();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<any[]>([]);
  const [progress, setProgress] = useState<any[]>([]);

  useEffect(() => {
    api<HomeData>("/api/home").then(setData).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    try {
      setRecent(JSON.parse(localStorage.getItem("uwl_recent") || "[]").slice(0, 4));
    } catch {}
  }, []);

  useEffect(() => {
    if (!user) { setProgress([]); return; }
    api<any>("/api/progress").then((r) => setProgress((r.progress || []).slice(0, 3))).catch(() => {});
  }, [user]);

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-inner">
          <p className="eyebrow">A library across traditions</p>
          <h1>Read the world’s wisdom<br /><em>in its own words.</em></h1>
          <p className="hero-lede">
            Primary texts, translations and commentary from Jewish, Christian, Islamic, Hindu,
            Buddhist, Sikh, Taoist, Confucian, Zoroastrian, Jain and Shinto traditions — with
            the edition and provenance of every passage in view.
          </p>
          <SearchForm />
          <div className="hero-stats" aria-label="Corpus statistics">
            <span><strong>{data?.stats.works ?? "—"}</strong> works</span>
            <span><strong>{data?.stats.passages ?? "—"}</strong> passages</span>
            <span><strong>{data?.stats.traditions ?? "—"}</strong> traditions</span>
            <span><strong>{data?.stats.commentaries ?? "—"}</strong> commentary entries</span>
          </div>
          <p className="corpus-flag">
            <Badge tone="muted">{site.corpusLabel}</Badge>
            <span>Every text is read from the project that hosts it; the <Link to="/sources">source registry</Link> records its edition, source and rights.</span>
          </p>
        </div>
      </section>

      {error && <div className="container"><ErrorState message={error} /></div>}
      {!data && !error && <div className="container"><Loading label="Opening the catalogue" /></div>}

      {data && (
        <>
          <section className="container section">
            <SectionHeading title="Browse by tradition" description="Not every tradition has a single canon. These categories are navigational, not doctrinal." action={<Link className="text-link" to="/library">Full catalogue <Icon name="arrow-right" size={15} /></Link>} />
            <div className="tradition-grid">
              {data.traditions.map((t) => (
                <Link key={t.slug} to={`/library?tradition=${encodeURIComponent(t.slug)}`} className="tradition-card">
                  <span className="tradition-symbol" aria-hidden="true">{t.symbol || "·"}</span>
                  <span className="tradition-name">{t.name}</span>
                  <span className="tradition-count">{t.works} {t.works === 1 ? "work" : "works"}</span>
                  <span className="tradition-desc">{t.description}</span>
                </Link>
              ))}
            </div>
          </section>

          <section className="container section alt">
            <SectionHeading title="Featured texts" description="Foundational works with complete books or curated passages in the library." action={<Link className="text-link" to="/library">Browse all <Icon name="arrow-right" size={15} /></Link>} />
            <div className="work-grid">
              {data.featured.map((w) => (
                <article key={w.slug} className="work-card">
                  <div className="work-card-top">
                    <Badge tone="accent">{w.tradition.name}</Badge>
                    {w.editionCount ? <Badge tone="green">{w.editionCount} editions</Badge> : <Badge tone="warn">Catalogue only</Badge>}
                  </div>
                  <h3><Link to={`/work/${w.slug}`}>{w.title}</Link></h3>
                  {w.originalTitle && <p className="work-original" dir={w.originalDirection || undefined}>{w.originalTitle}</p>}
                  <p className="work-summary">{w.description}</p>
                  <footer>
                    <span>{w.author ? `${w.author.name}${w.author.attributed ? " (traditional)" : ""}` : "Anonymous"}</span>
                    <span>{w.dateDisplay}</span>
                  </footer>
                </article>
              ))}
            </div>
          </section>

          <section className="container section">
            <SectionHeading title="Themes across traditions" description="Curated entry points. A shared theme is not a claim that two passages say the same thing." action={<Link className="text-link" to="/themes">All themes <Icon name="arrow-right" size={15} /></Link>} />
            <div className="theme-grid">
              {data.themes.map((t) => (
                <Link key={t.slug} to={`/themes/${t.slug}`} className="theme-card">
                  <h3>{t.name}</h3>
                  <p>{t.description}</p>
                  <span className="theme-count">{t.passages} passages · {t.traditions.length} traditions</span>
                </Link>
              ))}
            </div>
          </section>

          <section className="container section alt">
            <SectionHeading title="Curated comparative readings" description="Editorially assembled, with the type of connection stated for every passage." action={<Link className="text-link" to="/compare">Open comparison workspace <Icon name="arrow-right" size={15} /></Link>} />
            <div className="comparison-grid">
              {data.comparisons.map((c) => (
                <article key={c.id ?? c.token ?? c.title} className="comparison-card">
                  <p className="eyebrow">Curated comparison</p>
                  <h3><Link to={`/compare?c=${encodeURIComponent(c.token)}`}>{c.title}</Link></h3>
                  <p>{c.description}</p>
                  <div className="mini-refs">
                    {c.passages.slice(0, 4).map((i: any, idx: number) => (
                      <span key={idx} className="mini-ref"><strong>{i.workTitle}</strong> {i.reference}</span>
                    ))}
                  </div>
                  <Link className="text-link" to={`/compare?c=${encodeURIComponent(c.token)}`}>Read the comparison <Icon name="arrow-right" size={15} /></Link>
                </article>
              ))}
            </div>
          </section>

          <section className="container section">
            <div className="personal-band">
              <div>
                <p className="eyebrow">Your study</p>
                <h2>{user ? `Welcome back, ${user.displayName.split(" ")[0]}.` : "Continue where you left off."}</h2>
                {user ? (
                  progress.length ? (
                    <ul className="progress-list">
                      {progress.map((p) => (
                        <li key={p.workSlug}>
                          <Link to={p.lastRef ? `/read/${p.workSlug}?ref=${encodeURIComponent(p.lastRef)}` : `/read/${p.workSlug}`}>{p.workTitle}</Link>
                          <span>{p.lastRefLabel || "Started"} · {new Date(p.updatedAt).toLocaleDateString()}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="muted">No reading progress yet. Open a text and your place will be kept here.</p>
                ) : (
                  <p className="muted">
                    Sign in to keep bookmarks, private notes, reading progress and saved comparisons across visits.
                  </p>
                )}
                <div className="button-row">
                  {user ? <Link className="button" to="/study">Go to my study</Link> : <Link className="button primary" to="/account">Create a free account</Link>}
                  <Link className="button ghost" to="/library">Browse the library</Link>
                </div>
              </div>
              <div>
                <p className="eyebrow">Recently viewed</p>
                {recent.length ? (
                  <ul className="recent-list">
                    {recent.map((r) => (
                      <li key={`${r.slug}-${r.ref}`}>
                        <Link to={`/read/${r.slug}?ref=${encodeURIComponent(r.ref)}`}>{r.title}</Link>
                        <span>{r.refLabel}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">Passages you open appear here on this device.</p>
                )}
                <Link className="text-link" to="/themes">Explore a theme <Icon name="arrow-right" size={15} /></Link>
              </div>
            </div>
          </section>

          <section className="container section">
            <div className="principle-grid">
              <div>
                <p className="eyebrow">What this is</p>
                <p className="principle-text">A textual research platform: primary sources in their own languages, labelled translations, and commentary that is visibly separate from scripture.</p>
              </div>
              <div>
                <p className="eyebrow">What it is not</p>
                <p className="principle-text">A quotation feed, a devotional authority, or a chatbot speaking in place of the texts. The assistant cites what it can and says when it cannot.</p>
              </div>
              <div>
                <p className="eyebrow">What is connected</p>
                <p className="principle-text">The corpus, search and accounts run on this installation. No third-party scripture API, translation service or AI model is currently connected.</p>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
