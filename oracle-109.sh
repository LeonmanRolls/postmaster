#!/usr/bin/env bash
# Blind oracle for #109: Rewrite the scripts in TypeScript, run by Bun.
#
# Written by the leg-1 coachman from the ticket's acceptance criteria and User
# journey BEFORE reading any lane's diff or log, and committed as the first
# commit on the ticket branch. Tests at the ticket's own interface: script
# paths, arguments, outputs and exits, package.json, and docs. Never a function
# shape, which is what the lanes were dispatched to choose.
#
# Amended once in review (round 1): the AC1 python grep and the AC4 import
# regex scanned raw text, so vocabulary ("python3" as an interpreter name)
# and fixture sources (import lines written as test data) failed them on a
# compliant port. All four round-1 lanes challenged both checks
# independently; the amendment narrows AC1 to executable Python and AC4 to
# imports Bun's own parser reports, each proven both ways (a planted
# run("python3") and a planted bare import still fail). AC2, AC3, AC5 and AC6
# are untouched and still blind.
#
# Amended twice in review (round 3, on ruling): the AC1 pattern missed
# versioned interpreters in spawn positions (run("python3.11") and kin), and
# the AC4 classifier exempted every bare specifier starting with "bun"
# ("bunyan" passed silent). Both proven by execution; a --self-test now
# locks the patterns against fixtures. AC2, AC3, AC5 and AC6 still blind.
#
# Amended thrice in review (round 10, on ruling): the live python3 the old
# self-tests spawned is committed fixtures now, so any spawn is a failure
# again — and the pattern covers every spawn form (execFile and exec joined
# run/spawn/Bun.spawn, sync and versioned alike). Full-line // comments are
# prose, not execution, and no longer match; trailing prose with spawn
# syntax would still flag (none exists). AC2, AC3, AC5 and AC6 still blind.
#
# Usage: ./oracle-109.sh [--self-test]   (runs from the repo root; installs deps if needed)
# Exit 0 when every acceptance criterion holds, 1 otherwise.
set -uo pipefail
ROOT=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
cd "$ROOT" || exit 1

# Executable Python only: a spawn of the interpreter, -c, an interpreter path,
# a PY-heredoc or a python shebang. Vocabulary ("python3" as an interpreter
# name, --python as a flag) and fixture strings are not execution.
PYINV='run\(["'"'"']python3?(\.[0-9]+)*["'"'"']|spawn(Sync)?\(["'"'"']python3?(\.[0-9]+)*["'"'"']|execFile(Sync)?\(["'"'"']python3?(\.[0-9]+)*["'"'"']|exec(Sync)?\(["'"'"']python3?(\.[0-9]+)*|Bun\.spawn(Sync)?\(\[?["'"'"']python3?(\.[0-9]+)*["'"'"']|\$`python3?([^a-zA-Z0-9_]|$)|exec +python3?([^a-zA-Z0-9_]|$)|python3?(\.[0-9]+)* +-c|/python[0-9.]*([^a-zA-Z0-9_]|$)|<<-?[[:space:]]*['"'"']?PY|#!.*python'
# Full-line // comments are prose: a match there never counts, wherever the
# file lives. Code before a // still counts (pinned by the self-test).
PYINV_NOT=':[0-9]+:[[:space:]]*//'

# Reports bare external imports under $SCAN_DIR: paths Bun's own parser finds
# that are neither relative, absolute, bun/bun:, node:, nor Node built-ins.
IMPORT_SCAN='
import fs from "node:fs";
import path from "node:path";
import mod from "node:module";
const builtin=new Set(mod.builtinModules.map(s=>s.replace(/^node:/,"")));
const tr=new Bun.Transpiler({loader:"ts"});
const bad=[];
function walk(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})) {
  const p=path.join(d,e.name);
  if (e.isDirectory()) { if (e.name==="node_modules"||e.name===".git") continue; walk(p); }
  else if (/\.tsx?$/.test(e.name)) {
    let imps; try { imps=tr.scanImports(fs.readFileSync(p,"utf8")); }
    catch(e){ bad.push(p+": unparseable"); continue; }
    for (const i of imps) {
      const s=i.path;
      if (s.startsWith(".")||s.startsWith("/")||s==="bun"||s.startsWith("bun:")||s.startsWith("node:")) continue;
      if (!builtin.has(s)) bad.push(p+": "+s);
    }
  }
}} walk(process.env.SCAN_DIR);
console.log(bad.join("\n"));'

if [ "${1:-}" = "--self-test" ]; then
  fails=0
  hit() { printf '%s\n' "$2" | grep -qE "$PYINV" && echo "  ok   $1" || { echo "  FAIL $1"; fails=$((fails+1)); }; }
  miss() { printf '%s\n' "$2" | grep -qE "$PYINV" && { echo "  FAIL $1"; fails=$((fails+1)); } || echo "  ok   $1"; }
  echo "AC1 pattern: executable Python, plain and versioned"
  hit 'run("python3") is execution' 'const r = run("python3", args);'
  hit 'run("python3.11") is execution' 'const r = run("python3.11", args);'
  hit 'Bun.spawn(["python3.11"]) is execution' 'Bun.spawn(["python3.11", x])'
  hit 'Bun.spawnSync("python3") is execution' 'Bun.spawnSync("python3");'
  hit "spawnSync('python3.11') is execution" "spawnSync('python3.11', []);"
  hit 'execFileSync("python3") is execution' 'execFileSync("python3", []);'
  hit "execFile('python3.11') is execution" "execFile('python3.11', []);"
  hit 'execSync("python3 --version") is execution' 'execSync("python3 --version");'
  hit 'a Bun shell python3 is execution' 'await $`python3 prog.py`;'
  hit 'python3.11 -c is execution' 'python3.11 -c "x"'
  hit 'exec python3.11 is execution' 'exec python3.11 script.py'
  miss 'an interpreter name as config vocabulary is not' 'harness = "python3"'
  miss 'a gate command string in a test is not' 'command = "python evals/run.py"'
  echo "AC1 filter: full-line comments are prose, code is not"
  fix2=$(mktemp -d) || exit 1
  mkdir -p "$fix2/scripts"
  printf '// regen with python3 -c over the range\n' > "$fix2/scripts/prose.ts"
  printf 'const v = run("python3", a); // trailing comment\n' > "$fix2/scripts/code.ts"
  if grep -rnE "$PYINV" "$fix2/scripts/" 2>/dev/null | grep -vE "$PYINV_NOT" | grep -q .; then
    if grep -rnE "$PYINV" "$fix2/scripts/" 2>/dev/null | grep -vE "$PYINV_NOT" | grep -q 'code.ts'; then
      echo "  ok   code before a trailing comment still flags"
    else echo "  FAIL code before a trailing comment still flags"; fails=$((fails+1)); fi
    if grep -rnE "$PYINV" "$fix2/scripts/" 2>/dev/null | grep -vE "$PYINV_NOT" | grep -q 'prose.ts'; then
      echo "  FAIL a full-line comment does not flag"; fails=$((fails+1));
    else echo "  ok   a full-line comment does not flag"; fi
  else echo "  FAIL the filter kept nothing (both fixtures missed)"; fails=$((fails+1)); fi
  rm -rf "$fix2"
  echo "AC4 classifier: only bun/bun:, node: and built-ins pass"
  fix=$(mktemp -d) || exit 1
  mkdir -p "$fix/scripts"
  printf 'import v from "bunyan";\n' > "$fix/scripts/a.ts"
  printf 'import fs from "node:fs";\nimport b from "bun:sqlite";\nimport r from "./rel";\n' > "$fix/scripts/b.ts"
  (cd "$fix" && SCAN_DIR=scripts bun -e "$IMPORT_SCAN" > "$fix/out.txt" 2>/dev/null)
  if grep -q "a.ts: bunyan" "$fix/out.txt"; then echo "  ok   bare bunyan is flagged";
  else echo "  FAIL bare bunyan is flagged"; fails=$((fails+1)); fi
  if grep -q "b.ts" "$fix/out.txt"; then echo "  FAIL bun:/node:/relative pass"; fails=$((fails+1));
  else echo "  ok   bun:/node:/relative pass"; fi
  rm -rf "$fix"
  [ "$fails" -eq 0 ] && exit 0
  echo "self-test: $fails control(s) misbehaved"; exit 1
fi

pass=0; failed=0
ok()   { echo "  ok   $1"; }
bad()  { echo "  FAIL $1"; }
ac_pass() { echo "AC$1: pass - $2"; pass=$((pass+1)); }
ac_fail() { echo "AC$1: FAIL - $2"; failed=$((failed+1)); }

echo "oracle-109: blind acceptance tests for #109"
echo "root: $ROOT  branch: $(git symbolic-ref --short -q HEAD 2>/dev/null || echo detached)  bun: $(bun --version 2>/dev/null || echo none)  node: $(node --version 2>/dev/null || echo none)"
echo

# --- AC1: every script's logic is TypeScript run by Bun; no Python; wrappers only ---
echo "AC1: TypeScript run by Bun, no Python under scripts/, one-line wrappers"
ac1_bad=0
if find scripts -name '*.py' | grep -q .; then
  bad "python files under scripts/: $(find scripts -name '*.py' | tr '\n' ' ')"; ac1_bad=1
else ok "no .py files under scripts/"; fi
# PYINV is defined above, beside the self-test that locks it.
if grep -rnE "$PYINV" scripts/ 2>/dev/null | grep -vE "$PYINV_NOT" | grep -q .; then
  bad "python executed under scripts/:"; grep -rnE "$PYINV" scripts/ | grep -vE "$PYINV_NOT" | head -5 | sed 's/^/         /'; ac1_bad=1
else ok "no python execution under scripts/ (spawns, -c, paths, heredocs, shebangs; full-line comments are prose)"; fi
wrap_bad=0
for w in scripts/*.sh; do
  lines=$(wc -l < "$w" | tr -d ' ')
  prob=""
  [ "$lines" -gt 8 ] && prob="$prob too-long($lines)"
  grep -q 'bun' "$w" || prob="$prob no-bun"
  grep -qF '"$@"' "$w" || prob="$prob no-args-passthrough"
  grep -q '\.ts' "$w" || prob="$prob no-ts-target"
  if grep -q 'python' "$w"; then prob="$prob mentions-python"; fi
  # A literal .ts target must resolve; a fully dynamic dispatch ($0/basename)
  # is proven behaviourally by the self-tests below instead.
  toks=$(grep -o '[A-Za-z0-9_./-]*\.ts' "$w" 2>/dev/null | grep -v '\$' || true)
  if [ -n "$toks" ]; then
    resolved=0
    for t in $toks; do
      for c in "scripts/$t" "$t" "scripts/$(basename "$t")"; do
        [ -f "$c" ] && resolved=1 && break
      done
      [ $resolved -eq 1 ] && break
    done
    [ $resolved -eq 0 ] && prob="$prob ts-target-missing($toks)"
  fi
  if [ -n "$prob" ]; then bad "$w:$prob"; wrap_bad=1; fi
done
[ $wrap_bad -eq 0 ] && ok "every scripts/*.sh is a short wrapper handing args to TypeScript" || ac1_bad=1
tscount=$(find . -path ./node_modules -prune -o -path ./.git -prune -o -name '*.ts' -print 2>/dev/null | wc -l | tr -d ' ')
if [ "$tscount" -ge 38 ]; then ok "$tscount TypeScript files repo-wide (38 scripts need a TS version each)"
else bad "only $tscount TypeScript files repo-wide, 38 scripts need one each"; ac1_bad=1; fi
[ $ac1_bad -eq 0 ] && ac_pass 1 "no Python, wrappers hand args to TypeScript" || ac_fail 1 "see FAIL lines above"
echo

# --- AC2: paths and interfaces kept ---
echo "AC2: every script keeps its path and interface"
ac2_bad=0
for n in check-target cut-scratch discover-project find-projects fixture front-door-acceptance front-door github handoff-check host launch link-skills local log-action plane probe-harnesses probe-trackers review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults tracker-kind turnpikes verify-examples verify-journey verify-library verify view-stream wait-for-markers wiki-lint; do
  [ -x "scripts/$n.sh" ] || { bad "scripts/$n.sh missing or not executable"; ac2_bad=1; }
done
[ $ac2_bad -eq 0 ] && ok "all 38 BASE script paths exist and are executable"
got=$(scripts/turnpikes.sh --list 2>/dev/null); rc=$?
want=$(cat <<'TABLE'
style      default  review    idiom, naming, abstraction and consistency with the project's own conventions
bug        default  review    correctness, logic, and whether the tests are adequate
security   default  review    exploit paths through the project's risk surfaces
TABLE
)
if [ $rc -eq 0 ] && [ "$got" = "$want" ]; then
  ok "turnpikes.sh --list exits 0 with the BASE table"
else bad "turnpikes.sh --list diverges from BASE (exit $rc)"; ac2_bad=1; fi
# main added the planning stage after this oracle was written; the list below
# is main's scripts/stage.sh STAGES verbatim, not the port's output.
want_stages='dispatched bootstrapped planning workhorses-running synthesis checkpoint-1 review shipping shipped done abandoned'
if [ "$(scripts/stage.sh --list 2>/dev/null | tr '\n' ' ' | sed 's/ $//')" = "$want_stages" ]; then
  ok "stage.sh --list exits 0 with the BASE stage order"
else bad "stage.sh --list diverges from BASE"; ac2_bad=1; fi
if scripts/host.sh detect 2>/dev/null | grep -qxE 'herdr|tmux|none'; then
  ok "host.sh detect exits 0 naming a host"
else bad "host.sh detect fails or names no host"; ac2_bad=1; fi
[ $ac2_bad -eq 0 ] && ac_pass 2 "paths exist, spot interfaces match BASE" || ac_fail 2 "see FAIL lines above"
echo

# --- shared run: install once, run the check script once (evidence for AC3 and AC5) ---
echo "setup: install and run the package check script (evidence for AC3, AC5)"
CHECK_OUT=$(mktemp); CHECK_RC=1
if [ ! -f package.json ]; then
  echo "  (no package.json: nothing to install or run)"
else
  [ -d node_modules ] || { echo "  bun install..."; bun install >/tmp/oracle-109-install.log 2>&1 || echo "  bun install failed (see /tmp/oracle-109-install.log)"; }
  echo "  bun run check..."
  if command -v timeout >/dev/null 2>&1; then timeout 1500 bun run check >"$CHECK_OUT" 2>&1; CHECK_RC=$?
  else bun run check >"$CHECK_OUT" 2>&1; CHECK_RC=$?; fi
  # host.sh's self-test fails about one run in six under load (#85), which is
  # not this change's: one retry so a known flake cannot fail the oracle.
  if [ $CHECK_RC -ne 0 ]; then
    echo "  exit $CHECK_RC, retrying once for the known host.sh flake..."
    if command -v timeout >/dev/null 2>&1; then timeout 1500 bun run check >"$CHECK_OUT" 2>&1; CHECK_RC=$?
    else bun run check >"$CHECK_OUT" 2>&1; CHECK_RC=$?; fi
  fi
  echo "  bun run check exit $CHECK_RC"
  [ $CHECK_RC -ne 0 ] && { echo "  tail:"; tail -15 "$CHECK_OUT" | sed 's/^/    /'; }
fi
echo

# --- AC3: every --self-test still runs and keeps its controls ---
# Via the check script where one exists, else directly per script (BASE).
echo "AC3: each script's --self-test runs from its path"
ac3_bad=0
SELFTEST_31="cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint"
if [ -f package.json ] && node -e "console.log(require('./package.json').scripts?.check ?? '')" 2>/dev/null | grep -q 'self-test'; then
  ok "check script runs self-tests"
  if [ "$CHECK_RC" -eq 0 ]; then ok "bun run check exits 0, so every self-test it runs passes"
  else bad "bun run check exits $CHECK_RC"; ac3_bad=1; fi
else
  echo "  (no check script running self-tests: running each directly)"
  direct_bad=""
  for n in $SELFTEST_31; do
    if scripts/$n.sh --self-test >/tmp/oracle-109-st-$n.log 2>&1; then :; else direct_bad="$direct_bad $n"; fi
  done
  # One retry for host.sh alone, the known flake (#85); anything else failing is genuine.
  if [ "$direct_bad" = " host" ]; then
    echo "  only host.sh failed, retrying it once for the known flake..."
    scripts/host.sh --self-test >/tmp/oracle-109-st-host.log 2>&1 && direct_bad="" || true
  fi
  if [ -z "$direct_bad" ]; then ok "all 31 --self-test suites pass directly"
  else bad "self-test failures:$direct_bad"; ac3_bad=1; fi
fi
[ $ac3_bad -eq 0 ] && ac_pass 3 "every --self-test passes" || ac_fail 3 "see FAIL lines above"
echo

# --- AC4: runtime imports only Bun built-ins and Node stdlib; only tsc+biome devDeps ---
echo "AC4: only Bun/Node imports at runtime; typescript and biome the only devDeps"
ac4_bad=0
if [ ! -f package.json ]; then bad "no package.json"; ac4_bad=1
else
  deps=$(node -e "const p=require('./package.json'); console.log(JSON.stringify({d:Object.keys(p.dependencies||{}),v:Object.keys(p.devDependencies||{}).sort()}))" 2>/dev/null)
  if [ "$deps" = '{"d":[],"v":["@biomejs/biome","typescript"]}' ]; then ok "no runtime deps; devDeps exactly typescript and @biomejs/biome"
  else bad "dependencies: $deps"; ac4_bad=1; fi
fi
# Syntax-aware through Bun's own parser: strings, comments and fixture
# sources (import lines written as test data) cannot match, only real imports.
if ! command -v bun >/dev/null 2>&1; then bad "cannot scan imports: bun not installed"; ac4_bad=1
else
viol=$(SCAN_DIR=scripts bun -e "$IMPORT_SCAN" 2>/dev/null)
if [ -d src ]; then
  viol2=$(SCAN_DIR=src bun -e "$IMPORT_SCAN" 2>/dev/null)
  viol="${viol}${viol2:+
$viol2}"
fi
if [ -z "$viol" ]; then ok "no bare external imports in TypeScript under scripts/ (and src/)"
else bad "external imports:"; printf '%s\n' "$viol" | head -10 | sed 's/^/         /'; ac4_bad=1; fi
fi
[ $ac4_bad -eq 0 ] && ac_pass 4 "imports and dependencies as required" || ac_fail 4 "see FAIL lines above"
echo

# --- AC5: package.json check runs tsc strict, biome, self-tests; discover reports it ---
echo "AC5: check script runs tsc --noEmit strict, biome check, self-tests; discover reports it"
ac5_bad=0
if [ ! -f package.json ]; then bad "no package.json"; ac5_bad=1
else
  chk=$(node -e "console.log(require('./package.json').scripts?.check ?? '')" 2>/dev/null)
  for need in 'tsc' '--noEmit' 'biome' 'self-test'; do
    printf '%s' "$chk" | grep -qF -- "$need" || { bad "check script lacks $need"; ac5_bad=1; }
  done
  [ $ac5_bad -eq 0 ] && ok "check script runs tsc --noEmit, biome and self-tests"
  strict_ts=$(node -e "try{console.log(require('./tsconfig.json').compilerOptions?.strict===true?'y':'n')}catch(e){console.log('n')}" 2>/dev/null)
  if [ "$strict_ts" = y ] || printf '%s' "$chk" | grep -qF -- '--strict'; then ok "strict mode (tsconfig or --strict)"
  else bad "no strict mode: tsconfig strict is not true and check lacks --strict"; ac5_bad=1; fi
fi
if [ -f package.json ]; then
  if [ "$CHECK_RC" -eq 0 ]; then ok "bun run check exits 0"
  else bad "bun run check exits $CHECK_RC"; ac5_bad=1; fi
fi
gate=$(scripts/discover-project.sh . 2>/dev/null | sed -n 's/^gate=//p')
if printf '%s' "$gate" | grep -q 'check'; then ok "discover-project.sh reports gate: $gate"
else bad "discover-project.sh reports gate '$gate', which runs no check"; ac5_bad=1; fi
[ $ac5_bad -eq 0 ] && ac_pass 5 "check script exits 0 and discover reports it" || ac_fail 5 "see FAIL lines above"
echo

# --- AC6: README and AGENTS.md name Bun with its version, in place of Python 3.11 ---
echo "AC6: README and AGENTS.md name Bun with its version"
ac6_bad=0
for doc in README.md AGENTS.md; do
  grep -q 'Bun' "$doc" || { bad "$doc does not name Bun"; ac6_bad=1; continue; }
  grep -E -q 'Bun.*1\.[0-9]+' "$doc" || { bad "$doc names Bun with no 1.x version on the line"; ac6_bad=1; continue; }
  ok "$doc names Bun with a version"
  if grep -q 'Python 3\.11' "$doc"; then bad "$doc still names Python 3.11"; ac6_bad=1; fi
done
[ $ac6_bad -eq 0 ] && ac_pass 6 "docs name Bun with its version" || ac_fail 6 "see FAIL lines above"
echo

rm -f "$CHECK_OUT"
echo "oracle-109: $((pass)) of 6 acceptance criteria hold"
[ "$failed" -eq 0 ] && { echo "oracle-109: PASS"; exit 0; }
echo "oracle-109: FAIL"; exit 1
