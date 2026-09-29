#!/usr/bin/env bun
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { command, scriptDir, writeError, writeOut } from "./lib/core.ts";

const HERE = scriptDir(import.meta.url);
const SELF = join(HERE, "host.ts");
const SOURCE = "custom:postmaster";
const META = "custom:postmaster-meta";
let STATE = process.env.POSTMASTER_HOST_STATE ?? join(homedir(), ".postmaster", "host");
const PANE_IDS = ["HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID", "TMUX_PANE"];
let PLACE_ENV: string[] = [];

class HostError extends Error {
  constructor(
    message: string,
    readonly code = 1,
  ) {
    super(message);
  }
}
function die(message: string, code = 1): never {
  throw new HostError(message, code);
}
function warn(message: string): void {
  writeError(`host: ${message}`);
}
function has(program: string): boolean {
  const paths = (process.env.PATH ?? "").split(":");
  return paths.some((path) => {
    try {
      accessSync(join(path || ".", program), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}
function run(
  program: string,
  args: string[] = [],
  options: { timeout?: number; cwd?: string; env?: Record<string, string | undefined>; input?: string } = {},
) {
  return command(program, args, options);
}
function limit(seconds: number, program: string, args: string[] = []) {
  return has("timeout") ? run("timeout", [String(seconds), program, ...args]) : run(program, args);
}
function clean(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("");
}
function count(value: string | undefined, what: string): number {
  if (value === undefined || !/^\d+$/.test(value)) die(`${what} must be a whole number, not '${String(value ?? "")}'`);
  const result = Number(value);
  if (!Number.isSafeInteger(result)) die(`${what} must be a whole number, not '${value}'`);
  return result;
}
function quote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function jsonValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}
function _jsonStdout(text: string, expression: (data: any) => unknown): string {
  const value = parseJson(text);
  return value === null ? "" : jsonValue(expression(value));
}
function herdrUp(): boolean {
  return has("herdr") && limit(5, "herdr", ["workspace", "list"]).code === 0;
}
function detect(): string {
  const forced = process.env.POSTMASTER_HOST ?? "";
  if (forced === "none") return "none";
  if (!["", "auto", "herdr", "tmux"].includes(forced))
    warn(`POSTMASTER_HOST=${forced} is not herdr, tmux, none or auto; detecting`);
  if (forced === "tmux") {
    if (has("tmux")) return "tmux";
    warn("POSTMASTER_HOST=tmux, but tmux is not on PATH; detecting");
  }
  if (herdrUp()) return "herdr";
  if (forced === "herdr") warn("POSTMASTER_HOST=herdr, but no Herdr server answers; detecting");
  return has("tmux") ? "tmux" : "none";
}
function cloneOrigin(path: string): string {
  const result = run(join(HERE, "cut-scratch.sh"), ["--kind", path]);
  return result.code === 0 && result.stdout.startsWith("clone ") ? result.stdout.trim().slice(6) : "";
}
function repoOf(path: string): string {
  const clone = cloneOrigin(path);
  if (clone) return clone;
  const result = run("git", ["-C", path, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (result.code !== 0) return "";
  const common = result.stdout.trim();
  return common.endsWith("/.git") ? dirname(common) : common;
}
function tmuxSession(path: string): string {
  const repo = repoOf(path) || path;
  return `postmaster-${basename(repo).replace(/[.:]/g, "_")}`;
}
function handleOf(text: string): string {
  let handle = text.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  if (!/^[a-z]/.test(handle)) handle = `p${handle}`;
  if (handle.length > 32) {
    const crc = run("cksum", [], { input: text }).stdout.split(/\s+/, 1)[0] ?? "0";
    handle = `${handle.slice(0, 23)}-${Number(crc).toString(16).padStart(8, "0")}`;
  }
  return handle;
}
function nameCmd(dispatch: string, role = ""): string {
  if (!dispatch) die("usage: host.sh name <dispatch> [<role or lane>]");
  let name = "";
  try {
    const content = readFileSync(join(dispatch, "brief.md"), "utf8");
    let inDispatch = false;
    for (const line of content.split(/\r?\n/)) {
      if (line.startsWith("## ")) inDispatch = line.trim() === "## Dispatch";
      else if (inDispatch && line.startsWith("name:")) {
        name = line
          .slice(5)
          .replace(/\s{2,}\(.*\)$/, "")
          .trim();
        break;
      }
    }
  } catch {}
  if (!name) name = basename(dispatch);
  return clean(name + (role ? ` · ${role}` : ""));
}

type ProcessInfo = { group: number; start: string };
type Registry = { dir: string; name: string; start: string; boot: string; members: Array<[number, string]> };
function runBoot(...args: string[]): string {
  return run(args[0]!, args.slice(1)).stdout.trim();
}
function bootId(): string {
  try {
    return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    return runBoot("sysctl", "-n", "kern.boottime").split(/\s+/).join(" ");
  }
}
function bootTime(): number | null {
  try {
    const text = readFileSync("/proc/stat", "utf8");
    const line = text.split("\n").find((row: string) => row.startsWith("btime "));
    if (line) return Number(line.split(/\s+/)[1]);
  } catch {}
  const words = runBoot("sysctl", "-n", "kern.boottime").replace(/,/g, " ").split(/\s+/);
  const at = words.indexOf("sec");
  return at < 0 ? null : Number(words[at + 1]);
}
function procStat(pid: number): { name: string; fields: string[] } | null {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8");
    const pos = raw.lastIndexOf(")");
    return {
      name: raw.slice(raw.indexOf("(") + 1, pos),
      fields: raw
        .slice(pos + 1)
        .trim()
        .split(/\s+/),
    };
  } catch {
    return null;
  }
}
function startOf(pid: number): string {
  const p = procStat(pid);
  if (p) return p.fields[0] !== "Z" ? (p.fields[19] ?? "") : "";
  const fields = run("ps", ["-o", "stat=,lstart=", "-p", String(pid)])
    .stdout.trim()
    .split(/\s+/);
  return fields.length >= 6 && !fields[0]!.startsWith("Z") ? fields.slice(1, 6).join(" ") : "";
}
function processes(): Map<number, ProcessInfo> {
  const table = new Map<number, ProcessInfo>();
  try {
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      const stat = procStat(Number(entry));
      if (stat && stat.fields[0] !== "Z" && stat.fields[2] && stat.fields[19])
        table.set(Number(entry), { group: Number(stat.fields[2]), start: stat.fields[19]! });
    }
    return table;
  } catch {}
  const output = run("ps", ["-A", "-o", "pid=,pgid=,stat=,lstart="]).stdout;
  for (const line of output.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length >= 8 && /^\d+$/.test(fields[0]!) && /^\d+$/.test(fields[1]!) && !fields[2]!.startsWith("Z"))
      table.set(Number(fields[0]), { group: Number(fields[1]), start: fields.slice(3, 8).join(" ") });
  }
  return table;
}
function startedAt(start: string): number | null {
  if (/^\d+$/.test(start)) {
    const booted = bootTime();
    const hz = Number(run("getconf", ["CLK_TCK"]).stdout.trim()) || 100;
    return booted === null ? null : booted + Number(start) / hz;
  }
  const parsed = Date.parse(start);
  return Number.isNaN(parsed) ? null : parsed / 1000;
}
function registryDir(): string {
  return join(STATE, "launches");
}
function recordPath(group: number): string {
  return join(registryDir(), String(group));
}
function loadRecord(path: string): Registry | null {
  try {
    const lines = readFileSync(path, "utf8").split("\n");
    const rec: Registry = { dir: lines[0] ?? "", name: lines[1] ?? "", start: "", boot: "", members: [] };
    for (const line of lines.slice(2)) {
      const at = line.indexOf(" ");
      if (at < 0) continue;
      const key = line.slice(0, at);
      const value = line.slice(at + 1);
      if (key === "start") rec.start = value;
      else if (key === "boot") rec.boot = value;
      else if (key === "member") {
        const [pid, start] = value.split(" ", 2);
        if (/^\d+$/.test(pid ?? "") && start) rec.members.push([Number(pid), start]);
      }
    }
    return rec;
  } catch {
    return null;
  }
}
function saveRecord(path: string, rec: Registry): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.new`;
  const body =
    rec.dir +
    "\n" +
    rec.name +
    "\nstart " +
    rec.start +
    "\nboot " +
    rec.boot +
    "\n" +
    rec.members.map(([pid, start]) => `member ${pid} ${start}\n`).join("");
  writeFileSync(temp, body, { mode: 0o600 });
  renameSync(temp, path);
}
function recordRoots(
  path: string,
  group: number,
  rec: Registry,
  procs: Map<number, ProcessInfo>,
  boot: string,
): string[] {
  if (!rec.start && !rec.boot) {
    const booted = bootTime();
    let written = 0;
    try {
      written = statSync(path).mtimeMs / 1000;
    } catch {
      return [];
    }
    if (!procs.has(group) || booted === null || written < booted) return [];
    const began = startedAt(procs.get(group)!.start);
    if (began === null || began > written + 2) return [];
    rec.start = procs.get(group)!.start;
    rec.boot = boot;
    saveRecord(path, rec);
  }
  if (!rec.boot || rec.boot !== boot) return [];
  if (procs.has(group) && rec.start && procs.get(group)!.start === rec.start) return [`group|${group}|${rec.start}`];
  return rec.members
    .filter(([pid, start]) => procs.has(pid) && procs.get(pid)!.start === start)
    .map(([pid, start]) => `tree|${pid}|${start}`);
}
function fixtureGuard(): void {
  const fixture = process.env.POSTMASTER_HOST_FIXTURE;
  if (!fixture) return;
  if (resolve(STATE).startsWith(resolve(fixture) + sep)) return;
  warn(`refusing the registry at ${STATE}: a self-test uses only its fixture, ${fixture}`);
  throw new HostError("registry is outside the self-test fixture", 1);
}
function registryAdd(group: number, dir: string, name: string): void {
  fixtureGuard();
  const rec: Registry = { dir, name, start: startOf(group), boot: bootId(), members: [] };
  saveRecord(recordPath(group), rec);
}
function registryMembers(group: number): void {
  fixtureGuard();
  const path = recordPath(group);
  const rec = loadRecord(path);
  if (!rec) return;
  rec.members = [...processes()]
    .filter(([, value]) => value.group === group)
    .map(([pid, value]): [number, string] => [pid, value.start])
    .sort((a, b) => a[0] - b[0]);
  if (rec.members.length) saveRecord(path, rec);
  else rmSync(path, { force: true });
}
function registryScan(dir: string): Array<{ group: string; name: string; roots: string[] }> {
  fixtureGuard();
  const procs = processes();
  const boot = bootId();
  let names: string[] = [];
  try {
    names = readdirSync(registryDir()).sort();
  } catch {}
  const found: Array<{ group: string; name: string; roots: string[] }> = [];
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    const path = join(registryDir(), name);
    const rec = loadRecord(path);
    if (!rec) continue;
    const roots = recordRoots(path, Number(name), rec, procs, boot);
    if (!roots.length) rmSync(path, { force: true });
    else if (rec.dir === dir) found.push({ group: name, name: rec.name, roots });
  }
  return found;
}
function herdr(args: string[], timeout = 0) {
  return timeout ? limit(timeout, "herdr", args) : run("herdr", args);
}
function herdrData(args: string[]): any {
  const result = herdr(args);
  return result.code === 0 ? (parseJson(result.stdout)?.result ?? null) : null;
}
function herdrPlace(
  name: string,
  cwd: string,
  where = "worktree",
): { space: string; tab: string; pane: string } | null {
  const rootResult = run("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
  const top = rootResult.code === 0 ? resolve(rootResult.stdout.trim()) : "";
  let source = "";
  let root = "";
  let repoName = "";
  let worktreePath = "";
  let worktreeKind = "";
  let open = "";
  const listed = top ? herdr(["worktree", "list", "--cwd", cwd]) : null;
  if (listed?.code === 0) {
    const data = parseJson(listed.stdout)?.result;
    const src = data?.source ?? {};
    source = jsonValue(src.source_workspace_id);
    root = jsonValue(src.repo_root);
    repoName = jsonValue(src.repo_name);
    const wt = (data?.worktrees ?? []).find((entry: any) => resolve(entry.path) === top);
    if (wt) {
      worktreePath = jsonValue(wt.path);
      worktreeKind = wt.is_linked_worktree ? "linked" : "main";
      open = jsonValue(wt.open_workspace_id);
    }
  }
  if (!root || !worktreePath || (!open && top && cloneOrigin(top))) {
    const response = herdr(["workspace", "create", "--cwd", cwd, "--label", name, "--no-focus", ...PLACE_ENV]);
    if (response.code !== 0) return null;
    const data = parseJson(response.stdout)?.result;
    const space = jsonValue(data?.workspace?.workspace_id);
    const tab = jsonValue(data?.tab?.tab_id);
    const pane = jsonValue(data?.root_pane?.pane_id);
    if (!space || !tab || !pane) return null;
    herdr(["workspace", "report-metadata", space, "--source", META, "--token", "postmaster=opened"]);
    herdr(["pane", "report-metadata", pane, "--source", META, "--title", name, "--token", "postmaster=launch"]);
    return { space, tab, pane };
  }
  let opened = false;
  if (!source) {
    const response = herdr(["workspace", "create", "--cwd", root, "--label", repoName, "--no-focus"]);
    if (response.code !== 0) return null;
    source = jsonValue(parseJson(response.stdout)?.result?.workspace?.workspace_id);
  }
  let space = "";
  let tab = "";
  let pane = "";
  if (where === "repo" || worktreeKind === "main") space = source;
  else if (open) space = open;
  else {
    const response = herdr([
      "worktree",
      "open",
      "--workspace",
      source,
      "--path",
      worktreePath,
      "--label",
      name,
      "--no-focus",
    ]);
    if (response.code !== 0) return null;
    const data = parseJson(response.stdout)?.result;
    space = jsonValue(data?.workspace?.workspace_id);
    tab = jsonValue(data?.tab?.tab_id);
    pane = jsonValue(data?.root_pane?.pane_id);
    if (tab) herdr(["tab", "rename", tab, name]);
    opened = true;
  }
  if (!pane) {
    const response = herdr([
      "tab",
      "create",
      "--workspace",
      space,
      "--cwd",
      cwd,
      "--label",
      name,
      "--no-focus",
      ...PLACE_ENV,
    ]);
    if (response.code !== 0) return null;
    const data = parseJson(response.stdout)?.result;
    tab = jsonValue(data?.tab?.tab_id);
    pane = jsonValue(data?.root_pane?.pane_id);
  }
  if (!space || !tab || !pane) return null;
  if (opened) herdr(["workspace", "report-metadata", space, "--source", META, "--token", "postmaster=opened"]);
  herdr(["pane", "report-metadata", pane, "--source", META, "--title", name, "--token", "postmaster=launch"]);
  return { space, tab, pane };
}
type Spec = {
  name: string;
  cwd: string;
  rundir: string;
  state: string;
  out: string;
  err: string;
  marker: string;
  pidfile: string;
  append: string;
  argv: string[];
};
const SPEC_FIELDS = ["name", "cwd", "rundir", "state", "out", "err", "marker", "pidfile", "append", "argv", "env"];
function writeSpec(spec: string, fields: Spec): void {
  mkdirSync(spec, { recursive: true, mode: 0o700 });
  for (const name of SPEC_FIELDS.slice(0, 9)) writeFileSync(join(spec, name), (fields as any)[name], { mode: 0o600 });
  writeFileSync(join(spec, "argv"), `${fields.argv.join("\0")}\0`, { mode: 0o600 });
}
function readSpec(spec: string): Spec {
  const get = (name: string) => readFileSync(join(spec, name), "utf8");
  return {
    name: get("name"),
    cwd: get("cwd"),
    rundir: get("rundir"),
    state: get("state"),
    out: get("out"),
    err: get("err"),
    marker: get("marker"),
    pidfile: get("pidfile"),
    append: get("append"),
    argv: get("argv").split("\0").filter(Boolean),
  };
}
function dropSpec(spec: string): void {
  for (const name of SPEC_FIELDS) {
    try {
      rmSync(join(spec, name), { force: true });
    } catch {}
  }
  try {
    rmSync(join(spec, "claimed"), { recursive: true, force: true });
    rmSync(spec, { recursive: true, force: true });
  } catch {}
}
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function touch(path: string): void {
  if (!path) return;
  try {
    writeFileSync(path, "", { flag: "a" });
    const now = new Date();
    utimesSync(path, now, now);
  } catch {}
}
function markerRemove(path: string): void {
  if (path)
    try {
      rmSync(path, { force: true });
    } catch {}
}
function _writeEnvPipe(path: string): void {
  let fd = -1;
  const deadline = Date.now() + 120_000;
  while (fd < 0 && Date.now() < deadline && existsSync(dirname(path))) {
    try {
      fd = openSync(path, constants.O_WRONLY | constants.O_NONBLOCK);
    } catch (error) {
      if ((error as { code?: string }).code !== "ENXIO") return;
      sleepSync(100);
    }
  }
  if (fd < 0) return;
  try {
    const body = new TextEncoder().encode(
      `${Object.entries(process.env)
        .filter((entry): entry is [string, string] => entry[1] !== undefined)
        .map(([key, value]) => `${key}=${value}\0`)
        .join("")}POSTMASTER_ENV_OK=1\0`,
    );
    let at = 0;
    while (at < body.length) at += writeSync(fd, body, at, body.length - at);
  } finally {
    closeSync(fd);
  }
}
function readEnvPipe(path: string): Record<string, string> | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const deadline = Date.now() + 30_000;
  try {
    while (Date.now() < deadline) {
      const part = new Uint8Array(65536);
      let read = 0;
      try {
        read = readSync(fd, part, 0, part.length, null);
      } catch (error) {
        if ((error as { code?: string }).code !== "EAGAIN" && (error as { code?: string }).code !== "EWOULDBLOCK")
          throw error;
      }
      if (read > 0) {
        chunks.push(part.slice(0, read));
        total += read;
        const joined = new Uint8Array(total);
        let pos = 0;
        for (const chunk of chunks) {
          joined.set(chunk, pos);
          pos += chunk.length;
        }
        if (new TextDecoder().decode(joined).includes("POSTMASTER_ENV_OK=1\0")) {
          const env: Record<string, string> = {};
          for (const kv of new TextDecoder().decode(joined).split("\0")) {
            const at = kv.indexOf("=");
            if (at > 0) env[kv.slice(0, at)] = kv.slice(at + 1);
          }
          delete env.POSTMASTER_ENV_OK;
          return env;
        }
      }
      sleepSync(50);
    }
  } finally {
    closeSync(fd);
  }
  return null;
}

function absolute(path: string): string {
  return path === "" || path.startsWith("/") ? path : resolve(process.cwd(), path);
}
function appendFailure(err: string, marker: string, message: string): never {
  if (err)
    try {
      writeFileSync(err, `host: ${message}\n`, { flag: "a" });
    } catch {}
  touch(marker);
  die(message);
}
function startDetached(args: string[], env?: Record<string, string | undefined>) {
  const child = spawn("bun", [SELF, ...args], { detached: true, stdio: "ignore", env: env ?? process.env });
  child.unref();
  return child.pid ?? 0;
}
async function watch(pid: number, marker: string): Promise<void> {
  while (true) {
    if (!procStat(pid) || procStat(pid)?.fields[0] === "Z") break;
    await Bun.sleep(500);
  }
  touch(marker);
}
async function envWrite(path: string): Promise<void> {
  const until = Date.now() + 120_000;
  while (Date.now() < until && existsSync(dirname(path))) {
    try {
      const fd = openSync(path, constants.O_WRONLY | constants.O_NONBLOCK);
      try {
        const data = new TextEncoder().encode(
          `${Object.entries(process.env)
            .filter((entry): entry is [string, string] => entry[1] !== undefined)
            .map(([key, value]) => `${key}=${value}\0`)
            .join("")}POSTMASTER_ENV_OK=1\0`,
        );
        let at = 0;
        while (at < data.length) at += writeSync(fd, data, at, data.length - at);
      } finally {
        closeSync(fd);
      }
      return;
    } catch (error) {
      if ((error as { code?: string }).code !== "ENXIO" && (error as { code?: string }).code !== "ENOENT") return;
      await Bun.sleep(100);
    }
  }
}
async function runLaunch(specDir: string, mode: string): Promise<number> {
  if (mode !== "bg") {
    try {
      mkdirSync(join(specDir, "claimed"));
    } catch {
      writeError("host: this launch was started elsewhere; nothing to do here.");
      return 0;
    }
  }
  let spec: Spec;
  try {
    spec = readSpec(specDir);
  } catch {
    appendFailure("", "", "launch specification is incomplete");
  }
  STATE = spec.state;
  const paneEnv = mode === "bg" ? { ...process.env } : readEnvPipe(join(specDir, "env"));
  dropSpec(specDir);
  if (!paneEnv) {
    const message = `the caller's environment never arrived, so '${spec.name}' did not start`;
    appendFailure(spec.err, spec.marker, message);
  }
  const env: Record<string, string> = {};
  const paneKeys = new Set(PANE_IDS);
  const drop = new Set(["POSTMASTER_LAUNCH_NAME", ...PANE_IDS]);
  const keep =
    mode === "herdr"
      ? ["HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID", "HERDR_ENV", "HERDR_SOCKET_PATH", "HERDR_BIN_PATH"]
      : mode === "tmux"
        ? ["TMUX", "TMUX_PANE"]
        : [];
  if (mode === "herdr") for (const key of ["HERDR_ENV", "HERDR_SOCKET_PATH", "HERDR_BIN_PATH"]) drop.add(key);
  if (mode === "tmux") drop.add("TMUX");
  for (const [key, value] of Object.entries(paneEnv)) if (!drop.has(key) && value !== undefined) env[key] = value;
  for (const key of keep) if (process.env[key] !== undefined) env[key] = process.env[key]!;
  for (const key of paneKeys) if (keep.includes(key) && process.env[key] !== undefined) env[key] = process.env[key]!;
  env.POSTMASTER_LAUNCH_NAME = spec.name;

  let stdoutFd = -1;
  let stderrFd = -1;
  try {
    const outPath = spec.out || (mode === "bg" ? "/dev/null" : "");
    const errPath = spec.err || (mode === "bg" ? "/dev/null" : "");
    if (outPath) stdoutFd = openSync(outPath, spec.append === "1" && spec.out ? "a" : "w", 0o666);
    if (errPath) stderrFd = openSync(errPath, "w", 0o666);
  } catch (error) {
    if (stdoutFd >= 0) closeSync(stdoutFd);
    if (stderrFd >= 0) closeSync(stderrFd);
    appendFailure(spec.err, spec.marker, `cannot open launch output: ${String((error as Error).message)}`);
  }
  const started = Date.now();
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(spec.argv[0]!, spec.argv.slice(1), {
      cwd: spec.rundir,
      env,
      detached: true,
      stdio: [
        "ignore",
        stdoutFd >= 0 ? stdoutFd : mode === "bg" ? "ignore" : "inherit",
        stderrFd >= 0 ? stderrFd : mode === "bg" ? "ignore" : "inherit",
      ],
    });
  } catch (error) {
    if (stdoutFd >= 0) closeSync(stdoutFd);
    if (stderrFd >= 0) closeSync(stderrFd);
    appendFailure(spec.err, spec.marker, `cannot run ${spec.argv[0]}: ${String((error as Error).message)}`);
  }
  if (stdoutFd >= 0) closeSync(stdoutFd);
  if (stderrFd >= 0) closeSync(stderrFd);
  const pid = child.pid ?? 0;
  if (!pid) appendFailure(spec.err, spec.marker, `cannot start ${spec.name}`);
  if (mode !== "bg" && spec.marker) startDetached(["_watch", String(pid), spec.marker]);
  registryAdd(pid, spec.cwd, spec.name);
  if (spec.pidfile) writeFileSync(spec.pidfile, `${String(pid)}\n`);
  if (mode !== "bg") {
    process.stdout.write(`${String.fromCharCode(27)}]0;${spec.name}${String.fromCharCode(7)}`);
    if (mode === "tmux") run("tmux", ["select-pane", "-t", process.env.TMUX_PANE ?? "", "-T", spec.name]);
    const clock = new Date().toTimeString().slice(0, 8);
    writeOut(`${spec.name}\nstarted ${clock} in ${spec.rundir}`);
    if (spec.out) writeOut(`events: ${spec.out}`);
    writeOut("----");
    if (spec.out)
      spawn("bun", [join(HERE, "view-stream.ts"), "--follow", spec.out, "--pid", String(pid)], {
        stdio: "inherit",
      }).unref();
    if (mode === "herdr" && process.env.HERDR_PANE_ID) void herdrReport(pid, spec.name);
    if (mode === "tmux")
      run("tmux", ["set-option", "-w", "-t", process.env.TMUX_PANE ?? "", "@postmaster_state", "running"]);
    for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
      process.on(signal, () => {
        try {
          process.kill(-pid, "SIGTERM");
        } catch {
          try {
            process.kill(pid, "SIGTERM");
          } catch {}
        }
      });
    }
  }
  const code = await new Promise<number>((resolveCode) =>
    child.once("close", (exitCode: number | null) => resolveCode(exitCode ?? 1)),
  );
  touch(spec.marker);
  registryMembers(pid);
  if (mode !== "bg") {
    if (mode === "tmux")
      run("tmux", ["set-option", "-w", "-t", process.env.TMUX_PANE ?? "", "@postmaster_state", "done"]);
    writeOut(
      "----\nexit " +
        code +
        " at " +
        new Date().toTimeString().slice(0, 8) +
        " after " +
        Math.floor((Date.now() - started) / 1000) +
        "s" +
        (spec.marker ? `, marker ${spec.marker}` : ""),
    );
  }
  return 0;
}
async function runCmd(args: string[]): Promise<void> {
  const name = args[0] ?? "";
  const givenCwd = args[1] ?? "";
  let out = "",
    err = "",
    marker = "",
    pidfile = "",
    append = false,
    bad = "";
  let at = 2;
  while (at < args.length) {
    const option = args[at]!;
    if (["--out", "--err", "--marker", "--pidfile"].includes(option)) {
      if (!args[at + 1]) {
        bad = `${option} needs a file`;
        break;
      }
      if (option === "--out") out = args[at + 1]!;
      if (option === "--err") err = args[at + 1]!;
      if (option === "--marker") marker = args[at + 1]!;
      if (option === "--pidfile") pidfile = args[at + 1]!;
      at += 2;
    } else if (option === "--append") {
      append = true;
      at++;
    } else if (option === "--") {
      at++;
      break;
    } else {
      bad = `unknown option for run: ${option} (the command goes after --)`;
      break;
    }
  }
  out = absolute(out);
  err = absolute(err);
  marker = absolute(marker);
  pidfile = absolute(pidfile);
  if (bad) appendFailure(err, marker, bad);
  if (!name || !givenCwd) appendFailure(err, marker, "usage: host.sh run <name> <cwd> [options] -- <command...>");
  const argv = args.slice(at);
  if (!argv.length) appendFailure(err, marker, "run needs a command after --");
  if (!existsSync(givenCwd) || !statSync(givenCwd).isDirectory())
    appendFailure(err, marker, `no such directory: ${givenCwd}`);
  let claimWait: number;
  try {
    claimWait = count(process.env.POSTMASTER_HOST_CLAIM_WAIT ?? "20", "POSTMASTER_HOST_CLAIM_WAIT");
  } catch (error) {
    appendFailure(err, marker, String((error as Error).message));
  }
  const cwd = realpathSync(givenCwd);
  const launchName = clean(name);
  if (pidfile) markerRemove(pidfile);
  if (marker) markerRemove(marker);
  const specDir = mkdtempSync(join(tmpdir(), "postmaster-host."));
  writeSpec(specDir, {
    name: launchName,
    cwd,
    rundir: process.cwd(),
    state: STATE,
    out,
    err,
    marker,
    pidfile,
    append: append ? "1" : "0",
    argv,
  });
  const host = detect();
  let where = "";
  if (host === "herdr") {
    const placed = herdrPlace(launchName, cwd);
    if (placed) {
      run("mkfifo", [join(specDir, "env")]);
      startDetached(["_env-write", join(specDir, "env")]);
      const line = `bun ${quote(SELF)} _run herdr ${quote(specDir)}`;
      if (herdr(["pane", "run", placed.pane, line]).code === 0)
        where = `host=herdr space=${placed.space} tab=${placed.tab} pane=${placed.pane}`;
    }
    if (!where) warn(`Herdr could not place '${launchName}'; running it in the background`);
  } else if (host === "tmux") {
    const session = tmuxSession(cwd);
    run("mkfifo", [join(specDir, "env")]);
    startDetached(["_env-write", join(specDir, "env")]);
    const argsForPane = [
      "bash",
      "-c",
      ['bun "$0" _run tmux "$1"; exec "', String.fromCharCode(36), '{SHELL:-/bin/sh}"'].join(""),
      SELF,
      specDir,
    ];
    const target = `=${session}`;
    let result: ReturnType<typeof run>;
    if (run("tmux", ["has-session", "-t", target]).code === 0)
      result = run("tmux", [
        "new-window",
        "-d",
        "-P",
        "-F",
        "#{window_id}",
        "-t",
        `${target}:`,
        "-n",
        launchName,
        "-c",
        cwd,
        ...argsForPane,
      ]);
    else
      result = run("tmux", [
        "new-session",
        "-d",
        "-P",
        "-F",
        "#{window_id}",
        "-s",
        session,
        "-n",
        launchName,
        "-c",
        cwd,
        ...argsForPane,
      ]);
    const window = result.stdout.trim();
    if (window) {
      run("tmux", ["set-option", "-w", "-t", window, "@postmaster_cwd", cwd]);
      run("tmux", ["set-option", "-w", "-t", window, "automatic-rename", "off"]);
      where = `host=tmux session=${session} window=${window}`;
    } else warn(`tmux could not open a window for '${launchName}'; running it in the background`);
  }
  let runnerPid = 0;
  if (where) {
    for (let i = 0; i < claimWait * 4 && existsSync(specDir) && !existsSync(join(specDir, "claimed")); i++)
      await Bun.sleep(250);
    try {
      mkdirSync(join(specDir, "claimed"));
      where = "";
      warn(
        "the " +
          host +
          " pane did not start '" +
          launchName +
          "' within " +
          claimWait +
          "s; running it in the background",
      );
    } catch {}
  } else {
    try {
      mkdirSync(join(specDir, "claimed"));
    } catch {}
  }
  if (!where) {
    runnerPid = startDetached(["_run", "bg", specDir]);
    where = "host=none";
  }
  for (let i = 0; i < 120 && existsSync(specDir); i++) {
    if (runnerPid && !procStat(runnerPid)) break;
    await Bun.sleep(250);
  }
  if (existsSync(specDir) && runnerPid && !procStat(runnerPid)) {
    dropSpec(specDir);
    appendFailure(err, marker, `'${launchName}' did not start in the background`);
  }
  if (pidfile && !existsSync(specDir)) for (let i = 0; i < 40 && !existsSync(pidfile); i++) await Bun.sleep(250);
  writeOut(where);
}

type ProcRow = { ppid: number; group: number; start: string; zombie: boolean; name: string };
function processTable(): Map<number, ProcRow> {
  const rows = new Map<number, ProcRow>();
  try {
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const raw = readFileSync(`/proc/${entry}/stat`, "utf8");
        const close = raw.lastIndexOf(")");
        const name = raw.slice(raw.indexOf("(") + 1, close);
        const fields = raw
          .slice(close + 1)
          .trim()
          .split(/\s+/);
        rows.set(Number(entry), {
          ppid: Number(fields[1]),
          group: Number(fields[2]),
          start: fields[19] ?? "",
          zombie: fields[0] === "Z",
          name,
        });
      } catch {}
    }
    return rows;
  } catch {}
  const output = run("ps", ["-A", "-o", "pid=,ppid=,pgid=,stat=,lstart=,comm="]).stdout;
  for (const line of output.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/, 10);
    if (fields.length !== 10 || !/^\d+$/.test(fields[0]!) || !/^\d+$/.test(fields[1]!) || !/^\d+$/.test(fields[2]!))
      continue;
    rows.set(Number(fields[0]), {
      ppid: Number(fields[1]),
      group: Number(fields[2]),
      start: fields.slice(4, 9).join(" "),
      zombie: fields[3]!.startsWith("Z"),
      name: fields[9]!,
    });
  }
  return rows;
}
function commandLine(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
  } catch {
    return run("ps", ["-o", "args=", "-p", String(pid)]).stdout.trim();
  }
}
function protectedProcess(pid: number, name: string): string {
  const words = commandLine(pid).split(/\s+/);
  const tail = words.slice(1);
  const identity = basename(words[0] ?? name);
  if (pid === 1) return "the init process";
  if (name === "systemd" || identity === "systemd") return "a systemd manager";
  if (
    (name === "herdr" || identity === "herdr") &&
    (!tail.length || tail.includes("server") || tail.some((word) => word.startsWith("--session")))
  )
    return "the Herdr server or a Herdr client";
  if ((name === "moshi-hook" || identity === "moshi-hook") && tail.includes("serve")) return "the moshi-hook daemon";
  if (words.some((word) => word.includes("code-server"))) return "code-server";
  if (
    (name.startsWith("tmux") || identity.startsWith("tmux")) &&
    (name.includes("server") || identity.includes("server") || !tail.length)
  )
    return "the tmux server";
  if (name === "sshd" || identity === "sshd") return "sshd";
  return "";
}
function killPids(pids: Iterable<number>, signal: string): void {
  for (const pid of pids)
    try {
      process.kill(pid, signal);
    } catch {}
}
function treeFor(
  table: Map<number, ProcRow>,
  groups: Set<number>,
  seeds: Set<number>,
  spare: Set<number>,
): Set<number> {
  const live = new Set(
    [...table]
      .filter(([, row]) => !row.zombie)
      .map(([pid]) => pid)
      .filter((pid) => !spare.has(pid)),
  );
  const hit = new Set([...live].filter((pid) => groups.has(table.get(pid)!.group) || seeds.has(pid)));
  const children = new Map<number, number[]>();
  for (const [pid, row] of table) children.set(row.ppid, [...(children.get(row.ppid) ?? []), pid]);
  const queue = [...hit];
  while (queue.length)
    for (const child of children.get(queue.pop()!) ?? [])
      if (live.has(child) && !hit.has(child)) {
        hit.add(child);
        queue.push(child);
      }
  return hit;
}
function registryRoots(path: string): { count: number; roots: string[]; names: string[] } {
  const found = registryScan(path);
  return {
    count: found.length,
    roots: found.flatMap((record) => record.roots),
    names: found.map((record) => record.name),
  };
}
async function stopTree(grace: number, most: number, roots: string[]): Promise<{ code: number; text: string }> {
  const parsed: Array<{ kind: string; pid: number; start: string }> = [];
  for (const root of roots) {
    const match = /^(group|tree)\|(\d+)\|(.+)$/.exec(root);
    if (match) parsed.push({ kind: match[1]!, pid: Number(match[2]), start: match[3]! });
  }
  let table = processTable();
  if (!table.has(process.pid)) return { code: 1, text: "cannot list processes" };
  const spare = new Set([0, 1]);
  let ancestor = process.pid;
  while (table.has(ancestor) && !spare.has(ancestor)) {
    spare.add(ancestor);
    ancestor = table.get(ancestor)!.ppid;
  }
  const accepted = parsed.filter(
    (root) => table.has(root.pid) && table.get(root.pid)!.start === root.start && !table.get(root.pid)!.zombie,
  );
  const groups = new Set(accepted.filter((root) => root.kind === "group").map((root) => root.pid));
  const seeds = new Set(accepted.map((root) => root.pid));
  const frozen = new Set<number>();
  const refuse = (reason: string): { code: number; text: string } => {
    if (frozen.size) killPids(frozen, "SIGCONT");
    return {
      code: 3,
      text:
        "refused\t" +
        reason +
        (frozen.size ? `; the ${frozen.size} processes frozen before it was found were resumed` : ""),
    };
  };
  for (let round = 0; round < 20; round++) {
    const batch = [...treeFor(table, groups, seeds, spare)].filter((pid) => !frozen.has(pid));
    if (!batch.length) break;
    const all = new Set([...frozen, ...batch]);
    if (all.size > most) return refuse(`${all.size} processes, more than POSTMASTER_HOST_STOP_MAX (${most})`);
    for (const pid of batch.sort((a, b) => a - b)) {
      const name = table.get(pid)!.name;
      const protectedWhy = protectedProcess(pid, name);
      if (protectedWhy) return refuse(`${pid}/${name} is ${protectedWhy}`);
      let current = pid;
      const seen = new Set<number>();
      let belongs = false;
      while (table.has(current) && !seen.has(current) && current !== 0 && current !== 1) {
        if (seeds.has(current) || groups.has(table.get(current)!.group)) {
          belongs = true;
          break;
        }
        seen.add(current);
        current = table.get(current)!.ppid;
      }
      if (!belongs) return refuse(`${pid}/${name} is not a process of these launches`);
    }
    killPids(batch, "SIGSTOP");
    batch.forEach((pid) => {
      frozen.add(pid);
    });
    table = processTable();
  }
  const known = new Map<number, string>(
    [...frozen].filter((pid) => table.has(pid)).map((pid) => [pid, table.get(pid)!.start]),
  );
  killPids(known.keys(), "SIGTERM");
  killPids(known.keys(), "SIGCONT");
  const leftNow = (current: Map<number, ProcRow>) =>
    new Set([
      ...[...known]
        .filter(([pid, start]) => current.has(pid) && current.get(pid)!.start === start && !current.get(pid)!.zombie)
        .map(([pid]) => pid),
      ...treeFor(current, groups, seeds, spare),
    ]);
  const graceEnd = Date.now() + grace * 1000;
  while (Date.now() < graceEnd && leftNow(processTable()).size) await Bun.sleep(250);
  const killEnd = Date.now() + 5000;
  let survivors = new Set<number>();
  while (true) {
    table = processTable();
    survivors = leftNow(table);
    if (!survivors.size || Date.now() >= killEnd) break;
    killPids(survivors, "SIGKILL");
    for (const pid of survivors) if (table.has(pid)) known.set(pid, table.get(pid)!.start);
    await Bun.sleep(250);
  }
  const names = [...survivors]
    .sort((a, b) => a - b)
    .map((pid) => `${pid}/${table.get(pid)?.name ?? "unknown"}`)
    .join(" ");
  return { code: survivors.size ? 2 : 0, text: `${known.size}\t${names}` };
}
async function stopCmd(args: string[]): Promise<void> {
  const path = worktreeArg(args[0] ?? "", "stop");
  if ((resolve(process.cwd()) + sep).startsWith(path + sep))
    die(`not stopping the launches in ${path} from inside it: that stops this session too`);
  const grace = count(process.env.POSTMASTER_HOST_STOP_WAIT ?? "20", "POSTMASTER_HOST_STOP_WAIT");
  const most = count(process.env.POSTMASTER_HOST_STOP_MAX ?? "512", "POSTMASTER_HOST_STOP_MAX");
  const scan = registryRoots(path);
  if (!scan.count) {
    writeOut(`no launch is running in ${path}`);
    return;
  }
  const result = await stopTree(grace, most, scan.roots);
  const fields = result.text.split("\t");
  if (result.code === 0) writeOut(`stopped ${scan.count} launch(es) in ${path}: ${fields[0]} process(es)`);
  else if (result.code === 2) {
    warn(`stopped ${scan.count} launch(es) in ${path}, but these still run: ${fields[1] ?? ""}`);
    throw new HostError("", 2);
  } else if (result.code === 3) {
    warn(`refused to stop the launches in ${path}, and left them running: ${fields.slice(1).join("\t")}`);
    throw new HostError("", 2);
  } else die(`could not stop the launches in ${path}: ${result.text}`);
}
function worktreeArg(path: string, what: string): string {
  if (!path) die(`usage: host.sh ${what} <worktree>`);
  if (!existsSync(path) || !statSync(path).isDirectory()) die(`no such directory: ${path}`);
  return realpathSync(path);
}
async function closeCmd(args: string[]): Promise<void> {
  const path = worktreeArg(args[0] ?? "", "close");
  const patience = count(process.env.POSTMASTER_HOST_CLOSE_WAIT ?? "15", "POSTMASTER_HOST_CLOSE_WAIT");
  for (let seconds = 0; ; seconds++) {
    const live = registryScan(path);
    if (!live.length) break;
    if (seconds >= patience)
      throw new HostError(`a launch is still running in ${path}: ${live.map((item) => item.name).join("; ")}`, 2);
    await Bun.sleep(1000);
  }
  let code = 0;
  if (has("tmux")) code = closeTmux(path) || code;
  if (herdrUp()) code = closeHerdr(path) || code;
  if (!code) writeOut(`closed what host.sh opened for ${path}`);
  if (code) throw new HostError("", code);
}

function noSessionHost(): never {
  die("no Herdr or tmux here to keep an interactive session; run it headless as a native session (hosts.md, none)", 3);
}
function isKind(kind: string): boolean {
  const result = herdr(["agent"]);
  return result.stderr.split(/\r?\n/).some((line) =>
    line
      .replace(/^\s*kinds:\s*/, "")
      .split("|")
      .includes(kind),
  );
}
function tmuxTarget(handle: string): string {
  const result = run("tmux", ["list-windows", "-a", "-F", "#{window_id}\t#{window_name}"]);
  const hits = result.stdout
    .split(/\r?\n/)
    .filter((line) => line.split("\t")[1] === handle)
    .map((line) => line.split("\t")[0]!);
  if (!hits.length) die(`no tmux window named ${handle}`);
  if (hits.length !== 1) die(`more than one tmux window is named ${handle}`);
  return hits[0]!;
}
function envOptions(prefix: string): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(process.env))
    if (key.startsWith(prefix) && value !== undefined) args.push("--env", `${key}=${value}`);
  return args;
}
function herdrReport(pid: number, name: string): void {
  const pane = process.env.HERDR_PANE_ID ?? "";
  if (!pane) return;
  herdr(["pane", "report-agent", pane, "--source", SOURCE, "--agent", "headless", "--state", "working"]);
  herdr([
    "pane",
    "report-metadata",
    pane,
    "--source",
    META,
    "--title",
    name,
    "--display-agent",
    name,
    "--token",
    "postmaster=launch",
    "--token",
    "state=running",
    "--token",
    `pgid=${pid}`,
  ]);
  void (async () => {
    while (procStat(pid) && procStat(pid)?.fields[0] !== "Z") await Bun.sleep(250);
    herdr(["pane", "release-agent", pane, "--source", SOURCE, "--agent", "headless"]);
    herdr([
      "pane",
      "report-metadata",
      pane,
      "--source",
      META,
      "--title",
      name,
      "--display-agent",
      name,
      "--token",
      "postmaster=launch",
      "--token",
      "state=done",
      "--token",
      `pgid=${pid}`,
    ]);
  })();
}
function spawnCmd(args: string[]): void {
  const originalHandle = args[0] ?? "";
  const givenCwd = args[1] ?? "";
  if (!originalHandle || !givenCwd) die("usage: host.sh spawn <handle> <cwd> [--label <text>] -- <command...>");
  let label = "";
  let at = 2;
  while (at < args.length) {
    if (args[at] === "--label") {
      if (!args[at + 1]) die("--label needs text");
      label = args[at + 1]!;
      at += 2;
    } else if (args[at] === "--") {
      at++;
      break;
    } else die(`unknown option for spawn: ${args[at]}`);
  }
  const commandArgs = args.slice(at);
  if (!commandArgs.length) die("spawn needs a command after --");
  if (!existsSync(givenCwd) || !statSync(givenCwd).isDirectory()) die(`no such directory: ${givenCwd}`);
  const cwd = realpathSync(givenCwd);
  label = clean(label || originalHandle);
  const handle = handleOf(originalHandle);
  const postmasterEnv = Object.entries(process.env)
    .filter(([key]) => key.startsWith("POSTMASTER_") && process.env[key] !== undefined)
    .flatMap(([key, value]) => ["-e", `${key}=${value}`]);
  PLACE_ENV = envOptions("POSTMASTER_");
  const host = detect();
  if (host === "herdr") {
    if (herdr(["agent", "get", handle]).code === 0)
      die(`a live Herdr agent is already named ${handle}; spawn under another handle`);
    const placed = herdrPlace(label, cwd, "repo");
    if (!placed) die(`Herdr could not open a tab for ${handle}`);
    const kind = basename(commandArgs[0]!);
    if (isKind(kind)) {
      const started = herdr([
        "agent",
        "start",
        handle,
        "--kind",
        kind,
        "--pane",
        placed.pane,
        "--",
        ...commandArgs.slice(1),
      ]);
      if (started.code !== 0) {
        const code = parseJson(started.stderr)?.error?.code;
        if (code === "agent_not_ready")
          warn(
            handle +
              " is asking something before it takes a message; the user answers it in space " +
              placed.space +
              ", then send",
          );
        else die(`herdr could not start ${handle}: ${code || started.stderr.trim()}`);
      }
    } else {
      const shellCommand = commandArgs.map(quote).join(" ");
      if (herdr(["pane", "run", placed.pane, shellCommand]).code !== 0) die(`herdr could not start ${handle}`);
      herdr(["agent", "rename", placed.pane, handle]);
    }
    writeOut(`host=herdr space=${placed.space} tab=${placed.tab} pane=${placed.pane} handle=${handle}`);
    return;
  }
  if (host === "tmux") {
    const listed = run("tmux", ["list-windows", "-a", "-F", "#{window_name}"]);
    if (listed.stdout.split(/\r?\n/).filter((window) => window === handle).length)
      die(`a tmux window is already named ${handle}; spawn under another handle`);
    const session = tmuxSession(cwd);
    let result: ReturnType<typeof run>;
    if (run("tmux", ["has-session", "-t", `=${session}`]).code === 0)
      result = run("tmux", [
        "new-window",
        "-d",
        "-P",
        "-F",
        "#{window_id}",
        "-t",
        `=${session}:`,
        ...postmasterEnv,
        "-n",
        handle,
        "-c",
        cwd,
        ...commandArgs,
      ]);
    else
      result = run("tmux", [
        "new-session",
        "-d",
        "-P",
        "-F",
        "#{window_id}",
        "-s",
        session,
        ...postmasterEnv,
        "-n",
        handle,
        "-c",
        cwd,
        ...commandArgs,
      ]);
    const window = result.stdout.trim();
    if (!window) die(`tmux could not start ${handle}`);
    run("tmux", ["set-option", "-w", "-t", window, "automatic-rename", "off"]);
    writeOut(`host=tmux session=${session} window=${window} handle=${handle}`);
    return;
  }
  noSessionHost();
}
async function sendCmd(args: string[]): Promise<void> {
  const rawHandle = args[0] ?? "",
    file = args[1] ?? "";
  if (!rawHandle || !file) die("usage: host.sh send <handle> <file> [--wait [<seconds>]]");
  const waitFor = args[2] === "--wait" ? count(args[3] ?? "600", "seconds") : null;
  const handle = handleOf(rawHandle);
  if (!existsSync(file) || !statSync(file).isFile()) die(`no such file: ${file}`);
  const host = detect();
  if (host === "herdr") {
    const text = readFileSync(file, "utf8");
    if (waitFor === null) {
      if (herdr(["agent", "prompt", handle, text]).code !== 0) die(`herdr could not prompt ${handle}`);
    } else {
      const result = herdr(["agent", "prompt", handle, text, "--wait", "--timeout", String(waitFor * 1000)]);
      if (result.code !== 0) {
        const code = parseJson(result.stderr)?.error?.code;
        if (code === "agent_prompt_stalled")
          die(`${handle} got the message, but Herdr saw no turn start; read the session before sending it again`, 3);
        if (code === "agent_blocked")
          die(`${handle} is at an approval or a question; the user answers it in Herdr first`, 3);
        if (code === "timeout") {
          writeOut(`sent; ${handle} did not settle within ${waitFor}s`);
          throw new HostError("", 3);
        }
        die(`herdr could not prompt ${handle}: ${code || result.stderr.trim()}`);
      }
      const status = herdrData(["agent", "get", handle])?.agent?.agent_status;
      if (status === "blocked") {
        writeOut(`sent; ${handle} stopped at an approval or a question: the user answers it in Herdr`);
        throw new HostError("", 3);
      }
    }
  } else if (host === "tmux") {
    const target = tmuxTarget(handle);
    const buffer = `postmaster-send-${process.pid}`;
    if (
      run("tmux", ["load-buffer", "-b", buffer, file]).code !== 0 ||
      run("tmux", ["paste-buffer", "-p", "-d", "-b", buffer, "-t", target]).code !== 0
    )
      die(`tmux could not paste into ${handle}`);
    await Bun.sleep(500);
    run("tmux", ["send-keys", "-t", target, "Enter"]);
    if (waitFor !== null)
      try {
        await waitCmd([handle, String(waitFor)]);
      } catch {
        writeOut(`sent; ${handle} did not settle within ${waitFor}s`);
        throw new HostError("", 3);
      }
  } else noSessionHost();
  const byteCount = new TextEncoder().encode(readFileSync(file)).length;
  writeOut(`sent ${byteCount} bytes to ${handle}${waitFor !== null ? ", and it settled" : ""}`);
}
async function waitCmd(args: string[]): Promise<void> {
  const rawHandle = args[0] ?? "";
  if (!rawHandle) die("usage: host.sh wait <handle> [<seconds>]");
  const seconds = count(args[1] ?? "600", "seconds");
  const handle = handleOf(rawHandle);
  const host = detect();
  if (host === "herdr") {
    const result = herdr(["agent", "wait", handle, "--timeout", String(seconds * 1000)]);
    if (result.code !== 0) {
      writeOut(`${handle} did not settle within ${seconds}s`);
      throw new HostError("", 3);
    }
    if (herdrData(["agent", "get", handle])?.agent?.agent_status === "blocked") {
      writeOut(`${handle} stopped at an approval or a question: the user answers it in Herdr`);
      throw new HostError("", 3);
    }
    writeOut(`${handle} settled`);
    return;
  }
  if (host === "tmux") {
    const quiet = count(process.env.POSTMASTER_HOST_QUIET ?? "10", "POSTMASTER_HOST_QUIET");
    const target = tmuxTarget(handle);
    const end = Date.now() + seconds * 1000;
    let last = "",
      same = 0;
    while (Date.now() < end) {
      const read = run("tmux", ["capture-pane", "-p", "-t", target]);
      if (read.code !== 0) die(`tmux cannot read ${handle}`);
      if (read.stdout === last) same++;
      else {
        same = 0;
        last = read.stdout;
      }
      if (same >= quiet) {
        writeOut(`${handle} settled`);
        return;
      }
      await Bun.sleep(1000);
    }
    writeOut(`${handle} did not settle within ${seconds}s`);
    throw new HostError("", 3);
  }
  noSessionHost();
}
function readCmd(args: string[]): void {
  const rawHandle = args[0] ?? "";
  if (!rawHandle) die("usage: host.sh read <handle> [<lines>]");
  const lines = count(args[1] ?? "120", "lines");
  const handle = handleOf(rawHandle);
  const host = detect();
  if (host === "herdr") {
    const result = herdr(["agent", "read", handle, "--source", "recent-unwrapped", "--lines", String(lines)]);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.code) throw new HostError("", result.code);
  } else if (host === "tmux") {
    const target = tmuxTarget(handle);
    const result = run("tmux", ["capture-pane", "-p", "-J", "-S", `-${lines}`, "-t", target]);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.code) throw new HostError("", result.code);
  } else noSessionHost();
}

async function selfTest(): Promise<void> {
  const result = await import("./host-self-test.ts");
  await result.run();
}
async function liveTest(): Promise<void> {
  const result = await import("./host-self-test.ts");
  await result.live();
}
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const operation = args.shift() ?? "";
  switch (operation) {
    case "detect":
      writeOut(detect());
      return;
    case "name":
      writeOut(nameCmd(args[0] ?? "", args[1] ?? ""));
      return;
    case "run":
      await runCmd(args);
      return;
    case "stop":
      await stopCmd(args);
      return;
    case "close":
      await closeCmd(args);
      return;
    case "spawn":
      spawnCmd(args);
      return;
    case "send":
      await sendCmd(args);
      return;
    case "wait":
      await waitCmd(args);
      return;
    case "read":
      readCmd(args);
      return;
    case "_run":
      await runLaunch(args[1] ?? "", args[0] ?? "");
      return;
    case "_handle":
      writeOut(handleOf(args[0] ?? ""));
      return;
    case "_env-write":
      await envWrite(args[0] ?? "");
      return;
    case "_watch":
      await watch(Number(args[0]), args[1] ?? "");
      return;
    case "--self-test":
      await selfTest();
      return;
    case "--live-test":
      await liveTest();
      return;
    default:
      die(
        "usage: host.sh detect | name | run | stop | close | spawn | send | wait | read | --self-test | --live-test (see the header)",
      );
  }
}
main().catch((error: unknown) => {
  if (error instanceof HostError) {
    if (error.message) writeError(`host: ${error.message}`);
    process.exit(error.code);
  }
  writeError(`host: ${String((error as Error)?.message ?? error)}`);
  process.exit(1);
});
function closeTmux(path: string): number {
  const session = tmuxSession(path);
  if (run("tmux", ["has-session", "-t", `=${session}`]).code !== 0) return 0;
  const list = run("tmux", ["list-windows", "-t", `=${session}`, "-F", "#{window_id}\t#{@postmaster_cwd}"]);
  let countClosed = 0;
  for (const line of list.stdout.split(/\r?\n/)) {
    const [window, cwd] = line.split("\t");
    if (window && cwd === path && run("tmux", ["kill-window", "-t", window]).code === 0) countClosed++;
  }
  if (countClosed) writeOut(`host=tmux: closed ${countClosed} window(s)`);
  return 0;
}
function closeHerdr(path: string): number {
  const listed = herdr(["worktree", "list", "--cwd", path]);
  if (listed.code !== 0) return 0;
  const data = parseJson(listed.stdout)?.result;
  const worktree = (data?.worktrees ?? []).find((entry: any) => resolve(entry.path) === path);
  const space = jsonValue(worktree?.open_workspace_id);
  if (!space) return 0;
  if (!worktree?.is_linked_worktree && !cloneOrigin(path)) {
    warn(`${path} is a repository's own checkout; its space is never closed`);
    return 2;
  }
  const ws = herdrData(["workspace", "get", space])?.workspace;
  const panes = herdrData(["pane", "list", "--workspace", space])?.panes;
  let verdict = "";
  if (!ws || !panes) verdict = `could not read space ${space}`;
  else if (ws.tokens?.postmaster !== "opened") verdict = `space ${space} was not opened by host.sh`;
  else {
    const foreign = panes.find((pane: any) => pane.tokens?.postmaster !== "launch");
    if (foreign) verdict = `pane ${foreign.pane_id} in space ${space} was not opened by host.sh`;
  }
  if (verdict) {
    warn(`${verdict}; left open`);
    return 2;
  }
  if (herdr(["workspace", "close", space]).code !== 0) die(`herdr could not close space ${space}`);
  writeOut(`host=herdr: closed space ${space}`);
  return 0;
}
