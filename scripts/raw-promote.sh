#!/usr/bin/env bash
# Copy one file or tree into raw/, scanned before the copy completes.
#
#   raw-promote.sh <src> <dest>               copy src to dest under raw/
#   raw-promote.sh --ruled "<reason>" <src> <dest>
#                                             copy despite a trip, recording
#                                             the user's ruling in wiki/log.md
#   raw-promote.sh --self-test                controls, exit 0 when all pass
#   raw-promote.sh --help                     usage, exit 0
#
# Run from the repository root. The copy is the moment of publication, so the
# scan runs first: every regular file under src goes through the scrub, and a
# copy that trips does not complete. Proceeding anyway is the user's ruling,
# and --ruled writes that ruling, with its reason, to wiki/log.md itself, so
# no copy proceeds without its record. A clean copy with --ruled logs nothing:
# there was nothing to rule. The destination must be under raw/ and must not
# exist: evidence is never overwritten, and a ruling never edits raw/ in place.
# Symlinks and other non-regular files are refused, never followed.
#
# A trip reports the scrub's suspect lines on stdout, one per line as
# <path>:<line>: <kind>, never a value.
#
#   exit 0  copied
#   exit 1  the scan tripped; nothing was copied
#   exit 2  usage, not a repository, the scan failed, the destination is
#           outside raw/ or already exists, or the source is unusable
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
ROOT=$(CDPATH= cd -P -- "$HERE/.." && pwd -P)
SCRUB=$ROOT/scripts/scrub-check.sh
USAGE="usage: raw-promote.sh [--ruled \"<reason>\"] <src> <dest> | --self-test | --help"

case ${1:-} in
  --help) echo "$USAGE" >&2; exit 0 ;;
esac

fail() { echo "raw-promote: $1" >&2; exit "${2:-2}"; }

if [ "${1:-}" = "--self-test" ]; then
  tmp=$(mktemp -d) || exit 2
  # shellcheck disable=SC2064
  trap "rm -r -- \"$tmp\" </dev/null 2>/dev/null" EXIT
  fails=0
  E_LOCAL='relay-413'; E_HOST='quiet-relay-413'; E_TLD='net'
  SUSPECT="contact-${E_LOCAL}@${E_HOST}.${E_TLD}"

  repo() {  # a scratch repo, printed; the caller cds into it
    local d
    d=$(mktemp -d -p "$tmp") || return 1
    ( cd "$d" && git init -q -b main . ) || return 1
    printf '%s' "$d"
  }
  expect() {  # expect <want-exit> <label> <command...>
    local want=$1 label=$2 out code
    shift 2
    out=$("$@" 2>&1); code=$?
    if [ "$code" -eq "$want" ]; then printf '  ok   %s\n' "$label"
    else printf '  FAIL %s: wanted exit %s, got %s\n%s\n' "$label" "$want" "$code" "$out"; fails=$((fails+1)); fi
  }
  refused_clean() {  # refused_clean <repo> <dest>: nothing was copied there
    [ ! -e "$1/$2" ]
  }

  echo "positive controls: a tripped copy does not complete"
  r=$(repo) && { cd "$r" || exit 2
    printf 'Reach the relay at %s for pings.\n' "$SUSPECT" > "$tmp/dirty.md"
    out=$(bash "$HERE/raw-promote.sh" "$tmp/dirty.md" raw/trials/t413/notes.md 2>"$tmp/err"); code=$?
    { [ "$code" -eq 1 ] && refused_clean "$r" raw/trials/t413/notes.md; } \
      && printf '  ok   a dirty file is refused with nothing copied\n' \
      || { printf '  FAIL a dirty file is refused with nothing copied: exit %s\n' "$code"; fails=$((fails+1)); }
    if printf '%s' "$out" | grep -qF -- "$SUSPECT" || grep -qF -- "$SUSPECT" "$tmp/err"; then
      printf '  FAIL a refusal prints no value\n'; fails=$((fails+1))
    else printf '  ok   a refusal prints no value\n'; fi
    if printf '%s' "$out" | grep -qE ': [A-Za-z0-9_.-]+$'; then printf '  ok   a refusal names the kind\n'
    else printf '  FAIL a refusal names the kind\n'; fails=$((fails+1)); fi
  }
  r=$(repo) && { cd "$r" || exit 2
    mkdir -p "$tmp/dirtytree/sub" && printf 'clean\n' > "$tmp/dirtytree/a.md"
    printf 'Reach the relay at %s.\n' "$SUSPECT" > "$tmp/dirtytree/sub/b.md"
    out=$(bash "$HERE/raw-promote.sh" "$tmp/dirtytree" raw/trials/t413 2>/dev/null); code=$?
    { [ "$code" -eq 1 ] && refused_clean "$r" raw/trials/t413; } \
      && printf '  ok   a dirty tree is refused whole\n' \
      || { printf '  FAIL a dirty tree is refused whole: exit %s\n' "$code"; fails=$((fails+1)); }
  }

  echo "negative controls: clean copies complete"
  r=$(repo) && { cd "$r" || exit 2
    printf 'The relay ran its checks and stayed green.\n' > "$tmp/clean.md"
    expect 0 "a clean file promotes" bash "$HERE/raw-promote.sh" "$tmp/clean.md" raw/trials/t413/notes.md
    cmp -s "$tmp/clean.md" "$r/raw/trials/t413/notes.md" \
      && printf '  ok   a promotion copies the content whole\n' \
      || { printf '  FAIL a promotion copies the content whole\n'; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    mkdir -p "$tmp/cleantree/sub" && printf 'a\n' > "$tmp/cleantree/a.md"
    printf 'b\n' > "$tmp/cleantree/sub/b.md"
    expect 0 "a clean tree promotes" bash "$HERE/raw-promote.sh" "$tmp/cleantree" raw/trials/t413
    { [ -f "$r/raw/trials/t413/a.md" ] && [ -f "$r/raw/trials/t413/sub/b.md" ]; } \
      && printf '  ok   a tree promotion keeps the shape\n' \
      || { printf '  FAIL a tree promotion keeps the shape\n'; fails=$((fails+1)); }
  }

  echo "ruling controls: --ruled copies and records"
  r=$(repo) && { cd "$r" || exit 2
    printf 'Reach the relay at %s for pings.\n' "$SUSPECT" > "$tmp/dirty.md"
    out=$(bash "$HERE/raw-promote.sh" --ruled 'self-test ruling: the staging address' \
      "$tmp/dirty.md" raw/trials/t413/notes.md 2>"$tmp/err"); code=$?
    { [ "$code" -eq 0 ] && [ -f "$r/raw/trials/t413/notes.md" ]; } \
      && printf '  ok   a ruled copy completes\n' \
      || { printf '  FAIL a ruled copy completes: exit %s\n' "$code"; fails=$((fails+1)); }
    { grep -qF 'self-test ruling: the staging address' "$r/wiki/log.md" 2>/dev/null \
      && grep -qF 'promote-ruled' "$r/wiki/log.md" 2>/dev/null; } \
      && printf '  ok   the ruling lands in wiki/log.md with its reason\n' \
      || { printf '  FAIL the ruling lands in wiki/log.md with its reason\n'; fails=$((fails+1)); }
    if grep -qF -- "$SUSPECT" "$r/wiki/log.md" 2>/dev/null || printf '%s' "$out" | grep -qF -- "$SUSPECT" \
        || grep -qF -- "$SUSPECT" "$tmp/err"; then
      printf '  FAIL a ruled copy prints no value\n'; fails=$((fails+1))
    else printf '  ok   a ruled copy prints no value\n'; fi
  }
  r=$(repo) && { cd "$r" || exit 2
    printf 'clean\n' > "$tmp/clean.md"
    out=$(bash "$HERE/raw-promote.sh" --ruled 'self-test ruling: nothing to rule' \
      "$tmp/clean.md" raw/trials/t413/notes.md 2>/dev/null); code=$?
    { [ "$code" -eq 0 ] && [ ! -e "$r/wiki/log.md" ]; } \
      && printf '  ok   a clean copy with --ruled logs nothing\n' \
      || { printf '  FAIL a clean copy with --ruled logs nothing: exit %s\n' "$code"; fails=$((fails+1)); }
  }

  echo "refusal controls: the destination and the source"
  r=$(repo) && { cd "$r" || exit 2
    printf 'clean\n' > "$tmp/clean.md"
    out=$(bash "$HERE/raw-promote.sh" "$tmp/clean.md" notes/elsewhere.md 2>/dev/null); code=$?
    { [ "$code" -eq 2 ] && refused_clean "$r" notes/elsewhere.md; } \
      && printf '  ok   a destination outside raw/ is refused\n' \
      || { printf '  FAIL a destination outside raw/ is refused: exit %s\n' "$code"; fails=$((fails+1)); }
    out=$(bash "$HERE/raw-promote.sh" "$tmp/clean.md" raw/../notes/escape.md 2>/dev/null); code=$?
    { [ "$code" -eq 2 ] && refused_clean "$r" notes/escape.md; } \
      && printf '  ok   a destination escaping raw/ is refused\n' \
      || { printf '  FAIL a destination escaping raw/ is refused: exit %s\n' "$code"; fails=$((fails+1)); }
    mkdir -p "$r/raw/trials/t413"
    printf 'evidence\n' > "$r/raw/trials/t413/notes.md"
    out=$(bash "$HERE/raw-promote.sh" "$tmp/clean.md" raw/trials/t413/notes.md 2>/dev/null); code=$?
    { [ "$code" -eq 2 ] && [ "$(cat "$r/raw/trials/t413/notes.md")" = "evidence" ]; } \
      && printf '  ok   an existing destination is never overwritten\n' \
      || { printf '  FAIL an existing destination is never overwritten: exit %s\n' "$code"; fails=$((fails+1)); }
    out=$(bash "$HERE/raw-promote.sh" "$tmp/no-such-file.md" raw/trials/t413/x.md 2>/dev/null); code=$?
    [ "$code" -eq 2 ] \
      && printf '  ok   a missing source is refused\n' \
      || { printf '  FAIL a missing source is refused: exit %s\n' "$code"; fails=$((fails+1)); }
    mkdir -p "$tmp/linktree" && ln -s /etc/hostname "$tmp/linktree/link.md"
    out=$(bash "$HERE/raw-promote.sh" "$tmp/linktree" raw/trials/t414 2>/dev/null); code=$?
    { [ "$code" -eq 2 ] && refused_clean "$r" raw/trials/t414; } \
      && printf '  ok   a source carrying a symlink is refused\n' \
      || { printf '  FAIL a source carrying a symlink is refused: exit %s\n' "$code"; fails=$((fails+1)); }
    out=$(bash "$HERE/raw-promote.sh" 2>/dev/null); code=$?
    [ "$code" -eq 2 ] \
      && printf '  ok   no arguments is a usage error\n' \
      || { printf '  FAIL no arguments is a usage error: exit %s\n' "$code"; fails=$((fails+1)); }
  }

  echo
  [ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
  echo "self-test: $fails control(s) misbehaved"; exit 1
fi

RULED=""
if [ "${1:-}" = "--ruled" ]; then
  [ $# -ge 2 ] && [ -n "${2:-}" ] || { echo "$USAGE" >&2; exit 2; }
  RULED=$2; shift 2
fi
[ $# -eq 2 ] || { echo "$USAGE" >&2; exit 2; }
SRC=$1 DEST=$2

top=$(git rev-parse --show-toplevel 2>/dev/null) || fail "not a git repository"
[ "$(CDPATH= cd -P -- "$top" && pwd -P)" = "$(pwd -P)" ] || fail "run from the repository root"

case $DEST in raw/?*) ;; *) fail "the destination must be under raw/" ;; esac
case $DEST in */../*|../*|*/..|..) fail "the destination must be under raw/" ;; esac
[ -e "$DEST" ] && fail "the destination already exists; evidence is never overwritten"
[ -e "$SRC" ] || fail "the source does not exist"

if [ -d "$SRC" ] && [ ! -L "$SRC" ]; then
  odd=$(find "$SRC" -not -type f -not -type d -print -quit)
  [ -n "$odd" ] && fail "the source carries a non-regular file; symlinks are refused"
  mapfile -d '' -t FILES < <(find "$SRC" -type f -print0)
elif [ -f "$SRC" ] && [ ! -L "$SRC" ]; then
  FILES=("$SRC")
else
  fail "the source is neither a regular file nor a directory"
fi

TRIP=""
if [ "${#FILES[@]}" -gt 0 ]; then
  errf=$(mktemp) || fail "could not stage the scan"
  TRIP=$(bash "$SCRUB" --files "${FILES[@]}" 2>"$errf"); code=$?
  cat "$errf" >&2; rm -f -- "$errf"
  if [ "$code" -eq 2 ]; then fail "the scan could not finish"; fi
  if [ "$code" -eq 1 ] && [ -z "$RULED" ]; then printf '%s\n' "$TRIP"; exit 1; fi
fi

mkdir -p -- "$(dirname -- "$DEST")"
if [ -d "$SRC" ] && [ ! -L "$SRC" ]; then cp -r -- "$SRC" "$DEST"
else cp -- "$SRC" "$DEST"; fi

if [ -n "$TRIP" ] && [ -n "$RULED" ]; then
  kinds=$(printf '%s\n' "$TRIP" | sed -n 's/^.*: \([A-Za-z0-9_.-]*\)$/\1/p' | sort -u | tr '\n' ',' | sed 's/,$//;s/,/, /g')
  mkdir -p wiki
  printf '## [%s] promote-ruled | %s: the user ruled proceed (%s); the scan had reported: %s\n' \
    "$(date -u +%F)" "$DEST" "$RULED" "$kinds" >> wiki/log.md
fi
exit 0
