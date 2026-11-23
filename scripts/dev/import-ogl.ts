// Imports Greek and Latin originals of early Christian texts from the Open
// Greek and Latin project (First1KGreek, csel-dev) and the Perseus Digital
// Library (canonical-greekLit, canonical-latinLit).
//
// The Christian shelf was English-first: the patristic hosts serve
// public-domain translations, and apart from the Bible no Greek or Latin
// original was held. These repositories publish TEI transcriptions of the
// standard nineteenth- and early twentieth-century editions under CC BY-SA 4.0,
// which permits redistribution with attribution and share-alike. The text is
// therefore stored in the corpus, like the CCEL shelf, and nothing is fetched
// when a chapter is read.
//
// Rights rule for this pass: the transcription must carry CC BY-SA 4.0 (in the
// file's own <licence> or the repository licence), and the printed edition it
// reproduces must be from before 1930, so that the critical text is public
// domain in the United States as well. Later Loeb-based files are recorded in
// the acquisition register instead of imported.
//
//   bun run scripts/dev/import-ogl.ts
//   bun run scripts/dev/import-ogl.ts --only=ignatius-letters-greek
//   bun run scripts/dev/import-ogl.ts --offline      (use cached TEI only)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readTei, type TeiChapter } from "../../ingest/tei";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");
const META = join(ROOT, "data", "corpus", "meta.json");
const STREAMS = join(ROOT, "data", "registry", "streams.json");
const REGISTRY = join(ROOT, "data", "registry", "sources.json");
const FUNCTIONS = join(ROOT, "data", "corpus", "text-functions.json");
const MANIFEST = join(ROOT, "data", "imports", "ogl.json");
const CACHE = join(ROOT, "data", "imports", "cache", "ogl");
const RETRIEVED_AT = new Date().toISOString().slice(0, 10);
const USER_AGENT = "UniversalWisdomLibrary/1.0 (local reading interface; import)";
const LATEST_PRINT_YEAR = 1929;

const args = process.argv.slice(2);
const only = new Set((args.find((a) => a.startsWith("--only="))?.split("=")[1] ?? "").split(",").filter(Boolean));
const offline = args.includes("--offline");

type Repo = "First1KGreek" | "csel-dev" | "canonical-greekLit" | "canonical-latinLit";
type FileRef = { repo: Repo; urn: string; label?: string };
type Spec = {
  slug: string;
  title: string;
  originalTitle: string;
  altTitles: string[];
  author: string | null;
  authorship: "established" | "traditional" | "anonymous" | "disputed";
  school: string;
  genre: string;
  textType: string;
  category: string;
  dateStart: number | null;
  dateEnd: number | null;
  dateDisplay: string;
  description: string;
  historicalContext: string;
  files: FileRef[];
  /** The library's English edition of the same work, when there is one. */
  english?: string;
  functions: string[];
};

const ORG: Record<Repo, string> = {
  First1KGreek: "OpenGreekAndLatin",
  "csel-dev": "OpenGreekAndLatin",
  "canonical-greekLit": "PerseusDL",
  "canonical-latinLit": "PerseusDL",
};
const PROJECT: Record<Repo, string> = {
  First1KGreek: "First Thousand Years of Greek (Open Greek and Latin)",
  "csel-dev": "Open Greek and Latin (CSEL digitisation)",
  "canonical-greekLit": "Perseus Digital Library",
  "canonical-latinLit": "Perseus Digital Library",
};

function rawUrl(f: FileRef): string {
  const [group, work] = f.urn.split(".");
  return `https://raw.githubusercontent.com/${ORG[f.repo]}/${f.repo}/master/data/${group}/${work}/${f.urn}.xml`;
}
function blobUrl(f: FileRef): string {
  const [group, work] = f.urn.split(".");
  return `https://github.com/${ORG[f.repo]}/${f.repo}/blob/master/data/${group}/${work}/${f.urn}.xml`;
}

const F = (repo: Repo, urn: string, label?: string): FileRef => ({ repo, urn, label });
const PT = "Patristic theology";
const CH = "Church history";

const SPECS: Spec[] = [
  // --- Apostolic Fathers -------------------------------------------------------
  {
    slug: "1-clement-greek", title: "Epistula I ad Corinthios (1 Clement)", originalTitle: "Κλήμεντος πρὸς Κορινθίους Α΄",
    altTitles: ["First Epistle of Clement"], author: "clement-of-rome", authorship: "traditional", school: "early-christianity",
    genre: "Epistle", textType: "Letter", category: PT, dateStart: 95, dateEnd: 97, dateDisplay: "c. 96 CE",
    description: "The letter of the church of Rome to the church of Corinth, urging the reinstatement of deposed presbyters and grounding church order in humility, peace and the succession from the apostles. It is the earliest Christian writing outside the New Testament whose date is reasonably secure.",
    historicalContext: "Tradition names Clement, an early bishop of Rome, as the writer. The letter was read in Corinthian worship a century later and appears in Codex Alexandrinus after the New Testament.",
    files: [F("First1KGreek", "tlg1271.tlg001.1st1K-grc1")], functions: ["non_canonical_religious_text", "historical_document"],
  },
  {
    slug: "ignatius-letters-greek", title: "Epistulae (Ignatius of Antioch)", originalTitle: "Ἰγνατίου ἐπιστολαί",
    altTitles: ["The Seven Letters of Ignatius"], author: "ignatius-of-antioch", authorship: "established", school: "early-christianity",
    genre: "Epistle", textType: "Letters", category: PT, dateStart: 105, dateEnd: 115, dateDisplay: "early 2nd century CE",
    description: "The seven letters Ignatius wrote on his way to martyrdom in Rome, to the churches of Ephesus, Magnesia, Tralles, Rome, Philadelphia and Smyrna and to Polycarp. They insist on the unity of each church under its bishop, the reality of Christ's flesh against docetism, and Ignatius's desire to die for Christ.",
    historicalContext: "This is the middle recension, the seven letters Eusebius knew, which most scholars accept as authentic. The edition is Kirsopp Lake's Apostolic Fathers (1912).",
    files: [F("First1KGreek", "tlg1443.tlg001.1st1K-grc1")], functions: ["non_canonical_religious_text", "historical_document"],
  },
  {
    slug: "polycarp-philippians-greek", title: "Epistula ad Philippenses (Polycarp)", originalTitle: "Πολυκάρπου πρὸς Φιλιππησίους ἐπιστολή",
    altTitles: ["Letter to the Philippians"], author: "polycarp", authorship: "established", school: "early-christianity",
    genre: "Epistle", textType: "Letter", category: PT, dateStart: 110, dateEnd: 140, dateDisplay: "early 2nd century CE",
    description: "Polycarp of Smyrna's letter to the church at Philippi, answering their request for Ignatius's letters and exhorting them to righteousness, steadfastness and care in the matter of a presbyter who had defrauded the church. It is dense with quotations from the New Testament writings.",
    historicalContext: "Polycarp was remembered as a disciple of the apostle John and as the teacher of Irenaeus. Part of the letter survives only in Latin; the Greek given here is that of Lake's edition.",
    files: [F("First1KGreek", "tlg1622.tlg001.1st1K-grc1")], functions: ["non_canonical_religious_text", "historical_document"],
  },
  {
    slug: "martyrdom-of-polycarp-greek", title: "Martyrium Polycarpi", originalTitle: "Μαρτύριον τοῦ ἁγίου Πολυκάρπου",
    altTitles: ["The Martyrdom of Polycarp"], author: null, authorship: "anonymous", school: "early-christianity",
    genre: "Martyrology", textType: "Martyr narrative", category: PT, dateStart: 155, dateEnd: 160, dateDisplay: "c. 155–160 CE",
    description: "The letter of the church of Smyrna describing the arrest, trial and burning of its aged bishop Polycarp, with his refusal to swear by Caesar: 'Eighty-six years have I served him, and he has done me no wrong.' It is the earliest Christian account of a martyrdom outside the New Testament.",
    historicalContext: "The narrative models Polycarp's death on Christ's passion and records the first known reference to the yearly commemoration of a martyr's 'birthday'.",
    files: [F("First1KGreek", "tlg1484.tlg001.1st1K-grc1")], functions: ["non_canonical_religious_text", "historical_document"],
  },
  {
    slug: "epistle-of-barnabas-greek", title: "Barnabae Epistula", originalTitle: "Βαρνάβα ἐπιστολή",
    altTitles: ["The Epistle of Barnabas"], author: null, authorship: "anonymous", school: "early-christianity",
    genre: "Epistle", textType: "Treatise in letter form", category: PT, dateStart: 96, dateEnd: 135, dateDisplay: "late 1st or early 2nd century CE",
    description: "An anonymous treatise, later attributed to Paul's companion Barnabas, that reads the Jewish law, sacrifices and covenant allegorically as pointing to Christ, and closes with the teaching of the 'Two Ways' of light and darkness.",
    historicalContext: "Probably written in Alexandria, the letter was included in Codex Sinaiticus after the New Testament and was read as scripture by some early writers, including Clement of Alexandria.",
    files: [F("First1KGreek", "tlg1216.tlg001.opp-grc1")], functions: ["non_canonical_religious_text", "commentary_exegesis"],
  },
  {
    slug: "shepherd-of-hermas-greek", title: "Pastor (The Shepherd of Hermas)", originalTitle: "Ποιμὴν τοῦ Ἑρμᾶ",
    altTitles: ["The Shepherd of Hermas"], author: "hermas", authorship: "traditional", school: "early-christianity",
    genre: "Apocalypse", textType: "Visions, mandates and similitudes", category: PT, dateStart: 100, dateEnd: 150, dateDisplay: "first half of the 2nd century CE",
    description: "The visions of Hermas, a Roman Christian, in which a woman representing the Church and an angel in the form of a shepherd teach him about repentance after baptism, through five visions, twelve commandments and ten parables.",
    historicalContext: "The Muratorian fragment says Hermas wrote while his brother Pius was bishop of Rome. The book was widely read as scripture in the second and third centuries and stands in Codex Sinaiticus.",
    files: [F("First1KGreek", "tlg1419.tlg001.1st1K-grc1")], functions: ["non_canonical_religious_text", "mystical_contemplative"],
  },
  // --- Apologists -------------------------------------------------------------
  {
    slug: "justin-first-apology-greek", title: "Apologia I (Justin Martyr)", originalTitle: "Ἀπολογία πρώτη ὑπὲρ Χριστιανῶν",
    altTitles: ["First Apology"], author: "justin-martyr", authorship: "established", school: "early-christianity",
    genre: "Apologetics", textType: "Apology", category: "Apologetics", dateStart: 150, dateEnd: 155, dateDisplay: "c. 150–155 CE",
    description: "Justin's petition to Antoninus Pius for justice to Christians, defending them against charges of atheism and immorality, arguing from the Hebrew prophets that Jesus is the Christ, and describing baptism and the Sunday eucharist in the earliest detailed account of Christian worship.",
    historicalContext: "Justin, a philosopher from Samaria who taught in Rome, was martyred around 165. The edition is Rauschen's Florilegium Patristicum text (1911).",
    english: "justin-martyr-first-apology", files: [F("First1KGreek", "tlg0645.tlg001.1st1K-grc1")], functions: ["philosophical_work", "historical_document"],
  },
  {
    slug: "justin-second-apology-greek", title: "Apologia II (Justin Martyr)", originalTitle: "Ἀπολογία δευτέρα ὑπὲρ Χριστιανῶν",
    altTitles: ["Second Apology"], author: "justin-martyr", authorship: "established", school: "early-christianity",
    genre: "Apologetics", textType: "Apology", category: "Apologetics", dateStart: 150, dateEnd: 161, dateDisplay: "c. 150–161 CE",
    description: "A shorter appeal to the Roman Senate occasioned by the execution of Christians under the prefect Urbicus, developing Justin's teaching that the 'seed of the Word' was present in all who lived by reason.",
    historicalContext: "Whether it is a separate work or an appendix to the First Apology is debated. The text follows Rauschen's edition (1911).",
    files: [F("First1KGreek", "tlg0645.tlg002.perseus-grc2")], functions: ["philosophical_work", "historical_document"],
  },
  {
    slug: "justin-dialogue-with-trypho-greek", title: "Dialogus cum Tryphone", originalTitle: "Πρὸς Τρύφωνα Ἰουδαῖον διάλογος",
    altTitles: ["Dialogue with Trypho"], author: "justin-martyr", authorship: "established", school: "early-christianity",
    genre: "Apologetics", textType: "Dialogue", category: "Apologetics", dateStart: 155, dateEnd: 165, dateDisplay: "c. 155–165 CE",
    description: "Justin's account of a two-day debate with the Jewish teacher Trypho at Ephesus, opening with the story of his own conversion from philosophy and arguing from the Septuagint that Jesus is the Messiah and that the Church is the true Israel.",
    historicalContext: "The longest surviving second-century Christian work, and the earliest extended Christian engagement with Judaism. The text is Archambault's edition (1909).",
    files: [F("First1KGreek", "tlg0645.tlg003.perseus-grc2")], functions: ["philosophical_work", "commentary_exegesis"],
  },
  {
    slug: "athenagoras-legatio-greek", title: "Legatio pro Christianis (Athenagoras)", originalTitle: "Πρεσβεία περὶ Χριστιανῶν",
    altTitles: ["A Plea for the Christians"], author: "athenagoras", authorship: "established", school: "early-christianity",
    genre: "Apologetics", textType: "Apology", category: "Apologetics", dateStart: 176, dateEnd: 180, dateDisplay: "c. 177 CE",
    description: "An elegant philosophical defence of Christians addressed to Marcus Aurelius and Commodus, answering the charges of atheism, cannibalism and incest and setting out an early account of God as Father, Son and Spirit.",
    historicalContext: "Athenagoras was an Athenian philosopher. His Plea is the most carefully argued of the second-century apologies.",
    files: [F("First1KGreek", "tlg1205.tlg001.perseus-grc2")], functions: ["philosophical_work", "historical_document"],
  },
  {
    slug: "theophilus-ad-autolycum-greek", title: "Ad Autolycum (Theophilus of Antioch)", originalTitle: "Πρὸς Αὐτόλυκον",
    altTitles: ["To Autolycus"], author: "theophilus-of-antioch", authorship: "established", school: "early-christianity",
    genre: "Apologetics", textType: "Apology", category: "Apologetics", dateStart: 180, dateEnd: 185, dateDisplay: "c. 180 CE",
    description: "Three books addressed to a pagan friend, defending belief in an invisible God, commenting on the creation narrative of Genesis, and arguing that Moses is older than the Greek poets and philosophers. It contains the first known use of the Greek word trias for God.",
    historicalContext: "Theophilus was bishop of Antioch in the reign of Marcus Aurelius; this is his only surviving work.",
    files: [F("First1KGreek", "tlg1725.tlg001.perseus-grc2")], functions: ["philosophical_work", "commentary_exegesis"],
  },
  {
    slug: "tatian-oratio-ad-graecos-greek", title: "Oratio ad Graecos (Tatian)", originalTitle: "Λόγος πρὸς Ἕλληνας",
    altTitles: ["Address to the Greeks"], author: "tatian", authorship: "established", school: "early-christianity",
    genre: "Apologetics", textType: "Oration", category: "Apologetics", dateStart: 165, dateEnd: 175, dateDisplay: "c. 170 CE",
    description: "Tatian's polemic against Greek religion, philosophy, theatre and learning, contrasting it with the 'barbarian' wisdom of the Christians and arguing for the priority of Moses over Homer.",
    historicalContext: "Tatian, a Syrian student of Justin, later founded an ascetic movement and compiled the Diatessaron, the gospel harmony long used in the Syriac churches.",
    files: [F("First1KGreek", "tlg1766.tlg001.perseus-grc1")], functions: ["philosophical_work", "historical_document"],
  },
  // --- Alexandria ---------------------------------------------------------------
  {
    slug: "clement-protrepticus-greek", title: "Protrepticus (Clement of Alexandria)", originalTitle: "Προτρεπτικὸς πρὸς Ἕλληνας",
    altTitles: ["Exhortation to the Greeks"], author: "clement-of-alexandria", authorship: "established", school: "patristics",
    genre: "Apologetics", textType: "Exhortation", category: "Apologetics", dateStart: 190, dateEnd: 195, dateDisplay: "c. 195 CE",
    description: "Clement's appeal to the Greeks to leave the mysteries and myths for the 'new song' of the Word, drawing on the poets and philosophers to show that the truth they glimpsed is fulfilled in Christ.",
    historicalContext: "The first part of Clement's trilogy, followed by the Paedagogus and the Stromata. Clement headed the catechetical school of Alexandria before Origen. The text is Stählin's GCS edition (1905).",
    files: [F("First1KGreek", "tlg0555.tlg001.1st1K-grc1")], functions: ["philosophical_work", "sermon_speech"],
  },
  {
    slug: "clement-paedagogus-greek", title: "Paedagogus (Clement of Alexandria)", originalTitle: "Παιδαγωγός",
    altTitles: ["The Instructor"], author: "clement-of-alexandria", authorship: "established", school: "patristics",
    genre: "Ethics", textType: "Moral treatise", category: "Christian life", dateStart: 195, dateEnd: 200, dateDisplay: "c. 198 CE",
    description: "Clement presents Christ as the tutor of converts and sets out, in three books, the Christian way of life down to food, drink, dress, sleep, marriage and the use of wealth. It is a rich source for daily life in Roman Alexandria.",
    historicalContext: "The second part of Clement's trilogy. Book III ends with a hymn to Christ the Saviour, one of the earliest Christian hymns to survive.",
    files: [F("First1KGreek", "tlg0555.tlg002.1st1K-grc1")], functions: ["ethical_humanist_manifesto", "denominational_guidance"],
  },
  {
    slug: "quis-dives-salvetur-greek", title: "Quis Dives Salvetur (Clement of Alexandria)", originalTitle: "Τίς ὁ σωζόμενος πλούσιος",
    altTitles: ["Who Is the Rich Man That Shall Be Saved?"], author: "clement-of-alexandria", authorship: "established", school: "patristics",
    genre: "Homily", textType: "Homily", category: "Christian life", dateStart: 190, dateEnd: 210, dateDisplay: "c. 200 CE",
    description: "A homily on the rich young man of Mark 10, arguing that Christ asks for detachment from wealth rather than its abandonment, and closing with the story of the apostle John and the young robber.",
    historicalContext: "The work shaped Christian thinking about property for centuries and is the source of the John and the robber legend later retold by Eusebius.",
    files: [F("First1KGreek", "tlg0555.tlg006.1st1K-grc1")], functions: ["sermon_speech", "ethical_humanist_manifesto"],
  },
  {
    slug: "origen-contra-celsum-greek", title: "Contra Celsum", originalTitle: "Κατὰ Κέλσου",
    altTitles: ["Against Celsus"], author: "origen", authorship: "established", school: "patristics",
    genre: "Apologetics", textType: "Refutation", category: PT, dateStart: 248, dateEnd: 248, dateDisplay: "c. 248 CE",
    description: "Origen's eight-book reply to The True Word, the second-century philosopher Celsus's attack on Christianity, which Origen quotes at length and answers point by point. It preserves most of what is known of Celsus and is the fullest early Christian engagement with Greek philosophy.",
    historicalContext: "Written in Caesarea at the request of Origen's patron Ambrose. The text is Koetschau's GCS edition (1899).",
    english: "origen-against-celsus", files: [F("First1KGreek", "tlg2042.tlg001.perseus-grc1")], functions: ["philosophical_work", "historical_document"],
  },
  {
    slug: "origen-de-oratione-greek", title: "De Oratione (Origen)", originalTitle: "Περὶ εὐχῆς",
    altTitles: ["On Prayer"], author: "origen", authorship: "established", school: "patristics",
    genre: "Treatise", textType: "Treatise on prayer", category: "Christian mysticism", dateStart: 233, dateEnd: 234, dateDisplay: "c. 233 CE",
    description: "Origen's treatise on prayer: whether prayer is possible if God foreknows all things, its kinds and posture, and a phrase-by-phrase commentary on the Lord's Prayer.",
    historicalContext: "The oldest Christian treatise on prayer to survive complete, written for Ambrose and Tatiana. Koetschau's edition (1899).",
    english: "origen-prayer", files: [F("First1KGreek", "tlg2042.tlg008.perseus-grc1")], functions: ["mystical_contemplative", "commentary_exegesis"],
  },
  {
    slug: "origen-exhortatio-ad-martyrium-greek", title: "Exhortatio ad Martyrium (Origen)", originalTitle: "Εἰς μαρτύριον προτρεπτικὸς λόγος",
    altTitles: ["Exhortation to Martyrdom"], author: "origen", authorship: "established", school: "patristics",
    genre: "Treatise", textType: "Exhortation", category: "Christian life", dateStart: 235, dateEnd: 235, dateDisplay: "c. 235 CE",
    description: "Written to Ambrose and the presbyter Protoctetus during the persecution of Maximinus Thrax, the work urges them to hold fast, presenting martyrdom as the perfect imitation of Christ and a baptism of blood.",
    historicalContext: "Origen's own father had died as a martyr, and he himself would be tortured in the Decian persecution. Koetschau's edition (1899).",
    files: [F("First1KGreek", "tlg2042.tlg007.perseus-grc1")], functions: ["sermon_speech", "mystical_contemplative"],
  },
  {
    slug: "hippolytus-refutatio-greek", title: "Refutatio Omnium Haeresium", originalTitle: "Κατὰ πασῶν αἱρέσεων ἔλεγχος",
    altTitles: ["Refutation of All Heresies", "Philosophumena"], author: "hippolytus", authorship: "disputed", school: "patristics",
    genre: "Heresiology", textType: "Refutation", category: PT, dateStart: 222, dateEnd: 235, dateDisplay: "after 222 CE",
    description: "A survey of Greek philosophy, astrology and the mysteries followed by thirty-three Christian heresies, each traced to a pagan source. It preserves otherwise lost Gnostic texts and the teaching of Heraclitus and the Presocratics. Books II and III are lost.",
    historicalContext: "The attribution to Hippolytus of Rome is traditional but disputed. The text is Duncker and Schneidewin's edition (1859).",
    english: "hippolytus-refutation-of-all-heresies", files: [F("First1KGreek", "tlg2115.tlg060.perseus-grc1")], functions: ["academic_scholarship", "historical_document"],
  },
  {
    slug: "methodius-symposium-greek", title: "Symposium (Methodius of Olympus)", originalTitle: "Συμπόσιον ἢ περὶ ἁγνείας",
    altTitles: ["The Banquet of the Ten Virgins"], author: "methodius-of-olympus", authorship: "established", school: "patristics",
    genre: "Dialogue", textType: "Dialogue", category: PT, dateStart: 270, dateEnd: 311, dateDisplay: "late 3rd century CE",
    description: "A Christian answer to Plato's Symposium in which ten virgins each deliver a speech in praise of chastity, ending with Thecla's hymn to Christ the bridegroom.",
    historicalContext: "Methodius was a bishop in Lycia and a critic of Origen. The text is Bonwetsch's GCS edition (1917), transcribed from a scan; occasional OCR slips remain.",
    files: [F("First1KGreek", "tlg2959.tlg001.opp-grc1")], functions: ["philosophical_work", "mystical_contemplative"],
  },
  // --- Fourth- and fifth-century Greek -----------------------------------------
  {
    slug: "athanasius-de-incarnatione-greek", title: "De Incarnatione Verbi", originalTitle: "Λόγος περὶ τῆς ἐνανθρωπήσεως τοῦ Λόγου",
    altTitles: ["On the Incarnation"], author: "athanasius", authorship: "established", school: "patristics",
    genre: "Treatise", textType: "Theological treatise", category: PT, dateStart: 318, dateEnd: 337, dateDisplay: "c. 318–337 CE",
    description: "Athanasius explains why the Word of God became human: to restore the image of God in fallen humanity and to defeat death by dying and rising. It is the classic statement of incarnational theology.",
    historicalContext: "Written as the second part of a two-part apology with Against the Heathen. Robertson's edition (1893).",
    english: "athanasius-on-the-incarnation", files: [F("First1KGreek", "tlg2035.tlg002.1st1K-grc1")], functions: ["philosophical_work", "creed_confession"],
  },
  {
    slug: "athanasius-contra-arianos-greek", title: "Orationes contra Arianos I–III", originalTitle: "Λόγοι κατὰ Ἀρειανῶν",
    altTitles: ["Orations against the Arians"], author: "athanasius", authorship: "established", school: "patristics",
    genre: "Polemic", textType: "Orations", category: PT, dateStart: 339, dateEnd: 345, dateDisplay: "c. 339–345 CE",
    description: "Athanasius's three orations against Arius and his supporters, defending the eternity of the Son and his sameness of being with the Father, and answering the biblical texts the Arians cited for the Son's subordination.",
    historicalContext: "Written during his second exile, the orations are the fullest statement of the Nicene case before the Council of Constantinople. Bright's edition (1884). A fourth oration, of disputed authorship, is not included.",
    english: "athanasius-against-the-arians",
    files: [F("First1KGreek", "tlg2035.tlg130.1st1K-grc1", "Oration I"), F("First1KGreek", "tlg2035.tlg131.1st1K-grc1", "Oration II"), F("First1KGreek", "tlg2035.tlg132.1st1K-grc1", "Oration III")],
    functions: ["philosophical_work", "creed_confession"],
  },
  {
    slug: "gregory-nazianzen-theological-orations-greek", title: "Orationes Theologicae (Gregory of Nazianzus)", originalTitle: "Λόγοι θεολογικοί",
    altTitles: ["The Five Theological Orations", "Orations 27–31"], author: "gregory-of-nazianzus", authorship: "established", school: "patristics",
    genre: "Oration", textType: "Orations", category: PT, dateStart: 380, dateEnd: 380, dateDisplay: "380 CE",
    description: "Five sermons preached in Constantinople against the Eunomians: on the conditions for speaking about God, on the limits of human knowledge of God, two on the Son, and one on the Holy Spirit. They earned Gregory the title 'the Theologian'.",
    historicalContext: "Delivered in the small Anastasia chapel the year before the Council of Constantinople, at which Gregory briefly presided. Mason's edition (1899).",
    files: [
      F("First1KGreek", "tlg2022.tlg007.1st1K-grc1", "Oration 27: Against the Eunomians"),
      F("First1KGreek", "tlg2022.tlg008.1st1K-grc1", "Oration 28: On Theology"),
      F("First1KGreek", "tlg2022.tlg009.1st1K-grc1", "Oration 29: On the Son"),
      F("First1KGreek", "tlg2022.tlg010.1st1K-grc1", "Oration 30: On the Son"),
      F("First1KGreek", "tlg2022.tlg011.1st1K-grc1", "Oration 31: On the Holy Spirit"),
    ],
    functions: ["sermon_speech", "creed_confession"],
  },
  {
    slug: "eusebius-historia-ecclesiastica-greek", title: "Historia Ecclesiastica (Eusebius)", originalTitle: "Ἐκκλησιαστικὴ ἱστορία",
    altTitles: ["Ecclesiastical History"], author: "eusebius-of-caesarea", authorship: "established", school: "patristics",
    genre: "History", textType: "Church history", category: CH, dateStart: 311, dateEnd: 325, dateDisplay: "c. 311–325 CE",
    description: "The first history of the Church, from Christ to the victory of Constantine, in ten books. Eusebius quotes letters, decrees and lost writers at length, making it the principal source for the first three Christian centuries.",
    historicalContext: "Eusebius, bishop of Caesarea in Palestine, revised the work several times as events unfolded. The text is Dindorf's Teubner edition (1871), chosen over a later transcription for its cleaner digitisation.",
    files: [F("First1KGreek", "tlg2018.tlg002.1st1K-grc2")], functions: ["historical_document", "academic_scholarship"],
  },
  {
    slug: "eusebius-vita-constantini-greek", title: "Vita Constantini (Eusebius)", originalTitle: "Εἰς τὸν βίον τοῦ μακαρίου Κωνσταντίνου βασιλέως",
    altTitles: ["Life of Constantine"], author: "eusebius-of-caesarea", authorship: "established", school: "patristics",
    genre: "Biography", textType: "Panegyrical biography", category: "Biographies", dateStart: 337, dateEnd: 339, dateDisplay: "337–339 CE",
    description: "Eusebius's portrait of Constantine as the model Christian emperor, including his account of the vision of the cross, the Council of Nicaea and the building of the Church of the Holy Sepulchre, with many imperial letters quoted in full.",
    historicalContext: "Left unfinished at Eusebius's death in 339. Heikel's GCS edition (1902).",
    files: [F("First1KGreek", "tlg2018.tlg020.1st1K-grc1")], functions: ["historical_document", "non_canonical_religious_text"],
  },
  {
    slug: "socrates-historia-ecclesiastica-greek", title: "Historia Ecclesiastica (Socrates Scholasticus)", originalTitle: "Ἐκκλησιαστικὴ ἱστορία",
    altTitles: ["Ecclesiastical History"], author: "socrates-scholasticus", authorship: "established", school: "patristics",
    genre: "History", textType: "Church history", category: CH, dateStart: 439, dateEnd: 450, dateDisplay: "c. 439–450 CE",
    description: "A continuation of Eusebius covering 305 to 439 in seven books, notable for its fair treatment of opponents, its use of documents and its account of the Arian controversy and the Council of Nicaea.",
    historicalContext: "Socrates was a lay lawyer of Constantinople. Hussey and Bright's Oxford edition (1893).",
    english: "socrates-scholasticus-church-history", files: [F("First1KGreek", "tlg2057.tlg002.1st1K-grc1")], functions: ["historical_document", "academic_scholarship"],
  },
  {
    slug: "sozomen-historia-ecclesiastica-greek", title: "Historia Ecclesiastica (Sozomen)", originalTitle: "Ἐκκλησιαστικὴ ἱστορία",
    altTitles: ["Ecclesiastical History"], author: "sozomen", authorship: "established", school: "patristics",
    genre: "History", textType: "Church history", category: CH, dateStart: 440, dateEnd: 450, dateDisplay: "c. 440–450 CE",
    description: "A history of the Church from 324 to 425 dedicated to Theodosius II, drawing on Socrates but adding much on monasticism, the Church in Persia and the West.",
    historicalContext: "Sozomen was a lawyer from Gaza working in Constantinople. Hussey's Oxford edition (1860).",
    english: "sozomen-church-history", files: [F("First1KGreek", "tlg2048.tlg001.1st1K-grc1")], functions: ["historical_document", "academic_scholarship"],
  },
  {
    slug: "theodoret-historia-ecclesiastica-greek", title: "Historia Ecclesiastica (Theodoret)", originalTitle: "Ἐκκλησιαστικὴ ἱστορία",
    altTitles: ["Ecclesiastical History"], author: "theodoret-of-cyrrhus", authorship: "established", school: "patristics",
    genre: "History", textType: "Church history", category: CH, dateStart: 449, dateEnd: 450, dateDisplay: "c. 449–450 CE",
    description: "Theodoret's history of the Church from the rise of Arianism to 428, in five books, preserving many documents of the Arian controversy and written from the standpoint of Antioch.",
    historicalContext: "Theodoret, bishop of Cyrrhus in Syria, was a leading Antiochene theologian deposed at Ephesus in 449 and restored at Chalcedon. Schulze's edition (1864).",
    files: [F("First1KGreek", "tlg4089.tlg003.1st1K-grc1")], functions: ["historical_document", "academic_scholarship"],
  },
  // --- Apocrypha and martyr acts -------------------------------------------------
  {
    slug: "acts-of-thomas-greek", title: "Acta Thomae", originalTitle: "Πράξεις Θωμᾶ",
    altTitles: ["The Acts of Thomas"], author: null, authorship: "anonymous", school: "apocryphal-traditions",
    genre: "Apocryphal acts", textType: "Narrative", category: PT, dateStart: 200, dateEnd: 250, dateDisplay: "early 3rd century CE",
    description: "The apocryphal account of the apostle Thomas's mission to India, sold as a slave to King Gundaphorus, preaching continence and dying a martyr's death. It contains the Hymn of the Pearl and early baptismal and eucharistic prayers.",
    historicalContext: "Written in Syriac Edessa and preserved more fully in Greek, the Acts shaped the tradition of Thomas as apostle of India. Bonnet's edition (1903).",
    english: "apocryphal-acts-and-apocalypses", files: [F("First1KGreek", "tlg2038.tlg001.1st1K-grc1")], functions: ["non_canonical_religious_text", "prayer_liturgy"],
  },
  {
    slug: "passio-perpetuae-greek", title: "Passio Perpetuae et Felicitatis (Greek)", originalTitle: "Μαρτύριον τῆς ἁγίας Περπετούας",
    altTitles: ["The Passion of Perpetua and Felicity"], author: null, authorship: "anonymous", school: "early-christianity",
    genre: "Martyrology", textType: "Martyr narrative", category: PT, dateStart: 203, dateEnd: 210, dateDisplay: "early 3rd century CE",
    description: "The Greek version of the account of the young noblewoman Perpetua and the slave Felicity, martyred at Carthage in 203. At its centre is Perpetua's own prison diary with her visions, the earliest surviving writing by a Christian woman.",
    historicalContext: "The Latin text is usually thought original; this Greek version was edited by J. Armitage Robinson (1891). The Latin transcription in the same repository has no section divisions and is not yet imported.",
    files: [F("First1KGreek", "tlg2016.tlg001.1st1K-grc1")], functions: ["non_canonical_religious_text", "historical_document"],
  },
  // --- Latin ---------------------------------------------------------------------
  {
    slug: "augustine-confessiones-latin", title: "Confessiones (Augustine)", originalTitle: "Confessiones",
    altTitles: ["Confessions"], author: "augustine", authorship: "established", school: "patristics",
    genre: "Autobiography", textType: "Confessional narrative", category: PT, dateStart: 397, dateEnd: 400, dateDisplay: "397–400 CE",
    description: "Augustine's account of his life to his conversion and his mother's death, addressed throughout to God as prayer, followed by books on memory, time and the creation narrative of Genesis.",
    historicalContext: "Written soon after he became bishop of Hippo. The Latin is Knöll's edition in the Vienna Corpus (CSEL 33, 1896).",
    english: "augustine-confessions", files: [F("csel-dev", "stoa0040.stoa001.opp-lat1")], functions: ["contemporary_spiritual_writing", "philosophical_work"],
  },
  {
    slug: "augustine-de-civitate-dei-latin", title: "De Civitate Dei (Augustine)", originalTitle: "De civitate Dei contra paganos",
    altTitles: ["The City of God"], author: "augustine", authorship: "established", school: "patristics",
    genre: "Apologetics", textType: "Theological treatise", category: PT, dateStart: 413, dateEnd: 426, dateDisplay: "413–426 CE",
    description: "Augustine's twenty-two books answering the charge that Christianity caused the sack of Rome, and setting out the history of the two cities, earthly and heavenly, from creation to their final ends.",
    historicalContext: "The most influential Latin work of political and historical theology. Hoffmann's CSEL edition (1899–1900).",
    english: "augustine-city-of-god", files: [F("csel-dev", "stoa0040.stoa003.opp-lat3")], functions: ["philosophical_work", "historical_document"],
  },
  {
    slug: "augustine-de-spiritu-et-littera-latin", title: "De Spiritu et Littera (Augustine)", originalTitle: "De spiritu et littera",
    altTitles: ["On the Spirit and the Letter"], author: "augustine", authorship: "established", school: "patristics",
    genre: "Treatise", textType: "Anti-Pelagian treatise", category: PT, dateStart: 412, dateEnd: 412, dateDisplay: "412 CE",
    description: "Augustine's reading of 2 Corinthians 3:6 and Romans: the law commands but only the Spirit gives the love to fulfil it, so righteousness is a gift of grace rather than an achievement of the will.",
    historicalContext: "An early work of the Pelagian controversy, addressed to the tribune Marcellinus, and a key text for the later Reformation debates. Urba and Zycha's CSEL edition (1913).",
    files: [F("csel-dev", "stoa0040.stoa062.opp-lat1")], functions: ["philosophical_work", "commentary_exegesis"],
  },
  {
    slug: "augustine-de-natura-et-gratia-latin", title: "De Natura et Gratia (Augustine)", originalTitle: "De natura et gratia",
    altTitles: ["On Nature and Grace"], author: "augustine", authorship: "established", school: "patristics",
    genre: "Treatise", textType: "Anti-Pelagian treatise", category: PT, dateStart: 415, dateEnd: 415, dateDisplay: "415 CE",
    description: "Augustine's reply to Pelagius's On Nature, arguing that human nature is wounded by sin and cannot be healed or made righteous without grace.",
    historicalContext: "Written after Augustine first read Pelagius's own work. Urba and Zycha's CSEL edition (1913).",
    files: [F("csel-dev", "stoa0040.stoa054.opp-lat1")], functions: ["philosophical_work"],
  },
  {
    slug: "augustine-de-beata-vita-latin", title: "De Beata Vita (Augustine)", originalTitle: "De beata vita",
    altTitles: ["On the Happy Life"], author: "augustine", authorship: "established", school: "patristics",
    genre: "Dialogue", textType: "Philosophical dialogue", category: PT, dateStart: 386, dateEnd: 386, dateDisplay: "386 CE",
    description: "A birthday conversation at Cassiciacum between Augustine, his mother Monica, his son and friends on what makes a life happy, concluding that happiness is to possess God.",
    historicalContext: "One of the dialogues written in the months between Augustine's conversion and baptism. Knöll's CSEL edition (1922).",
    files: [F("csel-dev", "stoa0040.stoa034.opp-lat1")], functions: ["philosophical_work"],
  },
  {
    slug: "tertullian-adversus-marcionem-latin", title: "Adversus Marcionem (Tertullian)", originalTitle: "Adversus Marcionem",
    altTitles: ["Against Marcion"], author: "tertullian", authorship: "established", school: "early-christianity",
    genre: "Polemic", textType: "Refutation", category: PT, dateStart: 207, dateEnd: 208, dateDisplay: "c. 207–208 CE",
    description: "Tertullian's five books against Marcion, who separated the just God of the Old Testament from the good God of Jesus and kept only an edited Luke and ten Pauline letters. Books IV and V go through Marcion's gospel and apostle verse by verse and are the main source for reconstructing them.",
    historicalContext: "Tertullian of Carthage was the first major Christian author in Latin. Oehler's edition (1854).",
    english: "tertullian-against-marcion", files: [F("canonical-latinLit", "stoa0275.stoa006.opp-lat1")], functions: ["philosophical_work", "commentary_exegesis"],
  },
  {
    slug: "tertullian-adversus-praxean-latin", title: "Adversus Praxean (Tertullian)", originalTitle: "Adversus Praxean",
    altTitles: ["Against Praxeas"], author: "tertullian", authorship: "established", school: "early-christianity",
    genre: "Polemic", textType: "Refutation", category: PT, dateStart: 213, dateEnd: 213, dateDisplay: "c. 213 CE",
    description: "Tertullian's attack on the modalism of Praxeas, who 'drove out the Paraclete and crucified the Father'. In it Tertullian first uses trinitas and the formula of one substance in three persons.",
    historicalContext: "Written in Tertullian's Montanist period, the treatise anticipates the vocabulary of later Latin trinitarian theology. Oehler's edition (1854).",
    files: [F("canonical-latinLit", "stoa0275.stoa007.opp-lat1")], functions: ["philosophical_work", "creed_confession"],
  },
  {
    slug: "tertullian-de-praescriptione-latin", title: "De Praescriptione Haereticorum (Tertullian)", originalTitle: "De praescriptione haereticorum",
    altTitles: ["The Prescription against Heretics"], author: "tertullian", authorship: "established", school: "early-christianity",
    genre: "Polemic", textType: "Treatise", category: PT, dateStart: 200, dateEnd: 200, dateDisplay: "c. 200 CE",
    description: "Using a legal plea that bars a case before it is heard, Tertullian argues that heretics have no right to use the scriptures at all, because the scriptures belong to the churches founded by the apostles. It contains his question 'What has Athens to do with Jerusalem?'.",
    historicalContext: "Oehler's edition (1854).",
    files: [F("canonical-latinLit", "stoa0275.stoa024.opp-lat1")], functions: ["philosophical_work", "denominational_guidance"],
  },
  {
    slug: "tertullian-de-baptismo-latin", title: "De Baptismo (Tertullian)", originalTitle: "De baptismo",
    altTitles: ["On Baptism"], author: "tertullian", authorship: "established", school: "early-christianity",
    genre: "Treatise", textType: "Treatise", category: PT, dateStart: 198, dateEnd: 203, dateDisplay: "c. 200 CE",
    description: "The earliest Christian treatise on baptism: the meaning of water, the rite, who may baptise, and Tertullian's counsel that the baptism of children be delayed.",
    historicalContext: "Written against a Cainite teacher who denied the need for baptism. Oehler's edition (1853).",
    files: [F("canonical-latinLit", "stoa0275.stoa011.opp-lat1")], functions: ["prayer_liturgy", "denominational_guidance"],
  },
  {
    slug: "cyprian-de-unitate-latin", title: "De Ecclesiae Catholicae Unitate (Cyprian)", originalTitle: "De ecclesiae catholicae unitate",
    altTitles: ["On the Unity of the Catholic Church"], author: "cyprian", authorship: "established", school: "patristics",
    genre: "Treatise", textType: "Treatise", category: PT, dateStart: 251, dateEnd: 251, dateDisplay: "251 CE",
    description: "Cyprian's argument that the Church is one as the seamless robe of Christ is one, and that 'he cannot have God for his father who does not have the Church for his mother'.",
    historicalContext: "Written during the schisms that followed the Decian persecution; the chapter on Peter survives in two versions. Hartel's CSEL edition (1868).",
    english: "cyprian-treatises", files: [F("csel-dev", "stoa0104a.stoa010.opp-lat1")], functions: ["denominational_guidance", "philosophical_work"],
  },
  {
    slug: "cyprian-de-lapsis-latin", title: "De Lapsis (Cyprian)", originalTitle: "De lapsis",
    altTitles: ["On the Lapsed"], author: "cyprian", authorship: "established", school: "patristics",
    genre: "Treatise", textType: "Treatise", category: "Christian life", dateStart: 251, dateEnd: 251, dateDisplay: "251 CE",
    description: "Cyprian's treatise on Christians who sacrificed or bought certificates during the Decian persecution, setting out the penance required before they could be readmitted to communion.",
    historicalContext: "Hartel's CSEL edition (1868).",
    english: "cyprian-treatises", files: [F("csel-dev", "stoa0104a.stoa007.opp-lat1")], functions: ["denominational_guidance", "historical_document"],
  },
  {
    slug: "cyprian-de-dominica-oratione-latin", title: "De Dominica Oratione (Cyprian)", originalTitle: "De dominica oratione",
    altTitles: ["On the Lord's Prayer"], author: "cyprian", authorship: "established", school: "patristics",
    genre: "Treatise", textType: "Commentary", category: "Christian life", dateStart: 252, dateEnd: 252, dateDisplay: "c. 252 CE",
    description: "A commentary on the Lord's Prayer, clause by clause, with teaching on the times and manner of prayer.",
    historicalContext: "Cyprian drew on Tertullian's earlier treatise on prayer. Hartel's CSEL edition (1868).",
    english: "cyprian-treatises", files: [F("csel-dev", "stoa0104a.stoa015.opp-lat1")], functions: ["prayer_liturgy", "commentary_exegesis"],
  },
  {
    slug: "lactantius-divinae-institutiones-latin", title: "Divinae Institutiones (Lactantius)", originalTitle: "Divinarum institutionum libri VII",
    altTitles: ["The Divine Institutes"], author: "lactantius", authorship: "established", school: "patristics",
    genre: "Apologetics", textType: "Treatise", category: "Apologetics", dateStart: 303, dateEnd: 313, dateDisplay: "c. 303–313 CE",
    description: "The first systematic Latin presentation of Christian teaching, in seven books addressed to educated pagans: false religion, the origin of error, false wisdom, true wisdom, justice, true worship and the blessed life.",
    historicalContext: "Lactantius, a rhetorician called to Nicomedia by Diocletian, wrote during the Great Persecution and later tutored Constantine's son. Brandt and Laubmann's CSEL edition (1890).",
    files: [F("csel-dev", "stoa0171.stoa009.opp-lat1")], functions: ["philosophical_work", "ethical_humanist_manifesto"],
  },
  {
    slug: "lactantius-de-mortibus-persecutorum-latin", title: "De Mortibus Persecutorum (Lactantius)", originalTitle: "De mortibus persecutorum",
    altTitles: ["On the Deaths of the Persecutors"], author: "lactantius", authorship: "established", school: "patristics",
    genre: "History", textType: "Historical pamphlet", category: CH, dateStart: 313, dateEnd: 315, dateDisplay: "c. 314 CE",
    description: "An account of the gruesome ends of the emperors who persecuted Christians, from Nero to Maximinus Daia, which is also a primary source for the Great Persecution, the edict of Milan and Constantine's vision before the Milvian Bridge.",
    historicalContext: "Brandt and Laubmann's CSEL edition (1897); the editor's chapter on the manuscripts is left out.",
    files: [F("csel-dev", "stoa0171.stoa002.opp-lat1")], functions: ["historical_document"],
  },
  {
    slug: "cassian-conlationes-latin", title: "Conlationes (John Cassian)", originalTitle: "Conlationes patrum",
    altTitles: ["The Conferences"], author: "cassian", authorship: "established", school: "patristics",
    genre: "Dialogue", textType: "Monastic conferences", category: "Christian mysticism", dateStart: 420, dateEnd: 429, dateDisplay: "c. 420–429 CE",
    description: "Twenty-four conversations with the monks of the Egyptian desert on the goal of the monastic life, purity of heart, discretion, prayer, chastity, friendship and grace, through which the teaching of the Desert Fathers reached the Latin West.",
    historicalContext: "Cassian founded monasteries at Marseilles; Benedict prescribed the Conferences as reading for his monks. Petschenig's CSEL edition (1886).",
    english: "cassian-conferences", files: [F("csel-dev", "stoa0076c.stoa001.opp-lat2")], functions: ["mystical_contemplative", "denominational_guidance"],
  },
  {
    slug: "cassian-institutiones-latin", title: "De Institutis Coenobiorum (John Cassian)", originalTitle: "De institutis coenobiorum et de octo principalium vitiorum remediis",
    altTitles: ["The Institutes"], author: "cassian", authorship: "established", school: "patristics",
    genre: "Rule", textType: "Monastic rule", category: "Christian life", dateStart: 419, dateEnd: 426, dateDisplay: "c. 420 CE",
    description: "Cassian's description of the dress, prayer and discipline of Egyptian and Palestinian monasteries, followed by eight books on the remedies for the eight principal vices, the source of the later list of seven deadly sins.",
    historicalContext: "Written for Bishop Castor of Apt to guide new monasteries in Gaul. Petschenig's CSEL edition (1888).",
    files: [F("csel-dev", "stoa0076c.stoa002.opp-lat2")], functions: ["denominational_guidance", "mystical_contemplative"],
  },
  {
    slug: "salvian-de-gubernatione-dei-latin", title: "De Gubernatione Dei (Salvian)", originalTitle: "De gubernatione Dei",
    altTitles: ["On the Government of God"], author: "salvian", authorship: "established", school: "patristics",
    genre: "Treatise", textType: "Moral treatise", category: PT, dateStart: 439, dateEnd: 451, dateDisplay: "c. 440 CE",
    description: "Salvian answers the complaint that God has abandoned the Roman world to the barbarians by arguing that the Romans' injustice, cruelty to the poor and vice deserve their fate, and that the barbarians are often more virtuous.",
    historicalContext: "A presbyter of Marseilles, Salvian left a vivid picture of social conditions in fifth-century Gaul. Pauly's CSEL edition (1883).",
    files: [F("csel-dev", "stoa0249a.stoa002.opp-lat1")], functions: ["ethical_humanist_manifesto", "historical_document"],
  },
  {
    slug: "orosius-historiae-latin", title: "Historiae adversus Paganos (Orosius)", originalTitle: "Historiarum adversum paganos libri VII",
    altTitles: ["Seven Books of History against the Pagans"], author: "orosius", authorship: "established", school: "patristics",
    genre: "History", textType: "Universal history", category: CH, dateStart: 416, dateEnd: 418, dateDisplay: "c. 417 CE",
    description: "A universal history from the Flood to 417, written at Augustine's request to show that the disasters of the pre-Christian world were worse than those of the Christian era. It was the standard history of antiquity in the Latin Middle Ages.",
    historicalContext: "Paulus Orosius was a Spanish priest who had studied with Augustine and Jerome. Zangemeister's CSEL edition (1882); the transcription keeps a few uncorrected OCR slips.",
    files: [F("csel-dev", "stoa0215c.stoa001.opp-lat1")], functions: ["historical_document", "academic_scholarship"],
  },
  {
    slug: "sulpicius-vita-martini-latin", title: "Vita Sancti Martini (Sulpicius Severus)", originalTitle: "Vita sancti Martini",
    altTitles: ["The Life of Saint Martin"], author: "sulpicius-severus", authorship: "established", school: "patristics",
    genre: "Hagiography", textType: "Saint's life", category: "Biographies", dateStart: 396, dateEnd: 397, dateDisplay: "c. 396 CE",
    description: "The life of Martin of Tours, the soldier who shared his cloak with a beggar and became monk and bishop, told by a disciple who knew him. It became the model for Latin hagiography.",
    historicalContext: "Written while Martin was still alive and completed after his death in 397. Halm's CSEL edition (1866).",
    files: [F("csel-dev", "stoa0270.stoa002.opp-lat2")], functions: ["historical_document", "non_canonical_religious_text"],
  },
  {
    slug: "boethius-consolatio-latin", title: "De Consolatione Philosophiae (Boethius)", originalTitle: "De consolatione philosophiae",
    altTitles: ["The Consolation of Philosophy"], author: "boethius", authorship: "established", school: "patristics",
    genre: "Dialogue", textType: "Prosimetrum", category: "Philosophy", dateStart: 523, dateEnd: 524, dateDisplay: "c. 524 CE",
    description: "Written in prison while awaiting execution, Boethius's dialogue with Lady Philosophy in alternating prose and verse moves from complaint against fortune to the vision of a providential order and of God's eternal present.",
    historicalContext: "One of the most read books of the Middle Ages, translated by Alfred, Chaucer and Elizabeth I. Stewart and Rand's Loeb edition (1918), which is public domain.",
    english: "boethius-consolation", files: [F("canonical-latinLit", "stoa0058.stoa001.perseus-lat2")], functions: ["philosophical_work", "contemporary_spiritual_writing"],
  },
  {
    slug: "boethius-de-trinitate-latin", title: "De Trinitate (Boethius)", originalTitle: "Quomodo Trinitas unus Deus ac non tres dii",
    altTitles: ["On the Trinity"], author: "boethius", authorship: "established", school: "patristics",
    genre: "Treatise", textType: "Theological tractate", category: PT, dateStart: 519, dateEnd: 523, dateDisplay: "c. 520 CE",
    description: "A short tractate applying Aristotle's categories to explain how Father, Son and Spirit are one God and not three, dedicated to Boethius's father-in-law Symmachus.",
    historicalContext: "The theological tractates shaped scholastic method; Aquinas wrote a commentary on this one. Stewart and Rand's Loeb edition (1918).",
    english: "boethius-trinity", files: [F("canonical-latinLit", "stoa0058.stoa025.perseus-lat1")], functions: ["philosophical_work", "creed_confession"],
  },
];

const AUTHORS = [
  { slug: "clement-of-rome", name: "Clement of Rome", sort_name: "Clement of Rome", birth_year: null, death_year: 99, date_display: "fl. c. 96", description: "Early bishop of Rome to whom tradition attributes the letter of the Roman church to the Corinthians.", is_attributed: true },
  { slug: "ignatius-of-antioch", name: "Ignatius of Antioch", sort_name: "Ignatius of Antioch", birth_year: null, death_year: 115, date_display: "d. c. 110–115", description: "Bishop of Antioch who wrote seven letters to churches on his way to martyrdom in Rome.", is_attributed: false },
  { slug: "polycarp", name: "Polycarp of Smyrna", sort_name: "Polycarp of Smyrna", birth_year: 69, death_year: 155, date_display: "c. 69–c. 155", description: "Bishop of Smyrna, remembered as a disciple of John and teacher of Irenaeus, martyred in old age.", is_attributed: false },
  { slug: "hermas", name: "Hermas", sort_name: "Hermas", birth_year: null, death_year: null, date_display: "2nd century", description: "Roman Christian, said by the Muratorian fragment to be the brother of Bishop Pius, author of The Shepherd.", is_attributed: true },
  { slug: "athenagoras", name: "Athenagoras of Athens", sort_name: "Athenagoras of Athens", birth_year: 133, death_year: 190, date_display: "c. 133–c. 190", description: "Athenian philosopher and Christian apologist, author of A Plea for the Christians.", is_attributed: false },
  { slug: "theophilus-of-antioch", name: "Theophilus of Antioch", sort_name: "Theophilus of Antioch", birth_year: null, death_year: 185, date_display: "d. c. 183–185", description: "Bishop of Antioch and apologist, author of the three books To Autolycus.", is_attributed: false },
  { slug: "tatian", name: "Tatian the Assyrian", sort_name: "Tatian", birth_year: 120, death_year: 180, date_display: "c. 120–c. 180", description: "Syrian student of Justin, author of the Address to the Greeks and the gospel harmony known as the Diatessaron.", is_attributed: false },
  { slug: "clement-of-alexandria", name: "Clement of Alexandria", sort_name: "Clement of Alexandria", birth_year: 150, death_year: 215, date_display: "c. 150–c. 215", description: "Teacher in Alexandria who read Greek philosophy as a preparation for the gospel; author of the Protrepticus, Paedagogus and Stromata.", is_attributed: false },
  { slug: "methodius-of-olympus", name: "Methodius of Olympus", sort_name: "Methodius of Olympus", birth_year: null, death_year: 311, date_display: "d. c. 311", description: "Bishop in Lycia and critic of Origen, author of the Symposium of the Ten Virgins.", is_attributed: false },
  { slug: "eusebius-of-caesarea", name: "Eusebius of Caesarea", sort_name: "Eusebius of Caesarea", birth_year: 260, death_year: 339, date_display: "c. 260–339", description: "Bishop of Caesarea in Palestine, scholar and historian, author of the Ecclesiastical History and the Life of Constantine.", is_attributed: false },
  { slug: "gregory-of-nazianzus", name: "Gregory of Nazianzus", sort_name: "Gregory of Nazianzus", birth_year: 329, death_year: 390, date_display: "c. 329–390", description: "Cappadocian bishop, orator and poet, called 'the Theologian' for his orations on the Trinity.", is_attributed: false },
  { slug: "theodoret-of-cyrrhus", name: "Theodoret of Cyrrhus", sort_name: "Theodoret of Cyrrhus", birth_year: 393, death_year: 458, date_display: "c. 393–c. 458", description: "Bishop of Cyrrhus in Syria, Antiochene theologian, exegete and church historian.", is_attributed: false },
  { slug: "lactantius", name: "Lactantius", sort_name: "Lactantius, Lucius Caecilius Firmianus", birth_year: 250, death_year: 325, date_display: "c. 250–c. 325", description: "North African rhetorician and Christian apologist, tutor to Constantine's son Crispus, author of the Divine Institutes.", is_attributed: false },
  { slug: "salvian", name: "Salvian of Marseilles", sort_name: "Salvian of Marseilles", birth_year: 400, death_year: 490, date_display: "c. 400–after 470", description: "Presbyter of Marseilles, author of On the Government of God.", is_attributed: false },
  { slug: "orosius", name: "Paulus Orosius", sort_name: "Orosius, Paulus", birth_year: 375, death_year: 420, date_display: "c. 375–after 418", description: "Spanish priest and historian, student of Augustine, author of the Seven Books of History against the Pagans.", is_attributed: false },
  { slug: "sulpicius-severus", name: "Sulpicius Severus", sort_name: "Sulpicius Severus", birth_year: 363, death_year: 425, date_display: "c. 363–c. 425", description: "Aquitanian aristocrat and ascetic, biographer of Martin of Tours and author of a sacred history.", is_attributed: false },
];

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

const meta = readJson(META);
const streams = readJson(STREAMS);
const functions = readJson(FUNCTIONS);
const previousManifest = existsSync(MANIFEST) ? readJson(MANIFEST) : null;
const manifest: any = {
  source: "open-greek-and-latin",
  retrieved_at: RETRIEVED_AT,
  note: "",
  hosts: [],
  works: only.size ? (previousManifest?.works ?? []) : [],
  failures: [],
};

function ensureMeta() {
  for (const author of AUTHORS) {
    if (!meta.authors.some((a: any) => a.slug === author.slug)) meta.authors.push(author);
  }
  if (!meta.sources.some((s: any) => s.slug === "open-greek-and-latin")) {
    meta.sources.push({
      slug: "open-greek-and-latin",
      name: "Open Greek and Latin / Perseus Digital Library",
      provider: "Open Greek and Latin Project (Leipzig) and the Perseus Digital Library (Tufts)",
      url: "https://github.com/OpenGreekAndLatin",
      description:
        "TEI transcriptions of Greek and Latin texts from the First Thousand Years of Greek, the CSEL digitisation and Perseus's canonical repositories, used here for the Greek and Latin originals of early Christian writers.",
      access_notes:
        "Distributed under CC BY-SA 4.0. The underlying print editions imported here are public domain; the transcriptions are held locally with attribution and the same licence.",
      retrieved_at: RETRIEVED_AT,
      is_live: 0,
      status: "connected",
    });
  }
  writeFileSync(META, `${JSON.stringify(meta, null, 2)}\n`);
}

function ensureRegistry() {
  const registry = readJson(REGISTRY);
  const sources: any[] = registry.sources ?? registry;
  if (sources.some((s) => s.source_id === "open-greek-and-latin")) return;
  sources.push({
    source_id: "open-greek-and-latin",
    source_name: "Open Greek and Latin / Perseus Digital Library",
    base_url: "https://github.com/OpenGreekAndLatin",
    organisation: "Open Greek and Latin Project (Leipzig) and Perseus Digital Library (Tufts)",
    traditions_covered: ["christianity", "greek-roman"],
    schools_covered: ["early-christianity", "patristics", "apocryphal-traditions"],
    languages: ["grc", "la"],
    source_type: "academic corpus",
    content_types: ["primary_text"],
    api_documentation_url: "https://github.com/OpenGreekAndLatin/First1KGreek/wiki",
    download_url: "https://github.com/OpenGreekAndLatin/First1KGreek",
    access_method: "TEI XML files over HTTPS from the GitHub repositories First1KGreek, csel-dev, canonical-greekLit and canonical-latinLit; no key",
    licence_url: "https://creativecommons.org/licenses/by-sa/4.0/",
    licence_status: "cc_by_sa_4_0",
    commercial_use_allowed: true,
    redistribution_allowed: true,
    attribution_requirements:
      "Credit the project, the repository file and the print edition it transcribes; derivatives are shared under CC BY-SA 4.0.",
    authentication_required: false,
    rate_limits: "GitHub raw content; no published limit for ordinary use",
    ingestion_status: "import_tested",
    last_verified_at: RETRIEVED_AT,
    source_reliability_notes:
      "Each file names its print edition and editor in the TEI header. First1KGreek and Perseus files are corrected transcriptions; the csel-dev and 'opp' files are OCR transcriptions of nineteenth-century editions with the apparatus separated out, and keep occasional uncorrected OCR slips. Only files whose print edition is from before 1930 are imported, so the critical text is public domain; Loeb-based files from 1930 on are recorded in the acquisition register instead.",
    editorial_notes:
      "Imported 2026-11-19 by scripts/dev/import-ogl.ts: footnotes and apparatus are dropped, the top citation level becomes the chapter and the lowest becomes the passage, long passages are split at sentence ends. Text is held locally.",
    priority: 1,
    approval_status: "approved",
  });
  writeFileSync(REGISTRY, `${JSON.stringify({ ...registry, sources }, null, 2)}\n`);
}

async function getText(f: FileRef): Promise<string> {
  const cached = join(CACHE, `${f.urn}.xml`);
  if (existsSync(cached)) return readFileSync(cached, "utf8");
  if (offline) throw new Error(`${f.urn} is not cached and --offline was given`);
  const url = rawUrl(f);
  let last: Error | null = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(120_000) });
      if (res.status === 404) throw new Error(`${url} returned 404`);
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      const text = await res.text();
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(cached, text);
      return text;
    } catch (err) {
      last = err as Error;
      if (attempt < 4) await Bun.sleep(800 * attempt);
    }
  }
  throw last ?? new Error(`${url} failed`);
}

function printEdition(xml: string): { editor: string; year: number | null; title: string } {
  const source = xml.slice(xml.indexOf("<sourceDesc"), xml.indexOf("</sourceDesc>"));
  const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const editors = [...source.matchAll(/<editor[^>]*>([\s\S]*?)<\/editor>/g)].map((m) => strip(m[1]!)).filter(Boolean);
  const years = [...source.matchAll(/<date[^>]*>\s*(\d{4})/g)].map((m) => Number(m[1]));
  const title = strip(source.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? "");
  return { editor: [...new Set(editors)].join(" and "), year: years.length ? Math.max(...years) : null, title };
}

function hasLicence(xml: string, repo: Repo): string {
  const m = xml.match(/<licence[^>]*target="([^"]+)"/);
  if (m) return m[1]!;
  // Older Perseus files carry no <licence>; the repository licence covers them.
  if (repo === "canonical-latinLit" || repo === "canonical-greekLit") return "https://creativecommons.org/licenses/by-sa/4.0/ (repository licence)";
  return "";
}

const WORD = /\p{L}+/gu;
function validate(spec: Spec, chapters: { label: string; passages: { text: string }[] }[], language: string) {
  if (chapters.length < 2 && spec.files.length < 2) {
    if (!chapters.length || chapters[0]!.passages.length < 5) throw new Error(`only ${chapters.length} chapter(s) were recovered`);
  }
  const empty = chapters.filter((c) => !c.passages.length);
  if (empty.length) throw new Error(`${empty.length} chapters have no text`);
  const text = chapters.flatMap((c) => c.passages.map((p) => p.text)).join(" ");
  const words = text.match(WORD)?.length ?? 0;
  if (words < 1_000) throw new Error(`only ${words} words were recovered`);
  const greek = (text.match(/[Ͱ-Ͽἀ-῿]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (language === "grc" && greek < latin) throw new Error("the recovered text does not look like Greek");
  if (language === "la" && latin < greek * 4) throw new Error("the recovered text does not look like Latin");
  return words;
}

async function build(spec: Spec) {
  const parts: { file: FileRef; chapters: TeiChapter[]; editor: string; year: number | null; printTitle: string; licence: string }[] = [];
  let language = "";
  for (const file of spec.files) {
    const xml = await getText(file);
    const licence = hasLicence(xml, file.repo);
    if (!/creativecommons\.org\/licenses\/by-sa\//.test(licence)) throw new Error(`${file.urn} carries no CC BY-SA licence`);
    const print = printEdition(xml);
    if (!print.year || print.year > LATEST_PRINT_YEAR) {
      throw new Error(`${file.urn} reproduces a print edition of ${print.year ?? "unknown date"}; only editions before ${LATEST_PRINT_YEAR + 1} are imported`);
    }
    const tei = readTei(xml);
    const lang = tei.language === "lat" ? "la" : tei.language === "grc" ? "grc" : tei.language;
    if (lang !== "la" && lang !== "grc") throw new Error(`${file.urn} is in ${tei.language || "an unstated language"}`);
    if (language && language !== lang) throw new Error("files of one work are in different languages");
    language = lang;
    parts.push({ file, chapters: tei.chapters, editor: print.editor || tei.editor, year: print.year, printTitle: print.title, licence });
  }

  // A work made of several files (Gregory's five orations) takes each file as
  // one chapter; a single file keeps its own top-level divisions.
  const chapters =
    parts.length > 1
      ? parts.map((p) => ({
          label: p.file.label ?? p.file.urn,
          passages: p.chapters.flatMap((c) => c.passages.map((x) => ({ cite: x.cite, text: x.text, label: `${p.file.label ?? ""}, ${c.label.replace(/:.*$/, "")}${x.cite.includes(".") ? ` §${x.cite.split(".").slice(1).join(".")}` : ""}` }))),
        }))
      : parts[0]!.chapters.map((c) => ({
          label: c.label,
          passages: c.passages.map((x) => ({ cite: x.cite, text: x.text, label: `${c.label.replace(/:.*$/, "")}${x.cite.includes(".") || x.cite.includes(" ") ? `, ${x.cite.replace(/^[^.\s]+[.\s]?/, "")}` : ""}` })),
        }));
  const words = validate(spec, chapters, language);

  const chaptersOut = chapters.map((c, i) => ({ ref: String(i + 1), label: c.label.length > 90 ? `${c.label.slice(0, 87).trimEnd()}…` : c.label }));
  const passagesOut = chapters.flatMap((c, i) =>
    c.passages.map((p, j) => ({
      reference: `${i + 1}.${j + 1}`,
      label: p.label.replace(/,\s*$/, "") || `${chaptersOut[i]!.label} §${j + 1}`,
      chapterRef: String(i + 1),
    })),
  );
  const texts: Record<string, string> = {};
  chapters.forEach((c, i) => c.passages.forEach((p, j) => (texts[`${i + 1}.${j + 1}`] = p.text)));

  const editors = [...new Set(parts.map((p) => p.editor).filter(Boolean))].join("; ");
  const year = Math.max(...parts.map((p) => p.year ?? 0)) || null;
  const projects = [...new Set(parts.map((p) => PROJECT[p.file.repo]))].join(" and ");
  const files = parts.map((p) => `${p.file.repo}/${p.file.urn}`);
  const languageName = language === "grc" ? "Greek" : "Latin";
  const ocr = parts.some((p) => /opp-/.test(p.file.urn));
  const editionSlug = `${spec.slug}-${language}-ogl`;
  const englishNote = spec.english
    ? ` The library's English translation of this work is catalogued separately (${spec.english}).`
    : "";

  const work = {
    slug: spec.slug,
    title: spec.title,
    originalTitle: spec.originalTitle,
    transliteration: "",
    altTitles: spec.altTitles,
    tradition: "christianity",
    school: spec.school,
    genre: spec.genre,
    textType: spec.textType,
    category: spec.category,
    subcategory: `${languageName} original`,
    originalLanguage: language,
    dateStart: spec.dateStart,
    dateEnd: spec.dateEnd,
    dateDisplay: spec.dateDisplay,
    authorshipStatus: spec.authorship,
    author: spec.author,
    attributionNote:
      spec.authorship === "anonymous"
        ? "The work is anonymous; the title is the one the manuscript tradition gives it."
        : spec.authorship === "disputed"
          ? "The attribution is traditional and disputed; the work is catalogued under the name the tradition gives it."
          : "The attribution is the one the manuscript tradition and the scholarship give.",
    description: spec.description,
    historicalContext: spec.historicalContext,
    availabilityNote:
      `${languageName} original, held in the library: ${chapters.length} chapter(s), ${passagesOut.length} passages, ` +
      `${words.toLocaleString("en-GB")} words, transcribed by ${projects} from ${editors || "the print edition"}${year ? ` (${year})` : ""}.` +
      englishNote +
      " No English translation is attached to this record.",
    featured: false,
    featuredNote: "",
    refScheme: "chapter.paragraph",
    isSample: false,
    chapters: chaptersOut,
    passages: passagesOut,
    editions: [
      {
        slug: editionSlug,
        language,
        editionType: "original",
        title: `${spec.originalTitle} — ${languageName} text, ed. ${editors || "unnamed editor"}${year ? ` (${year})` : ""}`,
        translator: "",
        publisher: projects,
        publicationYear: year,
        source: "open-greek-and-latin",
        license: "cc-by-sa",
        rightsStatus:
          `The ${languageName} work and the ${year ?? "pre-1930"} print edition are public domain. The digital transcription is ` +
          `distributed by ${projects} under CC BY-SA 4.0, and this copy is shared under the same licence.`,
        attributionText:
          `${spec.originalTitle}, ${languageName} text edited by ${editors || "an unnamed editor"}${year ? ` (${year})` : ""}. ` +
          `Digital transcription by ${projects} (${files.join(", ")}), CC BY-SA 4.0.`,
        structureScheme:
          "chapter and passage; chapters follow the edition's top citation level and passages its lowest, with long passages divided at sentence ends",
        isSample: false,
        texts,
        notes:
          `Imported from ${files.map((f) => `https://github.com/${f.replace(/\//, "/").replace(/^/, "")}`).length === 1 ? blobUrl(parts[0]!.file) : parts.map((p) => blobUrl(p.file)).join(", ")}. ` +
          "Footnotes, the critical apparatus and running heads are left out." +
          (ocr ? " The transcription was made by OCR from the printed edition and keeps occasional uncorrected slips." : ""),
      },
    ],
  };
  writeFileSync(join(WORKS, `${spec.slug}.json`), `${JSON.stringify(work, null, 2)}\n`);
  delete streams.works[spec.slug];
  functions.works[spec.slug] = {
    functions: spec.functions,
    status: "provisional",
    assignedBy: "UWL editors (comparative taxonomy)",
    note: `${spec.title} — ${spec.category}. ${languageName} original from ${projects}.`,
  };
  const entry = {
    slug: spec.slug,
    host: "open-greek-and-latin",
    upstream: files.join(", "),
    language,
    edition: `${editors}${year ? ` (${year})` : ""}`,
    chapters: chaptersOut.length,
    passages: passagesOut.length,
    words,
  };
  const index = manifest.works.findIndex((w: any) => w.slug === spec.slug);
  if (index >= 0) manifest.works[index] = entry;
  else manifest.works.push(entry);
  console.log(`  ${spec.slug}: ${chaptersOut.length} chapters, ${passagesOut.length} passages, ${words} words (${language})`);
}

ensureMeta();
ensureRegistry();
for (const spec of SPECS) {
  if (only.size && !only.has(spec.slug)) continue;
  try {
    await build(spec);
  } catch (err) {
    console.error(`  ! ${spec.slug}: ${(err as Error).message}`);
    manifest.failures.push({ slug: spec.slug, reason: (err as Error).message });
  }
}
manifest.note =
  "Greek and Latin originals of early Christian texts, held locally under CC BY-SA 4.0. Each work records its repository file and the public-domain print edition it transcribes.";
manifest.hosts = [
  { id: "open-greek-and-latin", name: "Open Greek and Latin / Perseus Digital Library", url: "https://github.com/OpenGreekAndLatin", licence: "CC BY-SA 4.0" },
];
manifest.totals = {
  works: manifest.works.length,
  chapters: manifest.works.reduce((n: number, w: any) => n + w.chapters, 0),
  passages: manifest.works.reduce((n: number, w: any) => n + w.passages, 0),
  words: manifest.works.reduce((n: number, w: any) => n + (w.words ?? 0), 0),
};
writeFileSync(STREAMS, `${JSON.stringify(streams, null, 2)}\n`);
writeFileSync(FUNCTIONS, `${JSON.stringify(functions, null, 2)}\n`);
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${manifest.totals.works} works, ${manifest.totals.chapters} chapters, ${manifest.totals.passages} passages, ${manifest.totals.words} words.`);
if (manifest.failures.length) {
  console.error(`${manifest.failures.length} work(s) failed.`);
  process.exitCode = 1;
}
