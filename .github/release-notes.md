## What's new in {{VERSION}}

A new layout, adapted from Sefaria Lens, and four ways to study a text more closely.

- **A new reading layout.** A sidebar on the left holds search, the main sections and the texts you opened recently. A study panel opens on the right. The reader shows each verse on one row, the translation beside the original, with switches for each layer and one bar for moving through the work.
- **Commentaries on every verse.** Click a verse number to see what commentators wrote on it:
  - Sefaria's commentaries for the Hebrew Bible, Mishnah and Talmud (Rashi, Ramban, Ibn Ezra and hundreds more);
  - Barnes' Notes for the New Testament;
  - al-Tabari, al-Qurtubi and Ibn Kathir for the Qur'an.
- **Select text to ask about it.** Selecting words in the reader offers Ask, search this work, search everywhere, and copy with citation. Ask takes the passage into the study assistant. The assistant now:
  - quotes the passage first;
  - balances its sources between scripture, commentary, law and other writing, saying why each was chosen;
  - can search one work or one tradition.
- **Transliteration and word study.** Hebrew can be shown in Latin letters in seven reading traditions. Sanskrit can be shown in IAST or Devanagari. Click a Hebrew word to see its dictionary entries (BDB, Klein, Jastrow).

Commentaries and dictionary entries are read live from Sefaria and Quran.com, so they need an internet connection. If you already have the library installed, this version keeps it: there is nothing more to download beyond the app itself.

## Download and install

| Your computer | Download | Then |
| --- | --- | --- |
| Windows | `UniversalWisdomLibrary-{{VERSION}}-windows-setup.exe` | Run it. It installs for you only (no administrator rights) and adds the library to the Start menu. |
| Mac with Apple silicon (M1 or later) | `UniversalWisdomLibrary-{{VERSION}}-macos-arm64.dmg` | Open it and drag **Universal Wisdom Library** into Applications. |
| Mac with an Intel processor | `UniversalWisdomLibrary-{{VERSION}}-macos-x64.dmg` | Open it and drag **Universal Wisdom Library** into Applications. |
| Linux (most PCs) | `UniversalWisdomLibrary-{{VERSION}}-linux-x64.tar.gz` | Extract it and double-click **Universal Wisdom Library**. It adds itself to your applications menu. |
| Linux on ARM | `UniversalWisdomLibrary-{{VERSION}}-linux-arm64.tar.gz` | As above. |

Not sure which Mac you have? Apple menu → About This Mac: "Chip: Apple M…" means Apple silicon; "Processor: Intel" means Intel.

**When you open it**, your web browser opens straight away. The first time, the page shows the library downloading (about 3 GB) and unpacking; this takes a while, and you can do something else meanwhile. If the download is interrupted, open the app again and it carries on where it stopped. After that it opens in seconds. Opening it twice is harmless: it just brings the page back.

The library runs only on your computer. There's no window to close: it stops by itself a few minutes after you close its browser tab.

**Security warnings.** The app isn't signed yet, so your computer warns you the first time:
- **Windows:** "Windows protected your PC" → click **More info** → **Run anyway**.
- **Mac:** "can't be opened because it is from an unidentified developer" → click **Done**, then System Settings → Privacy & Security → scroll down → **Open Anyway**. (On older macOS: right-click the app → **Open** → **Open**.)

You need about 11 GB of free disk space while it installs, and 7 GB once installed. The library is kept in one folder (listed in the READ ME FIRST note); on Windows, uninstalling asks whether to delete it too.

The `uwl-library-{{VERSION}}` files are the library the app downloads by itself; you don't need to download them.

**Not included:** the Guru Granth Sahib. Its text is held under a permission that doesn't allow redistribution, so the downloadable library leaves it out. Search covers the texts held in the library; texts the reader fetches live from their hosts (such as much of the Arabic and Hebrew shelves) can be read but aren't in the search index yet.

## For developers

To run from source, see the README: `bun install`, then `bun run db:rebuild` and `bun run dev`.
