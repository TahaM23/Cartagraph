// Explaining a file, and explaining a folder.
//
// Each is one traced run, and everything happens inside it: reading what the
// subject is connected to, building the cache key from its content, looking
// the key up, and only on a miss fetching the code and calling the model. A
// cache hit is therefore a recorded run with a lookup in it and no model
// call, which is how a working cache is told apart from a broken one.
//
// The code explained is the analysed code: fetched at the analysed commit
// and checked against the hash the parser stored, so the explanation always
// matches the graph it sits beside.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cacheKey, readExplanation, writeExplanation } from "../ai/cache.ts";
import { ai, MODELS, traced } from "../ai/client.ts";
import { foldRepository } from "../canvas/fold.ts";
import { fetchFileAt, type RepositoryRef } from "../pipeline/github.ts";
import type { AdminSupabase } from "../supabase/admin.ts";
import type { Database } from "../supabase/database.types.ts";
import { loadFilePlaces, loadNeighbourhood, type NeighbourFile } from "./neighbourhood.ts";
import {
  FILE_INSTRUCTIONS,
  fileInput,
  FOLDER_INSTRUCTIONS,
  folderInput,
  PROMPT_VERSIONS,
  type Setting,
} from "./prompt.ts";

type Db = SupabaseClient<Database>;

/** A failure fit to show the person who asked. */
export class ExplainError extends Error {}

export interface AnalysisRef {
  id: string;
  orgId: string;
  /** The commit that was analysed. */
  commit: string;
  repo: RepositoryRef;
  /** The framework whose conventions applied, or null. */
  framework: string | null;
}

export interface Written {
  body: string;
  model: string;
  cached: boolean;
}

interface Request {
  /** The signed-in user's client: what it cannot read, the model is not shown. */
  db: Db;
  /** Writes the cache. */
  admin: AdminSupabase;
  analysis: AnalysisRef;
}

/** Neighbours shown by their opening lines, on top of every neighbour listed by path. */
const FILE_EXCERPTS = { imports: 5, importedBy: 5 };
const FOLDER_EXCERPTS = 5;

/** Room for a short answer after any reasoning the model does first. */
const MAX_OUTPUT_TOKENS = 4_000;

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The analysed bytes of a file, as text, or null when they cannot be had or do not match. */
async function analysedText(analysis: AnalysisRef, file: { path: string; hash: string | null }): Promise<string | null> {
  if (!file.hash) return null;
  const bytes = await fetchFileAt(analysis.repo, analysis.commit, file.path);
  if (!bytes || createHash("sha256").update(bytes).digest("hex") !== file.hash) return null;
  return bytes.toString("utf8");
}

/** Opening lines for each file that can be fetched; a neighbour that cannot is simply listed without them. */
async function excerptsOf(analysis: AnalysisRef, files: readonly NeighbourFile[]): Promise<Map<string, string>> {
  const texts = await Promise.all(files.map((f) => analysedText(analysis, f).catch(() => null)));
  return new Map(files.flatMap((f, i) => (texts[i] === null ? [] : [[f.path, texts[i]] as const])));
}

function settingOf(analysis: AnalysisRef): Setting {
  return {
    repository: `${analysis.repo.owner}/${analysis.repo.name}`,
    framework: analysis.framework,
    commit: analysis.commit,
  };
}

async function write(
  input: Request,
  subject: "file" | "folder",
  key: string,
  instructions: string,
  prompt: string,
): Promise<Written> {
  const model = MODELS.explain;
  const response = await ai().responses.create({
    model,
    instructions,
    input: prompt,
    reasoning: { effort: "low" },
    max_output_tokens: MAX_OUTPUT_TOKENS,
  });
  const body = response.output_text.trim();
  if (!body) {
    throw new ExplainError(
      response.status === "incomplete"
        ? "The model ran out of room before it wrote anything. Try again."
        : "The model answered with nothing.",
    );
  }
  await writeExplanation(input.admin, { orgId: input.analysis.orgId, key, subject, model, body });
  return { body, model, cached: false };
}

const traceInputs = (analysis: AnalysisRef) => ({
  analysis: analysis.id,
  repository: `${analysis.repo.owner}/${analysis.repo.name}`,
  commit: analysis.commit,
});

export const explainFile = traced(
  "explain file",
  async (input: Request & { path: string }): Promise<Written> => {
    const { db, analysis, path } = input;
    const hood = await loadNeighbourhood(db, analysis.id, [path]);
    const file = hood.files.find((f) => f.member);
    if (!file) throw new ExplainError(`${path} is not a file in this analysis.`);

    const byPath = new Map(hood.files.map((f) => [f.path, f]));
    const imports = hood.pairs.filter(([s]) => s === path).map(([, t]) => byPath.get(t)!);
    const importedBy = hood.pairs.filter(([, t]) => t === path).map(([s]) => byPath.get(s)!);

    // Everything that decides the answer. Neighbours' hashes are in it
    // because their opening lines are shown.
    const model = MODELS.explain;
    const key = cacheKey([
      "explain file",
      PROMPT_VERSIONS.file,
      model,
      analysis.framework,
      [file.path, file.hash, file.role],
      imports.map((f) => [f.path, f.hash, f.role]),
      importedBy.map((f) => [f.path, f.hash, f.role]),
    ]);
    const cached = await readExplanation(db, analysis.orgId, key);
    if (cached) return { ...cached, cached: true };

    const text = await analysedText(analysis, file);
    if (text === null) {
      throw new ExplainError(
        file.hash
          ? `${path} at ${analysis.commit.slice(0, 7)} could not be fetched from GitHub, or no longer matches what was parsed.`
          : `${path} could not be read when it was analysed, so there is no code to explain it from.`,
      );
    }
    const mostUsed = (files: readonly NeighbourFile[], n: number) =>
      [...files].sort((a, b) => b.fanIn - a.fanIn || byString(a.path, b.path)).slice(0, n);
    const excerpts = await excerptsOf(analysis, [
      ...mostUsed(imports, FILE_EXCERPTS.imports),
      ...mostUsed(importedBy, FILE_EXCERPTS.importedBy),
    ]);

    const prompt = fileInput(settingOf(analysis), file, imports, importedBy, text, excerpts);
    return write(input, "file", key, FILE_INSTRUCTIONS, prompt);
  },
  {
    run_type: "chain",
    processInputs: (inputs) => ({ ...traceInputs(inputs.analysis), path: inputs.path }),
  },
);

export const explainFolder = traced(
  "explain folder",
  async (input: Request & { dir: string }): Promise<Written> => {
    const { db, analysis, dir } = input;
    // The folder as the map draws it: the same fold, from the same stored files.
    const fold = foldRepository(await loadFilePlaces(db, analysis.id));
    const paths = fold.groups.get(dir);
    if (!paths) throw new ExplainError(`${dir} is not a folder on this analysis's map.`);

    const hood = await loadNeighbourhood(db, analysis.id, paths);
    const inside = new Set(paths);
    const members = hood.files.filter((f) => f.member);
    const importers = new Map<string, string[]>();
    const outsidePaths = new Set<string>();
    let internal = 0;
    for (const [source, target] of hood.pairs) {
      if (inside.has(source) && inside.has(target)) internal++;
      else if (inside.has(target)) importers.set(target, [...(importers.get(target) ?? []), source]);
      else outsidePaths.add(target);
    }
    const outside = hood.files.filter((f) => outsidePaths.has(f.path));

    const model = MODELS.explain;
    const key = cacheKey([
      "explain folder",
      PROMPT_VERSIONS.folder,
      model,
      analysis.framework,
      dir,
      members.map((f) => [f.path, f.hash, f.role]),
      outside.map((f) => [f.path, f.role]),
      hood.pairs,
    ]);
    const cached = await readExplanation(db, analysis.orgId, key);
    if (cached) return { ...cached, cached: true };

    const mostImported = [...members]
      .filter((f) => importers.has(f.path))
      .sort((a, b) => importers.get(b.path)!.length - importers.get(a.path)!.length || byString(a.path, b.path))
      .slice(0, FOLDER_EXCERPTS);
    const excerpts = await excerptsOf(analysis, mostImported.length > 0 ? mostImported : members.slice(0, FOLDER_EXCERPTS));

    const prompt = folderInput(settingOf(analysis), { dir, members, importers, outside, internal }, excerpts);
    return write(input, "folder", key, FOLDER_INSTRUCTIONS, prompt);
  },
  {
    run_type: "chain",
    processInputs: (inputs) => ({ ...traceInputs(inputs.analysis), folder: inputs.dir }),
  },
);
