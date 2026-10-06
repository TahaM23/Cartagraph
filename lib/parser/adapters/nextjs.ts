// What Next.js knows: which files it reaches by where they sit rather than by
// being imported, and the URL each routable one answers at. Applies per
// package, so a monorepo with one Next.js app in it gets roles for that app's
// files and nobody else's.
//
// Routes come from App Router route handlers only. The pattern is the folder
// path and the methods are the handler's exported names, so both are read off
// the code. A page answers a GET by convention rather than by anything
// written in it, and a Pages Router API route handles every method in one
// function, so neither gets a route: where the method is not in the code,
// nothing is shown.

import ts from "typescript";
import type { HttpMethod, Route } from "../contract.ts";
import { dependsOn, ownerBy, type FrameworkAdapter, type RepoContext, type RoleAssignment } from "../adapter.ts";
import { reactRoleOf } from "./react.ts";
import type { RoleOf } from "./taxonomy.ts";

type Role = RoleOf<"nextjs">;

const COMPONENT = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);

/** App Router special files, by name without extension. */
const APP_FILES: Record<string, Role> = {
  page: "page route",
  layout: "layout",
  template: "template",
  loading: "loading UI",
  error: "error UI",
  "global-error": "error UI",
  "not-found": "not-found UI",
  forbidden: "forbidden UI",
  unauthorized: "unauthorized UI",
  default: "parallel route fallback",
  route: "API endpoint",
  icon: "metadata",
  "apple-icon": "metadata",
  "opengraph-image": "metadata",
  "twitter-image": "metadata",
  sitemap: "metadata",
  robots: "metadata",
  manifest: "metadata",
};

/** Files read from the project (or src) root. */
const ROOT_FILES: Record<string, Role> = {
  middleware: "middleware",
  proxy: "proxy",
  instrumentation: "instrumentation",
  "instrumentation-client": "instrumentation",
  "mdx-components": "MDX components",
};

const PAGES_SPECIAL: Record<string, Role> = {
  _app: "custom app",
  _document: "custom document",
  _error: "error page",
};

/** The methods a route handler may export, per the route.js file convention. */
const METHODS: ReadonlySet<string> = new Set<HttpMethod>(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

const CONFIG = /^next\.config\.[cm]?[jt]s$/;

function split(path: string) {
  const slash = path.lastIndexOf("/");
  const file = path.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  return {
    dir: slash === -1 ? "." : path.slice(0, slash),
    // "page.test.tsx" is named "page.test", so it is no page.
    name: dot === -1 ? file : file.slice(0, dot),
    ext: dot === -1 ? "" : file.slice(dot),
  };
}

/** The role Next.js gives `rel`, a path relative to the project or its src/. */
function roleIn(rel: string, routers: boolean): Role | null {
  const { dir, name, ext } = split(rel);
  // Dots inside brackets belong to a catch-all segment, "[...slug]".
  if (!COMPONENT.has(ext) || name.replace(/\[[^\]]*\]/g, "").includes(".")) return null;
  if (dir === "." && name in ROOT_FILES) return ROOT_FILES[name];
  if (!routers) return null;

  const [top, ...rest] = rel.split("/");
  if (top === "app" && rest.length > 0) {
    // A folder starting with "_" is private: nothing inside it is routed.
    if (rest.slice(0, -1).some((s) => s.startsWith("_"))) return null;
    return APP_FILES[name] ?? null;
  }
  if (top === "pages" && rest.length > 0) {
    if (rest.length === 1 && name in PAGES_SPECIAL) return PAGES_SPECIAL[name];
    return rest[0] === "api" ? "API endpoint" : "page route";
  }
  return null;
}

/**
 * Where a project's app/ and pages/ are read from. src/ stands in for the
 * project root, except that src/app and src/pages are ignored when app or
 * pages sits at the root itself.
 */
function locate(ctx: RepoContext) {
  const owner = ownerBy(ctx, "next");
  const rootRouters = new Set<string>();
  for (const path of ctx.files) {
    const o = owner(path);
    if (o && /^(app|pages)\//.test(o.rel)) rootRouters.add(o.dir);
  }
  return (path: string) => {
    const o = owner(path);
    if (o === null) return null;
    const inSrc = o.rel.startsWith("src/");
    return {
      app: o.dir,
      rel: o.rel,
      /** The path Next.js reads conventions from. */
      inner: inSrc ? o.rel.slice(4) : o.rel,
      /** Whether app/ and pages/ here are routed. */
      routers: !inSrc || !rootRouters.has(o.dir),
    };
  };
}

/** Whether a file opens with the "use server" directive, making every export a server action. */
function isServerActions(sf: ts.SourceFile): boolean {
  for (const statement of sf.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === "use server") return true;
  }
  return false;
}

function rolesOf(ctx: RepoContext): RoleAssignment[] {
  const where = locate(ctx);
  const roles: RoleAssignment[] = [];
  for (const path of ctx.files) {
    const at = where(path);
    if (at === null) continue;
    let role: Role | null = CONFIG.test(at.rel) ? "Next.js config" : roleIn(at.inner, at.routers);
    if (role === null && ctx.text(path)?.includes("use server")) {
      if (isServerActions(ctx.syntax(path)!)) role = "server actions";
    }
    role ??= reactRoleOf(path);
    if (role !== null) roles.push({ path, role });
  }
  return roles;
}

/**
 * The URL path an App Router folder answers at, or null when it cannot be
 * stated exactly. Route groups "(name)" drop out and dynamic segments stay as
 * written. A parallel route slot "@name", an intercepting route "(.)name" or
 * a percent-encoded name changes what the URL is in ways the folder alone
 * does not settle, so those give no route.
 */
function urlPath(segments: readonly string[]): string | null {
  const kept: string[] = [];
  for (const segment of segments) {
    if (segment.startsWith("@") || segment.startsWith("(.") || segment.includes("%")) return null;
    if (/^\([^()]+\)$/.test(segment)) continue;
    kept.push(segment);
  }
  return `/${kept.join("/")}`;
}

const lineOf = (sf: ts.SourceFile, node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

const exported = (node: ts.Node) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** Names bound by a declaration, including through `const { GET, POST } = handlers`. */
function boundNames(name: ts.BindingName, into: ts.Identifier[]): void {
  if (ts.isIdentifier(name)) into.push(name);
  else for (const element of name.elements) if (!ts.isOmittedExpression(element)) boundNames(element.name, into);
}

/** The HTTP methods a route handler exports by name, with where each is declared. */
function exportedMethods(sf: ts.SourceFile): { method: HttpMethod; line: number }[] {
  const found: { method: HttpMethod; line: number }[] = [];
  const add = (name: string, node: ts.Node) => {
    if (METHODS.has(name)) found.push({ method: name as HttpMethod, line: lineOf(sf, node) });
  };
  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && exported(statement)) {
      if (!(ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
        add(statement.name.text, statement.name);
      }
    } else if (ts.isVariableStatement(statement) && exported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const names: ts.Identifier[] = [];
        boundNames(declaration.name, names);
        for (const name of names) add(name.text, name);
      }
    } else if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (!element.isTypeOnly && ts.isIdentifier(element.name)) add(element.name.text, element.name);
      }
    }
  }
  return found;
}

/**
 * The basePath every route of the app sits under, read from next.config.
 * "" when there is no config or it never mentions basePath. null when the
 * value is not a plain string in the config, or when the config sets
 * pageExtensions, which changes which files are routes at all.
 */
function basePath(ctx: RepoContext, app: string): string | null {
  const prefix = app === "." ? "" : `${app}/`;
  const configs = [...ctx.files].filter((p) => p.startsWith(prefix) && CONFIG.test(p.slice(prefix.length)));
  if (configs.length === 0) return "";
  if (configs.length > 1) return null;
  const sf = ctx.syntax(configs[0]);
  if (!sf) return null;

  let mentions = 0;
  let value: string | null = null;
  let unreadable = false;
  const visit = (node: ts.Node): void => {
    const name = ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : null;
    if (name === "pageExtensions") unreadable = true;
    if (name === "basePath") mentions++;
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === "basePath"
    ) {
      value = ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer)
        ? node.initializer.text
        : null;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (unreadable) return null;
  if (mentions === 0) return "";
  // One mention, and it is `basePath: "/literal"`. Anything else (a variable,
  // an environment lookup, two definitions) could be several values.
  if (mentions !== 1 || value === null) return null;
  const literal: string = value;
  if (literal === "") return "";
  return literal.startsWith("/") && !literal.endsWith("/") ? literal : null;
}

function routesOf(ctx: RepoContext): Route[] {
  const where = locate(ctx);
  const bases = new Map<string, string | null>();
  const routes: Route[] = [];
  for (const path of ctx.files) {
    const at = where(path);
    if (at === null || !at.routers || roleIn(at.inner, true) !== "API endpoint") continue;
    const segments = at.inner.split("/");
    if (segments[0] !== "app") continue;
    const url = urlPath(segments.slice(1, -1));
    if (url === null) continue;
    if (!bases.has(at.app)) bases.set(at.app, basePath(ctx, at.app));
    const base = bases.get(at.app)!;
    if (base === null) continue;
    const sf = ctx.syntax(path);
    if (!sf) continue;
    const full = base === "" ? url : url === "/" ? base : `${base}${url}`;
    for (const { method, line } of exportedMethods(sf)) routes.push({ method, path: full, file: path, line });
  }
  return routes;
}

export const nextjsAdapter: FrameworkAdapter = {
  name: "nextjs",
  detect: (ctx) => ctx.packageJsons.some((pkg) => dependsOn(pkg.json, "next")),
  // Next.js declares nothing beyond what package.json already does.
  entryPoints: () => [],
  roles: rolesOf,
  routes: routesOf,
};
