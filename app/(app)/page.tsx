import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { AnalyseForm } from "@/components/analysis/analyse-form";
import { LiveState } from "@/components/analysis/live-state";
import { StateGlyph } from "@/components/analysis/state-glyph";
import { isStale, type StageEvent } from "@/lib/pipeline/stages";
import { createServerSupabase } from "@/lib/supabase/server";

// A run started from the form runs after the response, within this route's
// time limit.
export const maxDuration = 300;

// The active organization's analyses. The query has no organization filter on
// purpose: the session token carries the organization, and row-level security
// decides which rows come back. Switching organization changes the token, not
// this code. If another organization's row ever shows up here, the bug is the
// policy.
async function loadAnalyses() {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("analyses")
    .select(
      "id, status, stage, stage_message, stage_at, commit_sha, error, created_at, finished_at, project:projects(repo_owner, repo_name)",
    )
    .order("created_at", { ascending: false });

  // An error must not render as an empty list: "no rows" and "couldn't ask"
  // are different answers.
  if (error) throw new Error(`Loading analyses failed: ${error.message}`);

  // Relative times are measured from the moment the rows were read.
  return { analyses: data, readAt: Date.now() };
}

const STATES = ["parsing", "queued", "stale", "complete", "failed"] as const;

export default async function DashboardPage() {
  const { orgId, sessionClaims } = await auth();

  if (!orgId) {
    return (
      <p className="px-4 py-6 text-muted-foreground sm:px-5">
        No active organization. Pick one from the switcher above.
      </p>
    );
  }

  const { analyses: rows, readAt } = await loadAnalyses();
  // An unfinished run that stopped moving is counted as stale, not as working.
  const analyses = rows.map((a) => {
    const movedAt = a.stage_at ?? a.created_at;
    return { ...a, movedAt, state: isStale(a.status, movedAt, readAt) ? "stale" : a.status };
  });
  const counts = STATES.map(
    (s) => [s, analyses.filter((a) => a.state === s).length] as const,
  ).filter(([, n]) => n > 0);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex items-baseline gap-3">
          <h1 className="text-base font-semibold">
            {sessionClaims?.org_name ?? orgId}
          </h1>
          <span className="text-muted-foreground">
            {analyses.length === 1 ? "1 analysis" : `${analyses.length} analyses`}
          </span>
        </div>
        <div className="w-full max-w-xl">
          <AnalyseForm />
        </div>
        {counts.length > 0 && (
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-muted-foreground">
            {counts.map(([state, n]) => (
              <li key={state} className="flex items-center gap-2">
                <StateGlyph state={state} />
                {n} {state}
              </li>
            ))}
          </ul>
        )}
      </div>

      {analyses.length === 0 ? (
        <div className="px-4 py-16 text-center sm:px-5">
          <p className="font-medium">No analyses yet</p>
          <p className="mx-auto mt-1 max-w-[52ch] text-muted-foreground">
            Paste a public GitHub repository above. Its analysis shows up here
            for everyone on the team.
          </p>
        </div>
      ) : (
        <table className="w-full text-left">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="px-4 py-2.5 font-normal sm:pl-5">Repository</th>
              <th scope="col" className="w-36 px-4 py-2.5 font-normal">State</th>
              <th scope="col" className="hidden w-32 px-4 py-2.5 font-normal md:table-cell">Commit</th>
              <th scope="col" className="hidden w-28 px-4 py-2.5 text-right font-normal sm:table-cell">Started</th>
              <th scope="col" className="hidden w-28 px-4 py-2.5 text-right font-normal sm:table-cell sm:pr-5">Finished</th>
            </tr>
          </thead>
          <tbody>
            {analyses.map((a) => (
              <tr key={a.id} className="border-b border-border align-top">
                <td className="px-4 py-2.5 sm:pl-5">
                  <Link
                    href={`/analyses/${a.id}${a.status === "complete" ? "/map" : ""}`}
                    className="font-mono hover:text-accent"
                  >
                    {a.project ? (
                      <>
                        <span className="text-muted-foreground">
                          {a.project.repo_owner}/
                        </span>
                        {a.project.repo_name}
                      </>
                    ) : (
                      <span className="text-faint-foreground">unknown repository</span>
                    )}
                  </Link>
                  {a.error && (
                    <p className="mt-0.5 text-muted-foreground">{a.error}</p>
                  )}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <LiveState
                    id={a.id}
                    readAt={readAt}
                    initial={{
                      status: a.status as StageEvent["status"],
                      stage: a.stage as StageEvent["stage"],
                      message: a.status === "failed" ? a.error : a.stage_message,
                      movedAt: a.movedAt,
                    }}
                  />
                </td>
                <td className="hidden px-4 py-2.5 font-mono text-muted-foreground md:table-cell">
                  {a.commit_sha?.slice(0, 7) ?? <Dash />}
                </td>
                <td className="hidden px-4 py-2.5 text-right whitespace-nowrap text-muted-foreground sm:table-cell">
                  <Ago iso={a.created_at} from={readAt} />
                </td>
                <td className="hidden px-4 py-2.5 text-right whitespace-nowrap text-muted-foreground sm:table-cell sm:pr-5">
                  {a.finished_at ? <Ago iso={a.finished_at} from={readAt} /> : <Dash />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Dash() {
  return <span className="text-faint-foreground">—</span>;
}

function Ago({ iso, from }: { iso: string; from: number }) {
  const s = Math.max(0, Math.round((from - Date.parse(iso)) / 1000));
  const text =
    s < 60
      ? "just now"
      : s < 3600
        ? `${Math.floor(s / 60)}m ago`
        : s < 86400
          ? `${Math.floor(s / 3600)}h ago`
          : `${Math.floor(s / 86400)}d ago`;
  return (
    <time dateTime={iso} title={iso}>
      {text}
    </time>
  );
}
