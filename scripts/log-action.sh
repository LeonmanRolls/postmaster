#!/usr/bin/env bash
# Append one structured action to a run's audit log and to the project's ledger.
#
#   log-action.sh <dispatch-dir> <actor> <action> <target> [detail...]
#   log-action.sh <dispatch-dir> <actor> tool-fault <postmaster-file> --ran <what ran>
#                 --failed <what failed> --error <the error, or none> --diagnosis <why>
#                 --fix <the fix proposed> [--workaround <what was done instead>] [--control <kind>]
#   log-action.sh --self-test
#
#   actor    postmaster | coachman | lane:<name>
#   action   a verb from a fixed set, enforced, so the log is computable:
#            dispatch resume harvest synthesize review-launch review-harvest finding apply
#            escalate rule ticket-check ticket-create ticket-edit ticket-state ticket-comment
#            gate verify merge teardown degrade handoff-accept handoff stage spec-review
#            tool-fault note
#   target   what the action was done to: a lane, a ticket id, a branch, a path, a round
#   detail   free text; everything after the target, joined by spaces. A finding's opens with its
#            class, gating or style, so the style findings can be told apart. A spec-review's
#            opens with the decision, approved, changes or dropped, then the spec commit the
#            user saw, then the user's words where the decision is changes or dropped
#
# A tool-fault is postmaster itself misbehaving: a script, a runbook step or a harness adapter.
# Its target is the postmaster file, relative to the checkout this script is in or absolute,
# and is recorded as its real path relative to that checkout. Its fields are flags, all
# required but --workaround and --control, and the line carries them as a `fault` object, with
# --failed as its detail. A script skills/postmaster/controls.md lists is a control of the kind
# the list gives, whatever --control says; --control gives the kind of a step the list names.
# A fault in a control is recorded as one, and the message says to stop.
#
# Every field is written as JSON that any reader can split on newlines: a control character is
# dropped, bytes that are not UTF-8 are dropped, and a line or paragraph separator is escaped.
#
# Writes one JSON line to <dispatch>/actions.jsonl and the same line, with the run named, to
# <dispatch>/../ledger.jsonl (the project's ledger across runs, under the project's own
# .postmaster/runs/). Both are append-only. Nothing in the flow reads its own narrative back
# to learn from it; it reads these lines.
#
# The run is the dispatch directory's name. The project is the basename of the project root:
# <project>/.postmaster/runs/<TICKET>, so two projects with the same basename keep separate
# ledgers. An older layout, runs/<project>/<TICKET>, is still read as that project.
#
#   exit 0  written to both files
#   exit 1  usage, an action outside the set, a finding with no class, a tool-fault missing a
#           field or naming no postmaster file, or a file could not be appended
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd -P)
TOOL=$(dirname "$HERE")
CONTROLS=$TOOL/skills/postmaster/controls.md
VERBS=" dispatch resume harvest synthesize review-launch review-harvest finding apply escalate rule ticket-check ticket-create ticket-edit ticket-state ticket-comment gate verify merge teardown degrade handoff-accept handoff stage spec-review tool-fault note "

json_str() {  # the inside of a JSON string, in bash alone but for tr and iconv
  local s=$1
  if [[ $s == *[[:cntrl:]]* ]]; then
    s=$(printf '%sx' "$s" | LC_ALL=C tr -d '\001-\010\013\014\016-\037'); s=${s%x}
  fi
  if [[ $s == *[![:ascii:]]* ]] && command -v iconv >/dev/null 2>&1; then
    s=$(printf '%sx' "$s" | iconv -f UTF-8 -t UTF-8 -c 2>/dev/null); s=${s%x}
  fi
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  s=${s//$'\xe2\x80\xa8'/\\u2028}
  s=${s//$'\xe2\x80\xa9'/\\u2029}
  s=${s//$'\xc2\x85'/\\u0085}
  printf '%s' "$s"
}

tool_fault() {  # tool_fault <file> [flags...]; sets TARGET, DETAIL and FAULT, or says why not
  local given=$1 t=$1 ran="" failed="" error="" diagnosis="" fix="" workaround="" control="" kinds f
  shift
  while [ $# -gt 0 ]; do
    [ $# -ge 2 ] || { echo "log-action: $1 needs a value" >&2; return 1; }
    case $1 in
      --ran) ran=$2 ;; --failed) failed=$2 ;; --error) error=$2 ;; --diagnosis) diagnosis=$2 ;;
      --fix) fix=$2 ;; --workaround) workaround=$2 ;; --control) control=$2 ;;
      *) echo "log-action: a tool-fault takes --ran --failed --error --diagnosis --fix [--workaround] [--control], not '$1'" >&2; return 1 ;;
    esac
    shift 2
  done
  for f in ran failed error diagnosis fix; do
    [ -n "${!f//[[:space:]]/}" ] || { echo "log-action: a tool-fault needs --$f (the error may be 'none')" >&2; return 1; }
  done
  case $t in /*) ;; *) t=$TOOL/$t ;; esac
  f=$(cd "$(dirname "$t")" 2>/dev/null && pwd -P) && t=$f/$(basename "$t") || t=""
  case $t in "$TOOL"/*) t=${t#"$TOOL"/} ;; *) t="" ;; esac
  [ -n "$t" ] && [ -f "$TOOL/$t" ] \
    || { echo "log-action: a tool-fault names the postmaster file that misbehaved, in $TOOL; '$given' is not one" >&2; return 1; }
  kinds=$(awk -F'|' '/^[[:space:]]*\|[[:space:]]*`/ { k = $3; gsub(/[[:space:]]/, "", k); if (k != "") print k }' "$CONTROLS" 2>/dev/null | sort -u)
  [ -z "$control" ] || printf '%s\n' "$kinds" | grep -qxF -- "$control" \
    || { echo "log-action: '$control' is not a kind of control in $CONTROLS:" $kinds >&2; return 1; }
  f=$(awk -F'|' -v p="$t" '{ c = $2; gsub(/^[[:space:]]+|[[:space:]]+$/, "", c)
        if (c == "`" p "`" || c == "`<tool>/" p "`") { k = $3; gsub(/[[:space:]]/, "", k); print k; exit } }' "$CONTROLS" 2>/dev/null)
  [ -n "$f" ] && control=$f
  [ -n "$control" ] && echo "log-action: $t is a control ($control): stop the leg and escalate; never work around it" >&2
  TARGET=$t DETAIL=$failed
  FAULT=$(printf ',"fault":{"ran":"%s","failed":"%s","error":"%s","diagnosis":"%s","fix":"%s","workaround":"%s","control":"%s"}' \
    "$(json_str "$ran")" "$(json_str "$failed")" "$(json_str "$error")" "$(json_str "$diagnosis")" \
    "$(json_str "$fix")" "$(json_str "$workaround")" "$(json_str "$control")")
}

log_action() {  # log_action <dispatch> <actor> <action> <target> [detail...]
  local given=$1 dispatch run project ts line
  ACTOR=$2 ACTION=$3 TARGET=$4 FAULT=""
  shift 4
  DETAIL=${*:-}
  case "$VERBS" in *" $ACTION "*) ;; *) echo "log-action: '$ACTION' is not an action in the set:$VERBS" >&2; return 1 ;; esac
  [ "$ACTION" != finding ] || case ${DETAIL%% *} in gating|style) ;;
    *) echo "log-action: a finding's detail opens with its class, gating or style" >&2; return 1 ;; esac
  [ "$ACTION" != spec-review ] || case ${DETAIL%% *} in approved|changes|dropped) ;;
    *) echo "log-action: a spec-review's detail opens with its decision, approved, changes or dropped" >&2; return 1 ;; esac
  if [ "$ACTION" = tool-fault ]; then tool_fault "$TARGET" "$@" || return 1; fi

  dispatch=$(CDPATH= cd -P -- "$given" 2>/dev/null && pwd -P) || { echo "log-action: no such dir: $given" >&2; return 1; }
  run=$(basename "$dispatch")
  parent=$(dirname "$dispatch")
  grand=$(dirname "$parent")
  if [ "$(basename "$parent")" = runs ] && [ "$(basename "$grand")" = .postmaster ]; then
    project=$(basename "$(dirname "$grand")")
  else
    project=$(basename "$parent")
  fi
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  line=$(printf '{"ts":"%s","project":"%s","run":"%s","actor":"%s","action":"%s","target":"%s","detail":"%s"%s}' \
    "$ts" "$(json_str "$project")" "$(json_str "$run")" "$(json_str "$ACTOR")" \
    "$(json_str "$ACTION")" "$(json_str "$TARGET")" "$(json_str "$DETAIL")" "$FAULT")

  printf '%s\n' "$line" >> "$dispatch/actions.jsonl" || { echo "log-action: cannot append to $dispatch/actions.jsonl" >&2; return 1; }
  printf '%s\n' "$line" >> "$dispatch/../ledger.jsonl" || { echo "log-action: cannot append to the project ledger" >&2; return 1; }
}

if [ "${1:-}" != --self-test ]; then
  [ $# -ge 4 ] && [ -n "$1" ] && [ -n "$2" ] && [ -n "$3" ] && [ -n "$4" ] \
    || { echo "usage: log-action.sh <dispatch-dir> <actor> <action> <target> [detail...] | --self-test" >&2; exit 1; }
  log_action "$@"; exit $?
fi

# --- self-test ----------------------------------------------------------------------------
tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" 2>/dev/null' EXIT
d="$tmp/proj/.postmaster/runs/RUN-1"; mkdir -p "$d"
SELF="$HERE/log-action.sh"
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }
lines() { if [ -f "$d/actions.jsonl" ]; then wc -l < "$d/actions.jsonl" | tr -d ' '; else echo 0; fi; }
last() {  # last <label> <python test of the last line, read as e>
  python3 -c 'import json, sys; e = json.loads(open(sys.argv[1], encoding="utf-8").read().split("\n")[-2]); sys.exit(0 if eval(sys.argv[2]) else 1)' \
    "$d/actions.jsonl" "$2" 2>/dev/null && ok "$1" || fail "$1" "$(tail -1 "$d/actions.jsonl")"
}
wrote() {  # wrote <label> <arguments after the dispatch...>: it exits 0 and writes one more line
  local label=$1 before; shift
  before=$(lines)
  "$SELF" "$d" "$@" >/dev/null 2>"$tmp/err"; rc=$?
  [ $rc -eq 0 ] && [ "$(lines)" -eq $((before + 1)) ] && ok "$label" || fail "$label (exit $rc)" "$(cat "$tmp/err")"
}
FIELDS=(--ran "scripts/wait-for-markers.sh <dispatch>/logs 'r1-*.done' 2 60" --failed "returned before every marker was in"
        --error $'exit 0\n\tall 2 markers present, \e[1mone a directory\e[0m' --diagnosis "find counts directories" --fix "count regular files only")
ln -s "$TOOL" "$tmp/link" && : > "$tmp/outside.sh" || exit 1

echo "positive controls"
wrote "an action is written" postmaster note RUN-1 a plain "\"detail\""
cmp -s "$d/actions.jsonl" "$tmp/proj/.postmaster/runs/ledger.jsonl" && ok "as one line in the run's log and the same line in the ledger" \
  || fail "as one line in the run's log and the same line in the ledger"
last "the detail is everything after the target" 'e["detail"] == "a plain \"detail\"" and (e["project"], e["run"]) == ("proj", "RUN-1") and "fault" not in e'
wrote "a tool-fault with every field is written" coachman tool-fault scripts/launch.sh "${FIELDS[@]}" --workaround "launched in the recorded form by hand"
[ ! -s "$tmp/err" ] && ok "and a part that is no control says nothing" || fail "and a part that is no control says nothing" "$(cat "$tmp/err")"
last "its fields are a fault object, with --failed as the detail and the error whole" \
  'e["action"] == "tool-fault" and e["target"] == "scripts/launch.sh" and e["detail"] == e["fault"]["failed"] == "returned before every marker was in" and e["fault"]["error"] == "exit 0\n\tall 2 markers present, [1mone a directory[0m" and e["fault"]["workaround"].startswith("launched") and e["fault"]["control"] == ""'
wrote "a listed script named by its absolute path is written" coachman tool-fault "$TOOL/scripts/log-action.sh" "${FIELDS[@]}" --failed first
last "as a control of its kind, relative to the checkout" 'e["fault"]["failed"] == "first" and e["target"] == "scripts/log-action.sh" and e["fault"]["control"] == "action-log"'
grep -qF "scripts/log-action.sh is a control (action-log): stop the leg" "$tmp/err" && ok "and the message says to stop" || fail "and the message says to stop" "$(cat "$tmp/err")"
wrote "a listed script with another --control is written" coachman tool-fault scripts/log-action.sh "${FIELDS[@]}" --failed second --control gate
last "with the list's kind" 'e["fault"]["failed"] == "second" and e["fault"]["control"] == "action-log"'
wrote "a runbook step with --control is written" coachman tool-fault skills/postmaster/coachman.md "${FIELDS[@]}" --failed third --control wait
last "with the kind --control gives" 'e["fault"]["failed"] == "third" and e["target"] == "skills/postmaster/coachman.md" and e["fault"]["control"] == "wait"'
wrote "another spelling of a listed path is written" coachman tool-fault scripts//./wait-for-markers.sh "${FIELDS[@]}" --failed fourth
last "as that path, and that control" 'e["fault"]["failed"] == "fourth" and e["target"] == "scripts/wait-for-markers.sh" and e["fault"]["control"] == "wait"'
wrote "a path through .. that stays in the checkout is written" coachman tool-fault scripts/../scripts/log-action.sh "${FIELDS[@]}" --failed fifth
last "as the file it reaches" 'e["fault"]["failed"] == "fifth" and e["target"] == "scripts/log-action.sh" and e["fault"]["control"] == "action-log"'
wrote "a path through a link to the checkout is written" coachman tool-fault "$tmp/link/scripts/launch.sh" "${FIELDS[@]}" --failed sixth
last "as the real path" 'e["fault"]["failed"] == "sixth" and e["target"] == "scripts/launch.sh"'
wrote "a style finding is written" coachman finding src/a.ts:12 style P3 r1 style luna reading: a list named map
last "with its class as the first word of its detail" 'e["action"] == "finding" and e["detail"].split()[0] == "style"'
wrote "a gating finding is written" coachman finding src/b.ts:40 gating P1 r1 bug luna execution: an off-by-one
wrote "an approved spec review is written" postmaster spec-review luna "approved abc123"
last "with its decision, then the commit" 'e["action"] == "spec-review" and e["target"] == "luna" and e["detail"] == "approved abc123"'
wrote "a changes spec review is written" postmaster spec-review deepseek "changes def456 narrow the scope to the two named scripts"
last "with the user's words after the commit" 'e["action"] == "spec-review" and e["detail"] == "changes def456 narrow the scope to the two named scripts"'
wrote "a dropped spec review is written" postmaster spec-review luna "dropped abc123 we only need one lane"
last "with the drop decision" 'e["action"] == "spec-review" and e["detail"].split()[0] == "dropped"'
wrote "a detail ending in a newline is written" postmaster note RUN-1 $'kept whole\n'
last "with its newline" 'e["detail"] == "kept whole\n"'
old="$tmp/oldlayout/legacy-proj/RUN-2"; mkdir -p "$old"
"$SELF" "$old" postmaster note RUN-2 old >/dev/null 2>&1 && python3 -c '
import json, sys
e = json.loads(open(sys.argv[1]).read().split("\n")[-2])
sys.exit(0 if (e["project"], e["run"]) == ("legacy-proj", "RUN-2") else 1)' "$old/actions.jsonl" \
  && ok "an older runs/<project>/<TICKET> layout is still read as that project" \
  || fail "an older runs/<project>/<TICKET> layout is still read as that project" "$(cat "$old/actions.jsonl" 2>/dev/null)"
wrote "a line separator and a byte that is not UTF-8 are written" postmaster note RUN-1 $'one\xe2\x80\xa8two \xff three'
last "the separator escaped and the byte dropped" 'e["detail"] == "one two  three"'
python3 -c '
import json, sys
for f in sys.argv[1:]:
    text = open(f, encoding="utf-8").read()
    rows = text.split("\n")[:-1]
    assert len(rows) == len(text.splitlines()), "a raw line separator"
    [json.loads(r) for r in rows]' "$d/actions.jsonl" "$tmp/proj/.postmaster/runs/ledger.jsonl" 2>"$tmp/err" \
  && cmp -s "$d/actions.jsonl" "$tmp/proj/.postmaster/runs/ledger.jsonl" && ok "every line in both files is UTF-8 JSON, one to a line" \
  || fail "every line in both files is UTF-8 JSON, one to a line" "$(cat "$tmp/err")"

echo "negative controls: nothing is written"
refused() {  # refused <label> <the text the message holds> <arguments after the actor...>
  local label=$1 why=$2 before; shift 2
  before=$(lines)
  "$SELF" "$d" coachman "$@" >/dev/null 2>"$tmp/err"; rc=$?
  if [ $rc -eq 1 ] && [ "$(lines)" -eq "$before" ] && grep -qF -- "$why" "$tmp/err"; then ok "$label"
  else fail "$label: wanted exit 1 with \"$why\" and no line, got exit $rc" "$(cat "$tmp/err")"; fi
}
refused "an action outside the set" "is not an action" tool-faults scripts/launch.sh x
refused "an empty target" "usage:" note ""
refused "a finding with no class" "opens with its class, gating or style" finding src/c.ts:7 P2 r1 bug luna reading: no class
refused "a finding whose class is another word" "opens with its class, gating or style" finding src/c.ts:7 advisory P3 r1 style luna reading
refused "a spec-review with no decision" "opens with its decision, approved, changes or dropped" spec-review luna "abc123 looks fine"
refused "a spec-review whose decision is another word" "opens with its decision, approved, changes or dropped" spec-review luna "ok abc123"
refused "a tool-fault with no fix" "needs --fix" tool-fault scripts/launch.sh "${FIELDS[@]:0:8}"
refused "a tool-fault with a blank diagnosis" "needs --diagnosis" tool-fault scripts/launch.sh "${FIELDS[@]}" --diagnosis "  "
refused "a tool-fault as plain words" "a tool-fault takes" tool-fault scripts/launch.sh the wait returned early
refused "a flag with no value" "--workaround needs a value" tool-fault scripts/launch.sh "${FIELDS[@]}" --workaround
refused "a file postmaster does not have" "names the postmaster file" tool-fault src/app.ts "${FIELDS[@]}"
refused "a file outside the checkout" "names the postmaster file" tool-fault "$tmp/outside.sh" "${FIELDS[@]}"
refused "a path that climbs out of the checkout to a file" "names the postmaster file" tool-fault \
  "$(python3 -c 'import os, sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))' "$tmp/outside.sh" "$TOOL")" "${FIELDS[@]}"
refused "an unknown kind of control" "is not a kind of control" tool-fault skills/postmaster/coachman.md "${FIELDS[@]}" --control vibes
refused "two kinds of control in one" "is not a kind of control" tool-fault skills/postmaster/coachman.md "${FIELDS[@]}" --control "gate marker"
"$SELF" "$tmp/nowhere" coachman note x y >/dev/null 2>"$tmp/err"; rc=$?
[ $rc -eq 1 ] && grep -qF "no such dir: $tmp/nowhere" "$tmp/err" && ok "a missing dispatch directory is refused, and named" \
  || fail "a missing dispatch directory is refused, and named (exit $rc)" "$(cat "$tmp/err")"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
