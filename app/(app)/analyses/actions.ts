"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { parseRepositoryUrl } from "@/lib/pipeline/github";
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

  if (analysis.created) startRun(analysis.id);
  redirect(`/analyses/${analysis.id}`);
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
