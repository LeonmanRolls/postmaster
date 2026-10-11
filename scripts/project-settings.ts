// Read, validate and write a project's optional shared and local settings.
//
//   run project-settings inspect <repo>       resolved facts and their source as JSON
//   run project-settings report <repo>        compact key=value source report
//   run project-settings effective <repo> [<machine-config>]
//                                             global config with the person's file applied
//   run project-settings accept <repo>        record the user's acceptance of the tracked file
//   run project-settings ensure <repo>         create .postmaster/.gitignore, no settings
//   run project-settings run-root <target>      create <root>/.postmaster/runs/postmaster and
//                                               the ignore rule; print <root>/.postmaster/runs
//   run project-settings exclude-worktrees <repo>
//                                               keep `.worktrees/` in the repo's git exclude
//   run project-settings write <repo> project|local [<toml-file>]
//                                             validate, then write the agreed settings
//
//   exit 0  printed, wrote, accepted, or ensured
//   exit 1  usage; anything invalid, missing, or unreadable
//
// Shared settings are .postmaster/project.toml: project facts and checks, which name no
// machine path or credential. The person's file is .postmaster/settings.toml, written
// like the global config: it overrides the global config setting by setting, a group
// merging and a list or single value replaced whole, so it may name models, env files
// and other machine settings. Missing files are normal. A settings file git tracks is
// used only after the user accepts it, and again after it changes; until then every
// reader uses the global value and says the file waits for acceptance.
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  asTable,
  effectiveConfig,
  effectiveConfigForProject,
  ensureIgnore,
  fail,
  globalConfigPath,
  inspect,
  isDie,
  loadMachine,
  pendingNoticeFor,
  projectRoot,
  pyTruthy,
  recordAcceptance,
  scanMachineData,
  sortedJson,
  strictRead,
  validateCommon,
  writeProfile,
  type Rec,
} from "./lib/effective-config.ts";
import { run } from "./lib/proc.ts";
import { pySplitLines } from "./lib/text.ts";

// Backwards-compatible names for the suite beside this file; readers import the
// loader itself.
export {
  asTable,
  effectiveConfig,
  ensureIgnore,
  inspect,
  isDie,
  loadMachine,
  pyTruthy,
  scanMachineData,
  validateCommon,
  writeProfile,
};
export type { Rec };

const USAGE =
  "usage: run project-settings inspect|report <repo> | effective <repo> [<machine-config>]" +
  " | accept <repo> | ensure <repo> | write <repo> project|local [<toml-file>]" +
  " | run-root <target> | exclude-worktrees <repo>";

const isSymlink = (p: string): boolean => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

/** The project's git toplevel: the run root lives at its <root>/.postmaster/runs. */
// Git's location variables override -C, so every git child runs without them.
const unsetGit = {
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
  GIT_COMMON_DIR: undefined,
  GIT_INDEX_FILE: undefined,
  GIT_OBJECT_DIRECTORY: undefined,
  GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
  GIT_NAMESPACE: undefined,
};
const gitToplevel = (raw: string): string => {
  const target = projectRoot(raw);
  const g = run("git", ["-C", target, "rev-parse", "--show-toplevel"], { env: unsetGit });
  if (g.code !== 0) fail(`not a git repository: ${raw}`);
  return g.out.trim();
};

/**
 * runRootPath <target>: create <root>/.postmaster/runs/postmaster and the folder's
 * ignore rule, and return <root>/.postmaster/runs, which names this project's runs.
 */
export const runRootPath = (raw: string): string => {
  const root = gitToplevel(raw);
  for (const part of [
    join(root, ".postmaster"),
    join(root, ".postmaster", "runs"),
    join(root, ".postmaster", "runs", "postmaster"),
  ]) {
    if (isSymlink(part)) fail(`${part} must be a directory inside the project, not a symlink`);
  }
  mkdirSync(join(root, ".postmaster", "runs", "postmaster"), { recursive: true });
  ensureIgnore(root, true);
  return join(root, ".postmaster", "runs");
};

/**
 * ensureWorktreesExcluded <repo>: keep `.worktrees/` in the repository's own
 * git exclude, so a pre-flight never reads the run's working copies as dirt.
 * Idempotent, and returns the file it holds.
 */
export const ensureWorktreesExcluded = (raw: string): string => {
  const repo = projectRoot(raw);
  // --git-path, not --absolute-git-dir: in a linked worktree the latter is the
  // worktree's private dir, while git reads info/exclude from the common one.
  const g = run("git", ["-C", repo, "rev-parse", "--git-path", "info/exclude"], {
    env: unsetGit,
  });
  if (g.code !== 0) fail(`not a git repository: ${raw}`);
  const file = resolve(repo, g.out.trim());
  const existing = existsSync(file) ? strictRead(file) : "";
  if (!pySplitLines(existing).includes(".worktrees/")) {
    let text = existing;
    if (text !== "" && !text.endsWith("\n")) text += "\n";
    text += ".worktrees/\n";
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return file;
};

const report = (repo: string): void => {
  const notice = pendingNoticeFor(repo);
  if (notice !== null) console.error(notice);
  const p = inspect(repo);
  console.log(`project_shared=${p.shared_present === true ? "yes" : "no"}`);
  console.log(`project_local=${p.local_present === true ? "yes" : "no"}`);
  const sources = p.sources as Rec;
  for (const key of [
    "project.default_turnpikes",
    "tracker.binding",
    "project.risk_surfaces",
    "roles",
  ]) {
    console.log(`project_source.${key}=${String(sources[key])}`);
  }
  const project = p.project as Rec;
  if (Object.hasOwn(project, "default_turnpikes")) {
    console.log(`project_default_turnpikes=${(project.default_turnpikes as string[]).join(", ")}`);
  }
  const tracker = p.tracker as Rec;
  if (Object.hasOwn(tracker, "binding")) console.log(`tracker_binding=${String(tracker.binding)}`);
};

// --- entry ----------------------------------------------------------------------------------------
const main = (): void => {
  const argv = process.argv.slice(2);
  if (argv.length === 0) fail(USAGE);
  const cmd = argv[0]!;
  const rest = argv.slice(1);
  if (cmd === "ensure" && rest.length === 1) {
    ensureIgnore(projectRoot(rest[0]!));
  } else if ((cmd === "inspect" || cmd === "report") && rest.length === 1) {
    const repo = projectRoot(rest[0]!);
    if (cmd === "report") report(repo);
    else {
      const notice = pendingNoticeFor(repo);
      if (notice !== null) console.error(notice);
      console.log(sortedJson(inspect(repo)));
    }
  } else if (cmd === "effective" && (rest.length === 1 || rest.length === 2)) {
    const repo = projectRoot(rest[0]!);
    const configPath = rest.length === 2 ? rest[1]! : undefined;
    const resolved = effectiveConfigForProject(repo, configPath);
    if (resolved.notice !== null) console.error(resolved.notice);
    if (resolved.config === null || resolved.error !== null) {
      fail(resolved.error ?? "no effective config");
    }
    console.log(sortedJson(resolved.config));
  } else if (cmd === "accept" && rest.length === 1) {
    console.log(recordAcceptance(projectRoot(rest[0]!), globalConfigPath()));
  } else if (cmd === "write" && (rest.length === 2 || rest.length === 3)) {
    writeProfile(projectRoot(rest[0]!), rest[1]!, rest.length === 3 ? rest[2]! : "-");
  } else if (cmd === "run-root" && rest.length === 1) {
    console.log(runRootPath(rest[0]!));
  } else if (cmd === "exclude-worktrees" && rest.length === 1) {
    const file = ensureWorktreesExcluded(rest[0]!);
    console.log(`project-settings: excluded .worktrees/ in ${file}`);
  } else {
    fail(USAGE);
  }
};

if (import.meta.main) {
  try {
    main();
  } catch (e) {
    if (isDie(e)) {
      console.error(`project-settings: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}
