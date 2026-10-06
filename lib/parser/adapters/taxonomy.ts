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
  /**
   * Whether the framework loads these files itself, by where they sit or what
   * they are called, so that nothing importing them says nothing about their
   * use. A page is reached this way; a component or a service still has to be
   * imported by something, and one nothing imports is worth pointing out.
   */
  reached: boolean;
  /** The roles the adapter assigns that land here. */
  roles: readonly string[];
}

export interface Taxonomy {
  /** The framework's name as people write it. */
  framework: string;
  categories: readonly TaxonomyEntry[];
}

const REACT_LAYERS = [
  { label: "Components", kind: "source", reached: false, roles: ["component"] },
  { label: "Hooks", kind: "source", reached: false, roles: ["hook"] },
] as const satisfies readonly TaxonomyEntry[];

export const TAXONOMIES = {
  nestjs: {
    framework: "NestJS",
    categories: [
      { label: "Controllers", kind: "source", reached: false, roles: ["controller"] },
      { label: "Resolvers", kind: "source", reached: false, roles: ["resolver"] },
      { label: "Gateways", kind: "source", reached: false, roles: ["gateway"] },
      { label: "Services", kind: "source", reached: false, roles: ["service"] },
      { label: "Repositories", kind: "source", reached: false, roles: ["repository"] },
      { label: "Modules", kind: "source", reached: false, roles: ["module"] },
      { label: "Entities", kind: "source", reached: true, roles: ["entity"] },
      { label: "Schemas", kind: "source", reached: false, roles: ["schema"] },
      { label: "DTOs", kind: "source", reached: false, roles: ["DTO"] },
      { label: "Guards", kind: "source", reached: false, roles: ["guard"] },
      { label: "Interceptors", kind: "source", reached: false, roles: ["interceptor"] },
      { label: "Pipes", kind: "source", reached: false, roles: ["pipe"] },
      { label: "Filters", kind: "source", reached: false, roles: ["exception filter"] },
      { label: "Middleware", kind: "source", reached: false, roles: ["middleware"] },
      { label: "Strategies", kind: "source", reached: false, roles: ["strategy"] },
      { label: "Decorators", kind: "source", reached: false, roles: ["decorator"] },
      { label: "Bootstrap", kind: "source", reached: true, roles: ["bootstrap"] },
    ],
  },
  nextjs: {
    framework: "Next.js",
    categories: [
      { label: "Page routes", kind: "source", reached: true, roles: ["page route"] },
      { label: "API endpoints", kind: "source", reached: true, roles: ["API endpoint"] },
      { label: "Server actions", kind: "source", reached: false, roles: ["server actions"] },
      { label: "Layouts", kind: "source", reached: true, roles: ["layout", "template"] },
      {
        label: "Loading & error UI", kind: "source", reached: true,
        roles: ["loading UI", "error UI", "not-found UI", "forbidden UI", "unauthorized UI", "parallel route fallback"],
      },
      ...REACT_LAYERS,
      { label: "Custom app & document", kind: "source", reached: true, roles: ["custom app", "custom document", "error page"] },
      { label: "Proxy & middleware", kind: "source", reached: true, roles: ["proxy", "middleware"] },
      { label: "Metadata files", kind: "source", reached: true, roles: ["metadata"] },
      { label: "Instrumentation", kind: "source", reached: true, roles: ["instrumentation"] },
      { label: "MDX components", kind: "source", reached: true, roles: ["MDX components"] },
      { label: "Next.js config", kind: "config", reached: true, roles: ["Next.js config"] },
    ],
  },
  express: {
    framework: "Express",
    categories: [
      { label: "Routers", kind: "source", reached: false, roles: ["router"] },
      { label: "Controllers", kind: "source", reached: false, roles: ["controller"] },
      { label: "Services", kind: "source", reached: false, roles: ["service"] },
      { label: "Models", kind: "source", reached: false, roles: ["model"] },
      { label: "Middleware", kind: "source", reached: false, roles: ["middleware"] },
      { label: "Validators", kind: "source", reached: false, roles: ["validator"] },
    ],
  },
  docusaurus: {
    framework: "Docusaurus",
    categories: [
      { label: "Pages", kind: "source", reached: true, roles: ["page"] },
      { label: "Theme components", kind: "source", reached: true, roles: ["theme component"] },
      ...REACT_LAYERS,
      { label: "Docusaurus config", kind: "config", reached: true, roles: ["Docusaurus config"] },
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
