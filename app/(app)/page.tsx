import { auth } from "@clerk/nextjs/server";
import { Instrument_Serif } from "next/font/google";
import Link from "next/link";
import { AnalyseForm } from "@/components/analysis/analyse-form";
import { LiveState } from "@/components/analysis/live-state";
import { KIND_LABELS, KINDS, kindOf, railFor, type Kind } from "@/lib/canvas/categories";
import { SWATCH } from "@/components/canvas/swatch";
import { isStale, type StageEvent } from "@/lib/pipeline/stages";
import { createServerSupabase } from "@/lib/supabase/server";

/** The front page's display face: headlines only. Everything else stays in the app's sans and mono. */
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

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
      "id, status, stage, stage_message, stage_at, commit_sha, error, created_at, finished_at, adapter, files_total, edge_count, project:projects(repo_owner, repo_name)",
    )
    .order("created_at", { ascending: false });

  // An error must not render as an empty list: "no rows" and "couldn't ask"
  // are different answers.
  if (error) throw new Error(`Loading analyses failed: ${error.message}`);

  // Relative times are measured from the moment the rows were read.
  return { analyses: data, readAt: Date.now() };
}

type Db = Awaited<ReturnType<typeof createServerSupabase>>;
type Makeup = Record<Kind, number>;

/** The API returns at most this many rows per request, so the read pages. */
const PAGE = 1000;

/**
 * What each finished analysis is made of, by kind of file: the same kinds,
 * by the same rules, that colour its map. Read through the user's client, so
 * row-level security applies here too.
 */
async function loadMakeup(supabase: Db, ids: string[]): Promise<Map<string, Makeup>> {
  const makeup = new Map<string, Makeup>();
  if (ids.length === 0) return makeup;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("files")
      .select("analysis_id, path, folder")
      .in("analysis_id", ids)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Reading file kinds failed: ${error.message}`);
    for (const f of data) {
      const counts = makeup.get(f.analysis_id) ?? { source: 0, test: 0, types: 0, config: 0, script: 0 };
      counts[kindOf({ path: f.path, folder: f.folder ?? "" })]++;
      makeup.set(f.analysis_id, counts);
    }
    if (data.length < PAGE) return makeup;
  }
}

/** A few real paths, most depended-on first, for the line drawn across the hero. */
async function loadRibbon(supabase: Db, analysisId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("files")
    .select("path")
    .eq("analysis_id", analysisId)
    .order("fan_in", { ascending: false })
    .limit(12);
  if (error) return [];
  return data.map((f) => f.path);
}

const STATES = ["parsing", "queued", "stale", "complete", "failed"] as const;
type State = (typeof STATES)[number];
const isState = (s: unknown): s is State => STATES.includes(s as State);

const STATE_LABELS: Record<State, string> = {
  parsing: "Running",
  queued: "Queued",
  stale: "Stale",
  complete: "Complete",
  failed: "Failed",
};

const count = new Intl.NumberFormat("en-US");

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const { orgId, sessionClaims } = await auth();

  if (!orgId) {
    return (
      <p className="px-4 py-6 text-muted-foreground sm:px-5">
        No active organization. Pick one from the switcher above.
      </p>
    );
  }

  const shown = (await searchParams).state;
  const filter = isState(shown) ? shown : null;

  const { analyses: rows, readAt } = await loadAnalyses();
  const makeup = await loadMakeup(
    await createServerSupabase(),
    rows.filter((a) => a.status === "complete").map((a) => a.id),
  );
  const latest = rows.find((a) => a.status === "complete");
  const ribbon = latest ? await loadRibbon(await createServerSupabase(), latest.id) : [];
  // An unfinished run that stopped moving is counted as stale, not as working.
  const analyses = rows.map((a) => {
    const movedAt = a.stage_at ?? a.created_at;
    return { ...a, movedAt, state: isStale(a.status, movedAt, readAt) ? "stale" : a.status };
  });
  const counts = STATES.map((s) => [s, analyses.filter((a) => a.state === s).length] as const).filter(([, n]) => n > 0);
  const visible = filter ? analyses.filter((a) => a.state === filter) : analyses;
  const organization = (sessionClaims?.org_name as string | undefined) ?? orgId;

  return (
    <div className="flex flex-1 flex-col bg-paper">
      <section className="relative overflow-hidden">
        {/* Graph paper: the map's own ground, faded out towards the edges. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_72%)]"
          style={{
            backgroundImage: "radial-gradient(circle, var(--faint-foreground) 1px, transparent 1.2px)",
            backgroundSize: "22px 22px",
          }}
        />
        {ribbon.length > 0 && <Ribbon paths={ribbon} />}
        <div className="relative mx-auto flex w-full max-w-3xl flex-col items-center gap-5 px-4 pt-20 pb-28 text-center sm:px-6 sm:pt-24 sm:pb-36">
          <h1
            className={`${serif.className} text-[clamp(3.25rem,9vw,6.5rem)] leading-[0.9] tracking-[-0.02em] text-balance`}
          >
            Map any codebase
          </h1>
          <p className="max-w-[46ch] text-[16px] leading-relaxed text-muted-foreground">
            Paste a public GitHub repository. Cartograph parses every import and shows what depends on what, for
            everyone in {organization}.
          </p>
          <div className="w-full max-w-2xl pt-3 text-left">
            <AnalyseForm />
          </div>
        </div>
      </section>

      <section className="relative">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pt-6 pb-16 sm:px-6">
        {analyses.length === 0 ? (
          <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border px-6 py-16 text-center">
            <p className="font-medium">No repositories mapped yet</p>
            <p className="max-w-[46ch] text-muted-foreground">
              Paste one above, or pick an example. Its map shows up here for everyone on the team.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
              <div className="flex flex-col gap-1">
                <h2 className={`${serif.className} text-[clamp(2rem,4vw,2.75rem)] leading-none tracking-[-0.01em]`}>
                  Your maps
                </h2>
                <p className="text-muted-foreground">
                  {analyses.length === 1 ? "1 repository" : `${analyses.length} repositories`}, shared with everyone in{" "}
                  {organization}.
                </p>
              </div>
              <nav aria-label="Filter by state" className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]">
                {[["all", "/", filter === null, "All", analyses.length] as const, ...counts.map(([state, n]) => [state, `/?state=${state}`, filter === state, STATE_LABELS[state], n] as const)].map(
                  ([key, href, active, label, n], i) => (
                    <span key={key} className="flex items-center gap-2.5">
                      {i > 0 && <span aria-hidden="true" className="size-1 bg-faint-foreground" />}
                      <FilterTab href={href} active={active} label={label} n={n} />
                    </span>
                  ),
                )}
              </nav>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_32px_-12px_rgb(0_0_0/0.10)]">
              <table className="w-full text-left">
                <thead className="text-[12px] text-muted-foreground">
                  <tr className="border-b border-border">
                    <th scope="col" className="py-2.5 pr-4 pl-4 font-medium">Repository</th>
                    <th scope="col" className="hidden px-4 py-2.5 font-medium lg:table-cell">Framework</th>
                    <th scope="col" className="hidden w-36 px-4 py-2.5 font-medium md:table-cell">Made of</th>
                    <th scope="col" className="hidden px-4 py-2.5 text-right font-medium md:table-cell">Files</th>
                    <th scope="col" className="hidden px-4 py-2.5 text-right font-medium md:table-cell">Imports</th>
                    <th scope="col" className="w-32 px-4 py-2.5 font-medium">State</th>
                    <th scope="col" className="hidden px-4 py-2.5 font-medium xl:table-cell">Commit</th>
                    <th scope="col" className="hidden py-2.5 pr-4 pl-4 text-right font-medium sm:table-cell">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((a) => {
                    const framework = a.adapter ? railFor(a.adapter).framework : null;
                    const done = a.status === "complete";
                    return (
                      <tr
                        key={a.id}
                        className="group relative border-b border-border align-top last:border-b-0 hover:bg-muted/60 focus-within:bg-muted/60"
                      >
                        <td className="py-3 pr-4 pl-4">
                          <div className="flex items-center gap-2.5">
                            {a.project && <Avatar owner={a.project.repo_owner} />}
                            <Link
                              href={`/analyses/${a.id}${done ? "/map" : ""}`}
                              className="min-w-0 truncate font-mono text-[13px] outline-none group-hover:text-accent after:absolute after:inset-0 focus-visible:underline"
                            >
                              {a.project ? (
                                <>
                                  <span className="text-muted-foreground group-hover:text-accent/70">{a.project.repo_owner}/</span>
                                  <span className="font-medium">{a.project.repo_name}</span>
                                </>
                              ) : (
                                <span className="text-faint-foreground">unknown repository</span>
                              )}
                            </Link>
                          </div>
                          {a.error && <p className="mt-1 pl-[30px] text-[12px] text-muted-foreground">{a.error}</p>}
                        </td>
                        <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">
                          {done ? (framework ?? <span className="text-faint-foreground">None</span>) : <Dash />}
                        </td>
                        <td className="hidden px-4 py-3.5 md:table-cell">
                          {makeup.has(a.id) ? <MakeupBar makeup={makeup.get(a.id)!} /> : <Dash />}
                        </td>
                        <td className="hidden px-4 py-3 text-right tabular-nums md:table-cell">
                          {done && a.files_total !== null ? count.format(a.files_total) : <Dash />}
                        </td>
                        <td className="hidden px-4 py-3 text-right tabular-nums md:table-cell">
                          {done && a.edge_count !== null ? count.format(a.edge_count) : <Dash />}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
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
                        <td className="hidden px-4 py-3 font-mono text-[12px] text-muted-foreground xl:table-cell">
                          {a.commit_sha?.slice(0, 7) ?? <Dash />}
                        </td>
                        <td className="hidden py-3 pr-4 pl-4 text-right whitespace-nowrap text-muted-foreground sm:table-cell">
                          <Ago iso={a.finished_at ?? a.created_at} from={readAt} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul aria-label="File kinds" className="flex flex-wrap justify-end gap-x-4 gap-y-1 pt-2.5 text-[12px] text-muted-foreground">
              {KINDS.map((k) => (
                <li key={k} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className={`size-2 rounded-[2px] ${SWATCH[k]}`} />
                  {KIND_LABELS[k]}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      </section>
    </div>
  );
}

/**
 * Real file paths, the latest map's most depended-on, running along one curve
 * behind the input: the thing Cartograph reads, drawn as a line through the page.
 * Still: nothing on this page moves unless someone moves it.
 */
function Ribbon({ paths }: { paths: string[] }) {
  const text = paths.join("     ");
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[340px] w-full"
      viewBox="0 0 1440 340"
      preserveAspectRatio="xMidYMax slice"
    >
      <path id="ribbon" d="M -40 300 C 260 330, 420 160, 720 190 S 1180 70, 1480 40" fill="none" />
      <use href="#ribbon" stroke="var(--border)" strokeWidth="1" />
      <text className="fill-muted-foreground font-mono" style={{ fontSize: 13, whiteSpace: "pre" }} dy="-8">
        <textPath href="#ribbon" startOffset="2%">
          {`${text}     ${text}`}
        </textPath>
      </text>
    </svg>
  );
}

/** A finished analysis by kind of file, in the map's colours: how much of it is source, tests, config and the rest. */
function MakeupBar({ makeup }: { makeup: Makeup }) {
  const total = KINDS.reduce((n, k) => n + makeup[k], 0);
  const parts = KINDS.filter((k) => makeup[k] > 0);
  const summary = parts.map((k) => `${count.format(makeup[k])} ${KIND_LABELS[k].toLowerCase()}`).join(", ");
  return (
    <div role="img" aria-label={summary} title={summary} className="flex h-2 w-28 gap-px overflow-hidden rounded-full bg-muted">
      {parts.map((k) => (
        <span key={k} className={SWATCH[k]} style={{ width: `${(100 * makeup[k]) / total}%`, minWidth: 3 }} />
      ))}
    </div>
  );
}

function FilterTab({ href, active, label, n }: { href: string; active: boolean; label: string; n: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-sm py-0.5 focus-visible:outline-2 focus-visible:outline-accent ${
        active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {active ? "[" : ""}
      {label} <span className="tabular-nums text-faint-foreground">{n}</span>
      {active ? "]" : ""}
    </Link>
  );
}

/** The owner's GitHub picture: owners are what people recognise a repository by at a glance. */
function Avatar({ owner }: { owner: string }) {
  return (
    // A 20px picture from GitHub's own avatar URL; next/image would need GitHub as a configured host for no gain.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://github.com/${encodeURIComponent(owner)}.png?size=40`}
      alt=""
      width={20}
      height={20}
      loading="lazy"
      className="size-5 shrink-0 rounded-[5px] bg-muted ring-1 ring-border"
    />
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
