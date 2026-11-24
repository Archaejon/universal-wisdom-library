import { useEffect, useState } from "react";
import { Link, useLocation } from "./router";
import { api } from "./api";
import { AuthProvider } from "./auth";
import { PrefsProvider } from "./prefs";
import { ToastProvider, type Site } from "./components";
import { AppShell } from "./shell";
import { HomePage } from "./pages/HomePage";
import { LibraryPage } from "./pages/LibraryPage";
import { WorkPage } from "./pages/WorkPage";
import { ReaderPage } from "./pages/ReaderPage";
import { SearchPage } from "./pages/SearchPage";
import { ThemesPage, ThemePage } from "./pages/ThemesPage";
import { ComparePage } from "./pages/ComparePage";
import { AssistantPage } from "./pages/AssistantPage";
import { StudyPage } from "./pages/StudyPage";
import { AccountPage } from "./pages/AccountPage";
import { ProvenancePage } from "./pages/ProvenancePage";
import { EditorialPage } from "./pages/EditorialPage";
import { SourcesPage } from "./pages/SourcesPage";
import { SourceDetailPage } from "./pages/SourceDetailPage";
import { AdminSourcesPage } from "./pages/AdminSourcesPage";
import { RightsPage } from "./pages/RightsPage";

const FALLBACK_SITE: Site = {
  name: "Universal Wisdom Library",
  tagline: "A shared reading room for the world's sacred and philosophical texts",
  description: "A searchable, comparative library of primary texts, translations, commentary and thematic connections across traditions.",
  corpusVersion: "0.6.0",
  corpusLabel: "Streamed reading corpus",
  corpusNotice: "Every text names the edition, source and rights. The Jewish shelves, the Pali suttas, the Qur’an, the Dhammapada, the Christian Bible and the patristic and scholastic works are read from Sefaria, SuttaCentral, AlQuran Cloud, the Bolls Bible API, the Christian Classics Ethereal Library and New Advent when you open them; this library stores their catalogue records, chapter outlines and passage indexes, not copies of the text.",
};

function NotFound() {
  return (
    <div className="container page">
      <div className="not-found">
        <p className="eyebrow">404</p>
        <h1>This page is not in the catalogue.</h1>
        <p>The address may be mistyped, or the work may have moved. The library is still open.</p>
        <div className="button-row">
          <Link className="button primary" to="/">Return home</Link>
          <Link className="button" to="/library">Browse the library</Link>
          <Link className="button ghost" to="/search">Search the corpus</Link>
        </div>
      </div>
    </div>
  );
}

function Routes({ site }: { site: Site }) {
  const location = useLocation();
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const parts = path.split("/").filter(Boolean).map((p) => {
    try { return decodeURIComponent(p); } catch { return p; }
  });

  if (path === "/") return <HomePage site={site} />;
  if (path === "/library") return <LibraryPage />;
  if (path === "/search") return <SearchPage />;
  if (path === "/themes") return <ThemesPage />;
  if (path === "/compare") return <ComparePage />;
  if (path === "/assistant") return <AssistantPage />;
  if (path === "/study") return <StudyPage />;
  if (path === "/account") return <AccountPage />;
  if (path === "/provenance") return <ProvenancePage site={site} />;
  if (path === "/editorial") return <EditorialPage />;
  if (path === "/sources") return <SourcesPage />;
  if (path === "/rights") return <RightsPage />;
  if (path === "/admin/sources") return <AdminSourcesPage />;

  if (parts[0] === "work" && parts[1]) return <WorkPage slug={parts[1]} />;
  if (parts[0] === "sources" && parts[1]) return <SourceDetailPage sourceId={parts[1]} />;
  if (parts[0] === "read" && parts[1]) return <ReaderPage slug={parts[1]} />;
  if (parts[0] === "themes" && parts[1]) return <ThemePage slug={parts[1]} />;

  return <NotFound />;
}

function Shell() {
  const [site, setSite] = useState<Site>(FALLBACK_SITE);

  useEffect(() => {
    api<{ site: Site }>("/api/site")
      .then((d) => { if (d.site) setSite(d.site); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const title = site.name;
    if (document.title.includes("—")) {
      document.title = document.title.split("—").slice(0, -1).join("—").trim() + ` — ${title}`;
    } else {
      document.title = title;
    }
  }, [site.name]);

  return (
    <AppShell site={site}>
      <Routes site={site} />
    </AppShell>
  );
}

export function App() {
  return (
    <PrefsProvider>
      <AuthProvider>
        <ToastProvider>
          <Shell />
        </ToastProvider>
      </AuthProvider>
    </PrefsProvider>
  );
}
