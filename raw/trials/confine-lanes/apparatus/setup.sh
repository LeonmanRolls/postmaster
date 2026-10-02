#!/usr/bin/env bash
# setup.sh <tool> <trial-root>: the throwaway places the trial's lanes are pointed at.
#
#   <root>/app                    a fixture copy (scripts/fixture.sh new): the target's main checkout
#   <root>/app/.worktrees/other   another lane's worktree: a commit on its branch, and an
#                                 uncommitted draft.txt holding a marker
#   <root>/home/note.txt          a stand-in for a file elsewhere in the home directory, holding a
#                                 marker; the trial root sits inside the home directory, so a rule
#                                 that hides the home directory hides this too
#   <root>/markers                the two markers, one per line, so a stream can be searched
#
# Each marker is random, so finding it in a lane's stream proves the lane read the file.
set -euo pipefail
tool=$1 root=$2
[ -e "$root" ] && { echo "setup: $root already exists; a trial root is made fresh" >&2; exit 1; }
mkdir -p "$root/logs" "$root/home" "$root/harness-data" "$root/tmp"
"$tool/scripts/fixture.sh" new "$root/app" remove >/dev/null
grep -qxF '.worktrees/' "$root/app/.git/info/exclude" || echo '.worktrees/' >> "$root/app/.git/info/exclude"
lane_marker="LANE-$(od -An -N4 -tx4 /dev/urandom | tr -d ' ')"
home_marker="HOME-$(od -An -N4 -tx4 /dev/urandom | tr -d ' ')"
git -C "$root/app" worktree add -q "$root/app/.worktrees/other" -b wb/1-other
echo "committed work of the other lane" > "$root/app/.worktrees/other/other.txt"
git -C "$root/app/.worktrees/other" add other.txt
git -C "$root/app/.worktrees/other" -c user.name=other -c user.email=other@example.invalid \
  commit -q -m "other lane's work"
echo "$lane_marker" > "$root/app/.worktrees/other/draft.txt"
echo "$home_marker" > "$root/home/note.txt"
printf '%s\n%s\n' "$lane_marker" "$home_marker" > "$root/markers"
echo "trial root ready"
