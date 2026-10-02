// Report what lane confinement needs on this machine. Every action in the output is
// advice for the user; this probe never installs a package or changes a system rule.
import { readFileSync } from "node:fs";
import { run } from "./lib/proc.ts";

type Verdict = "ready" | "partial" | "unavailable";
type Tool = "bwrap" | "socat" | "rg" | "sandbox-exec";
type PackageManager = "apt-get" | "dnf" | "yum" | "pacman" | "zypper" | "apk" | "brew";

interface Observation {
  platform: string;
  tools: Record<Tool, boolean>;
  packageManager: PackageManager | null;
  ubuntuRelease: string | null;
  restrictedUserns: boolean;
  bwrapStarts: boolean;
}

interface Row {
  need: string;
  status: string;
  detail: string;
}

interface Result {
  verdict: Verdict;
  rows: Row[];
  detail: string;
  action?: string;
  macUntested?: boolean;
}

const managers: PackageManager[] = ["apt-get", "dnf", "yum", "pacman", "zypper", "apk", "brew"];
const packageNames: Record<"bwrap" | "socat" | "rg", string> = {
  bwrap: "bubblewrap",
  socat: "socat",
  rg: "ripgrep",
};

const appArmorAction = `sudo tee /etc/apparmor.d/bwrap > /dev/null <<'EOF'
abi <abi/4.0>,
include <tunables/global>

profile bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,
  include if exists <local/bwrap>
}
EOF
sudo apparmor_parser -r /etc/apparmor.d/bwrap`;

function ubuntuAtLeast2404(release: string | null): boolean {
  if (release === null) return false;
  const parts = /^([0-9]+)\.([0-9]+)(?:\.|$)/u.exec(release);
  if (!parts) return false;
  const major = Number(parts[1]);
  const minor = Number(parts[2]);
  return major > 24 || (major === 24 && minor >= 4);
}

function installCommand(manager: PackageManager, packages: string[]): string {
  const names = packages.join(" ");
  if (manager === "brew") return `brew install ${names}`;
  if (manager === "pacman") return `sudo pacman -S ${names}`;
  if (manager === "apk") return `sudo apk add ${names}`;
  return `sudo ${manager} install ${names}`;
}

function toolRow(need: string, present: boolean): Row {
  return { need, status: present ? "ready" : "missing", detail: present ? "on PATH" : "not on PATH" };
}

export function decide(observed: Observation): Result {
  if (observed.platform === "linux") {
    const names: Array<"bwrap" | "socat" | "rg"> = ["bwrap", "socat", "rg"];
    const rows = names.map((tool) => toolRow(tool === "bwrap" ? "bubblewrap" : tool === "rg" ? "ripgrep" : tool, observed.tools[tool]));
    const missing = names.filter((tool) => !observed.tools[tool]);
    if (missing.length > 0) {
      rows.push({ need: "user namespaces", status: "pending", detail: "check after packages are installed" });
      if (observed.packageManager === null) {
        return { verdict: "unavailable", rows, detail: "No known package manager can install the missing tools." };
      }
      return {
        verdict: "partial",
        rows,
        detail: "Install the missing tools, then run this probe again.",
        action: installCommand(observed.packageManager, missing.map((tool) => packageNames[tool])),
      };
    }
    if (observed.bwrapStarts) {
      rows.push({ need: "user namespaces", status: "ready", detail: "Bubblewrap launch succeeds" });
      return { verdict: "ready", rows, detail: "Linux lane confinement can run." };
    }
    if (ubuntuAtLeast2404(observed.ubuntuRelease) && observed.restrictedUserns) {
      rows.push({ need: "user namespaces", status: "blocked", detail: "Ubuntu restricts unprivileged user namespaces" });
      return {
        verdict: "partial",
        rows,
        detail: "Allow only /usr/bin/bwrap to create user namespaces. The user runs this rule and activation as root, then runs the probe again:",
        action: appArmorAction,
      };
    }
    rows.push({ need: "user namespaces", status: "blocked", detail: "Bubblewrap launch failed" });
    return { verdict: "unavailable", rows, detail: "Bubblewrap cannot start; no known remedy for this system." };
  }

  if (observed.platform === "darwin") {
    const rows = [toolRow("sandbox-exec", observed.tools["sandbox-exec"]), toolRow("ripgrep", observed.tools.rg)];
    if (!observed.tools["sandbox-exec"]) {
      return { verdict: "unavailable", rows, detail: "sandbox-exec is missing; no known installation step.", macUntested: true };
    }
    if (!observed.tools.rg) {
      if (observed.packageManager === "brew") {
        return { verdict: "partial", rows, detail: "Install ripgrep, then run this probe again.", action: "brew install ripgrep", macUntested: true };
      }
      return { verdict: "unavailable", rows, detail: "ripgrep is missing and Homebrew is unavailable.", macUntested: true };
    }
    return { verdict: "ready", rows, detail: "macOS lane confinement has the listed tools.", macUntested: true };
  }

  return { verdict: "unavailable", rows: [], detail: `Lane confinement is not known on ${observed.platform}.` };
}

function osRelease(): string | null {
  let source: string;
  try {
    source = process.env.POSTMASTER_PROBE_OS_RELEASE ?? readFileSync("/etc/os-release", "utf8");
  } catch {
    return null;
  }
  const id = /^ID=(?:"([^"]+)"|([^\n]+))$/mu.exec(source)?.slice(1).find(Boolean);
  if (id !== "ubuntu") return null;
  return /^VERSION_ID=(?:"([^"]+)"|([^\n]+))$/mu.exec(source)?.slice(1).find(Boolean) ?? null;
}

function restrictedUserns(): boolean {
  const override = process.env.POSTMASTER_PROBE_SYSCTL;
  if (override !== undefined) return override.trim() === "1";
  if (Bun.which("sysctl") === null) return false;
  const result = run("sysctl", ["-n", "kernel.apparmor_restrict_unprivileged_userns"], { timeout: 5000 });
  return result.code === 0 && result.out.trim() === "1";
}

function observe(): Observation {
  const platform = process.env.POSTMASTER_PROBE_PLATFORM ?? process.platform;
  const found = (tool: Tool): boolean => Bun.which(tool) !== null;
  const tools: Record<Tool, boolean> = {
    bwrap: found("bwrap"),
    socat: found("socat"),
    rg: found("rg"),
    "sandbox-exec": found("sandbox-exec"),
  };
  const packageManager = platform === "darwin"
    ? (Bun.which("brew") !== null ? "brew" : null)
    : (managers.find((manager) => Bun.which(manager) !== null) ?? null);
  const bwrapStarts = platform === "linux" && tools.bwrap && tools.socat && tools.rg
    ? run("bwrap", ["--unshare-user", "--uid", "0", "--gid", "0", "--ro-bind", "/", "/", "--", "/bin/true"], { timeout: 5000 }).code === 0
    : false;
  return {
    platform,
    tools,
    packageManager,
    ubuntuRelease: platform === "linux" ? osRelease() : null,
    restrictedUserns: platform === "linux" ? restrictedUserns() : false,
    bwrapStarts,
  };
}

function printTable(result: Result): void {
  const row = (need: string, status: string, detail: string): void => {
    console.log(`  ${need.padEnd(16)} ${status.padEnd(12)} ${detail}`);
  };
  row("NEED", "STATUS", "WHAT THE PROBE FOUND");
  row("----", "------", "--------------------");
  for (const entry of result.rows) row(entry.need, entry.status, entry.detail);
  console.log("");
  console.log(`  lane confinement: ${result.verdict}`);
  console.log(`  ${result.detail}`);
  if (result.action) {
    console.log("  The user runs:");
    console.log(result.action);
  }
  if (result.macUntested) console.log("  macOS lane confinement has not been tried.");
  console.log('  "ready" can run; "partial" names the next user-run step; "unavailable" has no known finish here.');
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    printTable(decide(observe()));
  } else if (args.length === 1 && args[0] === "--verdict") {
    console.log(decide(observe()).verdict);
  } else {
    console.error("usage: probe-confine.sh [--verdict]");
    process.exit(1);
  }
}
