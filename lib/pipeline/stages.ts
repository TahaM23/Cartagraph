// What a run says about itself, shared by the pipeline that writes it and the
// pages that show it. No Node or database imports, so the browser can use it.

export const STAGES = ["fetch", "select", "parse", "label", "store"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  fetch: "Fetch",
  select: "Select",
  parse: "Parse",
  label: "Label",
  store: "Store",
};

export type RunStatus = "queued" | "parsing" | "complete" | "failed";

/**
 * What the database publishes when a run moves: the stage and its message.
 * When the run has failed, `message` is the reason.
 */
export interface StageEvent {
  status: RunStatus;
  stage: Stage | null;
  message: string | null;
}

export function isStageEvent(value: unknown): value is StageEvent {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    ["queued", "parsing", "complete", "failed"].includes(v.status as string) &&
    (v.stage === null || STAGES.includes(v.stage as Stage)) &&
    (v.message === null || typeof v.message === "string")
  );
}

/** The topic a run publishes to. The realtime policy matches this shape. */
export const analysisTopic = (id: string) => `analysis:${id}`;

/**
 * Nothing here has a queue or a timeout, so a process that dies mid-run
 * leaves a row that says "parsing" forever. An unfinished run that has not
 * moved for this long is shown as stale.
 */
export const STALE_AFTER_MS = 5 * 60 * 1000;

export const isFinished = (status: string) => status === "complete" || status === "failed";

export function isStale(status: string, lastMovedIso: string, now: number): boolean {
  return !isFinished(status) && now - Date.parse(lastMovedIso) > STALE_AFTER_MS;
}
