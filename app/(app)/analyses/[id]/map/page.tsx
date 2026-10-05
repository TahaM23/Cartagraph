import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Analysis } from "@/components/canvas/analysis";
import { CodeMap } from "@/components/canvas/code-map";
import { DetailPane } from "@/components/canvas/detail-pane";
import { AnalysisShell } from "@/components/canvas/shell";
import { loadStoredGraph } from "@/lib/analysis/stored";
import { countCategories } from "@/lib/canvas/categories";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Map · Cartograph" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The map of a stored analysis. Until its run has completed there is nothing
// to draw, so this sends you to the run instead.
export default async function AnalysisMapPage({ params }: PageProps<"/analyses/[id]/map">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await createServerSupabase();
  const { data: analysis, error } = await supabase
    .from("analyses")
    .select("id, status, adapter, project:projects(repo_owner, repo_name)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Loading the analysis failed: ${error.message}`);
  if (!analysis) notFound();
  if (analysis.status !== "complete") redirect(`/analyses/${id}`);

  const { files, edges } = await loadStoredGraph(supabase, id);
  const repository = analysis.project
    ? `${analysis.project.repo_owner}/${analysis.project.repo_name}`
    : "unknown repository";

  return (
    <Analysis files={files} edges={edges} repository={repository} adapter={analysis.adapter ?? "fallback"}>
      <AnalysisShell
        repository={repository}
        files={files.length}
        categories={countCategories(files)}
        runHref={`/analyses/${id}`}
        map={<CodeMap />}
        detail={<DetailPane />}
      />
    </Analysis>
  );
}
