// Oracle for #414, committed before the change: the macOS check finishes or
// fails fast, and its failures point at a defect. C1 pins the concurrent-
// starts case's mechanism (the fix changes that case, not production
// behavior, so no behavioral oracle can separate BASE from fixed). C2 runs a
// stand-in suite that reports every file and never ends through skip-check
// with a three-second stuck wait: the check fails within seconds saying the
// run did not end. C3 reads the same run's process list. C4 runs a test that
// awaits a sleep-30 child under two seconds: its failure names the child
// with pid, command and state. C5 runs a manual two-file run where each file
// carries a slow test with no limit of its own: both pass, on any filesystem
// order, since whichever file runs second still holds its slow test.
// Covered: C1a (mechanism), C2, C3, C4, C5. Not covered: C1b (ten manual
// macOS dispatches, a postmaster step after push: it needs a pushed branch).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  cleanup,
  makeStandinSuite,
  makeTimeoutFixture,
  nestedThisRun,
  raceCaseBlock,
  repoRoot,
} from "./acceptance-414.ts";
import { run } from "./lib/proc.ts";

const ROOT = repoRoot();

// A nested full suite must never nest again: the C2/C3 run sets the marker,
// and every block below registers nothing under it.
function suite(name: string, fn: () => void): void {
  describe(name, () => {
    if (!nestedThisRun()) fn();
  });
}

// A parallel worker marks its environment; a nested test run started from
// inside one must not inherit it.
const CLEAN_ENV = { BUN_TEST_WORKER_ID: undefined };

suite("C1: the concurrent-starts case holds the first start on a gate", () => {
  test("the race prompt reaches the gated stand-in", () => {
    expect(raceCaseBlock()).toContain("pair-gate");
  });

  test("the racers inherit TEST_GATE", () => {
    expect(raceCaseBlock()).toContain("TEST_GATE");
  });

  test("the eight racers start spread over seconds, not in one burst", () => {
    const block = raceCaseBlock();
    expect(block).not.toContain("Array.from({ length: 8 }");
    expect(block).toMatch(/stagger/iu);
  });

  test("the gate opens only after the other seven have been turned away", () => {
    const block = raceCaseBlock();
    expect(block).toContain("=== 7");
    expect(block).toMatch(/writeFileSync\(raceGate/u);
  });

  test("the case still asserts exactly one harness run", () => {
    expect(raceCaseBlock()).toContain("callsAfterRace - callsBeforeRace === 1");
  });
});

suite("C2/C3: a suite that never ends is stopped and names its strays", () => {
  test("skip-check fails within seconds and lists every leftover process", () => {
    const { dir, script } = makeStandinSuite();
    try {
      const started = Date.now();
      const r = run(join(ROOT, "scripts/run"), ["skip-check"], {
        cwd: ROOT,
        env: {
          ...CLEAN_ENV,
          ACCEPTANCE_414_NESTED: "1",
          POSTMASTER_SKIP_CHECK_SUITE: script,
          POSTMASTER_SKIP_CHECK_STUCK_SECONDS: "3",
        },
      });
      const elapsed = Date.now() - started;
      const output = r.out + r.err;
      // The seam is honored: the stand-in's own report lines are in the output.
      expect(output).toContain("standin-a.test.ts:");
      // C2: non-zero, saying the run did not end, within seconds of the wait.
      expect(r.code).not.toBe(0);
      expect(output).toContain("did not end");
      expect(elapsed).toBeLessThan(60_000);
      // C3: every leftover under the suite, with pid and command.
      expect(output).toMatch(/pid [0-9]+: .*sleep 60/u);
      expect(output).toMatch(/pid [0-9]+: .*sleep 300/u);
    } finally {
      cleanup(dir);
    }
    // Quiet time is seconds; the bound also covers the full-suite fallback
    // where the seam is absent, so the baseline fails on its output, not here.
  }, 900_000);
});

suite("C4: a test that runs out of time names what it was awaiting", () => {
  test("the failure lists the living child with pid, command and state", () => {
    const { dir, file } = makeTimeoutFixture();
    try {
      const r = run("bun", ["test", file], { cwd: ROOT, env: CLEAN_ENV });
      const output = r.out + r.err;
      expect(r.code).not.toBe(0);
      expect(output).toContain("timed out after 2000ms");
      expect(output).toContain("test-children:");
      expect(output).toMatch(/pid [0-9]+: .*sleep 30/u);
      expect(output).toMatch(/pid [0-9]+: (running|reaped|zombie)/u);
    } finally {
      cleanup(dir);
    }
  }, 30_000);
});

// Outside every suite block, so it runs in nested runs too: the C5 pair's
// own slow test. It must stay slow and limitless: the pin below fails loud
// if it ever gains a limit or runs short, instead of going vacuous.
test("C5 probe: six seconds with no stated limit", async () => {
  await Bun.sleep(6000);
});

suite("C5: a manual run gives every named file the check's limit", () => {
  test("both slow files pass", () => {
    // Each file carries a slow test with no limit of its own, so the
    // separation holds whichever the filesystem runs second: at the base
    // the second file's slow test fails on the bare five-second default.
    const r = run("bun", ["scripts/manual-test-files.ts"], {
      cwd: ROOT,
      env: {
        ...CLEAN_ENV,
        ACCEPTANCE_414_NESTED: "1",
        FILES: "scripts/clean-checkout.test.ts scripts/acceptance-414.test.ts",
      },
    });
    const output = r.out + r.err;
    expect(r.code).toBe(0);
    expect(output).toContain("0 fail");
    expect(output).not.toContain("timed out");
  }, 420_000);

  test("both slow tests still exceed the bare five-second default", () => {
    // Pins the probes: under an explicit five-second default both slow
    // tests fail, so a future limit or speedup fails here, loud, instead
    // of hollowing the pair above into a pass at the base.
    const r = run(
      "bun",
      [
        "test",
        "--timeout=5000",
        "scripts/clean-checkout.test.ts",
        "scripts/acceptance-414.test.ts",
      ],
      {
        cwd: ROOT,
        env: { ...CLEAN_ENV, ACCEPTANCE_414_NESTED: "1" },
      },
    );
    const output = r.out + r.err;
    expect(r.code).not.toBe(0);
    expect(output).toMatch(/outlives its bound.*timed out after 5000ms/su);
    expect(output).toMatch(/C5 probe: six seconds.*timed out after 5000ms/su);
  }, 420_000);
});
