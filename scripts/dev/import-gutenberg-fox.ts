// Tested ingestion workflow: Project Gutenberg eBook #75559, George Fox's Journal.
//
// Run: bun run import:fox
// Output:
//   data/imports/gutenberg-75559-fox.json  (extraction manifest with checksums)
//   data/corpus/works/journal-of-george-fox.json (one work, one edition, two excerpts)
//
// The adapter fetches the public-domain plain text, extracts only the bounded
// passages, and records line ranges and checksums. It does not mirror the book.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchGutenbergText, extractFoxJournal } from "../../ingest/adapters/gutenberg";
import { ROOT } from "../../server/db";

const text = await fetchGutenbergText(75559);
const extraction = extractFoxJournal(text);
const importedAt = new Date().toISOString();

const manifestDir = join(ROOT, "data", "imports");
mkdirSync(manifestDir, { recursive: true });
writeFileSync(
  join(manifestDir, "gutenberg-75559-fox.json"),
  JSON.stringify(
    {
      ...extraction,
      importedAt,
      adapter: "gutenberg-bounded-extractor",
      adapterVersion: "1.0.0",
      sourceFileSha256: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
      note: "Extracts only the cited passages. The full source file is not stored. Public-domain status is stated for the United States; verify local law before redistributing elsewhere.",
    },
    null,
    2,
  ) + "\n",
);

const texts = Object.fromEntries(extraction.passages.map((p) => [p.reference, p.text]));

const work = {
  slug: "journal-of-george-fox",
  title: "The Journal of George Fox",
  originalTitle: "",
  transliteration: "",
  altTitles: ["Fox's Journal", "A Journal or Historical Account of the Life, Travels, Sufferings, Christian Experiences, and Labour of Love of George Fox"],
  tradition: "quakerism",
  school: null,
  genre: "Journal and spiritual autobiography",
  textType: "Historical document",
  originalLanguage: "en",
  dateStart: 1694,
  dateEnd: 1694,
  dateDisplay: "1694; this edition 1901",
  authorshipStatus: "established",
  author: "george-fox",
  attributionNote:
    "Written by George Fox and first published in 1694, after his death, with editorial work by Thomas Ellwood and others. This excerpt is from Norman Penney's 1901 eighth (bi-centenary) edition, which modernised some spelling and collated the first edition.",
  description:
    "George Fox's Journal is the central autobiographical account of the early Quaker movement. It describes his inward struggles, his conviction that true religion is experienced in the Spirit rather than in outward forms, and the first gatherings of Friends.",
  historicalContext:
    "Fox (1624–1691) travelled through England during the upheavals of the Civil War and Interregnum, preaching a religion of inward light and direct experience. The Journal was edited for publication after his death and became a foundational text for the Religious Society of Friends. It is not a book of discipline and does not speak for every Quaker yearly meeting.",
  featured: 0,
  featuredNote: "",
  refScheme: "section",
  chapters: [
    { ref: "1", label: "Chapter I — 1647" },
    { ref: "2", label: "Chapter II — 1648" },
  ],
  passages: [
    { reference: "1", label: "Chapter I (1647)", chapterRef: "1" },
    { reference: "2", label: "Chapter II (1648)", chapterRef: "2" },
  ],
  editions: [
    {
      slug: "fox-journal-en-gutenberg-1901",
      language: "en",
      editionType: "original",
      title: "The Journal of George Fox, vol. 1 of 2 (eighth edition)",
      translator: "",
      publisher: "Friends' Tract Association; Project Gutenberg transcription",
      publicationYear: 1901,
      source: "project-gutenberg",
      license: "public-domain",
      rightsStatus: "Public domain in the United States",
      attributionText:
        "The Journal of George Fox, vol. 1 of 2, eighth (bi-centenary) edition, edited by Norman Penney (London: Friends' Tract Association, 1901). Public domain in the United States. Plain text from Project Gutenberg eBook #75559, produced from Internet Archive images by Project Gutenberg volunteers.",
      structureScheme: "chapter",
      notes:
        "Two bounded excerpts imported by the tested Gutenberg adapter. The 1901 edition modernises some spelling and collates the first edition; it is not a verbatim 1694 text. This is a sample, not the complete Journal.",
      texts,
    },
  ],
};

writeFileSync(
  join(ROOT, "data", "corpus", "works", "journal-of-george-fox.json"),
  JSON.stringify(work, null, 2) + "\n",
);

console.log("Imported Project Gutenberg eBook #75559 (George Fox, Journal, 1901 edition).");
for (const p of extraction.passages) {
  console.log(`  ${p.reference}: lines ${p.startLine}–${p.endLine}, ${p.text.split(/\s+/).length} words, sha256 ${p.checksum.slice(0, 16)}…`);
}
console.log(`Source file sha256: ${new Bun.CryptoHasher("sha256").update(text).digest("hex")}`);
console.log("Wrote data/imports/gutenberg-75559-fox.json and data/corpus/works/journal-of-george-fox.json");
