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

/** Whether a package.json lists `name` among its dependencies of any kind. */
export function dependsOn(json: Record<string, unknown>, name: string): boolean {
  return ["dependencies", "devDependencies", "peerDependencies"].some((field) => {
    const deps = json[field];
    return typeof deps === "object" && deps !== null && name in deps;
  });
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

/**
 * Every adapter that detects the repository, combined. A monorepo can hold a
 * Next.js app, a Vite app and a docs site at once, and each knows only its
 * own files, so all of them apply. The fallback's package.json entry points
 * always do: every JavaScript package has them, whatever its framework.
 */
export function combineAdapters(
  adapters: readonly FrameworkAdapter[],
  ctx: RepoContext,
): { name: string; entries: Map<string, string>; roles: Map<string, string> } {
  const applied = adapters.filter((a) => a !== fallbackAdapter && a.detect(ctx));
  const entries = new Map<string, string>();
  const roles = new Map<string, string>();
  // Where two adapters claim one file, the first listed wins.
  for (const adapter of [fallbackAdapter, ...applied]) {
    for (const e of adapter.entryPoints(ctx)) if (!entries.has(e.path)) entries.set(e.path, e.reason);
    for (const r of adapter.roles(ctx)) if (!roles.has(r.path)) roles.set(r.path, r.role);
  }
  return {
    name: applied.length === 0 ? fallbackAdapter.name : applied.map((a) => a.name).join(", "),
    entries,
    roles,
  };
}
