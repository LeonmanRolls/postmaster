#!/usr/bin/env bash
# Scan the merge a ship leg just made: its message and its resolution.
#
#   verify-merge.sh <repo> [<merge>]   scan merge (default HEAD) against its
#                                      first parent; run from anywhere
#   verify-merge.sh --self-test        controls, exit 0 when all pass
#   verify-merge.sh --help             usage, exit 0
#
# The branch gate scans the branch's range, but the stage-3 merge onto the
# default branch lands two things no branch range holds: the merge commit's
# own message, and its resolution of the two sides. After the merge the
# branch range is empty (head is the tip), so running the gate again passes
# over them trivially. This holds both to the same checks the gate ran: the
# scrub over <merge>^1 <merge>, and the tree check over the same range.
# Like the gate it pops a test hook from its environment, and like the gate
# it leaves the detections log to its caller: findings are logged there when
# the caller sets it. It prints no values: both checks report value-free,
# and its own diagnostics name paths and commits only. The scan is read-only;
# it never amends or resets the merge.
#
#   exit 0  the merge is clean
#   exit 1  findings, one per line on stdout from the failing check
#   exit 2  usage, not a repository, an unresolvable merge, a merge that is
#           not a merge commit, or a scan that could not finish
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
USAGE="usage: verify-merge.sh <repo> [<merge>] | --self-test | --help"

if [ "${1:-}" = "--help" ]; then echo "$USAGE" >&2; exit 0; fi

if [ "${1:-}" = "--self-test" ]; then
  tmp=$(mktemp -d) || exit 2
  # shellcheck disable=SC2064
  trap "rm -r -- \"$tmp\" </dev/null 2>/dev/null" EXIT
  fails=0
  # Hermetic controls: the gate runs self-tests with GIT_DIR set and a
  # detections log set, and fixture findings must never land in it.
  unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_NAMESPACE
  export POSTMASTER_DETECTIONS_LOG=
  unset SCRUB_CHECK_DISABLE
  E_LOCAL='relay-413'; E_HOST='quiet-relay-413'; E_TLD='net'
  SUSPECT="contact-${E_LOCAL}@${E_HOST}.${E_TLD}"
  export GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL
  GIT_AUTHOR_NAME=verify-merge; GIT_AUTHOR_EMAIL="verify-merge@users.noreply.github.com"
  GIT_COMMITTER_NAME=verify-merge; GIT_COMMITTER_EMAIL="verify-merge@users.noreply.github.com"

  repo() {  # a scratch repo on main with one clean commit, printed
    local d
    d=$(mktemp -d -p "$tmp") || return 1
    ( cd "$d" && git init -q -b main . && printf 'base\n' > base.txt \
      && git add base.txt && git commit -qm base ) || return 1
    printf '%s' "$d"
  }
  branch() {  # branch <repo> <name> <line>: a side branch editing base.txt's line
    ( cd "$1" && git checkout -qb "$2" && printf '%s\n' "$3" > base.txt \
      && git commit -qam "$2 side" >/dev/null && git checkout -q main )
  }

  echo "positive controls: a dirty merge fails, named"
  r=$(repo) && branch "$r" side "side line" && { cd "$r" || exit 2
    printf 'main line\n' > main.txt && git add main.txt && git commit -qm "main side" >/dev/null
    git merge -q --no-ff -m "Merge branch 'side'" side >/dev/null
    out=$(bash "$HERE/verify-merge.sh" "$r" 2>"$tmp/err"); code=$?
    { [ "$code" -eq 0 ] && [ -z "$out" ]; } \
      && printf '  ok   a clean merge passes, silent\n' \
      || { printf '  FAIL a clean merge passes, silent: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && branch "$r" side "side line" && { cd "$r" || exit 2
    printf 'main line\n' > base.txt && git commit -qam "main side" >/dev/null
    git merge -q --no-ff side >/dev/null 2>&1 || true
    printf 'resolved by the relay at %s\n' "$SUSPECT" > base.txt
    git add base.txt && git commit -qm "Merge branch 'side'" >/dev/null
    out=$(bash "$HERE/verify-merge.sh" "$r" 2>"$tmp/err"); code=$?
    { [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF 'base.txt:1: email'; } \
      && printf '  ok   a suspect in the resolution fails, named\n' \
      || { printf '  FAIL a suspect in the resolution fails, named: exit %s\n' "$code"; fails=$((fails+1)); }
    if printf '%s' "$out" | grep -qF -- "$SUSPECT" || grep -qF -- "$SUSPECT" "$tmp/err"; then
      printf '  FAIL a resolution fault prints no value\n'; fails=$((fails+1))
    else printf '  ok   a resolution fault prints no value\n'; fi
  }
  r=$(repo) && branch "$r" side "side line" && { cd "$r" || exit 2
    printf 'main line\n' > main.txt && git add main.txt && git commit -qm "main side" >/dev/null
    git merge -q --no-ff -m "$(printf "Merge branch 'side'\n\nReached at %s" "$SUSPECT")" side >/dev/null
    out=$(bash "$HERE/verify-merge.sh" "$r" 2>"$tmp/err"); code=$?
    { [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF '(message):3: email'; } \
      && printf '  ok   a suspect in the merge message fails, named\n' \
      || { printf '  FAIL a suspect in the merge message fails, named: exit %s\n' "$code"; fails=$((fails+1)); }
    if printf '%s' "$out" | grep -qF -- "$SUSPECT" || grep -qF -- "$SUSPECT" "$tmp/err"; then
      printf '  FAIL a message fault prints no value\n'; fails=$((fails+1))
    else printf '  ok   a message fault prints no value\n'; fi
  }
  r=$(repo) && branch "$r" side "side line" && { cd "$r" || exit 2
    printf 'main line\n' > base.txt && git commit -qam "main side" >/dev/null
    git merge -q --no-ff side >/dev/null 2>&1 || true
    mkdir -p .postmaster/verify && printf 'run record\n' > .postmaster/verify/checks.json
    printf 'resolved\n' > base.txt
    git add base.txt .postmaster/verify/checks.json
    git commit -qm "Merge branch 'side'" >/dev/null
    out=$(bash "$HERE/verify-merge.sh" "$r" 2>/dev/null); code=$?
    { [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF '.postmaster/verify/checks.json'; } \
      && printf '  ok   a run record added in the resolution fails, named\n' \
      || { printf '  FAIL a run record added in the resolution fails, named: exit %s\n' "$code"; fails=$((fails+1)); }
  }

  echo "negative controls: the empty range passes, the refusals refuse"
  r=$(repo) && branch "$r" side "side line" && { cd "$r" || exit 2
    printf 'main line\n' > base.txt && git commit -qam "main side" >/dev/null
    git merge -q --no-ff side >/dev/null 2>&1 || true
    printf 'resolved by the relay at %s\n' "$SUSPECT" > base.txt
    git add base.txt && git commit -qm "Merge branch 'side'" >/dev/null
    bash "$HERE/scrub-check.sh" main HEAD >/dev/null 2>&1; naive=$?
    out=$(bash "$HERE/verify-merge.sh" "$r" 2>/dev/null); code=$?
    { [ "$naive" -eq 0 ] && [ "$code" -eq 1 ]; } \
      && printf '  ok   the branch range passes over a dirty merge, the merge scan fails\n' \
      || { printf '  FAIL the branch range passes over a dirty merge, the merge scan fails: %s %s\n' "$naive" "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    out=$(bash "$HERE/verify-merge.sh" "$r" 2>&1); code=$?
    [ "$code" -eq 2 ] \
      && printf '  ok   a head that is not a merge is refused\n' \
      || { printf '  FAIL a head that is not a merge is refused: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    out=$(bash "$HERE/verify-merge.sh" "$r" "no-such-commit" 2>&1); code=$?
    [ "$code" -eq 2 ] \
      && printf '  ok   an unresolvable merge is refused\n' \
      || { printf '  FAIL an unresolvable merge is refused: exit %s\n' "$code"; fails=$((fails+1)); }
    out=$(bash "$HERE/verify-merge.sh" "$tmp" 2>&1); code=$?
    [ "$code" -eq 2 ] \
      && printf '  ok   a path that is not a repository is refused\n' \
      || { printf '  FAIL a path that is not a repository is refused: exit %s\n' "$code"; fails=$((fails+1)); }
  }

  if [ "$fails" -eq 0 ]; then echo "verify-merge --self-test: all controls behaved"; exit 0; fi
  echo "self-test: $fails control(s) misbehaved"; exit 1
fi

fail() { echo "verify-merge: $1" >&2; exit 2; }
[ $# -ge 1 ] && [ $# -le 2 ] || { echo "$USAGE" >&2; exit 2; }
REPO=$1; MERGE=${2:-HEAD}
git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || fail "not a repository: $REPO"
MERGE_SHA=$(git -C "$REPO" rev-parse --verify --quiet "$MERGE^{commit}" 2>/dev/null) \
  || fail "not a commit: $MERGE"
PARENTS=$(git -C "$REPO" rev-list --parents -n 1 "$MERGE_SHA" 2>/dev/null) \
  || fail "the merge could not be read: $MERGE"
[ "$(printf '%s' "$PARENTS" | wc -w)" -eq 3 ] || fail "not a merge commit: $MERGE"
BASE=$(git -C "$REPO" rev-parse --verify --quiet "$MERGE_SHA^1" 2>/dev/null) \
  || fail "the merge has no first parent: $MERGE"

# A test hook must not green this scan: it stands where the gate stood.
unset SCRUB_CHECK_DISABLE
cd "$REPO" || fail "the repository could not be entered: $REPO"
code=0
bash "$HERE/scrub-check.sh" "$BASE" "$MERGE_SHA" || scrub_code=$?; scrub_code=${scrub_code:-0}
bash "$HERE/tree-check.sh" "$BASE" "$MERGE_SHA" || tree_code=$?; tree_code=${tree_code:-0}
if [ "$scrub_code" -eq 2 ] || [ "$tree_code" -eq 2 ]; then
  echo "verify-merge: a scan that could not finish fails the merge" >&2; exit 2
fi
[ "$scrub_code" -eq 1 ] && code=1
[ "$tree_code" -eq 1 ] && code=1
exit "$code"
