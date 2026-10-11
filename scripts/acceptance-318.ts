// Helpers for the #318 oracle: temp repos that already hold verifiers, a stub
// harness that plays a finished upkeep pass, and a stub tmux that records the
// interactive open. The tests spawn git and scripts/run as subprocesses; nothing
// here imports the change. The stubs assume a repo whose slug is "app".
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Sandbox } from "./acceptance-344.ts";
import { commitAll, initRepo, RUN, writeRepoFile } from "./acceptance-323.ts";
import { run } from "./lib/proc.ts";

export { RUN };

const FRONT = "# app verifier\n\nDrives the app the way a user does.\n";
const PAGE = "# feature\n\nA recipe with stated results.\n";

/** The session's work for an upkeep stub: lay down the report the env names. */
const SESSION_UPKEEP = [
  'if [ -z "${ORACLE_REPORT:-}" ]; then echo "stub refuses: ORACLE_REPORT is unset" >&2; exit 1; fi',
  'cp "$ORACLE_REPORT" ./UPKEEP.md',
];

/**
 * A temp repo named app holding committed verifiers, a bin dir, and a dispatch
 * holding run.json. Single keeps #323's shape with five feature pages; multi
 * shares verifier/ with an index (#324).
 */
export function makeSandbox(layout: "single" | "multi" = "single"): Sandbox {
  // Physical first: the launcher resolves its cwd before the harness starts,
  // and the tmp dir may itself be a symlink (macOS /var), so every sandbox
  // path is canonical and the stubs' guards compare like with like.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "acceptance-318-")));
  const repo = join(dir, "app");
  initRepo(repo);
  writeRepoFile(repo, "README.md", "# app\n");
  if (layout === "single") {
    writeRepoFile(repo, "verify-app/README.md", FRONT);
    writeRepoFile(
      repo,
      "verify-app/features/README.md",
      "# map\n\nAn index of the features.\n\nFiles: README.md\n",
    );
    for (const page of ["add", "list", "done", "usage", "store"]) {
      writeRepoFile(repo, `verify-app/features/${page}.md`, PAGE);
    }
  } else {
    writeRepoFile(
      repo,
      "verifier/README.md",
      "- the command line (cli) verifier goes in verifier/cli/. Files: README.md\n",
    );
    writeRepoFile(repo, "verifier/cli/README.md", FRONT);
    writeRepoFile(repo, "verifier/cli/features/README.md", "# map\n");
    for (const page of ["add", "list"]) {
      writeRepoFile(repo, `verifier/cli/features/${page}.md`, PAGE);
    }
  }
  commitAll(repo, "first");
  const bin = join(dir, "bin");
  const dispatch = join(dir, "dispatch");
  mkdirSync(bin, { recursive: true });
  mkdirSync(dispatch, { recursive: true });
  writeFileSync(
    join(dispatch, "run.json"),
    JSON.stringify({
      config: { team: { coachman: { harness: "claude", model: "stub-model" } } },
    }),
  );
  // host run --under names its space from the brief's synthesis worktree, which
  // must exist; the headless fallback goes through host run, so the sandbox
  // carries a minimal brief pointing at its own repo.
  writeFileSync(
    join(dispatch, "brief.md"),
    [
      "# Waybill: oracle",
      "",
      "## Dispatch",
      "name: #0, oracle",
      `synthesis worktree: ${repo}`,
      "",
    ].join("\n"),
  );
  return { dir, repo, bin, dispatch };
}

// A stub works only inside its sandbox: a session stub that writes outside it
// once committed to the ticket branch instead, so both stubs refuse.
function rootGuard(target: string): string[] {
  return [
    'if [ -z "${ORACLE_ROOT:-}" ]; then echo "stub refuses: ORACLE_ROOT is unset" >&2; exit 1; fi',
    `TARGET=${target}`,
    // Canonical before comparing: the target may arrive logical (the tmp dir
    // may be a symlink) while ORACLE_ROOT is physical, or the reverse.
    'TARGET=$(CDPATH= cd "$TARGET" && pwd -P) || { echo "stub refuses: cannot resolve $TARGET" >&2; exit 1; }',
    'case "$TARGET" in',
    '  "${ORACLE_ROOT}"/*) ;;',
    '  *) echo "stub refuses: $TARGET is outside $ORACLE_ROOT" >&2; exit 1 ;;',
    "esac",
  ];
}

/** A stub `claude` that plays a finished upkeep pass in its cwd. */
export function writeStubSession(bin: string): void {
  const path = join(bin, "claude");
  writeFileSync(
    path,
    ["#!/bin/sh", "set -eu", ...rootGuard('"$PWD"'), ...SESSION_UPKEEP, ""].join("\n"),
  );
  chmodSync(path, 0o755);
}

/**
 * A stub `tmux` that logs every call, records each spawned window's name in the
 * state file, and lists it back in whichever list-windows shape the caller
 * asked for, so send finds its window. has-session always misses, so every
 * spawn takes the new-session branch and answers @1. With ORACLE_SESSION_WORK=1
 * new-session also plays a finished upkeep pass in the window's -c directory;
 * with ORACLE_TMUX_FAIL_NEW=1 the spawn fails before anything is recorded.
 * Every call appends one line to the log.
 */
export function writeStubTmux(bin: string, log: string, state: string): void {
  const path = join(bin, "tmux");
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      `LOG=${JSON.stringify(log)}`,
      `STATE=${JSON.stringify(state)}`,
      'echo "tmux $*" >> "$LOG"',
      "cmd=${1:-}",
      'case "$cmd" in',
      "  list-windows)",
      '    if [ -f "$STATE" ]; then',
      '      if printf "%s\\n" "$*" | grep -q "window_id"; then',
      '        while IFS= read -r h; do printf "@1\\t%s\\n" "$h"; done < "$STATE"',
      "      else",
      '        cat "$STATE"',
      "      fi",
      "    fi",
      "    exit 0 ;;",
      "  has-session) exit 1 ;;",
      "  new-session)",
      '    if [ "${ORACLE_TMUX_FAIL_NEW:-}" = "1" ]; then echo boom >&2; exit 1; fi',
      // Parse tmux's own leading options only: the window command may carry -c of its own.
      "    # tmux reads its own leading options; the window command follows them",
      "    shift",
      "    name=''",
      "    cwd=''",
      "    want=''",
      '    for a in "$@"; do',
      '      if [ -n "$want" ]; then',
      '        if [ "$want" = "-n" ]; then name=$a; fi',
      '        if [ "$want" = "-c" ]; then cwd=$a; fi',
      "        want=''",
      "        continue",
      "      fi",
      '      case "$a" in',
      "        -d|-P) ;;",
      "        -F|-s|-e|-n|-c|-t) want=$a ;;",
      "        *) break ;;",
      "      esac",
      "    done",
      '    printf "%s\\n" "$name" >> "$STATE"',
      '    if [ "${ORACLE_SESSION_WORK:-}" = "1" ]; then',
      ...rootGuard('"$cwd"').map((line) => `    ${line}`),
      '      ( cd "$cwd"',
      ...SESSION_UPKEEP.map((line) => `        ${line}`),
      "      )",
      "    fi",
      '    echo "@1"',
      "    exit 0",
      "    ;;",
      "  *) exit 0 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
}

/** The upkeep instructions, or a throw quoting the failure. */
export function upkeepPromptOrThrow(repo: string, args: string[] = []): string {
  const r = run(RUN, ["verifier", "upkeep-prompt", repo, ...args]);
  if (r.code !== 0) {
    throw new Error(`verifier upkeep-prompt exited ${r.code}: ${r.err.trim() || r.out.trim()}`);
  }
  return r.out;
}
