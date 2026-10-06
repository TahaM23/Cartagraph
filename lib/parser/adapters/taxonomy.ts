// What each framework calls its files, for the rail. Kept apart from the
// adapters, with no imports at all, so the browser can read the category names
// without pulling a parser and a filesystem library into its bundle.
//
// Each adapter assigns roles; this says which rail category each role belongs
// to and in what order the categories read. The order is reading order and it
// is fixed: routable surfaces first, then the layers behind them, then
// plumbing. Names are the framework's own, never abstractions: a NestJS
// reader wants "Controllers", not "Entry points".

/** The colour a category draws in. The rail's generic kinds use the same five. */
export type Kind = "source" | "test" | "types" | "config" | "script";

export interface TaxonomyEntry {
  /** The rail's name for the category. */
  label: string;
  kind: Kind;
  /** The roles the adapter assigns that land here. */
  roles: readonly string[];
}

export interface Taxonomy {
  /** The framework's name as people write it. */
  framework: string;
  categories: readonly TaxonomyEntry[];
}

const REACT_LAYERS = [
  { label: "Components", kind: "source", roles: ["component"] },
  { label: "Hooks", kind: "source", roles: ["hook"] },
] as const satisfies readonly TaxonomyEntry[];

export const TAXONOMIES = {
  nestjs: {
    framework: "NestJS",
    categories: [
      { label: "Controllers", kind: "source", roles: ["controller"] },
      { label: "Resolvers", kind: "source", roles: ["resolver"] },
      { label: "Gateways", kind: "source", roles: ["gateway"] },
      { label: "Services", kind: "source", roles: ["service"] },
      { label: "Repositories", kind: "source", roles: ["repository"] },
      { label: "Modules", kind: "source", roles: ["module"] },
      { label: "Entities", kind: "source", roles: ["entity"] },
      { label: "Schemas", kind: "source", roles: ["schema"] },
      { label: "DTOs", kind: "source", roles: ["DTO"] },
      { label: "Guards", kind: "source", roles: ["guard"] },
      { label: "Interceptors", kind: "source", roles: ["interceptor"] },
      { label: "Pipes", kind: "source", roles: ["pipe"] },
      { label: "Filters", kind: "source", roles: ["exception filter"] },
      { label: "Middleware", kind: "source", roles: ["middleware"] },
      { label: "Strategies", kind: "source", roles: ["strategy"] },
      { label: "Decorators", kind: "source", roles: ["decorator"] },
      { label: "Bootstrap", kind: "source", roles: ["bootstrap"] },
    ],
  },
  nextjs: {
    framework: "Next.js",
    categories: [
      { label: "Page routes", kind: "source", roles: ["page route"] },
      { label: "API endpoints", kind: "source", roles: ["API endpoint"] },
      { label: "Server actions", kind: "source", roles: ["server actions"] },
      { label: "Layouts", kind: "source", roles: ["layout", "template"] },
      {
        label: "Loading & error UI",
        kind: "source",
        roles: ["loading UI", "error UI", "not-found UI", "forbidden UI", "unauthorized UI", "parallel route fallback"],
      },
      ...REACT_LAYERS,
      { label: "Custom app & document", kind: "source", roles: ["custom app", "custom document", "error page"] },
      { label: "Proxy & middleware", kind: "source", roles: ["proxy", "middleware"] },
      { label: "Metadata files", kind: "source", roles: ["metadata"] },
      { label: "Instrumentation", kind: "source", roles: ["instrumentation"] },
      { label: "MDX components", kind: "source", roles: ["MDX components"] },
      { label: "Next.js config", kind: "config", roles: ["Next.js config"] },
    ],
  },
  docusaurus: {
    framework: "Docusaurus",
    categories: [
      { label: "Pages", kind: "source", roles: ["page"] },
      { label: "Theme components", kind: "source", roles: ["theme component"] },
      ...REACT_LAYERS,
      { label: "Docusaurus config", kind: "config", roles: ["Docusaurus config"] },
    ],
  },
  react: {
    framework: "React",
    categories: REACT_LAYERS,
  },
  vite: {
    framework: "Vite",
    categories: [],
  },
} as const satisfies Record<string, Taxonomy>;

export type AdapterName = keyof typeof TAXONOMIES;

/** Every role an adapter may assign: its taxonomy is the whole list. */
export type RoleOf<A extends AdapterName> = (typeof TAXONOMIES)[A]["categories"][number]["roles"][number];

/** The taxonomy for a stored adapter name, or null for the fallback or a name from an older parse. */
export function taxonomyOf(adapter: string): Taxonomy | null {
  return Object.hasOwn(TAXONOMIES, adapter) ? TAXONOMIES[adapter as AdapterName] : null;
}
