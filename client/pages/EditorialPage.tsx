import { useEffect, useState } from "react";
import { Link, useLocation } from "../router";
import { api } from "../api";
import { useAuth } from "../auth";
import { Badge, ErrorState, Loading, PageIntro, useToast } from "../components";

export function EditorialPage() {
  const { user } = useAuth();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const { push } = useToast();

  const [targetType, setTargetType] = useState(params.get("target") || "work");
  const [targetId, setTargetId] = useState(params.get("targetId") || "");
  const [kind, setKind] = useState("correction");
  const [message, setMessage] = useState("");
  const [proposedText, setProposedText] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submissions, setSubmissions] = useState<any[] | null>(null);
  const [queueError, setQueueError] = useState("");
  const [reviewNote, setReviewNote] = useState<Record<number, string>>({});

  const isEditor = user?.role === "editor" || user?.role === "admin";

  const loadQueue = () => {
    if (!isEditor) { setSubmissions([]); return; }
    setQueueError("");
    api<any>("/api/editorial/submissions").then((d) => setSubmissions(d.submissions)).catch((e) => setQueueError(e.message));
  };

  useEffect(() => {
    loadQueue();
  }, [user?.role]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    try {
      await api("/api/corrections", { method: "POST", body: { targetType, targetId, kind, message, proposedText } });
      setSubmitted(true);
      setMessage("");
      setProposedText("");
      push("Submission received. An editor will review it.", "success");
    } catch (err: any) { push(err.message, "error"); } finally { setBusy(false); }
  };

  const review = async (id: number, action: string) => {
    try {
      await api(`/api/editorial/submissions/${id}/review`, { method: "POST", body: { action, note: reviewNote[id] || "" } });
      push(`Submission marked ${action.replace("_", " ")}.`, "success");
      loadQueue();
    } catch (e: any) { push(e.message, "error"); }
  };

  return (
    <div className="container page editorial-page">
      <PageIntro
        eyebrow="Editorial workflow"
        title="Corrections, metadata and review"
        lede="Readers can propose corrections. Editors review them, and accepted decisions are recorded as revisions. Imported source text is never overwritten silently."
      />

      {!user ? (
        <div className="empty-panel">
          <h3>Sign in to submit a correction.</h3>
          <p>Submissions are attributed to an account so that editors can follow up. Reading and reporting a problem do not require editor access.</p>
          <Link className="button primary" to={`/account?next=${encodeURIComponent(location.pathname + location.search)}`}>Sign in</Link>
        </div>
      ) : (
        <div className="editorial-layout">
          <section className="editorial-form">
            <h2>Submit a correction</h2>
            {submitted && <div className="success-banner" role="status">Your submission is queued for review. Accepted corrections are recorded as revisions; the original imported text remains traceable.</div>}
            <form onSubmit={submit} className="stack">
              <div className="form-row">
                <label className="field">
                  <span>Record type</span>
                  <select value={targetType} onChange={(e) => setTargetType(e.target.value)}>
                    <option value="work">Work metadata</option>
                    <option value="passage">Passage / reference</option>
                    <option value="commentary">Commentary</option>
                    <option value="edition">Edition / attribution</option>
                  </select>
                </label>
                <label className="field">
                  <span>Submission type</span>
                  <select value={kind} onChange={(e) => setKind(e.target.value)}>
                    <option value="correction">Correction</option>
                    <option value="metadata">Metadata suggestion</option>
                    <option value="annotation">Annotation</option>
                  </select>
                </label>
              </div>
              <label className="field">
                <span>Record identifier</span>
                <input value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder="Work slug, e.g. genesis" maxLength={200} />
              </label>
              <label className="field">
                <span>What is wrong or missing?</span>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={4000} required minLength={10} placeholder="Cite the edition and page or reference where possible." />
              </label>
              <label className="field">
                <span>Proposed text or metadata (optional)</span>
                <textarea value={proposedText} onChange={(e) => setProposedText(e.target.value)} rows={3} maxLength={10000} />
              </label>
              <button className="button primary" disabled={busy || message.trim().length < 10}>{busy ? "Submitting…" : "Submit for review"}</button>
              <p className="small muted">Rate limited to ten submissions per hour. Do not paste copyrighted text you do not have permission to share.</p>
            </form>
          </section>

          <aside className="editorial-aside">
            <h2>How review works</h2>
            <ol className="plain-list numbered">
              <li>A submission is stored with its submitter and target record.</li>
              <li>An editor accepts, rejects or asks for discussion.</li>
              <li>Acceptance writes a revision record with a snapshot and note.</li>
              <li>Source text is not silently replaced; changes remain attributable.</li>
            </ol>
            {!isEditor && <p className="small muted">Your account does not have editor access. You can still submit corrections.</p>}
            {isEditor && <Badge tone="accent">Editor access</Badge>}
          </aside>
        </div>
      )}

      {isEditor && (
        <section className="prose-section">
          <div className="section-heading">
            <div><h2>Review queue</h2><p>Newest pending submissions first. Decisions are logged against your account.</p></div>
            <button className="button small" onClick={loadQueue}>Refresh</button>
          </div>
          {queueError && <ErrorState message={queueError} />}
          {!submissions && !queueError && <Loading label="Loading submissions" />}
          {submissions && submissions.length === 0 && <p className="muted">No submissions yet.</p>}
          {submissions && submissions.length > 0 && (
            <div className="submission-list">
              {submissions.map((s: any) => (
                <article key={s.id} className={`submission status-${s.status}`}>
                  <header>
                    <div className="catalogue-badges">
                      <Badge tone={s.status === "pending" ? "warn" : s.status === "accepted" ? "green" : "muted"}>{s.status.replace("_", " ")}</Badge>
                      <Badge>{s.targetType}</Badge>
                      <Badge tone="muted">{s.kind}</Badge>
                    </div>
                    <span className="muted small">#{s.id} · {s.submitter} · {s.createdAt}</span>
                  </header>
                  <p className="submission-target">Target: <code>{s.targetId || "not specified"}</code></p>
                  <p>{s.message}</p>
                  {s.proposedText && <pre className="submission-proposal">{s.proposedText}</pre>}
                  {s.status === "pending" ? (
                    <div className="review-actions">
                      <input placeholder="Review note (optional)" value={reviewNote[s.id] || ""} onChange={(e) => setReviewNote((n) => ({ ...n, [s.id]: e.target.value }))} maxLength={2000} />
                      <button className="button small primary" onClick={() => review(s.id, "accepted")}>Accept</button>
                      <button className="button small" onClick={() => review(s.id, "needs_discussion")}>Needs discussion</button>
                      <button className="button small ghost" onClick={() => review(s.id, "rejected")}>Reject</button>
                    </div>
                  ) : (
                    <p className="small muted">Reviewed {s.reviewedAt}{s.reviewNote ? ` · ${s.reviewNote}` : ""}</p>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
