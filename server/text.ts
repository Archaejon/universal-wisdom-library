// Search normalisation. The display copy is never modified; this function
// only produces the derivative indexed by SQLite FTS.
//
// Arabic and Hebrew are written with optional pointing, and their words carry
// prefixes (the article, conjunction and prepositions) that a tokenizer cannot
// separate. The normal form folds the orthographic variants and the separate
// `searchVariants` helper adds prefix-stripped forms to the index. Neither is
// ever shown to the reader.
const MARKS = /[\u0300-\u036f\u0591-\u05c7\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g;
const HEBREW_FINALS: Record<string, string> = {
  "\u05da": "\u05db", // ך -> כ
  "\u05dd": "\u05de", // ם -> מ
  "\u05df": "\u05e0", // ן -> נ
  "\u05e3": "\u05e4", // ף -> פ
  "\u05e5": "\u05e6", // ץ -> צ
};

export function normalizeForSearch(input: string): string {
  return input
    .normalize("NFKD")
    .replace(MARKS, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/\u0640/g, "")
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0649/g, "\u064a")
    .replace(/\u0624/g, "\u0648")
    .replace(/\u0626/g, "\u064a")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u05da\u05dd\u05df\u05e3\u05e5]/g, (c) => HEBREW_FINALS[c] ?? c)
    .replace(/\u03c2/g, "\u03c3")
    .replace(/\u00df/g, "ss")
    .replace(/[\u00e6\u00c6]/g, "ae")
    .replace(/[\u0153\u0152]/g, "oe")
    .replace(/[\u2018\u2019\u201b\u02bc]/g, "'")
    // Combining marks are kept: in Devanagari, Tamil and the other Indic
    // scripts a vowel sign or virama is part of the word, not decoration.
    .replace(/[^\p{L}\p{N}\p{M}'\u3400-\u9fff]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Prefixes that are written joined to the following word in Arabic, Hebrew and
// a few other Semitic orthographies. They are stripped only to create extra
// searchable forms; the base token is always kept.
const PREFIXES: Record<string, string[]> = {
  ar: ["\u0627\u0644", "\u0648\u0627\u0644", "\u0628\u0627\u0644", "\u0643\u0627\u0644", "\u0641\u0627\u0644", "\u0644\u0644", "\u0648", "\u0641", "\u0628", "\u0643", "\u0644", "\u0633"],
  he: ["\u05d4", "\u05d5", "\u05d1", "\u05dc", "\u05de", "\u05e9", "\u05db", "\u05db\u05e9", "\u05de\u05e9", "\u05d5\u05d4", "\u05d5\u05d1"],
};

function languageKey(language: string): string {
  return (language || "").toLowerCase().slice(0, 2);
}

/**
 * Extra tokens for the FTS index: the same words with common Semitic prefixes
 * removed. A search for Arabic `صلاة` can then find `الصلاة`, and a search for
 * Hebrew `ראשית` can find `בראשית`, without a language-specific stemmer.
 */
export function searchVariants(input: string, language: string): string {
  const prefixes = PREFIXES[languageKey(language)];
  if (!prefixes) return "";
  const base = normalizeForSearch(input);
  const tokens = base.split(" ").filter(Boolean);
  const baseTokens = new Set(tokens);
  const variants = new Set<string>();
  for (const token of tokens) {
    if (token.length < 4) continue;
    const queue = [token];
    const seen = new Set(queue);
    while (queue.length) {
      const current = queue.shift()!;
      for (const prefix of prefixes) {
        if (!current.startsWith(prefix)) continue;
        const rest = current.slice(prefix.length);
        if (rest.length < 3 || seen.has(rest)) continue;
        seen.add(rest);
        if (!baseTokens.has(rest)) variants.add(rest);
        queue.push(rest);
      }
    }
  }
  return [...variants].join(" ");
}

const CJK_RUN = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g;

/**
 * The character bigrams of every CJK run in a string.
 *
 * FTS5 has no word segmentation for Chinese, Japanese or Korean: a run of
 * characters is one token, so a reader searching 君子 would have to type the
 * whole sentence it stands in to match anything. The index therefore carries
 * the bigrams of each run beside the run itself, and a CJK query is reduced to
 * the same bigrams — two characters being the smallest query the search accepts.
 */
export function cjkBigrams(input: string): string[] {
  const out = new Set<string>();
  for (const run of input.match(CJK_RUN) ?? []) {
    for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2));
  }
  return [...out];
}

/**
 * The single characters of every CJK run in a string.
 *
 * Bigrams answer a two-character query; a one-character query — 仁, 道 — has no
 * bigram to look up, and used to fall through to a LIKE scan of every text in
 * the corpus (5.4s). Indexing the characters themselves makes a one-character
 * query an ordinary index lookup.
 */
export function cjkChars(input: string): string[] {
  const out = new Set<string>();
  for (const run of input.match(CJK_RUN) ?? []) for (const char of run) out.add(char);
  return [...out];
}

/** The normalised text plus prefix variants, as stored in the FTS index. */
export function indexText(input: string, language = ""): { text: string; variants: string } {
  const text = normalizeForSearch(input);
  const extra = [...cjkBigrams(text), ...cjkChars(text)];
  return {
    text: extra.length ? `${text} ${extra.join(" ")}` : text,
    variants: searchVariants(input, language),
  };
}

export function tokenize(input: string): string[] {
  return normalizeForSearch(input).split(" ").filter(Boolean);
}

const STOPWORDS = new Set(
  `a an the and or but if then than that this these those is are was were be been being of to in on for with by from as at into about over under what which who whom whose how why when where should could would can may might must do does did doing have has had not no nor so such it its their his her our your they them we us you he she i am me my mine own
  person people one thing things way ways according says said say teach teaches teaching`
    .split(/\s+/)
    .filter(Boolean),
);

export function contentTerms(input: string): string[] {
  const out: string[] = [];
  for (const token of tokenize(input)) {
    if (isCjk(token)) {
      // A CJK word is not a token: the index carries its characters and their
      // bigrams, so a one- or two-character query is looked up as written.
      if (token.length <= 2) out.push(token);
      else out.push(...cjkBigrams(token));
      continue;
    }
    if (token.length > 1 && !STOPWORDS.has(token)) out.push(token);
  }
  return [...new Set(out)];
}

/** A CJK phrase as its bigrams, which are the units the index stores. */
export function phraseFor(input: string, normalized: string): string {
  if (!isCjk(normalized)) return normalized;
  const bigrams = cjkBigrams(normalized);
  return bigrams.length ? bigrams.join(" ") : normalized;
}

export function isCjk(input: string): boolean {
  return /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(input);
}

export function makeQuery(mode: string, raw: string, expansions: string[] = []): { query: string; terms: string[] } {
  const base = normalizeForSearch(raw);
  if (!base) return { query: "", terms: [] };
  if (mode === "phrase") {
    return { query: `"${base.replaceAll('"', '""')}"`, terms: [raw.trim()] };
  }
  const terms = contentTerms(raw);
  const all = [...new Set([...terms, ...expansions.flatMap((e) => tokenize(e))])].filter(Boolean);
  if (all.length === 0) return { query: "", terms: [] };
  return { query: all.map((t) => `"${t.replaceAll('"', '""')}"`).join(" OR "), terms: all };
}

// Build an excerpt from the ORIGINAL orthography by matching normalised words
// back to their display tokens. Falls back to the start of the passage.
export function excerpt(original: string, terms: string[], maxChars = 240): string {
  const clean = original.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (terms.length === 0 || clean.length <= maxChars) return clean;
  const words = clean.split(" ");
  const wanted = new Set(terms.map((t) => normalizeForSearch(t)).filter(Boolean));
  let hit = -1;
  for (let i = 0; i < words.length; i++) {
    const w = normalizeForSearch(words[i]);
    if ([...wanted].some((t) => w === t || w.includes(t))) {
      hit = i;
      break;
    }
  }
  if (hit < 0) return clean.slice(0, maxChars).trim() + (clean.length > maxChars ? "…" : "");
  let start = Math.max(0, hit - 18);
  let end = Math.min(words.length, hit + 26);
  let text = words.slice(start, end).join(" ");
  if (start > 0) text = "…" + text;
  if (end < words.length) text = text + "…";
  return text.slice(0, maxChars);
}
