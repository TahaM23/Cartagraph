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

// --- The agent ----------------------------------------------------------------
//
// Two questions about the agent's answers that code cannot settle: did it
// hedge where it could have looked, and did it decline cleanly. Each is a
// pass or a fail with a reason, on its own rubric, reported as an opinion
// beside the code-checked scores.

/** Bump when either agent rubric changes. */
export const AGENT_RUBRIC_VERSION = 1;

const AGENT_COMMON = `You grade answers from an agent that answers questions about one code repository's structure. It cannot read code. It can only look things up in a graph built by parsing the code: a summary, path search, files by role, a file's direct neighbours, a walk of imports up to two steps either way, and the route table. You are given the question, every lookup it made with what came back, and its answer.`;

const HEDGING = `${AGENT_COMMON}

Grade one thing: did it look, or did it hedge?

Pass: the answer states what its lookups found, plainly. Where the graph cannot say something (what code does at runtime), it says so once, briefly, and still gives what the graph does show.
Fail: it hedges or deflects where one more available lookup would have settled the question; or it qualifies with "might", "possibly", "I can't tell" a point its lookups already answered exactly; or it offers to look something up instead of looking it up; or it answers from general knowledge rather than from its lookups.

Give your reasoning in two or three sentences, then pass or fail.`;

const DECLINING = `${AGENT_COMMON}

The question asked for something the graph cannot answer, such as a judgement of code quality. Grade one thing: did it decline well?

Pass: it declines in a sentence, makes no judgement of quality (no "clean", "modular", "cohesive", "messy", "risky", nor a score), and offers concrete structural questions it can answer, grounded in at least one fact it looked up.
Fail: it gives any quality verdict, even softened or framed as a description of structure; or it declines with nothing concrete to offer; or it pretends to answer.

Give your reasoning in two or three sentences, then pass or fail.`;

const PASS_FAIL = {
  type: "object",
  additionalProperties: false,
  required: ["reasoning", "pass"],
  properties: { reasoning: { type: "string" }, pass: { type: "boolean" } },
} as const;

const Judged = z.object({ reasoning: z.string(), pass: z.boolean() });
export type Judged = z.infer<typeof Judged>;

export async function judgeAgentAnswer(rubric: "hedging" | "declining", transcript: string): Promise<Judged> {
  const response = await ai().responses.create({
    model: JUDGE_MODEL,
    instructions: rubric === "hedging" ? HEDGING : DECLINING,
    input: transcript,
    reasoning: { effort: "medium" },
    text: { format: { type: "json_schema", name: "verdict", strict: true, schema: PASS_FAIL } },
  });
  return Judged.parse(JSON.parse(response.output_text));
}
