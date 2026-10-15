// A project's written rules, read from a file into one list: what a lane that writes code must
// follow, and what a style lens checks one batch at a time. The file is in one of two shapes.
//
//   json-rules  a JSON file holding a list of rules, each with an id, its text, a severity and
//               optionally the globs it applies to (a review bot's rule config reads this way);
//   headings    a markdown file in which each heading at one level is a rule, its tier written
//               in the heading as (Default) or on a line below it as `Tier: Default`.
//
// A label is the word the source uses for how hard a rule binds (high, Must). The declaration
// says which labels gate; a rule with no label, or a label the declaration names advisory,
// does not. The functions here read text and return values: no file, no network.
import { posix } from "node:path";

export type RuleFormat = "json-rules" | "headings";

export interface Rule {
  readonly id: string;
  readonly text: string;
  readonly label: string;
  readonly scope: readonly string[];
  readonly source: string;
  readonly at: string;
  readonly gate: boolean;
}

export interface Declaration {
  readonly ref: string;
  readonly format: RuleFormat;
  readonly gate: readonly string[];
  readonly advisory: readonly string[];
  readonly level: number;
  readonly key: string;
  readonly fields: Readonly<Record<"id" | "text" | "label" | "scope", string>>;
}

export interface Read {
  readonly rules: readonly Rule[];
  readonly problems: readonly string[];
}

export const DEFAULT_FIELDS = {
  id: "id",
  text: "rule",
  label: "severity",
  scope: "scope",
} as const;
export const DEFAULT_BATCH_SIZE = 12;
const MAX_TEXT_WORDS = 60;

const WILDCARD_RE = /[*?[\]{}!]/u;
const FENCE_RE = /^(```|~~~)/u;
const HEADING_RE = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/u;
const TITLE_LABEL_RE = /[ \t]*\(([\p{L}-]+)\)[ \t]*$/u;
const TIER_LINE_RE = /^[ \t]*(?:Tier|Severity):[ \t]*\**([\p{L}-]+)/iu;

const isTable = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// ASCII: a label or a heading is a plain word, so folding its case is the intent.
const lower = (s: string): string => s.toLowerCase();

/** Whether a label gates: named in gate, and not named advisory. Case does not matter. */
export function gates(label: string, decl: Pick<Declaration, "gate" | "advisory">): boolean {
  if (label === "") return false;
  const l = lower(label);
  if (decl.advisory.some((a) => lower(a) === l)) return false;
  return decl.gate.some((g) => lower(g) === l);
}

/** The first words of a text, for a digest line: a rule reads in one line of about sixty words. */
export function clipWords(text: string, max = MAX_TEXT_WORDS): string {
  const words = text.split(/[ \t\n]+/u).filter((w) => w !== "");
  return words.length <= max ? words.join(" ") : `${words.slice(0, max).join(" ")} ...`;
}

function stringList(v: unknown): string[] {
  if (typeof v === "string") return v === "" ? [] : [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x !== "");
  return [];
}

/** Read a JSON rule list. A rule with no id or no text is a problem, never a rule. */
export function readJsonRules(text: string, decl: Declaration): Read {
  const parsed = ((): { doc: unknown } | { error: string } => {
    try {
      return { doc: JSON.parse(text) as unknown };
    } catch (e) {
      return { error: `${decl.ref}: not JSON (${e instanceof Error ? e.message : String(e)})` };
    }
  })();
  if ("error" in parsed) return { rules: [], problems: [parsed.error] };
  const holder = isTable(parsed.doc) ? parsed.doc[decl.key] : parsed.doc;
  if (!Array.isArray(holder)) {
    return { rules: [], problems: [`${decl.ref}: no list of rules at "${decl.key}"`] };
  }
  const rules: Rule[] = [];
  const problems: string[] = [];
  holder.forEach((entry, i) => {
    if (!isTable(entry)) {
      problems.push(`${decl.ref}: rule ${i + 1} is not an object`);
      return;
    }
    const id = entry[decl.fields.id];
    const body = entry[decl.fields.text];
    if (typeof id !== "string" || id === "" || typeof body !== "string" || body === "") {
      problems.push(
        `${decl.ref}: rule ${i + 1} needs "${decl.fields.id}" and "${decl.fields.text}" as text`,
      );
      return;
    }
    const labelValue = entry[decl.fields.label];
    const label = typeof labelValue === "string" ? labelValue : "";
    rules.push({
      id,
      text: clipWords(body.replace(/[ \t\n]+/gu, " ").trim()),
      label,
      scope: stringList(entry[decl.fields.scope]),
      source: decl.ref,
      at: `${decl.ref}#${id}`,
      gate: gates(label, decl),
    });
  });
  return { rules, problems };
}

const slug = (title: string): string =>
  lower(title)
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

/** Read a markdown file in which each heading at decl.level is a rule. Headings inside a fenced
 * block are examples. The label is the trailing (Word) of the heading, else the first
 * `Tier: Word` line in the section. */
export function readHeadingRules(text: string, decl: Declaration): Read {
  const lines = text.split("\n");
  const heads: Array<{ at: number; level: number; title: string }> = [];
  let fenced = false;
  lines.forEach((line, i) => {
    if (FENCE_RE.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const m = HEADING_RE.exec(line);
    if (m) heads.push({ at: i, level: m[1].length, title: m[2] });
  });
  const rules: Rule[] = [];
  heads.forEach((h, k) => {
    if (h.level !== decl.level) return;
    const end = heads.slice(k + 1).find((n) => n.level <= decl.level)?.at ?? lines.length;
    const body = lines.slice(h.at + 1, end);
    const inTitle = TITLE_LABEL_RE.exec(h.title);
    const title = (inTitle ? h.title.slice(0, inTitle.index) : h.title).trim();
    const tier = body.map((l) => TIER_LINE_RE.exec(l)).find((m) => m !== null);
    const label = inTitle ? inTitle[1] : tier ? tier[1] : "";
    const paragraph = body
      .filter((l) => !TIER_LINE_RE.test(l))
      .join("\n")
      .split(/\n[ \t]*\n/u)
      .map((p) => p.trim())
      .find((p) => p !== "" && !p.startsWith("```"));
    const id = slug(title);
    rules.push({
      id,
      text: clipWords(paragraph ? `${title}. ${paragraph.replace(/[ \t\n]+/gu, " ")}` : title),
      label,
      scope: [],
      source: decl.ref,
      at: `${decl.ref}:${h.at + 1}`,
      gate: gates(label, decl),
    });
  });
  const problems = rules.length === 0 ? [`${decl.ref}: no headings at level ${decl.level}`] : [];
  return { rules, problems };
}

export function readRules(text: string, decl: Declaration): Read {
  return decl.format === "json-rules" ? readJsonRules(text, decl) : readHeadingRules(text, decl);
}

/** The path segments of a glob before its first wildcard: `apps/**` is [apps], `**` is []. */
export function staticPrefix(glob: string): string[] {
  const segments = posix.normalize(glob.replace(/^\.\//u, "")).split("/");
  const at = segments.findIndex((s) => WILDCARD_RE.test(s));
  const fixed = at < 0 ? segments : segments.slice(0, at);
  return fixed.filter((s) => s !== "" && s !== ".");
}

/** Whether a rule's scope can reach the area: no scope or no area reaches everywhere, otherwise
 * some scope glob and some area glob share a path prefix. Heuristic by design: a rule that might
 * apply is shown. */
export function scopeApplies(scope: readonly string[], area: readonly string[]): boolean {
  if (scope.length === 0 || area.length === 0) return true;
  return scope.some((s) =>
    area.some((a) => {
      const p = staticPrefix(s);
      const q = staticPrefix(a);
      const n = Math.min(p.length, q.length);
      return p.slice(0, n).every((seg, i) => seg === q[i]);
    }),
  );
}

/** A digest of the rules, one line each: the rule's id, its label, its text. */
export function digest(rules: readonly Rule[]): string {
  return rules
    .map((r) => `- ${r.id}${r.label === "" ? "" : ` (${r.label})`}: ${r.text}`)
    .join("\n");
}

/** The rules in batches of at most size, in order, so a batch keeps neighbours together. */
export function batches(rules: readonly Rule[], size = DEFAULT_BATCH_SIZE): Rule[][] {
  const n = Math.max(1, Math.floor(size));
  const out: Rule[][] = [];
  for (let i = 0; i < rules.length; i += n) out.push(rules.slice(i, i + n));
  return out;
}

/** The batches dealt to the lanes in turn, so each lane takes the next batch after the last. */
export function assign(batchCount: number, lanes: readonly string[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const lane of lanes) out[lane] = [];
  for (let b = 0; b < batchCount; b++) {
    const lane = lanes[b % lanes.length];
    if (lane !== undefined) out[lane].push(b);
  }
  return out;
}
