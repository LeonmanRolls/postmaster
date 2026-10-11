#!/usr/bin/env bash
# oracle-268.sh — the run's blind acceptance tests for #268.
#
# Written before any lane's diff was read. It turns the ticket's checks C1, C2,
# C3, C4, C8 and C10 into scenarios at the ticket's own interface: a scratch
# repository made from the base (the base tree committed as `main`, a ticket
# branch `t` cut from it), planted per check, with the new landing call run
# against it.
#
# The new call's name and form are the lanes' design choice, so this script
# takes its invocation as ORACLE_CALL, evaluated from the repository root that
# holds this script, with these variables exported per scenario:
#   ORACLE_REPO         path of the scratch repository
#   ORACLE_MAIN_BRANCH  the default branch in it (main)
#   ORACLE_T_BRANCH     the ticket branch in it (t)
#   ORACLE_HEAD_SHA     t's head after the plant is committed
# Everything else is fixed: exit 0 means clear, non-zero means held (C10 pins
# clear to exit 0, C1 pins held to the exit status), and the listing assertions
# below are the ticket's wording (file, reason, listed once / not listed).
#
# Not covered here, and why: C5 (needs a fixture run's card; checked on the
# fixture run's records), C6/C7/C9 (the Stage F ask-record-withhold flow;
# exercised against the real scripts at synthesis), C11 (the fixture run from
# the branch itself, which the contract requires before merge).
#
# Calibration (af47492, identical command): ORACLE_CALL='true' gives 11 passed
# (every clear-path and absence assertion) and 44 failed (every held-path
# assertion), so the held path demands detection. A naive line-grep detector
# that lists changed files whose added lines hold the ticket's forms gives 49
# passed and 6 failed: C2-deponly, C3's strings and writer files, and C8-biome,
# exactly the places where the ticket demands more than grep. No lane
# implementation existed when this was written or calibrated.
#
# usage: ORACLE_CALL='<invocation>' ./oracle-268.sh [--base <sha>]
set -uo pipefail

BASE_DEFAULT="af47492a8c1932f622a1e2e6baedf3813ff3dd30"
BASE="$BASE_DEFAULT"
while [ $# -gt 0 ]; do
  case "$1" in
    --base) BASE="$2"; shift 2 ;;
    *) echo "usage: ORACLE_CALL='<call>' $0 [--base <sha>]"; exit 2 ;;
  esac
done

if [ -z "${ORACLE_CALL:-}" ]; then
  echo "oracle-268: ORACLE_CALL is not set"
  exit 2
fi
command -v python3 >/dev/null 2>&1 || { echo "oracle-268: needs python3"; exit 2; }

ROOT="$(cd "$(dirname "$0")" && pwd)"
PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "ok: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "FAIL: $1: $2"; }

SCRATCH="$(mktemp -d /tmp/oracle-268.XXXXXX)"
OUTDIR="$(mktemp -d /tmp/oracle-268-out.XXXXXX)"
cleanup() { rm -rf "$SCRATCH" "$OUTDIR"; }
trap cleanup EXIT

sgit() { git -c user.name=oracle-268 -c user.email=oracle-268@local -C "$SCRATCH" "$@"; }

git -C "$ROOT" archive --format=tar "$BASE" | tar -x -C "$SCRATCH"
sgit init -q
sgit checkout -q -b main
sgit add -A
sgit commit -qm "base tree as main"

fresh_t() { sgit checkout -q -B t main; }
commit_t() { sgit add -A; sgit commit -qm "$1"; }

run_call() { # $1 = scenario name; output to $OUTDIR/$1.out, exit in CALL_EXIT
  export ORACLE_REPO="$SCRATCH"
  export ORACLE_MAIN_BRANCH="main"
  export ORACLE_T_BRANCH="t"
  ORACLE_HEAD_SHA="$(sgit rev-parse t)"
  export ORACLE_HEAD_SHA
  ( cd "$ROOT" && eval "$ORACLE_CALL" >"$OUTDIR/$1.out" 2>&1 )
  CALL_EXIT=$?
}

expect_held() { # $1 scenario, $2 exit
  if [ "$2" -ne 0 ]; then pass "$1 held (exit $2)"; else fail "$1" "expected held (non-zero exit), got exit 0"; fi
}
expect_clear() { # $1 scenario, $2 exit
  if [ "$2" -eq 0 ]; then pass "$1 clear (exit 0)"; else fail "$1" "expected clear (exit 0), got exit $2"; fi
}
expect_once() { # $1 scenario, $2 outfile, $3 needle
  n=$(grep -c -F "$3" "$2" || true)
  if [ "$n" -eq 1 ]; then pass "$1 lists $3 once"; else fail "$1" "expected $3 listed once, found $n times"; fi
}
expect_present() { # $1 scenario, $2 outfile, $3 needle
  if grep -q -F "$3" "$2"; then pass "$1 lists $3"; else fail "$1" "expected $3 in the listing, missing"; fi
}
expect_absent() { # $1 scenario, $2 outfile, $3 needle
  if grep -q -F "$3" "$2"; then fail "$1" "must not list $3, but it does"; else pass "$1 omits $3"; fi
}

# --- C1: every comment form, each with a reason, in its own file ---
fresh_t
cat > "$SCRATCH/scripts/c1-a.ts" <<'EOF'
// @ts-ignore reason-c1-a
const a: number = "not a number";
EOF
cat > "$SCRATCH/scripts/c1-b.ts" <<'EOF'
/* @ts-ignore reason-c1-b */
const b: number = "not a number";
EOF
cat > "$SCRATCH/scripts/c1-c.ts" <<'EOF'
// @ts-expect-error reason-c1-c
const c: number = "not a number";
EOF
cat > "$SCRATCH/scripts/c1-d.ts" <<'EOF'
// @ts-nocheck reason-c1-d
const d: number = "not a number";
EOF
cat > "$SCRATCH/scripts/c1-e.ts" <<'EOF'
// eslint-disable-next-line no-debugger -- reason-c1-e
debugger;
EOF
cat > "$SCRATCH/scripts/c1-f.ts" <<'EOF'
debugger; // oxlint-disable-line no-debugger -- reason-c1-f
EOF
cat > "$SCRATCH/scripts/c1-g.ts" <<'EOF'
/* eslint-disable -- reason-c1-g */
debugger;
EOF
cat > "$SCRATCH/scripts/c1-h.ts" <<'EOF'
/* oxlint-disable no-debugger -- reason-c1-h */
debugger;
EOF
cat > "$SCRATCH/scripts/c1-i.ts" <<'EOF'
// biome-ignore format: reason-c1-i
const    i    =    1;
EOF
cat > "$SCRATCH/scripts/c1-j.ts" <<'EOF'
// biome-ignore-all format: reason-c1-j
const    j    =    2;
EOF
commit_t "C1 plants"
run_call c1
expect_held "C1" "$CALL_EXIT"
for f in c1-a c1-b c1-c c1-d c1-e c1-f c1-g c1-h c1-i c1-j; do
  expect_once "C1" "$OUTDIR/c1.out" "$f.ts"
  expect_present "C1" "$OUTDIR/c1.out" "reason-$f"
done

# --- C2: settings changes, each alone, are held ---
c2_case() { # $1 name, $2 file expected in the listing, $@ plant commands already run
  commit_t "C2 $1 plant"
  run_call "c2-$1"
  expect_held "C2-$1" "$CALL_EXIT"
  expect_present "C2-$1" "$OUTDIR/c2-$1.out" "$2"
}
fresh_t
python3 - "$SCRATCH/.oxlintrc.json" <<'EOF'
import json, sys
p = sys.argv[1]
d = json.load(open(p))
d["rules"]["postmaster/test-beside-target"] = "off"
json.dump(d, open(p, "w"), indent=2)
EOF
c2_case oxlintrc ".oxlintrc.json"
fresh_t
python3 - "$SCRATCH/tsconfig.json" <<'EOF'
import json, sys
p = sys.argv[1]
d = json.load(open(p))
d["compilerOptions"]["strict"] = False
json.dump(d, open(p, "w"), indent=2)
EOF
c2_case tsconfig "tsconfig.json"
fresh_t
python3 - "$SCRATCH/biome.json" <<'EOF'
import json, sys
p = sys.argv[1]
d = json.load(open(p))
d["overrides"].append({"includes": ["scripts/**"], "formatter": {"enabled": False}})
json.dump(d, open(p, "w"), indent=2)
EOF
c2_case biome "biome.json"
fresh_t
python3 - "$SCRATCH/package.json" <<'EOF'
import json, sys
p = sys.argv[1]
d = json.load(open(p))
d["scripts"]["check"] = d["scripts"]["check"].replace("bunx oxlint && ", "")
json.dump(d, open(p, "w"), indent=2)
EOF
c2_case pkgscripts "package.json"
fresh_t
printf '\n[test]\n' >> "$SCRATCH/bunfig.toml"
c2_case bunfig "bunfig.toml"
fresh_t
cat > "$SCRATCH/scripts/tsconfig.json" <<'EOF'
{"extends": "../tsconfig.json"}
EOF
c2_case newtsconfig "scripts/tsconfig.json"
fresh_t
rm "$SCRATCH/.oxlintrc.json"
c2_case deloxlintrc ".oxlintrc.json"
fresh_t
python3 - "$SCRATCH/package.json" <<'EOF'
import json, sys
p = sys.argv[1]
d = json.load(open(p))
d.setdefault("dependencies", {})["oracle-268-probe"] = "1.0.0"
json.dump(d, open(p, "w"), indent=2)
EOF
commit_t "C2 dependency-only plant"
run_call c2-deponly
expect_clear "C2-deponly" "$CALL_EXIT"
expect_absent "C2-deponly" "$OUTDIR/c2-deponly.out" "package.json"

# --- C3: switch-off text outside real comments is not listed ---
fresh_t
cat > "$SCRATCH/scripts/c3-strings.ts" <<'EOF'
const s1 = "// @ts-ignore probe-c3-double";
const s2 = '// oxlint-disable-line no-debugger -- probe-c3-single';
const s3 = `/* eslint-disable probe-c3-template */`;
const who = "world";
const s4 = `value ${who} // biome-ignore format: probe-c3-interp`;
const re = /eslint-disable probe-c3-regex/;
export { s1, s2, s3, s4, re, who };
EOF
cat > "$SCRATCH/scripts/c3-writer.ts" <<'EOF'
import { writeFileSync } from "node:fs";
writeFileSync("c3-out.txt", "/* eslint-disable */\n// @ts-ignore probe-c3-written\n");
EOF
cat > "$SCRATCH/scripts/c3-note.md" <<'EOF'
# note
Text mentioning eslint-disable-next-line and @ts-ignore and biome-ignore
format: probe-c3-markdown.
EOF
cat > "$SCRATCH/scripts/c3-real.ts" <<'EOF'
// eslint-disable-next-line no-debugger -- reason-c3-real
debugger;
EOF
cat > "$SCRATCH/scripts/c3-nest.ts" <<'EOF'
const v = `${1 + 1 /* oxlint-disable no-unused-expressions -- reason-c3-nested */}`;
export { v };
EOF
commit_t "C3 plants"
run_call c3
expect_held "C3" "$CALL_EXIT"
expect_once "C3" "$OUTDIR/c3.out" "c3-real.ts"
expect_present "C3" "$OUTDIR/c3.out" "reason-c3-real"
expect_once "C3" "$OUTDIR/c3.out" "c3-nest.ts"
expect_present "C3" "$OUTDIR/c3.out" "reason-c3-nested"
expect_absent "C3" "$OUTDIR/c3.out" "c3-strings.ts"
expect_absent "C3" "$OUTDIR/c3.out" "c3-writer.ts"
expect_absent "C3" "$OUTDIR/c3.out" "c3-note.md"

# --- C8: reasonless switch-offs are listed; reasonless Biome is not ---
fresh_t
cat > "$SCRATCH/scripts/c8-a.ts" <<'EOF'
// eslint-disable-next-line no-debugger
debugger;
EOF
cat > "$SCRATCH/scripts/c8-b.ts" <<'EOF'
// @ts-ignore
const b: number = "not a number";
EOF
cat > "$SCRATCH/scripts/c8-c.ts" <<'EOF'
/* oxlint-disable */
debugger;
EOF
commit_t "C8 plants"
run_call c8
expect_held "C8" "$CALL_EXIT"
for f in c8-a c8-b c8-c; do
  expect_once "C8" "$OUTDIR/c8.out" "$f.ts"
done
fresh_t
cat > "$SCRATCH/scripts/c8-d.ts" <<'EOF'
// biome-ignore format
const    d    =    4;
EOF
commit_t "C8 reasonless Biome plant"
run_call c8-biome
expect_clear "C8-biome" "$CALL_EXIT"
expect_absent "C8-biome" "$OUTDIR/c8-biome.out" "c8-d.ts"

# --- C10: a branch adding no switch-off is clear ---
fresh_t
cat > "$SCRATCH/scripts/c10-plain.ts" <<'EOF'
export const plain = 1;
EOF
commit_t "C10 innocent plant"
run_call c10
expect_clear "C10" "$CALL_EXIT"

# --- C4: main's later switch-off is not the run's (mutates scratch main; runs last) ---
fresh_t
cat > "$SCRATCH/scripts/c4-t.ts" <<'EOF'
export const t = 1;
EOF
commit_t "t work"
sgit checkout -q main
cat > "$SCRATCH/scripts/c4-main.ts" <<'EOF'
// eslint-disable-next-line no-debugger -- reason-c4-main
debugger;
EOF
sgit add -A
sgit commit -qm "main gains a switch-off"
sgit checkout -q t
sgit merge -q -m "merge main" main
run_call c4
expect_clear "C4" "$CALL_EXIT"
expect_absent "C4" "$OUTDIR/c4.out" "c4-main.ts"
expect_absent "C4" "$OUTDIR/c4.out" "launch.ts"

echo "oracle-268: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
