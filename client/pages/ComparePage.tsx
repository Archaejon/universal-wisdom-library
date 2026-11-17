import { useEffect, useMemo, useState } from "react";
import { Link, navigate, useLocation } from "../router";
import { api } from "../api";
import { useAuth } from "../auth";
import {
  Badge, CopyButton, EditionSourceLine, ErrorState, Icon, Loading, Modal, PageIntro, useToast,
} from "../components";

type Item = any;

export function ComparePage() {
  const location = useLocation();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const token = params.get("c") || "";
  const keys = params.get("p") || "";
  const { user } = useAuth();
  const { push } = useToast();

  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [works, setWorks] = useState<any[]>([]);
  const [traditionTab, setTraditionTab] = useState("all");
  const [schoolTab, setSchoolTab] = useState("all");
  const [addWork, setAddWork] = useState("");
  const [addRef, setAddRef] = useState("");
  const [addError, setAddError] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [saveDescription, setSaveDescription] = useState("");
  const [savePublic, setSavePublic] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setError("");
    setData(null);
    api<any>(`/api/compare?${new URLSearchParams({ ...(token ? { c: token } : {}), ...(keys ? { p: keys } : {}) }).toString()}`)
      .then((d) => {
        setData(d);
        setItems(d.items);
        setNotes(Object.fromEntries(d.items.map((i: any) => [i.passageId, i.annotation || ""])));
        setSaveTitle(d.collection?.title ? `${d.collection.title} — my copy` : "My comparative reading");
      })
      .catch((e) => setError(e.message));
  }, [token, keys]);

  useEffect(() => {
    api<any>("/api/facets").then((d) => setWorks(d.works ?? [])).catch(() => {});
  }, []);

  const traditionTabs = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const work of works) {
      if (!work.tradition) continue;
      const current = counts.get(work.tradition) ?? { label: work.traditionLabel || work.tradition, count: 0 };
      current.count += 1;
      counts.set(work.tradition, current);
    }
    return [...counts.entries()]
      .map(([value, meta]) => ({ value, ...meta }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [works]);

  const traditionWorks = useMemo(
    () => works.filter((work) => traditionTab === "all" || work.tradition === traditionTab),
    [works, traditionTab],
  );

  const schoolTabs = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const work of traditionWorks) {
      if (!work.school) continue;
      const current = counts.get(work.school) ?? { label: work.schoolLabel || work.school, count: 0 };
      current.count += 1;
      counts.set(work.school, current);
    }
    return [...counts.entries()]
      .map(([value, meta]) => ({ value, ...meta }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [traditionWorks]);

  const visibleWorks = useMemo(
    () => traditionWorks.filter((work) => schoolTab === "all" || work.school === schoolTab),
    [traditionWorks, schoolTab],
  );

  const workGroups = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const work of visibleWorks) {
      const label = work.category || work.textType || work.genre || "Other";
      const list = groups.get(label) ?? [];
      list.push(work);
      groups.set(label, list);
    }
    return [...groups.entries()]
      .map(([label, items]) => ({ label, items }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [visibleWorks]);

  useEffect(() => {
    if (addWork && !visibleWorks.some((work) => work.value === addWork)) setAddWork("");
  }, [visibleWorks, addWork]);

  const compareUrl = token
    ? `${window.location.origin}/compare?c=${encodeURIComponent(token)}`
    : items.length
      ? `${window.location.origin}/compare?p=${encodeURIComponent(items.map((i) => `${i.work}:${i.reference}`).join(","))}`
      : `${window.location.origin}/compare`;

  const addPassage = async () => {
    setAddError("");
    if (!addWork) { setAddError("Choose a work."); return; }
    if (!addRef.trim()) { setAddError("Enter a passage reference, e.g. 2:47 or 1.1."); return; }
    if (items.length >= 8) { setAddError("A comparison holds at most eight passages."); return; }
    try {
      const r = await api<any>(`/api/read/${encodeURIComponent(addWork)}?ref=${encodeURIComponent(addRef.trim())}`);
      if (r.type !== "passage") {
        setAddError(r.message || "That reference does not resolve to a single passage. Open the work and choose a passage.");
        return;
      }
      if (items.some((i) => i.passageId === r.passage.id)) { setAddError("That passage is already in the comparison."); return; }
      const nextKeys = [...items.map((i) => `${i.work}:${i.reference}`), `${r.work.slug}:${r.passage.reference}`];
      navigate(`/compare?p=${encodeURIComponent(nextKeys.join(","))}`);
      setAddRef("");
    } catch (e: any) {
      setAddError(e.message);
    }
  };

  const removeItem = (passageId: number) => {
    const next = items.filter((i) => i.passageId !== passageId);
    if (!next.length) { navigate("/compare"); return; }
    navigate(`/compare?p=${encodeURIComponent(next.map((i) => `${i.work}:${i.reference}`).join(","))}`);
  };

  const changeVersion = async (passageId: number, workSlug: string, reference: string, editionSlug: string) => {
    try {
      const r = await api<any>(`/api/read/${encodeURIComponent(workSlug)}?ref=${encodeURIComponent(reference)}&version=${encodeURIComponent(editionSlug)}`);
      const v = r.versions?.find((x: any) => x.slug === editionSlug);
      if (!v) return;
      setItems((old) => old.map((i) => i.passageId === passageId ? { ...i, text: v.text, edition: v } : i));
    } catch (e: any) { push(e.message, "error"); }
  };

  const saveComparison = async () => {
    if (!user) { setSaveOpen(false); navigate(`/account?next=${encodeURIComponent(location.pathname + location.search)}`); return; }
    if (saveTitle.trim().length < 2) return;
    setSaving(true);
    try {
      const res = await api<any>("/api/collections", {
        method: "POST",
        body: {
          title: saveTitle.trim(),
          description: saveDescription.trim(),
          kind: "comparison",
          isPublic: savePublic,
          items: items.map((i) => ({ passageId: i.passageId, annotation: notes[i.passageId] || "" })),
        },
      });
      const t = res.collection?.shareToken;
      push("Comparison saved.", "success");
      setSaveOpen(false);
      if (t) navigate(`/compare?c=${encodeURIComponent(t)}`);
    } catch (e: any) { push(e.message, "error"); } finally { setSaving(false); }
  };

  return (
    <div className="container page compare-page">
      <PageIntro
        eyebrow="Comparative study"
        title="Read passages side by side"
        lede="Place passages from different works in one workspace. Each keeps its own edition, language and context; juxtaposition is not a claim that they mean the same thing."
      >
        <div className="button-row">
          <CopyButton text={compareUrl} label="Share this comparison" />
          <button className="button" onClick={() => setSaveOpen(true)} disabled={items.length === 0}>Save as a collection</button>
          {items.length > 0 && <button className="button ghost" onClick={() => navigate("/compare")}>Clear workspace</button>}
        </div>
      </PageIntro>

      {error && <ErrorState message={error} />}
      {!data && !error && <Loading label="Assembling the comparison" />}

      {data && (
        <>
          {data.collection && (
            <section className="curated-banner">
              <div>
                <p className="eyebrow">{data.collection.isCurated ? "Curated comparative reading" : "Saved comparison"}</p>
                <h2>{data.collection.title}</h2>
                <p>{data.collection.description}</p>
                <p className="small muted">
                  {data.collection.curator ? `Curated by ${data.collection.curator}. ` : ""}
                  {data.collection.isPublic ? "Shareable by link." : "Private to its owner."}
                </p>
              </div>
              {data.collection.isCurated && <Badge tone="accent">Editorial selection</Badge>}
            </section>
          )}

          {items.length > 0 && (
            <p className="caution">
              These passages are presented in their own traditions and editions. Shared vocabulary or a similar image is not, by itself, evidence of historical contact or agreement.
            </p>
          )}

          <div className="compare-grid">
            {items.map((item) => (
              <article key={item.passageId} className="compare-card">
                <header className="compare-card-head">
                  <div className="compare-badges">
                    <Badge tone="accent">{item.tradition}</Badge>
                    {item.school && <Badge>{item.school}</Badge>}
                    {item.dateDisplay && <span className="muted small">{item.dateDisplay}</span>}
                  </div>
                  <button className="icon-button" onClick={() => removeItem(item.passageId)} aria-label={`Remove ${item.workTitle} ${item.reference}`} title="Remove from comparison">
                    <Icon name="close" size={16} />
                  </button>
                </header>
                <h2><Link to={`/work/${item.work}`}>{item.workTitle}</Link></h2>
                <p className="compare-ref"><Link to={`/read/${item.work}?ref=${encodeURIComponent(item.reference)}`}>{item.reference} · {item.label}</Link></p>
                {item.versions?.length > 1 ? (
                  <label className="version-select compact">
                    <span>Edition</span>
                    <select value={item.edition?.slug ?? ""} onChange={(e) => changeVersion(item.passageId, item.work, item.reference, e.target.value)}>
                      {item.versions.map((v: any) => <option key={v.slug} value={v.slug}>{v.language?.name} · {v.editionType === "original" ? "original" : v.title}</option>)}
                    </select>
                  </label>
                ) : null}
                <blockquote className="compare-text" dir={item.edition?.language?.direction === "rtl" ? "rtl" : "ltr"} lang={item.edition?.language?.code}>
                  {item.text ? item.text.split(/\n{2,}/).map((p: string, i: number) => <p key={i}>{p}</p>) : <p className="muted">No text imported for this edition.</p>}
                </blockquote>
                <div className="compare-source">
                  <EditionSourceLine edition={item.edition} />
                </div>
                <label className="compare-note">
                  <span>{data.collection?.isCurated ? "Curatorial note" : "Your annotation"}</span>
                  <textarea
                    value={notes[item.passageId] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [item.passageId]: e.target.value }))}
                    rows={2}
                    maxLength={1000}
                    placeholder={data.collection?.isCurated ? "Editor's note on this passage" : "A note for your comparison (saved with the collection)"}
                  />
                </label>
                <div className="compare-links">
                  <Link className="text-link" to={`/read/${item.work}?ref=${encodeURIComponent(item.reference)}`}>Read with commentary <Icon name="arrow-right" size={14} /></Link>
                  {item.commentaryCount > 0 && <span className="muted small">{item.commentaryCount} commentary entries</span>}
                </div>
                {item.themes?.length > 0 && (
                  <div className="chip-row small">
                    {item.themes.map((t: any) => <Link key={t.slug} className="chip" to={`/themes/${t.slug}`}>{t.name}</Link>)}
                  </div>
                )}
              </article>
            ))}

            <article className="compare-card add-card">
              <h2>Add a passage</h2>
              <p className="muted small">Choose a tradition, narrow by school or genre, then enter a reference exactly as the reader shows it.</p>
              <div className="picker-tabs" role="group" aria-label="Choose a tradition">
                <button
                  className={`picker-tab${traditionTab === "all" ? " active" : ""}`}
                  aria-pressed={traditionTab === "all"}
                  onClick={() => { setTraditionTab("all"); setSchoolTab("all"); }}
                >
                  All traditions <span>{works.length}</span>
                </button>
                {traditionTabs.map((tradition) => (
                  <button
                    key={tradition.value}
                    className={`picker-tab${traditionTab === tradition.value ? " active" : ""}`}
                    aria-pressed={traditionTab === tradition.value}
                    onClick={() => { setTraditionTab(tradition.value); setSchoolTab("all"); }}
                  >
                    {tradition.label} <span>{tradition.count}</span>
                  </button>
                ))}
              </div>
              {schoolTabs.length > 1 && (
                <div className="picker-subtabs" role="group" aria-label="Choose a school">
                  <button
                    className={`picker-tab small${schoolTab === "all" ? " active" : ""}`}
                    aria-pressed={schoolTab === "all"}
                    onClick={() => setSchoolTab("all")}
                  >
                    All schools
                  </button>
                  {schoolTabs.map((school) => (
                    <button
                      key={school.value}
                      className={`picker-tab small${schoolTab === school.value ? " active" : ""}`}
                      aria-pressed={schoolTab === school.value}
                      onClick={() => setSchoolTab(school.value)}
                    >
                      {school.label} <span>{school.count}</span>
                    </button>
                  ))}
                </div>
              )}
              <label className="field">
                <span>Work</span>
                <select value={addWork} onChange={(e) => setAddWork(e.target.value)}>
                  <option value="">Choose a work…</option>
                  {workGroups.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.items.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Reference</span>
                <input value={addRef} onChange={(e) => setAddRef(e.target.value)} placeholder="e.g. 2:47" />
              </label>
              {addError && <p className="form-error" role="alert">{addError}</p>}
              <button className="button primary" onClick={addPassage} disabled={items.length >= 8}><Icon name="plus" size={16} /> Add to comparison</button>
              {items.length >= 8 && <p className="muted small">Eight passages is the workspace limit.</p>}
              <p className="muted small">Or add from any reader with the Compare button.</p>
            </article>
          </div>

          {items.length === 0 && !data.collection && (
            <div className="empty-panel">
              <h3>The workspace is empty.</h3>
              <p>Add a passage above, or open a curated comparison from the home page. You can also add passages while reading.</p>
              <div className="button-row">
                <Link className="button" to="/themes">Browse themes</Link>
                <Link className="button ghost" to="/library">Browse the library</Link>
              </div>
            </div>
          )}
        </>
      )}

      <Modal open={saveOpen} onClose={() => setSaveOpen(false)} title="Save this comparison">
        {!user ? (
          <div>
            <p>Sign in to save a comparison with your annotations.</p>
            <Link className="button primary" to={`/account?next=${encodeURIComponent(location.pathname + location.search)}`}>Sign in</Link>
          </div>
        ) : (
          <div className="stack">
            <label className="field"><span>Title</span><input value={saveTitle} onChange={(e) => setSaveTitle(e.target.value)} maxLength={120} /></label>
            <label className="field"><span>Description</span><textarea value={saveDescription} onChange={(e) => setSaveDescription(e.target.value)} rows={3} maxLength={2000} /></label>
            <label className="check-row">
              <input type="checkbox" checked={savePublic} onChange={(e) => setSavePublic(e.target.checked)} />
              <span>Anyone with the link can read this comparison</span>
            </label>
            <p className="small muted">Private comparisons are visible only to you. Your annotations are saved with the collection.</p>
            <button className="button primary" onClick={saveComparison} disabled={saving || saveTitle.trim().length < 2}>{saving ? "Saving…" : "Save comparison"}</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
