#!/usr/bin/env bash
# Where a run's working copies live: outside the project folder, so a project tool that walks
# the whole folder never reads them. Why, and the gate failure that asked for it:
# wiki/concepts/working-copies-outside.md.
#
#   worktree-path.sh root <repo>
#   worktree-path.sh --self-test
#
# root prints the directory a run's worktrees are cut under, for <repo> or any directory inside
# it. By default it is <parent>/.postmaster-worktrees/<basename> of the repository's physical
# path: outside the project folder, beside it, named for the repo so two projects never share a
# root. POSTMASTER_WORKTREES, when set, is the parent of those per-repo roots instead, so the
# path is $POSTMASTER_WORKTREES/<basename>. No config key: the repository path is enough.
#
# Under that root the names stay what they were inside the project: <TICKET> for the synthesis
# worktree, <TICKET>-<lane> for a workhorse, <TICKET>-rev-<lens>-<lane> for a reviewer scratch.
# Nothing is cut under <repo>/.worktrees/; that name stays gitignored so a stray copy from an
# older layout is never committed.
#
#   exit 0  root: the path printed · --self-test: every control behaved
#   exit 1  usage, no such repository, or a control misbehaved
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
usage() { echo "usage: worktree-path.sh root <repo> | --self-test" >&2; exit 1; }

phys() { (cd "$1" 2>/dev/null && pwd -P); }   # phys <dir>: its physical path, or nothing

root_of() {  # root_of <repo>: where this repo's run worktrees live
  local repo top parent base
  repo=$(phys "${1:-}") || { echo "worktree-path: no such directory: ${1:-}" >&2; return 1; }
  top=$(git -C "$repo" rev-parse --show-toplevel 2>/dev/null) \
    || { echo "worktree-path: $repo is not in a git repository" >&2; return 1; }
  top=$(phys "$top") || return 1
  base=$(basename "$top")
  if [ -n "${POSTMASTER_WORKTREES:-}" ]; then
    parent=$POSTMASTER_WORKTREES
    if ! parent=$(phys "$parent"); then
      parent=$(phys "$(dirname "$parent")")/$(basename "$parent") \
        || { echo "worktree-path: POSTMASTER_WORKTREES is not under an existing directory: $POSTMASTER_WORKTREES" >&2; return 1; }
    fi
    printf '%s/%s\n' "$parent" "$base"
    return 0
  fi
  printf '%s/.postmaster-worktrees/%s\n' "$(dirname "$top")" "$base"
}

case ${1:-} in
  root)
    [ $# -eq 2 ] || usage
    root_of "$2"; exit $? ;;
  --self-test) [ $# -eq 1 ] || usage ;;
  *) usage ;;
esac

# --- self-test ----------------------------------------------------------------------------
# The control a folder-walking project check needs (design rule 5): one identical command that
# fails when a copy sits under <repo>/.worktrees/ and passes when the run's copies live only at
# the outside root. Positive control reads zero (check passes with the fix); the negative control
# reads non-zero (the same check fails when a copy is left where a folder-walking tool reads).
tmp=$(mktemp -d) && tmp=$(phys "$tmp") || exit 1
trap 'rm -r -- "$tmp" 2>/dev/null' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }
check() { if eval "$2"; then ok "$1"; else fail "$1" "${3:-}"; fi; }   # check <label> <test> [<detail>]

# A project whose check fails whenever a copy exists under .worktrees/: the AC3 control project.
repo=$tmp/project
git init -q -b main "$repo" && printf 'export const x = 1;\n' > "$repo/app.ts" \
  && git -C "$repo" add app.ts && git -C "$repo" commit -qm init || exit 1
cat > "$repo/check.sh" <<'EOF'
#!/usr/bin/env bash
# Fail when any copy exists under .worktrees/: a folder-walking gate would read it.
if [ -d .worktrees ] && [ -n "$(ls -A .worktrees 2>/dev/null)" ]; then
  echo "check: a copy exists under .worktrees/" >&2
  exit 1
fi
exit 0
EOF
chmod +x "$repo/check.sh"
printf '.worktrees/\n' >> "$repo/.git/info/exclude"

# The run's working copies, cut where worktree-path.sh says: outside the project folder.
root=$("$HERE/worktree-path.sh" root "$repo") || exit 1
ticket=T-1
mkdir -p "$root" \
  && git -C "$repo" worktree add -q -b "$ticket" "$root/$ticket" HEAD \
  && printf 'export const y = 2;\n' > "$root/$ticket/lane.ts" \
  && git -C "$root/$ticket" add lane.ts && git -C "$root/$ticket" commit -qm lane || exit 1

echo "positive controls"
check "root is outside the project folder" \
  '[[ "$root" != "$repo" && "$root" != "$repo"/* && "$root" == */.postmaster-worktrees/* ]]' "$root"
check "and named for the repository" '[ "$(basename "$root")" = "$(basename "$repo")" ]' "$root"
check "a worktree cut there is a linked worktree of the repo" \
  'grep -qxF "worktree $root/$ticket" <<<"$(git -C "$repo" worktree list --porcelain)"'
check "the project's own .worktrees/ holds no copy" '[ ! -e "$repo/.worktrees" ] || [ -z "$(ls -A "$repo/.worktrees")" ]'
rc=0; ( cd "$repo" && ./check.sh ) >/dev/null 2>&1 || rc=$?
check "the check that fails on a copy under .worktrees/ passes when copies live only outside (control reads zero)" '[ $rc -eq 0 ]'

echo "negative controls"
mkdir -p "$repo/.worktrees" && printf 'copy\n' > "$repo/.worktrees/stray.txt"
rc=0; ( cd "$repo" && ./check.sh ) >/dev/null 2>&1 || rc=$?
check "the same check fails when a copy is left under .worktrees/ where a folder-walking tool reads (control reads non-zero)" '[ $rc -ne 0 ]'
rm -- "$repo/.worktrees/stray.txt" && rmdir "$repo/.worktrees"
rc=0; ( cd "$repo" && ./check.sh ) >/dev/null 2>&1 || rc=$?
check "and passes again through the identical command once the copy is gone" '[ $rc -eq 0 ]'

alt=$tmp/elsewhere
mkdir -p "$alt"
export POSTMASTER_WORKTREES=$alt
root=$("$HERE/worktree-path.sh" root "$repo")
check "POSTMASTER_WORKTREES replaces the parent directory" \
  '[ "$root" = "$alt/$(basename "$repo")" ]' "$root"
unset POSTMASTER_WORKTREES
root=$("$HERE/worktree-path.sh" root "$repo")
check "and without it the root is beside the repository again" \
  '[ "$root" = "$(dirname "$repo")/.postmaster-worktrees/$(basename "$repo")" ]' "$root"

"$HERE/worktree-path.sh" root "$tmp" >/dev/null 2>&1
check "a directory outside any repository is refused" '[ $? -eq 1 ]'
"$HERE/worktree-path.sh" root "$tmp/no-such" >/dev/null 2>&1
check "and so is a directory that does not exist" '[ $? -eq 1 ]'
"$HERE/worktree-path.sh" >/dev/null 2>&1
check "no arguments is a usage error" '[ $? -eq 1 ]'

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
