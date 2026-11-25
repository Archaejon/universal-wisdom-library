// @ts-nocheck — ported unchanged in logic from Sefaria Lens (src/translit.js).
/*
 * Hebrew transliteration engine from Sefaria Lens.
 * MIT License, Copyright (c) 2026 Sefaria Lens contributors.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, subject to the conditions in the MIT License: the
 * above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED
 * "AS IS", WITHOUT WARRANTY OF ANY KIND.
 */


/**
 * Hebrew -> Latin transliteration with five selectable pronunciation traditions.
 *
 * Design note: this is a *respelling* engine (readable Latin), not an academic
 * phonological transcription. It models the systematic differences between
 * Modern Israeli, Ashkenazi (Lithuanian-American norm), and Mizrahi (Sephardi-
 * aligned) reading traditions:
 *
 *   feature        Modern        Ashkenazi       Mizrahi
 *   qamatz gadol   a             o               a
 *   tzere          e             ey              e
 *   cholam         o             ō               o
 *   tav rafe       t             s               ṯ (t after a break)
 *   vav            v             v               w
 *   qof            k             k               q
 *   chet           ch            ch              ch (ḥ w/ diacritics)
 *   ayin           '             '               ' (ʿ w/ diacritics)
 *   tsadi          tz            tz              ts (ṣ w/ diacritics)
 *   resh           r             r               r
 *
 * Yemeni and Kavkazi extend the same engine. Yemeni changes the vowels and
 * pronounces gimel with dagesh as j; Kavkazi keeps patah as a but writes tzere,
 * segol and sheva na as ä (so patah and segol stay apart), keeps vav as v, and
 * merges tet and tav rafe with plain t. Both are offered in a More menu so the
 * three main buttons stay uncluttered.
 *
 * Begedkefet follows the Masoretic point: a letter carrying a dagesh is plosive
 * and an unpointed one is fricative, except when it opens a word after a break
 * (תֹהוּ -> tohu, not ṯohu), where the plosive value is kept. Mizrahi writes
 * bet/khaf/pe rafe with the letters' plain sounds (v, kh, f) rather than
 * ḇ ḵ p̱, which read badly at text size; gimel, dalet and tav keep the scholarly
 * mark because those sounds are still distinct in the tradition.
 *
 * Limitations (surfaced in the UI): stress is not marked, qamatz qatan is only
 * detected where the source marks it or a short exception list applies, and
 * shva na/nach follows the standard default-nach rule, so a minority of rare
 * forms will differ from a trained reader's recitation.
 */

const LETTERS = new Set('אבגדהוזחטיכלמנסעפצקרשתךםןףץ');
const FINAL_TO_REGULAR = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const BEGADKEFAT = new Set('בגדכפת');

// Combining marks
const M = {
  SHVA: '\u05B0', HATAF_SEGOL: '\u05B1', HATAF_PATACH: '\u05B2', HATAF_QAMATS: '\u05B3',
  HIRIQ: '\u05B4', TZERE: '\u05B5', SEGOL: '\u05B6', PATAH: '\u05B7', QAMATS: '\u05B8',
  HOLAM: '\u05B9', HOLAM_HASER: '\u05BA', QUBUTS: '\u05BB', DAGESH: '\u05BC',
  METEG: '\u05BD', MAQAF: '\u05BE', RAFE: '\u05BF', PASEQ: '\u05C0',
  SHIN_DOT: '\u05C1', SIN_DOT: '\u05C2', SOF_PASUQ: '\u05C3', QAMATS_QATAN: '\u05C7',
};

// Qamats qatan (U+05C7) is a vowel in its own right: the Masoretic editions
// print כׇּל with that point and no qamats at all, so leaving it out of this set
// made every "kol" look unpointed and slip through as Hebrew.
const VOWEL_MARKS = new Set([
  M.SHVA, M.HATAF_SEGOL, M.HATAF_PATACH, M.HATAF_QAMATS, M.HIRIQ, M.TZERE,
  M.SEGOL, M.PATAH, M.QAMATS, M.HOLAM, M.HOLAM_HASER, M.QUBUTS, M.QAMATS_QATAN,
]);

// Cantillation + meteg are not pronounced here.
const IGNORED = new Set([M.METEG]);
for (let cp = 0x0591; cp <= 0x05af; cp++) IGNORED.add(String.fromCharCode(cp));

const CONSONANTS = {
  modern: {
    'א': '', 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'v', 'ז': 'z',
    'ח': 'ch', 'ט': 't', 'י': 'y', 'כ': 'k', 'ל': 'l', 'מ': 'm', 'נ': 'n',
    'ס': 's', 'ע': '', 'פ': 'p', 'צ': 'tz', 'ק': 'k', 'ר': 'r', 'ש': 'sh',
    'ת': 't',
  },
  ashkenazi: {
    'א': '', 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'v', 'ז': 'z',
    'ח': 'ch', 'ט': 't', 'י': 'y', 'כ': 'k', 'ל': 'l', 'מ': 'm', 'נ': 'n',
    'ס': 's', 'ע': '', 'פ': 'p', 'צ': 'tz', 'ק': 'k', 'ר': 'r', 'ש': 'sh',
    'ת': 's',
  },
  mizrahi: {
    'א': '', 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'w', 'ז': 'z',
    'ח': 'ḥ', 'ט': 'ṭ', 'י': 'y', 'כ': 'k', 'ל': 'l', 'מ': 'm', 'נ': 'n',
    'ס': 's', 'ע': 'ʿ', 'פ': 'p', 'צ': 'ṣ', 'ק': 'q', 'ר': 'r', 'ש': 'sh',
    'ת': 't',
  },
  // Yemeni differs from Mizrahi in its vowels and in gimel dagesh (j); the
  // consonants are otherwise the Sephardi-aligned set.
  yemeni: {
    'א': '', 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'w', 'ז': 'z',
    'ח': 'ḥ', 'ט': 'ṭ', 'י': 'y', 'כ': 'k', 'ל': 'l', 'מ': 'm', 'נ': 'n',
    'ס': 's', 'ע': 'ʿ', 'פ': 'p', 'צ': 'ṣ', 'ק': 'q', 'ר': 'r', 'ש': 'sh',
    'ת': 't',
  },
  // Mountain Jewish (Kavkazi): vav is v, tet is plain t, and tav rafe is t,
  // so the emphatic/rafe marks of Mizrahi are dropped where they merged.
  kavkazi: {
    'א': '', 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'v', 'ז': 'z',
    'ח': 'ḥ', 'ט': 't', 'י': 'y', 'כ': 'k', 'ל': 'l', 'מ': 'm', 'נ': 'n',
    'ס': 's', 'ע': 'ʿ', 'פ': 'p', 'צ': 'ṣ', 'ק': 'q', 'ר': 'r', 'ש': 'sh',
    'ת': 't',
  },
  // Ancient: the Mizrahi consonants with the Tiberian distinctions spelled out.
  // The Masoretic pointing keeps the pharyngeal ḥet and ʿayin apart from the
  // uvular khaf and gimel rafe, so those four letters can be marked for place
  // of articulation: ḥ ʿ (pharyngeal) against ḵ ḡ (uvular).
  ancient: {
    'א': '', 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'w', 'ז': 'z',
    'ח': 'ḥ', 'ט': 'ṭ', 'י': 'y', 'כ': 'k', 'ל': 'l', 'מ': 'm', 'נ': 'n',
    'ס': 's', 'ע': 'ʿ', 'פ': 'p', 'צ': 'ṣ', 'ק': 'q', 'ר': 'r', 'ש': 'sh',
    'ת': 't',
  },
  'ancient-hard': {
    'א': '', 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'w', 'ז': 'z',
    'ח': 'ḥ', 'ט': 'ṭ', 'י': 'y', 'כ': 'k', 'ל': 'l', 'מ': 'm', 'נ': 'n',
    'ס': 's', 'ע': 'ʿ', 'פ': 'p', 'צ': 'ṣ', 'ק': 'q', 'ר': 'r', 'ש': 'sh',
    'ת': 't',
  },
};

// With dagesh qal (hard) vs. without (soft, rafe).
const HARD = {
  modern: { 'ב': 'b', 'ג': 'g', 'ד': 'd', 'כ': 'k', 'פ': 'p', 'ת': 't' },
  ashkenazi: { 'ב': 'b', 'ג': 'g', 'ד': 'd', 'כ': 'k', 'פ': 'p', 'ת': 't' },
  mizrahi: { 'ב': 'b', 'ג': 'g', 'ד': 'd', 'כ': 'k', 'פ': 'p', 'ת': 't' },
  yemeni: { 'ב': 'b', 'ג': 'j', 'ד': 'd', 'כ': 'k', 'פ': 'p', 'ת': 't' },
  kavkazi: { 'ב': 'b', 'ג': 'g', 'ד': 'd', 'כ': 'k', 'פ': 'p', 'ת': 't' },
  ancient: { 'ב': 'b', 'ג': 'g', 'ד': 'd', 'כ': 'k', 'פ': 'p', 'ת': 't' },
  'ancient-hard': { 'ב': 'b', 'ג': 'g', 'ד': 'd', 'כ': 'k', 'פ': 'p', 'ת': 't' },
};
const SOFT = {
  modern: { 'ב': 'v', 'ג': 'g', 'ד': 'd', 'כ': 'ch', 'פ': 'f', 'ת': 't' },
  ashkenazi: { 'ב': 'v', 'ג': 'g', 'ד': 'd', 'כ': 'ch', 'פ': 'f', 'ת': 's' },
  // Rafe (fricative) begedkefet is marked, not merged with the plosive: the
  // Sephardi/Mizrahi reading preserves the distinction even where modern speech
  // has lost it. Bet, khaf and pe are written with their plain sounds because
  // ḇ ḵ p̱ are hard to read in running text; gimel, dalet and tav keep the mark.
  mizrahi: { 'ב': 'v', 'ג': 'ḡ', 'ד': 'ḏ', 'כ': 'kh', 'פ': 'f', 'ת': 'ṯ' },
  yemeni: { 'ב': 'v', 'ג': 'ḡ', 'ד': 'ḏ', 'כ': 'kh', 'פ': 'f', 'ת': 'ṯ' },
  // Kavkazi merges tav rafe with plain t; bet rafe stays v.
  kavkazi: { 'ב': 'v', 'ג': 'ḡ', 'ד': 'ḏ', 'כ': 'kh', 'פ': 'f', 'ת': 't' },
  // Ancient keeps khaf rafe uvular (ḵ) so the pharyngeal ḥ sits apart from it.
  ancient: { 'ב': 'v', 'ג': 'ḡ', 'ד': 'ḏ', 'כ': 'ḵ', 'פ': 'f', 'ת': 'ṯ' },
  // The hard variant reads every begedkefet letter as plosive, dagesh or not.
  'ancient-hard': { 'ב': 'b', 'ג': 'g', 'ד': 'd', 'כ': 'k', 'פ': 'p', 'ת': 't' },
};

// Sin is written with an acute so it stays distinct from samekh (s) and from
// shin (sh): שָׂרָה -> śārāh.
const SIN = { ancient: 'ś', 'ancient-hard': 'ś' };

// Tiberian vowel classes: long signs carry a macron, short signs stay plain,
// reduced hatafim take a breve. Hiriq written with a yod is the long ī.
const ANCIENT_VOWELS = {
  qamats: 'ā', tzere: 'ē', cholam: 'ō', shva: 'ə',
  patah: 'a', segol: 'e', hiriq: 'i', qubbuts: 'u', shuruq: 'ū',
  hatafPatach: 'ă', hatafSegol: 'ĕ', hatafQamats: 'ŏ', hiriqLong: 'ī',
};

const STYLE_VOWELS = {
  modern: {
    qamats: 'a', tzere: 'e', cholam: 'o', shva: 'e',
    patah: 'a', segol: 'e', hiriq: 'i', qubbuts: 'u', shuruq: 'u',
    hatafPatach: 'a', hatafSegol: 'e', hatafQamats: 'o',
  },
  // Holam takes a macron so Ashkenazi distinguishes it from qamatz: toroh vs tōroh.
  ashkenazi: {
    qamats: 'o', tzere: 'ey', cholam: 'ō', shva: 'e',
    patah: 'a', segol: 'e', hiriq: 'i', qubbuts: 'u', shuruq: 'u',
    hatafPatach: 'a', hatafSegol: 'e', hatafQamats: 'o',
  },
  mizrahi: {
    qamats: 'a', tzere: 'e', cholam: 'o', shva: 'e',
    patah: 'a', segol: 'e', hiriq: 'i', qubbuts: 'u', shuruq: 'u',
    hatafPatach: 'a', hatafSegol: 'e', hatafQamats: 'o',
  },
  // Yemeni: qamats = o, segol = a, holam = ö, sheva na = a.
  yemeni: {
    qamats: 'o', tzere: 'e', cholam: 'ö', shva: 'a',
    patah: 'a', segol: 'a', hiriq: 'i', qubbuts: 'u', shuruq: 'u',
    hatafPatach: 'a', hatafSegol: 'a', hatafQamats: 'o',
  },
  // Kavkazi: qamats = o, holam = ö, sheva na = ä. Patah opens to plain a while
  // tzere and segol take ä, so the ə-like vowel is written where the tradition
  // keeps it distinct from patah; reduced hataf marks follow their full vowels.
  kavkazi: {
    qamats: 'o', tzere: 'ä', cholam: 'ö', shva: 'ä',
    patah: 'a', segol: 'ä', hiriq: 'i', qubbuts: 'u', shuruq: 'u',
    hatafPatach: 'a', hatafSegol: 'ä', hatafQamats: 'o',
  },
  // Ancient follows the Tiberian classes rather than any one community's
  // pronunciation: the long signs take a macron (qamats gadol ā, tsere ē,
  // holam ō, shuruq ū), the short signs stay plain (patah a, segol e, hiriq i,
  // qubbuts u, qamats qatan o), and the reduced vowels are breve (ă ĕ ŏ).
  // Shva na takes the schwa (ə). Hiriq written with a yod is long: ī.
  ancient: ANCIENT_VOWELS,
  'ancient-hard': ANCIENT_VOWELS,
};

// Words whose qamatz is qatan even when the source does not mark U+05C7.
// Kept deliberately small: guessing broadly produced more errors than it fixed.
const QAMATS_QATAN_WORDS = new Set([
  'כָּל', 'כָּל־', 'מִכָּל', 'בְּכָל', 'וְכָל', 'כָּלָּם', 'כֻּלָּם',
  'חָכְמָה', 'חָכְמַת', 'קָדְשׁוֹ', 'קָדְשֵׁנוּ', 'אָכְלוּ', 'אָכְלָה',
]);

const PLAIN_DIACRITICS = {
  'ḥ': 'ch', 'ʿ': "'", 'ṣ': 'ts', 'ṭ': 't', 'ʾ': "'", 'ō': 'o',
  'ḇ': 'v', 'ḡ': 'g', 'ḏ': 'd', 'ḵ': 'kh', 'ṯ': 't', 'ä': 'a', 'ö': 'o',
  // Ancient
  'ś': 's', 'ā': 'a', 'ē': 'e', 'ī': 'i', 'ū': 'u',
  'ə': 'e', 'ă': 'a', 'ĕ': 'e', 'ŏ': 'o',
};

function stripDiacritics(s) {
  return s
    .replace(/p\u0331/g, 'f')
    .replace(/[ḥʿṣṭʾōḇḡḏḵṯäöśāēīūəăĕŏ]/g, (c) => PLAIN_DIACRITICS[c] || c);
}

/** Parse a Hebrew word into letter clusters: [{letter, marks:Set}] */
function parseClusters(word) {
  const clusters = [];
  for (const ch of word) {
    if (LETTERS.has(ch)) {
      clusters.push({ letter: FINAL_TO_REGULAR[ch] || ch, final: FINAL_TO_REGULAR[ch] !== undefined, marks: new Set() });
    } else if (clusters.length) {
      clusters[clusters.length - 1].marks.add(ch);
    }
  }
  return clusters;
}

function hasVowelMark(c) {
  for (const m of c.marks) if (VOWEL_MARKS.has(m)) return true;
  return false;
}

function vowelOf(c, style) {
  const s = STYLE_VOWELS[style];
  const marks = c.marks;
  if (marks.has(M.QAMATS_QATAN)) return { v: 'o', type: 'short', katan: true };
  if (marks.has(M.HATAF_SEGOL)) return { v: s.hatafSegol, type: 'reduced' };
  if (marks.has(M.HATAF_PATACH)) return { v: s.hatafPatach, type: 'reduced' };
  if (marks.has(M.HATAF_QAMATS)) return { v: s.hatafQamats, type: 'reduced' };
  if (marks.has(M.HIRIQ)) return { v: s.hiriq, type: 'short' };
  if (marks.has(M.TZERE)) return { v: s.tzere, type: 'long' };
  if (marks.has(M.SEGOL)) return { v: s.segol, type: 'short' };
  if (marks.has(M.PATAH)) return { v: s.patah, type: 'short' };
  if (marks.has(M.QAMATS)) return { v: s.qamats, type: 'long' };
  if (marks.has(M.HOLAM) || marks.has(M.HOLAM_HASER)) return { v: s.cholam, type: 'long' };
  if (marks.has(M.QUBUTS)) return { v: s.qubbuts, type: 'short' };
  return null;
}

/**
 * Convert one cluster to {cons, vowel, geminate, silentConsonant}
 * `prev` is the previous *pronounced* cluster, used for matres lectionis.
 */
function phonemeFor(c, style, inWordIndex, word, opts = {}) {
  const marks = c.marks;
  const letter = c.letter;
  let cons = CONSONANTS[style][letter] ?? '';
  let geminate = false;
  let vowel = null;
  let vowelType = null;

  const dagesh = marks.has(M.DAGESH);
  const shuruk = letter === 'ו' && dagesh;
  const hasVowel = hasVowelMark(c);
  const v = hasVowel ? vowelOf(c, style) : null;

  // --- Matres lectionis -------------------------------------------------
  if (letter === 'ו' && (shuruk || (!hasVowel && false))) {
    // vav + dagesh = shuruk (u), no consonantal value
    cons = '';
    vowel = STYLE_VOWELS[style].shuruq;
    vowelType = 'long';
  } else if (letter === 'ו' && (marks.has(M.HOLAM) || marks.has(M.HOLAM_HASER))) {
    cons = '';
    vowel = STYLE_VOWELS[style].cholam;
    vowelType = 'long';
  } else if (letter === 'י' && marks.has(M.HIRIQ) && !dagesh && inWordIndex > 0 && word[inWordIndex - 1].marks.has(M.HIRIQ)) {
    // yod as mater after chirik (בִּי -> bi); the vowel is long where the
    // scheme distinguishes length (Ancient: bī).
    cons = '';
    vowel = STYLE_VOWELS[style].hiriqLong || STYLE_VOWELS[style].hiriq;
    vowelType = 'long';
  } else if (letter === 'י' && !hasVowel && inWordIndex > 0) {
    const prev = word[inWordIndex - 1];
    const next = word[inWordIndex + 1];
    const prevVowel = prev && vowelOf(prev, style);
    // yod as mater after chirik (בְּרֵאשִׁית -> bereshit)
    if (prevVowel && prevVowel.v === STYLE_VOWELS[style].hiriq) cons = '';
    // The 3ms suffix written ־ָיו is read -āv: the yod is the mater that writes
    // the qamats, not a consonant, so the vav carries the sound (דְּבָרָיו ->
    // devarav, פָּנָיו -> panav, עָלָיו -> alav). Reading the yod gave the wrong
    // "devarayv" in every tradition.
    const suffixVav = next && next.letter === 'ו' && !hasVowelMark(next) && !next.marks.has(M.DAGESH);
    if (suffixVav && prev.marks.has(M.QAMATS)) cons = '';
  } else if (letter === 'א' && !hasVowel) {
    cons = '';
  }

  if (!vowel && v) {
    vowel = v.v;
    vowelType = v.type;
  }

  // --- Dagesh -----------------------------------------------------------
  if (dagesh && letter !== 'ו') {
    if (BEGADKEFAT.has(letter)) {
      // Dagesh qal at the start of a word or after a silent shva; otherwise forte.
      const prev = inWordIndex > 0 ? word[inWordIndex - 1] : null;
      const prevSilent = !prev || (prev.marks.has(M.SHVA) && !shvaIsNa(word, inWordIndex - 1, null));
      cons = HARD[style][letter];
      geminate = !prevSilent;
    } else if (letter !== 'ה' && letter !== 'י' && letter !== 'ו') {
      // Glides and mappiq he are not doubled in readable respelling.
      geminate = true;
    }
  } else if (!dagesh && BEGADKEFAT.has(letter)) {
    // An unpointed begedkefet letter is spirantized (rafe) when it follows a
    // vowel — inside the word, or across a maqaf when the word is joined to the
    // one before it. A letter that opens a word after a break keeps its plosive
    // value even though the source writes no dagesh (תֹהוּ -> tohu, not ṯohu).
    cons = (inWordIndex === 0 && !opts.joined) ? HARD[style][letter] : SOFT[style][letter];
  }

  // Sin dot
  if (letter === 'ש' && marks.has(M.SIN_DOT)) cons = SIN[style] || 's';

  return { cons, vowel, vowelType, geminate, letter, marks, hasVowel };
}

// The Tetragrammaton is never pronounced as written, so a transliteration that
// spells out its consonants is wrong in every tradition. The four letters are
// replaced by the euphemism the reader expects — Adonai in liturgical works,
// HaShem in everything else — and a prefix attached to them (לַיהוָה, וַיְהוָה)
// keeps its own reading, joined with a hyphen so the composite stays legible.
const DIVINE_NAME = ['י', 'ה', 'ו', 'ה'];
const DIVINE_PREFIXES = new Set(['ו', 'ב', 'כ', 'ל', 'מ', 'ה', 'ש']);
const DIVINE_READINGS = { adonai: 'Adonai', hashem: 'HaShem' };

// Sefaria's Hebrew geresh and gershayim, which mark an abbreviation or a
// numeral (ה', ב"ה, אָלֶ"ף). They are part of a word, unlike the ASCII quote
// the reader's sentence punctuation uses.
const GERESH = '\u05F3';
const GERSHAYIM = '\u05F4';

// Rabbinic abbreviations that stand for a whole phrase (וגו׳ = "and so on").
// They are never pronounced as written, so they are read rather than spelled.
const ABBREVIATIONS = { 'וגו': 'etc.', 'וכו': 'etc.' };
// Acronyms that are read as words rather than as a string of letters. The
// pointing writes הקב״ה; the letters alone would give haqqabbah.
const ACRONYMS = {
  'הקבה': 'HaKadosh Baruch Hu', 'רמבם': 'Rambam', 'רשי': 'Rashi',
  'רמבן': 'Ramban', 'רשבא': 'Rashba', 'רן': 'Ran', 'בעה': 'bezrat Hashem',
  'בסד': 'besiyata d’shmaya', 'עז': 'avodah zarah', 'עכ': 'ad kan',
};
// Word lookup uses the normalized (non-final) letters, so a final mem or nun in
// an acronym (רמב״ם) still matches the key written with the regular letter.
const AS_LETTERS = (s) => [...s].map((ch) => FINAL_TO_REGULAR[ch] || ch).join('');
const ACRONYM_KEYS = Object.fromEntries(Object.entries(ACRONYMS).map(([k, v]) => [AS_LETTERS(k), v]));

function divineReading(opts) {
  const asked = opts && opts.divineName;
  return DIVINE_READINGS[asked] || DIVINE_READINGS.hashem;
}

/**
 * Where the name sits in a parsed word: the whole word, or the last four letters
 * behind one prefix. Null when the letters merely occur inside a longer stem.
 */
function divineNameSpan(clusters) {
  const n = clusters.length;
  const start = n === 4 ? 0 : (n === 5 && DIVINE_PREFIXES.has(clusters[0].letter) ? 1 : -1);
  if (start < 0) return null;
  for (let i = 0; i < DIVINE_NAME.length; i++) {
    if (clusters[start + i].letter !== DIVINE_NAME[i]) return null;
  }
  return { start };
}

function isPointed(clusters) {
  return clusters.some((c) => {
    for (const m of c.marks) if (VOWEL_MARKS.has(m)) return true;
    // Shuruk is written with the dagesh alone — הוּא, מוּל, תְּהוּ — so a vav
    // carrying a dagesh already tells us its vowel and counts as pointing.
    return c.letter === 'ו' && c.marks.has(M.DAGESH);
  });
}

/**
 * The words that replace the name. Unvocalized text cannot give a prefix its
 * vowel, so the bare reading is used there rather than spelling the letters.
 */
function divineNameWord(clusters, span, style, opts) {
  // When the name carries the vowels of Elohim (Job 3, Habakkuk 3) the reading
  // really is Elohim, not the euphemism.
  const forElohim = clusters[span.start].marks.has(M.HATAF_SEGOL);
  const reading = forElohim ? 'Elohim' : divineReading(opts);
  if (span.start === 0) return reading;
  if (!isPointed(clusters)) return reading;
  const prefixRaw = clusters.slice(0, span.start)
    .map((c) => c.letter + Array.from(c.marks).join(''))
    .join('');
  const prefix = transliterateWord(prefixRaw, style, { diacritics: opts && opts.diacritics });
  if (!prefix || /[\u05D0-\u05EA]/.test(prefix)) return reading;
  return `${prefix}-${reading}`;
}

/**
 * The name written as an abbreviation — ה׳, יי, י"ה — rather than spelled out.
 * A single prefixed letter is kept (וַה׳ -> va-HaShem), as for the full name.
 */
function divineAbbreviation(clusters, style, opts) {
  const marked = (c, mark) => c.marks.has(mark);
  const letters = clusters.map((c) => c.letter).join('');
  const bare = !clusters.some((c) => hasVowelMark(c) || c.marks.has(M.DAGESH));
  // The double yod is the common Orthodox substitute for the name.
  if (letters === 'יי' && bare) return divineReading(opts);
  // י"ה is the name with its second and fourth letters.
  if (letters === 'יה' && clusters[0].marks.has(GERSHAYIM) && bare) return divineReading(opts);

  // ה׳, optionally behind one prefix letter.
  const last = clusters[clusters.length - 1];
  if (last.letter !== 'ה' || !marked(last, GERESH)) return null;
  const reading = divineReading(opts);
  if (clusters.length === 1) return reading;
  if (clusters.length !== 2 || !DIVINE_PREFIXES.has(clusters[0].letter)) return null;
  const prefixRaw = clusters[0].letter + Array.from(clusters[0].marks).join('');
  const prefix = transliterateWord(prefixRaw, style, { diacritics: opts && opts.diacritics });
  if (!prefix || /[\u05D0-\u05EA]/.test(prefix)) return reading;
  return `${prefix}-${reading}`;
}

/**
 * A word the source leaves unvocalized. There is no defensible reading, but
 * printing Hebrew back into the transliteration line breaks the line for the
 * reader it is meant to help, so the consonants are carried over instead:
 * בראשית -> br'shyt, תהלים -> thlym.
 */
function consonantSkeleton(clusters, style, opts) {
  const parts = [];
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    let cons = phonemeFor(c, style, i, clusters, opts).cons;
    // Aleph and ayin have no Latin consonant; an apostrophe keeps the letter in
    // the skeleton (br'shyt) instead of silently shortening the word.
    if (!cons && (c.letter === 'א' || c.letter === 'ע')) cons = "'";
    parts.push(cons);
  }
  const out = parts.join('');
  return out || "'";
}

/**
 * Hebrew citations in parentheses — (תהלים לא, יט) — read as a Latin reference
 * (Psalms 31:19). The title has to be known to the reader of a transliteration,
 * and the numeral must become a number; the bare letters would be gibberish.
 */
const BOOK_TITLES = {
  'בראשית': 'Genesis', 'שמות': 'Exodus', 'ויקרא': 'Leviticus', 'במדבר': 'Numbers',
  'דברים': 'Deuteronomy', 'יהושע': 'Joshua', 'שופטים': 'Judges',
  'שמואל א': '1 Samuel', 'שמואל ב': '2 Samuel', 'שמואל-א': '1 Samuel', 'שמואל-ב': '2 Samuel',
  'מלכים א': '1 Kings', 'מלכים ב': '2 Kings', 'מלכים-א': '1 Kings', 'מלכים-ב': '2 Kings',
  'ישעיה': 'Isaiah', 'ישעיהו': 'Isaiah', 'ירמיה': 'Jeremiah', 'ירמיהו': 'Jeremiah',
  'יחזקאל': 'Ezekiel', 'הושע': 'Hosea', 'יואל': 'Joel', 'עמוס': 'Amos',
  'עובדיה': 'Obadiah', 'יונה': 'Jonah', 'מיכה': 'Micah', 'נחום': 'Nahum',
  'חבקוק': 'Habakkuk', 'צפניה': 'Zephaniah', 'חגי': 'Haggai', 'זכריה': 'Zechariah',
  'מלאכי': 'Malachi', 'תהלים': 'Psalms', 'תהילים': 'Psalms', 'משלי': 'Proverbs',
  'איוב': 'Job', 'שיר השירים': 'Song of Songs', 'רות': 'Ruth', 'איכה': 'Lamentations',
  'קהלת': 'Ecclesiastes', 'אסתר': 'Esther', 'דניאל': 'Daniel', 'עזרא': 'Ezra',
  'נחמיה': 'Nehemiah', 'דברי הימים א': '1 Chronicles', 'דברי הימים ב': '2 Chronicles',
  // Tractates, which the Talmud and midrash cite the same way.
  'ברכות': 'Berakhot', 'שבת': 'Shabbat', 'פסחים': 'Pesachim', 'סנהדרין': 'Sanhedrin',
  'מגילה': 'Megillah', 'קידושין': 'Kiddushin', 'בבא מציעא': 'Bava Metzia',
  'בבא בתרא': 'Bava Batra', 'בבא קמא': 'Bava Kamma', 'חולין': 'Chullin',
  'עבודה זרה': 'Avodah Zarah', 'ראש השנה': 'Rosh Hashanah', 'יומא': 'Yoma',
  'סוכה': 'Sukkah', 'כתובות': 'Ketubot', 'גיטין': 'Gittin', 'נדרים': 'Nedarim',
  'בכורות': 'Bekhorot', 'ערכין': 'Arakhin', 'תמיד': 'Tamid', 'מידות': 'Middot',
  // Mishnah tractates that share a name with the biblical book are already above.
};
const BOOK_KEYS = Object.keys(BOOK_TITLES).sort((a, b) => b.length - a.length);
const GEMATRIA = {
  'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9,
  'י': 10, 'כ': 20, 'ך': 20, 'ל': 30, 'מ': 40, 'ם': 40, 'נ': 50, 'ן': 50,
  'ס': 60, 'ע': 70, 'פ': 80, 'ף': 80, 'צ': 90, 'ץ': 90, 'ק': 100,
  'ר': 200, 'ש': 300, 'ת': 400,
};

function gematria(token) {
  const letters = token.replace(/[\u05F3\u05F4'"]/g, '');
  if (!letters) return null;
  let total = 0;
  for (const ch of letters) {
    if (!(ch in GEMATRIA)) return null;
    total += GEMATRIA[ch];
  }
  return total > 0 && total < 1000 ? total : null;
}

function citationToLatin(inner) {
  // Geresh and gershayim are part of the numeral (קי"א is 111, not 110:1), so
  // they are removed rather than turned into a break.
  const text = inner
    .replace(/[\u05F3\u05F4'"]/g, '')
    .replace(/[,\u0591-\u05AF\u05BD\u05C0\u05C3]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || !/^[\u05D0-\u05EA\- ]+$/.test(text)) return null;
  let book = null;
  let rest = '';
  // שם repeats the previous reference; a bare שם is the only word here that is
  // never a title.
  if (text === 'שם' || text.startsWith('שם ')) {
    book = 'ibid.';
    rest = text.slice(2).trim();
  } else {
    for (const key of BOOK_KEYS) {
      if (text === key || text.startsWith(`${key} `)) {
        book = BOOK_TITLES[key];
        rest = text.slice(key.length).trim();
        break;
      }
    }
  }
  if (!book) return null;
  const nums = rest ? rest.split(' ').map(gematria) : [];
  if (nums.some((n) => n == null)) return null;
  // A plausible chapter/verse guard: a word that merely looks like a numeral
  // (בראשית רבה -> 207) must not become a citation.
  if (nums.length > 3 || nums.some((n) => n === 0 || n > 200)) return null;
  if (!nums.length) return `(${book})`;
  if (nums.length === 1) return `(${book} ${nums[0]})`;
  if (nums.length === 2) return `(${book} ${nums[0]}:${nums[1]})`;
  if (nums.length === 3) return `(${book} ${nums[0]}:${nums[1]}-${nums[2]})`;
  return null;
}

/** Furtive patach: the vowel is heard before a final ח/ע (and mappiq he). */
function isFurtive(c, isLast) {
  return isLast && c.marks.has(M.PATAH) &&
    (c.letter === 'ח' || c.letter === 'ע' || (c.letter === 'ה' && c.marks.has(M.DAGESH)));
}

/** Decide shva na (pronounced) vs nach (silent). Default: nach. */
function shvaIsNa(word, i) {
  const c = word[i];
  if (!c.marks.has(M.SHVA)) return false;
  // A one-letter word with a shva is a prefix (וְ, בְּ, לְ), and is read with it.
  if (i === 0) return true;
  if (i === word.length - 1) return false;
  // Two shvas in a row: the second is na.
  if (word[i - 1].marks.has(M.SHVA)) return true;
  // Dagesh forte always takes a na (הַלְּלוּיָה).
  if (c.marks.has(M.DAGESH) && !BEGADKEFAT.has(c.letter)) return true;
  if (c.marks.has(M.METEG)) return true;
  return false;
}

/** Does this word take a qamatz qatan? Marked form first, then a short word list. */
function qamatsIsQatan(clusters, rawWord) {
  const normalized = rawWord.replace(/[\u0591-\u05af\u05bd\u05c1\u05c2]/g, '');
  return QAMATS_QATAN_WORDS.has(normalized);
}

function transliterateWord(word, style, opts) {
  word = attachQuotes(String(word));
  const clusters = parseClusters(word);
  if (!clusters.length) return '';

  // The name is a reading, not a spelling, so it is replaced before the
  // pointed check: even an unpointed יהוה reads as HaShem.
  const span = divineNameSpan(clusters);
  if (span) {
    const reading = divineNameWord(clusters, span, style, opts);
    if (reading) return reading;
  }
  const abbreviated = divineAbbreviation(clusters, style, opts);
  if (abbreviated) return abbreviated;
  const letters = clusters.map((c) => c.letter).join('');
  const signed = clusters.some((c) => c.marks.has(GERESH) || c.marks.has(GERSHAYIM));
  if (signed && ACRONYM_KEYS[letters]) return ACRONYM_KEYS[letters];
  if (signed && ABBREVIATIONS[letters]) return ABBREVIATIONS[letters];

  // Without niqqud there is no defensible vocalisation. Hebrew in the line is
  // worse than a consonant skeleton for the reader this feature exists for, so
  // unvocalized words carry their consonants over in Latin letters.
  // A lone shva does not tell us the vowels, so it does not count as pointed.
  const pointed = isPointed(clusters);
  if (!pointed) return consonantSkeleton(clusters, style, opts);

  // qamatz qatan for listed words: treat the first qamatz as short o
  if (qamatsIsQatan(clusters, word)) {
    const first = clusters.find((c) => c.marks.has(M.QAMATS));
    if (first) first.marks.add(M.QAMATS_QATAN);
  }

  const phonemes = clusters.map((c, i) => phonemeFor(c, style, i, clusters, opts));
  const parts = [];
  const shvaChar = STYLE_VOWELS[style].shva;
  const last = clusters.length - 1;

  // Resolve shva up front so neighbouring clusters can see it.
  for (let i = 0; i < phonemes.length; i++) {
    if (clusters[i].marks.has(M.SHVA) && !phonemes[i].vowel && shvaIsNa(clusters, i)) {
      phonemes[i].vowel = shvaChar;
      phonemes[i].vowelType = 'reduced';
    }
  }

  // Where a scheme marks length, a hiriq followed by a silent yod is the long
  // ī (בְּרֵאשִׁית -> bərēšīṯ), matching the Tiberian hiriq-yod.
  const longHiriq = STYLE_VOWELS[style].hiriqLong;
  if (longHiriq) {
    for (let i = 0; i < clusters.length - 1; i++) {
      const next = clusters[i + 1];
      const nextHasVowel = [...next.marks].some((m) => VOWEL_MARKS.has(m));
      if (clusters[i].marks.has(M.HIRIQ) && next.letter === 'י' && !nextHasVowel &&
          !next.marks.has(M.DAGESH) && phonemes[i + 1].cons === '') {
        phonemes[i].vowel = longHiriq;
      }
    }
  }

  for (let i = 0; i < phonemes.length; i++) {
    const p = phonemes[i];
    const c = clusters[i];
    let cons = p.cons;
    let vowel = p.vowel;

    // Doubling only reads well for single-letter consonants (sh/ch/tz stay single).
    if (p.geminate && cons && cons.length === 1) cons = cons + cons;

    // A silent aleph (or ayin) carrying its own vowel between consonants acts as
    // a syllable break: ve'et, ha'aretz, yisra'el.
    if (!cons && vowel && i > 0 && i < last && (c.letter === 'א' || c.letter === 'ע')) {
      cons = "'";
    }

    if (isFurtive(c, i === last)) {
      // vowel precedes the guttural: ruach, gavoah
      parts.push(vowel || '');
      parts.push(p.geminate && cons.length <= 1 ? cons[0] : cons);
      continue;
    }

    parts.push(cons || '');
    if (vowel) parts.push(vowel);
  }

  let out = parts.join('');
  // Ashkenazi tzere (ey) before a consonantal yod: beyt, not beyyt.
  out = out.replace(/eyy/g, 'ey');
  if (opts && opts.diacritics === false) out = stripDiacritics(out);
  return out;
}

const WORD_BOUNDARY = /([\s\u05BE.,:;!?()\[\]{}"'\u05C3\u2013\u2014\u2018\u2019\u201C\u201D\/]+)/;

/**
 * Sefaria writes abbreviations with an ASCII quote as often as with the Hebrew
 * geresh. Turning it into the Hebrew mark keeps it attached to its word instead
 * of splitting ה' into a bare ה and a quote.
 */
// A pointed letter carries its niqqud before the quote (הַקָּבָּ"ה), so the
// points sit between the letter and the mark that follows it.
const QUOTE_APOSTROPHE = /([\u05D0-\u05EA][\u05B0-\u05BC\u05C1\u05C2\u05C7]*)'/g;
const QUOTE_DOUBLE = /([\u05D0-\u05EA][\u05B0-\u05BC\u05C1\u05C2\u05C7]*)"/g;

function attachQuotes(text) {
  return text.replace(QUOTE_APOSTROPHE, `$1${GERESH}`).replace(QUOTE_DOUBLE, `$1${GERSHAYIM}`);
}

/** Transliterate a plain (HTML-stripped) Hebrew string. */
function transliterate(text, opts = {}) {
  const style = STYLE_VOWELS[opts.style] ? opts.style : 'modern';
  const diacritics = opts.diacritics !== false;
  if (!text) return '';
  const prepared = attachQuotes(String(text)).replace(/\(([^()]{1,60})\)/g, (whole, inner) => {
    const cited = citationToLatin(inner);
    return cited || whole;
  });
  let joinedToPrev = false;
  return prepared
    .split(WORD_BOUNDARY)
    .map((chunk) => {
      if (!chunk) return '';
      const joined = joinedToPrev;
      joinedToPrev = chunk === '\u05BE';
      if (!/[\u05D0-\u05EA]/.test(chunk)) {
        // Hebrew punctuation reads better as its Latin counterpart.
        return chunk.replace(/\u05BE/g, '-').replace(/\u05C3/g, '.').replace(/\u05C0/g, '|');
      }
      return transliterateWord(chunk, style, { diacritics, joined, divineName: opts.divineName });
    })
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Per-word breakdown used by the word panel. */
function wordInfo(rawWord, opts = {}) {
  const style = STYLE_VOWELS[opts.style] ? opts.style : 'modern';
  const perStyle = { diacritics: opts.diacritics !== false, divineName: opts.divineName };
  return {
    he: rawWord,
    modern: transliterateWord(rawWord, 'modern', perStyle),
    ashkenazi: transliterateWord(rawWord, 'ashkenazi', perStyle),
    mizrahi: transliterateWord(rawWord, 'mizrahi', perStyle),
    yemeni: transliterateWord(rawWord, 'yemeni', perStyle),
    kavkazi: transliterateWord(rawWord, 'kavkazi', perStyle),
    ancient: transliterateWord(rawWord, 'ancient', perStyle),
    'ancient-hard': transliterateWord(rawWord, 'ancient-hard', perStyle),
    style,
  };
}

const STYLE_INFO = {
  modern: {
    label: 'Modern Israeli',
    blurb: 'Israeli Hebrew: qamatz = a, tzere = e, tav = t, ayin mostly silent.',
  },
  ashkenazi: {
    label: 'Ashkenazi',
    blurb: 'Lithuanian-American norm: qamatz = o, holam = ō (toroh, tōroh), tzere = ey, tav rafe = s (Shabbos, emes).',
  },
  mizrahi: {
    label: 'Mizrahi',
    blurb: 'Sephardi-aligned: qamatz = a, vav = w, bet/khaf/pe rafe = v/kh/f, qof = q, and emphatics marked (ṭ ṣ ḥ ʿ).',
  },
  yemeni: {
    label: 'Yemeni',
    blurb: 'Yemeni reading: qamatz = o, segol = a, holam = ö, sheva na = a, gimel dagesh = j.',
  },
  kavkazi: {
    label: 'Kavkazi',
    blurb: 'Mountain Jewish reading: qamatz = o, patah = a, tzere and segol = ä, sheva na = ä, holam = ö, vav = v, tav rafe = t.',
  },
  ancient: {
    label: 'Ancient (begedkefet)',
    blurb: 'Tiberian length on the Mizrahi consonants: qamatz gadol ā, tsere ē, holam ō, shuruq ū, hiriq-yod ī, short vowels plain, shva ə, sin ś, and uvular ḵ ḡ against pharyngeal ḥ ʿ.',
  },
  'ancient-hard': {
    label: 'Ancient (hard)',
    blurb: 'The same Tiberian length and sin ś, with every begedkefet letter plosive (b g d k p t), as though each carried a dagesh.',
  },
};

export { transliterate, transliterateWord, wordInfo, STYLE_INFO, STYLE_VOWELS };
