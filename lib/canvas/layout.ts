// Where everything goes. Deterministic: no randomness, no measuring the DOM,
// every tie broken by path, so the same data draws the same picture.
//
// Columns run left to right from importers to what they import. Which column
// a node sits in, and its order within the column, come from the folded graph
// alone, so opening a panel resizes boxes without reshuffling the map.

import { aboveUnit, groupUnit, moreUnit, rowUnit, type Box, type Model, type UnitId, type View } from "./view.ts";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Labels are monospace, so width is arithmetic on the character count.
// Geist Mono advances 0.6em.
const MONO_ADVANCE = 0.6;
export const LABEL_PX = 13;
export const META_PX = 11;
export const ROW_PX = 12;
const textWidth = (text: string, px: number) => Math.ceil(text.length * px * MONO_ADVANCE);

const PAD_X = 12;
export const NODE_MIN_H = 40;
/** Extra height per doubling of fan-in. */
const NODE_H_PER_DOUBLING = 12;
export const HEADER_H = 46;
export const ROW_H = 24;
const PANEL_PAD_B = 4;
const SWATCH_SPACE = 16;
const COUNT_SPACE = 36;
const GAP_X = 112;
const GAP_Y = 20;
/** Room right of the last column for edges that loop out of it. */
const LOOP_ROOM = 56;

export const nodeMeta = (box: Box) => `${box.files.length} files · ${box.fanIn} in`;
export const panelMeta = (box: Box) =>
  `${box.files.length} files · ${box.fanIn} in · ${box.fanOut} out`;
export const moreText = (box: Box) => `${box.hidden} more`;
export const aboveText = (box: Box) => `${box.above} above`;

/** Height carries fan-in; width carries only the label. */
function sizeOf(box: Box, labels: Map<UnitId, string>): { w: number; h: number } {
  const label = labels.get(groupUnit(box.dir))!;
  if (!box.open) {
    return {
      w: Math.max(textWidth(label, LABEL_PX), textWidth(nodeMeta(box), META_PX)) + 2 * PAD_X,
      h: Math.round(NODE_MIN_H + NODE_H_PER_DOUBLING * Math.log2(1 + box.fanIn)),
    };
  }
  const rowWidth = Math.max(
    0,
    ...box.order.map((p) => textWidth(labels.get(rowUnit(p))!, ROW_PX) + SWATCH_SPACE + COUNT_SPACE),
  );
  const rows = (box.above > 0 ? 1 : 0) + box.rows.length + (box.hidden > 0 ? 1 : 0);
  return {
    w: Math.max(textWidth(label, LABEL_PX), textWidth(panelMeta(box), META_PX), rowWidth) + 2 * PAD_X,
    h: HEADER_H + rows * ROW_H + PANEL_PAD_B,
  };
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Roughly how many nodes a column holds. Grows with the square root of the
 * node count so the map comes out about the canvas's shape: nodes are wide and
 * short, so that means a few tall columns rather than many short ones.
 */
const columnCapacity = (nodes: number) => Math.max(3, Math.ceil(Math.sqrt(1.2 * nodes)));

/**
 * An order in which as much dependency weight as possible points forward:
 * importers early, what everything leans on late. Greedy (Eades, Lin and
 * Smyth), weighted by file pairs, ties broken by path.
 */
function forwardOrder(dirs: readonly string[], pairs: readonly [string, string, number][]): string[] {
  const out = new Map(dirs.map((d) => [d, new Map<string, number>()]));
  const into = new Map(dirs.map((d) => [d, new Map<string, number>()]));
  for (const [s, t, n] of pairs) {
    out.get(s)!.set(t, n);
    into.get(t)!.set(s, n);
  }
  const left = new Set(dirs);
  const weight = (edges: Map<string, number>) => {
    let w = 0;
    for (const [d, n] of edges) if (left.has(d)) w += n;
    return w;
  };
  const head: string[] = [];
  const tail: string[] = [];
  const take = (d: string) => left.delete(d);

  while (left.size > 0) {
    for (let found = true; found; ) {
      const sinks = [...left].filter((d) => weight(out.get(d)!) === 0);
      sinks.forEach(take);
      tail.unshift(...sinks.reverse());
      found = sinks.length > 0;
    }
    for (let found = true; found; ) {
      const sources = [...left].filter((d) => weight(into.get(d)!) === 0);
      sources.forEach(take);
      head.push(...sources);
      found = sources.length > 0;
    }
    if (left.size === 0) break;
    // Everything left is in a cycle. Pull out the one whose outgoing weight
    // most exceeds its incoming: the edges this reverses are the lightest.
    let best = "";
    let bestScore = -Infinity;
    for (const d of left) {
      const score = weight(out.get(d)!) - weight(into.get(d)!);
      if (score > bestScore) [best, bestScore] = [d, score];
    }
    take(best);
    head.push(best);
  }
  return [...head, ...tail];
}

/** Node directories by column, each column in drawing order. */
export function arrange(model: Model): string[][] {
  const dirs = [...model.fold.groups.keys()].sort(byString);
  const touched = new Set<string>();
  for (const [s, t] of model.groupPairs) touched.add(s).add(t);
  const connected = dirs.filter((d) => touched.has(d));

  // Depth first: the longest chain of forward edges below each node. Edges
  // against the order are the cycle-breaking ones and don't count.
  const order = forwardOrder(connected, model.groupPairs);
  const index = new Map(order.map((d, i) => [d, i]));
  const targets = new Map(connected.map((d) => [d, [] as string[]]));
  for (const [s, t] of model.groupPairs) if (index.get(s)! < index.get(t)!) targets.get(s)!.push(t);
  const depth = new Map<string, number>();
  for (const d of [...order].reverse()) {
    depth.set(d, Math.max(0, ...targets.get(d)!.map((t) => depth.get(t)! + 1)));
  }

  // Then cut that sequence, deepest first, into as many columns as the canvas
  // has room for. A tangled repository has dependency chains far longer than
  // the screen is wide; one column per step would draw it as a thin strip.
  const sequence = [...connected].sort(
    (a, b) => depth.get(b)! - depth.get(a)! || index.get(a)! - index.get(b)!,
  );
  const count = Math.ceil(sequence.length / columnCapacity(dirs.length));
  const columns: string[][] = Array.from({ length: count }, (_, c) =>
    sequence.slice(Math.round((c * sequence.length) / count), Math.round(((c + 1) * sequence.length) / count)),
  );
  // Nodes with no edges at all get a column of their own at the far end.
  const loose = dirs.filter((d) => !touched.has(d));
  if (loose.length > 0) columns.push(loose);

  // Order within columns: a few barycentre sweeps against every neighbour,
  // ties held in their current order, which starts as path order.
  const neighbours = new Map(dirs.map((d) => [d, [] as string[]]));
  for (const [s, t] of model.groupPairs) {
    neighbours.get(s)!.push(t);
    neighbours.get(t)!.push(s);
  }
  const position = new Map<string, number>();
  const record = () =>
    columns.forEach((col) => col.forEach((d, i) => position.set(d, (i + 0.5) / col.length)));
  record();
  for (let sweep = 0; sweep < 8; sweep++) {
    const order = sweep % 2 === 0 ? columns : [...columns].reverse();
    for (const col of order) {
      const centre = new Map(
        col.map((d) => {
          const ns = neighbours.get(d)!;
          const mean = ns.length === 0 ? position.get(d)! : ns.reduce((a, n) => a + position.get(n)!, 0) / ns.length;
          return [d, mean];
        }),
      );
      const index = new Map(col.map((d, i) => [d, i]));
      col.sort((a, b) => centre.get(a)! - centre.get(b)! || index.get(a)! - index.get(b)!);
      col.forEach((d, i) => position.set(d, (i + 0.5) / col.length));
    }
  }
  return columns;
}

export interface Layout {
  /** Every unit an edge can end on: folded nodes, rows, "more" rows. */
  units: Map<UnitId, Rect>;
  /** Every node's outer box, folded or open, by directory. */
  boxes: Map<string, Rect>;
  width: number;
  height: number;
}

export function place(columns: string[][], view: View): Layout {
  const boxOf = new Map(view.boxes.map((b) => [b.dir, b]));
  const size = new Map(view.boxes.map((b) => [b.dir, sizeOf(b, view.labels)]));
  const heights = columns.map(
    (col) => col.reduce((h, d) => h + size.get(d)!.h, 0) + GAP_Y * Math.max(0, col.length - 1),
  );
  const height = Math.max(0, ...heights);

  const boxes = new Map<string, Rect>();
  const units = new Map<UnitId, Rect>();
  let x = 0;
  columns.forEach((col, c) => {
    let y = (height - heights[c]) / 2;
    for (const d of col) {
      const { w, h } = size.get(d)!;
      const rect = { x, y, w, h };
      boxes.set(d, rect);
      const box = boxOf.get(d)!;
      if (!box.open) units.set(groupUnit(d), rect);
      else {
        let line = y + HEADER_H;
        const next = () => ((line += ROW_H), { x, y: line - ROW_H, w, h: ROW_H });
        if (box.above > 0) units.set(aboveUnit(d), next());
        for (const p of box.rows) units.set(rowUnit(p), next());
        if (box.hidden > 0) units.set(moreUnit(d), next());
      }
      y += h + GAP_Y;
    }
    x += Math.max(...col.map((d) => size.get(d)!.w)) + GAP_X;
  });
  return { units, boxes, width: Math.max(0, x - GAP_X + LOOP_ROOM), height };
}

/**
 * An edge's path. Forward edges leave the right side of their source for the
 * left of their target; backward ones leave the left for the right. When the
 * two overlap horizontally — rows in one panel, nodes in one column — the edge
 * loops out of the right side and back in.
 */
export function edgePath(s: Rect, t: Rect): string {
  const y1 = s.y + s.h / 2;
  const y2 = t.y + t.h / 2;
  if (t.x >= s.x + s.w) {
    const [x1, x2] = [s.x + s.w, t.x];
    const bend = Math.max(40, (x2 - x1) / 2);
    return `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`;
  }
  if (t.x + t.w <= s.x) {
    const [x1, x2] = [s.x, t.x + t.w];
    const bend = Math.max(40, (x1 - x2) / 2);
    return `M${x1},${y1} C${x1 - bend},${y1} ${x2 + bend},${y2} ${x2},${y2}`;
  }
  const x1 = s.x + s.w;
  const x2 = t.x + t.w;
  const reach = Math.max(x1, x2) + 18 + Math.abs(y2 - y1) * 0.25;
  return `M${x1},${y1} C${reach},${y1} ${reach},${y2} ${x2},${y2}`;
}
