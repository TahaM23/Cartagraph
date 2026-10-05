// What is on screen for a given set of open panels: one box per node, rows
// inside the open ones, and the file-to-file edges rolled up onto whichever
// of those each file is currently drawn as. Derived from the parse result;
// nothing here changes its shape.

import type { Edge, FileNode } from "../parser/contract.ts";
import { distinctPairs } from "../parser/graph.ts";
import type { Fold } from "./fold.ts";

/**
 * Lines an open panel's body holds, counting the "above" and "more" lines. A
 * folder with more files than this scrolls inside a panel of fixed height.
 */
export const PANEL_LINES = 13;

/** Anything an edge can end on: a folded node, a row, or a panel's "more" row. */
export type UnitId = string;
export const groupUnit = (dir: string): UnitId => `g:${dir}`;
export const rowUnit = (path: string): UnitId => `f:${path}`;
export const moreUnit = (dir: string): UnitId => `m:${dir}`;
export const aboveUnit = (dir: string): UnitId => `u:${dir}`;

/** Computed once per fold; nothing in it depends on what is open. */
export interface Model {
  fold: Fold;
  files: Map<string, FileNode>;
  /** Distinct file → file dependencies. */
  pairs: [string, string][];
  /** Distinct files outside a node that import into it, and that it imports. */
  groupFan: Map<string, { fanIn: number; fanOut: number }>;
  /** Node → node dependencies, self-loops removed, with how many distinct file pairs each stands for. Layout ranks on these. */
  groupPairs: [string, string, number][];
}

export function buildModel(
  files: readonly FileNode[],
  edges: readonly Pick<Edge, "source" | "target">[],
  fold: Fold,
): Model {
  const pairs = distinctPairs(edges);
  const into = new Map<string, Set<string>>();
  const outOf = new Map<string, Set<string>>();
  for (const dir of fold.groups.keys()) {
    into.set(dir, new Set());
    outOf.set(dir, new Set());
  }
  const weight = new Map<string, [string, string, number]>();
  for (const [source, target] of pairs) {
    const s = fold.groupOf.get(source)!;
    const t = fold.groupOf.get(target)!;
    if (s === t) continue;
    into.get(t)!.add(source);
    outOf.get(s)!.add(target);
    const key = `${s}\0${t}`;
    const pair = weight.get(key);
    if (pair) pair[2]++;
    else weight.set(key, [s, t, 1]);
  }
  const groupPairs = [...weight.values()];
  const groupFan = new Map(
    [...fold.groups.keys()].map((dir) => [
      dir,
      { fanIn: into.get(dir)!.size, fanOut: outOf.get(dir)!.size },
    ]),
  );
  return { fold, files: new Map(files.map((f) => [f.path, f])), pairs, groupFan, groupPairs };
}

export interface Box {
  dir: string;
  files: string[];
  fanIn: number;
  fanOut: number;
  open: boolean;
  /** When open: every file, most depended-on first. */
  order: string[];
  /** When open: the rows in view, a window onto `order`. */
  rows: string[];
  /** When open: files scrolled out of view above the rows. */
  above: number;
  /** When open: files out of view below the rows. */
  hidden: number;
}

export interface Link {
  source: UnitId;
  target: UnitId;
  /** Distinct file pairs this link stands for. */
  pairs: number;
}

export interface View {
  boxes: Box[];
  links: Link[];
  labels: Map<UnitId, string>;
  /** File path → the unit it is drawn as: its row, its folded node, or a panel's "above"/"more" line. */
  anchor: Map<string, UnitId>;
}

/** An open panel's files, most depended-on first, ties by path. */
export function panelOrder(model: Model, dir: string): string[] {
  return [...model.fold.groups.get(dir)!].sort(
    (a, b) => model.files.get(b)!.fanIn - model.files.get(a)!.fanIn || (a < b ? -1 : 1),
  );
}

/**
 * A scroll offset that puts row `index` of a `files`-file panel in view,
 * keeping `current` if it already does.
 */
export function scrollTo(files: number, index: number, current: number): number {
  const { start, count } = rowWindow(files, current);
  if (index >= start && index < start + count) return current;
  return Math.min(maxScroll(files), Math.max(0, index - Math.floor(PANEL_LINES / 2)));
}

/** The highest scroll offset a folder of `files` files can take. */
export const maxScroll = (files: number) => (files <= PANEL_LINES ? 0 : files - (PANEL_LINES - 1));

/**
 * Which rows are in view at a scroll offset. The panel's line count never
 * changes while scrolling: an "above" line, when there is one, takes the
 * place of a row, so nothing else on the map moves.
 */
function rowWindow(files: number, offset: number) {
  const start = Math.min(Math.max(0, Math.round(offset)), maxScroll(files));
  if (files <= PANEL_LINES) return { start: 0, count: files };
  const above = start > 0 ? 1 : 0;
  const below = start < maxScroll(files) ? 1 : 0;
  return { start, count: PANEL_LINES - above - below };
}

export function buildView(
  model: Model,
  open: ReadonlySet<string>,
  repository: string,
  scroll: ReadonlyMap<string, number> = new Map(),
): View {
  const anchor = new Map<string, UnitId>();
  const boxes: Box[] = [];

  for (const [dir, paths] of model.fold.groups) {
    const fan = model.groupFan.get(dir)!;
    const isOpen = open.has(dir);
    const order = isOpen ? panelOrder(model, dir) : [];
    const { start, count } = rowWindow(order.length, scroll.get(dir) ?? 0);
    const rows = order.slice(start, start + count);
    // A file out of view is drawn as the line standing in for it.
    if (!isOpen) for (const p of paths) anchor.set(p, groupUnit(dir));
    order.forEach((p, i) =>
      anchor.set(p, i < start ? aboveUnit(dir) : i < start + count ? rowUnit(p) : moreUnit(dir)),
    );
    boxes.push({
      dir,
      files: paths,
      ...fan,
      open: isOpen,
      order,
      rows,
      above: start,
      hidden: order.length - start - rows.length,
    });
  }

  const byKey = new Map<string, Link>();
  for (const [s, t] of model.pairs) {
    const source = anchor.get(s)!;
    const target = anchor.get(t)!;
    if (source === target) continue;
    const key = `${source}\0${target}`;
    const link = byKey.get(key);
    if (link) link.pairs++;
    else byKey.set(key, { source, target, pairs: 1 });
  }

  const named: { id: UnitId; segments: string[] }[] = [];
  for (const box of boxes) {
    named.push({ id: groupUnit(box.dir), segments: box.dir === "." ? [repository] : box.dir.split("/") });
    // Every file of an open panel is named, not only the rows in view, so a
    // row keeps its label, and the panel its width, while it scrolls.
    for (const p of box.order) named.push({ id: rowUnit(p), segments: p.split("/") });
  }

  return { boxes, links: [...byKey.values()], labels: shortestUnique(named), anchor };
}

/**
 * The shortest trailing run of path segments that no other item on screen
 * shares. Lengthens only the items in a collision, and only until it clears.
 */
export function shortestUnique(items: readonly { id: string; segments: string[] }[]): Map<string, string> {
  const take = new Map(items.map((i) => [i.id, 1]));
  const label = (i: (typeof items)[number]) => i.segments.slice(-take.get(i.id)!).join("/");

  for (let changed = true; changed; ) {
    changed = false;
    const holders = new Map<string, (typeof items)[number][]>();
    for (const i of items) {
      const l = label(i);
      holders.set(l, [...(holders.get(l) ?? []), i]);
    }
    for (const clash of holders.values()) {
      if (clash.length < 2) continue;
      for (const i of clash) {
        if (take.get(i.id)! < i.segments.length) {
          take.set(i.id, take.get(i.id)! + 1);
          changed = true;
        }
      }
    }
  }
  return new Map(items.map((i) => [i.id, label(i)]));
}
