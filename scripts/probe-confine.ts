// Whether lane confinement can run on this machine. sandbox-runtime wraps each lane's
// harness in Bubblewrap on Linux and Seatbelt on macOS; the user chooses the key, this
// reports what is genuinely available and what finishes it.
//
//   probe-confine.sh            the table and the footer
//   probe-confine.sh --verdict  ready, partial or unavailable, and nothing else
//
//   exit 0 always; the table is the result
import { run } from "./lib/proc.ts";

export type Verdict = "ready" | "partial" | "unavailable";

export interface Row {
  need: string;
  state: string;
  how: string;
}

export interface Assessment {
  verdict: Verdict;
  rows: Row[];
  /** What finishes it when the verdict is partial; empty otherwise. */
  finish: string[];
  footer: string[];
}

export interface Inputs {
  platform: string;
  /** Path to the tool, or null when it is not on PATH. */
  tools: Record<string, string | null>;
  /** First package manager on PATH, or null. */
  packageManager: string | null;
  /** kernel.apparmor_restrict_unprivileged_userns: 1, 0, or absent. */
  sysctl: "0" | "1" | "absent";
  /** The launch test, when it was run. */
  launch: { ran: boolean; ok: boolean; err: string };
}

const LINUX_TOOLS: Record<string, string> = {
  bubblewrap: "bwrap",
  socat: "socat",
  ripgrep: "rg",
};
const MACOS_TOOLS: Record<string, string> = {
  "sandbox-exec": "sandbox-exec",
  ripgrep: "rg",
};

const MANAGERS: Array<{ bin: string; install: (pkgs: string[]) => string }> = [
  { bin: "apt-get", install: (p) => `sudo apt-get install ${p.join(" ")}` },
  { bin: "dnf", install: (p) => `sudo dnf install ${p.join(" ")}` },
  { bin: "yum", install: (p) => `sudo yum install ${p.join(" ")}` },
  { bin: "pacman", install: (p) => `sudo pacman -S ${p.join(" ")}` },
  { bin: "zypper", install: (p) => `sudo zypper install ${p.join(" ")}` },
  { bin: "apk", install: (p) => `sudo apk add ${p.join(" ")}` },
  { bin: "brew", install: (p) => `brew install ${p.join(" ")}` },
];

/** Package names to install for each tool the probe looks for. */
const PACKAGE_FOR: Record<string, string> = {
  bwrap: "bubblewrap",
  socat: "socat",
  rg: "ripgrep",
  "sandbox-exec": "", // ships with macOS; nothing to install
};

const APPARMOR_RULE = `sudo tee /etc/apparmor.d/bwrap > /dev/null <<'EOF'
abi <abi/4.0>,
include <tunables/global>

profile bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,
  include if exists <local/bwrap>
}
EOF
sudo apparmor_parser -r /etc/apparmor.d/bwrap`;

const FOOTER_HELP = [
  '  "ready" means sandbox-runtime can confine a lane on this machine now.',
  '  "partial" names what finishes it; the user runs that, and the probe runs again',
  '  after. "unavailable" means this probe knows no way to finish it here.',
];

const MACOS_NOTE = "  macOS has not been tried.";

function row(need: string, state: string, how: string): Row {
  return { need, state, how };
}

/** The decision, given what the machine reported. Pure: no reads. */
export function assess(input: Inputs): Assessment {
  const rows: Row[] = [];
  const isMac = input.platform === "darwin";
  const isLinux = input.platform === "linux";

  if (!isLinux && !isMac) {
    return {
      verdict: "unavailable",
      rows: [row("lane confinement", "unavailable", `unsupported platform: ${input.platform}`)],
      finish: [],
      footer: [
        `  lane confinement: unavailable`,
        `  this probe knows no confinement recipe for ${input.platform}.`,
        "",
        ...FOOTER_HELP,
      ],
    };
  }

  const wanted = isMac ? MACOS_TOOLS : LINUX_TOOLS;
  const missing: string[] = []; // tool keys (bwrap, socat, rg, sandbox-exec)
  for (const [label, bin] of Object.entries(wanted)) {
    const path = input.tools[bin] ?? null;
    if (path === null) missing.push(bin);
    rows.push(row(label, path === null ? "no" : "yes", path ?? "not on PATH"));
  }

  const missingPackages = missing
    .map((bin) => PACKAGE_FOR[bin] ?? "")
    .filter((p) => p !== "");
  const unservable = missing.filter((bin) => PACKAGE_FOR[bin] === "");

  if (missing.length > 0) {
    if (unservable.length > 0 || input.packageManager === null) {
      const why =
        unservable.length > 0
          ? `${unservable.join(", ")} cannot be installed by this probe`
          : "no package manager this probe knows";
      return {
        verdict: "unavailable",
        rows,
        finish: [],
        footer: [`  lane confinement: unavailable`, `  ${why}.`, "", ...FOOTER_HELP, ...(isMac ? [MACOS_NOTE] : [])],
      };
    }
    const mgr = MANAGERS.find((m) => m.bin === input.packageManager);
    const cmd = mgr ? mgr.install(missingPackages) : `install ${missingPackages.join(" ")}`;
    return {
      verdict: "partial",
      rows,
      finish: [cmd],
      footer: [
        `  lane confinement: partial`,
        `  finish it: ${cmd}`,
        "",
        ...FOOTER_HELP,
        ...(isMac ? [MACOS_NOTE] : []),
      ],
    };
  }

  if (isMac) {
    return {
      verdict: "ready",
      rows,
      finish: [],
      footer: [`  lane confinement: ready`, MACOS_NOTE, "", ...FOOTER_HELP],
    };
  }

  // Linux with every tool present: readiness is a launch test, not the sysctl alone.
  if (!input.launch.ran) {
    return {
      verdict: "unavailable",
      rows: [...rows, row("user namespaces", "not checked", "bwrap is present but the launch was not run")],
      finish: [],
      footer: [
        `  lane confinement: unavailable`,
        `  the launch test did not run.`,
        "",
        ...FOOTER_HELP,
      ],
    };
  }
  if (input.launch.ok) {
    rows.push(row("user namespaces", "yes", "bwrap --unshare-user starts a process"));
    return {
      verdict: "ready",
      rows,
      finish: [],
      footer: [`  lane confinement: ready`, "", ...FOOTER_HELP],
    };
  }

  rows.push(row("user namespaces", "partial", "bwrap cannot create a user namespace"));
  if (input.sysctl === "1") {
    return {
      verdict: "partial",
      rows,
      finish: [
        "the AppArmor rule that lets only Bubblewrap create user namespaces; the user runs it as root:",
        APPARMOR_RULE,
      ],
      footer: [
        `  lane confinement: partial`,
        `  finish it: the AppArmor rule that lets only Bubblewrap create user namespaces.`,
        `  The user runs it as root; this probe never does.`,
        "",
        ...FOOTER_HELP,
      ],
    };
  }
  const cause = input.launch.err.trim().split("\n")[0] ?? "bwrap launch failed";
  return {
    verdict: "unavailable",
    rows,
    finish: [],
    footer: [
      `  lane confinement: unavailable`,
      `  bwrap cannot create a user namespace and this probe knows no rule that fixes it.`,
      `  ${cause}`,
      "",
      ...FOOTER_HELP,
    ],
  };
}

function which(bin: string): string | null {
  return Bun.which(bin) ?? null;
}

function readSysctl(): "0" | "1" | "absent" {
  const forced = process.env.POSTMASTER_PROBE_SYSCTL;
  if (forced !== undefined && forced !== "") return forced === "1" ? "1" : "0";
  const r = run("sysctl", ["-n", "kernel.apparmor_restrict_unprivileged_userns"]);
  if (r.code !== 0) return "absent";
  return r.out.trim() === "1" ? "1" : "0";
}

function readPlatform(): string {
  return process.env.POSTMASTER_PROBE_PLATFORM || process.platform;
}

function findManager(): string | null {
  for (const m of MANAGERS) {
    if (which(m.bin) !== null) return m.bin;
  }
  return null;
}

/** Collect what the machine says. The only place that touches PATH, sysctl and bwrap. */
export function collect(): Inputs {
  const platform = readPlatform();
  const bins =
    platform === "darwin" ? Object.values(MACOS_TOOLS) : platform === "linux" ? Object.values(LINUX_TOOLS) : [];
  const tools: Record<string, string | null> = {};
  for (const bin of bins) tools[bin] = which(bin);

  let launch: Inputs["launch"] = { ran: false, ok: false, err: "" };
  if (platform === "linux" && (tools.bwrap ?? null) !== null && tools.socat !== null && tools.rg !== null) {
    // A minimal Bubblewrap user-namespace launch: the same capability sandbox-runtime needs.
    const r = run("bwrap", ["--ro-bind", "/", "/", "--unshare-user", "true"], { timeout: 5_000 });
    launch = { ran: true, ok: r.code === 0, err: r.err };
  }

  return {
    platform,
    tools,
    packageManager: findManager(),
    sysctl: readSysctl(),
    launch,
  };
}

export function formatTable(a: Assessment): string {
  const needW = Math.max(4, ...a.rows.map((r) => r.need.length));
  const stateW = Math.max(7, ...a.rows.map((r) => r.state.length));
  const lines: string[] = [];
  const rowLine = (need: string, state: string, how: string): string =>
    `  ${need.padEnd(needW)} ${state.padEnd(stateW)} ${how}`;
  lines.push(rowLine("NEED", "PRESENT", "HOW IT IS REACHED"));
  lines.push(rowLine("-".repeat(needW), "-".repeat(stateW), "------------------"));
  for (const r of a.rows) lines.push(rowLine(r.need, r.state, r.how));
  lines.push("");
  for (const line of a.footer) lines.push(line);
  if (a.finish.length > 0) {
    lines.push("");
    for (const block of a.finish) {
      for (const line of block.split("\n")) lines.push(line === "" ? "" : `  ${line}`);
    }
  }
  return lines.join("\n");
}

const argv = process.argv.slice(2);
if (argv.includes("--verdict")) {
  console.log(assess(collect()).verdict);
  process.exit(0);
}
if (argv.length > 0 && !argv.includes("--verdict")) {
  console.error("usage: probe-confine.sh [--verdict]");
  process.exit(1);
}
console.log(formatTable(assess(collect())));
process.exit(0);
