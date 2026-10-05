import type { ReactNode } from "react";
import type { Category } from "@/lib/canvas/categories";
import { CategoryRail } from "./category-rail";

// The analysis view's three columns: a narrow rail, the map, a detail pane.
// This arrangement is settled. Later phases fill the columns; they do not move
// them, and the detail pane stays a column, never a drawer or an overlay.
//
// The height is the viewport minus the app header (h-14), so the map gets a
// fixed area to fit itself to rather than growing with its content.
export function AnalysisShell({
  repository,
  files,
  categories,
  map,
  detail,
}: {
  repository: string;
  files: number;
  categories: readonly { category: Category; files: number }[];
  map?: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="grid h-[calc(100dvh-3.5rem)] grid-cols-[13rem_minmax(0,1fr)_20rem]">
      <nav
        aria-label="File categories"
        className="flex min-h-0 flex-col overflow-y-auto border-r border-border"
      >
        <div className="border-b border-border px-3 py-2.5">
          <p className="truncate font-mono font-medium" title={repository}>
            {repository}
          </p>
          <p className="text-muted-foreground">
            {files === 1 ? "1 file" : `${files} files`}
          </p>
        </div>
        <CategoryRail categories={categories} />
      </nav>

      <section aria-label="Map" className="relative min-h-0 min-w-0 bg-surface">
        {map}
      </section>

      <aside
        aria-label="Details"
        className="min-h-0 overflow-y-auto border-l border-border"
      >
        {detail ?? (
          <p className="px-4 py-3 text-faint-foreground">Nothing selected</p>
        )}
      </aside>
    </div>
  );
}
