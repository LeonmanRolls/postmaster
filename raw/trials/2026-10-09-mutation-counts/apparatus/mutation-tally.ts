// Pure tallies over the output of the mutation rule: one row per change, per function and per file,
// and the join of a review finding to the function that holds its line. No file or process access.
import {
  type CountPolicy,
  DEFAULT_POLICY,
  type FileEvent,
  type FnRecord,
  MODULE_LEVEL,
  type Root,
  TAGS,
  type Tag,
  holderOf,
  inFirstCount,
  isWithin,
  kappa,
  mulberry32,
  tagsWithin,
  wilson,
} from "./mutation-core.ts";

/** One change as the rule reports it. */
export type RulePlace = Readonly<{
  line: number;
  col: number;
  off: number;
  fn: number;
  op: string;
  how: string;
  root: Root;
  alias: boolean;
  target: string;
  src: string;
}>;

/** What the rule reports for one file. */
export type RuleOutput = Readonly<{
  lines: number;
  blank: readonly number[];
  imports: readonly (readonly [string, boolean])[];
  functions: readonly FnRecord[];
  places: readonly RulePlace[];
  events: readonly FileEvent[];
}>;

export type PlaceRow = RulePlace &
  Readonly<{
    file: string;
    first: boolean;
    fnName: string;
    /** the lines of the innermost function, 0 and 0 at the module's top level */
    fnStart: number;
    fnEnd: number;
    fnTags: readonly Tag[];
    moduleTags: readonly Tag[];
  }>;

export const fnPath = (functions: readonly FnRecord[], id: number): string => {
  if (id === MODULE_LEVEL) return "(module)";
  const byId = new Map(functions.map((f) => [f.id, f]));
  const names: string[] = [];
  for (let at = id; at !== MODULE_LEVEL; ) {
    const f = byId.get(at);
    if (f === undefined) break;
    names.unshift(
      f.name !== "" ? f.name : f.kind === "ArrowFunctionExpression" ? "(arrow)" : "(function)",
    );
    at = f.parent;
  }
  return names.join(" > ");
};

export const moduleTagsOf = (out: RuleOutput): Tag[] => {
  const found = new Set<Tag>(tagsWithin(out.events, 0, Number.POSITIVE_INFINITY));
  for (const [source, typeOnly] of out.imports) {
    if (typeOnly) continue;
    if (/^(node:)?fs(\/promises)?$/u.test(source)) found.add("files");
    if (/^(node:)?child_process$/u.test(source)) found.add("proc");
    if (/^(node:)?os$/u.test(source)) found.add("os");
  }
  return TAGS.filter((t) => found.has(t));
};

export const placeRows = (
  file: string,
  out: RuleOutput,
  policy: CountPolicy = DEFAULT_POLICY,
): PlaceRow[] => {
  const mod = moduleTagsOf(out);
  const byId = new Map(out.functions.map((f) => [f.id, f]));
  return out.places.map((p) => {
    const f = byId.get(p.fn);
    return {
      ...p,
      file,
      first: inFirstCount(p.root, policy),
      fnName: fnPath(out.functions, p.fn),
      fnStart: f?.startLine ?? 0,
      fnEnd: f?.endLine ?? 0,
      fnTags: f === undefined ? mod : tagsWithin(out.events, f.start, f.end),
      moduleTags: mod,
    };
  });
};

/** For each line, the id of the innermost function that holds it (-1 for the module's own lines). */
export const paintLines = (functions: readonly FnRecord[], lines: number): Int32Array => {
  const owner = new Int32Array(lines + 2).fill(MODULE_LEVEL);
  const outerFirst = [...functions].sort(
    (a, b) => b.endLine - b.startLine - (a.endLine - a.startLine) || a.start - b.start,
  );
  for (const f of outerFirst) owner.fill(f.id, f.startLine, Math.min(f.endLine, lines) + 1);
  return owner;
};

export type FileRow = Readonly<{
  file: string;
  lines: number;
  nonblank: number;
  functions: number;
  first: number;
  every: number;
  /** non-blank lines whose innermost function holds a place of the first count */
  linesInFirst: number;
  /** non-blank lines whose innermost function holds such a place or has one nested inside it */
  linesWithinFirst: number;
  /** non-blank lines whose innermost function holds any change at all */
  linesInEvery: number;
  byRoot: Readonly<Record<string, number>>;
}>;

export const fileRow = (
  file: string,
  out: RuleOutput,
  policy: CountPolicy = DEFAULT_POLICY,
): FileRow => {
  const rows = placeRows(file, out, policy);
  const firstFns = new Set(rows.filter((r) => r.first).map((r) => r.fn));
  const everyFns = new Set(rows.map((r) => r.fn));
  const owner = paintLines(out.functions, out.lines);
  const blank = new Set(out.blank);
  const parentOf = new Map(out.functions.map((f) => [f.id, f.parent]));
  const withinFirst = new Set<number>();
  for (const id of firstFns) {
    for (let at = id; !withinFirst.has(at); at = parentOf.get(at) ?? MODULE_LEVEL) {
      withinFirst.add(at);
      if (at === MODULE_LEVEL) break;
    }
    withinFirst.add(MODULE_LEVEL);
  }
  let nonblank = 0;
  let linesInFirst = 0;
  let linesWithinFirst = 0;
  let linesInEvery = 0;
  for (let line = 1; line <= out.lines; line++) {
    if (blank.has(line)) continue;
    nonblank++;
    const id = owner[line] as number;
    if (firstFns.has(id)) linesInFirst++;
    if (withinFirst.has(id)) linesWithinFirst++;
    if (everyFns.has(id)) linesInEvery++;
  }
  const byRoot: Record<string, number> = {};
  for (const r of rows) {
    const key = `${r.root}${r.alias ? "~" : ""}`;
    byRoot[key] = (byRoot[key] ?? 0) + 1;
  }
  return {
    file,
    lines: out.lines,
    nonblank,
    functions: out.functions.length,
    first: rows.filter((r) => r.first).length,
    every: rows.length,
    linesInFirst,
    linesWithinFirst,
    linesInEvery,
    byRoot,
  };
};

export type FindingJoin = Readonly<{
  /** the functions that tie as the innermost holder of the line; one except for sibling one-liners */
  holders: readonly number[];
  holderName: string;
  holderLines: string;
  /** a place of the first count has this very function as its innermost function */
  firstHere: number;
  /** a place of the first count lies in this function or one nested inside it */
  firstWithin: number;
  everyHere: number;
  everyWithin: number;
  /** what the holder function touches: the environment or clock, files, processes, the system */
  holderTags: readonly Tag[];
}>;

/** Join a finding's line to the function that holds it and to the places counted in that function. */
export const joinFinding = (
  out: RuleOutput,
  line: number,
  policy: CountPolicy = DEFAULT_POLICY,
): FindingJoin => {
  const { ids } = holderOf(out.functions, line);
  const first = out.places.filter((p) => inFirstCount(p.root, policy));
  const here = (list: readonly RulePlace[]): number =>
    Math.max(...ids.map((id) => list.filter((p) => p.fn === id).length));
  const within = (list: readonly RulePlace[]): number =>
    Math.max(...ids.map((id) => list.filter((p) => isWithin(out.functions, p.fn, id)).length));
  const byId = new Map(out.functions.map((f) => [f.id, f]));
  const head = byId.get(ids[0] as number);
  return {
    holders: ids,
    holderName: ids.map((id) => fnPath(out.functions, id)).join(" | "),
    holderLines: head === undefined ? "(module)" : `${head.startLine}-${head.endLine}`,
    firstHere: here(first),
    firstWithin: within(first),
    everyHere: here(out.places),
    everyWithin: within(out.places),
    holderTags:
      head === undefined ? moduleTagsOf(out) : tagsWithin(out.events, head.start, head.end),
  };
};

// ---------------------------------------------------------------- findings

export type Finding = Readonly<{
  key: string;
  run: string;
  round: string;
  sev: string;
  location: string;
  snapshot: string;
  description: string;
}>;

export type Location = Readonly<{
  /** ts-line: a TypeScript file and a line; runbook: a markdown file and a line; no-line: a file alone */
  kind: "ts-line" | "runbook" | "no-line";
  file: string;
  line: number;
}>;

export const parseLocation = (location: string): Location => {
  const m = /^(.*?):(\d+)$/u.exec(location);
  if (m === null) return { kind: "no-line", file: location, line: 0 };
  const file = m[1] as string;
  return { kind: file.endsWith(".ts") ? "ts-line" : "runbook", file, line: Number(m[2]) };
};

/** A name for one commit's row: the run and the round it reviewed. */
export const roundLabel = (findings: readonly Finding[], snapshot: string): string => {
  const f = findings.find((x) => x.snapshot === snapshot);
  return f === undefined ? snapshot : `${f.run} r${f.round}`;
};

// ---------------------------------------------------------------- marks

export type Estimate = Readonly<{
  hits: number;
  n: number;
  share: number;
  low: number;
  high: number;
  /** the population times the share, and times the ends of the interval */
  estimate: number;
  estimateLow: number;
  estimateHigh: number;
}>;

/** How many of a population a share of a sample stands for, with the Wilson 95% interval. */
export const estimateOf = (hits: number, n: number, population: number): Estimate => {
  const [low, high] = wilson(hits, n);
  const share = n === 0 ? 0 : hits / n;
  return {
    hits,
    n,
    share,
    low,
    high,
    estimate: share * population,
    estimateLow: low * population,
    estimateHigh: high * population,
  };
};

export type MarkTally = Readonly<{
  n: number;
  hazard: number;
  harmless: number;
  unclear: number;
  /** places not marked hazard: harmless alone, and harmless with unclear */
  notHazardHarmless: Estimate;
  notHazardAll: Estimate;
}>;

export const tallyMarks = (marks: readonly string[], population: number): MarkTally => {
  const count = (m: string): number => marks.filter((x) => x === m).length;
  const hazard = count("hazard");
  const harmless = count("harmless");
  const unclear = count("unclear");
  return {
    n: marks.length,
    hazard,
    harmless,
    unclear,
    notHazardHarmless: estimateOf(harmless, marks.length, population),
    notHazardAll: estimateOf(harmless + unclear, marks.length, population),
  };
};

export type Agreement = Readonly<{
  n: number;
  same: number;
  low: number;
  high: number;
  kappa: number;
}>;

export const agreementOf = (a: readonly string[], b: readonly string[]): Agreement => {
  const same = a.filter((x, i) => x === b[i]).length;
  const [low, high] = wilson(same, a.length);
  return { n: a.length, same, low, high, kappa: kappa(a, b) };
};

/** A seeded full shuffle (Fisher-Yates from the end), for the control against chance. */
export const shuffled = <T>(items: readonly T[], seed: number): T[] => {
  const rand = mulberry32(seed);
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const held = a[i] as T;
    a[i] = a[j] as T;
    a[j] = held;
  }
  return a;
};
