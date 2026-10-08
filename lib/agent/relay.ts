// Turning the agent's run stream into what the Ask pane shows.
//
// The runtime reports each step of the run as an update from the node that
// took it: the model asking for lookups or answering, the tools node
// returning what a lookup found. Only those become events; the harness's
// own bookkeeping nodes, and anything a message carries beyond its text,
// tool calls and results, stay on the server.

import type { AskEvent } from "./events.ts";

interface StreamMessage {
  type?: string;
  content?: unknown;
  tool_calls?: { id?: string; name: string; args?: Record<string, unknown> }[];
  tool_call_id?: string;
  status?: string;
}

/** A message's text, whether it came as a string or as content blocks. */
export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && (b as { type?: unknown }).type === "text" ? String((b as { text?: unknown }).text ?? "") : ""))
      .join("");
  }
  return "";
}

/** A lookup's answer in a few words: how much it found, or why it found nothing. */
export function noteOn(content: string): { ok: boolean; note: string } {
  if (content.startsWith("Lookup failed")) return { ok: false, note: content.replace(/^Lookup failed, so nothing was read:\s*/, "") };
  try {
    const answer = JSON.parse(content) as Record<string, unknown>;
    if (typeof answer.total === "number") return { ok: true, note: `${answer.total} found` };
    if (Array.isArray(answer.imports) && Array.isArray(answer.importedBy)) {
      return { ok: true, note: `imports ${answer.imports.length}, imported by ${answer.importedBy.length}` };
    }
    if (typeof answer.files === "number") return { ok: true, note: `${answer.files} files` };
  } catch {}
  return { ok: true, note: "done" };
}

/** The events one stream update stands for, in order. */
export function eventsFrom(update: unknown): AskEvent[] {
  if (!update || typeof update !== "object") return [];
  const events: AskEvent[] = [];
  for (const [node, value] of Object.entries(update as Record<string, unknown>)) {
    const messages = (value as { messages?: StreamMessage[] } | null)?.messages;
    if (!Array.isArray(messages)) continue;
    for (const m of messages) {
      if (node === "model_request" && m.type === "ai") {
        if (m.tool_calls?.length) {
          for (const c of m.tool_calls) events.push({ type: "call", id: c.id ?? c.name, tool: c.name, args: c.args ?? {} });
        } else {
          const text = textOf(m.content).trim();
          if (text) events.push({ type: "answer", text });
        }
      } else if (node === "tools" && m.type === "tool") {
        const content = textOf(m.content);
        const { ok, note } = m.status === "error" ? { ok: false, note: content } : noteOn(content);
        events.push({ type: "result", id: m.tool_call_id ?? "", ok, note });
      }
    }
  }
  return events;
}
