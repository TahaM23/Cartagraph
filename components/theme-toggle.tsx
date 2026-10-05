"use client";

import { useState } from "react";
import { applyTheme, THEMES, type Theme } from "@/lib/theme";
import { saveTheme } from "@/lib/theme-actions";

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
      className="flex rounded-md border border-border p-0.5 text-[13px]"
    >
      {THEMES.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={theme === t}
          onClick={() => choose(t)}
          className={`h-7 rounded px-2.5 transition-colors ${
            theme === t
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
