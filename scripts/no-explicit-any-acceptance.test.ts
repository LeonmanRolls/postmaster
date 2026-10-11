// Tests beside scripts/no-explicit-any-acceptance.ts: fixture controls plus the live-tree
// step. Each control plants its own tree, so tests pass alone and in order. The stub
// runner answers the lint runs from canned outputs, reading the probe file's presence to
// tell the planted run from the calm one and the count control from the clean count.
// The type-only controls run real git in a
// planted repository and stub only the lint runs. The usage controls spawn the wrapper;
// every other control calls accept() directly.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolRoot } from "./lib/paths.ts";
import { accept, spawnRunner, strippedEqual } from "./no-explicit-any-acceptance";
import type { RunResult, Runner } from "./no-explicit-any-acceptance";

const wrapper = join(import.meta.dir, "run");
const ROOT = toolRoot(import.meta);
const RULE = "typescript/no-explicit-any";
const CHECK = "tsc --noEmit && bunx oxlint";

// The comment head and the rule tail stay on separate lines, so this file holds no line
// the oracle's own walk would count; the planted fixture gets the joined form.
const OXLINT_HEAD = "// oxlint-disable-next-line typescript/";
const ESLINT_HEAD = "// eslint-disable-next-line typescript/";
const REASONED_TAIL = "no-explicit-any -- an old JSON shape\n";
const BARE_TAIL = "no-explicit-any\n";

const CLEAN: RunResult = { code: 0, out: "", err: "", ran: true };
const ZERO: RunResult = { code: 0, out: "", err: "", ran: true };
const FLAGGED: RunResult = {
  code: 1,
  out: "scripts/zz-probe.ts:1:22: error typescript(no-explicit-any): Unexpected `any`. Specify a different type. help: Use `unknown` instead, this will force you to explicitly, and safely, assert the type is correct.\n",
  err: "",
  ran: true,
};
const MANY: RunResult = {
  code: 1,
  out: "scripts/host.ts:9:9: Unexpected `any`. Specify a different type. [Error/typescript(no-explicit-any)]\n\n181 problems\n",
  err: "",
  ran: true,
};
const ONE: RunResult = {
  code: 1,
  out: "scripts/zz-probe.ts:1:10: Unexpected `any`. Specify a different type. [Error/typescript(no-explicit-any)]\n\n1 problem\n",
  err: "",
  ran: true,
};
const DEAD: RunResult = { code: 127, out: "", err: "bunx: never exited\n", ran: false };

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function fresh(): string {
  const d = mkdtempSync(join(tmpdir(), "any233-"));
  tmpDirs.push(d);
  return d;
}

function plant(dir: string, oxlintrc: unknown, check: string): void {
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify(oxlintrc));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { check } }));
}

const ALLOWED_IGNORES = [
  "fixtures/**",
  "scripts/scrub-check.ts",
  "scripts/raw-promote.ts",
  "scripts/lib/vendor/**",
];

function cleanConfig(): unknown {
  return { rules: { [RULE]: "error" }, ignorePatterns: ALLOWED_IGNORES };
}

function stub(canned: {
  flagged: RunResult;
  clean: RunResult;
  zero: RunResult;
  control: RunResult;
}): Runner {
  return (cmd: string[], cwd: string): RunResult => {
    const planted = existsSync(join(cwd, "scripts", "zz-probe.ts"));
    if (cmd.includes("-f")) return planted ? canned.control : canned.zero;
    if (planted) return canned.flagged;
    return canned.clean;
  };
}

const GOOD = { flagged: FLAGGED, clean: CLEAN, zero: ZERO, control: ONE };

describe("a clean tree", () => {
  test("passes with reasoned suppressions under the cap", () => {
    const dir = fresh();
    plant(dir, cleanConfig(), CHECK);
    writeFileSync(join(dir, "scripts", "a.ts"), `${OXLINT_HEAD + REASONED_TAIL}const x = 1;\n`);
    writeFileSync(join(dir, "scripts", "b.ts"), `${ESLINT_HEAD + REASONED_TAIL}const y = 2;\n`);
    const r = accept(dir, stub(GOOD));
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
  });

  test("removes the probe it plants", () => {
    const dir = fresh();
    plant(dir, cleanConfig(), CHECK);
    const r = accept(dir, stub(GOOD));
    expect(r.code).toBe(0);
    expect(existsSync(join(dir, "scripts", "zz-probe.ts"))).toBe(false);
  });
});

describe("the rule's setting", () => {
  test("off fails naming the config", () => {
    const dir = fresh();
    plant(dir, { rules: { [RULE]: "off" }, ignorePatterns: ALLOWED_IGNORES }, CHECK);
    const r = accept(dir, stub(GOOD));
    expect(r.code).toBe(1);
    expect(r.out).toContain(".oxlintrc.json");
  });

  test("missing fails", () => {
    const dir = fresh();
    plant(dir, { rules: {}, ignorePatterns: ALLOWED_IGNORES }, CHECK);
    const r = accept(dir, stub(GOOD));
    expect(r.code).toBe(1);
    expect(r.out).toContain(RULE);
  });

  test("an overrides entry switching it off fails", () => {
    const dir = fresh();
    plant(
      dir,
      {
        rules: { [RULE]: "error" },
        ignorePatterns: ALLOWED_IGNORES,
        overrides: [{ files: ["x.ts"], rules: { [RULE]: "off" } }],
      },
      CHECK,
    );
    const r = accept(dir, stub(GOOD));
    expect(r.code).toBe(1);
    expect(r.out).toContain("overrides[0]");
  });

  test("an overrides entry lowering it to warn fails", () => {
    const dir = fresh();
    plant(
      dir,
      {
        rules: { [RULE]: "error" },
        ignorePatterns: ALLOWED_IGNORES,
        overrides: [{ files: ["x.ts"], rules: { [RULE]: "warn" } }],
      },
      CHECK,
    );
    const r = accept(dir, stub(GOOD));
    expect(r.code).toBe(1);
    expect(r.out).toContain("overrides[0]");
  });

  test("an overrides entry setting it to 1 fails", () => {
    const dir = fresh();
    plant(
      dir,
      {
        rules: { [RULE]: "error" },
        ignorePatterns: ALLOWED_IGNORES,
        overrides: [{ files: ["x.ts"], rules: { [RULE]: 1 } }],
      },
      CHECK,
    );
    const r = accept(dir, stub(GOOD));
    expect(r.code).toBe(1);
    expect(r.out).toContain("overrides[0]");
  });

  test("an overrides entry keeping it at error passes", () => {
    const dir = fresh();
    plant(
      dir,
      {
        rules: { [RULE]: "error" },
        ignorePatterns: ALLOWED_IGNORES,
        overrides: [{ files: ["x.ts"], rules: { [RULE]: "error" } }],
      },
      CHECK,
    );
    const r = accept(dir, stub(GOOD));
    expect(r.code).toBe(0);
  });

  test("an overrides entry for another rule passes", () => {
    const dir = fresh();
    plant(
      dir,
      {
        rules: { [RULE]: "error" },
        ignorePatterns: ALLOWED_IGNORES,
        overrides: [{ files: ["x.ts"], rules: { "no-debugger": "off" } }],
      },
      CHECK,
    );
    const r = accept(dir, stub(GOOD));
    expect(r.code).toBe(0);
  });

  test("changed ignorePatterns fail", () => {
    const dir = fresh();
    plant(dir, { rules: { [RULE]: "error" }, ignorePatterns: ["src/**"] }, CHECK);
    const r = accept(dir, stub(GOOD));
    expect(r.code).toBe(1);
    expect(r.out).toContain("ignorePatterns");
  });

  test("exactly the allowed ignores pass, a third path fails", () => {
    const dir = fresh();
    plant(dir, { rules: { [RULE]: "error" }, ignorePatterns: ALLOWED_IGNORES }, CHECK);
    const r = accept(dir, stub(GOOD));
    expect(r.code).toBe(0);
    const extra = fresh();
    plant(
      extra,
      { rules: { [RULE]: "error" }, ignorePatterns: [...ALLOWED_IGNORES, "scripts/extra.ts"] },
      CHECK,
    );
    const r2 = accept(extra, stub(GOOD));
    expect(r2.code).toBe(1);
    expect(r2.out).toContain("ignorePatterns");
  });
});

describe("the gate's shape", () => {
  // #232 fails every warning through --deny-warnings, so the pin accepts that
  // one flag and refuses every other blanket mechanism, naming it; the rule
  // still fails at error either way (ruling on the 232/233 merge).
  test("--deny-warnings passes", () => {
    const dir = fresh();
    plant(dir, cleanConfig(), "tsc --noEmit && bunx oxlint --deny-warnings");
    const r = accept(dir, stub(GOOD));
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
  });

  test("another blanket flag fails naming the flag", () => {
    const dir = fresh();
    plant(dir, cleanConfig(), "tsc --noEmit && bunx oxlint --max-warnings=0");
    const r = accept(dir, stub(GOOD));
    expect(r.code).toBe(1);
    expect(r.out).toContain("--max-warnings=0");
  });

  test("denying every rule fails naming the flag", () => {
    const dir = fresh();
    plant(dir, cleanConfig(), "tsc --noEmit && bunx oxlint --deny all");
    const r = accept(dir, stub(GOOD));
    expect(r.code).toBe(1);
    expect(r.out).toContain("--deny all");
  });

  test("without the rule at error still fails", () => {
    const dir = fresh();
    plant(
      dir,
      { rules: {}, ignorePatterns: ALLOWED_IGNORES },
      "tsc --noEmit && bunx oxlint --deny-warnings",
    );
    const r = accept(dir, stub(GOOD));
    expect(r.code).toBe(1);
    expect(r.out).toContain(RULE);
  });

  test("a check that never runs the linter fails", () => {
    const dir = fresh();
    plant(dir, cleanConfig(), "tsc --noEmit");
    const r = accept(dir, stub(GOOD));
    expect(r.code).toBe(1);
    expect(r.out).toContain("package.json");
  });
});

describe("suppressions", () => {
  test("six reasoned ones fail on the cap", () => {
    const dir = fresh();
    plant(dir, cleanConfig(), CHECK);
    const lines = Array.from(
      { length: 6 },
      (_, i) => `${OXLINT_HEAD + REASONED_TAIL}const v${i} = ${i};\n`,
    );
    writeFileSync(join(dir, "scripts", "a.ts"), lines.join(""));
    const r = accept(dir, stub(GOOD));
    expect(r.code).toBe(1);
    expect(r.out).toContain("at most 5");
  });

  test("one without a reason fails naming its line", () => {
    const dir = fresh();
    plant(dir, cleanConfig(), CHECK);
    writeFileSync(join(dir, "scripts", "a.ts"), `${OXLINT_HEAD + BARE_TAIL}const x = 1;\n`);
    const r = accept(dir, stub(GOOD));
    expect(r.code).toBe(1);
    expect(r.out).toContain("scripts/a.ts:1");
  });

  test("a reason of only a non-breaking space fails too", () => {
    const dir = fresh();
    plant(dir, cleanConfig(), CHECK);
    writeFileSync(
      join(dir, "scripts", "a.ts"),
      `${OXLINT_HEAD}no-explicit-any -- \u00A0\nconst x = 1;\n`,
    );
    const r = accept(dir, stub(GOOD));
    expect(r.code).toBe(1);
    expect(r.out).toContain("scripts/a.ts:1");
  });

  test("a reason of only a next-line char fails too", () => {
    const dir = fresh();
    plant(dir, cleanConfig(), CHECK);
    writeFileSync(
      join(dir, "scripts", "a.ts"),
      `${OXLINT_HEAD}no-explicit-any -- \u0085\nconst x = 1;\n`,
    );
    const r = accept(dir, stub(GOOD));
    expect(r.code).toBe(1);
    expect(r.out).toContain("scripts/a.ts:1");
  });

  test("the eslint spelling counts too", () => {
    const dir = fresh();
    plant(dir, cleanConfig(), CHECK);
    writeFileSync(join(dir, "scripts", "a.ts"), `${ESLINT_HEAD + BARE_TAIL}const x = 1;\n`);
    const r = accept(dir, stub(GOOD));
    expect(r.code).toBe(1);
    expect(r.out).toContain("scripts/a.ts:1");
  });
});

describe("the lint runs", () => {
  test("a probe the gate ignores fails", () => {
    const dir = fresh();
    plant(dir, cleanConfig(), CHECK);
    const r = accept(dir, stub({ flagged: CLEAN, clean: CLEAN, zero: ZERO, control: ONE }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("probe");
  });

  test("a nonzero count fails naming the count", () => {
    const dir = fresh();
    plant(dir, cleanConfig(), CHECK);
    const r = accept(dir, stub({ flagged: FLAGGED, clean: CLEAN, zero: MANY, control: ONE }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("181 problems");
  });

  test("a singular count fails too", () => {
    const dir = fresh();
    plant(dir, cleanConfig(), CHECK);
    const r = accept(dir, stub({ flagged: FLAGGED, clean: CLEAN, zero: ONE, control: ONE }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("1 problem");
  });

  test("a count run that never starts exits 2", () => {
    const dir = fresh();
    plant(dir, cleanConfig(), CHECK);
    const r = accept(dir, stub({ flagged: FLAGGED, clean: CLEAN, zero: DEAD, control: ONE }));
    expect(r.code).toBe(2);
  });

  test("a probe the count misses fails", () => {
    const dir = fresh();
    plant(dir, cleanConfig(), CHECK);
    const r = accept(dir, stub({ flagged: FLAGGED, clean: CLEAN, zero: ZERO, control: ZERO }));
    expect(r.code).toBe(1);
    expect(r.out).toContain("count");
  });
});

describe("tree errors", () => {
  test("a probe already standing exits 2", () => {
    const dir = fresh();
    plant(dir, cleanConfig(), CHECK);
    writeFileSync(join(dir, "scripts", "zz-probe.ts"), "const z = 1;\n");
    const r = accept(dir, stub(GOOD));
    expect(r.code).toBe(2);
  });

  test("a missing config exits 2", () => {
    const dir = fresh();
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { check: CHECK } }));
    const r = accept(dir, stub(GOOD));
    expect(r.code).toBe(2);
  });
});

describe("strippedEqual", () => {
  test("a type-only edit compares equal", () => {
    expect(strippedEqual("const v: any = 1;\n", "const v: unknown = 1;\n")).toBe(true);
  });

  test("comments and line breaks compare equal", () => {
    expect(strippedEqual("// a\nconst v = 1;\n", "const v = 1;\n// b\n")).toBe(true);
  });

  test("a value change compares different", () => {
    expect(strippedEqual("const v = 1;\n", "const v = 2;\n")).toBe(false);
  });

  test("whitespace inside strings still counts", () => {
    expect(strippedEqual('const s = "a b";\n', 'const s = "ab";\n')).toBe(false);
  });
});

describe("type-only test changes", () => {
  const BEFORE = "const v: any = 1;\nexpect(v).toBe(1);\n";
  const TYPED = "const v: unknown = 1;\nexpect(v).toBe(1);\n";
  const CHANGED = "const v: unknown = 1;\nexpect(v).toBe(2);\n";

  function git(dir: string, args: string[]): void {
    const r = spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
      cwd: dir,
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }

  function repoWithTest(): { dir: string; base: string } {
    const dir = fresh();
    plant(dir, cleanConfig(), CHECK);
    writeFileSync(join(dir, "scripts", "w.test.ts"), BEFORE);
    writeFileSync(join(dir, "scripts", "keep.ts"), "const k = 1;\n");
    git(dir, ["init", "-q", "-b", "main"]);
    git(dir, ["add", "."]);
    git(dir, ["commit", "-qm", "base"]);
    const base = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: dir,
      encoding: "utf8",
    }).stdout.trim();
    return { dir, base };
  }

  function both(cmd: string[], cwd: string): RunResult {
    return cmd[0] === "git" ? spawnRunner(cmd, cwd) : stub(GOOD)(cmd, cwd);
  }

  test("a type-only edit passes", () => {
    const { dir, base } = repoWithTest();
    writeFileSync(join(dir, "scripts", "w.test.ts"), TYPED);
    git(dir, ["commit", "-qam", "types"]);
    expect(accept(dir, both, base).code).toBe(0);
  });

  test("a value change fails naming the file", () => {
    const { dir, base } = repoWithTest();
    writeFileSync(join(dir, "scripts", "w.test.ts"), CHANGED);
    git(dir, ["commit", "-qam", "value"]);
    const r = accept(dir, both, base);
    expect(r.code).toBe(1);
    expect(r.out).toContain("scripts/w.test.ts");
  });

  test("an added test file is skipped", () => {
    const { dir, base } = repoWithTest();
    writeFileSync(join(dir, "scripts", "n.test.ts"), "const n = 1;\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-qm", "added"]);
    expect(accept(dir, both, base).code).toBe(0);
  });

  test("a deleted test file fails", () => {
    const { dir, base } = repoWithTest();
    git(dir, ["rm", "-q", "scripts/w.test.ts"]);
    git(dir, ["commit", "-qm", "deleted"]);
    const r = accept(dir, both, base);
    expect(r.code).toBe(1);
    expect(r.out).toContain("scripts/w.test.ts");
  });

  test("an unknown base exits 2", () => {
    const { dir } = repoWithTest();
    const r = accept(dir, both, "0000000000000000000000000000000000000000");
    expect(r.code).toBe(2);
  });
});

describe("the live tree", () => {
  test("passes on the finished branch", () => {
    const r = accept(ROOT);
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
  });

  test("passes from a relative root", () => {
    const r = spawnSync(wrapper, ["no-explicit-any-acceptance", ".."], {
      cwd: join(ROOT, "scripts"),
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
  });
});

describe("usage", () => {
  test("two roots exits 2", () => {
    const r = spawnSync(wrapper, ["no-explicit-any-acceptance", "a", "b"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
  });

  test("a dash argument exits 2", () => {
    const r = spawnSync(wrapper, ["no-explicit-any-acceptance", "--nope"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
  });

  test("--base without a value exits 2", () => {
    const r = spawnSync(wrapper, ["no-explicit-any-acceptance", "--base"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
  });
});
