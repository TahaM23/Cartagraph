// What each of the agent's tools answers, from one stored analysis.
//
// Pure functions over the stored graph, built with the same fold, model,
// neighbours and walk that draw the canvas, so the agent and the map can
// never disagree. The agent names a starting point and a direction; nothing
// here relates two files the parser did not connect.
//
// Answers are capped so one lookup cannot fill the model's context, and every
// cap says how much it left out.

import { z } from "zod";
import type { StoredGraph } from "../analysis/stored.ts";
import { railFor, type Rail } from "../canvas/categories.ts";
import { neighboursOf, summarize, type Neighbours } from "../canvas/detail.ts";
import { foldRepository } from "../canvas/fold.ts";
import { walk, WALK_DEPTH } from "../canvas/graph.ts";
import { buildModel, type Model } from "../canvas/view.ts";

/**
 * The few coverage figures the summary states. Read on their own rather than
 * as the whole contract, so analyses stored before it grew (CommonJS, say)
 * still report them.
 */
const CoverageFigures = z.object({
  files: z.object({ parsed: z.number(), skipped: z.number(), skipReasons: z.record(z.string(), z.number()) }),
  imports: z.object({ unresolved: z.number() }),
});

/** A question the agent may ask that has no answer: unknown file, bad input. Its message is shown to the model. */
export class AnswerError extends Error {
  readonly status: 400 | 404;
  constructor(status: 400 | 404, message: string) {
    super(message);
    this.status = status;
  }
}

export interface AnalysisFacts {
  repository: string;
  adapter: string | null;
  commit: string | null;
  coverage: unknown;
}

/** Everything the answers share, computed once per request. */
export interface Prepared {
  graph: StoredGraph;
  facts: AnalysisFacts;
  model: Model;
  neighbours: Neighbours;
  rail: Rail;
}

export function prepare(graph: StoredGraph, facts: AnalysisFacts): Prepared {
  const model = buildModel(graph.files, graph.edges, foldRepository(graph.files));
  return { graph, facts, model, neighbours: neighboursOf(model), rail: railFor(facts.adapter ?? "fallback") };
}

const LIST_CAP = 100;
const STARTING_POINTS = 10;

const capped = <T>(items: readonly T[], cap: number) => ({
  total: items.length,
  items: items.slice(0, cap),
  ...(items.length > cap ? { omitted: items.length - cap } : {}),
});

/** A file's role, and where it came from: a framework convention, or a model's label. */
function roleOf(p: Prepared, path: string): { role: string; source: "convention" | "label" } | null {
  const conventional = p.model.files.get(path)?.role;
  if (conventional) return { role: conventional, source: "convention" };
  const label = p.graph.labels[path];
  return label ? { role: label, source: "label" } : null;
}

function fileOrThrow(p: Prepared, path: string) {
  if (p.model.files.has(path)) return path;
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const similar = [...p.model.files.keys()].filter((f) => name && f.toLowerCase().endsWith(name)).slice(0, 5);
  throw new AnswerError(
    404,
    `No file ${path} in this repository's graph.` + (similar.length > 0 ? ` Files with that name: ${similar.join(", ")}.` : ""),
  );
}

const Path = z.string().min(1).max(1024);

export const ANSWERS = {
  summary: {
    input: z.object({}),
    answer(p: Prepared) {
      const s = summarize(p.model, p.neighbours, p.rail, p.graph.routes);
      const coverage = CoverageFigures.safeParse(p.facts.coverage);
      return {
        repository: p.facts.repository,
        commit: p.facts.commit?.slice(0, 7) ?? null,
        framework: s.framework,
        files: s.files,
        imports: s.imports,
        routes: s.routes,
        coverage: coverage.success
          ? {
              parsed: coverage.data.files.parsed,
              skipped: coverage.data.files.skipped,
              skipReasons: coverage.data.files.skipReasons,
              unresolvedImports: coverage.data.imports.unresolved,
            }
          : null,
        folders: [...p.model.fold.groups.entries()]
          .map(([dir, files]) => ({ dir: dir || "(root)", files: files.length }))
          .sort((a, b) => b.files - a.files),
        mostDependedOn: s.mostDepended.map((f) => ({ path: f.path, importedBy: f.fanIn, role: roleOf(p, f.path)?.role ?? null })),
        startingPoints: s.startingPoints.slice(0, STARTING_POINTS).map(({ file, reach }) => ({ path: file.path, reaches: reach })),
        withoutRole: s.unidentified,
      };
    },
  },

  search: {
    input: z.object({ query: z.string().max(200).optional(), limit: z.number().int().min(1).max(LIST_CAP).optional() }),
    answer(p: Prepared, { query = "", limit = 25 }: { query?: string; limit?: number }) {
      const q = query.trim().toLowerCase();
      // No query lists every file, in path order: asked which files there are,
      // the agent has a real list to give rather than one to make up.
      const matches = q
        ? [...p.model.files.keys()]
            .filter((f) => f.toLowerCase().includes(q))
            // Shorter paths first: the closer the match is to the whole path, the likelier it is the one meant.
            .sort((a, b) => a.length - b.length || (a < b ? -1 : 1))
        : [...p.model.files.keys()].sort();
      const { items, ...counts } = capped(matches, limit);
      return { query: q || null, ...counts, files: items.map((path) => ({ path, role: roleOf(p, path)?.role ?? null })) };
    },
  },

  role: {
    input: z.object({ role: z.string().min(1).max(50) }),
    answer(p: Prepared, { role }: { role: string }) {
      const wanted = role.trim().toLowerCase();
      const counts = new Map<string, number>();
      const matches: { path: string; source: string }[] = [];
      for (const path of p.model.files.keys()) {
        const r = roleOf(p, path);
        if (!r) continue;
        counts.set(r.role, (counts.get(r.role) ?? 0) + 1);
        // Adapters name roles for people ("API endpoint", "page route"), so case is not part of a role.
        if (r.role.toLowerCase() === wanted) matches.push({ path, source: r.source });
      }
      if (matches.length === 0) {
        return { role: wanted, total: 0, rolesInThisRepository: Object.fromEntries([...counts].sort((a, b) => b[1] - a[1])) };
      }
      const { items, ...rest } = capped(matches, LIST_CAP);
      return { role: wanted, ...rest, files: items };
    },
  },

  neighbours: {
    input: z.object({ path: Path }),
    answer(p: Prepared, { path }: { path: string }) {
      fileOrThrow(p, path);
      return {
        path,
        role: roleOf(p, path)?.role ?? null,
        imports: p.neighbours.imports.get(path)!,
        importedBy: p.neighbours.importedBy.get(path)!,
      };
    },
  },

  walk: {
    input: z.object({ path: Path, direction: z.enum(["dependents", "dependencies"]) }),
    answer(p: Prepared, { path, direction }: { path: string; direction: "dependents" | "dependencies" }) {
      fileOrThrow(p, path);
      const next = direction === "dependents" ? p.neighbours.importedBy : p.neighbours.imports;
      const levels = walk(path, next, WALK_DEPTH);
      return {
        path,
        direction,
        maxDistance: WALK_DEPTH,
        total: levels.reduce((n, l) => n + l.length, 0),
        levels: levels.map((files, i) => {
          const { items, ...counts } = capped(files, LIST_CAP);
          return { distance: i + 1, ...counts, files: items };
        }),
      };
    },
  },

  routes: {
    input: z.object({ contains: z.string().max(200).optional() }),
    answer(p: Prepared, { contains }: { contains?: string }) {
      const q = contains?.toLowerCase();
      const routes = p.graph.routes.filter((r) => !q || r.path.toLowerCase().includes(q));
      const { items, ...counts } = capped(routes, LIST_CAP * 2);
      return { ...counts, routes: items.map(({ method, path, file, line }) => ({ method, path, file, line })) };
    },
  },
} as const;

export type Tool = keyof typeof ANSWERS;
export const isTool = (name: string): name is Tool => Object.hasOwn(ANSWERS, name);
