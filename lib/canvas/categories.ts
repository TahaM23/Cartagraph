// What sort of thing a file is, for the rail and for colour. Derived from the
// parser's output, never written back into it: the parse result is the
// contract, and this is one reading of it.
//
// Two layers. A file's kind (source, test, types, config, script) is read off
// its name and folder in any repository, and is what it is coloured by. Its
// rail category is the framework's own name for it when the adapter that
// applied gave it a role (Controllers, Page routes), and its kind otherwise,
// so a repository no adapter matched still has a rail, of kinds alone.

import { taxonomyOf, type Kind } from "../parser/adapters/taxonomy.ts";
import type { FileNode } from "../parser/contract.ts";

export type { Kind };

export const KINDS = ["source", "test", "types", "config", "script"] as const satisfies readonly Kind[];

export const KIND_LABELS: Record<Kind, string> = {
  source: "Source",
  test: "Tests",
  types: "Type declarations",
  config: "Config",
  script: "Scripts",
};

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const TEST_DIR = /(^|\/)(__tests__|__mocks__|tests?|e2e)(\/|$)/;
const DECLARATION = /\.d\.[cm]?ts$/;
const CONFIG_FILE = /(^|[./-])config\.[cm]?[jt]s$|^\.?[\w-]+rc\.[cm]?[jt]s$/;
const SCRIPT_DIR = /(^|\/)(scripts|bin)(\/|$)/;

/** First match wins, so a test inside scripts/ is a test. */
export function kindOf(file: FileNode): Kind {
  const name = file.path.slice(file.path.lastIndexOf("/") + 1);
  if (TEST_FILE.test(name) || TEST_DIR.test(file.folder)) return "test";
  if (DECLARATION.test(name)) return "types";
  if (CONFIG_FILE.test(name)) return "config";
  if (SCRIPT_DIR.test(file.folder)) return "script";
  return "source";
}

/** One line of the rail. Plain data, so a server component can hand it to the browser. */
export interface Category {
  id: string;
  label: string;
  /** The colour it draws in. */
  kind: Kind;
}

export interface Rail {
  /** The framework's name as people write it, or null when no adapter applied. */
  framework: string | null;
  /** Every category the rail can show, in its fixed reading order. */
  categories: readonly Category[];
  /** The one category a file is counted in. */
  of(file: FileNode): Category;
}

const KIND_CATEGORIES = Object.fromEntries(
  KINDS.map((kind) => [kind, { id: `kind:${kind}`, label: KIND_LABELS[kind], kind }]),
) as Record<Kind, Category>;

/**
 * The rail for a repository the named adapter applied to. The framework's
 * categories come first, in its taxonomy's reading order: routable surfaces,
 * the layers behind them, its plumbing. The generic kinds follow for every
 * file no role covered. A test is always a test, whatever a convention says
 * of its name.
 */
export function railFor(adapter: string): Rail {
  const taxonomy = taxonomyOf(adapter);
  const byRole = new Map<string, Category>();
  const framework: Category[] = (taxonomy?.categories ?? []).map((entry) => {
    const category = { id: `role:${entry.label}`, label: entry.label, kind: entry.kind };
    for (const role of entry.roles) byRole.set(role, category);
    return category;
  });
  return {
    framework: taxonomy?.framework ?? null,
    categories: [...framework, ...KINDS.map((k) => KIND_CATEGORIES[k])],
    of(file) {
      const kind = kindOf(file);
      if (kind !== "test" && file.role !== null) {
        const category = byRole.get(file.role);
        if (category) return category;
      }
      return KIND_CATEGORIES[kind];
    },
  };
}

/** Every category with at least one file, in the rail's fixed order. */
export function countCategories(files: readonly FileNode[], rail: Rail) {
  const counts = new Map<string, number>();
  for (const file of files) {
    const id = rail.of(file).id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return rail.categories.filter((c) => counts.has(c.id)).map((c) => ({ category: c, files: counts.get(c.id)! }));
}
