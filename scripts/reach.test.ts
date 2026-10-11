// Controls for ticket #202. Each control gets a fresh run layout: a main checkout,
// the run's synthesis and lane worktrees, review scratches, records and a private HOME.
import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";
import { toolRoot } from "./lib/paths.ts";

const TOOL = toolRoot(import.meta);
const RUN = join(import.meta.dir, "run");
const CREATED: string[] = [];

interface Layout {
  root: string;
  repo: string;
  dispatch: string;
  home: string;
  bare: string;
  base: string;
  synth: string;
  codex: string;
  mimo: string;
  reviewers: { codex: string; mimo: string };
}

afterEach(() => {
  for (const path of CREATED.splice(0)) rmSync(path, { recursive: true, force: true });
});

function command(cmd: string, args: string[], cwd?: string): string {
  const result = run(cmd, args, cwd ? { cwd } : {});
  if (result.code !== 0)
    throw new Error(`${cmd} ${args.join(" ")} failed (${result.code}): ${result.err}${result.out}`);
  return result.out.trim();
}

function git(repo: string, ...args: string[]): string {
  return command("git", ["-C", repo, ...args]);
}

function makeLayout(): Layout {
  // Real once: where the temp folder is a link (macOS /var), every path
  // the layout builds must already be real, as the tool reports them.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "postmaster-reach-")));
  CREATED.push(root);
  const repo = join(root, "repo");
  const bare = join(root, "origin.git");
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  command("git", ["init", "-q", "-b", "main", repo]);
  git(repo, "config", "user.name", "Reach Test");
  git(repo, "config", "user.email", "reach@example.test");
  git(repo, "config", "commit.gpgsign", "false");
  mkdirSync(join(repo, ".git", "info"), { recursive: true });
  writeFileSync(join(repo, ".git", "info", "exclude"), ".postmaster/\n.worktrees/\n");
  writeFileSync(join(repo, "README.md"), "reach fixture\n");
  git(repo, "add", "README.md");
  git(repo, "commit", "-qm", "Base");
  const base = git(repo, "rev-parse", "HEAD");
  command("git", ["init", "--bare", "-q", bare]);
  git(repo, "remote", "add", "origin", bare);
  git(repo, "push", "-q", "origin", "main:main");
  const tree = git(repo, "rev-parse", `${base}^{tree}`);
  const future = command("git", [
    "-C",
    repo,
    "commit-tree",
    tree,
    "-p",
    base,
    "-m",
    "Remote moves",
  ]);
  git(repo, "update-ref", "refs/heads/remote-tip", future);
  git(repo, "push", "-q", "origin", "refs/heads/remote-tip:refs/heads/main");
  git(repo, "update-ref", "refs/remotes/origin/main", base);
  git(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");

  const worktrees = join(repo, ".worktrees");
  mkdirSync(worktrees, { recursive: true });
  const ticket = "T";
  const synth = join(worktrees, ticket);
  const codex = join(worktrees, `${ticket}-codex`);
  const mimo = join(worktrees, `${ticket}-mimo`);
  const reviewers = {
    codex: join(worktrees, `${ticket}-rev-bug-codex`),
    mimo: join(worktrees, `${ticket}-rev-bug-mimo`),
  };
  git(repo, "worktree", "add", "-q", "-b", ticket, synth, "main");
  git(repo, "worktree", "add", "-q", "-b", "wb/T-codex", codex, "main");
  git(repo, "worktree", "add", "-q", "-b", "wb/T-mimo", mimo, "main");
  git(repo, "worktree", "add", "-q", "--detach", reviewers.codex, "T");
  git(repo, "worktree", "add", "-q", "--detach", reviewers.mimo, "T");

  const dispatch = join(repo, ".postmaster", "runs", ticket);
  mkdirSync(join(dispatch, "logs"), { recursive: true });
  writeFileSync(
    join(dispatch, "run.json"),
    `${JSON.stringify(
      {
        target: { branch: "main", head: base },
        postmaster: { checkout: TOOL, commit: "fixture" },
        config: {
          lanes: {
            codex: { harness: "codex" },
            claude: { harness: "claude" },
            muse: { harness: "muse" },
            mimo: { harness: "mimo" },
            pi: { harness: "pi" },
            grok: { harness: "grok" },
          },
          team: { workhorses: ["codex", "mimo"] },
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(dispatch, "manifest.json"),
    JSON.stringify({ lanes: { codex: {}, mimo: {} }, leg: 2 }) + "\n",
  );
  writeFileSync(
    join(dispatch, "brief.md"),
    `# Waybill: T\nturnpikes: bug\n\n## Ticket\n\nA reach check.\n\n## Project profile\nrepo: ${repo} default branch: main BASE: ${base}\n`,
  );
  writeFileSync(
    join(dispatch, "logs", "review-r1.json"),
    JSON.stringify({
      reviewers: [
        ["bug", "codex"],
        ["bug", "mimo"],
      ],
    }) + "\n",
  );
  const layout = { root, repo, dispatch, home, bare, base, synth, codex, mimo, reviewers };
  cleanEvents(layout);
  return layout;
}

function codex(commandText: string, output = "", exit = 0): Record<string, unknown> {
  return {
    type: "item.completed",
    item: {
      type: "command_execution",
      command: `/bin/bash -lc '${commandText}'`,
      aggregated_output: output,
      exit_code: exit,
    },
  };
}

function codexFile(path: string): Record<string, unknown> {
  return {
    type: "item.completed",
    item: { type: "file_change", changes: [{ path, kind: "add" }] },
  };
}

function claude(
  name: string,
  input: Record<string, unknown>,
  output = "",
  isError = false,
): Record<string, unknown>[] {
  const id = `tool-${Math.random().toString(16).slice(2)}`;
  return [
    { type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } },
    {
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: id, content: output, is_error: isError }],
      },
    },
  ];
}

function mimo(
  name: string,
  input: Record<string, unknown>,
  output = "",
  exit = 0,
): Record<string, unknown> {
  return {
    type: "tool_use",
    sessionID: "s1",
    part: {
      type: "tool",
      tool: name,
      state: { status: exit === 0 ? "completed" : "error", input, output, metadata: { exit } },
    },
  };
}

function pi(
  name: string,
  args: Record<string, unknown>,
  output = "",
  isError = false,
): Record<string, unknown>[] {
  const id = `call-${Math.random().toString(16).slice(2)}`;
  return [
    { type: "tool_execution_start", toolCallId: id, toolName: name, args },
    { type: "tool_execution_end", toolCallId: id, toolName: name, result: output, isError },
  ];
}

function muse(
  name: string,
  facts: Record<string, unknown>,
  text = "",
  outcome = "success",
): Record<string, unknown> {
  return {
    payload_type: "tool.result",
    payload: { correlation_facts: { tool_name: name, outcome }, edit_facts: facts, text },
  };
}

function writeEvents(path: string, events: unknown[]): void {
  writeFileSync(path, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

function writeWorkhorse(layout: Layout, lane: "codex" | "mimo", events: unknown[]): string {
  const path = join(layout.dispatch, "logs", `${lane}-events.jsonl`);
  writeEvents(path, events);
  return path;
}

function writeReviewer(
  layout: Layout,
  lane: "codex" | "mimo",
  events: unknown[],
  round = 1,
): string {
  const path = join(layout.dispatch, "logs", `review-r${round}-bug-${lane}.jsonl`);
  writeEvents(path, events);
  return path;
}

function cleanEvents(layout: Layout): void {
  writeWorkhorse(layout, "codex", [codex(`touch ${layout.codex}/in.txt`)]);
  writeWorkhorse(layout, "mimo", [mimo("write_file", { path: join(layout.mimo, "in.txt") })]);
  writeReviewer(layout, "codex", [codex(`touch ${layout.reviewers.codex}/probe.txt`)]);
  writeReviewer(layout, "mimo", [
    mimo("write_file", { path: join(layout.reviewers.mimo, "probe.txt") }),
  ]);
}

function call(layout: Layout, args: string[]): { code: number; out: string } {
  const result = run("bash", [RUN, "reach", ...args], {
    env: { HOME: layout.home },
  });
  return { code: result.code, out: `${result.out}${result.err}` };
}

function check(layout: Layout, point: string): { code: number; out: string } {
  return call(layout, ["check", layout.dispatch, point]);
}

function before(layout: Layout, round = 1): { code: number; out: string } {
  return call(layout, ["before", layout.dispatch, String(round)]);
}

function stream(
  layout: Layout,
  lane: string,
  eventPath: string,
  ownFolder: string,
): { code: number; out: string } {
  return call(layout, ["stream", layout.dispatch, lane, eventPath, ownFolder]);
}

function actionLines(layout: Layout): Array<Record<string, unknown>> {
  const path = join(layout.dispatch, "actions.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function reachEvents(
  layout: Layout,
): Array<{ action: Record<string, unknown>; detail: Record<string, unknown> }> {
  return actionLines(layout)
    .filter((action) => action.action === "reach")
    .map((action) => ({
      action,
      detail: JSON.parse(String(action.detail)) as Record<string, unknown>,
    }));
}

function addCommit(
  repo: string,
  folder: string,
  file: string,
  content = "review change\n",
): string {
  writeFileSync(join(folder, file), content);
  git(repo, "-C", folder, "add", file);
  git(repo, "-C", folder, "commit", "-qm", "Review change");
  return git(repo, "-C", folder, "rev-parse", "HEAD");
}

function writeAction(
  layout: Layout,
  actor: string,
  action: string,
  target: string,
  detail: string,
): void {
  const result = run("bash", [RUN, "log-action", layout.dispatch, actor, action, target, detail]);
  if (result.code !== 0) throw new Error(`log action failed: ${result.err}`);
}

describe("C1-C2: point checks and audit records", () => {
  test("C1 clean workhorse, review and card points pass", () => {
    const layout = makeLayout();
    expect(check(layout, "workhorses").code).toBe(0);
    expect(before(layout).code).toBe(0);
    expect(check(layout, "r1").code).toBe(0);
    expect(check(layout, "card").code).toBe(0);
  });

  test("C2 each point is logged, including clean points, notes and findings", () => {
    const layout = makeLayout();
    const out = join(layout.repo, "out.txt");
    writeFileSync(out, "reached\n");
    writeWorkhorse(layout, "codex", [codexFile(out)]);
    check(layout, "workhorses");
    before(layout);
    const commit = addCommit(layout.repo, layout.reviewers.mimo, "reviewed.txt");
    git(layout.repo, "-C", layout.synth, "merge", "--ff-only", commit);
    writeReviewer(layout, "mimo", [
      mimo("bash", { command: `git -C ${layout.synth} merge --ff-only ${commit}` }),
    ]);
    check(layout, "r1");
    check(layout, "card");
    const events = reachEvents(layout);
    expect(
      events.filter(({ detail }) => detail.kind === "point").map(({ detail }) => detail.point),
    ).toEqual(["workhorses", "r1", "card"]);
    expect(events.some(({ detail }) => detail.kind === "note" && detail.path === out)).toBe(true);
    expect(
      events.some(
        ({ detail }) =>
          detail.kind === "finding" && detail.point === "r1" && detail.path === "refs/heads/T",
      ),
    ).toBe(true);
  });
});

describe("C3-C4: main checkout reach", () => {
  test("C3 every changed and new path is listed, with nested files expanded, without fetching", () => {
    const layout = makeLayout();
    for (let i = 0; i < 24; i++) writeFileSync(join(layout.repo, `untracked-${i}.txt`), "new\n");
    mkdirSync(join(layout.repo, "probe"));
    writeFileSync(join(layout.repo, "probe", "a.txt"), "new\n");
    writeFileSync(join(layout.repo, "README.md"), "tracked change\n");
    const remoteBefore = git(layout.repo, "rev-parse", "refs/remotes/origin/main");
    before(layout);
    const workhorses = check(layout, "workhorses");
    const round = check(layout, "r1");
    const card = check(layout, "card");
    for (const result of [workhorses, round, card]) {
      expect(result.code).toBe(2);
      expect(result.out).toContain("probe/a.txt");
      for (let i = 0; i < 24; i++) expect(result.out).toContain(`untracked-${i}.txt`);
      expect(result.out).toContain("README.md");
      expect(result.out).not.toContain("?? probe/");
    }
    expect(git(layout.repo, "rev-parse", "refs/remotes/origin/main")).toBe(remoteBefore);
  });

  test("C4a a branch other than the default is reported", () => {
    const layout = makeLayout();
    git(layout.repo, "checkout", "-qb", "x");
    const result = run("bash", [RUN, "check-target", "reach", layout.repo, "main"]);
    expect(result.code).toBe(2);
    expect(result.out).toContain("off-default x (default is main)");
  });

  test("C4b the default branch can move forward while clean", () => {
    const layout = makeLayout();
    writeFileSync(join(layout.repo, "advanced.txt"), "forward\n");
    git(layout.repo, "add", "advanced.txt");
    git(layout.repo, "commit", "-qm", "Advance default branch");
    const result = check(layout, "workhorses");
    expect(result.code).toBe(0);
    expect(result.out).toContain("workhorses: clean");
  });
});

describe("C5: stream readers and path mentions", () => {
  const cases = ["codex", "claude", "muse", "mimo", "pi"] as const;
  for (const harness of cases) {
    test(`C5 ${harness} stream notes outside paths once and never finds`, () => {
      const layout = makeLayout();
      const other = join(layout.repo, ".worktrees", "T-mimo", "a.ts");
      const homeFile = join(layout.home, "n.txt");
      writeFileSync(homeFile, "home read\n");
      mkdirSync(join(layout.repo, ".worktrees", "T-mimo"), { recursive: true });
      writeFileSync(other, "other lane\n");
      const shell = `cat ${homeFile}; cat ${other}; cat ${other}; echo x > ${other}; git -C ${layout.synth} log -1; git -C ${layout.synth} config --get core.bare; echo tmp > /tmp/x; cat /tmp/x >/dev/null; bun test; touch ${join(layout.codex, "in.txt")}`;
      let events: unknown[];
      if (harness === "codex") {
        events = [
          codexFile(join(layout.repo, "out.txt")),
          codexFile(other),
          codex(shell),
          codexFile(join(layout.codex, "in.txt")),
        ];
      } else if (harness === "claude") {
        events = [
          ...claude("Write", { file_path: join(layout.repo, "out.txt"), content: "out" }),
          ...claude("Read", { file_path: other }),
          ...claude("Edit", { file_path: other, old_string: "x", new_string: "y" }),
          ...claude("Bash", { command: shell }),
          ...claude("Write", { file_path: join(layout.codex, "in.txt"), content: "in" }),
        ];
      } else if (harness === "muse") {
        events = [
          muse("write_file", { path: join(layout.repo, "out.txt") }),
          muse("read_file", { path: other }),
          muse("edit_file", { path: other }),
          muse("bash", { command: shell }),
          muse("write_file", { path: join(layout.codex, "in.txt") }),
        ];
      } else if (harness === "mimo") {
        events = [
          mimo("write_file", { path: join(layout.repo, "out.txt") }),
          mimo("read_file", { path: other }),
          mimo("edit_file", { path: other }),
          mimo("bash", { command: shell }),
          mimo("write_file", { path: join(layout.codex, "in.txt") }),
        ];
      } else {
        events = [
          ...pi("write", { path: join(layout.repo, "out.txt") }),
          ...pi("read", { path: other }),
          ...pi("edit", { path: other }),
          ...pi("bash", { command: shell }),
          ...pi("write", { path: join(layout.codex, "in.txt") }),
        ];
      }
      const eventsPath = join(layout.dispatch, "logs", `${harness}-direct.jsonl`);
      writeEvents(eventsPath, events);
      const result = stream(layout, harness, eventsPath, layout.codex);
      expect(result.code).toBe(3);
      expect(result.out).toContain(`note names ${join(layout.repo, "out.txt")} (main checkout)`);
      expect(result.out).toContain(`note names ${other} (another worktree)`);
      expect(result.out).toContain(`note names ${homeFile} (elsewhere)`);
      expect(result.out).toContain(`note names ${layout.synth} (synthesis worktree)`);
      expect(
        result.out.match(new RegExp(other.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "gu"))?.length,
      ).toBe(1);
      expect(result.out).toContain(`expected names ${join(layout.codex, "in.txt")}`);
      // No routine exemption: the temp folder is named like any outside path. The tool
      // reports the path as the filesystem resolves it, so the expectation resolves
      // the temp folder the same way (/tmp is a link to /private/tmp on macOS).
      expect(result.out).toContain(`note names ${join(realpathSync("/tmp"), "x")} (elsewhere)`);
      expect(result.out).toContain("note names /dev/null (elsewhere)");
      expect(result.out).not.toContain("finding");
      expect(result.out).not.toContain("not checked");
    });
  }

  test("C5 a Claude Code forked task file supplies tool calls absent from the lane stream", () => {
    const layout = makeLayout();
    const path = join(layout.repo, "forked.txt");
    writeEvents(join(layout.dispatch, "logs", "review-r1-bug-codex.jsonl"), [
      {
        type: "system",
        subtype: "task_notification",
        output_file: join(layout.home, "task.jsonl"),
      },
    ]);
    writeEvents(
      join(layout.dispatch, "logs", "review-r1-bug-codex-claude-task-01-task.jsonl"),
      claude("Write", { file_path: path }),
    );
    const runJson = JSON.parse(readFileSync(join(layout.dispatch, "run.json"), "utf8"));
    runJson.config.lanes.codex.harness = "claude";
    writeFileSync(join(layout.dispatch, "run.json"), JSON.stringify(runJson));
    const result = stream(
      layout,
      "codex",
      join(layout.dispatch, "logs", "review-r1-bug-codex.jsonl"),
      layout.reviewers.codex,
    );
    expect(result.code).toBe(3);
    expect(result.out).toContain(`note names ${path} (main checkout)`);
    expect(result.out).not.toContain("finding");
  });

  test("C5 unsupported, unreadable and empty records are not checked", () => {
    const layout = makeLayout();
    const grok = join(layout.dispatch, "logs", "grok.jsonl");
    writeEvents(grok, [codex("touch /tmp/x")]);
    expect(stream(layout, "grok", grok, layout.codex).code).toBe(3);
    const unreadable = join(layout.dispatch, "logs", "unreadable.jsonl");
    writeFileSync(unreadable, "not json\n");
    expect(stream(layout, "codex", unreadable, layout.codex).code).toBe(3);
    const empty = join(layout.dispatch, "logs", "empty.jsonl");
    writeEvents(empty, [{ type: "turn.completed" }]);
    expect(stream(layout, "codex", empty, layout.codex).out).toContain("not checked");
  });

  test("C6 only this run's refs and the synthesis worktree are compared", () => {
    const layout = makeLayout();
    expect(before(layout).code).toBe(0);
    const commit = addCommit(layout.repo, layout.reviewers.mimo, "scratch-only.txt");
    expect(commit).not.toBe(layout.base);
    const untouched = check(layout, "r1");
    expect(untouched.code).toBe(0);
    expect(untouched.out).not.toContain("scratch-only");
  });

  test("C6 a synthesis merge reports both the run ref and synthesis head with full hashes", () => {
    const layout = makeLayout();
    expect(before(layout).code).toBe(0);
    const commit = addCommit(layout.repo, layout.reviewers.mimo, "reviewed.txt");
    git(layout.repo, "-C", layout.synth, "merge", "--ff-only", commit);
    const actual = `git -C ${layout.synth} status --short && git -C ${layout.synth} merge --ff-only ${commit} && git -C ${layout.synth} log --oneline -3`;
    writeReviewer(layout, "mimo", [mimo("bash", { command: actual })]);
    const result = check(layout, "r1");
    expect(result.code).toBe(2);
    expect(result.out).toContain(`refs/heads/T`);
    expect(result.out).toContain(layout.base);
    expect(result.out).toContain(commit);
    expect(result.out).toContain(layout.synth);
    expect(
      actionLines(layout).some(
        (line) =>
          line.action === "degrade" && line.target === "mimo" && line.detail === "bug r1: reach",
      ),
    ).toBe(true);
    expect(
      actionLines(layout).some((line) => line.action === "degrade" && line.target === "codex"),
    ).toBe(false);
  });

  test("C6 unrelated branch, tags, remote refs and a forward main commit are ignored", () => {
    const layout = makeLayout();
    expect(before(layout).code).toBe(0);
    const scratchCommit = addCommit(layout.repo, layout.reviewers.mimo, "round-file.txt");
    git(layout.repo, "tag", "round-tag", scratchCommit);
    git(layout.repo, "update-ref", "refs/remotes/origin/main", scratchCommit);
    git(layout.repo, "checkout", "main");
    writeFileSync(join(layout.repo, "main-forward.txt"), "forward\n");
    git(layout.repo, "add", "main-forward.txt");
    git(layout.repo, "commit", "-qm", "Move main forward");
    const result = check(layout, "r1");
    expect(result.code).toBe(0);
    expect(result.out).not.toContain("round-tag");
    expect(result.out).not.toContain("main-forward");
  });
});

describe("C8-C9: escalation boundary", () => {
  test("C8a a main checkout change a workhorse record names is tied to that lane", () => {
    const layout = makeLayout();
    const out = join(layout.repo, "out.txt");
    writeFileSync(out, "reached\n");
    writeWorkhorse(layout, "codex", [codexFile(out)]);
    const result = check(layout, "workhorses");
    expect(result.code).toBe(2);
    expect(result.out).toContain("out.txt");
    expect(result.out).toContain("tied to codex");
    expect(readFileSync(join(TOOL, "skills/postmaster/coachman.md"), "utf8")).toContain(
      "before setting `synthesis` or staging any synthesis",
    );
  });

  test("C8b a main checkout change no record names is a finding at workhorses", () => {
    const layout = makeLayout();
    writeFileSync(join(layout.repo, "unrecorded.txt"), "new\n");
    const result = check(layout, "workhorses");
    expect(result.code).toBe(2);
    expect(result.out).toContain("unrecorded.txt");
    expect(result.out).toContain("main checkout changed without a lane record");
    const named = makeLayout();
    writeWorkhorse(named, "codex", [codex(`cat ${join(named.repo, "README.md")}`)]);
    expect(check(named, "workhorses").code).toBe(3);
  });

  test("C9 an escalation marker is RULE, and no synthesis stage follows before the ruling", () => {
    const layout = makeLayout();
    writeFileSync(join(layout.dispatch, ".escalation-ready"), "");
    const result = run("bash", [RUN, "runs-status", join(layout.repo, ".postmaster", "runs")]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("RULE");
    const coachman = readFileSync(join(TOOL, "skills/postmaster/coachman.md"), "utf8");
    const workhorseCheck = coachman.indexOf("run reach check <dispatch> workhorses");
    const synthesisStage = coachman.indexOf("run stage <dispatch> synthesis", workhorseCheck);
    expect(workhorseCheck).toBeGreaterThanOrEqual(0);
    expect(synthesisStage).toBeGreaterThan(workhorseCheck);
    expect(coachman.slice(workhorseCheck, synthesisStage)).toContain("touch `.escalation-ready`");
  });

  test("C9b a reviewer reach waits before fixes or another review launch", () => {
    const layout = makeLayout();
    before(layout);
    const outside = join(layout.repo, "x.txt");
    writeReviewer(layout, "mimo", [mimo("write_file", { path: outside })]);
    writeFileSync(outside, "written\n");
    const round = check(layout, "r1");
    expect(round.code).toBe(2);
    expect(round.out).toContain("r1: finding");
    expect(round.out).toContain(`escalate: mimo ${outside}`);
    writeFileSync(join(layout.dispatch, ".escalation-ready"), "");
    const result = run("bash", [RUN, "runs-status", join(layout.repo, ".postmaster", "runs")]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("RULE");
    expect(
      actionLines(layout).some(
        (line) => line.action === "apply" || line.action === "review-launch",
      ),
    ).toBe(false);
    const coachman = readFileSync(join(TOOL, "skills/postmaster/coachman.md"), "utf8");
    const roundCheck = coachman.indexOf("run reach round <dispatch> r<round>");
    const userFinding = coachman.indexOf("escalate:", roundCheck);
    expect(roundCheck).toBeGreaterThanOrEqual(0);
    expect(userFinding).toBeGreaterThanOrEqual(0);
    expect(coachman.slice(userFinding)).toContain("exit before applying a fix or");
    expect(coachman.slice(userFinding)).toContain("launching another review round");
  });
});

describe("C10-C12: review rounds, verdicts and restore", () => {
  test("C10b a reviewer moving a run ref from its scratch voids only its own verdict", () => {
    const layout = makeLayout();
    before(layout);
    const next = addCommit(layout.repo, layout.reviewers.mimo, "new-ref.txt");
    writeReviewer(layout, "mimo", [
      mimo("bash", { command: `git update-ref refs/heads/T ${next}` }),
    ]);
    git(layout.repo, "update-ref", "refs/heads/T", next);
    const result = check(layout, "r1");
    expect(result.code).toBe(2);
    expect(
      actionLines(layout)
        .filter((line) => line.action === "degrade")
        .map((line) => line.target),
    ).toEqual(["mimo"]);
    const restore = call(layout, ["restore", layout.dispatch, "r1"]);
    expect(restore.code).toBe(0);
    expect(git(layout.repo, "rev-parse", "refs/heads/T")).toBe(layout.base);
  });

  test("C10c an unexplained tracked round change voids every reviewer", () => {
    const layout = makeLayout();
    before(layout);
    const commit = addCommit(layout.repo, layout.reviewers.mimo, "unexplained.txt");
    git(layout.repo, "-C", layout.synth, "merge", "--ff-only", commit);
    const result = check(layout, "r1");
    expect(result.code).toBe(3);
    expect(
      actionLines(layout)
        .filter((line) => line.action === "degrade")
        .map((line) => line.target)
        .sort(),
    ).toEqual(["codex", "mimo"]);
  });

  test("C11 restore saves the undone change and moves new synthesis files into the run", () => {
    const layout = makeLayout();
    before(layout);
    const commit = addCommit(layout.repo, layout.reviewers.mimo, "reviewed.txt");
    git(layout.repo, "-C", layout.synth, "merge", "--ff-only", commit);
    writeReviewer(layout, "mimo", [
      mimo("bash", { command: `git -C ${layout.synth} merge --ff-only ${commit}` }),
    ]);
    const round = check(layout, "r1");
    expect(round.code).toBe(2);
    expect(round.out).toContain("r1: finding");
    writeFileSync(join(layout.synth, "u.txt"), "preserve me\n");
    const symlinkTarget = join(layout.home, "outside-target.txt");
    symlinkSync(symlinkTarget, join(layout.synth, "outside-link"));
    expect(call(layout, ["restore", layout.dispatch, "r1"]).code).toBe(0);
    expect(git(layout.repo, "rev-parse", "refs/heads/T")).toBe(layout.base);
    expect(git(layout.repo, "-C", layout.synth, "rev-parse", "HEAD")).toBe(layout.base);
    expect(readFileSync(join(layout.dispatch, "reach", "r1", "u.txt"), "utf8")).toBe(
      "preserve me\n",
    );
    expect(readlinkSync(join(layout.dispatch, "reach", "r1", "outside-link"))).toBe(symlinkTarget);
    expect(existsSync(join(layout.dispatch, "reach", "r1", "branches", "refs_heads_T.patch"))).toBe(
      true,
    );
    writeFileSync(
      join(layout.dispatch, "checks.json"),
      JSON.stringify({
        checks: [{ name: "gate", source: "default:gate", command: "true", shows: "gate" }],
      }),
    );
    const verified = run("bash", [RUN, "verify", "run", layout.synth, layout.dispatch]);
    expect(verified.code).toBe(0);
  });

  test("C12 a reviewer reach is marked for the user outside this run, and not inside it", () => {
    const external = makeLayout();
    before(external);
    const outside = join(external.repo, "x.txt");
    writeReviewer(external, "mimo", [mimo("bash", { command: `touch ${outside}` })]);
    writeFileSync(outside, "written\n");
    expect(check(external, "r1").code).toBe(2);
    const externalFinding = reachEvents(external).find(
      ({ detail }) => detail.kind === "finding" && detail.path === outside,
    );
    expect(externalFinding?.detail.user).toBe(true);
    expect(
      actionLines(external).some((line) => line.action === "degrade" && line.target === "mimo"),
    ).toBe(true);

    const internal = makeLayout();
    before(internal);
    const insideRun = join(internal.synth, "created.txt");
    writeReviewer(internal, "mimo", [mimo("bash", { command: `touch ${insideRun}` })]);
    writeFileSync(insideRun, "created\n");
    expect(check(internal, "r1").code).toBe(2);
    const internalFinding = reachEvents(internal).find(
      ({ detail }) => detail.kind === "finding" && detail.path === insideRun,
    );
    expect(internalFinding?.detail.user).toBe(false);
  });
});

describe("C13-C15: card, contract and balanced controls", () => {
  test("C13 reads and unexplained untracked files are notes and do not degrade reviewers", () => {
    const layout = makeLayout();
    before(layout);
    writeReviewer(layout, "mimo", [
      mimo("bash", { command: `cat ${join(layout.repo, "README.md")}` }),
    ]);
    writeFileSync(join(layout.synth, "untracked-synthesis.txt"), "new\n");
    writeFileSync(join(layout.repo, "untracked-main.txt"), "new\n");
    const round = check(layout, "r1");
    expect(round.code).toBe(2);
    expect(round.out).toContain("r1: note");
    expect(round.out).toContain("README.md");
    expect(round.out).toContain("untracked-synthesis.txt");
    expect(actionLines(layout).some((line) => line.action === "degrade")).toBe(false);
    const card = check(layout, "card");
    expect(card.out).toContain("card: note");
    expect(card.out).toContain("untracked-main.txt");
    expect(card.out).not.toContain("README.md");
    expect(card.out).not.toContain("untracked-synthesis.txt");
    expect(actionLines(layout).some((line) => line.action === "degrade")).toBe(false);
  });

  test("C14 card renders logged reaches without exposing absolute paths, and missing points say not checked", () => {
    const layout = makeLayout();
    const codexOut = join(layout.repo, "out.txt");
    const homeOut = join(layout.home, "other", "x");
    const privateTarget = join(layout.home, "private-target.txt");
    symlinkSync(privateTarget, join(layout.repo, "project-link"));
    mkdirSync(join(layout.home, "other"), { recursive: true });
    writeWorkhorse(layout, "codex", [codexFile(codexOut), codexFile(homeOut)]);
    expect(check(layout, "workhorses").code).toBe(2);
    before(layout);
    const commit = addCommit(layout.repo, layout.reviewers.mimo, "reviewed.txt");
    git(layout.repo, "-C", layout.synth, "merge", "--ff-only", commit);
    writeReviewer(layout, "mimo", [
      mimo("bash", { command: `git -C ${layout.synth} merge --ff-only ${commit}` }),
    ]);
    check(layout, "r1");
    check(layout, "card");

    writeFileSync(
      join(layout.dispatch, "checks.json"),
      JSON.stringify({
        checks: [{ name: "gate", source: "default:gate", command: "true", shows: "gate" }],
      }),
    );
    const sha = git(layout.synth, "rev-parse", "HEAD").slice(0, 12);
    writeAction(layout, "coachman", "verify", "gate", `on=${sha}@${sha} result=pass exit=0 secs=1`);
    const checkpoint = join(layout.dispatch, "checkpoint.md");
    writeFileSync(checkpoint, "## Findings (bug)\n\nnone\n");
    const card = run("bash", [
      RUN,
      "landing",
      "card-block",
      layout.dispatch,
      layout.synth,
      checkpoint,
    ]);
    expect(card.code).toBe(0);
    expect(card.out).toContain("## Reach");
    expect(card.out).toContain("out.txt");
    expect(card.out).toContain("outside the project");
    expect(card.out).toContain("synthesis worktree");
    expect(card.out).toContain("project-link");
    expect(card.out).not.toContain("private-target.txt");
    expect(card.out).toContain("voided verdict: bug reviewer mimo");
    expect(card.out).not.toContain(layout.home);
    expect(card.out).not.toContain(layout.repo);

    const noCard = makeLayout();
    check(noCard, "workhorses");
    before(noCard);
    check(noCard, "r1");
    const kept = readFileSync(join(noCard.dispatch, "actions.jsonl"), "utf8")
      .split("\n")
      .filter((line) => {
        if (!line) return false;
        return JSON.parse(line).target !== "card";
      });
    writeFileSync(join(noCard.dispatch, "actions.jsonl"), `${kept.join("\n")}\n`);
    writeFileSync(
      join(noCard.dispatch, "checks.json"),
      JSON.stringify({
        checks: [{ name: "gate", source: "default:gate", command: "true", shows: "gate" }],
      }),
    );
    writeAction(
      noCard,
      "coachman",
      "verify",
      "gate",
      `on=${git(noCard.synth, "rev-parse", "HEAD").slice(0, 12)}@${git(noCard.synth, "rev-parse", "HEAD").slice(0, 12)} result=pass exit=0 secs=1`,
    );
    writeFileSync(checkpoint, "## Findings (bug)\n\nnone\n");
    const missing = run("bash", [
      RUN,
      "landing",
      "card-block",
      noCard.dispatch,
      noCard.synth,
      checkpoint,
    ]);
    expect(missing.code).toBe(0);
    expect(missing.out).toContain("- card: not checked");
  });

  test("C15 check-target reach uses the same command for a clean negative control", () => {
    const layout = makeLayout();
    const clean = run("bash", [RUN, "check-target", "reach", layout.repo, "main"]);
    expect(clean.code).toBe(0);
    expect(clean.out).toContain("clean");
    writeFileSync(join(layout.repo, "dirty.txt"), "dirty\n");
    const dirty = run("bash", [RUN, "check-target", "reach", layout.repo, "main"]);
    expect(dirty.code).toBe(2);
    expect(dirty.out).toContain("changed dirty.txt");
  });
});

describe("R1: review round 1 fixes", () => {
  test("R1 a hyphenated lane restores its own worktree", () => {
    const layout = makeLayout();
    const lane = "my-lane";
    const wt = join(layout.repo, ".worktrees", `T-${lane}`);
    git(layout.repo, "worktree", "add", "-q", "-b", `wb/T-${lane}`, wt, "main");
    const runJson = JSON.parse(readFileSync(join(layout.dispatch, "run.json"), "utf8"));
    runJson.config.lanes[lane] = { harness: "codex" };
    writeFileSync(join(layout.dispatch, "run.json"), JSON.stringify(runJson));
    const manifest = JSON.parse(readFileSync(join(layout.dispatch, "manifest.json"), "utf8"));
    manifest.lanes[lane] = {};
    writeFileSync(join(layout.dispatch, "manifest.json"), JSON.stringify(manifest));
    before(layout);
    addCommit(layout.repo, wt, "lane-work.txt");
    expect(call(layout, ["restore", layout.dispatch, "r1"]).code).toBe(0);
    expect(git(layout.repo, "rev-parse", `refs/heads/wb/T-${lane}`)).toBe(layout.base);
    expect(git(layout.repo, "-C", wt, "status", "--porcelain")).toBe("");
  });

  test("R1 an ownerless tracked change voids every reviewer, and a merge voids only its lane", () => {
    const layout = makeLayout();
    writeReviewer(layout, "codex", [codex(`git -C ${layout.synth} gc`)]);
    before(layout);
    writeFileSync(join(layout.synth, "README.md"), "changed by nobody's record\n");
    const result = check(layout, "r1");
    expect(
      actionLines(layout)
        .filter((line) => line.action === "degrade")
        .map((line) => line.target)
        .sort(),
    ).toEqual(["codex", "mimo"]);
    expect(result.out).toContain("unexplained");

    const owned = makeLayout();
    before(owned);
    const commit = addCommit(owned.repo, owned.reviewers.mimo, "reviewed.txt");
    git(owned.repo, "-C", owned.synth, "merge", "--ff-only", commit);
    writeReviewer(owned, "mimo", [
      mimo("bash", { command: `git -C ${owned.synth} merge --ff-only ${commit}` }),
    ]);
    check(owned, "r1");
    expect(
      actionLines(owned)
        .filter((line) => line.action === "degrade")
        .map((line) => line.target),
    ).toEqual(["mimo"]);
  });

  test("R1 a round-change finding names the synthesis worktree, never inside", () => {
    const layout = makeLayout();
    before(layout);
    const commit = addCommit(layout.repo, layout.reviewers.mimo, "reviewed.txt");
    git(layout.repo, "-C", layout.synth, "merge", "--ff-only", commit);
    writeReviewer(layout, "mimo", [
      mimo("bash", { command: `git -C ${layout.synth} merge --ff-only ${commit}` }),
    ]);
    // The coachman runs the check from the synthesis worktree; the label must
    // not depend on the working directory.
    const cwd = process.cwd();
    process.chdir(layout.synth);
    try {
      const result = check(layout, "r1");
      expect(result.out).toContain("(synthesis worktree)");
      expect(result.out).not.toContain("(inside)");
    } finally {
      process.chdir(cwd);
    }
  });

  test("R1 restore leaves uncommitted work on unmoved branches alone", () => {
    const layout = makeLayout();
    before(layout);
    writeFileSync(join(layout.codex, "precious.txt"), "uncommitted work\n");
    git(layout.repo, "-C", layout.codex, "add", "precious.txt");
    writeFileSync(join(layout.codex, "README.md"), "uncommitted edit\n");
    expect(call(layout, ["restore", layout.dispatch, "r1"]).code).toBe(0);
    expect(readFileSync(join(layout.codex, "precious.txt"), "utf8")).toBe("uncommitted work\n");
    expect(readFileSync(join(layout.codex, "README.md"), "utf8")).toBe("uncommitted edit\n");
    const status = git(layout.repo, "-C", layout.codex, "status", "--porcelain");
    expect(status).toContain("precious.txt");
    expect(status).toContain("README.md");
  });

  test("R1 restore of a moved branch saves its uncommitted edit, and a clean move saves none", () => {
    const layout = makeLayout();
    before(layout);
    addCommit(layout.repo, layout.codex, "lane-work.txt");
    writeFileSync(join(layout.codex, "README.md"), "uncommitted edit\n");
    expect(call(layout, ["restore", layout.dispatch, "r1"]).code).toBe(0);
    expect(git(layout.repo, "rev-parse", "refs/heads/wb/T-codex")).toBe(layout.base);
    const saved = join(
      layout.dispatch,
      "reach",
      "r1",
      "branches",
      "refs_heads_wb_T-codex.worktree.patch",
    );
    expect(readFileSync(saved, "utf8")).toContain("uncommitted edit");

    const clean = makeLayout();
    before(clean);
    addCommit(clean.repo, clean.codex, "lane-work.txt");
    expect(call(clean, ["restore", clean.dispatch, "r1"]).code).toBe(0);
    expect(
      existsSync(
        join(clean.dispatch, "reach", "r1", "branches", "refs_heads_wb_T-codex.worktree.patch"),
      ),
    ).toBe(false);
  });

  test("R1 restore faults when the synthesis worktree cannot be verified", () => {
    const layout = makeLayout();
    before(layout);
    addCommit(layout.repo, layout.synth, "synth-work.txt");
    const ticket = git(layout.repo, "rev-parse", "refs/heads/T");
    expect(ticket).not.toBe(layout.base);
    rmSync(join(layout.synth, ".git"), { force: true });
    expect(call(layout, ["restore", layout.dispatch, "r1"]).code).toBe(1);
    expect(git(layout.repo, "rev-parse", "refs/heads/main")).toBe(layout.base);

    // A detached or switched worktree no longer faults: the ruled round
    // reattaches the recorded branch instead (see the R4 reattach test).
    const replaced = makeLayout();
    before(replaced);
    rmSync(join(replaced.synth, ".git"), { force: true });
    writeFileSync(join(replaced.synth, ".git"), "not a repository\n");
    expect(call(replaced, ["restore", replaced.dispatch, "r1"]).code).toBe(1);
  });

  test("R1 a second restore keeps the first saved copy", () => {
    const layout = makeLayout();
    before(layout);
    const commit = addCommit(layout.repo, layout.reviewers.mimo, "reviewed.txt");
    git(layout.repo, "-C", layout.synth, "merge", "--ff-only", commit);
    expect(call(layout, ["restore", layout.dispatch, "r1"]).code).toBe(0);
    const patch = join(layout.dispatch, "reach", "r1", "synthesis.patch");
    expect(readFileSync(patch, "utf8").length).toBeGreaterThan(0);
    expect(call(layout, ["restore", layout.dispatch, "r1"]).code).toBe(0);
    expect(readFileSync(patch, "utf8").length).toBeGreaterThan(0);
    expect(existsSync(join(layout.dispatch, "reach", "r1-2", "synthesis.patch"))).toBe(true);
  });

  test("R1 repo and tool come from their own brief sections, or the whole brief", () => {
    const layout = makeLayout();
    writeFileSync(
      join(layout.dispatch, "brief.md"),
      `# Waybill: T\nturnpikes: bug\n\n## Ticket\n\nA ticket quoting the template:\nrepo: /nowhere/at/all\ntool: /evil/tool\n\n## Project profile\nrepo: ${layout.repo} default branch: main BASE: ${layout.base}\n\n## Dispatch\ntool: ${TOOL}\n`,
    );
    expect(check(layout, "workhorses").code).toBe(0);

    const toolRead = join(layout.dispatch, "logs", "tool-read.jsonl");
    writeEvents(toolRead, [codex(`cat ${join(TOOL, "scripts", "launch.ts")}`)]);
    const toolResult = stream(layout, "codex", toolRead, layout.codex);
    expect(toolResult.code).toBe(3);
    expect(toolResult.out).toContain("note names");

    const old = makeLayout();
    writeFileSync(join(old.dispatch, "brief.md"), `repo: ${old.repo}\n`);
    expect(check(old, "workhorses").code).toBe(0);
  });

  test("R1 the card escapes hostile filenames", () => {
    const layout = makeLayout();
    check(layout, "workhorses");
    before(layout);
    check(layout, "r1");
    writeFileSync(join(layout.repo, "weird<!--x.txt"), "x\n");
    writeFileSync(join(layout.repo, "back`tick.txt"), "x\n");
    writeFileSync(join(layout.repo, "new\nline.txt"), "x\n");
    check(layout, "card");
    writeFileSync(
      join(layout.dispatch, "checks.json"),
      JSON.stringify({
        checks: [{ name: "gate", source: "default:gate", command: "true", shows: "gate" }],
      }),
    );
    const sha = git(layout.synth, "rev-parse", "HEAD").slice(0, 12);
    writeAction(layout, "coachman", "verify", "gate", `on=${sha}@${sha} result=pass exit=0 secs=1`);
    const checkpoint = join(layout.dispatch, "checkpoint.md");
    writeFileSync(checkpoint, "## Findings (bug)\n\nnone\n");
    const card = run("bash", [
      RUN,
      "landing",
      "card-block",
      layout.dispatch,
      layout.synth,
      checkpoint,
    ]);
    expect(card.code).toBe(0);
    expect(card.out).toContain("weird&lt;!--x.txt");
    expect(card.out).toContain("back'tick.txt");
    expect(card.out).toContain("new\\nline.txt");
    expect(card.out).not.toContain("<!--");
    expect(card.out).not.toContain("`tick");
  });

  test("R2 git reads and restores ignore inherited directory overrides", () => {
    const layout = makeLayout();
    const other = join(layout.root, "other");
    git(layout.repo, "init", "--bare", "-q", `${other}.git`);
    mkdirSync(other, { recursive: true });
    const polluted = { HOME: layout.home, GIT_DIR: `${other}.git`, GIT_WORK_TREE: other };
    writeReviewer(layout, "codex", [codex(`touch ${layout.reviewers.codex}/probe.txt`)]);
    writeReviewer(layout, "mimo", [mimo("bash", { command: "true" })]);
    const runPolluted = (args: string[]): { code: number; out: string } => {
      const result = run("bash", [RUN, "reach", ...args], {
        env: polluted,
      });
      return { code: result.code, out: `${result.out}${result.err}` };
    };
    expect(runPolluted(["before", layout.dispatch, "1"]).code).toBe(0);
    expect(runPolluted(["check", layout.dispatch, "r1"]).code).toBe(0);

    const moved = makeLayout();
    const another = join(moved.root, "other");
    git(moved.repo, "init", "--bare", "-q", `${another}.git`);
    mkdirSync(another, { recursive: true });
    before(moved);
    addCommit(moved.repo, moved.synth, "synth-work.txt");
    const restorePolluted = run("bash", [RUN, "reach", "restore", moved.dispatch, "r1"], {
      env: { HOME: moved.home, GIT_DIR: `${another}.git`, GIT_WORK_TREE: another },
    });
    expect(restorePolluted.code).toBe(0);
    expect(git(moved.repo, "rev-parse", "refs/heads/T")).toBe(moved.base);
  });

  test("R2 check-target reach ignores inherited directory overrides", () => {
    const layout = makeLayout();
    const other = join(layout.root, "other");
    git(layout.repo, "init", "--bare", "-q", `${other}.git`);
    mkdirSync(other, { recursive: true });
    const polluted = run("bash", [RUN, "check-target", "reach", layout.repo, "main"], {
      env: { GIT_DIR: `${other}.git`, GIT_WORK_TREE: other },
    });
    expect(polluted.code).toBe(0);
    expect(polluted.out).toContain(`root ${layout.repo}`);
  });

  test("R2 a rider owns only what its move produced, and a lone merge still voids one", () => {
    const layout = makeLayout();
    before(layout);
    const commit = addCommit(layout.repo, layout.reviewers.mimo, "reviewed.txt");
    git(layout.repo, "-C", layout.synth, "merge", "--ff-only", commit);
    writeReviewer(layout, "mimo", [
      mimo("bash", { command: `git -C ${layout.synth} merge --ff-only ${commit}` }),
    ]);
    writeFileSync(join(layout.synth, "README.md"), "edited by nobody's record\n");
    check(layout, "r1");
    expect(
      actionLines(layout)
        .filter((line) => line.action === "degrade")
        .map((line) => line.target)
        .sort(),
    ).toEqual(["codex", "mimo"]);

    const lone = makeLayout();
    before(lone);
    const single = addCommit(lone.repo, lone.reviewers.mimo, "reviewed.txt");
    git(lone.repo, "-C", lone.synth, "merge", "--ff-only", single);
    writeReviewer(lone, "mimo", [
      mimo("bash", { command: `git -C ${lone.synth} merge --ff-only ${single}` }),
    ]);
    check(lone, "r1");
    expect(
      actionLines(lone)
        .filter((line) => line.action === "degrade")
        .map((line) => line.target),
    ).toEqual(["mimo"]);
  });

  test("R2 an untracked file beside a merge is a note, and a moved side branch claims no files", () => {
    const layout = makeLayout();
    before(layout);
    const commit = addCommit(layout.repo, layout.reviewers.mimo, "reviewed.txt");
    git(layout.repo, "-C", layout.synth, "merge", "--ff-only", commit);
    writeReviewer(layout, "mimo", [
      mimo("bash", { command: `git -C ${layout.synth} merge --ff-only ${commit}` }),
    ]);
    writeFileSync(join(layout.synth, "u.txt"), "new\n");
    const result = check(layout, "r1");
    const stray = result.out.split("\n").filter((line) => line.includes("u.txt"));
    expect(stray.length).toBeGreaterThan(0);
    expect(stray.every((line) => line.startsWith("note"))).toBe(true);

    const side = makeLayout();
    before(side);
    const next = addCommit(side.repo, side.reviewers.mimo, "reviewed.txt");
    git(side.repo, "update-ref", "refs/heads/wb/T-codex", next);
    writeReviewer(side, "mimo", [
      mimo("bash", { command: `git update-ref refs/heads/wb/T-codex` }),
    ]);
    writeFileSync(join(side.synth, "README.md"), "edited by nobody's record\n");
    check(side, "r1");
    expect(
      actionLines(side)
        .filter((line) => line.action === "degrade")
        .map((line) => line.target)
        .sort(),
    ).toEqual(["codex", "mimo"]);
  });

  test("R2 the card escapes the reason as well as the path", () => {
    const layout = makeLayout();
    writeFileSync(join(layout.synth, "weird<!--x.txt"), "v1\n");
    git(layout.repo, "-C", layout.synth, "add", ".");
    git(layout.repo, "-C", layout.synth, "commit", "-qm", "hostile");
    before(layout);
    writeReviewer(layout, "codex", [codex(`touch ${layout.reviewers.codex}/probe.txt`)]);
    writeFileSync(join(layout.synth, "weird<!--x.txt"), "v2 ownerless\n");
    check(layout, "r1");
    check(layout, "card");
    writeFileSync(
      join(layout.dispatch, "checks.json"),
      JSON.stringify({
        checks: [{ name: "gate", source: "default:gate", command: "true", shows: "gate" }],
      }),
    );
    const sha = git(layout.synth, "rev-parse", "HEAD").slice(0, 12);
    writeAction(layout, "coachman", "verify", "gate", `on=${sha}@${sha} result=pass exit=0 secs=1`);
    const checkpoint = join(layout.dispatch, "checkpoint.md");
    writeFileSync(checkpoint, "## Findings (bug)\n\nnone\n");
    const card = run("bash", [
      RUN,
      "landing",
      "card-block",
      layout.dispatch,
      layout.synth,
      checkpoint,
    ]);
    expect(card.code).toBe(0);
    expect(card.out).toContain("unexplained");
    expect(card.out).toContain("weird&lt;!--x.txt");
    expect(card.out).not.toContain("<!--");
  });

  test("R1 the card reads project paths relative through a symlinked dispatch", () => {
    const layout = makeLayout();
    writeWorkhorse(layout, "codex", [
      codexFile(join(layout.repo, "out.txt")),
      codexFile(join(layout.home, "other", "x")),
    ]);
    mkdirSync(join(layout.home, "other"), { recursive: true });
    check(layout, "workhorses");
    check(layout, "card");
    writeFileSync(
      join(layout.dispatch, "checks.json"),
      JSON.stringify({
        checks: [{ name: "gate", source: "default:gate", command: "true", shows: "gate" }],
      }),
    );
    const sha = git(layout.synth, "rev-parse", "HEAD").slice(0, 12);
    writeAction(layout, "coachman", "verify", "gate", `on=${sha}@${sha} result=pass exit=0 secs=1`);
    const checkpoint = join(layout.dispatch, "checkpoint.md");
    writeFileSync(checkpoint, "## Findings (bug)\n\nnone\n");
    const link = join(tmpdir(), `reach-link-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    symlinkSync(layout.root, link);
    CREATED.push(link);
    const viaLink = join(link, "repo", ".postmaster", "runs", "T");
    const card = run("bash", [RUN, "landing", "card-block", viaLink, layout.synth, checkpoint]);
    expect(card.code).toBe(0);
    expect(card.out).toContain("`out.txt`");
    expect(card.out).toContain("outside the project");
  });
});

describe("R4: ruled round fixes", () => {
  test("R4 restore reattaches the recorded branch, keeping an earlier commit", () => {
    const layout = makeLayout();
    const kept = addCommit(layout.repo, layout.synth, "kept.txt");
    before(layout);
    git(layout.repo, "-C", layout.synth, "checkout", "-q", "--detach", "HEAD");
    expect(call(layout, ["restore", layout.dispatch, "r1"]).code).toBe(0);
    expect(git(layout.repo, "rev-parse", "refs/heads/T")).toBe(kept);
    expect(git(layout.repo, "-C", layout.synth, "symbolic-ref", "--short", "HEAD")).toBe("T");
    expect(readFileSync(join(layout.synth, "kept.txt"), "utf8")).toBe("review change\n");

    const moved = makeLayout();
    before(moved);
    addCommit(moved.repo, moved.synth, "round-work.txt");
    git(moved.repo, "-C", moved.synth, "checkout", "-q", "--detach", "HEAD");
    expect(call(moved, ["restore", moved.dispatch, "r1"]).code).toBe(0);
    expect(git(moved.repo, "rev-parse", "refs/heads/T")).toBe(moved.base);
    expect(git(moved.repo, "-C", moved.synth, "symbolic-ref", "--short", "HEAD")).toBe("T");
    expect(git(moved.repo, "-C", moved.synth, "status", "--porcelain")).toBe("");
  });

  test("R4 an unreadable task transcript leaves the lane not checked", () => {
    const layout = makeLayout();
    const runJson = JSON.parse(readFileSync(join(layout.dispatch, "run.json"), "utf8"));
    runJson.config.lanes.opus = { harness: "claude" };
    writeFileSync(join(layout.dispatch, "run.json"), JSON.stringify(runJson));
    const own = join(layout.repo, ".worktrees", "T-opus");
    git(layout.repo, "worktree", "add", "-q", "-b", "wb/T-opus", own, "main");
    const streamPath = join(layout.dispatch, "logs", "opus-events.jsonl");
    writeEvents(streamPath, [
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "aaa", name: "Task", input: { prompt: "y" } }],
        },
      },
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "aaa", content: "done" }] },
      },
    ]);
    writeFileSync(join(layout.dispatch, "logs", "opus-claude-task-aaa.jsonl"), "{not valid json\n");
    const broken = stream(layout, "opus", streamPath, own);
    expect(broken.code).toBe(3);
    expect(broken.out).toContain("not checked");

    const fixed = makeLayout();
    const fixedJson = JSON.parse(readFileSync(join(fixed.dispatch, "run.json"), "utf8"));
    fixedJson.config.lanes.opus = { harness: "claude" };
    writeFileSync(join(fixed.dispatch, "run.json"), JSON.stringify(fixedJson));
    const fixedOwn = join(fixed.repo, ".worktrees", "T-opus");
    git(fixed.repo, "worktree", "add", "-q", "-b", "wb/T-opus", fixedOwn, "main");
    const fixedStream = join(fixed.dispatch, "logs", "opus-events.jsonl");
    writeEvents(fixedStream, [
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "aaa", name: "Task", input: { prompt: "y" } }],
        },
      },
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "aaa", content: "done" }] },
      },
    ]);
    writeEvents(
      join(fixed.dispatch, "logs", "opus-claude-task-aaa.jsonl"),
      claude("Write", { file_path: join(fixed.repo, "forked.txt") }),
    );
    const read = stream(fixed, "opus", fixedStream, fixedOwn);
    expect(read.code).toBe(3);
    expect(read.out).toContain(`note names ${join(fixed.repo, "forked.txt")} (main checkout)`);
  });
});

describe("R6: ruled round fixes", () => {
  test("R6 an unresolved note carrying a private path stays off the card", () => {
    const layout = makeLayout();
    const privateGlob = "/home/someone-else/proj/*.log";
    writeWorkhorse(layout, "codex", [codex(`rm -rf ${privateGlob}`)]);
    check(layout, "workhorses");
    check(layout, "card");
    writeFileSync(
      join(layout.dispatch, "checks.json"),
      JSON.stringify({
        checks: [{ name: "gate", source: "default:gate", command: "true", shows: "gate" }],
      }),
    );
    const sha = git(layout.synth, "rev-parse", "HEAD").slice(0, 12);
    writeAction(layout, "coachman", "verify", "gate", `on=${sha}@${sha} result=pass exit=0 secs=1`);
    const checkpoint = join(layout.dispatch, "checkpoint.md");
    writeFileSync(checkpoint, "## Findings (bug)\n\nnone\n");
    const card = run("bash", [
      RUN,
      "landing",
      "card-block",
      layout.dispatch,
      layout.synth,
      checkpoint,
    ]);
    expect(card.code).toBe(0);
    expect(card.out).not.toContain("someone-else");
    expect(card.out).not.toContain(privateGlob);
    expect(card.out).toContain("outside the project");
    expect(card.out).toContain("unresolved");
  });

  test("R6 the round reach step stops before restore when the check faults", () => {
    const layout = makeLayout();
    before(layout);
    // A reviewer record the check cannot read faults the check; restore,
    // which reads only the snapshot and git, would still run.
    writeFileSync(join(layout.dispatch, "logs", "review-r1.json"), "{not json\n");
    const stepped = call(layout, ["round", layout.dispatch, "r1"]);
    expect(stepped.code).toBe(1);
    expect(stepped.out).not.toContain("restored r1");
    expect(existsSync(join(layout.dispatch, "reach", "r1"))).toBe(false);
  });

  test("R6 the round reach step restores when the check runs clean", () => {
    const layout = makeLayout();
    before(layout);
    const stepped = call(layout, ["round", layout.dispatch, "r1"]);
    expect(stepped.code).toBe(0);
    expect(stepped.out).toContain("restored r1");
    expect(existsSync(join(layout.dispatch, "reach", "r1"))).toBe(true);
  });

  test("R6 the round reach step restores when the check finds an observed change", () => {
    const layout = makeLayout();
    before(layout);
    const outside = join(layout.repo, "x.txt");
    writeReviewer(layout, "mimo", [mimo("write_file", { path: outside })]);
    writeFileSync(outside, "written\n");
    const stepped = call(layout, ["round", layout.dispatch, "r1"]);
    expect(stepped.out).toContain("r1: finding");
    expect(stepped.out).toContain("restored r1");
    expect(stepped.code).toBe(0);
    expect(existsSync(join(layout.dispatch, "reach", "r1"))).toBe(true);
  });
});

describe("R8: rescoped check", () => {
  test("R8 a repository path with a space does not fault the check", () => {
    const layout = makeLayout();
    const base = mkdtempSync(join(tmpdir(), "postmaster-r8-"));
    CREATED.push(base);
    const repo = join(base, "with space", "proj");
    mkdirSync(repo, { recursive: true });
    git(repo, "init", "-b", "main");
    git(repo, "config", "user.email", "r8@example.invalid");
    git(repo, "config", "user.name", "r8");
    git(repo, "commit", "-q", "--allow-empty", "-m", "initial");
    writeFileSync(join(repo, ".git", "info", "exclude"), ".postmaster/\n.worktrees/\n");
    const dispatch = join(repo, ".postmaster", "runs", "T");
    mkdirSync(join(dispatch, "logs"), { recursive: true });
    writeFileSync(
      join(dispatch, "run.json"),
      JSON.stringify({
        config: { lanes: {}, team: { workhorses: [] } },
        postmaster: { checkout: TOOL },
        target: { branch: "main" },
      }),
    );
    writeFileSync(join(dispatch, "manifest.json"), JSON.stringify({ lanes: {} }));
    writeFileSync(
      join(dispatch, "brief.md"),
      `## Project profile\n\nrepo: ${repo} default branch: main\n`,
    );
    const result = run("bash", [RUN, "reach", "check", dispatch, "workhorses"], {
      env: { HOME: layout.home },
    });
    expect(result.code).toBe(0);
  });

  test("R8 restore recovers a deleted run branch with a registered worktree", () => {
    const layout = makeLayout();
    expect(before(layout).code).toBe(0);
    git(layout.repo, "update-ref", "-d", "refs/heads/wb/T-mimo");
    const restore = call(layout, ["restore", layout.dispatch, "r1"]);
    expect(restore.code).toBe(0);
    expect(git(layout.repo, "rev-parse", "refs/heads/wb/T-mimo")).toBe(layout.base);
  });

  test("R8 a substitution directory and a home script target yield at most a note", () => {
    const layout = makeLayout();
    const streamPath = join(layout.dispatch, "logs", "r8-notes.jsonl");
    writeEvents(streamPath, [
      codex("git -C $(pwd) merge --ff-only HEAD"),
      codex("sed --in-place s/a/b/ $HOME/f"),
    ]);
    const result = stream(layout, "codex", streamPath, layout.codex);
    expect(result.code).toBe(3);
    // The substitution names no path; $HOME resolves against the lane's home.
    expect(result.out).not.toContain("$(pwd)");
    expect(result.out).toContain(`note names ${join(layout.home, "f")} (elsewhere)`);
    expect(result.out).not.toContain("finding");
    expect(result.out).not.toContain("not checked");
    expect(result.out).not.toContain("unresolved");

    const globPath = join(layout.dispatch, "logs", "r8-glob.jsonl");
    writeEvents(globPath, [codex("rm -rf /tmp/x*")]);
    const glob = stream(layout, "codex", globPath, layout.codex);
    expect(glob.code).toBe(3);
    expect(glob.out).toContain("note names /tmp/x* (elsewhere) · unresolved");
    expect(glob.out).not.toContain("finding");
  });

  test("R8 the layout root is real where the temp folder is a link", () => {
    const real = realpathSync(mkdtempSync(join(tmpdir(), "postmaster-reach-real-")));
    const link = `${real}-link`;
    symlinkSync(real, link);
    const previous = process.env.TMPDIR;
    process.env.TMPDIR = link;
    try {
      const layout = makeLayout();
      expect(layout.root.startsWith(`${real}/`)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previous;
      CREATED.push(link, real);
    }
  });
});

function cardFor(layout: Layout, commandText: string): string {
  writeWorkhorse(layout, "codex", [codex(commandText)]);
  check(layout, "workhorses");
  check(layout, "card");
  writeFileSync(
    join(layout.dispatch, "checks.json"),
    JSON.stringify({
      checks: [{ name: "gate", source: "default:gate", command: "true", shows: "gate" }],
    }),
  );
  const sha = git(layout.synth, "rev-parse", "HEAD").slice(0, 12);
  writeAction(layout, "coachman", "verify", "gate", `on=${sha}@${sha} result=pass exit=0 secs=1`);
  const checkpoint = join(layout.dispatch, "checkpoint.md");
  writeFileSync(checkpoint, "## Findings (bug)\n\nnone\n");
  const card = run("bash", [
    RUN,
    "landing",
    "card-block",
    layout.dispatch,
    layout.synth,
    checkpoint,
  ]);
  expect(card.code).toBe(0);
  return card.out;
}

describe("R9: ruled round fixes", () => {
  test("R9 an unresolved ~/ path stays off the card", () => {
    const card = cardFor(makeLayout(), "cat ~/Code/secret-proj/*.toml");
    expect(card).not.toContain("secret-proj");
    expect(card).not.toContain("~/Code/secret-proj/*.toml");
    expect(card).toContain("outside the project");
  });

  test("R9 an unresolved ~user path stays off the card", () => {
    const card = cardFor(makeLayout(), "cat ~otheruser/docs/*.md");
    expect(card).not.toContain("otheruser");
    expect(card).not.toContain("~otheruser/docs/*.md");
    expect(card).toContain("outside the project");
  });

  test("R9 an unresolved $HOME path stays off the card", () => {
    const card = cardFor(makeLayout(), "cat $HOME/*.log $HOME/$DIR/f");
    expect(card).not.toContain("$HOME");
    expect(card).not.toContain("$DIR");
    expect(card).toContain("outside the project");
  });

  test("R9 an unresolved ../ path stays off the card", () => {
    const card = cardFor(makeLayout(), "cat ../sibling/*.log");
    expect(card).not.toContain("sibling");
    expect(card).not.toContain("../sibling/*.log");
    expect(card).toContain("outside the project");
  });
});

describe("Post-9: ruled fixes without a review round", () => {
  test("bug-57 a symlinked synthesis worktree faults restore instead of clobbering", () => {
    const layout = makeLayout();
    before(layout);
    rmSync(layout.synth, { recursive: true, force: true });
    symlinkSync(layout.repo, layout.synth);
    const restore = call(layout, ["restore", layout.dispatch, "r1"]);
    expect(restore.code).toBe(1);
    expect(restore.out).toContain("not a worktree");
    expect(git(layout.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(layout.repo, "status", "--porcelain")).toBe("");
  });

  test("bug-58 two reviewers naming one move are both voided", () => {
    const layout = makeLayout();
    before(layout);
    const commit = addCommit(layout.repo, layout.reviewers.mimo, "reviewed.txt");
    git(layout.repo, "-C", layout.synth, "merge", "--ff-only", commit);
    writeReviewer(layout, "mimo", [
      mimo("bash", { command: `git -C ${layout.synth} merge --ff-only ${commit}` }),
    ]);
    writeReviewer(layout, "codex", [codex(`git -C ${layout.synth} status --short`)]);
    const result = check(layout, "r1");
    expect(result.code).toBe(2);
    const degraded = actionLines(layout)
      .filter((line) => line.action === "degrade")
      .map((line) => line.target)
      .sort();
    expect(degraded).toEqual(["codex", "mimo"]);

    const main = makeLayout();
    before(main);
    const changed = join(main.repo, "x.txt");
    writeFileSync(changed, "written\n");
    writeReviewer(main, "mimo", [mimo("bash", { command: `cat ${changed}` })]);
    writeReviewer(main, "codex", [codex(`cat ${changed}`)]);
    const round = check(main, "r1");
    expect(round.code).toBe(2);
    const mainDegraded = actionLines(main)
      .filter((line) => line.action === "degrade")
      .map((line) => line.target)
      .sort();
    expect(mainDegraded).toEqual(["codex", "mimo"]);
  });

  test("bug-64 a refs-shaped unresolved token stays off the card", () => {
    const card = cardFor(makeLayout(), "cat refs/../../home/u/Code/proj/*");
    expect(card).not.toContain("Code/proj");
    expect(card).not.toContain("refs/../../home/u/Code/proj/*");
    expect(card).toContain("outside the project");
  });
});

describe("Fixture: a fix logged as apply before the check reads explained", () => {
  function degrades(layout: Layout): string[] {
    return actionLines(layout)
      .filter((line) => line.action === "degrade")
      .map((line) => String(line.target))
      .sort();
  }

  test("a before-snapshot, a logged fix commit, then the check is clean", () => {
    const layout = makeLayout();
    expect(before(layout).code).toBe(0);
    const fix = addCommit(layout.repo, layout.synth, "fix.txt");
    writeAction(layout, "coachman", "apply", fix, "fix.txt:1");
    const result = check(layout, "r1");
    expect(result.code).toBe(0);
    expect(result.out).not.toContain("unexplained");
    expect(degrades(layout)).toEqual([]);
  });

  test("a fix logged under its short sha reads explained", () => {
    const layout = makeLayout();
    expect(before(layout).code).toBe(0);
    const fix = addCommit(layout.repo, layout.synth, "fix.txt");
    writeAction(layout, "coachman", "apply", fix.slice(0, 7), "fix.txt:1");
    const result = check(layout, "r1");
    expect(result.code).toBe(0);
    expect(result.out).not.toContain("unexplained");
    expect(degrades(layout)).toEqual([]);
  });

  test("a chain with an unlogged commit stays unexplained", () => {
    const layout = makeLayout();
    expect(before(layout).code).toBe(0);
    addCommit(layout.repo, layout.synth, "first.txt");
    const tip = addCommit(layout.repo, layout.synth, "second.txt");
    writeAction(layout, "coachman", "apply", tip, "second.txt:1");
    const result = check(layout, "r1");
    expect(result.code).toBe(3);
    expect(result.out).toContain("unexplained refs/heads/T");
    expect(degrades(layout)).toEqual(["codex", "mimo"]);
  });

  test("a logged fix a lane record names still voids that lane", () => {
    const layout = makeLayout();
    expect(before(layout).code).toBe(0);
    const fix = addCommit(layout.repo, layout.synth, "fix.txt");
    writeAction(layout, "coachman", "apply", fix, "fix.txt:1");
    writeReviewer(layout, "mimo", [mimo("bash", { command: `git show refs/heads/T --stat` })]);
    const result = check(layout, "r1");
    expect(result.code).toBe(2);
    expect(degrades(layout)).toEqual(["mimo"]);
  });

  test("a logged fix excuses only the run branch and its worktree", () => {
    const layout = makeLayout();
    expect(before(layout).code).toBe(0);
    const fix = addCommit(layout.repo, layout.synth, "fix.txt");
    writeAction(layout, "coachman", "apply", fix, "fix.txt:1");
    addCommit(layout.repo, layout.codex, "lane.txt");
    const result = check(layout, "r1");
    expect(result.code).toBe(3);
    expect(result.out).not.toContain("unexplained refs/heads/T");
    expect(result.out).toContain("unexplained refs/heads/wb/T-codex");
    expect(degrades(layout)).toEqual(["codex", "mimo"]);
  });

  test("restore leaves a logged fix in place and says so", () => {
    const layout = makeLayout();
    expect(before(layout).code).toBe(0);
    const fix = addCommit(layout.repo, layout.synth, "fix.txt", "fixed\n");
    writeAction(layout, "coachman", "apply", fix, "fix.txt:1");
    expect(check(layout, "r1").code).toBe(0);
    const restore = call(layout, ["restore", layout.dispatch, "r1"]);
    expect(restore.code).toBe(0);
    expect(restore.out).toContain(
      `left an explained move in place: refs/heads/T: ${layout.base} -> ${fix}`,
    );
    expect(restore.out).toContain(
      `left an explained move in place: .worktrees/T: ${layout.base} -> ${fix}`,
    );
    expect(git(layout.repo, "rev-parse", "refs/heads/T")).toBe(fix);
    expect(git(layout.repo, "-C", layout.synth, "rev-parse", "HEAD")).toBe(fix);
    expect(readFileSync(join(layout.synth, "fix.txt"), "utf8")).toBe("fixed\n");
    expect(existsSync(join(layout.dispatch, "reach", "r1", "branches", "refs_heads_T.patch"))).toBe(
      false,
    );
    expect(readFileSync(join(layout.dispatch, "reach", "r1", "synthesis.patch"), "utf8")).toBe("");
  });

  test("restore resets an unlogged fix as before", () => {
    const layout = makeLayout();
    expect(before(layout).code).toBe(0);
    addCommit(layout.repo, layout.synth, "fix.txt", "fixed\n");
    expect(check(layout, "r1").code).toBe(3);
    const restore = call(layout, ["restore", layout.dispatch, "r1"]);
    expect(restore.code).toBe(0);
    expect(restore.out).not.toContain("explained move");
    expect(git(layout.repo, "rev-parse", "refs/heads/T")).toBe(layout.base);
    expect(git(layout.repo, "-C", layout.synth, "rev-parse", "HEAD")).toBe(layout.base);
    expect(existsSync(join(layout.synth, "fix.txt"))).toBe(false);
    expect(existsSync(join(layout.dispatch, "reach", "r1", "branches", "refs_heads_T.patch"))).toBe(
      true,
    );
  });
});
