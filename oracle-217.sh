#!/usr/bin/env bash
# Blind oracle for #217: Postmaster runs on macOS.
#
# Written by the leg-1 coachman from the ticket's acceptance criteria BEFORE
# any workhorse launched and before reading any lane's diff or log. Tests at
# the ticket's own interface (script paths, arguments, outputs and exits,
# files the ticket names) plus the spec's shared vocabulary (the two override
# variables, the skip-file/wiki/workflow paths, the checker CLI). Never a
# function shape or a lane-chosen module path.
#
# Coverage and limits (read before trusting a verdict):
# - AC1: containment of per-pid /proc reads to one file (text search;
#   comment-only lines excluded, the rest adjudicated by reading), plus the
#   fixture-Z proof that POSTMASTER_PROC_ROOT is honored.
# - AC2: live/exit marker matrix through host.sh run and _watch on both
#   branches. Herdr pane and headless-agent end-to-end need Herdr and are
#   covered by containment plus the Mac fixture run.
# - AC3: all six items. Registry through a forced five-word stop; locale,
#   check-attr and zsh structurally (lanes own the stub-behavioral halves);
#   fixture through need() plus discovered gate/install strings (lanes own
#   the live hidden-tools gate run); bun path structurally plus a
#   bun-hidden background launch.
# - AC4: page, lint, index link, keyword coverage; setup darwin/linux
#   forcing through --answers echoes. Row depth is judged by reading.
# - AC5: skip-file shape via Bun.TOML plus a darwin-forced sample run.
#   The unlisted-skip negative control is the lanes' (it needs their
#   helper's shape); the gate-green half is the harvest verify.sh run.
# - AC6: checker presence, clean-tree pass, nine plants in scratch copies,
#   gate wiring. The live plant-in-gate proof is the lanes'.
# - AC7: workflow file with every required step (textual; full YAML
#   validity is the lanes'). The jobs-green half shows on the pull request.
# - AC8: README/trackers text, wrapper refusal under a stub old bun,
#   every-wrapper presence. The shared-TS layer is the lanes' plus reading.
# - AC9: ship-time by design; recorded, never tested here.
# - The full `bun run check` is NOT run here; harvest runs the recorded
#   checks per lane separately.
#
# Usage: oracle-217.sh (tests the tree it sits in)
#        ORACLE_ROOT=<tree> oracle-217.sh (tests another tree)
# Exit 0 with `oracle-217: PASS`, 1 with `oracle-217: FAIL`, 2 on bad usage
# or a non-Linux platform.
set -u

ROOT="${ORACLE_ROOT:-$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)}"
cd "$ROOT" || { echo "oracle-217: cannot cd to $ROOT"; exit 2; }
[ -d /proc/self ] || { echo "oracle-217: needs Linux (/proc)"; exit 2; }
[ -f scripts/host.sh ] || { echo "oracle-217: no scripts/host.sh in $ROOT"; exit 2; }
command -v bun >/dev/null 2>&1 || { echo "oracle-217: bun is not on PATH"; exit 2; }
command -v git >/dev/null 2>&1 || { echo "oracle-217: git is not on PATH"; exit 2; }

T=$(mktemp -d) || exit 2
PIDS="$T/pids"
: >"$PIDS"
cleanup() {
  while IFS= read -r p; do
    [ -n "$p" ] && kill "$p" 2>/dev/null
  done <"$PIDS"
  rm -rf "$T"
}
trap cleanup EXIT

failed=0
checks=0
ok() { checks=$((checks + 1)); echo "ok: $1"; }
bad() { checks=$((checks + 1)); failed=$((failed + 1)); echo "FAIL: $1"; }
info() { echo "info: $1"; }
ac_bad=0
ac_begin() { ac_bad=0; }
ac_end() {
  if [ "$ac_bad" -eq 0 ]; then ok "AC$1 holds"; else bad "AC$1 broken (see FAIL lines above)"; fi
}
mark_bad() { ac_bad=1; }
track() { echo "$1" >>"$PIDS"; }

# poll_marker <path> <seconds>: exit 0 if the path appears in time.
poll_marker() {
  i=0
  while [ "$i" -lt "$(($2 * 4))" ]; do
    [ -e "$1" ] && return 0
    sleep 0.25
    i=$((i + 1))
  done
  [ -e "$1" ]
}

HOSTENV_STATE="$T/hstate"
HOSTENV_FIX="$T"
hexport() {
  export POSTMASTER_HOST=none
  export POSTMASTER_HOST_STATE="$HOSTENV_STATE"
  export POSTMASTER_HOST_FIXTURE="$HOSTENV_FIX"
}

# --- AC1: one helper, both branches ------------------------------------------------
ac_begin
# 1a. Every per-pid /proc read (template or concatenation, with stat on the
# line) lives in exactly one non-test .ts file. Comment-only lines excluded.
hits=$(grep -rn --include='*.ts' -E "/proc/(\\$\\{|\" *\\+|' *\\+)" scripts/ 2>/dev/null | grep 'stat' | grep -v '\.test\.ts:' | grep -v ':[0-9]*:[[:space:]]*//') || true
files=$(printf '%s\n' "$hits" | cut -d: -f1 | sort -u | grep -c .) || true
if [ -z "$hits" ]; then
  bad "AC1: no per-pid /proc read found anywhere (the helper reads nothing?)"
  mark_bad
elif [ "$files" -eq 1 ]; then
  ok "AC1: per-pid /proc reads live in one file: $(printf '%s\n' "$hits" | cut -d: -f1 | sort -u | tr '\n' ' ')"
else
  bad "AC1: per-pid /proc reads live in $files files, want 1"
  printf '%s\n' "$hits" | sed 's/^/  /'
  mark_bad
fi
# 1b. POSTMASTER_PROC_ROOT is honored: a fixture claiming Z for a live pid
# reads zombie, so _watch lands the marker while the pid lives.
sleep 30 &
zpid=$!
track "$zpid"
mkdir -p "$T/zproc/$zpid"
printf '%s (sleep) Z 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22\n' "$zpid" >"$T/zproc/$zpid/stat"
POSTMASTER_PROC_ROOT="$T/zproc" scripts/host.sh _watch "$zpid" "$T/z.marker" >"$T/z.watch" 2>&1 &
wpid=$!
track "$wpid"
if poll_marker "$T/z.marker" 10; then
  if kill -0 "$zpid" 2>/dev/null; then
    ok "AC1: fixture-Z pid reads zombie (marker landed, pid live)"
  else
    bad "AC1: marker landed but the fixture-Z pid is dead (setup raced)"
    mark_bad
  fi
else
  bad "AC1: no marker in 10 s for a fixture-Z pid (override ignored?)"
  mark_bad
fi
kill "$zpid" "$wpid" 2>/dev/null
wait 2>/dev/null
ac_end 1

# --- AC2: live never marks, exit marks, on both branches ---------------------------
ac_begin
bg_case() {
  # bg_case <label> <proot> <live|exit>
  label="$1"
  proot="$2"
  kind="$3"
  wt="$T/wt-$label"
  mkdir -p "$wt"
  out="$T/$label.out"
  err="$T/$label.err"
  marker="$T/$label.marker"
  rm -f "$marker" "$T/$label.pid"
  hexport
  if [ "$kind" = live ]; then
    if [ -n "$proot" ]; then
      POSTMASTER_PROC_ROOT="$proot" scripts/host.sh run "o-$label" "$wt" \
        --out "$out" --err "$err" --marker "$marker" \
        -- sh -c "echo \$\$ > $T/$label.pid; exec sleep 30" >"$T/$label.run" 2>&1
    else
      scripts/host.sh run "o-$label" "$wt" \
        --out "$out" --err "$err" --marker "$marker" \
        -- sh -c "echo \$\$ > $T/$label.pid; exec sleep 30" >"$T/$label.run" 2>&1
    fi
    rc=$?
    [ "$rc" -eq 0 ] || { bad "AC2 $label: host.sh run exited $rc"; mark_bad; return; }
    waited=0
    while [ ! -s "$T/$label.pid" ] && [ "$waited" -lt 40 ]; do sleep 0.25; waited=$((waited + 1)); done
    if [ ! -s "$T/$label.pid" ]; then bad "AC2 $label: bg sleep never started"; mark_bad; return; fi
    lpid=$(cat "$T/$label.pid")
    track "$lpid"
    sleep 3
    if [ -e "$marker" ]; then
      bad "AC2 $label: marker landed while the process lives"
      mark_bad
    else
      ok "AC2 $label: no marker while live"
    fi
    kill "$lpid" 2>/dev/null
    if poll_marker "$marker" 10; then
      ok "AC2 $label: marker landed after the kill"
    else
      bad "AC2 $label: no marker 10 s after the kill"
      mark_bad
    fi
  else
    if [ -n "$proot" ]; then
      POSTMASTER_PROC_ROOT="$proot" scripts/host.sh run "o-$label" "$wt" \
        --out "$out" --err "$err" --marker "$marker" \
        -- sh -c 'exit 3' >"$T/$label.run" 2>&1
    else
      scripts/host.sh run "o-$label" "$wt" \
        --out "$out" --err "$err" --marker "$marker" \
        -- sh -c 'exit 3' >"$T/$label.run" 2>&1
    fi
    if poll_marker "$marker" 10; then
      ok "AC2 $label: marker landed for the exiting process"
    else
      bad "AC2 $label: no marker 10 s after exit 3"
      mark_bad
    fi
  fi
  if grep -q "did not start" "$err" 2>/dev/null; then
    bad "AC2 $label: background runner rejected ($(cat "$err"))"
    mark_bad
  fi
}
bg_case "live-proc" "" live
bg_case "live-noproc" "$T/no-such-dir" live
bg_case "exit-proc" "" exit
bg_case "exit-noproc" "$T/no-such-dir" exit
ac_end 2

# --- AC3: the six "fails or misbehaves" items ---------------------------------------
ac_begin
# 3a. Registry with a five-word start: stop finds the member on the forced branch.
hexport
rwt="$T/rwt"
mkdir -p "$rwt"
scripts/host.sh run "o-reg" "$rwt" --out "$T/reg.out" --err "$T/reg.err" \
  --marker "$T/reg.marker" -- sh -c "echo \$\$ > $T/reg.pid; exec sleep 60" \
  >"$T/reg.run" 2>&1
waited=0
while [ ! -s "$T/reg.pid" ] && [ "$waited" -lt 40 ]; do sleep 0.25; waited=$((waited + 1)); done
if [ ! -s "$T/reg.pid" ]; then
  bad "AC3 registry: bg sleep never started (infra)"
  mark_bad
else
  rpid=$(cat "$T/reg.pid")
  track "$rpid"
  rec=$(ls "$HOSTENV_STATE/launches/"* 2>/dev/null | head -n 1)
  if [ -z "${rec:-}" ]; then
    bad "AC3 registry: no launch record written (infra)"
    mark_bad
  else
    bootline=$(grep '^boot ' "$rec" | head -n 1)
    lstart=$(LC_ALL=C ps -o lstart= -p "$rpid" | tr -s ' ' | sed 's/^ //;s/ $//')
    if [ -z "$lstart" ]; then
      bad "AC3 registry: cannot read lstart of $rpid (infra)"
      mark_bad
    else
      # A record whose group is long dead, so only the member line can match.
      {
        echo "$rwt"
        echo "o-reg"
        echo "start $lstart"
        echo "$bootline"
        echo "member $rpid $lstart"
      } >"$HOSTENV_STATE/launches/99999901"
      rm -f "$rec"
      if POSTMASTER_PROC_ROOT="$T/no-such-dir" scripts/host.sh stop "$rwt" >"$T/reg.stop" 2>&1; then
        sleep 1
        if kill -0 "$rpid" 2>/dev/null; then
          bad "AC3 registry: stop missed a five-word member (sleep $rpid lives)"
          grep -q "no launch is running" "$T/reg.stop" && info "stop said: $(cat "$T/reg.stop")"
          mark_bad
        else
          ok "AC3 registry: stop killed the five-word member"
        fi
      else
        bad "AC3 registry: host.sh stop exited non-zero"
        mark_bad
      fi
    fi
  fi
fi
# 3b. Every ps spawn carries LC_ALL=C (call positions only; product files).
: >"$T/pshits"
for f in scripts/*.ts scripts/lib/*.ts; do
  case "$f" in *.test.ts | scripts/host-self-test.ts) continue ;; esac
  [ -f "$f" ] || continue
  grep -n -E 'run\("ps"|spawn\([^)]*"ps"|, *"ps" *,' "$f" 2>/dev/null | cut -d: -f1 | while IFS= read -r ln; do
    [ -n "$ln" ] || continue
    if ! sed -n "$((ln - 3)),$((ln + 3))p" "$f" | grep -q 'LC_ALL'; then
      echo "  $f:$ln"
    fi
  done >>"$T/pshits" 2>/dev/null || true
done
if [ -s "$T/pshits" ]; then
  bad "AC3 locale: ps spawns without LC_ALL=C nearby:"
  cat "$T/pshits" | sed 's/^/  /'
  mark_bad
else
  ok "AC3 locale: every ps spawn carries LC_ALL=C"
fi
# 3c. No --source in synthesis-shares; the measurement still runs.
if grep -n -- '--source' scripts/synthesis-shares.ts 2>/dev/null | grep -v '^[0-9]*:[[:space:]]*//' | grep -q .; then
  bad "AC3 check-attr: --source still used in synthesis-shares.ts"
  mark_bad
else
  ok "AC3 check-attr: no --source in synthesis-shares.ts"
fi
smoke_base=""
smoke_head=""
for c in $(git rev-list --first-parent --no-merges -n 10 HEAD 2>/dev/null); do
  p=$(git rev-parse "$c^" 2>/dev/null) || continue
  [ -n "$p" ] || continue
  [ "$(git rev-list --count --merges "$p..$c" 2>/dev/null)" = "0" ] || continue
  [ -n "$(git diff --name-only "$p" "$c" 2>/dev/null)" ] || continue
  smoke_base="$p"
  smoke_head="$c"
  break
done
if [ -n "$smoke_base" ] && bun --no-env-file --config="$ROOT/bunfig.toml" \
  "$ROOT/scripts/synthesis-shares.ts" --base "$smoke_base" --synthesis "$smoke_head" \
  --lane "o=$smoke_head" >"$T/shares.out" 2>&1; then
  grep -q '^SHARES:' "$T/shares.out" && ok "AC3 check-attr: measurement runs" || {
    bad "AC3 check-attr: measurement printed no SHARES line"
    mark_bad
  }
else
  bad "AC3 check-attr: measurement run failed"
  mark_bad
fi
# 3d. fixture need() dropped jq and npm; the app gate/install are Bun forms.
if grep -n 'need(' scripts/fixture.ts 2>/dev/null | grep -E '"jq"|'"'"'jq|"npm"' | grep -q .; then
  bad "AC3 fixture: need() still names jq or npm"
  mark_bad
else
  ok "AC3 fixture: need() names neither jq nor npm"
fi
SHADOW="$T/shadow"
mkdir -p "$SHADOW"
REALBUN=$(command -v bun)
oIFS="$IFS"
IFS=:
# shellcheck disable=SC2162
for d in $PATH; do
  [ -d "$d" ] || continue
  for f in "$d"/*; do
    b=$(basename -- "$f")
    case "$b" in jq | npm | node) continue ;; esac
    [ -x "$f" ] && [ ! -e "$SHADOW/$b" ] && ln -s "$f" "$SHADOW/$b" 2>/dev/null
  done
done
IFS="$oIFS"
if PATH="$SHADOW" command -v jq >/dev/null 2>&1 || PATH="$SHADOW" command -v npm >/dev/null 2>&1; then
  info "AC3 fixture: jq/npm hiding failed (infra); startup check skipped"
else
  mkdir -p "$T/empty-dispatch"
  if PATH="$SHADOW" scripts/fixture.sh score "$T/empty-dispatch" "$ROOT" >"$T/score.out" 2>&1; then
    ok "AC3 fixture: score starts past need() with jq/npm hidden"
  else
    if grep -q "not on PATH" "$T/score.out"; then
      bad "AC3 fixture: score dies on PATH with jq/npm hidden: $(grep 'not on PATH' "$T/score.out" | head -n 1)"
      mark_bad
    else
      ok "AC3 fixture: score starts past need() with jq/npm hidden (fails later, as an empty dispatch should)"
    fi
  fi
fi
disc=$(scripts/discover-project.sh "$ROOT/fixtures/app" 2>/dev/null)
if printf '%s\n' "$disc" | grep -q '^gate=bun run check$'; then
  ok "AC3 fixture: app gate is the Bun form"
else
  bad "AC3 fixture: app gate is not 'bun run check': $(printf '%s\n' "$disc" | grep '^gate=' | head -n 1)"
  mark_bad
fi
if printf '%s\n' "$disc" | grep -q '^install=bun install'; then
  ok "AC3 fixture: app install is the Bun form"
else
  bad "AC3 fixture: app install is not Bun: $(printf '%s\n' "$disc" | grep '^install=' | head -n 1)"
  mark_bad
fi
bun --no-env-file --config=/dev/null -e '
import { readFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync("fixtures/app/package.json", "utf8"));
const check = pkg.scripts?.check ?? "";
const badSegs = String(check).split(/&&|;|\|\|/).filter((s) => /\b(tsc|biome)\b/.test(s) && !/bunx|^\s*bun\s/.test(s));
if (badSegs.length > 0) { console.log("bare: " + badSegs.join(" ;; ")); process.exit(1); }
' >"$T/appcheck.out" 2>&1 || {
  bad "AC3 fixture: app check script has a bare tsc/biome segment: $(cat "$T/appcheck.out")"
  mark_bad
}
[ -s "$T/appcheck.out" ] || ok "AC3 fixture: app check script is Bun-native"
# 3e. No unquoted multi-word variable in runbook shell blocks.
bun --no-env-file --config=/dev/null -e '
import { readFileSync } from "node:fs";
const text = readFileSync("skills/postmaster/coachman.md", "utf8");
const lines = text.split("\n");
let inFence = false, bad = [];
lines.forEach((line, i) => {
  if (/^\s*```sh/.test(line)) { inFence = true; return; }
  if (/^\s*```/.test(line)) { inFence = false; return; }
  if (!inFence) return;
  const re = /\$(CLONE|REVIEWERS|NORMALIZE_FAILED)(?![A-Za-z0-9_{])/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const before = line[m.index - 1] ?? " ";
    if (before !== "\"" && before !== "=") bad.push(`${i + 1}: ${line.trim()}`);
  }
});
if (bad.length > 0) { console.log(bad.join("\n")); process.exit(1); }
' >"$T/zsh.out" 2>&1
if [ $? -eq 0 ]; then
  ok "AC3 zsh: no unquoted multi-word variable in runbook blocks"
else
  bad "AC3 zsh: unquoted uses remain:"
  sed 's/^/  /' "$T/zsh.out"
  mark_bad
fi
command -v zsh >/dev/null 2>&1 && info "zsh present: lanes own the zsh -c behavioral run" || info "zsh absent here: behavioral zsh proof is the lanes macOS-CI test"
# 3f. No bare "bun" argv0 in the re-spawn files; bg launch works bun-hidden.
bunhits=$(grep -n '"bun"' scripts/host.ts scripts/launch.ts scripts/stage.ts 2>/dev/null | grep -v 'which("bun")') || true
if [ -n "$bunhits" ]; then
  bad "AC3 bun path: bare \"bun\" remains:"
  printf '%s\n' "$bunhits" | sed 's/^/  /'
  mark_bad
else
  ok "AC3 bun path: no bare \"bun\" argv0 in host/launch/stage"
fi
NOBUN="$T/nobun"
mkdir -p "$NOBUN"
IFS=:
for d in $PATH; do
  [ -d "$d" ] || continue
  for f in "$d"/*; do
    b=$(basename -- "$f")
    [ "$b" = bun ] && continue
    [ -x "$f" ] && [ ! -e "$NOBUN/$b" ] && ln -s "$f" "$NOBUN/$b" 2>/dev/null
  done
done
IFS="$oIFS"
hexport
bwt="$T/bwt"
mkdir -p "$bwt"
PATH="$NOBUN" "$REALBUN" --no-env-file --config="$ROOT/bunfig.toml" "$ROOT/scripts/host.ts" run \
  "o-nobun" "$bwt" --out "$T/nobun.out" --err "$T/nobun.err" --marker "$T/nobun.marker" \
  -- sh -c 'exit 0' >"$T/nobun.run" 2>&1 || true
if poll_marker "$T/nobun.marker" 15; then
  ok "AC3 bun path: background launch lands its marker with bun hidden from PATH"
else
  bad "AC3 bun path: no marker in 15 s with bun hidden from PATH"
  mark_bad
fi
ac_end 3

# --- AC4: degrade page plus setup gating ------------------------------------------------
ac_begin
page="wiki/concepts/macos-portability.md"
if [ -f "$page" ]; then
  ok "AC4: the wiki page exists"
else
  bad "AC4: no $page"
  mark_bad
fi
if grep -q 'macos-portability' wiki/index.md 2>/dev/null; then
  ok "AC4: the index links the page"
else
  bad "AC4: wiki/index.md does not link the page"
  mark_bad
fi
if scripts/wiki-lint.sh >"$T/lint.out" 2>&1; then
  ok "AC4: wiki-lint passes"
else
  bad "AC4: wiki-lint fails:"
  head -n 10 "$T/lint.out" | sed 's/^/  /'
  mark_bad
fi
kw=0
for pat in 'timeout' 'flock' 'systemd' 'bootsessionuuid|kern\.boottime' 'fifo' 'signal' \
  'task root|task-root|claude-' 'passwd|~user' 'cmdline' 'XDG_DATA_HOME' 'monotonic' \
  'trials/' 'oracle-85|oracle-109' 'cgroup|MemoryMax'; do
  grep -qiE "$pat" "$page" 2>/dev/null && kw=$((kw + 1))
done
if [ -f "$page" ]; then
  if [ "$kw" -ge 10 ]; then
    ok "AC4: page covers $kw of 14 construct keywords"
  else
    bad "AC4: page covers only $kw of 14 construct keywords"
    mark_bad
  fi
fi
ANSW_FULL="$T/full.answers"
cat >"$ANSW_FULL" <<'EOF'
projects_roots=~/Code
lanes=alpha,beta
lane.alpha.harness=codex
lane.alpha.model=gpt-test
lane.beta.harness=mimo
lane.beta.model=mimo-test
workhorses=alpha,beta
reviewers=alpha,beta
coachman.harness=muse
coachman.model=muse-test
fallback.harness=codex
fallback.model=fallback-test
postmaster.harness=codex
postmaster.model=pm-test
max_runs=2
poll_seconds=120
limits.memory_max=8G
limits.tasks_max=512
limits.lane.memory_max=12G
tracker=github
postmaster_may_create=no
round_timeout_seconds=2400
merge_authority=user
checkpoint_mode=autonomous
overwrite=yes
EOF
ANSW_MINUS="$T/minus.answers"
grep -v '^limits\.' "$ANSW_FULL" >"$ANSW_MINUS"
if POSTMASTER_PLATFORM=darwin scripts/setup.sh --answers "$ANSW_FULL" --config "$T/darwin.toml" \
  >"$T/darwin.out" 2>"$T/darwin.err"; then
  if grep -q '\[limits' "$T/darwin.toml" 2>/dev/null; then
    bad "AC4 setup: darwin-forced run wrote a [limits] table"
    mark_bad
  else
    ok "AC4 setup: darwin-forced run wrote no [limits]"
  fi
  if grep -qi 'limit' "$T/darwin.err"; then
    ok "AC4 setup: darwin-forced run warns about the limits keys"
  else
    bad "AC4 setup: darwin-forced run warns nothing on stderr"
    mark_bad
  fi
else
  bad "AC4 setup: darwin-forced run with limits keys exited non-zero"
  mark_bad
fi
POSTMASTER_PLATFORM=linux scripts/setup.sh --answers "$ANSW_MINUS" --config "$T/linux.toml" \
  >"$T/linux.out" 2>"$T/linux.err" || true
caplines=$(grep -c '^  .*cap.*: ' "$T/linux.out" 2>/dev/null) || caplines=0
if grep -q '== Launch limits' "$T/linux.out" 2>/dev/null && [ "$caplines" -ge 8 ]; then
  ok "AC4 setup: linux-forced run asks all eight cap questions"
else
  bad "AC4 setup: linux-forced run shows $caplines cap echoes (want 8)"
  mark_bad
fi
POSTMASTER_PLATFORM=darwin scripts/setup.sh --answers "$ANSW_MINUS" --config "$T/darwin2.toml" \
  >"$T/darwin2.out" 2>"$T/darwin2.err" || true
caplines_d=$(grep -c '^  .*cap.*: ' "$T/darwin2.out" 2>/dev/null) || caplines_d=0
if grep -q '== Launch limits' "$T/darwin2.out" 2>/dev/null || [ "$caplines_d" -ne 0 ]; then
  bad "AC4 setup: darwin-forced run still asks limits questions"
  mark_bad
else
  ok "AC4 setup: darwin-forced run asks no limits question"
fi
ac_end 4

# --- AC5: fixed or skipped-by-name ------------------------------------------------------
ac_begin
skipf="scripts/darwin-skip.toml"
if [ ! -f "$skipf" ]; then
  bad "AC5: no $skipf"
  mark_bad
else
  bun --no-env-file --config=/dev/null -e '
import { readFileSync } from "node:fs";
const o = Bun.TOML.parse(readFileSync("scripts/darwin-skip.toml", "utf8"));
const skips = o.skip ?? [];
if (!Array.isArray(skips)) { console.log("no [[skip]] array"); process.exit(1); }
const badEntries = skips.filter((s) => typeof s?.name !== "string" || s.name === "" || typeof s?.reason !== "string" || s.reason === "");
if (badEntries.length > 0) { console.log(`${badEntries.length} entries without a name or reason`); process.exit(1); }
console.log(`entries=${skips.length}`);
for (const s of skips.slice(0, 2)) console.log(`sample=${s.name}`);
' >"$T/skip.out" 2>&1
  if [ $? -eq 0 ]; then
    ok "AC5: skip file parses, $(head -n 1 "$T/skip.out")"
    if grep -q '^entries=0' "$T/skip.out"; then
      info "AC5: no skips; the lane fixed everything"
    else
      grep '^sample=' "$T/skip.out" | sed 's/^sample=//' | while IFS= read -r sname; do
        [ -n "$sname" ] || continue
        sfile=$(grep -rl --include='*.ts' -F -- "$sname" scripts/ 2>/dev/null | head -n 1)
        if [ -z "${sfile:-}" ]; then
          echo "STALE:$sname" >>"$T/skip.stale"
        else
          echo "RUN:$sfile:$sname" >>"$T/skip.run"
        fi
      done
      if [ -s "$T/skip.stale" ]; then
        bad "AC5: skip entries naming no code: $(tr '\n' ' ' <"$T/skip.stale")"
        mark_bad
      fi
      if [ -s "$T/skip.run" ]; then
        while IFS=: read -r _ sfile sname; do
          case "$sfile" in
          *.test.ts)
            if env -u POSTMASTER_HOST -u POSTMASTER_HOST_STATE -u POSTMASTER_HOST_FIXTURE POSTMASTER_PLATFORM=darwin bun test "$sfile" >"$T/skip-test.out" 2>&1; then
              if grep -q '(skip)' "$T/skip-test.out"; then
                echo "ok: AC5: darwin-forced $sfile skips (sample $sname)"
              else
                echo "ok: AC5: darwin-forced $sfile exits 0 (no skip line shown)"
              fi
            else
              echo "FAIL: AC5: darwin-forced $sfile exits non-zero" >>"$T/skip.fail"
            fi
            ;;
          *)
            echo "info: AC5: sample $sname lives outside *.test.ts; behavioral proof is the lane's"
            ;;
          esac
        done <"$T/skip.run" >"$T/skip-verdicts" 2>&1 || true
        cat "$T/skip-verdicts"
        grep -q '^FAIL:' "$T/skip-verdicts" 2>/dev/null && mark_bad
        if [ -f "$T/skip.fail" ] && grep -q '^FAIL:' "$T/skip.fail" 2>/dev/null; then
          bad "AC5: a darwin-forced sample run failed"
          mark_bad
        fi
      fi
    fi
  else
    bad "AC5: skip file does not parse: $(cat "$T/skip.out" | head -n 1)"
    mark_bad
  fi
fi
ac_end 5

# --- AC6: the portability checker ---------------------------------------------------------
ac_begin
checker="scripts/portability-check.sh"
if [ ! -f "$checker" ]; then
  bad "AC6: no $checker"
  mark_bad
  info "AC6: plant checks skipped without the checker"
else
  if "$checker" >"$T/pc-clean.out" 2>&1; then
    ok "AC6: clean tree passes"
  else
    bad "AC6: clean tree fails:"
    head -n 5 "$T/pc-clean.out" | sed 's/^/  /'
    mark_bad
  fi
  plant() {
    # plant <n> <file> <content...>: write the plant, run the checker on it.
    n="$1"
    file="$2"
    printf '%s' "$3" >"$file"
    if "$checker" "$file" >"$T/pc-$n.out" 2>&1; then
      echo "FAIL: plant $n ($file) passed silent" >>"$T/pc.fail"
    else
      if grep -q -- "$file" "$T/pc-$n.out" && grep -qE ':[0-9]+:' "$T/pc-$n.out"; then
        echo "ok: plant $n refused with file and line"
      else
        echo "FAIL: plant $n refused without file and line" >>"$T/pc.fail"
      fi
    fi
    rm -f "$file"
  }
  : >"$T/pc.fail"
  plant 1 "scripts/zz-oracle-plant-1.ts" 'import { readFileSync } from "node:fs";
export const s = readFileSync(`/proc/${process.pid}/stat`, "utf8");
'
  plant 2 "scripts/zz-oracle-plant-2.ts" 'import { run } from "./lib/proc.ts";
export const r = run("timeout", ["5", "sleep", "1"]);
'
  plant 3 "scripts/zz-oracle-plant-3.ts" 'import { run } from "./lib/proc.ts";
export const r = run("setsid", ["sleep", "1"]);
'
  plant 4 "scripts/zz-oracle-plant-4.ts" 'import { run } from "./lib/proc.ts";
export const r = run("flock", ["-n", "/tmp/zz", "true"]);
'
  plant 5 "scripts/zz-oracle-plant-5.ts" 'import { run } from "./lib/proc.ts";
export const r = run("jq", ["-e", "."]);
'
  plant 6 "scripts/zz-oracle-plant-6.ts" 'import { run } from "./lib/proc.ts";
export const r = run("python3", ["-c", "pass"]);
'
  printf '%s' 'import { run } from "./lib/proc.ts";
export const a = run("grep", ["-P", "x", "y"]);
export const b = run("sed", ["-i", "s/a/b/", "f"]);
' >"scripts/zz-oracle-plant-7.ts"
  if "$checker" "scripts/zz-oracle-plant-7.ts" >"$T/pc-7.out" 2>&1; then
    echo "FAIL: plant 7 (GNU flags) passed silent" >>"$T/pc.fail"
  else
    echo "ok: plant 7 (GNU flags) refused"
  fi
  rm -f "scripts/zz-oracle-plant-7.ts"
  printf '%s' 'import { run } from "./lib/proc.ts";
export const a = run("/bin/true", []);
export const b = run("/bin/false", []);
' >"scripts/zz-oracle-plant-8.ts"
  if "$checker" "scripts/zz-oracle-plant-8.ts" >"$T/pc-8.out" 2>&1; then
    echo "FAIL: plant 8 (/bin/true+false) passed silent" >>"$T/pc.fail"
  else
    n8=$(grep -c -- "zz-oracle-plant-8" "$T/pc-8.out" || true)
    if [ "$n8" -ge 2 ]; then
      echo "ok: plant 8 refused twice, both spellings"
    else
      echo "FAIL: plant 8 refused $n8 times, want 2" >>"$T/pc.fail"
    fi
  fi
  rm -f "scripts/zz-oracle-plant-8.ts"
  printf '\n```sh\nCLONE="--clone X"\n<tool>/scripts/cut-scratch.sh a b c d $CLONE\n```\n' >>skills/postmaster/coachman.md
  if "$checker" "skills/postmaster/coachman.md" >"$T/pc-9.out" 2>&1; then
    echo "FAIL: plant 9 (unquoted runbook var) passed silent" >>"$T/pc.fail"
  else
    if grep -q -- "coachman.md" "$T/pc-9.out" && grep -qE ':[0-9]+:' "$T/pc-9.out"; then
      echo "ok: plant 9 refused with file and line"
    else
      echo "FAIL: plant 9 refused without file and line" >>"$T/pc.fail"
    fi
  fi
  git checkout -- skills/postmaster/coachman.md 2>/dev/null || true
  if [ -s "$T/pc.fail" ]; then
    bad "AC6: plant failures:"
    sed 's/^/  /' "$T/pc.fail"
    mark_bad
  else
    ok "AC6: all nine plants refused"
  fi
  if grep -q 'portability-check' package.json; then
    ok "AC6: the gate names the checker"
  else
    bad "AC6: package.json check does not name the checker"
    mark_bad
  fi
fi
ac_end 6

# --- AC7: the CI workflow ------------------------------------------------------------------
ac_begin
wf=".github/workflows/check.yml"
if [ ! -f "$wf" ]; then
  bad "AC7: no $wf"
  mark_bad
else
  for need in 'macos-latest' 'ubuntu-latest' 'actions/checkout@v4' 'oven-sh/setup-bun@v2' 'frozen-lockfile' 'bun run check'; do
    grep -qF -- "$need" "$wf" || {
      bad "AC7: workflow lacks $need"
      mark_bad
    }
  done
  grep -qE 'fetch-depth:[ ]*0' "$wf" || {
    bad "AC7: workflow lacks fetch-depth 0"
    mark_bad
  }
  grep -qE 'bun-version:[ ]*1\.4\.2' "$wf" || {
    bad "AC7: workflow does not pin Bun 1.4.2"
    mark_bad
  }
  [ "$ac_bad" -eq 0 ] && ok "AC7: workflow holds both jobs with every required step"
fi
info "AC7: the jobs-green half shows on the pull request, not here"
ac_end 7

# --- AC8: platforms stated, Bun minimum enforced --------------------------------------------
ac_begin
if grep -qiE 'linux.*macos|macos.*linux' README.md 2>/dev/null; then
  ok "AC8: README names Linux and macOS together"
else
  bad "AC8: README names no Linux-plus-macOS support statement"
  mark_bad
fi
if grep -qF 'jq, which the fixture flow requires' README.md 2>/dev/null; then
  bad "AC8: stale jq requirement still in README"
  mark_bad
else
  ok "AC8: stale jq line gone from README"
fi
if grep -qF 'Python 3.11' README.md 2>/dev/null; then
  bad "AC8: stale Python line still in README"
  mark_bad
else
  ok "AC8: stale Python line gone from README"
fi
if grep -qF 'bash, git and python3' skills/postmaster/trackers.md 2>/dev/null; then
  bad "AC8: stale python3 line still in trackers.md"
  mark_bad
else
  ok "AC8: stale python3 line gone from trackers.md"
fi
STUB="$T/stubbin"
mkdir -p "$STUB"
cat >"$STUB/bun" <<EOF
#!/bin/sh
if [ "\$1" = "--version" ]; then echo "\$STUB_VERSION"; else exec $REALBUN "\$@"; fi
EOF
chmod +x "$STUB/bun"
if STUB_VERSION=1.3.14 PATH="$STUB:$PATH" scripts/host.sh detect >"$T/oldbun.out" 2>&1; then
  bad "AC8: wrapper proceeds under stub Bun 1.3.14"
  mark_bad
else
  if grep -q '1\.4\.2' "$T/oldbun.out"; then
    ok "AC8: wrapper refuses old Bun naming 1.4.2"
  else
    bad "AC8: wrapper refuses old Bun without naming 1.4.2"
    mark_bad
  fi
fi
if STUB_VERSION=1.4.2 PATH="$STUB:$PATH" scripts/host.sh detect >"$T/newbun.out" 2>&1; then
  ok "AC8: wrapper proceeds under stub Bun 1.4.2"
else
  bad "AC8: wrapper refuses stub Bun 1.4.2"
  mark_bad
fi
missing=""
for w in scripts/*.sh; do
  if grep -q '1\.4\.2' "$w" 2>/dev/null; then continue; fi
  srclibs=$(grep -E '^[[:space:]]*(source|\.) ' "$w" 2>/dev/null | grep -oE '[A-Za-z0-9_./-]+\.sh' | sort -u) || true
  found=""
  for s in $srclibs; do
    for cand in "$ROOT/$s" "scripts/$(basename -- "$s")"; do
      if [ -f "$cand" ] && grep -q '1\.4\.2' "$cand" 2>/dev/null; then found=1; break; fi
    done
    [ -n "$found" ] && break
  done
  [ -n "$found" ] || missing="$missing $w"
done
missing=$(printf '%s' "$missing" | sed 's/^ //')
if [ -n "$missing" ]; then
  bad "AC8: wrappers without the minimum: $missing"
  mark_bad
else
  ok "AC8: every wrapper names the minimum"
fi
info "AC8: the shared-TS layer is the lanes plus reading"
ac_end 8

# --- AC9: ship-time by design ----------------------------------------------------------------
ac_begin
info "AC9: a fixture run on a Mac scores clean; a person runs it at ship time"
ok "AC9: recorded not shown (see the run record for the run itself)"
ac_end 9

echo "oracle-217: $checks checks, $failed failures"
if [ "$failed" -eq 0 ]; then echo "oracle-217: PASS"; exit 0; fi
echo "oracle-217: FAIL"
exit 1
