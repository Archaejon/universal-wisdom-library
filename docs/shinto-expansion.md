# The Shinto shelf: the Kojiki and the Nihongi

**Universal Wisdom Library** — 1 November 2026

Shinto was catalogued here and read nowhere. The tradition had a description, a
permissions note naming Chamberlain's 1882 translation, and a single catalogue
record whose two sampled passages were the only text in the shelf. Both of
Japan's foundational chronicles are public domain in English translation, and
both are transcribed in full on Wikisource, one printed division per page. They
are now **streamed works**: the catalogue record, chapter outline and passage
index live in the library, and the reader fetches the page for a chapter from
Wikisource when someone opens it.

Nothing is copied into the corpus. The reviewed pages are cached under
`data/imports/cache/wikisource-shinto/`, one file per page, and that cache is
what the search index is built from; it refuses to index a chapter whose cached
segments no longer line up with the passage index.

## 1. What was added

| Work | Translator | Chapters | Passages | Words |
| --- | --- | ---: | ---: | ---: |
| *Kojiki: Records of Ancient Matters* (1882) | Basil Hall Chamberlain | 180 | 415 | 45,152 |
| *Nihongi: Chronicles of Japan from the Earliest Times* (1896) | William George Aston | 30 | 4,809 | 241,942 |

The shelf adds **two works, 210 chapters, 5,224 passages and 287,094 words**, and
Shinto goes from one catalogue record with two sampled passages to a shelf that
can be read from the beginning of heaven and earth to the death of Empress
Suiko.

The chapter divisions are the printed ones. The Kojiki is transcribed on
Wikisource section by section, so each of Chamberlain's 180 numbered sections is
a chapter, titled from the heading printed on the page: *Section I — The
Beginning of Heaven and Earth*, *Section XII — The Crying and Weeping of His
Impetuous-Male-Augustness*, *Section CLXXX — Empress Sui-ko*. The Nihongi is
transcribed book by book, so each of Aston's thirty books is a chapter. Three
Kojiki pages open with a volume marker (*Vol. II.*, *Vol. III.*) and four print
their heading without the opening bracket; both are handled, so no chapter falls
back to a bare number.

Every chapter is addressed by its position in the stream config, and every
passage by `chapter.paragraph`: `44.3` is the third paragraph of Kojiki section
XLIV, `14.191` the last paragraph of Nihongi book XIV. A page that moves in the
Wikisource transcription would show up as a mismatch between the cached
segments and the index, not as silently wrong references.

## 2. How the text is served

The `wikisource` provider fetches one page through the MediaWiki API and runs
the same segmenter the import used, so the served text and the passage index
cannot drift apart. The import and the reader both drop the printed heading (and
the volume marker where there is one), which is why a chapter opens on its text
rather than repeating its own title; the pattern travels with the work in
`streams.json`. Where the text is short of the indexed count, the reader says so
rather than renumbering.

The shelf carries Chamberlain's first complete English Kojiki, romanised in his
system and set in his archaic register, with his brackets and footnotes as
printed, and Aston's Nihongi for the Japan Society, the translation that carried
the chronicle's variant traditions ("in one writing it is said") into English.
Both editions are public domain in the United States. Wikisource's editorial
contributions are CC BY-SA, and the edition record says so.

## 3. Verification performed

- `bun run scripts/dev/import-shinto.ts` — 180 Kojiki pages and 30 Nihongi pages
  fetched and reviewed; 180 chapters / 415 passages and 30 chapters / 4,809
  passages written.
- `bunx tsc --noEmit` — clean.
- `bun test` — **176 tests pass**, including the new `tests/shinto.test.ts`,
  which checks that every chapter's cached segments and indexed passages agree
  one for one, that the page refs in the stream config match the chapter refs,
  and that the Kojiki runs from Section I to Section CLXXX and the Nihongi from
  Book I to Book XXX.
- `bun run scripts/seed.ts --reset` — seeds **2,687 works, 3,603 editions and
  4,723,288 passages**. The Shinto shelf contributes two works and 5,224 indexed
  passages. The seed reports 25,958 warnings, of which 25,940 are the
  pre-existing `reference_scheme` warnings raised on other shelves by references
  that carry a `#2` duplicate suffix; neither Shinto work raises one.
- `bun run scripts/dev/index-streams.ts --only=kojiki` and the same command
  with `--only=nihongi` — the streamed search index is built from the cached
  pages: 415 passages / 45,152 words and 4,809 passages / 241,942 words. A
  full index run afterwards holds **488 streamed works and 932,139 passages**;
  it had to be rebuilt because the reset empties the streamed index along with
  the rest of the database.
- Read paths verified in the running app: Kojiki Section I (one paragraph,
  heading trimmed), Section XLIV (the page that opens Volume II, so both the
  volume marker and the heading are dropped) and Section CLXXX (*The End.* as
  the closing paragraph); Nihongi Book I (589 paragraphs), Book XIV (190) and
  Book XXX (426). Every response reported `aligned: true`.
- The shelf was exercised in the browser through Shinto → Chronicle → Myth and
  dynastic history, showing both works with 180 and 30 chapters; the Nihongi work
  page shows the editions, translator, source and rights record.
- Search for "Izanagi" returns Nihongi Book I §27 from the streamed index.

## 4. Known gaps

1. **Only the translations are hosted.** Neither work includes the classical
   Japanese/Chinese source text. A Kojiki or Nihongi with the original beside
   the translation would need a transcribed edition of the original, which
   Wikisource does not carry for these texts.
2. **Chamberlain's and Aston's notes are kept as printed.** They are part of the
   page the reader sees, so a note sits in the text after the paragraph it
   annotates; it is not a separate commentary shelf.
3. **The Kojiki's preface and Chamberlain's introduction are not imported**, and
   neither is Aston's introduction or his appendices. They are apparatus rather
   than the chronicles, and each would need its own chapter rule.
4. **Shinto is not a scriptural religion in the sense the shelf headings imply.**
   The Kojiki and Nihongi are court chronicles of myth and dynastic history, so
   they are classified `historical_document` and `non_canonical_religious_text`
   rather than `canonical_scripture`. The classification is a reading aid, not a
   theological judgement.

## 5. What remains after this shelf

The traditions ordered after Zoroastrianism are, in catalogue order: Jainism,
Shinto, Indigenous traditions, Greek and Roman religion, the Bahá'í Faith, and
the modern movements and new religious movements that follow them. Shinto is now
built. Jainism is the next in order and is the hardest of the remaining shelves:
its canon survives in English only in Jacobi's *Jaina Sūtras* (Sacred Books of
the East, vols. 22 and 45), and neither Wikisource nor Project Gutenberg carries
a complete transcription — the only machine-readable witnesses are scanned
volumes whose OCR still needs review before it can be presented as text.
