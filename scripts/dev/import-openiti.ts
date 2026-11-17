// Imports Arabic works from the OpenITI corpus.
//
// The previous passes could only catalogue the fiqh compendia because their
// English translations were in copyright or bad OCR. This pass reads the
// Arabic directly: OpenITI publishes machine-readable mARkdown transcriptions,
// so each work can be indexed and streamed without an English translation.
//
// What is written here: the catalogue record, the chapter outline and the
// passage index. The text stays on GitHub and is requested when someone reads.
//
//   bun run scripts/dev/import-openiti.ts
//   bun run scripts/dev/import-openiti.ts --only=al-hidaya
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openitiChapters, parseOpeniti, type OpenitiSection } from "../../server/openiti";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");
const META = join(ROOT, "data", "corpus", "meta.json");
const STREAMS = join(ROOT, "data", "registry", "streams.json");
const REGISTRY = join(ROOT, "data", "registry", "sources.json");
const FUNCTIONS = join(ROOT, "data", "corpus", "text-functions.json");
const MANIFEST = join(ROOT, "data", "imports", "openiti.json");
const RETRIEVED_AT = new Date().toISOString().slice(0, 10);
const USER_AGENT = "UniversalWisdomLibrary/1.0 (local reading interface; import and streaming)";

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.split("=")[1] ?? "";

type ChapterRule = { mode: "level"; level: number } | { mode: "pattern"; pattern: string };

type Spec = {
  slug: string;
  title: string;
  originalTitle: string;
  transliteration: string;
  altTitles: string[];
  author: string;
  school: string;
  genre: string;
  textType: string;
  category: string;
  subcategory: string;
  dateStart: number;
  dateEnd: number;
  dateDisplay: string;
  description: string;
  historicalContext: string;
  editionTitle: string;
  textUrl: string;
  chapter: ChapterRule;
  functions: string[];
  /** Short treatises can be under the default 5,000-word floor. */
  minWords?: number;
};

const RAW = "https://raw.githubusercontent.com/OpenITI";

const SPECS: Spec[] = [
  {
    slug: "kitab-al-kharaj",
    title: "Kitab al-Kharaj",
    originalTitle: "كتاب الخراج",
    transliteration: "Kitāb al-Kharāj",
    altTitles: ["The Book of Taxation"],
    author: "abu-yusuf",
    school: "hanafi",
    genre: "Jurisprudence",
    textType: "Legal treatise",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Public finance and governance",
    dateStart: 780,
    dateEnd: 798,
    dateDisplay: "composed c. 780–798 CE",
    description:
      "Abu Yusuf's treatise on the revenue and lands of the caliphate, written at Harun al-Rashid's request. It treats conquered land, the kharaj and tithe, tribute, spoils, the status of non-Muslim communities, and the duties of judges and officials, arguing each point from the Qur'an, hadith and the practice of the early community.",
    historicalContext:
      "Abu Yusuf was chief judge of Baghdad under Harun al-Rashid, and the book is a working manual for the administration of an empire as much as a work of legal theory. It preserves early Hanafi reasoning and is one of the oldest surviving Islamic prose works on government.",
    editionTitle: "Arabic text (OpenITI transcription of the ShamAY edition)",
    textUrl: `${RAW}/0200AH/master/data/0182AbuYusufYacqub/0182AbuYusufYacqub.Kharaj/0182AbuYusufYacqub.Kharaj.ShamAY0034334-ara1`,
    chapter: { mode: "level", level: 2 },
    functions: ["religious_law_practice", "historical_document"],
  },
  {
    slug: "al-mudawwana",
    title: "Al-Mudawwana al-Kubra",
    originalTitle: "المدونة الكبرى",
    transliteration: "al-Mudawwana al-Kubrā",
    altTitles: [],
    author: "sahnun",
    school: "maliki",
    genre: "Jurisprudence",
    textType: "Legal compendium",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Classical manuals",
    dateStart: 830,
    dateEnd: 854,
    dateDisplay: "compiled c. 830–854 CE",
    description:
      "Sahnun's record of the answers of Malik ibn Anas and his Medinan students, chiefly through Ibn al-Qasim, arranged by legal topic. It runs from purification and prayer through marriage, trade, inheritance and penalties, and preserves the reasoning of the early Maliki school in the words of its transmitters.",
    historicalContext:
      "Sahnun compiled the work in Qayrawan from the teaching he had brought back from Medina. With the Muwatta it became the foundation of Maliki positive law in North Africa and al-Andalus, and later Maliki authors commented on it for centuries.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0250AH/master/data/0240SahnunIbnSacid/0240SahnunIbnSacid.MudawwanaKubra/0240SahnunIbnSacid.MudawwanaKubra.Shamela0000587-ara1`,
    chapter: { mode: "pattern", pattern: "^\\[?كتاب" },
    functions: ["religious_law_practice", "historical_document"],
  },
  {
    slug: "al-hidaya",
    title: "Al-Hidaya",
    originalTitle: "الهداية",
    transliteration: "al-Hidāya",
    altTitles: ["al-Hidaya fi Sharh al-Bidaya"],
    author: "al-marghinani",
    school: "hanafi",
    genre: "Jurisprudence",
    textType: "Legal treatise",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Classical manuals",
    dateStart: 1170,
    dateEnd: 1197,
    dateDisplay: "late 12th century CE",
    description:
      "Al-Marghinani's concise Hanafi manual with its own commentary, covering worship, transactions, family law, inheritance, procedure and penalties. Its brevity and precision made it the standard statement of Hanafi law in South and Central Asia and the basis of Charles Hamilton's colonial-era Hedaya.",
    historicalContext:
      "Written in Marghinan in present-day Uzbekistan at the end of the twelfth century, the work distilled the Hanafi tradition into a text a student could memorise and a judge could consult. Its commentary explains the reasoning behind each ruling and records the disagreements of Abu Hanifa's students.",
    editionTitle: "Arabic text (OpenITI transcription of the JK edition)",
    textUrl: `${RAW}/0600AH/master/data/0593BurhanDinFarghaniMarghinani/0593BurhanDinFarghaniMarghinani.HidayaFiSharhBidaya/0593BurhanDinFarghaniMarghinani.HidayaFiSharhBidaya.JK000242-ara1`,
    chapter: { mode: "pattern", pattern: "^(\\d+\\s+)?كتاب" },
    functions: ["religious_law_practice", "historical_document"],
  },
  {
    slug: "al-mabsut",
    title: "Al-Mabsut",
    originalTitle: "المبسوط",
    transliteration: "al-Mabsūṭ",
    altTitles: [],
    author: "as-sarakhsi",
    school: "hanafi",
    genre: "Jurisprudence",
    textType: "Legal treatise",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Classical manuals",
    dateStart: 1070,
    dateEnd: 1090,
    dateDisplay: "late 11th century CE",
    description:
      "Al-Sarakhsi's expansive commentary on the Hanafi law of worship, transactions, family, inheritance and procedure. Each question is stated, traced to its authorities, argued through the disagreements of the school, and followed by the reasoning that settles it, making the work a record of Hanafi legal argument at its most detailed.",
    historicalContext:
      "Al-Sarakhsi dictated much of the Mabsut while imprisoned in Uzkand, from materials his students brought him. The work became a central reference for later Hanafi jurists and preserves earlier Hanafi texts and opinions that would otherwise be lost.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0500AH/master/data/0483IbnAhmadSarakhsi/0483IbnAhmadSarakhsi.Mabsut/0483IbnAhmadSarakhsi.Mabsut.Shamela0005423-ara1`,
    chapter: { mode: "pattern", pattern: "^(خطبة|كتاب|خاتمة)" },
    functions: ["religious_law_practice", "historical_document"],
  },
  {
    slug: "bidayat-al-mujtahid",
    title: "Bidayat al-Mujtahid wa Nihayat al-Muqtasid",
    originalTitle: "بداية المجتهد ونهاية المقتصد",
    transliteration: "Bidāyat al-Mujtahid wa Nihāyat al-Muqtaṣid",
    altTitles: ["The Distinguished Jurist's Primer"],
    author: "ibn-rushd",
    school: "maliki",
    genre: "Jurisprudence",
    textType: "Comparative legal treatise",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Comparative law",
    dateStart: 1160,
    dateEnd: 1198,
    dateDisplay: "late 12th century CE",
    description:
      "Ibn Rushd's comparative account of the law, setting out each question with the positions of the Maliki, Hanafi, Shafi'i and Hanbali schools and the reasons they differ. He states the points of agreement first, then the disagreements and the evidence behind each, making the book a guide to the substance of fiqh rather than to one school's manual.",
    historicalContext:
      "Written in al-Andalus and the Maghrib by a philosopher and jurist who served as a Maliki judge in Cordoba and Seville. Its comparative method reflects the plural legal world of the medieval Islamic west and made it a standard text for later comparative study.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0600AH/master/data/0595IbnRushdHafid/0595IbnRushdHafid.BidayatMujtahid/0595IbnRushdHafid.BidayatMujtahid.Shamela0021739-ara1`,
    chapter: { mode: "pattern", pattern: "^\\[?كتاب" },
    functions: ["religious_law_practice", "historical_document"],
  },
  {
    slug: "al-muwafaqat",
    title: "Al-Muwafaqat fi Usul al-Shari'a",
    originalTitle: "الموافقات في أصول الشريعة",
    transliteration: "al-Muwāfaqāt fī Uṣūl al-Sharīʿa",
    altTitles: ["The Reconciliation of the Fundamentals of Law"],
    author: "ash-shatibi",
    school: "maliki",
    genre: "Jurisprudence",
    textType: "Legal methodology",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Legal theory (Usul)",
    dateStart: 1350,
    dateEnd: 1388,
    dateDisplay: "14th century CE",
    description:
      "Al-Shatibi's argument that the rulings of the law are ordered toward the preservation of religion, life, intellect, lineage and property, and that the details of the law must be read in the light of those aims. The first part sets out the sources and the second the purposes of the Lawgiver, with the linguistic and legal reasoning that supports each claim.",
    historicalContext:
      "Written in Granada in the fourteenth century, when the Maliki school of al-Andalus was under pressure and reformist argument was sharp. The Muwafaqat was slow to circulate but became foundational for later theories of the objectives of the law (maqasid) and is now read across the schools.",
    editionTitle: "Arabic text (OpenITI transcription of the JK edition)",
    textUrl: `${RAW}/0800AH/master/data/0790IbnMusaGharnatiShatibi/0790IbnMusaGharnatiShatibi.Muwafaqat/0790IbnMusaGharnatiShatibi.Muwafaqat.JK000279-ara1`,
    chapter: { mode: "level", level: 1 },
    functions: ["religious_law_practice", "historical_document"],
  },
  {
    slug: "al-risala-al-qayrawaniyya",
    title: "Al-Risala",
    originalTitle: "الرسالة",
    transliteration: "al-Risāla",
    altTitles: ["Risalat Ibn Abi Zayd al-Qayrawani"],
    author: "ibn-abi-zayd-al-qayrawani",
    school: "maliki",
    genre: "Jurisprudence",
    textType: "Creed and legal primer",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Introductory manuals",
    dateStart: 938,
    dateEnd: 996,
    dateDisplay: "10th century CE",
    description:
      "Ibn Abi Zayd's short primer on what a Muslim must believe and practise, beginning with the creed and then setting out purification, prayer, alms, fasting, pilgrimage, marriage, trade and the ordinary duties of daily life. Its brevity made it the first Maliki text taught to children across North and West Africa.",
    historicalContext:
      "Written in Qayrawan in the tenth century, the Risala condensed the Maliki teaching of the region into a text that could be memorised. It circulated with commentaries and glosses and remains part of the standard curriculum in Maliki schools.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0400AH/master/data/0386IbnAbiZaydQayrawani/0386IbnAbiZaydQayrawani.Risala/0386IbnAbiZaydQayrawani.Risala.Shamela0011373-ara1`,
    chapter: { mode: "level", level: 1 },
    functions: ["religious_law_practice", "denominational_guidance"],
  },
  {
    slug: "al-ahkam-al-sultaniyya",
    title: "Al-Ahkam al-Sultaniyya",
    originalTitle: "الأحكام السلطانية",
    transliteration: "al-Aḥkām al-Sulṭāniyya",
    altTitles: ["The Ordinances of Government"],
    author: "al-mawardi",
    school: "shafii",
    genre: "Jurisprudence",
    textType: "Political and administrative treatise",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Public law and governance",
    dateStart: 1045,
    dateEnd: 1058,
    dateDisplay: "mid-11th century CE",
    description:
      "Al-Mawardi's account of the institutions of the caliphate and the offices that govern under it: the imamate, the vizierate, provincial governors, judges, the market inspector, the treasury and the conduct of war. Each office is defined by its duties, qualifications and limits, in the language of law rather than of political advice.",
    historicalContext:
      "Written in Baghdad under the Abbasid caliphs, when the Buyid amirs held real power and the caliph's authority was largely formal. The book is both a legal description of government and an argument for restoring the caliphate's place within a divided polity.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0450AH/master/data/0450AbuHasanMawardi/0450AbuHasanMawardi.AhkamSultaniyya/0450AbuHasanMawardi.AhkamSultaniyya.Shamela0022881-ara1.mARkdown`,
    chapter: { mode: "level", level: 1 },
    functions: ["religious_law_practice", "historical_document"],
  },
  {
    slug: "al-kafi-al-kulayni",
    title: "Al-Kafi",
    originalTitle: "الكافي",
    transliteration: "al-Kāfī",
    altTitles: ["al-Kafi fi Usul al-Din wa al-Ahkam"],
    author: "al-kulayni",
    school: "shia-twelver",
    genre: "Hadith",
    textType: "Hadith collection",
    category: "Hadith",
    subcategory: "Shia collections",
    dateStart: 900,
    dateEnd: 941,
    dateDisplay: "c. 900–941 CE",
    description:
      "Al-Kulayni's collection of reports from the Prophet and the Imams, arranged in books that begin with reason and knowledge, then the unity of God, prophecy and the imamate, and continue through purification, prayer, alms, fasting, pilgrimage, marriage and the rest of the law. It is the largest of the Twelver Shia hadith collections and the earliest of the four canonical ones.",
    historicalContext:
      "Compiled in Baghdad during the Minor Occultation, when the Twelver community was consolidating its legal and doctrinal tradition. Al-Kulayni's selection and arrangement gave later Shia jurists their core corpus, and the work is still read with the commentaries of Majlisi and others.",
    editionTitle: "Arabic text (OpenITI transcription of the Shia edition)",
    textUrl: `${RAW}/0350AH/master/data/0329IbnYacqubKulayni/0329IbnYacqubKulayni.Kafi/0329IbnYacqubKulayni.Kafi.Shia001122Vols-ara1.mARkdown`,
    chapter: { mode: "pattern", pattern: "^\\[?\\(?كتاب" },
    functions: ["canonical_scripture", "religious_law_practice"],
  },
  {
    slug: "kitab-al-tawhid-al-maturidi",
    title: "Kitab al-Tawhid",
    originalTitle: "كتاب التوحيد",
    transliteration: "Kitāb al-Tawḥīd",
    altTitles: [],
    author: "al-maturidi",
    school: "maturidi",
    genre: "Theology (Kalam)",
    textType: "Theological treatise",
    category: "Theology (Kalam)",
    subcategory: "Sunni kalam",
    dateStart: 900,
    dateEnd: 944,
    dateDisplay: "early 10th century CE",
    description:
      "Al-Maturidi's systematic defence of the unity of God and the createdness of the world, arguing from reason and revelation against the dualists, the philosophers, the Mu'tazila and the anthropomorphists. It treats God's attributes, the status of the believer, the nature of faith, free will and the sources of religious knowledge.",
    historicalContext:
      "Written in Samarkand in the early tenth century, the work founded the Maturidi school of Sunni theology, which with Ash'arism became one of the two dominant schools of kalam. Its rational method and its insistence on the compatibility of reason with revelation shaped later Hanafi theology.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0350AH/master/data/0333AbuMansurMaturidi/0333AbuMansurMaturidi.Tawhid/0333AbuMansurMaturidi.Tawhid.Shamela0006365-ara1`,
    chapter: { mode: "level", level: 1 },
    functions: ["denominational_guidance", "historical_document"],
  },
  {
    slug: "muqaddimat-ibn-al-salah",
    title: "Muqaddimat Ibn al-Salah",
    originalTitle: "مقدمة ابن الصلاح",
    transliteration: "Muqaddimat Ibn al-Ṣalāḥ",
    altTitles: ["Ulum al-Hadith"],
    author: "ibn-al-salah",
    school: "shafii",
    genre: "Hadith",
    textType: "Hadith methodology",
    category: "Hadith",
    subcategory: "Hadith sciences",
    dateStart: 1230,
    dateEnd: 1245,
    dateDisplay: "13th century CE",
    description:
      "Ibn al-Salah's survey of the sciences of hadith in sixty-five chapters, from the sound and the weak report through the conditions of transmission, the criticism of narrators, the writing and reading of hadith, and the terminology of the discipline. It became the standard introduction to hadith methodology and the base of al-Nawawi's Irshad and later abridgements.",
    historicalContext:
      "Written in Damascus in the last years of Ibn al-Salah's life, when he taught at the Ashrafiyya school. The work fixed the vocabulary of hadith criticism for later Sunni scholarship, and its categories are still taught in traditional hadith curricula.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0650AH/master/data/0643IbnSalahShahrazuri/0643IbnSalahShahrazuri.MuqaddimatCulumHadith/0643IbnSalahShahrazuri.MuqaddimatCulumHadith.Shamela0022870-ara1`,
    chapter: { mode: "level", level: 1 },
    functions: ["historical_document", "academic_scholarship"],
  },
  {
    slug: "riyad-al-salihin",
    title: "Riyad al-Salihin",
    originalTitle: "رياض الصالحين",
    transliteration: "Riyāḍ al-Ṣāliḥīn",
    altTitles: ["The Gardens of the Righteous"],
    author: "al-nawawi",
    school: "shafii",
    genre: "Hadith",
    textType: "Hadith collection",
    category: "Hadith",
    subcategory: "Devotional and ethical collections",
    dateStart: 1250,
    dateEnd: 1270,
    dateDisplay: "13th century CE",
    description:
      "Al-Nawawi's selection of reports on intention, repentance, patience, truthfulness, trust in God, the duties of the tongue, the family, neighbours, travel and the remembrance of God. The chapters are short and practical, and the collection became one of the most widely read hadith books in everyday devotional life.",
    historicalContext:
      "Compiled in Damascus in the thirteenth century for readers who wanted the Prophet's guidance on conduct rather than the full legal corpus. Its combination of short chapters, Qur'anic verses and well-known reports made it a standard text in mosques and homes across the Sunni world.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0700AH/master/data/0676Nawawi/0676Nawawi.RiyadSalihin/0676Nawawi.RiyadSalihin.Shamela0012014-ara1.mARkdown`,
    chapter: { mode: "level", level: 2 },
    functions: ["canonical_scripture", "religious_law_practice"],
  },
  {
    slug: "fusus-al-hikam",
    title: "Fusus al-Hikam",
    originalTitle: "فصوص الحكم",
    transliteration: "Fuṣūṣ al-Ḥikam",
    altTitles: ["The Bezels of Wisdom"],
    author: "ibn-arabi",
    school: "sufi-tradition",
    genre: "Sufism",
    textType: "Mystical treatise",
    category: "Sufism",
    subcategory: "Metaphysics",
    dateStart: 1229,
    dateEnd: 1230,
    dateDisplay: "c. 1229–1230 CE",
    description:
      "Twenty-seven chapters, each built around a prophet or a figure of the Qur'an, in which Ibn Arabi reads the stories as aspects of the relation between the one reality and the many forms in which it appears. The book is dense with scriptural allusion and became the focus of centuries of commentary and dispute.",
    historicalContext:
      "Written late in Ibn Arabi's life, after his move to Damascus. Its teaching on the unity of being was defended and attacked by later scholars, and the work was commented on by authors from al-Qashani to al-Jandi. The attribution to Ibn Arabi is the one the manuscript tradition gives.",
    editionTitle: "Arabic text (OpenITI transcription of the Kraken edition)",
    textUrl: `${RAW}/0650AH/master/data/0638IbnCarabi/0638IbnCarabi.FususHikam/0638IbnCarabi.FususHikam.Kraken21042913-ara1.mARkdown`,
    chapter: { mode: "pattern", pattern: "^\\d+\\s+-\\s+فص" },
    functions: ["mystical_contemplative", "philosophical_work"],
  },
  {
    slug: "al-itisam",
    title: "Al-I'tisam",
    originalTitle: "الاعتصام",
    transliteration: "al-Iʿtiṣām",
    altTitles: [],
    author: "ash-shatibi",
    school: "maliki",
    genre: "Sufism",
    textType: "Religious treatise",
    category: "Sufism",
    subcategory: "Ethics and reform",
    dateStart: 1360,
    dateEnd: 1388,
    dateDisplay: "14th century CE",
    description:
      "Al-Shatibi's study of innovation and adherence to the prophetic path: what counts as a religious innovation, how it differs from legitimate practice, and why the distinction matters for law and worship. It gathers scriptural evidence and the positions of earlier scholars, and closes with a defence of the middle way against both excess and neglect.",
    historicalContext:
      "Written in Granada in the fourteenth century, when Sufi practice and legal reform were contested in al-Andalus. The I'tisam applies the author's theory of the purposes of the law to the question of religious practice and became a standard reference in later debates over bid'a.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0800AH/master/data/0790IbnMusaGharnatiShatibi/0790IbnMusaGharnatiShatibi.Ictisam/0790IbnMusaGharnatiShatibi.Ictisam.Shamela0021720-ara1`,
    chapter: { mode: "level", level: 1 },
    functions: ["religious_law_practice", "mystical_contemplative"],
  },
  {
    slug: "mukhtasar-minhaj-al-qasidin",
    title: "Mukhtasar Minhaj al-Qasidin",
    originalTitle: "مختصر منهاج القاصدين",
    transliteration: "Mukhtaṣar Minhāj al-Qāṣidīn",
    altTitles: [],
    author: "shams-al-din-ibn-qudama",
    school: "hanbali",
    genre: "Sufism",
    textType: "Ethical compendium",
    category: "Sufism",
    subcategory: "Ethics and the inner life",
    dateStart: 1270,
    dateEnd: 1290,
    dateDisplay: "late 13th century CE",
    description:
      "Shams al-Din Ibn Qudama's abridgement of Ibn al-Jawzi's Minhaj al-Qasidin, itself a reworking of al-Ghazali's Ihya. It covers knowledge, purification, prayer, alms, fasting, pilgrimage, the Qur'an, remembrance, marriage, trade, the duties of the heart and the remembrance of death, in a compact Hanbali recension.",
    historicalContext:
      "Written in Damascus in the late thirteenth century by a member of the Ibn Qudama family of Hanbali scholars. The abridgement made the ethical programme of the Ihya available in a shorter and more strictly traditional form, and it circulated widely among Hanbali readers.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0700AH/master/data/0689AhmadIbnCabdRahmanIbnQudama/0689AhmadIbnCabdRahmanIbnQudama.MukhtasarMinhajQasidin/0689AhmadIbnCabdRahmanIbnQudama.MukhtasarMinhajQasidin.Shamela0098087-ara1`,
    chapter: { mode: "pattern", pattern: "^\\[?كتاب" },
    functions: ["mystical_contemplative", "religious_law_practice"],
  },
  {
    slug: "al-kashshaf",
    title: "Al-Kashshaf",
    originalTitle: "الكشاف عن حقائق غوامض التنزيل",
    transliteration: "al-Kashshāf ʿan Ḥaqāʾiq Ghawāmiḍ al-Tanzīl",
    altTitles: ["The Unveiler of the Realities of Revelation"],
    author: "al-zamakhshari",
    school: "mutazili",
    genre: "Qur'an commentary",
    textType: "Tafsir",
    category: "Qur'anic studies",
    subcategory: "Tafsir",
    dateStart: 1118,
    dateEnd: 1144,
    dateDisplay: "12th century CE",
    description:
      "Al-Zamakhshari's commentary on the Qur'an, organised surah by surah and verse by verse, with close attention to grammar, rhetoric and the readings. Its analysis of metaphor and syntax made it a model for later exegetes, while its Mu'tazili theology provoked responses from Sunni authors who quoted its philology while rejecting its doctrine.",
    historicalContext:
      "Written in Khwarazm in the twelfth century by a philologist and theologian trained in the Mu'tazili tradition. The work's literary method set the standard for rhetorical tafsir, and its theological positions were answered by al-Razi, al-Baydawi and others.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0550AH/master/data/0538JarAllahZamakhshari/0538JarAllahZamakhshari.Kashshaf/0538JarAllahZamakhshari.Kashshaf.Shamela0023627-ara1`,
    chapter: { mode: "pattern", pattern: "^\\[?سورة\\s[^(]*$" },
    functions: ["commentary_exegesis", "canonical_scripture"],
  },
  {
    slug: "al-mughni",
    title: "Al-Mughni",
    originalTitle: "المغني",
    transliteration: "al-Mughnī",
    altTitles: [],
    author: "ibn-qudama",
    school: "hanbali",
    genre: "Jurisprudence",
    textType: "Legal encyclopaedia",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Comparative law",
    dateStart: 1170,
    dateEnd: 1223,
    dateDisplay: "late 12th–early 13th century CE",
    description:
      "Ibn Qudama's encyclopaedic treatment of Hanbali law, arranged by book from purification and prayer through transactions, marriage, inheritance and penalties. It records the positions of the other schools before arguing the Hanbali one, and is the largest of the classical comparative fiqh works.",
    historicalContext:
      "Written in Damascus by the Hanbali jurist Ibn Qudama, whose family had migrated from Palestine. The work became a foundation of the Hanbali school and a standard reference for comparative legal reasoning.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0625AH/master/data/0620IbnQudamaMaqdisi/0620IbnQudamaMaqdisi.Mughni/0620IbnQudamaMaqdisi.Mughni.Shamela0008463-ara1`,
    chapter: { mode: "pattern", pattern: "^\\[?كتاب" },
    functions: ["religious_law_practice", "historical_document"],
  },
  {
    slug: "al-shafii-risala",
    title: "Al-Risala fi Usul al-Fiqh",
    originalTitle: "الرسالة في أصول الفقه",
    transliteration: "al-Risāla fī Uṣūl al-Fiqh",
    altTitles: [],
    author: "al-shafii",
    school: "shafii",
    genre: "Jurisprudence",
    textType: "Legal theory",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Legal theory (Usul)",
    dateStart: 813,
    dateEnd: 820,
    dateDisplay: "c. 813–820 CE",
    description:
      "Al-Shafi'i's treatise on the sources of law: the Qur'an, the reported practice of the Prophet, consensus and analogy, and the rules for reading them together. It is the founding statement of Islamic legal methodology.",
    historicalContext:
      "Written in Egypt at the end of al-Shafi'i's life. The work fixed the vocabulary of usul al-fiqh and was commented on continuously by later jurists across the schools.",
    editionTitle: "Arabic text (OpenITI transcription of the JK edition)",
    textUrl: `${RAW}/0225AH/master/data/0204Shafici/0204Shafici.Risala/0204Shafici.Risala.JK000143-ara1`,
    chapter: { mode: "level", level: 1 },
    functions: ["religious_law_practice", "historical_document"],
  },
  {
    slug: "al-shafii-al-umm",
    title: "Kitab al-Umm",
    originalTitle: "كتاب الأم",
    transliteration: "Kitāb al-Umm",
    altTitles: [],
    author: "al-shafii",
    school: "shafii",
    genre: "Jurisprudence",
    textType: "Legal compendium",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Classical manuals",
    dateStart: 810,
    dateEnd: 820,
    dateDisplay: "early 9th century CE",
    description:
      "Al-Shafi'i's compendium of substantive law, arranged by topic, with the disagreements of earlier jurists recorded as he answers them. It is the earliest surviving systematic fiqh text of its size.",
    historicalContext:
      "The recension preserved by al-Shafi'i's student al-Rabi' ibn Sulayman. It records the legal reasoning of the formative Shafi'i school and became a primary reference for later Shafi'i authorities.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0225AH/master/data/0204Shafici/0204Shafici.Umm/0204Shafici.Umm.Shamela0001655-ara1`,
    chapter: { mode: "pattern", pattern: "^\\[?كتاب" },
    functions: ["religious_law_practice", "historical_document"],
  },
  {
    slug: "musnad-ahmad",
    title: "Musnad Ahmad ibn Hanbal",
    originalTitle: "مسند الإمام أحمد بن حنبل",
    transliteration: "Musnad al-Imām Aḥmad ibn Ḥanbal",
    altTitles: [],
    author: "ibn-hanbal",
    school: "hanbali",
    genre: "Hadith",
    textType: "Hadith collection",
    category: "Hadith",
    subcategory: "Musnad and regional collections",
    dateStart: 820,
    dateEnd: 855,
    dateDisplay: "9th century CE",
    description:
      "Ahmad ibn Hanbal's large collection of prophetic reports, arranged by the Companion who transmitted them rather than by legal topic. It preserves many reports not found in the six canonical collections and is a major source for early hadith criticism.",
    historicalContext:
      "Compiled in Baghdad over decades and transmitted by Ahmad's son Abd Allah and later students. Its arrangement by isnad made it a working archive for the study of transmitters.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0250AH/master/data/0241IbnHanbal/0241IbnHanbal.Musnad/0241IbnHanbal.Musnad.Shamela0013157-ara1`,
    chapter: { mode: "pattern", pattern: "^مسند" },
    functions: ["canonical_scripture", "historical_document"],
  },
  {
    slug: "mafatih-al-ghayb",
    title: "Mafatih al-Ghayb",
    originalTitle: "مفاتيح الغيب = التفسير الكبير",
    transliteration: "Mafātīḥ al-Ghayb (al-Tafsīr al-Kabīr)",
    altTitles: ["The Keys to the Unseen"],
    author: "fakhr-al-din-al-razi",
    school: "kalam",
    genre: "Qur'an commentary",
    textType: "Tafsir",
    category: "Qur'anic studies",
    subcategory: "Tafsir",
    dateStart: 1180,
    dateEnd: 1209,
    dateDisplay: "late 12th–early 13th century CE",
    description:
      "Fakhr al-Din al-Razi's extensive commentary on the Qur'an, moving through the text with grammar, rhetoric, theology, philosophy and the natural sciences. It is one of the fullest medieval tafsirs and a central witness to the encounter between kalam and Avicennian philosophy.",
    historicalContext:
      "Composed in the late twelfth and early thirteenth centuries, partly in Herat and partly in Rayy. Its rational theology and philosophical vocabulary made it a standard reference and a target for later critics.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0625AH/master/data/0606FakhrDinRazi/0606FakhrDinRazi.MafatihGhayb/0606FakhrDinRazi.MafatihGhayb.Shamela0023635-ara1`,
    chapter: { mode: "pattern", pattern: "^الجزء" },
    functions: ["commentary_exegesis", "canonical_scripture"],
  },
  {
    slug: "mishkat-al-masabih",
    title: "Mishkat al-Masabih",
    originalTitle: "مشكاة المصابيح",
    transliteration: "Mishkāt al-Maṣābīḥ",
    altTitles: ["The Niche of Lamps"],
    author: "al-khatib-al-tabrizi",
    school: "shafii",
    genre: "Hadith",
    textType: "Hadith anthology",
    category: "Hadith",
    subcategory: "Devotional and ethical collections",
    dateStart: 1300,
    dateEnd: 1340,
    dateDisplay: "early 14th century CE",
    description:
      "Al-Khatib al-Tabrizi's expansion of al-Baghawi's Masabih al-Sunna, arranging reports by topic for devotional and ethical reading. Each section separates sound reports from weaker ones and supplies the isnad and a short appraisal.",
    historicalContext:
      "Compiled in Tabriz in the early fourteenth century and widely used in the Persianate and Ottoman lands. It became one of the most copied hadith anthologies for ordinary religious reading.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0750AH/master/data/0741KhatibTabrizi/0741KhatibTabrizi.MishkatMasabih/0741KhatibTabrizi.MishkatMasabih.Shamela0008360-ara1`,
    chapter: { mode: "pattern", pattern: "^\\[?كتاب" },
    functions: ["canonical_scripture", "ethical_humanist_manifesto"],
  },
  {
    slug: "bulugh-al-maram",
    title: "Bulugh al-Maram",
    originalTitle: "بلوغ المرام من أدلة الأحكام",
    transliteration: "Bulūgh al-Marām min Adillat al-Aḥkām",
    altTitles: ["Attainment of the Objective"],
    author: "ibn-hajar",
    school: "shafii",
    genre: "Hadith",
    textType: "Legal hadith collection",
    category: "Hadith",
    subcategory: "Legal hadith",
    dateStart: 1420,
    dateEnd: 1449,
    dateDisplay: "15th century CE",
    description:
      "Ibn Hajar al-Asqalani's collection of the reports used as legal proofs, arranged by chapter of fiqh from purification to inheritance. It names the source collection for each report and grades its authenticity.",
    historicalContext:
      "Written in Mamluk Cairo as a handbook for jurists and students. Its combination of legal arrangement and hadith criticism made it a standard text in Shafi'i and broader Sunni curricula.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0875AH/master/data/0852IbnHajarCasqalani/0852IbnHajarCasqalani.BulughMaram/0852IbnHajarCasqalani.BulughMaram.Shamela0009111-ara1`,
    chapter: { mode: "pattern", pattern: "^\\[?كتاب" },
    functions: ["religious_law_practice", "canonical_scripture"],
  },
  {
    slug: "nukhbat-al-fikr",
    title: "Nukhbat al-Fikr",
    originalTitle: "نخبة الفكر في مصطلح أهل الأثر",
    transliteration: "Nukhbat al-Fikr fī Muṣṭalaḥ Ahl al-Athar",
    altTitles: ["The Choicest Thought"],
    author: "ibn-hajar",
    school: "shafii",
    genre: "Hadith sciences",
    textType: "Treatise",
    category: "Hadith",
    subcategory: "Hadith sciences",
    dateStart: 1420,
    dateEnd: 1449,
    dateDisplay: "15th century CE",
    description:
      "A short systematic treatise on hadith terminology: the classes of reports, the conditions of authenticity, the grades of weakness, the types of transmission and the vocabulary of criticism. It is written as a compressed syllabus and was expanded by the author himself in Nuzhat al-Nazar.",
    historicalContext:
      "Composed in Mamluk Cairo and used for centuries as the introductory text to the science of hadith. Its definitions became a shared reference across the Sunni schools.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0875AH/master/data/0852IbnHajarCasqalani/0852IbnHajarCasqalani.NukhbatFikar/0852IbnHajarCasqalani.NukhbatFikar.Shamela0005940-ara1`,
    chapter: { mode: "level", level: 1 },
    functions: ["academic_scholarship", "canonical_scripture"],
    minWords: 1500,
  },
  {
    slug: "asbab-al-nuzul",
    title: "Asbab al-Nuzul",
    originalTitle: "أسباب النزول",
    transliteration: "Asbāb al-Nuzūl",
    altTitles: ["Occasions of Revelation"],
    author: "al-wahidi",
    school: "shafii",
    genre: "Qur'an commentary",
    textType: "Tafsir",
    category: "Qur'anic studies",
    subcategory: "Occasions of revelation",
    dateStart: 1030,
    dateEnd: 1075,
    dateDisplay: "11th century CE",
    description:
      "Al-Wahidi's collection of reports on the occasions that prompted particular Qur'anic verses, arranged surah by surah. It is one of the earliest surviving works devoted to the genre and a standard source for narrative context.",
    historicalContext:
      "Compiled in Nishapur in the eleventh century from earlier exegetical and historical reports. Later authors, including al-Suyuti, depended on it for the occasions of revelation.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0475AH/master/data/0468IbnAhmadWahidiNaysaburi/0468IbnAhmadWahidiNaysaburi.AsbabNuzul/0468IbnAhmadWahidiNaysaburi.AsbabNuzul.Shamela0011314-ara1`,
    chapter: { mode: "pattern", pattern: "^\\[?سورة" },
    functions: ["commentary_exegesis", "canonical_scripture"],
  },
  {
    slug: "al-itqan",
    title: "Al-Itqan fi Ulum al-Qur'an",
    originalTitle: "الإتقان في علوم القرآن",
    transliteration: "al-Itqān fī ʿUlūm al-Qurʾān",
    altTitles: ["Precision in the Qur'anic Sciences"],
    author: "al-suyuti",
    school: "shafii",
    genre: "Qur'anic studies",
    textType: "Qur'anic sciences",
    category: "Qur'anic studies",
    subcategory: "Qur'anic sciences",
    dateStart: 1470,
    dateEnd: 1505,
    dateDisplay: "late 15th century CE",
    description:
      "Al-Suyuti's encyclopaedia of the Qur'anic sciences in eighty chapters, covering revelation, collection, readings, abrogation, rhetoric, interpretation and the history of the text. It synthesises earlier scholarship and remains a standard survey.",
    historicalContext:
      "Written in Mamluk Cairo at the end of the fifteenth century. Al-Suyuti drew on the libraries and scholars of Cairo to produce a comprehensive classification of the field.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0925AH/master/data/0911Suyuti/0911Suyuti.Itqan/0911Suyuti.Itqan.Shamela0011728-ara1`,
    chapter: { mode: "pattern", pattern: "^النوع" },
    functions: ["academic_scholarship", "canonical_scripture"],
  },
];

const AUTHORS = [
  {
    slug: "abu-yusuf",
    name: "Abu Yusuf Ya'qub ibn Ibrahim",
    sort_name: "Abu Yusuf",
    birth_year: 731,
    death_year: 798,
    date_display: "731–798",
    description:
      "Hanafi jurist and chief judge of Baghdad under Harun al-Rashid, whose Kitab al-Kharaj is a founding work of Islamic public law.",
    is_attributed: false,
  },
  {
    slug: "ash-shatibi",
    name: "Abu Ishaq al-Shatibi",
    sort_name: "Shatibi, Abu Ishaq al-",
    birth_year: 1320,
    death_year: 1388,
    date_display: "1320–1388",
    description:
      "Granadan Maliki jurist and theorist of the purposes of the law, author of the Muwafaqat and the I'tisam.",
    is_attributed: false,
  },
  {
    slug: "ibn-abi-zayd-al-qayrawani",
    name: "Ibn Abi Zayd al-Qayrawani",
    sort_name: "Ibn Abi Zayd al-Qayrawani",
    birth_year: 922,
    death_year: 996,
    date_display: "922–996",
    description:
      "Maliki jurist of Qayrawan whose Risala became the standard introductory statement of Maliki creed and law.",
    is_attributed: false,
  },
  {
    slug: "al-mawardi",
    name: "Abu al-Hasan al-Mawardi",
    sort_name: "Mawardi, Abu al-Hasan al-",
    birth_year: 972,
    death_year: 1058,
    date_display: "972–1058",
    description:
      "Shafi'i jurist of Baghdad, author of al-Ahkam al-Sultaniyya on the institutions of the caliphate and a major tafsir.",
    is_attributed: false,
  },
  {
    slug: "al-kulayni",
    name: "Muhammad ibn Ya'qub al-Kulayni",
    sort_name: "Kulayni, Muhammad ibn Ya'qub al-",
    birth_year: 864,
    death_year: 941,
    date_display: "c. 864–941",
    description:
      "Twelver Shia hadith scholar of Baghdad, compiler of al-Kafi, the largest of the four canonical Shia collections.",
    is_attributed: false,
  },
  {
    slug: "al-maturidi",
    name: "Abu Mansur al-Maturidi",
    sort_name: "Maturidi, Abu Mansur al-",
    birth_year: 853,
    death_year: 944,
    date_display: "c. 853–944",
    description:
      "Hanafi theologian of Samarkand, founder of the Maturidi school of Sunni kalam and author of Kitab al-Tawhid.",
    is_attributed: false,
  },
  {
    slug: "ibn-al-salah",
    name: "Ibn al-Salah al-Shahrazuri",
    sort_name: "Ibn al-Salah",
    birth_year: 1181,
    death_year: 1245,
    date_display: "1181–1245",
    description:
      "Shafi'i hadith scholar of Damascus whose Muqaddima fixed the vocabulary and categories of the hadith sciences.",
    is_attributed: false,
  },
  {
    slug: "shams-al-din-ibn-qudama",
    name: "Shams al-Din Ibn Qudama",
    sort_name: "Ibn Qudama, Shams al-Din",
    birth_year: 1253,
    death_year: 1290,
    date_display: "1253–1290",
    description:
      "Hanbali jurist of Damascus, author of the Mukhtasar Minhaj al-Qasidin and other works of law and ethics.",
    is_attributed: false,
  },
  {
    slug: "al-zamakhshari",
    name: "Jar Allah al-Zamakhshari",
    sort_name: "Zamakhshari, Jar Allah al-",
    birth_year: 1075,
    death_year: 1144,
    date_display: "1075–1144",
    description:
      "Mu'tazili theologian, grammarian and Qur'an commentator, author of al-Kashshaf and the Asas al-Balagha.",
    is_attributed: false,
  },
  {
    slug: "ibn-hanbal",
    name: "Ahmad ibn Hanbal",
    sort_name: "Ibn Hanbal, Ahmad",
    birth_year: 780,
    death_year: 855,
    date_display: "780–855",
    description:
      "Theologian and jurist of Baghdad, eponym of the Hanbali school and compiler of the Musnad.",
    is_attributed: false,
  },
  {
    slug: "fakhr-al-din-al-razi",
    name: "Fakhr al-Din al-Razi",
    sort_name: "Razi, Fakhr al-Din al-",
    birth_year: 1150,
    death_year: 1210,
    date_display: "c. 1150–1210",
    description:
      "Theologian, philosopher and Qur'an commentator of Rayy, author of Mafatih al-Ghayb and a major systematiser of later kalam.",
    is_attributed: false,
  },
  {
    slug: "al-khatib-al-tabrizi",
    name: "Al-Khatib al-Tabrizi",
    sort_name: "Tabrizi, al-Khatib al-",
    birth_year: 1250,
    death_year: 1340,
    date_display: "d. 1340",
    description:
      "Hadith scholar of Tabriz, author of Mishkat al-Masabih and other works of transmission.",
    is_attributed: false,
  },
  {
    slug: "ibn-hajar",
    name: "Ibn Hajar al-Asqalani",
    sort_name: "Ibn Hajar al-Asqalani",
    birth_year: 1372,
    death_year: 1449,
    date_display: "1372–1449",
    description:
      "Mamluk-era hadith scholar and Shafi'i jurist, author of Fath al-Bari, Bulugh al-Maram and Nukhbat al-Fikr.",
    is_attributed: false,
  },
  {
    slug: "al-wahidi",
    name: "Al-Wahidi al-Naysaburi",
    sort_name: "Wahidi, al-",
    birth_year: 1000,
    death_year: 1076,
    date_display: "d. 1076",
    description:
      "Qur'an commentator of Nishapur, author of Asbab al-Nuzul and the tafsirs al-Basit, al-Wasit and al-Wajiz.",
    is_attributed: false,
  },
  {
    slug: "al-suyuti",
    name: "Jalal al-Din al-Suyuti",
    sort_name: "Suyuti, Jalal al-Din al-",
    birth_year: 1445,
    death_year: 1505,
    date_display: "1445–1505",
    description:
      "Prolific Egyptian scholar of Qur'anic sciences, hadith, history and law, author of al-Itqan and the Tafsir al-Jalalayn.",
    is_attributed: false,
  },
];

const meta = readJson(META);
const streams = readJson(STREAMS);
const functions = readJson(FUNCTIONS);
const previousManifest = (() => {
  try {
    return JSON.parse(readFileSync(MANIFEST, "utf8"));
  } catch {
    return null;
  }
})();
let manifest: any = {
  source: "openiti",
  retrieved_at: RETRIEVED_AT,
  note: "",
  hosts: [],
  works: only ? (previousManifest?.works ?? []) : [],
  failures: [],
};

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

function ensureMeta() {
  const authors: any[] = meta.authors;
  for (const author of AUTHORS) {
    if (authors.some((a) => a.slug === author.slug)) continue;
    authors.push(author);
  }
  const sources: any[] = meta.sources;
  if (!sources.some((s) => s.slug === "openiti")) {
    sources.push({
      slug: "openiti",
      name: "OpenITI corpus",
      provider: "Open Islamicate Texts Initiative",
      url: "https://github.com/OpenITI",
      description:
        "Machine-readable Arabic texts from the OpenITI corpus, including the historical works whose English translations are unavailable or in copyright.",
      access_notes:
        "The classical Arabic works are public domain. OpenITI's digital transcriptions are distributed under CC BY-NC-SA 4.0; this library streams them with attribution and does not relicence them.",
      retrieved_at: RETRIEVED_AT,
      is_live: 1,
      status: "connected",
    });
  }
  const SCHOOLS = [
    {
      slug: "shia-twelver",
      name: "Twelver Shi'ism",
      description:
        "The Twelver Shia tradition, its hadith collections, law and theology, including the school of the Imams and its later jurists.",
    },
    {
      slug: "maturidi",
      name: "Maturidi",
      description:
        "The Sunni school of kalam founded by Abu Mansur al-Maturidi, which reads revelation through a rational defence of God's unity and attributes.",
    },
    {
      slug: "mutazili",
      name: "Mu'tazili",
      description:
        "The school of kalam that argued for the unity and justice of God, the createdness of the Qur'an and the primacy of reason in theology.",
    },
  ];
  for (const school of SCHOOLS) {
    if (meta.schools.some((s: any) => s.slug === school.slug)) continue;
    meta.schools.push({ ...school, tradition: "islam" });
  }
  const licenses: any[] = meta.licenses;
  if (!licenses.some((l) => l.code === "cc-by-nc-sa")) {
    licenses.push({
      code: "cc-by-nc-sa",
      name: "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 (OpenITI transcription)",
      url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
      redistribution_allowed: 0,
      attribution_required: 1,
      share_alike: 1,
      notes:
        "Applied to OpenITI's digital transcriptions. The underlying classical works are public domain; the transcription is streamed with attribution and is not relicensed by this library.",
    });
  }
  writeFileSync(META, `${JSON.stringify(meta, null, 2)}\n`);
}

function ensureRegistry() {
  const registry = readJson(REGISTRY);
  const sources: any[] = registry.sources ?? registry;
  if (sources.some((s) => s.source_id === "openiti")) return;
  sources.push({
    source_id: "openiti",
    source_name: "OpenITI corpus",
    base_url: "https://raw.githubusercontent.com/OpenITI/",
    organisation: "Open Islamicate Texts Initiative",
    traditions_covered: ["islam"],
    schools_covered: ["sunni-tradition", "shia-twelver"],
    languages: ["ar"],
    source_type: "academic corpus",
    content_types: ["primary_text"],
    api_documentation_url: "https://openiti.org/documentation/",
    download_url: "https://github.com/OpenITI",
    access_method: "Raw mARkdown files over HTTPS; no key for read requests",
    licence_url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    licence_status: "cc_by_nc_sa",
    commercial_use_allowed: false,
    redistribution_allowed: false,
    attribution_requirements:
      "The classical work is public domain. Each digital transcription is credited to OpenITI and to the repository file it came from; the transcription is not relicensed by this library.",
    authentication_required: false,
    rate_limits: "GitHub raw content; no published limit for ordinary reading use",
    ingestion_status: "active",
    last_verified_at: RETRIEVED_AT,
    source_reliability_notes:
      "The corpus supplies machine-readable Arabic transcriptions with headings and paragraph markers. Transcription quality varies by edition: some files carry OCR or conversion artefacts, so each work here was checked for chapter structure, paragraph count and Arabic text before it was catalogued.",
    editorial_notes:
      "Only the catalogue record, chapter outline and passage index are stored. Text is streamed from GitHub when a chapter is opened and cached for a reading session. Arabic only: no English translation is included where no public-domain translation was verified.",
    priority: 2,
    approval_status: "approved",
  });
  writeFileSync(REGISTRY, `${JSON.stringify({ ...registry, sources }, null, 2)}\n`);
}

async function getText(url: string): Promise<string> {
  let last: Error | null = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "text/plain", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(180_000),
      });
      if (res.status === 404) throw new Error(`${url} returned 404`);
      if (res.status === 429 || res.status >= 500) {
        last = new Error(`${url} returned ${res.status}`);
        await Bun.sleep(1500 * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      return await res.text();
    } catch (err) {
      last = err as Error;
      if (attempt < 4) await Bun.sleep(700 * attempt);
    }
  }
  throw last ?? new Error(`${url} failed`);
}

function sourceOf(textUrl: string) {
  const match = textUrl.match(/^https:\/\/raw\.githubusercontent\.com\/OpenITI\/([^/]+)\/master\/(.+)$/);
  if (!match) throw new Error(`Unexpected OpenITI URL: ${textUrl}`);
  const [, repo, path] = match;
  return {
    repo: repo!,
    path: path!,
    file: path!.split("/").pop()!,
    blob: `https://github.com/OpenITI/${repo}/blob/master/${path}`,
  };
}

function chapterLabel(title: string): string {
  const clean = title
    .replace(/^\d+\s*[-–—.]?\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  const label = clean || title;
  return label.length > 90 ? `${label.slice(0, 87).trimEnd()}…` : label;
}

function validate(spec: Spec, chapters: OpenitiSection[], source: ReturnType<typeof sourceOf>) {
  if (chapters.length < 3) throw new Error(`only ${chapters.length} chapters were recovered`);
  if (chapters.length > 600) throw new Error(`${chapters.length} chapters is more than the reader can present`);
  const empty = chapters.filter((c) => c.paragraphs.length === 0);
  if (empty.length) throw new Error(`${empty.length} chapters have no text (first: ${empty[0]!.title})`);
  const passages = chapters.reduce((n, c) => n + c.paragraphs.length, 0);
  if (passages < 100) throw new Error(`only ${passages} paragraphs were recovered`);
  const words = chapters.reduce((n, c) => n + c.paragraphs.join(" ").split(/\s+/).length, 0);
  if (words < (spec.minWords ?? 5_000)) throw new Error(`only ${words} words were recovered`);
  const arabic = chapters.slice(0, 2).map((c) => c.paragraphs[0] ?? "").join(" ");
  if (!/[\u0600-\u06FF]/.test(arabic)) throw new Error("the recovered text does not look like Arabic");
  console.log(`  ${spec.slug}: ${chapters.length} chapters, ${passages} paragraphs, ${words} words`);
  console.log(`  source: ${source.repo}/${source.file}`);
}

async function build(spec: Spec) {
  const source = sourceOf(spec.textUrl);
  const text = await getText(spec.textUrl);
  const chapters = openitiChapters(parseOpeniti(text), spec.chapter);
  validate(spec, chapters, source);

  const chaptersOut = chapters.map((chapter, i) => ({
    ref: String(i + 1),
    label: chapterLabel(chapter.title),
  }));
  const passagesOut = chapters.flatMap((chapter, i) =>
    chapter.paragraphs.map((_, p) => ({
      reference: `${i + 1}.${p + 1}`,
      label: `${chaptersOut[i]!.label} §${p + 1}`,
      chapterRef: String(i + 1),
    })),
  );

  const editionSlug = `${spec.slug}-ar-openiti`;
  const authorName = AUTHORS.find((a) => a.slug === spec.author)?.name ?? spec.author;
  const work = {
    slug: spec.slug,
    title: spec.title,
    originalTitle: spec.originalTitle,
    transliteration: spec.transliteration,
    altTitles: spec.altTitles,
    tradition: "islam",
    school: spec.school,
    genre: spec.genre,
    textType: spec.textType,
    category: spec.category,
    subcategory: spec.subcategory,
    originalLanguage: "ar",
    dateStart: spec.dateStart,
    dateEnd: spec.dateEnd,
    dateDisplay: spec.dateDisplay,
    authorshipStatus: "established",
    author: spec.author,
    attributionNote:
      spec.slug === "fusus-al-hikam"
        ? "The attribution to Ibn Arabi is the one the manuscript tradition gives; the work's teachings, not its authorship, were the subject of later dispute."
        : "The attribution is the one the manuscript tradition and the scholarship give.",
    description: spec.description,
    historicalContext: spec.historicalContext,
    availabilityNote:
      "Arabic text only, streamed from OpenITI at read time. No English translation is included because no public-domain English translation was verified. Only the catalogue record, chapter outline and passage index are held here.",
    featured: false,
    featuredNote: "",
    refScheme: "chapter.paragraph",
    isSample: false,
    textStorage: "streamed",
    chapters: chaptersOut,
    passages: passagesOut,
    editions: [
      {
        slug: editionSlug,
        language: "ar",
        editionType: "original",
        title: spec.editionTitle,
        translator: "",
        publisher: "OpenITI",
        publicationYear: null,
        source: "openiti",
        license: "cc-by-nc-sa",
        rightsStatus:
          "The classical work is public domain. This digital transcription is distributed by OpenITI under CC BY-NC-SA 4.0 and is streamed with attribution.",
        attributionText: `${spec.title} by ${authorName}. Arabic text from the OpenITI corpus (${source.repo}/${source.file}), distributed under CC BY-NC-SA 4.0.`,
        structureScheme: "chapter and paragraph; chapter headings from the OpenITI transcription",
        isSample: false,
        notes: "Arabic only. The English translation was not available under a verifiable public-domain licence, so it is not included.",
      },
    ],
  };
  writeFileSync(join(WORKS, `${spec.slug}.json`), `${JSON.stringify(work, null, 2)}\n`);

  streams.works[spec.slug] = {
    provider: "openiti",
    upstream: `OpenITI/${source.repo}`,
    mode: "numbered",
    licence: "cc-by-nc-sa",
    config: {
      textUrl: spec.textUrl,
      sourceUrl: source.blob,
      edition: spec.editionTitle,
      chapter: spec.chapter,
    },
    editions: [
      {
        slug: editionSlug,
        language: "ar",
        languageName: "arabic",
        version: spec.editionTitle,
        license: "cc-by-nc-sa",
        sourceUrl: source.blob,
      },
    ],
  };
  functions.works[spec.slug] = {
    functions: spec.functions,
    status: "provisional",
    assignedBy: "UWL editors (comparative taxonomy)",
    note: `${spec.title} — ${spec.category}. Arabic text streamed from OpenITI.`,
  };
  const entry = {
    slug: spec.slug,
    host: "openiti",
    upstream: `${source.repo}/${source.file}`,
    chapters: chaptersOut.length,
    passages: passagesOut.length,
    translator: "",
  };
  const index = manifest.works.findIndex((w: any) => w.slug === spec.slug);
  if (index >= 0) manifest.works[index] = entry;
  else manifest.works.push(entry);
}

ensureMeta();
ensureRegistry();
for (const spec of SPECS) {
  if (only && only !== spec.slug) continue;
  console.log(spec.title);
  try {
    await build(spec);
  } catch (err) {
    console.error(`  ! ${spec.slug}: ${(err as Error).message}`);
    manifest.failures.push({ slug: spec.slug, reason: (err as Error).message });
  }
}

manifest.note =
  "Arabic-only works streamed from OpenITI. The library holds the catalogue record, chapter outline and passage index; the text is requested from GitHub at read time.";
manifest.hosts = [
  {
    id: "openiti",
    name: "OpenITI corpus",
    url: "https://github.com/OpenITI",
    licence: "CC BY-NC-SA 4.0 for the digital transcription; underlying works public domain",
  },
];
manifest.totals = {
  works: manifest.works.length,
  chapters: manifest.works.reduce((n: number, w: any) => n + w.chapters, 0),
  passages: manifest.works.reduce((n: number, w: any) => n + w.passages, 0),
};
streams.generatedAt = RETRIEVED_AT;

writeFileSync(STREAMS, `${JSON.stringify(streams, null, 2)}\n`);
writeFileSync(FUNCTIONS, `${JSON.stringify(functions, null, 2)}\n`);
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `${manifest.totals.works} works, ${manifest.totals.chapters} chapters, ${manifest.totals.passages} passages written.`,
);
if (manifest.failures.length) {
  console.error(`${manifest.failures.length} source(s) failed.`);
  process.exitCode = 1;
}
