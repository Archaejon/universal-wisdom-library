# Chinese Text Project (ctext.org)

The Chinese Text Project is the largest free library of pre-modern Chinese on
the web: a catalogue of **49,647 works**, from the Confucian classics and the
histories to the Siku Quanshu and the site's own wiki of collected editions,
each transcribed with modern punctuation and linked to a dictionary, a
concordance and the commentaries that gloss it. It is the natural Chinese
counterpart to GRETIL: where GRETIL transcribes Sanskrit editions, ctext
transcribes the Chinese canon.

This dive came back with **three works, 72 chapters and 2,954 paragraphs (about
178,000 characters)** of Chinese text, the **whole catalogue** recorded locally,
and a hard wall around the rest: the site now refuses every page request from
this network. Both halves are documented here, because the second is the reason
the first is not larger.

## 1. The site and its terms

ctext.org (Donald Sturgeon's project) states its terms in its FAQ and enforces
them in its server: the use of **automatic download software is strictly
prohibited**, a crawler should wait about **two seconds between requests**, and
bulk access is meant to go through the site's API or an institutional
subscription. The pre-modern text itself is out of copyright; the transcription,
the punctuation, the apparatus and the site's own English translations are the
project's editorial work. The library therefore streams one chapter at a time
and credits the project on every page.

The import obeys those terms by construction:

- one request every two seconds or slower (`CTEXT_DELAY_MS` can raise the delay,
  never lower it below 2000 ms);
- a descriptive user agent naming the library and the import;
- a state file, so a work already imported is never fetched twice;
- no downloads of whole canons, and no attempt to work around a refusal.

`data/registry/sources.json` holds the source record (`source_id: ctext`), with
the attribution requirement and the rate limit written into it, and
`data/corpus/meta.json` registers the licence it is displayed under,
`ctext-site-terms` (streamed, not relicensed).

## 2. The catalogue

The one API function ctext serves without a key or a registered IP is
`gettexttitles`, and it returns the site's **entire index in a single answer**:

```bash
bun run import:ctext --catalogue   # one request to api.ctext.org/gettexttitles
```

| | Count | What it is |
| --- | ---: | --- |
| Catalogue | 49,647 | every book the site lists, title and URN |
| Canonical books (`ctp:<stem>`) | 139 | the classics, histories, philosophers, ritual and medical canons, poetry anthologies and novels the site presents under its own names |
| Library and wiki texts (`ctp:wb…`) | 49,508 | the Siku Quanshu, collected editions, local gazetteers and the site's scanned-library texts |

The catalogue is kept at `data/imports/ctext-catalogue.json` (3.8 MB) with the
split recorded in it, so the next pass does not have to ask the site again, and
`bun run import:ctext --catalogue` refreshes it. The 139 canonical books are the
shelf the library actually wants; the 49,508 wiki texts are mostly rare editions
of works already represented, and are the part the site guards most closely.

Of the 139 canonical books, **eight already have a record in the library** and
**131 are still to be acquired**:

| Already carried (from other sources) | ctext book |
| --- | --- |
| `analects` (Legge, English and partial Chinese), and now `analects-zh` | 論語 |
| `mencius` (Legge, English), and now `mengzi-zh` | 孟子 |
| `li-ki-i` / `li-ki-ii` (Legge, English), and now `liji-zh` | 禮記 |
| `zhuangzi` (Legge, English) | 莊子 |
| `tao-te-ching` (Wang Bi text and Legge's translation) | 道德經 |
| `book-of-poetry`, `shih-king` (English) | 詩經 |
| `book-of-filial-duty`, `hsiao-king` (English) | 孝經 |
| `liehzi` (English) | 列子 |

The rest — 尚書, 儀禮, 周禮, 春秋左傳, 荀子, 墨子, 韓非子, 淮南子, 史記, 漢書,
國語, 戰國策, 楚辭, 全唐詩, 太平御覽, 通典, 黃帝內經, 說文解字, the novels, the
Buddhist and Daoist collections — are catalogued on the site and reachable in
principle, but not from here (see §5).

## 3. What is imported

| Work | Slug | Chapters | Paragraphs | Characters | ctext path |
| --- | --- | ---: | ---: | ---: | --- |
| Analects — the Chinese text | `analects-zh` | 20 books | 503 | 21,503 | `analects` |
| Mengzi — the Chinese text | `mengzi-zh` | 14 books | 690 | 44,845 | `mengzi` |
| Book of Rites — the Chinese text | `liji-zh` | 38 chapters | 1,761 | 111,508 | `liji` |

All three sit on the Confucian shelf (`tradition: confucianism`, `school:
confucian`, category *Confucian classics*), carry the Chinese title and
transliteration, the traditional attribution and a description written for this
catalogue, and are marked as the original language alone — no translation is
claimed for them.

What the reader gets is ctext's punctuated transcription, chapter by chapter:

| Work | Opening of the first chapter |
| --- | --- |
| Analects | 子曰：「學而時習之，不亦說乎？有朋自遠方來，不亦樂乎？…」 |
| Mengzi | 孟子見梁惠王。王曰：「叟不遠千里而來，亦將有以利吾國乎？」 |
| Book of Rites | 《曲禮》曰：「毋不敬，儼若思，安定辭。」安民哉！ |

The chapters keep the site's own division and its English gloss of each title
(`學而 (Xue Er)`, `梁惠王上 (Liang Hui Wang I)`, `曲禮上 (Qu Li I)`); the passages
are the site's paragraphs, numbered `chapter.paragraph`.

These three complete classics whose English the library already held: Legge's
*Mencius* (28 chapters, 1,003 paragraphs) and his *Book of Rites* in two volumes
now have the Chinese beside them, and the Analects gains the complete punctuated
Chinese — the sacred-texts edition carries the archive's Chinese for the first
ten chapters of each book only.

## 4. How a ctext work is read

The text is not copied into the corpus. `data/registry/streams.json` holds, for
each work, the provider (`ctext`), the site path, and one section per chapter
recording the reading page and the paragraph range within it. The reader asks
ctext.org for the chapter when a reader opens it, strips the site's navigation,
notes and apparatus from the page, keeps the Chinese paragraphs, and checks the
count against the indexed passages — a page that has changed upstream is
reported rather than silently re-indexed.

`data/imports/cache/ctext/<slug>.json` holds the paragraphs the import
validated. The search index is built from that cache (`bun run index:streams`),
so full-text search reaches the Chinese without touching the site, and the
reader falls back to it when ctext cannot be read at all:

> ctext.org could not be read from this network, so the chapter is shown from
> the transcription validated at import time and held in the library's own
> cache. The Chinese Text Project is credited as its source.

That fallback is not decoration. Without it, a network ban (§5) would leave the
three works in the catalogue with nothing to show.

## 4a. Chinese in the search index

FTS5 has no word segmentation for Chinese: a run of characters is one token, so
before this pass a reader searching 君子 would have had to type the whole
sentence it stands in to match anything, and a two-character query fell through
to a substring scan that only the local corpus could answer. `indexText` now
writes the character **bigrams** of every CJK run beside the run itself, and a
CJK query is reduced to the same bigrams (`cjkBigrams`, `phraseFor` in
`server/text.ts`). Two characters is both the smallest unit a bigram gives and
the smallest query the search accepts, so 君子, 梁惠王 and 曲禮 reach the
passages that contain them, in the streamed index and the local one alike. The
indexes must be rebuilt (`bun run db:reset`, `bun run index:streams`) for an
older build to gain the bigrams.

## 5. The wall

Partway through the first pass the site stopped answering:

```
HTTP/1.1 403 Permission denied
<title>Access unavailable</title>
Access to ctext.org is unavailable from your current location.
Please note that the use of automatic download software on this website is
strictly prohibited.
```

The block is **per network, not per page**: the home page, a work page and every
chapter page all answer 403 with that body, at any rate. ctext offers a
ban-removal form (`https://ctext.org/requestaccess.pl`) for exactly this case,
and points networks that need bulk access at an institutional subscription
(`https://ctext.org/tools/subscribe`).

The API tells the same story:

| Request | Result |
| --- | --- |
| `GET https://api.ctext.org/gettexttitles` | `200`, 4.4 MB — the whole index |
| `GET https://api.ctext.org/gettexttitles?urn=ctp:analects` | `ERR_INVALID_PARAM` — `urn` is not a parameter of that function |
| `GET https://api.ctext.org/gettext?urn=ctp:analects/xue-er` | `ERR_REQUIRES_AUTHENTICATION` — *"access the API from a registered IP address or supply a valid API key"* |

So the catalogue is public and the text is not: reading the text through the API
needs an API key or a registered IP (`https://ctext.org/tools/subscribe`), and
reading it through the pages needs the ban lifted. Neither is something an
importer should try to route around — the site's terms forbid exactly that — so
the importer now stops instead:

- a 403 whose body carries `Access unavailable` is treated as a network ban, is
  **not** retried, and ends the run with the reason printed;
- no further request is attempted in that run, so a crawl cannot spend hours
  walking 49,647 URLs into the same wall.

## 6. Imported, compared, and not kept

The first pass also imported **道德經** (`dao-de-jing`, 81 paragraphs, 5,415
characters). It was compared with what the library already holds —
`tao-te-ching`, the Wang Bi text with Legge's translation opposite it — and the
recension is the same 81-chapter classic. A second record of the same work would
have shown up beside the first in every listing and every search for "Dao", so
the record was dropped and the comparison recorded here: the passage is
attributed, the work is not duplicated. Its crawl-state entry is kept in
`data/imports/ctext-state.json` with that note, so a later `--all` run does not
re-import it by accident.

## 7. What would unlock the rest

In the order worth trying:

1. **Lift the ban.** `https://ctext.org/requestaccess.pl` — the form the 403 page
   links. Page access then works exactly as it did for the three works imported.
2. **Read through the API.** Register an IP or ask for an API key
   (`https://ctext.org/tools/subscribe`), then `gettext?urn=ctp:<book>/<chapter>`
   returns the paragraphs of a chapter as JSON with their URNs. An API key would
   also be the polite way to walk the 139 canonical books: one request per
   chapter, two seconds apart.
3. **An institutional subscription**, if this grows into something a library
   should host rather than one reader should politely crawl.

Scale, honestly: the 139 canonical books are perhaps 3,000–5,000 chapter pages.
At two seconds a request that is **two to three hours of wall clock** — an
afternoon, done in batches. The 49,508 wiki texts are another matter entirely:
tens of thousands of pages, and the part of the site the terms guard hardest.
"All texts" in one pass is not a polite request to make of this site; a
shelf-by-shelf pass over the canonical 139 is.

## 8. Another route for volume

If the goal is the largest possible Chinese corpus rather than this particular
site, **Kanripo** (kanripo.org) publishes its transcriptions as Git repositories
under **CC BY-SA 4.0**, including the Buddhist, Daoist and classical canons, and
is built for bulk download in a way ctext is not. It is a different corpus with
different editions and different terms; it has not been imported here, and a
switch to it would be a corpus decision, not a crawl.

## 9. Reproducing

```bash
bun run import:ctext --catalogue           # the whole index, one request, no key
bun run import:ctext --urn=ctp:shang-shu   # one canonical book (needs page access)
bun run import:ctext --all --limit=20      # walk the catalogue, next 20 works
bun run import:ctext --from-cache          # re-register what the cache already holds
bun run import:ctext --list                # the manifest and the crawl state
bun run import:ctext --from-cache --force  # rewrite the registry from the cache
bun run index:streams                      # build the search index from the caches
bun run db:reset                           # rebuild the database from the corpus
```

`--from-cache` is the recovery path a cut-short run needs: a pass that is
interrupted after writing a work's chapters leaves the corpus record and the
cache on disk and nothing in `streams.json`, and this flag reads them back into
the stream manifest, the text-function taxonomy and the corpus register with no
request at all. That is how the Mengzi and the Book of Rites were recovered after
the site closed.

## 10. Verifying the shelf

```bash
bun run import:ctext --list
# ctext manifest: 3 work(s)
# crawl state: 4 done, 0 failed
#   analects-zh                       20 ch    503 p  analects
#   liji-zh                           38 ch   1761 p  liji
#   mengzi-zh                         14 ch    690 p  mengzi

bun run index:streams
bun run db:reset
```

In the app: the three works appear on the Confucian shelf under *Confucian
classics*, each chapter opens with the Chinese paragraphs, and a search for
君子 or 曲禮 reaches them from the streamed-text index. The sources page records
ctext.org with its attribution requirement, and the provenance page records the
licence the text is displayed under.
