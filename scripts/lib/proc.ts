// Process and filesystem edges: temp directories the scripts clean up, and a
// spawn wrapper that returns exit code and output the way the bash versions read it.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { constants as osConstants, tmpdir } from "node:os";
import { join } from "node:path";

export interface RunResult {
  code: number;
  out: string;
  err: string;
  /** True only when our own timeout killed the child. A child that exits 128
   * on its own is not a timeout; the code alone cannot tell them apart. */
  timedOut: boolean;
}

/** Linux signal numbers, by name. Used only when the runtime reports Linux
 * names on another system (below); the live table stays the default. */
const LINUX_SIGNALS: Readonly<Record<string, number>> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGILL: 4,
  SIGTRAP: 5,
  SIGABRT: 6,
  SIGBUS: 7,
  SIGFPE: 8,
  SIGKILL: 9,
  SIGUSR1: 10,
  SIGSEGV: 11,
  SIGUSR2: 12,
  SIGPIPE: 13,
  SIGALRM: 14,
  SIGTERM: 15,
  SIGSTKFLT: 16,
  SIGCHLD: 17,
  SIGCONT: 18,
  SIGSTOP: 19,
  SIGTSTP: 20,
  SIGTTIN: 21,
  SIGTTOU: 22,
  SIGURG: 23,
  SIGXCPU: 24,
  SIGXFSZ: 25,
  SIGVTALRM: 26,
  SIGPROF: 27,
  SIGWINCH: 28,
  SIGIO: 29,
  SIGPWR: 30,
  SIGSYS: 31,
};

let calibratedSignals: Readonly<Record<string, number>> | null = null;
/** The numbers behind the signal names this runtime reports. Bun names a
 * macOS death by signal 10 `SIGUSR1`, the Linux name for 10, while
 * `os.constants.signals` carries the macOS numbers — looking the reported
 * name up in the live table would count 128+30 for a SIGBUS. One probe
 * death says which table the runtime used: a shell killed by SIGBUS is
 * reported `SIGUSR1` only where the runtime speaks Linux names. Cached;
 * a probe that cannot run keeps the live table. */
function bunSignalNumbers(): Readonly<Record<string, number>> {
  if (calibratedSignals) return calibratedSignals;
  calibratedSignals = osConstants.signals;
  try {
    const probe = spawnSync("sh", ["-c", "kill -BUS $$"], { encoding: "utf8" });
    if (probe.signal === "SIGUSR1") calibratedSignals = LINUX_SIGNALS;
  } catch {
    /* keep the live table */
  }
  return calibratedSignals;
}

/** The exit code for a child dead by a signal: 128 plus the signal's number
 * as this system numbers it (which a shell reports it with), 128 when the
 * signal names no number. The name comes from the runtime, whose table the
 * default follows (above); pass `numbers` to pin another table. A signal
 * the runtime names by its number alone (`SIG16`) carries that number. */
export function signalExitCode(
  signal: string,
  numbers: Readonly<Record<string, number>> = bunSignalNumbers(),
): number {
  const known = numbers[signal];
  if (known !== undefined) return 128 + known;
  const numeric = /^SIG([0-9]+)$/u.exec(signal);
  if (numeric) return 128 + Number(numeric[1]);
  return 128;
}

/** Run a command; never throws on a non-zero exit.
 * A command that never starts reports the way a shell does: 127 with a
 * diagnostic when it is not found, 126 when it cannot be executed. A child
 * dead by a signal reports 128 plus the signal's number, as a shell
 * reports it. `timeout` is milliseconds, past which the child is killed
 * and the run reports 128 with whatever output it produced. */
export function run(
  cmd: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    input?: string;
    timeout?: number;
  } = {},
): RunResult {
  let env: Record<string, string | undefined> = process.env;
  if (options.env !== undefined) {
    env = { ...process.env };
    for (const [k, v] of Object.entries(options.env)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }
  const r = spawnSync(cmd, args, {
    cwd: options.cwd,
    env,
    encoding: "utf8",
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
    ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
  });
  const error = r.error as NodeJS.ErrnoException | undefined;
  if (error && (r.status === null || r.status === undefined) && !r.signal) {
    if (error.code === "ENOENT")
      return { code: 127, out: "", err: `${cmd}: command not found\n`, timedOut: false };
    if (error.code === "EACCES")
      return { code: 126, out: "", err: `${cmd}: permission denied\n`, timedOut: false };
    return {
      code: 1,
      out: String(r.stdout ?? ""),
      err: String(r.stderr ?? "") || `${cmd}: ${error.message}\n`,
      timedOut: false,
    };
  }
  // Our own timeout kill carries ETIMEDOUT in both runtimes; a child dead
  // by any other signal reports 128 plus its number, as a shell reports it.
  const killed = error?.code === "ETIMEDOUT" && (r.status === null || r.status === undefined);
  let code: number;
  if (r.status !== null && r.status !== undefined) code = r.status;
  else if (killed) code = 128;
  else if (r.signal) code = signalExitCode(r.signal);
  else code = 1;
  return {
    code,
    out: String(r.stdout ?? ""),
    err: String(r.stderr ?? ""),
    timedOut: killed,
  };
}

/** This process's raw argv bytes, or null where the kernel does not expose
 * them (no /proc). Decoded arguments cannot tell a legitimate U+FFFD from
 * one the runtime substituted for undecodable bytes; these bytes can. */
export function rawArgvBytes(): Buffer | null {
  try {
    return readFileSync("/proc/self/cmdline");
  } catch {
    return null;
  }
}

/** Whether our own argv holds bytes that are not valid UTF-8. True only when
 * /proc proves it; without /proc there is nothing to check against, and a
 * U+FFFD in a decoded argument is a legitimate character, not evidence. */
export function argvHasUndecodableBytes(): boolean {
  const raw = rawArgvBytes();
  if (raw === null) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(raw);
    return false;
  } catch {
    return true;
  }
}

/** Decode bytes as UTF-8, dropping invalid sequences the way `iconv -c`
 * does: a byte that cannot start a valid sequence is skipped and decoding
 * resumes after it, so damaged input loses bytes and never gains a
 * replacement character. Overlongs, surrogates, strays past U+10FFFF and
 * truncated tails are all damage. */
export function decodeDropInvalid(bytes: Uint8Array): string {
  const out: string[] = [];
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b < 0x80) {
      out.push(String.fromCharCode(b));
      i++;
      continue;
    }
    let len = 0;
    let min = 0;
    if (b >= 0xc2 && b <= 0xdf) {
      len = 2;
      min = 0x80;
    } else if (b >= 0xe0 && b <= 0xef) {
      len = 3;
      min = 0x800;
    } else if (b >= 0xf0 && b <= 0xf4) {
      len = 4;
      min = 0x10000;
    } else {
      i++; // a stray continuation, C0/C1, F5+: drop one byte
      continue;
    }
    if (i + len > bytes.length) {
      i++; // truncated tail: drop, retry after
      continue;
    }
    let cp = b & (len === 2 ? 0x1f : len === 3 ? 0x0f : 0x07);
    let ok = true;
    for (let j = 1; j < len; j++) {
      const c = bytes[i + j]!;
      if (c < 0x80 || c > 0xbf) {
        ok = false;
        break;
      }
      cp = (cp << 6) | (c & 0x3f);
    }
    if (!ok || cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      i++;
      continue;
    }
    out.push(String.fromCodePoint(cp));
    i += len;
  }
  return out.join("");
}

/** This process's arguments re-derived from the raw argv bytes, with invalid
 * sequences dropped the way `iconv -c` drops them. The raw bytes tell entry
 * by entry, so a bad byte in one argument never costs another its
 * characters. Bun strips its own flags from process.argv but not from the
 * raw command line (and the wrappers pass some), so the raw entries align
 * with the decoded arguments from the end, not the start. Without /proc, or
 * when the raw entries do not align with the decoded arguments, the
 * runtime's decoding stands. */
export function argvDecoded(): string[] {
  const args = process.argv.slice(2);
  const raw = rawArgvBytes();
  if (raw === null) return args;
  const parts: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0) {
      parts.push(raw.subarray(start, i));
      start = i + 1;
    }
  }
  if (start < raw.length) parts.push(raw.subarray(start));
  if (parts.length < args.length + 2) return args;
  return parts.slice(parts.length - args.length).map((p) => decodeDropInvalid(p));
}

/** A fresh temporary file in dir, as `mkstemp` makes one: a random name that
 * never reuses an existing path, created O_EXCL, mode 0600. For an atomic
 * write: write the file, then rename it over the target. */
export function mkstempSync(dir: string, prefix: string): string {
  for (;;) {
    const name = join(dir, `${prefix}${randomBytes(8).toString("hex")}`);
    try {
      closeSync(openSync(name, "wx", 0o600));
      return name;
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === "EEXIST") continue;
      throw e;
    }
  }
}

/** mkdir -d a temp dir and hand it to fn; remove it afterwards even if fn throws. */
export function withTempDir<T>(fn: (dir: string) => T, prefix = "postmaster-"): T {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const cleanup = (): void => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // cleanup is best-effort; a leftover temp dir is not a control failure
    }
  };
  try {
    const r = fn(dir);
    if (r instanceof Promise) {
      return r.finally(cleanup) as T;
    }
    cleanup();
    return r;
  } catch (e) {
    cleanup();
    throw e;
  }
}

/** Print to stderr and exit with the code, matching the bash `echo ... >&2; exit n` pattern. */
export function die(message: string, code = 1): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
  throw new Error("unreachable");
}

/** Print to stdout and exit 0. */
export function say(message: string): never {
  process.stdout.write(`${message}\n`);
  process.exit(0);
  throw new Error("unreachable");
}
