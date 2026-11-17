# Acquisition register

The acquisition register records requested works that do not yet have a
verified edition in this library. It is separate from the source registry: a
source describes where texts can come from, while a target describes one work
that is still wanted, the languages needed, the rights position and the leads
that a later pass should check.

The register lives in [`data/registry/acquisition.json`](../data/registry/acquisition.json)
and is seeded into `acquisition_targets`. It is exposed at `/api/acquisitions`
and shown on the Sources page under “Works requested, not yet acquired”.

## Status values

| Status | Meaning |
| --- | --- |
| `wanted` | The work is requested but no usable edition has been located. |
| `located` | A promising text or scan has been found, but it has not been checked or imported. |
| `rights_blocked` | A text exists, but the needed language edition is in copyright or has no stated permission. |
| `imported` | The work has been imported. Keep the entry so the editorial trail survives. |

## Adding a target

Add an object to `targets` with a stable slug, the title in English and the
original script where known, author, tradition, school, genre and category. Then
record:

- `languages` — BCP 47 codes needed, for example `["ar", "en"]`.
- `source_leads` — one or more `{ source, url, note }` entries. A URL is a place
  to look, not a claim that the edition is usable.
- `rights_note` — the position on the original and on any translation.
- `note` — why the work matters and what blocked the previous attempt.

Run `bun run db:reset` to load the file. The Sources page groups targets by
status and priority.

## Promoting a target

When an edition is imported, change its status to `imported` and add a short
note naming the edition that was used. Do not delete the entry. If the work is
removed later, its acquisition history should still be recoverable.

## Remaining known gaps

The first register records *Sunan al-Darimi* (Arabic, with the OpenITI author
directory and Shamela as leads), five principal Upanishads whose pages were
missing or untranscribed, and the *Ramayana*'s Uttara Kanda. Their source leads
are deliberately conservative: a different host or a checked transcription may
be needed before import.

The Hindu expansion added 107 Hinduism entries to the same register: 8 imported
works, 10 located but not importable as transcribed, 83 with no verified
reusable text, and 6 blocked by copyright. The edition, coverage and rights
position of each are recorded there; the pass is described in
[hindu-expansion.md](hindu-expansion.md).

The Sikh expansion added 26 entries: 3 imported works — the Sacred Text
Archive's two volumes and the complete Guru Granth Sahib, imported under
written permission — the four liturgies imported as chapters of MacAuliffe's
volume 1, 10 works located, and 9 blocked. The blocked entries are largely the
complete English translations of the Dasam Granth, Bhai Gurdas and the
janamsakhis, which are modern works even where the underlying scripture is
public domain. The pass is described in [sikh-expansion.md](sikh-expansion.md).

The Taoist expansion added 18 entries, in two passes. The first recorded the
seven works imported from the Sacred Text Archive (Zhuangzi, Liezi, Yang Chu,
the Tai Shang Tractate, the Classic of Purity, the Yin Fu King and the Yin Chih
Wen), three located works (the Huainanzi, the Wenzi and the Daoist canon) and
two blocked ones (a complete English Liezi, Graham 1960, and a modern Zhuangzi,
Watson 1968, both hosted by Terebess). The second pass completed the Daodejing
and imported the remaining public-domain volumes: Legge's two appendix
scriptures (the Yu Shu King and the Zah Yung King), Carus and Suzuki's Canon of
Reason and Virtue, Balfour's Taoist Texts and Giles's Sayings of Lao Tzŭ —
thirteen imported entries in all, three located and two blocked. The passes and
the Terebess assessment are described in
[taoist-expansion.md](taoist-expansion.md).

The CCEL expansion added no entries. The Christian Classics Ethereal Library
holds the whole of its public-domain English corpus as a plain-text file per
work, and the importer takes the site's own catalogue as its acquisitions list,
so the works it imports were never *requested* here: the register is left to
record what is still wanted, and the pass keeps its own manifest at
[`data/imports/ccel.json`](../data/imports/ccel.json), with the works it holds
and the leads it could not — the works the site offers only as an ebook, the
ones it carries by a publisher's permission, and the catalogue entries whose
file belongs to the collected volume they sit in. The pass is described in
[ccel-expansion.md](ccel-expansion.md).

The Bahá’í expansion added the tradition's first 10 entries, all `imported`: the
ten published works of Bahá’u’lláh and ‘Abdu’l-Bahá that the Bahá’í Reference
Library serves as reading views. Each names the work's page in the library as
its source lead, records that access was authorised by the project owner on
26 October 2026, and states the rights position: the texts are the copyright of
the Bahá’í International Community, are streamed from bahai.org under its legal
terms with the Community's copyright notice, and are not relicensed. The works
are written by the importer, which records a target for every work it imports,
so the register and the shelf cannot disagree. The pass is described in
[bahai-expansion.md](bahai-expansion.md).
