// What explaining hands back, shared by the server that writes it and the
// pane that shows it. No Node or database imports, so the browser can use it.

/**
 * The roles a model may give a file no adapter identified. None of them is
 * structural: page, route and controller decide the route table and the
 * entry-point colouring, and convention owns those. The database refuses any
 * other model-sourced role too.
 */
export const MODEL_ROLES = ["service", "repository", "model", "util", "config", "component", "hook"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

export const isModelRole = (role: string): role is ModelRole => (MODEL_ROLES as readonly string[]).includes(role);

export type Subject = { kind: "file"; path: string } | { kind: "folder"; dir: string };

/**
 * Whether the analysed code is still the repository's. `file` says what
 * happened to an explained file since; it is null for a folder, whose files
 * are not checked one by one.
 */
export type Freshness =
  | { state: "current"; commit: string }
  | { state: "moved"; commit: string; head: string; file: "unchanged" | "changed" | "deleted" | null }
  | { state: "unknown"; commit: string; reason: string };

export interface Explained {
  /** Restricted markdown: inline code, bullets and bold only (lib/explain/markup.ts). */
  body: string;
  /** The exact model that wrote it. */
  model: string;
  /** Served from the cache, with no model call. */
  cached: boolean;
  freshness: Freshness;
}

export type ExplainResponse = ({ ok: true } & Explained) | { ok: false; error: string };
