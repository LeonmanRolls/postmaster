// Oracle for #168, committed before the change: the watcher waits for a
// fixture run and for a pull request's checks, so the postmaster does not.
// C1: a run whose wait.json names a fixture copy stays WAITING (watcher
// exit 3, naming nothing) while the copy's postmaster launch runs, and is
// named WAIT-DONE at the next look after its marker lands. Times are
// scaled down from the ticket's 60s/30s to keep the test fast; the
// controls are the same shape. C2: a run at its card whose pull request
// checks are pending is not named; pass, a fail: line, or a second
// consecutive none names it WAIT-DONE. The checks answer comes from the
// real `landing pull-request-checks` command with a stub `gh` on PATH.
// Every test spawns `scripts/run` as a subprocess and never imports the
// change. Covered: C1, C2. Not covered: C3 (contract fixture, at landing).
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  PR_URL,
  SELF,
  configFor,
  envFor,
  ghStub,
  gitRepo,
  mkRun,
  scratch,
  setMode,
  statusNext,
  waitForFile,
  watch,
} from "./acceptance-168.ts";
import { run } from "./lib/proc.ts";

describe("C1: the watcher waits for a fixture run", () => {
  test("status reads an open fixture wait as WAITING and a landed marker as WAIT-DONE", () => {
    const dir = scratch("c1-status");
    try {
      const cfg = configFor(dir);
      const root = join(dir, "runs");
      const fixture = join(dir, "fixture-copy");
      const marker = join(fixture, ".postmaster", "runs", "postmaster", ".exited");
      mkdirSync(join(root, "postmaster"), { recursive: true });
      mkdirSync(join(fixture, ".postmaster", "runs", "postmaster"), { recursive: true });
      mkRun(root, "T-1", { kind: "fixture", fixture });
      expect(statusNext(root, cfg, "T-1")).toBe("WAITING");
      writeFileSync(marker, "");
      expect(statusNext(root, cfg, "T-1")).toBe("WAIT-DONE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("watcher names nothing while the fixture postmaster runs, then names WAIT-DONE", () => {
    const dir = scratch("c1-watch");
    try {
      const cfg = configFor(dir);
      const root = join(dir, "runs");
      const fixture = join(dir, "fixture-copy");
      const marker = join(fixture, ".postmaster", "runs", "postmaster", ".exited");
      mkdirSync(join(root, "postmaster"), { recursive: true });
      mkdirSync(join(fixture, ".postmaster", "runs", "postmaster"), { recursive: true });
      mkRun(root, "T-1", { kind: "fixture", fixture });
      const launch = run(
        SELF,
        [
          "host",
          "run",
          "postmaster",
          fixture,
          "--out",
          join(dir, "pm.out"),
          "--err",
          join(dir, "pm.err"),
          "--marker",
          marker,
          "--project",
          fixture,
          "--",
          "sleep",
          "5",
        ],
        { env: envFor(cfg) },
      );
      expect(launch.code).toBe(0);
      const early = watch(root, cfg, "2");
      expect(early.code).toBe(3);
      expect(`${early.out}${early.err}`).not.toContain("needs T-1");
      expect(waitForFile(marker, 15)).toBe(true);
      const late = watch(root, cfg, "5");
      expect(late.code).toBe(0);
      expect(`${late.out}${late.err}`).toContain("needs T-1 WAIT-DONE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("C2: the watcher waits for a pull request's checks", () => {
  test("pending names nothing, then pass names WAIT-DONE", () => {
    const dir = scratch("c2-pass");
    try {
      const cfg = configFor(dir);
      const root = join(dir, "runs");
      mkdirSync(join(root, "postmaster"), { recursive: true });
      const repo = join(dir, "repo");
      const head = gitRepo(repo);
      const stub = ghStub(dir, head);
      const path = `${stub.bin}:${process.env.PATH ?? ""}`;
      mkRun(root, "T-1", { kind: "pull-request", repo, pr: PR_URL, cardHead: head });
      expect(statusNext(root, cfg, "T-1")).toBe("WAITING");
      const early = watch(root, cfg, "2", { PATH: path });
      expect(early.code).toBe(3);
      expect(`${early.out}${early.err}`).not.toContain("needs T-1");
      setMode(stub.mode, "pass");
      const late = watch(root, cfg, "5", { PATH: path });
      expect(late.code).toBe(0);
      expect(`${late.out}${late.err}`).toContain("needs T-1 WAIT-DONE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a fail answer names WAIT-DONE", () => {
    const dir = scratch("c2-fail");
    try {
      const cfg = configFor(dir);
      const root = join(dir, "runs");
      mkdirSync(join(root, "postmaster"), { recursive: true });
      const repo = join(dir, "repo");
      const head = gitRepo(repo);
      const stub = ghStub(dir, head);
      setMode(stub.mode, "fail");
      mkRun(root, "T-1", { kind: "pull-request", repo, pr: PR_URL, cardHead: head });
      const r = watch(root, cfg, "5", { PATH: `${stub.bin}:${process.env.PATH ?? ""}` });
      expect(r.code).toBe(0);
      expect(`${r.out}${r.err}`).toContain("needs T-1 WAIT-DONE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a second consecutive none names WAIT-DONE, and a seeded count needs one", () => {
    const dir = scratch("c2-none");
    try {
      const cfg = configFor(dir);
      const repo = join(dir, "repo");
      const head = gitRepo(repo);
      const stub = ghStub(dir, head);
      setMode(stub.mode, "none");
      const path = `${stub.bin}:${process.env.PATH ?? ""}`;
      const root = join(dir, "runs");
      mkdirSync(join(root, "postmaster"), { recursive: true });
      mkRun(root, "T-1", { kind: "pull-request", repo, pr: PR_URL, cardHead: head });
      // Timeout 0 is exactly one look: a longer timeout would poll again
      // inside the same invocation and reach the second none there.
      const first = watch(root, cfg, "0", { PATH: path });
      expect(first.code).toBe(3);
      expect(`${first.out}${first.err}`).not.toContain("needs T-1");
      // The second none counts a minute after the first (review r2): age
      // the recorded first-none time instead of waiting the minute out.
      const watcherFile = join(root, "T-1", "watcher.json");
      const saved = JSON.parse(readFileSync(watcherFile, "utf8")) as {
        wait_none_at: Record<string, number>;
      };
      for (const k of Object.keys(saved.wait_none_at))
        saved.wait_none_at[k] = Math.floor(Date.now() / 1000) - 70;
      writeFileSync(watcherFile, `${JSON.stringify(saved)}\n`);
      const second = watch(root, cfg, "5", { PATH: path });
      expect(second.code).toBe(0);
      expect(`${second.out}${second.err}`).toContain("needs T-1 WAIT-DONE");
      const root2 = join(dir, "runs2");
      mkdirSync(join(root2, "postmaster"), { recursive: true });
      mkRun(root2, "T-2", {
        kind: "pull-request",
        repo,
        pr: PR_URL,
        cardHead: head,
        noneCount: 1,
      });
      // The seeded ask is dated from wait.json: age it past the minute.
      const aged = new Date(Date.now() - 70_000);
      utimesSync(join(root2, "T-2", "wait.json"), aged, aged);
      const seeded = watch(root2, cfg, "5", { PATH: path });
      expect(seeded.code).toBe(0);
      expect(`${seeded.out}${seeded.err}`).toContain("needs T-2 WAIT-DONE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an unreadable checks answer names WAIT-FAULT, never WAIT-DONE", () => {
    const dir = scratch("c2-fault");
    try {
      const cfg = configFor(dir);
      const root = join(dir, "runs");
      mkdirSync(join(root, "postmaster"), { recursive: true });
      const repo = join(dir, "repo");
      const head = gitRepo(repo);
      const stub = ghStub(dir, head);
      setMode(stub.mode, "error");
      mkRun(root, "T-1", { kind: "pull-request", repo, pr: PR_URL, cardHead: head });
      const r = watch(root, cfg, "5", { PATH: `${stub.bin}:${process.env.PATH ?? ""}` });
      expect(r.code).toBe(0);
      expect(`${r.out}${r.err}`).toContain("needs T-1 WAIT-FAULT");
      expect(`${r.out}${r.err}`).not.toContain("needs T-1 WAIT-DONE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("waits: fault and control cases", () => {
  test("an unreadable wait wakes as WAIT-FAULT, never as over", () => {
    const dir = scratch("fault");
    try {
      const cfg = configFor(dir);
      const root = join(dir, "runs");
      mkdirSync(join(root, "postmaster"), { recursive: true });
      mkRun(root, "T-1", "{not json\n");
      expect(statusNext(root, cfg, "T-1")).toBe("WAIT-FAULT");
      const r = watch(root, cfg, "5");
      expect(r.code).toBe(0);
      expect(`${r.out}${r.err}`).toContain("needs T-1 WAIT-FAULT");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a card with no wait still reads GATE (positive control)", () => {
    const dir = scratch("control");
    try {
      const cfg = configFor(dir);
      const root = join(dir, "runs");
      mkdirSync(join(root, "postmaster"), { recursive: true });
      mkRun(root, "T-1", null);
      expect(statusNext(root, cfg, "T-1")).toBe("GATE");
      const r = watch(root, cfg, "5");
      expect(r.code).toBe(0);
      expect(`${r.out}${r.err}`).toContain("needs T-1 GATE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a held waiting run is left alone entirely", () => {
    const dir = scratch("held");
    try {
      const cfg = configFor(dir);
      const root = join(dir, "runs");
      mkdirSync(join(root, "postmaster"), { recursive: true });
      writeFileSync(join(root, "postmaster", "held"), "T-1\n");
      const repo = join(dir, "repo");
      const head = gitRepo(repo);
      const stub = ghStub(dir, head);
      setMode(stub.mode, "pass");
      mkRun(root, "T-1", { kind: "pull-request", repo, pr: PR_URL, cardHead: head });
      const r = watch(root, cfg, "2", { PATH: `${stub.bin}:${process.env.PATH ?? ""}` });
      expect(r.code).toBe(3);
      expect(`${r.out}${r.err}`).not.toContain("needs T-1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
