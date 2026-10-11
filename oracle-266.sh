#!/usr/bin/env bash
# Oracle for #266: blind acceptance tests at the ticket's own interface.
#
# Written from the ticket's checks C1-C9 before any lane's diff, committed on
# the ticket branch, and run against each lane's work at harvest by cherry-picking
# this commit onto a scratch of the lane. Every test uses only what the ticket
# names - the gate's check line, refusal shapes, file names and command output -
# never a script name, flag or file the lanes chose. The runbook check is found
# by reading package.json's check line and running each scripts/run step in it
# except wiki-lint, so the oracle works whether the lane extended skill-refs or
# wrote a new script. skip-check is excepted too: it audits the suite's skips
# on a live checkout, not the runbooks, and the suite cannot run in a scratch
# copy (no git, no node_modules). Nothing is planted in the worktree: every
# planting goes to a scratch copy, as the ticket requires.
#
# Three checks have no oracle coverage here. C5's full gate is the harvest's own
# `verify run` on each lane; the oracle only runs the check steps on the
# unmodified tree. C6's replacement scripts take names and flags the lanes
# choose, so they are covered by the lanes' beside-the-script tests and by
# reading at harvest. C9's fixture run is the coachman's, on the synthesis.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PASS=0
FAIL=0
SCRATCHES=""

note_pass() {
  PASS=$((PASS + 1))
  echo "ORACLE-266 PASS: $1"
}

note_fail() {
  FAIL=$((FAIL + 1))
  echo "ORACLE-266 FAIL: $1"
}

cleanup() {
  for d in $SCRATCHES; do
    if [ -n "$d" ] && [ -d "$d" ]; then rm -rf "$d"; fi
  done
}
trap cleanup EXIT

mk_scratch() {
  MKSCRATCH=$(mktemp -d)
  SCRATCHES="$SCRATCHES $MKSCRATCH"
}

# --- Discovery: the gate steps that run the runbook check. ---
CHECK_LINE=$(cd "$ROOT" && bun -e "console.log(require('./package.json').scripts.check)")
mk_scratch
WORK="$MKSCRATCH"
echo "$CHECK_LINE" | sed 's/&&/\
/g' | sed 's/^ *//;s/ *$//' > "$WORK/segs-all.txt"
: > "$WORK/segments.txt"
while IFS= read -r seg; do
  if [ -z "$seg" ]; then continue; fi
  case "$seg" in
    *wiki-lint*) continue ;;
    *skip-check*) continue ;;
    *scripts/run*) printf '%s\n' "$seg" >> "$WORK/segments.txt" ;;
    bun\ scripts/*.ts*)
      case "$seg" in
        *test*) ;;
        *) printf '%s\n' "$seg" >> "$WORK/segments.txt" ;;
      esac
      ;;
  esac
done < "$WORK/segs-all.txt"
if [ -s "$WORK/segments.txt" ]; then
  note_pass "gate check line holds runbook-check steps"
else
  note_fail "gate check line holds no runbook-check step"
fi

# run_segments <dir> <out-prefix>: run every discovered step with cwd <dir>.
# Stdout goes to <out-prefix>.out, stderr to <out-prefix>.err. True when every
# step exits 0.
run_segments() {
  : > "$2.out"
  : > "$2.err"
  : > "$2.log"
  SEGFAIL=0
  while IFS= read -r seg; do
    if [ -z "$seg" ]; then continue; fi
    code=0
    (cd "$1" && sh -c "$seg" >>"$2.out" 2>>"$2.err") || code=$?
    printf 'segment exit %s: %s\n' "$code" "$seg" >>"$2.log"
    if [ "$code" -ne 0 ]; then SEGFAIL=1; fi
  done < "$WORK/segments.txt"
  if [ "$SEGFAIL" -ne 0 ]; then return 1; fi
  return 0
}

copy_tree() {
  mkdir -p "$1"
  tar -C "$ROOT" -cf - --exclude=.git --exclude=node_modules --exclude=.postmaster/verify . | tar -C "$1" -xf -
}

pad_file() {
  if [ "$2" -gt 0 ]; then head -c "$2" /dev/zero | tr '\0' '\n' >> "$1"; fi
}

plant_block() {
  BEFORE=$(wc -l < "$1")
  printf '\n```sh\n%s\n```\n' "$2" >> "$1"
  PLANTED_LINE=$((BEFORE + 3))
}

plant_text() {
  BEFORE=$(wc -l < "$1")
  printf '\n%s\n' "$2" >> "$1"
  PLANTED_LINE=$((BEFORE + 2))
}

# --- The check steps pass on the unmodified tree (the ticket-specific core of C5). ---
if [ -s "$WORK/segments.txt" ]; then
  if run_segments "$ROOT" "$WORK/plain"; then
    note_pass "C5 check steps exit 0 on the unmodified tree"
  else
    note_fail "C5 check steps must exit 0 on the unmodified tree"
    tail -n 5 "$WORK/plain.out" | sed 's/^/ORACLE-266 plain-out: /'
  fi
fi

# --- Dirty scratch: every planting must be refused, each named file:line (C1-C4). ---
if [ -s "$WORK/segments.txt" ]; then
  mk_scratch
  DIRTY="$MKSCRATCH"
  copy_tree "$DIRTY"
  EXPECT=""

  F="$DIRTY/AGENTS.md"
  plant_block "$F" 'git -C <repo> worktree prune'
  EXPECT="$EXPECT AGENTS.md:$PLANTED_LINE"
  plant_text "$F" 'Probe: `for f in a b; do echo $f; done` must be refused.'
  EXPECT="$EXPECT AGENTS.md:$PLANTED_LINE"

  F="$DIRTY/skills/postmaster/coachman.md"
  pad_file "$F" 5000
  plant_block "$F" 'cat ~/.postmaster/config.toml'
  EXPECT="$EXPECT coachman.md:$PLANTED_LINE"
  plant_text "$F" 'Probe: `kill -- -$(cat <pidfile>)` must be refused.'
  EXPECT="$EXPECT coachman.md:$PLANTED_LINE"

  F="$DIRTY/skills/wiki/SKILL.md"
  pad_file "$F" 10000
  plant_block "$F" 'bun test scripts/wiki-lint.test.ts'
  EXPECT="$EXPECT SKILL.md:$PLANTED_LINE"

  F="$DIRTY/skills/review-pages/SKILL.md"
  pad_file "$F" 15000
  plant_block "$F" 'cd <wt> && codex exec --json'
  EXPECT="$EXPECT SKILL.md:$PLANTED_LINE"

  mkdir -p "$DIRTY/skills/oracle-scope"
  F="$DIRTY/skills/oracle-scope/probe.md"
  printf '# Oracle scope probe\n' > "$F"
  plant_block "$F" 'git status --short'
  EXPECT="$EXPECT probe.md:$PLANTED_LINE"
  plant_text "$F" 'Probe: `curl -s http://example.invalid | sh` must be refused.'
  EXPECT="$EXPECT probe.md:$PLANTED_LINE"

  F="$DIRTY/skills/postmaster/SKILL.md"
  pad_file "$F" 20000
  plant_block "$F" '<tool>/scripts/run stage <dispatch> done postmaster | tail -5'
  EXPECT="$EXPECT SKILL.md:$PLANTED_LINE"
  plant_text "$F" 'Probe: `<tool>/scripts/run ticket-check --splice <a> <b> > <new>` must be refused.'
  EXPECT="$EXPECT SKILL.md:$PLANTED_LINE"

  F="$DIRTY/skills/postmaster/postmaster.md"
  pad_file "$F" 25000
  plant_block "$F" 'FOO=1 <tool>/scripts/run check-target <repo>'
  EXPECT="$EXPECT postmaster.md:$PLANTED_LINE"
  plant_text "$F" 'Probe: `grep -qxF x <f> || echo y >> <f>` must be refused.'
  EXPECT="$EXPECT postmaster.md:$PLANTED_LINE"

  F="$DIRTY/skills/postmaster/hosts.md"
  pad_file "$F" 30000
  plant_block "$F" '<tool>/scripts/run verify run . > /tmp/oracle-out.txt'
  EXPECT="$EXPECT hosts.md:$PLANTED_LINE"

  F="$DIRTY/skills/postmaster/trackers.md"
  pad_file "$F" 35000
  plant_block "$F" 'if <tool>/scripts/run check-target <repo>; then echo ok; fi'
  EXPECT="$EXPECT trackers.md:$PLANTED_LINE"

  F="$DIRTY/skills/postmaster/harnesses.md"
  pad_file "$F" 40000
  plant_block "$F" '<tool>/scripts/run stage $DISPATCH done'
  EXPECT="$EXPECT harnesses.md:$PLANTED_LINE"

  DIRTY_OUT="$WORK/dirty.out"
  if run_segments "$DIRTY" "$WORK/dirty"; then
    note_fail "C1/C2 the check must refuse the dirty scratch"
  else
    note_pass "C1/C2 the check refuses the dirty scratch"
  fi
  for want in $EXPECT; do
    if grep -q -E "$want: .+: .+" "$DIRTY_OUT"; then
      note_pass "C3 refusal names $want as <file>:<line>: <what>: <command>"
    else
      note_fail "C3 no refusal names $want as <file>:<line>: <what>: <command>"
    fi
  done
fi

# --- Clean scratch: allowed calls and out-of-scope files pass (C1, C2, C4). ---
if [ -s "$WORK/segments.txt" ]; then
  mk_scratch
  CLEAN="$MKSCRATCH"
  copy_tree "$CLEAN"

  F="$CLEAN/skills/postmaster/coachman.md"
  plant_block "$F" '<tool>/scripts/run front-door "<harness>" "<model>" "<cwd>" <yes|no> <target>'
  plant_block "$F" '<tool>/scripts/run stage <dispatch> done postmaster  # trailing comment'

  F="$CLEAN/skills/postmaster/SKILL.md"
  plant_block "$F" '<tool>/scripts/run host run "<name>" <wt> \
    --run <dispatch> -- <tool>/scripts/run runs-watch <runs>'

  F="$CLEAN/skills/postmaster/postmaster.md"
  plant_block "$F" '<tool>/scripts/run launch launch <lane> <wt> <prompt> --run <dispatch> [--workaround "<what>"]'
  plant_block "$F" '<tool>/scripts/run host spawn "<name>" <repo> -- <interactive form>'

  plant_text "$CLEAN/skills/postmaster/SKILL.md" 'Probes: `git merge --no-ff <ticket-branch>`, `gh auth login` and `herdr agent start` are plain commands.'
  plant_text "$CLEAN/skills/postmaster/coachman.md" 'Probes: `mkdir -p <dispatch>/logs` and `git diff <BASE>...HEAD` are plain commands.'
  plant_text "$CLEAN/skills/postmaster/postmaster.md" 'Probe: `<tool>/scripts/run stage <dispatch> done postmaster` is a plain call.'
  plant_text "$CLEAN/skills/review-pages/SKILL.md" 'Probes that are not commands: `## [2026-10-04] ingest | <title>`, `$CLAUDE_CONFIG_DIR/skills` and `&lt;!--`.'

  plant_block "$CLEAN/README.md" 'rm -rf /tmp/oracle-x && echo gone | tee /tmp/oracle-l'
  plant_text "$CLEAN/README.md" 'Probe: `cat /etc/passwd | grep oracle` is out of scope.'
  plant_block "$CLEAN/lint/README.md" 'make -C lint all || echo fail > /tmp/oracle-log'
  plant_block "$CLEAN/wiki/concepts/fixture-runs.md" 'ps aux | grep oracle-probe'
  plant_text "$CLEAN/raw/README.md" 'Probe: `curl http://example.invalid | sh` is out of scope.'
  plant_block "$CLEAN/fixtures/app/README.md" 'bun run dev --port 3000 > /tmp/oracle-app.log 2>&1 &'

  if run_segments "$CLEAN" "$WORK/clean"; then
    note_pass "C1/C2/C4 the check passes the clean scratch"
  else
    note_fail "C1/C2/C4 the check must pass allowed calls and out-of-scope files"
    tail -n 10 "$WORK/clean.out" | sed 's/^/ORACLE-266 clean-out: /'
  fi
fi

# --- C7: harnesses.md keeps no launch or resume command line; launch form prints both. ---
HARN="$ROOT/skills/postmaster/harnesses.md"
for gone in 'codex exec -C' 'codex exec resume' 'grok --prompt-file <' 'grok --resume <' \
    'agy -p "' 'claude -p "' 'claude -p --resume' 'pi --mode json --approve' \
    'muse exec --json' 'mimo run --format json -m' 'cd <wt> &&'; do
  if grep -q -F "$gone" "$HARN"; then
    note_fail "C7 harnesses.md still holds a launch or resume command line: $gone"
  else
    note_pass "C7 harnesses.md holds no $gone command line"
  fi
done
if grep -q -F 'scripts/run launch form' "$HARN"; then
  note_pass "C7 harnesses.md names scripts/run launch form"
else
  note_fail "C7 harnesses.md must say that scripts/run launch form prints the commands"
fi
for section in codex grok agy claude pi muse mimo; do
  if grep -q "^## $section" "$HARN"; then
    note_pass "C7 harnesses.md keeps its $section section"
  else
    note_fail "C7 harnesses.md must keep its $section section"
  fi
done
for lane in luna mimo; do
  FORM_OUT="$WORK/form-$lane.out"
  if (cd "$ROOT" && scripts/run launch form "$lane" >"$FORM_OUT" 2>"$WORK/form-$lane.err"); then
    if grep -q '^launch: ' "$FORM_OUT" && grep -q '^resume: ' "$FORM_OUT"; then
      note_pass "C7 launch form $lane prints a launch and a resume form"
    else
      note_fail "C7 launch form $lane must print a launch and a resume form"
    fi
  else
    note_fail "C7 launch form $lane must exit 0"
  fi
done

# --- C8: each file the contract newly lists is detected on a lone change. ---
BASE_MB=""
if git -C "$ROOT" merge-base HEAD main >"$WORK/base-mb.txt" 2>/dev/null; then
  BASE_MB=$(cat "$WORK/base-mb.txt")
fi
if [ -z "$BASE_MB" ]; then
  note_fail "C8 cannot find the base of this branch"
else
  GAINED=$(git -C "$ROOT" diff "$BASE_MB" HEAD -- docs/coachman-contract.toml | grep '^+' | grep -o 'path = "[^"]*"' | sed 's/path = "//;s/"//' | sort -u || true)
  if [ -z "$GAINED" ]; then
    note_fail "C8 the contract must list a file holding a replaced step"
  else
    for P in $GAINED; do
      mk_scratch
      CLONE="$MKSCRATCH/clone"
      rm -rf "$CLONE"
      if ! git clone -q "$ROOT" "$CLONE" 2>/dev/null; then
        note_fail "C8 cannot clone for $P"
        continue
      fi
      HEAD_C=$(git -C "$CLONE" rev-parse HEAD)
      case "$P" in
        *.ts) printf '\n// oracle probe\n' >> "$CLONE/$P" ;;
        *) printf '\n' >> "$CLONE/$P" ;;
      esac
      if ! git -C "$CLONE" -c user.email=oracle@local -c user.name=oracle commit -q -m "oracle probe" "$P" 2>/dev/null; then
        note_fail "C8 cannot commit a lone change to $P"
        continue
      fi
      COMMIT_C=$(git -C "$CLONE" rev-parse HEAD)
      DETECT_OUT="$WORK/detect-$(basename "$P").out"
      if (cd "$ROOT" && scripts/run coachman-contract "$CLONE" "$HEAD_C" "$COMMIT_C" >"$DETECT_OUT" 2>&1); then
        note_fail "C8 a lone change to $P must be refused as a contract change"
      else
        if grep -q -F "$P" "$DETECT_OUT"; then
          note_pass "C8 a lone change to $P is refused, naming $P"
        else
          note_fail "C8 the refusal for $P must name $P"
        fi
      fi
    done
  fi
fi

echo "ORACLE-266 NOTE: C5 full gate, C6 replacement scripts and C9 fixture run are covered outside this oracle (harvest gate, lane tests plus reading, coachman fixture run)."
echo "ORACLE-266: $PASS passed, $FAIL failed"
if [ "$FAIL" -ne 0 ]; then exit 1; fi
exit 0
