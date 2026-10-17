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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, type RunResult } from "./lib/proc.ts";

const SELF = join(import.meta.dir, "run");
const PR_URL = "https://example.invalid/pr/1";

function scratch(label: string): string {
  return mkdtempSync(join(tmpdir(), `acceptance-168-${label}-`));
}

function configFor(dir: string): string {
  const p = join(dir, "config.toml");
  writeFileSync(p, "[postmaster]\npoll_seconds = 1\n");
  return p;
}

function envFor(cfg: string, extra: Record<string, string> = {}): Record<string, string> {
  return { POSTMASTER_CONFIG: cfg, POSTMASTER_HOST: "none", ...extra };
}

function watch(
  root: string,
  cfg: string,
  timeout: string,
  extra: Record<string, string> = {},
): RunResult {
  return run(SELF, ["runs-watch", root, "--timeout", timeout], {
    env: envFor(cfg, extra),
    timeout: 60_000,
  });
}

function statusNext(root: string, cfg: string, name: string): string {
  const r = run(SELF, ["runs-status", root], { env: envFor(cfg) });
  for (const line of r.out.split("\n")) {
    const f = line.trim().split(/\s+/u);
    if (f[0] === name) return f[f.length - 1] ?? "";
  }
  return "";
}

function mkRun(root: string, name: string, wait: unknown | string): void {
  const d = join(root, name);
  mkdirSync(join(d, "logs"), { recursive: true });
  writeFileSync(join(d, "manifest.json"), '{"stage": "shipping", "leg": 1}\n');
  writeFileSync(join(d, ".card-ready"), "");
  if (typeof wait === "string") writeFileSync(join(d, "wait.json"), wait);
  else if (wait !== null) writeFileSync(join(d, "wait.json"), `${JSON.stringify(wait)}\n`);
}

function gitRepo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const g = (args: string[]): RunResult =>
    run("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args]);
  if (run("git", ["init", "-q", "-b", "main", dir]).code !== 0)
    throw new Error("cannot init PR repo");
  writeFileSync(join(dir, "app.txt"), "app\n");
  if (g(["add", "."]).code !== 0 || g(["commit", "-qm", "base"]).code !== 0)
    throw new Error("cannot commit PR repo");
  const head = run("git", ["-C", dir, "rev-parse", "HEAD"]);
  if (head.code !== 0) throw new Error("cannot read PR head");
  return head.out.trim();
}

function ghStub(dir: string, head: string): { bin: string; mode: string } {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "head"), `${head}\n`);
  const mode = join(bin, "mode");
  writeFileSync(mode, "pending\n");
  const script = [
    "#!/bin/sh",
    'dir=$(dirname "$0")',
    'mode=$(cat "$dir/mode")',
    'if [ "$1" = "pr" ] && [ "$2" = "view" ]; then',
    '  printf \'{"headRefOid":"%s"}\\n\' "$(cat "$dir/head")"',
    "  exit 0",
    "fi",
    'if [ "$1" = "pr" ] && [ "$2" = "checks" ]; then',
    '  case "$mode" in',
    '    pending) printf \'[{"name":"gate","state":"PENDING","bucket":"pending","link":"https://example.invalid/check"}]\\n\'; exit 8 ;;',
    '    pass) printf \'[{"name":"gate","state":"SUCCESS","bucket":"pass","link":"https://example.invalid/check"}]\\n\'; exit 0 ;;',
    '    fail) printf \'[{"name":"gate","state":"FAILURE","bucket":"fail","link":"https://example.invalid/check"}]\\n\'; exit 1 ;;',
    "    none) printf 'no checks reported on the main branch\\n' >&2; exit 1 ;;",
    "    *) printf 'gh: unknown error\\n' >&2; exit 1 ;;",
    "  esac",
    "fi",
    "exit 1",
    "",
  ].join("\n");
  writeFileSync(join(bin, "gh"), script);
  chmodSync(join(bin, "gh"), 0o755);
  return { bin, mode };
}

function setMode(modeFile: string, mode: string): void {
  writeFileSync(modeFile, `${mode}\n`);
}

function waitForFile(path: string, seconds: number): boolean {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    if (existsSync(path)) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  return existsSync(path);
}

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
