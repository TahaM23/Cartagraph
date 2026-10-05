// Turning a module specifier into a file, or into a reason it isn't one.
//
// Resolution is TypeScript's own (`ts.resolveModuleName`) driven by the
// repository's nearest tsconfig.json or jsconfig.json, so path aliases, index
// files, `.js` specifiers that mean `.ts` files and package `imports` behave
// as the compiler sees them. Two things are added on top:
//
// - Case is exact. A specifier that only matches a file on a case-insensitive
//   filesystem is reported, not resolved, because it breaks on Linux.
// - Workspace packages resolve into the repository without node_modules being
//   installed, through the entry points their package.json declares.
//
// Every failure carries a reason. Nothing here guesses a target.

import fs from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import ts from "typescript";
import type { ExcludedReason, ExternalReason, UnresolvedReason } from "./contract.ts";
import { toRelative, type PackageJson } from "./walk.ts";

export type Resolution =
  | { outcome: "internal"; target: string }
  | { outcome: "external"; reason: ExternalReason; packageName: string | null }
  | { outcome: "excluded"; reason: ExcludedReason; target: string }
  | { outcome: "unresolved"; reason: UnresolvedReason; detail: string };

interface LoadedConfig {
  /** Absolute path of the config file, or null for the built-in default. */
  path: string | null;
  options: ts.CompilerOptions;
  cache: ts.ModuleResolutionCache;
  problems: string[];
}

/** Export conditions tried in order: source-first, so an unbuilt repo resolves. */
const CONDITION_ORDER = [
  "source",
  "development",
  "types",
  "import",
  "module",
  "default",
  "require",
  "node",
  "browser",
];

const IGNORED_CONFIG_ERRORS = new Set([
  18003, // "No inputs were found": the config is read without listing files
]);

function flatten(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
}

function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") && parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0];
}

function isRelativeOrAbsolute(specifier: string): boolean {
  return (
    specifier === "." ||
    specifier === ".." ||
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    path.isAbsolute(specifier)
  );
}

function matchPattern(pattern: string, specifier: string): string | null {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === specifier ? "" : null;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (
    specifier.length >= prefix.length + suffix.length &&
    specifier.startsWith(prefix) &&
    specifier.endsWith(suffix)
  ) {
    return specifier.slice(prefix.length, specifier.length - suffix.length);
  }
  return null;
}

/** Every string target reachable from an `exports` value, in condition order. */
function exportTargets(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(exportTargets);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort((a, b) => {
      const ia = CONDITION_ORDER.indexOf(a);
      const ib = CONDITION_ORDER.indexOf(b);
      return (ia === -1 ? CONDITION_ORDER.length : ia) - (ib === -1 ? CONDITION_ORDER.length : ib);
    });
    return keys.flatMap((key) => exportTargets(record[key]));
  }
  return [];
}

export class Resolver {
  private readonly root: string;
  private readonly nodes: Set<string>;
  private readonly nodesByLowerCase = new Map<string, string>();
  private readonly otherFiles: Set<string>;
  private readonly workspace = new Map<string, PackageJson>();
  private readonly configs = new Map<string, LoadedConfig>();
  private readonly chains = new Map<string, LoadedConfig[]>();
  private readonly listings = new Map<string, Set<string> | null>();
  private readonly exactCase = new Map<string, boolean>();
  private readonly strictHost: ts.ModuleResolutionHost;
  private defaultConfig: LoadedConfig | null = null;

  constructor(
    root: string,
    nodes: Iterable<string>,
    otherFiles: Set<string>,
    packageJsons: PackageJson[],
  ) {
    this.root = root;
    this.nodes = new Set(nodes);
    for (const node of this.nodes) this.nodesByLowerCase.set(node.toLowerCase(), node);
    this.otherFiles = otherFiles;
    for (const pkg of packageJsons) {
      if (typeof pkg.json.name === "string") this.workspace.set(pkg.json.name, pkg);
    }
    this.strictHost = {
      fileExists: (p) => ts.sys.fileExists(p) && this.hasExactCase(p),
      directoryExists: (p) => (ts.sys.directoryExists?.(p) ?? false) && this.hasExactCase(p),
      readFile: ts.sys.readFile,
      realpath: ts.sys.realpath,
      getCurrentDirectory: () => root,
      getDirectories: ts.sys.getDirectories,
      useCaseSensitiveFileNames: true,
    };
  }

  /** The config files consulted so far, with any problems reading them. */
  configsUsed(): { path: string; problems: string[] }[] {
    return [...this.configs.values()]
      .filter((c): c is LoadedConfig & { path: string } => c.path !== null)
      .map((c) => ({ path: toRelative(this.root, c.path), problems: c.problems }))
      .sort((a, b) => (a.path < b.path ? -1 : 1));
  }

  resolve(specifier: string, fromRel: string): Resolution {
    const fromAbs = path.join(this.root, fromRel);
    const chain = this.chainFor(path.dirname(fromAbs));

    if (specifier === "") {
      return { outcome: "unresolved", reason: "file-not-found", detail: "empty specifier" };
    }

    if (isRelativeOrAbsolute(specifier)) {
      const resolved = this.tsResolve(chain, specifier, fromAbs);
      if (resolved) return resolved;
      const literal = path.resolve(path.dirname(fromAbs), specifier);
      return (
        this.literalFile([literal]) ??
        this.caseMismatch(chain, specifier, fromAbs) ?? {
          outcome: "unresolved",
          reason: "file-not-found",
          detail: `no file at ${this.display(literal)}, with any source extension or as a directory index`,
        }
      );
    }

    if (specifier.startsWith("#")) {
      return (
        this.tsResolve(chain, specifier, fromAbs) ??
        this.caseMismatch(chain, specifier, fromAbs) ?? {
          outcome: "unresolved",
          reason: "subpath-import-not-found",
          detail: 'no "imports" entry in the nearest package.json matches, or its target is missing',
        }
      );
    }

    // A tsconfig `paths` alias wins over everything below it.
    for (const config of chain) {
      const candidates = this.aliasCandidates(config, specifier);
      if (candidates === null) continue;
      return (
        this.tsResolve(chain, specifier, fromAbs) ??
        this.literalFile(candidates.files) ??
        this.caseMismatch(chain, specifier, fromAbs) ?? {
          outcome: "unresolved",
          reason: "alias-not-found",
          detail:
            `matches "${candidates.pattern}" in ${this.display(config.path ?? this.root)}; ` +
            `no file at ${candidates.files.map((f) => this.display(f)).join(" or ")}`,
        }
      );
    }

    if (specifier.startsWith("node:") || isBuiltin(specifier)) {
      return { outcome: "external", reason: "builtin", packageName: specifier };
    }

    const packageName = packageNameOf(specifier);
    const local = this.workspace.get(packageName);
    if (local) {
      const viaNodeModules = this.tsResolve(chain, specifier, fromAbs);
      if (viaNodeModules && viaNodeModules.outcome !== "external") return viaNodeModules;
      return this.resolveWorkspacePackage(chain, local, specifier, fromAbs);
    }

    // `baseUrl` makes a bare specifier mean a path. It only counts as one when
    // the first segment exists under baseUrl; otherwise it is a package.
    for (const config of chain) {
      const baseUrl = config.options.baseUrl;
      if (!baseUrl) continue;
      const resolved = this.tsResolve([config], specifier, fromAbs);
      if (resolved && resolved.outcome !== "external") return resolved;
      const firstSegment = specifier.split("/")[0];
      if (fs.existsSync(path.join(baseUrl, firstSegment)) && this.hasExactCase(path.join(baseUrl, firstSegment))) {
        return (
          this.literalFile([path.resolve(baseUrl, specifier)]) ?? {
            outcome: "unresolved",
            reason: "alias-not-found",
            detail: `"${firstSegment}" exists under baseUrl ${this.display(baseUrl)}, but no file matches the rest`,
          }
        );
      }
    }

    return { outcome: "external", reason: "package", packageName };
  }

  // ---------------------------------------------------------------------------

  private tsResolve(chain: LoadedConfig[], specifier: string, fromAbs: string): Resolution | null {
    for (const config of chain) {
      const { resolvedModule } = ts.resolveModuleName(
        specifier,
        fromAbs,
        config.options,
        this.strictHost,
        config.cache,
      );
      if (resolvedModule) {
        return this.classify(
          resolvedModule.resolvedFileName,
          resolvedModule.isExternalLibraryImport ?? false,
          specifier,
        );
      }
    }
    return null;
  }

  /** Classify a file that exists on disk. */
  private classify(abs: string, isLibrary: boolean, specifier: string): Resolution {
    if (isLibrary || /[\\/]node_modules[\\/]/.test(abs)) {
      return {
        outcome: "external",
        reason: "package",
        packageName: isRelativeOrAbsolute(specifier) ? null : packageNameOf(specifier),
      };
    }
    const rel = toRelative(this.root, abs);
    if (rel === ".." || rel.startsWith("../") || path.isAbsolute(rel)) {
      return { outcome: "external", reason: "outside-root", packageName: null };
    }
    if (this.nodes.has(rel)) return { outcome: "internal", target: rel };
    if (this.otherFiles.has(rel)) return { outcome: "excluded", reason: "asset", target: rel };
    return { outcome: "excluded", reason: "ignored-path", target: rel };
  }

  /** A specifier that names an exact file TypeScript would not resolve (assets, mostly). */
  private literalFile(candidates: string[]): Resolution | null {
    for (const abs of candidates) {
      if (this.isFile(abs) && this.hasExactCase(abs)) return this.classify(abs, false, abs);
    }
    return null;
  }

  /** Resolution that succeeds only when case is ignored is a failure with a reason. */
  private caseMismatch(chain: LoadedConfig[], specifier: string, fromAbs: string): Resolution | null {
    for (const config of chain) {
      const { resolvedModule } = ts.resolveModuleName(specifier, fromAbs, config.options, ts.sys);
      if (!resolvedModule) continue;
      const rel = toRelative(this.root, resolvedModule.resolvedFileName);
      const actual = this.nodesByLowerCase.get(rel.toLowerCase()) ?? rel;
      return {
        outcome: "unresolved",
        reason: "case-mismatch",
        detail: `only matches ${actual} on a case-insensitive filesystem`,
      };
    }
    return null;
  }

  private aliasCandidates(
    config: LoadedConfig,
    specifier: string,
  ): { pattern: string; files: string[] } | null {
    const paths = config.options.paths;
    if (!paths) return null;
    const base =
      (config.options as { pathsBasePath?: string }).pathsBasePath ??
      config.options.baseUrl ??
      (config.path ? path.dirname(config.path) : this.root);
    for (const [pattern, targets] of Object.entries(paths)) {
      const captured = matchPattern(pattern, specifier);
      if (captured === null) continue;
      return {
        pattern,
        files: targets.map((t) => path.resolve(base, t.replace("*", captured))),
      };
    }
    return null;
  }

  private resolveWorkspacePackage(
    chain: LoadedConfig[],
    pkg: PackageJson,
    specifier: string,
    fromAbs: string,
  ): Resolution {
    const name = pkg.json.name as string;
    const subpath = specifier.slice(name.length).replace(/^\//, "");
    const key = subpath ? `./${subpath}` : ".";
    const pkgAbs = path.join(this.root, pkg.dir);
    const candidates: string[] = [];

    const exportsField = pkg.json.exports;
    if (typeof exportsField === "string" || Array.isArray(exportsField)) {
      if (key === ".") candidates.push(...exportTargets(exportsField));
    } else if (exportsField && typeof exportsField === "object") {
      const map = exportsField as Record<string, unknown>;
      const isSubpathMap = Object.keys(map).some((k) => k.startsWith("."));
      if (!isSubpathMap) {
        if (key === ".") candidates.push(...exportTargets(map));
      } else if (key in map) {
        candidates.push(...exportTargets(map[key]));
      } else {
        for (const [pattern, value] of Object.entries(map)) {
          const captured = matchPattern(pattern, key);
          if (captured !== null) {
            candidates.push(...exportTargets(value).map((t) => t.replace("*", captured)));
          }
        }
      }
    }
    if (key === ".") {
      for (const field of ["source", "types", "typings", "module", "main"]) {
        const value = pkg.json[field];
        if (typeof value === "string") candidates.push(value);
      }
      candidates.push(".");
    } else {
      candidates.push(key);
    }

    const tried: string[] = [];
    for (const candidate of new Set(candidates)) {
      const abs = path.resolve(pkgAbs, candidate);
      tried.push(this.display(abs));
      const resolved = this.tsResolve(chain, abs, fromAbs) ?? this.literalFile([abs]);
      if (resolved) return resolved;
    }
    return {
      outcome: "unresolved",
      reason: "workspace-package-not-found",
      detail: `"${name}" is the package at ${pkg.dir}; none of its entry points exist: ${tried.join(", ")}`,
    };
  }

  // ---------------------------------------------------------------------------
  // Configuration

  private chainFor(absDir: string): LoadedConfig[] {
    const cached = this.chains.get(absDir);
    if (cached) return cached;

    let chain: LoadedConfig[];
    const configPath = ["tsconfig.json", "jsconfig.json"]
      .map((name) => path.join(absDir, name))
      .find((p) => this.isFile(p));

    if (configPath) {
      const config = this.load(configPath);
      // A "solution" tsconfig lists its real projects as references; the
      // aliases usually live in those, so they are consulted after it.
      chain = [config, ...this.referencesOf(configPath).map((p) => this.load(p))];
    } else if (absDir === this.root || !absDir.startsWith(this.root + path.sep)) {
      chain = [this.defaults()];
    } else {
      chain = this.chainFor(path.dirname(absDir));
    }
    this.chains.set(absDir, chain);
    return chain;
  }

  private readonly referenceCache = new Map<string, string[]>();
  private referencesOf(configPath: string): string[] {
    return this.referenceCache.get(configPath) ?? [];
  }

  private load(configPath: string): LoadedConfig {
    const cached = this.configs.get(configPath);
    if (cached) return cached;

    const problems: string[] = [];
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error) problems.push(flatten(read.error));

    const host: ts.ParseConfigHost = {
      useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
      readDirectory: () => [],
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
    };
    const parsed = ts.parseJsonConfigFileContent(
      read.config ?? {},
      host,
      path.dirname(configPath),
      undefined,
      configPath,
    );
    for (const error of parsed.errors) {
      if (!IGNORED_CONFIG_ERRORS.has(error.code)) problems.push(flatten(error));
    }

    const options = normalize(parsed.options);
    const config: LoadedConfig = {
      path: configPath,
      options,
      cache: ts.createModuleResolutionCache(this.root, (f) => f, options),
      problems,
    };
    this.configs.set(configPath, config);
    this.referenceCache.set(
      configPath,
      (parsed.projectReferences ?? [])
        .map((ref) => ts.resolveProjectReferencePath(ref))
        .filter((p) => p !== configPath && this.isFile(p)),
    );
    return config;
  }

  private defaults(): LoadedConfig {
    if (!this.defaultConfig) {
      const options = normalize({});
      this.defaultConfig = {
        path: null,
        options,
        cache: ts.createModuleResolutionCache(this.root, (f) => f, options),
        problems: [],
      };
    }
    return this.defaultConfig;
  }

  // ---------------------------------------------------------------------------
  // Filesystem

  private isFile(abs: string): boolean {
    try {
      return fs.statSync(abs).isFile();
    } catch {
      return false;
    }
  }

  private listing(dir: string): Set<string> | null {
    if (!this.listings.has(dir)) {
      let names: Set<string> | null = null;
      try {
        names = new Set(fs.readdirSync(dir));
      } catch {
        names = null;
      }
      this.listings.set(dir, names);
    }
    return this.listings.get(dir) ?? null;
  }

  /** True when every segment of `abs` exists with exactly this case. */
  private hasExactCase(abs: string): boolean {
    const normalized = path.resolve(abs);
    const cached = this.exactCase.get(normalized);
    if (cached !== undefined) return cached;
    const parent = path.dirname(normalized);
    const result =
      parent === normalized ||
      (this.hasExactCase(parent) && (this.listing(parent)?.has(path.basename(normalized)) ?? false));
    this.exactCase.set(normalized, result);
    return result;
  }

  private display(abs: string): string {
    const rel = toRelative(this.root, abs);
    return rel.startsWith("..") ? abs : rel;
  }
}

/**
 * Options as the resolver needs them, whatever the repository's config says:
 * JavaScript and JSON resolve, and the legacy "classic" algorithm (which no
 * bundler or runtime uses) is replaced with the bundler one.
 */
function normalize(options: ts.CompilerOptions): ts.CompilerOptions {
  const result: ts.CompilerOptions = { ...options, allowJs: true, resolveJsonModule: true };
  const nodeModule =
    options.module === ts.ModuleKind.Node16 ||
    options.module === ts.ModuleKind.Node18 ||
    options.module === ts.ModuleKind.NodeNext;
  if (
    options.moduleResolution === ts.ModuleResolutionKind.Classic ||
    (options.moduleResolution === undefined && !nodeModule)
  ) {
    result.moduleResolution = ts.ModuleResolutionKind.Bundler;
  }
  return result;
}
