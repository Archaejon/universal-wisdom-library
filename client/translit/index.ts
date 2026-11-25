/**
 * Transliteration for the reader: which texts can be shown in another script,
 * and how.
 *
 * - Hebrew and Aramaic: the Sefaria Lens respelling engine, in seven reading
 *   traditions, with the divine name read as Adonai in liturgy and HaShem
 *   elsewhere.
 * - Sanskrit: Devanagari to IAST, and IAST to Devanagari.
 */
import { readingFor } from "./divine-name";
import { STYLE_INFO, transliterate, wordInfo } from "./hebrew-engine";
import { DEVANAGARI, devanagariToIast, iastToDevanagari, looksLikeIast } from "./sanskrit";

export type HebrewStyle = "modern" | "ashkenazi" | "mizrahi" | "yemeni" | "kavkazi" | "ancient" | "ancient-hard";

export const HEBREW_STYLES: { value: HebrewStyle; label: string; blurb: string }[] = (
  Object.entries(STYLE_INFO) as [HebrewStyle, { label: string; blurb: string }][]
).map(([value, info]) => ({ value, label: info.label, blurb: info.blurb }));

const STYLE_KEY = "uwl_translit_style";

export function loadHebrewStyle(): HebrewStyle {
  try {
    const v = localStorage.getItem(STYLE_KEY);
    if (v && HEBREW_STYLES.some((s) => s.value === v)) return v as HebrewStyle;
  } catch {}
  return "modern";
}

export function saveHebrewStyle(style: HebrewStyle) {
  try {
    localStorage.setItem(STYLE_KEY, style);
  } catch {}
}

/** What a work's metadata says about its kind, for the divine name. */
export type WorkKind = { category?: string | null; subcategory?: string | null; title?: string | null; functions?: string[] };

export function divineNameFor(work: WorkKind | null | undefined): "adonai" | "hashem" {
  if (!work) return "hashem";
  const liturgical = (work.functions ?? []).includes("prayer_liturgy");
  if (liturgical) return "adonai";
  return readingFor({ categories: [work.category, work.subcategory].filter(Boolean), title: work.title ?? "" }) as "adonai" | "hashem";
}

/** The script the transliteration layer produces for a text, or null if none applies. */
export function transliterationKind(lang: string | null | undefined, sample: string): "latin" | "devanagari" | null {
  if (lang === "he" || lang === "arc") return /[א-ת]/.test(sample) ? "latin" : null;
  if (lang === "sa") {
    if (DEVANAGARI.test(sample)) return "latin";
    if (looksLikeIast(sample)) return "devanagari";
  }
  return null;
}

export function transliterationLabel(lang: string | null | undefined, kind: "latin" | "devanagari"): string {
  if (lang === "sa") return kind === "latin" ? "IAST" : "Devanagari";
  return "Transliteration";
}

export function transliterateText(
  text: string,
  lang: string | null | undefined,
  opts: { style?: HebrewStyle; divineName?: "adonai" | "hashem" } = {},
): string {
  if (!text) return "";
  if (lang === "he" || lang === "arc") {
    return transliterate(text, { style: opts.style ?? "modern", divineName: opts.divineName ?? "hashem" });
  }
  if (lang === "sa") {
    if (DEVANAGARI.test(text)) return devanagariToIast(text);
    if (looksLikeIast(text)) return iastToDevanagari(text);
  }
  return "";
}

export type HebrewWordInfo = { he: string } & Record<HebrewStyle, string>;

export function hebrewWordInfo(word: string, divineName: "adonai" | "hashem" = "hashem"): HebrewWordInfo {
  return wordInfo(word, { divineName }) as HebrewWordInfo;
}
