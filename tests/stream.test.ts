import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bahaiBlocks,
  extractHtmlSegments,
  extractWikisourceSegments,
  heritageMeta,
  heritageVerseText,
  packSentences,
  parseGretilUnits,
  placeHeritageVerses,
  plaintextLines,
  plaintextParagraphs,
  providerLabel,
  segmentsFor,
  splitPlaintextChapters,
  stripGretilMarks,
  stripMarkup,
  toSegments,
} from "../server/stream";
import { STREAM_SHELVES } from "../server/stream-search";

const ROOT = join(import.meta.dir, "..");
const readJson = (path: string) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

const streams = readJson("data/registry/streams.json") as {
  version: number;
  generatedAt: string;
  works: Record<
    string,
    {
      provider: string;
      upstream: string;
      mode: string;
      editions: { slug: string; language: string; languageName: string; version: string }[];
    }
  >;
};

describe("streamed corpus manifest", () => {
  test("covers the Sefaria shelf and names a host for every work", () => {
    const slugs = Object.keys(streams.works);
    expect(slugs.length).toBeGreaterThan(900);
    for (const [slug, work] of Object.entries(streams.works)) {
      expect(work.provider.length).toBeGreaterThan(0);
      expect(work.upstream.length).toBeGreaterThan(0);
      expect(["numbered", "complex"]).toContain(work.mode);
      expect(work.editions.length).toBeGreaterThan(0);
      for (const edition of work.editions) {
        expect(edition.slug.length).toBeGreaterThan(0);
        expect(edition.language.length).toBeGreaterThan(0);
        expect(edition.languageName.length).toBeGreaterThan(0);
        expect(edition.version.length).toBeGreaterThan(0);
      }
      expect(existsSync(join(ROOT, "data/corpus/works", `${slug}.json`))).toBe(true);
    }
  });

  // The manifest now covers more than a thousand works, some with tens of
  // thousands of indexed passages, so parsing every catalogue file needs longer
  // than the default five seconds.
  test("streamed works keep their index but no local text", () => {
    for (const [slug, work] of Object.entries(streams.works)) {
      const file = readJson(`data/corpus/works/${slug}.json`);
      expect(file.textStorage).toBe("streamed");
      expect(file.chapters.length).toBeGreaterThan(0);
      expect(file.passages.length).toBeGreaterThan(0);
      for (const edition of file.editions) {
        expect(edition.texts).toBeUndefined();
      }
      // Every edition addressable upstream is also a catalogued edition.
      const catalogued = new Set(file.editions.map((e: any) => e.slug));
      for (const edition of work.editions) {
        expect(catalogued.has(edition.slug)).toBe(true);
      }
    }
  }, 30_000);

  test("a work is either streamed or held locally, never both", () => {
    for (const [slug] of Object.entries(streams.works)) {
      const file = readJson(`data/corpus/works/${slug}.json`);
      const hasText = (file.editions ?? []).some((e: any) => e.texts && Object.keys(e.texts).length > 0);
      expect(hasText).toBe(false);
    }
  }, 30_000);
});

describe("streamed search shelves", () => {
  test("a shelf maps to providers without duplicating them", () => {
    expect(STREAM_SHELVES.map((shelf) => shelf.slug)).toEqual([
      "quran",
      "hadith",
      "suttacentral",
      "openiti",
      "ctext",
    ]);
    const quran = STREAM_SHELVES.find((shelf) => shelf.slug === "quran")!;
    expect(quran.providers.map((provider) => provider.provider)).toEqual([
      "alquran-cloud",
      "quran-tafsir",
    ]);
    const providers = STREAM_SHELVES.flatMap((shelf) =>
      shelf.providers.map((provider) => provider.provider),
    );
    expect(new Set(providers).size).toBe(providers.length);
  });
});

describe("Bahá’í Reference Library reading view", () => {
  // The library prints each numbered paragraph twice — once as a marginal
  // number of its own and once with its text — and marks a part or chapter
  // title with a class rather than a heading tag.
  const view = `
    <aside class="sidebar"><h2>Downloads</h2><p>Not part of the text</p></aside>
    <div class="library-document-content js-document-content">
      <p class="brl-head brl-title">Part One</p>
      <h3 class="brl-head brl-subtitle">From the Arabic</h3>
      <div class="brl-keeptogether">
        <p class="brl-text-smaller2 brl-margin-number">1. </p>
        <p class="brl-firstline-noindent"><a class="brl-pnum">1</a> O Son of Spirit! My first counsel is this.</p>
      </div>
      <div class="brl-keeptogether">
        <p class="brl-text-smaller2 brl-margin-number">2. </p>
        <p class="brl-firstline-noindent"><a class="brl-pnum">2</a> O Son of Spirit! The best beloved of all things is Justice.</p>
      </div>
      <p class="brl-head brl-global-selection-number">— LXXXIII —</p>
      <p class="brl-firstline-noindent">Lauded and glorified art Thou, O Lord, my God!</p>
    </div>
    <div class="loadmorecontent bottom js-continue js-continue-below"><a href="/next">Continue reading</a></div>
  `;

  test("keeps the headings and paragraphs of the publication only", () => {
    const blocks = bahaiBlocks(view);
    expect(blocks.map((block) => block.heading).filter(Boolean)).toEqual([
      "Part One",
      "From the Arabic",
      "— LXXXIII —",
    ]);
    expect(blocks.filter((block) => block.text).map((block) => block.text)).toEqual([
      "O Son of Spirit! My first counsel is this.",
      "O Son of Spirit! The best beloved of all things is Justice.",
      "Lauded and glorified art Thou, O Lord, my God!",
    ]);
  });

  test("reads the library's own paragraph numbers and drops the marginal copies", () => {
    const paragraphs = bahaiBlocks(view).filter((block) => block.text);
    expect(paragraphs.map((block) => block.number)).toEqual(["1", "2", ""]);
    expect(paragraphs.join("")).not.toContain("1. ");
  });

  test("returns nothing for a page that is not a reading view", () => {
    expect(bahaiBlocks("<html><body><p>About this publication</p></body></html>")).toEqual([]);
  });
});

describe("stream text normalisation", () => {
  test("removes Sefaria's inline markup without collapsing words", () => {
    expect(stripMarkup("<big><strong>מֵאֵימָתַי</strong></big> קוֹרִין")).toBe("מֵאֵימָתַי קוֹרִין");
    expect(stripMarkup("The beginning of tractate <i>Berakhot</i>, the first")).toBe(
      "The beginning of tractate Berakhot, the first",
    );
    expect(stripMarkup("a<br/>b")).toBe("a b");
  });

  test("decodes entities and strips direction marks", () => {
    expect(stripMarkup("light &amp; darkness &quot;quoted&quot;")).toBe('light & darkness "quoted"');
    expect(stripMarkup("&#x5D0; &#1488;")).toBe("א א");
    expect(stripMarkup("M&uuml;ller &Acirc;fr&icirc;nag&acirc;n")).toBe("Müller Âfrînagân");
    expect(stripMarkup("‎text")).toBe("text");
  });

  test("normalises the three shapes Sefaria returns", () => {
    expect(toSegments("one")).toEqual(["one"]);
    expect(toSegments(["one", "two"])).toEqual(["one", "two"]);
    // A chapter of paragraph arrays (the Zohar) keeps one segment per paragraph.
    expect(toSegments([["a", "b"], ["c"]])).toEqual(["a b", "c"]);
    expect(toSegments(["", "  "])).toEqual([]);
  });

  test("splits nested complex chapters down to the passage leaves when that matches", () => {
    // A complex section can arrive as sub-sections of paragraphs.
    const nested = [["a", "b"], ["c", "d"]];
    expect(segmentsFor(nested, 4)).toEqual(["a", "b", "c", "d"]);
    expect(segmentsFor(nested, 2)).toEqual(["a b", "c d"]);
    expect(segmentsFor(["one", "two"], 2)).toEqual(["one", "two"]);
  });

  test("names the hosting projects", () => {
    expect(providerLabel("sefaria")).toBe("Sefaria");
    expect(providerLabel("suttacentral")).toBe("SuttaCentral");
    expect(providerLabel("bolls")).toBe("Bolls Bible API");
    expect(providerLabel("ccel")).toBe("Christian Classics Ethereal Library");
    expect(providerLabel("newadvent")).toBe("New Advent");
    expect(providerLabel("hadith")).toBe("Hadith API (fawazahmed0)");
    expect(providerLabel("wikisource")).toBe("Wikisource");
    expect(providerLabel("gutenberg")).toBe("Project Gutenberg");
    expect(providerLabel("archive")).toBe("Internet Archive");
    expect(providerLabel("sacred-texts")).toBe("Internet Sacred Text Archive");
    expect(providerLabel("bahai")).toBe("Bahá’í Reference Library");
    expect(providerLabel("unknown-project")).toBe("unknown-project");
  });
});

describe("GRETIL plain-text marks", () => {
  // GRETIL's plain-text transformations keep the printed edition's furniture:
  // verse delimiters round a segment, the editor's own number in front of it,
  // the TEI conversion's file tokens and the rules that divide a text. None of
  // them are words, so the reader and the index drop them.
  test("cuts the delimiters and editorial numbers from the ends of a segment", () => {
    expect(stripGretilMarks("// iti kaṇṭhagataprāṇaṃ viditvā //")).toBe("iti kaṇṭhagataprāṇaṃ viditvā");
    expect(stripGretilMarks("| kvs_1,1.1 | mahatīṃ |")).toBe("kvs_1,1.1 | mahatīṃ");
    expect(stripGretilMarks("*1 sadakṣaraṃ brahma ya īśvaraḥ")).toBe("sadakṣaraṃ brahma ya īśvaraḥ");
    expect(stripGretilMarks("*1ab/ yattatsṛṣṭessamākhyātaṃ")).toBe("yattatsṛṣṭessamākhyātaṃ");
  });

  test("drops the conversion's file token and the rules between sections", () => {
    expect(stripGretilMarks(",mang_cd/ chapter 1 vyāsa uvāca")).toBe("chapter 1 vyāsa uvāca");
    expect(stripGretilMarks("oṃ namaḥ ____ iti")).toBe("oṃ namaḥ iti");
    expect(stripGretilMarks("nyāyadarśanam ****** nysbh")).toBe("nyāyadarśanam nysbh");
  });

  test("turns a separator standing between words into a space", () => {
    expect(stripGretilMarks("svarāṭ $ tene brahma")).toBe("svarāṭ tene brahma");
    expect(stripGretilMarks("tamagocaram & govindaṃ")).toBe("tamagocaram govindaṃ");
    // A mark inside a word belongs to the word.
    expect(stripGretilMarks("kṛṣṇa&rāma")).toBe("kṛṣṇa&rāma");
  });

  test("keeps a delimiter the file prints inside a segment", () => {
    expect(stripGretilMarks("pādaḥ / pādaḥ // pādaḥ")).toBe("pādaḥ / pādaḥ // pādaḥ");
  });

  test("a parsed segment keeps its reference and loses its marks", () => {
    // GRETIL closes a unit with its reference, so the text comes first.
    const body = "// iti kaṇṭhagataprāṇaṃ // Abbr_1.1 | yattat // Abbr_1.2";
    const units = parseGretilUnits(body, "Abbr");
    expect(units.map((unit) => unit.ref)).toEqual(["1.1", "1.2"]);
    expect(units.map((unit) => unit.text)).toEqual(["iti kaṇṭhagataprāṇaṃ", "yattat"]);
  });
});

describe("completed Hindu imports", () => {
  test("the Taittiriya Samhita streams all seven kandas from Sacred Texts", () => {
    const work = readJson("data/corpus/works/taittiriya-samhita.json");
    const stream = streams.works["taittiriya-samhita"]!;
    expect(stream.provider).toBe("sacred-texts");
    expect(work.chapters.map((chapter: any) => chapter.ref)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(work.passages.length).toBeGreaterThan(700);
  });

  test("Shankara's commentary is one local work of sixteen padas", () => {
    const work = readJson("data/corpus/works/badarayana-brahma-sutras.json");
    expect(streams.works["badarayana-brahma-sutras"]).toBeUndefined();
    expect(work.chapters).toHaveLength(16);
    expect(work.chapters.at(-1)).toEqual({ ref: "4.4", label: "Adhyaya IV — Pada IV" });
    const texts = work.editions[0].texts;
    expect(Object.keys(texts)).toHaveLength(work.passages.length);
    // Part II (padas ii.3–iv.4) is present, not just the Gutenberg Part I.
    expect(texts["2.3.1"]).toContain("REVERENCE TO THE HIGHEST SELF");
    expect(texts["2.3.2"]).toContain("Ether");
    expect(texts["4.4.40"]).toContain("Nirvâna");
  });

  test("the Uttara Kanda is its own record in Dutt's prose", () => {
    const work = readJson("data/corpus/works/ramayana-uttara-kanda.json");
    const stream = streams.works["ramayana-uttara-kanda"]!;
    expect(stream.provider).toBe("gutenberg");
    expect(work.chapters).toHaveLength(123);
    expect(work.chapters[0].label).toBe("Section 1");
    expect(work.translator ?? work.editions[0].translator).toBe("Manmatha Nath Dutt");
  });
});

describe("Sacred Books of the East shelf", () => {
  const SBE_WORKS = [
    ["vendidad", 22],
    ["yasna", 103],
    ["avesta-yashts", 27],
    ["laws-of-manu", 12],
    ["sankhya-aphorisms", 6],
    ["hatha-yoga-pradipika", 4],
    ["sutta-nipata", 5],
    ["buddhist-suttas", 7],
    ["milindapanha", 27],
    ["buddhist-mahayana-texts", 24],
    ["lotus-sutra", 27],
    ["pahlavi-texts-bundahis", 71],
    ["pahlavi-texts-dadistan", 119],
    ["pahlavi-texts-mainog-i-khirad", 179],
    ["pahlavi-texts-nasks", 145],
    ["pahlavi-texts-marvels", 28],
    ["satapatha-brahmana", 394],
  ] as const;

  test("every volume is catalogued, streamed and indexed chapter by chapter", () => {
    for (const [slug, chapters] of SBE_WORKS) {
      const work = readJson(`data/corpus/works/${slug}.json`);
      const stream = streams.works[slug]!;
      expect(stream, `${slug} has no stream entry`).toBeDefined();
      expect(stream.provider).toBe("sacred-texts");
      expect(work.textStorage).toBe("streamed");
      expect(work.chapters).toHaveLength(chapters);
      expect(work.passages.length).toBeGreaterThan(chapters * 10);
      expect(work.editions[0].source).toBe("sacred-texts");
      expect(work.editions[0].license).toBe("public-domain");
      // Every passage belongs to a listed chapter, so the reader can address it.
      const refs = new Set(work.chapters.map((chapter: any) => chapter.ref));
      for (const passage of work.passages) expect(refs.has(passage.chapterRef)).toBe(true);
      const config = (stream as any).config;
      expect(config.pages).toHaveLength(chapters);
      expect(config.dropPageNumbers).toBe(true);
    }
  });

  test("the three Zoroastrian volumes cover law, liturgy and hymn", () => {
    const vendidad = readJson("data/corpus/works/vendidad.json");
    expect(vendidad.chapters[0].label).toBe("Fargard I");
    expect(vendidad.chapters.at(-1).label).toBe("Fargard XXII");
    const yasna = readJson("data/corpus/works/yasna.json");
    expect(yasna.chapters[0].label).toBe("YASNA XXIX");
    expect(yasna.chapters.some((chapter: any) => chapter.label === "YASNA XLIII")).toBe(true);
    const yashts = readJson("data/corpus/works/avesta-yashts.json");
    expect(yashts.chapters[0].label).toBe("Sîrôzah I");
    expect(yashts.chapters.some((chapter: any) => /Yast/.test(chapter.label))).toBe(true);
  });

  test("the five Pahlavi volumes keep their texts apart", () => {
    const part1 = readJson("data/corpus/works/pahlavi-texts-bundahis.json");
    expect(part1.chapters[0].label).toBe("Bundahis · Chapter I");
    expect(part1.chapters.at(-1).label).toBe("Shayast la-Shayast · Chapter XXIII");
    const part3 = readJson("data/corpus/works/pahlavi-texts-mainog-i-khirad.json");
    expect(part3.chapters[0].label).toBe("Mainog-i Khirad · Chapter I");
    expect(part3.chapters.at(-1).label).toBe("Sad Dar · Chapter C");
    const part4 = readJson("data/corpus/works/pahlavi-texts-nasks.json");
    expect(part4.chapters[0].label).toBe("Denkard VIII · Chapter I");
    expect(part4.chapters.some((chapter: any) => chapter.label === "Denkard IX · Chapter LXIX")).toBe(true);
    const part5 = readJson("data/corpus/works/pahlavi-texts-marvels.json");
    expect(part5.chapters[0].label).toBe("Denkard VII · Chapter I");
    expect(part5.chapters.some((chapter: any) => chapter.label === "Denkard V · Chapter IV")).toBe(true);
  });

  test("the Satapatha Brahmana is one work across its five printed volumes", () => {
    const work = readJson("data/corpus/works/satapatha-brahmana.json");
    expect(work.chapters[0].label).toStartWith("I, 1, 1.");
    expect(work.chapters.at(-1).label).toStartWith("XIV, 3, 2.");
    // The archive's index prints a full stop instead of a comma on a few pages
    // ("III. 9, 1"); the kanda is the leading number either way.
    const kandas = new Set(work.chapters.map((chapter: any) => chapter.label.split(/[.,]/)[0]));
    expect(kandas.size).toBe(14);
    expect((streams.works["satapatha-brahmana"] as any).config.pages).toHaveLength(394);
  });

  test("the Gathas point to the Yasna instead of claiming a separate text", () => {
    const gathas = readJson("data/corpus/works/gathas.json");
    expect(gathas.passages).toHaveLength(0);
    expect(gathas.availabilityNote).toContain("Avesta — Yasna");
    expect(gathas.availabilityNote).toContain("XXVIII");
  });
});

describe("Pali canon: monastic law and birth stories", () => {
  test("the Vinaya is one work across its three printed volumes", () => {
    const work = readJson("data/corpus/works/vinaya-texts.json");
    expect(work.chapters).toHaveLength(321);
    expect(work.chapters[0].label).toBe("Patimokkha · Nidāna");
    expect(work.chapters[13].label).toBe("Mahavagga V, Chapter 1");
    // The Mahavagga's ninth khandhaka opens on the page that closes the eighth.
    expect(work.chapters[110].label).toBe("Mahavagga VIII, Chapter 32 and Mahavagga IX, Chapter 1");
    // Two printed chapters can share a page; the label names both rather than
    // dropping one from the outline.
    expect(work.chapters.some((chapter: any) => chapter.label === "Kullavagga I, Chapters 26 and 27")).toBe(
      true,
    );
    expect(work.chapters.at(-1).label).toBe("Kullavagga XII, Chapter 2");
    expect((streams.works["vinaya-texts"] as any).config.pages).toHaveLength(321);
  });

  test("the Jataka holds all 547 stories in printed order", () => {
    const work = readJson("data/corpus/works/jataka.json");
    expect(work.chapters).toHaveLength(547);
    const numbers = work.chapters.map((chapter: any) => Number(/^No\.?\s*(\d+)/.exec(chapter.label)?.[1]));
    expect(numbers).toEqual(Array.from({ length: 547 }, (_, index) => index + 1));
    expect(work.chapters[0].label).toBe("No. 1. Apaṇṇaka-Jātaka");
    expect(work.chapters.at(-1).label).toBe("No. 547.: Vessantara-Jātaka.");
    const config = (streams.works["jataka"] as any).config;
    expect(config.pages).toHaveLength(547);
    // One page in volume III belongs to an older transcription whose text
    // opens under a dotted rule; the reader is told so per page.
    const dotted = config.pages.find((page: any) => /j3115\.htm$/.test(page.url));
    expect(dotted?.startMarker).toBe("<HR>.</p>");
  });
});

describe("Vedic shelf: the four Vedas, the Vedic Hymns and the law books", () => {
  test("the Samaveda is one page split into its fifteen printed books", () => {
    const work = readJson("data/corpus/works/samaveda.json");
    expect(work.chapters).toHaveLength(15);
    expect(work.chapters[0].label).toBe("First Part — Book I");
    expect(work.chapters.at(-1).label).toBe("Part Second — Book IX");
    const config = (streams.works["samaveda"] as any).config;
    expect(config.pages).toHaveLength(15);
    // Every chapter is a slice of the same page, and the slices abut.
    expect(new Set(config.pages.map((page: any) => page.url)).size).toBe(1);
    expect(config.pages[1].from).toBe(config.pages[0].to);
    expect(config.pages.at(-1).to).toBeGreaterThan(config.pages[0].from);
  });

  test("the Atharvaveda is expanded from twenty contents pages into its hymns", () => {
    const work = readJson("data/corpus/works/atharvaveda.json");
    expect(work.chapters.length).toBeGreaterThan(700);
    expect(work.chapters[0].label).toMatch(/^Hymn 1/);
    // The running navigation of the contents pages is not a chapter.
    expect(work.chapters.some((chapter: any) => /^(?:Next|Index)\b/.test(chapter.label))).toBe(false);
    const pages = (streams.works["atharvaveda"] as any).config.pages;
    expect(pages.length).toBe(work.chapters.length);
    expect(pages[0].url).toMatch(/av01001\.htm$/);
  });

  test("the remaining Vedic volumes carry their printed chapter counts", () => {
    expect(readJson("data/corpus/works/white-yajurveda.json").chapters).toHaveLength(40);
    expect(readJson("data/corpus/works/atharva-veda-hymns.json").chapters).toHaveLength(215);
    expect(readJson("data/corpus/works/vedic-hymns-maruts.json").chapters).toHaveLength(49);
    expect(readJson("data/corpus/works/vedic-hymns-agni.json").chapters).toHaveLength(130);
    expect(readJson("data/corpus/works/thirty-minor-upanishads.json").chapters).toHaveLength(30);
    // Macdonell's Reader keeps the introduction before the first hymn section.
    const reader = readJson("data/corpus/works/vedic-reader.json");
    expect(reader.chapters[0].label).toBe("Introduction");
    expect(reader.chapters.length).toBeGreaterThan(25);
  });

  test("the dharmasastra volumes start at their first chapter, not the preface", () => {
    expect(readJson("data/corpus/works/sacred-laws-aryas-1.json").chapters[0].label).toContain("Prasna I");
    expect(readJson("data/corpus/works/sacred-laws-aryas-2.json").chapters[0].label).toBe("Chapter I");
    expect(readJson("data/corpus/works/institutes-of-vishnu.json").chapters).toHaveLength(100);
    const minor = readJson("data/corpus/works/minor-law-books.json");
    expect(minor.chapters[0].label).toBe("I. Legal Procedure");
    expect(minor.chapters).toHaveLength(81);
  });
});

describe("Christian and Buddhist shelves from the Sacred Text Archive", () => {
  const works = [
    ["udana", 8],
    ["therigatha", 16],
    ["buddhacarita", 28],
    ["bodhicaryavatara", 9],
    ["apostolic-fathers", 230],
    ["dionysius-areopagite", 51],
    ["anselm", 111],
    ["cloud-of-unknowing", 77],
    ["imitation-of-christ", 115],
  ] as const;

  test("every work is catalogued, streamed and addressed chapter by chapter", () => {
    for (const [slug, chapters] of works) {
      const work = readJson(`data/corpus/works/${slug}.json`);
      const stream = (streams.works as any)[slug];
      expect(stream, `${slug} has no stream entry`).toBeDefined();
      expect(stream.provider).toBe("sacred-texts");
      expect(work.textStorage).toBe("streamed");
      expect(work.chapters).toHaveLength(chapters);
      expect(work.editions[0].source).toBe("sacred-texts");
      expect(work.editions[0].license).toBe("public-domain");
      const refs = new Set(work.chapters.map((chapter: any) => chapter.ref));
      for (const passage of work.passages) expect(refs.has(passage.chapterRef)).toBe(true);
      expect(stream.config.pages).toHaveLength(chapters);
    }
  });

  test("the Udāna and the Therīgāthā complete the Khuddaka Nikāya", () => {
    const udana = readJson("data/corpus/works/udana.json");
    expect(udana.chapters[0].label).toBe("The Enlightenment");
    expect(udana.chapters.at(-1).label).toBe("Patalagami");
    expect(udana.translator ?? udana.editions[0].translator).toBe("G. M. Strong");
    const therigatha = readJson("data/corpus/works/therigatha.json");
    expect(therigatha.chapters[0].label).toBe("Canto I. Psalms of Single Verses");
    expect(therigatha.chapters.at(-1).label).toBe("Canto XVI. Psalms of The Great Chapter");
    expect(therigatha.editions[0].translator).toBe("C. A. F. Rhys Davids");
  });

  test("the Life of Buddha and the Bodhicaryāvatāra keep their printed divisions", () => {
    const life = readJson("data/corpus/works/buddhacarita.json");
    expect(life.chapters[0].label).toBe("Varga 1. The Birth");
    expect(life.chapters.at(-1).label).toBe("Varga 28. Division of the Sarîras");
    const bodhi = readJson("data/corpus/works/bodhicaryavatara.json");
    expect(bodhi.chapters[0].label).toBe("Chapter I. The Praise of the Thought of Enlightenment");
    // Barnett translated nine of the ten Sanskrit chapters.
    expect(bodhi.chapters).toHaveLength(9);
    expect(bodhi.chapters.at(-1).label).toBe("Chapter IX. The Perfect Knowledge");
  });

  test("the Apostolic Fathers keeps its nine documents apart", () => {
    const work = readJson("data/corpus/works/apostolic-fathers.json");
    expect(work.chapters[0].label).toBe("1 Clement — Chapter I");
    expect(work.chapters.at(-1).label).toBe("Papias — X.");
    // The archive truncates its own index labels; the summary is not carried.
    expect(work.chapters.some((chapter: any) => chapter.label.includes("…") || chapter.label.includes("..."))).toBe(false);
    const documents = new Set(work.chapters.map((chapter: any) => chapter.label.split(" — ")[0]));
    expect([...documents]).toEqual([
      "1 Clement",
      "Diognetus",
      "Polycarp, Philippians",
      "Martyrdom of Polycarp",
      "Ignatius, Ephesians",
      "Ignatius, Magnesians",
      "Ignatius, Trallians",
      "Ignatius, Romans",
      "Ignatius, Philadelphians",
      "Ignatius, Smyrnaeans",
      "Ignatius, Polycarp",
      "Barnabas",
      "Papias",
    ]);
  });

  test("the Dionysian corpus, Anselm, the Cloud and the Imitation keep their books", () => {
    const dionysius = readJson("data/corpus/works/dionysius-areopagite.json");
    expect(dionysius.chapters[0].label).toBe("The Divine Names — Caput I");
    expect(dionysius.chapters.at(-1).label).toBe("The Ecclesiastical Hierarchy — Caput VII");
    expect(new Set(dionysius.chapters.map((chapter: any) => chapter.label.split(" — ")[0])).size).toBe(5);

    const anselm = readJson("data/corpus/works/anselm.json");
    expect(anselm.chapters[0].label).toBe("Proslogium — Chapter I");
    expect(anselm.chapters.at(-1).label).toBe("Cur Deus Homo — Book Second");
    expect(anselm.chapters.some((chapter: any) => chapter.label === "Appendix — In Behalf of the Fool")).toBe(true);

    const cloud = readJson("data/corpus/works/cloud-of-unknowing.json");
    expect(cloud.chapters[0].label).toBe("Prayer");
    expect(cloud.chapters.at(-1).label).toBe("Chapter 75");
    const cloudConfig = (streams.works["cloud-of-unknowing"] as any).config;
    // An older transcription: the banner ends with the rule itself, and the
    // inline "Next" link is excluded by the end marker.
    expect(cloudConfig.startMarker).toContain("at sacred-texts.com");
    expect(cloudConfig.endMarker).toBe("<p><hr/>");

    const imitation = readJson("data/corpus/works/imitation-of-christ.json");
    expect(imitation.chapters[0].label).toBe("Book I — Chapter I");
    expect(imitation.chapters.at(-1).label).toBe("Book IV — Chapter XVIII");
    const books = new Set(imitation.chapters.map((chapter: any) => chapter.label.split(" — ")[0]));
    expect([...books]).toEqual(["Book I", "Book II", "Book III", "Book IV"]);
  });
});

describe("Sikh shelf from the Sacred Text Archive", () => {
  const works = [
    ["the-sikh-religion", 24],
    ["religion-of-the-sikhs", 4],
  ] as const;

  test("the two public-domain works are catalogued, streamed and authored", () => {
    for (const [slug, chapters] of works) {
      const work = readJson(`data/corpus/works/${slug}.json`);
      const stream = (streams.works as any)[slug];
      expect(stream, `${slug} has no stream entry`).toBeDefined();
      expect(stream.provider).toBe("sacred-texts");
      expect(work.tradition).toBe("sikhism");
      expect(work.textStorage).toBe("streamed");
      expect(work.chapters).toHaveLength(chapters);
      expect(work.editions[0].source).toBe("sacred-texts");
      expect(work.editions[0].license).toBe("public-domain");
      // Both are English works of their authors, not translations of an older text.
      expect(work.editions[0].editionType).toBe("original");
      expect(stream.config.pages).toHaveLength(chapters);
      const refs = new Set(work.chapters.map((chapter: any) => chapter.ref));
      for (const passage of work.passages) expect(refs.has(passage.chapterRef)).toBe(true);
    }
  });

  test("MacAuliffe's volume keeps the life of Nanak and the translated liturgies", () => {
    const work = readJson("data/corpus/works/the-sikh-religion.json");
    expect(work.chapters[0].label).toBe("Introduction");
    expect(work.chapters[1].label).toBe("Life Of Guru Nanak: Chapter I");
    expect(work.chapters[18].label).toBe("Japji");
    expect(work.chapters.at(-1).label).toBe("Additional Sloks");
    // Only volume one is on the archive; the note must not claim the six.
    expect(work.availabilityNote).toContain("Volume 1 only");
    expect(work.availabilityNote).toContain("Volumes 2–6");
  });

  test("the complete Granth is held locally under the written permission", () => {
    const granth = readJson("data/corpus/works/guru-granth-sahib.json");
    expect(granth.chapters).toHaveLength(1430);
    expect(granth.passages).toHaveLength(60477);
    expect(granth.refScheme).toBe("ang.sentence");
    // Two editions, the Gurmukhi and Khalsa's English, both under permission and
    // both aligned to the same sentence divisions.
    expect(granth.editions).toHaveLength(2);
    for (const edition of granth.editions) {
      expect(edition.source).toBe("srigranth");
      expect(edition.license).toBe("by-permission");
      expect(Object.keys(edition.texts)).toHaveLength(60477);
    }
    expect(granth.editions[0].texts["1.1"]).toContain("ੴ ਸਤਿ ਨਾਮੁ");
    expect(granth.editions[1].texts["1.1"]).toContain("One Universal Creator God");
    // The text is local, not a streamed remote edition.
    expect((streams.works as any)["guru-granth-sahib"]).toBeUndefined();
  });

  test("the wider Sikh corpus is recorded with leads and rights positions", () => {
    const targets = readJson("data/registry/acquisition.json").targets as any[];
    const sikh = targets.filter((target) => target.tradition === "sikhism");
    expect(sikh.length).toBe(26);
    expect(new Set(sikh.map((target) => target.slug)).size).toBe(sikh.length);
    const statuses = new Set(sikh.map((target) => target.status));
    expect([...statuses].sort()).toEqual(["imported", "located", "rights_blocked"]);
    for (const target of sikh) {
      expect(target.source_leads.length).toBeGreaterThan(0);
      expect(target.rights_note.length).toBeGreaterThan(20);
    }
  });
});

describe("the Bahá’í shelf from the Reference Library", () => {
  // The ten published works the library serves as reading views, with the
  // chapter and passage counts the import wrote.
  const works = [
    ["hidden-words", 2, 160],
    ["kitab-i-aqdas", 3, 463],
    ["kitab-i-iqan", 2, 291],
    ["seven-valleys", 1, 95],
    ["four-valleys", 1, 49],
    ["gleanings-writings-bahaullah", 166, 717],
    ["some-answered-questions", 84, 781],
    ["epistle-son-wolf", 1, 270],
    ["tablets-bahaullah", 17, 669],
    ["prayers-meditations", 184, 878],
  ] as const;

  test("every work is catalogued, streamed and addressed by reading view", () => {
    for (const [slug, chapters, passages] of works) {
      const work = readJson(`data/corpus/works/${slug}.json`);
      const stream = (streams.works as any)[slug];
      expect(stream, `${slug} has no stream entry`).toBeDefined();
      expect(stream.provider).toBe("bahai");
      expect(stream.licence).toBe("bahai-reference-library-terms");
      expect(work.tradition).toBe("bahai");
      expect(work.textStorage).toBe("streamed");
      expect(work.chapters).toHaveLength(chapters);
      expect(work.passages).toHaveLength(passages);
      expect(work.editions[0].source).toBe("bahai-reference-library");
      expect(work.editions[0].license).toBe("bahai-reference-library-terms");
      expect(work.editions[0].rightsStatus).toContain("Bahá’í International Community");
      // The reader is told which reading views the chapter needs and which of
      // their paragraphs belong to it.
      expect(stream.config.fragments.length).toBeGreaterThan(0);
      expect(Object.keys(stream.config.chapters)).toHaveLength(chapters);
      const refs = new Set(work.chapters.map((chapter: any) => chapter.ref));
      for (const passage of work.passages) expect(refs.has(passage.chapterRef)).toBe(true);
      for (const section of Object.values<any>(stream.config.chapters)) {
        expect(section.fragments.length).toBeGreaterThan(0);
        expect(section.to).toBeGreaterThanOrEqual(section.from);
      }
    }
  });

  test("the publication's own numbering is the passage reference", () => {
    // The Hidden Words numbers its passages from one in each part, and prints
    // the invocation before the first of them without a number.
    const hiddenWords = readJson("data/corpus/works/hidden-words.json");
    const hiddenRefs = hiddenWords.passages.map((passage: any) => passage.reference);
    expect(hiddenRefs.slice(0, 3)).toEqual(["1.u1", "1.u2", "1.1"]);
    expect(hiddenRefs).toContain("1.71");
    expect(hiddenRefs).toContain("2.82");

    // The Aqdas ends with the Questions and Answers, whose answers carry no
    // number of their own.
    const aqdas = readJson("data/corpus/works/kitab-i-aqdas.json");
    expect(aqdas.passages.map((passage: any) => passage.reference).at(-1)).toBe("3.107");
    expect(aqdas.chapters.map((chapter: any) => chapter.label)).toEqual([
      "The Kitáb-i-Aqdas",
      "Some Texts Revealed by Bahá’u’lláh Supplementary to the Kitáb-i-Aqdas",
      "Questions and Answers",
    ]);

    // The Iqan is not numbered by the library: its two parts are indexed in
    // reading order, each closing with the ruled "END OF PART" divider, which
    // is furniture and not a passage of the text.
    const iqan = readJson("data/corpus/works/kitab-i-iqan.json");
    expect(iqan.passages[0].reference).toBe("1.1");
    expect(iqan.passages.at(-1).reference).toBe("2.189");
  });

  test("the compilations keep the library's own divisions", () => {
    const gleanings = readJson("data/corpus/works/gleanings-writings-bahaullah.json");
    expect(gleanings.chapters[0].label).toBe("Selection I");
    expect(gleanings.chapters.at(-1).label).toBe("Selection CLXVI");

    const prayers = readJson("data/corpus/works/prayers-meditations.json");
    expect(prayers.chapters[0].label).toBe("Prayer I");
    expect(prayers.chapters.at(-1).label).toBe("Prayer CLXXXIV");

    const tablets = readJson("data/corpus/works/tablets-bahaullah.json");
    expect(tablets.chapters[0].label).toBe("1 — Lawḥ-i-Karmil — (Tablet of Carmel)");
    expect(tablets.chapters.at(-1).label).toBe("17 — Excerpts from Other Tablets");
    // A footnote marker would have left "(The Most Holy Tablet)1" behind.
    expect(tablets.chapters[1].label).toBe("2 — Lawḥ-i-Aqdas — (The Most Holy Tablet)");

    const answered = readJson("data/corpus/works/some-answered-questions.json");
    expect(answered.chapters[0].label).toContain("Nature Is Governed by a Universal Law");
    expect(answered.chapters.at(-1).label).toBe("84 — Good Deeds and Their Spiritual Prerequisites");
    expect(answered.passages.map((passage: any) => passage.reference).at(-1)).toBe("84.13");
  });

  test("no Bahá’í text is written into the corpus", () => {
    // Every work of the shelf, whether its divisions were written out by hand or
    // read from the library's own catalogue.
    const shelf = (readJson("data/imports/bahai.json").works as any[]).map((work) => work.slug as string);
    for (const slug of [...new Set([...works.map(([slug]) => slug), ...shelf])]) {
      const work = readJson(`data/corpus/works/${slug}.json`);
      for (const edition of work.editions) expect(edition.texts).toBeUndefined();
      for (const passage of work.passages) {
        expect(Object.keys(passage).sort()).toEqual(["chapterRef", "label", "reference"]);
      }
    }
  });

  test("the source and the register record the authorisation and the rights", () => {
    const sources = readJson("data/registry/sources.json").sources as any[];
    const source = sources.find((entry) => entry.source_id === "bahai-reference-library");
    expect(source).toBeDefined();
    expect(source.approval_status).toBe("approved");
    expect(source.ingestion_status).toBe("active");
    expect(source.licence_status).toBe("site_copyright_conditions_with_owner_authorisation");
    expect(source.commercial_use_allowed).toBe(false);
    expect(source.redistribution_allowed).toBe(null);
    expect(source.editorial_notes).toContain("authorised by the project owner on 2026-10-26");

    const targets = (readJson("data/registry/acquisition.json").targets as any[]).filter(
      (target) => target.tradition === "bahai",
    );
    // Every work this import holds is registered, and the ten works that were
    // written out by hand are among them.
    const shelf = new Set((readJson("data/imports/bahai.json").works as any[]).map((work) => work.slug));
    const registered = new Set(targets.map((target) => target.slug));
    expect(registered.size).toBeGreaterThanOrEqual(shelf.size);
    for (const slug of shelf) expect(registered.has(slug)).toBe(true);
    for (const target of targets) {
      expect(target.status).toBe("imported");
      // The lead is the work's own address in the library, in whichever of its
      // sections the work is published.
      const path = target.note.split("(")[1]!.split(")")[0];
      expect(target.source_leads[0].url).toBe(`https://www.bahai.org/library/${path}`);
      expect(target.languages).toEqual(["en"]);
      expect(target.rights_note).toContain("copyright of the Bahá’í International Community");
    }
  });
});

describe("Heritage Scripture Server replies", () => {
  // The verse is served beside the server's own metadata, and the field it is
  // named by is the server's; the reader has to find the text whatever it is
  // called and leave the licence and watermark alone.
  const verse = "अर्जुन उवाच |";
  test("finds the Sanskrit verse in the shapes the server uses", () => {
    expect(heritageVerseText({ moolam: verse })).toBe(verse);
    expect(heritageVerseText({ text: verse })).toBe(verse);
    expect(heritageVerseText({ data: { verse_text: verse } })).toBe(verse);
    expect(heritageVerseText(verse)).toBe(verse);
    expect(heritageVerseText({ moolam: { text: verse } })).toBe(verse);
  });

  test("returns nothing rather than an empty pane's worth of markup", () => {
    expect(heritageVerseText({ _meta: { license: "HCAL-1.1" }, moolam: "   " })).toBe("");
    expect(heritageVerseText(null)).toBe("");
    expect(heritageVerseText({ detail: "Authentication credentials were not provided." })).toBe("");
  });

  test("keeps the licence identifier and the watermark the server sends", () => {
    expect(heritageMeta({ _meta: { license: "HCAL-1.1", watermark: "Heritage IITKanpur" } })).toEqual({
      licence: "HCAL-1.1",
      watermark: "Heritage IITKanpur",
    });
    expect(heritageMeta({})).toEqual({ licence: "HCAL-1.1", watermark: "" });
  });

  test("the provider is named on the record it streams from", () => {
    expect(providerLabel("heritage")).toBe("Heritage Scripture Server (IIT Kanpur)");
  });

  // The verses are read a few at a time and a read can stop halfway; the text
  // that did arrive has to stay under the verse it belongs to.
  test("a verse that was not served leaves its place rather than moving the next one", () => {
    const addresses = ["2.47", "2.48", "2.49", "2.50"];
    const served = ["कर्मण्येवाधिकारस्ते", "", "", "श्रद्धावाँल्लभते ज्ञानम्"];
    expect(placeHeritageVerses(addresses, served)).toEqual([
      "कर्मण्येवाधिकारस्ते",
      "",
      "",
      "श्रद्धावाँल्लभते ज्ञानम्",
    ]);
  });

  test("a chapter read up to its verse limit keeps one slot for every verse", () => {
    const addresses = ["1.1", "1.2", "1.3"];
    expect(placeHeritageVerses(addresses, ["first", "second"])).toEqual(["first", "second", ""]);
    expect(placeHeritageVerses(addresses, [])).toEqual(["", "", ""]);
  });
});

describe("Bible and patristic text cleaning", () => {
  test("drops Strong's numbers without removing the words they annotate", () => {
    expect(stripMarkup("In the beginning<S>7225</S> God<S>430</S> created<S>1254</S>.")).toBe(
      "In the beginning God created.",
    );
  });

  test("decodes the named entities CCEL and New Advent use", () => {
    expect(stripMarkup("Chapter 3.&mdash; Of C&aelig;sar's house")).toBe("Chapter 3.— Of Cæsar's house");
    // An unknown entity is left alone rather than turned into nothing.
    expect(stripMarkup("a &bogus; b")).toBe("a &bogus; b");
  });
});

describe("hosted HTML segmentation", () => {
  const paragraphs = {
    startMarker: 'class="book-content">',
    endMarker: 'id="book_navbar_bottom"',
    split: "paragraphs" as const,
  };

  test("keeps prose paragraphs and drops page furniture", () => {
    const html = `<div class="book-content"><h2>Chapter I</h2>
      <p id="p1">Great art Thou, O Lord, and greatly to be praised.</p>
      <p class="footnote">1. A note that is not part of the text.</p>
      <p>12</p>
      <p>Next »</p>
      <p>And how shall I call upon my God?</p></div><table id="book_navbar_bottom"></table>`;
    expect(extractHtmlSegments(html, paragraphs)).toEqual([
      "Great art Thou, O Lord, and greatly to be praised.",
      "And how shall I call upon my God?",
    ]);
  });

  test("splits a New Advent book at its chapter headings", () => {
    const html = `<h1>The City of God (Book I)</h1>
      <h2>Preface, Explaining His Design.</h2><p>First paragraph of the preface.</p>
      <h2>Chapter 1.&mdash; Of the Adversaries.</h2><p>First paragraph of chapter one.</p><p>Second paragraph.</p>
      <div id="ogdenville"></div>`;
    const out = extractHtmlSegments(html, { startMarker: "<h1>", endMarker: '<div id="ogdenville">', split: "sections" });
    expect(out).toEqual([
      "Preface, Explaining His Design. — First paragraph of the preface.",
      "Chapter 1.— Of the Adversaries. — First paragraph of chapter one.\n\nSecond paragraph.",
    ]);
  });

  test("an article split ignores headings that are not articles", () => {
    const html = `<h1>Question 1. The nature of doctrine</h1>
      <h2>Question summary</h2><p>Summary paragraph.</p>
      <h2 id="article1">Article 1. Whether doctrine is needed?</h2><p>Objection 1.</p><p>I answer that.</p>
      <h2 id="article2">Article 2. Whether it is a science?</h2><p>Objection 1.</p>
      <div id="ogdenville"></div>`;
    const out = extractHtmlSegments(html, { startMarker: "<h1>", endMarker: '<div id="ogdenville">', split: "articles" });
    expect(out).toHaveLength(2);
    expect(out[0]).toStartWith("Article 1. Whether doctrine is needed? — Objection 1.");
    expect(out[1]).toContain("Article 2");
  });

  test("drops printed page numbers and rules when a volume asks for it", () => {
    const html = `<HR></p><p>{p. 12}</p><p>p. 13</p><p>____________________</p>
      <p>First paragraph of the chapter.</p><p>p. 366 p. 367</p><p>Second paragraph.</p>
      <HR><nav role="navigation">footer</nav>`;
    expect(
      extractHtmlSegments(html, { startMarker: "<HR></p>", endMarker: "<nav role=", split: "paragraphs", dropPageNumbers: true }),
    ).toEqual(["First paragraph of the chapter.", "Second paragraph."]);
    // Without the option the page furniture is kept, as before.
    expect(
      extractHtmlSegments(html, { startMarker: "<HR></p>", endMarker: "<nav role=", split: "paragraphs" }),
    ).toHaveLength(6);
  });

  test("a page that is only a heading yields that heading rather than nothing", () => {
    const html = `<HR></p><h3>YASNA LXIV (SP. LXIII).</h3><h4>(See Y. XLVI, 3.)</h4><HR><nav role="navigation"></nav>`;
    expect(
      extractHtmlSegments(html, { startMarker: "<HR></p>", endMarker: "<nav role=", split: "paragraphs", dropPageNumbers: true }),
    ).toEqual(["YASNA LXIV (SP. LXIII). (See Y. XLVI, 3.)"]);
  });

  test("a missing container returns no segments rather than the whole page", () => {
    expect(extractHtmlSegments("<html><body><p>text</p></body></html>", paragraphs)).toEqual([]);
  });
});

describe("Wikisource and Gutenberg text", () => {
  test("keeps poem lines and sentences, drops running heads and placeholders", () => {
    const html = `<div class="mw-content-ltr mw-parser-output">
      <style>.mw-parser-output .ws-poem-line{text-indent:-2em}</style>
      <div class="ws-noexport"><span>header</span></div>
      <p>THE</p>
      <div class="ws-poem ws-poem-hi"><div class="ws-poem-stanza">
        <span class="ws-poem-versenum">1. </span><span class="ws-poem-line">Would that I were aware.<span class="ws-poem-break"><br /></span></span>
        <span class="ws-poem-versenum">2. </span><span class="ws-poem-line">And would that my heart knew.</span>
      </div></div>
      <p>(Arabic characters)</p>
      <p>A prose paragraph that belongs to the text.</p>
      <p>page</p></div>`;
    expect(extractWikisourceSegments(html)).toEqual([
      "1. Would that I were aware.",
      "2. And would that my heart knew.",
      "A prose paragraph that belongs to the text.",
    ]);
  });

  test("keeps one verse per segment when a poem is set with <br> line breaks", () => {
    const html = `<div class="mw-parser-output"><p>Line one of the poem,<br />
      Line two of the poem,<br />
      Line three of the poem.</p>
      <p>A prose note that stays one segment.</p></div>`;
    expect(extractWikisourceSegments(html, { splitBreaks: true })).toEqual([
      "Line one of the poem,",
      "Line two of the poem,",
      "Line three of the poem.",
      "A prose note that stays one segment.",
    ]);
    // Without the option the poem stays a single paragraph.
    expect(extractWikisourceSegments(html)).toHaveLength(2);
  });

  test("keeps one line per verse and drops line numbers and licence furniture", () => {
    const verse = ["THE DIVAN", "", "I", "", "Arise, oh Cup-bearer, rise!", "", "12", "", "*** END OF THE PROJECT GUTENBERG EBOOK***"].join("\n");
    expect(plaintextLines(verse)).toEqual(["THE DIVAN", "Arise, oh Cup-bearer, rise!"]);
  });

  test("the Gutenberg licence block is not part of the last chapter", () => {
    const text = ["CHAPTER I", "", "The chapter body.", "", "*** END OF THE PROJECT GUTENBERG EBOOK A BOOK ***", "", "Licence paragraph."].join("\n");
    const chapters = splitPlaintextChapters(text, [{ ref: "1", marker: "CHAPTER I" }]);
    expect(plaintextParagraphs(chapters.get("1") ?? "")).toEqual(["The chapter body."]);
  });

  test("splits one edition at its printed chapter headings and stops at footnotes", () => {
    const text = [
      "A Book",
      "",
      "CONTENTS",
      "    INTRODUCTION                                    7",
      "    FIRST SECTION                                  11",
      "",
      "INTRODUCTION",
      "",
      "Body one wraps across",
      "a second line.",
      "",
      "Body two.",
      "",
      "FIRST SECTION",
      "",
      "Second chapter body.",
      "",
      "FOOTNOTES:",
      "1. A note that is not part of the text.",
    ].join("\n");
    const chapters = splitPlaintextChapters(text, [
      { ref: "1", marker: "INTRODUCTION", occurrence: "last" },
      { ref: "2", marker: "FIRST SECTION" },
    ]);
    expect(plaintextParagraphs(chapters.get("1") ?? "")).toEqual(["Body one wraps across a second line.", "Body two."]);
    expect(plaintextParagraphs(chapters.get("2") ?? "")).toEqual(["Second chapter body."]);
  });

  test("repacks unbroken prose into paragraphs at sentence boundaries", () => {
    const wall = "First sentence here. Second sentence follows! Third one asks a question? A fourth ends it.";
    const packed = packSentences(wall, 8);
    expect(packed.length).toBeGreaterThan(1);
    // Every word and every full stop survives the repacking.
    expect(packed.join(" ")).toBe(wall);
    for (const paragraph of packed) expect(paragraph.split(/\s+/).length).toBeLessThanOrEqual(12);
    expect(packSentences(wall, 500)).toHaveLength(1);
  });

  test("strips the edition's emphasis marks without removing words", () => {
    expect(plaintextParagraphs("“_In the name of the most merciful God._”")).toEqual([
      "“In the name of the most merciful God.”",
    ]);
    expect(plaintextParagraphs("=To Establish the Existence of the Soul.=")).toEqual([
      "To Establish the Existence of the Soul.",
    ]);
  });
});
