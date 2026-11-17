# Source Registry and Ingestion Report

**Universal Wisdom Library**  
**Prepared:** 20 October 2026  
**Scope:** registry, rights assessment, textual classification, tested ingestion, and coverage gaps

## 1. What was built

The library now has a source-registry subsystem that keeps four questions separate:

1. **Discovery** — does a repository exist, and what does it contain?
2. **Rights record** — what does the provider state about the edition, and what must the reader be told?
3. **Ingestion** — can a reproducible extract be fetched, validated and addressed at chapter level?
4. **Publication** — is the text displayed with its exact edition, source and rights notice?

A registry entry is therefore not an integration. “Import tested” means a source was actually fetched and validated. This build is a reading interface over texts fetched from the projects that publish them, not a claim of ownership: every edition keeps the provider’s version title, source and licence, and the library does not relicense the text. Where a provider offers a chapter-level API, the text is streamed at read time rather than copied into the corpus.

Implemented components:

- `source_registry`, `source_checks` and `ingestion_queue` tables with controlled status vocabularies.
- A curated registry of **78 sources**, with filters for tradition, language, content type, access method, priority, approval and ingestion status.
- Public source catalogue and source-detail pages, including rights verdicts, attribution requirements, verification checks, imported editions, import history and queued requests.
- An administrator review area for source approval, verification records, import requests and rights requests. Editors may record checks and request imports; only administrators may approve sources or import requests.
- Edition-level provenance and an import-issue log, including validation warnings and manifest checks.
- Multi-valued textual-function classification for every corpus work, with `affirmed`, `provisional` and `disputed` status.
- A tested Project Gutenberg adapter and a reproducible Fox Journal import manifest.
- A reproducible Sefaria Tanakh importer covering all 39 books in Hebrew (Miqra according to the Masorah, CC BY-SA) and English (JPS 1917, public domain), with a per-book checksum manifest.
- A complete Mishnah importer with Hebrew Torat Emet and the William Davidson English translation, both carrying their own licence records.
- A staged Sefaria importer covering **all 76 Talmud tractates (Bavli and Yerushalmi), 47 Midrash works and 61 Tosefta tractates**, with 184 complete works, 9,913 chapters and 129,536 passages in `data/imports/sefaria-library.json`.
- A library browser that mirrors the Sefaria shelf: **Tradition → Category → Work → Chapter**, all four levels open on one board, with chapter links that open the reader directly. The shelf keeps each collection's own reading order (Torah → Nevi'im → Ketuvim; the six sedarim and their tractates; Bavli then Yerushalmi; Midrash Rabbah by Torah portion and Megillah) instead of sorting alphabetically.
- The chapter reader shows the source-language text beside the translation wherever the holding project supplies both, each pane naming its own edition, source and licence.
- A periodic availability-check script that records HTTP checks without treating availability as a licence verification.
- A public rights, attribution, consultation and takedown route that does not require an account, plus an editor review queue. Takedown decisions are recorded; removal is a separate, logged action rather than automatic deletion.
- Exact duplicate-text checks within an edition and across editions, recorded as informational notes because repeated formulae and parallel passages are expected in complete canons.
- Automated tests for registry integrity, classification coverage, stream manifest integrity and text normalisation.

### Streaming architecture

Most of the shelf is no longer stored. The library keeps a **catalogue record, chapter outline and passage index** for each streamed work, and requests the chapter text from the project that publishes it when a reader opens it. Nothing fetched is written to SQLite or to disk.

- `data/registry/streams.json` maps **1,258 works** to a host: Sefaria (973 Jewish works), SuttaCentral (186 suttas plus the Dhammapada), AlQuran Cloud (the Qur’an), the Bolls Bible API (66 books of the Christian Bible), the Christian Classics Ethereal Library (18 patristic and scholastic works), New Advent (the Summa Theologica and the City of God), the Hadith API (six hadith collections and the Muwatta), Wikisource (Ibn Arabi's Tarjumán al-Ashwáq and al-Ghazali's Alchemy of Happiness) and Project Gutenberg (al-Ghazali's Confessions, Ibn Sina's Compendium on the Soul and the Averroes tracts). Each entry names the upstream work, the chapter addressing mode, the page index and the exact edition titles to request.
- `work_streams` in the database holds the same map so the reader resolves a work without touching the filesystem. It is seeded from the manifest like any other corpus data.
- `server/stream.ts` implements the providers. The Hadith API is read one section at a time (`/editions/{edition}/sections/{n}.min.json`), with the Arabic and English editions of the same collection sharing section numbering so the panes stay aligned. Wikisource chapters are fetched through the MediaWiki parse API and split into prose paragraphs and poem lines; untranscribed Arabic-script placeholders and running heads are dropped. Gutenberg editions are fetched whole and split at the chapter headings they print, using the same splitter at import and at read time. Sefaria is addressed at chapter level (`/api/v3/texts/{ref}?version={language}|{versionTitle}`), with the pinned version title taken from the catalogue so a 1917 JPS translation is not silently replaced by a 2023 revision. Named-section works (Zohar, Mishneh Torah, Responsa) fall back to `Title,_Section` when the numbered address does not match the local index. SuttaCentral is read through the bilara endpoint, with the passage index's segment ids used to keep the Pali and English panes aligned; the Dhammapada uses the same provider over vagga ranges, grouping segments by verse. AlQuran Cloud serves the Qur’an one surah at a time, with the Tanzil Uthmani Arabic and Pickthall's public-domain English as separate editions. Bolls serves one Bible chapter per request from the KJV, the Westminster Leningrad Codex and the Textus Receptus; the reader strips the API's Strong's-number markup and keeps the verse wording. The CCEL and New Advent providers fetch one hosted page per chapter and split it into the passages that were indexed at import: paragraphs for the fathers, articles for the Summa, chapters for the City of God. The same extraction function builds the import index and serves the page, so the two cannot drift apart silently — if the host changes a page, the reader reports that its segmentation no longer matches.
- The chapter reader has two layouts: **passage cards** (each verse, hadith or article with its own reference and links) and **continuous**, which sets the chapter as one block per edition and keeps only the chapter break. Poetry and other line-by-line material is joined into one column with a line break between verses instead of a paragraph each, and passage marks are hidden there so a poem is not interrupted by a repeated title. Prose paragraphs keep their references; a **Marks** toggle shows or hides marks in either case. The layout and the mark preference are stored across navigation.
- Responses are cached in memory for ten minutes (240 chapters, cleared on restart). Concurrent requests for the same chapter share one upstream fetch.
- The reader shows a **Streamed live** badge naming the host, the upstream reference and the fetch time, with a link to the source. If the host divides a chapter differently from the local index, the notice says so and the text is shown as received.
- The corpus work files keep `chapters`, `passages`, edition provenance and a `textStorage: "streamed"` marker, but no `editions[].texts`. The seeder records the passage index without writing text.
- **Search** uses the local FTS index for locally held texts and Sefaria's search API for streamed ones. A streamed hit is only offered as an internal link when its reference exists in the local passage index; the full result set links back to Sefaria.
- Storage effect: the SQLite database fell from **6.6 GB to 105 MB** and the corpus JSON from **1.0 GB to 75 MB**, with the passage index intact. Adding the Christian shelf brings the index to **830,217 passages** and the database to **105 MB**; no Bible verse, patristic paragraph or Summa article is stored.

## 2. Current registry position

| Measure | Count |
| --- | ---: |
| Sources registered | 70 |
| Approved for the metadata/import workflow | 12 |
| Pending manual approval | 42 |
| Rejected | 16 |
| Import tested | 5 |
| Active local/editorial/streaming sources | 5 |
| Under review | 40 |
| Restricted | 15 |
| Unavailable | 1 |
| Sources with documented API | 13 |
| Priority 1 / 2 / 3 | 18 / 29 / 22 |

These counts describe the curated registry, not a claim that all listed repositories have been ingested.

### Sources with recorded import tests

| Source | Status | What the test covers |
| --- | --- | --- |
| Sefaria | Import tested | Complete Tanakh (39 books, 23,206 verses in Hebrew and English), complete Mishnah (63 tractates, 4,158 mishnayot in Hebrew and English), complete Talmud (76 tractates), Midrash (47 works) and Tosefta (61 tractates). Per-work checksums and per-edition provenance. |
| SuttaCentral | Import tested | Segmented Pali root text and a CC0 English translation. |
| AlQuran Cloud / Tanzil | Import tested | Arabic Qur'anic text; the corpus translation is Rodwell’s public-domain 1861 text from Project Gutenberg, not an AlQuran Cloud translation. |
| Project Gutenberg | Import tested, active | Public-domain plain-text editions, including the tested George Fox Journal extraction, and — streamed — al-Ghazali's Confessions, Ibn Sina's Compendium on the Soul and the Averroes tracts (24 chapters, 439 paragraphs). |
| Wikisource | Import tested, active | Public-domain transcriptions, including — streamed — Ibn Arabi's Tarjumán al-Ashwáq (63 chapters, 1,324 segments) and al-Ghazali's Alchemy of Happiness (6 chapters, 195 paragraphs). Page-level provenance is checked per text. |
| Bolls Bible API | Active, streamed | All 66 books of the Christian Bible: KJV beside the Westminster Leningrad Codex (Hebrew) and the Textus Receptus (Greek). 1,195 chapters and 31,207 indexed verses; no text stored. |
| Christian Classics Ethereal Library | Active, streamed | Augustine (Confessions, On Christian Doctrine), Aquinas (Summa Contra Gentiles), Irenaeus, Athanasius, Origen, Tertullian, Cyprian, Justin, Hippolytus, Socrates and Sozomen, the New Testament apocrypha and the Excerpts of Theodotus. 17 works, 3,276 chapters and 13,328 indexed passages. |
| New Advent | Active, streamed | The Summa Theologica (611 questions, 3,115 articles) in the 1920 Dominican Province translation, and the City of God (22 books, 687 chapters). The 1920 translation is public domain; the online edition is credited and linked rather than copied. |
| Hadith API (fawazahmed0) | Active, streamed | Sahih al-Bukhari, Sahih Muslim, Sunan Abi Dawud, Jami' at-Tirmidhi, Sunan al-Nasa'i, Sunan Ibn Majah and the Muwatta: 397 books, 35,975 indexed hadiths, Arabic beside the English text the API serves. The repository is Unlicense; the English translations are credited to their named translators and streamed, not relicensed. |

Two further registry entries are marked **active**: the version-controlled local corpus and the library’s own editorial text (CC BY 4.0).

**Important limitation:** separate adapter-run receipts currently exist for the local corpus, the Project Gutenberg manifest and the Sefaria Tanakh import. The other “import tested” entries reflect earlier sample validation recorded in the registry; this build does not retain a standalone manifest for each of them. They should not be described as production integrations.

### Sources requiring manual review or permission

- **Bahá’í Reference Library** — official and authoritative; downloads are per publication, not a blanket corpus licence. **The project owner authorised access on 2026-10-26**, and the authorised English translations of ten works of Bahá’u’lláh and ‘Abdu’l-Bahá are now streamed from bahai.org, with the Community's copyright notice, the title of the work and the translator shown beside every chapter. The texts are not relicensed and nothing is copied into the local corpus; the terms remain site-level. See [bahai-expansion.md](bahai-expansion.md).
- **Quaker Faith & Practice (Britain Yearly Meeting)** — free to read, but no open redistribution licence. The Fox *Journal* is handled separately through a public-domain 1901 edition.
- **UUA Principles, Purposes and Sources / WorshipWeb** — site copyright and limited congregational permissions; not a reuse dataset.
- **Chinese Text Project** — the public site prohibits scraping and its API is for subscribers. Link and catalogue only unless a licence is obtained.
- **The Church of Jesus Christ of Latter-day Saints — Scriptures** — personal/non-commercial terms; no bulk redistribution assumed.
- **Tenrikyo, Cao Dai, Rastafari and Indigenous collections** — provenance, community authority and reuse terms require case-by-case confirmation. Indigenous knowledge may be restricted or ceremonial; public visibility is not permission to republish.
- **Sunnah.com, Al-Islam.org, Bible Gateway** — translation-level or site-level restrictions; no mass reproduction assumed. New Advent carries a site notice on its online edition; the 1920 Dominican Province translation it serves is public domain, so the Summa and the City of God are streamed from the page with the edition and host credited, not copied into the corpus.

The registry contains working URLs, organisation names, access notes and licence URLs for every entry, but **53 working URLs do not equal 53 licences**. Where terms were unclear, the entry is marked under review rather than assumed open.

## 3. Tested ingestion workflow

The reproducible example is **Project Gutenberg eBook #75559**, *The Journal of George Fox*, volume 1 of 2, eighth (bi-centenary) edition, edited by Norman Penney (1901).

Run:

```bash
bun run import:fox
```

The adapter:

1. Fetches the UTF-8 plain text with a bounded timeout.
2. Checks the Gutenberg start marker and rejects truncated or implausibly small files.
3. Extracts two passages by unique start and end markers, not by mirroring the book.
4. Records line ranges, SHA-256 checksums and the full source-file hash.
5. Writes `data/imports/gutenberg-75559-fox.json` and the corpus work record.
6. Leaves the full source file uncommitted.

The pipeline then records the manifest as a successful import, with two records and a manifest-verification note, and publishes the excerpts only after reference, duplicate-text and provenance checks.

**Rights basis:** the underlying 1901 text is public domain in the United States. Project Gutenberg’s terms and local copyright law must still be checked for other jurisdictions. The library records the edition, editor, publisher and eBook number.

### Complete Tanakh import

Run:

```bash
bun run import:sefaria
```

The importer:

1. Reads the Sefaria library index to identify the 39 canonical Tanakh books, excluding commentaries, targumim and user sheets.
2. Fetches each book’s Hebrew Miqra according to the Masorah text and JPS 1917 English translation from the Sefaria texts API.
3. Rejects the import if a returned edition has any licence other than `CC-BY-SA` (Hebrew) or `Public Domain` (English).
4. Decodes HTML entities, preserves niqqud and cantillation, and records every chapter and verse as a passage.
5. Writes work JSON plus `data/imports/sefaria-tanakh.json`, containing per-book SHA-256 checksums and verse counts.

The result is **39 books, 929 chapters, 23,206 Hebrew verses and 23,206 English verses**. Genesis alone now has 50 chapters and 1,533 verses instead of the previous five-verse sample. The reader opens a work at its first chapter unless a specific verse is requested, and a chapter view lets the reader choose 5, 10, 25, 50 or all verses.

### Complete Mishnah import

Run:

```bash
bun run import:mishnah
```

The Mishnah importer covers all **63 tractates** in the six sedarim. It records the public-domain Hebrew *Torat Emet 357* edition and, for all 63 tractates, the **William Davidson English translation** (4,158 English mishnayot). The manifest is `data/imports/sefaria-mishnah.json`, with SHA-256 checksums for every tractate. Both editions keep their own version title, source and rights status; the CC-BY-NC status of the English edition is shown in the reader rather than silently dropped.

### Complete Sefaria shelf: Halakhah, Kabbalah, Liturgy, Jewish Thought, Chasidut, Musar, Responsa, Second Temple and Reference

The library importer now covers every Sefaria top-level category that carries base texts. Commentaries are excluded by category and by the Zohar-commentary title pattern; they belong to the commentary layer, not to the base shelf. A work pool fetches several works at once, and a permission or structure error fails fast instead of retrying hundreds of sections.

- **871 works** imported in the Sefaria library manifest: Halakhah 210, Kabbalah 57, Liturgy 31, Jewish Thought 98, Chasidut 82, Musar 39, Responsa 98, Second Temple 52, Reference 20, plus the earlier Talmud 76, Midrash 47 and Tosefta 61.
- **91 works skipped** and recorded with a reason: most return no API-accessible text (typically in-copyright liturgy such as Koren or Rabbi Sacks, or works Sefaria holds only as catalogue records). `Likutei Moharan` is skipped because the Hebrew text is empty in the API response.
- The complete Zohar is imported through Sefaria's complex-section endpoint (52 chapters, 15,969 passages); Zohar commentaries filed as Kabbalah base texts (Ketem Paz, Mikdash Melekh, Sulam and similar) are excluded.
- Each edition keeps its Sefaria version title, version source, licence and attribution, and the reader shows the source beside the text.
- The Mishneh Torah opening follows the order of its 14 books rather than the alphabet, and the shelf headings follow the collection's own sequence (Mishneh Torah, Tur, Shulchan Arukh, then the responsa and modern works).

### Complete Qur’an and Dhammapada

- **Qur’an:** all 114 surahs and 6,236 ayahs from AlQuran Cloud. The Tanzil Uthmani Arabic is reproduced verbatim under the Tanzil terms; the English is M. M. Pickthall’s 1930 public-domain translation. The two are separate editions and are shown in parallel panes, each naming its own source.
- **Dhammapada:** all 423 verses in 26 vaggas from SuttaCentral’s Bilara data — Pali root text beside Bhikkhu Sujato’s CC0 translation. The earlier five-verse sample is replaced.

### Complete Talmud, Midrash and Tosefta import

Run:

```bash
bun run import:sefaria-library
```

The staged importer reads the Sefaria index and imports complete works, excluding commentaries and user sheets:

- **Talmud** — all 37 Bavli tractates and all 39 Yerushalmi tractates. Bavli chapter refs use dapim (`2a`, `2b`); Yerushalmi uses chapter and halakhah structure.
- **Midrash** — 47 core works, including the ten Midrash Rabbah volumes, Pesikta, Sifrei, Mekhilta and Yalkut Shimoni. Complex works without a book-level API ref are fetched section by section from the index schema.
- **Tosefta** — 61 tractates from the Vilna edition.

The result is **184 complete works, 9,913 chapters and 129,536 passages** in `data/imports/sefaria-library.json`, each with a SHA-256 checksum. Five works remain skipped because Sefaria exposes no usable version or schema (Ein Yaakov Glick, Otzar Midrashim, Sefer HaYashar, Sifra, Sifrei Aggadah on Esther); they are recorded in the manifest rather than silently omitted.

Every edition keeps the returned Sefaria version title, version source and licence. The library does not relicense a CC-BY-NC translation or an edition whose licence is unstated. The reader shows the source and rights line with the text, and the library browser exposes the same record at the chapter step.

## 4. Coverage added

The catalogue now contains **1,297 works**, **2,192 editions**, **868,150 indexed passages**, **53 locally held texts**, **35 catalogued traditions** and works in **27 traditions**. Of the works, **1,258 are streamed** and **29 are catalogue-only records**; 53 texts are held locally (the Project Gutenberg extract and editorial notes). Judaism has **973 works**: the complete Tanakh, Mishnah, Talmud, Midrash, Tosefta, Halakhah, Kabbalah, Liturgy, Jewish Thought, Chasidut, Musar, Responsa, Second Temple and Reference shelves. Christianity has **90 works**; Islam has **19**.

New or expanded coverage includes:

- Bahá’í Faith: the ten published works the Reference Library serves are now streamed — the Hidden Words, the Kitáb-i-Aqdas, the Kitáb-i-Íqán, The Seven Valleys, The Four Valleys, Gleanings from the Writings of Bahá’u’lláh, Some Answered Questions, the Epistle to the Son of the Wolf, the Tablets of Bahá’u’lláh and Prayers and Meditations: 461 chapters and 4,375 indexed passages, with the Community's copyright notice shown beside each.
- Quakerism: Quaker Faith & Practice (catalogue only) and the tested Fox Journal excerpts.
- Unitarian Universalism: the 1985–2024 Principles and Sources (catalogue only).
- Historical Unitarianism and Universalism: Channing’s *Unitarian Christianity* and Ballou’s *A Treatise on Atonement* (catalogue records).
- Ethical Culture and humanism: the Ethical Movement statement (catalogue record).
- Modern Paganism: the Charge of the Goddess (catalogue record; flagged as a modern composition, not ancient scripture).
- Latter-day Saints: the Book of Mormon (catalogue only).
- Tenrikyo, Cao Dai, Theosophy, Anthroposophy, Oomoto, Seicho-no-Ie and the Unification movement: foundational or doctrinal works with provenance notes.
- Judaism: all 39 Tanakh books in Hebrew and English; all 63 Mishnah tractates in Hebrew and English; all 76 Talmud tractates; 47 Midrash works; 61 Tosefta tractates; and the imported Halakhah (210), Kabbalah (57), Liturgy (31), Jewish Thought (98), Chasidut (82), Musar (39), Responsa (98), Second Temple (52) and Reference (20) shelves. The library browser groups these as fourteen categories.
- Buddhism: the complete **Dīgha Nikāya (34 suttas)** and **Majjhima Nikāya (152 suttas)** added as streamed works, each carrying the Pali root text and Bhikkhu Sujato's CC0 translation from SuttaCentral — 186 works and 37,446 indexed segments. Together with the Dhammapada this brings Buddhism to **187 works**.
- Christianity: the **66 books of the Christian Bible** as streamed works (1,195 chapters, 31,207 verses), each carrying the King James Version beside the Hebrew (Old Testament) or Greek (New Testament) text. Genesis 1 now opens with the Hebrew and KJV side by side rather than an excerpt.
- Church fathers and scholastic writers: **Irenaeus** (Against Heresies, five books in one work), **Athanasius** (On the Incarnation; Orations Against the Arians), **Origen** (Against Celsus), **Tertullian** (Apology; Against Marcion; Against the Valentinians), **Cyprian** (Treatises), **Justin Martyr** (First Apology), **Hippolytus** (Refutation of All Heresies), **Socrates Scholasticus** and **Sozomen** (Ecclesiastical Histories, which preserve the Arian documents), **Augustine** (Confessions; On Christian Doctrine) and **Aquinas** (Summa Theologica, 611 questions and 3,115 articles; Summa Contra Gentiles).
- Non-canonical and non-mainstream material: the **Apocryphal Acts and Apocalypses of the New Testament** (201 chapters, including the Acts of Thomas and John, which carry Gnostic-influenced material), the **Excerpts of Theodotus** (Valentinian teaching preserved by Clement), Tertullian's and Hippolytus's reports of Gnostic systems, and a separate work of Athanasius against the Arians. Three records are catalogue-only with their rights positions stated: the Gospel of Thomas, Pistis Sophia and the Thalia and letters of Arius.
- Islam beyond the Qur’an: the **six canonical hadith collections** — Sahih al-Bukhari (98 books, 7,580 hadiths), Sahih Muslim (57 books, 7,360), Sunan Abi Dawud (43, 5,272), Jami' at-Tirmidhi (49, 3,926), Sunan al-Nasa'i (51, 5,679) and Sunan Ibn Majah (38, 4,340) — each with the Arabic beside the English text, plus the **Muwatta of Malik** (61 books, 1,818) as a legal compendium. **Sufism:** Ibn Arabi's *Tarjumán al-Ashwáq* with his own commentary (63 chapters) and al-Ghazali's *Alchemy of Happiness* (6 chapters). **Kalam:** al-Ghazali's *Confessions*, the first-person account of scholastic theology, philosophy and Sufism. **Falsafa:** Ibn Sina's *Compendium on the Soul* (12 sections) and three treatises of Ibn Rushd on the relation between religion and philosophy. **Jurisprudence:** the Muwatta, and catalogue records for al-Shafi'i's *Risala* and *Kitab al-Umm*, al-Sarakhsi's *Mabsut*, Sahnun's *Mudawwana*, Ibn Qudama's *Mughni* and al-Marghinani's *Hidaya*, each stating why no verified English edition is served.
- The Christian shelf now opens with the **New Testament** (Gospels, Acts, the Pauline letters, the general letters, Revelation), then the Old Testament, then patristic, scholastic and non-canonical works. Within the New Testament the shelf follows the printed order — Matthew, Mark, Luke, John, Acts, Romans through Hebrews, James through Jude, Revelation — rather than the alphabet. The Islamic shelf runs Qur’an → Hadith → Kalam → Falsafa → Fiqh → Sufism, and the hadith shelf lists Bukhari, Muslim, Abu Dawud, Tirmidhi, Nasa'i, Ibn Majah in the order the tradition lists them.
- Existing major-tradition coverage remains: Christian, Islamic, Hindu, Buddhist, Sikh, Jain, Taoist, Confucian, Shinto, Zoroastrian and classical philosophical texts.

Every corpus work now has at least one textual-function classification, including the imported Talmud, Midrash and Tosefta works. Classifications distinguish canonical scripture, non-canonical religious text, foundational revelation, prayer and liturgy, commentary, law and practice, historical documents, sermons, philosophy, mystical writing, ethical manifestos, community statements, denominational guidance, contemporary spiritual writing and community-authorised knowledge. Disputed cases — for example the Gita’s canonicity, the Book of Mormon, the Charge of the Goddess and Cao Dai authority — are marked `disputed` with an explanation rather than forced into one tradition-wide answer.

## 5. Verification performed

- `bun test` — **43 tests pass**, including Bible and patristic text cleaning, hosted-HTML segmentation (paragraphs, Summa articles, City of God chapters, page furniture), Wikisource poem and prose extraction, the Gutenberg chapter splitter with footnote and table-of-contents handling, and the provider labels.
- `bun run scripts/dev/import-christian-sources.ts` completed a full run in about 26 minutes: **66 Bible books (1,195 chapters, 31,207 verses)** and **19 patristic, scholastic and apocryphal works (3,909 chapters, 17,130 passages)** written as streamed works, with `data/imports/christian-sources.json` recording every host, translator, chapter count and passage count.
- `bun run scripts/dev/import-islamic-sources.ts` completed with **12 streamed works, 490 chapters and 37,933 indexed passages** and no failures (`data/imports/islamic-sources.json`): 7 hadith and legal collections (397 books, 35,975 hadiths), 2 Sufi works, 3 kalam and falsafa works, and 6 jurisprudence catalogue records. Wikisource’s rate limit was handled by retrying each page rather than dropping it, because a dropped page would shift every later chapter number.
- `bunx tsc --noEmit` — clean.
- `bun run build` — succeeds.
- A clean `bun run scripts/seed.ts --reset` succeeds with **1,297 works, 2,192 editions, 868,150 passages and 53 texts** (29 validation warnings, each a catalogue-only record). The passage index for streamed works is written without any text. The import pipeline refuses a source that is not approved or is restricted/unavailable; non-redistributable licences are recorded as display-only provenance rather than hidden.
- Streaming read paths verified end to end: Genesis 1:1 (Sefaria, JPS 1917 Hebrew and English), Berakhot 2a (14 lines, both editions), Zohar Introduction (complex-section addressing), Mishnah Berakhot, DN 1 (629 segments, Pali beside Sujato), MN 10, Qur’an 1 (AlQuran Cloud, Arabic beside Pickthall) and Dhammapada 1/21/423 (SuttaCentral, Pali beside Sujato). Compare resolved a streamed Jewish passage, a streamed sutta and a streamed Qur’anic verse in one request.
- Christian read paths verified end to end: Genesis 1:1 (Bolls, KJV beside the Westminster Leningrad Codex), Genesis 1 in the chapter view (31 verses, both panes), John 3:16 (KJV beside the Textus Receptus), Psalm 3, Confessions Book I Chapter II (CCEL paragraph), City of God Book I (New Advent, 38 chapter-level passages), Summa I q.1 (10 articles, each with objections, determination and replies), Justin's First Apology, the Excerpts of Theodotus, and the apocryphal Acts. Compare resolved Genesis 1:1 beside Qur’an 1:1 in one request.
- Islamic read paths verified end to end: Bukhari Book 1 (7 hadiths, Arabic beside Muhsin Khan, aligned), Bukhari Book 30 (112 hadiths), Muslim Book 1 (436), Muwatta Book 2 (114), Tarjumán Poem 1 (9 lines), Alchemy of Happiness II (48 paragraphs), Ghazali's Confessions II (10), Ibn Sina Section First (6) and the Averroes Decisive Discourse (49). Every response reported `aligned: true`.
- In the browser: the Christian shelf lists New Testament → Old Testament → patristic and so on, and the New Testament shelf renders Gospels (Matthew, Mark, Luke, John), History (Acts), Pauline Epistles (Romans onward), General Epistles and Apocalypse in that order. The Islamic shelf renders Qur’an → Hadith → Kalam → Falsafa → Fiqh → Sufism, with the hadith shelf in canonical order and the Muwatta first among the legal works. The **Continuous** layout was exercised on Matthew 1 (Greek and English panes, 25 paragraphs each, no cards) and Bukhari Book 30 (Arabic and English, 112 each), and the choice persisted in `localStorage`.
- In the browser: the Bible reader shows the language toggle (Both / English only / Hebrew only); English-only and Hebrew-only each render one pane, the Hebrew pane keeps `dir="rtl"`, the preference persists in `localStorage`, and the chapter view paginates 31 verses. The Summa reader opens at Part I, Question 1 with ten article cards. The work page, `/library?tradition=christianity` (90 works), `/provenance` and the source cards for all three hosts were exercised. A catalogue-only work (Pistis Sophia) shows its rights explanation in place of text.
- Search verified with streamed results: “let there be light” returned 120 local and 7 streamed hits, each linking to the reader or to Sefaria.
- Source catalogue, filtered catalogue, source-detail page, work page and reader exercised in the browser.
- Administrator flow tested with a temporary account: approval, audit check insertion, import-queue creation and queue approval. The temporary account, queue row and audit entries were removed afterwards.
- Public rights-request form and editor review queue exercised end to end: invalid input rejected, a request recorded, signed-out access returned 401, a reader account received 403, an editor listed the request and moved it to `under_review` with a note. The temporary account and request were removed afterwards.
- Five approved source URLs checked with the availability script; all returned HTTP 200. `last_verified_at` was deliberately **not** advanced, because availability is not a rights review.
- Reader endpoints verified for Genesis (all 50 chapters), Psalms, Exodus, Mishnah Berakhot in Hebrew and English, Talmud Berakhot (Daf 2a, 14 lines), Qur’an, Dhammapada, Tao Te Ching and Fox Journal. Opening `/read/genesis` returns chapter 1 with 31 verses; `?ref=1.31` opens that verse; `/read/talmud-berakhot` opens Daf 2a; `?ref=2a.3` opens that line.
- Chapter-size controls exercised in the browser: 5, 10, 25, 50 and all units; “show 10 more” works. The label follows the reference scheme: verses, mishnayot, lines or paragraphs.
- The library board was exercised through Tradition → Category → Work → Chapter at 1440 px without leaving the fold, including the Judaism shelf (5 categories, 286 works), Tanakh in Torah/Prophets/Writings order, Mishnah seder by seder, Talmud (76 works, Bavli/Yerushalmi groups), Midrash (47) and Tosefta (61), and chapter links into the reader.
- Parallel reading verified in the chapter view: Genesis 1:1 Hebrew beside JPS 1917, Mishnah Berakhot Hebrew beside the Davidson English, Talmud Berakhot Aramaic beside the Davidson English, and a single-edition work (Bhagavad Gita, Project Gutenberg) still attributed inline.
- Compare work picker exercised across the enlarged corpus; categories replace the old flat genre grouping.

## 6. Known gaps and unresolved rights

1. **Text coverage is uneven across traditions.** Judaism is catalogued across fourteen categories and Buddhism now has the complete Dīgha and Majjhima Nikāyas, but most other traditions still have selected excerpts or catalogue records. A large Jewish shelf does not make the whole library complete.
2. **The Jewish shelf is catalogued in full, but streamed.** All 973 Sefaria base works in the twelve imported categories are now addressable, with their chapter and passage indexes stored locally and their text read from Sefaria. Commentaries and user sheets remain out of scope: they are separate authored works, not part of the base text.
3. **Streaming depends on the host.** If Sefaria or SuttaCentral is slow or unavailable, a chapter cannot be shown; the reader surfaces the failure rather than substituting a local copy. Sefaria and SuttaCentral are also free services, and a deployment that drew heavy traffic would need a caching or licensing arrangement with them.
4. **Streamed search is partial by construction.** Sefaria's search index can return hits whose references do not match this library's chapter index; those are linked back to Sefaria rather than guessed at.
5. **Five Sefaria works are not imported.** Ein Yaakov (Glick), Otzar Midrashim, Sefer HaYashar, Sifra and Sifrei Aggadah on Esther have no usable API version or schema. They are recorded in the manifest rather than replaced with a different edition.
5a. **The Christian shelf is English-first except for the Bible.** The patristic and scholastic hosts serve public-domain English translations, not the Greek or Latin originals; those editions record the original language and say plainly that the original is not hosted. The Bible is the exception, with Hebrew and Greek panes.
5b. **Hosted page furniture is shown as it arrives.** The CCEL volumes print the Victorian editor's footnotes inline with the text, and some volumes put a chapter heading in its own paragraph; those appear in the reading panes rather than being silently deleted. The reader's stream notice reports when a page's segmentation no longer matches the imported index.
5c. **Three Gnostic and Arian primary texts are catalogue-only.** The Gospel of Thomas, Pistis Sophia and Arius's Thalia lack a verified public-domain digital edition or survive only as fragments quoted in other works. The catalogue records them, explains the rights position, and does not fabricate text. Gnostic teaching is streamed through the works that quote it (Irenaeus, Hippolytus, Tertullian, the Excerpts of Theodotus) and through the apocryphal acts.
5d. **The hadith translations are not all public domain.** The Hadith API labels some translators (Muhsin Khan for Bukhari, Abdul Hamid Siddiqui for Muslim) and leaves others unstated. The Arabic text is public domain, but the English editions are streamed from the host under a `streamed-host-terms` licence, credited to the named translator, and never relicensed. The API's Unlicense covers its code and packaging, not the translations, and the catalogue says so.
5e. **Jurisprudence is the thinnest Islamic shelf.** Only the Muwatta is streamed. Al-Shafi'i, al-Sarakhsi, Sahnun, Ibn Qudama and al-Marghinani are catalogue records because the English translations are in copyright (Khadduri's *Risala*), do not exist, or — for Hamilton's 1791 *Hedaya* — survive only as uncorrected OCR that would misrepresent the text. Every record states its position rather than presenting a machine-garbled scan as an edition.
6. **Rights are recorded, not cleared.** The reading interface keeps each provider’s licence and attribution; it does not claim that every imported edition is freely redistributable, and it does not relicense CC-BY-NC or unstated material. Anyone reusing this corpus outside the interface must make their own rights assessment.
7. **Bilingual segmentation is not always aligned.** Some Talmud and Midrash lines exist in one edition and not the other. The reader falls back to the available edition; no text is fabricated to fill a gap.
8. **Quaker, UU, LDS, Tenrikyo, Cao Dai and Indigenous material** remain permission-dependent. No text from restricted sources was imported. The Bahá’í writings are no longer in this group: access was authorised on 2026-10-26 and ten works are streamed under the Community's copyright notice, not relicensed.
9. **Community consultation is not yet formal.** Classifications and provenance notes are editorial and marked provisional or disputed; they are not community rulings.
10. **No PDF/OCR pipeline** is included. HTML or plain text is preferred; scanned manuscripts are catalogued, not silently OCR’d.
11. **Some registry metadata is unverified.** `last_verified_at` records the last recorded review, not continuous monitoring. Availability checks now run on a schedule (below), but they record whether a host answers, never whether its terms still allow reuse.
12. **Availability checks run on a schedule, inside the server.** `serve.ts` checks the sources that are due shortly after start-up and then every `UWL_CHECK_INTERVAL_HOURS` (12 by default), five at a time and 1.5s apart; a source is due when its newest recorded check is older than `UWL_CHECK_INTERVAL_DAYS` (30 by default). `UWL_CHECK_SCHEDULE=off` disables the schedule without disabling `bun run check:sources`, which runs the same pass from the command line. The Sources page shows how many approved sources are due, and the count is kept separate from rights verification.
13. **Escalation is local, not mailed.** Open rights requests older than 14 days and the count of sources due are reported in the admin summary and written to the server log at start-up. This build sends no email; a deployment that wants mail needs a transport of its own.
14. **Near-duplicate detection needs shared text to start.** A scan groups editions that repeat substantive passages, then compares a sample of their shared references. Two editions that were reworded on every line share no passage, so they are not paired. Streamed works are not compared at all: only locally held passages carry a copy and a checksum to sample. The scan reports; it never merges editions or deletes text.
15. **Source intake records a lead, not a review.** A discovery filed through the admin form is pending, unverified and unimported; its only claim is that someone recorded where it is and why it matters.

## 7. Roadmap

### Next (provenance and evidence)

- Seek written permission for Quaker Faith & Practice and UUA WorshipWeb material.
- Add per-adapter manifests/receipts for SuttaCentral, AlQuran Cloud and Wikisource before keeping their “import tested” label.
- Keep the exact Sefaria version and source link visible on every imported edition, including a direct link back to the work.
- Re-verify the 32 pending sources, prioritising priority-1 entries.
- Send the escalation that is already computed (overdue rights requests, sources due) by email or another transport; today it is shown to editors and logged.

### Next (coverage)

- Import Halakhah, Kabbalah, Liturgy, Jewish Thought, Chasidut, Musar and Responsa from Sefaria using the same staged browse and per-edition provenance.
- Import public-domain historical Unitarian, Universalist, Ethical Culture and Quaker works from Project Gutenberg and Internet Archive, with edition-level checks.
- Add authorised modern Pagan and Druidry statements where authors permit reuse.
- Add a community-permissions track for Indigenous and oral traditions, including restricted-metadata flags and consultation records.

### Later (platform)

- Put the six recorded near-duplicate pairs through editorial review and record a decision for each, so the report does not become a permanent list of open questions.
- Show the availability history per source as its own timeline; the Sources page currently shows only how many are due.
- Extend near-duplicate detection to editions that share no exact text, by comparing content sketches rather than repeated passages.
- Add classification review by tradition specialists and record dissent, not only a single status.
- Build import manifests for every adapter run and expose failed-record diffs in the provenance view.

## 8. Reproduction

```bash
bun install
bun run db:reset          # rebuilds the curated corpus and registry
bun test                  # registry, classification and manifest checks
bunx tsc --noEmit         # typecheck
bun run build
bun run dev               # serve at http://127.0.0.1:4173 by default
bun run import:fox        # tested public-domain extraction
bun run import:sefaria    # complete Tanakh: 39 books, both editions
bun run import:mishnah    # complete Mishnah: 63 tractates, Hebrew + English
bun run import:sefaria-library  # every Sefaria category, base texts only
bun run scripts/dev/import-quran.ts       # complete Qur’an, Arabic + Pickthall
bun run scripts/dev/import-dhammapada.ts  # complete Dhammapada, Pali + Sujato
bun run scripts/dev/import-christian-sources.ts  # Bible, fathers, Aquinas, apocrypha (streamed)
bun run import:islamic    # hadith, Muwatta, Sufi, kalam and falsafa works (streamed)
bun run normalize:categories    # add the shelf to older work records
bun run check:sources     # approved-source availability check (records checks only)
bun run duplicates        # near-duplicate edition review (about a minute on the full corpus)
```

To use the approval interface, create an account in the app, then grant it an administrator role locally:

```bash
bun run scripts/make-editor.ts you@example.com admin
```

Editors can record checks and queue import requests; only administrators can approve a source or a queue request.

The registry source of truth is `data/registry/sources.json`; textual-function classifications are in `data/corpus/text-functions.json`; tested manifests are in `data/imports/gutenberg-75559-fox.json`, `data/imports/sefaria-tanakh.json`, `data/imports/sefaria-mishnah.json`, `data/imports/sefaria-library.json`, `data/imports/quran-alquran-cloud.json`, `data/imports/dhammapada-suttacentral.json`, `data/imports/christian-sources.json` and `data/imports/islamic-sources.json`.

### Remaining coverage plan

The corpus now has complete Jewish shelves, the complete Qur’an and the complete Dhammapada. The other traditions still hold selected excerpts or catalogue records. The next imports, in priority order, are the ones whose rights and APIs are already clear:

| Tradition | Next source | Rights position |
| --- | --- | --- |
| Christianity | Complete: the Bible (KJV with Hebrew/Greek), CCEL patristic and scholastic works, Summa Theologica, City of God. Next: a public-domain translation of the Gospel of Thomas, and the Greek/Latin originals where a public-domain host exists | Public-domain texts; Gnostic primary texts still need a verified edition |
| Islam | Qur’an, the six canonical hadith collections and the Muwatta are complete and streamed. Next: a verified public-domain English *Risala* or *Hedaya*, and a tafsir with a chapter-level API | Hadith translations credited and streamed, not relicensed; fiqh manuals remain catalogue-only |
| Hinduism | Gita Supersite and GRETIL Sanskrit texts; Gutenberg public-domain translations | Mixed; per-text verification |
| Buddhism | SuttaCentral complete nikayas; 84000 translations under their stated licences | CC0 and CC BY-NC-ND respectively |
| Sikhism | Complete: the Guru Granth Sahib in Gurmukhi with Khalsa's English, indexed by ang and sentence; the Dasam Granth, Bhai Gurdas and the janamsakhis remain catalogue records | Gurbani public; the Gurbani-CD transcription and Khalsa translation used with written permission, not relicensed |
| Taoism | Complete for the public-domain witnesses: the Daodejing in Chinese and Legge's English, the Zhuangzi, Liezi, Yang Chu, the Tai Shang Tractate, the Classic of Purity, the Yin Fu King, the Yin Chih Wen, Carus's Canon of Reason and Virtue, Balfour's Taoist Texts, Giles's Sayings of Lao Tzŭ and Legge's four appendix scriptures. Next: the Huainanzi and the Wenzi | Public-domain translations; modern translations (Graham, Watson, Cleary) in copyright |
| Confucianism | The Analects is present; ctext is restricted, so use Gutenberg or checked public-domain transcriptions | Public domain |
| Zoroastrianism | Avesta.org public-domain translations | Public domain |
| Shinto | Japanese Text Initiative Kojiki/Nihon Shoki translations | Public domain with host terms |
| Bahá’í | Complete for the ten works of Bahá’u’lláh and ‘Abdu’l-Bahá that the Reference Library publishes: streamed from bahai.org, chapter by chapter, with its copyright notice | Authorised for streamed display on 2026-10-26; not relicensed |
| Quaker, UU, Ethical Culture, Pagan, Druid, Rastafari, Theosophy, Anthroposophy, Spiritualism, LDS, Tenrikyo, Cao Dai, Oomoto, Seicho-no-Ie | Registry records only; texts are denominational or in copyright | Link-out until permission |

The liturgical-music proposal (Zemirot Database) is recorded in the registry. A music shelf would catalogue zemirot with melody attributions and links rather than copy audio or notation without permission; the texts themselves can be imported from Sefaria's Piyutim shelf, which is already covered.

## 9. Coverage update — 20 October 2026

A later coverage pass added twenty works: nine on the Islamic shelf (seven Sufi,
one kalam, one falsafa) and eleven new works on the Hindu shelf (seven
Upanishads, the Yoga Sutras, the Brahma Sutras, the Sarva-Darsana-Samgraha and
the Ramayana), together with the complete Gita replacing the earlier two-verse
excerpt. It adds one host, the Internet Archive, for a single item-level
public-domain text, and no dependencies. A later pass added **Quran.com's tafsir
resources** for three classical Arabic commentaries and **al-Nawawi's Forty
Hadith** from the existing Hadith API. The registry now holds **72 sources**,
including the item-level `internet-archive-pd` entry that approves only the
checked Bird Parliament item. All use the same catalogue-plus-passage-index
model. The library now seeds **1,321 works, 2,217
editions, 911,387 passages and 51 local texts**. Islam holds **32 works**
(Sufism 9, Fiqh 7, Hadith 7, Qur'anic studies 3, Falsafa 3, Kalam 2, Qur'an 1);
Hinduism holds **12 works** (Scripture 8, Philosophy 3, Epic 1).

The new Islamic works are Rumi's *Masnavi* (Whinfield, Wikisource), Attar's
*Bird Parliament* (FitzGerald, Internet Archive), Hafiz's *Divan* (Bell,
Gutenberg), Jami's *Salaman and Absal* (FitzGerald), al-Hujwiri's
*Kashf al-Mahjub* (Nicholson), Saadi's *Gulistan* (Ross), al-Ghazali's *Moral
Teachings* (Syed Nawab Ali), al-Ghazali's *Short Creed* (Macdonald) and Ibn
Tufail's *Hayy ibn Yaqzan* (Brönnle). The Hindu works are the complete Gita
(Arnold), the Chandogya, Kena, Aitareya, Isha, Katha, Mundaka and Prashna
Upanishads (Max Müller, SBE), the Yoga Sutras (Johnston), the Brahma Sutras
(Thibaut), the Sarva-Darsana-Samgraha (Cowell and Gough) and the Ramayana
(Griffith).

Jurisprudence is still the thinnest Islamic shelf. The standard English
translations of al-Shafi'i, al-Qayrawani and Ibn Rushd are in copyright, and
Hamilton's public-domain *Hedaya* survives only as uncorrected OCR; the project
continues to catalogue those works rather than serve text it cannot check. The
Upanishad set is likewise limited by transcription: the Brihadaranyaka,
Taittiriya, Svetasvatara, Maitrayana and Kaushitaki are not available as
complete Wikisource pages. Details, per-work counts and the verification record
are in `docs/islamic-hindu-coverage.md`.

## 10. Coverage update — 22 October 2026

The three partial Hindu records are now complete. The Taittiriya Samhita is
streamed in all seven kandas from the Internet Sacred Text Archive, Shankara's
Brahma Sutra commentary is held locally in sixteen padas with Part II from the
same archive, and the Ramayana's Uttara Kanda is a new streamed record in
Dutt's prose, since Griffith's translation ends at the sixth book. Details and
the per-work figures are in `docs/hindu-expansion.md`.

This pass promotes the **Internet Sacred Text Archive** from `rejected` to
`approved`: the registry had recorded that automated retrieval was not
permitted, and the project owner authorised its use on 22 October 2026. Its
robots file now allows crawling and its copyright page permits reuse of the
public-domain files, while its terms still ask readers not to scrape or
overload the service. Access is therefore chapter-sized, cached, and fetched
once per page by the importers; nothing is bulk-crawled. The registry entry
records the decision and the access limits rather than hiding them.

The library now seeds **1,350 works, 2,252 editions, 1,284,630 passages and
1,678 texts** across 73 sources. Hinduism holds **21 works and 51,282
passages**. The Brihadaranyaka, Svetasvatara, Maitrayana and Kaushitaki
Upanishads remain unimported for want of a complete transcription, but the
Sacred Text Archive is a promising route for them and for other gaps in the
Hindu, Buddhist and Zoroastrian shelves.

## 11. Coverage update — 22 October 2026 (Sacred Books of the East)

A sweep of the Internet Sacred Text Archive added **eleven complete Sacred
Books of the East volumes** as streamed works, chosen to fill the three
emptiest shelves rather than to import the archive wholesale:

| Shelf | Added | Effect |
| --- | --- | --- |
| Zoroastrianism | Vendidad (SBE 4), Yasna with Visparad, Afrinagan and Gahs (SBE 31), Sirozahs, Yashts and Nyayis (SBE 23) | The shelf goes from one catalogue-only record to three complete texts; the Gathas are now read where they belong, inside the Yasna |
| Hinduism | Laws of Manu (SBE 25), Sankhya Aphorisms of Kapila, Hatha Yoga Pradipika | The Dharmasastra gap is closed, and the philosophical and yoga shelves gain their primary manuals |
| Buddhism | Sutta-Nipata (SBE 10), Buddhist Suttas (SBE 11), Questions of King Milinda (SBE 35–36), Buddhist Mahayana Texts (SBE 49), Lotus Sutra (SBE 21) | First Mahayana scripture, first paracanonical Pali dialogue and the complete Sutta-Nipata; the shelf moves beyond the nikayas |

The eleven works hold **264 chapters, 27,483 passages and 957,691 words**. The
library now seeds **1,361 works, 2,263 editions, 1,312,113 passages and 1,678
texts** across 73 sources. Traditions now hold: Judaism 973 works, Buddhism 192,
Christianity 90, Islam 52, Hinduism 24, Zoroastrianism 4.

All eleven are public-domain translations of printed editions, streamed from
the archive at read time. The importer is generic: a volume is described by its
index page and one or more ranges of chapter links, so front matter is skipped
and a multi-volume work (Milinda) is combined without special code. Page-number
furniture and section rules are removed before the passage index is built, and
the exact segments are cached so the search index never crawls the host twice.

The acquisition register gained the eleven imported targets and four wanted
records for the largest remaining volumes: the Pahlavi Texts (SBE 5, 18, 24, 37,
47), the Satapatha Brahmana (SBE 12, 26, 41, 43, 44), the Vinaya Texts (SBE 13,
17, 20) and the Jataka (six volumes). The Brihadaranyaka, Svetasvatara,
Maitrayana and Kaushitaki Upanishads remain unimported as separate records; the
archive carries them only inside SBE 1 and 15, whose other texts the library
already holds in individual editions, so a later pass should slice those two
volumes rather than duplicate the whole set.

Details, per-work figures, the segmentation rules and the verification record
are in `docs/sacred-texts-expansion.md`.

## 12. Coverage update — 22 October 2026 (Pahlavi and Brahmana)

The second Sacred Books pass completes the two shelves the first one left open.
It adds **six works and 936 chapters**:

- **Pahlavi Texts, Parts I–V** (SBE 5, 18, 24, 37, 47; E. W. West, 1880–1897):
  the Bundahis, the Selections of Zad-sparam, the Bahman Yast and Shayast
  la-Shayast; the Dadistan-i Dinik and the Epistles of Manushchihar; the
  Mainog-i Khirad, the Sikand-Gumanik Vigar and the Sad Dar; the Denkard's
  summaries of the lost Nasks (Books VIII and IX); and the Marvels of
  Zoroastrianism (Denkard Books VII and V). Zoroastrianism now holds **nine
  works**, three Avestan and five Pahlavi.
- **Satapatha Brahmana** (SBE 12, 26, 41, 43, 44; Julius Eggeling,
  1882–1900): all fourteen kandas, read as one work of 394 printed brahmanas.
  Hinduism now holds **twenty-five works**, and gains its first Brahmana.

The six works add **26,865 passages and 1,230,305 words**. The Sacred Books
shelf stands at **seventeen works, 1,200 chapters, 54,348 passages and
2,187,996 words**. The library seeds **1,367 works, 2,269 editions and
1,338,978 passages**.

Two source facts are recorded rather than papered over. The archive's
Dadistan-i Dinik transcription omits printed Chapter XXII (the numbering jumps
from XXI to XXIII), so the work is marked complete apart from that gap. And the
Denkard volume contains Book VIII followed by Book IX, each restarting at
Chapter I; the boundary was verified from the page headings and the chapters are
prefixed accordingly. The Pahlavi shelf also required adding `pal` (Pahlavi /
Middle Persian) to the corpus language list.

The remaining large volume gaps are now the Vinaya Texts (SBE 13, 17, 20) and
the Jataka (six volumes), both recorded as wanted in the acquisition register.
The Brihadaranyaka, Svetasvatara, Maitrayana and Kaushitaki Upanishads remain
unimported as separate records, since the archive carries them only inside SBE
1 and 15 alongside texts the library already holds individually.

## 13. Coverage update — 22 October 2026 (Vinaya and Jataka)

The third Sacred Books pass closes the two largest gaps on the Buddhist shelf:

- **Vinaya Texts** (SBE 13, 17, 20; T. W. Rhys Davids and Hermann Oldenberg,
  1881–1885): the Pātimokkha, the ten Mahāvagga khandhakas and the twelve of
  the Kullavagga, read as one work of 321 printed pages. Chapter labels carry
  the khandhaka and the number printed on the page, because the archive's index
  restarts at Chapter 1 for each khandhaka and repeats or skips numbers in
  places. This adds **9,464 passages and 321,779 words**.
- **The Jataka** (six volumes; E. B. Cowell, ed., 1895–1907): all 547 birth
  stories in printed order, in **16,510 passages and 869,270 words**. One page
  in volume III is an older transcription with a different opening rule; the
  importer detected it, recorded the marker for that page alone, and the reader
  uses it, so no chapter silently realigns or drops its text.

The two works add **868 chapters, 25,974 passages and 1,191,049 words**. The
Sacred Books shelf now holds **eighteen works, 1,521 chapters, 63,812 passages
and 2,509,775 words**. The library seeds **1,369 works, 2,271 editions and
1,364,952 passages** across 73 sources; Buddhism holds **194 works**.

Both acquisition targets (`vinaya-texts`, `jataka`) are now marked imported
with their figures. On the Hindu side the Brihadaranyaka, Svetasvatara,
Maitrayana and Kaushitaki Upanishads remain unimported as separate records for
the reason given above.

## 14. Coverage update — 23 October 2026 (Taoist shelf)

The Taoist shelf was compiled from the Internet Sacred Text Archive: the
complete Zhuangzi in Legge's thirty-three-book recension, Giles's seven-book
Liezi and Yang Chu, Legge's Tai Shang Tractate, Classic of Purity and Yin Fu
King, and the Suzuki–Carus Yin Chih Wen. The pass adds seven works, 63 chapters,
2,894 passages and 168,795 words. The library seeds **1,401 works, 2,305
editions and 1,474,996 passages** across 78 sources; Taoism holds **8 works**,
seven with running text.

A new source, **Terebess Asia Online**, is recorded in `under_review`. It
mirrors the public-domain Legge and Giles volumes already used here and hosts
modern translations (Cleary, Watson, Mair, Wong, Graham) in copyright, so
nothing was imported from it; it supplies leads for the Huainanzi, the Wenzi, a
complete Liezi and a modern Zhuangzi. The pass is described in
[taoist-expansion.md](taoist-expansion.md).

## 15. Coverage update — 23 October 2026 (the complete Daodejing)

The Taoist shelf is now complete for the public-domain English witnesses. The
largest single gap was the classic itself: the corpus held a four-chapter
sample of the Daodejing under a note that described it as the whole work. It is
now complete in two editions.

- **The Daodejing** holds all **81 chapters**: the Chinese text of Wang Bi's
  recension, punctuated and without his interlinear commentary, and Legge's
  complete translation of 1891. It is the only Taoist work held locally, because
  the two editions are read chapter by chapter in parallel; each chapter is one
  passage, so `Daodejing 1` and `Daodejing 81` mean what the rest of the corpus
  means by them. The work adds **10,557 English words and 6,457 Chinese
  characters** and replaces the sample.
- **Five more works are streamed** from the Internet Sacred Text Archive:
  Carus and Suzuki's *Canon of Reason and Virtue* (1913), Balfour's *Taoist
  Texts* (1884, ten scriptures), Giles's *Sayings of Lao Tzŭ* (1905), and
  Legge's two remaining appendix scriptures, the *Yu Shu King* and the *Zah
  Yung King*. Together they add **102 chapters, 1,150 passages and 62,356
  words**.

The Taoist shelf now holds **13 works and 4,125 passages**. The Sacred Text
Archive shelf stands at **56 works, 4,843 chapters, 131,039 passages and
5,520,488 words**. The library seeds **1,406 works, 2,310 editions and
1,476,223 passages** across 78 sources.

The Chinese text is a change of edition. The Daozang transcription on
Wikisource, which supplied the sample, is damaged: only seventy-three of its
eighty-one chapters have a heading at all, ten of those headings are glued onto
the end of the preceding chapter's last line, and chapters 30–37 have none. A
complete text cannot be built from it without invention, so the Wang Bi
recension, which is cleanly divided and punctuated, is used instead. Legge's
English comes from Project Gutenberg eBook #216 rather than from the archive,
because a locally held text may not be transcribed from a host whose terms keep
the transcription on its own site; the archive's chapter pages remain the
fallback for the streamed volumes.

Two transcription facts are recorded rather than smoothed over. Balfour's
prefaces and footnotes stand with his texts, as they do in the printed volume,
so the chapter for the Tao Te Ching opens with his note on earlier
translations. Legge's appendix pages break a sentence wherever the printed page
turned, so the *Zah Yung King* has paragraphs that begin mid-sentence; the note
on the work says so. Carus's pages print the page number inside a running
paragraph ("it p. 76 resembleth"), which the reader was showing as text; the
extractor now drops the archive's `page_N` anchors whenever a volume asks for
page numbers to be removed.

**Terebess Asia Online** was reviewed item by item for this pass and is now
`restricted` for ingestion, with nothing imported. Its public-domain holdings
are the Legge and Giles volumes the library already streams from the archive;
its unique holdings are modern translations and studies in copyright; and its
Daodejing page is a bibliography of 112 translations rather than a text. It was
useful in the opposite direction: the list of translations is what confirmed
that the public-domain English Daodejings are Legge, Balfour, Carus and Suzuki,
Goddard, Medhurst, Mears, Gorn-Old and Giles, of which all but Mears and
Gorn-Old are now on the shelf. The register records the review and the rejection
of ingestion, not of citation.

The pass is described in [taoist-expansion.md](taoist-expansion.md).

## 16. Coverage update — 26 October 2026 (the Bahá’í writings)

The Bahá’í shelf is new. The library previously catalogued the tradition and
imported none of its text, because the Reference Library's terms are site-level
and no compatible edition existed elsewhere; the project owner authorised
access on **26 October 2026**, and the shelf is now ten streamed works.

**The works.** Bahá’u’lláh: the Hidden Words (both parts), the Kitáb-i-Aqdas,
the Kitáb-i-Íqán, The Seven Valleys, The Four Valleys, Gleanings from the
Writings of Bahá’u’lláh, the Epistle to the Son of the Wolf, the Tablets of
Bahá’u’lláh Revealed after the Kitáb-i-Aqdas and Prayers and Meditations.
‘Abdu’l-Bahá: Some Answered Questions. Together they add **461 chapters, 4,375
passages and 452,612 words** — the scripture of the tradition, its law, its
mystical treatises, its devotional book and the book in which its teaching is
argued out in answer to questions.

**How the text is addressed.** The Reference Library publishes each work as a
series of numbered reading views (/1, /2, /3 …) that are the site's own
pagination, not a division of the text, and it prints the publication's own
markup inside them: a part or chapter title is a heading, a numbered paragraph
carries the number the printed book carries, and an unnumbered paragraph
carries none. The import walks the views a work needs, groups the paragraphs
into the work's own chapters, and records which views each chapter spans and the
paragraph range inside them, so the reader fetches exactly the views that
chapter needs and shows the paragraphs the passage index was built from. The
numbering is kept as the passage reference, because it is the numbering Bahá’í
reference works cite: the Kitáb-i-Aqdas 1–190, the Hidden Words 1–71 and 1–82,
Gleanings' selections I–CLXVI, Some Answered Questions' chapters 1–84 with
their paragraphs, the Tablets' sixteen tablets and their appendix, and Prayers
and Meditations' prayers I–CLXXXIV. Where the library prints no numbers — the
Íqán, the Epistle, the paragraphs of a tablet or a prayer — the passages are
indexed in reading order, and the unnumbered paragraphs of a numbered chapter —
the invocation that opens each part of the Hidden Words, the answers in the
Kitáb-i-Aqdas' Questions and Answers (whose questions are numbered and whose
answers are not), the later continuations of a Hidden Words passage — are
indexed `u1`, `u2` … so that they are addressable without inventing a number the
publication does not print.

**What is not imported.** The publication's apparatus stays with the
publication: the translator's foreword and ‘Abdu’l-Bahá's preface to Some
Answered Questions, Shoghi Effendi's description of the Kitáb-i-Aqdas and the
synopsis and codification of its laws, the notes and the key to passages, and
the Tablets' note on the translations of Shoghi Effendi. The reader never
presents editorial apparatus as scripture, and the reader's notice says which
edition is being read.

**Rights.** The registry entry `bahai-reference-library` records
`site_copyright_conditions_with_owner_authorisation`: the works remain the
copyright of the Bahá’í International Community, are streamed from bahai.org
under its legal terms, are shown with the Community's copyright notice, the
title of the work and the translator named, and are not relicensed or used
commercially. Nothing is written into the corpus or the database: the import
cache holds only the segments that were validated, which is what the search
index is built from. Requests stay chapter-sized, cached, and identified by a
descriptive user agent; the library is never bulk-crawled.

**Verification.** The ten works were read end to end through the reader: each
reported `aligned: true` against its local passage index, each showed the
copyright notice beside the text, and search returned the imported passages
with their references. The extraction rule is covered by tests, and the shelf's
shape — works, chapter counts and numbering — is asserted against the catalogue
files.

**What remains.** The Reference Library also publishes the writings of the Báb,
Shoghi Effendi's letters and longer works, and the rest of ‘Abdu’l-Bahá's
books — the Secret of Divine Civilization, Memorials of the Faithful, the
Tablets of the Divine Plan and the talk collections. None is imported yet. The
Persian and Arabic originals of the works now held are published by the library
only as downloads, so the shelf is English-only, as the edition records state.
The pass is described in [bahai-expansion.md](bahai-expansion.md).

## 17. Near-duplicate review and source intake — 30 October 2026

**Source intake.** A discovery no longer has to be a hand edit of
`data/registry/sources.json`. `/admin/sources` has a **Record a discovery** tab:
an editor or administrator enters the source's ID, name, organisation, address,
API or download page, licence terms and status, the traditions, languages and
content types it covers, a priority, and why it matters. The ID must be a
lowercase slug; URLs must be http(s); traditions must exist in the catalogue;
language codes come from the registry's own labels; and the note is required,
because a lead without a reason is not reviewable. The record is inserted as
`discovered` / `pending` with a `source_checks` row naming the person who filed
it, and the same entry is appended to `data/registry/sources.json` through a
temporary file, so a corpus rebuild keeps the discovery. If the file cannot be
written the database row still stands and the response says so. Filing is not
approval: only an administrator can move the entry forward, and no import is
triggered. Later review decisions live in the database; the registry file keeps
the entry as it was filed, because a rebuild re-reads it from there.

**Near-duplicate scan.** The ingest pipeline's duplicate check compares exact
checksums, so a text that differs by a quotation mark, a spelling or an
encoding error is treated as new. `bun run duplicates` looks for those pairs in
two stages. First it groups the text table by checksum and counts the
substantive passages (eight words or more) each pair of editions repeats;
editions that share no text are never compared, and a shared reference number
alone is not evidence. Second it samples the references both editions number —
evenly across the work, by modulo on the stored sort order — and compares each
pair of texts: byte equality is *identical*, equality after search
normalisation (punctuation, case, diacritics, Arabic and Hebrew orthographic
variants, Greek final sigma, Latin ligatures) is *equivalent*, and word-trigram
Jaccard similarity at or above the threshold (`0.8` by default) is *near*.
Character trigrams replace word trigrams for CJK. Results are stored in
`duplicate_scans` and `duplicate_pairs` and shown under **Near duplicates** in
the admin page, with the sampled passages side by side. A scan only reports; it
never merges editions, deletes text or rewrites a catalogue record.

**Findings (scan #2, 30 October 2026).** The scan loaded **3,602 catalogue
editions** (only the locally held ones can be compared);
**9,954** edition pairs repeat substantive passages; **54** of those pairs share
a language and at least twenty repeated passages and were compared; **six**
crossed the 50% recording threshold. It took 58 seconds.

| Pair | Similarity | Repeated | Sampled | Identical | Equivalent | Near | Different |
| --- | --- | --- | --- | --- | --- | --- | --- |
| walker-harmony ↔ walker-harmony2 | 100.0% | 1,344 | 31 | 31 | 0 | 0 | 0 |
| bible-gntscr ↔ bible-gntste | 99.4% | 7,457 | 195 | 192 | 0 | 1 | 2 |
| bible-ceb-b ↔ bible-ceb-p | 78.0% | 22,994 | 198 | 149 | 0 | 0 | 49 |
| bible-gntscr ↔ bible-gntwh | 73.3% | 3,788 | 195 | 95 | 1 | 11 | 88 |
| bible-gntste ↔ bible-gntwh | 71.6% | 3,774 | 191 | 87 | 3 | 12 | 89 |
| bible-esrv ↔ bible-essav | 61.8% | 2,774 | 198 | 20 | 32 | 18 | 128 |

The first two are duplicate catalogue records rather than editions: Walker's
*Harmony* is imported twice under two work slugs with identical text, and the
two Common English Bible records share 22,994 passages. The Spanish pair is the
clearest fuzzy finding: 32 sampled passages are identical once punctuation and
accents are folded and 18 more are near, including one pane that reads
`habrÃ¡` where the other reads `habrá` — the same text through a broken
encoding, which an exact checksum records as a different text. The Greek
records are revisions of one another. None of these is a defect to delete
automatically; each is a question for an editor, which is why the scan stores
findings and stops.

**Verification.** `bun test` covers the comparator: byte equality, punctuation
and case, diacritics and script variants, a one-word change in a paragraph,
unrelated text, the threshold, CJK trigrams and symmetry. `bunx tsc --noEmit`
is clean. The scan was run against the full corpus twice (the second run
recorded above), the admin endpoint was read with an editor session, and both
new tabs were exercised in the browser: the intake form rejected a malformed ID
and a missing note, recorded a valid source, linked to its pending record, and
appended it to a copy of the registry file; the duplicate tab listed the six
pairs with their sampled passages. The temporary account, the test source and
the registry copy were removed afterwards.

**What this does not do.** A pair that was reworded on every line shares no
passage and is not proposed. Streamed works have no local copy to sample and
are excluded. The similarity is a texture of word trigrams, not an alignment:
it says two passages are close, not which words changed. And the threshold is a
review aid — the examples are shown so an editor can disagree with it.
