"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { AiUnavailable, flushTraces } from "@/lib/ai/client";
import { explainFile, explainFolder, ExplainError, type AnalysisRef } from "@/lib/explain/explain";
import { freshness } from "@/lib/explain/freshness";
import type { ExplainResponse } from "@/lib/explain/types";
import { taxonomyOf } from "@/lib/parser/adapters/taxonomy";
import { parseRepositoryUrl, RunError } from "@/lib/pipeline/github";
import { runAnalysis } from "@/lib/pipeline/run";
import { STALE_AFTER_MS } from "@/lib/pipeline/stages";
import { startAnalysis } from "@/lib/pipeline/start";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";

export interface AnalyseState {
  error: string | null;
  /** What was submitted, so a rejected URL stays in the box to be fixed. */
  url: string;
}

// The run outlives this request: it starts after the redirect has gone out,
// and writes with the secret key because the user's session token expires
// long before a large repository is stored.
function startRun(id: string) {
  after(() => runAnalysis(createAdminSupabase(), id));
}

/**
 * The dashboard form. A repository the organization already has an analysis
 * for goes to that analysis and starts nothing; re-running is done from the
 * analysis itself.
 */
export async function analyseRepository(_prev: AnalyseState, form: FormData): Promise<AnalyseState> {
  const url = String(form.get("url") ?? "").trim();
  const { orgId } = await auth();
  if (!orgId) return { url, error: "Pick an organization first; analyses belong to one." };

  const repo = parseRepositoryUrl(url);
  if (!repo) {
    return { url, error: "That is not a GitHub repository URL. Use github.com/owner/name." };
  }

  // The user's own client: the insert policies check the organization.
  let analysis;
  try {
    analysis = await startAnalysis(await createServerSupabase(), orgId, repo);
  } catch (error) {
    return { url, error: error instanceof Error ? error.message : "Starting the analysis failed." };
  }

  if (analysis.created) {
    startRun(analysis.id);
    redirect(`/analyses/${analysis.id}`);
  }
  // Already analysed: straight to its map if it has one, else to its run.
  redirect(`/analyses/${analysis.id}${analysis.status === "complete" ? "/map" : ""}`);
}

/**
 * Re-run an analysis on purpose. Refused while a run is in flight, unless it
 * has gone stale, so two runs never write the same analysis at once.
 */
export async function rerunAnalysis(id: string): Promise<void> {
  // Visible through the user's client means it belongs to their organization.
  const supabase = await createServerSupabase();
  const { data: visible, error } = await supabase.from("analyses").select("id").eq("id", id).maybeSingle();
  if (error) throw new Error(`Reading the analysis failed: ${error.message}`);
  if (!visible) throw new Error("No such analysis in this organization.");

  // One conditional update, so two clicks cannot both start a run.
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS).toISOString();
  const { data: claimed, error: claimError } = await createAdminSupabase()
    .from("analyses")
    .update({ status: "queued", stage: null, stage_message: null, error: null, stage_at: new Date().toISOString() })
    .eq("id", id)
    .or(`status.in.(complete,failed),stage_at.lt.${staleBefore},and(stage_at.is.null,created_at.lt.${staleBefore})`)
    .select("id");
  if (claimError) throw new Error(`Re-running failed: ${claimError.message}`);

  if (claimed.length > 0) startRun(id);
  redirect(`/analyses/${id}`);
}

const ExplainRequest = z.object({
  analysisId: z.uuid(),
  subject: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("file"), path: z.string().min(1).max(1024) }),
    z.object({ kind: z.literal("folder"), dir: z.string().min(1).max(1024) }),
  ]),
});

/**
 * Explain a file or a folder of an analysis. The caller names which; what it
 * is connected to, and the code itself, are read here from the stored graph
 * and the analysed commit, never taken from the request.
 *
 * Answers with what went wrong rather than throwing, so the pane can say it.
 */
export async function explainSubject(analysisId: string, subject: unknown): Promise<ExplainResponse> {
  const request = ExplainRequest.safeParse({ analysisId, subject });
  if (!request.success) return { ok: false, error: "That is not something that can be explained." };

  // Visible through the user's client means it belongs to their organization.
  const db = await createServerSupabase();
  const { data: row, error } = await db
    .from("analyses")
    .select("id, org_id, status, commit_sha, adapter, project:projects(repo_owner, repo_name)")
    .eq("id", request.data.analysisId)
    .maybeSingle();
  if (error) return { ok: false, error: `Reading the analysis failed: ${error.message}` };
  if (!row || !row.project) return { ok: false, error: "No such analysis in this organization." };
  if (row.status !== "complete" || !row.commit_sha) {
    return { ok: false, error: "This analysis is being re-run; explain once it completes." };
  }

  const analysis: AnalysisRef = {
    id: row.id,
    orgId: row.org_id,
    commit: row.commit_sha,
    repo: { owner: row.project.repo_owner, name: row.project.repo_name },
    framework: taxonomyOf(row.adapter ?? "")?.framework ?? null,
  };
  const target = request.data.subject;
  const context = { db, admin: createAdminSupabase(), analysis };

  // Traces are sent once the answer has gone out, not before.
  after(() => flushTraces().catch((e) => console.warn("Sending traces failed:", e)));

  try {
    // Whether the code has moved on is asked of GitHub alongside, not inside
    // the traced run: it is not a model call and decides nothing in it.
    const [written, fresh] = await Promise.all([
      target.kind === "file"
        ? explainFile({ ...context, path: target.path })
        : explainFolder({ ...context, dir: target.dir }),
      (async () =>
        freshness(analysis.repo, analysis.commit, target.kind === "file" ? await fileHash(db, analysis.id, target.path) : null))(),
    ]);
    return { ok: true, ...written, freshness: fresh };
  } catch (error) {
    if (error instanceof ExplainError || error instanceof AiUnavailable || error instanceof RunError) {
      return { ok: false, error: error.message };
    }
    console.error("explaining failed:", error);
    return { ok: false, error: `Explaining failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** The hash the parser stored for a file: what the repository's copy is compared against. */
async function fileHash(db: Awaited<ReturnType<typeof createServerSupabase>>, analysisId: string, path: string) {
  const { data } = await db.from("files").select("path, hash").eq("analysis_id", analysisId).eq("path", path).maybeSingle();
  return data;
}
