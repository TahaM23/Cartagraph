// What the detail pane says, derived from the parse result already in the
// browser. Pure arithmetic over files and edges: nothing here fetches, so
// selecting something costs no request.

import type { FileNode, Route } from "../parser/contract.ts";
import { kindOf, type Category, type Rail } from "./categories.ts";
import { walk } from "./graph.ts";
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
  return walk(start, imports, Infinity).reduce((n, level) => n + level.length, 0);
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
  /** Routes a framework adapter recovered exactly. */
  routes: number;
  /** The framework's name, or null when no adapter applied. */
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

const startRank = (f: FileNode) => (f.entry !== null ? 0 : kindOf(f) === "source" ? 1 : 2);

export function summarize(
  model: Model,
  neighbours: Neighbours,
  rail: Rail,
  routes: readonly Route[],
): RepositorySummary {
  const files = [...model.files.values()];
  return {
    files: files.length,
    imports: model.pairs.length,
    routes: routes.length,
    framework: rail.framework,
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
  /** Every rail category present, in the rail's order, with its files by path. */
  kinds: { category: Category; files: string[] }[];
}

export function summarizeFolder(model: Model, dir: string, rail: Rail): FolderSummary {
  const paths = model.fold.groups.get(dir)!;
  const byKind = new Map<string, string[]>();
  for (const p of paths) {
    const id = rail.of(model.files.get(p)!).id;
    byKind.set(id, [...(byKind.get(id) ?? []), p]);
  }
  return {
    dir,
    files: paths.length,
    ...model.groupFan.get(dir)!,
    kinds: rail.categories.filter((c) => byKind.has(c.id)).map((c) => ({ category: c, files: byKind.get(c.id)! })),
  };
}
