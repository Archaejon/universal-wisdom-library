import { useState } from "react";
import { Link, useLocation } from "../router";
import { api } from "../api";
import { PageIntro, useToast } from "../components";

const KINDS = [
  { value: "permission", label: "Permission to reuse a text" },
  { value: "attribution", label: "Correction to attribution or provenance" },
  { value: "takedown", label: "Takedown or restricted-knowledge request" },
  { value: "consultation", label: "Community consultation" },
  { value: "metadata", label: "Culturally sensitive metadata correction" },
];

export function RightsPage() {
  const location = useLocation();
  const { push } = useToast();
  const sourceId = new URLSearchParams(location.search).get("source") || "";
  const [source, setSource] = useState(sourceId);
  const [kind, setKind] = useState("permission");
  const [workSlug, setWorkSlug] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/rights-requests", {
        method: "POST",
        body: { sourceId: source, workSlug, kind, contactName, contactEmail, message },
      });
      setSubmitted(true);
      push("Request received. It is queued for editorial review.", "success");
    } catch (err: any) {
      push(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container page rights-page">
      <PageIntro
        eyebrow="Rights and community requests"
        title="Permissions, attribution and takedown"
        lede="Rights holders, translators, communities and readers can ask the library to correct provenance, restrict material or seek reuse permission. Requests are recorded even when they cannot be granted immediately."
      />

      <div className="editorial-layout">
        <section className="editorial-form">
          {submitted ? (
            <div className="success-banner" role="status">
              <h2>Request recorded</h2>
              <p>An editor will review the request. A takedown request does not delete material automatically; it is escalated for a documented decision so that accidental or malicious removals are not silently applied.</p>
              <p><Link className="text-link" to="/sources">Return to the source registry</Link></p>
            </div>
          ) : (
            <form onSubmit={submit} className="stack">
              <h2>Submit a request</h2>
              <label className="field">
                <span>Request type</span>
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Source ID (optional)</span>
                <input value={source} readOnly={!!sourceId} onChange={(e) => setSource(e.target.value)} placeholder="e.g. project-gutenberg" maxLength={120} />
              </label>
              <label className="field">
                <span>Work or edition slug (optional)</span>
                <input value={workSlug} onChange={(e) => setWorkSlug(e.target.value)} placeholder="e.g. journal-of-george-fox" maxLength={200} />
              </label>
              <div className="form-row">
                <label className="field">
                  <span>Your name</span>
                  <input value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={120} autoComplete="name" />
                </label>
                <label className="field">
                  <span>Contact email</span>
                  <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} required autoComplete="email" maxLength={254} />
                </label>
              </div>
              <label className="field">
                <span>What should the library know?</span>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} minLength={30} maxLength={5000} required placeholder="Identify the text, edition and your relationship to it. Include any relevant licence, community protocol or restriction." />
              </label>
              <button className="button primary" disabled={busy || message.trim().length < 30 || !contactEmail.trim()}>
                {busy ? "Submitting…" : "Submit for review"}
              </button>
              <p className="small muted">This form is rate limited. Do not include private ceremonial knowledge, personal data or copyrighted text in the message.</p>
            </form>
          )}
        </section>

        <aside className="editorial-aside">
          <h2>How this is handled</h2>
          <ol className="plain-list numbered">
            <li>The request is stored against the named source where possible.</li>
            <li>An editor records it as under review, resolved or declined with a note.</li>
            <li>Restriction or removal is a separate, logged decision; no automatic deletion occurs.</li>
            <li>Community consultation can be requested before any further import.</li>
          </ol>
          <p className="small muted">No account is required, so a rights holder is not forced to become a reader. Contact details are used only to follow up on this request.</p>
          <Link className="text-link" to="/sources">Browse the source registry</Link>
        </aside>
      </div>
    </div>
  );
}
