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
//   bun run scripts/dev/import-openiti.ts --only=al-muhalla,al-furuq
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
// `--only=a,b` re-imports just those works and keeps the rest of the manifest.
const only = new Set((args.find((a) => a.startsWith("--only="))?.split("=")[1] ?? "").split(",").filter(Boolean));

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
  // ---------------------------------------------------------------------------
  // Fiqh expansion, 19 November 2026. The shelf held the six manuals the
  // earlier passes could catalogue; this pass adds the formative texts and the
  // standard teaching manuals of each school, the main works of legal theory
  // and legal maxims, and the first Zahiri and Twelver Shia law books.
  // ---------------------------------------------------------------------------
  {
    slug: "kitab-al-asl",
    title: "Kitab al-Asl",
    originalTitle: "كتاب الأصل",
    transliteration: "Kitāb al-Aṣl",
    altTitles: ["al-Mabsut of al-Shaybani"],
    author: "al-shaybani",
    school: "hanafi",
    genre: "Jurisprudence",
    textType: "Legal compendium",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Formative texts",
    dateStart: 770,
    dateEnd: 805,
    dateDisplay: "late 8th century CE",
    description:
      "Al-Shaybani's great record of the doctrine of Abu Hanifa and Abu Yusuf, set out as questions and answers. It is the first and largest of the six books later called the zahir al-riwaya, the texts on which the authoritative Hanafi position rests. The OpenITI file used here holds sixteen of its books, from prayer to sales; the rest of the work is not in this transcription.",
    historicalContext:
      "Muhammad ibn al-Hasan al-Shaybani studied with Abu Hanifa and then with Malik in Medina before serving as a judge under Harun al-Rashid. His books fixed the early Kufan school in writing, and al-Sarakhsi's al-Mabsut, already on this shelf, is in effect a commentary on the tradition they began.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0200AH/master/data/0189MuhammadShaybani/0189MuhammadShaybani.Asl/0189MuhammadShaybani.Asl.Shamela0006164-ara2`,
    chapter: { mode: "pattern", pattern: "^(\\d+\\s+)?\\[?كتاب" },
    functions: ["religious_law_practice", "historical_document"],
  },
  {
    slug: "al-jami-al-saghir",
    title: "Al-Jami' al-Saghir",
    originalTitle: "الجامع الصغير",
    transliteration: "al-Jāmiʿ al-Ṣaghīr",
    altTitles: [],
    author: "al-shaybani",
    school: "hanafi",
    genre: "Jurisprudence",
    textType: "Legal compendium",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Formative texts",
    dateStart: 780,
    dateEnd: 805,
    dateDisplay: "late 8th century CE",
    description:
      "A compact collection of rulings that al-Shaybani transmits from Abu Hanifa through Abu Yusuf, arranged by the books of the law. It is one of the zahir al-riwaya texts and was memorised and commented on as a summary of the school's settled doctrine.",
    historicalContext:
      "Tradition holds that Abu Yusuf asked al-Shaybani to write down what he had transmitted from Abu Hanifa, and that the result was this book. Its brevity made it a teaching text, and later Hanafi commentators, al-Sarakhsi among them, wrote commentaries on it.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0200AH/master/data/0189MuhammadShaybani/0189MuhammadShaybani.JamicSaghir/0189MuhammadShaybani.JamicSaghir.Shamela0006160-ara1.mARkdown`,
    chapter: { mode: "pattern", pattern: "^(\\d+\\s+)?\\[?كتاب" },
    functions: ["religious_law_practice", "historical_document"],
  },
  {
    slug: "kitab-al-hujja",
    title: "Kitab al-Hujja 'ala Ahl al-Madina",
    originalTitle: "كتاب الحجة على أهل المدينة",
    transliteration: "Kitāb al-Ḥujja ʿalā Ahl al-Madīna",
    altTitles: ["The Argument against the People of Medina"],
    author: "al-shaybani",
    school: "hanafi",
    genre: "Jurisprudence",
    textType: "Legal disputation",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Comparative law",
    dateStart: 780,
    dateEnd: 805,
    dateDisplay: "late 8th century CE",
    description:
      "Al-Shaybani sets the doctrine of Abu Hanifa beside that of the Medinan jurists on point after point, states where they differ, and argues for the Kufan position from hadith, the reports of the Companions and analogy. It is the earliest surviving work devoted to the disagreement between the schools.",
    historicalContext:
      "Written after al-Shaybani's years with Malik in Medina, the book shows the two great centres of early Islamic law arguing with one another before the schools hardened. It is a primary witness to how legal reasoning was conducted in the eighth century.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0200AH/master/data/0189MuhammadShaybani/0189MuhammadShaybani.HujjaCalaAhlMadina/0189MuhammadShaybani.HujjaCalaAhlMadina.Shamela0006161-ara1.mARkdown`,
    chapter: { mode: "level", level: 1 },
    functions: ["religious_law_practice", "historical_document"],
  },
  {
    slug: "mukhtasar-al-quduri",
    title: "Mukhtasar al-Quduri",
    originalTitle: "مختصر القدوري",
    transliteration: "Mukhtaṣar al-Qudūrī",
    altTitles: ["al-Kitab"],
    author: "al-quduri",
    school: "hanafi",
    genre: "Jurisprudence",
    textType: "Legal manual",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Classical manuals",
    dateStart: 1000,
    dateEnd: 1037,
    dateDisplay: "early 11th century CE",
    description:
      "The most widely studied primer of Hanafi law: a terse statement of the school's rulings from purification and prayer to inheritance, written to be memorised. Later authors built whole libraries of commentary on it, and al-Marghinani's al-Hidaya, already on this shelf, draws on it directly.",
    historicalContext:
      "Al-Quduri led the Hanafis of Baghdad in the early eleventh century. His Mukhtasar became one of the 'three texts' of the school's curriculum and was taught from Anatolia to India for nine centuries.",
    editionTitle: "Arabic text (OpenITI transcription of the Sham19Y edition)",
    textUrl: `${RAW}/0450AH/master/data/0428AbuHusaynQuduri/0428AbuHusaynQuduri.Mukhtasar/0428AbuHusaynQuduri.Mukhtasar.Sham19Y0124336-ara1`,
    chapter: { mode: "level", level: 1 },
    functions: ["religious_law_practice", "denominational_guidance"],
  },
  {
    slug: "badai-al-sanai",
    title: "Bada'i' al-Sana'i' fi Tartib al-Shara'i'",
    originalTitle: "بدائع الصنائع في ترتيب الشرائع",
    transliteration: "Badāʾiʿ al-Ṣanāʾiʿ fī Tartīb al-Sharāʾiʿ",
    altTitles: ["Bada'i' al-Sana'i'"],
    author: "al-kasani",
    school: "hanafi",
    genre: "Jurisprudence",
    textType: "Legal compendium",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Classical manuals",
    dateStart: 1150,
    dateEnd: 1191,
    dateDisplay: "12th century CE",
    description:
      "Al-Kasani's systematic restatement of Hanafi law. Where earlier works list cases, the Bada'i' orders each subject by its pillars, conditions and effects and gives the reasoning for every ruling, which made it the school's most admired work of legal architecture.",
    historicalContext:
      "Written as a commentary on his teacher al-Samarqandi's Tuhfat al-Fuqaha, the book is said to have won al-Kasani the hand of his teacher's daughter. He later taught in Aleppo, where the work circulated and became a standard reference.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0600AH/master/data/0587IbnMascudCalaDinKasani/0587IbnMascudCalaDinKasani.BadaicSanaic/0587IbnMascudCalaDinKasani.BadaicSanaic.Shamela0008183-ara1`,
    chapter: { mode: "pattern", pattern: "^(\\d+\\s+)?\\[?كتاب" },
    functions: ["religious_law_practice", "historical_document"],
  },
  {
    slug: "usul-al-sarakhsi",
    title: "Usul al-Sarakhsi",
    originalTitle: "أصول السرخسي",
    transliteration: "Uṣūl al-Sarakhsī",
    altTitles: [],
    author: "as-sarakhsi",
    school: "hanafi",
    genre: "Jurisprudence",
    textType: "Legal theory",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Legal theory (Usul)",
    dateStart: 1077,
    dateEnd: 1090,
    dateDisplay: "late 11th century CE",
    description:
      "Al-Sarakhsi's account of Hanafi legal theory: how commands and prohibitions bind, how general and specific texts are read together, abrogation, the Prophet's acts, consensus, analogy and juristic preference. It sets out the method behind the rulings of his al-Mabsut.",
    historicalContext:
      "Like al-Mabsut, much of the work is reported to have been dictated while al-Sarakhsi was imprisoned in Uzgend. It stands with al-Bazdawi's Usul as the classic statement of the Hanafi approach, which derives its theory from the school's established cases.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0500AH/master/data/0483IbnAhmadSarakhsi/0483IbnAhmadSarakhsi.Usul/0483IbnAhmadSarakhsi.Usul.Shamela0006301-ara1`,
    chapter: { mode: "level", level: 1 },
    functions: ["religious_law_practice", "academic_scholarship"],
  },
  {
    slug: "sharh-al-siyar-al-kabir",
    title: "Sharh al-Siyar al-Kabir",
    originalTitle: "شرح السير الكبير",
    transliteration: "Sharḥ al-Siyar al-Kabīr",
    altTitles: ["Commentary on al-Shaybani's Great Book of the Law of Nations"],
    author: "as-sarakhsi",
    school: "hanafi",
    genre: "Jurisprudence",
    textType: "Legal commentary",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Law of war and nations (Siyar)",
    dateStart: 1077,
    dateEnd: 1090,
    dateDisplay: "late 11th century CE",
    description:
      "Al-Sarakhsi's commentary on al-Shaybani's Siyar al-Kabir, the founding text of Islamic law on war, peace and relations with other polities. It treats the conduct of campaigns, safe-conduct, treaties, captives, spoils and the status of foreigners, and preserves al-Shaybani's text within the commentary.",
    historicalContext:
      "Al-Shaybani's Siyar is often called the first treatise on the law of nations, and it survives complete chiefly through this commentary. Al-Sarakhsi dictated it at the end of his life, after his release from prison.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0500AH/master/data/0483IbnAhmadSarakhsi/0483IbnAhmadSarakhsi.SharhSiyarKabir/0483IbnAhmadSarakhsi.SharhSiyarKabir.Shamela0005434-ara1`,
    chapter: { mode: "level", level: 1 },
    functions: ["religious_law_practice", "commentary_exegesis"],
  },
  {
    slug: "al-ashbah-wa-al-nazair-ibn-nujaym",
    title: "Al-Ashbah wa al-Naza'ir (Ibn Nujaym)",
    originalTitle: "الأشباه والنظائر",
    transliteration: "al-Ashbāh wa-l-Naẓāʾir",
    altTitles: ["Similarities and Parallels"],
    author: "ibn-nujaym",
    school: "hanafi",
    genre: "Jurisprudence",
    textType: "Legal maxims",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Legal maxims (Qawa'id)",
    dateStart: 1550,
    dateEnd: 1563,
    dateDisplay: "mid-16th century CE",
    description:
      "Ibn Nujaym gathers the general maxims of Hanafi law, such as 'certainty is not removed by doubt' and 'hardship brings ease', and shows the rulings each one governs, then turns to legal puzzles, distinctions between similar cases and the stories of jurists.",
    historicalContext:
      "Written in Cairo under Ottoman rule, the work modelled itself on al-Suyuti's Shafi'i collection of the same name and became the standard Hanafi book of maxims. Several of its maxims later entered the Ottoman civil code, the Majalla.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0975AH/master/data/0970IbnIbrahimIbnNujaymMisri/0970IbnIbrahimIbnNujaymMisri.AshbahWaNazair/0970IbnIbrahimIbnNujaymMisri.AshbahWaNazair.Shamela0001666-ara1.completed`,
    chapter: { mode: "level", level: 2 },
    functions: ["religious_law_practice", "academic_scholarship"],
  },
  {
    slug: "al-kafi-fi-fiqh-ahl-al-madina",
    title: "Al-Kafi fi Fiqh Ahl al-Madina",
    originalTitle: "الكافي في فقه أهل المدينة",
    transliteration: "al-Kāfī fī Fiqh Ahl al-Madīna",
    altTitles: [],
    author: "ibn-abd-al-barr",
    school: "maliki",
    genre: "Jurisprudence",
    textType: "Legal manual",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Classical manuals",
    dateStart: 1040,
    dateEnd: 1071,
    dateDisplay: "11th century CE",
    description:
      "Ibn 'Abd al-Barr's concise statement of Maliki law, giving for each question the position he judged best attested in the school and leaving out the long chains of dissent. It covers the whole law from purification to inheritance in a single readable volume.",
    historicalContext:
      "Ibn 'Abd al-Barr was the leading hadith scholar of al-Andalus, best known for his commentaries on the Muwatta. He wrote al-Kafi as a practical handbook, and it remained a reference for Andalusian and North African judges.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0475AH/master/data/0463IbnCabdBarr/0463IbnCabdBarr.KafiFiFiqh/0463IbnCabdBarr.KafiFiFiqh.Shamela0007367-ara1`,
    chapter: { mode: "pattern", pattern: "^(\\d+\\s+)?\\[?كتاب" },
    functions: ["religious_law_practice", "denominational_guidance"],
  },
  {
    slug: "al-furuq",
    title: "Al-Furuq",
    originalTitle: "الفروق",
    transliteration: "al-Furūq",
    altTitles: ["Anwar al-Buruq fi Anwa' al-Furuq"],
    author: "al-qarafi",
    school: "maliki",
    genre: "Jurisprudence",
    textType: "Legal maxims",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Legal maxims (Qawa'id)",
    dateStart: 1260,
    dateEnd: 1285,
    dateDisplay: "13th century CE",
    description:
      "Al-Qarafi works through some 274 distinctions between pairs of legal principles that look alike but govern differently, beginning with the difference between testimony and narration. Each 'difference' becomes the occasion for a short essay on the logic of the law.",
    historicalContext:
      "Al-Qarafi taught in Mamluk Cairo and wrote across law, legal theory and theology. Al-Furuq is the most original Maliki work on legal maxims and was later annotated by Ibn al-Shatt; this transcription follows the chapters into which the distinctions fall.",
    editionTitle: "Arabic text (OpenITI transcription of the ShamAY edition)",
    textUrl: `${RAW}/0700AH/master/data/0684ShihabDinQarafi/0684ShihabDinQarafi.Furuq/0684ShihabDinQarafi.Furuq.ShamAY0034190-ara1`,
    chapter: { mode: "pattern", pattern: "^الفرق" },
    functions: ["religious_law_practice", "academic_scholarship"],
  },
  {
    slug: "mukhtasar-khalil",
    title: "Mukhtasar Khalil",
    originalTitle: "مختصر خليل",
    transliteration: "Mukhtaṣar Khalīl",
    altTitles: [],
    author: "khalil-ibn-ishaq",
    school: "maliki",
    genre: "Jurisprudence",
    textType: "Legal manual",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Classical manuals",
    dateStart: 1340,
    dateEnd: 1374,
    dateDisplay: "14th century CE",
    description:
      "Khalil's compressed statement of the authoritative Maliki position on every question, written in a deliberately dense style in which each word carries a ruling. It became the central text of Maliki law across North and West Africa.",
    historicalContext:
      "Khalil ibn Ishaq al-Jundi taught in Cairo and spent some twenty-five years on the work. Its compression called forth hundreds of commentaries, and French colonial jurists translated it as the code of Maliki law in Algeria.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0775AH/master/data/0767KhalilIbnIshaq/0767KhalilIbnIshaq.MukhtasarKhalil/0767KhalilIbnIshaq.MukhtasarKhalil.Shamela0011355-ara1`,
    chapter: { mode: "pattern", pattern: "^(\\d+\\s+)?\\[?(كتاب|باب)" },
    functions: ["religious_law_practice", "denominational_guidance"],
  },
  {
    slug: "mukhtasar-al-muzani",
    title: "Mukhtasar al-Muzani",
    originalTitle: "مختصر المزني",
    transliteration: "Mukhtaṣar al-Muzanī",
    altTitles: [],
    author: "al-muzani",
    school: "shafii",
    genre: "Jurisprudence",
    textType: "Legal manual",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Formative texts",
    dateStart: 840,
    dateEnd: 878,
    dateDisplay: "9th century CE",
    description:
      "Al-Muzani's abridgement of al-Shafi'i's teaching, arranged by the books of the law and noting where he himself would rule otherwise. It was the text through which most later Shafi'is first learned the school.",
    historicalContext:
      "Al-Muzani was al-Shafi'i's foremost student in Egypt. His Mukhtasar carried the founder's doctrine to the generation that built the school, and the great Shafi'i commentaries of the following centuries were written on it.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0275AH/master/data/0264IbnYahyaMuzani/0264IbnYahyaMuzani.Mukhtasar/0264IbnYahyaMuzani.Mukhtasar.Shamela0001661-ara1`,
    chapter: { mode: "pattern", pattern: "^(\\d+\\s+)?\\[?كتاب" },
    functions: ["religious_law_practice", "historical_document"],
  },
  {
    slug: "al-muhadhdhab",
    title: "Al-Muhadhdhab fi Fiqh al-Imam al-Shafi'i",
    originalTitle: "المهذب في فقه الإمام الشافعي",
    transliteration: "al-Muhadhdhab",
    altTitles: [],
    author: "abu-ishaq-al-shirazi",
    school: "shafii",
    genre: "Jurisprudence",
    textType: "Legal compendium",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Classical manuals",
    dateStart: 1063,
    dateEnd: 1083,
    dateDisplay: "11th century CE",
    description:
      "A full statement of Shafi'i law with the evidence for each ruling drawn from the Qur'an, hadith and analogy. Al-Nawawi's al-Majmu', the largest Shafi'i reference work, was written as a commentary on it.",
    historicalContext:
      "Abu Ishaq al-Shirazi was the first professor of the Nizamiyya college in Baghdad, founded for him by Nizam al-Mulk. Al-Muhadhdhab and its shorter companion al-Tanbih became the core of the Shafi'i curriculum.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0500AH/master/data/0476AbuIshaqShirazi/0476AbuIshaqShirazi.MuhadhdhabFiFiqh/0476AbuIshaqShirazi.MuhadhdhabFiFiqh.Shamela0011813-ara1`,
    chapter: { mode: "pattern", pattern: "^(\\d+\\s+)?\\[?كتاب" },
    functions: ["religious_law_practice", "historical_document"],
  },
  {
    slug: "al-tanbih",
    title: "Al-Tanbih fi al-Fiqh al-Shafi'i",
    originalTitle: "التنبيه في الفقه الشافعي",
    transliteration: "al-Tanbīh",
    altTitles: [],
    author: "abu-ishaq-al-shirazi",
    school: "shafii",
    genre: "Jurisprudence",
    textType: "Legal manual",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Classical manuals",
    dateStart: 1060,
    dateEnd: 1083,
    dateDisplay: "11th century CE",
    description:
      "Al-Shirazi's short manual of Shafi'i law, stating rulings without their proofs so that a student could hold the whole law in memory. It counts among the five most important books of the school's middle period.",
    historicalContext:
      "Composed at the Nizamiyya in Baghdad, al-Tanbih was memorised and commented on for centuries; al-Nawawi wrote a commentary on it as well as on al-Muhadhdhab.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0500AH/master/data/0476AbuIshaqShirazi/0476AbuIshaqShirazi.TanbihFiFiqhShafici/0476AbuIshaqShirazi.TanbihFiFiqhShafici.Shamela0007589-ara1`,
    chapter: { mode: "pattern", pattern: "^(\\d+\\s+)?\\[?كتاب" },
    functions: ["religious_law_practice", "denominational_guidance"],
  },
  {
    slug: "minhaj-al-talibin",
    title: "Minhaj al-Talibin",
    originalTitle: "منهاج الطالبين وعمدة المفتين",
    transliteration: "Minhāj al-Ṭālibīn",
    altTitles: ["Minhaj et Talibin", "A Manual of Muhammadan Law"],
    author: "al-nawawi",
    school: "shafii",
    genre: "Jurisprudence",
    textType: "Legal manual",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Classical manuals",
    dateStart: 1270,
    dateEnd: 1277,
    dateDisplay: "c. 1270 CE",
    description:
      "Al-Nawawi's abridgement of al-Rafi'i's al-Muharrar, stating the preferred Shafi'i ruling on each question and marking where he corrects his source. It became the definitive text of the later Shafi'i school, on which the standard commentaries of Ibn Hajar al-Haytami and al-Ramli were written.",
    historicalContext:
      "Written in Damascus near the end of al-Nawawi's life, the Minhaj was the basis of Shafi'i practice from Egypt to Southeast Asia. Van den Berg edited it with a French translation in 1882, and E. C. Howard's English version of that translation (1914) is the edition the acquisition register still seeks in a clean transcription.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0700AH/master/data/0676Nawawi/0676Nawawi.MinhajTalibin/0676Nawawi.MinhajTalibin.Shamela0012096-ara1`,
    chapter: { mode: "pattern", pattern: "^(\\d+\\s+)?\\[?كتاب" },
    functions: ["religious_law_practice", "denominational_guidance"],
  },
  {
    slug: "al-waraqat",
    title: "Al-Waraqat",
    originalTitle: "الورقات",
    transliteration: "al-Waraqāt",
    altTitles: ["The Leaflets"],
    author: "al-juwayni",
    school: "shafii",
    genre: "Jurisprudence",
    textType: "Primer",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Legal theory (Usul)",
    dateStart: 1060,
    dateEnd: 1085,
    dateDisplay: "11th century CE",
    description:
      "A few pages that define the terms of legal theory: the rule and its kinds, command and prohibition, general and specific, abrogation, consensus, analogy and the qualifications of the jurist. It is still the first text of usul al-fiqh that many students memorise.",
    historicalContext:
      "Al-Juwayni, the 'Imam of the Two Sanctuaries', taught al-Ghazali at the Nizamiyya of Nishapur. The Waraqat is his shortest work and has been versified and commented on more often than almost any other primer.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0500AH/master/data/0478ImamHaramaynJuwayni/0478ImamHaramaynJuwayni.Waraqat/0478ImamHaramaynJuwayni.Waraqat.Shamela0006297-ara1`,
    chapter: { mode: "level", level: 1 },
    functions: ["religious_law_practice", "academic_scholarship"],
    minWords: 1_500,
  },
  {
    slug: "al-burhan-fi-usul-al-fiqh",
    title: "Al-Burhan fi Usul al-Fiqh",
    originalTitle: "البرهان في أصول الفقه",
    transliteration: "al-Burhān fī Uṣūl al-Fiqh",
    altTitles: [],
    author: "al-juwayni",
    school: "shafii",
    genre: "Jurisprudence",
    textType: "Legal theory",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Legal theory (Usul)",
    dateStart: 1060,
    dateEnd: 1085,
    dateDisplay: "11th century CE",
    description:
      "Al-Juwayni's major treatise on legal theory, notable for its independent judgements against both al-Shafi'i and al-Ash'ari and for its treatment of the purposes of the law, which his student al-Ghazali developed further.",
    historicalContext:
      "The Burhan belongs to the theologians' school of usul, which reasons from first principles rather than from the established cases of a school. Its difficulty earned it a reputation as 'the puzzle of the community'.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0500AH/master/data/0478ImamHaramaynJuwayni/0478ImamHaramaynJuwayni.BurhanFiUsulFiqh/0478ImamHaramaynJuwayni.BurhanFiUsulFiqh.Shamela0007439-ara1`,
    chapter: { mode: "level", level: 1 },
    functions: ["religious_law_practice", "academic_scholarship"],
  },
  {
    slug: "al-mustasfa",
    title: "Al-Mustasfa min 'Ilm al-Usul",
    originalTitle: "المستصفى من علم الأصول",
    transliteration: "al-Mustaṣfā",
    altTitles: [],
    author: "al-ghazali",
    school: "shafii",
    genre: "Jurisprudence",
    textType: "Legal theory",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Legal theory (Usul)",
    dateStart: 1108,
    dateEnd: 1109,
    dateDisplay: "1109 CE",
    description:
      "Al-Ghazali's last and most influential work of legal theory. It opens with a treatise on logic, then orders the discipline around the rule, its sources, the methods of deriving it and the person who derives it, and gives the classic account of the five necessities the law protects.",
    historicalContext:
      "Written in Tus two years before al-Ghazali's death, after his return to teaching, the Mustasfa became one of the four pillars of the theologians' method in usul and was abridged by Ibn Rushd and al-Razi among others.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0525AH/master/data/0505Ghazali/0505Ghazali.Mustasfa/0505Ghazali.Mustasfa.Shamela0005459-ara1`,
    chapter: { mode: "level", level: 1 },
    functions: ["religious_law_practice", "academic_scholarship"],
  },
  {
    slug: "al-ashbah-wa-al-nazair-al-subki",
    title: "Al-Ashbah wa al-Naza'ir (al-Subki)",
    originalTitle: "الأشباه والنظائر",
    transliteration: "al-Ashbāh wa-l-Naẓāʾir",
    altTitles: [],
    author: "taj-al-din-al-subki",
    school: "shafii",
    genre: "Jurisprudence",
    textType: "Legal maxims",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Legal maxims (Qawa'id)",
    dateStart: 1350,
    dateEnd: 1370,
    dateDisplay: "14th century CE",
    description:
      "Taj al-Din al-Subki's collection of the maxims of Shafi'i law, from 'certainty is not removed by doubt' onward, with the theoretical and grammatical principles that bear on legal reasoning.",
    historicalContext:
      "Al-Subki was chief judge of Damascus and the author of the great biographical dictionary of the Shafi'is. His book stands between al-Qarafi's al-Furuq and al-Suyuti's later collection in the development of the genre.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0775AH/master/data/0771TajDinSubki/0771TajDinSubki.AshbahWaNazair/0771TajDinSubki.AshbahWaNazair.Shamela0008634-ara1.completed`,
    chapter: { mode: "level", level: 2 },
    functions: ["religious_law_practice", "academic_scholarship"],
  },
  {
    slug: "umdat-al-fiqh",
    title: "'Umdat al-Fiqh",
    originalTitle: "عمدة الفقه",
    transliteration: "ʿUmdat al-Fiqh",
    altTitles: [],
    author: "ibn-qudama",
    school: "hanbali",
    genre: "Jurisprudence",
    textType: "Legal manual",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Classical manuals",
    dateStart: 1190,
    dateEnd: 1223,
    dateDisplay: "late 12th–early 13th century CE",
    description:
      "The first of Ibn Qudama's graded series of Hanbali law books, giving one ruling for each question with a hadith in support. It was written for beginners, to be followed by al-Muqni', al-Kafi and finally al-Mughni, which is already on this shelf.",
    historicalContext:
      "Ibn Qudama taught in the Salihiyya quarter of Damascus, to which his family had fled from Crusader Palestine. The 'Umda became the usual first text of Hanbali students and has been commented on into modern times.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0625AH/master/data/0620IbnQudamaMaqdisi/0620IbnQudamaMaqdisi.CumdatFiqh/0620IbnQudamaMaqdisi.CumdatFiqh.Shamela0011315-ara1`,
    chapter: { mode: "pattern", pattern: "^(\\d+\\s+)?\\[?كتاب" },
    functions: ["religious_law_practice", "denominational_guidance"],
  },
  {
    slug: "rawdat-al-nazir",
    title: "Rawdat al-Nazir wa Junnat al-Munazir",
    originalTitle: "روضة الناظر وجنة المناظر",
    transliteration: "Rawḍat al-Nāẓir",
    altTitles: [],
    author: "ibn-qudama",
    school: "hanbali",
    genre: "Jurisprudence",
    textType: "Legal theory",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Legal theory (Usul)",
    dateStart: 1190,
    dateEnd: 1223,
    dateDisplay: "late 12th–early 13th century CE",
    description:
      "Ibn Qudama's handbook of Hanbali legal theory, closely following the order of al-Ghazali's al-Mustasfa while adjusting it to Hanbali positions. It became the standard usul text of the school.",
    historicalContext:
      "The work shows how the Hanbalis adopted the theologians' framework for legal theory while keeping their own positions on revelation and analogy; al-Tufi's later abridgement and commentary were built on it.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0625AH/master/data/0620IbnQudamaMaqdisi/0620IbnQudamaMaqdisi.RawdatNazir/0620IbnQudamaMaqdisi.RawdatNazir.Shamela0012010-ara1`,
    chapter: { mode: "level", level: 1 },
    functions: ["religious_law_practice", "academic_scholarship"],
  },
  {
    slug: "al-rawd-al-murbi",
    title: "Al-Rawd al-Murbi' Sharh Zad al-Mustaqni'",
    originalTitle: "الروض المربع شرح زاد المستقنع",
    transliteration: "al-Rawḍ al-Murbiʿ",
    altTitles: [],
    author: "al-buhuti",
    school: "hanbali",
    genre: "Jurisprudence",
    textType: "Legal commentary",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Classical manuals",
    dateStart: 1620,
    dateEnd: 1641,
    dateDisplay: "early 17th century CE",
    description:
      "Al-Buhuti's commentary on al-Hajjawi's Zad al-Mustaqni', a brief Hanbali manual. Text and commentary together give the settled later Hanbali position on each question, which is why the book is still the usual intermediate text of the school.",
    historicalContext:
      "Mansur al-Buhuti was the leading Hanbali of Ottoman Cairo, and his commentaries define what later Hanbalis call the school's relied-upon doctrine.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/1075AH/master/data/1051IbnYunusBuhutiHanbali/1051IbnYunusBuhutiHanbali.RawdMurbic/1051IbnYunusBuhutiHanbali.RawdMurbic.Shamela0001679-ara1`,
    chapter: { mode: "pattern", pattern: "^(\\d+\\s+)?\\[?كتاب" },
    functions: ["religious_law_practice", "commentary_exegesis"],
  },
  {
    slug: "al-siyasa-al-shariyya",
    title: "Al-Siyasa al-Shar'iyya",
    originalTitle: "السياسة الشرعية في إصلاح الراعي والرعية",
    transliteration: "al-Siyāsa al-Sharʿiyya",
    altTitles: ["Governance according to the Law"],
    author: "ibn-taymiyya",
    school: "hanbali",
    genre: "Jurisprudence",
    textType: "Treatise",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Public finance and governance",
    dateStart: 1300,
    dateEnd: 1328,
    dateDisplay: "early 14th century CE",
    description:
      "Ibn Taymiyya's short treatise on the duties of rulers: appointing the competent and trustworthy, handling public money, and applying the fixed penalties and discretionary punishments. It argues that good government is itself a religious obligation.",
    historicalContext:
      "Written for the Mamluk authorities, the work recasts the theory of government around justice and public welfare rather than the person of the caliph, and has been widely read in modern debates about Islamic governance.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0750AH/master/data/0728IbnTaymiyya/0728IbnTaymiyya.SiyasaSharciyya/0728IbnTaymiyya.SiyasaSharciyya.Shamela0031237-ara1`,
    chapter: { mode: "level", level: 1 },
    functions: ["religious_law_practice", "historical_document"],
  },
  {
    slug: "ilam-al-muwaqqiin",
    title: "I'lam al-Muwaqqi'in 'an Rabb al-'Alamin",
    originalTitle: "إعلام الموقعين عن رب العالمين",
    transliteration: "Iʿlām al-Muwaqqiʿīn",
    altTitles: [],
    author: "ibn-qayyim",
    school: "hanbali",
    genre: "Jurisprudence",
    textType: "Legal theory",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Legal theory (Usul)",
    dateStart: 1330,
    dateEnd: 1350,
    dateDisplay: "14th century CE",
    description:
      "Ibn Qayyim al-Jawziyya's long work on giving legal opinions: who may speak for God in the law, the sources of Ahmad ibn Hanbal's fatwas, the limits of analogy, a sustained critique of blind imitation, the wisdom behind rulings and the changing of fatwas with time and place.",
    historicalContext:
      "Ibn Qayyim was Ibn Taymiyya's leading student in Damascus. The I'lam, built around a commentary on 'Umar's letter on judging, is one of the classic statements of the case for independent legal reasoning.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0775AH/master/data/0751IbnQayyimJawziyya/0751IbnQayyimJawziyya.AclamMuwaqqicin/0751IbnQayyimJawziyya.AclamMuwaqqicin.Shamela0011496-ara1`,
    // The transcription heads hundreds of short sections "فصل"; they stay in
    // the text, and every other heading opens a chapter.
    chapter: { mode: "pattern", pattern: "^(?!فصل)" },
    functions: ["religious_law_practice", "academic_scholarship"],
  },
  {
    slug: "al-turuq-al-hukmiyya",
    title: "Al-Turuq al-Hukmiyya fi al-Siyasa al-Shar'iyya",
    originalTitle: "الطرق الحكمية في السياسة الشرعية",
    transliteration: "al-Ṭuruq al-Ḥukmiyya",
    altTitles: [],
    author: "ibn-qayyim",
    school: "hanbali",
    genre: "Jurisprudence",
    textType: "Treatise",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Judicial procedure and governance",
    dateStart: 1330,
    dateEnd: 1350,
    dateDisplay: "14th century CE",
    description:
      "Ibn Qayyim's treatise on how a judge may establish the truth: circumstantial evidence, the testimony of different kinds of witness, oaths, documents and the discretion of the ruler, with the market inspector's office and the policing of public life.",
    historicalContext:
      "The work defends the use of evidence beyond formal testimony, arguing that justice is the aim of the law and that any method that reveals it belongs to the law. It is a key text for the history of Islamic judicial procedure.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0775AH/master/data/0751IbnQayyimJawziyya/0751IbnQayyimJawziyya.TuruqHukmiyya/0751IbnQayyimJawziyya.TuruqHukmiyya.Shamela0011495-ara1`,
    chapter: { mode: "level", level: 1 },
    functions: ["religious_law_practice", "historical_document"],
  },
  {
    slug: "al-muhalla",
    title: "Al-Muhalla bi al-Athar",
    originalTitle: "المحلى بالآثار",
    transliteration: "al-Muḥallā",
    altTitles: [],
    author: "ibn-hazm",
    school: "zahiri",
    genre: "Jurisprudence",
    textType: "Legal compendium",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Comparative law",
    dateStart: 1030,
    dateEnd: 1064,
    dateDisplay: "11th century CE",
    description:
      "The great law book of the Zahiri school. Ibn Hazm numbers each question, states his ruling from the plain sense of the Qur'an and hadith, and then reviews and rejects the positions of the other schools, refusing analogy and juristic preference as sources.",
    historicalContext:
      "Ibn Hazm of Cordoba was a poet, historian and theologian as well as a jurist. The Muhalla, left unfinished and completed by his son, is the fullest surviving statement of literalist law and a rich record of the opinions of the early jurists.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0475AH/master/data/0456IbnHazm/0456IbnHazm.MuhallaBiAthar/0456IbnHazm.MuhallaBiAthar.Shamela0000767-ara1.completed`,
    chapter: { mode: "pattern", pattern: "^(\\d+\\s+)?\\[?كتاب" },
    functions: ["religious_law_practice", "historical_document"],
  },
  {
    slug: "al-ihkam-fi-usul-al-ahkam-ibn-hazm",
    title: "Al-Ihkam fi Usul al-Ahkam (Ibn Hazm)",
    originalTitle: "الإحكام في أصول الأحكام",
    transliteration: "al-Iḥkām fī Uṣūl al-Aḥkām",
    altTitles: [],
    author: "ibn-hazm",
    school: "zahiri",
    genre: "Jurisprudence",
    textType: "Legal theory",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Legal theory (Usul)",
    dateStart: 1030,
    dateEnd: 1064,
    dateDisplay: "11th century CE",
    description:
      "Ibn Hazm's theory of law: language and meaning, the authority of the Qur'an and of solitary hadith reports, consensus, and long chapters against analogy, juristic preference and imitation. It is the theoretical companion to al-Muhalla.",
    historicalContext:
      "The work is the principal statement of Zahiri method, and its arguments against analogy were answered by jurists of every other school.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0475AH/master/data/0456IbnHazm/0456IbnHazm.IhkamFiUsulAhkam/0456IbnHazm.IhkamFiUsulAhkam.Shamela0010432-ara1`,
    chapter: { mode: "level", level: 1 },
    functions: ["religious_law_practice", "academic_scholarship"],
  },
  {
    slug: "sharai-al-islam",
    title: "Shara'i' al-Islam fi Masa'il al-Halal wa al-Haram",
    originalTitle: "شرائع الإسلام في مسائل الحلال والحرام",
    transliteration: "Sharāʾiʿ al-Islām",
    altTitles: [],
    author: "al-muhaqqiq-al-hilli",
    school: "shia-twelver",
    genre: "Jurisprudence",
    textType: "Legal manual",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Classical manuals",
    dateStart: 1250,
    dateEnd: 1277,
    dateDisplay: "13th century CE",
    description:
      "The standard handbook of Twelver Shia law, in four parts: acts of worship, contracts, unilateral acts and judgements. Its clear order and careful statement of the school's positions made it the base text of the Shia seminaries for seven centuries.",
    historicalContext:
      "Al-Muhaqqiq al-Hilli led the scholars of al-Hilla in Iraq after the Mongol conquest. The Shara'i' was commented on by al-Shahid al-Thani and, in the nineteenth century, in the vast Jawahir al-Kalam.",
    editionTitle: "Arabic text (OpenITI transcription of the Masaha edition)",
    textUrl: `${RAW}/0700AH/master/data/0676IbnHasanMuhaqqiqHilli/0676IbnHasanMuhaqqiqHilli.SharaicIslam/0676IbnHasanMuhaqqiqHilli.SharaicIslam.Masaha001030Vols-ara1`,
    chapter: { mode: "pattern", pattern: "^(\\d+\\s+)?\\[?كتاب" },
    functions: ["religious_law_practice", "denominational_guidance"],
  },
  {
    slug: "al-muqnia",
    title: "Al-Muqni'a",
    originalTitle: "المقنعة",
    transliteration: "al-Muqniʿa",
    altTitles: [],
    author: "al-shaykh-al-mufid",
    school: "shia-twelver",
    genre: "Jurisprudence",
    textType: "Legal manual",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Formative texts",
    dateStart: 990,
    dateEnd: 1022,
    dateDisplay: "late 10th–early 11th century CE",
    description:
      "Al-Shaykh al-Mufid's compendium of Twelver belief and law, opening with the articles of faith and then running through worship, family, commerce and penalties. It is one of the earliest systematic Shia law books.",
    historicalContext:
      "Al-Mufid led the Twelver community of Buyid Baghdad. His student al-Tusi wrote the Tahdhib al-Ahkam, one of the four canonical Shia hadith collections, as a commentary that supplies the hadith behind the rulings of al-Muqni'a.",
    editionTitle: "Arabic text (OpenITI transcription of the Masaha edition)",
    textUrl: `${RAW}/0425AH/master/data/0413ShaykhMufid/0413ShaykhMufid.Muqnica/0413ShaykhMufid.Muqnica.Masaha000989-ara1`,
    chapter: { mode: "level", level: 1 },
    functions: ["religious_law_practice", "historical_document"],
  },
  {
    slug: "qawaid-al-ahkam",
    title: "Qawa'id al-Ahkam fi Ma'rifat al-Halal wa al-Haram",
    originalTitle: "قواعد الأحكام في معرفة الحلال والحرام",
    transliteration: "Qawāʿid al-Aḥkām",
    altTitles: [],
    author: "al-allama-al-hilli",
    school: "shia-twelver",
    genre: "Jurisprudence",
    textType: "Legal compendium",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Classical manuals",
    dateStart: 1290,
    dateEnd: 1325,
    dateDisplay: "c. 1300 CE",
    description:
      "Al-'Allama al-Hilli's comprehensive statement of Twelver law, setting out the questions of each topic with the alternatives open to the jurist. Its systematic coverage made it, with his uncle's Shara'i', the basis of later Shia legal scholarship.",
    historicalContext:
      "Al-'Allama al-Hilli was the nephew and student of al-Muhaqqiq al-Hilli and the most prolific Shia scholar of the Ilkhanid period; his influence at the court of Oljeitu helped establish Twelver Shi'ism in Iran.",
    editionTitle: "Arabic text (OpenITI transcription of the Shia edition)",
    textUrl: `${RAW}/0750AH/master/data/0726CallamaHilli/0726CallamaHilli.QawacidAhkam/0726CallamaHilli.QawacidAhkam.Shia000091Vols-ara1.completed`,
    chapter: { mode: "pattern", pattern: "^(\\d+\\s+)?\\[?كتاب" },
    functions: ["religious_law_practice", "denominational_guidance"],
  },
  {
    slug: "al-ihkam-fi-usul-al-ahkam-al-amidi",
    title: "Al-Ihkam fi Usul al-Ahkam (al-Amidi)",
    originalTitle: "الإحكام في أصول الأحكام",
    transliteration: "al-Iḥkām fī Uṣūl al-Aḥkām",
    altTitles: [],
    author: "al-amidi",
    school: "shafii",
    genre: "Jurisprudence",
    textType: "Legal theory",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Legal theory (Usul)",
    dateStart: 1200,
    dateEnd: 1233,
    dateDisplay: "early 13th century CE",
    description:
      "Sayf al-Din al-Amidi's comprehensive treatise on legal theory, which states every position with its arguments and objections before reaching a judgement. It is one of the most rigorous works of the theologians' school of usul.",
    historicalContext:
      "Al-Amidi trained as a Hanbali in Iraq, became a Shafi'i, and taught in Cairo and Damascus. His Ihkam and its abridgement by Ibn al-Hajib shaped the teaching of usul in the Mamluk period.",
    editionTitle: "Arabic text (OpenITI transcription of the Shamela edition)",
    textUrl: `${RAW}/0650AH/master/data/0631SayfDinAmidi/0631SayfDinAmidi.IhkamFiUsulAhkam/0631SayfDinAmidi.IhkamFiUsulAhkam.Shamela0010801-ara1`,
    chapter: { mode: "level", level: 1 },
    functions: ["religious_law_practice", "academic_scholarship"],
  },
  {
    slug: "irshad-al-fuhul",
    title: "Irshad al-Fuhul",
    originalTitle: "إرشاد الفحول إلى تحقيق الحق من علم الأصول",
    transliteration: "Irshād al-Fuḥūl",
    altTitles: [],
    author: "al-shawkani",
    school: "sunni-tradition",
    genre: "Jurisprudence",
    textType: "Legal theory",
    category: "Jurisprudence (Fiqh)",
    subcategory: "Legal theory (Usul)",
    dateStart: 1800,
    dateEnd: 1834,
    dateDisplay: "early 19th century CE",
    description:
      "Al-Shawkani's survey of legal theory, which reports the positions of the schools on each question and then states his own, consistently arguing for independent reasoning from the texts over adherence to a school.",
    historicalContext:
      "Al-Shawkani, chief judge of Sana'a, came from a Zaydi background and became one of the most influential advocates of ijtihad before the modern reform movements. This transcription keeps the modern editors' introductions that precede the author's text.",
    editionTitle: "Arabic text (OpenITI transcription of the JK edition)",
    textUrl: `${RAW}/1275AH/master/data/1255Shawkani/1255Shawkani.IrshadFuhul/1255Shawkani.IrshadFuhul.JK000152-ara1`,
    chapter: { mode: "level", level: 1 },
    functions: ["religious_law_practice", "academic_scholarship"],
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
  // Fiqh expansion, 19 November 2026.
  {
    slug: "al-shaybani",
    name: "Muhammad ibn al-Hasan al-Shaybani",
    sort_name: "Shaybani, Muhammad ibn al-Hasan al-",
    birth_year: 749,
    death_year: 805,
    date_display: "749/50–805",
    description:
      "Student of Abu Hanifa and Malik, judge under Harun al-Rashid, whose books recorded the founding doctrine of the Hanafi school and the first Islamic law of nations.",
    is_attributed: false,
  },
  {
    slug: "al-quduri",
    name: "Abu al-Husayn al-Quduri",
    sort_name: "Quduri, Abu al-Husayn al-",
    birth_year: 973,
    death_year: 1037,
    date_display: "972/3–1037",
    description: "Leading Hanafi jurist of Baghdad, author of the Mukhtasar that became the school's standard primer.",
    is_attributed: false,
  },
  {
    slug: "al-kasani",
    name: "'Ala' al-Din al-Kasani",
    sort_name: "Kasani, 'Ala' al-Din al-",
    birth_year: null,
    death_year: 1191,
    date_display: "d. 1191",
    description: "Hanafi jurist of Central Asia and Aleppo, author of Bada'i' al-Sana'i', the school's great systematic restatement.",
    is_attributed: false,
  },
  {
    slug: "ibn-nujaym",
    name: "Zayn al-Din Ibn Nujaym",
    sort_name: "Ibn Nujaym, Zayn al-Din",
    birth_year: 1520,
    death_year: 1563,
    date_display: "1520–1563",
    description: "Hanafi jurist of Ottoman Cairo, author of al-Ashbah wa al-Naza'ir and al-Bahr al-Ra'iq.",
    is_attributed: false,
  },
  {
    slug: "ibn-abd-al-barr",
    name: "Ibn 'Abd al-Barr",
    sort_name: "Ibn 'Abd al-Barr, Yusuf",
    birth_year: 978,
    death_year: 1071,
    date_display: "978–1071",
    description: "Andalusian Maliki jurist and hadith scholar, author of al-Tamhid and al-Istidhkar on the Muwatta and of al-Kafi.",
    is_attributed: false,
  },
  {
    slug: "al-qarafi",
    name: "Shihab al-Din al-Qarafi",
    sort_name: "Qarafi, Shihab al-Din al-",
    birth_year: 1228,
    death_year: 1285,
    date_display: "1228–1285",
    description: "Maliki jurist and legal theorist of Mamluk Cairo, author of al-Furuq and al-Dhakhira.",
    is_attributed: false,
  },
  {
    slug: "khalil-ibn-ishaq",
    name: "Khalil ibn Ishaq al-Jundi",
    sort_name: "Khalil ibn Ishaq al-Jundi",
    birth_year: null,
    death_year: 1374,
    date_display: "d. 1365 or 1374",
    description: "Maliki jurist of Cairo whose Mukhtasar became the central law text of North and West Africa.",
    is_attributed: false,
  },
  {
    slug: "al-muzani",
    name: "Isma'il ibn Yahya al-Muzani",
    sort_name: "Muzani, Isma'il ibn Yahya al-",
    birth_year: 791,
    death_year: 878,
    date_display: "791–878",
    description: "Al-Shafi'i's foremost Egyptian student, whose Mukhtasar transmitted the founder's doctrine to the early Shafi'i school.",
    is_attributed: false,
  },
  {
    slug: "abu-ishaq-al-shirazi",
    name: "Abu Ishaq al-Shirazi",
    sort_name: "Shirazi, Abu Ishaq al-",
    birth_year: 1003,
    death_year: 1083,
    date_display: "1003–1083",
    description: "Shafi'i jurist and first professor of the Nizamiyya in Baghdad, author of al-Muhadhdhab and al-Tanbih.",
    is_attributed: false,
  },
  {
    slug: "al-juwayni",
    name: "Imam al-Haramayn al-Juwayni",
    sort_name: "Juwayni, Imam al-Haramayn al-",
    birth_year: 1028,
    death_year: 1085,
    date_display: "1028–1085",
    description: "Shafi'i jurist and Ash'ari theologian of Nishapur, teacher of al-Ghazali, author of al-Burhan and al-Waraqat.",
    is_attributed: false,
  },
  {
    slug: "taj-al-din-al-subki",
    name: "Taj al-Din al-Subki",
    sort_name: "Subki, Taj al-Din al-",
    birth_year: 1327,
    death_year: 1370,
    date_display: "1327–1370",
    description: "Shafi'i chief judge of Damascus, author of Tabaqat al-Shafi'iyya al-Kubra and al-Ashbah wa al-Naza'ir.",
    is_attributed: false,
  },
  {
    slug: "al-buhuti",
    name: "Mansur ibn Yunus al-Buhuti",
    sort_name: "Buhuti, Mansur ibn Yunus al-",
    birth_year: 1591,
    death_year: 1641,
    date_display: "1591–1641",
    description: "Leading Hanbali jurist of Ottoman Cairo, whose commentaries define the later school's relied-upon doctrine.",
    is_attributed: false,
  },
  {
    slug: "ibn-taymiyya",
    name: "Taqi al-Din Ibn Taymiyya",
    sort_name: "Ibn Taymiyya, Taqi al-Din",
    birth_year: 1263,
    death_year: 1328,
    date_display: "1263–1328",
    description: "Hanbali theologian and jurist of Damascus, author of al-Siyasa al-Shar'iyya and a vast body of fatwas.",
    is_attributed: false,
  },
  {
    slug: "ibn-qayyim",
    name: "Ibn Qayyim al-Jawziyya",
    sort_name: "Ibn Qayyim al-Jawziyya",
    birth_year: 1292,
    death_year: 1350,
    date_display: "1292–1350",
    description: "Hanbali jurist and theologian of Damascus, student of Ibn Taymiyya, author of I'lam al-Muwaqqi'in and al-Turuq al-Hukmiyya.",
    is_attributed: false,
  },
  {
    slug: "ibn-hazm",
    name: "Ibn Hazm of Cordoba",
    sort_name: "Ibn Hazm, 'Ali ibn Ahmad",
    birth_year: 994,
    death_year: 1064,
    date_display: "994–1064",
    description: "Andalusian poet, theologian and jurist, the chief exponent of the Zahiri school, author of al-Muhalla and The Ring of the Dove.",
    is_attributed: false,
  },
  {
    slug: "al-muhaqqiq-al-hilli",
    name: "Al-Muhaqqiq al-Hilli",
    sort_name: "Hilli, al-Muhaqqiq al-",
    birth_year: 1205,
    death_year: 1277,
    date_display: "c. 1205–1277",
    description: "Twelver Shia jurist of al-Hilla, author of Shara'i' al-Islam and al-Mukhtasar al-Nafi'.",
    is_attributed: false,
  },
  {
    slug: "al-shaykh-al-mufid",
    name: "Al-Shaykh al-Mufid",
    sort_name: "Mufid, al-Shaykh al-",
    birth_year: 948,
    death_year: 1022,
    date_display: "948–1022",
    description: "Leading Twelver Shia theologian and jurist of Buyid Baghdad, teacher of al-Sharif al-Murtada and al-Tusi.",
    is_attributed: false,
  },
  {
    slug: "al-allama-al-hilli",
    name: "Al-'Allama al-Hilli",
    sort_name: "Hilli, al-'Allama al-",
    birth_year: 1250,
    death_year: 1325,
    date_display: "1250–1325",
    description: "Twelver Shia jurist and theologian of al-Hilla, nephew of al-Muhaqqiq, author of Qawa'id al-Ahkam and Tadhkirat al-Fuqaha'.",
    is_attributed: false,
  },
  {
    slug: "al-amidi",
    name: "Sayf al-Din al-Amidi",
    sort_name: "Amidi, Sayf al-Din al-",
    birth_year: 1156,
    death_year: 1233,
    date_display: "1156–1233",
    description: "Shafi'i legal theorist and Ash'ari theologian who taught in Cairo and Damascus, author of al-Ihkam fi Usul al-Ahkam.",
    is_attributed: false,
  },
  {
    slug: "al-shawkani",
    name: "Muhammad ibn 'Ali al-Shawkani",
    sort_name: "Shawkani, Muhammad ibn 'Ali al-",
    birth_year: 1759,
    death_year: 1834,
    date_display: "1759–1834",
    description: "Chief judge of Sana'a and advocate of independent legal reasoning, author of Nayl al-Awtar and Irshad al-Fuhul.",
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
  works: only.size ? (previousManifest?.works ?? []) : [],
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
      slug: "zahiri",
      name: "Zahiri",
      description:
        "The literalist school of law, which derives rulings from the plain sense of the Qur'an and hadith and rejects analogy; its chief surviving exponent is Ibn Hazm.",
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
  // Sample the opening paragraphs, not just the first of each chapter: some
  // transcriptions open with a volume heading or an ellipsis before the text.
  const arabic = chapters.flatMap((c) => c.paragraphs).slice(0, 20).join(" ");
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
  if (only.size && !only.has(spec.slug)) continue;
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
