// Oracle helpers for #328: the upkeep pass's corrections land on the user's word.
// A stub harness that plays a finished correcting pass, and the correcting
// instructions. The tests spawn git and scripts/run as subprocesses; nothing
// here imports the change. Sandboxes and the scratch app come from the oracles
// of #318, #325 and #344.
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RUN } from "./acceptance-323.ts";
import { run } from "./lib/proc.ts";

export { RUN };

// A stub works only inside its sandbox: a session stub that writes outside it
// once committed to the ticket branch instead, so the stub refuses.
function rootGuard(target: string): string[] {
  return [
    'if [ -z "${ORACLE_ROOT:-}" ]; then echo "stub refuses: ORACLE_ROOT is unset" >&2; exit 1; fi',
    `TARGET=${target}`,
    // Canonical before comparing: either side may arrive logical (the tmp dir
    // may be a symlink, as macOS /var is) while the other is physical.
    'TARGET=$(CDPATH= cd "$TARGET" && pwd -P) || { echo "stub refuses: cannot resolve $TARGET" >&2; exit 1; }',
    'ROOT=$(CDPATH= cd "${ORACLE_ROOT}" && pwd -P) || { echo "stub refuses: cannot resolve $ORACLE_ROOT" >&2; exit 1; }',
    'case "$TARGET" in',
    '  "$ROOT"/*) ;;',
    '  *) echo "stub refuses: $TARGET is outside $ORACLE_ROOT" >&2; exit 1 ;;',
    "esac",
  ];
}

/**
 * A stub `claude` that plays a finished correcting pass in its cwd: it lays
 * down the report ORACLE_REPORT names, overlays the corrections ORACLE_OVERLAY
 * names, and commits the verifiers' folders, leaving UPKEEP.md uncommitted the
 * way a correcting session does. ORACLE_ADD names extra pathspecs to stage, for
 * the pass that reaches past the folders. With no overlay nothing is committed,
 * for the pass that found nothing to correct.
 */
export function writeStubCorrectingSession(bin: string): void {
  const path = join(bin, "claude");
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      "set -eu",
      ...rootGuard('"$PWD"'),
      'if [ -z "${ORACLE_REPORT:-}" ]; then echo "stub refuses: ORACLE_REPORT is unset" >&2; exit 1; fi',
      'cp "$ORACLE_REPORT" ./UPKEEP.md',
      'if [ -n "${ORACLE_OVERLAY:-}" ]; then',
      '  cp -R "$ORACLE_OVERLAY/." .',
      "  for d in verify-app verifier; do",
      '    if [ -d "$d" ]; then git add -A "$d"; fi',
      "  done",
      // Intentionally unquoted: the test names extra pathspecs to stage.
      '  if [ -n "${ORACLE_ADD:-}" ]; then git add -A ${ORACLE_ADD}; fi',
      '  git commit -qm "upkeep corrections" || true',
      "fi",
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
}

/** The correcting pass instructions, or a throw quoting the failure. */
export function upkeepCorrectPromptOrThrow(repo: string, args: string[] = []): string {
  const r = run(RUN, ["verifier", "upkeep-prompt", repo, "--correct", ...args]);
  if (r.code !== 0) {
    throw new Error(`verifier upkeep-prompt exited ${r.code}: ${r.err.trim() || r.out.trim()}`);
  }
  return r.out;
}
