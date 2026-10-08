"use client";

import { useCallback, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { LOOKUP_LABELS, parseAskEvent, type AskEvent } from "@/lib/agent/events";
import { useAnalysis } from "./analysis";
import { ExplanationBody } from "./explanation";

/** One lookup the agent made, as it happened. */
interface Step {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  result: { ok: boolean; note: string } | null;
}

interface Turn {
  question: string;
  /** What was selected when it was asked, by path. */
  about: string | null;
  steps: Step[];
  answer: string | null;
  error: string | null;
  done: boolean;
}

export interface Conversation {
  turns: readonly Turn[];
  busy: boolean;
  ask(question: string, selected: { kind: "file"; path: string } | { kind: "folder"; dir: string } | null): void;
  reset(): void;
}

/**
 * A conversation with the agent about this analysis. Held above the pane, so
 * toggling out of Ask and back finds it as it was.
 */
export function useConversation(analysisId: string): Conversation {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const thread = useRef<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const update = (change: (turn: Turn) => Turn) =>
    setTurns((all) => [...all.slice(0, -1), change(all[all.length - 1])]);

  const apply = useCallback((event: AskEvent) => {
    switch (event.type) {
      case "thread":
        thread.current = event.id;
        break;
      case "call":
        update((t) => ({ ...t, steps: [...t.steps, { id: event.id, tool: event.tool, args: event.args, result: null }] }));
        break;
      case "result":
        update((t) => ({
          ...t,
          steps: t.steps.map((s) => (s.id === event.id ? { ...s, result: { ok: event.ok, note: event.note } } : s)),
        }));
        break;
      case "answer":
        update((t) => ({ ...t, answer: t.answer ? `${t.answer}\n\n${event.text}` : event.text }));
        break;
      case "error":
        update((t) => ({ ...t, error: event.message }));
        break;
    }
  }, []);

  const ask = useCallback<Conversation["ask"]>(
    (question, selected) => {
      const controller = new AbortController();
      inFlight.current = controller;
      const about = selected ? (selected.kind === "file" ? selected.path : selected.dir || "(root)") : null;
      setTurns((all) => [...all, { question, about, steps: [], answer: null, error: null, done: false }]);
      setBusy(true);

      (async () => {
        try {
          const response = await fetch("/api/ask", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ analysisId, question, threadId: thread.current ?? undefined, selected }),
            signal: controller.signal,
          });
          if (!response.ok || !response.body) {
            const body = (await response.json().catch(() => null)) as { error?: string } | null;
            apply({ type: "error", message: body?.error ?? "Ask is unavailable right now. The map and explanations still work." });
            return;
          }
          const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffered = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffered += value;
            const lines = buffered.split("\n");
            buffered = lines.pop() ?? "";
            for (const line of lines) {
              const event = parseAskEvent(line);
              if (event) apply(event);
            }
          }
        } catch {
          if (!controller.signal.aborted) {
            apply({ type: "error", message: "The answer stopped arriving. Ask again." });
          }
        } finally {
          if (inFlight.current === controller) {
            inFlight.current = null;
            setBusy(false);
            update((t) => ({ ...t, done: true }));
          }
        }
      })();
    },
    [analysisId, apply],
  );

  const reset = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    thread.current = null;
    setTurns([]);
    setBusy(false);
  }, []);

  return { turns, busy, ask, reset };
}

const EXAMPLES = ["Where is authentication handled?", "Which files does the most code depend on?", "Which routes are there?"];

/** The pane in Ask mode: the conversation, the lookups behind each answer, and the box to ask in. */
export function AskPane({ conversation }: { conversation: Conversation }) {
  const { selected } = useAnalysis();
  const { turns, busy, ask, reset } = conversation;
  const [draft, setDraft] = useState("");

  const target =
    selected?.startsWith("f:") ? ({ kind: "file", path: selected.slice(2) } as const)
    : selected?.startsWith("g:") ? ({ kind: "folder", dir: selected.slice(2) } as const)
    : null;
  const targetName = target ? (target.kind === "file" ? target.path : target.dir || "(root)") : null;

  const send = (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    ask(q, target);
    setDraft("");
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(draft);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1">
        {turns.length === 0 ? (
          <div className="flex flex-col gap-3 px-4 py-4">
            <p className="text-muted-foreground">
              Ask about this repository&apos;s structure. Every answer is looked up in the parsed graph, and each lookup
              is shown as it happens.
            </p>
            <ul className="flex flex-col items-start gap-1.5">
              {(targetName ? [`What breaks if I change ${targetName}?`, ...EXAMPLES] : EXAMPLES).map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    onClick={() => send(q)}
                    disabled={busy}
                    className="rounded-md border border-border px-2 py-0.5 text-left text-muted-foreground hover:border-accent hover:text-foreground"
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className="flex flex-col">
            {turns.map((turn, i) => (
              <TurnView key={i} turn={turn} />
            ))}
          </ol>
        )}
      </div>

      <form onSubmit={onSubmit} className="sticky bottom-0 flex flex-col gap-1.5 border-t border-border bg-background px-4 py-2.5">
        <p className="truncate text-[12px] text-faint-foreground" title={targetName ?? undefined}>
          {targetName ? (
            <>
              About <span className="font-mono">{targetName}</span>
            </>
          ) : (
            "About the whole repository"
          )}
        </p>
        <label htmlFor="ask-question" className="sr-only">
          Question
        </label>
        <textarea
          id="ask-question"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          maxLength={2000}
          placeholder={turns.length > 0 ? "Follow up…" : "Ask a question…"}
          className="resize-none rounded-md border border-border bg-surface px-2 py-1.5 focus:border-accent focus:outline-none"
        />
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={reset}
            disabled={turns.length === 0}
            className="text-[12px] text-muted-foreground hover:text-foreground disabled:invisible"
          >
            New conversation
          </button>
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="rounded-md border border-accent bg-accent/15 px-2.5 py-1 hover:bg-accent/25 disabled:border-border disabled:bg-transparent disabled:text-faint-foreground"
          >
            {busy ? "Looking up…" : "Ask"}
          </button>
        </div>
      </form>
    </div>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  const waiting = !turn.done && turn.steps.length === 0 && !turn.answer && !turn.error;
  return (
    <li className="flex flex-col border-b border-border">
      <div className="px-4 pt-3 pb-2">
        <p className="font-medium">{turn.question}</p>
        {turn.about && (
          <p className="truncate font-mono text-[11px] text-faint-foreground" title={turn.about}>
            {turn.about}
          </p>
        )}
      </div>

      {(turn.steps.length > 0 || waiting) && (
        <ol aria-label="Lookups" className="flex flex-col gap-0.5 px-4 pb-2 text-[12px]">
          {turn.steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
          {waiting && <li className="text-muted-foreground">Choosing what to look up…</li>}
        </ol>
      )}

      {turn.answer && (
        <div className="border-t border-border">
          <ExplanationBody text={turn.answer} />
        </div>
      )}
      {turn.error && <p className="border-t border-border px-4 py-2.5 text-muted-foreground">{turn.error}</p>}
      {!turn.done && turn.steps.length > 0 && !turn.answer && !turn.error && turn.steps.every((s) => s.result) && (
        <p className="px-4 pb-2 text-[12px] text-muted-foreground">Writing the answer…</p>
      )}
    </li>
  );
}

/** What a lookup was asked, in a few words: the query, role, path or filter it was given. */
function argsOf(step: Step): string {
  const a = step.args;
  if (typeof a.query === "string") return `"${a.query}"`;
  if (typeof a.role === "string") return a.role;
  if (typeof a.path === "string") {
    return typeof a.direction === "string" ? `${a.path} · ${a.direction}` : a.path;
  }
  if (typeof a.contains === "string") return `"${a.contains}"`;
  return "";
}

function StepRow({ step }: { step: Step }) {
  const label = LOOKUP_LABELS[step.tool] ?? step.tool;
  const detail = argsOf(step);
  return (
    <li className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-x-1.5">
      <span
        aria-hidden="true"
        // Greyscale: green and amber mean direction on this page, not success.
        className={step.result === null ? "text-faint-foreground" : step.result.ok ? "text-muted-foreground" : "text-foreground"}
      >
        {step.result === null ? "○" : step.result.ok ? "●" : "×"}
      </span>
      <span className="min-w-0">
        <span>{label}</span>
        {detail && (
          <span className="ml-1.5 font-mono break-all text-muted-foreground" title={detail}>
            {detail}
          </span>
        )}
        <span className="block text-faint-foreground">
          {step.result === null ? "looking up…" : step.result.note}
        </span>
      </span>
    </li>
  );
}
