// Run the pipeline from a terminal.
//
//   pnpm analyse <github url> --dry-run [--out result.json]
//   pnpm analyse <github url> --org org_... [--rerun]
//
// --dry-run fetches, selects and parses with no database and prints what would
// be stored. Otherwise the repository's analysis is found or created in the
// organization (with the secret key, so there is no session to check it
// against: pass an organization you belong to) and run if it is new, or if
// --rerun asks for it; then the row is read back.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { writeParseResult } from "../parser/io.ts";
import { createAdminSupabase } from "../supabase/admin.ts";
import { parseRepositoryUrl, RunError } from "./github.ts";
import { fetchAndParse, runAnalysis, type RunReporter } from "./run.ts";
import { startAnalysis } from "./start.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "dry-run": { type: "boolean", default: false },
    out: { type: "string" },
    org: { type: "string" },
    rerun: { type: "boolean", default: false },
  },
});

const started = performance.now();
const elapsed = () => `${((performance.now() - started) / 1000).toFixed(1).padStart(5)}s`;

const printer: RunReporter = {
  async stage(stage, message) {
    console.log(`${elapsed()}  ${stage.padEnd(7)} ${message}`);
  },
};

const percent = (part: number, whole: number) => (whole === 0 ? "—" : `${((100 * part) / whole).toFixed(1)}%`);

async function dryRun(url: string) {
  const repo = parseRepositoryUrl(url);
  if (!repo) throw new RunError(`"${url}" is not a GitHub repository URL.`);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cartograph-"));
  try {
    const { sha, result } = await fetchAndParse(repo, directory, printer);
    const { files, imports } = result.coverage;
    const resolvable = imports.total - imports.external;
    console.log(`${elapsed()}  done    would store:`);
    console.log(`  commit      ${sha}`);
    console.log(`  adapter     ${result.adapter}`);
    console.log(`  files       ${files.found} found, ${files.parsed} parsed, ${files.skipped} skipped`);
    console.log(`  edges       ${result.edges.length}`);
    console.log(`  roles       ${result.files.filter((f) => f.role).length}`);
    console.log(
      `  imports     ${imports.internal} of ${resolvable} non-external resolved (${percent(imports.internal, resolvable)}); ` +
        `${imports.unresolved} unresolved, ${imports.excluded} excluded`,
    );
    const leaked = JSON.stringify(result).split(directory).length - 1;
    console.log(`  temp path   appears ${leaked} time(s) in the result (only "root" is expected)`);
    if (values.out) {
      writeParseResult(values.out, result);
      console.log(`  wrote       ${path.resolve(values.out)}`);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function live(url: string, orgId: string) {
  const repo = parseRepositoryUrl(url);
  if (!repo) throw new RunError(`"${url}" is not a GitHub repository URL.`);
  const db = createAdminSupabase();

  const { id, created } = await startAnalysis(db, orgId, repo);
  console.log(`analysis ${id} (${created ? "new" : "existing"})`);
  if (created || values.rerun) {
    await runAnalysis(db, id);
  } else {
    console.log("already analysed; pass --rerun to run it again");
  }

  const { data, error } = await db
    .from("analyses")
    .select("status, stage, stage_message, error, commit_sha, files_total, files_parsed, edge_count")
    .eq("id", id)
    .single();
  if (error) throw new Error(`Reading the analysis back failed: ${error.message}`);
  console.log(`${elapsed()}  ${JSON.stringify(data, null, 2)}`);
  if (data.status === "failed") process.exitCode = 1;
}

async function main() {
  const url = positionals[0];
  if (!url || (!values["dry-run"] && !values.org)) {
    console.error("usage: pnpm analyse <github url> --dry-run [--out result.json]");
    console.error("       pnpm analyse <github url> --org org_... [--rerun]");
    process.exit(2);
  }
  try {
    if (values["dry-run"]) await dryRun(url);
    else await live(url, values.org!);
  } catch (error) {
    console.error(`${elapsed()}  failed  ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

main();
