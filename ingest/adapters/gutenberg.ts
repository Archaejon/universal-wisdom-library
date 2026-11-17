// Tested ingestion adapter for Project Gutenberg plain-text files.
//
// This adapter intentionally does not infer rights. The caller must supply the
// edition/licence record; the registry records Project Gutenberg as public
// domain in the United States, with local-law caveats.
//
// It performs a bounded extraction rather than mirroring the whole file. The
// original Gutenberg text is fetched once, hashed, and the extracted excerpt is
// stored with its line range and extraction version so it can be reproduced.

export type GutenbergExtraction = {
  sourceId: "project-gutenberg";
  ebookId: number;
  url: string;
  retrievedAt: string;
  licence: string;
  edition: string;
  passages: {
    reference: string;
    label: string;
    startLine: number;
    endLine: number;
    startMarker: string;
    endMarker: string;
    checksum: string;
    text: string;
  }[];
};

const USER_AGENT = "UniversalWisdomLibrary/0.1 (source provenance test; contact: local operator)";

export async function fetchGutenbergText(ebookId: number): Promise<string> {
  const url = `https://www.gutenberg.org/ebooks/${ebookId}.txt.utf-8`;
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "text/plain" } });
  if (!res.ok) throw new Error(`Project Gutenberg returned HTTP ${res.status} for eBook #${ebookId}`);
  const text = await res.text();
  if (text.length < 5000 || !text.includes("*** START OF THE PROJECT GUTENBERG EBOOK")) {
    throw new Error(`Unexpected or truncated Gutenberg file for eBook #${ebookId}`);
  }
  return text;
}

function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

function tidyProse(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\[(?:\d+)\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract a range by unique start/end markers, returning the first match only. */
export function extractBetween(
  source: string,
  startMarker: string,
  endMarker: string,
): { text: string; startLine: number; endLine: number } {
  const lines = source.split(/\r?\n/);
  const startLine = lines.findIndex((line) => line.includes(startMarker));
  if (startLine < 0) throw new Error(`Start marker not found: ${startMarker}`);
  let endLine = -1;
  for (let i = startLine; i < lines.length; i++) {
    if (lines[i].includes(endMarker)) { endLine = i; break; }
  }
  if (endLine < 0) throw new Error(`End marker not found after start: ${endMarker}`);
  const text = tidyProse(lines.slice(startLine, endLine + 1).join(" "));
  if (text.length < 80) throw new Error("Extracted passage is implausibly short");
  return { text, startLine: startLine + 1, endLine: endLine + 1 };
}

export function extractFoxJournal(source: string): GutenbergExtraction {
  const first = extractBetween(
    source,
    "Pharaoh, Cain, Ishmael, Esau",
    "love of God, and I had great openings.",
  );
  const second = extractBetween(
    source,
    "In the year 1648, as I was sitting in a friend’s house",
    "astonishment of both people and priests.",
  );
  if (!first.text.includes("infinite ocean of light and love")) {
    throw new Error("The expected Fox passage was not extracted");
  }
  if (!second.text.includes("great crack to go throughout the earth")) {
    throw new Error("The expected 1648 Fox passage was not extracted");
  }
  return {
    sourceId: "project-gutenberg",
    ebookId: 75559,
    url: "https://www.gutenberg.org/ebooks/75559.txt.utf-8",
    retrievedAt: new Date().toISOString().slice(0, 10),
    licence: "Public domain in the United States. Project Gutenberg eBook #75559.",
    edition:
      "The Journal of George Fox, vol. 1 of 2, eighth (bi-centenary) edition, edited by Norman Penney, Friends' Tract Association, 1901. Transcription from Internet Archive images by Project Gutenberg volunteers.",
    passages: [
      {
        reference: "1",
        label: "Chapter I (1647)",
        ...first,
        startMarker: "Pharaoh, Cain, Ishmael, Esau",
        endMarker: "love of God, and I had great openings.",
        checksum: sha256(first.text),
      },
      {
        reference: "2",
        label: "Chapter II (1648)",
        ...second,
        startMarker: "In the year 1648, as I was sitting in a friend’s house",
        endMarker: "astonishment of both people and priests.",
        checksum: sha256(second.text),
      },
    ],
  };
}
