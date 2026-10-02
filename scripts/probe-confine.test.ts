import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./lib/proc.ts";

const SELF = join(import.meta.dir, "probe-confine.sh");
const ubuntu = 'ID=ubuntu\nVERSION_ID="24.04"\n';
let root = "";

beforeAll(() => {
  root = mkdtempSync(join(import.meta.dir, ".probe-confine-test-"));
});

afterAll(() => {
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    for (const file of readdirSync(dir)) unlinkSync(join(dir, file));
    rmdirSync(dir);
  }
  rmdirSync(root);
});

function makeBin(name: string, tools: Record<string, number>): string {
  const bin = join(root, name);
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, "bun"));
  symlinkSync("/usr/bin/dirname", join(bin, "dirname"));
  for (const [tool, exit] of Object.entries(tools)) {
    const path = join(bin, tool);
    writeFileSync(path, `#!/bin/sh\nexit ${exit}\n`, "utf8");
    chmodSync(path, 0o755);
  }
  return bin;
}

function probe(bin: string, platform: string, args: string[] = [], sysctl = "0", release = ubuntu) {
  return run("/bin/bash", [SELF, ...args], {
    env: {
      PATH: bin,
      POSTMASTER_PROBE_PLATFORM: platform,
      POSTMASTER_PROBE_SYSCTL: sysctl,
      POSTMASTER_PROBE_OS_RELEASE: release,
    },
  });
}

describe("lane confinement probe controls", () => {
  test("ready: Bubblewrap can start with every Linux tool present", () => {
    const bin = makeBin("linux-ready", { bwrap: 0, socat: 0, rg: 0 });
    const result = probe(bin, "linux", [], "1");
    const verdict = probe(bin, "linux", ["--verdict"], "1");
    expect(result.code).toBe(0);
    expect(result.out).toContain("NEED");
    expect(result.out).toContain("lane confinement: ready");
    expect(result.out).toContain("Bubblewrap launch succeeds");
    expect(verdict.code).toBe(0);
    expect(verdict.out).toBe("ready\n");
  });

  test("partial: missing packages have one apt-get install command", () => {
    const bin = makeBin("linux-packages", { bwrap: 0, socat: 0, "apt-get": 0 });
    const result = probe(bin, "linux");
    const verdict = probe(bin, "linux", ["--verdict"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("lane confinement: partial");
    expect(result.out).toContain("sudo apt-get install ripgrep");
    expect(verdict.out).toBe("partial\n");
  });

  test("unavailable: missing package without a known manager has no invented command", () => {
    const bin = makeBin("linux-no-manager", { bwrap: 0, socat: 0 });
    const result = probe(bin, "linux");
    const verdict = probe(bin, "linux", ["--verdict"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("lane confinement: unavailable");
    expect(result.out).toContain("No known package manager");
    expect(result.out).not.toContain("sudo apt-get install");
    expect(verdict.out).toBe("unavailable\n");
  });

  test("restricted Ubuntu names the bwrap-only AppArmor rule and activation", () => {
    const bin = makeBin("ubuntu-restricted", { bwrap: 1, socat: 0, rg: 0 });
    const result = probe(bin, "linux", [], "1");
    expect(result.code).toBe(0);
    expect(result.out).toContain("lane confinement: partial");
    expect(result.out).toContain("profile bwrap /usr/bin/bwrap flags=(unconfined)");
    expect(result.out).toContain("  userns,");
    expect(result.out).toContain("sudo apparmor_parser -r /etc/apparmor.d/bwrap");
    expect(result.out).toContain("The user runs");
  });

  test("failed Bubblewrap launch without the Ubuntu remedy is unavailable", () => {
    const bin = makeBin("linux-unknown-failure", { bwrap: 1, socat: 0, rg: 0 });
    const result = probe(bin, "linux", [], "1", 'ID=debian\nVERSION_ID="13"\n');
    expect(result.code).toBe(0);
    expect(result.out).toContain("lane confinement: unavailable");
    expect(result.out).not.toContain("sudo tee /etc/apparmor.d/bwrap");
  });

  test("macOS with sandbox-exec and ripgrep is ready and marked untried", () => {
    const bin = makeBin("mac-ready", { "sandbox-exec": 0, rg: 0 });
    const result = probe(bin, "darwin");
    const verdict = probe(bin, "darwin", ["--verdict"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("lane confinement: ready");
    expect(result.out).toContain("macOS lane confinement has not been tried");
    expect(verdict.out).toBe("ready\n");
  });

  test("macOS missing ripgrep names Homebrew when present", () => {
    const bin = makeBin("mac-homebrew", { "sandbox-exec": 0, brew: 0 });
    const result = probe(bin, "darwin");
    expect(result.code).toBe(0);
    expect(result.out).toContain("lane confinement: partial");
    expect(result.out).toContain("brew install ripgrep");
    expect(result.out).toContain("macOS lane confinement has not been tried");
  });
});
