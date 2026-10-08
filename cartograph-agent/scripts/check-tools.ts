// Calls each tool the way a run would, with no model in the loop, and prints
// what it answers. Until the app's endpoint exists, every tool must say the
// lookup failed and why, and none may answer anything else.
//
//   npm run check:tools                      against CARTOGRAPH_API_URL, or an address nothing listens on
//   npm run check:tools -- --no-credential   as a run started without one

import type { ToolRuntime } from "langchain";
import type { Context } from "../context.ts";
import { GRAPH_TOOLS } from "../tools/graph.ts";

process.env.CARTOGRAPH_API_URL ||= "http://127.0.0.1:9/api/agent";
const credential = process.argv.includes("--no-credential") ? undefined : "not-a-real-credential";

const examples: Record<string, Record<string, unknown>> = {
  analysis_summary: {},
  search_files: { query: "auth" },
  files_by_role: { role: "page" },
  neighbours: { path: "src/index.ts" },
  walk: { path: "src/index.ts", direction: "dependents" },
  routes: {},
};

console.log(`endpoint  ${process.env.CARTOGRAPH_API_URL}`);
console.log(`credential  ${credential ? "present" : "absent"}\n`);

let wrong = 0;
for (const t of GRAPH_TOOLS) {
  const input = examples[t.name];
  // The run's context reaches a tool through its config, as the agent's tool node passes it.
  const config = { context: { credential } } satisfies Pick<ToolRuntime<unknown, typeof Context>, "context">;
  const answer = String(await (t as { invoke(input: unknown, config: unknown): Promise<unknown> }).invoke(input, config));
  const ok = answer.startsWith("Lookup failed");
  if (!ok) wrong++;
  console.log(`${ok ? "ok    " : "WRONG "} ${t.name.padEnd(16)} ${answer}`);
}

console.log(wrong === 0 ? "\nEvery tool reported the failed lookup." : `\n${wrong} tool(s) answered without a lookup behind it.`);
process.exitCode = wrong === 0 ? 0 : 1;
