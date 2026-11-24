# Project journal

A running log of work on the Universal Wisdom Library, newest session first.

**Rule for every session:** read this file at the start (a SessionStart hook in
`.claude/settings.json` prints it), and add an entry at the end, before the
session's work is called done. A session isn't complete until its entry is
written. Each entry covers what was done, what was decided, what is still open,
and where things stand (commits, branch, anything not pushed or not verified).

---

## 2026-11-24: release check

**Done**
- Checked `Archaejon/universal-wisdom-library` for releases: none, not even
  drafts, and no git tags locally or on GitHub. `package.json` is at 0.1.0.

**Open / next**
- If a release is wanted: tag `v0.1.0` on `main` and publish a GitHub release.
  The app needs `data/uwl.db` (9.4 GB, not in git) or a `db:rebuild` from the
  corpus, so release notes should say how to build the database.

**Git:** this entry only; committed and pushed with it.

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
