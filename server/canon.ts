/**
 * Canonical shelf order.
 *
 * Alphabetical ordering is wrong for the shelf: a Tanakh that opens with Amos
 * and ends with Zephaniah, or a Mishnah that runs Arakhin to Zevachim, breaks
 * the reading sequence the tradition itself uses. The lists below restore the
 * conventional order (Torah → Nevi'im → Ketuvim; the six sedarim and their
 * tractates) so the browser reads like a shelf rather than an index.
 *
 * Nothing here is a claim about canonicity or authority: it is the order in
 * which these collections are conventionally printed and studied.
 */

/** Torah, Nevi'im, Ketuvim — the 39 books in traditional order. */
const TANAKH_BOOKS = [
  "genesis",
  "exodus",
  "leviticus",
  "numbers",
  "deuteronomy",
  "joshua",
  "judges",
  "i-samuel",
  "ii-samuel",
  "i-kings",
  "ii-kings",
  "isaiah",
  "jeremiah",
  "ezekiel",
  "hosea",
  "joel",
  "amos",
  "obadiah",
  "jonah",
  "micah",
  "nahum",
  "habakkuk",
  "zephaniah",
  "haggai",
  "zechariah",
  "malachi",
  "psalms",
  "proverbs",
  "job",
  "song-of-songs",
  "ruth",
  "lamentations",
  "ecclesiastes",
  "esther",
  "daniel",
  "ezra",
  "nehemiah",
  "i-chronicles",
  "ii-chronicles",
];

/**
 * The Christian Old Testament as it is printed: Pentateuch, historical books,
 * wisdom and poetry, prophets. This is not the Jewish order (Torah, Prophets,
 * Writings); a Christian Bible shelves the prophets last.
 */
const OLD_TESTAMENT_BOOKS = [
  "bible-genesis",
  "bible-exodus",
  "bible-leviticus",
  "bible-numbers",
  "bible-deuteronomy",
  "bible-joshua",
  "bible-judges",
  "bible-ruth",
  "bible-1-samuel",
  "bible-2-samuel",
  "bible-1-kings",
  "bible-2-kings",
  "bible-1-chronicles",
  "bible-2-chronicles",
  "bible-ezra",
  "bible-nehemiah",
  "bible-esther",
  "bible-job",
  "bible-psalms",
  "bible-proverbs",
  "bible-ecclesiastes",
  "bible-song-of-solomon",
  "bible-isaiah",
  "bible-jeremiah",
  "bible-lamentations",
  "bible-ezekiel",
  "bible-daniel",
  "bible-hosea",
  "bible-joel",
  "bible-amos",
  "bible-obadiah",
  "bible-jonah",
  "bible-micah",
  "bible-nahum",
  "bible-habakkuk",
  "bible-zephaniah",
  "bible-haggai",
  "bible-zechariah",
  "bible-malachi",
];

/**
 * The New Testament in printed order. The gospels come first, then Acts, the
 * Pauline letters (Romans through Hebrews), the general letters, Revelation.
 */
const NEW_TESTAMENT_BOOKS = [
  "bible-matthew",
  "bible-mark",
  "bible-luke",
  "bible-john",
  "bible-acts",
  "bible-romans",
  "bible-1-corinthians",
  "bible-2-corinthians",
  "bible-galatians",
  "bible-ephesians",
  "bible-philippians",
  "bible-colossians",
  "bible-1-thessalonians",
  "bible-2-thessalonians",
  "bible-1-timothy",
  "bible-2-timothy",
  "bible-titus",
  "bible-philemon",
  "bible-hebrews",
  "bible-james",
  "bible-1-peter",
  "bible-2-peter",
  "bible-1-john",
  "bible-2-john",
  "bible-3-john",
  "bible-jude",
  "bible-revelation",
];

/** The six collections Sunni tradition receives, in the order it lists them. */
const HADITH_COLLECTIONS = [
  "hadith-bukhari",
  "hadith-muslim",
  "hadith-abu-dawud",
  "hadith-tirmidhi",
  "hadith-nasai",
  "hadith-ibn-majah",
];

/** The six orders of the Mishnah, in sequence. */
const SEDARIM = ["Zeraim", "Moed", "Nashim", "Nezikin", "Kodashim", "Tahorot"];

/** Tractates in Mishnah order, arranged by seder. */
const TRACTATES: Record<string, string[]> = {
  Zeraim: [
    "Berakhot",
    "Peah",
    "Demai",
    "Kilayim",
    "Sheviit",
    "Terumot",
    "Maasrot",
    "Maaser Sheni",
    "Challah",
    "Orlah",
    "Bikkurim",
  ],
  Moed: [
    "Shabbat",
    "Eruvin",
    "Pesachim",
    "Shekalim",
    "Yoma",
    "Sukkah",
    "Beitzah",
    "Rosh Hashanah",
    "Taanit",
    "Megillah",
    "Moed Katan",
    "Chagigah",
  ],
  Nashim: ["Yevamot", "Ketubot", "Nedarim", "Nazir", "Sotah", "Gittin", "Kiddushin"],
  Nezikin: [
    "Bava Kamma",
    "Bava Metzia",
    "Bava Batra",
    "Sanhedrin",
    "Makkot",
    "Shevuot",
    "Eduyot",
    "Avodah Zarah",
    "Pirkei Avot",
    "Horayot",
  ],
  Kodashim: [
    "Zevachim",
    "Menachot",
    "Chullin",
    "Bekhorot",
    "Arakhin",
    "Temurah",
    "Keritot",
    "Meilah",
    "Tamid",
    "Middot",
    "Kinnim",
  ],
  Tahorot: [
    "Kelim",
    "Oholot",
    "Negaim",
    "Parah",
    "Tahorot",
    "Mikvaot",
    "Niddah",
    "Makhshirin",
    "Zavim",
    "Tevul Yom",
    "Yadayim",
    "Oktzin",
  ],
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’'"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Midrash Rabbah follows the Torah portions first, then the Five Megillot —
 * the order in which the volumes are printed, not the alphabet.
 */
const MIDRASH_RABBAH = [
  "midrash-bereshit-rabbah",
  "midrash-shemot-rabbah",
  "midrash-vayikra-rabbah",
  "midrash-bamidbar-rabbah",
  "midrash-devarim-rabbah",
  "midrash-shir-hashirim-rabbah",
  "midrash-ruth-rabbah",
  "midrash-ruth-rabbah-lerner",
  "midrash-eikhah-rabbah",
  "midrash-kohelet-rabbah",
  "midrash-esther-rabbah",
];

const MISHNEH_TORAH_SECTIONS = [
  "Transmission of the Oral Law",
  "Positive Mitzvot",
  "Negative Mitzvot",
  "Overview of Mishneh Torah Contents",
  "Foundations of the Torah",
  "Human Dispositions",
  "Torah Study",
  "Foreign Worship and Customs of the Nations",
  "Repentance",
  "Reading the Shema",
  "Prayer and the Priestly Blessing",
  "Tefillin, Mezuzah and the Torah Scroll",
  "Fringes",
  "Blessings",
  "Circumcision",
  "The Order of Prayer",
  "Sabbath",
  "Eruvin",
  "Rest on the Tenth of Tishrei",
  "Rest on a Holiday",
  "Leavened and Unleavened Bread",
  "Shofar, Sukkah and Lulav",
  "Sheqel Dues",
  "Sanctification of the New Month",
  "Fasts",
  "Scroll of Esther and Hanukkah",
  "Marriage",
  "Divorce",
  "Levirate Marriage and Release",
  "Virgin Maiden",
  "Woman Suspected of Infidelity",
  "Forbidden Intercourse",
  "Forbidden Foods",
  "Ritual Slaughter",
  "Oaths",
  "Vows",
  "Nazariteship",
  "Appraisals and Devoted Property",
  "Diverse Species",
  "Gifts to the Poor",
  "Heave Offerings",
  "Tithes",
  "Second Tithes and Fourth Year's Fruit",
  "First Fruits and other Gifts to Priests Outside the Sanctuary",
  "Sabbatical Year and the Jubilee",
  "The Chosen Temple",
  "Vessels of the Sanctuary and Those Who Serve Therein",
  "Admission into the Sanctuary",
  "Things Forbidden on the Altar",
  "Sacrificial Procedure",
  "Daily Offerings and Additional Offerings",
  "Sacrifices Rendered Unfit",
  "Service on the Day of Atonement",
  "Trespass",
  "Paschal Offering",
  "Festival Offering",
  "Firstlings",
  "Offerings for Unintentional Transgressions",
  "Offerings for Those with Incomplete Atonement",
  "Substitution",
  "Defilement by a Corpse",
  "Red Heifer",
  "Defilement by Leprosy",
  "Those Who Defile Bed or Seat",
  "Other Sources of Defilement",
  "Defilement of Foods",
  "Vessels",
  "Immersion Pools",
  "Damages to Property",
  "Theft",
  "Robbery and Lost Property",
  "One Who Injures a Person or Property",
  "Murderer and the Preservation of Life",
  "Sales",
  "Ownerless Property and Gifts",
  "Neighbors",
  "Agents and Partners",
  "Slaves",
  "Hiring",
  "Borrowing and Deposit",
  "Creditor and Debtor",
  "Plaintiff and Defendant",
  "Inheritances",
  "The Sanhedrin and the Penalties within Their Jurisdiction",
  "Testimony",
  "Rebels",
  "Mourning",
  "Kings and Wars",
];

const TANAKH_RANK = new Map(TANAKH_BOOKS.map((slug, i) => [slug, i]));
const OLD_TESTAMENT_RANK = new Map(OLD_TESTAMENT_BOOKS.map((slug, i) => [slug, i]));
const NEW_TESTAMENT_RANK = new Map(NEW_TESTAMENT_BOOKS.map((slug, i) => [slug, i]));
const HADITH_RANK = new Map(HADITH_COLLECTIONS.map((slug, i) => [slug, i]));
const MIDRASH_RANK = new Map(MIDRASH_RABBAH.map((slug, i) => [slug, i]));
const MISHNEH_TORAH_RANK = new Map(MISHNEH_TORAH_SECTIONS.map((title, i) => [title, i]));
const SEDER_RANK = new Map(SEDARIM.map((name, i) => [name.toLowerCase(), i]));

const TRACTATE_RANK = new Map<string, number>();
{
  let position = 0;
  for (const seder of SEDARIM) {
    for (const name of TRACTATES[seder]) {
      TRACTATE_RANK.set(slugify(name), position);
      position += 1;
    }
  }
  // Printed editions sometimes shorten Pirkei Avot to Avot; both resolve.
  TRACTATE_RANK.set("avot", TRACTATE_RANK.get("pirkei-avot") ?? position);
}

/** Subcategory headings, in reading order, per category. */
const SUBCATEGORY_ORDER: Record<string, string[]> = {
  Tanakh: ["Torah", "Prophets (Nevi'im)", "Writings (Ketuvim)"],
  "Old Testament": ["Torah / Pentateuch", "Historical Books", "Wisdom and Poetry", "Prophets"],
  "New Testament": ["Gospels", "History", "Pauline Epistles", "General Epistles", "Apocalypse"],
  Hadith: ["The six canonical collections"],
  "Jurisprudence (Fiqh)": ["Early legal compendia", "Classical manuals"],
  Mishnah: SEDARIM,
  Tosefta: SEDARIM.map((name) => `Seder ${name}`),
  Talmud: ["Bavli", "Yerushalmi"],
  Midrash: ["Midrash Rabbah", "Halakhah", "Aggadah", "Modern Texts"],
  Halakhah: [
    "Mishneh Torah",
    "Tur",
    "Shulchan Arukh",
    "Shulchan Arukh HaRav",
    "Sifrei Mitzvot",
    "Rishonim",
    "Acharonim",
    "Modern",
  ],
  Kabbalah: [
    "Sefer Yetzirah",
    "Zohar",
    "Ramak",
    "Ramchal",
    "Arizal and Chaim Vital",
    "Baal HaSulam",
    "Other Kabbalah Works",
  ],
  Liturgy: ["Siddur", "Haggadah", "High Holidays", "Piyutim", "Other Liturgy Works"],
  "Jewish Thought": ["Rishonim", "Acharonim", "Modern", "Guide for the Perplexed"],
  Chasidut: [
    "Early Works",
    "Breslov",
    "Chabad",
    "Izhbitz",
    "R' Tzadok HaKohen",
    "Piaseczno Rebbe",
    "Other Chasidut Works",
  ],
  Musar: ["Rishonim", "Acharonim", "Modern"],
  Responsa: ["Geonim", "Rishonim", "Acharonim", "Modern"],
  "Second Temple": ["Apocrypha", "Philo", "Josephus"],
  Reference: ["Dictionary", "Grammar", "Encyclopedic Works"],
};

/** Strip the collection prefix from a tractate slug. */
function tractateKey(slug: string): string {
  return slug
    .replace(/^yerushalmi-jerusalem-talmud-/, "")
    .replace(/^(mishnah|tosefta|talmud|yerushalmi)-/, "");
}

function sederKey(subcategory: string): string {
  return subcategory.replace(/^seder\s+/i, "").trim().toLowerCase();
}

function subcategoryRank(category: string, subcategory: string): number | null {
  const order = SUBCATEGORY_ORDER[category];
  if (!order) return null;
  const direct = order.findIndex((entry) => entry.toLowerCase() === subcategory.trim().toLowerCase());
  if (direct !== -1) return direct;
  // Tosefta uses "Seder Zeraim" while the Mishnah shelf says "Zeraim".
  const bySeder = order.findIndex((entry) => sederKey(entry) === sederKey(subcategory));
  return bySeder === -1 ? null : bySeder;
}

function workRank(category: string, slug: string, title: string): number | null {
  if (category === "Tanakh") return TANAKH_RANK.get(slug) ?? null;
  if (category === "Old Testament") return OLD_TESTAMENT_RANK.get(slug) ?? null;
  if (category === "New Testament") return NEW_TESTAMENT_RANK.get(slug) ?? null;
  if (category === "Hadith") return HADITH_RANK.get(slug) ?? null;
  if (category === "Midrash") return MIDRASH_RANK.get(slug) ?? null;
  if (category === "Halakhah") {
    // The Mishneh Torah's 14 books are printed in a fixed order that has
    // nothing to do with the alphabet; each section is a separate work here.
    const section = /^Mishneh Torah,\s*(.+)$/.exec(title);
    if (section) return MISHNEH_TORAH_RANK.get(section[1]) ?? null;
  }
  if (category === "Mishnah" || category === "Talmud" || category === "Tosefta") {
    return TRACTATE_RANK.get(tractateKey(slug)) ?? null;
  }
  return null;
}

type ShelfWork = { slug: string; title: string; subcategory: string };

/**
 * Compare two works on the same shelf. Headings with a canonical position come
 * first in that order; any remaining headings fall back to the alphabet, and
 * works without a canonical position keep their alphabetical place.
 */
export function compareShelfWorks(category: string, a: ShelfWork, b: ShelfWork): number {
  const ra = subcategoryRank(category, a.subcategory);
  const rb = subcategoryRank(category, b.subcategory);
  if (ra !== null && rb !== null && ra !== rb) return ra - rb;
  if (ra !== null && rb === null) return -1;
  if (ra === null && rb !== null) return 1;
  if (ra === null && rb === null) {
    const byHeading = a.subcategory.localeCompare(b.subcategory, undefined, { sensitivity: "base" });
    if (byHeading !== 0) return byHeading;
  }
  const wa = workRank(category, a.slug, a.title);
  const wb = workRank(category, b.slug, b.title);
  if (wa !== null && wb !== null && wa !== wb) return wa - wb;
  if (wa !== null && wb === null) return -1;
  if (wa === null && wb !== null) return 1;
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

/** Sort a shelf's works in place-safe fashion (returns a new array). */
export function sortShelfWorks<T extends ShelfWork>(category: string, works: T[]): T[] {
  return [...works].sort((a, b) => compareShelfWorks(category, a, b));
}

/** Exposed for tests and for ordering headings that arrive without works. */
export function orderedSubcategories(category: string, present: string[]): string[] {
  return [...present].sort((a, b) => {
    const ra = subcategoryRank(category, a);
    const rb = subcategoryRank(category, b);
    if (ra !== null && rb !== null && ra !== rb) return ra - rb;
    if (ra !== null && rb === null) return -1;
    if (ra === null && rb !== null) return 1;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
}
