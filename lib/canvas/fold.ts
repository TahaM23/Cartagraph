// Folding: which directories the map shows as nodes.
//
// Every directory starts as its own node. Working from the deepest directory
// upward, any directory holding fewer than `threshold` files merges into its
// parent. The threshold is not chosen: it starts low and rises until the map
// lands under MAX_NODES, so the repository's own shape decides the depth.

import type { FileNode } from "../parser/contract.ts";

/** Roughly two dozen: past this a map stops being readable. */
export const MAX_NODES = 24;
/** "Fewer than a couple of files": a directory holding one file merges. */
export const MIN_THRESHOLD = 2;

export interface Fold {
  /** Files fewer than this made a directory merge into its parent. */
  threshold: number;
  /** Each node's directory → the files it holds, sorted by path. Sorted by directory. */
  groups: Map<string, string[]>;
  /** File path → the directory of the node holding it. */
  groupOf: Map<string, string>;
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function parentDir(dir: string): string | null {
  if (dir === ".") return null;
  const slash = dir.lastIndexOf("/");
  return slash === -1 ? "." : dir.slice(0, slash);
}

const depthOf = (dir: string) => (dir === "." ? 0 : dir.split("/").length);

export function foldAt(files: readonly Pick<FileNode, "path" | "folder">[], threshold: number): Fold {
  // Every directory holding a file, plus every directory above one: a
  // directory with only subdirectories still has a place to merge into.
  const held = new Map<string, string[]>();
  for (const file of files) {
    for (let d: string | null = file.folder; d !== null && !held.has(d); d = parentDir(d)) {
      held.set(d, []);
    }
    held.get(file.folder)!.push(file.path);
  }

  const deepest = Math.max(0, ...[...held.keys()].map(depthOf));
  for (let depth = deepest; depth > 0; depth--) {
    // Each pass is computed fresh, and every decision at this depth is taken
    // before any is applied, so no merge here changes what another one sees.
    const merging = [...held.keys()]
      .filter((d) => depthOf(d) === depth && held.get(d)!.length < threshold)
      .sort(byString);
    for (const dir of merging) {
      held.get(parentDir(dir)!)!.push(...held.get(dir)!);
      held.delete(dir);
    }
  }

  const groups = new Map(
    [...held.entries()]
      .filter(([, paths]) => paths.length > 0)
      .sort(([a], [b]) => byString(a, b))
      .map(([dir, paths]) => [dir, paths.sort(byString)] as const),
  );
  const groupOf = new Map<string, string>();
  for (const [dir, paths] of groups) for (const p of paths) groupOf.set(p, dir);
  return { threshold, groups, groupOf };
}

/** The lowest threshold whose fold lands at or under MAX_NODES. */
export function foldRepository(files: readonly Pick<FileNode, "path" | "folder">[]): Fold {
  for (let threshold = MIN_THRESHOLD; ; threshold++) {
    const fold = foldAt(files, threshold);
    // Past files.length every directory but the root merges; nothing further changes.
    if (fold.groups.size <= MAX_NODES || threshold > files.length) return fold;
  }
}
