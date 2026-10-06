"use client";

import { useId, useState, type ReactNode } from "react";
import { summarizeFolder } from "@/lib/canvas/detail";
import { walk, WALK_DEPTH } from "@/lib/canvas/graph";
import { INSIGHT_SENTENCES, type Loop } from "@/lib/canvas/insights";
import { groupUnit, rowUnit } from "@/lib/canvas/view";
import type { Route } from "@/lib/parser/contract";
import { useAnalysis } from "./analysis";
import { CategoryLabel } from "./category-label";
import { SWATCH } from "./swatch";

type Tab = "structure" | "explanation";
/** Which transitive walk a file's Structure tab shows, if any. */
type Reach = "blast" | "chain" | null;

/** How many rows a long list shows before "show all". */
const CAPPED_ROWS = 8;

// Fixed locale: the server and the browser must print the same digits.
const count = new Intl.NumberFormat("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${count.format(n)} ${n === 1 ? one : many}`;

function size(bytes: number) {
  if (bytes < 1024) return plural(bytes, "byte");
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * The right-hand column. With nothing selected it summarises the repository;
 * with a file or folder selected it describes that. The open tab, and which
 * walk is showing, are held here, above the selection, so they survive the
 * selection changing.
 */
export function DetailPane() {
  const { selected, hover } = useAnalysis();
  const [tab, setTab] = useState<Tab>("structure");
  const [reach, setReach] = useState<Reach>(null);

  return (
    <div className="flex min-h-full flex-col text-[13px]" onPointerLeave={() => hover(null)}>
      {selected?.startsWith("f:") ? (
        <FileDetail path={selected.slice(2)} tab={tab} setTab={setTab} reach={reach} setReach={setReach} />
      ) : selected?.startsWith("g:") ? (
        <FolderDetail dir={selected.slice(2)} tab={tab} setTab={setTab} />
      ) : (
        <RepositorySummary />
      )}
    </div>
  );
}

function RepositorySummary() {
  const { repository, summary, routes } = useAnalysis();

  return (
    <>
      <Header eyebrow="Repository" title={repository}>
        <p className="text-muted-foreground">
          Framework:{" "}
          <span className="text-foreground">{summary.framework ?? "none detected"}</span>
        </p>
      </Header>

      <dl className="grid grid-cols-3 border-b border-border">
        <Stat label="Files" value={count.format(summary.files)} />
        <Stat label="Imports" value={count.format(summary.imports)} title="Distinct file-to-file imports inside the repository" />
        <Stat label="Routes" value={count.format(summary.routes)} title="Routes whose method and full pattern the code states" />
      </dl>

      <Section
        title="Routes"
        total={routes.length}
        hint="Only where the method and the full pattern are both written in the code. Anything that would have to be guessed is left out."
        rows={routes.length}
        empty={summary.framework ? `No ${summary.framework} route could be read exactly.` : "No framework adapter applied, so no routes."}
      >
        <Capped items={routes} row={(r) => <RouteRow key={`${r.method} ${r.path} ${r.file}:${r.line}`} route={r} />} />
      </Section>

      <Section
        title="Most depended on"
        hint="Ordered by how many files import each one."
        rows={summary.mostDepended.length}
        empty="No file is imported by another."
      >
        {summary.mostDepended.map((f) => (
          <PathRow key={f.path} path={f.path} trailing={<Fan n={f.fanIn} tone="incoming" label="importers" />} />
        ))}
      </Section>

      <Section
        title="Nothing imports these"
        total={summary.startingPoints.length}
        hint="Where reading starts. Entry points first, then source files by how much of the repository each reaches."
        rows={summary.startingPoints.length}
        empty="Every file is imported by something."
      >
        <Capped
          items={summary.startingPoints}
          row={({ file, reach }) => (
            <PathRow
              key={file.path}
              path={file.path}
              trailing={<Fan n={reach} tone="outgoing" label="files reached through imports" />}
            />
          )}
        />
      </Section>

      <p className="px-4 py-3 text-muted-foreground">
        <span className="font-mono text-foreground tabular-nums">{count.format(summary.unidentified)}</span> of{" "}
        {plural(summary.files, "file")} matched no framework convention.
      </p>

      <InsightsPanel />
    </>
  );
}

/**
 * Facts about the edge list, collapsed until asked for and last in the pane:
 * this explains a codebase, it does not grade one. Files nothing imports
 * lead because they explain; cycles and long files read closer to a verdict.
 */
function InsightsPanel() {
  const { insights } = useAnalysis();
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <section className="border-t border-border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-4 py-2.5 text-left font-medium hover:bg-muted"
      >
        <span aria-hidden="true" className={`inline-block w-3 text-muted-foreground ${open ? "rotate-90" : ""}`}>
          ›
        </span>
        Insights
      </button>
      {open && (
        <div id={id}>
          <Section
            title={INSIGHT_SENTENCES.unimported}
            total={insights.unimported.length}
            hint="Pages, routes, entry points, tests, config and scripts are left out: something other than an import reaches them."
            rows={insights.unimported.length}
            empty="None."
          >
            <Capped items={insights.unimported} row={(f) => <PathRow key={f.path} path={f.path} />} />
          </Section>
          <Section
            title={INSIGHT_SENTENCES.unusualFanIn}
            total={insights.unusualFanIn.length}
            hint={`Imported by more than ${count.format(insights.fanInThreshold)} files.`}
            rows={insights.unusualFanIn.length}
            empty="None."
          >
            <Capped
              items={insights.unusualFanIn}
              row={(f) => <PathRow key={f.path} path={f.path} trailing={<Fan n={f.fanIn} tone="incoming" label="importers" />} />}
            />
          </Section>
          <Section
            title={INSIGHT_SENTENCES.cycles}
            total={insights.cycles.length}
            hint="The shortest loop through each group of files that can all reach one another."
            rows={insights.cycles.length}
            empty="None."
          >
            {insights.cycles.map((loop) => (
              <LoopRows key={loop.files[0]} loop={loop} />
            ))}
          </Section>
          <Section
            title={INSIGHT_SENTENCES.long}
            total={insights.long.length}
            rows={insights.long.length}
            empty="None."
          >
            <Capped
              items={insights.long}
              row={(f) => (
                <PathRow
                  key={f.path}
                  path={f.path}
                  trailing={
                    <span className="font-mono text-muted-foreground tabular-nums" title={plural(f.lines, "line")}>
                      {count.format(f.lines)}
                    </span>
                  }
                />
              )}
            />
          </Section>
        </div>
      )}
    </section>
  );
}

/** One loop, in import order: each file imports the one below it, and the last imports the first. */
function LoopRows({ loop }: { loop: Loop }) {
  const first = loop.files[0];
  return (
    <li className="pb-1.5">
      <p
        className="px-4 pt-1 text-[12px] text-muted-foreground tabular-nums"
        title="Every file in the group can reach every other through imports"
      >
        {plural(loop.files.length, "file")} in the loop · {plural(loop.members, "file")} in the group
      </p>
      <ul>
        {loop.files.map((p) => (
          <PathRow key={p} path={p} trailing={<span aria-hidden="true" className="text-outgoing">↓</span>} />
        ))}
        <PathRow path={first} trailing={<span className="text-[11px] text-faint-foreground">back to the first</span>} />
      </ul>
    </li>
  );
}

function FileDetail({
  path,
  tab,
  setTab,
  reach,
  setReach,
}: {
  path: string;
  tab: Tab;
  setTab: (t: Tab) => void;
  reach: Reach;
  setReach: (r: Reach) => void;
}) {
  const { model, neighbours, rail, routes, focusFile, focusDir, hover } = useAnalysis();
  const file = model.files.get(path)!;
  const declared = routes.filter((r) => r.file === path);
  const imports = neighbours.imports.get(path)!;
  const importedBy = neighbours.importedBy.get(path)!;
  const category = rail.of(file);
  const name = path.slice(path.lastIndexOf("/") + 1);
  const group = model.fold.groupOf.get(path)!;

  return (
    <>
      <Header eyebrow="File" title={name}>
        <button
          type="button"
          onClick={() => focusFile(path)}
          className="max-w-full truncate text-left font-mono text-[12px] text-muted-foreground hover:text-accent"
          title={path}
        >
          {path}
        </button>
      </Header>
      <Tabs tab={tab} setTab={setTab}>
        {tab === "structure" ? (
          <>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 border-b border-border px-4 py-3">
              <dt className="text-muted-foreground">Kind</dt>
              <dd className="flex items-center gap-1.5">
                <CategoryLabel category={category} />
                {file.role && file.role.toLowerCase() !== category.label.toLowerCase() && (
                  <span className="text-muted-foreground">· {file.role}</span>
                )}
              </dd>
              {file.entry && (
                <>
                  <dt className="text-muted-foreground">Entry</dt>
                  <dd className="truncate font-mono text-[12px]" title={file.entry}>
                    {file.entry}
                  </dd>
                </>
              )}
              <dt className="text-muted-foreground">Length</dt>
              <dd className="tabular-nums">
                {plural(file.lines, "line")} · {size(file.bytes)}
              </dd>
              <dt className="text-muted-foreground">Folder</dt>
              <dd className="min-w-0">
                <button
                  type="button"
                  onClick={() => focusDir(group)}
                  onPointerEnter={() => hover(groupUnit(group))}
                  onPointerLeave={() => hover(null)}
                  className="max-w-full truncate font-mono text-[12px] hover:text-accent"
                  title="Select this folder on the map"
                >
                  {file.folder === "." ? "(root)" : file.folder}
                </button>
              </dd>
            </dl>

            {!file.parsed && (
              <p className="border-b border-border px-4 py-2 text-muted-foreground">
                Not parsed ({file.skipReason}
                {file.skipDetail ? `: ${file.skipDetail}` : ""}), so its own imports are unknown.
              </p>
            )}

            <dl className="grid grid-cols-2 border-b border-border">
              <Stat label="Imports" value={count.format(imports.length)} tone="outgoing" />
              <Stat label="Imported by" value={count.format(importedBy.length)} tone="incoming" />
            </dl>

            <div className="flex gap-2 border-b border-border px-4 py-2.5">
              <ReachButton
                label="Blast radius"
                title="Everything that breaks if this file changes: what imports it, and what imports those"
                tone="incoming"
                on={reach === "blast"}
                onClick={() => setReach(reach === "blast" ? null : "blast")}
              />
              <ReachButton
                label="Dependency chain"
                title="Everything this file needs: what it imports, and what those import"
                tone="outgoing"
                on={reach === "chain"}
                onClick={() => setReach(reach === "chain" ? null : "chain")}
              />
            </div>
            {reach !== null && <ReachList key={path} path={path} reach={reach} />}

            {declared.length > 0 && (
              <Section title="Routes" total={declared.length} rows={declared.length} empty="">
                {declared.map((r) => (
                  <RouteRow key={`${r.method} ${r.path} ${r.line}`} route={r} />
                ))}
              </Section>
            )}

            <Section title="Imports" total={imports.length} tone="outgoing" rows={imports.length} empty="Imports nothing inside the repository.">
              {imports.map((p) => (
                <PathRow key={p} path={p} />
              ))}
            </Section>
            <Section title="Imported by" total={importedBy.length} tone="incoming" rows={importedBy.length} empty="Nothing in the repository imports this.">
              {importedBy.map((p) => (
                <PathRow key={p} path={p} />
              ))}
            </Section>
          </>
        ) : (
          <Explanation subject="file" />
        )}
      </Tabs>
    </>
  );
}

function ReachButton({
  label,
  title,
  tone,
  on,
  onClick,
}: {
  label: string;
  title: string;
  tone: Tone;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 ${
        on ? "border-accent bg-accent/15 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${TONE_BG[tone]}`} />
      {label}
    </button>
  );
}

/**
 * A file's blast radius or dependency chain: one walk over the edge list, in
 * whichever direction, two levels out. Arithmetic over what the browser
 * already holds, so it is here the moment the button is pressed.
 */
function ReachList({ path, reach }: { path: string; reach: "blast" | "chain" }) {
  const { neighbours } = useAnalysis();
  const levels = walk(path, reach === "blast" ? neighbours.importedBy : neighbours.imports, WALK_DEPTH);
  const total = levels.reduce((n, l) => n + l.length, 0);
  const tone: Tone = reach === "blast" ? "incoming" : "outgoing";

  return (
    <>
      <p className="border-b border-border px-4 py-2 text-muted-foreground">
        {reach === "blast" ? (
          <>
            <span className={`font-mono tabular-nums ${TONE_TEXT[tone]}`}>{count.format(total)}</span>{" "}
            {total === 1 ? "file" : "files"} within {WALK_DEPTH} levels {total === 1 ? "depends" : "depend"} on this one.
          </>
        ) : (
          <>
            This file needs <span className={`font-mono tabular-nums ${TONE_TEXT[tone]}`}>{plural(total, "file")}</span>{" "}
            within {WALK_DEPTH} levels.
          </>
        )}
      </p>
      {levels.map((files, i) => (
        <Section
          key={i}
          title={i === 0 ? (reach === "blast" ? "Imports this directly" : "Imported directly") : `${i + 1} levels out`}
          total={files.length}
          tone={tone}
          rows={files.length}
          empty=""
        >
          <Capped items={files} row={(p) => <PathRow key={p} path={p} />} />
        </Section>
      ))}
    </>
  );
}

function FolderDetail({ dir, tab, setTab }: { dir: string; tab: Tab; setTab: (t: Tab) => void }) {
  const { repository, model, rail } = useAnalysis();
  const folder = summarizeFolder(model, dir, rail);

  return (
    <>
      <Header eyebrow="Folder" title={dir === "." ? `${repository} (root)` : dir}>
        <p className="text-muted-foreground tabular-nums">
          {plural(folder.files, "file")} · {count.format(folder.fanIn)} in · {count.format(folder.fanOut)} out
        </p>
      </Header>
      <Tabs tab={tab} setTab={setTab}>
        {tab === "structure" ? (
          <>
            <ul className="border-b border-border px-4 py-2">
              {folder.kinds.map(({ category, files }) => (
                <li key={category.id} className="flex items-center gap-2 py-0.5">
                  <CategoryLabel category={category} className="flex-1" />
                  <span className="font-mono text-muted-foreground tabular-nums">{count.format(files.length)}</span>
                </li>
              ))}
            </ul>
            {folder.kinds.map(({ category, files }) => (
              <Section key={category.id} title={category.label} total={files.length} rows={files.length} empty="">
                {files.map((p) => (
                  <PathRow key={p} path={p} trailing={<Fan n={model.files.get(p)!.fanIn} tone="incoming" label="importers" />} />
                ))}
              </Section>
            ))}
          </>
        ) : (
          <Explanation subject="folder" />
        )}
      </Tabs>
    </>
  );
}

function Explanation({ subject }: { subject: "file" | "folder" }) {
  return (
    <div className="px-4 py-6">
      <p className="font-medium">No explanation yet</p>
      <p className="mt-1 text-muted-foreground">
        An explanation of this {subject} will be written from its code and the files it is really connected to.
        Nothing writes them yet; Structure above is everything the parser knows.
      </p>
    </div>
  );
}

function Header({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <header className="border-b border-border px-4 py-3">
      <p className="text-[11px] tracking-wide text-faint-foreground uppercase">{eyebrow}</p>
      <h2 className="truncate font-mono text-[14px] font-medium" title={title}>
        {title}
      </h2>
      {children}
    </header>
  );
}

function Tabs({ tab, setTab, children }: { tab: Tab; setTab: (t: Tab) => void; children: ReactNode }) {
  const id = useId();
  const tabs: [Tab, string][] = [
    ["structure", "Structure"],
    ["explanation", "Explanation"],
  ];
  return (
    <>
      <div role="tablist" aria-label="Detail" className="flex gap-4 border-b border-border px-4">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`${id}-${value}`}
            aria-selected={tab === value}
            aria-controls={`${id}-panel`}
            onClick={() => setTab(value)}
            className={`-mb-px border-b-2 py-2 ${
              tab === value
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`}>
        {children}
      </div>
    </>
  );
}

const TONE_TEXT = { incoming: "text-incoming", outgoing: "text-outgoing" } as const;
const TONE_BG = { incoming: "bg-incoming", outgoing: "bg-outgoing" } as const;
type Tone = keyof typeof TONE_TEXT;

function Stat({ label, value, title, tone }: { label: string; value: string; title?: string; tone?: Tone }) {
  return (
    <div className="border-l border-border px-4 py-2.5 first:border-l-0" title={title}>
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className={`font-mono text-[18px] leading-tight tabular-nums ${tone ? TONE_TEXT[tone] : ""}`}>{value}</dd>
    </div>
  );
}

function Section({
  title,
  total,
  hint,
  tone,
  rows,
  empty,
  children,
}: {
  title: string;
  /** Shown beside the title. */
  total?: number;
  hint?: string;
  tone?: Tone;
  /** How many rows there are to list; none shows `empty` instead. */
  rows: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border py-2 last:border-b-0">
      <h3 className="flex items-center gap-1.5 px-4 font-medium">
        {tone && <span aria-hidden="true" className={`size-1.5 rounded-full ${TONE_BG[tone]}`} />}
        {title}
        {total !== undefined && (
          <span className="font-mono font-normal text-muted-foreground tabular-nums">{count.format(total)}</span>
        )}
      </h3>
      {hint && <p className="px-4 text-[12px] text-muted-foreground">{hint}</p>}
      {rows === 0 ? (
        empty && <p className="px-4 pt-1 text-faint-foreground">{empty}</p>
      ) : (
        <ul className="mt-1">{children}</ul>
      )}
    </section>
  );
}

/** A long list's first rows, with a button for the rest. */
function Capped<T>({ items, row }: { items: readonly T[]; row: (item: T) => ReactNode }) {
  const [all, setAll] = useState(false);
  return (
    <>
      {(all ? items : items.slice(0, CAPPED_ROWS)).map(row)}
      {items.length > CAPPED_ROWS && (
        <li>
          <button
            type="button"
            onClick={() => setAll((v) => !v)}
            className="w-full px-4 py-1 text-left text-accent hover:underline"
          >
            {all ? "Show fewer" : `Show all ${count.format(items.length)}`}
          </button>
        </li>
      )}
    </>
  );
}

function Fan({ n, tone, label }: { n: number; tone: Tone; label: string }) {
  return (
    <span className={`font-mono tabular-nums ${TONE_TEXT[tone]}`} title={`${count.format(n)} ${label}`}>
      {count.format(n)}
    </span>
  );
}

/**
 * A file path in the pane. Clicking moves the map's selection to it; hovering
 * lights it on the map, and it lights when the map hovers whatever draws it.
 */
function PathRow({ path, trailing }: { path: string; trailing?: ReactNode }) {
  const { model, view, rail, hovered, hover, focusFile } = useAnalysis();
  const file = model.files.get(path)!;
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const dir = slash === -1 ? "" : path.slice(0, slash);
  const hot =
    hovered === rowUnit(path) || hovered === view.anchor.get(path) || hovered === groupUnit(model.fold.groupOf.get(path)!);

  return (
    <li>
      <button
        type="button"
        title={path}
        onClick={() => {
          hover(null);
          focusFile(path);
        }}
        onPointerEnter={() => hover(rowUnit(path))}
        onPointerLeave={() => hover(null)}
        className={`flex w-full items-center gap-2 px-4 py-[3px] text-left font-mono text-[12px] ${
          hot ? "bg-accent/15" : "hover:bg-muted"
        }`}
      >
        <span aria-hidden="true" className={`size-2 shrink-0 rounded-[2px] ${SWATCH[rail.of(file).kind]}`} />
        <span className="shrink-0">{name}</span>
        <span className="min-w-0 flex-1 truncate text-faint-foreground">{dir}</span>
        {trailing}
      </button>
    </li>
  );
}

/**
 * One route: its method and full pattern as the code writes them, and where.
 * Clicking it selects the declaring file, so the claim can be checked against
 * the line it came from.
 */
function RouteRow({ route }: { route: Route }) {
  const { hovered, hover, focusFile } = useAnalysis();
  const where = `${route.file}:${route.line}`;
  return (
    <li>
      <button
        type="button"
        title={`Declared at ${where}`}
        onClick={() => {
          hover(null);
          focusFile(route.file);
        }}
        onPointerEnter={() => hover(rowUnit(route.file))}
        onPointerLeave={() => hover(null)}
        className={`grid w-full grid-cols-[4.25rem_minmax(0,1fr)] gap-x-2 px-4 py-[3px] text-left font-mono text-[12px] ${
          hovered === rowUnit(route.file) ? "bg-accent/15" : "hover:bg-muted"
        }`}
      >
        <span className="text-muted-foreground">{route.method}</span>
        <span className="truncate">{route.path}</span>
        <span className="col-start-2 truncate text-[11px] text-faint-foreground">{where}</span>
      </button>
    </li>
  );
}
