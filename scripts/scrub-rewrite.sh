#!/usr/bin/env bash
# Rewrite a branch's unpushed commits without their private-data findings.
#
#   scrub-rewrite.sh [<base> [<head>]]   the range; base defaults to main,
#                                     head to HEAD; run on the branch itself
#   scrub-rewrite.sh --self-test        controls, exit 0 when all pass
#   scrub-rewrite.sh --help             usage, exit 0
#
# When a finding sits only in an earlier commit, already gone from the final
# tree, the gate still fails on it: history publishes too. This script
# rewrites the range without it, before the branch is pushed. A leaked line
# is deleted from the commit that added it; a marker fault is cut from its
# line, deleting the line when nothing but the marker is left; an
# authorship trailer is cut from its message. A commit whose every change
# the surgery removes is dropped from the replay. Anything needing
# judgement is refused with the commit named: a finding in a merge (redo
# the merge by hand), a message finding that is not a trailer (reword it
# by hand), a marker in a file that is not UTF-8.
#
# A pushed branch is never rewritten: any commit of the range reachable
# from any remote-tracking branch refuses the rewrite. The worktree must
# hold no uncommitted change to a tracked file, and the range must hold no
# intentional empty commit, which the rewrite would otherwise drop
# silently. A replay that conflicts is aborted, and the branch is left
# exactly as it was. Afterwards the script checks that the rewrite left
# the final tree unchanged and that the range scans clean, restoring the
# branch when either fails, so a finding that still stands at the tip, or
# a surgery the replay could not carry, ends with the branch untouched and
# the coachman fixing by hand.
#
# What was removed prints on stdout, one value-free line per finding as
# <old-commit>:<path>:<line>: <kind> removed, naming the rewritten
# commits, which the reflog still holds. Human notices go to stderr.
#
#   exit 0  rewritten, the tree unchanged and the range clean
#   exit 1  never: findings are removed, not reported
#   exit 2  usage, not a repository, an unresolvable base or head, a pushed
#           branch, a dirty tree, a finding needing hands, a conflicted
#           replay, or a rewrite that changed the tree or stayed dirty
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
ROOT=$(CDPATH= cd -P -- "$HERE/.." && pwd -P)
SCRUB=$ROOT/scripts/scrub-check.sh
USAGE="usage: scrub-rewrite.sh [<base> [<head>]] | --self-test | --help"

case ${1:-} in
  --help) echo "$USAGE" >&2; exit 0 ;;
esac

fail() { echo "scrub-rewrite: $1" >&2; exit "${2:-2}"; }

if [ "${1:-}" = "--self-test" ]; then
  tmp=$(mktemp -d) || exit 2
  # shellcheck disable=SC2064
  trap "rm -r -- \"$tmp\" </dev/null 2>/dev/null" EXIT
  fails=0
  # Hermetic logging: the gate runs self-tests with a detections log set,
  # and fixture findings must never land in it.
  export POSTMASTER_DETECTIONS_LOG=
  E_LOCAL='relay-413'; E_HOST='quiet-relay-413'; E_TLD='net'
  SUSPECT="contact-${E_LOCAL}@${E_HOST}.${E_TLD}"
  C_A='Co-Au'; C_B='thored-'; C_C='By: Imaginary Aide'
  TRAILER="$C_A$C_B$C_C"
  ALLOW_P='private-data:allo'
  REWRITE=$HERE/scrub-rewrite.sh

  repo() {  # a scratch repo on main with user config, printed
    local d
    d=$(mktemp -d -p "$tmp") || return 1
    ( cd "$d" && git init -q -b main . && git config user.name Fixture \
      && git config user.email "fixture@example.invalid" \
      && printf 'base\n' > base.txt && git add base.txt && git commit -qm base ) || return 1
    printf '%s' "$d"
  }
  commit_file() {  # commit_file <repo> <path> <content> [message]
    ( cd "$1" && mkdir -p "$(dirname "$2")" && printf '%s\n' "$3" > "$2" \
      && git add "$2" && git commit -qm "${4:-add $2}" >/dev/null && git rev-parse HEAD )
  }
  tree_of() { git -C "$1" rev-parse "${2:-HEAD}^{tree}"; }
  leak_free() {  # leak_free <out> <err>: neither names the value
    ! printf '%s' "$1" | grep -qF -- "$SUSPECT" && ! grep -qF -- "$SUSPECT" "$2"
  }

  echo "rewrite controls: history without the finding, tree unchanged"
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    leak=$(commit_file "$r" notes/contact.txt "contact: $SUSPECT")
    ( cd "$r" && git rm -q notes/contact.txt && git commit -qm "drop the note" >/dev/null )
    tip=$(git rev-parse HEAD); saved=$(tree_of "$r")
    out=$(bash "$REWRITE" "$base" HEAD 2>"$tmp/err"); code=$?
    [ "$code" -eq 0 ] \
      && printf '  ok   a historical finding is rewritten\n' \
      || { printf '  FAIL a historical finding is rewritten: exit %s\n%s\n' "$code" "$(cat "$tmp/err")"; fails=$((fails+1)); }
    [ "$(tree_of "$r")" = "$saved" ] \
      && printf '  ok   the final tree is unchanged\n' \
      || { printf '  FAIL the final tree is unchanged\n'; fails=$((fails+1)); }
    if printf '%s' "$out" | grep -qF "$leak:notes/contact.txt:1: email removed"; then
      printf '  ok   the removal names its commit, file, line and rule\n'
    else printf '  FAIL the removal names its commit, file, line and rule\n%s\n' "$out"; fails=$((fails+1)); fi
    leak_free "$out" "$tmp/err" \
      && printf '  ok   a rewrite prints no value\n' \
      || { printf '  FAIL a rewrite prints no value\n'; fails=$((fails+1)); }
    rescan=$(POSTMASTER_DETECTIONS_LOG= bash "$HERE/scrub-check.sh" "$base" HEAD 2>/dev/null); rcode=$?
    { [ "$rcode" -eq 0 ] && [ -z "$rescan" ]; } \
      && printf '  ok   the rewritten range scans clean\n' \
      || { printf '  FAIL the rewritten range scans clean: exit %s\n' "$rcode"; fails=$((fails+1)); }
    ! git rev-list "$base"..HEAD | grep -q "$leak" \
      && printf '  ok   the emptied commit is dropped\n' \
      || { printf '  FAIL the emptied commit is dropped\n'; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" notes/contact.txt "contact: $SUSPECT" >/dev/null
    ( cd "$r" && git rm -q notes/contact.txt && git commit -qm "drop the note" >/dev/null )
    out=$(bash "$REWRITE" "$base" HEAD 2>"$tmp/err"); code=$?
    { [ "$code" -eq 0 ] && [ -z "$(git rev-list "$base"..HEAD)" ]; } \
      && printf '  ok   a branch left with nothing rewrites to its base\n' \
      || { printf '  FAIL a branch left with nothing rewrites to its base: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" notes/contact.txt "contact: $SUSPECT" >/dev/null
    tip=$(git rev-parse HEAD); saved=$(tree_of "$r")
    out=$(bash "$REWRITE" "$base" HEAD 2>"$tmp/err"); code=$?
    { [ "$code" -eq 2 ] && [ "$(git rev-parse HEAD)" = "$tip" ] \
      && [ "$(tree_of "$r")" = "$saved" ]; } \
      && printf '  ok   a finding at the tip refuses with the branch untouched\n' \
      || { printf '  FAIL a finding at the tip refuses with the branch untouched: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    printf 'line1\ncontact: %s\nline3\n' "$SUSPECT" > f.txt
    ( cd "$r" && git add f.txt && git commit -qm c1 >/dev/null )
    printf 'line1\nedited\nline3\n' > f.txt
    ( cd "$r" && git add f.txt && git commit -qm c2 >/dev/null )
    tip=$(git rev-parse HEAD)
    out=$(bash "$REWRITE" "$base" HEAD 2>"$tmp/err"); code=$?
    { [ "$code" -eq 2 ] && [ "$(git rev-parse HEAD)" = "$tip" ] \
      && [ ! -d "$r/.git/rebase-merge" ] && [ ! -d "$r/.git/rebase-apply" ]; } \
      && printf '  ok   a conflicted replay aborts with the branch untouched\n' \
      || { printf '  FAIL a conflicted replay aborts with the branch untouched: exit %s\n' "$code"; fails=$((fails+1)); }
    leak_free "$out" "$tmp/err" \
      && printf '  ok   a conflict report prints no value\n' \
      || { printf '  FAIL a conflict report prints no value\n'; fails=$((fails+1)); }
  }

  echo "history-shape controls: merges survive, empties and pushes refuse"
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    leak=$(commit_file "$r" notes/contact.txt "contact: $SUSPECT")
    ( cd "$r" && git rm -q notes/contact.txt && git commit -qm "drop the note" >/dev/null )
    ( cd "$r" && git checkout -qb side >/dev/null && printf 'side\n' > side.txt \
      && git add side.txt && git commit -qm side >/dev/null && git checkout -q main \
      && printf 'main\n' > main.txt && git add main.txt && git commit -qm mainwork >/dev/null \
      && git merge -q --no-ff -m "merge the side" side )
    saved=$(tree_of "$r")
    out=$(bash "$REWRITE" "$base" HEAD 2>"$tmp/err"); code=$?
    [ "$code" -eq 0 ] \
      && printf '  ok   a branch with a clean merge rewrites\n' \
      || { printf '  FAIL a branch with a clean merge rewrites: exit %s\n%s\n' "$code" "$(cat "$tmp/err")"; fails=$((fails+1)); }
    [ "$(git rev-list --parents -n 1 HEAD | wc -w)" -eq 3 ] \
      && printf '  ok   the merge keeps both parents\n' \
      || { printf '  FAIL the merge keeps both parents\n'; fails=$((fails+1)); }
    [ "$(tree_of "$r")" = "$saved" ] \
      && printf '  ok   the merged tree is unchanged\n' \
      || { printf '  FAIL the merged tree is unchanged\n'; fails=$((fails+1)); }
    rescan=$(POSTMASTER_DETECTIONS_LOG= bash "$HERE/scrub-check.sh" "$base" HEAD 2>/dev/null); rcode=$?
    { [ "$rcode" -eq 0 ] && [ -z "$rescan" ]; } \
      && printf '  ok   the merged range scans clean\n' \
      || { printf '  FAIL the merged range scans clean: exit %s\n' "$rcode"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    ( cd "$r" && git checkout -qb side >/dev/null \
      && printf 'contact: %s\n' "$SUSPECT" > merge.txt && git add merge.txt \
      && git commit -qm side >/dev/null && git checkout -q main \
      && printf 'main\n' > merge.txt && git add merge.txt \
      && git commit -qm mainwork >/dev/null; git merge -q --no-commit side >/dev/null 2>&1; \
      printf 'contact: %s\n' "$SUSPECT" > merge.txt && git add merge.txt \
      && git commit -qm "merge the side" >/dev/null )
    tip=$(git rev-parse HEAD)
    out=$(bash "$REWRITE" "$base" HEAD 2>"$tmp/err"); code=$?
    { [ "$code" -eq 2 ] && [ "$(git rev-parse HEAD)" = "$tip" ]; } \
      && printf '  ok   a merge carrying a finding refuses with the branch untouched\n' \
      || { printf '  FAIL a merge carrying a finding refuses with the branch untouched: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" notes/contact.txt "contact: $SUSPECT" >/dev/null
    ( cd "$r" && git rm -q notes/contact.txt && git commit -qm "drop the note" >/dev/null )
    ( cd "$r" && git commit -q --allow-empty -m marker >/dev/null )
    tip=$(git rev-parse HEAD)
    out=$(bash "$REWRITE" "$base" HEAD 2>"$tmp/err"); code=$?
    { [ "$code" -eq 2 ] && [ "$(git rev-parse HEAD)" = "$tip" ]; } \
      && printf '  ok   an intentional empty commit refuses with the branch untouched\n' \
      || { printf '  FAIL an intentional empty commit refuses with the branch untouched: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" notes/contact.txt "contact: $SUSPECT" >/dev/null
    tip=$(git rev-parse HEAD)
    git init -q --bare "$tmp/remote.git"
    ( cd "$r" && git remote add origin "$tmp/remote.git" && git push -q origin HEAD 2>/dev/null )
    out=$(bash "$REWRITE" "$base" HEAD 2>"$tmp/err"); code=$?
    { [ "$code" -eq 2 ] && [ "$(git rev-parse HEAD)" = "$tip" ]; } \
      && printf '  ok   a pushed branch refuses with the branch untouched\n' \
      || { printf '  FAIL a pushed branch refuses with the branch untouched: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" notes/old.txt 'Later clean notes.' >/dev/null
    pushed=$(git rev-parse HEAD)
    git init -q --bare "$tmp/remote2.git"
    ( cd "$r" && git remote add origin "$tmp/remote2.git" && git push -q origin HEAD 2>/dev/null )
    commit_file "$r" notes/contact.txt "contact: $SUSPECT" >/dev/null
    ( cd "$r" && git rm -q notes/contact.txt && git commit -qm "drop the note" >/dev/null )
    saved=$(tree_of "$r")
    out=$(bash "$REWRITE" "$pushed" HEAD 2>"$tmp/err"); code=$?
    { [ "$code" -eq 0 ] && [ "$(tree_of "$r")" = "$saved" ]; } \
      && printf '  ok   an unpushed range rewrites on a pushed branch\n' \
      || { printf '  FAIL an unpushed range rewrites on a pushed branch: exit %s\n%s\n' "$code" "$(cat "$tmp/err")"; fails=$((fails+1)); }
  }

  echo "message and marker controls: trailers strip, prose refuses"
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    ( cd "$r" && printf 'ordinary\n' > notes.txt && git add notes.txt \
      && git commit -qm "add the notes" -m "$TRAILER" >/dev/null )
    commit_file "$r" later.txt 'Later clean notes.' >/dev/null
    saved=$(tree_of "$r")
    out=$(bash "$REWRITE" "$base" HEAD 2>"$tmp/err"); code=$?
    [ "$code" -eq 0 ] \
      && printf '  ok   a trailer in an earlier message is stripped\n' \
      || { printf '  FAIL a trailer in an earlier message is stripped: exit %s\n%s\n' "$code" "$(cat "$tmp/err")"; fails=$((fails+1)); }
    [ "$(tree_of "$r")" = "$saved" ] \
      && printf '  ok   stripping a message leaves the tree alone\n' \
      || { printf '  FAIL stripping a message leaves the tree alone\n'; fails=$((fails+1)); }
    rescan=$(POSTMASTER_DETECTIONS_LOG= bash "$HERE/scrub-check.sh" "$base" HEAD 2>/dev/null); rcode=$?
    { [ "$rcode" -eq 0 ] && [ -z "$rescan" ]; } \
      && printf '  ok   the stripped range scans clean\n' \
      || { printf '  FAIL the stripped range scans clean: exit %s\n' "$rcode"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    ( cd "$r" && printf 'ordinary\n' > notes.txt && git add notes.txt \
      && git commit -qm "add the notes" -m "$TRAILER" >/dev/null )
    tip=$(git rev-parse HEAD); saved=$(tree_of "$r")
    out=$(bash "$REWRITE" "$base" HEAD 2>"$tmp/err"); code=$?
    { [ "$code" -eq 0 ] && [ "$(tree_of "$r")" = "$saved" ]; } \
      && printf '  ok   a trailer strips wherever it sits\n' \
      || { printf '  FAIL a trailer strips wherever it sits: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    ( cd "$r" && printf 'ordinary\n' > notes.txt && git add notes.txt \
      && git commit -qm "$TRAILER" >/dev/null )
    tip=$(git rev-parse HEAD)
    out=$(bash "$REWRITE" "$base" HEAD 2>"$tmp/err"); code=$?
    { [ "$code" -eq 2 ] && [ "$(git rev-parse HEAD)" = "$tip" ]; } \
      && printf '  ok   a message left empty refuses with the branch untouched\n' \
      || { printf '  FAIL a message left empty refuses with the branch untouched: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    ( cd "$r" && printf 'ordinary\n' > notes.txt && git add notes.txt \
      && git commit -qm "note" -m "write to $SUSPECT" >/dev/null )
    tip=$(git rev-parse HEAD)
    out=$(bash "$REWRITE" "$base" HEAD 2>"$tmp/err"); code=$?
    { [ "$code" -eq 2 ] && [ "$(git rev-parse HEAD)" = "$tip" ]; } \
      && printf '  ok   a message finding that is not a trailer refuses\n' \
      || { printf '  FAIL a message finding that is not a trailer refuses: exit %s\n' "$code"; fails=$((fails+1)); }
    leak_free "$out" "$tmp/err" \
      && printf '  ok   a message refusal prints no value\n' \
      || { printf '  FAIL a message refusal prints no value\n'; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" marked.txt "${ALLOW_P}w email -- nothing to suppress" >/dev/null
    ( cd "$r" && git rm -q marked.txt && git commit -qm "drop the note" >/dev/null )
    saved=$(tree_of "$r")
    out=$(bash "$REWRITE" "$base" HEAD 2>"$tmp/err"); code=$?
    [ "$code" -eq 0 ] \
      && printf '  ok   a marker on its own line is cut with its line\n' \
      || { printf '  FAIL a marker on its own line is cut with its line: exit %s\n%s\n' "$code" "$(cat "$tmp/err")"; fails=$((fails+1)); }
    [ "$(tree_of "$r")" = "$saved" ] \
      && printf '  ok   cutting a marker leaves the tree alone\n' \
      || { printf '  FAIL cutting a marker leaves the tree alone\n'; fails=$((fails+1)); }
    if printf '%s' "$out" | grep -q ': marker removed'; then
      printf '  ok   the cut names the marker fault\n'
    else printf '  FAIL the cut names the marker fault\n%s\n' "$out"; fails=$((fails+1)); fi
    rescan=$(POSTMASTER_DETECTIONS_LOG= bash "$HERE/scrub-check.sh" "$base" HEAD 2>/dev/null); rcode=$?
    { [ "$rcode" -eq 0 ] && [ -z "$rescan" ]; } \
      && printf '  ok   the cut range scans clean\n' \
      || { printf '  FAIL the cut range scans clean: exit %s\n' "$rcode"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" marked.txt "ordinary  # ${ALLOW_P}w email -- nothing to suppress" >/dev/null
    ( cd "$r" && git rm -q marked.txt && git commit -qm "drop the note" >/dev/null )
    tip=$(git rev-parse HEAD)
    out=$(bash "$REWRITE" "$base" HEAD 2>"$tmp/err"); code=$?
    { [ "$code" -eq 2 ] && [ "$(git rev-parse HEAD)" = "$tip" ]; } \
      && printf '  ok   a marker later work depends on refuses with the branch untouched\n' \
      || { printf '  FAIL a marker later work depends on refuses with the branch untouched: exit %s\n' "$code"; fails=$((fails+1)); }
  }

  echo "precondition controls: clean ranges pass, bad states refuse"
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" notes.txt 'Later clean notes.' >/dev/null
    out=$(bash "$REWRITE" "$base" HEAD 2>/dev/null); code=$?
    { [ "$code" -eq 0 ] && [ -z "$out" ]; } \
      && printf '  ok   a clean range exits silent\n' \
      || { printf '  FAIL a clean range exits silent: exit %s\n' "$code"; fails=$((fails+1)); }
    tip=$(git rev-parse HEAD)
    out=$(bash "$REWRITE" "$tip" "$tip" 2>/dev/null); code=$?
    { [ "$code" -eq 0 ] && [ -z "$out" ]; } \
      && printf '  ok   an empty range exits silent\n' \
      || { printf '  FAIL an empty range exits silent: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" notes/contact.txt "contact: $SUSPECT" >/dev/null
    ( cd "$r" && git rm -q notes/contact.txt && git commit -qm "drop the note" >/dev/null )
    tip=$(git rev-parse HEAD)
    printf 'dirt\n' >> base.txt
    out=$(bash "$REWRITE" "$base" HEAD 2>/dev/null); code=$?
    { [ "$code" -eq 2 ] && [ "$(git rev-parse HEAD)" = "$tip" ]; } \
      && printf '  ok   a dirty tree refuses with the branch untouched\n' \
      || { printf '  FAIL a dirty tree refuses with the branch untouched: exit %s\n' "$code"; fails=$((fails+1)); }
    ( cd "$r" && git checkout -q -- base.txt && printf 'staged\n' >> base.txt && git add base.txt )
    out=$(bash "$REWRITE" "$base" HEAD 2>/dev/null); code=$?
    { [ "$code" -eq 2 ] && [ "$(git rev-parse HEAD)" = "$tip" ]; } \
      && printf '  ok   a staged change refuses with the branch untouched\n' \
      || { printf '  FAIL a staged change refuses with the branch untouched: exit %s\n' "$code"; fails=$((fails+1)); }
    ( cd "$r" && git reset -q && git checkout -q -- base.txt && printf 'untracked\n' > loose.txt )
    out=$(bash "$REWRITE" "$base" HEAD 2>/dev/null); code=$?
    { [ "$code" -eq 0 ] && [ -f "$r/loose.txt" ]; } \
      && printf '  ok   an untracked file stays out of the way\n' \
      || { printf '  FAIL an untracked file stays out of the way: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" notes.txt 'Later clean notes.' >/dev/null
    tip=$(git rev-parse HEAD)
    ( cd "$r" && git checkout -q --detach HEAD )
    out=$(bash "$REWRITE" "$base" HEAD 2>/dev/null); code=$?
    { [ "$code" -eq 2 ] && [ "$(git rev-parse HEAD)" = "$tip" ]; } \
      && printf '  ok   a detached head refuses\n' \
      || { printf '  FAIL a detached head refuses: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" notes.txt 'Later clean notes.' >/dev/null
    ( cd "$r" && git checkout -qb other >/dev/null && printf 'other\n' > other.txt \
      && git add other.txt && git commit -qm other >/dev/null && git checkout -q main )
    out=$(bash "$REWRITE" main other 2>/dev/null); code=$?
    [ "$code" -eq 2 ] \
      && printf '  ok   a head that is not checked out refuses\n' \
      || { printf '  FAIL a head that is not checked out refuses: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" notes.txt 'Later clean notes.' >/dev/null
    ( cd "$r" && git checkout -qb side main >/dev/null && printf 'side\n' > side.txt \
      && git add side.txt && git commit -qm side >/dev/null && git checkout -q main )
    out=$(bash "$REWRITE" side HEAD 2>/dev/null); code=$?
    [ "$code" -eq 2 ] \
      && printf '  ok   a base that is no ancestor refuses\n' \
      || { printf '  FAIL a base that is no ancestor refuses: exit %s\n' "$code"; fails=$((fails+1)); }
    out=$(bash "$REWRITE" "$base" HEAD extra 2>/dev/null); code=$?
    [ "$code" -eq 2 ] \
      && printf '  ok   three range arguments is a usage error\n' \
      || { printf '  FAIL three range arguments is a usage error: exit %s\n' "$code"; fails=$((fails+1)); }
    out=$(bash "$REWRITE" no-such-ref HEAD 2>/dev/null); code=$?
    [ "$code" -eq 2 ] \
      && printf '  ok   an unresolvable base exits 2\n' \
      || { printf '  FAIL an unresolvable base exits 2: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    mkdir -p "$tmp/nostub" && cp "$HERE/scrub-rewrite.sh" "$tmp/nostub/"
    commit_file "$r" notes.txt 'Later clean notes.' >/dev/null
    out=$(bash "$tmp/nostub/scrub-rewrite.sh" main HEAD 2>/dev/null); code=$?
    [ "$code" -eq 2 ] \
      && printf '  ok   a missing scanner fails the rewrite\n' \
      || { printf '  FAIL a missing scanner fails the rewrite: exit %s\n' "$code"; fails=$((fails+1)); }
  }

  echo
  [ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
  echo "self-test: $fails control(s) misbehaved"; exit 1
fi

[ $# -le 2 ] || { echo "$USAGE" >&2; exit 2; }
BASE=${1:-main} HEAD_REF=${2:-HEAD}
case $BASE in -*) echo "$USAGE" >&2; exit 2 ;; esac
case $HEAD_REF in -*) echo "$USAGE" >&2; exit 2 ;; esac

top=$(git rev-parse --show-toplevel 2>/dev/null) || fail "not a git repository"
[ "$(CDPATH= cd -P -- "$top" && pwd -P)" = "$(pwd -P)" ] || fail "run from the repository root"
[ -x "$SCRUB" ] || fail "no scrub to find the findings with"
base=$(git rev-parse --verify --quiet "$BASE^{commit}" 2>/dev/null) || fail "the base does not resolve"
head=$(git rev-parse --verify --quiet "$HEAD_REF^{commit}" 2>/dev/null) || fail "the head does not resolve"
here=$(git rev-parse HEAD 2>/dev/null) || fail "not a git repository"
git symbolic-ref -q HEAD >/dev/null || fail "run on the branch itself, not detached"
[ "$head" = "$here" ] || fail "run on the branch itself"
git merge-base --is-ancestor "$base" "$head" 2>/dev/null || fail "the base is no ancestor of the head"
git diff --quiet && git diff --cached --quiet \
  || fail "the worktree holds uncommitted changes to tracked files"
[ -z "$(git rev-list "$base..$head" -- 2>/dev/null)" ] && exit 0
all=$(git rev-list "$base..$head" 2>/dev/null) || fail "the range could not be read"
unpushed=$(git rev-list "$base..$head" --not --remotes 2>/dev/null) || fail "the range could not be read"
[ "$(printf '%s\n' "$all" | LC_ALL=C sort)" = "$(printf '%s\n' "$unpushed" | LC_ALL=C sort)" ] \
  || fail "the branch is pushed; a pushed branch is never rewritten"

STAGE=$(mktemp -d) || fail "could not stage the rewrite"
cleanup() { rm -rf -- "$STAGE" 2>/dev/null; }
trap cleanup EXIT

# The gate that failed logged these findings already; the rewrite remediates,
# it does not detect, so it scans with the log emptied.
scanerr=$STAGE/scan.err
scanout=$(POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$base" "$head" 2>"$scanerr"); code=$?
cat "$scanerr" >&2
case $code in
  0) exit 0 ;;
  1) ;;
  *) fail "the scan could not finish" ;;
esac
printf '%s\n' "$scanout" > "$STAGE/scan.txt"

# Plan the surgery: classify every finding, refuse what needs hands, and
# write the operations with the report of what they remove.
if ! POSTMASTER_DETECTIONS_LOG= python3 - "$base" "$head" "$SCRUB" "$STAGE" <<'PY'; then
import json
import os
import re
import subprocess
import sys

base, head, scrub, stage = sys.argv[1:5]
SHA = re.compile(r"[0-9a-f]{40}")
MARKER_HEAD = "private-data:allow"


def fail(message):
    print("scrub-rewrite: " + message, file=sys.stderr)
    sys.exit(2)


def sh(*args):
    return subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)


findings = []
for ln in open(os.path.join(stage, "scan.txt"), encoding="utf-8").read().splitlines():
    if len(ln) < 44 or ln[40] != ":" or not SHA.fullmatch(ln[:40]):
        fail("the scan could not be read")
    before, sep, kind = ln[41:].rpartition(": ")
    path, colon, line = before.rpartition(":") if sep else ("", "", "")
    if not sep or not kind or not colon or not path or not line.isdigit():
        fail("the scan could not be read")
    findings.append((ln[:40], path, int(line), kind))
if not findings:
    fail("the scan could not be read")

listed = sh("git", "rev-list", "--parents", base + ".." + head)
if listed.returncode != 0:
    fail("the range could not be read")
commits = []
for ln in listed.stdout.decode("ascii", errors="strict").splitlines():
    parts = ln.split()
    if not parts or any(not SHA.fullmatch(p) for p in parts):
        fail("the range could not be read")
    commits.append((parts[0], parts[1:]))
merges = {sha for sha, parents in commits if len(parents) > 1}
for sha, _path, _line, _kind in findings:
    if sha in merges:
        fail("merge %s carries a finding; redo the merge by hand" % sha)
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
for sha, parents in commits:
    if len(parents) > 1:
        continue
    parent = parents[0] if parents else EMPTY_TREE
    tree = sh("git", "rev-parse", sha + "^{tree}")
    ptree = sh("git", "rev-parse", parent + "^{tree}")
    if tree.returncode != 0 or ptree.returncode != 0:
        fail("the range could not be read")
    if tree.stdout == ptree.stdout:
        fail("commit %s is already empty; rewrite by hand" % sha)

drops, strips, msgs = {}, {}, {}
for sha, path, line, kind in findings:
    if path == "(message)":
        if kind != "assistant-attribution":
            fail("commit %s carries %s in its message; reword it by hand" % (sha, kind))
        msgs.setdefault(sha, set()).add(line)
    elif kind == "marker":
        strips.setdefault((sha, path), set()).add(line)
    else:
        drops.setdefault((sha, path), set()).add(line)
for key in drops:
    if key in strips:
        strips[key] -= drops[key]
        if not strips[key]:
            del strips[key]


def blob(sha, path):
    result = sh("git", "show", "%s:%s" % (sha, path))
    if result.returncode != 0:
        fail("the range could not be read")
    return result.stdout


strip_at = {}
for (sha, path), lines in strips.items():
    try:
        text = blob(sha, path).decode("utf-8")
    except UnicodeError:
        fail("%s in commit %s is not UTF-8; strip its marker by hand" % (path, sha))
    body = text.split("\n")
    count = len(body) - (1 if body and body[-1] == "" else 0)
    starts = {}
    for number in lines:
        if number < 1 or number > count or MARKER_HEAD not in body[number - 1]:
            fail("the scan could not be read")
        # The last head on the line: a redundant marker faults while the
        # first suppresses, and cutting the last keeps the first. When the
        # first head is the faulty one the rescan fails and the branch is
        # restored, so the worst case is a rewrite by hand.
        starts[number] = body[number - 1].rfind(MARKER_HEAD)
    strip_at[(sha, path)] = starts
for (sha, path), lines in drops.items():
    count = len(blob(sha, path).decode("utf-8", errors="replace").splitlines())
    if any(number < 1 or number > count for number in lines):
        fail("the scan could not be read")
for sha, lines in msgs.items():
    result = sh("git", "log", "-1", "--format=%B", sha)
    if result.returncode != 0:
        fail("the range could not be read")
    body = result.stdout.decode("utf-8", errors="replace").splitlines()
    if any(number < 1 or number > len(body) for number in lines):
        fail("the scan could not be read")
    if not any(text.strip() for i, text in enumerate(body, 1) if i not in lines):
        fail("commit %s would be left without a message; reword it by hand" % sha)

ops = {}
for (sha, path), lines in drops.items():
    ops.setdefault(sha, {}).setdefault("drop", {})[path] = sorted(lines)
for (sha, path), starts in strip_at.items():
    ops.setdefault(sha, {}).setdefault("strip", {})[path] = {
        str(number): start for number, start in starts.items()}
for sha, lines in msgs.items():
    ops.setdefault(sha, {})["msg"] = sorted(lines)

# Doomed commits: surgery removes their every change, so replaying them
# would amend to empty, which git refuses. They are dropped from the todo
# instead. Simulation mirrors operate.py line for line: drops remove
# lines, strips cut or remove them, nothing left means the file is gone.
doomed = set()
for sha, parents in commits:
    if len(parents) > 1 or sha not in ops or "msg" in ops[sha] and len(ops[sha]) == 1:
        continue
    parent = parents[0] if parents else EMPTY_TREE
    changed = sh("git", "diff-tree", "--no-renames", "--raw", "-r", "-z", parent, sha)
    if changed.returncode != 0:
        fail("the range could not be read")
    records = changed.stdout.split(b"\0")
    files, i = {}, 0
    while i < len(records) - 1:
        meta, path = records[i].decode("ascii", errors="strict"), records[i + 1]
        i += 2
        if not meta.startswith(":"):
            fail("the range could not be read")
        fields = meta[1:].split(" ")
        if len(fields) != 5:
            fail("the range could not be read")
        files[path.decode("utf-8", errors="surrogateescape")] = (fields[4], fields[0], fields[1])
    doomed_flag = True
    for path, (status, oldmode, newmode) in files.items():
        key = (sha, path)
        if key not in drops and key not in strips:
            doomed_flag = False
            break
        if status == "D":
            fail("the scan could not be read")
        if status == "T" or (status == "M" and oldmode != newmode):
            fail("commit %s changes %s's type; rewrite by hand" % (sha, path))
        raw = blob(sha, path)
        if key in strips:
            text = raw.decode("utf-8")
            trailing = text.endswith("\n")
            lines = text.split("\n")
            if trailing:
                lines.pop()
            gone = set(drops.get(key, ()))
            for number, start in strip_at[key].items():
                kept = lines[number - 1][:start].rstrip(" \t")
                if kept.strip():
                    lines[number - 1] = kept
                else:
                    gone.add(number)
            lines = [text for i, text in enumerate(lines, 1) if i not in gone]
            simulated = None if not lines else (
                "\n".join(lines) + ("\n" if trailing else "")).encode("utf-8")
        else:
            trailing = raw.endswith(b"\n")
            lines = raw.split(b"\n")
            if trailing:
                lines.pop()
            gone = set(drops[key])
            lines = [text for i, text in enumerate(lines, 1) if i not in gone]
            simulated = None if not lines else b"\n".join(lines) + (b"\n" if trailing else b"")
        if status == "A":
            if simulated is not None:
                doomed_flag = False
                break
        else:
            if blob(parent, path) != simulated:
                doomed_flag = False
                break
    if doomed_flag:
        doomed.add(sha)
        del ops[sha]
with open(os.path.join(stage, "ops.json"), "w", encoding="utf-8") as handle:
    json.dump(ops, handle, sort_keys=True)
with open(os.path.join(stage, "doomed.txt"), "w", encoding="utf-8") as handle:
    for sha in sorted(doomed):
        handle.write(sha + "\n")

# The report names redacted paths: a path may itself carry a shape.
redacted = {}
for _sha, path, _line, _kind in findings:
    if path not in redacted and path != "(message)":
        result = sh(scrub, "--safe-path", path)
        if result.returncode != 0:
            fail("the scan could not finish")
        redacted[path] = result.stdout.decode("utf-8", errors="replace").splitlines()
        if len(redacted[path]) != 1:
            fail("the scan could not finish")
        redacted[path] = redacted[path][0]
with open(os.path.join(stage, "removed.txt"), "w", encoding="utf-8") as handle:
    for sha, path, line, kind in sorted(findings):
        shown = path if path == "(message)" else redacted[path]
        handle.write("%s:%s:%d: %s removed\n" % (sha, shown, line, kind))
PY
  exit 2
fi

saved_head=$here
saved_tree=$(git rev-parse "$here^{tree}") || fail "the range could not be read"
cat > "$STAGE/editor.py" <<'PY'
import subprocess
import sys

doomed_path, todo_path = sys.argv[1], sys.argv[2]
doomed = set(open(doomed_path, encoding="utf-8").read().split())
kept = []
for line in open(todo_path, encoding="utf-8").read().splitlines():
    words = line.split(" ", 2)
    if len(words) >= 2 and words[0] == "pick":
        resolved = subprocess.run(
            ["git", "rev-parse", "--verify", "--quiet", words[1] + "^{commit}"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False)
        full = resolved.stdout.decode("ascii", errors="strict").strip()
        if resolved.returncode != 0 or not full:
            sys.exit(1)
        if full in doomed:
            continue
    kept.append(line)
open(todo_path, "w", encoding="utf-8").write("\n".join(kept) + ("\n" if kept else ""))
PY
cat > "$STAGE/operate.py" <<'PY'
import json
import os
import subprocess
import sys

ops_path, root = sys.argv[1], sys.argv[2]
os.chdir(root)
with open(ops_path, encoding="utf-8") as handle:
    ops = json.load(handle)
current = subprocess.run(["git", "rev-parse", "HEAD"], stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, text=True, check=False)
mine = ops.get(current.stdout.strip())
if not mine:
    sys.exit(0)


def sh(*args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, check=False)
    if result.returncode != 0:
        print(result.stderr, end="", file=sys.stderr)
        sys.exit(1)
    return result


def split_keep(raw):
    trailing = raw.endswith(b"\n")
    parts = raw.split(b"\n")
    if trailing:
        parts.pop()
    return parts, trailing


for path in sorted(set(mine.get("drop", {})) | set(mine.get("strip", {}))):
    if path in mine.get("strip", {}):
        try:
            text = open(path, "rb").read().decode("utf-8")
        except (OSError, UnicodeError):
            sys.exit(1)
        trailing = text.endswith("\n")
        lines = text.split("\n")
        if trailing:
            lines.pop()
        cut, gone = {}, set(mine.get("drop", {}).get(path, []))
        for number, start in mine["strip"][path].items():
            kept = lines[int(number) - 1][:start].rstrip(" \t")
            if kept.strip():
                cut[int(number)] = kept
            else:
                gone.add(int(number))
        lines = [cut.get(i, text) for i, text in enumerate(lines, 1) if i not in gone]
        open(path, "w", encoding="utf-8", newline="").write(
            "\n".join(lines) + ("\n" if trailing and lines else ""))
        if not lines:
            sh("git", "rm", "-q", "-f", "--", path)
        else:
            sh("git", "add", "--", path)
    else:
        try:
            raw = open(path, "rb").read()
        except OSError:
            sys.exit(1)
        lines, trailing = split_keep(raw)
        gone = set(mine["drop"][path])
        lines = [text for i, text in enumerate(lines, 1) if i not in gone]
        if not lines:
            open(path, "wb").close()
            sh("git", "rm", "-q", "-f", "--", path)
        else:
            open(path, "wb").write(b"\n".join(lines) + (b"\n" if trailing else b""))
            sh("git", "add", "--", path)

staged = subprocess.run(["git", "diff", "--cached", "--quiet"], check=False).returncode != 0
if "msg" in mine:
    body = sh("git", "log", "-1", "--format=%B", "HEAD").stdout.splitlines()
    gone = set(mine["msg"])
    body = [text for i, text in enumerate(body, 1) if i not in gone]
    with open(os.path.join(os.path.dirname(ops_path), "message.txt"), "w",
              encoding="utf-8") as handle:
        handle.write("\n".join(body) + "\n")
    sh("git", "commit", "-q", "--amend", "-F", os.path.join(os.path.dirname(ops_path), "message.txt"))
elif staged:
    # The planner drops commits its surgery empties, so an amend that
    # would empty one is a planner bug, and stopping is the safe answer.
    staged_tree = sh("git", "write-tree").stdout.strip()
    parent_tree = sh("git", "rev-parse", "HEAD^^{tree}").stdout.strip()
    if staged_tree == parent_tree:
        sys.exit(1)
    sh("git", "commit", "-q", "--amend", "--no-edit")
PY

q() { printf "'%s'" "${1//\'/\'\\\'\'}"; }
rebase_log=$STAGE/rebase.log
if ! GIT_SEQUENCE_EDITOR="python3 $(q "$STAGE/editor.py") $(q "$STAGE/doomed.txt")" GIT_EDITOR=true \
    git rebase -i --rebase-merges --empty=drop \
    --exec "python3 $(q "$STAGE/operate.py") $(q "$STAGE/ops.json") $(q "$(pwd -P)")" \
    "$base" >"$rebase_log" 2>&1; then
  conflicts=$(git diff --name-only --diff-filter=U -z 2>/dev/null | tr '\0' '\n' | LC_ALL=C sort)
  if ! git rebase --abort >/dev/null 2>&1; then
    fail "the replay stopped and could not be aborted; resolve it by hand"
  fi
  if [ -n "$conflicts" ]; then
    safe=$(while IFS= read -r p; do
      [ -n "$p" ] && bash "$SCRUB" --safe-path "$p" 2>/dev/null
    done <<<"$conflicts" | paste -sd, - | sed 's/,/, /g')
    fail "the replay conflicted in ${safe:-a file} and was aborted; the branch is unchanged"
  fi
  fail "the replay stopped and was aborted; the branch is unchanged"
fi

[ "$(git rev-parse "HEAD^{tree}")" = "$saved_tree" ] \
  || { git reset -q --hard "$saved_head" 2>/dev/null; fail "the rewrite changed the final tree; it was restored"; }
rescan_err=$STAGE/rescan.err
rescan=$(POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" "$base" HEAD 2>"$rescan_err"); code=$?
cat "$rescan_err" >&2
{ [ "$code" -eq 0 ] && [ -z "$rescan" ]; } \
  || { git reset -q --hard "$saved_head" 2>/dev/null; fail "the rewrite stayed dirty; it was restored"; }
cat "$STAGE/removed.txt"
exit 0
