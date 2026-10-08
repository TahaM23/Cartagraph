// What every evaluation script needs: LangSmith, where datasets and
// experiments live, and a few ways of reading and summarising results.

import { Client } from "langsmith";
import type { ExperimentResultRow } from "langsmith/evaluation";
import type { KVMap } from "langsmith/schemas";

let client: Client | undefined;

/** LangSmith. Evaluations are recorded there or nowhere, so it is required here, unlike in the app. */
export function langsmith(): Client {
  if (!process.env.LANGSMITH_API_KEY?.trim()) {
    throw new Error("LANGSMITH_API_KEY is not set: evaluations keep their datasets and experiments in LangSmith.");
  }
  client ??= new Client();
  return client;
}

/** The project the app traces into, which is where live traffic is. */
export function tracingProject(): string {
  return process.env.LANGSMITH_PROJECT?.trim() || "default";
}

/**
 * The answer's text from a traced Responses API call. A trace records the
 * response object, and `output_text` is a getter on the SDK's object, not a
 * field of it, so it is rebuilt from the output items.
 */
export function responseText(outputs: KVMap | undefined): string | null {
  if (!outputs) return null;
  if (typeof outputs.output_text === "string") return outputs.output_text;
  const items = Array.isArray(outputs.output) ? outputs.output : [];
  const parts: string[] = [];
  for (const item of items) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const c of item.content) if (c?.type === "output_text" && typeof c.text === "string") parts.push(c.text);
  }
  return parts.length > 0 ? parts.join("") : null;
}

/** Creates the dataset, or empties it, then fills it. Examples are replaced, never merged with stale ones. */
export async function replaceDataset(
  name: string,
  description: string,
  examples: { inputs: KVMap; outputs?: KVMap; metadata?: KVMap }[],
): Promise<string> {
  const ls = langsmith();
  const dataset = (await ls.hasDataset({ datasetName: name }))
    ? await ls.readDataset({ datasetName: name })
    : await ls.createDataset(name, { description });
  const old: string[] = [];
  for await (const e of ls.listExamples({ datasetId: dataset.id })) old.push(e.id);
  if (old.length > 0) await ls.deleteExamples(old);
  await ls.createExamples(examples.map((e) => ({ ...e, dataset_id: dataset.id })));
  return dataset.id;
}

/** A row's score under `key`, or null when the evaluator gave none. */
export function scoreOf(row: ExperimentResultRow, key: string): number | null {
  const result = row.evaluationResults.results.find((r) => r.key === key);
  return typeof result?.score === "number" ? result.score : typeof result?.score === "boolean" ? Number(result.score) : null;
}

export const mean = (xs: readonly number[]) => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length);

/** A seeded generator, so a resample gives the same interval every time it is run. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The mean of `xs` and a 95% bootstrap interval around it. */
export function bootstrap(xs: readonly number[], resamples = 10_000): { mean: number; low: number; high: number } {
  const next = random(11);
  const means: number[] = [];
  for (let i = 0; i < resamples; i++) {
    let sum = 0;
    for (let j = 0; j < xs.length; j++) sum += xs[Math.floor(next() * xs.length)];
    means.push(sum / xs.length);
  }
  means.sort((a, b) => a - b);
  return { mean: mean(xs), low: means[Math.floor(0.025 * resamples)], high: means[Math.floor(0.975 * resamples)] };
}

export const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
