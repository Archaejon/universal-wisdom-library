import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type Theme = "system" | "light" | "dark";
type Prefs = {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (t: Theme) => void;
  fontSize: number;
  setFontSize: (n: number) => void;
  lineHeight: number;
  setLineHeight: (n: number) => void;
  measure: number;
  setMeasure: (n: number) => void;
  readingFont: "serif" | "sans";
  setReadingFont: (f: "serif" | "sans") => void;
};

const PrefsContext = createContext<Prefs | null>(null);
const KEY = "uwl.prefs.v1";

function load(): Partial<Prefs> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const saved = load();
  const [theme, setThemeState] = useState<Theme>(saved.theme ?? "system");
  const [fontSize, setFontSizeState] = useState<number>(saved.fontSize ?? 18);
  const [lineHeight, setLineHeightState] = useState<number>(saved.lineHeight ?? 1.72);
  const [measure, setMeasureState] = useState<number>(saved.measure ?? 680);
  const [readingFont, setReadingFontState] = useState<"serif" | "sans">(saved.readingFont ?? "serif");
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const resolvedTheme: "light" | "dark" = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.style.setProperty("--reading-size", `${fontSize}px`);
    root.style.setProperty("--reading-leading", String(lineHeight));
    root.style.setProperty("--reading-measure", `${measure}px`);
    root.dataset.readingFont = readingFont;
    localStorage.setItem(KEY, JSON.stringify({ theme, fontSize, lineHeight, measure, readingFont }));
  }, [resolvedTheme, theme, fontSize, lineHeight, measure, readingFont]);

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme: setThemeState,
      fontSize,
      setFontSize: setFontSizeState,
      lineHeight,
      setLineHeight: setLineHeightState,
      measure,
      setMeasure: setMeasureState,
      readingFont,
      setReadingFont: setReadingFontState,
    }),
    [theme, resolvedTheme, fontSize, lineHeight, measure, readingFont],
  );
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs() {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used inside PrefsProvider");
  return ctx;
}
