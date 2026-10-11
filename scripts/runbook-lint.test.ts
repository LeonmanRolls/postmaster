// Tests beside scripts/runbook-lint.ts: the gate step that refuses code in the runbooks.
// Controls plant one line in a scratch copy of a file the check reads, or write a fixture
// tree of its own; nothing is planted in the worktree.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codeFaults, runbookLint, runbookFiles, shellSyntax } from "./runbook-lint";

let tmp = "";

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "runbook-lint-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const block = (line: string): string => "```sh\n" + line + "\n```\n";
const faultsIn = (
  text: string,
  file = "skills/postmaster/coachman.md",
): ReturnType<typeof codeFaults> => codeFaults(file, text);

describe("step lines in a code block", () => {
  const refused = [
    ["git -C <repo> worktree prune", "not a scripts/run call"],
    ["cat ~/.postmaster/config.toml", "not a scripts/run call"],
    ["bun test scripts/wiki-lint.test.ts", "not a scripts/run call"],
    ["cd <wt> && codex exec --json", "chain"],
    ["git -C <repo> worktree prune  # prune it", "not a scripts/run call"],
    ["<tool>/scripts/run host run x -- rm -rf /tmp/y", "not a scripts/run call after --"],
    ["<tool>/scripts/run host run x --", "double dash without a command"],
    ["<tool>/scripts/run host run x -- scripts/run y", "bare scripts/run after --"],
  ] as const;
  for (const [line, what] of refused) {
    test(`refuses ${line}`, () => {
      const faults = faultsIn(block(line));
      expect(faults.length).toBe(1);
      expect(faults[0]?.what).toBe(what);
      expect(faults[0]?.line).toBe(2);
      expect(faults[0]?.ref).toBe(line.replace(/[ \t\n\r\f\v]+/gu, " "));
    });
  }

  const accepted = [
    '<tool>/scripts/run front-door "<harness>" "<model>" "<cwd>" <yes|no> <target>',
    '<tool>/scripts/run log-action <dispatch> coachman tool-fault <file> --ran <what> \\\n  --failed <what> [--workaround "<what>"] [--control <kind>]',
    '<tool>/scripts/run host run "watch · <project>" <repo> --out <file> -- \\\n  <tool>/scripts/run runs-watch <runs>',
    '<tool>/scripts/run host run "watch · <project>" <repo> -- <tool>/scripts/run runs-watch <runs>',
    "<tool>/scripts/run host spawn <handle> <cwd> --label <name> -- <interactive form>",
    "<tool>/scripts/run host run x -- <command>",
    '<tool>/scripts/run host run "w" "<r>" --out "o" --err "e" --marker "m" -- "<tool>/scripts/run" runs-watch "<runs>"',
    "<tool>/scripts/run verify run . --format=json",
    "<tool>/scripts/run stage <dispatch> synthesis  # use -- force here",
    "<tool>/scripts/run run-meta run-pinned <dispatch> host leg launch <dispatch> <wt> <leg> <n> <prompt>",
    "<tool>/scripts/run stage <dispatch> synthesis  # the stage the leg opens",
    "<tool>/scripts/run wiki-lint      # faults on stdout, exit 1 if any",
    "# a comment, with anything in it: for x in y; do echo $x; done",
    "",
    "   ",
  ];
  for (const line of accepted) {
    test(`accepts ${JSON.stringify(line).slice(0, 70)}`, () => {
      expect(faultsIn(block(line))).toEqual([]);
    });
  }

  test("a continuation joins and is checked as one line at its first", () => {
    const text =
      "```sh\n<tool>/scripts/run launch launch <lane> <wt> <prompt> \\\n  --run <dispatch>\n```\n";
    expect(faultsIn(text)).toEqual([]);
    const bad = "```sh\n<tool>/scripts/run x <a> \\\n  | tee <b>\n```\n";
    const faults = faultsIn(bad);
    expect(faults.length).toBe(1);
    expect(faults[0]?.line).toBe(2);
    expect(faults[0]?.what).toBe("pipe");
  });

  test("bare scripts/run is accepted only in AGENTS.md", () => {
    expect(faultsIn(block("scripts/run link-skills --check"), "AGENTS.md")).toEqual([]);
    const faults = faultsIn(block("scripts/run link-skills --check"));
    expect(faults[0]?.what).toBe("bare scripts/run");
  });

  test("a nested AGENTS.md is a skill document, not the root file", () => {
    const faults = faultsIn(
      block("scripts/run link-skills --check"),
      "skills/postmaster/AGENTS.md",
    );
    expect(faults[0]?.what).toBe("bare scripts/run");
  });

  test("a block in another language is read like the text", () => {
    const text = "```markdown\nrun `git log | head` here\n```\n";
    const faults = faultsIn(text);
    expect(faults.length).toBe(1);
    expect(faults[0]?.what).toBe("pipe");
  });
});

describe("shell syntax", () => {
  const cases = [
    ["$NAME", "variable"],
    ['"$TARGET"', "variable"],
    ["NAME=value cmd", "variable"],
    ["$(date)", "command substitution"],
    ["`date`", "command substitution"],
    ["a | b", "pipe"],
    ["a > b", "redirection"],
    ["a >> b", "redirection"],
    ["a < b", "redirection"],
    ["a 2>&1", "redirection"],
    ["a && b", "chain"],
    ["a || b", "chain"],
    ["a; b", "chain"],
    ["sleep 5 &", "background"],
    ["for f in a; do echo; done", "loop or condition"],
    ["while true; do echo; done", "loop or condition"],
    ["if [ -f a ]; then echo; fi", "loop or condition"],
    ["case x in y) ;; esac", "loop or condition"],
  ] as const;
  for (const [line, kind] of cases) {
    test(`finds ${kind} in ${line}`, () => {
      expect(shellSyntax(line)?.kind).toBe(kind);
    });
    test(`refuses ${line} planted alone in a block`, () => {
      const faults = faultsIn(block(line));
      expect(faults.length).toBe(1);
      expect(faults[0]?.what).toBe(kind);
    });
    test(`refuses ${line} planted on a script call in a block`, () => {
      const faults = faultsIn(block(`<tool>/scripts/run run-log <dispatch> ${line}`));
      expect(faults.length).toBe(1);
      expect(faults[0]?.what).toBe(kind);
    });
  }

  const textCommands = [
    "echo $NAME",
    'git show "$TARGET"',
    "NAME=value env",
    "echo $(date)",
    "echo `date`",
    "git log | head",
    "echo hi > out",
    "echo hi >> out",
    "cat < in",
    "echo hi 2>&1",
    "git commit && git push",
    "git commit || true",
    "git commit; git push",
    "sleep 5 &",
    "for f in a; do echo; done",
    "while true; do echo; done",
    "if test -f a; then echo; fi",
    "case x in y) ;; esac",
  ];
  for (const cmd of textCommands) {
    test(`refuses the text command ${cmd}`, () => {
      const faults = faultsIn(`Run \`\`${cmd}\`\` here.`);
      expect(faults.length).toBe(1);
      expect(faults[0]?.what).toBeTruthy();
      expect(faults[0]?.ref).toBe(cmd);
    });
  }

  const textOk = [
    "git merge --no-ff <ticket-branch>",
    "gh auth login",
    "herdr agent start",
    "mkdir -p <dispatch>/logs",
    "git diff <BASE>...HEAD",
    "<tool>/scripts/run stage <dispatch> done postmaster",
    "## [YYYY-MM-DD] ingest | <title>",
    "$CLAUDE_CONFIG_DIR/skills",
    "&lt;!--",
    "approved 0 1",
    "done",
    "tmux display-message -p '#S'",
    "kill -- -<pid>",
    'codex -m <model> -c model_reasoning_effort="<effort>" --dangerously-bypass-approvals-and-sandbox',
    "<tool>/scripts/run turnpikes short '<the waybill's turnpikes: line>'",
  ];
  for (const cmd of textOk) {
    test(`accepts the span ${cmd.slice(0, 60)}`, () => {
      expect(faultsIn(`Use \`${cmd}\` here.`)).toEqual([]);
    });
  }

  test("a variable on a script call in the block is refused", () => {
    const faults = faultsIn(block('<tool>/scripts/run check-target "$TARGET"'));
    expect(faults.length).toBe(1);
    expect(faults[0]?.what).toBe("variable");
  });

  test("a pipe on a script call in the block is refused", () => {
    const faults = faultsIn(block("<tool>/scripts/run run-log <dispatch> x | tee <file>"));
    expect(faults[0]?.what).toBe("pipe");
  });

  test("a here-document in the block is refused", () => {
    const faults = faultsIn(block("cat > <file> <<'EOF'\nbody\nEOF"));
    expect(faults[0]?.what).toBe("redirection");
  });
});

describe("the report", () => {
  test("one line per fault, <file>:<line>: <what>: <command>", () => {
    const text = "```sh\ncat x\n```\nRun `git log | head`.\n";
    const faults = faultsIn(text, "skills/postmaster/coachman.md");
    expect(faults.length).toBe(2);
    expect(`${faults[0]?.file}:${faults[0]?.line}: ${faults[0]?.what}: ${faults[0]?.ref}`).toBe(
      "skills/postmaster/coachman.md:2: not a scripts/run call: cat x",
    );
    expect(`${faults[1]?.file}:${faults[1]?.line}: ${faults[1]?.what}: ${faults[1]?.ref}`).toBe(
      "skills/postmaster/coachman.md:4: pipe: git log | head",
    );
  });

  test("a clean document has no faults", () => {
    expect(
      faultsIn(
        "# Title\n\nUse `<tool>/scripts/run stage <d> bootstrapped`.\n\n```sh\n<tool>/scripts/run stage <d> bootstrapped\n```\n",
      ),
    ).toEqual([]);
  });
});

describe("the files it reads", () => {
  test("AGENTS.md and every .md under skills/, nothing else", () => {
    const root = join(tmp, "root1");
    mkdirSync(root, { recursive: true });
    for (const rel of [
      "AGENTS.md",
      "CLAUDE.md",
      "README.md",
      "lint/README.md",
      "wiki/index.md",
      "raw/runs/x.md",
      "fixtures/app/README.md",
      "skills/postmaster/coachman.md",
      "skills/wiki/SKILL.md",
      "skills/review-pages/SKILL.md",
      "skills/fresh/SKILL.md",
      "skills/fresh/how-to.md",
      "skills/postmaster/notes.txt",
    ]) {
      const path = join(root, rel);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, "# fixture\n");
    }
    const files = runbookFiles(root);
    expect(files).toEqual([
      "AGENTS.md",
      "skills/fresh/SKILL.md",
      "skills/fresh/how-to.md",
      "skills/postmaster/coachman.md",
      "skills/review-pages/SKILL.md",
      "skills/wiki/SKILL.md",
    ]);
  });

  test("the same planted line and text command are refused in every runbook it reads", () => {
    for (const rel of [
      "AGENTS.md",
      "skills/postmaster/coachman.md",
      "skills/wiki/SKILL.md",
      "skills/review-pages/SKILL.md",
      "skills/new-skill/file.md",
    ]) {
      const root = join(tmp, `plant-${rel.replaceAll("/", "-")}`);
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, "README.md"), "```sh\ncat x\n```\nRun `git log | head`.\n");
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), "Run `git log | head`.\n\n```sh\ncat x\n```\n");
      const { faults, code } = runbookLint(root);
      expect(code).toBe(1);
      expect(faults.length).toBe(2);
      expect(faults.map((f) => f.file).sort()).toEqual([rel, rel]);
    }
  });

  test("a plant in the README, the wiki, raw/ or the fixture app is not read", () => {
    const root = join(tmp, "root2");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), "# agents\n");
    mkdirSync(join(root, "skills", "s"), { recursive: true });
    writeFileSync(join(root, "skills", "s", "SKILL.md"), "# s\n");
    for (const rel of [
      "README.md",
      "lint/README.md",
      "wiki/page.md",
      "raw/x.md",
      "fixtures/app/README.md",
    ]) {
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), "```sh\ncat x\n```\nRun `git log | head`.\n");
      expect(runbookLint(root).code).toBe(0);
    }
  });

  test("an unreadable file exits 2", () => {
    expect(runbookLint(tmp, [join(tmp, "nowhere.md")]).code).toBe(2);
  });

  test("explicit files keep the root exception by path, not by basename", () => {
    const root = join(tmp, "root-explicit");
    mkdirSync(join(root, "skills", "postmaster"), { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), block("scripts/run link-skills --check"));
    writeFileSync(
      join(root, "skills", "postmaster", "AGENTS.md"),
      block("scripts/run link-skills --check"),
    );
    expect(runbookLint(root, [join(root, "AGENTS.md")]).code).toBe(0);
    const nested = runbookLint(root, [join(root, "skills", "postmaster", "AGENTS.md")]);
    expect(nested.code).toBe(1);
    expect(nested.faults[0]?.what).toBe("bare scripts/run");
    expect(nested.faults[0]?.file).toBe(join(root, "skills", "postmaster", "AGENTS.md"));
  });
});
