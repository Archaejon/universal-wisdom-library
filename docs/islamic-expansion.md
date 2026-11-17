# Islamic shelf: tafsir and hadith expansion

This pass added four requested works with a verifiable text source and four
author records. The existing Fiqh compendia were re-checked for text and
remained catalogue-only at the time; a later pass streams their Arabic from
OpenITI (see [`openiti-arabic.md`](openiti-arabic.md)). The reasons the English
editions were rejected are recorded below.

## 1. Works mirrored from a host

| Work | Author | Text | Host | Structure |
| --- | --- | --- | --- | --- |
| *Jami' al-Bayan 'an Ta'wil Ay al-Qur'an* (Tafsir al-Tabari) | al-Tabari (839–923) | Arabic | Quran.com tafsir resource 15 | 114 surahs, 6,236 ayahs |
| *Tafsir al-Qur'an al-'Azim* (Tafsir Ibn Kathir) | Ibn Kathir (1301–1373) | Arabic | Quran.com tafsir resource 14 | 114 surahs, 6,236 ayahs |
| *Al-Jami' li-Ahkam al-Qur'an* (Tafsir al-Qurtubi) | al-Qurtubi (1214–1273) | Arabic | Quran.com tafsir resource 90 | 114 surahs, 6,236 ayahs |
| *Al-Arba'un al-Nawawiyya* | al-Nawawi (1233–1277) | Arabic + English | Hadith API (`nawawi`) | 1 book, 42 reports |

The three commentaries are public-domain Arabic works. Their digital text is
streamed one surah at a time and placed at the ayah named by the host, so a
missing commentary cannot shift the rest of the surah. Quran.com's al-Tabari
resource omits three ayahs of Surah 55; those positions carry a note and the
alignment stays true.

The Forty Hadith are streamed section by section from the same Hadith API as
the six collections. The English translator is not identified by the host, so
the translation is credited to the host and not relicensed.

## 2. Authors added

`data/corpus/meta.json` gained `al-tabari`, `ibn-kathir`, `al-qurtubi` and
`al-nawawi`, each with dates and a short description. The new works point at
these records, and the library API returns them as the work's author.

The catalogue's existing Fiqh manuals already carry authors (`al-shafii`,
`as-sarakhsi`, `sahnun`, `ibn-qudama`, `al-marghinani`), as do the hadith and
Sufi works. No author record is invented for the Qur'an, which is catalogued
under revelation rather than human authorship.

## 3. Fiqh compendia: what the search found

The six catalogue-only manuals were checked again:

- **Al-Hidaya** (al-Marghinani). Hamilton's 1791/1870 English translation is
  public domain. Two Internet Archive copies were downloaded and read this
  pass, including the 1870 second edition with Grady's index. Their OCR
  corrupts words throughout — "puritication", "imitive", "proprictor",
  "Mussulman" — and breaks sentences across columns. It is not an edition this
  library can present as checked text.
- **Al-Risala** (al-Shafi'i). Khadduri's translation (1961) is in copyright; no
  public-domain English translation was found.
- **Kitab al-Umm** (al-Shafi'i), **Al-Mabsut** (al-Sarakhsi),
  **Al-Mudawwana** (Sahnun) and **Al-Mughni** (Ibn Qudama). Arabic editions are
  digitised, but the accessible copies are page scans with unreliable OCR. No
  English translation in the public domain was verified.

### Superseded by the OpenITI pass

A later pass read the Arabic directly from OpenITI's mARkdown corpus instead of
waiting for a translation. Al-Hidaya, Al-Mabsut, Al-Mudawwana, Bidayat
al-Mujtahid, Al-Muwafaqat, Al-Mughni, al-Shafi'i's *Risala* and *Kitab al-Umm*
and several other manuals are now streamed; the English OCR problem no longer
blocks the Arabic. See [`openiti-arabic.md`](openiti-arabic.md) for the parser,
rights, search index and limits.

## 4. Remaining requested works

After the second OpenITI pass, most of the requested shelf is streamed:

- **Qur'anic studies.** Al-Zamakhshari's *Kashshaf*, Fakhr al-Din al-Razi's
  *Mafatih al-Ghayb*, al-Wahidi's *Asbab al-Nuzul* and al-Suyuti's *Itqan* are
  all imported in Arabic.
- **Hadith.** *Riyad al-Salihin*, *Muqaddimat Ibn al-Salah*, *Musnad Ahmad*,
  *Mishkat al-Masabih*, *Bulugh al-Maram* and *Nukhbat al-Fikar* are imported.
  *Sunan al-Darimi* is the remaining gap; it has an acquisition entry with
  source leads and a rights note.
- **Aqida, falsafa, Sufism, Shi'a, history and ethics.** Al-Maturidi's *Kitab
  al-Tawhid*, al-Kafi, the *Fusus al-Hikam*, *Al-I'tisam* and *Mukhtasar Minhaj
  al-Qasidin* are streamed in Arabic. Other titles on the list still depend on a
  clean transcription or a public-domain translation, and are recorded in the
  acquisition register rather than presented as available.

## 5. Reproduction

```bash
bun run scripts/dev/import-islamic-expansion.ts
bun run import:openiti
bun run db:reset
bun run index:streams
bunx tsc --noEmit
bun test
bun run build
```

The seeding result after the second OpenITI pass is **1,341 works, 2,243
editions, 1,241,994 passages and 51 local texts**; Islam holds **52 works**,
including the tafsirs, the Forty Hadith and twenty-six Arabic-only OpenITI
works. Search across those Arabic works is built with `bun run index:streams`.
