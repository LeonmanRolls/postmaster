// Tests beside scripts/review-decide.ts, moved from its --self-test on #109; #316 rewrote
// the cap controls for the rise rule: 59 controls. Each test builds its own run so it
// passes alone as well as in file order.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";
import { harvestRound, launchRound, type StepChild, type StepDeps } from "./review-round.ts";

const SELF = join(import.meta.dir, "run");
const COACHMAN = join(import.meta.dir, "../skills/postmaster/coachman.md");
const POSTMASTER = join(import.meta.dir, "../skills/postmaster/postmaster.md");
const CAP_GREP =
  "three-round cap|cap of 3|round cap|toward the cap|past the cap|at the cap|or .CAP. decision|nothing past 3";

let tmp = "";

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "postmaster-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const newRun = (name: string): string => {
  const d = join(tmp, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "actions.jsonl"), "");
  return d;
};

const logged = (d: string, action: string, target: string, detail: string): void => {
  writeFileSync(
    join(d, "actions.jsonl"),
    '{"ts":"2026-09-27T00:00:00Z","project":"p","run":"r","actor":"coachman",' +
      `"action":"${action}","target":"${target}","detail":"${detail}"}\n`,
    { flag: "a" },
  );
};

// n gating P2 findings in round r, each line its own target.
const loggedCount = (d: string, r: number, n: number, prefix: string): void => {
  for (let i = 1; i <= n; i++) {
    logged(
      d,
      "finding",
      `${prefix}-r${r}-${i}.ts:1`,
      `gating P2 r${r} bug luna reading: defect ${i}`,
    );
  }
};

const loggedCounts = (d: string, counts: number[], prefix: string): void => {
  counts.forEach((n, i) => loggedCount(d, i + 1, n, prefix));
};

const launched = (d: string, lane: string, lens: string, round: number): void => {
  logged(d, "review-launch", lane, `${lens} round ${round}`);
};

const degraded = (d: string, lane: string, lens: string, round: number, form: string): void => {
  const detail =
    form === "r" ? `${lens} r${round}: timeout` : `${lens} round ${round}: harvest failed`;
  logged(d, "degrade", lane, detail);
};

const decide = (d: string, round: string): { code: number; out: string } => {
  const r = run(SELF, ["review-decide", d, round]);
  return { code: r.code, out: r.out + r.err };
};

const checkWhole = (r: { code: number; out: string }, exit: number, whole: string): void => {
  expect(r.code).toBe(exit);
  expect(r.out.replace(/\n+$/u, "")).toBe(whole);
};

const checkHas = (r: { code: number; out: string }, exit: number, text: string): void => {
  expect(r.code).toBe(exit);
  expect(r.out.includes(text)).toBe(true);
};

describe("round 1 runs round 2 when it applied a fix or lacked a working reviewer", () => {
  test("round 1 applied a fix", () => {
    const d = newRun("r1-apply");
    logged(d, "finding", "src/a.ts:1", "gating P2 r1 bug luna reading: a defect");
    logged(d, "apply", "abc123", "src/a.ts:1");
    checkWhole(decide(d, "1"), 0, "RUN 2: round 1 applied a fix");
  });

  test("round 1 applied no fix", () => {
    const d = newRun("r1-noapply");
    logged(d, "finding", "src/f.ts:6", "style P3 r1 style luna reading: a style note");
    checkWhole(decide(d, "1"), 0, "STOP 1: round 1 applied no fixes");
  });

  test("round 1 with no working reviewer runs round 2", () => {
    const d = newRun("r1-lacking");
    logged(d, "finding", "src/f.ts:6", "style P3 r1 style luna reading: a style note");
    launched(d, "luna", "security", 1);
    degraded(d, "luna", "security", 1, "r");
    checkWhole(decide(d, "1"), 0, "RUN 2: round 1 had no working reviewer for security");
  });

  test("rows the scripts wrote fire the rule for a lens whose every lane degraded", () => {
    const d = newRun("r1-scriptrows");
    mkdirSync(join(d, "logs"), { recursive: true });
    writeFileSync(join(d, "manifest.json"), `${JSON.stringify({ base: "BASESHA" })}\n`);
    writeFileSync(join(d, "brief.md"), "waybill\n");
    const recorded: string[][] = [];
    const answer = (name: string, args: string[]): StepChild => {
      if (name === "turnpikes")
        return { code: 0, out: "1 synthesis\n2 review style bug security\n", err: "" };
      if (name === "reviewers" && args[0] === "lanes") return { code: 0, out: "luna\n", err: "" };
      if (name === "review-findings" && args[0] === "harvest")
        return { code: 1, out: "", err: "no stream\n" };
      return { code: 0, out: "", err: "" };
    };
    const deps: StepDeps = {
      tool: (name, args) => {
        if (name === "log-action") recorded.push(args);
        return answer(name, args);
      },
      git: (args) =>
        args.includes("rev-parse") ? { code: 0, out: "SNAP\n", err: "" } : answer("git", args),
    };
    const launched = launchRound(
      { dispatch: d, round: "1", repo: join(tmp, "repo"), synthesis: join(tmp, "syn") },
      deps,
    );
    expect(launched.code).toBe(0);
    harvestRound({ dispatch: d, round: "1", repo: join(tmp, "repo") }, deps);
    for (const args of recorded) {
      if (args[2] === "review-launch" || args[2] === "degrade") {
        logged(d, args[2]!, args[3]!, args[4]!);
      }
    }
    logged(d, "finding", "src/f.ts:6", "style P3 r1 style luna reading: a style note");
    checkWhole(decide(d, "1"), 0, "RUN 2: round 1 had no working reviewer for bug");
  });

  test("round 1 reviewed at full strength and applied no fix still stops", () => {
    const d = newRun("r1-reviewed");
    logged(d, "finding", "src/f.ts:6", "style P3 r1 style luna reading: a style note");
    launched(d, "luna", "security", 1);
    checkWhole(decide(d, "1"), 0, "STOP 1: round 1 applied no fixes");
  });

  test("round 1 with only style degraded still stops", () => {
    const d = newRun("r1-style-degraded");
    logged(d, "finding", "src/f.ts:6", "style P3 r1 style luna reading: a style note");
    launched(d, "luna", "style", 1);
    degraded(d, "luna", "style", 1, "r");
    checkWhole(decide(d, "1"), 0, "STOP 1: round 1 applied no fixes");
  });
});

describe("going on: no more than the round before", () => {
  test("fewer goes on", () => {
    const d = newRun("fewer");
    loggedCounts(d, [6, 5], "fewer");
    checkWhole(decide(d, "2"), 0, "RUN 3: round 2 logged no more P1 or P2 findings than round 1");
  });

  test("as many goes on", () => {
    const d = newRun("level");
    loggedCounts(d, [2, 2], "level");
    checkWhole(decide(d, "2"), 0, "RUN 3: round 2 logged no more P1 or P2 findings than round 1");
  });

  test("a P1 beside a P1 goes on", () => {
    const d = newRun("p1-level");
    logged(d, "finding", "src/i.ts:9", "gating P1 r1 bug luna reading: serious");
    logged(d, "finding", "src/i.ts:10", "gating P1 r2 bug luna reading: still one");
    checkWhole(decide(d, "2"), 0, "RUN 3: round 2 logged no more P1 or P2 findings than round 1");
  });

  test("fewer late in the loop goes on", () => {
    const d = newRun("late-fewer");
    loggedCounts(d, [12, 4, 3, 2, 4, 1, 5], "latef");
    checkWhole(decide(d, "3"), 0, "RUN 4: round 3 logged no more P1 or P2 findings than round 2");
    checkWhole(decide(d, "6"), 0, "RUN 7: round 6 logged no more P1 or P2 findings than round 5");
  });

  test("level late in the loop goes on", () => {
    const d = newRun("late-level");
    loggedCounts(d, [11, 7, 4, 3, 3, 2], "latel");
    checkWhole(decide(d, "5"), 0, "RUN 6: round 5 logged no more P1 or P2 findings than round 4");
  });

  test("style and P3 findings are not counted", () => {
    const d = newRun("noise");
    loggedCount(d, 1, 2, "noise");
    logged(d, "finding", "noise-style-r1.ts:1", "style P1 r1 style luna reading: a style gap");
    loggedCount(d, 2, 1, "noise");
    logged(d, "finding", "noise-minor-r2.ts:1", "gating P3 r2 bug luna reading: minor");
    logged(d, "finding", "noise-style-r2.ts:1", "style P1 r2 style mimo reading: a style gap");
    checkWhole(decide(d, "2"), 0, "RUN 3: round 2 logged no more P1 or P2 findings than round 1");
  });
});

describe("ending: the round found no serious defect", () => {
  test("none in round 3 ends", () => {
    const d = newRun("end");
    loggedCounts(d, [5, 4, 0], "end");
    checkWhole(decide(d, "3"), 0, "STOP 3: round 3 logged no P1 or P2 finding");
  });

  test("round 2 logged no P1 or P2", () => {
    const d = newRun("r2-p3");
    logged(d, "finding", "src/g.ts:7", "gating P3 r2 bug luna reading: a minor defect");
    checkWhole(decide(d, "2"), 0, "STOP 2: round 2 logged no P1 or P2 finding");
  });

  test("round 2 logged no finding", () => {
    const d = newRun("r2-none");
    checkWhole(decide(d, "2"), 0, "STOP 2: round 2 logged no P1 or P2 finding");
  });

  test("round 3 logged no P1 or P2", () => {
    const d = newRun("r3-p3");
    logged(d, "finding", "src/h.ts:7", "gating P3 r3 bug luna reading: only minor defects");
    checkWhole(decide(d, "3"), 0, "STOP 3: round 3 logged no P1 or P2 finding");
  });
});

describe("stopping for a ruling: more than the round before", () => {
  test("round 2 logged a P1 from none stops", () => {
    const d = newRun("r2-p1");
    logged(d, "finding", "src/b.ts:2", "gating P1 r2 bug luna reading: a serious defect");
    checkWhole(
      decide(d, "2"),
      0,
      "RULING 2: round 2 logged more P1 or P2 findings than round 1; escalate with residue",
    );
  });

  test("round 2 logged a P2 from none stops", () => {
    const d = newRun("r2-p2");
    logged(d, "finding", "src/c.ts:3", "gating P2 r2 security sol reading: a security gap");
    checkWhole(
      decide(d, "2"),
      0,
      "RULING 2: round 2 logged more P1 or P2 findings than round 1; escalate with residue",
    );
  });

  test("a rise in round 2 stops", () => {
    const d = newRun("r2-rise");
    loggedCounts(d, [4, 11], "r2rise");
    checkWhole(
      decide(d, "2"),
      0,
      "RULING 2: round 2 logged more P1 or P2 findings than round 1; escalate with residue",
    );
  });

  test("round 3 logged a P1 from none stops", () => {
    const d = newRun("r3-p1");
    logged(d, "finding", "src/d.ts:4", "gating P1 r3 bug luna reading: still serious");
    checkWhole(
      decide(d, "3"),
      0,
      "RULING 3: round 3 logged more P1 or P2 findings than round 2; escalate with residue",
    );
  });

  test("round 3 logged a P2 from none stops", () => {
    const d = newRun("r3-p2");
    logged(d, "finding", "src/e.ts:5", "gating P2 r3 security sol reading: still a gap");
    checkWhole(
      decide(d, "3"),
      0,
      "RULING 3: round 3 logged more P1 or P2 findings than round 2; escalate with residue",
    );
  });

  test("a rise late in the loop stops", () => {
    const d = newRun("late-rise");
    loggedCounts(d, [12, 4, 3, 2, 4, 1, 5], "later");
    checkWhole(
      decide(d, "5"),
      0,
      "RULING 5: round 5 logged more P1 or P2 findings than round 4; escalate with residue",
    );
    checkWhole(
      decide(d, "7"),
      0,
      "RULING 7: round 7 logged more P1 or P2 findings than round 6; escalate with residue",
    );
  });

  test("rises in a row stop", () => {
    const d = newRun("rise-row");
    loggedCounts(d, [5, 1, 4, 7], "riserow");
    checkWhole(
      decide(d, "3"),
      0,
      "RULING 3: round 3 logged more P1 or P2 findings than round 2; escalate with residue",
    );
    checkWhole(
      decide(d, "4"),
      0,
      "RULING 4: round 4 logged more P1 or P2 findings than round 3; escalate with residue",
    );
  });
});

describe("a fix that does not verify closed is the checking round's finding", () => {
  const reclosed = (name: string): string => {
    const d = newRun(name);
    logged(d, "finding", "src/j.ts:10", "gating P1 r1 bug luna execution: an off-by-one");
    logged(d, "apply", "def456", "src/j.ts:10");
    logged(d, "finding", "src/j.ts:10", "gating P1 r2 bug luna reading: fix did not verify closed");
    return d;
  };

  test("a P1 logged again in the round that checked the fix keeps the loop going", () => {
    checkWhole(
      decide(reclosed("reclosed"), "2"),
      0,
      "RUN 3: round 2 logged no more P1 or P2 findings than round 1",
    );
  });

  test("round 1 still sees its apply after the fix is logged again", () => {
    checkWhole(decide(reclosed("reclosed-r1"), "1"), 0, "RUN 2: round 1 applied a fix");
  });

  test("a P3 logged again does not keep the loop going", () => {
    const d = newRun("reclosed-p3");
    logged(d, "finding", "src/k.ts:11", "gating P3 r1 bug luna reading: minor");
    logged(d, "apply", "ghi789", "src/k.ts:11");
    logged(d, "finding", "src/k.ts:11", "gating P3 r2 bug luna reading: fix did not verify closed");
    checkWhole(decide(d, "2"), 0, "STOP 2: round 2 logged no P1 or P2 finding");
  });

  test("a finding logged again counts in the round that checked it", () => {
    const d = newRun("relog");
    logged(d, "finding", "src/ticket-ready.ts:180", "gating P2 r4 bug luna reading: a defect");
    loggedCount(d, 4, 2, "relog4");
    logged(d, "finding", "src/ticket-ready.ts:180", "gating P2 r5 bug luna reading: still there");
    loggedCount(d, 5, 2, "relog5");
    checkWhole(decide(d, "5"), 0, "RUN 6: round 5 logged no more P1 or P2 findings than round 4");
  });

  test("a relogged target beside a new one stays level", () => {
    const d = newRun("relog-level");
    logged(d, "finding", "src/a.ts:1", "gating P1 r2 bug luna reading: first seen");
    logged(d, "finding", "src/b.ts:2", "gating P2 r2 bug luna reading: first seen");
    logged(d, "finding", "src/a.ts:1", "gating P1 r3 bug luna reading: fix did not hold");
    logged(d, "finding", "src/c.ts:3", "gating P2 r3 bug luna reading: newly found");
    checkWhole(decide(d, "3"), 0, "RUN 4: round 3 logged no more P1 or P2 findings than round 2");
  });
});

describe("an apply of one round does not count for another", () => {
  test("round 1 still sees its own apply", () => {
    const d = newRun("other-round");
    logged(d, "finding", "src/l.ts:12", "gating P2 r1 bug luna reading: fixed in round 1");
    logged(d, "apply", "jkl012", "src/l.ts:12");
    logged(
      d,
      "finding",
      "src/m.ts:13",
      "gating P3 r2 bug luna reading: nothing applied in round 2",
    );
    checkWhole(decide(d, "1"), 0, "RUN 2: round 1 applied a fix");
  });

  test("an apply of round 2 does not run round 2", () => {
    const d = newRun("later-apply");
    logged(d, "finding", "src/n.ts:14", "gating P2 r2 bug luna reading: fixed in round 2");
    logged(d, "apply", "mno345", "src/n.ts:14");
    checkWhole(decide(d, "1"), 0, "STOP 1: round 1 applied no fixes");
  });
});

describe("negative controls: style findings never keep the loop going", () => {
  test("a style P2 in round 2 stops the loop", () => {
    const d = newRun("style-p2");
    logged(d, "finding", "src/s1.ts:1", "style P2 r2 style luna reading: a style gap");
    checkWhole(decide(d, "2"), 0, "STOP 2: round 2 logged no P1 or P2 finding");
  });

  test("a style P1 in round 3 stops", () => {
    const d = newRun("style-p1");
    logged(d, "finding", "src/s2.ts:2", "style P1 r3 style mimo reading: a serious style gap");
    checkWhole(decide(d, "3"), 0, "STOP 3: round 3 logged no P1 or P2 finding");
  });

  test("a gating P3 beside a style P1 stops the loop", () => {
    const d = newRun("style-plus-p3");
    logged(d, "finding", "src/s3.ts:3", "gating P3 r2 bug luna reading: minor");
    logged(d, "finding", "src/s4.ts:4", "style P1 r2 style mimo reading: a serious style gap");
    checkWhole(decide(d, "2"), 0, "STOP 2: round 2 logged no P1 or P2 finding");
  });
});

describe("two rounds running without a working reviewer stop", () => {
  test("one lens degraded twice running stops, whatever the falling counts", () => {
    const d = newRun("degraded-twice");
    loggedCounts(d, [4, 3, 2, 1], "degt");
    launched(d, "luna", "security", 3);
    degraded(d, "luna", "security", 3, "r");
    launched(d, "luna", "security", 4);
    degraded(d, "luna", "security", 4, "round");
    checkWhole(
      decide(d, "4"),
      0,
      "RULING 4: no working reviewer for security in rounds 3 and 4; escalate with residue",
    );
  });

  test("two degraded rounds stop even when the round found nothing", () => {
    const d = newRun("degraded-none");
    loggedCount(d, 3, 1, "degn");
    launched(d, "luna", "security", 3);
    degraded(d, "luna", "security", 3, "r");
    launched(d, "luna", "security", 4);
    degraded(d, "luna", "security", 4, "r");
    checkWhole(
      decide(d, "4"),
      0,
      "RULING 4: no working reviewer for security in rounds 3 and 4; escalate with residue",
    );
  });

  test("two lenses degraded one round each stop", () => {
    const d = newRun("degraded-mixed");
    loggedCounts(d, [4, 3, 2, 1], "degm");
    launched(d, "luna", "bug", 3);
    degraded(d, "luna", "bug", 3, "r");
    launched(d, "opus", "security", 4);
    degraded(d, "opus", "security", 4, "r");
    checkWhole(
      decide(d, "4"),
      0,
      "RULING 4: no working reviewer for bug in round 3 and security in round 4; " +
        "escalate with residue",
    );
  });

  test("one degraded round alone goes on", () => {
    const d = newRun("degraded-once");
    loggedCounts(d, [4, 3, 2, 1], "dego");
    launched(d, "luna", "security", 3);
    degraded(d, "luna", "security", 3, "r");
    launched(d, "luna", "security", 4);
    checkWhole(decide(d, "4"), 0, "RUN 5: round 4 logged no more P1 or P2 findings than round 3");
  });

  test("a degraded round that found nothing is never the last", () => {
    const d = newRun("degraded-never-last");
    loggedCount(d, 3, 1, "degnl");
    launched(d, "luna", "security", 3);
    launched(d, "luna", "security", 4);
    degraded(d, "luna", "security", 4, "r");
    checkWhole(decide(d, "4"), 0, "RUN 5: round 4 had no working reviewer for security");
  });

  test("one lane degraded of two is still a working reviewer", () => {
    const d = newRun("degraded-partial");
    loggedCounts(d, [4, 3, 2, 1], "degp");
    for (const round of [3, 4]) {
      launched(d, "luna", "bug", round);
      launched(d, "mimo", "bug", round);
      degraded(d, "luna", "bug", round, "r");
    }
    checkWhole(decide(d, "4"), 0, "RUN 5: round 4 logged no more P1 or P2 findings than round 3");
  });

  test("style degraded twice running never stops the loop", () => {
    const d = newRun("degraded-style");
    loggedCounts(d, [4, 3, 2, 1], "degs");
    for (const round of [3, 4]) {
      launched(d, "luna", "style", round);
      degraded(d, "luna", "style", round, "r");
    }
    checkWhole(decide(d, "4"), 0, "RUN 5: round 4 logged no more P1 or P2 findings than round 3");
  });
});

describe("controls for the unbounded loop", () => {
  test("round 4 decides", () => {
    const d = newRun("unbounded-r4");
    loggedCounts(d, [4, 3, 2, 1], "ur4");
    checkWhole(decide(d, "4"), 0, "RUN 5: round 4 logged no more P1 or P2 findings than round 3");
  });

  test("round 7 decides", () => {
    const d = newRun("unbounded-r7");
    loggedCounts(d, [4, 3, 2, 2, 1, 1, 1], "ur7");
    checkWhole(decide(d, "7"), 0, "RUN 8: round 7 logged no more P1 or P2 findings than round 6");
  });

  test("round 12 decides", () => {
    const d = newRun("unbounded-r12");
    loggedCount(d, 11, 1, "ur12");
    loggedCount(d, 12, 1, "ur12");
    checkWhole(
      decide(d, "12"),
      0,
      "RUN 13: round 12 logged no more P1 or P2 findings than round 11",
    );
  });

  test("round 0 is refused", () => {
    checkHas(decide(newRun("past-zero"), "0"), 1, "round is a whole number of 1 or more: 0");
  });

  test("no cap phrase in the coachman or postmaster steps", () => {
    const r = run("grep", ["-n", "-E", CAP_GREP, COACHMAN, POSTMASTER]);
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
  });

  test("step 5 of the review loop names the decision's outcomes", () => {
    const text = readFileSync(COACHMAN, "utf8");
    const start = text.indexOf("5. **Run the review loop");
    expect(start >= 0).toBe(true);
    const end = text.indexOf("6. **One review checkpoint card", start);
    expect(end > start).toBe(true);
    const step = text.slice(start, end);
    expect(step.includes("`RUN`")).toBe(true);
    expect(step.includes("`STOP`")).toBe(true);
    expect(step.includes("`RULING`")).toBe(true);
  });
});

describe("negative controls: malformed lines fail loudly, each fault named", () => {
  test("a line that is not JSON is refused", () => {
    const d = newRun("bad-json");
    writeFileSync(join(d, "actions.jsonl"), "not json\n", { flag: "a" });
    checkHas(decide(d, "2"), 1, "line 1 is not JSON");
  });

  test("a line that is not an action object is refused", () => {
    const d = newRun("bad-scalar");
    writeFileSync(join(d, "actions.jsonl"), "42\n", { flag: "a" });
    checkHas(decide(d, "2"), 1, "line 1 is not an action object");
  });

  test("an action object with no action is refused", () => {
    const d = newRun("no-action");
    writeFileSync(
      join(d, "actions.jsonl"),
      '{"ts":"2026-09-27T00:00:00Z","target":"t","detail":"d"}\n',
      { flag: "a" },
    );
    checkHas(decide(d, "2"), 1, "line 1 has no action");
  });

  test("a finding with no class is refused", () => {
    const d = newRun("bad-class");
    logged(d, "finding", "src/t1.ts:1", "P1 r2 bug luna reading: no class first");
    checkHas(decide(d, "2"), 1, 'opens with "P1", not gating or style');
  });

  test("a finding with a bad severity is refused", () => {
    const d = newRun("bad-severity");
    logged(d, "finding", "src/t2.ts:2", "gating P9 r2 bug luna reading: no such severity");
    checkHas(decide(d, "2"), 1, "severity P9, not P1, P2 or P3");
  });

  test("a finding with no severity is refused", () => {
    const d = newRun("no-severity");
    logged(d, "finding", "src/t3.ts:3", "gating");
    checkHas(decide(d, "2"), 1, "severity none, not P1, P2 or P3");
  });

  test("a finding with a bad round is refused", () => {
    const d = newRun("bad-round");
    logged(d, "finding", "src/t4.ts:4", "gating P1 round1 bug luna reading: no such round");
    checkHas(decide(d, "2"), 1, "round round1, not rN");
  });

  test("a finding with no round is refused", () => {
    const d = newRun("no-round");
    logged(d, "finding", "src/t5.ts:5", "gating P1");
    checkHas(decide(d, "2"), 1, "round none, not rN");
  });

  test("two findings sharing one target in one round are refused", () => {
    const d = newRun("dup-target");
    logged(d, "finding", "src/t6.ts:6", "gating P1 r2 bug luna reading: serious");
    logged(d, "finding", "src/t6.ts:6", "gating P3 r2 security sol reading: minor, same target");
    checkHas(decide(d, "2"), 1, "a second finding for src/t6.ts:6 in round r2");
  });

  test("an apply naming an unknown target is refused", () => {
    const d = newRun("unknown-apply");
    logged(d, "finding", "src/t7.ts:7", "gating P2 r1 bug luna reading: a defect");
    logged(d, "apply", "abc123", "src/nowhere.ts:99");
    checkHas(decide(d, "1"), 1, "an apply naming src/nowhere.ts:99, which has no finding line");
  });

  test("an apply naming no target is refused", () => {
    const d = newRun("empty-apply");
    logged(d, "finding", "src/t8.ts:8", "gating P2 r1 bug luna reading: a defect");
    logged(d, "apply", "abc123", "");
    checkHas(decide(d, "1"), 1, "an apply naming no finding target");
  });

  test("a missing dispatch directory is refused", () => {
    const r = run(SELF, ["review-decide", join(tmp, "nowhere"), "1"]);
    expect(r.code).toBe(1);
    expect(r.err.includes("no dispatch directory")).toBe(true);
  });

  test("no arguments is refused", () => {
    const r = run(SELF, ["review-decide"]);
    expect(r.code).toBe(1);
    expect(r.err.includes("usage:")).toBe(true);
  });
});
