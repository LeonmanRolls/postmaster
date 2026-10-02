// Controls for probe-confine.ts: one for each verdict, ready, partial and unavailable,
// each forced through stubbed tools on PATH and the probe's test seams. The same lookups
// every time; a control that could have come out the other way.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";

const SELF = join(import.meta.dir, "probe-confine.sh");

let tmp = "";

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "postmaster-confine-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** A directory of stub tools on an isolated PATH: only these look like installed. */
function stubBin(name: string, tools: string[], fail: string[] = []): string {
  const bin = join(tmp, name);
  mkdirSync(bin, { recursive: true });
  for (const tool of tools) {
    const p = join(bin, tool);
    if (fail.includes(tool)) {
      writeFileSync(
        p,
        "#!/bin/sh\necho 'bwrap: No permissions to create new namespace' >&2\nexit 1\n",
        "utf8",
      );
    } else {
      writeFileSync(p, "#!/bin/sh\nexit 0\n", "utf8");
    }
    chmodSync(p, 0o755);
  }
  return bin;
}

function probe(bin: string, env: Record<string, string> = {}): { code: number; out: string } {
  const args = env.VERDICT === "1" ? ["--verdict"] : [];
  // Run the .ts by absolute bun path with PATH holding only the stubs, so a tool
  // this control wants missing stays missing even when the host has it.
  const bunBin = Bun.which("bun") ?? "bun";
  const ts = join(import.meta.dir, "probe-confine.ts");
  const r = run(bunBin, [ts, ...args], {
    env: { PATH: bin, ...env },
  });
  return { code: r.code, out: r.out + r.err };
}

describe("the probe says ready, partial or unavailable", () => {
  test("ready: every tool on PATH and the launch works", () => {
    const bin = stubBin("ready", ["bwrap", "socat", "rg", "apt-get"]);
    const t = probe(bin, { POSTMASTER_PROBE_PLATFORM: "linux", POSTMASTER_PROBE_SYSCTL: "0" });
    expect(t.code).toBe(0);
    expect(t.out).toContain("lane confinement: ready");
    const v = probe(bin, {
      POSTMASTER_PROBE_PLATFORM: "linux",
      POSTMASTER_PROBE_SYSCTL: "0",
      VERDICT: "1",
    });
    expect(v.out.trim()).toBe("ready");
  });

  test("partial: a package is missing names the install command", () => {
    const bin = stubBin("partial-pkg", ["bwrap", "socat", "apt-get"]);
    const t = probe(bin, { POSTMASTER_PROBE_PLATFORM: "linux", POSTMASTER_PROBE_SYSCTL: "0" });
    expect(t.code).toBe(0);
    expect(t.out).toContain("lane confinement: partial");
    expect(t.out).toContain("apt-get install");
    expect(t.out).toContain("ripgrep");
    const v = probe(bin, {
      POSTMASTER_PROBE_PLATFORM: "linux",
      POSTMASTER_PROBE_SYSCTL: "0",
      VERDICT: "1",
    });
    expect(v.out.trim()).toBe("partial");
  });

  test("partial: restricted user namespaces name the AppArmor rule", () => {
    const bin = stubBin("partial-aa", ["bwrap", "socat", "rg", "apt-get"], ["bwrap"]);
    const t = probe(bin, { POSTMASTER_PROBE_PLATFORM: "linux", POSTMASTER_PROBE_SYSCTL: "1" });
    expect(t.code).toBe(0);
    expect(t.out).toContain("lane confinement: partial");
    expect(t.out).toContain("/etc/apparmor.d/bwrap");
    expect(t.out).toContain("userns,");
    expect(t.out).toContain("apparmor_parser");
    expect(t.out.toLowerCase()).toContain("root");
  });

  test("unavailable: a missing package with no package manager this probe knows", () => {
    const bin = stubBin("unavail", ["bwrap", "socat"]);
    const t = probe(bin, { POSTMASTER_PROBE_PLATFORM: "linux", POSTMASTER_PROBE_SYSCTL: "0" });
    expect(t.code).toBe(0);
    expect(t.out).toContain("lane confinement: unavailable");
    const v = probe(bin, {
      POSTMASTER_PROBE_PLATFORM: "linux",
      POSTMASTER_PROBE_SYSCTL: "0",
      VERDICT: "1",
    });
    expect(v.out.trim()).toBe("unavailable");
  });

  test("macOS: sandbox-exec and ripgrep present says ready and that it was not tried", () => {
    const bin = stubBin("mac-ready", ["sandbox-exec", "rg", "brew"]);
    const t = probe(bin, { POSTMASTER_PROBE_PLATFORM: "darwin" });
    expect(t.code).toBe(0);
    expect(t.out).toContain("lane confinement: ready");
    expect(t.out).toContain("macOS has not been tried");
  });

  test("macOS: missing ripgrep with Homebrew names brew install ripgrep", () => {
    const bin = stubBin("mac-partial", ["sandbox-exec", "brew"]);
    const t = probe(bin, { POSTMASTER_PROBE_PLATFORM: "darwin" });
    expect(t.code).toBe(0);
    expect(t.out).toContain("lane confinement: partial");
    expect(t.out).toContain("brew install ripgrep");
    expect(t.out).toContain("macOS has not been tried");
  });

  test("macOS: missing sandbox-exec is unavailable", () => {
    const bin = stubBin("mac-unavail", ["rg", "brew"]);
    const t = probe(bin, { POSTMASTER_PROBE_PLATFORM: "darwin" });
    expect(t.code).toBe(0);
    expect(t.out).toContain("lane confinement: unavailable");
    expect(t.out).toContain("macOS has not been tried");
  });

  test("the .sh wrapper runs the probe and the --verdict form", () => {
    // Host PATH so the wrapper finds bun; the real machine's tools decide the verdict.
    const t = run("bash", [SELF], { env: { ...(process.env as Record<string, string>) } });
    expect(t.code).toBe(0);
    expect(t.out + t.err).toContain("lane confinement:");
    const v = run("bash", [SELF, "--verdict"], { env: { ...(process.env as Record<string, string>) } });
    expect(v.code).toBe(0);
    expect(["ready", "partial", "unavailable"]).toContain((v.out + v.err).trim());
  });
});
