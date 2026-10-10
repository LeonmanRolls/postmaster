// Oracle for #375, committed before the change: each fixture run is one entry
// under the postmaster project, with everything opened for it inside, and the
// top level holds only projects. C1+C2 run the ticket's own interface (run host
// run with and without --under) with stub herdr first on PATH and match only
// what the ticket pins: no workspace create for the fixture copy, the run as
// one tab of the postmaster repository's space labelled for the fixture, and
// the copy's postmaster, watcher, coachman, workhorses and review steps each a
// pane of that tab with its own directory. C3 adds a real run beside the
// fixture run and checks creates happen only for repositories with no space
// yet. The label case pins the 30-character fixture form, and the close cases
// hold the tab's full and never-launched closes.
// Covered: C1-C3. Not covered: C4 (the fixture run, scored at landing).
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  SELF,
  addWorktree,
  calls,
  freshHerdr,
  freshTmux,
  fxEnv,
  gitInit,
  makeFixtureRepo,
  makeFx,
  readHerdr,
  saveHerdr,
  saveTmux,
  sh,
  stubConfig,
  touchesId,
} from "./acceptance-373.ts";
import {
  SHORT_NAME,
  cleanup,
  paneView,
  placementRecords,
  runLaunch,
  runTabRecords,
  writeLongDispatch,
} from "./acceptance-374.ts";
import {
  copyWatcher,
  fixTabRecords,
  headlessPostmaster,
  mainRepoOf,
  seedProjectSpace,
  toolCheckout,
  writeFixtureDispatch,
} from "./acceptance-375.ts";
import { waitFor } from "./host-self-test.ts";

describe("C1+C2: a fixture run is one tab of the postmaster project's space", () => {
  test("postmaster, watcher and run launches share the fixture tab", async () => {
    const fx = makeFx("375-layout");
    try {
      const tool = toolCheckout();
      const pmRoot = mainRepoOf(tool);
      expect(pmRoot).not.toBe("");
      const fix = makeFixtureRepo(fx, "fixcopy");
      const projSpace = seedProjectSpace(fx, pmRoot);
      const synth = addWorktree(fix, "1", "1");
      const horseA = addWorktree(fix, "1-luna", "wb/1-luna");
      const horseB = addWorktree(fix, "1-haiku", "wb/1-haiku");
      const review = addWorktree(fix, "1-rev", "wb/1-rev");
      const dispatch = join(fx.root, "dispatch", "1");
      writeFixtureDispatch(dispatch, synth, tool);
      const env = fxEnv(fx, {
        POSTMASTER_CONFIG: stubConfig(fx),
        POSTMASTER_HOST_FINISH_DELAY: "3600",
      });
      const pmMarker = join(fx.logs, "pm.done");
      const pm = headlessPostmaster(fx, env, fix, pmMarker);
      expect(`${pm.out}\n${pm.err}`).toContain("host=herdr");
      expect(pm.code).toBe(0);
      const watchMarker = join(fx.logs, "watch.done");
      const watch = copyWatcher(fx, env, fix, watchMarker);
      expect(`${watch.out}\n${watch.err}`).toContain("host=herdr");
      expect(watch.code).toBe(0);
      const launches: Array<[string, string, string]> = [
        ["coachman · m · leg 1", synth, join(fx.logs, "coach.done")],
        ["luna · workhorse · m", horseA, join(fx.logs, "luna.done")],
        ["haiku · workhorse · m", horseB, join(fx.logs, "haiku.done")],
        ["luna · bug review · m · r1", review, join(fx.logs, "rev.done")],
      ];
      for (const [name, cwd, marker] of launches) {
        const r = runLaunch(fx, env, name, cwd, dispatch, marker);
        expect(`${r.out}\n${r.err}`).toContain("host=herdr");
        expect(r.code).toBe(0);
      }
      for (const marker of [pmMarker, watchMarker, ...launches.map(([, , m]) => m)])
        expect(await waitFor(() => existsSync(marker), 30)).toBe(true);

      const hcalls = calls(fx, "herdr");
      expect(hcalls.filter((line) => line.startsWith("workspace\tcreate"))).toEqual([]);

      const st = readHerdr(fx);
      expect(Object.keys(st.spaces)).toEqual([projSpace]);
      const tabs = st.spaces[projSpace]!.tabs;
      expect(tabs.length).toBe(2);
      const fixTab = tabs.find((tab) => st.tabs[tab]!.label === "fixture · fixcopy");
      expect(fixTab).not.toBeUndefined();
      const tabPanes = st.spaces[projSpace]!.panes.filter(
        (pane) => paneView(st, pane).tab === fixTab,
      );
      // Six launches plus the tab's first pane.
      expect(tabPanes.length).toBe(7);

      const records = placementRecords(fx);
      expect(records.length).toBe(6);
      expect(records.filter((item) => item.run === dispatch).length).toBe(4);
      expect(records.filter((item) => item.run === "").length).toBe(2);
      for (const item of records) {
        expect(item.workspace).toBe(projSpace);
        expect(item.tab).toBe(fixTab);
      }
      const recordPanes = new Set(records.map((item) => String(item.pane)));
      expect(recordPanes.size).toBe(6);
      const all: Array<[string, string]> = [
        ["postmaster", fix],
        ["watch · fixcopy", fix],
        ...launches.map(([name, cwd]) => [name, cwd] as [string, string]),
      ];
      for (const [name, cwd] of all) {
        const pane = [...recordPanes].find((id) => paneView(st, id).label === name);
        expect(pane).not.toBeUndefined();
        expect(paneView(st, pane!).cwd).toBe(cwd);
        expect(paneView(st, pane!).title).toBe(name);
        expect(paneView(st, pane!).tab).toBe(fixTab);
      }
      const first = tabPanes.filter((pane) => !recordPanes.has(pane));
      expect(first.length).toBe(1);
      expect(paneView(st, first[0]!).tokens["postmaster"]).toBe("launch");
      expect(paneView(st, first[0]!).tokens["role"]).toBe("runstate");

      const runTabs = runTabRecords(fx);
      expect(runTabs.length).toBe(1);
      expect(runTabs[0]!.workspace).toBe(projSpace);
      expect(runTabs[0]!.tab).toBe(fixTab);
      const fixTabs = fixTabRecords(fx);
      expect(fixTabs.length).toBe(1);
      expect(fixTabs[0]!.workspace).toBe(projSpace);
      expect(fixTabs[0]!.tab).toBe(fixTab);
    } finally {
      cleanup(fx);
    }
  }, 600000);
});

describe("C2: the fixture tab is shared whatever launches first", () => {
  test("run launches first, postmaster and watcher join the same tab", async () => {
    const fx = makeFx("375-reverse");
    try {
      const tool = toolCheckout();
      const pmRoot = mainRepoOf(tool);
      expect(pmRoot).not.toBe("");
      const fix = makeFixtureRepo(fx, "fixcopy");
      const projSpace = seedProjectSpace(fx, pmRoot);
      const synth = addWorktree(fix, "1", "1");
      const horse = addWorktree(fix, "1-luna", "wb/1-luna");
      const dispatch = join(fx.root, "dispatch", "1");
      writeFixtureDispatch(dispatch, synth, tool);
      const env = fxEnv(fx, {
        POSTMASTER_CONFIG: stubConfig(fx),
        POSTMASTER_HOST_FINISH_DELAY: "3600",
      });
      const launches: Array<[string, string, string]> = [
        ["coachman · m · leg 1", synth, join(fx.logs, "coach.done")],
        ["luna · workhorse · m", horse, join(fx.logs, "luna.done")],
      ];
      for (const [name, cwd, marker] of launches) {
        const r = runLaunch(fx, env, name, cwd, dispatch, marker);
        expect(`${r.out}\n${r.err}`).toContain("host=herdr");
        expect(r.code).toBe(0);
      }
      const watchMarker = join(fx.logs, "watch.done");
      const watch = copyWatcher(fx, env, fix, watchMarker);
      expect(watch.code).toBe(0);
      const pmMarker = join(fx.logs, "pm.done");
      const pm = headlessPostmaster(fx, env, fix, pmMarker);
      expect(pm.code).toBe(0);
      for (const marker of [...launches.map(([, , m]) => m), watchMarker, pmMarker])
        expect(await waitFor(() => existsSync(marker), 30)).toBe(true);

      const hcalls = calls(fx, "herdr");
      expect(hcalls.filter((line) => line.startsWith("workspace\tcreate"))).toEqual([]);

      const st = readHerdr(fx);
      expect(Object.keys(st.spaces)).toEqual([projSpace]);
      const tabs = st.spaces[projSpace]!.tabs;
      expect(tabs.length).toBe(2);
      const fixTab = tabs.find((tab) => st.tabs[tab]!.label === "fixture · fixcopy");
      expect(fixTab).not.toBeUndefined();
      const tabPanes = st.spaces[projSpace]!.panes.filter(
        (pane) => paneView(st, pane).tab === fixTab,
      );
      expect(tabPanes.length).toBe(5);
      const records = placementRecords(fx);
      expect(records.length).toBe(4);
      for (const item of records) {
        expect(item.workspace).toBe(projSpace);
        expect(item.tab).toBe(fixTab);
      }
      const recordPanes = new Set(records.map((item) => String(item.pane)));
      const first = tabPanes.filter((pane) => !recordPanes.has(pane));
      expect(first.length).toBe(1);
      expect(paneView(st, first[0]!).tokens["postmaster"]).toBe("launch");
      expect(paneView(st, first[0]!).tokens["role"]).toBe("runstate");
      expect(fixTabRecords(fx).length).toBe(1);
      expect(runTabRecords(fx).length).toBe(1);
    } finally {
      cleanup(fx);
    }
  }, 600000);
});

describe("C3: creates happen only for repositories with no space yet", () => {
  test("fixture and real runs side by side create only project spaces", async () => {
    const fx = makeFx("375-create");
    try {
      const tool = toolCheckout();
      const pmRoot = mainRepoOf(tool);
      expect(pmRoot).not.toBe("");
      const fix = makeFixtureRepo(fx, "fixcopy");
      const repo = join(fx.root, "repo");
      gitInit(repo);
      saveHerdr(fx, freshHerdr());
      saveTmux(fx, freshTmux());
      const synthF = addWorktree(fix, "1", "1");
      const synthR = addWorktree(repo, "9", "9");
      const dispatchF = join(fx.root, "dispatch", "1");
      writeFixtureDispatch(dispatchF, synthF, tool);
      const dispatchR = join(fx.root, "dispatch", "9");
      writeLongDispatch(dispatchR, synthR);
      const env = fxEnv(fx, {
        POSTMASTER_CONFIG: stubConfig(fx),
        POSTMASTER_HOST_FINISH_DELAY: "3600",
      });
      const pm = headlessPostmaster(fx, env, fix, join(fx.logs, "pm.done"));
      expect(pm.code).toBe(0);
      const watch = copyWatcher(fx, env, fix, join(fx.logs, "watch.done"));
      expect(watch.code).toBe(0);
      const fr = runLaunch(
        fx,
        env,
        "coachman · m · leg 1",
        synthF,
        dispatchF,
        join(fx.logs, "coach-f.done"),
      );
      expect(fr.code).toBe(0);
      const rr = runLaunch(
        fx,
        env,
        "coachman · m · leg 1",
        synthR,
        dispatchR,
        join(fx.logs, "coach-r.done"),
      );
      expect(rr.code).toBe(0);
      for (const marker of ["pm.done", "watch.done", "coach-f.done", "coach-r.done"])
        expect(await waitFor(() => existsSync(join(fx.logs, marker)), 30)).toBe(true);

      const hcalls = calls(fx, "herdr");
      const creates = hcalls.filter((line) => line.startsWith("workspace\tcreate"));
      expect(creates.length).toBe(2);
      const flag = (line: string, name: string): string => {
        const cells = line.split("\t");
        return cells[cells.indexOf(name) + 1] ?? "";
      };
      expect(creates.map((line) => flag(line, "--cwd")).sort()).toEqual([pmRoot, repo].sort());
      expect(creates.map((line) => flag(line, "--label")).sort()).toEqual(
        [basename(pmRoot), "repo"].sort(),
      );
      expect(creates.filter((line) => line.includes(fix))).toEqual([]);

      const st = readHerdr(fx);
      expect(Object.keys(st.spaces).length).toBe(2);
      const pmSpace = Object.keys(st.spaces).find((ws) => st.spaces[ws]!.path === resolve(pmRoot));
      const repoSpace = Object.keys(st.spaces).find((ws) => st.spaces[ws]!.path === resolve(repo));
      expect(pmSpace).not.toBeUndefined();
      expect(repoSpace).not.toBeUndefined();
      const fixTab = st.spaces[pmSpace!]!.tabs.find(
        (tab) => st.tabs[tab]!.label === "fixture · fixcopy",
      );
      expect(fixTab).not.toBeUndefined();
      const runTab = st.spaces[repoSpace!]!.tabs.find((tab) => st.tabs[tab]!.label === SHORT_NAME);
      expect(runTab).not.toBeUndefined();
    } finally {
      cleanup(fx);
    }
  }, 600000);
});

describe("D1: the fixture tab is labelled for the fixture in 30 characters", () => {
  test("a long copy name cuts to the fixture word plus its start", async () => {
    const fx = makeFx("375-label");
    try {
      const tool = toolCheckout();
      const pmRoot = mainRepoOf(tool);
      expect(pmRoot).not.toBe("");
      const fix = makeFixtureRepo(fx, "259-remove-a-much-longer-name");
      const projSpace = seedProjectSpace(fx, pmRoot);
      const synth = addWorktree(fix, "1", "1");
      const dispatch = join(fx.root, "dispatch", "1");
      writeFixtureDispatch(dispatch, synth, tool);
      const env = fxEnv(fx, {
        POSTMASTER_CONFIG: stubConfig(fx),
        POSTMASTER_HOST_FINISH_DELAY: "3600",
      });
      const marker = join(fx.logs, "coach.done");
      const r = runLaunch(fx, env, "coachman · m · leg 1", synth, dispatch, marker);
      expect(`${r.out}\n${r.err}`).toContain("host=herdr");
      expect(r.code).toBe(0);
      expect(await waitFor(() => existsSync(marker), 30)).toBe(true);

      const st = readHerdr(fx);
      const tabs = st.spaces[projSpace]!.tabs;
      expect(tabs.length).toBe(2);
      const fixTab = tabs.find((tab) => st.tabs[tab]!.label.startsWith("fixture · "));
      expect(fixTab).not.toBeUndefined();
      expect(st.tabs[fixTab!]!.label).toBe("fixture · 259-remove-a-much-lo");
      expect([...st.tabs[fixTab!]!.label].length).toBeLessThanOrEqual(30);
    } finally {
      cleanup(fx);
    }
  }, 600000);
});

describe("close: the fixture tab closes with the run and the project space stays", () => {
  test("a tab with launches closes, the space stays", async () => {
    const fx = makeFx("375-close");
    try {
      const tool = toolCheckout();
      const pmRoot = mainRepoOf(tool);
      expect(pmRoot).not.toBe("");
      const fix = makeFixtureRepo(fx, "fixcopy");
      const projSpace = seedProjectSpace(fx, pmRoot);
      const seeded = readHerdr(fx);
      const shellTab = seeded.spaces[projSpace]!.tabs[0]!;
      const shellPane = seeded.spaces[projSpace]!.panes[0]!;
      const synth = addWorktree(fix, "1", "1");
      const dispatch = join(fx.root, "dispatch", "1");
      writeFixtureDispatch(dispatch, synth, tool);
      const env = fxEnv(fx, {
        POSTMASTER_CONFIG: stubConfig(fx),
        POSTMASTER_HOST_FINISH_DELAY: "3600",
      });
      const pmMarker = join(fx.logs, "pm.done");
      expect(headlessPostmaster(fx, env, fix, pmMarker).code).toBe(0);
      const watchMarker = join(fx.logs, "watch.done");
      expect(copyWatcher(fx, env, fix, watchMarker).code).toBe(0);
      const coachMarker = join(fx.logs, "coach.done");
      expect(runLaunch(fx, env, "coachman · m · leg 1", synth, dispatch, coachMarker).code).toBe(0);
      expect(placementRecords(fx).length).toBe(3);
      for (const marker of [pmMarker, watchMarker, coachMarker])
        expect(await waitFor(() => existsSync(marker), 30)).toBe(true);
      const before = readHerdr(fx);
      const fixTab = before.spaces[projSpace]!.tabs.find(
        (tab) => before.tabs[tab]!.label === "fixture · fixcopy",
      );
      expect(fixTab).not.toBeUndefined();

      const closed = sh(SELF, ["host", "close-run", dispatch], env, fx.root);
      expect(closed.code).toBe(0);
      const after = readHerdr(fx);
      expect(after.spaces[projSpace]).not.toBeUndefined();
      expect(after.spaces[projSpace]!.tabs).toEqual([shellTab]);
      expect(placementRecords(fx)).toEqual([]);
      expect(runTabRecords(fx)).toEqual([]);
      expect(fixTabRecords(fx)).toEqual([]);
      const hcalls = calls(fx, "herdr");
      expect(hcalls.filter((line) => line.startsWith("workspace\tclose"))).toEqual([]);
      expect(touchesId(hcalls, projSpace)).toEqual([]);
      expect(touchesId(hcalls, shellTab)).toEqual([]);
      expect(touchesId(hcalls, shellPane)).toEqual([]);
    } finally {
      cleanup(fx);
    }
  }, 600000);

  test("a tab with no run launch yet still closes", async () => {
    const fx = makeFx("375-close-early");
    try {
      const tool = toolCheckout();
      const pmRoot = mainRepoOf(tool);
      expect(pmRoot).not.toBe("");
      const fix = makeFixtureRepo(fx, "fixcopy");
      const projSpace = seedProjectSpace(fx, pmRoot);
      const seeded = readHerdr(fx);
      const shellTab = seeded.spaces[projSpace]!.tabs[0]!;
      const synth = addWorktree(fix, "1", "1");
      const dispatch = join(fx.root, "dispatch", "1");
      writeFixtureDispatch(dispatch, synth, tool);
      const env = fxEnv(fx, {
        POSTMASTER_CONFIG: stubConfig(fx),
        POSTMASTER_HOST_FINISH_DELAY: "3600",
      });
      const pmMarker = join(fx.logs, "pm.done");
      expect(headlessPostmaster(fx, env, fix, pmMarker).code).toBe(0);
      const watchMarker = join(fx.logs, "watch.done");
      expect(copyWatcher(fx, env, fix, watchMarker).code).toBe(0);
      expect(placementRecords(fx).length).toBe(2);
      for (const marker of [pmMarker, watchMarker])
        expect(await waitFor(() => existsSync(marker), 30)).toBe(true);
      const before = readHerdr(fx);
      const fixTab = before.spaces[projSpace]!.tabs.find(
        (tab) => before.tabs[tab]!.label === "fixture · fixcopy",
      );
      expect(fixTab).not.toBeUndefined();
      expect(runTabRecords(fx)).toEqual([]);

      const closed = sh(SELF, ["host", "close-run", dispatch], env, fx.root);
      expect(closed.code).toBe(0);
      const after = readHerdr(fx);
      expect(after.spaces[projSpace]).not.toBeUndefined();
      expect(after.spaces[projSpace]!.tabs).toEqual([shellTab]);
      expect(placementRecords(fx)).toEqual([]);
      expect(fixTabRecords(fx)).toEqual([]);
      const hcalls = calls(fx, "herdr");
      expect(hcalls.filter((line) => line.startsWith("workspace\tclose"))).toEqual([]);
      expect(touchesId(hcalls, projSpace)).toEqual([]);
      expect(touchesId(hcalls, shellTab)).toEqual([]);
    } finally {
      cleanup(fx);
    }
  }, 600000);
});
