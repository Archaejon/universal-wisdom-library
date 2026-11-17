import { useEffect, useState } from "react";
import { Link, useLocation } from "../router";
import { api } from "../api";
import { Badge, AvailabilityBadge, CopyButton, EditionSourceLine, ErrorState, Icon, Loading, SampleBadge, SectionHeading } from "../components";

const FUNCTION_LABELS: Record<string, string> = {
  canonical_scripture: "Canonical scripture",
  non_canonical_religious_text: "Non-canonical religious text",
  foundational_revelation: "Foundational revelation",
  prayer_liturgy: "Prayer and liturgy",
  commentary_exegesis: "Commentary and exegesis",
  religious_law_practice: "Religious law and practice",
  historical_document: "Historical document",
  sermon_speech: "Sermon or speech",
  philosophical_work: "Philosophical work",
  mystical_contemplative: "Mystical or contemplative writing",
  ethical_humanist_manifesto: "Ethical or humanist manifesto",
  community_statement: "Community statement",
  creed_confession: "Creed or confession",
  denominational_guidance: "Denominational guidance",
  academic_scholarship: "Academic scholarship",
  contemporary_spiritual_writing: "Contemporary spiritual writing",
  oral_history_transcription: "Oral-history transcription",
  community_authorised_knowledge: "Community-authorised cultural knowledge",
};

const REL_LABELS: Record<string, string> = {
  explicit_citation: "Explicit citation",
  quotation: "Quotation",
  traditional_commentary: "Traditional commentary",
  translation: "Translation relationship",
  historical_influence: "Historical influence",
  parallel_narrative: "Parallel narrative",
  shared_theme: "Shared theme",
  scholarly_comparison: "Scholarly comparison",
  curated_connection: "Editorially curated connection",
};

function StructureChapter({ chapter, slug }: { chapter: any; slug: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="structure-chapter" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <span>{chapter.label}</span>
        <span className="muted small">{chapter.passages.length} {chapter.passages.length === 1 ? "passage" : "passages"}</span>
      </summary>
      {open && (
        <div className="structure-passages">
          {chapter.passages.map((p: any) => (
            <Link key={p.id} to={`/read/${slug}?ref=${encodeURIComponent(p.reference)}`} className="structure-passage">
              <span className="ref">{p.reference}</span>
              <span>{p.label}</span>
              <span className="muted small">{p.languages.join(" · ")}</span>
            </Link>
          ))}
        </div>
      )}
    </details>
  );
}

export function WorkPage({ slug }: { slug: string }) {
  const location = useLocation();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setData(null);
    setError("");
    api<any>(`/api/works/${encodeURIComponent(slug)}`).then(setData).catch((e) => setError(e.message));
  }, [slug]);

  if (error) return <div className="container page"><ErrorState message={error} /></div>;
  if (!data) return <div className="container page"><Loading label="Opening the work" /></div>;

  const w = data.work;
  const languageNames = [...new Set(data.editions.map((e: any) => e.language?.name).filter(Boolean))] as string[];
  const firstRef = data.passages[0]?.reference;
  const shareUrl = `${window.location.origin}${location.pathname}`;

  return (
    <div className="container page work-page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/library">Library</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/library?tradition=${encodeURIComponent(w.tradition.slug)}`}>{w.tradition.name}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{w.title}</span>
      </nav>

      <header className="work-hero">
        <div className="work-hero-main">
          <div className="catalogue-badges">
            <Badge tone="accent">{w.tradition.name}</Badge>
            {w.school && <Badge>{w.school.name}</Badge>}
            <Badge>{w.genre}</Badge>
            <AvailabilityBadge available={data.passages.length > 0} />
            {w.isSample && <SampleBadge />}
          </div>
          <h1>{w.title}</h1>
          {w.originalTitle && <p className="work-original large" dir={w.originalLanguage.direction === "rtl" ? "rtl" : undefined}>{w.originalTitle}</p>}
          {w.transliteration && <p className="transliteration">{w.transliteration}</p>}
          {w.altTitles.length > 0 && (
            <p className="alt-titles">Also known as {w.altTitles.join("; ")}.</p>
          )}
          <p className="work-lede">{w.description}</p>
          <div className="work-facts">
            <div><span className="fact-label">Attribution</span><span>{w.author ? w.author.name : "Anonymous"}{w.author?.attributed ? " (traditional)" : ""}</span></div>
            <div><span className="fact-label">Approximate date</span><span>{w.dateDisplay}</span></div>
            <div><span className="fact-label">Original language</span><span>{w.originalLanguage.name}{w.originalLanguage.nativeName ? ` · ${w.originalLanguage.nativeName}` : ""}</span></div>
            <div><span className="fact-label">Text type</span><span>{w.textType}</span></div>
          </div>
          {w.authorshipStatus && (
            <p className="scholarly-note"><strong>On authorship:</strong> {w.authorshipStatus}{w.attributionNote ? ` ${w.attributionNote}` : ""}</p>
          )}
          {data.streaming && (
            <p className="scholarly-note stream-work-note">
              <strong>Streamed text:</strong> read live from {data.streaming.providerLabel} ({data.streaming.upstream}).
              This library stores the catalogue record, chapter outline and passage index for this work, not a copy of its text.
            </p>
          )}
          <div className="button-row">
            {data.passages.length > 0 && (
              <Link className="button primary" to={`/read/${w.slug}`}>Read the text</Link>
            )}
            <Link className="button" to={`/compare?p=${encodeURIComponent(`${w.slug}:${firstRef ?? "1"}`)}`} aria-disabled={!firstRef}>Add to comparison</Link>
            <CopyButton text={shareUrl} label="Share this work" />
          </div>
        </div>
        <aside className="work-aside">
          <h2 className="aside-title">At a glance</h2>
          <dl className="aside-list">
            <div><dt>Passages</dt><dd>{w.passageCount}</dd></div>
            <div><dt>Editions</dt><dd>{w.editionCount}</dd></div>
            <div><dt>Commentary</dt><dd>{data.commentaryCount}</dd></div>
            <div><dt>Languages</dt><dd>{languageNames.length ? languageNames.join(", ") : "—"}</dd></div>
          </dl>
          <h2 className="aside-title">Rights</h2>
          {data.editions.length === 0 ? <p className="muted small">No imported edition, so no rights record to display.</p> : (
            <ul className="rights-list">
              {[...new Set(data.editions.map((e: any) => e.license?.name).filter(Boolean))].map((l: any) => <li key={l}>{l}</li>)}
            </ul>
          )}
          <p className="small muted">See <Link to="/provenance">sources & provenance</Link> for the full record.</p>
        </aside>
      </header>

      {w.historicalContext && (
        <section className="prose-section narrow">
          <h2>Historical context</h2>
          <p>{w.historicalContext}</p>
        </section>
      )}

      {data.textFunctions?.length > 0 && (
        <section className="prose-section narrow textual-function-section">
          <h2>Textual function</h2>
          <p className="muted small">
            These classify how the work functions, not whether its claims are true. A work can carry several classifications; a community may dispute them.
          </p>
          <div className="chip-row">
            {data.textFunctions.map((f: any) => (
              <Badge key={f.function} tone={f.status === "disputed" ? "warn" : "muted"}>
                {FUNCTION_LABELS[f.function] ?? f.function.replaceAll("_", " ")}
              </Badge>
            ))}
          </div>
          {data.textFunctions[0]?.note && <p>{data.textFunctions[0].note}</p>}
          <p className="small muted">
            Classification: {data.textFunctions[0]?.status ?? "provisional"} · recorded by {data.textFunctions[0]?.assignedBy || "UWL editors"}.
          </p>
        </section>
      )}

      <section className="prose-section">
        <SectionHeading title="Editions & translations" description="Each edition is a separate record with its own language, translator, source and licence. Readings never silently mix editions." />
        {data.editions.length === 0 ? (
          <div className="empty-panel">
            <h3>Catalogue record only</h3>
            <p>{w.availabilityNote || "No text edition has been imported for this work. It is listed for navigational and comparative context, not presented as readable scripture."}</p>
            <p className="small muted">The ingestion pipeline accepts a new adapter without changing the reader or schema.</p>
          </div>
        ) : (
          <div className="edition-list">
            {data.editions.map((e: any) => (
              <article key={e.id} className="edition-card">
                <div className="edition-card-main">
                  <div className="catalogue-badges">
                    <Badge tone={e.editionType === "original" ? "accent" : "neutral"}>{e.editionType === "original" ? "Original language" : "Translation"}</Badge>
                    <Badge>{e.language.name}</Badge>
                    {e.language.direction === "rtl" && <Badge tone="muted">Right to left</Badge>}
                    {e.isSample && <SampleBadge />}
                  </div>
                  <h3>{e.title}</h3>
                  <EditionSourceLine edition={e} />
                  {e.attributionText && <p className="attribution-text">{e.attributionText}</p>}
                  {e.notes && <p className="small muted">{e.notes}</p>}
                </div>
                <div className="edition-card-actions">
                  {data.passages.length > 0 ? (
                    <Link className="button small primary" to={`/read/${w.slug}?version=${encodeURIComponent(e.slug)}`}>Read this edition</Link>
                  ) : <span className="muted small">No text</span>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {data.chapters.length > 0 && (
        <section className="prose-section">
          <SectionHeading title="Structure" description={`Reference scheme: ${data.passages[0]?.reference?.includes(":") ? "chapter and verse" : "tradition-specific"}. Links are stable and shareable.`} />
          <div className="structure-list">
            {data.chapters.map((ch: any) => (
              <StructureChapter key={ch.ref} chapter={ch} slug={w.slug} />
            ))}
          </div>
        </section>
      )}

      {(data.themes.length > 0 || data.relationships.length > 0) && (
        <section className="prose-section">
          <SectionHeading title="Connections" description="The type of every connection is stated. Shared themes and editorial links are not evidence of historical influence." />
          {data.themes.length > 0 && (
            <div className="connection-block">
              <h3>Themes</h3>
              <div className="chip-row">
                {data.themes.map((t: any) => <Link key={t.slug} to={`/themes/${t.slug}`} className="chip">{t.name}</Link>)}
              </div>
            </div>
          )}
          {data.relationships.length > 0 && (
            <div className="connection-block">
              <h3>Textual relationships</h3>
              <ul className="relationship-list">
                {data.relationships.map((r: any) => {
                  const other = r.from?.work === w.slug ? r.to : r.from;
                  if (!other) return null;
                  return (
                    <li key={r.id}>
                      <Badge tone="blue">{REL_LABELS[r.type] ?? r.type}</Badge>
                      <div>
                        <Link to={`/read/${other.work}?ref=${encodeURIComponent(other.reference)}`}>{other.title} {other.reference}</Link>
                        {r.description && <p>{r.description}</p>}
                        {r.evidence && <p className="small muted">Evidence: {r.evidence}</p>}
                        <p className="small muted">Confidence: {r.confidence}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="prose-section">
        <div className="callout">
          <div>
            <h3>Something inaccurate?</h3>
            <p>Corrections and metadata suggestions are reviewed by an editor before they change the catalogue. Notes you write for yourself remain private.</p>
          </div>
          <Link className="button" to={`/editorial?target=work&targetId=${encodeURIComponent(w.slug)}`}>Suggest a correction</Link>
        </div>
      </section>
    </div>
  );
}
