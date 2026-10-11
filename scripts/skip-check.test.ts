// Tests beside scripts/skip-check.ts: the report's shape read back, the list held against
// it, and each way a skip can be wrongly listed or unlisted.
import { expect, test } from "bun:test";
import { checkReport, fullName, parseReport, parseSkipList, type SkipEntry } from "./skip-check.ts";

const CASE = (attrs: string, body = ""): string =>
  body === "" ? `<testcase ${attrs} />` : `<testcase ${attrs}>${body}</testcase>`;

const REPORT = `<testsuites name="bun test" tests="4">
  <testsuite name="scripts/demo.test.ts" file="scripts/demo.test.ts" tests="4">
    ${CASE('name="runs fine" classname="" file="scripts/demo.test.ts" assertions="2"')}
    ${CASE('name="skipped one" classname="" file="scripts/demo.test.ts" assertions="0"', "<skipped />")}
    ${CASE('name="vacuous" classname="" file="scripts/demo.test.ts" assertions="0"')}
    ${CASE('name="failed one" classname="" file="scripts/demo.test.ts" assertions="0"', '<failure type="Error" message="x">boom</failure>')}
  </testsuite>
  <testsuite name="scripts/demo.test.ts" file="scripts/demo.test.ts" tests="1">
    ${CASE('name="inside" classname="inner &gt; outer" file="scripts/demo.test.ts" assertions="1"', "<skipped />")}
  </testsuite>
</testsuites>`;

const entry = (over: Partial<SkipEntry> = {}): SkipEntry => ({
  file: "scripts/demo.test.ts",
  name: "skipped one",
  reason: "nothing here can run it",
  systems: ["linux", "darwin"],
  ...over,
});

test("the full name puts the describes outermost first", () => {
  expect(fullName({ name: "inside", classname: "inner > outer" })).toBe("outer > inner > inside");
  expect(fullName({ name: "top", classname: "" })).toBe("top");
  expect(fullName({ name: "one deep", classname: "only" })).toBe("only > one deep");
});

test("the report's cases come back with their skips and their counts", () => {
  const cases = parseReport(REPORT);
  expect(cases).toHaveLength(5);
  expect([cases[0]!.file, cases[0]!.name, cases[0]!.skipped]).toEqual([
    "scripts/demo.test.ts",
    "runs fine",
    false,
  ]);
  expect([cases[1]!.name, cases[1]!.skipped, cases[1]!.assertions]).toEqual([
    "skipped one",
    true,
    "0",
  ]);
  expect([cases[2]!.name, cases[2]!.skipped, cases[2]!.failed]).toEqual(["vacuous", false, false]);
  expect([cases[3]!.name, cases[3]!.failed]).toEqual(["failed one", true]);
  expect([cases[4]!.name, cases[4]!.classname, cases[4]!.skipped]).toEqual([
    "inside",
    "inner > outer",
    true,
  ]);
});

test("a skip listed for this system with a reason passes and is named", () => {
  const res = checkReport(REPORT, [entry()], "linux");
  expect(res.faults).toEqual([
    "passes without checking anything: scripts/demo.test.ts: vacuous",
    "unlisted skip: scripts/demo.test.ts: outer > inner > inside",
  ]);
  expect(res.skipped).toBe(2);
  expect(res.matched).toEqual([
    {
      file: "scripts/demo.test.ts",
      name: "skipped one",
      reason: "nothing here can run it",
      system: "linux",
    },
  ]);
  expect(res.vacuous).toBe(1);
});

test("a skip the list does not name fails, naming the test", () => {
  const res = checkReport(REPORT, [], "linux");
  expect(res.faults).toContain("unlisted skip: scripts/demo.test.ts: skipped one");
  expect(res.faults).toContain("unlisted skip: scripts/demo.test.ts: outer > inner > inside");
});

test("a skip listed for only the other system fails here", () => {
  const res = checkReport(REPORT, [entry({ systems: ["darwin"] })], "linux");
  expect(
    res.faults.some((f) => f.startsWith("wrong system: scripts/demo.test.ts: skipped one")),
  ).toBe(true);
});

test("an entry with no reason fails, naming the entry", () => {
  const list = parseSkipList(
    '[[skip]]\nfile = "scripts/demo.test.ts"\nname = "skipped one"\nreason = ""\nsystems = ["linux"]\n',
  );
  expect(list.entries).toHaveLength(0);
  expect(list.faults.some((f) => f.includes("reason is empty") && f.includes("skipped one"))).toBe(
    true,
  );
});

test("a test that passes with no assertions fails as a hidden skip; a failed one does not", () => {
  const res = checkReport(REPORT, [entry(), entry({ name: "outer > inner > inside" })], "linux");
  expect(res.faults).toContain("passes without checking anything: scripts/demo.test.ts: vacuous");
  expect(res.faults.some((f) => f.includes("failed one"))).toBe(false);
});

test("an entry naming a test that is not in the report fails as stale", () => {
  const res = checkReport(REPORT, [entry({ name: "a renamed test" })], "linux");
  expect(res.faults).toContain(
    "stale entry: scripts/demo.test.ts: a renamed test is not in the report",
  );
});

test("the list parses its shape and refuses what it cannot list honestly", () => {
  const good = parseSkipList(
    '[[skip]]\nfile = "scripts/a.test.ts"\nname = "n"\nreason = "r"\nsystems = ["linux"]\n',
  );
  expect(good.entries).toHaveLength(1);
  expect(good.faults).toEqual([]);

  const dup = parseSkipList(
    '[[skip]]\nfile = "scripts/a.test.ts"\nname = "n"\nreason = "r"\nsystems = ["linux"]\n' +
      '[[skip]]\nfile = "scripts/a.test.ts"\nname = "n"\nreason = "r"\nsystems = ["linux"]\n',
  );
  expect(dup.faults.some((f) => f.includes("listed twice"))).toBe(true);

  const badSystem = parseSkipList(
    '[[skip]]\nfile = "scripts/a.test.ts"\nname = "n"\nreason = "r"\nsystems = ["windows"]\n',
  );
  expect(badSystem.faults.some((f) => f.includes("unknown system"))).toBe(true);

  const dupSystem = parseSkipList(
    '[[skip]]\nfile = "scripts/a.test.ts"\nname = "n"\nreason = "r"\nsystems = ["linux", "linux"]\n',
  );
  expect(dupSystem.faults.some((f) => f.includes("listed twice"))).toBe(true);

  const notTables = parseSkipList("skip = 3\n");
  expect(notTables.faults).toHaveLength(1);

  const garbage = parseSkipList("[[skip]\n");
  expect(garbage.faults.some((f) => f.includes("does not parse"))).toBe(true);
});

test("an apostrophe in a test name survives the report's escaping", () => {
  const xml = `<testsuites><testsuite name="s" file="scripts/x.test.ts">${CASE(
    'name="the manifest&apos;s own" classname="" file="scripts/x.test.ts" assertions="0"',
    "<skipped />",
  )}</testsuite></testsuites>`;
  const res = checkReport(
    xml,
    [{ file: "scripts/x.test.ts", name: "the manifest's own", reason: "r", systems: ["linux"] }],
    "linux",
  );
  expect(res.faults).toEqual([]);
});
