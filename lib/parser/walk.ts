// Walking a repository: which files become nodes, and the facts about each
// one that need no parser.
//
// Selection is structural. Every source file in every directory that is
// walked becomes a node; a directory is either kept whole or not walked at
// all, and every directory not walked is recorded with the reason. There is
// no cap by size or count, so an edge can never point at a file that was
// dropped for being small.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import type { IgnoredPath, SkipReason } from "./contract.ts";

export const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

/** Files larger than this are almost always generated or bundled. */
export const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;

const ALWAYS_IGNORED: Record<string, IgnoredPath["reason"]> = {
  node_modules: "dependencies",
  ".git": "version-control",
  ".hg": "version-control",
  ".svn": "version-control",
};

const MINIFIED = /\.min\.[cm]?js$/;

export interface WalkedFile {
  path: string;
  folder: string;
  package: string | null;
  extension: string;
  bytes: number;
  /** null when the file's bytes could not be read. */
  hash: string | null;
  lines: number;
  /** The file's text, or null when it was skipped before reading it as text. */
  text: string | null;
  skip: { reason: SkipReason; detail: string } | null;
}

export interface PackageJson {
  /** Directory containing the package.json, relative to the root. */
  dir: string;
  json: Record<string, unknown>;
}

export interface WalkResult {
  root: string;
  files: WalkedFile[];
  /** Non-source files that were walked. Imports of these are assets. */
  otherFiles: Set<string>;
  ignored: IgnoredPath[];
  packageJsons: PackageJson[];
}

export interface WalkOptions {
  maxFileBytes?: number;
}

/** POSIX path relative to root; "." for the root itself. */
export function toRelative(root: string, abs: string): string {
  const rel = path.relative(root, abs).split(path.sep).join("/");
  return rel === "" ? "." : rel;
}

export function folderOf(relPath: string): string {
  const dir = path.posix.dirname(relPath);
  return dir === "" ? "." : dir;
}

export function isSourceFile(name: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function extensionOf(name: string): string {
  if (name.endsWith(".d.ts")) return ".d.ts";
  return path.extname(name);
}

export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let lines = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  return text.endsWith("\n") ? lines : lines + 1;
}

interface GitignoreScope {
  /** Directory the .gitignore lives in, relative to root ("." for root). */
  base: string;
  matcher: Ignore;
}

function isGitignored(scopes: GitignoreScope[], rel: string, isDir: boolean): boolean {
  let ignored = false;
  for (const { base, matcher } of scopes) {
    const local = base === "." ? rel : rel.slice(base.length + 1);
    const result = matcher.test(isDir ? `${local}/` : local);
    if (result.ignored) ignored = true;
    else if (result.unignored) ignored = false;
  }
  return ignored;
}

function readPackageJson(abs: string): Record<string, unknown> | null {
  try {
    const json: unknown = JSON.parse(fs.readFileSync(abs, "utf8"));
    return json && typeof json === "object" && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readSourceFile(
  abs: string,
  rel: string,
  pkg: string | null,
  maxFileBytes: number,
): WalkedFile {
  const name = path.posix.basename(rel);
  const base = {
    path: rel,
    folder: folderOf(rel),
    package: pkg,
    extension: extensionOf(name),
  };

  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(abs);
  } catch (error) {
    return {
      ...base,
      bytes: 0,
      hash: null,
      lines: 0,
      text: null,
      skip: { reason: "unreadable", detail: (error as Error).message },
    };
  }

  const facts = {
    ...base,
    bytes: buffer.length,
    hash: createHash("sha256").update(buffer).digest("hex"),
  };
  const text = buffer.toString("utf8");
  const lines = countLines(text);

  if (buffer.includes(0)) {
    return { ...facts, lines, text: null, skip: { reason: "unreadable", detail: "contains NUL bytes; not text" } };
  }
  if (buffer.length > maxFileBytes) {
    return {
      ...facts,
      lines,
      text: null,
      skip: { reason: "too-large", detail: `${buffer.length} bytes, limit is ${maxFileBytes}` },
    };
  }
  if (MINIFIED.test(name)) {
    return { ...facts, lines, text: null, skip: { reason: "minified", detail: "file name marks it as minified" } };
  }
  return { ...facts, lines, text, skip: null };
}

export function walkRepository(rootInput: string, options: WalkOptions = {}): WalkResult {
  const root = path.resolve(rootInput);
  if (!fs.statSync(root).isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  const result: WalkResult = {
    root,
    files: [],
    otherFiles: new Set(),
    ignored: [],
    packageJsons: [],
  };

  const visit = (absDir: string, scopes: GitignoreScope[], pkg: string | null) => {
    const relDir = toRelative(root, absDir);

    const gitignore = path.join(absDir, ".gitignore");
    if (fs.existsSync(gitignore)) {
      scopes = [
        ...scopes,
        { base: relDir, matcher: ignore().add(fs.readFileSync(gitignore, "utf8")) },
      ];
    }

    const packageJsonPath = path.join(absDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const json = readPackageJson(packageJsonPath);
      if (json) result.packageJsons.push({ dir: relDir, json });
      pkg = relDir;
    }

    const entries = fs
      .readdirSync(absDir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      const abs = path.join(absDir, entry.name);
      const rel = relDir === "." ? entry.name : `${relDir}/${entry.name}`;

      if (entry.isSymbolicLink()) {
        let targetIsDir = false;
        try {
          targetIsDir = fs.statSync(abs).isDirectory();
        } catch {
          // A dangling link: treat as a file so it is accounted for below.
        }
        if (targetIsDir) {
          result.ignored.push({ path: rel, reason: "symlink" });
          continue;
        }
        if (isSourceFile(entry.name) && !isGitignored(scopes, rel, false)) {
          result.files.push({
            path: rel,
            folder: folderOf(rel),
            package: pkg,
            extension: extensionOf(entry.name),
            bytes: 0,
            hash: null,
            lines: 0,
            text: null,
            skip: { reason: "symlink", detail: `links to ${safeReadlink(abs)}` },
          });
        }
        continue;
      }
      const isDir = entry.isDirectory();
      if (isDir && entry.name in ALWAYS_IGNORED) {
        result.ignored.push({ path: rel, reason: ALWAYS_IGNORED[entry.name] });
        continue;
      }
      if (isGitignored(scopes, rel, isDir)) {
        result.ignored.push({ path: rel, reason: "gitignored" });
        continue;
      }

      if (isDir) {
        visit(abs, scopes, pkg);
      } else if (entry.isFile()) {
        if (isSourceFile(entry.name)) {
          result.files.push(readSourceFile(abs, rel, pkg, maxFileBytes));
        } else {
          result.otherFiles.add(rel);
        }
      }
    }
  };

  visit(root, [], null);
  return result;
}

function safeReadlink(abs: string): string {
  try {
    return fs.readlinkSync(abs);
  } catch {
    return "an unreadable target";
  }
}
