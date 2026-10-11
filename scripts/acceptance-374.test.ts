// Oracle for #374, committed before the change: each run is one entry under
// its project, with its lanes inside it. C1+C2 run the ticket's own
// interface (run host run --under, run host spawn) with stub herdr first on
// PATH and match only what the ticket pins: no worktree open and no
// workspace create for the run, the run as one tab of the repository's
// space, each launch a pane of that tab labelled and titled by run host
// name, and no tab per launch. C3 lands a marker and checks the tab stays
// with its state pane, then close-run takes it away with the run. C4 cuts
// the run-level name to 30 characters and leaves launch names whole.
// Covered: C1-C4. Not covered: C5 (the fixture run, scored at landing).
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  SELF,
  addWorktree,
  calls,
  fxEnv,
  gitInit,
  makeFx,
  sh,
  stubConfig,
  touchesId,
  type HerdrState,
} from "./acceptance-373.ts";
import {
  LONG_NAME,
  SHORT_NAME,
  cleanup,
  openRepoSpace,
  paneView,
  placementRecords,
  runLaunch,
  runTabRecords,
  writeLongDispatch,
} from "./acceptance-374.ts";
import { waitFor } from "./host-self-test.ts";

describe("C1+C2: one run is one tab of the repository's space", () => {
  test("two launches share the run tab, and a spawn takes another tab", async () => {
    expect(LONG_NAME.length).toBe(84);
    expect(SHORT_NAME).toBe("#316, A review loop goes on un");
    const fx = makeFx("374-layout");
    try {
      const repo = join(fx.root, "repo");
      gitInit(repo);
      const projSpace = openRepoSpace(fx, repo);
      const synth = addWorktree(repo, "374", "374");
      const horseA = addWorktree(repo, "374-luna", "wb/374-luna");
      const horseB = addWorktree(repo, "374-haiku", "wb/374-haiku");
      const review = addWorktree(repo, "374-rev", "wb/374-rev");
      const dispatch = join(fx.root, "dispatch", "374");
      writeLongDispatch(dispatch, synth);
      const env = fxEnv(fx, {
        POSTMASTER_CONFIG: stubConfig(fx),
        POSTMASTER_HOST_FINISH_DELAY: "3600",
      });
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
      const spawned = sh(
        SELF,
        ["host", "spawn", "pm-374", repo, "--label", "postmaster", "--", "true"],
        env,
        fx.caller,
      );
      expect(spawned.code).toBe(0);
      for (const [, , marker] of launches)
        expect(await waitFor(() => existsSync(marker), 30)).toBe(true);

      const hcalls = calls(fx, "herdr");
      expect(hcalls.filter((line) => line.startsWith("worktree\topen"))).toEqual([]);
      expect(hcalls.filter((line) => line.startsWith("workspace\tcreate"))).toEqual([]);

      const st = JSON.parse(readFileSync(join(fx.stub, "herdr.json"), "utf8")) as HerdrState;
      expect(Object.keys(st.spaces)).toEqual([projSpace]);
      const tabs = st.spaces[projSpace]!.tabs;
      expect(tabs.length).toBe(3);
      const runTab = tabs.find((tab) => st.tabs[tab]!.label === SHORT_NAME);
      expect(runTab).not.toBeUndefined();
      const runPanes = st.spaces[projSpace]!.panes.filter(
        (pane) => paneView(st, pane).tab === runTab,
      );
      // Four launches plus the pane that shows the run's state.
      expect(runPanes.length).toBe(5);
      expect(hcalls.filter((line) => line.startsWith("tab\tcreate\t")).length).toBe(2);

      const records = placementRecords(fx).filter((item) => item.run === dispatch);
      expect(records.length).toBe(4);
      const recordPanes = new Set(records.map((item) => String(item.pane)));
      expect(recordPanes.size).toBe(4);
      for (const item of records) {
        expect(item.workspace).toBe(projSpace);
        expect(item.tab).toBe(runTab);
      }
      for (const [name, cwd] of launches) {
        const pane = [...recordPanes].find((id) => paneView(st, id).cwd === cwd);
        expect(pane).not.toBeUndefined();
        expect(paneView(st, pane!).label).toBe(name);
        expect(paneView(st, pane!).title).toBe(name);
      }
      const statePanes = runPanes.filter((pane) => !recordPanes.has(pane));
      expect(statePanes.length).toBe(1);
      expect(paneView(st, statePanes[0]!).tokens["postmaster"]).toBe("launch");
      expect(paneView(st, statePanes[0]!).tokens["role"]).toBe("runstate");

      const runTabs = runTabRecords(fx);
      expect(runTabs.length).toBe(1);
      expect(runTabs[0]!.workspace).toBe(projSpace);
      expect(runTabs[0]!.tab).toBe(runTab);

      const spawnTabs = tabs.filter((tab) => st.tabs[tab]!.label === "postmaster");
      expect(spawnTabs.length).toBe(1);
      expect(spawnTabs[0]).not.toBe(runTab);
    } finally {
      cleanup(fx);
    }
  }, 600000);
});

describe("C3: the run tab stays between launches and closes with the run", () => {
  test("a landed marker leaves the tab with its state pane; close-run takes it", async () => {
    const fx = makeFx("374-persist");
    try {
      const repo = join(fx.root, "repo");
      gitInit(repo);
      const projSpace = openRepoSpace(fx, repo);
      const rootTab = JSON.parse(readFileSync(join(fx.stub, "herdr.json"), "utf8")) as HerdrState;
      const shellTab = rootTab.spaces[projSpace]!.tabs[0]!;
      const shellPane = rootTab.spaces[projSpace]!.panes[0]!;
      const synth = addWorktree(repo, "374", "374");
      const dispatch = join(fx.root, "dispatch", "374");
      writeLongDispatch(dispatch, synth);
      const env = fxEnv(fx, { POSTMASTER_CONFIG: stubConfig(fx) });
      const marker = join(fx.logs, "coach.done");
      const r = runLaunch(fx, env, "coachman · m · leg 1", synth, dispatch, marker);
      expect(r.code).toBe(0);
      expect(await waitFor(() => existsSync(marker), 30)).toBe(true);

      const launched = JSON.parse(readFileSync(join(fx.stub, "herdr.json"), "utf8")) as HerdrState;
      const runTab = launched.spaces[projSpace]!.tabs.find(
        (tab) => launched.tabs[tab]!.label === SHORT_NAME,
      );
      expect(runTab).not.toBeUndefined();
      const launchPane = placementRecords(fx).find((item) => item.run === dispatch)?.pane;
      expect(launchPane).not.toBeUndefined();
      expect(
        await waitFor(() => {
          try {
            const now = JSON.parse(readFileSync(join(fx.stub, "herdr.json"), "utf8")) as HerdrState;
            return now.panes[String(launchPane)] === undefined;
          } catch {
            return false;
          }
        }, 30),
      ).toBe(true);

      const between = JSON.parse(readFileSync(join(fx.stub, "herdr.json"), "utf8")) as HerdrState;
      expect(between.tabs[runTab!]).not.toBeUndefined();
      const held = between.spaces[projSpace]!.panes.filter(
        (pane) => paneView(between, pane).tab === runTab,
      );
      expect(held.length).toBe(1);
      const stateOut = join(fx.stub, `pane-${held[0]}.out`);
      expect(await waitFor(() => existsSync(stateOut), 30)).toBe(true);
      expect(await waitFor(() => readFileSync(stateOut, "utf8").includes(LONG_NAME), 30)).toBe(
        true,
      );
      expect(readFileSync(stateOut, "utf8")).toContain("stage:");

      const closed = sh(SELF, ["host", "close-run", dispatch], env, fx.root);
      expect(closed.code).toBe(0);
      const after = JSON.parse(readFileSync(join(fx.stub, "herdr.json"), "utf8")) as HerdrState;
      expect(after.tabs[runTab!]).toBeUndefined();
      expect(after.panes[held[0]!]).toBeUndefined();
      expect(after.spaces[projSpace]).not.toBeUndefined();
      expect(after.tabs[shellTab]).not.toBeUndefined();
      expect(placementRecords(fx)).toEqual([]);
      expect(runTabRecords(fx)).toEqual([]);
      const hcalls = calls(fx, "herdr");
      expect(hcalls.filter((line) => line.startsWith("workspace\tclose"))).toEqual([]);
      expect(touchesId(hcalls, projSpace)).toEqual([]);
      expect(touchesId(hcalls, shellTab)).toEqual([]);
      expect(touchesId(hcalls, shellPane)).toEqual([]);
    } finally {
      cleanup(fx);
    }
  }, 600000);
});

describe("C4: the run name is cut to 30 characters", () => {
  test("host name cuts the run level and leaves launch names whole", () => {
    expect(LONG_NAME.length).toBe(84);
    const fx = makeFx("374-name");
    try {
      const repo = join(fx.root, "repo");
      gitInit(repo);
      openRepoSpace(fx, repo);
      const synth = addWorktree(repo, "374", "374");
      const dispatch = join(fx.root, "dispatch", "374");
      writeLongDispatch(dispatch, synth);
      writeFileSync(
        join(dispatch, "run.json"),
        `${JSON.stringify({
          config: {
            lanes: { luna: { model: "m/this-is-a-very-long-model-identifier-for-test" } },
            team: {
              coachman: { model: "c/another-very-long-model-identifier-for-test" },
              workhorses: [],
            },
          },
        })}\n`,
      );
      const env = fxEnv(fx, { POSTMASTER_CONFIG: stubConfig(fx) });
      const runName = sh(SELF, ["host", "name", dispatch], env, fx.root);
      expect(runName.code).toBe(0);
      expect(runName.out.trim()).toBe("#316, A review loop goes on un");
      expect(runName.out.trim().length).toBeLessThanOrEqual(30);

      const horse = sh(SELF, ["host", "name", dispatch, "workhorse", "luna"], env, fx.root);
      expect(horse.code).toBe(0);
      expect(horse.out.trim()).toBe(
        "luna · workhorse · this-is-a-very-long-model-identifier-for-test",
      );
      expect(horse.out.trim().length).toBeGreaterThan(30);

      const coach = sh(
        SELF,
        ["host", "name", dispatch, "coachman", "synthesis", "1"],
        env,
        fx.root,
      );
      expect(coach.code).toBe(0);
      expect(coach.out.trim()).toBe(
        "coachman · another-very-long-model-identifier-for-test · leg 1",
      );
      expect(coach.out.trim().length).toBeGreaterThan(30);
    } finally {
      cleanup(fx);
    }
  }, 600000);
});
