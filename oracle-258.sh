#!/usr/bin/env bash
# Oracle for #258: blind acceptance tests at the ticket's own interface.
#
# Written from the ticket's checks C1-C12 before any lane's diff, committed on
# the ticket branch, and run against each lane's work at harvest by cherry-picking
# this commit onto a scratch of the lane. Every test uses only what the ticket
# names - files, commands and their output - never a function shape the lanes
# chose. Three checks have no oracle coverage: C1 on macOS needs a Mac, the
# skip-list entry shape (C2) and the landing question's invocation (C9, C10) are
# the lanes' to choose. Those are verified by execution and reading at harvest.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PASS=0
FAIL=0

note_pass() {
  PASS=$((PASS + 1))
  echo "ORACLE-258 PASS: $1"
}

note_fail() {
  FAIL=$((FAIL + 1))
  echo "ORACLE-258 FAIL: $1"
}

ORACLE_PARENT=$(mktemp -d)
cleanup() {
  rm -rf "$ORACLE_PARENT"
}
trap cleanup EXIT

mk_scratch() {
  MKSCRATCH=$(mktemp -d "$ORACLE_PARENT/scratch.XXXXXX")
}

# --- C11: the README names Linux and macOS as supported; Intel Macs not tested.
if grep -q "Linux" "$ROOT/README.md" && grep -q "macOS" "$ROOT/README.md"; then
  note_pass "C11 README names Linux and macOS"
else
  note_fail "C11 README must name Linux and macOS as supported"
fi
if grep -q "Intel" "$ROOT/README.md" && grep -qi "not tested" "$ROOT/README.md"; then
  note_pass "C11 README says Intel Macs are not tested"
else
  note_fail "C11 README must say that Intel Macs are not tested"
fi

# --- C12: no list of what postmaster needs names Python.
NEEDS=$(sed -n '/^## What it needs/,/^## /p' "$ROOT/README.md")
if echo "$NEEDS" | grep -qi "python"; then
  note_fail "C12 README What-it-needs still names Python"
else
  note_pass "C12 README What-it-needs names no Python"
fi
if grep -q "Python 3.11" "$ROOT/README.md"; then
  note_fail "C12 README still carries the Python 3.11 requirement"
else
  note_pass "C12 README Python 3.11 requirement gone"
fi
if grep -q "beyond bash, git and python3" "$ROOT/skills/postmaster/trackers.md"; then
  note_fail "C12 trackers.md still names python3 as a need"
else
  note_pass "C12 trackers.md python3 need gone"
fi

# --- C5, C6: a pull-request workflow with Linux and Mac jobs; the Mac job
# --- pins the stock bash. C7 (static half): an old-Bun job exists.
WF_FILES=""
for f in "$ROOT/.github/workflows/"*.yml "$ROOT/.github/workflows/"*.yaml; do
  [ -f "$f" ] || continue
  if grep -q "pull_request" "$f"; then
    WF_FILES="$WF_FILES $f"
  fi
done
if [ -z "$WF_FILES" ]; then
  note_fail "C5 no workflow runs on pull_request"
else
  BOTH=0
  for f in $WF_FILES; do
    if grep -q "ubuntu-latest" "$f" && grep -q "macos-latest" "$f"; then
      BOTH=1
    fi
  done
  if [ "$BOTH" -eq 1 ]; then
    note_pass "C5 one workflow holds Linux and Mac jobs"
  else
    note_fail "C5 no one workflow holds both ubuntu-latest and macos-latest jobs"
  fi
  for token in "ubuntu-latest" "macos-latest" "fetch-depth" "setup-bun" "frozen-lockfile" "bun run check"; do
    if grep -q "$token" $WF_FILES; then
      note_pass "C5 workflow names $token"
    else
      note_fail "C5 workflow must name $token (full-history checkout, frozen install, full check)"
    fi
  done
  if grep -q "1.4.2" $WF_FILES; then
    note_pass "C5 workflow pins Bun at the minimum"
  elif grep -q "engines" $WF_FILES && grep -q "bun-version" $WF_FILES && grep -q "steps\." $WF_FILES; then
    note_pass "C5 workflow reads Bun at the minimum from the manifest"
  else
    note_fail "C5 workflow must run Bun at the minimum, pinned or read from the manifest"
  fi
  if grep -q "fetch-depth" $WF_FILES && grep -q "fetch-depth: *['\"]\?0" $WF_FILES; then
    note_pass "C5 checkout is full-history"
  else
    note_fail "C5 checkout must be full-history (fetch-depth 0: tests read old commits)"
  fi
  if grep -q "/usr/bin/env bash" $WF_FILES && grep -q "3.2" $WF_FILES; then
    note_pass "C6 Mac job pins the stock bash 3.2"
  else
    note_fail "C6 Mac job must check the bash /usr/bin/env bash finds is 3.2"
  fi
  if grep -q "1.3.14" $WF_FILES && grep -q "scripts/run" $WF_FILES; then
    note_pass "C7 old-Bun job starts scripts through the start command"
  elif grep -q "1.3.14" $WF_FILES && grep -q "old-bun" $WF_FILES && grep -q 'join(dir, "run")' "$ROOT/scripts/old-bun.ts" 2>/dev/null && grep -q 'spawnSync("bash"' "$ROOT/scripts/old-bun.ts" 2>/dev/null; then
    note_pass "C7 old-Bun job drives scripts through the start command"
  else
    note_fail "C7 a job must start scripts through scripts/run under Bun 1.3.14"
  fi
fi

# --- C8: the start command refuses a Bun older than the minimum, before load.
BUNV=$(bun --version)
mk_tool_copy() {
  dest=$1
  mkdir -p "$dest"
  cp "$ROOT/package.json" "$ROOT/bunfig.toml" "$dest/"
  cp -r "$ROOT/scripts" "$dest/scripts"
  printf '%s\n' 'console.log("stand-in 258 ok");' > "$dest/scripts/oracle-258-standin-good.ts"
  printf '%s\n' 'import { __oracle_missing_258__ } from "./lib/proc.ts";' 'console.log(__oracle_missing_258__);' > "$dest/scripts/oracle-258-standin-bad.ts"
}
bump_minimum() {
  file=$1
  vers=$2
  sed "s/\"bun\": \"[^\"]*\"/\"bun\": \">=$vers\"/" "$file" > "$file.new" && mv "$file.new" "$file"
  grep -q "$vers" "$file"
}

mk_scratch; T5A=$MKSCRATCH
mk_tool_copy "$T5A"
if bump_minimum "$T5A/package.json" "9.9.9"; then
  code=0
  "$T5A/scripts/run" oracle-258-standin-bad >"$T5A/out.txt" 2>"$T5A/err.txt" || code=$?
  if [ "$code" -ne 0 ] && [ ! -s "$T5A/out.txt" ] && grep -q "9.9.9" "$T5A/err.txt" && grep -q "$BUNV" "$T5A/err.txt"; then
    note_pass "C8 raised minimum refuses before load, naming needed and found"
  else
    note_fail "C8 under minimum 9.9.9 the start command must exit non-zero with empty stdout and both versions on stderr (exit $code)"
  fi
  if grep -q "not found in module" "$T5A/err.txt"; then
    note_fail "C8 the version message must come before Bun's load error, not after it"
  else
    note_pass "C8 refusal precedes the load error"
  fi
else
  note_fail "C8 oracle setup: could not raise the copy's minimum to 9.9.9"
fi

mk_scratch; T5B=$MKSCRATCH
mk_tool_copy "$T5B"
if bump_minimum "$T5B/package.json" "1.4.10"; then
  code=0
  "$T5B/scripts/run" oracle-258-standin-good >"$T5B/out.txt" 2>"$T5B/err.txt" || code=$?
  if [ "$code" -ne 0 ] && grep -q "1.4.10" "$T5B/err.txt"; then
    note_pass "C8 versions compare as numbers (1.4.2 is older than 1.4.10)"
  else
    note_fail "C8 versions must compare as numbers: 1.4.2 under minimum 1.4.10 must be refused (exit $code)"
  fi
else
  note_fail "C8 oracle setup: could not raise the copy's minimum to 1.4.10"
fi

mk_scratch; T5C=$MKSCRATCH
mk_tool_copy "$T5C"
code=0
"$T5C/scripts/run" oracle-258-standin-good >"$T5C/out.txt" 2>"$T5C/err.txt" || code=$?
if [ "$code" -eq 0 ] && grep -q "stand-in 258 ok" "$T5C/out.txt"; then
  note_pass "C8 the running Bun passes the version check"
else
  note_fail "C8 the running Bun ($BUNV) must pass the version check (exit $code)"
fi

# --- C3, C4: a planted skip and a planted vacuous test fail the check, named.
mk_scratch; T1=$MKSCRATCH
cp -r "$ROOT/." "$T1/tree"
# Sibling target: the gate's test-beside-target rule needs it beside the plant.
printf '%s\n' 'export const oracle258Plant = "plant";' > "$T1/tree/scripts/oracle-258-plant.ts"
cat > "$T1/tree/scripts/oracle-258-plant.test.ts" <<'EOF'
import { describe, expect, test } from "bun:test";

describe("oracle 258 plant", () => {
  // skipIf(true): the repo's bun:test types expose no test.skip, and the gate
  // runs tsc first. The ticket verified skipIf marks <skipped/> like skip.
  test.skipIf(true)("planted skip 258", () => {
    expect(1).toBe(1);
  });
  test("planted vacuous 258", () => {
    if (Date.now() > 0) return;
    expect(1).toBe(1);
  });
});
EOF
code=0
if [ ! -d "$T1/tree/node_modules" ]; then
  (cd "$T1/tree" && bun install --frozen-lockfile >"$T1/install.log" 2>&1) || code=$?
  if [ "$code" -ne 0 ]; then
    note_fail "C3/C4 oracle setup: frozen install failed in the scratch copy"
  fi
fi
if [ "$code" -eq 0 ]; then
  (cd "$T1/tree" && bun run check >"$T1/check.log" 2>&1) || code=$?
  if [ "$code" -ne 0 ]; then
    note_pass "C3/C4 planted skip and vacuous test fail the check"
  else
    note_fail "C3/C4 a planted skip and a planted vacuous test must fail the check"
  fi
  if grep -q "planted skip 258" "$T1/check.log" && grep -q "oracle-258-plant" "$T1/check.log"; then
    note_pass "C3 failure names the planted skip's file and test"
  else
    note_fail "C3 failure must name the planted skip's file and test"
  fi
  if grep -q "planted vacuous 258" "$T1/check.log"; then
    note_pass "C4 failure names the planted vacuous test"
  else
    note_fail "C4 failure must name the planted vacuous test as a hidden skip"
  fi
fi

echo "ORACLE-258: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
