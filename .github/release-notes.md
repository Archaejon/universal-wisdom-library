## Download

Pick the file for your computer, unzip it, and double-click **Universal Wisdom Library** inside. Each download includes a "READ ME FIRST" note.

| Your computer | Download |
| --- | --- |
| Windows | `UniversalWisdomLibrary-{{VERSION}}-windows-x64.zip` |
| Mac with Apple silicon (M1 or later) | `UniversalWisdomLibrary-{{VERSION}}-macos-arm64.zip` |
| Mac with an Intel processor | `UniversalWisdomLibrary-{{VERSION}}-macos-x64.zip` |
| Linux (most PCs) | `UniversalWisdomLibrary-{{VERSION}}-linux-x64.tar.gz` |
| Linux on ARM | `UniversalWisdomLibrary-{{VERSION}}-linux-arm64.tar.gz` |

Not sure which Mac you have? Apple menu → About This Mac: "Chip: Apple M…" means Apple silicon; "Processor: Intel" means Intel.

**The first start** downloads the library (about 340 MB) and builds it on your computer. This takes a while; leave the window open. After that it starts in seconds. The reader opens in your web browser and runs only on your computer. A small window stays open while it runs; close it to stop the library.

**Security warnings.** The app isn't signed yet, so your computer will warn you the first time:
- **Windows:** "Windows protected your PC" → click **More info** → **Run anyway**.
- **Mac:** "cannot be opened because the developer cannot be verified" → right-click (or Control-click) the app → **Open** → **Open**.

You need about 3 GB of free disk space. Everything is kept in one folder (listed in the READ ME FIRST note), so deleting that folder removes it completely.

`uwl-library-{{VERSION}}.jsonl.gz` is the library data the app downloads by itself; you don't need to download it.

## For developers

To run from source, see the README: `bun install`, then `bun run db:rebuild` and `bun run dev`.
