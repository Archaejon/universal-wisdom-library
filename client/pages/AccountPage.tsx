import { useEffect, useState } from "react";
import { Link, navigate, useLocation } from "../router";
import { useAuth } from "../auth";
import { AuthForm, Badge, PageIntro } from "../components";

export function AccountPage() {
  const { user, counts, loading, logout } = useAuth();
  const location = useLocation();
  const next = new URLSearchParams(location.search).get("next") || "/study";
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      // Keep the signed-in view; the user may still want to read the privacy note.
    }
  }, [loading, user]);

  if (loading) return <div className="container page"><p className="muted">Checking your session…</p></div>;

  return (
    <div className="container page account-page">
      <PageIntro
        eyebrow="Your account"
        title={user ? "Your study account" : "Sign in to keep your study"}
        lede={user ? "Bookmarks, private notes, collections and reading progress are stored on this installation." : "An account lets you bookmark passages, write private notes, assemble collections and keep your place. Reading the library does not require an account."}
      />

      {user ? (
        <div className="account-grid">
          <section className="account-card">
            <h2>{user.displayName}</h2>
            <p className="muted">{user.email}</p>
            <div className="account-facts">
              <div><span className="fact-label">Role</span><span>{user.role}</span></div>
              <div><span className="fact-label">Member since</span><span>{new Date(user.createdAt?.replace(" ", "T") + "Z").toLocaleDateString()}</span></div>
            </div>
            <div className="account-counts">
              <Link to="/study?tab=bookmarks"><strong>{counts.bookmarks}</strong><span>Bookmarks</span></Link>
              <Link to="/study?tab=notes"><strong>{counts.notes}</strong><span>Notes</span></Link>
              <Link to="/study?tab=collections"><strong>{counts.collections}</strong><span>Collections</span></Link>
            </div>
            <div className="button-row">
              <Link className="button primary" to="/study">Open my study</Link>
              <button
                className="button ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try { await logout(); navigate("/"); } finally { setBusy(false); }
                }}
              >Sign out</button>
            </div>
          </section>
          <aside className="account-card muted-card">
            <h3>Privacy</h3>
            <p>Notes are private by default and returned only to you. Collections are private unless you explicitly make them public.</p>
            <p>Passwords are hashed on the server. Session cookies are HttpOnly and SameSite=Lax. This installation does not connect to a third-party identity provider.</p>
            <Link className="text-link" to="/provenance">Read about data and provenance</Link>
          </aside>
        </div>
      ) : (
        <div className="auth-layout">
          <div className="auth-panel">
            <AuthForm onDone={() => navigate(next)} />
          </div>
          <aside className="auth-aside">
            <h2>Why create an account?</h2>
            <ul>
              <li><strong>Bookmarks</strong> keep a passage one click away.</li>
              <li><strong>Private notes</strong> stay visible only to you.</li>
              <li><strong>Collections</strong> group passages for a reading list or comparison.</li>
              <li><strong>Progress</strong> remembers where you stopped.</li>
            </ul>
            <p className="small muted">No email verification, password reset or third-party sign-in is implemented in this build. Use a password you are willing to store here.</p>
            <Badge tone="warn">Local accounts only</Badge>
          </aside>
        </div>
      )}
    </div>
  );
}
