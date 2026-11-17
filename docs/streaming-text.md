# Streaming text

The library catalogues far more text than it holds. A **streamed work** stores its
catalogue record, chapter outline and passage index locally, and requests the
chapter text from the project that publishes it when a reader opens that chapter.
No fetched text is written to SQLite or to disk.

## What is stored

| Location | Holds |
| --- | --- |
| `data/registry/streams.json` | One entry per streamed work: provider, upstream id, chapter addressing mode, editions and provider options. |
| `data/corpus/works/<slug>.json` | The ordinary catalogue record, `chapters`, `passages`, edition provenance, and `textStorage: "streamed"`. No `editions[].texts`. |
| SQLite `work_streams` | The same manifest, seeded from `streams.json`, so the reader can resolve a work without reading a file per request. |
| SQLite `passages` | The reference index. This keeps `/read/<work>?ref=…`, bookmarks, themes, notes and comparisons stable while text is streamed. |
| SQLite `passage_texts` / `passage_fts` | Only locally held texts. No streamed work appears here. |

`server/stream.ts` fetches, normalises and caches chapters in memory (ten
minutes, 240 chapters, cleared on restart). Concurrent requests for the same
chapter share one upstream fetch.

## Providers

### Sefaria (`provider: "sefaria"`)

```
GET https://www.sefaria.org/api/v3/texts/{ref}?version={language}|{versionTitle}
```

- `language` is the English language name (`hebrew`, `english`), not the ISO code.
- `versionTitle` is pinned to the catalogue edition, so the reader never
  silently substitutes a different translation for the one named.
- Numbered works are addressed as `Title.chapter` (for example `Berakhot.2a`).
  Works with named sections are addressed as `Title,_Section` (for example
  `Zohar,_Introduction`). The entry records a hint; the provider tries the other
  form when the returned segmentation does not match the local passage count.
- Sefaria returns a string, a list of strings or a list of paragraph arrays.
  Each top-level element is one passage; nested arrays are joined.

### SuttaCentral (`provider: "suttacentral"`)

```
GET https://suttacentral.net/api/bilarasuttas/{uid}/{translator}?lang={pi|en}
```

The passage index stores SuttaCentral segment ids as passage labels. The
provider selects exactly those segments, keeping the Pali root text and the
English translation aligned even where one language has no text for a segment.

The Dhammapada uses the same provider with `config.mode: "dhammapada"`: each
vagga is a range (`dhp1-20` … `dhp383-423`) and the provider groups segments by
verse number so the passage order matches the catalogue.

### AlQuran Cloud (`provider: "alquran-cloud"`)

```
GET https://api.alquran.cloud/v1/surah/{surah}/{edition}
```

One request per surah per edition: `quran-uthmani` for the Tanzil Arabic and
`en.pickthall` for the public-domain English. Ayahs are returned in order and
map one-to-one onto the `surah.ayah` passage index.

### Bolls Bible API (`provider: "bolls"`)

```
GET https://bolls.life/get-chapter/{version}/{book}/{chapter}/
```

One chapter per book per edition: `KJV` for English, `WLC` (Hebrew) for the Old
Testament and `TR` (Greek) for the New. Verses come back in order and map onto
the `chapter.verse` index; Strong's-number markup is stripped without changing
the words.

### Hosted HTML (`provider: "ccel" | "newadvent"`)

Each chapter is one hosted page. `config.pages` is the page index built at
import, and `config.startMarker` / `endMarker` / `split` describe how that page
is cut into passages (`paragraphs`, `articles` or `sections`). The importer and
the reader call the same `extractHtmlSegments`, so a changed page produces an
alignment notice rather than a wrong reading.

### Internet Sacred Text Archive (`provider: "sacred-texts"`)

Each chapter is one static page on `archive.sacred-texts.com`, held in
`config.pages`. It uses the hosted-HTML reader with two additions for the
Sacred Books of the East: `config.startMarker` is `<HR></p>` on newer
transcriptions and a plain `<HR>` on older ones (chosen per volume at import),
and `config.dropPageNumbers` removes the printed `p. 12` / `{p. 12}` markers
and the rules between sections. A third form is used by the older Christian
transcriptions (Anselm, the Cloud of Unknowing), whose banner closes with a bare
`<hr/>` and runs straight into the text: the marker is the banner's own tail,
`at sacred-texts.com</font></p><hr/>`, and those volumes also set
`config.endMarker` to `<p><hr/>` so the inline `Next:` link before the site
navigation is not read as text. Chapter labels normally come from the volume
index; the Yasna takes them from each page's `h3` because the archive index is
misnumbered there. The Vinaya takes them from the printed chapter number on
each page, because its volume index restarts at Chapter 1 for every khandhaka
and repeats or skips a number in places. A page that is only a heading yields
that heading as its single segment.

Most pages of a volume open with the same rule, but the archive serves a few
older transcriptions whose text starts after a dotted rule (`<HR>.`). The
importer tries the volume's marker first and, if the page yields nothing,
falls back to the known alternatives; the page that needed a different marker
records it as `config.pages[n].startMarker`, and the reader uses it for that
page only. Jataka, volume III, page 414 is the present example. A range can
also ask for its labels to be shortened (`labelPattern`), because the Ante-Nicene Fathers
index truncates its own anchor text mid-word and prints a summary after the
chapter number. See `docs/sacred-texts-expansion.md`.

A few works are printed as one long page: Griffith's Samaveda, Macdonell's
Vedic Reader, and the volumes whose printed books are contents pages rather
than chapters. Two config forms cover them. `config.pages[n]` may carry
`from`/`to` segment indexes, so several chapters can be slices of the same
page — the importer splits the page at its printed headings and records the
slice each chapter occupies, and the reader takes the same slice after
extracting the page. And an archive index that links to contents pages (the
Atharvaveda's twenty books) is expanded at import time: the importer reads
each book page's body links and writes one chapter per hymn, so the reader
never has to know that the index was two levels deep.

### Hadith API (`provider: "hadith"`)

```
GET https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/{edition}/sections/{section}.min.json
```

One section per collection per edition. Arabic (`ara-bukhari`) and English
(`eng-bukhari`) editions share section numbering, so the panes line up. Empty
records are dropped on both sides; the passage index is built from the same
rule, so counts match unless the upstream section changes.

### Wikisource (`provider: "wikisource"`)

```
GET https://en.wikisource.org/w/api.php?action=parse&page={title}&prop=text&format=json&formatversion=2
```

One page per chapter, held in `config.pages`. `extractWikisourceSegments` keeps
prose paragraphs and poem lines (with their verse numbers), and drops running
heads, page-number placeholders and untranscribed-script placeholders. The
importer retries a throttled page rather than dropping it, because a missing
page would shift every later chapter number.

### Project Gutenberg (`provider: "gutenberg"`)

```
GET {config.textUrl}
```

The whole plain-text edition is fetched and split at the headings listed in
`config.anchors` (`marker`, optional `occurrence: "last"` for a heading that
appears in a table of contents too). `splitPlaintextChapters` requires the
heading to be a line of its own, and `plaintextParagraphs` cuts footnotes,
strips `=…=` and `_…_` emphasis marks and joins wrapped lines. The same two
functions run at import and at read time.

### OpenITI (`provider: "openiti"`)

```
GET {config.textUrl}
```

One mARkdown file holds a whole work. The file is fetched once, parsed with
`parseOpeniti`, grouped into chapters by the rule stored in `config.chapter`
(`{ mode: "level", level }` or `{ mode: "pattern", pattern }`), and cached for
30 minutes. The importer and the reader call the same `openitiChapters`
function, so the passage index and the served chapter use one grouping rule.
`PageV…`, `ms…`, `AUTO` and repeated-heading markers are removed; `~~` lines
continue the paragraph above them. See [`openiti-arabic.md`](openiti-arabic.md).

### Heritage Scripture Server (`provider: "heritage"`)

```
GET https://heritage.iitk.ac.in/api/v1/{text}/{ref}/moolam/
Authorization: Api-Key {key}
```

The Gita Supersite, built at IIT Kanpur and continued by Heritage IITKanpur,
serves its corpus from a documented REST API. Its catalogue and chapter
structure are open; the verses answer an API key that Heritage issues on request
(`/api/v1/request-access/`). The library holds the catalogue record, the chapter
outline and the address of every verse, and nothing else.

- `config.text` is the server's text code (`BG`), and
  `config.chapters[ref].verses` lists the addresses (`2.47`) the server publishes
  for that chapter. Each is read as `{text}/2/47/moolam/`.
- Verses are metered: moolam costs one unit a verse against a daily allowance of
  50 units on the Free tier. A verse once received is kept in a bounded
  in-process cache for six hours, so re-reading a chapter spends nothing; the
  text still never reaches SQLite or disk. A spent allowance answers 429, which
  is neither retried nor mistaken for a server fault.
- A chapter is assembled by address, not by arrival order: a verse the server did
  not serve leaves an empty place, and the notice says how many arrived and why
  the rest did not. The chapter is never closed up and renumbered.
- The notice carries the attribution HCAL-1.1 requires, and the server's own
  `_meta` licence and watermark are reproduced as they arrive.
- Without `HERITAGE_API_KEY` the reader shows the work's outline and says where
  the key comes from, rather than an empty page or a substitute text.

`bun run import:gita` rebuilds the catalogue, outlines and verse addresses from
the server's own listing. See [`heritage-expansion.md`](heritage-expansion.md).

## Search

Local texts are searched in `passage_fts`. Streamed Sefaria works are searched
through `https://www.sefaria.org/api/search-wrapper`; a result is only linked to
the reader when its reference exists in `passages`, and the remaining results
link back to Sefaria.

The search page can scope a query to one indexed shelf or provider. A scope
applies to `stream_fts` only: locally held editions and Sefaria's live results
are hidden, and every provider still returns a hit count for the same query and
catalogue filters. The API accepts:

```text
shelf=quran|hadith|suttacentral|openiti
provider=hadith,openiti
```

`shelf=quran` covers both AlQuran Cloud and the Quran.com tafsirs. `provider`
accepts a comma-separated list. `streamIndex.total` reports every matching
passage in scope; `streamIndex.hits` returns one page of twenty.

A scoped search pages the streamed index with `page=2`, `page=3`, and so on.
Without a shelf or provider scope, the local corpus keeps `page` and the
indexed stream uses `streamPage`, so the two result sets can be browsed
independently. `streamIndex` reports `page`, `pageSize` and `pages` alongside
`total`. Results are ranked by passage rather than by edition, so each page
contains twenty distinct passages even when the query matches several editions
of the same passage.

Exact provider counts are cached in `stream_count_cache`. The key combines the
index generation, the FTS match expression and the catalogue filters; a reindex
changes the generation and clears the old entries. The cache is bounded to the
500 most recent queries. This matters most for broad Arabic terms such as
`الله`: the exact count is still computed once, but changing page, provider or
shelf does not repeat the scan.

Single-term queries with at least 5,000 matches also use a ranked-scan fast
path. FTS returns ranked passage ids in chunks, duplicates from multiple
editions are removed as they appear, and excerpts are fetched only for the page
being shown. The fast path reads at most 50,000 raw rows; deeper pages fall back
to the partition query so the result set remains complete. The fallback and fast
path use the same rank and rowid ordering, so they return the same passages at a
page boundary.

Works whose provider has no search API can be indexed locally without storing
their display text. `bun run index:streams` asks the same chapter endpoints the
reader uses, maps every segment to the existing passage index and writes the
normalised text, prefix variants and a short excerpt to `stream_fts`. OpenITI is
fetched once per work because it publishes one mARkdown file; the other
providers are fetched chapter by chapter. Arabic pointing, Hebrew niqqud and
final letters, Greek accents and Latin diacritics are folded; Arabic and Hebrew
attached prefixes are indexed as separate token forms so `صلاة` matches
`الصلاة` and `ראשית` matches `בראשית`. The reader still fetches the chapter from
the host. The index covers OpenITI, the Hadith API collections, AlQuran Cloud,
the Quran.com tafsir resources and SuttaCentral. Sefaria is searched through its
live API instead. Wikisource, Project Gutenberg and Internet Archive works
remain browsable by catalogue record and passage structure but are not yet in
`stream_fts`. The Heritage shelf joins the run only when `HERITAGE_API_KEY` is
set, because metering makes an unkeyed rebuild nothing but a row of failures.

Provider groups keep the command short: `quran` means AlQuran Cloud plus the
Quran.com tafsirs. `--only` and `--provider` can be combined with
`--concurrency` (default 6) when rebuilding one shelf.

```sh
# Everything that can be indexed
bun run index:streams

# The three non-OpenITI shelves, fetched concurrently
bun run index:streams --provider=hadith,quran,suttacentral --concurrency=6

# One work
bun run index:streams --only=hadith-bukhari
```

## Adding a provider

1. Write a fetcher in `server/stream.ts` and add it to `STREAM_FETCHERS` under the
   provider's name. It returns the same `StreamedChapter` shape: one
   `StreamedEdition` per configured edition, each with `segments` in passage
   order, one segment per passage in the chapter.
2. Add the work entry to `streams.json` with `provider`, `upstream`, `mode`,
   `editions` (slug, language, `languageName`, version) and any `config` the
   provider needs.
3. Write the work's `chapters` and `passages` (structure only) and set
   `textStorage: "streamed"`. Do not write `editions[].texts`.
4. Add a textual-function classification, then reseed.
5. Add the provider to `PROVIDER_LABEL` so the reader names it.

## Commands

```sh
# Rebuild the Sefaria stream map from the corpus and the import manifests
bun run scripts/dev/build-stream-manifest.ts

# Strip text from streamed work files and register them (no row deletes)
bun run scripts/dev/stream-corpus.ts --json-only

# Import the Dīgha and Majjhima Nikāyas as streamed works
bun run scripts/dev/import-suttacentral-suttas.ts

# Import the Christian Bible, fathers, Summa and apocrypha as streamed works
bun run import:christian

# Import the eleven Sacred Books of the East volumes as streamed works
bun run import:sacred-texts

# Import the Heritage Scripture Server catalogue, outlines and verse addresses
bun run import:gita

# Import hadith, Muwatta, Sufi, kalam, falsafa and fiqh records
bun run import:islamic

# Rebuild the lean database
bun run scripts/seed.ts --reset
```

## Operational notes

- If a host is unavailable, the reader says so and offers a retry. It never
  falls back to a stale or different edition.
- The complete stream index adds roughly 300 MB to the database and takes a
  few minutes to build; it stores only normalised search text and a short
  excerpt, never the display edition. Rebuild it deliberately after reseeding.
- Sefaria and SuttaCentral are free services. A deployment that drew heavy
  traffic would need an arrangement with them rather than treating their APIs
  as unlimited.
- Sefaria's search index may return references that this catalogue does not
  index; those hits are linked to Sefaria instead of being guessed at.
