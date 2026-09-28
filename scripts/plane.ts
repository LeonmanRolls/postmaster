// Plane work items as tickets, through Plane's REST API. One Plane project per target repo,
// matched by the project identifier that prefixes every work item id (PM-12): the same prefix
// scripts/discover-project.sh reads off the target's commit messages, so a project that has
// shipped one ticket needs nothing configured.
//
//   plane.sh projects                                identifier, id and name of every project
//   plane.sh create <IDENT> <title> <body-file>      new work item in the todo state; prints its id
//   plane.sh read <IDENT-n> [--body]                 title, state, labels, body, comments; with
//                                                    --body, the body alone
//   plane.sh edit <IDENT-n> <body-file> <base-file>  replace its description; the title stays
//   plane.sh state <IDENT-n> <state>                 todo | in-progress | blocked | done | cancelled
//   plane.sh comment <IDENT-n> <actor> <text>        one comment, dated to the minute, actor first
//   plane.sh list <IDENT> [state]                    one line per work item: id, state, title
//   plane.sh --self-test                             the converters and edit's checks, offline
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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tryTomlFile } from "./lib/data.ts";
import { run } from "./lib/proc.ts";

// --- die as throw, so we can catch in create's set_column equivalent ---
class DieError extends Error {
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

interface Node {
  tag: string;
  attrs: Record<string, string>;
  children: (Node | string)[];
}

function makeNode(tag: string, attrs: Record<string, string> = {}): Node {
  return { tag, attrs, children: [] };
}

// Simple HTML tokenizer building a tree
class Tree {
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
        const tag =
          html
            .slice(lt + 2, gt)
            .trim()
            .toLowerCase()
            .split(/[\s>]/)[0] ?? "";
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
      const m = /^([a-zA-Z][a-zA-Z0-9]*)/.exec(tagText);
      if (!m) {
        i = gt + 1;
        continue;
      }
      const tag = (m[1] ?? "").toLowerCase();
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

function parseAttrs(s: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const name = (m[1] ?? "").toLowerCase();
    const val = m[2] ?? m[3] ?? m[4] ?? "";
    attrs[name] = unescapeHtml(val);
  }
  return attrs;
}

function unescapeHtml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (full, body: string) => {
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
  let out = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (quote) out = out.replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
  return out;
}

function textOf(n: Node | string): string {
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

function mdCode(n: Node): string {
  const code = textOf(n).split(/\s+/).filter(Boolean).join(" ");
  if (!code) return "";
  const runs = code.match(/`+/g) ?? [];
  const maxRun = runs.reduce((mx, r) => Math.max(mx, r.length), 0);
  const ticks = "`".repeat(maxRun + 1);
  const pad = code.startsWith("`") || code.endsWith("`") ? " " : "";
  return ticks + pad + code + pad + ticks;
}

function mdLink(n: Node): string {
  const text = mdInline(n.children).split(/\s+/).filter(Boolean).join(" ");
  const href = (n.attrs.href ?? "").trim();
  if (!href) return text;
  const escaped = href.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `[${text || escaped}](${escaped})`;
}

const INLINE: Record<string, (n: Node) => string> = {
  strong: mdStrong,
  b: mdStrong,
  code: mdCode,
  a: mdLink,
  br: () => BR,
};

function paraLines(nodes: (Node | string)[]): string[] {
  const raw = mdInline(nodes).replace(/\s+/g, " ");
  const segs = raw
    .split(BR)
    .map((s) => s.trim())
    .filter(Boolean);
  return segs.map((s, i) => (i < segs.length - 1 ? `${s}\\` : s));
}

function mdHeading(n: Node): string[] {
  const text = mdInline(n.children).split(BR).join(" ").split(/\s+/).filter(Boolean).join(" ");
  return ["#".repeat(parseInt(n.tag[1] ?? "1", 10)) + (text ? ` ${text}` : "")];
}

function codeLang(n: Node): string {
  const code = n.children.find((c): c is Node => typeof c !== "string" && c.tag === "code");
  const classes = `${code?.attrs.class ?? ""} ${n.attrs.class ?? ""}`.split(/\s+/).filter(Boolean);
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
  const runs = [...text.matchAll(/^[ \t]*(`{3,})/gm)].map((m) => m[1]?.length ?? 0);
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

function htmlToText(h: string): string {
  return mdBlocks(new Tree(h).root.children)
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

// --- markdown -> html --------------------------------------------------------------------------
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const THEMATIC = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const BULLET = /^( {0,3})([-*+])(?:([ \t]+)(.*))?$/;
const ORDERED = /^( {0,3})(\d{1,9})([.)])(?:([ \t]+)(.*))?$/;
const FENCE = /^( *)(`{3,}|~{3,})(.*)$/;
const COMMENT = /^ {0,3}<!--/;
const LINK_RE = /\[([^\]]+)\]\(((?:[^\s()]|\([^\s()]*\))+)\)/g;
const BOLD = /\*\*(?=\S)(.+?)(?<=\S)\*\*/g;

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
    const closeRe = new RegExp(`(?<!\`)${"`".repeat(nb)}(?!\`)`);
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
      /\x02(\d+)\x03/g,
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
      const lang = f[2] ? (f[2].split(/\s+/)[0] ?? "") : "";
      const cls = lang ? ` class="language-${escapeHtml(lang, true)}"` : "";
      out.push(
        `<pre><code${cls}>${escapeHtml(code.map((l) => `${l}\n`).join(""), false)}</code></pre>`,
      );
      continue;
    }
    const m = ATX.exec(line);
    if (m) {
      const level = (m[1] ?? "").length;
      const text = (m[2] ?? "").replace(/(^|[ \t]+)#+$/, "").trim();
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

function mdToHtml(md: string): string {
  const lines = md
    .replace(/^\ufeff/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.replace(/^[ \t]+/, (m) => m.replace(/\t/g, "    ")));
  return htmlBlocks(lines).join("\n");
}

// --- the same words and structure --------------------------------------------------------------
function hrefKey(h: string): string {
  return h.trim().replace(/%28/g, "(").replace(/%29/g, ")").replace(/%20/g, " ");
}

function shape(h: string): string[] {
  const toks: string[] = [];
  const tree = new Tree(h);

  function inlineToks(nodes: (Node | string)[]): void {
    for (const n of nodes) {
      if (typeof n === "string") {
        toks.push(...n.split(/\s+/).filter(Boolean));
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
        const words = textOf(n).split(/\s+/).filter(Boolean);
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
  const tag = tag0.replace(/^\/+/, "");
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

function firstDifference(a: string[], b: string[]): string | null {
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

function readback(md: string, read?: (h: string) => string): [string, string | null] {
  const out = mdToHtml(md);
  const text = read ? read(out) : htmlToText(out);
  return [out, firstDifference(shape(out), shape(mdToHtml(text)))];
}

function normText(t: string): string {
  const lines = t
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""));
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

function planEdit(stored: string, base: string, body: string): [number, string] {
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

// --- self-test ---------------------------------------------------------------------------------
function selfTest(): number {
  const SCRIPT = join(import.meta.dir, "plane.sh");
  const fails = [0];
  const check = (label: string, good: boolean, detail: unknown = ""): void => {
    console.log((good ? "  ok   " : "  FAIL ") + label);
    if (!good) {
      const s = String(detail);
      for (const l of s.split("\n")) console.log(`         ${l}`);
      fails[0] = (fails[0] ?? 0) + 1;
    }
  };
  const delta = (a: string, b: string): string => {
    const al = a.split("\n"),
      bl = b.split("\n");
    const out: string[] = [];
    for (let i = 0; i < Math.max(al.length, bl.length); i++) {
      if (al[i] !== bl[i]) out.push(`-${al[i] ?? ""}\n+${bl[i] ?? ""}`);
    }
    return out.join("\n") || "(no difference)";
  };
  function criteria(h: string): number {
    const kids = new Tree(h).root.children.filter((c): c is Node => typeof c !== "string");
    for (let k = 0; k < kids.length - 1; k++) {
      const c = kids[k]!;
      if (
        c.tag === "h2" &&
        textOf(c).split(/\s+/).filter(Boolean).join(" ") === "Acceptance criteria" &&
        kids[k + 1]?.tag === "ol"
      ) {
        return kids[k + 1]?.children.filter((x) => typeof x !== "string" && x.tag === "li").length;
      }
    }
    return 0;
  }

  const body = `${[
    "## Problem / feature\nA ticket reaches a coachman with no criteria, so it has nothing to judge the lanes against.",
    "## Acceptance criteria\n1. The check exits 0 on a well-formed ticket and prints how many criteria it has.\n2. It exits 2 and names each missing part:\n   - the title\n   - the direction\n   1. a nested number is part of criterion 2, not a criterion\n\n   ```\n   ## Direction\n   ticket-check.sh --body draft.md   # which draft? TODO\n   ```\n3. A question or a marker in code, `a?` or `TODO`, is not read,\nand a line that runs straight on belongs to the criterion above it.\n\n   So does an indented paragraph after a blank line.",
    "## Direction\n<!-- a template comment is not read: TBD -->\nNone: any approach that meets the criteria.",
    "## Turnpikes\n<!-- default, none, or turnpike names -->\n`default`",
    "## Notes\nA heading inside a fenced block is not a section:\n\n```\n## Direction\n```",
  ].join("\n\n")}\n`;

  const editor =
    '<h2 class="editor-heading-block">Acceptance criteria</h2>' +
    '<ol class="list-decimal pl-7 space-y-[--list-spacing-y] tight" data-tight="true">' +
    '<li class="not-prose space-y-2"><p class="editor-paragraph-block">The check runs.</p></li>' +
    '<li class="not-prose space-y-2"><p class="editor-paragraph-block">It names each part.</p></li>' +
    '</ol><p class="editor-paragraph-block"></p>';

  console.log("positive controls");
  const [outHtml, diff] = readback(body);
  check(
    "the ticket-check fixture reads back with the same words and structure",
    diff === null,
    diff,
  );
  const once = htmlToText(outHtml);
  check(
    "it keeps exactly 3 top-level criteria, and one Direction heading",
    criteria(mdToHtml(once)) === 3 && mdToHtml(once).split("<h2>Direction</h2>").length - 1 === 1,
    once,
  );
  check(
    "a line running straight on stays in its criterion, and a comment stays hidden",
    once.includes(
      "3. A question or a marker in code, `a?` or `TODO`, is not read, and a line that runs straight on",
    ) && !outHtml.includes("template comment"),
    once,
  );
  let h = mdToHtml("1. Runs:\n   ```\n## not a heading\n\nnot indented\n   ```\n2. Names.");
  check(
    "a code block in a criterion keeps its less indented lines",
    h.split("<ol").length - 1 === 1 &&
      h.split("<li>").length - 1 === 2 &&
      h.includes("<li><p>Runs:</p><pre><code>## not a heading\n\nnot indented\n</code></pre></li>"),
    h,
  );
  h = mdToHtml("## Direction ##\n\nuse ``a`b`` and `` `x `` here\\\nnext line");
  check(
    "the writer drops a heading's closing #s and a code span's padding, and keeps a hard break",
    h === "<h2>Direction</h2>\n<p>use <code>a`b</code> and <code>`x</code> here<br>next line</p>",
    h,
  );
  const twice = htmlToText(mdToHtml(once));
  check("a second cycle gives the same text", twice === once, delta(once, twice));
  const editorText = htmlToText(editor);
  check(
    "Plane editor lists read as one line per item",
    editorText.includes("1. The check runs.\n2. It names each part."),
    editorText,
  );
  h = mdToHtml("1. A\n\n2. B\n\n3. C");
  check(
    "blank lines between items leave one list of three",
    h.split("<ol").length - 1 === 1 && h.split("<li>").length - 1 === 3,
    h,
  );
  const nested =
    "<ul><li><p>a</p><ol><li><p>b</p></li><li><p>c</p></li></ol></li><li><p>d</p></li></ul>";
  const nestedText = htmlToText(nested);
  check("nested lists read back indented", nestedText === "- a\n  1. b\n  2. c\n- d", nestedText);
  const nestedDiff = firstDifference(shape(nested), shape(mdToHtml(nestedText)));
  check("and render to the same structure", nestedDiff === null, nestedDiff);
  const code = '<pre><code class="language-python">print("x")\n</code></pre>';
  const codeTextOut = htmlToText(code);
  check(
    "a code block keeps its language",
    codeTextOut === '```python\nprint("x")\n```' &&
      mdToHtml(codeTextOut).includes('class="language-python"'),
    codeTextOut,
  );
  const links =
    '<p>See <a href="https://en.wikipedia.org/wiki/Foo_(bar)">Foo</a>, ' +
    '<a href="mailto:a@example.org">mail</a> and <a href="/docs/x">docs</a>.</p>';
  const linksText = htmlToText(links);
  const linksDiff = firstDifference(shape(links), shape(mdToHtml(linksText)));
  check(
    "links survive: an href with parentheses, mailto and a relative one",
    linksDiff === null && linksText.includes("Foo_%28bar%29"),
    linksText,
  );
  const misc =
    '<p>one<br>two</p><hr><ol start="3"><li><p>c</p></li></ol>' +
    "<ul><li><p>x</p></li></ul><ul><li><p>y</p></li></ul>";
  const miscText = htmlToText(misc);
  const miscDiff = firstDifference(shape(misc), shape(mdToHtml(miscText)));
  check(
    "line breaks, rules, a list's start and two lists in a row survive",
    miscDiff === null &&
      miscText.includes("one\\\ntwo") &&
      miscText.includes("---") &&
      miscText.includes("3. c") &&
      miscText.includes("- x") &&
      miscText.includes("* y"),
    miscText,
  );
  const baseText = htmlToText(editor);
  const [editCode, editOut] = planEdit(
    editor,
    `${baseText}\n`,
    `${baseText}\n\n## Direction\n\nNone: any approach that meets the criteria.\n`,
  );
  check(
    "edit writes stored editor HTML back with the approved part added and the list kept",
    editCode === 0 &&
      editOut.includes("<h2>Direction</h2>") &&
      editOut.split("<li>").length - 1 === 2,
    [editCode, editOut],
  );

  console.log("negative controls");
  const bad = '<p>x <em>y</em></p><table><tr><td>z</td></tr></table><img src="a.png"><!-- c -->';
  let [code_, why] = planEdit(bad, htmlToText(bad), "## Direction\n\nNone.");
  check(
    "edit refuses markup read does not render, and names it",
    code_ === 1 && ["<em>", "<table>", "<img>", "an HTML comment"].every((s) => why.includes(s)),
    why,
  );
  [code_, why] = planEdit("<p>1. not a list</p>", "1. not a list", "x");
  check(
    "edit refuses a description read does not show as stored",
    code_ === 1 && why.includes("as Plane stores it"),
    why,
  );
  [code_, why] = planEdit(editor, `${baseText}\n\nAn edit made in Plane since.`, "x");
  check("edit refuses a work item that changed since the base was read", code_ === 4, [code_, why]);
  [code_, why] = planEdit(editor, baseText, " \n\n");
  check("edit refuses an empty body", code_ === 1 && why.includes("empty"), [code_, why]);
  const lost = firstDifference(shape(mdToHtml("1. A\n2. B\n3. C")), shape(mdToHtml("1. A\n2. B")));
  check("the read-back check reports a lost list item", !!lost?.includes("a list item"), lost);
  const flat = firstDifference(
    shape(mdToHtml("1. A\n   - x\n   - y")),
    shape(mdToHtml("1. A\n- x\n- y")),
  );
  check("the read-back check reports a flattened list", !!flat?.includes("a bullet list"), flat);
  const [, diff3] = readback("1. A\n   - x\n   - y\n", (ht) =>
    htmlToText(ht).replace(/\n {3}- /g, "\n- "),
  );
  check("a body a reader would flatten is refused", !!diff3?.includes("a bullet list"), diff3);

  // old edit form: invoke the wrapper with a title as body-file (not a file) -> usage error
  const d = mkdtempSync(join(tmpdir(), "plane-st-"));
  try {
    const cfg = join(d, "config.toml");
    const bf = join(d, "body.md");
    writeFileSync(cfg, '[tracker]\nkind = "plane"\nurl = "http://127.0.0.1:9"\nworkspace = "ws"\n');
    writeFileSync(bf, body);
    const r = run("bash", [SCRIPT, "edit", "PM-1", "A title", bf], {
      env: { ...process.env, POSTMASTER_CONFIG: cfg, PLANE_API_KEY: "self-test" },
    });
    check(
      "the old edit form, with a title, is a usage error before any request",
      r.code === 1 && r.err.includes("usage:") && !r.err.includes("GET"),
      r.err,
    );
  } finally {
    rmSync(d, { recursive: true, force: true });
  }

  console.log("");
  if (fails[0] === 0) {
    console.log("self-test: all controls behaved");
    return 0;
  }
  console.log(`self-test: ${fails[0]} control(s) misbehaved`);
  return 1;
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
  const envFile = envFileRaw.replace(/^~/, process.env.HOME ?? "");
  if (!process.env.PLANE_API_KEY && existsSync(envFile)) {
    const text = readFileSync(envFile, "utf8");
    for (const line of text.split("\n")) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (m) {
        let val = m[2] ?? "";
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        process.env[m[1] ?? ""] = val;
      }
    }
  }
  const KEY = process.env.PLANE_API_KEY ?? "";
  if (!KEY)
    dieP(
      `no PLANE_API_KEY in the environment or in ${envFile} (skills/postmaster/trackers.md, plane)`,
    );
  const BASE = String(tracker.url ?? "").replace(/\/+$/, "");
  const WS = String(tracker.workspace ?? "");
  if (!BASE || !WS) {
    dieP(
      `[tracker] url and workspace are needed in ${configPath} (skills/postmaster/trackers.md, plane)`,
    );
  }
  return { BASE, WS, KEY };
}

async function api(
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
  const opts: RequestInit = { method, headers };
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

function parseId(tid: string): [string, number] {
  const m = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(tid);
  if (!m) dieP(`not a work item id: ${tid} (expected IDENT-n)`);
  return [(m[1] ?? "").toUpperCase(), parseInt(m[2] ?? "0", 10)];
}

async function projectFor(cfg: PlaneConfig, ident: string): Promise<any> {
  const up = ident.toUpperCase();
  for await (const p of pages(cfg, `workspaces/${cfg.WS}/projects/`)) {
    if (String(p.identifier ?? "").toUpperCase() === up) return p;
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
  if (itemLabels.some((l: unknown) => (labelNames[String(ref(l))] ?? "").toLowerCase() === BLOCKED))
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
    return readFileSync(path, "utf8").replace(/^\ufeff/, "");
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

  if (cmd === "--self-test") {
    process.exit(selfTest());
  }

  const cfg = loadConfig();

  if (cmd === "projects") {
    for await (const p of pages(cfg, `workspaces/${cfg.WS}/projects/`)) {
      console.log(`${p.identifier ?? ""}\t${p.id}\t${p.name ?? ""}`);
    }
  } else if (cmd === "create") {
    if (args.length !== 3) dieP("usage: plane.sh create <IDENT> <title> <body-file>");
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
        "usage: plane.sh edit <IDENT-n> <body-file> <base-file> (edit takes no title and never changes one)",
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
    if (rest.length !== 1 || args.length > 2) dieP("usage: plane.sh read <IDENT-n> [--body]");
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
        console.log(`- ${htmlToText(c.comment_html).split(/\s+/).filter(Boolean).join(" ")}`);
      }
    }
  } else if (cmd === "state") {
    if (args.length !== 2) dieP("usage: plane.sh state <IDENT-n> <state>");
    const newSt = args[1]!;
    if (!STATES.includes(newSt)) dieP(`invalid state ${newSt} (one of: ${STATES.join(", ")})`, 2);
    const [ident, item] = await itemFor(cfg, args[0]!);
    const pid = String(ref(item.project));
    const labels = await labelsOf(cfg, pid);
    const current = (item.labels ?? []).map((l: unknown) => ref(l));
    const blockedIds = labels
      .filter((l: any) => l.name.toLowerCase() === BLOCKED)
      .map((l: any) => l.id);
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
    if (args.length < 3) dieP("usage: plane.sh comment <IDENT-n> <actor> <text>");
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
    if (args.length !== 1 && args.length !== 2) dieP("usage: plane.sh list <IDENT> [state]");
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
    dieP("usage: plane.sh projects|create|edit|read|state|comment|list ... | --self-test");
  }
}

// --- dispatch ---------------------------------------------------------------------------------
const firstArg = process.argv[2];
if (firstArg === "--self-test") {
  process.exit(selfTest());
} else if (!firstArg) {
  dieP("usage: plane.sh projects|create|edit|read|state|comment|list ... | --self-test");
} else {
  runCommands().catch((e) => {
    if (e instanceof DieError) {
      process.stderr.write(`plane: ${e.msg}\n`);
      process.exit(e.code);
    }
    throw e;
  });
}
