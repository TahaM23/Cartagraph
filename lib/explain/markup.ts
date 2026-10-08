// Reading an explanation for display.
//
// The prompt permits three pieces of formatting: inline code, bullets and
// bold. No headings: the pane is narrow, and headings cut a few short
// paragraphs into labelled fragments. Models do not reliably keep to that,
// so this reads the three it allows and quietly removes the marks of
// anything else (a heading's hashes, emphasis asterisks, fences, a stray
// backtick), keeping the words. Nothing that reaches the screen is a
// formatting character printed as text.
//
// Pure, and free of React, so it can be checked from a plain script.

export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "bold"; children: Inline[] };

export type Block = { type: "paragraph"; content: Inline[] } | { type: "list"; items: Inline[][] };

const FENCE = /^\s*(```|~~~)/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const HEADING = /^\s*#{1,6}\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*(?:[-*+•]|\d{1,3}[.)])\s+(.*)$/;
const QUOTE = /^\s*>\s?/;
const INDENTED = /^\s{2,}\S/;

export function parseExplanation(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;
  let fenced: string[] | null = null;

  const flush = () => {
    if (paragraph.length > 0) {
      const content = parseInline(paragraph.join(" "));
      if (content.length > 0) blocks.push({ type: "paragraph", content });
      paragraph = [];
    }
    if (list) {
      const items = list.map(parseInline).filter((item) => item.length > 0);
      if (items.length > 0) blocks.push({ type: "list", items });
      list = null;
    }
  };

  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(QUOTE, "");
    if (FENCE.test(line)) {
      // A code block was not permitted. Its lines are kept, as code, in a
      // paragraph of their own.
      if (fenced === null) {
        flush();
        fenced = [];
      } else {
        const code = fenced.map((l) => l.trim()).filter(Boolean).join(" ");
        if (code) blocks.push({ type: "paragraph", content: [{ type: "code", text: code }] });
        fenced = null;
      }
      continue;
    }
    if (fenced !== null) {
      fenced.push(line);
      continue;
    }
    if (RULE.test(line)) continue;
    if (line.trim() === "") {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      // Kept as words, set apart as their own paragraph: never a heading.
      flush();
      paragraph.push(heading[1]);
      flush();
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      if (paragraph.length > 0) flush();
      list ??= [];
      list.push(bullet[1]);
      continue;
    }
    if (list && INDENTED.test(line)) {
      // A wrapped bullet.
      list[list.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (list) flush();
    paragraph.push(line.trim());
  }
  flush();
  if (fenced !== null) {
    const code = (fenced as string[]).map((l) => l.trim()).filter(Boolean).join(" ");
    if (code) blocks.push({ type: "paragraph", content: [{ type: "code", text: code }] });
  }
  return blocks;
}

/** Inline code and bold, read; every other mark removed. */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const pushText = () => {
    if (text) out.push({ type: "text", text });
    text = "";
  };

  let i = 0;
  while (i < source.length) {
    if (source[i] === "`") {
      let j = i;
      while (source[j] === "`") j++;
      const fence = source.slice(i, j);
      const close = findRun(source, fence, j);
      if (close !== -1 && looksLikeCode(source.slice(j, close))) {
        const code = source.slice(j, close).trim();
        pushText();
        if (code) out.push({ type: "code", text: code });
        i = close + fence.length;
      } else {
        // An unmatched backtick is dropped, not printed.
        i = j;
      }
      continue;
    }
    if (source.startsWith("**", i) || source.startsWith("__", i)) {
      const marker = source.slice(i, i + 2);
      const close = source.indexOf(marker, i + 2);
      if (close > i + 2) {
        pushText();
        const children = parseInline(source.slice(i + 2, close));
        if (children.length > 0) out.push({ type: "bold", children });
        i = close + 2;
      } else {
        i += 2;
      }
      continue;
    }
    text += source[i];
    i++;
  }
  pushText();

  return merge(out.map((node) => (node.type === "text" ? { type: "text", text: cleanText(node.text) } : node)));
}

/**
 * Whether what sits between two backticks is code, or prose a stray backtick
 * has paired with a later one. Code here is a path or a name: short, and
 * free of other formatting.
 */
function looksLikeCode(span: string): boolean {
  return span.length <= 120 && !span.includes("**") && !span.includes("](");
}

/** The next run of exactly `fence` backticks at or after `from`. */
function findRun(source: string, fence: string, from: number): number {
  for (let at = source.indexOf(fence, from); at !== -1; at = source.indexOf(fence, at + 1)) {
    const before = source[at - 1];
    const after = source[at + fence.length];
    if (before !== "`" && after !== "`") return at;
  }
  return -1;
}

/** Plain prose: links lose their targets, emphasis loses its marks, and no asterisk is left. */
function cleanText(text: string): string {
  return text
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/(^|[^\w])_(?=\S)([^_\n]+?)(?<=\S)_(?!\w)/g, "$1$2")
    .replace(/\*+/g, "")
    .replace(/\\([\\`*_#[\]()])/g, "$1")
    .replace(/ {2,}/g, " ");
}

function merge(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (node.type === "text" && last?.type === "text") last.text += node.text;
    else if (node.type !== "text" || node.text) out.push(node);
  }
  // Leading and trailing spaces of the whole run carry nothing.
  const first = out[0];
  if (first?.type === "text") first.text = first.text.trimStart();
  const end = out[out.length - 1];
  if (end?.type === "text") end.text = end.text.trimEnd();
  return out.filter((n) => n.type !== "text" || n.text);
}

/** A run of prose with the repository paths in it picked out. */
export type Segment<T> = string | { text: string; target: T };

const CANDIDATE = /[\w.@~$+\-[\]()/]+/g;
const TRAILING = /[.,:;!?)\]]$/;
const LEADING = /^[([]/;
/** `path:12` and `path:12:3` name a file at a line. */
const LINE_SUFFIX = /:\d+(?::\d+)?$/;

/**
 * Splits prose wherever `resolve` recognises a path. Only tokens with a dot
 * or a slash are tried, and each is trimmed of surrounding punctuation until
 * it resolves or nothing is left.
 */
export function linkPaths<T>(text: string, resolve: (candidate: string) => T | null): Segment<T>[] {
  const out: Segment<T>[] = [];
  let last = 0;
  for (const match of text.matchAll(CANDIDATE)) {
    if (!/[./]/.test(match[0])) continue;
    let start = match.index;
    let token = match[0];
    let target: T | null = null;
    while (token && (target = resolvePath(token, resolve)) === null) {
      if (TRAILING.test(token)) token = token.slice(0, -1);
      else if (LEADING.test(token)) {
        token = token.slice(1);
        start++;
      } else break;
    }
    if (target === null || !token) continue;
    if (start > last) out.push(text.slice(last, start));
    out.push({ text: token, target });
    last = start + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A path as the model may have written it: with `./`, a trailing slash, or a line number. */
export function resolvePath<T>(candidate: string, resolve: (path: string) => T | null): T | null {
  const path = candidate.trim().replace(/^\.\//, "").replace(LINE_SUFFIX, "").replace(/\/$/, "");
  return path ? resolve(path) : null;
}
