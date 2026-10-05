// The run: fetch, select, parse, store.
//
// Each stage is written to the analysis row as it starts, with a message
// naming what it is doing. Everything sits under one catch that writes a
// failed state, the stage it failed in and why, so a run that throws never
// leaves a row saying "parsing" forever. (A process that dies outright still
// can; the dashboard tells those apart by how long ago the stage last moved.)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { docusaurusAdapter } from "../parser/adapters/docusaurus.ts";
import { nextAdapter } from "../parser/adapters/next.ts";
import { viteAdapter } from "../parser/adapters/vite.ts";
import { checkInvariants, parseWalk, ParseResult, walkRepository } from "../parser/index.ts";
import type { AdminSupabase } from "../supabase/admin.ts";
import type { Database } from "../supabase/database.types.ts";
import { downloadArchive, resolveCommit, RunError, type RepositoryRef } from "./github.ts";
import type { Stage } from "./stages.ts";


/** More source files than this and the run stops rather than parse part of them. */
export const MAX_SOURCE_FILES = 5000;

const ADAPTERS = [nextAdapter, docusaurusAdapter, viteAdapter];

const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** Reports each stage as it starts. The pipeline's only view of the outside. */
export interface RunReporter {
  stage(stage: Stage, message: string): Promise<void>;
}

/**
 * Fetch, select and parse, with no database: the repository in, a validated
 * parse result out. `directory` is where the archive is extracted; the caller
 * owns it.
 */
export async function fetchAndParse(
  repo: RepositoryRef,
  directory: string,
  report: RunReporter,
  onCommit: (sha: string) => Promise<void> = async () => {},
): Promise<{ sha: string; result: ParseResult }> {
  await report.stage("fetch", `Resolving the latest commit of github.com/${repo.owner}/${repo.name}`);
  const sha = await resolveCommit(repo);
  await onCommit(sha);

  await report.stage("fetch", `Downloading the archive at ${sha.slice(0, 7)}`);
  const bytes = await downloadArchive(repo, sha, directory);

  await report.stage("select", `Selecting source files from a ${(bytes / 1024 / 1024).toFixed(1)} MB archive`);
  const walk = walkRepository(directory);
  if (walk.files.length === 0) {
    throw new RunError("No TypeScript or JavaScript files were found in the repository.");
  }
  if (walk.files.length > MAX_SOURCE_FILES) {
    throw new RunError(
      `The repository has ${count(walk.files.length, "source file")}; a run parses at most ` +
        `${MAX_SOURCE_FILES.toLocaleString("en-US")}.`,
    );
  }

  await report.stage("parse", `Parsing ${count(walk.files.length, "source file")}`);
  const result = parseWalk(walk, { adapters: ADAPTERS });

  // What gets stored is checked the same way as any other read of a result.
  const problems = checkInvariants(ParseResult.parse(result));
  if (problems.length > 0) {
    throw new Error(`The parse result is inconsistent:\n- ${problems.join("\n- ")}`);
  }
  return { sha, result };
}

async function write(
  db: AdminSupabase,
  id: string,
  values: Database["public"]["Tables"]["analyses"]["Update"],
) {
  const { error } = await db.from("analyses").update(values).eq("id", id);
  if (error) throw new Error(`Updating analysis ${id} failed: ${error.message}`);
}

async function repositoryOf(db: AdminSupabase, id: string): Promise<RepositoryRef> {
  const { data, error } = await db
    .from("analyses")
    .select("project:projects(repo_owner, repo_name)")
    .eq("id", id)
    .single();
  if (error) throw new Error(`Reading analysis ${id} failed: ${error.message}`);
  if (!data.project) throw new Error(`Analysis ${id} has no project.`);
  return { owner: data.project.repo_owner, name: data.project.repo_name };
}

/**
 * Runs one analysis end to end. Never throws: any failure is written to the
 * row. Re-running an analysis replaces its graph when the new one is stored.
 */
export async function runAnalysis(db: AdminSupabase, id: string): Promise<void> {
  let current: Stage = "fetch";
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cartograph-"));

  const report: RunReporter = {
    async stage(stage, message) {
      current = stage;
      await write(db, id, { stage, stage_message: message, stage_at: new Date().toISOString() });
    },
  };

  try {
    const now = new Date().toISOString();
    await write(db, id, {
      status: "parsing",
      stage: "fetch",
      stage_message: "Starting",
      stage_at: now,
      started_at: now,
      finished_at: null,
      error: null,
    });

    const repo = await repositoryOf(db, id);
    const { result } = await fetchAndParse(repo, directory, report, (sha) =>
      write(db, id, { commit_sha: sha }),
    );

    await report.stage(
      "store",
      `Storing ${count(result.files.length, "file")} and ${count(result.edges.length, "edge")}`,
    );
    // Graph, coverage and the complete status land in one transaction.
    const { error } = await db.rpc("store_parse_result", {
      target_analysis: id,
      parse_result: result,
    });
    if (error) throw new Error(`Storing the result failed: ${error.message}`);
  } catch (error) {
    const message =
      error instanceof RunError
        ? error.message
        : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
    const failed = await db
      .from("analyses")
      .update({
        status: "failed",
        stage: current,
        error: message,
        stage_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (failed.error) {
      console.error(`analysis ${id} failed in ${current} (${message}), and recording that failed too:`, failed.error);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
