import { useEffect, useRef, useState, type RefObject } from "react";
import { navigate } from "./router";
import { Icon, useToast } from "./components";

/**
 * A small toolbar over text selected in the reader: ask the assistant about
 * it, search for it in this work or everywhere, or copy it with its citation.
 *
 * The passage a selection belongs to comes from the nearest element carrying
 * `data-ref` (a verse row, a passage's panels, a paragraph of the continuous
 * view). A selection that crosses passages belongs to the one it starts in.
 */

export type AskContextDraft = {
  work: string;
  workTitle: string;
  reference: string;
  label: string;
  selection: string;
  tradition?: { slug: string; name: string } | null;
};

const ASK_KEY = "uwl_ask_context";

export function saveAskContext(ctx: AskContextDraft) {
  try {
    sessionStorage.setItem(ASK_KEY, JSON.stringify(ctx));
  } catch {
    // A private window may refuse storage; the assistant then opens without context.
  }
}

export function loadAskContext(): AskContextDraft | null {
  try {
    const raw = sessionStorage.getItem(ASK_KEY);
    const ctx = raw ? JSON.parse(raw) : null;
    return ctx && typeof ctx.work === "string" && typeof ctx.selection === "string" ? ctx : null;
  } catch {
    return null;
  }
}

export function clearAskContext() {
  try {
    sessionStorage.removeItem(ASK_KEY);
  } catch {}
}

const MAX_SELECTION = 600;

type Picked = { text: string; ref: string; label: string; top: number; left: number; below: boolean };

const WORD = /[\p{L}\p{M}\p{N}'’]/u;

/**
 * The selected text widened to whole words. A drag that starts or ends inside
 * a word would otherwise search for "n the beginning … Wo". The reader's own
 * selection is left as it is; only the text the toolbar uses is widened.
 */
export function wholeWords(range: Range): string {
  const r = range.cloneRange();
  const start = r.startContainer;
  if (start.nodeType === Node.TEXT_NODE) {
    const t = start.textContent ?? "";
    let i = r.startOffset;
    while (i > 0 && WORD.test(t[i - 1]) && WORD.test(t[i] ?? "")) i--;
    r.setStart(start, i);
  }
  const end = r.endContainer;
  if (end.nodeType === Node.TEXT_NODE) {
    const t = end.textContent ?? "";
    let j = r.endOffset;
    while (j < t.length && WORD.test(t[j]) && j > 0 && WORD.test(t[j - 1])) j++;
    r.setEnd(end, j);
  }
  return r.toString();
}

function closestRef(node: Node | null): HTMLElement | null {
  const el = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  return (el?.closest("[data-ref]") as HTMLElement | null) ?? null;
}

/** Up to a dozen words is searched as a phrase; more is searched by its words. */
export function searchHref(text: string, work?: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  const words = clean.split(" ");
  const q = new URLSearchParams();
  if (words.length <= 12) {
    q.set("q", clean);
    q.set("mode", "phrase");
  } else {
    q.set("q", words.slice(0, 16).join(" "));
  }
  if (work) q.set("work", work);
  return `/search?${q.toString()}`;
}

export function SelectionToolbar({
  root,
  slug,
  workTitle,
  tradition,
}: {
  root: RefObject<HTMLElement | null>;
  slug: string;
  workTitle: string;
  tradition?: { slug: string; name: string } | null;
}) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const { push } = useToast();

  useEffect(() => {
    let timer = 0;
    const read = () => {
      const sel = window.getSelection();
      const host = root.current;
      if (!sel || sel.isCollapsed || !sel.rangeCount || !host) return setPicked(null);
      const range = sel.getRangeAt(0);
      if (!host.contains(range.commonAncestorContainer)) return setPicked(null);
      // Selecting inside a form field or the reader bar is not reading.
      const anchorEl = closestRef(sel.anchorNode) ?? closestRef(range.startContainer);
      if (!anchorEl) return setPicked(null);
      const text = wholeWords(range).replace(/\s+/g, " ").trim();
      if (text.length < 2) return setPicked(null);
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) return setPicked(null);
      // On a touch screen the system's own copy menu sits above a selection.
      const below = window.matchMedia?.("(pointer: coarse)").matches ?? false;
      setPicked({
        text: text.slice(0, MAX_SELECTION),
        ref: anchorEl.dataset.ref ?? "",
        label: anchorEl.dataset.label ?? anchorEl.dataset.ref ?? "",
        top: below ? rect.bottom + 10 : rect.top - 10,
        left: rect.left + rect.width / 2,
        below,
      });
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(read, 120);
    };
    const hide = () => setPicked(null);
    document.addEventListener("selectionchange", schedule);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", schedule);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [root]);

  // Keep the bar inside the window once its width is known.
  const [shift, setShift] = useState(0);
  useEffect(() => {
    if (!picked || !bar.current) return setShift(0);
    const w = bar.current.offsetWidth;
    const half = w / 2;
    const min = 8 + half;
    const max = window.innerWidth - 8 - half;
    setShift(Math.min(max, Math.max(min, picked.left)) - picked.left);
  }, [picked]);

  if (!picked) return null;

  const done = () => {
    window.getSelection()?.removeAllRanges();
    setPicked(null);
  };
  const ask = () => {
    saveAskContext({ work: slug, workTitle, reference: picked.ref, label: picked.label, selection: picked.text, tradition: tradition ?? null });
    done();
    navigate("/assistant?from=reader");
  };
  const copy = async () => {
    const cite = `“${picked.text}” — ${workTitle} ${picked.label}. ${window.location.origin}/read/${slug}?ref=${encodeURIComponent(picked.ref)}`;
    try {
      await navigator.clipboard.writeText(cite);
      push("Copied with its citation.", "success");
    } catch {
      push("Copying was blocked by the browser.", "error");
    }
    done();
  };

  return (
    <div
      ref={bar}
      className={picked.below ? "selection-bar below" : "selection-bar"}
      role="toolbar"
      aria-label="Selected text"
      style={{ top: picked.top, left: picked.left + shift }}
      // Pressing a button must not clear the selection before it is read.
      onMouseDown={(e) => e.preventDefault()}
    >
      <button onClick={ask} title={`Ask the study assistant about this, with ${workTitle} ${picked.label} as context`}>
        <Icon name="chat" size={15} /> Ask
      </button>
      <button
        onClick={() => {
          const href = searchHref(picked.text, slug);
          done();
          navigate(href);
        }}
        title={`Search ${workTitle} for this`}
      >
        <Icon name="search" size={15} /> This work
      </button>
      <button
        onClick={() => {
          const href = searchHref(picked.text);
          done();
          navigate(href);
        }}
        title="Search the whole library for this"
      >
        <Icon name="library" size={15} /> Everywhere
      </button>
      <button onClick={copy} title="Copy the selection with its citation">
        <Icon name="quote" size={15} /> Copy
      </button>
    </div>
  );
}
