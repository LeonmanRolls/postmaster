import { describe, expect, test } from "bun:test";
import { inspectTests, type SkipEntry } from "./test-check.ts";

const planted =
  '<testsuites><testsuite name="scripts/planted.test.ts" file="scripts/planted.test.ts">' +
  '<testcase name="planted skip" classname="planted group" file="scripts/planted.test.ts" assertions="0"><skipped/></testcase>' +
  "</testsuite></testsuites>";
const entry = (systems: string[], reason = "platform cannot run this probe"): SkipEntry => ({
  file: "scripts/planted.test.ts",
  name: "planted group > planted skip",
  reason,
  systems,
});

describe("test skip inventory", () => {
  test("an unlisted skip names its file and full test name", () => {
    const result = inspectTests(planted, [], "linux");
    expect(result.errors).toContain(
      "unlisted skip on linux: scripts/planted.test.ts :: planted group > planted skip",
    );
  });

  test("a listed skip must have a reason", () => {
    const result = inspectTests(planted, [entry(["linux"], "")], "linux");
    expect(result.errors).toContain(
      "skip list entry has no reason: scripts/planted.test.ts :: planted group > planted skip",
    );
  });

  test("a skip whose entry excludes this system fails", () => {
    const result = inspectTests(planted, [entry(["darwin"])], "linux");
    expect(result.errors).toContain(
      "skip list does not allow linux: scripts/planted.test.ts :: planted group > planted skip",
    );
  });

  test("a listed skip is accepted on one of its systems", () => {
    const result = inspectTests(planted, [entry(["linux", "darwin"])], "linux");
    expect(result.errors).toEqual([]);
    expect(result.skips).toHaveLength(1);
  });

  test("a passing test with no assertions is a hidden skip", () => {
    const report = planted.replace("<skipped/>", "");
    const result = inspectTests(report, [entry(["linux"])], "linux");
    expect(result.errors).toContain(
      "hidden skip: scripts/planted.test.ts :: planted group > planted skip passed with zero assertions",
    );
  });
});
