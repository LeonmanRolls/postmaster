// Tests beside scripts/skill-refs.ts, moved from its --self-test on #109: 10 controls.
// Each --fix control uses its own file instead of sharing one file in order.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refs } from "./skill-refs";

let tmp = "";
let root = "";
const put = (name: string, content: string): string => {
  const file = join(tmp, name);
  writeFileSync(file, content);
  return file;
};

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "skill-refs-"));
  root = join(tmp, "root");
  mkdirSync(join(root, "scripts", "lib"), { recursive: true });
  for (const name of ["run", "stage.ts", "launch.ts", "usage.ts"])
    writeFileSync(join(root, "scripts", name), "");
  writeFileSync(join(root, "scripts", "lib", "text.ts"), "");
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("checking script references", () => {
  test("new entry commands resolve in the tool and pinned prefixes", () => {
    const file = put(
      "good.md",
      [
        "Use `<tool>/scripts/run stage <dispatch> synthesis`.",
        "Use `<rt>/scripts/run launch` in a pinned copy.",
        "Use `<tool>/scripts/run text` from lib.",
        "The project's `<repo>/scripts/build.sh` belongs to that project.",
        "",
      ].join("\n"),
    );
    expect(refs(root, "check", [file]).code).toBe(0);
  });

  test("bare, relative and missing commands each fault", () => {
    const file = put(
      "bad.md",
      "Run scripts/run stage.\nRun ../../scripts/run stage.\nRun <tool>/scripts/run absent.\n",
    );
    const result = refs(root, "check", [file]);
    expect(result.code).toBe(1);
    expect(result.faults.map((f) => f.line)).toEqual([1, 2, 3]);
  });

  test("a direct Bun invocation faults", () => {
    const bunCommand = "bun ";
    const script = "<tool>/scripts/stage.ts --list\n";
    const file = put("direct.md", bunCommand + script);
    const result = refs(root, "check", [file]);
    expect(result.code).toBe(1);
    expect(result.faults.some((f) => f.why.includes("direct bun"))).toBe(true);
  });

  test("a remaining wrapper faults even with a clean runbook", () => {
    const file = put("clean.md", "<tool>/scripts/run stage\n");
    writeFileSync(join(root, "scripts", "zz-old.sh"), "");
    try {
      const result = refs(root, "check", [file]);
      expect(result.code).toBe(1);
      expect(result.faults.some((f) => f.file === "scripts/zz-old.sh")).toBe(true);
    } finally {
      rmSync(join(root, "scripts", "zz-old.sh"));
    }
  });

  test("an unreadable file exits 2", () => {
    expect(refs(root, "check", [join(tmp, "nowhere.md")]).code).toBe(2);
  });

  test("a lib script path resolves like the entry resolves it", () => {
    const file = put("lib.md", "See `<tool>/scripts/lib/text.ts` for splits.\n");
    expect(refs(root, "check", [file]).code).toBe(0);
    const missing = put("lib-missing.md", "See `<tool>/scripts/lib/absent.ts`.\n");
    const result = refs(root, "check", [missing]);
    expect(result.code).toBe(1);
    expect(result.faults.some((f) => f.why.includes("no such script"))).toBe(true);
  });

  test("an old pinned name faults toward run-pinned", () => {
    const file = put("rt.md", "See `<rt>/scripts/stage.sh` for stages.\n");
    const result = refs(root, "check", [file]);
    expect(result.code).toBe(1);
    expect(result.faults.some((f) => f.why.includes("run-pinned"))).toBe(true);
  });

  test("an entry call validates the whole invoked name", () => {
    const file = put(
      "run-name.md",
      "Run `<tool>/scripts/run stage.sh` now.\nRun `<tool>/scripts/run launch:42` now.\nRun `<tool>/scripts/run stage` today.\nSee `<tool>/scripts/run stage`'s output.\n",
    );
    const result = refs(root, "check", [file]);
    expect(result.code).toBe(1);
    expect(result.faults.map((f) => f.line)).toEqual([1, 2]);
  });

  test("a lib path must exist under lib/", () => {
    const file = put(
      "lib-strict.md",
      "See `<tool>/scripts/lib/launch.ts`.\nSee `<tool>/scripts/lib/text.ts.bak`.\n",
    );
    const result = refs(root, "check", [file]);
    expect(result.code).toBe(1);
    expect(result.faults.map((f) => f.line)).toEqual([1, 2]);
  });
});

describe("fixing script references", () => {
  test("old wrapped and unwrapped names use the entry, then stay unchanged", () => {
    const file = put(
      "fix.md",
      "scripts/stage.sh\n<tool>/scripts/usage.sh\nscripts/run launch\n<tool>/scripts/run text\n",
    );
    expect(refs(root, "fix", [file]).code).toBe(0);
    const once = readFileSync(file, "utf8");
    expect(once).toBe(
      "<tool>/scripts/run stage\n<tool>/scripts/run usage\n<tool>/scripts/run launch\n<tool>/scripts/run text\n",
    );
    expect(refs(root, "check", [file]).code).toBe(0);
    expect(refs(root, "fix", [file]).code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(once);
  });

  test("an old name with no TypeScript target is left for a fault", () => {
    const file = put("unknown.md", "<tool>/scripts/no-such.sh\n");
    const result = refs(root, "fix", [file]);
    expect(result.code).toBe(1);
    expect(readFileSync(file, "utf8")).toBe("<tool>/scripts/no-such.sh\n");
  });

  test("an old pinned name is left for run-pinned conversion", () => {
    const file = put("rt-fix.md", "See `<rt>/scripts/stage.sh` for stages.\n");
    const result = refs(root, "fix", [file]);
    expect(result.code).toBe(1);
    expect(readFileSync(file, "utf8")).toBe("See `<rt>/scripts/stage.sh` for stages.\n");
    expect(result.faults.some((f) => f.why.includes("run-pinned"))).toBe(true);
  });

  test("suffixed old names are prefixed, never rewritten to the entry", () => {
    const file = put("edge.md", "Run scripts/stage.sh.bak and scripts/stage.sh-old.\n");
    const result = refs(root, "fix", [file]);
    expect(readFileSync(file, "utf8")).toBe(
      "Run <tool>/scripts/stage.sh.bak and <tool>/scripts/stage.sh-old.\n",
    );
    expect(result.code).toBe(1);
  });

  test("a file:line citation keeps its line on the new path", () => {
    const file = put("cite.md", "See scripts/launch.sh:42 for context.\n");
    const result = refs(root, "fix", [file]);
    expect(result.code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe("See <tool>/scripts/launch.ts:42 for context.\n");
    expect(result.fixMessages).toEqual([`${file}: 1 reference(s) updated`]);
  });

  test("the fix message counts references updated", () => {
    const file = put("count.md", "Run scripts/stage.sh today.\n");
    const result = refs(root, "fix", [file]);
    expect(result.code).toBe(0);
    expect(result.fixMessages).toEqual([`${file}: 1 reference(s) updated`]);
    expect(readFileSync(file, "utf8")).toBe("Run <tool>/scripts/run stage today.\n");
    const prefixed = put("count-prefixed.md", "See <tool>/scripts/usage.sh now.\n");
    const second = refs(root, "fix", [prefixed]);
    expect(second.fixMessages).toEqual([`${prefixed}: 1 reference(s) updated`]);
  });
});
