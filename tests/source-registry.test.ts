import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractBetween } from "../ingest/adapters/gutenberg";

const ROOT = join(import.meta.dir, "..");
const readJson = (path: string) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

const registry = readJson("data/registry/sources.json") as {
  version: string;
  note: string;
  sources: Record<string, any>[];
};
const meta = readJson("data/corpus/meta.json") as {
  traditions: { slug: string }[];
  languages: { code: string }[];
};
const manifest = readJson("data/imports/gutenberg-75559-fox.json") as {
  sourceId: string;
  adapter: string;
  adapterVersion: string;
  importedAt: string;
  licence: string;
  sourceFileSha256: string;
  passages: { reference: string; text: string; checksum: string; startLine: number; endLine: number }[];
};
const foxWork = readJson("data/corpus/works/journal-of-george-fox.json") as {
  editions: { source: string; license: string; texts: Record<string, string> }[];
};
const streamsManifest = readJson("data/registry/streams.json") as {
  version: number;
  works: Record<
    string,
    {
      provider: string;
      upstream: string;
      mode: "numbered" | "complex";
      editions: { slug: string; language: string; languageName: string; version: string }[];
    }
  >;
};

const mishnahManifest = readJson("data/imports/sefaria-mishnah.json") as {
  source: string;
  editions: { hebrew: { title: string; licence: string }; english: { title: string; licence: string } };
  totals: { tractates: number; chapters: number; mishnayot: number };
  tractates: {
    title: string;
    slug: string;
    seder: string;
    chapters: number;
    mishnayot: number;
    english_mishnayot: number;
    sha256: string;
    licence: string;
    english_licence: string | null;
  }[];
};
const sefariaManifest = readJson("data/imports/sefaria-tanakh.json") as {
  source: string;
  versions: { hebrew: { title: string; licence: string }; english: { title: string; licence: string } };
  totals: { books: number; chapters: number; hebrewVerses: number; englishVerses: number };
  books: {
    title: string;
    slug: string;
    division: string;
    chapters: number;
    hebrewVerses: number;
    englishVerses: number;
    sha256: string;
    hebrew_licence: string;
    english_licence: string;
  }[];
};
const libraryManifest = readJson("data/imports/sefaria-library.json") as {
  source: string;
  totals: { works: number; skipped: number; chapters: number; passages: number };
  works: {
    title: string;
    slug: string;
    category: string;
    subcategory: string;
    chapters: number;
    passages: number;
    sha256: string;
    versions: { language: string; title: string; licence: string; source: string }[];
  }[];
};
const textFunctionData = readJson("data/corpus/text-functions.json") as {
  works: Record<string, { functions: string[]; status: string; note: string }>;
};
const corpusWorkSlugs = readdirSync(join(ROOT, "data/corpus/works"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

const TEXT_FUNCTIONS = new Set([
  "canonical_scripture",
  "non_canonical_religious_text",
  "foundational_revelation",
  "prayer_liturgy",
  "commentary_exegesis",
  "religious_law_practice",
  "historical_document",
  "sermon_speech",
  "philosophical_work",
  "mystical_contemplative",
  "ethical_humanist_manifesto",
  "community_statement",
  "creed_confession",
  "denominational_guidance",
  "academic_scholarship",
  "contemporary_spiritual_writing",
  "oral_history_transcription",
  "community_authorised_knowledge",
]);

const INGESTION_STATUSES = new Set([
  "discovered",
  "under_review",
  "licence_verified",
  "ready_for_integration",
  "connected",
  "import_tested",
  "active",
  "restricted",
  "unavailable",
]);

const REQUIRED_FIELDS = [
  "source_id",
  "source_name",
  "base_url",
  "organisation",
  "traditions_covered",
  "schools_covered",
  "languages",
  "source_type",
  "content_types",
  "api_documentation_url",
  "download_url",
  "access_method",
  "licence_url",
  "licence_status",
  "commercial_use_allowed",
  "redistribution_allowed",
  "attribution_requirements",
  "authentication_required",
  "rate_limits",
  "ingestion_status",
  "last_verified_at",
  "source_reliability_notes",
  "editorial_notes",
];

function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

describe("source registry data", () => {
  test("has a substantial, de-duplicated catalogue", () => {
    expect(registry.sources.length).toBeGreaterThanOrEqual(50);
    const ids = registry.sources.map((s) => s.source_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every entry carries the required registry fields", () => {
    for (const source of registry.sources) {
      for (const field of REQUIRED_FIELDS) {
        expect(source).toHaveProperty(field);
      }
      expect(source.source_id).toMatch(/^[a-z0-9-]+$/);
      expect(source.source_name.length).toBeGreaterThan(0);
      expect(Array.isArray(source.traditions_covered)).toBe(true);
      expect(Array.isArray(source.languages)).toBe(true);
      expect(Array.isArray(source.content_types)).toBe(true);
    }
  });

  test("uses controlled ingestion and approval values", () => {
    for (const source of registry.sources) {
      expect(INGESTION_STATUSES.has(source.ingestion_status)).toBe(true);
      expect(["pending", "approved", "rejected"]).toContain(source.approval_status);
      expect([1, 2, 3]).toContain(source.priority);
    }
  });

  test("does not mark an unverified source as connected or active", () => {
    for (const source of registry.sources) {
      if (source.ingestion_status === "connected" || source.ingestion_status === "active") {
        expect(source.approval_status).toBe("approved");
      }
    }
  });

  test("tradition slugs and language codes are valid registry vocabulary", () => {
    const traditionSlugs = new Set(meta.traditions.map((t) => t.slug));
    const languageCodes = new Set(meta.languages.map((l) => l.code));
    // Registry-only languages may extend the corpus vocabulary, but must be codes, not prose.
    for (const source of registry.sources) {
      for (const slug of source.traditions_covered) expect(traditionSlugs.has(slug)).toBe(true);
      for (const code of source.languages) expect(code).toMatch(/^[a-z]{2,3}$/);
      expect(languageCodes.size).toBeGreaterThan(0);
    }
  });

  test("restricted sources never claim redistribution permission", () => {
    for (const source of registry.sources) {
      if (source.ingestion_status === "restricted") {
        expect(source.redistribution_allowed === true).toBe(false);
      }
    }
  });
});

describe("textual-function classification", () => {
  test("every corpus work has at least one explicit classification", () => {
    for (const slug of corpusWorkSlugs) {
      const entry = textFunctionData.works[slug];
      expect(entry, `missing classification for ${slug}`).toBeDefined();
      expect(entry.functions.length).toBeGreaterThan(0);
      expect(new Set(entry.functions).size).toBe(entry.functions.length);
      for (const fn of entry.functions) expect(TEXT_FUNCTIONS.has(fn)).toBe(true);
      expect(["affirmed", "provisional", "disputed"]).toContain(entry.status);
      expect(entry.note.length).toBeGreaterThan(20);
    }
  });

  test("classifications do not refer to unknown works", () => {
    const known = new Set(corpusWorkSlugs);
    for (const slug of Object.keys(textFunctionData.works)) expect(known.has(slug)).toBe(true);
  });
});

describe("tested Sefaria ingestion", () => {
  test("manifest covers all 39 Tanakh books with licence-checked editions", () => {
    expect(sefariaManifest.source).toBe("sefaria");
    expect(sefariaManifest.books.length).toBe(39);
    expect(new Set(sefariaManifest.books.map((b) => b.slug)).size).toBe(39);
    expect(sefariaManifest.totals).toEqual({ books: 39, chapters: 929, hebrewVerses: 23206, englishVerses: 23206 });
    for (const book of sefariaManifest.books) {
      expect(book.hebrew_licence).toBe("CC-BY-SA");
      expect(book.english_licence).toBe("Public Domain");
      expect(book.chapters).toBeGreaterThan(0);
      expect(book.hebrewVerses).toBe(book.englishVerses);
      expect(book.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  test("every Tanakh work keeps its full chapter index and streams its text", () => {
    for (const book of sefariaManifest.books) {
      const work = readJson(`data/corpus/works/${book.slug}.json`);
      expect(work.chapters.length).toBe(book.chapters);
      expect(work.passages.length).toBe(book.hebrewVerses);
      expect(work.isSample).toBe(false);
      expect(work.textStorage).toBe("streamed");
      expect(work.editions.map((e: any) => e.language).sort()).toEqual(["en", "he"]);
      for (const edition of work.editions) {
        expect(edition.source).toBe("sefaria");
        expect(edition.isSample).toBe(false);
        // The text lives at the host, not in the corpus.
        expect(edition.texts).toBeUndefined();
      }
      const stream = streamsManifest.works[book.slug];
      expect(stream?.provider).toBe("sefaria");
      expect(stream?.upstream).toBe(book.title);
      expect(stream?.editions.length).toBe(2);
      for (const edition of stream.editions) {
        expect(edition.languageName.length).toBeGreaterThan(2);
        expect(edition.version.length).toBeGreaterThan(0);
      }
    }
  });

  test("Mishnah manifest covers all 63 public-domain tractates", () => {
    expect(mishnahManifest.source).toBe("sefaria");
    expect(mishnahManifest.editions.hebrew.licence).toBe("Public Domain");
    expect(mishnahManifest.editions.english.licence).toBe("CC-BY-NC");
    expect(mishnahManifest.totals).toEqual({ tractates: 63, chapters: 522, mishnayot: 4158 });
    expect(new Set(mishnahManifest.tractates.map((t) => t.slug)).size).toBe(63);
    for (const tractate of mishnahManifest.tractates) {
      expect(tractate.licence).toBe("Public Domain");
      expect(tractate.seder.length).toBeGreaterThan(0);
      expect(tractate.chapters).toBeGreaterThan(0);
      expect(tractate.mishnayot).toBeGreaterThan(0);
      const work = readJson(`data/corpus/works/${tractate.slug}.json`);
      expect(work.passages.length).toBe(tractate.mishnayot);
      expect(work.textStorage).toBe("streamed");
      expect(work.isSample).toBe(false);
      expect(work.editions.length).toBeGreaterThanOrEqual(1);
      expect(work.editions[0].license).toBe("public-domain");
      expect(work.editions[0].language).toBe("he");
      if (tractate.english_mishnayot > 0) {
        const english = work.editions.find((e: any) => e.language === "en");
        expect(english).toBeDefined();
        expect(english.license).toBe("cc-by-nc");
        expect(english.source).toBe("sefaria");
        expect(english.attributionText).toContain("Sefaria");
        expect(english.texts).toBeUndefined();
      }
      const stream = streamsManifest.works[tractate.slug];
      expect(stream?.upstream).toBe(tractate.title);
    }
  });

  test("Genesis imports the whole book, not the opening fragment", () => {
    const work = readJson("data/corpus/works/genesis.json");
    expect(work.chapters.length).toBe(50);
    expect(work.passages.length).toBe(1533);
    const refs = new Set(work.passages.map((p: any) => p.reference));
    expect(refs.has("1.1")).toBe(true);
    expect(refs.has("1.31")).toBe(true);
    expect(refs.has("50.26")).toBe(true);
    // The verses are indexed here but their text is streamed from Sefaria.
    expect(work.textStorage).toBe("streamed");
    expect(work.editions.every((e: any) => e.texts === undefined)).toBe(true);
    const stream = streamsManifest.works.genesis;
    expect(stream?.upstream).toBe("Genesis");
    expect(stream?.editions.map((e) => e.slug).sort()).toEqual(
      work.editions.map((e: any) => e.slug).sort(),
    );
  });
});

describe("staged Sefaria library", () => {
  test("manifest covers complete Talmud, Midrash and Tosefta works", () => {
    expect(libraryManifest.source).toBe("sefaria");
    expect(libraryManifest.totals.works).toBeGreaterThan(150);
    expect(libraryManifest.totals.chapters).toBeGreaterThan(8000);
    expect(libraryManifest.totals.passages).toBeGreaterThan(100000);
    for (const category of [
      "Talmud",
      "Midrash",
      "Tosefta",
      "Halakhah",
      "Kabbalah",
      "Liturgy",
      "Jewish Thought",
      "Chasidut",
      "Musar",
      "Responsa",
      "Second Temple",
      "Reference",
    ]) {
      expect(libraryManifest.works.filter((w) => w.category === category).length).toBeGreaterThan(10);
    }
    expect(new Set(libraryManifest.works.map((w) => w.slug)).size).toBe(libraryManifest.works.length);
  });

  test("every imported work records its chapter shelf, provenance and stream address", () => {
    for (const entry of libraryManifest.works) {
      const work = readJson(`data/corpus/works/${entry.slug}.json`);
      expect(work.slug).toBe(entry.slug);
      expect(work.category).toBe(entry.category);
      expect(work.subcategory.length).toBeGreaterThan(0);
      expect(work.chapters.length).toBe(entry.chapters);
      expect(work.passages.length).toBe(entry.passages);
      expect(work.passages.length).toBeGreaterThan(0);
      expect(work.editions.length).toBe(entry.versions.length);
      expect(work.textStorage).toBe("streamed");
      for (const edition of work.editions) {
        expect(edition.source).toBe("sefaria");
        expect(edition.title.length).toBeGreaterThan(0);
        expect(edition.rightsStatus.length).toBeGreaterThan(0);
        expect(edition.attributionText).toContain("Sefaria");
        expect(edition.texts).toBeUndefined();
      }
      const stream = streamsManifest.works[entry.slug];
      expect(stream?.upstream).toBe(entry.title);
      expect(stream?.editions.length).toBe(work.editions.length);
    }
  }, 120000);
});

describe("tested Project Gutenberg ingestion", () => {
  test("manifest checksums match the extracted passage text", () => {
    expect(manifest.sourceId).toBe("project-gutenberg");
    expect(manifest.adapter).toBe("gutenberg-bounded-extractor");
    expect(manifest.sourceFileSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.passages.length).toBe(2);
    for (const passage of manifest.passages) {
      expect(passage.checksum).toBe(sha256(passage.text));
      expect(passage.startLine).toBeGreaterThan(0);
      expect(passage.endLine).toBeGreaterThanOrEqual(passage.startLine);
      expect(passage.text.length).toBeGreaterThan(80);
    }
  });

  test("corpus text matches the manifest and records its public-domain edition", () => {
    const edition = foxWork.editions.find((e) => e.source === "project-gutenberg");
    expect(edition).toBeDefined();
    expect(edition!.license).toBe("public-domain");
    for (const passage of manifest.passages) {
      expect(edition!.texts[passage.reference]).toBe(passage.text);
    }
  });

  test("bounded extraction rejects missing or implausibly short passages", () => {
    const fixture = [
      "front matter",
      "BEGIN target",
      "middle line with enough words to resemble a real extracted paragraph rather than a stray heading or fragment.",
      "END target",
      "back matter",
    ].join("\n");
    expect(extractBetween(fixture, "BEGIN target", "END target").text).toContain("middle line");
    expect(() => extractBetween(fixture, "NOT PRESENT", "END target")).toThrow("Start marker not found");
    expect(() => extractBetween(fixture, "BEGIN target", "NOT PRESENT")).toThrow("End marker not found");
    expect(() => extractBetween("BEGIN target\nEND target", "BEGIN target", "END target")).toThrow(
      "implausibly short",
    );
  });
});
