"use client";
import { useEffect, useState, createElement, type ReactNode } from "react";

type Theme = "dark" | "light";

function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("chess-theme", t);
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const saved = localStorage.getItem("chess-theme") as Theme | null;
    const initial = saved ?? "dark";
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

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const saved = localStorage.getItem("chess-theme") as "dark" | "light" | null;
    document.documentElement.setAttribute("data-theme", saved ?? "dark");
  }, []);
  return createElement("div", { style: { display: "contents" } }, children);
}
