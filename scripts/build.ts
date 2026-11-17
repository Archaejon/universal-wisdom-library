import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const outdir = join(root, "public", "assets");
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(root, "client", "main.tsx")],
  outdir,
  naming: "[name]-[hash].[ext]",
  target: "browser",
  format: "esm",
  minify: process.env.NODE_ENV === "production",
  sourcemap: "none",
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV === "production" ? "production" : "development"),
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const outputs = result.outputs.map((o) => o.path);
const js = outputs.find((p) => p.endsWith(".js"));
const css = outputs.find((p) => p.endsWith(".css"));
if (!js) {
  console.error("No JS bundle was produced.");
  process.exit(1);
}
const rel = (p: string) => p.replace(join(root, "public"), "").replaceAll("\\", "/");
const html = `<!doctype html>
<html lang="en" data-theme="light">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="description" content="A searchable, comparative library of religious and philosophical texts with translations, commentary and clearly recorded provenance." />
    <title>Universal Wisdom Library</title>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='4' fill='%238a4b2e'/%3E%3Cpath d='M8 8h6v16H8zM18 8h6v16h-6z' fill='%23f5f0e6' opacity='.92'/%3E%3C/svg%3E" />
    ${css ? `<link rel="stylesheet" href="${rel(css)}" />` : ""}
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    <div id="root"></div>
    <script type="module" src="${rel(js)}"></script>
  </body>
</html>
`;
writeFileSync(join(root, "public", "index.html"), html);
console.log(`Built ${rel(js)}${css ? ` and ${rel(css)}` : ""}`);
