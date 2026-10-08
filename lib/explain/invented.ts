// Whether an explanation names a path it was never shown.
//
// Set membership, done in code: every path-shaped token in the explanation is
// tested against the exact set of paths in the prompt the model answered.
// Anything else was invented. No model is asked, because a hallucination
// detector that can hallucinate is worth nothing.
//
// The shown set is read back off the prompt text, not passed alongside it, so
// the same check runs on an answer as it is written, on an old trace that
// recorded only its prompt, and on an evaluation dataset. The prompt's shape
// is ours (prompt.ts): repository paths appear in backticks, or as a <file>
// block's path. If that shape drifts, the shown set shrinks and the check
// fails loudly, never quietly. Path-like strings inside the code shown count
// too: a config's `schema: "./src/db/schema.js"`, quoted back, is the model
// repeating what it was given, which the prompt allows, not inventing.
//
// What counts as path-shaped is deliberately narrow, so that every failure is
// a real one:
// - a token ending in a source or config extension, anywhere in the text,
//   unless it is the name of a piece of software (Next.js is not a file);
// - an extensionless token with a slash, inside inline code, whose first
//   folder is one the shown paths start with (`next/navigation` is a package,
//   `lib/ai` is a folder of this repository).
// Not paths: URLs, relative specifiers (`../db`), absolute ones (`/api/users`,
// a route), scoped packages, and calls (`res.json()`).
//
// A token is shown when it is a shown path, a folder of one, or the end of
// one at a folder boundary (`client.ts` for `lib/ai/client.ts`): a shortened
// name for a file it was given is not an invention.
//
// Pure, so it can be checked from a plain script.

/** What a prompt showed the model, read off the prompt. */
export interface Shown {
  /** Repository paths, as the prompt lists them. */
  listed: Set<string>;
  /** Path-like strings inside the code it showed. */
  quoted: Set<string>;
}

export function shownPaths(prompt: string): Shown {
  const listed = new Set<string>();
  const quoted = new Set<string>();
  // File blocks hold code, and code has backticks of its own: keep each
  // block's path and drop its body before reading the rest.
  const outside = prompt.replace(/<file path="([^"]*)"[^>]*>\n([\s\S]*?)\n<\/file>/g, (_, path: string, code: string) => {
    listed.add(path);
    for (const [raw] of code.matchAll(TOKEN)) {
      const token = normalise(raw);
      if (token.includes("/") || EXTENSION.test(token)) quoted.add(token);
    }
    return "";
  });
  for (const [, span] of outside.matchAll(/`([^`\n]+)`/g)) listed.add(span.trim());
  return { listed, quoted };
}

export interface PathCheck {
  /** Distinct path-shaped tokens, in the order they first appear. */
  mentioned: string[];
  /** The ones that are not among the paths shown. */
  invented: string[];
  /** 1 when nothing was invented, else 0. */
  score: 0 | 1;
}

const EXTENSION = /\.(?:[cm]?[jt]sx?|json|mdx?|css|scss|sass|less|html|ya?ml|vue|svelte|astro)$/i;

/** Software whose name ends in what looks like an extension. Compared without case. */
const SOFTWARE = new Set(
  [
    "node.js", "next.js", "nest.js", "nuxt.js", "express.js", "react.js", "vue.js", "angular.js",
    "ember.js", "backbone.js", "three.js", "chart.js", "d3.js", "p5.js", "moment.js", "day.js",
    "highlight.js", "video.js", "pixi.js", "socket.io", "solid.js", "alpine.js", "knockout.js",
  ],
);

const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
const CODE_SPAN = /(`+)([^`]+?)\1/g;
const TOKEN = /[\w.@~$+\-[\]()/]+/g;
/** An identifier directly followed by an opening parenthesis, with no folder after it. */
const CALL = /[\w$]\([^/]*$/;

const count = (text: string, char: string) => text.split(char).length - 1;

/**
 * Surrounding punctuation is prose. A bracket is only prose when it has no
 * partner: `app/(auth)` and `app/[id]` are folders, and keep theirs.
 */
function trimProse(raw: string): string {
  let token = raw;
  for (;;) {
    const last = token.at(-1);
    const first = token[0];
    if (last && ".,:;!?".includes(last)) token = token.slice(0, -1);
    else if (last === ")" && count(token, ")") > count(token, "(")) token = token.slice(0, -1);
    else if (last === "]" && count(token, "]") > count(token, "[")) token = token.slice(0, -1);
    else if (first === "(" && count(token, "(") > count(token, ")")) token = token.slice(1);
    else if (first === "[" && count(token, "[") > count(token, "]")) token = token.slice(1);
    else return token;
  }
}

/** A token as a path would be written: no surrounding prose, no leading `./` or trailing slash. */
const normalise = (raw: string) => trimProse(raw).replace(/^\.\//, "").replace(/\/+$/, "");

/** A token as it would name a path, or null when it is not path-shaped. */
function asPath(raw: string, inCode: boolean, roots: ReadonlySet<string>): string | null {
  if (CALL.test(trimProse(raw))) return null;
  const token = normalise(raw);
  if (!token || token.startsWith("/") || token.startsWith("../") || token === ".." || token.startsWith("@")) return null;

  if (EXTENSION.test(token)) return SOFTWARE.has(token.toLowerCase()) ? null : token;
  if (!token.includes("/") || !inCode) return null;
  return roots.has(token.slice(0, token.indexOf("/"))) ? token : null;
}

function isShown(token: string, shown: Shown): boolean {
  if (shown.listed.has(token) || shown.quoted.has(token)) return true;
  for (const path of shown.listed) {
    const anchored = `/${path}`;
    if (anchored.endsWith(`/${token}`) || anchored.includes(`/${token}/`)) return true;
  }
  return false;
}

/** Every path-shaped token in `explanation`, and which of them `shown` does not account for. */
export function checkPaths(explanation: string, shown: Shown): PathCheck {
  // Folders of the repository, from its paths: never a package a quoted import names.
  const roots = new Set([...shown.listed].filter((p) => p.includes("/")).map((p) => p.slice(0, p.indexOf("/"))));
  const text = explanation.replace(URL_PATTERN, " ");

  const mentioned: string[] = [];
  const seen = new Set<string>();
  const take = (source: string, inCode: boolean) => {
    for (const [raw] of source.matchAll(TOKEN)) {
      const path = asPath(raw, inCode, roots);
      if (path !== null && !seen.has(path)) {
        seen.add(path);
        mentioned.push(path);
      }
    }
  };
  let last = 0;
  for (const match of text.matchAll(CODE_SPAN)) {
    take(text.slice(last, match.index), false);
    take(match[2], true);
    last = match.index + match[0].length;
  }
  take(text.slice(last), false);

  const invented = mentioned.filter((p) => !isShown(p, shown));
  return { mentioned, invented, score: invented.length === 0 ? 1 : 0 };
}

/** One line a person can check by eye: what was invented, against how much was shown. */
export function describeCheck(check: PathCheck, shown: Shown): string {
  if (check.invented.length === 0) {
    return `All ${check.mentioned.length} path(s) named were among the ${shown.listed.size} listed or quoted in the code shown.`;
  }
  return `Not among the ${shown.listed.size} path(s) listed, nor quoted in the code shown: ${check.invented.join(", ")}`;
}

/** The feedback key the check scores under, live and in experiments alike. 1 is grounded. */
export const PATHS_GROUNDED = "paths_grounded";
