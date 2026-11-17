# Sikh corpus expansion

The Sikh shelf began this pass with a single catalogue record: the Guru Granth
Sahib, entered as metadata only because every complete English translation in
circulation is in copyright. The Sacred Text Archive's Sikh section holds three
items, so the first task was to see what of it could be imported and the second
to find, for the rest of the tradition's texts, sources that the archive does
not carry.

The result is **three imported works**, with the complete Guru Granth Sahib
(1,430 angs, 60,477 sentence-aligned passages) now held locally under written
permission, beside the two public-domain volumes from the archive: MacAuliffe's
*Sikh Religion*, Volume 1, and Dorothy Field's *Religion of the Sikhs*. The
register lists **26 Sikh works and editions in all**, with the sources located
for each.

## 1. The archive's Sikh section

The section (`https://archive.sacred-texts.com/skh/`) is small:

| Item | Edition | State |
| --- | --- | --- |
| *Shri Guru Granth Sahib* | English rendering of Sant Singh Khalsa (2003) | **Not imported from the archive.** Its pages carry the modern Khalsa translation, which is in copyright. The complete text was instead acquired under written permission from the Gurbani-CD edition, with the Khalsa rendering, and is held locally. |
| *The Sikh Religion*, Volume 1 | Max Arthur MacAuliffe, Oxford University Press, 1909 | Imported in full. |
| *The Religion of the Sikhs* | Dorothy Field, Wisdom of the East, London, 1914 | Imported in full. |

Only volume 1 of MacAuliffe's six volumes is on the archive. Volumes 2–6 exist
as public-domain scans with OCR on the Internet Archive, and are recorded as a
located lead rather than imported in this pass.

## 2. New imports

Both are public-domain English editions streamed from the archive at read time.
The validated segments are cached in `data/imports/cache/sacred-texts/`, which
is what the search index is built from; the reader re-fetches a chapter from the
archive and reports when the served text no longer matches the indexed count.

| Work | Edition | Chapters | Passages | Words |
| --- | --- | ---: | ---: | ---: |
| *The Sikh Religion*, Volume 1 | Max Arthur MacAuliffe, 1909 | 24 | 2,678 | 126,870 |
| *The Religion of the Sikhs* | Dorothy Field, 1914 | 4 | 975 | 21,228 |

### The Sikh Religion, Volume 1

The volume opens with MacAuliffe's introduction on the Punjab and the religious
setting of Guru Nanak's time, then follows the life in seventeen chapters, and
closes with the translated texts: the **Japji**, **Asa ki War**, the
**Rahiras**, the **Sohila**, a body of **hymns of Guru Nanak** and
**additional sloks**. Those last six chapters are the first Gurbani in the
library in any form. The chapter labels are the archive's printed index labels;
the final page's `END OF VOL. I` is kept, as the archive prints it.

The translation is MacAuliffe's own, made before the modern standard
translations. It is a Victorian reading of the hymns, and the work record says
so; it should not be presented as a neutral or current rendering.

### The Religion of the Sikhs

Field's four chapters cover the ten Gurus, the religious origins of Sikhism in
Hindu monotheism and its contact with Islam, the doctrines of the Sikhs, and a
selection of hymns from the Guru Granth Sahib and the Dasam Granth. It is an
introductory colonial-era account, useful for the history of how Sikhism was
presented to a British readership, not as a substitute for the scripture.

The chapter labels keep the archive's printed typography, including the long
dash in the second chapter's subtitle (`Sikhism——Hindu Monotheism`).

## 3. The wider Sikh corpus

The archive's three items are not a Sikh corpus. The list below is the
comprehensive survey made for this pass, with the best free online source found
for each work and the reason it could or could not be imported. Every entry is
also in `data/registry/acquisition.json` with its leads and rights position.

### Scripture and liturgy

| Work | Best source found | Status |
| --- | --- | --- |
| *Guru Granth Sahib* | SriGranth.org / Gurbani-CD: Gurmukhi, Thind's transliteration and Khalsa's English, sentence by sentence | `imported` — the complete text, held locally under written permission from both rights holders. |
| *Japji Sahib* | MacAuliffe, *Sikh Religion* I, ch. 19 | `imported` with MacAuliffe's volume. |
| *Asa ki Var* | MacAuliffe, *Sikh Religion* I, ch. 20 | `imported`. |
| *Rehras Sahib* | MacAuliffe, *Sikh Religion* I, ch. 21 | `imported`; the edition predates the modern sequence with Benti Chaupai. |
| *Sohila Sahib* | MacAuliffe, *Sikh Religion* I, ch. 22 | `imported`. |
| *Dasam Granth* | Kohli's translation on Internet Archive; Panjab Digital Library manuscripts; SikhiToTheMax | `rights_blocked` — Kohli is modern despite the archive's Public Domain Mark; no pre-1930 complete translation exists. |
| *Sarbloh Granth* | Kamalroop Singh's 2025 translation; Panjab Digital Library manuscripts | `rights_blocked` — the only complete English translation is modern and unlicensed. |
| *Bhai Gurdas — Vaaran* | SikhiToTheMax; Internet Archive scan (CC BY-NC-ND); Panjab Digital Library | `located` — no public-domain English translation verified. |
| *Bhai Gurdas — Kabitt Savaiyye* | Sikh Missionary Society (Pritpal Singh Bindra) | `rights_blocked`. |
| *Bhai Nand Lal — Diwan-e-Goya* | bhainandlal.com (Bindra, 2003); SikhiWiki Ganjnama | `rights_blocked` — partial modern translations only. |
| *Sikh Rehat Maryada* | SGPC English page and PDF (Surjit Singh Gandhi) | `rights_blocked` — official code, no open licence. |
| *Hukamnamas of Guru Tegh Bahadur* | Internet Archive study with facsimiles (CC BY-NC-ND); Punjabi University 1976 edition | `rights_blocked`. |

### Narrative and history

| Work | Best source found | Status |
| --- | --- | --- |
| *Janamsakhi of Bhai Bala* | Internet Archive Gurmukhi text | `located` — Punjabi only; no English translation verified. |
| *Puratan Janamsakhi* | Internet Archive, Bhai Vir Singh's 1948 Punjabi edition | `located` — English translation reported but not verified online. |
| *Miharban Janamsakhi* | Internet Archive, Punjabi volume 2; Panjab Digital Library | `located` — no English translation. |
| *Sri Gur Sobha* (Sainapati) | Sikh Missionary Society (Kulwant Singh) | `rights_blocked`. |
| *Sri Gur Pratap Suraj Granth* (Kavi Santokh Singh) | Gurupurshotam complete English translation; Internet Archive Punjabi volumes | `rights_blocked` — modern web translation with no licence. |
| *Sri Gur Panth Prakash* (Rattan Singh Bhangu) | Internet Archive, Kulwant Singh's two volumes (CC BY-NC-ND) | `rights_blocked` — non-derivative licence. |
| *The Sikh Religion*, Volumes 2–6 | Internet Archive OCR of the 1909–1913 volumes | `located` — public domain, needs an archive.org text importer. |

### Colonial-era histories (public domain)

| Work | Best source found | Status |
| --- | --- | --- |
| *The Adi-Granth* (Ernst Trumpp, 1877) | Internet Archive, Cornell and DLI scans | `located` — public domain, but a partial translation that must be labelled as selections. |
| *Sketch of the Sikhs* (John Malcolm, 1812) | Project Gutenberg eBook 53510; Internet Archive | `located` — public domain and already available in a proofread transcription. |
| *A History of the Sikhs* (J. D. Cunningham, 1849) | Internet Archive, two DLI scans | `located` — public domain, uncorrected OCR. |
| *The History of the Sikhs* (W. L. M'Gregor, 1846) | Internet Archive, volumes 1–2 | `located` — public domain, uncorrected OCR. |
| *The Sikhs and the Sikh Wars* (Charles Gough, 1897) | Internet Archive, DLI scan | `located` — public domain. |

## 4. Sources added to the registry

Three new sources were catalogued for the Sikh shelf:

- **Shiromani Gurdwara Parbandhak Committee** (`sgpc`) — the official publisher
  of the Rehat Maryada. Under review: the Gurmukhi is authoritative, the English
  rendering has no open licence.
- **Panjab Digital Library** (`panjab-digital-library`) — manuscript and
  printed witnesses in Gurmukhi and Persian. Page images, not searchable text;
  useful for collation, not for direct import.
- **Sikh Missionary Society (U.K.)** (`sikh-missionary-society`) — English
  translations by named Sikh scholars. Under review: modern editions with no
  stated reuse licence.

Four existing entries were extended to cover the tradition:

- **Internet Sacred Text Archive** (`sacred-texts`) now lists Sikhism among the
  traditions it covers and records the two new volumes.
- **Internet Archive — verified public-domain items** (`internet-archive-pd`)
  now covers Sikhism and names the MacAuliffe, Trumpp, Malcolm, Cunningham and
  M'Gregor scans as located leads.
- **Project Gutenberg** (`project-gutenberg`) now covers Sikhism, with Malcolm's
  *Sketch* as its first Sikh title.
- **SikhiToTheMax** remains `under_review`; its importance for the Vaaran and
  Dasam Granth leads is now recorded.

## 5. What was not done, and why

- **No archival Granth text.** The archive's pages are not the source. The
  complete text is imported under written permission from the Gurbani-CD rights
  holders (Kulbir S. Thind, MD, and Sant Singh Khalsa for the English). The
  import reads the sentence-by-sentence DOCX published with the Gurbani-CD
  files, which divides
  the text into 60,477 units with Gurmukhi, transliteration and English aligned
  on the same divisions. All 1,430 angs are present, with no gap: the source
  file numbers every page from 1 to 1430. Both editions are recorded as
  `by-permission`, are not relicensed, and must not be redistributed. Thind's
  transliteration is in the source but is not imported as an edition, and the
  Punjabi, Hindi and Professor Sahib Singh teeka are not included.
- **No Dasam Granth.** The Internet Archive item carries a Public Domain Mark
  over a modern translation; that label is not a rights determination, and the
  translation itself is not old enough to be public domain.
- **No complete MacAuliffe.** Volumes 2–6 are public domain and available, but
  the current importer reads structured archive pages. The archive.org text
  derivative is one OCR stream per volume and needs a chapter splitter before it
  can be imported honestly.
- **No rehat, hukamnamas or janamsakhis.** These are either modern
  copyrighted editions or exist only in Gurmukhi. They are recorded in the
  register with the leads that a later pass should check.

## 6. Reproducing

```sh
bun run import:sacred-texts --only=the-sikh-religion
bun run import:sacred-texts --only=religion-of-the-sikhs
bun run import:srigranth
bun run db:rebuild
```

The archive importer caches the exact validated segments; both works can be
re-read without fetching the archive again unless `--force` is given. The Granth
import reads the cached permissioned DOCX at
`data/imports/cache/srigranth/sggs-sbs-uni.docx` and writes the work, the
manifest at `data/imports/srigranth.json` and its text-function entry.
