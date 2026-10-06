// Four facts about the edge list, nothing more. No model finds them and none
// describes them: each kind has one fixed sentence, and the rest is paths and
// counts. They explain the shape of the repository; they do not grade it.

import type { FileNode } from "../parser/contract.ts";
import { kindOf } from "./categories.ts";
import type { Neighbours } from "./detail.ts";
import { shortestLoop, stronglyConnected } from "./graph.ts";
import type { Model } from "./view.ts";

/** Lines past which a file counts as long. */
export const LONG_FILE_LINES = 1000;

/** Never call a file unusually imported below this many importers, however small the repository. */
const MIN_UNUSUAL_FAN_IN = 10;

export const INSIGHT_KINDS = ["unimported", "unusualFanIn", "cycles", "long"] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number];

/**
 * The only words an insight ever says. Files nothing imports come first: that
 * one explains. Cycles and long files read closer to a verdict, so they come
 * last.
 */
export const INSIGHT_SENTENCES: Record<InsightKind, string> = {
  unimported: "Nothing imports these, and no convention says what runs them.",
  unusualFanIn: "Far more files import these than import a typical file.",
  cycles: "These files import one another in a loop.",
  long: `These files are over ${LONG_FILE_LINES.toLocaleString("en-US")} lines long.`,
};

export interface Loop {
  /** Every file in the strongly connected component the loop runs through. */
  members: number;
  /** The shortest loop through it: each file imports the next, the last imports the first. */
  files: string[];
}

export interface Insights {
  unimported: FileNode[];
  unusualFanIn: FileNode[];
  /** Importers a file needs, more than, to count as unusual here. */
  fanInThreshold: number;
  cycles: Loop[];
  long: FileNode[];
}

const byPath = (a: FileNode, b: FileNode) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * Whether something other than an import reaches this file: a framework
 * convention (a page, a route, middleware), a declared entry point, or the
 * tool that runs its kind of file — the test runner, the compiler for type
 * declarations, a tool reading its config, a person running a script. None of
 * that shows in the import graph, so no import is not evidence of no use.
 */
export function reachedOtherwise(file: FileNode): boolean {
  return file.entry !== null || file.role !== null || kindOf(file) !== "source";
}

/** Nearest-rank quantile of an ascending list. */
const quantile = (sorted: readonly number[], q: number) => sorted[Math.floor(q * (sorted.length - 1))];

/**
 * The fan-in above which a file is far outside the rest: Tukey's outer-fence
 * rule (Q3 + 1.5 IQR), on log fan-in, because how many files import a file is
 * heavy-tailed and on a plain scale half the repository's hubs would qualify.
 */
export function unusualFanInThreshold(files: readonly FileNode[]): number {
  if (files.length === 0) return Infinity;
  const logs = files.map((f) => Math.log2(1 + f.fanIn)).sort((a, b) => a - b);
  const q1 = quantile(logs, 0.25);
  const q3 = quantile(logs, 0.75);
  return Math.max(MIN_UNUSUAL_FAN_IN, Math.floor(2 ** (q3 + 1.5 * (q3 - q1)) - 1));
}

export function findInsights(model: Model, neighbours: Neighbours): Insights {
  const files = [...model.files.values()];
  const threshold = unusualFanInThreshold(files);
  return {
    unimported: files.filter((f) => f.fanIn === 0 && !reachedOtherwise(f)).sort(byPath),
    unusualFanIn: files
      .filter((f) => f.fanIn > threshold)
      .sort((a, b) => b.fanIn - a.fanIn || byPath(a, b)),
    fanInThreshold: threshold,
    cycles: stronglyConnected(neighbours.imports)
      .map((component) => ({ members: component.length, files: shortestLoop(component, neighbours.imports) }))
      .sort((a, b) => b.members - a.members || (a.files[0] < b.files[0] ? -1 : 1)),
    long: files.filter((f) => f.lines > LONG_FILE_LINES).sort((a, b) => b.lines - a.lines || byPath(a, b)),
  };
}
