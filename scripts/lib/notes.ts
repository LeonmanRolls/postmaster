// The project notes file, read: plain language the user and the postmaster write about one
// project, with comments that route each block to the part of the flow it is for.
//
//   <!-- route: waybill, implement; scope: apps/portal/** -->
//   Text for those parts. It runs to the next annotation.
//
//   <!-- rules: .review/config.json; format: json-rules; gate: high, medium -->
//   <!-- reads: source:acme-wiki/INDEX.md; parts: clerk, bug -->
//
// An annotation is a whole line that is one HTML comment starting route:, rules: or reads:; any
// other comment is text. Its parts are `key: value` pairs separated by semicolons, lists are
// comma separated, and a glob has no braces. A route block's text goes to its parts only when
// the ticket's area can reach its scope. A rules annotation names a file of written rules for
// the parts that write and judge code; a reads annotation names files the parts should open.
// Text before the first annotation, after a rules or reads annotation, or routed to
// `background`, is kept for people and copied nowhere.
import type { Declaration, Rule, RuleFormat } from "./rule-sources.ts";
import { DEFAULT_FIELDS, digest } from "./rule-sources.ts";

export const PARTS = [
  "clerk",
  "waybill",
  "implement",
  "style",
  "bug",
  "security",
  "design",
  "landing",
] as const;
export type Part = (typeof PARTS)[number];

/** How many words of routed text a part may carry before the check refuses it: long material is
 * a pointer to a file, not a paragraph in the notes. */
export const BUDGET_WORDS: Readonly<Record<Part, number>> = {
  clerk: 600,
  waybill: 600,
  implement: 500,
  style: 400,
  bug: 300,
  security: 300,
  design: 300,
  landing: 300,
};

export interface RouteBlock {
  readonly kind: "route";
  readonly line: number;
  readonly parts: readonly Part[];
  readonly scope: readonly string[];
  readonly text: string;
}

export interface RulesDecl {
  readonly kind: "rules";
  readonly line: number;
  readonly parts: readonly Part[];
  readonly scope: readonly string[];
  readonly decl: Declaration;
}

export interface ReadsDecl {
  readonly kind: "reads";
  readonly line: number;
  readonly parts: readonly Part[];
  readonly scope: readonly string[];
  readonly refs: readonly string[];
}

export type Block = RouteBlock | RulesDecl | ReadsDecl;

export interface Parsed {
  readonly blocks: readonly Block[];
  /** Text copied nowhere: before the first annotation, after a rules or reads one, or routed to background. */
  readonly background: readonly { readonly line: number; readonly text: string }[];
  readonly problems: readonly string[];
}

export type Ref =
  | { readonly kind: "source"; readonly name: string; readonly path: string }
  | { readonly kind: "repo"; readonly path: string };

const ANNOTATION_RE = /^[ \t]*<!--[ \t]*((?:route|rules|reads):.*?)[ \t]*-->[ \t]*$/u;
const SOURCE_REF_RE = /^source:([^/ \t\n]+)\/(.+)$/u;
const FORMATS: readonly RuleFormat[] = ["json-rules", "headings"];

// ASCII: an annotation key is a plain word, so folding its case is the intent.
const lower = (s: string): string => s.toLowerCase();

const isPart = (s: string): s is Part => (PARTS as readonly string[]).includes(s);

const list = (v: string | undefined): string[] =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");

/** A reference to a file: `source:<name>/<path>` in a registered source, else a path in the repo. */
export function parseRef(ref: string): Ref {
  const m = SOURCE_REF_RE.exec(ref);
  return m ? { kind: "source", name: m[1], path: m[2] } : { kind: "repo", path: ref };
}

/** The `key: value` pairs of an annotation, the first being its kind. Later keys win. */
function pairs(body: string): Array<[string, string]> {
  return body
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map((p): [string, string] => {
      const at = p.indexOf(":");
      return at < 0 ? [lower(p), ""] : [lower(p.slice(0, at).trim()), p.slice(at + 1).trim()];
    });
}

function partList(
  value: string | undefined,
  fallback: readonly Part[],
  where: string,
  problems: string[],
  allowBackground: boolean,
): { parts: Part[]; background: boolean } {
  const names = value === undefined ? [...fallback] : list(value);
  const parts: Part[] = [];
  let background = false;
  for (const n of names) {
    if (allowBackground && n === "background") background = true;
    else if (isPart(n)) parts.push(n);
    else problems.push(`${where}: "${n}" is not a part of the flow (${PARTS.join(", ")})`);
  }
  return { parts, background };
}

function scopeList(value: string | undefined, where: string, problems: string[]): string[] {
  const globs = list(value);
  for (const g of globs) {
    if (g.includes("{") || g.includes("}")) {
      problems.push(`${where}: scope "${g}" has braces; write one glob for each pattern`);
    }
  }
  return globs;
}

function fieldMap(
  value: string | undefined,
  where: string,
  problems: string[],
): Declaration["fields"] {
  const out: Record<string, string> = { ...DEFAULT_FIELDS };
  for (const item of list(value)) {
    const at = item.indexOf("=");
    const k = at < 0 ? "" : item.slice(0, at).trim();
    const v = at < 0 ? "" : item.slice(at + 1).trim();
    if (!(k in DEFAULT_FIELDS) || v === "") {
      problems.push(
        `${where}: fields wants id=, text=, label= or scope= with a name, not "${item}"`,
      );
    } else {
      out[k] = v;
    }
  }
  return out as Declaration["fields"];
}

function readAnnotation(
  body: string,
  line: number,
  text: string,
  problems: string[],
): { block: Block | null; background: boolean } {
  const kv = pairs(body);
  const [kind, primary] = kv[0];
  const rest = new Map(kv.slice(1));
  const where = `line ${line}`;
  const scope = scopeList(rest.get("scope"), where, problems);
  if (kind === "route") {
    const { parts, background } = partList(primary, [], where, problems, true);
    if (parts.length === 0 && !background) {
      problems.push(`${where}: route names no part of the flow`);
      return { block: null, background: false };
    }
    if (background) return { block: null, background: true };
    if (text === "") {
      problems.push(`${where}: route block has no text`);
      return { block: null, background: false };
    }
    return { block: { kind: "route", line, parts, scope, text }, background: false };
  }
  if (kind === "reads") {
    const refs = list(primary);
    const { parts } = partList(rest.get("parts"), [], where, problems, false);
    if (refs.length === 0) problems.push(`${where}: reads names no file`);
    if (parts.length === 0)
      problems.push(`${where}: reads needs parts: the parts that open the files`);
    if (refs.length === 0 || parts.length === 0) return { block: null, background: false };
    return { block: { kind: "reads", line, parts, scope, refs }, background: false };
  }
  const format = rest.get("format") as RuleFormat | undefined;
  const gate = list(rest.get("gate"));
  if (primary === "") problems.push(`${where}: rules names no file`);
  if (format === undefined || !FORMATS.includes(format)) {
    problems.push(`${where}: rules needs format: ${FORMATS.join(" or ")}`);
  }
  if (gate.length === 0) problems.push(`${where}: rules needs gate: the labels that gate`);
  const level = Number(rest.get("level") ?? "3");
  if (!Number.isInteger(level) || level < 1 || level > 6) {
    problems.push(`${where}: level is a heading level from 1 to 6`);
  }
  const { parts } = partList(rest.get("parts"), ["implement", "style"], where, problems, false);
  if (primary === "" || format === undefined || !FORMATS.includes(format) || gate.length === 0) {
    return { block: null, background: false };
  }
  const decl: Declaration = {
    ref: primary,
    format,
    gate,
    advisory: list(rest.get("advisory")),
    level: Number.isInteger(level) ? level : 3,
    key: rest.get("key") ?? "rules",
    fields: fieldMap(rest.get("fields"), where, problems),
  };
  return { block: { kind: "rules", line, parts, scope, decl }, background: false };
}

/** Read a notes file. Annotations become blocks; the rest is background, and what is wrong is
 * named with its line. */
export function parseNotes(text: string): Parsed {
  const lines = text.replace(/\r\n/gu, "\n").split("\n");
  const found: Array<{ at: number; body: string }> = [];
  let fenced = false;
  lines.forEach((l, i) => {
    if (/^[ \t]*(```|~~~)/u.test(l)) fenced = !fenced;
    const m = fenced ? null : ANNOTATION_RE.exec(l);
    if (m) found.push({ at: i, body: m[1] });
  });
  const problems: string[] = [];
  const blocks: Block[] = [];
  const background: Array<{ line: number; text: string }> = [];
  const lead = lines
    .slice(0, found[0]?.at ?? lines.length)
    .join("\n")
    .trim();
  if (lead !== "") background.push({ line: 1, text: lead });
  found.forEach((a, k) => {
    const end = found[k + 1]?.at ?? lines.length;
    const body = lines
      .slice(a.at + 1, end)
      .join("\n")
      .trim();
    const { block, background: toBackground } = readAnnotation(a.body, a.at + 1, body, problems);
    if (block) blocks.push(block);
    const keepsText = block === null || block.kind !== "route";
    if ((toBackground || (block !== null && block.kind !== "route")) && body !== "" && keepsText) {
      background.push({ line: a.at + 2, text: body });
    }
  });
  return { blocks, background, problems };
}

const words = (s: string): number => s.split(/[ \t\n]+/u).filter((w) => w !== "").length;

/** The route blocks for a part whose scope can reach the area, in file order. */
export function routedFor(
  parsed: Parsed,
  part: Part,
  reaches: (scope: readonly string[]) => boolean,
): RouteBlock[] {
  return parsed.blocks.filter(
    (b): b is RouteBlock => b.kind === "route" && b.parts.includes(part) && reaches(b.scope),
  );
}

/** The routed text of a part as one document: each block, separated by a blank line. */
export function renderRouted(blocks: readonly RouteBlock[]): string {
  return blocks.map((b) => b.text).join("\n\n");
}

/** The parts over their word budget, with the count. Each part's routed text is counted whole,
 * whatever the area, since the area can change between tickets. */
export function overBudget(parsed: Parsed): Array<{ part: Part; words: number; budget: number }> {
  return PARTS.flatMap((part) => {
    const n = words(renderRouted(routedFor(parsed, part, () => true)));
    return n > BUDGET_WORDS[part] ? [{ part, words: n, budget: BUDGET_WORDS[part] }] : [];
  });
}

export interface PartInput {
  readonly part: Part;
  readonly blocks: readonly RouteBlock[];
  /** The rules for this part, in source order, with the declaration each came from. */
  readonly rules: readonly { readonly rule: Rule; readonly decl: Declaration }[];
  /** The files this part opens: the reference as the notes write it, and where to read it now. */
  readonly reads: readonly { readonly ref: string; readonly path: string }[];
  /** Where the copies live, named in the text: "in this run's sources folder", or "on this machine". */
  readonly where: string;
}

const WRITES: readonly Part[] = ["implement"];

function rulesIntro(part: Part, gating: string): string {
  if (WRITES.includes(part)) {
    return `Written rules to follow. Labels that gate: ${gating}. A rule that gates binds: break one only with a comment at the line that says why, and list the deviation in the hand-off.`;
  }
  return `Written rules to check. A finding cites a rule's id and its label. Labels that gate: ${gating}. A violation of a rule that gates, with no comment at the line saying why, is a gating finding: it is fixed in round 1, not deferred.`;
}

/** What one part receives, as one document: its routed text, then the rules it must follow or
 * check with the labels that gate, then the files it should open. Empty when the part has nothing. */
export function renderPart(input: PartInput): string {
  const out: string[] = [];
  if (input.blocks.length > 0) out.push(renderRouted(input.blocks));
  if (input.rules.length > 0) {
    const decls = [...new Map(input.rules.map((r) => [r.decl.ref, r.decl])).values()];
    const gating = decls.map((d) => `${d.gate.join(", ")} (${d.ref})`).join("; ");
    out.push(
      [rulesIntro(input.part, gating), "", digest(input.rules.map((r) => r.rule))].join("\n"),
    );
  }
  if (input.reads.length > 0) {
    out.push(
      [
        `Open these when they apply to the change (${input.where}):`,
        ...input.reads.map((r) => `- ${r.path} (${r.ref})`),
      ].join("\n"),
    );
  }
  return out.join("\n\n");
}
