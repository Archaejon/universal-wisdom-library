// Desktop entry point: the program a reader downloads and double-clicks.
//
// It keeps the library in a per-user folder, downloads the library data on the
// first run, builds the database from it, starts the server on this computer
// only and opens the reader in the default web browser. The same server code
// runs as in development; this file only prepares the folder and environment.
//
//   bun run scripts/app.ts            # run from source
//   bun run build:app                 # compile it into a single executable
//
// Environment (all optional):
//   UWL_HOME          library folder (default: the per-user folder below)
//   UWL_LIBRARY_URL   where to fetch the library data (http(s) URL or local path)
//   UWL_NO_BROWSER=1  do not open a browser window
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { files as embeddedClient } from "./app-client-assets";
import pkg from "../package.json" with { type: "json" };

const VERSION: string = pkg.version;
const APP_NAME = "Universal Wisdom Library";
const REPO = "Archaejon/universal-wisdom-library";
const DEFAULT_LIBRARY_URL = `https://github.com/${REPO}/releases/download/v${VERSION}/uwl-library-${VERSION}.jsonl.gz`;

function defaultHome(): string {
  const home = homedir();
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), APP_NAME);
  if (process.platform === "darwin") return join(home, "Library", "Application Support", APP_NAME);
  return join(process.env.XDG_DATA_HOME || join(home, ".local", "share"), "universal-wisdom-library");
}

const HOME = process.env.UWL_HOME || defaultHome();
const MARKER = join(HOME, "library-version.txt");

function say(line = "") {
  console.log(line);
}

/** Keep the window open after a failure so a double-clicked app doesn't just vanish. */
async function waitForEnter(message: string) {
  if (!process.stdin.isTTY) return;
  say(message);
  for await (const _ of console) break;
}

async function fatal(message: string, err?: unknown): Promise<never> {
  say();
  say(`Something went wrong: ${message}`);
  if (err) say(String((err as Error)?.stack ?? err));
  await waitForEnter("Press Enter to close this window.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Library data: a gzip of JSON lines. The first line is a header
// { format, version, files }; each further line is { path, content } for one
// file under data/ (the corpus and the registry).
// ---------------------------------------------------------------------------

async function openLibraryStream(source: string): Promise<{ body: ReadableStream<Uint8Array>; size: number }> {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source, { redirect: "follow" });
    if (!res.ok || !res.body) throw new Error(`the download answered ${res.status} ${res.statusText} (${source})`);
    return { body: res.body, size: Number(res.headers.get("content-length") ?? 0) };
  }
  const file = Bun.file(source);
  if (!(await file.exists())) throw new Error(`no library file at ${source}`);
  return { body: file.stream(), size: file.size };
}

async function installLibrary(source: string) {
  const staging = join(HOME, "data.incoming");
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  const { body, size } = await openLibraryStream(source);
  let received = 0;
  let lastShown = -1;
  const counted = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (size > 0) {
          const pct = Math.floor((received / size) * 100);
          if (pct >= lastShown + 5) {
            lastShown = pct - (pct % 5);
            process.stdout.write(`\r  Downloading the library… ${pct}% of ${(size / 1e6).toFixed(0)} MB   `);
          }
        }
        controller.enqueue(chunk);
      },
    }),
  );
  const gunzip = new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>;
  const reader = counted.pipeThrough(gunzip).getReader();
  const decoder = new TextDecoder();

  let header: { format?: string; version?: string; files?: number } | null = null;
  let written = 0;
  let buffer = "";
  const handleLine = (line: string) => {
    if (!line.trim()) return;
    const record = JSON.parse(line);
    if (!header) {
      if (record.format !== "uwl-library") throw new Error("the downloaded file is not Universal Wisdom Library data");
      header = record;
      return;
    }
    const rel = String(record.path ?? "");
    // Only files under data/, and never a path that climbs out of it.
    if (!rel.startsWith("data/") || rel.split("/").includes("..")) throw new Error(`unexpected path in library data: ${rel}`);
    const target = join(staging, rel.slice("data/".length));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, String(record.content ?? ""));
    written++;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      handleLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  buffer += decoder.decode();
  handleLine(buffer);
  process.stdout.write("\n");

  const expected = (header as { files?: number } | null)?.files;
  if (!header || (expected != null && expected !== written)) {
    throw new Error(`the library download was incomplete (${written} of ${expected ?? "?"} files)`);
  }

  // Swap the new data in. The database is kept if one exists.
  const data = join(HOME, "data");
  mkdirSync(data, { recursive: true });
  for (const part of ["corpus", "registry"]) {
    rmSync(join(data, part), { recursive: true, force: true });
    if (existsSync(join(staging, part))) renameSync(join(staging, part), join(data, part));
  }
  rmSync(staging, { recursive: true, force: true });
  say(`  Unpacked ${written.toLocaleString()} files.`);
}

// ---------------------------------------------------------------------------
// The web client is embedded in the executable. Unpack it once per version.
// ---------------------------------------------------------------------------

async function unpackClient(): Promise<string | null> {
  const entries = Object.entries(embeddedClient);
  if (!entries.length) return null; // Running from source: serve ./public as usual.
  const dir = join(HOME, "app", VERSION, "public");
  if (existsSync(join(dir, "index.html"))) return dir;
  for (const [urlPath, embedded] of entries) {
    const target = join(dir, urlPath);
    mkdirSync(dirname(target), { recursive: true });
    await Bun.write(target, Bun.file(embedded));
  }
  return dir;
}

async function freePort(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + 20; port++) {
    try {
      const probe = Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response() });
      probe.stop(true);
      return port;
    } catch {
      // In use; try the next one.
    }
  }
  return 0; // Let the system choose.
}

function openBrowser(url: string) {
  if (process.env.UWL_NO_BROWSER === "1") return;
  const cmd =
    process.platform === "win32"
      ? ["cmd", "/c", "start", "", url]
      : process.platform === "darwin"
        ? ["open", url]
        : ["xdg-open", url];
  try {
    Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  } catch {
    // No browser launcher; the address is printed below.
  }
}

// ---------------------------------------------------------------------------

say(`${APP_NAME} ${VERSION}`);
say(`Library folder: ${HOME}`);
say();

try {
  mkdirSync(HOME, { recursive: true });
} catch (err) {
  await fatal(`could not create the library folder ${HOME}`, err);
}

const installed = existsSync(MARKER) ? readFileSync(MARKER, "utf8").trim() : "";
if (!installed || !existsSync(join(HOME, "data", "corpus", "works"))) {
  say("First run: setting up the library. This happens once.");
  say("  1. Download the library data (about 400 MB).");
  say("  2. Build the library on this computer. This can take a long time; leave this window open.");
  say();
  try {
    await installLibrary(process.env.UWL_LIBRARY_URL || DEFAULT_LIBRARY_URL);
  } catch (err) {
    await fatal(`could not download the library data. Check the internet connection and start the app again.`, err);
  }
  say("  Building the library (step 2 of 2)…");
} else if (installed !== VERSION) {
  say(`Your library data is from version ${installed}; this app is version ${VERSION}. Keeping your existing library.`);
}

const publicDir = await unpackClient();
const port = await freePort(Number(process.env.PORT || 4173));

process.env.NODE_ENV = "production";
process.env.UWL_HOME = HOME;
process.env.UWL_DB_PATH ||= join(HOME, "data", "uwl.db");
process.env.HOST = "127.0.0.1";
process.env.PORT = String(port);
// The registry's availability checks are for the hosted library's editors.
process.env.UWL_CHECK_SCHEDULE ||= "off";
if (publicDir) process.env.UWL_PUBLIC_DIR = publicDir;

try {
  await import("./serve");
} catch (err) {
  await fatal("the library could not start", err);
}

if (!installed) writeFileSync(MARKER, VERSION);

say();
if (port) {
  const url = `http://127.0.0.1:${port}/`;
  say(`The library is open at ${url}`);
  openBrowser(url);
} else {
  say("The library is open at the address shown above.");
}
say("Leave this window open while you read. Close it to stop the library.");
