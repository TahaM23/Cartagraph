import { CATEGORY_LABELS, type Category } from "@/lib/canvas/categories";
import { SWATCH } from "./swatch";

/**
 * A kind of file as the interface names it: its swatch, then its name. The
 * rail, a file's kind and a folder's breakdown all draw it through this, so
 * it reads the same everywhere.
 */
export function CategoryLabel({ category, className = "" }: { category: Category; className?: string }) {
  return (
    <>
      <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-[3px] ${SWATCH[category]}`} />
      <span className={className}>{CATEGORY_LABELS[category]}</span>
    </>
  );
}
