# Christian Classics Ethereal Library (ccel.org)

The Christian Classics Ethereal Library is the largest free collection of
classic Christian literature on the web: **1,322 works** in its title index,
from the Ante-Nicene, Nicene and Post-Nicene Fathers through the medieval
mystics, the Reformers, the Puritans, the sermons, the hymnals and forty-odd
English Bibles, transcribed from public-domain printings and given away to read.

This pass differs from the ctext one in kind. ctext's terms forbid bulk
retrieval, so three works are streamed chapter by chapter from the site. CCEL
publishes **one plain-text file per work** and asks only for a polite crawl
(ten seconds between requests), so the whole catalogue can be acquired, and each
work is **stored in the library** and read without asking ccel.org again.

## 1. The site and its terms

`https://ccel.org/robots.txt` states:

```
User-agent: *
Crawl-delay: 10
Disallow:
```

Nothing is disallowed and every agent is asked for ten seconds between
requests. The importer obeys that by construction:

- one request every ten seconds or slower (`CCEL_DELAY_MS`, or `--delay=`, can
  raise the gap and never lower it below 10,000 ms);
- a descriptive user agent naming the library and the import;
- one request per work — the plain-text file carries the whole work — rather
  than one per chapter;
- a state file, so a work already imported is never fetched twice, and a text
  cache, so a re-registration costs no request at all;
- the site's own rights statement, read from each file's catalogue card, decides
  what is kept: a card that names a rights position other than public domain is
  recorded as a lead and the text is **not** reproduced.

The plain text of a work is public domain where the site says so; the site's
transcription is its own work, and every imported record credits it.

## 2. The catalogue

The catalogue comes from the site's own browse indexes — the title index A–Z,
the author index A–Z, and the eighteen genre pages — cached under
`data/imports/cache/ccel/index/`.

```bash
bun run import:ccel --catalogue    # 71 requests, about twelve minutes
```

| | Count |
| --- | ---: |
| Works in the title index | 1,322 |
| Authors in the author index | 454 |
| Genres | 18 |
| Works the genre pages give a shelf | 818 |

The catalogue is kept at `data/imports/ccel-catalogue.json` with every work's
path on the site, its title, its genres and the plain-text address the importer
will try, and the author index at `data/imports/ccel-authors.json`.

The genre pages give each work its shelf in this library:
*Early Church* → patristics, *Commentaries*, *Sermons*, *Mysticism*,
*Theology*, *Bibles*, *Creeds and Catechisms*, *Hymns and liturgical books*,
*Christian Life*, *Apologetics*, *Biographies*, *Histories*, *Philosophy*,
*Prayer*, *Reference* and *Fiction*, and each shelf writes the matching
text-functions for the work.

## 3. Reading a CCEL plain-text file

`server/ccel.ts` reads the file the site publishes at
`https://ccel.org/ccel/a/<author>/<work>/cache/<work>.txt`. Four things divide
such a file, and the reader handles all four:

| What the file holds | How it is read |
| --- | --- |
| A catalogue card: `Title:`, `Creator(s):`, `Print Basis:`, `Rights:`, `CCEL Subjects:` | Read for provenance, then dropped. Its `Print Basis` and `Rights` go into the edition's record and its attribution. |
| The site's index of scripture references at the end | Cut at its heading. Prose that merely ends in the word `Index.` is text and stays: the cut needs a whole short line naming what is indexed (`Indexes`, `Index of Scripture References`). |
| Headings: `BOOK ONE`, `CHAPTER I`, `Chapter I.`, `Sermon 12`, `Psalm 23`, `THE APOLOGY` | A division of the work. A heading must stand between blank lines, so a wrapped sentence that begins with a division's word (`Chap. v. §1) Kölling's Geschichte der Apologetik …`) is text. A line's own numbering (`II.`, `Apology.`, `1. The date of the Apology`) is not a heading. |
| The site's XML section markers, kept by some files: `tertullian apology anf03 tertullian-apology The Apology` above `/ccel/schaff/anf03.iv.i.html` | The divisions of a collected volume. The section's title is read from the line above the marker (and from the marker line itself when the title wrapped in print), and the marker's own metadata line is taken back out of the text. |
| Bible files: `Genesis 1` above verses marked `^1`, `^2`, … | Chapter and verse. Each `^n` marker opens a verse and the print edition's own number before it is dropped. |

A chapter is named for the division it stands in, as the library's other works
name theirs: `BOOK ONE` is carried into the chapters beneath it, so a chapter is
`Book One, Chapter I` and not a bare `CHAPTER I`; in a volume, `The Apology,
Chapter I`. Chapter-and-paragraph works use `refScheme: "chapter.paragraph"`
with labels `Book One, Chapter I §3`; Bible files use `refScheme:
"chapter.verse"` with chapters `Genesis 1` and passages `Genesis 1:1`, the
convention the library's other Bible books already use. A division with no text
under it — a title page, a rule — is dropped.

Five files, read whole, as the reader leaves them:

| Work | Chapters | Passages | Words | Scheme |
| --- | ---: | ---: | ---: | --- |
| Augustine, *Confessions and Enchiridion* (Outler) | 290 | 1,405 | 136,616 | chapter.paragraph |
| *ANF* 3, Tertullian (whole volume) | 774 | 11,185 | 617,144 | chapter.paragraph |
| *NPNF* 2-04, Athanasius (whole volume) | 109 | 9,036 | 660,483 | chapter.paragraph |
| Aquinas, *Summa Theologica* (Benziger 1947) | 589 | 37,398 | 2,557,053 | chapter.paragraph |
| *American Standard Version of the Holy Bible* (1901) | 1,181 | 31,101 | 370,080 | chapter.verse |

## 4. What is imported

```bash
bun run import:ccel --all              # walk the catalogue; hours, and resumable
bun run import:ccel --limit=50         # the next fifty works
bun run import:ccel --genre="Sermons"  # one of the site's shelves
bun run import:ccel --path=tertullian/apology
bun run import:ccel --from-cache       # re-register the texts already on disk
bun run import:ccel --list             # the manifest, the leads and the crawl state
```

**The pass is long and was still running when this was written** — 1,322 works at
ten seconds a request is about four hours, and a run can be stopped and restarted
at any point (see §7). The snapshot below is the state at the last checkpoint, and
`bun run import:ccel --list` prints the live figures.

At the checkpoint, 78 of the 1,322 catalogue works had been read: **45 imported,
34 leads**.

| Shelf | Works | Chapters | Passages | Words |
| --- | ---: | ---: | ---: | ---: |
| Christian texts | 24 | 2,832 | 72,942 | 4,274,701 |
| Commentaries | 5 | 264 | 56,169 | 2,978,640 |
| Christian mysticism | 3 | 452 | 3,622 | 408,924 |
| Biographies | 3 | 78 | 2,793 | 255,508 |
| Christian life | 3 | 48 | 988 | 94,635 |
| Church history | 2 | 132 | 1,260 | 138,687 |
| Scripture | 1 | 1,181 | 31,101 | 370,080 |
| Sermons | 1 | 35 | 250 | 31,438 |
| Christian fiction | 1 | 9 | 7,753 | 353,067 |
| Patristic theology | 1 | 1 | 280 | 1,120 |
| Hymns and liturgy | 1 | 3 | 439 | 2,482 |
| **Imported at the checkpoint** | **45** | **5,035** | **177,597** | **8,909,282** |

The largest of them: Barnes' *New Testament Notes* (259 chapters, 2.8 million
words), *ANF* 3 Tertullian (774 chapters, 617,144 words), *ANF* 5 (322 chapters,
612,603 words), *ANF* 4 (839 chapters, 590,830 words), and Smith's *Dictionary of
the Bible* (575,459 words).

Each imported work gets an ordinary corpus record: its chapters and passages,
and one edition holding the text itself, so `bun run db:reset` writes it into
`passage_texts` and the full-text index, and the reader needs no network. There
is **no entry in `data/registry/streams.json`** for these works — the library
holds the text, so there is nothing to stream.

Provenance per record:

- **The site's card** supplies the print basis and the rights statement; both
  are recorded on the edition, and the print basis also in the work's
  historical context. A translator named on the card or in the front matter
  (`Translated by …`) is recorded as the edition's translator.
- **The genre** the site files the work under sets its category, school and
  text-functions.
- **The site's author index** supplies the person: name, sort name and years.
  A person the corpus did not know is added to `data/corpus/meta.json`, because
  a work whose author is unregistered fails the corpus validation and would
  stop `db:reset`.
- **The acquisition register** is updated where it already had a target for the
  work, and left alone where it did not: the register records works *requested*
  and not yet held, and this pass adds no new requests.

## 5. What is recorded as a lead instead

The importer writes no record for a work it cannot hold honestly, and records
the work as a lead in `data/imports/ccel.json` with its path, its title and the
reason. The reasons, in the order they are tested:

| Reason | What it means |
| --- | --- |
| `already held` | The library already has the work — either the same title (`tertullian/apology` against the streamed `tertullian-apology`) or another edition of it (the five books of `irenaeus/against_heresies_*` against `irenaeus-against-heresies`). Nothing is written twice. |
| `no text of its own on the site` | The plain-text file the site serves for this catalogue entry is its **volume's** text: `anonymous/acts_xanthippe` is a chapter of ANF09 and its `cache/acts_xanthippe.txt` is the whole of ANF09. The work's page is the edition's, so its text is read in the volume, which is imported in its own right. |
| `rights not public domain` | The site's card names a rights position other than public domain. The text is not reproduced. |
| `no plain text on the site` | The work is catalogued and offered as a PDF or an ebook only. |

A file whose card states no rights field at all is imported, with the silence
recorded on the edition: ccel.org's own copyright page records its books as
public domain, with a few carried by a publisher's permission and marked as
such on their cards.

## 6. Why the plain text and not the site's pages

The library already streams seventeen Christian works from ccel.org, and those
streams read the site's HTML: `augustine-confessions` holds 276 page addresses,
`origen-against-celsus` 623, `aquinas-summa-theologica` (from New Advent) 611.
That route keeps the site's own page divisions and fetches each chapter when a
reader opens it, but registering one work means fetching every page — hundreds
of requests per work, and tens of thousands for the catalogue. At ten seconds a
request it is not a crawl this library could finish.

The plain-text route costs **one request per work** and stores the whole text,
which is what makes a pass over more than a thousand works possible at all. Its
price is that the divisions are the ones the plain text keeps: a volume of
collected works whose printed text carries no headings is imported as it stands
(complete, and searchable, but with a coarse chapter list), and the works inside
it are also catalogued separately by the site, so their own texts are imported
in their own right wherever the site publishes one.

## 7. Reproducing and verifying

```bash
bun run import:ccel --catalogue           # the indexes, once (about twelve minutes)
bun run import:ccel --all                 # the works; hours; safe to stop and restart
bun run import:ccel --list                # works, leads, crawl state
bun run import:ccel --from-cache --force  # re-read every cached text, no requests
bun run db:reset                          # write the corpus into SQLite
bun test                                  # includes the reader's own tests
```

A run can be stopped at any point. The manifest, the function map, the author
list, the crawl state and the acquisition register are written every ten works,
and a run repairs itself on start: a work whose text is on disk but whose
manifest record is missing (a run cut short) is read back from the corpus, so a
stopped crawl costs nothing but the time it ran.

`bun run import:ccel --list` prints the manifest, the leads by reason and the
crawl state. In the app, the imported works appear on the Christian shelves
under their category — *Patristic theology*, *Sermons*, *Christian mysticism*,
*Scripture*, *Hymns and liturgy* — with the CCEL named as the source of the
text and the site's card's print basis in the record, and a search for a phrase
from any imported work reaches it from the local full-text index, without a
request to ccel.org.

## 8. What this pass does not settle

- **The rights-silent works.** Cards written before the site recorded rights
  say nothing, and those works are imported on the site's stated default. The
  manifest marks them (`rightsUnstated: true`) so an editor can review them
  against the printings if the library ever needs the position stated work by
  work.
- **Coarse chapters in a few volumes.** A collected volume whose plain text
  keeps no headings is one long chapter; the fix is the site's own page
  divisions, which the existing `ccel` stream provider can read — but only at
  the cost of registering hundreds of pages per volume.
- **Editions, not the text as printed.** The library takes the site's
  transcription as it stands, including its editorial notes, without collating
  it against the printed edition named in the card.
