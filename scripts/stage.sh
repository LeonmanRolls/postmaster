#!/usr/bin/env bash
# Move a run to a stage. This is the one way a run's stage changes, so every change is logged,
# and the run's timings (scripts/run-times.sh) are computed from those log lines rather than
# written by hand.
#
#   stage.sh <dispatch> <stage> [actor]   actor defaults to coachman
#   stage.sh --list                       the stages, in order
#   stage.sh --self-test
#
# It logs a `stage` action naming the stage left and how long it lasted, changes only the
# manifest's `stage` field, and appends the same line to run-log.md. Setting the stage a run is
# already in does nothing, so a resumed or remounted leg can set it again safely. Setting a
# terminal stage (done, abandoned) also appends the run's full stage timings to run-log.md.
# Only the postmaster sets a terminal stage, or moves a run out of one: it closes a run after
# the last leg, and abandons one on the user's word. A run is at most two legs: the last one
# carries it to `shipping` with the ship card, and the postmaster sets `shipped` after the
# merge and `done` when it closes. `review` is entered only by a run with a review leg. A
# run dispatched before this change keeps its three legs and the stages they enter. The actor
# is the caller's own word, so this holds a coachman to its runbook; it cannot stop a process
# that names itself the postmaster.
#
#   exit 0  the stage was set, or already was
#   exit 1  usage, no manifest, an unreadable manifest, or the log could not be written
#   exit 2  not one of the stages
#   exit 3  the run is done or abandoned, and only the postmaster moves it on
#   exit 4  a terminal stage set by any actor but the postmaster
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
STAGES="dispatched bootstrapped workhorses-running synthesis checkpoint-1 review shipping shipped done abandoned"

set_stage() {  # set_stage <dispatch> <stage> <actor>
  local d=$1 new=$2 actor=$3
  case " $STAGES " in *" $new "*) ;; *) echo "stage: '$new' is not a stage; one of: $STAGES" >&2; return 2 ;; esac
  case $new in
    done|abandoned) [ "$actor" = postmaster ] || { echo "stage: only the postmaster sets $new" >&2; return 4; } ;;
  esac
  [ -f "$d/manifest.json" ] || { echo "stage: no manifest at $d/manifest.json" >&2; return 1; }
  local plan
  plan=$(python3 - "$d" "$new" "$actor" <<'PY'
import datetime as dt, json, pathlib, sys
d, new, actor = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
try:
    old = json.loads((d / "manifest.json").read_text()).get("stage")
except ValueError:
    print("unreadable"); sys.exit(0)
if old == new:
    print("same"); sys.exit(0)
if old in ("done", "abandoned") and actor != "postmaster":
    print("final\t%s" % old); sys.exit(0)
since = None                                  # when the stage being left was entered
log = d / "actions.jsonl"
for line in (log.read_text().splitlines() if log.exists() else []):
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if (e.get("action") == "stage" and e.get("target") == old) or (e.get("action") == "dispatch" and since is None):
        since = e["ts"]
took = ""
if since:
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0, tzinfo=None)
    sec = int((now - dt.datetime.strptime(since, "%Y-%m-%dT%H:%M:%SZ")).total_seconds())
    h, rem = divmod(max(sec, 0), 3600); m, s = divmod(rem, 60)
    took = " after %s" % ("%dh %02dm" % (h, m) if h else ("%dm %02ds" % (m, s) if m else "%ds" % s))
print("change\t%s\t%s" % (old or "none", took))
PY
  ) || { echo "stage: could not read $d" >&2; return 1; }
  case $plan in
    unreadable) echo "stage: $d/manifest.json does not parse" >&2; return 1 ;;
    same) echo "stage: already $new"; return 0 ;;
    final*) echo "stage: the run is $(printf '%s' "$plan" | cut -f2); only the postmaster moves it on" >&2; return 3 ;;
  esac
  local old took
  old=$(printf '%s' "$plan" | cut -f2); took=$(printf '%s' "$plan" | cut -f3)
  # The log line first: the log is what the run's timings are computed from.
  "$HERE/log-action.sh" "$d" "$actor" stage "$new" "from $old$took" || { echo "stage: could not log the change" >&2; return 1; }
  python3 - "$d/manifest.json" "$new" <<'PY' || { echo "stage: logged, but could not write the manifest" >&2; return 1; }
import json, os, sys, tempfile
path, new = sys.argv[1], sys.argv[2]
m = json.load(open(path)); m["stage"] = new
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path)); os.close(fd)
with open(tmp, "w") as f:
    json.dump(m, f, indent=2); f.write("\n")
os.replace(tmp, path)
PY
  "$HERE/run-log.sh" "$d" "stage $new, from $old$took"
  case $new in
    done|abandoned)
      { printf '\nStage timings, from actions.jsonl:\n\n```\n'; "$HERE/run-times.sh" "$d"; printf '```\n'; } >> "$d/run-log.md" ;;
  esac
  echo "stage: $old -> $new$took"
}

case ${1:-} in
  --list) printf '%s\n' $STAGES; exit 0 ;;
  --self-test) ;;
  ""|-*) echo "usage: stage.sh <dispatch> <stage> [actor] | --list | --self-test" >&2; exit 1 ;;
  *) [ $# -ge 2 ] || { echo "usage: stage.sh <dispatch> <stage> [actor]" >&2; exit 1; }
     set_stage "$1" "$2" "${3:-coachman}"; exit $? ;;
esac

# --- self-test ----------------------------------------------------------------------------
tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
d="$tmp/project/RUN-1"; mkdir -p "$d"
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; fails=$((fails+1)); }
fresh() {
  printf '{"stage": "dispatched", "leg": 1, "base": "abc123", "lanes": {"luna": {"outcome": "running"}}, "coachman": {"legs": {}}}\n' > "$d/manifest.json"
  : > "$d/actions.jsonl"; : > "$d/run-log.md"
  "$HERE/log-action.sh" "$d" postmaster dispatch RUN-1 "test" >/dev/null
}
count() { grep -c "\"action\":\"stage\"" "$d/actions.jsonl"; }

echo "positive controls"
fresh; set_stage "$d" bootstrapped coachman >/dev/null; rc=$?
[ $rc -eq 0 ] && [ "$(count)" -eq 1 ] && ok "a change logs exactly one stage line" || fail "a change logs exactly one stage line (exit $rc, lines $(count))"
python3 -c "import json,sys; m=json.load(open('$d/manifest.json')); sys.exit(0 if m=={'stage':'bootstrapped','leg':1,'base':'abc123','lanes':{'luna':{'outcome':'running'}},'coachman':{'legs':{}}} else 1)" \
  && ok "only the manifest's stage field changes" || fail "only the manifest's stage field changes"
grep -q 'stage bootstrapped, from dispatched after' "$d/run-log.md" && ok "run-log.md records the change and how long the last stage took" \
  || fail "run-log.md records the change and how long the last stage took"
set_stage "$d" done postmaster >/dev/null
grep -q 'Stage timings, from actions.jsonl' "$d/run-log.md" && grep -q '^bootstrapped ' "$d/run-log.md" \
  && ok "the postmaster's terminal stage appends the run's timings" || fail "the postmaster's terminal stage appends the run's timings"
fresh; set_stage "$d" abandoned postmaster >/dev/null; rc=$?
[ $rc -eq 0 ] && [ "$(count)" -eq 1 ] && grep -q '"stage": "abandoned"' "$d/manifest.json" \
  && ok "the postmaster abandons a run" || fail "the postmaster abandons a run (exit $rc, lines $(count))"
fresh; set_stage "$d" review coachman >/dev/null; rc=$?
[ $rc -eq 0 ] && [ "$(count)" -eq 1 ] && grep -q '"stage": "review"' "$d/manifest.json" \
  && ok "review is one stage" || fail "review is one stage (exit $rc, lines $(count))"

echo "negative controls"
fresh; set_stage "$d" bootstrapped coachman >/dev/null; set_stage "$d" bootstrapped coachman >/dev/null; rc=$?
[ $rc -eq 0 ] && [ "$(count)" -eq 1 ] && ok "setting the same stage again logs nothing" || fail "setting the same stage again logs nothing (lines $(count))"
fresh; cp "$d/manifest.json" "$tmp/before.json"; set_stage "$d" reviewing coachman >/dev/null 2>&1; rc=$?
[ $rc -eq 2 ] && [ "$(count)" -eq 0 ] && cmp -s "$d/manifest.json" "$tmp/before.json" \
  && ok "an unknown stage is refused, and nothing changes" || fail "an unknown stage is refused, and nothing changes (exit $rc)"
for old in review-style review-bug review-security; do
  fresh; cp "$d/manifest.json" "$tmp/before.json"; set_stage "$d" "$old" coachman >/dev/null 2>&1; rc=$?
  [ $rc -eq 2 ] && [ "$(count)" -eq 0 ] && cmp -s "$d/manifest.json" "$tmp/before.json" \
    && ok "$old is refused, and nothing changes" || fail "$old is refused, and nothing changes (exit $rc)"
done
for t in done abandoned; do
  fresh; cp "$d/manifest.json" "$tmp/before.json"; set_stage "$d" "$t" coachman >/dev/null 2>&1; rc=$?
  [ $rc -eq 4 ] && [ "$(count)" -eq 0 ] && cmp -s "$d/manifest.json" "$tmp/before.json" \
    && ok "$t from the coachman is refused, and nothing changes" || fail "$t from the coachman is refused, and nothing changes (exit $rc)"
done
fresh; set_stage "$d" abandoned postmaster >/dev/null; cp "$d/manifest.json" "$tmp/before.json"
set_stage "$d" synthesis coachman >/dev/null 2>&1; rc=$?
[ $rc -eq 3 ] && [ "$(count)" -eq 1 ] && cmp -s "$d/manifest.json" "$tmp/before.json" \
  && ok "the coachman cannot move a run out of abandoned" || fail "the coachman cannot move a run out of abandoned (exit $rc)"
rm -- "$d/manifest.json"; set_stage "$d" bootstrapped coachman >/dev/null 2>&1; rc=$?
[ $rc -eq 1 ] && ok "no manifest is refused" || fail "no manifest is refused (exit $rc)"

echo "the stages a leg count walks"
# Two legs: synthesis through review to shipping, then the postmaster's shipped and done.
fresh
set_stage "$d" bootstrapped coachman >/dev/null && set_stage "$d" workhorses-running coachman >/dev/null \
  && set_stage "$d" synthesis coachman >/dev/null && set_stage "$d" checkpoint-1 coachman >/dev/null \
  && set_stage "$d" review coachman >/dev/null && set_stage "$d" shipping coachman >/dev/null \
  && set_stage "$d" shipped postmaster >/dev/null && set_stage "$d" done postmaster >/dev/null
stages=$(grep '"action":"stage"' "$d/actions.jsonl" | python3 -c 'import json,sys; print(" ".join(json.loads(l)["target"] for l in sys.stdin))')
[ "$stages" = "bootstrapped workhorses-running synthesis checkpoint-1 review shipping shipped done" ] \
  && ok "a two-leg run walks every stage to done" || fail "a two-leg run walks every stage to done" "$stages"
# One leg: no review; the synthesis leg carries the card, the postmaster closes.
fresh
set_stage "$d" bootstrapped coachman >/dev/null && set_stage "$d" workhorses-running coachman >/dev/null \
  && set_stage "$d" synthesis coachman >/dev/null && set_stage "$d" checkpoint-1 coachman >/dev/null \
  && set_stage "$d" shipping coachman >/dev/null && set_stage "$d" shipped postmaster >/dev/null \
  && set_stage "$d" done postmaster >/dev/null
stages=$(grep '"action":"stage"' "$d/actions.jsonl" | python3 -c 'import json,sys; print(" ".join(json.loads(l)["target"] for l in sys.stdin))')
[ "$stages" = "bootstrapped workhorses-running synthesis checkpoint-1 shipping shipped done" ] \
  && ok "a one-leg run skips review and still reaches done" || fail "a one-leg run skips review and still reaches done" "$stages"
# Three legs, dispatched before this change: the same stages, entered as before.
fresh
set_stage "$d" bootstrapped coachman >/dev/null && set_stage "$d" workhorses-running coachman >/dev/null \
  && set_stage "$d" synthesis coachman >/dev/null && set_stage "$d" checkpoint-1 coachman >/dev/null \
  && set_stage "$d" review coachman >/dev/null && set_stage "$d" shipping coachman >/dev/null \
  && set_stage "$d" shipped coachman >/dev/null && set_stage "$d" done postmaster >/dev/null
stages=$(grep '"action":"stage"' "$d/actions.jsonl" | python3 -c 'import json,sys; print(" ".join(json.loads(l)["target"] for l in sys.stdin))')
[ "$stages" = "bootstrapped workhorses-running synthesis checkpoint-1 review shipping shipped done" ] \
  && ok "a three-leg run keeps the stages it always walked" || fail "a three-leg run keeps the stages it always walked" "$stages"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
