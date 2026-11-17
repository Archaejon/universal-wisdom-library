// Generates the extended tradition/author/works catalogue for the Global Source
// Registry phase. Only metadata is generated here; the one imported text in
// this phase is George Fox's Journal, written by scripts/dev/import-gutenberg-fox.ts.
//
// Run: bun run generate:extensions

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../../server/db";

const metaPath = join(ROOT, "data", "corpus", "meta.json");
const worksDir = join(ROOT, "data", "corpus", "works");
const meta = JSON.parse(readFileSync(metaPath, "utf8"));

const languages = [
  { code: "fa", name: "Persian", native_name: "فارسی", direction: "rtl" },
  { code: "vi", name: "Vietnamese", native_name: "Tiếng Việt", direction: "ltr" },
  { code: "am", name: "Amharic", native_name: "አማርኛ", direction: "ltr" },
  { code: "de", name: "German", native_name: "Deutsch", direction: "ltr" },
  { code: "ko", name: "Korean", native_name: "한국어", direction: "ltr" },
];

const traditions = [
  {
    slug: "bahai",
    name: "Bahá’í Faith",
    short_name: "Bahá’í",
    description:
      "The teachings of Bahá’u’lláh, the Báb and ‘Abdu’l-Bahá, with authorised interpretations and the guidance of the Universal House of Justice. The tradition emphasises the unity of religions, humanity and justice.",
    permissions_note:
      "Official Bahá’í texts are protected by copyright. The Bahá’í Reference Library permits reading and per-publication download under its legal terms, but no open corpus licence or automated-ingestion permission was found. Catalogue records link to the official library; no text is imported in this build.",
    sort_order: 140,
  },
  {
    slug: "quakerism",
    name: "Quakerism / Religious Society of Friends",
    short_name: "Quaker",
    description:
      "A family of Friends’ traditions rooted in the seventeenth-century teaching of George Fox, emphasising direct experience of the Spirit, silence, equality, simplicity, integrity and peace. Theology and practice differ among yearly meetings.",
    permissions_note:
      "Quaker Faith & Practice is a copyrighted book of discipline and its extracts carry separate rights; it is not imported. George Fox’s Journal (1901 Penney edition) is public domain in the United States and is included as a tested Project Gutenberg import. Other Quaker bodies maintain their own disciplines.",
    sort_order: 150,
  },
  {
    slug: "unitarian-universalism",
    name: "Unitarian Universalism",
    short_name: "UU",
    description:
      "A pluralistic living tradition formed by the 1961 merger of Unitarianism and Universalism. It has no single canon and draws on multiple religious, humanist, Earth-centred and prophetic sources.",
    permissions_note:
      "UUA worship and statement texts are copyrighted and their worship permission is limited to UUA member congregations. Catalogue records identify the statement and date and link to the official page; no UUA text is imported.",
    sort_order: 160,
  },
  {
    slug: "unitarianism",
    name: "Unitarianism (historical)",
    short_name: "Unitarian",
    description:
      "Historical traditions that rejected Trinitarian doctrine and emphasised human moral capacity, reason and the unity of God. Distinct from, though a predecessor of, contemporary Unitarian Universalism.",
    permissions_note:
      "Many nineteenth-century Unitarian sermons and treatises are public domain, but each edition must be verified. Catalogue records only in this build.",
    sort_order: 170,
  },
  {
    slug: "universalism",
    name: "Universalism (historical)",
    short_name: "Universalist",
    description:
      "Historical Christian traditions teaching universal salvation and the eventual restoration of all souls. A predecessor of contemporary Unitarian Universalism, with its own institutions and theologians.",
    permissions_note:
      "Public-domain works exist, but no verified text is imported in this build. Catalogue records only.",
    sort_order: 180,
  },
  {
    slug: "ethical-culture",
    name: "Ethical Culture",
    short_name: "Ethical",
    description:
      "A humanist religious movement founded by Felix Adler in 1876, centred on ethical relationships, social justice and the worth of every person without supernatural doctrine.",
    permissions_note:
      "Movement statements and modern publications are generally copyrighted. No text is imported; catalogue metadata records the movement without treating it as a canon.",
    sort_order: 190,
  },
  {
    slug: "humanism",
    name: "Humanism",
    short_name: "Humanist",
    description:
      "A broad family of non-theistic ethical and philosophical stances, including organised humanist movements and secular philosophies. Not all humanism is religious, and not all secular philosophy is humanism.",
    permissions_note:
      "Humanist manifestos have their own publication histories and rights. No text is imported in this build.",
    sort_order: 200,
  },
  {
    slug: "paganism",
    name: "Modern Paganism",
    short_name: "Pagan",
    description:
      "Contemporary religious movements drawing on pre-Christian European and other traditions, including Wicca, Druidry, Heathenry and reconstructed traditions. Modern compositions must not be presented as ancient texts.",
    permissions_note:
      "Most contemporary Pagan liturgy and course material is authored and rights-managed. No text is imported. Public declarations may be catalogued and linked; closed or members-only material is respected.",
    sort_order: 210,
  },
  {
    slug: "wicca",
    name: "Wicca",
    short_name: "Wiccan",
    description:
      "A modern initiatory Pagan religion emerging in mid-twentieth-century Britain and later diversifying into many lineages. Its texts are modern compositions, not survivals of an ancient scripture.",
    permissions_note:
      "Modern Wiccan texts, including the Charge of the Goddess, are under copyright. Catalogue only; no text is reproduced.",
    sort_order: 220,
  },
  {
    slug: "druidry",
    name: "Druidry",
    short_name: "Druid",
    description:
      "Modern Druid orders and fellowships inspired by ancient Celtic imagery and later revivals. Ancient druids left no scripture; modern orders have their own liturgies and training materials.",
    permissions_note:
      "Modern order material is authored and often members-only. No text is imported. The registry records OBOD, ADF and related bodies for discovery.",
    sort_order: 230,
  },
  {
    slug: "rastafari",
    name: "Rastafari",
    short_name: "Rastafari",
    description:
      "A diverse Caribbean-rooted movement arising in the 1930s, centred on the divinity of Haile Selassie I, Ethiopian identity, liberation, biblical interpretation and livity. There is no single governing authority or canon.",
    permissions_note:
      "Community and scholarly sources are mixed and often copyrighted. No text is imported; no single text is treated as representing all Rastafari.",
    sort_order: 240,
  },
  {
    slug: "latter-day-saints",
    name: "Latter-day Saints and Restorationist traditions",
    short_name: "LDS",
    description:
      "The Church of Jesus Christ of Latter-day Saints and related Restorationist movements, with distinct scriptures including the Book of Mormon, Doctrine and Covenants and Pearl of Great Price. Other Restorationist bodies are not interchangeable with the LDS Church.",
    permissions_note:
      "Official LDS scripture pages permit personal noncommercial reading and printing but prohibit posting or automated copying without permission. Catalogue only; no text is imported.",
    sort_order: 250,
  },
  {
    slug: "tenrikyo",
    name: "Tenrikyo",
    short_name: "Tenrikyo",
    description:
      "A Japanese new religious movement founded through Nakayama Miki in the nineteenth century, centring on the Ofudesaki, the service and the teaching of joyous life.",
    permissions_note:
      "Official English translations are separately published and no open licence was found. Catalogue only; no text is imported.",
    sort_order: 260,
  },
  {
    slug: "caodai",
    name: "Cao Dai",
    short_name: "Cao Dai",
    description:
      "A Vietnamese syncretic religion founded in 1926, combining elements of Buddhism, Confucianism, Daoism, Christianity and local spirituality. Branches differ in organisation and authority.",
    permissions_note:
      "Institutional sources exist, but the English Phap Chanh Truyen translation on the Sacerdotal Council site is explicitly not an official translation and rights are unclear. Catalogue only.",
    sort_order: 270,
  },
  {
    slug: "theosophy",
    name: "Theosophy",
    short_name: "Theosophical",
    description:
      "A modern esoteric movement associated with Helena Petrovna Blavatsky and the Theosophical Society, drawing on comparative religion, philosophy and occult claims. It has multiple organisations and no single authority.",
    permissions_note:
      "Some original works are public domain, but editions, compilations and translations vary. Catalogue only in this build.",
    sort_order: 280,
  },
  {
    slug: "anthroposophy",
    name: "Anthroposophy",
    short_name: "Anthroposophical",
    description:
      "A spiritual-philosophical movement founded by Rudolf Steiner, with its own methods of knowledge, education, agriculture and the arts. It is not a single canon religion.",
    permissions_note:
      "Translations and lecture transcripts carry varying rights. Catalogue only in this build.",
    sort_order: 290,
  },
  {
    slug: "spiritualism",
    name: "Spiritualism",
    short_name: "Spiritualist",
    description:
      "Modern traditions centred on communication with spirits, mediumship and the continuity of consciousness. Organisations and practices vary widely.",
    permissions_note:
      "Historical works may be public domain, but no verified edition is imported in this build. Catalogue only.",
    sort_order: 300,
  },
  {
    slug: "eckankar",
    name: "Eckankar",
    short_name: "Eckankar",
    description:
      "A modern American spiritual movement founded by Paul Twitchell, teaching soul travel, divine sound and the Mahanta lineage. Its current organisation is the Eckankar faith.",
    permissions_note:
      "Modern publications are copyrighted. Catalogue only; no text is imported.",
    sort_order: 310,
  },
  {
    slug: "unificationism",
    name: "Unification movement",
    short_name: "Unification",
    description:
      "The Family Federation for World Peace and Unification and related movements founded by Sun Myung Moon, with the Divine Principle as a central teaching text. The movement has split into multiple bodies.",
    permissions_note:
      "Modern translations are copyrighted. Catalogue only; no text is imported.",
    sort_order: 320,
  },
  {
    slug: "seicho-no-ie",
    name: "Seicho-no-Ie",
    short_name: "Seicho-no-Ie",
    description:
      "A Japanese new religious movement founded by Masaharu Taniguchi, teaching the immanence of God, the true image of humanity and gratitude-based practice.",
    permissions_note:
      "Official publications and translations are copyrighted. Catalogue only.",
    sort_order: 330,
  },
  {
    slug: "oomoto",
    name: "Oomoto",
    short_name: "Oomoto",
    description:
      "A Japanese new religious movement founded through Nao Deguchi and organised by Onisaburō Deguchi, combining Shinto, esoteric and world-renewal themes.",
    permissions_note:
      "Official texts and translations vary in rights. Catalogue only.",
    sort_order: 340,
  },
  {
    slug: "world-messianism",
    name: "World Messianity / Sekai Kyusei Kyo",
    short_name: "World Messianity",
    description:
      "A Japanese new religious movement founded by Mokichi Okada, teaching purification, natural farming and the realisation of a paradisiacal world.",
    permissions_note:
      "Modern publications are copyrighted. Catalogue only.",
    sort_order: 350,
  },
];

const schools = [
  { slug: "britain-yearly-meeting", tradition: "quakerism", name: "Britain Yearly Meeting", description: "The yearly meeting of the Religious Society of Friends in Britain." },
  { slug: "uua", tradition: "unitarian-universalism", name: "Unitarian Universalist Association", description: "The North American association of Unitarian Universalist congregations." },
  { slug: "historical-unitarianism", tradition: "unitarianism", name: "Historical Unitarianism", description: "Unitarian congregations and thinkers before the 1961 merger." },
  { slug: "historical-universalism", tradition: "universalism", name: "Historical Universalism", description: "Universalist congregations and thinkers before the 1961 merger." },
  { slug: "ethical-culture", tradition: "ethical-culture", name: "Ethical Culture movement", description: "Societies founded in the tradition of Felix Adler." },
  { slug: "wiccan", tradition: "wicca", name: "Wiccan lineages", description: "Initiatory and solitary Wiccan traditions; practice varies." },
  { slug: "obod", tradition: "druidry", name: "Order of Bards, Ovates & Druids", description: "A modern Druid order founded in Britain." },
  { slug: "adf", tradition: "druidry", name: "Ár nDraíocht Féin", description: "A modern Druid fellowship founded in North America." },
  { slug: "lds", tradition: "latter-day-saints", name: "The Church of Jesus Christ of Latter-day Saints", description: "The largest Latter-day Saint denomination." },
  { slug: "tay-ninh", tradition: "caodai", name: "Tay Ninh Holy See", description: "The Cao Dai branch associated with the Sacerdotal Council at Tay Ninh." },
  { slug: "theosophical-society", tradition: "theosophy", name: "Theosophical Society", description: "The Theosophical Society and related organisations." },
  { slug: "anthroposophical-society", tradition: "anthroposophy", name: "Anthroposophical Society", description: "The society founded by Rudolf Steiner." },
  { slug: "spiritualist", tradition: "spiritualism", name: "Spiritualist organisations", description: "A range of Spiritualist churches and associations." },
  { slug: "eckankar", tradition: "eckankar", name: "Eckankar", description: "The Eckankar faith founded by Paul Twitchell." },
  { slug: "unification-church", tradition: "unificationism", name: "Family Federation", description: "The Unification movement and related bodies." },
  { slug: "seicho-no-ie", tradition: "seicho-no-ie", name: "Seicho-no-Ie", description: "The movement founded by Masaharu Taniguchi." },
  { slug: "oomoto", tradition: "oomoto", name: "Oomoto", description: "The Oomoto movement." },
  { slug: "world-messianism", tradition: "world-messianism", name: "Sekai Kyusei Kyo", description: "The World Messianity movement." },
];

const authors = [
  { slug: "george-fox", name: "George Fox", sort_name: "Fox, George", date_display: "1624–1691", description: "English preacher and a founder of the Religious Society of Friends.", is_attributed: false },
  { slug: "bahaullah", name: "Bahá’u’lláh", sort_name: "Bahá’u’lláh", date_display: "1817–1892", description: "Founder of the Bahá’í Faith; his writings are authoritative scripture for Bahá’ís.", is_attributed: false },
  { slug: "the-bab", name: "The Báb", sort_name: "Báb", date_display: "1819–1850", description: "Founder of the Bábí movement and a central figure for Bahá’ís.", is_attributed: false },
  { slug: "abdul-baha", name: "‘Abdu’l-Bahá", sort_name: "‘Abdu’l-Bahá", date_display: "1844–1921", description: "Son of Bahá’u’lláh and authorised interpreter of his writings.", is_attributed: false },
  { slug: "shoghi-effendi", name: "Shoghi Effendi", sort_name: "Shoghi Effendi", date_display: "1897–1957", description: "Guardian of the Bahá’í Faith and authorised interpreter of its writings.", is_attributed: false },
  { slug: "robert-barclay", name: "Robert Barclay", sort_name: "Barclay, Robert", date_display: "1648–1690", description: "Quaker theologian, author of the Apology for the True Christian Divinity.", is_attributed: false },
  { slug: "william-ellery-channing", name: "William Ellery Channing", sort_name: "Channing, William Ellery", date_display: "1780–1842", description: "American Unitarian preacher and theologian.", is_attributed: false },
  { slug: "theodore-parker", name: "Theodore Parker", sort_name: "Parker, Theodore", date_display: "1810–1860", description: "American Transcendentalist and Unitarian minister.", is_attributed: false },
  { slug: "hosea-ballou", name: "Hosea Ballou", sort_name: "Ballou, Hosea", date_display: "1771–1852", description: "American Universalist minister and theologian.", is_attributed: false },
  { slug: "felix-adler", name: "Felix Adler", sort_name: "Adler, Felix", date_display: "1851–1933", description: "Founder of the Ethical Culture movement.", is_attributed: false },
  { slug: "doreen-valiente", name: "Doreen Valiente", sort_name: "Valiente, Doreen", date_display: "1922–1999", description: "Influential Wiccan priestess and author.", is_attributed: false },
  { slug: "joseph-smith", name: "Joseph Smith", sort_name: "Smith, Joseph", date_display: "1805–1844", description: "Founder of the Latter-day Saint movement.", is_attributed: false },
  { slug: "nakayama-miki", name: "Nakayama Miki", sort_name: "Nakayama, Miki", date_display: "1798–1887", description: "Founder of Tenrikyo.", is_attributed: false },
  { slug: "blavatsky", name: "Helena Petrovna Blavatsky", sort_name: "Blavatsky, Helena", date_display: "1831–1891", description: "Co-founder of the Theosophical Society and author of The Secret Doctrine.", is_attributed: false },
  { slug: "rudolf-steiner", name: "Rudolf Steiner", sort_name: "Steiner, Rudolf", date_display: "1861–1925", description: "Founder of Anthroposophy.", is_attributed: false },
  { slug: "paul-twitchell", name: "Paul Twitchell", sort_name: "Twitchell, Paul", date_display: "1908–1971", description: "Founder of Eckankar.", is_attributed: false },
  { slug: "sun-myung-moon", name: "Sun Myung Moon", sort_name: "Moon, Sun Myung", date_display: "1920–2012", description: "Founder of the Unification movement.", is_attributed: false },
  { slug: "masaharu-taniguchi", name: "Masaharu Taniguchi", sort_name: "Taniguchi, Masaharu", date_display: "1893–1985", description: "Founder of Seicho-no-Ie.", is_attributed: false },
  { slug: "onisaburo-deguchi", name: "Onisaburō Deguchi", sort_name: "Deguchi, Onisaburō", date_display: "1871–1948", description: "Co-founder and leader of Oomoto.", is_attributed: false },
  { slug: "mokichi-okada", name: "Mokichi Okada", sort_name: "Okada, Mokichi", date_display: "1882–1955", description: "Founder of World Messianity (Sekai Kyusei Kyo).", is_attributed: false },
  { slug: "haile-selassie", name: "Haile Selassie I", sort_name: "Selassie, Haile", date_display: "1892–1975", description: "Emperor of Ethiopia, central to Rastafari reverence and interpretation.", is_attributed: false },
];

function upsert(list: any[], item: any, key: string) {
  const i = list.findIndex((x) => x[key] === item[key]);
  if (i >= 0) list[i] = { ...list[i], ...item };
  else list.push(item);
}

for (const l of languages) upsert(meta.languages, l, "code");
for (const t of traditions) upsert(meta.traditions, t, "slug");
for (const s of schools) upsert(meta.schools, s, "slug");
for (const a of authors) upsert(meta.authors, a, "slug");

meta.traditions.sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
meta.authors.sort((a: any, b: any) => a.sort_name.localeCompare(b.sort_name));

writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");

type CatalogueWork = {
  slug: string;
  title: string;
  originalTitle?: string;
  transliteration?: string;
  altTitles?: string[];
  tradition: string;
  school?: string | null;
  genre: string;
  textType: string;
  originalLanguage: string;
  dateStart?: number;
  dateEnd?: number;
  dateDisplay: string;
  authorshipStatus: string;
  author?: string | null;
  attributionNote: string;
  description: string;
  historicalContext: string;
  availabilityNote: string;
  refScheme?: string;
  featured?: number;
  featuredNote?: string;
};

function catalogueWork(w: CatalogueWork) {
  return {
    ...w,
    originalTitle: w.originalTitle ?? "",
    transliteration: w.transliteration ?? "",
    altTitles: w.altTitles ?? [],
    school: w.school ?? null,
    dateStart: w.dateStart ?? null,
    dateEnd: w.dateEnd ?? null,
    sourceNote: "",
    featured: w.featured ?? 0,
    featuredNote: w.featuredNote ?? "",
    refScheme: w.refScheme ?? "catalogue",
    chapters: [],
    passages: [],
    editions: [],
  };
}

const works: CatalogueWork[] = [
  {
    slug: "hidden-words",
    title: "The Hidden Words",
    originalTitle: "کلمات مکنونه",
    transliteration: "Kalimát-i-Maknúnih",
    altTitles: ["Kalimat-i-Maknunih"],
    tradition: "bahai",
    genre: "Scripture",
    textType: "Aphoristic revelation",
    originalLanguage: "ar",
    dateStart: 1858,
    dateEnd: 1858,
    dateDisplay: "c. 1858",
    authorshipStatus: "established",
    author: "bahaullah",
    attributionNote: "Written by Bahá’u’lláh in Arabic and Persian. It is authoritative scripture for Bahá’ís.",
    description:
      "A collection of short, aphoristic passages in Arabic and Persian, described by Bahá’u’lláh as the essence of divine guidance. It is among the most widely read Bahá’í works.",
    historicalContext:
      "Composed around 1858, the Hidden Words distils ethical and spiritual themes into brief addresses to the human soul. The work exists in Arabic and Persian sections; translations are published by the Bahá’í World Centre.",
    availabilityNote:
      "Catalogue record only. Official texts are copyrighted and no corpus-reuse permission was verified. Read the work through the Bahá’í Reference Library.",
  },
  {
    slug: "kitab-i-aqdas",
    title: "The Kitáb-i-Aqdas",
    originalTitle: "الكتاب الأقدس",
    transliteration: "al-Kitáb al-Aqdas",
    altTitles: ["The Most Holy Book"],
    tradition: "bahai",
    genre: "Scripture",
    textType: "Law and revelation",
    originalLanguage: "ar",
    dateStart: 1873,
    dateEnd: 1873,
    dateDisplay: "1873",
    authorshipStatus: "established",
    author: "bahaullah",
    attributionNote: "Written by Bahá’u’lláh. It is the central book of Bahá’í law and is accompanied by authorised notes and supplementary material.",
    description:
      "The Kitáb-i-Aqdas sets out Bahá’í laws, institutions and devotional obligations. It is central to Bahá’í religious practice and is read alongside authorised interpretations and institutional guidance.",
    historicalContext:
      "Completed in 1873 in Ottoman Palestine, the Aqdas addresses the emerging Bahá’í community and its institutions. Later writings and the Universal House of Justice provide authoritative clarification.",
    availabilityNote:
      "Catalogue record only. The official translation and its notes are copyrighted; no text is imported.",
  },
  {
    slug: "kitab-i-iqan",
    title: "The Kitáb-i-Íqán",
    originalTitle: "كتاب الإيقان",
    transliteration: "Kitáb-i-Íqán",
    altTitles: ["The Book of Certitude"],
    tradition: "bahai",
    genre: "Theology",
    textType: "Doctrinal treatise",
    originalLanguage: "fa",
    dateStart: 1861,
    dateEnd: 1861,
    dateDisplay: "1861",
    authorshipStatus: "established",
    author: "bahaullah",
    attributionNote: "Written by Bahá’u’lláh in Persian. It is authoritative scripture and a foundational exposition of Bahá’í interpretation.",
    description:
      "A sustained exposition of the nature of divine revelation, the interpretation of scripture and the succession of messengers. It is one of the central theological works of the Bahá’í Faith.",
    historicalContext:
      "Written in Baghdad in 1861 in response to questions from a relative of the Báb. It interprets biblical and Qur’anic themes within a Bahá’í framework and is read with authorised translations.",
    availabilityNote:
      "Catalogue record only. No text is imported pending permission for corpus use.",
  },
  {
    slug: "seven-valleys",
    title: "The Seven Valleys and the Four Valleys",
    originalTitle: "هفت وادی",
    transliteration: "Haft Vádí",
    tradition: "bahai",
    genre: "Mystical writing",
    textType: "Mystical treatise",
    originalLanguage: "fa",
    dateStart: 1860,
    dateEnd: 1860,
    dateDisplay: "c. 1860",
    authorshipStatus: "established",
    author: "bahaullah",
    attributionNote: "Written by Bahá’u’lláh. The Seven Valleys and Four Valleys are distinct but frequently published together.",
    description:
      "A mystical account of the stages of the soul’s journey toward the beloved, using the language of valleys, waystations and detachment. It is a central Bahá’í contemplative text.",
    historicalContext:
      "Composed in Baghdad in the 1850s–60s, the work engages Sufi imagery while making distinctive Bahá’í claims. Its translation history and authorised editions should be recorded carefully.",
    availabilityNote:
      "Catalogue record only. Official translations are copyrighted; no text is imported.",
  },
  {
    slug: "quaker-faith-and-practice",
    title: "Quaker Faith & Practice",
    altTitles: ["QFP", "Church Government in the Religious Society of Friends"],
    tradition: "quakerism",
    school: "britain-yearly-meeting",
    genre: "Book of discipline",
    textType: "Denominational guidance and extracts",
    originalLanguage: "en",
    dateStart: 2013,
    dateEnd: 2013,
    dateDisplay: "5th edition, 2013 (current online text)",
    authorshipStatus: "composite",
    author: null,
    attributionNote:
      "A compilation by Britain Yearly Meeting, largely made up of extracts from named Friends across history. It is not a universal Quaker scripture, and other yearly meetings maintain different books of discipline.",
    description:
      "Quaker Faith & Practice sets out the discipline, advices, queries, procedures and selected readings of Britain Yearly Meeting. It is a living book, revised over time, and its extracts carry their own authors and historical contexts.",
    historicalContext:
      "The book descends from earlier Quaker disciplines and was substantially reshaped in the twentieth century. The fifth edition is the current Britain Yearly Meeting text, also available online and in print.",
    availabilityNote:
      "Catalogue record only. QFP is copyrighted and no reuse licence was found. The QFP copyright contact is publications@quaker.org.uk.",
  },
  {
    slug: "uu-principles-and-sources",
    title: "Principles and Sources of Unitarian Universalism (1985–2024)",
    altTitles: ["UU Principles and Purposes", "The Six Sources"],
    tradition: "unitarian-universalism",
    school: "uua",
    genre: "Denominational statement",
    textType: "Community statement",
    originalLanguage: "en",
    dateStart: 1985,
    dateEnd: 2024,
    dateDisplay: "1985–2024 (historical statement)",
    authorshipStatus: "composite",
    author: null,
    attributionNote:
      "A statement adopted through UUA congregational processes, not a scripture. In 2024 Unitarian Universalists adopted Shared Values language; the older Six Sources formulation remains historically important but is not the current statement.",
    description:
      "The Principles and Sources expressed a historically specific Unitarian Universalist self-description, including affirmations of inherent worth, justice, spiritual growth and the use of multiple sources. It should be read with its date and institutional provenance.",
    historicalContext:
      "The statement was revised over several decades and reflects the pluralistic character of Unitarian Universalism. Its sources explicitly include direct experience, prophetic traditions, world religions, humanism and Earth-centred spirituality.",
    availabilityNote:
      "Catalogue record only. UUA site terms prohibit distribution or derivative works without written permission. The official UUA page is linked from the source registry.",
  },
  {
    slug: "unitarian-christianity",
    title: "Unitarian Christianity",
    altTitles: ["A Sermon Delivered at the Ordination of Jared Sparks"],
    tradition: "unitarianism",
    school: "historical-unitarianism",
    genre: "Sermon",
    textType: "Theological sermon",
    originalLanguage: "en",
    dateStart: 1819,
    dateEnd: 1819,
    dateDisplay: "1819",
    authorshipStatus: "established",
    author: "william-ellery-channing",
    attributionNote: "A sermon by William Ellery Channing, a leading early American Unitarian preacher. It is a historical theological statement, not a UUA statement.",
    description:
      "Channing’s ordination sermon became a landmark statement of American Unitarian theology, arguing for a rational and moral reading of Christianity and against Trinitarian doctrine.",
    historicalContext:
      "Delivered in Baltimore in 1819, the sermon helped define the emerging Unitarian movement in the United States. Its arguments belong to their own theological and political moment.",
    availabilityNote:
      "Catalogue record only. Public-domain editions likely exist, but no verified edition is imported in this build.",
  },
  {
    slug: "treatise-on-atonement",
    title: "A Treatise on Atonement",
    tradition: "universalism",
    school: "historical-universalism",
    genre: "Theology",
    textType: "Theological treatise",
    originalLanguage: "en",
    dateStart: 1805,
    dateEnd: 1805,
    dateDisplay: "1805",
    authorshipStatus: "established",
    author: "hosea-ballou",
    attributionNote: "Written by Hosea Ballou, a central early American Universalist theologian.",
    description:
      "Ballou’s treatise argued for universal salvation and reworked traditional accounts of atonement and divine justice. It became a foundational text of American Universalism.",
    historicalContext:
      "Published in 1805 during the formative period of American Universalist institutions. Its arguments were debated within and beyond Universalist circles.",
    availabilityNote:
      "Catalogue record only. A verified public-domain edition has not yet been imported.",
  },
  {
    slug: "ethical-movement",
    title: "The Ethical Movement: Its Principles and Aims",
    tradition: "ethical-culture",
    school: "ethical-culture",
    genre: "Ethical manifesto",
    textType: "Address and movement statement",
    originalLanguage: "en",
    dateStart: 1900,
    dateEnd: 1933,
    dateDisplay: "Early 20th century",
    authorshipStatus: "established",
    author: "felix-adler",
    attributionNote:
      "Associated with Felix Adler, founder of Ethical Culture. The exact bibliographic form and edition require verification before any text is imported.",
    description:
      "A statement of the Ethical Culture movement’s humanist commitments: the worth of persons, ethical relationships, social reform and the pursuit of the good life without supernatural doctrine.",
    historicalContext:
      "Ethical Culture emerged in late nineteenth-century New York and spread through affiliated societies. It is a small movement with varied local expressions and should not be treated as a single global church.",
    availabilityNote:
      "Catalogue record only. Edition and rights are unverified; no text is imported.",
  },
  {
    slug: "charge-of-the-goddess",
    title: "The Charge of the Goddess",
    tradition: "wicca",
    school: "wiccan",
    genre: "Modern liturgy",
    textType: "Ritual text",
    originalLanguage: "en",
    dateStart: 1950,
    dateEnd: 1970,
    dateDisplay: "Mid-20th century, later revisions",
    authorshipStatus: "disputed",
    author: "doreen-valiente",
    attributionNote:
      "A modern Wiccan liturgical text associated with Doreen Valiente and earlier Gardnerian material. Its textual history and attribution are debated. It is not an ancient scripture.",
    description:
      "A poetic charge used in some Wiccan rituals, invoking the Goddess and ethical norms of the craft. Versions differ across lineages and publications.",
    historicalContext:
      "Composed within the mid-twentieth-century Wiccan revival, drawing on older literary and esoteric sources. Modern Wicca is historically situated and internally diverse.",
    availabilityNote:
      "Catalogue record only. Modern text is under copyright and some material is lineage-restricted; no text is reproduced.",
  },
  {
    slug: "book-of-mormon",
    title: "The Book of Mormon",
    altTitles: ["Book of Mormon: Another Testament of Jesus Christ"],
    tradition: "latter-day-saints",
    school: "lds",
    genre: "Scripture",
    textType: "Narrative and prophecy",
    originalLanguage: "en",
    dateStart: 1830,
    dateEnd: 1830,
    dateDisplay: "First published 1830",
    authorshipStatus: "disputed",
    author: "joseph-smith",
    attributionNote:
      "Latter-day Saints regard the Book of Mormon as scripture translated by Joseph Smith from ancient records. Its origins are a matter of religious claim and historical debate. This catalogue does not adjudicate that claim.",
    description:
      "A foundational scripture for Latter-day Saint movements, narrating peoples of the ancient Americas and presenting itself as another testament of Jesus Christ. Editions, headings and study aids differ among Restorationist bodies.",
    historicalContext:
      "First published in 1830 in Palmyra, New York. The text has been reprinted in many editions with changes in chapter divisions, punctuation and some wording; edition provenance matters.",
    availabilityNote:
      "Catalogue record only. Official LDS website terms permit personal noncommercial use but not website posting or automated copying without permission. Project Gutenberg #17 is public domain in the U.S. but is not a verified 1830 first-edition transcription, so it is not imported.",
  },
  {
    slug: "ofudesaki",
    title: "The Ofudesaki",
    originalTitle: "おふでさき",
    transliteration: "Ofudesaki",
    altTitles: ["The Tip of the Writing Brush"],
    tradition: "tenrikyo",
    genre: "Scripture",
    textType: "Revelatory verse",
    originalLanguage: "ja",
    dateStart: 1869,
    dateEnd: 1881,
    dateDisplay: "Composed 1869–1881",
    authorshipStatus: "traditional",
    author: "nakayama-miki",
    attributionNote:
      "Tenrikyo tradition attributes the verses to Nakayama Miki as revelations. The English translation is a separate published edition with its own rights.",
    description:
      "The Ofudesaki is Tenrikyo’s central scriptural text, a collection of 1,711 verses in seventeen parts. It addresses the founding of the teaching and the path to a joyous life.",
    historicalContext:
      "Composed in nineteenth-century Japan during the movement’s formative period. Tenrikyo official publications provide translations and doctrinal exposition; these are not the same as the scripture.",
    availabilityNote:
      "Catalogue record only. Official English translations are copyrighted and no open licence was found. No text is imported.",
  },
  {
    slug: "phap-chanh-truyen",
    title: "Pháp Chánh Truyền",
    originalTitle: "Pháp Chánh Truyền",
    transliteration: "Phap Chanh Truyen",
    altTitles: ["The Religious Constitution of Caodaism"],
    tradition: "caodai",
    school: "tay-ninh",
    genre: "Religious constitution",
    textType: "Institutional and doctrinal text",
    originalLanguage: "vi",
    dateStart: 1926,
    dateEnd: 1934,
    dateDisplay: "1926 onward",
    authorshipStatus: "composite",
    author: null,
    attributionNote:
      "A foundational institutional text of the Tay Ninh Holy See. The English version published online by the Sacerdotal Council is explicitly marked as not an official translation.",
    description:
      "The Pháp Chánh Truyền sets out the religious constitution and hierarchy of the Tay Ninh Cao Dai body. It is one branch’s institutional text, not a document accepted identically by all Cao Dai communities.",
    historicalContext:
      "Cao Dai was founded in 1926 in southern Vietnam and combines Buddhist, Confucian, Daoist, Christian and local elements. The movement has divided into branches with different authorities.",
    availabilityNote:
      "Catalogue record only. The English translation is not official and rights are unclear. No text is imported.",
  },
  {
    slug: "secret-doctrine",
    title: "The Secret Doctrine",
    altTitles: ["The Secret Doctrine: The Synthesis of Science, Religion, and Philosophy"],
    tradition: "theosophy",
    school: "theosophical-society",
    genre: "Esoteric philosophy",
    textType: "Theosophical treatise",
    originalLanguage: "en",
    dateStart: 1888,
    dateEnd: 1888,
    dateDisplay: "1888",
    authorshipStatus: "established",
    author: "blavatsky",
    attributionNote: "Written by Helena Petrovna Blavatsky. It is a modern esoteric work, not an ancient scripture, despite its claims about ancient sources.",
    description:
      "A large synthesis of cosmology, comparative religion and esoteric claims, central to the early Theosophical movement. It has been read and disputed in multiple Theosophical organisations.",
    historicalContext:
      "Published in 1888 in London. Its sources, methods and historical claims are debated by scholars and within Theosophical bodies. Later editions and compilations vary.",
    availabilityNote:
      "Catalogue record only. The original may be public domain in some jurisdictions, but a verified edition has not been imported.",
  },
  {
    slug: "philosophy-of-freedom",
    title: "The Philosophy of Freedom",
    originalTitle: "Die Philosophie der Freiheit",
    transliteration: "Die Philosophie der Freiheit",
    tradition: "anthroposophy",
    school: "anthroposophical-society",
    genre: "Philosophy",
    textType: "Epistemological and ethical treatise",
    originalLanguage: "de",
    dateStart: 1894,
    dateEnd: 1894,
    dateDisplay: "1894",
    authorshipStatus: "established",
    author: "rudolf-steiner",
    attributionNote:
      "Written by Rudolf Steiner before the development of Anthroposophy as a movement. It is a philosophical work, not an Anthroposophical scripture.",
    description:
      "Steiner’s inquiry into knowledge, freedom and ethical individualism. It argues for a form of intuitive thinking as the basis of free action.",
    historicalContext:
      "Published in 1894 while Steiner was working within German philosophical and Goethean traditions. Its relationship to his later spiritual science is itself debated.",
    availabilityNote:
      "Catalogue record only. German original may be public domain; English translations have separate rights. No text is imported.",
  },
  {
    slug: "divine-principle",
    title: "Divine Principle",
    originalTitle: "원리강론",
    transliteration: "Wolli Kangnon",
    tradition: "unificationism",
    school: "unification-church",
    genre: "Doctrinal text",
    textType: "Theological exposition",
    originalLanguage: "ko",
    dateStart: 1966,
    dateEnd: 1966,
    dateDisplay: "1966",
    authorshipStatus: "disputed",
    author: "sun-myung-moon",
    attributionNote:
      "The Divine Principle is the central doctrinal text of the Unification movement, attributed to Sun Myung Moon and developed with early followers. Its editions and official status vary across Unification bodies.",
    description:
      "A systematic exposition of Unification theology, including the principle of creation, the fall, restoration and the role of the True Parents. It is a modern movement text, not a historical canon.",
    historicalContext:
      "First published in Korean in 1966 and subsequently translated and revised. The Unification movement has split into multiple organisations with different authority claims.",
    availabilityNote:
      "Catalogue record only. Modern translations are copyrighted. No text is imported.",
  },
  {
    slug: "truth-of-life",
    title: "Truth of Life",
    originalTitle: "生命の實相",
    transliteration: "Seimei no Jissō",
    tradition: "seicho-no-ie",
    school: "seicho-no-ie",
    genre: "New religious teaching",
    textType: "Doctrinal exposition",
    originalLanguage: "ja",
    dateStart: 1930,
    dateEnd: 1930,
    dateDisplay: "From 1930",
    authorshipStatus: "established",
    author: "masaharu-taniguchi",
    attributionNote: "Written by Masaharu Taniguchi, founder of Seicho-no-Ie. It is a modern movement text.",
    description:
      "A multi-volume exposition of Seicho-no-Ie teaching, emphasising the true image of humanity, gratitude and the immanence of God. It is not a historical scripture.",
    historicalContext:
      "Published from 1930 in Japan and revised over decades. The movement’s teachings and publications developed in a modern Japanese context.",
    availabilityNote:
      "Catalogue record only. Modern publications are copyrighted and no verified translation is imported.",
  },
  {
    slug: "reikai-monogatari",
    title: "Reikai Monogatari",
    originalTitle: "霊界物語",
    transliteration: "Reikai Monogatari",
    altTitles: ["Tales of the Spirit World"],
    tradition: "oomoto",
    school: "oomoto",
    genre: "New religious narrative",
    textType: "Revelatory narrative",
    originalLanguage: "ja",
    dateStart: 1921,
    dateEnd: 1933,
    dateDisplay: "1921–1933",
    authorshipStatus: "traditional",
    author: "onisaburo-deguchi",
    attributionNote:
      "A vast narrative attributed to Onisaburō Deguchi’s spiritual inspiration. It is a modern Oomoto text, not an ancient chronicle.",
    description:
      "An extensive revelatory narrative describing the spirit world, divine plan and moral order. It is central to Oomoto but is not treated as a universal scripture.",
    historicalContext:
      "Produced in interwar Japan during Oomoto’s expansion and persecution. Its status and interpretation vary within the movement.",
    availabilityNote:
      "Catalogue record only. Modern text and translations are rights-managed. No text is imported.",
  },
];

let written = 0;
for (const w of works) {
  const path = join(worksDir, `${w.slug}.json`);
  if (existsSync(path) && w.slug !== "journal-of-george-fox") {
    // Do not overwrite an enriched work by accident; only create missing records.
    continue;
  }
  writeFileSync(path, JSON.stringify(catalogueWork(w), null, 2) + "\n");
  written++;
}

console.log(`Updated corpus metadata: ${traditions.length} traditions, ${authors.length} authors, ${schools.length} schools, ${languages.length} languages.`);
console.log(`Wrote ${written} catalogue-only work records. Imported texts remain limited to the explicitly sourced editions.`);
