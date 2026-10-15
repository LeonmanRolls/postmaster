// Helpers for the #479 oracle: a scratch app with local verifiers depending
// on a project file, a stub session that plays a finished upkeep pass without
// committing, and the reports it plays. The tests spawn git and scripts/run as
// subprocesses; nothing here imports the change.
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commitAll, gitOrThrow, writeRepoFile } from "./acceptance-323.ts";
import { makeEnv, makeSandbox, RUN, type Sandbox } from "./acceptance-344.ts";
import {
  provenSection,
  verifierWork,
  writeLocalStub,
  type LocalSurface,
} from "./acceptance-477.ts";
import { CLI, expectCode } from "./acceptance-478.ts";
import { run, type RunResult } from "./lib/proc.ts";

export { CLI, RUN };
export type { Sandbox };

export const LOCAL = ".postmaster/verifier";
export const VDIR = `${LOCAL}/cli`;
export const PAGE1 = `${VDIR}/features/f1.md`;
export const PAGE2 = `${VDIR}/features/f2.md`;
export const PAGE3 = `${VDIR}/features/f3.md`;
export const PAGES = [PAGE1, PAGE2, PAGE3];

/** Shell lines appending one bullet with the given Files list to the local index. */
function indexBulletFiles(root: string, surface: LocalSurface, files: string): string {
  return `printf -- '- The ${surface.prose} verifier in ${root}/${surface.seg}/: drives it. Files: ${files}, Confirmed: %s\\n' "$SHA" >> ${root}/README.md`;
}

/** The work a stub session plays for a local make whose index depends on the given files. */
export function localWorkFiles(proven: LocalSurface[], files: string): string[] {
  const root = ".postmaster/verifier";
  const lines = ["SHA=$(git rev-parse HEAD)"];
  for (const s of proven) lines.push(...verifierWork(`${root}/${s.seg}`, s));
  lines.push(`printf '# Verifiers\\n\\n' > ${root}/README.md`);
  for (const s of proven) lines.push(indexBulletFiles(root, s, files));
  lines.push(`printf '# Handover\\n\\n' > HANDOVER.md`);
  for (const s of proven) lines.push(...provenSection(`${root}/${s.seg}`, s));
  return lines;
}

/**
 * A scratch app whose local verifiers the real make kept, depending on
 * src/cli.txt and confirmed at the first commit. The caller changes the
 * depended file and commits again, then drives stale and upkeep.
 */
export function scratchLocalApp(): Sandbox & { first: string } {
  const sandbox = makeSandbox();
  writeRepoFile(sandbox.repo, "src/cli.txt", "v1\n");
  commitAll(sandbox.repo, "cli");
  const first = gitOrThrow(sandbox.repo, "rev-parse", "HEAD").trim();
  writeLocalStub(sandbox.bin, localWorkFiles([CLI], "src/cli.txt").join("\n"));
  const r = run(RUN, ["verifier", "make", sandbox.repo, "cli", "--run", sandbox.dispatch], {
    env: makeEnv(sandbox, { POSTMASTER_HOST: "none" }),
  });
  expectCode(r, 0);
  return { ...sandbox, first };
}

/**
 * A stub `claude` that plays a finished upkeep pass in its cwd without
 * committing: it lays down the report ORACLE_REPORT names as UPKEEP.md and
 * overlays the corrections ORACLE_OVERLAY names, leaving everything
 * uncommitted the way a local pass does.
 */
export function writeStubLocalUpkeep(bin: string): void {
  const path = join(bin, "claude");
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      "set -eu",
      'if [ -z "${ORACLE_ROOT:-}" ]; then echo "stub refuses: ORACLE_ROOT is unset" >&2; exit 1; fi',
      'if [ -z "${ORACLE_REPORT:-}" ]; then echo "stub refuses: ORACLE_REPORT is unset" >&2; exit 1; fi',
      'TARGET="$PWD"',
      'TARGET=$(CDPATH= cd "$TARGET" && pwd -P) || { echo "stub refuses: cannot resolve $TARGET" >&2; exit 1; }',
      'case "$TARGET" in',
      '  "${ORACLE_ROOT}"/*) ;;',
      '  *) echo "stub refuses: $TARGET is outside $ORACLE_ROOT" >&2; exit 1 ;;',
      "esac",
      'cp "$ORACLE_REPORT" ./UPKEEP.md',
      'if [ -n "${ORACLE_OVERLAY:-}" ]; then',
      '  cp -R "$ORACLE_OVERLAY/." .',
      "fi",
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
}

/** One clean feature section, in report order. */
export function cleanFeature(page: string): string {
  return [`## Feature: ${page}`, "Outcome: clean", ""].join("\n");
}

export const CLAIM_NAME = "f1: the help line";
const CLAIM_STATED = "stdout is usage: cli";
const CLAIM_FOUND = "stdout is usage: cli [--json]";
const CLAIM_CHANGE = "reworded the usage line on the page and drove the recipe again: holds";

/** One stale claim the pass left alone, in report order. */
function staleClaim(): string {
  return [
    `## Claim: ${CLAIM_NAME}`,
    `Page: ${PAGE1}`,
    "Verdict: stale",
    `Stated: ${CLAIM_STATED}`,
    `Found: ${CLAIM_FOUND}`,
    "",
  ].join("\n");
}

/** One stale claim the pass corrected, in report order. */
function correctedClaim(): string {
  return [
    `## Claim: ${CLAIM_NAME}`,
    `Page: ${PAGE1}`,
    "Verdict: stale",
    `Stated: ${CLAIM_STATED}`,
    `Found: ${CLAIM_FOUND}`,
    `Corrected: ${CLAIM_CHANGE}`,
    "",
  ].join("\n");
}

function changedFeature(): string {
  return [`## Feature: ${PAGE1}`, "Outcome: changed", ""].join("\n");
}

function reportHead(): string {
  return ["# Upkeep pass", "", "## Verifier: cli", `Folder: ${VDIR}`, ""].join("\n");
}

/** A pass over the three local pages with one stale claim, corrected by no one. */
export const REPORT_CHANGED = [
  reportHead(),
  changedFeature().trimEnd(),
  "",
  staleClaim().trimEnd(),
  "",
  cleanFeature(PAGE2).trimEnd(),
  "",
  cleanFeature(PAGE3).trimEnd(),
  "",
].join("\n");

/** The same pass with the stale claim corrected and proved. */
export const REPORT_CORRECTED = [
  reportHead(),
  changedFeature().trimEnd(),
  "",
  correctedClaim().trimEnd(),
  "",
  cleanFeature(PAGE2).trimEnd(),
  "",
  cleanFeature(PAGE3).trimEnd(),
  "",
].join("\n");

/** A pass that never drove the third page. */
export const REPORT_UNDERRIVEN = [
  reportHead(),
  changedFeature().trimEnd(),
  "",
  staleClaim().trimEnd(),
  "",
  cleanFeature(PAGE2).trimEnd(),
  "",
].join("\n");

/** Write the pass's report into the dir and return its path. */
export function writeReport(dir: string, text: string): string {
  const path = join(dir, "UPKEEP.md");
  writeFileSync(path, text);
  return path;
}

/** A dir holding files the stub copies over the session worktree. */
export function writeOverlay(dir: string, files: Record<string, string>): string {
  const overlay = join(dir, "overlay");
  for (const [rel, text] of Object.entries(files)) writeRepoFile(overlay, rel, text);
  return overlay;
}

/** The overlay a correcting stub plays: the corrected page and the index at head. */
export function correctingOverlay(
  dir: string,
  repo: string,
  first: string,
  head: string,
  extra: Record<string, string> = {},
): string {
  const before = readFileSync(join(repo, PAGE1), "utf8");
  return writeOverlay(dir, {
    [PAGE1]: `${before}\nCorrected to what the app does.\n`,
    [`${LOCAL}/README.md`]: readFileSync(join(repo, LOCAL, "README.md"), "utf8").replace(
      first,
      head,
    ),
    ...extra,
  });
}

/** Run the upkeep pass the way the user starts it by hand. */
export function runUpkeep(
  repo: string,
  dispatch: string,
  env: Record<string, string | undefined>,
  extra: string[] = [],
): RunResult {
  return run(RUN, ["verifier", "upkeep", repo, "--run", dispatch, "--timeout", "120", ...extra], {
    env,
  });
}
