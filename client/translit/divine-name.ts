// @ts-nocheck
// Ported from Sefaria Lens (src/divine-name.js), MIT License, (c) 2026 Sefaria Lens contributors.

/**
 * How to print the Tetragrammaton when a text is transliterated.
 *
 * The four letters are never pronounced as written, so a phonetic transliteration
 * of them is always wrong. Which euphemism belongs in their place depends on what
 * the reader is reading: a siddur, a machzor or a haggadah is said aloud in prayer
 * and takes Adonai, while a daf, a commentary or a halakhic work is discussed and
 * takes HaShem.
 *
 * The work is classified from the metadata Sefaria returns with the text
 * (categories, title, ref), so the reader does not have to choose each time.
 */

// Category names, work titles and refs that mark a text as liturgy. Matched
// case-insensitively against the metadata joined into one string, and against
// the Hebrew title too, where siddurim name themselves.
const LITURGICAL = /liturg|siddur|machzor|mahzor|haggadah|hagaddah|selichot|selihot|kinot|kinnot|piyyut|piyut|tefill|prayer|amidah|kaddish|hallel|zemirot|birkat|kabbalat shabbat|grace after meals|blessings|סידור|מחזור|הגדה|סליחות|קינות|פיוט/i;

const READINGS = { adonai: 'Adonai', hashem: 'HaShem' };

/** Everything in a text's metadata that can say what kind of work it is. */
function metaText(meta) {
  if (!meta) return '';
  if (typeof meta === 'string') return meta;
  const categories = Array.isArray(meta.categories) ? meta.categories : [];
  return [
    meta.primaryCategory,
    ...categories,
    meta.title,
    meta.heTitle,
    meta.ref,
    meta.collectiveTitle,
  ].filter(Boolean).join(' | ');
}

function isLiturgical(meta) {
  const text = metaText(meta);
  return Boolean(text) && LITURGICAL.test(text);
}

/**
 * 'adonai' for liturgical works, 'hashem' for everything else. The transliterator
 * accepts either, or a boolean `liturgical` flag.
 */
function readingFor(meta) {
  if (meta === true) return 'adonai';
  if (meta === false) return 'hashem';
  return isLiturgical(meta) ? 'adonai' : 'hashem';
}

/** The word itself, for notes and tests. */
function readingLabel(reading) {
  return READINGS[reading] || READINGS.hashem;
}

export { readingFor, isLiturgical, readingLabel, READINGS };
