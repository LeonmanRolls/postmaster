// The pure core of the two mutation counts of #372. Nothing here reads a file, the clock, the
// environment or a process: the Oxlint rule hands it syntax nodes and a way to resolve a name,
// and the driver hands it the rule's output. Only erasable TypeScript, so Node can load it too.

/** A position in the source text, as the parser reports it. */
export type Position = Readonly<{ line: number; column: number }>;

/**
 * A syntax node of the ESTree family, as Oxlint's plugin interface hands it out. Only the fields
 * the counts read are named. Each is present on some kinds of node and absent from the rest, so a
 * field that the kind being read always has is read through `need`.
 */
export type Node = Readonly<{
  type: string;
  range: readonly [number, number];
  loc: Readonly<{ start: Position; end: Position }>;
  parent?: Node | null;
  /** an identifier's name */
  name?: string;
  /** a literal's value, or the node that is a property's value */
  value?: unknown;
  operator?: string;
  kind?: string;
  computed?: boolean;
  importKind?: string;
  id?: Node | null;
  key?: Node;
  init?: Node | null;
  source?: Node | null;
  object?: Node;
  property?: Node;
  callee?: Node;
  argument?: Node;
  expression?: Node;
  left?: Node;
  right?: Node;
  consequent?: Node;
  alternate?: Node;
  arguments?: readonly Node[];
  elements?: readonly (Node | null)[];
  properties?: readonly Node[];
  expressions?: readonly Node[];
}>;

/** A field that a node of the kind being read always has; its absence is a tree no parser makes. */
export const need = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error("a syntax node lacks a field that its kind has");
  }
  return value;
};

export const isNode = (value: unknown): value is Node =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { type?: unknown }).type === "string";

/** What the scope analysis says about one name. */
export type Binding = Readonly<{
  kind: "import" | "param" | "var";
  /** the function that declares it, or null when it is declared at the module's top level */
  owner: Node | null;
  /** a rest parameter: the array it collects is new at every call */
  rest: boolean;
  /** the initialiser and every expression later assigned to it */
  assigned: readonly Node[];
  /** the right-hand sides of the for-of and for-in loops it is the loop variable of */
  iterated: readonly Node[];
}>;

/** null when the name is not declared in the file: a global such as process or Bun. */
export type Resolve = (identifier: Node) => Binding | null;

export type Ctx = Readonly<{
  resolve: Resolve;
  /** the innermost function holding the site, null at the module's top level */
  fn: Node | null;
  /** inside a constructor, where `this` is the object being built */
  thisIsOwn: boolean;
}>;

/**
 * What a change lands on. `param`, `import`, `module` (a module-level variable changed from inside
 * a function) and `global` (process, Bun, ...) are things the function did not create. `this` is the
 * receiver of a method. `captured` is a local of an enclosing function, changed from a nested one.
 * `local` is a variable the function declared, `temp` a value no name holds (a call result, a new
 * object, a literal).
 */
export type Root =
  | "param"
  | "import"
  | "module"
  | "global"
  | "this"
  | "captured"
  | "local"
  | "temp";

export type Target = Readonly<{
  root: Root;
  /** the change goes through a local that is another name for something of the kind `root` */
  alias: boolean;
}>;

export type Op = "rebind" | "prop" | "delete" | "call" | "assign";

export type Site = Readonly<{
  op: Op;
  /** the operator, the method name, or "Object.assign" */
  how: string;
  /** the expression whose binding or object is changed */
  target: Node;
}>;

/** The ticket's list of methods that change their object in place. */
export const IN_PLACE_METHODS: ReadonlySet<string> = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  "set",
  "add",
  "delete",
  "clear",
]);

/** Methods whose result is a part of their receiver, so a name for it is a name for that part. */
const RETURNS_PART: ReadonlySet<string> = new Set([
  "get",
  "find",
  "findLast",
  "at",
  "pop",
  "shift",
]);

/**
 * Methods whose result is a new container that holds the receiver's own elements. Changing the
 * container changes nothing of the receiver's, but a loop over it hands out the receiver's elements.
 */
const KEEPS_ELEMENTS: ReadonlySet<string> = new Set([
  "slice",
  "filter",
  "concat",
  "toSorted",
  "toReversed",
  "toSpliced",
  "flat",
  "values",
  "entries",
]);

const WRAPPERS: ReadonlySet<string> = new Set([
  "ChainExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSSatisfiesExpression",
  "ParenthesizedExpression",
]);

const NOT_OBJECTS: ReadonlySet<string> = new Set(["undefined", "NaN", "Infinity"]);

export const unwrap = (node: Node): Node => {
  let n = node;
  while (WRAPPERS.has(n.type)) n = need(n.expression);
  return n;
};

export const propertyName = (member: Node): string | null => {
  const p = need(member.property);
  if (!member.computed) return p.type === "Identifier" ? (p.name ?? null) : null;
  return p.type === "Literal" && typeof p.value === "string" ? p.value : null;
};

/** Every identifier or member expression a destructuring or assignment target writes to. */
export const patternTargets = (pattern: Node): Node[] => {
  const p = unwrap(pattern);
  switch (p.type) {
    case "Identifier":
    case "MemberExpression":
      return [p];
    case "AssignmentPattern":
      return patternTargets(need(p.left));
    case "RestElement":
      return patternTargets(need(p.argument));
    case "ArrayPattern":
      return need(p.elements).flatMap((e) => (e === null ? [] : patternTargets(e)));
    case "ObjectPattern":
      return need(p.properties).flatMap((q) => {
        if (q.type === "RestElement") return patternTargets(need(q.argument));
        return isNode(q.value) ? patternTargets(q.value) : [];
      });
    default:
      return [];
  }
};

/** The change a call expression makes in place, by the ticket's list of method names. */
export const callSite = (call: Node): Site | null => {
  const callee = unwrap(need(call.callee));
  if (callee.type !== "MemberExpression") return null;
  const name = propertyName(callee);
  if (name === null) return null;
  const object = unwrap(need(callee.object));
  if (name === "assign" && object.type === "Identifier" && object.name === "Object") {
    const first = need(call.arguments)[0];
    return first === undefined ? null : { op: "assign", how: "Object.assign", target: first };
  }
  return IN_PLACE_METHODS.has(name) ? { op: "call", how: name, target: object } : null;
};

/**
 * The kind of thing an expression is another name for, or null when it is something the function
 * built or got from a call. Reaching it through a property, an element, a conditional or a loop
 * variable keeps the kind. A copy (`slice`, `filter`, a spread, `Array.from`) is a new container, so
 * changing it is the function's own; with `elements` set, which is how a loop variable is traced,
 * the copy's elements are still the original's.
 */
export const aliasRoot = (
  expr: Node,
  ctx: Ctx,
  seen: Set<Binding> = new Set(),
  elements = false,
): Exclude<Root, "captured" | "local" | "temp"> | null => {
  const e = unwrap(expr);
  const again = (n: Node, keep = elements) => aliasRoot(n, ctx, seen, keep);
  switch (e.type) {
    case "Identifier": {
      const b = ctx.resolve(e);
      if (b === null) return NOT_OBJECTS.has(e.name ?? "") ? null : "global";
      if (b.kind === "import") return "import";
      if (b.kind === "param") return b.rest && !elements ? null : "param";
      if (b.owner === null && ctx.fn !== null) return "module";
      if (seen.has(b)) return null;
      seen.add(b);
      for (const from of b.assigned) {
        const r = again(from);
        if (r !== null) return r;
      }
      for (const from of b.iterated) {
        const r = again(from, true);
        if (r !== null) return r;
      }
      return null;
    }
    case "MemberExpression":
      return again(need(e.object));
    case "ThisExpression":
      return ctx.thisIsOwn ? null : "this";
    case "ConditionalExpression":
      return again(need(e.consequent)) ?? again(need(e.alternate));
    case "LogicalExpression":
      return again(need(e.left)) ?? again(need(e.right));
    case "AssignmentExpression":
      return again(need(e.right));
    case "SequenceExpression": {
      const list = need(e.expressions);
      return again(need(list[list.length - 1]));
    }
    case "AwaitExpression":
      return again(need(e.argument));
    case "ArrayExpression":
      if (!elements) return null;
      for (const item of need(e.elements)) {
        const r =
          item === null ? null : again(item.type === "SpreadElement" ? need(item.argument) : item);
        if (r !== null) return r;
      }
      return null;
    case "NewExpression": {
      const callee = unwrap(need(e.callee));
      const first = need(e.arguments)[0];
      const copies =
        callee.type === "Identifier" && (callee.name === "Set" || callee.name === "Map");
      return elements && copies && first !== undefined ? again(first) : null;
    }
    case "CallExpression": {
      const callee = unwrap(need(e.callee));
      if (callee.type !== "MemberExpression") return null;
      const name = propertyName(callee);
      if (name === null) return null;
      const object = unwrap(need(callee.object));
      const first = need(e.arguments)[0];
      if (object.type === "Identifier" && ctx.resolve(object) === null) {
        const takes =
          (object.name === "Object" && (name === "values" || name === "entries")) ||
          (object.name === "Array" && name === "from");
        return elements && takes && first !== undefined ? again(first) : null;
      }
      if (RETURNS_PART.has(name)) return again(object);
      return elements && KEEPS_ELEMENTS.has(name) ? again(object) : null;
    }
    default:
      return null;
  }
};

/** The same syntax node: the parser may hand out a fresh object for it, so the span decides. */
export const sameNode = (a: Node | null, b: Node | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.type === b.type &&
    a.range[0] === b.range[0] &&
    a.range[1] === b.range[1]);

const bindingRoot = (b: Binding, ctx: Ctx): Root => {
  if (b.kind === "import") return "import";
  if (b.kind === "param") return "param";
  if (sameNode(b.owner, ctx.fn)) return "local";
  return b.owner === null ? "module" : "captured";
};

/** The thing a plain name is given a new value in: assigning to an argument, a module-level variable, ... */
export const classifyRebind = (id: Node, ctx: Ctx): Target => {
  const b = ctx.resolve(id);
  return b === null
    ? { root: "global", alias: false }
    : { root: bindingRoot(b, ctx), alias: false };
};

/**
 * The thing a change lands on, found from the expression whose binding or object is changed.
 * `depth` is how many properties were passed through to reach the name, so that pushing onto a rest
 * parameter's own array is local while changing an element it holds is not.
 */
export const classifyTarget = (expr: Node, ctx: Ctx, depth = 0): Target => {
  const e = unwrap(expr);
  switch (e.type) {
    case "MemberExpression":
      return classifyTarget(need(e.object), ctx, depth + 1);
    case "ThisExpression":
      return { root: ctx.thisIsOwn ? "local" : "this", alias: false };
    case "Identifier": {
      const b = ctx.resolve(e);
      if (b === null) {
        return { root: NOT_OBJECTS.has(e.name ?? "") ? "temp" : "global", alias: false };
      }
      if (b.kind === "param" && b.rest && depth === 0) return { root: "local", alias: false };
      const own = bindingRoot(b, ctx);
      if (own === "local" || own === "captured") {
        const r = aliasRoot(e, ctx);
        if (r !== null) return { root: r, alias: true };
      }
      return { root: own, alias: false };
    }
    default: {
      const r = aliasRoot(e, ctx);
      return r === null ? { root: "temp", alias: false } : { root: r, alias: true };
    }
  }
};

/** The kinds of target the first count flags: a change to something the function did not create. */
export const FIRST_COUNT_ROOTS: ReadonlySet<Root> = new Set([
  "param",
  "import",
  "module",
  "global",
  "this",
  "captured",
]);

export type CountPolicy = Readonly<{ first: ReadonlySet<Root> }>;

export const DEFAULT_POLICY: CountPolicy = { first: FIRST_COUNT_ROOTS };

/** The first count. The second count has nothing exempt, so it holds every site. */
export const inFirstCount = (root: Root, policy: CountPolicy = DEFAULT_POLICY): boolean =>
  policy.first.has(root);

// ---------------------------------------------------------------- functions, tags and joins

export type FnRecord = Readonly<{
  id: number;
  parent: number;
  kind: string;
  name: string;
  startLine: number;
  endLine: number;
  start: number;
  end: number;
}>;

export type Tag = "env" | "clock" | "files" | "proc" | "os";
export const TAGS: readonly Tag[] = ["env", "clock", "files", "proc", "os"];

export type FileEvent = readonly [offset: number, tag: Tag];

/** Which tags have an event inside [start, end). */
export const tagsWithin = (events: readonly FileEvent[], start: number, end: number): Tag[] => {
  const found = new Set<Tag>();
  for (const [offset, tag] of events) if (offset >= start && offset < end) found.add(tag);
  return TAGS.filter((t) => found.has(t));
};

/** -1 is the module's top level. */
export const MODULE_LEVEL = -1;

/**
 * The innermost function that holds a line: the one with the smallest span of lines among those
 * that contain it. Two sibling functions on one line tie, and the result says so, so that a caller
 * is never given a quiet guess.
 */
export const holderOf = (
  functions: readonly FnRecord[],
  line: number,
): Readonly<{ ids: number[] }> => {
  const holding = functions.filter((f) => f.startLine <= line && line <= f.endLine);
  if (holding.length === 0) return { ids: [MODULE_LEVEL] };
  const span = (f: FnRecord): number => f.endLine - f.startLine;
  const least = Math.min(...holding.map(span));
  const tied = holding.filter((f) => span(f) === least);
  const narrowest = Math.min(...tied.map((f) => f.end - f.start));
  return { ids: tied.filter((f) => f.end - f.start === narrowest).map((f) => f.id) };
};

/** Whether `inner` lies inside `outer`, or is it, following the parent links. */
export const isWithin = (functions: readonly FnRecord[], inner: number, outer: number): boolean => {
  const byId = new Map(functions.map((f) => [f.id, f]));
  let at = inner;
  while (at !== MODULE_LEVEL) {
    if (at === outer) return true;
    const f = byId.get(at);
    if (f === undefined) return false;
    at = f.parent;
  }
  return outer === MODULE_LEVEL;
};

// ---------------------------------------------------------------- the draw and its statistics

/** mulberry32: a small seeded generator, so a draw can be repeated on any machine. */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * A sample of `k` items without replacement, in the order drawn: step i swaps item i with an item
 * chosen from i to the end, and the first k are the sample. The input order is the caller's to fix
 * (the driver sorts by file, line and column), so the same seed gives the same sample everywhere.
 * Fewer than k items are all returned, in input order.
 */
export const sample = <T>(items: readonly T[], k: number, seed: number): T[] => {
  if (items.length <= k) return [...items];
  const rand = mulberry32(seed);
  const a = [...items];
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rand() * (a.length - i));
    const held = a[i] as T;
    a[i] = a[j] as T;
    a[j] = held;
  }
  return a.slice(0, k);
};

/** The Wilson 95% interval for `hits` of `n`. */
export const wilson = (hits: number, n: number): readonly [number, number] => {
  if (n === 0) return [0, 1];
  const z = 1.959964;
  const p = hits / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
};

/** Cohen's kappa for two equal-length label lists; 1 when both readers always give one label. */
export const kappa = (a: readonly string[], b: readonly string[]): number => {
  const n = a.length;
  if (n === 0) return Number.NaN;
  const observed = a.filter((x, i) => x === b[i]).length / n;
  const labels = new Set([...a, ...b]);
  let chance = 0;
  for (const l of labels) {
    chance += (a.filter((x) => x === l).length / n) * (b.filter((x) => x === l).length / n);
  }
  return chance === 1 ? 1 : (observed - chance) / (1 - chance);
};
