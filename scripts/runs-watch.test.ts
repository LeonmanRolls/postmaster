// Tests beside scripts/runs-watch.ts, moved from its --self-test on #109: 80 controls.
// POSTMASTER_CONFIG is pointed at a 1s-poll config for the run and restored in afterAll.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activeRunCount, pendingReadyTickets, runCapacity, streamLines } from "./runs-watch.ts";
import { run } from "./lib/proc.ts";

const self = join(import.meta.dir, "runs-watch.sh");
const savedConfig = process.env.POSTMASTER_CONFIG;

let tmp = "";
let pin = "";
let pinCommit = "";

function makePin(dir: string, withHost: boolean): { pin: string; commit: string } {
  // A tool checkout the pin can serve: the coachman.md under test, and the leg
  // script unless the control needs it missing.
  const g = (args: string[]): void => {
    const r = run("git", [
      "-C",
      dir,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.invalid",
      ...args,
    ]);
    if (r.code !== 0) throw new Error(`cannot make the pin fixture: git ${args[0]}`);
  };
  let r = run("git", ["init", "-q", "-b", "main", dir]);
  if (r.code !== 0) throw new Error("cannot make the pin fixture");
  mkdirSync(join(dir, "skills", "postmaster"), { recursive: true });
  writeFileSync(
    join(dir, "skills", "postmaster", "coachman.md"),
    readFileSync(join(import.meta.dir, "..", "skills", "postmaster", "coachman.md")),
  );
  if (withHost) {
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "scripts", "host.sh"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });
  }
  g(["add", "."]);
  g(["commit", "-qm", "pin"]);
  r = run("git", ["-C", dir, "rev-parse", "HEAD"]);
  if (r.code !== 0) throw new Error("cannot read the pin commit");
  return { pin: realpathSync(dir), commit: r.out.trim() };
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "postmaster-"));
  writeFileSync(join(tmp, "config.toml"), "[postmaster]\npoll_seconds = 1\n");
  process.env.POSTMASTER_CONFIG = join(tmp, "config.toml");
  const made = makePin(join(tmp, "pin"), true);
  pin = made.pin;
  pinCommit = made.commit;
});

afterAll(() => {
  if (savedConfig === undefined) delete process.env.POSTMASTER_CONFIG;
  else process.env.POSTMASTER_CONFIG = savedConfig;
  rmSync(tmp, { recursive: true, force: true });
});

function watch(root: string, timeout = "2", config?: string): { rc: number; out: string } {
  const r = run(
    self,
    ["--timeout", timeout, root],
    config === undefined ? {} : { env: { POSTMASTER_CONFIG: config } },
  );
  return { rc: r.code, out: `${r.out}${r.err}` };
}

function mkrun(root: string, name: string, stage: string, leg: number, ...markers: string[]): void {
  const d = join(root, name);
  mkdirSync(join(d, "logs"), { recursive: true });
  writeFileSync(join(d, "manifest.json"), `{"stage": "${stage}", "leg": ${leg}}\n`);
  writeFileSync(join(d, "run-log.md"), "");
  for (const m of markers) writeFileSync(join(d, m), "");
}

function age(root: string, name: string): void {
  // Nothing in the run has changed for an hour: files only, as os.walk lists them.
  const t = Date.now() / 1000 - 3600;
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else {
        try {
          utimesSync(p, t, t);
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(join(root, name));
}

function later(file: string): void {
  // The shell sleeps in the foreground and watches in the background; here
  // the marker arrives from a detached sleeper while run() blocks.
  const child = spawn("sh", ["-c", 'sleep 2; : > "$1"', "sh", file], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

describe("positive controls: each NEXT that needs the postmaster names its run", () => {
  const specs: Array<[string, string, number, string, string, string?, string?]> = [
    ["rule", "review", 2, ".escalation-ready", "RULE"],
    ["gate", "shipping", 3, ".card-ready", "GATE"],
    ["spec", "planning", 1, ".spec-" + "review-ready", "SPEC"],
    ["dispatch", "review", 2, ".leg-2-done", "DISPATCH"],
    ["resume", "review", 2, ".leg-2-exited", "RESUME", "incomplete", "coachman"],
    ["read", "review", 2, ".checkpoint-review-ready", "READ"],
  ];
  for (const [name, stage, leg, marker, want, outcome, role] of specs) {
    test(`NEXT ${want} names ${name}`, () => {
      const root = join(tmp, `pos-${name}`);
      mkdirSync(root, { recursive: true });
      mkrun(root, name, stage, leg, marker);
      if (outcome) {
        writeFileSync(
          join(root, name, "logs", `coachman-leg-${leg}-attempts.jsonl`),
          `{"outcome":"${outcome}","role":"${role}"}\n`,
        );
      }
      const { rc, out } = watch(root);
      expect(rc).toBe(0);
      expect(out).toContain(`needs ${name} ${want}`);
      expect(out).toContain("NEXT");
    }, 30000);
  }

  test("NEXT INSPECT names inspect", () => {
    const root = join(tmp, "pos-inspect");
    mkdirSync(root, { recursive: true });
    mkrun(root, "inspect", "review", 2);
    age(root, "inspect");
    const { rc, out } = watch(root);
    expect(rc).toBe(0);
    expect(out).toContain("needs inspect INSPECT");
  }, 30000);

  test("a run that becomes actionable mid-wait is named", () => {
    const root = join(tmp, "pos-late");
    mkdirSync(root, { recursive: true });
    mkrun(root, "late", "review", 2);
    later(join(root, "late", ".escalation-ready"));
    const { rc, out } = watch(root, "10");
    expect(rc).toBe(0);
    expect(out).toContain("needs late RULE");
    expect(out).not.toContain("the poll interval is the default");
  }, 30000);

  test("every waking run is named", () => {
    const root = join(tmp, "pos-multi");
    mkdirSync(root, { recursive: true });
    mkrun(root, "first", "review", 2, ".escalation-ready");
    mkrun(root, "second", "shipping", 3, ".card-ready");
    const { rc, out } = watch(root);
    expect(rc).toBe(0);
    expect(out).toContain("needs first RULE");
    expect(out).toContain("needs second GATE");
    expect(out).toContain("NEXT");
  }, 30000);

  test("a usable poll interval wakes promptly", () => {
    const root = join(tmp, "pos-prompt");
    mkdirSync(root, { recursive: true });
    mkrun(root, "prompt", "review", 2);
    const t0 = Math.floor(Date.now() / 1000);
    later(join(root, "prompt", ".escalation-ready"));
    const { rc, out } = watch(root, "30");
    const took = Math.floor(Date.now() / 1000) - t0;
    expect(rc).toBe(0);
    expect(out).toContain("needs prompt RULE");
    expect(took <= 15).toBe(true);
  }, 30000);
});

describe("negative controls: WAIT, USER, - and a held run leave it waiting", () => {
  test("a leg at work is left waiting until the timeout", () => {
    const root = join(tmp, "neg-wait");
    mkdirSync(root, { recursive: true });
    mkrun(root, "wait", "review", 2);
    const { rc, out } = watch(root);
    expect(rc).toBe(3);
    expect(out).toContain("NEXT");
    expect(out).toContain("wait ");
    expect(out).toContain("WAIT");
    expect(out).not.toContain("needs ");
  }, 30000);

  test("a run put to the user is left waiting until the timeout", () => {
    const root = join(tmp, "neg-user");
    mkdirSync(root, { recursive: true });
    mkrun(root, "user", "review", 2, ".waiting-on-user", ".leg-2-exited");
    const { rc, out } = watch(root);
    expect(rc).toBe(3);
    expect(out).toContain("NEXT");
    expect(out).toContain("user ");
    expect(out).toContain(".waiting-on-user");
    expect(out).not.toContain("needs ");
  }, 30000);

  test("a closed run is left waiting until the timeout", () => {
    const root = join(tmp, "neg-closed");
    mkdirSync(root, { recursive: true });
    mkrun(root, "closed", "done", 3, ".leg-3-done");
    const { rc, out } = watch(root);
    expect(rc).toBe(3);
    expect(out).toContain("NEXT");
    expect(out).toContain("closed ");
    expect(out).toContain(".leg-3-done");
    expect(out).not.toContain("needs ");
  }, 30000);

  test("a run on the held list never needs the postmaster", () => {
    const root = join(tmp, "neg-held");
    mkdirSync(root, { recursive: true });
    mkrun(root, "held", "review", 2, ".escalation-ready");
    mkdirSync(join(root, "postmaster"), { recursive: true });
    writeFileSync(join(root, "postmaster/held"), "held\n");
    const { rc, out } = watch(root);
    expect(rc).toBe(3);
    expect(out).toContain("NEXT");
    expect(out).toContain("held ");
    expect(out).toContain(".escalation-ready");
    expect(out).not.toContain("needs ");
    expect(out).not.toContain("matches no run");
  }, 30000);

  test("a #ticket held line warns that it matches no run", () => {
    const root = join(tmp, "neg-heldhash");
    mkdirSync(root, { recursive: true });
    mkrun(root, "121", "review", 2, ".escalation-ready");
    mkdirSync(join(root, "postmaster"), { recursive: true });
    writeFileSync(join(root, "postmaster/held"), "#121\n");
    const { rc, out } = watch(root, "0");
    expect(rc).toBe(0);
    expect(out).toContain("needs 121 RULE");
    expect(out).toContain('held "#121" matches no run');
  }, 30000);

  test("a held line for no run warns", () => {
    const root = join(tmp, "neg-heldtypo");
    mkdirSync(root, { recursive: true });
    mkrun(root, "wait", "review", 2);
    mkdirSync(join(root, "postmaster"), { recursive: true });
    writeFileSync(join(root, "postmaster/held"), "999\n");
    const { rc, out } = watch(root, "0");
    expect(rc).toBe(3);
    expect(out).toContain("wait ");
    expect(out).toContain('held "999" matches no run');
    expect(out).not.toContain("needs ");
  }, 30000);

  test("a held run is left out of the names even beside a waking run", () => {
    const root = join(tmp, "neg-mixed");
    mkdirSync(root, { recursive: true });
    mkrun(root, "free", "review", 2, ".card-ready");
    mkrun(root, "held", "review", 2, ".escalation-ready");
    mkdirSync(join(root, "postmaster"), { recursive: true });
    writeFileSync(join(root, "postmaster/held"), "held\n");
    const { rc, out } = watch(root);
    expect(rc).toBe(0);
    expect(out).toContain("needs free GATE");
    expect(out).toContain("held ");
    expect(out).toContain(".escalation-ready");
    expect(out).not.toContain("needs held");
  }, 30000);

  test("a dangling held link is refused", () => {
    const root = join(tmp, "neg-heldlink");
    mkdirSync(root, { recursive: true });
    mkrun(root, "held", "review", 2, ".escalation-ready");
    mkdirSync(join(root, "postmaster"), { recursive: true });
    symlinkSync(join(tmp, "no-such-target"), join(root, "postmaster/held"));
    const { rc, out } = watch(root, "0");
    expect(rc).toBe(1);
    expect(out).toContain("cannot read");
    expect(out).not.toContain("needs ");
  }, 30000);

  test("a held list that is a directory is refused", () => {
    const root = join(tmp, "neg-helddir");
    mkdirSync(root, { recursive: true });
    mkrun(root, "held", "review", 2, ".escalation-ready");
    mkdirSync(join(root, "postmaster/held"), { recursive: true });
    const { rc, out } = watch(root, "0");
    expect(rc).toBe(1);
    expect(out).toContain("cannot read");
    expect(out).not.toContain("needs ");
  }, 30000);

  test("an unreadable held list is refused", () => {
    const root = join(tmp, "neg-heldperm");
    mkdirSync(root, { recursive: true });
    mkrun(root, "held", "review", 2, ".escalation-ready");
    mkdirSync(join(root, "postmaster"), { recursive: true });
    writeFileSync(join(root, "postmaster/held"), "held\n");
    chmodSync(join(root, "postmaster/held"), 0);
    const { rc, out } = watch(root, "0");
    chmodSync(join(root, "postmaster/held"), 0o644);
    expect(rc).toBe(1);
    expect(out).toContain("cannot read");
    expect(out).not.toContain("needs ");
  }, 30000);

  test("an unlistable postmaster dir is refused", () => {
    const root = join(tmp, "neg-heldlock");
    mkdirSync(root, { recursive: true });
    mkrun(root, "held", "review", 2, ".escalation-ready");
    mkdirSync(join(root, "postmaster"), { recursive: true });
    writeFileSync(join(root, "postmaster/held"), "held\n");
    chmodSync(join(root, "postmaster"), 0);
    const { rc, out } = watch(root, "0");
    chmodSync(join(root, "postmaster"), 0o755);
    expect(rc).toBe(1);
    expect(out).toContain("cannot read");
    expect(out).not.toContain("needs ");
  }, 30000);

  test("a run root with a backslash still holds its held runs", () => {
    const root = join(tmp, "neg-bsroot");
    mkdirSync(root, { recursive: true });
    mkrun(root, "heldrun", "review", 2, ".escalation-ready");
    mkdirSync(join(root, "postmaster"), { recursive: true });
    writeFileSync(join(root, "postmaster/held"), "heldrun\n");
    const bsroot = join(tmp, "neg-bs\\q");
    renameSync(root, bsroot);
    const { rc, out } = watch(bsroot, "0");
    expect(rc).toBe(3);
    expect(out).toContain("NEXT");
    expect(out).toContain("heldrun ");
    expect(out).not.toContain("needs ");
    expect(out).not.toContain("warning");
  }, 30000);

  test("an empty timeout still looks once, prints the table and exits 3", () => {
    const root = join(tmp, "neg-none");
    mkdirSync(root, { recursive: true });
    mkrun(root, "alone", "done", 1);
    const { rc, out } = watch(root, "0");
    expect(rc).toBe(3);
    expect(out).toContain("NEXT");
    expect(out).toContain("alone ");
    expect(out).not.toContain("needs ");
  }, 30000);
});

function autoRun(root: string, name: string, leg: number, thread: string): void {
  // A dispatch-shaped fixture with a recorded claude config.
  const d = join(root, name);
  const repo = `${root}-project`;
  mkdirSync(join(d, "logs"), { recursive: true });
  mkdirSync(join(d, "audit"), { recursive: true });
  mkdirSync(join(d, "render"), { recursive: true });
  mkdirSync(join(root, "postmaster"), { recursive: true });
  mkdirSync(join(repo, ".worktrees", name), { recursive: true });
  writeFileSync(join(d, "run-log.md"), "");
  writeFileSync(join(d, "actions.jsonl"), "");
  writeFileSync(join(root, "ledger.jsonl"), "");
  writeFileSync(
    join(d, "brief.md"),
    `# Waybill: ${name}\nturnpikes: style, bug, security\n\n## Ticket\n## Project profile\nrepo: ${repo}\n\n## Dispatch\nname: #1, Watcher fixture\n`,
  );
  const entry: Record<string, string> = { name: "coachman" };
  if (thread) entry.thread_id = thread;
  writeFileSync(
    join(d, "manifest.json"),
    `${JSON.stringify({ stage: "review", leg, coachman: { legs: { [String(leg)]: entry } } }, null, 2)}\n`,
  );
  writeFileSync(
    join(d, "run.json"),
    `${JSON.stringify({ config: { lanes: {}, team: { coachman: { harness: "claude", model: "coach-test" } } }, postmaster: { commit: pinCommit, checkout: pin } }, null, 2)}\n`,
  );
}

function recordAttempt(
  d: string,
  n: string,
  outcome: string,
  role = "coachman",
  thread = "",
): void {
  // One attempt row for the run's record, as the leg script writes it.
  writeFileSync(
    join(d, "logs", `coachman-leg-${n}-attempts.jsonl`),
    `{"attempt":1,"leg":"${n}","name":"synthesis","request":"launch","role":"${role}","prompt":"${join(d, "prompt.txt")}","thread_id":"${thread}","outcome":"${outcome}","on_answer":"none","backfilled":false}\n`,
  );
}

function handoff(dispatch: string, leg: string): void {
  writeFileSync(
    join(dispatch, `handoff-${leg}.md`),
    "## Decisions\nsettled\n## Deferred findings\nnone\n## Verified by execution\nnone\n## Unverified\nnone\n## Branches and lanes\nnone\n## Open questions\nnone\n## Next leg\nnone\n",
  );
}

function watchStub(root: string, mode = ""): { rc: number; out: string } {
  // The watcher with only its leg boundary replaced: no agent ever starts.
  mkdirSync(join(tmp, "calls"), { recursive: true });
  const env: Record<string, string | undefined> = {
    POSTMASTER_WATCH_TEST_MODE: "1",
    POSTMASTER_WATCH_TEST_CALLS: join(tmp, "calls"),
  };
  if (mode === "dispatch failure") env.POSTMASTER_WATCH_TEST_FAIL = "dispatch";
  else if (mode === "resume failure") env.POSTMASTER_WATCH_TEST_FAIL = "resume";
  else if (mode === "dispatch refusal" || mode === "resume refusal") {
    env.POSTMASTER_WATCH_TEST_REFUSE = "1";
  }
  const r = run(self, ["--timeout", "0", root], { env });
  return { rc: r.code, out: `${r.out}${r.err}` };
}

function watchStubWait(root: string): { rc: number; out: string } {
  mkdirSync(join(tmp, "calls"), { recursive: true });
  const r = run(self, ["--timeout", "3", root], {
    env: {
      POSTMASTER_WATCH_TEST_MODE: "1",
      POSTMASTER_WATCH_TEST_CALLS: join(tmp, "calls"),
      POSTMASTER_WATCH_TEST_REFUSE: "1",
    },
  });
  return { rc: r.code, out: `${r.out}${r.err}` };
}

function actionCount(dispatch: string, action: string): number {
  let text: string;
  try {
    text = readFileSync(join(dispatch, "actions.jsonl"), "utf8");
  } catch {
    return 0;
  }
  let n = 0;
  for (const line of text.split("\n")) {
    if (line === "") continue;
    if ((JSON.parse(line) as { action?: string }).action === action) n++;
  }
  return n;
}

describe("stream skip: the line count", () => {
  test("the skip counts lines, including an unterminated last line", () => {
    writeFileSync(join(tmp, "unterminated.jsonl"), "a\nb");
    writeFileSync(join(tmp, "terminated.jsonl"), "a\nb\n");
    writeFileSync(join(tmp, "empty.jsonl"), "");
    expect(streamLines(join(tmp, "unterminated.jsonl"))).toBe(2);
    expect(streamLines(join(tmp, "terminated.jsonl"))).toBe(2);
    expect(streamLines(join(tmp, "empty.jsonl"))).toBe(0);
    expect(streamLines(join(tmp, "no-such.jsonl"))).toBe(0);
  }, 30000);
});

describe("watcher steps: dispatch and resume controls", () => {
  test("a checked hand-off dispatches the listed leg through its own checkout with no thread yet, and logs watcher ownership without launching an agent in the control", () => {
    const root = join(tmp, "auto-dispatch");
    mkdirSync(root, { recursive: true });
    autoRun(root, "dispatch", 1, "");
    handoff(join(root, "dispatch"), "1");
    writeFileSync(join(root, "dispatch", ".leg-1-done"), "");
    writeFileSync(join(root, "dispatch", ".leg-1-exited"), "");
    const { rc, out } = watchStub(root);
    expect(rc).toBe(3);
    expect(out).not.toContain("needs ");
    const m = JSON.parse(readFileSync(join(root, "dispatch", "manifest.json"), "utf8")) as {
      leg: number;
      coachman: { legs: Record<string, unknown> };
    };
    expect(m.leg).toBe(2);
    expect(m.coachman.legs["2"]).toEqual({ name: "coachman" });
    expect(actionCount(join(root, "dispatch"), "dispatch")).toBe(1);
    const actions = readFileSync(join(root, "dispatch", "actions.jsonl"), "utf8");
    expect(actions).toContain("watcher took it");
    expect(actions).toContain("leg 2 (review)");
    const call = readFileSync(join(tmp, "calls", "dispatch-dispatch-2"), "utf8").split("\n");
    expect(call).toContain("kind=dispatch");
    expect(call).toContain(`rt=${pin}`);
    expect(call).toContain("leg=review");
    expect(call).toContain("number=2");
    expect(call).toContain("thread=");
    expect(call).toContain(`prompt=${join(root, "dispatch", "leg-2-prompt.txt")}`);
    const prompt = readFileSync(join(root, "dispatch", "leg-2-prompt.txt"), "utf8");
    expect(prompt).toContain("Your review leg covers stage 2");
    expect(prompt).toContain(`${pin}/skills/postmaster/coachman.md`);
  }, 60000);

  test("a U+2028 in the waybill opens no fake Project profile: ^ matches after \\n only, as BASE", () => {
    const root = join(tmp, "auto-u2028");
    mkdirSync(root, { recursive: true });
    autoRun(root, "u2028", 1, "");
    const brief = join(root, "u2028", "brief.md");
    writeFileSync(
      brief,
      readFileSync(brief, "utf8").replace(
        "name: #1, Watcher fixture\n",
        "name: #1, Watcher fixture\u2028## Project profile\nrepo: /nowhere-fake\n",
      ),
    );
    handoff(join(root, "u2028"), "1");
    writeFileSync(join(root, "u2028", ".leg-1-done"), "");
    writeFileSync(join(root, "u2028", ".leg-1-exited"), "");
    const { rc } = watchStub(root);
    expect(rc).toBe(3);
    expect(existsSync(join(tmp, "calls", "dispatch-u2028-2"))).toBe(true);
  }, 60000);

  test("the watcher follows a legs list without review and records the omission", () => {
    const root = join(tmp, "auto-skip-review");
    mkdirSync(root, { recursive: true });
    autoRun(root, "skip-review", 1, "");
    handoff(join(root, "skip-review"), "1");
    const brief = join(root, "skip-review", "brief.md");
    writeFileSync(
      brief,
      readFileSync(brief, "utf8").replace(/^turnpikes:.*$/mu, "turnpikes: none"),
    );
    writeFileSync(join(root, "skip-review", ".leg-1-done"), "");
    writeFileSync(join(root, "skip-review", ".leg-1-exited"), "");
    const { rc } = watchStub(root);
    expect(rc).toBe(3);
    const m = JSON.parse(readFileSync(join(root, "skip-review", "manifest.json"), "utf8")) as {
      leg: number;
      coachman: { legs: Record<string, { thread_id?: string }> };
    };
    expect(m.leg).toBe(3);
    expect(m.coachman.legs["3"]).toEqual({ name: "coachman" });
    expect(actionCount(join(root, "skip-review"), "note")).toBe(1);
    expect(readFileSync(join(root, "skip-review", "actions.jsonl"), "utf8")).toContain(
      "omit the review leg",
    );
    expect(actionCount(join(root, "skip-review"), "dispatch")).toBe(1);
    const shipCall = readFileSync(join(tmp, "calls", "dispatch-skip-review-3"), "utf8").split("\n");
    expect(shipCall).toContain("leg=ship");
  }, 60000);

  test("a run with no checkout recorded dispatches from its waybill tool", () => {
    const root = join(tmp, "auto-unpinned");
    mkdirSync(root, { recursive: true });
    autoRun(root, "unpinned", 1, "");
    handoff(join(root, "unpinned"), "1");
    const runJson = join(root, "unpinned", "run.json");
    const rec = JSON.parse(readFileSync(runJson, "utf8")) as Record<string, unknown>;
    rec.postmaster = {};
    writeFileSync(runJson, `${JSON.stringify(rec, null, 2)}\n`);
    writeFileSync(
      join(root, "unpinned", "brief.md"),
      readFileSync(join(root, "unpinned", "brief.md"), "utf8") + `tool: ${pin}\n`,
    );
    writeFileSync(join(root, "unpinned", ".leg-1-done"), "");
    writeFileSync(join(root, "unpinned", ".leg-1-exited"), "");
    const { rc } = watchStub(root);
    expect(rc).toBe(3);
    const call = readFileSync(join(tmp, "calls", "dispatch-unpinned-2"), "utf8").split("\n");
    expect(call).toContain(`rt=${pin}`);
    expect(actionCount(join(root, "unpinned"), "dispatch")).toBe(1);
  }, 60000);

  test("a checkout that moved past its dispatch commit wakes and launches nothing", () => {
    const root = join(tmp, "auto-stale-pin");
    mkdirSync(root, { recursive: true });
    autoRun(root, "stale-pin", 1, "");
    handoff(join(root, "stale-pin"), "1");
    const runJson = join(root, "stale-pin", "run.json");
    const rec = JSON.parse(readFileSync(runJson, "utf8")) as {
      postmaster: Record<string, string>;
    };
    rec.postmaster.commit = "0".repeat(40);
    writeFileSync(runJson, `${JSON.stringify(rec, null, 2)}\n`);
    writeFileSync(join(root, "stale-pin", ".leg-1-done"), "");
    writeFileSync(join(root, "stale-pin", ".leg-1-exited"), "");
    const { rc, out } = watchStub(root);
    expect(rc).toBe(0);
    expect(out).toContain("needs stale-pin DISPATCH");
    expect(out).toContain("does not serve");
    expect(existsSync(join(tmp, "calls", "dispatch-stale-pin-2"))).toBe(false);
  }, 60000);

  test("a checkout without the leg script wakes with nothing started", () => {
    const root = join(tmp, "auto-no-leg");
    mkdirSync(root, { recursive: true });
    autoRun(root, "no-leg", 1, "");
    handoff(join(root, "no-leg"), "1");
    const made = makePin(join(tmp, "pin-noleg"), false);
    const runJson = join(root, "no-leg", "run.json");
    const rec = JSON.parse(readFileSync(runJson, "utf8")) as Record<string, unknown>;
    rec.postmaster = { commit: made.commit, checkout: made.pin };
    writeFileSync(runJson, `${JSON.stringify(rec, null, 2)}\n`);
    writeFileSync(join(root, "no-leg", ".leg-1-done"), "");
    writeFileSync(join(root, "no-leg", ".leg-1-exited"), "");
    const { rc, out } = watchStub(root);
    expect(rc).toBe(0);
    expect(out).toContain("needs no-leg DISPATCH");
    expect(out).toContain("not executable");
    expect(existsSync(join(tmp, "calls", "dispatch-no-leg-2"))).toBe(true);
    expect(existsSync(join(root, "no-leg", "logs", "coachman-leg-2-attempts.jsonl"))).toBe(false);
    expect(existsSync(join(root, "no-leg", ".leg-2-exited"))).toBe(false);
    expect(existsSync(join(root, "no-leg", "leg-2-prompt.txt"))).toBe(true);
  }, 60000);

  test("a waybill with no repo path dispatches from the recorded checks", () => {
    const root = join(tmp, "auto-repo-fallback");
    mkdirSync(root, { recursive: true });
    autoRun(root, "repo-fallback", 1, "");
    handoff(join(root, "repo-fallback"), "1");
    const brief = join(root, "repo-fallback", "brief.md");
    writeFileSync(brief, readFileSync(brief, "utf8").replace(/^repo: .*\n/mu, ""));
    writeFileSync(
      join(root, "repo-fallback", "checks.json"),
      JSON.stringify({ repo: `${root}-project`, head: "fixture", checks: [] }),
    );
    writeFileSync(join(root, "repo-fallback", ".leg-1-done"), "");
    writeFileSync(join(root, "repo-fallback", ".leg-1-exited"), "");
    const { rc } = watchStub(root);
    expect(rc).toBe(3);
    expect(existsSync(join(tmp, "calls", "dispatch-repo-fallback-2"))).toBe(true);
    expect(actionCount(join(root, "repo-fallback"), "dispatch")).toBe(1);
  }, 60000);

  test("a run with no repo anywhere wakes and launches nothing", () => {
    const root = join(tmp, "auto-no-repo");
    mkdirSync(root, { recursive: true });
    autoRun(root, "no-repo", 1, "");
    handoff(join(root, "no-repo"), "1");
    const brief = join(root, "no-repo", "brief.md");
    writeFileSync(brief, readFileSync(brief, "utf8").replace(/^repo: .*\n/mu, ""));
    writeFileSync(join(root, "no-repo", ".leg-1-done"), "");
    writeFileSync(join(root, "no-repo", ".leg-1-exited"), "");
    const { rc, out } = watchStub(root);
    expect(rc).toBe(0);
    expect(out).toContain("needs no-repo DISPATCH");
    expect(existsSync(join(tmp, "calls", "dispatch-no-repo-2"))).toBe(false);
  }, 60000);

  test("a one-line profile dispatches from the repo field alone", () => {
    const root = join(tmp, "auto-one-line");
    mkdirSync(root, { recursive: true });
    autoRun(root, "one-line", 1, "");
    handoff(join(root, "one-line"), "1");
    const brief = join(root, "one-line", "brief.md");
    writeFileSync(
      brief,
      readFileSync(brief, "utf8").replace(
        /^repo: (.*)$/mu,
        "repo: $1          default branch: main       BASE: fixture",
      ),
    );
    writeFileSync(join(root, "one-line", ".leg-1-done"), "");
    writeFileSync(join(root, "one-line", ".leg-1-exited"), "");
    const { rc } = watchStub(root);
    expect(rc).toBe(3);
    expect(existsSync(join(tmp, "calls", "dispatch-one-line-2"))).toBe(true);
    expect(actionCount(join(root, "one-line"), "dispatch")).toBe(1);
  }, 60000);

  test("a ticket-text profile does not shadow the waybill's own", () => {
    const root = join(tmp, "auto-early-profile");
    mkdirSync(root, { recursive: true });
    autoRun(root, "early-profile", 1, "");
    handoff(join(root, "early-profile"), "1");
    const brief = join(root, "early-profile", "brief.md");
    writeFileSync(
      brief,
      readFileSync(brief, "utf8").replace(
        "## Ticket\n",
        "## Ticket\n## Problem\nx\n## Project profile\nrepo: /tmp/nowhere-shadow\n\n",
      ),
    );
    writeFileSync(join(root, "early-profile", ".leg-1-done"), "");
    writeFileSync(join(root, "early-profile", ".leg-1-exited"), "");
    const { rc } = watchStub(root);
    expect(rc).toBe(3);
    expect(existsSync(join(tmp, "calls", "dispatch-early-profile-2"))).toBe(true);
  }, 60000);
});

describe("corrupt manifests: reported once, never dispatched from, never fatal", () => {
  for (const bad of ["0", "true", "null", "2.0", "[]"]) {
    test(`corrupt manifest leg ${bad} is reported, never dispatched, never fatal`, () => {
      const root = join(tmp, `auto-corrupt-${bad}`);
      mkdirSync(root, { recursive: true });
      autoRun(root, "bad", 1, "");
      const spell = bad === "true" ? "True" : bad === "null" ? "None" : bad;
      handoff(join(root, "bad"), spell);
      const manifest = join(root, "bad", "manifest.json");
      writeFileSync(manifest, readFileSync(manifest, "utf8").replace(/"leg": 1/u, `"leg": ${bad}`));
      writeFileSync(join(root, "bad", `.leg-${spell}-done`), "");
      writeFileSync(join(root, "bad", `.leg-${spell}-exited`), "");
      mkrun(root, "good", "review", 2, ".escalation-ready");
      const { rc, out } = watchStub(root);
      const still = /"leg": ([^,\n}]+)/u.exec(readFileSync(manifest, "utf8"))?.[1];
      expect(rc).toBe(0);
      expect(out).toContain("needs bad DISPATCH");
      expect(out).toContain("manifest leg");
      expect(out).toContain("needs good RULE");
      expect(still).toBe(bad);
      expect(existsSync(join(tmp, "calls", "dispatch-bad-2"))).toBe(false);
    }, 60000);
  }

  for (const bad of ["02", "08"]) {
    test(`leading-zero leg ${bad} is reported corrupt, never dispatched, never fatal`, () => {
      const root = join(tmp, `auto-corrupt-${bad}`);
      mkdirSync(root, { recursive: true });
      autoRun(root, "badleg", 1, "");
      handoff(join(root, "badleg"), bad);
      const manifest = join(root, "badleg", "manifest.json");
      writeFileSync(
        manifest,
        readFileSync(manifest, "utf8").replace(/"leg": 1/u, `"leg": "${bad}"`),
      );
      writeFileSync(join(root, "badleg", `.leg-${bad}-done`), "");
      writeFileSync(join(root, "badleg", `.leg-${bad}-exited`), "");
      mkrun(root, "good", "review", 2, ".escalation-ready");
      const { rc, out } = watchStub(root);
      const still = JSON.stringify(
        (JSON.parse(readFileSync(manifest, "utf8")) as { leg: unknown }).leg,
      );
      expect(rc).toBe(0);
      expect(out).toContain("needs badleg DISPATCH");
      expect(out).toContain("not a canonical integer");
      expect(out).toContain("needs good RULE");
      expect(still).toBe(`"${bad}"`);
      expect(existsSync(join(tmp, "calls", "dispatch-badleg-2"))).toBe(false);
    }, 60000);
  }

  for (const bad of ["02", "08"]) {
    test(`leading-zero leg ${bad} on a resume is reported corrupt, never resumed, never fatal`, () => {
      const root = join(tmp, `auto-corrupt-remount-${bad}`);
      mkdirSync(root, { recursive: true });
      autoRun(root, "badremount", 1, "thread-badremount");
      const manifest = join(root, "badremount", "manifest.json");
      writeFileSync(
        manifest,
        readFileSync(manifest, "utf8").replace(/"leg": 1/u, `"leg": "${bad}"`),
      );
      recordAttempt(join(root, "badremount"), bad, "incomplete", "coachman", "thread-badremount");
      writeFileSync(
        join(root, "badremount", "logs", `coachman-leg-${bad}.err`),
        "model stream idle timeout\n",
      );
      writeFileSync(join(root, "badremount", "logs", `coachman-leg-${bad}-events.jsonl`), "");
      writeFileSync(join(root, "badremount", `.leg-${bad}-exited`), "");
      mkrun(root, "good", "review", 2, ".escalation-ready");
      const { rc, out } = watchStub(root);
      expect(rc).toBe(0);
      expect(out).toContain("needs badremount RESUME");
      expect(out).toContain("not a canonical integer");
      expect(out).toContain("needs good RULE");
      expect(existsSync(join(tmp, "calls", `resume-badremount-${bad}`))).toBe(false);
      expect(existsSync(join(root, "badremount", "watcher.json"))).toBe(false);
    }, 60000);
  }
});

describe("watcher steps: resume controls", () => {
  function seedResume(root: string, name: string, errText: string): void {
    writeFileSync(join(root, name, "logs", "coachman-leg-1.err"), `${errText}\n`);
    writeFileSync(join(root, name, ".leg-1-exited"), "");
  }

  function resumeCountOf(root: string, name: string): number {
    return (
      JSON.parse(readFileSync(join(root, name, "watcher.json"), "utf8")) as {
        resume_attempts: Record<string, number>;
      }
    ).resume_attempts["1"]!;
  }

  test("a named transient end resumes the recorded thread with the remount prompt and logs it without launching an agent in the control", () => {
    const root = join(tmp, "auto-resume");
    mkdirSync(root, { recursive: true });
    autoRun(root, "resume", 1, "prior-thread");
    recordAttempt(join(root, "resume"), "1", "incomplete", "coachman", "prior-thread");
    writeFileSync(
      join(root, "resume", "logs", "coachman-leg-1.err"),
      "Model stream idle timeout\n",
    );
    writeFileSync(join(root, "resume", "logs", "coachman-leg-1-events.jsonl"), "");
    writeFileSync(join(root, "resume", ".leg-1-exited"), "");
    const { rc, out } = watchStub(root);
    expect(rc).toBe(3);
    expect(out).toContain("resume ");
    expect(actionCount(join(root, "resume"), "resume")).toBe(1);
    const actions = readFileSync(join(root, "resume", "actions.jsonl"), "utf8");
    expect(actions).toContain("watcher took it");
    expect(actions).toContain("resume 1 of 3");
    const prompts = readdirSync(join(root, "resume")).filter((f) => f.startsWith("leg-1-resume-"));
    expect(prompts.length).toBe(1);
    expect(readFileSync(join(root, "resume", prompts[0]!), "utf8")).toContain(
      "Continue leg 1; your last written state is in the dispatch directory and the worktree.",
    );
    const call = readFileSync(join(tmp, "calls", "resume-resume-1"), "utf8").split("\n");
    expect(call).toContain("kind=resume");
    expect(call).toContain(`rt=${pin}`);
    expect(call).toContain("leg=synthesis");
    expect(call).toContain("thread=prior-thread");
    expect(existsSync(join(root, "resume", ".leg-1-exited"))).toBe(false);
  }, 60000);

  for (const attempt of [2, 3]) {
    test(`transient end ${attempt} is resumed and its per-leg count persists`, () => {
      const root = join(tmp, `auto-resume-${attempt}`);
      mkdirSync(root, { recursive: true });
      autoRun(root, "resume", 1, "prior-thread");
      recordAttempt(join(root, "resume"), "1", "incomplete", "coachman", "prior-thread");
      writeFileSync(
        join(root, "resume", "logs", "coachman-leg-1.err"),
        "Model stream idle timeout\n",
      );
      writeFileSync(join(root, "resume", "logs", "coachman-leg-1-events.jsonl"), "");
      for (let a = 1; a <= attempt; a++) {
        if (a > 1) seedResume(root, "resume", "model_stream_idle_timeout");
        else writeFileSync(join(root, "resume", ".leg-1-exited"), "");
        const { rc } = watchStub(root);
        expect(rc).toBe(3);
      }
      expect(resumeCountOf(root, "resume")).toBe(attempt);
      expect(actionCount(join(root, "resume"), "resume")).toBe(attempt);
    }, 120000);
  }

  test("the fourth transient end wakes the postmaster without incrementing or resuming", () => {
    const root = join(tmp, "auto-resume-4");
    mkdirSync(root, { recursive: true });
    autoRun(root, "resume", 1, "prior-thread");
    recordAttempt(join(root, "resume"), "1", "incomplete", "coachman", "prior-thread");
    writeFileSync(
      join(root, "resume", "logs", "coachman-leg-1.err"),
      "Model stream idle timeout\n",
    );
    writeFileSync(join(root, "resume", "logs", "coachman-leg-1-events.jsonl"), "");
    for (let a = 1; a <= 3; a++) {
      if (a > 1) seedResume(root, "resume", "model_stream_idle_timeout");
      else writeFileSync(join(root, "resume", ".leg-1-exited"), "");
      const { rc } = watchStub(root);
      expect(rc).toBe(3);
    }
    seedResume(root, "resume", "model stream idle timeout");
    const { rc, out } = watchStub(root);
    expect(rc).toBe(0);
    expect(out).toContain("needs resume RESUME");
    expect(resumeCountOf(root, "resume")).toBe(3);
    expect(actionCount(join(root, "resume"), "resume")).toBe(3);
  }, 120000);

  test("a transient end on a fallback leg resumes on its recorded thread", () => {
    const root = join(tmp, "auto-resume-fallback");
    mkdirSync(root, { recursive: true });
    autoRun(root, "resume-fallback", 1, "thread-fb");
    const manifest = join(root, "resume-fallback", "manifest.json");
    const m = JSON.parse(readFileSync(manifest, "utf8")) as {
      coachman: { legs: Record<string, Record<string, string>> };
    };
    m.coachman.legs["1"]!.name = "coachman_fallback";
    writeFileSync(manifest, `${JSON.stringify(m, null, 2)}\n`);
    recordAttempt(
      join(root, "resume-fallback"),
      "1",
      "incomplete",
      "coachman_fallback",
      "thread-fb",
    );
    writeFileSync(
      join(root, "resume-fallback", "logs", "coachman-leg-1.err"),
      "model stream idle timeout\n",
    );
    writeFileSync(join(root, "resume-fallback", "logs", "coachman-leg-1-events.jsonl"), "");
    writeFileSync(join(root, "resume-fallback", ".leg-1-exited"), "");
    const { rc } = watchStub(root);
    expect(rc).toBe(3);
    expect(actionCount(join(root, "resume-fallback"), "resume")).toBe(1);
    const call = readFileSync(join(tmp, "calls", "resume-resume-fallback-1"), "utf8").split("\n");
    expect(call).toContain("thread=thread-fb");
  }, 60000);

  test("an old transient error in the stream does not resume a later unrelated failure", () => {
    const root = join(tmp, "auto-stale");
    mkdirSync(root, { recursive: true });
    autoRun(root, "stale", 1, "thread-stale");
    recordAttempt(join(root, "stale"), "1", "incomplete", "coachman", "thread-stale");
    writeFileSync(join(root, "stale", "logs", "coachman-leg-1.err"), "model stream idle timeout\n");
    writeFileSync(
      join(root, "stale", "logs", "coachman-leg-1-events.jsonl"),
      '{"type":"error","message":"model stream idle timeout"}\n',
    );
    writeFileSync(join(root, "stale", ".leg-1-exited"), "");
    const first = watchStub(root);
    expect(first.rc).toBe(3);
    expect(actionCount(join(root, "stale"), "resume")).toBe(1);
    writeFileSync(
      join(root, "stale", "logs", "coachman-leg-1.err"),
      "AssertionError: something the lane did wrong\n",
    );
    writeFileSync(join(root, "stale", ".leg-1-exited"), "");
    const { rc, out } = watchStub(root);
    expect(rc).toBe(0);
    expect(out).toContain("needs stale RESUME");
    expect(resumeCountOf(root, "stale")).toBe(1);
    expect(actionCount(join(root, "stale"), "resume")).toBe(1);
  }, 60000);

  test("an unterminated old error stays out of the new classification", () => {
    const root = join(tmp, "auto-unterm");
    mkdirSync(root, { recursive: true });
    autoRun(root, "unterm", 1, "thread-unterm");
    recordAttempt(join(root, "unterm"), "1", "incomplete", "coachman", "thread-unterm");
    writeFileSync(
      join(root, "unterm", "logs", "coachman-leg-1.err"),
      "model stream idle timeout\n",
    );
    writeFileSync(
      join(root, "unterm", "logs", "coachman-leg-1-events.jsonl"),
      '{"type":"assistant","message":"hi"}\n{"type":"error","message":"model stream idle timeout"}',
    );
    writeFileSync(join(root, "unterm", ".leg-1-exited"), "");
    const first = watchStub(root);
    expect(first.rc).toBe(3);
    expect(actionCount(join(root, "unterm"), "resume")).toBe(1);
    // The stub always appends; a resumed launch that dies silent appends nothing. Restore the
    // lane's exact shape to model it: the old error last and unterminated, nothing after.
    writeFileSync(
      join(root, "unterm", "logs", "coachman-leg-1-events.jsonl"),
      '{"type":"assistant","message":"hi"}\n{"type":"error","message":"model stream idle timeout"}',
    );
    writeFileSync(
      join(root, "unterm", "logs", "coachman-leg-1.err"),
      "AssertionError: something the lane did wrong\n",
    );
    writeFileSync(join(root, "unterm", ".leg-1-exited"), "");
    const { rc, out } = watchStub(root);
    const watcher = JSON.parse(readFileSync(join(root, "unterm", "watcher.json"), "utf8")) as {
      resume_attempts: Record<string, number>;
      stream_skip: Record<string, number>;
    };
    expect(rc).toBe(0);
    expect(out).toContain("needs unterm RESUME");
    expect(`${watcher.resume_attempts["1"]}/${watcher.stream_skip["1"]}`).toBe("1/2");
    expect(actionCount(join(root, "unterm"), "resume")).toBe(1);
  }, 60000);

  for (const [name, message] of [
    ["gateway", "529 overloaded"],
    ["drop", "read: connection reset by peer"],
  ]) {
    test(`a ${name} failure is resumed as a named transient end`, () => {
      const root = join(tmp, `auto-${name}`);
      mkdirSync(root, { recursive: true });
      autoRun(root, name, 1, `thread-${name}`);
      recordAttempt(join(root, name), "1", "incomplete", "coachman", `thread-${name}`);
      writeFileSync(join(root, name, "logs", "coachman-leg-1.err"), `${message}\n`);
      writeFileSync(join(root, name, "logs", "coachman-leg-1-events.jsonl"), "");
      writeFileSync(join(root, name, ".leg-1-exited"), "");
      const { rc } = watchStub(root);
      expect(rc).toBe(3);
      expect(actionCount(join(root, name), "resume")).toBe(1);
      expect(existsSync(join(tmp, "calls", `resume-${name}-1`))).toBe(true);
    }, 60000);
  }
});

describe("postmaster wake controls: recorded walls and refusals", () => {
  for (const [name, want, outcome, role, message] of [
    ["wall", "TAKEOVER", "walled", "coachman", "quota exceeded: provider capacity reached"],
    ["provider", "TAKEOVER", "walled", "coachman", "provider wall: model capacity exhausted"],
    ["fallbackwall", "ASK", "walled", "coachman_fallback", "quota exceeded on the fallback leg"],
    ["refusal", "ASK", "refused", "coachman", "launch: resume needs a thread id"],
  ]) {
    test(`${name} remains with the postmaster and is not retried`, () => {
      const root = join(tmp, `wake-${name}`);
      mkdirSync(root, { recursive: true });
      autoRun(root, name, 1, `thread-${name}`);
      recordAttempt(join(root, name), "1", outcome, role, `thread-${name}`);
      writeFileSync(join(root, name, "logs", "coachman-leg-1.err"), `${message}\n`);
      writeFileSync(join(root, name, "logs", "coachman-leg-1-events.jsonl"), "");
      writeFileSync(join(root, name, ".leg-1-exited"), "");
      const { rc, out } = watchStub(root);
      expect(rc).toBe(0);
      expect(out).toContain(`needs ${name} ${want}`);
      expect(existsSync(join(root, name, "watcher.json"))).toBe(false);
      expect(existsSync(join(tmp, "calls", `resume-${name}-1`))).toBe(false);
    }, 60000);
  }

  test("an unlisted provider error stays with the postmaster", () => {
    const root = join(tmp, "wake-other-error");
    mkdirSync(root, { recursive: true });
    autoRun(root, "other-error", 1, "thread-other");
    recordAttempt(join(root, "other-error"), "1", "incomplete", "coachman", "thread-other");
    writeFileSync(
      join(root, "other-error", "logs", "coachman-leg-1.err"),
      "AssertionError: something the lane did wrong\n",
    );
    writeFileSync(join(root, "other-error", "logs", "coachman-leg-1-events.jsonl"), "");
    writeFileSync(join(root, "other-error", ".leg-1-exited"), "");
    const { rc, out } = watchStub(root);
    expect(rc).toBe(0);
    expect(out).toContain("needs other-error RESUME");
    expect(existsSync(join(root, "other-error", "watcher.json"))).toBe(false);
    expect(existsSync(join(tmp, "calls", "resume-other-error-1"))).toBe(false);
  }, 60000);

  test("a resume the manifest cannot thread stays with the postmaster", () => {
    const root = join(tmp, "wake-no-thread-remount");
    mkdirSync(root, { recursive: true });
    autoRun(root, "no-thread-remount", 1, "");
    recordAttempt(
      join(root, "no-thread-remount"),
      "1",
      "incomplete",
      "coachman",
      "thread-elsewhere",
    );
    writeFileSync(
      join(root, "no-thread-remount", "logs", "coachman-leg-1.err"),
      "model stream idle timeout\n",
    );
    writeFileSync(join(root, "no-thread-remount", "logs", "coachman-leg-1-events.jsonl"), "");
    writeFileSync(join(root, "no-thread-remount", ".leg-1-exited"), "");
    const { rc, out } = watchStub(root);
    expect(rc).toBe(0);
    expect(out).toContain("needs no-thread-remount RESUME");
    expect(out).toContain("no recorded thread id");
    expect(existsSync(join(root, "no-thread-remount", "watcher.json"))).toBe(false);
    expect(existsSync(join(tmp, "calls", "resume-no-thread-remount-1"))).toBe(false);
  }, 60000);
});

describe("postmaster wake controls: incomplete watcher steps", () => {
  test("a failed hand-off check wakes the postmaster and launches nothing", () => {
    const root = join(tmp, "wake-handoff");
    mkdirSync(root, { recursive: true });
    autoRun(root, "handoff", 1, "");
    writeFileSync(join(root, "handoff", ".leg-1-done"), "");
    writeFileSync(join(root, "handoff", ".leg-1-exited"), "");
    writeFileSync(
      join(root, "handoff", "handoff-1.md"),
      "## Decisions\nmissing the other required sections\n",
    );
    const { rc, out } = watchStub(root);
    expect(rc).toBe(0);
    expect(out).toContain("needs handoff DISPATCH");
    expect(existsSync(join(tmp, "calls", "dispatch-handoff-2"))).toBe(false);
  }, 60000);

  test("a failed turnpikes lookup wakes the postmaster and launches nothing", () => {
    const root = join(tmp, "wake-legs");
    mkdirSync(root, { recursive: true });
    autoRun(root, "legs", 1, "");
    writeFileSync(join(root, "legs", ".leg-1-done"), "");
    writeFileSync(join(root, "legs", ".leg-1-exited"), "");
    const brief = join(root, "legs", "brief.md");
    writeFileSync(
      brief,
      readFileSync(brief, "utf8").replace(/^turnpikes:.*$/mu, "not a turnpikes line"),
    );
    handoff(join(root, "legs"), "1");
    const { rc, out } = watchStub(root);
    expect(rc).toBe(0);
    expect(out).toContain("needs legs DISPATCH");
    expect(existsSync(join(tmp, "calls", "dispatch-legs-2"))).toBe(false);
  }, 60000);

  test("a done ship leg with nothing after it wakes for the close", () => {
    const root = join(tmp, "wake-close");
    mkdirSync(root, { recursive: true });
    autoRun(root, "close", 3, "thread-close");
    handoff(join(root, "close"), "3");
    const brief = join(root, "close", "brief.md");
    writeFileSync(
      brief,
      readFileSync(brief, "utf8").replace(/^turnpikes:.*$/mu, "turnpikes: none"),
    );
    writeFileSync(join(root, "close", ".leg-3-done"), "");
    writeFileSync(join(root, "close", ".leg-3-exited"), "");
    const { rc, out } = watchStub(root);
    expect(rc).toBe(0);
    expect(out).toContain("needs close DISPATCH");
    expect(existsSync(join(tmp, "calls", "dispatch-close-4"))).toBe(false);
  }, 60000);

  test("a dispatch the host cannot start wakes with its refusal recorded", () => {
    const root = join(tmp, "wake-dispatch");
    mkdirSync(root, { recursive: true });
    autoRun(root, "dispatch-failure", 1, "");
    handoff(join(root, "dispatch-failure"), "1");
    writeFileSync(join(root, "dispatch-failure", ".leg-1-done"), "");
    writeFileSync(join(root, "dispatch-failure", ".leg-1-exited"), "");
    const { rc, out } = watchStub(root, "dispatch failure");
    const refused = JSON.parse(
      readFileSync(join(root, "dispatch-failure", "logs", "coachman-leg-2-attempts.jsonl"), "utf8"),
    ) as { outcome: string; leg: unknown };
    const m = JSON.parse(readFileSync(join(root, "dispatch-failure", "manifest.json"), "utf8")) as {
      leg: number;
    };
    expect(rc).toBe(0);
    expect(out).toContain("needs dispatch-failure DISPATCH");
    expect(existsSync(join(root, "dispatch-failure", ".leg-2-exited"))).toBe(false);
    expect(refused.outcome).toBe("refused");
    expect(refused.leg).toBe(2);
    expect(m.leg).toBe(2);
    expect(actionCount(join(root, "dispatch-failure"), "dispatch")).toBe(0);
  }, 60000);

  test("a dispatch the leg refuses wakes with markers and records untouched", () => {
    const root = join(tmp, "wake-launch-refusal");
    mkdirSync(root, { recursive: true });
    autoRun(root, "launch-refusal", 1, "");
    handoff(join(root, "launch-refusal"), "1");
    writeFileSync(join(root, "launch-refusal", ".leg-1-done"), "");
    writeFileSync(join(root, "launch-refusal", ".leg-1-exited"), "");
    const { rc, out } = watchStub(root, "dispatch refusal");
    const m = JSON.parse(readFileSync(join(root, "launch-refusal", "manifest.json"), "utf8")) as {
      leg: number;
    };
    expect(rc).toBe(0);
    expect(out).toContain("needs launch-refusal DISPATCH");
    expect(existsSync(join(root, "launch-refusal", "logs", "coachman-leg-2-attempts.jsonl"))).toBe(
      false,
    );
    expect(existsSync(join(root, "launch-refusal", ".leg-2-exited"))).toBe(false);
    expect(existsSync(join(root, "launch-refusal", ".leg-2-done"))).toBe(false);
    expect(existsSync(join(root, "launch-refusal", "watcher.json"))).toBe(false);
    expect(m.leg).toBe(2);
  }, 60000);

  test("a resume the host cannot start wakes with its refusal recorded and the count restored", () => {
    const root = join(tmp, "wake-resume");
    mkdirSync(root, { recursive: true });
    autoRun(root, "resume-failure", 1, "thread-resume");
    recordAttempt(join(root, "resume-failure"), "1", "incomplete", "coachman", "thread-resume");
    writeFileSync(
      join(root, "resume-failure", "logs", "coachman-leg-1.err"),
      "model stream idle timeout\n",
    );
    writeFileSync(join(root, "resume-failure", "logs", "coachman-leg-1-events.jsonl"), "");
    writeFileSync(join(root, "resume-failure", ".leg-1-exited"), "");
    const { rc, out } = watchStub(root, "resume failure");
    const watcher = JSON.parse(
      readFileSync(join(root, "resume-failure", "watcher.json"), "utf8"),
    ) as {
      resume_attempts: Record<string, number>;
    };
    const lines = readFileSync(
      join(root, "resume-failure", "logs", "coachman-leg-1-attempts.jsonl"),
      "utf8",
    )
      .split("\n")
      .filter((l) => l !== "");
    const last = JSON.parse(lines[lines.length - 1]!) as { outcome: string };
    expect(rc).toBe(0);
    expect(out).toContain("needs resume-failure RESUME");
    expect(actionCount(join(root, "resume-failure"), "resume")).toBe(0);
    expect(actionCount(join(root, "resume-failure"), "refuse")).toBe(1);
    expect(watcher.resume_attempts["1"]).toBe(0);
    expect(last.outcome).toBe("refused");
  }, 60000);

  test("a refused resume wakes in the same look with a refusal record, the count unchanged, and no success line", () => {
    const root = join(tmp, "wake-resume-refusal");
    mkdirSync(root, { recursive: true });
    autoRun(root, "resume-refusal", 1, "thread-resume-refusal");
    recordAttempt(
      join(root, "resume-refusal"),
      "1",
      "incomplete",
      "coachman",
      "thread-resume-refusal",
    );
    writeFileSync(
      join(root, "resume-refusal", "logs", "coachman-leg-1.err"),
      "model stream idle timeout\n",
    );
    writeFileSync(join(root, "resume-refusal", "logs", "coachman-leg-1-events.jsonl"), "");
    writeFileSync(join(root, "resume-refusal", ".leg-1-exited"), "");
    const { rc, out } = watchStub(root, "resume refusal");
    const watcher = JSON.parse(
      readFileSync(join(root, "resume-refusal", "watcher.json"), "utf8"),
    ) as {
      resume_attempts: Record<string, number>;
    };
    expect(rc).toBe(0);
    expect(out).toContain("needs resume-refusal RESUME");
    expect(out).toContain("leg: simulated refusal");
    expect(actionCount(join(root, "resume-refusal"), "refuse")).toBe(1);
    expect(actionCount(join(root, "resume-refusal"), "resume")).toBe(0);
    expect(readFileSync(join(root, "resume-refusal", "actions.jsonl"), "utf8")).not.toContain(
      "watcher took it",
    );
    expect(watcher.resume_attempts["1"]).toBe(0);
    const lastLine = readFileSync(
      join(root, "resume-refusal", "logs", "coachman-leg-1-attempts.jsonl"),
      "utf8",
    )
      .split("\n")
      .filter((l) => l !== "")
      .pop()!;
    expect((JSON.parse(lastLine) as { outcome: string }).outcome).toBe("incomplete");
  }, 60000);

  test("a standing refusal is named every look without spending a remount", () => {
    const root = join(tmp, "wake-resume-refusal-many");
    mkdirSync(root, { recursive: true });
    autoRun(root, "refusal-many", 1, "thread-refusal-many");
    recordAttempt(join(root, "refusal-many"), "1", "incomplete", "coachman", "thread-refusal-many");
    writeFileSync(
      join(root, "refusal-many", "logs", "coachman-leg-1.err"),
      "model stream idle timeout\n",
    );
    writeFileSync(join(root, "refusal-many", "logs", "coachman-leg-1-events.jsonl"), "");
    writeFileSync(join(root, "refusal-many", ".leg-1-exited"), "");
    const { rc, out } = watchStubWait(root);
    const watcher = JSON.parse(
      readFileSync(join(root, "refusal-many", "watcher.json"), "utf8"),
    ) as {
      resume_attempts: Record<string, number>;
    };
    expect(rc).toBe(0);
    expect(out).toContain("needs refusal-many RESUME");
    expect(actionCount(join(root, "refusal-many"), "refuse") >= 1).toBe(true);
    expect(actionCount(join(root, "refusal-many"), "resume")).toBe(0);
    expect(watcher.resume_attempts["1"]).toBe(0);
  }, 60000);

  test("a dispatch whose action cannot be logged wakes the postmaster", () => {
    const root = join(tmp, "wake-log");
    mkdirSync(root, { recursive: true });
    autoRun(root, "log-failure", 1, "");
    handoff(join(root, "log-failure"), "1");
    writeFileSync(join(root, "log-failure", ".leg-1-done"), "");
    writeFileSync(join(root, "log-failure", ".leg-1-exited"), "");
    rmSync(join(root, "log-failure", "actions.jsonl"));
    mkdirSync(join(root, "log-failure", "actions.jsonl"));
    const { rc, out } = watchStub(root);
    expect(rc).toBe(0);
    expect(out).toContain("needs log-failure DISPATCH");
    expect(existsSync(join(tmp, "calls", "dispatch-log-failure-2"))).toBe(true);
  }, 60000);

  test("a resume whose action cannot be logged wakes the postmaster", () => {
    const root = join(tmp, "wake-resume-log");
    mkdirSync(root, { recursive: true });
    autoRun(root, "resume-log", 1, "thread-resume-log");
    recordAttempt(join(root, "resume-log"), "1", "incomplete", "coachman", "thread-resume-log");
    writeFileSync(
      join(root, "resume-log", "logs", "coachman-leg-1.err"),
      "model stream idle timeout\n",
    );
    writeFileSync(join(root, "resume-log", "logs", "coachman-leg-1-events.jsonl"), "");
    writeFileSync(join(root, "resume-log", ".leg-1-exited"), "");
    rmSync(join(root, "resume-log", "actions.jsonl"));
    mkdirSync(join(root, "resume-log", "actions.jsonl"));
    const { rc, out } = watchStub(root);
    const watcher = JSON.parse(readFileSync(join(root, "resume-log", "watcher.json"), "utf8")) as {
      resume_attempts: Record<string, number>;
    };
    expect(rc).toBe(0);
    expect(out).toContain("needs resume-log RESUME");
    expect(existsSync(join(tmp, "calls", "resume-resume-log-1"))).toBe(true);
    expect(watcher.resume_attempts["1"]).toBe(1);
  }, 60000);
});

describe("negative controls: held runs are left untouched", () => {
  test("a held dispatch run keeps its manifest, markers, log, and files unchanged", () => {
    const root = join(tmp, "held-dispatch");
    mkdirSync(root, { recursive: true });
    autoRun(root, "held-dispatch", 1, "");
    handoff(join(root, "held-dispatch"), "1");
    writeFileSync(join(root, "held-dispatch", ".leg-1-done"), "");
    writeFileSync(join(root, "held-dispatch", ".leg-1-exited"), "");
    writeFileSync(join(root, "postmaster", "held"), "held-dispatch\n");
    const { rc, out } = watchStub(root);
    const m = JSON.parse(readFileSync(join(root, "held-dispatch", "manifest.json"), "utf8")) as {
      leg: number;
    };
    expect(rc).toBe(3);
    expect(out).not.toContain("needs ");
    expect(existsSync(join(tmp, "calls", "dispatch-held-dispatch-2"))).toBe(false);
    expect(existsSync(join(root, "held-dispatch", "leg-2-prompt.txt"))).toBe(false);
    expect(existsSync(join(root, "held-dispatch", "watcher.json"))).toBe(false);
    expect(existsSync(join(root, "held-dispatch", ".leg-1-done"))).toBe(true);
    expect(existsSync(join(root, "held-dispatch", ".leg-1-exited"))).toBe(true);
    expect(actionCount(join(root, "held-dispatch"), "dispatch")).toBe(0);
    expect(m.leg).toBe(1);
  }, 60000);

  test("a held resume run keeps its count, marker, and log unchanged", () => {
    const root = join(tmp, "held-resume");
    mkdirSync(root, { recursive: true });
    autoRun(root, "held-resume", 1, "thread-held");
    recordAttempt(join(root, "held-resume"), "1", "incomplete", "coachman", "thread-held");
    writeFileSync(
      join(root, "held-resume", "logs", "coachman-leg-1.err"),
      "model stream idle timeout\n",
    );
    writeFileSync(join(root, "held-resume", "logs", "coachman-leg-1-events.jsonl"), "");
    writeFileSync(join(root, "held-resume", ".leg-1-exited"), "");
    writeFileSync(join(root, "postmaster", "held"), "held-resume\n");
    const { rc, out } = watchStub(root);
    expect(rc).toBe(3);
    expect(out).not.toContain("needs ");
    expect(existsSync(join(tmp, "calls", "resume-held-resume-1"))).toBe(false);
    expect(existsSync(join(root, "held-resume", "watcher.json"))).toBe(false);
    expect(existsSync(join(root, "held-resume", ".leg-1-exited"))).toBe(true);
    expect(actionCount(join(root, "held-resume"), "resume")).toBe(0);
  }, 60000);
});

describe("ready tickets wait for a run slot", () => {
  function queued(root: string, id: string): void {
    const dir = join(root, "postmaster", "ready");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${encodeURIComponent(id)}.ready`), `${id}\n`);
  }

  test("a queued ticket wakes the postmaster when a slot is free", () => {
    const root = join(tmp, "ready-free");
    const config = join(tmp, "ready-free.toml");
    mkdirSync(root, { recursive: true });
    writeFileSync(config, "[postmaster]\npoll_seconds = 1\n[team]\nmax_runs = 2\n");
    queued(root, "#2");
    expect(pendingReadyTickets(root)).toEqual(["#2"]);
    expect(activeRunCount(root)).toBe(0);
    expect(runCapacity(config)).toBe(2);
    const { rc, out } = watch(root, "0", config);
    expect(rc).toBe(0);
    expect(out).toContain("needs READY #2");
  }, 30000);

  test("a queued ticket waits until an in-flight run frees its slot", () => {
    const root = join(tmp, "ready-wait-slot");
    const config = join(tmp, "ready-one-slot.toml");
    mkdirSync(root, { recursive: true });
    writeFileSync(config, "[postmaster]\npoll_seconds = 1\n[team]\nmax_runs = 1\n");
    mkrun(root, "flight", "review", 2);
    queued(root, "2");
    const manifest = join(root, "flight", "manifest.json");
    const child = spawn("sh", ["-c", 'sleep 2; printf \'{"stage":"done","leg":2}\\n\' > "$1"', "sh", manifest], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    expect(activeRunCount(root)).toBe(1);
    const { rc, out } = watch(root, "8", config);
    expect(rc).toBe(0);
    expect(out).toContain("needs READY 2");
    expect(activeRunCount(root)).toBe(0);
  }, 30000);

  test("a pending ticket does not wake a full run ceiling", () => {
    const root = join(tmp, "ready-full");
    const config = join(tmp, "ready-full.toml");
    mkdirSync(root, { recursive: true });
    writeFileSync(config, "[postmaster]\npoll_seconds = 1\n[team]\nmax_runs = 1\n");
    mkrun(root, "flight", "review", 2);
    queued(root, "2");
    const { rc, out } = watch(root, "0", config);
    expect(rc).toBe(3);
    expect(out).not.toContain("needs READY");
  }, 30000);
});

describe("config: a missing or unusable poll interval falls back to the default", () => {
  let root = "";

  beforeAll(() => {
    root = join(tmp, "cfg-missing");
    mkdirSync(root, { recursive: true });
    mkrun(root, "wait", "review", 2);
  });

  test("a missing config still runs on the default, and says so", () => {
    const { rc, out } = watch(root, "2", join(tmp, "nowhere.toml"));
    expect(rc).toBe(3);
    expect(out).toContain("NEXT");
    expect(out).toContain("wait ");
    expect(out).not.toContain("needs ");
    expect(out).toContain("the poll interval is the default, 120s");
  }, 30000);

  test("an unusable poll interval falls back to the default, and says so", () => {
    writeFileSync(join(tmp, "bad.toml"), '[postmaster]\npoll_seconds = "soon"\n');
    const { rc, out } = watch(root, "2", join(tmp, "bad.toml"));
    expect(rc).toBe(3);
    expect(out).toContain("NEXT");
    expect(out).toContain("wait ");
    expect(out).toContain("the poll interval is the default, 120s");
  }, 30000);

  test("a zero poll interval falls back to the default, and says so", () => {
    writeFileSync(join(tmp, "zero.toml"), "[postmaster]\npoll_seconds = 0\n");
    const { rc, out } = watch(root, "2", join(tmp, "zero.toml"));
    expect(rc).toBe(3);
    expect(out).toContain("wait ");
    expect(out).toContain("the poll interval is the default, 120s");
  }, 30000);

  test("a config that is not UTF-8 falls back to the default, and says so", () => {
    writeFileSync(
      join(tmp, "badutf8.toml"),
      new Uint8Array([0xff, 0xfe, 0x00, 0x62, 0x61, 0x64, 0x80]),
    );
    const { rc, out } = watch(root, "2", join(tmp, "badutf8.toml"));
    expect(rc).toBe(3);
    expect(out).toContain("wait ");
    expect(out).toContain("the poll interval is the default, 120s");
    expect(out).not.toContain("Traceback");
  }, 30000);

  test("a timeout shorter than the poll interval still ends on time", () => {
    writeFileSync(join(tmp, "slow.toml"), "[postmaster]\npoll_seconds = 8\n");
    const t0 = Math.floor(Date.now() / 1000);
    const { rc, out } = watch(root, "2", join(tmp, "slow.toml"));
    const took = Math.floor(Date.now() / 1000) - t0;
    expect(rc).toBe(3);
    expect(out).toContain("wait ");
    expect(took <= 5).toBe(true);
  }, 30000);
});

describe("usage", () => {
  test("no run root is refused with the usage", () => {
    const r = run(self, []);
    const out = `${r.out}${r.err}`;
    expect(r.code).toBe(1);
    expect(out).toContain("usage:");
    expect(out).not.toContain("NEXT");
  }, 30000);

  test("a timeout that is not a number is refused", () => {
    const r = run(self, ["--timeout", "soon", join(tmp, "neg-wait")]);
    const out = `${r.out}${r.err}`;
    expect(r.code).toBe(1);
    expect(out).toContain("not a whole number");
  }, 30000);

  test("an empty timeout is refused", () => {
    const r = run(self, ["--timeout", "", join(tmp, "neg-wait")]);
    const out = `${r.out}${r.err}`;
    expect(r.code).toBe(1);
    expect(out).toContain("not a whole number");
  }, 30000);

  test("a run root that does not exist is refused", () => {
    const r = run(self, ["--timeout", "2", join(tmp, "nowhere")]);
    const out = `${r.out}${r.err}`;
    expect(r.code).toBe(1);
    expect(out).toContain("no such root");
  }, 30000);

  test("--help prints the usage", () => {
    const r = run(self, ["--help"]);
    const out = `${r.out}${r.err}`;
    expect(r.code).toBe(0);
    expect(out).toContain("runs-watch.sh");
    expect(out).toContain("held");
  }, 30000);
});
