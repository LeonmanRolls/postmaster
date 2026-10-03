// Tests beside scripts/skill-refs.ts, moved from its --self-test on #109: 10 controls.
// Each --fix control uses its own file instead of sharing one file in order.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refs } from "./skill-refs";

let tmp = "";
let root = "";
let bare = "";
let good = "";
let relative = "";
let missing = "";
let rtMissing = "";

const faults = (file: string): number => refs(root, "check", [file]).faults.length;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "skill-refs-"));
  root = join(tmp, "root");
  const scriptsDir = join(root, "scripts");
  mkdirSync(scriptsDir, { recursive: true });
  writeFileSync(join(scriptsDir, "stage.sh"), "");
  writeFileSync(join(scriptsDir, "launch.sh"), "");

  bare = join(tmp, "bare.md");
  good = join(tmp, "good.md");
  relative = join(tmp, "relative.md");
  missing = join(tmp, "missing.md");
  rtMissing = join(tmp, "rt-missing.md");

  writeFileSync(
    bare,
    [
      "Set the stage with `scripts/stage.sh <dispatch> synthesis`.",
      "( scripts/launch.sh launch <lane> <wt> <prompt> ) &",
      "Every leg ends with scripts/stage.sh.",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    good,
    [
      "Set the stage with `<tool>/scripts/stage.sh <dispatch> synthesis`.",
      "( <tool>/scripts/launch.sh launch <lane> <wt> <prompt> ) &",
      "The run's own `<rt>/scripts/stage.sh` is the same repo, pinned.",
      "The project's own `<repo>/scripts/build.sh` and \"$HERE/scripts/x\" are not the tool's.",
      "Every `<tool>/scripts/` path is the repo's; postscripts/ and myscripts/x.sh are other words.",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(relative, "Run `../../scripts/stage.sh` from the skill.\n", "utf8");
  writeFileSync(missing, "Run `<tool>/scripts/no-such.sh`.\n", "utf8");
  writeFileSync(rtMissing, "Run `<rt>/scripts/no-such.sh` from the pin.\n", "utf8");
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("positive controls: each fault is found, on its own line", () => {
  test("three bare references are three faults", () => {
    expect(faults(bare)).toBe(3);
  }, 10000);

  test("a fault names its file and line, and exits 1", () => {
    const r = refs(root, "check", [bare]);
    const out = r.faults.map((f) => `${f.file}:${f.line}: ${f.why}: ${f.ref}`).join("\n");
    expect(r.code).toBe(1);
    expect(out.includes(`${bare}:1: bare`)).toBe(true);
  }, 10000);

  test("a path that reaches scripts/ another way is a fault", () => {
    expect(faults(relative)).toBe(1);
  }, 10000);

  test("a script the repo does not have is a fault", () => {
    expect(faults(missing)).toBe(1);
  }, 10000);

  test("a script the repo does not have is a fault through <rt> too", () => {
    expect(faults(rtMissing)).toBe(1);
  }, 10000);
});

describe("negative controls: nothing is found where nothing is wrong", () => {
  test("references through <tool>, and other directories' scripts/, read zero", () => {
    const r = refs(root, "check", [good]);
    expect(r.code).toBe(0);
    expect(r.faults.length).toBe(0);
  }, 10000);

  test("a file that cannot be read is exit 2, not a clean result", () => {
    const r = refs(root, "check", [join(tmp, "nowhere.md")]);
    expect(r.code).toBe(2);
  }, 10000);
});

describe("--fix: bare references go through <tool>, and a second run changes nothing", () => {
  test("every bare reference is fixed, none is doubled, and the one it cannot fix is still named", () => {
    const fix = join(tmp, "fix.md");
    writeFileSync(
      fix,
      readFileSync(bare, "utf8") + readFileSync(good, "utf8") + readFileSync(relative, "utf8"),
      "utf8",
    );
    refs(root, "fix", [fix]);
    const r = refs(root, "check", [fix]);
    const body = readFileSync(fix, "utf8");
    expect(r.faults.length).toBe(1);
    expect(body.includes("<tool>/<tool>/")).toBe(false);
    expect(body.includes("`<tool>/scripts/stage.sh <dispatch>")).toBe(true);
  }, 10000);

  test("a second --fix changes nothing", () => {
    const fix = join(tmp, "twice.md");
    writeFileSync(fix, readFileSync(bare, "utf8"), "utf8");
    refs(root, "fix", [fix]);
    const once = readFileSync(fix, "utf8");
    refs(root, "fix", [fix]);
    expect(readFileSync(fix, "utf8")).toBe(once);
  }, 10000);

  test("--fix leaves a file with no bare reference alone", () => {
    const goodCopy = join(tmp, "good-copy.md");
    writeFileSync(goodCopy, readFileSync(good, "utf8"), "utf8");
    refs(root, "fix", [goodCopy]);
    expect(readFileSync(goodCopy, "utf8")).toBe(readFileSync(good, "utf8"));
  }, 10000);
});
