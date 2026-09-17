import { useEffect, useState } from "react";

const STORAGE_KEY = "astro-cms:theme";

export type Theme = "light" | "dark";

function preferredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    // Reading the stored choice is a convenience; fall back to the OS preference.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Applies the active theme to the document and persists changes to it. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(preferredTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Persisting the choice is a convenience; ignore storage failures.
    }
  }, [theme]);

  const toggle = () =>
    setTheme((current) => (current === "dark" ? "light" : "dark"));

  return [theme, toggle];
}
