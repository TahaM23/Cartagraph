// What React knows, which is little: by convention a .jsx or .tsx file is a
// component, and a file named for a hook (useThing) is a hook. Next.js and
// Docusaurus are React underneath, so their adapters fall back to this for
// every file their own conventions do not claim.
//
// React itself routes nothing, so there are no routes here.

import { dependsOn, ownerBy, type EntryPoint, type FrameworkAdapter, type RepoContext, type RoleAssignment } from "../adapter.ts";
import type { RoleOf } from "./taxonomy.ts";
import { htmlEntryPoints } from "./vite.ts";

const HOOK_NAME = /^use([A-Z0-9]|-[a-z])/;
const JSX = new Set([".jsx", ".tsx"]);
const SCRIPT = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);

/** The React role of a file, from its name alone. */
export function reactRoleOf(path: string): RoleOf<"react"> | null {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const dot = file.indexOf(".");
  // "Button.test.tsx" and "Button.stories.tsx" are named "Button.test" and
  // "Button.stories": tests and stories, not components.
  if (dot <= 0 || file.indexOf(".", dot + 1) !== -1) return null;
  const name = file.slice(0, dot);
  const ext = file.slice(dot);
  if (!SCRIPT.has(ext)) return null;
  if (HOOK_NAME.test(name)) return "hook";
  return JSX.has(ext) ? "component" : null;
}

/** React roles for every file inside a package that depends on React. */
export function reactRoles(ctx: RepoContext, skip: (path: string) => boolean = () => false): RoleAssignment[] {
  const owner = ownerBy(ctx, "react");
  const roles: RoleAssignment[] = [];
  for (const path of ctx.files) {
    if (skip(path) || owner(path) === null) continue;
    const role = reactRoleOf(path);
    if (role !== null) roles.push({ path, role });
  }
  return roles;
}

export const reactAdapter: FrameworkAdapter = {
  name: "react",
  detect: (ctx) => ctx.packageJsons.some((pkg) => dependsOn(pkg.json, "react")),
  // A React app is most often served by Vite, which starts from index.html.
  entryPoints: (ctx): EntryPoint[] => htmlEntryPoints(ctx),
  roles: (ctx) => reactRoles(ctx),
  routes: () => [],
};
