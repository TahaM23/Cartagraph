import type { Metadata } from "next";
import { Analysis } from "@/components/canvas/analysis";
import { CodeMap } from "@/components/canvas/code-map";
import { DetailPane } from "@/components/canvas/detail-pane";
import { AnalysisShell } from "@/components/canvas/shell";
import { countCategories } from "@/lib/canvas/categories";
import { preview } from "@/lib/preview";

export const metadata: Metadata = { title: "Preview · Cartograph" };

// The analysis view, rendered from the checked-in parse result. Public, so it
// works without an account.
export default function PreviewPage() {
  const repository = preview.root.slice(preview.root.lastIndexOf("/") + 1);

  return (
    <Analysis
      files={preview.files}
      edges={preview.edges.map(({ source, target }) => ({ source, target }))}
      repository={repository}
      adapter={preview.adapter}
    >
      <AnalysisShell
        repository={repository}
        files={preview.files.length}
        categories={countCategories(preview.files)}
        map={<CodeMap />}
        detail={<DetailPane />}
      />
    </Analysis>
  );
}
