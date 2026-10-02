#!/usr/bin/env bash
# claude-guard.sh <tool> <root>: the claude lane with Claude Code's own guards on, in bypass mode.
# The launch form scripts/launch.sh prints for t-claude, plus --settings: a deny rule for reading
# and editing the other lane's worktree, and permissions.blockReadsOutsideWorkingDirectories.
# Run directly rather than through launch.sh, which has no way to add --settings. Writes the same
# files as run-lane.sh, for lane claude at level own.
set -uo pipefail
tool=$1 root=$2
name=claude-own
wt=$root/app/.worktrees/1-$name
# Lanes start in parallel, and two `git worktree add` at once can collide on the repository's lock.
flock "$root/.worktree-lock" git -C "$root/app" worktree add -q "$wt" -b "wb/1-$name" main || exit 1
sed -e "s#@ROOT@#$root#g" -e "s#@LANE@#$name#g" "$(dirname "$0")/prompt.tmpl" > "$root/prompt-$name.txt"
printf '{"permissions": {"blockReadsOutsideWorkingDirectories": true, "deny": ["Read(/%s/app/.worktrees/other/**)", "Edit(/%s/app/.worktrees/other/**)"]}}\n' \
  "$root" "$root" > "$root/claude-own-settings.json"
model=$(POSTMASTER_CONFIG="$root/config.toml" "$tool/scripts/launch.sh" form t-claude | sed -n 's/.* --model \([^ ]*\) .*/\1/p' | head -1)
start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
( cd "$wt" && env -u CLAUDECODE -u CLAUDE_CODE_CHILD_SESSION -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_EXECPATH \
    -u CLAUDE_CODE_MESSAGING_SOCKET -u CLAUDE_CODE_MESSAGING_TOKEN -u CLAUDE_CODE_SESSION_ATTENDED \
    -u CLAUDE_CODE_SESSION_ID -u CLAUDE_PID -u HERDR_BIN_PATH -u HERDR_ENV -u HERDR_PANE_ID \
    -u HERDR_SOCKET_PATH -u HERDR_TAB_ID -u HERDR_WORKSPACE_ID \
    timeout 1200 claude -p "$(cat "$root/prompt-$name.txt")" --model "$model" --effort low \
      --output-format stream-json --verbose --dangerously-skip-permissions \
      --settings "$root/claude-own-settings.json" ) \
  > "$root/logs/$name-events.jsonl" 2> "$root/logs/$name.err" < /dev/null
rc=$?
printf 'lane=claude level=own exit=%s start=%s end=%s\n' "$rc" "$start" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > "$root/logs/$name.result"
cat "$root/logs/$name.result"
