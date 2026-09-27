#!/usr/bin/env bash
# Cut a disposable reviewer scratch at a snapshot, with the installed dependency directories
# CLONED from a source worktree; tell a scratch from anything else; remove one. Nothing is ever
# installed into a scratch; a lane that opens on a broken scratch reports the breakage as a
# finding about the diff, or gives up on running the suite and reverts to reading.
#
#   cut-scratch.sh <repo> <source-worktree> <dest-path> <commit> [--clone <base>]
#   cut-scratch.sh --check <dest-path> <commit> [--clone <base>]
#   cut-scratch.sh --kind <dir>
#   cut-scratch.sh --remove <repo> <dest-path>
#   cut-scratch.sh --self-test
#
# A scratch is a detached worktree of <repo> at <commit>. With --clone it is a shared clone of
# <repo> instead (`git clone --shared`, which copies no objects), detached at <commit>: its
# origin is <repo>, so its `origin/HEAD` is the branch <repo> has checked out, which a review
# skill that diffs against `origin/HEAD` needs (harnesses.md, Own review skills). The clone is
# refused, and removed again, unless the merge base of its origin/HEAD and <commit> is <base>,
# so such a skill reviews exactly the change from <base> to <commit>. It borrows <repo>'s
# objects, and <commit> stays reachable there on the synthesis branch. A <dest-path> that
# already exists is refused and left alone.
#
# --check is the same test, made just before a lane is launched into a scratch: it is a scratch,
# its HEAD is <commit>, and with --clone it is a clone whose origin/HEAD leads back to <base>.
#
# --kind prints `worktree <repo>` for a detached worktree and `clone <repo>` for a shared clone,
# <repo> being the main checkout it was cut from, and exits 1 for anything else: a worktree on a
# branch is a lane's or the synthesis, never a scratch. --remove takes away a scratch of <repo>
# of either kind, a worktree through git and a clone with its directory, and refuses anything
# else, leaving it alone.
#
# Clones each directory named in DEPS_DIRS (default: node_modules) at the root AND under every
# workspace member (packages/*, apps/*): in a workspace each member carries its own link farm,
# and cloning only the root leaves a checkout that cannot resolve its own packages.
# cp -c is a filesystem clone where the filesystem supports it; the plain copy is the fallback.
#
#   exit 0  scratch created, the dependency clone reported per directory; a scratch checked; a
#           scratch's kind printed; or the scratch removed
#   exit 1  usage; a dest that exists; git could not create the scratch; a scratch not at
#           <commit>; a worktree where a clone is needed, or a clone whose origin/HEAD does not
#           lead back to <base>; not a scratch, or not one of <repo>
set -uo pipefail
DEPS=${DEPS_DIRS:-node_modules}
usage() {
  echo "usage: cut-scratch.sh <repo> <source-worktree> <dest-path> <commit> [--clone <base>] | --check <dest-path> <commit> [--clone <base>] | --kind <dir> | --remove <repo> <dest-path> | --self-test" >&2
  exit 1
}

phys() { (cd "$1" 2>/dev/null && pwd -P); }   # phys <dir>: its physical path, or nothing
common_of() {  # common_of <dir>: the physical path of its repository's common git directory
  local c; c=$(git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) && phys "$c"
}
main_of() { case $1 in */.git) dirname "$1" ;; *) printf '%s\n' "$1" ;; esac; }   # of a common dir

clone_dir() {  # $1 source dir, $2 destination dir
  [ -d "$1" ] || return 1
  mkdir -p "$(dirname "$2")"
  cp -Rc "$1" "$2" 2>/dev/null || cp -R "$1" "$2"
}

cut() {  # cut <repo> <source-worktree> <dest> <commit> [<base>]
  local repo=$1 src=$2 dest=$3 snap=$4 base=${5:-} want="" d member rel cloned=0
  [ -e "$dest" ] && { echo "cut-scratch: $dest already exists; a scratch is cut fresh" >&2; return 1; }
  if [ -z "$base" ]; then
    git -C "$repo" worktree add --detach "$dest" "$snap" >/dev/null 2>&1 \
      || { echo "cut-scratch: git could not create $dest at $snap" >&2; return 1; }
  else
    want=$(git -C "$repo" rev-parse --verify -q "$base^{commit}") \
      || { echo "cut-scratch: no such base in $repo: $base" >&2; return 1; }
    if ! { git clone -q --shared --no-checkout "$repo" "$dest" && git -C "$dest" checkout -q --detach "$snap"; } >/dev/null 2>&1; then
      echo "cut-scratch: git could not clone $repo to $dest at $snap" >&2
      [ -d "$dest" ] && rm -r -- "$dest"
      return 1
    fi
    verify "$dest" "$snap" "$want" || { rm -r -- "$dest"; echo "cut-scratch: removed $dest" >&2; return 1; }
  fi
  for d in $DEPS; do
    clone_dir "$src/$d" "$dest/$d" && { cloned=$((cloned + 1)); echo "cloned $d"; }
    for member in "$src"/packages/*/ "$src"/apps/*/; do
      [ -d "$member" ] || continue
      rel=${member#"$src"/}
      clone_dir "$member$d" "$dest/$rel$d" && { cloned=$((cloned + 1)); echo "cloned $rel$d"; }
    done
  done
  echo "scratch $dest at $(git -C "$dest" rev-parse --short HEAD)${want:+, a clone whose origin/HEAD leads back to $(git -C "$repo" rev-parse --short "$want")}, $cloned dependency dir(s) cloned"
  [ "$cloned" -eq 0 ] && echo "cut-scratch: no dependency directory found under $src; if the project has one, install it there first" >&2
  return 0
}

verify() {  # verify <dest> <commit> [<base>]
  local dest=$1 snap=$2 base=${3:-} k at want mb
  k=$(kind "$dest") || { echo "cut-scratch: $dest is no scratch" >&2; return 1; }
  at=$(git -C "$dest" rev-parse --verify -q "$snap^{commit}") && [ "$(git -C "$dest" rev-parse HEAD)" = "$at" ] \
    || { echo "cut-scratch: $dest is not at $snap" >&2; return 1; }
  [ -n "$base" ] || return 0
  [ "${k%% *}" = clone ] \
    || { echo "cut-scratch: $dest is a worktree, where a skill that diffs against origin/HEAD needs a clone" >&2; return 1; }
  want=$(git -C "$dest" rev-parse --verify -q "$base^{commit}")
  mb=$(git -C "$dest" merge-base origin/HEAD HEAD 2>/dev/null)
  [ -n "$want" ] && [ "$mb" = "$want" ] && return 0
  echo "cut-scratch: in $dest, origin/HEAD does not lead back to $base (merge base ${mb:-none}), so a skill that diffs against it would review the wrong change" >&2
  return 1
}

kind() {  # kind <dir>: `worktree <repo>` or `clone <repo>`, or exit 1
  local dir top gitdir common url ocommon alt
  dir=$(phys "$1") || return 1
  top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) && top=$(phys "$top") && [ "$top" = "$dir" ] || return 1
  gitdir=$(git -C "$dir" rev-parse --path-format=absolute --git-dir 2>/dev/null) && gitdir=$(phys "$gitdir") || return 1
  common=$(common_of "$dir") || return 1
  if [ "$gitdir" != "$common" ]; then   # a linked worktree
    git -C "$dir" symbolic-ref -q HEAD >/dev/null && return 1
    echo "worktree $(main_of "$common")"; return 0
  fi
  alt=$(head -n 1 "$common/objects/info/alternates" 2>/dev/null) && [ -n "$alt" ] || return 1
  url=$(git -C "$dir" config --get remote.origin.url) || return 1
  case $url in /*) ;; *) return 1 ;; esac
  ocommon=$(common_of "$url") && [ "$(phys "$alt")" = "$ocommon/objects" ] || return 1
  echo "clone $(main_of "$ocommon")"
}

remove() {  # remove <repo> <dest>
  local repo k
  repo=$(common_of "$1") && repo=$(main_of "$repo") || { echo "cut-scratch: not a repository: $1" >&2; return 1; }
  k=$(kind "$2") || { echo "cut-scratch: $2 is neither a detached worktree nor a shared clone, so no scratch; left alone" >&2; return 1; }
  [ "${k#* }" = "$repo" ] || { echo "cut-scratch: $2 is a scratch of ${k#* }, not of $repo; left alone" >&2; return 1; }
  case $k in
    worktree\ *) git -C "$repo" worktree remove --force "$2" ;;
    clone\ *) rm -r -- "$(phys "$2")" ;;
  esac
}

case ${1:-} in
  --check) if [ $# -eq 3 ]; then verify "$2" "$3"; exit $?
           elif [ $# -eq 5 ] && [ "$4" = --clone ] && [ -n "$5" ]; then verify "$2" "$3" "$5"; exit $?
           else usage; fi ;;
  --kind) [ $# -eq 2 ] || usage; kind "$2"; exit $? ;;
  --remove) [ $# -eq 3 ] || usage; remove "$2" "$3"; exit $? ;;
  --self-test) [ $# -eq 1 ] || usage ;;
  ""|-*) usage ;;
  *) if [ $# -eq 4 ]; then cut "$1" "$2" "$3" "$4"; exit $?
     elif [ $# -eq 6 ] && [ "$5" = --clone ] && [ -n "$6" ]; then cut "$1" "$2" "$3" "$4" "$6"; exit $?
     else usage; fi ;;
esac

# --- self-test ----------------------------------------------------------------------------
tmp=$(mktemp -d) && tmp=$(phys "$tmp") || exit 1
trap 'rm -r -- "$tmp" 2>/dev/null' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }
check() { if eval "$2"; then ok "$1"; else fail "$1" "${3:-}"; fi; }   # check <label> <test> [<detail>]
commit() { printf '%s\n' "$2" > "$repo/$1" && git -C "$repo" add "$1" && git -C "$repo" commit -qm "$2"; }
# A repository on main, with a run's synthesis branch one commit past the base in a worktree
# that has its dependencies installed.
repo=$tmp/repo
git init -q -b main "$repo" && commit a.txt base || exit 1
base=$(git -C "$repo" rev-parse HEAD)
git -C "$repo" worktree add -q -b synth "$tmp/synthesis" && printf 'change\n' > "$tmp/synthesis/b.txt" \
  && git -C "$tmp/synthesis" add b.txt && git -C "$tmp/synthesis" commit -qm change || exit 1
snap=$(git -C "$tmp/synthesis" rev-parse HEAD)
mkdir -p "$tmp/synthesis/node_modules/dep" && printf 'x\n' > "$tmp/synthesis/node_modules/dep/index.js"
out="" rc=0
try() { out=$("$0" "$@" 2>&1); rc=$?; }   # try <cut-scratch.sh arguments>

echo "positive controls"
try "$repo" "$tmp/synthesis" "$tmp/wt" "$snap"
check "a worktree scratch is cut at the snapshot, with its dependencies cloned" \
  '[ $rc -eq 0 ] && [ "$(git -C "$tmp/wt" rev-parse HEAD)" = "$snap" ] && [ -f "$tmp/wt/node_modules/dep/index.js" ]' "$out"
try "$repo" "$tmp/synthesis" "$tmp/clone" "$snap" --clone "$base"
check "a clone scratch is cut at the snapshot, with its dependencies cloned" \
  '[ $rc -eq 0 ] && [ "$(git -C "$tmp/clone" rev-parse HEAD)" = "$snap" ] && [ -f "$tmp/clone/node_modules/dep/index.js" ]' "$out"
check "in it, the diff against origin/HEAD is exactly the change from the base" \
  '[ "$(git -C "$tmp/clone" diff --name-only origin/HEAD...)" = b.txt ]'
check "and it copied no objects" \
  '[ -s "$tmp/clone/.git/objects/info/alternates" ] && [ -z "$(find "$tmp/clone/.git/objects" -type f -path "*/objects/??/*")" ]'
check "--kind names each scratch and the repository it was cut from" \
  '[ "$("$0" --kind "$tmp/wt")" = "worktree $repo" ] && [ "$("$0" --kind "$tmp/clone")" = "clone $repo" ]'
try --check "$tmp/clone" "$snap" --clone "$base"
check "--check passes a clone at the snapshot whose origin/HEAD leads back to the base" '[ $rc -eq 0 ]' "$out"
try --check "$tmp/wt" "$snap"
check "and a worktree at the snapshot" '[ $rc -eq 0 ]' "$out"
commit c.txt "another run merged"
try "$repo" "$tmp/synthesis" "$tmp/moved" "$snap" --clone "$base"
check "with main moved on by another run's merge, a clone still reviews from the base" \
  '[ $rc -eq 0 ] && [ "$(git -C "$tmp/moved" diff --name-only origin/HEAD...)" = b.txt ]' "$out"
try --remove "$repo" "$tmp/wt"
check "--remove takes a worktree scratch away through git" \
  '[ $rc -eq 0 ] && [ ! -e "$tmp/wt" ] && ! git -C "$repo" worktree list --porcelain | grep -qxF "worktree $tmp/wt"' "$out"
try --remove "$repo" "$tmp/clone"
check "--remove takes a clone scratch away" '[ $rc -eq 0 ] && [ ! -e "$tmp/clone" ]' "$out"

echo "negative controls"
try --check "$tmp/moved" "$base" --clone "$base"
check "--check refuses a scratch that is not at the snapshot" '[ $rc -eq 1 ] && printf "%s" "$out" | grep -q "is not at"' "$out"
try "$repo" "$tmp/synthesis" "$tmp/wt2" "$snap"
try --check "$tmp/wt2" "$snap" --clone "$base"
check "and a worktree where a clone is needed" '[ $rc -eq 1 ] && printf "%s" "$out" | grep -q "needs a clone"' "$out"
try --check "$tmp/moved" "$snap" --clone "$snap"
check "and a clone whose origin/HEAD does not lead back to the base" '[ $rc -eq 1 ] && printf "%s" "$out" | grep -q "does not lead back"' "$out"
try "$repo" "$tmp/synthesis" "$tmp/wrong" "$snap" --clone "$snap"
check "a clone whose origin/HEAD does not lead back to the base is refused, and removed" \
  '[ $rc -eq 1 ] && [ ! -e "$tmp/wrong" ] && printf "%s" "$out" | grep -q "does not lead back"' "$out"
git -C "$repo" switch -q --orphan elsewhere && commit d.txt unrelated
try "$repo" "$tmp/synthesis" "$tmp/unrelated" "$snap" --clone "$base"
check "so is one cut while the repository has an unrelated branch checked out" \
  '[ $rc -eq 1 ] && [ ! -e "$tmp/unrelated" ] && printf "%s" "$out" | grep -q "merge base none"' "$out"
git -C "$repo" switch -q main
try "$repo" "$tmp/synthesis" "$tmp/nobase" "$snap" --clone no-such-ref
check "a base the repository does not have is refused, and nothing is cut" '[ $rc -eq 1 ] && [ ! -e "$tmp/nobase" ]' "$out"
mkdir "$tmp/taken" && printf 'keep\n' > "$tmp/taken/mine.txt"
try "$repo" "$tmp/synthesis" "$tmp/taken" "$snap" --clone "$base"
check "a dest that already exists is refused, and left alone" '[ $rc -eq 1 ] && [ "$(ls "$tmp/taken")" = mine.txt ]' "$out"
try "$repo" "$tmp/synthesis" "$tmp/taken" "$snap"
check "for a worktree scratch too" '[ $rc -eq 1 ] && [ "$(ls "$tmp/taken")" = mine.txt ]' "$out"
git clone -q "$repo" "$tmp/plain" >/dev/null 2>&1
git init -q -b main "$tmp/repo2" && printf 'x\n' > "$tmp/repo2/x" && git -C "$tmp/repo2" add x && git -C "$tmp/repo2" commit -qm x
git clone -q --shared "$tmp/repo2" "$tmp/borrowed" && git -C "$tmp/borrowed" remote set-url origin "$repo"
try "$repo" "$tmp/synthesis" "$tmp/other" "$snap" --clone "$base"
for victim in "$tmp/taken" "$repo" "$tmp/synthesis" "$tmp/plain" "$tmp/borrowed" "$repo/nowhere"; do
  try --kind "$victim"
  check "--kind: $(basename "$victim") is no scratch" '[ $rc -eq 1 ] && [ -z "$out" ]' "$out"
  try --remove "$repo" "$victim"
  check "--remove refuses it, and leaves it" '[ $rc -eq 1 ] && { [ ! -e "$victim" ] || [ -n "$(ls -A "$victim")" ]; }' "$out"
done
check "the synthesis worktree is untouched" '[ -f "$tmp/synthesis/b.txt" ] && git -C "$repo" worktree list --porcelain | grep -qxF "worktree $tmp/synthesis"'
try --remove "$tmp/repo2" "$tmp/other"
check "--remove refuses a scratch of another repository" '[ $rc -eq 1 ] && [ -d "$tmp/other/.git" ] && printf "%s" "$out" | grep -q "not of"' "$out"
try "$repo" "$tmp/synthesis" "$tmp/x" "$snap" --clone
check "--clone with no base is a usage error" '[ $rc -eq 1 ] && [ ! -e "$tmp/x" ]' "$out"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
