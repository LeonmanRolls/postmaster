#!/usr/bin/env bash
# run-lane.sh <tool> <root> <lane> <level> [VAR=value...]: one trial run of one lane.
#
# Cuts the lane a fresh worktree of <root>/app from main, renders the prompt for it, and launches
# it through the tool's own scripts/launch.sh with the trial's config (<root>/config.toml), as a
# run launches a lane. The caller's Claude Code and Herdr identity is stripped from the lane's
# environment (issue #102), so no lane reports into or messages the session that started it.
# VAR=value pairs are added to the lane's environment: PATH set that way puts a level's shims
# first, so launch.sh runs unchanged and its final exec reaches the confinement.
# Writes <root>/logs/<lane>-<level>-events.jsonl, .err, -last.md and .result.
set -uo pipefail
tool=$1 root=$2 lane=$3 level=$4; shift 4
name=$lane-$level
wt=$root/app/.worktrees/1-$name
# Lanes start in parallel, and two `git worktree add` at once can collide on the repository's lock.
flock "$root/.worktree-lock" git -C "$root/app" worktree add -q "$wt" -b "wb/1-$name" main || exit 1
sed -e "s#@ROOT@#$root#g" -e "s#@LANE@#$name#g" "$(dirname "$0")/prompt.tmpl" > "$root/prompt-$name.txt"
start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
env -u CLAUDECODE -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_EXECPATH \
    -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN -u CLAUDE_CODE_SESSION_ATTENDED \
    -u CLAUDE_CODE_SESSION_ID -u CLAUDE_PID -u HERDR_BIN_PATH -u HERDR_ENV -u HERDR_PANE_ID \
    -u HERDR_SOCKET_PATH -u HERDR_TAB_ID -u HERDR_WORKSPACE_ID \
    POSTMASTER_CONFIG="$root/config.toml" POSTMASTER_HARNESS_DATA="$root/harness-data" "$@" \
    timeout 1200 "$tool/scripts/launch.sh" launch "t-$lane" "$wt" "$root/prompt-$name.txt" \
      --last "$root/logs/$name-last.md" \
    > "$root/logs/$name-events.jsonl" 2> "$root/logs/$name.err" < /dev/null
rc=$?
printf 'lane=%s level=%s exit=%s start=%s end=%s\n' "$lane" "$level" "$rc" "$start" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$root/logs/$name.result"
cat "$root/logs/$name.result"
