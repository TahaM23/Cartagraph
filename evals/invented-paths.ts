// The invented-path check, run over real explanations.
//
//   pnpm eval:paths [--days 14] [--limit 200] [--record] [--splice [path]]
//
// Reads the model calls recent explanations made from the traces (the prompt
// the model was given and the answer it wrote) and checks each answer against
// the paths in its prompt (lib/explain/invented.ts): the same check the app
// runs live on every new answer, applied to everything already traced,
// including answers written before the live check existed.
//
// Each failure is printed with the sentence it is in and a link to its trace,
// where the prompt shows what was shown.
//
// --record scores the traced runs that have no score yet, as the live check
//          would have.
// --splice also proves the check catches what it is for: a made-up filename
//          is spliced into every answer, three ways, and each must be caught.
//          Give a path to splice that one instead of one made up per answer.

import "../lib/scripts/env.ts";
import { parseArgs } from "node:util";
import { checkPaths, describeCheck, PATHS_GROUNDED, shownPaths, type Shown } from "../lib/explain/invented.ts";
import { langsmith, pct, responseText, tracingProject } from "./shared.ts";

// `--splice` takes an optional path, which parseArgs cannot express: a
// value after it that is not a flag is taken out here.
const argv = process.argv.slice(2);
const spliceAt = argv.indexOf("--splice");
const splicePath = spliceAt !== -1 && argv[spliceAt + 1] && !argv[spliceAt + 1].startsWith("--") ? argv.splice(spliceAt + 1, 1)[0] : null;

const { values } = parseArgs({
  args: argv,
  options: {
    days: { type: "string", default: "14" },
    limit: { type: "string", default: "200" },
    record: { type: "boolean", default: false },
    splice: { type: "boolean", default: false },
  },
});

/** One model call: where it was traced, what went in, what came out. */
interface Answer {
  id: string;
  traceId: string;
  projectId: string;
  startTime: string;
  prompt: string;
  body: string;
}

/** The model calls made inside explain runs, newest first, with what went in and what came out. */
async function recentAnswers(days: number, limit: number): Promise<Answer[]> {
  const ls = langsmith();
  const project = await ls.readProject({ projectName: tracingProject() });
  const answers: Answer[] = [];
  for await (const run of ls.runs.query({
    project_ids: [project.id],
    run_type: "LLM",
    min_start_time: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
    trace_filter: 'or(eq(name, "explain file"), eq(name, "explain folder"))',
    has_error: false,
    selects: ["ID", "TRACE_ID", "PROJECT_ID", "START_TIME", "INPUTS", "OUTPUTS"],
    page_size: 100,
  })) {
    const prompt = run.inputs?.input;
    const body = responseText(run.outputs);
    if (typeof prompt === "string" && body && run.id && run.trace_id) {
      answers.push({
        id: run.id,
        traceId: run.trace_id,
        projectId: run.project_id ?? project.id,
        startTime: run.start_time ?? "",
        prompt,
        body,
      });
    }
    if (answers.length >= limit) break;
  }
  return answers;
}

async function traceUrl(a: Answer): Promise<string> {
  const { url } = await langsmith().runs.getURL(a.id, { project_id: a.projectId, trace_id: a.traceId, start_time: a.startTime });
  return url ?? `run ${a.id}`;
}

/** The sentence `token` first appears in, to read it in place. */
function sentenceWith(body: string, token: string): string {
  const at = body.indexOf(token);
  if (at === -1) return "";
  const start = Math.max(body.lastIndexOf(". ", at) + 2, body.lastIndexOf("\n", at) + 1, 0);
  const ends = [body.indexOf(". ", at + token.length), body.indexOf("\n", at)].filter((i) => i !== -1);
  return body.slice(start, ends.length > 0 ? Math.min(...ends) + 1 : body.length).trim();
}

/** Scores each root run that has no score under the key yet. */
async function record(answers: readonly Answer[]) {
  const ls = langsmith();
  const roots = [...new Map(answers.map((a) => [a.traceId, a])).values()];
  const scored = new Set<string>();
  for await (const f of ls.listFeedback({ runIds: roots.map((a) => a.traceId), feedbackKeys: [PATHS_GROUNDED] })) {
    if (f.run_id) scored.add(f.run_id);
  }
  let written = 0;
  for (const a of roots) {
    if (scored.has(a.traceId)) continue;
    const shown = shownPaths(a.prompt);
    const check = checkPaths(a.body, shown);
    await ls.createFeedback({
      runId: a.traceId,
      sessionId: a.projectId,
      key: PATHS_GROUNDED,
      score: check.score,
      comment: describeCheck(check, shown),
      feedbackSourceType: "app",
    });
    written++;
  }
  console.log(`\nrecorded ${written} score(s); ${roots.length - written} run(s) were already scored`);
}

/** Made-up names, none of which any of these repositories is likely to have. */
const FAKE_NAMES = ["quantumLedger", "cartographRetryPolicy", "phantom-session-store"];

/** A path no prompt showed: a real folder of this prompt, a made-up file in it. */
function inventFor(shown: Shown, n: number): string {
  const real = [...shown.listed].filter((p) => p.includes("/")).sort()[0] ?? "src/index.ts";
  const dir = real.slice(0, real.lastIndexOf("/"));
  const ext = /\.[a-z]+$/.exec(real)?.[0] ?? ".ts";
  let path = `${dir}/${FAKE_NAMES[n % FAKE_NAMES.length]}${ext}`;
  while (shown.listed.has(path) || shown.quoted.has(path)) path = path.replace(ext, `-x${ext}`);
  return path;
}

function splice(answers: readonly Answer[]): boolean {
  const ways: [string, (body: string, fake: string) => string][] = [
    ["full path, in backticks", (body, fake) => `${body}\n\nIt also hands its results to \`${fake}\`.`],
    ["full path, in prose", (body, fake) => body.replace(/\.(\s|$)/, `, and it is wrapped by ${fake}.$1`)],
    ["file name alone", (body, fake) => `- Configured through \`${fake.slice(fake.lastIndexOf("/") + 1)}\`.\n${body}`],
  ];
  let caught = 0;
  let total = 0;
  const missed: string[] = [];
  for (const [i, a] of answers.entries()) {
    const shown = shownPaths(a.prompt);
    const fake = splicePath ?? inventFor(shown, i);
    if (shown.listed.has(fake) || shown.quoted.has(fake)) {
      console.log(`  skipped ${a.id}: ${fake} was shown to it, so naming it is not an invention`);
      continue;
    }
    for (const [way, apply] of ways) {
      total++;
      const name = way === "file name alone" ? fake.slice(fake.lastIndexOf("/") + 1) : fake;
      if (checkPaths(apply(a.body, fake), shown).invented.includes(name)) caught++;
      else missed.push(`${a.id}  ${way}: ${fake}`);
    }
  }
  console.log(`\nSPLICED  a made-up file named in each answer, ${ways.length} ways`);
  console.log(`  caught ${caught} of ${total}`);
  for (const m of missed) console.log(`  MISSED  ${m}`);
  return missed.length === 0;
}

async function main() {
  const days = Number(values.days);
  const limit = Number(values.limit);
  const answers = await recentAnswers(days, limit);
  console.log(`project  ${tracingProject()}`);
  console.log(`window   last ${days} day(s), at most ${limit} model calls`);
  if (answers.length === 0) {
    console.log("\nNo explanations were written in that window. Explain a file or two in the app, or widen --days.");
    return;
  }

  const failures: { answer: Answer; invented: string[]; listed: string[] }[] = [];
  let named = 0;
  for (const a of answers) {
    const shown = shownPaths(a.prompt);
    const check = checkPaths(a.body, shown);
    named += check.mentioned.length;
    if (check.score === 0) failures.push({ answer: a, invented: check.invented, listed: [...shown.listed].sort() });
  }
  const grounded = answers.length - failures.length;
  console.log(`\nINVENTED-PATH CHECK  deterministic: set membership, no model`);
  console.log(`  explanations     ${answers.length}`);
  console.log(`  paths named      ${named}`);
  console.log(`  grounded         ${grounded} of ${answers.length}  (${pct(grounded / answers.length)})  ← the score`);
  console.log(`  naming invented  ${failures.length}`);

  for (const { answer, invented, listed } of failures) {
    console.log(`\n  ${await traceUrl(answer)}`);
    console.log(`  ${answer.startTime}`);
    for (const path of invented) {
      console.log(`    invented  ${path}`);
      console.log(`      "${sentenceWith(answer.body, path)}"`);
    }
    console.log(`    the ${listed.length} path(s) it was shown:`);
    for (const p of listed) console.log(`      ${p}`);
  }

  if (values.record) await record(answers);
  if (values.splice && !splice(answers)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
