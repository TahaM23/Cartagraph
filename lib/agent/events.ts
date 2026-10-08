// What the Ask pane receives while the agent works, one JSON object per line.
// Shared by the server that relays the agent's stream and the pane that shows
// it. No Node or database imports, so the browser can use it.

export type AskEvent =
  /** The conversation this answer belongs to; sent back with a follow-up. */
  | { type: "thread"; id: string }
  /** The agent asked for a lookup. */
  | { type: "call"; id: string; tool: string; args: Record<string, unknown> }
  /** What the lookup found, in a few words. */
  | { type: "result"; id: string; ok: boolean; note: string }
  | { type: "answer"; text: string }
  | { type: "error"; message: string };

/** The lookups as the pane names them. */
export const LOOKUP_LABELS: Record<string, string> = {
  analysis_summary: "Read the repository summary",
  search_files: "Searched paths",
  files_by_role: "Listed files by role",
  neighbours: "Read neighbours",
  walk: "Walked imports",
  routes: "Read the route table",
};

export function parseAskEvent(line: string): AskEvent | null {
  try {
    const value = JSON.parse(line) as { type?: unknown };
    return typeof value?.type === "string" ? (value as AskEvent) : null;
  } catch {
    return null;
  }
}
