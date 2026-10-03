// Plane work items as tickets, through Plane's REST API. One Plane project per target repo,
// matched by the project identifier that prefixes every work item id (PM-12): the same prefix
// scripts/run discover-project reads off the target's commit messages, so a project that has
// shipped one ticket needs nothing configured.
//
//   run plane projects                                identifier, id and name of every project
//   run plane create <IDENT> <title> <body-file>      new work item in the todo state; prints its id
//   run plane read <IDENT-n> [--body]                 title, state, labels, body, comments; with
//                                                    --body, the body alone
//   run plane edit <IDENT-n> <body-file> <base-file>  replace its description; the title stays
//   run plane state <IDENT-n> <state>                 todo | in-progress | blocked | done | cancelled
//   run plane comment <IDENT-n> <actor> <text>        one comment, dated to the minute, actor first
//   run plane list <IDENT> [state]                    one line per work item: id, state, title
//
// The instance and workspace come from [tracker] in ~/.postmaster/config.toml (url and
// workspace; POSTMASTER_CONFIG overrides the path). The key is PLANE_API_KEY in the
// environment, else in the file [tracker] env_file names (default ~/.postmaster/plane.env),
// loaded first. The key never enters the config or this repo.
//
// The flow's states map onto Plane's state groups: todo is the first state in the unstarted
// group (backlog if none), in-progress is started, done is completed, cancelled is cancelled.
// Plane has no blocked group, so blocked is a label named `blocked`, added without moving the
// state and removed by the next state change.
//
// Bodies are the ticket shape in markdown. The script renders them to the HTML Plane stores and
// back to markdown on read: headings, paragraphs, line breaks, rules, nested numbered and bullet
// lists, code blocks with their language, bold, inline code and links. create and edit refuse a
// body that would not read back with the same words and structure. edit refuses a description
// holding anything read does not show as Plane stores it, such as emphasis, a table, an image or
// an HTML comment. It also refuses a work item whose body no longer matches the base file, the
// body as `read --body` printed it when the change was drafted.
//
//   exit 0  ok
//   exit 1  usage, config or key missing, the API refused or was unreachable, unknown
//           project or id, or a body create or edit refuses
//   exit 2  invalid state
//   exit 4  the work item changed since the base was read
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tryTomlFile } from "./lib/data.ts";
import { scriptsDir } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";
import {
  digitValue,
  END_OF_STRING,
  PY_DOT,
  PY_S_CLASS,
  pyLower,
  pyTrim,
  pyWords,
} from "./lib/text.ts";

// --- die as throw, so we can catch in create's set_column equivalent ---
export class DieError extends Error {
  constructor(
    public readonly msg: string,
    public readonly code: number = 1,
  ) {
    super(msg);
  }
}
function dieP(msg: string, code = 1): never {
  throw new DieError(msg, code);
}
/** Every die, including no arguments, lands here: BASE's one-line `plane:`
 * report on stderr and its exit code. Anything else is a real bug and
 * keeps its stack. */
function fatal(e: unknown): void {
  if (e instanceof DieError) {
    process.stderr.write(`plane: ${e.msg}\n`);
    process.exit(e.code);
  }
  throw e;
}

// --- html -> markdown --------------------------------------------------------------------------
const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
const SPACED = new Set([
  "td",
  "th",
  "tr",
  "table",
  "tbody",
  "thead",
  "div",
  "blockquote",
  "label",
  "dd",
  "dt",
  "figcaption",
]);
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const BR = "\x01";

export interface Node {
  tag: string;
  attrs: Record<string, string>;
  children: (Node | string)[];
}

export function makeNode(tag: string, attrs: Record<string, string> = {}): Node {
  return { tag, attrs, children: [] };
}

// Simple HTML tokenizer building a tree
export class Tree {
  root: Node = makeNode("#root");
  stack: Node[] = [this.root];
  tags = new Set<string>();
  comments = 0;

  constructor(h: string) {
    this.feed(h || "");
  }

  feed(html: string): void {
    let i = 0;
    const len = html.length;
    while (i < len) {
      const lt = html.indexOf("<", i);
      if (lt < 0) {
        this.handleData(unescapeHtml(html.slice(i)));
        break;
      }
      if (lt > i) {
        this.handleData(unescapeHtml(html.slice(i, lt)));
      }
      // comment
      if (html.startsWith("<!--", lt)) {
        const end = html.indexOf("-->", lt + 4);
        this.comments++;
        i = end >= 0 ? end + 3 : len;
        continue;
      }
      // end tag
      if (html.startsWith("</", lt)) {
        const gt = html.indexOf(">", lt);
        if (gt < 0) break;
        const tag = endTagOf(html.slice(lt + 2, gt));
        this.handleEndTag(tag);
        i = gt + 1;
        continue;
      }
      // start or startend tag
      const gt = html.indexOf(">", lt);
      if (gt < 0) break;
      let tagText = html.slice(lt + 1, gt);
      const selfClose = tagText.endsWith("/");
      if (selfClose) tagText = tagText.slice(0, -1);
      const m = /^([a-zA-Z][a-zA-Z0-9]*)/u.exec(tagText);
      if (!m) {
        i = gt + 1;
        continue;
      }
      const tag = pyLower(m[1] ?? "");
      const attrs = parseAttrs(tagText.slice(m[0].length));
      this.tags.add(tag);
      if (selfClose || VOID.has(tag)) {
        this.handleStartEndTag(tag, attrs);
      } else {
        this.handleStartTag(tag, attrs);
      }
      i = gt + 1;
    }
  }

  handleStartTag(tag: string, attrs: Record<string, string>): void {
    if (tag === "li") {
      for (let k = this.stack.length - 1; k > 0; k--) {
        const st = this.stack[k];
        if (!st) break;
        if (st.tag === "ol" || st.tag === "ul") break;
        if (st.tag === "li") {
          this.stack.length = k;
          break;
        }
      }
    } else if (BLOCK[tag] && this.stack[this.stack.length - 1]?.tag === "p") {
      this.stack.pop();
    }
    const node = makeNode(tag, attrs);
    this.stack[this.stack.length - 1]?.children.push(node);
    if (!VOID.has(tag)) this.stack.push(node);
  }

  handleStartEndTag(tag: string, attrs: Record<string, string>): void {
    this.tags.add(tag);
    this.stack[this.stack.length - 1]?.children.push(makeNode(tag, attrs));
  }

  handleEndTag(tag: string): void {
    for (let k = this.stack.length - 1; k > 0; k--) {
      if (this.stack[k]?.tag === tag) {
        this.stack.length = k;
        return;
      }
    }
  }

  handleData(data: string): void {
    this.stack[this.stack.length - 1]?.children.push(data);
  }
}

export function endTagOf(inner: string): string {
  // text.ts: html.parser strips/lowers/splits end-tag names with Python atoms.
  return pyLower(pyTrim(inner)).split(new RegExp("[" + PY_S_CLASS + ">]", "u"))[0] ?? "";
}

export function parseAttrs(s: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  // text.ts: html.parser attr-scanning splits Python whitespace.
  const re = new RegExp(
    "([a-zA-Z_:][-a-zA-Z0-9_:.]*)[" +
      PY_S_CLASS +
      "]*(?:=[" +
      PY_S_CLASS +
      "]*(?:\"([^\"]*)\"|'([^']*)'|([^" +
      PY_S_CLASS +
      "'\">]+)))?",
    "gu",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const name = pyLower(m[1] ?? "");
    const val = m[2] ?? m[3] ?? m[4] ?? "";
    attrs[name] = unescapeHtml(val);
  }
  return attrs;
}

function unescapeHtml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/gu, (full, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = parseInt(body.slice(2), 16);
      return Number.isNaN(code) ? full : String.fromCodePoint(code);
    }
    if (body.startsWith("#")) {
      const code = parseInt(body.slice(1), 10);
      return Number.isNaN(code) ? full : String.fromCodePoint(code);
    }
    const map: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: "\u00a0",
      hellip: "\u2026",
      mdash: "\u2014",
      ndash: "\u2013",
      lsquo: "\u2018",
      rsquo: "\u2019",
      ldquo: "\u201c",
      rdquo: "\u201d",
      copy: "\u00a9",
      reg: "\u00ae",
      trade: "\u2122",
      deg: "\u00b0",
      plusmn: "\u00b1",
      frac12: "\u00bd",
      frac14: "\u00bc",
      frac34: "\u00be",
      times: "\u00d7",
      divide: "\u00f7",
      laquo: "\u00ab",
      raquo: "\u00bb",
    };
    return map[body] ?? full;
  });
}

function escapeHtml(s: string, quote = false): string {
  let out = s.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
  if (quote) out = out.replace(/"/gu, "&quot;").replace(/'/gu, "&#x27;");
  return out;
}

export function textOf(n: Node | string): string {
  if (typeof n === "string") return n;
  if (n.tag === "br") return "\n";
  return n.children.map(textOf).join("");
}

function hasBlock(n: Node): boolean {
  return n.children.some(
    (c) => typeof c !== "string" && (BLOCK[c.tag] || c.tag === "li" || hasBlock(c)),
  );
}

function flatten(children: (Node | string)[]): (Node | string)[] {
  const out: (Node | string)[] = [];
  for (const c of children) {
    if (typeof c !== "string" && !BLOCK[c.tag] && !INLINE[c.tag] && c.tag !== "li" && hasBlock(c)) {
      out.push(...flatten(c.children));
    } else {
      out.push(c);
    }
  }
  return out;
}

function mdInline(nodes: (Node | string)[]): string {
  const out: string[] = [];
  for (const n of nodes) {
    if (typeof n === "string") {
      out.push(n);
    } else if (INLINE[n.tag]) {
      out.push(INLINE[n.tag]?.(n));
    } else {
      const sep = SPACED.has(n.tag) ? " " : "";
      out.push(sep + mdInline(n.children) + sep);
    }
  }
  return out.join("");
}

function mdStrong(n: Node): string {
  const inner = mdInline(n.children);
  const core = inner.trim();
  if (!core) return inner;
  return (
    inner.slice(0, inner.length - inner.trimStart().length) +
    "**" +
    core +
    "**" +
    inner.slice(inner.trimEnd().length)
  );
}

export function mdCode(n: Node): string {
  const code = pyWords(textOf(n)).join(" ");
  if (!code) return "";
  const runs = code.match(/`+/gu) ?? [];
  const maxRun = runs.reduce((mx, r) => Math.max(mx, r.length), 0);
  const ticks = "`".repeat(maxRun + 1);
  const pad = code.startsWith("`") || code.endsWith("`") ? " " : "";
  return ticks + pad + code + pad + ticks;
}

export function mdLink(n: Node): string {
  const text = pyWords(mdInline(n.children)).join(" ");
  const href = (n.attrs.href ?? "").trim();
  if (!href) return text;
  const escaped = href.replace(/ /gu, "%20").replace(/\(/gu, "%28").replace(/\)/gu, "%29");
  return `[${text || escaped}](${escaped})`;
}

const INLINE: Record<string, (n: Node) => string> = {
  strong: mdStrong,
  b: mdStrong,
  code: mdCode,
  a: mdLink,
  br: () => BR,
};

export function paraLines(nodes: (Node | string)[]): string[] {
  const raw = mdInline(nodes).replace(new RegExp("[" + PY_S_CLASS + "]+", "gu"), " ");
  const segs = raw
    .split(BR)
    .map((s) => pyTrim(s))
    .filter(Boolean);
  return segs.map((s, i) => (i < segs.length - 1 ? `${s}\\` : s));
}

export function mdHeading(n: Node): string[] {
  const text = pyWords(mdInline(n.children).split(BR).join(" ")).join(" ");
  return ["#".repeat(parseInt(n.tag[1] ?? "1", 10)) + (text ? ` ${text}` : "")];
}

export function codeLang(n: Node): string {
  const code = n.children.find((c): c is Node => typeof c !== "string" && c.tag === "code");
  const classes = pyWords(`${code?.attrs.class ?? ""} ${n.attrs.class ?? ""}`);
  for (const c of classes) {
    if (c.startsWith("language-")) return c.slice(9);
  }
  return "";
}

function codeText(n: Node): string {
  const text = textOf(n);
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

function mdPre(n: Node): string[] {
  const text = codeText(n);
  const runs = [...text.matchAll(/^[ \t]*(`{3,})/gmu)].map((m) => m[1]?.length ?? 0);
  const longest = runs.reduce((mx, r) => Math.max(mx, r), 0);
  const fence = "`".repeat(Math.max(3, longest + 1));
  return [fence + codeLang(n), ...(text ? text.split("\n") : []), fence];
}

function listStart(n: Node): number {
  if (n.tag !== "ol") return 1;
  const s = parseInt(n.attrs.start ?? "1", 10);
  return Number.isNaN(s) ? 1 : s;
}

function mdList(n: Node, alt = false): string[] {
  const ordered = n.tag === "ol";
  let number = listStart(n);
  const delim = ordered ? (alt ? ")" : ".") : alt ? "*" : "-";
  const lines: string[] = [];
  for (const c of n.children) {
    if (typeof c === "string" || c.tag !== "li") continue;
    const marker = ordered ? `${number}${delim} ` : `${delim} `;
    number++;
    const body = mdBlocks(c.children, true);
    if (body.length === 0) {
      lines.push(marker.trimEnd());
      continue;
    }
    lines.push(marker + (body[0] ?? ""));
    for (const l of body.slice(1)) {
      lines.push(l ? " ".repeat(marker.length) + l : "");
    }
  }
  return lines;
}

const BLOCK: Record<string, (n: Node) => string[]> = {
  h1: mdHeading,
  h2: mdHeading,
  h3: mdHeading,
  h4: mdHeading,
  h5: mdHeading,
  h6: mdHeading,
  p: (n) => paraLines(n.children),
  pre: mdPre,
  hr: () => ["---"],
  ol: (n) => mdList(n),
  ul: (n) => mdList(n),
};
const RENDERED = new Set([...Object.keys(BLOCK), ...Object.keys(INLINE), "li"]);

function mdBlocks(children: (Node | string)[], inItem = false): string[] {
  const blocks: Array<[string, string[], boolean]> = [];
  let run: (Node | string)[] = [];
  const flush = () => {
    const lines = run.length > 0 ? paraLines(run) : [];
    run = [];
    if (lines.length > 0) blocks.push(["p", lines, false]);
  };
  for (const c of flatten(children)) {
    if (typeof c === "string" || !BLOCK[c.tag]) {
      run.push(c);
      continue;
    }
    flush();
    const alt =
      (c.tag === "ol" || c.tag === "ul") &&
      blocks.length > 0 &&
      blocks[blocks.length - 1]?.[0] === c.tag &&
      !blocks[blocks.length - 1]?.[2];
    const lines = c.tag === "ol" || c.tag === "ul" ? mdList(c, alt) : BLOCK[c.tag]?.(c);
    if (lines.length > 0) blocks.push([c.tag, lines, alt]);
  }
  flush();
  const out: string[] = [];
  for (let k = 0; k < blocks.length; k++) {
    const [tag, lines] = blocks[k]!;
    if (
      k > 0 &&
      !(
        inItem &&
        (tag === "ol" || tag === "ul") &&
        (blocks[k - 1]?.[0] === "p" || blocks[k - 1]?.[0] === "ol" || blocks[k - 1]?.[0] === "ul")
      )
    ) {
      out.push("");
    }
    out.push(...lines);
  }
  return out;
}

export function htmlToText(h: string): string {
  return mdBlocks(new Tree(h).root.children)
    .join("\n")
    .replace(/^\n+|\n+$/gu, "");
}

// --- markdown -> html --------------------------------------------------------------------------
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/u;
const THEMATIC = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/u;
const BULLET = /^( {0,3})([-*+])(?:([ \t]+)(.*))?$/u;
export const ORDERED = new RegExp(
  "^( {0,3})(\\p{Nd}{1,9})([.)])(?:([ \t]+)(" + PY_DOT + "*))?" + END_OF_STRING + "",
  "u",
);
export const FENCE = new RegExp("^( *)(`{3,}|~{3,})(" + PY_DOT + "*)" + END_OF_STRING + "", "u");
const COMMENT = /^ {0,3}<!--/u;
export const LINK_RE = new RegExp(
  "\\[([^\\]]+)\\]\\(((?:[^" + PY_S_CLASS + "()]+|\\([^" + PY_S_CLASS + "()]*\\))+)\\)",
  "gu",
);
export const BOLD = new RegExp(
  "\\*\\*(?=[^" + PY_S_CLASS + "])(" + PY_DOT + "+?)(?<=[^" + PY_S_CLASS + "])\\*\\*",
  "gu",
);

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function fenceAt(line: string, top = true): [number, string, string] | null {
  const m = FENCE.exec(line);
  if (!m) return null;
  const indentLen = (m[1] ?? "").length;
  const fence = m[2] ?? "";
  const info = (m[3] ?? "").trim();
  if ((top && indentLen > 3) || (fence.startsWith("`") && info.includes("`"))) return null;
  return [indentLen, fence, info];
}

function closes(fence: string, line: string): boolean {
  const s = line.trim();
  return s.length >= fence.length && s === fence[0]?.repeat(s.length);
}

function itemAt(
  line: string,
): { kind: string; delim: string; number: number; col: number; rest: string } | null {
  if (THEMATIC.test(line)) return null;
  let m = BULLET.exec(line);
  if (m) {
    const lead = m[1] ?? "",
      marker = m[2] ?? "",
      space = m[3] ?? "",
      rest = m[4] ?? "";
    if (rest && space.length > 4)
      return {
        kind: "ul",
        delim: marker,
        number: 1,
        col: lead.length + marker.length + 1,
        rest: " ".repeat(space.length - 1) + rest,
      };
    const width = rest && space.length <= 4 ? space.length : 1;
    return { kind: "ul", delim: marker, number: 1, col: lead.length + marker.length + width, rest };
  }
  m = ORDERED.exec(line);
  if (!m) return null;
  const lead = m[1] ?? "",
    numStr = m[2] ?? "",
    delim = m[3] ?? "",
    space = m[4] ?? "",
    rest = m[5] ?? "";
  const marker = numStr + delim;
  if (rest && space.length > 4)
    return {
      kind: "ol",
      delim,
      number: parseInt(numStr, 10),
      col: lead.length + marker.length + 1,
      rest: " ".repeat(space.length - 1) + rest,
    };
  const width = rest && space.length <= 4 ? space.length : 1;
  return {
    kind: "ol",
    delim,
    number: parseInt(numStr, 10),
    col: lead.length + marker.length + width,
    rest,
  };
}

function commentBlock(lines: string[], i: number): number | null {
  for (let j = i; j < lines.length; j++) {
    if (lines[j]?.includes("-->")) return j + 1;
  }
  return null;
}

function startsBlock(lines: string[], i: number): boolean {
  const line = lines[i]!;
  return !!(
    ATX.exec(line) ||
    THEMATIC.exec(line) ||
    fenceAt(line) ||
    itemAt(line) ||
    (COMMENT.test(line) && commentBlock(lines, i) !== null)
  );
}

function codeSpans(text: string): [string, string[]] {
  const out: string[] = [];
  const spans: string[] = [];
  let k = 0;
  while (k < text.length) {
    if (text[k] !== "`") {
      out.push(text[k]!);
      k++;
      continue;
    }
    const rest = text.slice(k);
    const _n = rest.length - rest.trimStart().length;
    // count leading backticks
    let nb = 0;
    while (k + nb < text.length && text[k + nb] === "`") nb++;
    const closeRe = new RegExp(`(?<!\`)${"`".repeat(nb)}(?!\`)`, "u");
    const after = text.slice(k + nb);
    const cm = closeRe.exec(after);
    if (!cm) {
      out.push(text.slice(k, k + nb));
      k += nb;
      continue;
    }
    let code = text.slice(k + nb, k + nb + cm.index);
    if (code.length > 1 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) {
      code = code.slice(1, -1);
    }
    out.push(`\x02${spans.length}\x03`);
    spans.push(code);
    k = k + nb + cm.index + cm[0].length;
  }
  return [out.join(""), spans];
}

function inlineMd(text: string): string {
  const [t0, spans] = codeSpans(text);
  const esc = (s: string) => escapeHtml(s, false);
  const bold = (s: string): string => {
    const out: string[] = [];
    let pos = 0;
    for (const m of s.matchAll(BOLD)) {
      out.push(esc(s.slice(pos, m.index)), `<strong>${esc(m[1] ?? "")}</strong>`);
      pos = (m.index ?? 0) + m[0].length;
    }
    out.push(esc(s.slice(pos)));
    return out.join("");
  };
  const out: string[] = [];
  let pos = 0;
  for (const m of t0.matchAll(LINK_RE)) {
    out.push(bold(t0.slice(pos, m.index)));
    out.push(`<a href="${escapeHtml(m[2] ?? "", true)}">${bold(m[1] ?? "")}</a>`);
    pos = (m.index ?? 0) + m[0].length;
  }
  out.push(bold(t0.slice(pos)));
  return out
    .join("")
    .replace(
      /\x02([0-9]+)\x03/gu,
      (_f, i: string) => `<code>${esc(spans[parseInt(i, 10)] ?? "")}</code>`,
    );
}

function itemLines(
  lines: string[],
  i: number,
  st: { col: number; rest: string },
): [string[], number] {
  const col = st.col;
  const body = [st.rest];
  let fence = fenceAt(st.rest, false);
  let blank = false;
  i++;
  while (i < lines.length) {
    const l = lines[i]!;
    const ind = indentOf(l);
    if (fence) {
      body.push(l.slice(Math.min(ind, col)));
      blank = false;
      i++;
      if (closes(fence[1]!, l)) fence = null;
      continue;
    }
    if (!l.trim()) {
      body.push("");
      blank = true;
      i++;
      continue;
    }
    let rel: string;
    if (ind >= col) {
      rel = l.slice(col);
    } else if (itemAt(l)) {
      break;
    } else if (!blank && !startsBlock(lines, i)) {
      rel = l.trim();
    } else if (ind >= 1 && !(ATX.exec(l) || THEMATIC.exec(l))) {
      rel = l.slice(ind);
    } else {
      break;
    }
    body.push(rel);
    blank = false;
    i++;
    fence = fenceAt(rel, false);
  }
  while (body.length > 0 && !body[body.length - 1]?.trim()) body.pop();
  return [body, i];
}

function listHtml(lines: string[], i: number): [string, number] {
  const first = itemAt(lines[i]!)!;
  const items: string[][] = [];
  while (i < lines.length) {
    const st = itemAt(lines[i]!);
    if (!st || st.kind !== first.kind || st.delim !== first.delim) break;
    const [body, nextI] = itemLines(lines, i, st);
    items.push(body);
    i = nextI;
  }
  const start = first.kind === "ol" && first.number !== 1 ? ` start="${first.number}"` : "";
  const lis = items.map((body) => `<li>${htmlBlocks(body).join("")}</li>`).join("");
  return [`<${first.kind}${start}>${lis}</${first.kind}>`, i];
}

function htmlBlocks(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (COMMENT.test(line) && commentBlock(lines, i) !== null) {
      i = commentBlock(lines, i)!;
      continue;
    }
    const f = fenceAt(line);
    if (f) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !closes(f[1]!, lines[i]!)) {
        code.push(lines[i]?.slice(Math.min(f[0], indentOf(lines[i]!))));
        i++;
      }
      i++;
      const lang = f[2] ? (pyWords(f[2])[0] ?? "") : "";
      const cls = lang ? ` class="language-${escapeHtml(lang, true)}"` : "";
      out.push(
        `<pre><code${cls}>${escapeHtml(code.map((l) => `${l}\n`).join(""), false)}</code></pre>`,
      );
      continue;
    }
    const m = ATX.exec(line);
    if (m) {
      const level = (m[1] ?? "").length;
      const text = (m[2] ?? "").replace(/(^|[ \t]+)#+$/u, "").trim();
      out.push(`<h${level}>${inlineMd(text)}</h${level}>`);
      i++;
      continue;
    }
    if (THEMATIC.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (itemAt(line)) {
      const [block, nextI] = listHtml(lines, i);
      out.push(block);
      i = nextI;
      continue;
    }
    const para = [line.trim()];
    i++;
    while (i < lines.length && lines[i]?.trim() && !startsBlock(lines, i)) {
      para.push(lines[i]?.trim());
      i++;
    }
    const text = para
      .map((l, k) => {
        if (l.endsWith("\\") && k < para.length - 1) return l.slice(0, -1) + BR;
        return `${l} `;
      })
      .join("");
    out.push(`<p>${inlineMd(text.trim()).split(BR).join("<br>")}</p>`);
  }
  return out;
}

export function mdToHtml(md: string): string {
  const lines = md
    .replace(/^\ufeff/u, "")
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n")
    .split("\n")
    .map((l) => l.replace(/^[ \t]+/u, (m) => m.replace(/\t/gu, "    ")));
  return htmlBlocks(lines).join("\n");
}

// --- the same words and structure --------------------------------------------------------------
function hrefKey(h: string): string {
  return h.trim().replace(/%28/gu, "(").replace(/%29/gu, ")").replace(/%20/gu, " ");
}

export function shape(h: string): string[] {
  const toks: string[] = [];
  const tree = new Tree(h);

  function inlineToks(nodes: (Node | string)[]): void {
    for (const n of nodes) {
      if (typeof n === "string") {
        toks.push(...pyWords(n));
      } else if (n.tag === "strong" || n.tag === "b") {
        const mark = toks.length;
        toks.push("<b>");
        inlineToks(n.children);
        if (toks.length === mark + 1) {
          toks.length = mark;
        } else {
          toks.push("</b>");
        }
      } else if (n.tag === "code") {
        const words = pyWords(textOf(n));
        if (words.length > 0) toks.push(`<code ${words.join(" ")}>`);
      } else if (n.tag === "a" && (n.attrs.href ?? "").trim()) {
        toks.push(`<a ${hrefKey(n.attrs.href!)}>`);
        inlineToks(n.children);
        toks.push("</a>");
      } else if (n.tag === "br") {
        toks.push("<br>");
      } else {
        inlineToks(n.children);
      }
    }
  }

  function para(nodes: (Node | string)[], open_ = "<p>", close = "</p>"): void {
    const mark = toks.length;
    inlineToks(nodes);
    const inner = toks.splice(mark);
    while (inner.length > 0 && inner[0] === "<br>") inner.shift();
    while (inner.length > 0 && inner[inner.length - 1] === "<br>") inner.pop();
    if (inner.length > 0 || open_ !== "<p>") {
      toks.push(open_, ...inner, close);
    }
  }

  function blocks(children: (Node | string)[]): void {
    let run: (Node | string)[] = [];
    for (const c of flatten(children)) {
      if (typeof c === "string" || !BLOCK[c.tag]) {
        run.push(c);
        continue;
      }
      if (run.length > 0) {
        para(run);
        run = [];
      }
      if (c.tag === "p") {
        para(c.children);
      } else if (HEADINGS.has(c.tag)) {
        const mark = toks.length;
        inlineToks(c.children);
        const inner = toks.splice(mark).filter((t) => t !== "<br>");
        toks.push(`<${c.tag}>`, ...inner, `</${c.tag}>`);
      } else if (c.tag === "pre") {
        toks.push(`<pre ${codeLang(c)}>`, codeText(c), "</pre>");
      } else if (c.tag === "hr") {
        toks.push("<hr>");
      } else {
        const items = c.children.filter((x): x is Node => typeof x !== "string" && x.tag === "li");
        const stray = c.children.filter((x) => {
          if (typeof x === "string") return x.trim().length > 0;
          return x.tag !== "li";
        });
        if (items.length === 0 && stray.length === 0) continue;
        toks.push(c.tag === "ol" ? `<ol start=${listStart(c)}>` : "<ul>");
        for (const li of items) {
          toks.push("<li>");
          blocks(li.children);
          toks.push("</li>");
        }
        if (stray.length > 0) para(stray, "<stray>", "</stray>");
        toks.push(`</${c.tag}>`);
      }
    }
    if (run.length > 0) para(run);
  }

  blocks(tree.root.children);
  return toks;
}

const NAMES: Record<string, string> = {
  p: "a paragraph",
  li: "a list item",
  ul: "a bullet list",
  ol: "a numbered list",
  pre: "a code block",
  hr: "a rule",
  br: "a line break",
  b: "bold text",
  a: "a link",
  code: "inline code",
  stray: "text outside the list's items",
};

function tokenName(toks: string[], n: number): string {
  if (n >= toks.length) return "nothing more";
  const t = toks[n]!;
  if (!t.startsWith("<")) return `"${t}"`;
  const inner = t.slice(1, -1);
  const spIdx = inner.indexOf(" ");
  const tag0 = spIdx >= 0 ? inner.slice(0, spIdx) : inner;
  const detail = spIdx >= 0 ? inner.slice(spIdx + 1) : "";
  const end = tag0.startsWith("/");
  const tag = tag0.replace(/^\/+/u, "");
  let name = HEADINGS.has(tag) ? `a level-${tag[1]} heading` : (NAMES[tag] ?? tag);
  if (detail && !end) {
    const suffix: Record<string, string> = {
      ol: ` (${detail})`,
      a: ` to ${detail}`,
      code: ` "${detail}"`,
      pre: ` in ${detail}`,
    };
    name += suffix[tag] ?? "";
  }
  return end ? `the end of ${name}` : name;
}

export function firstDifference(a: string[], b: string[]): string | null {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  if (n === a.length && n === b.length) return null;
  const words = a
    .slice(0, n)
    .filter((t) => !t.startsWith("<"))
    .slice(-5);
  const where = words.length > 0 ? `after "${words.join(" ")}"` : "at the start";
  return `${where}, ${tokenName(a, n)} becomes ${tokenName(b, n)}`;
}

export function readback(md: string, read?: (h: string) => string): [string, string | null] {
  const out = mdToHtml(md);
  const text = read ? read(out) : htmlToText(out);
  return [out, firstDifference(shape(out), shape(mdToHtml(text)))];
}

function normText(t: string): string {
  const lines = t
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/u, ""));
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

export function planEdit(stored: string, base: string, body: string): [number, string] {
  if (!body.trim()) return [1, "the body file is empty"];
  const tree = new Tree(stored);
  const lost = [...tree.tags]
    .filter((t) => !RENDERED.has(t))
    .sort()
    .map((t) => `<${t}>`);
  const lostTags = tree.comments > 0 ? [...lost, "an HTML comment"] : lost;
  if (lostTags.length > 0) {
    return [
      1,
      `its description holds ${lostTags.join(", ")}, which read does not render, so writing it back would lose it; the user edits it in Plane`,
    ];
  }
  const diff = firstDifference(shape(stored), shape(mdToHtml(htmlToText(stored))));
  if (diff) {
    return [
      1,
      `read does not show its description as Plane stores it (${diff}); the user edits it in Plane`,
    ];
  }
  if (normText(htmlToText(stored)) !== normText(base)) {
    return [4, "it changed since the base was read"];
  }
  const [out, diff2] = readback(body);
  if (diff2) return [1, `the body would not read back as written (${diff2})`];
  return [0, out];
}

// --- the API -----------------------------------------------------------------------------------
const STATES = ["todo", "in-progress", "blocked", "done", "cancelled"];
const GROUPS_FOR: Record<string, string[]> = {
  todo: ["unstarted", "backlog"],
  "in-progress": ["started"],
  done: ["completed"],
  cancelled: ["cancelled"],
};
const STATE_FOR_GROUP: Record<string, string> = {
  backlog: "todo",
  unstarted: "todo",
  triage: "todo",
  started: "in-progress",
  completed: "done",
  cancelled: "cancelled",
};
const BLOCKED = "blocked";

interface PlaneConfig {
  BASE: string;
  WS: string;
  KEY: string;
}

function loadConfig(): PlaneConfig {
  const configPath =
    process.env.POSTMASTER_CONFIG || join(process.env.HOME ?? "", ".postmaster/config.toml");
  if (!existsSync(configPath))
    dieP(`no config at ${configPath} (POSTMASTER_CONFIG overrides the path)`);
  const cfg = tryTomlFile(configPath);
  if (!cfg) dieP(`cannot read ${configPath}`);
  const tracker = (cfg.tracker ?? {}) as Record<string, unknown>;
  const envFileRaw = (tracker.env_file as string) || "~/.postmaster/plane.env";
  const envFile = envFileRaw.replace(/^~/u, process.env.HOME ?? "");
  const machineWorkspace = String(tracker.workspace ?? "");
  const toplevel = run("git", ["rev-parse", "--show-toplevel"]);
  const project =
    process.env.POSTMASTER_PROJECT || (toplevel.code === 0 ? toplevel.out.trim() : "");
  if (project !== "") {
    const insp = run(join(scriptsDir(import.meta), "run"), [
      "project-settings",
      "inspect",
      project,
    ]);
    if (insp.code !== 0) {
      if (insp.err.trim() !== "") console.error(insp.err.trim());
      dieP("cannot read the project's tracker binding");
    }
    let binding = "";
    try {
      binding = (JSON.parse(insp.out).tracker ?? {}).binding ?? "";
    } catch (e) {
      console.error(`project settings gave no JSON: ${e instanceof Error ? e.message : e}`);
      dieP("cannot read the project's tracker binding");
    }
    if (binding !== "" && binding !== machineWorkspace)
      dieP(
        `the project's Plane workspace binding '${binding}' does not match the machine workspace '${machineWorkspace}' in ${configPath}`,
      );
  }
  if (!process.env.PLANE_API_KEY && existsSync(envFile)) {
    const text = readFileSync(envFile, "utf8");
    for (const line of text.split("\n")) {
      const kv = envOf(line);
      if (kv) process.env[kv[0]] = kv[1];
    }
  }
  const KEY = process.env.PLANE_API_KEY ?? "";
  if (!KEY)
    dieP(
      `no PLANE_API_KEY in the environment or in ${envFile} (skills/postmaster/trackers.md, plane)`,
    );
  const BASE = String(tracker.url ?? "").replace(/\/+$/u, "");
  const WS = String(tracker.workspace ?? "");
  if (!BASE || !WS) {
    dieP(
      `[tracker] url and workspace are needed in ${configPath} (skills/postmaster/trackers.md, plane)`,
    );
  }
  return { BASE, WS, KEY };
}

export async function api(
  cfg: PlaneConfig,
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string>,
): Promise<any> {
  let url = `${cfg.BASE}/api/v1/${path}`;
  if (params) {
    const qs = new URLSearchParams(params).toString();
    url += `?${qs}`;
  }
  const headers: Record<string, string> = {
    "X-Api-Key": cfg.KEY,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  // BASE's urlopen(timeout=30): a stalled API is cut off after 30 seconds. In
  // BASE the cutoff escapes as an uncaught TimeoutError traceback (urllib does
  // not wrap it); the port reports it through the same die the neighboring
  // handlers use, with the same words, and the same exit.
  const opts: RequestInit = { method, headers, signal: AbortSignal.timeout(30000) };
  if (body !== undefined) opts.body = JSON.stringify(body);
  try {
    const r = await fetch(url, opts);
    const raw = await r.text();
    if (!r.ok) {
      dieP(`${method} ${path}: HTTP ${r.status} ${raw.slice(0, 300)}`);
    }
    return raw ? JSON.parse(raw) : null;
  } catch (e: any) {
    if (e instanceof DieError) throw e;
    // Our own 30-second cutoff: Bun reports it as TimeoutError, Node as
    // AbortError. Nothing else aborts this signal, so either name is our cutoff.
    if (e?.name === "AbortError" || e?.name === "TimeoutError")
      dieP(`${method} ${path}: timed out`);
    dieP(`${method} ${path}: ${e?.message ?? e}`);
  }
}

async function* pages(
  cfg: PlaneConfig,
  path: string,
  params?: Record<string, string>,
): AsyncGenerator<any> {
  const p: Record<string, string> = { ...(params ?? {}), per_page: "100" };
  for (;;) {
    const page = await api(cfg, "GET", path, undefined, p);
    for (const item of page?.results ?? []) yield item;
    if (!page?.next_page_results) return;
    p.cursor = page.next_cursor;
  }
}

export function parseId(tid: string): [string, number] {
  // text.ts: BASE re.fullmatch(r"([A-Za-z][A-Za-z0-9]*)-(\d+)" (run plane:698); the upper is regex-gated ASCII.
  const m = /^([A-Za-z][A-Za-z0-9]*)-(\p{Nd}+)$/u.exec(tid);
  if (!m) dieP(`not a work item id: ${tid} (expected IDENT-n)`);
  return [(m[1] ?? "").toUpperCase(), Number(digitValue(m[2] ?? "0"))]; // ASCII: group 1 is [A-Za-z0-9]* by the match.
}

const ENV_LINE = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*([^\n]*)$/u; // bash-WS-exact.
export function envOf(line: string): [string, string] | null {
  const m = ENV_LINE.exec(line);
  if (!m) return null;
  let val = m[2] ?? "";
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  return [m[1] ?? "", val];
}

async function projectFor(cfg: PlaneConfig, ident: string): Promise<any> {
  const up = ident.toUpperCase(); // ASCII: Plane identifiers are API-issued ASCII; anything else dies below.
  for await (const p of pages(cfg, `workspaces/${cfg.WS}/projects/`)) {
    if (String(p.identifier ?? "").toUpperCase() === up) return p; // ASCII: API identifiers are ASCII.
  }
  dieP(`no project with identifier ${up} in workspace ${cfg.WS}`);
}

async function statesOf(cfg: PlaneConfig, pid: string): Promise<any[]> {
  const out: any[] = [];
  for await (const s of pages(cfg, `workspaces/${cfg.WS}/projects/${pid}/states/`)) out.push(s);
  return out;
}

async function labelsOf(cfg: PlaneConfig, pid: string): Promise<any[]> {
  const out: any[] = [];
  for await (const l of pages(cfg, `workspaces/${cfg.WS}/projects/${pid}/labels/`)) out.push(l);
  return out;
}

function stateIdFor(states: any[], flowState: string): string {
  for (const group of GROUPS_FOR[flowState] ?? []) {
    const found = states
      .filter((s) => s.group === group)
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    if (found.length > 0) return found[0].id;
  }
  dieP(
    `project has no state in group ${(GROUPS_FOR[flowState] ?? []).join(" or ")} for ${flowState}`,
  );
}

function ref(x: unknown): unknown {
  return typeof x === "object" && x !== null && "id" in x ? (x as any).id : x;
}

function flowStateOf(item: any, states: any[], labels: any[]): string {
  const labelNames: Record<string, string> = {};
  for (const l of labels) labelNames[l.id] = l.name;
  const itemLabels = item.labels ?? [];
  if (itemLabels.some((l: unknown) => pyLower(labelNames[String(ref(l))] ?? "") === BLOCKED))
    return "blocked";
  const stateRef = ref(item.state);
  const group = states.find((s) => s.id === stateRef)?.group;
  return STATE_FOR_GROUP[group ?? ""] ?? (group || "unknown");
}

async function itemFor(cfg: PlaneConfig, tid: string): Promise<[string, any]> {
  const [ident, n] = parseId(tid);
  const item = await api(cfg, "GET", `workspaces/${cfg.WS}/work-items/${ident}-${n}/`);
  return [ident, item];
}

function readFileP(path: string): string {
  try {
    return readFileSync(path, "utf8").replace(/^\ufeff/u, "");
  } catch (e: any) {
    dieP(`cannot read ${path}: ${e?.message ?? e}`);
  }
}

function padZ(n: number): string {
  return String(n).padStart(2, "0");
}

async function runCommands(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = argv.slice(1);

  const cfg = loadConfig();

  if (cmd === "projects") {
    for await (const p of pages(cfg, `workspaces/${cfg.WS}/projects/`)) {
      console.log(`${p.identifier ?? ""}\t${p.id}\t${p.name ?? ""}`);
    }
  } else if (cmd === "create") {
    if (args.length !== 3) dieP("usage: run plane create <IDENT> <title> <body-file>");
    const [ident, title, bodyFile] = [args[0]!, args[1]!, args[2]!];
    const body = readFileP(bodyFile);
    const [outHtml, diff] = readback(body);
    if (diff) dieP(`the body would not read back as written (${diff})`);
    const proj = await projectFor(cfg, ident);
    const todo = stateIdFor(await statesOf(cfg, proj.id), "todo");
    const made = await api(cfg, "POST", `workspaces/${cfg.WS}/projects/${proj.id}/work-items/`, {
      name: title,
      description_html: outHtml,
      state: todo,
    });
    console.log(`${proj.identifier}-${made.sequence_id}`);
  } else if (cmd === "edit") {
    if (args.length !== 3 || !existsSync(args[1] ?? "")) {
      dieP(
        "usage: run plane edit <IDENT-n> <body-file> <base-file> (edit takes no title and never changes one)",
      );
    }
    const body = readFileP(args[1]!);
    const base = readFileP(args[2]!);
    if (!body.trim()) dieP(`the body file ${args[1]} is empty`);
    const [ident, item] = await itemFor(cfg, args[0]!);
    const tid = `${ident}-${item.sequence_id}`;
    const [code, result] = planEdit(item.description_html ?? "", base, body);
    if (code === 4) dieP(`${tid} changed since ${args[2]} was read; read it again`, 4);
    if (code) dieP(`${tid}: ${result}`);
    await api(
      cfg,
      "PATCH",
      `workspaces/${cfg.WS}/projects/${ref(item.project)}/work-items/${item.id}/`,
      {
        description_html: result,
      },
    );
    console.log(`${tid}: edited`);
  } else if (cmd === "read") {
    const rest = args.filter((a) => a !== "--body");
    if (rest.length !== 1 || args.length > 2) dieP("usage: run plane read <IDENT-n> [--body]");
    const [ident, item] = await itemFor(cfg, rest[0]!);
    if (args.includes("--body")) {
      console.log(htmlToText(item.description_html));
      return;
    }
    const pid = ref(item.project);
    const states = await statesOf(cfg, String(pid));
    const labels = await labelsOf(cfg, String(pid));
    const names: Record<string, string> = {};
    for (const l of labels) names[l.id] = l.name;
    console.log(`id: ${ident}-${item.sequence_id}`);
    console.log(`title: ${item.name ?? ""}`);
    console.log(`state: ${flowStateOf(item, states, labels)}`);
    console.log(
      `labels: ${(item.labels ?? []).map((l: unknown) => names[String(ref(l))] ?? "?").join(", ")}`,
    );
    console.log(`created: ${String(item.created_at ?? "").slice(0, 10)}`);
    console.log("");
    console.log(htmlToText(item.description_html));
    const comments: any[] = [];
    for await (const c of pages(
      cfg,
      `workspaces/${cfg.WS}/projects/${pid}/work-items/${item.id}/comments/`,
    )) {
      comments.push(c);
    }
    if (comments.length > 0) {
      console.log("\n## Log");
      for (const c of [...comments].sort((a, b) =>
        String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
      )) {
        console.log(`- ${pyWords(htmlToText(c.comment_html)).join(" ")}`);
      }
    }
  } else if (cmd === "state") {
    if (args.length !== 2) dieP("usage: run plane state <IDENT-n> <state>");
    const newSt = args[1]!;
    if (!STATES.includes(newSt)) dieP(`invalid state ${newSt} (one of: ${STATES.join(", ")})`, 2);
    const [ident, item] = await itemFor(cfg, args[0]!);
    const pid = String(ref(item.project));
    const labels = await labelsOf(cfg, pid);
    const current = (item.labels ?? []).map((l: unknown) => ref(l));
    const blockedIds = labels.filter((l: any) => pyLower(l.name) === BLOCKED).map((l: any) => l.id);
    let patch: Record<string, unknown>;
    if (newSt === "blocked") {
      if (blockedIds.length === 0) {
        const created = await api(cfg, "POST", `workspaces/${cfg.WS}/projects/${pid}/labels/`, {
          name: BLOCKED,
        });
        blockedIds.push(created.id);
      }
      patch = { labels: [...new Set([...current, blockedIds[0]])].sort() };
    } else {
      patch = { state: stateIdFor(await statesOf(cfg, pid), newSt) };
      const blockedSet = new Set(blockedIds);
      if (current.some((l: unknown) => blockedSet.has(l))) {
        patch.labels = current.filter((l: unknown) => !blockedSet.has(l));
      }
    }
    await api(cfg, "PATCH", `workspaces/${cfg.WS}/projects/${pid}/work-items/${item.id}/`, patch);
    console.log(`${ident}-${item.sequence_id}: ${newSt}`);
  } else if (cmd === "comment") {
    if (args.length < 3) dieP("usage: run plane comment <IDENT-n> <actor> <text>");
    const [ident, item] = await itemFor(cfg, args[0]!);
    const actor = args[1]!;
    const text = args.slice(2).join(" ");
    const now = new Date();
    const stamp = `${now.getFullYear()}-${padZ(now.getMonth() + 1)}-${padZ(now.getDate())} ${padZ(now.getHours())}:${padZ(now.getMinutes())}`;
    const line = `${stamp} ${actor}: ${text}`;
    const pid = String(ref(item.project));
    await api(cfg, "POST", `workspaces/${cfg.WS}/projects/${pid}/work-items/${item.id}/comments/`, {
      comment_html: `<p>${escapeHtml(line, false)}</p>`,
    });
    console.log(`${ident}-${item.sequence_id}: ${line}`);
  } else if (cmd === "list") {
    if (args.length !== 1 && args.length !== 2) dieP("usage: run plane list <IDENT> [state]");
    const want = args.length === 2 ? args[1] : null;
    if (want && !STATES.includes(want))
      dieP(`invalid state ${want} (one of: ${STATES.join(", ")})`, 2);
    const proj = await projectFor(cfg, args[0]!);
    const states = await statesOf(cfg, proj.id);
    const labels = await labelsOf(cfg, proj.id);
    const items: any[] = [];
    for await (const it of pages(cfg, `workspaces/${cfg.WS}/projects/${proj.id}/work-items/`))
      items.push(it);
    for (const it of items.sort((a, b) => (a.sequence_id ?? 0) - (b.sequence_id ?? 0))) {
      const st = flowStateOf(it, states, labels);
      if (want === null || st === want) {
        console.log(`${proj.identifier}-${it.sequence_id}\t${st}\t${it.name ?? ""}`);
      }
    }
  } else {
    dieP("usage: run plane projects|create|edit|read|state|comment|list ...");
  }
}

// --- dispatch ---------------------------------------------------------------------------------
const firstArg = process.argv[2];
if (import.meta.main) {
  if (!firstArg) {
    try {
      dieP("usage: run plane projects|create|edit|read|state|comment|list ...");
    } catch (e) {
      fatal(e);
    }
  } else {
    runCommands().catch(fatal);
  }
}
