# Universal Wisdom Library

A searchable, comparative library of religious and philosophical texts: a Bun
HTTP server over a SQLite corpus, with a React single-page reader in front of it.
Text is either held locally or streamed from its host (Sefaria, CCEL, Sacred
Texts, Wikisource and others) at read time; every edition records its source,
licence and attribution.

## Requirements

- [Bun](https://bun.sh) 1.2 or newer (developed against 1.4).
- Roughly 11 GB of disk: `data/uwl.db` is about 9.4 GB and `data/corpus/works`
  about 1.4 GB. Both are required.

## Run it in development

```sh
bun install
bun run dev
```

`dev` builds the client (unminified) and then serves it at
<http://127.0.0.1:4173>. On a database with no works it seeds itself from
`data/corpus/works` first, which takes a while. Logs go to stdout.

## Build and run it for production

```sh
NODE_ENV=production bun run build
bun run start
```

`build` alone produces an unminified bundle; `NODE_ENV=production` is what
minifies it. `start` sets `NODE_ENV=production` and serves the built files in
`public/` — it does not build, so run `build` first.

Tests cover the corpus, search, streaming and the API:

```sh
bun test
```

## The database and the corpus

`data/corpus/works/<slug>.json` is the **seed input**; `data/uwl.db` is what gets
built from it. The two are separate copies of the catalogue, and the files are
the source of truth for a rebuild. `data/corpus` and `data/registry` are kept
in git; the database, its backups and the import caches are not.

`bun run db:rebuild` drops every table and reloads the database from
`data/corpus/works`, then re-indexes the streamed shelves for search:

```sh
bun run db:rebuild     # scripts/seed.ts --reset && scripts/dev/index-streams.ts
bun run db:reset       # the reset + reseed half only
```

Two consequences worth knowing before you run it:

- **It deletes the database.** Users, sessions, notes, bookmarks, editorial
  queues and assistant history all live in `data/uwl.db`; a rebuild removes them.
  Copy the file somewhere first if you care about that data.
- **It is only as complete as the corpus directory.** Seeding reads whatever
  `.json` files are in `data/corpus/works`. If that directory has been pruned, or
  an export was interrupted, a rebuild would produce a smaller library — so
  `seedDatabase()` refuses to proceed when the corpus has fewer works than the
  database already holds, or no work files at all, and stops before dropping
  anything.

### Recovering a pruned corpus

If the corpus files were deleted or trimmed while the database still held the
full library, write them back out of the database:

```sh
bun run export:corpus
```

This reads `data/uwl.db` and rewrites `data/corpus/works/<slug>.json` for every
work, in the shape the seeder reads: work metadata, chapter outline, passage
index, and per-edition texts for locally held works (streamed works carry no
text). It takes several minutes and writes about 1.4 GB. Set
`UWL_CORPUS_WORKS_DIR` to write somewhere else. Once it finishes,
`db:rebuild` is safe again.

To accept a deliberately smaller corpus, override the guard explicitly:

```sh
UWL_ALLOW_CORPUS_SHRINK=1 bun run db:rebuild
```

The corpus must still be internally consistent: `data/corpus/text-functions.json`
has to classify exactly the works that are present. A subset of the work files
with the full classification file fails to seed on the orphaned entries, override
or not.

## Settings

Set these in the environment; there is no config file.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `4173` | Port to listen on. `0` makes the OS choose one, which is rarely what you want. |
| `HOST` | `127.0.0.1` | Address to bind. |
| `UWL_DB_PATH` | `data/uwl.db` | Database file, e.g. to run a throwaway copy. |
| `UWL_CORPUS_WORKS_DIR` | `data/corpus/works` | Corpus directory to seed from, and to export into. |
| `UWL_ALLOW_CORPUS_SHRINK` | unset | `1` lets `db:rebuild` replace a library with a smaller corpus. Without it, any shrink is refused. |
| `UWL_TRUST_PROXY` | unset | Which peers may set `X-Forwarded-For`. Unset means the header is ignored and rate limits key on the connection's own address. `1` (or `true`) trusts every peer; otherwise a comma-separated list of proxy addresses (`127.0.0.1,::1`). Only the last forwarded hop is read. |
| `UWL_SECURE_COOKIES` | unset | `1` adds `Secure` to the session cookie. Set it when the site is served over HTTPS, usually together with `UWL_TRUST_PROXY`. |
| `UWL_CHECK_SCHEDULE` | on | `off` disables the background source-availability checks. |

Rate limits (login, registration, corrections, the assistant) are stored in the
database and keyed by client address. Behind a reverse proxy, set
`UWL_TRUST_PROXY` to the proxy's address — otherwise every visitor appears to
come from the proxy and they share one allowance. Do **not** set it when the
server is reachable directly, or callers can forge the header and mint a fresh
allowance per request.

## Editor and admin accounts

`scripts/make-editor.ts` changes the role of an **existing** account; it does not
create one. Register first through the app — the sign-in panel has a "Create
account" tab, asking for a display name, an email and a password of at least ten
characters — then promote that address:

```sh
bun run scripts/make-editor.ts you@example.com            # editor
bun run scripts/make-editor.ts you@example.com admin      # admin
```

The role argument is `reader`, `editor` or `admin` and defaults to `editor`.
Running it for an address with no account fails with "No account found" rather
than creating one, so the password is always set through the app's own
registration. Editors can review corrections and submission queues; admin also
approves registry sources and ingestion requests.
