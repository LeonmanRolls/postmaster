// Fixture helpers for the #374 oracle beside it: a dispatch named with the
// long ticket title C4 pins, a repository whose project space already
// exists, run launches through the ticket's own interface, and readers for
// the launch placements, the run tab record and pane labels.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  SELF,
  freshHerdr,
  freshTmux,
  hSpace,
  saveHerdr,
  saveTmux,
  sh,
  writeDispatch,
  type Fx,
  type HerdrState,
} from "./acceptance-373.ts";
import { killStateLoops, testStopFinishers } from "./host-self-test.ts";

// The waybill name C4 pins, 84 characters at the base.
export const LONG_NAME =
  "#316, A review loop goes on until its serious findings rise, and has no cap of three";
export const SHORT_NAME = [...LONG_NAME].slice(0, 30).join("");

export interface PaneView {
  ws: string;
  tab: string;
  cwd: string;
  tokens: Record<string, string>;
  label?: string;
  title?: string;
}

export function paneView(st: HerdrState, pane: string): PaneView {
  return st.panes[pane] as unknown as PaneView;
}

export function writeLongDispatch(dispatch: string, synth: string): void {
  writeDispatch(dispatch, synth, [], []);
  writeFileSync(
    join(dispatch, "brief.md"),
    [
      "# Waybill: 374",
      "turnpikes: style, bug, security",
      "",
      "## Ticket",
      "",
      "## Dispatch",
      `name: ${LONG_NAME}`,
      `dispatch: ${dispatch}`,
      `synthesis worktree: ${synth}`,
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dispatch, "manifest.json"),
    `${JSON.stringify({ stage: "workhorses-running", leg: 1, lanes: {} })}\n`,
  );
}

export function openRepoSpace(fx: Fx, repo: string): string {
  const st = freshHerdr();
  const proj = hSpace(st, "repo", repo);
  st.open[repo] = proj.ws;
  saveHerdr(fx, st);
  saveTmux(fx, freshTmux());
  return proj.ws;
}

export function runLaunch(
  fx: Fx,
  env: Record<string, string>,
  name: string,
  cwd: string,
  dispatch: string,
  marker: string,
): { code: number; out: string; err: string } {
  return sh(
    SELF,
    [
      "host",
      "run",
      name,
      cwd,
      "--under",
      dispatch,
      "--run",
      dispatch,
      "--out",
      `${marker}.out`,
      "--err",
      `${marker}.err`,
      "--marker",
      marker,
      "--",
      "/bin/true",
    ],
    env,
    fx.caller,
  );
}

export function placementRecords(fx: Fx): Record<string, unknown>[] {
  const dir = join(fx.state, "placements");
  if (!existsSync(dir)) return [];
  const out: Record<string, unknown>[] = [];
  for (const file of readdirSync(dir)) {
    try {
      out.push(JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>);
    } catch {}
  }
  return out;
}

export function runTabRecords(fx: Fx): Record<string, unknown>[] {
  const dir = join(fx.state, "runtabs");
  if (!existsSync(dir)) return [];
  const out: Record<string, unknown>[] = [];
  for (const file of readdirSync(dir)) {
    try {
      out.push(JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>);
    } catch {}
  }
  return out;
}

// The state pane's refresh loop outlives the test; the shared killer stops
// it, the finishers stop, and the fixture goes.
export function cleanup(fx: Fx): void {
  testStopFinishers(fx.root);
  killStateLoops(fx.stub);
  rmSync(fx.root, { recursive: true, force: true });
}
