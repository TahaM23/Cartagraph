// What NestJS knows: a file's role is in its name (users.controller.ts,
// users.service.ts), and a route is assembled from two decorators, the
// controller's path and the handler method's, under any global prefix the
// app sets.
//
// A route is emitted only when every part of it is a literal in the code.
// A path held in a variable, a controller versioned (its URL then depends on
// how versioning is configured), a RouterModule (which prefixes whole modules
// from elsewhere), a global prefix that is not a single literal: each of
// those means some part of the URL would have to be guessed, so the routes it
// touches are left out instead.

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { HttpMethod, Route } from "../contract.ts";
import { dependsOn, ownerBy, type EntryPoint, type FrameworkAdapter, type RepoContext, type RoleAssignment } from "../adapter.ts";
import type { RoleOf } from "./taxonomy.ts";

type Role = RoleOf<"nestjs">;

/** Roles by the suffix before the extension: `<name>.<suffix>.ts`. */
const SUFFIXES: Record<string, Role> = {
  controller: "controller",
  resolver: "resolver",
  gateway: "gateway",
  service: "service",
  repository: "repository",
  module: "module",
  entity: "entity",
  schema: "schema",
  dto: "DTO",
  guard: "guard",
  interceptor: "interceptor",
  pipe: "pipe",
  filter: "exception filter",
  middleware: "middleware",
  strategy: "strategy",
  decorator: "decorator",
};

const SUFFIXED = /\.([a-z]+)\.[cm]?[jt]s$/;

/** The method decorators of @nestjs/common that name exactly one HTTP method. */
const METHOD_DECORATORS: Record<string, HttpMethod> = {
  Get: "GET",
  Post: "POST",
  Put: "PUT",
  Patch: "PATCH",
  Delete: "DELETE",
  Head: "HEAD",
  Options: "OPTIONS",
};

const COMMON = "@nestjs/common";

/** Where a Nest app starts: nest-cli.json's sourceRoot and entryFile, or their defaults. */
function bootstrapFiles(ctx: RepoContext): EntryPoint[] {
  const entries: EntryPoint[] = [];
  for (const pkg of ctx.packageJsons) {
    if (!dependsOn(pkg.json, "@nestjs/core")) continue;
    const cliPath = path.posix.join(pkg.dir, "nest-cli.json");
    let cli: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(path.join(ctx.root, cliPath), "utf8"));
      if (parsed && typeof parsed === "object") cli = parsed as Record<string, unknown>;
    } catch {
      // No nest-cli.json, or not JSON: the defaults apply.
    }
    const configs: { sourceRoot?: unknown; entryFile?: unknown }[] = [cli];
    if (cli.projects && typeof cli.projects === "object") configs.push(...Object.values(cli.projects as object));
    for (const config of configs) {
      const sourceRoot = typeof config.sourceRoot === "string" ? config.sourceRoot : "src";
      const entryFile = typeof config.entryFile === "string" ? config.entryFile : "main";
      for (const ext of [".ts", ".js"]) {
        const file = path.posix.normalize(path.posix.join(pkg.dir, sourceRoot, entryFile + ext));
        if (ctx.files.has(file) && !entries.some((e) => e.path === file)) {
          entries.push({ path: file, reason: `NestJS entry file (${sourceRoot}/${entryFile})` });
        }
      }
    }
  }
  return entries;
}

function rolesOf(ctx: RepoContext): RoleAssignment[] {
  // A shared library in a Nest monorepo depends on @nestjs/common alone.
  const owner = ownerBy(ctx, ["@nestjs/core", COMMON]);
  const roles: RoleAssignment[] = [];
  const bootstrap = new Set(bootstrapFiles(ctx).map((e) => e.path));
  for (const file of ctx.files) {
    if (owner(file) === null) continue;
    if (bootstrap.has(file)) {
      roles.push({ path: file, role: "bootstrap" });
      continue;
    }
    // "users.controller.spec.ts" ends in ".spec", so it is a test, not a controller.
    const suffix = SUFFIXED.exec(file.slice(file.lastIndexOf("/") + 1))?.[1];
    if (suffix && Object.hasOwn(SUFFIXES, suffix)) roles.push({ path: file, role: SUFFIXES[suffix] });
  }
  return roles;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const lineOf = (sf: ts.SourceFile, node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

const literal = (node: ts.Node): string | null =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;

/**
 * The names a file gives @nestjs/common's exports: `import { Get as G }`
 * makes `G` mean Get, and `import * as common` makes `common.Get` mean it.
 * A decorator only counts when it is really Nest's.
 */
function nestNames(sf: ts.SourceFile) {
  const named = new Map<string, string>();
  const namespaces = new Set<string>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || literal(statement.moduleSpecifier) !== COMMON) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    else for (const el of bindings.elements) named.set(el.name.text, (el.propertyName ?? el.name).text);
  }
  /** Which @nestjs/common export a decorator calls, with its arguments, or null. */
  return (decorator: ts.Decorator): { name: string; args: readonly ts.Expression[] } | null => {
    const call = decorator.expression;
    if (!ts.isCallExpression(call)) return null;
    const callee = call.expression;
    if (ts.isIdentifier(callee) && named.has(callee.text)) return { name: named.get(callee.text)!, args: call.arguments };
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      namespaces.has(callee.expression.text)
    ) {
      return { name: callee.name.text, args: call.arguments };
    }
    return null;
  };
}

/** Path arguments that are literals all the way down: one string, or an array of strings. */
function literalPaths(node: ts.Expression | undefined): string[] | null {
  if (node === undefined) return [""];
  const one = literal(node);
  if (one !== null) return [one];
  if (ts.isArrayLiteralExpression(node) && node.elements.length > 0) {
    const all = node.elements.map(literal);
    return all.every((p) => p !== null) ? (all as string[]) : null;
  }
  return null;
}

/**
 * The controller's paths. `@Controller()`, `@Controller("users")`,
 * `@Controller(["a", "b"])` and `@Controller({ path: "users" })` are exact.
 * An options object that sets a version, or holds anything not literal, is
 * not: the URL then depends on more than this file says.
 */
function controllerPaths(args: readonly ts.Expression[]): string[] | null {
  if (args.length > 1) return null;
  const [arg] = args;
  if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return literalPaths(arg);
  let paths: string[] | null = [""];
  for (const property of arg.properties) {
    if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
      return null;
    }
    const key = property.name.text;
    if (key === "path") paths = literalPaths(property.initializer);
    // host and scope do not change the path.
    else if (key !== "host" && key !== "scope" && key !== "durable") return null;
  }
  return paths;
}

/**
 * Joins the parts of a route the way Nest does: each part gets a leading
 * slash and loses a trailing one, and empty parts drop out. A part with a
 * doubled slash in it is left alone by Nest and would be guessing here.
 */
function joinPath(parts: readonly string[]): string | null {
  const kept: string[] = [];
  for (const part of parts) {
    if (part.includes("//")) return null;
    const trimmed = part.replace(/^\//, "").replace(/\/$/, "");
    if (trimmed !== "") kept.push(trimmed);
  }
  return `/${kept.join("/")}`;
}

/** Calls in a file whose callee is `<anything>.<name>(...)`. */
function methodCalls(sf: ts.SourceFile, name: string): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === name) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return calls;
}

function mentions(sf: ts.SourceFile, identifier: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === identifier) found = true;
    else ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/**
 * The prefix in front of every route, or null when it cannot be read exactly;
 * "" when nothing sets one. Read across the whole repository, because the app
 * that sets a prefix mounts controllers from wherever its modules import
 * them. A prefix is only certain when there is one app to apply it to: with
 * two apps, which controllers each one mounts is not something a file says.
 */
function globalPrefix(ctx: RepoContext): string | null {
  const prefixes: string[] = [];
  let apps = 0;
  for (const file of ctx.files) {
    const text = ctx.text(file);
    if (text === null || !/RouterModule|enableVersioning|NestFactory|setGlobalPrefix/.test(text)) continue;
    const sf = ctx.syntax(file)!;
    // Prefixes from module structure, or a version in every URL: both decided
    // outside the controller, by configuration this does not evaluate.
    if (text.includes("RouterModule") && mentions(sf, "RouterModule")) return null;
    if (text.includes("enableVersioning") && methodCalls(sf, "enableVersioning").length > 0) return null;
    if (text.includes("NestFactory")) {
      const creates = methodCalls(sf, "create").filter(
        (c) => ts.isPropertyAccessExpression(c.expression) && ts.isIdentifier(c.expression.expression) && c.expression.expression.text === "NestFactory",
      );
      if (creates.length > 0) apps++;
    }
    if (!text.includes("setGlobalPrefix")) continue;
    for (const call of methodCalls(sf, "setGlobalPrefix")) {
      // An options argument can exclude routes from the prefix; not evaluated.
      const value = call.arguments.length === 1 ? literal(call.arguments[0]) : null;
      if (value === null) return null;
      prefixes.push(value);
    }
  }
  if (prefixes.length === 0) return "";
  return prefixes.length === 1 && apps <= 1 ? prefixes[0] : null;
}

function routesIn(sf: ts.SourceFile, file: string, prefix: string): Route[] {
  const nest = nestNames(sf);
  const routes: Route[] = [];
  for (const statement of sf.statements) {
    if (!ts.isClassDeclaration(statement)) continue;
    const decorators = (ts.getDecorators(statement) ?? []).map(nest).filter((d) => d !== null);
    const controller = decorators.filter((d) => d.name === "Controller");
    if (controller.length !== 1 || decorators.some((d) => d.name === "Version")) continue;
    const bases = controllerPaths(controller[0].args);
    if (bases === null) continue;

    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      const own = (ts.getDecorators(member) ?? []).map((d) => ({ d, nest: nest(d) }));
      if (own.some((o) => o.nest?.name === "Version")) continue;
      for (const { d, nest: call } of own) {
        if (!call || !Object.hasOwn(METHOD_DECORATORS, call.name) || call.args.length > 1) continue;
        const subpaths = literalPaths(call.args[0]);
        if (subpaths === null) continue;
        for (const base of bases) {
          for (const sub of subpaths) {
            const full = joinPath([prefix, base, sub]);
            if (full !== null) routes.push({ method: METHOD_DECORATORS[call.name], path: full, file, line: lineOf(sf, d) });
          }
        }
      }
    }
  }
  return routes;
}

function routesOf(ctx: RepoContext): Route[] {
  const prefix = globalPrefix(ctx);
  if (prefix === null) return [];
  const routes: Route[] = [];
  // Every file, not only those under a package depending on Nest: a shared
  // library declares controllers with nothing but @nestjs/common, and the
  // import check in routesIn is what makes a decorator Nest's.
  for (const file of ctx.files) {
    if (ctx.text(file)?.includes(COMMON)) routes.push(...routesIn(ctx.syntax(file)!, file, prefix));
  }
  return routes;
}

export const nestjsAdapter: FrameworkAdapter = {
  name: "nestjs",
  detect: (ctx) => ctx.packageJsons.some((pkg) => dependsOn(pkg.json, "@nestjs/core")),
  entryPoints: bootstrapFiles,
  roles: rolesOf,
  routes: routesOf,
};
