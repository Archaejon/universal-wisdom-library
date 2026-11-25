/**
 * Word study: dictionary entries for one Hebrew or Aramaic word, from
 * Sefaria's lexicon service (BDB, Jastrow, Klein and others).
 *
 * The word is asked for as written (pointed) and, if nothing comes back,
 * without its points. Entries are held in memory for a while and never
 * written to disk, as streamed reading text is.
 */
import { fetchJson, stripMarkup } from "./stream";

export type Sense = { depth: number; text: string };
export type LexiconEntry = {
  headword: string;
  lexicon: string;
  strong: string;
  transliteration: string;
  morphology: string;
  senses: Sense[];
  url: string;
};

const TTL = 12 * 60 * 60 * 1000;
const MAX = 500;
const cache = new Map<string, { at: number; value: LexiconEntry[] }>();

const POINTS = /[֑-ׇ]/g;
const HEBREW = /[א-ת]/;

/** Strip punctuation and cantillation from a clicked word; keep the vowel points. */
export function cleanWord(raw: string): string {
  return String(raw ?? "")
    .normalize("NFC")
    .replace(/[֑-ֽ֯׀׃׆]/g, "") // accents, meteg, paseq, sof pasuq, nun hafukha
    .replace(/[^ְ-ׇא-ת׳״]/g, "")
    .trim()
    .slice(0, 40);
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function flattenSenses(content: any): Sense[] {
  const out: Sense[] = [];
  const walk = (node: any, depth: number) => {
    if (!node || out.length >= 10) return;
    if (Array.isArray(node)) {
      node.forEach((n) => walk(n, depth));
      return;
    }
    const text = node.definition ? stripMarkup(String(node.definition)).replace(/^[,;:\s]+/, "") : "";
    const stem = node.grammar?.verbal_stem ? `${node.grammar.verbal_stem}: ` : "";
    if (text) out.push({ depth, text: clip(stem + text, 360) });
    if (node.senses) walk(node.senses, depth + 1);
  };
  walk(content?.senses, 0);
  return out;
}

function lexiconUrl(lexicon: string, headword: string) {
  return `https://www.sefaria.org/${encodeURIComponent(`${lexicon}, ${headword}`.replaceAll(" ", "_"))}`;
}

/** The lexicons in the order a reader of the Bible wants them; others follow. */
const LEXICON_ORDER = ["BDB Augmented Strong", "BDB Dictionary", "Klein Dictionary", "Jastrow Dictionary"];

export async function lookupWord(raw: string): Promise<{ word: string; entries: LexiconEntry[] } | null> {
  const word = cleanWord(raw);
  if (!HEBREW.test(word)) return null;
  const hit = cache.get(word);
  if (hit && Date.now() - hit.at < TTL) return { word, entries: hit.value };

  const bare = word.replace(POINTS, "");
  let entries: LexiconEntry[] = [];
  for (const candidate of [...new Set([word, bare])]) {
    try {
      const { status, body } = await fetchJson(`https://www.sefaria.org/api/words/${encodeURIComponent(candidate)}`, {
        timeoutMs: 15_000,
      });
      if (status !== 200 || !Array.isArray(body) || !body.length) continue;
      entries = body
        .map((e: any): LexiconEntry => ({
          headword: String(e?.headword ?? ""),
          lexicon: String(e?.parent_lexicon ?? ""),
          strong: e?.strong_number ? String(e.strong_number) : "",
          transliteration: String(e?.transliteration ?? ""),
          morphology: stripMarkup(String(e?.content?.morphology ?? "")),
          senses: flattenSenses(e?.content),
          url: lexiconUrl(String(e?.parent_lexicon ?? ""), String(e?.headword ?? "")),
        }))
        .filter((e: LexiconEntry) => e.headword && e.senses.length);
      if (entries.length) break;
    } catch {
      // Try the unpointed form, then give up: the panel says the lexicon did not answer.
    }
  }
  const rank = (l: string) => {
    const i = LEXICON_ORDER.indexOf(l);
    return i < 0 ? LEXICON_ORDER.length : i;
  };
  // The entry for this very form first, then entries for the same letters,
  // then the rest (roots and near forms the lexicon also returns).
  const base = (t: string) => t.replace(/[^\u05B0-\u05C2\u05C7\u05D0-\u05EA]/g, "");
  const match = (e: LexiconEntry) =>
    base(e.headword) === base(word) ? 0 : base(e.headword).replace(POINTS, "") === bare ? 1 : 2;
  entries.sort((a, b) => match(a) - match(b) || rank(a.lexicon) - rank(b.lexicon));
  entries = entries.slice(0, 8);
  if (entries.length) {
    if (cache.size >= MAX) cache.delete(cache.keys().next().value!);
    cache.set(word, { at: Date.now(), value: entries });
  }
  return { word, entries };
}
