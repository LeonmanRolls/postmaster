// Tests for the provider-wall record launch.sh writes as a launch ends (C1, C3, C4): the
// coachman's own step through host.sh, stub harnesses first on PATH, each case in its own
// dispatch. A wall lands before the marker; the endings that are not walls record none.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const host = join(import.meta.dir, "host.sh");
const waitMarkers = join(import.meta.dir, "wait-for-markers.sh");

let tmp = "";
let bin = "";
const CLOCK = "1790000000000"; // 2026-09-21T08:53:20Z, pinned in every launch

const CODEX_WALL = JSON.stringify({
  type: "turn.failed",
  error: {
    message:
      "You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 2:29 AM.",
  },
});
const CLAUDE_WALL = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: true,
  result: "You've hit your weekly limit · resets 3am (UTC)",
  api_error_status: 429,
});
const MIMO_WALL = JSON.stringify({
  sessionID: "s-wall",
  type: "error",
  error: { name: "UsageLimitError", data: { message: "You have hit your usage limit." } },
});

interface Dispatch {
  d: string;
  wt: string;
}

function dispatch(name: string): Dispatch {
  const d = join(tmp, "runs", name);
  const wt = join(tmp, "wt", name);
  mkdirSync(join(d, "logs"), { recursive: true });
  mkdirSync(wt, { recursive: true });
  // The review form needs a real repo with a HEAD; every worktree has one.
  spawnSync("git", ["init", "-q", "-b", "main", wt]);
  spawnSync("git", [
    "-C",
    wt,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@example.invalid",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  ]);
  writeFileSync(
    join(d, "run.json"),
    `${JSON.stringify({
      config: {
        lanes: {
          stub: { harness: "codex", model: "test-model" },
          mimo: { harness: "mimo", model: "prov/mimo" },
          sec: { harness: "claude", model: "test-claude" },
          gr: { harness: "grok", model: "test-grok" },
        },
        team: { workhorses: ["stub", "mimo"] },
      },
    })}\n`,
  );
  writeFileSync(
    join(d, "brief.md"),
    `# Waybill: ${name}\nturnpikes: default\n\n## Project profile\nrepo: ${tmp}\n\n## Dispatch\nname: #1, ${name}\ndispatch: ${d}\nsynthesis worktree: ${wt}\ntool: ${join(import.meta.dir, "..")}\n`,
  );
  writeFileSync(join(tmp, "prompt.txt"), "Do the work.\n");
  return { d, wt };
}

/** Write the stub harness: its stdout is the stream, its exit the launch's. */
function stub(name: string, script: string): void {
  writeFileSync(join(bin, name), `#!/bin/sh\n${script}`);
  chmodSync(join(bin, name), 0o755);
}

function baseEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    POSTMASTER_HOST: "none",
    POSTMASTER_HOST_STATE: join(tmp, "hoststate"),
    POSTMASTER_CLOCK: CLOCK,
    TZ: "UTC",
  };
}

/** The coachman's own launch step; returns once the marker has landed. */
function launchStep(
  c: Dispatch,
  lane: string,
  kind: "lane" | "reviewer",
  harnessScript: string,
  harness: string,
  out: string,
  extra: string[] = [],
): { rc: number; marker: string; actions: string } {
  stub(harness, harnessScript);
  const marker = join(c.d, "logs", `${out}.done`);
  const argv = [
    host,
    "run",
    `${kind} · ${lane}`,
    c.wt,
    "--under",
    c.d,
    "--role",
    kind,
    "--run",
    c.d,
    "--out",
    join(c.d, "logs", `${out}.jsonl`),
    "--err",
    join(c.d, "logs", `${out}.err`),
    "--marker",
    marker,
    "--",
    join(import.meta.dir, "launch.sh"),
    kind === "reviewer" && extra.includes("review") ? "review" : "launch",
    ...(kind === "reviewer" && extra.includes("review")
      ? [lane, c.wt, "HEAD"]
      : [lane, c.wt, join(tmp, "prompt.txt")]),
    ...(kind === "reviewer" && extra.includes("review") ? [] : []),
    "--run",
    c.d,
  ];
  const r = spawnSync("bash", [argv[0]!, ...argv.slice(1)], { encoding: "utf8", env: baseEnv() });
  const rc = r.status ?? 1;
  const waited = spawnSync("bash", [waitMarkers, join(c.d, "logs"), `${out}.done`, "1", "60"], {
    encoding: "utf8",
    env: baseEnv(),
  });
  return { rc: waited.status ?? 1, marker, actions: join(c.d, "actions.jsonl") };
}

function wallsIn(actions: string): string[] {
  let text = "";
  try {
    text = readFileSync(actions, "utf8");
  } catch {
    return [];
  }
  return text.split("\n").filter((l) => l.includes('"action":"wall"'));
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "launch-walls-"));
  bin = join(tmp, "bin");
  mkdirSync(bin, { recursive: true });
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("C1: a launch that ends on its provider's limit records one wall", () => {
  test("a codex workhorse wall: one line, its role, the first line byte for byte, the reset", () => {
    const c = dispatch("c1-codex");
    const step = launchStep(
      c,
      "stub",
      "lane",
      `cat <<'EOF'\n${CODEX_WALL}\nEOF\nexit 1\n`,
      "codex",
      "stub",
    );
    expect(step.rc).toBe(0);
    const lines = wallsIn(step.actions);
    expect(lines.length).toBe(1);
    const rec = JSON.parse(lines[0]!) as { target: string; detail: string; actor: string };
    expect(rec.target).toBe("stub");
    expect(rec.actor).toBe("lane:stub");
    expect(rec.detail).toContain("workhorse - - 2026-09-22T02:29:00Z ");
    expect(rec.detail).toContain("You’ve hit your usage limit.");
    // The line was written as the launch ended: no later than the marker.
    expect(statSync(step.marker).mtimeMs).toBeGreaterThanOrEqual(statSync(step.actions).mtimeMs);
  }, 60000);

  test("a claude bug-reviewer wall: the role carries its lens and round, and the reset is UTC", () => {
    const c = dispatch("c1-claude");
    const step = launchStep(
      c,
      "sec",
      "reviewer",
      `cat <<'EOF'\n${CLAUDE_WALL}\nEOF\nexit 1\n`,
      "claude",
      "review-r1-bug-sec",
      ["review"],
    );
    expect(step.rc).toBe(0);
    const lines = wallsIn(step.actions);
    expect(lines.length).toBe(1);
    const rec = JSON.parse(lines[0]!) as { target: string; detail: string };
    expect(rec.target).toBe("sec");
    expect(rec.detail).toContain("reviewer bug 1 2026-09-22T03:00:00Z ");
    expect(rec.detail).toContain("You've hit your weekly limit · resets 3am (UTC)");
  }, 60000);

  test("a mimo workhorse limit error event with exit 0 still records a wall", () => {
    const c = dispatch("c1-mimo");
    const step = launchStep(
      c,
      "mimo",
      "lane",
      `cat >/dev/null\ncat <<'EOF'\n${MIMO_WALL}\nEOF\nexit 0\n`,
      "mimo",
      "mimo",
    );
    expect(step.rc).toBe(0);
    const lines = wallsIn(step.actions);
    expect(lines.length).toBe(1);
    const rec = JSON.parse(lines[0]!) as { target: string; detail: string };
    expect(rec.target).toBe("mimo");
    expect(rec.detail).toContain("workhorse - - none You have hit your usage limit.");
  }, 60000);
});

describe("C3: an ending that is not the provider's limit records no wall", () => {
  const noWall = (
    label: string,
    lane: string,
    kind: "lane" | "reviewer",
    script: string,
    harness: string,
    out: string,
    extra: string[] = [],
  ): void => {
    test(label, () => {
      const c = dispatch(`c3-${label.replace(/[^a-z0-9]+/gu, "-").slice(0, 40)}`);
      const step = launchStep(c, lane, kind, script, harness, out, extra);
      expect(step.rc).toBe(0);
      expect(existsSync(step.marker)).toBe(true);
      expect(wallsIn(step.actions).length).toBe(0);
    }, 60000);
  };

  noWall(
    "a 504 Gateway Timeout ending records no wall",
    "stub",
    "lane",
    `cat <<'EOF'\n{"type":"turn.failed","error":{"message":"504 Gateway Timeout"}}\nEOF\nexit 1\n`,
    "codex",
    "stub-504",
  );
  noWall(
    "a 401 ending records no wall",
    "sec",
    "reviewer",
    `cat <<'EOF'\n{"type":"result","subtype":"error","is_error":true,"result":"401 Unauthorized","api_error_status":401}\nEOF\nexit 1\n`,
    "claude",
    "review-r1-bug-sec",
    ["review"],
  );
  noWall(
    "a failed command whose output says usage and limit records no wall (codex)",
    "stub",
    "lane",
    `cat <<'EOF'\n{"type":"item.completed","item":{"type":"command_execution","status":"failed","command":"npm run check","output":"usage limit reached in usage"}}\n{"type":"turn.completed","usage":{"input_tokens":1}}\nEOF\nexit 0\n`,
    "codex",
    "stub-cmd",
  );
  noWall(
    "a failed tool part whose output says usage and limit records no wall (mimo)",
    "mimo",
    "lane",
    `cat >/dev/null\ncat <<'EOF'\n{"sessionID":"s","type":"tool_use","part":{"tool":"bash","state":{"status":"error","output":"usage and limit"}}}\n{"sessionID":"s","type":"step_finish","part":{"reason":"stop"}}\nEOF\nexit 0\n`,
    "mimo",
    "mimo-tool",
  );
  noWall(
    "a final message in prose that mentions a usage limit records no wall",
    "sec",
    "reviewer",
    `cat <<'EOF'\n{"type":"result","subtype":"success","is_error":false,"result":"The usage limit should be documented for users."}\nEOF\nexit 0\n`,
    "claude",
    "review-r1-style-sec",
    ["review"],
  );
  noWall(
    "a workhorse that committed WORKHORSE-SUMMARY.md first records no wall",
    "stub",
    "lane",
    `: > WORKHORSE-SUMMARY.md\ncat <<'EOF'\n${CODEX_WALL}\nEOF\nexit 1\n`,
    "codex",
    "stub-summary",
  );
});

test("C3: a lane stopped mid-run with host.sh stop records no wall", () => {
  const c = dispatch("c3-stop");
  stub("codex", `echo started; sleep 300\n`);
  const marker = join(c.d, "logs", "stub-stop.done");
  const child = spawnSync(
    "bash",
    [
      host,
      "run",
      "lane · stub",
      c.wt,
      "--under",
      c.d,
      "--role",
      "lane",
      "--run",
      c.d,
      "--out",
      join(c.d, "logs", "stub-stop.jsonl"),
      "--err",
      join(c.d, "logs", "stub-stop.err"),
      "--marker",
      marker,
      "--",
      join(import.meta.dir, "launch.sh"),
      "launch",
      "stub",
      c.wt,
      join(tmp, "prompt.txt"),
      "--run",
      c.d,
    ],
    { encoding: "utf8", env: baseEnv() },
  );
  expect(child.status ?? 1).toBe(0);
  // Give the launch its moment, then stop it in its own worktree, as review-round does.
  spawnSync("sleep", ["1"]);
  const stopped = spawnSync("bash", [host, "stop", c.wt], { encoding: "utf8", env: baseEnv() });
  expect(stopped.status ?? 1).toBe(0);
  spawnSync("bash", [waitMarkers, join(c.d, "logs"), "stub-stop.done", "1", "60"], {
    encoding: "utf8",
    env: baseEnv(),
  });
  expect(wallsIn(join(c.d, "actions.jsonl")).length).toBe(0);
}, 90000);

test("C3: a workhorse that committed WORKHORSE-BLOCKED.md first records no wall", () => {
  const c = dispatch("c3-blocked");
  const step = launchStep(
    c,
    "stub",
    "lane",
    `: > WORKHORSE-BLOCKED.md\ncat <<'EOF'\n${CODEX_WALL}\nEOF\nexit 1\n`,
    "codex",
    "stub-blocked",
  );
  expect(step.rc).toBe(0);
  expect(existsSync(join(c.wt, "WORKHORSE-BLOCKED.md"))).toBe(true);
  expect(wallsIn(step.actions).length).toBe(0);
}, 60000);

describe("C4: a grok lane ending on a limit message is handled as today", () => {
  test("no wall line, and the lane ends on its own exit", () => {
    const c = dispatch("c4-grok");
    const step = launchStep(
      c,
      "gr",
      "lane",
      `cat <<'EOF'\n{"type":"error","message":"You have hit your usage limit"}\nEOF\nexit 1\n`,
      "grok",
      "gr",
    );
    expect(step.rc).toBe(0);
    expect(existsSync(step.marker)).toBe(true);
    expect(wallsIn(step.actions).length).toBe(0);
  }, 60000);
});
