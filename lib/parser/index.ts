// The parser: a directory path in, files, edges and coverage out.
//
// Standalone by design. It imports no web framework, UI library or database
// client, fetches nothing, and runs from a plain script.

import {
  IMPORT_KINDS,
  PARSE_RESULT_VERSION,
  type Coverage,
  type Edge,
  type ExcludedImport,
  type FileNode,
  type ImportKind,
  type OutcomeCounts,
  type ParseResult,
  type UnresolvedImport,
} from "./contract.ts";
import type ts from "typescript";
import { applyAdapter, type FrameworkAdapter } from "./adapter.ts";
import { extractImports, parseSyntax } from "./extract.ts";
import { computeFan } from "./graph.ts";
import { Resolver } from "./resolve.ts";
import { walkRepository, type WalkOptions, type WalkResult } from "./walk.ts";

export * from "./contract.ts";
export { readParseResult, writeParseResult, checkInvariants } from "./io.ts";
export { fallbackAdapter, type FrameworkAdapter, type RepoContext } from "./adapter.ts";
export { walkRepository, type WalkResult } from "./walk.ts";

export interface ParseOptions extends WalkOptions {
  /** Tried in order; the first that detects the repository is the one that applies. */
  adapters?: readonly FrameworkAdapter[];
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function emptyCounts(): OutcomeCounts {
  return { total: 0, internal: 0, external: 0, excluded: 0, unresolved: 0 };
}

function increment<K extends string>(record: Partial<Record<K, number>>, key: K): void {
  record[key] = (record[key] ?? 0) + 1;
}

export function parseRepository(directory: string, options: ParseOptions = {}): ParseResult {
  return parseWalk(walkRepository(directory, options), options);
}

/** The parse on its own, for callers that look at the walk before parsing it. */
export function parseWalk(walk: WalkResult, options: ParseOptions = {}): ParseResult {
  const nodePaths = new Set(walk.files.map((f) => f.path));
  const resolver = new Resolver(walk.root, nodePaths, walk.otherFiles, walk.packageJsons);

  const edges: Edge[] = [];
  const unresolved: UnresolvedImport[] = [];
  const excluded: ExcludedImport[] = [];
  const skips = new Map<string, { reason: FileNode["skipReason"]; detail: string }>();

  const imports = {
    ...emptyCounts(),
    byKind: Object.fromEntries(IMPORT_KINDS.map((k) => [k, emptyCounts()])) as Record<
      ImportKind,
      OutcomeCounts
    >,
    externalReasons: {},
    excludedReasons: {},
    unresolvedReasons: {},
    externalPackages: {} as Record<string, number>,
  } satisfies Coverage["imports"];
  let requireCalls = 0;

  for (const file of walk.files) {
    if (file.skip) {
      skips.set(file.path, file.skip);
      continue;
    }
    const extraction = extractImports(file.path, file.text ?? "");
    if (extraction.syntaxError) {
      skips.set(file.path, { reason: "syntax-error", detail: extraction.syntaxError });
      continue;
    }
    requireCalls += extraction.requireCalls;

    for (const raw of extraction.imports) {
      const site = { source: file.path, line: raw.line, kind: raw.kind };
      const resolution =
        raw.specifier === null
          ? ({
              outcome: "unresolved",
              reason: "non-literal-specifier",
              detail: `argument is an expression: ${raw.expression ?? "(none)"}`,
            } as const)
          : resolver.resolve(raw.specifier, file.path);
      const specifier = raw.specifier ?? raw.expression ?? "";

      imports.total++;
      imports[resolution.outcome]++;
      imports.byKind[raw.kind].total++;
      imports.byKind[raw.kind][resolution.outcome]++;

      switch (resolution.outcome) {
        case "internal":
          edges.push({ ...site, target: resolution.target, specifier, typeOnly: raw.typeOnly });
          break;
        case "external":
          increment(imports.externalReasons, resolution.reason);
          if (resolution.reason === "package" && resolution.packageName) {
            increment(imports.externalPackages, resolution.packageName);
          }
          break;
        case "excluded":
          increment(imports.excludedReasons, resolution.reason);
          excluded.push({ ...site, specifier, reason: resolution.reason, target: resolution.target });
          break;
        case "unresolved":
          increment(imports.unresolvedReasons, resolution.reason);
          unresolved.push({ ...site, specifier, reason: resolution.reason, detail: resolution.detail });
          break;
      }
    }
  }

  const texts = new Map(walk.files.filter((f) => !skips.has(f.path)).map((f) => [f.path, f.text ?? ""]));
  const trees = new Map<string, ts.SourceFile>();
  const ctx = {
    root: walk.root,
    files: nodePaths,
    packageJsons: walk.packageJsons,
    text: (path: string) => texts.get(path) ?? null,
    syntax(path: string) {
      const text = texts.get(path);
      if (text === undefined) return null;
      let tree = trees.get(path);
      if (!tree) trees.set(path, (tree = parseSyntax(path, text)));
      return tree;
    },
  };
  const adapter = applyAdapter(options.adapters ?? [], ctx);
  const { entries, roles } = adapter;
  const fan = computeFan(nodePaths, edges);

  const files: FileNode[] = walk.files
    .map((file) => {
      const skip = skips.get(file.path) ?? null;
      return {
        path: file.path,
        folder: file.folder,
        package: file.package,
        extension: file.extension,
        lines: file.lines,
        bytes: file.bytes,
        hash: file.hash,
        parsed: skip === null,
        skipReason: skip?.reason ?? null,
        skipDetail: skip?.detail ?? null,
        fanOut: fan.get(file.path)!.fanOut,
        fanIn: fan.get(file.path)!.fanIn,
        entry: entries.get(file.path) ?? null,
        role: roles.get(file.path) ?? null,
      };
    })
    .sort((a, b) => byString(a.path, b.path));

  const skipReasons: Coverage["files"]["skipReasons"] = {};
  for (const { reason } of skips.values()) if (reason) increment(skipReasons, reason);

  const bySite = (a: { source: string; line: number }, b: { source: string; line: number }) =>
    byString(a.source, b.source) || a.line - b.line;

  return {
    version: PARSE_RESULT_VERSION,
    root: walk.root,
    generatedAt: new Date().toISOString(),
    adapter: adapter.name,
    files,
    routes: adapter.routes,
    edges: edges.sort(bySite),
    unresolved: unresolved.sort(bySite),
    excluded: excluded.sort(bySite),
    coverage: {
      files: {
        found: files.length,
        parsed: files.length - skips.size,
        skipped: skips.size,
        skipReasons,
        otherFiles: walk.otherFiles.size,
        ignored: walk.ignored,
      },
      imports,
      notHandled: { require: requireCalls },
      configs: resolver.configsUsed(),
    },
  };
}
