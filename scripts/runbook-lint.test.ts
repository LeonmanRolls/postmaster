import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  formatFinding,
  lintRunbooks,
  runCheck,
  runbookFiles,
  scanRunbook,
} from "./runbook-lint.ts";

const roots: string[] = [];
const fixture = (): string => {
  const root = mkdtempSync(join(tmpdir(), "runbook-lint-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("runbook-lint", () => {
  test("only script calls are accepted in shell blocks, including documented arguments", () => {
    const findings = scanRunbook(
      "skills/postmaster/example.md",
      [
        "```sh",
        "# comment",
        '<tool>/scripts/run front-door "<harness>" "<model>" "<cwd>" <yes|no> <target> \\',
        '  [--workaround "<what>"] # trailing comment',
        "<tool>/scripts/run host run <name> <cwd> -- <tool>/scripts/run runs-watch <runs>",
        "<tool>/scripts/run host spawn <handle> <cwd> -- <interactive form>",
        "```",
      ].join("\n"),
    );
    expect(findings).toEqual([]);
  });

  test("refuses non-script commands and every required shell syntax", () => {
    const commands = [
      "git -C <repo> worktree prune",
      "cat ~/.postmaster/config.toml",
      "bun test scripts/wiki-lint.test.ts",
      "cd <wt> && codex exec --json",
      "<tool>/scripts/run one $NAME",
      "<tool>/scripts/run one $(cat <file>)",
      "<tool>/scripts/run one `pwd`",
      "<tool>/scripts/run one | tail",
      "<tool>/scripts/run one > <file>",
      "<tool>/scripts/run one >> <file>",
      "<tool>/scripts/run one < <file>",
      "<tool>/scripts/run one 2>&1",
      "<tool>/scripts/run one <<EOF",
      "<tool>/scripts/run one && <tool>/scripts/run two",
      "<tool>/scripts/run one || <tool>/scripts/run two",
      "<tool>/scripts/run one; <tool>/scripts/run two",
      "<tool>/scripts/run one &",
      "for L in <lanes>; do",
      "if test -f <file>; then",
      "while test -f <file>; do",
      "case <value> in",
      "NAME=value <tool>/scripts/run one",
      '<tool>/scripts/run one "$?"',
      "<tool>/scripts/run one $1",
      "<tool>/scripts/run one 2>/dev/null",
      "<tool>/scripts/run one >file",
      "<tool>/scripts/run one&",
    ];
    const source = ["```sh", ...commands, "```"].join("\n");
    const findings = scanRunbook("skills/postmaster/example.md", source);
    expect(findings.map(({ line }) => line)).toEqual(commands.map((_, index) => index + 2));
    expect(findings.every(({ what }) => what.length > 0)).toBe(true);
    expect(findings.every((finding) => finding.command === commands[finding.line - 2])).toBe(true);
  });

  test("reports file, source line, finding and command in the gate format", () => {
    const finding = scanRunbook(
      "skills/postmaster/example.md",
      "```sh\n\n bun test scripts/check.test.ts\n```",
    )[0]!;
    expect(formatFinding(finding)).toBe(
      "skills/postmaster/example.md:3: not a call to scripts/run: bun test scripts/check.test.ts",
    );
    expect(scanRunbook("skills/postmaster/example.md", "`kill -- -$(cat <pidfile>)`")[0]).toEqual({
      file: "skills/postmaster/example.md",
      line: 1,
      what: "command substitution",
      command: "kill -- -$(cat <pidfile>)",
    });
    expect(
      scanRunbook("skills/postmaster/example.md", "```text\n`git status && git diff`\n```"),
    ).toEqual([
      {
        file: "skills/postmaster/example.md",
        line: 2,
        what: "command chain",
        command: "git status && git diff",
      },
    ]);
  });

  test("checks AGENTS.md and every skills Markdown file, and ignores other documents", () => {
    const root = fixture();
    const paths = [
      "AGENTS.md",
      "skills/postmaster/coachman.md",
      "skills/wiki/SKILL.md",
      "skills/review-pages/SKILL.md",
      "skills/new/nested/guide.md",
      "README.md",
      "lint/README.md",
      "wiki/page.md",
      "raw/trial.md",
      "fixtures/app/README.md",
    ];
    for (const path of paths) {
      const full = join(root, path);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, "```sh\ngit -C <repo> worktree prune\n```\n");
    }
    const docs = runbookFiles(root).map((path) => path.slice(root.length + 1));
    expect(docs).toEqual(paths.slice(0, 5).sort());
    expect(lintRunbooks(root).map(({ file }) => file)).toEqual(paths.slice(0, 5).sort());
  });

  test("text scans commands with shell syntax but leaves values and non-commands alone", () => {
    const findings = scanRunbook(
      "skills/postmaster/example.md",
      [
        "`git merge --no-ff <ticket-branch>`",
        "`gh auth login`",
        "`herdr agent start`",
        "`mkdir -p <dispatch>/logs`",
        "`git diff <BASE>...HEAD`",
        "`<tool>/scripts/run stage <dispatch> done postmaster`",
        "`git show 'literal $NAME && text'`",
        "`## [YYYY-MM-DD] ingest | <title>`",
        "`$CLAUDE_CONFIG_DIR/skills`",
        "`&lt;!--`",
        "`git diff <BASE>...HEAD && git status`",
        "`<gate> 2>&1 | tail && git commit`",
        "`view-stream < <events-file>`",
        "`ticket-check --splice <base> <sections> > <new>`",
      ].join("\n"),
    );
    expect(findings.map(({ line, what }) => [line, what])).toEqual([
      [11, "command chain"],
      [12, "command chain"],
      [13, "redirection"],
      [14, "redirection"],
    ]);
  });

  test("text commands refuse every shell form in C2", () => {
    const commands = [
      "git status $NAME",
      'git status "$TARGET"',
      "NAME=value git status",
      '"$TARGET" git status',
      "git status $(pwd)",
      "git status `pwd`",
      "git status | tail",
      "git show > <file>",
      "git show >> <file>",
      "git show < <file>",
      "git show 2>&1",
      "git show <<EOF",
      "git status && git diff",
      "git status || git diff",
      "git status; git diff",
      "git status &",
      "for lane in <lanes>; do",
      "while test -f <file>; do",
      "if test -f <file>; then",
      "case <value> in",
      "<tool>/scripts/run stage <dispatch> $TARGET",
      "git status $1",
      "git status $?",
      "git show 2>/dev/null",
      "git show >file",
      "git show&",
    ];
    const source = commands
      .map((command) => {
        const runs = [...command.matchAll(/`+/gu)].map((match) => match[0]!.length);
        const marker = "`".repeat(Math.max(0, ...runs) + 1);
        return `${marker}${command} ${marker}`;
      })
      .join("\n");
    const findings = scanRunbook("skills/postmaster/example.md", source);
    expect(findings.map(({ line }) => line)).toEqual(commands.map((_, index) => index + 1));
    expect(findings.map(({ what }) => what)).toEqual([
      "variable expansion",
      "variable expansion",
      "variable assignment",
      "variable expansion",
      "command substitution",
      "command substitution",
      "pipe",
      "redirection",
      "redirection",
      "redirection",
      "redirection",
      "redirection",
      "command chain",
      "command chain",
      "command chain",
      "background command",
      "loop or condition",
      "loop or condition",
      "loop or condition",
      "loop or condition",
      "variable expansion",
      "variable expansion",
      "variable expansion",
      "redirection",
      "redirection",
      "background command",
    ]);
    expect(
      findings.every((finding) =>
        /^skills\/postmaster\/example\.md:[0-9]+: [^:]+: /u.test(formatFinding(finding)),
      ),
    ).toBe(true);
  });

  test("reads precisely the current runbook set from the repository tree", () => {
    const root = fixture();
    mkdirSync(join(root, "skills", "one"), { recursive: true });
    mkdirSync(join(root, "wiki"), { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), "`git -C <repo> worktree prune`\n");
    writeFileSync(join(root, "skills", "one", "guide.md"), "`git -C <repo> worktree prune`\n");
    writeFileSync(join(root, "README.md"), "`git -C <repo> worktree prune`\n");
    writeFileSync(join(root, "wiki", "page.md"), "`git -C <repo> worktree prune`\n");
    expect(lintRunbooks(root)).toEqual([]);
    expect(runbookFiles(root)).toHaveLength(2);
  });

  test("the check prints each refusal and exits 1, then exits 0 silently when clear", () => {
    const root = fixture();
    writeFileSync(
      join(root, "AGENTS.md"),
      "```sh\ngit -C <repo> worktree prune\n```\n\n`git status && git diff`\n",
    );
    const output: string[] = [];
    expect(runCheck(root, (line) => output.push(line))).toBe(1);
    expect(output).toEqual([
      "AGENTS.md:2: not a call to scripts/run: git -C <repo> worktree prune",
      "AGENTS.md:5: command chain: git status && git diff",
    ]);
    writeFileSync(join(root, "AGENTS.md"), "```sh\nscripts/run stage <dispatch> done\n```\n");
    output.length = 0;
    expect(runCheck(root, (line) => output.push(line))).toBe(0);
    expect(output).toEqual([]);
  });
});
