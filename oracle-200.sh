#!/usr/bin/env bash
# Oracle for #200: blind acceptance tests at the ticket's own interface.
#
# Written by the leg-1 coachman before reading any lane's spec or diff,
# committed as the first commit on the ticket branch. It drives the worktree's
# own scripts/launch.sh with stub harnesses and a stub sandbox-runtime, and
# checks the ticket's interface contract: confine off runs the harness as
# today (AC7); confine on wraps it in sandbox-runtime with its launch form,
# bypass flag included, unchanged (AC1); when the confinement cannot start
# the launch exits 1, names what is missing, and never runs the lane
# unconfined (AC7); --run reads the recorded config (AC7/AC8 behavioral
# half); --self-test is green (AC6); the runbooks say confined (AC10) and
# record each harness's paths and hosts (AC5 docs half).
#
# What no blind probe can judge is verified by reading at synthesis and
# recorded on the checkpoint card: the one OS-naming-free code path (AC1);
# the real confinement of every criterion-2/3 item with its controls (AC6
# internals); the hooks/config read-only mechanism (AC4); the run.json
# recording fields and the pinned version every launch uses (AC7/AC8
# recording half); per-project hosts reached and refused (AC5 behavioral
# half); and the clean fixture run (AC9).
#
#   oracle-200.sh [all|full]   run from the repo root
#     all    stub probes + self-test + docs (the cheap lane-ranking set)
#     full   all + the real-confinement probe, which needs ORACLE_REAL_SRT
#            to name a real `srt` binary (else it skips)
#   Exit 0 when the worktree meets the ticket, 1 otherwise, one line per
#   probe. Probes never touch the real home: HOME is a temp dir throughout.
set -uo pipefail

HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
LAUNCH="$HERE/scripts/launch.sh"
[ -x "$LAUNCH" ] || { echo "oracle: run from the repo root: scripts/launch.sh not found" >&2; exit 1; }
MODE=${1:-all}
fail=0
pass() { echo "PASS $1: $2"; }
nope() { echo "FAIL $1: $2"; fail=1; }
skip() { echo "SKIP $1: $2"; }

TMP=$(mktemp -d) || exit 1
trap 'rm -rf -- "$TMP"' EXIT
export HOME=$TMP/home
unset POSTMASTER_EVENT_STREAM POSTMASTER_LAUNCH_ROLE POSTMASTER_LAUNCH_NAME
mkdir -p "$HOME" "$TMP/bin" "$TMP/wt" "$TMP/run"
WT=$TMP/wt
echo "oracle prompt" > "$TMP/prompt.txt"
echo "oracle-outside-marker" > "$HOME/outside.txt"

# Stub codex: records its argv, working directory and environment, tries the
# outside read, plants the inside marker. Never fails.
cat > "$TMP/bin/codex" <<'EOF'
#!/usr/bin/env bash
{
  echo "pwd=$(pwd -P)"
  printf 'argv:'
  printf ' %q' "$@"
  printf '\n'
} >> "$ORACLE_ARGV"
if cat "$HOME/outside.txt" >/dev/null 2>&1; then echo "outside=read" >> "$ORACLE_ARGV"
else echo "outside=refused" >> "$ORACLE_ARGV"; fi
echo "inside" > ./oracle-inside.txt
exit 0
EOF
chmod +x "$TMP/bin/codex"

# Stub srt: records its argv, then runs the command after `--`.
cat > "$TMP/bin/srt" <<'EOF'
#!/usr/bin/env bash
printf 'srt-argv:' >> "$ORACLE_ARGV"
printf ' %q' "$@" >> "$ORACLE_ARGV"
printf '\n' >> "$ORACLE_ARGV"
while [ $# -gt 0 ]; do
  if [ "$1" = "--" ]; then shift; exec "$@"; fi
  shift
done
echo "srt-stub: no -- in argv" >&2
exit 1
EOF
chmod +x "$TMP/bin/srt"

mkcfg() { # <file> <confine-line-or-empty>
  { echo '[lanes.t]'; echo 'harness = "codex"'; echo 'model = "lane-model"'; echo 'effort = "high"';
    [ -n "$1" ] && echo "$1"; } > "$TMP/$2"
}
mkcfg 'confine = "off"' off.toml
mkcfg '' absent.toml
mkcfg 'confine = "on"' on.toml

export ORACLE_ARGV=$TMP/argv.log
CODEX_BYPASS="--dangerously-bypass-approvals-and-sandbox"

# P1: confine off runs the stub directly, bypass flag on, outside readable.
: > "$ORACLE_ARGV"
out=$(POSTMASTER_CONFIG=$TMP/off.toml PATH=$TMP/bin:$PATH "$LAUNCH" launch t "$WT" "$TMP/prompt.txt" 2>$TMP/err); rc=$?
if [ $rc -eq 0 ] && grep -q "pwd=$WT" "$ORACLE_ARGV" && grep -qF -- "$CODEX_BYPASS" "$ORACLE_ARGV" \
   && grep -q "outside=read" "$ORACLE_ARGV" && [ -f "$WT/oracle-inside.txt" ] \
   && ! grep -q "srt-argv" "$ORACLE_ARGV"; then
  pass "P1-off-launch" "direct run, bypass on, outside readable"
  cp "$ORACLE_ARGV" "$TMP/argv-off.log"
else
  nope "P1-off-launch" "exit $rc: $(cat $TMP/err $ORACLE_ARGV 2>/dev/null | tr '\n' ' ' | cut -c1-300)"
fi
rm -f "$WT/oracle-inside.txt"

# P1a: absent confine key behaves as off.
: > "$ORACLE_ARGV"
out=$(POSTMASTER_CONFIG=$TMP/absent.toml PATH=$TMP/bin:$PATH "$LAUNCH" launch t "$WT" "$TMP/prompt.txt" 2>$TMP/err); rc=$?
if [ $rc -eq 0 ] && grep -q "outside=read" "$ORACLE_ARGV" && ! grep -q "srt-argv" "$ORACLE_ARGV"; then
  pass "P1a-absent-off" "missing key runs unconfined"
else
  nope "P1a-absent-off" "exit $rc: $(cat $TMP/err $ORACLE_ARGV 2>/dev/null | tr '\n' ' ' | cut -c1-300)"
fi
rm -f "$WT/oracle-inside.txt"

# P2: the off form shows the bare harness with its bypass flag, no srt.
out=$(POSTMASTER_CONFIG=$TMP/off.toml PATH=$TMP/bin:$PATH "$LAUNCH" form t 2>$TMP/err); rc=$?
if [ $rc -eq 0 ] && case $out in *"$CODEX_BYPASS"*) true;; *) false;; esac \
   && case $out in *srt*) false;; *) true;; esac; then
  pass "P2-off-form" "bare form with bypass, no srt"
else
  nope "P2-off-form" "exit $rc: $(printf '%s' "$out$(cat $TMP/err)" | tr '\n' ' ' | cut -c1-300)"
fi

# P3: the on form wraps in srt and keeps the harness form with its bypass.
out=$(POSTMASTER_CONFIG=$TMP/on.toml PATH=$TMP/bin:$PATH "$LAUNCH" form t 2>$TMP/err); rc=$?
if [ $rc -eq 0 ] && case $out in *srt*) true;; *) false;; esac \
   && case $out in *"$CODEX_BYPASS"*) true;; *) false;; esac \
   && case $out in *"launch: "*srt*) true;; *) false;; esac \
   && case $out in *"resume: "*srt*) true;; *) false;; esac; then
  pass "P3-on-form" "launch and resume forms wrapped, bypass kept"
else
  nope "P3-on-form" "exit $rc: $(printf '%s' "$out$(cat $TMP/err)" | tr '\n' ' ' | cut -c1-300)"
fi

# P4: confine on with no srt anywhere: exit 1 naming it with the harness
# never run, or the harness ran confined (a design that resolves srt itself).
mkdir -p "$TMP/emptybin" && cp "$TMP/bin/codex" "$TMP/emptybin/codex"
: > "$ORACLE_ARGV"
out=$(POSTMASTER_CONFIG=$TMP/on.toml PATH=$TMP/emptybin:/usr/bin:/bin "$LAUNCH" launch t "$WT" "$TMP/prompt.txt" 2>$TMP/err); rc=$?
err=$(cat "$TMP/err")
ran=false; grep -q "^pwd=" "$ORACLE_ARGV" 2>/dev/null && ran=true
if [ $rc -eq 1 ] && [ "$ran" = false ] \
   && case $err in *[Ss]andbox*|*srt*|*confin*) true;; *) false;; esac; then
  pass "P4-on-missing" "exit 1 naming the missing confinement, harness never ran"
elif [ "$ran" = true ] && grep -q "outside=refused" "$ORACLE_ARGV"; then
  pass "P4-on-missing" "harness ran confined via self-resolved srt"
else
  nope "P4-on-missing" "exit $rc ran=$ran: $(printf '%s' "$err$(cat $ORACLE_ARGV 2>/dev/null)" | tr '\n' ' ' | cut -c1-300)"
fi
rm -f "$WT/oracle-inside.txt"

# P5: confine on with stub srt on PATH: wrapped with the harness argv
# identical to the off run, or refused naming it, or ran truly confined.
: > "$ORACLE_ARGV"
out=$(POSTMASTER_CONFIG=$TMP/on.toml PATH=$TMP/bin:$PATH "$LAUNCH" launch t "$WT" "$TMP/prompt.txt" 2>$TMP/err); rc=$?
err=$(cat "$TMP/err")
ran=false; grep -q "^pwd=" "$ORACLE_ARGV" 2>/dev/null && ran=true
offargv=$(grep "^argv:" "$TMP/argv-off.log" 2>/dev/null || true)
onargv=$(grep "^argv:" "$ORACLE_ARGV" 2>/dev/null || true)
if grep -q "srt-argv" "$ORACLE_ARGV" && [ "$ran" = true ] && [ -n "$offargv" ] \
   && [ "$offargv" = "$onargv" ] && grep -qF -- "$CODEX_BYPASS" "$ORACLE_ARGV"; then
  pass "P5-on-wrap" "srt wrapped, harness argv byte-identical to off, bypass kept"
elif [ $rc -eq 1 ] && [ "$ran" = false ] \
   && case $err in *[Ss]andbox*|*srt*|*confin*) true;; *) false;; esac; then
  pass "P5-on-wrap" "stub srt not used; refused naming the missing confinement"
elif [ "$ran" = true ] && grep -q "outside=refused" "$ORACLE_ARGV"; then
  pass "P5-on-wrap" "harness ran confined via self-resolved srt"
else
  nope "P5-on-wrap" "exit $rc ran=$ran: $(printf '%s' "$err$(cat $ORACLE_ARGV 2>/dev/null)" | tr '\n' ' ' | cut -c1-300)"
fi
rm -f "$WT/oracle-inside.txt"

# P6: resume under confine on: same contract as a launch.
: > "$ORACLE_ARGV"
out=$(POSTMASTER_CONFIG=$TMP/on.toml PATH=$TMP/bin:$PATH "$LAUNCH" resume t "$WT" T-oracle "$TMP/prompt.txt" 2>$TMP/err); rc=$?
err=$(cat "$TMP/err")
ran=false; grep -q "^pwd=" "$ORACLE_ARGV" 2>/dev/null && ran=true
if grep -q "srt-argv" "$ORACLE_ARGV" && [ "$ran" = true ] \
   && grep -q "resume T-oracle" "$ORACLE_ARGV" && grep -qF -- "$CODEX_BYPASS" "$ORACLE_ARGV"; then
  pass "P6-on-resume" "resume wrapped, thread and bypass kept"
elif [ $rc -eq 1 ] && [ "$ran" = false ] \
   && case $err in *[Ss]andbox*|*srt*|*confin*) true;; *) false;; esac; then
  pass "P6-on-resume" "stub srt not used; refused naming the missing confinement"
elif [ "$ran" = true ] && grep -q "outside=refused" "$ORACLE_ARGV"; then
  pass "P6-on-resume" "resume ran confined via self-resolved srt"
else
  nope "P6-on-resume" "exit $rc ran=$ran: $(printf '%s' "$err$(cat $ORACLE_ARGV 2>/dev/null)" | tr '\n' ' ' | cut -c1-300)"
fi
rm -f "$WT/oracle-inside.txt"

# P7: --run reads the recorded config: off runs direct, on wraps or refuses.
mkdir -p "$TMP/run-off" "$TMP/run-on"
printf '{"config":{"lanes":{"t":{"harness":"codex","model":"lane-model","effort":"high"}},"confine":"off"}}' > "$TMP/run-off/run.json"
printf '{"config":{"lanes":{"t":{"harness":"codex","model":"lane-model","effort":"high"}},"confine":"on"}}' > "$TMP/run-on/run.json"
: > "$ORACLE_ARGV"
out=$(PATH=$TMP/bin:$PATH "$LAUNCH" launch t "$WT" "$TMP/prompt.txt" --run "$TMP/run-off" 2>$TMP/err); rc=$?
if [ $rc -eq 0 ] && grep -q "outside=read" "$ORACLE_ARGV" && ! grep -q "srt-argv" "$ORACLE_ARGV"; then
  pass "P7a-run-off" "recorded off runs direct"
else
  nope "P7a-run-off" "exit $rc: $(cat $TMP/err $ORACLE_ARGV 2>/dev/null | tr '\n' ' ' | cut -c1-300)"
fi
rm -f "$WT/oracle-inside.txt"
: > "$ORACLE_ARGV"
out=$(PATH=$TMP/bin:$PATH "$LAUNCH" launch t "$WT" "$TMP/prompt.txt" --run "$TMP/run-on" 2>$TMP/err); rc=$?
err=$(cat "$TMP/err")
ran=false; grep -q "^pwd=" "$ORACLE_ARGV" 2>/dev/null && ran=true
if grep -q "srt-argv" "$ORACLE_ARGV" && [ "$ran" = true ] && grep -qF -- "$CODEX_BYPASS" "$ORACLE_ARGV"; then
  pass "P7b-run-on" "recorded on wraps, bypass kept"
elif [ $rc -eq 1 ] && [ "$ran" = false ] \
   && case $err in *[Ss]andbox*|*srt*|*confin*) true;; *) false;; esac; then
  pass "P7b-run-on" "recorded on refused naming the missing confinement"
elif [ "$ran" = true ] && grep -q "outside=refused" "$ORACLE_ARGV"; then
  pass "P7b-run-on" "recorded on ran confined via self-resolved srt"
else
  nope "P7b-run-on" "exit $rc ran=$ran: $(printf '%s' "$err$(cat $ORACLE_ARGV 2>/dev/null)" | tr '\n' ' ' | cut -c1-300)"
fi
rm -f "$WT/oracle-inside.txt"

# P8: the self-test is green (its own controls judge the real confinement).
if "$LAUNCH" --self-test >$TMP/selftest.log 2>&1; then
  pass "P8-selftest" "launch.sh --self-test exits 0"
else
  nope "P8-selftest" "exit nonzero: $(tail -5 $TMP/selftest.log | tr '\n' ' ' | cut -c1-300)"
fi

# P9: real confinement through a real srt, else skip.
if [ "$MODE" = full ] && [ -n "${ORACLE_REAL_SRT:-}" ] && [ -x "$ORACLE_REAL_SRT" ]; then
  mkdir -p "$WT/bin" "$TMP/srtbin"
  cp "$TMP/bin/codex" "$WT/bin/codex"
  ln -sf "$ORACLE_REAL_SRT" "$TMP/srtbin/srt"
  export ORACLE_ARGV
  : > "$ORACLE_ARGV"
  out=$(POSTMASTER_CONFIG=$TMP/on.toml PATH=$TMP/srtbin:$WT/bin:/usr/bin:/bin "$LAUNCH" launch t "$WT" "$TMP/prompt.txt" 2>$TMP/perr); rc=$?
  ran=false; grep -q "^pwd=" "$ORACLE_ARGV" 2>/dev/null && ran=true
  if [ $rc -eq 0 ] && [ "$ran" = true ] && grep -q "outside=refused" "$ORACLE_ARGV" \
     && [ -f "$WT/oracle-inside.txt" ]; then
    pass "P9-real" "confined: outside refused, inside works"
  else
    nope "P9-real" "exit $rc ran=$ran: $(printf '%s' "$(cat $TMP/perr 2>/dev/null)$(cat $ORACLE_ARGV 2>/dev/null)" | tr '\n' ' ' | cut -c1-300)"
  fi
else
  if [ "$MODE" = full ]; then why="no ORACLE_REAL_SRT"
  else why="needs full mode with ORACLE_REAL_SRT"; fi
  skip "P9-real" "$why"
fi
rm -f "$WT/oracle-inside.txt"

# P10: the runbooks say confined and record each harness's paths and hosts.
COACH="$HERE/skills/postmaster/coachman.md"
HARN="$HERE/skills/postmaster/harnesses.md"
if grep -qi "confin" "$COACH" && ! grep -q "No harness has verified mechanical" "$COACH" \
   && ! grep -q "no mechanical enforcement" "$COACH"; then
  pass "P10a-coachman" "says confined, no mechanical-enforcement denial"
else
  nope "P10a-coachman" "Lane capability text not as AC10 requires"
fi
hosts=0
for d in "chatgpt.com" "anthropic.com" "meta.ai" "xiaomimimo.com"; do
  grep -q "$d" "$HARN" && hosts=$((hosts+1))
done
if grep -qi "confin" "$HARN" && grep -q "sandbox-runtime" "$HARN" && [ "$hosts" -ge 3 ]; then
  pass "P10b-harnesses" "records confinement paths and hosts"
else
  nope "P10b-harnesses" "hosts $hosts/4, confinement coverage missing"
fi

[ $fail -eq 0 ]
