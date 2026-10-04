// Controls for probe-confine.ts: one for each verdict, ready, partial and unavailable,
// each forced through stubbed tools on PATH and the probe's test seams. The same lookups
// every time; a control that could have come out the other way.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { run } from "./lib/proc.ts";
import {
  isSafeProfilePath,
  isSecureBwrapPath,
  parseRestrictedUserns,
  readRestrictedUsernsFile,
} from "./probe-confine.ts";

const SELF = join(import.meta.dir, "run");
const UBUNTU_2404 = 'ID=ubuntu\nVERSION_ID="24.04"\n';
const DEBIAN_13 = 'ID=debian\nVERSION_ID="13"\n';

let tmp = "";

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "postmaster-confine-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** A directory of stub tools on an isolated PATH: only these look like installed. */
function stubBin(name: string, tools: Record<string, number>): string {
  const bin = join(tmp, name);
  mkdirSync(bin, { recursive: true });
  // The entry needs bun, dirname and bash; the probe below runs it with this PATH.
  for (const link of ["bun", "dirname", "bash"] as const) {
    const target =
      link === "bun" ? process.execPath : link === "bash" ? "/bin/bash" : "/usr/bin/dirname";
    writeFileSync(join(bin, link), `#!/bin/sh\nexec ${target} "$@"\n`, "utf8");
    chmodSync(join(bin, link), 0o755);
  }
  for (const [tool, exit] of Object.entries(tools)) {
    const p = join(bin, tool);
    const body =
      tool === "bwrap" && exit !== 0
        ? "#!/bin/sh\necho 'bwrap: No permissions to create new namespace' >&2\nexit 1\n"
        : `#!/bin/sh\nexit ${exit}\n`;
    writeFileSync(p, body, "utf8");
    chmodSync(p, 0o755);
  }
  return bin;
}

function probe(
  bin: string,
  platform: string,
  args: string[] = [],
  sysctl = "0",
  release: string = UBUNTU_2404,
  apparmor = "0",
  secure = "1",
): { code: number; out: string } {
  const r = run(SELF, ["probe-confine", ...args], {
    env: {
      PATH: bin,
      POSTMASTER_PROBE_PLATFORM: platform,
      POSTMASTER_PROBE_SYSCTL: sysctl,
      POSTMASTER_PROBE_OS_RELEASE: release,
      POSTMASTER_PROBE_APPARMOR_PROFILE: apparmor,
      POSTMASTER_PROBE_BWRAP_SECURE: secure,
    },
  });
  return { code: r.code, out: r.out + r.err };
}

describe("the probe says ready, partial or unavailable", () => {
  test("ready: the launch decides, not the sysctl alone", () => {
    const bin = stubBin("linux-ready", { bwrap: 0, socat: 0, rg: 0 });
    const t = probe(bin, "linux", [], "1");
    expect(t.code).toBe(0);
    expect(t.out).toContain("lane confinement: ready");
    expect(t.out).toContain("Bubblewrap launch succeeds");
    const v = probe(bin, "linux", ["--verdict"], "1");
    expect(v.code).toBe(0);
    expect(v.out).toBe("ready\n");
  });

  test("partial: a missing package names one install command", () => {
    const bin = stubBin("linux-packages", { bwrap: 0, socat: 0, "apt-get": 0 });
    const t = probe(bin, "linux");
    expect(t.code).toBe(0);
    expect(t.out).toContain("lane confinement: partial");
    expect(t.out).toContain("sudo apt-get install ripgrep");
    const v = probe(bin, "linux", ["--verdict"]);
    expect(v.out).toBe("partial\n");
  });

  test("unavailable: a missing package with no known manager", () => {
    const bin = stubBin("linux-no-manager", { bwrap: 0, socat: 0 });
    const t = probe(bin, "linux");
    expect(t.code).toBe(0);
    expect(t.out).toContain("lane confinement: unavailable");
    expect(t.out).toContain("No known package manager");
    expect(t.out).not.toContain("sudo apt-get install");
    const v = probe(bin, "linux", ["--verdict"]);
    expect(v.out).toBe("unavailable\n");
  });

  test("restricted Ubuntu names the bwrap-only AppArmor rule and activation", () => {
    const bin = stubBin("ubuntu-restricted", { bwrap: 1, socat: 0, rg: 0 });
    const t = probe(bin, "linux", [], "1");
    expect(t.code).toBe(0);
    expect(t.out).toContain("lane confinement: partial");
    expect(t.out).toContain(`profile bwrap ${join(bin, "bwrap")} flags=(unconfined)`);
    expect(t.out).toContain("  userns,");
    expect(t.out).toContain("sudo apparmor_parser -r /etc/apparmor.d/bwrap");
    expect(t.out).toContain("The user runs");
  });

  test("a failed launch with the profile already in place is unavailable", () => {
    const bin = stubBin("ubuntu-profile-present", { bwrap: 1, socat: 0, rg: 0 });
    const t = probe(bin, "linux", [], "1", UBUNTU_2404, "1");
    expect(t.code).toBe(0);
    expect(t.out).toContain("lane confinement: unavailable");
    expect(t.out).toContain("already in place");
    expect(t.out).toContain("No permissions to create new namespace");
    expect(t.out).not.toContain("sudo tee /etc/apparmor.d/bwrap");
    const v = probe(bin, "linux", ["--verdict"], "1", UBUNTU_2404, "1");
    expect(v.out).toBe("unavailable\n");
  });

  test("a bwrap path that cannot go in a profile is unavailable", () => {
    const bin = stubBin("ubuntu spaced path", { bwrap: 1, socat: 0, rg: 0 });
    const t = probe(bin, "linux", [], "1");
    expect(t.code).toBe(0);
    expect(t.out).toContain("lane confinement: unavailable");
    expect(t.out).toContain("cannot go in the AppArmor rule");
    expect(t.out).not.toContain("sudo tee /etc/apparmor.d/bwrap");
  });

  test("a replaceable bwrap declines the root rule", () => {
    const bin = stubBin("ubuntu-writable", { bwrap: 1, socat: 0, rg: 0 });
    const t = probe(bin, "linux", [], "1", UBUNTU_2404, "0", "0");
    expect(t.code).toBe(0);
    expect(t.out).toContain("lane confinement: unavailable");
    expect(t.out).toContain("can be replaced after the rule is written");
    expect(t.out).not.toContain("sudo tee /etc/apparmor.d/bwrap");
    const v = probe(bin, "linux", ["--verdict"], "1", UBUNTU_2404, "0", "0");
    expect(v.out).toBe("unavailable\n");
  });

  test("the rule block pastes: its heredoc terminator starts the line", () => {
    const bin = stubBin("ubuntu-paste", { bwrap: 1, socat: 0, rg: 0 });
    const t = probe(bin, "linux", [], "1");
    expect(t.code).toBe(0);
    expect(t.out).toContain("\nEOF\n");
  });

  test("a failed launch without the Ubuntu remedy is unavailable", () => {
    const bin = stubBin("linux-unknown-failure", { bwrap: 1, socat: 0, rg: 0 });
    const t = probe(bin, "linux", [], "1", DEBIAN_13);
    expect(t.code).toBe(0);
    expect(t.out).toContain("lane confinement: unavailable");
    expect(t.out).toContain("No permissions to create new namespace");
    expect(t.out).not.toContain("sudo tee /etc/apparmor.d/bwrap");
  });

  test("macOS with sandbox-exec and ripgrep is ready and marked untried", () => {
    const bin = stubBin("mac-ready", { "sandbox-exec": 0, rg: 0 });
    const t = probe(bin, "darwin");
    expect(t.code).toBe(0);
    expect(t.out).toContain("lane confinement: ready");
    expect(t.out).toContain("macOS has not been tried");
    const v = probe(bin, "darwin", ["--verdict"]);
    expect(v.out).toBe("ready\n");
  });

  test("macOS missing ripgrep names Homebrew when present", () => {
    const bin = stubBin("mac-homebrew", { "sandbox-exec": 0, brew: 0 });
    const t = probe(bin, "darwin");
    expect(t.code).toBe(0);
    expect(t.out).toContain("lane confinement: partial");
    expect(t.out).toContain("brew install ripgrep");
    expect(t.out).toContain("macOS has not been tried");
  });

  test("macOS missing sandbox-exec is unavailable", () => {
    const bin = stubBin("mac-unavail", { rg: 0, brew: 0 });
    const t = probe(bin, "darwin");
    expect(t.code).toBe(0);
    expect(t.out).toContain("lane confinement: unavailable");
    expect(t.out).toContain("macOS has not been tried");
  });

  test("an unknown platform is unavailable", () => {
    const bin = stubBin("unknown-platform", {});
    const t = probe(bin, "plan9");
    expect(t.code).toBe(0);
    expect(t.out).toContain("lane confinement: unavailable");
    const v = probe(bin, "plan9", ["--verdict"]);
    expect(v.out).toBe("unavailable\n");
  });

  test("the restriction file reads 1 as restricted and 0 as open", () => {
    const one = join(tmp, "userns-1");
    const zero = join(tmp, "userns-0");
    writeFileSync(one, "1\n", "utf8");
    writeFileSync(zero, "0\n", "utf8");
    expect(parseRestrictedUserns("1\n")).toBe(true);
    expect(parseRestrictedUserns("0\n")).toBe(false);
    expect(readRestrictedUsernsFile(one)).toBe(true);
    expect(readRestrictedUsernsFile(zero)).toBe(false);
    expect(readRestrictedUsernsFile(join(tmp, "userns-missing"))).toBeNull();
  });

  test("only a conservative ASCII path goes in the profile", () => {
    expect(isSafeProfilePath("/usr/bin/bwrap")).toBe(true);
    expect(isSafeProfilePath("/opt/custom/bin/bwrap")).toBe(true);
    expect(isSafeProfilePath("/opt/my tools/bwrap")).toBe(false);
    expect(isSafeProfilePath('/tmp/x"bwrap')).toBe(false);
    expect(isSafeProfilePath("/tmp/x'bwrap")).toBe(false);
    expect(isSafeProfilePath("")).toBe(false);
    expect(isSafeProfilePath("/opt/we$ird/bwrap")).toBe(false);
    expect(isSafeProfilePath("/home/josé/bin/bwrap")).toBe(false);
  });

  test("a bwrap is vetted only on a root-owned chain", () => {
    const rootOwned = (path: string): boolean => {
      let current = path;
      for (;;) {
        try {
          if (statSync(current).uid !== 0) return false;
        } catch {
          return false;
        }
        const parent = dirname(current);
        if (parent === current) return true;
        current = parent;
      }
    };
    const discovered = "/bin/sh";
    const resolved = realpathSync(discovered);
    const expected = rootOwned(dirname(discovered)) && rootOwned(resolved);
    expect(isSecureBwrapPath(discovered)).toBe(expected);
    expect(isSecureBwrapPath(join(tmp, "missing-bwrap"))).toBe(false);
  });
});
