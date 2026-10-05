// What sort of thing a file is, for colour. Derived from the parser's output,
// never written back into it: the parse result is the contract, and this is
// one reading of it.

import type { FileNode } from "@/lib/parser/contract.ts";

export const CATEGORIES = ["source", "test", "types", "config", "script"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
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
export function categoryOf(file: FileNode): Category {
  const name = file.path.slice(file.path.lastIndexOf("/") + 1);
  if (TEST_FILE.test(name) || TEST_DIR.test(file.folder)) return "test";
  if (DECLARATION.test(name)) return "types";
  if (CONFIG_FILE.test(name)) return "config";
  if (SCRIPT_DIR.test(file.folder)) return "script";
  return "source";
}

/** Every category with at least one file, in the fixed order above. */
export function countCategories(files: readonly FileNode[]) {
  const counts = new Map<Category, number>();
  for (const file of files) {
    const c = categoryOf(file);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return CATEGORIES.filter((c) => counts.has(c)).map((c) => ({
    category: c,
    files: counts.get(c)!,
  }));
}
