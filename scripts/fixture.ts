#!/usr/bin/env bun
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { command, scriptDir, writeError, writeOut } from "./lib/core.ts";

const here = scriptDir(import.meta.url),
  tool = dirname(here),
  app = join(tool, "fixtures", "app"),
  tickets = join(tool, "fixtures", "tickets");
const localScript = () => process.env.LOCAL_SH ?? join(here, "local.sh");
const self = fileURLToPath(import.meta.url);
const TIMEOUT = 1200_000;
const LEG_FILE = /\.leg-(\d+)-(?:done|exited)|leg-(\d+)-(?:prompt|takeover)\.txt|handoff-(\d+)\.md/;
class FixtureError extends Error {
  constructor(
    message: string,
    readonly code = 1,
  ) {
    super(message);
  }
}
function die(message: string, code = 1): never {
  throw new FixtureError(message, code);
}
function run(
  program: string,
  args: string[] = [],
  options: { cwd?: string; env?: Record<string, string | undefined>; input?: string; timeout?: number } = {},
) {
  const env = options.env
    ? Object.fromEntries(
        Object.entries(options.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      )
    : undefined;
  const result = spawnSync(program, args, {
    cwd: options.cwd,
    env,
    input: options.input,
    encoding: "utf8",
    timeout: options.timeout ?? TIMEOUT,
    maxBuffer: 64 * 1024 * 1024,
    stdio: "pipe",
  });
  return {
    code: typeof result.status === "number" ? result.status : result.error ? 127 : 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    text: String(result.stdout ?? "") + String(result.stderr ?? ""),
  };
}
function shortTail(text: string, n = 20): string {
  return text.trimEnd().split(/\r?\n/).slice(-n).join("\n");
}
function squash(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(" ");
}
function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
function fixtureNames(): string[] {
  if (!existsSync(tickets)) return [];
  return (readdirSync(tickets, { withFileTypes: true }) as Array<{ name: string; isDirectory(): boolean }>)
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(tickets, name, "ticket.md")))
    .sort();
}
function ticketTitle(ticket: string): string {
  return (readFileSync(join(tickets, ticket, "ticket.md"), "utf8").split(/\r?\n/, 1)[0] ?? "").replace(/^# /, "");
}
function ticketBody(ticket: string): string {
  return readFileSync(join(tickets, ticket, "ticket.md"), "utf8")
    .split(/\r?\n/)
    .slice(1)
    .join("\n")
    .replace(/^\n+/, "");
}
function isTicket(ticket: string): boolean {
  if (ticket && existsSync(join(tickets, ticket, "ticket.md"))) return true;
  writeError(`fixture: no ticket '${ticket}'; the tickets are: ${fixtureNames().join(" ")}`);
  return false;
}
function copyRepo(source: string, destination: string): void {
  mkdirSync(destination);
  const listed = run("git", ["-C", source, "ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  if (listed.code !== 0) die(`could not list the app's files: ${shortTail(listed.text)}`);
  const paths = [...new Set(listed.stdout.split("\0").filter(Boolean))].sort();
  for (const relative of paths) {
    const from = join(source, relative),
      to = join(destination, relative);
    try {
      const info = lstatSync(from);
      if (info.isSymbolicLink()) {
        mkdirSync(dirname(to), { recursive: true });
        symlinkSync(readlinkSync(from), to);
      } else if (info.isFile()) {
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
        chmodSync(to, info.mode & 0o777);
      }
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
    }
  }
}
function makeRepo(destination: string): void {
  try {
    copyRepo(app, destination);
  } catch {
    writeError(`fixture: could not copy the app to ${destination}`);
    throw new FixtureError("could not copy app");
  }
  if (run("git", ["-C", destination, "init", "-q", "-b", "main"]).code !== 0)
    die(`could not initialize ${destination}`);
  for (const key of ["user.name", "user.email"]) {
    const value = command("git", ["-C", tool, "config", key]).stdout.trim();
    if (value) command("git", ["-C", destination, "config", key, value]);
  }
  const added = run("git", ["-C", destination, "add", "-A"]),
    committed = run("git", ["-C", destination, "commit", "-q", "-m", "Initial commit"]);
  if (added.code !== 0 || committed.code !== 0)
    die(`could not commit the app in ${destination}; git needs user.name and user.email`);
}
function expandUser(path: string): string {
  return path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}
function makeAndFile(destInput: string, ticket: string): number {
  if (!isTicket(ticket)) return 1;
  let destination = destInput;
  if (!destination.includes("/"))
    destination = join(process.env.POSTMASTER_FIXTURES || join(homedir(), "Code", "fixtures"), destination);
  destination = resolve(expandUser(destination));
  if (existsSync(destination)) {
    writeError(`fixture: ${destination} already exists; a run starts from a fresh repo`);
    return 1;
  }
  let probe = dirname(destination);
  while (!existsSync(probe)) probe = dirname(probe);
  if (command("git", ["-C", probe, "rev-parse", "--git-dir"]).code === 0) {
    const root = command("git", ["-C", probe, "rev-parse", "--show-toplevel"]).stdout.trim() || probe;
    writeError(`fixture: ${destination} would be inside the git repository at ${root}; a run's repo stands alone`);
    return 1;
  }
  const home = process.env.HOME ?? homedir(),
    runRecords = join(home, ".postmaster", "runs", basename(destination));
  if (existsSync(runRecords)) {
    writeError(
      `fixture: ${runRecords} already holds runs of a project named ${basename(destination)}; choose another name`,
    );
    return 1;
  }
  const main =
    command("git", ["-C", tool, "worktree", "list", "--porcelain"])
      .stdout.split(/\r?\n/)
      .find((line) => line.startsWith("worktree "))
      ?.slice(9) ?? tool;
  if ([basename(tool), basename(main)].includes(basename(destination))) {
    writeError(
      `fixture: ${basename(destination)} is this repo's name, so its runs would share this repo's run records; choose another name`,
    );
    return 1;
  }
  mkdirSync(dirname(destination), { recursive: true });
  try {
    makeRepo(destination);
  } catch {
    rmSync(destination, { recursive: true, force: true });
    return 1;
  }
  const store = run(localScript(), [destination, "store", "init"]);
  if (store.code !== 0) {
    rmSync(destination, { recursive: true, force: true });
    writeError(`fixture: could not make the ticket store in ${destination}`);
    return 1;
  }
  const body = mkdtempSync(join(tmpdir(), "fixture-body-")),
    bodyPath = join(body, "ticket.md");
  writeFileSync(bodyPath, ticketBody(ticket));
  const created = run(localScript(), [destination, "create", ticketTitle(ticket), bodyPath]);
  rmSync(body, { recursive: true, force: true });
  const number = created.stdout.trim().split(/\r?\n/).at(-1) ?? "";
  if (created.code !== 0 || !/^\d+$/.test(number)) {
    rmSync(destination, { recursive: true, force: true });
    writeError(`fixture: filing the ticket in ${destination}'s own store failed (exit ${created.code})`);
    return 1;
  }
  writeOut(
    `fixture: made ${destination} from fixtures/app at ${command("git", ["-C", tool, "rev-parse", "--short", "HEAD"]).stdout.trim()}; main is at ${command("git", ["-C", destination, "rev-parse", "--short", "HEAD"]).stdout.trim()}`,
  );
  writeOut(
    `fixture: filed ticket ${ticket} in ${destination}'s own ticket store as #${number}: ${ticketTitle(ticket)}`,
  );
  writeOut(
    `fixture: dispatch ticket #${number} against ${destination}, then: scripts/fixture.sh score <its dispatch directory> ${destination}`,
  );
  return 0;
}
function newRun(dest: string, ticket: string): number {
  if (command("git", ["-C", tool, "status", "--porcelain", "--", "fixtures"]).stdout.trim()) {
    writeError("fixture: fixtures/ has uncommitted changes; a run starts from a committed fixture");
    return 1;
  }
  return makeAndFile(dest, ticket);
}
function sh(cmd: Array<string>, cwd?: string, env?: Record<string, string | undefined>) {
  return run(cmd[0]!, cmd.slice(1), { cwd, env });
}
function section(text: string, heading: string): string {
  return (
    new RegExp(
      `^##[ \\t]+${heading.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}[^\\S\\r\\n]*\\r?\\n(.*?)(?=^##[ \\t]|$)`,
      "ims",
    ).exec(text)?.[1] ?? ""
  );
}
function hidden(ticket: string, appPath: string): [boolean, string, string] {
  const result = sh(["bun", "test", "--timeout", "120000", "./"], join(tickets, ticket, "hidden"), {
    ...process.env,
    FIXTURE_APP: appPath,
  });
  const counts = Object.fromEntries(
    [...result.text.matchAll(/^\s*(\d+) (pass|fail)\s*$/gm)].map((m) => [m[2]!, Number(m[1])]),
  );
  const passed = Number(counts.pass ?? 0),
    failed = Number(counts.fail ?? 0);
  const detail =
    passed + failed
      ? `${passed} pass, ${failed} fail`
      : `bun test ${result.code === 124 ? `timed out after ${TIMEOUT / 1000}s` : `exit ${result.code}`}`;
  return [result.code === 0 && passed > 0 && failed === 0, detail, result.text];
}
function waybillTickets(dispatch: string): string[] {
  const briefPath = join(dispatch, "brief.md"),
    text = existsSync(briefPath) ? squash(readFileSync(briefPath, "utf8")) : "";
  return fixtureNames().filter((ticket) => {
    const criteria = squash(section(readFileSync(join(tickets, ticket, "ticket.md"), "utf8"), "Acceptance criteria"));
    return !!criteria && text.includes(criteria);
  });
}
function checkHidden(dispatch: string, appPath: string): [boolean, string, string] {
  const found = waybillTickets(dispatch);
  if (found.length !== 1)
    return [
      false,
      found.length
        ? `brief.md carries more than one fixture ticket: ${found.join(", ")}`
        : "brief.md carries no fixture ticket's criteria verbatim",
      "",
    ];
  const [ok, detail, out] = hidden(found[0]!, appPath);
  return [ok, `${found[0]}: ${detail}, from the waybill: ${found[0]} on main`, out];
}
function checkGate(appPath: string): [boolean, string, string] {
  const discovery = sh([join(here, "discover-project.sh"), appPath]);
  const gate =
    discovery.text
      .split(/\r?\n/)
      .find((line) => line.startsWith("gate="))
      ?.slice(5) ?? "";
  if (!gate) return [false, "scripts/discover-project.sh found no gate", discovery.text];
  const install = existsSync(join(appPath, "package-lock.json")) ? ["npm", "ci"] : ["npm", "install"];
  const setup = sh([...install, "--prefer-offline", "--no-audit", "--no-fund"], appPath);
  if (setup.code !== 0) return [false, `${install.join(" ")} on main: exit ${setup.code}`, setup.text];
  const result = sh(["bash", "-c", gate], appPath);
  return [result.code === 0, `${gate} on main: exit ${result.code}`, result.text];
}
function actions(dispatch: string): [any[] | null, string] {
  const path = join(dispatch, "actions.jsonl");
  if (!existsSync(path)) return [null, "no actions.jsonl"];
  const events: any[] = [];
  for (const [i, line] of readFileSync(path, "utf8").split(/\r?\n/).entries())
    if (line.trim()) {
      try {
        events.push(JSON.parse(line));
      } catch {
        return [null, `actions.jsonl line ${i + 1} is not JSON`];
      }
    }
  return [events, ""];
}
function checkStages(dispatch: string): [boolean, string] {
  const listing = sh([join(here, "stage.sh"), "--list"]),
    names = listing.code === 0 ? listing.text.split(/\s+/).filter(Boolean) : [];
  if (!names.includes("done")) return [false, "scripts/stage.sh --list names no done stage"];
  const expected = names.slice(0, names.indexOf("done") + 1),
    [events, why] = actions(dispatch);
  if (!events) return [false, why];
  const entered = events.filter((e) => e.action === "stage").map((e) => e.target),
    due = expected.slice(1);
  if (JSON.stringify(entered) === JSON.stringify(due))
    return [true, `${expected[0]} to done, ${expected.length} stages, each entered in order`];
  for (let i = 0; i < Math.min(due.length, entered.length); i++)
    if (due[i] !== entered[i])
      return [false, `after ${[expected[0], ...entered][i]} entered ${entered[i]}, not ${due[i]}`];
  return entered.length < due.length
    ? [false, `stopped at ${[expected[0], ...entered].at(-1)}; never entered ${due[entered.length]}`]
    : [false, `entered ${entered[due.length]} after done`];
}
function legsOf(dispatch: string, manifest: any): number[] {
  const seen = new Set<number>();
  for (const name of readdirSync(dispatch)) {
    const match = LEG_FILE.exec(name);
    if (match) seen.add(Number(match[1] ?? match[2] ?? match[3]));
  }
  if (Number.isInteger(manifest?.leg)) seen.add(manifest.leg);
  for (const key of Object.keys(manifest?.coachman?.legs ?? {})) if (/^\d+$/.test(key)) seen.add(Number(key));
  return seen.size ? Array.from({ length: Math.max(...seen) }, (_, i) => i + 1) : [];
}
function checkMarkers(dispatch: string, legs: number[]): [boolean, string] {
  if (!legs.length) return [false, "no leg recorded"];
  const missing = legs.flatMap((n) =>
    ["done", "exited"]
      .filter((state) => !existsSync(join(dispatch, `.leg-${n}-${state}`)))
      .map((state) => `.leg-${n}-${state}`),
  );
  return missing.length
    ? [false, `missing ${missing.join(", ")}`]
    : [true, `${legs.length} legs, each with its done and exited marker`];
}
function checkHandoffs(dispatch: string, legs: number[]): [boolean, string] {
  if (!legs.length) return [false, "no leg recorded"];
  const bad: string[] = [];
  for (const n of legs) {
    const name = `handoff-${n}.md`,
      file = join(dispatch, name);
    if (!existsSync(file)) {
      bad.push(`${name} missing`);
      continue;
    }
    const result = sh([join(here, "handoff-check.sh"), file]);
    if (result.code !== 0) {
      const said = result.text
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => line.replace("handoff-check: ", ""));
      bad.push(
        `${name}: ${said[0] ?? `exit ${result.code}`}${said.length > 1 ? ` (and ${said.length - 1} more)` : ""}`,
      );
    }
  }
  return bad.length ? [false, bad.join("; ")] : [true, `${legs.length} hand-offs pass scripts/handoff-check.sh`];
}
function checkRunJson(dispatch: string): [boolean, string] {
  const path = join(dispatch, "run.json");
  if (!existsSync(path)) return [false, "no run.json"];
  const data = readJson(path);
  return !data || typeof data !== "object" || Array.isArray(data) || !Object.keys(data).length
    ? [false, "run.json is not a JSON object"]
    : [true, "written, and parses"];
}
function checkCard(dispatch: string): [boolean, string] {
  const path = join(dispatch, "card.md");
  if (!existsSync(path)) return [false, "no card.md"];
  const lines = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line: string) => line.trim());
  return lines.length ? [true, `card.md, ${lines.length} lines`] : [false, "card.md is empty"];
}
function report(results: Array<[string, boolean, string, string]>): number {
  for (const [name, ok, detail, out] of results) {
    process.stdout.write(`${ok ? "ok" : "FAIL"}  ${name.padEnd(12)} ${detail}\n`);
    if (!ok && out.trim()) process.stderr.write(`--- ${name}\n${shortTail(out)}\n`);
  }
  return results.every((r) => r[1]) ? 0 : 2;
}
function score(dispatch: string, repo: string): number {
  const mainCheck = sh(["git", "-C", repo, "rev-parse", "--verify", "-q", "refs/heads/main^{commit}"]);
  const main = mainCheck.stdout.trim();
  if (mainCheck.code !== 0 || !main) {
    writeError(`fixture: ${repo} has no main branch`);
    return 1;
  }
  const manifest = readJson(join(dispatch, "manifest.json")),
    base = manifest?.base;
  if (
    typeof base === "string" &&
    base &&
    sh(["git", "-C", repo, "merge-base", "--is-ancestor", base, main]).code !== 0
  ) {
    writeError(`fixture: the manifest's base ${base.slice(0, 12)} is not on main in ${repo}; is this the run's repo?`);
    return 1;
  }
  const meta = readJson(join(dispatch, "run.json")),
    ran = meta?.postmaster?.commit,
    current = command("git", ["-C", tool, "rev-parse", "HEAD"]).stdout.trim();
  if (typeof ran === "string" && ran && ran !== current)
    writeError(
      `fixture: note: the run was dispatched from postmaster ${ran.slice(0, 12)}, and this checkout is at ${current.slice(0, 12)}; the stages and hand-off rules scored are this checkout's`,
    );
  const scratch = mkdtempSync(join(tmpdir(), "fixture-score-")),
    exportedApp = join(scratch, "app");
  mkdirSync(exportedApp);
  try {
    const extracted = run("bash", [
      "-o",
      "pipefail",
      "-c",
      'git -C "$1" archive --format=tar "$2" | tar -x -C "$3"',
      "fixture-export",
      repo,
      main,
      exportedApp,
    ]);
    if (extracted.code !== 0) {
      writeError(`fixture: could not export main from ${repo}: ${shortTail(extracted.text, 3)}`);
      return 1;
    }
    const legs = legsOf(dispatch, manifest);
    return report([
      ["hidden-tests", ...checkHidden(dispatch, exportedApp)],
      ["gate", ...checkGate(exportedApp)],
      ["stages", ...checkStages(dispatch), ""],
      ["markers", ...checkMarkers(dispatch, legs), ""],
      ["handoffs", ...checkHandoffs(dispatch, legs), ""],
      ["run.json", ...checkRunJson(dispatch), ""],
      ["ship-card", ...checkCard(dispatch), ""],
    ]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
function hiddenRun(ticket: string, appPath: string): number {
  if (!isTicket(ticket)) return 1;
  if (!existsSync(join(appPath, "package.json"))) {
    writeError(`fixture: no package.json in ${appPath}`);
    return 1;
  }
  const [ok, detail, output] = hidden(ticket, resolve(appPath));
  return report([["hidden-tests", ok, `${ticket}: ${detail}`, output]]);
}
function selfTest(): number {
  const tmp = mkdtempSync(join(tmpdir(), "fixture-test-"));
  let failures = 0;
  const check = (label: string, passed: boolean, detail = "") => {
    writeOut(`  ${passed ? "ok   " : "FAIL "}${label}`);
    if (!passed) {
      for (const line of detail.split("\n")) writeOut(`         ${line}`);
      failures++;
    }
  };
  const names = fixtureNames(),
    first = names[0] ?? "";
  const home = join(tmp, "home"),
    config = join(tmp, "config.toml"),
    env = {
      ...process.env,
      HOME: home,
      POSTMASTER_CONFIG: config,
      POSTMASTER_FIXTURES: "",
      LOCAL_SH: undefined,
    };
  mkdirSync(home, { recursive: true });
  writeFileSync(config, '[tracker]\nkind = "github"\n');
  check("there are at least two tickets", names.length >= 2);
  for (const ticket of names) {
    const body = join(tmp, `${ticket}.md`);
    writeFileSync(body, ticketBody(ticket));
    const result = run(join(here, "ticket-check.sh"), ["--body", body, "--title", ticketTitle(ticket)]);
    check(`${ticket}: in the ticket shape, by scripts/ticket-check.sh`, result.code === 0, result.text);

    const appRepo = join(tmp, `app-${ticket}`),
      refRepo = join(tmp, `ref-${ticket}`);
    makeRepo(appRepo);
    const appResult = hidden(ticket, appRepo);
    check(
      `${ticket}: the hidden suite fails on the app as committed`,
      !appResult[0] && /\d+ fail/.test(appResult[1]),
      appResult[2],
    );
    makeRepo(refRepo);
    const applied = run("git", ["-C", refRepo, "apply", join(tickets, ticket, "reference.patch")]);
    check(`${ticket}: the reference solution applies to the app`, applied.code === 0, applied.text);
    const refResult = hidden(ticket, refRepo);
    check(`${ticket}: the hidden suite passes on the reference solution`, refResult[0], refResult[2]);
  }
  if (first) {
    const dest = join(tmp, "repo");
    const invokeNew = (target: string, ticket: string, more: Record<string, string | undefined> = {}) =>
      run("bun", [self, "new", target, ticket], { env: { ...env, ...more } });
    const out = invokeNew(dest, first);
    check(
      "new makes the repo and prints the ticket's number",
      out.code === 0 && out.stdout.includes("own ticket store as #1:") && existsSync(join(dest, ".git")),
      out.text,
    );
    check(
      "one commit on main, and a clean tree",
      command("git", ["-C", dest, "rev-list", "--count", "main"]).stdout.trim() === "1" &&
        !command("git", ["-C", dest, "status", "--porcelain"]).stdout.trim(),
    );
    const filesInApp = command("git", ["-C", app, "ls-files", "--cached", "--others", "--exclude-standard"])
      .stdout.split(/\r?\n/)
      .filter(Boolean)
      .sort();
    const filesInDest = command("git", ["-C", dest, "ls-files", "--cached", "--others", "--exclude-standard"])
      .stdout.split(/\r?\n/)
      .filter(Boolean)
      .sort();
    check(
      "it holds the app's files as git sees them, symlink included, and nothing else",
      JSON.stringify(filesInApp) === JSON.stringify(filesInDest) &&
        existsSync(join(dest, "CLAUDE.md")) &&
        lstatSync(join(dest, "CLAUDE.md")).isSymbolicLink(),
    );
    check(
      "it commits as this checkout does",
      command("git", ["-C", dest, "config", "--local", "user.email"]).stdout.trim() ===
        command("git", ["-C", tool, "config", "user.email"]).stdout.trim() &&
        command("git", ["-C", dest, "config", "--local", "user.name"]).stdout.trim() ===
          command("git", ["-C", tool, "config", "user.name"]).stdout.trim(),
    );
    check("it has no remote", command("git", ["-C", dest, "remote"]).stdout.trim() === "");
    const listing = run(join(here, "local.sh"), [dest, "list"]),
      bodyRead = run(join(here, "local.sh"), [dest, "read", "1", "--body"]);
    check(
      "its own store holds the fixture ticket, title and body verbatim, in todo",
      listing.stdout.trim() === `#1\ttodo\t${ticketTitle(first)}` && bodyRead.stdout === ticketBody(first),
      `${listing.text}${bodyRead.text}`,
    );
    const kind = run(join(here, "tracker-kind.sh"), [dest], { env });
    check(
      "a run against it reads the local tracker, though the config names github",
      kind.code === 0 && kind.stdout.trim() === "local",
      kind.text,
    );
    const copied = command("git", ["-C", dest, "ls-files", "--cached", "--others", "--exclude-standard"]).stdout;
    check(
      "no hidden test and no reference solution reached it",
      !copied.split(/\r?\n/).some((path) => /(^|\/)(hidden|reference\.patch)(\/|$)/.test(path)),
    );
    const existing = invokeNew(dest, first);
    check(
      "a dest that exists is refused, and left alone",
      existing.code === 1 && command("git", ["-C", dest, "rev-list", "--count", "main"]).stdout.trim() === "1",
    );
    const enclosing = join(tmp, "enclosing");
    makeRepo(enclosing);
    const inside = invokeNew(join(enclosing, "nested"), first);
    check(
      "a dest inside a git repo is refused",
      inside.code === 1 && !existsSync(join(enclosing, "nested")),
      inside.text,
    );
    mkdirSync(join(home, ".postmaster", "runs", "taken"), { recursive: true });
    const taken = invokeNew(join(tmp, "taken"), first);
    check("a name that already has runs is refused", taken.code === 1 && !existsSync(join(tmp, "taken")), taken.text);
    const toolName = invokeNew(join(tmp, basename(tool)), first),
      mainPath =
        command("git", ["-C", tool, "worktree", "list", "--porcelain"])
          .stdout.split(/\r?\n/)
          .find((line) => line.startsWith("worktree "))
          ?.slice(9) ?? tool;
    check(
      "a name that is this repo's is refused",
      toolName.code === 1 && !existsSync(join(tmp, basename(tool))) && basename(mainPath) !== basename(tool),
      toolName.text,
    );
    const unknown = invokeNew(join(tmp, "unknown"), "no-such-ticket");
    check("an unknown ticket is refused", unknown.code === 1 && !existsSync(join(tmp, "unknown")), unknown.text);
    const failingLocal = join(tmp, "failing-local.sh");
    writeFileSync(
      failingLocal,
      `#!/usr/bin/env bash\ncase $2 in store) exec '${join(here, "local.sh")}' "$@" ;; *) exit 1 ;; esac\n`,
      { mode: 0o755 },
    );
    const unfiled = invokeNew(join(tmp, "unfiled"), first, { LOCAL_SH: failingLocal });
    check(
      "a ticket that cannot be filed: refused, and the repo it made is gone",
      unfiled.code === 1 && !existsSync(join(tmp, "unfiled")) && unfiled.text.includes("filing the ticket"),
      unfiled.text,
    );
    const bare = run("bun", [self, "new", "bare-name", first], { cwd: join(tmp), env });
    check(
      "a bare name goes under ~/Code/fixtures, not the working directory",
      bare.code === 0 &&
        existsSync(join(home, "Code", "fixtures", "bare-name", ".git")) &&
        !existsSync(join(tmp, "bare-name")),
      bare.text,
    );
    const elsewhere = run("bun", [self, "new", "other-name", first], {
      env: { ...env, POSTMASTER_FIXTURES: join(tmp, "elsewhere") },
    });
    check(
      "POSTMASTER_FIXTURES moves where a bare name goes",
      elsewhere.code === 0 &&
        existsSync(join(tmp, "elsewhere", "other-name", ".git")) &&
        !existsSync(join(home, "Code", "fixtures", "other-name")),
      elsewhere.text,
    );
  }
  rmSync(tmp, { recursive: true, force: true });
  writeOut(failures ? `self-test: ${failures} control(s) misbehaved` : "self-test: all controls behaved");
  return failures ? 1 : 0;
}
function usage(): never {
  die(
    "usage: fixture.sh new <name or dest> <ticket> | score <dispatch> <repo> | hidden <ticket> <app-dir> | --self-test",
  );
}
function main(args: string[]): number {
  try {
    if (args[0] === "--self-test" && args.length === 1) return selfTest();
    if (args[0] === "new" && args.length === 3) {
      if ((args[1]! + args[2]!).startsWith("-")) usage();
      return newRun(args[1]!, args[2]!);
    }
    if (args[0] === "score" && args.length === 3) {
      if (!existsSync(args[1]!) || command("test", ["-d", args[1]!]).code !== 0) {
        writeError(`fixture: no such dispatch directory: ${args[1]}`);
        return 1;
      }
      if (command("git", ["-C", args[2]!, "rev-parse", "--git-dir"]).code !== 0) {
        writeError(`fixture: not a git repo: ${args[2]}`);
        return 1;
      }
      return score(resolve(args[1]!), resolve(args[2]!));
    }
    if (args[0] === "hidden" && args.length === 3) return hiddenRun(args[1]!, args[2]!);
    usage();
  } catch (error) {
    const problem = error instanceof FixtureError ? error : new FixtureError(String((error as Error).message ?? error));
    writeError(`fixture: ${problem.message}`);
    return problem.code;
  }
}
process.exit(main(process.argv.slice(2)));
