// "Recently opened": the last passages and chapters read in this browser.
// Kept in localStorage (never sent anywhere) and shown in the sidebar, which
// re-reads it whenever the reader records a visit.
import { useSyncExternalStore } from "react";

export type RecentEntry = { slug: string; title: string; ref: string; refLabel: string; at: number };

const KEY = "uwl_recent";
const EVENT = "uwl-recent";
const LIMIT = 8;

let cache: RecentEntry[] | null = null;

function read(): RecentEntry[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list.filter((r) => r && r.slug && r.ref) : [];
  } catch {
    return [];
  }
}

export function addRecent(entry: Omit<RecentEntry, "at">) {
  try {
    const next = [
      { ...entry, at: Date.now() },
      ...read().filter((r) => !(r.slug === entry.slug && r.ref === entry.ref)),
    ].slice(0, LIMIT);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  cache = null;
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  const onChange = () => {
    cache = null;
    cb();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange); // another tab
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function snapshot() {
  if (!cache) cache = read();
  return cache;
}

const EMPTY: RecentEntry[] = [];
export function useRecent(): RecentEntry[] {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

export function recentHref(r: RecentEntry) {
  return `/read/${encodeURIComponent(r.slug)}?ref=${encodeURIComponent(r.ref)}`;
}
