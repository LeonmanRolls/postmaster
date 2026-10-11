// The lane install guard (#426): every package-manager invocation a lane runs
// passes through the guard's shim first, and the guard allows it only when the
// run approved it. A direct install needs the ticket to list the exact version
// and the user's recorded yes; every package it brings waits seven days and
// passes Socket's free firewall scan, and any install script in the closure
// refuses the install unless the user allowed that package's scripts. Bare
// syncs run drift-free against the lockfile with scripts blocked. Refusals
// exit 1, name the package and tell the agent to stop and report it; anything
// the guard cannot check is refused the same way.
//
//   run install-guard run <prog> <args...>   decide one invocation, then exec or refuse
//   run install-guard facts <spec>           one package's ask facts as key=value lines
//   run install-guard dispatch-check <project> [--dispatch <dir>]
//                                            the Stage B gate for uncovered managers
//
// run reads its context from the environment the launch sets:
// POSTMASTER_DISPATCH, POSTMASTER_TOOL and POSTMASTER_GUARD_LANE, plus the
// shim dir as --shim-dir (the first argument) so the guard's own manager
// lookup skips the shims. POSTMASTER_GUARD_REGISTRY and
// POSTMASTER_GUARD_SOCKET_API point the guard at a stand-in registry and
// Socket stub; tests set them, and a lane setting them deliberately is outside
// the threat model, which is a mistaken or misled agent, not an adversary.
//
// How it is enforced per manager (each verified by execution before relying
// on it): npm runs installs with --ignore-scripts and --no-audit --no-fund,
// and bare installs run as npm ci after the guard's own drift check; pnpm
// runs with --ignore-scripts plus one --allow-build per allowed package, and
// bare installs run --frozen-lockfile; Yarn Classic runs with
// --ignore-scripts and --frozen-lockfile; Yarn Berry installs with
// YARN_ENABLE_SCRIPTS=0 and --immutable against YARN_NPM_REGISTRY_SERVER; Bun
// runs bare installs --frozen-lockfile with dependency scripts blocked by
// default, and the guard writes exactly the allowed scriptful packages to the
// manifest's trustedDependencies, since bun pm trust and bun add --trust both
// crash in Bun 1.4.2. Every install runs against the pinned registry.
// One-shot runs of installed binaries pass with downloads disabled, while
// one-shot runs of anything else are guarded like an add. Global installs,
// trust commands, rebuilds of unallowed packages, lockfile-only resolves and
// the publish and credential commands are refused outright. A future install
// command the classifier does not know is a documented residual risk, as is
// Bun's default-trusted list, which trustedDependencies may not override.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  listsVersion,
  parseLibraries,
  readApprovals,
  wordCovers,
  type Approvals as LibApprovals,
  type ListedLibrary,
} from "./lib/libraries.ts";
import { argvDecoded, run as runCmd } from "./lib/proc.ts";

export type Pm = "npm" | "pnpm" | "yarn" | "bun";

/** A refusal: the message the agent sees, naming the package and routing the
 * report. Thrown, so every check path fails closed through one handler. */
export class Refusal extends Error {
  constructor(message: string) {
    super(message);
  }
}

export const refuse = (text: string): never => {
  throw new Refusal(`${text} Stop and report it.`);
};

/** The refusal error itself, for guards that need narrowing: `throw
 * refusal(...)` narrows where a never-returning call does not. */
export const refusal = (text: string): Refusal => new Refusal(`${text} Stop and report it.`);

// ---------- versions ----------

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  pre: Array<string | number>;
}

/** Parse x.y.z with an optional prerelease. Anything else is not a version the
 * guard resolves. */
export function parseVersion(text: string): ParsedVersion | null {
  const m = /^v?([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(
    text.trim(),
  );
  if (m?.[1] === undefined || m[2] === undefined || m[3] === undefined) return null;
  const pre: Array<string | number> = [];
  if (m[4] !== undefined) {
    for (const part of m[4].split(".")) {
      if (part === "") return null;
      pre.push(/^[0-9]+$/u.test(part) ? Number(part) : part);
    }
  }
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre };
}

export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  if (a.pre.length === 0 && b.pre.length === 0) return 0;
  if (a.pre.length === 0) return 1;
  if (b.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i += 1) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === "number" && typeof y === "number") {
      if (x !== y) return x < y ? -1 : 1;
    } else if (typeof x === "number") return -1;
    else if (typeof y === "number") return 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

type Cmp = { op: "<" | "<=" | ">" | ">=" | "="; version: ParsedVersion };

function parsePartial(
  text: string,
): { major: number; minor: number | null; patch: number | null; pre: string | null } | null {
  const m = /^v?([0-9]+|[xX*])(?:\.([0-9]+|[xX*])(?:\.([0-9]+|[xX*])(-.*)?)?)?$/u.exec(text.trim());
  if (m?.[1] === undefined) return null;
  const num = (s: string | undefined): number | null =>
    s === undefined || /^[xX*]$/u.test(s) ? null : Number(s);
  return {
    major: m[1] === undefined || /^[xX*]$/u.test(m[1]) ? -1 : Number(m[1]),
    minor: num(m[2]),
    patch: num(m[3]),
    pre: m[4] ?? null,
  };
}

function caretUpper(major: number, minor: number, patch: number): ParsedVersion {
  if (major > 0) return { major: major + 1, minor: 0, patch: 0, pre: [] };
  if (minor > 0) return { major: 0, minor: minor + 1, patch: 0, pre: [] };
  return { major: 0, minor: 0, patch: patch + 1, pre: [] };
}

function tildeUpper(major: number, minor: number): ParsedVersion {
  if (minor === -1) return { major: major + 1, minor: 0, patch: 0, pre: [] };
  return { major, minor: minor + 1, patch: 0, pre: [] };
}

/** One comparator set (space-separated comparators, ANDed) plus whether the
 * range names a prerelease. Returns null when the range is not one the guard
 * resolves. */
export function parseRangeSet(text: string): { cmps: Cmp[]; prerelease: boolean } | null {
  const cmps: Cmp[] = [];
  let prerelease = false;
  const parts = text
    .trim()
    .split(/[ \t\n\r\f\v]+/u)
    .filter((p) => p !== "");
  if (parts.length === 0) return null;
  for (const part of parts) {
    if (part === "*" || part === "x" || part === "X") continue;
    const hyphen = /^(.+?)[ \t\n\r\f\v]+-[ \t\n\r\f\v]+(.+)$/u.exec(part);
    if (hyphen?.[1] !== undefined && hyphen[2] !== undefined) {
      const lo = parseVersion(hyphen[1]);
      const hi = parsePartial(hyphen[2]);
      if (lo === null || hi === null) return null;
      cmps.push({ op: ">=", version: lo });
      const upper: ParsedVersion =
        hi.patch !== null
          ? { major: hi.major, minor: hi.minor ?? 0, patch: hi.patch, pre: [] }
          : hi.minor !== null
            ? { major: hi.major, minor: hi.minor + 1, patch: 0, pre: [] }
            : { major: hi.major + 1, minor: 0, patch: 0, pre: [] };
      cmps.push({ op: hi.patch !== null ? "<=" : "<", version: upper });
      continue;
    }
    const opMatch = /^(<=|>=|<|>|=|~|\^)?(.*)$/u.exec(part);
    if (opMatch?.[2] === undefined) return null;
    const op = opMatch[1] ?? "";
    const rest = opMatch[2];
    if (op === "^" || op === "~") {
      const p = parsePartial(rest);
      if (p === null || p.major < 0) return null;
      if (p.pre !== null) prerelease = true;
      const minor = p.minor ?? 0;
      const patch = p.patch ?? 0;
      cmps.push({ op: ">=", version: { major: p.major, minor, patch, pre: [] } });
      cmps.push({
        op: "<",
        version:
          op === "^" ? caretUpper(p.major, minor, patch) : tildeUpper(p.major, p.minor ?? -1),
      });
      continue;
    }
    if (op === "<" || op === "<=" || op === ">" || op === ">=" || op === "=") {
      const v = parseVersion(rest);
      if (v === null) return null;
      if (v.pre.length > 0) prerelease = true;
      cmps.push({ op, version: v });
      continue;
    }
    if (rest === "" || rest === "*" || rest === "x" || rest === "X") continue;
    if (/[*xX]/u.test(rest)) {
      const p = parsePartial(rest);
      if (p === null) return null;
      if (p.major < 0) continue;
      if (p.minor === null) {
        cmps.push({ op: ">=", version: { major: p.major, minor: 0, patch: 0, pre: [] } });
        cmps.push({ op: "<", version: { major: p.major + 1, minor: 0, patch: 0, pre: [] } });
      } else if (p.patch === null) {
        cmps.push({ op: ">=", version: { major: p.major, minor: p.minor, patch: 0, pre: [] } });
        cmps.push({ op: "<", version: { major: p.major, minor: p.minor + 1, patch: 0, pre: [] } });
      } else {
        const v = parseVersion(rest);
        if (v === null) return null;
        cmps.push({ op: "=", version: v });
      }
      continue;
    }
    const v = parseVersion(rest);
    if (v === null) return null;
    if (v.pre.length > 0) prerelease = true;
    cmps.push({ op: "=", version: v });
  }
  return { cmps, prerelease };
}

function satisfiesSet(version: ParsedVersion, set: { cmps: Cmp[]; prerelease: boolean }): boolean {
  if (version.pre.length > 0 && !set.prerelease) {
    const sameRelease = set.cmps.some(
      (c) =>
        c.version.pre.length > 0 &&
        c.version.major === version.major &&
        c.version.minor === version.minor &&
        c.version.patch === version.patch,
    );
    if (!sameRelease) return false;
  }
  return set.cmps.every((c) => {
    const ord = compareVersions(version, c.version);
    switch (c.op) {
      case "<":
        return ord < 0;
      case "<=":
        return ord <= 0;
      case ">":
        return ord > 0;
      case ">=":
        return ord >= 0;
      case "=":
        return ord === 0;
    }
  });
}

/** Whether a version satisfies a range with || alternatives. False for ranges
 * the guard does not resolve. */
export function satisfiesRange(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (v === null) return false;
  const trimmed = range.trim();
  if (trimmed === "" || trimmed === "*" || trimmed === "latest") {
    return v.pre.length === 0;
  }
  return trimmed.split("||").some((alt) => {
    const set = parseRangeSet(alt);
    return set !== null && satisfiesSet(v, set);
  });
}

/** The highest version satisfying a range, or null when none does or the
 * range is not one the guard resolves. */
export function maxSatisfying(versions: string[], range: string): string | null {
  const trimmed = range.trim();
  if (trimmed === "" || trimmed === "*" || trimmed === "x" || trimmed === "X") {
    const finals = versions
      .map((s) => ({ s, v: parseVersion(s) }))
      .filter((p) => p.v !== null && p.v.pre.length === 0);
    finals.sort((a, b) =>
      compareVersions(
        b.v ?? { major: 0, minor: 0, patch: 0, pre: [] },
        a.v ?? { major: 0, minor: 0, patch: 0, pre: [] },
      ),
    );
    return finals[0]?.s ?? null;
  }
  const sets = trimmed.split("||").map((alt) => parseRangeSet(alt));
  if (sets.some((s) => s === null)) return null;
  let best: string | null = null;
  let bestParsed: ParsedVersion | null = null;
  for (const s of versions) {
    const v = parseVersion(s);
    if (v === null) continue;
    const ok = (sets as Array<{ cmps: Cmp[]; prerelease: boolean }>).some((set) =>
      satisfiesSet(v, set),
    );
    if (!ok) continue;
    if (bestParsed === null || compareVersions(v, bestParsed) > 0) {
      best = s;
      bestParsed = v;
    }
  }
  return best;
}

// ---------- specs ----------

export type Spec =
  | { kind: "registry"; name: string; range: string }
  | { kind: "alias"; name: string; target: string; range: string }
  | { kind: "local"; raw: string }
  | { kind: "remote"; raw: string };

const REMOTE_PREFIX = /^(?:git\+|git:|github:|gist:|bitbucket:|gitlab:|https?:|jsr:)/u;

/** Split an install spec into what the guard checks. Aliases resolve through
 * their target; local and remote specs never reach a registry. */
export function parseSpec(spec: string): Spec | null {
  const text = spec.trim();
  if (text === "" || text.startsWith("-")) return null;
  if (/^(?:file:|link:|portal:|workspace:)/u.test(text)) return { kind: "local", raw: text };
  if (REMOTE_PREFIX.test(text) || text.endsWith(".tgz") || text.endsWith(".tar.gz")) {
    return { kind: "remote", raw: text };
  }
  const at = text.lastIndexOf("@");
  if (at <= 0) return { kind: "registry", name: text, range: "*" };
  const name = text.slice(0, at);
  const range = text.slice(at + 1);
  if (name === "" || range === "") return null;
  if (name.includes("/") && !name.startsWith("@")) return null;
  const npmAlias = /^npm:(.+)$/u.exec(range);
  if (npmAlias?.[1] !== undefined) {
    const targetAt = npmAlias[1].lastIndexOf("@");
    if (targetAt <= 0) return { kind: "alias", name, target: npmAlias[1], range: "*" };
    return {
      kind: "alias",
      name,
      target: npmAlias[1].slice(0, targetAt),
      range: npmAlias[1].slice(targetAt + 1),
    };
  }
  return { kind: "registry", name, range };
}

/** Rewrite a registry spec to the exact version the guard checked. */
export function pinSpec(
  parsed: Extract<Spec, { kind: "registry" | "alias" }>,
  version: string,
): string {
  if (parsed.kind === "alias") return `${parsed.name}@npm:${parsed.target}@${version}`;
  return `${parsed.name}@${version}`;
}

// ---------- argv ----------

export type Classification =
  | { kind: "passthrough" }
  | { kind: "refuse"; message: string }
  | { kind: "add"; specs: string[]; positions: number[]; cmd: string }
  | { kind: "sync"; cmd: string }
  | { kind: "update"; specs: string[]; positions: number[]; cmd: string }
  | { kind: "rebuild"; names: string[] }
  | {
      kind: "oneshot";
      specs: string[];
      positions: number[];
      packages: string[];
      packagePositions: number[];
    };

export type YarnKind = "berry" | "classic";

const VALUED: Record<string, Set<string>> = {
  npm: new Set(["--registry", "--prefix", "-p", "--package", "-c", "--call", "-w", "--workspace"]),
  npx: new Set(["--registry", "--prefix", "-p", "--package", "-c", "--call", "-w", "--workspace"]),
  pnpm: new Set([
    "--registry",
    "-C",
    "--dir",
    "--filter",
    "-F",
    "--workspace",
    "-p",
    "--package",
    "-c",
    "--call",
  ]),
  yarn: new Set([
    "--registry",
    "--cwd",
    "--use-yarnrc",
    "--cache-folder",
    "--global-folder",
    "--modules-folder",
    "-p",
    "--package",
  ]),
  bun: new Set(["--registry", "--cwd", "-p", "--package"]),
};

interface Split {
  positionals: string[];
  positions: number[];
  flags: string[];
  flagPositions: number[];
}

/** Split argv after the command into positionals and flags, consuming the
 * values of flags that take one. Extraction is fail-closed: anything that is
 * not clearly a flag value is treated as a positional to check. */
export function splitArgs(pm: string, args: string[]): Split {
  const valued = VALUED[pm] ?? new Set<string>();
  const positionals: string[] = [];
  const positions: number[] = [];
  const flags: string[] = [];
  const flagPositions: number[] = [];
  let dashed = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (!dashed && arg === "--") {
      dashed = true;
      continue;
    }
    if (!dashed && arg.startsWith("-") && arg !== "-") {
      flags.push(arg);
      flagPositions.push(i);
      const eq = arg.indexOf("=");
      const name = eq < 0 ? arg : arg.slice(0, eq);
      if (eq < 0 && valued.has(name) && i + 1 < args.length) {
        i += 1;
        flags.push(args[i] ?? "");
        flagPositions.push(i);
      }
      continue;
    }
    positionals.push(arg);
    positions.push(i);
  }
  return { positionals, positions, flags, flagPositions };
}

const GLOBAL_FLAGS = new Set(["-g", "--global"]);

function hasGlobal(args: string[]): boolean {
  return args.some((a) => GLOBAL_FLAGS.has(a));
}

function flagValue(args: string[], names: string[]): string | null {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    for (const name of names) {
      if (arg === name && i + 1 < args.length) return args[i + 1] ?? null;
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
    }
  }
  return null;
}

/** Split leading global flags off argv: `npm --prefix D install foo` installs
 * foo with the command install, and the guard must see that, not a command
 * named --prefix. Returns the prefix, the command and what follows it, with
 * the shift that turns rest-relative positions into argv positions. */
export function commandOf(
  pm: string,
  argv: string[],
): { prefix: string[]; cmd: string; shift: number; rest: string[] } {
  const valued = VALUED[pm] ?? new Set<string>();
  let i = 0;
  let dashed = false;
  while (i < argv.length) {
    const arg = argv[i] ?? "";
    if (!dashed && arg === "--") {
      dashed = true;
      i += 1;
      continue;
    }
    if (!dashed && arg.startsWith("-") && arg !== "-") {
      const eq = arg.indexOf("=");
      const name = eq < 0 ? arg : arg.slice(0, eq);
      if (eq < 0 && valued.has(name) && i + 1 < argv.length) i += 1;
      i += 1;
      continue;
    }
    break;
  }
  return { prefix: argv.slice(0, i), cmd: argv[i] ?? "", shift: i + 1, rest: argv.slice(i + 1) };
}

/** The directory an invocation runs against: the process directory, moved by
 * --prefix/--dir/--cwd wherever the flags sit. */
export function projectOf(pm: Pm, argv: string[], cwd: string): string {
  const flag =
    pm === "npm"
      ? flagValue(argv, ["--prefix"])
      : pm === "pnpm"
        ? flagValue(argv, ["-C", "--dir"])
        : flagValue(argv, ["--cwd"]);
  if (flag === null || flag === "") return cwd;
  return flag.startsWith("/") ? flag : join(cwd, flag);
}

/** Commands that publish or manage registry credentials. Lanes never run
 * them; every branch refuses them before anything else. */
const PUBLISH = new Set([
  "publish",
  "unpublish",
  "login",
  "logout",
  "adduser",
  "token",
  "revoke",
  "owner",
  "deprecate",
  "access",
  "hook",
  "team",
  "org",
  "profile",
  "star",
  "unstar",
]);

function publishRefusal(prog: string, cmd: string): Classification {
  return {
    kind: "refuse",
    message: `${prog} ${cmd} publishes or manages registry credentials, which lanes never do`,
  };
}

/** Classify one package-manager invocation. Unknown commands pass through:
 * the install forms below are enumerated and tested, and a future install
 * command the guard does not know is a documented residual risk. */
export function classify(prog: string, argv: string[], yarnKind: YarnKind): Classification {
  const pm: Pm = prog === "npx" ? "npm" : (prog as Pm);
  if (prog === "npx") return classifyOneshot("npm", argv);
  const key = prog === "yarn" ? "yarn" : pm;
  const { prefix, cmd, shift, rest } = commandOf(key, argv);
  const split = splitArgs(key, rest);
  const first = (n: number): string => split.positionals[n] ?? "";
  const all = [...prefix, ...rest];
  const pos = split.positions.map((p) => p + shift);
  if (PUBLISH.has(cmd)) return publishRefusal(prog, cmd);
  if (pm === "yarn" && cmd === "") {
    // A bare yarn installs; only version and help pass.
    if (all.some((a) => a === "--version" || a === "-V" || a === "--help" || a === "-h")) {
      return { kind: "passthrough" };
    }
    return { kind: "sync", cmd: "install" };
  }

  if (pm === "npm") {
    if (cmd === "install-scripts") {
      if (first(0) === "ls" || split.positionals.length === 0) return { kind: "passthrough" };
      return {
        kind: "refuse",
        message: `npm install-scripts ${first(0)} writes the project's script approvals, which only the run's ask flow grants`,
      };
    }
    if (cmd === "dist-tag") {
      if (first(0) === "ls" || first(0) === "list") return { kind: "passthrough" };
      return publishRefusal(prog, cmd);
    }
    if (cmd === "exec") return classifyOneshot("npm", rest);
    if (cmd === "install" || cmd === "i" || cmd === "add") {
      if (hasGlobal(all))
        return {
          kind: "refuse",
          message: "global installs land outside the project; install into the project instead",
        };
      if (all.includes("--package-lock-only")) {
        return {
          kind: "refuse",
          message:
            "npm install --package-lock-only resolves without the guard; add the library with npm add instead",
        };
      }
      if (all.includes("--dry-run") && split.positionals.length === 0)
        return { kind: "passthrough" };
      if (split.positionals.length === 0) return { kind: "sync", cmd };
      return { kind: "add", specs: split.positionals, positions: pos, cmd };
    }
    if (cmd === "ci") {
      if (hasGlobal(all))
        return {
          kind: "refuse",
          message: "global installs land outside the project; install into the project instead",
        };
      if (all.includes("--dry-run")) return { kind: "passthrough" };
      return { kind: "sync", cmd };
    }
    if (cmd === "update" || cmd === "up" || cmd === "upgrade") {
      if (split.positionals.length === 0) {
        return {
          kind: "refuse",
          message:
            "a bare npm update floats every dependency past its locked version; add what is needed with npm add instead",
        };
      }
      return { kind: "update", specs: split.positionals, positions: pos, cmd };
    }
    if (cmd === "rebuild") {
      if (split.positionals.length === 0) {
        return {
          kind: "refuse",
          message:
            "a bare npm rebuild runs every dependency's install scripts; name the allowed packages instead",
        };
      }
      return { kind: "rebuild", names: split.positionals };
    }
    if (cmd === "audit" && all.includes("--fix")) {
      return {
        kind: "refuse",
        message:
          "npm audit fix floats versions past the lockfile; add what is needed with npm add instead",
      };
    }
    return { kind: "passthrough" };
  }

  if (pm === "pnpm") {
    if (cmd === "approve-builds") {
      return {
        kind: "refuse",
        message:
          "pnpm approve-builds writes the project's build approvals, which only the run's ask flow grants",
      };
    }
    if (cmd === "dist-tag") {
      if (first(0) === "ls" || first(0) === "list") return { kind: "passthrough" };
      return publishRefusal(prog, cmd);
    }
    if (cmd === "dlx") return classifyOneshot("pnpm", rest);
    if (cmd === "exec") {
      // pnpm --package=foo exec bar downloads foo: the packages are checked
      // like a one-shot's.
      const at: string[] = [];
      const atPos: number[] = [];
      const both = [...prefix, ...rest];
      const abs = (i: number): number => (i < prefix.length ? i : i + 1);
      for (let i = 0; i < both.length; i += 1) {
        const arg = both[i] ?? "";
        if ((arg === "--package" || arg === "-p") && i + 1 < both.length) {
          at.push(both[i + 1] ?? "");
          atPos.push(abs(i + 1));
          i += 1;
        } else if (arg.startsWith("--package=")) {
          at.push(arg.slice("--package=".length));
          atPos.push(abs(i));
        }
      }
      if (at.length > 0) {
        return { kind: "oneshot", specs: [], positions: [], packages: at, packagePositions: atPos };
      }
      return { kind: "passthrough" };
    }
    if (cmd === "add" || cmd === "install" || cmd === "i") {
      if (hasGlobal(all))
        return {
          kind: "refuse",
          message: "global installs land outside the project; install into the project instead",
        };
      if (all.includes("--lockfile-only")) {
        return {
          kind: "refuse",
          message:
            "pnpm install --lockfile-only resolves without the guard; add the library with pnpm add instead",
        };
      }
      if (all.includes("--dry-run") && split.positionals.length === 0)
        return { kind: "passthrough" };
      if (split.positionals.length === 0) return { kind: "sync", cmd };
      return { kind: "add", specs: split.positionals, positions: pos, cmd };
    }
    if (cmd === "update" || cmd === "up" || cmd === "upgrade") {
      if (split.positionals.length === 0) {
        return {
          kind: "refuse",
          message:
            "a bare pnpm update floats every dependency past its locked version; add what is needed with pnpm add instead",
        };
      }
      return { kind: "update", specs: split.positionals, positions: pos, cmd };
    }
    if (cmd === "rebuild") {
      if (split.positionals.length === 0) {
        return {
          kind: "refuse",
          message:
            "a bare pnpm rebuild runs every dependency's install scripts; name the allowed packages instead",
        };
      }
      return { kind: "rebuild", names: split.positionals };
    }
    if (cmd === "audit" && all.includes("--fix")) {
      return {
        kind: "refuse",
        message:
          "pnpm audit --fix floats versions past the lockfile; add what is needed with pnpm add instead",
      };
    }
    return { kind: "passthrough" };
  }

  if (pm === "yarn" && yarnKind === "classic") {
    if (cmd === "add") {
      if (hasGlobal(all))
        return {
          kind: "refuse",
          message: "global installs land outside the project; install into the project instead",
        };
      if (split.positionals.length === 0) return { kind: "sync", cmd };
      return { kind: "add", specs: split.positionals, positions: pos, cmd };
    }
    if (cmd === "install") {
      // Classic answers install-with-arguments with its own usage error before
      // any download, so the guard leaves that error alone.
      if (split.positionals.length > 0) return { kind: "passthrough" };
      return { kind: "sync", cmd };
    }
    if (cmd === "upgrade") {
      if (split.positionals.length === 0) {
        return {
          kind: "refuse",
          message:
            "a bare yarn upgrade floats every dependency past its locked version; add what is needed with yarn add instead",
        };
      }
      return { kind: "update", specs: split.positionals, positions: pos, cmd };
    }
    if (cmd === "global") {
      return {
        kind: "refuse",
        message: "global installs land outside the project; install into the project instead",
      };
    }
    if (cmd === "tag") {
      return publishRefusal(prog, cmd);
    }
    if (cmd === "config" && (first(0) === "set" || first(0) === "delete")) {
      return {
        kind: "refuse",
        message:
          "yarn config set and delete write configuration outside the install; configuration is the user's",
      };
    }
    // Classic has no rebuild: an unknown command falls through to the
    // project's own scripts, which are the lane's code.
    return { kind: "passthrough" };
  }

  if (pm === "yarn") {
    if (cmd === "npm") {
      return publishRefusal(prog, cmd);
    }
    if (cmd === "add" || cmd === "install") {
      const mode = flagValue(all, ["--mode"]);
      if (mode === "update-lockfile") {
        return {
          kind: "refuse",
          message:
            "yarn install --mode update-lockfile resolves without the guard; add the library with yarn add instead",
        };
      }
      if (cmd === "add" && split.positionals.length === 0) return { kind: "sync", cmd };
      if (cmd === "install" && split.positionals.length === 0) return { kind: "sync", cmd };
      if (cmd === "install") {
        return { kind: "add", specs: split.positionals, positions: pos, cmd };
      }
      return { kind: "add", specs: split.positionals, positions: pos, cmd };
    }
    if (cmd === "up" || cmd === "upgrade") {
      if (split.positionals.length === 0) {
        return {
          kind: "refuse",
          message:
            "a bare yarn up floats every dependency past its locked version; add what is needed with yarn add instead",
        };
      }
      return { kind: "update", specs: split.positionals, positions: pos, cmd };
    }
    if (cmd === "rebuild") {
      return {
        kind: "refuse",
        message:
          "yarn rebuild rebuilds more than the names it is given, so no allowance covers it; sync or add instead",
      };
    }
    if (cmd === "dlx") return classifyOneshot("yarn", rest);
    if (cmd === "exec") return { kind: "passthrough" };
    if (cmd === "config" && first(0) === "set" && (all.includes("-H") || all.includes("--home"))) {
      return {
        kind: "refuse",
        message:
          "yarn config set --home writes the user's own configuration; configuration is the user's",
      };
    }
    return { kind: "passthrough" };
  }

  // bun
  if (cmd === "add" || cmd === "install" || cmd === "i") {
    if (hasGlobal(all))
      return {
        kind: "refuse",
        message: "global installs land outside the project; install into the project instead",
      };
    if (all.includes("--lockfile-only")) {
      return {
        kind: "refuse",
        message:
          "bun install --lockfile-only resolves without the guard; add the library with bun add instead",
      };
    }
    if (all.includes("--dry-run") && split.positionals.length === 0) return { kind: "passthrough" };
    if (split.positionals.length === 0) return { kind: "sync", cmd };
    return { kind: "add", specs: split.positionals, positions: pos, cmd };
  }
  if (cmd === "update") {
    if (split.positionals.length === 0) {
      return {
        kind: "refuse",
        message:
          "a bare bun update floats every dependency past its locked version; add what is needed with bun add instead",
      };
    }
    return { kind: "update", specs: split.positionals, positions: pos, cmd };
  }
  if (cmd === "x") {
    // --no-install cannot download: a missing binary fails in Bun itself.
    if (all.includes("--no-install")) return { kind: "passthrough" };
    return classifyOneshot("bun", rest);
  }
  if (cmd === "pm" && first(0) === "trust") {
    return {
      kind: "refuse",
      message:
        "bun pm trust writes the project's trusted dependencies, which only the run's ask flow grants",
    };
  }
  // Bun has no rebuild; an unknown command errors in Bun itself.
  return { kind: "passthrough" };
}

/** One-shot package runs: -p values are always specs to check, while a bare
 * positional names a spec only when no -p is present (with -p it names a bin
 * from those packages). A -c call string cannot be verified, so a call with
 * no other specs is refused. */
export function classifyOneshot(pm: string, args: string[]): Classification {
  const split = splitArgs(pm, args);
  const packages: string[] = [];
  const packagePositions: number[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (arg === "-p" || arg === "--package") {
      if (i + 1 < args.length) {
        packages.push(args[i + 1] ?? "");
        packagePositions.push(i + 1);
        i += 1;
      }
    } else if (arg.startsWith("--package=")) {
      packages.push(arg.slice("--package=".length));
      packagePositions.push(i);
    }
  }
  const hasCall = args.some((a) => a === "-c" || a === "--call" || a.startsWith("--call="));
  if (packages.length > 0) {
    return { kind: "oneshot", specs: [], positions: [], packages, packagePositions };
  }
  if (split.positionals.length === 0) {
    if (hasCall)
      return { kind: "refuse", message: "a one-shot call names no package the guard can check" };
    return { kind: "passthrough" };
  }
  return {
    kind: "oneshot",
    specs: [split.positionals[0] ?? ""],
    positions: [split.positions[0] ?? 0],
    packages,
    packagePositions,
  };
}

// ---------- sanitizing ----------

const STRIP_BARE = new Set([
  "--no-ignore-scripts",
  "--dangerously-allow-all-scripts",
  "--no-frozen-lockfile",
  "--no-immutable",
  "--trust",
]);

const STRIP_NPM = new Set(["--audit", "--fund", "--no-audit", "--no-fund"]);

/** Strip the flags that would neuter the guard, and the agent's registry,
 * which the pinned registry replaces on install forms. Returns the stripped
 * flags for the note the guard prints. */
export function sanitize(pm: Pm, args: string[]): { kept: string[]; stripped: string[] } {
  const kept: string[] = [];
  const stripped: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (STRIP_BARE.has(arg) || (pm === "npm" && STRIP_NPM.has(arg))) {
      stripped.push(arg);
      continue;
    }
    const valuedAllowBuild = arg === "--allow-build" && pm === "pnpm";
    if (arg === "--registry" || valuedAllowBuild) {
      stripped.push(arg);
      if (i + 1 < args.length && !(args[i + 1] ?? "").startsWith("-")) {
        i += 1;
        stripped.push(args[i] ?? "");
      }
      continue;
    }
    if (arg.startsWith("--registry=") || (arg.startsWith("--allow-build=") && pm === "pnpm")) {
      stripped.push(arg);
      continue;
    }
    kept.push(arg);
  }
  return { kept, stripped };
}

// ---------- support detection ----------

const OTHER_SIGNALS: Array<{ files: string[]; manager: string }> = [
  { files: ["Cargo.toml"], manager: "cargo" },
  {
    files: [
      "pyproject.toml",
      "setup.py",
      "setup.cfg",
      "requirements.txt",
      "Pipfile",
      "poetry.lock",
      "uv.lock",
    ],
    manager: "python",
  },
  { files: ["go.mod"], manager: "go" },
  { files: ["Gemfile"], manager: "ruby" },
  { files: ["composer.json"], manager: "php" },
  { files: ["pom.xml", "build.gradle", "build.gradle.kts"], manager: "java" },
  { files: ["Package.swift"], manager: "swift" },
  { files: ["deno.json", "deno.jsonc"], manager: "deno" },
];

/** The JavaScript managers a project answers to, by lockfile; a manifest
 * with no lockfile yet still reads as JavaScript. */
export function jsManagers(project: string): string[] {
  const found: string[] = [];
  if (
    existsSync(join(project, "package-lock.json")) ||
    existsSync(join(project, "npm-shrinkwrap.json"))
  ) {
    found.push("npm");
  }
  if (existsSync(join(project, "pnpm-lock.yaml"))) found.push("pnpm");
  const berryRc = existsSync(join(project, ".yarnrc.yml"));
  if (existsSync(join(project, "yarn.lock"))) found.push(berryRc ? "berry" : "yarn");
  else if (berryRc) found.push("berry");
  if (existsSync(join(project, "bun.lock")) || existsSync(join(project, "bun.lockb")))
    found.push("bun");
  if (found.length === 0 && existsSync(join(project, "package.json"))) found.push("javascript");
  return found;
}

/** The non-JavaScript managers a project answers to, each named once. */
export function otherManagers(project: string): string[] {
  const found = new Set<string>();
  for (const signal of OTHER_SIGNALS) {
    if (signal.files.some((f) => existsSync(join(project, f)))) found.add(signal.manager);
  }
  try {
    for (const entry of readdirSync(project)) {
      if (/\.csproj$|\.sln$|\.fsproj$/u.test(entry)) found.add("dotnet");
    }
  } catch {
    // An unreadable directory reads as no managers.
  }
  return [...found].sort();
}

export interface Support {
  js: string[];
  other: string[];
}

/** Which managers a project answers to: the JavaScript ones the guard
 * covers, and the others it does not. */
export function detectSupport(project: string): Support {
  return { js: jsManagers(project), other: otherManagers(project) };
}

/** The dependency names package.json adds past the npm lockfile, or null when
 * there is no lockfile to drift from. Skips the check when either file does
 * not parse, leaving that failure to npm itself. */
export function npmDriftNames(project: string, lockFile?: string): string[] | null {
  const lockPath = lockFile ?? join(project, "package-lock.json");
  const manifestFile = join(project, "package.json");
  if (!existsSync(lockPath) || !existsSync(manifestFile)) return null;
  let manifest: unknown;
  let lock: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as unknown;
    lock = JSON.parse(readFileSync(lockPath, "utf8")) as unknown;
  } catch {
    return null;
  }
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    typeof lock !== "object" ||
    lock === null
  )
    return null;
  const wanted = new Set<string>();
  const m = manifest as Record<string, unknown>;
  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const deps = m[section];
    if (typeof deps === "object" && deps !== null) {
      for (const name of Object.keys(deps as Record<string, unknown>)) wanted.add(name);
    }
  }
  const locked = new Set<string>();
  const l = lock as Record<string, unknown>;
  const packages = l.packages;
  if (typeof packages === "object" && packages !== null) {
    for (const key of Object.keys(packages as Record<string, unknown>)) {
      const parts = key.split("node_modules/");
      const last = parts[parts.length - 1] ?? "";
      if (last !== "")
        locked.add(
          last
            .split("/")
            .slice(0, last.startsWith("@") ? 2 : 1)
            .join("/"),
        );
    }
  }
  const deps = l.dependencies;
  if (typeof deps === "object" && deps !== null) {
    for (const name of Object.keys(deps as Record<string, unknown>)) locked.add(name);
  }
  return [...wanted].filter((w) => !locked.has(w)).sort();
}

// ---------- fetching ----------

export interface PackumentVersion {
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

export interface Packument {
  name: string;
  tags: Record<string, string>;
  versions: Record<string, PackumentVersion>;
  time: Record<string, string>;
  repository: unknown;
}

export type Verdict =
  | { status: "clean" }
  | { status: "flagged"; types: string[] }
  | { status: "unknown"; why: string };

export interface GuardContext {
  dispatch: string;
  lane: string;
  cacheDir: string;
  registry: string;
  socketApi: string;
}

const FETCH_TIMEOUT_MS = 20000;
const CONCURRENCY = 8;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function cacheFile(cacheDir: string, kind: string, key: string): string {
  return join(cacheDir, kind, `${encodeURIComponent(key)}.json`);
}

function readCache(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function writeCache(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

async function fetchText(url: string, agent: string): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    headers: { "User-Agent": agent, Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return { status: res.status, text: await res.text() };
}

/** One package's registry document, cached for the run. Anything unreadable
 * throws a refusal: a package the guard cannot check is not installed. */
export async function fetchPackument(ctx: GuardContext, name: string): Promise<Packument> {
  const agent = "postmaster-install-guard";
  const cached = readCache(cacheFile(ctx.cacheDir, "packuments", name));
  const parse = (text: string): Packument | null => {
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      return null;
    }
    if (typeof json !== "object" || json === null) return null;
    const doc = json as Record<string, unknown>;
    if (typeof doc.name !== "string") return null;
    const versions: Record<string, PackumentVersion> = {};
    if (typeof doc.versions === "object" && doc.versions !== null) {
      for (const [ver, entry] of Object.entries(doc.versions as Record<string, unknown>)) {
        if (typeof entry !== "object" || entry === null) continue;
        const e = entry as Record<string, unknown>;
        const strMap = (v: unknown): Record<string, string> | undefined => {
          if (typeof v !== "object" || v === null) return undefined;
          const out: Record<string, string> = {};
          for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
            if (typeof val === "string") out[k] = val;
          }
          return out;
        };
        versions[ver] = {
          version: typeof e.version === "string" ? e.version : ver,
          dependencies: strMap(e.dependencies),
          optionalDependencies: strMap(e.optionalDependencies),
          peerDependencies: strMap(e.peerDependencies),
          scripts: e.scripts === undefined ? undefined : (strMap(e.scripts) ?? {}),
        };
      }
    }
    const tags: Record<string, string> = {};
    if (typeof doc["dist-tags"] === "object" && doc["dist-tags"] !== null) {
      for (const [k, val] of Object.entries(doc["dist-tags"] as Record<string, unknown>)) {
        if (typeof val === "string") tags[k] = val;
      }
    }
    const time: Record<string, string> = {};
    if (typeof doc.time === "object" && doc.time !== null) {
      for (const [k, val] of Object.entries(doc.time as Record<string, unknown>)) {
        if (typeof val === "string") time[k] = val;
      }
    }
    return { name: doc.name, tags, versions, time, repository: doc.repository };
  };
  if (cached !== null) {
    const parsed = parse(cached);
    if (parsed !== null) return parsed;
  }
  const path = name
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");
  let status = 0;
  let text = "";
  try {
    const r = await fetchText(`${ctx.registry.replace(/\/$/u, "")}/${path}`, agent);
    status = r.status;
    text = r.text;
  } catch {
    refuse(`install-guard: refusing to install ${name}: the registry cannot be reached`);
  }
  if (status < 200 || status >= 300) {
    refuse(`install-guard: refusing to install ${name}: the registry answers ${status} for it`);
  }
  const parsed = parse(text);
  if (parsed === null) {
    throw refusal(
      `install-guard: refusing to install ${name}: its registry document does not parse`,
    );
  }
  writeCache(cacheFile(ctx.cacheDir, "packuments", name), text);
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

/** Socket's free verdict for one exact version, cached for the run. Mirrors
 * the official scanner: one purl per GET, retries on 408/429/5xx, every
 * non-monitor alert flags the package, and a synthetic answer means the
 * scanner has no verdict. */
export async function fetchVerdict(
  ctx: GuardContext,
  name: string,
  version: string,
): Promise<Verdict> {
  const key = `${name}@${version}`;
  const cached = readCache(cacheFile(ctx.cacheDir, "verdicts", key));
  if (cached !== null) {
    try {
      const parsed = JSON.parse(cached) as Verdict;
      if (parsed.status === "clean" || parsed.status === "flagged" || parsed.status === "unknown") {
        return parsed;
      }
    } catch {
      // fall through and refetch
    }
  }
  const purl = `pkg:npm/${name}@${version}`;
  const url = `${ctx.socketApi.replace(/\/$/u, "")}/purl/${encodeURIComponent(purl)}`;
  let status = 0;
  let text = "";
  let failed = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt > 0) await sleep(1000 * attempt);
    try {
      const r = await fetchText(url, "postmaster-install-guard");
      status = r.status;
      text = r.text;
    } catch (e) {
      failed = e instanceof Error ? e.message : String(e);
      continue;
    }
    if (status === 408 || status === 429 || status >= 500) {
      failed = `HTTP ${status}`;
      continue;
    }
    failed = "";
    break;
  }
  let verdict: Verdict;
  if (failed !== "") {
    verdict = { status: "unknown", why: `the Socket scanner is unreachable (${failed})` };
  } else if (status < 200 || status >= 300) {
    verdict = { status: "unknown", why: `the Socket scanner answers HTTP ${status}` };
  } else {
    const first = text
      .split(/\r?\n/u)
      .map((l) => l.trim())
      .find((l) => l !== "");
    if (first === undefined) {
      verdict = { status: "unknown", why: "the Socket scanner answers with no verdict" };
    } else {
      let artifact: Record<string, unknown> | null = null;
      try {
        const parsed = JSON.parse(first) as unknown;
        if (typeof parsed === "object" && parsed !== null)
          artifact = parsed as Record<string, unknown>;
      } catch {
        artifact = null;
      }
      if (artifact === null) {
        verdict = { status: "unknown", why: "the Socket scanner's answer does not parse" };
      } else if (typeof artifact.id === "string" && artifact.id.startsWith("synthetic:")) {
        verdict = { status: "unknown", why: "the Socket scanner has no verdict for it" };
      } else {
        const alerts = Array.isArray(artifact.alerts) ? artifact.alerts : [];
        const types = alerts
          .filter(
            (a): a is Record<string, unknown> =>
              typeof a === "object" &&
              a !== null &&
              (a as Record<string, unknown>).action !== "monitor",
          )
          .map((a) => (typeof a.type === "string" ? a.type : "alert"));
        verdict = types.length > 0 ? { status: "flagged", types } : { status: "clean" };
      }
    }
  }
  writeCache(cacheFile(ctx.cacheDir, "verdicts", key), JSON.stringify(verdict));
  return verdict;
}

// ---------- resolving ----------

export interface Resolved {
  name: string;
  version: string;
  scripts: Record<string, string> | null;
  direct: boolean;
}

/** The version a range names: a bare spec follows the latest tag the way the
 * managers do, an exact version names itself, and anything else resolves by
 * semver. Null when nothing is named. */
export function resolveVersion(doc: Packument, range: string): string | null {
  const want = range.trim() === "*" ? "latest" : range.trim();
  const tag = doc.tags[want];
  if (tag !== undefined) return tag;
  const available = Object.keys(doc.versions);
  if (available.includes(want)) return want;
  if (want === "latest") return maxSatisfying(available, "*");
  return maxSatisfying(available, want);
}

/** Resolve one spec through the registry. Tags resolve through dist-tags, a
 * bare name through latest, and anything else through semver. Refuses what it
 * cannot resolve. */
export async function resolveSpec(
  ctx: GuardContext,
  spec: string,
  parsed: Extract<Spec, { kind: "registry" | "alias" }>,
): Promise<{ name: string; version: string }> {
  const name = parsed.kind === "alias" ? parsed.target : parsed.name;
  const doc = await fetchPackument(ctx, name);
  const best = resolveVersion(doc, parsed.range);
  if (best === null) {
    throw refusal(
      `install-guard: refusing to install ${spec}: no published version of ${name} meets ${parsed.range}`,
    );
  }
  return { name, version: best };
}

/** The installed version satisfying a peer range, or null when the tree does
 * not satisfy it and the manager will fetch. */
export function treePeerVersion(project: string, name: string, range: string): string | null {
  const manifest = join(project, "node_modules", ...name.split("/"), "package.json");
  try {
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown };
    if (typeof parsed.version !== "string") return null;
    return satisfiesRange(parsed.version, range) ? parsed.version : null;
  } catch {
    return null;
  }
}

interface QueueItem {
  name: string;
  range: string;
  direct: boolean;
  fromPeer: boolean;
}

/** Resolve every spec and what it brings: dependencies and optional
 * dependencies recurse by max-satisfying range, while peers resolve from the
 * installed tree where it satisfies them and by range otherwise. Keyed by
 * name and range, so two ranges that meet different versions both get
 * checked, the way the manager installs both. */
export async function resolveClosure(
  ctx: GuardContext,
  project: string,
  specs: Array<{ raw: string; parsed: Extract<Spec, { kind: "registry" | "alias" }> }>,
): Promise<Map<string, Resolved>> {
  const resolved = new Map<string, Resolved>();
  const seen = new Set<string>();
  const queue: QueueItem[] = [];
  for (const s of specs) {
    const name = s.parsed.kind === "alias" ? s.parsed.target : s.parsed.name;
    const key = `${name}@${s.parsed.range}`;
    if (seen.has(key)) continue;
    seen.add(key);
    queue.push({ name, range: s.parsed.range, direct: true, fromPeer: false });
  }
  const raws = new Map(
    specs.map((s) => [
      `${s.parsed.kind === "alias" ? s.parsed.target : s.parsed.name}@${s.parsed.range}`,
      s.raw,
    ]),
  );
  let guard = 0;
  const docCache = new Map<string, Packument>();
  const docFor = async (name: string): Promise<Packument> => {
    const hit = docCache.get(name);
    if (hit !== undefined) return hit;
    const doc = await fetchPackument(ctx, name);
    docCache.set(name, doc);
    return doc;
  };
  while (queue.length > 0) {
    guard += 1;
    if (guard > 2000 || resolved.size > 1000) {
      refuse("install-guard: refusing to install: the dependency closure is too deep to check");
    }
    const batch = queue.splice(0, CONCURRENCY);
    const docs = await Promise.all(batch.map((item) => docFor(item.name)));
    for (let i = 0; i < batch.length; i += 1) {
      const item = batch[i];
      const doc = docs[i];
      if (item === undefined || doc === undefined) continue;
      const raw = raws.get(`${item.name}@${item.range}`) ?? `${item.name}@${item.range}`;
      let version: string | null = null;
      if (item.fromPeer) {
        version = treePeerVersion(project, item.name, item.range);
      }
      if (version === null) {
        version = resolveVersion(doc, item.range);
      }
      if (version === null) {
        throw refusal(
          `install-guard: refusing to install ${raw}: no published version of ${item.name} meets ${item.range}`,
        );
      }
      const entry = doc.versions[version];
      if (entry === undefined) {
        throw refusal(
          `install-guard: refusing to install ${raw}: the registry has no ${item.name}@${version}`,
        );
      }
      resolved.set(`${item.name}@${version}`, {
        name: item.name,
        version,
        scripts: entry.scripts ?? null,
        direct: item.direct,
      });
      const deps: Array<[Record<string, string> | undefined, boolean]> = [
        [entry.dependencies, false],
        [entry.optionalDependencies, false],
        [entry.peerDependencies, true],
      ];
      for (const [map, peer] of deps) {
        if (map === undefined) continue;
        for (const [dep, range] of Object.entries(map)) {
          const key = `${dep}@${range}`;
          if (seen.has(key)) continue;
          seen.add(key);
          queue.push({ name: dep, range, direct: false, fromPeer: peer });
        }
      }
    }
  }
  return resolved;
}

// ---------- checking ----------

/** Run fn over items with at most n in flight. */
export async function mapPool<T, R>(
  items: T[],
  n: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length }) as R[];
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

/** The age of a published version in milliseconds, or null when the doc does
 * not say. */
export function versionAgeMs(doc: Packument, version: string, now: number): number | null {
  const stamp = doc.time[version];
  if (stamp === undefined) return null;
  const published = Date.parse(stamp);
  if (Number.isNaN(published)) return null;
  return now - published;
}

export interface ParsedAddSpec {
  raw: string;
  parsed: Extract<Spec, { kind: "registry" | "alias" }>;
  /** The name the checks run against: the alias target for aliases. */
  name: string;
}

/** Parse add specs into registry names. Anything that never reaches a
 * registry — paths, archives, git — is refused outright. */
export function parseAddSpecs(specs: string[]): ParsedAddSpec[] {
  return specs.map((raw) => {
    const parsed = parseSpec(raw);
    if (parsed === null) {
      throw refusal(
        `install-guard: refusing to install ${raw}: it is not an install spec the guard can check`,
      );
    }
    if (parsed.kind !== "registry" && parsed.kind !== "alias") {
      throw refusal(
        `install-guard: refusing to install ${raw}: lanes install only registry libraries`,
      );
    }
    return { raw, parsed, name: parsed.kind === "alias" ? parsed.target : parsed.name };
  });
}

/** Refuse specs whose names the ticket never lists, before any download. The
 * exact version is checked after resolution, in checkAdd. */
export function listPrecheck(libs: ListedLibrary[], specs: ParsedAddSpec[]): void {
  for (const s of specs) {
    if (!libs.some((l) => l.name === s.name)) {
      refuse(
        `install-guard: refusing to install ${s.raw}: ${s.name} is not on the ticket's ## Libraries list`,
      );
    }
  }
}

/** Check a resolved closure: direct specs need the ticket's exact version and
 * the recorded yes, every member needs its seven days or a waiver and the
 * scanner's clean verdict, and every scriptful member needs its allowance.
 * Returns the covered scriptful names, which the executor runs scripts for.
 * Concentrates the messages the ask flow sends. */
export async function checkAdd(
  ctx: GuardContext,
  libs: ListedLibrary[],
  approvals: LibApprovals,
  closure: Map<string, Resolved>,
  docFor: (name: string) => Promise<Packument>,
): Promise<{ scriptful: string[] }> {
  const members = [...closure.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
  const now = Date.now();
  for (const r of members) {
    const at = `${r.name}@${r.version}`;
    if (r.direct) {
      if (!listsVersion(libs, r.name, r.version)) {
        refuse(
          `install-guard: refusing to install ${at}: the ticket's ## Libraries list names no ${at}`,
        );
      }
      if (!approvals.yes.has(at)) {
        refuse(`install-guard: refusing to install ${at}: the run records no yes for it`);
      }
    }
    const doc = await docFor(r.name);
    const age = versionAgeMs(doc, r.version, now);
    if ((age === null || age < WEEK_MS) && !approvals.waivers.has(at)) {
      if (age === null) {
        throw refusal(
          `install-guard: refusing to install ${at}: it has no published date, so the seven days wait cannot be checked. Ask for an age waiver first`,
        );
      }
      const days = Math.floor(age / (24 * 60 * 60 * 1000));
      refuse(
        `install-guard: refusing to install ${at}: it is ${days} ${days === 1 ? "day" : "days"} old, and every version waits seven days. Ask for an age waiver first`,
      );
    }
  }
  const verdicts = await mapPool(members, CONCURRENCY, async (r) => ({
    r,
    verdict: await fetchVerdict(ctx, r.name, r.version),
  }));
  for (const { r, verdict } of verdicts) {
    const at = `${r.name}@${r.version}`;
    if (verdict.status === "flagged") {
      refuse(
        `install-guard: refusing to install ${at}: the Socket scanner flags it (${verdict.types.join(", ")})`,
      );
    }
    if (verdict.status === "unknown") {
      refuse(
        `install-guard: refusing to install ${at}: ${verdict.why}; a lane installs only what the scanner clears`,
      );
    }
  }
  const scriptful = members.filter((r) => r.scripts !== null && Object.keys(r.scripts).length > 0);
  for (const r of scriptful) {
    if (!approvals.allowances.has(r.name)) {
      const names = Object.keys(r.scripts ?? {}).join(", ");
      refuse(
        `install-guard: refusing to install ${r.name}@${r.version}: it runs an install script (${names}) and the run records no allowance for ${r.name}. Ask for a script-allow first`,
      );
    }
  }
  return { scriptful: [...new Set(scriptful.map((r) => r.name))].sort() };
}

// ---------- executing ----------

/** The manager binary outside the guard's shims: the first hit on the PATH
 * that is not the shim dir. Empty entries (the working directory) never
 * count, so a file named npm in the project cannot catch the guard. */
export function managerBin(prog: string, shimDir: string): string | null {
  const path = process.env.PATH ?? "";
  const clean = (d: string): string => (d.endsWith("/") ? d.slice(0, -1) : d);
  const shim = clean(shimDir);
  for (const dir of path.split(":")) {
    if (dir === "" || clean(dir) === shim) continue;
    const hit = join(dir, prog);
    try {
      if (statSync(hit).isFile()) return hit;
    } catch {
      continue;
    }
  }
  return null;
}

/** Run the manager and forward its output, so the lane sees the manager's
 * own words. Retries shebangless wrappers under sh the way shells do.
 * Returns the exit code. */
export function execManager(
  bin: string,
  args: string[],
  env: Record<string, string | undefined>,
): number {
  let r = runCmd(bin, args, { env });
  if (r.code === 1 && /ENOEXEC/u.test(r.err) && existsSync(bin)) {
    r = runCmd("sh", [bin, ...args], { env });
  }
  process.stdout.write(r.out);
  process.stderr.write(r.err);
  return r.code;
}

/** The environment a manager runs in: the lane's, minus a smuggled registry,
 * plus the manager's own seams. The PATH keeps the shims, so code an allowed
 * install script runs still cannot invoke an unguarded manager. */
export function execEnv(
  extra: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return { npm_config_registry: undefined, ...extra };
}

/** Classic or Berry: the rc file says Berry before any binary runs, and the
 * version says otherwise. */
export function detectYarnKind(project: string, yarnBin: string | null): YarnKind {
  if (existsSync(join(project, ".yarnrc.yml"))) return "berry";
  if (yarnBin === null) {
    throw refusal(
      "install-guard: refusing to run yarn: yarn is not on the PATH outside the guard's shims",
    );
  }
  const r = runCmd(yarnBin, ["--version"]);
  const major = /^([0-9]+)\./u.exec(r.out.trim())?.[1];
  if (r.code !== 0 || major === undefined) {
    refuse(
      "install-guard: refusing to run yarn: its version does not answer, so Classic and Berry cannot be told apart",
    );
  }
  return major === "1" ? "classic" : "berry";
}

/** The installed packages providing a binary, by their bin maps. */
export function binProviders(project: string, bin: string): string[] {
  if (bin === "" || bin.includes("/") || bin.includes("\\")) return [];
  const root = join(project, "node_modules");
  let top: string[];
  try {
    top = readdirSync(root);
  } catch {
    return [];
  }
  const found: string[] = [];
  const scan = (manifestPath: string): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    const row = parsed as Record<string, unknown>;
    if (typeof row.name !== "string") return;
    const bins = row.bin;
    if (typeof bins === "string") {
      if ((row.name.split("/").pop() ?? "") === bin) found.push(row.name);
    } else if (typeof bins === "object" && bins !== null) {
      if (Object.prototype.hasOwnProperty.call(bins, bin)) found.push(row.name);
    }
  };
  for (const entry of top) {
    if (entry.startsWith(".") || entry.startsWith("@")) continue;
    scan(join(root, entry, "package.json"));
  }
  for (const entry of top) {
    if (!entry.startsWith("@")) continue;
    let subs: string[];
    try {
      subs = readdirSync(join(root, entry));
    } catch {
      continue;
    }
    for (const sub of subs) scan(join(root, entry, sub, "package.json"));
  }
  return found;
}

/** Whether a binary resolves to the project's own tree: its .bin link, or a
 * bin map of an installed package. */
export function localBin(project: string, bin: string): boolean {
  if (bin === "" || bin.includes("/") || bin.includes("\\")) return false;
  if (existsSync(join(project, "node_modules", ".bin", bin))) return true;
  return binProviders(project, bin).length > 0;
}

// ---------- lockfiles ----------

export interface Locked {
  name: string;
  version: string;
}

/** Split a name@version pair, scope-aware. */
export function splitNameVersion(text: string): { name: string; version: string } | null {
  const at = text.lastIndexOf("@");
  if (at <= 0) return null;
  return { name: text.slice(0, at), version: text.slice(at + 1) };
}

/** Strip pnpm's peer suffix: foo@1.0.0(bar@2.0.0) reads as foo@1.0.0. */
function stripPeerSuffix(key: string): string {
  const open = key.indexOf("(");
  return open < 0 ? key : key.slice(0, open);
}

export function parsePackageLock(text: string): Locked[] | null {
  let lock: unknown;
  try {
    lock = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (typeof lock !== "object" || lock === null) return null;
  const out = new Map<string, string>();
  const l = lock as Record<string, unknown>;
  const packages = l.packages;
  if (typeof packages === "object" && packages !== null) {
    for (const [key, entry] of Object.entries(packages as Record<string, unknown>)) {
      if (key === "") continue;
      if (typeof entry !== "object" || entry === null) continue;
      const version = (entry as Record<string, unknown>).version;
      if (typeof version !== "string" || version === "") continue;
      const parts = key.split("node_modules/");
      const last = parts[parts.length - 1] ?? "";
      if (last === "") continue;
      const segs = last.split("/");
      const name = last.startsWith("@") ? segs.slice(0, 2).join("/") : (segs[0] ?? "");
      if (name === "" || (last.startsWith("@") && segs.length < 2)) continue;
      if (!out.has(name)) out.set(name, version);
    }
  }
  const deps = l.dependencies;
  if (typeof deps === "object" && deps !== null) {
    for (const [name, entry] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof entry !== "object" || entry === null) continue;
      const version = (entry as Record<string, unknown>).version;
      if (typeof version === "string" && version !== "" && !out.has(name)) out.set(name, version);
    }
  }
  return [...out].map(([name, version]) => ({ name, version }));
}

/** The packages: keys of a pnpm lockfile. A line parser for one section, not
 * YAML: it reads indented key lines under a top-level packages: header. */
export function parsePnpmLock(text: string): Locked[] {
  const out = new Map<string, string>();
  let inPackages = false;
  for (const line of text.split("\n")) {
    if (/^packages:[ \t]*(?:#.*)?$/u.test(line)) {
      inPackages = true;
      continue;
    }
    if (/^[^ \t#]/u.test(line)) {
      inPackages = false;
      continue;
    }
    if (!inPackages) continue;
    const m = /^  ([^ \t][^:]*):[ \t]*(?:#.*)?$/u.exec(line);
    if (m?.[1] === undefined) continue;
    const pair = splitNameVersion(stripPeerSuffix(m[1].trim().replace(/^['"]|['"]$/gu, "")));
    if (pair === null || pair.version === "") continue;
    if (!out.has(pair.name)) out.set(pair.name, pair.version);
  }
  return [...out].map(([name, version]) => ({ name, version }));
}

/** One yarn.lock entry header's names: classic "a@^1, b@~2": and Berry
 * "a@npm:^1": alike. */
function yarnHeaderNames(header: string): string[] {
  const inner = header.endsWith(":") ? header.slice(0, -1) : header;
  const names: string[] = [];
  for (const key of inner.split(",")) {
    const k = key.trim().replace(/^"|"$/gu, "");
    const npmAt = k.indexOf("@npm:");
    if (npmAt > 0) {
      names.push(k.slice(0, npmAt));
      continue;
    }
    const pair = splitNameVersion(k);
    if (pair !== null) names.push(pair.name);
  }
  return names;
}

/** The locked versions of a yarn.lock, Classic or Berry. Garbage parses to
 * no entries, which fails a drifted sync through the manager, not the guard. */
export function parseYarnLock(text: string): Locked[] {
  const out = new Map<string, string>();
  let names: string[] = [];
  for (const line of text.split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    if (!line.startsWith(" ") && !line.startsWith("\t") && line.endsWith(":")) {
      names = line === "__metadata:" ? [] : yarnHeaderNames(line);
      continue;
    }
    const m = /^ {2}version:?[ \t]+"?([^" \t]+)"?[ \t]*$/u.exec(line);
    if (m?.[1] !== undefined && names.length > 0) {
      for (const name of names) {
        if (!out.has(name)) out.set(name, m[1]);
      }
      names = [];
    }
  }
  return [...out].map(([name, version]) => ({ name, version }));
}

/** Parse JSON with comments and trailing commas (bun.lock's shape),
 * string-aware so braces inside strings never confuse it. */
export function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  const n = text.length;
  let inString = false;
  let escaped = false;
  while (i < n) {
    const ch = text[i] ?? "";
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < n && " \t\n\r".includes(text[j] ?? "")) j += 1;
      const next = text[j] ?? "";
      if (next === "}" || next === "]") {
        i += 1;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return JSON.parse(out) as unknown;
}

export function parseBunLock(text: string): Locked[] | null {
  let lock: unknown;
  try {
    lock = parseJsonc(text);
  } catch {
    return null;
  }
  if (typeof lock !== "object" || lock === null) return null;
  const packages = (lock as Record<string, unknown>).packages;
  if (typeof packages !== "object" || packages === null) return [];
  const out: Locked[] = [];
  for (const entry of Object.values(packages as Record<string, unknown>)) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
    const pair = splitNameVersion(entry[0]);
    if (pair === null) continue;
    out.push({ name: pair.name, version: pair.version });
  }
  return out;
}

/** The names package.json wants, across every dependency section. */
export function wantedNames(project: string): string[] {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(join(project, "package.json"), "utf8")) as unknown;
  } catch {
    return [];
  }
  if (typeof manifest !== "object" || manifest === null) return [];
  const wanted = new Set<string>();
  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const deps = (manifest as Record<string, unknown>)[section];
    if (typeof deps === "object" && deps !== null) {
      for (const name of Object.keys(deps as Record<string, unknown>)) wanted.add(name);
    }
  }
  return [...wanted].sort();
}

/** The manifest range for a name, or null when the manifest does not depend
 * on it. */
export function manifestRange(project: string, name: string): string | null {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(join(project, "package.json"), "utf8")) as unknown;
  } catch {
    return null;
  }
  if (typeof manifest !== "object" || manifest === null) return null;
  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const deps = (manifest as Record<string, unknown>)[section];
    if (typeof deps === "object" && deps !== null) {
      const range = (deps as Record<string, unknown>)[name];
      if (typeof range === "string" && range !== "") return range;
    }
  }
  return null;
}

/** The lockfile a sync drifts from, or null when the project keeps none. */
export function findLockfile(pm: Pm, project: string): string | null {
  const candidates =
    pm === "npm"
      ? ["package-lock.json", "npm-shrinkwrap.json"]
      : pm === "pnpm"
        ? ["pnpm-lock.yaml"]
        : pm === "yarn"
          ? ["yarn.lock"]
          : ["bun.lock", "bun.lockb"];
  for (const file of candidates) {
    if (existsSync(join(project, file))) return join(project, file);
  }
  return null;
}

/** The locked name@version pairs, or null when the lockfile does not parse.
 * bun.lockb, which is binary, reads as no pairs: the sync still runs frozen,
 * with scripts off. */
export function lockedOf(lockfile: string): Locked[] | null {
  if (lockfile.endsWith("bun.lockb")) return [];
  let text: string;
  try {
    text = readFileSync(lockfile, "utf8");
  } catch {
    return null;
  }
  if (lockfile.endsWith("package-lock.json") || lockfile.endsWith("npm-shrinkwrap.json")) {
    return parsePackageLock(text);
  }
  if (lockfile.endsWith("pnpm-lock.yaml")) return parsePnpmLock(text);
  if (lockfile.endsWith("yarn.lock")) return parseYarnLock(text);
  return parseBunLock(text);
}

/** Write exactly the allowed scriptful packages to the manifest's
 * trustedDependencies, scrubbing anything the lane added. Returns whether
 * the file changed. */
export function writeTrustedDeps(project: string, names: string[]): boolean {
  const file = join(project, "package.json");
  let manifest: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) return false;
    manifest = parsed as Record<string, unknown>;
  } catch {
    return false;
  }
  const want = [...names].sort();
  const have = Array.isArray(manifest.trustedDependencies)
    ? (manifest.trustedDependencies as unknown[])
        .filter((t): t is string => typeof t === "string")
        .sort()
    : null;
  if (have !== null && have.length === want.length && have.every((h, i) => h === want[i]))
    return false;
  manifest.trustedDependencies = want;
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  return true;
}

// ---------- argv builders ----------

export interface ExecPlan {
  args: string[];
  env: Record<string, string | undefined>;
}

/** The guarded argv for an add or update: the lane's args kept, the pinned
 * registry, and scripts on or off per the checks. Berry takes env where the
 * others take flags. */
export function installArgs(
  pm: Pm,
  yarnKind: YarnKind,
  kept: string[],
  scriptsOn: string[],
  registry: string,
): ExecPlan {
  if (pm === "yarn" && yarnKind === "berry") {
    return {
      args: [...kept, "--non-interactive"],
      env: {
        YARN_ENABLE_SCRIPTS: scriptsOn.length > 0 ? "1" : "0",
        YARN_NPM_REGISTRY_SERVER: registry,
      },
    };
  }
  const args = [...kept, "--registry", registry];
  if (pm === "npm") args.push("--no-audit", "--no-fund");
  if (pm === "yarn") args.push("--non-interactive");
  if (scriptsOn.length > 0) {
    if (pm === "pnpm") {
      for (const name of scriptsOn) args.push(`--allow-build=${name}`);
    }
    return { args, env: {} };
  }
  if (pm !== "bun") args.push("--ignore-scripts");
  return { args, env: {} };
}

/** The guarded argv for a bare sync: fixed, so no lane flag can drift it or
 * enable scripts. */
export function syncArgs(
  pm: Pm,
  yarnKind: YarnKind,
  scriptsOn: string[],
  registry: string,
): ExecPlan {
  if (pm === "yarn" && yarnKind === "berry") {
    return {
      args: ["install", "--immutable", "--non-interactive"],
      env: {
        YARN_ENABLE_SCRIPTS: scriptsOn.length > 0 ? "1" : "0",
        YARN_NPM_REGISTRY_SERVER: registry,
      },
    };
  }
  if (pm === "npm") {
    const args = ["ci", "--registry", registry, "--no-audit", "--no-fund"];
    if (scriptsOn.length === 0) args.push("--ignore-scripts");
    return { args, env: {} };
  }
  if (pm === "pnpm") {
    const args = ["install", "--frozen-lockfile", "--registry", registry];
    if (scriptsOn.length > 0) {
      for (const name of scriptsOn) args.push(`--allow-build=${name}`);
    } else {
      args.push("--ignore-scripts");
    }
    return { args, env: {} };
  }
  if (pm === "yarn") {
    const args = ["install", "--frozen-lockfile", "--registry", registry, "--non-interactive"];
    if (scriptsOn.length === 0) args.push("--ignore-scripts");
    return { args, env: {} };
  }
  return { args: ["install", "--frozen-lockfile", "--registry", registry], env: {} };
}

// ---------- commands ----------

export interface RunDeps {
  ctx: GuardContext;
  project: string;
  libs: ListedLibrary[];
  approvals: LibApprovals;
}

/** The ticket's library list, or none when the brief is missing: a run with
 * no list refuses every add. */
export function readBriefLibs(dispatch: string): ListedLibrary[] {
  try {
    return parseLibraries(readFileSync(join(dispatch, "brief.md"), "utf8"));
  } catch {
    return [];
  }
}

function noteStripped(stripped: string[]): void {
  if (stripped.length > 0) {
    process.stderr.write(
      `install-guard: stripped ${stripped.join(" ")}; the guard decides these\n`,
    );
  }
}

/** The add pipeline: parse, list precheck, resolve, check. Returns the
 * covered scriptful names. */
async function checkSpecs(deps: RunDeps, specs: ParsedAddSpec[]): Promise<{ scriptful: string[] }> {
  listPrecheck(deps.libs, specs);
  const closure = await resolveClosure(deps.ctx, deps.project, specs);
  const docs = new Map<string, Packument>();
  return checkAdd(deps.ctx, deps.libs, deps.approvals, closure, async (name) => {
    let doc = docs.get(name);
    if (doc === undefined) {
      doc = await fetchPackument(deps.ctx, name);
      docs.set(name, doc);
    }
    return doc;
  });
}

/** Update specs name installed libraries: a bare name updates within the
 * manifest's range, and a ranged spec updates to that range. Either way the
 * checks run against the range's resolution, like an add. */
export function expandUpdateSpecs(project: string, specs: string[]): ParsedAddSpec[] {
  return specs.map((raw) => {
    const parsed = parseSpec(raw);
    if (parsed === null || (parsed.kind !== "registry" && parsed.kind !== "alias")) {
      throw refusal(
        `install-guard: refusing to update ${raw}: it is not a registry library the guard can check`,
      );
    }
    const name = parsed.kind === "alias" ? parsed.target : parsed.name;
    if (parsed.range === "*") {
      const range = manifestRange(project, name);
      if (range === null) {
        throw refusal(
          `install-guard: refusing to update ${raw}: package.json does not depend on ${name}; add it with add instead`,
        );
      }
      return { raw, parsed: { kind: "registry", name, range }, name };
    }
    return { raw, parsed, name };
  });
}

/** The locked packages whose packuments declare install scripts. A locked
 * version the registry does not know refuses the sync: a sync that cannot
 * see scripts cannot safely run them. */
async function syncScriptful(ctx: GuardContext, locked: Locked[]): Promise<string[]> {
  const found = await mapPool(locked, CONCURRENCY, async (l) => {
    const doc = await fetchPackument(ctx, l.name);
    const entry = doc.versions[l.version];
    if (entry === undefined) {
      throw refusal(
        `install-guard: refusing to sync: the registry has no ${l.name}@${l.version} the lockfile pins`,
      );
    }
    return entry.scripts !== undefined && Object.keys(entry.scripts).length > 0 ? l.name : null;
  });
  return [...new Set(found.filter((f): f is string => f !== null))].sort();
}

/** Commands that only read the registry still run against the pinned one;
 * everything else passes untouched. */
const FETCH_CMDS = new Set(["view", "info", "show", "search", "ping", "audit", "outdated", "fund"]);

function execPassthrough(
  prog: string,
  pm: Pm,
  yarnKind: YarnKind,
  bin: string,
  argv: string[],
  registry: string,
): number {
  if (pm === "yarn" && yarnKind === "berry") {
    const { kept, stripped } = sanitize(pm, argv);
    noteStripped(stripped);
    return execManager(bin, kept, execEnv({ YARN_NPM_REGISTRY_SERVER: registry }));
  }
  const { cmd } = commandOf(prog === "yarn" ? "yarn" : pm, argv);
  const { kept, stripped } = sanitize(pm, argv);
  noteStripped(stripped);
  const args = FETCH_CMDS.has(cmd) ? [...kept, "--registry", registry] : kept;
  return execManager(bin, args, execEnv({}));
}

export type Prog = "npm" | "npx" | "pnpm" | "yarn" | "bun";

function toProg(prog: string): Prog {
  if (prog === "npm" || prog === "npx" || prog === "pnpm" || prog === "yarn" || prog === "bun")
    return prog;
  throw refusal(
    `install-guard: refusing to run ${prog}: the guard shims only npm, npx, pnpm, yarn and bun`,
  );
}

async function runRun(shimDir: string, rawProg: string, argv: string[]): Promise<number> {
  const prog = toProg(rawProg);
  const dispatch = process.env.POSTMASTER_DISPATCH ?? "";
  if (dispatch === "") {
    refuse(
      "install-guard: refusing to run: POSTMASTER_DISPATCH is not set, so the launch did not arm the guard",
    );
  }
  const pm: Pm = prog === "npx" ? "npm" : prog;
  const key = prog === "yarn" ? "yarn" : pm;
  const cwd = process.cwd();
  const project = projectOf(pm, argv, cwd);
  const bin = managerBin(prog, shimDir);
  if (bin === null) {
    throw refusal(
      `install-guard: refusing to run ${prog}: ${prog} is not on the PATH outside the guard's shims`,
    );
  }
  const yarnKind = pm === "yarn" ? detectYarnKind(project, bin) : "classic";
  const classification = classify(prog, argv, yarnKind);
  if (classification.kind === "refuse") {
    const words = argv.length > 0 ? ` ${argv.join(" ")}` : "";
    throw refusal(`install-guard: refusing to run ${prog}${words}: ${classification.message}`);
  }
  const registry = (process.env.POSTMASTER_GUARD_REGISTRY ?? "https://registry.npmjs.org").replace(
    /\/$/u,
    "",
  );
  const socketApi = (
    process.env.POSTMASTER_GUARD_SOCKET_API ?? "https://firewall-api.socket.dev"
  ).replace(/\/$/u, "");
  const ctx: GuardContext = {
    dispatch,
    lane: process.env.POSTMASTER_GUARD_LANE ?? "",
    cacheDir: join(dispatch, "guard", "cache"),
    registry,
    socketApi,
  };
  const deps: RunDeps = {
    ctx,
    project,
    libs: readBriefLibs(dispatch),
    approvals: readApprovals(dispatch),
  };

  if (classification.kind === "passthrough") {
    return execPassthrough(prog, pm, yarnKind, bin, argv, registry);
  }
  if (classification.kind === "add" || classification.kind === "update") {
    const specs =
      classification.kind === "add"
        ? parseAddSpecs(classification.specs)
        : expandUpdateSpecs(project, classification.specs);
    const { scriptful } = await checkSpecs(deps, specs);
    if (pm === "bun") writeTrustedDeps(project, scriptful);
    const { prefix, cmd, rest } = commandOf(key, argv);
    const pre = sanitize(pm, prefix);
    const post = sanitize(pm, rest);
    noteStripped([...pre.stripped, ...post.stripped]);
    const plan = installArgs(pm, yarnKind, [...pre.kept, cmd, ...post.kept], scriptful, registry);
    return execManager(bin, plan.args, execEnv(plan.env));
  }
  if (classification.kind === "sync") {
    const lock = findLockfile(pm, project);
    const wanted = wantedNames(project);
    if (lock === null && wanted.length > 0) {
      refuse(
        `install-guard: refusing to sync: package.json wants ${wanted.join(", ")} but the project has no lockfile. Add them with ${prog} add first`,
      );
    }
    if (pm === "npm" && lock !== null) {
      const drift = npmDriftNames(project, lock);
      if (drift !== null && drift.length > 0) {
        refuse(
          `install-guard: refusing to sync: package.json wants ${drift.join(", ")}, which the lockfile does not lock. Add them with npm add first`,
        );
      }
    }
    // An unparseable lockfile reads as no pairs: the sync still runs frozen
    // with scripts off, and the manager fails the drift itself.
    const locked = lock === null ? [] : (lockedOf(lock) ?? []);
    const scriptful = await syncScriptful(ctx, locked);
    const scriptsOn = scriptful.filter((name) => deps.approvals.allowances.has(name));
    if (scriptsOn.length !== scriptful.length) scriptsOn.splice(0);
    if (pm === "bun") writeTrustedDeps(project, scriptsOn);
    const plan = syncArgs(pm, yarnKind, scriptsOn, registry);
    return execManager(bin, plan.args, execEnv(plan.env));
  }
  if (classification.kind === "rebuild") {
    // npm and pnpm only; the other managers never classify here.
    for (const name of classification.names) {
      if (!deps.approvals.allowances.has(name)) {
        refuse(
          `install-guard: refusing to rebuild ${name}: it runs an install script and the run records no allowance for it. Ask for a script-allow first`,
        );
      }
    }
    const { prefix, cmd, rest } = commandOf(key, argv);
    const pre = sanitize(pm, prefix);
    const post = sanitize(pm, rest);
    noteStripped([...pre.stripped, ...post.stripped]);
    return execManager(bin, [...pre.kept, cmd, ...post.kept], execEnv({}));
  }
  // One-shot: an installed binary runs with downloads disabled, and anything
  // else is guarded like an add and then runs with the pinned registry.
  const bins = classification.specs;
  const pkgs = classification.packages;
  if (bins.length === 0 && pkgs.length === 0) {
    return execPassthrough(prog, pm, yarnKind, bin, argv, registry);
  }
  if (pkgs.length > 0) {
    const specs = parseAddSpecs(pkgs);
    const { scriptful } = await checkSpecs(deps, specs);
    return execDownloaded(pm, yarnKind, bin, argv, scriptful, registry);
  }
  const wanted = bins[0] ?? "";
  if ((prog === "npx" || prog === "bun") && localBin(project, wanted)) {
    if (prog === "npx") {
      return execManager(bin, ["--offline", ...argv], execEnv({}));
    }
    const { prefix, cmd, rest } = commandOf(key, argv);
    return execManager(bin, [...prefix, cmd, "--no-install", ...rest], execEnv({}));
  }
  if (prog !== "npx" && prog !== "bun") {
    const providers = binProviders(project, wanted);
    if (providers.length > 0) {
      const at = providers
        .map((name) => ({ name, version: installedVersion(project, name) }))
        .filter((p): p is { name: string; version: string } => p.version !== null);
      if (at.length > 0) {
        const { scriptful } = await checkSpecs(
          deps,
          at.map((p) => ({
            raw: `${p.name}@${p.version}`,
            parsed: { kind: "registry", name: p.name, range: p.version },
            name: p.name,
          })),
        );
        return execDownloaded(pm, yarnKind, bin, argv, scriptful, registry);
      }
    }
  }
  const specs = parseAddSpecs([wanted]);
  const { scriptful } = await checkSpecs(deps, specs);
  return execDownloaded(pm, yarnKind, bin, argv, scriptful, registry);
}

/** A one-shot the checks cleared: the lane's args kept, the pinned registry,
 * and scripts on per the covered set. */
function execDownloaded(
  pm: Pm,
  yarnKind: YarnKind,
  bin: string,
  argv: string[],
  scriptful: string[],
  registry: string,
): number {
  if (pm === "yarn" && yarnKind === "berry") {
    const { kept, stripped } = sanitize(pm, argv);
    noteStripped(stripped);
    return execManager(
      bin,
      kept,
      execEnv({
        YARN_ENABLE_SCRIPTS: scriptful.length > 0 ? "1" : "0",
        YARN_NPM_REGISTRY_SERVER: registry,
      }),
    );
  }
  const { kept, stripped } = sanitize(pm, argv);
  noteStripped(stripped);
  const args = [...kept, "--registry", registry];
  if (pm === "npm") args.push("--no-audit", "--no-fund");
  if (scriptful.length > 0) {
    if (pm === "pnpm") {
      for (const name of scriptful) args.push(`--allow-build=${name}`);
    }
  } else if (pm === "npm" || pm === "pnpm") {
    args.push("--ignore-scripts");
  }
  return execManager(bin, args, execEnv({}));
}

/** The installed version of a package, or null when it is not installed. */
export function installedVersion(project: string, name: string): string | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(project, "node_modules", ...name.split("/"), "package.json"), "utf8"),
    ) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

async function runFacts(spec: string): Promise<number> {
  const parsed = parseSpec(spec);
  if (parsed === null || (parsed.kind !== "registry" && parsed.kind !== "alias")) {
    throw refusal(`install-guard: refusing facts for ${spec}: it is not a registry library`);
  }
  const registry = (process.env.POSTMASTER_GUARD_REGISTRY ?? "https://registry.npmjs.org").replace(
    /\/$/u,
    "",
  );
  const socketApi = (
    process.env.POSTMASTER_GUARD_SOCKET_API ?? "https://firewall-api.socket.dev"
  ).replace(/\/$/u, "");
  const dispatch = process.env.POSTMASTER_DISPATCH ?? "";
  // With no run to scope a cache to, facts takes a fresh dir per invocation
  // and removes it afterwards: a shared dir would serve one stand-in
  // registry's answers to the next.
  const scratch = dispatch === "" ? mkdtempSync(join(tmpdir(), "postmaster-guard-facts-")) : null;
  const ctx: GuardContext = {
    dispatch,
    lane: process.env.POSTMASTER_GUARD_LANE ?? "",
    cacheDir: scratch ?? join(dispatch, "guard", "cache"),
    registry,
    socketApi,
  };
  try {
    return await factsWith(ctx, spec, parsed);
  } finally {
    if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
  }
}

async function factsWith(
  ctx: GuardContext,
  spec: string,
  parsed: Extract<Spec, { kind: "registry" | "alias" }>,
): Promise<number> {
  const name = parsed.kind === "alias" ? parsed.target : parsed.name;
  const doc = await fetchPackument(ctx, name);
  const version = resolveVersion(doc, parsed.range);
  if (version === null) {
    throw refusal(
      `install-guard: refusing facts for ${spec}: no published version of ${name} meets ${parsed.range}`,
    );
  }
  const verdict = await fetchVerdict(ctx, name, version);
  const repo = doc.repository;
  const source =
    typeof repo === "string"
      ? repo
      : typeof repo === "object" &&
          repo !== null &&
          typeof (repo as Record<string, unknown>).url === "string"
        ? ((repo as Record<string, unknown>).url as string)
        : "";
  const published = doc.time[version] ?? "unknown";
  process.stdout.write(
    `name=${name}\nversion=${version}\npublished=${published}\nsource=${source}\nverdict=${verdict.status}\n`,
  );
  return 0;
}

function runDispatchCheck(project: string, dispatch: string | null): number {
  const { js, other } = detectSupport(project);
  const words = dispatch === null ? [] : readApprovals(dispatch).pmWords;
  const uncovered = other.filter((m) => !wordCovers(words, [m]));
  const cleared = other.filter((m) => wordCovers(words, [m]));
  if (uncovered.length === 0) {
    const parts = [...js];
    if (cleared.length > 0) parts.push(`${cleared.join(", ")} (the user's word covers them)`);
    if (parts.length === 0) {
      process.stdout.write("install-guard: covered: no package managers found\n");
    } else {
      process.stdout.write(`install-guard: covered: ${parts.join("; ")}\n`);
    }
    return 0;
  }
  if (js.length > 0) {
    process.stdout.write(
      `install-guard: covered: ${js.join(", ")}; unguarded managers present: ${uncovered.join(", ")}\n`,
    );
    return 0;
  }
  process.stdout.write(
    `install-guard: unsupported package managers: ${uncovered.join(", ")}. The guard cannot check them; to run on anyway, record the user's word with \`run log-action <dispatch> postmaster pm-word ${uncovered.join(",")} '<the user's words>'\`.\n`,
  );
  return 2;
}

const HELP = `install-guard: decide one lane package-manager invocation, then exec or refuse.

usage: run install-guard run --shim-dir <dir> <prog> <args...>
       run install-guard facts <spec>
       run install-guard dispatch-check <project> [--dispatch <dir>]

run reads POSTMASTER_DISPATCH, POSTMASTER_GUARD_LANE, POSTMASTER_GUARD_REGISTRY
and POSTMASTER_GUARD_SOCKET_API from the environment the launch sets.
Refusals exit 1; a held dispatch-check exits 2.`;

function usage(): never {
  process.stderr.write(`${HELP}\n`);
  process.exit(2);
  throw new Error("unreachable");
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === "run") {
    if (
      rest[0] !== "--shim-dir" ||
      rest[1] === undefined ||
      rest[1] === "" ||
      rest[2] === undefined
    )
      usage();
    return runRun(rest[1] as string, rest[2] as string, rest.slice(3));
  }
  if (cmd === "facts") {
    if (rest.length !== 1 || rest[0] === "") usage();
    return runFacts(rest[0] as string);
  }
  if (cmd === "dispatch-check") {
    let project: string | null = null;
    let dispatch: string | null = null;
    for (let i = 0; i < rest.length; i += 1) {
      if (rest[i] === "--dispatch") {
        dispatch = rest[i + 1] ?? null;
        i += 1;
      } else if (project === null) {
        project = rest[i] ?? null;
      } else {
        usage();
      }
    }
    if (project === null || project === "" || dispatch === "") usage();
    return runDispatchCheck(project ?? "", dispatch);
  }
  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  usage();
}

if (import.meta.main) {
  try {
    process.exit(await main(argvDecoded()));
  } catch (e) {
    if (e instanceof Refusal) {
      process.stderr.write(`${e.message}\n`);
      process.exit(1);
    }
    const text = e instanceof Error ? e.message : String(e);
    process.stderr.write(`install-guard: internal error: ${text} Stop and report it.\n`);
    process.exit(1);
  }
}
