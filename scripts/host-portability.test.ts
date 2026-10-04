import { expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processState } from "./lib/process-state.ts";

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
        const timeout = setTimeout(() => reject(new Error("shell did not print its child pid")), 5000);
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
