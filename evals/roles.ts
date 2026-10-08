// Role accuracy: how often the labeller names the role a file really has.
//
//   pnpm eval:roles --build   parse the pinned repositories and (re)write the dataset
//   pnpm eval:roles           run the labeller over it, as an experiment
//
// The ground truth is convention. Where an adapter assigns a role it is
// certain (a NestJS `*.service.ts`, an Express `models/` file, a React
// `useThing` hook), and those files never reach the model in normal
// operation: the pipeline only asks about files no convention named. That
// makes them a held-out set with real answers. Each is asked about exactly as
// the pipeline would ask (same candidate building, same prompt, same call),
// with its role hidden, and the answer compared.
//
// Only roles the labeller is allowed to give are in the set. Convention also
// knows controllers and pages; scoring the labeller on answers it is
// forbidden to give would measure nothing.
//
// Read the number with one caveat: a file convention can name usually says
// so in its path, and the model sees the path, as it does in production. The
// files it labels for real are the ones whose paths did not give them away,
// so this is an upper bound on how it does there, not an estimate of it.

import "../lib/scripts/env.ts";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { evaluate } from "langsmith/evaluation";
import type { KVMap } from "langsmith/schemas";
import { MODELS } from "../lib/ai/client.ts";
import { askRoles } from "../lib/explain/label.ts";
import { PROMPT_VERSIONS } from "../lib/explain/prompt.ts";
import { isModelRole, MODEL_ROLES } from "../lib/explain/types.ts";
import { ADAPTERS } from "../lib/parser/adapters/index.ts";
import { parseWalk, walkRepository } from "../lib/parser/index.ts";
import { downloadArchive, type RepositoryRef } from "../lib/pipeline/github.ts";
import { labelCandidates } from "../lib/pipeline/run.ts";
import { bootstrap, pct, replaceDataset, scoreOf } from "./shared.ts";

const DATASET = "cartograph: roles held out by convention";

/**
 * Repositories whose conventions name roles the labeller may give, at exact
 * commits, so the dataset rebuilds the same every time.
 */
const SOURCES: (RepositoryRef & { sha: string })[] = [
  { owner: "lujakob", name: "nestjs-realworld-example-app", sha: "c1c2cc4e448b279ff083272df1ac50d20c3304fa" },
  { owner: "hagopj13", name: "node-express-boilerplate", sha: "179ae84efec61b14206d0305d941daed6c6d07f9" },
  { owner: "shadcn-ui", name: "taxonomy", sha: "298a8857c7128a0d121e7f699dfd729f23b3966d" },
  { owner: "mah9ah", name: "interview-prep-app", sha: "0157d7b60504099f6c0d4eeb6d92d93162232766" },
];

/** Fewer files than this and a percentage says little; the build refuses rather than write a thin dataset. */
const MIN_FILES = 30;

/** At most this many files per role from one repository, so no one folder of components is the whole score. */
const PER_ROLE = 8;

const { values } = parseArgs({ options: { build: { type: "boolean", default: false } } });

/** Spread across a folder rather than its first few paths, the same way every time. */
const spread = (p: string) => createHash("sha256").update(p).digest("hex");

async function build() {
  const examples = [];
  for (const source of SOURCES) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cartograph-eval-"));
    try {
      await downloadArchive(source, source.sha, directory);
      const result = parseWalk(walkRepository(directory), { adapters: ADAPTERS });
      const roleOf = new Map(result.files.map((f) => [f.path, f.role]));
      const held = labelCandidates(result, directory, (f) => f.role !== null && isModelRole(f.role));

      const byRole = new Map<string, typeof held>();
      for (const c of held) byRole.set(roleOf.get(c.path)!, [...(byRole.get(roleOf.get(c.path)!) ?? []), c]);
      const counts: string[] = [];
      for (const [role, files] of byRole) {
        const kept = [...files].sort((a, b) => (spread(a.path) < spread(b.path) ? -1 : 1)).slice(0, PER_ROLE);
        counts.push(`${role} ${kept.length}${files.length > kept.length ? ` of ${files.length}` : ""}`);
        for (const c of kept) {
          examples.push({
            inputs: { path: c.path, text: c.text, imports: c.imports, importedBy: c.importedBy },
            outputs: { role },
            metadata: { repository: `${source.owner}/${source.name}`, commit: source.sha, adapter: result.adapter },
          });
        }
      }
      console.log(`${source.owner}/${source.name}  ${result.adapter}  ${counts.join(", ") || "nothing eligible"}`);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
  if (examples.length < MIN_FILES) {
    throw new Error(
      `Only ${examples.length} files have a role convention assigns and the labeller may give; ` +
        `at least ${MIN_FILES} are needed. Add a repository to SOURCES. The dataset was left as it was.`,
    );
  }
  await replaceDataset(
    DATASET,
    "Files whose role a framework convention assigns with certainty, restricted to roles the labeller may give. The role is hidden from the model and compared with its answer.",
    examples,
  );
  console.log(`\nwrote ${examples.length} examples to "${DATASET}"`);
}

async function run() {
  const results = await evaluate(
    async (inputs: Record<string, unknown>) => {
      const subject = inputs as { path: string; text: string; imports: string[]; importedBy: string[] };
      // One file per call here, where the pipeline asks twenty at once: each
      // example is scored on its own.
      const roles = await askRoles([subject]);
      return { role: roles.get(subject.path) ?? null };
    },
    {
      data: DATASET,
      evaluators: [
        ({ outputs, referenceOutputs }: { outputs: KVMap; referenceOutputs?: KVMap }) => ({
          key: "role_correct",
          score: outputs.role === referenceOutputs?.role ? 1 : 0,
          comment: `convention says ${referenceOutputs?.role}; the model said ${outputs.role ?? "nothing"}`,
        }),
      ],
      experimentPrefix: `roles ${MODELS.label}`,
      description: `The labeller (prompt v${PROMPT_VERSIONS.label}) on files convention already named, with the role hidden.`,
      metadata: { model: MODELS.label, prompt_version: PROMPT_VERSIONS.label },
      maxConcurrency: 4,
    },
  );

  const rows = results.results;
  const correct = rows.map((r) => scoreOf(r, "role_correct") ?? 0);
  const { mean, low, high } = bootstrap(correct);
  console.log(`\nROLE ACCURACY  ${results.experimentName}`);
  console.log(`  files          ${rows.length}`);
  console.log(`  correct        ${correct.filter(Boolean).length} of ${rows.length}`);
  console.log(`  accuracy       ${pct(mean)}  (95% interval ${pct(low)} to ${pct(high)})`);

  console.log(`\n  by true role   correct / files   the model said instead`);
  for (const role of MODEL_ROLES) {
    const these = rows.filter((r) => r.example.outputs?.role === role);
    if (these.length === 0) continue;
    const wrong = new Map<string, number>();
    for (const r of these) {
      const said = (r.run.outputs?.role as string | null) ?? "nothing";
      if (said !== role) wrong.set(said, (wrong.get(said) ?? 0) + 1);
    }
    const right = these.length - [...wrong.values()].reduce((a, b) => a + b, 0);
    const instead = [...wrong].map(([said, n]) => `${said} ×${n}`).join(", ");
    console.log(`  ${role.padEnd(14)} ${String(right).padStart(3)} / ${String(these.length).padEnd(9)} ${instead}`);
  }
}

(values.build ? build() : run()).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
