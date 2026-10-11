// Fixture helpers for the #375 oracle beside it: a fixture copy beside the
// postmaster repository's space, the copy's headless postmaster and watcher
// launches through the ticket's own interface, and readers for the fixture
// tab record.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  SELF,
  freshHerdr,
  freshTmux,
  hSpace,
  saveHerdr,
  saveTmux,
  sh,
  type Fx,
} from "./acceptance-373.ts";

// The tool checkout this test runs from: the same directory host.ts resolves
// as its tool, so the stub's worktree answers match what the code asks.
export function toolCheckout(): string {
  return dirname(realpathSync(import.meta.dir));
}

// The main repository of a checkout, the way the stub's worktree list derives
// it: the parent of the common git directory.
export function mainRepoOf(path: string): string {
  const env = { ...process.env } as Record<string, string>;
  const common = sh(
    "git",
    ["-C", path, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    env,
  );
  if (common.code !== 0) return "";
  return dirname(common.out.trim());
}

export function seedProjectSpace(fx: Fx, repoRoot: string): string {
  const st = freshHerdr();
  const proj = hSpace(st, basename(repoRoot), repoRoot);
  st.open[repoRoot] = proj.ws;
  saveHerdr(fx, st);
  saveTmux(fx, freshTmux());
  return proj.ws;
}

export function writeFixtureDispatch(dispatch: string, synth: string, tool: string): void {
  mkdirSync(join(dispatch, "logs"), { recursive: true });
  writeFileSync(
    join(dispatch, "brief.md"),
    [
      "# Waybill: 375",
      "turnpikes: style, bug, security",
      "",
      "## Ticket",
      "",
      "## Dispatch",
      "name: #1, Fixture probe",
      `dispatch: ${dispatch}`,
      `synthesis worktree: ${synth}`,
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(dispatch, "manifest.json"),
    `${JSON.stringify({ stage: "workhorses-running", leg: 1, lanes: {} })}\n`,
  );
  writeFileSync(
    join(dispatch, "run.json"),
    `${JSON.stringify({ postmaster: { checkout: tool }, config: { team: { workhorses: [] } } })}\n`,
  );
}

// The copy's own postmaster in its headless form: run host run at the copy's
// root, as the front door starts it for a marked fixture.
export function headlessPostmaster(
  fx: Fx,
  env: Record<string, string>,
  copy: string,
  marker: string,
): { code: number; out: string; err: string } {
  return sh(
    SELF,
    [
      "host",
      "run",
      "postmaster",
      copy,
      "--out",
      `${marker}.out`,
      "--err",
      `${marker}.err`,
      "--marker",
      marker,
      "--project",
      copy,
      "--",
      "/bin/true",
    ],
    env,
    fx.caller,
  );
}

// The copy's watcher in the watch form, beside the postmaster.
export function copyWatcher(
  fx: Fx,
  env: Record<string, string>,
  copy: string,
  marker: string,
): { code: number; out: string; err: string } {
  return sh(
    SELF,
    [
      "host",
      "run",
      `watch · ${basename(copy)}`,
      copy,
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

export function fixTabRecords(fx: Fx): Record<string, unknown>[] {
  const dir = join(fx.state, "fixtabs");
  if (!existsSync(dir)) return [];
  const out: Record<string, unknown>[] = [];
  for (const file of readdirSync(dir)) {
    try {
      out.push(JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>);
    } catch {}
  }
  return out;
}
