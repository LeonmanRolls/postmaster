#!/usr/bin/env bash
# How long each stage of a run took, computed from the run's own action log. Nothing here is
# written by hand: a stage starts at the `stage` line that entered it (scripts/stage.sh writes
# those) and ends at the next one, and the first stage, `dispatched`, starts at the postmaster's
# `dispatch` line.
#
#   run-times.sh <dispatch>      the table, from <dispatch>/actions.jsonl
#   run-times.sh --self-test     known logs give known answers; a log with no stage lines says so
#
# Waiting is the part of a stage when no coachman leg was running: from one leg's `handoff`
# to the next leg's `handoff-accept`. A run whose log has neither shows waiting as "-".
# A terminal stage (done, abandoned) is a moment, not a span. A last stage that is not
# terminal is open, and is measured to the last logged action.
#
#   exit 0  printed
#   exit 1  usage, or the log is missing or unreadable
#   exit 3  the log has no stage changes to time
set -uo pipefail

times() {  # times <dispatch>
  python3 - "$1" <<'PY'
import datetime as dt, json, pathlib, sys

log = pathlib.Path(sys.argv[1]) / "actions.jsonl"
if not log.is_file():
    print("run-times: no action log at %s" % log, file=sys.stderr); sys.exit(1)
events = []
for n, line in enumerate(log.read_text().splitlines(), 1):
    if not line.strip():
        continue
    try:
        e = json.loads(line)
        events.append((dt.datetime.strptime(e["ts"], "%Y-%m-%dT%H:%M:%SZ"), e["action"], e.get("target", "")))
    except (ValueError, KeyError):
        print("run-times: %s line %d is not a log line" % (log, n), file=sys.stderr); sys.exit(1)
if not events:
    print("run-times: %s is empty" % log, file=sys.stderr); sys.exit(1)

TERMINAL = {"done", "abandoned"}
starts = [(t, x) for t, a, x in events if a == "stage"]
dispatch = next((t for t, a, _ in events if a == "dispatch"), None)
if dispatch is not None and (not starts or dispatch <= starts[0][0]):
    starts.insert(0, (dispatch, "dispatched"))
if len(starts) < 2 and not any(a == "stage" for _, a, _ in events):
    print("no stage changes logged in %s" % log); sys.exit(3)
last = events[-1][0]

# leg working spans: each handoff-accept to the next handoff
legs, opened = [], None
for t, a, _ in events:
    if a == "handoff-accept":
        opened = t
    elif a == "handoff" and opened is not None:
        legs.append((opened, t)); opened = None
if opened is not None:
    legs.append((opened, last))
known_legs = any(a in ("handoff", "handoff-accept") for _, a, _ in events)

def working(a, b):
    return sum(max(0, (min(b, y) - max(a, x)).total_seconds()) for x, y in legs)

def fmt(sec):
    sec = int(round(sec))
    h, rem = divmod(sec, 3600); m, s = divmod(rem, 60)
    return "%dh %02dm" % (h, m) if h else ("%dm %02ds" % (m, s) if m else "%ds" % s)

rows, total, waited = [], 0.0, 0.0
for i, (t, stage) in enumerate(starts):
    if stage in TERMINAL:
        rows.append((stage, t, "-", "-")); continue
    end, note = (starts[i + 1][0], "") if i + 1 < len(starts) else (last, " (open)")
    span = (end - t).total_seconds(); total += span
    if known_legs:
        w = span - working(t, end); waited += w; wait = fmt(w)
    else:
        wait = "-"
    rows.append((stage + note, t, fmt(span), wait))

print("%-26s %-21s %-10s %s" % ("stage", "started (UTC)", "took", "waiting"))
for stage, t, took, wait in rows:
    print("%-26s %-21s %-10s %s" % (stage, t.strftime("%Y-%m-%d %H:%M:%S"), took, wait))
print("%-26s %-21s %-10s %s" % ("total", "", fmt(total), fmt(waited) if known_legs else "-"))
PY
}

[ "${1:-}" = "--self-test" ] || { [ $# -eq 1 ] || { echo "usage: run-times.sh <dispatch> | --self-test" >&2; exit 1; }; times "$1"; exit $?; }

# --- self-test ----------------------------------------------------------------------------
tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
line() { printf '{"ts":"2026-01-01T%s:00Z","project":"p","run":"r","actor":"coachman","action":"%s","target":"%s","detail":""}\n' "$1" "$2" "${3:-}"; }
fails=0
check() {  # check <label> <expected exit> [<text the output must contain>...]
  local label=$1 want=$2; shift 2
  out=$(times "$tmp" 2>&1); rc=$?
  local bad=""
  [ "$rc" -eq "$want" ] || bad="exit $rc, wanted $want"
  for text in "$@"; do grep -qF -- "$text" <<<"$out" || bad="${bad:+$bad; }missing: $text"; done
  if [ -z "$bad" ]; then printf '  ok   %s\n' "$label"
  else printf '  FAIL %s: %s\n' "$label" "$bad"; printf '%s\n' "$out" | sed 's/^/         /'; fails=$((fails+1)); fi
}

echo "a full run, two legs, with a wait between them"
{ line 12:00 dispatch r; line 12:01 handoff-accept 1; line 12:02 stage bootstrapped
  line 12:05 stage workhorses-running; line 12:35 stage synthesis; line 12:50 stage checkpoint-1
  line 12:52 handoff 1; line 12:55 handoff-accept 2; line 12:56 stage review
  line 13:10 handoff 2; line 13:10 stage done; } > "$tmp/actions.jsonl"
check "the dispatched stage runs from dispatch to bootstrapped" 0 "dispatched                 2026-01-01 12:00:00   2m 00s     1m 00s"
check "a stage inside one leg has no waiting"                   0 "workhorses-running         2026-01-01 12:05:00   30m 00s    0s"
check "a stage across the leg boundary counts the gap"          0 "checkpoint-1               2026-01-01 12:50:00   6m 00s     3m 00s"
check "a terminal stage is a moment, not a span"                0 "done                       2026-01-01 13:10:00   -          -"
check "the total adds up"                                       0 "total                                            1h 10m     4m 00s"

echo "a dispatch in the same second as the first stage"
{ line 12:00 dispatch r; line 12:00 stage bootstrapped; line 12:03 stage done; } > "$tmp/actions.jsonl"
check "the dispatched row is still shown"                       0 "dispatched                 2026-01-01 12:00:00   0s"

echo "a run still in progress"
{ line 12:00 dispatch r; line 12:02 stage bootstrapped; line 12:09 note x; } > "$tmp/actions.jsonl"
check "the last non-terminal stage is open, to the last action" 0 "bootstrapped (open)        2026-01-01 12:02:00   7m 00s     -"

echo "negative controls"
{ line 12:00 dispatch r; line 12:05 note x; } > "$tmp/actions.jsonl"
check "a log with no stage lines says so, and times nothing"    3 "no stage changes logged"
printf 'not json\n' > "$tmp/actions.jsonl"
check "an unreadable log is refused"                            1 "is not a log line"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
