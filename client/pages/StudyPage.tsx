import { useEffect, useMemo, useState } from "react";
import { Link, navigate, useLocation } from "../router";
import { api, timeAgo } from "../api";
import { useAuth } from "../auth";
import {
  Badge, CopyButton, EmptyState, ErrorState, Icon, Loading, Modal, PageIntro, ProgressBar, useToast,
} from "../components";

const TABS = [
  ["overview", "Overview"],
  ["bookmarks", "Bookmarks"],
  ["notes", "Notes"],
  ["collections", "Collections"],
  ["progress", "Reading progress"],
] as const;

export function StudyPage() {
  const { user, loading: authLoading, refresh } = useAuth();
  const location = useLocation();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const tab = (params.get("tab") || "overview") as typeof TABS[number][0];
  const { push } = useToast();

  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("reading_list");
  const [isPublic, setIsPublic] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = () => {
    setError("");
    api<any>("/api/study").then(setData).catch((e) => setError(e.message));
  };

  useEffect(() => {
    if (user) load();
    else if (!authLoading) setData(null);
  }, [user, authLoading]);

  if (authLoading) return <div className="container page"><Loading label="Checking your session" /></div>;

  if (!user) {
    return (
      <div className="container page">
        <PageIntro eyebrow="Personal study" title="Your reading, kept together" lede="Sign in to see bookmarks, private notes, saved collections and reading progress. Reading itself is always open." />
        <div className="empty-panel">
          <h3>You are not signed in.</h3>
          <p>Personal study lives behind a local account so that notes and collections are not public by accident.</p>
          <div className="button-row">
            <Link className="button primary" to={`/account?next=${encodeURIComponent("/study")}`}>Sign in or create an account</Link>
            <Link className="button ghost" to="/library">Keep browsing</Link>
          </div>
        </div>
      </div>
    );
  }

  if (error) return <div className="container page"><ErrorState message={error} onRetry={load} /></div>;
  if (!data) return <div className="container page"><Loading label="Opening your study" /></div>;

  const updateNote = async (id: number) => {
    try {
      await api(`/api/notes/${id}`, { method: "PATCH", body: { body: editingBody } });
      setData((d: any) => ({ ...d, notes: d.notes.map((n: any) => n.id === id ? { ...n, body: editingBody } : n) }));
      setEditingId(null);
      push("Note updated.", "success");
    } catch (e: any) { push(e.message, "error"); }
  };

  const deleteNote = async (id: number) => {
    if (!confirm("Delete this private note?")) return;
    try {
      await api(`/api/notes/${id}`, { method: "DELETE" });
      setData((d: any) => ({ ...d, notes: d.notes.filter((n: any) => n.id !== id) }));
      push("Note deleted.", "success");
      refresh();
    } catch (e: any) { push(e.message, "error"); }
  };

  const removeBookmark = async (passageId: number) => {
    try {
      await api("/api/bookmarks/toggle", { method: "POST", body: { passageId } });
      setData((d: any) => ({ ...d, bookmarks: d.bookmarks.filter((b: any) => b.passageId !== passageId) }));
      push("Bookmark removed.", "success");
      refresh();
    } catch (e: any) { push(e.message, "error"); }
  };

  const deleteCollection = async (id: number) => {
    if (!confirm("Delete this collection? The passages themselves are not affected.")) return;
    try {
      await api(`/api/collections/${id}`, { method: "DELETE" });
      setData((d: any) => ({ ...d, collections: d.collections.filter((c: any) => c.id !== id) }));
      push("Collection deleted.", "success");
      refresh();
    } catch (e: any) { push(e.message, "error"); }
  };

  const createCollection = async () => {
    if (title.trim().length < 2) return;
    try {
      const res = await api<any>("/api/collections", { method: "POST", body: { title: title.trim(), description, kind, isPublic } });
      setData((d: any) => ({ ...d, collections: [res.collection, ...d.collections] }));
      setCreateOpen(false);
      setTitle(""); setDescription(""); setIsPublic(false);
      push("Collection created.", "success");
      refresh();
    } catch (e: any) { push(e.message, "error"); }
  };

  const counts = {
    bookmarks: data.bookmarks.length,
    notes: data.notes.length,
    collections: data.collections.length,
    progress: data.progress.length,
  };

  return (
    <div className="container page study-page">
      <PageIntro eyebrow="Personal study" title={`${user.displayName.split(" ")[0]}’s library`} lede="Private notes and collections are yours alone unless you publish a collection. Curated comparisons appear in the public library, not here.">
        <div className="button-row">
          <button className="button primary" onClick={() => setCreateOpen(true)}><Icon name="plus" size={16} /> New collection</button>
          <Link className="button" to="/compare">Open comparison workspace</Link>
        </div>
      </PageIntro>

      <div className="study-summary">
        <Link to="/study?tab=bookmarks" className={tab === "bookmarks" ? "active" : ""}><strong>{counts.bookmarks}</strong><span>Bookmarks</span></Link>
        <Link to="/study?tab=notes" className={tab === "notes" ? "active" : ""}><strong>{counts.notes}</strong><span>Notes</span></Link>
        <Link to="/study?tab=collections" className={tab === "collections" ? "active" : ""}><strong>{counts.collections}</strong><span>Collections</span></Link>
        <Link to="/study?tab=progress" className={tab === "progress" ? "active" : ""}><strong>{counts.progress}</strong><span>In progress</span></Link>
      </div>

      <div className="tab-row page-tabs" role="tablist">
        {TABS.map(([value, label]) => (
          <Link
            key={value}
            to={value === "overview" ? "/study" : `/study?tab=${value}`}
            className={tab === value ? "tab active" : "tab"}
            role="tab"
            aria-selected={tab === value}
          >{label}</Link>
        ))}
      </div>

      {tab === "overview" && (
        <div className="study-overview">
          <section className="study-column">
            <div className="section-heading compact"><h2>Continue reading</h2><Link className="text-link" to="/study?tab=progress">All progress</Link></div>
            {data.progress.length === 0 ? <p className="muted">No progress recorded yet.</p> : (
              <ul className="study-progress-list">
                {data.progress.slice(0, 4).map((p: any) => (
                  <li key={p.work.slug}>
                    <div className="study-progress-head">
                      <Link to={p.passage ? `/read/${p.work.slug}?ref=${encodeURIComponent(p.passage.reference)}` : `/read/${p.work.slug}`}>{p.work.title}</Link>
                      <span className="muted small">{p.percent}%</span>
                    </div>
                    <ProgressBar value={p.percent} />
                    <p className="muted small">{p.work.tradition}{p.passage ? ` · ${p.passage.reference} ${p.passage.label}` : ""} · {timeAgo(p.lastViewedAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="study-column">
            <div className="section-heading compact"><h2>Recent notes</h2><Link className="text-link" to="/study?tab=notes">All notes</Link></div>
            {data.notes.length === 0 ? <p className="muted">No notes yet. Open a passage and write one; it stays private.</p> : (
              <ul className="study-note-list">
                {data.notes.slice(0, 3).map((n: any) => (
                  <li key={n.id}>
                    <Link to={`/read/${n.work.slug}?ref=${encodeURIComponent(n.reference)}`}>{n.work.title} {n.reference}</Link>
                    <p>{n.body.length > 160 ? `${n.body.slice(0, 160)}…` : n.body}</p>
                    <span className="muted small">{timeAgo(n.updatedAt)} · private</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="study-column">
            <div className="section-heading compact"><h2>Collections</h2><Link className="text-link" to="/study?tab=collections">All collections</Link></div>
            {data.collections.length === 0 ? <p className="muted">No collections yet.</p> : (
              <ul className="study-collection-list">
                {data.collections.slice(0, 3).map((c: any) => (
                  <li key={c.id}>
                    <Link to={`/study?tab=collections`}>{c.title}</Link>
                    <span className="muted small">{c.itemCount} items · {c.isPublic ? "public" : "private"}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {tab === "bookmarks" && (
        <section>
          {data.bookmarks.length === 0 ? <EmptyState title="No bookmarks yet"><p>Use the Bookmark button in the reader to keep a passage here.</p><Link className="button" to="/library">Browse the library</Link></EmptyState> : (
            <ul className="bookmark-list">
              {data.bookmarks.map((b: any) => (
                <li key={b.id}>
                  <div className="bookmark-main">
                    <div className="catalogue-badges"><Badge tone="accent">{b.tradition.name}</Badge><span className="muted small">{timeAgo(b.createdAt)}</span></div>
                    <h3><Link to={`/read/${b.work.slug}?ref=${encodeURIComponent(b.reference)}`}>{b.work.title} {b.reference}</Link></h3>
                    <p className="muted">{b.label}</p>
                  </div>
                  <div className="button-row">
                    <Link className="button small" to={`/read/${b.work.slug}?ref=${encodeURIComponent(b.reference)}`}>Open</Link>
                    <button className="button small ghost" onClick={() => removeBookmark(b.passageId)}>Remove</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "notes" && (
        <section>
          <p className="privacy-note"><Icon name="note" size={15} /> All notes are private. {data.privacy.notes}</p>
          {data.notes.length === 0 ? <EmptyState title="No notes yet"><p>Notes are attached to a passage and remain visible only to you.</p><Link className="button" to="/library">Find a passage</Link></EmptyState> : (
            <ul className="note-list study-notes">
              {data.notes.map((n: any) => (
                <li key={n.id}>
                  <div className="note-work">
                    <Link to={`/read/${n.work.slug}?ref=${encodeURIComponent(n.reference)}`}>{n.work.title} {n.reference}</Link>
                    <span className="muted small">{n.tradition.name} · {timeAgo(n.updatedAt)} · private</span>
                  </div>
                  {editingId === n.id ? (
                    <div className="note-edit">
                      <textarea value={editingBody} onChange={(e) => setEditingBody(e.target.value)} rows={3} maxLength={5000} />
                      <div className="button-row">
                        <button className="button small primary" onClick={() => updateNote(n.id)}>Save</button>
                        <button className="button small ghost" onClick={() => setEditingId(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="note-body">{n.body}</p>
                      <div className="note-meta">
                        <span>Created {timeAgo(n.createdAt)}</span>
                        <span className="note-buttons">
                          <button className="link-button" onClick={() => { setEditingId(n.id); setEditingBody(n.body); }}>Edit</button>
                          <button className="link-button danger" onClick={() => deleteNote(n.id)}>Delete</button>
                        </span>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "collections" && (
        <section>
          {data.collections.length === 0 ? <EmptyState title="No collections yet"><p>Group passages into a reading list or a saved comparison.</p><button className="button" onClick={() => setCreateOpen(true)}>Create a collection</button></EmptyState> : (
            <div className="collection-list">
              {data.collections.map((c: any) => (
                <article key={c.id} className="collection-card">
                  <header>
                    <div>
                      <div className="catalogue-badges">
                        <Badge>{c.kind.replace("_", " ")}</Badge>
                        <Badge tone={c.isPublic ? "green" : "muted"}>{c.isPublic ? "Public link" : "Private"}</Badge>
                      </div>
                      <h3>{c.title}</h3>
                      {c.description && <p className="muted">{c.description}</p>}
                    </div>
                    <span className="muted small">{c.itemCount} {c.itemCount === 1 ? "item" : "items"}</span>
                  </header>
                  <div className="button-row">
                    <button className="button small" onClick={() => setExpanded(expanded === c.id ? null : c.id)}>{expanded === c.id ? "Hide items" : "Show items"}</button>
                    {c.kind === "comparison" && c.shareToken && <Link className="button small" to={`/compare?c=${encodeURIComponent(c.shareToken)}`}>Open comparison</Link>}
                    {c.isPublic && c.shareToken && <CopyButton small text={`${window.location.origin}/compare?c=${encodeURIComponent(c.shareToken)}`} label="Copy link" />}
                    <button className="button small ghost" onClick={() => deleteCollection(c.id)}>Delete</button>
                  </div>
                  {expanded === c.id && (
                    <ul className="collection-items">
                      {c.items.length === 0 ? <li className="muted">No passages in this collection.</li> : c.items.map((i: any) => (
                        <li key={i.passageId}>
                          <Link to={`/read/${i.work.slug}?ref=${encodeURIComponent(i.reference)}`}>{i.work.title} {i.reference}</Link>
                          <span className="muted small">{i.label}{i.annotation ? ` · ${i.annotation}` : ""}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "progress" && (
        <section>
          {data.progress.length === 0 ? <EmptyState title="No reading progress yet"><p>Open any passage while signed in and your place is recorded.</p><Link className="button" to="/library">Start reading</Link></EmptyState> : (
            <ul className="progress-table">
              {data.progress.map((p: any) => (
                <li key={p.work.slug}>
                  <div className="progress-main">
                    <Link to={p.passage ? `/read/${p.work.slug}?ref=${encodeURIComponent(p.passage.reference)}` : `/read/${p.work.slug}`}>{p.work.title}</Link>
                    <span className="muted small">{p.work.tradition}{p.passage ? ` · last read ${p.passage.reference}` : ""} · {timeAgo(p.lastViewedAt)}</span>
                    <ProgressBar value={p.percent} />
                  </div>
                  <span className="progress-percent">{p.percent}%</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New collection">
        <div className="stack">
          <label className="field"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Passages on mercy" /></label>
          <label className="field"><span>Description</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} /></label>
          <label className="field"><span>Kind</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="reading_list">Reading list</option>
              <option value="comparison">Comparison</option>
              <option value="thematic">Thematic collection</option>
            </select>
          </label>
          <label className="check-row"><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /><span>Make this collection readable by anyone with the link</span></label>
          <button className="button primary" onClick={createCollection} disabled={title.trim().length < 2}>Create collection</button>
          <p className="small muted">Add passages from the reader using “Save to a collection”.</p>
        </div>
      </Modal>
    </div>
  );
}
