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
# under .postmaster/ fails, named by redacted path: tracked at the tip,
# staged, or added or modified in any commit of the range, so a file added
# and then deleted before the tip still fails. A deletion never faults:
# removing a run record is remediation, not a new record. raw/ is committed
# by design, so for raw/ the check holds every added file to the scrub
# instead: files the change adds, scanned as committed blobs, plus files
# staged but not yet committed, scanned as staged blobs, never as worktree
# content, which may differ from either. Added means added: a modification
# to an already-committed file is the scrub's business, which sees every
# added line of every commit. A file the change added and then deleted is
# gone from its head blob, and likewise rests with the scrub. Both halves
# report value-free: paths and kinds, never values.
#
# Blobs are scanned through stand-in paths, so the scrub runs with the
# detections log emptied and each raw/ fault is logged under its real path
# through --log-detection instead. Marker faults are reported but never
# logged: they are structural, not detections.
#
#   exit 0  clean
#   exit 1  faults on stdout, one per line
#   exit 2  usage, not a repository, an unresolvable base or head, a tree
#           that could not be read, or a scan that could not finish
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
  # Hermetic logging: the gate runs self-tests with a detections log set,
  # and fixture findings must never land in it.
  export POSTMASTER_DETECTIONS_LOG=
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
    base=$(git rev-parse HEAD)
    commit_file "$r" raw/trials/t413/notes.md "Reach the relay at $SUSPECT for pings."
    head=$(git rev-parse HEAD)
    out=$(POSTMASTER_DETECTIONS_LOG="$tmp/det.jsonl" bash "$HERE/tree-check.sh" "$base" "$head" 2>/dev/null); code=$?
    [ "$code" -eq 1 ] \
      && printf '  ok   a logged raw/ fault still fails\n' \
      || { printf '  FAIL a logged raw/ fault still fails: exit %s\n' "$code"; fails=$((fails+1)); }
    entry=$(python3 -c 'import json,sys; e=[json.loads(l) for l in open(sys.argv[1])]; print(len(e), e[0].get("rule"), e[0].get("file"), e[0].get("line"), repr(e[0].get("commit")))' "$tmp/det.jsonl" 2>/dev/null)
    [ "$entry" = "1 email raw/trials/t413/notes.md 1 ''" ] \
      && printf '  ok   a raw/ fault is logged once, under its real path\n' \
      || { printf '  FAIL a raw/ fault is logged once, under its real path: %s\n' "$entry"; fails=$((fails+1)); }
    if grep -qF -- "$SUSPECT" "$tmp/det.jsonl" 2>/dev/null; then
      printf '  FAIL a logged fault logs no value\n'; fails=$((fails+1))
    else printf '  ok   a logged fault logs no value\n'; fi
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    ALLOW_P='private-data:allo'
    commit_file "$r" raw/trials/t413/notes.md "ordinary  # ${ALLOW_P}w email -- nothing to suppress"
    head=$(git rev-parse HEAD)
    rm -f "$tmp/det2.jsonl"
    out=$(POSTMASTER_DETECTIONS_LOG="$tmp/det2.jsonl" bash "$HERE/tree-check.sh" "$base" "$head" 2>/dev/null); code=$?
    { [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF ': marker'; } \
      && printf '  ok   a marker fault in a raw/ add is reported\n' \
      || { printf '  FAIL a marker fault in a raw/ add is reported: exit %s\n' "$code"; fails=$((fails+1)); }
    [ ! -e "$tmp/det2.jsonl" ] \
      && printf '  ok   a marker fault is never logged\n' \
      || { printf '  FAIL a marker fault is never logged\n'; fails=$((fails+1)); }
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
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" "raw/trials/t413/$SUSPECT.txt" "just public words here."
    head=$(git rev-parse HEAD)
    out=$(bash "$HERE/tree-check.sh" "$base" "$head" 2>"$tmp/err"); code=$?
    { [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF ':0: email'; } \
      && printf '  ok   an added raw/ file with a shaped name fails at line 0\n' \
      || { printf '  FAIL an added raw/ file with a shaped name fails at line 0: exit %s\n' "$code"; fails=$((fails+1)); }
    if printf '%s' "$out" | grep -qF -- "$SUSPECT" || grep -qF -- "$SUSPECT" "$tmp/err"; then
      printf '  FAIL a name fault prints no value\n'; fails=$((fails+1))
    else printf '  ok   a name fault prints no value\n'; fi
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" .postmaster/verify/checks.json 'run record'
    ( cd "$r" && git rm -q -- .postmaster/verify/checks.json && git commit -qm "remove the record" )
    head=$(git rev-parse HEAD)
    out=$(bash "$HERE/tree-check.sh" "$base" "$head" 2>/dev/null); code=$?
    { [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF '.postmaster/verify/checks.json' \
      && printf '%s' "$out" | grep -q 'committed under'; } \
      && printf '  ok   a .postmaster/ file added and then deleted fails as committed\n' \
      || { printf '  FAIL a .postmaster/ file added and then deleted fails as committed: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    head=$(git rev-parse HEAD)
    mkdir -p .postmaster
    printf 'run record\n' > ".postmaster/$SUSPECT.json"
    git add ".postmaster/$SUSPECT.json"
    out=$(bash "$HERE/tree-check.sh" main "$head" 2>/dev/null); code=$?
    { [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF '[redacted]'; } \
      && printf '  ok   a shaped .postmaster/ path is redacted\n' \
      || { printf '  FAIL a shaped .postmaster/ path is redacted: exit %s\n' "$code"; fails=$((fails+1)); }
    if printf '%s' "$out" | grep -qF -- "$SUSPECT"; then
      printf '  FAIL a shaped path prints no value\n'; fails=$((fails+1))
    else printf '  ok   a shaped path prints no value\n'; fi
  }
  r=$(repo) && { cd "$r" || exit 2
    head=$(git rev-parse HEAD)
    mkdir -p raw
    printf 'Reach the relay at %s for pings.\n' "$SUSPECT" > raw/probe.md
    git add raw/probe.md
    printf 'all clean here\n' > raw/probe.md
    out=$(bash "$HERE/tree-check.sh" main "$head" 2>/dev/null); code=$?
    { [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF 'raw/probe.md:1:'; } \
      && printf '  ok   a staged suspect is read from its blob, not the worktree\n' \
      || { printf '  FAIL a staged suspect is read from its blob, not the worktree: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" ".postmaster/run|stale.json" '{"run": "stale"}'
    head=$(git rev-parse HEAD)
    out=$(bash "$HERE/tree-check.sh" "$base" "$head" 2>/dev/null); code=$?
    { [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF '.postmaster/run|stale.json'; } \
      && printf '  ok   a pipe in a .postmaster/ name stays one path\n' \
      || { printf '  FAIL a pipe in a .postmaster/ name stays one path: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" "raw/t/no|te.md" "Reach the relay at $SUSPECT for pings."
    head=$(git rev-parse HEAD)
    out=$(bash "$HERE/tree-check.sh" "$base" "$head" 2>/dev/null); code=$?
    { [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF 'raw/t/no|te.md:1:'; } \
      && printf '  ok   a pipe in a raw/ name is scanned whole\n' \
      || { printf '  FAIL a pipe in a raw/ name is scanned whole: exit %s\n' "$code"; fails=$((fails+1)); }
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
    commit_file "$r" .postmaster/runs/stale.json '{"run": "stale"}'
    base=$(git rev-parse HEAD)
    ( cd "$r" && git rm -q -- .postmaster/runs/stale.json )
    head=$(git rev-parse HEAD)
    out=$(bash "$HERE/tree-check.sh" "$base" "$head" 2>/dev/null); code=$?
    { [ "$code" -eq 0 ] && [ -z "$out" ]; } \
      && printf '  ok   a staged deletion of a .postmaster/ file passes\n' \
      || { printf '  FAIL a staged deletion of a .postmaster/ file passes: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    commit_file "$r" .postmaster/runs/stale.json '{"run": "stale"}'
    base=$(git rev-parse HEAD)
    ( cd "$r" && git rm -q -- .postmaster/runs/stale.json && git commit -qm "remove the record" )
    head=$(git rev-parse HEAD)
    out=$(bash "$HERE/tree-check.sh" "$base" "$head" 2>/dev/null); code=$?
    { [ "$code" -eq 0 ] && [ -z "$out" ]; } \
      && printf '  ok   a committed deletion of a .postmaster/ file passes\n' \
      || { printf '  FAIL a committed deletion of a .postmaster/ file passes: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" raw/t/notes.md 'The relay ran its checks and stayed green.'
    head=$(git rev-parse HEAD)
    rm -- "$r/raw/t/notes.md"
    out=$(bash "$HERE/tree-check.sh" "$base" "$head" 2>/dev/null); code=$?
    { [ "$code" -eq 0 ] && [ -z "$out" ]; } \
      && printf '  ok   a clean committed add missing from the worktree passes\n' \
      || { printf '  FAIL a clean committed add missing from the worktree passes: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" raw/t/notes.md "Reach the relay at $SUSPECT for pings."
    head=$(git rev-parse HEAD)
    rm -- "$r/raw/t/notes.md"
    out=$(bash "$HERE/tree-check.sh" "$base" "$head" 2>/dev/null); code=$?
    { [ "$code" -eq 1 ] && printf '%s' "$out" | grep -qF 'raw/t/notes.md:1:'; } \
      && printf '  ok   a dirty committed add missing from the worktree is read from its blob\n' \
      || { printf '  FAIL a dirty committed add missing from the worktree is read from its blob: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    head=$(git rev-parse HEAD)
    mkdir -p raw
    printf 'all clean here\n' > raw/probe.md
    git add raw/probe.md
    printf 'Reach the relay at %s for pings.\n' "$SUSPECT" > raw/probe.md
    out=$(bash "$HERE/tree-check.sh" main "$head" 2>/dev/null); code=$?
    { [ "$code" -eq 0 ] && [ -z "$out" ]; } \
      && printf '  ok   worktree dirt over a clean staged blob passes\n' \
      || { printf '  FAIL worktree dirt over a clean staged blob passes: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" raw/t/notes.md "Reach the relay at $SUSPECT for pings."
    ( cd "$r" && git rm -q -- raw/t/notes.md && git commit -qm "remove the note" )
    head=$(git rev-parse HEAD)
    out=$(bash "$HERE/tree-check.sh" "$base" "$head" 2>/dev/null); code=$?
    { [ "$code" -eq 0 ] && [ -z "$out" ]; } \
      && printf '  ok   a raw/ file added and then deleted rests with the scrub\n' \
      || { printf '  FAIL a raw/ file added and then deleted rests with the scrub: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    base=$(git rev-parse HEAD)
    commit_file "$r" raw/t/notes.md "Reach the relay at $SUSPECT for pings."
    head=$(git rev-parse HEAD)
    mkdir -p "$tmp/nostub2" && cp "$HERE/tree-check.sh" "$tmp/nostub2/"
    out=$(bash "$tmp/nostub2/tree-check.sh" "$base" "$head" 2>/dev/null); code=$?
    [ "$code" -eq 2 ] \
      && printf '  ok   a missing scanner fails the check\n' \
      || { printf '  FAIL a missing scanner fails the check: exit %s\n' "$code"; fails=$((fails+1)); }
  }
  r=$(repo) && { cd "$r" || exit 2
    head=$(git rev-parse HEAD)
    mkdir -p raw
    printf 'Reach the relay at %s for pings.\n' "$SUSPECT" > raw/probe.md
    git add raw/probe.md
    mkdir -p "$tmp/diffshim"
    printf '#!/usr/bin/env bash\nif [ "$1" = diff ]; then exit 128; fi\nexec %s "$@"\n' \
      "$(command -v git)" > "$tmp/diffshim/git"
    chmod +x "$tmp/diffshim/git"
    out=$(PATH="$tmp/diffshim:$PATH" bash "$HERE/tree-check.sh" main "$head" 2>/dev/null); code=$?
    [ "$code" -eq 2 ] \
      && printf '  ok   a failed enumeration fails the check\n' \
      || { printf '  FAIL a failed enumeration fails the check: exit %s\n' "$code"; fails=$((fails+1)); }
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

redact() {  # redact <path>: the path with every shaped span removed
  safe=$(bash "$SCRUB" --safe-path "$1" 2>/dev/null) || fail "the scan could not finish"
  printf '%s' "$safe"
}

SEENFILE=""; SCANERR=""; BLOBF=""; ENUMF=""; NAMEF=""
tmp_cleanup() { for t in "$SEENFILE" "$SCANERR" "$BLOBF" "$ENUMF" "$NAMEF"; do [ -n "$t" ] && rm -f -- "$t"; done; }
trap tmp_cleanup EXIT
SEENFILE=$(mktemp) || fail "could not stage the scan"
seen_has() { grep -qF -x -- "$1" "$SEENFILE" 2>/dev/null; }
seen_add() { printf '%s\n' "$1" >> "$SEENFILE"; }
fault_postmaster() {  # fault_postmaster <path> <how>: one fault, path redacted
  note "$(redact "$1"): $2 under .postmaster/ (only .postmaster/project.toml may be committed)"
}
# Every path enumeration is captured to a file with its exit checked: a git
# failure that silently yielded no paths would pass a tree that was never read.
capture() {  # capture <git args...>: one NUL enumeration into $ENUMF
  ENUMF=$(mktemp) || fail "could not stage the scan"
  git "$@" > "$ENUMF" 2>/dev/null || fail "the tree could not be read"
}
release() { rm -f -- "$ENUMF"; ENUMF=""; }

# Committed in the range first: a file added and then deleted before the tip
# is gone from the tip but was still committed. Deletions never fault.
capture log --diff-filter=AMT -z --name-only --pretty=format: "$BASE..$HEAD_REF" -- .postmaster
while IFS= read -r -d '' p; do
  [ -n "$p" ] || continue
  [ "$p" = ".postmaster/project.toml" ] && continue
  seen_has "$p" && continue
  seen_add "$p"
  fault_postmaster "$p" committed
done < "$ENUMF"
release
# Then the tip: tracked files, plus staged additions and changes, never
# staged deletions, which remove a record rather than adding one.
capture ls-files -z -- .postmaster
git diff --cached --name-only -z --diff-filter=ACMRT -- .postmaster >> "$ENUMF" 2>/dev/null \
  || fail "the tree could not be read"
while IFS= read -r -d '' p; do
  [ -n "$p" ] || continue
  [ "$p" = ".postmaster/project.toml" ] && continue
  seen_has "$p" && continue
  seen_add "$p"
  if git cat-file -e "HEAD:$p" 2>/dev/null; then how=committed; else how=staged; fi
  fault_postmaster "$p" "$how"
done < "$ENUMF"
release

scan_blob() {  # scan_blob <ref> <path> <skip|fail>: scan one blob for faults
  local blob out code safe ln
  blob=$(mktemp) || fail "could not stage the scan"
  BLOBF=$blob
  if ! git show "$1" > "$blob" 2>/dev/null; then
    rm -f -- "$blob"; BLOBF=""
    # A committed blob that is gone was added and then deleted: it rests with
    # the scrub, which sees the range's every added line. A staged blob that
    # is gone is a scan that cannot finish.
    if [ "$3" = skip ]; then return 0; else fail "cannot read added file $(redact "$2")"; fi
  fi
  SCANERR=$(mktemp) || fail "could not stage the scan"
  out=$(POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" --files "$blob" 2>"$SCANERR"); code=$?
  cat "$SCANERR" >&2; rm -f -- "$SCANERR"; SCANERR=""
  case $code in 0|1) ;; *) fail "the scan could not finish" ;; esac
  if [ "$code" -eq 1 ]; then
    safe=$(redact "$2")
    while IFS= read -r ln; do
      note "${safe}${ln#$blob}"
      rest=${ln#$blob:}; num=${rest%%:*}; kind=${rest#*: }
      [ "$kind" = marker ] && continue
      bash "$SCRUB" --log-detection "$kind" "$2" "$num" 2>/dev/null \
        || fail "the detections log could not be written"
    done <<<"$out"
  fi
  rm -f -- "$blob"; BLOBF=""
  # The added name publishes too: scan it with marker syntax inert,
  # reported at line 0 like the range scan reports names.
  NAMEF=$(mktemp) || fail "could not stage the scan"
  printf '%s\n' "$2" > "$NAMEF"
  SCANERR=$(mktemp) || fail "could not stage the scan"
  nameout=$(POSTMASTER_DETECTIONS_LOG= bash "$SCRUB" --files-inert "$NAMEF" 2>"$SCANERR"); namecode=$?
  cat "$SCANERR" >&2; rm -f -- "$SCANERR"; SCANERR=""
  rm -f -- "$NAMEF"; NAMEF=""
  case $namecode in 0|1) ;; *) fail "the scan could not finish" ;; esac
  if [ "$namecode" -eq 1 ]; then
    safe=$(redact "$2")
    while IFS= read -r ln; do
      kind=${ln##*: }
      note "${safe}:0: ${kind}"
      bash "$SCRUB" --log-detection "$kind" "$2" 0 2>/dev/null \
        || fail "the detections log could not be written"
    done <<<"$nameout"
  fi
}

# Staged additions are scanned as staged blobs: the worktree copy may already
# differ from what is staged.
capture diff --cached --name-only -z --diff-filter=A -- raw/
while IFS= read -r -d '' p; do
  [ -n "$p" ] || continue
  scan_blob ":$p" "$p" fail
done < "$ENUMF"
release
# Committed additions are scanned as head blobs: the worktree copy may be
# dirty, missing, or ahead of what the range added.
capture diff --name-only -z --diff-filter=A "$BASE" "$HEAD_REF" -- raw/
while IFS= read -r -d '' p; do
  [ -n "$p" ] || continue
  scan_blob "$HEAD_REF:$p" "$p" skip
done < "$ENUMF"
release

if [ -n "$FAULTS" ]; then printf '%s\n' "$FAULTS"; exit 1; fi
exit 0
