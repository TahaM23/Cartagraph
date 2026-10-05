// What Vite knows: an app starts from the module scripts its index.html loads,
// which no import statement ever names.

import { readFileSync } from "node:fs";
import path from "node:path";
import { dependsOn, type EntryPoint, type FrameworkAdapter } from "../adapter.ts";

const SCRIPT = /<script\b([^>]*)>/gi;
const MODULE = /\btype\s*=\s*["']module["']/i;
const SRC = /\bsrc\s*=\s*["']([^"']+)["']/i;

/** The module scripts an HTML file loads, as written. */
function moduleScripts(html: string): string[] {
  const found: string[] = [];
  for (const [, attrs] of html.matchAll(SCRIPT)) {
    const src = SRC.exec(attrs)?.[1];
    if (src && MODULE.test(attrs) && !/^([a-z]+:)?\/\//i.test(src)) found.push(src.split(/[?#]/)[0]);
  }
  return found;
}

export const viteAdapter: FrameworkAdapter = {
  name: "vite",
  detect: (ctx) => ctx.packageJsons.some((pkg) => dependsOn(pkg.json, "vite")),
  entryPoints(ctx) {
    const entries: EntryPoint[] = [];
    // Vite is often installed once at a workspace root and serves apps in
    // packages below it, so every package's index.html is read.
    for (const { dir } of ctx.packageJsons) {
      const html = path.posix.join(dir, "index.html");
      let text: string;
      try {
        text = readFileSync(path.join(ctx.root, html), "utf8");
      } catch {
        continue;
      }
      for (const src of moduleScripts(text)) {
        // A leading "/" is the Vite root, which is where index.html sits.
        const rel = path.posix.normalize(path.posix.join(dir, src.replace(/^\//, "")));
        if (ctx.files.has(rel)) entries.push({ path: rel, reason: `${html} <script type="module">` });
      }
    }
    return entries;
  },
  roles: () => [],
};
