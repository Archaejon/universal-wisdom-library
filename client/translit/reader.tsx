import { Fragment, useEffect, useMemo, useState, type MouseEvent } from "react";
import { Link } from "../router";
import { api } from "../api";
import { Icon, Loading } from "../components";
import {
  HEBREW_STYLES,
  hebrewWordInfo,
  loadHebrewStyle,
  saveHebrewStyle,
  transliterateText,
  transliterationKind,
  transliterationLabel,
  type HebrewStyle,
} from "./index";

/** The reader's transliteration choices, remembered on this device. */
export function useTranslit() {
  const [on, setOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem("uwl_translit") === "on";
    } catch {
      return false;
    }
  });
  const [style, setStyleState] = useState<HebrewStyle>(loadHebrewStyle);
  const toggle = () =>
    setOn((v) => {
      try {
        localStorage.setItem("uwl_translit", v ? "off" : "on");
      } catch {}
      return !v;
    });
  const setStyle = (s: HebrewStyle) => {
    setStyleState(s);
    saveHebrewStyle(s);
  };
  return { on, toggle, style, setStyle };
}

export type Translit = ReturnType<typeof useTranslit>;

/** What the layer does for one edition: null when the edition has nothing to transliterate. */
export function translitFor(edition: { language?: { code?: string } } | null | undefined, sample: string) {
  const lang = edition?.language?.code ?? null;
  const kind = transliterationKind(lang, sample);
  return kind ? { lang, kind, label: transliterationLabel(lang, kind) } : null;
}

export function TranslitSwitch({
  info,
  translit,
}: {
  info: { lang: string | null; kind: "latin" | "devanagari"; label: string };
  translit: Translit;
}) {
  const hebrew = info.lang === "he" || info.lang === "arc";
  const current = HEBREW_STYLES.find((s) => s.value === translit.style);
  return (
    <div className="translit-switch">
      <label className={translit.on ? "layer-switch on" : "layer-switch"} title={hebrew ? "A readable respelling, shown under the original" : `The text in ${info.label}`}>
        <input type="checkbox" checked={translit.on} onChange={translit.toggle} />
        {info.label}
      </label>
      {hebrew && translit.on && (
        <label className="reader-field" title={current?.blurb}>
          <span className="sr-only">Reading tradition</span>
          <select value={translit.style} onChange={(e) => translit.setStyle(e.target.value as HebrewStyle)}>
            {HEBREW_STYLES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

export function TranslitLine({
  text,
  lang,
  kind,
  style,
  divineName,
  className = "verse-translit",
}: {
  text: string;
  lang: string | null;
  kind: "latin" | "devanagari";
  style: HebrewStyle;
  divineName: "adonai" | "hashem";
  className?: string;
}) {
  const out = useMemo(() => transliterateText(text, lang, { style, divineName }), [text, lang, style, divineName]);
  if (!out) return null;
  return (
    <p className={className} lang={kind === "devanagari" ? "sa-Deva" : `${lang}-Latn`} dir="ltr">
      {out}
    </p>
  );
}

const HEBREW_WORD = /([א-ת][֑-ׇא-ת׳״"']*)/;

/**
 * Hebrew text with each word clickable for word study. A click that ends a
 * drag selection is a selection, not a lookup.
 */
export function HebrewWords({ text, onWord }: { text: string; onWord: (word: string) => void }) {
  const parts = useMemo(() => text.split(HEBREW_WORD), [text]);
  const click = (e: MouseEvent<HTMLSpanElement>) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const word = (e.currentTarget.textContent ?? "").trim();
    if (word) onWord(word);
  };
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="w" onClick={click}>
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

type Entry = {
  headword: string;
  lexicon: string;
  strong: string;
  morphology: string;
  senses: { depth: number; text: string }[];
  url: string;
};

/** The study panel's view of one word: its readings and its dictionary entries. */
export function WordStudy({
  word,
  divineName,
  style,
  slug,
}: {
  word: string;
  divineName: "adonai" | "hashem";
  style: HebrewStyle;
  slug?: string;
}) {
  const [data, setData] = useState<{ word: string; entries: Entry[] } | null>(null);
  const [error, setError] = useState("");
  const info = useMemo(() => hebrewWordInfo(word, divineName), [word, divineName]);
  const [allStyles, setAllStyles] = useState(false);

  useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    api<{ word: string; entries: Entry[] }>(`/api/words?w=${encodeURIComponent(word)}`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [word]);

  const clean = data?.word ?? word;
  const shownStyles = allStyles ? HEBREW_STYLES : HEBREW_STYLES.filter((s) => s.value === style);
  return (
    <div className="word-study">
      <dl className="word-readings">
        {shownStyles.map((s) => (
          <Fragment key={s.value}>
            <dt title={s.blurb}>{s.label}</dt>
            <dd>{info[s.value]}</dd>
          </Fragment>
        ))}
      </dl>
      <button className="button ghost small" onClick={() => setAllStyles((v) => !v)}>
        {allStyles ? "Only my reading tradition" : "Every reading tradition"}
      </button>

      <section className="study-section">
        <h3>Dictionary</h3>
        {error && <p className="muted small">The lexicon could not be reached: {error}</p>}
        {!data && !error && <Loading label="Looking the word up" />}
        {data && !data.entries.length && (
          <p className="muted small">
            Sefaria's lexicons have no entry for this form. A prefixed or inflected word is sometimes listed only under its root.
          </p>
        )}
        {data?.entries.map((e, i) => (
          <article key={i} className="lexicon-entry">
            <header>
              <span className="lexicon-headword" lang="he" dir="rtl">{e.headword}</span>
              <span className="lexicon-name">{e.lexicon}{e.strong ? ` · Strong's ${e.strong}` : ""}</span>
            </header>
            {e.morphology && <p className="lexicon-morph">{e.morphology}</p>}
            <ol className="lexicon-senses">
              {e.senses.map((s, k) => (
                <li key={k} style={{ marginInlineStart: `${s.depth * 14}px` }} dir="auto">{s.text}</li>
              ))}
            </ol>
            <a className="small" href={e.url} target="_blank" rel="noreferrer">
              Full entry at Sefaria <Icon name="external" size={12} />
            </a>
          </article>
        ))}
        {data && data.entries.length > 0 && (
          <p className="muted small">Entries from Sefaria's lexicons (BDB, Jastrow, Klein), read live and not stored.</p>
        )}
      </section>

      <section className="study-section">
        <h3>Find this word</h3>
        <div className="study-actions">
          {slug && (
            <Link className="button small" to={`/search?q=${encodeURIComponent(clean.replace(/[֑-ׇ]/g, ""))}&work=${encodeURIComponent(slug)}`}>
              <Icon name="search" size={14} /> In this work
            </Link>
          )}
          <Link className="button small" to={`/search?q=${encodeURIComponent(clean.replace(/[֑-ׇ]/g, ""))}`}>
            <Icon name="library" size={14} /> Everywhere
          </Link>
        </div>
      </section>
    </div>
  );
}
