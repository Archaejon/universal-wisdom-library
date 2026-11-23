# Working on this project

## Session journal (required)

`JOURNAL.md` is the project's running log, newest session first.

1. **Start of every session:** read `JOURNAL.md` before doing anything else.
   A SessionStart hook prints it into context; if it didn't appear, read the
   file directly.
2. **End of every session:** add a dated entry at the top of the log covering
   what was done, what was decided, what is still open, and the state of git
   (commits made, whether they are pushed). Commit the journal with the work.

A task is not complete until the journal entry is written.

## Basics

- Bun project: `bun test` runs the tests; typecheck with
  `bunx -p typescript tsc --noEmit -p .`.
- `data/corpus` and `data/registry` are tracked in git; `data/uwl.db`, its
  backups and `data/imports` are not. See README.md.
- Remote: `origin` is the private repo Archaejon/universal-wisdom-library,
  pushed over SSH with the repo's deploy key (`core.sshCommand` is set).
