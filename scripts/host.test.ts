// Tests beside scripts/host.ts, moved from its --self-test on #109: 320 controls.
// host.ts's suite lives in ./host-self-test.ts's runControls (shared sequential fixture);
// this file drives it once in beforeAll, splits its printed lines on the section headers,
// and asserts each section's control count with no FAIL. Portable process controls are below.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runControls } from "./host-self-test.ts";
import { processState } from "./lib/process-state.ts";

const SECTIONS: Array<{ name: string; count: number }> = [
  { name: "preamble", count: 6 },
  { name: "detect", count: 5 },
  { name: "launch labels and run identity", count: 31 },
  { name: "name: from the waybill, so no title is typed into a shell", count: 5 },
  { name: "run, no host: headless launch", count: 16 },
  { name: "a run launch without a named run space is refused", count: 1 },
  { name: "stop: owned process trees and refusal controls", count: 5 },
  { name: "stop: registry identity and process membership", count: 16 },
  { name: "run, Herdr (stub): pane placement and environment handover", count: 15 },
  { name: "stop and close, Herdr (stub)", count: 6 },
  { name: "a reviewer's scratch clone, Herdr (stub)", count: 5 },
  { name: "run, stop and close, tmux (stub)", count: 10 },
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
  { name: "interactive sessions", count: 15 },
  { name: "run role: the explicit host role", count: 1 },
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

// bun:test's types omit the hook timeout, though the runtime honors it.

beforeAll(async () => {
  console.log = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  try {
    failures = await runControls();
  } finally {
    console.log = origLog;
  }
}, 600000);

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
  }, 60000);
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
      const wrapper = join(import.meta.dir, "host.sh");
      const worker = [
        `import { spawnSync } from "node:child_process";`,
        `const [wrapper, runs, qfile, idx] = process.argv.slice(process.argv.length - 4);`,
        `for (let j = 0; j < 8; j++) {`,
        `  const r = spawnSync(wrapper, ["leg", "waiting", "add", runs, "T" + idx + "-" + j, qfile], { encoding: "utf8" });`,
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
      const wrapper = join(import.meta.dir, "host.sh");
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
        `  const r = spawnSync(wrapper, ["leg", "waiting", "add", runs, "T" + idx + "-" + j, qfile], { encoding: "utf8" });`,
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
    await new Promise((resolve) => setTimeout(resolve, 300));

    process.env.POSTMASTER_PROC_ROOT = procRoot;
    expect(processState(childPid)).toBe("zombie");
    const result = spawnSync(
      join(import.meta.dir, "host.sh"),
      ["_watch", String(childPid), marker],
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
    join(import.meta.dir, "host.sh"),
    ["run", "dead-runner", cwd, "--err", err, "--marker", marker, "--", "sleep", "30"],
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
