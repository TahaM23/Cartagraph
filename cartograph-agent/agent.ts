import { defineDeepAgent } from "managed-deepagents";
import { Context } from "./context.ts";
import { lookupsOnly } from "./middleware/lookups-only.ts";
import { GRAPH_TOOLS } from "./tools/graph.ts";

// The same pinned snapshot the app explains with: a moving alias could change
// under the same name.
export const agent = defineDeepAgent({
  name: "cartograph-agent",
  model: "openai:gpt-5.4-mini-2026-03-17",
  tools: GRAPH_TOOLS,
  middleware: [lookupsOnly(GRAPH_TOOLS.map((t) => t.name))],
  contextSchema: Context,
});
