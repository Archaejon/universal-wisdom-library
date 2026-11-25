// Ported from Sefaria Lens (test/translit.test.js), MIT License, (c) 2026 Sefaria Lens contributors.
// @ts-nocheck
import { test } from 'bun:test';
import assert from 'node:assert';
import { transliterate, transliterateWord, wordInfo } from '../client/translit/hebrew-engine';

const cases = [
  // word, modern, ashkenazi, mizrahi
  ['בְּרֵאשִׁית', 'bereshit', 'berey shis'.replace(' ', ''), 'bereshiṯ'],
  ['שָׁלוֹם', 'shalom', 'sholōm', 'shalom'],
  ['שַׁבָּת', 'shabbat', 'shabbos', 'shabbaṯ'],
  ['תּוֹרָה', 'torah', 'tōroh', 'torah'],
  ['חָכְמָה', 'chochmah', 'chochmoh', 'ḥokhmah'],
  ['רוּחַ', 'ruach', 'ruach', 'ruaḥ'],
  ['מַלְכָּה', 'malkah', 'malkoh', 'malkah'],
  ['בֵּית', 'beyt', 'beys', 'beyṯ'],
  ['עַיִן', 'ayin', 'ayin', 'ʿayin'],
  ['אָדָם', 'adam', 'odom', 'aḏam'],
  ['אֱמֶת', 'emet', 'emes', 'emeṯ'],
  ['קָדוֹשׁ', 'kadosh', 'kodōsh', 'qaḏosh'],
  ['צַדִּיק', 'tzaddik', 'tzaddik', 'ṣaddiq'],
  ['יְרוּשָׁלַיִם', 'yerushalayim', 'yerusholayim', 'yerushalayim'],
  ['גָּבֹהַּ', 'gavoah', 'govōah', 'gavoah'],
  ['וַיִּקְרָא', 'vayikra', 'vayikro', 'wayiqra'],
];

for (const [word, modern, ashkenazi, mizrahi] of cases) {
  test(`transliterates ${word}`, () => {
    assert.strictEqual(transliterateWord(word, 'modern'), modern);
    assert.strictEqual(transliterateWord(word, 'ashkenazi'), ashkenazi);
    assert.strictEqual(transliterateWord(word, 'mizrahi'), mizrahi);
  });
}

test('yemeni uses qamatz = o, segol = a, holam = ö, and gimel dagesh = j', () => {
  assert.strictEqual(transliterateWord('שָׁלוֹם', 'yemeni'), 'sholöm');
  assert.strictEqual(transliterateWord('תּוֹרָה', 'yemeni'), 'töroh');
  assert.strictEqual(transliterateWord('אָדָם', 'yemeni'), 'oḏom');
  assert.strictEqual(transliterateWord('אֱמֶת', 'yemeni'), 'amaṯ');
  assert.strictEqual(transliterateWord('גָּדוֹל', 'yemeni'), 'joḏöl');
  assert.strictEqual(transliterateWord('בְּרֵאשִׁית', 'yemeni'), 'bareshiṯ');
  assert.strictEqual(transliterateWord('יְרוּשָׁלַיִם', 'yemeni'), 'yarusholayim');
});

test('kavkazi keeps patah as a while tzere and segol take ä', () => {
  assert.strictEqual(transliterateWord('שָׁלוֹם', 'kavkazi'), 'sholöm');
  assert.strictEqual(transliterateWord('תּוֹרָה', 'kavkazi'), 'töroh');
  // Patah is plain a, so patah and segol are no longer written alike.
  assert.strictEqual(transliterateWord('שַׁבָּת', 'kavkazi'), 'shabbot');
  assert.strictEqual(transliterateWord('וַיִּקְרָא', 'kavkazi'), 'vayiqro');
  // Tzere and segol both take ä, including a hataf segol.
  assert.strictEqual(transliterateWord('סֵפֶר', 'kavkazi'), 'säfär');
  assert.strictEqual(transliterateWord('אֱמֶת', 'kavkazi'), 'ämät');
  assert.strictEqual(transliterateWord('בְּרֵאשִׁית', 'kavkazi'), 'bäräshit');
  // Consonants are unchanged: vav = v, tet and tav rafe = t.
  assert.strictEqual(transliterateWord('טוֹב', 'kavkazi'), 'töv');
});

test('the new traditions lose their umlauts when scholarly diacritics are off', () => {
  assert.strictEqual(transliterateWord('שָׁלוֹם', 'yemeni', { diacritics: false }), 'sholom');
  assert.strictEqual(transliterateWord('שָׁלוֹם', 'kavkazi', { diacritics: false }), 'sholom');
  assert.strictEqual(transliterateWord('אֱמֶת', 'kavkazi', { diacritics: false }), 'amat');
  // Plain patah and folded segol meet at a, which is why the umlaut is the
  // marker a reader must switch on to see the Kavkazi distinction.
  assert.strictEqual(transliterateWord('שַׁבָּת', 'kavkazi', { diacritics: false }), 'shabbot');
});

test('wordInfo includes the yemeni and kavkazi readings', () => {
  const info = wordInfo('שָׁלוֹם', { style: 'yemeni' });
  assert.strictEqual(info.yemeni, 'sholöm');
  assert.strictEqual(info.kavkazi, 'sholöm');
  assert.strictEqual(info.style, 'yemeni');
});

test('three core styles are distinguishable', () => {
  const w = 'שַׁבָּת';
  const a = transliterateWord(w, 'modern');
  const b = transliterateWord(w, 'ashkenazi');
  const c = transliterateWord(w, 'mizrahi');
  assert.strictEqual(new Set([a, b, c]).size, 3);
});

test('maqaf becomes a hyphen instead of joining words', () => {
  assert.strictEqual(transliterate('וַיְהִי־אוֹר', { style: 'modern' }), 'vayhi-or');
});

test('preserves punctuation and spacing', () => {
  const out = transliterate('שָׁלוֹם, עוֹלָם!', { style: 'modern' });
  assert.strictEqual(out, 'shalom, olam!');
});

test('strips diacritics when asked', () => {
  assert.strictEqual(transliterateWord('צַדִּיק', 'mizrahi', { diacritics: false }), 'tsaddiq');
  assert.strictEqual(transliterateWord('רוּחַ', 'mizrahi', { diacritics: false }), 'ruach');
  assert.strictEqual(transliterateWord('דָּבָר', 'mizrahi', { diacritics: false }), 'davar');
  assert.strictEqual(transliterateWord('שַׁבָּת', 'mizrahi', { diacritics: false }), 'shabbat');
  // Ashkenazi holam keeps its macron only in the scholarly form.
  assert.strictEqual(transliterateWord('תּוֹרָה', 'ashkenazi', { diacritics: false }), 'toroh');
});

test('mizrahi writes bet, khaf and pe rafe with their plain sounds', () => {
  assert.strictEqual(transliterateWord('דָּבָר', 'mizrahi'), 'davar');
  assert.strictEqual(transliterateWord('מֶלֶךְ', 'mizrahi'), 'melekh');
  assert.strictEqual(transliterateWord('לֵב', 'mizrahi'), 'lev');
  assert.strictEqual(transliterateWord('סֵפֶר', 'mizrahi'), 'sefer');
  assert.strictEqual(transliterateWord('טוֹב', 'mizrahi'), 'ṭov');
  assert.strictEqual(transliterateWord('צַדִּיק', 'mizrahi'), 'ṣaddiq');
  assert.strictEqual(transliterateWord('קָדוֹשׁ', 'mizrahi'), 'qaḏosh');
});

test('mizrahi pronounces vav as w', () => {
  assert.strictEqual(transliterateWord('וָו', 'mizrahi'), 'waw');
  assert.strictEqual(transliterateWord('וַיִּקְרָא', 'mizrahi'), 'wayiqra');
  // Shuruk and holam vav remain vowels, not consonants.
  assert.strictEqual(transliterateWord('רוּחַ', 'mizrahi'), 'ruaḥ');
  assert.strictEqual(transliterateWord('קָדוֹשׁ', 'mizrahi'), 'qaḏosh');
});

test('ashkenazi distinguishes qamatz from holam', () => {
  assert.strictEqual(transliterateWord('אָדָם', 'ashkenazi'), 'odom');
  assert.strictEqual(transliterateWord('אֹדֶם', 'ashkenazi'), 'ōdem');
  assert.strictEqual(transliterateWord('תּוֹרָה', 'ashkenazi'), 'tōroh');
});

test('word-initial begedkefet without dagesh stays plosive, and a maqaf keeps the rafe', () => {
  assert.strictEqual(transliterateWord('תֹהוּ', 'mizrahi'), 'tohu');
  assert.strictEqual(transliterateWord('תְהוֹם', 'mizrahi'), 'tehom');
  assert.strictEqual(transliterateWord('בֹהוּ', 'mizrahi'), 'bohu');
  // Inside the word (after a vowel) the same letter still spirantizes.
  assert.strictEqual(transliterate('תֹהוּ וָבֹהוּ', { style: 'mizrahi' }), 'tohu wavohu');
  assert.strictEqual(transliterate('אֶל־בֵּית', { style: 'mizrahi' }), 'el-beyṯ');
});

test('ignores cantillation marks', () => {
  const withTrop = 'בְּרֵאשִׁ֖ית';
  assert.strictEqual(transliterateWord(withTrop, 'modern'), 'bereshit');
});

test('wordInfo returns every tradition and the active style', () => {
  const info = wordInfo('שָׁלוֹם', { style: 'modern' });
  assert.strictEqual(info.modern, 'shalom');
  assert.strictEqual(info.ashkenazi, 'sholōm');
  assert.strictEqual(info.style, 'modern');
});

test('unvocalized words keep their consonants rather than reverting to Hebrew', () => {
  assert.strictEqual(transliterate('שלום עולם', { style: 'modern' }), "shlvm 'vlm");
  assert.strictEqual(transliterateWord('בראשית', 'modern'), "br'shyt");
  assert.strictEqual(transliterateWord('תהלים', 'modern'), 'thlym');
  // A lone shva is a prefix, and is read: וְ -> ve, בְּ -> be.
  assert.strictEqual(transliterateWord('בְּ', 'modern'), 'be');
  assert.strictEqual(transliterateWord('וְ', 'modern'), 've');
  // A defective spelling with only a shva still reads its consonants.
  assert.strictEqual(transliterateWord('שְׁלשׁ', 'modern'), 'shelsh');
});

test('a qamats qatan is a vowel even when the source writes no qamats', () => {
  assert.strictEqual(transliterateWord('כׇּל', 'modern'), 'kol');
  assert.strictEqual(transliterateWord('בְּכׇל', 'modern'), 'bechol');
  assert.strictEqual(transliterateWord('וּלְכׇל', 'modern'), 'ulchol');
  assert.strictEqual(transliterate('כׇּל־הַיָּמִים', { style: 'modern' }), 'kol-hayamim');
});

test('the ־ָיו suffix reads -av, with the yod as a mater rather than a consonant', () => {
  // The yod writes the qamats; only the vav is heard.
  assert.strictEqual(transliterateWord('דְּבָרָיו', 'modern'), 'devarav');
  assert.strictEqual(transliterateWord('פָּנָיו', 'modern'), 'panav');
  assert.strictEqual(transliterateWord('עָלָיו', 'modern'), 'alav');
  assert.strictEqual(transliterateWord('בָּנָיו', 'modern'), 'banav');
  assert.strictEqual(transliterateWord('חֻקֹּתָיו', 'modern'), 'chukkotav');
  // Each tradition keeps its own vowel and vav: -ov in Ashkenazi, -aw / -ow in
  // the w-pronouncing traditions, -āw with the Ancient macron.
  assert.strictEqual(transliterateWord('חֻקֹּתָיו', 'ashkenazi'), 'chukkōsov');
  assert.strictEqual(transliterateWord('חֻקֹּתָיו', 'mizrahi'), 'ḥuqqoṯaw');
  assert.strictEqual(transliterateWord('חֻקֹּתָיו', 'yemeni'), 'ḥuqqöṯow');
  assert.strictEqual(transliterateWord('חֻקֹּתָיו', 'kavkazi'), 'ḥuqqötov');
  assert.strictEqual(transliterateWord('חֻקֹּתָיו', 'ancient'), 'ḥuqqōṯāw');
  assert.strictEqual(transliterateWord('חֻקֹּתָיו', 'ancient-hard'), 'ḥuqqōtāw');
  assert.strictEqual(transliterate('וּמִשְׁפָּטָיו', { style: 'modern' }), 'umishpatav');
  // A yod that carries its own point stays a consonant.
  assert.strictEqual(transliterateWord('שָׁמַיִם', 'modern'), 'shamayim');
  assert.strictEqual(transliterateWord('בַּיִת', 'modern'), 'bayit');
  assert.strictEqual(transliterateWord('עֵינָיו', 'modern'), 'eynav');
});

test('a shuruk written with the dagesh alone still reads as a vowel', () => {
  assert.strictEqual(transliterateWord('הוּא', 'modern'), 'hu');
  assert.strictEqual(transliterateWord('וְהוּא', 'modern'), 'vehu');
  assert.strictEqual(transliterateWord('מ֚וּל', 'mizrahi'), 'mul');
});

test('the name written as an abbreviation reads as the euphemism', () => {
  assert.strictEqual(transliterateWord("ה'", 'modern'), 'HaShem');
  assert.strictEqual(transliterateWord('ה׳', 'modern'), 'HaShem');
  assert.strictEqual(transliterateWord("וַה'", 'modern'), 'va-HaShem');
  assert.strictEqual(transliterateWord("ה'", 'modern', { divineName: 'adonai' }), 'Adonai');
  assert.strictEqual(transliterateWord('יי', 'modern'), 'HaShem');
  assert.strictEqual(transliterateWord('י"ה', 'modern'), 'HaShem');
  // The spelled-out name still reads the same way.
  assert.strictEqual(transliterateWord('יְהֹוָה', 'modern'), 'HaShem');
});

test('Hebrew citations read as Latin references', () => {
  assert.strictEqual(transliterate('(תהלים לא, יט)', { style: 'modern' }), '(Psalms 31:19)');
  assert.strictEqual(transliterate('(במדבר יא, יב)', { style: 'modern' }), '(Numbers 11:12)');
  assert.strictEqual(transliterate('(יהושע א ח)', { style: 'modern' }), '(Joshua 1:8)');
  assert.strictEqual(transliterate('(משלי ח, כא כב)', { style: 'modern' }), '(Proverbs 8:21-22)');
  assert.strictEqual(transliterate('(שם לה)', { style: 'modern' }), '(ibid. 35)');
  assert.strictEqual(transliterate('(דניאל ב׳ כב)', { style: 'modern' }), '(Daniel 2:22)');
  // Gershayim inside a numeral mark one number, not a break: קי"א is 111.
  assert.strictEqual(transliterate('(תהילים קי"א)', { style: 'modern' }), '(Psalms 111)');
  assert.strictEqual(transliterate('(דברים י"ח, ד\')', { style: 'modern' }), '(Deuteronomy 18:4)');
  assert.strictEqual(transliterate('(ישעיהו מ"ו)', { style: 'modern' }), '(Isaiah 46)');
  assert.strictEqual(transliterate('(שם כ"ז)', { style: 'modern' }), '(ibid. 27)');
  // A pointed parenthesis is text, not a reference, and is read normally.
  assert.strictEqual(transliterate('(בֶּן נְבָט)', { style: 'modern' }), '(ben nevat)');
});

test('רבי abbreviations read as words, not as letters', () => {
  assert.strictEqual(transliterate('יוֹם יוֹם וגו׳', { style: 'modern' }), "yom yom etc.");
  assert.strictEqual(transliterateWord('וגו\'', 'modern'), 'etc.');
  assert.strictEqual(transliterateWord('וכו׳', 'modern'), 'etc.');
  // Acronyms are read, and a final letter still matches its regular form.
  assert.strictEqual(transliterateWord('הקב"ה', 'modern'), 'HaKadosh Baruch Hu');
  assert.strictEqual(transliterateWord('רמב"ם', 'modern'), 'Rambam');
  assert.strictEqual(transliterateWord('רמב״ן', 'modern'), 'Ramban');
  assert.strictEqual(transliterateWord('ע"ז', 'modern'), 'avodah zarah');
});

test('no Hebrew letters survive a transliteration, pointed or not', () => {
  const sample = 'שֶׁנֶּאֱמַר (תהלים לא, יט) כׇּל־הַיָּמִים וְגוֹ׳ בְּכׇל לֵב. שְׁלשׁ ' +
    'רָבִיא (הרב) וגו\' ה׳ יי (שם) תהלים בראשית';
  for (const style of ['modern', 'ashkenazi', 'mizrahi', 'yemeni', 'kavkazi', 'ancient', 'ancient-hard']) {
    assert.doesNotMatch(transliterate(sample, { style }), /[\u0590-\u05FF]/, style);
  }
});

test('ancient marks Tiberian vowel length', () => {
  assert.strictEqual(transliterateWord('שָׁלוֹם', 'ancient'), 'shālōm');
  assert.strictEqual(transliterateWord('תּוֹרָה', 'ancient'), 'tōrāh');
  assert.strictEqual(transliterateWord('אָדָם', 'ancient'), 'āḏām');
  // Short signs stay plain: patah, segol, hiriq, qubbuts, qamats qatan.
  assert.strictEqual(transliterateWord('שַׁבָּת', 'ancient'), 'shabbāṯ');
  assert.strictEqual(transliterateWord('סֵפֶר', 'ancient'), 'sēfer');
  assert.strictEqual(transliterateWord('כָּל', 'ancient'), 'kol');
  assert.strictEqual(transliterateWord('קָדוֹשׁ', 'ancient'), 'qāḏōsh');
  // Hiriq-yod is the long ī; a bare hiriq stays short.
  assert.strictEqual(transliterateWord('בְּרֵאשִׁית', 'ancient'), 'bərēshīṯ');
  assert.strictEqual(transliterateWord('עִבְרִית', 'ancient'), 'ʿivrīṯ');
  // Reduced vowels are breve, shva na is schwa.
  assert.strictEqual(transliterateWord('אֱמֶת', 'ancient'), 'ĕmeṯ');
  assert.strictEqual(transliterate('אֱלֹהִים', { style: 'ancient' }), 'ĕlōhīm');
});

test('ancient marks sin with an acute and keeps ḥ ʿ apart from ḵ ḡ', () => {
  assert.strictEqual(transliterateWord('שָׂרָה', 'ancient'), 'śārāh');
  assert.strictEqual(transliterateWord('שָׁלוֹם', 'ancient'), 'shālōm');
  assert.strictEqual(transliterateWord('עָשָׂה', 'ancient'), 'ʿāśāh');
  assert.strictEqual(transliterateWord('רוּחַ', 'ancient'), 'rūaḥ');
  assert.strictEqual(transliterateWord('חָכְמָה', 'ancient'), 'ḥoḵmāh');
  assert.strictEqual(transliterateWord('מֶלֶךְ', 'ancient'), 'meleḵ');
  assert.strictEqual(transliterateWord('רֶגֶל', 'ancient'), 'reḡel');
});

test('ancient-hard reads every begedkefet letter as plosive', () => {
  assert.strictEqual(transliterateWord('דָּבָר', 'ancient'), 'dāvār');
  assert.strictEqual(transliterateWord('דָּבָר', 'ancient-hard'), 'dābār');
  assert.strictEqual(transliterateWord('סֵפֶר', 'ancient-hard'), 'sēper');
  assert.strictEqual(transliterateWord('בֵּית', 'ancient-hard'), 'bēyt');
  assert.strictEqual(transliterateWord('תּוֹרָה', 'ancient'), 'tōrāh');
  // A tav without a dagesh is ṯ in the paired scheme and t in the hard one.
  assert.strictEqual(transliterateWord('בַּיִת', 'ancient'), 'bayiṯ');
  assert.strictEqual(transliterateWord('בַּיִת', 'ancient-hard'), 'bayit');
});

test('ancient drops its marks when scholarly diacritics are off', () => {
  assert.strictEqual(transliterateWord('שָׂרָה', 'ancient', { diacritics: false }), 'sarah');
  assert.strictEqual(transliterateWord('שָׁלוֹם', 'ancient', { diacritics: false }), 'shalom');
  assert.strictEqual(transliterateWord('חָכְמָה', 'ancient', { diacritics: false }), 'chokhmah');
});

test('wordInfo includes the ancient readings', () => {
  const info = wordInfo('שָׁלוֹם', { style: 'ancient' });
  assert.strictEqual(info.ancient, 'shālōm');
  assert.strictEqual(info['ancient-hard'], 'shālōm');
  assert.strictEqual(info.style, 'ancient');
});

test('empty input', () => {
  assert.strictEqual(transliterate('', {}), '');
  assert.strictEqual(transliterateWord('', 'modern'), '');
});
