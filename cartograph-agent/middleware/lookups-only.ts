// The agent answers from its six lookups and nothing else.
//
// The Deep Agents harness gives every agent a filesystem (ls, read_file,
// grep, glob, write_file, edit_file), a to-do list and a sub-agent tool.
// Here the filesystem is an empty scratch disk: grepping it finds nothing,
// and anything written to it would be the model's own words read back as if
// they were the repository. So the model is shown only the lookups, and a
// call to anything else is refused rather than run.
//
// And no answer goes out without a lookup behind it: the first step after
// each question must call one, even for a question the agent will decline.
// Instructions ask for that; this makes it so.

import { createMiddleware, ToolMessage } from "langchain";

export function lookupsOnly(allowed: readonly string[]) {
  const names = new Set(allowed);
  return createMiddleware({
    name: "LookupsOnly",
    wrapModelCall: (request, handler) => {
      let lookedUp = false;
      for (let i = request.messages.length - 1; i >= 0 && request.messages[i].type !== "human"; i--) {
        if (request.messages[i].type === "tool") lookedUp = true;
      }
      return handler({
        ...request,
        tools: request.tools.filter((t) => "name" in t && names.has(String(t.name))),
        ...(lookedUp ? {} : { toolChoice: "required" as const }),
      });
    },
    wrapToolCall: (request, handler) => {
      if (names.has(request.toolCall.name)) return handler(request);
      return new ToolMessage({
        tool_call_id: request.toolCall.id ?? "",
        name: request.toolCall.name,
        content: `${request.toolCall.name} is not available. Use the repository lookups.`,
        status: "error",
      });
    },
  });
}
