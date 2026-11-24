// The page the desktop app opens in the browser while it installs the library.
// It polls /setup/status and shows the download and unpack progress, explains
// a failure with a "Try again" button, and moves on to the library once it is
// ready. Self-contained: served by the app's small setup server, not the
// library's (which has a strict content policy).
export function setupPage(version: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Setting up the Universal Wisdom Library</title>
<link rel="icon" href="/setup/icon.png" />
<style>
  :root { --bg: #f5f0e6; --ink: #2b211c; --muted: #6b5d53; --brand: #8a4b2e; --track: #e4dacb; --err: #9b2c2c; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #1d1915; --ink: #efe7db; --muted: #b3a597; --brand: #d08a62; --track: #3a322b; --err: #f08a8a; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--ink);
         font: 17px/1.55 Georgia, "Iowan Old Style", "Palatino Linotype", serif; padding: 24px 16px; }
  main { width: 100%; max-width: 560px; }
  .mark { width: 56px; height: 56px; border-radius: 12px; display: block; margin-bottom: 20px; }
  h1 { font-size: 1.6rem; font-weight: normal; margin: 0 0 6px; }
  .lead { color: var(--muted); margin: 0 0 28px; }
  .step { font-family: system-ui, sans-serif; font-size: .95rem; margin: 0 0 8px; }
  .bar { height: 10px; border-radius: 5px; background: var(--track); overflow: hidden; }
  .bar span { display: block; height: 100%; width: 0; background: var(--brand); transition: width .6s ease; }
  .detail { font-family: system-ui, sans-serif; font-size: .85rem; color: var(--muted); margin: 8px 0 0; min-height: 1.3em; }
  .note { color: var(--muted); font-size: .95rem; margin-top: 28px; border-top: 1px solid var(--track); padding-top: 16px; }
  .error { color: var(--err); font-family: system-ui, sans-serif; font-size: .95rem; margin-top: 20px; display: none; }
  button { font: inherit; font-family: system-ui, sans-serif; font-size: .95rem; margin-top: 12px; padding: 8px 18px;
           border-radius: 6px; border: 1px solid var(--brand); background: var(--brand); color: #fff; cursor: pointer; display: none; }
</style>
</head>
<body>
<main>
  <img class="mark" src="/setup/icon.png" alt="" />
  <h1>Setting up the Universal Wisdom Library</h1>
  <p class="lead">This happens once. The library is about 3 GB to download, and needs about 7 GB of space once it's in place.</p>
  <p class="step" id="step">Starting…</p>
  <div class="bar" role="progressbar" aria-labelledby="step" aria-valuemin="0" aria-valuemax="100"><span id="fill"></span></div>
  <p class="detail" id="detail"></p>
  <p class="error" id="error"></p>
  <button id="retry" type="button">Try again</button>
  <p class="note">You can leave this page open and do something else. If the download is interrupted, start the app again: it carries on where it stopped. Version ${version}.</p>
</main>
<script>
  const $ = (id) => document.getElementById(id);
  const gb = (n) => (n / 1e9).toFixed(1) + " GB";
  let leaving = false;
  async function waitForLibrary() {
    for (;;) {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (res.ok && (await res.json()).ok) { location.replace("/"); return; }
      } catch {}
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  async function poll() {
    if (leaving) return;
    try {
      const s = await (await fetch("/setup/status", { cache: "no-store" })).json();
      const pct = s.total ? Math.min(100, Math.floor((s.done / s.total) * 100)) : 0;
      $("step").textContent = s.label + (s.total ? " " + pct + "%" : "");
      $("fill").style.width = (s.phase === "ready" ? 100 : pct) + "%";
      document.querySelector(".bar").setAttribute("aria-valuenow", String(pct));
      $("detail").textContent = s.total ? gb(s.done) + " of " + gb(s.total) : "";
      $("error").style.display = s.error ? "block" : "none";
      $("error").textContent = s.error || "";
      $("retry").style.display = s.error ? "inline-block" : "none";
      if (s.phase === "ready") { leaving = true; $("step").textContent = "Opening the library…"; waitForLibrary(); return; }
    } catch {
      // The setup server hands over to the library; keep trying.
    }
    setTimeout(poll, 1000);
  }
  $("retry").addEventListener("click", async () => {
    $("retry").style.display = "none";
    await fetch("/setup/retry", { method: "POST" }).catch(() => {});
  });
  poll();
</script>
</body>
</html>`;
}
