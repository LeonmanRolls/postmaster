// Read the declarations of a TypeScript declaration file (or a TypeScript source that holds only
// types) into index entries: every exported function, class, interface, type, enum and constant, and
// every member of an interface, class, enum or object type, one entry each, with the first sentence
// of its doc comment and the line it sits on.
//
// The TypeScript compiler's own API is not available to the tool, so this is a small reader that
// follows braces and skips comments and strings. It is made for the plain shapes declaration files
// have: a declaration on a line, a member on a line, a doc comment just above. A declaration it
// cannot read is left out, not guessed. A member whose name starts with an underscore or a hash, a
// private or protected member and an index signature are not part of an API and are left out.
import type { IndexEntry } from "./index-match.ts";

interface Line {
  readonly no: number;
  /** The line with comments removed. Strings are kept, so a signature reads whole. */
  readonly code: string;
  /** The same, with each string's text blanked, so that a brace inside a string counts for nothing. */
  readonly mask: string;
  /** The doc comment that sat above this line, cleaned. */
  readonly doc: string;
}

/** The first sentence of a doc comment body, tags dropped, "(deprecated) " in front when it says so. */
export function cleanDoc(body: string): string {
  const kept: string[] = [];
  let deprecated = false;
  for (const raw of body.split("\n")) {
    const line = raw.replace(/^[ \t]*\*?[ \t]?/u, "").trim();
    if (line.startsWith("@")) {
      if (line.startsWith("@deprecated")) deprecated = true;
      continue;
    }
    if (line === "" && kept.length > 0) break;
    if (line !== "") kept.push(line);
  }
  const text = kept.join(" ");
  const stop = /[.!?](?=[ \t]|$)/u.exec(text);
  const sentence = (stop ? text.slice(0, stop.index + 1) : text).trim();
  const clipped = sentence.length > 200 ? `${sentence.slice(0, 197)}...` : sentence;
  return deprecated ? `(deprecated) ${clipped}`.trim() : clipped;
}

/**
 * Split a source text into lines with comments taken out and each doc comment attached to the code
 * line below it. With `lineDocs`, a run of `//` comment lines directly above a declaration also
 * counts as its doc when it has no block doc: project code is documented that way more than in
 * blocks.
 */
export function scanLines(text: string, lineDocs = false): Line[] {
  const out: Line[] = [];
  let code = "";
  let mask = "";
  let pending = "";
  let noted = "";
  let noteOnLine = false;
  let no = 1;
  const flush = (): void => {
    if (code.trim() === "") {
      out.push({ no, code: "", mask: "", doc: "" });
      // a line with no // comment on it ends a run of // lines that sat above it
      if (!noteOnLine) noted = "";
    } else {
      out.push({ no, code, mask, doc: pending !== "" ? pending : cleanDoc(noted) });
      pending = "";
      noted = "";
    }
    code = "";
    mask = "";
    noteOnLine = false;
    no += 1;
  };
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === "\n") {
      flush();
      i += 1;
    } else if (c === "/" && d === "/") {
      const from = i + 2;
      while (i < n && text[i] !== "\n") i += 1;
      if (lineDocs && code.trim() === "") {
        noted += `${noted === "" ? "" : "\n"}${text.slice(from, i)}`;
        noteOnLine = true;
      }
    } else if (c === "/" && d === "*") {
      const isDoc = text[i + 2] === "*" && text[i + 3] !== "/";
      let end = text.indexOf("*/", i + 2);
      if (end < 0) end = n;
      const body = text.slice(i + (isDoc ? 3 : 2), end);
      for (let k = 0; k < body.length; k++) if (body[k] === "\n") flush();
      if (isDoc) pending = cleanDoc(body);
      i = Math.min(n, end + 2);
    } else if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < n && text[j] !== c && text[j] !== "\n") {
        j += text[j] === "\\" ? 2 : 1;
      }
      const end = Math.min(n, j + 1);
      const chunk = text.slice(i, end);
      code += chunk;
      mask += " ".repeat(chunk.length);
      i = end;
    } else {
      code += c;
      mask += c;
      i += 1;
    }
  }
  if (code.trim() !== "") flush();
  return out;
}

interface Ctx {
  readonly kind: "iface" | "class" | "literal" | "enum" | "ns";
  readonly name: string;
  /** The brace depth inside the block: its members start a line at this depth. */
  readonly depth: number;
}

const NAME = "[A-Za-z_$][A-Za-z0-9_$]*";
const MODS = "(?:export[ \\t]+)?(?:default[ \\t]+)?(?:declare[ \\t]+)?";

const RE = {
  iface: new RegExp(`^${MODS}(?:abstract[ \\t]+)?(interface|class)[ \\t]+(${NAME})`, "u"),
  type: new RegExp(`^${MODS}type[ \\t]+(${NAME})`, "u"),
  fn: new RegExp(`^${MODS}(?:async[ \\t]+)?function[ \\t]*\\*?[ \\t]*(${NAME})`, "u"),
  cnst: new RegExp(`^${MODS}(?:const|let|var)[ \\t]+(${NAME})`, "u"),
  en: new RegExp(`^${MODS}(?:const[ \\t]+)?enum[ \\t]+(${NAME})`, "u"),
  ns: new RegExp(`^${MODS}(?:namespace|module)[ \\t]+(${NAME}|[^ \\t{]+)[ \\t]*\\{`, "u"),
  reexport: /^export[ \t]*(?:type[ \t]*)?\{([^}]*)\}/u,
  member:
    /^((?:(?:public|private|protected|readonly|static|abstract|declare|override|get|set|async)[ \t]+)*)(?:(\*)[ \t]*)?([A-Za-z_$][A-Za-z0-9_$]*|'[^']*'|"[^"]*"|\[[^\]]*\])(\?)?[ \t]*([:(<])/u,
  enumMember: /^([A-Za-z_$][A-Za-z0-9_$]*|'[^']*'|"[^"]*")[ \t]*(?:=|,|$)/u,
};

function signatureOf(code: string): string {
  const one = code
    .replace(/[ \t]+/gu, " ")
    .trim()
    .replace(/[;,{]+$/u, "")
    .trim();
  return one.length > 140 ? `${one.slice(0, 137)}...` : one;
}

/** Entries for the declarations of one file. `file` is the name printed beside each line number. */
export function extractEntries(text: string, file: string): IndexEntry[] {
  const lines = scanLines(text);
  const entries: IndexEntry[] = [];
  const stack: Ctx[] = [];
  let depth = 0;
  let pending: { kind: Ctx["kind"]; name: string } | null = null;
  // The type declaration whose statement has not ended yet: an object type that opens on a later
  // line, or after `A & `, is read as that type's members.
  let openType: string | null = null;
  const add = (symbol: string, kind: string, line: Line, signature: string): void => {
    entries.push({
      symbol,
      kind,
      signature: signatureOf(signature),
      doc: line.doc,
      file,
      line: line.no,
    });
  };
  for (const line of lines) {
    const shape = line.mask.trim();
    if (shape === "") continue;
    // The patterns read the code with its strings, so a quoted member name is read; the brace and
    // block tests read the masked line, so a brace inside a string is not.
    const code = line.code.trim();
    const top = stack[stack.length - 1];
    const startDepth = depth;
    if (
      top !== undefined &&
      (top.kind === "iface" || top.kind === "class" || top.kind === "literal") &&
      startDepth === top.depth
    ) {
      const m = RE.member.exec(code);
      if (m) {
        const mods = m[1] ?? "";
        const raw = m[3] ?? "";
        const name = raw.startsWith("'") || raw.startsWith('"') ? raw.slice(1, -1) : raw;
        const hidden =
          raw.startsWith("[") ||
          name.startsWith("_") ||
          name.startsWith("#") ||
          name === "constructor" ||
          /(?:private|protected)/u.test(mods);
        if (!hidden && name !== "") {
          const isMethod = m[5] === "(" || m[5] === "<";
          const symbol = `${top.name}.${name}`;
          add(symbol, isMethod ? "method" : "property", line, code);
          if (!isMethod && shape.endsWith("{")) pending = { kind: "literal", name: symbol };
        }
      }
    } else if (top !== undefined && top.kind === "enum" && startDepth === top.depth) {
      const m = RE.enumMember.exec(code);
      if (m) {
        const raw = m[1];
        const name = raw.startsWith("'") || raw.startsWith('"') ? raw.slice(1, -1) : raw;
        add(`${top.name}.${name}`, "member", line, code);
      }
    } else if (
      (top === undefined && startDepth === 0) ||
      (top !== undefined && top.kind === "ns" && startDepth === top.depth)
    ) {
      let m: RegExpExecArray | null;
      if ((m = RE.iface.exec(code))) {
        add(m[2], m[1], line, code);
        pending = { kind: m[1] === "class" ? "class" : "iface", name: m[2] };
      } else if ((m = RE.type.exec(code))) {
        add(m[1], "type", line, code);
        openType = m[1];
        if (shape.includes("=") && shape.endsWith("{")) pending = { kind: "literal", name: m[1] };
      } else if ((m = RE.en.exec(code))) {
        add(m[1], "enum", line, code);
        pending = { kind: "enum", name: m[1] };
      } else if ((m = RE.fn.exec(code))) {
        add(m[1], "function", line, code);
      } else if ((m = RE.cnst.exec(code))) {
        add(m[1], "const", line, code);
      } else if ((m = RE.ns.exec(code))) {
        pending = { kind: "ns", name: m[1].replace(/^['"]|['"]$/gu, "") };
      } else if (openType !== null && shape.endsWith("{")) {
        pending = { kind: "literal", name: openType };
      } else if ((m = RE.reexport.exec(code))) {
        for (const part of m[1].split(",")) {
          const pieces = part.trim().split(/[ \t]+as[ \t]+/u);
          const name = (pieces[pieces.length - 1] ?? "").trim();
          if (name !== "" && name !== "default") add(name, "re-export", line, code);
        }
      }
    }
    for (const ch of line.mask) {
      if (ch === "{") {
        if (pending) {
          stack.push({ kind: pending.kind, name: pending.name, depth: depth + 1 });
          pending = null;
        }
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        while (stack.length > 0 && depth < stack[stack.length - 1].depth) stack.pop();
      }
    }
    // A declaration that ended on this line with no block opened leaves nothing waiting.
    if (pending && /;[ \t]*$/u.test(shape) && !shape.includes("{")) pending = null;
    if (openType !== null && stack.length === 0 && depth === 0 && /;[ \t]*$/u.test(shape)) {
      openType = null;
    }
  }
  return entries;
}
