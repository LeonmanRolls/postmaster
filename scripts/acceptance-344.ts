// Helpers for the #344 oracle: temp repos, a stub harness that plays a finished
// session, and a stub tmux that records the interactive open. The tests spawn git
// and scripts/run as subprocesses; nothing here imports the change. The stubs
// assume a repo whose slug is "app", so its verifier folder is verify-app.
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitAll, initRepo, RUN, writeRepoFile } from "./acceptance-323.ts";
import { run } from "./lib/proc.ts";

export { RUN };

export interface Sandbox {
  dir: string;
  repo: string;
  bin: string;
  dispatch: string;
}

const SESSION_WORK = [
  "mkdir -p verify-app/features",
  "printf '# v\\n' > verify-app/README.md",
  "printf '# f1\\n' > verify-app/features/f1.md",
  "printf '# f2\\n' > verify-app/features/f2.md",
  "printf '# f3\\n' > verify-app/features/f3.md",
  "printf '# handover\\nproved under a stub\\n' > HANDOVER.md",
  "git add -A",
  "git commit -qm stub",
].join("\n");

/** A temp repo named app with one commit, a bin dir, and a dispatch holding run.json. */
export function makeSandbox(): Sandbox {
  // Physical first: the launcher resolves its cwd before the harness starts,
  // and the tmp dir may itself be a symlink (macOS /var), so every sandbox
  // path is canonical and the stubs' guards compare like with like.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "acceptance-344-")));
  const repo = join(dir, "app");
  initRepo(repo);
  writeRepoFile(repo, "README.md", "# app\n");
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

/** Hermetic env for a make run: forced host, stub PATH first, temp state dirs. */
export function makeEnv(
  sandbox: Sandbox,
  extra: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    PATH: `${sandbox.bin}:${process.env.PATH ?? ""}`,
    POSTMASTER_HARNESS_DATA: join(sandbox.dir, "harness-data"),
    POSTMASTER_HOST_STATE: join(sandbox.dir, "host-state"),
    POSTMASTER_ATTEMPT_PHASE: join(sandbox.dir, "attempt.phase"),
    ORACLE_ROOT: sandbox.dir,
    ...extra,
  };
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

/**
 * A stub `muse` that only satisfies the harness lookup: behind the stub tmux
 * the interactive form is recorded, never run, so a real execution refuses.
 * CI carries no harness binaries, and `launch` checks the lookup up front.
 */
export function writeStubMuse(bin: string): void {
  const path = join(bin, "muse");
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      'echo "stub muse: the harness must not run behind the stub tmux" >&2',
      "exit 1",
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
}

/** A stub `claude` that plays a finished headless session in its cwd. */
export function writeStubSession(bin: string): void {
  const path = join(bin, "claude");
  writeFileSync(
    path,
    ["#!/bin/sh", "set -eu", ...rootGuard('"$PWD"'), SESSION_WORK, ""].join("\n"),
  );
  chmodSync(path, 0o755);
}

/**
 * A stub `tmux` that logs every call, records each spawned window's name in the
 * state file, and lists it back in whichever list-windows shape the caller
 * asked for, so send finds its window. has-session always misses, so every
 * spawn takes the new-session branch and answers @1. With ORACLE_SESSION_WORK=1
 * new-session also plays a finished session in the window's -c directory; with
 * ORACLE_TMUX_FAIL_NEW=1 the spawn fails before anything is recorded. Every
 * call appends one line to the log.
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
      ...SESSION_WORK.split("\n").map((line) => `        ${line}`),
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

export function promptOrThrow(repo: string, surface: string, args: string[] = []): string {
  const r = run(RUN, ["verifier", "prompt", repo, surface, ...args]);
  if (r.code !== 0) {
    throw new Error(`verifier prompt exited ${r.code}: ${r.err.trim() || r.out.trim()}`);
  }
  return r.out;
}

/** The value of a `key <value>` line in make's summary, or "" when absent. */
export function summaryLine(out: string, key: string): string {
  for (const line of out.split("\n")) {
    if (line.startsWith(`${key} `)) return line.slice(key.length + 1).trim();
  }
  return "";
}
