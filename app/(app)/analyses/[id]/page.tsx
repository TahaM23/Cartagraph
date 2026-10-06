import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { rerunAnalysis } from "@/app/(app)/analyses/actions";
import { RunProgressView } from "@/components/analysis/run-progress";
import { isStageEvent, type StageEvent } from "@/lib/pipeline/stages";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Analysis · Cartograph" };

// A run started from this page (re-run) runs after the response, within this
// route's time limit.
export const maxDuration = 300;

async function loadAnalysis(id: string) {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("analyses")
    .select(
      "id, status, stage, stage_message, stage_at, error, commit_sha, created_at, files_total, files_parsed, edge_count, adapter, project:projects(repo_owner, repo_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Loading the analysis failed: ${error.message}`);
  return { analysis: data, readAt: Date.now() };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// One URL per analysis: its progress while it runs, then its result. Another
// organization's analysis is not hidden here; row-level security means the
// query does not return it, so it is a 404 like any id that does not exist.
export default async function AnalysisPage({ params }: PageProps<"/analyses/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { analysis, readAt } = await loadAnalysis(id);
  if (!analysis) notFound();

  const event: StageEvent = {
    status: analysis.status as StageEvent["status"],
    stage: analysis.stage as StageEvent["stage"],
    message: analysis.status === "failed" ? analysis.error : analysis.stage_message,
  };
  if (!isStageEvent(event)) throw new Error(`Analysis ${id} is in an unknown state: ${analysis.status}`);
  const movedAt = analysis.stage_at ?? analysis.created_at;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
        <h1 className="font-mono text-base font-semibold">
          {analysis.project ? (
            <>
              <span className="font-normal text-muted-foreground">{analysis.project.repo_owner}/</span>
              {analysis.project.repo_name}
            </>
          ) : (
            "unknown repository"
          )}
        </h1>
        {analysis.commit_sha && (
          <span className="font-mono text-muted-foreground" title={analysis.commit_sha}>
            {analysis.commit_sha.slice(0, 7)}
          </span>
        )}
      </div>

      <div className="flex w-full max-w-2xl flex-col gap-6 px-4 py-5 sm:px-5">
        {/* Keyed on the row's state, so a re-run or a refresh starts from the new row. */}
        <RunProgressView
          key={`${analysis.status}:${movedAt}`}
          id={analysis.id}
          initial={{ ...event, movedAt }}
          renderedAt={readAt}
          rerun={rerunAnalysis.bind(null, analysis.id)}
        />

        {analysis.status === "complete" && (
          <Link href={`/analyses/${analysis.id}/map`} className="self-start text-accent hover:underline">
            Open the map
          </Link>
        )}
        {analysis.status === "complete" && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5">
            <dt className="text-muted-foreground">Files</dt>
            <dd>
              {analysis.files_parsed?.toLocaleString("en-US")} parsed of{" "}
              {analysis.files_total?.toLocaleString("en-US")} found
            </dd>
            <dt className="text-muted-foreground">Edges</dt>
            <dd>{analysis.edge_count?.toLocaleString("en-US")}</dd>
            <dt className="text-muted-foreground">Adapter</dt>
            <dd className="font-mono">{analysis.adapter}</dd>
            <dt className="text-muted-foreground">Commit</dt>
            <dd className="font-mono">{analysis.commit_sha}</dd>
          </dl>
        )}
      </div>
    </div>
  );
}
