// Tests beside scripts/review-decide.ts, moved from its --self-test on #109: 33 controls.
// Two controls shared one run directory with the control before them; each test below builds
// its own run so it passes alone as well as in file order.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";

const SELF = join(import.meta.dir, "run");

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

describe("positive controls: another round runs", () => {
  test("round 1 applied a fix", () => {
    const d = newRun("r1-apply");
    logged(d, "finding", "src/a.ts:1", "gating P2 r1 bug luna reading: a defect");
    logged(d, "apply", "abc123", "src/a.ts:1");
    checkWhole(decide(d, "1"), 0, "RUN 2: round 1 applied a fix");
  });

  test("round 2 logged a P1", () => {
    const d = newRun("r2-p1");
    logged(d, "finding", "src/b.ts:2", "gating P1 r2 bug luna reading: a serious defect");
    checkWhole(decide(d, "2"), 0, "RUN 3: round 2 logged a verified P1 or P2 finding");
  });

  test("round 2 logged a P2", () => {
    const d = newRun("r2-p2");
    logged(d, "finding", "src/c.ts:3", "gating P2 r2 security sol reading: a security gap");
    checkWhole(decide(d, "2"), 0, "RUN 3: round 2 logged a verified P1 or P2 finding");
  });
});

describe("positive controls: the cap is reached", () => {
  test("round 3 logged a P1", () => {
    const d = newRun("r3-p1");
    logged(d, "finding", "src/d.ts:4", "gating P1 r3 bug luna reading: still serious");
    checkWhole(
      decide(d, "3"),
      0,
      "CAP 3: round 3 logged a verified P1 or P2 finding; escalate with residue",
    );
  });

  test("round 3 logged a P2", () => {
    const d = newRun("r3-p2");
    logged(d, "finding", "src/e.ts:5", "gating P2 r3 security sol reading: still a gap");
    checkWhole(
      decide(d, "3"),
      0,
      "CAP 3: round 3 logged a verified P1 or P2 finding; escalate with residue",
    );
  });
});

describe("negative controls: no another round", () => {
  test("round 1 applied no fix", () => {
    const d = newRun("r1-noapply");
    logged(d, "finding", "src/f.ts:6", "style P3 r1 style luna reading: a style note");
    checkWhole(decide(d, "1"), 0, "STOP 1: round 1 applied no fixes");
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
});

describe("negative controls: the cap is not reached", () => {
  test("round 3 logged no P1 or P2", () => {
    const d = newRun("r3-p3");
    logged(d, "finding", "src/h.ts:7", "gating P3 r3 bug luna reading: only minor defects");
    checkWhole(decide(d, "3"), 0, "STOP 3: round 3 logged no P1 or P2 finding");
  });

  test("round 2 with a P1 is not the cap", () => {
    const d = newRun("r2-continues");
    logged(d, "finding", "src/i.ts:9", "gating P1 r2 bug luna reading: continues, not the cap");
    checkWhole(decide(d, "2"), 0, "RUN 3: round 2 logged a verified P1 or P2 finding");
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
      "RUN 3: round 2 logged a verified P1 or P2 finding",
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

  test("a style P1 in round 3 stops, not the cap", () => {
    const d = newRun("style-p1-cap");
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

describe("controls for the cap bound", () => {
  test("a round past the cap is refused", () => {
    checkHas(decide(newRun("past"), "4"), 1, "cap of 3");
  });

  test("round 0 is refused", () => {
    checkHas(decide(newRun("past-zero"), "0"), 1, "cap of 3");
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
