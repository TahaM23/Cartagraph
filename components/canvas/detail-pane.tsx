"use client";

import { useId, useState, type ReactNode } from "react";
import { CATEGORY_LABELS, categoryOf } from "@/lib/canvas/categories";
import { summarizeFolder } from "@/lib/canvas/detail";
import { groupUnit, rowUnit } from "@/lib/canvas/view";
import { useAnalysis } from "./analysis";
import { SWATCH } from "./swatch";

type Tab = "structure" | "explanation";

/** How many starting points show before "show all". */
const STARTING_POINTS = 8;

// Fixed locale: the server and the browser must print the same digits.
const count = new Intl.NumberFormat("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${count.format(n)} ${n === 1 ? one : many}`;

function size(bytes: number) {
  if (bytes < 1024) return plural(bytes, "byte");
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * The right-hand column. With nothing selected it summarises the repository;
 * with a file or folder selected it describes that. The open tab is held here,
 * above the selection, so it survives the selection changing.
 */
export function DetailPane() {
  const { selected, hover } = useAnalysis();
  const [tab, setTab] = useState<Tab>("structure");

  return (
    <div className="flex min-h-full flex-col text-[13px]" onPointerLeave={() => hover(null)}>
      {selected?.startsWith("f:") ? (
        <FileDetail path={selected.slice(2)} tab={tab} setTab={setTab} />
      ) : selected?.startsWith("g:") ? (
        <FolderDetail dir={selected.slice(2)} tab={tab} setTab={setTab} />
      ) : (
        <RepositorySummary />
      )}
    </div>
  );
}

function RepositorySummary() {
  const { repository, summary } = useAnalysis();
  const [allStarts, setAllStarts] = useState(false);
  const starts = allStarts ? summary.startingPoints : summary.startingPoints.slice(0, STARTING_POINTS);

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
        <Stat
          label="Routes"
          value={summary.routes === null ? "—" : count.format(summary.routes)}
          title={summary.routes === null ? "No framework adapter recovered any routes" : undefined}
        />
      </dl>

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
        {starts.map(({ file, reach }) => (
          <PathRow
            key={file.path}
            path={file.path}
            trailing={<Fan n={reach} tone="outgoing" label="files reached through imports" />}
          />
        ))}
        {summary.startingPoints.length > STARTING_POINTS && (
          <li>
            <button
              type="button"
              onClick={() => setAllStarts((v) => !v)}
              className="w-full px-4 py-1 text-left text-accent hover:underline"
            >
              {allStarts ? "Show fewer" : `Show all ${count.format(summary.startingPoints.length)}`}
            </button>
          </li>
        )}
      </Section>

      <p className="px-4 py-3 text-muted-foreground">
        <span className="font-mono text-foreground tabular-nums">{count.format(summary.unidentified)}</span> of{" "}
        {plural(summary.files, "file")} matched no framework convention.
      </p>
    </>
  );
}

function FileDetail({ path, tab, setTab }: { path: string; tab: Tab; setTab: (t: Tab) => void }) {
  const { model, neighbours, focusFile, focusDir, hover } = useAnalysis();
  const file = model.files.get(path)!;
  const imports = neighbours.imports.get(path)!;
  const importedBy = neighbours.importedBy.get(path)!;
  const category = categoryOf(file);
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
                <span aria-hidden="true" className={`size-2 shrink-0 rounded-[2px] ${SWATCH[category]}`} />
                {CATEGORY_LABELS[category]}
                {file.role && <span className="text-muted-foreground">· {file.role}</span>}
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

function FolderDetail({ dir, tab, setTab }: { dir: string; tab: Tab; setTab: (t: Tab) => void }) {
  const { repository, model } = useAnalysis();
  const folder = summarizeFolder(model, dir);

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
                <li key={category} className="flex items-center gap-2 py-0.5">
                  <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-[3px] ${SWATCH[category]}`} />
                  <span className="flex-1">{CATEGORY_LABELS[category]}</span>
                  <span className="font-mono text-muted-foreground tabular-nums">{count.format(files.length)}</span>
                </li>
              ))}
            </ul>
            {folder.kinds.map(({ category, files }) => (
              <Section key={category} title={CATEGORY_LABELS[category]} total={files.length} rows={files.length} empty="">
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
  const { model, view, hovered, hover, focusFile } = useAnalysis();
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
        <span aria-hidden="true" className={`size-2 shrink-0 rounded-[2px] ${SWATCH[categoryOf(file)]}`} />
        <span className="shrink-0">{name}</span>
        <span className="min-w-0 flex-1 truncate text-faint-foreground">{dir}</span>
        {trailing}
      </button>
    </li>
  );
}
