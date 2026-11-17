# Heritage Scripture Server (heritage.iitk.ac.in)

The Gita Supersite was built at IIT Kanpur and is continued by Heritage IITKanpur,
which serves the same corpus — the Bhagavad Gita with its classical commentaries
and translations, the Upanishads, the minor Gitas, the Ramayana, the
Mahabharata, the Yoga-Vasishtha, and the works of Shankara and Madhva — from a
Scripture Server with a documented, read-only REST API.

This pass is the largest by number of works and the smallest by text. **156 works**
enter the catalogue with their chapters and **122,381 verse addresses**, and not
one verse is stored. The verses are read from the server when a chapter is
opened, under the licence that governs them.

## 1. The licence

`https://heritage.iitk.ac.in/api/v1/license/` publishes the Heritage Content
Access Licence (HCAL-1.1). It sorts the corpus into three tiers:

| Tier | Content | API |
| --- | --- | --- |
| A | Moolam (Sanskrit source verses), mechanical transliterations | Open; no modern copyright |
| B | Sanskrit bhāṣya and subcommentaries, AI-generated and community translations | Served to a key, non-commercial use, attribution required |
| C | Modern-language translations and commentaries held under reading permission | **Not served**; HTTP 404 at the API layer |

The reader asks for `/moolam/` only — Tier A, the source verses. Article 4 of the
licence forbids bulk harvesting, database reconstruction, removing the `_meta`
attribution block and any AI/ML training use; the open-source licence text is
reproduced in `data/imports/gita-catalogue.json` beside the catalogue it governs.

That article is why this import holds a structure and not a text. So is the
metering: the server counts what it serves, one unit a moolam verse, two for a
transliteration or translation, three for a Sanskrit bhāṣya, against a daily
allowance of 50 units on the Free tier, 500 on Research, 2,000 on Scholar and
10,000 on a partner key. A corpus of 165,091 verses cannot be copied inside that
allowance, and the licence says it must not be.

## 2. What the import holds

For each of the 156 works, `scripts/dev/import-gita.ts` writes the ordinary
catalogue record — title, author, dates, shelf, language, provenance, rights —
and the work's chapter outline and verse addresses, marked
`textStorage: "streamed"`. It registers the work in `data/registry/streams.json`
as `provider: "heritage"` with the server's text code and, for each chapter, the
label and the addresses it publishes:

```json
"config": {
  "text": "BG",
  "chapters": { "2": { "label": "Chapter 2", "verses": ["2.1", "2.2", "…"] } }
}
```

The catalogue, the chapter listing and the verse addresses are open GETs. The
import reads them once, caches them, and writes nothing else.

Twelve works on the server's own listing could not be given a passage index —
works with no verse addresses or no per-chapter verse counts — and are recorded
as leads in `data/imports/gita.json` rather than guessed at.

## 3. Reading

`server/stream.ts` serves `provider: "heritage"` by requesting each verse from

```
GET {api}/{text}/{chapter}/{verse}/moolam/
Authorization: Api-Key <key>
```

The passage index holds 1,479 chapters over those 156 works, 1,409 of them of
120 verses or fewer and 70 longer, the longest being the Mahābhārata’s Śānti
Parva at 12,866 verses.

- **By address, never by arrival.** Each verse has its own slot in the chapter.
  A verse that fails or is skipped leaves an empty slot; it never closes the gap
  and moves the verse after it onto the previous reference. A verse that comes
  back empty is counted in the notice, so a gap is never silent.
- **Bounded.** A chapter reads at most 120 verses, three at a time; the notice
  says how many of the chapter's verses are shown and where the rest is read.
  The reader lists those verses and no others — a reader's chapter view comes
  back at 120 entries and about 20 KB for Śānti Parva, where listing all 12,866
  took 44 seconds and 2.2 MB to show the same ten rows.
- **Cached in memory, not on disk.** A verse costs a unit, so a verse once
  received is kept for six hours, bounded at 4,000 verses, for the life of the
  process. The chapter cache that serves every provider is ten minutes.
- **Honest when it stops.** A refused key, a spent allowance or an upstream
  status ends the read, keeps what arrived, and states the reason in the reader's
  notice. The verses read before it are still addressed correctly.
- **Attributed.** The notice carries "Accessed via Heritage Scripture Server
  (heritage.iitk.ac.in), licence HCAL-1.1" plus the server's own `_meta` licence
  and watermark, reproduced as they arrive.

## 4. The key

The API answers 403 to a request without credentials and states in its root
document that every endpoint requires `Authorization: Api-Key <key>`. A key it
does not recognise is answered with a 500 rather than a 403, which the reader
names instead of reporting a fault: `the server answered 500, which is how it
answers a key it does not accept`.

Keys are issued on request: `heritage.iitk@gmail.com` is the contact address the
API's own schema publishes, and `https://heritage.iitk.ac.in/api/v1/request-access/`
takes the request form (it is a POST endpoint, so opening it in a browser is a
405; the form is the platform's).

Set it in the project's `.env`:

```sh
HERITAGE_API_KEY=…
```

Without the key the reader still shows the work, its outline and the address of
every verse, and says where the key comes from — it does not show an empty page,
and it does not substitute another edition.

## 5. Commands

```sh
# The corpus list the server publishes (written to data/imports/gita-catalogue.json)
bun run import:gita --catalogue

# What the catalogue holds
bun run import:gita --list

# One work, or a named set
bun run import:gita --text=SBG
bun run import:gita --codes=SBG,ISU,CHU

# The whole corpus, a few works at a time
bun run import:gita --all --limit=20
```

The importer makes one request at a time, at least 1,200 ms apart, and caches
every response under `data/imports/cache/gita`, so a repeated run costs the
server nothing.

## 6. Not held

- No verse text, commentary, translation or transliteration is written to the
  database or to disk, and no streamed work of this provider appears in
  `passage_texts` or `passage_fts`.
- The streamed index (`bun run index:streams`) includes this shelf only when
  `HERITAGE_API_KEY` is set, because indexing without a key would spend the run
  on refusals.
- Tier C content — the modern-language translations and commentaries — is not
  available through the API at all, and the catalogue records for those works
  name the platform where they may be read.
