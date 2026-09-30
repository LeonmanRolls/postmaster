#!/usr/bin/env bash
# Decide whether the review loop runs another round, from the round's finding and apply lines.
# The runbook calls this rather than counting findings itself.
#
#   review-decide.sh <dispatch> <round>
#   review-decide.sh --self-test
#
#   round    the round that just finished, a whole number from 1 to 3
#
# Reads <dispatch>/actions.jsonl. A finding is a `finding` line whose detail opens with its class,
# `gating` or `style`, then its severity (P1, P2 or P3), its round (r1, r2, ...) and the rest. An
# apply is an `apply` line whose detail names the finding targets it fixes, as whitespace-separated
# bare targets; it counts for round r when any target it names has a finding of round r. A target's
# latest finding line decides its severity, round and class, so a fix that does not verify closed,
# logged again in the round that checked it, is that round's. Only `gating` findings keep the loop
# going; a `style` finding never does.
#
# The rule (ticket #80, the user's of 2026-09-27): round 2 runs whenever round 1 applied a fix;
# after that, round r+1 runs only when round r logged a verified P1 or P2 finding. The cap of three
# rounds stays as a backstop: when round 3 logs a verified P1 or P2 finding the loop stops and
# escalates with the residue.
#
# Prints one decision line:
#   RUN <next>: <reason>
#   STOP <round>: <reason>
#   CAP 3: <reason>; escalate with residue
#
#   exit 0  the decision is printed
#   exit 1  usage, a round past 3 or below 1, a missing or unreadable action log, a line that is
#           not JSON or not an action object, an action object with no action, a finding whose
#           detail does not open with its class, a finding with no readable severity or round,
#           two findings sharing one target in one round, or an apply naming no target or a
#           target with no finding line
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)

usage() { echo "usage: review-decide.sh <dispatch> <round> | --self-test" >&2; exit 1; }

decide() {  # decide <dispatch> <round>; prints the decision line
  python3 - "$1" "$2" <<'PY'
import json, re, sys

dispatch, round_s = sys.argv[1], sys.argv[2]
try:
    r = int(round_s)
except ValueError:
    sys.exit("review-decide: round is a whole number from 1 to 3: %s" % round_s)
if r < 1 or r > 3:
    sys.exit("review-decide: the loop has a cap of 3 rounds; round %d is past it" % r)

path = dispatch + "/actions.jsonl"
try:
    lines = open(path, encoding="utf-8").read().splitlines()
except OSError as e:
    sys.exit("review-decide: cannot read %s: %s" % (path, e))

latest = {}          # target -> (severity, round, class) from the latest finding line
rounds_seen = {}     # target -> every round from its finding lines, for the apply join
seen_pairs = set()   # (target, round) pairs already logged; a repeat is a fault
applies = []         # (line number, targets) per apply line; checked after the parse
faults = []
for n, line in enumerate(lines, 1):
    if not line.strip():
        continue
    try:
        e = json.loads(line)
    except ValueError:
        faults.append("actions.jsonl line %d is not JSON" % n)
        continue
    if not isinstance(e, dict):
        faults.append("actions.jsonl line %d is not an action object" % n)
        continue
    action = e.get("action")
    if not action:
        faults.append("actions.jsonl line %d has no action" % n)
        continue
    if action == "finding":
        words = str(e.get("detail", "")).split()
        if not words or words[0] not in ("gating", "style"):
            faults.append("actions.jsonl line %d: a finding whose detail opens with %s, not gating or style"
                          % (n, '"%s"' % words[0] if words else "nothing"))
            continue
        cls = words[0]
        sev = words[1] if len(words) > 1 else ""
        rnd = words[2] if len(words) > 2 else ""
        if sev not in ("P1", "P2", "P3"):
            faults.append("actions.jsonl line %d: a finding with severity %s, not P1, P2 or P3" % (n, sev or "none"))
            continue
        m = re.fullmatch(r"r([1-9][0-9]*)", rnd)
        if not m:
            faults.append("actions.jsonl line %d: a finding with round %s, not rN" % (n, rnd or "none"))
            continue
        target, rnd_n = str(e.get("target", "")), int(m.group(1))
        if (target, rnd_n) in seen_pairs:
            faults.append("actions.jsonl line %d: a second finding for %s in round r%d; "
                          "two findings at one place take targets that differ" % (n, target, rnd_n))
            continue
        seen_pairs.add((target, rnd_n))
        rounds_seen.setdefault(target, set()).add(rnd_n)
        latest[target] = (sev, rnd_n, cls)
    elif action == "apply":
        applies.append((n, str(e.get("detail", "")).split()))

for n, targets in applies:
    if not targets:
        faults.append("actions.jsonl line %d: an apply naming no finding target" % n)
    for t in targets:
        if t not in rounds_seen:
            faults.append("actions.jsonl line %d: an apply naming %s, which has no finding line" % (n, t))

if faults:
    sys.exit("review-decide: " + "; ".join(faults))

def findings_of(round_num):
    return [(t, sev, cls) for t, (sev, rnd, cls) in latest.items() if rnd == round_num]

def applied_in(round_num):
    for _, targets in applies:
        for t in targets:
            if round_num in rounds_seen.get(t, ()):
                return True
    return False

def has_p1p2(round_num):
    return any(sev in ("P1", "P2") and cls == "gating" for _, sev, cls in findings_of(round_num))

if r == 1:
    if applied_in(1):
        print("RUN 2: round 1 applied a fix")
    else:
        print("STOP 1: round 1 applied no fixes")
elif r == 2:
    if has_p1p2(2):
        print("RUN 3: round 2 logged a verified P1 or P2 finding")
    else:
        print("STOP 2: round 2 logged no P1 or P2 finding")
else:  # r == 3
    if has_p1p2(3):
        print("CAP 3: round 3 logged a verified P1 or P2 finding; escalate with residue")
    else:
        print("STOP 3: round 3 logged no P1 or P2 finding")
PY
}

if [ "${1:-}" != --self-test ]; then
  [ $# -eq 2 ] && [ -n "$1" ] && [ -n "$2" ] || usage
  [ -d "$1" ] || { echo "review-decide: no dispatch directory at $1" >&2; exit 1; }
  decide "$1" "$2"; exit $?
fi

# --- self-test ----------------------------------------------------------------------------
self=$HERE/$(basename -- "$0")
tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" 2>/dev/null' EXIT
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }
out="" rc=0
run()  { out=$("$@" 2>&1); rc=$?; }
is()   {  # is <label> <exit> <the whole output>
  if [ "$rc" -eq "$2" ] && [ "$out" = "$3" ]; then ok "$1"; else fail "$1: wanted exit $2 and \"$3\", got exit $rc" "$out"; fi
}
has()  {  # has <label> <exit> <text the output must contain>
  # A herestring, not printf piped to grep -q: under pipefail the pipe races with SIGPIPE.
  if [ "$rc" -eq "$2" ] && grep -qF -- "$3" <<<"$out"; then ok "$1"
  else fail "$1: wanted exit $2 with \"$3\", got exit $rc" "$out"; fi
}
logged() {  # logged <dispatch> <action> <target> <detail>
  printf '{"ts":"2026-09-27T00:00:00Z","project":"p","run":"r","actor":"coachman","action":"%s","target":"%s","detail":"%s"}\n' \
    "$2" "$3" "$4" >> "$1/actions.jsonl"
}
new_run() { local d=$tmp/$1; mkdir -p "$d"; : > "$d/actions.jsonl"; echo "$d"; }

echo "positive controls: another round runs"
d=$(new_run r1-apply)
logged "$d" finding src/a.ts:1 "gating P2 r1 bug luna reading: a defect"
logged "$d" apply abc123 "src/a.ts:1"
run "$self" "$d" 1
is "round 1 applied a fix" 0 "RUN 2: round 1 applied a fix"

d=$(new_run r2-p1)
logged "$d" finding src/b.ts:2 "gating P1 r2 bug luna reading: a serious defect"
run "$self" "$d" 2
is "round 2 logged a P1" 0 "RUN 3: round 2 logged a verified P1 or P2 finding"

d=$(new_run r2-p2)
logged "$d" finding src/c.ts:3 "gating P2 r2 security sol reading: a security gap"
run "$self" "$d" 2
is "round 2 logged a P2" 0 "RUN 3: round 2 logged a verified P1 or P2 finding"

echo "positive controls: the cap is reached"
d=$(new_run r3-p1)
logged "$d" finding src/d.ts:4 "gating P1 r3 bug luna reading: still serious"
run "$self" "$d" 3
is "round 3 logged a P1" 0 "CAP 3: round 3 logged a verified P1 or P2 finding; escalate with residue"

d=$(new_run r3-p2)
logged "$d" finding src/e.ts:5 "gating P2 r3 security sol reading: still a gap"
run "$self" "$d" 3
is "round 3 logged a P2" 0 "CAP 3: round 3 logged a verified P1 or P2 finding; escalate with residue"

echo "negative controls: no another round"
d=$(new_run r1-noapply)
logged "$d" finding src/f.ts:6 "style P3 r1 style luna reading: a style note"
run "$self" "$d" 1
is "round 1 applied no fix" 0 "STOP 1: round 1 applied no fixes"

d=$(new_run r2-p3)
logged "$d" finding src/g.ts:7 "gating P3 r2 bug luna reading: a minor defect"
run "$self" "$d" 2
is "round 2 logged no P1 or P2" 0 "STOP 2: round 2 logged no P1 or P2 finding"

d=$(new_run r2-none)
run "$self" "$d" 2
is "round 2 logged no finding" 0 "STOP 2: round 2 logged no P1 or P2 finding"

echo "negative controls: the cap is not reached"
d=$(new_run r3-p3)
logged "$d" finding src/h.ts:7 "gating P3 r3 bug luna reading: only minor defects"
run "$self" "$d" 3
is "round 3 logged no P1 or P2" 0 "STOP 3: round 3 logged no P1 or P2 finding"

d=$(new_run r2-continues)
logged "$d" finding src/i.ts:9 "gating P1 r2 bug luna reading: continues, not the cap"
run "$self" "$d" 2
is "round 2 with a P1 is not the cap" 0 "RUN 3: round 2 logged a verified P1 or P2 finding"

echo "a fix that does not verify closed is the checking round's finding"
d=$(new_run reclosed)
logged "$d" finding src/j.ts:10 "gating P1 r1 bug luna execution: an off-by-one"
logged "$d" apply def456 "src/j.ts:10"
logged "$d" finding src/j.ts:10 "gating P1 r2 bug luna reading: fix did not verify closed"
run "$self" "$d" 2
is "a P1 logged again in the round that checked the fix keeps the loop going" 0 \
  "RUN 3: round 2 logged a verified P1 or P2 finding"
run "$self" "$d" 1
is "round 1 still sees its apply after the fix is logged again" 0 "RUN 2: round 1 applied a fix"

d=$(new_run reclosed-p3)
logged "$d" finding src/k.ts:11 "gating P3 r1 bug luna reading: minor"
logged "$d" apply ghi789 "src/k.ts:11"
logged "$d" finding src/k.ts:11 "gating P3 r2 bug luna reading: fix did not verify closed"
run "$self" "$d" 2
is "a P3 logged again does not keep the loop going" 0 "STOP 2: round 2 logged no P1 or P2 finding"

echo "an apply of one round does not count for another"
d=$(new_run other-round)
logged "$d" finding src/l.ts:12 "gating P2 r1 bug luna reading: fixed in round 1"
logged "$d" apply jkl012 "src/l.ts:12"
logged "$d" finding src/m.ts:13 "gating P3 r2 bug luna reading: nothing applied in round 2"
run "$self" "$d" 1
is "round 1 still sees its own apply" 0 "RUN 2: round 1 applied a fix"

d=$(new_run later-apply)
logged "$d" finding src/n.ts:14 "gating P2 r2 bug luna reading: fixed in round 2"
logged "$d" apply mno345 "src/n.ts:14"
run "$self" "$d" 1
is "an apply of round 2 does not run round 2" 0 "STOP 1: round 1 applied no fixes"

echo "negative controls: style findings never keep the loop going"
d=$(new_run style-p2)
logged "$d" finding src/s1.ts:1 "style P2 r2 style luna reading: a style gap"
run "$self" "$d" 2
is "a style P2 in round 2 stops the loop" 0 "STOP 2: round 2 logged no P1 or P2 finding"

d=$(new_run style-p1-cap)
logged "$d" finding src/s2.ts:2 "style P1 r3 style mimo reading: a serious style gap"
run "$self" "$d" 3
is "a style P1 in round 3 stops, not the cap" 0 "STOP 3: round 3 logged no P1 or P2 finding"

d=$(new_run style-plus-p3)
logged "$d" finding src/s3.ts:3 "gating P3 r2 bug luna reading: minor"
logged "$d" finding src/s4.ts:4 "style P1 r2 style mimo reading: a serious style gap"
run "$self" "$d" 2
is "a gating P3 beside a style P1 stops the loop" 0 "STOP 2: round 2 logged no P1 or P2 finding"

echo "controls for the cap bound"
d=$(new_run past)
run "$self" "$d" 4
has "a round past the cap is refused" 1 "cap of 3"
run "$self" "$d" 0
has "round 0 is refused" 1 "cap of 3"

echo "negative controls: malformed lines fail loudly, each fault named"
d=$(new_run bad-json)
echo 'not json' >> "$d/actions.jsonl"
run "$self" "$d" 2
has "a line that is not JSON is refused" 1 "line 1 is not JSON"

d=$(new_run bad-scalar)
echo '42' >> "$d/actions.jsonl"
run "$self" "$d" 2
has "a line that is not an action object is refused" 1 "line 1 is not an action object"

d=$(new_run no-action)
echo '{"ts":"2026-09-27T00:00:00Z","target":"t","detail":"d"}' >> "$d/actions.jsonl"
run "$self" "$d" 2
has "an action object with no action is refused" 1 "line 1 has no action"

d=$(new_run bad-class)
logged "$d" finding src/t1.ts:1 "P1 r2 bug luna reading: no class first"
run "$self" "$d" 2
has "a finding with no class is refused" 1 'opens with "P1", not gating or style'

d=$(new_run bad-severity)
logged "$d" finding src/t2.ts:2 "gating P9 r2 bug luna reading: no such severity"
run "$self" "$d" 2
has "a finding with a bad severity is refused" 1 "severity P9, not P1, P2 or P3"

d=$(new_run no-severity)
logged "$d" finding src/t3.ts:3 "gating"
run "$self" "$d" 2
has "a finding with no severity is refused" 1 "severity none, not P1, P2 or P3"

d=$(new_run bad-round)
logged "$d" finding src/t4.ts:4 "gating P1 round1 bug luna reading: no such round"
run "$self" "$d" 2
has "a finding with a bad round is refused" 1 "round round1, not rN"

d=$(new_run no-round)
logged "$d" finding src/t5.ts:5 "gating P1"
run "$self" "$d" 2
has "a finding with no round is refused" 1 "round none, not rN"

d=$(new_run dup-target)
logged "$d" finding src/t6.ts:6 "gating P1 r2 bug luna reading: serious"
logged "$d" finding src/t6.ts:6 "gating P3 r2 security sol reading: minor, same target"
run "$self" "$d" 2
has "two findings sharing one target in one round are refused" 1 "a second finding for src/t6.ts:6 in round r2"

d=$(new_run unknown-apply)
logged "$d" finding src/t7.ts:7 "gating P2 r1 bug luna reading: a defect"
logged "$d" apply abc123 "src/nowhere.ts:99"
run "$self" "$d" 1
has "an apply naming an unknown target is refused" 1 "an apply naming src/nowhere.ts:99, which has no finding line"

d=$(new_run empty-apply)
logged "$d" finding src/t8.ts:8 "gating P2 r1 bug luna reading: a defect"
logged "$d" apply abc123 ""
run "$self" "$d" 1
has "an apply naming no target is refused" 1 "an apply naming no finding target"

"$self" "$tmp/nowhere" 1 >/dev/null 2>"$tmp/err"; rc=$?
[ $rc -eq 1 ] && grep -qF "no dispatch directory" "$tmp/err" && ok "a missing dispatch directory is refused" \
  || fail "a missing dispatch directory is refused (exit $rc)" "$(cat "$tmp/err")"

"$self" >/dev/null 2>"$tmp/err"; rc=$?
[ $rc -eq 1 ] && grep -qF "usage:" "$tmp/err" && ok "no arguments is refused" \
  || fail "no arguments is refused (exit $rc)" "$(cat "$tmp/err")"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
