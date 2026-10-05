// The shape the parser writes. Everything built after Phase 3 reads this, so
// it is a contract: change it by bumping `version`, never in place.
//
// Paths are POSIX, relative to the parsed root, with no leading "./".

import { z } from "zod";

export const PARSE_RESULT_VERSION = 1;

export const IMPORT_KINDS = ["import", "re_export", "dynamic_import"] as const;
export const ImportKind = z.enum(IMPORT_KINDS);
export type ImportKind = z.infer<typeof ImportKind>;

/** Why a source file was found but not parsed. */
export const SkipReason = z.enum([
  "too-large", // over the size limit; almost always generated or bundled
  "minified", // *.min.js and friends
  "unreadable", // could not be read, or is not text
  "syntax-error", // TypeScript reported parse errors; imports would be partial
  "symlink", // a symlinked file; its target is reached by its real path, if at all
]);
export type SkipReason = z.infer<typeof SkipReason>;

/** Why a directory was not walked. Its files are not "found". */
export const IgnoreReason = z.enum([
  "dependencies", // node_modules
  "version-control", // .git and friends
  "gitignored",
  "symlink",
]);
export type IgnoreReason = z.infer<typeof IgnoreReason>;

/** An import whose target is outside the repository. */
export const ExternalReason = z.enum([
  "package", // a bare specifier naming a package
  "builtin", // a Node.js builtin module
  "outside-root", // resolved to a file outside the parsed directory
]);
export type ExternalReason = z.infer<typeof ExternalReason>;

/** An import that resolved inside the repository but deliberately has no node. */
export const ExcludedReason = z.enum([
  "asset", // a non-source file: stylesheet, image, JSON, ...
  "ignored-path", // a file inside a directory that was not walked
]);
export type ExcludedReason = z.infer<typeof ExcludedReason>;

/** Why an import failed. Never guessed at, never dropped. */
export const UnresolvedReason = z.enum([
  "file-not-found", // relative or absolute path with no matching file
  "alias-not-found", // matched a tsconfig `paths` alias; no file behind it
  "workspace-package-not-found", // names a package in this repo; no entry file found
  "subpath-import-not-found", // a `#` package import with no matching file
  "non-literal-specifier", // dynamic import of something other than a string literal
  "case-mismatch", // matches a file only on a case-insensitive filesystem
]);
export type UnresolvedReason = z.infer<typeof UnresolvedReason>;

export const FileNode = z.object({
  path: z.string(),
  /** The directory the file lives in ("." for the root). Everything groups by this. */
  folder: z.string(),
  /** The directory of the nearest package.json at or above the file, or null. */
  package: z.string().nullable(),
  extension: z.string(),
  lines: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  /** sha256 of the file's bytes, hex; null when they could not be read. */
  hash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  parsed: z.boolean(),
  skipReason: SkipReason.nullable(),
  skipDetail: z.string().nullable(),
  /** Distinct files this one imports, after duplicate edges are removed. */
  fanOut: z.number().int().nonnegative(),
  /** Distinct files that import this one, after duplicate edges are removed. */
  fanIn: z.number().int().nonnegative(),
  /** Why the adapter considers this an entry point, or null. */
  entry: z.string().nullable(),
  /** A role assigned by framework convention, or null. */
  role: z.string().nullable(),
});
export type FileNode = z.infer<typeof FileNode>;

/** One import statement that resolved to a file node. Not deduplicated. */
export const Edge = z.object({
  source: z.string(),
  target: z.string(),
  kind: ImportKind,
  specifier: z.string(),
  typeOnly: z.boolean(),
  line: z.number().int().positive(),
});
export type Edge = z.infer<typeof Edge>;

const ImportSite = z.object({
  source: z.string(),
  line: z.number().int().positive(),
  kind: ImportKind,
  specifier: z.string(),
});

export const UnresolvedImport = ImportSite.extend({
  reason: UnresolvedReason,
  detail: z.string(),
});
export type UnresolvedImport = z.infer<typeof UnresolvedImport>;

export const ExcludedImport = ImportSite.extend({
  reason: ExcludedReason,
  target: z.string(),
});
export type ExcludedImport = z.infer<typeof ExcludedImport>;

export const IgnoredPath = z.object({ path: z.string(), reason: IgnoreReason });
export type IgnoredPath = z.infer<typeof IgnoredPath>;

const OutcomeCounts = z.object({
  total: z.number().int().nonnegative(),
  internal: z.number().int().nonnegative(),
  external: z.number().int().nonnegative(),
  excluded: z.number().int().nonnegative(),
  unresolved: z.number().int().nonnegative(),
});
export type OutcomeCounts = z.infer<typeof OutcomeCounts>;

const counts = <T extends z.ZodEnum>(keys: T) =>
  z.partialRecord(keys, z.number().int().nonnegative());

export const Coverage = z.object({
  files: z.object({
    /** Source files found by the walk. Always parsed + skipped. */
    found: z.number().int().nonnegative(),
    parsed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    skipReasons: counts(SkipReason),
    /** Non-source files seen by the walk (stylesheets, images, ...). Not nodes. */
    otherFiles: z.number().int().nonnegative(),
    /** Directories not walked, and why. */
    ignored: z.array(IgnoredPath),
  }),
  imports: OutcomeCounts.extend({
    byKind: z.record(ImportKind, OutcomeCounts),
    externalReasons: counts(ExternalReason),
    excludedReasons: counts(ExcludedReason),
    unresolvedReasons: counts(UnresolvedReason),
    /** How many imports name each external package. */
    externalPackages: z.record(z.string(), z.number().int().positive()),
  }),
  /** Syntax seen but not handled in this version, so it is counted, not hidden. */
  notHandled: z.object({ require: z.number().int().nonnegative() }),
  /** tsconfig/jsconfig files used for resolution, with any problems reading them. */
  configs: z.array(z.object({ path: z.string(), problems: z.array(z.string()) })),
});
export type Coverage = z.infer<typeof Coverage>;

export const ParseResult = z.object({
  version: z.literal(PARSE_RESULT_VERSION),
  /** Absolute path that was parsed. */
  root: z.string(),
  generatedAt: z.iso.datetime(),
  adapter: z.string(),
  files: z.array(FileNode),
  edges: z.array(Edge),
  unresolved: z.array(UnresolvedImport),
  excluded: z.array(ExcludedImport),
  coverage: Coverage,
});
export type ParseResult = z.infer<typeof ParseResult>;
