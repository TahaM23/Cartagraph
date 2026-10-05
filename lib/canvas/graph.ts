// Walks over the import graph. Pure functions of an adjacency list: nothing
// fetches, so every answer here is instant.

/** File → the distinct files one step away, in whichever direction is being walked. */
export type Adjacency = ReadonlyMap<string, readonly string[]>;

/**
 * How far blast radius and dependency chain go. Past two levels the walk
 * returns most of the repository and stops being an answer.
 */
export const WALK_DEPTH = 2;

/**
 * Everything `start` reaches in at most `depth` steps, as levels: the files
 * one step away, then those first reached at two, and so on. Each file
 * appears once, at the shallowest level it is reached; `start` never does.
 *
 * Follow `imports` for what a file needs (its dependency chain), `importedBy`
 * for what breaks if it changes (its blast radius). The same walk either way.
 */
export function walk(start: string, next: Adjacency, depth = WALK_DEPTH): string[][] {
  const seen = new Set([start]);
  const levels: string[][] = [];
  let frontier = [start];
  while (frontier.length > 0 && levels.length < depth) {
    const level: string[] = [];
    for (const file of frontier) {
      for (const n of next.get(file) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        level.push(n);
      }
    }
    if (level.length === 0) break;
    level.sort();
    levels.push(level);
    frontier = level;
  }
  return levels;
}

/**
 * Strongly connected components with more than one file, or one file that
 * imports itself: the sets of files that can each reach every other through
 * imports. Tarjan's algorithm, run with an explicit stack — a real
 * repository's import chains are deep enough to overflow the call stack.
 */
export function stronglyConnected(next: Adjacency): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const visit = (v: string) => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
  };

  for (const root of [...next.keys()].sort()) {
    if (index.has(root)) continue;
    visit(root);
    // Each frame is a file and how many of its neighbours it has tried.
    const work: [string, number][] = [[root, 0]];
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const [v, i] = frame;
      const out = next.get(v) ?? [];
      if (i < out.length) {
        frame[1]++;
        const w = out[i];
        if (!index.has(w)) {
          visit(w);
          work.push([w, 0]);
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, index.get(w)!));
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent)!, low.get(v)!));
      }
      if (low.get(v) !== index.get(v)) continue;
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      if (component.length > 1 || (next.get(v) ?? []).includes(v)) components.push(component.sort());
    }
  }
  return components;
}

/**
 * The shortest loop through a strongly connected component, as the files in
 * import order: each imports the next, and the last imports the first. Ties
 * go to the loop starting at the earliest path, so the answer is stable.
 */
export function shortestLoop(component: readonly string[], next: Adjacency): string[] {
  const inside = new Set(component);
  let best: string[] | null = null;
  for (const start of component) {
    // Breadth-first from `start`, stopping once no loop through it can beat the best.
    const parent = new Map<string, string | null>([[start, null]]);
    let frontier = [start];
    let found: string | null = null;
    // A loop closed while exploring at `depth` holds `depth` files.
    for (let depth = 1; frontier.length > 0 && found === null; depth++) {
      if (best !== null && depth >= best.length) break;
      const level: string[] = [];
      for (const u of frontier) {
        for (const w of next.get(u) ?? []) {
          if (w === start) {
            found = u;
            break;
          }
          if (!inside.has(w) || parent.has(w)) continue;
          parent.set(w, u);
          level.push(w);
        }
        if (found !== null) break;
      }
      frontier = level;
    }
    if (found === null) continue;
    const loop: string[] = [];
    for (let at: string | null = found; at !== null; at = parent.get(at)!) loop.push(at);
    loop.reverse();
    if (best === null || loop.length < best.length) best = loop;
  }
  return best ?? [];
}
