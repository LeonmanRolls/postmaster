// Tests beside scripts/runs-status.ts, moved from its --self-test on #109: 47 controls.
// Forty-five fixture runs plus the postmaster directory are planted once in beforeAll;
// status() only reads, so every test is independent.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc";
import { pyWords } from "./lib/text";
import { status, walkFiles } from "./runs-status";

let tmp: string;
let root: string;

function mkRun(name: string, stage: string, leg: number, ...markers: string[]): void {
  const d = join(root, name);
  mkdirSync(join(d, "logs"), { recursive: true });
  writeFileSync(join(d, "manifest.json"), `{"stage": "${stage}", "leg": ${leg}}\n`);
  writeFileSync(join(d, "run-log.md"), "");
  for (const m of markers) writeFileSync(join(d, m), "");
}

function mkOdd(name: string, legLiteral: string, ...markers: string[]): void {
  const d = join(root, name);
  mkdirSync(join(d, "logs"), { recursive: true });
  writeFileSync(join(d, "manifest.json"), `{"stage": "review", "leg": ${legLiteral}}\n`);
  writeFileSync(join(d, "run-log.md"), "");
  for (const m of markers) writeFileSync(join(d, m), "");
}

function mkCurrent(name: string, stage: string, leg: number, ...markers: string[]): void {
  // A contract 2 dispatch; runs-status never reads run.json, the marker is realism.
  mkRun(name, stage, leg, ...markers);
  writeFileSync(join(root, name, "run.json"), '{"coachman_contract": 2}\n');
}

function record(name: string, outcome: string, role: string): void {
  writeFileSync(
    join(root, name, "logs", "coachman-leg-2-attempts.jsonl"),
    `{"outcome":"${outcome}","role":"${role}"}\n`,
  );
}

function recordn(name: string, attempt: number, outcome: string, role: string): void {
  const p = join(root, name, "logs", "coachman-leg-2-attempts.jsonl");
  const line = `{"attempt":${attempt},"outcome":"${outcome}","role":"${role}"}\n`;
  writeFileSync(p, (existsSync(p) ? readFileSync(p, "utf8") : "") + line);
}

function phase(name: string, n: number): void {
  writeFileSync(join(root, name, "logs", `coachman-leg-2-phase-${n}`), "started\n");
}

function intent(name: string, n: number, request = "launch"): void {
  writeFileSync(
    join(root, name, "logs", `coachman-leg-2-intent-${n}.json`),
    `{"attempt":${n},"request":"${request}","role":"coachman","prompt":"${join(root, name, "prompt.txt")}","thread_id":"T-1","stream_off":0}`,
  );
}

function liveowner(name: string): void {
  // The lock's owner is this test run, alive throughout it.
  let start: string;
  try {
    const stat = readFileSync(`/proc/${process.pid}/stat`, "utf8");
    start = pyWords(stat.slice(stat.lastIndexOf(")") + 1))[19]!;
  } catch {
    const r = run("ps", ["-o", "lstart=", "-p", String(process.pid)], {});
    start = pyWords(r.out).slice(0, 5).join(" ");
  }
  writeFileSync(join(root, name, ".leg-2-active"), `${process.pid} ${start}\n`);
}

function deadowner(name: string): void {
  writeFileSync(join(root, name, ".leg-2-active"), "999999999 0\n");
}

function age(name: string): void {
  const t = Date.now() / 1000 - 3600;
  const dir = join(root, name);
  walkFiles(dir, (f) => {
    try {
      utimesSync(f, t, t);
    } catch {
      /* ignore */
    }
  });
}

function nextOf(name: string): string {
  const origLog = console.log;
  let out = "";
  console.log = (s: string) => {
    out += `${s}\n`;
  };
  try {
    status(root);
  } finally {
    console.log = origLog;
  }
  for (const line of out.split("\n")) {
    const parts = pyWords(line);
    if (parts[0] === name) return parts[parts.length - 1] ?? "";
  }
  return "";
}

function rowOf(name: string): string {
  const origLog = console.log;
  let out = "";
  console.log = (s: string) => {
    out += `${s}\n`;
  };
  try {
    status(root);
  } finally {
    console.log = origLog;
  }
  for (const line of out.split("\n")) {
    if (pyWords(line)[0] === name) return line;
  }
  return "";
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "runs-status-"));
  root = join(tmp, "root");
  mkRun("rule", "review", 2, ".escalation-ready");
  mkRun("gate", "shipping", 3, ".card-ready");
  mkRun("spec", "planning", 1, ".spec-review-ready", ".leg-1-exited");
  mkRun("specpause", "planning", 1, ".spec-review-ready", ".leg-1-exited");
  // The pause's realistic shape: started, thread id, no hand-off, so incomplete.
  writeFileSync(
    join(root, "specpause", "logs", "coachman-leg-1-attempts.jsonl"),
    '{"attempt":1,"outcome":"incomplete","role":"coachman","thread_id":"T-PLAN"}\n',
  );
  writeFileSync(join(root, "specpause", "logs", "coachman-leg-1-phase-1"), "started\n");
  mkRun("dispatch", "review", 2, ".leg-2-done", ".leg-2-exited");
  record("dispatch", "finished", "coachman");
  mkRun("refused", "review", 2, ".leg-2-exited");
  record("refused", "refused", "coachman");
  mkRun("prethread", "review", 2, ".leg-2-exited");
  record("prethread", "pre-thread", "coachman");
  mkRun("wall", "review", 2, ".leg-2-exited");
  record("wall", "walled", "coachman");
  mkRun("fallbackwall", "review", 2, ".leg-2-exited");
  record("fallbackwall", "walled", "coachman_fallback");
  mkRun("remount", "review", 2, ".leg-2-exited");
  record("remount", "incomplete", "coachman");
  mkRun("read", "review", 2, ".checkpoint-review-ready");
  mkRun("inspect", "review", 2);
  age("inspect");
  mkRun("wait", "review", 2);
  mkRun("user", "review", 2, ".waiting-on-user", ".leg-2-exited");
  mkRun("closed", "done", 3, ".leg-3-done", ".leg-3-exited");
  mkRun("earlier", "review", 2, ".leg-1-done");
  mkRun("usergate", "shipping", 3, ".card-ready", ".waiting-on-user");
  mkRun("userspec", "planning", 1, ".spec-review-ready", ".waiting-on-user");
  mkRun("userclosed", "done", 3, ".waiting-on-user");
  mkRun("refusedanswer", "review", 2, ".waiting-on-user", ".leg-2-exited");
  record("refusedanswer", "refused", "coachman");
  mkRun("wallanswer", "review", 2, ".waiting-on-user", ".leg-2-exited");
  record("wallanswer", "walled", "coachman_fallback");
  mkRun("incompleteanswer", "review", 2, ".waiting-on-user", ".leg-2-exited");
  record("incompleteanswer", "incomplete", "coachman");
  mkRun("finishedclosed", "done", 2, ".leg-2-done", ".leg-2-exited");
  record("finishedclosed", "finished", "coachman");
  mkRun("active", "review", 2);
  record("active", "refused", "coachman");
  liveowner("active");
  mkRun("staleactive", "review", 2, ".leg-2-exited");
  record("staleactive", "incomplete", "coachman");
  mkdirSync(join(root, "staleactive", ".leg-2-active"));
  mkRun("ownergone", "review", 2);
  record("ownergone", "refused", "coachman");
  deadowner("ownergone");
  mkRun("noowner", "review", 2);
  record("noowner", "refused", "coachman");
  mkdirSync(join(root, "noowner", ".leg-2-active"));
  mkRun("gap", "review", 2, ".leg-2-exited");
  recordn("gap", 1, "finished", "coachman");
  phase("gap", 1);
  phase("gap", 2);
  mkRun("gapactive", "review", 2);
  recordn("gapactive", 1, "incomplete", "coachman");
  phase("gapactive", 1);
  phase("gapactive", 2);
  liveowner("gapactive");
  mkRun("gapintent", "review", 2, ".leg-2-exited");
  recordn("gapintent", 1, "finished", "coachman");
  intent("gapintent", 2);
  mkRun("intentresume", "review", 2, ".leg-2-exited");
  recordn("intentresume", 1, "incomplete", "coachman");
  intent("intentresume", 2, "resume");
  mkRun("intentcovered", "review", 2, ".leg-2-exited");
  recordn("intentcovered", 1, "incomplete", "coachman");
  intent("intentcovered", 1);
  mkRun("corruptlast", "review", 2, ".leg-2-exited");
  record("corruptlast", "incomplete", "coachman");
  writeFileSync(
    join(root, "corruptlast", "logs", "coachman-leg-2-attempts.jsonl"),
    readFileSync(join(root, "corruptlast", "logs", "coachman-leg-2-attempts.jsonl"), "utf8") +
      "NOT JSON\n",
  );
  mkRun("corruptmid", "review", 2, ".leg-2-exited");
  writeFileSync(join(root, "corruptmid", "logs", "coachman-leg-2-attempts.jsonl"), "NOT JSON\n");
  recordn("corruptmid", 2, "incomplete", "coachman");
  mkRun("unknown", "review", 2, ".leg-2-exited");
  record("unknown", "mystery", "coachman");
  mkRun("wallunknown", "review", 2, ".leg-2-exited");
  record("wallunknown", "walled", "unknown");
  mkRun("stall", "review", 2);
  age("stall");
  writeFileSync(join(root, "stall", ".leg-1-done"), "");
  mkOdd("boolleg", "true", ".leg-True-done", ".leg-True-exited");
  mkOdd("nullleg", "null", ".leg-None-done", ".leg-None-exited");
  mkCurrent("one-final", "checkpoint-1", 1, ".card-ready", ".leg-1-done", ".leg-1-exited");
  mkCurrent("two-final", "review", 2, ".card-ready", ".leg-2-done", ".leg-2-exited");
  mkCurrent("two-dispatch", "review", 2, ".leg-2-done", ".leg-2-exited");
  mkRun("legacy-gate", "shipping", 3, ".card-ready");
  mkRun("legacy-dispatch", "review", 2, ".leg-2-done", ".leg-2-exited");
  mkRun("legacy-last", "shipped", 3, ".leg-3-done", ".leg-3-exited");
  const detection = (time: string, via = "") =>
    `${JSON.stringify({ rule: "email", file: "notes.txt", line: 1, commit: "a".repeat(40), time, ...(via ? { via } : {}) })}\n`;
  mkRun("tell-waiting", "review", 2, ".waiting-on-user");
  writeFileSync(join(root, "tell-waiting", "detections.jsonl"), detection("first"));
  mkRun("tell-done", "done", 2);
  writeFileSync(join(root, "tell-done", "detections.jsonl"), detection("first", "marker"));
  mkRun("told-waiting", "review", 2, ".waiting-on-user");
  writeFileSync(join(root, "told-waiting", "detections.jsonl"), detection("first", "marker"));
  writeFileSync(join(root, "told-waiting", ".detections-told"), detection("first", "marker"));
  mkRun("repeat-told", "review", 2, ".waiting-on-user");
  writeFileSync(
    join(root, "repeat-told", "detections.jsonl"),
    detection("first") + detection("second"),
  );
  writeFileSync(join(root, "repeat-told", ".detections-told"), detection("first"));
  mkdirSync(join(root, "postmaster"), { recursive: true });
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("positive controls", () => {
  test("untold findings take priority over waiting and done markers, including marked findings", () => {
    expect(nextOf("tell-waiting")).toBe("TELL");
    expect(nextOf("tell-done")).toBe("TELL");
  });

  test("a told finding waits for the user and a repeated log entry does not tell again", () => {
    expect(nextOf("told-waiting")).toBe("USER");
    expect(nextOf("repeat-told")).toBe("USER");
  });

  test("an escalation waiting is RULE", () => {
    expect(nextOf("rule")).toBe("RULE");
  }, 10000);

  test("a complete ship card is GATE", () => {
    expect(nextOf("gate")).toBe("GATE");
  }, 10000);

  test("a spec review package waiting is SPEC", () => {
    expect(nextOf("spec")).toBe("SPEC");
  }, 10000);

  test("a spec package with its pause record is SPEC", () => {
    expect(nextOf("specpause")).toBe("SPEC");
  }, 10000);

  test("the current leg done is DISPATCH", () => {
    expect(nextOf("dispatch")).toBe("DISPATCH");
  }, 10000);

  test("a refused launch is ASK", () => {
    expect(nextOf("refused")).toBe("ASK");
  }, 10000);

  test("an exit before a thread id is ASK", () => {
    expect(nextOf("prethread")).toBe("ASK");
  }, 10000);

  test("a wall on the primary coachman is TAKEOVER", () => {
    expect(nextOf("wall")).toBe("TAKEOVER");
  }, 10000);

  test("a wall on the fallback coachman is ASK", () => {
    expect(nextOf("fallbackwall")).toBe("ASK");
  }, 10000);

  test("an incomplete thread is RESUME", () => {
    expect(nextOf("remount")).toBe("RESUME");
  }, 10000);

  test("a checkpoint card waiting is READ", () => {
    expect(nextOf("read")).toBe("READ");
  }, 10000);

  test("nothing changed for an hour is INSPECT", () => {
    expect(nextOf("inspect")).toBe("INSPECT");
  }, 10000);

  test("a leg at work is WAIT", () => {
    expect(nextOf("wait")).toBe("WAIT");
  }, 10000);

  test("a run waiting on the user is USER, whatever else it holds", () => {
    expect(nextOf("user")).toBe("USER");
  }, 10000);

  test("a closed run is -", () => {
    expect(nextOf("closed")).toBe("-");
  }, 10000);

  test("a refusal stays USER while the user question is open", () => {
    expect(nextOf("refusedanswer")).toBe("USER");
  }, 10000);

  test("a fallback wall stays USER while the user question is open", () => {
    expect(nextOf("wallanswer")).toBe("USER");
  }, 10000);

  test("an incomplete thread waits on the user ahead of its outcome", () => {
    expect(nextOf("incompleteanswer")).toBe("USER");
  }, 10000);

  test("a closed run ignores a stale finished attempt", () => {
    expect(nextOf("finishedclosed")).toBe("-");
  }, 10000);

  test("a live attempt waits even when its previous outcome asked the user", () => {
    expect(nextOf("active")).toBe("WAIT");
  }, 10000);

  test("an active lock that survives its exited marker reads its outcome", () => {
    expect(nextOf("staleactive")).toBe("RESUME");
  }, 10000);

  test("a lock whose owner is gone reads its outcome, not a wedged WAIT", () => {
    expect(nextOf("ownergone")).toBe("ASK");
  }, 10000);

  test("a lock with no owner file is stale too", () => {
    expect(nextOf("noowner")).toBe("ASK");
  }, 10000);

  test("a phase file beyond the last record is inspected, not the stale outcome", () => {
    expect(nextOf("gap")).toBe("INSPECT");
  }, 10000);

  test("an intent file beyond the last record is inspected too", () => {
    expect(nextOf("gapintent")).toBe("INSPECT");
  }, 10000);

  test("an intent-only resume is inspected, not a stale resume", () => {
    expect(nextOf("intentresume")).toBe("INSPECT");
  }, 10000);

  test("an intent at the last record hides nothing", () => {
    expect(nextOf("intentcovered")).toBe("RESUME");
  }, 10000);

  test("a corrupt middle line does not hide the last good record", () => {
    expect(nextOf("corruptmid")).toBe("RESUME");
  }, 10000);
});

describe("negative controls", () => {
  test("an earlier leg's done marker dispatches nothing", () => {
    expect(nextOf("earlier")).toBe("WAIT");
  }, 10000);

  test("a ship card put to the user waits on the user, not the gate", () => {
    expect(nextOf("usergate")).toBe("USER");
  }, 10000);

  test("a spec package put to the user waits on the user, not the package", () => {
    expect(nextOf("userspec")).toBe("USER");
  }, 10000);

  test("a closed run stays closed with a stale marker", () => {
    expect(nextOf("userclosed")).toBe("-");
  }, 10000);

  test("an unknown outcome is inspected instead of resumed", () => {
    expect(nextOf("unknown")).toBe("INSPECT");
  }, 10000);

  test("a wall without a known role is inspected", () => {
    expect(nextOf("wallunknown")).toBe("INSPECT");
  }, 10000);

  test("a running attempt's missing record is normal while it holds the lock", () => {
    expect(nextOf("gapactive")).toBe("WAIT");
  }, 10000);

  test("a last line that is not a record is inspected", () => {
    expect(nextOf("corruptlast")).toBe("INSPECT");
  }, 10000);

  test("touching a marker does not hide a stall", () => {
    expect(nextOf("stall")).toBe("INSPECT");
  }, 10000);

  test("the postmaster's own directory is not a run", () => {
    expect(nextOf("postmaster")).toBe("");
  }, 10000);
});

describe("non-string legs print in Python's spelling", () => {
  test("a boolean leg matches its Python-spelled markers", () => {
    expect(nextOf("boolleg")).toBe("DISPATCH");
  }, 10000);

  test("a null leg matches its Python-spelled markers", () => {
    expect(nextOf("nullleg")).toBe("DISPATCH");
  }, 10000);

  test("a run with no markers shows a dash, not blanks", () => {
    expect(pyWords(rowOf("wait"))[3]).toBe("-");
  }, 10000);
});

describe("two-leg and legacy runs", () => {
  test("a one-leg synthesis card is GATE", () => {
    expect(nextOf("one-final")).toBe("GATE");
  }, 10000);

  test("a two-leg review card is GATE", () => {
    expect(nextOf("two-final")).toBe("GATE");
  }, 10000);

  test("a current two-leg review completion is DISPATCH", () => {
    expect(nextOf("two-dispatch")).toBe("DISPATCH");
  }, 10000);

  test("a pre-change ship card remains GATE", () => {
    expect(nextOf("legacy-gate")).toBe("GATE");
  }, 10000);

  test("a pre-change review completion still dispatches ship", () => {
    expect(nextOf("legacy-dispatch")).toBe("DISPATCH");
  }, 10000);

  test("a pre-change ship completion is DISPATCH", () => {
    expect(nextOf("legacy-last")).toBe("DISPATCH");
  }, 10000);
});
