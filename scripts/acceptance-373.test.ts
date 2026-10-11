// Oracle for #373, committed before the change: when the postmaster cleans up after
// a run, every entry the flow opened for that run closes, and what the user opened
// stays. C1 runs close-run over run entries, a fixture copy's space and the project's
// own watcher tab; C2 marks a clerk ticket ready and its session closes once its turn
// ends; C3 checks each user entry stays, named and in place.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  SELF,
  TWO_PART,
  calls,
  clerkRecord,
  clerkRepo,
  freshHerdr,
  freshTmux,
  fxEnv,
  gitInit,
  hSpace,
  hSplit,
  hTab,
  launchAt,
  makeFixtureRepo,
  makeFx,
  place,
  placementTabs,
  readHerdr,
  readPlacement,
  readTmux,
  saveHerdr,
  saveTmux,
  setupFixture,
  setupNormal,
  setupSession,
  sh,
  stubConfig,
  tWindow,
  tmuxSessionFor,
  touchesId,
  writeDispatch,
} from "./acceptance-373.ts";
import { runTabRecords } from "./acceptance-374.ts";
import { fixTabRecords, mainRepoOf, toolCheckout } from "./acceptance-375.ts";
import { testStopFinishers, waitFor } from "./host-self-test.ts";
import { processState } from "./lib/processes.ts";
describe("C1: close-run", () => {
  test("every run entry closes once, and the project's own watcher tab stays", () => {
    const t = setupNormal("c1");
    try {
      const r = sh(SELF, ["host", "close-run", t.dispatch], fxEnv(t.fx), t.fx.root);
      expect(`${r.out}\n${r.err}`).not.toContain("could not");
      expect(r.code).toBe(0);
      const st = readHerdr(t.fx);
      expect(st.tabs[t.runTab]).toBeUndefined();
      for (const pane of [...t.runPanes, t.statePane]) expect(st.panes[pane]).toBeUndefined();
      expect(Object.keys(st.tabs)).toContain(t.watcherTab);
      expect(Object.keys(st.tabs)).toContain(t.shellTab);
      expect(st.tabs[t.watcherTab]!.ws).toBe(t.projSpace);
      expect(st.spaces[t.projSpace]).not.toBeUndefined();
      const hcalls = calls(t.fx, "herdr");
      for (const pane of t.runPanes)
        expect(hcalls.filter((line) => line === `pane\tclose\t${pane}`).length).toBe(1);
      expect(hcalls.filter((line) => line === `tab\tclose\t${t.runTab}`).length).toBe(1);
      // The project's space is shared: run host closes the run tab, never the space.
      expect(hcalls.filter((line) => line.startsWith("workspace\tclose"))).toEqual([]);
      expect(touchesId(hcalls, t.watcherTab)).toEqual([]);
      expect(touchesId(hcalls, t.watcherPane)).toEqual([]);
      expect(touchesId(hcalls, t.projSpace)).toEqual([]);
      expect(hcalls.some((line) => line.split("\t")[1] === "rename")).toBe(false);
      expect(placementTabs(t.fx).sort()).toEqual([t.watcherTab]);

      const tm = readTmux(t.fx);
      for (const win of t.runWindows) expect(tm.windows[win]).toBeUndefined();
      expect(tm.windows[t.watcherWindow]).not.toBeUndefined();
      expect(tm.windows[t.postWindow]).not.toBeUndefined();
      expect(tm.sessions).toContain(t.session);
      const tcalls = calls(t.fx, "tmux");
      for (const win of t.runWindows) expect(touchesId(tcalls, win).length).toBe(1);
      expect(touchesId(tcalls, t.watcherWindow)).toEqual([]);
      expect(touchesId(tcalls, t.postWindow)).toEqual([]);
    } finally {
      rmSync(t.fx.root, { recursive: true, force: true });
    }
  });
});
describe("C1: close-run on a fixture copy", () => {
  test("the copy's space, its postmaster and watcher tabs close; the outer watcher stays", () => {
    const t = setupFixture("c1fix", false);
    try {
      const r = sh(SELF, ["host", "close-run", t.dispatch], fxEnv(t.fx), t.fx.root);
      expect(r.code).toBe(0);
      const st = readHerdr(t.fx);
      expect(st.tabs[t.runTab]).toBeUndefined();
      for (const pane of [...t.runPanes, t.statePane]) expect(st.panes[pane]).toBeUndefined();
      expect(st.spaces[t.fixSpace]).toBeUndefined();
      for (const tab of [t.pmTab, t.watchTab]) expect(st.tabs[tab]).toBeUndefined();
      expect(st.tabs[t.outerTab]).not.toBeUndefined();
      expect(st.spaces[t.outerSpace]).not.toBeUndefined();
      const hcalls = calls(t.fx, "herdr");
      for (const pane of t.runPanes)
        expect(hcalls.filter((line) => line === `pane\tclose\t${pane}`).length).toBe(1);
      for (const tab of [t.runTab, t.pmTab, t.watchTab])
        expect(hcalls.filter((line) => line === `tab\tclose\t${tab}`).length).toBe(1);
      expect(
        hcalls.filter((line) => line === `workspace\tclose\t${t.fixSpace}`).length,
      ).toBeLessThanOrEqual(1);
      expect(touchesId(hcalls, t.outerTab)).toEqual([]);
      expect(touchesId(hcalls, t.outerPane)).toEqual([]);
      expect(touchesId(hcalls, t.outerSpace)).toEqual([]);
      expect(placementTabs(t.fx).sort()).toEqual([t.outerTab]);

      const tm = readTmux(t.fx);
      for (const win of [...t.runWindows, t.watchWindowF, t.pmWindowF])
        expect(tm.windows[win]).toBeUndefined();
      expect(tm.sessions).not.toContain(t.sessionF);
      expect(tm.windows[t.outerWindow]).not.toBeUndefined();
      const tcalls = calls(t.fx, "tmux");
      for (const win of [...t.runWindows, t.watchWindowF, t.pmWindowF])
        expect(touchesId(tcalls, win).length).toBe(1);
      expect(touchesId(tcalls, t.outerWindow)).toEqual([]);
    } finally {
      rmSync(t.fx.root, { recursive: true, force: true });
    }
  });

  test("a root pane outliving the tabs closes with the copy's space", () => {
    const t = setupFixture("c1fixroot", false);
    try {
      const st0 = readHerdr(t.fx);
      const root = hTab(st0, t.fixSpace, t.fix, basename(t.fix));
      st0.panes[root.pane]!.tokens = { postmaster: "root" };
      saveHerdr(t.fx, st0);
      const r = sh(SELF, ["host", "close-run", t.dispatch], fxEnv(t.fx), t.fx.root);
      expect(r.code).toBe(0);
      expect(readHerdr(t.fx).spaces[t.fixSpace]).toBeUndefined();
      const hcalls = calls(t.fx, "herdr");
      expect(hcalls.filter((line) => line === `workspace\tclose\t${t.fixSpace}`).length).toBe(1);
      expect(touchesId(hcalls, t.outerSpace)).toEqual([]);
    } finally {
      rmSync(t.fx.root, { recursive: true, force: true });
    }
  });
});
describe("C3: user entries stay", () => {
  test("(a) a tab the user opened in the project's space stays, in place and named", () => {
    const t = setupNormal("c3a");
    try {
      const st0 = readHerdr(t.fx);
      const user = hTab(st0, t.projSpace, t.repo, "user tab");
      st0.panes[user.pane]!.tokens = {};
      saveHerdr(t.fx, st0);
      const r = sh(SELF, ["host", "close-run", t.dispatch], fxEnv(t.fx), t.fx.root);
      expect(r.code).toBe(0);
      const st = readHerdr(t.fx);
      expect(st.tabs[user.tab]).not.toBeUndefined();
      expect(st.tabs[user.tab]!.ws).toBe(t.projSpace);
      expect(st.tabs[user.tab]!.label).toBe("user tab");
      const hcalls = calls(t.fx, "herdr");
      expect(touchesId(hcalls, user.tab)).toEqual([]);
      expect(touchesId(hcalls, user.pane)).toEqual([]);
    } finally {
      rmSync(t.fx.root, { recursive: true, force: true });
    }
  });

  test("(b) a pane the user split into the run tab stays with its tab, named", () => {
    const t = setupNormal("c3b");
    try {
      const st0 = readHerdr(t.fx);
      const userPane = hSplit(st0, t.projSpace, t.runTab, t.horse);
      saveHerdr(t.fx, st0);
      const r = sh(SELF, ["host", "close-run", t.dispatch], fxEnv(t.fx), t.fx.root);
      expect(r.code).toBe(2);
      expect(`${r.out}\n${r.err}`).toContain(t.runTab);
      const st = readHerdr(t.fx);
      expect(st.panes[userPane]).not.toBeUndefined();
      expect(st.panes[t.statePane]).not.toBeUndefined();
      for (const pane of t.runPanes) expect(st.panes[pane]).toBeUndefined();
      expect(st.tabs[t.runTab]).not.toBeUndefined();
      expect(st.tabs[t.runTab]!.ws).toBe(t.projSpace);
      expect(st.spaces[t.projSpace]).not.toBeUndefined();
      const hcalls = calls(t.fx, "herdr");
      expect(touchesId(hcalls, userPane)).toEqual([]);
    } finally {
      rmSync(t.fx.root, { recursive: true, force: true });
    }
  });

  test("(c) a tab the user opened in a fixture copy's space keeps the space open, named", () => {
    const t = setupFixture("c3c", true);
    try {
      const r = sh(SELF, ["host", "close-run", t.dispatch], fxEnv(t.fx), t.fx.root);
      expect(r.code).toBe(2);
      expect(`${r.out}\n${r.err}`).toContain(t.fixSpace);
      const st = readHerdr(t.fx);
      expect(st.spaces[t.fixSpace]).not.toBeUndefined();
      expect(st.tabs[t.runTab]).toBeUndefined();
      for (const pane of [...t.runPanes, t.statePane]) expect(st.panes[pane]).toBeUndefined();
      expect(st.tabs[t.pmTab]).toBeUndefined();
      expect(st.tabs[t.watchTab]).toBeUndefined();
      const userTabs = Object.entries(st.tabs)
        .filter(([tab, entry]) => entry.ws === t.fixSpace && tab !== t.pmTab && tab !== t.watchTab)
        .map(([tab]) => tab);
      expect(userTabs.length).toBe(1);
      const hcalls = calls(t.fx, "herdr");
      expect(touchesId(hcalls, userTabs[0]!)).toEqual([]);
      expect(hcalls.filter((line) => line === `workspace\tclose\t${t.fixSpace}`).length).toBe(0);
    } finally {
      rmSync(t.fx.root, { recursive: true, force: true });
    }
  });

  test("(d) a tab the user renamed keeps its name, and no unrecorded id is touched", () => {
    const t = setupNormal("c3d");
    try {
      const st0 = readHerdr(t.fx);
      const user = hTab(st0, t.projSpace, t.repo, "user name");
      st0.panes[user.pane]!.tokens = {};
      saveHerdr(t.fx, st0);
      const r = sh(SELF, ["host", "close-run", t.dispatch], fxEnv(t.fx), t.fx.root);
      expect(r.code).toBe(0);
      const st = readHerdr(t.fx);
      expect(st.tabs[user.tab]).not.toBeUndefined();
      expect(st.tabs[user.tab]!.label).toBe("user name");
      expect(st.tabs[t.runTab]).toBeUndefined();
      expect(st.spaces[t.projSpace]).not.toBeUndefined();
      const hcalls = calls(t.fx, "herdr");
      const tcalls = calls(t.fx, "tmux");
      expect(touchesId(hcalls, user.tab)).toEqual([]);
      expect(touchesId(hcalls, user.pane)).toEqual([]);
      expect(hcalls.some((line) => line.split("\t")[1] === "rename")).toBe(false);
      expect(touchesId(hcalls, t.watcherTab)).toEqual([]);
      expect(touchesId(tcalls, t.watcherWindow)).toEqual([]);
    } finally {
      rmSync(t.fx.root, { recursive: true, force: true });
    }
  });
});
describe("a fixture copy's spawn joins its tab in the project space", () => {
  // A run launch on a fixture copy is covered by the #375 oracle beside it,
  // which pins the shared tab, the missing create for the copy and the close.
  test("spawn on a fixture copy opens the fixture tab and records its handle", () => {
    const fx = makeFx("fixture-spawn");
    try {
      const tool = toolCheckout();
      const pmRoot = mainRepoOf(tool);
      expect(pmRoot).not.toBe("");
      const fix = makeFixtureRepo(fx, "fixcopy");
      saveHerdr(fx, freshHerdr());
      saveTmux(fx, freshTmux());
      const env = fxEnv(fx, { POSTMASTER_CONFIG: stubConfig(fx) });
      const r = sh(
        SELF,
        ["host", "spawn", "pm-one", fix, "--label", "postmaster", "--", "true"],
        env,
        fx.caller,
      );
      expect(r.code).toBe(0);
      // The project space is created for a repository with no space yet, and
      // never marked: it is shared, and no close may sweep it. The copy gets
      // no space at all.
      const hcalls = calls(fx, "herdr");
      const creates = hcalls.filter((line) => line.startsWith("workspace\tcreate"));
      expect(creates.length).toBe(1);
      const cells = creates[0]!.split("\t");
      expect(cells[cells.indexOf("--cwd") + 1]).toBe(pmRoot);
      expect(cells[cells.indexOf("--label") + 1]).toBe(basename(pmRoot));
      expect(creates[0]!.includes(fix)).toBe(false);
      expect(hcalls.some((line) => line.includes("postmaster=opened"))).toBe(false);
      const st = readHerdr(fx);
      const spaces = Object.keys(st.spaces);
      expect(spaces.length).toBe(1);
      expect(st.spaces[spaces[0]!]!.tokens).toEqual({});
      const tabs = st.spaces[spaces[0]!]!.tabs;
      expect(tabs.length).toBe(2);
      const fixTab = tabs.find((tab) => st.tabs[tab]!.label === "fixture · fixcopy");
      expect(fixTab).not.toBeUndefined();
      const panes = st.spaces[spaces[0]!]!.panes.filter((pane) => st.panes[pane]!.tab === fixTab);
      expect(panes.length).toBe(2);
      const launched = panes.find((pane) => st.panes[pane]!.label === "postmaster");
      expect(launched).not.toBeUndefined();
      expect(st.panes[launched!]!.cwd).toBe(fix);
      expect(st.panes[launched!]!.title).toBe("postmaster");
      expect(st.panes[launched!]!.tokens).toEqual({ postmaster: "launch" });
      const holding = panes.find((pane) => pane !== launched);
      expect(st.panes[holding!]!.tokens).toEqual({ postmaster: "launch" });
      expect(placementTabs(fx)).toEqual([fixTab]);
      expect(readPlacement(fx, launched!).handle).toBe("pm-one");
      expect(fixTabRecords(fx).length).toBe(1);
      expect(runTabRecords(fx)).toEqual([]);
    } finally {
      testStopFinishers(fx.root);
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
});
describe("spawn on an ordinary project", () => {
  test("spawn on an ordinary project leaves the project space unmarked", () => {
    const fx = makeFx("create-plain");
    try {
      const repo = join(fx.root, "repo");
      gitInit(repo);
      const env = fxEnv(fx, { POSTMASTER_CONFIG: stubConfig(fx) });
      const r = sh(
        SELF,
        ["host", "spawn", "pm-plain", repo, "--label", "postmaster", "--", "true"],
        env,
        fx.caller,
      );
      expect(r.code).toBe(0);
      const st = readHerdr(fx);
      const spaces = Object.keys(st.spaces);
      expect(spaces.length).toBe(1);
      expect(st.spaces[spaces[0]!]!.tokens).toEqual({});
      const hcalls = calls(fx, "herdr");
      expect(hcalls.some((line) => line.includes("postmaster=opened"))).toBe(false);
    } finally {
      testStopFinishers(fx.root);
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
});
describe("close-handle", () => {
  test("a recorded session closes its tab and frees its handle", () => {
    const t = setupSession("ch-close");
    try {
      const r = sh(SELF, ["host", "close-handle", t.handle], fxEnv(t.fx), t.fx.root);
      expect(r.code).toBe(0);
      expect(r.out).toContain(`closed ${t.handle}`);
      const st = readHerdr(t.fx);
      expect(st.tabs[t.tab]).toBeUndefined();
      expect(st.panes[t.pane]).toBeUndefined();
      expect(st.spaces[t.space]).not.toBeUndefined();
      expect(placementTabs(t.fx)).toEqual([]);
      const again = sh(SELF, ["host", "read", t.handle, "5"], fxEnv(t.fx), t.fx.root);
      expect(again.code).not.toBe(0);
    } finally {
      rmSync(t.fx.root, { recursive: true, force: true });
    }
  });

  test("an unknown handle reports no session, exit 0", () => {
    const t = setupSession("ch-missing");
    try {
      const r = sh(SELF, ["host", "close-handle", "never-spawned"], fxEnv(t.fx), t.fx.root);
      expect(r.code).toBe(0);
      expect(r.out).toContain("no session never-spawned");
      const st = readHerdr(t.fx);
      expect(st.tabs[t.tab]).not.toBeUndefined();
    } finally {
      rmSync(t.fx.root, { recursive: true, force: true });
    }
  });

  test("a live session with no record is refused, and its tab stays", () => {
    const fx = makeFx("ch-unrecorded");
    try {
      const repo = join(fx.root, "repo");
      gitInit(repo);
      const st = freshHerdr();
      const proj = hSpace(st, basename(repo), repo);
      const tab = hTab(st, proj.ws, repo, "user agent");
      st.panes[tab.pane]!.tokens = {};
      st.agents.push("user-agent");
      st.agentPanes["user-agent"] = tab.pane;
      saveHerdr(fx, st);
      saveTmux(fx, freshTmux());
      const r = sh(SELF, ["host", "close-handle", "user-agent"], fxEnv(fx), fx.root);
      expect(r.code).toBe(2);
      const after = readHerdr(fx);
      expect(after.tabs[tab.tab]).not.toBeUndefined();
      expect(touchesId(calls(fx, "herdr"), tab.tab)).toEqual([]);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  test("a split tab keeps the user's pane with the tab, named", () => {
    const t = setupSession("ch-split");
    try {
      const st0 = readHerdr(t.fx);
      const userPane = hSplit(st0, t.space, t.tab, t.repo);
      saveHerdr(t.fx, st0);
      const r = sh(SELF, ["host", "close-handle", t.handle], fxEnv(t.fx), t.fx.root);
      expect(r.code).toBe(2);
      expect(`${r.out}\n${r.err}`).toContain(t.tab);
      const st = readHerdr(t.fx);
      expect(st.tabs[t.tab]).not.toBeUndefined();
      expect(st.panes[userPane]).not.toBeUndefined();
      expect(st.panes[t.pane]).toBeUndefined();
      expect(touchesId(calls(t.fx, "herdr"), userPane)).toEqual([]);
    } finally {
      rmSync(t.fx.root, { recursive: true, force: true });
    }
  });

  test("tmux closes a spawned window by its recorded handle", () => {
    const fx = makeFx("ch-tmux");
    try {
      const repo = join(fx.root, "repo");
      gitInit(repo);
      writeFileSync(join(fx.stub, "herdr.down"), "");
      const tm = freshTmux();
      const session = tmuxSessionFor(repo);
      const win = tWindow(
        tm,
        session,
        "clerk-repo-1",
        { "@postmaster_cwd": repo, "@postmaster_handle": "clerk-repo-1" },
        1,
      );
      tm.windows[win.win]!.opts["@postmaster_pane"] = win.panes[0]!;
      const other = tWindow(tm, session, "user window", {}, 1);
      saveTmux(fx, tm);
      saveHerdr(fx, freshHerdr());
      const r = sh(SELF, ["host", "close-handle", "clerk-repo-1"], fxEnv(fx), fx.root);
      expect(r.code).toBe(0);
      const after = readTmux(fx);
      expect(after.windows[win.win]).toBeUndefined();
      expect(after.windows[other.win]).not.toBeUndefined();
      expect(touchesId(calls(fx, "tmux"), other.win)).toEqual([]);
      const missing = sh(SELF, ["host", "close-handle", "never-spawned"], fxEnv(fx), fx.root);
      expect(missing.code).toBe(0);
      expect(missing.out).toContain("no session never-spawned");
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  test("tmux refuses a window named for the handle that it did not open", () => {
    const fx = makeFx("ch-tmux-user");
    try {
      const repo = join(fx.root, "repo");
      gitInit(repo);
      writeFileSync(join(fx.stub, "herdr.down"), "");
      const tm = freshTmux();
      const session = tmuxSessionFor(repo);
      const win = tWindow(tm, session, "clerk-repo-1", {}, 1);
      saveTmux(fx, tm);
      saveHerdr(fx, freshHerdr());
      const r = sh(SELF, ["host", "close-handle", "clerk-repo-1"], fxEnv(fx), fx.root);
      expect(r.code).toBe(2);
      expect(readTmux(fx).windows[win.win]).not.toBeUndefined();
      expect(touchesId(calls(fx, "tmux"), win.win)).toEqual([]);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
});
describe("C2: a clerk session closes once its ticket is marked ready", () => {
  test("start, mark, turn ends: the tab closes and a new clerk starts", async () => {
    const fx = makeFx("c2");
    try {
      const { repo, id } = clerkRepo(fx);
      const env = fxEnv(fx, {
        POSTMASTER_CONFIG: stubConfig(fx),
        POSTMASTER_CLERK_CLOSE_WAIT: "15",
      });
      const started = sh(SELF, ["clerk", "start", repo, id], env, fx.root);
      expect(`${started.out}\n${started.err}`).toContain("opened");
      expect(started.code).toBe(0);
      const first = clerkRecord(repo, id);
      expect(first).not.toBeNull();
      const handle = first!.handle;
      expect(handle.startsWith(`clerk-${basename(repo)}-${id}`)).toBe(true);
      const tabsBefore = Object.keys(readHerdr(fx).tabs);
      expect(tabsBefore.length).toBe(1);
      const tab = tabsBefore[0]!;

      const final = join(fx.root, "final.md");
      writeFileSync(final, TWO_PART);
      const marked = sh(
        SELF,
        ["ticket-ready", "mark", repo, id, "--body", final, "--title", "Sorted list"],
        env,
        fx.root,
      );
      expect(marked.code).toBe(0);
      expect(marked.out).toContain("marked ready and queued");
      expect(marked.out).toContain("closes when its turn ends");

      expect(
        await waitFor(
          () => clerkRecord(repo, id) === null && readHerdr(fx).tabs[tab] === undefined,
          30,
        ),
      ).toBe(true);
      const hcalls = calls(fx, "herdr");
      expect(hcalls.filter((line) => line === `tab\tclose\t${tab}`).length).toBe(1);
      const read = sh(SELF, ["host", "read", handle, "5"], env, fx.root);
      expect(read.code).not.toBe(0);

      const again = sh(SELF, ["clerk", "start", repo, id], env, fx.root);
      expect(again.code).toBe(0);
      const second = clerkRecord(repo, id);
      expect(second).not.toBeNull();
      expect(second!.handle).not.toBe(handle);
      expect(Object.keys(readHerdr(fx).tabs).length).toBe(1);
    } finally {
      testStopFinishers(fx.root);
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  test("marking with no clerk session arms nothing", () => {
    const fx = makeFx("c2-none");
    try {
      const { repo, id } = clerkRepo(fx);
      const env = fxEnv(fx, { POSTMASTER_CONFIG: stubConfig(fx) });
      const final = join(fx.root, "final.md");
      writeFileSync(final, TWO_PART);
      const marked = sh(
        SELF,
        ["ticket-ready", "mark", repo, id, "--body", final, "--title", "Sorted list"],
        env,
        fx.root,
      );
      expect(marked.code).toBe(0);
      expect(marked.out).toContain("marked ready and queued");
      expect(marked.out).not.toContain("closes when its turn ends");
      expect(
        existsSync(join(repo, ".postmaster", "runs", "postmaster", "clerks", `${id}.close.log`)),
      ).toBe(false);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  test("_clerk-close waits for the turn, then closes and drops the record", () => {
    const fx = makeFx("c2-direct");
    try {
      const repo = join(fx.root, "repo");
      gitInit(repo);
      const st = freshHerdr();
      const proj = hSpace(st, basename(repo), repo);
      const tab = hTab(st, proj.ws, repo, "clerk · 1");
      st.panes[tab.pane]!.tokens = { postmaster: "launch" };
      st.agents.push("clerk-repo-1");
      st.agentPanes["clerk-repo-1"] = tab.pane;
      saveHerdr(fx, st);
      saveTmux(fx, freshTmux());
      place(fx, {
        workspace: proj.ws,
        tab: tab.tab,
        pane: tab.pane,
        cwd: repo,
        run: "",
        handle: "clerk-repo-1",
      });
      const dir = join(repo, ".postmaster", "runs", "postmaster", "clerks");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "1.json"),
        `${JSON.stringify({ ticket: "#1, x", brief: join(repo, "b.md"), handle: "clerk-repo-1", opened: new Date().toISOString() })}\n`,
      );
      const env = fxEnv(fx);
      const r = sh(SELF, ["host", "_clerk-close", repo, "1", "clerk-repo-1"], env, fx.root);
      expect(r.code).toBe(0);
      expect(readHerdr(fx).tabs[tab.tab]).toBeUndefined();
      expect(clerkRecord(repo, "1")).toBeNull();
      const repeat = sh(SELF, ["host", "_clerk-close", repo, "1", "clerk-repo-1"], env, fx.root);
      expect(repeat.code).toBe(0);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
});
describe("stop-run on a fixture copy", () => {
  test("a launch at the copy's root stops; elsewhere it is left alone", async () => {
    const fx = makeFx("stoprun");
    let sleepF = 0;
    let sleepP = 0;
    try {
      const fix = makeFixtureRepo(fx, "fixcopy");
      const plain = join(fx.root, "plain");
      gitInit(plain);
      const synthF = join(fix, ".worktrees", "1");
      const synthP = join(plain, ".worktrees", "373");
      const dispatchF = join(fx.root, "dispatch", "1");
      const dispatchP = join(fx.root, "dispatch", "373");
      writeDispatch(dispatchF, synthF, [], []);
      writeDispatch(dispatchP, synthP, [], []);
      const env = fxEnv(fx);
      sleepF = launchAt(fix, fx.state).sleep;
      sleepP = launchAt(plain, fx.state).sleep;
      await Bun.sleep(200);
      const stopped = sh(SELF, ["host", "stop-run", dispatchF], env, fx.root);
      expect(stopped.code).toBe(0);
      expect(await waitFor(() => processState(sleepF) !== "live", 10)).toBe(true);
      const left = sh(SELF, ["host", "stop-run", dispatchP], env, fx.root);
      expect(left.code).toBe(0);
      expect(processState(sleepP)).toBe("live");
    } finally {
      for (const pid of [sleepF, sleepP]) {
        try {
          if (pid) process.kill(pid, "SIGKILL");
        } catch {}
      }
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
});
