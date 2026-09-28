#!/usr/bin/env bun
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { command, makeTemp, removeTree, scriptDir, writeError, writeOut } from "./lib/core.ts";
type HtmlNode = { tag: string; attrs: Record<string, string>; children: Array<HtmlNode | string> };
type Dict = Record<string, any>;
const scriptPath = join(scriptDir(import.meta.url), "plane.sh");
const tick = String.fromCharCode(96);
const voidTags = new Set([
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
const spacedTags = new Set([
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
const headings = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const rendered = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "pre",
  "hr",
  "ol",
  "ul",
  "strong",
  "b",
  "code",
  "a",
  "br",
  "li",
]);
const br = "\x01";
const entityMap: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  copy: "©",
  mdash: "—",
  ndash: "–",
  hellip: "…",
};
class ExitFault extends Error {
  constructor(
    message: string,
    readonly code = 1,
  ) {
    super(message);
  }
}
function die(message: string, code = 1): never {
  throw new ExitFault(message, code);
}
function decodeEntities(text: string): string {
  return text.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const n = ref[1]?.toLowerCase() === "x" ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
      try {
        return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
      } catch {
        return "\ufffd";
      }
    }
    return entityMap[ref.toLowerCase()] ?? whole;
  });
}
const blockTags = new Set([...headings, "p", "pre", "hr", "ol", "ul"]);
class HtmlTree {
  root: HtmlNode = { tag: "#root", attrs: {}, children: [] };
  stack: HtmlNode[] = [this.root];
  tags = new Set<string>();
  comments = 0;
  constructor(html: string) {
    const tokens = html.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>]*>|[^<]+|</g) ?? [];
    for (const token of tokens) {
      if (token.startsWith("<!--")) {
        this.comments++;
        continue;
      }
      if (/^<!/.test(token)) continue;
      const closing = /^<\/\s*([A-Za-z][\w:-]*)/.exec(token);
      if (closing) {
        this.end(closing[1]!.toLowerCase());
        continue;
      }
      const opening = /^<\s*([A-Za-z][\w:-]*)([\s\S]*?)\/?>$/.exec(token);
      if (opening) {
        const attrs: Record<string, string> = {};
        const tag = opening[1]!.toLowerCase();
        const attrRe = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
        for (const m of (opening[2] ?? "").matchAll(attrRe))
          attrs[m[1]!.toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
        this.start(tag, attrs, /\/>$/.test(token));
        continue;
      }
      this.stack.at(-1)!.children.push(decodeEntities(token));
    }
  }
  start(tag: string, attrs: Record<string, string>, selfClosing: boolean): void {
    this.tags.add(tag);
    if (tag === "li") {
      for (let k = this.stack.length - 1; k > 0; k--) {
        if (this.stack[k]!.tag === "ol" || this.stack[k]!.tag === "ul") break;
        if (this.stack[k]!.tag === "li") {
          this.stack.splice(k);
          break;
        }
      }
    } else if (blockTags.has(tag) && this.stack.at(-1)!.tag === "p") this.stack.pop();
    const node: HtmlNode = { tag, attrs, children: [] };
    this.stack.at(-1)!.children.push(node);
    if (!selfClosing && !voidTags.has(tag)) this.stack.push(node);
  }
  end(tag: string): void {
    for (let k = this.stack.length - 1; k > 0; k--) {
      if (this.stack[k]!.tag === tag) {
        this.stack.splice(k);
        return;
      }
    }
  }
}
function textOf(value: HtmlNode | string): string {
  if (typeof value === "string") return value;
  return value.tag === "br" ? "\n" : value.children.map(textOf).join("");
}
function hasBlock(node: HtmlNode): boolean {
  return node.children.some(
    (child) => typeof child !== "string" && (blockTags.has(child.tag) || child.tag === "li" || hasBlock(child)),
  );
}
const inlineTags = new Set(["strong", "b", "code", "a", "br"]);
function flatten(children: Array<HtmlNode | string>): Array<HtmlNode | string> {
  const output: Array<HtmlNode | string> = [];
  for (const child of children) {
    if (
      typeof child !== "string" &&
      !blockTags.has(child.tag) &&
      child.tag !== "li" &&
      !inlineTags.has(child.tag) &&
      hasBlock(child)
    )
      output.push(...flatten(child.children));
    else output.push(child);
  }
  return output;
}
function mdInline(nodes: Array<HtmlNode | string>): string {
  return nodes
    .map((node) => {
      if (typeof node === "string") return node;
      if (node.tag === "strong" || node.tag === "b") return mdStrong(node);
      if (node.tag === "code") return mdCode(node);
      if (node.tag === "a") return mdLink(node);
      if (node.tag === "br") return br;
      const sep = spacedTags.has(node.tag) ? " " : "";
      return sep + mdInline(node.children) + sep;
    })
    .join("");
}
function mdStrong(node: HtmlNode): string {
  const inner = mdInline(node.children),
    core = inner.trim();
  if (!core) return inner;
  return (
    inner.slice(0, inner.length - inner.trimStart().length) + "**" + core + "**" + inner.slice(inner.trimEnd().length)
  );
}
function mdCode(node: HtmlNode): string {
  const code = textOf(node).split(/\s+/).filter(Boolean).join(" ");
  if (!code) return "";
  let longest = 0;
  for (const match of code.matchAll(new RegExp(tick + "+", "g"))) longest = Math.max(longest, match[0].length);
  const fences = tick.repeat(longest + 1),
    pad = code.startsWith(tick) || code.endsWith(tick) ? " " : "";
  return fences + pad + code + pad + fences;
}
function mdLink(node: HtmlNode): string {
  const text = mdInline(node.children).split(/\s+/).filter(Boolean).join(" ");
  let href = (node.attrs.href ?? "").trim();
  if (!href) return text;
  href = href.replaceAll(" ", "%20").replaceAll("(", "%28").replaceAll(")", "%29");
  return "[" + (text || href) + "](" + href + ")";
}
function paraLines(nodes: Array<HtmlNode | string>): string[] {
  const segments = mdInline(nodes)
    .replace(/\s+/g, " ")
    .split(br)
    .map((s) => s.trim())
    .filter(Boolean);
  return segments.map((s, i) => s + (i + 1 < segments.length ? "\\" : ""));
}
function mdHeading(node: HtmlNode): string[] {
  const text = mdInline(node.children).replaceAll(br, " ").split(/\s+/).filter(Boolean).join(" ");
  return ["#".repeat(Number(node.tag[1])) + (text ? " " + text : "")];
}
function codeLang(node: HtmlNode): string {
  const code = node.children.find((c): c is HtmlNode => typeof c !== "string" && c.tag === "code");
  const classes = ((code?.attrs.class ?? "") + " " + (node.attrs.class ?? "")).split(/\s+/);
  return classes.find((c) => c.startsWith("language-"))?.slice(9) ?? "";
}
function codeText(node: HtmlNode): string {
  const text = textOf(node);
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}
function mdPre(node: HtmlNode): string[] {
  const text = codeText(node),
    fenceRe = new RegExp("^[ \\t]*(" + tick + "{3,})", "gm");
  let longest = 0;
  for (const match of text.matchAll(fenceRe)) longest = Math.max(longest, match[1]!.length);
  const fence = tick.repeat(Math.max(3, longest + 1));
  return [fence + codeLang(node), ...(text ? text.split("\n") : []), fence];
}
function listStart(node: HtmlNode): number {
  if (node.tag !== "ol") return 1;
  const n = Number.parseInt(node.attrs.start || "1", 10);
  return Number.isNaN(n) ? 1 : n;
}
function mdList(node: HtmlNode, alt = false): string[] {
  const ordered = node.tag === "ol";
  let number = listStart(node);
  const delim = ordered ? (alt ? ")" : ".") : alt ? "*" : "-";
  const output: string[] = [];
  for (const item of node.children.filter((c): c is HtmlNode => typeof c !== "string" && c.tag === "li")) {
    const marker = ordered ? String(number++) + delim + " " : delim + " ";
    const body = mdBlocks(item.children, true);
    if (!body.length) {
      output.push(marker.trimEnd());
      continue;
    }
    output.push(marker + body[0]);
    output.push(...body.slice(1).map((line) => (line ? " ".repeat(marker.length) + line : "")));
  }
  return output;
}
function mdBlocks(children: Array<HtmlNode | string>, inItem = false): string[] {
  const blocks: Array<{ tag: string; lines: string[]; alt: boolean }> = [];
  let run: Array<HtmlNode | string> = [];
  const flush = () => {
    const lines = run.length ? paraLines(run) : [];
    run = [];
    if (lines.length) blocks.push({ tag: "p", lines, alt: false });
  };
  for (const child of flatten(children)) {
    if (typeof child === "string" || !blockTags.has(child.tag)) {
      run.push(child);
      continue;
    }
    flush();
    const alt = (child.tag === "ol" || child.tag === "ul") && blocks.at(-1)?.tag === child.tag && !blocks.at(-1)?.alt;
    let lines: string[];
    if (child.tag === "p") lines = paraLines(child.children);
    else if (headings.has(child.tag)) lines = mdHeading(child);
    else if (child.tag === "pre") lines = mdPre(child);
    else if (child.tag === "hr") lines = ["---"];
    else lines = mdList(child, alt);
    if (lines.length) blocks.push({ tag: child.tag, lines, alt });
  }
  flush();
  const output: string[] = [];
  blocks.forEach((block, k) => {
    const previous = blocks[k - 1]?.tag;
    const joinsItemList =
      inItem && (block.tag === "ol" || block.tag === "ul") && ["p", "ol", "ul"].includes(previous ?? "");
    if (k && !joinsItemList) output.push("");
    output.push(...block.lines);
  });
  return output;
}
function htmlToText(html: string): string {
  return mdBlocks(new HtmlTree(html || "").root.children)
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}
const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const thematic = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const bullet = /^( {0,3})([-*+])(?:([ \t]+)(.*))?$/;
const ordered = /^( {0,3})(\d{1,9})([.)])(?:([ \t]+)(.*))?$/;
const fenceRe = new RegExp("^( *)(" + tick + "{3,}|~{3,})(.*)$");
const commentRe = /^ {0,3}<!--/;
const linkRe = /\[([^\]]+)\]\(((?:[^\s()]|\([^\s()]*\))+)\)/g;
const boldRe = /\*\*(?=\S)(.+?)(?<=\S)\*\*/g;
function indent(line: string): number {
  return line.length - line.trimStart().length;
}
function fenceAt(line: string, top = true): [number, string, string] | null {
  const m = fenceRe.exec(line);
  if (!m || (top && m[1]!.length > 3) || (m[2]![0] === tick && m[3]!.includes(tick))) return null;
  return [m[1]!.length, m[2]!, m[3]!.trim()];
}
function closes(fence: string, line: string): boolean {
  const s = line.trim();
  return s.length >= fence.length && s === fence[0]!.repeat(s.length);
}
type ListItem = { kind: "ol" | "ul"; delim: string; number: number; col: number; rest: string };
function itemAt(line: string): ListItem | null {
  if (thematic.test(line)) return null;
  let m = bullet.exec(line),
    kind: "ol" | "ul",
    delim: string,
    number: number,
    lead: string,
    marker: string,
    space: string,
    rest: string;
  if (m) {
    lead = m[1]!;
    marker = m[2]!;
    space = m[3] ?? "";
    rest = m[4] ?? "";
    kind = "ul";
    delim = marker;
    number = 1;
  } else {
    m = ordered.exec(line);
    if (!m) return null;
    lead = m[1]!;
    marker = m[2]! + m[3]!;
    space = m[4] ?? "";
    rest = m[5] ?? "";
    kind = "ol";
    delim = m[3]!;
    number = Number(m[2]);
  }
  if (rest && space.length > 4) rest = " ".repeat(space.length - 1) + rest;
  const width = rest && space.length <= 4 ? space.length : 1;
  return { kind, delim, number, col: lead.length + marker.length + width, rest };
}
function commentBlock(lines: string[], start: number): number | null {
  for (let j = start; j < lines.length; j++) if (lines[j]!.includes("-->")) return j + 1;
  return null;
}
function startsBlock(lines: string[], i: number): boolean {
  const line = lines[i]!;
  return (
    atx.test(line) ||
    thematic.test(line) ||
    !!fenceAt(line) ||
    !!itemAt(line) ||
    (commentRe.test(line) && !!commentBlock(lines, i))
  );
}
function codeSpans(text: string): [string, string[]] {
  let output = "",
    k = 0;
  const spans: string[] = [];
  while (k < text.length) {
    if (text[k] !== tick) {
      output += text[k++];
      continue;
    }
    let n = 1;
    while (text[k + n] === tick) n++;
    const closeRe = new RegExp("(?<!" + tick + ")" + tick.repeat(n) + "(?!" + tick + ")");
    const close = closeRe.exec(text.slice(k + n));
    if (!close) {
      output += text.slice(k, k + n);
      k += n;
      continue;
    }
    let code = text.slice(k + n, k + n + close.index);
    if (code.length > 1 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) code = code.slice(1, -1);
    output += "\x02" + spans.length + "\x03";
    spans.push(code);
    k += n + close.index + n;
  }
  return [output, spans];
}
function escapeHtml(text: string, quote = false): string {
  let out = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  if (quote) out = out.replaceAll('"', "&quot;");
  return out;
}
function inline(text: string): string {
  const [masked, spans] = codeSpans(text);
  const bold = (value: string) => {
    let out = "",
      pos = 0;
    for (const m of value.matchAll(boldRe)) {
      out += escapeHtml(value.slice(pos, m.index)) + "<strong>" + escapeHtml(m[1]!) + "</strong>";
      pos = m.index! + m[0].length;
    }
    return out + escapeHtml(value.slice(pos));
  };
  let out = "",
    pos = 0;
  for (const m of masked.matchAll(linkRe)) {
    out += bold(masked.slice(pos, m.index)) + '<a href="' + escapeHtml(m[2]!, true) + '">' + bold(m[1]!) + "</a>";
    pos = m.index! + m[0].length;
  }
  out += bold(masked.slice(pos));
  const codeMarker = new RegExp(String.fromCharCode(2) + "(\\d+)" + String.fromCharCode(3), "g");
  return out.replace(codeMarker, (_all, index: string) => "<code>" + escapeHtml(spans[Number(index)]!) + "</code>");
}
function itemLines(lines: string[], start: number, state: ListItem): [string[], number] {
  const body = [state.rest],
    col = state.col;
  let fence = fenceAt(state.rest, false),
    blank = false,
    i = start + 1;
  while (i < lines.length) {
    const line = lines[i]!,
      ind = indent(line);
    if (fence) {
      body.push(line.slice(Math.min(ind, col)));
      blank = false;
      i++;
      if (closes(fence[1], line)) fence = null;
      continue;
    }
    if (!line.trim()) {
      body.push("");
      blank = true;
      i++;
      continue;
    }
    let rel: string;
    if (ind >= col) rel = line.slice(col);
    else if (itemAt(line)) break;
    else if (!blank && !startsBlock(lines, i)) rel = line.trim();
    else if (ind >= 1 && !atx.test(line) && !thematic.test(line)) rel = line.slice(ind);
    else break;
    body.push(rel);
    blank = false;
    i++;
    fence = fenceAt(rel, false);
  }
  while (body.length && !body.at(-1)!.trim()) body.pop();
  return [body, i];
}
function listHtml(lines: string[], start: number): [string, number] {
  const first = itemAt(lines[start]!)!;
  const items: string[][] = [];
  let i = start;
  while (i < lines.length) {
    const state = itemAt(lines[i]!);
    if (!state || state.kind !== first.kind || state.delim !== first.delim) break;
    const result = itemLines(lines, i, state);
    items.push(result[0]);
    i = result[1];
  }
  const startAttr = first.kind === "ol" && first.number !== 1 ? ' start="' + first.number + '"' : "";
  const lis = items.map((item) => "<li>" + htmlBlocks(item).join("") + "</li>").join("");
  return ["<" + first.kind + startAttr + ">" + lis + "</" + first.kind + ">", i];
}
function htmlBlocks(lines: string[]): string[] {
  const output: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const closeComment = commentRe.test(line) ? commentBlock(lines, i) : null;
    if (closeComment) {
      i = closeComment;
      continue;
    }
    const fence = fenceAt(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !closes(fence[1], lines[i]!)) {
        const l = lines[i]!;
        code.push(l.slice(Math.min(fence[0], indent(l))));
        i++;
      }
      i++;
      const lang = fence[2].split(/\s+/)[0] ?? "";
      const cls = lang ? ' class="language-' + escapeHtml(lang, true) + '"' : "";
      output.push("<pre><code" + cls + ">" + escapeHtml(code.map((l) => l + "\n").join("")) + "</code></pre>");
      continue;
    }
    const heading = atx.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const text = (heading[2] ?? "").replace(/(^|[ \t]+)#+$/, "").trim();
      output.push("<h" + level + ">" + inline(text) + "</h" + level + ">");
      i++;
      continue;
    }
    if (thematic.test(line)) {
      output.push("<hr>");
      i++;
      continue;
    }
    if (itemAt(line)) {
      const result = listHtml(lines, i);
      output.push(result[0]);
      i = result[1];
      continue;
    }
    const para = [line.trim()];
    i++;
    while (i < lines.length && lines[i]!.trim() && !startsBlock(lines, i)) para.push(lines[i++]!.trim());
    const text = para.map((l, k) => (l.endsWith("\\") && k < para.length - 1 ? l.slice(0, -1) + br : l + " ")).join("");
    output.push("<p>" + inline(text.trim()).replaceAll(br, "<br>") + "</p>");
  }
  return output;
}
function mdToHtml(markdown: string): string {
  const lines = markdown
    .replace(/^\ufeff/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^[ \t]+/, (spaces) => " ".repeat(spaces.replace(/\t/g, "    ").length)));
  return htmlBlocks(lines).join("\n");
}
function hrefKey(href: string): string {
  return href.trim().replaceAll("%28", "(").replaceAll("%29", ")").replaceAll("%20", " ");
}
function shape(html: string): string[] {
  const tokens: string[] = [];
  const inlineTokens = (nodes: Array<HtmlNode | string>) => {
    for (const node of nodes) {
      if (typeof node === "string") tokens.push(...node.split(/\s+/).filter(Boolean));
      else if (node.tag === "strong" || node.tag === "b") {
        const mark = tokens.length;
        tokens.push("<b>");
        inlineTokens(node.children);
        if (tokens.length === mark + 1) tokens.splice(mark);
        else tokens.push("</b>");
      } else if (node.tag === "code") {
        const text = textOf(node).split(/\s+/).filter(Boolean).join(" ");
        if (text) tokens.push("<code " + text + ">");
      } else if (node.tag === "a" && (node.attrs.href ?? "").trim()) {
        tokens.push("<a " + hrefKey(node.attrs.href!) + ">");
        inlineTokens(node.children);
        tokens.push("</a>");
      } else if (node.tag === "br") tokens.push("<br>");
      else inlineTokens(node.children);
    }
  };
  const para = (nodes: Array<HtmlNode | string>, open = "<p>", close = "</p>") => {
    const mark = tokens.length;
    inlineTokens(nodes);
    const inner = tokens.splice(mark);
    while (inner[0] === "<br>") inner.shift();
    while (inner.at(-1) === "<br>") inner.pop();
    if (inner.length || open !== "<p>") tokens.push(open, ...inner, close);
  };
  const blocks = (children: Array<HtmlNode | string>) => {
    let run: Array<HtmlNode | string> = [];
    for (const child of flatten(children)) {
      if (typeof child === "string" || !blockTags.has(child.tag)) {
        run.push(child);
        continue;
      }
      if (run.length) {
        para(run);
        run = [];
      }
      if (child.tag === "p") para(child.children);
      else if (headings.has(child.tag)) {
        const mark = tokens.length;
        inlineTokens(child.children);
        const inner = tokens.splice(mark).filter((t) => t !== "<br>");
        tokens.push("<" + child.tag + ">", ...inner, "</" + child.tag + ">");
      } else if (child.tag === "pre") tokens.push("<pre " + codeLang(child) + ">", codeText(child), "</pre>");
      else if (child.tag === "hr") tokens.push("<hr>");
      else {
        const items = child.children.filter((n): n is HtmlNode => typeof n !== "string" && n.tag === "li");
        const stray = child.children.filter(
          (n) => !(typeof n !== "string" && n.tag === "li") && (typeof n !== "string" || n.trim()),
        );
        if (!items.length && !stray.length) continue;
        tokens.push(child.tag === "ol" ? "<ol start=" + listStart(child) + ">" : "<ul>");
        for (const item of items) {
          tokens.push("<li>");
          blocks(item.children);
          tokens.push("</li>");
        }
        if (stray.length) para(stray, "<stray>", "</stray>");
        tokens.push("</" + child.tag + ">");
      }
    }
    if (run.length) para(run);
  };
  blocks(new HtmlTree(html || "").root.children);
  return tokens;
}
const names: Record<string, string> = {
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
function tokenName(tokens: string[], index: number): string {
  if (index >= tokens.length) return "nothing more";
  const token = tokens[index]!;
  if (!token.startsWith("<")) return '"' + token + '"';
  const inner = token.slice(1, -1),
    at = inner.indexOf(" ");
  const tag0 = at < 0 ? inner : inner.slice(0, at),
    detail = at < 0 ? "" : inner.slice(at + 1);
  const end = tag0.startsWith("/");
  const tag = tag0.replace(/^\//, "");
  let name = headings.has(tag) ? "a level-" + tag[1] + " heading" : (names[tag] ?? tag);
  if (detail && !end) {
    if (tag === "ol") name += " (" + detail + ")";
    else if (tag === "a") name += " to " + detail;
    else if (tag === "code") name += ' "' + detail + '"';
    else if (tag === "pre") name += " in " + detail;
  }
  return end ? "the end of " + name : name;
}
function firstDifference(a: string[], b: string[]): string | null {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  if (n === a.length && n === b.length) return null;
  const words = a
    .slice(0, n)
    .filter((t) => !t.startsWith("<"))
    .slice(-5);
  const where = words.length ? 'after "' + words.join(" ") + '"' : "at the start";
  return where + ", " + tokenName(a, n) + " becomes " + tokenName(b, n);
}
function readback(markdown: string, reader: (html: string) => string = htmlToText): [string, string | null] {
  const output = mdToHtml(markdown);
  return [output, firstDifference(shape(output), shape(mdToHtml(reader(output))))];
}
function normText(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""));
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines.at(-1)) lines.pop();
  return lines.join("\n");
}
function planEdit(stored: string, base: string, body: string): [number, string] {
  if (!body.trim()) return [1, "the body file is empty"];
  const tree = new HtmlTree(stored);
  const lost = [
    ...[...tree.tags]
      .filter((tag) => !rendered.has(tag))
      .sort()
      .map((tag) => "<" + tag + ">"),
    ...(tree.comments ? ["an HTML comment"] : []),
  ];
  if (lost.length)
    return [
      1,
      "its description holds " +
        lost.join(", ") +
        ", which read does not render, so writing it back would lose it; the user edits it in Plane",
    ];
  const diff = firstDifference(shape(stored), shape(mdToHtml(htmlToText(stored))));
  if (diff)
    return [1, "read does not show its description as Plane stores it (" + diff + "); the user edits it in Plane"];
  if (normText(htmlToText(stored)) !== normText(base)) return [4, "it changed since the base was read"];
  const [output, readDiff] = readback(body);
  if (readDiff) return [1, "the body would not read back as written (" + readDiff + ")"];
  return [0, output];
}
function selfTest(): number {
  let fails = 0;
  const check = (label: string, good: boolean, detail: unknown = "") => {
    writeOut((good ? "  ok   " : "  FAIL ") + label);
    if (!good) {
      for (const line of String(detail).split("\n")) writeOut("         " + line);
      fails++;
    }
  };
  const delta = (a: string, b: string) => (a === b ? "(no difference)" : "wanted:\n" + a + "\ngot:\n" + b);
  const criteriaCount = (html: string) => {
    const kids = new HtmlTree(html).root.children.filter((c): c is HtmlNode => typeof c !== "string");
    for (let k = 0; k < kids.length - 1; k++) {
      if (
        kids[k]!.tag === "h2" &&
        textOf(kids[k]!).split(/\s+/).join(" ") === "Acceptance criteria" &&
        kids[k + 1]!.tag === "ol"
      )
        return kids[k + 1]!.children.filter((c) => typeof c !== "string" && c.tag === "li").length;
    }
    return 0;
  };
  const triple = tick.repeat(3);
  const body =
    [
      "## Problem / feature\nA ticket reaches a coachman with no criteria, so it has nothing to judge the lanes against.",
      "## Acceptance criteria\n" +
        "1. The check exits 0 on a well-formed ticket and prints how many criteria it has.\n" +
        "2. It exits 2 and names each missing part:\n" +
        "   - the title\n" +
        "   - the direction\n" +
        "   1. a nested number is part of criterion 2, not a criterion\n\n" +
        "   " +
        triple +
        "\n" +
        "   ## Direction\n" +
        "   ticket-check.sh --body draft.md   # which draft? TODO\n" +
        "   " +
        triple +
        "\n" +
        "3. A question or a marker in code, " +
        tick +
        "a?" +
        tick +
        " or " +
        tick +
        "TODO" +
        tick +
        ", is not read,\n" +
        "and a line that runs straight on belongs to the criterion above it.\n" +
        "and a line that runs straight on belongs to the criterion above it.\n\n" +
        "   So does an indented paragraph after a blank line.",
      "## Direction\n<!-- a template comment is not read: TBD -->\nNone: any approach that meets the criteria.",
      "## Turnpikes\n<!-- default, none, or turnpike names -->\n" + tick + "default" + tick,
      "## Notes\nA heading inside a fenced block is not a section:\n\n" + triple + "\n## Direction\n" + triple,
    ].join("\n\n") + "\n";
  const editor =
    '<h2 class="editor-heading-block">Acceptance criteria</h2>' +
    '<ol class="list-decimal pl-7 space-y-[--list-spacing-y] tight" data-tight="true">' +
    '<li class="not-prose space-y-2"><p class="editor-paragraph-block">The check runs.</p></li>' +
    '<li class="not-prose space-y-2"><p class="editor-paragraph-block">It names each part.</p></li>' +
    '</ol><p class="editor-paragraph-block"></p>';
  writeOut("positive controls");
  const [out, diff] = readback(body);
  check("the ticket-check fixture reads back with the same words and structure", diff === null, diff);
  const once = htmlToText(out);
  check(
    "it keeps exactly 3 top-level criteria, and one Direction heading",
    criteriaCount(mdToHtml(once)) === 3 && mdToHtml(once).split("<h2>Direction</h2>").length - 1 === 1,
    once,
  );
  check(
    "a line running straight on stays in its criterion, and a comment stays hidden",
    once.includes(
      "3. A question or a marker in code, " +
        tick +
        "a?" +
        tick +
        " or " +
        tick +
        "TODO" +
        tick +
        ", is not read, and a line that runs straight on",
    ) && !out.includes("template comment"),
    once,
  );
  let html = mdToHtml("1. Runs:\n   " + triple + "\n## not a heading\n\nnot indented\n   " + triple + "\n2. Names.");
  check(
    "a code block in a criterion keeps its less indented lines",
    html.split("<ol").length - 1 === 1 &&
      html.split("<li>").length - 1 === 2 &&
      html.includes("<li><p>Runs:</p><pre><code>## not a heading\n\nnot indented\n</code></pre></li>"),
    html,
  );
  html = mdToHtml(
    "## Direction ##\n\nuse " +
      tick.repeat(2) +
      "a" +
      tick +
      "b" +
      tick.repeat(2) +
      " and " +
      tick.repeat(2) +
      " " +
      tick +
      "x " +
      tick.repeat(2) +
      " here\\\nnext line",
  );
  check(
    "the writer drops a heading's closing #s and a code span's padding, and keeps a hard break",
    html ===
      "<h2>Direction</h2>\n<p>use <code>a" + tick + "b</code> and <code>" + tick + "x</code> here<br>next line</p>",
    html,
  );
  const twice = htmlToText(mdToHtml(once));
  check("a second cycle gives the same text", twice === once, delta(once, twice));
  let text = htmlToText(editor);
  check(
    "Plane editor lists read as one line per item",
    text.includes("1. The check runs.\n2. It names each part."),
    text,
  );
  html = mdToHtml("1. A\n\n2. B\n\n3. C");
  check(
    "blank lines between items leave one list of three",
    html.includes("<ol>") && html.split("<li>").length - 1 === 3,
    html,
  );
  const nested = "<ul><li><p>a</p><ol><li><p>b</p></li><li><p>c</p></li></ol></li><li><p>d</p></li></ul>";
  text = htmlToText(nested);
  check("nested lists read back indented", text === "- a\n  1. b\n  2. c\n- d", text);
  check(
    "and render to the same structure",
    firstDifference(shape(nested), shape(mdToHtml(text))) === null,
    firstDifference(shape(nested), shape(mdToHtml(text))),
  );
  const code = '<pre><code class="language-python">print("x")\n</code></pre>';
  text = htmlToText(code);
  check(
    "a code block keeps its language",
    text === triple + 'python\nprint("x")\n' + triple && mdToHtml(text).includes('class="language-python"'),
    text,
  );
  const links =
    '<p>See <a href="https://en.wikipedia.org/wiki/Foo_(bar)">Foo</a>, ' +
    '<a href="mailto:a@example.org">mail</a> and <a href="/docs/x">docs</a>.</p>';
  text = htmlToText(links);
  check(
    "links survive: an href with parentheses, mailto and a relative one",
    firstDifference(shape(links), shape(mdToHtml(text))) === null && text.includes("Foo_%28bar%29"),
    text,
  );
  const misc =
    '<p>one<br>two</p><hr><ol start="3"><li><p>c</p></li></ol>' +
    "<ul><li><p>x</p></li></ul><ul><li><p>y</p></li></ul>";
  text = htmlToText(misc);
  check(
    "line breaks, rules, a list's start and two lists in a row survive",
    firstDifference(shape(misc), shape(mdToHtml(text))) === null &&
      text.includes("one\\\ntwo") &&
      text.includes("---") &&
      text.includes("3. c") &&
      text.includes("- x") &&
      text.includes("* y"),
    text,
  );
  const base = htmlToText(editor);
  const edit = planEdit(
    editor,
    base + "\n",
    base + "\n\n## Direction\n\nNone: any approach that meets the criteria.\n",
  );
  check(
    "edit writes stored editor HTML back with the approved part added and the list kept",
    edit[0] === 0 && edit[1].includes("<h2>Direction</h2>") && edit[1].split("<li>").length - 1 === 2,
    edit,
  );

  writeOut("negative controls");
  const bad = '<p>x <em>y</em></p><table><tr><td>z</td></tr></table><img src="a.png"><!-- c -->';
  let [codeResult, why] = planEdit(bad, htmlToText(bad), "## Direction\n\nNone.");
  check(
    "edit refuses markup read does not render, and names it",
    codeResult === 1 && ["<em>", "<table>", "<img>", "an HTML comment"].every((s) => why.includes(s)),
    why,
  );
  [codeResult, why] = planEdit("<p>1. not a list</p>", "1. not a list", "x");
  check(
    "edit refuses a description read does not show as stored",
    codeResult === 1 && why.includes("as Plane stores it"),
    why,
  );
  [codeResult, why] = planEdit(editor, base + "\n\nAn edit made in Plane since.", "x");
  check("edit refuses a work item that changed since the base was read", codeResult === 4, [codeResult, why]);
  [codeResult, why] = planEdit(editor, base, " \n\n");
  check("edit refuses an empty body", codeResult === 1 && why.includes("empty"), [codeResult, why]);
  const lost = firstDifference(shape(mdToHtml("1. A\n2. B\n3. C")), shape(mdToHtml("1. A\n2. B")));
  check("the read-back check reports a lost list item", lost !== null && lost.includes("a list item"), lost);
  const flat = firstDifference(shape(mdToHtml("1. A\n   - x\n   - y")), shape(mdToHtml("1. A\n- x\n- y")));
  check("the read-back check reports a flattened list", flat !== null && flat.includes("a bullet list"), flat);
  const [_ignored, readDiff] = readback("1. A\n   - x\n   - y\n", (h) => htmlToText(h).replaceAll("\n   - ", "\n- "));
  check("a body a reader would flatten is refused", readDiff !== null && readDiff.includes("a bullet list"), readDiff);
  const tmp = makeTemp("plane-test-");
  try {
    const config = join(tmp, "config.toml"),
      bodyPath = join(tmp, "body.md");
    writeFileSync(config, '[tracker]\nkind = "plane"\nurl = "http://127.0.0.1:9"\nworkspace = "ws"\n');
    writeFileSync(bodyPath, body);
    const result = command(scriptPath, ["edit", "PM-1", "A title", bodyPath], {
      env: { POSTMASTER_CONFIG: config, PLANE_API_KEY: "self-test" },
    });
    check(
      "the old edit form, with a title, is a usage error before any request",
      result.code === 1 && result.stderr.includes("usage:") && !result.stderr.includes("GET"),
      result.stderr,
    );
  } finally {
    removeTree(tmp);
  }
  writeOut("");
  writeOut(fails ? "self-test: " + fails + " control(s) misbehaved" : "self-test: all controls behaved");
  return fails ? 1 : 0;
}
const states = ["todo", "in-progress", "blocked", "done", "cancelled"];
const groupsFor: Record<string, string[]> = {
  todo: ["unstarted", "backlog"],
  "in-progress": ["started"],
  done: ["completed"],
  cancelled: ["cancelled"],
};
const stateForGroup: Record<string, string> = {
  backlog: "todo",
  unstarted: "todo",
  triage: "todo",
  started: "in-progress",
  completed: "done",
  cancelled: "cancelled",
};
const blocked = "blocked";
function readConfig(path: string): Dict {
  try {
    const parsed = Bun.TOML.parse(readFileSync(path, "utf8")) as Dict;
    return (parsed.tracker as Dict | undefined) ?? {};
  } catch (error) {
    die("cannot read " + path + ": " + String(error).replace(/^Error: /, ""));
  }
}
function envFileValues(path: string): Record<string, string> {
  const result: Record<string, string> = {};
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (error) {
    die("cannot read " + path + ": " + String(error).replace(/^Error: /, ""));
  }
  for (const source of content!.split(/\r?\n/)) {
    const line = source.trim().replace(/^export\s+/, "");
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2]!.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    result[m[1]!] = value;
  }
  return result;
}
function expandHome(path: string): string {
  return path === "~"
    ? (process.env.HOME ?? "")
    : path.startsWith("~/")
      ? join(process.env.HOME ?? "", path.slice(2))
      : path;
}
type ApiContext = { base: string; workspace: string; key: string };
async function api<T = any>(
  ctx: ApiContext,
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string>,
): Promise<T> {
  let url = ctx.base + "/api/v1/" + path;
  if (params) url += "?" + new URLSearchParams(params).toString();
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { "X-Api-Key": ctx.key, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    die(method + " " + path + ": " + String(error).replace(/^Error: /, ""));
  }
  if (!response!.ok) {
    const detail = (await response!.text()).slice(0, 300);
    die(method + " " + path + ": HTTP " + response!.status + " " + detail);
  }
  const text = await response!.text();
  return (text ? JSON.parse(text) : null) as T;
}
async function* pages(ctx: ApiContext, path: string, params: Record<string, string> = {}): AsyncGenerator<Dict> {
  const current: Record<string, string> = { ...params, per_page: "100" };
  while (true) {
    const page = await api<Dict>(ctx, "GET", path, undefined, current);
    yield* page.results ?? [];
    if (!page.next_page_results) return;
    current.cursor = page.next_cursor;
  }
}
function usage(text: string): never {
  die("usage: plane.sh " + text);
}
function parseId(tid: string): [string, number] {
  const m = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(tid);
  if (!m) die("not a work item id: " + tid + " (expected IDENT-n)");
  return [m![1]!.toUpperCase(), Number(m![2])];
}
async function projectFor(ctx: ApiContext, ident: string): Promise<Dict> {
  const wanted = ident.toUpperCase();
  for await (const project of pages(ctx, "workspaces/" + ctx.workspace + "/projects/")) {
    if (String(project.identifier ?? "").toUpperCase() === wanted) return project;
  }
  die("no project with identifier " + wanted + " in workspace " + ctx.workspace);
}
async function collectPages(ctx: ApiContext, path: string): Promise<Dict[]> {
  const output: Dict[] = [];
  for await (const item of pages(ctx, path)) output.push(item);
  return output;
}
async function statesOf(ctx: ApiContext, projectId: string): Promise<Dict[]> {
  return collectPages(ctx, "workspaces/" + ctx.workspace + "/projects/" + projectId + "/states/");
}
async function labelsOf(ctx: ApiContext, projectId: string): Promise<Dict[]> {
  return collectPages(ctx, "workspaces/" + ctx.workspace + "/projects/" + projectId + "/labels/");
}
function stateIdFor(items: Dict[], flowState: string): string {
  for (const group of groupsFor[flowState] ?? []) {
    const found = items.filter((state) => state.group === group).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    if (found.length) return found[0]!.id;
  }
  die("project has no state in group " + (groupsFor[flowState] ?? []).join(" or ") + " for " + flowState);
}
function ref(value: any): string {
  return typeof value === "object" && value !== null ? value.id : value;
}
function flowState(item: Dict, stateList: Dict[], labelList: Dict[]): string {
  const labelNames = new Map(labelList.map((label) => [label.id, label.name]));
  if ((item.labels ?? []).some((label: any) => String(labelNames.get(ref(label)) ?? "").toLowerCase() === blocked))
    return "blocked";
  const group = stateList.find((state) => state.id === ref(item.state))?.group;
  return stateForGroup[group] ?? group ?? "unknown";
}
async function itemFor(ctx: ApiContext, tid: string): Promise<[string, Dict]> {
  const [ident, number] = parseId(tid);
  const item = await api<Dict>(ctx, "GET", "workspaces/" + ctx.workspace + "/work-items/" + ident + "-" + number + "/");
  return [ident, item];
}
function readFile(path: string): string {
  try {
    return readFileSync(path, "utf8").replace(/^\ufeff/, "");
  } catch (error) {
    die("cannot read " + path + ": " + String(error).replace(/^Error: /, ""));
  }
}
async function run(args: string[]): Promise<number> {
  try {
    if (args[0] === "--self-test")
      return args.length === 1 ? selfTest() : usage("projects|create|edit|read|state|comment|list ... | --self-test");
    if (!args.length) die("usage: plane.sh projects|create|edit|read|state|comment|list ... | --self-test");
    const configPath = process.env.POSTMASTER_CONFIG ?? join(process.env.HOME ?? "", ".postmaster", "config.toml");
    if (!existsSync(configPath)) die("no config at " + configPath + " (POSTMASTER_CONFIG overrides the path)");
    const cfg = readConfig(configPath);
    const envPath = expandHome(String(cfg.env_file || "~/.postmaster/plane.env"));
    let key = process.env.PLANE_API_KEY;
    if (!key && existsSync(envPath)) key = envFileValues(envPath).PLANE_API_KEY;
    if (!key) die("no PLANE_API_KEY in the environment or in " + envPath + " (skills/postmaster/trackers.md, plane)");
    const base = String(cfg.url ?? "").replace(/\/+$/, ""),
      workspace = String(cfg.workspace ?? "");
    if (!base || !workspace)
      die("[tracker] url and workspace are needed in " + configPath + " (skills/postmaster/trackers.md, plane)");
    const ctx: ApiContext = { base, workspace, key };
    const [cmd, ...rest] = args;
    if (cmd === "projects") {
      if (rest.length) usage("projects");
      for await (const project of pages(ctx, "workspaces/" + workspace + "/projects/"))
        writeOut(String(project.identifier ?? "") + "\t" + project.id + "\t" + String(project.name ?? ""));
    } else if (cmd === "create") {
      if (rest.length !== 3) usage("create <IDENT> <title> <body-file>");
      const [ident, title, bodyPath] = rest as [string, string, string];
      const body = readFile(bodyPath),
        [output, diff] = readback(body);
      if (diff) die("the body would not read back as written (" + diff + ")");
      const project = await projectFor(ctx, ident);
      const todo = stateIdFor(await statesOf(ctx, project.id), "todo");
      const made = await api<Dict>(
        ctx,
        "POST",
        "workspaces/" + workspace + "/projects/" + project.id + "/work-items/",
        { name: title, description_html: output, state: todo },
      );
      writeOut(String(project.identifier) + "-" + made.sequence_id);
    } else if (cmd === "edit") {
      if (rest.length !== 3 || !existsSync(rest[1]!) || !isFile(rest[1]!))
        usage("edit <IDENT-n> <body-file> <base-file> (edit takes no title and never changes one)");
      const [tid, bodyPath, basePath] = rest as [string, string, string];
      const body = readFile(bodyPath),
        baseText = readFile(basePath);
      if (!body.trim()) die("the body file " + bodyPath + " is empty");
      const [ident, item] = await itemFor(ctx, tid);
      const itemId = ident + "-" + item.sequence_id;
      const [code, result] = planEdit(item.description_html ?? "", baseText, body);
      if (code === 4) die(itemId + " changed since " + basePath + " was read; read it again", 4);
      if (code) die(itemId + ": " + result);
      await api(
        ctx,
        "PATCH",
        "workspaces/" + workspace + "/projects/" + ref(item.project) + "/work-items/" + item.id + "/",
        { description_html: result },
      );
      writeOut(itemId + ": edited");
    } else if (cmd === "read") {
      const bodyOnly = rest.includes("--body");
      const targets = rest.filter((arg) => arg !== "--body");
      if (targets.length !== 1 || rest.length > 2) usage("read <IDENT-n> [--body]");
      const [ident, item] = await itemFor(ctx, targets[0]!);
      if (bodyOnly) {
        writeOut(htmlToText(item.description_html ?? ""));
        return 0;
      }
      const projectId = ref(item.project),
        stateList = await statesOf(ctx, projectId),
        labelList = await labelsOf(ctx, projectId);
      const labelNames = new Map(labelList.map((label) => [label.id, label.name]));
      let output =
        "id: " +
        ident +
        "-" +
        item.sequence_id +
        "\n" +
        "title: " +
        String(item.name ?? "") +
        "\n" +
        "state: " +
        flowState(item, stateList, labelList) +
        "\n" +
        "labels: " +
        (item.labels ?? []).map((label: any) => labelNames.get(ref(label)) ?? "?").join(", ") +
        "\n" +
        "created: " +
        String(item.created_at ?? "").slice(0, 10) +
        "\n\n" +
        htmlToText(item.description_html ?? "") +
        "\n";
      const comments = await collectPages(
        ctx,
        "workspaces/" + workspace + "/projects/" + projectId + "/work-items/" + item.id + "/comments/",
      );
      if (comments.length) {
        output += "\n## Log\n";
        for (const comment of comments.sort((a, b) =>
          String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
        ))
          output +=
            "- " +
            htmlToText(comment.comment_html ?? "")
              .split(/\s+/)
              .filter(Boolean)
              .join(" ") +
            "\n";
      }
      process.stdout.write(output);
    } else if (cmd === "state") {
      if (rest.length !== 2) usage("state <IDENT-n> <state>");
      const [ident, item] = await itemFor(ctx, rest[0]!);
      const next = rest[1]!;
      if (!states.includes(next)) die("invalid state " + next + " (one of: " + states.join(", ") + ")", 2);
      const projectId = ref(item.project),
        labelList = await labelsOf(ctx, projectId);
      const current = (item.labels ?? []).map(ref);
      let blockedIds = labelList
        .filter((label) => String(label.name).toLowerCase() === blocked)
        .map((label) => label.id);
      let patch: Dict;
      if (next === "blocked") {
        if (!blockedIds.length) {
          const made = await api<Dict>(ctx, "POST", "workspaces/" + workspace + "/projects/" + projectId + "/labels/", {
            name: blocked,
          });
          blockedIds = [made.id];
        }
        patch = { labels: [...new Set([...current, blockedIds[0]])].sort() };
      } else {
        patch = { state: stateIdFor(await statesOf(ctx, projectId), next) };
        if (current.some((id: string) => blockedIds.includes(id)))
          patch.labels = current.filter((id: string) => !blockedIds.includes(id));
      }
      await api(
        ctx,
        "PATCH",
        "workspaces/" + workspace + "/projects/" + projectId + "/work-items/" + item.id + "/",
        patch,
      );
      writeOut(ident + "-" + item.sequence_id + ": " + next);
    } else if (cmd === "comment") {
      if (rest.length < 3) usage("comment <IDENT-n> <actor> <text>");
      const [ident, item] = await itemFor(ctx, rest[0]!);
      const actor = rest[1]!,
        text = rest.slice(2).join(" "),
        now = new Date();
      const stamp =
        [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join(
          "-",
        ) +
        " " +
        String(now.getHours()).padStart(2, "0") +
        ":" +
        String(now.getMinutes()).padStart(2, "0");
      const line = stamp + " " + actor + ": " + text;
      await api(
        ctx,
        "POST",
        "workspaces/" + workspace + "/projects/" + ref(item.project) + "/work-items/" + item.id + "/comments/",
        { comment_html: "<p>" + escapeHtml(line) + "</p>" },
      );
      writeOut(ident + "-" + item.sequence_id + ": " + line);
    } else if (cmd === "list") {
      if (rest.length < 1 || rest.length > 2) usage("list <IDENT> [state]");
      const [ident, want] = rest as [string, string?];
      if (want && !states.includes(want)) die("invalid state " + want + " (one of: " + states.join(", ") + ")", 2);
      const project = await projectFor(ctx, ident),
        projectId = project.id;
      const stateList = await statesOf(ctx, projectId),
        labelList = await labelsOf(ctx, projectId);
      const items = await collectPages(ctx, "workspaces/" + workspace + "/projects/" + projectId + "/work-items/");
      for (const item of items.sort((a, b) => (a.sequence_id ?? 0) - (b.sequence_id ?? 0))) {
        const state = flowState(item, stateList, labelList);
        if (!want || state === want)
          writeOut(project.identifier + "-" + item.sequence_id + "\t" + state + "\t" + String(item.name ?? ""));
      }
    } else usage("projects|create|edit|read|state|comment|list ... | --self-test");
    return 0;
  } catch (error) {
    if (error instanceof ExitFault) {
      writeError("plane: " + error.message);
      return error.code;
    }
    writeError("plane: " + String(error).replace(/^Error: /, ""));
    return 1;
  }
}
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
function main(): void {
  void run(process.argv.slice(2)).then((code) => process.exit(code));
}
main();
