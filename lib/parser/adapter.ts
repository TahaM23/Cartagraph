// Where framework knowledge lives. The parser never asks which framework a
// repository uses; it asks the selected adapter for what that framework
// knows, and the fallback knows nothing.

import path from "node:path";
import type ts from "typescript";
import type { Route } from "./contract.ts";
import type { PackageJson } from "./walk.ts";

export interface RepoContext {
  root: string;
  /** Every file node's path, POSIX, relative to root. */
  files: ReadonlySet<string>;
  packageJsons: readonly PackageJson[];
  /** A parsed file's text, or null when the file was skipped. Cheap: check it before asking for syntax. */
  text(path: string): string | null;
  /** A parsed file's syntax tree, or null when the file was skipped. Parsed on first ask. */
  syntax(path: string): ts.SourceFile | null;
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
  /**
   * HTTP routes whose method and full pattern the syntax states outright.
   * Where either would have to be guessed, the route is left out.
   */
  routes(ctx: RepoContext): Route[];
}

/** Whether a package.json lists `name` among its dependencies of any kind. */
export function dependsOn(json: Record<string, unknown>, name: string): boolean {
  return ["dependencies", "devDependencies", "peerDependencies"].some((field) => {
    const deps = json[field];
    return typeof deps === "object" && deps !== null && name in deps;
  });
}

/** `path` relative to `dir`, or null when it is not inside it. */
export function within(dir: string, path: string): string | null {
  if (dir === ".") return path;
  return path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : null;
}

/**
 * Where a framework applies: the packages that depend on it. A file belongs
 * to the nearest one above it, so a monorepo with one app on the framework
 * gets that app's files and nobody else's. Returns that package's directory
 * and the file's path inside it, or null for a file in none of them.
 */
export function ownerBy(ctx: RepoContext, dependency: string): (path: string) => { dir: string; rel: string } | null {
  // Deepest first, so a file belongs to the nearest package above it.
  const dirs = ctx.packageJsons
    .filter((pkg) => dependsOn(pkg.json, dependency))
    .map((pkg) => pkg.dir)
    .sort((a, b) => b.length - a.length);
  return (path) => {
    for (const dir of dirs) {
      const rel = within(dir, path);
      if (rel !== null) return { dir, rel };
    }
    return null;
  };
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
  routes: () => [],
};

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The one adapter that applies: detection runs in the order given and the
 * first match wins, so the same repository always reads as the same
 * framework. When none matches, the fallback applies and the repository
 * still renders, with generic roles and no routes. The fallback's
 * package.json entry points apply either way: every JavaScript package has
 * them, whatever its framework.
 */
export function applyAdapter(
  adapters: readonly FrameworkAdapter[],
  ctx: RepoContext,
): { name: string; entries: Map<string, string>; roles: Map<string, string>; routes: Route[] } {
  const selected = adapters.find((a) => a !== fallbackAdapter && a.detect(ctx)) ?? fallbackAdapter;
  const entries = new Map<string, string>();
  for (const adapter of selected === fallbackAdapter ? [fallbackAdapter] : [fallbackAdapter, selected]) {
    for (const e of adapter.entryPoints(ctx)) if (!entries.has(e.path)) entries.set(e.path, e.reason);
  }
  const roles = new Map<string, string>();
  for (const r of selected.roles(ctx)) if (!roles.has(r.path)) roles.set(r.path, r.role);
  const routes = selected
    .routes(ctx)
    .sort((a, b) => byString(a.path, b.path) || byString(a.method, b.method) || byString(a.file, b.file) || a.line - b.line);
  return { name: selected.name, entries, roles, routes };
}
