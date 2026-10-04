// Tests beside scripts/skill-refs.ts, moved from its --self-test on #109: 10 controls.
// The coachman's shell blocks are also compared across bash and zsh here.
// Each --fix control uses its own file instead of sharing one file in order.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
type RunResult = Readonly<{ code: number; calls: string[][] }>;

const DOC = join(import.meta.dir, "../skills/postmaster/coachman.md");
const SCRIPT_NAMES = [
  "cut-scratch.sh",
  "host.sh",
  "launch.sh",
  "log-action.sh",
  "review-findings.sh",
  "review-round.sh",
  "reviewers.sh",
  "run-log.sh",
  "synthesis-shares.ts",
  "verify.sh",
];

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
      `${tool}/scripts/launch.sh launch "$L" "$DEST" BASE`,
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
    `case ${JSON.stringify(name)} in`,
    '  "reviewers.sh") if [ "$1" = lanes ]; then printf "luna\\nmimo\\n"; fi ;;',
    '  "review-round.sh") if [ "$1" = wait ]; then :; fi ;;',
    '  "host.sh") if [ "$1" = name ]; then printf "launch-label\\n"; fi ;;',
    '  "review-findings.sh") if [ "$1" = normalize ]; then exit 1; fi ;;',
    '  "verify.sh") printf "all checks passed\\n" ;;',
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

  for (const name of SCRIPT_NAMES) {
    const path = join(tool, "scripts", name);
    if (name === "synthesis-shares.ts") {
      writeExecutable(path, stubBody(name));
      continue;
    }
    writeExecutable(path, stubBody(name));
  }
  const fakeBun = join(bin, "bun");
  writeExecutable(
    fakeBun,
    `${stubBody("bun")}\nprintf "SHARES: code runs=1 lane:luna=1/1 shared=0/1 neither=0/1\\n"\nexit 0`,
  );
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

  test("all ten shell blocks have the same arguments and status in bash and zsh", () => {
    expect(blocks.length).toBe(10);
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

    const reviewers = runBlock(blocks[7]!.source, bash).calls;
    const cloneCall = reviewers.find(
      (args) => args[0] === "cut-scratch.sh" && args.includes("--clone"),
    );
    expect(cloneCall?.slice(-2)).toEqual(["--clone", "BASE"]);
    const wait = reviewers.find((args) => args[0] === "review-round.sh" && args[1] === "wait");
    expect(wait?.slice(5)).toEqual(["bug:luna", "bug:mimo", "security:luna", "security:mimo"]);

    const failedLaneLogs = runBlock(blocks[8]!.source, bash).calls.filter(
      (args) => args[0] === "run-log.sh" && args[2]?.includes("normalize failed"),
    );
    expect(failedLaneLogs.map((args) => args[2]?.split(" ")[3])).toEqual(["luna:", "mimo:"]);
  });

  test("the argument checks reject unquoted expansions of multword shell arrays", () => {
    const bash = Bun.which("bash");
    if (!bash) throw new Error("bash is not on PATH");
    const reviewBlock = blocks[7]!.source;
    const correct = runBlock(reviewBlock, bash);
    const cloneMutation = runBlock(reviewBlock.replaceAll('"${CLONE[@]}"', "$CLONE"), bash);
    const reviewerMutation = runBlock(
      reviewBlock.replaceAll('"${REVIEWERS[@]}"', "$REVIEWERS"),
      bash,
    );
    expect(cloneMutation.calls).not.toEqual(correct.calls);
    expect(reviewerMutation.calls).not.toEqual(correct.calls);

    const normalizeBlock = blocks[8]!.source;
    const normalized = runBlock(normalizeBlock, bash);
    const mutation = runBlock(
      normalizeBlock.replaceAll('"${NORMALIZE_FAILED[@]}"', "$NORMALIZE_FAILED"),
      bash,
    );
    expect(mutation.calls).not.toEqual(normalized.calls);
  });
});
