# Ideas from Sefaria Lens

Review of 25 November 2026. Sefaria Lens (`/mnt/storage/Projects/Sefaria Lens`,
MIT, Electron + plain JS) is a single-library study app over Sefaria. Much of
what it does well is about *how a reader moves through a text*, and most of
that generalises to a multi-tradition library. This note lists what carries
over, what it would take here, and a suggested order.

## Already here

- **Column library board.** `LibraryPage.tsx` already lays tradition,
  category, work and chapter side by side, as Sefaria Lens's shelf does.
- **Streamed answers with Stop.** The assistant streams its synthesis and
  aborts on request (`AssistantPage.tsx`, `server/assistant.ts`).
- **Parallel editions.** The reader shows a translation beside the original,
  but as two separate cards rather than verse by verse (see below).

## The layout

Sefaria Lens is a three-column desk: a fixed left sidebar, the text in the
middle, and a study panel on the right. Universal Wisdom Library is a website:
a top navigation bar and full-width pages.

| Sefaria Lens | Here now | Change |
| --- | --- | --- |
| Left sidebar: brand, Ask / Reader / Library / Settings, **Recently opened**, light/dark, rights note | Top bar: Library, Themes, Sources, Compare, Study assistant, My study | Move to a sidebar shell; keep the secondary pages (Sources, Provenance, Rights, admin) in a smaller group. Recently opened comes from the bookmarks/history the app already keeps. |
| Right **study panel** (word study, selection results), closable | Modals and separate pages | One panel for anything about the current text: word lookup, selection actions, commentary, provenance. |
| Reader: **one row per verse**, original on the right, translation on the left, read across | Two cards (translation, original), each a column of its own | Align by passage reference. Each row: number, translation, original (RTL-aware), transliteration under the original. |
| Layer switches: Hebrew, Translit, Translation, Commentaries | "Both / English only / Hebrew only" | Independent layers; with the original off, the translation takes the full width. |
| **Text: 10 / 25 / 50 / 100 / all** with Show more | Whole chapter or passage cards | Same control; keeps long chapters (Gibbon, Barnes) light. |
| Ref box + Open, prev/next, chapter jump, A− / A+ in one bar | Chapter select, separate controls | One reader bar. |
| Breadcrumb back up the shelf (Genesis 1 → Torah → Tanakh → All works) | Library / Work / Chapter | Add tradition and category to the trail. |

## Features, and how they generalise

1. **Verse-by-verse commentaries.** Lens lists, under each verse, only the
   works linked to *that verse*, grouped as Sefaria groups them, and shows the
   chosen one inline. Here it generalises well:
   - Jewish works already stream from Sefaria, so its links API works as is.
   - Qur'an: the tafsir already on the shelf (al-Tabari via Quran.com) is
     keyed by surah and ayah.
   - Bible: Barnes' Notes and other CCEL commentaries are keyed by verse.
   - The library's own `commentaries` and `text_relationships` tables.
   A per-passage "Commentaries" chip that collects all of these is the single
   most useful reading feature to bring over.
2. **Selection toolbar.** Select a phrase → Search (the library's search,
   scoped to this work or tradition), **Ask** (carries the selection, its
   reference and the surrounding passage into the assistant), Compare, and
   later Translate / Transliterate.
3. **Tiered sources in answers.** Lens orders retrieved passages by reading
   tier and badges each with a reason it was chosen. Here the tiers already
   exist: every work has text functions (`canonical_scripture`,
   `commentary_exegesis`, `religious_law_practice`, `mystical_contemplative`,
   …). Reserve shortlist slots per tier, show the badge and a one-line
   justification per source, and offer scope chips per tradition (Lens's "All
   of Sefaria / Tanakh / Talmud …" row).
4. **Word study.** Click a word for its dictionary entry. Directly portable for
   Hebrew and Aramaic (Sefaria's BDB / Jastrow lexicon API). Later, per
   language: Greek (LSJ/Perseus), Pali (SuttaCentral's dictionaries), Sanskrit
   (Monier-Williams), Arabic (Lane, if a usable source is found).
5. **Transliteration.** Lens's `src/translit.js` is a rules engine for Hebrew
   in seven reading traditions, with `src/divine-name.js` choosing Adonai or
   HaShem by the kind of work. Port both for Hebrew. Sanskrit is a cheap
   second: Devanagari to IAST is deterministic, and the GRETIL shelf needs it.
   Arabic and Chinese (pinyin) need dictionaries and come later.
6. **AI translation where none exists, on request.** The shelf has many works
   with no translation: the 32 OpenITI fiqh works, the 51 Greek and Latin
   originals. Lens translates only on a button press, labels it "AI
   translation" on every segment, and caches it. Here it must never be stored
   or shown as an edition, so provenance stays honest.
7. **Hardened local-model service** (`src/llm.js`, `src/ollama.js`,
   `src/schemas.js`). One request at a time to the local model; identical
   requests shared; one context size per session; output ceilings per task;
   JSON schemas passed to Ollama as a grammar; prompts fitted to the context
   window; "What is loaded?" and "Free memory now". `server/ollama.ts` has the
   basics; this is the robustness layer it lacks.
8. **Other AI providers and a setup assistant.** Lens supports OpenAI,
   OpenRouter, Groq, Ollama and any OpenAI-compatible endpoint, with keys kept
   encrypted locally. Useful for the desktop app (many readers have no GPU),
   but it sends passages to a third party, so it must stay opt-in and say so.

## Not worth bringing over

- The Electron shell, portable exe and Woodpecker pipeline: the Bun app,
  installers and GitHub release workflow already cover this.
- The Freebuff pipe integration.
- A persistent disk cache of streamed text: streamed text is deliberately held
  in memory only, and some hosts' terms (for example CC BY-NC-SA) would need a
  check before any copy is written to disk.

## Suggested order

1. **Layout first** (no new data, the most visible change): the sidebar shell
   with Recently opened, the right study panel, and the reader rebuilt as
   aligned rows with layer switches, the segment-count control and one reader
   bar. Keep every existing route working. *About 3–5 days.* **Done 25
   November 2026** (`client/shell.tsx`, `client/recent.ts`, the reader).
2. **Commentaries by verse**, starting with Sefaria links (already streamed)
   and the library's own tables, then tafsir and Barnes. *About 3–4 days.*
   **Done 25 November 2026** (`server/commentary.ts`, `client/commentaries.tsx`):
   Sefaria links, Barnes' Notes and three tafsirs, in the study panel and on
   the passage page.
3. **Selection toolbar and Ask-with-context**, then **tiered sources** in the
   assistant using text functions. *About 3 days.*
   **Done 25 November 2026** (`client/selection.tsx`, `server/assistant.ts`):
   the toolbar (Ask, search this work or everywhere, copy with citation), the
   selection carried into the assistant, tier quotas with badges and reasons,
   and scope chips.
4. **Hebrew word study and transliteration** (port from Lens), then Sanskrit
   IAST. *About 2–3 days.*
   **Done 25 November 2026** (`client/translit/`, `server/words.ts`): the
   Lens engine in seven traditions, Sanskrit both ways, and word study from
   Sefaria's lexicons. Other languages' dictionaries are still to come.
5. **Local-model hardening**, then **on-demand AI translation**, then optional
   cloud providers. *About 4–5 days.*
   **Done 25 November 2026** (`server/llm.ts`, `server/translate.ts`,
   `server/ai-settings.ts`): the gate and queue, task ceilings, prompt
   fitting, JSON output, loaded models and freeing memory; AI translation of
   chapters with no English, labelled and never stored; and opt-in cloud
   services with the key kept on this computer.

Each step ships on its own; step 1 changes how every other feature is placed,
so it goes first.
