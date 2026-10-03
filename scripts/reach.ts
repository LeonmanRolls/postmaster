// Record and check filesystem reach by workhorse and reviewer lanes.
//
//   reach.ts stream <dispatch> <lane> <events> <own-folder>
//   reach.ts before <dispatch> <round>
//   reach.ts check <dispatch> workhorses|r<round>|card
//   reach.ts restore <dispatch> r<round>
//
//   exit 0  checked, no findings or notes
//   exit 1  the check could not run
//   exit 2  a write or unapproved change was found
//   exit 3  notes, refused attempts or records not checked

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { reachTarget } from "./check-target.ts";
import { toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type RecordOf<T = unknown> = Record<string, T>;
type Harness = "codex" | "claude" | "muse" | "mimo" | "pi" | string;
type Access = "read" | "write" | "refused";
type Place = "inside" | "main checkout" | "synthesis worktree" | "another worktree" | "elsewhere";

interface ToolCall {
  name: string;
  input: RecordOf;
  output: string;
  exitCode: unknown;
  direct: Array<{ path: string; access: Access }>;
}

interface Touch {
  path: string;
  access: Access;
  place: Place;
  kind: "expected" | "finding" | "note";
  lane: string;
  lens?: string;
  source: "stream" | "checkout" | "round";
  user?: boolean;
  detail?: string;
}

interface LaneRead {
  lane: string;
  harness: Harness;
  ownFolder: string;
  lens?: string;
  events: string;
  calls: ToolCall[];
  touches: Touch[];
  status: "checked" | "not checked";
  reason?: string;
}

interface RunInfo {
  dispatch: string;
  repo: string;
  ticket: string;
  run: RecordOf;
  config: RecordOf;
  lanes: RecordOf;
  manifest: RecordOf;
  defaultBranch: string;
  tool: string;
  home: string;
}

interface Snapshot {
  round: number;
  refs: Record<string, string>;
  synthesisHead: string;
  synthesisStatus: Record<string, string>;
  mainHead: string;
  mainBranch: string;
}

interface ReachEvent {
  kind: "point" | "finding" | "note" | "void";
  point: string;
  result?: "clean" | "finding" | "note" | "not checked";
  lane?: string;
  lens?: string;
  access?: string;
  place?: string;
  path?: string;
  reason?: string;
  before?: string;
  after?: string;
  harness?: string;
  [key: string]: unknown;
}

const HERE = import.meta.dir;
const TOOL = toolRoot(import.meta);
const LOG_ACTION = join(TOOL, "scripts", "log-action.ts");
const RUN_LOG = join(TOOL, "scripts", "run-log.ts");
const READ_GIT = new Set([
  "status",
  "diff",
  "log",
  "show",
  "rev-parse",
  "rev-list",
  "merge-base",
  "ls-files",
  "ls-tree",
  "cat-file",
  "show-ref",
  "for-each-ref",
  "describe",
  "blame",
  "grep",
]);
const READ_GIT_EXTRA = new Set(["worktree list", "stash list"]);
const REFUSAL =
  /permission denied|operation not permitted|read-only file system|access denied|approval required|blocked by (?:the )?(?:sandbox|policy)|not allowed/iu;
const MISSING =
  /no such file or directory|cannot find (?:the )?(?:file|path)|does not exist|enoent/iu;
const DATA_RE = /^[ \t\r\n]*\{[^]*\}[ \t\r\n]*$/u;

function rec(value: unknown): RecordOf {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordOf)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readJson(path: string, what: string): RecordOf {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (e) {
    throw new Error(`${what} cannot be read: ${path} (${String(e)})`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${what} is not an object: ${path}`);
  }
  return parsed as RecordOf;
}

function physical(path: string): string {
  const absolute = resolve(path);
  const suffix: string[] = [];
  let probe = absolute;
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) return normalize(absolute);
    suffix.unshift(basename(probe));
    probe = parent;
  }
  try {
    return normalize(join(realpathSync(probe), ...suffix));
  } catch {
    return normalize(absolute);
  }
}

function inside(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function pathFromBrief(
  dispatch: string,
  repo: string,
  run: RecordOf,
): { repo: string; branch: string } {
  const brief = readFileSync(join(dispatch, "brief.md"), "utf8");
  const profile = /^repo:[ \t]*([^ \t\r\n]+)(?:[ \t]+default branch:[ \t]*([^ \t\r\n]+))?/mu.exec(
    brief,
  );
  const namedRepo = profile?.[1] ? physical(profile[1]) : repo;
  const target = rec(run.target);
  let defaultBranch = profile?.[2] ?? text(target.branch);
  if (!defaultBranch || defaultBranch === "(detached HEAD)") {
    const originHead = runGit(namedRepo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    if (originHead.code === 0) defaultBranch = originHead.out.trim().replace(/^origin\//u, "");
  }
  if (!defaultBranch) {
    const configured = runGit(namedRepo, ["config", "--get", "init.defaultBranch"]);
    if (configured.code === 0) defaultBranch = configured.out.trim();
  }
  if (!defaultBranch) throw new Error(`cannot determine the default branch for ${namedRepo}`);
  return { repo: namedRepo, branch: defaultBranch };
}

function runGit(repo: string, args: string[], cwd?: string) {
  return run("git", ["-C", repo, ...args], cwd ? { cwd } : {});
}

function loadRun(dispatchArg: string): RunInfo {
  const dispatch = physical(dispatchArg);
  if (!statSync(dispatch).isDirectory()) throw new Error(`no dispatch directory: ${dispatch}`);
  const runData = readJson(join(dispatch, "run.json"), "run.json");
  const manifest = readJson(join(dispatch, "manifest.json"), "manifest.json");
  const configured = rec(runData.config);
  const lanes = rec(configured.lanes);
  const targetRoot = dirname(dirname(dirname(dispatch)));
  const resolved = pathFromBrief(dispatch, targetRoot, runData);
  const postmaster = rec(runData.postmaster);
  let tool = text(postmaster.checkout);
  if (!tool) {
    const found = /^tool:[ \t]*([^ \t\r\n]+)/mu.exec(
      readFileSync(join(dispatch, "brief.md"), "utf8"),
    );
    tool = found?.[1] ?? TOOL;
  }
  return {
    dispatch,
    repo: resolved.repo,
    ticket: basename(dispatch),
    run: runData,
    config: configured,
    lanes,
    manifest,
    defaultBranch: resolved.branch,
    tool: physical(tool),
    home: physical(process.env.HOME || homedir()),
  };
}

function withinAny(path: string, roots: string[]): boolean {
  return roots.some((root) => root !== "" && inside(path, root));
}

function laneDataHome(
  info: RunInfo,
  lane: string,
  harness: Harness,
  ownFolder: string,
  lens?: string,
): string {
  if (harness !== "muse" && harness !== "mimo") return "";
  const configured = text(rec(info.config).harness_data);
  const root =
    configured ||
    process.env.POSTMASTER_HARNESS_DATA ||
    join(info.home, ".postmaster", "harness-data");
  const leg = lens ? "review" : "synthesis";
  const key = `${info.dispatch}|${physical(ownFolder)}|${lane}|${leg}`;
  const sum = run("cksum", [], { input: key });
  if (sum.code !== 0) return "";
  const suffix = sum.out.trim().replace(/ /gu, "-");
  return physical(join(root, harness, suffix));
}

function normalPath(info: RunInfo, path: string, access: Access, ownDataHome: string): boolean {
  const p = path;
  // A test repository may itself live below /tmp. Once a path belongs to the
  // project, its worktrees and main checkout take precedence over temp-folder rules.
  if (inside(p, info.repo)) return false;
  const homeReadRoots = [
    join(info.home, ".codex"),
    join(info.home, ".claude"),
    join(info.home, ".claude.json"),
    join(info.home, ".config", "muse"),
    join(info.home, ".config", "mimocode"),
    join(info.home, ".mimocode"),
    join(info.home, ".pi", "agent"),
  ];
  const rwRoots = [join(info.home, ".npm"), join(info.home, ".cache"), join(info.home, ".bun")];
  const xdg = text(rec(info.run.config).xdg_data_home);
  if (xdg) rwRoots.push(physical(xdg));
  const envXdg = process.env.XDG_DATA_HOME;
  if (envXdg) rwRoots.push(physical(envXdg));
  if (ownDataHome) rwRoots.push(ownDataHome);
  if (inside(p, info.home)) {
    if (access === "read" && withinAny(p, homeReadRoots)) return true;
    if (withinAny(p, rwRoots)) return true;
    // A lane's HOME may be under /tmp in a fixture. Keep ordinary home files
    // visible before applying the broad temporary-directory allowance below.
    return false;
  }
  if (p === "/dev" || inside(p, "/dev")) return true;
  for (const root of ["/tmp", "/private/tmp", "/var/folders"]) {
    if (p === root || inside(p, root)) return true;
  }
  const temp = process.env.TMPDIR ? physical(process.env.TMPDIR) : "";
  if (temp && (p === temp || inside(p, temp))) return true;

  // System files and executables are routine reads. A write remains a reach.
  const systemRoots = [
    "/etc",
    "/usr",
    "/bin",
    "/sbin",
    "/lib",
    "/lib64",
    "/System",
    "/Library",
    "/proc",
    "/sys",
  ];
  if (access === "read" && withinAny(p, systemRoots)) return true;

  if (withinAny(p, rwRoots)) return true;

  // A pinned tool checkout and files supplied to a lane are ordinary reads.
  if (access === "read" && inside(p, info.tool)) return true;
  if (
    access === "read" &&
    inside(p, info.dispatch) &&
    (basename(p) === "brief.md" ||
      basename(p).endsWith("-prompt.txt") ||
      basename(p).endsWith("-brief.md"))
  )
    return true;

  return false;
}

function placeOf(info: RunInfo, path: string, ownFolder: string): Place {
  if (inside(path, ownFolder)) return "inside";
  const worktrees = join(info.repo, ".worktrees");
  if (inside(path, worktrees)) {
    const rel = relative(worktrees, path);
    const worktreeName = rel.split(sep)[0] ?? "";
    if (worktreeName === info.ticket) return "synthesis worktree";
    return "another worktree";
  }
  if (inside(path, info.repo)) return "main checkout";
  return "elsewhere";
}

function expandPath(token: string, cwd: string): string | null {
  if (!token || /[*?\[\]]/u.test(token)) return null;
  let value = token;
  if (value.startsWith("~")) {
    if (value !== "~" && !value.startsWith("~/")) return null;
    value = join(process.env.HOME || homedir(), value.slice(2));
  }
  value = value.replace(/\$HOME(?=\/|$)/gu, process.env.HOME || homedir());
  value = value.replace(/\$TMPDIR(?=\/|$)/gu, process.env.TMPDIR || "\0");
  value = value.replace(/\$\{HOME\}(?=\/|$)/gu, process.env.HOME || homedir());
  if (value.includes("$") || value.includes("\u0000")) return null;
  if (!isAbsolute(value)) value = resolve(cwd, value);
  return physical(value);
}

function isPathToken(token: string, cwd: string): boolean {
  if (!token || token.startsWith("-") || token.includes("=") || /^[0-9]+>&?[0-9]*$/u.test(token))
    return false;
  if (/^(?:https?|mailto|data):/iu.test(token)) return false;
  if (
    token.startsWith("/") ||
    token.startsWith("~/") ||
    token.startsWith("./") ||
    token.startsWith("../")
  )
    return true;
  if (token.includes("/") || /\.[A-Za-z0-9_-]{1,12}(?:[:#][0-9]+)?$/u.test(token)) return true;
  try {
    return existsSync(resolve(cwd, token));
  } catch {
    return false;
  }
}

function splitShell(source: string): string[] {
  const out: string[] = [];
  let part = "";
  let quote = "";
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i] ?? "";
    if (escaped) {
      part += ch;
      escaped = false;
      continue;
    }
    if (quote === "'" && ch !== "'") {
      part += ch;
      continue;
    }
    if (quote === '"' && ch !== '"') {
      if (ch === "\\" && i + 1 < source.length && '\\"$`'.includes(source[i + 1] ?? ""))
        escaped = true;
      else part += ch;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (ch === "'" || ch === '"') {
      if (quote === "") quote = ch;
      else quote = "";
      continue;
    }
    if (quote === "" && source.startsWith("$(", i)) {
      if (part.trim()) out.push(part);
      part = "";
      let depth = 1;
      let inner = "";
      i += 2;
      for (; i < source.length && depth > 0; i++) {
        const c = source[i] ?? "";
        if (c === "(") depth++;
        else if (c === ")") {
          depth--;
          if (depth === 0) break;
        }
        if (depth > 0) inner += c;
      }
      if (inner.trim()) out.push(...splitShell(inner));
      i--;
      continue;
    }
    if (quote === "" && (ch === ";" || ch === "|" || (ch === "&" && source[i + 1] === "&"))) {
      if (part.trim()) out.push(part);
      part = "";
      if (ch === "&") i++;
      continue;
    }
    part += ch;
  }
  if (part.trim()) out.push(part);
  return out;
}

function shellWords(segment: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote = "";
  let escaped = false;
  const push = (): void => {
    if (word !== "") words.push(word);
    word = "";
  };
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i] ?? "";
    if (escaped) {
      word += ch;
      escaped = false;
      continue;
    }
    if (quote === "'" && ch !== "'") {
      word += ch;
      continue;
    }
    if (quote === '"' && ch !== '"') {
      if (ch === "\\" && i + 1 < segment.length && '\\"$`'.includes(segment[i + 1] ?? ""))
        escaped = true;
      else word += ch;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = quote === "" ? ch : "";
      continue;
    }
    if (quote === "" && (ch === " " || ch === "\t" || ch === "\n")) {
      push();
      continue;
    }
    if (quote === "" && [">>", "2>", "<", ">", "&>"].some((op) => segment.startsWith(op, i))) {
      push();
      const op =
        [">>", "2>", "&>", "<", ">"].find((candidate) => segment.startsWith(candidate, i)) ?? ch;
      words.push(op);
      i += op.length - 1;
      continue;
    }
    word += ch;
  }
  push();
  return words;
}

function unwrapShell(command: string): string[] {
  const words = shellWords(command.trim());
  if (words.length >= 3 && /(?:^|\/)(?:ba)?sh$/u.test(words[0] ?? "")) {
    const flag = words[1];
    if (flag === "-lc" || flag === "-c") return splitShell(words.slice(2).join(" "));
    if (flag === "-l" && words[2] === "-c") return splitShell(words.slice(3).join(" "));
  }
  return splitShell(command);
}

function workTreeForGitDir(gitDir: string): string {
  if (basename(gitDir) === ".git") {
    try {
      if (statSync(gitDir).isDirectory()) return physical(dirname(gitDir));
      const pointer = readFileSync(gitDir, "utf8").trim();
      const linkedDir = /^gitdir:[ \t]*(.+)$/u.exec(pointer)?.[1];
      if (linkedDir) return physical(dirname(resolve(dirname(gitDir), linkedDir)));
    } catch {
      // Fall through to git's own worktree discovery.
    }
  }
  try {
    const pointer = readFileSync(join(gitDir, "gitdir"), "utf8").trim();
    if (pointer) return physical(dirname(pointer));
  } catch {
    // A bare repository has no linked-worktree pointer.
  }
  const top = run("git", [`--git-dir=${gitDir}`, "rev-parse", "--show-toplevel"]);
  return top.code === 0 ? physical(top.out.trim()) : gitDir;
}

function toolCallsFromEvents(harness: Harness, events: unknown[]): ToolCall[] {
  const calls: ToolCall[] = [];
  const add = (
    name: unknown,
    input: unknown,
    output = "",
    exitCode: unknown = undefined,
    direct: ToolCall["direct"] = [],
  ): number => {
    calls.push({ name: text(name) || "tool", input: rec(input), output, exitCode, direct });
    return calls.length - 1;
  };
  const linked = new Map<string, number>();
  const pending = new Map<string, number>();
  for (const raw of events) {
    const event = rec(raw);
    if (harness === "codex") {
      if (event.type !== "item.completed") continue;
      const item = rec(event.item);
      if (item.type === "command_execution") {
        add(
          "shell",
          { command: text(item.command) },
          `${text(item.aggregated_output)}\n${text(item.output)}`,
          item.exit_code,
        );
      } else if (item.type === "file_change") {
        const direct = array(item.changes).flatMap((entry) => {
          const path = text(rec(entry).path);
          return path ? [{ path, access: "write" as const }] : [];
        });
        add("file_change", {}, "", undefined, direct);
      } else if (item.type === "mcp_tool_call") {
        add("mcp", item);
      }
    } else if (harness === "claude") {
      const msg = rec(event.message);
      for (const blockValue of array(msg.content)) {
        const block = rec(blockValue);
        if (event.type === "assistant" && block.type === "tool_use") {
          const index = add(block.name, block.input);
          if (typeof block.id === "string") linked.set(block.id, index);
        } else if (event.type === "user" && block.type === "tool_result") {
          const id = text(block.tool_use_id);
          const index = linked.get(id);
          if (index !== undefined) {
            const body =
              typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content ?? "");
            calls[index]!.output += `\n${body}`;
          }
        }
      }
    } else if (harness === "mimo") {
      if (event.type !== "tool_use") continue;
      const part = rec(event.part);
      const state = rec(part.state);
      add(part.tool, state.input, text(state.output), rec(state.metadata).exit);
    } else if (harness === "pi") {
      if (event.type === "tool_execution_start") {
        const index = add(event.toolName, event.args);
        const id = text(event.toolCallId || event.callId || event.id);
        if (id) linked.set(id, index);
        else pending.set(text(event.toolName), index);
      } else if (event.type === "tool_execution_end") {
        const id = text(event.toolCallId || event.callId || event.id);
        const index = linked.get(id) ?? pending.get(text(event.toolName));
        if (index !== undefined) calls[index]!.output = text(event.result ?? event.output);
      }
    } else if (harness === "muse") {
      if (event.payload_type !== "tool.result") continue;
      const payload = rec(event.payload);
      const facts = rec(payload.correlation_facts);
      const editFacts = rec(payload.edit_facts);
      let input: RecordOf = { ...editFacts };
      const resultText = text(payload.text);
      if (resultText.trimStart().startsWith("{")) {
        const first = resultText.trimStart().split("\n", 1)[0] ?? "";
        if (DATA_RE.test(first)) {
          try {
            input = { ...(JSON.parse(first) as RecordOf), ...input };
          } catch {
            // Non-JSON result text can still carry the edit_facts record.
          }
        }
      } else {
        const readFile = /^Read text file `([^`]+)`/u.exec(resultText.trimStart());
        if (readFile?.[1] && !input.path && !input.file_path) input.path = readFile[1];
      }
      const direct: ToolCall["direct"] = [];
      const toolName = text(facts.tool_name);
      const access: Access =
        /write|edit|create|patch|apply|delete|remove|move|copy|install|save/iu.test(toolName)
          ? "write"
          : "read";
      for (const field of ["path", "file_path"]) {
        const p = text(input[field]);
        if (p) direct.push({ path: p, access });
      }
      add(toolName, input, resultText, facts.outcome, direct);
    }
  }
  return calls;
}

function parseEventFile(path: string): unknown[] | null {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const events: unknown[] = [];
  for (const line of contents.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as unknown);
    } catch {
      return null;
    }
  }
  return events;
}

function parseTaskFile(path: string): unknown[] {
  const events = parseEventFile(path);
  if (events === null) return [];
  return events;
}

function inputPath(input: RecordOf): string | null {
  for (const key of ["file_path", "path", "filePath", "filename", "target"]) {
    const value = text(input[key]);
    if (value) return value;
  }
  return null;
}

function commandTouches(
  command: string,
  result: string,
  code: unknown,
  info: RunInfo,
  lane: string,
  ownFolder: string,
  ownDataHome: string,
  lens?: string,
): Touch[] {
  const touches: Touch[] = [];
  let cwd = ownFolder;
  const shellGroups = unwrapShell(command);
  const add = (
    rawPath: string,
    access: Access,
    source: "stream" = "stream",
    detail?: string,
  ): void => {
    const path = expandPath(rawPath, cwd);
    if (!path) return;
    const place = placeOf(info, path, ownFolder);
    if (place === "inside") {
      touches.push({
        path,
        access,
        place,
        kind: "expected",
        lane,
        ...(lens ? { lens } : {}),
        source,
        ...(detail ? { detail } : {}),
      });
      return;
    }
    const denied = REFUSAL.test(result);
    if (!denied && normalPath(info, path, access, ownDataHome)) return;
    const missing = access === "read" && MISSING.test(result);
    const finalAccess: Access =
      (access === "write" || access === "read") && denied
        ? "refused"
        : missing
          ? "refused"
          : access;
    const kind = finalAccess === "write" ? "finding" : "note";
    touches.push({
      path,
      access: finalAccess,
      place,
      kind,
      lane,
      ...(lens ? { lens } : {}),
      source,
      ...(detail ? { detail } : {}),
    });
  };

  for (const group of shellGroups) {
    const words = shellWords(group);
    if (words.length === 0) continue;
    let first = 0;
    const assignments: Record<string, string> = {};
    while (words[first] && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[first]!)) {
      const [key, ...value] = (words[first] ?? "").split("=");
      assignments[key ?? ""] = value.join("=");
      first++;
    }
    const commandName = words[first] ?? "";
    const baseCommand = basename(commandName);
    if (baseCommand === "cd") {
      const next = words[first + 1];
      if (next && !next.startsWith("-") && !next.includes("$")) cwd = expandPath(next, cwd) ?? cwd;
      continue;
    }

    if (baseCommand === "git") {
      let gitDir = cwd;
      let targetWorktree = cwd;
      let worktreeExplicit = false;
      const assignedWorkTree = assignments.GIT_WORK_TREE
        ? expandPath(assignments.GIT_WORK_TREE, cwd)
        : null;
      const assignedGitDir = assignments.GIT_DIR ? expandPath(assignments.GIT_DIR, cwd) : null;
      if (assignedWorkTree) {
        targetWorktree = assignedWorkTree;
        worktreeExplicit = true;
      }
      if (assignedGitDir) {
        gitDir = assignedGitDir;
        if (!worktreeExplicit) targetWorktree = workTreeForGitDir(gitDir);
      }
      let cmd = "";
      let subIndex = first + 1;
      const refs: string[] = [];
      while (subIndex < words.length) {
        const word = words[subIndex] ?? "";
        if (word === "-C" && words[subIndex + 1]) {
          targetWorktree = expandPath(words[subIndex + 1]!, cwd) ?? targetWorktree;
          gitDir = targetWorktree;
          worktreeExplicit = true;
          subIndex += 2;
          continue;
        }
        if ((word === "--git-dir" || word === "--work-tree") && words[subIndex + 1]) {
          const value = expandPath(words[subIndex + 1]!, cwd);
          if (value) {
            if (word === "--work-tree") {
              targetWorktree = value;
              worktreeExplicit = true;
            } else {
              gitDir = value;
              if (!worktreeExplicit) targetWorktree = workTreeForGitDir(gitDir);
            }
          }
          subIndex += 2;
          continue;
        }
        if (word.startsWith("--git-dir=")) {
          gitDir = expandPath(word.slice("--git-dir=".length), cwd) ?? gitDir;
          if (!worktreeExplicit) targetWorktree = workTreeForGitDir(gitDir);
          subIndex++;
          continue;
        }
        if (word.startsWith("--work-tree=")) {
          targetWorktree = expandPath(word.slice("--work-tree=".length), cwd) ?? targetWorktree;
          worktreeExplicit = true;
          subIndex++;
          continue;
        }
        if (word.startsWith("-")) {
          subIndex++;
          continue;
        }
        cmd = word;
        subIndex++;
        break;
      }
      const gitRead =
        READ_GIT.has(cmd) ||
        READ_GIT_EXTRA.has(`${cmd} ${words[subIndex] ?? ""}`) ||
        (cmd === "config" && words[subIndex] === "--get") ||
        (cmd === "branch" && words.length <= subIndex + 1) ||
        (cmd === "tag" && words.length <= subIndex + 1);
      const access: Access = gitRead ? "read" : "write";
      add(targetWorktree, access, "stream", `git ${cmd}`);
      for (const word of words.slice(subIndex)) {
        if (/^refs\/heads\//u.test(word)) refs.push(word);
      }
      if (cmd === "update-ref") {
        const ref = words[subIndex];
        if (ref?.startsWith("refs/heads/")) refs.push(ref);
      } else if (["checkout", "switch", "branch"].includes(cmd)) {
        const args = words.slice(subIndex);
        const flag = args.findIndex((word) => ["-b", "-B", "-c", "--create"].includes(word));
        if (flag >= 0 && args[flag + 1]) refs.push(`refs/heads/${args[flag + 1]}`);
        if (cmd === "branch") {
          const branch = args.find((word) => !word.startsWith("-"));
          if (
            branch &&
            args.some((word) => ["-d", "-D", "-m", "-M", "--set-upstream-to"].includes(word))
          )
            refs.push(`refs/heads/${branch}`);
        }
      }
      for (const ref of new Set(refs)) {
        if (!normalPath(info, join(info.repo, ".git", ref), "write", ownDataHome)) {
          touches.push({
            path: ref,
            access: "write",
            place: "elsewhere",
            kind: "finding",
            lane,
            ...(lens ? { lens } : {}),
            source: "stream",
            detail: `git ${cmd}`,
          });
        }
      }
      continue;
    }

    const outTokens = new Set<string>();
    const inTokens = new Set<string>();
    const writeCommands = new Set([
      "cp",
      "mv",
      "rm",
      "mkdir",
      "touch",
      "tee",
      "install",
      "ln",
      "truncate",
      "chmod",
      "chown",
    ]);
    const inPlace =
      baseCommand === "sed" && words.some((word) => word === "-i" || word.startsWith("-i"));
    for (let i = 0; i < words.length; i++) {
      const word = words[i] ?? "";
      if ([">", ">>", "2>", "&>"].includes(word)) {
        if (words[i + 1]) outTokens.add(words[i + 1]!);
        i++;
      } else if (word === "<") {
        if (words[i + 1]) inTokens.add(words[i + 1]!);
        i++;
      }
    }
    const args = words
      .slice(first + 1)
      .filter((word) => ![">", ">>", "2>", "&>", "<"].includes(word));
    if (writeCommands.has(baseCommand)) {
      if (baseCommand === "cp" || baseCommand === "mv") {
        const paths = args.filter((arg) => isPathToken(arg, cwd));
        paths.slice(0, -1).forEach((path) => add(path, baseCommand === "mv" ? "write" : "read"));
        if (paths.length) add(paths[paths.length - 1]!, "write");
      } else {
        args.filter((arg) => isPathToken(arg, cwd)).forEach((path) => add(path, "write"));
      }
    } else if (inPlace) {
      args.filter((arg) => isPathToken(arg, cwd)).forEach((path) => add(path, "write"));
    }
    for (const path of outTokens) add(path, "write");
    for (const path of inTokens) add(path, "read");
    if (!writeCommands.has(baseCommand) && !inPlace) {
      args.filter((arg) => isPathToken(arg, cwd)).forEach((path) => add(path, "read"));
    }
    // A recognized shell call without paths still proves the record was read.
    if (typeof code === "number" && code !== 0 && REFUSAL.test(result)) {
      for (const touch of touches) {
        if (touch.source === "stream" && touch.access !== "write") {
          touch.access = "refused";
          touch.kind = "note";
        }
      }
    }
  }
  return touches;
}

function directCallTouches(
  calls: ToolCall[],
  info: RunInfo,
  lane: string,
  ownFolder: string,
  ownDataHome: string,
  lens?: string,
): Touch[] {
  const touches: Touch[] = [];
  for (const call of calls) {
    const name = call.name.toLowerCase(); // LOWER: harness tool names are ASCII identifiers
    const command = text(call.input.command ?? call.input.cmd);
    if (command) {
      touches.push(
        ...commandTouches(
          command,
          call.output,
          call.exitCode,
          info,
          lane,
          ownFolder,
          ownDataHome,
          lens,
        ),
      );
      continue;
    }
    const direct = [...call.direct];
    const path = inputPath(call.input);
    if (path) {
      let access: Access = "read";
      if (/write|edit|create|patch|apply|delete|remove|move|copy|install|save/iu.test(name))
        access = "write";
      direct.push({ path, access });
    }
    if (direct.length === 0) continue;
    const refused =
      REFUSAL.test(call.output) ||
      (direct.some((item) => item.access === "read") && MISSING.test(call.output));
    for (const item of direct) {
      const absolute = expandPath(item.path, ownFolder);
      if (!absolute) continue;
      const place = placeOf(info, absolute, ownFolder);
      if (place === "inside") {
        touches.push({
          path: absolute,
          access: item.access,
          place,
          kind: "expected",
          lane,
          ...(lens ? { lens } : {}),
          source: "stream",
        });
        continue;
      }
      if (!refused && normalPath(info, absolute, item.access, ownDataHome)) continue;
      const access: Access = refused ? "refused" : item.access;
      touches.push({
        path: absolute,
        access,
        place,
        kind: access === "write" ? "finding" : "note",
        lane,
        ...(lens ? { lens } : {}),
        source: "stream",
      });
    }
  }
  return touches;
}

function mergeTouches(touches: Touch[]): Touch[] {
  const byPath = new Map<string, Touch>();
  const rank: Record<Access, number> = { read: 1, refused: 2, write: 3 };
  for (const touch of touches) {
    const key = `${touch.lane}\0${touch.lens ?? ""}\0${touch.path}`;
    const old = byPath.get(key);
    if (!old || rank[touch.access] > rank[old.access]) byPath.set(key, touch);
  }
  return [...byPath.values()].sort((a, b) =>
    `${a.lane}\0${a.lens ?? ""}\0${a.path}`.localeCompare(`${b.lane}\0${b.lens ?? ""}\0${b.path}`),
  );
}

function readLane(
  info: RunInfo,
  lane: string,
  events: string,
  ownFolder: string,
  lens?: string,
): LaneRead {
  const harness = text(rec(info.lanes[lane]).harness);
  const laneRecord: LaneRead = {
    lane,
    harness,
    ownFolder: physical(ownFolder),
    ...(lens ? { lens } : {}),
    events,
    calls: [],
    touches: [],
    status: "not checked",
  };
  if (!["codex", "claude", "muse", "mimo", "pi"].includes(harness)) {
    laneRecord.reason = `${harness || "unknown harness"} has no reach reader`;
    return laneRecord;
  }
  const parsed = parseEventFile(events);
  if (parsed === null) {
    laneRecord.reason = "the lane record cannot be read";
    return laneRecord;
  }
  const allEvents = [...parsed];
  if (harness === "claude") {
    const logs = join(info.dispatch, "logs");
    // The review harvester prefixes copied Claude fork records with the bug lane's stream name.
    const streamName = basename(events).replace(/\.jsonl$/u, "");
    const taskPrefix = streamName.startsWith("review-r") ? streamName : lane;
    const taskName = `${taskPrefix}-claude-task-`;
    try {
      for (const name of readdirSync(logs)) {
        if (name.startsWith(taskName)) {
          const task = parseTaskFile(join(logs, name));
          allEvents.push(...task);
        }
      }
    } catch {
      // A missing task directory is ordinary; a task file the stream does name is reported by harvest.
    }
  }
  laneRecord.calls = toolCallsFromEvents(harness, allEvents);
  if (laneRecord.calls.length === 0) {
    laneRecord.reason = "no recognized tool call in the lane record";
    return laneRecord;
  }
  laneRecord.status = "checked";
  const dataHome = laneDataHome(info, lane, harness, laneRecord.ownFolder, lens);
  laneRecord.touches = mergeTouches(
    directCallTouches(laneRecord.calls, info, lane, laneRecord.ownFolder, dataHome, lens),
  );
  return laneRecord;
}

function noShellDisplay(touch: Touch): string {
  if (touch.kind === "expected") return `expected ${touch.access} ${touch.path}`;
  return `${touch.kind} ${touch.access} ${touch.path} (${touch.place})`;
}

function readStreamMode(info: RunInfo, lane: string, stream: string, ownFolder: string): number {
  const result = readLane(info, lane, stream, ownFolder);
  if (result.status === "not checked") {
    console.log(`not checked: ${result.reason}`);
    return 3;
  }
  for (const touch of result.touches) console.log(noShellDisplay(touch));
  if (result.touches.some((touch) => touch.kind === "finding")) return 2;
  if (result.touches.some((touch) => touch.kind === "note")) return 3;
  console.log("clean");
  return 0;
}

function gitOutput(repo: string, args: string[]): string {
  const result = runGit(repo, args);
  if (result.code !== 0)
    throw new Error(`git ${args.join(" ")} failed in ${repo}: ${result.err.trim()}`);
  return result.out;
}

function currentHead(repo: string, where = repo): string {
  return gitOutput(repo, ["-C", where, "rev-parse", "--verify", "HEAD"]).trim();
}

function branchName(repo: string, where = repo): string {
  const branch = run("git", ["-C", where, "symbolic-ref", "--short", "-q", "HEAD"]);
  return branch.code === 0 ? branch.out.trim() : "(detached HEAD)";
}

function statusMap(repo: string, where: string): Record<string, string> {
  const result = run("git", [
    "-C",
    where,
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  if (result.code !== 0) throw new Error(`cannot read status in ${where}: ${result.err.trim()}`);
  const fields = result.out.split("\0").filter(Boolean);
  const status: Record<string, string> = {};
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] ?? "";
    const path = field.slice(3);
    if (path) status[path] = field.slice(0, 2);
    if (/^(?:R|C)/u.test(field.slice(0, 2))) i++;
  }
  return status;
}

function runRefs(repo: string, ticket: string): Record<string, string> {
  const result = run("git", [
    "-C",
    repo,
    "for-each-ref",
    "--format=%(refname) %(objectname)",
    "refs/heads",
  ]);
  if (result.code !== 0)
    throw new Error(`cannot read run branches in ${repo}: ${result.err.trim()}`);
  const refs: Record<string, string> = {};
  for (const line of result.out.split("\n")) {
    const [ref, hash] = line.trim().split(" ");
    if (
      ref &&
      hash &&
      (ref === `refs/heads/${ticket}` || ref.startsWith(`refs/heads/wb/${ticket}-`))
    )
      refs[ref] = hash;
  }
  return refs;
}

function synthesisPath(info: RunInfo): string {
  return join(info.repo, ".worktrees", info.ticket);
}

function snapshotPath(info: RunInfo, round: number): string {
  return join(info.dispatch, "reach", `before-r${round}.json`);
}

function saveSnapshot(info: RunInfo, round: number): number {
  if (!Number.isInteger(round) || round < 1) throw new Error(`round is not positive: ${round}`);
  const synth = synthesisPath(info);
  const result = reachTarget(info.repo, info.defaultBranch);
  if (result.code === 1) throw new Error(result.out.trim());
  const snapshot: Snapshot = {
    round,
    refs: runRefs(info.repo, info.ticket),
    synthesisHead: currentHead(info.repo, synth),
    synthesisStatus: statusMap(info.repo, synth),
    mainHead: currentHead(info.repo, info.repo),
    mainBranch: branchName(info.repo, info.repo),
  };
  const path = snapshotPath(info, round);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`before r${round}: ${snapshot.synthesisHead}`);
  return 0;
}

function loadSnapshot(info: RunInfo, round: number): Snapshot {
  const parsed = readJson(snapshotPath(info, round), `before r${round}`);
  if (
    parsed.round !== round ||
    typeof parsed.synthesisHead !== "string" ||
    typeof parsed.refs !== "object"
  ) {
    throw new Error(`before r${round} is malformed`);
  }
  return parsed as unknown as Snapshot;
}

function expectedWorkhorseNames(info: RunInfo): string[] {
  const lanes = rec(info.manifest.lanes);
  return Object.keys(lanes)
    .filter((lane) => Object.hasOwn(info.lanes, lane))
    .sort();
}

function reviewersFor(info: RunInfo, round: number): Array<[string, string]> {
  const state = readJson(
    join(info.dispatch, "logs", `review-r${round}.json`),
    `round ${round} reviewer record`,
  );
  const pairs = array(state.reviewers);
  const reviewers: Array<[string, string]> = [];
  for (const pair of pairs) {
    if (
      !Array.isArray(pair) ||
      pair.length < 2 ||
      typeof pair[0] !== "string" ||
      typeof pair[1] !== "string"
    ) {
      throw new Error(`round ${round} has a malformed reviewer record`);
    }
    reviewers.push([pair[0], pair[1]]);
  }
  return reviewers;
}

function roundOwnFolder(info: RunInfo, lens: string, lane: string): string {
  return join(info.repo, ".worktrees", `${info.ticket}-rev-${lens}-${lane}`);
}

function workhorseEvents(info: RunInfo, lane: string): string {
  return join(info.dispatch, "logs", `${lane}-events.jsonl`);
}

function reviewerEvents(info: RunInfo, round: number, lens: string, lane: string): string {
  return join(info.dispatch, "logs", `review-r${round}-${lens}-${lane}.jsonl`);
}

function aggregateLaneReads(reads: LaneRead[]): Touch[] {
  return reads.flatMap((read) => read.touches);
}

function pathChangeTouch(
  info: RunInfo,
  path: string,
  access: Access,
  lane: string,
  detail: string,
): Touch {
  const absolute =
    path.startsWith("refs/") || isAbsolute(path) ? path : physical(join(info.repo, path));
  const place = path.startsWith("refs/") ? "elsewhere" : placeOf(info, absolute, "");
  return {
    lane,
    path: absolute,
    access,
    place,
    kind: access === "write" ? "finding" : "note",
    source: "round",
    detail,
  };
}

function addMainChanges(
  info: RunInfo,
  point: string,
  touches: Touch[],
  initial: boolean,
): { result: ReturnType<typeof reachTarget>; mainDirty: boolean } {
  const result = reachTarget(info.repo, info.defaultBranch);
  if (result.code === 1) throw new Error(result.out.trim());
  for (const path of result.changed) {
    const absolute = resolve(info.repo, path);
    const target = physical(absolute);
    const explained = touches.some(
      (touch) => (touch.path === absolute || touch.path === target) && touch.access === "write",
    );
    const severity: Touch["kind"] = initial && !explained ? "finding" : "note";
    touches.push({
      lane: "",
      path: absolute,
      access: "write",
      place: "main checkout",
      kind: severity,
      source: "checkout",
      detail: explained
        ? "changed by a lane record"
        : "main checkout changed without a lane record",
    });
  }
  if (result.offDefault) {
    touches.push({
      lane: "",
      path: info.repo,
      access: "write",
      place: "main checkout",
      kind: initial ? "finding" : "note",
      source: "checkout",
      detail: `branch ${result.branch} is not the default branch ${info.defaultBranch}`,
    });
  }
  return { result, mainDirty: result.code === 2 };
}

function roundChanges(
  info: RunInfo,
  round: number,
  snapshot: Snapshot,
  reads: LaneRead[],
): { touches: Touch[]; unassignedTracked: boolean } {
  const touches: Touch[] = [];
  const refsNow = runRefs(info.repo, info.ticket);
  const refs = new Set([...Object.keys(snapshot.refs), ...Object.keys(refsNow)]);
  const ticketWorktree = synthesisPath(info);
  const changes: Array<{ path: string; before: string; after: string; tracked: boolean }> = [];
  for (const ref of [...refs].sort()) {
    const before = snapshot.refs[ref] ?? "(absent)";
    const after = refsNow[ref] ?? "(absent)";
    if (before !== after) changes.push({ path: ref, before, after, tracked: true });
  }
  const head = currentHead(info.repo, ticketWorktree);
  if (head !== snapshot.synthesisHead) {
    changes.push({
      path: ticketWorktree,
      before: snapshot.synthesisHead,
      after: head,
      tracked: true,
    });
  }
  const current = statusMap(info.repo, ticketWorktree);
  const fileNames = new Set([...Object.keys(snapshot.synthesisStatus), ...Object.keys(current)]);
  for (const name of fileNames) {
    const before = snapshot.synthesisStatus[name] ?? "(absent)";
    const after = current[name] ?? "(absent)";
    if (before !== after) {
      const absolute = resolve(ticketWorktree, name);
      const tracked = before !== "(absent)" || after !== "??";
      changes.push({ path: absolute, before, after, tracked });
    }
  }
  let unassignedTracked = false;
  const ticketRef = `refs/heads/${info.ticket}`;
  const ticketWorktreeOwner = reads.find((read) =>
    read.touches.some((touch) => touch.access === "write" && touch.path === ticketWorktree),
  );
  const ticketRefOwner = reads.find((read) =>
    read.touches.some((touch) => touch.access === "write" && touch.path === ticketRef),
  );
  for (const change of changes) {
    const matching = reads.filter((read) => read.status === "checked");
    const refName = change.path.startsWith("refs/heads/") ? change.path : "";
    const exactPath = change.path;
    let checkedOutWorktree = "";
    if (refName === ticketRef) checkedOutWorktree = ticketWorktree;
    else if (refName.startsWith(`refs/heads/wb/${info.ticket}-`)) {
      const lane = refName.slice(`refs/heads/wb/${info.ticket}-`.length);
      checkedOutWorktree = join(info.repo, ".worktrees", `${info.ticket}-${lane}`);
    }
    const owners = matching.filter((read) =>
      read.touches.some((touch) => {
        if (touch.access !== "write") return false;
        if (touch.path === exactPath) return true;
        if (refName && checkedOutWorktree && touch.path === checkedOutWorktree) return true;
        if (!refName && inside(exactPath, ticketWorktree) && touch.path === ticketWorktree)
          return true;
        return false;
      }),
    );
    const owner =
      owners[0] ??
      (!refName && inside(exactPath, ticketWorktree)
        ? (ticketRefOwner ?? ticketWorktreeOwner)
        : undefined);
    if (owner) {
      const touch = pathChangeTouch(
        info,
        change.path,
        "write",
        owner.lane,
        `${change.before} -> ${change.after}`,
      );
      touch.lens = owner.lens;
      touches.push(touch);
    } else {
      const humanPath = change.path.startsWith("refs/")
        ? change.path
        : relative(info.repo, change.path) || change.path;
      const detail = `${change.before} -> ${change.after}`;
      const touch = pathChangeTouch(info, change.path, "read", "", `unexplained change ${detail}`);
      touch.kind = "note";
      touch.detail = `unexplained ${humanPath}: ${detail}`;
      touches.push(touch);
      if (change.tracked) unassignedTracked = true;
    }
  }
  return { touches, unassignedTracked };
}

function eventOf(touch: Touch, point: string): ReachEvent {
  if (touch.kind === "expected") throw new Error("expected lane access is not a reach event");
  return {
    kind: touch.kind,
    point,
    ...(touch.lane ? { lane: touch.lane } : {}),
    ...(touch.lens ? { lens: touch.lens } : {}),
    access: touch.access,
    place: touch.place,
    path: touch.path,
    ...(touch.user !== undefined ? { user: touch.user } : {}),
    ...(touch.detail ? { reason: touch.detail } : {}),
  };
}

function writeAction(
  info: RunInfo,
  actor: string,
  action: string,
  target: string,
  detail: string,
): void {
  const result = run(Bun.which("bun") ?? "bun", [
    "--no-env-file",
    "--config=/dev/null",
    LOG_ACTION,
    info.dispatch,
    actor,
    action,
    target,
    detail,
  ]);
  if (result.code !== 0)
    throw new Error(`log-action failed: ${result.err.trim() || result.out.trim()}`);
}

function writeRunLog(info: RunInfo, value: string): void {
  const result = run(Bun.which("bun") ?? "bun", [
    "--no-env-file",
    "--config=/dev/null",
    RUN_LOG,
    info.dispatch,
    value,
  ]);
  if (result.code !== 0)
    throw new Error(`run-log failed: ${result.err.trim() || result.out.trim()}`);
}

function laneStatusEvents(reads: LaneRead[], point: string): ReachEvent[] {
  const events: ReachEvent[] = [];
  for (const read of reads) {
    if (read.status === "not checked") {
      events.push({
        kind: "note",
        point,
        lane: read.lane,
        lens: read.lens,
        path: read.events,
        reason: `not checked: ${read.reason}`,
      });
    }
    for (const touch of read.touches) {
      if (touch.kind === "expected") continue;
      events.push(eventOf(touch, point));
    }
  }
  return events;
}

function logPoint(
  info: RunInfo,
  point: string,
  reads: LaneRead[],
  touches: Touch[],
  result: ReturnType<typeof reachTarget>,
): { status: string; code: number } {
  const all = [
    ...laneStatusEvents(reads, point),
    ...touches.filter((touch) => touch.source !== "stream").map((touch) => eventOf(touch, point)),
  ];
  const hasFinding = all.some((event) => event.kind === "finding");
  const hasNote = all.some((event) => event.kind === "note");
  const notChecked = reads.some((read) => read.status === "not checked");
  const status = hasFinding ? "finding" : hasNote || notChecked ? "note" : "clean";
  writeAction(
    info,
    "coachman",
    "reach",
    point,
    JSON.stringify({
      kind: "point",
      point,
      result: status,
      main: {
        branch: result.branch,
        defaultBranch: result.defaultBranch,
        head: result.head,
        changed: result.changed,
        offDefault: result.offDefault,
      },
      lanes: reads.map((read) => ({
        lane: read.lane,
        lens: read.lens ?? "",
        harness: read.harness,
        status: read.status,
        reason: read.reason ?? "",
      })),
    }),
  );
  for (const event of all) {
    const actor = event.lane ? `lane:${event.lane}` : "coachman";
    writeAction(info, actor, "reach", point, JSON.stringify(event));
  }
  for (const touch of all) {
    console.log(
      `${touch.kind} ${touch.lane || "main checkout"}${touch.lens ? ` ${touch.lens}` : ""}: ${touch.access ?? "change"} ${touch.path ?? ""}${touch.place ? ` (${touch.place})` : ""}${touch.reason ? ` · ${touch.reason}` : ""}`,
    );
  }
  console.log(`${point}: ${status}`);
  const anyUnknown = notChecked || hasNote;
  return { status, code: hasFinding || result.code === 2 ? 2 : anyUnknown ? 3 : 0 };
}

function checkWorkhorses(info: RunInfo): number {
  const lanes = expectedWorkhorseNames(info);
  const reads = lanes.map((lane) =>
    readLane(
      info,
      lane,
      workhorseEvents(info, lane),
      join(info.repo, ".worktrees", `${info.ticket}-${lane}`),
    ),
  );
  const touches = aggregateLaneReads(reads);
  const { result } = addMainChanges(info, "workhorses", touches, true);
  const outcome = logPoint(info, "workhorses", reads, touches, result);
  return outcome.code;
}

function checkRound(info: RunInfo, round: number): number {
  const reviewers = reviewersFor(info, round);
  const reads = reviewers.map(([lens, lane]) =>
    readLane(
      info,
      lane,
      reviewerEvents(info, round, lens, lane),
      roundOwnFolder(info, lens, lane),
      lens,
    ),
  );
  const touches = aggregateLaneReads(reads);
  for (const touch of touches.filter((entry) => entry.kind === "finding")) {
    touch.user = !runOwnedWrite(info, touch.path);
  }
  const snapshot = loadSnapshot(info, round);
  const changes = roundChanges(info, round, snapshot, reads);
  touches.push(...changes.touches);
  const { result } = addMainChanges(info, `r${round}`, touches, false);

  const voided = new Set<string>();
  for (const read of reads) {
    const findings = read.touches.filter((touch) => touch.kind === "finding");
    if (findings.length > 0) voided.add(`${read.lens ?? ""}\0${read.lane}`);
  }
  if (changes.unassignedTracked) {
    for (const [lens, lane] of reviewers) voided.add(`${lens}\0${lane}`);
  }
  for (const key of voided) {
    const [lens = "", lane = ""] = key.split("\0");
    const reason = changes.unassignedTracked ? "unexplained round change" : "reach";
    writeAction(info, "coachman", "degrade", lane, `${lens} r${round}: reach`);
    writeRunLog(info, `${lane} ${lens}: DEGRADED, reach`);
    const event: ReachEvent = { kind: "void", point: `r${round}`, lane, lens, reason };
    writeAction(info, `lane:${lane}`, "reach", `r${round}`, JSON.stringify(event));
    console.log(`voided verdict ${lens} ${lane} r${round}: ${reason}`);
  }
  const logged = logPoint(info, `r${round}`, reads, touches, result);
  return logged.code;
}

function runOwnedWrite(info: RunInfo, path: string): boolean {
  if (path.startsWith("refs/heads/")) {
    const branch = path.slice("refs/heads/".length);
    return branch === info.ticket || branch.startsWith(`wb/${info.ticket}-`);
  }
  if (!isAbsolute(path)) return false;
  const worktrees = join(info.repo, ".worktrees");
  if (!inside(path, worktrees)) return false;
  const name = relative(worktrees, path).split(sep)[0] ?? "";
  return name === info.ticket || name.startsWith(`${info.ticket}-`);
}

function readAllRecords(info: RunInfo): LaneRead[] {
  const reads = expectedWorkhorseNames(info).map((lane) =>
    readLane(
      info,
      lane,
      workhorseEvents(info, lane),
      join(info.repo, ".worktrees", `${info.ticket}-${lane}`),
    ),
  );
  const logs = join(info.dispatch, "logs");
  // Review rounds are enumerated from their authoritative review-round records.
  const rounds = new Set<number>();
  try {
    for (const entry of readFileNames(logs)) {
      const match = /^review-r([1-9][0-9]*)\.json$/u.exec(entry);
      if (match) rounds.add(Number(match[1]));
    }
  } catch {
    throw new Error(`cannot list review records in ${logs}`);
  }
  for (const round of [...rounds].sort((a, b) => a - b)) {
    for (const [lens, lane] of reviewersFor(info, round)) {
      reads.push(
        readLane(
          info,
          lane,
          reviewerEvents(info, round, lens, lane),
          roundOwnFolder(info, lens, lane),
          lens,
        ),
      );
    }
  }
  return reads;
}

function readFileNames(path: string): string[] {
  return readdirSync(path);
}

function checkCard(info: RunInfo): number {
  const reads = readAllRecords(info);
  const touches = aggregateLaneReads(reads);
  const synth = synthesisPath(info);
  for (const [path, status] of Object.entries(statusMap(info.repo, synth))) {
    const absolute = resolve(synth, path);
    touches.push({
      path: absolute,
      access: "write",
      place: "synthesis worktree",
      kind: "note",
      lane: "",
      source: "round",
      detail: `synthesis worktree changed at card (${status})`,
    });
  }
  const { result } = addMainChanges(info, "card", touches, false);
  const outcome = logPoint(info, "card", reads, touches, result);
  return outcome.code;
}

function refsMap(repo: string, ticket: string): Record<string, string> {
  return runRefs(repo, ticket);
}

function savePatch(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function ensureInside(parent: string, path: string): void {
  const absoluteParent = physical(parent);
  const absolutePath = resolve(path);
  const realParent = physical(dirname(absolutePath));
  if (!inside(absolutePath, resolve(parent)) || !inside(realParent, absoluteParent)) {
    throw new Error(`refusing to move a path outside ${parent}`);
  }
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function restoreRound(info: RunInfo, round: number): number {
  const snapshot = loadSnapshot(info, round);
  const saved = join(info.dispatch, "reach", `r${round}`);
  mkdirSync(saved, { recursive: true });
  const nowRefs = refsMap(info.repo, info.ticket);
  const changedRefs = new Set([...Object.keys(snapshot.refs), ...Object.keys(nowRefs)]);
  for (const ref of [...changedRefs].sort()) {
    const before = snapshot.refs[ref] ?? "";
    const after = nowRefs[ref] ?? "";
    if (before === after) continue;
    const safe = ref.replace(/[^A-Za-z0-9._-]/gu, "_");
    const patch =
      before && after
        ? run("git", ["-C", info.repo, "diff", "--binary", before, after])
        : { code: 0, out: "" };
    if (patch.code !== 0) throw new Error(`cannot save branch diff for ${ref}`);
    savePatch(join(saved, "branches", `${safe}.patch`), patch.out);
    savePatch(
      join(saved, "branches", `${safe}.json`),
      `${JSON.stringify({ ref, before: before || null, after: after || null }, null, 2)}\n`,
    );
  }

  const synth = synthesisPath(info);
  const currentHead = currentHeadForRestore(info.repo, synth);
  const tracked = run("git", ["-C", synth, "diff", "--binary", "HEAD"]);
  if (tracked.code !== 0)
    throw new Error(`cannot save synthesis worktree diff: ${tracked.err.trim()}`);
  const commitPatch =
    snapshot.synthesisHead === currentHead
      ? ""
      : run("git", ["-C", info.repo, "diff", "--binary", snapshot.synthesisHead, currentHead]).out;
  savePatch(join(saved, "synthesis.patch"), `${commitPatch}${tracked.out}`);
  savePatch(
    join(saved, "synthesis.json"),
    `${JSON.stringify({ before: snapshot.synthesisHead, after: currentHead }, null, 2)}\n`,
  );

  // Restore the checked-out ticket branch through its worktree first, then restore the other
  // run branches by ref. Reviewers can move a branch with update-ref from any scratch.
  if (existsSync(synth)) {
    const reset = run("git", [
      "-C",
      synth,
      "reset",
      "--hard",
      snapshot.refs[`refs/heads/${info.ticket}`] ?? snapshot.synthesisHead,
    ]);
    if (reset.code !== 0) throw new Error(`cannot restore synthesis branch: ${reset.err.trim()}`);
  }
  for (const ref of [...changedRefs].sort()) {
    if (ref === `refs/heads/${info.ticket}`) continue;
    const before = snapshot.refs[ref];
    const branch = ref.replace(/^refs\/heads\//u, "");
    const match = /^wb\/.+-(.+)$/u.exec(branch);
    const lane = match?.[1] ?? "";
    const worktree = lane ? join(info.repo, ".worktrees", `${info.ticket}-${lane}`) : "";
    if (before && worktree && existsSync(worktree) && branchName(info.repo, worktree) === branch) {
      const reset = run("git", ["-C", worktree, "reset", "--hard", before]);
      if (reset.code !== 0) throw new Error(`cannot restore ${ref}: ${reset.err.trim()}`);
    } else if (before) {
      const update = run("git", ["-C", info.repo, "update-ref", ref, before]);
      if (update.code !== 0) throw new Error(`cannot restore ${ref}: ${update.err.trim()}`);
    } else {
      const remove = run("git", ["-C", info.repo, "update-ref", "-d", ref]);
      if (remove.code !== 0)
        throw new Error(`cannot remove new run branch ${ref}: ${remove.err.trim()}`);
    }
  }

  const beforeFiles = new Set(Object.keys(snapshot.synthesisStatus));
  const afterFiles = statusMap(info.repo, synth);
  for (const path of Object.keys(afterFiles)) {
    if (beforeFiles.has(path) || afterFiles[path] !== "??") continue;
    const source = join(synth, path);
    const destination = join(saved, path);
    ensureInside(synth, source);
    ensureInside(saved, destination);
    if (pathExists(destination))
      throw new Error(`reach restore copy already exists: ${destination}`);
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(source, destination);
  }
  console.log(`restored r${round}; saved changes under ${saved}`);
  return 0;
}

function currentHeadForRestore(repo: string, where: string): string {
  return currentHead(repo, where);
}

function pointFromAction(line: string, index: number): { actor: string; event: ReachEvent } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    throw new Error(`actions.jsonl line ${index} is not JSON`);
  }
  const row = rec(parsed);
  if (row.action !== "reach") throw new Error(`actions.jsonl line ${index} is not a reach action`);
  let detail: unknown;
  try {
    detail = JSON.parse(text(row.detail)) as unknown;
  } catch {
    throw new Error(`actions.jsonl line ${index} has an unreadable reach detail`);
  }
  return { actor: text(row.actor), event: rec(detail) as ReachEvent };
}

export function reachActions(dispatch: string): Array<{ actor: string; event: ReachEvent }> {
  const path = join(dispatch, "actions.jsonl");
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`cannot read ${path}: ${String(e)}`);
  }
  const out: Array<{ actor: string; event: ReachEvent }> = [];
  let i = 0;
  for (const line of contents.split(/\r?\n/u)) {
    if (!line) continue;
    i++;
    let row: RecordOf;
    try {
      row = JSON.parse(line) as RecordOf;
    } catch {
      throw new Error(`actions.jsonl line ${i} is not JSON`);
    }
    if (row.action === "reach") out.push(pointFromAction(line, i));
  }
  return out;
}

function usage(): never {
  console.error(
    "usage: reach.ts stream <dispatch> <lane> <events> <own-folder> | before <dispatch> <round> | check <dispatch> workhorses|r<round>|card | restore <dispatch> r<round>",
  );
  process.exit(1);
}

function main(argv: string[]): number {
  try {
    const command = argv[0];
    if (command === "stream") {
      if (argv.length !== 5) usage();
      const info = loadRun(argv[1]!);
      return readStreamMode(info, argv[2]!, argv[3]!, argv[4]!);
    }
    if (command === "before") {
      if (argv.length !== 3 || !/^[1-9][0-9]*$/u.test(argv[2]!)) usage();
      return saveSnapshot(loadRun(argv[1]!), Number(argv[2]));
    }
    if (command === "check") {
      if (argv.length !== 3) usage();
      const info = loadRun(argv[1]!);
      if (argv[2] === "workhorses") return checkWorkhorses(info);
      if (argv[2] === "card") return checkCard(info);
      const round = /^r([1-9][0-9]*)$/u.exec(argv[2]!);
      if (round) return checkRound(info, Number(round[1]));
      usage();
    }
    if (command === "restore") {
      if (argv.length !== 3) usage();
      const info = loadRun(argv[1]!);
      const round = /^r([1-9][0-9]*)$/u.exec(argv[2]!);
      if (!round) usage();
      return restoreRound(info, Number(round[1]));
    }
    usage();
  } catch (e) {
    console.error(`reach: ${String(e)}`);
    return 1;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
