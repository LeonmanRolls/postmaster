// Whether lane confinement can run on this machine. sandbox-runtime wraps each lane's
// harness in Bubblewrap on Linux and Seatbelt on macOS; the user chooses the key, this
// reports what is genuinely available and what finishes it.
//
//   scripts/run probe-confine            the table and the footer
//   scripts/run probe-confine --verdict  ready, partial or unavailable, and nothing else
//
//   exit 0 always; the table is the result. Every action in the output is advice for the
//   user; this probe never installs a package or changes a system rule.
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { run } from "./lib/proc.ts";

export type Verdict = "ready" | "partial" | "unavailable";
type Tool = "bwrap" | "socat" | "rg" | "sandbox-exec";
type PackageManager = "apt-get" | "dnf" | "yum" | "pacman" | "zypper" | "apk" | "brew";

export interface Observation {
  platform: string;
  /** Resolved path of each tool, or null when it is not on PATH. */
  tools: Record<Tool, string | null>;
  packageManager: PackageManager | null;
  /** Ubuntu VERSION_ID, or null when not Ubuntu. */
  ubuntuRelease: string | null;
  restrictedUserns: boolean;
  /** True when the AppArmor profile for bwrap is already in place. */
  apparmorProfile: boolean;
  /** True when the found bwrap is pinned to a root-owned path. */
  secureBwrapPath: boolean;
  bwrapStarts: boolean;
  launchErr: string;
}

export interface Row {
  need: string;
  status: string;
  detail: string;
}

export interface Result {
  verdict: Verdict;
  rows: Row[];
  detail: string;
  /** The user-run step, printed verbatim so a heredoc still pastes. */
  action?: string;
  cause?: string;
  macUntested?: boolean;
}

const managers: PackageManager[] = ["apt-get", "dnf", "yum", "pacman", "zypper", "apk", "brew"];
const packageNames: Record<"bwrap" | "socat" | "rg", string> = {
  bwrap: "bubblewrap",
  socat: "socat",
  rg: "ripgrep",
};

const SYSCTL_PATH = "/proc/sys/kernel/apparmor_restrict_unprivileged_userns";
const APPARMOR_PROFILE_PATH = "/etc/apparmor.d/bwrap";

/** The root remedy for the bwrap binary the probe actually found. Unindented: pasted. */
function appArmorAction(bwrapPath: string): string {
  return `sudo tee ${APPARMOR_PROFILE_PATH} > /dev/null <<'EOF'
abi <abi/4.0>,
include <tunables/global>

profile bwrap ${bwrapPath} flags=(unconfined) {
  userns,
  include if exists <local/bwrap>
}
EOF
sudo apparmor_parser -r ${APPARMOR_PROFILE_PATH}`;
}

/**
 * True when the path can go in the profile line without breaking its syntax.
 * Deliberately a conservative ASCII set: anything else declines the automated
 * remedy and the probe says to write the profile by hand.
 */
export function isSafeProfilePath(path: string): boolean {
  return /^[A-Za-z0-9_@%+=:,./-]+$/u.test(path);
}

const FOOTER_HELP = [
  '  "ready" means sandbox-runtime can confine a lane on this machine now.',
  '  "partial" names what finishes it; the user runs that, and the probe runs again',
  '  after. "unavailable" means this probe knows no way to finish it here.',
];

const MACOS_NOTE = "  macOS has not been tried.";

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

function toolRow(need: string, path: string | null): Row {
  return { need, status: path === null ? "no" : "yes", detail: path ?? "not on PATH" };
}

/** The decision, given what the machine reported. Pure: no reads. */
export function decide(observed: Observation): Result {
  if (observed.platform === "linux") {
    const names: Array<"bwrap" | "socat" | "rg"> = ["bwrap", "socat", "rg"];
    const labels: Record<(typeof names)[number], string> = {
      bwrap: "bubblewrap",
      socat: "socat",
      rg: "ripgrep",
    };
    const rows = names.map((tool) => toolRow(labels[tool], observed.tools[tool]));
    const missing = names.filter((tool) => observed.tools[tool] === null);
    if (missing.length > 0) {
      rows.push({
        need: "user namespaces",
        status: "pending",
        detail: "check after packages are installed",
      });
      if (observed.packageManager === null) {
        return {
          verdict: "unavailable",
          rows,
          detail: "No known package manager can install the missing tools.",
        };
      }
      return {
        verdict: "partial",
        rows,
        detail: "Install the missing tools, then run this probe again.",
        action: installCommand(
          observed.packageManager,
          missing.map((tool) => packageNames[tool]),
        ),
      };
    }
    if (observed.bwrapStarts) {
      rows.push({ need: "user namespaces", status: "yes", detail: "Bubblewrap launch succeeds" });
      return { verdict: "ready", rows, detail: "Linux lane confinement can run." };
    }
    if (ubuntuAtLeast2404(observed.ubuntuRelease) && observed.restrictedUserns) {
      const bwrap = observed.tools.bwrap;
      if (
        !observed.apparmorProfile &&
        bwrap !== null &&
        isSafeProfilePath(bwrap) &&
        observed.secureBwrapPath
      ) {
        rows.push({
          need: "user namespaces",
          status: "partial",
          detail: "Ubuntu restricts unprivileged user namespaces",
        });
        return {
          verdict: "partial",
          rows,
          detail: `Allow only ${bwrap} to create user namespaces. The user runs this rule and activation as root, then runs the probe again:`,
          action: appArmorAction(bwrap),
        };
      }
      rows.push({ need: "user namespaces", status: "no", detail: "Bubblewrap launch failed" });
      const restrictedCause = observed.launchErr.trim().split("\n")[0];
      if (observed.apparmorProfile) {
        return {
          verdict: "unavailable",
          rows,
          detail:
            "An AppArmor profile for bwrap is already in place, but the launch still fails; the rule is not the finish.",
          ...(restrictedCause ? { cause: restrictedCause } : {}),
        };
      }
      if (bwrap !== null && !isSafeProfilePath(bwrap)) {
        return {
          verdict: "unavailable",
          rows,
          detail: `bwrap is at ${bwrap}, which cannot go in the AppArmor rule; write the profile for that path by hand.`,
          ...(restrictedCause ? { cause: restrictedCause } : {}),
        };
      }
      if (bwrap !== null && !observed.secureBwrapPath) {
        return {
          verdict: "unavailable",
          rows,
          detail: `bwrap is at ${bwrap}, where it can be replaced after the rule is written; install the bubblewrap package, or write the profile for that path by hand.`,
          ...(restrictedCause ? { cause: restrictedCause } : {}),
        };
      }
      return {
        verdict: "unavailable",
        rows,
        detail: "Bubblewrap cannot start; no known remedy for this system.",
        ...(restrictedCause ? { cause: restrictedCause } : {}),
      };
    }
    rows.push({ need: "user namespaces", status: "no", detail: "Bubblewrap launch failed" });
    const cause = observed.launchErr.trim().split("\n")[0];
    return {
      verdict: "unavailable",
      rows,
      detail: "Bubblewrap cannot start; no known remedy for this system.",
      ...(cause ? { cause } : {}),
    };
  }

  if (observed.platform === "darwin") {
    const rows = [
      toolRow("sandbox-exec", observed.tools["sandbox-exec"]),
      toolRow("ripgrep", observed.tools.rg),
    ];
    if (observed.tools["sandbox-exec"] === null) {
      return {
        verdict: "unavailable",
        rows,
        detail: "sandbox-exec is missing; no known installation step.",
        macUntested: true,
      };
    }
    if (observed.tools.rg === null) {
      if (observed.packageManager === "brew") {
        return {
          verdict: "partial",
          rows,
          detail: "Install ripgrep, then run this probe again.",
          action: "brew install ripgrep",
          macUntested: true,
        };
      }
      return {
        verdict: "unavailable",
        rows,
        detail: "ripgrep is missing and Homebrew is unavailable.",
        macUntested: true,
      };
    }
    return {
      verdict: "ready",
      rows,
      detail: "macOS lane confinement has the listed tools.",
      macUntested: true,
    };
  }

  return {
    verdict: "unavailable",
    rows: [
      {
        need: "lane confinement",
        status: "unavailable",
        detail: `unsupported platform: ${observed.platform}`,
      },
    ],
    detail: `This probe knows no confinement recipe for ${observed.platform}.`,
  };
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

/** True when the sysctl text says unprivileged user namespaces are restricted. */
export function parseRestrictedUserns(text: string): boolean {
  return text.trim() === "1";
}

/** The sysctl through the proc file, or null when it cannot be read. */
export function readRestrictedUsernsFile(path: string = SYSCTL_PATH): boolean | null {
  try {
    return parseRestrictedUserns(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function restrictedUserns(): boolean {
  const override = process.env.POSTMASTER_PROBE_SYSCTL;
  if (override !== undefined && override !== "") return parseRestrictedUserns(override);
  // The proc file first: it needs no binary on PATH. The sysctl binary covers the rest.
  return readRestrictedUsernsFile() ?? restrictedUsernsSysctl();
}

function restrictedUsernsSysctl(): boolean {
  if (Bun.which("sysctl") === null) return false;
  const result = run("sysctl", ["-n", "kernel.apparmor_restrict_unprivileged_userns"], {
    timeout: 5000,
  });
  return result.code === 0 && parseRestrictedUserns(result.out);
}

/** True when the AppArmor profile for bwrap is already in place. */
function apparmorProfileExists(): boolean {
  const override = process.env.POSTMASTER_PROBE_APPARMOR_PROFILE;
  if (override !== undefined && override !== "") return override.trim() === "1";
  return existsSync(APPARMOR_PROFILE_PATH);
}

/** True when every component of the path down to the root is owned by root. */
function chainRootOwned(path: string): boolean {
  let current = path;
  for (;;) {
    let uid: number;
    try {
      uid = statSync(current).uid;
    } catch {
      return false;
    }
    if (uid !== 0) return false;
    const parent = dirname(current);
    if (parent === current) return true;
    current = parent;
  }
}

/**
 * True when the found bwrap is pinned to a root-owned path: the resolved binary
 * and the link's own directory. A rule for a replaceable binary would not stay
 * limited to Bubblewrap, so an unvetted path declines the automated remedy.
 */
export function isSecureBwrapPath(discovered: string): boolean {
  const override = process.env.POSTMASTER_PROBE_BWRAP_SECURE;
  if (override !== undefined && override !== "") return override.trim() === "1";
  let resolved: string;
  try {
    resolved = realpathSync(discovered);
  } catch {
    return false;
  }
  return chainRootOwned(dirname(discovered)) && chainRootOwned(resolved);
}

/** Collect what the machine says. The only place that touches PATH, sysctl and bwrap. */
export function collect(): Observation {
  const platform = process.env.POSTMASTER_PROBE_PLATFORM || process.platform;
  const tools: Record<Tool, string | null> = {
    bwrap: Bun.which("bwrap"),
    socat: Bun.which("socat"),
    rg: Bun.which("rg"),
    "sandbox-exec": Bun.which("sandbox-exec"),
  };
  const packageManager: PackageManager | null =
    platform === "darwin"
      ? Bun.which("brew") !== null
        ? "brew"
        : null
      : (managers.find((manager) => Bun.which(manager) !== null) ?? null);
  let bwrapStarts = false;
  let launchErr = "";
  if (platform === "linux" && tools.bwrap !== null && tools.socat !== null && tools.rg !== null) {
    // A minimal Bubblewrap user- and PID-namespace launch: the namespaces sandbox-runtime needs.
    const launched = run(
      "bwrap",
      ["--ro-bind", "/", "/", "--unshare-user", "--unshare-pid", "true"],
      {
        timeout: 5000,
      },
    );
    bwrapStarts = launched.code === 0;
    launchErr = launched.err;
  }
  return {
    platform,
    tools,
    packageManager,
    ubuntuRelease: platform === "linux" ? osRelease() : null,
    restrictedUserns: platform === "linux" ? restrictedUserns() : false,
    apparmorProfile: platform === "linux" ? apparmorProfileExists() : false,
    secureBwrapPath:
      platform === "linux" && tools.bwrap !== null ? isSecureBwrapPath(tools.bwrap) : false,
    bwrapStarts,
    launchErr,
  };
}

export function formatTable(result: Result): string {
  const lines: string[] = [];
  const row = (need: string, status: string, detail: string): void => {
    lines.push(`  ${need.padEnd(16)} ${status.padEnd(12)} ${detail}`);
  };
  row("NEED", "STATUS", "WHAT THE PROBE FOUND");
  row("----", "------", "--------------------");
  for (const entry of result.rows) row(entry.need, entry.status, entry.detail);
  lines.push("");
  lines.push(`  lane confinement: ${result.verdict}`);
  lines.push(`  ${result.detail}`);
  if (result.cause) lines.push(`  ${result.cause}`);
  if (result.action) {
    lines.push("  The user runs:");
    lines.push(result.action);
  }
  if (result.macUntested) lines.push(MACOS_NOTE);
  lines.push(...FOOTER_HELP);
  return lines.join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(formatTable(decide(collect())));
  } else if (args.length === 1 && args[0] === "--verdict") {
    console.log(decide(collect()).verdict);
  } else {
    console.error("usage: run probe-confine [--verdict]");
    process.exit(1);
  }
}
