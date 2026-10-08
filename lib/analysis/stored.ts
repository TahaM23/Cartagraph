// A stored analysis read back as the parser's own shapes, so the explorer
// renders stored rows exactly as it rendered a parse result on disk.
//
// Reads go through the signed-in user's client: row-level security decides
// what comes back, as everywhere else.

import type { SupabaseClient } from "@supabase/supabase-js";
import { FileNode, Route, type Edge } from "@/lib/parser/contract";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

/** The API returns at most this many rows per request, so larger reads page. */
const PAGE = 1000;

async function readAll<T>(
  what: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`Reading ${what} failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

export interface StoredGraph {
  /** Each file's `role` is the one convention gave it; a model's label is in `labels`, never there. */
  files: FileNode[];
  /**
   * Path → the role a model gave a file no convention identified. Kept apart
   * from `role` because roles decide the rail, the routes and what counts as
   * reached, and a model's reading of a file decides none of that.
   */
  labels: Record<string, string>;
  edges: Pick<Edge, "source" | "target">[];
  routes: Route[];
}

export async function loadStoredGraph(db: Db, analysisId: string): Promise<StoredGraph> {
  const [fileRows, roleRows, edgeRows, routeRows] = await Promise.all([
    readAll("files", (from, to) =>
      db
        .from("files")
        .select("id, path, folder, package, extension, lines, bytes, hash, parsed, skip_reason, skip_detail, fan_in, fan_out, entry")
        .eq("analysis_id", analysisId)
        .order("path")
        .range(from, to),
    ),
    readAll("file roles", (from, to) =>
      db.from("file_roles").select("file_id, role, source").eq("analysis_id", analysisId).order("id").range(from, to),
    ),
    readAll("edges", (from, to) =>
      db
        .from("edges")
        .select("source_file_id, target_file_id")
        .eq("analysis_id", analysisId)
        .order("id")
        .range(from, to),
    ),
    readAll("routes", (from, to) =>
      db
        .from("routes")
        .select("file_id, method, path, line")
        .eq("analysis_id", analysisId)
        .order("id")
        .range(from, to),
    ),
  ]);

  const roles = new Map(roleRows.filter((r) => r.source === "convention").map((r) => [r.file_id, r.role]));
  const paths = new Map(fileRows.map((f) => [f.id, f.path]));

  // Validated against the contract, like any other read of a parse result.
  const files = fileRows.map((f) =>
    FileNode.parse({
      path: f.path,
      folder: f.folder,
      package: f.package,
      extension: f.extension,
      lines: f.lines,
      bytes: f.bytes,
      hash: f.hash,
      parsed: f.parsed,
      skipReason: f.skip_reason,
      skipDetail: f.skip_detail,
      fanOut: f.fan_out,
      fanIn: f.fan_in,
      entry: f.entry,
      role: roles.get(f.id) ?? null,
    }),
  );

  const edges = edgeRows.map((e) => {
    const source = paths.get(e.source_file_id);
    const target = paths.get(e.target_file_id);
    if (!source || !target) throw new Error(`Analysis ${analysisId} has an edge to a file it does not have.`);
    return { source, target };
  });

  const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const routes = routeRows
    .map((r) => {
      const file = paths.get(r.file_id);
      if (!file) throw new Error(`Analysis ${analysisId} has a route in a file it does not have.`);
      return Route.parse({ method: r.method, path: r.path, file, line: r.line });
    })
    // The order the parser wrote them in.
    .sort((a, b) => byString(a.path, b.path) || byString(a.method, b.method) || byString(a.file, b.file) || a.line - b.line);

  const labels: Record<string, string> = {};
  for (const r of roleRows) {
    const path = paths.get(r.file_id);
    if (r.source === "model" && path) labels[path] = r.role;
  }

  return { files, labels, edges, routes };
}
