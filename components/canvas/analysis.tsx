"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { explainSubject } from "@/app/(app)/analyses/actions";
import type { TracingStatus } from "@/lib/ai/client";
import { railFor, type Rail } from "@/lib/canvas/categories";
import { neighboursOf, summarize, type Neighbours, type RepositorySummary } from "@/lib/canvas/detail";
import { foldRepository } from "@/lib/canvas/fold";
import { findInsights, type Insights } from "@/lib/canvas/insights";
import { buildModel, buildView, groupUnit, rowUnit, type Model, type UnitId, type View } from "@/lib/canvas/view";
import type { Explained, Subject } from "@/lib/explain/types";
import type { Edge, FileNode, Route } from "@/lib/parser/contract";

/** Where one file's or folder's explanation has got to. */
export type ExplanationState =
  | { status: "writing" }
  | { status: "written"; explained: Explained }
  | { status: "failed"; error: string };

/** What the map does when the pane asks it to show something. */
export interface MapHandle {
  focusFile(path: string): void;
  focusDir(dir: string): void;
}

interface AnalysisState {
  /** The stored analysis this is. */
  id: string;
  repository: string;
  model: Model;
  neighbours: Neighbours;
  summary: RepositorySummary;
  insights: Insights;
  /** The framework's categories, and which one each file is counted in. */
  rail: Rail;
  /** Path → the role a model gave a file no convention identified. Never a category. */
  labels: ReadonlyMap<string, string>;
  /** Whether model calls are being recorded, and where. */
  tracing: TracingStatus;
  /**
   * Every explanation asked for since the map loaded, by the unit it
   * explains. Held here, above the selection, so one already fetched is
   * still there when the selection comes back to it.
   */
  explanations: ReadonlyMap<UnitId, ExplanationState>;
  explain(unit: UnitId): void;
  /** Routes the adapter recovered exactly, by pattern. */
  routes: readonly Route[];
  /** The rail's picked category, by id: the map dims every file outside it. */
  category: string | null;
  setCategory: Dispatch<SetStateAction<string | null>>;
  /** Folders open as panels. */
  open: ReadonlySet<string>;
  setOpen: Dispatch<SetStateAction<ReadonlySet<string>>>;
  /** Each open panel's first row in view. */
  scroll: ReadonlyMap<string, number>;
  setScroll: Dispatch<SetStateAction<ReadonlyMap<string, number>>>;
  /** What is on screen for the current open panels and scroll. */
  view: View;
  selected: UnitId | null;
  select: Dispatch<SetStateAction<UnitId | null>>;
  /** Whatever the pointer is over, on the map or in the pane. */
  hovered: UnitId | null;
  hover(unit: UnitId | null): void;
  /** Select a file and bring it into view on the map, opening its folder if need be. */
  focusFile(path: string): void;
  focusDir(dir: string): void;
  /** The map registers how it opens and reveals things. */
  registerMap(handle: MapHandle | null): void;
}

const Context = createContext<AnalysisState | null>(null);

export function useAnalysis(): AnalysisState {
  const state = useContext(Context);
  if (!state) throw new Error("useAnalysis must be used inside <Analysis>");
  return state;
}

/**
 * One analysis on screen: the model both the map and the detail pane read,
 * and the state they share. Everything is derived here, in the browser, once;
 * selecting or hovering never fetches.
 */
export function Analysis({
  id,
  files,
  labels: labelRecord,
  edges,
  routes,
  repository,
  adapter,
  tracing,
  children,
}: {
  id: string;
  files: FileNode[];
  labels: Record<string, string>;
  edges: Pick<Edge, "source" | "target">[];
  routes: Route[];
  repository: string;
  adapter: string;
  tracing: TracingStatus;
  children: ReactNode;
}) {
  const labels = useMemo(() => new Map(Object.entries(labelRecord)), [labelRecord]);
  const model = useMemo(() => buildModel(files, edges, foldRepository(files)), [files, edges]);
  const neighbours = useMemo(() => neighboursOf(model), [model]);
  const rail = useMemo(() => railFor(adapter), [adapter]);
  const summary = useMemo(() => summarize(model, neighbours, rail, routes), [model, neighbours, rail, routes]);
  const insights = useMemo(() => findInsights(model, neighbours, rail), [model, neighbours, rail]);
  const [category, setCategory] = useState<string | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [scroll, setScroll] = useState<ReadonlyMap<string, number>>(() => new Map());
  const view = useMemo(() => buildView(model, open, repository, scroll), [model, open, repository, scroll]);
  const [selected, select] = useState<UnitId | null>(null);
  const [hovered, hover] = useState<UnitId | null>(null);

  const [explanations, setExplanations] = useState<ReadonlyMap<UnitId, ExplanationState>>(() => new Map());
  const explain = useCallback(
    (unit: UnitId) => {
      const set = (state: ExplanationState) => setExplanations((m) => new Map(m).set(unit, state));
      const subject: Subject = unit.startsWith("f:") ? { kind: "file", path: unit.slice(2) } : { kind: "folder", dir: unit.slice(2) };
      set({ status: "writing" });
      explainSubject(id, subject).then(
        (response) => set(response.ok ? { status: "written", explained: response } : { status: "failed", error: response.error }),
        () => set({ status: "failed", error: "The request did not get through. Reload the page and try again." }),
      );
    },
    [id],
  );

  const map = useRef<MapHandle | null>(null);
  const registerMap = useCallback((handle: MapHandle | null) => {
    map.current = handle;
  }, []);
  const focusFile = useCallback((path: string) => {
    if (map.current) map.current.focusFile(path);
    else select(rowUnit(path));
  }, []);
  const focusDir = useCallback((dir: string) => {
    if (map.current) map.current.focusDir(dir);
    else select(groupUnit(dir));
  }, []);

  const value = useMemo(
    () => ({
      id,
      repository,
      model,
      neighbours,
      summary,
      insights,
      rail,
      labels,
      tracing,
      explanations,
      explain,
      routes,
      category,
      setCategory,
      open,
      setOpen,
      scroll,
      setScroll,
      view,
      selected,
      select,
      hovered,
      hover,
      focusFile,
      focusDir,
      registerMap,
    }),
    [id, repository, model, neighbours, summary, insights, rail, labels, tracing, explanations, explain, routes, category, open, scroll, view, selected, hovered, focusFile, focusDir, registerMap],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
