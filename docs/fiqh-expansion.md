# Islamic law shelf: fiqh and usul al-fiqh from OpenITI

Pass of 19 November 2026. Islamic law was the thinnest part of the Islam shelf:
a handful of fiqh works, almost all Hanafi or Maliki, and no Zahiri or
Twelver law at all. This pass adds **32 Arabic works, 3,074 chapters and
197,316 indexed paragraphs**, covering all six legal schools the library
tracks and both substantive law (furu') and legal theory (usul).

The works use the existing OpenITI importer (`bun run import:openiti`) and
the rules in [openiti-arabic.md](openiti-arabic.md): Arabic originals are public
domain; OpenITI's transcriptions are CC BY-NC-SA 4.0, so the text is streamed
from OpenITI with its rights notice and is not relicensed. No new source was
needed in the register: `openiti` was already approved.

## 1. What was added

| Work | Author | School | Category | Chapters | Paragraphs | OpenITI file |
| --- | --- | --- | --- | ---: | ---: | --- |
| *al-Jāmiʿ al-Ṣaghīr* | Muhammad ibn al-Hasan al-Shaybani | hanafi | Jurisprudence (Fiqh) / Formative texts | 37 | 470 | `0200AH/0189MuhammadShaybani.JamicSaghir.Shamela0006160-ara1.mARkdown` |
| *Kitāb al-Ḥujja ʿalā Ahl al-Madīna* | Muhammad ibn al-Hasan al-Shaybani | hanafi | Jurisprudence (Fiqh) / Comparative law | 14 | 3,715 | `0200AH/0189MuhammadShaybani.HujjaCalaAhlMadina.Shamela0006161-ara1.mARkdown` |
| *Mukhtaṣar al-Qudūrī* | Abu al-Husayn al-Quduri | hanafi | Jurisprudence (Fiqh) / Classical manuals | 56 | 2,039 | `0450AH/0428AbuHusaynQuduri.Mukhtasar.Sham19Y0124336-ara1` |
| *Badāʾiʿ al-Ṣanāʾiʿ fī Tartīb al-Sharāʾiʿ* | 'Ala' al-Din al-Kasani | hanafi | Jurisprudence (Fiqh) / Classical manuals | 68 | 21,761 | `0600AH/0587IbnMascudCalaDinKasani.BadaicSanaic.Shamela0008183-ara1` |
| *Uṣūl al-Sarakhsī* | Al-Sarakhsi | hanafi | Jurisprudence (Fiqh) / Legal theory (Usul) | 102 | 3,913 | `0500AH/0483IbnAhmadSarakhsi.Usul.Shamela0006301-ara1` |
| *Sharḥ al-Siyar al-Kabīr* | Al-Sarakhsi | hanafi | Jurisprudence (Fiqh) / Law of war and nations (Siyar) | 219 | 10,764 | `0500AH/0483IbnAhmadSarakhsi.SharhSiyarKabir.Shamela0005434-ara1` |
| *al-Ashbāh wa-l-Naẓāʾir* | Zayn al-Din Ibn Nujaym | hanafi | Jurisprudence (Fiqh) / Legal maxims (Qawa'id) | 122 | 5,425 | `0975AH/0970IbnIbrahimIbnNujaymMisri.AshbahWaNazair.Shamela0001666-ara1.completed` |
| *al-Kāfī fī Fiqh Ahl al-Madīna* | Ibn 'Abd al-Barr | maliki | Jurisprudence (Fiqh) / Classical manuals | 53 | 2,628 | `0475AH/0463IbnCabdBarr.KafiFiFiqh.Shamela0007367-ara1` |
| *al-Furūq* | Shihab al-Din al-Qarafi | maliki | Jurisprudence (Fiqh) / Legal maxims (Qawa'id) | 228 | 13,693 | `0700AH/0684ShihabDinQarafi.Furuq.ShamAY0034190-ara1` |
| *Mukhtaṣar Khalīl* | Khalil ibn Ishaq al-Jundi | maliki | Jurisprudence (Fiqh) / Classical manuals | 60 | 535 | `0775AH/0767KhalilIbnIshaq.MukhtasarKhalil.Shamela0011355-ara1` |
| *Mukhtaṣar al-Muzanī* | Isma'il ibn Yahya al-Muzani | shafii | Jurisprudence (Fiqh) / Formative texts | 40 | 3,277 | `0275AH/0264IbnYahyaMuzani.Mukhtasar.Shamela0001661-ara1` |
| *al-Muhadhdhab* | Abu Ishaq al-Shirazi | shafii | Jurisprudence (Fiqh) / Classical manuals | 51 | 4,523 | `0500AH/0476AbuIshaqShirazi.MuhadhdhabFiFiqh.Shamela0011813-ara1` |
| *al-Tanbīh* | Abu Ishaq al-Shirazi | shafii | Jurisprudence (Fiqh) / Classical manuals | 14 | 585 | `0500AH/0476AbuIshaqShirazi.TanbihFiFiqhShafici.Shamela0007589-ara1` |
| *Minhāj al-Ṭālibīn* | Yahya ibn Sharaf al-Nawawi | shafii | Jurisprudence (Fiqh) / Classical manuals | 70 | 1,178 | `0700AH/0676Nawawi.MinhajTalibin.Shamela0012096-ara1` |
| *al-Waraqāt* | Imam al-Haramayn al-Juwayni | shafii | Jurisprudence (Fiqh) / Legal theory (Usul) | 14 | 111 | `0500AH/0478ImamHaramaynJuwayni.Waraqat.Shamela0006297-ara1` |
| *al-Mustaṣfā* | Abu Hamid al-Ghazali | shafii | Jurisprudence (Fiqh) / Legal theory (Usul) | 250 | 2,977 | `0525AH/0505Ghazali.Mustasfa.Shamela0005459-ara1` |
| *al-Ashbāh wa-l-Naẓāʾir* | Taj al-Din al-Subki | shafii | Jurisprudence (Fiqh) / Legal maxims (Qawa'id) | 152 | 7,653 | `0775AH/0771TajDinSubki.AshbahWaNazair.Shamela0008634-ara1.completed` |
| *ʿUmdat al-Fiqh* | Ibn Qudama | hanbali | Jurisprudence (Fiqh) / Classical manuals | 26 | 1,095 | `0625AH/0620IbnQudamaMaqdisi.CumdatFiqh.Shamela0011315-ara1` |
| *Rawḍat al-Nāẓir* | Ibn Qudama | hanbali | Jurisprudence (Fiqh) / Legal theory (Usul) | 197 | 7,485 | `0625AH/0620IbnQudamaMaqdisi.RawdatNazir.Shamela0012010-ara1` |
| *al-Rawḍ al-Murbiʿ* | Mansur ibn Yunus al-Buhuti | hanbali | Jurisprudence (Fiqh) / Classical manuals | 28 | 2,725 | `1075AH/1051IbnYunusBuhutiHanbali.RawdMurbic.Shamela0001679-ara1` |
| *al-Siyāsa al-Sharʿiyya* | Taqi al-Din Ibn Taymiyya | hanbali | Jurisprudence (Fiqh) / Public finance and governance | 25 | 176 | `0750AH/0728IbnTaymiyya.SiyasaSharciyya.Shamela0031237-ara1` |
| *Iʿlām al-Muwaqqiʿīn* | Ibn Qayyim al-Jawziyya | hanbali | Jurisprudence (Fiqh) / Legal theory (Usul) | 369 | 7,977 | `0775AH/0751IbnQayyimJawziyya.AclamMuwaqqicin.Shamela0011496-ara1` |
| *al-Ṭuruq al-Ḥukmiyya* | Ibn Qayyim al-Jawziyya | hanbali | Jurisprudence (Fiqh) / Judicial procedure and governance | 100 | 2,148 | `0775AH/0751IbnQayyimJawziyya.TuruqHukmiyya.Shamela0011495-ara1` |
| *al-Muḥallā* | Ibn Hazm of Cordoba | zahiri | Jurisprudence (Fiqh) / Comparative law | 64 | 37,514 | `0475AH/0456IbnHazm.MuhallaBiAthar.Shamela0000767-ara1.completed` |
| *al-Iḥkām fī Uṣūl al-Aḥkām* | Ibn Hazm of Cordoba | zahiri | Jurisprudence (Fiqh) / Legal theory (Usul) | 88 | 3,477 | `0475AH/0456IbnHazm.IhkamFiUsulAhkam.Shamela0010432-ara1` |
| *Sharāʾiʿ al-Islām* | Al-Muhaqqiq al-Hilli | shia-twelver | Jurisprudence (Fiqh) / Classical manuals | 59 | 9,379 | `0700AH/0676IbnHasanMuhaqqiqHilli.SharaicIslam.Masaha001030Vols-ara1` |
| *al-Muqniʿa* | Al-Shaykh al-Mufid | shia-twelver | Jurisprudence (Fiqh) / Formative texts | 30 | 4,450 | `0425AH/0413ShaykhMufid.Muqnica.Masaha000989-ara1` |
| *Qawāʿid al-Aḥkām* | Al-'Allama al-Hilli | shia-twelver | Jurisprudence (Fiqh) / Classical manuals | 21 | 14,271 | `0750AH/0726CallamaHilli.QawacidAhkam.Shia000091Vols-ara1.completed` |
| *al-Iḥkām fī Uṣūl al-Aḥkām* | Sayf al-Din al-Amidi | shafii | Jurisprudence (Fiqh) / Legal theory (Usul) | 404 | 9,271 | `0650AH/0631SayfDinAmidi.IhkamFiUsulAhkam.Shamela0010801-ara1` |
| *Irshād al-Fuḥūl* | Muhammad ibn 'Ali al-Shawkani | sunni-tradition | Jurisprudence (Fiqh) / Legal theory (Usul) | 23 | 977 | `1275AH/1255Shawkani.IrshadFuhul.JK000152-ara1` |
| *Kitāb al-Aṣl* | Muhammad ibn al-Hasan al-Shaybani | hanafi | Jurisprudence (Fiqh) / Formative texts | 16 | 7,157 | `0200AH/0189MuhammadShaybani.Asl.Shamela0006164-ara2` |
| *al-Burhān fī Uṣūl al-Fiqh* | Imam al-Haramayn al-Juwayni | shafii | Jurisprudence (Fiqh) / Legal theory (Usul) | 74 | 3,967 | `0500AH/0478ImamHaramaynJuwayni.BurhanFiUsulFiqh.Shamela0007439-ara1` |

## 2. Importer changes

- 32 specs and 20 authors in `scripts/dev/import-openiti.ts`, and a new
  `zahiri` school in meta.
- `--only` accepts a comma-separated list.
- The Arabic-script check now samples the first 20 paragraphs, not the first
  chapter heading (two works open with a volume heading or an ellipsis).

## 3. Choices and caveats

- *Kitab al-Asl*: the OpenITI file holds sixteen books, not the whole work. The
  description says so.
- *Irshad al-Fuhul*: the Shamela file carries modern editors' introductions,
  so the JK000152 file (text only) was used.
- *Sharai' al-Islam*, *al-Muqni'a* and *Qawa'id al-Ahkam*: the first Twelver
  files found had no headings; versions with book headings were used.
- *I'lam al-Muwaqqi'in*: chapters are split on headings that are not
  `فصل` (section) markers, to stay under the 600-chapter limit.

## 4. Still sought

Added to the acquisition register (`data/registry/acquisition.json`):
Sunan al-Darimi (lead corrected; the file has 1,373 chapters and needs a
coarser rule), al-Tusi's *al-Nihaya*, *al-Lum'a al-Dimashqiyya*, *Man la
yahduruhu al-faqih*, *Radd al-Muhtar*, and three English translations:
Howard's *Minhaj et Talibin* (1914) and Hamilton's *Hedaya* (public domain,
to fetch from George's computer because those hosts are blocked from the
cloud workspace) and Khadduri's *Risala* (in copyright, rights_blocked).
