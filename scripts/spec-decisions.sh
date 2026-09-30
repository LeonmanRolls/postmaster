#!/usr/bin/env bash
# Own the planning stage's spec decisions: one file per package, one stanza per lane.
#
#   spec-decisions.sh <dispatch> fresh
#   spec-decisions.sh <dispatch> record <lane> <decision> <commit> [<words>...]
#   spec-decisions.sh <dispatch> count
#   spec-decisions.sh --self-test
#
# fresh starts a new package's <dispatch>/spec-decisions.md, so no stanza survives across
# packages. record appends one stanza and logs the spec-review line through
# scripts/log-action.sh as it happens; it refuses a lane the manifest does not name, a
# second stanza for one lane, a decision outside approved|changes|dropped, a missing
# commit, words on an approval, and a changes or dropped with no words. count prints the
# run-wide numbers Spec review step 3 branches on:
#   approved <n>   manifest lanes approved in the manifest or this package, each lane once
#   changes <m>    manifest lanes with a changes stanza in this package
# count never over-counts: a stanza for an unnamed lane, or an approval with a blank
# commit, contributes nothing.
# The stanza is written before the log line, so a failed log never loses a decision, and a
# decisions file this script did not shape is refused rather than miscounted.
#
#   exit 0  done; fresh and record print nothing, count prints the two lines
#   exit 1  usage, no such dispatch, unreadable manifest, missing decisions file
#   exit 2  a refusal: a bad decision, commit or words, a duplicate lane, a malformed stanza
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)

fresh() {  # fresh <dispatch>
  python3 - "$1" <<'PY'
import pathlib, sys
d = pathlib.Path(sys.argv[1])
if not d.is_dir():
    print("spec-decisions: no such dir: %s" % d, file=sys.stderr); sys.exit(1)
try:
    (d / "spec-decisions.md").write_text("", encoding="utf-8")
except OSError as e:
    print("spec-decisions: cannot write %s (%s)" % (d / "spec-decisions.md", e), file=sys.stderr); sys.exit(1)
PY
}

PARSER='
import pathlib, sys

def parse(path):
    entries, cur = [], None
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as e:
        print("spec-decisions: cannot read %s (%s)" % (path, e), file=sys.stderr); sys.exit(1)
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("## "):
            lane = line[3:].strip()
            if not lane:
                print("spec-decisions: malformed stanza header: %s" % raw, file=sys.stderr); sys.exit(2)
            cur = {}
            entries.append((lane, cur))
            continue
        if cur is None or ":" not in line:
            print("spec-decisions: malformed stanza line: %s" % raw, file=sys.stderr); sys.exit(2)
        key, value = line.split(":", 1)
        key, value = key.strip(), value.strip()
        if key not in ("decision", "commit", "words") or key in cur:
            print("spec-decisions: malformed stanza line: %s" % raw, file=sys.stderr); sys.exit(2)
        cur[key] = value
    for lane, e in entries:
        if set(e) != {"decision", "commit", "words"}:
            print("spec-decisions: incomplete stanza for %s" % lane, file=sys.stderr); sys.exit(2)
        if e["decision"] not in ("approved", "changes", "dropped"):
            print("spec-decisions: bad decision for %s" % lane, file=sys.stderr); sys.exit(2)
    return entries
'

record() {  # record <dispatch> <lane> <decision> <commit> [<words>...]
  local d=$1 lane=$2 decision=$3 commit=$4; shift 4
  detail=$(python3 - "$d" "$lane" "$decision" "$commit" "$@" <<PY
import json
$PARSER
d, lane, decision, commit = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
words = " ".join(" ".join(sys.argv[5:]).split())
if not d.is_dir():
    print("spec-decisions: no such dir: %s" % d, file=sys.stderr); sys.exit(1)
if not lane or any(c.isspace() for c in lane):
    print("spec-decisions: a lane is one word", file=sys.stderr); sys.exit(2)
if decision not in ("approved", "changes", "dropped"):
    print("spec-decisions: a decision is approved, changes or dropped", file=sys.stderr); sys.exit(2)
if not commit or any(c.isspace() for c in commit):
    print("spec-decisions: a commit is one word", file=sys.stderr); sys.exit(2)
if decision == "approved":
    if words:
        print("spec-decisions: an approval carries no words", file=sys.stderr); sys.exit(2)
    detail = "approved %s" % commit
else:
    if not words:
        print("spec-decisions: a %s carries the user's words" % decision, file=sys.stderr); sys.exit(2)
    detail = "%s %s %s" % (decision, commit, words)
f = d / "spec-decisions.md"
if not f.is_file():
    print("spec-decisions: no decisions file: run fresh first", file=sys.stderr); sys.exit(1)
try:
    manifest = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
except (OSError, ValueError) as e:
    print("spec-decisions: cannot read %s (%s)" % (d / "manifest.json", e), file=sys.stderr); sys.exit(1)
lanes = manifest.get("lanes", {})
if not isinstance(lanes, dict):
    print("spec-decisions: manifest lanes must be an object", file=sys.stderr); sys.exit(1)
if lane not in lanes:
    print("spec-decisions: %s is not a lane in the manifest" % lane, file=sys.stderr); sys.exit(2)
if any(l == lane for l, _ in parse(f)):
    print("spec-decisions: %s is already decided in this package" % lane, file=sys.stderr); sys.exit(2)
try:
    with f.open("a", encoding="utf-8") as fh:
        fh.write("## %s\ndecision: %s\ncommit: %s\nwords: %s\n\n" % (lane, decision, commit, words))
except OSError as e:
    print("spec-decisions: cannot write %s (%s)" % (f, e), file=sys.stderr); sys.exit(1)
print(detail)
PY
  ) || exit $?
  "$HERE/log-action.sh" "$d" postmaster spec-review "$lane" "$detail" || {
    echo "spec-decisions: stanza kept but the log line failed; log it by hand" >&2; exit 1
  }
}

count() {  # count <dispatch>
  python3 - "$1" <<PY
import json
$PARSER
d = pathlib.Path(sys.argv[1])
if not d.is_dir():
    print("spec-decisions: no such dir: %s" % d, file=sys.stderr); sys.exit(1)
try:
    manifest = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
except (OSError, ValueError) as e:
    print("spec-decisions: cannot read %s (%s)" % (d / "manifest.json", e), file=sys.stderr); sys.exit(1)
lanes = manifest.get("lanes", {})
if not isinstance(lanes, dict):
    print("spec-decisions: manifest lanes must be an object", file=sys.stderr); sys.exit(1)
approved = {lane for lane, info in lanes.items()
            if isinstance(info, dict) and info.get("outcome") == "approved"}
f = d / "spec-decisions.md"
if not f.is_file():
    print("spec-decisions: no decisions file: run fresh first", file=sys.stderr); sys.exit(1)
entries = parse(f)
named = set(lanes)
changed = set()
for lane, e in entries:
    if lane not in named:
        continue
    if e["decision"] == "approved" and e["commit"]:
        approved.add(lane)
    if e["decision"] == "changes":
        changed.add(lane)
print("approved %d" % len(approved))
print("changes %d" % len(changed))
PY
}

usage() {
  echo "usage: spec-decisions.sh <dispatch> fresh|record|count | --self-test" >&2
  echo "       spec-decisions.sh <dispatch> record <lane> <decision> <commit> [<words>...]" >&2
  exit 1
}
case ${1:-} in
  --self-test) ;;
  ""|-*) usage ;;
  *)
    [ $# -ge 2 ] || usage
    d=$1 verb=$2; shift 2
    case $verb in
      fresh)  [ $# -eq 0 ] || usage; fresh "$d"; exit $? ;;
      record) [ $# -ge 3 ] || usage; record "$d" "$@"; exit $? ;;
      count)  [ $# -eq 0 ] || usage; count "$d"; exit $? ;;
      *) usage ;;
    esac ;;
esac

tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
d="$tmp/project/.postmaster/runs/RUN-1"; mkdir -p "$d"
SELF="$0"
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }
# Checks read files, never a printf|grep pipe, so no control can flake on SIGPIPE.
manifest() { printf '{"lanes": {%s}}\n' "$1" > "$d/manifest.json"; }
stanzas() { grep -c '^## ' "$d/spec-decisions.md"; }
logged() { tail -1 "$d/actions.jsonl"; }

echo "positive controls"
"$SELF" "$d" fresh >/dev/null 2>"$tmp/err"; rc=$?
[ $rc -eq 0 ] && [ -f "$d/spec-decisions.md" ] && [ ! -s "$d/spec-decisions.md" ] \
  && ok "fresh starts an empty decisions file" || fail "fresh starts an empty decisions file (exit $rc)" "$(cat "$tmp/err")"
manifest '"alpha": {}'
"$SELF" "$d" record alpha approved abc123 >/dev/null 2>"$tmp/err"; rc=$?
logged > "$tmp/last"
[ $rc -eq 0 ] && [ "$(stanzas)" -eq 1 ] && grep -qF '"detail":"approved abc123"' "$tmp/last" \
  && ok "record writes the stanza and logs the spec-review line" \
  || fail "record writes the stanza and logs the spec-review line (exit $rc)" "$(cat "$tmp/err")"
"$SELF" "$d" fresh >/dev/null 2>&1
[ ! -s "$d/spec-decisions.md" ] \
  && ok "fresh truncates a decided file" || fail "fresh truncates a decided file"
manifest '"alpha": {"outcome": "approved"}, "beta": {}'
"$SELF" "$d" fresh >/dev/null 2>&1
"$SELF" "$d" record beta approved def456 >/dev/null 2>"$tmp/err"; rc=$?
out=$("$SELF" "$d" count 2>"$tmp/err"); crc=$?
[ $rc -eq 0 ] && [ $crc -eq 0 ] && [ "$out" = "approved 2
changes 0" ] && [ "$(grep -c 'decision: approved' "$d/spec-decisions.md")" -eq 1 ] \
  && ok "package 1 approves A and changes B, package 2 approves B: two approvals where the file alone reads one" \
  || fail "package 1 approves A and changes B, package 2 approves B: two approvals where the file alone reads one (exit $rc/$crc)" "$out $(cat "$tmp/err")"
manifest '"alpha": {"outcome": "approved"}, "beta": {}'
"$SELF" "$d" fresh >/dev/null 2>&1
"$SELF" "$d" record beta dropped def456 "we only need one lane" >/dev/null 2>"$tmp/err"; rc=$?
out=$("$SELF" "$d" count 2>"$tmp/err"); crc=$?
[ $rc -eq 0 ] && [ $crc -eq 0 ] && [ "$out" = "approved 1
changes 0" ] \
  && ok "one approval and one drop across two packages reads as the under-two path" \
  || fail "one approval and one drop across two packages reads as the under-two path (exit $rc/$crc)" "$out $(cat "$tmp/err")"
manifest '"alpha": {}, "beta": {}'
"$SELF" "$d" fresh >/dev/null 2>&1
"$SELF" "$d" record alpha approved abc123 >/dev/null 2>&1
"$SELF" "$d" record beta changes def456 narrow the scope >/dev/null 2>"$tmp/err"; rc=$?
out=$("$SELF" "$d" count 2>"$tmp/err"); crc=$?
logged > "$tmp/last"
[ $rc -eq 0 ] && [ $crc -eq 0 ] && [ "$out" = "approved 1
changes 1" ] && grep -qF '"detail":"changes def456 narrow the scope"' "$tmp/last" \
  && ok "an approval and a changes read as one approval with one outstanding" \
  || fail "an approval and a changes read as one approval with one outstanding (exit $rc/$crc)" "$out $(cat "$tmp/err")"
manifest '"alpha": {"outcome": "approved"}'
"$SELF" "$d" fresh >/dev/null 2>&1
"$SELF" "$d" record alpha approved abc123 >/dev/null 2>&1
out=$("$SELF" "$d" count 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && [ "$out" = "approved 1
changes 0" ] \
  && ok "a lane approved in both places counts once" \
  || fail "a lane approved in both places counts once (exit $rc)" "$out $(cat "$tmp/err")"
manifest '"alpha": {}, "beta": {}'
"$SELF" "$d" fresh >/dev/null 2>&1
"$SELF" "$d" record alpha approved abc123 >/dev/null 2>&1
"$SELF" "$d" record beta2 approved def456 >/dev/null 2>"$tmp/typo-err"; rc=$?
out=$("$SELF" "$d" count 2>"$tmp/err"); crc=$?
[ $rc -eq 2 ] && grep -qF "not a lane in the manifest" "$tmp/typo-err" \
  && [ $crc -eq 0 ] && [ "$out" = "approved 1
changes 0" ] \
  && ok "a mistyped lane is refused, and the typo scenario reads one approval" \
  || fail "a mistyped lane is refused, and the typo scenario reads one approval (exit $rc/$crc)" "$out $(cat "$tmp/err")"
manifest '"alpha": {}'
printf '## alpha\ndecision: approved\ncommit: abc123\nwords: \n\n## alpha\ndecision: changes\ncommit: def456\nwords: narrower\n\n' > "$d/spec-decisions.md"
out=$("$SELF" "$d" count 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && [ "$out" = "approved 1
changes 1" ] \
  && ok "a duplicate stanza for one lane counts once" \
  || fail "a duplicate stanza for one lane counts once (exit $rc)" "$out $(cat "$tmp/err")"
manifest '"alpha": {}, "beta": {}'
printf '## alpha\ndecision: approved\ncommit: \nwords: \n\n## beta\ndecision: approved\ncommit: def456\nwords: \n\n' > "$d/spec-decisions.md"
out=$("$SELF" "$d" count 2>"$tmp/err"); rc=$?
[ $rc -eq 0 ] && [ "$out" = "approved 1
changes 0" ] \
  && ok "an approved stanza with a blank commit contributes nothing" \
  || fail "an approved stanza with a blank commit contributes nothing (exit $rc)" "$out $(cat "$tmp/err")"

echo "negative controls"
manifest '"beta": {}'
"$SELF" "$d" fresh >/dev/null 2>&1
before=$(stanzas); lines=$(wc -l < "$d/actions.jsonl")
"$SELF" "$d" record alpha ok abc123 >/dev/null 2>"$tmp/err"; rc=$?
[ $rc -eq 2 ] && [ "$(stanzas)" -eq "$before" ] && [ "$(wc -l < "$d/actions.jsonl")" -eq "$lines" ] \
  && grep -qF "a decision is approved, changes or dropped" "$tmp/err" \
  && ok "a decision outside the triple is refused, and nothing is written" \
  || fail "a decision outside the triple is refused, and nothing is written (exit $rc)" "$(cat "$tmp/err")"
"$SELF" "$d" record beta changes def456 >/dev/null 2>"$tmp/err"; rc=$?
[ $rc -eq 2 ] && grep -qF "carries the user's words" "$tmp/err" \
  && ok "a changes with no words is refused" \
  || fail "a changes with no words is refused (exit $rc)" "$(cat "$tmp/err")"
"$SELF" "$d" record beta approved def456 nice work >/dev/null 2>"$tmp/err"; rc=$?
[ $rc -eq 2 ] && grep -qF "carries no words" "$tmp/err" \
  && ok "an approval with words is refused" \
  || fail "an approval with words is refused (exit $rc)" "$(cat "$tmp/err")"
"$SELF" "$d" record beta approved >/dev/null 2>"$tmp/err"; rc=$?
[ $rc -eq 1 ] && grep -qF "usage:" "$tmp/err" \
  && ok "a missing commit is a usage error" \
  || fail "a missing commit is a usage error (exit $rc)" "$(cat "$tmp/err")"
"$SELF" "$d" record beta approved def456 >/dev/null 2>&1
"$SELF" "$d" record beta dropped def456 out >/dev/null 2>"$tmp/err"; rc=$?
[ $rc -eq 2 ] && [ "$(stanzas)" -eq 1 ] && grep -qF "already decided" "$tmp/err" \
  && ok "a second stanza for one lane is refused" \
  || fail "a second stanza for one lane is refused (exit $rc)" "$(cat "$tmp/err")"
rm -- "$d/spec-decisions.md"
"$SELF" "$d" record beta approved def456 >/dev/null 2>"$tmp/err"; rc=$?
[ $rc -eq 1 ] && grep -qF "run fresh first" "$tmp/err" \
  && ok "a record with no package file is refused" \
  || fail "a record with no package file is refused (exit $rc)" "$(cat "$tmp/err")"
"$SELF" "$d" count >/dev/null 2>"$tmp/err"; rc=$?
[ $rc -eq 1 ] && grep -qF "run fresh first" "$tmp/err" \
  && ok "a count with no package file is refused" \
  || fail "a count with no package file is refused (exit $rc)" "$(cat "$tmp/err")"
printf '## beta\ndecision: approved\n' > "$d/spec-decisions.md"
"$SELF" "$d" count >/dev/null 2>"$tmp/err"; rc=$?
[ $rc -eq 2 ] && grep -qF "incomplete stanza" "$tmp/err" \
  && ok "a hand-mangled stanza is refused, not miscounted" \
  || fail "a hand-mangled stanza is refused, not miscounted (exit $rc)" "$(cat "$tmp/err")"
rm -- "$d/manifest.json"
"$SELF" "$d" count >/dev/null 2>"$tmp/err"; rc=$?
[ $rc -eq 1 ] && grep -qF "cannot read" "$tmp/err" \
  && ok "a count with no manifest is refused" \
  || fail "a count with no manifest is refused (exit $rc)" "$(cat "$tmp/err")"
"$SELF" "$tmp/nowhere" count >/dev/null 2>"$tmp/err"; rc=$?
[ $rc -eq 1 ] && grep -qF "no such dir" "$tmp/err" \
  && ok "a dispatch that does not exist is refused" \
  || fail "a dispatch that does not exist is refused (exit $rc)" "$(cat "$tmp/err")"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
