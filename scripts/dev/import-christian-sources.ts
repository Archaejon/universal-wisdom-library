// Adds the Christian shelf as streamed works.
//
// Three hosts are used, and in every case this library stores only the
// catalogue record, the chapter outline and the passage index. The text itself
// stays with the project that hosts it and is requested when someone reads:
//
//   * Bolls Bible API  — the 66 books of the Christian Bible, King James
//     Version beside the Westminster Leningrad Codex (Hebrew) and the Textus
//     Receptus (Greek). One chapter per request.
//   * Christian Classics Ethereal Library — Augustine, Aquinas, the apostolic
//     and ante-Nicene fathers, and the New Testament apocrypha. One section
//     page per request.
//   * New Advent — the Summa Theologica, whose question pages hold the full
//     articles. One question page per request.
//
//   bun run scripts/dev/import-christian-sources.ts
//   bun run scripts/dev/import-christian-sources.ts --only=bible
//   bun run scripts/dev/import-christian-sources.ts --only=genesis
//   bun run scripts/dev/import-christian-sources.ts --only=summa
//   bun run scripts/dev/import-christian-sources.ts --only=fathers
//   bun run scripts/dev/import-christian-sources.ts --only=confessions
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractHtmlSegments, stripMarkup, type HtmlSegmentation } from "../../server/stream";

const ROOT = join(import.meta.dir, "..", "..");
const WORKS = join(ROOT, "data", "corpus", "works");
const STREAMS = join(ROOT, "data", "registry", "streams.json");
const FUNCTIONS = join(ROOT, "data", "corpus", "text-functions.json");
const MANIFEST = join(ROOT, "data", "imports", "christian-sources.json");
const RETRIEVED_AT = new Date().toISOString().slice(0, 10);

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.split("=")[1] ?? "";
const concurrency = Math.max(1, Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? 6));

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function getText(url: string, timeoutMs = 30_000): Promise<string> {
  let last: Error | null = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          accept: "text/html,application/json",
          "user-agent": "UniversalWisdomLibrary/1.0 (local reading interface; import and streaming)",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 404) throw Object.assign(new Error(`${url} returned 404`), { status: 404 });
      if (res.status === 429 || res.status >= 500) {
        last = new Error(`${url} returned ${res.status}`);
        await Bun.sleep(700 * attempt * attempt);
        continue;
      }
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      return await res.text();
    } catch (err) {
      last = err as Error;
      if ((err as any).status === 404) break;
      if (attempt < 4) await Bun.sleep(400 * attempt);
    }
  }
  throw last ?? new Error(`${url} failed`);
}

async function getJson(url: string): Promise<any> {
  return JSON.parse(await getText(url, 40_000));
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------------------------------------------------------------------------
// Bible
// ---------------------------------------------------------------------------

type Book = {
  num: number;
  slug: string;
  title: string;
  testament: "ot" | "nt";
  category: string;
  description: string;
};

const BOOKS: Book[] = [
  { num: 1, slug: "bible-genesis", title: "Genesis", testament: "ot", category: "Torah / Pentateuch", description: "The creation narratives, the ancestral stories, and the covenant promises to Abraham, Isaac and Jacob." },
  { num: 2, slug: "bible-exodus", title: "Exodus", testament: "ot", category: "Torah / Pentateuch", description: "The deliverance from Egypt, the covenant at Sinai and the instructions for the tabernacle." },
  { num: 3, slug: "bible-leviticus", title: "Leviticus", testament: "ot", category: "Torah / Pentateuch", description: "Priestly law: sacrifice, purity, holiness and the Day of Atonement." },
  { num: 4, slug: "bible-numbers", title: "Numbers", testament: "ot", category: "Torah / Pentateuch", description: "The wilderness journey from Sinai to the plains of Moab, with its censuses and disputes." },
  { num: 5, slug: "bible-deuteronomy", title: "Deuteronomy", testament: "ot", category: "Torah / Pentateuch", description: "Moses's farewell addresses, restating the law and its blessings and curses." },
  { num: 6, slug: "bible-joshua", title: "Joshua", testament: "ot", category: "Historical Books", description: "The settlement of the land and its division among the tribes." },
  { num: 7, slug: "bible-judges", title: "Judges", testament: "ot", category: "Historical Books", description: "Israelite tribal leadership between Joshua and the monarchy, told as a cycle of apostasy and rescue." },
  { num: 8, slug: "bible-ruth", title: "Ruth", testament: "ot", category: "Historical Books", description: "A Moabite widow's loyalty to Naomi and her place in the ancestry of David." },
  { num: 9, slug: "bible-1-samuel", title: "1 Samuel", testament: "ot", category: "Historical Books", description: "Samuel, Saul and the rise of David." },
  { num: 10, slug: "bible-2-samuel", title: "2 Samuel", testament: "ot", category: "Historical Books", description: "David's reign, his successes, his sins and the rebellion of Absalom." },
  { num: 11, slug: "bible-1-kings", title: "1 Kings", testament: "ot", category: "Historical Books", description: "Solomon's reign, the divided kingdom, and Elijah." },
  { num: 12, slug: "bible-2-kings", title: "2 Kings", testament: "ot", category: "Historical Books", description: "Elisha, the fall of Samaria and the fall of Jerusalem." },
  { num: 13, slug: "bible-1-chronicles", title: "1 Chronicles", testament: "ot", category: "Historical Books", description: "Genealogies and the reign of David retold for the post-exilic community." },
  { num: 14, slug: "bible-2-chronicles", title: "2 Chronicles", testament: "ot", category: "Historical Books", description: "Solomon's temple and the kings of Judah through the exile." },
  { num: 15, slug: "bible-ezra", title: "Ezra", testament: "ot", category: "Historical Books", description: "The return from exile, the rebuilding of the temple and the reforming of the community." },
  { num: 16, slug: "bible-nehemiah", title: "Nehemiah", testament: "ot", category: "Historical Books", description: "The rebuilding of Jerusalem's wall and the renewal of its covenant." },
  { num: 17, slug: "bible-esther", title: "Esther", testament: "ot", category: "Historical Books", description: "A Jewish queen in Persia averts the destruction of her people." },
  { num: 18, slug: "bible-job", title: "Job", testament: "ot", category: "Wisdom and Poetry", description: "A righteous man's suffering and the divine answer from the whirlwind." },
  { num: 19, slug: "bible-psalms", title: "Psalms", testament: "ot", category: "Wisdom and Poetry", description: "The Psalter: praise, lament, thanksgiving and royal prayer across 150 psalms." },
  { num: 20, slug: "bible-proverbs", title: "Proverbs", testament: "ot", category: "Wisdom and Poetry", description: "Instruction in wisdom, discipline and the fear of the Lord." },
  { num: 21, slug: "bible-ecclesiastes", title: "Ecclesiastes", testament: "ot", category: "Wisdom and Poetry", description: "A meditation on toil, death and the limits of human knowledge." },
  { num: 22, slug: "bible-song-of-solomon", title: "Song of Solomon", testament: "ot", category: "Wisdom and Poetry", description: "A lyric dialogue of desire, read allegorically by many communities and literally by others." },
  { num: 23, slug: "bible-isaiah", title: "Isaiah", testament: "ot", category: "Prophets", description: "Judgement and consolation for Judah, including the servant songs." },
  { num: 24, slug: "bible-jeremiah", title: "Jeremiah", testament: "ot", category: "Prophets", description: "Warnings before Jerusalem's fall and the promise of a new covenant." },
  { num: 25, slug: "bible-lamentations", title: "Lamentations", testament: "ot", category: "Prophets", description: "Five acrostic laments over the destruction of Jerusalem." },
  { num: 26, slug: "bible-ezekiel", title: "Ezekiel", testament: "ot", category: "Prophets", description: "Visions of judgement and restoration, and the valley of dry bones." },
  { num: 27, slug: "bible-daniel", title: "Daniel", testament: "ot", category: "Prophets", description: "Stories of faithfulness in exile and apocalyptic visions." },
  { num: 28, slug: "bible-hosea", title: "Hosea", testament: "ot", category: "Prophets", description: "Covenant unfaithfulness figured as marriage, and the refusal to abandon Israel." },
  { num: 29, slug: "bible-joel", title: "Joel", testament: "ot", category: "Prophets", description: "A locust plague, a call to repentance and the promise of the spirit." },
  { num: 30, slug: "bible-amos", title: "Amos", testament: "ot", category: "Prophets", description: "Prophetic indictment of injustice and empty ritual in the northern kingdom." },
  { num: 31, slug: "bible-obadiah", title: "Obadiah", testament: "ot", category: "Prophets", description: "A short oracle against Edom." },
  { num: 32, slug: "bible-jonah", title: "Jonah", testament: "ot", category: "Prophets", description: "A reluctant prophet, a repenting city and a lesson about divine mercy." },
  { num: 33, slug: "bible-micah", title: "Micah", testament: "ot", category: "Prophets", description: "Judgement on corrupt leaders and the call to do justice, love mercy and walk humbly." },
  { num: 34, slug: "bible-nahum", title: "Nahum", testament: "ot", category: "Prophets", description: "An oracle on the fall of Nineveh." },
  { num: 35, slug: "bible-habakkuk", title: "Habakkuk", testament: "ot", category: "Prophets", description: "A prophet's protest over violence, answered by the promise that the righteous live by faith." },
  { num: 36, slug: "bible-zephaniah", title: "Zephaniah", testament: "ot", category: "Prophets", description: "The day of the Lord and a remnant's restoration." },
  { num: 37, slug: "bible-haggai", title: "Haggai", testament: "ot", category: "Prophets", description: "Exhortations to rebuild the temple after the exile." },
  { num: 38, slug: "bible-zechariah", title: "Zechariah", testament: "ot", category: "Prophets", description: "Visionary oracles and promises of restoration for post-exilic Jerusalem." },
  { num: 39, slug: "bible-malachi", title: "Malachi", testament: "ot", category: "Prophets", description: "A disputation over worship, fidelity and the coming messenger." },
  { num: 40, slug: "bible-matthew", title: "Matthew", testament: "nt", category: "Gospels", description: "The gospel presenting Jesus as Israel's Messiah, with the Sermon on the Mount." },
  { num: 41, slug: "bible-mark", title: "Mark", testament: "nt", category: "Gospels", description: "The earliest gospel: a fast-paced narrative of Jesus's ministry, death and empty tomb." },
  { num: 42, slug: "bible-luke", title: "Luke", testament: "nt", category: "Gospels", description: "A gospel addressed to Theophilus, attentive to outsiders, women and the poor." },
  { num: 43, slug: "bible-john", title: "John", testament: "nt", category: "Gospels", description: "A meditative gospel of signs, discourses and the Word made flesh." },
  { num: 44, slug: "bible-acts", title: "Acts of the Apostles", testament: "nt", category: "History", description: "The spread of the early church from Jerusalem to Rome." },
  { num: 45, slug: "bible-romans", title: "Romans", testament: "nt", category: "Pauline Epistles", description: "Paul's argument about justification, faith, Israel and the new life." },
  { num: 46, slug: "bible-1-corinthians", title: "1 Corinthians", testament: "nt", category: "Pauline Epistles", description: "Instruction to a divided congregation on gifts, order, resurrection and love." },
  { num: 47, slug: "bible-2-corinthians", title: "2 Corinthians", testament: "nt", category: "Pauline Epistles", description: "Paul's defence of his ministry and his account of strength in weakness." },
  { num: 48, slug: "bible-galatians", title: "Galatians", testament: "nt", category: "Pauline Epistles", description: "A sharp argument that Gentile believers are not bound to the Mosaic law." },
  { num: 49, slug: "bible-ephesians", title: "Ephesians", testament: "nt", category: "Pauline Epistles", description: "A vision of the church as one body reconciled through Christ." },
  { num: 50, slug: "bible-philippians", title: "Philippians", testament: "nt", category: "Pauline Epistles", description: "A letter of gratitude from prison, including the hymn of Christ's self-emptying." },
  { num: 51, slug: "bible-colossians", title: "Colossians", testament: "nt", category: "Pauline Epistles", description: "The primacy of Christ and warnings against rival teaching." },
  { num: 52, slug: "bible-1-thessalonians", title: "1 Thessalonians", testament: "nt", category: "Pauline Epistles", description: "Encouragement about the coming of Christ and the dead in Christ." },
  { num: 53, slug: "bible-2-thessalonians", title: "2 Thessalonians", testament: "nt", category: "Pauline Epistles", description: "Clarification about the day of the Lord and steady work in the meantime." },
  { num: 54, slug: "bible-1-timothy", title: "1 Timothy", testament: "nt", category: "Pauline Epistles", description: "Pastoral instruction on teaching, order and the conduct of a congregation." },
  { num: 55, slug: "bible-2-timothy", title: "2 Timothy", testament: "nt", category: "Pauline Epistles", description: "A farewell charge to a younger co-worker." },
  { num: 56, slug: "bible-titus", title: "Titus", testament: "nt", category: "Pauline Epistles", description: "Instructions for ordering congregations in Crete." },
  { num: 57, slug: "bible-philemon", title: "Philemon", testament: "nt", category: "Pauline Epistles", description: "A personal appeal on behalf of Onesimus, a enslaved man." },
  { num: 58, slug: "bible-hebrews", title: "Hebrews", testament: "nt", category: "Pauline Epistles", description: "A sermon on Christ's priesthood and the superiority of the new covenant." },
  { num: 59, slug: "bible-james", title: "James", testament: "nt", category: "General Epistles", description: "Practical wisdom on faith, speech and care for the poor." },
  { num: 60, slug: "bible-1-peter", title: "1 Peter", testament: "nt", category: "General Epistles", description: "Encouragement to scattered believers facing hostility." },
  { num: 61, slug: "bible-2-peter", title: "2 Peter", testament: "nt", category: "General Epistles", description: "A warning against false teaching and a call to patient hope." },
  { num: 62, slug: "bible-1-john", title: "1 John", testament: "nt", category: "General Epistles", description: "Tests of true teaching, and the identification of God with love." },
  { num: 63, slug: "bible-2-john", title: "2 John", testament: "nt", category: "General Epistles", description: "A short letter on truth, love and hospitality." },
  { num: 64, slug: "bible-3-john", title: "3 John", testament: "nt", category: "General Epistles", description: "A short letter about hospitality and a disruptive leader." },
  { num: 65, slug: "bible-jude", title: "Jude", testament: "nt", category: "General Epistles", description: "A warning against teachers the author considers corrupt." },
  { num: 66, slug: "bible-revelation", title: "Revelation", testament: "nt", category: "Apocalypse", description: "Visions of judgement, empire and the renewal of all things." },
];

const BOOK_HELP: Record<string, string> = {
  "Torah / Pentateuch": "The five books traditionally ascribed to Moses, read as the foundation of Israelite law and covenant.",
  "Historical Books": "Narratives of Israelite life in the land, the monarchy and the exile.",
  "Wisdom and Poetry": "The writings of instruction, prayer and reflection on suffering and desire.",
  Prophets: "Prophetic oracles and narratives from the Assyrian, Babylonian and Persian periods.",
  Gospels: "Narratives of Jesus's teaching, death and resurrection.",
  History: "A continuation of the gospel narrative into the mission of the early church.",
  "Pauline Epistles": "Letters attributed to Paul, addressed to congregations and co-workers.",
  "General Epistles": "Letters attributed to other apostolic figures and circulated widely.",
  Apocalypse: "Apocalyptic literature addressed to communities under pressure.",
};

async function buildBible(bookFilter: string) {
  const kjvBooks = await getJson("https://bolls.life/get-books/KJV/");
  const wlcBooks = await getJson("https://bolls.life/get-books/WLC/");
  const trBooks = await getJson("https://bolls.life/get-books/TR/");
  const byId = (list: any[]) => new Map<number, any>(list.map((b) => [Number(b.bookid), b]));

  const kjv = byId(kjvBooks);
  const wlc = byId(wlcBooks);
  const tr = byId(trBooks);

  const selected = BOOKS.filter((b) => !bookFilter || b.slug === bookFilter || b.slug === `bible-${bookFilter}`);
  if (!selected.length) throw new Error(`Unknown Bible book ${bookFilter}`);

  const totals = { books: 0, chapters: 0, passages: 0 };
  for (const book of selected) {
    const source = book.testament === "ot" ? wlc.get(book.num) : tr.get(book.num);
    if (!source) throw new Error(`Bolls has no ${book.testament === "ot" ? "WLC" : "TR"} text for ${book.title}`);
    if (!kjv.get(book.num)) throw new Error(`Bolls has no KJV text for ${book.title}`);

    const chapterCount = Number(kjv.get(book.num).chapters ?? source.chapters);
    const chapterNumbers = Array.from({ length: chapterCount }, (_, i) => i + 1);

    // The verse index comes from the base (English) edition: it is the edition
    // readers quote, so its numbering is what references follow.
    const verseCounts = await pool(chapterNumbers, concurrency, async (chapter) => {
      try {
        const verses = await getJson(`https://bolls.life/get-chapter/KJV/${book.num}/${chapter}/`);
        return Array.isArray(verses) ? Math.max(0, ...verses.map((v: any) => Number(v.verse) || 0)) : 0;
      } catch {
        return 0;
      }
    });

    const chapters = chapterNumbers.map((chapter) => ({ ref: String(chapter), label: `${book.title} ${chapter}` }));
    const passages = chapterNumbers.flatMap((chapter) => {
      const count = verseCounts[chapter - 1] ?? 0;
      return Array.from({ length: count }, (_, i) => ({
        reference: `${chapter}.${i + 1}`,
        label: `${book.title} ${chapter}:${i + 1}`,
        chapterRef: String(chapter),
      }));
    });
    if (!passages.length) throw new Error(`${book.title}: no verses indexed`);

    const original = book.testament === "ot" ? "he" : "grc";
    const originalEdition = book.testament === "ot" ? "WLC" : "TR";
    const originalTitle = book.testament === "ot" ? "Westminster Leningrad Codex" : "Textus Receptus";
    const originalLanguageName = book.testament === "ot" ? "Hebrew" : "Greek";
    const nativeTitle = String(source.name ?? "").trim();
    const base = `https://bolls.life/`;
    const slug = book.slug;

    const work = {
      slug,
      title: `${book.title} (Christian Bible)`,
      originalTitle: nativeTitle,
      transliteration: "",
      altTitles: [book.title, `${book.title} — King James Version`],
      tradition: "christianity",
      school: "early-christianity",
      genre: "Scripture",
      textType: "Biblical book",
      category: book.testament === "ot" ? "Old Testament" : "New Testament",
      subcategory: book.category,
      originalLanguage: original,
      dateStart: book.testament === "ot" ? -1000 : 50,
      dateEnd: book.testament === "ot" ? -400 : 100,
      dateDisplay:
        book.testament === "ot"
          ? "Composed over several centuries in the first millennium BCE; the Masoretic text is attested from the 10th century CE"
          : "Written in the first century CE, with the canon fixed in the following centuries",
      authorshipStatus: "traditional",
      attributionNote:
        "The text is anonymous or traditionally attributed; the attribution is part of the work's reception rather than a statement about the surviving author. The catalogue does not adjudicate it.",
      description: `${book.description} This is the book as received in Christian Bibles: the ${originalTitle} ${originalLanguageName} text beside the King James Version of 1611.`,
      historicalContext: BOOK_HELP[book.category] ?? "A book of the Christian Bible, read across Christian communities with different canons and lectionaries.",
      availabilityNote:
        book.slug === "bible-esther"
          ? "Streamed from the Bolls Bible API. Chapters 11–16 in the KJV are the Greek additions to Esther, which are not in the Hebrew text; those chapters are shown in English only."
          : book.testament === "ot"
            ? "Streamed from the Bolls Bible API. Verse references follow the KJV; where the Hebrew counts a psalm superscription as verse 1, the original-language pane is one verse ahead."
            : "Streamed from the Bolls Bible API. Verse references follow the KJV; the Greek text is the Textus Receptus, which differs from critical editions at some readings.",
      featured: false,
      featuredNote: "",
      refScheme: "chapter.verse",
      isSample: false,
      textStorage: "streamed",
      chapters,
      passages,
      editions: [
        {
          slug: `${slug}-${original}`,
          language: original,
          editionType: "original",
          title: `${originalTitle} (${originalLanguageName})`,
          translator: "",
          publisher: "Bolls Bible API",
          source: "bolls",
          license: "public-domain",
          rightsStatus: "Public domain",
          attributionText: `${originalTitle} ${originalLanguageName} text, served by the Bolls Bible API.`,
          structureScheme: "book, chapter, verse",
          isSample: false,
          notes: `The ${originalLanguageName} text is shown as the API serves it; this library does not collate it against critical editions.`,
        },
        {
          slug: `${slug}-en-kjv`,
          language: "en",
          editionType: "translation",
          title: "King James Version (1611)",
          translator: "The King James Bible translators",
          publisher: "Bolls Bible API",
          publicationYear: 1611,
          source: "bolls",
          license: "public-domain",
          rightsStatus: "Public domain",
          attributionText: "The Holy Bible, King James Version (1611). Public domain. Served by the Bolls Bible API.",
          structureScheme: "book, chapter, verse",
          isSample: false,
          notes: "Strong's numbers included in the API's markup are not displayed; the verse wording is unchanged.",
        },
      ],
    };

    writeFileSync(join(WORKS, `${slug}.json`), `${JSON.stringify(work, null, 2)}\n`);
    streams.works[slug] = {
      provider: "bolls",
      upstream: String(book.num),
      mode: "numbered",
      licence: "public-domain",
      config: { book: book.num, testament: book.testament },
      editions: [
        {
          slug: `${slug}-${original}`,
          language: original,
          languageName: originalLanguageName.toLowerCase(),
          version: originalEdition,
          license: "public-domain",
          sourceUrl: base,
        },
        {
          slug: `${slug}-en-kjv`,
          language: "en",
          languageName: "english",
          version: "KJV",
          license: "public-domain",
          sourceUrl: base,
        },
      ],
    };
    functions.works[slug] = {
      functions: ["canonical_scripture", "historical_document"],
      status: "provisional",
      assignedBy: "UWL editors (comparative taxonomy)",
      note: `Canonical for most Christian communities; the exact canon differs between traditions. ${book.title} is shown in the King James Version beside the ${originalTitle}.`,
    };
    recordWork({
      slug,
      host: "bolls",
      upstream: `book ${book.num}`,
      chapters: chapters.length,
      passages: passages.length,
      originalEdition,
      englishEdition: "KJV",
    });
    totals.books++;
    totals.chapters += chapters.length;
    totals.passages += passages.length;
    console.log(`  ${book.title}: ${chapters.length} chapters, ${passages.length} verses`);
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Christian Classics Ethereal Library
// ---------------------------------------------------------------------------

const CCEL_MARKERS: HtmlSegmentation = {
  startMarker: 'class="book-content">',
  endMarker: 'id="book_navbar_bottom"',
  split: "paragraphs",
};

type CcelSpec = {
  slug: string;
  title: string;
  author: string;
  work: string;
  /** Read from New Advent instead of the CCEL (the CCEL page is script-loaded). */
  host?: "newadvent";
  /** For a work inside a Schaff volume: the TOC1 heading and the volume path. */
  group?: { label: string; author: string; volume: string };
  /** Several CCEL works read as one work, e.g. the five books of Irenaeus. */
  parts?: { author: string; work: string; label: string }[];
  authorSlug?: string;
  school: string;
  category: string;
  genre: string;
  textType: string;
  originalLanguage: string;
  dateStart: number;
  dateEnd: number;
  dateDisplay: string;
  authorshipStatus: "established" | "traditional" | "disputed" | "anonymous" | "composite";
  description: string;
  historicalContext: string;
  translator: string;
  translationTitle: string;
  translationYear: number;
  publisher: string;
  editionNote: string;
  functions: string[];
};

const FATHERS: CcelSpec[] = [
  {
    slug: "augustine-confessions",
    title: "Confessions",
    author: "augustine",
    work: "confess",
    authorSlug: "augustine",
    school: "patristics",
    category: "Patristic theology",
    genre: "Autobiography",
    textType: "Confessional narrative",
    originalLanguage: "la",
    dateStart: 397,
    dateEnd: 400,
    dateDisplay: "397–400 CE",
    authorshipStatus: "established",
    description:
      "Augustine's account of his life before and after his conversion, written as a prayer. Books I–IX narrate his youth, his years as a Manichaean hearer and his baptism; Books X–XIII turn to memory, time and the interpretation of Genesis.",
    historicalContext:
      "Written while Augustine was bishop of Hippo, in the years between the Manichaean and Donatist controversies that shaped much of his later writing.",
    translator: "Edward Bouverie Pusey",
    translationTitle: "The Confessions of St. Augustine",
    translationYear: 1838,
    publisher: "Christian Classics Ethereal Library",
    editionNote: "Pusey's 1838 translation, served by the CCEL. The Latin original is not hosted in this streaming edition.",
    functions: ["mystical_contemplative", "historical_document"],
  },
  {
    slug: "augustine-city-of-god",
    title: "The City of God",
    author: "augustine",
    work: "city",
    host: "newadvent",
    authorSlug: "augustine",
    school: "patristics",
    category: "Patristic theology",
    genre: "Theology and history",
    textType: "Apologetic treatise",
    originalLanguage: "la",
    dateStart: 413,
    dateEnd: 426,
    dateDisplay: "413–426 CE",
    authorshipStatus: "established",
    description:
      "Augustine's response to the accusation that Christianity caused the sack of Rome. The first ten books answer pagan critics; the remaining twelve trace two cities, earthly and heavenly, through scripture and history.",
    historicalContext:
      "Begun after the Visigothic sack of Rome in 410, and completed over thirteen years while Augustine was bishop of Hippo.",
    translator: "Marcus Dods",
    translationTitle: "The City of God",
    translationYear: 1871,
    publisher: "Christian Classics Ethereal Library",
    editionNote: "Dods's 1871 translation, served by the CCEL. The Latin original is not hosted in this streaming edition.",
    functions: ["philosophical_work", "historical_document"],
  },
  {
    slug: "augustine-on-christian-doctrine",
    title: "On Christian Doctrine",
    author: "augustine",
    work: "doctrine",
    authorSlug: "augustine",
    school: "patristics",
    category: "Patristic theology",
    genre: "Hermeneutics",
    textType: "Instructional treatise",
    originalLanguage: "la",
    dateStart: 397,
    dateEnd: 426,
    dateDisplay: "397–426 CE",
    authorshipStatus: "established",
    description:
      "A handbook for interpreting scripture and teaching it. Augustine sets out the distinction between things and signs, the role of the rule of faith, and the claim that love of God and neighbour is the measure of interpretation.",
    historicalContext: "Written in two stages: the first books around 397, the later books around 426, near the end of Augustine's life.",
    translator: "J. F. Shaw",
    translationTitle: "On Christian Doctrine",
    translationYear: 1892,
    publisher: "Christian Classics Ethereal Library",
    editionNote: "Shaw's translation from the Nicene and Post-Nicene Fathers, served by the CCEL.",
    functions: ["commentary_exegesis", "philosophical_work"],
  },
  {
    slug: "aquinas-summa-contra-gentiles",
    title: "Summa Contra Gentiles",
    author: "aquinas",
    work: "gentiles",
    authorSlug: "aquinas",
    school: "scholasticism",
    category: "Scholastic theology",
    genre: "Theology and philosophy",
    textType: "Systematic treatise",
    originalLanguage: "la",
    dateStart: 1259,
    dateEnd: 1265,
    dateDisplay: "1259–1265 CE",
    authorshipStatus: "established",
    description:
      "Aquinas's argument for the Christian faith addressed to those who do not accept scripture, proceeding by reason where possible. Book I treats God, Book II creation, Book III providence and the end of creatures, Book IV revelation, incarnation and sacraments.",
    historicalContext:
      "Written in Italy and Paris while Aquinas was teaching, in conversation with Aristotle and with Islamic and Jewish philosophy.",
    translator: "Joseph Rickaby",
    translationTitle: "Of God and His Creatures",
    translationYear: 1905,
    publisher: "Christian Classics Ethereal Library",
    editionNote: "Rickaby's 1905 translation, served by the CCEL. The Latin original is not hosted in this streaming edition.",
    functions: ["philosophical_work"],
  },
  {
    slug: "irenaeus-against-heresies",
    title: "Against Heresies",
    author: "irenaeus",
    work: "against_heresies_i",
    authorSlug: "irenaeus",
    parts: [
      { author: "irenaeus", work: "against_heresies_i", label: "Book I" },
      { author: "irenaeus", work: "against_heresies_ii", label: "Book II" },
      { author: "irenaeus", work: "against_heresies_iii", label: "Book III" },
      { author: "irenaeus", work: "against_heresies_iv", label: "Book IV" },
      { author: "irenaeus", work: "against_heresies_v", label: "Book V" },
    ],
    school: "patristics",
    category: "Patristic theology",
    genre: "Heresiology",
    textType: "Refutation",
    originalLanguage: "grc",
    dateStart: 180,
    dateEnd: 185,
    dateDisplay: "c. 180–185 CE",
    authorshipStatus: "established",
    description:
      "Irenaeus's refutation of Valentinian and other Gnostic systems, and the earliest surviving argument for a fourfold gospel. His accounts of the systems he opposes are a principal source for them, which is why the work carries both his argument and his opponents' teaching as he reports it.",
    historicalContext:
      "Written at Lyons by a bishop who had known Polycarp, in a period when Christian communities were defining their canon and rule of faith against competing schools.",
    translator: "Alexander Roberts and W. H. Rambaut",
    translationTitle: "Against Heresies",
    translationYear: 1885,
    publisher: "Christian Classics Ethereal Library",
    editionNote: "The Ante-Nicene Fathers translation, served by the CCEL. The Greek original survives partly, mainly in quotations; the Latin version is not hosted here.",
    functions: ["commentary_exegesis", "historical_document"],
  },
  {
    slug: "athanasius-on-the-incarnation",
    title: "On the Incarnation",
    author: "athanasius",
    work: "incarnation",
    authorSlug: "athanasius",
    school: "patristics",
    category: "Patristic theology",
    genre: "Theology",
    textType: "Doctrinal treatise",
    originalLanguage: "grc",
    dateStart: 318,
    dateEnd: 320,
    dateDisplay: "c. 318–320 CE",
    authorshipStatus: "established",
    description:
      "Athanasius's account of why the Word became flesh: the argument moves from creation and the fall to the incarnation and the defeat of death, and closes with a defence of the resurrection.",
    historicalContext: "Written before the Arian controversy broke into open conflict, while Athanasius was a young deacon in Alexandria.",
    translator: "Archibald Robertson",
    translationTitle: "On the Incarnation of the Word",
    translationYear: 1892,
    publisher: "Christian Classics Ethereal Library",
    editionNote: "Robertson's translation from the Nicene and Post-Nicene Fathers, served by the CCEL.",
    functions: ["philosophical_work"],
  },
  {
    slug: "athanasius-against-the-arians",
    title: "Orations Against the Arians",
    author: "athanasius",
    work: "npnf204",
    group: { label: "Against the Arians.", author: "schaff", volume: "npnf204" },
    authorSlug: "athanasius",
    school: "patristics",
    category: "Patristic theology",
    genre: "Theology and controversy",
    textType: "Polemical orations",
    originalLanguage: "grc",
    dateStart: 339,
    dateEnd: 345,
    dateDisplay: "c. 339–345 CE",
    authorshipStatus: "established",
    description:
      "Four orations against the teaching of Arius and his followers. Athanasius argues that the Son is begotten, not made, and that the incarnate life and worship of the church require the full divinity of the Son. The work is also a source for the positions it opposes, quoted at length.",
    historicalContext:
      "Written during Athanasius's exiles, when the imperial court and several eastern bishops supported Arian or homoean formulas.",
    translator: "Archibald Robertson",
    translationTitle: "Orations Against the Arians",
    translationYear: 1892,
    publisher: "Christian Classics Ethereal Library",
    editionNote:
      "Robertson's translation from the Nicene and Post-Nicene Fathers, second series, volume 4, served by the CCEL. Athanasius's Greek is not hosted here.",
    functions: ["philosophical_work", "historical_document"],
  },
  {
    slug: "socrates-scholasticus-church-history",
    title: "Ecclesiastical History",
    author: "socrates-scholasticus",
    work: "npnf202",
    group: { label: "The Ecclesiastical History of Socrates Scholasticus.", author: "schaff", volume: "npnf202" },
    authorSlug: "socrates-scholasticus",
    school: "patristics",
    category: "Church history",
    genre: "History",
    textType: "Ecclesiastical history",
    originalLanguage: "grc",
    dateStart: 439,
    dateEnd: 443,
    dateDisplay: "c. 439–443 CE",
    authorshipStatus: "established",
    description:
      "A church history from Constantine to 439, written in Constantinople by a lawyer. It preserves letters and documents from the Arian controversy, including Arius's own letters, together with the councils of Nicaea and Constantinople.",
    historicalContext:
      "Written by a layman who relied on documentary sources rather than a bishop's archive, and who says so when he doubts a report.",
    translator: "A. C. Zenos",
    translationTitle: "The Ecclesiastical History of Socrates Scholasticus",
    translationYear: 1890,
    publisher: "Christian Classics Ethereal Library",
    editionNote:
      "Zenos's translation from the Nicene and Post-Nicene Fathers, second series, volume 2, served by the CCEL. Documents quoted within the history are reproduced as the translation prints them.",
    functions: ["historical_document"],
  },
  {
    slug: "sozomen-church-history",
    title: "Ecclesiastical History",
    author: "sozomen",
    work: "npnf202",
    group: { label: "The Ecclesiastical History of Sozomen.", author: "schaff", volume: "npnf202" },
    authorSlug: "sozomen",
    school: "patristics",
    category: "Church history",
    genre: "History",
    textType: "Ecclesiastical history",
    originalLanguage: "grc",
    dateStart: 443,
    dateEnd: 448,
    dateDisplay: "c. 443–448 CE",
    authorshipStatus: "established",
    description:
      "A church history from 323 to 425, parallel to Socrates and drawing on similar documentary material, with its own emphasis on monasticism and on the eastern provinces.",
    historicalContext: "Written in Constantinople by a lawyer from Bethelia in Palestine, and dedicated to the emperor Theodosius II.",
    translator: "A. C. Zenos",
    translationTitle: "The Ecclesiastical History of Sozomen",
    translationYear: 1890,
    publisher: "Christian Classics Ethereal Library",
    editionNote: "Zenos's translation from the Nicene and Post-Nicene Fathers, second series, volume 2, served by the CCEL.",
    functions: ["historical_document"],
  },
  {
    slug: "origen-against-celsus",
    title: "Against Celsus",
    author: "origen",
    work: "against_celsus",
    authorSlug: "origen",
    school: "patristics",
    category: "Patristic theology",
    genre: "Apologetics",
    textType: "Refutation",
    originalLanguage: "grc",
    dateStart: 248,
    dateEnd: 248,
    dateDisplay: "c. 248 CE",
    authorshipStatus: "established",
    description:
      "Origen's reply to Celsus's second-century attack on Christianity, 'The True Word'. Because Origen quotes Celsus extensively, the work preserves the argument of a pagan critic who would otherwise be lost.",
    historicalContext: "Written late in Origen's life, during the persecution under Decius, at the request of his patron Ambrose.",
    translator: "Frederick Crombie",
    translationTitle: "Against Celsus",
    translationYear: 1885,
    publisher: "Christian Classics Ethereal Library",
    editionNote: "Crombie's translation from the Ante-Nicene Fathers, served by the CCEL.",
    functions: ["philosophical_work", "historical_document"],
  },
  {
    slug: "tertullian-apology",
    title: "Apology",
    author: "tertullian",
    work: "apology",
    authorSlug: "tertullian",
    school: "patristics",
    category: "Patristic theology",
    genre: "Apologetics",
    textType: "Legal defence",
    originalLanguage: "la",
    dateStart: 197,
    dateEnd: 197,
    dateDisplay: "c. 197 CE",
    authorshipStatus: "established",
    description:
      "A defence of Christians addressed to Roman magistrates, arguing that the persecution of Christians is unjust and that their teaching and conduct answer the charges brought against them.",
    historicalContext: "Written at Carthage during a period of local persecution, before Tertullian's turn to Montanism.",
    translator: "S. Thelwall",
    translationTitle: "The Apology",
    translationYear: 1885,
    publisher: "Christian Classics Ethereal Library",
    editionNote: "Thelwall's translation from the Ante-Nicene Fathers, served by the CCEL.",
    functions: ["historical_document"],
  },
  {
    slug: "tertullian-against-marcion",
    title: "Against Marcion",
    author: "tertullian",
    work: "against_marcion",
    authorSlug: "tertullian",
    school: "patristics",
    category: "Patristic theology",
    genre: "Heresiology",
    textType: "Refutation",
    originalLanguage: "la",
    dateStart: 207,
    dateEnd: 212,
    dateDisplay: "c. 207–212 CE",
    authorshipStatus: "established",
    description:
      "Tertullian's five-book refutation of Marcion, who separated the creator God of the Hebrew scriptures from the Father of Jesus. The work is the longest surviving source for Marcion's teaching and for how the church read scripture against it.",
    historicalContext: "Written after Tertullian had joined the Montanists, against a rival Christian movement with its own canon.",
    translator: "Peter Holmes",
    translationTitle: "Against Marcion",
    translationYear: 1885,
    publisher: "Christian Classics Ethereal Library",
    editionNote: "Holmes's translation from the Ante-Nicene Fathers, served by the CCEL.",
    functions: ["historical_document"],
  },
  {
    slug: "tertullian-against-the-valentinians",
    title: "Against the Valentinians",
    author: "tertullian",
    work: "against_valentinians",
    authorSlug: "tertullian",
    school: "patristics",
    category: "Patristic theology",
    genre: "Heresiology",
    textType: "Refutation",
    originalLanguage: "la",
    dateStart: 207,
    dateEnd: 213,
    dateDisplay: "c. 207–213 CE",
    authorshipStatus: "established",
    description:
      "A satirical account and refutation of the Valentinian Gnostic system, its aeons, its myth of Sophia and its division of humanity. Hostile in tone and not a neutral report, but a principal source for the system as Latin Christians encountered it.",
    historicalContext: "Written in Carthage after Tertullian joined the Montanists, against a Gnostic school that had spread in Rome and North Africa.",
    translator: "Peter Holmes",
    translationTitle: "Against the Valentinians",
    translationYear: 1885,
    publisher: "Christian Classics Ethereal Library",
    editionNote: "Holmes's translation from the Ante-Nicene Fathers, served by the CCEL. The text reports the system it opposes; its characterisations are Tertullian's.",
    functions: ["historical_document"],
  },
  {
    slug: "hippolytus-refutation-of-all-heresies",
    title: "The Refutation of All Heresies",
    author: "hippolytus",
    work: "refutation",
    authorSlug: "hippolytus",
    school: "patristics",
    category: "Patristic theology",
    genre: "Heresiology",
    textType: "Refutation",
    originalLanguage: "grc",
    dateStart: 222,
    dateEnd: 235,
    dateDisplay: "c. 222–235 CE",
    authorshipStatus: "disputed",
    description:
      "A survey of philosophical schools and Christian heresies, arguing that the Gnostic systems derived from Greek philosophy. It preserves extensive quotations from Valentinian, Naassene, Sethian and other teaching, and is a central source for Gnostic thought despite its hostile frame.",
    historicalContext:
      "Transmitted under the name of Hippolytus of Rome; the attribution is debated. Books II and III are lost. The text reflects the theological conflicts of early third-century Rome.",
    translator: "J. H. MacMahon",
    translationTitle: "The Refutation of All Heresies",
    translationYear: 1885,
    publisher: "Christian Classics Ethereal Library",
    editionNote:
      "MacMahon's translation from the Ante-Nicene Fathers, served by the CCEL. The attribution to Hippolytus is disputed and is recorded as such, not settled here.",
    functions: ["historical_document"],
  },
  {
    slug: "cyprian-treatises",
    title: "Treatises",
    author: "cyprian",
    work: "treatises",
    authorSlug: "cyprian",
    school: "patristics",
    category: "Patristic theology",
    genre: "Pastoral theology",
    textType: "Treatises",
    originalLanguage: "la",
    dateStart: 246,
    dateEnd: 258,
    dateDisplay: "c. 246–258 CE",
    authorshipStatus: "established",
    description:
      "Cyprian's pastoral treatises from Carthage: on the unity of the church, on the lapsed who sought readmission after persecution, on almsgiving, on mortality, and on the Lord's Prayer.",
    historicalContext: "Written while bishop of Carthage during the Decian persecution and the disputes that followed over readmitting the lapsed.",
    translator: "Robert Ernest Wallis",
    translationTitle: "The Treatises of Cyprian",
    translationYear: 1885,
    publisher: "Christian Classics Ethereal Library",
    editionNote: "Wallis's translation from the Ante-Nicene Fathers, served by the CCEL.",
    functions: ["religious_law_practice", "sermon_speech"],
  },
  {
    slug: "justin-martyr-first-apology",
    title: "First Apology",
    author: "justin_martyr",
    work: "first_apology",
    authorSlug: "justin-martyr",
    school: "patristics",
    category: "Patristic theology",
    genre: "Apologetics",
    textType: "Petition and defence",
    originalLanguage: "grc",
    dateStart: 155,
    dateEnd: 157,
    dateDisplay: "c. 155–157 CE",
    authorshipStatus: "established",
    description:
      "An appeal to the emperor Antoninus Pius on behalf of Christians, with an account of their worship, the eucharist and baptism, and an argument that Greek philosophy and the Hebrew prophets prepared for Christ.",
    historicalContext: "Written in Rome by a philosopher who had converted to Christianity, and addressed to the imperial house.",
    translator: "Marcus Dods",
    translationTitle: "The First Apology of Justin",
    translationYear: 1885,
    publisher: "Christian Classics Ethereal Library",
    editionNote: "Dods's translation from the Ante-Nicene Fathers, served by the CCEL.",
    functions: ["historical_document", "philosophical_work"],
  },
  {
    slug: "apocryphal-acts-and-apocalypses",
    title: "Apocryphal Acts and Apocalypses of the New Testament",
    author: "",
    work: "anf08",
    group: { label: "Apocrypha of the New Testament.", author: "schaff", volume: "anf08" },
    school: "apocryphal-traditions",
    category: "Non-canonical Christian literature",
    genre: "Apocrypha",
    textType: "Acts, epistles and apocalypses",
    originalLanguage: "grc",
    dateStart: 150,
    dateEnd: 400,
    dateDisplay: "2nd–4th centuries CE",
    authorshipStatus: "anonymous",
    description:
      "The apocryphal acts, epistles and apocalypses printed in the Ante-Nicene Fathers: the Acts of Peter, Paul, Thomas, John and Andrew, the apocalypses of Peter and Paul, and related texts. Several are encratite or Gnostic-influenced, and the Acts of Thomas in particular carries a strong Syrian ascetic and Gnostic colouring.",
    historicalContext:
      "Popular narrative literature of the second to fourth centuries, widely read but excluded from the canon; the translations here are Victorian and reflect their editors' judgements about which texts to include.",
    translator: "Alexander Roberts and James Donaldson",
    translationTitle: "Apocryphal Acts and Apocalypses",
    translationYear: 1886,
    publisher: "Christian Classics Ethereal Library",
    editionNote:
      "The Ante-Nicene Fathers translation, served by the CCEL. This is a compilation volume rather than a single ancient work; chapter labels follow the volume's own divisions.",
    functions: ["non_canonical_religious_text", "historical_document"],
  },
  {
    slug: "excerpts-of-theodotus",
    title: "Excerpts of Theodotus",
    author: "theodotus-the-valentinian",
    work: "anf08",
    group: { label: "Excerpts of Theodotus.", author: "schaff", volume: "anf08" },
    authorSlug: "theodotus-the-valentinian",
    school: "gnostic-traditions",
    category: "Gnostic literature",
    genre: "Excerpts",
    textType: "Valentinian teaching",
    originalLanguage: "grc",
    dateStart: 150,
    dateEnd: 180,
    dateDisplay: "2nd century CE, as quoted in the 3rd",
    authorshipStatus: "disputed",
    description:
      "Fragments of Valentinian teaching preserved in Clement of Alexandria's excerpts, attributed to Theodotus and his school. They treat the origin of the aeons, the descent of the Saviour and the nature of the spiritual seed, in the technical vocabulary of Valentinian Gnosticism.",
    historicalContext:
      "Preserved through Clement of Alexandria, who quotes and answers them. The attribution to a single teacher named Theodotus is traditional and debated.",
    translator: "William Wilson",
    translationTitle: "Excerpts of Theodotus",
    translationYear: 1886,
    publisher: "Christian Classics Ethereal Library",
    editionNote:
      "The Ante-Nicene Fathers translation, served by the CCEL. These are excerpts selected by a hostile transmitter, so their shape is not that of the original work.",
    functions: ["non_canonical_religious_text", "historical_document"],
  },
];

const CATALOGUE_ONLY = [
  {
    slug: "gospel-of-thomas",
    title: "The Gospel of Thomas",
    authorSlug: "",
    category: "Gnostic literature",
    school: "gnostic-traditions",
    originalLanguage: "cop",
    dateStart: 50,
    dateEnd: 200,
    dateDisplay: "Composed c. 50–200 CE; the Coptic manuscript is c. 350 CE",
    description:
      "A collection of 114 sayings attributed to Jesus, found at Nag Hammadi in 1945 and known in part from Greek fragments at Oxyrhynchus. It has no narrative of the passion, and its sayings are often read as wisdom teaching with Gnostic elements.",
    availabilityNote:
      "Catalogue record only. The standard English translations (Lambdin; Patterson and Meyer) are in copyright, and no public-domain translation of the complete Coptic text has been verified. The text is not reproduced here.",
  },
  {
    slug: "pistis-sophia",
    title: "Pistis Sophia",
    authorSlug: "",
    category: "Gnostic literature",
    school: "gnostic-traditions",
    originalLanguage: "cop",
    dateStart: 250,
    dateEnd: 400,
    dateDisplay: "Coptic text c. 3rd–4th century CE",
    description:
      "A long Gnostic dialogue in which the risen Jesus instructs disciples, and Pistis Sophia laments her fall and is restored. The Askew Codex is its principal witness.",
    availabilityNote:
      "Catalogue record only. The 1896 translation by G. R. S. Mead is public domain, but the digital editions this project could verify are presented through interfaces that do not permit text retrieval. Nothing is reproduced.",
  },
  {
    slug: "arius-thalia",
    title: "Thalia and Letters of Arius",
    authorSlug: "",
    category: "Arian controversy",
    school: "patristics",
    originalLanguage: "grc",
    dateStart: 318,
    dateEnd: 336,
    dateDisplay: "c. 318–336 CE",
    description:
      "Arius's own account of his teaching, known only from quotations in opponents and from letters preserved in church histories. The Thalia survives in fragments; the letters to Eusebius of Nicomedia and to Alexander are the fullest surviving statements in his own voice.",
    availabilityNote:
      "Catalogue record only. The surviving text is fragmentary and is quoted inside the works of Athanasius and Socrates Scholasticus, which are streamed here. A separate edition of the fragments has not been imported.",
  },
];

let streams: any;
let functions: any;
let manifest: any;

function cleanLabel(value: string): string {
  return stripMarkup(value).replace(/\s+/g, " ").trim();
}

// CCEL's TOC titles often carry the chapter's whole argument. The catalogue
// keeps the first clause so a chapter list stays readable; the hosted page
// still opens with the full heading.
function shortLabel(value: string, max = 90): string {
  const text = cleanLabel(value);
  const cut = text.search(/\.\s+(?=[A-Z(])/);
  if (cut >= 12 && cut < max) return text.slice(0, cut + 1);
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const space = slice.lastIndexOf(" ");
  return `${slice.slice(0, space > 40 ? space : max).replace(/[,;:.\s]+$/, "")}…`;
}

async function ccelFirstPage(author: string, work: string): Promise<string> {
  const html = await getText(`https://ccel.org/ccel/${author}/${work}`);
  const links = [...html.matchAll(/href="(https:\/\/ccel\.org\/ccel\/[^"]+\.html)"/g)].map((m) => m[1]!);
  const hit = links.find((u) => u.includes(`/ccel/${author}/${work}/`) && !u.includes(".toc."));
  if (!hit) throw new Error(`${author}/${work}: no reader page found`);
  return hit;
}

async function ccelGroupPages(
  author: string,
  volume: string,
  groupLabel: string,
): Promise<{ href: string; label: string; depth: number }[]> {
  const toc = await getText(`https://ccel.org/ccel/${author}/${volume}/${volume}.toc.html`);
  const out: { href: string; label: string; depth: number }[] = [];
  let inGroup = false;
  for (const m of toc.matchAll(/<p class="TOC([1234])"><a[^>]*href="([^"]+)"[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/a><\/p>/g)) {
    const depth = Number(m[1]);
    const href = m[2]!;
    const label = cleanLabel(m[4] || m[3] || "");
    if (depth === 1) {
      inGroup = label.toLowerCase().startsWith(groupLabel.toLowerCase());
      continue;
    }
    if (!inGroup) continue;
    out.push({ href: new URL(href, `https://ccel.org/ccel/${author}/${volume}/`).href, label, depth });
  }
  if (!out.length) throw new Error(`Volume ${volume}: group ${groupLabel} not found`);
  return out;
}

type CrawledPage = { url: string; title: string; segments: string[]; headings: string[] };

async function crawlCcel(startUrl: string): Promise<CrawledPage[]> {
  const pages: CrawledPage[] = [];
  const seen = new Set<string>();
  const pagePath = new URL(startUrl).pathname.split("/").slice(0, 4).join("/");
  // Some CCEL works link their next page with the work's slug where the file
  // base belongs ("against_heresies_i.ix.ii.i"). The first page's file root
  // ("anf01") is the repair.
  const root = new URL(startUrl).pathname.split("/").pop()!.split(".")[0]!;
  let url = startUrl;
  while (url && !seen.has(url) && pages.length < 1200) {
    seen.add(url);
    let html: string;
    try {
      html = await getText(url);
    } catch (err) {
      const file = new URL(url).pathname.split("/").pop() ?? "";
      const repaired = `${root}.${file.split(".").slice(1).join(".")}`;
      if (file.split(".")[0] !== root) {
        try {
          const fixed = new URL(repaired, url).href;
          html = await getText(fixed);
          url = fixed;
          seen.add(fixed);
        } catch {
          if (pages.length) break;
          throw err;
        }
      } else {
        // A broken "next" link at the end of a work ends the walk; the pages
        // already collected are still a complete reading order.
        if (pages.length) break;
        throw err;
      }
    }
    const title = cleanLabel(html.match(/class="book_navbar_title">([\s\S]*?)<\/td>/)?.[1] ?? "");
    const segment = html.slice(html.indexOf('class="book-content"'));
    const headings = [...segment.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)]
      .map((m) => cleanLabel(m[1]!))
      .filter((h) => h && h.length < 160);
    const segments = extractHtmlSegments(html, CCEL_MARKERS);
    pages.push({ url, title, segments, headings });
    const nextRaw = html.match(/href="([^"]+)" name="nextNav"/)?.[1];
    if (!nextRaw) break;
    const next = new URL(nextRaw, url).href;
    if (new URL(next).pathname.split("/").slice(0, 4).join("/") !== pagePath) break;
    url = next;
  }
  return pages;
}

function finishChapters<T extends { label: string }>(pages: T[]) {
  const seen = new Set<string>();
  return pages.map((page, index) => {
    let label = page.label || `Section ${index + 1}`;
    if (seen.has(label)) {
      let n = 2;
      while (seen.has(`${label} (${n})`)) n++;
      label = `${label} (${n})`;
    }
    seen.add(label);
    return { page, label };
  });
}

async function buildCcel(spec: CcelSpec) {
  const crawled: { label: string; segments: string[]; url: string }[] = [];
  const partList = spec.parts ?? [{ author: spec.author, work: spec.work, label: "" }];

  for (const part of partList) {
    if (spec.group) {
      // A Schaff volume holds several works. The volume TOC names the pages of
      // the selected work exactly, and orders them, so no walk is needed.
      const entries = await ccelGroupPages(spec.group.author, spec.group.volume, spec.group.label);
      const fetched = await pool(entries, concurrency, async (entry) => {
        try {
          const html = await getText(entry.href);
          return { entry, segments: extractHtmlSegments(html, CCEL_MARKERS) };
        } catch (err) {
          console.warn(`  ! ${entry.href}: ${(err as Error).message}`);
          return { entry, segments: [] as string[] };
        }
      });
      let context = "";
      for (const { entry, segments } of fetched) {
        if (entry.depth === 2) context = entry.label;
        if (!segments.length) continue;
        if (/^(contents|table of contents|index|indexes|title page)\.?$/i.test(entry.label)) continue;
        // "Chapter I" means nothing on its own; name the work it belongs to.
        const generic = /^(chapter|part|section|homily|book)\b/i.test(entry.label);
        const label = generic && context ? `${shortLabel(context, 40)}, ${shortLabel(entry.label)}` : shortLabel(entry.label);
        crawled.push({ label, segments, url: entry.href });
      }
      continue;
    }
    const start = await ccelFirstPage(part.author, part.work);
    const pages = await crawlCcel(start);
    let context = "";
    for (const page of pages) {
      if (page.segments.length === 0) {
        // A page with only a heading opens a new division (Book I, Oration II).
        // Its title becomes the prefix for the sections that follow.
        const heading = page.headings[0] ?? page.title;
        if (heading && /^(Book|Part|Oration|Volume|Treatise|Epistle|Homily|Section)\b/i.test(heading)) context = heading;
        continue;
      }
      const title = page.title || page.headings[0] || `Section ${crawled.length + 1}`;
      // A table of contents is navigation, not part of the work.
      if (/^(contents|table of contents|index|indexes|title page|second title page)\.?$/i.test(title)) continue;
      const label = [part.label || context, shortLabel(title)].filter(Boolean).join(", ");
      crawled.push({ label, segments: page.segments, url: page.url });
    }
  }

  const numbered = finishChapters(crawled);
  if (!numbered.length) throw new Error(`${spec.slug}: no text pages returned`);
  const chapters = numbered.map((entry, index) => ({ ref: String(index + 1), label: entry.label }));
  const passages = numbered.flatMap((entry, index) =>
    entry.page.segments.map((text, i) => ({
      reference: `${index + 1}.${i + 1}`,
      label: entry.page.segments.length === 1 ? entry.label : `${entry.label} §${i + 1}`,
      chapterRef: String(index + 1),
    })),
  );

  // Absolute page URLs: a work may be assembled from several CCEL paths (the
  // five books of Irenaeus, for instance), so there is no single page base.
  const pages = numbered.map((entry) => entry.page.url);
  const editionSlug = `${spec.slug}-en`;
  const work = {
    slug: spec.slug,
    title: spec.title,
    originalTitle: "",
    transliteration: "",
    altTitles: [],
    tradition: "christianity",
    school: spec.school,
    genre: spec.genre,
    textType: spec.textType,
    category: spec.category,
    subcategory: "",
    originalLanguage: spec.originalLanguage,
    dateStart: spec.dateStart,
    dateEnd: spec.dateEnd,
    dateDisplay: spec.dateDisplay,
    authorshipStatus: spec.authorshipStatus,
    author: spec.authorSlug || undefined,
    attributionNote:
      spec.authorSlug
        ? "The attribution is recorded as the edition and the scholarly consensus give it; where the attribution is disputed, the work says so."
        : "A compilation of anonymous or pseudonymous texts; the volume editor's arrangement is what this catalogue records.",
    description: spec.description,
    historicalContext: spec.historicalContext,
    availabilityNote: `Streamed from the ${spec.group ? "CCEL volume page" : "Christian Classics Ethereal Library"} at read time. ${spec.editionNote}`,
    featured: false,
    featuredNote: "",
    refScheme: "chapter.paragraph",
    isSample: false,
    textStorage: "streamed",
    chapters,
    passages,
    editions: [
      {
        slug: editionSlug,
        language: "en",
        editionType: "translation",
        title: spec.translationTitle,
        translator: spec.translator,
        publisher: spec.publisher,
        publicationYear: spec.translationYear,
        source: "ccel",
        license: "public-domain",
        rightsStatus: "Public domain translation",
        attributionText: `${spec.translationTitle}, translated by ${spec.translator} (${spec.translationYear}). Public domain. Digital text served by the Christian Classics Ethereal Library.`,
        structureScheme: "CCEL section pages",
        isSample: false,
        notes: spec.editionNote,
      },
    ],
  };

  writeFileSync(join(WORKS, `${spec.slug}.json`), `${JSON.stringify(work, null, 2)}\n`);
  streams.works[spec.slug] = {
    provider: "ccel",
    upstream: spec.group ? `${spec.group.author}/${spec.group.volume}` : `${spec.author}/${spec.work}`,
    mode: "numbered",
    licence: "public-domain",
    config: {
      pages,
      startMarker: CCEL_MARKERS.startMarker,
      endMarker: CCEL_MARKERS.endMarker,
      split: CCEL_MARKERS.split,
    },
    editions: [
      {
        slug: editionSlug,
        language: "en",
        languageName: "english",
        version: spec.translationTitle,
        license: "public-domain",
        sourceUrl: "https://ccel.org/",
      },
    ],
  };
  functions.works[spec.slug] = {
    functions: spec.functions,
    status: "provisional",
    assignedBy: "UWL editors (comparative taxonomy)",
    note: `${spec.title} — ${spec.category}. The English translation is public domain and is streamed from the CCEL; this catalogue does not relicense it.`,
  };
  recordWork({
    slug: spec.slug,
    host: "ccel",
    upstream: streams.works[spec.slug].upstream,
    chapters: chapters.length,
    passages: passages.length,
    translator: spec.translator,
  });
  console.log(`  ${spec.title}: ${chapters.length} chapters, ${passages.length} paragraphs`);
  return { chapters: chapters.length, passages: passages.length };
}

// ---------------------------------------------------------------------------
// New Advent (a CCEL work whose pages are script-loaded is read here instead)
// ---------------------------------------------------------------------------

const NA_SECTION_MARKERS: HtmlSegmentation = {
  startMarker: "<h1>",
  endMarker: '<div id="ogdenville">',
  split: "sections",
};

async function buildNewAdventBook(spec: CcelSpec) {
  // New Advent numbers the City of God pages 120101–120122, one per book.
  const pages = Array.from({ length: 22 }, (_, i) => `1201${String(i + 1).padStart(2, "0")}.htm`);
  const fetched = await pool(pages, concurrency, async (page) => {
    const url = `https://www.newadvent.org/fathers/${page}`;
    try {
      const html = await getText(url, 45_000);
      const heading = cleanLabel(html.match(/<h1>([\s\S]*?)<\/h1>/)?.[1] ?? "");
      return { page, url, heading, segments: extractHtmlSegments(html, NA_SECTION_MARKERS) };
    } catch (err) {
      console.warn(`  ! ${url}: ${(err as Error).message}`);
      return { page, url, heading: "", segments: [] as string[] };
    }
  });
  const usable = fetched.filter((entry) => entry.segments.length > 0);
  if (usable.length !== pages.length) throw new Error(`${spec.slug}: ${usable.length}/${pages.length} books returned`);

  const chapters = usable.map((entry, index) => ({
    ref: String(index + 1),
    label: entry.heading.replace(/^The City of God\s*\(?|\)$/g, "") || `Book ${index + 1}`,
  }));
  const passages = usable.flatMap((entry, index) =>
    entry.segments.map((text, i) => ({
      reference: `${index + 1}.${i + 1}`,
      label: shortLabel(String(text).split(" — ")[0] ?? `Section ${i + 1}`, 100),
      chapterRef: String(index + 1),
    })),
  );

  const editionSlug = `${spec.slug}-en`;
  const work = {
    slug: spec.slug,
    title: spec.title,
    originalTitle: "De civitate Dei",
    transliteration: "",
    altTitles: ["De civitate Dei"],
    tradition: "christianity",
    school: spec.school,
    genre: spec.genre,
    textType: spec.textType,
    category: spec.category,
    subcategory: "",
    originalLanguage: spec.originalLanguage,
    dateStart: spec.dateStart,
    dateEnd: spec.dateEnd,
    dateDisplay: spec.dateDisplay,
    authorshipStatus: spec.authorshipStatus,
    author: spec.authorSlug || undefined,
    attributionNote: "Written by Augustine over thirteen years; the work is his own, though he revised his views in the Retractations.",
    description: spec.description,
    historicalContext: spec.historicalContext,
    availabilityNote: `Streamed from New Advent at read time. ${spec.editionNote}`,
    featured: false,
    featuredNote: "",
    refScheme: "chapter.section",
    isSample: false,
    textStorage: "streamed",
    chapters,
    passages,
    editions: [
      {
        slug: editionSlug,
        language: "en",
        editionType: "translation",
        title: spec.translationTitle,
        translator: spec.translator,
        publisher: "New Advent",
        publicationYear: spec.translationYear,
        source: "newadvent",
        license: "public-domain",
        rightsStatus: "Public domain translation; the online edition is credited to New Advent",
        attributionText: `${spec.translationTitle}, translated by ${spec.translator} (${spec.translationYear}). Public domain. Digital text served by New Advent.`,
        structureScheme: "book, chapter",
        isSample: false,
        notes: spec.editionNote,
      },
    ],
  };

  writeFileSync(join(WORKS, `${spec.slug}.json`), `${JSON.stringify(work, null, 2)}\n`);
  streams.works[spec.slug] = {
    provider: "newadvent",
    upstream: "city-of-god",
    mode: "numbered",
    licence: "public-domain",
    config: {
      pages: usable.map((entry) => entry.url),
      startMarker: NA_SECTION_MARKERS.startMarker,
      endMarker: NA_SECTION_MARKERS.endMarker,
      split: NA_SECTION_MARKERS.split,
    },
    editions: [
      {
        slug: editionSlug,
        language: "en",
        languageName: "english",
        version: spec.translationTitle,
        license: "public-domain",
        sourceUrl: "https://www.newadvent.org/fathers/120101.htm",
      },
    ],
  };
  functions.works[spec.slug] = {
    functions: spec.functions,
    status: "provisional",
    assignedBy: "UWL editors (comparative taxonomy)",
    note: `${spec.title} — ${spec.category}. The English translation is public domain; the online edition is credited to New Advent.`,
  };
  recordWork({
    slug: spec.slug,
    host: "newadvent",
    upstream: "The City of God, books I–XXII",
    chapters: chapters.length,
    passages: passages.length,
    translator: spec.translator,
  });
  console.log(`  ${spec.title}: ${chapters.length} books, ${passages.length} chapters`);
  return { chapters: chapters.length, passages: passages.length };
}

// ---------------------------------------------------------------------------
// Summa Theologica (New Advent)
// ---------------------------------------------------------------------------

const SUMMA_PARTS = [
  { key: "FP", label: "Part I", questionCount: 119, offset: 1000 },
  { key: "FS", label: "Part I-II", questionCount: 114, offset: 2000 },
  { key: "SS", label: "Part II-II", questionCount: 189, offset: 3000 },
  { key: "TP", label: "Part III", questionCount: 90, offset: 4000 },
  { key: "XP", label: "Supplement", questionCount: 99, offset: 5000 },
];

const SUMMA_MARKERS: HtmlSegmentation = {
  startMarker: "<h1>",
  endMarker: '<div id="ogdenville">',
  split: "articles",
};

async function buildSumma() {
  const questions: { part: (typeof SUMMA_PARTS)[number]; q: number; page: string }[] = [];
  for (const part of SUMMA_PARTS) {
    for (let q = 1; q <= part.questionCount; q++) {
      questions.push({ part, q, page: `${part.offset + q}` });
    }
  }

  const results = await pool(questions, concurrency, async (question) => {
    const url = `https://www.newadvent.org/summa/${question.page}.htm`;
    try {
      const html = await getText(url, 45_000);
      const title = cleanLabel(html.match(/<h1>([\s\S]*?)<\/h1>/)?.[1] ?? "");
      const segments = extractHtmlSegments(html, SUMMA_MARKERS);
      return { ...question, title, segments };
    } catch (err) {
      console.warn(`  ! ${url}: ${(err as Error).message}`);
      return null;
    }
  });
  const usable = results.filter((r): r is NonNullable<typeof r> => !!r && r.segments.length > 0);
  if (usable.length < 500) throw new Error(`Summa: only ${usable.length} question pages returned`);

  const chapters = usable.map((entry, index) => ({
    ref: String(index + 1),
    label: `${entry.part.label}, Question ${entry.q}. ${shortLabel(entry.title.replace(/^Question\s+\d+\.?\s*/i, ""))}`,
  }));
  const passages = usable.flatMap((entry, index) =>
    entry.segments.map((text, i) => ({
      reference: `${index + 1}.${i + 1}`,
      label: `${entry.part.label}, Q${entry.q}, Article ${i + 1}`,
      chapterRef: String(index + 1),
    })),
  );

  const slug = "aquinas-summa-theologica";
  const editionSlug = `${slug}-en`;
  const work = {
    slug,
    title: "Summa Theologica",
    originalTitle: "Summa Theologiae",
    transliteration: "",
    altTitles: ["Summa Theologiae"],
    tradition: "christianity",
    school: "scholasticism",
    genre: "Theology and philosophy",
    textType: "Systematic treatise",
    category: "Scholastic theology",
    subcategory: "",
    originalLanguage: "la",
    dateStart: 1265,
    dateEnd: 1273,
    dateDisplay: "1265–1273 CE, unfinished",
    authorshipStatus: "established",
    author: "aquinas",
    attributionNote: "Completed and supplemented by Aquinas's students after his death in 1274; the Supplement is not from his hand.",
    description:
      "Aquinas's systematic theology, arranged as questions and articles. Each article states objections, a counter-argument, a determination and replies. Part I treats God and creation, I-II and II-II the moral life, III the incarnation and sacraments; the Supplement gathers material on penance and last things.",
    historicalContext:
      "Written while Aquinas taught at Rome and Paris, as a teaching text for beginners. He stopped work in December 1273; the Supplement was compiled after his death.",
    availabilityNote:
      "Streamed from New Advent at read time. The English is the 1920 revision of the Fathers of the English Dominican Province translation; the Latin is not hosted in this edition.",
    featured: false,
    featuredNote: "",
    refScheme: "chapter.article",
    isSample: false,
    textStorage: "streamed",
    chapters,
    passages,
    editions: [
      {
        slug: editionSlug,
        language: "en",
        editionType: "translation",
        title: "Summa Theologica — Fathers of the English Dominican Province",
        translator: "Fathers of the English Dominican Province",
        publisher: "New Advent",
        publicationYear: 1920,
        source: "newadvent",
        license: "public-domain",
        rightsStatus: "Public-domain translation; the online edition is credited to New Advent",
        attributionText:
          "The Summa Theologica of St. Thomas Aquinas, literally translated by Fathers of the English Dominican Province, second and revised edition (1920). Public domain. Digital text served by New Advent.",
        structureScheme: "part, question, article",
        isSample: false,
        notes:
          "Each passage is one article: its heading, objections, counter-argument, determination and replies, as New Advent presents them. New Advent's online edition carries its own copyright notice; this library links to and credits that edition rather than copying it.",
      },
    ],
  };

  writeFileSync(join(WORKS, `${slug}.json`), `${JSON.stringify(work, null, 2)}\n`);
  streams.works[slug] = {
    provider: "newadvent",
    upstream: "summa",
    mode: "numbered",
    licence: "public-domain",
    config: {
      pageBase: "https://www.newadvent.org/summa/",
      pages: usable.map((entry) => `${entry.page}.htm`),
      startMarker: SUMMA_MARKERS.startMarker,
      endMarker: SUMMA_MARKERS.endMarker,
      split: SUMMA_MARKERS.split,
    },
    editions: [
      {
        slug: editionSlug,
        language: "en",
        languageName: "english",
        version: "Fathers of the English Dominican Province (1920)",
        license: "public-domain",
        sourceUrl: "https://www.newadvent.org/summa/",
      },
    ],
  };
  functions.works[slug] = {
    functions: ["philosophical_work"],
    status: "provisional",
    assignedBy: "UWL editors (comparative taxonomy)",
    note: "Scholastic theology written as a teaching text. The English translation is public domain; the online edition is credited to New Advent.",
  };
  recordWork({
    slug,
    host: "newadvent",
    upstream: "Summa Theologica",
    chapters: chapters.length,
    passages: passages.length,
    translator: "Fathers of the English Dominican Province",
  });
  console.log(`  ${chapters.length} questions, ${passages.length} articles`);
  return { chapters: chapters.length, passages: passages.length };
}

// ---------------------------------------------------------------------------
// Catalogue-only records
// ---------------------------------------------------------------------------

function buildCatalogueOnly() {
  for (const entry of CATALOGUE_ONLY) {
    const work = {
      slug: entry.slug,
      title: entry.title,
      originalTitle: "",
      transliteration: "",
      altTitles: [],
      tradition: "christianity",
      school: entry.school,
      genre: entry.school === "gnostic-traditions" ? "Gnostic literature" : "Theology and controversy",
      textType: entry.school === "gnostic-traditions" ? "Sayings gospel / dialogue" : "Letters and fragments",
      category: entry.category,
      subcategory: "",
      originalLanguage: entry.originalLanguage,
      dateStart: entry.dateStart,
      dateEnd: entry.dateEnd,
      dateDisplay: entry.dateDisplay,
      authorshipStatus: "disputed",
      attributionNote:
        "Attribution is traditional or disputed. The catalogue records the attribution as a claim in the tradition, not as a settled fact.",
      description: entry.description,
      historicalContext: "",
      availabilityNote: entry.availabilityNote,
      featured: false,
      featuredNote: "",
      refScheme: "chapter.verse",
      isSample: false,
      textStorage: "none",
      chapters: [],
      passages: [],
      editions: [],
    };
    writeFileSync(join(WORKS, `${entry.slug}.json`), `${JSON.stringify(work, null, 2)}\n`);
    functions.works[entry.slug] = {
      functions: [
        entry.school === "gnostic-traditions" ? "non_canonical_religious_text" : "historical_document",
      ],
      status: "provisional",
      assignedBy: "UWL editors (comparative taxonomy)",
      note: entry.availabilityNote,
    };
    delete streams.works[entry.slug];
    recordCatalogue({ slug: entry.slug, title: entry.title, note: entry.availabilityNote });
    console.log(`  ${entry.title}: catalogue record only`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

streams = JSON.parse(readFileSync(STREAMS, "utf8"));
functions = JSON.parse(readFileSync(FUNCTIONS, "utf8"));
// A partial run (--only) updates the manifest rather than replacing it.
const previousManifest = (() => {
  try {
    return JSON.parse(readFileSync(MANIFEST, "utf8"));
  } catch {
    return null;
  }
})();
manifest = {
  source: "christian-sources",
  retrieved_at: RETRIEVED_AT,
  note:
    "Catalogue records, chapter outlines and passage indexes only. Bible verses, patristic sections and Summa articles are streamed from their hosts at read time and are not stored in this corpus.",
  hosts: [
    { id: "bolls", name: "Bolls Bible API", url: "https://bolls.life/", licence: "public-domain" },
    { id: "ccel", name: "Christian Classics Ethereal Library", url: "https://ccel.org/", licence: "public-domain" },
    { id: "newadvent", name: "New Advent", url: "https://www.newadvent.org/", licence: "public-domain" },
  ],
  works: (previousManifest?.works ?? []) as any[],
  catalogueOnly: (previousManifest?.catalogueOnly ?? []) as any[],
  failures: [] as any[],
  totals: { works: 0, chapters: 0, passages: 0 },
};

function recordWork(entry: any) {
  const index = manifest.works.findIndex((w: any) => w.slug === entry.slug);
  if (index >= 0) manifest.works[index] = entry;
  else manifest.works.push(entry);
}

function recordCatalogue(entry: any) {
  const index = manifest.catalogueOnly.findIndex((w: any) => w.slug === entry.slug);
  if (index >= 0) manifest.catalogueOnly[index] = entry;
  else manifest.catalogueOnly.push(entry);
}

const started = Date.now();
if (!only || only === "bible" || BOOKS.some((b) => b.slug === only || b.slug === `bible-${only}`)) {
  const filter = only === "bible" ? "" : only;
  console.log("Bible books");
  const totals = await buildBible(filter);
  console.log(`  ${totals.books} books, ${totals.chapters} chapters, ${totals.passages} verses`);
}
if (!only || only === "fathers" || FATHERS.some((f) => f.slug === only)) {
  console.log("Patristic and scholastic works");
  for (const spec of FATHERS) {
    if (only && only !== "fathers" && only !== spec.slug) continue;
    try {
      if (spec.host === "newadvent") await buildNewAdventBook(spec);
      else await buildCcel(spec);
    } catch (err) {
      // One unavailable host page must not hide the works that did import.
      console.error(`  ! ${spec.slug}: ${(err as Error).message}`);
      manifest.failures.push({ slug: spec.slug, reason: (err as Error).message });
    }
  }
}
if (!only || only === "summa") {
  console.log("Summa Theologica");
  await buildSumma();
}
if (!only || only === "catalogue") {
  console.log("Catalogue records");
  buildCatalogueOnly();
}

manifest.totals.works = manifest.works.length;
manifest.totals.chapters = manifest.works.reduce((sum: number, w: any) => sum + w.chapters, 0);
manifest.totals.passages = manifest.works.reduce((sum: number, w: any) => sum + w.passages, 0);
streams.generatedAt = RETRIEVED_AT;

writeFileSync(STREAMS, `${JSON.stringify(streams, null, 2)}\n`);
writeFileSync(FUNCTIONS, `${JSON.stringify(functions, null, 2)}\n`);
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `${manifest.totals.works} works, ${manifest.totals.chapters} chapters, ${manifest.totals.passages} indexed passages ` +
    `written in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
);
