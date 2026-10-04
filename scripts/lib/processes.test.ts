// Tests beside scripts/lib/processes.ts: the process facts, and the containment
// scan that keeps every other script on the shared way. On Linux the tests run
// the Mac path by pointing POSTMASTER_PROC_ROOT at a folder that does not exist;
// they say so, and never claim to have run on a Mac.
import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commandLine,
  PLANTED,
  PLANTED_MISS,
  processAlive,
  processStart,
  processState,
  processTable,
  procRoot,
  scanProcessesSource,
} from "./processes.ts";

const scriptsDir = join(import.meta.dir, "..");
const modulePath = join(import.meta.dir, "processes.ts");
const savedRoot = process.env.POSTMASTER_PROC_ROOT;

afterEach(() => {
  if (savedRoot === undefined) delete process.env.POSTMASTER_PROC_ROOT;
  else process.env.POSTMASTER_PROC_ROOT = savedRoot;
});

/** The Mac path on Linux: a proc root that does not exist, so every check falls to ps. */
function forceMacPath(): void {
  process.env.POSTMASTER_PROC_ROOT = join(tmpdir(), "postmaster-no-proc-root");
}

function forceProcRoot(): void {
  delete process.env.POSTMASTER_PROC_ROOT;
}

describe("process facts, /proc and the forced Mac path", () => {
  for (const [label, force] of [
    ["with /proc", () => forceProcRoot()],
    [
      "forced to the Mac path (POSTMASTER_PROC_ROOT points off; says forced, not a Mac run)",
      () => forceMacPath(),
    ],
  ] as const) {
    test(`${label}: live, zombie and absent, with the live one's start`, async () => {
      force();
      const live = spawn("sleep", ["30"]);
      const holder = spawn("sh", ["-c", "sleep 0.2 & echo $!; exec sleep 30"], { stdio: "pipe" });
      const zombieText = await new Promise<string>((resolve) => {
        let text = "";
        holder.stdout!.on("data", (c: Buffer) => {
          text += c.toString();
          if (text.includes("\n")) resolve(text);
        });
        holder.on("exit", () => resolve(text));
      });
      const zombie = Number(zombieText.trim().split("\n")[0]);
      const gone = spawn("sh", ["-c", "exit 0"]);
      await new Promise<void>((resolve) => gone.on("exit", () => resolve()));
      // The short sleep must have exited and become a zombie, and the reaped
      // child's pid must be free again.
      await Bun.sleep(600);
      try {
        expect(processState(live.pid!)).toBe("live");
        expect(processState(zombie)).toBe("zombie");
        expect(processState(gone.pid!)).toBe("absent");
        expect(processAlive(live.pid!)).toBe(true);
        expect(processAlive(zombie)).toBe(false);
        expect(processAlive(gone.pid!)).toBe(false);
        const start = processStart(live.pid!);
        expect(start !== null && start !== "").toBe(true);
        // A zombie has ended: it carries no start for a lock to match.
        expect(processStart(zombie)).toBe(null);
        expect(processStart(gone.pid!)).toBe(null);
      } finally {
        try {
          live.kill("SIGKILL");
        } catch {}
        try {
          process.kill(holder.pid!, "SIGKILL");
        } catch {}
      }
    }, 30000);
  }

  test("the setting is POSTMASTER_PROC_ROOT, and unset reads as /proc", () => {
    forceProcRoot();
    expect(procRoot()).toBe("/proc");
    process.env.POSTMASTER_PROC_ROOT = "/tmp/nowhere-postmaster";
    expect(procRoot()).toBe("/tmp/nowhere-postmaster");
    process.env.POSTMASTER_PROC_ROOT = "";
    expect(procRoot()).toBe("/proc");
  });

  test("the table lists live processes with their group, and flags zombies", async () => {
    forceProcRoot();
    const live = spawn("sleep", ["30"]);
    await Bun.sleep(50);
    try {
      const table = processTable();
      expect(table.has(live.pid!)).toBe(true);
      expect(table.get(live.pid!)!.zombie).toBe(false);
      expect(table.get(live.pid!)!.start !== "").toBe(true);
    } finally {
      try {
        live.kill("SIGKILL");
      } catch {}
    }
  }, 30000);

  test("the forced Mac path's table agrees on a live process", async () => {
    forceMacPath();
    const live = spawn("sleep", ["30"]);
    await Bun.sleep(50);
    try {
      const table = processTable();
      expect(table.has(live.pid!)).toBe(true);
      expect(table.get(live.pid!)!.zombie).toBe(false);
    } finally {
      try {
        live.kill("SIGKILL");
      } catch {}
    }
  }, 30000);

  test("commandLine reads another process's command", async () => {
    forceProcRoot();
    const live = spawn("sleep", ["30"]);
    await Bun.sleep(50);
    try {
      expect(commandLine(live.pid!).includes("sleep")).toBe(true);
    } finally {
      try {
        live.kill("SIGKILL");
      } catch {}
    }
  }, 30000);

  test("commandLine on the forced Mac path agrees", async () => {
    forceMacPath();
    const live = spawn("sleep", ["30"]);
    await Bun.sleep(50);
    try {
      expect(commandLine(live.pid!).includes("sleep")).toBe(true);
    } finally {
      try {
        live.kill("SIGKILL");
      } catch {}
    }
  }, 30000);
});

// --- containment: nothing outside the module checks a process its own way ---

const collectTargets = (): string[] => {
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".ts")) files.push(p);
    }
  };
  walk(scriptsDir);
  return files.filter((f) => f !== modulePath);
};

describe("containment: every process check goes through the module", () => {
  test("planted shapes are each caught with their kind", () => {
    for (const p of PLANTED) {
      const hits = scanProcessesSource("planted.ts", p.src);
      expect(hits.some((h) => h.kind === p.kind)).toBe(true);
    }
  });

  test("own cmdline, boot id, uptime, real signals and comments do not trip", () => {
    for (const p of PLANTED_MISS) {
      expect(scanProcessesSource("ok.ts", p.src)).toEqual([]);
    }
  });

  test("every script outside the module is clean", () => {
    const dirty = [];
    for (const file of collectTargets()) {
      dirty.push(...scanProcessesSource(file, readFileSync(file, "utf8")));
    }
    if (dirty.length) {
      const lines = dirty
        .map((h: { file: string; line: number; kind: string; text: string }) =>
          `${h.file}:${h.line} ${h.kind}: ${h.text}`)
        .join("\n");
      throw new Error(`process checks outside scripts/lib/processes.ts:\n${lines}`);
    }
    expect(dirty).toEqual([]);
  });

  test("a planted file in the tree is found (the scan reads the tree)", () => {
    const dir = mkdtempSync(join(tmpdir(), "proc-contain."));
    try {
      const planted = join(dir, "planted-in-tree.ts");
      // Assembled so this test file itself holds no shape the scan would catch.
      writeFileSync(planted, `process.${"kill"}(pid, ${"0"});\n`);
      const hits = scanProcessesSource(planted, readFileSync(planted, "utf8"));
      expect(hits.map((h: { kind: string }) => h.kind)).toContain("kill-probe");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
