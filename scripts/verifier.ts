// Make verifiers for a project's surfaces: one model session, in a worktree of its
// own, writes one verifier per surface and proves each once before handing over.
// One surface keeps #323's shape; several share a folder with an index (#324).
// The session is interactive: it opens in a tab of its own where the user watches
// and answers it, asking only what the project does not show and taking secrets by
// file name (#344). Land what a session made only when the project's own checks pass
// with it in place (#325). An upkeep pass drives a project's verifiers again and
// reports each claim that no longer holds and each it could not check (#318);
// in its correcting mode it corrects the stale claims inside the verifiers'
// folders only, confirms every verifier at the commit it drove, and proposes the
// branch for the same landing (#328). A verifier reads as possibly stale once a
// file its index lists changed since the commit it was proved or confirmed at,
// until a pass confirms it again (#355).
//
//   run verifier prompt <repo> <surface>... [--headless]
//   run verifier list <repo>
//   run verifier stale <repo> [--at <commit>]
//   run verifier make <repo> <surface>... --run <dispatch> [--timeout <seconds>]
//   run verifier check <repo> <branch> --run <dispatch> (--handover <file>|--report <file>)
//     [--folder <dir>] [--timeout <seconds>]
//   run verifier land <repo> <branch> --run <dispatch> (--handover <file>|--report <file>)
//     [--folder <dir>] [--timeout <seconds>] [--landing <local|pull-request>] [--word]
//   run verifier upkeep <repo> --run <dispatch> [--timeout <seconds>]
//     [--folder <dir>] [--correct]
//   run verifier upkeep-prompt <repo> [--headless] [--folder <dir>] [--correct]
//   run verifier upkeep-report <repo> --run <dispatch> --report <file> [--folder <dir>]
//
//   surface    one or more of cli, web, library, cli-examples, browser-suite,
//              web-journey, library-tests. cli-examples is the command line,
//              browser-suite and web-journey are web pages, library-tests is
//              the library interface; names of one surface make one verifier.
//   prompt     print the session's instructions for the repo and surfaces, the
//              interactive form, or with --headless the no-host form, which lists
//              each question it could not ask in HANDOVER.md instead of asking
//   list       print the verifiers the repo holds: one index: line per read-first
//              entry, then one verifier:/surface:/features: block per verifier, or
//              verifiers: none. The clerk's brief and discovery read this (#327)
//   stale      print the verifiers that may have gone stale: each verifier with a
//              file its index lists (#318) changed between the commit it was made
//              or confirmed at (#328) and --at, HEAD when --at is absent, naming
//              the files, or unconfirmed with the cause when its entry lacks its
//              Files list, its Confirmed commit, or names a commit the repo does
//              not hold. Prints stale: none when no verifier is marked. The
//              clerk's brief and the postmaster's after-merge offer read this (#355)
//   make       cut a worktree on a branch of its own beside the repo, removed again
//              when make fails before any session starts, render the prompt, and open
//              the coachman role's interactive form through run launch in a fresh tab
//              through run host spawn, the way the booking clerk opens; send it the
//              instructions and wait for HANDOVER.md, leaving the tab open when done.
//              With no session host (spawn exits 3) run headless instead: launch the
//              coachman role through run launch under run host, wait, fall back to
//              coachman_fallback on a provider wall read from the session stream,
//              stop the session at the limit by the pid host recorded, and log one
//              dispatch action per launch either way
//   check      decide whether the branch lands: with a hand-over, its proven verifiers
//              pass the project's checks on a scratch, its diff touches only the
//              verifiers' folder, and every failed verifier's folder is absent; with
//              a report, a correcting pass's branch lands on the folder rule, over
//              every shape the base commit holds unless --folder names one, and the
//              project's checks alone. Prints one accept: or refuse: line and logs
//              the same line
//   land       check, then land an accepted branch once: local merges with git merge
//              --no-ff under the merge authority from the run, pull-request pushes and
//              opens one pull request, never merging. Prints the verdict plus one
//              merge:, waiting:, pull-request: or error: line, each logged as printed
//   upkeep     run an upkeep pass over the repo's verifiers at its current commit: the
//              same session as make in a second mode, on its own upkeep branch, opened
//              through the same interactive form with the same model and time limit,
//              reporting only. Prints one stale: line per claim that no longer holds,
//              with what the pass found instead, one unchecked: line per claim it
//              could not check, and a summary; exits 1 when any claim is stale or
//              unchecked. With --correct the pass also corrects: the session mends
//              each stale claim inside the verifiers' folders only, proves each
//              correction by driving its recipe again, confirms every verifier at
//              the driven commit, and commits the branch, leaving UPKEEP.md
//              uncommitted. Each corrected claim prints a corrected: line and the
//              tally, and every claim holds prints when nothing is left stale or
//              unchecked; exits 1 otherwise, or when the branch reaches past the
//              folders or a verifier is left unconfirmed
//   upkeep-prompt  print the pass's instructions, the interactive form, or with
//              --headless the no-host form, which lists each question it could not
//              ask in UPKEEP.md instead of asking; --correct prints the correcting
//              instructions instead
//   upkeep-report  read a finished UPKEEP.md, refuse it unless it drives every
//              feature page, and print the same stale, unchecked and summary lines
//              upkeep prints, logged as printed; a corrected claim counts as held
//   --handover the session's HANDOVER.md, with one ## Verifier: section per verifier
//              carrying a Folder: line and a Proof: line (the proof file's absolute
//              path alone, or none with the reason). Proven means the file exists
//   --report   the pass's UPKEEP.md, with one ## Feature: section per feature page
//              carrying an Outcome: line, one ## Claim: section per stale or
//              unchecked claim, a Corrected: line on each claim a correcting pass
//              mended, and the unasked questions where the pass ran headless
//   --folder   the verifiers' folder, relative to the repo top (default verify-<slug>;
//              the pass takes every shape the repo holds: verify-<slug>/, verifier/, or both)
//   --landing  local or pull-request (default pull-request with an origin remote)
//   --timeout  seconds to wait for the session (make, upkeep), or to run the project's
//              checks for (check, land); past it the branch lands nothing and the
//              waiting ends with the tab session left open (default 3600 each,
//              at most 9 digits). make takes 0, which waits without a limit; check and
//              land need a whole number of seconds past zero
//   --word      the user gave the merge word for this landing, so a local landing
//              merges without consulting merge authority (setup's launch-card yes)
//   --at       the commit stale compares each confirmation against (default HEAD)
//
//   exit 0  prompt, list or stale printed; make: HANDOVER.md validated, the interactive session
//           left open in its tab, the headless one ended with no wall;
//           check: the branch lands; land: merged, or the pull request waits for the word;
//           upkeep, upkeep-report: every claim holds or is corrected
//   exit 1  make failed: the launch would not start, the session was still running at the
//           limit, both roles walled, the handover, commit, verifier, upkeep line or
//           index entry is missing, a verifier was made for an unlisted surface,
//           verifier files landed outside the folder, or the action was not logged;
//           check, land: the branch lands nothing, or the landing failed after it
//           was accepted;
//           upkeep, upkeep-report: a claim is left uncorrected or unchecked, the report
//           is missing or malformed, or the pass failed as make fails;
//           upkeep --correct: as above, or the branch reaches past the folders,
//           or a verifier is left unconfirmed
//   exit 2  usage: an unknown command or surface, a missing argument, a bad flag or
//           timeout, a path that is not a git repository or not its top, a repo holding
//           no commit or no verifiers, no run at the dispatch, or a branch that is not
//           a verifier branch
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { splitCommand } from "./clerk.ts";
import { endingWallMessage, isWallMessage } from "./launch.ts";
import { beside, scriptsDir } from "./lib/paths.ts";
import { run, type RunResult } from "./lib/proc.ts";
import { RESULT_RE } from "./verify.ts";

const USAGE = `usage: run verifier prompt <repo> <surface>... [--headless]
       run verifier list <repo>
       run verifier stale <repo> [--at <commit>]
       run verifier make <repo> <surface>... --run <dispatch> [--timeout <seconds>]
       run verifier check <repo> <branch> --run <dispatch> (--handover <file>|--report <file>)
         [--folder <dir>] [--timeout <seconds>]
       run verifier land <repo> <branch> --run <dispatch> (--handover <file>|--report <file>)
         [--folder <dir>] [--timeout <seconds>] [--landing <local|pull-request>] [--word]
       run verifier upkeep <repo> --run <dispatch> [--timeout <seconds>]
         [--folder <dir>] [--correct]
       run verifier upkeep-prompt <repo> [--headless] [--folder <dir>] [--correct]
       run verifier upkeep-report <repo> --run <dispatch> --report <file> [--folder <dir>]

       each surface is cli, web, library, cli-examples, browser-suite, web-journey or library-tests;
       landing is local or pull-request; make's timeout 0 waits without a limit`;

/** The accepted surface names as the unknown-surface error lists them. */
const KNOWN_SURFACES =
  "cli, web, library, cli-examples, browser-suite, web-journey or library-tests";

const RUN = beside(import.meta, "run");
const DEFAULT_TIMEOUT = 3600;

export const SURFACES = ["cli", "web", "library"] as const;
export type Surface = (typeof SURFACES)[number];

const PROSE: Record<Surface, string> = {
  cli: "command line",
  web: "web pages",
  library: "library interface",
};

export function isSurface(s: string): s is Surface {
  return (SURFACES as readonly string[]).includes(s);
}

/** The prose name the instructions call the surface. Throws on an unknown surface. */
export function surfaceProse(surface: string): string {
  if (!isSurface(surface)) throw new Error(`unknown surface: ${surface}`);
  return PROSE[surface];
}

/** Discovery check names accepted as surfaces, with the kind each denotes. */
const DISCOVERY_SURFACES: Record<string, Surface> = {
  "cli-examples": "cli",
  "browser-suite": "web",
  "web-journey": "web",
  "library-tests": "library",
};

/** The surface kind a name denotes, in either vocabulary, or null. */
export function surfaceKind(name: string): Surface | null {
  if (isSurface(name)) return name;
  // Own keys only: constructor, toString and __proto__ live on the prototype,
  // and accepting them would render a prompt for no surface at all.
  if (!Object.hasOwn(DISCOVERY_SURFACES, name)) return null;
  return DISCOVERY_SURFACES[name] ?? null;
}

/** Distinct kinds in canonical cli, web, library order. */
export function orderKinds(kinds: Surface[]): Surface[] {
  return SURFACES.filter((k) => kinds.includes(k));
}

export interface ParsedPrompt {
  cmd: "prompt";
  repo: string;
  surfaces: Surface[];
  headless: boolean;
}

export interface ParsedList {
  cmd: "list";
  repo: string;
}

export interface ParsedStale {
  cmd: "stale";
  repo: string;
  /** The comparison commit, or null for the repo's HEAD. */
  at: string | null;
}

export interface ParsedMake {
  cmd: "make";
  repo: string;
  surfaces: Surface[];
  dispatch: string;
  timeout: number;
}

export interface ParsedCheck {
  cmd: "check";
  repo: string;
  branch: string;
  dispatch: string;
  /** The deliverable: exactly one of the two is set. */
  handover?: string;
  report?: string;
  folder: string | null;
  timeout: number;
}

export interface ParsedLand {
  cmd: "land";
  repo: string;
  branch: string;
  dispatch: string;
  /** The deliverable: exactly one of the two is set. */
  handover?: string;
  report?: string;
  folder: string | null;
  timeout: number;
  landing: string | null;
  wordGiven: boolean;
}

export interface ParsedUpkeep {
  cmd: "upkeep";
  repo: string;
  dispatch: string;
  timeout: number;
  folder: string | null;
  /** Set only with --correct: the pass corrects as well as reports. */
  correct?: boolean;
}

export interface ParsedUpkeepPrompt {
  cmd: "upkeep-prompt";
  repo: string;
  headless: boolean;
  folder: string | null;
  /** Set only with --correct: the correcting instructions. */
  correct?: boolean;
}

export interface ParsedUpkeepReport {
  cmd: "upkeep-report";
  repo: string;
  dispatch: string;
  report: string;
  folder: string | null;
}

export type Parsed =
  | {
      ok: true;
      req:
        | ParsedPrompt
        | ParsedList
        | ParsedStale
        | ParsedMake
        | ParsedCheck
        | ParsedLand
        | ParsedUpkeep
        | ParsedUpkeepPrompt
        | ParsedUpkeepReport;
    }
  | { ok: false; error: string };

function parseTimeoutText(
  value: string | undefined,
  allowZero: boolean,
): { ok: true; timeout: number } | { ok: false; error: string } {
  const n = Number(value);
  if (value === undefined || !/^[0-9]{1,9}$/u.test(value) || n < 0 || (n === 0 && !allowZero)) {
    return { ok: false, error: `bad timeout: ${value ?? "none"}` };
  }
  return { ok: true, timeout: n };
}

/** The upkeep commands' flags: upkeep and upkeep-report take --run, prompt takes --headless, and upkeep and prompt take --correct. */
function parseUpkeepArgs(
  cmd: "upkeep" | "upkeep-prompt" | "upkeep-report",
  repo: string | undefined,
  rest: string[],
): Parsed {
  if (repo === undefined) return { ok: false, error: `${cmd} takes a repo` };
  let dispatch: string | null = null;
  let report: string | null = null;
  let folder: string | null = null;
  let headless = false;
  let correct = false;
  let timeout = DEFAULT_TIMEOUT;
  for (let j = 0; j < rest.length; j++) {
    const flag = rest[j] as string;
    if (flag === "--run") {
      if (cmd === "upkeep-prompt") return { ok: false, error: `unknown flag for ${cmd}: ${flag}` };
      const value = rest[j + 1];
      if (value === undefined) return { ok: false, error: `${cmd} needs --run <dispatch>` };
      dispatch = value;
      j++;
    } else if (flag === "--report") {
      if (cmd !== "upkeep-report") return { ok: false, error: `unknown flag for ${cmd}: ${flag}` };
      const value = rest[j + 1];
      if (value === undefined) return { ok: false, error: `${cmd} needs --report <file>` };
      report = value;
      j++;
    } else if (flag === "--folder") {
      const value = rest[j + 1];
      if (value === undefined) return { ok: false, error: `${cmd} needs --folder <dir>` };
      const normalized = normalizeFolder(value);
      if (!normalized.ok) return normalized;
      folder = normalized.folder;
      j++;
    } else if (flag === "--timeout") {
      if (cmd !== "upkeep") return { ok: false, error: `unknown flag for ${cmd}: ${flag}` };
      const parsed = parseTimeoutText(rest[j + 1], false);
      if (!parsed.ok) return parsed;
      timeout = parsed.timeout;
      j++;
    } else if (flag === "--headless") {
      if (cmd !== "upkeep-prompt") return { ok: false, error: `unknown flag for ${cmd}: ${flag}` };
      headless = true;
    } else if (flag === "--correct") {
      if (cmd === "upkeep-report") return { ok: false, error: `unknown flag for ${cmd}: ${flag}` };
      correct = true;
    } else {
      return { ok: false, error: `unknown flag for ${cmd}: ${flag}` };
    }
  }
  if (cmd === "upkeep-prompt") {
    const req: ParsedUpkeepPrompt = { cmd, repo, headless, folder };
    if (correct) req.correct = true;
    return { ok: true, req };
  }
  if (dispatch === null) return { ok: false, error: `${cmd} needs --run <dispatch>` };
  if (cmd === "upkeep") {
    const req: ParsedUpkeep = { cmd, repo, dispatch, timeout, folder };
    if (correct) req.correct = true;
    return { ok: true, req };
  }
  if (report === null) return { ok: false, error: `${cmd} needs --report <file>` };
  return { ok: true, req: { cmd, repo, dispatch, report, folder } };
}

export function parseArgs(argv: string[]): Parsed {
  const cmd = argv[0];
  if (cmd === undefined) return { ok: false, error: "no command" };
  if (
    cmd !== "prompt" &&
    cmd !== "list" &&
    cmd !== "stale" &&
    cmd !== "make" &&
    cmd !== "check" &&
    cmd !== "land" &&
    cmd !== "upkeep" &&
    cmd !== "upkeep-prompt" &&
    cmd !== "upkeep-report"
  ) {
    return { ok: false, error: `unknown command: ${cmd}` };
  }
  const repo = argv[1];
  if (cmd === "list") {
    if (repo === undefined || argv.length !== 2) {
      return { ok: false, error: "list takes a repo" };
    }
    return { ok: true, req: { cmd, repo } };
  }
  if (cmd === "stale") {
    if (repo === undefined) return { ok: false, error: "stale takes a repo" };
    let at: string | null = null;
    const rest = argv.slice(2);
    for (let j = 0; j < rest.length; j++) {
      const flag = rest[j] as string;
      if (flag === "--at") {
        const value = rest[j + 1];
        if (value === undefined) return { ok: false, error: "stale needs --at <commit>" };
        at = value;
        j++;
      } else {
        return { ok: false, error: `unknown flag for stale: ${flag}` };
      }
    }
    return { ok: true, req: { cmd, repo, at } };
  }
  if (cmd === "upkeep" || cmd === "upkeep-prompt" || cmd === "upkeep-report") {
    return parseUpkeepArgs(cmd, repo, argv.slice(2));
  }
  if (cmd === "prompt" || cmd === "make") {
    if (repo === undefined) return { ok: false, error: `${cmd} takes a repo and a surface` };
    const names: string[] = [];
    let i = 2;
    for (; i < argv.length; i++) {
      const token = argv[i] as string;
      if (token.startsWith("-")) break;
      names.push(token);
    }
    if (names.length === 0) return { ok: false, error: `${cmd} takes a repo and a surface` };
    const kinds: Surface[] = [];
    for (const name of names) {
      const kind = surfaceKind(name);
      if (kind === null) {
        return { ok: false, error: `unknown surface: ${name} (${KNOWN_SURFACES})` };
      }
      kinds.push(kind);
    }
    const surfaces = orderKinds(kinds);
    if (cmd === "prompt") {
      const rest = argv.slice(i);
      if (rest.length > 1) return { ok: false, error: "prompt takes a repo and a surface" };
      if (rest.length === 1 && rest[0] !== "--headless") {
        return { ok: false, error: `unknown flag for prompt: ${rest[0]}` };
      }
      return { ok: true, req: { cmd, repo, surfaces, headless: rest.length === 1 } };
    }
    let dispatch: string | null = null;
    let timeout = DEFAULT_TIMEOUT;
    const rest = argv.slice(i);
    for (let j = 0; j < rest.length; j++) {
      const flag = rest[j] as string;
      if (flag === "--run") {
        const value = rest[j + 1];
        if (value === undefined) return { ok: false, error: "make needs --run <dispatch>" };
        dispatch = value;
        j++;
      } else if (flag === "--timeout") {
        const parsed = parseTimeoutText(rest[j + 1], true);
        if (!parsed.ok) return parsed;
        timeout = parsed.timeout;
        j++;
      } else {
        return { ok: false, error: `unknown flag for make: ${flag}` };
      }
    }
    if (dispatch === null) return { ok: false, error: "make needs --run <dispatch>" };
    return { ok: true, req: { cmd, repo, surfaces, dispatch, timeout } };
  }
  const second = argv[2];
  if (repo === undefined || second === undefined) {
    return { ok: false, error: `${cmd} takes a repo and a branch` };
  }
  const branch = second as string;
  let dispatch: string | null = null;
  let handover: string | null = null;
  let report: string | null = null;
  let folder: string | null = null;
  let landing: string | null = null;
  let wordGiven = false;
  let timeout = DEFAULT_TIMEOUT;
  const rest = argv.slice(3);
  for (let j = 0; j < rest.length; j++) {
    const flag = rest[j] as string;
    if (flag === "--run") {
      const value = rest[j + 1];
      if (value === undefined) return { ok: false, error: `${cmd} needs --run <dispatch>` };
      dispatch = value;
      j++;
    } else if (flag === "--handover") {
      const value = rest[j + 1];
      if (value === undefined) return { ok: false, error: `${cmd} needs --handover <file>` };
      handover = value;
      j++;
    } else if (flag === "--report") {
      const value = rest[j + 1];
      if (value === undefined) return { ok: false, error: `${cmd} needs --report <file>` };
      report = value;
      j++;
    } else if (flag === "--folder") {
      const value = rest[j + 1];
      if (value === undefined) return { ok: false, error: `${cmd} needs --folder <dir>` };
      const normalized = normalizeFolder(value);
      if (!normalized.ok) return normalized;
      folder = normalized.folder;
      j++;
    } else if (flag === "--timeout") {
      const parsed = parseTimeoutText(rest[j + 1], false);
      if (!parsed.ok) return parsed;
      timeout = parsed.timeout;
      j++;
    } else if (flag === "--word") {
      if (cmd !== "land") return { ok: false, error: `unknown flag for check: ${flag}` };
      wordGiven = true;
    } else if (flag === "--landing") {
      if (cmd !== "land") return { ok: false, error: `unknown flag for check: ${flag}` };
      const value = rest[j + 1];
      if (value !== "local" && value !== "pull-request") {
        return { ok: false, error: `bad landing: ${value ?? "none"} (local or pull-request)` };
      }
      landing = value;
      j++;
    } else {
      return { ok: false, error: `unknown flag for ${cmd}: ${flag}` };
    }
  }
  if (dispatch === null) return { ok: false, error: `${cmd} needs --run <dispatch>` };
  if (handover !== null && report !== null) {
    return { ok: false, error: `${cmd} takes --handover or --report, not both` };
  }
  if (handover === null && report === null) {
    return { ok: false, error: `${cmd} needs --handover <file>` };
  }
  if (cmd === "land") {
    const req: ParsedLand = { cmd, repo, branch, dispatch, folder, timeout, landing, wordGiven };
    if (handover !== null) req.handover = handover;
    if (report !== null) req.report = report;
    return { ok: true, req };
  }
  const req: ParsedCheck = { cmd, repo, branch, dispatch, folder, timeout };
  if (handover !== null) req.handover = handover;
  if (report !== null) req.report = report;
  return { ok: true, req };
}

export interface PromptVars {
  repo: string;
  surface: string;
  surfaceProse: string;
  verifyDir: string;
  base: string;
  askRule: string;
  secretsRule: string;
  handoverUnasked: string;
  handoverRule?: string;
  /** The commit the session proves against, for the index's Confirmed line. */
  proved?: string;
}

/** Fill a template from explicit names and values. A leftover placeholder throws. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  // One pass, each value through a replacer function: an inserted value is
  // never rescanned, so $ patterns and placeholder-shaped text in a value
  // copy literally instead of expanding or throwing.
  return template.replace(/\{\{[A-Z_]+\}\}/gu, (m) => {
    const v: string | undefined = vars[m.slice(2, -2)];
    if (v === undefined) throw new Error(`unknown placeholder in the prompt template: ${m}`);
    return v;
  });
}

/** Fill the template's placeholders. A placeholder left over is a bug, and throws. */
export function renderPrompt(template: string, vars: PromptVars): string {
  const known: Record<string, string> = {
    REPO: vars.repo,
    SURFACE: vars.surface,
    SURFACE_PROSE: vars.surfaceProse,
    VERIFY_DIR: vars.verifyDir,
    BASE: vars.base,
    ASK_RULE: vars.askRule,
    SECRETS_RULE: vars.secretsRule,
    HANDOVER_UNASKED: vars.handoverUnasked,
  };
  if (vars.handoverRule !== undefined) known.HANDOVER_RULE = vars.handoverRule;
  if (vars.proved !== undefined) known.PROVED = vars.proved;
  return renderTemplate(template, known);
}

/** The upkeep line every verifier carries where an agent reads first. */
export const UPKEEP_LINE =
  "A change which adds, changes or removes a feature updates that feature's page in the same change.";

/** The upkeep line verbatim in the README head, where an agent reads first. */
export function hasUpkeepLine(text: string): boolean {
  // The head is the first 30 lines: the live verifiers carry the line at line
  // 5, so a copy past this window is buried, not read first.
  const head = text.split("\n").slice(0, 30).join("\n");
  // ASCII: widening to Unicode whitespace only folds more runs, never splits a match
  const flat = (s: string): string => s.replace(/\s+/gu, " ");
  return flat(head).includes(flat(UPKEEP_LINE));
}

/** One index entry names the kind's folder and its surface prose together. */
export function indexNames(text: string, kind: Surface): boolean {
  const prose = PROSE[kind];
  return text.split("\n").some((line) => {
    // LOWER: lowered for an ASCII keyword match
    const lower = line.toLowerCase();
    if (!lower.includes(prose)) return false;
    // A full verifier/<kind>/ path bounded past the kind, so verifier/cli-extra/
    // never reads as the cli verifier, or a relative folder link [cli](cli/).
    return new RegExp(`verifier/${kind}(?![A-Za-z0-9_-])|\\]\\( *${kind}/`, "u").test(lower);
  });
}

export interface VerifierEntry {
  /** Repo-relative folder, e.g. verifier/cli. */
  folder: string;
  /** The surface in prose, or "unstated". */
  surface: string;
  /** Repo-relative feature pages, sorted. */
  pages: string[];
}

export interface VerifierListing {
  /** Read-first entries: the shared index where one exists, else each verifier's README. */
  indexes: string[];
  /** The verifiers, sorted by folder. */
  verifiers: VerifierEntry[];
}

/** The surface prose a multi folder kind names, or null for a kind unknown. */
export function kindProse(kind: string): string | null {
  const surface = surfaceKind(kind);
  return surface === null ? null : PROSE[surface];
}

/** The surface a verifier README's head states, or null when it states none. */
export function surfaceFromReadme(text: string): string | null {
  // The head is the first 30 lines, as hasUpkeepLine reads it: the H1 subject
  // comes first, so the earliest prose phrase wins over a later aside.
  const head = text.split("\n").slice(0, 30).join("\n");
  // LOWER: lowered for ASCII phrase matches
  const lower = head.toLowerCase();
  const phrases: Array<[string, Surface]> = [
    ["command line", "cli"],
    ["web pages", "web"],
    ["library interface", "library"],
  ];
  let best: { at: number; surface: Surface } | null = null;
  for (const [phrase, surface] of phrases) {
    const at = lower.indexOf(phrase);
    if (at !== -1 && (best === null || at < best.at)) best = { at, surface };
  }
  if (best !== null) return PROSE[best.surface];
  // A minimal README may name only the short token, as src/cli.ts does. No
  // library token: a bare "library" is usually the project's own code.
  const tokens: Array<[RegExp, Surface]> = [
    [/\bcli\b/u, "cli"], // ASCII: ASCII literals; an adjacent ASCII word char joins them
    [/\bweb\b/u, "web"], // ASCII: ASCII literals; an adjacent ASCII word char joins them
  ];
  let tokenBest: { at: number; surface: Surface } | null = null;
  for (const [re, surface] of tokens) {
    const m = re.exec(lower);
    if (m !== null && (tokenBest === null || m.index < tokenBest.at)) {
      tokenBest = { at: m.index, surface };
    }
  }
  return tokenBest === null ? null : PROSE[tokenBest.surface];
}

/** Feature pages from a features/ listing: markdown besides its index, sorted. */
export function featurePageNames(names: string[]): string[] {
  return names.filter((n) => n.endsWith(".md") && n !== "README.md").sort();
}

/** The list output for verifiers found, or "verifiers: none". */
export function renderListing(listing: VerifierListing): string {
  if (listing.verifiers.length === 0) return "verifiers: none";
  const lines: string[] = [];
  for (const index of listing.indexes) lines.push(`index: ${index}`);
  for (const v of listing.verifiers) {
    lines.push(`verifier: ${v.folder}`);
    lines.push(`surface: ${v.surface}`);
    lines.push(`features: ${v.pages.length === 0 ? "none" : v.pages.join(" ")}`);
  }
  return lines.join("\n");
}

function isFilePath(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirPath(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function childNames(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function readmeText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** One verifier's entry from its folder, or null when the folder holds no verifier. */
function readVerifier(repo: string, folder: string, kind: string | null): VerifierEntry | null {
  if (!isFilePath(join(repo, folder, "README.md"))) return null;
  const pages = featurePageNames(childNames(join(repo, folder, "features"))).map(
    (n) => `${folder}/features/${n}`,
  );
  const fromKind = kind === null ? null : kindProse(kind);
  const surface =
    fromKind ?? surfaceFromReadme(readmeText(join(repo, folder, "README.md"))) ?? "unstated";
  return { folder, surface, pages };
}

/**
 * The repo's verifiers from its working tree, in both shapes: the multi
 * verifier/ folder with its index, and any top-level folder starting with
 * verify- that holds a README.md. A renamed repo keeps its old slug, so the
 * single shape matches the prefix, never the slug of today.
 */
export function listVerifiers(repo: string): VerifierListing {
  const verifiers: VerifierEntry[] = [];
  const indexes: string[] = [];
  const multiIndex = isFilePath(join(repo, "verifier", "README.md"));
  if (multiIndex) indexes.push("verifier/README.md");
  if (isDirPath(join(repo, "verifier"))) {
    for (const kind of childNames(join(repo, "verifier")).sort()) {
      if (!isDirPath(join(repo, "verifier", kind))) continue;
      const entry = readVerifier(repo, `verifier/${kind}`, kind);
      if (entry !== null) {
        verifiers.push(entry);
        // No shared index: each verifier's README is the read-first entry.
        if (!multiIndex) indexes.push(`verifier/${kind}/README.md`);
      }
    }
  }
  for (const name of childNames(repo).sort()) {
    if (!name.startsWith("verify-") || !isDirPath(join(repo, name))) continue;
    const entry = readVerifier(repo, name, null);
    if (entry !== null) {
      verifiers.push(entry);
      indexes.push(`${name}/README.md`);
    }
  }
  verifiers.sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0));
  indexes.sort();
  return { indexes, verifiers };
}

/**
 * What the session may ask, in the tool's own words from pstack's first step:
 * the project first, the user only for what it does not show. The headless
 * session cannot ask at all, so it records each open question for the
 * deliverable's unasked list: HANDOVER.md for make, UPKEEP.md for upkeep.
 */
export function askRule(headless: boolean, doc: string): string {
  if (!headless) {
    return (
      "Learn the project from its files first, and ask the user only what you cannot observe there. " +
      "A question the working copy answers is never asked; the user sits behind this session and answers " +
      "what the project does not show."
    );
  }
  return (
    "Learn the project from its files, never from the user: this session cannot ask anyone anything. " +
    `For every question below the working copy does not answer, record it for ${doc}'s unasked list ` +
    "instead of asking: what you needed, and what it would have taken."
  );
}

/**
 * A secret reaches the session as the name of the file that holds it, which the
 * user fills in themselves, as setup takes a tracker key; the value never passes
 * through the conversation, the deliverable or the verifiers. Headless, the need
 * joins the unasked list and no value is ever invented.
 */
export function secretsRule(headless: boolean, doc: string): string {
  if (!headless) {
    return (
      "When a step needs a secret — a login, a token or a key — ask the user for the name of the file " +
      "that holds it, never the value itself. The user fills that file in themselves; the verifier reads " +
      `the file when it drives the app. The value never appears in this conversation, in ${doc} or in ` +
      "the verifier: only the file's name does."
    );
  }
  return (
    "When a step needs a secret — a login, a token or a key — record the file you would have asked the user " +
    "to name in the unasked list, with what the value unlocks. Never invent a value, and never write a " +
    `guessed one into the verifier: no value reaches ${doc} or the verifier.`
  );
}

export const INTERACTIVE_ASK_RULE = askRule(false, "HANDOVER.md");

export const HEADLESS_ASK_RULE = askRule(true, "HANDOVER.md");

export const INTERACTIVE_SECRETS_RULE = secretsRule(false, "HANDOVER.md");

export const HEADLESS_SECRETS_RULE = secretsRule(true, "HANDOVER.md");

/** The hand-over's extra section with no host; the interactive hand-over needs none. */
export const HEADLESS_HANDOVER_UNASKED =
  " It also carries an Unasked questions section: each question you could not ask, with what it would " +
  "have needed — the file, the value's purpose, the step it blocked.";

/** The upkeep report's extra sections with no host; the interactive report needs none. */
export const UPKEEP_HEADLESS_UNASKED =
  " It also carries in UPKEEP.md one `## Unasked:` section per question you could not ask, each with " +
  "a `Needed:` line saying what answering it would have taken — the file, the value's purpose, the step it blocked.";

/**
 * The template's mode blocks: the interactive session's, or the headless
 * one's, naming the deliverable that carries the unasked list: HANDOVER.md
 * for make, UPKEEP.md for upkeep.
 */
export function modeBlocks(
  headless: boolean,
  doc = "HANDOVER.md",
): {
  askRule: string;
  secretsRule: string;
  handoverUnasked: string;
} {
  if (headless) {
    return {
      askRule: askRule(true, doc),
      secretsRule: secretsRule(true, doc),
      handoverUnasked: HEADLESS_HANDOVER_UNASKED,
    };
  }
  return {
    askRule: askRule(false, doc),
    secretsRule: secretsRule(false, doc),
    handoverUnasked: "",
  };
}

/** The kinds as prose for the multi header: "command line, web pages". */
export function proseList(kinds: Surface[]): string {
  return kinds.map((k) => PROSE[k]).join(", ");
}

/** One mapping line per kind for the multi header. */
export function dirLines(kinds: Surface[]): string {
  return kinds.map((k) => `- the ${PROSE[k]} (${k}) verifier goes in verifier/${k}/`).join("\n");
}

/** The no-verifier sentence for the kinds left out, or "" when none are. */
export function unlistedSentence(kinds: Surface[]): string {
  const left = SURFACES.filter((k) => !kinds.includes(k)).map((k) => `the ${PROSE[k]}`);
  if (left.length === 0) return "";
  const last = left.slice(-1).join("");
  const names = left.length === 1 ? last : `${left.slice(0, -1).join(", ")} and ${last}`;
  const it = left.length === 1 ? "it" : "them";
  return `- Make no verifier for ${names}. If you notice ${it} while you work, leave ${it} out.`;
}

/** The per-surface sections, numbered, separated by rules. */
export function joinBodies(bodies: { kind: Surface; text: string }[]): string {
  const total = bodies.length;
  return bodies
    .map(
      (b, n) =>
        `---\n\n**Verifier ${n + 1} of ${total}: ${PROSE[b.kind]} (${b.kind}).**\n\n${b.text}`,
    )
    .join("\n\n");
}

/** The verifier folder for a repo: verify- plus its slugged base name. */
export function verifyDirName(repoPath: string): string {
  const slug = basename(repoPath)
    .toLowerCase() // LOWER: lowered for an ASCII slug
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug === "" ? "verify-app" : `verify-${slug}`;
}

/** The session's verifiers folder: one surface keeps #323's folder, several share one. */
export function sessionFolder(repo: string, surfaces: Surface[]): string {
  return surfaces.length === 1 ? verifyDirName(repo) : "verifier";
}

/** The verifier folders present at the repo top: the shared one, the single one, or both. */
export function presentVerifierFolders(repo: string): string[] {
  const out: string[] = [];
  if (existsSync(join(repo, "verifier"))) out.push("verifier");
  const single = verifyDirName(repo);
  if (existsSync(join(repo, single))) out.push(single);
  return out;
}

/** A stem numbered past names taken: the stem itself, then stem-2, stem-3. */
function numbered(stem: string, taken: (name: string) => boolean): string {
  let name = stem;
  let n = 2;
  while (taken(name)) {
    name = `${stem}-${n}`;
    n++;
  }
  return name;
}

/** The session's branch: verify-<surface>, numbered past branches taken. */
export function pickBranch(taken: (name: string) => boolean, surface: string): string {
  return numbered(`verify-${surface}`, taken);
}

/** The session's worktree: a sibling of the repo, numbered past paths taken. */
export function pickWorktree(
  repo: string,
  surface: string,
  exists: (p: string) => boolean,
): string {
  return numbered(join(dirname(repo), `${basename(repo)}-verify-${surface}`), exists);
}

/** The upkeep pass's branch: upkeep, numbered past branches taken. */
export function pickUpkeepBranch(taken: (name: string) => boolean): string {
  return numbered("upkeep", taken);
}

/** The upkeep pass's worktree: a sibling of the repo, numbered past paths taken. */
export function pickUpkeepWorktree(repo: string, exists: (p: string) => boolean): string {
  return numbered(join(dirname(repo), `${basename(repo)}-upkeep`), exists);
}

/**
 * The spawn handle: the repo, the session's branch, and a tag from the repo's
 * path, since both hosts check session names globally: the branch numbers
 * past sessions taken in one repo, and the tag keeps two checkouts that share
 * a directory name apart.
 */
export function verifierHandle(repo: string, branch: string): string {
  const tag = createHash("sha256").update(resolve(repo)).digest("hex").slice(0, 8);
  return `verifier-${basename(repo)}-${branch}-${tag}`;
}

/**
 * The short first message the tab gets, clerk-style: the full instructions live
 * in the prompt file, and the session reads them there.
 */
export function sendText(promptFile: string): string {
  return (
    "You are making a verifier for one surface of a project. " +
    `Read your instructions at ${promptFile}, then follow them. ` +
    "This directory is your working copy.\n"
  );
}

/**
 * The short first message the upkeep tab gets, clerk-style: the full
 * instructions live in the prompt file, and the session reads them there.
 */
export function upkeepSendText(promptFile: string): string {
  return (
    "You are running an upkeep pass over this project's verifiers. " +
    `Read your instructions at ${promptFile}, then follow them. ` +
    "This directory is your working copy.\n"
  );
}

/**
 * The short first message the correcting tab gets, clerk-style: the full
 * instructions live in the prompt file, and the session reads them there.
 */
export function upkeepCorrectSendText(promptFile: string): string {
  return (
    "You are running a correcting upkeep pass over this project's verifiers. " +
    `Read your instructions at ${promptFile}, then follow them. ` +
    "This directory is your working copy.\n"
  );
}

/** The remote branch origin/HEAD names, or null when it names none. */
export function remoteFromSymbolicRef(out: string): string | null {
  const ref = out.trim();
  const prefix = "refs/remotes/";
  if (!ref.startsWith(prefix) || ref.length === prefix.length) return null;
  return ref.slice(prefix.length);
}

/** Inherited variables that redirect git away from -C: dropped for every git call. */
export const GIT_REDIRECT_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_NAMESPACE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_INDEX_FILE",
];

/** A copy of the environment with the git redirectors dropped. */
export function scrubGitEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (!GIT_REDIRECT_ENV.includes(k) && v !== undefined) out[k] = v;
  }
  return out;
}

/** git in a repo, blind to any inherited redirectors. */
function git(repo: string, args: string[]) {
  const env: Record<string, string | undefined> = {};
  for (const k of GIT_REDIRECT_ENV) env[k] = undefined;
  return run("git", ["-C", repo, ...args], { env });
}

/** Drop stale worktree registrations, best-effort: a hand-deleted worktree blocks its path. */
export function pruneWorktrees(repo: string): void {
  git(repo, ["worktree", "prune"]);
}

/** The top of the repo holding a path, or null when no repo holds it. */
export function repoTop(repo: string): string | null {
  const r = git(repo, ["rev-parse", "--show-toplevel"]);
  if (r.code !== 0) return null;
  const top = r.out.trim();
  return top === "" ? null : top;
}

/** Commits on the branch past the base, or null when they cannot be counted. */
export function commitsPastBase(repo: string, base: string, branch: string): number | null {
  const r = git(repo, ["rev-list", "--count", `${base}..${branch}`]);
  if (r.code !== 0) return null;
  const n = Number(r.out.trim());
  return Number.isInteger(n) ? n : null;
}

/** A path is present in the branch's committed tree. */
export function branchHasPath(repo: string, branch: string, path: string): boolean {
  const r = git(repo, ["ls-tree", "--name-only", branch, "--", path]);
  return r.code === 0 && r.out.trim() !== "";
}

/**
 * The verifiers' folders: the explicit one alone, else every shape the
 * revision holds, the single front page first. A repo that holds both
 * shapes gets both: preferring one would silently drop the other's suite.
 * The pass reads the current commit; the report landing reads the compared
 * base, never the branch being judged.
 */
export function detectFolders(repo: string, explicit: string | null, at = "HEAD"): string[] {
  if (explicit !== null) return [explicit];
  const folders: string[] = [];
  const single = verifyDirName(repo);
  if (branchHasPath(repo, at, `${single}/README.md`)) folders.push(single);
  if (branchHasPath(repo, at, "verifier/README.md")) folders.push("verifier");
  return folders;
}

/**
 * A feature page of the verifier dir: markdown under its features/ folder,
 * besides its index. Nested pages count, as make counts them: a page make
 * accepts is a page the pass drives.
 */
export function isFeaturePage(vdir: string, path: string): boolean {
  if (!path.startsWith(`${vdir}/features/`) || !path.endsWith(".md")) return false;
  return path.slice(`${vdir}/features/`.length) !== "README.md";
}

/**
 * The folder's verifier dirs at a revision: itself when it carries a front
 * page and a features/ folder, and each subdir that does. A features/ folder
 * without a front page beside it is no verifier's, so the pass counts exactly
 * what make counts. Null when unreadable. The pass reads the current commit;
 * the correcting validation reads the driven one, which no later merge moves.
 */
export function scopeVdirs(repo: string, folder: string, at = "HEAD"): string[] | null {
  // -z: NUL-separated and never quoted, so non-ASCII names list as written;
  // -d lists the immediate subdirs, and a missing folder lists nothing.
  const subs = git(repo, ["ls-tree", "-z", "-d", "--name-only", at, "--", `${folder}/`]);
  if (subs.code !== 0) return null;
  const vdirs: string[] = [];
  for (const cand of [folder, ...subs.out.split("\0").filter((l) => l !== "")]) {
    if (!branchHasPath(repo, at, `${cand}/README.md`)) continue;
    const has = git(repo, ["ls-tree", "-z", "-r", "--name-only", at, "--", `${cand}/features/`]);
    if (has.code !== 0) return null;
    if (has.out.split("\0").some((l) => l !== "")) vdirs.push(cand);
  }
  return vdirs;
}

/** The folder's feature pages at the current commit, across its verifier dirs, sorted, or null when unreadable. */
export function featurePages(repo: string, folder: string): string[] | null {
  const vdirs = scopeVdirs(repo, folder);
  if (vdirs === null) return null;
  const pages: string[] = [];
  for (const vdir of vdirs) {
    const listed = committedFeaturePages(repo, "HEAD", vdir);
    if (listed === null) return null;
    pages.push(...listed);
  }
  return pages.sort();
}

/** The handover was written after the cut, so this session made it. */
export function handoverFresh(handoverMtimeMs: number, cutMs: number): boolean {
  return handoverMtimeMs >= cutMs;
}

function handoverMtimeMs(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/** The file's change stamp: mtime and size, or null when it cannot be read. */
function fileStamp(path: string): { mtimeMs: number; size: number } | null {
  try {
    const st = statSync(path);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

/** Naps between handover checks: short enough that a small timeout keeps its shape. */
export const HANDOVER_NAP_SECONDS = 5;

/**
 * True once the worktree holds a file this session wrote, unchanged across one
 * nap: a report written in pieces must not read half done. An interactive
 * session has no marker, so the settled file is the completion signal. A
 * timeout of 0 waits without a limit. The clock and the sleep are injected
 * for tests.
 */
export function waitForFile(
  wt: string,
  file: string,
  cutMs: number,
  timeoutSec: number,
  sleepMs: (ms: number) => void = (ms) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  },
  nowMs: () => number = Date.now,
): boolean {
  const deadline = nowMs() + timeoutSec * 1000;
  let seen: { mtimeMs: number; size: number } | null = null;
  for (;;) {
    const stamp = fileStamp(join(wt, file));
    if (stamp !== null && handoverFresh(stamp.mtimeMs, cutMs)) {
      if (seen !== null && stamp.mtimeMs === seen.mtimeMs && stamp.size === seen.size) {
        return true;
      }
      seen = stamp;
    } else {
      seen = null;
    }
    if (timeoutSec > 0) {
      const left = deadline - nowMs();
      if (left <= 0) return false;
      sleepMs(Math.min(left, HANDOVER_NAP_SECONDS * 1000));
    } else {
      sleepMs(HANDOVER_NAP_SECONDS * 1000);
    }
  }
}

/**
 * True once the worktree holds a HANDOVER.md this session wrote. The prompt
 * orders the commit before it. A timeout of 0 waits without a limit.
 */
export function waitForHandover(
  wt: string,
  cutMs: number,
  timeoutSec: number,
  sleepMs: (ms: number) => void = (ms) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  },
  nowMs: () => number = Date.now,
): boolean {
  return waitForFile(wt, "HANDOVER.md", cutMs, timeoutSec, sleepMs, nowMs);
}

/** Markdown pages committed under the verifier's features folder, besides its index. */
export function committedFeaturePages(repo: string, branch: string, vdir: string): string[] | null {
  // -z: NUL-separated and never quoted, so non-ASCII names count as written.
  const r = git(repo, ["ls-tree", "-z", "-r", "--name-only", branch, "--", `${vdir}/features/`]);
  if (r.code !== 0) return null;
  return r.out.split("\0").filter((l) => l !== "" && isFeaturePage(vdir, l));
}

/** A committed blob's text, or null when the branch has no such file. */
export function branchFileText(repo: string, branch: string, path: string): string | null {
  const r = git(repo, ["show", `${branch}:${path}`]);
  return r.code === 0 ? r.out : null;
}

/** Paths the branch adds past its base, or null when they cannot be listed. */
export function addedPaths(repo: string, base: string, branch: string): string[] | null {
  // -z: NUL-separated and never quoted, so non-ASCII names list as written.
  const r = git(repo, ["diff", "--name-only", "--diff-filter=A", "-z", base, branch, "--"]);
  if (r.code !== 0) return null;
  return r.out.split("\0").filter((l) => l !== "");
}

/** Added paths under a directory. */
export function addedUnder(added: string[], dir: string): string[] {
  return added.filter((p) => p.startsWith(`${dir}/`));
}

/** Added markdown pages under a features folder, besides its index. */
export function addedFeaturePages(added: string[], vdir: string): string[] {
  return added.filter((p) => isFeaturePage(vdir, p));
}

/** Added paths with nowhere to be: HANDOVER.md alone sits beside verifier/. */
export function outsideAdded(added: string[]): string[] {
  return added.filter((p) => p !== "HANDOVER.md" && !p.startsWith("verifier/"));
}

/** Added verifier/ paths outside the listed verifiers and the index. */
export function strayVerifierPaths(added: string[], surfaces: Surface[]): string[] {
  return addedUnder(added, "verifier").filter((p) => {
    if (p === "verifier/README.md") return false;
    const seg = p.slice("verifier/".length).split("/")[0] ?? "";
    return !(surfaces as string[]).includes(seg);
  });
}

/** The base the session's branch is cut from: origin's head, main, master, or HEAD. */
export function defaultBase(repo: string): string | null {
  const sym = git(repo, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (sym.code === 0) {
    const name = remoteFromSymbolicRef(sym.out);
    if (name !== null && git(repo, ["rev-parse", "--verify", "--quiet", name]).code === 0) {
      return name;
    }
  }
  for (const b of ["main", "master"]) {
    if (git(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${b}`]).code === 0) {
      return b;
    }
  }
  const head = git(repo, ["rev-parse", "HEAD"]);
  if (head.code === 0) return head.out.trim();
  return null;
}

/**
 * The first line of the provider wall the stream ended on, or null. The
 * session runs under the coachman role, whose walls the launcher does not
 * record, so the verifier reads its own stream with the launcher's helpers.
 */
export function wallInStream(streamText: string, harness: string): string | null {
  const message = endingWallMessage(streamText, harness);
  if (message === null) return null;
  const first = message.split("\n")[0] ?? "";
  if (!isWallMessage(first)) return null;
  return first;
}

/** The harness the run recorded for a role, mirroring launch's per-leg pick. */
export function roleHarness(config: unknown, role: string, leg: string): string | null {
  if (typeof config !== "object" || config === null || Array.isArray(config)) return null;
  const team = (config as Record<string, unknown>)["team"];
  if (typeof team !== "object" || team === null || Array.isArray(team)) return null;
  const t = team as Record<string, unknown>;
  const harnessOf = (v: unknown): string | null => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
    const h = (v as Record<string, unknown>)["harness"];
    return typeof h === "string" && h !== "" ? h : null;
  };
  if (role === "coachman") {
    const legs = t["coachman_legs"];
    if (typeof legs === "object" && legs !== null && !Array.isArray(legs)) {
      const perLeg = harnessOf((legs as Record<string, unknown>)[leg]);
      if (perLeg !== null) return perLeg;
    }
    return harnessOf(t["coachman"]);
  }
  if (role === "coachman_fallback") return harnessOf(t["coachman_fallback"]);
  return null;
}

/** A repo-relative folder, stripped of a leading ./ and trailing slashes. */
export function normalizeFolder(
  raw: string,
): { ok: true; folder: string } | { ok: false; error: string } {
  let folder = raw;
  while (folder.startsWith("./")) folder = folder.slice(2);
  while (folder.endsWith("/") && folder.length > 1) folder = folder.slice(0, -1);
  if (folder === "" || folder === "/" || folder === ".") {
    return { ok: false, error: `bad folder: ${raw} is not a folder in the repo` };
  }
  if (folder.startsWith("/") || folder.split("/").includes("..")) {
    return { ok: false, error: `bad folder: ${raw} is not inside the repo` };
  }
  return { ok: true, folder };
}

export interface HandoverEntry {
  name: string;
  folder: string;
  /** The proof value as written, or null when the entry names none. */
  proof: string | null;
}

/**
 * The hand-over's verifier sections, in the order written. Only the section
 * headers and the first Folder: and Proof: line of each section are read; every
 * other line is prose. A missing Proof: line is not malformed: the entry names
 * no proof file and fails its proof.
 */
export function parseHandover(
  text: string,
): { ok: true; entries: HandoverEntry[] } | { ok: false; error: string } {
  const entries: HandoverEntry[] = [];
  const seen = new Set<string>();
  let current: { name: string; folder: string | null; proof: string | null } | null = null;
  const close = (): { ok: false; error: string } | null => {
    if (current === null) return null;
    if (current.folder === null || current.folder === "") {
      return { ok: false, error: `the hand-over names no folder for ${current.name}` };
    }
    const normalized = normalizeFolder(current.folder);
    if (!normalized.ok) {
      return {
        ok: false,
        error: `the hand-over folder for ${current.name} is not inside the repo: ${current.folder}`,
      };
    }
    entries.push({ name: current.name, folder: normalized.folder, proof: current.proof });
    current = null;
    return null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("## Verifier:")) {
      const failed = close();
      if (failed !== null) return failed;
      const name = line.slice("## Verifier:".length).trim();
      if (name === "") return { ok: false, error: "the hand-over has a verifier with no name" };
      if (seen.has(name)) return { ok: false, error: `the hand-over names ${name} twice` };
      seen.add(name);
      current = { name, folder: null, proof: null };
    } else if (current !== null && line.startsWith("Folder:") && current.folder === null) {
      current.folder = line.slice("Folder:".length).trim();
    } else if (current !== null && line.startsWith("Proof:") && current.proof === null) {
      current.proof = line.slice("Proof:".length).trim();
    }
  }
  const failed = close();
  if (failed !== null) return failed;
  return { ok: true, entries };
}

export interface ClassifiedEntry extends HandoverEntry {
  proven: boolean;
  /** Why a failed entry failed: no proof file, or the proof file missing. */
  failReason: string;
}

/** Proven means the entry names an absolute path holding a file. */
export function classifyEntries(
  entries: HandoverEntry[],
  isFile: (path: string) => boolean,
): ClassifiedEntry[] {
  return entries.map((e) => {
    const namesFile =
      e.proof !== null && e.proof !== "" && e.proof.startsWith("/") && isFile(e.proof);
    if (namesFile) return { ...e, proven: true, failReason: "" };
    const failReason =
      e.proof === null || e.proof === "" || !e.proof.startsWith("/")
        ? "no proof file"
        : `proof ${e.proof} missing`;
    return { ...e, proven: false, failReason };
  });
}

export type UpkeepOutcome = "clean" | "changed" | "blocked";
export type UpkeepClaimVerdict = "stale" | "unchecked";

export interface UpkeepVerifier {
  name: string;
  folder: string;
}

export interface UpkeepFeature {
  page: string;
  outcome: UpkeepOutcome;
}

export interface UpkeepClaim {
  name: string;
  page: string;
  verdict: UpkeepClaimVerdict;
  stated: string;
  /** What the drive showed instead; stale claims only. */
  found: string | null;
  /** Why the claim could not be checked; unchecked claims only. */
  because: string | null;
  /** What the correcting pass changed; set only with a non-empty Corrected: line. */
  corrected?: string;
}

export interface UpkeepUnasked {
  question: string;
  needed: string;
}

export interface UpkeepReport {
  verifiers: UpkeepVerifier[];
  features: UpkeepFeature[];
  claims: UpkeepClaim[];
  unasked: UpkeepUnasked[];
}

type UpkeepSection =
  | { kind: "verifier"; name: string; folder: string | null }
  | {
      kind: "feature";
      page: string;
      outcome: string | null;
    }
  | {
      kind: "claim";
      name: string;
      page: string | null;
      verdict: string | null;
      stated: string | null;
      found: string | null;
      because: string | null;
      corrected: string | null;
    }
  | { kind: "unasked"; question: string; needed: string | null };

function isOutcome(value: string): value is UpkeepOutcome {
  return value === "clean" || value === "changed" || value === "blocked";
}

function isClaimVerdict(value: string): value is UpkeepClaimVerdict {
  return value === "stale" || value === "unchecked";
}

/**
 * The upkeep report's sections, in the order written. Only the section headers
 * and the first labeled line of each kind per section are read; every other
 * line is prose.
 */
export function parseUpkeepReport(
  text: string,
): { ok: true; report: UpkeepReport } | { ok: false; error: string } {
  const report: UpkeepReport = { verifiers: [], features: [], claims: [], unasked: [] };
  const seenClaims = new Set<string>();
  const seenFeatures = new Set<string>();
  const seenVerifiers = new Set<string>();
  let current: UpkeepSection | null = null;
  const close = (): { ok: false; error: string } | null => {
    if (current === null) return null;
    if (current.kind === "verifier") {
      if (current.folder === null || current.folder === "") {
        return { ok: false, error: `the report names no folder for ${current.name}` };
      }
      const normalized = normalizeFolder(current.folder);
      if (!normalized.ok) {
        return {
          ok: false,
          error: `the report folder for ${current.name} is not inside the repo: ${current.folder}`,
        };
      }
      report.verifiers.push({ name: current.name, folder: normalized.folder });
    } else if (current.kind === "feature") {
      if (current.outcome === null || current.outcome === "") {
        return { ok: false, error: `the report names no outcome for ${current.page}` };
      }
      if (!isOutcome(current.outcome)) {
        return {
          ok: false,
          error: `the outcome for ${current.page} is not clean, changed or blocked: ${current.outcome}`,
        };
      }
      report.features.push({ page: current.page, outcome: current.outcome });
    } else if (current.kind === "claim") {
      if (current.page === null || current.page === "") {
        return { ok: false, error: `the report names no page for ${current.name}` };
      }
      if (current.verdict === null || current.verdict === "") {
        return { ok: false, error: `the report names no verdict for ${current.name}` };
      }
      if (!isClaimVerdict(current.verdict)) {
        return {
          ok: false,
          error: `the verdict for ${current.name} is not stale or unchecked: ${current.verdict}`,
        };
      }
      if (current.stated === null || current.stated === "") {
        return { ok: false, error: `the report names no stated result for ${current.name}` };
      }
      if (current.verdict === "stale" && (current.found === null || current.found === "")) {
        return { ok: false, error: `the report names no finding for ${current.name}` };
      }
      if (current.verdict === "unchecked" && (current.because === null || current.because === "")) {
        return { ok: false, error: `the report names no reason for ${current.name}` };
      }
      if (current.corrected !== null && current.corrected === "") {
        return { ok: false, error: `the report names no correction for ${current.name}` };
      }
      const claim: UpkeepClaim = {
        name: current.name,
        page: current.page,
        verdict: current.verdict,
        stated: current.stated,
        found: current.found,
        because: current.because,
      };
      if (current.corrected !== null) claim.corrected = current.corrected;
      report.claims.push(claim);
    } else {
      if (current.needed === null || current.needed === "") {
        return {
          ok: false,
          error: `the report names nothing its unasked question needed: ${current.question}`,
        };
      }
      report.unasked.push({ question: current.question, needed: current.needed });
    }
    current = null;
    return null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const header =
      line.startsWith("## Verifier:") ||
      line.startsWith("## Feature:") ||
      line.startsWith("## Claim:") ||
      line.startsWith("## Unasked:")
        ? line
        : null;
    if (header !== null) {
      const failed = close();
      if (failed !== null) return failed;
      if (header.startsWith("## Verifier:")) {
        const name = header.slice("## Verifier:".length).trim();
        if (name === "") return { ok: false, error: "the report has a verifier with no name" };
        if (seenVerifiers.has(name)) {
          return { ok: false, error: `the report names ${name} twice` };
        }
        seenVerifiers.add(name);
        current = { kind: "verifier", name, folder: null };
      } else if (header.startsWith("## Feature:")) {
        const page = header.slice("## Feature:".length).trim();
        if (page === "") return { ok: false, error: "the report has a feature with no page" };
        if (seenFeatures.has(page)) {
          return { ok: false, error: `the report names ${page} twice` };
        }
        seenFeatures.add(page);
        current = { kind: "feature", page, outcome: null };
      } else if (header.startsWith("## Claim:")) {
        const name = header.slice("## Claim:".length).trim();
        if (name === "") return { ok: false, error: "the report has a claim with no name" };
        if (seenClaims.has(name)) {
          return { ok: false, error: `the report names ${name} twice` };
        }
        seenClaims.add(name);
        current = {
          kind: "claim",
          name,
          page: null,
          verdict: null,
          stated: null,
          found: null,
          because: null,
          corrected: null,
        };
      } else {
        const question = header.slice("## Unasked:".length).trim();
        if (question === "") {
          return { ok: false, error: "the report has an unasked question with no question" };
        }
        current = { kind: "unasked", question, needed: null };
      }
    } else if (current !== null) {
      if (current.kind === "verifier" && line.startsWith("Folder:") && current.folder === null) {
        current.folder = line.slice("Folder:".length).trim();
      } else if (
        current.kind === "feature" &&
        line.startsWith("Outcome:") &&
        current.outcome === null
      ) {
        current.outcome = line.slice("Outcome:".length).trim();
      } else if (current.kind === "claim" && line.startsWith("Page:") && current.page === null) {
        current.page = line.slice("Page:".length).trim();
      } else if (
        current.kind === "claim" &&
        line.startsWith("Verdict:") &&
        current.verdict === null
      ) {
        current.verdict = line.slice("Verdict:".length).trim();
      } else if (
        current.kind === "claim" &&
        line.startsWith("Stated:") &&
        current.stated === null
      ) {
        current.stated = line.slice("Stated:".length).trim();
      } else if (current.kind === "claim" && line.startsWith("Found:") && current.found === null) {
        current.found = line.slice("Found:".length).trim();
      } else if (
        current.kind === "claim" &&
        line.startsWith("Because:") &&
        current.because === null
      ) {
        current.because = line.slice("Because:".length).trim();
      } else if (
        current.kind === "claim" &&
        line.startsWith("Corrected:") &&
        current.corrected === null
      ) {
        current.corrected = line.slice("Corrected:".length).trim();
      } else if (
        current.kind === "unasked" &&
        line.startsWith("Needed:") &&
        current.needed === null
      ) {
        current.needed = line.slice("Needed:".length).trim();
      }
    }
  }
  const failed = close();
  if (failed !== null) return failed;
  return { ok: true, report };
}

export interface UpkeepVerdict {
  lines: string[];
  stale: number;
  unchecked: number;
}

/**
 * The verdict over a parsed report: every committed feature page driven exactly
 * once, every changed or blocked page carrying its claims, a page with both a
 * stale and an unchecked claim reading blocked, and no correction on a claim
 * the pass never checked. The lines list each stale claim with what the pass
 * found instead and what a correcting pass changed, each unchecked claim with
 * why, the unasked questions, and the summary.
 */
export function verdictUpkeep(
  pages: string[],
  folders: string[],
  report: UpkeepReport,
): { ok: true; verdict: UpkeepVerdict } | { ok: false; error: string } {
  if (report.verifiers.length === 0) return { ok: false, error: "the report names no verifier" };
  for (const v of report.verifiers) {
    const inside = folders.some((f) => v.folder === f || v.folder.startsWith(`${f}/`));
    if (!inside) {
      return {
        ok: false,
        error: `the report's verifier ${v.name} sits outside ${folders.join(", ")}: ${v.folder}`,
      };
    }
  }
  const outcomes = new Map(report.features.map((f) => [f.page, f.outcome]));
  for (const page of pages) {
    if (!outcomes.has(page)) {
      return { ok: false, error: `the report names no outcome for ${page}` };
    }
  }
  for (const page of outcomes.keys()) {
    if (!pages.includes(page)) {
      return { ok: false, error: `the report names a page the verifiers do not hold: ${page}` };
    }
  }
  for (const feature of report.features) {
    const onPage = report.claims.filter((c) => c.page === feature.page);
    // An unchecked claim means the page was not fully driven, so a page with
    // both verdicts is blocked: changed claims a fully driven page with a
    // failure on it, and nothing less.
    if (feature.outcome === "changed" && !onPage.some((c) => c.verdict === "stale")) {
      return {
        ok: false,
        error: `the report names no stale claim for its changed page ${feature.page}`,
      };
    }
    if (feature.outcome === "changed" && onPage.some((c) => c.verdict === "unchecked")) {
      return {
        ok: false,
        error: `the report's changed page ${feature.page} carries an unchecked claim`,
      };
    }
    if (feature.outcome === "blocked" && !onPage.some((c) => c.verdict === "unchecked")) {
      return {
        ok: false,
        error: `the report names no unchecked claim for its blocked page ${feature.page}`,
      };
    }
    if (feature.outcome === "clean" && onPage.length > 0) {
      return {
        ok: false,
        error: `the report names claims for its clean page ${feature.page}`,
      };
    }
  }
  for (const claim of report.claims) {
    if (!pages.includes(claim.page)) {
      return {
        ok: false,
        error: `the report's claim ${claim.name} sits on no page the verifiers hold: ${claim.page}`,
      };
    }
    const outcome = outcomes.get(claim.page) as UpkeepOutcome;
    if (claim.verdict === "unchecked" && outcome !== "blocked") {
      return {
        ok: false,
        error: `the report's unchecked claim ${claim.name} sits on a ${outcome} page`,
      };
    }
    if (claim.verdict === "stale" && outcome !== "changed" && outcome !== "blocked") {
      return {
        ok: false,
        error: `the report's stale claim ${claim.name} sits on a ${outcome} page`,
      };
    }
    if (claim.verdict === "unchecked" && claim.corrected !== undefined) {
      return {
        ok: false,
        error: `the report's unchecked claim ${claim.name} carries a correction`,
      };
    }
  }
  const lines: string[] = [];
  for (const claim of report.claims) {
    if (claim.verdict === "stale") {
      lines.push(`stale: ${claim.name} (${claim.page})`);
      lines.push(`  stated: ${claim.stated}`);
      lines.push(`  found: ${claim.found as string}`);
      if (claim.corrected !== undefined) {
        lines.push(`corrected: ${claim.name} (${claim.page})`);
        lines.push(`  change: ${claim.corrected}`);
      }
    } else {
      lines.push(`unchecked: ${claim.name} (${claim.page})`);
      lines.push(`  because: ${claim.because as string}`);
    }
  }
  for (const open of report.unasked) {
    lines.push(`unasked: ${open.question}`);
    lines.push(`  needed: ${open.needed}`);
  }
  const stale = report.claims.filter((c) => c.verdict === "stale").length;
  const unchecked = report.claims.filter((c) => c.verdict === "unchecked").length;
  lines.push(`features driven: ${pages.length}, stale: ${stale}, unchecked: ${unchecked}`);
  return { ok: true, verdict: { lines, stale, unchecked } };
}

/** The diff paths outside the verifiers' folder, in the order git listed them. */
export function outsidePaths(paths: string[], folder: string): string[] {
  return outsideFolders(paths, [folder]);
}

/** The diff paths outside every verifiers' folder, in the order git listed them. */
export function outsideFolders(paths: string[], folders: string[]): string[] {
  return paths.filter((p) => !folders.some((f) => p.startsWith(`${f}/`)));
}

/** The folder-rule refusal for paths outside the verifiers' folder, or null. */
export function outsideReason(outside: string[]): string | null {
  if (outside.length === 0) return null;
  const shown = outside.slice(0, 10).join(", ");
  const more = outside.length > 10 ? ` and ${outside.length - 10} more` : "";
  return `outside the verifiers' folder: ${shown}${more}`;
}

/** The confirmation a pass writes: the driven commit as a full sha. */
// ASCII: spacing around a hex-only sha; a wider match still needs the 40 hex
const CONFIRMED_RE = /Confirmed:\s*([0-9a-fA-F]{40})\b/u;

/**
 * The sha an index span confirms, lowered, or null when it names none. The
 * label is case-sensitive, as the instructions write it; the sha may use
 * either case.
 */
export function confirmedSha(span: string): string | null {
  const m = CONFIRMED_RE.exec(span);
  // ASCII: the sha matched hex-only
  return m === null ? null : (m[1] as string).toLowerCase();
}

/** A bullet starts a span; a heading ends whatever bullet is open. */
// ASCII: indentation and the gap after the marker are plain spaces
const BULLET_START_RE = /^\s*[-*+]\s/u;
// ASCII: indentation and the gap after the hashes are plain spaces
const HEADING_RE = /^\s*#{1,6}\s/u;

/**
 * The shared index's bullets, each with the lines it spans. A confirmation on
 * an indented continuation line counts, so a wrapped bullet confirms like a
 * single-line one; a flush-left line ends the list, so a free-floating
 * Confirmed: paragraph credits no verifier.
 */
export function indexBullets(text: string): string[][] {
  const bullets: string[][] = [];
  let current: string[] | null = null;
  for (const line of text.split("\n")) {
    if (BULLET_START_RE.test(line)) {
      current = [line];
      bullets.push(current);
    } else if (HEADING_RE.test(line)) {
      current = null;
    } else if (current !== null) {
      if (line === "" || line.startsWith(" ") || line.startsWith("\t")) {
        current.push(line);
      } else {
        current = null;
      }
    }
  }
  return bullets;
}

/**
 * A bullet span names a verifier dir when its first line names the dir's
 * folder. A mention deeper in the prose names nothing, so one verifier's
 * aside never claims another's confirmation.
 */
export function spanNamesDir(span: string[], vdir: string): boolean {
  const first = span[0] ?? "";
  const seg = vdir.split("/").pop() ?? vdir;
  const esc = seg.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  // The folder path bounded past the kind, as indexNames reads it, or a
  // relative folder link [kind](kind/).
  const re = new RegExp(`verifier/${esc}(?![A-Za-z0-9_-])|\\]\\( *${esc}/`, "iu");
  return re.test(first);
}

/** The sha a features index confirms for its one verifier, or null. */
export function featuresConfirm(text: string): string | null {
  return confirmedSha(text);
}

/**
 * The sha the shared index's bullet for a verifier dir confirms, or null.
 * Null when no bullet names the dir, and when several do: an ambiguous
 * index refuses rather than attribute one verifier's confirmation to another.
 */
export function bulletConfirm(text: string, vdir: string): string | null {
  const spans = indexBullets(text).filter((span) => spanNamesDir(span, vdir));
  if (spans.length !== 1) return null;
  return confirmedSha((spans[0] ?? []).join("\n"));
}

/**
 * A verifier dir's index file: the shared index where one covers it, else its
 * own features index. The shared index covers verifier/<kind> dirs only; the
 * folder itself keeps its features index like a single verifier.
 */
export function indexFileFor(vdir: string, shared: boolean): string {
  const seg = vdir.split("/");
  if (shared && seg.length === 2 && seg[0] === "verifier") return "verifier/README.md";
  return `${vdir}/features/README.md`;
}

/**
 * The project paths a verifier's index scope lists after its `Files:` label,
 * comma-separated, each relative to the repo top, or null when the scope names
 * none. The scope is one features-index line or one shared-index bullet span.
 * The value ends at a `Confirmed:` label or the scope's end; each entry drops
 * markdown framing from the outside in — wrapping backticks and one trailing
 * full stop (the sentence's, as the shared bullets read), nesting in either
 * order — then a leading `./` and trailing slashes, so a folder last in the
 * list matches. A bare `.` names no path and is dropped. The label is
 * case-sensitive, as the instructions write it.
 */
export function parseFilesList(scope: string): string[] | null {
  const at = scope.indexOf("Files:");
  if (at === -1) return null;
  let value = scope.slice(at + "Files:".length);
  const confirmed = value.indexOf("Confirmed:");
  if (confirmed !== -1) value = value.slice(0, confirmed);
  const entries: string[] = [];
  // ASCII: widening to Unicode whitespace only folds more runs, never splits an entry
  for (const raw of value.replace(/\s+/gu, " ").split(",")) {
    // Framing the sentences and markdown add is not the path: wrapping
    // backticks and one sentence dot, nesting in either order, so both strip
    // twice from the outside, then a leading ./ and trailing slashes.
    let entry = raw.trim();
    for (let pass = 0; pass < 2; pass++) {
      entry = entry.replace(/^`+|`+$/gu, "");
      if (entry.endsWith(".") && entry.length > 1) entry = entry.slice(0, -1);
    }
    if (entry.startsWith("./")) entry = entry.slice("./".length);
    entry = entry.replace(/\/+$/u, "");
    if (entry !== "" && entry !== ".") entries.push(entry);
  }
  return entries;
}

/**
 * The changed files that fall under the verifier's listed paths, sorted: a
 * listed file matches itself, a listed folder matches every changed file
 * beneath it. Both sides are repo-relative paths, as git names them.
 */
export function matchDependedFiles(changed: string[], entries: string[]): string[] {
  const matched = new Set<string>();
  for (const file of changed) {
    for (const entry of entries) {
      if (entry !== "" && (file === entry || file.startsWith(`${entry}/`))) matched.add(file);
    }
  }
  return [...matched].sort();
}

export interface VerifySummary {
  gate: string | null;
  failed: string[];
  /** Names reporting "not run", in the order reported. */
  notRun: string[];
  /** Every check's result, in the order reported, for the pull-request body. */
  results: Array<{ name: string; result: string }>;
}

/** The per-check results from run verify run's output. */
export function parseVerifyResults(output: string): VerifySummary {
  const results: Array<{ name: string; result: string }> = [];
  for (const line of output.split("\n")) {
    const m = RESULT_RE.exec(line);
    if (m !== null) results.push({ name: m[2] as string, result: m[3] as string });
  }
  return {
    gate: results.find((r) => r.name === "gate")?.result ?? null,
    failed: results.filter((r) => r.result === "fail").map((r) => r.name),
    notRun: results.filter((r) => r.result === "not run").map((r) => r.name),
    results,
  };
}

/**
 * The not-run checks that refuse the landing: every project check but the
 * gate, which its own rule covers. Tool checks report not run when the
 * landing brief gives them no ticket, which is expected; an unknown kind
 * fails closed.
 */
export function unrunProject(notRun: string[], kinds: Record<string, string>): string[] {
  return notRun.filter((n) => n !== "gate" && kinds[n] !== "tool");
}

/** The merge authority the run recorded, defaulting to the user when absent. */
export function mergeAuthorityOf(runJsonText: string): "user" | "postmaster" {
  try {
    const data = JSON.parse(runJsonText) as Record<string, unknown>;
    const config = data["config"] as Record<string, unknown> | undefined;
    const ship = config?.["ship"] as Record<string, unknown> | undefined;
    return ship?.["merge_authority"] === "postmaster" ? "postmaster" : "user";
  } catch {
    return "user";
  }
}

/** Whether the record is a setup run, whose launch-card yes is the merge word. */
export function isSetupDispatch(runJsonText: string): boolean {
  try {
    const data = JSON.parse(runJsonText) as Record<string, unknown>;
    return data["kind"] === "setup-verifiers";
  } catch {
    return false;
  }
}

/** The landing route when none is named: pull-request with an origin remote. */
export function defaultLanding(hasOrigin: boolean): "local" | "pull-request" {
  return hasOrigin ? "pull-request" : "local";
}

/** Milliseconds to wait for the project's checks; capped past the timer's range. */
export function timeoutMs(seconds: number): number {
  return Math.min(seconds * 1000, 2147483647);
}

/** The last non-empty line, for a one-line verdict; the exit when there is none. */
export function lastLine(text: string, code: number): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  return lines.length === 0 ? `exit ${code}` : (lines[lines.length - 1] as string);
}

export interface CheapFacts {
  branch: string;
  classified: ClassifiedEntry[];
  /** Failed entries whose folder holds files on the branch. */
  failedPresent: ClassifiedEntry[];
  /** Proven entries with no files on the branch. */
  provenEmpty: ClassifiedEntry[];
  /** Diff paths outside the verifiers' folder. */
  outside: string[];
}

/**
 * The decision's cheap half, in fail-fast order: no proven verifier, a failed
 * folder still on the branch, a proven verifier with no files, paths outside
 * the folder. Null means the project's checks run next.
 */
export function decideCheap(facts: CheapFacts): string | null {
  const landed = facts.classified.filter((e) => e.proven);
  if (landed.length === 0) {
    const why =
      facts.classified.length === 0
        ? "the hand-over names none"
        : facts.classified.map((e) => `${e.name}: ${e.failReason}`).join("; ");
    return `no proven verifier (${why})`;
  }
  if (facts.failedPresent.length > 0) {
    const who = facts.failedPresent.map((e) => `${e.name} (${e.folder})`).join(", ");
    return `failed verifier still on the branch: ${who}`;
  }
  if (facts.provenEmpty.length > 0) {
    const who = facts.provenEmpty.map((e) => `${e.name} (${e.folder})`).join(", ");
    return `proven verifier has no files on the branch: ${who}`;
  }
  return outsideReason(facts.outside);
}

/** What the project's checks reported: their summary, a timeout, or no result. */
export type ChecksOutcome =
  | { kind: "ran"; summary: VerifySummary; unrunProject: string[] }
  | { kind: "timeout"; seconds: number }
  | { kind: "unrunnable"; error: string };

/** The decision's expensive half: the timeout, the failures, the unrun, then the gate. */
export function decideChecks(outcome: ChecksOutcome): string | null {
  if (outcome.kind === "timeout") {
    return `past its limit (the checks ran longer than ${outcome.seconds}s)`;
  }
  if (outcome.kind === "unrunnable") return outcome.error;
  if (outcome.summary.failed.length > 0) {
    return `checks failed (${outcome.summary.failed.map((n) => `${n}: fail`).join("; ")})`;
  }
  if (outcome.unrunProject.length > 0) {
    return `checks not run (${outcome.unrunProject.map((n) => `${n}: not run`).join("; ")})`;
  }
  if (outcome.summary.gate !== "pass") {
    return `gate did not pass (${outcome.summary.gate ?? "not reported"})`;
  }
  return null;
}

function landedText(landed: ClassifiedEntry[]): string {
  const word = landed.length === 1 ? "verifier" : "verifiers";
  const who = landed.map((e) => `${e.name} (${e.folder}, proof ${e.proof})`).join(", ");
  return `${landed.length} ${word}: ${who}`;
}

function leftOutText(leftOut: ClassifiedEntry[]): string {
  return leftOut.length === 0
    ? "none"
    : leftOut.map((e) => `${e.name} (${e.failReason})`).join(", ");
}

/** One line saying what lands and what stays out. */
export function acceptLine(branch: string, classified: ClassifiedEntry[]): string {
  const landed = classified.filter((e) => e.proven);
  const leftOut = classified.filter((e) => !e.proven);
  return `accept: ${branch} lands ${landedText(landed)}; left out: ${leftOutText(leftOut)}`;
}

/** One line saying a pass branch lands, with what its report corrected. */
export function acceptLineReport(branch: string, report: UpkeepReport): string {
  const who = report.verifiers.map((v) => `${v.name} (${v.folder})`).join(", ");
  const stale = report.claims.filter((c) => c.verdict === "stale").length;
  const corrected = correctedClaims(report.claims).length;
  const unchecked = report.claims.filter((c) => c.verdict === "unchecked").length;
  return (
    `accept: ${branch} lands upkeep corrections for ${who}; ` +
    `corrected: ${corrected} of ${stale} stale, unchecked: ${unchecked}`
  );
}

/** The stale claims a correcting pass mended: verdict stale with a non-empty Corrected: line. */
export function correctedClaims(claims: UpkeepClaim[]): UpkeepClaim[] {
  return claims.filter(
    (c) => c.verdict === "stale" && c.corrected !== undefined && c.corrected !== "",
  );
}

/** One line saying nothing lands, and why. */
export function refuseLine(branch: string, reason: string): string {
  return `refuse: ${branch} lands nothing: ${reason}`;
}

class UsageError extends Error {}
class RunError extends Error {}

export function isRepo(repo: string): boolean {
  return git(repo, ["rev-parse", "--git-dir"]).code === 0;
}

/** The path is the top of its repo, not a path below it. Symlinks resolved both sides. */
export function isRepoTop(repo: string): boolean {
  const top = repoTop(repo);
  if (top === null) return false;
  try {
    return realpathSync(repo) === realpathSync(top);
  } catch {
    return false;
  }
}

function branchTaken(repo: string, name: string): boolean {
  return git(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${name}`]).code === 0;
}

function readTemplate(): string {
  return readFileSync(join(scriptsDir(import.meta), "verifier-prompt.md"), "utf8");
}

/** The handover paragraph for one verifier: #325's proof-first shape, byte for byte. */
const SINGLE_HANDOVER_RULE =
  "Commit only verifiers with proof: a verifier whose drive left no proof file stays out\nof the branch — remove its folder rather than committing it. Then write HANDOVER.md at\nthe top of this working copy: what you proved and under which drive name, where the\nproof file sits as an absolute path (or why there is none), and what you left undone.\nGive each verifier its own `## Verifier: <name>` section carrying a `Folder:` line with\nthe verifier's folder relative to the top of the working copy and a `Proof:` line with\nthe proof file's absolute path alone, or `none` and the reason when there is no proof\nfile. Send the same text as your final message.";

/** The handover paragraph per verifier when one session makes several. */
const MULTI_HANDOVER_RULE =
  "Commit only verifiers with proof: a verifier whose drive left no proof file stays out\nof the branch — remove its folder rather than committing it. Prove this verifier as\nabove before going on to the next; write the single HANDOVER.md only after every\nverifier in this session is proven, covering each verifier: what you proved and under\nwhich drive name, where each proof file sits as an absolute path (or why there is none),\nand what you left undone. Give each verifier its own `## Verifier: <name>` section\ncarrying a `Folder:` line with the verifier's folder relative to the top of the working\ncopy and a `Proof:` line with the proof file's absolute path alone, or `none` and the\nreason when there is no proof file. Send the same text as your final message.";

function readMultiTemplate(): string {
  return readFileSync(join(scriptsDir(import.meta), "verifier-multi-prompt.md"), "utf8");
}

/** The session prompt: one body for one surface, a header plus one body per kind. */
function renderSessionPrompt(
  repo: string,
  surfaces: Surface[],
  base: string,
  proved: string,
  headless: boolean,
): string {
  const body = readTemplate();
  if (surfaces.length === 1) {
    const kind = surfaces[0] as Surface;
    return renderPrompt(body, {
      repo,
      surface: kind,
      surfaceProse: surfaceProse(kind),
      verifyDir: verifyDirName(repo),
      base,
      proved,
      handoverRule: SINGLE_HANDOVER_RULE,
      ...modeBlocks(headless),
    });
  }
  const bodies = surfaces.map((kind) => ({
    kind,
    text: renderPrompt(body, {
      repo,
      surface: kind,
      surfaceProse: surfaceProse(kind),
      verifyDir: `verifier/${kind}`,
      base,
      proved,
      handoverRule: MULTI_HANDOVER_RULE,
      ...modeBlocks(headless),
    }),
  }));
  return renderTemplate(readMultiTemplate(), {
    SURFACE_LIST: proseList(surfaces),
    COUNT: String(surfaces.length),
    DIR_LINES: dirLines(surfaces),
    UNLISTED_SENTENCE: unlistedSentence(surfaces),
    PER_SURFACE: joinBodies(bodies),
    BASE: base,
    PROVED: proved,
  });
}

/** The commit the base names: the sha a session proves against. */
function provedCommit(repo: string, base: string): string {
  const sha = git(repo, ["rev-parse", base]);
  if (sha.code !== 0 || sha.out.trim() === "") {
    throw new RunError(`the commit of ${base} could not be read`);
  }
  return sha.out.trim();
}

function runPrompt(req: ParsedPrompt): number {
  const repo = resolve(req.repo);
  if (!isRepo(repo)) throw new UsageError(`not a git repository: ${req.repo}`);
  if (!isRepoTop(repo)) throw new UsageError(`not the top of its repository: ${req.repo}`);
  const base = defaultBase(repo);
  if (base === null) throw new UsageError(`no commit to cut from in ${req.repo}`);
  process.stdout.write(
    renderSessionPrompt(repo, req.surfaces, base, provedCommit(repo, base), req.headless),
  );
  return 0;
}

function readUpkeepTemplate(): string {
  return readFileSync(join(scriptsDir(import.meta), "verifier-upkeep-prompt.md"), "utf8");
}

/** The pass instructions for the repo's verifiers at its current commit. */
function renderUpkeepPrompt(
  repo: string,
  folders: string[],
  base: string,
  pages: string[],
  headless: boolean,
): string {
  const modes = modeBlocks(headless, "UPKEEP.md");
  return renderTemplate(readUpkeepTemplate(), {
    REPO: repo,
    VERIFY_DIR: folders.map((f) => `${f}/`).join(" and "),
    BASE: base,
    FEATURE_LIST: pages.map((p) => `- ${p}`).join("\n"),
    ASK_RULE: modes.askRule,
    SECRETS_RULE: modes.secretsRule,
    UNASKED_RULE: headless ? UPKEEP_HEADLESS_UNASKED : "",
  });
}

function readUpkeepCorrectTemplate(): string {
  return readFileSync(join(scriptsDir(import.meta), "verifier-upkeep-correct-prompt.md"), "utf8");
}

/** The correcting instructions: correct, prove, confirm and commit. */
function renderUpkeepCorrectPrompt(
  repo: string,
  folders: string[],
  base: string,
  pages: string[],
  headless: boolean,
): string {
  const modes = modeBlocks(headless, "UPKEEP.md");
  return renderTemplate(readUpkeepCorrectTemplate(), {
    REPO: repo,
    VERIFY_DIR: folders.map((f) => `${f}/`).join(" and "),
    BASE: base,
    FEATURE_LIST: pages.map((p) => `- ${p}`).join("\n"),
    ASK_RULE: modes.askRule,
    SECRETS_RULE: modes.secretsRule,
    UNASKED_RULE: headless ? UPKEEP_HEADLESS_UNASKED : "",
  });
}

/** The folders and pages the pass drives, or the usage error when there are none. */
export function upkeepScope(
  repo: string,
  folder: string | null,
): { folders: string[]; pages: string[] } {
  const found = detectFolders(repo, folder);
  if (found.length === 0) throw new UsageError(`no verifiers in ${repo}`);
  const pages: string[] = [];
  for (const f of found) {
    const listed = featurePages(repo, f);
    if (listed === null) throw new RunError(`the verifiers under ${f} could not be read`);
    if (listed.length === 0) throw new UsageError(`no verifiers under ${f} in ${repo}`);
    pages.push(...listed);
  }
  return { folders: found, pages: [...new Set(pages)].sort() };
}

/** The current commit the pass drives: HEAD, which the scope proved present. */
function currentHead(repo: string): string {
  const head = git(repo, ["rev-parse", "HEAD"]);
  if (head.code !== 0) throw new RunError(`the current commit of ${repo} could not be read`);
  return head.out.trim();
}

function runUpkeepPrompt(req: ParsedUpkeepPrompt): number {
  const repo = resolve(req.repo);
  if (!isRepo(repo)) throw new UsageError(`not a git repository: ${req.repo}`);
  if (!isRepoTop(repo)) throw new UsageError(`not the top of its repository: ${req.repo}`);
  const scope = upkeepScope(repo, req.folder);
  const head = currentHead(repo);
  const render = req.correct === true ? renderUpkeepCorrectPrompt : renderUpkeepPrompt;
  process.stdout.write(render(repo, scope.folders, head, scope.pages, req.headless));
  return 0;
}

function runListCmd(req: ParsedList): number {
  const repo = resolve(req.repo);
  if (!isRepo(repo)) throw new UsageError(`not a git repository: ${req.repo}`);
  if (!isRepoTop(repo)) throw new UsageError(`not the top of its repository: ${req.repo}`);
  console.log(renderListing(listVerifiers(repo)));
  return 0;
}

/**
 * Why the verifier reads as possibly stale, or null when it does not: the
 * changed depended files, comma-separated, or the unconfirmed cause. The index
 * is read from the working tree; the comparison is history, the confirmed
 * commit against `at`. An entry that lacks its Files list or its Confirmed
 * commit, or that names a commit the repo does not hold, counts as marked,
 * since nothing shows it was confirmed.
 */
function staleDetail(repo: string, vdir: string, shared: boolean, at: string): string | null {
  const indexFile = indexFileFor(vdir, shared);
  const text = readmeText(join(repo, indexFile));
  let scope: string | null = null;
  let sha: string | null = null;
  if (indexFile === "verifier/README.md") {
    const spans = indexBullets(text).filter((span) => spanNamesDir(span, vdir));
    if (spans.length === 0) return "unconfirmed (not in the shared index)";
    if (spans.length > 1) return "unconfirmed (ambiguous shared index entry)";
    scope = (spans[0] ?? []).join("\n");
    sha = confirmedSha(scope);
  } else {
    // ASCII: indentation before the label is plain spaces
    scope = text.split("\n").find((l) => /^\s*Files:/u.test(l)) ?? null;
    sha = featuresConfirm(text);
  }
  const files = scope === null ? null : parseFilesList(scope);
  if (files === null || files.length === 0) return "unconfirmed (no Files: list)";
  if (sha === null) return "unconfirmed (no Confirmed: commit)";
  if (git(repo, ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`]).code !== 0)
    return `unconfirmed (unknown commit ${sha})`;
  // Rename detection would report only the destination, hiding the listed
  // source path the verifier depends on; -z lists every name as written,
  // NUL-separated and never quoted.
  const diff = git(repo, ["diff", "--name-only", "--no-renames", "-z", sha, at]);
  if (diff.code !== 0) throw new RunError(`the commits ${sha} and ${at} could not be compared`);
  const changed = diff.out.split("\0").filter((l) => l !== "");
  const matched = matchDependedFiles(changed, files);
  return matched.length === 0 ? null : matched.join(", ");
}

function runStaleCmd(req: ParsedStale): number {
  const repo = resolve(req.repo);
  if (!isRepo(repo)) throw new UsageError(`not a git repository: ${req.repo}`);
  if (!isRepoTop(repo)) throw new UsageError(`not the top of its repository: ${req.repo}`);
  // An explicit comparison commit is always validated, even where the repo
  // holds no verifier to compare.
  if (req.at !== null) {
    const resolved = git(repo, ["rev-parse", "--verify", "--quiet", `${req.at}^{commit}`]);
    if (resolved.code !== 0 || resolved.out.trim() === "") {
      throw new UsageError(`unknown commit: ${req.at}`);
    }
  }
  const listing = listVerifiers(repo);
  if (listing.verifiers.length === 0) {
    console.log("stale: none");
    return 0;
  }
  let at = req.at;
  if (at === null) {
    const head = git(repo, ["rev-parse", "HEAD"]);
    if (head.code !== 0 || head.out.trim() === "") {
      throw new UsageError(`stale needs a commit to compare against: ${req.repo} holds no commit`);
    }
    at = head.out.trim();
  }
  const shared = isFilePath(join(repo, "verifier", "README.md"));
  const marks: string[] = [];
  for (const v of listing.verifiers) {
    const detail = staleDetail(repo, v.folder, shared, at);
    if (detail !== null) marks.push(`stale: ${v.folder}: ${detail}`);
  }
  if (marks.length === 0) {
    console.log("stale: none");
    return 0;
  }
  for (const mark of marks) console.log(mark);
  return 0;
}

function fileText(path: string): string {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

interface Attempt {
  role: string;
  stream: string;
  thread: string;
  walled: boolean;
  wallDetail: string;
  failed: string;
}

/** A launch that started its process and then failed: its attempt is logged. */
class LaunchedError extends RunError {
  attempt: Attempt;
  constructor(message: string, attempt: Attempt) {
    super(message);
    this.attempt = attempt;
  }
}

interface LaunchOpts {
  role: string;
  leg: string;
  wt: string;
  name: string;
  logs: string;
  branch: string;
  surface: string;
  promptFile: string;
  dispatch: string;
  timeout: number;
}

function threadOf(stream: string): string {
  const id = run(RUN, ["launch", "thread-id", stream]);
  return id.code === 0 ? id.out.trim() : "none";
}

function streamText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function readRunConfig(dispatch: string): unknown {
  try {
    const data = JSON.parse(readFileSync(join(dispatch, "run.json"), "utf8")) as Record<
      string,
      unknown
    >;
    return data["config"] ?? null;
  } catch {
    return null;
  }
}

/** Seconds in one chunk of a marker wait without a limit. wait-for-markers takes no infinite timeout. */
export const UNLIMITED_WAIT_CHUNK_SECONDS = 86400;

/**
 * The wait-for-markers call that settles a session wait: one call with a
 * timeout, or day-long calls until the marker lands when timeoutSec is 0. Only
 * a landed marker or a failed wait ends an unlimited wait; a timed-out chunk
 * waits on. The call is injected for tests.
 */
export function waitForMarker(
  timeoutSec: number,
  waitOnce: (seconds: number) => Pick<RunResult, "code" | "out" | "err">,
): Pick<RunResult, "code" | "out" | "err"> {
  for (;;) {
    const waited = waitOnce(timeoutSec === 0 ? UNLIMITED_WAIT_CHUNK_SECONDS : timeoutSec);
    if (waited.code === 0 || timeoutSec !== 0 || waited.code !== 3) return waited;
  }
}

function launchAndWait(o: LaunchOpts, sessionStarted: { started: boolean }): Attempt {
  const base = join(o.logs, `verifier-${o.branch}-${o.role}`);
  const stream = `${base}-events.jsonl`;
  const errFile = `${base}.err`;
  const marker = `${base}.done`;
  const pidFile = `${base}.pid`;
  const failed = (message: string): LaunchedError =>
    new LaunchedError(message, {
      role: o.role,
      stream,
      thread: threadOf(stream),
      walled: false,
      wallDetail: "",
      failed: message,
    });
  const started = run(RUN, [
    "host",
    "run",
    o.name,
    o.wt,
    "--under",
    o.dispatch,
    "--role",
    "coachman",
    "--run",
    o.dispatch,
    "--out",
    stream,
    "--err",
    errFile,
    "--marker",
    marker,
    "--pidfile",
    pidFile,
    "--",
    RUN,
    "launch",
    "launch",
    o.role,
    o.wt,
    o.promptFile,
    "--leg",
    o.leg,
    "--run",
    o.dispatch,
  ]);
  if (started.code !== 0) {
    throw new RunError(
      `the host would not start the ${o.role} session: ${fileText(errFile) || started.err.trim() || `exit ${started.code}`}`,
    );
  }
  sessionStarted.started = true;
  const waited = waitForMarker(o.timeout, (seconds) =>
    run(RUN, ["wait-for-markers", o.logs, basename(marker), "1", String(seconds)]),
  );
  if (waited.code !== 0) {
    // Stopping an already-exited session is a no-op, so every wait failure
    // stops first; the stop result is checked before anything claims it.
    const stop = run(RUN, ["host", "stop", o.wt]);
    const stopFailed =
      stop.code === 0
        ? ""
        : `the stop failed: ${stop.err.trim() || stop.out.trim() || `exit ${stop.code}`}`;
    if (waited.code === 3) {
      throw failed(
        stop.code === 0
          ? `the ${o.role} session was still running after ${o.timeout} seconds; stopped`
          : `the ${o.role} session was still running after ${o.timeout} seconds; ${stopFailed}`,
      );
    }
    throw failed(
      `waiting for the ${o.role} session failed: ${waited.err.trim() || waited.out.trim()}${stopFailed === "" ? "" : `; ${stopFailed}`}`,
    );
  }
  const harness = roleHarness(readRunConfig(o.dispatch), o.role, o.leg);
  if (harness === null) {
    throw failed(`the run names no harness for ${o.role}`);
  }
  const wallDetail = wallInStream(streamText(stream), harness);
  return {
    role: o.role,
    stream,
    thread: threadOf(stream),
    walled: wallDetail !== null,
    wallDetail: wallDetail ?? "",
    failed: "",
  };
}

function logLaunch(dispatch: string, surface: string, branch: string, a: Attempt): void {
  const outcome = a.failed !== "" ? ` failed: ${a.failed}` : a.walled ? " walled" : "";
  const detail = `thread ${a.thread} role ${a.role} branch ${branch}${outcome}`;
  const r = run(RUN, [
    "log-action",
    dispatch,
    "coachman",
    "dispatch",
    `verifier-${surface}`,
    detail,
  ]);
  if (r.code !== 0)
    throw new RunError(`the launch was not logged: ${r.err.trim() || r.out.trim()}`);
}

/** One launch and its one dispatch line, on success and on every failure past the start. */
function attempt(o: LaunchOpts, sessionStarted: { started: boolean }): Attempt {
  try {
    const a = launchAndWait(o, sessionStarted);
    logLaunch(o.dispatch, o.surface, o.branch, a);
    return a;
  } catch (e) {
    if (e instanceof LaunchedError) logLaunch(o.dispatch, o.surface, o.branch, e.attempt);
    throw e;
  }
}

/**
 * Best-effort removal of a failed make's worktree and branch: "" when clean,
 * otherwise the failure to append to the error that caused the cleanup.
 */
export function removeProvisioning(repo: string, wt: string, branch: string): string {
  const problems: string[] = [];
  const rm = git(repo, ["worktree", "remove", "--force", wt]);
  if (rm.code !== 0) problems.push(rm.err.trim() || rm.out.trim() || `exit ${rm.code}`);
  const del = git(repo, ["branch", "-D", branch]);
  if (del.code !== 0) problems.push(del.err.trim() || del.out.trim() || `exit ${del.code}`);
  return problems.length === 0 ? "" : `; the cleanup failed too: ${problems.join("; ")}`;
}

/** What a make failure past the cut does with the branch and worktree. */
export interface FailureOutcome {
  cleanup: boolean;
  suffix: string;
}

/**
 * A failure before any session started cleans up pure scaffolding; once a
 * session ran, its work may hold the diagnosis, so the worktree and branch
 * stay, named in the error for the operator.
 */
export function failureOutcome(
  sessionStarted: boolean,
  wt: string,
  branch: string,
): FailureOutcome {
  if (sessionStarted) {
    return {
      cleanup: false,
      suffix: `; the worktree ${wt} and branch ${branch} were left behind`,
    };
  }
  return { cleanup: true, suffix: "" };
}

function runMake(req: ParsedMake): number {
  const repo = resolve(req.repo);
  if (!isRepo(repo)) throw new UsageError(`not a git repository: ${req.repo}`);
  if (!isRepoTop(repo)) throw new UsageError(`not the top of its repository: ${req.repo}`);
  const dispatch = resolve(req.dispatch);
  if (!existsSync(join(dispatch, "run.json"))) {
    throw new UsageError(`no run at the dispatch: ${req.dispatch}`);
  }
  const base = defaultBase(repo);
  if (base === null) throw new UsageError(`no commit to cut from in ${req.repo}`);
  const proved = provedCommit(repo, base);
  pruneWorktrees(repo);
  const label = req.surfaces.join("-");
  const branch = pickBranch((name) => branchTaken(repo, name), label);
  const wt = pickWorktree(repo, label, existsSync);
  const vdir = sessionFolder(repo, req.surfaces);
  const added = git(repo, ["worktree", "add", wt, "-b", branch, base]);
  if (added.code !== 0) {
    throw new RunError(`the worktree would not cut: ${added.err.trim() || added.out.trim()}`);
  }
  const sessionStarted = { started: false };
  const cutAt = Date.now();
  try {
    return runMakeLaunches(
      req,
      repo,
      dispatch,
      base,
      proved,
      branch,
      wt,
      vdir,
      sessionStarted,
      cutAt,
    );
  } catch (e) {
    const outcome = failureOutcome(sessionStarted.started, wt, branch);
    const extra = outcome.cleanup ? removeProvisioning(repo, wt, branch) : outcome.suffix;
    if (e instanceof RunError && extra !== "") throw new RunError(`${e.message}${extra}`);
    throw e;
  }
}

/** The report the session wrote, or the failure when it wrote none fresh. */
function validateUpkeepFresh(wt: string, cutAt: number): string {
  const report = join(wt, "UPKEEP.md");
  const written = handoverMtimeMs(report);
  if (written === null) {
    throw new RunError(`the session ended with no UPKEEP.md in ${wt}`);
  }
  if (!handoverFresh(written, cutAt)) {
    throw new RunError(`the UPKEEP.md in ${wt} predates this session`);
  }
  return readFileSync(report, "utf8");
}

/** The verdict over a finished report; a malformed report fails the pass. */
function decideUpkeep(
  pages: string[],
  folders: string[],
  text: string,
): { verdict: UpkeepVerdict; mended: UpkeepClaim[] } {
  const parsed = parseUpkeepReport(text);
  if (!parsed.ok) throw new RunError(parsed.error);
  const decided = verdictUpkeep(pages, folders, parsed.report);
  if (!decided.ok) throw new RunError(decided.error);
  return { verdict: decided.verdict, mended: correctedClaims(parsed.report.claims) };
}

/**
 * The mended claims whose page the branch never touched: a correction with no
 * change behind it is hollow, however the report describes it.
 */
export function untouchedCorrected(diff: string[], mended: UpkeepClaim[]): UpkeepClaim[] {
  const bare = (p: string): string => (p.startsWith("./") ? p.slice("./".length) : p);
  const touched = new Set(diff.map(bare));
  return mended.filter((c) => !touched.has(bare(c.page)));
}

/**
 * The worktree paths a `git status --porcelain -z` output names outside the
 * allowed list: every other entry is a change the branch does not carry.
 * Rename entries name both sides; either side outside the list strays.
 */
export function strayUncommitted(out: string, allowed: string[]): string[] {
  const keep = new Set(allowed);
  const strays: string[] = [];
  for (const part of out.split("\0")) {
    if (part === "") continue;
    const path = part.length > 3 && part[2] === " " ? part.slice(3) : part;
    if (!keep.has(path)) strays.push(path);
  }
  return strays;
}

/**
 * The correcting pass's branch: its diff past the driven commit touches only
 * the verifiers' folders, every mended claim's page is among the touched
 * files, and every verifier the pass drove is confirmed on the branch at the
 * driven commit, with corrections or without. A verifier dir the branch no
 * longer holds is left to the user's review of the diff.
 */
function validateCorrectingBranch(
  repo: string,
  head: string,
  branch: string,
  folders: string[],
  mended: UpkeepClaim[],
): void {
  const diff = branchDiffPaths(repo, head, branch);
  if (diff === null) {
    throw new RunError(`the pass branch ${branch} could not be compared with ${head}`);
  }
  const outside = outsideFolders(diff, folders);
  const reason = outsideReason(outside);
  if (reason !== null) {
    throw new RunError(`the pass changed files ${reason} on ${branch}`);
  }
  const untouched = untouchedCorrected(diff, mended);
  if (untouched.length > 0) {
    const first = untouched[0] as UpkeepClaim;
    throw new RunError(
      `the branch leaves ${first.page} unchanged for its corrected claim ${first.name}`,
    );
  }
  const shared = branchHasPath(repo, branch, "verifier/README.md");
  for (const folder of folders) {
    const vdirs = scopeVdirs(repo, folder, head);
    if (vdirs === null) throw new RunError(`the verifiers under ${folder} could not be read`);
    for (const vdir of vdirs) {
      if (!branchHasPath(repo, branch, `${vdir}/README.md`)) continue;
      const indexFile = indexFileFor(vdir, shared);
      const text = branchFileText(repo, branch, indexFile);
      const sha =
        text === null
          ? null
          : indexFile === "verifier/README.md"
            ? bulletConfirm(text, vdir)
            : featuresConfirm(text);
      if (sha === null) {
        throw new RunError(
          `the index for ${vdir} names no confirmed commit (expected Confirmed: ${head} in ${indexFile})`,
        );
      }
      // ASCII: the driven head is a hex sha
      if (sha !== head.toLowerCase()) {
        throw new RunError(
          `the index for ${vdir} records ${sha}, not the driven commit ${head} (in ${indexFile})`,
        );
      }
    }
  }
}

function runUpkeep(req: ParsedUpkeep): number {
  const repo = resolve(req.repo);
  if (!isRepo(repo)) throw new UsageError(`not a git repository: ${req.repo}`);
  if (!isRepoTop(repo)) throw new UsageError(`not the top of its repository: ${req.repo}`);
  const dispatch = resolve(req.dispatch);
  if (!existsSync(join(dispatch, "run.json"))) {
    throw new UsageError(`no run at the dispatch: ${req.dispatch}`);
  }
  const scope = upkeepScope(repo, req.folder);
  // The pass drives the current commit, not the default base: the claims must
  // hold where the project stands, whatever its branches have done since.
  const head = currentHead(repo);
  pruneWorktrees(repo);
  const branch = pickUpkeepBranch((name) => branchTaken(repo, name));
  const wt = pickUpkeepWorktree(repo, existsSync);
  const added = git(repo, ["worktree", "add", wt, "-b", branch, head]);
  if (added.code !== 0) {
    throw new RunError(`the worktree would not cut: ${added.err.trim() || added.out.trim()}`);
  }
  const sessionStarted = { started: false };
  const cutAt = Date.now();
  try {
    return runUpkeepLaunches(req, repo, dispatch, head, branch, wt, scope, sessionStarted, cutAt);
  } catch (e) {
    const outcome = failureOutcome(sessionStarted.started, wt, branch);
    const extra = outcome.cleanup ? removeProvisioning(repo, wt, branch) : outcome.suffix;
    if (e instanceof RunError && extra !== "") throw new RunError(`${e.message}${extra}`);
    throw e;
  }
}

/** Upkeep's briefing: the pass instructions, the report wait, the verdict summary. */
function runUpkeepLaunches(
  req: ParsedUpkeep,
  repo: string,
  dispatch: string,
  head: string,
  branch: string,
  wt: string,
  scope: { folders: string[]; pages: string[] },
  sessionStarted: { started: boolean },
  cutAt: number,
): number {
  // Decided by validate on either path, printed after it: the interactive path
  // logs a malformed report as the session's failure before it throws.
  let decided: UpkeepVerdict | null = null;
  let corrected = 0;
  const correcting = req.correct === true;
  const render = correcting ? renderUpkeepCorrectPrompt : renderUpkeepPrompt;
  return runSessionLaunches({
    repo,
    dispatch,
    branch,
    wt,
    timeout: req.timeout,
    cutAt,
    sessionStarted,
    logLabel: "upkeep",
    sessionNoun: "upkeep",
    renderPrompt: (headless) => render(repo, scope.folders, head, scope.pages, headless),
    sendFileText: (promptFile) =>
      correcting ? upkeepCorrectSendText(promptFile) : upkeepSendText(promptFile),
    waitFile: "UPKEEP.md",
    validate: () => {
      const judged = decideUpkeep(scope.pages, scope.folders, validateUpkeepFresh(wt, cutAt));
      decided = judged.verdict;
      corrected = judged.mended.length;
      if (correcting) {
        validateCorrectingBranch(repo, head, branch, scope.folders, judged.mended);
        const status = git(wt, ["status", "--porcelain", "-z"]);
        if (status.code !== 0) throw new RunError("the pass worktree could not be read");
        const strays = strayUncommitted(status.out, ["UPKEEP.md"]);
        if (strays.length > 0) {
          const shown = strays.slice(0, 10).join(", ");
          const more = strays.length > 10 ? ` and ${strays.length - 10} more` : "";
          throw new RunError(
            `the pass leaves uncommitted changes besides UPKEEP.md on ${branch}: ${shown}${more}`,
          );
        }
      }
    },
    print: ({ final, handle, promptFile }) => {
      const verdict = decided as UpkeepVerdict;
      const lines = [`branch ${branch}`, `base ${head}`, `worktree ${wt}`];
      if (final === null) {
        lines.push("role coachman", `handle ${handle}`);
      } else {
        lines.push(`role ${final.role}`, `thread ${final.thread}`);
      }
      lines.push(`prompt ${promptFile}`);
      if (final !== null) lines.push(`stream ${final.stream}`);
      lines.push(`report ${join(wt, "UPKEEP.md")}`);
      if (!correcting) {
        for (const line of [...lines, ...verdict.lines]) console.log(line);
        for (const line of verdict.lines) logVerdict(dispatch, branch, "note", line);
        return verdict.stale + verdict.unchecked > 0 ? 1 : 0;
      }
      const tally = `corrections: ${corrected} of ${verdict.stale} stale corrected`;
      const holds = verdict.unchecked === 0 && verdict.stale - corrected === 0;
      const extra = holds ? [tally, "every claim holds"] : [tally];
      for (const line of [...lines, ...verdict.lines, ...extra]) console.log(line);
      for (const line of [...verdict.lines, ...extra]) {
        logVerdict(dispatch, branch, "note", line);
      }
      return holds ? 0 : 1;
    },
  });
}

/** Seconds one send waits for the session's turn, and how many sends before make gives up. */
export const SEND_WAIT_SECONDS = 60;
export const SEND_ATTEMPTS = 3;

/** What a `host send --wait` result means for delivery. */
export type SendVerdict = "sent" | "retry" | "failed";

/**
 * Read a `host send --wait` result. Exit 0 settled, and exit 3 short of
 * settling still received the instructions, so both proceed; exit 3 with no
 * turn started means the prompt was dropped and the send goes again; a
 * session that took the prompt and then stopped at an approval or a question
 * keeps its instructions while the user answers in the watched tab, so it
 * proceeds too. A block met before the prompt was accepted never received
 * it. Anything else failed.
 */
export function sendVerdict(code: number, output: string): SendVerdict {
  if (code === 0) return "sent";
  if (code === 3 && output.includes("did not settle")) return "sent";
  if (code === 3 && output.includes("no turn start")) return "retry";
  if (code === 3 && output.includes("stopped at an approval or a question")) return "sent";
  return "failed";
}

/**
 * Send the instructions with receipt confirmation: `host send --wait` reports
 * a dropped prompt as no turn started, and the send goes again, bounded, with
 * a read first (hosts.md). A handle the read cannot reach never registered,
 * so retrying is futile and the failure says so. The runner is injected for
 * tests. Tmux panes exec the harness directly, so the paste waits in the pty
 * buffer until the harness reads it; no readiness check is needed there.
 */
export function deliverInstructions(
  runFn: (args: string[]) => { code: number; out: string; err: string },
  handle: string,
  sendFile: string,
): { delivered: boolean; attempts: number; lastError: string } {
  let lastError = "";
  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt++) {
    const sent = runFn(["host", "send", handle, sendFile, "--wait", String(SEND_WAIT_SECONDS)]);
    const text = `${sent.out}\n${sent.err}`;
    const verdict = sendVerdict(sent.code, text);
    if (verdict === "sent") return { delivered: true, attempts: attempt, lastError: "" };
    lastError = text.trim() || `exit ${sent.code}`;
    if (verdict === "failed") return { delivered: false, attempts: attempt, lastError };
    if (attempt === SEND_ATTEMPTS) return { delivered: false, attempts: attempt, lastError };
    const read = runFn(["host", "read", handle, "20"]);
    if (read.code !== 0) {
      return {
        delivered: false,
        attempts: attempt,
        lastError: `the session never registered under ${handle}: ${(read.out + read.err).trim() || `exit ${read.code}`}`,
      };
    }
  }
  return { delivered: false, attempts: SEND_ATTEMPTS, lastError };
}

/** What the session added: every multi verifier complete, nothing unlisted or outside. */
export function checkMultiVerifiers(
  repo: string,
  branch: string,
  base: string,
  surfaces: Surface[],
): void {
  // Added past the base, never the branch tree: content the base already
  // carries is not this session's work, and must neither satisfy nor fail it.
  const added = addedPaths(repo, base, branch);
  if (added === null) {
    throw new RunError(`the session's branch ${branch} cannot be compared with its base`);
  }
  const has = (path: string): boolean => added.includes(path);
  if (!has("verifier/README.md")) {
    throw new RunError(`the session added no verifier/README.md on ${branch}`);
  }
  const index = branchFileText(repo, branch, "verifier/README.md") ?? "";
  for (const kind of surfaces) {
    if (!has(`verifier/${kind}/README.md`)) {
      throw new RunError(`the session added no verifier/${kind}/README.md on ${branch}`);
    }
    if (!has(`verifier/${kind}/features/README.md`)) {
      throw new RunError(`the session added no verifier/${kind}/features/README.md on ${branch}`);
    }
    const pages = addedFeaturePages(added, `verifier/${kind}`);
    if (pages.length < 3) {
      throw new RunError(`the session added fewer than 3 feature pages for ${kind} on ${branch}`);
    }
    const main = branchFileText(repo, branch, `verifier/${kind}/README.md`) ?? "";
    if (!hasUpkeepLine(main)) {
      throw new RunError(`the verifier/${kind}/README.md on ${branch} carries no upkeep line`);
    }
    if (!indexNames(index, kind)) {
      throw new RunError(
        `the verifier/README.md on ${branch} names no ${surfaceProse(kind)} (${kind}) verifier`,
      );
    }
  }
  const stray = strayVerifierPaths(added, surfaces);
  if (stray.length > 0) {
    const names = [...new Set(stray.map((p) => p.slice("verifier/".length).split("/")[0]))].sort();
    throw new RunError(`the session made a verifier for unlisted ${names.join(", ")} on ${branch}`);
  }
  const outside = outsideAdded(added);
  if (outside.length > 0) {
    throw new RunError(
      `the session left verifier files outside verifier/ on ${branch}: ${outside.join(", ")}`,
    );
  }
}

/** The headless launches, as #323 ran them: the coachman role, then its fallback on a wall. */
function runRoles(
  o: {
    wt: string;
    name: string;
    logs: string;
    branch: string;
    surface: string;
    promptFile: string;
    dispatch: string;
    timeout: number;
  },
  sessionStarted: { started: boolean },
): Attempt {
  const first = attempt({ role: "coachman", leg: "synthesis", ...o }, sessionStarted);
  if (!first.walled) return first;
  const second = attempt({ role: "coachman_fallback", leg: "synthesis", ...o }, sessionStarted);
  if (second.walled) {
    throw new RunError(
      `both roles walled: coachman: ${first.wallDetail}; coachman_fallback: ${second.wallDetail}`,
    );
  }
  return second;
}

/** What a summary step gets: the headless attempt, or the interactive handle. */
interface PrintCtx {
  final: Attempt | null;
  handle: string;
  promptFile: string;
}

/**
 * One session's briefing: what differs between making verifiers and passing
 * over them. The launch machinery below is one mechanism for both.
 */
interface SessionOpts {
  repo: string;
  dispatch: string;
  branch: string;
  wt: string;
  timeout: number;
  cutAt: number;
  sessionStarted: { started: boolean };
  /** The log target's suffix: verifier-<logLabel>, and the host role name. */
  logLabel: string;
  /** The noun the messages name: the verifier session, the upkeep session. */
  sessionNoun: string;
  renderPrompt: (headless: boolean) => string;
  sendFileText: (promptFile: string) => string;
  /** The worktree file whose arrival ends the wait: HANDOVER.md, UPKEEP.md. */
  waitFile: string;
  /** The session's deliverables, on either path; throws when they are missing. */
  validate: () => void;
  /** The summary lines; returns the command's exit code. */
  print: (ctx: PrintCtx) => number;
}

/** Everything past the cut: a thrower here cleans up only before any session starts. */
function runSessionLaunches(o: SessionOpts): number {
  const logs = join(o.dispatch, "logs");
  mkdirSync(logs, { recursive: true });
  const promptFile = join(logs, `verifier-${o.branch}-prompt.txt`);
  writeFileSync(promptFile, o.renderPrompt(false));
  const named = run(RUN, ["host", "name", o.dispatch, "role", `verifier-${o.logLabel}`]);
  if (named.code !== 0) {
    throw new RunError(`the launch could not be named: ${named.err.trim() || named.out.trim()}`);
  }
  const name = named.out.trim();
  const form = formOrNull(o.wt, name);
  const handle = verifierHandle(o.repo, o.branch);
  const spawned =
    form === null
      ? null
      : run(RUN, [
          "host",
          "spawn",
          handle,
          o.wt,
          "--label",
          name,
          "--",
          ...spawnCommand(o.wt, form),
        ]);
  if (spawned === null || spawned.code === 3) {
    // No session host keeps an interactive session: run headless, as #323 did,
    // with the no-host instructions, which report what could not be asked. The
    // prompt file holds what the session read either way.
    writeFileSync(promptFile, o.renderPrompt(true));
    return runSessionHeadless(o, name, logs, promptFile);
  }
  if (spawned.code !== 0) {
    throw new RunError(
      `the ${o.sessionNoun} session could not start: ${(spawned.out + spawned.err).trim() || `exit ${spawned.code}`}`,
    );
  }
  if (!spawned.out.includes("handle=")) {
    throw new RunError(
      `the ${o.sessionNoun} session started but the host did not confirm its handle (${spawned.out.trim()})`,
    );
  }
  o.sessionStarted.started = true;
  const sendFile = join(logs, `verifier-${o.branch}-send.txt`);
  writeFileSync(sendFile, o.sendFileText(promptFile));
  const delivery = deliverInstructions((args) => run(RUN, args), handle, sendFile);
  if (!delivery.delivered) {
    const tries =
      delivery.attempts === 1
        ? "could not be sent"
        : `could not be sent after ${delivery.attempts} tries`;
    const failed = `the instructions ${tries}: ${delivery.lastError}; the session was left open in ${handle}`;
    logInteractive(o.dispatch, o.logLabel, o.branch, handle, failed);
    throw new RunError(`${failed}; read the session and resend if it is idle`);
  }
  logInteractive(o.dispatch, o.logLabel, o.branch, handle, "");
  if (!waitForFile(o.wt, o.waitFile, o.cutAt, o.timeout)) {
    const failed = `the ${o.sessionNoun} session is still running after ${o.timeout} seconds; it was left open in ${handle}`;
    logInteractive(o.dispatch, o.logLabel, o.branch, handle, failed);
    throw new RunError(failed);
  }
  try {
    o.validate();
  } catch (e) {
    logInteractive(
      o.dispatch,
      o.logLabel,
      o.branch,
      handle,
      e instanceof Error ? e.message : String(e),
    );
    throw e;
  }
  return o.print({ final: null, handle, promptFile });
}

/** The no-host session: the headless launches, then the deliverables and the summary. */
function runSessionHeadless(
  o: SessionOpts,
  name: string,
  logs: string,
  promptFile: string,
): number {
  const final = runRoles(
    {
      wt: o.wt,
      name,
      logs,
      branch: o.branch,
      surface: o.logLabel,
      promptFile,
      dispatch: o.dispatch,
      timeout: o.timeout,
    },
    o.sessionStarted,
  );
  o.validate();
  return o.print({ final, handle: "", promptFile });
}

/** Make's briefing: the making instructions, the handover wait, the handover summary. */
function runMakeLaunches(
  req: ParsedMake,
  repo: string,
  dispatch: string,
  base: string,
  proved: string,
  branch: string,
  wt: string,
  vdir: string,
  sessionStarted: { started: boolean },
  cutAt: number,
): number {
  return runSessionLaunches({
    repo,
    dispatch,
    branch,
    wt,
    timeout: req.timeout,
    cutAt,
    sessionStarted,
    logLabel: req.surfaces.join("-"),
    sessionNoun: "verifier",
    renderPrompt: (headless) => renderSessionPrompt(repo, req.surfaces, base, proved, headless),
    sendFileText: (promptFile) => sendText(promptFile),
    waitFile: "HANDOVER.md",
    validate: () => validateSession(wt, base, branch, vdir, cutAt, req.surfaces),
    print: ({ final, handle, promptFile }) => {
      const lines = [`branch ${branch}`, `base ${base}`, `worktree ${wt}`];
      if (final === null) {
        lines.push("role coachman", `handle ${handle}`);
      } else {
        lines.push(`role ${final.role}`, `thread ${final.thread}`);
      }
      lines.push(`prompt ${promptFile}`);
      if (final !== null) lines.push(`stream ${final.stream}`);
      lines.push(`handover ${join(wt, "HANDOVER.md")}`);
      for (const line of lines) console.log(line);
      return 0;
    },
  });
}

/**
 * The coachman role's interactive form, split for spawn. The form comes from the
 * live global config, as the clerk's does: run launch interactive takes no --run.
 * The leg is synthesis, as on the headless path, so a per-leg coachman agrees.
 */
function interactiveForm(wt: string, name: string): string[] {
  const printed = run(RUN, [
    "launch",
    "interactive",
    "coachman",
    "--project",
    wt,
    "--name",
    name,
    "--leg",
    "synthesis",
  ]);
  const form = printed.code === 0 ? splitCommand(printed.out) : [];
  if (form.length === 0) {
    throw new RunError(
      `run launch printed no interactive command for the coachman${printed.code === 0 ? "" : `: ${(printed.out + printed.err).trim() || `exit ${printed.code}`}`}`,
    );
  }
  return form;
}

/** Single-quote a word for sh, the twin of host.ts's quote, which stays there. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

/**
 * The argv spawn runs: the form wrapped so it starts in the worktree even when
 * the pane opens elsewhere. host spawn may place a linked worktree's pane at
 * the repo root instead (tool-fault, run 344), so the wrapper cds explicitly,
 * as host run's own pane line does, and execs the form, so the pane lists the
 * session itself, with the harness as the pane's own process as before.
 */
export function spawnCommand(wt: string, form: string[]): string[] {
  return ["bash", "-c", `cd -- ${shellQuote(wt)} && exec "$@"`, "_", ...form];
}

/**
 * The interactive form, or null when it would not print and no host could take
 * it: the form is only needed for the spawn, so with no host a broken coachman
 * entry still runs headless on the run's recorded config.
 */
function formOrNull(wt: string, name: string): string[] | null {
  try {
    return interactiveForm(wt, name);
  } catch (e) {
    if (!(e instanceof RunError)) throw e;
    const detected = run(RUN, ["host", "detect"]);
    if (detected.code === 0 && detected.out.trim() === "none") return null;
    throw e;
  }
}

/** One dispatch line for the interactive session, on success and past the spawn. */
function logInteractive(
  dispatch: string,
  surface: string,
  branch: string,
  handle: string,
  failed: string,
): void {
  const detail =
    `interactive handle ${handle} branch ${branch}` + (failed === "" ? "" : ` failed: ${failed}`);
  const r = run(RUN, [
    "log-action",
    dispatch,
    "coachman",
    "dispatch",
    `verifier-${surface}`,
    detail,
  ]);
  if (r.code !== 0)
    throw new RunError(`the launch was not logged: ${r.err.trim() || r.out.trim()}`);
}

/**
 * The session's deliverables, on either path: a fresh handover, commits past the
 * base, the verifier's front page and at least three feature pages.
 */
function validateSession(
  wt: string,
  base: string,
  branch: string,
  vdir: string,
  cutAt: number,
  surfaces: Surface[],
): void {
  const handover = join(wt, "HANDOVER.md");
  const written = handoverMtimeMs(handover);
  if (written === null) {
    throw new RunError(`the session ended with no HANDOVER.md in ${wt}`);
  }
  if (!handoverFresh(written, cutAt)) {
    throw new RunError(`the HANDOVER.md in ${wt} predates this session`);
  }
  const made = commitsPastBase(wt, base, branch);
  if (made === null) {
    throw new RunError(`the session's commits could not be counted on ${branch}`);
  }
  if (made === 0) {
    throw new RunError(`the session committed nothing on ${branch}`);
  }
  if (surfaces.length === 1) {
    if (!branchHasPath(wt, branch, `${vdir}/README.md`)) {
      throw new RunError(`the session left no ${vdir}/README.md committed on ${branch}`);
    }
    const pages = committedFeaturePages(wt, branch, vdir) ?? [];
    if (pages.length < 3) {
      throw new RunError(`the session left fewer than 3 feature pages committed on ${branch}`);
    }
  } else {
    checkMultiVerifiers(wt, branch, base, surfaces);
  }
}

/** The ticket the project's checks read: none, so ticket checks report not run. */
const LAND_BRIEF = `# Verifier landing

## Ticket

The verifiers land only when the project's own checks pass. No ticket examples.

## Project profile

repo: the project under test
`;

function branchExists(repo: string, branch: string): boolean {
  return git(repo, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).code === 0;
}

/**
 * The local branch landing targets: the default origin names, else main or
 * master. It follows the same default the scope check compares against, so
 * the merge or pull request never targets another history.
 */
export function landTarget(repo: string): string | null {
  const sym = git(repo, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (sym.code === 0) {
    const name = remoteFromSymbolicRef(sym.out);
    if (
      name !== null &&
      name.startsWith("origin/") &&
      git(repo, ["rev-parse", "--verify", "--quiet", name]).code === 0
    ) {
      const local = name.slice("origin/".length);
      // The default is named but not checked out: refuse, since landing onto
      // any other local branch would target the wrong history.
      return branchExists(repo, local) ? local : null;
    }
  }
  for (const b of ["main", "master"]) {
    if (branchExists(repo, b)) return b;
  }
  return null;
}

function hasOrigin(repo: string): boolean {
  return git(repo, ["remote", "get-url", "origin"]).code === 0;
}

/** Files under a folder on a branch, or null when git cannot list them. */
function branchFilesUnder(repo: string, branch: string, folder: string): string[] | null {
  const r = git(repo, ["ls-tree", "-r", "--name-only", "-z", branch, "--", folder]);
  if (r.code !== 0) return null;
  return r.out.split("\0").filter((p) => p !== "");
}

/** What the branch adds past the merge base, or null when git cannot compare. */
function branchDiffPaths(repo: string, base: string, branch: string): string[] | null {
  // No rename detection: --name-only names a rename by its new path alone,
  // which would hide a deletion outside the folder from the scope check.
  const r = git(repo, ["diff", "--name-only", "--no-renames", "-z", `${base}...${branch}`]);
  if (r.code !== 0) return null;
  return r.out.split("\0").filter((p) => p !== "");
}

function proofIsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** A fresh dir under the dispatch holding this decision's recorded checks. */
function freshChecksDir(dispatch: string, branch: string): string {
  const parent = join(dispatch, "verifier-land");
  mkdirSync(parent, { recursive: true });
  const stem = branch.replace(/[^A-Za-z0-9._-]+/gu, "-");
  let n = 1;
  let dir = join(parent, `${stem}-${n}`);
  while (existsSync(dir)) {
    n++;
    dir = join(parent, `${stem}-${n}`);
  }
  mkdirSync(dir);
  return dir;
}

interface Decided {
  classified: ClassifiedEntry[];
  accepted: boolean;
  summary: VerifySummary | null;
  line: string;
}

function refused(branch: string, classified: ClassifiedEntry[], reason: string): Decided {
  return { classified, accepted: false, summary: null, line: refuseLine(branch, reason) };
}

/** Check name to kind from the spec verify run wrote, or null when unreadable. */
function specKinds(checksDir: string): Record<string, string> | null {
  try {
    const raw = JSON.parse(
      readFileSync(join(checksDir, "verify", "spec", "spec.json"), "utf8"),
    ) as {
      checks?: unknown;
    };
    if (!Array.isArray(raw.checks)) return null;
    const kinds: Record<string, string> = {};
    for (const c of raw.checks) {
      if (typeof c === "object" && c !== null) {
        const name = (c as Record<string, unknown>).name;
        const kind = (c as Record<string, unknown>).kind;
        if (typeof name === "string" && typeof kind === "string") kinds[name] = kind;
      }
    }
    return kinds;
  } catch {
    return null;
  }
}

/** Run the project's checks on a scratch at the branch head, then remove it. */
function runProjectChecks(o: {
  repo: string;
  branch: string;
  dispatch: string;
  timeout: number;
}): ChecksOutcome {
  const head = git(o.repo, ["rev-parse", "--verify", `${o.branch}^{commit}`]);
  if (head.code !== 0) {
    return { kind: "unrunnable", error: `the branch ${o.branch} names no commit` };
  }
  const tmp = mkdtempSync(join(tmpdir(), "verifier-land-"));
  const scratch = join(tmp, "scratch");
  try {
    const cut = run(RUN, ["cut-scratch", o.repo, o.repo, scratch, head.out.trim()]);
    if (cut.code !== 0) {
      return {
        kind: "unrunnable",
        error: `a scratch would not cut: ${lastLine(cut.err, cut.code)}`,
      };
    }
    const checksDir = freshChecksDir(o.dispatch, o.branch);
    const record = run(RUN, ["verify", "record", scratch, checksDir]);
    if (record.code !== 0) {
      return {
        kind: "unrunnable",
        error: `the checks could not be recorded: ${lastLine(record.err, record.code)}`,
      };
    }
    writeFileSync(join(checksDir, "brief.md"), LAND_BRIEF);
    const verify = run(RUN, ["verify", "run", scratch, checksDir], {
      timeout: timeoutMs(o.timeout),
    });
    if (verify.timedOut) return { kind: "timeout", seconds: o.timeout };
    if (verify.code !== 0 && verify.code !== 2 && verify.code !== 3) {
      const text = verify.err.trim() !== "" ? verify.err : verify.out;
      return {
        kind: "unrunnable",
        error: `the checks could not run: ${lastLine(text, verify.code)}`,
      };
    }
    const summary = parseVerifyResults(verify.out);
    let unrun: string[] = [];
    if (summary.notRun.length > 0) {
      const kinds = specKinds(checksDir);
      if (kinds === null) {
        return {
          kind: "unrunnable",
          error: "the checks ran but their kinds could not be read",
        };
      }
      unrun = unrunProject(summary.notRun, kinds);
    }
    return { kind: "ran", summary, unrunProject: unrun };
  } finally {
    run(RUN, ["cut-scratch", "--remove", o.repo, scratch]);
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      // Best-effort: a leftover temp dir is not a verdict.
    }
  }
}

function decideBranch(o: {
  repo: string;
  branch: string;
  dispatch: string;
  folder: string;
  timeout: number;
  classified: ClassifiedEntry[];
  compareBase: string;
}): Decided {
  const failedPresent: ClassifiedEntry[] = [];
  for (const e of o.classified) {
    if (e.proven) continue;
    const files = branchFilesUnder(o.repo, o.branch, e.folder);
    if (files === null) {
      return refused(o.branch, o.classified, `the branch could not be read under ${e.folder}`);
    }
    if (files.length > 0) failedPresent.push(e);
  }
  const provenEmpty: ClassifiedEntry[] = [];
  for (const e of o.classified) {
    if (!e.proven) continue;
    const files = branchFilesUnder(o.repo, o.branch, e.folder);
    if (files === null) {
      return refused(o.branch, o.classified, `the branch could not be read under ${e.folder}`);
    }
    if (files.length === 0) provenEmpty.push(e);
  }
  const diff = branchDiffPaths(o.repo, o.compareBase, o.branch);
  if (diff === null) {
    return refused(o.branch, o.classified, `the branch could not be compared`);
  }
  const cheapReason = decideCheap({
    branch: o.branch,
    classified: o.classified,
    failedPresent,
    provenEmpty,
    outside: outsidePaths(diff, o.folder),
  });
  if (cheapReason !== null) return refused(o.branch, o.classified, cheapReason);
  const outcome = runProjectChecks(o);
  const checksReason = decideChecks(outcome);
  if (checksReason !== null) return refused(o.branch, o.classified, checksReason);
  return {
    classified: o.classified,
    accepted: true,
    summary: outcome.kind === "ran" ? outcome.summary : null,
    line: acceptLine(o.branch, o.classified),
  };
}

interface Validated {
  repo: string;
  branch: string;
  dispatch: string;
  folder: string;
  /** The --folder flag as given, or null: the report path resolves it at the base. */
  explicitFolder: string | null;
  deliverable: { kind: "handover"; text: string } | { kind: "report"; text: string };
}

function validateLanding(req: ParsedCheck | ParsedLand): Validated {
  const repo = resolve(req.repo);
  if (!isRepo(repo)) throw new UsageError(`not a git repository: ${req.repo}`);
  if (!isRepoTop(repo)) throw new UsageError(`not the top of its repository: ${req.repo}`);
  const dispatch = resolve(req.dispatch);
  if (!existsSync(join(dispatch, "run.json"))) {
    throw new UsageError(`no run at the dispatch: ${req.dispatch}`);
  }
  if (!branchExists(repo, req.branch)) {
    throw new UsageError(`no such branch in ${req.repo}: ${req.branch}`);
  }
  const target = landTarget(repo);
  if (target !== null && req.branch === target) {
    throw new UsageError(`${req.branch} is the default branch; landing needs a verifier branch`);
  }
  // The parser sets exactly one deliverable; the last throw is unreachable.
  if (req.report !== undefined) {
    try {
      const text = readFileSync(resolve(req.report), "utf8");
      return {
        repo,
        branch: req.branch,
        dispatch,
        folder: req.folder ?? verifyDirName(repo),
        explicitFolder: req.folder,
        deliverable: { kind: "report", text },
      };
    } catch {
      throw new UsageError(`no report to read: ${req.report}`);
    }
  }
  if (req.handover !== undefined) {
    try {
      const text = readFileSync(resolve(req.handover), "utf8");
      return {
        repo,
        branch: req.branch,
        dispatch,
        folder: req.folder ?? verifyDirName(repo),
        explicitFolder: req.folder,
        deliverable: { kind: "handover", text },
      };
    } catch {
      throw new UsageError(`no hand-over to read: ${req.handover}`);
    }
  }
  throw new UsageError(`${req.cmd} needs --handover <file>`);
}

/**
 * A pass branch lands on the folder rule and the project's checks alone: the
 * rule covers every shape the compared base holds unless --folder names one,
 * and the report must be well formed, but how much of it the pass corrected
 * is the user's to judge from the proposal, never a refusal. Partial
 * corrections land like whole ones.
 */
function decideReportBranch(o: {
  repo: string;
  branch: string;
  dispatch: string;
  folders: string[];
  timeout: number;
  report: UpkeepReport;
  compareBase: string;
}): Decided {
  const diff = branchDiffPaths(o.repo, o.compareBase, o.branch);
  if (diff === null) {
    return refused(o.branch, [], "the branch could not be compared");
  }
  const reason = outsideReason(outsideFolders(diff, o.folders));
  if (reason !== null) return refused(o.branch, [], reason);
  const outcome = runProjectChecks(o);
  const checksReason = decideChecks(outcome);
  if (checksReason !== null) return refused(o.branch, [], checksReason);
  return {
    classified: [],
    accepted: true,
    summary: outcome.kind === "ran" ? outcome.summary : null,
    line: acceptLineReport(o.branch, o.report),
  };
}

function decideFromValidated(v: Validated, timeout: number): Decided {
  if (v.deliverable.kind === "report") {
    const parsed = parseUpkeepReport(v.deliverable.text);
    if (!parsed.ok) return refused(v.branch, [], parsed.error);
    if (parsed.report.verifiers.length === 0) {
      return refused(v.branch, [], "the report names no verifier");
    }
    const base = defaultBase(v.repo);
    if (base === null) {
      return refused(v.branch, [], "no commit to compare the branch against");
    }
    return decideReportBranch({
      repo: v.repo,
      branch: v.branch,
      dispatch: v.dispatch,
      folders: detectFolders(v.repo, v.explicitFolder, base),
      timeout,
      report: parsed.report,
      compareBase: base,
    });
  }
  const parsed = parseHandover(v.deliverable.text);
  if (!parsed.ok) return refused(v.branch, [], parsed.error);
  const classified = classifyEntries(parsed.entries, proofIsFile);
  const base = defaultBase(v.repo);
  if (base === null) {
    return refused(v.branch, classified, "no commit to compare the branch against");
  }
  return decideBranch({
    repo: v.repo,
    branch: v.branch,
    dispatch: v.dispatch,
    folder: v.folder,
    timeout,
    classified,
    compareBase: base,
  });
}

function logVerdict(dispatch: string, branch: string, verb: "note" | "merge", line: string): void {
  const r = run(RUN, ["log-action", dispatch, "coachman", verb, branch, line]);
  if (r.code !== 0)
    throw new RunError(`the verdict was not logged: ${r.err.trim() || r.out.trim()}`);
}

function runCheckCmd(req: ParsedCheck): number {
  const decided = decideFromValidated(validateLanding(req), req.timeout);
  console.log(decided.line);
  logVerdict(resolve(req.dispatch), req.branch, "note", decided.line);
  return decided.accepted ? 0 : 1;
}

function runUpkeepReportCmd(req: ParsedUpkeepReport): number {
  const repo = resolve(req.repo);
  if (!isRepo(repo)) throw new UsageError(`not a git repository: ${req.repo}`);
  if (!isRepoTop(repo)) throw new UsageError(`not the top of its repository: ${req.repo}`);
  const dispatch = resolve(req.dispatch);
  if (!existsSync(join(dispatch, "run.json"))) {
    throw new UsageError(`no run at the dispatch: ${req.dispatch}`);
  }
  let text: string;
  try {
    text = readFileSync(resolve(req.report), "utf8");
  } catch {
    throw new UsageError(`no report to read: ${req.report}`);
  }
  const scope = upkeepScope(repo, req.folder);
  const judged = decideUpkeep(scope.pages, scope.folders, text);
  for (const line of judged.verdict.lines) console.log(line);
  // The report is what was judged: the command cuts no branch to name.
  const target = resolve(req.report);
  for (const line of judged.verdict.lines) logVerdict(dispatch, target, "note", line);
  return judged.verdict.unchecked + (judged.verdict.stale - judged.mended.length) > 0 ? 1 : 0;
}

function landLocal(
  o: { repo: string; branch: string; dispatch: string; wordGiven: boolean },
  target: string,
): { line: string; verb: "note" | "merge"; code: number } {
  const runJson = fileText(join(o.dispatch, "run.json"));
  // The launch-card yes this flag carries belongs to the setup flow alone: on
  // any other dispatch the flag is ignored and authority decides as before.
  const setupWord = o.wordGiven && isSetupDispatch(runJson);
  if (!setupWord && mergeAuthorityOf(runJson) !== "postmaster") {
    return {
      line: `waiting: ${o.branch} is ready to merge into ${target}; waiting for the user's word`,
      verb: "note",
      code: 0,
    };
  }
  const current = git(o.repo, ["symbolic-ref", "--short", "-q", "HEAD"]).out.trim();
  if (current === "") {
    return {
      line: `error: ${o.repo} is not on a branch; check out ${target} and run again`,
      verb: "note",
      code: 1,
    };
  }
  if (current !== target) {
    return {
      line: `error: ${o.repo} is on ${current}, not ${target}; check out ${target} and run again`,
      verb: "note",
      code: 1,
    };
  }
  if (git(o.repo, ["status", "--porcelain"]).out.trim() !== "") {
    return {
      line: `error: ${o.repo} has uncommitted changes; commit or stash them and run again`,
      verb: "note",
      code: 1,
    };
  }
  const merge = git(o.repo, ["merge", "--no-ff", "--no-edit", o.branch]);
  if (merge.code !== 0) {
    git(o.repo, ["merge", "--abort"]);
    const text = merge.err.trim() !== "" ? merge.err : merge.out;
    return {
      line: `error: the merge of ${o.branch} into ${target} failed and was aborted: ${lastLine(text, merge.code)}`,
      verb: "note",
      code: 1,
    };
  }
  const sha = git(o.repo, ["rev-parse", "--short", "HEAD"]).out.trim();
  return { line: `merge: ${o.branch} into ${target} (${sha})`, verb: "merge", code: 0 };
}

function landPullRequest(
  o: {
    repo: string;
    branch: string;
    title: string;
    acceptLine: string;
    summary: VerifySummary | null;
  },
  target: string,
): { line: string; verb: "note" | "merge"; code: number } {
  const push = git(o.repo, ["push", "origin", o.branch]);
  if (push.code !== 0) {
    const text = push.err.trim() !== "" ? push.err : push.out;
    return {
      line: `error: the push of ${o.branch} to origin failed: ${lastLine(text, push.code)}`,
      verb: "note",
      code: 1,
    };
  }
  const checks =
    o.summary === null
      ? "not reported"
      : o.summary.results.map((r) => `${r.name}: ${r.result}`).join(", ");
  const pr = run(
    "gh",
    [
      "pr",
      "create",
      "--base",
      target,
      "--head",
      o.branch,
      "--title",
      o.title,
      "--body",
      `${o.acceptLine}\n\nChecks: ${checks}`,
    ],
    { cwd: o.repo },
  );
  if (pr.code !== 0) {
    const text = pr.err.trim() !== "" ? pr.err : pr.out;
    return {
      line: `error: pushed ${o.branch} to origin, but gh pr create failed: ${lastLine(text, pr.code)}`,
      verb: "note",
      code: 1,
    };
  }
  const url = pr.out
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "");
  if (url === undefined || url === "") {
    return {
      line:
        `pull-request: pushed ${o.branch} to origin and opened a pull request against ` +
        `${target} (the URL was not reported); waiting for the user's word that it merged`,
      verb: "note",
      code: 0,
    };
  }
  return {
    line:
      `pull-request: pushed ${o.branch} to origin and opened ${url} against ${target}; ` +
      "waiting for the user's word that it merged",
    verb: "note",
    code: 0,
  };
}

function runLandCmd(req: ParsedLand): number {
  const v = validateLanding(req);
  const decided = decideFromValidated(v, req.timeout);
  if (!decided.accepted) {
    console.log(decided.line);
    logVerdict(v.dispatch, v.branch, "note", decided.line);
    return 1;
  }
  console.log(decided.line);
  logVerdict(v.dispatch, v.branch, "note", decided.line);
  const route = req.landing ?? defaultLanding(hasOrigin(v.repo));
  const target = landTarget(v.repo);
  const outcome =
    target === null
      ? {
          line: `error: no local default branch to land ${v.branch} onto`,
          verb: "note" as const,
          code: 1,
        }
      : route === "pull-request"
        ? landPullRequest(
            {
              repo: v.repo,
              branch: v.branch,
              title:
                v.deliverable.kind === "report"
                  ? `Upkeep pass for ${basename(v.repo)}`
                  : `Verifiers for ${basename(v.repo)}`,
              acceptLine: decided.line,
              summary: decided.summary,
            },
            target,
          )
        : landLocal(
            { repo: v.repo, branch: v.branch, dispatch: v.dispatch, wordGiven: req.wordGiven },
            target,
          );
  console.log(outcome.line);
  logVerdict(v.dispatch, v.branch, outcome.verb, outcome.line);
  return outcome.code;
}

function main(argv: string[]): number {
  // The verifier names every repo explicitly, so inherited git redirectors
  // can only corrupt: drop them for this process and every session it starts.
  for (const k of GIT_REDIRECT_ENV) delete process.env[k];
  try {
    const parsed = parseArgs(argv);
    if (!parsed.ok) throw new UsageError(parsed.error);
    if (parsed.req.cmd === "prompt") return runPrompt(parsed.req);
    if (parsed.req.cmd === "list") return runListCmd(parsed.req);
    if (parsed.req.cmd === "stale") return runStaleCmd(parsed.req);
    if (parsed.req.cmd === "check") return runCheckCmd(parsed.req);
    if (parsed.req.cmd === "land") return runLandCmd(parsed.req);
    if (parsed.req.cmd === "upkeep") return runUpkeep(parsed.req);
    if (parsed.req.cmd === "upkeep-prompt") return runUpkeepPrompt(parsed.req);
    if (parsed.req.cmd === "upkeep-report") return runUpkeepReportCmd(parsed.req);
    return runMake(parsed.req);
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`verifier: ${e.message}\n${USAGE}`);
      return 2;
    }
    if (e instanceof RunError) {
      console.error(`verifier: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
