// The booking clerk's verbs: brief writes the session's brief, ready marks the ticket ready,
// and fresh-reader tests a draft on a fresh reader.
//
//   clerk-session.sh brief <repo> <id>             write <repo>/.postmaster/clerk/<id>/brief.md,
//                                                  removing the ready label first if the ticket
//                                                  carries it, and record the session
//   clerk-session.sh ready <repo> <id>             mark the ticket ready (ticket-ready.sh mark)
//   clerk-session.sh fresh-reader <plain-file> <worktree> --clerk-model <model>
//                                                  run a lane on another model as a fresh reader:
//                                                  print its checks and guesses, or exit non-zero
//
// The brief carries the ticket's id and tracker, the repository, <tool>, the base (the default
// branch's tip when it is written), the draft's path under the project's .postmaster/ folder,
// the editor link, the standing preferences from preferences.md beside the machine config, and
// the skill's path. It is never committed.
//
// The fresh reader runs as one of the configured lanes on a model other than the clerk's,
// started the way the coachman starts a lane: host.sh run with no --role, and launch.sh launch
// <lane> <base worktree> <prompt file> --last <file>. The prompt is the plain part, the base
// worktree's path and two questions. The reader writes nothing.
//
//   exit 0  done; brief prints its path, ready prints the mark, fresh-reader prints the reader's
//           checks and guesses
//   exit 1  usage, no such repo or ticket, or a step failed
//   exit 2  ready: the checks refused the mark; fresh-reader: no lane on another model, or the
//           reader failed
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { scriptsDir, toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

const HERE = scriptsDir(import.meta);
const TOOL = toolRoot(import.meta);

function die(msg: string, code = 1): never {
  console.error(`clerk-session: ${msg}`);
  process.exit(code);
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function readStrict(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
}

function configDir(): string {
  const cfg =
    process.env.POSTMASTER_CONFIG ?? join(process.env.HOME ?? "", ".postmaster", "config.toml");
  return dirname(cfg);
}

interface TicketInfo {
  id: string;
  title: string;
  body: string;
  labels: string[];
  tracker: string;
}

function readTicket(repo: string, id: string): TicketInfo {
  const kindR = run(join(HERE, "tracker-kind.sh"), [repo]);
  if (kindR.code !== 0) die(`tracker-kind.sh failed: ${kindR.err}`, 1);
  const tracker = kindR.out.trim();
  let readOut = "";
  let readCode = 0;
  if (tracker === "github") {
    const r = run(join(HERE, "github.sh"), [repo, "read", id]);
    readOut = r.out;
    readCode = r.code;
  } else if (tracker === "plane") {
    const r = run(join(HERE, "plane.sh"), ["read", id]);
    readOut = r.out;
    readCode = r.code;
  } else if (tracker === "local") {
    const r = run(join(HERE, "local.sh"), [repo, "read", id]);
    readOut = r.out;
    readCode = r.code;
  } else {
    die(`tracker kind '${tracker}' has no adapter script`, 1);
  }
  if (readCode !== 0) die(`the ${tracker} adapter could not read ${id} (exit ${readCode})`, 1);
  const head = readOut.indexOf("\n\n");
  const header = head >= 0 ? readOut.slice(0, head) : readOut;
  const body = head >= 0 ? readOut.slice(head + 2) : "";
  const fields: Record<string, string> = {};
  for (const line of header.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) fields[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return {
    id: fields.id ?? id,
    title: fields.title ?? "",
    body: body.replace(/\n## Log\n[\s\S]*$/u, ""),
    labels: (fields.labels ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== ""),
    tracker,
  };
}

function defaultBranchTip(repo: string): string {
  const r = run("git", ["-C", repo, "rev-parse", "HEAD"]);
  if (r.code !== 0) die(`cannot read ${repo} HEAD`, 1);
  return r.out.trim();
}

function editorLinkOf(repo: string, draftFolder: string): string {
  // Read the planning.review_link template from the config.
  const configPath =
    process.env.POSTMASTER_CONFIG ?? join(process.env.HOME ?? "", ".postmaster", "config.toml");
  let template = "";
  try {
    const cfg = readFileSync(configPath, "utf8");
    const m = /^\s*review_link\s*=\s*"([^"]*)"/mu.exec(
      cfg.split("[planning]")[1] ?? "",
    );
    if (m) template = m[1] ?? "";
  } catch {
    /* no config, no template */
  }
  if (!template) return draftFolder;
  return template.replace(/\{path\}/gu, draftFolder);
}

function brief(repo: string, id: string): void {
  const project = resolve(repo);
  const ticket = readTicket(repo, id);
  // If the ticket carries the ready label, take it off: a ticket being changed is not ready.
  if (ticket.labels.some((l) => l.toLowerCase() === "ready")) {
    run(join(HERE, "ticket-ready.sh"), ["unmark", repo, id]);
  }
  const base = defaultBranchTip(repo);
  const draftDir = join(project, ".postmaster", "clerk", id.replace(/^#/u, ""));
  mkdirSync(draftDir, { recursive: true });
  const draftPath = join(draftDir, "draft.md");
  const skillPath = join(TOOL, "skills", "clerk");
  const prefsPath = join(configDir(), "preferences.md");
  const prefs = isFile(prefsPath)
    ? readStrict(prefsPath).replace(/\n+$/gu, "")
    : "None are set.";
  const link = editorLinkOf(repo, draftDir);
  const briefText = `# Booking clerk brief: ${ticket.id} ${ticket.title}

## Ticket

id: ${ticket.id}
tracker: ${ticket.tracker}
repository: ${project}
tool: ${TOOL}
base: ${base}
draft: ${draftPath}
editor link: ${link}
skill: ${skillPath}

## Standing preferences

${prefs}

## The ticket as it stands

${ticket.body}
`;
  const briefPath = join(draftDir, "brief.md");
  writeFileSync(briefPath, briefText, "utf8");
  // Record the session so a second clerk is not started for the same ticket.
  const sessionsDir = join(project, ".postmaster", "clerk");
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(join(sessionsDir, `${id.replace(/^#/u, "")}.session`), `${briefPath}\n`, "utf8");
  console.log(briefPath);
}

function ready(repo: string, id: string): void {
  const r = run(join(HERE, "ticket-ready.sh"), ["mark", repo, id]);
  process.stdout.write(r.out);
  process.stderr.write(r.err);
  process.exit(r.code);
}

function freshReader(plainFile: string, worktree: string, clerkModel: string): void {
  if (!isFile(plainFile)) die(`no such file: ${plainFile}`, 1);
  if (!isDir(worktree)) die(`no such directory: ${worktree}`, 1);
  const plain = readStrict(plainFile);
  // Find a lane on a model other than the clerk's.
  const configPath =
    process.env.POSTMASTER_CONFIG ?? join(process.env.HOME ?? "", ".postmaster", "config.toml");
  let configText = "";
  try {
    configText = readFileSync(configPath, "utf8");
  } catch {
    die(`no config at ${configPath}`, 2);
  }
  // Parse lanes: look for [lanes.<name>] blocks with harness and model.
  const laneRe = /^\[lanes\.([^\]]+)\]\s*\n((?:[^\[]|\[[^\]]*\])*?)(?=\n\[|\n*$)/mu;
  const lanes: Array<{ name: string; harness: string; model: string }> = [];
  let rest = configText;
  for (;;) {
    const m = laneRe.exec(rest);
    if (!m) break;
    const name = m[1] ?? "";
    const block = m[2] ?? "";
    const h = /^\s*harness\s*=\s*"([^"]*)"/mu.exec(block);
    const mod = /^\s*model\s*=\s*"([^"]*)"/mu.exec(block);
    if (h && mod) lanes.push({ name, harness: h[1] ?? "", model: mod[1] ?? "" });
    rest = rest.slice((m.index ?? 0) + (m[0]?.length ?? 0));
  }
  // Pick the first lane whose model differs from the clerk's.
  const baseModel = (m: string) => m.replace(/\[[^\]]*\]\s*$/u, "").trim();
  const lane = lanes.find((l) => baseModel(l.model) !== baseModel(clerkModel));
  if (!lane) {
    console.error("clerk-session: no lane on a model other than the clerk's; the draft was not tested");
    process.exit(2);
  }
  // Build the prompt: the plain part, the worktree path, and the two questions.
  const prompt = `You are a fresh reader. You have only the plain part of a ticket and the code at the path below. Write nothing in the repository.

The base worktree is at: ${worktree}

The plain part:

${plain}

Answer these two questions in order:

(a) Write the check for each acceptance criterion: the command and input, or the steps, and the expected output and exit status.

(b) List each point where you had to guess something the ticket does not say, one line each, marked \`visible\` if the answer changes what a person sees or what the flow does, and \`build\` if it only changes how it is built.

Write nothing in the repository.
`;
  const promptDir = join(worktree, ".postmaster");
  mkdirSync(promptDir, { recursive: true });
  const promptFile = join(promptDir, `fresh-reader-${process.pid}.txt`);
  const lastFile = join(promptDir, `fresh-reader-${process.pid}-last.md`);
  writeFileSync(promptFile, prompt, "utf8");
  // Run the lane headless through host.sh run with no --role, then launch.sh launch.
  const r = run(
    "bash",
    [
      join(HERE, "host.sh"),
      "run",
      `fresh-reader-${lane.name}`,
      worktree,
      "--out",
      join(promptDir, `fresh-reader-${process.pid}-events.jsonl`),
      "--err",
      join(promptDir, `fresh-reader-${process.pid}.err`),
      "--marker",
      join(promptDir, `fresh-reader-${process.pid}.done`),
      "--",
      join(HERE, "launch.sh"),
      "launch",
      lane.name,
      worktree,
      promptFile,
      "--last",
      lastFile,
    ],
    { timeout: 300_000 },
  );
  if (r.code !== 0) {
    console.error(
      `clerk-session: the fresh reader failed (exit ${r.code}); the draft was not tested`,
    );
    console.error(r.err);
    process.exit(2);
  }
  // Print the reader's last message.
  if (isFile(lastFile)) {
    process.stdout.write(readStrict(lastFile));
  } else {
    process.stdout.write(r.out);
  }
}

function main(argv: string[]): number {
  const cmd = argv[0] ?? "";
  if (cmd === "brief") {
    if (argv.length !== 3) die("usage: clerk-session.sh brief <repo> <id>", 1);
    brief(argv[1]!, argv[2]!);
    return 0;
  }
  if (cmd === "ready") {
    if (argv.length !== 3) die("usage: clerk-session.sh ready <repo> <id>", 1);
    ready(argv[1]!, argv[2]!);
    return 0;
  }
  if (cmd === "fresh-reader") {
    let plainFile = "";
    let worktree = "";
    let clerkModel = "";
    const rest = argv.slice(1);
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--clerk-model") {
        clerkModel = rest[i + 1] ?? "";
        i++;
      } else if (!plainFile) plainFile = rest[i] ?? "";
      else if (!worktree) worktree = rest[i] ?? "";
    }
    if (!plainFile || !worktree || !clerkModel)
      die(
        "usage: clerk-session.sh fresh-reader <plain-file> <worktree> --clerk-model <model>",
        1,
      );
    freshReader(plainFile, worktree, clerkModel);
    return 0;
  }
  die("usage: clerk-session.sh brief|ready|fresh-reader ...", 1);
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
