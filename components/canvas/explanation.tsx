"use client";

import { useMemo, type ReactNode } from "react";
import { rerunAnalysis } from "@/app/(app)/analyses/actions";
import { linkPaths, parseExplanation, resolvePath, type Inline } from "@/lib/explain/markup";
import type { Freshness } from "@/lib/explain/types";
import { groupUnit, rowUnit, type UnitId } from "@/lib/canvas/view";
import { useAnalysis } from "./analysis";

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const short = (sha: string) => sha.slice(0, 7);

/**
 * A file's or folder's explanation tab. Nothing is asked of the model until
 * Explain is pressed; once it has answered, the answer stays for as long as
 * the map is open, wherever the selection goes in between.
 */
export function Explanation({ unit }: { unit: UnitId }) {
  const { explanations, explain, neighbours, model } = useAnalysis();
  const state = explanations.get(unit);
  const isFile = unit.startsWith("f:");
  const subject = unit.slice(2);

  if (!state) {
    const connected = isFile
      ? new Set([...neighbours.imports.get(subject)!, ...neighbours.importedBy.get(subject)!]).size
      : null;
    return (
      <div className="flex flex-col items-start gap-2 px-4 py-4">
        <p className="text-muted-foreground">
          {isFile
            ? `Written by a model from this file's code and the ${plural(connected!, "file")} the parser found it connected to. Nothing else is suggested to it.`
            : `Written by a model from what the ${plural(model.fold.groups.get(subject)!.length, "file")} in this folder are, and what points at them.`}
        </p>
        <button
          type="button"
          onClick={() => explain(unit)}
          className="rounded-md border border-accent bg-accent/15 px-2.5 py-1 hover:bg-accent/25"
        >
          Explain
        </button>
        <TracingNote />
      </div>
    );
  }

  if (state.status === "writing") {
    return (
      <div className="px-4 py-4">
        <p className="text-muted-foreground">Reading the code and writing an explanation…</p>
      </div>
    );
  }

  if (state.status === "failed") {
    return (
      <div className="flex flex-col items-start gap-2 px-4 py-4">
        <p>{state.error}</p>
        <button
          type="button"
          onClick={() => explain(unit)}
          className="rounded-md border border-border px-2.5 py-1 text-muted-foreground hover:text-foreground"
        >
          Try again
        </button>
      </div>
    );
  }

  const { explained } = state;
  return (
    <div className="flex flex-col">
      <FreshnessNote freshness={explained.freshness} isFile={isFile} />
      <ExplanationBody text={explained.body} />
      <div className="flex flex-col gap-0.5 border-t border-border px-4 py-2.5 text-[12px] text-muted-foreground">
        <p>
          <span className="font-mono">{explained.model}</span> ·{" "}
          {explained.cached ? "from the cache, no model call" : "written just now"} · describes{" "}
          <span className="font-mono">{short(explained.freshness.commit)}</span>
        </p>
        <TracingNote />
      </div>
    </div>
  );
}

/** Whether model calls are recorded, said plainly either way: an absent key otherwise looks like no traffic. */
function TracingNote() {
  const { tracing } = useAnalysis();
  return tracing.enabled ? (
    <p className="text-[12px] text-faint-foreground">
      Traced to LangSmith, project <span className="font-mono">{tracing.project}</span>
    </p>
  ) : (
    <p className="text-[12px] text-muted-foreground" title="Explanations still work; nothing records them.">
      Not traced: {tracing.reason}
    </p>
  );
}

function FreshnessNote({ freshness, isFile }: { freshness: Freshness; isFile: boolean }) {
  const { id } = useAnalysis();
  if (freshness.state === "current") return null;
  if (freshness.state === "unknown") {
    return (
      <p className="border-b border-border px-4 py-2 text-[12px] text-muted-foreground">
        Could not check whether the repository has moved past{" "}
        <span className="font-mono">{short(freshness.commit)}</span>: {freshness.reason}
      </p>
    );
  }

  const analysed = <span className="font-mono">{short(freshness.commit)}</span>;
  const head = <span className="font-mono">{short(freshness.head)}</span>;
  let message: ReactNode;
  if (freshness.file === "changed") {
    message = (
      <>
        <strong className="font-medium">This explanation is stale.</strong> The file has changed since the analysed
        commit {analysed}; the repository is now at {head}. This explanation and the map describe the analysed version.
      </>
    );
  } else if (freshness.file === "deleted") {
    message = (
      <>
        <strong className="font-medium">This explanation is stale.</strong> The file no longer exists at {head}. This
        explanation describes it as it was at {analysed}.
      </>
    );
  } else {
    message = (
      <>
        The repository has moved past the analysed commit {analysed} to {head}.{" "}
        {isFile ? "This file is unchanged, but what connects to it may not be." : "Files in this folder may have changed."}
      </>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2 border-b border-border bg-muted px-4 py-2.5">
      <p>{message}</p>
      <form action={rerunAnalysis.bind(null, id)}>
        <button
          type="submit"
          className="rounded-md border border-accent bg-accent/15 px-2.5 py-1 hover:bg-accent/25"
        >
          Re-analyse at the latest commit
        </button>
      </form>
    </div>
  );
}

type Target = { kind: "file"; path: string } | { kind: "folder"; dir: string };

/**
 * The three permitted formats, rendered, with every repository path in the
 * prose made a link that moves the map. Only paths the analysis has are
 * links; anything else stays text.
 */
export function ExplanationBody({ text }: { text: string }) {
  const { model } = useAnalysis();
  const blocks = useMemo(() => parseExplanation(text), [text]);
  const resolve = useMemo(
    () =>
      (path: string): Target | null =>
        model.files.has(path) ? { kind: "file", path } : model.fold.groups.has(path) ? { kind: "folder", dir: path } : null,
    [model],
  );

  return (
    <div className="flex flex-col gap-2.5 px-4 py-3 leading-relaxed">
      {blocks.map((block, i) =>
        block.type === "paragraph" ? (
          <p key={i}>
            <Inlines nodes={block.content} resolve={resolve} />
          </p>
        ) : (
          <ul key={i} className="flex list-disc flex-col gap-1 pl-4 marker:text-faint-foreground">
            {block.items.map((item, j) => (
              <li key={j}>
                <Inlines nodes={item} resolve={resolve} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

function Inlines({ nodes, resolve }: { nodes: readonly Inline[]; resolve: (path: string) => Target | null }) {
  return nodes.map((node, i) => {
    if (node.type === "bold") {
      return (
        <strong key={i} className="font-semibold">
          <Inlines nodes={node.children} resolve={resolve} />
        </strong>
      );
    }
    if (node.type === "code") {
      const target = resolvePath(node.text, resolve);
      return target ? (
        <PathLink key={i} target={target} text={node.text} />
      ) : (
        <code key={i} className="rounded-[3px] bg-muted px-1 font-mono text-[12px]">
          {node.text}
        </code>
      );
    }
    return linkPaths(node.text, resolve).map((segment, j) =>
      typeof segment === "string" ? (
        <span key={`${i}:${j}`}>{segment}</span>
      ) : (
        <PathLink key={`${i}:${j}`} target={segment.target} text={segment.text} />
      ),
    );
  });
}

/** A path the analysis has. Clicking moves the map to it; hovering lights it there. */
function PathLink({ target, text }: { target: Target; text: string }) {
  const { focusFile, focusDir, hover } = useAnalysis();
  const unit = target.kind === "file" ? rowUnit(target.path) : groupUnit(target.dir);
  return (
    <button
      type="button"
      title={target.kind === "file" ? `Show ${target.path} on the map` : `Show the ${target.dir} folder on the map`}
      onClick={() => {
        hover(null);
        if (target.kind === "file") focusFile(target.path);
        else focusDir(target.dir);
      }}
      onPointerEnter={() => hover(unit)}
      onPointerLeave={() => hover(null)}
      className="inline rounded-[3px] bg-accent/10 px-1 text-left font-mono text-[12px] break-all text-accent hover:underline"
    >
      {text}
    </button>
  );
}
