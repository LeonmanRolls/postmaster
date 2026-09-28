// Append one structured action to a run's audit log and to the project's ledger.
//
//   log-action.sh <dispatch-dir> <actor> <action> <target> [detail...]
//   log-action.sh <dispatch-dir> <actor> tool-fault <postmaster-file> --ran <what ran>
//                 --failed <what failed> --error <the error, or none> --diagnosis <why>
//                 --fix <the fix proposed> [--workaround <what was done instead>] [--control <kind>]
//   log-action.sh --self-test
//
//   actor    postmaster | coachman | lane:<name>
//   action   a verb from a fixed set, enforced, so the log is computable:
//            dispatch resume harvest synthesize review-launch review-harvest finding apply
//            escalate rule ticket-check ticket-create ticket-edit ticket-state ticket-comment
//            gate verify merge teardown degrade handoff-accept handoff stage tool-fault note
//   target   what the action was done to: a lane, a ticket id, a branch, a path, a round
//   detail   free text; everything after the target, joined by spaces. A finding's opens with its
//            class, gating or style, so the style findings can be told apart
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
// <dispatch>/../ledger.jsonl (the project's ledger across runs). Both are append-only. Nothing
// in the flow reads its own narrative back to learn from it; it reads these lines.
//
//   exit 0  written to both files
//   exit 1  usage, an action outside the set, a finding with no class, a tool-fault missing a
//           field or naming no postmaster file, or a file could not be appended
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { scriptsDir, toolRoot } from "./lib/paths.ts";
import { run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

const VERBS =
  " dispatch resume harvest synthesize review-launch review-harvest finding apply escalate rule ticket-check ticket-create ticket-edit ticket-state ticket-comment gate verify merge teardown degrade handoff-accept handoff stage tool-fault note ";
const CONTROLS = join(toolRoot(import.meta), "skills/postmaster/controls.md");

// JSON string escaping: drop control chars, drop non-UTF8, escape separators
function jsonStr(s: string): string {
  // Drop control characters (except those we escape below) and U+FFFD (non-UTF8 bytes)
  let result = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 && ch !== "\n" && ch !== "\r" && ch !== "\t") continue;
    if (ch === "\uFFFD") continue; // drop replacement chars (non-UTF8 bytes)
    result += ch;
  }
  // Escape backslash, quote, newline, CR, tab, and Unicode separators
  result = result
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
    .replace(/\u0085/g, "\\u0085");
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
    if (val.replace(/\s/g, "") === "") {
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
    for (const line of text.split("\n")) {
      const m = /^\s*\|\s*`([^`]*)`\s*\|\s*(\S+)\s*\|/.exec(line);
      if (m?.[2]) kinds.push(m[2].trim());
    }
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
    for (const line of text.split("\n")) {
      const m = /^\s*\|\s*`([^`]*)`\s*\|\s*(\S+)\s*\|/.exec(line);
      if (!m) continue;
      const pathPart = (m[1] ?? "").replace(/`/g, "").trim();
      const kind = (m[2] ?? "").trim();
      if (pathPart === t || pathPart === `<tool>/${t}`) {
        control = kind;
        break;
      }
    }
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
    const firstWord = detail.split(/\s+/)[0] ?? "";
    if (firstWord !== "gating" && firstWord !== "style") {
      console.error("log-action: a finding's detail opens with its class, gating or style");
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
  const project = basename(dirname(dispatchReal));
  const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");

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

// --- entry ------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv[0] !== "--self-test") {
  if (argv.length < 4 || !argv[0] || !argv[1] || !argv[2] || !argv[3]) {
    console.error(
      "usage: log-action.sh <dispatch-dir> <actor> <action> <target> [detail...] | --self-test",
    );
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

// --- self-test ----------------------------------------------------------------------------
const TOOL = toolRoot(import.meta);
withTempDir((tmp) => {
  const d = join(tmp, "project", "RUN-1");
  mkdirSync(d, { recursive: true });
  const SELF = join(scriptsDir(import.meta), "log-action.sh");
  const st = new SelfTest();

  const lines = (): number => {
    try {
      return readFileSync(join(d, "actions.jsonl"), "utf8")
        .split("\n")
        .filter((l) => l !== "").length;
    } catch {
      return 0;
    }
  };
  const lastLine = (): Record<string, any> | null => {
    try {
      const all = readFileSync(join(d, "actions.jsonl"), "utf8")
        .split("\n")
        .filter((l) => l !== "");
      return all.length > 0 ? JSON.parse(all[all.length - 1]!) : null;
    } catch {
      return null;
    }
  };

  let lastErr = "";
  const wrote = (label: string, ...args: string[]): void => {
    const before = lines();
    const r = run("bash", [SELF, d, ...args]);
    lastErr = r.err;
    if (r.code === 0 && lines() === before + 1) st.ok(label);
    else st.fail(`${label} (exit ${r.code})`, r.err);
  };

  const refused = (label: string, why: string, ...args: string[]): void => {
    const before = lines();
    const r = run("bash", [SELF, d, "coachman", ...args]);
    if (r.code === 1 && lines() === before && r.err.includes(why)) st.ok(label);
    else st.fail(`${label}: wanted exit 1 with "${why}" and no line, got exit ${r.code}`, r.err);
  };

  const FIELDS = [
    "--ran",
    "scripts/wait-for-markers.sh <dispatch>/logs 'r1-*.done' 2 60",
    "--failed",
    "returned before every marker was in",
    "--error",
    "exit 0\n\tall 2 markers present, \x1b[1mone a directory\x1b[0m",
    "--diagnosis",
    "find counts directories",
    "--fix",
    "count regular files only",
  ];

  // Setup symlink and outside file
  run("bash", ["-c", `ln -s "${TOOL}" "${join(tmp, "link")}" && : > "${join(tmp, "outside.sh")}"`]);

  console.log("positive controls");
  wrote("an action is written", "postmaster", "note", "RUN-1", "a plain", '"detail"');

  // Check ledger matches
  const actionsContent = readFileSync(join(d, "actions.jsonl"), "utf8");
  const ledgerContent = readFileSync(join(tmp, "project", "ledger.jsonl"), "utf8");
  if (actionsContent === ledgerContent)
    st.ok("as one line in the run's log and the same line in the ledger");
  else st.fail("as one line in the run's log and the same line in the ledger");

  const last = lastLine();
  if (
    last &&
    last.detail === 'a plain "detail"' &&
    last.project === "project" &&
    last.run === "RUN-1" &&
    !last.fault
  ) {
    st.ok("the detail is everything after the target");
  } else {
    st.fail("the detail is everything after the target", JSON.stringify(last));
  }

  wrote(
    "a tool-fault with every field is written",
    "coachman",
    "tool-fault",
    "scripts/launch.sh",
    ...FIELDS,
    "--workaround",
    "launched in the recorded form by hand",
  );

  const last2 = lastLine();
  if (
    last2 &&
    last2.action === "tool-fault" &&
    last2.target === "scripts/launch.sh" &&
    last2.detail === "returned before every marker was in" &&
    last2.fault?.failed === "returned before every marker was in" &&
    last2.fault?.error === "exit 0\n\tall 2 markers present, [1mone a directory[0m" &&
    String(last2.fault?.workaround ?? "").startsWith("launched") &&
    last2.fault?.control === ""
  ) {
    st.ok("its fields are a fault object, with --failed as the detail and the error whole");
  } else {
    st.fail(
      "its fields are a fault object, with --failed as the detail and the error whole",
      JSON.stringify(last2),
    );
  }
  if (lastErr.trim() === "") st.ok("and a part that is no control says nothing");
  else st.fail("and a part that is no control says nothing", lastErr);

  wrote(
    "a listed script named by its absolute path is written",
    "coachman",
    "tool-fault",
    join(TOOL, "scripts/log-action.sh"),
    ...FIELDS,
    "--failed",
    "first",
  );
  const last3 = lastLine();
  if (
    last3 &&
    last3.fault?.failed === "first" &&
    last3.target === "scripts/log-action.sh" &&
    last3.fault?.control === "action-log"
  ) {
    st.ok("as a control of its kind, relative to the checkout");
  } else {
    st.fail("as a control of its kind, relative to the checkout", JSON.stringify(last3));
  }
  if (lastErr.includes("scripts/log-action.sh is a control (action-log): stop the leg"))
    st.ok("and the message says to stop");
  else st.fail("and the message says to stop", lastErr);

  wrote(
    "a listed script with another --control is written",
    "coachman",
    "tool-fault",
    "scripts/log-action.sh",
    ...FIELDS,
    "--failed",
    "second",
    "--control",
    "gate",
  );
  const last4 = lastLine();
  if (last4 && last4.fault?.failed === "second" && last4.fault?.control === "action-log") {
    st.ok("with the list's kind");
  } else {
    st.fail("with the list's kind", JSON.stringify(last4));
  }

  wrote(
    "a runbook step with --control is written",
    "coachman",
    "tool-fault",
    "skills/postmaster/coachman.md",
    ...FIELDS,
    "--failed",
    "third",
    "--control",
    "wait",
  );
  const last5 = lastLine();
  if (
    last5 &&
    last5.fault?.failed === "third" &&
    last5.target === "skills/postmaster/coachman.md" &&
    last5.fault?.control === "wait"
  ) {
    st.ok("with the kind --control gives");
  } else {
    st.fail("with the kind --control gives", JSON.stringify(last5));
  }

  wrote(
    "another spelling of a listed path is written",
    "coachman",
    "tool-fault",
    "scripts//./wait-for-markers.sh",
    ...FIELDS,
    "--failed",
    "fourth",
  );
  const last6 = lastLine();
  if (
    last6 &&
    last6.fault?.failed === "fourth" &&
    last6.target === "scripts/wait-for-markers.sh" &&
    last6.fault?.control === "wait"
  ) {
    st.ok("as that path, and that control");
  } else {
    st.fail("as that path, and that control", JSON.stringify(last6));
  }

  wrote(
    "a path through .. that stays in the checkout is written",
    "coachman",
    "tool-fault",
    "scripts/../scripts/log-action.sh",
    ...FIELDS,
    "--failed",
    "fifth",
  );
  const last7 = lastLine();
  if (
    last7 &&
    last7.fault?.failed === "fifth" &&
    last7.target === "scripts/log-action.sh" &&
    last7.fault?.control === "action-log"
  ) {
    st.ok("as the file it reaches");
  } else {
    st.fail("as the file it reaches", JSON.stringify(last7));
  }

  wrote(
    "a path through a link to the checkout is written",
    "coachman",
    "tool-fault",
    join(tmp, "link/scripts/launch.sh"),
    ...FIELDS,
    "--failed",
    "sixth",
  );
  const last8 = lastLine();
  if (last8 && last8.fault?.failed === "sixth" && last8.target === "scripts/launch.sh") {
    st.ok("as the real path");
  } else {
    st.fail("as the real path", JSON.stringify(last8));
  }

  wrote(
    "a style finding is written",
    "coachman",
    "finding",
    "src/a.ts:12",
    "style P3 r1 style luna reading: a list named map",
  );
  const last9 = lastLine();
  if (last9 && last9.action === "finding" && String(last9.detail).split(" ")[0] === "style") {
    st.ok("with its class as the first word of its detail");
  } else {
    st.fail("with its class as the first word of its detail", JSON.stringify(last9));
  }

  wrote(
    "a gating finding is written",
    "coachman",
    "finding",
    "src/b.ts:40",
    "gating P1 r1 bug luna execution: an off-by-one",
  );
  wrote("a detail ending in a newline is written", "postmaster", "note", "RUN-1", "kept whole\n");
  const last10 = lastLine();
  if (last10 && last10.detail === "kept whole\n") {
    st.ok("with its newline");
  } else {
    st.fail("with its newline", JSON.stringify(last10));
  }

  wrote(
    "a line separator and a byte that is not UTF-8 are written",
    "postmaster",
    "note",
    "RUN-1",
    "one\u2028two \uFFFD three",
  );
  const last11 = lastLine();
  if (last11 && last11.detail === "one\u2028two  three") {
    st.ok("the separator escaped and the byte dropped");
  } else {
    st.fail("the separator escaped and the byte dropped", JSON.stringify(last11));
  }

  // Verify every line is valid JSON and files match
  try {
    const text = readFileSync(join(d, "actions.jsonl"), "utf8");
    const rows = text.split("\n").filter((l) => l !== "");
    for (const r of rows) JSON.parse(r);
    const led = readFileSync(join(tmp, "project", "ledger.jsonl"), "utf8");
    if (text === led) st.ok("every line in both files is UTF-8 JSON, one to a line");
    else st.fail("every line in both files is UTF-8 JSON, one to a line");
  } catch (e) {
    st.fail("every line in both files is UTF-8 JSON, one to a line", String(e));
  }

  console.log("negative controls: nothing is written");
  refused("an action outside the set", "is not an action", "tool-faults", "scripts/launch.sh", "x");
  refused("an empty target", "usage:", "note", "");
  refused(
    "a finding with no class",
    "opens with its class, gating or style",
    "finding",
    "src/c.ts:7",
    "P2 r1 bug luna reading: no class",
  );
  refused(
    "a finding whose class is another word",
    "opens with its class, gating or style",
    "finding",
    "src/c.ts:7",
    "advisory P3 r1 style luna reading",
  );
  refused(
    "a tool-fault with no fix",
    "needs --fix",
    "tool-fault",
    "scripts/launch.sh",
    ...FIELDS.slice(0, 8),
  );
  refused(
    "a tool-fault with a blank diagnosis",
    "needs --diagnosis",
    "tool-fault",
    "scripts/launch.sh",
    ...FIELDS,
    "--diagnosis",
    "  ",
  );
  refused(
    "a tool-fault as plain words",
    "a tool-fault takes",
    "tool-fault",
    "scripts/launch.sh",
    "the",
    "wait",
    "returned",
    "early",
  );
  refused(
    "a flag with no value",
    "--workaround needs a value",
    "tool-fault",
    "scripts/launch.sh",
    ...FIELDS,
    "--workaround",
  );
  refused(
    "a file postmaster does not have",
    "names the postmaster file",
    "tool-fault",
    "src/app.ts",
    ...FIELDS,
  );
  refused(
    "a file outside the checkout",
    "names the postmaster file",
    "tool-fault",
    join(tmp, "outside.sh"),
    ...FIELDS,
  );
  refused(
    "a path that climbs out of the checkout to a file",
    "names the postmaster file",
    "tool-fault",
    relative(TOOL, join(tmp, "outside.sh")),
    ...FIELDS,
  );
  refused(
    "an unknown kind of control",
    "is not a kind of control",
    "tool-fault",
    "skills/postmaster/coachman.md",
    ...FIELDS,
    "--control",
    "vibes",
  );
  refused(
    "two kinds of control in one",
    "is not a kind of control",
    "tool-fault",
    "skills/postmaster/coachman.md",
    ...FIELDS,
    "--control",
    "gate marker",
  );

  // Missing dispatch directory
  const r = run("bash", [SELF, join(tmp, "nowhere"), "coachman", "note", "x", "y"]);
  if (r.code === 1 && r.err.includes(`no such dir: ${join(tmp, "nowhere")}`)) {
    st.ok("a missing dispatch directory is refused, and named");
  } else {
    st.fail(`a missing dispatch directory is refused, and named (exit ${r.code})`, r.err);
  }

  st.finish();
});
