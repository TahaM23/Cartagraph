"use client";

import type { Category } from "@/lib/canvas/categories";
import { useAnalysis } from "./analysis";
import { CategoryLabel } from "./category-label";

/**
 * The rail's categories. Picking one dims every file outside it on the map
 * rather than removing it, so the shape of the whole repository stays on
 * screen; picking it again clears it.
 */
export function CategoryRail({ categories }: { categories: readonly { category: Category; files: number }[] }) {
  const { category: picked, setCategory } = useAnalysis();
  return (
    <ul className="py-1.5">
      {categories.map(({ category, files }) => {
        const on = category === picked;
        return (
          <li key={category}>
            <button
              type="button"
              aria-pressed={on}
              title={on ? "Show every file again" : "Dim every file that is not in this category"}
              onClick={() => setCategory(on ? null : category)}
              className={`flex w-full items-center gap-2.5 px-3 py-1 text-left text-[13px] ${
                on ? "bg-accent/15 text-foreground" : picked ? "text-muted-foreground hover:bg-muted" : "hover:bg-muted"
              }`}
            >
              <CategoryLabel category={category} className="flex-1 truncate" />
              <span className="font-mono text-muted-foreground tabular-nums">{files}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
