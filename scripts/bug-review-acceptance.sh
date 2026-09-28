#!/usr/bin/env bash
# Acceptance oracle for #38: the bug review runs through each harness's own code-review
# skill. Checks the ticket's prescribed interface only: prose that must be gone (stale),
# prose that must exist (want), and the one runnable mechanism with a prescribed shape,
# `launch.sh review` exiting 3 for a harness with no review form. Everything whose shape
# the lanes were dispatched to choose is judged by reading at harvest, not here: the
# per-harness code-review verdicts and their sources, the review-form details (level,
# findings shape, known findings, tool-call location), the review level and event stream,
# the same-snapshot scratch, the waybill's bug-reviewer line and the setup and pre-flight
# behaviour at runtime, the findings-normalization script and its controls, the harvest
# copy mechanics, the criterion-9 control runs, the wiki depth, and how the coachman runs
# the gate once per round. This scaffolding retires before the run ships.
#
#   bug-review-acceptance.sh [repo-root]   default: the repo this script lives in
#   bug-review-acceptance.sh --self-test   prove each check fails on its own fault
#                                          alone against fixture trees
#
#   exit 0  the prescribed interface holds
#   exit 1  faults, one per line on stdout: <file>: <what is wrong>
#   exit 2  usage, or a file that cannot be read
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
ROOT=$(dirname "$HERE")
usage() { echo "usage: bug-review-acceptance.sh [repo-root] | --self-test" >&2; exit 2; }

flat() { tr -d '\r' < "$1" | tr '\n\t' '  ' | sed 's/  */ /g'; }   # fold newlines so a reflow alone never passes

fails=0
fault() { printf '%s\n' "$1"; fails=$((fails + 1)); }
stale() { # stale <flat-text> <file> <label> <sentence>: fault when still claimed
  local text=$1 file=$2 label=$3; shift 3
  printf '%s' "$text" | grep -q -F -- "$*" && fault "$file: still says $label"
}
want() { # want <flat-text> <file> <label> <token...>: fault when the token is missing
  local text=$1 file=$2 label=$3; shift 3
  printf '%s' "$text" | grep -q -F -- "$*" || fault "$file: does not $label"
}
want_any() { # want_any <flat-text> <file> <label> <tok1> <tok2>: fault when both missing
  local text=$1 file=$2 label=$3
  { printf '%s' "$text" | grep -q -F -- "$4"; } \
    || { printf '%s' "$text" | grep -q -F -- "$5"; } \
    || fault "$file: does not $label"
}

md_section() { # md_section <file> <title>: the ## section's lines, literally matched
  marker=$2 awk 'index($0, "## " ENVIRON["marker"]) == 1 {f=1; next} f && index($0, "## ") == 1 {f=0} f' "$1"
}

span() { # span <file> <start> <end>: the start line through the line before the end
  s=$2 e=$3 awk 'index($0, ENVIRON["s"]) {f=1} f && index($0, ENVIRON["e"]) {f=0} f' "$1"
}

accept() { # accept <root>: the checks; stdout the faults, exit 0/1/2
  local root=$1 f
  for f in skills/postmaster/harnesses.md skills/postmaster/coachman.md \
      skills/postmaster/postmaster.md scripts/setup.sh scripts/launch.sh \
      wiki/concepts/own-review-skills.md; do
    [ -r "$root/$f" ] || { echo "bug-review-acceptance: cannot read $root/$f" >&2; return 2; }
  done
  fails=0
  local own coach bug style
  own=$(md_section "$root/skills/postmaster/harnesses.md" "Own review skills")
  coach=$(flat "$root/skills/postmaster/coachman.md")
  bug=$(span "$root/skills/postmaster/coachman.md" '**Bug lens**' '**Security lens**' | tr '\n\t' '  ')
  style=$(span "$root/skills/postmaster/coachman.md" '**Style lens**' '**Bug lens**' | tr '\n\t' '  ')
  [ -n "$own" ] || { echo "bug-review-acceptance: cannot read $root/skills/postmaster/harnesses.md" >&2; return 2; }
  [ -n "$bug" ] || { echo "bug-review-acceptance: cannot read $root/skills/postmaster/coachman.md" >&2; return 2; }
  # The bug lens is no longer brief-driven (AC4); the style lens still is.
  stale "$bug" skills/postmaster/coachman.md "the bug lens runs from its brief" "from its brief"
  want "$bug" skills/postmaster/coachman.md "run the bug lens through launch.sh review" "launch.sh review"
  want "$style" skills/postmaster/coachman.md "keep the style lens on its brief" "from its brief"
  # No reviewer runs the gate (AC11).
  stale "$coach" skills/postmaster/coachman.md "invite the brief at the full gate suite" "including the full gate suite"
  stale "$coach" skills/postmaster/coachman.md "run every review lane at the full gate suite" "the full gate suite included"
  want "$coach" skills/postmaster/coachman.md "check a finding with a targeted probe" "targeted probe"
  # The harvest keeps claude's forked task output (AC8).
  want "$coach" skills/postmaster/coachman.md "keep the review task output the stream names" "task_notification"
  # Every harness's code-review skill is recorded with its form (AC1, AC2).
  local h
  for h in claude codex pi muse grok agy mimo; do
    printf '%s' "$own" | grep -q -i -F -- "$h" \
      || fault "skills/postmaster/harnesses.md: Own review skills names no $h"
  done
  want "$own" skills/postmaster/harnesses.md "record claude's code-review form" "/code-review"
  want "$own" skills/postmaster/harnesses.md "record codex's review base form" "review --base"
  want "$own" skills/postmaster/harnesses.md "record MiMo Code's review command" "--command review"
  want "$own" skills/postmaster/harnesses.md "keep claude's security review" "/security-review"
  # The review verb is prescribed (AC3).
  grep -q -E 'review <(lane|name)>' "$root/scripts/launch.sh" \
    || fault "scripts/launch.sh: documents no review <lane> form"
  # Setup and dispatch know the review form (AC5).
  want_any "$(flat "$root/scripts/setup.sh")" scripts/setup.sh \
    "name the lanes whose harness has no review form" "review form" "review skill"
  want_any "$(flat "$root/skills/postmaster/postmaster.md")" skills/postmaster/postmaster.md \
    "refuse a bug review with no review form to run it on" "review form" "review skill"
  # The wiki covers the bug lens (AC10).
  local wiki
  wiki=$(flat "$root/wiki/concepts/own-review-skills.md")
  want "$wiki" wiki/concepts/own-review-skills.md "cover the bug lens" "bug"
  want "$wiki" wiki/concepts/own-review-skills.md "cite the review-scope trial" "code-review-scope"
  # Runnable: a harness with no review form exits 3 (AC3), and the skill verb still does (keeper).
  review_exits "$root"
  [ "$fails" -eq 0 ]
}

review_exits() { # review_exits <root>: launch.sh review/skill on a pi lane exit 3
  local root=$1 tmp base out rc
  tmp=$(mktemp -d) || { fault "scripts/launch.sh: cannot make a scratch directory"; return; }
  mkdir -p "$tmp/bin" "$tmp/run" || { fault "scripts/launch.sh: cannot make a scratch directory"; return; }
  printf '#!/bin/sh\nexit 0\n' > "$tmp/bin/pi" && chmod +x "$tmp/bin/pi"
  printf '[lanes.probe]\nharness = "pi"\nmodel = "probe-model"\n' > "$tmp/config.toml"
  printf '{"config": {"lanes": {"probe": {"harness": "pi", "model": "probe-model"}}}}\n' > "$tmp/run/run.json"
  base=$(git -C "$root" rev-parse HEAD 2>/dev/null) \
    || { fault "scripts/launch.sh: cannot determine $root's HEAD"; rm -r -- "$tmp"; return; }
  out=$(POSTMASTER_CONFIG="$tmp/config.toml" PATH="$tmp/bin:$PATH" \
    "$root/scripts/launch.sh" review probe "$root" "$base" --run "$tmp/run" 2>"$tmp/err"); rc=$?
  [ "$rc" -eq 3 ] || fault "scripts/launch.sh: review on a harness with no review form exits $rc, want 3"
  out=$(POSTMASTER_CONFIG="$tmp/config.toml" PATH="$tmp/bin:$PATH" \
    "$root/scripts/launch.sh" skill probe security-review --run "$tmp/run" 2>>"$tmp/err"); rc=$?
  [ "$rc" -eq 3 ] || fault "scripts/launch.sh: skill on a harness with none exits $rc, want 3"
  rm -r -- "$tmp"
}

selftest() {
  local self n fixed
  self=$HERE/$(basename -- "$0")
  stmp=$(mktemp -d) || { echo "self-test: cannot make a scratch directory"; exit 1; }
  trap 'rm -r -- "$stmp" </dev/null 2>/dev/null' EXIT
  fixed=$stmp/fixed
  mkdir -p "$fixed/skills/postmaster" "$fixed/scripts" "$fixed/wiki/concepts" "$fixed/.git"
  git -C "$fixed" init -q 2>/dev/null && git -C "$fixed" -c user.name=t -c user.email=t@example.invalid \
    commit -q --allow-empty -m init || { echo "self-test: cannot make the fixture repo"; exit 1; }
  { printf '## Own review skills\n\ncode-review per harness: claude /code-review, codex review --base, mimo --command review; pi, muse, grok and agy have none.\n\nclaude keeps /security-review.\n\n## Next\n';
  } > "$fixed/skills/postmaster/harnesses.md"
  { printf 'capability\n\n- **Style lens** (round 1 only): idiom. Launch: from its brief.\n- **Bug lens** (gating): correctness. Launch: through launch.sh review; keep the task_notification output; check a finding with a targeted probe.\n- **Security lens** (gating): exploits.\n';
  } > "$fixed/skills/postmaster/coachman.md"
  printf 'dispatch refuses a run whose bug reviewers have no review form\n' > "$fixed/skills/postmaster/postmaster.md"
  printf '#!/bin/sh\n# names each lane whose harness has no review form\nexit 0\n' > "$fixed/scripts/setup.sh"
  printf 'the bug lens and raw/trials/code-review-scope\n' > "$fixed/wiki/concepts/own-review-skills.md"
  cat > "$fixed/scripts/launch.sh" <<'FIX'
#!/bin/sh
# usage: launch.sh review <lane> <cwd> <base>; review exits 3 for a harness with
# no review form, skill likewise
verb=$1; name=$2; shift 2
run=""; skill=""; prev=""
for a in "$@"; do
  case $prev in --run) run=$a; prev="";; *) case $a in --run) prev=--run;; *) [ -z "$skill" ] && skill=$a;; esac;; esac
done
harness=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["config"]["lanes"]["probe"]["harness"])' "$run/run.json")
case $verb:$harness:$skill in
  review:pi:*) echo "launch: probe runs on pi, which has no review form recorded in harnesses.md" >&2; exit 3 ;;
  review:*:*) exit 0 ;;
  skill:claude:security-review) echo /security-review; exit 0 ;;
  skill:*:*) exit 3 ;;
esac
FIX
  chmod +x "$fixed/scripts/launch.sh"
  n=0
  pass() { n=$((n + 1)); printf 'ok %s\n' "$1"; }
  fail() { printf 'FAIL %s\n%s\n' "$1" "$2"; exit 1; }
  # The fixed tree passes.
  out=$("$self" "$fixed" 2>"$stmp/err"); rc=$?
  [ "$rc" -eq 0 ] && [ -z "$out" ] && pass "the fixed tree passes" || fail "the fixed tree passes" "exit $rc: $out $(cat "$stmp/err")"
  # usage
  out=$("$self" --bogus 2>&1); rc=$?
  [ "$rc" -eq 2 ] && pass "usage exits 2" || fail "usage exits 2" "exit $rc: $out"
  # an unreadable tree is refused, never read as clean
  out=$("$self" "$stmp/missing" 2>&1); rc=$?
  [ "$rc" -eq 2 ] && pass "a missing tree is refused" || fail "a missing tree is refused" "exit $rc: $out"
  # Each check fails on its own fault alone.
  break_one() { # break_one <label> <want-fault> <relative-path> <sed-script...>
    local label=$1 want=$2 rel=$3 t; shift 3
    t=$stmp/broke-$n; cp -r "$fixed" "$t"
    sed -i "$@" "$t/$rel"
    out=$("$self" "$t" 2>"$stmp/err"); rc=$?
    [ "$rc" -eq 1 ] && [ "$out" = "$want" ] && pass "$label" \
      || fail "$label" "exit $rc: $out $(cat "$stmp/err")"
  }
  break_one "the bug lens on its brief fails" \
    "skills/postmaster/coachman.md: still says the bug lens runs from its brief" \
    skills/postmaster/coachman.md 's/through launch.sh review/from its brief, never launch.sh review/'
  break_one "the bug lens without launch.sh review fails" \
    "skills/postmaster/coachman.md: does not run the bug lens through launch.sh review" \
    skills/postmaster/coachman.md 's/launch\.sh review/skill prompt/'
  break_one "the style lens off its brief fails" \
    "skills/postmaster/coachman.md: does not keep the style lens on its brief" \
    skills/postmaster/coachman.md 's/Launch: from its brief\./Launch: through launch.sh review./'
  break_one "the gate invite in the brief fails" \
    "skills/postmaster/coachman.md: still says invite the brief at the full gate suite" \
    skills/postmaster/coachman.md 's/check a finding/may run anything it wants there including the full gate suite; check a finding/'
  break_one "every lane at the gate fails" \
    "skills/postmaster/coachman.md: still says run every review lane at the full gate suite" \
    skills/postmaster/coachman.md 's/check a finding/Every lane may run anything in its own scratch, the full gate suite included; check a finding/'
  break_one "no targeted probe fails" \
    "skills/postmaster/coachman.md: does not check a finding with a targeted probe" \
    skills/postmaster/coachman.md 's/with a targeted probe/with whatever it likes/'
  break_one "no task_notification fails" \
    "skills/postmaster/coachman.md: does not keep the review task output the stream names" \
    skills/postmaster/coachman.md 's/task_notification/output file/'
  break_one "a harness unnamed fails" \
    "skills/postmaster/harnesses.md: Own review skills names no agy" \
    skills/postmaster/harnesses.md 's/and agy have none/have none/'
  break_one "no claude form fails" \
    "skills/postmaster/harnesses.md: does not record claude's code-review form" \
    skills/postmaster/harnesses.md 's|/code-review|slash code review|'
  break_one "no codex form fails" \
    "skills/postmaster/harnesses.md: does not record codex's review base form" \
    skills/postmaster/harnesses.md 's/review --base/review plus base/'
  break_one "no mimo form fails" \
    "skills/postmaster/harnesses.md: does not record MiMo Code's review command" \
    skills/postmaster/harnesses.md 's/--command review/--run review/'
  break_one "no security review kept fails" \
    "skills/postmaster/harnesses.md: does not keep claude's security review" \
    skills/postmaster/harnesses.md 's|/security-review|/sec-review|'
  break_one "no review usage fails" \
    "scripts/launch.sh: documents no review <lane> form" \
    scripts/launch.sh 's/review <lane>/review <thing>/'
  break_one "setup naming nothing fails" \
    "scripts/setup.sh: does not name the lanes whose harness has no review form" \
    scripts/setup.sh 's/no review form/no form/'
  break_one "dispatch refusing nothing fails" \
    "skills/postmaster/postmaster.md: does not refuse a bug review with no review form to run it on" \
    skills/postmaster/postmaster.md 's/no review form/no lane/'
  break_one "the wiki without the bug lens fails" \
    "wiki/concepts/own-review-skills.md: does not cover the bug lens" \
    wiki/concepts/own-review-skills.md 's/the bug lens/the lens/'
  break_one "the wiki without the trial fails" \
    "wiki/concepts/own-review-skills.md: does not cite the review-scope trial" \
    wiki/concepts/own-review-skills.md 's|code-review-scope|review-scope|'
  break_one "review exiting 0 for pi fails" \
    "scripts/launch.sh: review on a harness with no review form exits 0, want 3" \
    scripts/launch.sh '/review:pi/s/exit 3/exit 0/'
  break_one "skill exiting 0 for pi fails" \
    "scripts/launch.sh: skill on a harness with none exits 0, want 3" \
    scripts/launch.sh 's/skill:\*:\*) exit 3/skill:*:*) exit 0/'
  printf 'self-test: %s controls pass\n' "$n"
}

case ${1:-} in
  --self-test) selftest ;;
  -*) usage ;;
  '') accept "$ROOT" ;;
  *) accept "$1" ;;
esac
