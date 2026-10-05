// Where framework knowledge lives. The parser never asks which framework a
// repository uses; it asks the selected adapter for what that framework
// knows, and the fallback knows nothing.

import path from "node:path";
import type { PackageJson } from "./walk.ts";

export interface RepoContext {
  root: string;
  /** Every file node's path, POSIX, relative to root. */
  files: ReadonlySet<string>;
  packageJsons: readonly PackageJson[];
}

export interface EntryPoint {
  path: string;
  reason: string;
}

export interface RoleAssignment {
  path: string;
  role: string;
}

export interface FrameworkAdapter {
  readonly name: string;
  /** Whether this adapter applies to the repository. */
  detect(ctx: RepoContext): boolean;
  /** Files a runtime or tool starts from by convention. */
  entryPoints(ctx: RepoContext): EntryPoint[];
  /** Roles this framework's conventions assign to files. */
  roles(ctx: RepoContext): RoleAssignment[];
}

const ENTRY_FIELDS = ["main", "module", "browser", "types", "typings", "source"] as const;

function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, into));
  else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => collectStrings(v, into));
  }
}

/**
 * Assumes no framework at all. The only conventions it reads are the ones
 * every JavaScript package has: the entry points package.json declares.
 */
export const fallbackAdapter: FrameworkAdapter = {
  name: "fallback",
  detect: () => true,
  entryPoints(ctx) {
    const entries = new Map<string, string>();
    for (const pkg of ctx.packageJsons) {
      const declared: [string, string][] = [];
      for (const field of ENTRY_FIELDS) {
        const value = pkg.json[field];
        if (typeof value === "string") declared.push([field, value]);
      }
      const targets: string[] = [];
      collectStrings(pkg.json.bin, targets);
      targets.forEach((t) => declared.push(["bin", t]));
      const exportsTargets: string[] = [];
      collectStrings(pkg.json.exports, exportsTargets);
      exportsTargets.forEach((t) => declared.push(["exports", t]));

      for (const [field, target] of declared) {
        const rel = path.posix.normalize(path.posix.join(pkg.dir, target));
        if (ctx.files.has(rel) && !entries.has(rel)) {
          const where = pkg.dir === "." ? "package.json" : `${pkg.dir}/package.json`;
          entries.set(rel, `${where} "${field}"`);
        }
      }
    }
    return [...entries].map(([p, reason]) => ({ path: p, reason }));
  },
  roles: () => [],
};

/** The first adapter that detects the repository; the fallback always does. */
export function selectAdapter(
  adapters: readonly FrameworkAdapter[],
  ctx: RepoContext,
): FrameworkAdapter {
  return adapters.find((a) => a.detect(ctx)) ?? fallbackAdapter;
}
