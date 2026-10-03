// Tests beside scripts/export-session.ts, moved from its --self-test on #109: 16 controls.
// The grok/muse/mimo stub commands are all planted in beforeAll instead of between checks;
// CLI spawns go through a local spawnSync helper that merges env over process.env.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EXTENSIONS } from "./export-session";

const SELF = join(import.meta.dir, "run");

interface Run {
  code: number;
  out: string;
  err: string;
}

function runCli(args: string[], env?: Record<string, string | undefined>, cwd?: string): Run {
  const merged: Record<string, string | undefined> = { ...process.env };
  if (env !== undefined) {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete merged[k];
      else merged[k] = v;
    }
  }
  const r = spawnSync(SELF, ["export-session", ...args], {
    encoding: "utf8",
    timeout: 10000,
    env: merged,
    cwd,
  });
  return { code: r.status ?? 1, out: String(r.stdout ?? ""), err: String(r.stderr ?? "") };
}

let root = "";
let dispatch = "";
let cwd = "";
let home = "";
let logs = "";
let baseEnv: Record<string, string | undefined> = {};
let count = 0;

function savedOk(thread: string, harness: string): boolean {
  const saved = join(dispatch, "sessions", "lane", thread + (EXTENSIONS[harness] ?? ".jsonl"));
  try {
    const s = statSync(saved);
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

function check(harness: string, thread: string, row: unknown, native?: string, data = ""): Run {
  const events = join(logs, `${harness}.jsonl`);
  writeFileSync(events, `${JSON.stringify(row)}\n`);
  if (native !== undefined) {
    const p = join(home, native);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `durable ${thread}\n`);
  }
  const r = runCli([dispatch, "lane", harness, cwd, events, data], baseEnv);
  if (r.code === 0 && savedOk(thread, harness)) count++;
  return r;
}

function savedText(thread: string): string {
  try {
    return readFileSync(join(dispatch, "sessions", "lane", `${thread}.jsonl`), "utf8");
  } catch {
    return "";
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "export-session-test-"));
  const repo = join(root, "repo");
  dispatch = join(repo, ".postmaster", "runs", "RUN-1");
  cwd = join(root, "worktree");
  home = join(root, "home");
  const binDir = join(root, "bin");
  mkdirSync(join(dispatch, "logs"), { recursive: true });
  mkdirSync(cwd);
  mkdirSync(home);
  mkdirSync(binDir);
  logs = join(dispatch, "logs");
  // Store locations come from the planted HOME, never the machine's own.
  baseEnv = {
    HOME: home,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    CODEX_HOME: undefined,
    CLAUDE_CONFIG_DIR: undefined,
  };
  writeFileSync(join(binDir, "grok"), "#!/bin/sh\nprintf 'grok export %s\\n' \"$2\"\n");
  chmodSync(join(binDir, "grok"), 0o755);
  writeFileSync(
    join(binDir, "muse"),
    '#!/bin/sh\n[ "$1" = export ] && { printf \'muse session\\n\' > "$5"; exit 0; }\nexit 1\n',
  );
  chmodSync(join(binDir, "muse"), 0o755);
  writeFileSync(
    join(binDir, "mimo"),
    "#!/bin/sh\n[ \"$1\" = export ] && { printf 'mimo session\\n'; exit 0; }\nexit 1\n",
  );
  chmodSync(join(binDir, "mimo"), 0o755);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("harness exports", () => {
  // Native local stores are copied without reading or printing their contents.
  test("codex export is saved", () => {
    const r = check(
      "codex",
      "thread-codex",
      { type: "thread.started", thread_id: "thread-codex" },
      ".codex/sessions/2026/01/03/rollout-2026-01-03T00-00-00-thread-codex.jsonl",
    );
    expect(r.code).toBe(0);
    expect(savedOk("thread-codex", "codex")).toBe(true);
  }, 10000);

  test("claude export is saved", () => {
    const r = check(
      "claude",
      "thread-claude",
      { session_id: "thread-claude" },
      ".claude/projects/project/thread-claude.jsonl",
    );
    expect(r.code).toBe(0);
    expect(savedOk("thread-claude", "claude")).toBe(true);
  }, 10000);

  test("pi export is saved", () => {
    const r = check(
      "pi",
      "thread-pi",
      { type: "session", id: "thread-pi" },
      ".pi/agent/sessions/--project--/thread-pi.jsonl",
    );
    expect(r.code).toBe(0);
    expect(savedOk("thread-pi", "pi")).toBe(true);
  }, 10000);

  test("agy export is saved", () => {
    const r = check("agy", "thread-agy", { conversationId: "thread-agy" });
    expect(r.code).toBe(0);
    expect(savedOk("thread-agy", "agy")).toBe(true);
  }, 10000);

  test("grok export is saved", () => {
    const r = check("grok", "thread-grok", { thread_id: "thread-grok" });
    expect(r.code).toBe(0);
    expect(savedOk("thread-grok", "grok")).toBe(true);
  }, 10000);

  test("muse export is saved", () => {
    const r = check(
      "muse",
      "thread-muse",
      { stream: { kind: "session", id: "thread-muse" } },
      undefined,
      join(root, "muse-data"),
    );
    expect(r.code).toBe(0);
    expect(savedOk("thread-muse", "muse")).toBe(true);
  }, 10000);

  test("mimo export is saved", () => {
    const r = check(
      "mimo",
      "thread-mimo",
      { sessionID: "thread-mimo" },
      undefined,
      join(root, "mimo-data"),
    );
    expect(r.code).toBe(0);
    expect(savedOk("thread-mimo", "mimo")).toBe(true);
  }, 10000);

  test("all seven harnesses export", () => {
    expect(count).toBe(7);
  }, 10000);
});

describe("store matching and session identity", () => {
  test("a newer thread whose id extends the thread's does not shadow its session", () => {
    const codexSessions = join(home, ".codex", "sessions");
    mkdirSync(join(codexSessions, "2026", "01", "01"), { recursive: true });
    mkdirSync(join(codexSessions, "2026", "01", "02"), { recursive: true });
    const right = join(
      codexSessions,
      "2026",
      "01",
      "01",
      "rollout-2026-01-01T00-00-00-thread-1.jsonl",
    );
    const wrong = join(
      codexSessions,
      "2026",
      "01",
      "02",
      "rollout-2026-01-02T00-00-00-thread-10.jsonl",
    );
    writeFileSync(right, "RIGHT thread one\n");
    writeFileSync(wrong, "WRONG thread ten\n");
    utimesSync(right, 1000000000, 1000000000);
    utimesSync(wrong, 1100000000, 1100000000);
    const decoyEvents = join(logs, "decoy.jsonl");
    writeFileSync(
      decoyEvents,
      `${JSON.stringify({ type: "thread.started", thread_id: "thread-1" })}\n`,
    );
    const r = runCli([dispatch, "lane", "codex", cwd, decoyEvents, ""], baseEnv);
    expect(r.code).toBe(0);
    expect(savedText("thread-1")).toBe("RIGHT thread one\n");
  }, 10000);

  test("a thread whose id extends the thread's with a dash does not shadow its session", () => {
    const loneHome = join(root, "lone-home");
    const loneSessions = join(loneHome, ".codex", "sessions", "2026", "01", "04");
    mkdirSync(loneSessions, { recursive: true });
    writeFileSync(
      join(loneSessions, "rollout-2026-01-04T00-00-00-other-thread-1.jsonl"),
      "WRONG other thread\n",
    );
    const loneEnv = { ...baseEnv, HOME: loneHome };
    const suffixEvents = join(logs, "suffix.jsonl");
    writeFileSync(
      suffixEvents,
      `${JSON.stringify({ type: "thread.started", thread_id: "thread-1" })}\n`,
    );
    const r = runCli([dispatch, "lone", "codex", cwd, suffixEvents, ""], loneEnv);
    expect(r.code).toBe(1);
    expect(r.err).toContain("no durable codex record was found");
  }, 10000);

  test("an exact store file wins over a newer suffixed decoy", () => {
    const claudeDir = join(home, ".claude", "projects", "project");
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "thread-2.jsonl"), "RIGHT exact\n");
    writeFileSync(join(claudeDir, "other-thread-2.jsonl"), "WRONG suffix\n");
    utimesSync(join(claudeDir, "thread-2.jsonl"), 1000000000, 1000000000);
    utimesSync(join(claudeDir, "other-thread-2.jsonl"), 1100000000, 1100000000);
    const decoy2Events = join(logs, "decoy2.jsonl");
    writeFileSync(decoy2Events, `${JSON.stringify({ session_id: "thread-2" })}\n`);
    const r = runCli([dispatch, "lane", "claude", cwd, decoy2Events, ""], baseEnv);
    expect(r.code).toBe(0);
    expect(savedText("thread-2")).toBe("RIGHT exact\n");
  }, 10000);

  test("a suffixed decoy alone is no record for claude", () => {
    const loneDir = join(home, ".claude", "projects", "lone");
    mkdirSync(loneDir, { recursive: true });
    writeFileSync(join(loneDir, "other-thread-9.jsonl"), "DECOY\n");
    const loneEvents = join(logs, "lone.jsonl");
    writeFileSync(loneEvents, `${JSON.stringify({ session_id: "thread-9" })}\n`);
    const r = runCli([dispatch, "lane", "claude", cwd, loneEvents, ""], baseEnv);
    expect(r.code).toBe(1);
    expect(r.err).toContain("no durable claude record was found");
  }, 10000);

  test("a top-level session id wins over a nested id in an earlier line", () => {
    const claudeDir = join(home, ".claude", "projects", "project");
    mkdirSync(claudeDir, { recursive: true });
    const nestedEvents = join(logs, "nested.jsonl");
    writeFileSync(
      nestedEvents,
      `${JSON.stringify({ type: "tool_result", result: { session_id: "WRONG-nested" } })}\n` +
        `${JSON.stringify({ type: "session", session_id: "RIGHT-top" })}\n`,
    );
    writeFileSync(join(claudeDir, "WRONG-nested.jsonl"), "WRONG\n");
    writeFileSync(join(claudeDir, "RIGHT-top.jsonl"), "RIGHT\n");
    const r = runCli([dispatch, "lane", "claude", cwd, nestedEvents, ""], baseEnv);
    expect(r.code).toBe(0);
    expect(savedText("RIGHT-top")).toBe("RIGHT\n");
  }, 10000);

  test("several records for one thread keep the newest, loudly", () => {
    const codexSessions = join(home, ".codex", "sessions");
    mkdirSync(join(codexSessions, "2026", "01", "01"), { recursive: true });
    mkdirSync(join(codexSessions, "2026", "01", "02"), { recursive: true });
    const spanOld = join(
      codexSessions,
      "2026",
      "01",
      "01",
      "rollout-2026-01-01T23-59-00-thread-7.jsonl",
    );
    const spanNew = join(
      codexSessions,
      "2026",
      "01",
      "02",
      "rollout-2026-01-02T00-01-00-thread-7.jsonl",
    );
    writeFileSync(spanOld, "OLD segment\n");
    writeFileSync(spanNew, "NEW segment\n");
    utimesSync(spanOld, 1000000000, 1000000000);
    utimesSync(spanNew, 1100000000, 1100000000);
    const spanEvents = join(logs, "span.jsonl");
    writeFileSync(
      spanEvents,
      `${JSON.stringify({ type: "thread.started", thread_id: "thread-7" })}\n`,
    );
    const r = runCli([dispatch, "lane", "codex", cwd, spanEvents, ""], baseEnv);
    expect(r.code).toBe(0);
    expect(savedText("thread-7")).toBe("NEW segment\n");
    expect(r.err).toContain("2 codex records name thread thread-7; keeping the newest");
  }, 10000);
});

describe("run root and import isolation", () => {
  test("worktree modules cannot shadow the exporter's standard library imports", () => {
    const shadow = join(root, "shadow");
    mkdirSync(shadow);
    writeFileSync(
      join(shadow, "json.py"),
      `import pathlib\npathlib.Path(r"${join(shadow, "marker")}").write_text("imported")\nraise SystemExit("shadow")\n`,
    );
    const shadowEvents = join(logs, "shadow.jsonl");
    writeFileSync(shadowEvents, `${JSON.stringify({ conversationId: "thread-shadow" })}\n`);
    const r = runCli([dispatch, "lane", "agy", shadow, shadowEvents, ""], baseEnv, shadow);
    let marker = false;
    let exported = false;
    try {
      statSync(join(shadow, "marker"));
      marker = true;
    } catch {
      marker = false;
    }
    try {
      exported = statSync(
        join(dispatch, "sessions", "lane", "thread-shadow.events.jsonl"),
      ).isFile();
    } catch {
      exported = false;
    }
    expect(r.code).toBe(0);
    expect(marker).toBe(false);
    expect(exported).toBe(true);
  }, 10000);

  test("a dispatch outside the project run root is skipped, not failed", () => {
    const legacy = join(root, "legacy", "RUN-0");
    mkdirSync(join(legacy, "logs"), { recursive: true });
    const legacyEvents = join(legacy, "logs", "lane.jsonl");
    writeFileSync(
      legacyEvents,
      `${JSON.stringify({ type: "thread.started", thread_id: "thread-old" })}\n`,
    );
    const r = runCli([legacy, "lane", "codex", cwd, legacyEvents, ""], baseEnv);
    let skipped = false;
    try {
      statSync(join(legacy, "sessions"));
      skipped = false;
    } catch {
      skipped = true;
    }
    expect(r.code).toBe(0);
    expect(skipped).toBe(true);
  }, 10000);
});
