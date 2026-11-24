import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const el = document.getElementById("root");
if (!el) throw new Error("Root element missing");
createRoot(el).render(<App />);

// The desktop app serves the library on this computer only and stops itself
// when no reader is connected (scripts/serve.ts, UWL_IDLE_EXIT_MINUTES). An
// open page checks in once a minute so it isn't stopped while someone reads.
if (location.hostname === "127.0.0.1" || location.hostname === "localhost") {
  setInterval(() => {
    fetch("/api/health", { cache: "no-store" }).catch(() => {});
  }, 60_000);
}
