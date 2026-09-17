import type { JSX } from "react";
import type { Theme } from "./useTheme.ts";

export interface ThemeToggleProps {
  theme: Theme;
  onToggle: () => void;
  floating?: boolean;
}

export function ThemeToggle({
  theme,
  onToggle,
  floating = false,
}: ThemeToggleProps): JSX.Element {
  return (
    <button
      type="button"
      className={
        floating ? "theme-toggle theme-toggle-floating" : "theme-toggle"
      }
      onClick={onToggle}
      aria-pressed={theme === "dark"}
    >
      {theme === "dark" ? "☀ Light" : "☾ Dark"}
    </button>
  );
}
