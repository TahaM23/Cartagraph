"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { StateGlyph } from "@/components/analysis/state-glyph";
import { useRunProgress, type RunProgress } from "@/components/analysis/use-run-progress";
import { isFinished, isStale, STAGE_LABELS, STAGES, type Stage } from "@/lib/pipeline/stages";

const DESCRIPTIONS: Record<Stage, string> = {
  fetch: "Download the repository at its latest commit",
  select: "Choose the source files to parse",
  parse: "Read every file's imports and resolve them",
  store: "Save the files, edges and coverage",
};

type Step = "done" | "active" | "stale" | "failed" | "pending";

function stepOf(stage: Stage, progress: RunProgress, stale: boolean): Step {
  if (progress.status === "complete") return "done";
  if (progress.status === "queued" || progress.stage === null) return "pending";
  const at = STAGES.indexOf(progress.stage);
  const index = STAGES.indexOf(stage);
  if (index < at) return "done";
  if (index > at) return "pending";
  if (progress.status === "failed") return "failed";
  return stale ? "stale" : "active";
}

const GLYPH: Record<Step, string> = {
  done: "complete",
  active: "parsing",
  stale: "stale",
  failed: "failed",
  pending: "queued",
};

function minutesSince(iso: string, now: number) {
  const m = Math.max(1, Math.round((now - Date.parse(iso)) / 60000));
  return m === 1 ? "a minute" : `${m} minutes`;
}

/**
 * The run's four stages, named as they happen. The stage being worked on
 * shows the message the pipeline wrote for it; a failed stage shows why.
 */
export function RunProgressView({
  id,
  initial,
  renderedAt,
  rerun,
}: {
  id: string;
  initial: RunProgress;
  /** When the server read the row; the first render measures staleness from it. */
  renderedAt: number;
  rerun: () => Promise<void>;
}) {
  const router = useRouter();
  const { progress, connection } = useRunProgress(id, initial);
  const finished = isFinished(progress.status);

  // Staleness is a matter of time passing, so the clock is the one thing
  // here that changes without an event. It only runs while the run is open.
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    if (finished) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [finished]);
  const stale = isStale(progress.status, progress.movedAt, now);

  // A run that finishes while the page is open: render the finished page.
  useEffect(() => {
    if (finished && !isFinished(initial.status)) router.refresh();
  }, [finished, initial.status, router]);

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex flex-col">
        {STAGES.map((stage) => {
          const step = stepOf(stage, progress, stale);
          const current = step === "active" || step === "stale" || step === "failed";
          return (
            <li
              key={stage}
              aria-current={current ? "step" : undefined}
              className="flex items-baseline gap-3 border-b border-border py-2.5 last:border-b-0"
            >
              <span className={`relative top-0.5 ${step === "pending" ? "text-faint-foreground" : ""}`}>
                <StateGlyph state={GLYPH[step]} />
              </span>
              <span
                className={`w-14 shrink-0 font-medium ${step === "pending" ? "text-faint-foreground" : ""}`}
              >
                {STAGE_LABELS[stage]}
              </span>
              <span
                className={
                  current
                    ? "text-foreground"
                    : step === "pending"
                      ? "text-faint-foreground"
                      : "text-muted-foreground"
                }
              >
                {current && progress.message ? progress.message : DESCRIPTIONS[stage]}
              </span>
            </li>
          );
        })}
      </ol>

      {progress.status === "queued" && !stale && (
        <p className="text-muted-foreground">Waiting to start.</p>
      )}
      {stale && (
        <p className="text-muted-foreground">
          No progress for {minutesSince(progress.movedAt, now)}. The run has most likely stopped
          without finishing; it can be started again.
        </p>
      )}
      {!finished && connection === "unavailable" && (
        <p className="text-muted-foreground">
          Live updates could not connect. Reload the page to see where the run is.
        </p>
      )}

      {(finished || stale) && (
        <form action={rerun}>
          <RerunButton />
        </form>
      )}
    </div>
  );
}

function RerunButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-8 rounded-md border border-border px-3 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
    >
      {pending ? "Starting…" : "Run again"}
    </button>
  );
}
