/**
 * Sanskrit between Devanagari and IAST.
 *
 * Both directions are deterministic: IAST was designed as a one-to-one
 * romanisation of Devanagari. The Heritage shelf serves Devanagari and the
 * GRETIL shelf serves IAST, so the reader can show each in the other script.
 *
 * Known limits: a vowel in hiatus written as "a-i" (rather than the diphthong
 * "ai") cannot be told apart in plain IAST and is read as the diphthong, as
 * IAST itself prescribes; Vedic accent marks are dropped; anything that is not
 * Devanagari or IAST (punctuation, numbers, Latin words) passes through.
 */

const INDEPENDENT: Record<string, string> = {
  "अ": "a", "आ": "ā", "इ": "i", "ई": "ī", "उ": "u", "ऊ": "ū", "ऋ": "ṛ", "ॠ": "ṝ", "ऌ": "ḷ", "ॡ": "ḹ",
  "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au",
};
const MATRA: Record<string, string> = {
  "ा": "ā", "ि": "i", "ी": "ī", "ु": "u", "ू": "ū", "ृ": "ṛ", "ॄ": "ṝ", "ॢ": "ḷ", "ॣ": "ḹ",
  "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
};
const CONSONANT: Record<string, string> = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "ṅ",
  "च": "c", "छ": "ch", "ज": "j", "झ": "jh", "ञ": "ñ",
  "ट": "ṭ", "ठ": "ṭh", "ड": "ḍ", "ढ": "ḍh", "ण": "ṇ",
  "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
  "य": "y", "र": "r", "ल": "l", "व": "v",
  "श": "ś", "ष": "ṣ", "स": "s", "ह": "h", "ळ": "ḻ",
};
const SIGNS: Record<string, string> = {
  "ं": "ṃ", "ः": "ḥ", "ँ": "m̐", "ऽ": "'", "।": "|", "॥": "||", "ॐ": "oṃ",
  "०": "0", "१": "1", "२": "2", "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
};
const VIRAMA = "्";
const NUKTA = "़";
// Vedic accents and other marks that have no IAST letter.
const DROPPED = /[॑-॔᳐-᳿꣠-ꣿ]/g;

export const DEVANAGARI = /[ऀ-ॿ]/;

export function devanagariToIast(text: string): string {
  const s = text.normalize("NFC").replace(DROPPED, "");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const cons = CONSONANT[ch];
    if (cons !== undefined) {
      out += cons;
      let j = i + 1;
      if (s[j] === NUKTA) j++;
      if (s[j] === VIRAMA) {
        i = j;
      } else if (MATRA[s[j]] !== undefined) {
        out += MATRA[s[j]];
        i = j;
      } else {
        out += "a";
        i = j - 1;
      }
      continue;
    }
    if (INDEPENDENT[ch] !== undefined) out += INDEPENDENT[ch];
    else if (SIGNS[ch] !== undefined) out += SIGNS[ch];
    else if (ch === NUKTA || ch === VIRAMA) continue;
    else out += ch;
  }
  return out;
}

// IAST → Devanagari. Longest match first: "kh" before "k", "ai" before "a".
const R_CONSONANTS: [string, string][] = Object.entries(CONSONANT)
  .map(([deva, roman]) => [roman, deva] as [string, string])
  .sort((a, b) => b[0].length - a[0].length);
const R_VOWELS: [string, string, string][] = [
  ["ai", "ऐ", "ै"], ["au", "औ", "ौ"],
  ["ā", "आ", "ा"], ["ī", "ई", "ी"], ["ū", "ऊ", "ू"], ["ṝ", "ॠ", "ॄ"], ["ḹ", "ॡ", "ॣ"], ["ṛ", "ऋ", "ृ"], ["ḷ", "ऌ", "ॢ"],
  ["a", "अ", ""], ["i", "इ", "ि"], ["u", "उ", "ु"], ["e", "ए", "े"], ["o", "ओ", "ो"],
];
const R_SIGNS: [string, string][] = [
  ["m̐", "ँ"], ["ṃ", "ं"], ["ṁ", "ं"], ["ḥ", "ः"], ["||", "॥"], ["|", "।"], ["'", "ऽ"], ["’", "ऽ"],
];

function startsAt(s: string, i: number, token: string) {
  return s.startsWith(token, i);
}

/**
 * IAST to Devanagari. A token holding ASCII digits or an underscore is a
 * reference or a tag (GRETIL writes "aitupbh_1,1.1" before a verse), not
 * Sanskrit, and is kept as written.
 */
export function iastToDevanagari(text: string): string {
  return text
    .split(/(\s+)/)
    .map((token) => (/[0-9_]/.test(token) ? token : convertIast(token)))
    .join("");
}

function convertIast(text: string): string {
  // Lower-case so a capital at the start of a verse reads; IAST has no case in Devanagari.
  const s = text.normalize("NFC").toLowerCase().replace(/ṁ/g, "ṃ");
  let out = "";
  let i = 0;
  let afterConsonant = false;
  const closeConsonant = () => {
    if (afterConsonant) out += VIRAMA;
    afterConsonant = false;
  };
  while (i < s.length) {
    // "ai"/"au" after a consonant must not be broken by a following consonant match.
    const vowel = R_VOWELS.find(([roman]) => startsAt(s, i, roman));
    if (vowel) {
      out += afterConsonant ? vowel[2] : vowel[1];
      afterConsonant = false;
      i += vowel[0].length;
      continue;
    }
    const cons = R_CONSONANTS.find(([roman]) => startsAt(s, i, roman));
    if (cons) {
      closeConsonant();
      out += cons[1];
      afterConsonant = true;
      i += cons[0].length;
      continue;
    }
    const sign = R_SIGNS.find(([roman]) => startsAt(s, i, roman));
    closeConsonant();
    if (sign) {
      out += sign[1];
      i += sign[0].length;
      continue;
    }
    out += s[i];
    i++;
  }
  closeConsonant();
  return out;
}

/** True when a Latin string looks like IAST Sanskrit rather than English. */
export function looksLikeIast(text: string): boolean {
  return /[āīūṛṝḷḹṅñṭḍṇśṣṃḥ]/.test(text);
}
