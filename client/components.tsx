import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, navigate, useLocation } from "./router";
import { useAuth } from "./auth";
import { usePrefs } from "./prefs";

export type Site = {
  name: string;
  tagline: string;
  description: string;
  corpusVersion: string;
  corpusLabel: string;
  corpusNotice: string;
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "search": return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
    case "bookmark": return <svg {...common}><path d="M6 4h12v17l-6-4-6 4V4Z" /></svg>;
    case "note": return <svg {...common}><path d="M5 4h14v16H5z" /><path d="M8 9h8M8 13h8M8 17h5" /></svg>;
    case "share": return <svg {...common}><path d="M12 3v12M7 8l5-5 5 5" /><path d="M5 13v7h14v-7" /></svg>;
    case "close": return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
    case "menu": return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
    case "arrow-left": return <svg {...common}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>;
    case "arrow-right": return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case "chevron": return <svg {...common}><path d="m9 6 6 6-6 6" /></svg>;
    case "sun": return <svg {...common}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" /></svg>;
    case "moon": return <svg {...common}><path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" /></svg>;
    case "plus": return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    case "check": return <svg {...common}><path d="m5 12 4.5 4.5L19 7" /></svg>;
    case "external": return <svg {...common}><path d="M14 4h6v6M20 4l-9 9" /><path d="M19 13v6H5V5h6" /></svg>;
    case "settings": return <svg {...common}><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h10M18 18h2" /><circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="16" cy="18" r="2" /></svg>;
    case "quote": return <svg {...common}><path d="M9 7H5v6h4v4H5M19 7h-4v6h4v4h-4" /></svg>;
    default: return null;
  }
}

export function Wordmark({ site, compact = false }: { site: Site; compact?: boolean }) {
  return (
    <Link to="/" className="wordmark" aria-label={`${site.name} home`}>
      <span className="wordmark-mark" aria-hidden="true"><span /><span /><span /></span>
      <span className="wordmark-text">
        <span className="wordmark-name">{site.name}</span>
        {!compact && <span className="wordmark-sub">Texts · translations · commentary</span>}
      </span>
    </Link>
  );
}

export function SiteHeader({ site }: { site: Site }) {
  const { user } = useAuth();
  const { resolvedTheme, setTheme } = usePrefs();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setMenuOpen(false);
    setSearchOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const nav = [
    { to: "/library", label: "Library" },
    { to: "/themes", label: "Themes" },
    { to: "/sources", label: "Sources" },
    { to: "/compare", label: "Compare" },
    { to: "/assistant", label: "Study assistant" },
    { to: "/study", label: "My study" },
  ];

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearchOpen(false);
    navigate(`/search?q=${encodeURIComponent(query.trim())}`);
  };

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Wordmark site={site} />
          <nav className="main-nav" aria-label="Main navigation">
            {nav.map((n) => (
              <Link key={n.to} to={n.to} className={location.pathname.startsWith(n.to) ? "nav-link active" : "nav-link"}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="header-actions">
            <button className="icon-button" onClick={() => setSearchOpen((v) => !v)} aria-label="Open search" title="Search (/)">
              <Icon name="search" />
            </button>
            <button
              className="icon-button"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              aria-label={resolvedTheme === "dark" ? "Switch to light reading mode" : "Switch to dark reading mode"}
              title="Reading mode"
            >
              <Icon name={resolvedTheme === "dark" ? "sun" : "moon"} />
            </button>
            <Link to={user ? "/study" : "/account"} className="user-link">
              {user ? <span className="user-initial" aria-hidden="true">{user.displayName.slice(0, 1).toUpperCase()}</span> : null}
              <span>{user ? user.displayName.split(" ")[0] : "Sign in"}</span>
            </Link>
            <button className="icon-button mobile-menu-button" onClick={() => setMenuOpen((v) => !v)} aria-label="Toggle menu" aria-expanded={menuOpen}>
              <Icon name={menuOpen ? "close" : "menu"} />
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="mobile-nav">
            {nav.map((n) => (
              <Link key={n.to} to={n.to} className="mobile-nav-link">{n.label}</Link>
            ))}
            <Link to="/provenance" className="mobile-nav-link">Edition provenance</Link>
            <Link to="/admin/sources" className="mobile-nav-link">Registry admin</Link>
          </div>
        )}
        {searchOpen && (
          <div className="header-search">
            <form onSubmit={submitSearch} className="header-search-inner">
              <Icon name="search" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search texts, authors, traditions…"
                aria-label="Search the library"
              />
              <span className="key-hint">Enter</span>
              <button type="button" className="icon-button" onClick={() => setSearchOpen(false)} aria-label="Close search"><Icon name="close" /></button>
            </form>
          </div>
        )}
      </header>
    </>
  );
}

export function SiteFooter({ site }: { site: Site }) {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Wordmark site={site} compact />
          <p>{site.tagline}</p>
          <p className="footer-corpus">{site.corpusLabel}. <Link to="/sources">Sources, editions and rights</Link>.</p>
        </div>
        <div className="footer-links">
          <Link to="/library">Library</Link>
          <Link to="/themes">Themes</Link>
          <Link to="/sources">Source registry</Link>
          <Link to="/assistant">Study assistant</Link>
          <Link to="/provenance">Edition provenance</Link>
          <Link to="/admin/sources">Registry admin</Link>
          <Link to="/editorial">Editorial review</Link>
        </div>
        <div className="footer-note">
          <p>Every imported text is shown with its edition, translator, source and licence. Demonstration content is labelled.</p>
          <p className="footer-version">{site.corpusVersion}</p>
        </div>
      </div>
    </footer>
  );
}

export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "accent" | "green" | "blue" | "warn" | "muted"; title?: string }) {
  return <span className={`badge badge-${tone}`} title={title}>{children}</span>;
}

export function AvailabilityBadge({ available, label }: { available: boolean; label?: string }) {
  return available ? <Badge tone="green">{label ?? "Text available"}</Badge> : <Badge tone="warn">{label ?? "Catalogue only"}</Badge>;
}

export function SampleBadge() {
  return <Badge tone="muted" title="This work is a curated excerpt, not a complete edition.">Sample excerpt</Badge>;
}

export function PageIntro({ eyebrow, title, lede, children }: { eyebrow?: string; title: string; lede?: string; children?: ReactNode }) {
  return (
    <header className="page-intro">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {lede && <p className="lede">{lede}</p>}
      {children}
    </header>
  );
}

export function SearchForm({
  initial = "",
  mode = "keyword",
  compact = false,
  onSearch,
  placeholder = "Search the corpus — a word, a phrase, or a question",
}: {
  initial?: string;
  mode?: string;
  compact?: boolean;
  onSearch?: (q: string, mode: string) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState(initial);
  const [m, setM] = useState(mode);
  useEffect(() => setQ(initial), [initial]);
  useEffect(() => setM(mode), [mode]);
  return (
    <form
      className={compact ? "search-form compact" : "search-form"}
      onSubmit={(e) => {
        e.preventDefault();
        const value = q.trim();
        if (!value) return;
        if (onSearch) onSearch(value, m);
        else navigate(`/search?q=${encodeURIComponent(value)}&mode=${m}`);
      }}
      role="search"
    >
      <div className="search-modes" role="group" aria-label="Search mode">
        {[
          ["keyword", "Keyword"],
          ["phrase", "Exact phrase"],
          ["concept", "Concept"],
        ].map(([value, label]) => (
          <button type="button" key={value} className={m === value ? "mode-chip active" : "mode-chip"} onClick={() => setM(value)} aria-pressed={m === value}>
            {label}
          </button>
        ))}
      </div>
      <div className="search-input-row">
        <Icon name="search" size={20} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Search query" />
        <button type="submit" className="button primary">Search</button>
      </div>
      <p className="search-hint">
        {m === "phrase"
          ? "Wraps your words as an exact phrase in the matching edition."
          : m === "concept"
            ? "Uses a curated theme lexicon plus full-text search. Not an AI model, and never a claim of equivalence."
            : "Matches words across originals and translations. Diacritics and script are preserved in the reader."}
      </p>
    </form>
  );
}

export function SearchResultSnippet({ text, terms }: { text: string; terms: string[] }) {
  const parts = useMemo(() => {
    const clean = terms.filter((t) => t && t.length > 0).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!clean.length) return [text];
    const re = new RegExp(`(${clean.join("|")})`, "gi");
    return text.split(re);
  }, [text, terms]);
  return (
    <span>
      {parts.map((part, i) =>
        terms.some((t) => t && part.toLowerCase() === t.toLowerCase()) ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>,
      )}
    </span>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="state-block" role="status" aria-live="polite">
      <span className="loading-rule" />
      <p>{label}…</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-block error" role="alert">
      <p className="state-title">Something went wrong</p>
      <p>{message}</p>
      {onRetry && <button className="button" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state-block empty">
      <p className="state-title">{title}</p>
      {children}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string; tone: "info" | "success" | "error" }[]>([]);
  const push = (message: string, tone: "info" | "success" | "error" = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  };
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.tone}`}>{t.message}</div>)}
      </div>
    </ToastContext.Provider>
  );
}
const ToastContext = createContext<{ push: (message: string, tone?: "info" | "success" | "error") => void } | null>(null);
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}

export function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <dialog ref={ref} className={wide ? "dialog wide" : "dialog"} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="dialog-inner">
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog"><Icon name="close" /></button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export function CopyButton({ text, label = "Copy link", small = false }: { text: string; label?: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  const { push } = useToast();
  return (
    <button
      className={small ? "button small" : "button"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          push("Copied to clipboard.", "success");
          setTimeout(() => setCopied(false), 2000);
        } catch {
          push("Could not copy. Select the address manually.", "error");
        }
      }}
      type="button"
    >
      <Icon name={copied ? "check" : "share"} size={16} /> {copied ? "Copied" : label}
    </button>
  );
}

export function AuthForm({ onDone, compact = false }: { onDone?: () => void; compact?: boolean }) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className={compact ? "auth-form compact" : "auth-form"}>
      <div className="tab-row" role="tablist">
        <button className={mode === "login" ? "tab active" : "tab"} onClick={() => { setMode("login"); setError(""); }} role="tab" aria-selected={mode === "login"}>Sign in</button>
        <button className={mode === "register" ? "tab active" : "tab"} onClick={() => { setMode("register"); setError(""); }} role="tab" aria-selected={mode === "register"}>Create account</button>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          setBusy(true);
          try {
            if (mode === "login") await login(email, password);
            else await register(displayName, email, password);
            onDone?.();
          } catch (err: any) {
            setError(err.message || "Could not sign in.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {mode === "register" && (
          <label className="field">
            <span>Display name</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" required minLength={2} maxLength={60} />
          </label>
        )}
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        <label className="field">
          <span>Password {mode === "register" && <small>(at least 10 characters)</small>}</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "register" ? 10 : 1} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button primary full" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button>
      </form>
      <p className="form-note">
        Accounts are local to this installation. Notes and collections are private by default. No third-party sign-in is connected.
      </p>
    </div>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return <div className="progress" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.max(2, value)}%` }} /></div>;
}

export function SectionHeading({ title, action, description }: { title: string; action?: ReactNode; description?: string }) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function EditionSourceLine({ edition, showRights = true }: { edition: any; showRights?: boolean }) {
  if (!edition) return null;
  return (
    <div className="edition-source">
      <div>
        <strong>{edition.title}</strong>
        {edition.translator && <span> · trans. {edition.translator}</span>}
        {edition.publicationYear && <span> · {edition.publicationYear}</span>}
      </div>
      <div className="edition-meta">
        {edition.language && <span>{edition.language.name}{edition.language.direction === "rtl" ? " · RTL" : ""}</span>}
        {edition.source?.name && <span>Source: {edition.source.name}</span>}
        {showRights && edition.license?.name && <span>{edition.license.name}</span>}
        {edition.source?.status && <span className={`source-status status-${edition.source.status}`}>{edition.source.status}</span>}
      </div>
    </div>
  );
}

export function LocalHistory() {
  return null;
}
