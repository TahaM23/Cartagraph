// Run the parser against a directory and print what it found.
//
//   node lib/parser/cli.ts <directory> [--out result.json] [--all]
//   node lib/parser/cli.ts --check result.json
//
// --out writes the full result and reads it straight back through the
// contract. --check only reads a file back. --all lists every unresolved and
// excluded import instead of the first few per reason.

import path from "node:path";
import { parseArgs } from "node:util";
import type { ParseResult } from "./contract.ts";
import { distinctPairs } from "./graph.ts";
import { docusaurusAdapter } from "./adapters/docusaurus.ts";
import { nextAdapter } from "./adapters/next.ts";
import { viteAdapter } from "./adapters/vite.ts";
import { parseRepository } from "./index.ts";
import { readParseResult, writeParseResult } from "./io.ts";

const EXAMPLES_PER_REASON = 10;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    check: { type: "string" },
    all: { type: "boolean", default: false },
  },
});

const pad = (value: string | number, width: number) => String(value).padStart(width);
const label = (text: string, width = 14) => text.padEnd(width);

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  return groups;
}

function printReasons<T>(
  heading: string,
  items: readonly T[],
  reasonOf: (item: T) => string,
  describe: (item: T) => string,
  showAll: boolean,
) {
  if (items.length === 0) return;
  console.log(`\n  ${heading}`);
  for (const [reason, group] of groupBy(items, reasonOf)) {
    console.log(`    ${label(reason, 28)}${pad(group.length, 6)}`);
    const shown = showAll ? group : group.slice(0, EXAMPLES_PER_REASON);
    for (const item of shown) console.log(`      ${describe(item)}`);
    if (shown.length < group.length) console.log(`      … ${group.length - shown.length} more (--all)`);
  }
}

function report(result: ParseResult, showAll: boolean) {
  const { files: f, imports, notHandled, configs } = result.coverage;
  const folders = new Set(result.files.map((file) => file.folder));
  const packages = new Set(result.files.map((file) => file.package).filter((p) => p !== null));

  console.log(`root     ${result.root}`);
  console.log(`adapter  ${result.adapter}`);

  console.log(`\nFILES`);
  console.log(`  ${label("found")}${pad(f.found, 6)}`);
  console.log(`  ${label("parsed")}${pad(f.parsed, 6)}`);
  console.log(`  ${label("skipped")}${pad(f.skipped, 6)}`);
  const skipped = result.files.filter((file) => !file.parsed);
  printReasons(
    "skip reasons",
    skipped,
    (file) => file.skipReason!,
    (file) => `${file.path}  — ${file.skipDetail}`,
    showAll,
  );
  console.log(`\n  ${label("folders")}${pad(folders.size, 6)}  distinct`);
  console.log(`  ${label("packages")}${pad(packages.size, 6)}  (directories with a package.json)`);
  console.log(`  ${label("other files")}${pad(f.otherFiles, 6)}  not source; never nodes`);
  if (f.ignored.length > 0) {
    console.log(`  ${label("not walked")}${pad(f.ignored.length, 6)}  paths`);
    const shown = showAll ? f.ignored : f.ignored.slice(0, EXAMPLES_PER_REASON);
    for (const p of shown) console.log(`      ${label(p.reason, 16)}${p.path}`);
    if (shown.length < f.ignored.length) console.log(`      … ${f.ignored.length - shown.length} more (--all)`);
  }

  console.log(`\nIMPORTS`);
  console.log(`  ${label("")}${["total", "internal", "external", "excluded", "unresolved"].map((h) => pad(h, 11)).join("")}`);
  const row = (name: string, c: typeof imports) =>
    console.log(
      `  ${label(name)}${[c.total, c.internal, c.external, c.excluded, c.unresolved].map((n) => pad(n, 11)).join("")}`,
    );
  for (const [kind, counts] of Object.entries(imports.byKind)) row(kind, { ...imports, ...counts });
  row("all", imports);

  const reasons = (record: Partial<Record<string, number>>) =>
    Object.entries(record).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
  console.log(`\n  external     ${reasons(imports.externalReasons)}`);
  console.log(`  excluded     ${reasons(imports.excludedReasons)}`);
  console.log(`  unresolved   ${reasons(imports.unresolvedReasons)}`);

  const reExports = imports.byKind.re_export;
  console.log(
    `\n  re-exports   ${reExports.total} found, ${reExports.internal} resolved to files, ` +
      `${reExports.external} external, ${reExports.excluded} excluded, ${reExports.unresolved} unresolved`,
  );

  printReasons(
    "unresolved imports",
    result.unresolved,
    (u) => u.reason,
    (u) => `${u.source}:${u.line}  ${u.kind} "${u.specifier}"  — ${u.detail}`,
    showAll,
  );
  printReasons(
    "excluded imports",
    result.excluded,
    (e) => e.reason,
    (e) => `${e.source}:${e.line}  "${e.specifier}" → ${e.target}`,
    showAll,
  );

  const pairs = distinctPairs(result.edges);
  const typeOnly = result.edges.filter((e) => e.typeOnly).length;
  console.log(`\nEDGES`);
  console.log(`  ${label("edges")}${pad(result.edges.length, 6)}  (${typeOnly} type-only)`);
  console.log(`  ${label("distinct")}${pad(pairs.length, 6)}  source→target pairs; fan-in/out count these`);

  const top = (key: "fanIn" | "fanOut") =>
    [...result.files].sort((a, b) => b[key] - a[key] || (a.path < b.path ? -1 : 1)).slice(0, 5).filter((file) => file[key] > 0);
  console.log(`\n  highest fan-in`);
  for (const file of top("fanIn")) console.log(`    ${pad(file.fanIn, 4)}  ${file.path}`);
  console.log(`  highest fan-out`);
  for (const file of top("fanOut")) console.log(`    ${pad(file.fanOut, 4)}  ${file.path}`);

  const entries = result.files.filter((file) => file.entry);
  if (entries.length > 0) {
    console.log(`\n  entry points (${result.adapter} adapter)`);
    for (const file of entries.slice(0, EXAMPLES_PER_REASON)) console.log(`    ${file.path}  — ${file.entry}`);
  }

  console.log(`\nNOT HANDLED IN THIS VERSION`);
  console.log(`  require()    ${notHandled.require} calls seen, not turned into edges`);

  if (configs.length > 0) {
    console.log(`\nCONFIGS USED FOR RESOLUTION`);
    for (const c of configs) {
      console.log(`  ${c.path}${c.problems.length ? `  — ${c.problems.length} problem(s)` : ""}`);
      for (const p of c.problems) console.log(`      ${p}`);
    }
  }
}

function main() {
  if (values.check) {
    const result = readParseResult(values.check);
    console.log(
      `${values.check}: types hold; ${result.files.length} files, ${result.edges.length} edges, ` +
        `${result.unresolved.length} unresolved, invariants consistent`,
    );
    return;
  }

  const directory = positionals[0];
  if (!directory) {
    console.error("usage: node lib/parser/cli.ts <directory> [--out result.json] [--all]");
    console.error("       node lib/parser/cli.ts --check result.json");
    process.exit(2);
  }

  const started = performance.now();
  const result = parseRepository(directory, { adapters: [nextAdapter, docusaurusAdapter, viteAdapter] });
  const elapsed = Math.round(performance.now() - started);
  report(result, values.all);
  console.log(`\nparsed in ${elapsed} ms`);

  if (values.out) {
    writeParseResult(values.out, result);
    const back = readParseResult(values.out);
    console.log(
      `wrote ${path.resolve(values.out)}; read back: types hold, ` +
        `${back.files.length} files, ${back.edges.length} edges`,
    );
  }
}

main();
