// Append one structured action to a run's audit log and to the project's ledger.
//
//   run log-action <dispatch-dir> <actor> <action> <target> [detail...]
//   run log-action --project <repo> clerk note <target> [detail...]
//   run log-action --project <repo> clerk ticket-edit <target> [detail...]
//   run log-action --project <repo> postmaster dispatch clerk [detail...]
//   run log-action --project <repo> postmaster ticket-check <target> [detail...]
//   run log-action <dispatch-dir> <actor> tool-fault <postmaster-file> --ran <what ran>
//                 --failed <what failed> --error <the error, or none> --diagnosis <why>
//                 --fix <the fix proposed> [--workaround <what was done instead>] [--control <kind>]
//
//   actor    postmaster | coachman | lane:<name>
//   action   a verb from a fixed set, enforced, so the log is computable:
//            dispatch resume refuse harvest synthesize review-launch review-harvest finding apply
//            escalate rule ticket-check ticket-create ticket-edit ticket-state ticket-comment
//            gate verify merge teardown degrade handoff-accept handoff stage premises
//            tool-fault note wall told carry reach take-in switch-off
//   target   what the action was done to: a lane, a ticket id, a branch, a path, a round
//   detail   free text; everything after the target, joined by spaces. A finding's opens with its
//            class, gating or style, so the style findings can be told apart.
//            A wall's opens with `<role> <lens> <round> <reset> <the provider's first line>`,
//            a told's with the same role/lens/round of the wall it marks, a wall ruling with
//            `wall go-on`, and a carry's with `wall go-on` too, so the wall lines of a run
//            read back computably (walls.ts). A take-in's opens with `on=<branch>@<commit>`,
//            so the admitted commits read back computably (take-in.ts)
//
// A switch-off is the user's word on one switch-off comment or settings change a run adds
// (`run landing switch-offs` lists them and prints each identity). Its target is that
// identity, `comment:<16 hex>` or `settings:<16 hex>`, enforced; its detail opens with the
// decision, approved or refused, then the entry and the user's words. The run's
// actions.jsonl and the project's ledger each hold the same line, and
// `run landing switch-offs` reads approved lines back to clear the branch.
//
// A tool-fault is postmaster itself misbehaving: a script, a runbook step or a harness adapter.
// Its target is the postmaster file, relative to the checkout this script is in or absolute,
// and is recorded as its real path relative to that checkout. Its fields are flags, all
// required but --workaround and --control, and the line carries them as a `fault` object, with
// --failed as its detail. A script skills/postmaster/controls.md lists is a control of the kind
// the list gives, whatever --control says; --control gives the kind of a step the list names.
// A fault in a control is recorded as one, and the message says to stop.
//
// Every field is written as JSON that any reader can split on newlines: a control character is
// dropped, bytes that are not UTF-8 are dropped, and a line or paragraph separator is escaped.
//
// Writes one JSON line to <dispatch>/actions.jsonl and the same line, with the run named, to
// <dispatch>/../ledger.jsonl (the project's ledger across runs, under the project's own
// .postmaster/runs/). Both are append-only. Nothing in the flow reads its own narrative back
// to learn from it; it reads these lines.
//
//   exit 0  written to both files
//   exit 1  usage, an action outside the set, a finding with no class, a premises result with
//           no verified commit or base, a switch-off with a target or detail out of shape,
//           a tool-fault missing a field or naming no postmaster file, or a file
//           could not be appended
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { toolRoot } from "./lib/paths.ts";
import { argvDecoded } from "./lib/proc.ts";
import { pyWords } from "./lib/text.ts";

const VERBS =
  " dispatch resume refuse harvest synthesize review-launch review-harvest finding apply escalate rule ticket-check ticket-create ticket-edit ticket-state ticket-comment reach gate verify merge teardown degrade handoff-accept handoff stage premises tool-fault note wall told carry take-in switch-off ";
const CONTROLS = join(toolRoot(import.meta), "skills/postmaster/controls.md");

// JSON string escaping: drop control chars, escape separators. Bytes that
// are not UTF-8 never reach here: the arguments arrive re-derived from the
// raw argv bytes with invalid sequences dropped, as iconv -c drops them, so
// a U+FFFD in a field is always a legitimate character, which is kept.
function jsonStr(s: string): string {
  // Drop control characters (except those we escape below).
  let result = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 && ch !== "\n" && ch !== "\r" && ch !== "\t") continue;
    result += ch;
  }
  // Escape backslash, quote, newline, CR, tab, and Unicode separators
  result = result
    .replace(/\\/gu, "\\\\")
    .replace(/"/gu, '\\"')
    .replace(/\n/gu, "\\n")
    .replace(/\r/gu, "\\r")
    .replace(/\t/gu, "\\t")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029")
    .replace(/\u0085/gu, "\\u0085");
  return result;
}

interface Fault {
  ran: string;
  failed: string;
  error: string;
  diagnosis: string;
  fix: string;
  workaround: string;
  control: string;
}

export function kindsOf(text: string): string[] {
  // BASE awk -F'|': /^[[:space:]]*\|[[:space:]]*`/ rows; k = $3 with all [[:space:]] stripped.
  const kinds: string[] = [];
  for (const line of text.split("\n")) {
    if (!/^[ \t\n\v\f\r]*\|[ \t\n\v\f\r]*`/u.test(line)) continue;
    const k = (line.split("|")[2] ?? "").replace(/[ \t\n\v\f\r]/gu, "");
    if (k !== "") kinds.push(k);
  }
  return [...new Set(kinds)].sort();
}

export function controlOf(text: string, t: string): string | undefined {
  // BASE awk -F'|': c = $2 edge-trimmed of [[:space:]], compared with backticks; k = $3 stripped.
  for (const line of text.split("\n")) {
    const cells = line.split("|");
    const c = (cells[1] ?? "").replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/gu, "");
    if (c === `\`${t}\`` || c === `\`<tool>/${t}\``) {
      return (cells[2] ?? "").replace(/[ \t\n\v\f\r]/gu, "");
    }
    const entry = /^`(?:<tool>\/)?scripts\/run ([A-Za-z0-9_-]+)(?: [^`]*)?`$/u.exec(c);
    if (entry && (t === `scripts/${entry[1]}.ts` || t === `scripts/${entry[1]}.sh`))
      return (cells[2] ?? "").replace(/[ \t\n\v\f\r]/gu, "");
  }
  return undefined;
}

function toolFault(
  given: string,
  args: string[],
  TOOL: string,
): { target: string; detail: string; fault: Fault } | { error: string } {
  let ran = "";
  let failed = "";
  let error = "";
  let diagnosis = "";
  let fix = "";
  let workaround = "";
  let control = "";

  let i = 0;
  while (i < args.length) {
    if (i + 1 >= args.length) return { error: `log-action: ${args[i]} needs a value` };
    const key = args[i];
    const val = args[i + 1]!;
    switch (key) {
      case "--ran":
        ran = val;
        break;
      case "--failed":
        failed = val;
        break;
      case "--error":
        error = val;
        break;
      case "--diagnosis":
        diagnosis = val;
        break;
      case "--fix":
        fix = val;
        break;
      case "--workaround":
        workaround = val;
        break;
      case "--control":
        control = val;
        break;
      default:
        return {
          error: `log-action: a tool-fault takes --ran --failed --error --diagnosis --fix [--workaround] [--control], not '${key}'`,
        };
    }
    i += 2;
  }

  for (const [name, val] of [
    ["ran", ran],
    ["failed", failed],
    ["error", error],
    ["diagnosis", diagnosis],
    ["fix", fix],
  ] as const) {
    // BASE ${var//[[:space:]]/} in the C locale: ASCII space only.
    if (val.replace(/[ \t\n\v\f\r]/gu, "") === "") {
      return { error: `log-action: a tool-fault needs --${name} (the error may be 'none')` };
    }
  }

  // Resolve the target path relative to TOOL
  let t = given.startsWith("/") ? given : join(TOOL, given);
  try {
    const dir = dirname(t);
    const resolved = realpathSync(dir);
    t = join(resolved, basename(t));
  } catch {
    t = "";
  }
  if (t.startsWith(`${TOOL}/`)) {
    t = t.slice(TOOL.length + 1);
  } else {
    t = "";
  }
  if (!t || !existsSync(join(TOOL, t))) {
    return {
      error: `log-action: a tool-fault names the postmaster file that misbehaved, in ${TOOL}; '${given}' is not one`,
    };
  }

  // Read controls.md to find kinds
  let kinds: string[] = [];
  try {
    const text = readFileSync(CONTROLS, "utf8");
    kinds.push(...kindsOf(text));
  } catch {
    /* ignore */
  }
  kinds = [...new Set(kinds)].sort();

  if (control && !kinds.includes(control)) {
    return {
      error: `log-action: '${control}' is not a kind of control in ${CONTROLS}: ${kinds.join(" ")}`,
    };
  }

  // Check if this file is a listed control
  try {
    const text = readFileSync(CONTROLS, "utf8");
    const foundControl = controlOf(text, t);
    if (foundControl !== undefined) control = foundControl;
  } catch {
    /* ignore */
  }

  if (control) {
    console.error(
      `log-action: ${t} is a control (${control}): stop the leg and escalate; never work around it`,
    );
  }

  return {
    target: t,
    detail: failed,
    fault: { ran, failed, error, diagnosis, fix, workaround, control },
  };
}

function logAction(
  dispatch: string,
  actor: string,
  action: string,
  target: string,
  ...detailParts: string[]
): number {
  const TOOL = toolRoot(import.meta);
  const detail = detailParts.join(" ");

  if (!VERBS.includes(` ${action} `)) {
    console.error(`log-action: '${action}' is not an action in the set:${VERBS}`);
    return 1;
  }
  if (action === "finding") {
    const firstWord = detail.split(" ")[0] ?? "";
    if (firstWord !== "gating" && firstWord !== "style") {
      console.error("log-action: a finding's detail opens with its class, gating or style");
      return 1;
    }
  }
  if (action === "premises") {
    const result = /(?:^|[ \t])result=(same|moved|unknown|changed|missing)(?:[ \t]|$)/u.test(
      detail,
    );
    if (
      (actor !== "coachman" && actor !== "postmaster") ||
      !target.trim() ||
      !/(?:^|[ \t])base=[^ \t\r\n]+/u.test(detail) ||
      !result
    ) {
      console.error(
        "log-action: premises needs the coachman or postmaster, a verified commit, base=<commit> and result=<state>",
      );
      return 1;
    }
  }
  if (action === "switch-off") {
    if (!/^(?:comment|settings):[0-9a-f]{16}$/u.test(target)) {
      console.error(
        "log-action: a switch-off's target is its identity from run landing switch-offs, comment:<16 hex> or settings:<16 hex>",
      );
      return 1;
    }
    const words = pyWords(detail);
    if (words[0] !== "approved" && words[0] !== "refused") {
      console.error(
        "log-action: a switch-off's detail opens with its decision, approved or refused",
      );
      return 1;
    }
    if (words.length < 3) {
      console.error(
        "log-action: a switch-off's detail carries the decision, then the entry and the user's words",
      );
      return 1;
    }
  }

  let finalTarget = target;
  let finalDetail = detail;
  let faultJson = "";

  if (action === "tool-fault") {
    const result = toolFault(target, detailParts, TOOL);
    if ("error" in result) {
      console.error(result.error);
      return 1;
    }
    finalTarget = result.target;
    finalDetail = result.detail;
    const f = result.fault;
    faultJson = `,"fault":{"ran":"${jsonStr(f.ran)}","failed":"${jsonStr(f.failed)}","error":"${jsonStr(f.error)}","diagnosis":"${jsonStr(f.diagnosis)}","fix":"${jsonStr(f.fix)}","workaround":"${jsonStr(f.workaround)}","control":"${jsonStr(f.control)}"}`;
  }

  let dispatchReal: string;
  try {
    dispatchReal = resolve(dispatch);
    if (!statSync(dispatchReal).isDirectory()) throw new Error("not dir");
  } catch {
    console.error(`log-action: no such dir: ${dispatch}`);
    return 1;
  }
  const runName = basename(dispatchReal);
  // The run is the dispatch directory's name. The project is the basename of
  // the project root: <project>/.postmaster/runs/<TICKET>. An older layout,
  // runs/<project>/<TICKET>, is still read as that project.
  const parent = dirname(dispatchReal);
  const grand = dirname(parent);
  const project =
    basename(parent) === "runs" && basename(grand) === ".postmaster"
      ? basename(dirname(grand))
      : basename(parent);
  const ts = new Date().toISOString().replace(/\.[0-9]+Z$/u, "Z");

  const line = `{"ts":"${ts}","project":"${jsonStr(project)}","run":"${jsonStr(runName)}","actor":"${jsonStr(actor)}","action":"${jsonStr(action)}","target":"${jsonStr(finalTarget)}","detail":"${jsonStr(finalDetail)}"${faultJson}}`;

  try {
    appendFileSync(join(dispatchReal, "actions.jsonl"), `${line}\n`);
  } catch {
    console.error(`log-action: cannot append to ${dispatchReal}/actions.jsonl`);
    return 1;
  }
  try {
    appendFileSync(join(dirname(dispatchReal), "ledger.jsonl"), `${line}\n`);
  } catch {
    console.error("log-action: cannot append to the project ledger");
    return 1;
  }
  return 0;
}

function logProjectEvent(
  repo: string,
  actor: string,
  action: string,
  target: string,
  detailParts: string[],
): number {
  const note = actor === "clerk" && action === "note" && target !== "";
  const edit = actor === "clerk" && action === "ticket-edit" && target !== "";
  const dispatch = actor === "postmaster" && action === "dispatch" && target === "clerk";
  const check = actor === "postmaster" && action === "ticket-check" && target !== "";
  if (!note && !edit && !dispatch && !check) {
    console.error(
      "usage: run log-action --project <repo> clerk note <target> | clerk ticket-edit <target> [detail...] | postmaster dispatch clerk [detail...] | postmaster ticket-check <target> [detail...]",
    );
    return 1;
  }
  let project = "";
  try {
    const root = resolve(repo);
    if (!statSync(root).isDirectory()) throw new Error("not a directory");
    project = basename(root);
    const runs = join(root, ".postmaster", "runs");
    mkdirSync(runs, { recursive: true });
    const ledger = join(runs, "ledger.jsonl");
    const ts = new Date().toISOString().replace(/\.[0-9]+Z$/u, "Z");
    const runName = actor === "postmaster" ? "postmaster" : "booking-clerk";
    const line = `{"ts":"${ts}","project":"${jsonStr(project)}","run":"${runName}","actor":"${actor}","action":"${action}","target":"${jsonStr(target)}","detail":"${jsonStr(detailParts.join(" "))}"}`;
    if (actor === "postmaster") {
      const logDir = join(runs, "postmaster");
      mkdirSync(logDir, { recursive: true });
      appendFileSync(join(logDir, "actions.jsonl"), `${line}\n`);
    }
    appendFileSync(ledger, `${line}\n`);
  } catch {
    console.error(`log-action: cannot append the project action under ${repo}/.postmaster/runs`);
    return 1;
  }
  return 0;
}

// --- entry ------------------------------------------------------------------------------
const argv = argvDecoded();
if (import.meta.main) {
  if (argv[0] === "--project") {
    if (argv.length < 5) {
      console.error(
        "usage: run log-action --project <repo> clerk note <target> | clerk ticket-edit <target> [detail...] | postmaster dispatch clerk [detail...] | postmaster ticket-check <target> [detail...]",
      );
      process.exit(1);
    }
    if (argv[2] === "clerk" && (argv[3] === "note" || argv[3] === "ticket-edit")) {
      process.exit(
        logProjectEvent(
          argv[1] as string,
          argv[2] as string,
          argv[3] as string,
          argv[4] as string,
          argv.slice(5) as string[],
        ),
      );
    }
    if (
      argv[2] === "postmaster" &&
      ((argv[3] === "dispatch" && argv[4] === "clerk") || argv[3] === "ticket-check")
    ) {
      process.exit(
        logProjectEvent(
          argv[1] as string,
          argv[2] as string,
          argv[3] as string,
          argv[4] as string,
          argv.slice(5) as string[],
        ),
      );
    }
    console.error(
      "usage: run log-action --project <repo> clerk note <target> | clerk ticket-edit <target> [detail...] | postmaster dispatch clerk [detail...] | postmaster ticket-check <target> [detail...]",
    );
    process.exit(1);
  }
  if (argv.length < 4 || !argv[0] || !argv[1] || !argv[2] || !argv[3]) {
    console.error("usage: run log-action <dispatch-dir> <actor> <action> <target> [detail...]");
    process.exit(1);
  }
  process.exit(
    logAction(
      argv[0] as string,
      argv[1] as string,
      argv[2] as string,
      argv[3] as string,
      ...argv.slice(4),
    ),
  );
}
