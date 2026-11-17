import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "../router";
import { api } from "../api";
import { ErrorState, Icon, Loading, SearchForm } from "../components";

type ShelfData = {
  traditions: any[];
  selected: { tradition: any | null; category: any | null; work: any | null };
  categories: any[];
  works: any[];
  work: any | null;
  chapters: any[];
  editions: any[];
};

/**
 * The catalogue is one board, not a stack of pages: tradition, category, work
 * and chapter sit side by side so choosing a tradition opens its contents at
 * the same eye level instead of pushing them below the fold. Each column keeps
 * its own scroll, so a shelf of 39 books never drags the page with it.
 */
export function LibraryPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const traditionSlug = params.get("tradition") || "";
  const categorySlug = params.get("category") || "";
  const workSlug = params.get("work") || "";

  const [data, setData] = useState<ShelfData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // Subcategory headings are native disclosure widgets; remembering what the
  // reader opened keeps a group from closing when the theme or data changes.
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const qs = new URLSearchParams();
    if (traditionSlug) qs.set("tradition", traditionSlug);
    if (categorySlug) qs.set("category", categorySlug);
    if (workSlug) qs.set("work", workSlug);
    setError("");
    setLoading(true);
    api<ShelfData>(`/api/browse?${qs.toString()}`)
      .then((d) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [traditionSlug, categorySlug, workSlug]);

  const selectedTradition = data?.selected.tradition ?? null;
  const selectedCategory = data?.selected.category ?? null;
  const selectedWork = data?.selected.work ?? null;
  const activeWork = data?.work ?? null;
  const categories = data?.categories ?? [];
  const works = data?.works ?? [];
  const chapters = data?.chapters ?? [];
  const editions = data?.editions ?? [];

  const chooseTradition = (slug: string) => {
    navigate(slug ? `/library?tradition=${encodeURIComponent(slug)}` : "/library");
  };
  const chooseCategory = (slug: string) => {
    if (!traditionSlug) return;
    navigate(`/library?tradition=${encodeURIComponent(traditionSlug)}&category=${encodeURIComponent(slug)}`);
  };
  const chooseWork = (slug: string) => {
    if (!traditionSlug || !categorySlug) return;
    navigate(
      `/library?tradition=${encodeURIComponent(traditionSlug)}&category=${encodeURIComponent(categorySlug)}&work=${encodeURIComponent(slug)}`,
    );
  };

  // The API returns works already in canonical order, so grouping preserves
  // the Torah → Nevi'im → Ketuvim and seder-by-seder sequence.
  const groupedWorks = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const work of works) {
      const key = work.subcategory || "Works";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(work);
    }
    return [...groups.entries()];
  }, [works]);

  const originalEdition = editions.find((e: any) => e.editionType === "original") ?? null;
  const translationEdition = editions.find((e: any) => e.editionType === "translation") ?? null;

  return (
    <div className="container page library-page">
      <header className="library-head">
        <div>
          <p className="eyebrow">Catalogue</p>
          <h1>Browse the library</h1>
        </div>
        <div className="library-head-tools">
          <SearchForm
            compact
            initial={params.get("q") || ""}
            onSearch={(value) => navigate(`/search?q=${encodeURIComponent(value)}`)}
            placeholder="Search every text and translation"
          />
          <p className="muted small">
            {selectedTradition ? (
              <>
                <button className="crumb-link" onClick={() => chooseTradition("")}>All traditions</button>
                {" / "}
                {selectedTradition.name}
                {selectedCategory && <> / {selectedCategory.label}</>}
                {selectedWork && <> / {selectedWork.title}</>}
              </>
            ) : (
              "Tradition → category → work → chapter. Every shelf opens in place."
            )}
          </p>
        </div>
      </header>

      {error && <ErrorState message={error} />}
      {loading && !data && <Loading label="Opening the catalogue" />}

      {data && (
        <div className={loading ? "lib-board is-loading" : "lib-board"}>
          <section className="lib-col" aria-labelledby="lib-tradition-heading">
            <div className="lib-col-head">
              <h2 id="lib-tradition-heading">Tradition</h2>
              <span className="lib-col-count">{data.traditions.filter((t) => t.works > 0).length}</span>
            </div>
            <div className="lib-col-body">
              {data.traditions
                .filter((t) => t.works > 0 || selectedTradition?.slug === t.slug)
                .map((t) => (
                  <button
                    key={t.slug}
                    className={selectedTradition?.slug === t.slug ? "lib-item active" : "lib-item"}
                    onClick={() => chooseTradition(t.slug)}
                    aria-pressed={selectedTradition?.slug === t.slug}
                  >
                    <span className="lib-item-title">{t.name}</span>
                    <span className="lib-item-meta">
                      {t.works} {t.works === 1 ? "work" : "works"}
                    </span>
                  </button>
                ))}
            </div>
          </section>

          <section className="lib-col" aria-labelledby="lib-category-heading">
            <div className="lib-col-head">
              <h2 id="lib-category-heading">Category</h2>
              {selectedTradition && <span className="lib-col-count">{categories.length}</span>}
            </div>
            <div className="lib-col-body">
              {!selectedTradition ? (
                <p className="lib-hint">Choose a tradition to see its collections.</p>
              ) : categories.length === 0 ? (
                <p className="lib-hint">No categories are catalogued for this tradition yet.</p>
              ) : (
                categories.map((c) => (
                  <button
                    key={c.slug}
                    className={selectedCategory?.slug === c.slug ? "lib-item active" : "lib-item"}
                    onClick={() => chooseCategory(c.slug)}
                    aria-pressed={selectedCategory?.slug === c.slug}
                  >
                    <span className="lib-item-title">{c.label}</span>
                    <span className="lib-item-meta">{c.works} {c.works === 1 ? "work" : "works"}</span>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="lib-col lib-col-works" aria-labelledby="lib-work-heading">
            <div className="lib-col-head">
              <h2 id="lib-work-heading">Work</h2>
              {selectedCategory && <span className="lib-col-count">{works.length}</span>}
            </div>
            <div className="lib-col-body">
              {!selectedTradition ? (
                <p className="lib-hint">Works appear once a tradition is chosen.</p>
              ) : !selectedCategory ? (
                <p className="lib-hint">Choose a category to see its works in reading order.</p>
              ) : works.length === 0 ? (
                <p className="lib-hint">No works are catalogued in this category yet.</p>
              ) : (
                groupedWorks.map(([group, groupWorks]) => {
                  const isOpen = expandedGroups[group] ?? groupWorks.some((w) => w.slug === selectedWork?.slug);
                  return (
                    <details
                      className="lib-group"
                      key={group}
                      open={isOpen}
                      onToggle={(event) => {
                        const open = event.currentTarget.open;
                        setExpandedGroups((prev) => (prev[group] === open ? prev : { ...prev, [group]: open }));
                      }}
                    >
                      <summary className="lib-group-title">
                        <Icon name="chevron" size={14} />
                        <span>{group}</span>
                        <span className="lib-group-count">{groupWorks.length}</span>
                      </summary>
                      {groupWorks.map((w) => (
                        <button
                          key={w.slug}
                          className={selectedWork?.slug === w.slug ? "lib-item active" : "lib-item"}
                          onClick={() => chooseWork(w.slug)}
                          aria-pressed={selectedWork?.slug === w.slug}
                        >
                          <span className="lib-item-title">
                            {w.title}
                            {w.originalTitle && (
                              <span className="lib-item-original" dir={w.originalDirection || "rtl"}>
                                {w.originalTitle}
                              </span>
                            )}
                            {w.author?.name && <span className="lib-item-author">{w.author.name}</span>}
                          </span>
                          <span className="lib-item-meta">
                            {w.chapterCount > 0 ? `${w.chapterCount} ${w.chapterCount === 1 ? "chapter" : "chapters"}` : "Catalogue only"}
                          </span>
                        </button>
                      ))}
                    </details>
                  );
                })
              )}
            </div>
          </section>

          <section className="lib-col lib-col-chapters" aria-labelledby="lib-chapter-heading">
            <div className="lib-col-head">
              <h2 id="lib-chapter-heading">Chapter</h2>
              {selectedWork && <span className="lib-col-count">{chapters.length}</span>}
            </div>
            <div className="lib-col-body">
              {!selectedWork ? (
                <p className="lib-hint">Choose a work to open its chapters here.</p>
              ) : (
                <>
                  <div className="lib-work-head">
                    <h3>{activeWork?.title ?? selectedWork.title}</h3>
                    {activeWork?.originalTitle && (
                      <p className="lib-work-original" dir="rtl" lang="he">{activeWork.originalTitle}</p>
                    )}
                    <div className="lib-work-actions">
                      <Link className="button small primary" to={`/read/${encodeURIComponent(selectedWork.slug)}`}>
                        Start reading <Icon name="arrow-right" size={15} />
                      </Link>
                      <Link className="button small ghost" to={`/work/${encodeURIComponent(selectedWork.slug)}`}>
                        Work overview
                      </Link>
                    </div>
                  </div>

                  {chapters.length === 0 ? (
                    <p className="lib-hint">
                      No text has been imported for this work. The catalogue record stays visible without inventing a text.
                    </p>
                  ) : (
                    <div className="lib-chapter-grid">
                      {chapters.map((ch) => (
                        <Link
                          key={ch.ref}
                          className="lib-chapter"
                          to={`/read/${encodeURIComponent(selectedWork.slug)}?ref=${encodeURIComponent(ch.ref)}`}
                          title={`${ch.label} · ${ch.passages} passages`}
                        >
                          <span className="lib-chapter-label">{ch.label}</span>
                          <span className="lib-chapter-count">{ch.passages}</span>
                        </Link>
                      ))}
                    </div>
                  )}

                  {editions.length > 0 && (
                    <div className="lib-editions">
                      <h4>Editions on this shelf</h4>
                      {originalEdition && (
                        <p>
                          <span className="lib-edition-tag">Original</span>
                          {originalEdition.title} · {originalEdition.language.name}
                          {originalEdition.source?.name && <> · via {originalEdition.source.name}</>}
                        </p>
                      )}
                      {translationEdition && (
                        <p>
                          <span className="lib-edition-tag">Translation</span>
                          {translationEdition.title} · {translationEdition.language.name}
                          {translationEdition.source?.name && <> · via {translationEdition.source.name}</>}
                        </p>
                      )}
                      {editions.length > 2 && <p className="muted small">And {editions.length - 2} further editions.</p>}
                      <p className="muted small">
                        Copyright and licence remain with the holding project; the reader repeats the attribution beside the text.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      )}

      {data && !selectedTradition && (
        <p className="lib-footnote">
          Every imported text names its edition, source and rights status in the reader. The library is a reading interface
          over texts held by other projects; it does not claim ownership of those editions.{" "}
          <Link className="text-link" to="/provenance">Read the provenance notes</Link>
        </p>
      )}
    </div>
  );
}
