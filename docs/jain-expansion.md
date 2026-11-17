# The Jainism shelf: Jacobi's Jaina Sutras

**Universal Wisdom Library** — 2 November 2026

Jainism had a shelf, a tradition page and two passages of the Acaranga. It was the
last of the great scriptural traditions here held as a placeholder: the canon's
English is Jacobi's, and Jacobi's English was, until now, only a sample.

The obstacle was the text rather than the rights. Hermann Jacobi's *Jaina Sutras*
(Sacred Books of the East, volumes 22 and 45, 1884 and 1895) is public domain
everywhere, but its digital witnesses are awkward: Wikisource has transcribed
only the first lecture of the Acaranga, Project Gutenberg has none of the four
works, and the Internet Archive's witnesses are raw OCR with running heads and
footnotes woven through the lines.

The Internet Sacred Text Archive has all four, transcribed from the printed
volumes. Its older static pages are gone; the current site serves each printed
chapter as a reading view backed by one JSON document. The shelf is built from
those views: the catalogue record, the chapter outline and the passage index live
here, and the reader asks the archive for the views a chapter needs.

The four works are now complete: **94 chapters, 4,324 passages, 153,986 words**.

## 1. What was added

| Work | Translator | Chapters | Passages | Words |
| --- | --- | ---: | ---: | ---: |
| *Ācārāṅga Sūtra* | Hermann Jacobi (1884) | 24 | 1,063 | 47,275 |
| *Kalpa Sūtra* | Hermann Jacobi (1884) | 11 | 414 | 20,736 |
| *Uttarādhyayana Sūtra* | Hermann Jacobi (1895) | 36 | 1,764 | 44,103 |
| *Sūtrakṛtāṅga* | Hermann Jacobi (1895) | 23 | 1,083 | 41,872 |

The first two are the whole of SBE 22 after Jacobi's introduction; the last two
are the whole of SBE 45. The library seeds **2,690 works, 3,606 editions and
4,727,610 passages**, and the four works join the acquisition register as
imported targets with the source lead and the rights note.

**Ācārāṅga Sūtra**, the first Aṅga, in two books: eight lectures on the mendicant's
discipline and the harm the passions do, and sixteen on begging for food, drink,
clothes and a couch, on the postures of the ascetic and on conduct. Its opening
lecture, *Knowledge of the Weapon*, is the classical statement of ahiṃsā as a
daily discipline. The seven lectures of the second book that the printed
contents leave untitled are labelled by number here rather than given a title
they do not have.

**Kalpa Sūtra**, the Śvetāmbara handbook of the Jinas' lives and the rainy-season
rule, in eleven chapters: five lectures on the life of Mahāvīra, then the lives
of Pārśva, Ariṣṭanemi and Ṛṣabha, the epochs of the intermediate Tīrthaṅkaras,
the list of the patriarchs, and the rules for the mendicants' annual confession.
It sits outside the twelve Aṅgas and is read aloud at Paryuṣaṇa.

**Uttarādhyayana Sūtra**, thirty-six lectures in verse, the tradition's didactic
primer: discipline, the hardships of the ascetic life, the four requisites,
death, the false ascetic, the parable of the ram, the pravrajyā of King Nami, the
leaf of the tree, the very learned monk, the ten conditions of chastity, karman,
the leśyās and the road of penance.

**Sūtrakṛtāṅga**, the second Aṅga, in two books: sixteen lectures of doctrine and
disputation against the Kriyāvādins, Akriyāvādins, Ajñānikas and Vinayavādins,
and seven on activity, food, the renunciation of activity, freedom from error and
the debates at Nālandā.

## 2. Cleaning the scan

The archive's transcription is faithful to the printed page, which means it
carries the page. Before a view is indexed or shown, `sacredTextsPage` in
`server/stream.ts` performs one pass:

- **Printed page numbers are removed.** They stand in the text where the page
  turned (`p. 179`), and a turn that prints two — `p. 216 p. 217` — is read as two
  numbers. 696 were dropped across the shelf.
- **The blanks around them are dropped.** A page turn arrives as a run of
  paragraphs holding a single space; they are not paragraphs of the text.
- **The paragraphs the turn cut in two are rejoined.** A paragraph that ends
  without punctuation, followed by a page number and a line that continues in
  lower case, is one paragraph, not two; a word hyphenated over the turn loses
  the hyphen. 405 paragraphs were rejoined.
- **The printer's rules are dropped.** A line of underscores closing a lecture is
  a mark of the page, not a sentence.
- **Footnote markers go with the notes.** The archive marks each note with a link
  in the text — sometimes to the volume's note list, sometimes across to another
  view. Jacobi's notes are the volume's apparatus and are not carried; their
  markers are removed, and so is the space they leave before a comma.

What is **kept** is what the reader of the printed page sees: Jacobi's verse
numbers in parentheses, his square brackets around supplied words, and the
italic marks of his transliteration system (the *g* of *Gaina*, the *ś* of
*leśyā*), which change the words they belong to.

## 3. How the chapters were built

Chapters follow the volumes' own tables of contents, and the contents page
supplies the titles and their order; a lecture printed across several reading
views is one chapter whose address is the list of views that carry it.

- The Acaranga's 24 lectures are read from 78 lesson views; the Sūtrakṛtāṅga's 23
  from 33 chapter views.
- The Uttarādhyayana is one view per lecture, 36 of them.
- The Kalpa Sūtra is one chapter per view — the life of Mahāvīra runs to five —
  11 in all.

Two things in the archive's own pages had to be worked around:

1. **A view is filed two lectures late.** `book-ii-lecture-5-lesson-2-2` holds the
   Acaranga's sixth lecture, second lesson, and sits after that lecture's first
   lesson in the reading order. Chapters are therefore grouped by the headings the
   pages themselves print (`SIXTH LECTURE.`, `SECOND LESSON.`), not by the
   address the archive gave them.
2. **The contents page links pages, not chapters.** Its links point at the printed
   page a chapter opens on, which for the Uttarādhyayana and the Sūtrakṛtāṅga is
   often inside the previous chapter's view. The numbers printed beside each row
   are matched to the headings instead.

The site also refuses a client that is not a browser, and Bun's own TLS stack is
refused whatever headers it carries while curl's is not. The reading views are
therefore fetched through curl (`fetchTextWithCurl`), with a fall-back to the
ordinary client so a machine without curl reports the host's answer rather than
only curl's absence.

## 4. Verification performed

- `bunx tsc --noEmit` — clean.
- `bun test` — **197 pass, 0 fail**, including the new `tests/jain.test.ts`, which checks
  the cleaning rules (page numbers, double numbers, rejoined paragraphs,
  hyphens, footnote markers, rules, and that two paragraphs without a page turn
  stay apart), the ordinal headings and contents parsing, and the shelf's
  structure: 24/11/36/23 chapters, the two books of the Acaranga, the five
  lectures of Mahāvīra, the thirty-six lectures of the Uttarādhyayana in order,
  and — for every chapter — that the indexed passages are exactly the reviewed
  segments, that none of them carries a page number, a rule or markup, and that
  every view the reader will ask for was read at import time.
- `bun run scripts/dev/import-jain.ts` — 158 reading views, 696 printed page
  numbers dropped, 405 paragraphs rejoined; four works written.
- `bun run scripts/seed.ts --reset` — seeds 2,690 works, 3,606 editions and
  4,727,610 passages; all four works carry their stream, edition and passage
  records, and the library lists them under Jainism.
- `bun run scripts/dev/index-streams.ts` — the search index is rebuilt after the
  reseed: 491 works and 935,139 passages over twelve providers, the Jain shelf
  among them (4 works, 4,324 passages) indexed from the reviewed cache rather
  than a second crawl. One Wikisource work (`ibn-arabi-tarjuman-al-ashwaq`)
  failed on a chapter its host answered empty; it is unrelated to this shelf and
  retries fail on a different chapter each time.
- Read paths verified in the running app, each reporting the text as aligned
  with the index: Acaranga I.1 (29 paragraphs), I.5 (28), II.1 (137), Kalpa 1
  (7), Uttarādhyayana 1 (49) and Sūtrakṛtāṅga I.1 (91).
- Search verified through the app: a quoted phrase from the Sūtrakṛtāṅga returns
  its passages from the streamed index (`sutrakritanga` I.1.1 among them).

## 5. Known gaps

1. **No Prakrit.** All four works are the English alone. A facing text would need
   a transcribed edition of the Ardhamāgadhī, which neither Wikisource nor the
   archive carries for these volumes.
2. **Jacobi's notes are not carried.** His philological notes are extensive and
   often the only gloss on a hard word; the edition record says so, and the
   archive holds them on the page.
3. **The archive's typos are as printed.** Its transcription preserves the
   volume's own errors, and a few of Jacobi's transliterations are split by the
   italic markup. They have not been silently corrected.
4. **The Kalpa Sūtra's patriarch list is long.** The *List of the Sthaviras* (176
   paragraphs) dominates that work's passage count; it is a list of names and
   reigns, not doctrine.

## 6. Files

- `scripts/dev/import-jain.ts` — the importer (`bun run import:jain`), with
  `--report`, `--only=<slug>` and `--force`.
- `server/stream.ts` — `sacredTextsPage`, `svelteKitData`, `fetchTextWithCurl`
  and the `sacred-texts-json` provider.
- `scripts/dev/index-streams.ts` — the new provider is indexed from its import
  cache, like the older hosted shelves, and its views are fetched with a gap and
  a retry so a long lecture is not truncated by the archive's rate limit.
- `tests/jain.test.ts` — the shelf's checks.
- `data/corpus/works/{acaranga-sutra,kalpa-sutra,uttaradhyayana-sutra,sutrakritanga}.json`
- `data/imports/cache/sacred-texts-json/` — one summary per work for the search
  index, and the reading views under `views/` as they arrived.
- `data/registry/streams.json`, `data/corpus/text-functions.json`,
  `data/registry/acquisition.json`, `data/corpus/meta.json`.
