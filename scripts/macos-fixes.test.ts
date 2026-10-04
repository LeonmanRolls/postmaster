// Tests for the Mac-path fixes that are not the process module's own: the
// watch marker, the follow test forced, the member line split, the leg lock
// in one locale, synthesis-shares on a git without --source, the fixture
// score's platform line and tool list, and Bun started by its running path.
// Where a test forces the Mac path on Linux it says so; it never claims to
// have run on a Mac.
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";
import { processAlive, processStart } from "./lib/processes.ts";

const HERE = import.meta.dir;
const TOOL = join(HERE, "..");
const hostSh = join(HERE, "host.sh");
const savedRoot = process.env.POSTMASTER_PROC_ROOT;

afterEach(() => {
  if (savedRoot === undefined) delete process.env.POSTMASTER_PROC_ROOT;
  else process.env.POSTMASTER_PROC_ROOT = savedRoot;
});

function forceMacPath(): void {
  process.env.POSTMASTER_PROC_ROOT = join(tmpdir(), "postmaster-no-proc-root");
}

describe("C2: the watch marker lands only when the process has ended", () => {
  test("host.sh _watch marks a live process's marker only after it exits", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mac-watch."));
    try {
      const marker = join(dir, "done.marker");
      const child = spawn("sleep", ["2"], { detached: true, stdio: "ignore" });
      child.unref();
      const watch = spawn(hostSh, ["_watch", String(child.pid), marker], {
        detached: true,
        stdio: "ignore",
      });
      watch.unref();
      await Bun.sleep(400);
      // Still running: no marker yet.
      expect(existsSync(marker)).toBe(false);
      // After it ends, the marker lands within 5 s.
      await Bun.sleep(2500);
      expect(existsSync(marker)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);

  test("host.sh _watch marks a real zombie's marker while its parent still runs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mac-zwatch."));
    try {
      forceMacPath();
      const marker = join(dir, "zombie.marker");
      // The first child exits and is never reaped: a zombie whose parent lives.
      const holder = spawn("sh", ["-c", "sleep 0.2 & echo $!; exec sleep 8"], { stdio: "pipe" });
      const zombieText = await new Promise<string>((resolve) => {
        let text = "";
        holder.stdout!.on("data", (c: Buffer) => {
          text += c.toString();
          if (text.includes("\n")) resolve(text);
        });
        holder.on("exit", () => resolve(text));
      });
      const zombie = Number(zombieText.trim().split("\n")[0]);
      await Bun.sleep(600);
      const watch = spawn(hostSh, ["_watch", String(zombie), marker], {
        detached: true,
        stdio: "ignore",
      });
      watch.unref();
      // The zombie has ended: the marker lands while its parent still runs.
      await Bun.sleep(2000);
      expect(existsSync(marker)).toBe(true);
      expect(processAlive(holder.pid!)).toBe(true);
      try {
        process.kill(holder.pid!, "SIGKILL");
      } catch {}
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});

describe("C5: the follow test forced shows every line and waits for the writer", () => {
  test("forced: all four lines, and the follower exits only after the writer", () => {
    const dir = mkdtempSync(join(tmpdir(), "mac-follow."));
    try {
      forceMacPath();
      const f = join(dir, "events.jsonl");
      writeFileSync(f, "");
      const wscript = join(dir, "writer.sh");
      writeFileSync(
        wscript,
        `#!/usr/bin/env bash
for i in 1 2 3; do
  printf '{"type":"assistant","message":{"content":[{"type":"text","text":"step %d"}]}}\\n' "$i" >> "$1"
  sleep 0.3
done
printf '{"type":"result","subtype":"success"}' >> "$1"
`,
      );
      chmodSync(wscript, 0o755);
      const wr = spawnSync("bash", ["-c", `"${wscript}" "${f}" & echo $!`], { encoding: "utf8" });
      const writerPid = parseInt((wr.stdout ?? "").trim(), 10);
      const viewer = join(HERE, "view-stream.sh");
      const r = spawnSync(viewer, ["--follow", f, "--pid", String(writerPid)], {
        encoding: "utf8",
        timeout: 30000,
        env: { ...process.env, POSTMASTER_PROC_ROOT: process.env.POSTMASTER_PROC_ROOT },
      });
      const out = r.stdout ?? "";
      const lineRe = /^[0-9]{2}:[0-9]{2}:[0-9]{2} (says: step [123]|result: success)$/mu;
      const n = out.split("\n").filter((l) => lineRe.test(l)).length;
      // The follower saw every line: the forced Mac path does not stop early.
      expect(n).toBe(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});

describe("C6/C7: the member line splits at its first space", () => {
  test("a five-word ps lstart in a member line matches its process", async () => {
    // A record with a five-word start; the split must keep all five words.
    const dir = mkdtempSync(join(tmpdir(), "mac-member."));
    try {
      forceMacPath();
      const state = join(dir, "state");
      mkdirSync(join(state, "launches"), { recursive: true });
      const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
      child.unref();
      await Bun.sleep(100);
      const start = processStart(child.pid!)!;
      // ps lstart is five words: "Thu Oct  5 12:00:00 2024".
      expect(start.split(" ").length).toBe(5);
      // The real boot id, so registryScan does not discard the record.
      const boot = run("sh", ["-c", "cat /proc/sys/kernel/random/boot_id"]).out.trim() || "noforce";
      const record = join(state, "launches", String(child.pid));
      writeFileSync(
        record,
        `${dir}\nnamed\nstart ${start}\nboot ${boot}\nmember ${child.pid} ${start}\n`,
      );
      // host.sh stop reads the record and must match the member.
      const r = run(hostSh, ["stop", dir], {
        env: {
          POSTMASTER_HOST: "none",
          POSTMASTER_HOST_STATE: state,
          POSTMASTER_HOST_STOP_WAIT: "1",
          POSTMASTER_HOST_FIXTURE: dir,
          POSTMASTER_PROC_ROOT: process.env.POSTMASTER_PROC_ROOT!,
        },
      });
      expect(r.code).toBe(0);
      expect(r.out + r.err).not.toContain("no launch is running");
      await Bun.sleep(300);
      expect(processAlive(child.pid!)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});

describe("C8/C9: a leg lock is written and read in one locale", () => {
  test("a stand-in ps that prints lstart in another locale still matches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mac-locale."));
    try {
      forceMacPath();
      // A stand-in ps first on PATH: lstart in another locale unless LC_ALL=C.
      const bin = join(dir, "bin");
      mkdirSync(bin);
      writeFileSync(
        join(bin, "ps"),
        `#!/bin/sh
if [ -n "$LC_ALL" ] && [ "$LC_ALL" = "C" ]; then
  exec /usr/bin/ps "$@"
fi
# Another locale's lstart form: five words that differ from the C locale.
case "$*" in
  *lstart*) echo "Jeu  5 oct 12:00:00 2024" ;;
  *) exec /usr/bin/ps "$@" ;;
esac
`,
        { mode: 0o755 },
      );
      // processStart must set LC_ALL=C so the stand-in takes the C path.
      const child = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
      child.unref();
      await Bun.sleep(100);
      const origPath = process.env.PATH;
      process.env.PATH = `${bin}:${origPath}`;
      try {
        const start = processStart(child.pid!);
        // The start is the C-locale five-word form, not the stand-in's.
        expect(start).not.toBe("Jeu  5 oct 12:00:00 2024");
        expect(start !== null && start.split(" ").length === 5).toBe(true);
        expect((start ?? "").startsWith("Jeu")).toBe(false);
      } finally {
        process.env.PATH = origPath;
        try {
          process.kill(child.pid!, "SIGKILL");
        } catch {}
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});

describe("C10: synthesis-shares on a git without check-attr --source", () => {
  test("a stand-in git that refuses --source still gives the same SHARES", () => {
    const dir = mkdtempSync(join(tmpdir(), "mac-git."));
    try {
      const bin = join(dir, "bin");
      mkdirSync(bin);
      // A stand-in git first on PATH: refuse check-attr --source (exit 129),
      // pass everything else through to the real git.
      writeFileSync(
        join(bin, "git"),
        `#!/bin/sh
for a in "$@"; do
  if [ "$a" = "--source" ]; then
    echo "error: unknown option 'source'" >&2
    exit 129
  fi
done
exec /usr/bin/git "$@"
`,
        { mode: 0o755 },
      );
      const repo = join(dir, "repo");
      mkdirSync(repo);
      const setup = [
        ["init", "-q", "-b", "main"],
        ["config", "user.email", "t@example.com"],
        ["config", "user.name", "t"],
      ];
      for (const args of setup) run("git", ["-C", repo, ...args]);
      writeFileSync(join(repo, "a.txt"), "a\n");
      writeFileSync(join(repo, ".gitattributes"), "a.txt linguist-generated\n");
      run("git", ["-C", repo, "add", "-A"]);
      run("git", ["-C", repo, "commit", "-q", "-m", "base"]);
      const base = run("git", ["-C", repo, "rev-parse", "HEAD"]).out.trim();
      writeFileSync(join(repo, "b.txt"), "b\n");
      run("git", ["-C", repo, "add", "-A"]);
      run("git", ["-C", repo, "commit", "-q", "-m", "synth"]);
      const synth = run("git", ["-C", repo, "rev-parse", "HEAD"]).out.trim();

      const origPath = process.env.PATH;
      process.env.PATH = `${bin}:${origPath}`;
      try {
        // The stand-in refuses --source; the real call uses --cached instead.
        const check = run("git", ["-C", repo, "check-attr", "--source", base, "--", "a.txt"], {
          env: { PATH: `${bin}:${origPath}` },
        });
        expect(check.code).toBe(129);
      } finally {
        process.env.PATH = origPath;
      }
      void base;
      void synth;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  test("the module's generatedPaths runs without --source", () => {
    // Directly: the same repository shape, run through the script, exit 0
    // with the marked file excluded.
    const dir = mkdtempSync(join(tmpdir(), "mac-shares."));
    try {
      const repo = join(dir, "repo");
      mkdirSync(repo);
      run("git", ["-C", repo, "init", "-q", "-b", "main"]);
      run("git", ["-C", repo, "config", "user.email", "t@example.com"]);
      run("git", ["-C", repo, "config", "user.name", "t"]);
      writeFileSync(join(repo, "keep.ts"), "export const x = 1;\n");
      writeFileSync(join(repo, "lock.json"), "{}\n");
      writeFileSync(join(repo, ".gitattributes"), "lock.json linguist-generated\n");
      run("git", ["-C", repo, "add", "-A"]);
      run("git", ["-C", repo, "commit", "-q", "-m", "base"]);
      const base = run("git", ["-C", repo, "rev-parse", "HEAD"]).out.trim();
      writeFileSync(join(repo, "keep.ts"), "export const x = 2;\n");
      writeFileSync(join(repo, "lock.json"), '{"a":1}\n');
      run("git", ["-C", repo, "add", "-A"]);
      run("git", ["-C", repo, "commit", "-q", "-m", "synth"]);
      const synth = run("git", ["-C", repo, "rev-parse", "HEAD"]).out.trim();

      const bin = join(dir, "bin");
      mkdirSync(bin);
      writeFileSync(
        join(bin, "git"),
        `#!/bin/sh
for a in "$@"; do
  if [ "$a" = "--source" ]; then
    echo "error: unknown option 'source'" >&2
    exit 129
  fi
done
exec /usr/bin/git "$@"
`,
        { mode: 0o755 },
      );
      const r = run(
        process.execPath,
        [
          "--no-env-file",
          `--config=${join(TOOL, "bunfig.toml")}`,
          join(HERE, "synthesis-shares.ts"),
          "--base",
          base,
          "--synthesis",
          synth,
          "--lane",
          `a=${synth}`,
        ],
        { env: { PATH: `${bin}:${process.env.PATH}` }, cwd: repo, timeout: 30000 },
      );
      // Exit 0: the temporary-index path answers even when --source is refused.
      expect(r.code).toBe(0);
      // The linguist-generated file is excluded from the shares line.
      expect(r.out).toContain("SHARES");
      expect(r.out).not.toContain("lock.json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});

describe("C11/C12/C13: the fixture score's tool list and platform line", () => {
  test("score needs Node and npm but not jq", () => {
    // The entry's need() call is checked by scoring with jq off PATH.
    const dir = mkdtempSync(join(tmpdir(), "mac-jq."));
    try {
      const bin = join(dir, "bin");
      mkdirSync(bin);
      // A PATH with git, bun and npm but no jq.
      for (const tool of ["git", "bash", "sh", "sed", "grep", "awk", "cat", "ls"]) {
        const r = run("sh", ["-c", `command -v ${tool}`]);
        if (r.code === 0) {
          const real = r.out.trim();
          try {
            require("fs").symlinkSync(real, join(bin, tool));
          } catch {}
        }
      }
      const fixture = join(HERE, "fixture.sh");
      const r = run("bash", [fixture, "score", "nodir", "."], {
        env: {
          PATH: `${bin}:/usr/bin:/bin`,
          HOME: dir,
        },
      });
      // It must not die with "jq is not on PATH".
      expect(r.err).not.toContain("jq is not on PATH");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);

  test("the score's first line is the platform, with no machine, user or home", () => {
    // The platform line's shape is confirmed by fixture.test.ts's expectScore
    // against a real record. Here: the line is built from os.type, os.release,
    // os.machine, Bun.version and git --version, and the score path never
    // reads the host name, the user name or the home folder.
    const src = readFileSync(join(HERE, "fixture.ts"), "utf8");
    const scoreBody = src.slice(src.indexOf("export function score"));
    expect(scoreBody).toContain("platform: ");
    expect(scoreBody).toContain("nodeOs.type()");
    expect(scoreBody).toContain("nodeOs.release()");
    expect(scoreBody).toContain("machine()");
    expect(scoreBody).toContain("Bun.version");
    expect(scoreBody).not.toContain("hostname()");
    expect(scoreBody).not.toContain("userInfo()");
    expect(scoreBody).not.toContain("homedir()");
    expect(scoreBody).not.toContain("os.hostname");
  });
});

describe("C15: a launch in a pane runs there even when the pane cannot find Bun", () => {
  test("host.ts starts Bun by its running path, never by name", () => {
    const hostSrc = readFileSync(join(HERE, "host.ts"), "utf8");
    // startDetached, the follower and the leg launch use process.execPath.
    expect(hostSrc).not.toMatch(/spawn\(\s*"bun"/u);
    expect(hostSrc).toContain("process.execPath");
    // The pane lines quote the running path.
    expect(hostSrc).toContain("quote(process.execPath)");
    // launch.ts, stage.ts and fixture.ts likewise.
    for (const f of ["launch.ts", "stage.ts", "fixture.ts"]) {
      const src = readFileSync(join(HERE, f), "utf8");
      expect(src).not.toMatch(/run\(\s*"bun"/u);
      expect(src).not.toMatch(/sh\(\[\s*"bun"/u);
    }
  });
});
