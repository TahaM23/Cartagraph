// What the model is told. Pure: facts and file text in, prompt text out.
//
// Every list of files here was read from the stored graph and is complete,
// and the prompt says so: the model is asked to explain what it is shown,
// never to work out what is connected to what.
//
// Changing any prompt means bumping its version, which is part of every
// cache key: an explanation written to an old prompt is never served as an
// answer to a new one.

import type { NeighbourFile } from "./neighbourhood.ts";
import { MODEL_ROLES } from "./types.ts";

export const PROMPT_VERSIONS = { file: 1, folder: 1, label: 1 } as const;

/** The formatting the pane renders (lib/explain/markup.ts). The same words for every prompt. */
const FORMATTING = `Formatting: you may use exactly three things, and nothing else.
- \`inline code\`, for file paths and names from the code.
- Bullets: lines starting with "- ".
- **Bold**, sparingly.
No headings, no italics, no links, no tables, no code blocks. Write every repository file path in full, exactly as given, inside backticks.`;

const GROUNDING = `The lists of files you are given were read off the code by a parser. They are complete and exact. Never say or suggest that a file is connected to one it is not listed with, and never mention a repository file that does not appear in what you were given. Packages from outside the repository may be named.`;

export const FILE_INSTRUCTIONS = `You explain one file of a TypeScript or JavaScript repository to a developer who can read code but did not write this codebase and cannot see its shape.

Say what the file does and the part it plays among the files it is connected to: what it relies on from the files it imports, and what the files importing it rely on it for. Ground every claim in the code and lists you are given. Lead with what matters most; do not restate the lists.

${GROUNDING}

Length: two or three short paragraphs, under 170 words in all. A short bullet list is fine where it reads better than a sentence.

${FORMATTING}`;

export const FOLDER_INSTRUCTIONS = `You explain one folder of a TypeScript or JavaScript repository to a developer who can read code but did not write this codebase and cannot see its shape.

The question is about the folder as a whole: what is in here, and why does so much of the rest of the repository point at it. Do not summarise any single file. Say what its files have in common and how they divide the work, then which of them the rest of the repository depends on, and for what. If little or nothing points at it, say so and say what it is for instead.

${GROUNDING}

Length: two or three short paragraphs, under 190 words in all. A short bullet list is fine where it reads better than a sentence.

${FORMATTING}`;

export const LABEL_INSTRUCTIONS = `You label files of a TypeScript or JavaScript repository that no framework convention identified. For each file, choose the one role that best describes it from this list, or null when none fits:

- service: business logic or an integration other code calls.
- repository: reads and writes stored data.
- model: a data shape, schema or entity definition.
- util: small general-purpose helpers.
- config: configuration or constants other code reads.
- component: a UI component.
- hook: a React hook.

Decide from the code and the path. A file that is mostly an entry script, types only, or a mix of everything gets null rather than a guess. Answer for every file you are given, by its exact path, and for no other.`;

/** A role as the prompt states it, with who gave it. */
function describeRole(file: NeighbourFile): string {
  if (!file.role) return "";
  return file.roleSource === "model" ? ` (labelled ${file.role})` : ` (${file.role}, by framework convention)`;
}

function listFiles(files: readonly NeighbourFile[]): string {
  return files.map((f) => `- \`${f.path}\`${describeRole(f)}`).join("\n");
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A file's text for the prompt, cut at whole lines past `maxLines` or `maxChars`. */
export function excerpt(text: string, maxLines: number, maxChars: number): { text: string; cut: boolean } {
  const lines = text.split("\n");
  let out = lines.slice(0, maxLines).join("\n");
  if (out.length > maxChars) out = out.slice(0, out.lastIndexOf("\n", maxChars) + 1 || maxChars);
  return { text: out, cut: out.length < text.length };
}

function fileBlock(path: string, text: string, maxLines: number, maxChars: number, label = ""): string {
  const { text: shown, cut } = excerpt(text, maxLines, maxChars);
  const note = cut ? ` shown="first ${shown.split("\n").length} lines"` : "";
  return `<file path="${path}"${label}${note}>\n${shown}\n</file>`;
}

export interface Setting {
  repository: string;
  /** The framework whose conventions applied, or null. */
  framework: string | null;
  commit: string;
}

function header(setting: Setting): string {
  return `Repository: ${setting.repository} at commit ${setting.commit.slice(0, 7)}${
    setting.framework ? `, a ${setting.framework} codebase` : ""
  }.`;
}

/** The subject in full, up to this. Past it the file is cut, and the prompt says so. */
export const SUBJECT_LINES = 1500;
export const SUBJECT_CHARS = 60_000;
/** Neighbours are shown as their opening lines. */
export const EXCERPT_LINES = 40;
export const EXCERPT_CHARS = 2_500;

export function fileInput(
  setting: Setting,
  file: NeighbourFile,
  imports: readonly NeighbourFile[],
  importedBy: readonly NeighbourFile[],
  text: string,
  excerpts: ReadonlyMap<string, string>,
): string {
  const parts = [
    header(setting),
    `The file to explain: \`${file.path}\`${describeRole(file)}, ${plural(file.lines, "line")}.`,
    imports.length > 0
      ? `It imports these ${plural(imports.length, "file")} from the repository, and no others:\n${listFiles(imports)}`
      : "It imports no other file in the repository.",
    importedBy.length > 0
      ? `These ${plural(importedBy.length, "file")} import it, and no others:\n${listFiles(importedBy)}`
      : "No file in the repository imports it.",
    `Its contents:\n${fileBlock(file.path, text, SUBJECT_LINES, SUBJECT_CHARS)}`,
  ];
  if (excerpts.size > 0) {
    parts.push(
      `The opening lines of some of those files, for context:\n${[...excerpts]
        .map(([path, t]) => fileBlock(path, t, EXCERPT_LINES, EXCERPT_CHARS))
        .join("\n")}`,
    );
  }
  return parts.join("\n\n");
}

export interface FolderFacts {
  dir: string;
  /** The folder's files. */
  members: readonly NeighbourFile[];
  /** Member → the files outside the folder that import it. */
  importers: ReadonlyMap<string, readonly string[]>;
  /** Files outside the folder that its files import. */
  outside: readonly NeighbourFile[];
  /** Distinct imports between the folder's own files. */
  internal: number;
}

/** Past these, a list is cut and the prompt gives the full count. */
const MEMBERS_LISTED = 150;
const IMPORTERS_LISTED = 8;
const OUTSIDE_LISTED = 40;

export function folderInput(setting: Setting, facts: FolderFacts, excerpts: ReadonlyMap<string, string>): string {
  const { dir, members, importers, outside, internal } = facts;
  const pointing = new Set([...importers.values()].flat());
  const memberLine = (f: NeighbourFile) => {
    const from = importers.get(f.path) ?? [];
    return `- \`${f.path}\`${describeRole(f)}, ${plural(f.lines, "line")}, imported by ${plural(from.length, "file")} outside the folder`;
  };
  const byImporters = [...members].sort(
    (a, b) => (importers.get(b.path)?.length ?? 0) - (importers.get(a.path)?.length ?? 0) || (a.path < b.path ? -1 : 1),
  );
  const imported = byImporters.filter((f) => (importers.get(f.path)?.length ?? 0) > 0);

  const parts = [
    header(setting),
    `The folder to explain: ${dir === "." ? "the repository root" : `\`${dir}\``}. On the map it holds ${plural(members.length, "file")}, including any in subfolders too small to show on their own.`,
    `Its files, most imported from outside first:\n${byImporters.slice(0, MEMBERS_LISTED).map(memberLine).join("\n")}${
      members.length > MEMBERS_LISTED ? `\n- and ${members.length - MEMBERS_LISTED} more` : ""
    }`,
    pointing.size > 0
      ? `${plural(pointing.size, "file")} outside the folder import something in it. For each file in it that is imported from outside, who imports it:\n${imported
          .map((f) => {
            const from = importers.get(f.path)!;
            const shown = from.slice(0, IMPORTERS_LISTED).map((p) => `\`${p}\``).join(", ");
            return `- \`${f.path}\` ← ${shown}${from.length > IMPORTERS_LISTED ? `, and ${from.length - IMPORTERS_LISTED} more` : ""}`;
          })
          .join("\n")}`
      : "Nothing outside the folder imports anything in it.",
    outside.length > 0
      ? `Its files import ${plural(outside.length, "file")} outside it:\n${listFiles(outside.slice(0, OUTSIDE_LISTED))}${
          outside.length > OUTSIDE_LISTED ? `\n- and ${outside.length - OUTSIDE_LISTED} more` : ""
        }`
      : "Its files import nothing outside it.",
    `Imports between its own files: ${internal}.`,
  ];
  if (excerpts.size > 0) {
    parts.push(
      `The opening lines of its most imported files:\n${[...excerpts]
        .map(([path, t]) => fileBlock(path, t, EXCERPT_LINES, EXCERPT_CHARS))
        .join("\n")}`,
    );
  }
  return parts.join("\n\n");
}

export interface LabelSubject {
  path: string;
  text: string;
  imports: readonly string[];
  importedBy: readonly string[];
}

/** How much of each file, and of its neighbour lists, a label is decided from. */
export const LABEL_LINES = 60;
export const LABEL_CHARS = 3_000;
export const LABEL_NEIGHBOURS = 8;

export function labelInput(subjects: readonly LabelSubject[]): string {
  return subjects
    .map((s) => {
      const list = (paths: readonly string[]) =>
        paths.length === 0
          ? "none"
          : paths.slice(0, LABEL_NEIGHBOURS).join(", ") + (paths.length > LABEL_NEIGHBOURS ? `, and ${paths.length - LABEL_NEIGHBOURS} more` : "");
      return `${fileBlock(s.path, s.text, LABEL_LINES, LABEL_CHARS)}\nImports: ${list(s.imports)}\nImported by: ${list(s.importedBy)}`;
    })
    .join("\n\n");
}

/** The answer's shape, for the API's structured output. */
export const LABEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["labels"],
  properties: {
    labels: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "role"],
        properties: {
          path: { type: "string" },
          role: { anyOf: [{ type: "string", enum: [...MODEL_ROLES] }, { type: "null" }] },
        },
      },
    },
  },
} as const;
