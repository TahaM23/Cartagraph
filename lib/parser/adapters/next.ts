// What Next.js knows: which files it reaches by where they sit rather than by
// being imported. Applies per package, so a monorepo with one Next.js app in
// it gets roles for that app's files and nobody else's.

import { dependsOn, type FrameworkAdapter, type RoleAssignment } from "../adapter.ts";

const COMPONENT = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);

/** App Router special files, by name without extension. */
const APP_FILES: Record<string, string> = {
  page: "page",
  layout: "layout",
  template: "template",
  loading: "loading UI",
  error: "error UI",
  "global-error": "error UI",
  "not-found": "not-found UI",
  forbidden: "forbidden UI",
  unauthorized: "unauthorized UI",
  default: "parallel route fallback",
  route: "route handler",
  icon: "metadata",
  "apple-icon": "metadata",
  "opengraph-image": "metadata",
  "twitter-image": "metadata",
  sitemap: "metadata",
  robots: "metadata",
  manifest: "metadata",
};

/** Files read from the project (or src) root. */
const ROOT_FILES: Record<string, string> = {
  middleware: "middleware",
  proxy: "proxy",
  instrumentation: "instrumentation",
  "instrumentation-client": "instrumentation",
  "mdx-components": "MDX components",
};

const PAGES_SPECIAL: Record<string, string> = {
  _app: "custom app",
  _document: "custom document",
  _error: "error page",
};


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

/** `path` relative to `dir`, or null when it is not inside it. */
function within(dir: string, path: string): string | null {
  if (dir === ".") return path;
  return path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : null;
}

/** The role Next.js gives `rel`, a path relative to the project or its src/. */
function roleIn(rel: string): string | null {
  const { dir, name, ext } = split(rel);
  // Dots inside brackets belong to a catch-all segment, "[...slug]".
  if (!COMPONENT.has(ext) || name.replace(/\[[^\]]*\]/g, "").includes(".")) return null;
  if (dir === "." && name in ROOT_FILES) return ROOT_FILES[name];

  const [top, ...rest] = rel.split("/");
  if (top === "app" && rest.length > 0) {
    // A folder starting with "_" is private: nothing inside it is routed.
    if (rest.slice(0, -1).some((s) => s.startsWith("_"))) return null;
    return APP_FILES[name] ?? null;
  }
  if (top === "pages" && rest.length > 0) {
    if (rest.length === 1 && name in PAGES_SPECIAL) return PAGES_SPECIAL[name];
    return rest[0] === "api" ? "API route" : "page";
  }
  return null;
}

export const nextAdapter: FrameworkAdapter = {
  name: "next",
  detect: (ctx) => ctx.packageJsons.some((pkg) => dependsOn(pkg.json, "next")),
  // Next.js declares nothing beyond what package.json already does.
  entryPoints: () => [],
  roles(ctx) {
    // Deepest first, so a file belongs to the nearest app above it.
    const apps = ctx.packageJsons
      .filter((pkg) => dependsOn(pkg.json, "next"))
      .map((pkg) => pkg.dir)
      .sort((a, b) => b.length - a.length);
    const roles: RoleAssignment[] = [];
    for (const path of ctx.files) {
      const app = apps.find((dir) => within(dir, path) !== null);
      if (app === undefined) continue;
      const rel = within(app, path)!;
      // src/ stands in for the project root for app/, pages/ and root files.
      const role = /^next\.config\.[cm]?[jt]s$/.test(rel)
        ? "Next.js config"
        : roleIn(rel.startsWith("src/") ? rel.slice(4) : rel);
      if (role !== null) roles.push({ path, role });
    }
    return roles;
  },
};
