# GRETIL Sanskrit expansion

GRETIL — the Göttingen Register of Electronic Texts in Indian Languages — is the
largest single source in the library: **80 works, 6,760 chapters, 256,744
passages** (about 3.5 million words) of Sanskrit, streamed from Göttingen at
read time. Nothing of it is copied into the corpus; the catalogue record, the
chapter outline and the passage index are local, and the reader fetches the
chapter it needs from the register's plain-text transformation.

The register is an academic e-text collection: each file is a transcription of a
named edition by a named inputter, and most files are distributed under
**CC BY-NC-SA 4.0** (the terms vary file by file and each file states its own).
The source record in `data/registry/sources.json` carries that position, so no
GRETIL text is relicensed, sold or redistributed by the library, and the edition
and inputter GRETIL names are recorded on each work.

## 1. What is imported

| Shelf | Works | Examples |
| --- | ---: | --- |
| Purana | 15 | Agni (22,341 passages), Nārada, Bhāgavata, Brahmāṇḍa, Garuḍa, Śiva, Matsya, Viṣṇu, Kūrma, Liṅga, Mārkaṇḍeya, Narasiṃha, Vāmana, Vāyu (Revākhaṇḍa), Skanda (Revākhaṇḍa) |
| Upanishad | 10 | Bṛhadāraṇyaka, Chāndogya, Aitareya, Īśā, Katha, Praśna, Taittirīya, Śvetāśvatara, Brahmabindu, Māṇḍūkya — six of them with Śaṅkara's commentary as a second edition of the same work |
| Mahayana | 7 | Bodhicaryāvatāra, Mūlamadhyamakakārikā, Laṅkāvatāra Sūtra, Saddharmapuṇḍarīka, Samādhirāja Sūtra, Suvarṇaprabhāsa Sūtra, Lalitavistara |
| Veda | 6 | Ṛgveda Saṃhitā (1,028 chapters), Paippalāda Saṃhitā, Khilāni, Ṛgvidhāna, Kauṣītaki and Gopatha Brāhmaṇas |
| Tantra | 6 | Tantrāloka (5,860 passages), Devīgītā, Vijñānabhairava, Śivasūtras, Spandakārikā, Saundaryalaharī |
| Dharmasastra | 5 | Mānava, Nārada, Yājñavalkya, Viṣṇu, Gautama |
| Poetry | 5 | Raghuvaṃśa, Kumārasaṃbhava, Meghadūta, Gītagovinda, Hitopadeśa |
| Vedanta / Darshana / Philosophy | 11 | Vedārthasaṃgraha, Vivekacūḍāmaṇi, Māṇḍūkyakārikā, Rāmānuja's Gītābhāṣya, Nyāyasūtra, Vaiśeṣika Sūtra, Mīmāṃsā Sūtra, Sāṃkhyakārikā, Tarkasaṃgraha, Abhidharmakośa, Yogabhāṣya |
| Scripture / Epic | 6 | Vālmīki's Rāmāyaṇa (18,761 passages), Harivaṃśa, Nārāyaṇīya, Aṣṭāvakragītā, Nāradapañcarātra, Udānavarga |
| Grammar, Aesthetics, Drama, Science, Bhakti, Jātaka, Vinaya | 9 | Aṣṭādhyāyī, Vākyapadīya, Nāṭyaśāstra, Sāhityadarpaṇa, Abhijñānaśākuntala, Āryabhaṭīya, Bhaktirasāmṛtasindhu, Jātakamālā, Mahāvastu |

The shelf is catalogued like every other source: works, editions, chapters,
passages, textual functions, and entries in the acquisition register for the
works that could not be imported honestly.

## 2. How a GRETIL file is read

One GRETIL file is one work, and its reference scheme is not standard across the
register. Each work's stream configuration therefore records what the file
actually prints:

- **`abbreviation`** — the siglum GRETIL writes beside each reference
  (`Raghu`, `BhG`, `NarS`), or **`refPattern`** for the files that print a bare
  number or wrap their references in `|| … ||`.
- **`unitDepth`** — how many components of a reference name a passage
  (`1.2.3` = kāṇḍa.hymn.verse, `1.2` = chapter.verse). A heading the file marks
  like a verse is filtered out rather than indexed as text.
- **`skipLeadLines`** — the title, homage and editor's note the file prints
  above the opening verse.
- **`trimDecorations`** — the editor's brackets, variant readings and underscore
  padding around a segment.
- **`dropRefPrefix`** — an edition's own numbering that precedes the reference.
- **`componentLabels`** — the words the reader uses for the parts
  (`Kāṇḍa {v}`, `Sūkta {v}`, `Kośasthāna {v}`).
- **`editions`** — where one file carries both a text and its commentary
  (Īśā and Śaṅkara's bhāṣya, Māṇḍūkya and its kārikā), the editions are read
  from the same file with their own sigla.

The reader verifies the served text against the indexed passage count and says
so when a chapter no longer matches, so a changed file upstream is visible
rather than silent.

## 3. What was not imported, and why

- **Pādārthadharmasaṃgraha (Praśastapāda).** GRETIL's file
  (`sa_prazastapAda-pAdArthadharmasaMgraha`) changes reference depth inside the
  text — chapter headings, `chapter.aphorism` references, three- and
  four-component references all occur — so no single depth can be read from it
  without dropping about a third of the text. The work was removed from the
  corpus and returned to the acquisition register as *wanted*, with the finding
  recorded against it.
- **No translation is imported.** GRETIL is a Sanskrit (and Pali, Prakrit)
  register; the library's GRETIL shelf is original-language only, and the
  English translations on the same shelves come from other sources.
- **No per-file licence audit beyond the register.** Every file states its own
  terms; the source record records CC BY-NC-SA 4.0 as the position of the
  Sanskrit corpus and requires the individual terms to be read before reuse.

## 4. Open item: decorations left in the text

The register's transcriptions carry the printed edition's furniture inside the
segment text. Measured over the import caches:

| Pattern | Works | Passages | Example |
| --- | ---: | ---: | --- |
| `// … //` verse delimiters | 57 | 158,336 | `… militāvubhau //` |
| `$`, `%`, `&` inline separators | 11 | 3,902 | `… tamagocaram & govindaṃ …` |
| leading `*NN` editorial numbers | 5 | 535 | `*1 sadakṣaraṃ brahma …` |
| underscore rules | 2 | 517 | Mahāvastu, Māṇḍūkya |
| leaked file token | 1 | 1 | `,mang_cd/ chapter 1 …` in the Śiva Purāṇa |

They are readable but they are the edition's marks, not the text, and the
Purāṇas — where the delimiters wrap almost every verse — are the clearest case
for a trimming pass. Stripping them means changing the read rules for the
affected works and re-importing those files (the caches are parsed output, so a
re-import re-downloads them).

## 5. Verifying the shelf

```sh
bun run import:gretil --dry-run          # every work's chapters and references
bun run import:gretil --only=<slug>      # one work, from the cache if present
bun run import:gretil --only=<slug> --force   # re-download and re-parse
bun run db:rebuild                       # corpus validation, then the search index
bun test                                 # 122 tests across 7 files
```

A GRETIL work is verified the way the reader uses it: `GET
/api/read/<slug>/<reference>` must return `provider: "gretil"`, `aligned: true`
and text, and the work's `school` and `author` must exist in
`data/corpus/meta.json` — the corpus validator rejects a work that points at a
school or author the library does not hold.
