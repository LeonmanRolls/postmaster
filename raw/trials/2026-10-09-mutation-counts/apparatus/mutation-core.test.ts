import { expect, test } from "bun:test";
import {
  type FnRecord,
  type Node,
  MODULE_LEVEL,
  callSite,
  holderOf,
  isWithin,
  kappa,
  mulberry32,
  patternTargets,
  sample,
  tagsWithin,
  unwrap,
  wilson,
} from "./mutation-core.ts";

const HERE = { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } } as const;
const node = (type: string, fields: Partial<Node> = {}): Node => ({
  type,
  range: [0, 0],
  loc: HERE,
  ...fields,
});
const id = (name: string): Node => node("Identifier", { name });
const member = (object: Node, property: string): Node =>
  node("MemberExpression", { computed: false, object, property: id(property) });
const fn = (
  n: number,
  parent: number,
  startLine: number,
  endLine: number,
  start: number,
  end: number,
): FnRecord => ({
  id: n,
  parent,
  kind: "FunctionDeclaration",
  name: `f${n}`,
  startLine,
  endLine,
  start,
  end,
});

test("a call of a method on the ticket's list is a site on its receiver", () => {
  const call = node("CallExpression", {
    callee: member(id("xs"), "push"),
    arguments: [id("y")],
  });
  expect(callSite(call)?.how).toBe("push");
  expect(callSite(call)?.target.name).toBe("xs");
});

test("a method off the list is no site, and Object.assign's target is its first argument", () => {
  const map = node("CallExpression", { callee: member(id("xs"), "map"), arguments: [] });
  expect(callSite(map)).toBeNull();
  const assign = node("CallExpression", {
    callee: member(id("Object"), "assign"),
    arguments: [id("opts"), id("defaults")],
  });
  expect(callSite(assign)?.op).toBe("assign");
  expect(callSite(assign)?.how).toBe("Object.assign");
  expect(callSite(assign)?.target.name).toBe("opts");
});

test("unwrap strips type assertions, non-null marks and optional chains", () => {
  const wrapped = node("ChainExpression", {
    expression: node("TSNonNullExpression", {
      expression: node("TSAsExpression", { expression: id("x") }),
    }),
  });
  expect(unwrap(wrapped).name).toBe("x");
});

test("patternTargets lists every name or member a destructuring writes to", () => {
  const pattern = node("ArrayPattern", {
    elements: [id("a"), null, member(id("o"), "b"), node("RestElement", { argument: id("rest") })],
  });
  expect(patternTargets(pattern).map((t) => t.type)).toEqual([
    "Identifier",
    "MemberExpression",
    "Identifier",
  ]);
});

test("holderOf picks the innermost function and says so when two siblings tie", () => {
  const functions = [
    fn(0, -1, 1, 20, 0, 400),
    fn(1, 0, 5, 8, 100, 180),
    fn(2, 0, 9, 9, 200, 230),
    fn(3, 0, 9, 9, 240, 270),
  ];
  expect(holderOf(functions, 6).ids).toEqual([1]);
  expect(holderOf(functions, 15).ids).toEqual([0]);
  expect(holderOf(functions, 30).ids).toEqual([MODULE_LEVEL]);
  expect(holderOf(functions, 9).ids).toEqual([2, 3]);
});

test("isWithin follows parent links, and everything is within the module", () => {
  const functions = [fn(0, -1, 1, 20, 0, 400), fn(1, 0, 5, 8, 100, 180)];
  expect(isWithin(functions, 1, 0)).toBe(true);
  expect(isWithin(functions, 0, 1)).toBe(false);
  expect(isWithin(functions, 1, MODULE_LEVEL)).toBe(true);
});

test("tagsWithin keeps the events inside the span, in the fixed tag order", () => {
  expect(
    tagsWithin(
      [
        [5, "clock"],
        [6, "env"],
        [50, "files"],
      ],
      0,
      10,
    ),
  ).toEqual(["env", "clock"]);
});

test("a draw is repeatable, has no repeats, and returns all of a short list", () => {
  const items = Array.from({ length: 100 }, (_, i) => i);
  const a = sample(items, 30, 372);
  expect(a).toEqual(sample(items, 30, 372));
  expect(new Set(a).size).toBe(30);
  expect(a).not.toEqual(sample(items, 30, 373));
  expect(sample([1, 2, 3], 30, 372)).toEqual([1, 2, 3]);
});

test("a draw of 30 from 0 to 99 with seed 372, and of 10 from 0 to 29 with seed 373, match a second implementation", () => {
  // the lists below were made by an independent Python implementation of the same algorithm
  const hundred = Array.from({ length: 100 }, (_, i) => i);
  expect(sample(hundred, 30, 372)).toEqual([
    32, 21, 82, 37, 62, 12, 98, 45, 47, 55, 97, 75, 44, 9, 72, 19, 10, 25, 77, 6, 48, 38, 88, 46,
    80, 2, 52, 23, 76, 68,
  ]);
  const thirty = Array.from({ length: 30 }, (_, i) => i);
  expect(sample(thirty, 10, 373)).toEqual([29, 0, 20, 23, 24, 13, 17, 19, 5, 1]);
});

test("the generator's first values are fixed, so a draw reads the same on every machine", () => {
  const next = mulberry32(372);
  expect([next(), next(), next()].map((x) => Math.floor(x * 1e6))).toEqual([
    322365, 204764, 823608,
  ]);
});

test("the Wilson interval for 10 of 30 is the known one, and 0 of 0 is everything", () => {
  const [low, high] = wilson(10, 30);
  expect(Math.round(low * 1000)).toBe(192);
  expect(Math.round(high * 1000)).toBe(512);
  expect(wilson(0, 0)).toEqual([0, 1]);
});

test("kappa is 1 for identical readers and below 0.2 for a pair that agrees by chance alone", () => {
  const a = ["h", "h", "n", "n", "u", "h", "n", "u"];
  expect(kappa(a, a)).toBe(1);
  expect(kappa(["h", "h", "n", "n"], ["h", "n", "h", "n"])).toBeLessThan(0.2);
});
