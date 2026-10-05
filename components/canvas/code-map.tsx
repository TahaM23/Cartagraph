"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CATEGORIES, categoryOf } from "@/lib/canvas/categories";
import {
  arrange,
  edgePath,
  aboveText,
  moreText,
  nodeMeta,
  panelMeta,
  place,
  HEADER_H,
  LABEL_PX,
  META_PX,
  ROW_H,
  ROW_PX,
  type Layout,
  type Rect,
} from "@/lib/canvas/layout";
import {
  buildView,
  groupUnit,
  aboveUnit,
  maxScroll,
  moreUnit,
  panelOrder,
  rowUnit,
  scrollTo,
  type Box,
  type Model,
  type UnitId,
} from "@/lib/canvas/view";
import { useAnalysis } from "./analysis";
import { SWATCH } from "./swatch";

type Transform = { x: number; y: number; k: number };

const MIN_K = 0.15;
const MAX_K = 2;
/** Fitting magnifies a small graph to use the canvas, but only this far. */
const MAX_FIT_K = 1.5;
const FIT_PAD = 40;
const DRAG_SLOP = 3;
// Dimming fades a box's contents, never its background: a translucent box
// would let the edges behind it show through.
const DIM = "*:opacity-25";
/** A unit hovered here or in the detail pane. */
const HOT_BOX = "ring-2 ring-accent";
const HOT_ROW = "bg-muted ring-1 ring-inset ring-accent";

function fit(r: Rect, vw: number, vh: number, maxK: number, pad: number): Transform {
  const k = Math.max(MIN_K, Math.min(maxK, (vw - 2 * pad) / r.w, (vh - 2 * pad) / r.h));
  return { k, x: vw / 2 - (r.x + r.w / 2) * k, y: vh / 2 - (r.y + r.h / 2) * k };
}

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

function layoutFor(
  model: Model,
  columns: string[][],
  open: ReadonlySet<string>,
  scroll: ReadonlyMap<string, number>,
  repository: string,
) {
  const view = buildView(model, open, repository, scroll);
  return { view, layout: place(columns, view) };
}

/**
 * After opening or focusing something: if it is already in view, nothing moves. Otherwise
 * fit the union of what was on screen and the panel. That union contains the
 * old view, so this can only zoom out — fitting the panel alone would zoom
 * into it and lose the rest of the graph.
 */
function revealPanel(t: Transform, panel: Rect, vw: number, vh: number): Transform {
  const margin = 24;
  const target = { x: panel.x - margin, y: panel.y - margin, w: panel.w + 2 * margin, h: panel.h + 2 * margin };
  const seen = { x: -t.x / t.k, y: -t.y / t.k, w: vw / t.k, h: vh / t.k };
  if (contains(seen, target)) return t;
  return fit(union(seen, target), vw, vh, t.k, 0);
}

export function CodeMap() {
  const {
    repository,
    model,
    open,
    setOpen,
    scroll,
    setScroll,
    view,
    selected,
    select: setSelected,
    hovered,
    hover,
    registerMap,
  } = useAnalysis();
  const columns = useMemo(() => arrange(model), [model]);
  const layout = useMemo(() => place(columns, view), [columns, view]);
  const [transform, setTransform] = useState<Transform | null>(null);

  const viewport = useRef<HTMLDivElement>(null);
  const size = useRef({ w: 0, h: 0 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  /** Wheel distance not yet turned into whole rows, for the panel under the cursor. */
  const wheelRows = useRef({ dir: "", px: 0 });

  // First fit, against the folded map, measured and applied before the first
  // paint. It must not wait for a ResizeObserver callback: until there is a
  // transform the map is hidden, and hidden elements take no clicks. Those
  // callbacks can be late or, in a tab opened in the background, not come at
  // all, which left every node unclickable. The observer only keeps the size
  // current, and covers a viewport that measured zero here.
  const initialLayout = useRef<Layout>(layout);
  useLayoutEffect(() => {
    const el = viewport.current!;
    const fitInitial = (width: number, height: number) => {
      size.current = { w: width, h: height };
      if (width === 0 || height === 0) return;
      const l = initialLayout.current;
      setTransform((t) => t ?? fit({ x: 0, y: 0, w: l.width, h: l.height }, width, height, MAX_FIT_K, FIT_PAD));
    };
    fitInitial(el.clientWidth, el.clientHeight);
    const observer = new ResizeObserver(([entry]) => fitInitial(entry.contentRect.width, entry.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Plain wheel pans (two-finger scroll), except over a panel with more files
  // than it shows, where it scrolls the rows a whole row at a time. Pinch or
  // ctrl/cmd+wheel zooms at the cursor. Registered by hand because React's
  // wheel listener is passive.
  useEffect(() => {
    const el = viewport.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const panel = (e.target as Element).closest<HTMLElement>("[data-scroll]");
      if (panel && !e.ctrlKey && !e.metaKey) {
        const dir = panel.dataset.scroll!;
        const acc = wheelRows.current;
        if (acc.dir !== dir) Object.assign(acc, { dir, px: 0 });
        acc.px += e.deltaY;
        const steps = Math.trunc(acc.px / ROW_H);
        if (steps === 0) return;
        acc.px -= steps * ROW_H;
        const limit = maxScroll(Number(panel.dataset.files));
        setScroll((prev) => {
          const at = Math.min(limit, Math.max(0, (prev.get(dir) ?? 0) + steps));
          return at === (prev.get(dir) ?? 0) ? prev : new Map(prev).set(dir, at);
        });
        return;
      }
      const bounds = el.getBoundingClientRect();
      const px = e.clientX - bounds.left;
      const py = e.clientY - bounds.top;
      setTransform((t) => {
        if (!t) return t;
        if (!e.ctrlKey && !e.metaKey) return { ...t, x: t.x - e.deltaX, y: t.y - e.deltaY };
        const k = Math.min(MAX_K, Math.max(MIN_K, t.k * Math.exp(-e.deltaY * 0.01)));
        return { k, x: px - ((px - t.x) * k) / t.k, y: py - ((py - t.y) * k) / t.k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setScroll]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSelected]);

  function openDir(dir: string) {
    const next = new Set(open).add(dir);
    // The refit reads the layout *after* the change, computed here rather than
    // from state that hasn't updated yet.
    const after = layoutFor(model, columns, next, scroll, repository).layout;
    setOpen(next);
    // Clicking a folded node both opens and selects it.
    setSelected(groupUnit(dir));
    setTransform((t) => t && revealPanel(t, after.boxes.get(dir)!, size.current.w, size.current.h));
  }

  function closeDir(dir: string) {
    const next = new Set(open);
    next.delete(dir);
    setOpen(next);
    setScroll((prev) => {
      const rest = new Map(prev);
      rest.delete(dir);
      return rest;
    });
    // A selection inside the panel becomes the folded node it closes into.
    setSelected((s) =>
      s === groupUnit(dir) || (s !== null && model.fold.groupOf.get(s.slice(2)) === dir && s.startsWith("f:"))
        ? groupUnit(dir)
        : s,
    );
  }

  function focusFile(path: string) {
    const dir = model.fold.groupOf.get(path)!;
    const order = panelOrder(model, dir);
    const current = scroll.get(dir) ?? 0;
    const at = scrollTo(order.length, order.indexOf(path), open.has(dir) ? current : 0);
    const nextOpen = open.has(dir) ? open : new Set(open).add(dir);
    const nextScroll = at === current ? scroll : new Map(scroll).set(dir, at);
    const after = layoutFor(model, columns, nextOpen, nextScroll, repository).layout;
    setOpen(nextOpen);
    setScroll(nextScroll);
    setSelected(rowUnit(path));
    setTransform((t) => t && revealPanel(t, after.boxes.get(dir)!, size.current.w, size.current.h));
  }

  function focusDir(dir: string) {
    setSelected(groupUnit(dir));
    setTransform((t) => t && revealPanel(t, layout.boxes.get(dir)!, size.current.w, size.current.h));
  }

  function zoomBy(factor: number) {
    const { w, h } = size.current;
    setTransform((t) => {
      if (!t) return t;
      const k = Math.min(MAX_K, Math.max(MIN_K, t.k * factor));
      return { k, x: w / 2 - ((w / 2 - t.x) * k) / t.k, y: h / 2 - ((h / 2 - t.y) * k) / t.k };
    });
  }

  function fitAll() {
    const { w, h } = size.current;
    setTransform(fit({ x: 0, y: 0, w: layout.width, h: layout.height }, w, h, MAX_FIT_K, FIT_PAD));
  }

  // The detail pane selects through these, so a file picked there is opened,
  // scrolled to and brought into view here, the same as clicking it would.
  useEffect(() => {
    registerMap({ focusFile, focusDir });
    return () => registerMap(null);
  });

  // What the selection covers on screen. A file is its row. A folder is its
  // node while folded and every row of its panel while open, so selecting it
  // survives opening and closing.
  const chosen = useMemo(() => {
    if (selected === null) return null;
    const box = view.boxes.find((b) => groupUnit(b.dir) === selected);
    if (box) {
      if (!box.open) return new Set([selected]);
      return new Set(panelUnits(box));
    }
    return layout.units.has(selected) ? new Set([selected]) : null;
  }, [selected, view.boxes, layout.units]);

  // Selection keeps the selected thing, its edges, and whatever they reach.
  const related = useMemo(() => {
    if (chosen === null) return null;
    const keep = new Set(chosen);
    for (const l of view.links) {
      if (chosen.has(l.source)) keep.add(l.target);
      if (chosen.has(l.target)) keep.add(l.source);
    }
    return keep;
  }, [chosen, view.links]);
  const dim = (unit: UnitId) => (related && !related.has(unit) ? DIM : "");
  // A hovered file lights whatever it is drawn as: its row, its folded node,
  // or the line standing in for it in a scrolled panel.
  const hot = (unit: UnitId) =>
    hovered === unit || (hovered?.startsWith("f:") === true && view.anchor.get(hovered.slice(2)) === unit);
  const hoverProps = (unit: UnitId) => ({
    onPointerEnter: () => hover(unit),
    onPointerLeave: () => hover(null),
  });

  return (
    <div
      ref={viewport}
      className="absolute inset-0 cursor-grab touch-none overflow-hidden select-none active:cursor-grabbing"
      onPointerDown={(e) => {
        if (!transform || (e.target as Element).closest("[data-unit]")) return;
        drag.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (Math.abs(dx) + Math.abs(dy) > DRAG_SLOP) d.moved = true;
        if (d.moved) setTransform((t) => t && { ...t, x: d.tx + dx, y: d.ty + dy });
      }}
      onPointerUp={() => {
        // A click on empty canvas, as opposed to a drag, clears the selection.
        if (drag.current && !drag.current.moved) setSelected(null);
        drag.current = null;
      }}
    >
      <div
        className={`absolute top-0 left-0 origin-top-left ${transform ? "" : "invisible"}`}
        style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})` } : undefined}
      >
        <svg
          className="pointer-events-none absolute top-0 left-0 overflow-visible"
          width={layout.width}
          height={layout.height}
          aria-hidden="true"
        >
          <defs>
            {(["plain", "in", "out"] as const).map((tone) => (
              <marker
                key={tone}
                id={`cg-arrow-${tone}`}
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L8,4 L0,8 z" style={{ fill: `var(${TONE_VAR[tone]})` }} />
              </marker>
            ))}
          </defs>
          {view.links.map((l) => {
            // Into the selection is incoming, out of it outgoing. An edge
            // inside it (row to row in a selected panel) is lit but neither.
            const fromChosen = chosen?.has(l.source) ?? false;
            const toChosen = chosen?.has(l.target) ?? false;
            const lit = fromChosen || toChosen;
            const tone = fromChosen === toChosen ? "plain" : toChosen ? "in" : "out";
            return (
              <path
                key={`${l.source}\0${l.target}`}
                d={edgePath(layout.units.get(l.source)!, layout.units.get(l.target)!)}
                fill="none"
                strokeWidth={Math.min(1.75, 0.75 + 0.2 * Math.log2(l.pairs))}
                markerEnd={`url(#cg-arrow-${tone})`}
                className={`transition-opacity ${chosen === null ? "opacity-60" : lit ? "" : "opacity-10"}`}
                style={{ stroke: `var(${TONE_VAR[tone]})` }}
              />
            );
          })}
        </svg>

        {view.boxes.map((box) => {
          const rect = layout.boxes.get(box.dir)!;
          const label = view.labels.get(groupUnit(box.dir))!;
          const title = box.dir === "." ? `${repository} (root)` : box.dir;
          const position = { left: rect.x, top: rect.y, width: rect.w, height: rect.h };

          if (!box.open) {
            const unit = groupUnit(box.dir);
            const isSelected = unit === selected;
            return (
              <button
                key={box.dir}
                type="button"
                data-unit
                title={title}
                aria-expanded={false}
                aria-pressed={isSelected}
                onClick={() => openDir(box.dir)}
                {...hoverProps(unit)}
                style={position}
                className={`absolute flex flex-col justify-center overflow-hidden rounded-md border bg-background px-3 text-left whitespace-nowrap *:transition-opacity hover:border-accent ${
                  isSelected ? "border-accent" : "border-border"
                } ${hot(unit) ? HOT_BOX : ""} ${dim(unit)}`}
              >
                <span className="font-mono leading-tight" style={{ fontSize: LABEL_PX }}>
                  {label}
                </span>
                <span className="font-mono leading-tight text-muted-foreground" style={{ fontSize: META_PX }}>
                  {nodeMeta(box)}
                </span>
                <CategoryBar files={box.files} model={model} />
              </button>
            );
          }

          const panelLit = !related || panelUnits(box).some((u) => related.has(u));
          return (
            <div
              key={box.dir}
              style={position}
              data-scroll={maxScroll(box.files.length) > 0 ? box.dir : undefined}
              data-files={box.files.length}
              className={`absolute overflow-hidden rounded-md border bg-background shadow-sm ${
                selected === groupUnit(box.dir) ? "border-accent" : "border-border"
              } ${hot(groupUnit(box.dir)) ? HOT_BOX : ""}`}
            >
              <button
                type="button"
                data-unit
                title={`${title} — click to close`}
                aria-expanded
                onClick={() => closeDir(box.dir)}
                {...hoverProps(groupUnit(box.dir))}
                style={{ height: HEADER_H }}
                className={`flex w-full flex-col justify-center border-b border-border bg-muted px-3 text-left whitespace-nowrap *:transition-opacity hover:text-accent ${panelLit ? "" : DIM}`}
              >
                <span className="font-mono leading-tight font-medium" style={{ fontSize: LABEL_PX }}>
                  {label}
                </span>
                <span className="font-mono leading-tight text-muted-foreground" style={{ fontSize: META_PX }}>
                  {panelMeta(box)}
                </span>
              </button>
              {box.above > 0 && (
                <div
                  style={{ height: ROW_H, fontSize: ROW_PX }}
                  className={`flex items-center border-b border-border px-3 text-muted-foreground *:transition-opacity ${hot(aboveUnit(box.dir)) ? HOT_ROW : ""} ${dim(aboveUnit(box.dir))}`}
                >
                  {aboveText(box)}
                </div>
              )}
              {box.rows.map((path) => {
                const unit = rowUnit(path);
                const file = model.files.get(path)!;
                const isSelected = unit === selected;
                return (
                  <button
                    key={path}
                    type="button"
                    data-unit
                    title={path}
                    aria-pressed={isSelected}
                    onClick={() => setSelected(isSelected ? null : unit)}
                    {...hoverProps(unit)}
                    style={{ height: ROW_H, fontSize: ROW_PX }}
                    className={`flex w-full items-center gap-1.5 px-3 text-left font-mono whitespace-nowrap *:transition-opacity ${
                      isSelected ? "bg-accent/15 text-foreground" : "hover:bg-muted"
                    } ${hot(unit) ? HOT_ROW : ""} ${dim(unit)}`}
                  >
                    <span aria-hidden="true" className={`size-2 shrink-0 rounded-[2px] ${SWATCH[categoryOf(file)]}`} />
                    <span className="flex-1">{view.labels.get(unit)}</span>
                    <span className="text-muted-foreground tabular-nums" title="Files that import this one">
                      {file.fanIn}
                    </span>
                  </button>
                );
              })}
              {box.hidden > 0 && (
                <div
                  style={{ height: ROW_H, fontSize: ROW_PX }}
                  title="Scroll the panel to see more"
                  className={`flex items-center border-t border-border px-3 text-muted-foreground *:transition-opacity ${hot(moreUnit(box.dir)) ? HOT_ROW : ""} ${dim(moreUnit(box.dir))}`}
                >
                  {moreText(box)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="absolute right-3 bottom-3 flex overflow-hidden rounded-md border border-border bg-background text-muted-foreground" data-unit>
        <MapButton label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>−</MapButton>
        <MapButton label="Zoom in" onClick={() => zoomBy(1.25)}>+</MapButton>
        <MapButton label="Fit to view" onClick={fitAll}>fit</MapButton>
      </div>
    </div>
  );
}

/** Every unit an open panel draws: the rows in view and the lines standing in for the rest. */
function panelUnits(box: Box): UnitId[] {
  return [
    ...(box.above > 0 ? [aboveUnit(box.dir)] : []),
    ...box.rows.map(rowUnit),
    ...(box.hidden > 0 ? [moreUnit(box.dir)] : []),
  ];
}

const TONE_VAR = { plain: "--faint-foreground", in: "--incoming", out: "--outgoing" } as const;

function MapButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="min-w-8 border-l border-border px-2 py-1 font-mono text-[12px] first:border-l-0 hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

/** What a node is made of, by kind of file, as a strip along its bottom edge. */
function CategoryBar({ files, model }: { files: string[]; model: Model }) {
  const counts = new Map<string, number>();
  for (const p of files) {
    const c = categoryOf(model.files.get(p)!);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return (
    <span aria-hidden="true" className="absolute inset-x-0 bottom-0 flex h-[3px]">
      {CATEGORIES.filter((c) => counts.has(c)).map((c) => (
        <span key={c} className={SWATCH[c]} style={{ flexGrow: counts.get(c) }} />
      ))}
    </span>
  );
}
