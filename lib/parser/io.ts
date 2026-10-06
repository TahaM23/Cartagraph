// Writing the result out and reading it back. Reading validates the shape
// against the contract and then checks that the numbers agree with each
// other, so a file that parses but lies is rejected too.

import fs from "node:fs";
import path from "node:path";
import { ParseResult } from "./contract.ts";
import { computeFan } from "./graph.ts";

export function writeParseResult(file: string, result: ParseResult): void {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ParseResult.parse(result), null, 2) + "\n");
}

export function readParseResult(file: string): ParseResult {
  const result = ParseResult.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  const problems = checkInvariants(result);
  if (problems.length > 0) {
    throw new Error(`${file} is not a consistent parse result:\n- ${problems.join("\n- ")}`);
  }
  return result;
}

const sum = (values: Partial<Record<string, number>>) =>
  Object.values(values).reduce<number>((a, b) => a + (b ?? 0), 0);

/** Relationships the contract's types can't express. Empty means consistent. */
export function checkInvariants(result: ParseResult): string[] {
  const problems: string[] = [];
  const { files: fileCov, imports } = result.coverage;
  const paths = new Set(result.files.map((f) => f.path));
  const parsed = new Set(result.files.filter((f) => f.parsed).map((f) => f.path));

  if (paths.size !== result.files.length) problems.push("duplicate file paths");
  if (fileCov.found !== result.files.length) problems.push("found != number of files");
  if (fileCov.found !== fileCov.parsed + fileCov.skipped) problems.push("found != parsed + skipped");
  if (fileCov.parsed !== parsed.size) problems.push("parsed count disagrees with files");
  if (sum(fileCov.skipReasons) !== fileCov.skipped) problems.push("skip reasons do not sum to skipped");

  for (const f of result.files) {
    const folder = path.posix.dirname(f.path);
    if (f.folder !== folder) problems.push(`${f.path}: folder ${f.folder} is not ${folder}`);
    if (f.parsed !== (f.skipReason === null)) problems.push(`${f.path}: parsed and skipReason disagree`);
    if (!f.parsed && !f.skipDetail) problems.push(`${f.path}: skipped without detail`);
  }

  for (const e of result.edges) {
    if (!paths.has(e.target)) problems.push(`edge target ${e.target} is not a file`);
    if (!parsed.has(e.source)) problems.push(`edge source ${e.source} is not a parsed file`);
  }
  for (const site of [...result.unresolved, ...result.excluded]) {
    if (!parsed.has(site.source)) problems.push(`import site ${site.source} is not a parsed file`);
  }

  for (const r of result.routes) {
    if (!parsed.has(r.file)) problems.push(`route ${r.method} ${r.path} is declared in ${r.file}, which is not a parsed file`);
  }

  const outcomes = imports.internal + imports.external + imports.excluded + imports.unresolved;
  if (imports.total !== outcomes) problems.push("import outcomes do not sum to total");
  if (imports.internal !== result.edges.length) problems.push("internal imports != edges");
  if (imports.unresolved !== result.unresolved.length) problems.push("unresolved count != list");
  if (imports.excluded !== result.excluded.length) problems.push("excluded count != list");
  if (sum(imports.unresolvedReasons) !== imports.unresolved) problems.push("unresolved reasons do not sum");
  if (sum(imports.excludedReasons) !== imports.excluded) problems.push("excluded reasons do not sum");
  if (sum(imports.externalReasons) !== imports.external) problems.push("external reasons do not sum");
  const kindTotal = Object.values(imports.byKind).reduce((a, k) => a + k.total, 0);
  if (kindTotal !== imports.total) problems.push("per-kind totals do not sum");

  const fan = computeFan(paths, result.edges.filter((e) => paths.has(e.target) && paths.has(e.source)));
  for (const f of result.files) {
    const expected = fan.get(f.path)!;
    if (f.fanIn !== expected.fanIn || f.fanOut !== expected.fanOut) {
      problems.push(`${f.path}: fan-in/out does not match the edge list`);
    }
  }
  return problems;
}
