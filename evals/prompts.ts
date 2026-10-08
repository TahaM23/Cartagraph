// Two versions of the file-explanation prompt, side by side.
//
//   pnpm eval:prompts --build   (re)write the dataset from real analyses
//   pnpm eval:prompts           run both versions over it and compare them
//
// The dataset is real: files of analysed repositories, each with the exact
// input the app would give the model to explain it (neighbours, code and
// excerpts at the analysed commit). Both versions get the same inputs and the
// same model, so the only difference between them is the instructions.
//
// Each version runs as its own experiment, so LangSmith shows them side by
// side in its comparison view. Scores, per explanation:
//   paths_grounded      1 when it names no path it was not shown. Code.
//   format_permitted    1 when it keeps to what the pane renders. Code.
//   words               how long it is. Code, and not a quality score.
//   judged_specificity  is it specific enough to be useful, 0 to 1. A model's
//                       opinion (judge.ts): there is no exact answer to that.
// Then the two are compared explanation by explanation: the difference on
// each score, with an interval, and how often each version was judged better.

import "../lib/scripts/env.ts";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { evaluate, type ExperimentResultRow } from "langsmith/evaluation";
import type { KVMap } from "langsmith/schemas";
import { MODELS } from "../lib/ai/client.ts";
import { kindOf } from "../lib/canvas/categories.ts";
import { fileExplanationInput, generateExplanation, type AnalysisRef } from "../lib/explain/explain.ts";
import { checkPaths, describeCheck, PATHS_GROUNDED, shownPaths } from "../lib/explain/invented.ts";
import { FILE_INSTRUCTIONS, PROMPT_VERSIONS } from "../lib/explain/prompt.ts";
import { taxonomyOf } from "../lib/parser/adapters/taxonomy.ts";
import { createAdminSupabase } from "../lib/supabase/admin.ts";
import { judgeSpecificity, JUDGE_MODEL, RUBRIC_VERSION } from "./judge.ts";
import { FILE_INSTRUCTIONS_V0 } from "./prompts/file-v0.ts";
import { bootstrap, langsmith, mean, replaceDataset, scoreOf } from "./shared.ts";

const DATASET = "cartograph: file explanations";

const VERSIONS = [
  { version: PROMPT_VERSIONS.file, label: "current", instructions: FILE_INSTRUCTIONS },
  { version: 0, label: "retired", instructions: FILE_INSTRUCTIONS_V0 },
] as const;

/** Files taken from one analysis, so no one repository is the whole dataset. */
const PER_ANALYSIS = 5;
/** Fewer neighbours than this and there is little context to be specific about. */
const MIN_DEGREE = 2;

const { values } = parseArgs({ options: { build: { type: "boolean", default: false } } });

const spread = (p: string) => createHash("sha256").update(p).digest("hex");

async function build() {
  const db = createAdminSupabase();
  const { data: analyses, error } = await db
    .from("analyses")
    .select("id, org_id, commit_sha, adapter, project:projects(repo_owner, repo_name)")
    .eq("status", "complete")
    .not("commit_sha", "is", null)
    .order("created_at");
  if (error) throw new Error(`Reading analyses failed: ${error.message}`);

  const examples = [];
  for (const row of analyses) {
    if (!row.project || !row.commit_sha) continue;
    const analysis: AnalysisRef = {
      id: row.id,
      orgId: row.org_id,
      commit: row.commit_sha,
      repo: { owner: row.project.repo_owner, name: row.project.repo_name },
      framework: taxonomyOf(row.adapter ?? "")?.framework ?? null,
    };
    const repository = `${analysis.repo.owner}/${analysis.repo.name}`;
    const { data: files, error: filesError } = await db
      .from("files")
      .select("path, folder, fan_in, fan_out")
      .eq("analysis_id", row.id)
      .eq("parsed", true)
      .not("hash", "is", null);
    if (filesError) throw new Error(`Reading ${repository}'s files failed: ${filesError.message}`);

    const eligible = files
      .filter((f) => f.fan_in + f.fan_out >= MIN_DEGREE && kindOf(f) === "source")
      .sort((a, b) => (spread(a.path) < spread(b.path) ? -1 : 1));
    let taken = 0;
    let failed = 0;
    for (const f of eligible) {
      if (taken >= PER_ANALYSIS) break;
      try {
        const prompt = await fileExplanationInput(db, analysis, f.path);
        examples.push({ inputs: { prompt, path: f.path, repository }, metadata: { analysis: row.id, commit: row.commit_sha } });
        taken++;
      } catch {
        // Not fetchable at the analysed commit (a seeded analysis has no real one).
        if (++failed >= 3 && taken === 0) break;
      }
    }
    console.log(`${repository.padEnd(45)} ${taken} file(s)${taken === 0 ? "  (code not fetchable at the analysed commit)" : ""}`);
  }
  await replaceDataset(
    DATASET,
    "Real files of analysed repositories, each with the exact input the app gives the model to explain it.",
    examples,
  );
  console.log(`\nwrote ${examples.length} examples to "${DATASET}"`);
}

// --- Scores ------------------------------------------------------------------

type Args = { inputs: KVMap; outputs: KVMap };

const grounded = ({ inputs, outputs }: Args) => {
  const shown = shownPaths(inputs.prompt);
  const check = checkPaths(outputs.explanation, shown);
  return { key: PATHS_GROUNDED, score: check.score, comment: describeCheck(check, shown) };
};

/** The pane renders inline code, bullets and bold. Anything else is lost on the way to the screen. */
const FORBIDDEN: [string, RegExp][] = [
  ["heading", /^\s*#{1,6}\s/m],
  ["code block", /^\s*(```|~~~)/m],
  ["table", /^\s*\|.*\|\s*$/m],
  ["link", /\]\([^)]*\)/],
];
const formatPermitted = ({ outputs }: Args) => {
  const found = FORBIDDEN.filter(([, re]) => re.test(outputs.explanation)).map(([name]) => name);
  return { key: "format_permitted", score: found.length === 0 ? 1 : 0, comment: found.length ? `uses: ${found.join(", ")}` : "" };
};

const words = ({ outputs }: Args) => ({
  key: "words",
  score: String(outputs.explanation).split(/\s+/).filter(Boolean).length,
});

const judged = async ({ inputs, outputs }: Args) => {
  const verdict = await judgeSpecificity(inputs.prompt, outputs.explanation);
  return {
    key: "judged_specificity",
    score: (verdict.score - 1) / 4,
    comment: `Model-judged ${verdict.score}/5 by ${JUDGE_MODEL}: ${verdict.reasoning}`,
  };
};

// --- Running and comparing ---------------------------------------------------

async function experiment(v: (typeof VERSIONS)[number]) {
  return evaluate(async (inputs: KVMap) => ({ explanation: await generateExplanation(v.instructions, inputs.prompt) }), {
    data: DATASET,
    evaluators: [grounded, formatPermitted, words, judged],
    experimentPrefix: `explain file v${v.version}`,
    description: `The ${v.label} file-explanation prompt (v${v.version}) on ${MODELS.explain}.`,
    metadata: {
      prompt_version: v.version,
      model: MODELS.explain,
      judge: JUDGE_MODEL,
      rubric_version: RUBRIC_VERSION,
    },
    maxConcurrency: 4,
  });
}

const fixed = (x: number, digits = 2) => (Number.isNaN(x) ? "—" : x.toFixed(digits));
const signed = (x: number, digits = 2) => `${x >= 0 ? "+" : ""}${fixed(x, digits)}`;

function compare(
  current: { name: string; rows: ExperimentResultRow[] },
  retired: { name: string; rows: ExperimentResultRow[] },
) {
  const before = new Map(retired.rows.map((r) => [r.example.id, r]));
  const pairs = current.rows.flatMap((r) => (before.has(r.example.id) ? [[r, before.get(r.example.id)!] as const] : []));

  console.log(`\nPROMPT VERSIONS  ${pairs.length} files, each explained by both`);
  console.log(`  v${VERSIONS[0].version} (current)  ${current.name}`);
  console.log(`  v${VERSIONS[1].version} (retired)  ${retired.name}\n`);
  console.log(
    `  ${"score".padEnd(20)}${`v${VERSIONS[0].version}`.padStart(8)}  ${`v${VERSIONS[1].version}`.padStart(8)}   difference (95% interval)`,
  );

  const rows: [string, string, number][] = [
    [PATHS_GROUNDED, "code", 2],
    ["format_permitted", "code", 2],
    ["words", "code", 0],
    ["judged_specificity", "MODEL-JUDGED", 2],
  ];
  for (const [key, how, digits] of rows) {
    const a: number[] = [];
    const b: number[] = [];
    for (const [x, y] of pairs) {
      const sx = scoreOf(x, key);
      const sy = scoreOf(y, key);
      if (sx !== null && sy !== null) {
        a.push(sx);
        b.push(sy);
      }
    }
    const diff = bootstrap(a.map((v, i) => v - b[i]));
    console.log(
      `  ${key.padEnd(20)}${fixed(mean(a), digits).padStart(8)}  ${fixed(mean(b), digits).padStart(8)}   ` +
        `${signed(diff.mean, digits)}  (${signed(diff.low, digits)} to ${signed(diff.high, digits)})  ${how}`,
    );
  }

  // The judged score, read as the grader gave it: points out of five, and who won each file.
  let wins = 0;
  let ties = 0;
  let losses = 0;
  for (const [x, y] of pairs) {
    const sx = scoreOf(x, "judged_specificity");
    const sy = scoreOf(y, "judged_specificity");
    if (sx === null || sy === null) continue;
    if (sx > sy) wins++;
    else if (sx < sy) losses++;
    else ties++;
  }
  const points = (rs: ExperimentResultRow[]) => mean(rs.map((r) => scoreOf(r, "judged_specificity")).filter((s) => s !== null).map((s) => 1 + 4 * s!));
  console.log(
    `\n  judged, out of 5     v${VERSIONS[0].version} ${fixed(points(pairs.map(([x]) => x)))}   v${VERSIONS[1].version} ${fixed(points(pairs.map(([, y]) => y)))}` +
      `   v${VERSIONS[0].version} judged better on ${wins}, worse on ${losses}, the same on ${ties}`,
  );
  console.log(
    "\n  The code-checked rows are exact. judged_specificity is one model's opinion of another's\n" +
      "  writing, on a rubric (evals/judge.ts): a direction and a rough size, not a measurement.\n" +
      "  An interval that crosses zero means these files cannot tell the two versions apart.",
  );
}

async function run() {
  const ls = langsmith();
  const results = [];
  for (const v of VERSIONS) {
    const r = await experiment(v);
    results.push({ name: r.experimentName, rows: r.results });
  }
  compare(results[0], results[1]);

  const dataset = await ls.readDataset({ datasetName: DATASET });
  const sessions = await Promise.all(results.map((r) => ls.readProject({ projectName: r.name }).then((p) => p.id)));
  const datasetUrl = await ls.getDatasetUrl({ datasetId: dataset.id });
  console.log(`\n  side by side: ${datasetUrl}/compare?selectedSessions=${sessions.join("%2C")}`);
}

(values.build ? build() : run()).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
