// The six lookups the agent answers from. Each one names a starting point
// and, where it matters, a direction; the app answers from the stored graph
// with the functions that draw the canvas. None of them can be asked whether
// two files are related: only what the parser recorded comes back.

import { tool, type ToolRuntime } from "langchain";
import { z } from "zod";
import type { Context } from "../context.ts";
import { lookUp } from "./client.ts";

type Runtime = ToolRuntime<unknown, typeof Context>;

const filePath = z.string().min(1).describe("A repository-relative file path exactly as a lookup returned it, e.g. src/lib/auth.ts.");

export const analysisSummary = tool(
  async (_input, runtime: Runtime) => lookUp("summary", {}, runtime),
  {
    name: "analysis_summary",
    description:
      "Overview of the analysed repository: the framework, file and edge counts, the top-level folders, " +
      "the most depended-on files, and coverage (what was parsed and what was skipped). Start here when you do not yet know the repository.",
    schema: z.object({}),
  },
);

export const searchFiles = tool(
  async (input, runtime: Runtime) => lookUp("search", input, runtime),
  {
    name: "search_files",
    description:
      "Find files whose path contains the given text, case-insensitive, e.g. 'auth', 'middleware', 'components/button'. " +
      "Returns matching paths with their roles, and how many matched in all. Use it to turn a topic into real paths " +
      "before looking anything else up. Leave the query out to list every file, in path order: the only way to list files.",
    schema: z.object({
      query: z.string().max(200).optional().describe("Part of a path. Leave it out to list every file."),
      limit: z.number().int().min(1).max(100).optional().describe("Most matches to return. Defaults to 25."),
    }),
  },
);

export const filesByRole = tool(
  async (input, runtime: Runtime) => lookUp("role", input, runtime),
  {
    name: "files_by_role",
    description:
      "List the files with a given role. Roles come from the framework's conventions, named for people " +
      "(in a Next.js app, e.g. 'page route', 'layout', 'API endpoint', 'proxy'), or from labelling " +
      "(service, repository, model, util, config, component, hook). Case does not matter. " +
      "A role the repository does not have returns the roles it does have, with counts: ask for one that isn't there to see them.",
    schema: z.object({ role: z.string().min(1).max(50).describe("The role, e.g. 'API endpoint' or 'service'.") }),
  },
);

export const neighbours = tool(
  async (input, runtime: Runtime) => lookUp("neighbours", input, runtime),
  {
    name: "neighbours",
    description: "The files one step away from a file: what it imports, and what imports it.",
    schema: z.object({ path: filePath }),
  },
);

export const walk = tool(
  async (input, runtime: Runtime) => lookUp("walk", input, runtime),
  {
    name: "walk",
    description:
      "Follow imports from a file, level by level, up to two levels out. " +
      "direction 'dependents' is the blast radius: the files that import it, directly or through one other file, " +
      "so what may break if it changes. direction 'dependencies' is the chain of files it relies on.",
    schema: z.object({
      path: filePath,
      direction: z.enum(["dependents", "dependencies"]),
    }),
  },
);

export const routes = tool(
  async (input, runtime: Runtime) => lookUp("routes", input, runtime),
  {
    name: "routes",
    description:
      "The route table: each HTTP method and full path the framework conventions recovered, with the file that handles it. " +
      "Optionally narrowed to paths containing some text, e.g. '/api/users'.",
    schema: z.object({ contains: z.string().max(200).optional().describe("Part of a route path.") }),
  },
);

export const GRAPH_TOOLS = [analysisSummary, searchFiles, filesByRole, neighbours, walk, routes];
