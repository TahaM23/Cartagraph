// Pure arithmetic over the edge list. No filesystem, nothing to mock.

import type { Edge } from "./contract.ts";

export interface Fan {
  fanIn: number;
  fanOut: number;
}

/** Distinct source→target pairs. Several imports between two files are one dependency. */
export function distinctPairs(edges: readonly Pick<Edge, "source" | "target">[]): [string, string][] {
  const seen = new Set<string>();
  const pairs: [string, string][] = [];
  for (const { source, target } of edges) {
    const key = `${source}\0${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push([source, target]);
  }
  return pairs;
}

export function computeFan(
  paths: Iterable<string>,
  edges: readonly Pick<Edge, "source" | "target">[],
): Map<string, Fan> {
  const fan = new Map<string, Fan>();
  for (const p of paths) fan.set(p, { fanIn: 0, fanOut: 0 });
  for (const [source, target] of distinctPairs(edges)) {
    const s = fan.get(source);
    const t = fan.get(target);
    if (!s || !t) throw new Error(`Edge ${source} -> ${target} names a file that is not a node`);
    s.fanOut++;
    t.fanIn++;
  }
  return fan;
}
