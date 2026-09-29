#!/usr/bin/env bash
# Whether a harness has its own code-review skill. The executable half of harnesses.md's Own
# review skills table for code-review, so that launch.sh, reviewers.sh and setup.sh never each
# carry a copy of the list.
#
#   review-forms.sh has <harness>   exit 0 when the harness has a code-review form, 3 when not
#   review-forms.sh --self-test
#
#   exit 0  has: the harness has a form; --self-test: all controls behaved
#   exit 3  has: the harness has no code-review form
#   exit 1  usage
set -uo pipefail
usage() { echo "usage: review-forms.sh has <harness> | --self-test" >&2; exit 1; }

case ${1:-} in
  has)
    [ $# -eq 2 ] || usage
    case $2 in
      claude|codex|mimo) exit 0 ;;
      *) exit 3 ;;
    esac ;;
  --self-test) ;;
  *) usage ;;
esac

# --- self-test -------------------------------------------------------------------------------
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }
self=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)/$(basename -- "$0")

echo "positive controls"
for h in claude codex mimo; do
  "$self" has "$h" \
    && ok "a $h lane has a code-review form" \
    || fail "a $h lane has a code-review form"
done

echo "negative controls"
for h in pi muse grok agy bash; do
  "$self" has "$h"; rc=$?
  [ $rc -eq 3 ] && ok "a $h lane has no code-review form: exit 3" \
    || fail "a $h lane has no code-review form: exit 3" "got exit $rc"
done
"$self" has >/dev/null 2>&1; rc=$?
[ $rc -eq 1 ] && ok "has with no harness is refused" || fail "has with no harness is refused" "got exit $rc"
"$self" has claude extra >/dev/null 2>&1; rc=$?
[ $rc -eq 1 ] && ok "has with an extra argument is refused" || fail "has with an extra argument is refused" "got exit $rc"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
