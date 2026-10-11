import { describe, expect, test } from "bun:test";
import { code, isFlowScript, listing, PRIMITIVES, scan, table } from "./primitives.ts";

const files = {
  "scripts/a.ts": 'Bun.spawn(["git"]); process.kill(-pid, "SIGTERM"); writeFileSync("x.done", "")',
  "scripts/b.ts": 'execSync("systemd-run --user --scope -p MemoryMax=8G x"); readFileSync("/proc/self/stat")',
  "scripts/c.ts": "export const add = (a: number, b: number) => a + b;",
  "scripts/e.ts": 'import { run } from "./lib/proc.ts"; run(["ls"]);',
};

describe("scan", () => {
  const hits = scan(files);

  test("positive control: each made-up use is found in the file that has it", () => {
    expect(hits.spawn).toEqual(["scripts/a.ts", "scripts/b.ts"]);
    expect(hits.signal).toEqual(["scripts/a.ts"]);
    expect(hits.marker).toEqual(["scripts/a.ts"]);
    expect(hits.cgroup).toEqual(["scripts/b.ts"]);
    expect(hits.proc).toEqual(["scripts/b.ts"]);
    expect(hits.helpers).toEqual(["scripts/e.ts"]);
  });

  test("negative control: a pure file matches nothing, and a primitive nobody uses reads zero", () => {
    for (const p of PRIMITIVES) expect(hits[p.id]).not.toContain("scripts/c.ts");
    expect(hits.sandbox).toEqual([]);
    expect(hits.host).toEqual([]);
    expect(hits.symlink).toEqual([]);
  });

  test("a file is counted once per primitive however often it uses it", () => {
    const twice = scan({ "scripts/d.ts": "Bun.spawn(a); Bun.spawn(b); spawnSync(c)" });
    expect(twice.spawn).toEqual(["scripts/d.ts"]);
  });
});

describe("git worktree", () => {
  test("positive control: a call as an argument list and as a command string both count", () => {
    const hits = scan({
      "scripts/x.ts": 'git(["-C", dir, "worktree", "add", path]);',
      "scripts/y.ts": "run(`git -C ${dir} worktree remove --force ${path}`);",
    });
    expect(hits.worktree).toEqual(["scripts/x.ts", "scripts/y.ts"]);
  });

  test("negative control: the word in a path, in prose or in a comment, or another tool's worktree command, does not count", () => {
    const hits = scan({
      "scripts/p.ts": 'const dir = join(root, ".worktrees", name); // a git worktree add comes later',
      "scripts/q.ts": "/* git worktree add is run by the coachman */\nconst note = 'the worktree is cut here';",
      "scripts/r.ts": 'run(["herdr", "worktree", "list"]);',
    });
    expect(hits.worktree).toEqual([]);
  });
});

describe("marker, pid and lock files", () => {
  test("positive control: a pid file, a lock file and a done marker each count", () => {
    const hits = scan({
      "scripts/a.ts": 'join(dispatch, "render", "preview.pid")',
      "scripts/b.ts": 'join(dispatch, ".aftercare.lock")',
      "scripts/c.ts": "`.leg-${n}-done`",
    });
    expect(hits.marker).toEqual(["scripts/a.ts", "scripts/b.ts", "scripts/c.ts"]);
  });

  test("negative control: a target project's lock files and a process's own pid do not count", () => {
    const hits = scan({
      "scripts/a.ts": 'existsSync(join(repo, "bun.lock")) || existsSync("yarn.lock") || existsSync("Cargo.lock")',
      "scripts/b.ts": "const id = `${process.pid}-${child.pid}`; if (probe.pid !== p.pgid) fail();",
    });
    expect(hits.marker).toEqual([]);
  });
});

describe("code", () => {
  test("drops full-line, trailing and block comments, and keeps a URL's double slash", () => {
    const text = code('// tmux here\nconst u = "https://x"; // herdr there\n/* symlinkSync */\nconst a = 1;');
    expect(text).toContain("https://x");
    expect(text).not.toContain("tmux");
    expect(text).not.toContain("herdr");
    expect(text).not.toContain("symlinkSync");
    expect(text).toContain("const a = 1;");
  });

  test("a comment's mention does not make a script count, a real use does", () => {
    const hits = scan({ "scripts/a.ts": "// uses tmux", "scripts/b.ts": 'run(["tmux", "new-session"]);' });
    expect(hits.host).toEqual(["scripts/b.ts"]);
  });
});

describe("isFlowScript", () => {
  test("keeps the flow's scripts and leaves out tests, self-tests, oracles and acceptance runs", () => {
    expect(isFlowScript("host.ts")).toBe(true);
    expect(isFlowScript("fixture.ts")).toBe(true);
    expect(isFlowScript("host.test.ts")).toBe(false);
    expect(isFlowScript("host-self-test.ts")).toBe(false);
    expect(isFlowScript("walls-oracle.ts")).toBe(false);
    expect(isFlowScript("front-door-acceptance.ts")).toBe(false);
    expect(isFlowScript("notes.md")).toBe(false);
  });
});

describe("table and listing", () => {
  test("the table lists every primitive with its count out of the total", () => {
    const text = table(scan(files), 4);
    expect(text).toContain("| starts child processes | 2 | 4 |");
    expect(text).toContain("| uses bwrap or sandbox-exec, to wrap a harness or to probe for them | 0 | 4 |");
  });

  test("the listing names the files behind a count, and says none for a primitive nobody uses", () => {
    const text = listing(scan(files));
    expect(text).toContain("- starts child processes: a.ts, b.ts");
    expect(text).toContain("- makes symbolic links: none");
  });
});
