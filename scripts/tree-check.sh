#!/usr/bin/env bash
# Fail when the change stages or commits anything under .postmaster/, and hold
# every added raw/ file to the scrub.
#
#   tree-check.sh [<base> [<head>]]   the change; base defaults to main, head
#                                     to HEAD; run from the repository root
#   tree-check.sh --self-test         controls, exit 0 when all pass
#   tree-check.sh --help              usage, exit 0
#
# .postmaster/ holds a run's automatic record and is gitignored in its own
# project; the one file a project commits there is .postmaster/project.toml,
# its shared settings, which verify.sh reads. Anything else staged or committed
# under .postmaster/ fails, named by path. raw/ is committed by design, so for
# raw/ the check holds every added file to the scrub instead: files the change
# adds, plus files staged but not yet committed, scanned from the worktree.
# Added means added: a modification to an already-committed file is the scrub's
# business, which sees every added line of every commit. A file the change
# added and then deleted has no worktree content to scan, and likewise rests
# with the scrub. Both halves report value-free: paths and kinds, never values.
#
#   exit 0  clean
#   exit 1  faults on stdout, one per line
#   exit 2  usage, not a repository, an unresolvable base or head, or a scan
#           that could not finish
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
ROOT=$(CDPATH= cd -P -- "$HERE/.." && pwd -P)
SCRUB=$ROOT/scripts/scrub-check.sh
USAGE="usage: tree-check.sh [<base> [<head>]] | --self-test | --help"

case ${1:-} in
  --help) echo "$USAGE" >&2; exit 0 ;;
esac

fail() { echo "tree-check: $1" >&2; exit "${2:-2}"; }

if [ "${1:-}" = "--self-test" ]; then
  tmp=$(mktemp -d) || exit 2
  # shellcheck disable=SC2064
  trap "rm -r -- \"$tmp\" </dev/null 2>/dev/null" EXIT
  fails=0
  E_LOCAL='relay-413'; E_HOST='quiet-relay-413'; E_TLD='net'
  SUSPECT="contact-${E_LOCAL}@${E_HOST}.${E_TLD}"
  export GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL
  GIT_AUTHOR_NAME=tree-check; GIT_AUTHOR_EMAIL="tree-check@users.noreply.github.com"
  GIT_COMMITTER_NAME=tree-check; GIT_COMMITTER_EMAIL="tree-check@users.noreply.github.com"

  repo() {  # a scratch repo on main with one clean commit, printed
    local d
    d=$(mktemp -d -p "$tmp") || return 1
    ( cd "$d" && git init -q -b main . && printf 'base\n' > base.txt \
      && git add base.txt && git commit -qm base ) || return 1
    printf '%s' "$d"
  }
  commit_file() {  # commit_file <repo> <path> <content>
    ( cd "$1" && mkdir -p "$(dirname "$2")" && printf '%s\n' "$3" > "$2" \
      && git add "$2" && git commit -qm "add $2" >/dev/null )
  }

  echo "positive controls: .postmaster/ and added raw/ faults fail"
  r=$(repo) && { cd "$r" || exit 2
    head=$(git rev-parse HEAD)
    mkdir -p .postmaster/verify && printf 'run record\n' > .postmaster/verify/checks.json
    git add .postmaster/verify/checks.json
    out=$(bash "$HERE/tree-check.sh" main "$head" 2>/dev/null); code=$?
    { [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF '.postmaster/verify/checks.json'; } \
      && printf '  ok   a staged .postmaster/ file fails, named\n' \
      || { printf '  FAIL a staged .postmaster/ file fails, named: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" .postmaster/runs/stale.json '{"run": "stale"}'
    head=$(git rev-parse HEAD)
    out=$(bash "$HERE/tree-check.sh" "$base" "$head" 2>/dev/null); code=$?
    { [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF '.postmaster/runs/stale.json'; } \
      && printf '  ok   a committed .postmaster/ file fails, named\n' \
      || { printf '  FAIL a committed .postmaster/ file fails, named: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" raw/trials/t413/notes.md "Reach the relay at $SUSPECT for pings."
    head=$(git rev-parse HEAD)
    out=$(bash "$HERE/tree-check.sh" "$base" "$head" 2>"$tmp/err"); code=$?
    { [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF 'raw/trials/t413/notes.md:1:'; } \
      && printf '  ok   an added raw/ file carrying a suspect fails, named\n' \
      || { printf '  FAIL an added raw/ file carrying a suspect fails, named: exit %s\n' "$code"; fails=$((fails+1)); }
    if printf '%s' "$out" | grep -qF -- "$SUSPECT" || grep -qF -- "$SUSPECT" "$tmp/err"; then
      printf '  FAIL a raw/ fault prints no value\n'; fails=$((fails+1))
    else printf '  ok   a raw/ fault prints no value\n'; fi
  }
  r=$(repo) && { cd "$r" || exit 2
    head=$(git rev-parse HEAD)
    mkdir -p raw/trials/t413
    printf 'Reach the relay at %s.\n' "$SUSPECT" > raw/trials/t413/staged.md
    git add raw/trials/t413/staged.md
    out=$(bash "$HERE/tree-check.sh" main "$head" 2>/dev/null); code=$?
    { [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF 'raw/trials/t413/staged.md:1:'; } \
      && printf '  ok   a staged raw/ addition is held to the scan\n' \
      || { printf '  FAIL a staged raw/ addition is held to the scan: exit %s\n' "$code"; fails=$((fails+1)); }
  }

  echo "negative controls: the exempt file, clean trees and clean additions pass"
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" .postmaster/project.toml '[checks.example]'
    head=$(git rev-parse HEAD)
    out=$(bash "$HERE/tree-check.sh" "$base" "$head" 2>/dev/null); code=$?
    { [ "$code" -eq 0 ] && [ -z "$out" ]; } \
      && printf '  ok   the committed project.toml passes\n' \
      || { printf '  FAIL the committed project.toml passes: exit %s\n' "$code"; fails=$((fails+1)); }
    printf '[checks.changed]\n' > .postmaster/project.toml
    git add .postmaster/project.toml
    out=$(bash "$HERE/tree-check.sh" "$base" "$head" 2>/dev/null); code=$?
    { [ "$code" -eq 0 ] && [ -z "$out" ]; } \
      && printf '  ok   a staged change to the project.toml passes\n' \
      || { printf '  FAIL a staged change to the project.toml passes: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" raw/trials/t413/notes.md 'The relay ran its checks and stayed green.'
    head=$(git rev-parse HEAD)
    out=$(bash "$HERE/tree-check.sh" "$base" "$head" 2>/dev/null); code=$?
    { [ "$code" -eq 0 ] && [ -z "$out" ]; } \
      && printf '  ok   a clean raw/ addition passes\n' \
      || { printf '  FAIL a clean raw/ addition passes: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    commit_file "$r" raw/trials/t413/notes.md 'The relay ran its checks.'
    base=$(git rev-parse HEAD)
    commit_file "$r" raw/trials/t413/notes.md "Reach the relay at $SUSPECT for pings."
    head=$(git rev-parse HEAD)
    out=$(bash "$HERE/tree-check.sh" "$base" "$head" 2>/dev/null); code=$?
    { [ "$code" -eq 0 ] && [ -z "$out" ]; } \
      && printf '  ok   a modified raw/ file is not an addition\n' \
      || { printf '  FAIL a modified raw/ file is not an addition: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    head=$(git rev-parse HEAD)
    out=$(bash "$HERE/tree-check.sh" 2>/dev/null); code=$?
    { [ "$code" -eq 0 ] && [ -z "$out" ]; } \
      && printf '  ok   a clean tree passes through the identical check\n' \
      || { printf '  FAIL a clean tree passes through the identical check: exit %s\n' "$code"; fails=$((fails+1)); }
    out=$(bash "$HERE/tree-check.sh" main main main 2>/dev/null); code=$?
    [ "$code" -eq 2 ] \
      && printf '  ok   three range arguments is a usage error\n' \
      || { printf '  FAIL three range arguments is a usage error: exit %s\n' "$code"; fails=$((fails+1)); }
    out=$(bash "$HERE/tree-check.sh" no-such-ref HEAD 2>/dev/null); code=$?
    [ "$code" -eq 2 ] \
      && printf '  ok   an unresolvable base exits 2\n' \
      || { printf '  FAIL an unresolvable base exits 2: exit %s\n' "$code"; fails=$((fails+1)); }
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
git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null || fail "the base does not resolve"
git rev-parse --verify --quiet "$HEAD_REF^{commit}" >/dev/null || fail "the head does not resolve"

FAULTS=""
note() {  # note <line>: one fault on the pile
  if [ -z "$FAULTS" ]; then FAULTS=$1; else FAULTS="$FAULTS
$1"; fi
}

SEEN=""
while IFS= read -r -d '' p; do
  [ "$p" = ".postmaster/project.toml" ] && continue
  case $SEEN in *"|$p|"*) ;; *) SEEN="$SEEN|$p|" ;; esac
done < <( { git ls-files -z -- .postmaster; git diff --cached --name-only -z -- .postmaster; } 2>/dev/null )
if [ -n "$SEEN" ]; then
  while IFS= read -r -d '' p; do
    [ -z "$p" ] && continue
    if git cat-file -e "HEAD:$p" 2>/dev/null; then how=committed; else how=staged; fi
    note "$p: $how under .postmaster/ (only .postmaster/project.toml may be committed)"
  done < <(printf '%s' "$SEEN" | tr '|' '\0')
fi

ADDED=""
while IFS= read -r -d '' p; do
  [ -n "$p" ] || continue
  case $ADDED in *"|$p|"*) ;; *) ADDED="$ADDED|$p|" ;; esac
done < <( { git diff --name-only -z --diff-filter=A "$BASE" "$HEAD_REF" -- raw/ 2>/dev/null; \
  git diff --cached --name-only -z --diff-filter=A -- raw/ 2>/dev/null; } )
if [ -n "$ADDED" ]; then
  PATHS=()
  while IFS= read -r -d '' p; do
    [ -n "$p" ] || continue
    [ -f "$p" ] && [ ! -L "$p" ] || fail "cannot read added file $p"
    PATHS+=("$p")
  done < <(printf '%s' "$ADDED" | tr '|' '\0')
  if [ "${#PATHS[@]}" -gt 0 ]; then
    errf=$(mktemp) || fail "could not stage the scan"
    out=$(bash "$SCRUB" --files "${PATHS[@]}" 2>"$errf"); code=$?
    cat "$errf" >&2; rm -f -- "$errf"
    if [ "$code" -eq 2 ]; then fail "the scan could not finish"; fi
    [ "$code" -eq 1 ] && FAULTS="${FAULTS:+$FAULTS
}$out"
  fi
fi

if [ -n "$FAULTS" ]; then printf '%s\n' "$FAULTS"; exit 1; fi
exit 0
