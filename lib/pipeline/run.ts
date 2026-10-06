// The run: fetch, select, parse, store.
//
// Each stage is written to the analysis row as it starts, with a message
// naming what it is doing. Everything sits under one catch that writes a
// failed state, the stage it failed in and why, so a run that throws never
// leaves a row saying "parsing" forever. (A process that dies outright still
// can; the dashboard tells those apart by how long ago the stage last moved.)
//
// A run that has stopped moving can be taken over by a re-run while it is
// still alive. Each run is known by the started_at it writes as it begins,
// and every later write, the store included, applies only while that is
// still the row's: a run that finds it is not stops, and writes nothing more.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ADAPTERS } from "../parser/adapters/index.ts";
import { checkInvariants, parseWalk, ParseResult, walkRepository } from "../parser/index.ts";
import type { AdminSupabase } from "../supabase/admin.ts";
import type { Database } from "../supabase/database.types.ts";
import { downloadArchive, resolveCommit, RunError, type RepositoryRef } from "./github.ts";
import type { Stage } from "./stages.ts";


/** More source files than this and the run stops rather than parse part of them. */
export const MAX_SOURCE_FILES = 5000;

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

/** A newer run has claimed the analysis. Not a failure of this one, and not written as one. */
class Superseded extends Error {}

/** The SQLSTATE store_parse_result raises when the run storing is no longer the analysis's. */
const SUPERSEDED_CODE = "CG409";

/** Updates the analysis while this run, known by `startedAt`, still holds it. */
async function write(
  db: AdminSupabase,
  id: string,
  startedAt: string,
  values: Database["public"]["Tables"]["analyses"]["Update"],
) {
  const { data, error } = await db.from("analyses").update(values).eq("id", id).eq("started_at", startedAt).select("id");
  if (error) throw new Error(`Updating analysis ${id} failed: ${error.message}`);
  if (data.length === 0) throw new Superseded(`Analysis ${id} was claimed by a newer run.`);
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
  // This run's claim on the row; every write after the first is scoped to it.
  const startedAt = new Date().toISOString();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cartograph-"));

  const report: RunReporter = {
    async stage(stage, message) {
      current = stage;
      await write(db, id, startedAt, { stage, stage_message: message, stage_at: new Date().toISOString() });
    },
  };

  try {
    // The claim itself: the one write not scoped to a previous claim.
    const { error: claimError } = await db
      .from("analyses")
      .update({
        status: "parsing",
        stage: "fetch",
        stage_message: "Starting",
        stage_at: startedAt,
        started_at: startedAt,
        finished_at: null,
        error: null,
      })
      .eq("id", id);
    if (claimError) throw new Error(`Updating analysis ${id} failed: ${claimError.message}`);

    const repo = await repositoryOf(db, id);
    const { result } = await fetchAndParse(repo, directory, report, (sha) =>
      write(db, id, startedAt, { commit_sha: sha }),
    );

    await report.stage(
      "store",
      `Storing ${count(result.files.length, "file")}, ${count(result.edges.length, "edge")} and ${count(result.routes.length, "route")}`,
    );
    // Graph, coverage and the complete status land in one transaction.
    const { error } = await db.rpc("store_parse_result", {
      target_analysis: id,
      parse_result: result,
      claimed_started_at: startedAt,
    });
    if (error?.code === SUPERSEDED_CODE) throw new Superseded(error.message);
    if (error) throw new Error(`Storing the result failed: ${error.message}`);
  } catch (error) {
    if (error instanceof Superseded) {
      console.warn(`analysis ${id}: a run started at ${startedAt} stopped in ${current}: ${error.message}`);
      return;
    }
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
      .eq("id", id)
      .eq("started_at", startedAt);
    if (failed.error) {
      console.error(`analysis ${id} failed in ${current} (${message}), and recording that failed too:`, failed.error);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
