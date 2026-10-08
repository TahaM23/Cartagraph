"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { StateGlyph } from "@/components/analysis/state-glyph";
import { useRunProgress, type RunProgress } from "@/components/analysis/use-run-progress";
import { isFinished, isStale } from "@/lib/pipeline/stages";

/**
 * A dashboard row's state. An unfinished run is subscribed to, so the stage
 * moves here too; when it finishes, the dashboard re-renders with its result.
 * A run that has not moved for a while reads "stale" rather than "parsing".
 */
export function LiveState({ id, initial, readAt }: { id: string; initial: RunProgress; readAt: number }) {
  const router = useRouter();
  const { progress } = useRunProgress(id, initial);
  const finished = isFinished(progress.status);

  useEffect(() => {
    if (finished && !isFinished(initial.status)) router.refresh();
  }, [finished, initial.status, router]);

  // Measured from when the rows were read, like the rest of the table; an
  // event since then means it moved.
  const stale = progress.movedAt === initial.movedAt && isStale(progress.status, progress.movedAt, readAt);
  const label = stale
    ? "stale"
    : progress.status === "parsing" && progress.stage
      ? progress.stage
      : progress.status;

  return (
    <span className="flex items-center gap-2" title={progress.message ?? undefined}>
      <StateGlyph state={stale ? "stale" : progress.status} />
      {label}
    </span>
  );
}
