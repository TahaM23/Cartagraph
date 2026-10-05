// One analysis per repository. Asking for a repository the organization has
// already analysed returns that analysis rather than creating another;
// re-running it is a separate, deliberate act.
//
// Called with the signed-in user's client, so the insert policies are what
// check that `orgId` is the caller's own organization. Concurrent requests for
// the same repository race on the unique constraints, and the loser reads the
// winner's row.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types.ts";
import type { RepositoryRef } from "./github.ts";

type Db = SupabaseClient<Database>;

const UNIQUE_VIOLATION = "23505";

export interface StartedAnalysis {
  id: string;
  /** False when the repository already had an analysis; nothing new should run. */
  created: boolean;
  status: string;
}

async function findOrCreate<T>(
  find: () => PromiseLike<{ data: T | null; error: { message: string } | null }>,
  create: () => PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>,
  what: string,
): Promise<{ row: T; created: boolean }> {
  const found = await find();
  if (found.error) throw new Error(`Looking up the ${what} failed: ${found.error.message}`);
  if (found.data) return { row: found.data, created: false };

  const made = await create();
  if (made.data) return { row: made.data, created: true };
  if (made.error?.code !== UNIQUE_VIOLATION) {
    throw new Error(`Creating the ${what} failed: ${made.error?.message ?? "no row returned"}`);
  }
  const again = await find();
  if (!again.data) throw new Error(`Creating the ${what} raced with another request and lost it.`);
  return { row: again.data, created: false };
}

export async function startAnalysis(db: Db, orgId: string, repo: RepositoryRef): Promise<StartedAnalysis> {
  // Organizations are created in Clerk; the row appears the first time one is used.
  const org = await db.from("organizations").upsert({ id: orgId }, { ignoreDuplicates: true });
  if (org.error) throw new Error(`Registering the organization failed: ${org.error.message}`);

  const { row: project } = await findOrCreate<{ id: string }>(
    () =>
      db
        .from("projects")
        .select("id")
        .eq("org_id", orgId)
        .eq("repo_owner", repo.owner)
        .eq("repo_name", repo.name)
        .maybeSingle(),
    () =>
      db
        .from("projects")
        .insert({ org_id: orgId, repo_owner: repo.owner, repo_name: repo.name })
        .select("id")
        .single(),
    "project",
  );

  const { row: analysis, created } = await findOrCreate<{ id: string; status: string }>(
    () => db.from("analyses").select("id, status").eq("project_id", project.id).maybeSingle(),
    () =>
      db
        .from("analyses")
        .insert({ org_id: orgId, project_id: project.id, status: "queued" })
        .select("id, status")
        .single(),
    "analysis",
  );

  return { id: analysis.id, created, status: analysis.status };
}
