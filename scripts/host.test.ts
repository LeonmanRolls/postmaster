// Tests beside scripts/host.ts, moved from its --self-test on #109: 320 controls.
// host.ts's suite lives in ./host-self-test.ts's runControls (shared sequential fixture);
// this file drives it once in beforeAll, splits its printed lines on the section headers,
// and asserts each section's control count with no FAIL. No fixture state is restructured.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runControls } from "./host-self-test.ts";

const SECTIONS: Array<{ name: string; count: number }> = [
  { name: "preamble", count: 6 },
  { name: "detect", count: 5 },
  { name: "launch labels and run identity", count: 31 },
  { name: "name: from the waybill, so no title is typed into a shell", count: 5 },
  { name: "run, no host: headless launch", count: 16 },
  { name: "a run launch without a named run space is refused", count: 1 },
  { name: "stop: owned process trees and refusal controls", count: 5 },
  { name: "stop: registry identity and process membership", count: 16 },
  { name: "run, Herdr (stub): pane placement and environment handover", count: 13 },
  { name: "stop and close, Herdr (stub)", count: 6 },
  { name: "a reviewer's scratch clone, Herdr (stub)", count: 5 },
  { name: "run, stop and close, tmux (stub)", count: 8 },
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
  if (failures > 0) {
    for (const line of lines.filter(
      (line) => line.includes("FAIL") || line.includes("setup failed"),
    ))
      process.stderr.write(`${line}\n`);
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
  expect(`${name}: ${oks.length} ok of ${count}`).toBe(`${name}: ${count} ok of ${count}`);
  expect(bad).toEqual([]);
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
