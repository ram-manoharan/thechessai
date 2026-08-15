"use client";
import { useEffect, useState, createElement, type ReactNode } from "react";

type Theme = "dark" | "light";

function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("chess-theme", t);
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const saved = localStorage.getItem("chess-theme") as Theme | null;
    const initial = saved ?? "light";
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  };

  return { theme, toggle };
}

// Reactive theme reader for components (e.g. <canvas> drawing code) that
// can't rely on CSS custom properties and need to redraw when the theme
// toggles elsewhere on the page. useTheme()'s state is local per-instance
// and only updates the DOM/localStorage, so a second component calling it
// won't re-render when another component's toggle() fires — this watches
// the actual data-theme attribute instead.
export function useCurrentTheme(): Theme {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setTheme((el.getAttribute("data-theme") as Theme) || "light");
    read();
    const obs = new MutationObserver(read);
    obs.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const saved = localStorage.getItem("chess-theme") as "dark" | "light" | null;
    document.documentElement.setAttribute("data-theme", saved ?? "light");
  }, []);
  return createElement("div", { style: { display: "contents" } }, children);
}
