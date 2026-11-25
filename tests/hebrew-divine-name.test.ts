// Ported from Sefaria Lens (test/divine-name.test.js), MIT License, (c) 2026 Sefaria Lens contributors.
// @ts-nocheck
import { test } from 'bun:test';
import assert from 'node:assert';
import { transliterate, transliterateWord, wordInfo } from '../client/translit/hebrew-engine';
import { readingFor, isLiturgical } from '../client/translit/divine-name';

const STYLES = ['modern', 'ashkenazi', 'mizrahi', 'yemeni', 'kavkazi'];

test('the four letters are never spelled out', () => {
  assert.strictEqual(transliterateWord('יְהוָה', 'modern'), 'HaShem');
  assert.strictEqual(transliterateWord('יְהוָה', 'ashkenazi', { divineName: 'adonai' }), 'Adonai');
  for (const style of STYLES) {
    assert.strictEqual(transliterateWord('יְהֹוָה', style), 'HaShem');
    assert.strictEqual(transliterateWord('יְהוָה', style, { divineName: 'adonai' }), 'Adonai');
  }
});

test('an unpointed name is still replaced', () => {
  assert.strictEqual(transliterateWord('יהוה', 'modern'), 'HaShem');
  assert.strictEqual(transliterate('יהוה', { style: 'modern', divineName: 'adonai' }), 'Adonai');
});

test('a prefixed name keeps its prefix and its reading', () => {
  assert.strictEqual(transliterateWord('לַיהוָה', 'modern'), 'la-HaShem');
  assert.strictEqual(transliterateWord('וַיְהוָה', 'modern', { divineName: 'adonai' }), 'va-Adonai');
  assert.strictEqual(transliterateWord('בַּיהוָה', 'mizrahi', { divineName: 'adonai' }), 'ba-Adonai');
});

test('a name pointed for Elohim is read as Elohim', () => {
  assert.strictEqual(transliterateWord('יֱהֹוִה', 'modern'), 'Elohim');
  assert.strictEqual(transliterateWord('יֱהוִה', 'mizrahi', { divineName: 'adonai' }), 'Elohim');
});

test('words that merely contain the letters are untouched', () => {
  assert.strictEqual(transliterateWord('יְהוּדָה', 'modern'), 'yehudah');
  assert.strictEqual(transliterateWord('אֱלֹהִים', 'modern'), 'elohim');
  assert.strictEqual(transliterateWord('יָהּ', 'modern'), 'yah');
  assert.strictEqual(transliterateWord('תְּהִלִּים', 'modern'), 'tehillim');
});

test('the name inside a verse is replaced in place', () => {
  assert.strictEqual(transliterate('וַיֹּאמֶר יְהוָה אֶל־מֹשֶׁה', { style: 'modern' }),
    'vayomer HaShem el-mosheh');
  assert.strictEqual(transliterate('וַיֹּאמֶר יְהוָה אֶל־מֹשֶׁה', { style: 'modern', divineName: 'adonai' }),
    'vayomer Adonai el-mosheh');
});

test('wordInfo carries the reading in every tradition', () => {
  const info = wordInfo('יְהוָה', { style: 'ashkenazi', divineName: 'adonai' });
  for (const style of STYLES) assert.strictEqual(info[style], 'Adonai');
  assert.strictEqual(wordInfo('יְהוָה').modern, 'HaShem');
});

test('liturgy takes Adonai and study texts take HaShem', () => {
  assert.strictEqual(readingFor({ categories: ['Liturgy', 'Siddur', 'Weekday'], title: 'Siddur Ashkenaz' }), 'adonai');
  assert.strictEqual(readingFor({ title: 'Pesach Haggadah' }), 'adonai');
  assert.strictEqual(readingFor({ ref: 'Machzor Rosh Hashanah 1' }), 'adonai');
  assert.strictEqual(readingFor({ categories: ['Talmud', 'Bavli'], title: 'Berakhot' }), 'hashem');
  assert.strictEqual(readingFor({ categories: ['Tanakh', 'Torah'], title: 'Genesis' }), 'hashem');
  assert.strictEqual(readingFor({ categories: ['Commentary'], title: 'Rashi on Genesis' }), 'hashem');
  assert.strictEqual(readingFor(null), 'hashem');
  assert.strictEqual(readingFor('Siddur Ashkenaz'), 'adonai');
});

test('a Hebrew liturgical title is enough to classify a work', () => {
  assert.strictEqual(isLiturgical({ heTitle: 'סידור' }), true);
  assert.strictEqual(isLiturgical({ heTitle: 'מחזור' }), true);
  assert.strictEqual(isLiturgical({ categories: ['Tanakh'], heTitle: 'בראשית' }), false);
});
