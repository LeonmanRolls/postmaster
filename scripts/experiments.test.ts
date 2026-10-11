// Unit tests for the experiments command's core: dates, the replay, the
// due rule and its order, the list shape, the page rows, and the three
// transitions with their refusals; then the record's edges through the
// command itself: the symlink guard, the ledger order and the lock.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireLock,
  applyConclude,
  applyMove,
  applyStart,
  formatList,
  isDue,
  lockStep,
  nextId,
  orderRows,
  parseDate,
  pushDocs,
  releaseLock,
  replay,
  type Experiment,
  type ExperimentEvent,
} from "./experiments.ts";

function running(id: string, look: string, started = "2026-10-01"): Experiment {
  return {
    id,
    question: `${id} asks`,
    levels: ["old", "new"],
    started,
    measure: "minutes",
    look,
    state: "running",
    result: null,
    evidence: null,
    ended: null,
  };
}

function concluded(id: string, look: string, ended: string): Experiment {
  return { ...running(id, look), state: "concluded", result: "won", evidence: null, ended };
}

describe("parseDate", () => {
  test("a real calendar date passes, the rest do not", () => {
    expect(parseDate("2026-10-09")).toBe("2026-10-09");
    expect(parseDate("2026-02-29")).toBe(null);
    expect(parseDate("2024-02-29")).toBe("2024-02-29");
    expect(parseDate("2026-13-01")).toBe(null);
    expect(parseDate("2026-10-32")).toBe(null);
    expect(parseDate("not-a-date")).toBe(null);
    expect(parseDate("2026-10-9")).toBe(null);
    expect(parseDate("")).toBe(null);
  });
});

describe("nextId", () => {
  test("the first id is e1, then one past the highest", () => {
    expect(nextId([])).toBe("e1");
    expect(nextId([running("e1", "2026-10-09")])).toBe("e2");
    expect(nextId([running("e2", "2026-10-09"), running("e9", "2026-10-09")])).toBe("e10");
  });
});

describe("replay", () => {
  test("start, move and conclude fold into one concluded row", () => {
    const events: ExperimentEvent[] = [
      {
        ev: "start",
        id: "e1",
        question: "q",
        levels: ["a", "b"],
        measure: "m",
        started: "2026-10-01",
        look: "2026-10-09",
      },
      { ev: "move", id: "e1", look: "2026-10-10" },
      {
        ev: "conclude",
        id: "e1",
        result: "r",
        evidence: "https://example.invalid/1",
        ended: "2026-10-10",
      },
    ];
    const { rows, error } = replay(events);
    expect(error).toBe(null);
    expect(rows).toEqual([
      {
        id: "e1",
        question: "q",
        levels: ["a", "b"],
        started: "2026-10-01",
        measure: "m",
        look: "2026-10-10",
        state: "concluded",
        result: "r",
        evidence: "https://example.invalid/1",
        ended: "2026-10-10",
      },
    ]);
  });

  test("a move or conclude before the start, or twice over, is corruption", () => {
    const start: ExperimentEvent = {
      ev: "start",
      id: "e1",
      question: "q",
      levels: ["a", "b"],
      measure: "m",
      started: "2026-10-01",
      look: "2026-10-09",
    };
    const conclude: ExperimentEvent = {
      ev: "conclude",
      id: "e1",
      result: "r",
      evidence: null,
      ended: "2026-10-10",
    };
    expect(replay([start, start]).error).toContain("corrupt");
    expect(replay([{ ev: "move", id: "e1", look: "2026-10-10" }]).error).toContain("corrupt");
    expect(replay([conclude]).error).toContain("corrupt");
    expect(replay([start, conclude, conclude]).error).toContain("corrupt");
    expect(replay([start, conclude, { ev: "move", id: "e1", look: "2026-10-11" }]).error).toContain(
      "corrupt",
    );
  });
});

describe("isDue and orderRows", () => {
  test("running on or past its date is due; concluded never is", () => {
    expect(isDue(running("e1", "2026-10-09"), "2026-10-10")).toBe(true);
    expect(isDue(running("e1", "2026-10-10"), "2026-10-10")).toBe(true);
    expect(isDue(running("e1", "2026-10-11"), "2026-10-10")).toBe(false);
    expect(isDue(concluded("e1", "2026-10-09", "2026-10-10"), "2026-10-10")).toBe(false);
  });

  test("due first, then running by date, then concluded newest first", () => {
    const rows = [
      concluded("e4", "2026-10-01", "2026-10-02"),
      running("e1", "2026-10-12"),
      running("e2", "2026-10-09"),
      concluded("e5", "2026-10-01", "2026-10-05"),
      running("e3", "2026-10-10"),
    ];
    expect(orderRows(rows, "2026-10-10").map((r) => r.id)).toEqual(["e2", "e3", "e1", "e5", "e4"]);
  });
});

describe("formatList", () => {
  test("an empty record lists nothing to show", () => {
    expect(formatList([], "2026-10-10")).toBe("no experiments\n");
  });

  test("a block names the id, state, due mark, dates and fields", () => {
    const out = formatList(
      [running("e1", "2026-10-12"), concluded("e2", "2026-10-01", "2026-10-05")],
      "2026-10-10",
    );
    const blocks = out.trimEnd().split("\n\n");
    expect(blocks.length).toBe(2);
    expect(blocks[0]).toContain("e1 running look=2026-10-12 started=2026-10-01");
    expect(blocks[0]).not.toContain("due");
    expect(blocks[0]).toContain("question: e1 asks");
    expect(blocks[0]).toContain("levels: old | new");
    expect(blocks[0]).toContain("measure: minutes");
    expect(blocks[1]).toContain("e2 concluded look=2026-10-01 started=2026-10-01 ended=2026-10-05");
    expect(blocks[1]).toContain("result: won");
  });
});

describe("pushDocs", () => {
  test("every row ships keyed by id, empty record ships empty", () => {
    expect(pushDocs([])).toBe("{}\n");
    const docs = JSON.parse(pushDocs([running("e2", "2026-10-12")])) as Record<
      string,
      Record<string, unknown>
    >;
    expect(Object.keys(docs)).toEqual(["e2"]);
    expect(docs["e2"]).toEqual({
      question: "e2 asks",
      levels: ["old", "new"],
      started: "2026-10-01",
      measure: "minutes",
      look: "2026-10-12",
      state: "running",
      result: null,
      evidence: null,
      ended: null,
    });
  });
});

describe("applyStart", () => {
  test("it starts with the next id and today's start", () => {
    const applied = applyStart(
      [running("e1", "2026-10-09")],
      { question: "q", levels: ["a", "b", "c"], measure: "m", look: "2026-10-11" },
      "2026-10-10",
    );
    expect(applied.error).toBe(null);
    if (applied.event === null) throw new Error("refused a sound start");
    expect(applied.event.ev).toBe("start");
    if (applied.event.ev !== "start") throw new Error("wrong event");
    expect(applied.event.id).toBe("e2");
    expect(applied.event.started).toBe("2026-10-10");
  });

  test("no question, one level, no measure or a bad date is refused", () => {
    const sound = { question: "q", levels: ["a", "b"], measure: "m", look: "2026-10-11" };
    expect(applyStart([], { ...sound, question: "  " }, "2026-10-10").error).toContain("question");
    expect(applyStart([], { ...sound, levels: ["a"] }, "2026-10-10").error).toContain("levels");
    expect(applyStart([], { ...sound, levels: ["a", " "] }, "2026-10-10").error).toContain(
      "levels",
    );
    expect(applyStart([], { ...sound, measure: "" }, "2026-10-10").error).toContain("measure");
    expect(applyStart([], { ...sound, look: "someday" }, "2026-10-10").error).toContain("bad date");
  });
});

describe("applyMove and applyConclude", () => {
  test("they move and conclude, once each", () => {
    const rows = [running("e1", "2026-10-09")];
    const moved = applyMove(rows, "e1", "2026-10-11");
    expect(moved.error).toBe(null);
    expect(moved.event).toEqual({ ev: "move", id: "e1", look: "2026-10-11" });
    const over = applyConclude(rows, "e1", "r", null, "2026-10-10");
    expect(over.error).toBe(null);
    expect(over.event).toEqual({
      ev: "conclude",
      id: "e1",
      result: "r",
      evidence: null,
      ended: "2026-10-10",
    });
  });

  test("an unknown id, a concluded one, no result or a bad date is refused", () => {
    const rows = [running("e1", "2026-10-09"), concluded("e2", "2026-10-01", "2026-10-05")];
    expect(applyMove(rows, "e9", "2026-10-11").error).toContain("no such experiment");
    expect(applyMove(rows, "e2", "2026-10-11").error).toContain("already concluded");
    expect(applyMove(rows, "e1", "someday").error).toContain("bad date");
    expect(applyConclude(rows, "e9", "r", null, "2026-10-10").error).toContain(
      "no such experiment",
    );
    expect(applyConclude(rows, "e2", "r", null, "2026-10-10").error).toContain("already concluded");
    expect(applyConclude(rows, "e1", " ", null, "2026-10-10").error).toContain("result");
  });
});

const RUN = join(import.meta.dir, "run");

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "experiments-test-"));
  const init = spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  return dir;
}

function runExperiments(repo: string, args: string[]) {
  return spawnSync(RUN, ["experiments", args[0] ?? "", "--project", repo, ...args.slice(1)], {
    encoding: "utf8",
  });
}

const START = [
  "start",
  "--question",
  "q",
  "--level",
  "a",
  "--level",
  "b",
  "--measure",
  "m",
  "--look",
  "2026-10-20",
];

function recordLines(repo: string): string[] {
  return readFileSync(join(repo, ".postmaster", "experiments.jsonl"), "utf8")
    .trim()
    .split("\n");
}

describe("record symlink guard", () => {
  test("a dangling symlink at the record is refused with nothing written", () => {
    const repo = tempRepo();
    const escaped = `${repo}-escaped.jsonl`;
    try {
      const pm = join(repo, ".postmaster");
      mkdirSync(pm, { recursive: true });
      symlinkSync(escaped, join(pm, "experiments.jsonl"));
      const r = runExperiments(repo, START);
      expect(r.status).not.toBe(0);
      expect(existsSync(escaped)).toBe(false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(escaped, { force: true });
    }
  });

  test("a symlink to a live file is refused and the file is untouched", () => {
    const repo = tempRepo();
    try {
      const pm = join(repo, ".postmaster");
      mkdirSync(pm, { recursive: true });
      const live = join(repo, "live.jsonl");
      writeFileSync(live, "held\n");
      symlinkSync(live, join(pm, "experiments.jsonl"));
      const r = runExperiments(repo, START);
      expect(r.status).not.toBe(0);
      expect(readFileSync(live, "utf8")).toBe("held\n");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("a symlinked .postmaster folder is refused on every form", () => {
    const repo = tempRepo();
    const outside = `${repo}-outside`;
    try {
      mkdirSync(outside, { recursive: true });
      symlinkSync(outside, join(repo, ".postmaster"));
      expect(runExperiments(repo, ["list"]).status).not.toBe(0);
      expect(runExperiments(repo, ["push-docs"]).status).not.toBe(0);
      expect(runExperiments(repo, START).status).not.toBe(0);
      expect(existsSync(join(outside, "experiments.jsonl"))).toBe(false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("a symlinked runs folder is refused with nothing written outside", () => {
    const repo = tempRepo();
    const outside = `${repo}-outside`;
    try {
      mkdirSync(join(repo, ".postmaster"), { recursive: true });
      mkdirSync(outside, { recursive: true });
      symlinkSync(outside, join(repo, ".postmaster", "runs"));
      expect(runExperiments(repo, START).status).not.toBe(0);
      expect(existsSync(join(outside, "ledger.jsonl"))).toBe(false);
      expect(existsSync(join(repo, ".postmaster", "experiments.jsonl"))).toBe(false);
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("ledger write order", () => {
  test("a logging failure leaves the record untouched", () => {
    const repo = tempRepo();
    try {
      expect(runExperiments(repo, START).status).toBe(0);
      expect(recordLines(repo).length).toBe(1);
      const ledger = join(repo, ".postmaster", "runs", "ledger.jsonl");
      rmSync(ledger);
      mkdirSync(ledger);
      expect(runExperiments(repo, START).status).not.toBe(0);
      expect(recordLines(repo).length).toBe(1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("lockStep", () => {
  test("stale steals, fresh waits, a long wait refuses", () => {
    expect(lockStep(11000, 100, 10000, 30000)).toBe("steal");
    expect(lockStep(100, 100, 10000, 30000)).toBe("wait");
    expect(lockStep(100, 31000, 10000, 30000)).toBe("refuse");
    expect(lockStep(-1, 100, 10000, 30000)).toBe("wait");
    expect(lockStep(-1, 31000, 10000, 30000)).toBe("refuse");
    expect(lockStep(10000, 100, 10000, 30000)).toBe("wait");
  });
});

describe("record lock", () => {
  test("acquire and release round-trips; release is idempotent", () => {
    const root = mkdtempSync(join(tmpdir(), "experiments-lock-"));
    try {
      acquireLock(root);
      expect(existsSync(join(root, ".postmaster", "experiments.lock"))).toBe(true);
      releaseLock();
      expect(existsSync(join(root, ".postmaster", "experiments.lock"))).toBe(false);
      releaseLock();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a stale lock is stolen", () => {
    const root = mkdtempSync(join(tmpdir(), "experiments-lock-"));
    try {
      const dir = join(root, ".postmaster", "experiments.lock");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "owner"), "dead\n");
      const old = new Date(Date.now() - 60000);
      utimesSync(dir, old, old);
      acquireLock(root, { staleMs: 1000, timeoutMs: 5000, pollMs: 5 });
      releaseLock();
      expect(existsSync(dir)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("release skips a lock another holder took", () => {
    const root = mkdtempSync(join(tmpdir(), "experiments-lock-"));
    try {
      acquireLock(root);
      const dir = join(root, ".postmaster", "experiments.lock");
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "owner"), "someone else\n");
      releaseLock();
      expect(readFileSync(join(dir, "owner"), "utf8")).toBe("someone else\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the command takes a stale lock", () => {
    const repo = tempRepo();
    try {
      const dir = join(repo, ".postmaster", "experiments.lock");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "owner"), "dead\n");
      const old = new Date(Date.now() - 60000);
      utimesSync(dir, old, old);
      const r = runExperiments(repo, START);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe("e1");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("concurrent starts", () => {
  test("parallel starts serialize: every id lands once", async () => {
    const repo = tempRepo();
    try {
      const N = 12;
      const procs = [];
      for (let i = 0; i < N; i++) {
        procs.push(
          Bun.spawn(
            [
              RUN,
              "experiments",
              "start",
              "--project",
              repo,
              "--question",
              `race ${i}`,
              "--level",
              "a",
              "--level",
              "b",
              "--measure",
              "m",
              "--look",
              "2026-10-20",
            ],
            { stdout: "ignore", stderr: "ignore" },
          ),
        );
      }
      const codes = await Promise.all(procs.map((p) => p.exited));
      expect(codes.every((c) => c === 0)).toBe(true);
      const lines = recordLines(repo);
      expect(lines.length).toBe(N);
      const ids = lines.map((l) => (JSON.parse(l) as { id: string }).id);
      expect(new Set(ids).size).toBe(N);
      expect(runExperiments(repo, ["list"]).status).toBe(0);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
