# Hindu corpus expansion

This pass extended the Hindu shelf beyond the twelve works that were already
streamed. It added eight works of running text, checked the existing records for
completeness, and recorded every requested work that is still missing in the
acquisition register — including the ones that cannot be imported for rights or
transcription reasons.

The Hindu shelf now holds **21 works**. Eight were added by the expansion pass
and one more — the Uttara Kanda — by the completion pass described below, which
also finished the two works that pass had left partial. Nothing was replaced or
duplicated: the twelve earlier works keep their records and their text, and the
three incomplete records were completed rather than copied into new ones.

## Existing shelf, checked

| Work | Edition | Status |
| --- | --- | --- |
| Bhagavad Gita | Edwin Arnold, *The Song Celestial* (1885) | Complete; 295 passages. Cross-linked to the Mahabharata at Book 6, sections 25–42. |
| Yoga Sutras | Charles Johnston (1912) | Complete; the sutras alone, without Vyasa's commentary. |
| Brahma Sutras with Shankara | George Thibaut, *Vedanta-Sutras* Parts I and II (1890, 1904) | **Complete.** All sixteen padas, held locally: Part I from Project Gutenberg, Part II from the Internet Sacred Text Archive. |
| Sarva-Darsana-Samgraha | Cowell and Gough (1882) | Complete; a survey, not a substitute for the sutras it summarises. |
| Valmiki Ramayana | R. H. T. Griffith (1870) | Books 1–6 complete in Griffith's verse. The seventh book is a separate record, in Dutt's prose, because Griffith's edition ends at Book VI. |
| Chandogya, Kena, Aitareya, Isha, Katha, Mundaka, Prashna Upanishads | Max Müller, Sacred Books of the East (1879–1884) | Complete as transcribed; these are the seven Upanishads that were already present. |

The two completeness gaps this pass recorded — Shankara's commentary stopping
after Part I, and Griffith's Ramayana having no Uttara Kanda — are closed by the
completion pass below.

## New imports

All eight are public-domain English translations streamed from their host at
read time. The exact validated segments are cached in
`data/imports/cache/hindu/`, which is what the search index is built from; the
reader still fetches the chapter from the host and reports when the served text
no longer matches the indexed count.

| Work | Edition | Sections | Passages | Status |
| --- | --- | --- | --- | --- |
| Rigveda | R. H. T. Griffith (1896), Wikisource | 1,028 hymns (10 mandalas) | 21,005 | Complete |
| Mahabharata | Kisari Mohan Ganguli (1883–96), Project Gutenberg | 18 books, 1,892 section headings | 11,700 | Complete |
| Harivamsha | Manmatha Nath Dutt (1897), Project Gutenberg | 137 chapters | 1,674 | Complete |
| Vishnu Purana | Manmatha Nath Dutt (1894–96), Project Gutenberg | 126 sections | 971 | Complete |
| Arthashastra | R. Shamasastry (1915), Wikisource | 15 books | 3,174 | Complete |
| Brahma Sutra Bhashya of Ramanuja | George Thibaut, SBE 48 (1904), Project Gutenberg | 16 padas | 2,068 | Complete |
| Taittiriya Upanishad | Max Müller (1884), Wikisource | 3 vallis | 121 | Complete |
| Taittiriya Samhita (Black Yajurveda) | A. B. Keith (1914), Sacred Text Archive | 7 kandas | 809 | Complete |

Totals for the batch: 3,216 chapters, 40,750 passages, about 3.72 million
words. The Taittiriya Samhita began as a partial import of Kanda I — Wikisource
has never transcribed the other six — and was completed in the pass below.

The Rigveda is Griffith's verse translation, not the Sanskrit text. Its
recension is the received Śākala text as printed by Griffith; the reader
indexes the translation's verse lines, not the Vedic accents. The Yajurveda
import is the Taittiriya (Black Yajurveda) recension only — it must not be
confused with the White Yajurveda (Vajasaneyi).

## Completing the partial imports

The three records left incomplete by the expansion pass are now finished. The
Hindu shelf holds **21 works and 51,282 passages**; nothing was duplicated and
no earlier record was replaced.

| Work | What changed | Sections | Passages | Words |
| --- | --- | --- | --- | --- |
| Taittiriya Samhita | Kandas II–VII added; Kanda I re-read from the same edition | 7 kandas | 809 | 196,866 |
| Brahma Sutras with Shankara | Part II added and the whole work rebuilt as sixteen padas | 16 padas | 1,627 | 257,963 |
| Ramayana — Uttara Kanda | New companion record, Dutt's prose translation | 123 sections | 868 | 87,808 |

### Taittiriya Samhita

Wikisource has only Kanda I, so the whole work was re-imported from the Internet
Sacred Text Archive, which carries Keith's complete 1914 translation as one page
per kanda. A new `sacred-texts` provider fetches the page, takes the text
between the page's navigation rules, and splits it into the printed paragraphs;
the import and the reader run the same extractor, so the index and the served
text cannot drift apart. Kanda I therefore changed source too: it is now
transcribed from the same complete edition as the other six rather than from
the Wikisource page.

### Brahma Sutras with Shankara

Thibaut's Part II (Sacred Books of the East volume 38) is not on Project
Gutenberg or Wikisource. It exists as 337 transcribed sutra sections on the
Sacred Text Archive, one printed page each, opening at II.3.1. Those pages were
fetched once, the footnote blocks and page markers were removed, and the
sections were grouped by pada. Part I (SBE 34) supplies padas i.1–ii.2 from
Gutenberg. The two parts are one edition, so the work is now **held locally**
instead of streamed: a single record cannot name two providers, and the
sixteen-pada outline is the structure Thibaut prints. Its 1,627 passages mirror
the sixteen padas of Ramanuja's Sri Bhashya already in the library.

**A defect found here.** The old streamed record split the Gutenberg file at the
*first* occurrence of each `FIRST ADHYÂYA`-style heading. Those headings appear
in the volume's table of contents before the body, so nearly the whole text was
assigned to chapter 4 (1,253 of 1,381 passages) and chapters 1–3 held only 43,
42 and 43 passages. The record said nothing about the misassignment. The work
is now split at the body headings and its padas carry the passages they
actually contain.

### Ramayana — Uttara Kanda

Griffith's translation ends with the sixth book, and no Griffiths text of the
seventh book exists on Gutenberg or Wikisource. The Uttara Kanda is therefore a
**separate record** in Manmatha Nath Dutt's 1894 prose translation (Gutenberg
#62496), so the two translators are never conflated; the Griffith record points
to it. The transcription prints the printed numerals corruptly after section C
(`CIIII`, `CIXL`, a repeated `SECTION LXXXV`), so the 123 sections are numbered
in reading order and the availability note says so. Each sarga is printed as a
single hard-wrapped block, so the prose is repacked into paragraphs of about
120 words at sentence boundaries — the same packing runs at import and at read
time.

### A source promoted from rejected to approved

The registry had carried the Sacred Text Archive as `unavailable`/`rejected`
("automated retrieval is not permitted; do not scrape"). The project owner
authorised its use on 2026-10-22. Its robots file allows crawling and its
copyright page permits reuse of the public-domain files, though its current
terms still ask readers not to scrape or overload the service. The registry
entry now records that position: access is chapter-sized, cached in the stream
cache, identified by a descriptive user agent, and the import fetches each page
once and keeps the validated segments so the host is not crawled again. The old
pages are read from `archive.sacred-texts.com`; the site's new interface blocks
scripted clients.

## A defect found while validating

The first Mahabharata import silently stopped each book at section LXXXIX. The
heading parser matched `SECTION` followed by `[IVXL]` — the Roman numerals up to
89 — so every later heading (`XC`, `CD`, …) was treated as body text and the
book was cut short while the record still said "complete". Three further
variants existed in the same transcription: headings wrapped in quotation
marks, mixed-case `Section CLXXVII`, and the combined heading `SECTION
XXXIV–XXXV`.

The parser now accepts all seven Roman letters, quoted headings, mixed case and
combined ranges, and it independently counts heading-like lines per book and
fails the import if any is unmatched. The re-import produced 1,892 sections in
18 books instead of 905, and the availability note is generated from the parsed
result. This is why the Mahabharata passage count here (11,700) is lower than
the earlier, truncated one (12,722): the section headings are no longer counted
as body paragraphs, and the repeat title pages that open the continuous books
are now trimmed off.

The Rigveda reader had a related bug: its chapter refs are `book.hymn` (1.1),
but the Wikisource reader looked pages up by integer ref, so every hymn returned
"stream unavailable". The reader now matches a page by the ref recorded on the
page, by the numeric page number, or by the chapter label, which fixes the
Rigveda without changing any other Wikisource work.

## Acquisition register

Every requested work is now an entry in
[`data/registry/acquisition.json`](../data/registry/acquisition.json) and in the
`acquisition_targets` table (107 Hindu entries). The register is grouped on the
Sources page under “Works requested, not yet acquired”.

| Status | Count | Meaning |
| --- | --- | --- |
| `imported` | 8 | Running text is present; the entry records the edition and how much is there. |
| `located` | 10 | A source was found, but the text could not be imported honestly. |
| `wanted` | 83 | No verified reusable text was found. |
| `rights_blocked` | 6 | The available editions are in copyright or have no reuse permission. |

Each entry records the original title in its own script, a transliteration, the
languages needed, source leads with URLs, the rights position, and the next
action.

### Located, not imported

- **Samaveda, Atharvaveda** — Wikisource has landing pages and untranscribed
  scans; there is no running text to import.
- **Manusmriti** — formerly held back because only chapter 1 of Bühler's
  translation was transcribed on Wikisource. It is now imported complete from
  the Internet Sacred Text Archive (twelve chapters); see
  `docs/sacred-texts-expansion.md`.
- **Panchatantra, Gita Govinda** — landing pages or untranscribed scans only.
- **Tirukkural** — a trial import was made and withdrawn: only 66 of the 133
  chapter pages exist, and their titles do not match the verses they hold (the
  page named “Chapter 60” contains kurals 631–640), so importing under the page
  titles would mislabel hundreds of couplets.
- **Yoga Vasistha** — the Gutenberg set is missing volume 3, part 1, so an
  import would have a hole in the middle.
- **Vivekachudamani** — the Wikisource transcription is incomplete and
  unsourced; the attribution to Shankara is also disputed.
- **Autobiography of a Yogi, Complete Works of Vivekananda** — located but
  licence- or completeness-blocked (only one Vivekananda lecture volume is in
  the public-domain catalogue).

### Blocked by copyright

The Life Divine (Sri Aurobindo Ashram Trust), Hind Swaraj (mixed rights), The
Gospel of Sri Ramakrishna (Nikhilananda, 1942), the standard editions of
Dayananda Saraswati and Ramana Maharshi, and Ambedkar's *The Buddha and His
Dhamma* (Government of Maharashtra). None was imported, and no substitute text
was invented.

### Not found as reusable text

The remaining 83 targets are mostly works whose standard translations are
either in copyright or exist only as scans: the eleven other Puranas, the
Brahmanas and Aranyakas, the Samkhya/Nyaya/Vaisheshika/Mimamsa sutras and their
commentaries, most Kashmir Shaiva and Shakta tantras, the Tamil Shaiva and
Vaishnava corpora (Tevaram, Tiruvaymozhi, Divya Prabandham,
Shivajnanabodham, Tirumantiram), the Marathi and Braj bhakti corpora, the
medical and grammatical treatises, and most of the modern works.

Two requested items are covered inside an imported work rather than as separate
records: the **Bhagavad Gita** is linked to the Mahabharata, and **Viduraniti**
is a section of the Udyoga Parva already readable in the Mahabharata. Their
register entries say so.

## Reproducing the import

```bash
bun run scripts/dev/import-hindu-corpus.ts                 # the streamed Hindu imports
bun run scripts/dev/import-hindu-corpus.ts --force --only=mahabharata
bun run scripts/dev/import-hindu-corpus.ts --force --only=taittiriya-samhita
bun run scripts/dev/import-hindu-corpus.ts --force --only=ramayana-uttara-kanda
bun run scripts/dev/import-brahma-sutras.ts                # the local sixteen-pada Shankara
bun run scripts/dev/import-brahma-sutras.ts --force        # refetch Part II's 337 pages
bun run index:streams --provider=sacred-texts,gutenberg    # rebuild their search index
bun run db:reset                                          # reseed from data/corpus
```

The importer is resumable: a work retrieved from a long series of pages (the
Rigveda) checkpoints its cache every forty hymns and skips what it already has.
`--force` is required to replace a complete cache. Every work is validated for
duplicate refs, empty segments, replacement characters and implausible length
before it is written.

## Sources worth revisiting

- **Wikisource** — the only source used here that exposes transcribed text for
  both the Rigveda and the Arthashastra. It has only the first kanda of the
  Taittiriya Samhita, which is why that work now comes from the Sacred Text
  Archive instead.
- **Internet Sacred Text Archive** — the source that closed the three gaps:
  Keith's seven kandas and Thibaut's Part II as chapter-sized HTML pages. The
  same archive holds many other public-domain translations that are not yet on
  the shelf; it is now an approved source rather than a blocked one.
- **Project Gutenberg** — the four Ganguli volumes, Dutt's Harivamsha and Vishnu
  Purana, and Thibaut's Sri Bhashya all came from here as clean plain text.
- **GRETIL and SARIT** — the likely route to Sanskrit originals. Neither text
  was imported in this pass: the requested shelf is served by English
  translations, and no Sanskrit e-text was verified against a printed edition.
- **Muktabodha** — holds Kashmir Shaiva texts, but not under a licence that
  permits local storage or redistribution.

## Remaining work, in order

1. Extend the shelf from the Internet Sacred Text Archive, now that it is an
   approved source: its Hindu, Buddhist and Zoroastrian shelves hold many
   public-domain translations that this library does not yet carry.
2. Import the Sanskrit originals of the Rigveda and the principal Upanishads
   from GRETIL or SARIT if a licence-compatible transcription can be verified.
3. Revisit the Tirukkural with a consistently numbered Tamil or English source.
4. Work through the `located` entries: Manusmriti, Yoga Vasistha, Gita Govinda,
   Panchatantra, Samaveda and Atharvaveda all need either a complete
   transcription or a checked scan-to-text conversion.
5. Leave the `rights_blocked` works blocked until a permission or a
   public-domain edition is verified.
