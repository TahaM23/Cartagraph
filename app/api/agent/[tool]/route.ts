import { createClient } from "@supabase/supabase-js";
import { AnswerError, ANSWERS, isTool, prepare, type AnalysisFacts } from "@/lib/agent/answers";
import { assembleGraph, type StoredRows } from "@/lib/analysis/stored";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

// The agent's tools, read-only. There is no signed-in user here: the bearer
// credential names the one analysis, and the database checks it before
// returning anything (supabase/migrations/…_agent_reads.sql). This handler
// holds only the publishable key, so whatever reaches it can read no more
// than the credential allows.

const fail = (status: number, error: string) => Response.json({ error }, { status });

/** What the database's refusals mean to the agent. */
const REFUSALS: Record<string, [number, string]> = {
  CG401: [401, "access to this analysis was refused or has expired"],
  CG404: [404, "this analysis is not available, possibly because it is being re-run"],
  CG503: [503, "agent access is not configured"],
};

export async function POST(request: Request, { params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  if (!isTool(tool)) return fail(404, `There is no ${tool} lookup.`);

  const credential = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!credential) return fail(401, "access to this analysis was refused or has expired");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "The lookup's input was not JSON.");
  }
  const input = ANSWERS[tool].input.safeParse(body);
  if (!input.success) return fail(400, `The lookup's input was not valid: ${input.error.issues.map((i) => i.message).join("; ")}`);

  const db = createClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.rpc("agent_graph", { credential });
  if (error) {
    const refusal = REFUSALS[error.code];
    if (refusal) return fail(...refusal);
    console.error("agent graph read failed:", error);
    return fail(500, "the analysis could not be read");
  }

  const stored = data as unknown as {
    analysis: { adapter: string | null; commit_sha: string | null; coverage: unknown; repository: string };
    files: StoredRows["fileRows"];
    roles: StoredRows["roleRows"];
    edges: StoredRows["edgeRows"];
    routes: StoredRows["routeRows"];
  };
  const facts: AnalysisFacts = {
    repository: stored.analysis.repository,
    adapter: stored.analysis.adapter,
    commit: stored.analysis.commit_sha,
    coverage: stored.analysis.coverage,
  };

  try {
    const graph = assembleGraph("(agent)", {
      fileRows: stored.files,
      roleRows: stored.roles,
      edgeRows: stored.edges,
      routeRows: stored.routes,
    });
    const answer = (ANSWERS[tool].answer as (p: ReturnType<typeof prepare>, input: unknown) => unknown)(
      prepare(graph, facts),
      input.data,
    );
    return Response.json(answer);
  } catch (e) {
    if (e instanceof AnswerError) return fail(e.status, e.message);
    console.error(`agent lookup ${tool} failed:`, e);
    return fail(500, "the lookup failed");
  }
}
