#!/usr/bin/env bash
# Resolve the user's workhorse-spec link from the config captured at dispatch.
#
#   spec-review-link.sh <dispatch> <workhorse-worktree>
#   spec-review-link.sh --validate <dispatch>
#   spec-review-link.sh --self-test
#
# The optional config.planning.review_link template in run.json has {path} replaced by the
# absolute path to WORKHORSE-SPEC.md. An empty or missing template prints the path itself.
#
#   exit 0  link or path printed
#   exit 1  usage, unreadable run.json or missing spec
#   exit 2  malformed planning.review_link
set -uo pipefail

render() {  # render <dispatch> <workhorse-worktree>
  python3 - "$1" "$2" <<'PY'
import json, pathlib, sys

dispatch, worktree = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
run_json = dispatch / "run.json"
try:
    record = json.loads(run_json.read_text(encoding="utf-8"))
except FileNotFoundError:
    print("spec-review-link: no run.json at %s" % run_json, file=sys.stderr); sys.exit(1)
except (OSError, ValueError) as e:
    print("spec-review-link: cannot read %s (%s)" % (run_json, e), file=sys.stderr); sys.exit(1)
if not isinstance(record, dict) or not isinstance(record.get("config", {}), dict):
    print("spec-review-link: run.json config must be an object", file=sys.stderr); sys.exit(1)
config = record.get("config", {})
planning = config.get("planning", {})
if not isinstance(planning, dict):
    print("spec-review-link: config.planning must be a table", file=sys.stderr); sys.exit(2)
template = planning.get("review_link", "")
if not isinstance(template, str):
    print("spec-review-link: config.planning.review_link must be a string", file=sys.stderr); sys.exit(2)
try:
    path = (worktree / "WORKHORSE-SPEC.md").resolve(strict=True)
except OSError as e:
    print("spec-review-link: no WORKHORSE-SPEC.md in %s (%s)" % (worktree, e), file=sys.stderr); sys.exit(1)
if not path.is_file():
    print("spec-review-link: no WORKHORSE-SPEC.md in %s" % worktree, file=sys.stderr); sys.exit(1)
if not template:
    print(path)
elif "{path}" not in template:
    print("spec-review-link: config.planning.review_link must contain {path}", file=sys.stderr); sys.exit(2)
else:
    print(template.replace("{path}", str(path)))
PY
}

validate() {  # validate <dispatch>
  python3 - "$1/run.json" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
try:
    record = json.loads(path.read_text(encoding="utf-8"))
except (OSError, ValueError) as e:
    print("spec-review-link: cannot read %s (%s)" % (path, e), file=sys.stderr); sys.exit(1)
if not isinstance(record, dict) or not isinstance(record.get("config", {}), dict):
    print("spec-review-link: run.json config must be an object", file=sys.stderr); sys.exit(1)
planning = record.get("config", {}).get("planning", {})
if not isinstance(planning, dict):
    print("spec-review-link: config.planning must be a table", file=sys.stderr); sys.exit(2)
template = planning.get("review_link", "")
if not isinstance(template, str) or (template and "{path}" not in template):
    print("spec-review-link: config.planning.review_link must be empty or contain {path}", file=sys.stderr); sys.exit(2)
PY
}

case ${1:-} in
  --self-test) ;;
  --validate)
    [ $# -eq 2 ] || { echo "usage: spec-review-link.sh --validate <dispatch>" >&2; exit 1; }
    validate "$2"; exit $? ;;
  "") echo "usage: spec-review-link.sh <dispatch> <workhorse-worktree> | --validate <dispatch> | --self-test" >&2; exit 1 ;;
  -*) echo "usage: spec-review-link.sh <dispatch> <workhorse-worktree> | --validate <dispatch> | --self-test" >&2; exit 1 ;;
  *)
    [ $# -eq 2 ] || { echo "usage: spec-review-link.sh <dispatch> <workhorse-worktree> | --validate <dispatch> | --self-test" >&2; exit 1; }
    render "$1" "$2"; exit $? ;;
esac

tmp=$(mktemp -d) || exit 1
d="$tmp/project/.postmaster/runs/RUN-1"; w="$tmp/project/.worktrees/RUN-1-lane"
cleanup() {
  rm -f -- "$d/run.json" "$w/WORKHORSE-SPEC.md" "$tmp/err"
  rmdir "$d" "$w" "$tmp/project/.postmaster/runs" "$tmp/project/.postmaster" "$tmp/project/.worktrees" "$tmp/project" "$tmp" 2>/dev/null || :
}
trap cleanup EXIT
mkdir -p "$d" "$w"
printf 'approved plan\n' > "$w/WORKHORSE-SPEC.md"
SELF="$0"
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }
has()  { printf '%s' "$1" | grep -qF -- "$2"; }

echo "positive controls"
printf '{"config":{"planning":{"review_link":"https://code.example/open?file={path}"}}}\n' > "$d/run.json"
out=$(render "$d" "$w" 2>"$tmp/err"); rc=$?
expected="https://code.example/open?file=$(cd "$w" && pwd -P)/WORKHORSE-SPEC.md"
[ $rc -eq 0 ] && [ "$out" = "$expected" ] && ok "the recorded template gets the absolute spec path" \
  || fail "the recorded template gets the absolute spec path (exit $rc)" "$out $(cat "$tmp/err")"
printf '{"config":{}}\n' > "$d/run.json"
out=$(render "$d" "$w" 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && [ "$out" = "$(cd "$w" && pwd -P)/WORKHORSE-SPEC.md" ] \
  && ok "a missing template prints the absolute spec path" \
  || fail "a missing template prints the absolute spec path (exit $rc)" "$out $(cat "$tmp/err")"
"$SELF" --validate "$d" >/dev/null 2>"$tmp/err"; rc=$?
[ $rc -eq 0 ] && ok "a run with no template passes config validation" \
  || fail "a run with no template passes config validation (exit $rc)" "$(cat "$tmp/err")"

echo "negative controls"
printf '{"config":{"planning":{"review_link":"https://code.example/open"}}}\n' > "$d/run.json"
out=$(render "$d" "$w" 2>"$tmp/err"); rc=$?
[ $rc -eq 2 ] && [ -z "$out" ] && has "$(cat "$tmp/err")" "must contain {path}" \
  && ok "a template without {path} is refused" \
  || fail "a template without {path} is refused (exit $rc)" "$out $(cat "$tmp/err")"
"$SELF" --validate "$d" >/dev/null 2>"$tmp/err"; rc=$?
[ $rc -eq 2 ] && has "$(cat "$tmp/err")" "must be empty or contain {path}" \
  && ok "a template without {path} is refused before the run starts" \
  || fail "a template without {path} is refused before the run starts (exit $rc)" "$(cat "$tmp/err")"
printf '{"config": [1]}\n' > "$d/run.json"
render "$d" "$w" >/dev/null 2>"$tmp/err"; rc=$?
[ $rc -eq 1 ] && has "$(cat "$tmp/err")" "config must be an object" \
  && ok "a malformed config object is refused" || fail "a malformed config object is refused (exit $rc)" "$(cat "$tmp/err")"
printf '{"config":{}}\n' > "$d/run.json"
rm -- "$w/WORKHORSE-SPEC.md"
render "$d" "$w" >/dev/null 2>"$tmp/err"; rc=$?
[ $rc -eq 1 ] && has "$(cat "$tmp/err")" "no WORKHORSE-SPEC.md" \
  && ok "a missing spec is refused" || fail "a missing spec is refused (exit $rc)" "$(cat "$tmp/err")"
mkdir -- "$w/WORKHORSE-SPEC.md"
render "$d" "$w" >/dev/null 2>"$tmp/err"; rc=$?
[ $rc -eq 1 ] && has "$(cat "$tmp/err")" "no WORKHORSE-SPEC.md" \
  && ok "a directory as the spec is refused" || fail "a directory as the spec is refused (exit $rc)" "$(cat "$tmp/err")"
rmdir -- "$w/WORKHORSE-SPEC.md"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
