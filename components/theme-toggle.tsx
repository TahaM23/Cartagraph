"use client";

import { useState } from "react";
import { applyTheme, THEMES, type Theme } from "@/lib/theme";
import { saveTheme } from "@/lib/theme-actions";

const LABELS: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

// The server renders <html data-theme> from the same cookie, so the choice is
// in place on first paint after a reload.
export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState(initial);

  function choose(next: Theme) {
    setTheme(next);
    applyTheme(next);
    void saveTheme(next);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex rounded-full border border-border p-0.5 text-xs font-medium"
    >
      {THEMES.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={theme === t}
          onClick={() => choose(t)}
          className={`h-7 rounded-full px-3 transition-colors ${
            theme === t
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {LABELS[t]}
        </button>
      ))}
    </div>
  );
}
