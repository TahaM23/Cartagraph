// The one way the tools reach Cartograph: a POST to its read-only endpoint,
// carrying the run's credential.
//
// The endpoint runs the same graph functions that draw the canvas, against
// the stored analysis the credential names. Nothing here holds edges or
// walks them: the agent picks a starting point and a direction, the app does
// the walk.
//
// Every failure comes back as text the model can read and repeat, never as
// a guess: a lookup that could not be made says so.

import type { ToolRuntime } from "langchain";
import type { Context } from "../context.ts";

/** Long enough for a large repository's walk, short enough that a stalled app is reported. */
const TIMEOUT_MS = 15_000;

const FAILED = "Lookup failed, so nothing was read:";

function endpoint(): string | null {
  const url = process.env.CARTOGRAPH_API_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

/** Calls one tool route and returns its answer as JSON text, or why there is none. */
export async function lookUp(
  route: string,
  input: Record<string, unknown>,
  runtime: ToolRuntime<unknown, typeof Context>,
): Promise<string> {
  const base = endpoint();
  if (!base) return `${FAILED} the agent has no Cartograph endpoint configured (CARTOGRAPH_API_URL).`;
  const credential = runtime.context?.credential;
  if (!credential) return `${FAILED} this conversation was started without access to an analysis.`;

  let response: Response;
  try {
    response = await fetch(`${base}/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${credential}` },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const why = error instanceof Error && error.name === "TimeoutError" ? "did not answer in time" : "could not be reached";
    return `${FAILED} the Cartograph endpoint ${why}.`;
  }

  const text = await response.text();
  if (response.status === 401 || response.status === 403) {
    return `${FAILED} access to this analysis was refused or has expired. Ask the person to reopen the conversation.`;
  }
  if (!response.ok) {
    let message = `the endpoint answered ${response.status}`;
    try {
      const body = JSON.parse(text) as { error?: unknown };
      if (typeof body.error === "string") message = body.error;
    } catch {}
    return `${FAILED} ${message}.`;
  }
  return text;
}
