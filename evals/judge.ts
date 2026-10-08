// A model grading a model, for the one question that has no exact answer:
// is this explanation specific enough to be useful?
//
// Everything that can be checked in code is checked in code (invented paths,
// formatting, length). This is the rest, and its number is an opinion: the
// grader's, with its biases, on a five-point scale. It is reported as one,
// beside the deterministic scores, never folded into them.
//
// The grader is the same pinned model that writes explanations. It would
// favour its own writing over another model's, but here both sides of every
// comparison are written by that same model, so the bias applies to both;
// what differs between them is only the prompt. It is not told which prompt
// wrote what.

import { z } from "zod";
import { ai } from "../lib/ai/client.ts";

/** Pinned exactly, as the app's models are: a grader that changes under its name changes every score. */
export const JUDGE_MODEL = "gpt-5.4-mini-2026-03-17";
/** Bump when the rubric changes; scores under different rubrics do not compare. */
export const RUBRIC_VERSION = 1;

const INSTRUCTIONS = `You grade explanations of source files. Each was written for a developer who can read code but did not write this codebase and cannot see its shape. You are given what the writer was given (the file, the files it imports and is imported by, read off the code by a parser) and the explanation it wrote.

Grade one thing: is the explanation specific enough to be useful to that developer?

5: Says what this particular file does and why it exists, in terms only this file earns. Names the specific neighbours that matter and what actually passes between them. A reader learns something they could not have guessed from the file name.
4: Specific and accurate, but misses the most important relationship, or spends words on minor detail.
3: Partly specific. Some sentences could describe many files ("handles logic", "provides utilities", "is used across the app").
2: Mostly generic, or restates the lists of imports without saying what they are used for.
1: Generic throughout, or wrong about what the code does.

Rules:
- Claims the input does not support count against the explanation, however confident.
- Do not reward length. A short, precise answer beats a long, padded one.
- Ignore formatting entirely.
Give your reasoning in two or three sentences, then the score.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reasoning", "score"],
  properties: {
    reasoning: { type: "string" },
    score: { type: "integer", enum: [1, 2, 3, 4, 5] },
  },
} as const;

const Verdict = z.object({ reasoning: z.string(), score: z.number().int().min(1).max(5) });
export type Verdict = z.infer<typeof Verdict>;

export async function judgeSpecificity(input: string, explanation: string): Promise<Verdict> {
  const response = await ai().responses.create({
    model: JUDGE_MODEL,
    instructions: INSTRUCTIONS,
    input: `<given>\n${input}\n</given>\n\n<explanation>\n${explanation}\n</explanation>`,
    reasoning: { effort: "medium" },
    text: { format: { type: "json_schema", name: "verdict", strict: true, schema: SCHEMA } },
  });
  return Verdict.parse(JSON.parse(response.output_text));
}
