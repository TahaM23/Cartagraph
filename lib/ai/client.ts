// The one place in the codebase that constructs the AI client. It is wrapped
// for tracing as it is made, so there is no unwrapped client to call by
// mistake; the lint config refuses an `openai` import anywhere else.
//
// Work that may call the model runs inside `traced()`, which records it as a
// run whether or not a model call happens inside it. That is what lets a
// cache hit be seen: a recorded run with no model call in it.
//
// Without LangSmith configured, everything still runs and nothing is
// recorded. That state is reported (tracingStatus), because an absent key
// otherwise looks exactly like a working setup with no traffic.
//
// Relative imports and no Next APIs, so the pipeline can use it from a plain
// script.

import { Client } from "langsmith";
import { getCurrentRunTree, traceable } from "langsmith/traceable";
import { wrapOpenAI } from "langsmith/wrappers/openai";
import OpenAI from "openai";

/**
 * Exact snapshots, never a moving alias: a model that changes under the same
 * name would make the cache serve another model's answers. Each name is part
 * of its cache keys, so re-pinning one invalidates only its own cache.
 */
export const MODELS = {
  explain: "gpt-5.4-mini-2026-03-17",
  label: "gpt-5.4-nano-2026-03-17",
} as const;

/** The model cannot be called: no key. A failure fit to show the person who asked. */
export class AiUnavailable extends Error {}

export interface TracingStatus {
  enabled: boolean;
  /** The LangSmith project runs land in, when enabled. */
  project: string | null;
  /** Why tracing is off, when it is. */
  reason: string | null;
}

export function tracingStatus(): TracingStatus {
  const on = ["LANGSMITH_TRACING", "LANGSMITH_TRACING_V2"].some((name) => process.env[name]?.trim() === "true");
  const key = Boolean(process.env.LANGSMITH_API_KEY?.trim());
  if (on && key) {
    return { enabled: true, project: process.env.LANGSMITH_PROJECT?.trim() || "default", reason: null };
  }
  return {
    enabled: false,
    project: null,
    reason: !key ? "LANGSMITH_API_KEY is not set" : "LANGSMITH_TRACING is not \"true\"",
  };
}

let warned = false;
function warnIfUntraced() {
  const status = tracingStatus();
  if (!status.enabled && !warned) {
    warned = true;
    console.warn(`AI calls are not being traced: ${status.reason}. They still run; nothing records them.`);
  }
}

let langsmith: Client | undefined;
function tracer(): Client | undefined {
  if (!tracingStatus().enabled) return undefined;
  langsmith ??= new Client();
  return langsmith;
}

let client: OpenAI | undefined;

/** The traced client. Throws AiUnavailable when there is no key. */
export function ai(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new AiUnavailable("OPENAI_API_KEY is not set, so nothing can be explained.");
    warnIfUntraced();
    client = wrapOpenAI(new OpenAI({ apiKey, timeout: 90_000, maxRetries: 2 }), { client: tracer() });
  }
  return client;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- traceable's own constraint
type AnyFunction = (...args: any[]) => any;
type TraceConfig<F extends AnyFunction> = NonNullable<Parameters<typeof traceable<F>>[1]>;

/**
 * Records every call of `fn` as a run named `name`. Model calls made inside
 * it appear as its children; a call that never reaches the model is a run
 * with none.
 */
export function traced<F extends AnyFunction>(
  name: string,
  fn: F,
  config: Omit<TraceConfig<F>, "name" | "client"> = {},
) {
  return traceable(fn, { ...config, name, client: tracer() });
}

interface Score {
  runId: string;
  traceId: string;
  project: string;
  key: string;
  score: number;
  comment: string;
}

const scores: Score[] = [];

/**
 * Scores the traced run in progress, as feedback on it: what an evaluator
 * running against live traffic records. Held until flushTraces, which sends
 * the run before its score. Without tracing there is nowhere to record it.
 */
export function scoreRun(key: string, score: number, comment: string): void {
  const run = getCurrentRunTree(true);
  if (!run || !tracer() || !run.project_name) return;
  scores.push({ runId: run.id, traceId: run.trace_id, project: run.project_name, key, score, comment });
}

const projectIds = new Map<string, Promise<string>>();
const projectId = (client: Client, name: string) => {
  if (!projectIds.has(name)) projectIds.set(name, client.readProject({ projectName: name }).then((p) => p.id));
  return projectIds.get(name)!;
};

/** Sends any runs still queued, then their scores. Call before the process or request ends. */
export async function flushTraces(): Promise<void> {
  await langsmith?.awaitPendingTraceBatches();
  const client = langsmith;
  if (!client) return;
  const sending = scores.splice(0);
  await Promise.all(
    sending.map(async (s) =>
      client.createFeedback({
        runId: s.runId,
        traceId: s.traceId === s.runId ? undefined : s.traceId,
        sessionId: await projectId(client, s.project),
        key: s.key,
        score: s.score,
        comment: s.comment,
        // Computed by the application, not by a model grading a model.
        feedbackSourceType: "app",
      }),
    ),
  );
}
