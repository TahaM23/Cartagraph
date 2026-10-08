// What an explanation is written from, read from the stored graph.
//
// Every path the model sees comes from here: the files asked about, the
// files at the other end of their imports, and nothing else. The model never
// decides that two files are connected; the parser did, and this reads what
// it stored.

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "../supabase/database.types.ts";

type Db = SupabaseClient<Database>;

export const NeighbourFile = z.object({
  path: z.string(),
  hash: z.string().nullable(),
  lines: z.number().int(),
  parsed: z.boolean(),
  fanIn: z.number().int(),
  fanOut: z.number().int(),
  role: z.string().nullable(),
  roleSource: z.enum(["convention", "model"]).nullable(),
  /** One of the files asked about, rather than a neighbour of one. */
  member: z.boolean(),
});
export type NeighbourFile = z.infer<typeof NeighbourFile>;

const Neighbourhood = z.object({
  /** Sorted by path. */
  files: z.array(NeighbourFile),
  /** Distinct [importer, imported] pairs with a member at either end, sorted. */
  pairs: z.array(z.tuple([z.string(), z.string()])),
});
export type Neighbourhood = z.infer<typeof Neighbourhood>;

/** The files at `paths` in one analysis, everything they import or are imported by, and those pairs. */
export async function loadNeighbourhood(db: Db, analysisId: string, paths: readonly string[]): Promise<Neighbourhood> {
  const { data, error } = await db.rpc("neighbourhood", { target_analysis: analysisId, member_paths: [...paths] });
  if (error) throw new Error(`Reading the files around ${paths.length === 1 ? paths[0] : "the folder"} failed: ${error.message}`);
  return Neighbourhood.parse(data);
}

/** The API returns at most this many rows per request, so larger reads page. */
const PAGE = 1000;

/** Every file's path and folder, which is all folding needs. */
export async function loadFilePlaces(db: Db, analysisId: string): Promise<{ path: string; folder: string }[]> {
  const rows: { path: string; folder: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("files")
      .select("path, folder")
      .eq("analysis_id", analysisId)
      .order("path")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Reading the analysis's files failed: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}
