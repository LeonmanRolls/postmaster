// Oracle helpers for #373: the stub-host layout the ticket's checks judge, with the
// builders and readers the cases need. The cases in acceptance-373.test.ts run the
// ticket's own interface (run host close-run, close-handle and _clerk-close, run clerk
// start, run ticket-ready mark, run host stop-run) with stub herdr and tmux first on
// PATH, and match only what the ticket pins: exits, which entries close and which
// stay, and the wordings that name what stays.
// Covered: C1-C3. Not covered: C4 (the fixture run, scored at landing).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { FIXTURE_MARKER } from "./fixture.ts";
import { bootId, processStart } from "./lib/processes.ts";
export const HERE = import.meta.dir;
export const SELF = join(HERE, "run");
export const STUB_SCRIPT = join(HERE, "host-self-test.ts");

// The tools a stubbed host call may use: bun for scripts/run, sh and bash for
// the wrappers, git for the stub's worktree answers, env and dirname for the
// wrapper itself, cksum for long handles, ps and sysctl for the process
// readings macOS takes through them instead of /proc. No herdr, no tmux but
// the stubs.
export const SYS_TOOLS = ["bun", "bash", "sh", "git", "env", "dirname", "cksum", "ps", "sysctl"];

export interface Fx {
  root: string;
  bin: string;
  sys: string;
  stub: string;
  state: string;
  caller: string;
  logs: string;
}

export function makeFx(tag: string): Fx {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `cleanup-${tag}-`)));
  const bin = join(root, "bin");
  const sys = join(root, "sys");
  const stub = join(root, "stub");
  const state = join(root, "state");
  const caller = join(root, "caller");
  const logs = join(root, "logs");
  for (const dir of [bin, sys, stub, state, caller, logs]) mkdirSync(dir, { recursive: true });
  for (const tool of SYS_TOOLS) {
    for (const dir of (process.env.PATH ?? "").split(":")) {
      const found = join(dir, tool);
      if (existsSync(found)) {
        try {
          symlinkSync(found, join(sys, tool));
        } catch {}
        break;
      }
    }
  }
  for (const tool of ["herdr", "tmux"]) {
    writeFileSync(
      join(bin, tool),
      `#!/bin/sh\nexec ${process.execPath} ${STUB_SCRIPT} --stub ${tool} "$@"\n`,
      { mode: 0o755 },
    );
  }
  return { root, bin, sys, stub, state, caller, logs };
}

export function fxEnv(
  fx: Fx,
  extra: Record<string, string | undefined> = {},
): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  env.HOME = fx.root;
  env.PATH = `${fx.bin}:${fx.sys}`;
  env.STUB = fx.stub;
  env.TMPDIR = fx.root;
  env.POSTMASTER_HOST_STATE = fx.state;
  env.POSTMASTER_HOST_FIXTURE = fx.root;
  env.POSTMASTER_HOST_CLOSE_WAIT = "1";
  env.POSTMASTER_HOST_STOP_WAIT = "5";
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export function sh(
  cmd: string,
  args: string[],
  env: Record<string, string>,
  cwd?: string,
): { code: number; out: string; err: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8", env, cwd });
  return { code: r.status ?? 1, out: String(r.stdout ?? ""), err: String(r.stderr ?? "") };
}

export function gitInit(repo: string): void {
  mkdirSync(repo, { recursive: true });
  const env = { ...process.env } as Record<string, string>;
  if (sh("git", ["init", "-q", "-b", "main", repo], env).code !== 0) throw new Error("git init");
  if (sh("git", ["-C", repo, "config", "user.name", "cleanup-test"], env).code !== 0)
    throw new Error("git config");
  if (sh("git", ["-C", repo, "config", "user.email", "test@example.invalid"], env).code !== 0)
    throw new Error("git config");
  if (sh("git", ["-C", repo, "commit", "-q", "--allow-empty", "-m", "base"], env).code !== 0)
    throw new Error("git commit");
}

export function addWorktree(repo: string, name: string, branch: string | null): string {
  const path = join(repo, ".worktrees", name);
  const env = { ...process.env } as Record<string, string>;
  const args =
    branch === null
      ? ["-C", repo, "worktree", "add", "-q", "--detach", path]
      : ["-C", repo, "worktree", "add", "-q", path, "-b", branch];
  if (sh("git", args, env).code !== 0) throw new Error(`worktree add ${name}`);
  return path;
}

export function writeDispatch(
  dispatch: string,
  synth: string,
  lanes: string[],
  reviewers: Array<[string, string]>,
): void {
  mkdirSync(join(dispatch, "logs"), { recursive: true });
  writeFileSync(
    join(dispatch, "brief.md"),
    [
      "# Waybill: 373",
      "turnpikes: style, bug, security",
      "",
      "## Ticket",
      "",
      "## Dispatch",
      "name: #373, probe",
      `dispatch: ${dispatch}`,
      `synthesis worktree: ${synth}`,
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dispatch, "run.json"),
    `${JSON.stringify({ config: { team: { workhorses: lanes } } })}\n`,
  );
  const laneEntries: Record<string, unknown> = {};
  for (const lane of lanes) laneEntries[lane] = {};
  writeFileSync(
    join(dispatch, "manifest.json"),
    `${JSON.stringify({ leg: 1, lanes: laneEntries })}\n`,
  );
  if (reviewers.length)
    writeFileSync(join(dispatch, "logs", "review-r1.json"), `${JSON.stringify({ reviewers })}\n`);
}

// --- stub Herdr state: the same shape the stub in host-self-test.ts keeps ---

export interface HerdrState {
  n: number;
  spaces: Record<
    string,
    {
      label: string;
      tokens: Record<string, string>;
      panes: string[];
      tabs: string[];
      path: string | null;
    }
  >;
  panes: Record<
    string,
    {
      ws: string;
      tab: string;
      cwd: string;
      tokens: Record<string, string>;
      label?: string;
      title?: string;
    }
  >;
  tabs: Record<string, { ws: string; pane: string; cwd: string; label: string }>;
  tab_n: Record<string, number>;
  open: Record<string, string>;
  agents: string[];
  agentPanes: Record<string, string>;
  prompt: unknown[];
}

export function freshHerdr(): HerdrState {
  return {
    n: 0,
    spaces: {},
    panes: {},
    tabs: {},
    tab_n: {},
    open: {},
    agents: [],
    agentPanes: {},
    prompt: [],
  };
}

export function b36(n: number): string {
  let s = "";
  while (n > 0) {
    s = `0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ`[n % 36] + s;
    n = Math.floor(n / 36);
  }
  return s;
}

export function hSpace(
  st: HerdrState,
  label: string,
  path: string | null,
): { ws: string; tab: string; pane: string } {
  st.n++;
  const ws = `w${st.n}`;
  st.tab_n[ws] = 1;
  const tab = `${ws}:t${b36(1)}`;
  st.n++;
  const pane = `p${st.n}`;
  st.spaces[ws] = { label, tokens: {}, panes: [pane], tabs: [tab], path };
  st.panes[pane] = { ws, tab, cwd: path ?? "", tokens: {} };
  st.tabs[tab] = { ws, pane, cwd: path ?? "", label };
  return { ws, tab, pane };
}

export function hTab(
  st: HerdrState,
  ws: string,
  cwd: string,
  label: string,
): { tab: string; pane: string } {
  st.tab_n[ws] = (st.tab_n[ws] ?? 0) + 1;
  const tab = `${ws}:t${b36(st.tab_n[ws]!)}`;
  st.n++;
  const pane = `p${st.n}`;
  st.spaces[ws]!.panes.push(pane);
  st.spaces[ws]!.tabs.push(tab);
  st.panes[pane] = { ws, tab, cwd, tokens: {} };
  st.tabs[tab] = { ws, pane, cwd, label };
  return { tab, pane };
}

export function hSplit(st: HerdrState, ws: string, tab: string, cwd: string): string {
  st.n++;
  const pane = `p${st.n}`;
  st.spaces[ws]!.panes.push(pane);
  st.panes[pane] = { ws, tab, cwd, tokens: {} };
  return pane;
}

export function saveHerdr(fx: Fx, st: HerdrState): void {
  writeFileSync(join(fx.stub, "herdr.json"), JSON.stringify(st));
}

export function readHerdr(fx: Fx): HerdrState {
  return JSON.parse(readFileSync(join(fx.stub, "herdr.json"), "utf8")) as HerdrState;
}

// --- stub tmux state ---

export interface TmuxState {
  n: number;
  sessions: string[];
  windows: Record<
    string,
    {
      session: string;
      name: string;
      opts: Record<string, string>;
      panes: Record<string, { opts: Record<string, string> }>;
    }
  >;
}

export function freshTmux(): TmuxState {
  return { n: 0, sessions: [], windows: {} };
}

export function tWindow(
  st: TmuxState,
  session: string,
  name: string,
  opts: Record<string, string>,
  ownedPanes: number,
  extraPanes = 0,
): { win: string; panes: string[] } {
  st.n++;
  const win = `@${st.n}`;
  const panes: Record<string, { opts: Record<string, string> }> = {};
  const ids: string[] = [];
  for (let i = 0; i < ownedPanes; i++) {
    if (i > 0) st.n++;
    const pane = `%${st.n}`;
    panes[pane] = { opts: { "@postmaster_owned": "yes" } };
    ids.push(pane);
  }
  for (let i = 0; i < extraPanes; i++) {
    st.n++;
    const pane = `%${st.n}`;
    panes[pane] = { opts: {} };
    ids.push(pane);
  }
  st.windows[win] = { session, name, opts, panes };
  if (!st.sessions.includes(session)) st.sessions.push(session);
  return { win, panes: ids };
}

export function saveTmux(fx: Fx, st: TmuxState): void {
  writeFileSync(join(fx.stub, "tmux.json"), JSON.stringify(st));
}

export function readTmux(fx: Fx): TmuxState {
  return JSON.parse(readFileSync(join(fx.stub, "tmux.json"), "utf8")) as TmuxState;
}

export function place(
  fx: Fx,
  entry: {
    workspace: string;
    tab: string;
    pane: string;
    cwd: string;
    run: string;
    handle?: string;
  },
): void {
  const dir = join(fx.state, "placements");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${createHash("sha256").update(entry.pane).digest("hex")}.json`),
    `${JSON.stringify(entry)}\n`,
  );
}

export function placeRunTab(
  fx: Fx,
  entry: { workspace: string; tab: string; pane: string; run: string },
): void {
  const dir = join(fx.state, "runtabs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${createHash("sha256").update(entry.run).digest("hex")}.json`),
    `${JSON.stringify(entry)}\n`,
  );
}

export function readPlacement(fx: Fx, pane: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      join(fx.state, "placements", `${createHash("sha256").update(pane).digest("hex")}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

export function placementTabs(fx: Fx): string[] {
  const dir = join(fx.state, "placements");
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(dir);
  } catch {
    files = [];
  }
  for (const file of files) {
    try {
      out.push((JSON.parse(readFileSync(join(dir, file), "utf8")) as { tab: string }).tab);
    } catch {}
  }
  return out;
}

export function calls(fx: Fx, which: string): string[] {
  try {
    return readFileSync(join(fx.stub, `${which}.calls`), "utf8")
      .trimEnd()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Every close, move or rename of one id, across both stubs.
export function touchesId(lines: string[], id: string): string[] {
  return lines.filter((line) => {
    const cells = line.split("\t");
    if (cells[0] === "tab" && cells[1] === "close") return cells[2] === id;
    if (cells[0] === "pane" && cells[1] === "close") return cells[2] === id;
    if (cells[0] === "workspace" && cells[1] === "close") return cells[2] === id;
    if (cells[0] === "tab" && cells[1] === "rename") return cells[2] === id;
    if (cells[0] === "workspace" && cells[1] === "rename") return cells[2] === id;
    if (cells[0] === "pane" && cells[1] === "move") return cells.includes(id);
    if (cells[0] === "tab" && cells[1] === "move") return cells.includes(id);
    if (cells[0] === "kill-window") return cells[cells.indexOf("-t") + 1] === id;
    if (cells[0] === "kill-pane") return cells[cells.indexOf("-t") + 1] === id;
    return false;
  });
}

export function tmuxSessionFor(repo: string): string {
  return `postmaster-${basename(repo).replace(/[.:]/gu, "_")}`;
}

// A run on an ordinary project: one run tab in the project's space, with a
// pane per launch beside the state pane, and the project's own watcher tab
// beside them.
export interface NormalRun {
  fx: Fx;
  repo: string;
  dispatch: string;
  synth: string;
  horse: string;
  scratch: string;
  runTab: string;
  runPanes: string[];
  statePane: string;
  projSpace: string;
  watcherTab: string;
  watcherPane: string;
  shellTab: string;
  session: string;
  runWindows: string[];
  watcherWindow: string;
  postWindow: string;
}

export function setupNormal(tag: string): NormalRun {
  const fx = makeFx(tag);
  const repo = join(fx.root, "repo");
  gitInit(repo);
  const synth = addWorktree(repo, "373", "373");
  const horse = addWorktree(repo, "373-luna", "wb/373-luna");
  const scratch = addWorktree(repo, "373-rev-style-solo", null);
  const dispatch = join(fx.root, "dispatch", "373");
  writeDispatch(dispatch, synth, ["luna"], [["style", "solo"]]);

  const st = freshHerdr();
  const proj = hSpace(st, basename(repo), repo);
  st.panes[proj.pane]!.tokens = {};
  const watcher = hTab(st, proj.ws, repo, "watch · repo");
  st.panes[watcher.pane]!.tokens = { postmaster: "launch" };
  const run = hTab(st, proj.ws, synth, "#373, probe");
  st.panes[run.pane]!.tokens = { postmaster: "launch", role: "runstate" };
  const runPanes: string[] = [];
  for (const [cwd, label] of [
    [synth, "coachman · leg 1"],
    [horse, "luna · workhorse · m"],
    [scratch, "solo · style review · m · r1"],
  ] as Array<[string, string]>) {
    const pane = hSplit(st, proj.ws, run.tab, cwd);
    st.panes[pane]!.tokens = { postmaster: "launch" };
    st.panes[pane]!.label = label;
    st.panes[pane]!.title = label;
    runPanes.push(pane);
    place(fx, { workspace: proj.ws, tab: run.tab, pane, cwd, run: dispatch });
  }
  place(fx, { workspace: proj.ws, tab: watcher.tab, pane: watcher.pane, cwd: repo, run: "" });
  placeRunTab(fx, { workspace: proj.ws, tab: run.tab, pane: run.pane, run: dispatch });
  st.open[repo] = proj.ws;
  saveHerdr(fx, st);

  const tm = freshTmux();
  const session = tmuxSessionFor(repo);
  const runWindows: string[] = [];
  for (const [cwd, name] of [
    [synth, "coachman · leg 1"],
    [horse, "luna · workhorse · m"],
    [scratch, "solo · style review · m · r1"],
  ] as Array<[string, string]>) {
    const win = tWindow(
      tm,
      session,
      name,
      { "@postmaster_cwd": cwd, "@postmaster_run": dispatch },
      1,
    );
    tm.windows[win.win]!.opts["@postmaster_pane"] = win.panes[0]!;
    runWindows.push(win.win);
  }
  const wWatcher = tWindow(tm, session, "watch · repo", { "@postmaster_cwd": repo }, 1);
  tm.windows[wWatcher.win]!.opts["@postmaster_pane"] = wWatcher.panes[0]!;
  const wPost = tWindow(
    tm,
    session,
    "postmaster",
    { "@postmaster_cwd": repo, "@postmaster_handle": "postmaster", "@postmaster_pane": "%0" },
    1,
  );
  tm.windows[wPost.win]!.opts["@postmaster_pane"] = wPost.panes[0]!;
  saveTmux(fx, tm);
  return {
    fx,
    repo,
    dispatch,
    synth,
    horse,
    scratch,
    runTab: run.tab,
    runPanes,
    statePane: run.pane,
    projSpace: proj.ws,
    watcherTab: watcher.tab,
    watcherPane: watcher.pane,
    shellTab: proj.tab,
    session,
    runWindows,
    watcherWindow: wWatcher.win,
    postWindow: wPost.win,
  };
}

// A run on a fixture copy: the run's tab with its launches' panes in the
// copy's own space, beside the copy's postmaster and watcher tabs, and an
// outer project's watcher that is not this run's.
export interface FixtureRun {
  fx: Fx;
  fix: string;
  dispatch: string;
  runTab: string;
  runPanes: string[];
  statePane: string;
  fixSpace: string;
  pmTab: string;
  pmPane: string;
  watchTab: string;
  watchPane: string;
  outer: string;
  outerSpace: string;
  outerTab: string;
  outerPane: string;
  sessionF: string;
  runWindows: string[];
  watchWindowF: string;
  pmWindowF: string;
  sessionO: string;
  outerWindow: string;
}

export function setupFixture(tag: string, userTabInCopy: boolean): FixtureRun {
  const fx = makeFx(tag);
  const fix = join(fx.root, "fixcopy");
  gitInit(fix);
  mkdirSync(join(fix, ".postmaster"), { recursive: true });
  writeFileSync(join(fix, ".postmaster", "fixture"), FIXTURE_MARKER);
  const sysEnv = { ...process.env } as Record<string, string>;
  if (sh("git", ["-C", fix, "config", "--local", "postmaster.fixture", "one"], sysEnv).code !== 0)
    throw new Error("fixture config");
  const synth = addWorktree(fix, "1", "1");
  const horse = addWorktree(fix, "1-luna", "wb/1-luna");
  const scratch = addWorktree(fix, "1-rev-style-solo", null);
  const dispatch = join(fx.root, "dispatch", "1");
  writeDispatch(dispatch, synth, ["luna"], [["style", "solo"]]);
  const outer = join(fx.root, "outer");
  mkdirSync(outer, { recursive: true });

  const st = freshHerdr();
  // The copy's own space: the flow opened it for this one run, so it carries
  // the ownership token, with no spare shell beside the tabs.
  const copy = hSpace(st, basename(fix), fix);
  delete st.tabs[copy.tab];
  delete st.panes[copy.pane];
  st.spaces[copy.ws]!.tabs = [];
  st.spaces[copy.ws]!.panes = [];
  st.spaces[copy.ws]!.tokens = { postmaster: "opened" };
  const pm = hTab(st, copy.ws, fix, "postmaster");
  st.panes[pm.pane]!.tokens = { postmaster: "launch" };
  const watch = hTab(st, copy.ws, fix, "watch · fixcopy");
  st.panes[watch.pane]!.tokens = { postmaster: "launch" };
  place(fx, { workspace: copy.ws, tab: pm.tab, pane: pm.pane, cwd: fix, run: "" });
  place(fx, { workspace: copy.ws, tab: watch.tab, pane: watch.pane, cwd: fix, run: "" });
  const run = hTab(st, copy.ws, synth, "#373, probe");
  st.panes[run.pane]!.tokens = { postmaster: "launch", role: "runstate" };
  const runPanes: string[] = [];
  for (const [cwd, label] of [
    [synth, "coachman · leg 1"],
    [horse, "luna · workhorse · m"],
    [scratch, "solo · style review · m · r1"],
  ] as Array<[string, string]>) {
    const pane = hSplit(st, copy.ws, run.tab, cwd);
    st.panes[pane]!.tokens = { postmaster: "launch" };
    st.panes[pane]!.label = label;
    st.panes[pane]!.title = label;
    runPanes.push(pane);
    place(fx, { workspace: copy.ws, tab: run.tab, pane, cwd, run: dispatch });
  }
  placeRunTab(fx, { workspace: copy.ws, tab: run.tab, pane: run.pane, run: dispatch });
  if (userTabInCopy) {
    const user = hTab(st, copy.ws, fix, "user tab");
    st.panes[user.pane]!.tokens = {};
  }
  const outerSp = hSpace(st, "outer", outer);
  const outerWatch = hTab(st, outerSp.ws, outer, "watch · outer");
  st.panes[outerWatch.pane]!.tokens = { postmaster: "launch" };
  place(fx, {
    workspace: outerSp.ws,
    tab: outerWatch.tab,
    pane: outerWatch.pane,
    cwd: outer,
    run: "",
  });
  st.open[fix] = copy.ws;
  saveHerdr(fx, st);

  const tm = freshTmux();
  const sessionF = tmuxSessionFor(fix);
  const runWindows: string[] = [];
  for (const [cwd, name] of [
    [synth, "coachman · leg 1"],
    [horse, "luna · workhorse · m"],
    [scratch, "solo · style review · m · r1"],
  ] as Array<[string, string]>) {
    const win = tWindow(
      tm,
      sessionF,
      name,
      { "@postmaster_cwd": cwd, "@postmaster_run": dispatch },
      1,
    );
    tm.windows[win.win]!.opts["@postmaster_pane"] = win.panes[0]!;
    runWindows.push(win.win);
  }
  const wWatch = tWindow(tm, sessionF, "watch · fixcopy", { "@postmaster_cwd": fix }, 1);
  tm.windows[wWatch.win]!.opts["@postmaster_pane"] = wWatch.panes[0]!;
  const wPm = tWindow(tm, sessionF, "postmaster", { "@postmaster_cwd": fix }, 1);
  tm.windows[wPm.win]!.opts["@postmaster_pane"] = wPm.panes[0]!;
  const sessionO = tmuxSessionFor(outer);
  const wOuter = tWindow(tm, sessionO, "watch · outer", { "@postmaster_cwd": outer }, 1);
  tm.windows[wOuter.win]!.opts["@postmaster_pane"] = wOuter.panes[0]!;
  saveTmux(fx, tm);
  return {
    fx,
    fix,
    dispatch,
    runTab: run.tab,
    runPanes,
    statePane: run.pane,
    fixSpace: copy.ws,
    pmTab: pm.tab,
    pmPane: pm.pane,
    watchTab: watch.tab,
    watchPane: watch.pane,
    outer,
    outerSpace: outerSp.ws,
    outerTab: outerWatch.tab,
    outerPane: outerWatch.pane,
    sessionF,
    runWindows,
    watchWindowF: wWatch.win,
    pmWindowF: wPm.win,
    sessionO,
    outerWindow: wOuter.win,
  };
}

export function makeFixtureRepo(fx: Fx, name: string): string {
  const fix = join(fx.root, name);
  gitInit(fix);
  mkdirSync(join(fix, ".postmaster"), { recursive: true });
  writeFileSync(join(fix, ".postmaster", "fixture"), FIXTURE_MARKER);
  const sysEnv = { ...process.env } as Record<string, string>;
  if (sh("git", ["-C", fix, "config", "--local", "postmaster.fixture", "one"], sysEnv).code !== 0)
    throw new Error("fixture config");
  return fix;
}

export function stubConfig(fx: Fx): string {
  const cfg = join(fx.root, "config.toml");
  writeFileSync(
    cfg,
    [
      "[lanes.one]",
      'harness = "claude"',
      'model = "lane-model"',
      "",
      "[team]",
      'clerk = { harness = "claude", model = "clerk-model" }',
      "",
    ].join("\n"),
  );
  return cfg;
}

export const TWO_PART = [
  "## Problem / feature",
  "",
  "The list view shows entries in whatever order they arrive. When this is done the list shows entries sorted by name.",
  "",
  "## Acceptance criteria",
  "",
  "1. The list shows its entries sorted by name.",
  "",
  "## Decisions",
  "",
  "- **D1 (proposed)** Sorting ignores letter case. Why: users expect mixed-case names together. Instead of: byte order, which splits them.",
  "",
  "## Out of scope",
  "",
  "- Grouping entries by kind.",
  "",
  "## Direction",
  "",
  "Linux and macOS. None: any approach that meets the criterion.",
  "",
  "## Turnpikes",
  "",
  "default",
  "",
  "## For the agents",
  "",
  "*Everything above is what the user signed off. This part follows from it and adds nothing to it.*",
  "",
  "### Checks",
  "",
  "- **C1** `list --sort name` on three entries out of order → names in case-blind order, exit 0. **At the base:** entries arrive unsorted.",
  "",
  "### Technical notes",
  "",
  "- The list renders in `list.ts`, sorted with a case-blind comparator. (C1, D1)",
  "",
  "### Verified at ede70e2",
  "",
  "- `list.ts` exists and renders entries unsorted.",
  "",
].join("\n");

export function clerkRepo(fx: Fx): { repo: string; id: string } {
  const repo = join(fx.root, "repo");
  gitInit(repo);
  const env = fxEnv(fx);
  if (sh(SELF, ["local", repo, "store", "init"], env, fx.root).code !== 0)
    throw new Error("store init");
  const body = join(fx.root, "body.md");
  writeFileSync(body, "A body.\n");
  const created = sh(SELF, ["local", repo, "create", "Sorted list", body], env, fx.root);
  if (created.code !== 0) throw new Error(`create: ${created.err}`);
  writeFileSync(join(fx.sys, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return { repo, id: created.out.trim() };
}

export function clerkRecord(repo: string, id: string): { handle: string } | null {
  try {
    return JSON.parse(
      readFileSync(join(repo, ".postmaster", "runs", "postmaster", "clerks", `${id}.json`), "utf8"),
    ) as { handle: string };
  } catch {
    return null;
  }
}

export interface ClerkSession {
  fx: Fx;
  repo: string;
  space: string;
  tab: string;
  pane: string;
  handle: string;
}

export function setupSession(tag: string): ClerkSession {
  const fx = makeFx(tag);
  const repo = join(fx.root, "repo");
  gitInit(repo);
  const st = freshHerdr();
  const proj = hSpace(st, basename(repo), repo);
  const tab = hTab(st, proj.ws, repo, "clerk · 1");
  st.panes[tab.pane]!.tokens = { postmaster: "launch" };
  st.agents.push("clerk-repo-1");
  st.agentPanes["clerk-repo-1"] = tab.pane;
  st.open[repo] = proj.ws;
  saveHerdr(fx, st);
  place(fx, {
    workspace: proj.ws,
    tab: tab.tab,
    pane: tab.pane,
    cwd: repo,
    run: "",
    handle: "clerk-repo-1",
  });
  const tm = freshTmux();
  saveTmux(fx, tm);
  return { fx, repo, space: proj.ws, tab: tab.tab, pane: tab.pane, handle: "clerk-repo-1" };
}

export function launchAt(dir: string, state: string): { sleep: number; group: number } {
  const sleep = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  sleep.unref();
  const pid = sleep.pid ?? 0;
  if (!pid) throw new Error("no sleep pid");
  const group = spawnSync("sh", ["-c", "exit 0"]).pid ?? 0;
  const start = processStart(pid) ?? "";
  if (!start) throw new Error("no start for sleep");
  mkdirSync(join(state, "launches"), { recursive: true });
  writeFileSync(
    join(state, "launches", String(group)),
    `${dir}\nstop-probe\nmember ${pid} ${start}\nboot ${bootId()}\n`,
  );
  return { sleep: pid, group };
}
