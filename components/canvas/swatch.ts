import type { Category } from "@/lib/canvas/categories";

// Tailwind only sees class names written out in full.
export const SWATCH: Record<Category, string> = {
  source: "bg-cat-source",
  test: "bg-cat-test",
  types: "bg-cat-types",
  config: "bg-cat-config",
  script: "bg-cat-script",
};
