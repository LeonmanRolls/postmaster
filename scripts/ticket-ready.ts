// Say whether a ticket is ready to run: it passes both ticket checks and carries a ready mark.
// The checks show the ticket is well formed; only the mark shows the user signed it off.
//
//   ticket-ready.sh <repo> <id>                      through the adapter of the kind the repo uses
//   ticket-ready.sh --body <file> --labels <list>    a body file and a comma-separated label list,
//                                                    as a tracker of kind `other` is checked
//   ticket-ready.sh mark <repo> <id>                 mark the ticket ready: add the ready label
//                                                    only when both checks pass, log a note in
//                                                    the project's ledger with the ticket's
//                                                    turnpikes line as the user's word, and write
//                                                    a ready marker under the project's run root
//   ticket-ready.sh mark --body <file> --labels <list> --repo <repo> --id <id>
//                                                    mark a ticket of kind `other`
//   ticket-ready.sh unmark <repo> <id>               remove the ready label and its marker
//
// Readiness runs `ticket-check` and `ticket-parts --final` on the body every time and reads the
// labels, so every reason shows. It does not look at the ticket's state: a ticket with a run in
// flight still meets the clash check. A DRAFT: first line fails the parts check under --final.
//
//   exit 0  ready (check), or marked (mark/unmark)
//   exit 2  not ready: one line per reason on stdout (check), or the checks refused the mark
//   exit 1  cannot read the ticket or its labels, or a usage error
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

const HERE = scriptsDir(import.meta);

function die(msg: string, code = 1): never {
  console.error(`ticket-ready: ${msg}`);
  process.exit(code);
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

interface TicketRead {
  title: string;
  body: string;
  labels: string[];
  id: string;
}

function parseRead(readOut: string, fallbackId: string): TicketRead {
  const head = readOut.indexOf("\n\n");
  const header = head >= 0 ? readOut.slice(0, head) : readOut;
  const body = head >= 0 ? readOut.slice(head + 2) : "";
  const fields: Record<string, string> = {};
  for (const line of header.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) fields[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return {
    title: fields.title ?? "",
    body: body.replace(/\n## Log\n[\s\S]*$/u, ""),
    labels: (fields.labels ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== ""),
    id: fields.id ?? fallbackId,
  };
}

function readThroughAdapter(repo: string, id: string): TicketRead {
  const kindR = run(join(HERE, "tracker-kind.sh"), [repo]);
  if (kindR.code !== 0) {
    process.stderr.write(kindR.err);
    die(`cannot read ${id}: tracker-kind.sh failed`, 1);
  }
  const kind = kindR.out.trim();
  let readOut = "";
  let readCode = 0;
  if (kind === "github") {
    const r = run(join(HERE, "github.sh"), [repo, "read", id]);
    readOut = r.out;
    readCode = r.code;
  } else if (kind === "plane") {
    const r = run(join(HERE, "plane.sh"), ["read", id]);
    readOut = r.out;
    readCode = r.code;
  } else if (kind === "local") {
    const r = run(join(HERE, "local.sh"), [repo, "read", id]);
    readOut = r.out;
    readCode = r.code;
  } else {
    die(
      `tracker kind '${kind}' has no adapter script; check it with --body <file> --labels <list>`,
      1,
    );
  }
  if (readCode !== 0) die(`the ${kind} adapter could not read ${id} (exit ${readCode})`, 1);
  return parseRead(readOut, id);
}

function hasDraftLine(body: string): boolean {
  const first = body.split("\n").find((l) => l.trim() !== "");
  return first !== undefined && /^DRAFT:/iu.test(first.trim());
}

function runChecks(ticket: TicketRead, project: string): string[] {
  const reasons: string[] = [];
  if (!ticket.labels.some((l) => l.toLowerCase() === "ready")) {
    reasons.push("no ready label: the user has not signed it off");
  }
  if (hasDraftLine(ticket.body)) {
    reasons.push("the first line is a DRAFT line");
  }
  const dir = mkdtempSync(join(tmpdir(), "ticket-ready-"));
  const bodyPath = join(dir, "body.md");
  try {
    writeFileSync(bodyPath, ticket.body, "utf8");
    const checkR = run(join(HERE, "ticket-check.sh"), [
      "--body",
      bodyPath,
      ...(ticket.title ? ["--title", ticket.title] : []),
      ...(project ? ["--project", project] : []),
    ]);
    if (checkR.code !== 0) {
      const lines = (checkR.out + checkR.err)
        .trim()
        .split("\n")
        .filter((l) => l !== "");
      if (lines.length === 0) reasons.push("ticket-check failed");
      else for (const l of lines) reasons.push(`ticket-check: ${l}`);
    }
    const partsR = run(join(HERE, "ticket-parts.sh"), ["--final", bodyPath]);
    if (partsR.code !== 0) {
      const lines = (partsR.out + partsR.err)
        .trim()
        .split("\n")
        .filter((l) => l !== "");
      if (lines.length === 0) reasons.push("ticket-parts --final failed");
      else for (const l of lines) reasons.push(`ticket-parts: ${l}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return reasons;
}

function writeReadyMarker(project: string, id: string): void {
  const runs = join(project, ".postmaster", "runs");
  mkdirSync(runs, { recursive: true });
  writeFileSync(join(runs, `.ready-${id.replace(/^#/u, "")}`), `${id}\n`, "utf8");
}

function removeReadyMarker(project: string, id: string): void {
  try {
    rmSync(join(project, ".postmaster", "runs", `.ready-${id.replace(/^#/u, "")}`), {
      force: true,
    });
  } catch {
    /* nothing to remove */
  }
}

function logNote(project: string, id: string, turnpikes: string): void {
  const ledger = join(project, ".postmaster", "runs", "ledger.jsonl");
  mkdirSync(dirname(ledger), { recursive: true });
  const ts = new Date().toISOString().replace(/\.[0-9]{3}Z$/u, "Z");
  appendFileSync(
    ledger,
    `${JSON.stringify({
      ts,
      project,
      run: "",
      actor: "postmaster",
      action: "note",
      target: id,
      detail: `user's word on turnpikes: ${turnpikes}`,
    })}\n`,
    "utf8",
  );
}

function turnpikesLine(body: string): string {
  const m = /^##\s*Turnpikes\s*$/imu.exec(body);
  if (!m) return "turnpikes: none";
  const after = body.slice(m.index + m[0].length);
  const next = /^##\s/imu.exec(after);
  const section = next ? after.slice(0, next.index) : after;
  const words = section
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"))
    .join(" ");
  const names = words
    .replace(/[.,;:]$/u, "")
    .split(/\s+/u)
    .filter((w) => w !== "");
  if (names.length === 0 || names.every((w) => w.toLowerCase() === "none"))
    return "turnpikes: none";
  return `turnpikes: ${names.join(", ")}`;
}

function kindOf(repo: string): string {
  const kindR = run(join(HERE, "tracker-kind.sh"), [repo]);
  if (kindR.code !== 0) {
    process.stderr.write(kindR.err);
    die("tracker-kind.sh failed", 1);
  }
  return kindR.out.trim();
}

function labelViaAdapter(repo: string, id: string, kind: string, verb: "add" | "remove"): void {
  const r =
    kind === "plane"
      ? run(join(HERE, "plane.sh"), ["label", id, verb, "ready"])
      : kind === "github"
        ? run(join(HERE, "github.sh"), [repo, "label", id, verb, "ready"])
        : kind === "local"
          ? run(join(HERE, "local.sh"), [repo, "label", id, verb, "ready"])
          : null;
  if (r === null) die(`tracker kind '${kind}' has no adapter script for label`, 1);
  if (r.code !== 0) {
    process.stderr.write(r.err);
    die(`could not ${verb} the ready label on ${id}`, 1);
  }
}

function markReady(
  ticket: TicketRead,
  project: string,
  repo: string,
  id: string,
  kind: string,
): number {
  const reasons = runChecks(ticket, project).filter((r) => !r.startsWith("no ready label"));
  if (reasons.length > 0) {
    for (const r of reasons) console.log(r);
    return 2;
  }
  labelViaAdapter(repo, id, kind, "add");
  logNote(project, id, turnpikesLine(ticket.body));
  writeReadyMarker(project, id);
  console.log(`${id}: ready`);
  return 0;
}

function main(argv: string[]): number {
  const cmd = argv[0] ?? "";
  if (cmd === "unmark") {
    if (argv.length !== 3) die("usage: ticket-ready.sh unmark <repo> <id>", 1);
    const repo = argv[1]!;
    const id = argv[2]!;
    if (!isDir(repo)) die(`no such project directory: ${repo}`, 1);
    const kind = kindOf(repo);
    labelViaAdapter(repo, id, kind, "remove");
    removeReadyMarker(resolve(repo), id);
    console.log(`${id}: label remove ready`);
    return 0;
  }
  if (cmd === "mark") {
    const rest = argv.slice(1);
    if (rest.length === 2 && !rest[0]!.startsWith("--")) {
      const repo = rest[0]!;
      const id = rest[1]!;
      if (!isDir(repo)) die(`no such project directory: ${repo}`, 1);
      const kind = kindOf(repo);
      const ticket = readThroughAdapter(repo, id);
      return markReady(ticket, resolve(repo), repo, id, kind);
    }
    let bodyFile = "";
    let labels = "";
    let repo = "";
    let id = "";
    for (let i = 0; i < rest.length; i += 2) {
      const flag = rest[i];
      const val = rest[i + 1];
      if (val === undefined) die("mark --body <file> --labels <list> --repo <repo> --id <id>", 1);
      if (flag === "--body") bodyFile = val;
      else if (flag === "--labels") labels = val;
      else if (flag === "--repo") repo = val;
      else if (flag === "--id") id = val;
      else die(`unknown flag: ${flag}`, 1);
    }
    if (!bodyFile || !existsSync(bodyFile)) die("--body needs a readable file", 1);
    if (!repo || !isDir(repo)) die("--repo needs a project directory", 1);
    if (!id) die("--id needs a ticket id", 1);
    const ticket: TicketRead = {
      title: "",
      body: readFileSync(bodyFile, "utf8"),
      labels: labels
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== ""),
      id,
    };
    return markReady(ticket, resolve(repo), repo, id, "other");
  }
  // Check mode.
  if (argv.length === 4 && argv[0] === "--body" && argv[2] === "--labels") {
    const bodyFile = argv[1]!;
    const labels = argv[3]!;
    if (!existsSync(bodyFile)) die(`no such file: ${bodyFile}`, 1);
    const ticket: TicketRead = {
      title: "",
      body: readFileSync(bodyFile, "utf8"),
      labels: labels
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== ""),
      id: "",
    };
    const project = process.env.POSTMASTER_PROJECT ?? "";
    const reasons = runChecks(ticket, project);
    if (reasons.length > 0) {
      for (const r of reasons) console.log(r);
      return 2;
    }
    return 0;
  }
  if (argv.length !== 2) {
    console.error(
      "usage: ticket-ready.sh <repo> <id> | --body <file> --labels <list> | mark|unmark ...",
    );
    return 1;
  }
  const repo = argv[0]!;
  const id = argv[1]!;
  if (!isDir(repo)) die(`no such project directory: ${repo}`, 1);
  const project = resolve(repo);
  process.env.POSTMASTER_PROJECT = project;
  const ticket = readThroughAdapter(repo, id);
  const reasons = runChecks(ticket, project);
  if (reasons.length > 0) {
    for (const r of reasons) console.log(r);
    return 2;
  }
  return 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
