import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bootId,
  bootTime,
  processCommandLines,
  processInfo,
  processStart,
  processState,
  processTable,
  sameBoot,
} from "./processes.ts";

const SCRIPTS = join(import.meta.dir, "..");

function scriptFiles(directory: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const info = statSync(path);
    if (info.isDirectory()) files.push(...scriptFiles(path));
    else if (
      /\.(?:js|mjs|py|sh|ts)$/u.test(name) &&
      path !== join(SCRIPTS, "lib", "processes.test.ts")
    )
      files.push(path);
  }
  return files;
}

function processProbeViolations(source: string): string[] {
  const checks: Array<[string, RegExp]> = [
    ["pid stat", /\/proc\/(?:\$\{[^}]+\}|[0-9]+)\/stat/u],
    ["proc listing", /(?:^|[^A-Za-z0-9_$])(?:readdirSync|readdir)[ \t]*\([ \t]*["'`]\/proc["'`]/u],
    ["other pid command line", /\/proc\/(?:\$\{[^}]+\}|[0-9]+)\/cmdline/u],
    ["ps invocation", /(?:^|[^A-Za-z0-9_$])(?:run|spawn|spawnSync)[ \t]*\([ \t]*["'`]ps["'`]/u],
    ["ps shell command", /(?:^|[^A-Za-z0-9_$])ps[ \t]+-[A-Za-z]/u],
    ["kill liveness probe", /process\.kill[ \t]*\([^,]+,[ \t]*0[ \t]*\)/u],
  ];
  return checks.filter(([, pattern]) => pattern.test(source)).map(([name]) => name);
}

async function startZombieChild(): Promise<{
  parent: ReturnType<typeof Bun.spawn>;
  childPid: number;
}> {
  const parent = Bun.spawn(["sh", "-c", "sleep 0.2 & echo $!; exec sleep 30"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!parent.stdout) throw new Error("shell stdout is unavailable");
  const reader = parent.stdout.getReader();
  let text = "";
  while (!text.includes("\n")) {
    const part = await reader.read();
    if (part.done) throw new Error("zombie child did not report its pid");
    text += new TextDecoder().decode(part.value);
  }
  const childPid = Number(text.split("\n", 1)[0]);
  if (!Number.isSafeInteger(childPid) || childPid <= 0) throw new Error("invalid child pid");
  return { parent, childPid };
}

function withProcRoot<T>(root: string | undefined, action: () => T): T {
  const previous = process.env.POSTMASTER_PROC_ROOT;
  if (root === undefined) delete process.env.POSTMASTER_PROC_ROOT;
  else process.env.POSTMASTER_PROC_ROOT = root;
  try {
    return action();
  } finally {
    if (previous === undefined) delete process.env.POSTMASTER_PROC_ROOT;
    else process.env.POSTMASTER_PROC_ROOT = previous;
  }
}

describe("portable process state", () => {
  for (const forced of [false, true]) {
    // macOS has no /proc, so the proc path cannot run there; the forced ps
    // path beside it covers the fallback the module takes instead.
    test.skipIf(!forced && process.platform === "darwin")(
      `${forced ? "forced ps path" : "proc path"} distinguishes live, zombie and reaped pids`,
      async () => {
        const absentRoot = join(import.meta.dir, `absent-${process.pid}-${Date.now()}`);
        const root = forced ? absentRoot : undefined;
        const { parent, childPid } = await startZombieChild();
        try {
          await Bun.sleep(350);
          const liveState = withProcRoot(root, () => processState(parent.pid));
          const liveStart = withProcRoot(root, () => processStart(parent.pid));
          const zombieState = withProcRoot(root, () => processState(childPid));
          expect(liveState).toBe("live");
          expect(liveStart).not.toBeNull();
          expect(liveStart!.split(/[ \t]+/u).length).toBe(forced ? 5 : 1);
          expect(zombieState).toBe("zombie");
          if (forced) {
            const info = withProcRoot(root, () => processInfo(parent.pid));
            const tableRow = withProcRoot(root, () => processTable().get(parent.pid));
            expect(info?.pid).toBe(parent.pid);
            expect(info?.group).toBeGreaterThan(0);
            // Session 0 is real: a launchd daemon's children sit in session 0,
            // which is what the macOS runner reports.
            expect(info?.session).toBeGreaterThanOrEqual(0);
            expect(tableRow?.pid).toBe(parent.pid);
            expect(tableRow?.start.split(/[ \t]+/u).length).toBe(5);
          }
        } finally {
          parent.kill("SIGKILL");
          await parent.exited;
        }
        const deadline = Date.now() + 5000;
        while (
          Date.now() < deadline &&
          withProcRoot(root, () => processState(childPid)) !== "absent"
        ) {
          await Bun.sleep(50);
        }
        expect(withProcRoot(root, () => processState(childPid))).toBe("absent");
      },
    );
  }

  test("portable start times always use the C locale", () => {
    const root = mkdtempSync(join(tmpdir(), "process-locale-"));
    const ps = join(root, "ps");
    writeFileSync(
      ps,
      [
        "#!/bin/sh",
        'case "$*" in',
        '  *stat=*) printf "S\\n" ;;',
        '  *lstart=*) if [ "${LC_ALL-}" = C ]; then printf "Tue Oct  4 12:34:56 2026\\n"; else printf "Mar oct  4 12:34:56 2026\\n"; fi ;;',
        "  *) exit 1 ;;",
        "esac",
        "",
      ].join("\n"),
    );
    chmodSync(ps, 0o755);
    const previousPath = process.env.PATH;
    const previousRoot = process.env.POSTMASTER_PROC_ROOT;
    process.env.PATH = `${root}:${previousPath ?? ""}`;
    process.env.POSTMASTER_PROC_ROOT = join(root, "missing-proc");
    try {
      expect(processStart(process.pid)).toBe("Tue Oct 4 12:34:56 2026");
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousRoot === undefined) delete process.env.POSTMASTER_PROC_ROOT;
      else process.env.POSTMASTER_PROC_ROOT = previousRoot;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("process probes live in this shared module", () => {
    const sources = scriptFiles(SCRIPTS).filter(
      (path) => path !== join(SCRIPTS, "lib/processes.ts"),
    );
    const paths = sources.map((path) => path.slice(SCRIPTS.length + 1));
    expect(paths).toContain("host-self-test.ts");
    expect(paths).toContain("host.ts");
    expect(paths.some((path) => path.endsWith("runs-status.ts"))).toBe(true);

    const probes = [
      "readFileSync(`/proc/${pid}/stat`, 'utf8')",
      "readdirSync('/proc')",
      "readFileSync(`/proc/${pid}/cmdline`, 'utf8')",
      "run('ps', ['-o', 'stat='])",
      "ps -o stat= -p $pid",
      "process.kill(pid, 0)",
    ];
    for (const path of sources) {
      const source = readFileSync(path, "utf8");
      expect(processProbeViolations(source)).toEqual([]);
      for (const probe of probes) {
        const found = processProbeViolations(`${source}\n${probe}`);
        expect(found.length).toBeGreaterThan(0);
      }
    }
    expect(processProbeViolations('readFileSync("/proc/self/cmdline")')).toEqual([]);
  });

  test("the ps queries use sess, which macOS accepts, never sid", () => {
    const source = readFileSync(join(SCRIPTS, "lib", "processes.ts"), "utf8");
    expect(source).toContain("sess=");
    expect(source).not.toContain("sid=");
  });

  test("an existing proc root with no pids falls through to ps", () => {
    const root = mkdtempSync(join(tmpdir(), "process-empty-root-"));
    try {
      withProcRoot(root, () => {
        const table = processTable();
        expect(table.size).toBeGreaterThan(0);
        expect(table.get(process.pid)?.state).toBe("live");
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the command-line listing names this process on both paths", () => {
    const live = processCommandLines();
    expect(live.size).toBeGreaterThan(0);
    expect(live.get(process.pid)?.length ?? 0).toBeGreaterThan(0);
    const root = mkdtempSync(join(tmpdir(), "process-lines-ps-"));
    try {
      withProcRoot(join(root, "missing-proc"), () => {
        const fallback = processCommandLines();
        expect(fallback.size).toBeGreaterThan(0);
        expect(fallback.get(process.pid)?.length ?? 0).toBeGreaterThan(0);
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the ps table keeps a multi-word command name whole", () => {
    const root = mkdtempSync(join(tmpdir(), "process-comm-"));
    const ps = join(root, "ps");
    writeFileSync(
      ps,
      [
        "#!/bin/sh",
        'printf "  12 34 56 78 90 S Tue Oct  4 12:34:56 2026 Google Chrome Helper\\n"',
        "",
      ].join("\n"),
    );
    chmodSync(ps, 0o755);
    const previousPath = process.env.PATH;
    const previousRoot = process.env.POSTMASTER_PROC_ROOT;
    process.env.PATH = `${root}:${previousPath ?? ""}`;
    process.env.POSTMASTER_PROC_ROOT = join(root, "missing-proc");
    try {
      expect(processTable().get(12)?.name).toBe("Google Chrome Helper");
      expect(processTable().get(12)?.terminal).toBe(90);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousRoot === undefined) delete process.env.POSTMASTER_PROC_ROOT;
      else process.env.POSTMASTER_PROC_ROOT = previousRoot;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("process info carries the terminal's foreground group on both backends", () => {
    const root = mkdtempSync(join(tmpdir(), "process-terminal-"));
    try {
      const dir = join(root, "1234");
      mkdirSync(dir);
      const stat = (tpgid: string): string =>
        `1234 (fake) R 1 7 7 0 ${tpgid} 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n`;
      writeFileSync(join(dir, "stat"), stat("42"));
      const fromProc = withProcRoot(root, () => processInfo(1234));
      expect(fromProc?.group).toBe(7);
      expect(fromProc?.terminal).toBe(42);
      writeFileSync(join(dir, "stat"), stat("-1"));
      expect(withProcRoot(root, () => processInfo(1234)?.terminal)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the ps backend reads the foreground group and its absence", () => {
    const root = mkdtempSync(join(tmpdir(), "process-terminal-ps-"));
    const ps = join(root, "ps");
    const row = (tpgid: string): void => {
      writeFileSync(
        ps,
        [
          "#!/bin/sh",
          `printf "  12 34 56 78 ${tpgid} S Tue Oct  4 12:34:56 2026 thing\\n"`,
          "",
        ].join("\n"),
      );
    };
    row("90");
    chmodSync(ps, 0o755);
    const previousPath = process.env.PATH;
    const previousRoot = process.env.POSTMASTER_PROC_ROOT;
    process.env.PATH = `${root}:${previousPath ?? ""}`;
    process.env.POSTMASTER_PROC_ROOT = join(root, "missing-proc");
    try {
      expect(processInfo(12)?.terminal).toBe(90);
      expect(processTable().get(12)?.terminal).toBe(90);
      row("-1");
      expect(processInfo(12)?.terminal).toBeNull();
      expect(processTable().get(12)?.terminal).toBeNull();
      row("-");
      expect(processInfo(12)?.terminal).toBeNull();
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousRoot === undefined) delete process.env.POSTMASTER_PROC_ROOT;
      else process.env.POSTMASTER_PROC_ROOT = previousRoot;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("live info always carries a terminal reading", () => {
    const info = processInfo(process.pid);
    expect(info).not.toBeNull();
    const t = info?.terminal;
    expect(t === null || (typeof t === "number" && t > 0)).toBe(true);
  });

  test("boot checks use the boot session UUID and keep legacy records across clock changes", () => {
    const root = mkdtempSync(join(tmpdir(), "process-boot-id-"));
    const sysctl = join(root, "sysctl");
    const state = join(root, "state");
    mkdirSync(state);
    writeFileSync(
      sysctl,
      [
        "#!/bin/sh",
        'case "$*" in',
        '  "-n kern.bootsessionuuid") [ -f "$BOOT_STATE/refuse-uuid" ] && exit 1; cat "$BOOT_STATE/uuid" ;;',
        '  "-n kern.boottime") printf \'{ sec = %s, usec = %s } %s\\n\' "$(cat "$BOOT_STATE/sec")" "$(cat "$BOOT_STATE/usec")" "$(cat "$BOOT_STATE/date")" ;;',
        "  *) exit 1 ;;",
        "esac",
        "",
      ].join("\n"),
    );
    chmodSync(sysctl, 0o755);
    const previousPath = process.env.PATH;
    const previousRoot = process.env.POSTMASTER_PROC_ROOT;
    const previousState = process.env.BOOT_STATE;
    process.env.PATH = `${root}:${previousPath ?? ""}`;
    process.env.POSTMASTER_PROC_ROOT = join(root, "missing-proc");
    process.env.BOOT_STATE = state;
    const bootText = (sec: string, usec: string, date: string): string => {
      writeFileSync(join(state, "sec"), `${sec}\n`);
      writeFileSync(join(state, "usec"), `${usec}\n`);
      writeFileSync(join(state, "date"), `${date}\n`);
      return `{ sec = ${sec}, usec = ${usec} } ${date}`;
    };
    try {
      writeFileSync(join(state, "uuid"), "session-a\n");
      const oldText = bootText("1800000000", "10", "Tue Nov 14 22:13:20 2026");
      const first = bootId();
      expect(first).toBe("session-a");
      expect(sameBoot(oldText, first)).toBe(true);

      bootText("1800000000", "987654", "Wed Nov 15 14:13:20 2026");
      const correctedClock = bootId();
      expect(correctedClock).toBe(first);
      expect(sameBoot(oldText, correctedClock)).toBe(true);

      writeFileSync(join(state, "uuid"), "session-b\n");
      bootText("1800000001", "1", "Wed Nov 15 14:13:21 2026");
      const restarted = bootId();
      expect(sameBoot(first, restarted)).toBe(false);
      expect(sameBoot(oldText, restarted)).toBe(false);

      writeFileSync(join(state, "refuse-uuid"), "");
      const fallback = bootId();
      expect(fallback).toBe("1800000001");
      expect(sameBoot("{ sec = 1800000001, usec = 999 } Mon Jan 1 00:00:00 2024", fallback)).toBe(
        true,
      );
      expect(sameBoot(oldText, fallback)).toBe(false);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousRoot === undefined) delete process.env.POSTMASTER_PROC_ROOT;
      else process.env.POSTMASTER_PROC_ROOT = previousRoot;
      if (previousState === undefined) delete process.env.BOOT_STATE;
      else process.env.BOOT_STATE = previousState;
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("boot identity without a proc tree, as macOS reads it", () => {
  // A stub sysctl, so the fallback is proved on any machine: the stub answers
  // boottime the way macOS would and refuses the session uuid, forced the way
  // macOS reads it.
  const stubbed = <T>(root: string, action: () => T): T => {
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    const sysctl = join(bin, "sysctl");
    writeFileSync(
      sysctl,
      [
        "#!/bin/sh",
        'case "$*" in',
        "  *kern.boottime*) printf '{ sec = 1760000000, usec = 0 } Sun Oct  5 00:00:00 2025\\n' ;;",
        "  *) exit 1 ;;",
        "esac",
        "",
      ].join("\n"),
    );
    chmodSync(sysctl, 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${bin}:${previousPath ?? ""}`;
    try {
      return withProcRoot(join(root, "missing-proc"), action);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  };

  test("the boot id falls back to sysctl seconds when the session uuid refuses", () => {
    const root = mkdtempSync(join(tmpdir(), "process-noboot-"));
    try {
      const real = bootId();
      const forced = stubbed(root, () => bootId(join(root, "missing-proc")));
      expect(forced).toBe("1760000000");
      expect(forced).not.toBe(real);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the boot time falls back to sysctl, two words past sec", () => {
    const root = mkdtempSync(join(tmpdir(), "process-noboot-"));
    try {
      const forced = stubbed(root, () => bootTime(join(root, "missing-proc")));
      expect(forced).toBe(1760000000);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
