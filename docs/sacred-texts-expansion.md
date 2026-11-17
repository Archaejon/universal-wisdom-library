# The Sacred Books of the East shelf: Zoroastrian, Hindu and Buddhist volumes

**Universal Wisdom Library** — 22 October 2026

The Internet Sacred Text Archive is the only machine-readable host for most of
the Sacred Books of the East, the fifty-volume Victorian translation series that
still supplies the standard public-domain English text of the Avesta, the
Dharmasastras and much of the Mahayana canon. The library already used it for
Keith's Taittiriya Samhita and Thibaut's Vedanta-Sutras. This pass adds eleven
complete volumes, chosen to fill the three largest gaps in the catalogue rather
than to sweep the archive indiscriminately:

- **Zoroastrianism had no text at all.** The shelf held one catalogue record,
  the Gathas, with no edition. It now carries the Vendidad, the Yasna (with the
  Gathas, Visparad, Afrinagan and Gahs) and the Sirozahs, Yashts and Nyayis.
- **The Buddhist shelf held discourses only.** It had the Digha and Majjhima
  Nikayas, the Dhammapada and the Sutta Nipata's neighbours in the Pali canon,
  but no Mahayana scripture, no monastic law and no Milinda. It now has the
  Lotus Sutra, the Buddhist Mahayana Texts volume (Awakening of Faith, the Pure
  Land sutras, the Diamond and Heart Sutras), the Questions of King Milinda and
  the seven suttas of SBE 11.
- **The Hindu shelf had scripture and philosophy but no law.** It now has
  Bühler's Laws of Manu complete, Ballantyne's Sankhya Aphorisms and the Hatha
  Yoga Pradipika.

Nothing is copied into the repository as display text. Each work keeps a
catalogue record, a chapter outline and a passage index; the reader fetches the
chapter from the archive and the import cache holds only the validated segments
used to build the search index.

## 1. What was added

| Work | Volume | Translator, year | Chapters | Passages | Words |
| --- | --- | --- | ---: | ---: | ---: |
| *Vendidad* | SBE 4 | James Darmesteter, 1880 | 22 | 2,514 | 70,287 |
| *Yasna* (with Visparad, Afrinagan, Gahs) | SBE 31 | L. H. Mills, 1887 | 103 | 2,906 | 121,480 |
| *Sirozahs, Yashts and Nyayis* | SBE 23 | James Darmesteter, 1883 | 27 | 3,202 | 66,467 |
| *The Laws of Manu* | SBE 25 | Georg Bühler, 1886 | 12 | 2,688 | 85,120 |
| *Sankhya Aphorisms of Kapila* | — | James R. Ballantyne, 1885 | 6 | 1,778 | 67,768 |
| *Hatha Yoga Pradipika* | — | Pancham Sinh, 1914 | 4 | 1,292 | 23,124 |
| *Sutta-Nipata* | SBE 10 | Viggo Fausböll, 1881 | 5 | 1,781 | 50,291 |
| *Buddhist Suttas* | SBE 11 | T. W. Rhys Davids, 1881 | 7 | 2,081 | 88,708 |
| *Questions of King Milinda* | SBE 35–36 | T. W. Rhys Davids, 1890/1894 | 27 | 4,905 | 193,157 |
| *Buddhist Mahayana Texts* | SBE 49 | Cowell, Müller and Takakusu, 1894 | 24 | 2,732 | 95,878 |
| *Lotus Sutra* | SBE 21 | H. Kern, 1884 | 27 | 1,604 | 95,411 |

In total: **11 works, 264 chapters, 27,483 passages and 957,691 words**, all
public-domain translations of printed editions. The library now seeds **1,361
works and 1,312,113 passages**. The Zoroastrian shelf goes from 0 to 3 readable
works, Hinduism from 21 to 24, Buddhism from 187 to 192.

The Gathas catalogue record is kept, but its availability note now states the
fact the shelf previously obscured: the Gathas are not a separate book but the
seventeen hymns at the centre of the Yasna (Yasna XXVIII–LIII), and they are
read there.

## 2. How a volume is described

Volume indexes on the archive list one link per printed chapter. A volume is
therefore described in `scripts/dev/import-sacred-texts.ts` by:

- the index page;
- one or more ranges of links (`from` and `to`), so front matter, contents,
  preface and index are skipped even though they appear in the same list;
- the translation's bibliographic record and a short editorial description.

A multi-volume work uses several ranges. The Questions of King Milinda combines
SBE 35 and 36, each with its own index, and prefixes the chapter labels with the
source volume because the printed numbering restarts.

Chapter labels come from the index anchor text, except for the Yasna, where the
archive index is off by one in places (it labels the page that prints Yasna LXIV
as Yasna LXIX). That volume takes its labels from each page's own `h3`, which
carries the printed designation.

## 3. Reading the pages

The reader and the importer call the same `extractHtmlSegments`, so the passage
index and the displayed text cannot drift apart. Two options were added for
these volumes:

- **`dropPageNumbers`** removes the printed page markers (`p. 12`, `p. xxx`,
  `{p. 12}`), repeated runs of them (`p. 366 p. 367`) and the underscore or dash
  rules that separate sections. They are page furniture, not text.
- **`startMarker`** is chosen from the first page of a volume. Newer
  transcriptions close their site banner with `<HR></p>`; older ones only have a
  plain rule after the breadcrumb. The chosen marker is stored in
  `streams.json`, so the reader cuts the page exactly as the import did.

A page that contains only a heading and a cross-reference (Yasna LXIV is one)
yields that heading as its single segment rather than being reported as an empty
chapter.

## 4. Provenance and rights

Every edition records the printed title, translator, year, Sacred Books volume,
source (`sacred-texts`), licence (`public-domain`) and an attribution line
naming the translation, the translator and the archive as the digital source.
The archive's transcription is streamed, never copied into the repository, and
the registry entry states the access position authorised by the project owner on
22 October 2026: chapter-sized requests, fetched once per page, with a
descriptive user agent, and no bulk crawling.

The acquisition register now holds the eleven imported volumes with their
source leads and rights notes, plus wanted records for the four largest
remaining volumes: the Pahlavi Texts (SBE 5, 18, 24, 37, 47), the Satapatha
Brahmana (SBE 12, 26, 41, 43, 44), the Vinaya Texts (SBE 13, 17, 20) and the
Jataka (six volumes). Those are deliberately left for a later pass: together
they are roughly three times the size of this one.

## 5. Verification

- Every volume was fetched once from its index, and every chapter page had to
  yield readable segments; an empty page fails the import rather than being
  silently skipped.
- The import asserts unique chapter references, non-empty segments, no Unicode
  replacement characters and a plausible total length.
- `tests/stream.test.ts` checks all eleven works: chapter counts, passage
  counts, stream entries, page lists, licence and the chapter reference of every
  passage. It also covers page-number removal, the heading-only page and the
  Latin-1 entity decoding these transcriptions need.
- The search index was rebuilt from the import caches, chapter by chapter, and
  reports one skipped segment (an empty paragraph in the Mahayana volume).

Known limits: the transcriptions print footnotes at the foot of each page, and
in the Mahayana volume some footnotes are interleaved between verse paragraphs;
the printed `p.` markers inside footnotes remain. These are artefacts of the
source pages, not of the segmentation, and the reader shows the page as the
archive serves it.

## 6. Reproducing

```sh
# Fetch and validate the eleven volumes (resumes from the import cache)
bun run import:sacred-texts

# One volume, or a forced refetch
bun run import:sacred-texts --only=vendidad
bun run import:sacred-texts --force --only=yasna

# Rebuild the database and the search index for this provider
bun run db:reset
bun run index:streams --provider=sacred-texts
```

The importer writes `data/imports/sacred-texts.json` (per-work figures),
`data/imports/cache/sacred-texts/<slug>.json` (validated segments),
`data/corpus/works/<slug>.json`, `data/registry/streams.json` and
`data/corpus/text-functions.json`.

## 7. Second pass — Pahlavi Texts and the Satapatha Brahmana (22 October 2026)

The same importer was then used to finish the two shelves it had left
incomplete: the Zoroastrian Pahlavi books and the Vedic prose of the Satapatha
Brahmana.

| Work | Volume | Translator, year | Chapters | Passages | Words |
| --- | --- | --- | ---: | ---: | ---: |
| *Pahlavi Texts, Part I: Bundahis, Bahman Yast, Shayast la-Shayast* | SBE 5 | E. W. West, 1880 | 71 | 2,912 | 131,701 |
| *Pahlavi Texts, Part II: Dadistan-i Dinik and the Epistles of Manushchihar* | SBE 18 | E. W. West, 1882 | 119 | 2,872 | 135,607 |
| *Pahlavi Texts, Part III: Mainog-i Khirad, Sikand-Gumanik Vigar, Sad Dar* | SBE 24 | E. W. West, 1885 | 179 | 2,643 | 105,243 |
| *Pahlavi Texts, Part IV: Contents of the Nasks* | SBE 37 | E. W. West, 1892 | 145 | 3,307 | 138,385 |
| *Pahlavi Texts, Part V: Marvels of Zoroastrianism* | SBE 47 | E. W. West, 1897 | 28 | 1,035 | 48,679 |
| *Satapatha Brahmana* | SBE 12, 26, 41, 43, 44 | Julius Eggeling, 1882–1900 | 394 | 14,096 | 670,690 |

This pass adds **six works, 936 chapters, 26,865 passages and 1,230,305
words**. The Sacred Books shelf now holds **seventeen works: 1,200 chapters,
54,348 passages and 2,187,996 words**. The library seeds **1,367 works,
2,269 editions and 1,338,978 passages**. Zoroastrianism now has **nine works**
(three Avestan, five Pahlavi, and the Gathas catalogue record); Hinduism has
**twenty-five**, with the Satapatha as its first Brahmana.

### Structure worth knowing

- **Pahlavi volumes are separate works, not one shelf blob.** Each volume is a
  distinct book with its own translator's preface, and its internal texts are
  kept apart by chapter prefixes: `Bundahis · Chapter I`, `Bahman Yast ·
  Chapter I`, `Sad Dar · Chapter C`. Without the prefix, every volume would
  present several files all called "Chapter I".
- **Book numbers are read from the pages, not guessed.** The Denkard volume
  contains Book VIII (46 chapters) followed by Book IX (69 chapters); both
  restart at Chapter I, so the boundary was confirmed from the page headings
  (`DÎNKARD. BOOK IX.`) rather than the index labels.
- **The Satapatha is one work across five printed volumes.** Its 394 pages are
  the printed brahmanas, each labelled with its kanda, adhyaya and brahmana
  number (`XIV, 3, 2. Second Brâhmana`), so the five volumes read continuously
  from Kanda I to Kanda XIV without five near-identical catalogue records.
- **A known gap in the source.** The archive's Dadistan-i Dinik transcription
  omits the printed Chapter XXII: its numbering jumps from XXI to XXIII. The
  work's availability note says so; nothing was invented to fill the gap.

The acquisition register's `pahlavi-texts` and `satapatha-brahmana` targets are
now marked imported, with the figures and the volume mapping.

## 8. Third pass — the Vinaya and the Jataka (22 October 2026)

The remaining gaps on the Buddhist shelf were the monastic law and the birth
stories. Both are now complete, imported from the same archive with the same
reader.

| Work | Volumes | Translator, year | Chapters | Passages | Words |
| --- | --- | --- | ---: | ---: | ---: |
| *Vinaya Texts* | SBE 13, 17, 20 | T. W. Rhys Davids and Hermann Oldenberg, 1881–1885 | 321 | 9,464 | 321,779 |
| *The Jataka* | 6 vols. (Cambridge) | E. B. Cowell (ed.), with Chalmers, Rouse, Francis and Neil, 1895–1907 | 547 | 16,510 | 869,270 |

This pass adds **two works, 868 chapters, 25,974 passages and 1,191,049
words**. The Sacred Books shelf now holds **eighteen works: 1,521 chapters,
63,812 passages and 2,509,775 words**. The library seeds **1,369 works,
2,271 editions and 1,364,952 passages**. The Buddhist shelf gains the two
largest works still missing from it, from the canonical monastic law to the
complete book of birth stories.

### Structure worth knowing

- **The Vinaya is one work, not three volumes.** Part I holds the Pātimokkha
  and the first four Mahāvagga khandhakas; Part II the Fifth to Tenth and the
  first three of the Kullavagga; Part III the Fourth to Twelfth. All 321 printed
  pages are one continuous outline, labelled `Mahavagga V, Chapter 1` or
  `Kullavagga I, Chapters 26 and 27`.
- **Chapter numbers come from the pages.** The volume index restarts at Chapter
  1 for every khandhaka and misprints several numbers (it repeats Chapter 15 in
  Kullavagga I, skips 27 in the third khandhaka, and labels the Ninth Khandhaka's
  first chapter as the Eighth's thirty-second). The importer takes the number
  printed on the page instead. When a page prints two chapters, the label names
  both; one page closes Mahāvagga VIII, chapter 32 and opens IX, chapter 1, and
  its label says so.
- **The Jataka is one work of 547 stories.** The six volumes are read as one
  sequence in printed order, numbered No. 1 to No. 547. The archive index
  misprints No. 384 as "No. 3841" and gives the title as "Jātaba"; the page
  heading is `No. 384.`, and the label follows it.
- **One page needed its own opening marker.** Volume III, page 414 (No. 414,
  Jāgara-Jātaka) is an older transcription whose text begins after a dotted
  rule. The importer detected the variant, recorded `startMarker` on that page
  alone, and the reader now segments it the same way. No text was dropped or
  silently realigned.

The acquisition register's `vinaya-texts` and `jataka` targets are now marked
imported, with the figures and the volume mapping.

## 9. Fourth pass — the Vedic shelf and the law books (23 October 2026)

The Hindu shelf had no Samaveda, no White Yajurveda, no complete Atharvaveda
and none of the SBE volumes of Vedic hymns. This pass imports the four Vedas'
shelves and the dharmasastra and grihya volumes that the archive carries, using
the same importer with two new page shapes described below.

| Work | Volume | Translator, year | Chapters | Passages | Words |
| --- | --- | --- | ---: | ---: | ---: |
| *Hymns of the Samaveda* | one page | R. T. H. Griffith, 1895 | 15 | 464 | 42,914 |
| *A Vedic Reader for Students* | one page | A. A. Macdonell, 1917 | 29 | 156 | 20,171 |
| *The Texts of the White Yajurveda* | 40 books | R. T. H. Griffith, 1899 | 40 | 308 | 64,753 |
| *The Hymns of the Atharvaveda* | 20 books | R. T. H. Griffith, 1895–96 | 725 | 729 | 150,477 |
| *Hymns of the Atharva-Veda (SBE 42)* | SBE 42 | Maurice Bloomfield, 1897 | 215 | 224 | 54,722 |
| *Vedic Hymns, Part I* | SBE 32 | F. Max Müller, 1891 | 49 | 3,970 | 128,839 |
| *Vedic Hymns, Part II* | SBE 46 | Hermann Oldenberg, 1897 | 130 | 2,885 | 95,468 |
| *Thirty Minor Upanishads* | one volume | K. Narayanasvami Aiyar, 1914 | 30 | 1,016 | 95,503 |
| *The Sacred Laws of the Âryas, Part I* | SBE 2 | Georg Bühler, 1879 | 89 | 3,915 | 89,503 |
| *The Sacred Laws of the Âryas, Part II* | SBE 14 | Georg Bühler, 1882 | 88 | 3,856 | 94,306 |
| *The Institutes of Vishnu* | SBE 7 | Julius Jolly, 1880 | 100 | 3,565 | 84,257 |
| *The Minor Law Books* | SBE 33 | Julius Jolly, 1889 | 81 | 3,557 | 118,421 |
| *The Grihya Sutras, Part I* | SBE 29 | Hermann Oldenberg, 1886 | 224 | 4,732 | 112,911 |
| *The Grihya Sutras, Part II* | SBE 30 | Hermann Oldenberg, 1892 | 122 | 3,862 | 89,816 |

This pass adds **fourteen works, 1,937 chapters, 33,239 passages and 1,242,061
words**. The Sacred Text Archive shelf now holds **thirty-three works: 4,005
chapters, 113,561 passages and 4,621,106 words**. The library seeds **1,383
works, 2,285 editions and 1,398,191 passages**. The Hindu shelf grows from
twenty-five works to **thirty-nine**.

### Structure worth knowing

- **The Samaveda is one archive page, read as fifteen books.** Griffith's whole
translation — both parts, Books I–VI and I–IX — is a single 288 KB page. The
importer now splits such a page at its printed headings and records, for each
chapter, the `from`/`to` slice of the page's segment sequence. The reader
extracts the page once and returns the recorded slice, so the outline and the
read text agree.
- **The Atharvaveda's index is two levels deep.** The archive links to twenty
  book pages, and each book page lists its hymns. The importer follows the
  contents pages and writes one chapter per hymn (725 in the complete Griffith
text). The book pages' running navigation ("Next: Book 2", "Index") is not
taken as a chapter.
- **Verse numbers are separated from the words.** These pages print the verse
number in a marginal-note span set flush against the first word. The extractor
now keeps the number but pads it, so a hymn reads `1 Now may Vāchaspati …`
rather than `1Now may …`, and search indexes the words rather than `1now`.
- **The White Yajurveda is not the Taittiriya Samhita.** Griffith's volume is
the Vajasaneyi (Madhyandina) recension in forty books; Keith's Taittiriya
Samhita already on the shelf is the Black Yajurveda. They are separate works
and the catalogue says so.
- **Two Atharvaveda records, on purpose.** Griffith is the complete text; SBE 42
is Bloomfield's selection with notes, so the selection never stands in for the
whole. The same rule separates Macdonell's *Vedic Reader*, an anthology with a
student's introduction, from the complete Rigveda.
- **Law books start at their first chapter.** The ranges open after the
volume's title page, contents and introduction; the Narada volume's "Author's
Preface" and the Vishnu Smriti's introduction are not chapters. Chapter labels
are the printed ones (`Prasna I, Patala 1, Khanda 1`, `I. Legal Procedure`).
- **The Grihya Sutras are read as printed sections.** Each archive page is one
printed section of the sutras (224 and 122 pages), and the page's running
section number is the label.

### What remains on the Hinduism page

The archive's Hinduism category also carries the Puranas (Vishnu, Garuda, Devi
Bhagavata, Devi Gita, Prem Sagur), the Vedanta and Later Texts volumes, and the
modern and devotional shelf (Tagore, Nivedita, Bain, Ramakrishna, Kalidasa,
Kabir and others). Those are the next passes. Three entries on that page cannot
be imported as they stand: *Relax with Yoga* (1960), *Great Systems of Yoga*
(1954) and the 1997 Sanskrit dictionary are still in copyright, and are left
out rather than reproduced without permission.

## 10. Fifth pass — the Christian and Buddhist shelves (23 October 2026)

The archive's Christianity and Buddhism sections had been used only for the
Buddhist volumes of the Sacred Books of the East. The Christian shelf drew its
Bible, Augustine, Aquinas and church fathers from other hosts, and the Buddhist
shelf still lacked the two most read books of the Pali canon after the
Dhammapada: the Udāna and the Therīgāthā. This pass sweeps both sections and
imports the principal primary texts that were still missing.

| Work | Volume | Translator, year | Chapters | Passages | Words |
| --- | --- | --- | ---: | ---: | ---: |
| *A Life of Buddha (Buddhacarita)* | SBE 19 | Samuel Beal, 1883 | 28 | 3,427 | 93,336 |
| *The Udāna* | — | G. M. Strong, 1902 | 8 | 794 | 30,137 |
| *Psalms of the Sisters (Therīgāthā)* | — | C. A. F. Rhys Davids, 1909 | 16 | 660 | 44,380 |
| *The Path of Light (Bodhicaryāvatāra)* | — | L. D. Barnett, 1909 | 9 | 105 | 13,547 |
| *The Apostolic Fathers* | ANF I | Alexander Roberts and James Donaldson, 1885 | 230 | 1,739 | 78,563 |
| *The Works of Dionysius the Areopagite* | — | John Parker, 1897 | 51 | 934 | 81,571 |
| *Proslogium, Monologium and Cur Deus Homo* | — | Sidney Norton Deane, 1903 | 111 | 1,168 | 82,197 |
| *The Cloud of Unknowing* | — | Evelyn Underhill (ed.), 1922 | 77 | 317 | 36,305 |
| *The Imitation of Christ* | — | William Benham, 1886 | 115 | 637 | 60,097 |

This pass adds **nine works, 645 chapters, 9,781 passages and 520,133 words**.
The Sacred Text Archive shelf now holds **forty-two works: 4,650 chapters,
123,342 passages and 5,141,239 words**. The library seeds **1,392 works, 2,294
editions and 1,407,972 passages**. Buddhism grows from 194 to **198** works and
Christianity from 90 to **95**.

### Structure worth knowing

- **The Apostolic Fathers is one work of nine documents.** Clement's letter to
  the Corinthians, the letter to Diognetus, Polycarp's Philippians, his
  martyrdom, the seven letters of Ignatius, Barnabas and the fragments of
  Papias are read as one outline, and every chapter label names its document
  (`Ignatius, Ephesians — Chapter IX`). Without the prefix the seven Ignatian
  letters would all present a `Chapter I`.
- **The archive's own index truncates its labels.** Its anchors read
  `Chapter I.—The salutation. Praise of the…`, summary cut mid-word. Each
  range therefore keeps the printed designation and drops the summary, so the
  contents list says `1 Clement — Chapter I` rather than reproducing a broken
  sentence. The same rule shortens the Cloud of Unknowing's seventy-five
  chapter titles to their numbers.
- **The printed volume, not a modern edition, decides the text.** Each Ignatian
  chapter page prints the shorter and the longer recension one after the other,
  and both are kept because the Ante-Nicene Fathers prints both. Two gaps
  belong to the archive's transcription: 2 Clement is not on the page, and the
  Syriac recensions and spurious Ignatian letters are not imported.
- **Dionysius is five works in two volumes.** The archive's one index runs the
  Divine Names, the Mystic Theology, the Letters, the Celestial Hierarchy and
  the Ecclesiastical Hierarchy together under repeated `Caput I` labels; the
  importer prefixes each chapter with its treatise. The letters keep their
  printed addressees.
- **Anselm's two books of Cur Deus Homo are two chapters.** The archive prints
  each book as one long page, so Book First and Book Second are single
  chapters; the Proslogium's own preface sits with the volume's introductory
  matter and is not part of the outline. The appendix keeps Gaunilo's objection
  and Anselm's reply beside the Proslogium they answer.
- **Two older transcriptions open under their own rule.** The Cloud of
  Unknowing and the Anselm volume close their site banner with a bare `<hr/>`
  and then run straight into the text, so the importer takes the banner's tail
  as the opening marker; both volumes also end the page with an inline `Next:`
  link before the site navigation, so they use `<p><hr/>` as the end marker.
  The reader is given the same three strings and shows no navigation text.
- **The Udāna is eight chapters, not eighty.** Each vagga page holds about ten
  numbered discourses, so a chapter is a whole vagga; the discourse numbers and
  the closing udāna verse are kept in the page as printed.
- **The Therīgāthā's cantos are lengths, not topics.** Rhys Davids groups the
  poems by the number of verses they contain (Canto I single verses, Canto XVI
  the Great Chapter), so each chapter holds many nuns' poems.
- **Barnett's Path of Light is nine chapters.** The translator rendered nine of
  the Sanskrit work's ten chapters; the tenth, a dedication of merit, is not in
  his selection and is not invented here.

### What remains on the two pages

The Christian section still carries the Pastor of Hermas (Ante-Nicene Fathers,
vol. II), the Didache as a separate page, the Corpus Hermeticum, the Kebra
Nagast, the Book of the Bee and the Cave of Treasures, Bede's Ecclesiastical
History, the Franciscan and Carmelite classics and the Reformation texts. Those
are a later pass. The Buddhism section's remaining scripture is largely already
here; its anthologies and modern compilations are not. The archive's twentieth-
century compilations — Goddard's *A Buddhist Bible* (1938), Suzuki's *Manual of
Zen Buddhism* (1934) and Senzaki and Reps's *Gateless Gate* (1934) — are left
out because their US copyright status has not been verified, and Olcott's
*Buddhist Catechism* and the *Gospel of Buddha* are modern digests rather than
primary texts.

The acquisition register's nine targets are now marked imported with their
figures, and both Buddhist and Christian shelves record the translations and
rights positions in the catalogue.

## 11. Sixth pass — the Sikh shelf (23 October 2026)

The Sikh section was the last part of the archive still uncatalogued. It is
small: the Guru Granth Sahib, MacAuliffe's *Sikh Religion*, Volume 1, and
Dorothy Field's *Religion of the Sikhs*. This pass imports the two
public-domain works. The Granth itself was imported separately, under written
permission, from the Gurbani-CD edition that also carries Sant Singh Khalsa's
translation; the archive's own pages are not its source.

| Work | Volume | Translator, year | Chapters | Passages | Words |
| --- | --- | --- | ---: | ---: | ---: |
| *The Sikh Religion*, Volume 1 | — | Max Arthur MacAuliffe, 1909 | 24 | 2,678 | 126,870 |
| *The Religion of the Sikhs* | Wisdom of the East | Dorothy Field, 1914 | 4 | 975 | 21,228 |

This pass adds **two works, 28 chapters, 3,653 passages and 148,098 words**.
The Sacred Text Archive shelf now holds **forty-four works: 4,678 chapters,
126,995 passages and 5,289,337 words**. The library seeds **1,394 works, 2,298
editions and 1,472,102 passages**; Sikhism now has three works, all with
running text.

### Structure worth knowing

- **Only one of MacAuliffe's six volumes is on the archive.** Volume 1 is the
  life of Guru Nanak and the translated hymns and liturgies; volumes 2–6 are
  public-domain scans with OCR on the Internet Archive and are recorded as a
  located lead. The work record's availability note says plainly that it is
  volume 1 only.
- **The last six chapters are Gurbani.** The Japji, Asa ki War, the Rahiras,
  the Sohila, the hymns of Guru Nanak and the additional sloks are full
  translations, not descriptions, and are indexed as chapters of MacAuliffe's
  volume.
- **The Granth is imported by permission, not from the archive.** The complete
  text comes from the sentence-by-sentence Gurbani-CD DOCX, under written
  permission from Kulbir S. Thind and from Sant Singh Khalsa for the English.
  The archive's Granth pages are the same modern Khalsa rendering, in copyright,
  so they are not a source. The register still records the Manmohan Singh scan
  as a blocked lead and Trumpp's 1877 partial translation as the only
  public-domain English witness.
- **Field's second chapter keeps its printed dash.** The archive's index renders
  the subtitle's long dash as a doubled em dash (`Sikhism——Hindu Monotheism`),
  and the chapter label reproduces the archive's own typography.

### What remains on the Sikh page

The archive has no Dasam Granth, Sarbloh Granth, Vaaran, janamsakhi, Rehat
Maryada or Sikh history beyond MacAuliffe. The wider survey and the source leads
for those works are in [sikh-expansion.md](sikh-expansion.md). The next import
opportunity is the public-domain MacAuliffe volumes 2–6, which need an
archive.org OCR importer with a chapter splitter.

## 12. Seventh pass — the Taoist shelf (23 October 2026)

Taoism held one work, the Daodejing. This pass compiles the rest of the shelf
from Legge's *Texts of Taoism* (SBE 39–40), Giles's Wisdom of the East volumes
and the Suzuki–Carus morality books.

| Work | Volume | Translator, year | Chapters | Passages | Words |
| --- | --- | --- | ---: | ---: | ---: |
| *Zhuangzi* | SBE 39–40 | James Legge, 1891 | 33 | 2,049 | 134,843 |
| *Liezi* | Wisdom of the East | Lionel Giles, 1912 | 7 | 454 | 22,950 |
| *Yang Chu's Garden of Pleasure* | Wisdom of the East | Lionel Giles, 1912 | 19 | 260 | 5,868 |
| *The Tai Shang Tractate* | SBE 40 | James Legge, 1891 | 1 | 24 | 2,544 |
| *The Classic of Purity* | SBE 40 | James Legge, 1891 | 1 | 23 | 763 |
| *The Yin Fu King* | SBE 40 | James Legge, 1891 | 1 | 21 | 881 |
| *Yin Chih Wen* | Open Court | Suzuki and Carus, 1906 | 1 | 63 | 946 |

This pass adds **seven works, 63 chapters, 2,894 passages and 168,795 words**.
The Sacred Text Archive shelf now holds **fifty-one works: 4,741 chapters,
129,889 passages and 5,458,132 words**. The library seeds **1,401 works, 2,305
editions and 1,474,996 passages**; Taoism now has eight works, seven with
running text.

### Structure worth knowing

- **The Zhuangzi is complete.** Legge's thirty-three books are read across the
  two volumes, one printed book per chapter. The archive's index mislabels Book
  XXIX ("The Robber Kih") as Book XXIV; the chapter label follows the book's own
  heading.
- **Two appendix pages needed a start marker.** Legge's *Classic of Purity* and
  *Yin Fu King* pages open with his introductory notice and close with
  footnotes. The importer's new `textStartMarker` begins the chapter at the
  translation and the work's `endMarker` stops it before the notes. The
  notices and notes stay in the printed volume.
- **The Liezi is Giles's selection of seven books**, with the Yang Chu book he
  published separately imported under its own record. The eighth book,
  "Explaining Conjunctions", is not in that translation.
- **The Tai Shang Tractate keeps Legge's marginal headings** where the archive's
  transcription places them inside the paragraphs; the Yin Chih Wen keeps the
  commentator's `CC` cross-references. Both are noted in the register.

Terebess Asia Online was checked as a second source and not imported: it mirrors
the same public-domain volumes and hosts modern translations in copyright. The
full account, the rights position and the remaining targets are in
[taoist-expansion.md](taoist-expansion.md).
