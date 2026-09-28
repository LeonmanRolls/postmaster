import { appendFileSync, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { scriptDir, writeError, writeOut } from "./lib/core.ts";

const here = scriptDir(import.meta.url);
const tool = dirname(here);
const controlsFile = join(tool, "skills", "postmaster", "controls.md");
const verbs = new Set(
  "dispatch resume harvest synthesize review-launch review-harvest finding apply escalate rule ticket-check ticket-create ticket-edit ticket-state ticket-comment gate verify merge teardown degrade handoff-accept handoff stage tool-fault note".split(
    " ",
  ),
);
const usage = "usage: log-action.sh <dispatch-dir> <actor> <action> <target> [detail...] | --self-test";
function clean(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.codePointAt(0)!;
      return !(
        code <= 8 ||
        code === 11 ||
        code === 12 ||
        (code >= 14 && code <= 31) ||
        code === 127 ||
        code === 0xfffd
      );
    })
    .join("");
}
function controlData(): { kinds: Set<string>; scripts: Map<string, string> } {
  const kinds = new Set<string>();
  const scripts = new Map<string, string>();
  if (!existsSync(controlsFile)) return { kinds, scripts };
  for (const line of readFileSync(controlsFile, "utf8").split(/\r?\n/)) {
    const fields = line.split("|").map((part: string) => part.trim());
    if (fields.length < 4 || !fields[1].includes("`")) continue;
    const pathMatch = /`(?:<tool>\/)?([^`]+)`/.exec(fields[1]);
    const kind = fields[2].replaceAll("`", "").trim();
    if (pathMatch && kind) {
      scripts.set(pathMatch[1], kind);
      kinds.add(kind);
    }
  }
  for (const line of readFileSync(controlsFile, "utf8").split(/\r?\n/)) {
    if (!line.trimStart().startsWith("| `")) continue;
    const fields = line.split("|").map((part: string) => part.trim());
    if (fields.length >= 3) {
      const kind = fields[2].replaceAll("`", "").trim();
      if (kind) kinds.add(kind);
    }
  }
  return { kinds, scripts };
}
function resolveToolFile(given: string): string | null {
  let full = resolve(isAbsolute(given) ? given : join(tool, given));
  try {
    full = realpathSync(full);
  } catch {
    return null;
  }
  const rel = relative(tool, full);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  try {
    if (!statSync(full).isFile()) return null;
  } catch {
    return null;
  }
  return rel.split(sep).join("/");
}
type Fault = {
  ran: string;
  failed: string;
  error: string;
  diagnosis: string;
  fix: string;
  workaround: string;
  control: string;
};
function faultTarget(
  given: string,
  rawArgs: string[],
): { target: string; detail: string; fault: Fault; warning?: string } | { error: string } {
  const values: Record<string, string> = {
    ran: "",
    failed: "",
    error: "",
    diagnosis: "",
    fix: "",
    workaround: "",
    control: "",
  };
  const allowed = new Set(["--ran", "--failed", "--error", "--diagnosis", "--fix", "--workaround", "--control"]);
  for (let index = 0; index < rawArgs.length; index += 2) {
    const key = rawArgs[index];
    const value = rawArgs[index + 1];
    if (value === undefined) return { error: `log-action: ${key} needs a value` };
    if (!allowed.has(key))
      return {
        error: `log-action: a tool-fault takes --ran --failed --error --diagnosis --fix [--workaround] [--control], not '${key}'`,
      };
    values[key.slice(2)] = value;
  }
  for (const key of ["ran", "failed", "error", "diagnosis", "fix"]) {
    if (!values[key].replace(/\s/g, ""))
      return { error: `log-action: a tool-fault needs --${key} (the error may be 'none')` };
  }
  const path = resolveToolFile(given);
  if (!path)
    return {
      error: `log-action: a tool-fault names the postmaster file that misbehaved, in ${tool}; '${given}' is not one`,
    };
  const controls = controlData();
  if (values.control && !controls.kinds.has(values.control)) {
    return {
      error: `log-action: '${values.control}' is not a kind of control in ${controlsFile}: ${[...controls.kinds].sort().join(" ")}`,
    };
  }
  if (controls.scripts.has(path)) values.control = controls.scripts.get(path)!;
  const warning = values.control
    ? `log-action: ${path} is a control (${values.control}): stop the leg and escalate; never work around it`
    : undefined;
  return { target: path, detail: values.failed, fault: values as Fault, warning };
}
type Event = {
  ts: string;
  project: string;
  run: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
  fault?: Fault;
};
function logAction(args: string[], quiet = false): { code: number; event?: Event; error?: string; warning?: string } {
  if (args.length < 4 || args.slice(0, 4).some((value) => !value)) {
    if (!quiet) writeError(usage);
    return { code: 1, error: usage };
  }
  const [given, actor, action, rawTarget, ...detailArgs] = args;
  let target = rawTarget;
  let detail = detailArgs.join(" ");
  let fault: Fault | undefined;
  if (!verbs.has(action)) {
    const error = `log-action: '${action}' is not an action in the set: ${[...verbs].join(" ")}`;
    if (!quiet) writeError(error);
    return { code: 1, error };
  }
  if (action === "finding" && !["gating", "style"].includes(detail.split(" ")[0])) {
    const error = "log-action: a finding's detail opens with its class, gating or style";
    if (!quiet) writeError(error);
    return { code: 1, error };
  }
  if (action === "tool-fault") {
    const parsed = faultTarget(rawTarget, detailArgs);
    if ("error" in parsed) {
      if (!quiet) writeError(parsed.error);
      return { code: 1, error: parsed.error };
    }
    target = parsed.target;
    detail = parsed.detail;
    fault = parsed.fault;
    if (parsed.warning && !quiet) writeError(parsed.warning);
  }
  let dispatch: string;
  try {
    dispatch = realpathSync(given);
    if (!statSync(dispatch).isDirectory()) throw new Error();
  } catch {
    const error = `log-action: no such dir: ${given}`;
    if (!quiet) writeError(error);
    return { code: 1, error };
  }
  const event: Event = {
    ts: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    project: clean(basename(dirname(dispatch))),
    run: clean(basename(dispatch)),
    actor: clean(actor),
    action: clean(action),
    target: clean(target),
    detail: clean(detail),
    ...(fault
      ? { fault: Object.fromEntries(Object.entries(fault).map(([key, value]) => [key, clean(value)])) as Fault }
      : {}),
  };
  const line = `${JSON.stringify(event)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
    .replace(/\u0085/g, "\\u0085")}\n`;
  try {
    appendFileSync(join(dispatch, "actions.jsonl"), line);
  } catch {
    const error = `log-action: cannot append to ${join(dispatch, "actions.jsonl")}`;
    if (!quiet) writeError(error);
    return { code: 1, error };
  }
  try {
    appendFileSync(join(dispatch, "..", "ledger.jsonl"), line);
  } catch {
    const error = "log-action: cannot append to the project ledger";
    if (!quiet) writeError(error);
    return { code: 1, error };
  }
  return {
    code: 0,
    event,
    warning:
      action === "tool-fault"
        ? controlData().scripts.get(target)
          ? `log-action: ${target} is a control (${controlData().scripts.get(target)}): stop the leg and escalate; never work around it`
          : fault?.control
            ? `log-action: ${target} is a control (${fault.control}): stop the leg and escalate; never work around it`
            : undefined
        : undefined,
  };
}

function selfTest(): number {
  const temp = mkdtempSync(join(tmpdir(), "log-action-"));
  const directory = join(temp, "project", "RUN-1");
  mkdirSync(directory, { recursive: true });
  const toolLink = join(temp, "link");
  symlinkSync(tool, toolLink);
  const outside = join(temp, "outside.sh");
  writeFileSync(outside, "");
  let fails = 0;
  const ok = (label: string) => writeOut(`  ok   ${label}`);
  const fail = (label: string) => {
    writeOut(`  FAIL ${label}`);
    fails++;
  };
  const rows = () =>
    existsSync(join(directory, "actions.jsonl"))
      ? readFileSync(join(directory, "actions.jsonl"), "utf8").trimEnd().split("\n").filter(Boolean)
      : [];
  const call = (label: string, args: string[], valid = true): { event?: Event; warning?: string; error?: string } => {
    const before = rows().length;
    const result = logAction([directory, ...args], true);
    if (valid && result.code === 0 && rows().length === before + 1) ok(label);
    else {
      fail(label);
      return { error: result.error };
    }
    return { event: result.event, warning: result.warning, error: result.error };
  };
  const last = (label: string, predicate: (event: Event) => boolean) => {
    try {
      predicate(JSON.parse(rows().at(-1)!) as Event) ? ok(label) : fail(label);
    } catch {
      fail(label);
    }
  };
  const fields = [
    "--ran",
    "scripts/wait-for-markers.sh <dispatch>/logs 'r1-*.done' 2 60",
    "--failed",
    "returned before every marker was in",
    "--error",
    "exit 0\n\tall 2 markers present, \u001b[1mone a directory\u001b[0m",
    "--diagnosis",
    "find counts directories",
    "--fix",
    "count regular files only",
  ];
  try {
    writeOut("positive controls");
    call("an action is written", ["postmaster", "note", "RUN-1", "a", "plain", '"detail"']);
    const first = JSON.parse(rows()[0]) as Event;
    rows().join("\n") === readFileSync(join(temp, "project", "ledger.jsonl"), "utf8").trimEnd()
      ? ok("as one line in the run's log and the same line in the ledger")
      : fail("as one line in the run's log and the same line in the ledger");
    first.detail === 'a plain "detail"' && first.project === "project" && first.run === "RUN-1" && !first.fault
      ? ok("the detail is everything after the target")
      : fail("the detail is everything after the target");
    const ordinaryFault = call("a tool-fault with every field is written", [
      "coachman",
      "tool-fault",
      "scripts/launch.sh",
      ...fields,
      "--workaround",
      "launched in the recorded form by hand",
    ]);
    !ordinaryFault.warning
      ? ok("and a part that is no control says nothing")
      : fail("and a part that is no control says nothing");
    last(
      "its fields are a fault object, with --failed as the detail and the error whole",
      (e) =>
        e.action === "tool-fault" &&
        e.target === "scripts/launch.sh" &&
        e.detail === e.fault?.failed &&
        e.fault?.error === "exit 0\n\tall 2 markers present, [1mone a directory[0m" &&
        e.fault?.workaround.startsWith("launched") &&
        e.fault?.control === "",
    );
    const controlFault = call("a listed script named by its absolute path is written", [
      "coachman",
      "tool-fault",
      join(tool, "scripts/log-action.sh"),
      ...fields,
      "--failed",
      "first",
    ]);
    last(
      "as a control of its kind, relative to the checkout",
      (e) => e.fault?.failed === "first" && e.target === "scripts/log-action.sh" && e.fault?.control === "action-log",
    );
    controlFault.warning?.includes("scripts/log-action.sh is a control (action-log): stop the leg")
      ? ok("and the message says to stop")
      : fail("and the message says to stop");
    call("a listed script with another --control is written", [
      "coachman",
      "tool-fault",
      "scripts/log-action.sh",
      ...fields,
      "--failed",
      "second",
      "--control",
      "gate",
    ]);
    last("with the list's kind", (e) => e.fault?.failed === "second" && e.fault?.control === "action-log");
    call("a runbook step with --control is written", [
      "coachman",
      "tool-fault",
      "skills/postmaster/coachman.md",
      ...fields,
      "--failed",
      "third",
      "--control",
      "wait",
    ]);
    last(
      "with the kind --control gives",
      (e) => e.fault?.failed === "third" && e.target === "skills/postmaster/coachman.md" && e.fault?.control === "wait",
    );
    call("another spelling of a listed path is written", [
      "coachman",
      "tool-fault",
      "scripts//./wait-for-markers.sh",
      ...fields,
      "--failed",
      "fourth",
    ]);
    last(
      "as that path, and that control",
      (e) => e.fault?.failed === "fourth" && e.target === "scripts/wait-for-markers.sh" && e.fault?.control === "wait",
    );
    call("a path through .. that stays in the checkout is written", [
      "coachman",
      "tool-fault",
      "scripts/../scripts/log-action.sh",
      ...fields,
      "--failed",
      "fifth",
    ]);
    last(
      "as the file it reaches",
      (e) => e.fault?.failed === "fifth" && e.target === "scripts/log-action.sh" && e.fault?.control === "action-log",
    );
    call("a path through a link to the checkout is written", [
      "coachman",
      "tool-fault",
      join(toolLink, "scripts/launch.sh"),
      ...fields,
      "--failed",
      "sixth",
    ]);
    last("as the real path", (e) => e.fault?.failed === "sixth" && e.target === "scripts/launch.sh");
    call("a style finding is written", [
      "coachman",
      "finding",
      "src/a.ts:12",
      "style",
      "P3",
      "r1",
      "style",
      "luna",
      "reading:",
      "a list named map",
    ]);
    last(
      "with its class as the first word of its detail",
      (e) => e.action === "finding" && e.detail.split(/\s+/)[0] === "style",
    );
    call("a gating finding is written", [
      "coachman",
      "finding",
      "src/b.ts:40",
      "gating",
      "P1",
      "r1",
      "bug",
      "luna",
      "reading:",
      "an off-by-one",
    ]);
    const newline = "kept whole\n";
    call("a detail ending in a newline is written", ["postmaster", "note", "RUN-1", newline]);
    last("with its newline", (e) => e.detail === newline);
    call("a line separator and a byte that is not UTF-8 are written", [
      "postmaster",
      "note",
      "RUN-1",
      "one\u2028two \ufffd three",
    ]);
    last("the separator escaped and the byte dropped", (e) => e.detail === "one\u2028two  three");
    const validJson = rows().every((line: string) => JSON.parse(line) && !line.includes("\u2028"));
    validJson &&
    rows().length ===
      readFileSync(join(temp, "project", "ledger.jsonl"), "utf8")
        .trimEnd()
        .split("\n").length
      ? ok("every line in both files is UTF-8 JSON, one to a line")
      : fail("every line in both files is UTF-8 JSON, one to a line");
    writeOut("negative controls: nothing is written");
    const refused = (label: string, expected: string, args: string[]) => {
      const before = rows().length;
      const result = logAction([directory, "coachman", ...args], true);
      result.code === 1 && rows().length === before && (result.error ?? "").includes(expected)
        ? ok(label)
        : fail(label);
    };
    refused("an action outside the set", "is not an action", ["tool-faults", "scripts/launch.sh", "x"]);
    refused("an empty target", "usage:", ["note", "", "x"]);
    refused("a finding with no class", "opens with its class, gating or style", [
      "finding",
      "src/c.ts:7",
      "P2",
      "r1",
      "bug",
      "luna",
      "reading:",
      "no class",
    ]);
    refused("a finding whose class is another word", "opens with its class, gating or style", [
      "finding",
      "src/c.ts:7",
      "advisory",
      "P3",
      "r1",
      "style",
      "luna",
      "reading",
    ]);
    refused("a tool-fault with no fix", "needs --fix", ["tool-fault", "scripts/launch.sh", ...fields.slice(0, 8)]);
    refused("a tool-fault with a blank diagnosis", "needs --diagnosis", [
      "tool-fault",
      "scripts/launch.sh",
      ...fields,
      "--diagnosis",
      "  ",
    ]);
    refused("a tool-fault as plain words", "a tool-fault takes", [
      "tool-fault",
      "scripts/launch.sh",
      "the",
      "wait",
      "returned",
      "early",
    ]);
    refused("a flag with no value", "--workaround needs a value", [
      "tool-fault",
      "scripts/launch.sh",
      ...fields,
      "--workaround",
    ]);
    refused("a file postmaster does not have", "names the postmaster file", ["tool-fault", "src/app.ts", ...fields]);
    refused("a file outside the checkout", "names the postmaster file", ["tool-fault", outside, ...fields]);
    const outsideRelative = relative(tool, outside);
    refused("a path that climbs out of the checkout to a file", "names the postmaster file", [
      "tool-fault",
      outsideRelative,
      ...fields,
    ]);
    refused("an unknown kind of control", "is not a kind of control", [
      "tool-fault",
      "skills/postmaster/coachman.md",
      ...fields,
      "--control",
      "vibes",
    ]);
    refused("two kinds of control in one", "is not a kind of control", [
      "tool-fault",
      "skills/postmaster/coachman.md",
      ...fields,
      "--control",
      "gate marker",
    ]);
    logAction([join(temp, "nowhere"), "coachman", "note", "x", "y"], true).code === 1
      ? ok("a missing dispatch directory is refused, and named")
      : fail("a missing dispatch directory is refused, and named");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  writeOut("");
  writeOut(fails === 0 ? "self-test: all controls behaved" : `self-test: ${fails} control(s) misbehaved`);
  return fails === 0 ? 0 : 1;
}

import { join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--self-test") process.exit(selfTest());
if (args.length < 4 || args.slice(0, 4).some((value) => !value)) {
  writeError(usage);
  process.exit(1);
}
const result = logAction(args);
process.exit(result.code);
