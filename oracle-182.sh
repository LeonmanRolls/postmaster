#!/usr/bin/env bash
# Oracle for #182: blind acceptance tests at the ticket's own interface.
#
# Written by the leg-1 coachman before reading any lane's spec or diff,
# committed as the first commit on the ticket branch. It drives the commands
# the ticket names (`fixture.sh new`, `run-meta.sh`, `launch.sh form` and
# `launch.sh review`) end to end, with stub harnesses on PATH, and never a
# function shape or a file name the lanes chose: the fact `fixture.sh new`
# leaves in the copy is exercised only through what `run-meta.sh` records for
# the copy, and the review forms only through the argv they would run.
#
#   oracle-182.sh   run from the repo root; exit 0 when the worktree meets the
#                   ticket, 1 otherwise, one line per probe.
#
# Assumptions, stated so a red probe can be blamed correctly:
# A1. `run-meta.sh <dispatch> <repo>` reads the repo for the fixture fact and
#     records the lowered config in run.json; `launch.sh` with --run reads the
#     recorded config. If both lanes fail every probe on this alone (the
#     lowering lives somewhere `run-meta.sh` never touches), the oracle is
#     wrong, not the lanes.
# A2. The unknown-harness warning names the harness on stderr. Any wording
#     does, as long as the harness is named where the dispatcher reads it.
# A3. Every team role with a harness and an effort (coachman,
#     coachman_fallback, postmaster) is a "role" under AC2 and is lowered:
#     the ticket's Notes say the fixture dispatch stops writing its
#     lowest-effort copy once this merges, so run-meta.sh must lower
#     everything that copy lowered. coachman_legs entries are not configured
#     here and not probed.
# A4. A review that still names the old top level in its effort flag does not
#     run "at the recorded effort": harnesses.md says each form names its
#     level on every launch, so the recorded level replaces the top one where
#     the top one stood (claude's /code-review prompt word and --effort flag,
#     codex's -c flag, mimo's --variant flag).
# A5. AC4's mechanism is the waybill instruction in postmaster.md Stage B: the
#     team comes from run.json's recorded config. The waybill itself is
#     model-written prose, so no headless probe can check what a future
#     postmaster writes; P13 only pins the instruction, and AC4 is verified at
#     synthesis by reading.
# AC1's mechanism (which fact, and where in the copy) is likewise verified at
# synthesis by reading plus targeted execution. These probes prove the
# checkable half: a fixture copy records lowest however it is named or placed,
# and no plain repo does, however fixture-sounding its name.
set -uo pipefail

HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
[ -f "$HERE/scripts/launch.sh" ] || { echo "oracle: run from the repo root: scripts/launch.sh not found" >&2; exit 1; }
need() { for t in "$@"; do command -v "$t" >/dev/null 2>&1 || { echo "oracle: $t is not on PATH" >&2; exit 1; }; done; }
need git python3
fail=0
pass() { echo "PASS $1: $2"; }
nope() { echo "FAIL $1: $2"; fail=$((fail+1)); }

[ -z "$(git -C "$HERE" status --porcelain -- fixtures)" ] \
  || { echo "oracle: fixtures/ has uncommitted changes; fixture.sh new would refuse" >&2; exit 1; }
ticket=$(ls "$HERE/fixtures/tickets" | head -1)
[ -n "$ticket" ] || { echo "oracle: no fixture ticket found" >&2; exit 1; }

tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
export GIT_AUTHOR_NAME=oracle GIT_AUTHOR_EMAIL=oracle@example.invalid
export GIT_COMMITTER_NAME=oracle GIT_COMMITTER_EMAIL=oracle@example.invalid
mkdir -p "$tmp/bin" "$tmp/runs"

# Stubs: codex/claude/pi print their argv; mimo/muse also print their stdin.
for h in codex claude pi; do printf '#!/bin/sh\necho "$@"\n' > "$tmp/bin/$h"; chmod +x "$tmp/bin/$h"; done
printf '#!/bin/sh\nprintf "%%s stdin=%%s\\n" "$*" "$(cat)"\n' > "$tmp/bin/mimo"; chmod +x "$tmp/bin/mimo"
printf '#!/bin/sh\nprintf "%%s stdin=%%s\\n" "$*" "$(cat)"\n' > "$tmp/bin/muse"; chmod +x "$tmp/bin/muse"

# The machine config: every known harness at its top level, pi (no table
# entry) at high so "kept" cannot pass as "lowered to the same value".
cat > "$tmp/config.toml" <<'EOF'
[lanes.cx]
harness = "codex"
model = "cx-model"
effort = "max"
[lanes.cd]
harness = "claude"
model = "cd-model"
effort = "max"
[lanes.mm]
harness = "mimo"
model = "prov/mm-model"
effort = "high"
[lanes.mu]
harness = "muse"
model = "mu-model"
effort = "max"
[lanes.pi]
harness = "pi"
model = "pi-model"
effort = "high"
[team]
workhorses = ["cx", "mm"]
reviewers = ["cx", "cd"]
coachman = { harness = "muse", model = "coach-muse-model", effort = "max" }
coachman_fallback = { harness = "claude", model = "fallback-model", effort = "max" }
postmaster = { harness = "claude", model = "pm-model", effort = "max" }
[tracker]
kind = "github"
EOF
cfg_before=$(sha256sum < "$tmp/config.toml")

meta() {  # meta <dispatch> <repo>: run-meta under the scratch config and pins
  mkdir -p "$1"
  POSTMASTER_CONFIG=$tmp/config.toml POSTMASTER_TOOL_PINS=$tmp/tools \
    "$HERE/scripts/run-meta.sh" "$1" "$2" >"$tmp/meta.out" 2>"$tmp/meta.err"; echo $? >"$tmp/meta.rc"
}
effort() {  # effort <run.json> <dotted path>: the recorded string, or MISSING
  python3 - "$1" "$2" <<'PY'
import json, sys
v = json.load(open(sys.argv[1])).get("config")
for k in sys.argv[2].split("."):
    v = v.get(k) if isinstance(v, dict) else None
print(v if isinstance(v, str) else "MISSING")
PY
}
plain_repo() {  # plain_repo <dest>: a ticket-like repo: one commit, its own store, one ticket
  local dest=$1 body rc
  mkdir -p "$dest" && git -C "$dest" init -q -b main
  printf 'print("app")\n' > "$dest/app.py"
  git -C "$dest" add -A && git -C "$dest" commit -q -m "Initial commit"
  "$HERE/scripts/local.sh" "$dest" store init >/dev/null || return 1
  body=$(mktemp) || return 1
  printf 'Do the thing.\n' > "$body"
  "$HERE/scripts/local.sh" "$dest" create "A ticket" "$body" >/dev/null; rc=$?
  rm -f -- "$body"
  return $rc
}

# Chain A: the fixture copy, through the identical dispatch command as the rest.
fix=$tmp/runs/fixture-copy
POSTMASTER_CONFIG=$tmp/config.toml "$HERE/scripts/fixture.sh" new "$fix" "$ticket" >"$tmp/new.out" 2>"$tmp/new.err"; new_rc=$?
[ "$new_rc" -eq 0 ] || { echo "oracle: fixture.sh new exited $new_rc; cannot probe" >&2; cat "$tmp/new.err" >&2; exit 1; }
meta "$tmp/fix-run" "$fix"; fix_rc=$(cat "$tmp/meta.rc"); cp "$tmp/meta.err" "$tmp/fix-meta.err"
# Chain B: a plain repo, as a ticket run dispatches against.
tick=$tmp/runs/plain-app
plain_repo "$tick" || { echo "oracle: cannot build the plain repo" >&2; exit 1; }
meta "$tmp/tick-run" "$tick"; tick_rc=$(cat "$tmp/meta.rc")
# Chain D: a plain repo with "fixture" in its name: the name must not matter.
fake=$tmp/runs/my-fixture-app
plain_repo "$fake" || { echo "oracle: cannot build the fixture-named repo" >&2; exit 1; }
meta "$tmp/fake-run" "$fake"; fake_rc=$(cat "$tmp/meta.rc")
# Chain C: the fixture copy renamed to a neutral name and moved: the name and
# the path must not matter. Renamed after chain A recorded it.
moved=$tmp/runs/plain-project
mv "$fix" "$moved" || { echo "oracle: cannot rename the fixture copy" >&2; exit 1; }
meta "$tmp/moved-run" "$moved"; moved_rc=$(cat "$tmp/meta.rc")
for c in "fixture $fix_rc" "ticket $tick_rc" "fixture-named $fake_rc" "renamed $moved_rc"; do
  # shellcheck disable=SC2086
  set -- $c
  [ "$2" -eq 0 ] || { echo "oracle: run-meta for the $1 dispatch exited $2" >&2; exit 1; }
done

check_recorded() {  # check_recorded <run.json> <want-file>: every want line "<path> <value>" holds
  local json=$1 want=$2 bad="" path want_v got
  while read -r path want_v; do
    [ -n "$path" ] || continue
    got=$(effort "$json" "$path")
    [ "$got" = "$want_v" ] || bad="$bad $path=$got(want $want_v)"
  done < "$want"
  printf '%s' "$bad"
}
cat > "$tmp/want-lowest.txt" <<'EOF'
lanes.cx.effort none
lanes.cd.effort low
lanes.mm.effort low
lanes.mu.effort minimal
team.coachman.effort minimal
team.coachman_fallback.effort low
team.postmaster.effort low
lanes.cx.harness codex
lanes.cx.model cx-model
lanes.cd.harness claude
lanes.cd.model cd-model
lanes.mm.harness mimo
lanes.mm.model prov/mm-model
lanes.mu.harness muse
lanes.mu.model mu-model
EOF
cat > "$tmp/want-configured.txt" <<'EOF'
lanes.cx.effort max
lanes.cd.effort max
lanes.mm.effort high
lanes.mu.effort max
lanes.pi.effort high
team.coachman.effort max
team.coachman_fallback.effort max
team.postmaster.effort max
EOF

# P1 (AC1+AC2): the fixture copy records every lane and role at its lowest,
# and nothing else in the lane entries changes.
bad=$(check_recorded "$tmp/fix-run/run.json" "$tmp/want-lowest.txt")
[ -z "$bad" ] && pass P1-recorded-lowest "fixture copy records codex none, claude low, mimo low, muse minimal, every role lowered, harness and model untouched" \
  || nope P1-recorded-lowest "fixture copy records:$bad"

# P2 (AC1): the same copy renamed and moved records lowest still.
bad=$(check_recorded "$tmp/moved-run/run.json" "$tmp/want-lowest.txt")
[ -z "$bad" ] && pass P2-renamed-lowest "renamed and moved copy still records lowest" \
  || nope P2-renamed-lowest "renamed copy records:$bad"

# P3 (AC1, negative): a plain repo named like a fixture records configured.
bad=$(check_recorded "$tmp/fake-run/run.json" "$tmp/want-configured.txt")
[ -z "$bad" ] && pass P3-name-not-fixture "fixture-named plain repo records the configured levels" \
  || nope P3-name-not-fixture "fixture-named plain repo records:$bad"

# P4 (AC2): a ticket run records the config as today.
bad=$(check_recorded "$tmp/tick-run/run.json" "$tmp/want-configured.txt")
[ -z "$bad" ] && pass P4-ticket-as-today "plain repo records every configured effort unchanged" \
  || nope P4-ticket-as-today "plain repo records:$bad"

# P5 (AC2): a harness with no table entry keeps its effort, with a warning.
pi_fix=$(effort "$tmp/fix-run/run.json" "lanes.pi.effort")
if [ "$pi_fix" = high ] && grep -qw "pi" "$tmp/fix-meta.err"; then
  pass P5-unknown-kept "pi keeps high, and the dispatch names pi on stderr"
else
  nope P5-unknown-kept "pi records $pi_fix, stderr names pi: $(grep -qw pi "$tmp/fix-meta.err" && echo yes || echo no)"
fi

# P6 (AC2): the machine config file is never changed.
[ "$(sha256sum < "$tmp/config.toml")" = "$cfg_before" ] \
  && pass P6-config-untouched "machine config byte-identical after four dispatches" \
  || nope P6-config-untouched "machine config changed by a dispatch"

# A review scratch: two commits, a clean tree, the range base...HEAD.
scratch=$tmp/review-wt
git init -q -b main "$scratch"
printf 'v1\n' > "$scratch/tracked.txt"
git -C "$scratch" add -A && git -C "$scratch" commit -q -m "base"
printf 'v2\n' > "$scratch/tracked.txt"
git -C "$scratch" commit -q -am "change"
base=$(git -C "$scratch" rev-parse HEAD~1)
review() {  # review <lane> <run> <out-prefix> [--last <file>]: stub run of launch.sh review
  local lane=$1 run=$2 prefix=$3; shift 3
  PATH="$tmp/bin:$PATH" POSTMASTER_HARNESS_DATA=$tmp/hd \
    "$HERE/scripts/launch.sh" review "$lane" "$scratch" "$base" "$@" --run "$run" \
    >"$tmp/$prefix.out" 2>"$tmp/$prefix.err"; echo $? >"$tmp/$prefix.rc"
}
review cx "$tmp/fix-run" rev-cx-fix --last "$tmp/cx-last.md"
review cx "$tmp/tick-run" rev-cx-tick --last "$tmp/cx-last.md"
review cd "$tmp/fix-run" rev-cx-fix-claude
review cd "$tmp/tick-run" rev-cx-tick-claude
review mm "$tmp/fix-run" rev-mm-fix
review mm "$tmp/tick-run" rev-mm-tick

# P7 (AC3+AC5): codex review runs at the recorded effort, through the identical command.
cx_fix_rc=$(cat "$tmp/rev-cx-fix.rc"); cx_tick_rc=$(cat "$tmp/rev-cx-tick.rc")
cx_fix_out=$(cat "$tmp/rev-cx-fix.out"); cx_tick_out=$(cat "$tmp/rev-cx-tick.out")
cx_same=$(printf '%s\n%s\n' "$cx_fix_out" "$cx_tick_out" | sed 's/model_reasoning_effort="none"/EFF/; s/model_reasoning_effort="max"/EFF/' | uniq | wc -l)
if [ "$cx_fix_rc" -eq 0 ] && [ "$cx_tick_rc" -eq 0 ] \
   && case $cx_fix_out in *'model_reasoning_effort="none"'*) true ;; *) false ;; esac \
   && case $cx_fix_out in *'model_reasoning_effort="max"'*) false ;; *) true ;; esac \
   && case $cx_tick_out in *'model_reasoning_effort="max"'*) true ;; *) false ;; esac \
   && [ "$cx_same" -eq 1 ]; then
  pass P7-codex-review "fixture review names none, ticket review names max, one command"
else
  nope P7-codex-review "rc=$cx_fix_rc/$cx_tick_rc same=$cx_same fix=[$cx_fix_out] tick=[$cx_tick_out]"
fi

# P8 (AC3+AC5): claude review runs at the recorded effort, through the identical command.
cd_fix_rc=$(cat "$tmp/rev-cx-fix-claude.rc"); cd_tick_rc=$(cat "$tmp/rev-cx-tick-claude.rc")
cd_fix_out=$(cat "$tmp/rev-cx-fix-claude.out"); cd_tick_out=$(cat "$tmp/rev-cx-tick-claude.out")
cd_same=$(printf '%s\n%s\n' "$cd_fix_out" "$cd_tick_out" | sed 's|/code-review low |/code-review EFF |; s|/code-review max |/code-review EFF |; s/--effort low/--effort EFF/; s/--effort max/--effort EFF/' | uniq | wc -l)
if [ "$cd_fix_rc" -eq 0 ] && [ "$cd_tick_rc" -eq 0 ] \
   && case $cd_fix_out in *"/code-review low $base...HEAD"*"--effort low"*) true ;; *) false ;; esac \
   && case $cd_fix_out in *"/code-review max"*|*"--effort max"*) false ;; *) true ;; esac \
   && case $cd_tick_out in *"/code-review max $base...HEAD"*"--effort max"*) true ;; *) false ;; esac \
   && [ "$cd_same" -eq 1 ]; then
  pass P8-claude-review "fixture review names low in prompt and flag, ticket review max, one command"
else
  nope P8-claude-review "rc=$cd_fix_rc/$cd_tick_rc same=$cd_same fix=[$cd_fix_out] tick=[$cd_tick_out]"
fi

# P9 (AC3+AC5): mimo review runs at the recorded effort, through the identical command.
mm_fix_rc=$(cat "$tmp/rev-mm-fix.rc"); mm_tick_rc=$(cat "$tmp/rev-mm-tick.rc")
mm_fix_out=$(cat "$tmp/rev-mm-fix.out"); mm_tick_out=$(cat "$tmp/rev-mm-tick.out")
mm_same=$(printf '%s\n%s\n' "$mm_fix_out" "$mm_tick_out" | sed 's/--variant low/--variant EFF/; s/--variant high/--variant EFF/' | uniq | wc -l)
mm_left=$(find "$scratch" -maxdepth 1 -name '.postmaster-review-*' -print -quit)
if [ "$mm_fix_rc" -eq 0 ] && [ "$mm_tick_rc" -eq 0 ] \
   && case $mm_fix_out in *"--variant low"*stdin="$base...HEAD"*) true ;; *) false ;; esac \
   && case $mm_fix_out in *"--variant high"*) false ;; *) true ;; esac \
   && case $mm_tick_out in *"--variant high"*stdin="$base...HEAD"*) true ;; *) false ;; esac \
   && [ "$mm_same" -eq 1 ] && [ -z "$mm_left" ]; then
  pass P9-mimo-review "fixture review names low, ticket review high, range on stdin, prompt removed"
else
  nope P9-mimo-review "rc=$mm_fix_rc/$mm_tick_rc same=$mm_same left=[$mm_left] fix=[$mm_fix_out] tick=[$mm_tick_out]"
fi

form() {  # form <args...>: launch.sh form; stdout in $tmp/form.out
  PATH="$tmp/bin:$PATH" "$HERE/scripts/launch.sh" form "$@" >"$tmp/form.out" 2>"$tmp/form.err"; echo $? >"$tmp/form.rc"
}
form_line() { sed -n "s/^$2: //p" "$tmp/$1.txt"; }   # form_line <saved> <launch|resume>

# P10 (AC5): a workhorse launch runs at the recorded effort, through the identical command.
p10_bad=""
for lane in cx cd mm mu; do
  form "$lane" --run "$tmp/fix-run"; fix_rc=$(cat "$tmp/form.rc"); cp "$tmp/form.out" "$tmp/form-$lane-fix.txt"
  form "$lane" --run "$tmp/tick-run"; tick_rc=$(cat "$tmp/form.rc"); cp "$tmp/form.out" "$tmp/form-$lane-tick.txt"
  case $lane in
    cx) low='model_reasoning_effort=\"none\"'; top='model_reasoning_effort=\"max\"'; norm='s/model_reasoning_effort=\\"\(none\|max\)"/model_reasoning_effort=\\"EFF"/' ;;
    cd) low='--effort low'; top='--effort max'; norm='s/--effort \(low\|max\)/--effort EFF/' ;;
    mm) low='--variant low'; top='--variant high'; norm='s/--variant \(low\|high\)/--variant EFF/' ;;
    mu) low='--reasoning-effort minimal'; top='--reasoning-effort max'; norm='s/--reasoning-effort \(minimal\|max\)/--reasoning-effort EFF/' ;;
  esac
  fix_line=$(form_line "form-$lane-fix" launch); tick_line=$(form_line "form-$lane-tick" launch)
  norm_fix=$(printf '%s' "$fix_line" | sed "$norm"); norm_tick=$(printf '%s' "$tick_line" | sed "$norm")
  if [ "$fix_rc" -eq 0 ] && [ "$tick_rc" -eq 0 ] \
     && case $fix_line in *"$low"*) true ;; *) false ;; esac \
     && case $tick_line in *"$top"*) true ;; *) false ;; esac \
     && [ "$norm_fix" = "$norm_tick" ]; then
    :
  else
    p10_bad="$p10_bad $lane(rc=$fix_rc/$tick_rc)"
  fi
done
[ -z "$p10_bad" ] && pass P10-workhorse-launch "every lane's launch names lowest in the fixture run, configured in the ticket run, one command each" \
  || nope P10-workhorse-launch "lanes off:$p10_bad"

# P11 (AC5): a coachman leg runs at the recorded effort, through the identical command.
form coachman --leg synthesis --run "$tmp/fix-run"; fix_rc=$(cat "$tmp/form.rc"); cp "$tmp/form.out" "$tmp/form-coach-fix.txt"
form coachman --leg synthesis --run "$tmp/tick-run"; tick_rc=$(cat "$tmp/form.rc"); cp "$tmp/form.out" "$tmp/form-coach-tick.txt"
coach_fix=$(form_line form-coach-fix launch); coach_tick=$(form_line form-coach-tick launch)
if [ "$fix_rc" -eq 0 ] && [ "$tick_rc" -eq 0 ] \
   && case $coach_fix in *"--reasoning-effort minimal"*) true ;; *) false ;; esac \
   && case $coach_tick in *"--reasoning-effort max"*) true ;; *) false ;; esac \
   && [ "${coach_fix//--reasoning-effort minimal/EFF}" = "${coach_tick//--reasoning-effort max/EFF}" ]; then
  pass P11-coachman-leg "coachman leg names minimal in the fixture run, max in the ticket run, one command"
else
  nope P11-coachman-leg "rc=$fix_rc/$tick_rc fix=[$coach_fix] tick=[$coach_tick]"
fi

# P12 (AC5): a resume runs at the recorded effort, through the identical command.
cx_fix_r=$(form_line form-cx-fix resume); cx_tick_r=$(form_line form-cx-tick resume)
coach_fix_r=$(form_line form-coach-fix resume); coach_tick_r=$(form_line form-coach-tick resume)
if case $cx_fix_r in *'"none"'*) true ;; *) false ;; esac \
   && case $cx_tick_r in *'"max"'*) true ;; *) false ;; esac \
   && case $coach_fix_r in *"--reasoning-effort minimal"*) true ;; *) false ;; esac \
   && case $coach_tick_r in *"--reasoning-effort max"*) true ;; *) false ;; esac; then
  pass P12-resume "workhorse and coachman resumes name lowest in the fixture run, configured in the ticket run"
else
  nope P12-resume "cx=[$cx_fix_r]/[$cx_tick_r] coach=[$coach_fix_r]/[$coach_tick_r]"
fi

# P13 (AC4, guard): the waybill instruction names run.json's recorded config as
# the waybill team's source. Passes at BASE by design; it pins the mechanism
# AC4 rests on, and AC4 itself is verified at synthesis by reading (A5).
step7=$(awk '/^7\. \*\*Write `brief\.md`\*\*/{f=1} f&&/^8\. /{f=0} f' "$HERE/skills/postmaster/postmaster.md")
if printf '%s' "$step7" | grep -q "run\.json"; then
  pass P13-waybill-source "Stage B step 7 sources the waybill team from run.json's recorded config"
else
  nope P13-waybill-source "Stage B step 7 no longer names run.json"
fi

echo
if [ "$fail" -eq 0 ]; then echo "oracle: all probes behaved"; exit 0; fi
echo "oracle: $fail probe(s) misbehaved"; exit 1
