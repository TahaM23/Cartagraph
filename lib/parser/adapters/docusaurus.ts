// What Docusaurus knows: files under src/pages become pages, files under
// src/theme replace the theme's own components, and the site's config and
// sidebars are read by the build. None of them is imported by anything.
// Everything else is React, and gets React's roles.

import { dependsOn, type FrameworkAdapter, type RoleAssignment } from "../adapter.ts";
import { reactRoles } from "./react.ts";
import type { RoleOf } from "./taxonomy.ts";

const COMPONENT = /\.[cm]?[jt]sx?$/;
const CONFIG = /^(docusaurus\.config|sidebars)\.[cm]?[jt]s$/;

export const docusaurusAdapter: FrameworkAdapter = {
  name: "docusaurus",
  detect: (ctx) => ctx.packageJsons.some((pkg) => dependsOn(pkg.json, "@docusaurus/core")),
  entryPoints: () => [],
  roles(ctx) {
    const sites = ctx.packageJsons.filter((pkg) => dependsOn(pkg.json, "@docusaurus/core")).map((pkg) => pkg.dir);
    const roles: RoleAssignment[] = [];
    for (const path of ctx.files) {
      for (const site of sites) {
        const prefix = site === "." ? "" : `${site}/`;
        if (!path.startsWith(prefix)) continue;
        const rel = path.slice(prefix.length);
        if (!COMPONENT.test(rel) || rel.endsWith(".d.ts")) continue;
        let role: RoleOf<"docusaurus"> | null = null;
        if (CONFIG.test(rel)) role = "Docusaurus config";
        // Files and folders starting with "_" are excluded from routing.
        else if (rel.startsWith("src/pages/") && !rel.slice(10).split("/").some((s) => s.startsWith("_"))) role = "page";
        else if (rel.startsWith("src/theme/")) role = "theme component";
        if (role !== null) {
          roles.push({ path, role });
          break;
        }
      }
    }
    const claimed = new Set(roles.map((r) => r.path));
    return [...roles, ...reactRoles(ctx, (path) => claimed.has(path))];
  },
  routes: () => [],
};
