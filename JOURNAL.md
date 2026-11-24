# Project journal

A running log of work on the Universal Wisdom Library, newest session first.

**Rule for every session:** read this file at the start (a SessionStart hook in
`.claude/settings.json` prints it), and add an entry at the end, before the
session's work is called done. A session isn't complete until its entry is
written. Each entry covers what was done, what was decided, what is still open,
and where things stand (commits, branch, anything not pushed or not verified).

---

## 2026-11-25 (evening): commentaries by verse, step 2

**Done**
- **Server** (`server/commentary.ts`, route `GET /api/commentaries/:slug?ref=`,
  plus `&id=` to read one). For one passage it lists every commentary keyed
  to it, and reads one on request:
  - **Sefaria links** for any Sefaria-served work addressed by chapter and
    verse (Tanakh, Mishnah, Talmud, and so on), and for the Christian Bible's
    Old Testament books (Bolls) through their Hebrew Bible names. The panel
    notes that verse numbers can differ there. Links are grouped by work and
    category; commentaries on this very book come first, classics in
    Sefaria's order (Rashi, Ramban, Ibn Ezra …), then by date. One read of
    "Rashi on Genesis 1:1" returns all of Rashi's comments on the verse,
    English and Hebrew, with Sefaria's version title and licence. Inline
    footnotes are stripped.
  - **Barnes' Notes** for every New Testament book (Bolls and the sample
    gospels). An index is built once in memory from Barnes' own markers
    ("… - Chapter 3 - Verse 16", 7,947 of them); a book's unmarked verse 1
    takes the paragraphs that open the section; "Remarks on chapter …"
    sections are not filed under a verse.
  - **Tafsir**: al-Tabari, al-Qurtubi and Ibn Kathir for any Qur'an ayah,
    oldest first, read through the existing Quran.com stream (held in
    memory, never written to disk).
  - The library's own `commentaries` table stays with the passage response.
- **Client** (`client/commentaries.tsx`): a Commentaries section at the top
  of the study panel (verse number → panel) and on the passage page.
  Category chips (six shown, the rest under "More…"), ten works per category
  with "Show all", the first one opened, the original under the translation
  with a switch, edition, licence, source link and "Open in the library".
  The library's own notes are now "Library notes" in the panel, shown only
  when there are any.
- `&thinsp;` and other spacing entities are now decoded (the Genesis 1:5
  note from step 1). `fetchJson` is exported from `server/stream.ts`.
- Fixed in passing: panel content could push the panel wider than its
  column (grid items now `minmax(0, 1fr)`; panel `overflow-x: hidden`).
- Tests: `tests/commentary.test.ts` (Barnes headings and index, footnote
  stripping, entity decoding, ordering). 207 pass; tsc clean. Checked in
  the browser: Genesis 1:1 (Rashi, Bereshit Rabbah), Berakhot 2a:1 on the
  passage page, John 3:16 and Matthew 1:1 and 5:3 (Barnes), Qur'an 2:5
  (tafsir), phone size; no console errors.

**Decided**
- The list arrives first and a commentary's text is read only when opened,
  as Sefaria's own sidebar does; Genesis 1:1 alone has 349 linked works.
- No per-verse counts in the reader rows yet: that needs Sefaria's
  chapter-level links (thousands per chapter). The verse number opens it.

**Open**
- Other verse-keyed commentaries on the shelf (Calvin, the Expositor's Bible,
  Catena Aurea) are chapter- or section-shaped and are not indexed yet.
- Sefaria commentaries that are themselves on the shelf could open in the
  library rather than at Sefaria.
- Everything from earlier entries (installer tests on real machines, code
  signing, library update path, CLAUDE.md "private" note, git email).

**State**: committed and pushed to `origin/main` with this entry. Not in a
release yet (the app is still 0.2.1).

---

## 2026-11-25 (later): the Sefaria Lens layout, step 1

**Done**
- **Shell** (`client/shell.tsx`): a left sidebar replaces the top bar and the
  footer. It holds the wordmark, search (`/` focuses it), Reader (continues
  the latest text), Library, Search, Themes, Compare, Study assistant and My
  study. Below those come **Recently opened** (`client/recent.ts`, live from
  localStorage), a "Sources, provenance and more" group, light/dark mode,
  account and a rights line. On the right is a **study panel** any page opens
  with `useStudyPanel()`; it closes on navigation or Esc. Below 1280px the
  panel floats over the page; below 1000px the sidebar is a drawer behind a
  top bar and the panel covers the screen.
- **Reader** (`client/pages/ReaderPage.tsx`, rewritten around the same data):
  - **The bar:** a sticky reader bar with previous/next, a "Go to…"
    reference box, the chapter select, A−/A+ and the type settings, plus
    tools (About, Share; Bookmark and Compare on a passage). A second row
    holds the **Original / Translation layer switches** (at least one stays
    on; the old "text shown" choice is migrated), a Translation select where
    a chapter has several, **Text: 10/25/50/100/All** with "Show N more",
    and Rows/Continuous.
  - **Breadcrumb:** it goes up the shelf (Library › tradition › category ›
    work › chapter). The work link opens the library board on its chapter
    grid.
  - **Chapter rows:** the chapter is **aligned rows**, translation left and
    original right, each column naming its edition, source and licence once;
    a row from another edition says so.
  - **Study panel:** clicking a verse number opens it there, with its
    editions, commentary and connections.
  - **Single passage:** the passage view uses the same bar; its edition
    boxes are lighter columns. Notes, commentary, connections, collections
    and citation are unchanged. The old left "Contents" column is gone (the
    bar's chapter select and prev/next replace it).
- **Server** (`server/reader.ts`): the work header includes `category` and
  `subcategory`; a chapter lists the editions it offers (`versions`) and
  honours `?version=` for the translation or original side.
- **Library:** chapter buttons show the number when the label only repeats it
  ("Genesis 1" → "1").
- Checked in the browser (dev server on 4180, `.claude/launch.json`):
  - Hebrew Genesis with the study panel, layer switches, dark mode and phone
    size (the drawer, stacked rows, the full-screen panel, and a bar that
    scrolls away).
  - The single-passage view; al-Tabari (Arabic only); the Meditations
    (English only); the Christian Bible's Genesis (KJV + WLC).
  - The breadcrumb to the library board. No console errors.
- Tests 200/200, typecheck clean.

**Noticed (not fixed)**
- Sefaria's Hebrew for Genesis 1:5 contains a literal `&thinsp;` (HTML
  entities in streamed text are not decoded). Older than this change.

**Open / next**
- Step 2 of `docs/sefaria-lens-ideas.md`: verse-by-verse commentaries in the
  study panel (Sefaria links first).

**Git:** committed and pushed with this entry.

---

## 2026-11-25: what to take from Sefaria Lens

**Context:** the project now lives at `/mnt/storage/Projects/Universal Wisdom
Library` (it was `Project 3`). The user pointed at their other project, Sefaria
Lens (`/mnt/storage/Projects/Sefaria Lens`, MIT, Electron + plain JS), said
they prefer its layout, and asked which features could be brought over.

**Done (review only; no app code changed)**
- Read its README, module headers and screenshots, and compared them with this
  app's pages and screenshots. Wrote `docs/sefaria-lens-ideas.md`: what is
  already here (the column library board, streamed answers with Stop, parallel
  editions as two cards), the layout differences (left sidebar with Recently
  opened, right study panel, a reader of aligned verse rows with layer switches
  and a segment-count control), eight features with how each generalises
  across traditions, what not to bring over, and a suggested order with rough
  sizes.

**Decided:** nothing yet; the order is a proposal.

**Open / next**
- The suggested first step is the layout: sidebar shell, study panel, reader as
  aligned rows. Then verse-by-verse commentaries (Sefaria links, own tables,
  tafsir, Barnes), the selection toolbar with Ask-with-context and tiered
  sources from text functions, Hebrew word study and transliteration ported
  from Lens, then local-model hardening and on-demand AI translation.
- The `CLAUDE.md` remote note still says the repo is private; it is public.

**Git:** this entry and `docs/sefaria-lens-ideas.md` committed and pushed.

---

## 2026-11-24 (evening): installers and instant feedback, v0.2.1

**What prompted it:** the user ran the v0.2.0 Linux app from the file manager
and saw nothing. It was working, but with no terminal its progress was
invisible, and a double-click had started **two copies** writing the same
download file (one restarted it under the other). With the user's OK both
were stopped and one restarted in a terminal tab; it resumed, verified and
installed their library (`~/.local/share/universal-wisdom-library`, 0.2.0,
2,772 works). The user asked for an installer and a visible response.
The user's PC then crashed mid-session; nothing was lost (uncommitted work
intact, both databases passed `PRAGMA quick_check`).

**Done**
- `3c37c35`: the app opens the browser at once; the first run shows a setup
  page (`scripts/app-setup-page.ts`) with live progress and a Try again button,
  then hands the same address to the library. One copy per library folder
  (`app.lock` taken exclusively, `app.json` holds the address; later launches
  reopen the browser and exit). It stops after 5 min with no reader
  (`UWL_IDLE_EXIT_MINUTES`; the client checks in each minute on 127.0.0.1
  only). On Linux the first run adds a menu entry. App icon (an open book)
  drawn by `scripts/make-icons.ts` into PNG, ICO and ICNS with no image tools.
- `0bd766e`: Windows setup program (`installer/windows.iss`, Inno Setup,
  per-user, Start menu and desktop shortcuts, asks before deleting the 7 GB
  library on uninstall), built on a Windows runner so the .exe has its icon
  and no console. macOS `.app` (LSUIElement, icon) in a `.dmg`. `build:app`
  now uses the bun CLI (the Windows options are only there) and writes the
  client-embedding module for the duration of the build. Version 0.2.1.
- Tested on Linux with a scratch library folder and a fake release host: two
  simultaneous launches gave one running copy, and launches during setup and
  while open handed over. Setup progressed through download, unpack and ready,
  then the library served pages and search. The menu entry was written, idle
  shutdown worked, and the lock was removed. All five targets build locally.
  Tests 200/200, typecheck clean, CI green.
- Tagged and released **v0.2.1**: every job passed (Windows setup built with
  Inno Setup on the Windows runner, both macOS `.dmg`s, Linux archives,
  library). Published as latest with 8 files:
  https://github.com/Archaejon/universal-wisdom-library/releases/tag/v0.2.1
  Checked the published files: the setup program is a Windows GUI installer
  named "Universal Wisdom Library Setup", the Linux archive holds the program
  and its note, and the library manifest is 0.2.1.

**Noticed**
- The handover took 57 s after "ready" on this machine's slow drive (opening
  a 7 GB file just written). Later starts take about 1 s.

**Open / next**
- The Windows setup program and macOS .dmg are only built on CI, not yet
  installed and run on a real Windows PC or Mac.
- The user's installed copy is the 0.2.0 program; the 0.2.1 program reuses
  their existing library folder (no new download).
- Still open from earlier: code signing, a library update path, the streamed
  search index in the app, the unexplained wipe of the dev DB, Node 20
  warnings from the artifact actions.

**Git:** `3c37c35`, `0bd766e` and this journal entry pushed; tag `v0.2.1` pushed.

---

## 2026-11-24 (afternoon): downloadable desktop app, smaller database, v0.2.0

**Done**
- **Repo visibility:** the user believed it was public; it already was (they
  changed it after creation). The corpus in git includes the full Guru Granth
  Sahib (Gurbani-CD Gurmukhi + Sant Singh Khalsa English), held under written
  permission that says "do not redistribute". Raised it; **the user chose to
  leave git as it is.** The downloadable library leaves the work out.
- **Desktop app** (`scripts/app.ts`, `build:app`): a single executable per
  platform (Windows x64, macOS arm64/x64, Linux x64/arm64) with the web client
  embedded. It keeps the library in a per-user folder, downloads it on the
  first run, serves on 127.0.0.1 and opens the browser. For this, the schema
  is imported as text (`server/sql.d.ts`), `ROOT` honours `UWL_HOME`, and the
  server takes its client folder from `UWL_PUBLIC_DIR`.
- **First-run approach:** building the database from the corpus took 17.6 min
  here and peaked at 17 GB of disk, too much for a reader's first launch. The
  user chose: shrink the database first, then ship a ready-made one.
- **Shrink** (`dab9258`): `passage_fts` and `passage_trigram` are now
  contentless FTS5 (`content=''`, `contentless_delete`, `contentless_unindexed`),
  so the text is no longer stored twice: 9.0 GB down to 7.0 GB. A strict
  before/after comparison of 20 searches (keyword, phrase, concept, Greek,
  CJK, substring, filtered, paged) gave identical results. `migrate()` rebuilds
  an old-layout index once (about 21 min on the full library), and
  `db:compact` (VACUUM) reclaims the space.
- **Ready-made library** (`497027e`): `build:library` stages the corpus
  (withholding by-permission-only works: just `guru-granth-sahib`, plus its
  text-function entry and 2 collection items), seeds with `UWL_BULK_LOAD=1`
  (no journal; 9.5 min), compresses with zstd -12 (3.0 GB) and splits into
  parts under 1.9 GB with a SHA-256 manifest. The app checks free disk,
  downloads the parts with HTTP range resume and 5 retries, verifies each
  part and the unpacked database, then cleans up.
- **Tested end to end** on Linux against a fake release host: started from a
  half-downloaded part 1, resumed it with a range request, installed in 129 s,
  served pages, the API and search (including CJK), and started again in 1 s.
  All five platforms compile and package locally. Fixed along the way:
  `Bun.write(file.slice())` copied the whole file instead of a range (the split
  now streams explicit ranges and checks the total), and the compiled app
  reported "development" (NODE_ENV is now set at build time).
- **CI** (`.github/workflows/ci.yml`): typecheck and tests on main and PRs.
  First run failed, and fixing it found a real problem: the Ollama tests wrote
  to the real `data/uwl.db`. Tests now get a throwaway database from
  `tests/setup.ts` (bunfig preload); the import manifests in `data/imports`
  (7 MB) are now tracked; two cache-comparison tests skip without the cache.
  CI is green.
- **Release workflow** (`.github/workflows/release.yml`): on a `v*` tag, builds
  the apps (macOS on a Mac runner for ad-hoc signing), builds the library
  (frees runner disk first), creates the release from
  `.github/release-notes.md` and uploads everything.
- **Local database:** `data/uwl.db` had been emptied before this session
  (every table empty, 10 GB of free pages). The cause is unknown; it wasn't
  the tests (they never reset). The 19 Nov backup was intact (2,690 works, no
  user data). With the user's OK it was replaced by a fresh build from today's
  corpus, then converted and compacted: 7.06 GB, 2,773 works. It has **no
  streamed-text search index**; `bun run index:streams` builds that by
  fetching from every host.
- Tagged and pushed **v0.2.0** (`497027e`). The release workflow passed: apps
  built in under a minute (macOS on a Mac runner), the library built on the
  runner in 14 min, and the release was published with 8 files (5 apps,
  2 library parts of 1.90 GB and 1.09 GB, the manifest):
  https://github.com/Archaejon/universal-wisdom-library/releases/tag/v0.2.0
- **Verified the published release** from a clean folder: downloaded the Linux
  app from GitHub, ran it with an empty library folder; it fetched, verified
  and unpacked the 3 GB library from the release in 198 s, then served pages,
  the API and search (including 道). Windows and macOS builds compile and
  package but have not been run on those systems.

**Open / next**
- Not yet run on real Windows or Mac machines (only built). Worth a test by
  someone on each before telling non-technical readers about it.
- The upload/download-artifact actions (v5) still warn that they run on
  Node 20; move them to the next major versions when those are confirmed.
- The app's library has no streamed-text search index (Arabic, Hebrew and
  other streamed shelves can be read but aren't searchable offline). Options:
  build `index:streams` into the release DB, or ship it separately.
- Code signing: Windows SmartScreen and macOS Gatekeeper warnings remain
  (needs a paid Apple developer account and a Windows certificate).
- An app update doesn't update an installed library (it keeps the old one);
  a library update path is needed before the next corpus change.
- Unexplained wipe of the local DB: worth finding what calls `resetDb()` or
  `db:rebuild` before it happens again; README says a rebuild deletes users,
  notes and so on.
- Still open from earlier: the git email, the corpus growth in git, the
  9.4 GB backup on the same disk, collection gaps, splitting `stream.ts`.

**Git:** `dab9258`, `497027e` and earlier commits pushed; tag `v0.2.0` pushed.

---

## 2026-11-24: options for non-technical users

**Done (investigation only; no code changed)**
- Tried `bun build --compile scripts/start.ts`: it builds a single 110 MB
  Linux executable in under a second, but it fails at startup because
  `server/db.ts` reads `schema.sql` from `import.meta.dir`, which is a virtual
  path inside a compiled binary. `scripts/serve.ts` serves `public/` the same
  way, so the client files would be missing too. Both can be fixed by embedding
  the files (a text import for the schema, embedded assets for the client). The
  trial binary was deleted.

**Findings**
- The repo is private, so nobody else can download the release at all. Any
  public download means making the repo public or hosting files elsewhere.
- A GitHub release file can be at most 2 GB, and the database is 9.4 GB. A
  desktop download would have to ship the corpus (about 400 MB compressed) and
  build the database on first run, or ship a much smaller database.
- Unsigned downloads trigger Windows SmartScreen and macOS Gatekeeper warnings.
  Signing costs money (Apple developer account).

**Recommended to the user:** host it as a website (one URL, nothing to
install). A desktop download is second choice: compiled executables per OS plus
a first-run data download. No decision yet.

**Git:** this entry committed and pushed.

---

## 2026-11-24: first release, v0.1.0

**Done**
- Checked `Archaejon/universal-wisdom-library` for releases: there were none,
  and no tags.
- Released v0.1.0. Before tagging, 200/200 tests passed, the typecheck was
  clean, and all 2,773 corpus files were tracked. Annotated tag `v0.1.0` on
  `0549319` (main), pushed. Published "Universal Wisdom Library 0.1.0" as the
  latest release (via Composio):
  https://github.com/Archaejon/universal-wisdom-library/releases/tag/v0.1.0
- The release notes cover what's in the library, the latest additions (fiqh,
  Greek/Latin), and how to run it. They say plainly that the 9.4 GB database is
  not included and is built with `bun run db:rebuild`. No assets attached.

**Decided**
- Version stays as `package.json` already had it (0.1.0); no version bump.

**Open / next**
- The next release needs a `package.json` version bump before tagging.
- Nothing builds a release automatically; a CI workflow (tests and typecheck on
  push, build on tag) would help. Still open from 2026-11-23.

**Git:** tag `v0.1.0` pushed; this journal entry committed and pushed on `main`
after the tag (so the tag doesn't include it).

---

## 2026-11-23: audit, GitHub repo, data under version control

**Done**
- Audited the project. Typecheck clean; 199 of 200 tests passed. The failure
  was `tests/acquisition.test.ts` ("every lead names a source and an HTTPS
  address"): four `rights_blocked` targets in `data/registry/acquisition.json`
  had no `source_leads`.
- Fixed it by giving each of the four a lead naming the rights holder to ask:
  `rastafari-community-texts` (Mansions of Rastafari),
  `gardnerian-book-of-shadows` (Doreen Valiente Foundation),
  `seimei-no-jisso` (Seicho-no-Ie), `world-messianity-teachings` (Church of
  World Messianity, via Wikipedia because the church sites didn't resolve from
  here). Each note says it is a permission contact, not a text source.
  200/200 tests pass.
- Committed the two 19 November passes that had been sitting uncommitted:
  `8255339` fiqh and usul al-fiqh (32 OpenITI works) and `2ce0c22` Greek and
  Latin originals (51 works, `ingest/tei.ts`, `import:ogl`).
- Created the private GitHub repo `Archaejon/universal-wisdom-library` (via the
  Composio GitHub connection) and pushed `main`.
- Push access: a dedicated key `~/.ssh/uwl_github_ed25519` (no passphrase),
  registered as a write-access deploy key on that one repo only. The repo's
  git config sets `core.sshCommand` to use it.
- Put `data/corpus` (2,773 work files, about 1.4 GB raw, about 400 MB
  compressed) and `data/registry` under version control in plain git (`1e99ce1`).
  `.gitignore` now ignores `data/*` except those two; the database, its backups
  and the import caches stay out. No file is over 25 MB, so no LFS is needed.
  README notes what is tracked. Pushed to GitHub (`2ce0c22..1e99ce1`).
- Set up this journal, `CLAUDE.md` pointing at it, and the SessionStart hook.

**Open / next**
- Local git email is `georgegershom@localhost`, so GitHub doesn't link commits
  to the profile. Set `git config user.email` to the GitHub address.
- Every `export:corpus` or importer run rewrites corpus files, and git keeps
  each version, so the repo will grow. Consider Git LFS or a separate data repo
  if it gets heavy.
- Disk: `data/uwl.db-wal` is 1.6 GB (checkpoint it) and the 9.4 GB backup in
  `data/backups` is on the same disk.
- Collection: repair Irenaeus and the Latin *Passio Perpetuae* (`located`);
  import the `wanted` public-domain texts (Woolman, Barclay, Channing, 1830 Book
  of Mormon, 1835 Doctrine and Covenants, Holy Piby, Barddas); permission
  requests for the `rights_blocked` ones.
- Code: split `server/stream.ts` (3,080 lines) by source host; add CI
  (typecheck and tests); tidy `scripts/dev/_probe.ts` and `_register.ts`.
