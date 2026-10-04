import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    const open = /^([ \t]*)```sh\s*$/u.exec(lines[i] ?? "");
    if (!open) continue;
    const indent = open[1]!.length;
    const body: string[] = [];
    for (i++; i < lines.length && !/^[ \t]*```\s*$/u.test(lines[i] ?? ""); i++) {
      const line = lines[i] ?? "";
      body.push(line.startsWith(" ".repeat(indent)) ? line.slice(indent) : line);
    }
    blocks.push({ indent, source: body.join("\n") });
  }
  return blocks;
}

function filled(source: string, root: string, tool: string): string {
  const replacements: Array<[string, string]> = [
    ['<the launch step of $LENS, for "$L" in "$DEST">', `${tool}/scripts/launch.sh launch "$L" "$DEST" BASE`],
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
  out = out.replace(/\s+\[(--[^\]]+)\]/gu, "");
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
    const cloneCall = reviewers.find((args) => args[0] === "cut-scratch.sh" && args.includes("--clone"));
    expect(cloneCall?.slice(-2)).toEqual(["--clone", "BASE"]);
    const wait = reviewers.find((args) => args[0] === "review-round.sh" && args[1] === "wait");
    expect(wait?.slice(5)).toEqual([
      "bug:luna",
      "bug:mimo",
      "security:luna",
      "security:mimo",
    ]);

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
    const reviewerMutation = runBlock(reviewBlock.replaceAll('"${REVIEWERS[@]}"', "$REVIEWERS"), bash);
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
