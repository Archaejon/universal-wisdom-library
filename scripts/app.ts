// Desktop entry point: the program a reader downloads and double-clicks.
//
// It keeps the library in a per-user folder, downloads the ready-made library
// database on the first run, starts the server on this computer only and opens
// the reader in the default web browser. The same server code runs as in
// development; this file only prepares the folder and environment.
//
//   bun run scripts/app.ts            # run from source
//   bun run build:app                 # compile it into a single executable
//
// Environment (all optional):
//   UWL_HOME          library folder (default: the per-user folder below)
//   UWL_LIBRARY_URL   the library manifest (http(s) URL or local path); its
//                     parts are fetched from the same place
//   UWL_NO_BROWSER=1  do not open a browser window
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { files as embeddedClient } from "./app-client-assets";
import pkg from "../package.json" with { type: "json" };

const VERSION: string = pkg.version;
const APP_NAME = "Universal Wisdom Library";
const REPO = "Archaejon/universal-wisdom-library";
const DEFAULT_LIBRARY_URL = `https://github.com/${REPO}/releases/download/v${VERSION}/uwl-library-${VERSION}.json`;

function defaultHome(): string {
  const home = homedir();
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), APP_NAME);
  if (process.platform === "darwin") return join(home, "Library", "Application Support", APP_NAME);
  return join(process.env.XDG_DATA_HOME || join(home, ".local", "share"), "universal-wisdom-library");
}

const HOME = process.env.UWL_HOME || defaultHome();
const DB_FILE = join(HOME, "data", "uwl.db");
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
  if (err) say(String((err as Error)?.message ?? err));
  await waitForEnter("Press Enter to close this window.");
  process.exit(1);
}

const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;

// ---------------------------------------------------------------------------
// The library: a ready-made database, compressed with zstd and split into
// parts (scripts/build-library-db.ts). A manifest lists the parts with their
// sizes and SHA-256 hashes. Parts are kept in HOME/download until the
// database is in place, so an interrupted download resumes where it stopped.
// ---------------------------------------------------------------------------

type Manifest = {
  format: string;
  version: string;
  database: { size: number; sha256: string };
  parts: { name: string; size: number; sha256: string }[];
};

const isUrl = (s: string) => /^https?:\/\//.test(s);
const sibling = (base: string, name: string) =>
  isUrl(base) ? new URL(name, base).toString() : join(dirname(base), name);

async function readManifest(source: string): Promise<Manifest> {
  const text = isUrl(source)
    ? await fetch(source, { redirect: "follow" }).then((res) => {
        if (!res.ok) throw new Error(`the library list answered ${res.status} ${res.statusText} (${source})`);
        return res.text();
      })
    : readFileSync(source, "utf8");
  const manifest = JSON.parse(text) as Manifest;
  if (manifest.format !== "uwl-library-db" || !manifest.parts?.length) {
    throw new Error("the library list is not Universal Wisdom Library data");
  }
  return manifest;
}

async function fileSha256(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of createReadStream(path, { highWaterMark: 8 << 20 })) hasher.update(chunk as Buffer);
  return hasher.digest("hex");
}

let lastProgress = "";
/** Redraws the progress line, but only when the whole percentage changes. */
function progress(label: string, done: number, total: number) {
  const pct = total ? Math.min(100, Math.floor((done / total) * 100)) : 0;
  const key = `${label}${pct}`;
  if (key === lastProgress) return;
  lastProgress = key;
  process.stdout.write(`\r  ${label} ${pct}% (${gb(done)} of ${gb(total)})   `);
}

/** Fetch one part into `path`, continuing a partial file where possible. */
async function fetchPart(url: string, path: string, size: number, onBytes: (n: number) => void) {
  const have = existsSync(path) ? statSync(path).size : 0;
  if (have >= size) return;
  if (!isUrl(url)) {
    await Bun.write(path, Bun.file(url));
    onBytes(size - have);
    return;
  }
  const res = await fetch(url, { redirect: "follow", headers: have ? { Range: `bytes=${have}-` } : {} });
  if (!res.ok || !res.body) throw new Error(`the download answered ${res.status} ${res.statusText}`);
  // 206 continues the partial file; a plain 200 means the host restarted it.
  const resumed = res.status === 206;
  if (!resumed && have) onBytes(-have);
  const out = createWriteStream(path, { flags: resumed ? "a" : "w" });
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    if (!out.write(chunk)) await once(out, "drain");
    onBytes(chunk.byteLength);
  }
  out.end();
  await once(out, "finish");
}

async function installLibrary(source: string) {
  const manifest = await readManifest(source);
  const compressed = manifest.parts.reduce((n, p) => n + p.size, 0);
  const downloads = join(HOME, "download");
  mkdirSync(downloads, { recursive: true });
  mkdirSync(dirname(DB_FILE), { recursive: true });

  // Room for the parts still to fetch, the database, and a little to spare.
  const already = manifest.parts.reduce((n, p) => {
    const path = join(downloads, p.name);
    return n + (existsSync(path) ? Math.min(statSync(path).size, p.size) : 0);
  }, 0);
  const needed = compressed - already + manifest.database.size + 500_000_000;
  const fs = statfsSync(HOME);
  const free = Number(fs.bavail) * Number(fs.bsize);
  if (free < needed) {
    throw new Error(
      `there isn't enough free disk space. The library needs ${gb(needed)} free while it installs ` +
        `(${gb(manifest.database.size)} once installed); this disk has ${gb(free)} free. ` +
        `Free some space and start the app again.`,
    );
  }

  // 1. Download the parts.
  let received = already;
  for (const part of manifest.parts) {
    const path = join(downloads, part.name);
    for (let attempt = 1; ; attempt++) {
      try {
        await fetchPart(sibling(source, part.name), path, part.size, (n) => {
          received += n;
          progress("Downloading the library…", received, compressed);
        });
        if (statSync(path).size === part.size && (await fileSha256(path)) === part.sha256) break;
        // A damaged part is fetched again from the start.
        received -= statSync(path).size;
        rmSync(path, { force: true });
        throw new Error(`part ${part.name} did not match its checksum`);
      } catch (err) {
        if (attempt >= 5) throw err;
        process.stdout.write(`\n  The download was interrupted (${(err as Error).message}); trying again…\n`);
        await Bun.sleep(3000 * attempt);
      }
    }
  }
  progress("Downloading the library…", compressed, compressed);
  process.stdout.write("\n");

  // 2. Unpack them into the database file.
  const incoming = `${DB_FILE}.incoming`;
  rmSync(incoming, { force: true });
  let read = 0;
  const partFiles = manifest.parts.map((p) => join(downloads, p.name));
  const chunks = (async function* () {
    for (const path of partFiles) {
      for await (const chunk of createReadStream(path, { highWaterMark: 8 << 20 })) {
        read += (chunk as Buffer).byteLength;
        progress("Unpacking the library…", read, compressed);
        yield new Uint8Array(chunk as Buffer);
      }
    }
  })();
  const compressedStream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await chunks.next();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
  });
  const unzstd = new DecompressionStream("zstd" as CompressionFormat) as unknown as TransformStream<Uint8Array, Uint8Array>;
  const hasher = new Bun.CryptoHasher("sha256");
  const out = createWriteStream(incoming);
  let written = 0;
  for await (const chunk of compressedStream.pipeThrough(unzstd) as unknown as AsyncIterable<Uint8Array>) {
    hasher.update(chunk);
    written += chunk.byteLength;
    if (!out.write(chunk)) await once(out, "drain");
  }
  out.end();
  await once(out, "finish");
  process.stdout.write("\n");
  if (written !== manifest.database.size || hasher.digest("hex") !== manifest.database.sha256) {
    rmSync(incoming, { force: true });
    throw new Error("the unpacked library did not match its checksum; start the app again to retry");
  }
  renameSync(incoming, DB_FILE);
  rmSync(downloads, { recursive: true, force: true });
  writeFileSync(MARKER, manifest.version);
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

if (!existsSync(DB_FILE)) {
  say("First run: setting up the library. This happens once.");
  say("The library is downloaded (about 3 GB) and unpacked onto this computer (7 GB).");
  say("If the download is interrupted, start the app again and it carries on where it stopped.");
  say();
  try {
    await installLibrary(process.env.UWL_LIBRARY_URL || DEFAULT_LIBRARY_URL);
  } catch (err) {
    await fatal("the library could not be installed.", err);
  }
  say("  The library is installed.");
} else {
  const installed = existsSync(MARKER) ? readFileSync(MARKER, "utf8").trim() : "";
  if (installed && installed !== VERSION) {
    say(`Your library is from version ${installed}; this app is version ${VERSION}. Keeping your existing library.`);
  }
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

say();
if (port) {
  const url = `http://127.0.0.1:${port}/`;
  say(`The library is open at ${url}`);
  openBrowser(url);
} else {
  say("The library is open at the address shown above.");
}
say("Leave this window open while you read. Close it to stop the library.");
