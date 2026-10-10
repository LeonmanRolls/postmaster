// Tests beside scripts/host.ts, moved from its --self-test on #109: 335 controls.
// host.ts's suite lives in ./host-self-test.ts's runControls (shared sequential fixture);
// this file drives it once in beforeAll, splits its printed lines on the section headers,
// and asserts each section's control count with no FAIL. Portable process controls are below.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runControls, waitFor } from "./host-self-test.ts";
import { runTabLockOwnerAlive, runWorktreePaths } from "./host.ts";
import {
  SELF,
  addWorktree,
  calls,
  freshHerdr,
  freshTmux,
  fxEnv,
  makeFixtureRepo,
  makeFx,
  readHerdr,
  saveHerdr,
  saveTmux,
  sh,
  stubConfig,
} from "./acceptance-373.ts";
import { cleanup, placementRecords, runLaunch, runTabRecords } from "./acceptance-374.ts";
import {
  copyWatcher,
  fixTabRecords,
  headlessPostmaster,
  mainRepoOf,
  seedProjectSpace,
  toolCheckout,
  writeFixtureDispatch,
} from "./acceptance-375.ts";
import { bootId, processStart, processState } from "./lib/processes.ts";
import { launchRound, type StepChild, type StepDeps } from "./review-round.ts";

const SECTIONS: Array<{ name: string; count: number }> = [
  { name: "preamble", count: 8 },
  { name: "detect", count: 5 },
  { name: "launch labels and run identity", count: 31 },
  { name: "name: from the waybill, so no title is typed into a shell", count: 5 },
  { name: "run, no host: headless launch", count: 16 },
  { name: "a run launch without a named run tab is refused", count: 1 },
  { name: "stop: owned process trees and refusal controls", count: 5 },
  { name: "stop: registry identity and process membership", count: 13 },
  { name: "run, Herdr (stub): pane placement and environment handover", count: 16 },
  { name: "stop and close, Herdr (stub)", count: 6 },
  { name: "a reviewer's scratch clone, Herdr (stub)", count: 5 },
  { name: "run, stop and close, tmux (stub)", count: 11 },
  { name: "completion cleanup controls, Herdr (stub)", count: 3 },
  { name: "finished review round cleanup, Herdr (stub)", count: 1 },
  { name: "run-wide teardown, Herdr (stub)", count: 2 },
  { name: "user split survives completion, Herdr (stub)", count: 1 },
  { name: "completion cleanup controls, tmux (stub)", count: 3 },
  { name: "finished review round cleanup, tmux (stub)", count: 1 },
  { name: "run-wide teardown, tmux (stub)", count: 1 },
  { name: "user split survives completion, tmux (stub)", count: 1 },
  { name: "review round 1 fixes, tmux (stub)", count: 10 },
  { name: "review round 1 fixes, Herdr (stub)", count: 6 },
  { name: "review round 2 fixes, tmux (stub)", count: 1 },
  { name: "review round 4 fixes, Herdr (stub)", count: 16 },
  { name: "review round 4 fixes, tmux (stub)", count: 11 },
  { name: "374 review round 1 fixes, Herdr (stub)", count: 8 },
  { name: "teardown reads only the round records", count: 16 },
  { name: "interactive sessions", count: 15 },
  { name: "clerk close", count: 6 },
  { name: "run role: the explicit host role", count: 2 },
  { name: "leg attempt controls", count: 89 },
  {
    name: "run environment identity, Claude session and lane env file: Herdr, tmux and no host",
    count: 42,
  },
];

const HEADERS = new Set(SECTIONS.map((s) => s.name).filter((n) => n !== "preamble"));

let failures = -1;
const lines: string[] = [];
const origLog = console.log;

// bun:test's types omit the hook timeout, though the runtime honors it. The limit only catches a
// hang, so it is ten times the 180 s this setup takes on a quiet machine.

beforeAll(async () => {
  console.log = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  try {
    failures = await runControls();
  } finally {
    console.log = origLog;
  }
  if (failures > 0) {
    for (const line of lines.filter(
      (line) => line.includes("FAIL") || line.includes("setup failed"),
    ))
      process.stderr.write(`${line}\n`);
  }
}, 1800000);

afterAll(() => {
  console.log = origLog;
});

const sectionLines = (name: string): string[] => {
  const out: string[] = [];
  let current = "preamble";
  for (const line of lines) {
    if (HEADERS.has(line)) {
      current = line;
      continue;
    }
    if (current === name) out.push(line);
  }
  return out;
};

const assertSection = (name: string, count: number): void => {
  expect(failures).toBeGreaterThanOrEqual(0);
  const part = sectionLines(name);
  const oks = part.filter((l) => l.startsWith("  ok   "));
  const bad = part.filter((l) => l.startsWith("  FAIL "));
  const badDetails = bad.map((line) => {
    const at = part.indexOf(line);
    return `${line}\n${part[at + 1] ?? ""}`;
  });
  expect(badDetails).toEqual([]);
  expect(`${name}: ${oks.length} ok of ${count}`).toBe(`${name}: ${count} ok of ${count}`);
};

describe("host self-test sections", () => {
  for (const { name, count } of SECTIONS) {
    test(name, () => {
      assertSection(name, count);
    });
  }
  test("self-test reports zero failures", () => {
    expect(failures).toBe(0);
  });
});

describe("stub state lock", () => {
  test("concurrent locked increments lose no update", async () => {
    const dir = mkdtempSync(join(tmpdir(), "host-lock-"));
    try {
      writeFileSync(join(dir, "counter"), "0");
      const worker = [
        `import { withStubLock } from ${JSON.stringify(join(import.meta.dir, "host-self-test.ts"))};`,
        `import { readFileSync, writeFileSync } from "node:fs";`,
        `const dir = process.argv[process.argv.length - 1];`,
        `for (let i = 0; i < 10; i++) {`,
        `  withStubLock(dir, () => {`,
        `    const n = Number(readFileSync(dir + "/counter", "utf8"));`,
        `    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);`,
        `    writeFileSync(dir + "/counter", String(n + 1));`,
        `  });`,
        `}`,
      ].join("\n");
      const procs = Array.from({ length: 8 }, () =>
        Bun.spawn([process.execPath, "-e", worker, dir], {
          stdout: "pipe",
          stderr: "pipe",
        }),
      );
      const codes = await Promise.all(procs.map((p) => p.exited));
      const errors = (await Promise.all(procs.map(async (p) => new Response(p.stderr).text())))
        .map((text) => text.trim())
        .filter(Boolean)
        .join("\n");
      expect(`${errors}codes=${codes.join(",")}`).toBe("codes=0,0,0,0,0,0,0,0");
      expect(readFileSync(join(dir, "counter"), "utf8")).toBe("80");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("waitFor, the wait the self-test uses for a stand-in", () => {
  test("it returns the moment its condition holds, not at its bound", async () => {
    const start = Date.now();
    const readyAt = start + 300;
    expect(await waitFor(() => Date.now() >= readyAt, 30)).toBe(true);
    expect(Date.now() - start).toBeGreaterThanOrEqual(300);
    expect(Date.now() - start).toBeLessThan(10000);
  });
  test("a condition that throws has not held yet, and one that never holds gives up at its bound", async () => {
    let looks = 0;
    const start = Date.now();
    const never = await waitFor(() => {
      looks++;
      throw new Error("not there yet");
    }, 0.3);
    expect(never).toBe(false);
    expect(Date.now() - start).toBeGreaterThanOrEqual(300);
    expect(looks).toBeGreaterThan(1);
  });
});

describe("waiting list lock", () => {
  test("concurrent waiting adds lose no entry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "host-waiting-"));
    try {
      const runs = join(dir, "runs");
      const qfile = join(dir, "q.md");
      writeFileSync(qfile, "why is the run waiting?\n");
      mkdirSync(join(runs, "postmaster"), { recursive: true });
      writeFileSync(
        join(runs, "postmaster", "ESCALATION.md"),
        Array.from({ length: 500 }, (_, i) => `## FILL-${i}\nfill ${i}\n`).join(""),
      );
      const wrapper = join(import.meta.dir, "run");
      const worker = [
        `import { spawnSync } from "node:child_process";`,
        `const [wrapper, runs, qfile, idx] = process.argv.slice(process.argv.length - 4);`,
        `for (let j = 0; j < 8; j++) {`,
        `  const r = spawnSync(wrapper, ["host", "leg", "waiting", "add", runs, "T" + idx + "-" + j, qfile], { encoding: "utf8" });`,
        `  if (r.status !== 0) { process.stderr.write(String(r.stderr)); process.exit(1); }`,
        `}`,
      ].join("\n");
      const procs = Array.from({ length: 16 }, (_, i) =>
        Bun.spawn([process.execPath, "-e", worker, wrapper, runs, qfile, String(i)], {
          stdout: "pipe",
          stderr: "pipe",
        }),
      );
      const codes = await Promise.all(procs.map((p) => p.exited));
      const errors = (await Promise.all(procs.map(async (p) => new Response(p.stderr).text())))
        .map((text) => text.trim())
        .filter(Boolean)
        .join("\n");
      expect(`${errors}codes=${codes.join(",")}`).toBe(`codes=${Array(16).fill(0).join(",")}`);
      const text = readFileSync(join(runs, "postmaster", "ESCALATION.md"), "utf8");
      const tickets = new Set(
        text
          .split("\n")
          .filter((l) => l.startsWith("## "))
          .map((l) => l.slice(3).trim()),
      );
      expect(tickets.size).toBe(500 + 128);
      for (let i = 0; i < 16; i++)
        for (let j = 0; j < 8; j++) expect(tickets.has(`T${i}-${j}`)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);
  test("without flock the pid fallback still adds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "host-waiting-nf-"));
    try {
      const runs = join(dir, "runs");
      const qfile = join(dir, "q.md");
      writeFileSync(qfile, "why is the run waiting?\n");
      const wrapper = join(import.meta.dir, "run");
      // A PATH with no flock: bash for the wrapper's shebang, bun and dirname
      // for its exec.
      const bin = join(dir, "bin");
      mkdirSync(bin, { recursive: true });
      symlinkSync(Bun.which("bash") ?? "/bin/bash", join(bin, "bash"));
      symlinkSync(process.execPath, join(bin, "bun"));
      symlinkSync(Bun.which("dirname") ?? "/usr/bin/dirname", join(bin, "dirname"));
      const worker = [
        `import { spawnSync } from "node:child_process";`,
        `const [wrapper, runs, qfile, idx] = process.argv.slice(process.argv.length - 4);`,
        `for (let j = 0; j < 2; j++) {`,
        `  const r = spawnSync(wrapper, ["host", "leg", "waiting", "add", runs, "T" + idx + "-" + j, qfile], { encoding: "utf8" });`,
        `  if (r.status !== 0) { process.stderr.write(String(r.stderr)); process.exit(1); }`,
        `}`,
      ].join("\n");
      const env = { ...process.env, PATH: bin };
      const procs = [0, 1].map((i) =>
        Bun.spawn([process.execPath, "-e", worker, wrapper, runs, qfile, String(i)], {
          stdout: "pipe",
          stderr: "pipe",
          env,
        }),
      );
      const codes = await Promise.all(procs.map((p) => p.exited));
      const errors = (await Promise.all(procs.map(async (p) => new Response(p.stderr).text())))
        .map((text) => text.trim())
        .filter(Boolean)
        .join("\n");
      expect(`${errors}codes=${codes.join(",")}`).toBe("codes=0,0");
      const text = readFileSync(join(runs, "postmaster", "ESCALATION.md"), "utf8");
      for (const t of ["T0-0", "T0-1", "T1-0", "T1-1"])
        expect(text.includes(`## ${t}\n`)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);
});
test("_watch touches its marker for a zombie while the zombie's parent still runs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "host-proc-watch-"));
  const procRoot = join(dir, "missing-proc");
  const marker = join(dir, "done");
  const parent = spawn("/bin/sh", ["-c", "sleep 0.2 & echo $!; exec sleep 30"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const priorProcRoot = process.env.POSTMASTER_PROC_ROOT;
  try {
    const childPid = Number(
      await new Promise<string>((resolve, reject) => {
        if (!parent.stdout) return reject(new Error("shell stdout is unavailable"));
        const reader = createInterface({ input: parent.stdout });
        const timeout = setTimeout(
          () => reject(new Error("shell did not print its child pid")),
          5000,
        );
        reader.on("line", (line) => {
          clearTimeout(timeout);
          reader.close();
          resolve(line);
        });
        parent.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      }),
    );
    expect(Number.isSafeInteger(childPid) && childPid > 0).toBe(true);
    // The child exits 0.2s after the shell starts it, but shell and sleep
    // startup drift under load, so wait for the zombie rather than reading
    // once after a fixed sleep, which a loaded runner misses.
    process.env.POSTMASTER_PROC_ROOT = procRoot;
    let zombieSeen = "";
    for (let i = 0; i < 100; i++) {
      zombieSeen = processState(childPid);
      if (zombieSeen === "zombie") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(zombieSeen).toBe("zombie");
    const result = spawnSync(
      join(import.meta.dir, "run"),
      ["host", "_watch", String(childPid), marker],
      {
        encoding: "utf8",
        timeout: 5000,
        env: { ...process.env, POSTMASTER_PROC_ROOT: procRoot },
      },
    );
    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
    expect(processState(childPid)).toBe("zombie");
    expect(processState(parent.pid ?? 0)).toBe("live");
  } finally {
    if (priorProcRoot === undefined) delete process.env.POSTMASTER_PROC_ROOT;
    else process.env.POSTMASTER_PROC_ROOT = priorProcRoot;
    try {
      parent.kill("SIGTERM");
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a reused marker kills the previous launch's _watch before the reset", async () => {
  const dir = mkdtempSync(join(tmpdir(), "host-watch-reuse-"));
  const temp = join(dir, "tmp");
  const cwd = join(dir, "work");
  const marker = join(dir, "leg.done");
  mkdirSync(temp);
  mkdirSync(cwd);
  writeFileSync(marker, "old marker");
  const sleeper = spawn("/bin/sleep", ["30"], { stdio: "ignore" });
  const watcher = spawn(
    join(import.meta.dir, "run"),
    ["host", "_watch", String(sleeper.pid), marker],
    {
      stdio: "ignore",
      detached: true,
    },
  );
  watcher.unref();
  try {
    expect(processState(watcher.pid ?? 0)).toBe("live");
    const result = spawnSync(
      join(import.meta.dir, "run"),
      ["host", "run", "watch-reuse", cwd, "--marker", marker, "--", "sleep", "1"],
      {
        cwd,
        encoding: "utf8",
        timeout: 30000,
        env: {
          ...process.env,
          HOME: dir,
          TMPDIR: temp,
          POSTMASTER_HOST: "none",
          POSTMASTER_HOST_STATE: join(dir, "state"),
        },
      },
    );
    expect(result.status).toBe(0);
    // The watcher died with the reuse: without the kill it polls on behind
    // the reset marker, and its late touch finishes the new launch early.
    for (let i = 0; i < 40 && processState(watcher.pid ?? 0) === "live"; i++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    expect(processState(watcher.pid ?? 0)).not.toBe("live");
    expect(processState(sleeper.pid ?? 0)).toBe("live");
    for (let i = 0; i < 50 && !existsSync(marker); i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    expect(existsSync(marker)).toBe(true);
  } finally {
    try {
      watcher.kill("SIGKILL");
    } catch {}
    try {
      sleeper.kill("SIGTERM");
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a background runner that dies before reading its spec is rejected", async () => {
  const dir = mkdtempSync(join(tmpdir(), "host-runner-dead-"));
  const temp = join(dir, "tmp");
  const cwd = join(dir, "work");
  const marker = join(dir, "done");
  const err = join(dir, "launch.err");
  mkdirSync(temp);
  mkdirSync(cwd);
  let removedSpec = false;
  let error = "";
  const child = spawn(
    join(import.meta.dir, "run"),
    ["host", "run", "dead-runner", cwd, "--err", err, "--marker", marker, "--", "sleep", "30"],
    {
      cwd,
      env: {
        ...process.env,
        HOME: dir,
        PATH: process.env.PATH ?? "",
        TMPDIR: temp,
        POSTMASTER_CONFIG: join(dir, "missing-config.toml"),
        POSTMASTER_HOST: "none",
        POSTMASTER_HOST_STATE: join(dir, "state"),
        POSTMASTER_HOST_CLAIM_WAIT: "3",
        POSTMASTER_PROC_ROOT: join(dir, "missing-proc"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stderr?.on("data", (chunk: Buffer) => (error += chunk.toString()));
  const remover = setInterval(() => {
    for (const name of readdirSync(temp)) {
      const argv = join(temp, name, "argv");
      if (!existsSync(argv)) continue;
      try {
        unlinkSync(argv);
        removedSpec = true;
      } catch {}
      clearInterval(remover);
      break;
    }
  }, 1);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("background launch did not return"));
      }, 10000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (exitCode) => {
        clearTimeout(timeout);
        resolve(exitCode);
      });
    });
    expect(removedSpec).toBe(true);
    expect(code).toBe(1);
    expect(error).toContain("did not start in the background");
    expect(existsSync(marker)).toBe(true);
  } finally {
    clearInterval(remover);
    if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});

// The boot id as host.ts reads it under this test's forced proc root: the
// portable path, with a stand-in sysctl answering the macOS keys, so the
// record matches what the spawned host computes.
function installStandInSysctl(dir: string): string {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const sysctl = join(bin, "sysctl");
  writeFileSync(
    sysctl,
    [
      "#!/bin/sh",
      'case "$*" in',
      '  *"kern.bootsessionuuid"*) echo "0B00D005-7E57-40DE-AD10-C0FFEE0C0DE5" ;;',
      '  *"kern.boottime"*) echo "{ sec = 1700000000, usec = 123456 } Mon Jan  1 00:00:00 2024" ;;',
      "  *) exit 1 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  chmodSync(sysctl, 0o755);
  return bin;
}

// The boot id as host.ts reads it: the Linux file, else macOS kern.boottime
// under LC_ALL=C, so the test's record matches on either system.
function currentBootId(): string {
  try {
    return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    const booted = spawnSync("sysctl", ["-n", "kern.boottime"], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
    });
    // ASCII: sysctl kern.boottime is kernel-emitted ASCII on macOS.
    return (booted.stdout ?? "").trim().split(/\s+/u).join(" ");
  }
}

test("a member with a five-word start matches its process, and close refuses while it lives", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "host-member-start-")));
  const state = join(dir, "state");
  mkdirSync(join(state, "launches"), { recursive: true });
  const priorProcRoot = process.env.POSTMASTER_PROC_ROOT;
  const priorPath = process.env.PATH;
  const sleep = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  sleep.unref();
  try {
    // Forced: the registry holds ps lstart's five words, not a tick count, and
    // the boot id comes from the portable sysctl path with its stand-in.
    const standIn = installStandInSysctl(dir);
    process.env.PATH = `${standIn}:${priorPath ?? ""}`;
    process.env.POSTMASTER_PROC_ROOT = join(dir, "missing-proc");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const memberPid = sleep.pid ?? 0;
    const start = processStart(memberPid);
    if (!start) throw new Error("no start for the member sleep");
    expect(start.split(" ").length).toBe(5);
    expect(processState(memberPid)).toBe("live");
    // The group is gone: only the member line can match this record.
    const reaped = spawn("sh", ["-c", "exit 0"], { stdio: "ignore" });
    const groupPid = reaped.pid ?? 0;
    await new Promise<void>((resolve) => reaped.once("exit", () => resolve()));
    expect(processState(groupPid)).toBe("absent");
    writeFileSync(
      join(state, "launches", String(groupPid)),
      `${dir}\nmember-probe\nmember ${memberPid} ${start}\nboot ${bootId()}\n`,
    );
    const env = {
      ...process.env,
      POSTMASTER_HOST: "none",
      POSTMASTER_HOST_STATE: state,
      POSTMASTER_HOST_STOP_WAIT: "5",
      POSTMASTER_HOST_CLOSE_WAIT: "1",
      POSTMASTER_HOST_FIXTURE: dir,
      POSTMASTER_PROC_ROOT: join(dir, "missing-proc"),
    };
    const wrapper = join(import.meta.dir, "run");
    const closed = spawnSync(wrapper, ["host", "close", dir], { encoding: "utf8", env });
    expect(closed.status).toBe(2);
    expect(`${closed.stdout ?? ""}${closed.stderr ?? ""}`).toContain("still running");
    const stopped = spawnSync(wrapper, ["host", "stop", dir], { encoding: "utf8", env });
    expect(stopped.status).toBe(0);
    expect(`${stopped.stdout ?? ""}${stopped.stderr ?? ""}`).not.toContain("no launch is running");
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && processState(memberPid) === "live") {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(processState(memberPid)).not.toBe("live");
    const after = spawnSync(wrapper, ["host", "close", dir], { encoding: "utf8", env });
    expect(after.status).toBe(0);
  } finally {
    try {
      sleep.kill("SIGKILL");
    } catch {}
    if (priorProcRoot === undefined) delete process.env.POSTMASTER_PROC_ROOT;
    else process.env.POSTMASTER_PROC_ROOT = priorProcRoot;
    if (priorPath === undefined) delete process.env.PATH;
    else process.env.PATH = priorPath;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("workhorse and stop-pidfile", () => {
  // A status assertion that says why it failed: bun's expect takes no message
  // argument, so the command's own output travels in a thrown error instead.
  const expectStatus = (
    result: { status: unknown; stdout: unknown; stderr: unknown },
    code: number,
  ): void => {
    if (result.status !== code) {
      throw new Error(
        `exit ${String(result.status)}, want ${code}: ${String(result.stdout ?? "")}${String(result.stderr ?? "")}`,
      );
    }
  };

  test("host workhorse composes the workhorse launch and lands its marker", async () => {
    const dir = mkdtempSync(join(tmpdir(), "host-workhorse-"));
    try {
      const repo = join(dir, "repo");
      const dispatch = join(repo, ".postmaster", "runs", "T-1");
      const wt = join(repo, ".worktrees", "T-1");
      mkdirSync(join(dispatch, "logs"), { recursive: true });
      mkdirSync(wt, { recursive: true });
      writeFileSync(
        join(dispatch, "run.json"),
        `${JSON.stringify({
          config: {
            lanes: { luna: { harness: "no-such-harness", model: "m" } },
            team: { workhorses: ["luna"] },
          },
        })}\n`,
      );
      writeFileSync(
        join(dispatch, "brief.md"),
        `# Waybill: T-1\n\n## Dispatch\nname: T-1, test ticket\nsynthesis worktree: ${wt}\n`,
      );
      writeFileSync(join(dispatch, "luna-prompt.txt"), "the brief\n");
      const r = spawnSync(
        join(import.meta.dir, "run"),
        ["host", "workhorse", dispatch, "luna", wt],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            POSTMASTER_HOST: "none",
            POSTMASTER_HOST_STATE: join(dir, "state"),
            POSTMASTER_CONFIG: join(dir, "missing-config.toml"),
          },
          timeout: 30000,
        },
      );
      expectStatus(r, 0);
      expect(existsSync(join(dispatch, "logs", "luna-events.jsonl"))).toBe(true);
      const marker = join(dispatch, "logs", "luna.done");
      const deadline = Date.now() + 20000;
      while (!existsSync(marker) && Date.now() < deadline) await Bun.sleep(50);
      expect(existsSync(marker)).toBe(true);
      // The composed child is run launch with the lane, the worktree and the run.
      expect(readFileSync(join(dispatch, "logs", "luna.err"), "utf8")).toContain(
        "harness 'no-such-harness' is not on PATH",
      );
      // The name is the one `host name ... workhorse` prints.
      const name = spawnSync(
        join(import.meta.dir, "run"),
        ["host", "name", dispatch, "workhorse", "luna"],
        {
          encoding: "utf8",
          timeout: 10000,
        },
      );
      expect(name.stdout.trim()).toBe("luna · workhorse · m");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40000);

  test("host stop-pidfile stops the whole group the file names", async () => {
    const dir = mkdtempSync(join(tmpdir(), "host-pidfile-"));
    try {
      const child = spawn("sleep", ["300"], { stdio: "ignore", detached: true });
      const pid = child.pid!;
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      const pidfile = join(dir, "preview.pid");
      writeFileSync(pidfile, `${pid}\n`);
      const r = spawnSync(join(import.meta.dir, "run"), ["host", "stop-pidfile", pidfile], {
        encoding: "utf8",
        timeout: 30000,
      });
      expectStatus(r, 0);
      expect(r.stdout).toContain(`stopped the process group of ${pid}`);
      await Promise.race([exited, Bun.sleep(15000)]);
      expect(processState(pid)).not.toBe("live");

      // A dead group says so and exits 0; a bad or missing file exits 1.
      const again = spawnSync(join(import.meta.dir, "run"), ["host", "stop-pidfile", pidfile], {
        encoding: "utf8",
        timeout: 10000,
      });
      expectStatus(again, 0);
      expect(again.stdout).toContain("no process group");
      writeFileSync(pidfile, "not-a-pid\n");
      const bad = spawnSync(join(import.meta.dir, "run"), ["host", "stop-pidfile", pidfile], {
        encoding: "utf8",
        timeout: 10000,
      });
      expectStatus(bad, 1);
      expect(bad.stderr).toContain("does not hold a pid");
      const missing = spawnSync(
        join(import.meta.dir, "run"),
        ["host", "stop-pidfile", join(dir, "nowhere.pid")],
        { encoding: "utf8", timeout: 10000 },
      );
      expectStatus(missing, 1);
      expect(missing.stderr).toContain("no such pidfile");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40000);

  test("host workhorse refuses anything but its three arguments", () => {
    for (const args of [[], ["a"], ["a", "b"], ["a", "b", "c", "--append"]]) {
      const r = spawnSync(join(import.meta.dir, "run"), ["host", "workhorse", ...args], {
        encoding: "utf8",
        timeout: 10000,
      });
      expectStatus(r, 1);
      expect(r.stderr).toContain("usage: run host workhorse <dispatch> <lane> <worktree>");
    }
  }, 40000);

  test("host stop-pidfile refuses a pid with trailing junk, and leaves the group alone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "host-pidfile-junk-"));
    try {
      const child = spawn("sleep", ["300"], { stdio: "ignore", detached: true });
      const pid = child.pid!;
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      const pidfile = join(dir, "preview.pid");
      writeFileSync(pidfile, `${pid}junk\n`);
      const r = spawnSync(join(import.meta.dir, "run"), ["host", "stop-pidfile", pidfile], {
        encoding: "utf8",
        timeout: 10000,
      });
      expectStatus(r, 1);
      expect(r.stderr).toContain("does not hold a pid");
      expect(processState(pid)).toBe("live");
      child.kill("SIGKILL");
      await Promise.race([exited, Bun.sleep(15000)]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40000);

  test("host stop-pidfile refuses a recorded number the OS has reused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "host-pidfile-reuse-"));
    try {
      const child = spawn("sleep", ["300"], { stdio: "ignore", detached: true });
      const pid = child.pid!;
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      const pidfile = join(dir, "preview.pid");
      // A stale start for a live number: the recorded launch is gone, so the live
      // holder is reported as a leftover member and the stop exits nonzero, unkilled.
      writeFileSync(pidfile, `${pid}\nno-such-start\nno-such-boot\n`);
      const stale = spawnSync(join(import.meta.dir, "run"), ["host", "stop-pidfile", pidfile], {
        encoding: "utf8",
        timeout: 10000,
      });
      expectStatus(stale, 2);
      expect(stale.stderr).toContain(`${pid} sleep 300`);
      expect(processState(pid)).toBe("live");
      // The live start with a foreign boot: still not the recorded launch.
      writeFileSync(pidfile, `${pid}\n${processStart(pid)}\nno-such-boot\n`);
      const boot = spawnSync(join(import.meta.dir, "run"), ["host", "stop-pidfile", pidfile], {
        encoding: "utf8",
        timeout: 10000,
      });
      expect(boot.status).toBe(2);
      expect(boot.stderr).toContain(`${pid} sleep 300`);
      expect(processState(pid)).toBe("live");
      child.kill("SIGKILL");
      await Promise.race([exited, Bun.sleep(15000)]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40000);

  test("host stop-pidfile checks the recorded command, and a legacy pidfile still stops", async () => {
    const dir = mkdtempSync(join(tmpdir(), "host-pidfile-command-"));
    try {
      const child = spawn("sleep", ["300"], { stdio: "ignore", detached: true });
      const pid = child.pid!;
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      const start = processStart(pid);
      expect(start).not.toBeNull();
      const pidfile = join(dir, "preview.pid");
      // Live start and boot, but a foreign command: refused and reported.
      writeFileSync(pidfile, `${pid}\n${start}\n${currentBootId()}\nnot-sleep\n`);
      const wrong = spawnSync(join(import.meta.dir, "run"), ["host", "stop-pidfile", pidfile], {
        encoding: "utf8",
        timeout: 10000,
      });
      expect(wrong.status).toBe(2);
      expect(wrong.stderr).toContain(`${pid} sleep 300`);
      expect(processState(pid)).toBe("live");
      // A legacy pidfile, with no command recorded, still stops a live match.
      writeFileSync(pidfile, `${pid}\n${start}\n${currentBootId()}\n`);
      const legacy = spawnSync(join(import.meta.dir, "run"), ["host", "stop-pidfile", pidfile], {
        encoding: "utf8",
        timeout: 30000,
      });
      expectStatus(legacy, 0);
      expect(legacy.stdout).toContain(`stopped the process group of ${pid}`);
      await Promise.race([exited, Bun.sleep(15000)]);
      expect(processState(pid)).not.toBe("live");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40000);

  test("host stop-pidfile reports members orphaned after the leader exits, and kills nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "host-pidfile-orphan-"));
    let orphan = 0;
    try {
      const orphanPidFile = join(dir, "orphan.pid");
      const child = spawn("bash", ["-c", `sleep 300 & echo $! > ${orphanPidFile} && sleep 2`], {
        stdio: "ignore",
        detached: true,
      });
      const leader = child.pid!;
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      const pidfile = join(dir, "preview.pid");
      writeFileSync(pidfile, `${leader}\n`);
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && processState(leader) === "live") await Bun.sleep(50);
      await Promise.race([exited, Bun.sleep(15000)]);
      orphan = Number(readFileSync(orphanPidFile, "utf8").trim());
      expect(processState(orphan)).toBe("live");
      // A bare pidfile records no identity, so the unprovable members are
      // reported, not killed, and the stop exits nonzero.
      const r = spawnSync(join(import.meta.dir, "run"), ["host", "stop-pidfile", pidfile], {
        encoding: "utf8",
        timeout: 30000,
      });
      expectStatus(r, 2);
      expect(r.stderr).toContain(`${orphan} sleep 300`);
      expect(processState(orphan)).toBe("live");
    } finally {
      try {
        if (orphan > 0) process.kill(orphan, "SIGKILL");
      } catch {}
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);

  test("a recorded pidfile with a reaped leader reports the orphans, and kills nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "host-pidfile-orphan-recorded-"));
    let orphan = 0;
    try {
      const orphanPidFile = join(dir, "orphan.pid");
      const child = spawn("bash", ["-c", `sleep 300 & echo $! > ${orphanPidFile} && sleep 2`], {
        stdio: "ignore",
        detached: true,
      });
      const leader = child.pid!;
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      const start = processStart(leader);
      expect(start).not.toBeNull();
      const pidfile = join(dir, "preview.pid");
      writeFileSync(pidfile, `${leader}\n${start}\n${currentBootId()}\n`);
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && processState(leader) === "live") await Bun.sleep(50);
      await Promise.race([exited, Bun.sleep(15000)]);
      orphan = Number(readFileSync(orphanPidFile, "utf8").trim());
      expect(processState(orphan)).toBe("live");
      // The leader is reaped, so no row proves the identity: the members are
      // reported, not killed, and the stop exits nonzero.
      const r = spawnSync(join(import.meta.dir, "run"), ["host", "stop-pidfile", pidfile], {
        encoding: "utf8",
        timeout: 30000,
      });
      expectStatus(r, 2);
      expect(r.stderr).toContain(`${orphan} sleep 300`);
      expect(processState(orphan)).toBe("live");
    } finally {
      try {
        if (orphan > 0) process.kill(orphan, "SIGKILL");
      } catch {}
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);

  const skipSetsid = process.platform !== "linux";
  // A group leader that dies unreaped: the middle shell never waits, so the leader
  // holds its number as a zombie with a live member beside it. The trailing `:` keeps
  // the leader bash to the end: without it bash execs its last sleep instead.
  async function zombieLeader(): Promise<{
    leader: number;
    member: number;
    outer: ReturnType<typeof spawn>;
  }> {
    const outer = spawn(
      "bash",
      [
        "-c",
        "setsid bash -c 'sleep 300 & echo MEMBER=$!; sleep 5; :' & echo LEADER=$!; exec sleep 60",
      ],
      { stdio: ["ignore", "pipe", "ignore"], detached: true },
    );
    const lines: string[] = [];
    await new Promise<void>((resolve, reject) => {
      if (!outer.stdout) return reject(new Error("shell stdout is unavailable"));
      const reader = createInterface({ input: outer.stdout });
      const timeout = setTimeout(() => reject(new Error("shell did not print its pids")), 5000);
      reader.on("line", (line: string) => {
        lines.push(line);
        if (lines.length === 2) {
          clearTimeout(timeout);
          reader.close();
          resolve();
        }
      });
      outer.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    const leader = Number((lines.find((l) => l.startsWith("LEADER=")) ?? "=").split("=")[1]);
    const member = Number((lines.find((l) => l.startsWith("MEMBER=")) ?? "=").split("=")[1]);
    return { leader, member, outer };
  }

  test.skipIf(skipSetsid)(
    "a stale pidfile whose leader is a zombie reports the members, and kills nothing",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "host-pidfile-zombie-stale-"));
      let member = 0;
      let outer: ReturnType<typeof spawn> | null = null;
      try {
        const z = await zombieLeader();
        outer = z.outer;
        member = z.member;
        expect(Number.isSafeInteger(z.leader) && z.leader > 0).toBe(true);
        expect(Number.isSafeInteger(member) && member > 0).toBe(true);
        const dead = Date.now() + 15000;
        while (Date.now() < dead && processState(z.leader) === "live") await Bun.sleep(50);
        expect(processState(z.leader)).toBe("zombie");
        expect(processState(member)).toBe("live");
        const pidfile = join(dir, "preview.pid");
        writeFileSync(pidfile, `${z.leader}\nno-such-start\n${currentBootId()}\n`);
        const r = spawnSync(join(import.meta.dir, "run"), ["host", "stop-pidfile", pidfile], {
          encoding: "utf8",
          timeout: 30000,
        });
        expectStatus(r, 2);
        expect(r.stderr).toContain(`${member} sleep 300`);
        expect(processState(member)).toBe("live");
        expect(processState(z.leader)).toBe("zombie");
      } finally {
        try {
          if (member > 0) process.kill(member, "SIGKILL");
        } catch {}
        try {
          outer?.kill("SIGTERM");
        } catch {}
        rmSync(dir, { recursive: true, force: true });
      }
    },
    60000,
  );

  test.skipIf(skipSetsid)(
    "a recorded pidfile still stops the members of its zombie leader",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "host-pidfile-zombie-recorded-"));
      let member = 0;
      let outer: ReturnType<typeof spawn> | null = null;
      try {
        const z = await zombieLeader();
        outer = z.outer;
        member = z.member;
        expect(Number.isSafeInteger(z.leader) && z.leader > 0).toBe(true);
        expect(Number.isSafeInteger(member) && member > 0).toBe(true);
        const start = processStart(z.leader);
        expect(start).not.toBeNull();
        const dead = Date.now() + 15000;
        while (Date.now() < dead && processState(z.leader) === "live") await Bun.sleep(50);
        expect(processState(z.leader)).toBe("zombie");
        expect(processState(member)).toBe("live");
        const pidfile = join(dir, "preview.pid");
        writeFileSync(pidfile, `${z.leader}\n${start}\n${currentBootId()}\nbash\n`);
        const r = spawnSync(join(import.meta.dir, "run"), ["host", "stop-pidfile", pidfile], {
          encoding: "utf8",
          timeout: 30000,
        });
        expectStatus(r, 0);
        expect(r.stdout).toContain(`stopped the process group of ${z.leader}`);
        const gone = Date.now() + 15000;
        while (Date.now() < gone && processState(member) === "live") await Bun.sleep(50);
        expect(processState(member)).not.toBe("live");
      } finally {
        try {
          if (member > 0) process.kill(member, "SIGKILL");
        } catch {}
        try {
          outer?.kill("SIGTERM");
        } catch {}
        rmSync(dir, { recursive: true, force: true });
      }
    },
    60000,
  );

  test("a pidfile a launch wrote stops that launch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "host-pidfile-roundtrip-"));
    try {
      const repo = join(dir, "repo");
      const dispatch = join(repo, ".postmaster", "runs", "T-1");
      const wt = join(repo, ".worktrees", "T-1");
      mkdirSync(join(dispatch, "logs"), { recursive: true });
      mkdirSync(wt, { recursive: true });
      writeFileSync(
        join(dispatch, "run.json"),
        `${JSON.stringify({ config: { lanes: {}, team: { workhorses: [] } } })}\n`,
      );
      writeFileSync(
        join(dispatch, "brief.md"),
        `# Waybill: T-1\n\n## Dispatch\nname: T-1, test ticket\nsynthesis worktree: ${wt}\n`,
      );
      const env = {
        ...process.env,
        POSTMASTER_HOST: "none",
        POSTMASTER_HOST_STATE: join(dir, "state"),
        POSTMASTER_CONFIG: join(dir, "missing-config.toml"),
      };
      const launched = spawnSync(
        join(import.meta.dir, "run"),
        [
          "host",
          "run",
          "pidfile-roundtrip",
          wt,
          "--under",
          dispatch,
          "--role",
          "coachman",
          "--run",
          dispatch,
          "--out",
          join(dispatch, "logs", "s.jsonl"),
          "--err",
          join(dispatch, "logs", "s.err"),
          "--marker",
          join(dispatch, "logs", "s.done"),
          "--pidfile",
          join(dispatch, "s.pid"),
          "--",
          "sleep",
          "300",
        ],
        { encoding: "utf8", env, timeout: 30000 },
      );
      expectStatus(launched, 0);
      const pidfile = join(dispatch, "s.pid");
      const recorded = readFileSync(pidfile, "utf8").trim().split("\n");
      expect(recorded.length).toBe(4);
      expect(recorded[3]!.length).toBeGreaterThan(0);
      const r = spawnSync(join(import.meta.dir, "run"), ["host", "stop-pidfile", pidfile], {
        encoding: "utf8",
        timeout: 30000,
      });
      expectStatus(r, 0);
      expect(r.stdout).toContain("stopped the process group of");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});

test("Herdr checks time out when timeout is absent, and keep working when it is present", async () => {
  const dir = mkdtempSync(join(tmpdir(), "host-herdr-timeout-"));
  // A herdr that never answers: each probe below waits out the host's own time limit, about five
  // seconds, so the three run side by side, each with a folder, a state and a bin of its own.
  const probe = (name: string, withTimeout: boolean) => {
    const home = join(dir, name);
    const bin = join(home, "bin");
    const cwd = join(home, "worktree");
    const calls = join(home, "herdr.calls");
    mkdirSync(bin, { recursive: true });
    mkdirSync(cwd);
    for (const [tool, target] of [
      ["bash", Bun.which("bash") ?? "/bin/bash"],
      ["bun", process.execPath],
      ["dirname", Bun.which("dirname") ?? "/usr/bin/dirname"],
      // The minimal PATH is about timeout, not ps: without /proc, macOS reads
      // every process state through ps, and a missing ps reads as absent.
      ["ps", Bun.which("ps") ?? "/bin/ps"],
    ])
      symlinkSync(target, join(bin, tool));
    const timeout = Bun.which("timeout");
    if (withTimeout && timeout) symlinkSync(timeout, join(bin, "timeout"));
    const herdr = join(bin, "herdr");
    writeFileSync(
      herdr,
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$HERDR_CALLS"\nexec /bin/sleep 30\n',
    );
    chmodSync(herdr, 0o755);
    const env: Record<string, string | undefined> = {
      ...process.env,
      HOME: home,
      HERDR_CALLS: calls,
      PATH: bin,
      POSTMASTER_HOST_STATE: join(home, "state"),
      POSTMASTER_HOST_FIXTURE: home,
    };
    delete env.POSTMASTER_HOST;
    return { cwd, calls, env, hasTimeout: Boolean(withTimeout && timeout) };
  };
  const exec = (
    args: string[],
    env: Record<string, string | undefined>,
  ): Promise<{ status: number | null; stdout: string; elapsed: number }> =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const child = spawn(join(import.meta.dir, "run"), args, {
        env,
        stdio: ["ignore", "pipe", "ignore"],
      });
      let stdout = "";
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      const killer = setTimeout(() => child.kill("SIGKILL"), 10000);
      child.on("error", reject);
      child.on("close", (status) => {
        clearTimeout(killer);
        resolve({ status, stdout, elapsed: Date.now() - started });
      });
    });
  try {
    const close = probe("close", false);
    const run = probe("run", false);
    const detect = probe("detect", true);
    const [closed, ran, detected] = await Promise.all([
      exec(["host", "close", close.cwd], close.env),
      exec(["host", "run", "timeout-probe", run.cwd, "--", "/bin/true"], run.env),
      detect.hasTimeout ? exec(["host", "detect"], detect.env) : Promise.resolve(null),
    ]);
    expect(closed.status).toBe(0);
    expect(closed.elapsed).toBeLessThan(10000);
    expect(closed.stdout).toContain("closed what run host opened");
    expect(ran.status).toBe(0);
    expect(ran.elapsed).toBeLessThan(10000);
    expect(ran.stdout).toContain("host=none");
    for (const side of [close, run]) {
      const requests = readFileSync(side.calls, "utf8");
      expect(requests).toContain("workspace list");
      expect(requests).not.toMatch(/pane|workspace close/u);
    }
    if (detected) {
      expect(detected.status).toBe(0);
      expect(detected.stdout.trim()).toBe("none");
      expect(detected.elapsed).toBeLessThan(10000);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("close-run teardown finds reviewer worktrees from rows the launch wrote", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "host-revlaunch-")));
  try {
    const repo = join(dir, "repo");
    const dispatch = join(repo, ".postmaster", "runs", "T-9");
    mkdirSync(join(dispatch, "logs"), { recursive: true });
    writeFileSync(join(dispatch, "manifest.json"), `${JSON.stringify({ base: "BASESHA" })}\n`);
    writeFileSync(
      join(dispatch, "brief.md"),
      `## Dispatch\nname: T-9\nsynthesis worktree: ${join(repo, ".worktrees", "T-9-synthesis")}\n`,
    );
    const recorded: string[][] = [];
    const deps: StepDeps = {
      tool: (name, args): StepChild => {
        if (name === "log-action") recorded.push(args);
        if (name === "turnpikes")
          return { code: 0, out: "1 synthesis\n2 review style bug security\n", err: "" };
        if (name === "reviewers" && args[0] === "lanes") return { code: 0, out: "luna\n", err: "" };
        return { code: 0, out: "", err: "" };
      },
      git: (args): StepChild =>
        args.includes("rev-parse")
          ? { code: 0, out: "SNAP\n", err: "" }
          : { code: 0, out: "", err: "" },
    };
    const res = launchRound(
      { dispatch, round: "1", repo, synthesis: join(repo, ".worktrees", "T-9-synthesis") },
      deps,
    );
    expect(res.code).toBe(0);
    const lines = recorded
      .filter((args) => args[2] === "review-launch")
      .map((args) => JSON.stringify({ action: args[2], target: args[3], detail: args[4] }));
    expect(lines.length).toBe(3);
    writeFileSync(join(dispatch, "actions.jsonl"), `${lines.join("\n")}\n`);
    const paths = runWorktreePaths(dispatch);
    for (const lens of ["style", "bug", "security"]) {
      expect(paths).toContain(join(repo, ".worktrees", `T-9-rev-${lens}-luna`));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run-state strips control characters from the ticket title", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "host-runstate-")));
  try {
    const dispatch = join(dir, "dispatch");
    mkdirSync(dispatch, { recursive: true });
    writeFileSync(
      join(dispatch, "brief.md"),
      "## Dispatch\nname: #1, Pro\x1b]0;spoofed\x07\x1b[2J title\nsynthesis worktree: /nowhere\n",
    );
    writeFileSync(join(dispatch, "manifest.json"), '{"stage":"review","leg":2,"lanes":{}}\n');
    const result = spawnSync(join(import.meta.dir, "run"), ["host", "run-state", dispatch], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const first = result.stdout.split("\n")[0] ?? "";
    expect(first).not.toContain("\x1b");
    expect(first).not.toContain("\x07");
    expect(first).toContain("#1, Pro");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run-state reports an abandoned run as complete, not unknown", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "host-runstate-")));
  try {
    const dispatch = join(dir, "dispatch");
    mkdirSync(dispatch, { recursive: true });
    writeFileSync(
      join(dispatch, "brief.md"),
      "## Dispatch\nname: #1, Probe\nsynthesis worktree: /nowhere\n",
    );
    writeFileSync(join(dispatch, "manifest.json"), '{"stage":"abandoned","leg":2,"lanes":{}}\n');
    const result = spawnSync(join(import.meta.dir, "run"), ["host", "run-state", dispatch], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("nothing — the run is complete");
    expect(result.stdout).not.toContain("unknown — the run's records name no stage");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a run-tab lock reads live only for its own started owner", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "host-runlock-")));
  try {
    const lock = join(dir, ".lock");
    mkdirSync(lock);
    const start = processStart(process.pid);
    expect(start).not.toBeNull();
    writeFileSync(join(lock, "owner"), `${process.pid}\n${start ?? ""}\n`);
    expect(runTabLockOwnerAlive(lock)).toBe(true);
    const dead = spawnSync("true");
    const deadPid = dead.pid ?? 0;
    expect(deadPid).toBeGreaterThan(0);
    expect(dead.status).toBe(0);
    writeFileSync(join(lock, "owner"), `${deadPid}\nnot a start time\n`);
    expect(runTabLockOwnerAlive(lock)).toBe(false);
    writeFileSync(join(lock, "owner"), "not a pid\n");
    expect(runTabLockOwnerAlive(lock)).toBe(false);
    unlinkSync(join(lock, "owner"));
    expect(runTabLockOwnerAlive(lock)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("375 review round 1 fixes", () => {
  test("spawn on a fixture copy passes the caller POSTMASTER_* settings to its pane, and a run launch takes none", () => {
    const fx = makeFx("375-spawn-env");
    try {
      const tool = toolCheckout();
      const pmRoot = mainRepoOf(tool);
      expect(pmRoot).not.toBe("");
      const fix = makeFixtureRepo(fx, "fixcopy");
      saveHerdr(fx, freshHerdr());
      saveTmux(fx, freshTmux());
      const config = stubConfig(fx);
      const env = fxEnv(fx, { POSTMASTER_CONFIG: config });
      const r = sh(
        SELF,
        ["host", "spawn", "pm-env", fix, "--label", "postmaster", "--", "true"],
        env,
        fx.caller,
      );
      expect(r.code).toBe(0);
      // The spawn's pane is a split off the fixture tab: it carries the
      // caller settings a fresh tab would, as hosts.md promises.
      const splits = calls(fx, "herdr").filter((line) => line.startsWith("pane\tsplit\t"));
      expect(splits.length).toBe(1);
      const cells = splits[0]!.split("\t");
      expect(cells).toContain("--env");
      expect(cells).toContain(`POSTMASTER_CONFIG=${config}`);
      // A run launch in the same tab takes no caller env, as before.
      const synth = addWorktree(fix, "1", "1");
      const dispatch = join(fx.root, "dispatch", "1");
      writeFixtureDispatch(dispatch, synth, tool);
      const marker = join(fx.logs, "coach.done");
      const launched = runLaunch(fx, env, "coachman", synth, dispatch, marker);
      expect(launched.code).toBe(0);
      const splitsAfter = calls(fx, "herdr").filter((line) => line.startsWith("pane\tsplit\t"));
      expect(splitsAfter.length).toBe(2);
      expect(splitsAfter[1]!.includes("--env")).toBe(false);
    } finally {
      cleanup(fx);
    }
  });

  test("close-run with a stale run record still closes the live fixture tab", async () => {
    const fx = makeFx("375-close-stale");
    try {
      const tool = toolCheckout();
      const pmRoot = mainRepoOf(tool);
      expect(pmRoot).not.toBe("");
      const fix = makeFixtureRepo(fx, "fixcopy");
      const projSpace = seedProjectSpace(fx, pmRoot);
      const seeded = readHerdr(fx);
      const shellTab = seeded.spaces[projSpace]!.tabs[0]!;
      const synth = addWorktree(fix, "1", "1");
      const dispatch = join(fx.root, "dispatch", "1");
      writeFixtureDispatch(dispatch, synth, tool);
      const env = fxEnv(fx, {
        POSTMASTER_CONFIG: stubConfig(fx),
        POSTMASTER_HOST_FINISH_DELAY: "3600",
      });
      const pmMarker = join(fx.logs, "pm.done");
      expect(headlessPostmaster(fx, env, fix, pmMarker).code).toBe(0);
      const coachMarker = join(fx.logs, "coach.done");
      expect(runLaunch(fx, env, "coachman", synth, dispatch, coachMarker).code).toBe(0);
      for (const marker of [pmMarker, coachMarker])
        expect(await waitFor(() => existsSync(marker), 30)).toBe(true);
      const before = readHerdr(fx);
      const dead = before.spaces[projSpace]!.tabs.find(
        (tab) => before.tabs[tab]!.label === "fixture · fixcopy",
      );
      expect(dead).not.toBeUndefined();
      const tabPanes = before.spaces[projSpace]!.panes.filter(
        (pane) => before.panes[pane]!.tab === dead,
      );
      expect(tabPanes.length).toBe(3);
      expect(runTabRecords(fx).map((item) => item.tab)).toEqual([dead]);
      expect(fixTabRecords(fx).map((item) => item.tab)).toEqual([dead]);
      // Every pane of the tab closed by hand: the tab is gone, while both
      // records still name it.
      const stubHerdr = join(fx.bin, "herdr");
      for (const pane of tabPanes)
        expect(sh(stubHerdr, ["pane", "close", pane], env, fx.caller).code).toBe(0);
      const emptied = readHerdr(fx);
      expect(emptied.spaces[projSpace]!.tabs).toEqual([shellTab]);
      // A copy-level launch recreates the tab; only the fixture record
      // follows it, and the run record still names the dead tab.
      const watchMarker = join(fx.logs, "watch.done");
      expect(copyWatcher(fx, env, fix, watchMarker).code).toBe(0);
      expect(await waitFor(() => existsSync(watchMarker), 30)).toBe(true);
      const live = fixTabRecords(fx).map((item) => item.tab);
      expect(live.length).toBe(1);
      expect(live[0]).not.toBe(dead);
      expect(runTabRecords(fx).map((item) => item.tab)).toEqual([dead]);
      const closed = sh(SELF, ["host", "close-run", dispatch], env, fx.root);
      expect(closed.code).toBe(0);
      const after = readHerdr(fx);
      expect(after.spaces[projSpace]).not.toBeUndefined();
      expect(after.spaces[projSpace]!.tabs).toEqual([shellTab]);
      expect(placementRecords(fx)).toEqual([]);
      expect(runTabRecords(fx)).toEqual([]);
      expect(fixTabRecords(fx)).toEqual([]);
    } finally {
      cleanup(fx);
    }
  }, 600000);
});
