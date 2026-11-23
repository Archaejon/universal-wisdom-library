// TEI XML from the Open Greek and Latin and Perseus repositories.
//
// The First1KGreek, csel-dev and canonical-latinLit/greekLit repositories
// publish each edition as one TEI file whose body is a tree of
// <div type="textpart" subtype="book|chapter|section|…" n="…">. This module
// reads that tree into chapters and passages the library can hold locally.
// It is used only at import time: the text is stored in the corpus, so nothing
// here runs when a reader opens a chapter.
//
// The parser is deliberately small. TEI from these projects is well-formed
// XML with no DTD-defined entities beyond the five predefined ones, so a
// tokenizer and a stack are enough; there is no dependency to install.

export type XmlNode = { name: string; attrs: Record<string, string>; children: (XmlNode | string)[] };

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITY[body.toLowerCase()] ?? whole;
  });
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of source.matchAll(/([^\s=\/]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    attrs[m[1]!] = decodeEntities(m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/** Parse well-formed XML into a tree. Comments, processing instructions and the doctype are dropped. */
export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: "#root", attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/\s*([^\s>]+)\s*>|<([^\s\/>!?]+)((?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of xml.matchAll(token)) {
    const top = stack[stack.length - 1]!;
    if (m[1] !== undefined) top.children.push(m[1]);
    else if (m[2] !== undefined) {
      // Close the nearest open element of that name; tolerate stray closers.
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]!.name === m[2]) {
          stack.length = i;
          break;
        }
      }
    } else if (m[3] !== undefined) {
      const node: XmlNode = { name: m[3], attrs: parseAttrs(m[4] ?? ""), children: [] };
      top.children.push(node);
      if (m[5] !== "/") stack.push(node);
    } else if (m[6] !== undefined) top.children.push(decodeEntities(m[6]));
  }
  return root;
}

export function localName(node: XmlNode): string {
  return node.name.replace(/^[^:]+:/, "");
}

export function* walk(node: XmlNode): Generator<XmlNode> {
  yield node;
  for (const child of node.children) if (typeof child !== "string") yield* walk(child);
}

export function find(node: XmlNode, test: (n: XmlNode) => boolean): XmlNode | null {
  for (const n of walk(node)) if (test(n)) return n;
  return null;
}

// Elements whose content is not the text of the work: the editor's apparatus
// and footnotes, bibliographic references and page furniture.
const SKIP = new Set(["note", "bibl", "head", "figure", "fw", "label", "del", "sic", "orig", "abbr", "rdg", "teiHeader", "listBibl", "argument"]);
// Choice and app elements carry alternatives; the reading text is the
// corrected, regularised, expanded or lemma form, which the SKIP set leaves.

/** Plain text of a node, with notes, heads and apparatus left out and line-break hyphenation joined. */
export function textOf(node: XmlNode | string): string {
  const parts: string[] = [];
  const visit = (n: XmlNode | string) => {
    if (typeof n === "string") {
      parts.push(n);
      return;
    }
    const name = localName(n);
    if (SKIP.has(name)) return;
    if (name === "lb" || name === "pb" || name === "cb") {
      parts.push(n.attrs.break === "no" ? "\u0000" : " ");
      return;
    }
    if (name === "milestone") return;
    if (name === "gap") {
      parts.push(" … ");
      return;
    }
    if (name === "l" || name === "p" || name === "lg" || name === "ab") parts.push(" ");
    for (const c of n.children) visit(c);
    if (name === "l" || name === "p" || name === "lg" || name === "ab") parts.push(" ");
  };
  visit(node);
  return parts
    .join("")
    // A word broken over a printed line: "inuo- <lb/> care".
    .replace(/(\p{L})[-‐](?:\s|\u0000)+(\p{Ll})/gu, "$1$2")
    .replace(/\s*\u0000\s*/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:·!?\)\]])/g, "$1")
    .replace(/([\(\[])\s+/g, "$1")
    .trim();
}

export function headOf(node: XmlNode): string {
  for (const child of node.children) {
    if (typeof child === "string") continue;
    const name = localName(child);
    if (name === "head") {
      const visit = (n: XmlNode | string): string =>
        typeof n === "string" ? n : localName(n) === "note" ? "" : n.children.map(visit).join("");
      return visit(child).replace(/\s+/g, " ").trim();
    }
    if (name === "ab" || name === "p") {
      const title = find(child, (n) => localName(n) === "title");
      if (title) return textOf({ ...title, name: "span" });
    }
  }
  return "";
}

export function isTextpart(node: XmlNode): boolean {
  const name = localName(node);
  if (/^div\d?$/.test(name)) {
    const type = node.attrs.type ?? "";
    return type === "textpart" || (type !== "edition" && type !== "translation" && type !== "commentary" && Boolean(node.attrs.n));
  }
  return false;
}

export function textparts(node: XmlNode): XmlNode[] {
  return node.children.filter((c): c is XmlNode => typeof c !== "string" && isTextpart(c));
}

export type TeiPassage = { cite: string; text: string };
export type TeiChapter = { cite: string; label: string; passages: TeiPassage[] };
export type TeiEdition = { language: string; title: string; editor: string; source: string; licence: string; chapters: TeiChapter[] };

const SUBTYPE_LABEL: Record<string, string> = {
  book: "Book", chapter: "Chapter", section: "Section", epistle: "Letter", letter: "Letter", poem: "Poem",
  oration: "Oration", homily: "Homily", part: "Part", vision: "Vision", mandate: "Mandate", similitude: "Similitude",
  toc: "Chapter list", preface: "Preface",
};

// Divisions that hold the editor's description of the manuscripts rather than the work.
const EDITORIAL_SUBTYPES = new Set(["mss", "manuscripts", "sigla", "apparatus"]);

/** Split an over-long passage at sentence ends into parts of about `size` words. */
export function packSentences(text: string, size: number): string[] {
  const sentences = text.split(/(?<=[.;·!?»"”])\s+(?=\S)/u);
  const out: string[] = [];
  let current: string[] = [];
  let words = 0;
  for (const s of sentences) {
    const n = s.split(/\s+/).length;
    if (words && words + n > size) {
      out.push(current.join(" "));
      current = [];
      words = 0;
    }
    current.push(s);
    words += n;
  }
  if (current.length) out.push(current.join(" "));
  return out;
}

function citeLabel(node: XmlNode): string {
  const subtype = node.attrs.subtype ?? node.attrs.type ?? "";
  const word = SUBTYPE_LABEL[subtype.toLowerCase()] ?? (subtype && subtype !== "textpart" ? subtype[0]!.toUpperCase() + subtype.slice(1) : "");
  const n = node.attrs.n ?? "";
  return [word, n].filter(Boolean).join(" ");
}

/** Group a leaf's verse lines into passages of a few lines each, or its paragraphs when it is long. */
function leafPassages(node: XmlNode, cite: string, maxWords: number): TeiPassage[] {
  const blocks: { n: string; text: string }[] = [];
  const lgs = [...walk(node)].filter((n) => localName(n) === "lg");
  const lines = [...walk(node)].filter((n) => localName(n) === "l");
  if (lgs.length > 1) {
    for (const lg of lgs) {
      const t = textOf(lg);
      if (t) blocks.push({ n: lg.attrs.n ?? "", text: t });
    }
  } else if (lines.length > 12) {
    for (let i = 0; i < lines.length; i += 10) {
      const group = lines.slice(i, i + 10);
      const t = group.map((l) => textOf(l)).filter(Boolean).join(" / ");
      const first = group[0]!.attrs.n ?? String(i + 1);
      const last = group[group.length - 1]!.attrs.n ?? String(i + group.length);
      if (t) blocks.push({ n: `${first}–${last}`, text: t });
    }
  }
  if (blocks.length) return blocks.map((b, i) => ({ cite: b.n ? `${cite} ${b.n}`.trim() : `${cite} §${i + 1}`, text: b.text }));
  const whole = textOf(node);
  const words = whole.split(/\s+/).length;
  const paragraphs = node.children.filter((c): c is XmlNode => typeof c !== "string" && localName(c) === "p");
  if (words > maxWords && paragraphs.length > 1) {
    return paragraphs
      .map((p) => textOf(p))
      .filter(Boolean)
      .map((text, i) => ({ cite: `${cite} ¶${i + 1}`, text }));
  }
  return whole ? [{ cite, text: whole }] : [];
}

function leaves(node: XmlNode, prefix: string[]): { cite: string[]; node: XmlNode }[] {
  const kids = textparts(node);
  if (!kids.length) return [{ cite: prefix, node }];
  // Text that sits beside the first textpart (an untitled prologue) is kept as its own leaf.
  const out: { cite: string[]; node: XmlNode }[] = [];
  const loose = node.children.filter((c) => typeof c !== "string" && !isTextpart(c) && localName(c) !== "head");
  const looseText = loose.map((c) => textOf(c)).join(" ").trim();
  if (looseText.split(/\s+/).length > 12) out.push({ cite: [...prefix, "pr"], node: { name: "div", attrs: {}, children: loose } });
  for (const k of kids) out.push(...leaves(k, [...prefix, k.attrs.n ?? ""]));
  return out;
}

export type TeiOptions = { maxWords?: number; chapterDepth?: number };

/** Read a TEI edition into chapters (the top citation level) and passages (the leaves beneath it). */
export function readTei(xml: string, options: TeiOptions = {}): TeiEdition {
  const tree = parseXml(xml);
  const header = find(tree, (n) => localName(n) === "teiHeader");
  const titleNode = header && find(header, (n) => localName(n) === "title");
  const editorNode = header && find(header, (n) => localName(n) === "editor");
  const licenceNode = header && find(header, (n) => localName(n) === "licence");
  const sourceNode = header && find(header, (n) => localName(n) === "sourceDesc");
  const body = find(tree, (n) => localName(n) === "body");
  if (!body) throw new Error("no <body>");
  let edition =
    find(body, (n) => /^div\d?$/.test(localName(n)) && (n.attrs.type === "edition")) ??
    body;
  const language = (edition.attrs["xml:lang"] || find(tree, (n) => localName(n) === "text")?.attrs["xml:lang"] || "").toLowerCase();

  // Descend through wrappers that hold a single textpart (a work printed as "Book 1" of one).
  let top = textparts(edition);
  let depth = options.chapterDepth ?? 1;
  while (top.length === 1 && textparts(top[0]!).length > 1 && depth > 0) {
    edition = top[0]!;
    top = textparts(edition);
  }
  for (let d = 1; d < (options.chapterDepth ?? 1); d++) top = top.flatMap((t) => (textparts(t).length ? textparts(t) : [t]));
  if (!top.length) throw new Error("no textpart divisions");

  const maxWords = options.maxWords ?? 450;
  const chapters: TeiChapter[] = [];
  const looseBefore = edition.children.filter((c) => typeof c !== "string" && !isTextpart(c) && localName(c) !== "head");
  const prologue = looseBefore.map((c) => textOf(c)).join(" ").trim();
  if (prologue.split(/\s+/).length > 40) {
    chapters.push({ cite: "pr", label: "Prologue", passages: [{ cite: "pr", text: prologue }] });
  }
  for (const part of top) {
    const n = part.attrs.n ?? String(chapters.length + 1);
    const head = headOf(part).replace(/[.\s]+$/, "");
    const base = citeLabel(part) || `Part ${n}`;
    const label = head && head.length <= 80 && head.toLowerCase() !== base.toLowerCase() ? `${base}: ${head}` : base;
    const passages: TeiPassage[] = [];
    if (EDITORIAL_SUBTYPES.has((part.attrs.subtype ?? "").toLowerCase())) continue;
    for (const leaf of leaves(part, [n])) {
      for (const p of leafPassages(leaf.node, leaf.cite.join("."), maxWords)) {
        const words = p.text.split(/\s+/).length;
        if (words <= maxWords * 1.6) {
          passages.push(p);
          continue;
        }
        const parts = packSentences(p.text, maxWords);
        parts.forEach((text, i) => passages.push({ cite: `${p.cite} (${i + 1}/${parts.length})`, text }));
      }
    }
    const usable = passages.filter((p) => p.text.length > 0);
    if (usable.length) chapters.push({ cite: n, label, passages: usable });
  }
  return {
    language,
    title: titleNode ? textOf({ ...titleNode, name: "span" }) : "",
    editor: editorNode ? textOf({ ...editorNode, name: "span" }) : "",
    source: sourceNode ? textOf({ ...sourceNode, name: "span" }).slice(0, 400) : "",
    licence: licenceNode ? licenceNode.attrs.target ?? textOf({ ...licenceNode, name: "span" }) : "",
    chapters,
  };
}
