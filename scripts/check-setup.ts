// Say whether a project's settings, global and project together, are
// complete and valid: they parse, pass the checks setup applies when it
// writes a config, and carry what the route needs, a team.postmaster with a
// harness and a model. The front door runs this once the project is chosen,
// and the pass goes on only after it says set up.
//
//   run check-setup <project>
//
//   exit 0  set up
//   exit 1  not set up; stdout names what is missing, one reason per line
//   exit 2  usage
//
// A project subdirectory reads its repository's settings, as front-door
// reads them. POSTMASTER_CONFIG overrides the global config path.
import { join } from "node:path";
import {
  checkLaneEntry,
  coachmanModelProblem,
  harnessProblem,
  laneCountProblem,
  postmasterFailure,
  postmasterProblems,
  reviewersProblems,
  roleHarness,
  roleModel,
} from "./lib/config-check.ts";
import { effectiveConfigForProject, repoTopLevel } from "./lib/effective-config.ts";

const USAGE = "usage: run check-setup <project>";

function usage(): never {
  console.error(USAGE);
  process.exit(2);
}

const isTable = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** setup's checks over merged settings, in the ticket's order, then the route's needs. */
function checkMerged(cfg: Record<string, unknown>, postmasterSource: string): string[] {
  const problems: string[] = [];
  const lanes = cfg.lanes;
  const laneNames = isTable(lanes) ? Object.keys(lanes) : [];
  const count = laneCountProblem(laneNames);
  if (count !== null) problems.push(count);
  const laneModels: string[] = [];
  if (isTable(lanes)) {
    for (const name of [...laneNames].sort()) {
      const entry = checkLaneEntry(name, lanes[name]);
      problems.push(...entry.problems);
      if (entry.model !== null) laneModels.push(entry.model);
    }
  }
  const team = cfg.team;
  const teamTable = isTable(team) ? team : {};
  problems.push(...reviewersProblems(teamTable, laneNames));
  for (const role of ["coachman", "coachman_fallback", "postmaster", "clerk"]) {
    const harness = roleHarness(teamTable[role]);
    if (harness !== null) {
      const p = harnessProblem(harness);
      if (p !== null) problems.push(p);
    }
  }
  const coachmanModel = roleModel(teamTable.coachman);
  if (coachmanModel !== null) {
    const p = coachmanModelProblem(coachmanModel, laneModels, "the coachman");
    if (p !== null) problems.push(p);
  }
  const fallbackModel = roleModel(teamTable.coachman_fallback);
  if (fallbackModel !== null) {
    const p = coachmanModelProblem(fallbackModel, laneModels, "the fallback coachman");
    if (p !== null) problems.push(p);
  }
  problems.push(...postmasterProblems(teamTable.postmaster, postmasterSource));
  return problems;
}

/** Which file the failing side of the merged team.postmaster came from. The
 * merge combines the global config with the project's settings key by key,
 * a set key replacing, so a failing harness (or model) is blamed on the
 * project file exactly when that file sets it. */
function postmasterSource(
  local: unknown,
  projectFile: string | null,
  globalPath: string,
  projectAlone: boolean,
  spec: unknown,
): string {
  if (projectFile === null) return globalPath;
  if (projectAlone) return projectFile;
  const team = isTable(local) && isTable(local.team) ? local.team : {};
  const pm = team.postmaster;
  if (pm === undefined) return globalPath;
  const f = postmasterFailure(spec);
  if (f.absent || !isTable(pm)) return projectFile;
  if (f.harness !== null && Object.hasOwn(pm, "harness")) return projectFile;
  if (f.model !== null && Object.hasOwn(pm, "model")) return projectFile;
  return globalPath;
}

export interface SetupVerdict {
  code: number;
  notice: string | null;
  lines: string[];
}

/** check <target>: the set-up verdict as data; main prints it. */
export function check(target: string): SetupVerdict {
  // A subdirectory reads its repository's settings; a path git cannot place
  // keeps its own .postmaster, as front-door reads it.
  const root = repoTopLevel(target) || target;
  const resolved = effectiveConfigForProject(root);
  if (resolved.config === null || resolved.error !== null) {
    const problems = [resolved.error ?? "no effective config"];
    // The one failure that is the absence of both layers: name the project's
    // side too, so the verdict reads as no settings at all. The string is
    // effective-config's, where the error is built.
    if (problems[0].startsWith("no config at ")) {
      problems.push(`no usable project settings in ${join(root, ".postmaster", "settings.toml")}`);
    }
    return { code: 1, notice: resolved.notice, lines: [`not set up: ${root}`, ...problems] };
  }
  const mergedTeam = isTable(resolved.config.team) ? resolved.config.team : {};
  const source = postmasterSource(
    resolved.local,
    resolved.projectFile,
    resolved.globalPath,
    resolved.projectAlone,
    mergedTeam.postmaster,
  );
  const problems = checkMerged(resolved.config, source);
  if (problems.length > 0) {
    return { code: 1, notice: resolved.notice, lines: [`not set up: ${root}`, ...problems] };
  }
  return { code: 0, notice: resolved.notice, lines: [`set up: ${root}`] };
}

export function main(argv: string[]): number {
  if (argv.length !== 1 || !argv[0]) usage();
  const verdict = check(argv[0] as string);
  if (verdict.notice !== null) console.error(verdict.notice);
  console.log(verdict.lines.join("\n"));
  return verdict.code;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
