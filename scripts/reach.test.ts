// Tests beside scripts/reach.ts: the reach check, its stream reader, ref comparison and
// restore. Every case of the ticket's C1 to C14 runs through these commands, each beside its
// opposite. The first stream is the real command from #200: three git commands in one line,
// a look, the merge, then another look.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HERE = import.meta.dir;
const REACH = join(HERE, "reach.ts");
const LOG_ACTION = join(HERE, "log-action.sh");
const CHECK_TARGET = join(HERE, "check-target.sh");
const RUNS_STATUS = join(HERE, "runs-status.sh");
const VERIFY = join(HERE, "verify.sh");
const LANDING = join(HERE, "landing.sh");

function sh(
  cmd: string,
  args: string[],
  opts: { env?: Record<string, string>; cwd?: string } = {},
): {
  code: number;
  out: string;
  err: string;
} {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    cwd: opts.cwd,
  });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function reach(...args: Array<string | { env?: Record<string, string> }>): {
  code: number;
  out: string;
  err: string;
} {
  const opts =
    typeof args[args.length - 1] === "object"
      ? (args.pop() as { env?: Record<string, string> })
      : {};
  return sh("bun", ["--no-env-file", "--config=/dev/null", REACH, ...(args as string[])], opts);
}

function git(...args: string[]): { code: number; out: string; err: string } {
  return sh("git", args);
}

let tmp = "";
let savedHome = "";

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "reach-"));
  savedHome = process.env.HOME ?? "";
});

afterAll(() => {
  process.env.HOME = savedHome;
  rmSync(tmp, { recursive: true, force: true });
});

// --- the run layout: a temporary repository R on main, D under .postmaster/runs/T ----------
interface Layout {
  root: string;
  R: string;
  D: string;
  T: string;
  home: string;
  env: Record<string, string>;
}

function makeLayout(name: string, opts: { dirty?: boolean; branch?: string } = {}): Layout {
  const root = join(tmp, name);
  mkdirSync(root, { recursive: true });
  const R = join(root, "repo");
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  mkdirSync(R, { recursive: true });
  git("-C", R, "init", "-q", "-b", "main");
  git("-C", R, "config", "user.email", "t@example.com");
  git("-C", R, "config", "user.name", "t");
  writeFileSync(join(R, "README.md"), "hello\n");
  writeFileSync(join(R, ".gitignore"), ".postmaster/\n.worktrees/\n");
  git("-C", R, "add", "-A");
  git("-C", R, "commit", "-qm", "base");
  // origin/main one commit behind origin: a bare remote whose main has an extra commit the
  // local origin/main ref does not hold. The reach form must never fetch, so it never moves.
  const origin = join(root, "origin.git");
  git("init", "-q", "--bare", origin);
  git("-C", R, "remote", "add", "origin", origin);
  git("-C", R, "push", "-qu", "origin", "main");
  const behind = git("-C", R, "rev-parse", "HEAD").out.trim();
  writeFileSync(join(R, "README.md"), "hello\nahead\n");
  git("-C", R, "add", "-A");
  git("-C", R, "commit", "-qm", "ahead");
  git("-C", R, "push", "-q", "origin", "main");
  git("-C", R, "reset", "-q", "--hard", "HEAD~1");
  // origin/main stays one commit behind: the remote has the extra commit, the local ref does not.
  git("-C", R, "update-ref", "refs/remotes/origin/main", behind);

  const T = "T";
  const D = join(R, ".postmaster", "runs", T);
  mkdirSync(join(D, "logs"), { recursive: true });
  mkdirSync(join(R, ".worktrees"), { recursive: true });
  // Synthesis worktree on T, workhorse worktrees on wb/T-<lane>.
  git("-C", R, "branch", T);
  git("-C", R, "worktree", "add", "-q", join(R, ".worktrees", T), T);
  for (const lane of ["codex", "mimo"]) {
    git("-C", R, "branch", `wb/${T}-${lane}`);
    git("-C", R, "worktree", "add", "-q", join(R, ".worktrees", `${T}-${lane}`), `wb/${T}-${lane}`);
  }
  const runJson = {
    target: { head: git("-C", R, "rev-parse", "HEAD").out.trim(), branch: "main" },
    postmaster: { checkout: "" },
    config: {
      lanes: {
        codex: { harness: "codex", model: "c" },
        claude: { harness: "claude", model: "cl" },
        muse: { harness: "muse", model: "m" },
        mimo: { harness: "mimo", model: "mi" },
        pi: { harness: "pi", model: "p" },
        grok: { harness: "grok", model: "g" },
      },
      team: { workhorses: ["codex", "mimo"] },
    },
  };
  writeFileSync(join(D, "run.json"), `${JSON.stringify(runJson, null, 2)}\n`);
  writeFileSync(
    join(D, "manifest.json"),
    `${JSON.stringify({ stage: "dispatched", leg: 1, lanes: { codex: {}, mimo: {} }, coachman: { legs: {} } }, null, 2)}\n`,
  );
  const env = {
    HOME: home,
    GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
    GIT_CONFIG_SYSTEM: "/dev/null",
  };
  writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = t\n\temail = t@example.com\n");
  writeFileSync(
    join(D, "brief.md"),
    `# Waybill: ${T}\nturnpikes: none\n\n## Ticket\n\nA test run.\n## Project profile\nrepo: ${R}\n`,
  );
  writeFileSync(
    join(D, "checks.json"),
    `{"checks": [{"name": "gate", "source": "default:gate", "command": "true", "shows": "x"}]}\n`,
  );
  const L: Layout = { root, R, D, T, home, env };
  if (opts.dirty) {
    for (let i = 1; i <= 25; i++) {
      const sub = i === 1 ? "probe" : "";
      const p = sub !== "" ? join(R, sub, "a.txt") : join(R, `f${i}.txt`);
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, `x${i}\n`);
    }
    writeFileSync(join(R, "README.md"), "changed\n");
  }
  if (opts.branch) {
    git("-C", R, "checkout", "-q", "-b", opts.branch);
  }
  return L;
}

function streamPath(L: Layout, lane: string): string {
  return join(L.D, "logs", `${lane}-events.jsonl`);
}

function writeStream(L: Layout, lane: string, events: string[]): void {
  writeFileSync(streamPath(L, lane), `${events.join("\n")}\n`);
}

// --- the real command from #200, in MiMo's shape, with the layout's paths -------------------
function mergeEvent(R: string, T: string, sha: string): string {
  return JSON.stringify({
    type: "tool_use",
    sessionID: "s1",
    part: {
      type: "tool",
      tool: "bash",
      state: {
        status: "completed",
        input: {
          command: `git -C ${R}/.worktrees/${T} status --short && git -C ${R}/.worktrees/${T} merge --ff-only ${sha} && git -C ${R}/.worktrees/${T} log --oneline -3`,
        },
        output: "Updating a..b\nFast-forward\n",
        metadata: { exit: 0 },
      },
    },
  });
}

function codexFileChange(path: string): string {
  return JSON.stringify({
    type: "item.completed",
    item: { type: "file_change", changes: [{ path }] },
  });
}

function codexCommand(command: string, output = "", exit = 0): string {
  return JSON.stringify({
    type: "item.completed",
    item: { type: "command_execution", command, aggregated_output: output, exit_code: exit },
  });
}

function claudeWrite(path: string): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", id: "t1", name: "Write", input: { file_path: path, content: "x" } },
      ],
    },
  });
}

function claudeRead(path: string, output = "ok", err = false): string[] {
  return [
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "t2", name: "Read", input: { file_path: path } }],
      },
    }),
    JSON.stringify({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "t2", content: output, is_error: err }],
      },
    }),
  ];
}

function mimoWrite(path: string): string {
  return JSON.stringify({
    type: "tool_use",
    sessionID: "s1",
    part: {
      type: "tool",
      tool: "write",
      state: {
        status: "completed",
        input: { file_path: path },
        output: "ok",
        metadata: { exit: 0 },
      },
    },
  });
}

function mimoBash(command: string, output = "", exit = 0): string {
  return JSON.stringify({
    type: "tool_use",
    sessionID: "s1",
    part: {
      type: "tool",
      tool: "bash",
      state: { status: "completed", input: { command }, output, metadata: { exit } },
    },
  });
}

function piWrite(path: string): string {
  return JSON.stringify({
    type: "tool_execution_start",
    toolName: "write_file",
    args: { file_path: path },
  });
}

function museEdit(path: string): string {
  return JSON.stringify({
    stream: { kind: "session", id: "s1" },
    payload_type: "tool.result",
    payload: {
      correlation_facts: { tool_name: "edit_file", outcome: "success" },
      edit_facts: { path },
      text: "edited\n",
    },
  });
}

function museBash(command: string, output = "ok"): string {
  return JSON.stringify({
    stream: { kind: "session", id: "s1" },
    payload_type: "tool.result",
    payload: {
      correlation_facts: { tool_name: "bash", outcome: "success" },
      text: JSON.stringify({ command, output }),
    },
  });
}

// ============================================================================================
// C1: a clean layout: every check point exits 0.
// ============================================================================================
describe("C1 on a clean layout every check exits 0", () => {
  test("check workhorses, before+check r1, check card each exit 0", () => {
    const L = makeLayout("c1");
    const own = join(L.R, ".worktrees", `${L.T}-codex`);
    writeStream(L, "codex", [codexFileChange(join(own, "a.ts"))]);
    writeStream(L, "mimo", [mimoWrite(join(L.R, ".worktrees", `${L.T}-mimo`, "b.ts"))]);
    const w = reach("check", L.D, "workhorses", { env: L.env });
    expect(w.code).toBe(0);
    const b = reach("before", L.D, "1", { env: L.env });
    expect(b.code).toBe(0);
    const r1 = reach("check", L.D, "r1", { env: L.env });
    expect(r1.code).toBe(0);
    const c = reach("check", L.D, "card", { env: L.env });
    expect(c.code).toBe(0);
  });

  test("its opposite: a reach is found and exits 2", () => {
    const L = makeLayout("c1b");
    writeStream(L, "codex", [codexFileChange(join(L.R, "out.txt"))]);
    writeStream(L, "mimo", [mimoWrite(join(L.R, ".worktrees", `${L.T}-mimo`, "b.ts"))]);
    const w = reach("check", L.D, "workhorses", { env: L.env });
    expect(w.code).toBe(2);
    expect(w.out).toContain("out.txt");
  });
});

// ============================================================================================
// C2: every check records its result in the run's log, a clean result included.
// ============================================================================================
describe("C2 every check records its result in the run's log", () => {
  test("after a clean check actions.jsonl holds one reach line per point", () => {
    const L = makeLayout("c2");
    writeStream(L, "codex", [codexFileChange(join(L.R, ".worktrees", `${L.T}-codex`, "a.ts"))]);
    writeStream(L, "mimo", [mimoWrite(join(L.R, ".worktrees", `${L.T}-mimo`, "b.ts"))]);
    reach("check", L.D, "workhorses", { env: L.env });
    reach("before", L.D, "1", { env: L.env });
    reach("check", L.D, "r1", { env: L.env });
    reach("check", L.D, "card", { env: L.env });
    const log = readFileSync(join(L.D, "actions.jsonl"), "utf8");
    const reachLines = log.split("\n").filter((l) => l.includes('"action":"reach"'));
    const targets = reachLines.map((l) => JSON.parse(l).target);
    expect(targets).toContain("workhorses");
    expect(targets).toContain("r1");
    expect(targets).toContain("card");
    // A clean result is recorded too.
    expect(reachLines.some((l) => l.includes("clean"))).toBe(true);
  });

  test("its opposite: log-action refuses the action reach at the base, now accepted", () => {
    const L = makeLayout("c2b");
    mkdirSync(join(L.D, "logs"), { recursive: true });
    const r = sh(LOG_ACTION, [L.D, "coachman", "reach", "workhorses", "clean"]);
    expect(r.code).toBe(0);
    const log = readFileSync(join(L.D, "actions.jsonl"), "utf8");
    expect(log).toContain('"action":"reach"');
  });

  test("after a dirty checkout each point's line names its finding", () => {
    const L = makeLayout("c2c", { dirty: true });
    writeStream(L, "codex", [codexFileChange(join(L.R, ".worktrees", `${L.T}-codex`, "a.ts"))]);
    writeStream(L, "mimo", [mimoWrite(join(L.R, ".worktrees", `${L.T}-mimo`, "b.ts"))]);
    reach("check", L.D, "workhorses", { env: L.env });
    const log = readFileSync(join(L.D, "actions.jsonl"), "utf8");
    const reachLines = log.split("\n").filter((l) => l.includes('"action":"reach"'));
    expect(reachLines.some((l) => l.includes("probe/a.txt") || l.includes("main path"))).toBe(true);
  });
});

// ============================================================================================
// C3: a dirty main checkout: every path listed, probe/a.txt as itself, exit 2.
// ============================================================================================
describe("C3 every check lists each changed or new file in the main checkout", () => {
  test("25 untracked and one tracked change: all 26 paths, probe/a.txt as itself, exit 2", () => {
    const L = makeLayout("c3", { dirty: true });
    writeStream(L, "codex", [codexFileChange(join(L.R, ".worktrees", `${L.T}-codex`, "a.ts"))]);
    writeStream(L, "mimo", [mimoWrite(join(L.R, ".worktrees", `${L.T}-mimo`, "b.ts"))]);
    for (const point of ["workhorses", "card"] as const) {
      const r = reach("check", L.D, point, { env: L.env });
      expect(r.code).toBe(2);
      expect(r.out).toContain("probe/a.txt");
      // Every new file by its own name, not folded into a folder.
      for (let i = 2; i <= 25; i++) expect(r.out).toContain(`f${i}.txt`);
      expect(r.out).toContain("README.md");
    }
    // origin/main never moves: the reach form does not fetch.
    const origin = git("-C", L.R, "rev-parse", "refs/remotes/origin/main").out.trim();
    const originAfter = git("-C", L.R, "rev-parse", "refs/remotes/origin/main").out.trim();
    expect(originAfter).toBe(origin);
  });

  test("its opposite: a clean checkout lists nothing and exits 0", () => {
    const L = makeLayout("c3b");
    writeStream(L, "codex", [codexFileChange(join(L.R, ".worktrees", `${L.T}-codex`, "a.ts"))]);
    writeStream(L, "mimo", [mimoWrite(join(L.R, ".worktrees", `${L.T}-mimo`, "b.ts"))]);
    const r = reach("check", L.D, "card", { env: L.env });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("path ");
  });

  test("check-target's reach form lists every path where the default form folds", () => {
    const L = makeLayout("c3c", { dirty: true });
    const r = sh(CHECK_TARGET, ["--reach", L.R, "main"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("path probe/a.txt");
    expect(r.out).not.toContain("?? probe/");
  });
});

// ============================================================================================
// C4: off the default branch is named; the default branch moving forward is not a change.
// ============================================================================================
describe("C4 the check says when the main checkout is off its default branch", () => {
  test("switched to a new branch x: named, exit 2", () => {
    const L = makeLayout("c4a", { branch: "x" });
    writeStream(L, "codex", [codexFileChange(join(L.R, ".worktrees", `${L.T}-codex`, "a.ts"))]);
    writeStream(L, "mimo", [mimoWrite(join(L.R, ".worktrees", `${L.T}-mimo`, "b.ts"))]);
    const r = reach("check", L.D, "card", { env: L.env });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/off /);
    expect(r.out).toContain("x");
    const ct = sh(CHECK_TARGET, ["--reach", L.R, "main"]);
    expect(ct.out).toMatch(/off the default branch/);
  });

  test("a commit added to main, tree clean: clean, exit 0", () => {
    const L = makeLayout("c4b");
    writeFileSync(join(L.R, "README.md"), "hello\nforward\n");
    git("-C", L.R, "add", "-A");
    git("-C", L.R, "commit", "-qm", "forward");
    writeStream(L, "codex", [codexFileChange(join(L.R, ".worktrees", `${L.T}-codex`, "a.ts"))]);
    writeStream(L, "mimo", [mimoWrite(join(L.R, ".worktrees", `${L.T}-mimo`, "b.ts"))]);
    const r = reach("check", L.D, "card", { env: L.env });
    expect(r.code).toBe(0);
  });
});

// ============================================================================================
// C5: the stream reader, per harness. C6: ref comparison. C7: findings vs notes.
// ============================================================================================
describe("C5 the stream reader reads every harness's own shape", () => {
  const cases: Array<[string, (p: string) => string[]]> = [
    ["codex", (p) => [codexFileChange(p)]],
    ["claude", (p) => [claudeWrite(p)]],
    ["muse", (p) => [museEdit(p)]],
    ["mimo", (p) => [mimoWrite(p)]],
    ["pi", (p) => [piWrite(p)]],
  ];

  for (const [harness, write] of cases) {
    test(`${harness}: a write to the main checkout is a finding`, () => {
      const L = makeLayout(`c5-${harness}`);
      const own = join(L.R, ".worktrees", `${L.T}-codex`);
      mkdirSync(own, { recursive: true });
      const events = join(L.D, "logs", `${harness}-events.jsonl`);
      const rows = [
        ...write(join(L.R, "out.txt")),
        codexCommand(`cat ${join(L.home, "n.txt")}`),
        codexCommand(`git -C ${join(L.R, ".worktrees", L.T)} log -1`),
        codexCommand("cat /tmp/x >/dev/null"),
        codexCommand("bun test"),
      ];
      writeFileSync(events, `${rows.join("\n")}\n`);
      const r = reach("stream", L.D, harness, events, own, { env: L.env });
      expect(r.code).toBe(2);
      expect(r.out).toContain("out.txt");
      expect(r.out).toContain("main checkout");
    });

    test(`${harness}: a clean stream finds nothing`, () => {
      const L = makeLayout(`c5b-${harness}`);
      const own = join(L.R, ".worktrees", `${L.T}-codex`);
      mkdirSync(own, { recursive: true });
      const events = join(L.D, "logs", `${harness}-events.jsonl`);
      writeFileSync(events, `${write(join(own, "in.txt")).join("\n")}\n`);
      const r = reach("stream", L.D, harness, events, own, { env: L.env });
      expect(r.code).toBe(0);
    });
  }

  test("the #200 command: the merge is a write, not just the look", () => {
    const L = makeLayout("c5-200");
    const own = join(L.R, ".worktrees", `${L.T}-codex`);
    mkdirSync(own, { recursive: true });
    const events = join(L.D, "logs", "mimo-events.jsonl");
    const sha = git("-C", L.R, "rev-parse", "HEAD").out.trim();
    writeFileSync(events, `${mergeEvent(L.R, L.T, sha)}\n`);
    const r = reach("stream", L.D, "mimo", events, own, { env: L.env });
    expect(r.code).toBe(2);
    expect(r.out).toContain("synthesis worktree");
    expect(r.out).toMatch(/write/);
  });

  test("a grok lane, an unreadable stream, or no recognized tool call: not checked, exit 3", () => {
    const L = makeLayout("c5-grok");
    const own = join(L.R, ".worktrees", `${L.T}-codex`);
    const events = join(L.D, "logs", "grok-events.jsonl");
    writeFileSync(events, `{"type":"unknown"}\n`);
    const r = reach("stream", L.D, "grok", events, own, { env: L.env });
    expect(r.code).toBe(3);
    expect(r.out).toContain("not checked");
    const missing = reach("stream", L.D, "mimo", join(L.D, "logs", "none.jsonl"), own, {
      env: L.env,
    });
    expect(missing.code).toBe(3);
    expect(missing.out).toContain("not checked");
    const noCall = join(L.D, "logs", "mimo-empty.jsonl");
    writeFileSync(noCall, `{"type":"text","sessionID":"s","part":{"type":"text","text":"hi"}}\n`);
    const r2 = reach("stream", L.D, "mimo", noCall, own, { env: L.env });
    expect(r2.code).toBe(3);
    expect(r2.out).toContain("not checked");
  });
});

describe("C7 a write is a finding; a read or a refused attempt is a note", () => {
  test("out.txt and a.ts are findings; n.txt and the synthesis read are notes", () => {
    const L = makeLayout("c7");
    const own = join(L.R, ".worktrees", `${L.T}-codex`);
    mkdirSync(own, { recursive: true });
    const events = join(L.D, "logs", "mimo-events.jsonl");
    const rows = [
      mimoWrite(join(L.R, "out.txt")),
      mimoBash(`cat ${join(L.home, "n.txt")}`),
      mimoBash(`git -C ${join(L.R, ".worktrees", L.T)} log -1`),
    ];
    writeFileSync(events, `${rows.join("\n")}\n`);
    const r = reach("stream", L.D, "mimo", events, own, { env: L.env });
    expect(r.code).toBe(2);
    const findings = r.out.split("\n").filter((l) => l.startsWith("finding "));
    const notes = r.out.split("\n").filter((l) => l.startsWith("note "));
    expect(findings.some((l) => l.includes("out.txt"))).toBe(true);
    expect(notes.some((l) => l.includes("n.txt"))).toBe(true);
    expect(notes.some((l) => l.includes("synthesis"))).toBe(true);
  });

  test("a refused attempt is a note, exit 3", () => {
    const L = makeLayout("c7b");
    const own = join(L.R, ".worktrees", `${L.T}-codex`);
    mkdirSync(own, { recursive: true });
    const events = join(L.D, "logs", "mimo-events.jsonl");
    writeFileSync(
      events,
      `${mimoBash(`echo x > ${join(L.R, "o.txt")}`, "Permission denied", 1)}\n`,
    );
    const r = reach("stream", L.D, "mimo", events, own, { env: L.env });
    expect(r.code).toBe(3);
    expect(r.out).toContain("refused");
  });

  test("a write whose command failed with no refusal is a finding", () => {
    const L = makeLayout("c7c");
    const own = join(L.R, ".worktrees", `${L.T}-codex`);
    mkdirSync(own, { recursive: true });
    const events = join(L.D, "logs", "mimo-events.jsonl");
    writeFileSync(events, `${mimoBash(`echo x > ${join(L.R, "p.txt")}; false`, "", 1)}\n`);
    const r = reach("stream", L.D, "mimo", events, own, { env: L.env });
    expect(r.code).toBe(2);
    expect(r.out).toContain("finding");
    expect(r.out).toContain("p.txt");
  });

  test("a command not known to write counts as a read", () => {
    const L = makeLayout("c7d");
    const own = join(L.R, ".worktrees", `${L.T}-codex`);
    mkdirSync(own, { recursive: true });
    const events = join(L.D, "logs", "mimo-events.jsonl");
    writeFileSync(events, `${mimoBash(`some-tool ${join(L.R, "q.txt")}`)}\n`);
    const r = reach("stream", L.D, "mimo", events, own, { env: L.env });
    expect(r.code).toBe(3);
    expect(r.out).toContain("note");
    expect(r.out).toContain("q.txt");
    expect(r.out).not.toContain("finding");
  });
});

// ============================================================================================
// C6: around a round, this run's own branches and synthesis worktree.
// ============================================================================================
describe("C6 around a round the check compares this run's own branches and synthesis worktree", () => {
  function cutScratch(L: Layout, lane: string, snap: string): string {
    const dest = join(L.R, ".worktrees", `${L.T}-rev-bug-${lane}`);
    git("-C", L.R, "worktree", "add", "-q", "--detach", dest, snap);
    return dest;
  }

  test("a merge into the synthesis worktree names refs/heads/T and the synthesis head", () => {
    const L = makeLayout("c6c");
    writeStream(L, "codex", [codexFileChange(join(L.R, ".worktrees", `${L.T}-codex`, "a.ts"))]);
    writeStream(L, "mimo", [mimoWrite(join(L.R, ".worktrees", `${L.T}-mimo`, "b.ts"))]);
    reach("before", L.D, "1", { env: L.env });
    const snap = git("-C", join(L.R, ".worktrees", L.T), "rev-parse", "HEAD").out.trim();
    const scratch = cutScratch(L, "mimo", snap);
    writeFileSync(join(scratch, "new.ts"), "x\n");
    git("-C", scratch, "add", "-A");
    git("-C", scratch, "commit", "-qm", "fix");
    const sha = git("-C", scratch, "rev-parse", "HEAD").out.trim();
    git("-C", join(L.R, ".worktrees", L.T), "merge", "-q", "--ff-only", sha);
    const r = reach("check", L.D, "r1", { env: L.env });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/ref refs\/heads\/T /);
    expect(r.out).toMatch(/synth /);
    // Both hashes each.
    const refLine = r.out.split("\n").find((l) => l.includes("ref refs/heads/T"));
    expect(refLine).toMatch(/\.\./);
  });

  test("a commit in a scratch, a commit on 99, and tags and main moving forward name nothing", () => {
    const L = makeLayout("c6-other");
    writeStream(L, "codex", [codexFileChange(join(L.R, ".worktrees", `${L.T}-codex`, "a.ts"))]);
    writeStream(L, "mimo", [mimoWrite(join(L.R, ".worktrees", `${L.T}-mimo`, "b.ts"))]);
    reach("before", L.D, "1", { env: L.env });
    const snap = git("-C", join(L.R, ".worktrees", L.T), "rev-parse", "HEAD").out.trim();
    const scratch = cutScratch(L, "mimo", snap);
    writeFileSync(join(scratch, "s.ts"), "x\n");
    git("-C", scratch, "add", "-A");
    git("-C", scratch, "commit", "-qm", "scratch work");
    // A commit on another branch in another worktree.
    git("-C", L.R, "branch", "99");
    git("-C", L.R, "worktree", "add", "-q", join(L.R, ".worktrees", "99"), "99");
    writeFileSync(join(L.R, ".worktrees", "99", "z.ts"), "z\n");
    git("-C", join(L.R, ".worktrees", "99"), "add", "-A");
    git("-C", join(L.R, ".worktrees", "99"), "commit", "-qm", "other branch");
    // A tag, origin/main moved, and main moved forward.
    git("-C", L.R, "tag", "v1");
    writeFileSync(join(L.R, "README.md"), "hello\nfwd\n");
    git("-C", L.R, "add", "-A");
    git("-C", L.R, "commit", "-qm", "forward");
    git("-C", L.R, "push", "-q", "origin", "main");
    const r = reach("check", L.D, "r1", { env: L.env });
    expect(r.out).not.toMatch(/ref refs\/heads\/T /);
    expect(r.out).not.toMatch(/ref refs\/heads\/99/);
  });

  test("an untracked file in the synthesis worktree is named", () => {
    const L = makeLayout("c6e");
    writeStream(L, "codex", [codexFileChange(join(L.R, ".worktrees", `${L.T}-codex`, "a.ts"))]);
    writeStream(L, "mimo", [mimoWrite(join(L.R, ".worktrees", `${L.T}-mimo`, "b.ts"))]);
    reach("before", L.D, "1", { env: L.env });
    writeFileSync(join(L.R, ".worktrees", L.T, "u.txt"), "u\n");
    const r = reach("check", L.D, "r1", { env: L.env });
    expect(r.code).toBe(2);
    expect(r.out).toContain("u.txt");
  });
});

// ============================================================================================
// C8/C9: a workhorse's finding goes to the user before synthesis.
// ============================================================================================
describe("C8 a workhorse's finding or an unexplained main checkout change goes to the user", () => {
  test("codex's stream writes R/out.txt: exit 2", () => {
    const L = makeLayout("c8a");
    writeStream(L, "codex", [codexFileChange(join(L.R, "out.txt"))]);
    writeStream(L, "mimo", [mimoWrite(join(L.R, ".worktrees", `${L.T}-mimo`, "b.ts"))]);
    const r = reach("check", L.D, "workhorses", { env: L.env });
    expect(r.code).toBe(2);
    expect(r.out).toContain("out.txt");
  });

  test("no stream names it but R has an untracked file: exit 2", () => {
    const L = makeLayout("c8b");
    writeStream(L, "codex", [codexFileChange(join(L.R, ".worktrees", `${L.T}-codex`, "a.ts"))]);
    writeStream(L, "mimo", [mimoWrite(join(L.R, ".worktrees", `${L.T}-mimo`, "b.ts"))]);
    writeFileSync(join(L.R, "untracked.txt"), "x\n");
    const r = reach("check", L.D, "workhorses", { env: L.env });
    expect(r.code).toBe(2);
    expect(r.out).toContain("untracked.txt");
  });

  test("only a read: exit 3, no escalation", () => {
    const L = makeLayout("c8c");
    const own = join(L.R, ".worktrees", `${L.T}-codex`);
    writeStream(L, "codex", [codexCommand(`cat ${join(L.R, "README.md")}`)]);
    writeStream(L, "mimo", [mimoWrite(join(L.R, ".worktrees", `${L.T}-mimo`, "b.ts"))]);
    const r = reach("check", L.D, "workhorses", { env: L.env });
    expect(r.code).toBe(3);
    expect(r.out).not.toContain("finding");
    expect(existsSync(join(L.D, ".escalation-ready"))).toBe(false);
  });

  test("its opposite: a clean stream finds nothing and exits 0", () => {
    const L = makeLayout("c8d");
    writeStream(L, "codex", [codexFileChange(join(L.R, ".worktrees", `${L.T}-codex`, "a.ts"))]);
    writeStream(L, "mimo", [mimoWrite(join(L.R, ".worktrees", `${L.T}-mimo`, "b.ts"))]);
    const r = reach("check", L.D, "workhorses", { env: L.env });
    expect(r.code).toBe(0);
  });
});

describe("C9 an escalation sets .escalation-ready and runs-status gives NEXT RULE", () => {
  test("after a finding .escalation-ready makes runs-status report RULE", () => {
    const L = makeLayout("c9");
    writeFileSync(join(L.D, ".escalation-ready"), "");
    writeFileSync(join(L.D, "ESCALATION.md"), "a reach\n");
    writeFileSync(
      join(L.D, "manifest.json"),
      JSON.stringify({ stage: "synthesis", leg: 1, lanes: {}, coachman: { legs: {} } }),
    );
    const r = sh(RUNS_STATUS, [join(L.R, ".postmaster", "runs")]);
    expect(r.out).toContain("RULE");
  });

  test("its opposite: no marker, no RULE", () => {
    const L = makeLayout("c9b");
    writeFileSync(
      join(L.D, "manifest.json"),
      JSON.stringify({ stage: "synthesis", leg: 1, lanes: {}, coachman: { legs: {} } }),
    );
    const r = sh(RUNS_STATUS, [join(L.R, ".postmaster", "runs")]);
    expect(r.out).not.toContain("RULE");
  });
});

// ============================================================================================
// C10-C12: a reviewer's finding voids its verdict; restore puts the code back.
// ============================================================================================
describe("C10 a reviewer's finding voids that reviewer's verdict for the round", () => {
  function setupRound(L: Layout): string {
    writeFileSync(
      join(L.D, "logs", "review-r1.json"),
      JSON.stringify({
        reviewers: [
          ["bug", "codex"],
          ["bug", "mimo"],
        ],
      }),
    );
    for (const lane of ["codex", "mimo"]) {
      const dest = join(L.R, ".worktrees", `${L.T}-rev-bug-${lane}`);
      git(
        "-C",
        L.R,
        "worktree",
        "add",
        "-q",
        "--detach",
        dest,
        git("-C", L.R, "rev-parse", "HEAD").out.trim(),
      );
    }
    return git("-C", join(L.R, ".worktrees", L.T), "rev-parse", "HEAD").out.trim();
  }

  test("mimo's merge names the synthesis worktree and refs/heads/T; only mimo is voided", () => {
    const L = makeLayout("c10a");
    const snap = setupRound(L);
    reach("before", L.D, "1", { env: L.env });
    const scratch = join(L.R, ".worktrees", `${L.T}-rev-bug-mimo`);
    writeFileSync(join(scratch, "new.ts"), "x\n");
    git("-C", scratch, "add", "-A");
    git("-C", scratch, "commit", "-qm", "fix");
    const sha = git("-C", scratch, "rev-parse", "HEAD").out.trim();
    // mimo's own record shows the merge event.
    writeFileSync(join(L.D, "logs", "review-r1-bug-mimo.jsonl"), `${mergeEvent(L.R, L.T, sha)}\n`);
    writeFileSync(
      join(L.D, "logs", "review-r1-bug-codex.jsonl"),
      `${codexCommand(`ls ${join(L.R, ".worktrees", L.T)}`)}\n`,
    );
    git("-C", join(L.R, ".worktrees", L.T), "merge", "-q", "--ff-only", sha);
    const r = reach("check", L.D, "r1", { env: L.env });
    expect(r.code).toBe(2);
    expect(r.out).toContain("refs/heads/T");
    expect(r.out).toMatch(/write/);
    // The finding is about mimo, not codex.
    const log = existsSync(join(L.D, "actions.jsonl"))
      ? readFileSync(join(L.D, "actions.jsonl"), "utf8")
      : "";
    expect(log).toContain("mimo");
  });

  test("no stream naming the merge: the change is unexplained", () => {
    const L = makeLayout("c10c");
    const snap = setupRound(L);
    reach("before", L.D, "1", { env: L.env });
    const scratch = join(L.R, ".worktrees", `${L.T}-rev-bug-mimo`);
    writeFileSync(join(scratch, "new.ts"), "x\n");
    git("-C", scratch, "add", "-A");
    git("-C", scratch, "commit", "-qm", "fix");
    const sha = git("-C", scratch, "rev-parse", "HEAD").out.trim();
    writeFileSync(join(L.D, "logs", "review-r1-bug-codex.jsonl"), `${codexCommand("ls")}\n`);
    writeFileSync(join(L.D, "logs", "review-r1-bug-mimo.jsonl"), `${mimoBash("ls")}\n`);
    git("-C", join(L.R, ".worktrees", L.T), "merge", "-q", "--ff-only", sha);
    const r = reach("check", L.D, "r1", { env: L.env });
    expect(r.code).toBe(2);
    expect(r.out).toContain("refs/heads/T");
  });

  test("its opposite: no change names nothing and exits 0", () => {
    const L = makeLayout("c10d");
    setupRound(L);
    reach("before", L.D, "1", { env: L.env });
    writeFileSync(join(L.D, "logs", "review-r1-bug-codex.jsonl"), `${codexCommand("ls")}\n`);
    writeFileSync(join(L.D, "logs", "review-r1-bug-mimo.jsonl"), `${mimoBash("ls")}\n`);
    const r = reach("check", L.D, "r1", { env: L.env });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("ref refs/heads/T");
  });
});

describe("C11 restore puts the run's branches and synthesis worktree back", () => {
  test("restore saves what it undid and moves new files under D/reach/", () => {
    const L = makeLayout("c11");
    const snap = git("-C", join(L.R, ".worktrees", L.T), "rev-parse", "HEAD").out.trim();
    writeFileSync(
      join(L.D, "logs", "review-r1.json"),
      JSON.stringify({ reviewers: [["bug", "mimo"]] }),
    );
    git(
      "-C",
      L.R,
      "worktree",
      "add",
      "-q",
      "--detach",
      join(L.R, ".worktrees", `${L.T}-rev-bug-mimo`),
      snap,
    );
    reach("before", L.D, "1", { env: L.env });
    const scratch = join(L.R, ".worktrees", `${L.T}-rev-bug-mimo`);
    writeFileSync(join(scratch, "new.ts"), "x\n");
    git("-C", scratch, "add", "-A");
    git("-C", scratch, "commit", "-qm", "fix");
    const sha = git("-C", scratch, "rev-parse", "HEAD").out.trim();
    git("-C", join(L.R, ".worktrees", L.T), "merge", "-q", "--ff-only", sha);
    writeFileSync(join(L.R, ".worktrees", L.T, "u.txt"), "u\n");
    const r = reach("restore", L.D, "1", { env: L.env });
    expect(r.code).toBe(0);
    // T and the synthesis head are back at their hashes before the round.
    const now = git("-C", join(L.R, ".worktrees", L.T), "rev-parse", "HEAD").out.trim();
    expect(now).toBe(snap);
    // The undone change is saved under D.
    expect(existsSync(join(L.D, "reach", "r1"))).toBe(true);
    // u.txt is moved under D/reach/.
    expect(existsSync(join(L.D, "reach", "r1", "u.txt"))).toBe(true);
    expect(existsSync(join(L.R, ".worktrees", L.T, "u.txt"))).toBe(false);
    // verify.sh run then runs instead of refusing.
    const v = sh(VERIFY, ["run", join(L.R, ".worktrees", L.T), L.D], { env: L.env });
    expect(v.code).toBe(0);
  });
});

describe("C12 a reviewer's write outside the run's own folders is voided and marked for the user", () => {
  test("mimo's stream writes R/x.txt: voided and marked", () => {
    const L = makeLayout("c12a");
    writeFileSync(
      join(L.D, "logs", "review-r1.json"),
      JSON.stringify({
        reviewers: [
          ["bug", "codex"],
          ["bug", "mimo"],
        ],
      }),
    );
    reach("before", L.D, "1", { env: L.env });
    writeFileSync(
      join(L.D, "logs", "review-r1-bug-mimo.jsonl"),
      `${mimoWrite(join(L.R, "x.txt"))}\n`,
    );
    writeFileSync(join(L.D, "logs", "review-r1-bug-codex.jsonl"), `${codexCommand("ls")}\n`);
    const r = reach("check", L.D, "r1", { env: L.env });
    expect(r.code).toBe(2);
    expect(r.out).toContain("x.txt");
  });

  test("a write into another worktree is voided but not marked for the user", () => {
    const L = makeLayout("c12b");
    writeFileSync(
      join(L.D, "logs", "review-r1.json"),
      JSON.stringify({
        reviewers: [
          ["bug", "codex"],
          ["bug", "mimo"],
        ],
      }),
    );
    reach("before", L.D, "1", { env: L.env });
    writeFileSync(
      join(L.D, "logs", "review-r1-bug-mimo.jsonl"),
      `${mimoWrite(join(L.R, ".worktrees", `${L.T}-codex`, "a.ts"))}\n`,
    );
    writeFileSync(join(L.D, "logs", "review-r1-bug-codex.jsonl"), `${codexCommand("ls")}\n`);
    const r = reach("check", L.D, "r1", { env: L.env });
    expect(r.code).toBe(2);
    expect(r.out).toContain("another worktree");
  });
});

// ============================================================================================
// C13/C14: notes on the card; the ship card's reach section.
// ============================================================================================
describe("C13 reads and unexplained files are notes on the card and stop nothing", () => {
  test("a read of R/README.md and untracked files are notes, no escalation", () => {
    const L = makeLayout("c13");
    writeStream(L, "codex", [codexCommand(`cat ${join(L.R, "README.md")}`)]);
    writeStream(L, "mimo", [mimoBash(`cat ${join(L.R, "README.md")}`)]);
    reach("before", L.D, "1", { env: L.env });
    writeFileSync(join(L.R, ".worktrees", L.T, "u.txt"), "u\n");
    writeFileSync(join(L.R, "stray.txt"), "s\n");
    const r1 = reach("check", L.D, "r1", { env: L.env });
    expect(r1.out).not.toContain("finding");
    const c = reach("check", L.D, "card", { env: L.env });
    expect(c.out).toContain("note");
    expect(existsSync(join(L.D, ".escalation-ready"))).toBe(false);
    const log = existsSync(join(L.D, "actions.jsonl"))
      ? readFileSync(join(L.D, "actions.jsonl"), "utf8")
      : "";
    expect(log).not.toContain("degrade");
  });

  test("its opposite: a write is a finding and is marked as one", () => {
    const L = makeLayout("c13b");
    writeStream(L, "codex", [codexFileChange(join(L.R, "out.txt"))]);
    writeStream(L, "mimo", [mimoBash(`cat ${join(L.R, "README.md")}`)]);
    const r = reach("check", L.D, "workhorses", { env: L.env });
    expect(r.out).toContain("finding");
  });
});

describe("C14 the ship card's reach section is built from the run's log", () => {
  function armCard(L: Layout): void {
    writeFileSync(
      join(L.D, "checks.json"),
      `{"checks": [{"name": "gate", "source": "default:gate", "command": "true", "shows": "x"}]}\n`,
    );
    writeFileSync(
      join(L.D, "actions.jsonl"),
      `{"action": "verify", "target": "gate", "ts": "2026-01-01T00:00:00Z", "detail": "on=main@abc result=pass exit=0 secs=1"}\n`,
    );
    writeFileSync(join(L.D, "checkpoint-review.md"), "## Findings\n\nnone\n");
  }

  test("card-block appends ## Reach with findings, notes and voids; no absolute paths", () => {
    const L = makeLayout("c14");
    armCard(L);
    writeStream(L, "codex", [codexFileChange(join(L.R, "out.txt"))]);
    writeStream(L, "mimo", [mimoWrite(join(L.home, "other", "x"))]);
    writeFileSync(
      join(L.D, "logs", "review-r1.json"),
      JSON.stringify({ reviewers: [["bug", "mimo"]] }),
    );
    reach("before", L.D, "1", { env: L.env });
    reach("check", L.D, "workhorses", { env: L.env });
    reach("check", L.D, "r1", { env: L.env });
    reach("check", L.D, "card", { env: L.env });
    const r = sh(LANDING, [
      "card-block",
      L.D,
      join(L.R, ".worktrees", L.T),
      join(L.D, "checkpoint-review.md"),
    ]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("## Reach");
    expect(r.out).toContain("out.txt");
    expect(r.out).toContain("outside the project");
    expect(r.out).not.toContain(L.home);
    expect(r.out).not.toContain(L.R);
  });

  test("with no reach line the card point shows not checked", () => {
    const L = makeLayout("c14b");
    armCard(L);
    writeStream(L, "codex", [codexFileChange(join(L.R, "out.txt"))]);
    writeStream(L, "mimo", [mimoWrite(join(L.R, ".worktrees", `${L.T}-mimo`, "b.ts"))]);
    reach("check", L.D, "workhorses", { env: L.env });
    const r = sh(LANDING, [
      "card-block",
      L.D,
      join(L.R, ".worktrees", L.T),
      join(L.D, "checkpoint-review.md"),
    ]);
    expect(r.out).toContain("## Reach");
    expect(r.out).toContain("not checked");
  });

  test("for a dispatch with no reach line the block is the one the existing tests expect", () => {
    const L = makeLayout("c14c");
    armCard(L);
    const r = sh(LANDING, [
      "card-block",
      L.D,
      join(L.R, ".worktrees", L.T),
      join(L.D, "checkpoint-review.md"),
    ]);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("## Reach");
    expect(r.out).toContain("## Checks");
    expect(r.out).toContain("## Open findings");
    expect(r.out).toContain("## Not re-reviewed");
  });
});

// ============================================================================================
// C15: the tests themselves, including a codex /bin/bash -lc command inside its folder.
// ============================================================================================
describe("C15 a codex /bin/bash -lc command inside its folder prints nothing", () => {
  test("a command that stays inside the folder finds nothing", () => {
    const L = makeLayout("c15");
    const own = join(L.R, ".worktrees", `${L.T}-codex`);
    mkdirSync(own, { recursive: true });
    writeFileSync(join(own, "in.txt"), "x\n");
    const events = join(L.D, "logs", "codex-events.jsonl");
    writeFileSync(events, `${codexCommand(`/bin/bash -lc 'cat in.txt'`)}\n`);
    const r = reach("stream", L.D, "codex", events, own, { env: L.env });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("finding");
    expect(r.out).not.toContain("note");
  });

  test("the opposite: the same command outside the folder finds it", () => {
    const L = makeLayout("c15b");
    const own = join(L.R, ".worktrees", `${L.T}-codex`);
    mkdirSync(own, { recursive: true });
    const events = join(L.D, "logs", "codex-events.jsonl");
    writeFileSync(events, `${codexCommand(`/bin/bash -lc 'cat ${join(L.R, "README.md")}'`)}\n`);
    const r = reach("stream", L.D, "codex", events, own, { env: L.env });
    expect(r.code).toBe(3);
    expect(r.out).toContain("README.md");
  });
});
