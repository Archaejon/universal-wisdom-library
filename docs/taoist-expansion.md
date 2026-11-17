# The Taoist shelf: the Daodejing, Zhuangzi, Liezi and the scriptures

**Universal Wisdom Library** — 23 October 2026

Taoism held a single text. The Daodejing was present in Legge's translation and
in a Daozang Chinese edition, and nothing else on the shelf carried running
text: no Zhuangzi, no Liezi, no scripture, no morality book. This pass compiles
the Taoist shelf from the Internet Sacred Text Archive, which carries Legge's
complete *Texts of Taoism* (Sacred Books of the East, volumes 39 and 40) and the
Wisdom of the East and Open Court translations beside it.

Seven works are added, all streamed: the catalogue record, chapter outline and
passage index live in the library, and the reader fetches a chapter from the
archive. The import caches hold the exact reviewed segments used to build the
search index, not a second public copy of the text.

## 1. What was added

| Work | Volume | Translator, year | Chapters | Passages | Words |
| --- | --- | --- | ---: | ---: | ---: |
| *Zhuangzi* | SBE 39–40 | James Legge, 1891 | 33 | 2,049 | 134,843 |
| *Liezi* | Wisdom of the East | Lionel Giles, 1912 | 7 | 454 | 22,950 |
| *Yang Chu's Garden of Pleasure* | Wisdom of the East | Lionel Giles, 1912 | 19 | 260 | 5,868 |
| *The Tai Shang Tractate of Actions and Their Retributions* | SBE 40 | James Legge, 1891 | 1 | 24 | 2,544 |
| *The Classic of Purity* | SBE 40 | James Legge, 1891 | 1 | 23 | 763 |
| *The Yin Fu King* | SBE 40 | James Legge, 1891 | 1 | 21 | 881 |
| *Yin Chih Wen: The Tract of the Quiet Way* | Open Court | Teitaro Suzuki and Paul Carus, 1906 | 1 | 63 | 946 |

This pass adds **seven works, 63 chapters, 2,894 passages and 168,795 words**.
The Sacred Text Archive shelf now holds **fifty-one works: 4,741 chapters,
129,889 passages and 5,458,132 words**. The library seeds **1,401 works, 2,305
editions and 1,474,996 passages**; Taoism now has eight works, seven of them
with running text.

### Structure worth knowing

- **The Zhuangzi is complete, in Legge's thirty-three-book recension.** Books
  I–XVII are streamed from volume 39, books XVIII–XXXIII from volume 40, one
  printed book per chapter. The two volumes' introductions and the appendixes
  printed after the text are not part of the work.
- **The archive mislabels Book XXIX.** Its index prints "Book XXIV. Tâo Kih, or
  'The Robber Kih'" for the page that carries Book XXIX. The chapter label
  follows the book's own heading and position; the archive's slip is recorded
  in the acquisition register rather than reproduced.
- **Footnotes stay with the philosophical volumes.** Legge prints his notes at
  the foot of each book page, and they remain in the chapter as they do for the
  other Sacred Books of the East imports. In the four short texts the notes are
  excluded, because they would outweigh the scripture itself.
- **Giles's Liezi is a selection.** He translated seven of the eight books and
  published the Yang Chu book separately, as *Yang Chu's Garden of Pleasure*.
  Both are imported under their own records, so the library holds all the
  Liezi that Giles translated, but not the eighth book ("Explaining
  Conjunctions"), which he did not.
- **The appendix pages needed trimming.** Legge's *Classic of Purity* and *Yin
  Fu King* pages open with his introductory notice before the translation, and
  each ends with a block of footnotes. The importer now takes an optional
  `textStartMarker`, so the chapter begins at the translation; the same work's
  `endMarker` stops it before the notes. The notices remain in the printed
  volume, not in the reading text.
- **The Tai Shang Tractate keeps Legge's marginal headings.** His printed page
  sets summary headings in the margin ("The Thesis.", "Machinery to secure
  retribution."), and the archive's transcription places them inside the
  paragraphs. They are preserved rather than silently deleted; the register
  notes the artefact.
- **The Yin Chih Wen keeps its commentator's marks.** The 1906 translation
  carries the Chinese commentator's `CC` cross-references in the running text,
  and those cross-references point to notes on a separate page that is not part
  of the work. They are preserved as printed.

## 2. Terebess Asia Online

The Taoism index at [terebess.hu/english/tao.html](https://terebess.hu/english/tao.html)
was checked as a possible second source. It is a large, long-running personal
library with two kinds of material:

- **Public-domain volumes that duplicate the archive.** It mirrors Legge's
  *Texts of Taoism* as HTML and the Suzuki–Carus morality books, which the
  library already streams from the Internet Sacred Text Archive. These pages
  are a usable fallback host if the archive's transcription changes.
- **Modern translations in copyright.** The index links PDFs of Cleary's
  *Taoism Reader* and *Wen-tzu*, Watson's complete *Zhuangzi*, Mair's
  *Wandering on the Way*, Eva Wong's books, Graham's *Book of Lieh-tzu* and
  the Columbia University Press edition, alongside modern scholarship. None of
  these can be imported without permission.

The verdict is therefore **no import from Terebess in this pass**. It is now a
registry entry in `under_review` rather than an approved source, with the
rights position stated per category, and it supplies leads for four acquisition
targets: the Huainanzi, the Wenzi, a complete Liezi and a modern Zhuangzi. The
presence of a PDF on the site is not treated as evidence of a reusable licence.

## 3. What remains

- **Two appendix scriptures were left for the next pass.** Legge's *Yu Shu
  King* (Appendix III) and *Zah Yung King* (Appendix IV) are public domain and
  use the same page handling as the two short classics; they were recorded as
  located targets to keep the first pass to the texts that are actually read.
  Both are imported in the second pass (§5).
- **The Huainanzi** has only a partial 1933 English rendering (Morgan) whose
  renewal status is unverified; the complete scholarly translation is in
  copyright. It stays located; §5 records the same conclusion after a second
  review.
- **The Wenzi** can be added in Chinese from the Chinese Text Project once the
  site's item-level terms are checked; the English translation is in copyright.
- **A complete Liezi in English and a modern Zhuangzi** remain rights-blocked.
  Legge and Giles are the public-domain witnesses the library can carry.
- **The Daozang** is a canon of some 1,600 titles. It should be taken
  scripture by scripture with verified transcriptions, not imported wholesale.

## 4. Reproducing

```
bun run import:tao-te-ching
bun run import:sacred-texts --only=zhuangzi
bun run import:sacred-texts --only=liehzi
bun run import:sacred-texts --only=yang-chu
bun run import:sacred-texts --only=tai-shang-tractate
bun run import:sacred-texts --only=qingjing-jing
bun run import:sacred-texts --only=yinfu-jing
bun run import:sacred-texts --only=yin-chih-wen
bun run import:sacred-texts --only=canon-of-reason-and-virtue
bun run import:sacred-texts --only=taoist-texts
bun run import:sacred-texts --only=sayings-of-lao-tzu
bun run import:sacred-texts --only=yushu-jing
bun run import:sacred-texts --only=zah-yung-jing
bun run db:rebuild
```

The importers write the work files, the stream configuration, the text-function
classification, `data/imports/sacred-texts.json` and
`data/imports/tao-te-ching.json`; `db:rebuild` reseeds the library and rebuilds
the streamed-text index from the import caches.

## 5. Second pass — the complete Daodejing and the remaining volumes

The Daodejing was the one text this shelf claimed and did not have. The corpus
carried four chapters (1, 8, 11 and 81) under a description of the whole book,
and Legge's chapter 8 ran on into chapter 9. The second pass completes it and
imports the rest of the archive's public-domain Taoist shelf.

### The Daodejing, in two editions

- **All eighty-one chapters**, in Wang Bi's Chinese recension and in Legge's
  complete translation, held locally because the two editions are read in
  parallel: **10,557 English words and 6,457 Chinese characters**.
- **One passage per chapter.** `Daodejing 1` and `Daodejing 81` are the units the
  rest of the corpus cites, in the collections and in the relationships between
  texts, so the chapter is the passage. The two editions align exactly.
- **The Chinese edition changed.** The Daozang transcription on Wikisource,
  which supplied the old sample, is damaged: only seventy-three of its
  eighty-one chapters have a heading at all, ten of those headings are glued
  onto the end of the preceding chapter's last line, and chapters 30–37 have
  lost theirs entirely. The Wang Bi recension is clean and punctuated, so it
  replaces the Daozang text, and the edition note says that his interlinear
  commentary is not included.
- **Legge's English comes from Project Gutenberg #216**, not from the archive.
  The archive's transcription belongs to a host whose terms keep it on its own
  site; a locally held text has to come from a host that permits local storage.
  The importer reads the chapter openings by the sequence they must follow, so
  Legge's three ways of numbering a chapter ("1. 1.", a bare "6.", and
  "11. The thirty spokes…") all parse, and his verse numbers stay in the text.

### The five streamed works

| Work | Volume | Translator, year | Chapters | Passages | Words |
| --- | --- | --- | ---: | ---: | ---: |
| *The Canon of Reason and Virtue* | Open Court | Teitaro Suzuki and Paul Carus, 1913 | 81 | 339 | 7,868 |
| *Taoist Texts: Ethical, Political, and Speculative* | Trübner and Kelly and Walsh | Frederic Henry Balfour, 1884 | 10 | 547 | 45,246 |
| *The Sayings of Lao Tzŭ* | Wisdom of the East | Lionel Giles, 1905 | 9 | 241 | 7,996 |
| *The Yu Shu King* | SBE 40, Appendix III | James Legge, 1891 | 1 | 14 | 669 |
| *The Zah Yung King* | SBE 40, Appendix IV | James Legge, 1891 | 1 | 9 | 577 |

The five add **102 chapters, 1,150 passages and 62,356 words**. Together with
the completed Daodejing the shelf now holds **13 works and 4,125 passages**; the
Sacred Text Archive shelf holds **56 works, 4,843 chapters, 131,039 passages and
5,520,488 words**.

*Taoist Texts* is the most consequential of the five. Balfour's 1884 anthology
is the first English collection of Daoist scripture, and it brings in five short
classics the shelf did not have — the T'ai Hsi Ching, the Hsin Yin Ching, the
Ta T'ung Ching, the Ch'ih Wen T'ung and the Su Shu — beside his own Tao Te
Ching, Yin Fu Ching, Ch'ing Ching Ching and Kan Ying Pien. His prefaces and
footnotes stand with each text, as in the printed volume, so the Tao Te Ching
chapter opens with his note on earlier translations.

Carus's *Canon of Reason and Virtue* gives the comparison view a second complete
English Daodejing, with his own chapter titles. The archive serves the Chinese
of its facing pages as images, so the edition is English only. His pages print
the page number inside the running text ("it p. 76 resembleth"), which the
reader was showing as part of the sentence; the HTML extractor now removes the
archive's `page_N` anchors whenever a volume asks for page numbers to be
dropped.

Legge's two appendix scriptures are one printed page each. His introductory
notices are excluded, as they were for the *Classic of Purity* and the *Yin Fu
King*. The transcription breaks a sentence wherever the printed page turned, so
the *Zah Yung King* has paragraphs that begin or end mid-sentence; that is
recorded in its availability note rather than repaired by guesswork.

### Terebess, reviewed item by item

The Taoism index at [terebess.hu](../data/registry/sources.json) was checked
again, title by title, because it is the fullest public list of Taoist texts in
English. The result is unchanged in substance and now final:

- **Its public-domain holdings duplicate the archive.** Legge's *Texts of
  Taoism*, Giles's Lieh Tzŭ, and the Suzuki–Carus morality books are the same
  texts, already streamed from the Internet Sacred Text Archive.
- **Its unique holdings are in copyright.** Watson, Mair, Graham, Cleary, Wong,
  Robinet, the Columbia Lieh-tzu and the 2010 Huainanzi are all modern works.
- **Its Daodejing page is a bibliography, not a text.** It lists 112 English
  translations and links to other sites for most of them. That list is what
  confirmed the public-domain set — Legge, Balfour, Carus and Suzuki, Goddard,
  Medhurst, Mears, Gorn-Old and Giles — of which all but Mears (1916) and
  Gorn-Old (1904) are now on the shelf; those two survive only as Wayback
  snapshots of a third-party site and stay on the register.

The source is therefore recorded as `restricted` for ingestion and `rejected`
for approval, with a note that says plainly that this concerns ingestion and not
citation: it remains a finding aid and a fallback host, and nothing was fetched
from it into the corpus.

### What remains

- **The Huainanzi** is still the largest gap. Morgan's 1933 partial rendering is
  the only public-domain English text, and its renewal status is still
  unverified; the complete translation (Major et al., 2010) is in copyright.
- **The Wenzi** can be added in Chinese from the Chinese Text Project once its
  item-level terms are checked.
- **A complete English Liezi and a modern Zhuangzi** remain rights-blocked; the
  library carries Legge and Giles.
- **The Daozang** should still be taken scripture by scripture. The four
  appendix scriptures and Balfour's ten texts are the beginning, not a canon.
