import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processInfo, processStart, processState, processTable } from "./process-state.ts";

const SCRIPTS = join(import.meta.dir, "..");

function scriptFiles(directory: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const info = statSync(path);
    if (info.isDirectory()) files.push(...scriptFiles(path));
    else if (
      /\.(?:js|mjs|py|sh|ts)$/u.test(name) &&
      path !== join(SCRIPTS, "lib", "process-state.test.ts")
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
    test(`${forced ? "forced ps path" : "proc path"} distinguishes live, zombie and reaped pids`, async () => {
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
          expect(info?.session).toBeGreaterThan(0);
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
    }, 10000);
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
      (path) => path !== join(SCRIPTS, "lib/process-state.ts"),
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
});
