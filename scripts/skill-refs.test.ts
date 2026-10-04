// Tests beside scripts/skill-refs.ts, moved from its --self-test on #109: 10 controls.
// The coachman's shell blocks are also compared across bash and zsh here.
// Each --fix control uses its own file instead of sharing one file in order.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultFiles, refs } from "./skill-refs";

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

  test("the bare check covers the postmaster skill and the clerk skill", () => {
    const covered = join(tmp, "covered");
    for (const skill of ["postmaster", "clerk"]) {
      mkdirSync(join(covered, "skills", skill), { recursive: true });
      writeFileSync(join(covered, "skills", skill, "runbook.md"), "run\n");
    }
    writeFileSync(join(covered, "skills", "postmaster", "notes.txt"), "not a runbook\n");
    expect(defaultFiles(covered).toSorted()).toEqual(
      [
        join(covered, "skills", "postmaster", "runbook.md"),
        join(covered, "skills", "clerk", "runbook.md"),
      ].toSorted(),
    );
  }, 10000);
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

  test("--fix leaves a file with no bare reference alone", () => {
    const file = put("good-copy.md", "Use `<tool>/scripts/run stage <dispatch> synthesis`.\n");
    refs(root, "fix", [file]);
    expect(readFileSync(file, "utf8")).toBe(
      "Use `<tool>/scripts/run stage <dispatch> synthesis`.\n",
    );
  }, 10000);
});
type RunResult = Readonly<{ code: number; calls: string[][] }>;

const DOC = join(import.meta.dir, "../skills/postmaster/coachman.md");

function blocksFrom(markdown: string): Array<{ indent: number; source: string }> {
  const lines = markdown.split("\n");
  const blocks: Array<{ indent: number; source: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^([ \t]*)```sh[ \t]*$/u.exec(lines[i] ?? "");
    if (!open) continue;
    const indent = open[1]!.length;
    const body: string[] = [];
    for (i++; i < lines.length && !/^[ \t]*```[ \t]*$/u.test(lines[i] ?? ""); i++) {
      const line = lines[i] ?? "";
      body.push(line.startsWith(" ".repeat(indent)) ? line.slice(indent) : line);
    }
    blocks.push({ indent, source: body.join("\n") });
  }
  return blocks;
}

function filled(source: string, root: string, tool: string): string {
  const replacements: Array<[string, string]> = [
    [
      '<the launch step of $LENS, for "$L" in "$DEST">',
      `${tool}/scripts/run launch launch "$L" "$DEST" BASE`,
    ],
    ["<tool>", tool],
    ["<dispatch>", join(root, "dispatch")],
    ["<repo>", join(root, "repo")],
    ["<workhorse-wt>", join(root, "repo", ".worktrees", "T-217-luna")],
    ["<synthesis-wt>", join(root, "repo", ".worktrees", "T-217-synthesis")],
    ["<lane>", "luna"],
    ["<harvested-head>", "harvested"],
    ["<base>", "base"],
    ["<BASE>", "BASE"],
    ["<round>", "4"],
    ["<TICKET>", "217"],
    ["<open lenses>", "bug security"],
    ["<lens>", "security"],
    ["<abs>", root],
  ];
  let out = source;
  for (const [placeholder, value] of replacements) out = out.replaceAll(placeholder, value);
  out = out.replace(/[ \t]+\[(--[^\]]+)\]/gu, "");
  return out.replace(/<[^>\n]+>/gu, "value");
}

function writeExecutable(path: string, source: string): void {
  writeFileSync(path, `#!/bin/sh\n${source}\n`);
  chmodSync(path, 0o755);
}

function stubBody(name: string): string {
  return [
    `printf '%s' ${JSON.stringify(name)} >> "$POSTMASTER_SHELL_TEST_LOG"`,
    'for arg do printf "\\t%s" "$arg" >> "$POSTMASTER_SHELL_TEST_LOG"; done',
    'printf "\\n" >> "$POSTMASTER_SHELL_TEST_LOG"',
  ].join("\n");
}

function entryBody(): string {
  return [
    stubBody("run"),
    'case "$1" in',
    '  "reviewers") if [ "$2" = lanes ]; then printf "luna\\nmimo\\n"; fi ;;',
    '  "review-round") if [ "$2" = wait ]; then :; fi ;;',
    '  "host") if [ "$2" = name ]; then printf "launch-label\\n"; fi ;;',
    '  "review-findings") if [ "$2" = normalize ]; then exit 1; fi ;;',
    '  "verify") printf "all checks passed\\n" ;;',
    '  "synthesis-shares") printf "SHARES: code runs=1 lane:luna=1/1 shared=0/1 neither=0/1\\n" ;;',
    "esac",
  ].join("\n");
}

function runBlock(source: string, shell: string): RunResult {
  const root = mkdtempSync(join(tmpdir(), "coachman-shell-"));
  const tool = join(root, "tool");
  const bin = join(root, "bin");
  const logs = join(root, "logs");
  const dispatch = join(root, "dispatch");
  mkdirSync(join(tool, "scripts"), { recursive: true });
  mkdirSync(bin);
  mkdirSync(join(dispatch, "logs"), { recursive: true });
  mkdirSync(join(root, "repo", ".worktrees", "T-217-luna"), { recursive: true });
  mkdirSync(join(root, "repo", ".worktrees", "T-217-synthesis"), { recursive: true });
  writeFileSync(logs, "");

  writeExecutable(join(tool, "scripts", "run"), entryBody());
  writeExecutable(
    join(bin, "git"),
    `${stubBody("git")}\nif [ "$1" = rev-parse ]; then printf "snapshot\\n"; fi\nexit 0`,
  );

  const script = filled(source, root, tool);
  try {
    const child = Bun.spawnSync([shell, "-c", script], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        POSTMASTER_SHELL_TEST_LOG: logs,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const calls = readFileSync(logs, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\t"));
    return { code: child.exitCode, calls };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("coachman shell blocks", () => {
  const blocks = blocksFrom(readFileSync(DOC, "utf8"));

  test("all twelve shell blocks have the same arguments and status in bash and zsh", () => {
    expect(blocks.length).toBe(12);
    const bash = Bun.which("bash");
    if (!bash) throw new Error("bash is not on PATH");
    const zsh = Bun.which("zsh");
    if (!zsh) console.log("zsh unavailable; shell comparison skipped");

    for (const [index, block] of blocks.entries()) {
      const bashResult = runBlock(block.source, bash);
      expect({ block: index + 1, calls: bashResult.calls, code: bashResult.code }).toEqual({
        block: index + 1,
        calls: bashResult.calls,
        code: 0,
      });
      if (zsh) expect(runBlock(block.source, zsh)).toEqual(bashResult);
    }

    const reviewers = runBlock(blocks[9]!.source, bash).calls;
    const cloneCall = reviewers.find(
      (args) => args[0] === "run" && args[1] === "cut-scratch" && args.includes("--clone"),
    );
    expect(cloneCall?.slice(-2)).toEqual(["--clone", "BASE"]);
    const wait = reviewers.find(
      (args) => args[0] === "run" && args[1] === "review-round" && args[2] === "wait",
    );
    expect(wait?.slice(6)).toEqual(["bug:luna", "bug:mimo", "security:luna", "security:mimo"]);

    const failedLaneLogs = runBlock(blocks[10]!.source, bash).calls.filter(
      (args) => args[0] === "run" && args[1] === "run-log" && args[3]?.includes("normalize failed"),
    );
    expect(failedLaneLogs.map((args) => args[3]?.split(" ")[3])).toEqual(["luna:", "mimo:"]);
  });

  test("the argument checks reject unquoted expansions of multword shell arrays", () => {
    const bash = Bun.which("bash");
    if (!bash) throw new Error("bash is not on PATH");
    const reviewBlock = blocks[9]!.source;
    const correct = runBlock(reviewBlock, bash);
    const cloneMutation = runBlock(reviewBlock.replaceAll('"${CLONE[@]}"', "$CLONE"), bash);
    const reviewerMutation = runBlock(
      reviewBlock.replaceAll('"${REVIEWERS[@]}"', "$REVIEWERS"),
      bash,
    );
    expect(cloneMutation.calls).not.toEqual(correct.calls);
    expect(reviewerMutation.calls).not.toEqual(correct.calls);

    const normalizeBlock = blocks[10]!.source;
    const normalized = runBlock(normalizeBlock, bash);
    const mutation = runBlock(
      normalizeBlock.replaceAll('"${NORMALIZE_FAILED[@]}"', "$NORMALIZE_FAILED"),
      bash,
    );
    expect(mutation.calls).not.toEqual(normalized.calls);
  });
});
