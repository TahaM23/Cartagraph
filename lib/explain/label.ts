// Giving a role to files no adapter could identify.
//
// Only roles that decide nothing structural (types.ts): the answer format
// offers no others, anything else that comes back is dropped here, and the
// database refuses it besides. A file none of them fits stays unlabelled.
//
// Each file's label is cached on its own content, so a re-run asks only
// about files that changed, and a run that hits its limit leaves the rest
// for the next run to pick up from the cache onwards.

import { z } from "zod";
import { cacheKey, readRoleLabels, writeRoleLabels } from "../ai/cache.ts";
import { ai, MODELS, traced } from "../ai/client.ts";
import type { AdminSupabase } from "../supabase/admin.ts";
import { LABEL_INSTRUCTIONS, LABEL_NEIGHBOURS, LABEL_SCHEMA, labelInput, PROMPT_VERSIONS, type LabelSubject } from "./prompt.ts";
import { isModelRole, MODEL_ROLES, type ModelRole } from "./types.ts";

export interface LabelCandidate extends LabelSubject {
  hash: string;
}

/** Files asked about in one model call. */
const BATCH = 20;
/** Model calls in flight at once. */
const CONCURRENCY = 4;
/** Files sent to the model in one run; the rest wait for the next. Cached labels do not count. */
export const MAX_LABELLED_PER_RUN = 400;

const Answer = z.object({
  labels: z.array(z.object({ path: z.string(), role: z.enum(MODEL_ROLES).nullable() })),
});

export interface Labelled {
  roles: Map<string, ModelRole>;
  /** Answered from the cache. */
  cached: number;
  /** Sent to the model this run. */
  asked: number;
  /** Over the limit, so not asked this run. */
  deferred: number;
}

const keyOf = (c: LabelCandidate) =>
  cacheKey([
    "label",
    PROMPT_VERSIONS.label,
    MODELS.label,
    c.path,
    c.hash,
    c.imports.slice(0, LABEL_NEIGHBOURS),
    c.importedBy.slice(0, LABEL_NEIGHBOURS),
  ]);

const lookUp = traced(
  "cache lookup",
  async (db: AdminSupabase, orgId: string, keys: string[]) => readRoleLabels(db, orgId, keys),
  {
    run_type: "retriever",
    processInputs: (inputs) => ({ keys: (inputs as { args: [unknown, string, string[]] }).args[2].length }),
    // A returned Map is traced as an iterable: an array of its entries.
    processOutputs: (outputs) => ({ hits: outputs.outputs.length }),
  },
);

async function ask(batch: readonly LabelCandidate[]): Promise<Map<string, ModelRole>> {
  const response = await ai().responses.create({
    model: MODELS.label,
    instructions: LABEL_INSTRUCTIONS,
    input: labelInput(batch),
    reasoning: { effort: "low" },
    text: { format: { type: "json_schema", name: "role_labels", strict: true, schema: LABEL_SCHEMA } },
  });
  const answer = Answer.safeParse(JSON.parse(response.output_text || "{}"));
  const asked = new Set(batch.map((c) => c.path));
  const roles = new Map<string, ModelRole>();
  if (!answer.success) return roles;
  for (const { path, role } of answer.data.labels) {
    // Only the files asked about, and only the roles allowed.
    if (asked.has(path) && role !== null && isModelRole(role)) roles.set(path, role);
  }
  return roles;
}

export const labelFiles = traced(
  "label files",
  async (input: { db: AdminSupabase; orgId: string; candidates: readonly LabelCandidate[] }): Promise<Labelled> => {
    const { db, orgId, candidates } = input;
    const keys = new Map(candidates.map((c) => [c.path, keyOf(c)]));
    const found = await lookUp(db, orgId, [...keys.values()]);

    const roles = new Map<string, ModelRole>();
    const misses: LabelCandidate[] = [];
    for (const c of candidates) {
      const role = found.get(keys.get(c.path)!);
      if (role !== undefined && isModelRole(role)) roles.set(c.path, role);
      else misses.push(c);
    }

    const asking = misses.slice(0, MAX_LABELLED_PER_RUN);
    const batches: LabelCandidate[][] = [];
    for (let i = 0; i < asking.length; i += BATCH) batches.push(asking.slice(i, i + BATCH));

    let next = 0;
    const worker = async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        const answered = await ask(batch);
        await writeRoleLabels(
          db,
          orgId,
          MODELS.label,
          [...answered].map(([path, role]) => ({ key: keys.get(path)!, role })),
        );
        for (const [path, role] of answered) roles.set(path, role);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

    return {
      roles,
      cached: candidates.length - misses.length,
      asked: asking.length,
      deferred: misses.length - asking.length,
    };
  },
  {
    run_type: "chain",
    processInputs: (inputs) => ({ organization: inputs.orgId, files: inputs.candidates.length }),
    processOutputs: (outputs) => {
      const { roles, ...counts } = outputs as Labelled;
      return { ...counts, labelled: roles.size };
    },
  },
);
