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
import { neighboursOf, summarize, type Neighbours, type RepositorySummary } from "@/lib/canvas/detail";
import { foldRepository } from "@/lib/canvas/fold";
import { buildModel, buildView, groupUnit, rowUnit, type Model, type UnitId, type View } from "@/lib/canvas/view";
import type { Edge, FileNode } from "@/lib/parser/contract";

/** What the map does when the pane asks it to show something. */
export interface MapHandle {
  focusFile(path: string): void;
  focusDir(dir: string): void;
}

interface AnalysisState {
  repository: string;
  model: Model;
  neighbours: Neighbours;
  summary: RepositorySummary;
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
  files,
  edges,
  repository,
  adapter,
  children,
}: {
  files: FileNode[];
  edges: Pick<Edge, "source" | "target">[];
  repository: string;
  adapter: string;
  children: ReactNode;
}) {
  const model = useMemo(() => buildModel(files, edges, foldRepository(files)), [files, edges]);
  const neighbours = useMemo(() => neighboursOf(model), [model]);
  const summary = useMemo(() => summarize(model, neighbours, adapter), [model, neighbours, adapter]);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [scroll, setScroll] = useState<ReadonlyMap<string, number>>(() => new Map());
  const view = useMemo(() => buildView(model, open, repository, scroll), [model, open, repository, scroll]);
  const [selected, select] = useState<UnitId | null>(null);
  const [hovered, hover] = useState<UnitId | null>(null);

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
      repository,
      model,
      neighbours,
      summary,
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
    [repository, model, neighbours, summary, open, scroll, view, selected, hovered, focusFile, focusDir, registerMap],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
