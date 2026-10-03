// The default check for a web app's User journey. A script cannot click through prose, so the walk
// is the agent's: it follows each step in a browser, through the project's own browser library,
// and writes a report. This script holds that report to the ticket: every step of the ticket's
// `## User journey`, in the ticket's order, marked did or did not, with a screenshot beside the
// report, in its directory or below it, so a walk leaves nothing in the worktree it walked.
//
//   run verify-journey [<worktree>] [--ticket <file>] [--report <file>]
//   run verify-journey --path [<worktree>] [--dir <dir>]   where the report for <worktree>'s HEAD goes
//   run verify-journey --format                            the report's format, for a brief
//
//   exit 0  every step is in the report, in order, marked did, with its screenshot beside it
//   exit 1  a step is marked did not
//   exit 3  not run: no User journey, no report for this commit, or a step not walked, with no
//           verdict or with no screenshot; each is named, and the reason is the last line
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { tryJsonFile } from "./lib/data.ts";
import { die, run } from "./lib/proc.ts";
import {
  BOUND_R,
  casefold,
  END_OF_STRING,
  PY_DOT,
  PY_S_CLASS,
  pyLower,
  pyTrim,
} from "./lib/text.ts";

export const FENCE = new RegExp(`^[${PY_S_CLASS}]*(\`{3,}|~{3,})`, "u");
export const ITEM = new RegExp(
  "^[" +
    PY_S_CLASS +
    "]*(?:\\p{Nd}{1,9}[.)]|[-*+])[" +
    PY_S_CLASS +
    "]+(" +
    PY_DOT +
    "*)" +
    END_OF_STRING +
    "",
  "u",
);
export const HEADING = new RegExp(
  "^##[" +
    PY_S_CLASS +
    "]+(" +
    PY_DOT +
    "*?)[" +
    PY_S_CLASS +
    "]*#*[" +
    PY_S_CLASS +
    "]*" +
    END_OF_STRING +
    "",
  "u",
);
export const TICKET_HEAD = new RegExp(
  `^##[${PY_S_CLASS}]+Ticket[${PY_S_CLASS}]*${END_OF_STRING}`,
  "u",
);
const PROFILE_HEAD = new RegExp(
  `^##[${PY_S_CLASS}]+Project profile[${PY_S_CLASS}]*${END_OF_STRING}`,
  "u",
);
export const JOURNEY_HEAD = new RegExp(
  `^##[${PY_S_CLASS}]+User journey[${PY_S_CLASS}]*${END_OF_STRING}`,
  "iu",
);
export const BREAK_HEAD = new RegExp(`^#{1,2}[${PY_S_CLASS}]`, "u");
export const SENT_SPLIT = new RegExp(`[.!?]["')\\]]*(?=[${PY_S_CLASS}]|${END_OF_STRING})`, "gu");
export const VERDICT_GUARD = new RegExp(`^[${PY_S_CLASS}]*(did not|did)${BOUND_R}`, "iu");
const VERDICT = new RegExp(
  "^[" +
    PY_S_CLASS +
    "]*(did not|did)" +
    BOUND_R +
    ":?[" +
    PY_S_CLASS +
    "]*(" +
    PY_DOT +
    "*)" +
    END_OF_STRING +
    "",
  "iu",
);
export const SHOT_GUARD = new RegExp(
  `^[${PY_S_CLASS}]*screenshot:[${PY_S_CLASS}]*[^${PY_S_CLASS}]`,
  "iu",
);
export const SHOT = new RegExp(
  "^[" +
    PY_S_CLASS +
    "]*screenshot:[" +
    PY_S_CLASS +
    "]*(" +
    PY_DOT +
    "+?)[" +
    PY_S_CLASS +
    "]*" +
    END_OF_STRING +
    "",
  "iu",
);

function notRun(msg: string): never {
  console.log(`not run: ${msg}`);
  process.exit(3);
  throw new Error("unreachable");
}

export function norm(s: string): string {
  // text.ts: BASE norm is re.sub(r"\s+", " ", s).strip().rstrip(".").strip().casefold().
  const squashed = s.replace(new RegExp(`[${PY_S_CLASS}]+`, "gu"), " ");
  return casefold(pyTrim(pyTrim(squashed).replace(/\.+$/u, "")));
}

// BASE reads with .splitlines(); the flow's tickets and reports only ever
// carry \n or \r\n, so the port splits \n and drops one trailing \r.
// Other splitlines boundaries (\x0b, \u2028, …) stay: they never occur here.
function dropCR(l: string): string {
  return l.endsWith("\r") ? l.slice(0, -1) : l;
}

function ticketLines(text: string): string[] {
  const lines = text.split("\n").map(dropCR);
  const start = lines.findIndex((l) => TICKET_HEAD.test(l));
  if (start === -1) return lines;
  const end = lines.findIndex((l, i) => i > start && PROFILE_HEAD.test(l));
  return lines.slice(start + 1, end === -1 ? lines.length : end);
}

function steps(lines: string[]): string[] | null {
  const start = lines.findIndex((l) => JOURNEY_HEAD.test(l));
  if (start === -1) return null;
  const body: string[] = [];
  let fence: string | null = null;
  for (const l of lines.slice(start + 1)) {
    if (fence === null && BREAK_HEAD.test(l)) break;
    const m = FENCE.exec(l);
    if (m && fence === null) {
      fence = m[1] ?? "";
    } else if (
      m &&
      fence !== null &&
      (m[1] ?? "")[0] === fence[0] &&
      (m[1] ?? "").length >= fence.length
    ) {
      fence = null;
    } else if (fence === null) {
      body.push(l);
    }
  }
  if (body.some((l) => ITEM.test(l))) {
    const items: string[][] = [];
    let cur: string[] | null = null;
    for (const l of body) {
      const m = ITEM.exec(l);
      if (m) {
        cur = [m[1] ?? ""];
        items.push(cur);
      } else if (l.trim() && cur !== null) {
        cur.push(l.trim());
      }
    }
    return items.map((i) => i.join(" ").trim()).filter((s) => s !== "");
  }
  const text = body
    .filter((l) => l.trim())
    .map((l) => l.trim())
    .join(" ");
  const masked = text.replace(/`[^`]*`/gu, (m) => "x".repeat(m.length));
  const out: string[] = [];
  let last = 0;
  for (const m of masked.matchAll(SENT_SPLIT)) {
    out.push(text.slice(last, m.index! + m[0].length).trim());
    last = m.index! + m[0].length;
  }
  if (text.slice(last).trim()) out.push(text.slice(last).trim());
  return out.filter((s) => s !== "");
}

function format(): void {
  console.log(`Walk the ticket's User journey in a browser, through the project's own browser library, at the
commit you are reporting on. Write the report to the path \`run verify journey-path\` prints for
that commit. For each step, in the ticket's order: a \`## \` heading holding the step as the
ticket words it; under it a line \`did\`, or \`did not: <what happened instead>\`; then a line
\`screenshot: <path>\`, the path, relative to the report, of a screenshot of that step saved in the
report's directory or below it. Steps of your own may follow the ticket's.`);
}

function journey(mode: "path" | "judge", wtArg: string, ...rest: string[]): number {
  const wt = resolve(wtArg);

  function specDir(): string {
    return process.env.POSTMASTER_VERIFY || join(wt, ".postmaster", "verify");
  }

  function reportPath(givenDir: string | null): string {
    const r = run("git", ["-C", wt, "rev-parse", "HEAD"]);
    if (r.code !== 0) {
      console.error(`verify-journey: ${wt} is not a git worktree with a commit`);
      process.exit(1);
    }
    let d: string | null = givenDir;
    if (!d) {
      try {
        const j = tryJsonFile<Record<string, unknown>>(join(specDir(), "spec.json"));
        d = (j?.journey_dir as string) ?? null;
      } catch {
        d = null;
      }
    }
    return join(d || join(wt, ".postmaster", "verify", "journey"), `${r.out.trim()}.md`);
  }

  if (mode === "path") {
    console.log(reportPath(rest[0] || null));
    return 0;
  }

  const ticketArg = rest[0] ?? "";
  const reportArg = rest[1] ?? "";
  const ticket = ticketArg || join(specDir(), "ticket.md");
  let text: string;
  try {
    text = readFileSync(ticket, "utf8");
  } catch {
    notRun(`no ticket at ${ticket}; scripts/run verify arm copies the run's there`);
  }
  const want = steps(ticketLines(text!));
  if (want === null) notRun("the ticket has no User journey");
  if (want?.length === 0) notRun("the ticket's User journey has no steps");
  const report = reportArg ? reportArg : reportPath(null);
  let got: string[];
  try {
    got = readFileSync(report, "utf8").split("\n").map(dropCR);
  } catch {
    notRun(`no journey report at ${report}: walk the journey in a browser and write it there`);
  }

  const sections: Array<[string, string[]]> = [];
  for (const l of got!) {
    const m = HEADING.exec(l);
    if (m) {
      sections.push([m[1] ?? "", []]);
    } else if (sections.length > 0) {
      sections[sections.length - 1]?.[1].push(l);
    }
  }

  const didNot: string[] = [];
  const missing: string[] = [];
  let at = 0;
  for (let n = 0; n < want?.length; n++) {
    const step = want?.[n] ?? "";
    const k = sections.findIndex((s, i) => i >= at && norm(s[0]) === norm(step));
    if (k === -1) {
      missing.push(`step ${n + 1} not walked: ${step}`);
      continue;
    }
    at = k + 1;
    const body = sections[k]?.[1];
    const verdictLine = body.find((l) => VERDICT_GUARD.test(l));
    const verdict = verdictLine ? VERDICT.exec(verdictLine) : null;
    const shotLine = body.find((l) => SHOT_GUARD.test(l));
    const shot = shotLine ? SHOT.exec(shotLine)?.[1] : null;
    if (!verdict) {
      missing.push(`step ${n + 1} has no verdict, did or did not: ${step}`);
      continue;
    }
    if (pyLower(verdict[1] ?? "") === "did not") {
      didNot.push(`step ${n + 1} did not: ${step}${verdict[2] ? ` (${verdict[2]})` : ""}`);
      continue;
    }
    let path: string | null = shot ? shot : null;
    if (path !== null && !isAbsolute(path)) {
      path = join(dirname(report), path);
    }
    let beside = false;
    if (path !== null) {
      try {
        beside = realpathSync(path).startsWith(realpathSync(dirname(report)) + sep);
      } catch {
        beside = false;
      }
    }
    if (!beside || !path || !existsSync(path) || statSync(path).size === 0) {
      missing.push(
        `step ${n + 1} has no screenshot beside the report${path ? ` at ${path}` : ""}: ${step}`,
      );
    }
  }

  for (const line of [...didNot, ...missing]) console.log(line);
  if (didNot.length > 0) {
    console.log(`${didNot.length} of ${want?.length} steps did not do what the ticket says`);
    return 1;
  }
  if (missing.length > 0) {
    console.log(
      `not run: ${missing.length} of ${want?.length} steps have no complete record in ${report}`,
    );
    return 3;
  }
  console.log(`all ${want?.length} steps walked, each did what the ticket says`);
  return 0;
}

// --- entry -----------------------------------------------------------------------------------
const USAGE =
  "usage: run verify-journey [<worktree>] [--ticket <file>] [--report <file>] | --path [<worktree>] [--dir <dir>] | --format";

function main(argv: string[]): number {
  if (argv[0] === "--format") {
    if (argv.length !== 1) die(USAGE, 1);
    format();
    return 0;
  }
  if (argv[0] === "--path") {
    let WT = ".";
    let DIR = "";
    const rest = argv.slice(1);
    let i = 0;
    while (i < rest.length) {
      if (rest[i] === "--dir") {
        if (rest.length < i + 2) die(USAGE, 1);
        DIR = rest[i + 1] ?? "";
        i += 2;
      } else if (rest[i]?.startsWith("-")) {
        die(USAGE, 1);
      } else {
        WT = rest[i] ?? ".";
        i += 1;
      }
    }
    return journey("path", WT, DIR);
  }
  let WT = ".";
  let TICKET = "";
  let REPORT = "";
  let i = 0;
  while (i < argv.length) {
    if (argv[i] === "--ticket") {
      if (argv.length < i + 2) die(USAGE, 1);
      TICKET = argv[i + 1] ?? "";
      i += 2;
    } else if (argv[i] === "--report") {
      if (argv.length < i + 2) die(USAGE, 1);
      REPORT = argv[i + 1] ?? "";
      i += 2;
    } else if (argv[i]?.startsWith("-")) {
      die(USAGE, 1);
    } else {
      WT = argv[i] ?? ".";
      i += 1;
    }
  }
  if (!existsSync(WT)) {
    console.error(`verify-journey: no such directory: ${WT}`);
    return 1;
  }
  return journey("judge", WT, TICKET, REPORT);
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
