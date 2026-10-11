// Oracle for #344, committed before the change: the verifier session is interactive,
// asks only what the project does not show, takes secrets by file name, and runs
// headless with an unasked list where no host answers. Pins only what runs without
// a model: the two prompt renderings, the pstack overlap comparison in both
// directions, the usage exits, and the spawn-or-headless routing behind a stub
// tmux and a stub harness. A live user answering in a tab stays hand-verified and
// out of this file: the session ran once during implementation, and its transcript
// and proof sit in the run record. Every case drives git or scripts/run as a
// subprocess.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { firstSentence, PSTACK_SKILL, sharedRuns } from "./acceptance-323.ts";
import type { Sandbox } from "./acceptance-344.ts";
import {
  makeEnv,
  makeSandbox,
  promptOrThrow,
  RUN,
  summaryLine,
  writeStubMuse,
  writeStubSession,
  writeStubTmux,
} from "./acceptance-344.ts";
import { run, type RunResult } from "./lib/proc.ts";

/** Assert a driven command's exit code, quoting its stderr when it differs. */
function expectCode(r: RunResult, code: number): void {
  if (r.code !== code) {
    throw new Error(`exited ${r.code}, expected ${code}: ${(r.err || r.out).trim()}`);
  }
}

/** The #323 shape both renderings keep: repo, surface prose, sections, handover, credit. */
function expectPromptShape(out: string, repo: string, prose: string): void {
  expect(out).toContain(repo);
  expect(out).toMatch(new RegExp(prose, "iu"));
  for (const stem of ["launch", "health check", "drive", "evidence", "cleanup", "helper"]) {
    expect(out).toMatch(new RegExp(stem, "iu"));
  }
  expect(out).toMatch(/three to five/iu);
  expect(out).toMatch(/hand-?over/iu);
  expect(out).toContain("pstack");
  expect(out).toContain("23e4138");
}

describe("prompt: the interactive instructions", () => {
  test("asks only what cannot be observed, and takes secrets by file name", () => {
    const sandbox = makeSandbox();
    try {
      const out = promptOrThrow(sandbox.repo, "cli");
      expect(out).toMatch(/ask the user only what you cannot observe/iu);
      expect(out).toMatch(/name of the file that holds it/iu);
      expect(out).toMatch(/never the value/iu);
      expect(out).toMatch(/never appears in this conversation/iu);
      expect(out).not.toMatch(/cannot ask anyone anything/iu);
      expectPromptShape(out, sandbox.repo, "command line");
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("all three surfaces render", () => {
    const sandbox = makeSandbox();
    try {
      const prose: Record<string, string> = {
        cli: "command line",
        web: "web pages",
        library: "library interface",
      };
      for (const [surface, words] of Object.entries(prose)) {
        const out = promptOrThrow(sandbox.repo, surface);
        expectPromptShape(out, sandbox.repo, words);
      }
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });
});

describe("prompt --headless: the no-host instructions", () => {
  test("cannot ask, and hands over an unasked list with what each needed", () => {
    const sandbox = makeSandbox();
    try {
      const out = promptOrThrow(sandbox.repo, "cli", ["--headless"]);
      expect(out).toMatch(/cannot ask anyone anything/iu);
      expect(out).toMatch(/unasked questions/iu);
      expect(out).toMatch(/each question you could not ask/iu);
      expect(out).toMatch(/what it would have needed/iu);
      expect(out).toMatch(/never invent a value/iu);
      expect(out).toMatch(/unasked list/iu);
      expectPromptShape(out, sandbox.repo, "command line");
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });
});

describe("C5 still: neither rendering copies pstack's skill", () => {
  test("no shared run of eight words in either rendering", () => {
    const sandbox = makeSandbox();
    try {
      const skill = readFileSync(PSTACK_SKILL, "utf8");
      for (const args of [[], ["--headless"]]) {
        const out = promptOrThrow(sandbox.repo, "cli", args);
        const shared = sharedRuns(out, skill, 8);
        if (shared.length > 0) {
          throw new Error(`shared runs:\n${shared.slice(0, 3).join("\n")}`);
        }
        expect(shared).toEqual([]);
      }
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("one copied sentence fails the same comparison", () => {
    const sandbox = makeSandbox();
    try {
      const out = promptOrThrow(sandbox.repo, "cli");
      const skill = readFileSync(PSTACK_SKILL, "utf8");
      const control = `${out}\n${firstSentence(skill, 8)}\n`;
      expect(sharedRuns(control, skill, 8).length).toBeGreaterThan(0);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });
});

describe("usage", () => {
  test("prompt with an unknown flag exits 2 and prints usage", () => {
    const sandbox = makeSandbox();
    try {
      const r = run(RUN, ["verifier", "prompt", sandbox.repo, "cli", "--fresh"]);
      expectCode(r, 2);
      expect(r.err).toContain("usage: run verifier");
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("prompt --headless with an unknown surface exits 2", () => {
    const sandbox = makeSandbox();
    try {
      const r = run(RUN, ["verifier", "prompt", sandbox.repo, "telegraph", "--headless"]);
      expectCode(r, 2);
      expect(r.err).toContain("usage: run verifier");
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });
});

describe("stub confinement", () => {
  test("the session stub refuses a cwd outside its sandbox", () => {
    const sandbox = makeSandbox();
    const outside = mkdtempSync(join(tmpdir(), "acceptance-344-outside-"));
    try {
      writeStubSession(sandbox.bin);
      const r = run(join(sandbox.bin, "claude"), [], {
        cwd: outside,
        env: { ORACLE_ROOT: sandbox.dir },
      });
      expectCode(r, 1);
      expect(r.err).toContain("refuses");
      expect(existsSync(join(outside, "HANDOVER.md"))).toBe(false);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("the tmux stub refuses session work outside its sandbox", () => {
    const sandbox = makeSandbox();
    const outside = mkdtempSync(join(tmpdir(), "acceptance-344-outside-"));
    try {
      const log = join(sandbox.dir, "tmux.log");
      writeStubTmux(sandbox.bin, log, join(sandbox.dir, "tmux.state"));
      const r = run(join(sandbox.bin, "tmux"), ["new-session", "-n", "x", "-c", outside], {
        env: { ORACLE_ROOT: sandbox.dir, ORACLE_SESSION_WORK: "1" },
      });
      expectCode(r, 1);
      expect(r.err).toContain("refuses");
      expect(existsSync(join(outside, "HANDOVER.md"))).toBe(false);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("make with no host: the headless fallback", () => {
  test("runs headless to a handover with the headless prompt", () => {
    const sandbox = makeSandbox();
    try {
      writeStubSession(sandbox.bin);
      const env = makeEnv(sandbox, { POSTMASTER_HOST: "none" });
      const r = run(
        RUN,
        ["verifier", "make", sandbox.repo, "cli", "--run", sandbox.dispatch, "--timeout", "120"],
        { env },
      );
      expectCode(r, 0);
      expect(r.out).toContain("branch verify-cli");
      expect(r.out).toContain("role coachman");
      const handover = summaryLine(r.out, "handover");
      expect(handover).not.toBe("");
      expect(existsSync(handover)).toBe(true);
      const promptFile = summaryLine(r.out, "prompt");
      expect(promptFile).not.toBe("");
      const prompt = readFileSync(promptFile, "utf8");
      expect(prompt).toMatch(/cannot ask anyone anything/iu);
      expect(prompt).toMatch(/unasked questions/iu);
      const actions = readFileSync(join(sandbox.dispatch, "actions.jsonl"), "utf8");
      expect(actions).toContain("verifier-cli");
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("runs headless with no global config either, since the form is only for spawn", () => {
    const sandbox = makeSandbox();
    try {
      writeStubSession(sandbox.bin);
      const env = makeEnv(sandbox, {
        POSTMASTER_HOST: "none",
        POSTMASTER_CONFIG: join(sandbox.dir, "missing.toml"),
      });
      const r = run(
        RUN,
        ["verifier", "make", sandbox.repo, "cli", "--run", sandbox.dispatch, "--timeout", "120"],
        { env },
      );
      expectCode(r, 0);
      expect(r.out).toContain("branch verify-cli");
      const promptFile = summaryLine(r.out, "prompt");
      expect(promptFile).not.toBe("");
      expect(readFileSync(promptFile, "utf8")).toMatch(/unasked questions/iu);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });
});

describe("make with a host: the interactive open", () => {
  function coachmanConfig(sandbox: Sandbox): string {
    const path = join(sandbox.dir, "config.toml");
    writeFileSync(path, '[team]\ncoachman = { harness = "muse", model = "probe-model" }\n');
    return path;
  }

  test("spawns the coachman interactive form in postmaster-<repo> and collects the handover", () => {
    const sandbox = makeSandbox();
    try {
      const log = join(sandbox.dir, "tmux.log");
      writeStubTmux(sandbox.bin, log, join(sandbox.dir, "tmux.state"));
      writeStubMuse(sandbox.bin);
      const env = makeEnv(sandbox, {
        POSTMASTER_HOST: "tmux",
        POSTMASTER_CONFIG: coachmanConfig(sandbox),
        ORACLE_SESSION_WORK: "1",
      });
      const r = run(
        RUN,
        ["verifier", "make", sandbox.repo, "cli", "--run", sandbox.dispatch, "--timeout", "120"],
        { env },
      );
      expectCode(r, 0);
      expect(r.out).toContain("branch verify-cli");
      expect(r.out).toContain("handle verifier-app-verify-cli");
      const calls = readFileSync(log, "utf8");
      expect(calls).toContain("new-session");
      expect(calls).toContain("postmaster-app");
      expect(calls).toContain("muse");
      expect(calls).toContain("probe-model");
      expect(calls).toContain("load-buffer");
      const wt = summaryLine(r.out, "worktree");
      expect(wt).not.toBe("");
      expect(calls).toContain(`cd -- '${wt}'`);
      const promptFile = summaryLine(r.out, "prompt");
      expect(promptFile).not.toBe("");
      const prompt = readFileSync(promptFile, "utf8");
      expect(prompt).toMatch(/ask the user only what you cannot observe/iu);
      const streams = readdirSync(join(sandbox.dispatch, "logs")).filter((f) =>
        f.endsWith("-events.jsonl"),
      );
      expect(streams).toEqual([]);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("a session still running at the limit is left open, with no headless launch", () => {
    const sandbox = makeSandbox();
    try {
      const log = join(sandbox.dir, "tmux.log");
      writeStubTmux(sandbox.bin, log, join(sandbox.dir, "tmux.state"));
      writeStubMuse(sandbox.bin);
      const env = makeEnv(sandbox, {
        POSTMASTER_HOST: "tmux",
        POSTMASTER_CONFIG: coachmanConfig(sandbox),
      });
      const r = run(
        RUN,
        ["verifier", "make", sandbox.repo, "cli", "--run", sandbox.dispatch, "--timeout", "2"],
        { env },
      );
      expectCode(r, 1);
      expect(r.err).toMatch(/left open/iu);
      expect(readFileSync(log, "utf8")).toContain("new-session");
      const actions = readFileSync(join(sandbox.dispatch, "actions.jsonl"), "utf8");
      expect(actions).toContain("failed: the verifier session is still running after 2 seconds");
      const streams = readdirSync(join(sandbox.dispatch, "logs")).filter((f) =>
        f.endsWith("-events.jsonl"),
      );
      expect(streams).toEqual([]);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("two checkouts sharing a directory name spawn under different handles", () => {
    const a = makeSandbox();
    const b = makeSandbox();
    try {
      expect(basename(a.repo)).toBe("app");
      expect(basename(b.repo)).toBe("app");
      const log = join(a.dir, "tmux.log");
      writeStubTmux(a.bin, log, join(a.dir, "tmux.state"));
      writeStubMuse(a.bin);
      writeStubMuse(b.bin);
      const config = coachmanConfig(a);
      const envA = makeEnv(a, {
        POSTMASTER_HOST: "tmux",
        POSTMASTER_CONFIG: config,
        ORACLE_SESSION_WORK: "1",
      });
      const envB = makeEnv(b, {
        POSTMASTER_HOST: "tmux",
        POSTMASTER_CONFIG: config,
        ORACLE_SESSION_WORK: "1",
      });
      envB.PATH = `${a.bin}:${process.env.PATH ?? ""}`;
      const ra = run(
        RUN,
        ["verifier", "make", a.repo, "cli", "--run", a.dispatch, "--timeout", "120"],
        { env: envA },
      );
      expectCode(ra, 0);
      const rb = run(
        RUN,
        ["verifier", "make", b.repo, "cli", "--run", b.dispatch, "--timeout", "120"],
        { env: envB },
      );
      expectCode(rb, 0);
      const handleA = summaryLine(ra.out, "handle");
      const handleB = summaryLine(rb.out, "handle");
      expect(handleA).not.toBe("");
      expect(handleB).not.toBe("");
      expect(handleB).not.toBe(handleA);
    } finally {
      rmSync(a.dir, { recursive: true, force: true });
      rmSync(b.dir, { recursive: true, force: true });
    }
  });

  test("no interactive form with a host stops the make instead of going headless", () => {
    const sandbox = makeSandbox();
    try {
      const log = join(sandbox.dir, "tmux.log");
      writeStubTmux(sandbox.bin, log, join(sandbox.dir, "tmux.state"));
      const env = makeEnv(sandbox, {
        POSTMASTER_HOST: "tmux",
        POSTMASTER_CONFIG: join(sandbox.dir, "missing.toml"),
      });
      const r = run(
        RUN,
        ["verifier", "make", sandbox.repo, "cli", "--run", sandbox.dispatch, "--timeout", "30"],
        { env },
      );
      expectCode(r, 1);
      expect(r.err).toMatch(/no interactive command/iu);
      expect(existsSync(log)).toBe(false);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("a spawn that fails stops the make and cleans up", () => {
    const sandbox = makeSandbox();
    try {
      const log = join(sandbox.dir, "tmux.log");
      writeStubTmux(sandbox.bin, log, join(sandbox.dir, "tmux.state"));
      writeStubMuse(sandbox.bin);
      const env = makeEnv(sandbox, {
        POSTMASTER_HOST: "tmux",
        POSTMASTER_CONFIG: coachmanConfig(sandbox),
        ORACLE_TMUX_FAIL_NEW: "1",
      });
      const r = run(
        RUN,
        ["verifier", "make", sandbox.repo, "cli", "--run", sandbox.dispatch, "--timeout", "30"],
        { env },
      );
      expectCode(r, 1);
      expect(r.err).toMatch(/could not start/iu);
      const branches = run("git", ["-C", sandbox.repo, "branch", "--list", "verify-cli"]);
      expect(branches.out.trim()).toBe("");
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });
});
