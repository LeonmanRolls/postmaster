import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
});
