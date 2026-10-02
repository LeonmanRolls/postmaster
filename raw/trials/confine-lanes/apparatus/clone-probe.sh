#!/usr/bin/env bash
# clone-probe.sh <root> <level> [<bash>]: the same lane, cut as a shared clone of <root>/app
# (git clone --shared) rather than a worktree of it, beside another lane cut the same way that
# has committed. From a plain shell and no model, run by <bash> (a shell folder's bash to run it
# confined, or plain bash): can the lane commit, and can it reach the other lane's commit
# through git, by its branch or by its object id? The control is a commit the main repository
# holds, which a shared clone does reach by its id. Writes <root>/logs/clone-<level>.txt.
set -uo pipefail
root=$1 level=$2 shell=${3:-bash}
dir=$root/app/.worktrees
for l in a b; do
  git clone -q --shared "$root/app" "$dir/clone-$level-$l" && git -C "$dir/clone-$level-$l" checkout -q -b "wb/clone-$level-$l"
done
echo "the other lane's committed work" > "$dir/clone-$level-b/work.txt"
git -C "$dir/clone-$level-b" add work.txt
git -C "$dir/clone-$level-b" -c user.name=b -c user.email=b@example.invalid commit -q -m "work of clone-$level-b"
export OTHER_SHA=$(git -C "$dir/clone-$level-b" rev-parse HEAD) OTHER_BRANCH=wb/clone-$level-b OTHER_MSG="work of clone-$level-b" \
  MAIN_SHA=$(git -C "$root/app" rev-parse wb/1-other)
probe='
say() { printf "%-36s %s\n" "$1" "$2"; }
{ echo INSIDE > inside.txt && git add inside.txt && git -c user.name=t -c user.email=t@example.invalid commit -q -m "trial: inside"; } >/dev/null 2>&1 \
  && say "write and commit in own clone" worked || say "write and commit in own clone" failed
git log --all --oneline 2>/dev/null | grep -qF "$OTHER_MSG" && say "the other lane commit in git log --all" listed || say "the other lane commit in git log --all" absent
git fetch -q origin >/dev/null 2>&1; git rev-parse -q --verify "origin/$OTHER_BRANCH" >/dev/null && say "the other lane branch via origin" reached || say "the other lane branch via origin" absent
git cat-file -e "$OTHER_SHA" 2>/dev/null && say "the other lane commit by its id" reached || say "the other lane commit by its id" absent
git cat-file -e "$MAIN_SHA" 2>/dev/null && say "control: a main repository commit" reached || say "control: a main repository commit" absent
'
cd "$dir/clone-$level-a" || exit 1
{ "$shell" -c "$probe"; echo "exit $?"; } > "$root/logs/clone-$level.txt" 2>&1
cat "$root/logs/clone-$level.txt"
