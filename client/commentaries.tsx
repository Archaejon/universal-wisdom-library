import { useEffect, useMemo, useState } from "react";
import { Link } from "./router";
import { api } from "./api";
import { Icon, Loading } from "./components";

/**
 * Commentaries keyed to one passage: Sefaria's links, Barnes' Notes, the
 * tafsir works. The list arrives first; a commentary's text is read when it is
 * opened, one at a time, the way Sefaria's own sidebar works.
 */

type Group = {
  id: string;
  title: string;
  titleNative?: string;
  author?: string;
  category: string;
  providerLabel: string;
  count: number | null;
  hasEnglish: boolean;
  year?: number | null;
  libraryHref?: string;
  externalUrl?: string;
};

type Listing = {
  reference: string;
  categories: { name: string; count: number }[];
  groups: Group[];
  notices: string[];
};

type Entry = {
  ref: string;
  label: string;
  text: string;
  original?: string;
  originalLanguage?: string;
  direction?: "rtl" | "ltr";
  href?: string;
  externalUrl?: string;
};

type Reading = {
  id: string;
  title: string;
  entries: Entry[];
  edition?: string;
  editionOriginal?: string;
  license?: string;
  source: { name: string; url: string };
  notice?: string;
};

const SHOWN = 10;
const CHIPS = 6;

const listCache = new Map<string, Listing>();
const readCache = new Map<string, Reading>();

function endpoint(slug: string, reference: string, id?: string) {
  const q = new URLSearchParams({ ref: reference });
  if (id) q.set("id", id);
  return `/api/commentaries/${encodeURIComponent(slug)}?${q.toString()}`;
}

function CommentaryReading({ slug, reference, group }: { slug: string; reference: string; group: Group }) {
  const key = `${slug}|${reference}|${group.id}`;
  const [data, setData] = useState<Reading | null>(readCache.get(key) ?? null);
  const [error, setError] = useState("");
  const [showOriginal, setShowOriginal] = useState(true);

  useEffect(() => {
    if (readCache.has(key)) {
      setData(readCache.get(key)!);
      return;
    }
    let live = true;
    setData(null);
    setError("");
    api<Reading>(endpoint(slug, reference, group.id))
      .then((d) => {
        readCache.set(key, d);
        if (live) setData(d);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [key]);

  if (error) return <p className="muted small">{error}</p>;
  if (!data) return <Loading label={`Reading ${group.title}`} />;
  const hasBoth = data.entries.some((e) => e.text) && data.entries.some((e) => e.original);
  return (
    <div className="vc-reading">
      {data.notice && <p className="muted small">{data.notice}</p>}
      {hasBoth && (
        <label className="vc-toggle">
          <input type="checkbox" checked={showOriginal} onChange={(e) => setShowOriginal(e.target.checked)} /> Show the original
        </label>
      )}
      {data.entries.map((e) => (
        <div className="vc-entry" key={e.ref}>
          {data.entries.length > 1 && e.label && <p className="vc-entry-label">{e.label}</p>}
          {e.text && <p className="vc-text">{e.text}</p>}
          {e.original && (showOriginal || !e.text) && (
            <p className="vc-text original" lang={e.originalLanguage} dir={e.direction ?? "auto"}>
              {e.original}
            </p>
          )}
        </div>
      ))}
      <p className="vc-source">
        {[data.edition, data.editionOriginal && data.editionOriginal !== data.edition ? data.editionOriginal : null]
          .filter(Boolean)
          .join(" · ")}
        {data.license && <> · {data.license}</>}
        {" · "}
        <a href={data.source.url} target="_blank" rel="noreferrer">
          {data.source.name} <Icon name="external" size={12} />
        </a>
        {data.entries[0]?.href && (
          <>
            {" · "}
            <Link to={data.entries[0].href}>Open in the library</Link>
          </>
        )}
      </p>
    </div>
  );
}

export function VerseCommentaries({ slug, reference }: { slug: string; reference: string }) {
  const listKey = `${slug}|${reference}`;
  const [data, setData] = useState<Listing | null>(listCache.get(listKey) ?? null);
  const [error, setError] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setCategory(null);
    setOpen(null);
    setShowAll(false);
    if (listCache.has(listKey)) {
      setData(listCache.get(listKey)!);
      return;
    }
    let live = true;
    setData(null);
    setError("");
    api<Listing>(endpoint(slug, reference))
      .then((d) => {
        listCache.set(listKey, d);
        if (live) setData(d);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [listKey]);

  const active = category ?? data?.categories[0]?.name ?? null;
  const inCategory = useMemo(() => (data?.groups ?? []).filter((g) => g.category === active), [data, active]);
  // Open the first commentary of the first category, so the panel shows
  // something to read without another click.
  const opened = open ?? (category === null ? inCategory[0]?.id ?? null : null);

  if (error) return <p className="muted small">Commentaries could not be listed: {error}</p>;
  if (!data) return <Loading label="Finding commentaries" />;
  if (!data.groups.length) {
    return (
      <>
        {data.notices.map((n) => <p key={n} className="muted small">{n}</p>)}
        <p className="muted small">No commentary keyed to this verse was found on the shelf or at Sefaria.</p>
      </>
    );
  }
  const shown = showAll ? inCategory : inCategory.slice(0, SHOWN);
  return (
    <div className="verse-commentaries">
      {data.categories.length > 1 && (
        <div className="chip-row small vc-categories" role="tablist" aria-label="Kinds of commentary">
          {data.categories
            .filter((c, i) => i < CHIPS || c.name === active)
            .map((c) => (
            <button
              key={c.name}
              role="tab"
              aria-selected={c.name === active}
              className={c.name === active ? "chip active" : "chip"}
              onClick={() => {
                setCategory(c.name);
                setOpen(null);
                setShowAll(false);
              }}
            >
              {c.name} <span className="chip-meta">{c.count}</span>
            </button>
          ))}
          {data.categories.length > CHIPS && (
            <select
              className="vc-more"
              aria-label="More kinds of commentary"
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                setCategory(e.target.value);
                setOpen(null);
                setShowAll(false);
              }}
            >
              <option value="">More…</option>
              {data.categories.slice(CHIPS).map((c) => (
                <option key={c.name} value={c.name}>{c.name} ({c.count})</option>
              ))}
            </select>
          )}
        </div>
      )}
      <ul className="vc-list">
        {shown.map((g) => {
          const isOpen = g.id === opened;
          return (
            <li key={g.id} className={isOpen ? "vc-item open" : "vc-item"}>
              <button className="vc-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? "" : g.id)}>
                <span className="vc-title">
                  {g.title}
                  {g.titleNative && <span className="vc-native" dir="auto">{g.titleNative}</span>}
                </span>
                <span className="vc-meta">
                  {g.hasEnglish && <span className="vc-tag">English</span>}
                  {g.count !== null && g.count > 1 && <span className="chip-meta">{g.count}</span>}
                  <Icon name="chevron" size={14} />
                </span>
              </button>
              {isOpen && <CommentaryReading slug={slug} reference={reference} group={g} />}
            </li>
          );
        })}
      </ul>
      {inCategory.length > SHOWN && (
        <button className="button small" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : `Show all ${inCategory.length}`}
        </button>
      )}
      {data.notices.map((n) => <p key={n} className="muted small vc-notice">{n}</p>)}
      <p className="muted small vc-notice">
        Listed from {[...new Set(data.groups.map((g) => g.providerLabel))].join(", ")}. Commentary is interpretation, kept apart from the text.
      </p>
    </div>
  );
}
