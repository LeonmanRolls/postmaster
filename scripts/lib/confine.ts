// A process space of its own for a lane: the table of systems, the no-op
// start check and the wrap. One row per system, kept here and documented in
// harnesses.md. Linux runs Bubblewrap with a new process namespace and a
// fresh /proc over the filesystem as it is. macOS runs sandbox-exec with a
// Seatbelt profile that allows everything except signals to processes
// outside the sandbox. A system with no row cannot confine; the caller runs
// the lane unconfined and names the cause.
//
// The wrap is an argv prefix placed around the harness command from the
// outside, at the point launch.sh runs it. The harness argv inside is
// byte-identical to the off run, bypass flag included. Exit codes pass
// through: a harness dead by SIGTERM or SIGINT reads as exit 143 or 130,
// the same code the unconfined launch reports, since the wrapper cannot
// tell signal death from that exit.

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The macOS Seatbelt profile: allow everything, deny signals to processes
// outside the sandbox. Untested here — #205 runs the macOS trial.
const SEATBELT_PROFILE = `(version 1)
(allow default)
(deny signal)
(allow signal (target same-sandbox))
`;

interface Row {
  /** Build the wrapped argv: prefix + cmd. */
  wrap(cmd: string[]): string[];
  /** Start the confinement with a no-op. Returns the cause on failure. */
  startCheck(): { ok: boolean; cause: string };
}

// The Seatbelt profile file, written once per process at first use.
let seatbeltProfilePath: string | null = null;

function seatbeltProfile(): string {
  if (seatbeltProfilePath !== null) return seatbeltProfilePath;
  try {
    const dir = mkdtempSync(join(tmpdir(), "postmaster-confinement-"));
    seatbeltProfilePath = join(dir, "confinement.sb");
    writeFileSync(seatbeltProfilePath, SEATBELT_PROFILE);
    return seatbeltProfilePath;
  } catch {
    // A profile we cannot write is a start-check failure, never a silent miss.
    return "";
  }
}

// The per-system argv builders. Each row's start check builds its no-op
// from the same builder as its wrap, so the two can never drift. On Linux
// --bind covers / first and --proc mounts the fresh /proc over it: order
// matters, since Bubblewrap applies mounts in the order given. --dev-bind
// keeps the host's /dev, shared-memory objects included, where a plain --dev
// would hide its nodes. --new-session keeps group signals (kill 0) inside
// the lane, off the launcher's group.
const linuxArgs = (cmd: string[]): string[] => [
  "bwrap",
  "--unshare-pid",
  "--bind",
  "/",
  "/",
  "--proc",
  "/proc",
  "--dev-bind",
  "/dev",
  "/dev",
  "--die-with-parent",
  "--new-session",
  "--",
  ...cmd,
];

const darwinArgs = (cmd: string[]): string[] => {
  const profile = seatbeltProfile();
  return ["sandbox-exec", "-f", profile, "--", ...cmd];
};

// The table: one row per system. The lookup is by the kernel's own name;
// launch.ts never names a system. No sandbox-runtime, no pinned version.
const TABLE: Record<string, Row> = {
  linux: {
    wrap: linuxArgs,
    startCheck: () => {
      const argv = linuxArgs(["true"]);
      const r = spawnSync(argv[0]!, argv.slice(1), { encoding: "utf8", timeout: 10000 });
      if (r.error) {
        const err = r.error as NodeJS.ErrnoException;
        if (err.code === "ENOENT") return { ok: false, cause: "bubblewrap is not installed" };
        return { ok: false, cause: `bubblewrap could not start: ${err.message}` };
      }
      if (r.status !== 0) {
        const why = (r.stderr || r.stdout || "").trim().split("\n")[0] ?? "";
        return {
          ok: false,
          cause: `bubblewrap refused to start: ${why || `exit ${r.status}`}`,
        };
      }
      return { ok: true, cause: "" };
    },
  },
  darwin: {
    wrap: darwinArgs,
    startCheck: () => {
      const profile = seatbeltProfile();
      if (profile === "") return { ok: false, cause: "cannot write the sandbox profile" };
      const argv = darwinArgs(["true"]);
      const r = spawnSync(argv[0]!, argv.slice(1), {
        encoding: "utf8",
        timeout: 10000,
      });
      if (r.error) {
        const err = r.error as NodeJS.ErrnoException;
        if (err.code === "ENOENT") return { ok: false, cause: "sandbox-exec is not installed" };
        return { ok: false, cause: `sandbox-exec could not start: ${err.message}` };
      }
      if (r.status !== 0) {
        const why = (r.stderr || r.stdout || "").trim().split("\n")[0] ?? "";
        return {
          ok: false,
          cause: `sandbox-exec refused to start: ${why || `exit ${r.status}`}`,
        };
      }
      return { ok: true, cause: "" };
    },
  },
};

/** The wrapped argv for cmd on this system, or null when this system has no row. */
export function wrapCommand(cmd: string[]): string[] | null {
  const row = TABLE[process.platform];
  if (row === undefined) return null;
  return row.wrap(cmd);
}

/** Start check: can the confinement start with a no-op? When the system has
 * no row the cause names that; when the tool is missing or refuses, the cause
 * names that. */
export function startCheck(): { ok: boolean; cause: string } {
  const row = TABLE[process.platform];
  if (row === undefined) {
    return { ok: false, cause: `no confinement for this system: ${process.platform}` };
  }
  return row.startCheck();
}
