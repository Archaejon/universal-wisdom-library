// Compiles the desktop app (scripts/app.ts) into single executables, with the
// production web client embedded.
//
//   bun run build:app                                  # this computer's platform
//   bun run build:app --target=bun-windows-x64,bun-linux-x64
//   bun run build:app --target=all --package           # also zip each one for release
//
// Output goes to dist/. With --package each build is wrapped with a short
// "read me first" note: a .zip for Windows and macOS, a .tar.gz for Linux
// (archives keep the executable bit that a plain browser download loses).
import { chmodSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import pkg from "../package.json" with { type: "json" };

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");
const VERSION = pkg.version;
const APP_FILE = "Universal Wisdom Library";

const TARGETS: Record<string, { os: "windows" | "macos" | "linux"; arch: string }> = {
  "bun-windows-x64": { os: "windows", arch: "x64" },
  "bun-darwin-arm64": { os: "macos", arch: "arm64" },
  "bun-darwin-x64": { os: "macos", arch: "x64" },
  "bun-linux-x64": { os: "linux", arch: "x64" },
  "bun-linux-arm64": { os: "linux", arch: "arm64" },
};

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";
const shouldPackage = process.argv.includes("--package");
const native = `bun-${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`;
const requested = arg("target") || native;
const targets = requested === "all" ? Object.keys(TARGETS) : requested.split(",").map((t) => t.trim()).filter(Boolean);
for (const t of targets) {
  if (!TARGETS[t]) {
    console.error(`Unknown target ${t}. Known: ${Object.keys(TARGETS).join(", ")}`);
    process.exit(1);
  }
}

async function run(cmd: string[], env: Record<string, string> = {}, cwd = ROOT) {
  const proc = Bun.spawn(cmd, { cwd, env: { ...process.env, ...env }, stdout: "inherit", stderr: "inherit" });
  if ((await proc.exited) !== 0) throw new Error(`${cmd.join(" ")} failed`);
}

// 1. The production web client.
await run(["bun", "run", "scripts/build.ts"], { NODE_ENV: "production" });

// 2. A module that embeds every file in public/, used in place of the empty stand-in.
const PUBLIC = join(ROOT, "public");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const clientFiles = walk(PUBLIC);
const embedModule = [
  ...clientFiles.map((f, i) => `import f${i} from ${JSON.stringify(f)} with { type: "file" };`),
  `export const files: Record<string, string> = {`,
  ...clientFiles.map((f, i) => `  ${JSON.stringify("/" + relative(PUBLIC, f).split("\\").join("/"))}: f${i},`),
  `};`,
].join("\n");

const embedClient: Bun.BunPlugin = {
  name: "embed-client",
  setup(build) {
    build.onResolve({ filter: /^\.\/app-client-assets$/ }, () => ({ path: "client-assets", namespace: "uwl-embed" }));
    build.onLoad({ filter: /.*/, namespace: "uwl-embed" }, () => ({ loader: "ts", contents: embedModule }));
  },
};

const README: Record<string, string> = {
  windows: `Universal Wisdom Library ${VERSION}

To start: double-click "${APP_FILE}.exe".

Windows may show "Windows protected your PC", because the app is not signed.
Click "More info", then "Run anyway".

The first start downloads the library (about 3 GB) and unpacks it, which
takes a while; you need about 11 GB of free disk space while it installs and
7 GB after. If the download is interrupted, start the app again and it carries
on where it stopped. After that it starts in a few seconds. A black window
stays open while the library runs; the reader opens in your web browser.
Close the black window to stop the library.

Your library is kept in: %LOCALAPPDATA%\\Universal Wisdom Library
`,
  macos: `Universal Wisdom Library ${VERSION}

To start: double-click "${APP_FILE}".

The first time, macOS may say the app "cannot be opened" because the developer
cannot be verified (the app is not signed). Instead, right-click (or
Control-click) "${APP_FILE}", choose Open, then click Open again. You only
need to do this once.

The first start downloads the library (about 3 GB) and unpacks it, which
takes a while; you need about 11 GB of free disk space while it installs and
7 GB after. If the download is interrupted, start the app again and it carries
on where it stopped. After that it starts in a few seconds. A Terminal window
stays open while the library runs; the reader opens in your web browser.
Close the Terminal window to stop the library.

Your library is kept in: ~/Library/Application Support/Universal Wisdom Library
`,
  linux: `Universal Wisdom Library ${VERSION}

To start: run ./"${APP_FILE}" from a terminal (or double-click it, if your
file manager runs programs).

The first start downloads the library (about 3 GB) and unpacks it, which
takes a while; you need about 11 GB of free disk space while it installs and
7 GB after. The reader opens in your web browser at
http://127.0.0.1:4173/. Stop the library with Ctrl+C.

Your library is kept in: ~/.local/share/universal-wisdom-library
`,
};

mkdirSync(DIST, { recursive: true });
for (const target of targets) {
  const { os, arch } = TARGETS[target];
  const folder = join(DIST, `UniversalWisdomLibrary-${VERSION}-${os}-${arch}`);
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const outfile = join(folder, os === "windows" ? `${APP_FILE}.exe` : APP_FILE);

  console.log(`Compiling ${target}…`);
  const result = await Bun.build({
    entrypoints: [join(ROOT, "scripts", "app.ts")],
    compile: { target, outfile } as Bun.BuildConfig["compile"],
    minify: true,
    // The bundler fixes process.env.NODE_ENV at build time; the app is always production.
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    plugins: [embedClient],
  } as Bun.BuildConfig);
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  if (os !== "windows") chmodSync(outfile, 0o755);
  // Apple Silicon refuses to run an unsigned binary; an ad-hoc signature is
  // enough to run (Gatekeeper still asks once). Only possible on a Mac.
  if (os === "macos" && process.platform === "darwin") await run(["codesign", "--force", "--sign", "-", outfile]);
  writeFileSync(join(folder, "READ ME FIRST.txt"), README[os].replace(/\n/g, os === "windows" ? "\r\n" : "\n"));
  console.log(`  ${relative(ROOT, outfile)} (${(statSync(outfile).size / 1e6).toFixed(0)} MB)`);

  if (shouldPackage) {
    const name = relative(DIST, folder);
    if (os === "linux") {
      await run(["tar", "-czf", `${name}.tar.gz`, name], {}, DIST);
      console.log(`  dist/${name}.tar.gz`);
    } else {
      rmSync(join(DIST, `${name}.zip`), { force: true });
      await run(["zip", "-qry", `${name}.zip`, name], {}, DIST);
      console.log(`  dist/${name}.zip`);
    }
  }
}
