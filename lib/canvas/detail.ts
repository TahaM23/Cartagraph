// What the detail pane says, derived from the parse result already in the
// browser. Pure arithmetic over files and edges: nothing here fetches, so
// selecting something costs no request.

import type { FileNode } from "../parser/contract.ts";
import { CATEGORIES, categoryOf, type Category } from "./categories.ts";
import type { Model } from "./view.ts";

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface Neighbours {
  /** File → the distinct files it imports, by path. */
  imports: Map<string, string[]>;
  /** File → the distinct files that import it, by path. */
  importedBy: Map<string, string[]>;
}

/**
 * Built from the same distinct pairs the parser counts fan-in and fan-out
 * from, so a file's lists are exactly as long as its counts.
 */
export function neighboursOf(model: Model): Neighbours {
  const imports = new Map<string, string[]>();
  const importedBy = new Map<string, string[]>();
  for (const path of model.files.keys()) {
    imports.set(path, []);
    importedBy.set(path, []);
  }
  for (const [source, target] of model.pairs) {
    imports.get(source)!.push(target);
    importedBy.get(target)!.push(source);
  }
  for (const list of [...imports.values(), ...importedBy.values()]) list.sort(byString);
  return { imports, importedBy };
}

/** How many distinct files `start` reaches by following imports, itself excluded. */
export function reachFrom(start: string, imports: Neighbours["imports"]): number {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length > 0) {
    for (const next of imports.get(stack.pop()!)!) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen.size - 1;
}

export interface StartingPoint {
  file: FileNode;
  /** Files it reaches through imports, directly or not. */
  reach: number;
}

export interface RepositorySummary {
  files: number;
  /** Distinct file-to-file imports inside the repository. */
  imports: number;
  /** Routes recovered by a framework adapter; null when nothing could recover them. */
  routes: number | null;
  /** The adapter's name, or null when only the fallback applied. */
  framework: string | null;
  /** Imported by at least one file, most importers first. */
  mostDepended: FileNode[];
  /** Imported by nothing, best place to start reading first. */
  startingPoints: StartingPoint[];
  /** Files no framework convention gave a role. */
  unidentified: number;
}

/** How many of the most depended-on files the summary lists. */
export const MOST_DEPENDED = 10;

const startRank = (f: FileNode) => (f.entry !== null ? 0 : categoryOf(f) === "source" ? 1 : 2);

export function summarize(model: Model, neighbours: Neighbours, adapter: string): RepositorySummary {
  const files = [...model.files.values()];
  return {
    files: files.length,
    imports: model.pairs.length,
    // The parse result carries no routes yet. Nothing approximates them: a
    // wrong route is the same failure as an invented edge.
    routes: null,
    framework: adapter === "fallback" ? null : adapter,
    mostDepended: files
      .filter((f) => f.fanIn > 0)
      .sort((a, b) => b.fanIn - a.fanIn || byString(a.path, b.path))
      .slice(0, MOST_DEPENDED),
    // Declared entry points first, then source over tests, config and
    // scripts, then whatever reaches the most of the repository.
    startingPoints: files
      .filter((f) => f.fanIn === 0)
      .map((file) => ({ file, reach: reachFrom(file.path, neighbours.imports) }))
      .sort(
        (a, b) =>
          startRank(a.file) - startRank(b.file) || b.reach - a.reach || byString(a.file.path, b.file.path),
      ),
    unidentified: files.filter((f) => f.role === null).length,
  };
}

export interface FolderSummary {
  dir: string;
  files: number;
  fanIn: number;
  fanOut: number;
  /** Every kind present, in the fixed category order, with its files by path. */
  kinds: { category: Category; files: string[] }[];
}

export function summarizeFolder(model: Model, dir: string): FolderSummary {
  const paths = model.fold.groups.get(dir)!;
  const byKind = new Map<Category, string[]>();
  for (const p of paths) {
    const c = categoryOf(model.files.get(p)!);
    byKind.set(c, [...(byKind.get(c) ?? []), p]);
  }
  return {
    dir,
    files: paths.length,
    ...model.groupFan.get(dir)!,
    kinds: CATEGORIES.filter((c) => byKind.has(c)).map((c) => ({ category: c, files: byKind.get(c)! })),
  };
}
