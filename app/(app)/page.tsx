import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";

// The active organization's analyses. The query has no organization filter on
// purpose: the session token carries the organization, and row-level security
// decides which rows come back. Switching organization changes the token, not
// this code. If another organization's row ever shows up here, the bug is the
// policy.
export default async function DashboardPage() {
  const { orgId, sessionClaims } = await auth();

  if (!orgId) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6">
        <p className="text-sm text-muted-foreground">
          No active organization. Pick one from the switcher above.
        </p>
      </div>
    );
  }

  const supabase = await createServerSupabase();
  const { data: analyses, error } = await supabase
    .from("analyses")
    .select(
      "id, status, commit_sha, files_total, files_parsed, edge_count, error, created_at, started_at, finished_at, project:projects(repo_owner, repo_name)",
    )
    .order("created_at", { ascending: false });

  // An error must not render as an empty list: "no rows" and "couldn't ask"
  // are different answers.
  if (error) throw new Error(`Loading analyses failed: ${error.message}`);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Analyses</h1>
          <p className="text-xs text-muted-foreground">
            {sessionClaims?.org_name ?? orgId}
          </p>
        </div>
        <Link
          href="/organization/organization-members"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Members &amp; invitations
        </Link>
      </div>

      {analyses.length === 0 ? (
        <div className="mt-6 rounded-md border border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm font-medium">No analyses yet</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            When someone in this organization maps a repository, it appears
            here for everyone in the organization.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-muted text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Repository</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Commit</th>
                <th className="px-3 py-2 text-right font-medium">Files</th>
                <th className="px-3 py-2 text-right font-medium">Edges</th>
                <th className="px-3 py-2 text-right font-medium">Started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {analyses.map((a) => (
                <tr key={a.id} className="align-top">
                  <td className="px-3 py-2">
                    <span className="font-mono">
                      {a.project
                        ? `${a.project.repo_owner}/${a.project.repo_name}`
                        : "—"}
                    </span>
                    {a.error && (
                      <p className="mt-0.5 text-muted-foreground">{a.error}</p>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Status
                      status={a.status}
                      parsed={a.files_parsed}
                      total={a.files_total}
                      startedAt={a.started_at}
                      finishedAt={a.finished_at}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">
                    {a.commit_sha?.slice(0, 7) ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {a.files_total == null
                      ? "—"
                      : a.status === "complete"
                        ? `${fmt(a.files_parsed)}/${fmt(a.files_total)}`
                        : fmt(a.files_total)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {a.edge_count == null ? "—" : fmt(a.edge_count)}
                  </td>
                  <td
                    className="px-3 py-2 text-right whitespace-nowrap text-muted-foreground"
                    title={a.created_at}
                  >
                    <time dateTime={a.created_at}>{stamp(a.created_at)}</time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Status({
  status,
  parsed,
  total,
  startedAt,
  finishedAt,
}: {
  status: string;
  parsed: number | null;
  total: number | null;
  startedAt: string | null;
  finishedAt: string | null;
}) {
  if (status === "parsing" && total) {
    return (
      <span>
        Parsing{" "}
        <span className="font-mono tabular-nums text-muted-foreground">
          {fmt(parsed ?? 0)}/{fmt(total)}
        </span>
      </span>
    );
  }
  if (status === "complete" && startedAt && finishedAt) {
    return (
      <span>
        Complete{" "}
        <span className="font-mono tabular-nums text-muted-foreground">
          {duration(startedAt, finishedAt)}
        </span>
      </span>
    );
  }
  const label: Record<string, string> = {
    queued: "Queued",
    parsing: "Parsing",
    complete: "Complete",
    failed: "Failed",
  };
  return <span>{label[status] ?? status}</span>;
}

const number = new Intl.NumberFormat("en");
function fmt(n: number | null) {
  return n == null ? "—" : number.format(n);
}

function duration(from: string, to: string) {
  const s = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// Rendered on the server, so pinned to UTC rather than the server's zone.
const timestamp = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});
function stamp(iso: string) {
  return `${timestamp.format(new Date(iso))} UTC`;
}
