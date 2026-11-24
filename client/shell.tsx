// The application frame: a sidebar on the left, the page in the middle and an
// optional study panel on the right, in the manner of a reading desk.
//
// The sidebar holds search, the main sections, the passages read most recently
// and the reading mode. The study panel shows things about the text in view
// (a passage's editions, commentary and connections) without leaving the page;
// any page opens it with useStudyPanel(). On narrow screens the sidebar becomes
// a drawer behind a top bar and the panel covers the page.
import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, navigate, useLocation } from "./router";
import { useAuth } from "./auth";
import { usePrefs } from "./prefs";
import { Icon, Wordmark, type Site } from "./components";
import { recentHref, useRecent } from "./recent";

// ---------------------------------------------------------------------------
// Study panel
// ---------------------------------------------------------------------------

export type StudyPanelContent = { key: string; eyebrow?: string; title: ReactNode; body: ReactNode };

const StudyPanelContext = createContext<{
  panel: StudyPanelContent | null;
  open: (content: StudyPanelContent) => void;
  close: () => void;
} | null>(null);

export function useStudyPanel() {
  const ctx = useContext(StudyPanelContext);
  if (!ctx) throw new Error("useStudyPanel must be used inside the app shell");
  return ctx;
}

function StudyPanel() {
  const { panel, close } = useStudyPanel();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (panel) headingRef.current?.focus();
  }, [panel?.key]);
  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, close]);
  if (!panel) return null;
  return (
    <aside className="study-panel" aria-label="Study panel">
      <header className="study-panel-head">
        <div>
          <p className="study-panel-eyebrow">{panel.eyebrow ?? "Study panel"}</p>
          <h2 ref={headingRef} tabIndex={-1}>{panel.title}</h2>
        </div>
        <button className="icon-button" onClick={close} aria-label="Close the study panel" title="Close (Esc)">
          <Icon name="close" />
        </button>
      </header>
      <div className="study-panel-body">{panel.body}</div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

const NAV = [
  { to: "/library", label: "Library", icon: "library" },
  { to: "/search", label: "Search", icon: "search" },
  { to: "/themes", label: "Themes", icon: "tag" },
  { to: "/compare", label: "Compare", icon: "columns" },
  { to: "/assistant", label: "Study assistant", icon: "chat" },
  { to: "/study", label: "My study", icon: "bookmark" },
];

const MORE = [
  { to: "/sources", label: "Sources" },
  { to: "/provenance", label: "Provenance" },
  { to: "/rights", label: "Rights" },
  { to: "/editorial", label: "Editorial review" },
  { to: "/admin/sources", label: "Registry admin" },
];

function Sidebar({ site, searchRef, onNavigate }: { site: Site; searchRef: React.RefObject<HTMLInputElement | null>; onNavigate: () => void }) {
  const { user } = useAuth();
  const { resolvedTheme, setTheme } = usePrefs();
  const location = useLocation();
  const recent = useRecent();
  const [query, setQuery] = useState("");
  const latest = recent[0];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    navigate(`/search?q=${encodeURIComponent(query.trim())}`);
    setQuery("");
  };

  const isActive = (to: string) => location.pathname === to || location.pathname.startsWith(`${to}/`);
  const readerActive = location.pathname.startsWith("/read/") || location.pathname.startsWith("/work/");

  return (
    <div className="sidebar-inner">
      <Wordmark site={site} />

      <form className="sidebar-search" onSubmit={submit} role="search">
        <Icon name="search" size={16} />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the library"
          aria-label="Search the library"
        />
        <kbd className="key-hint" aria-hidden="true">/</kbd>
      </form>

      <nav className="sidebar-nav" aria-label="Main navigation">
        <Link
          to={latest ? recentHref(latest) : "/library"}
          className={readerActive ? "sidebar-link active" : "sidebar-link"}
          title={latest ? `Continue reading: ${latest.title} ${latest.refLabel}` : "Open a text from the library"}
          onClick={onNavigate}
        >
          <span className="sidebar-icon"><Icon name="book" size={16} /></span>Reader
        </Link>
        {NAV.map((n) => (
          <Link key={n.to} to={n.to} className={isActive(n.to) ? "sidebar-link active" : "sidebar-link"} onClick={onNavigate}>
            <span className="sidebar-icon"><Icon name={n.icon} size={16} /></span>{n.label}
          </Link>
        ))}
      </nav>

      <section className="sidebar-recent" aria-label="Recently opened">
        <h2 className="sidebar-heading">Recently opened</h2>
        {recent.length ? (
          <ul>
            {recent.slice(0, 7).map((r) => (
              <li key={`${r.slug}:${r.ref}`}>
                <Link to={recentHref(r)} onClick={onNavigate} title={`${r.title} ${r.refLabel}`}>
                  <span className="recent-title">{r.title}</span>
                  <span className="recent-ref">{r.refLabel || r.ref}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sidebar-empty">Nothing yet. Texts you open appear here.</p>
        )}
      </section>

      <div className="sidebar-foot">
        <details className="sidebar-more">
          <summary>Sources, provenance and more</summary>
          <nav aria-label="More">
            {MORE.map((m) => (
              <Link key={m.to} to={m.to} className={isActive(m.to) ? "active" : ""} onClick={onNavigate}>{m.label}</Link>
            ))}
          </nav>
        </details>
        <div className="sidebar-actions">
          <button
            className="button small"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            aria-label={resolvedTheme === "dark" ? "Switch to light reading mode" : "Switch to dark reading mode"}
          >
            <Icon name={resolvedTheme === "dark" ? "sun" : "moon"} size={15} />
            {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <Link to={user ? "/study" : "/account"} className="sidebar-account" onClick={onNavigate}>
            {user ? <span className="user-initial" aria-hidden="true">{user.displayName.slice(0, 1).toUpperCase()}</span> : <Icon name="user" size={15} />}
            <span>{user ? user.displayName.split(" ")[0] : "Sign in"}</span>
          </Link>
        </div>
        <p className="sidebar-rights">
          Every text names its edition, source and licence. <Link to="/sources" onClick={onNavigate}>Sources and rights</Link>.
          <span className="sidebar-version"> {site.corpusVersion}</span>
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

export function AppShell({ site, children }: { site: Site; children: ReactNode }) {
  const location = useLocation();
  const [panel, setPanel] = useState<StudyPanelContent | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // A new page starts without a panel or an open drawer.
  useEffect(() => {
    setPanel(null);
    setDrawerOpen(false);
  }, [location.pathname, location.search]);

  // "/" focuses search from anywhere but a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        setDrawerOpen(true);
        requestAnimationFrame(() => searchRef.current?.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ctx = {
    panel,
    open: (content: StudyPanelContent) => setPanel(content),
    close: () => setPanel(null),
  };

  return (
    <StudyPanelContext.Provider value={ctx}>
      <div className={panel ? "app-shell with-panel" : "app-shell"}>
        <a className="skip-link" href="#main">Skip to content</a>
        <header className="mobile-bar">
          <button className="icon-button" onClick={() => setDrawerOpen((v) => !v)} aria-label="Menu" aria-expanded={drawerOpen}>
            <Icon name={drawerOpen ? "close" : "menu"} />
          </button>
          <Wordmark site={site} compact />
        </header>
        <aside className={drawerOpen ? "sidebar open" : "sidebar"} aria-label="Sidebar">
          <Sidebar site={site} searchRef={searchRef} onNavigate={() => setDrawerOpen(false)} />
        </aside>
        {drawerOpen && <div className="sidebar-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}
        <main id="main" className="site-main">{children}</main>
        <StudyPanel />
      </div>
    </StudyPanelContext.Provider>
  );
}
