// Tests for the hold command beside it: exact exits, usage refusals, the
// lock, and the session file. The ticket's own checks live in the oracle;
// these pin the command's edges. Every case spawns `scripts/run`.
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SELF, configFor, envFor, scratch } from "./acceptance-168.ts";
import { run } from "./lib/proc.ts";

function rootFor(dir: string): { cfg: string; root: string } {
  const cfg = configFor(dir);
  const root = join(dir, "runs");
  mkdirSync(join(root, "postmaster"), { recursive: true });
  return { cfg, root };
}

function hold(args: string[], cfg: string) {
  return run(SELF, ["runs-hold", ...args], { env: envFor(cfg) });
}

describe("usage", () => {
  const cases: string[][] = [
    [],
    ["freeze"],
    ["hold"],
    ["hold", "R"],
    ["hold", "R", "T-1"],
    ["hold", "R", "T-1", "--helper"],
    ["hold", "R", "T-1", "--helper", "h", "extra"],
    ["release"],
    ["release", "R"],
    ["release", "R", "T-1", "extra"],
    ["release-stale"],
    ["release-stale", "R", "extra"],
  ];
  for (const args of cases) {
    test(`usage refuses: ${args.join(" ") || "(none)"}`, () => {
      const dir = scratch("usage");
      try {
        const { cfg } = rootFor(dir);
        const r = hold(args, cfg);
        expect(r.code).toBe(1);
        expect(`${r.out}${r.err}`).toContain("run runs-hold hold");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  test("a ticket with whitespace and a wild helper name are refused", () => {
    const dir = scratch("names");
    try {
      const { cfg, root } = rootFor(dir);
      expect(hold(["hold", root, "T 1", "--helper", "h"], cfg).code).toBe(1);
      expect(hold(["hold", root, "T-1", "--helper", "a/b"], cfg).code).toBe(1);
      expect(hold(["hold", root, "T-1", "--helper", ""], cfg).code).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a missing run root is refused", () => {
    const dir = scratch("root");
    try {
      const { cfg } = rootFor(dir);
      const r = hold(["hold", join(dir, "nowhere"), "T-1", "--helper", "h"], cfg);
      expect(r.code).toBe(1);
      expect(`${r.out}${r.err}`).toContain("no such run root");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("release refusals", () => {
  test("releasing an unheld run and a hand-held run refuse distinctly", () => {
    const dir = scratch("release");
    try {
      const { cfg, root } = rootFor(dir);
      const bare = hold(["release", root, "T-1"], cfg);
      expect(bare.code).toBe(2);
      expect(`${bare.out}${bare.err}`).toContain("is not held");
      writeFileSync(join(root, "postmaster", "held"), "T-1\n");
      const hand = hold(["release", root, "T-1"], cfg);
      expect(hand.code).toBe(2);
      expect(`${hand.out}${hand.err}`).toContain("held by hand");
      expect(readFileSync(join(root, "postmaster", "held"), "utf8")).toBe("T-1\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the session file", () => {
  test("a blank session file is replaced with a fresh token", () => {
    const dir = scratch("session");
    try {
      const { cfg, root } = rootFor(dir);
      writeFileSync(join(root, "postmaster", "session"), "\n");
      const r = hold(["hold", root, "T-1", "--helper", "h"], cfg);
      expect(r.code).toBe(0);
      const token = readFileSync(join(root, "postmaster", "session"), "utf8").trim();
      expect(token).toMatch(/^[0-9a-f]{32}$/u);
      expect(r.out.trim()).toBe(`T-1 helper=h session=${token}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the lock", () => {
  test("a lock no pid holds is taken past", () => {
    const dir = scratch("stale-lock");
    try {
      const { cfg, root } = rootFor(dir);
      writeFileSync(join(root, "postmaster", ".held.lock"), "not-a-pid\n");
      expect(hold(["hold", root, "T-1", "--helper", "h"], cfg).code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a lock a live process holds refuses", () => {
    const dir = scratch("live-lock");
    const sleeper = Bun.spawn(["sleep", "30"], { stdout: "ignore", stderr: "ignore" });
    try {
      const { cfg, root } = rootFor(dir);
      writeFileSync(join(root, "postmaster", ".held.lock"), `${sleeper.pid}\n`);
      const r = hold(["hold", root, "T-1", "--helper", "h"], cfg);
      expect(r.code).toBe(1);
      expect(`${r.out}${r.err}`).toContain(`live pid ${sleeper.pid}`);
    } finally {
      sleeper.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("two holds racing on one run leave exactly one", async () => {
    const dir = scratch("race");
    try {
      const { cfg, root } = rootFor(dir);
      const env = { ...process.env, ...envFor(cfg) } as Record<string, string>;
      const a = Bun.spawn([SELF, "runs-hold", "hold", root, "T-1", "--helper", "a"], {
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const b = Bun.spawn([SELF, "runs-hold", "hold", root, "T-1", "--helper", "b"], {
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [ca, cb] = await Promise.all([a.exited, b.exited]);
      expect([ca, cb].sort()).toEqual([0, 2]);
      const lines = readFileSync(join(root, "postmaster", "held"), "utf8")
        .split("\n")
        .filter((l) => l !== "");
      expect(lines).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
