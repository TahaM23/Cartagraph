// What Express knows, which is where things are kept: routers in routes/,
// controllers in controllers/, and so on. Express itself asks for no layout,
// so this is the convention its applications share, not a rule; repositories
// spell the folders both singular and plural, and both count.
//
// Routes are not read. An Express URL is assembled at run time, from routers
// mounted on other routers under paths held in variables and behind
// middleware, so no one file states a method and a full pattern. A route that
// would have to be pieced together is a guess, and the route table stays empty.

import { dependsOn, ownerBy, type FrameworkAdapter, type RepoContext, type RoleAssignment } from "../adapter.ts";
import type { RoleOf } from "./taxonomy.ts";

type Role = RoleOf<"express">;

/** Roles by the name of a directory a file sits in, singular and plural alike. */
const DIRECTORIES: Record<string, Role> = {
  routes: "router",
  route: "router",
  routers: "router",
  router: "router",
  controllers: "controller",
  controller: "controller",
  services: "service",
  service: "service",
  models: "model",
  model: "model",
  middlewares: "middleware",
  middleware: "middleware",
  validations: "validator",
  validation: "validator",
  validators: "validator",
  validator: "validator",
};

/** Tests sit beside what they test, often in a matching tree; they are not what they test. */
const TEST_DIR = /^(__tests__|__mocks__|tests?|e2e|specs?)$/;
const TEST_OR_DECLARATION = /\.(test|spec)\.[cm]?[jt]sx?$|\.d\.[cm]?ts$/;

/**
 * The role of a file at `rel` inside an Express package: from the nearest
 * directory above it with a conventional name, so `routes/v1/users.js` is a
 * router and `models/plugins/paginate.js` a model.
 */
export function expressRoleOf(rel: string): Role | null {
  const segments = rel.split("/");
  const name = segments.pop()!;
  if (TEST_OR_DECLARATION.test(name) || segments.some((s) => TEST_DIR.test(s))) return null;
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i].toLowerCase();
    if (Object.hasOwn(DIRECTORIES, segment)) return DIRECTORIES[segment];
  }
  return null;
}

function rolesOf(ctx: RepoContext): RoleAssignment[] {
  const owner = ownerBy(ctx, "express");
  const roles: RoleAssignment[] = [];
  for (const path of ctx.files) {
    const owned = owner(path);
    // Directories above the package say nothing about its layout.
    const role = owned === null ? null : expressRoleOf(owned.rel);
    if (role !== null) roles.push({ path, role });
  }
  return roles;
}

export const expressAdapter: FrameworkAdapter = {
  name: "express",
  detect: (ctx) => ctx.packageJsons.some((pkg) => dependsOn(pkg.json, "express")),
  // The entry point is whatever package.json says, which the fallback already reads.
  entryPoints: () => [],
  roles: rolesOf,
  routes: () => [],
};
