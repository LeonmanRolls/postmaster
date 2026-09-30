#!/usr/bin/env bash
# Oracle for #158: blind acceptance tests for criterion 5 at the ticket's own interface.
#
# Written by the leg-1 coachman after the ticket gained criterion 5 (a lint rule run by
# Oxlint on Bun) and before any lane implemented anything: no lane diff existed when this
# was written. It checks only what the ticket names: Oxlint run on Bun with the project's
# `.oxlintrc.json` passes a test file beside its target, and fails one with no sibling
# target or one sitting in a separate test folder. It asserts behavior only (exit status
# and the file named in the output), never rule names, messages, or config internals,
# which are the implementation's choice.
#
#   oracle-158.sh           run from the repo root; exit 0 when the worktree meets
#                           criterion 5, 1 otherwise, one line per probe
#
# BASE calibration (73fca4e): 0/4 pass; P0 fails (no `.oxlintrc.json`) and P1-P3 fail
# with it. A lane passes a probe only by implementing the ticket. Validated to 4/4
# against a trial rule in scratch through the identical command.
#
# Deferred to synthesis against the decided contract (the script's CLI spelling, the
# SHARES line layout and the shares.json field names are the implementation's choice
# per the approved spec, so no blind fixture can invoke them): criteria 1-4, by reading
# each lane's diff and executing each lane's own controls at harvest.
set -uo pipefail

[ -f "skills/postmaster/coachman.md" ] || { echo "oracle: run from the repo root: skills/postmaster/coachman.md not found" >&2; exit 1; }

fail=0
pass() { echo "PASS $1: $2"; }
nope() { echo "FAIL $1: $2"; fail=1; }

# P0: the ticket's interface exists: project config plus a runnable Oxlint on Bun.
if [ -f ".oxlintrc.json" ]; then
  if [ ! -x "node_modules/.bin/oxlint" ]; then
    bun install >/dev/null 2>&1 || true
  fi
  if bun x --bun oxlint --version >/dev/null 2>&1; then
    pass P0-setup "Oxlint runs on Bun with .oxlintrc.json"
    READY=1
  else
    nope P0-setup "Oxlint does not run on Bun"
    READY=0
  fi
else
  nope P0-setup "no .oxlintrc.json at the repo root"
  READY=0
fi

# lint_one <file>: run the project's Oxlint over one fixture file with the project's
# config pinned, so a planted config cannot change the verdict; prints output, exits its exit.
lint_one() {
  bun x --bun oxlint --config=.oxlintrc.json "$1" 2>&1
}

if [ "$READY" -eq 1 ]; then
  # P1: a test file beside its target passes.
  D1=$(mktemp -d)
  mkdir -p "$D1/ok"
  printf 'export const name = 1;\n' > "$D1/ok/name.ts"
  printf 'import { name } from "./name";\nexport const check = name;\n' > "$D1/ok/name.test.ts"
  OUT1=$(lint_one "$D1/ok/name.test.ts"); RC1=$?
  if [ "$RC1" -eq 0 ]; then
    pass P1-beside-target "test beside its target passes"
  else
    nope P1-beside-target "test beside its target exits $RC1: $OUT1"
  fi
  rm -rf "$D1"

  # P2: a test file with no sibling target fails, naming the file.
  D2=$(mktemp -d)
  mkdir -p "$D2/lone"
  printf 'export const check = 1;\n' > "$D2/lone/lone.test.ts"
  OUT2=$(lint_one "$D2/lone/lone.test.ts"); RC2=$?
  if [ "$RC2" -ne 0 ] && printf '%s' "$OUT2" | grep -qF "$D2/lone/lone.test.ts"; then
    pass P2-no-target "test with no sibling target fails naming the file"
  else
    nope P2-no-target "test with no sibling target exits $RC2: $OUT2"
  fi
  rm -rf "$D2"

  # P3: a test file in a separate test folder fails, naming the file, even with a
  # sibling target present, so the folder alone is the cause.
  D3=$(mktemp -d)
  mkdir -p "$D3/test"
  printf 'export const name = 1;\n' > "$D3/test/name.ts"
  printf 'import { name } from "./name";\nexport const check = name;\n' > "$D3/test/name.test.ts"
  OUT3=$(lint_one "$D3/test/name.test.ts"); RC3=$?
  if [ "$RC3" -ne 0 ] && printf '%s' "$OUT3" | grep -qF "$D3/test/name.test.ts"; then
    pass P3-test-folder "test in a test folder fails naming the file"
  else
    nope P3-test-folder "test in a test folder exits $RC3: $OUT3"
  fi
  rm -rf "$D3"
else
  nope P1-beside-target "no runnable Oxlint to check the pass case"
  nope P2-no-target "no runnable Oxlint to check the missing-target case"
  nope P3-test-folder "no runnable Oxlint to check the test-folder case"
fi

echo "oracle-158: $([ "$fail" -eq 0 ] && echo PASS || echo FAIL)"
exit "$fail"
