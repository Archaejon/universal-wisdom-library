# The Bahá’í shelf: the writings of Bahá’u’lláh and ‘Abdu’l-Bahá

**Universal Wisdom Library** — 26 October 2026

The Bahá’í Faith was catalogued here and read nowhere. The registry carried the
Reference Library, the community's own publication of the writings, but its
terms are site-level: it authorises reading on bahai.org and per-publication
downloads, not a reusable corpus licence, and no compatible edition of the
writings exists elsewhere. The tradition therefore had a description, a
permissions note and no text.

The project owner authorised access to the Reference Library on **26 October
2026**. Ten published works are now held as **streamed works**: the catalogue
record, chapter outline and passage index live in the library, and the reader
fetches the reading views a chapter needs from bahai.org at read time, with the
Community's copyright notice beside the text. Nothing is written into the local
corpus; the import caches hold the exact paragraphs that were validated, which
is what the search index is built from.

## 1. What was added

| Work | Author | Translator | Chapters | Passages | Words |
| --- | --- | --- | ---: | ---: | ---: |
| *The Hidden Words* | Bahá’u’lláh | Shoghi Effendi | 2 | 160 | 8,201 |
| *The Kitáb-i-Aqdas* | Bahá’u’lláh | Shoghi Effendi | 3 | 463 | 29,549 |
| *The Kitáb-i-Íqán: The Book of Certitude* | Bahá’u’lláh | Shoghi Effendi | 2 | 293 | 50,342 |
| *The Seven Valleys* | Bahá’u’lláh | Shoghi Effendi | 1 | 95 | 8,590 |
| *The Four Valleys* | Bahá’u’lláh | Shoghi Effendi | 1 | 49 | 3,047 |
| *Gleanings from the Writings of Bahá’u’lláh* | Bahá’u’lláh | Shoghi Effendi | 166 | 717 | 85,382 |
| *Some Answered Questions* | ‘Abdu’l-Bahá | Laura Clifford Barney, revised at the Bahá’í World Centre | 84 | 781 | 78,375 |
| *The Epistle to the Son of the Wolf* | Bahá’u’lláh | Shoghi Effendi | 1 | 270 | 46,232 |
| *Tablets of Bahá’u’lláh Revealed after the Kitáb-i-Aqdas* | Bahá’u’lláh | Habib Taherzadeh, with a committee at the Bahá’í World Centre | 17 | 669 | 64,148 |
| *Prayers and Meditations by Bahá’u’lláh* | Bahá’u’lláh | Shoghi Effendi | 184 | 878 | 78,746 |

The shelf adds **ten works, 461 chapters, 4,375 passages and 452,612 words**,
and the acquisition register gains **ten entries** — one per work — recording
the source lead and the rights position. The library seeds **1,464 works, 2,379
editions and 1,675,710 passages**; the Bahá’í shelf is the tradition's shelf, and
the ten works are all of it that is imported so far.

Two of the works are collections published in English and translated whole by
the Guardian or by the Research Department's translators — Gleanings and the
Tablets — and two were composed in answer to questions or in address to named
people: Some Answered Questions, the talks ‘Abdu’l-Bahá gave at ‘Akká to Laura
Clifford Barney over 1904–06, and the Epistle to the Son of the Wolf, the last
of the major works of Bahá’u’lláh, written in 1891.

## 2. How the Reference Library is read

The library publishes each work as a series of numbered reading views
(`/1`, `/2`, `/3` …). Those numbers are the site's pagination, not a division of
the text; a single view can carry several chapters, and a chapter can begin in
one view and end in another. Inside a view the library marks up the publication
it prints: an element whose class names it as a heading carries a part, chapter
or tablet title; a numbered paragraph carries the number the printed book
carries in a `brl-pnum` anchor; an unnumbered paragraph carries none.

The import walks the views a work needs, groups the paragraphs into the work's
own chapters — splitting at the publication's headings, and turning a bare
numeral heading into a label ("Prayer I", "Selection CLXVI") — and records, for
every chapter, which views it spans and which paragraphs within them belong to
it. The reader fetches exactly those views again and shows exactly those
paragraphs, so the text a reader sees is the text the passage index was built
from, and the two cannot drift apart unnoticed.

### Structure worth knowing

- **The numbering is the publication's own and is kept.** The Kitáb-i-Aqdas
  1–190, the Hidden Words 1–71 and 1–82, Gleanings' selections I–CLXVI, Some
  Answered Questions' chapters 1–84 with the paragraphs within them, the
  Tablets' sixteen tablets and the appendix of excerpts, and Prayers and
  Meditations' prayers I–CLXXXIV. These are the numbers Bahá’í reference works
  cite, so they are the passage references here.
- **Where the library prints no numbers, the passages are indexed in reading
  order.** The Íqán, the Epistle, and the paragraphs of a tablet or a prayer
  carry no number in the library's reading text. The Íqán is still indexed by
  its two parts, and each part's paragraphs in order (293 passages); the Epistle
  is one chapter of 270 paragraphs; the tablets are one chapter each; and each
  prayer is one chapter, its paragraphs in order.
- **Unnumbered paragraphs inside a numbered chapter are marked `u1`, `u2` …**
  The Hidden Words opens each part with an invocation that carries no number
  ("He Is the Glory of Glories", "In the Name of the Lord of Utterance, the
  Mighty"), and its later continuations of a passage are unnumbered too. In the
  Kitáb-i-Aqdas' Questions and Answers the library numbers the questions and
  prints the answers without numbers, so the questions are 1–105 and the
  answers `u2`, `u4` … in step with them. Those paragraphs are addressable as
  `1.u1` rather than being given a number the publication does not print.
- **Paragraph numbers are not repeated inside the text.** The library prints a
  paragraph's number twice: once as a marginal number of its own, and once at
  the head of the paragraph it numbers. The marginal copy is dropped, and the
  copy inside the paragraph is removed as well, because the reference already
  carries it — the reading pane opens "O Son of Spirit! My first counsel is
  this." rather than "1 O Son of Spirit!".
- **Footnote markers are not text.** The library links its notes with
  superscript numbers, which left headings reading "(The Most Holy Tablet)1".
  The marker is now dropped; the notes themselves are the publication's
  apparatus and are not imported at all.
- **The apparatus stays with the publication.** Not imported: the translator's
  foreword and ‘Abdu’l-Bahá's preface to the first edition of Some Answered
  Questions; Shoghi Effendi's description of the Kitáb-i-Aqdas, the synopsis and
  codification of its laws, the notes and the key to passages; the Tablets' note
  on the translations of Shoghi Effendi and its notes; the notes at the end of
  the Epistle, Some Answered Questions and Prayers and Meditations. What is
  imported is the text, not the edition around it.
- **Some Answered Questions has no original title of its own here, and the
  Tablets has none.** The Tablets is a compilation made in English by the
  Research Department of the Universal House of Justice, so its record leaves
  the original title and transliteration empty rather than inventing one; the
  work keeps the name the publication gives each tablet.
- **The shelf is English-only.** The Reference Library publishes the Persian and
  Arabic originals of several of these works as downloads, not as reading views.
  Every edition record says so, and names its translator.

## 3. Rights

The works are the copyright of the Bahá’í International Community. They are
streamed from bahai.org under the library's legal terms: shown with the
Community's copyright notice, the title of the work and the translator named,
never relicensed and never used commercially. The registry entry records
`licence_status: site_copyright_conditions_with_owner_authorisation`,
`redistribution_allowed: null`, `ingestion_status: active`, and a rate note that
keeps requests chapter-sized, cached, with a descriptive user agent and a delay
between them: the library is never bulk-crawled. No Bahá’í text enters the local
corpus or the database, and the reader's stream notices name the host and the
upstream reference for every chapter shown.

## 4. Verification performed

- `bun run scripts/dev/import-bahai.ts` fetches the views and writes the ten
  catalogue records, the stream configuration, the textual-function
  classifications, the acquisition entries and `data/imports/bahai.json`. It
  refuses a work whose chapters are empty, whose references repeat or whose
  imported text has lost markup or come out implausibly short.
- A second run reads the import cache and rebuilds everything without touching
  the network, so the catalogue can be regenerated without re-reading the host.
- The search index was rebuilt from the cache and holds **4,375 indexed
  passages** for the shelf, with the excerpts the search results show.
- Every one of the ten works was read through the reader: each reported
  `aligned: true` with the local passage index, each showed the copyright notice
  and the edition with the text, and the chapter and passage addressing was
  checked at the start and the end of a work.

## 5. What remains

- **The writings of the Báb** — the Bayán, the Selections, the Persian Bayán —
  are published by the same library and are not imported; the tradition's shelf
  is incomplete without them.
- **Shoghi Effendi's own works** — God Passes By, The World Order of
  Bahá’u’lláh, the letters — and the rest of ‘Abdu’l-Bahá's books: the Secret of
  Divine Civilization, Memorials of the Faithful, the Tablets of the Divine
  Plan, Paris Talks and the other talk collections.
- **The Persian and Arabic originals** of the works now held, which the library
  serves as downloads rather than reading views; reading them beside the English
  would need a second source and a per-file rights review.
- **The Universal House of Justice's messages and the compilations** are
  institutional texts with their own dates of authority; they should be
  imported, if at all, as their own category rather than as scripture.
