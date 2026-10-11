#!/usr/bin/env bash
# Oracle for #112: blind acceptance tests at the ticket's own interface.
#
# Written by the leg-1 coachman before reading any lane's diff, committed as the
# first commit on the ticket branch. It feeds fixture event streams through
# scripts/view-stream.sh and checks properties, never exact rendering: every
# distinctive word of each message and command is present, no ellipsis cuts
# anything short, tool output stays out, and the new --self-test controls fail
# on the behaviour before this change (the BASE script) and pass on the new one.
#
#   oracle-112.sh            run from the repo root; exit 0 when the worktree's
#                            script meets the ticket, 1 otherwise
#
# The probes assert behaviour the ticket names, not one rendering of it: a lane
# may wrap, prefix and order lines as it likes, as long as the text is all
# there, nothing is cut, and tool output stays out.
set -uo pipefail

BASE_SHA=bb782a973e69427c820ce16a676718e87f51995b
NEW=scripts/view-stream.sh
[ -f "$NEW" ] || { echo "oracle: run from the repo root: $NEW not found" >&2; exit 1; }

tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
BASE_SCRIPT=$tmp/view-stream-base.sh
git show "$BASE_SHA:scripts/view-stream.sh" > "$BASE_SCRIPT" 2>/dev/null \
  || { echo "oracle: cannot read BASE $BASE_SHA:scripts/view-stream.sh" >&2; exit 1; }

render() { printf '%s\n' "$2" | bash "$1"; }   # render <script> <events>

words_present() {  # words_present <output> <words...> : every word occurs
  local out=$1; shift
  local w
  for w in "$@"; do
    grep -qF -- "$w" <<<"$out" || return 1
  done
  return 0
}
no_ellipsis() { case $1 in *"…"*) return 1;; *) return 0;; esac; }
absent() {  # absent <output> <words...> : no word occurs
  local out=$1; shift
  local w
  for w in "$@"; do
    grep -qF -- "$w" <<<"$out" && return 1
  done
  return 0
}

# --- fixtures ----------------------------------------------------------------
# A message of several lines, one per harness that speaks in messages.
CODEX_MSG='{"type":"item.completed","item":{"id":"m3","type":"agent_message","text":"ORACLE-FIRST-LINE alpha\nORACLE-SECOND-LINE beta\nORACLE-THIRD-LINE gamma"}}'
CLAUDE_MSG='{"type":"assistant","message":{"content":[{"type":"text","text":"ORACLE-CLAUDE-ONE\nORACLE-CLAUDE-TWO"}]}}'
MIMO_HELLO='{"type":"step_start","sessionID":"ses_ora'"cle1'","part":{"type":"step-start"}}'
MIMO_MSG='{"type":"text","sessionID":"ses_ora'"cle1'","part":{"type":"text","text":"ORACLE-MIMO-ONE\nORACLE-MIMO-TWO"}}'
P1_WORDS="ORACLE-FIRST-LINE ORACLE-SECOND-LINE ORACLE-THIRD-LINE ORACLE-CLAUDE-ONE ORACLE-CLAUDE-TWO ORACLE-MIMO-ONE ORACLE-MIMO-TWO"

# A single line longer than any pane, of short words so wrapping never splits one.
LONGWORDS=$(printf 'word%.3d ' $(seq 1 28))
CODEX_LONG='{"type":"item.completed","item":{"id":"m4","type":"agent_message","text":"begin '"$LONGWORDS"'end"}}'

# A command longer than the pane, one per harness that runs shell commands.
CODEX_CMD='{"type":"item.started","item":{"id":"c9","type":"command_execution","command":"bash -lc deploy --env ORACLE-CODEX-ENV --target ORACLE-CODEX-TARGET --with ORACLE-CODEX-WITH --and ORACLE-CODEX-AND --more ORACLE-CODEX-MORE --extra ORACLE-CODEX-EXTRA --flags ORACLE-CODEX-FLAGS --tail ORACLE-CODEX-TAIL","status":"in_progress"}}'
MIMO_CMD_HELLO='{"type":"step_start","sessionID":"ses_ora'"cle2'","part":{"type":"step-start"}}'
MIMO_CMD='{"type":"tool_use","sessionID":"ses_ora'"cle2'","part":{"type":"tool","tool":"bash","state":{"status":"completed","input":{"command":"migrate --db ORACLE-MIMO-DB --to ORACLE-MIMO-TO --plan ORACLE-MIMO-PLAN --step ORACLE-MIMO-STEP --force ORACLE-MIMO-FORCE --verify ORACLE-MIMO-VERIFY --extra ORACLE-MIMO-EXTRA --tail ORACLE-MIMO-TAIL"}}}}'
CLAUDE_CMD='{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"build --target ORACLE-CLAUDE-TARGET --config ORACLE-CLAUDE-CONFIG --jobs ORACLE-CLAUDE-JOBS --flag ORACLE-CLAUDE-FLAG --opt ORACLE-CLAUDE-OPT --more ORACLE-CLAUDE-MORE --extra ORACLE-CLAUDE-EXTRA --tail ORACLE-CLAUDE-TAIL"}}]}}'
P3_WORDS="ORACLE-CODEX-ENV ORACLE-CODEX-TARGET ORACLE-CODEX-TAIL ORACLE-MIMO-DB ORACLE-MIMO-TO ORACLE-MIMO-TAIL ORACLE-CLAUDE-TARGET ORACLE-CLAUDE-CONFIG ORACLE-CLAUDE-TAIL"

# A Muse Code stream in the recorded shape: the bash command sits in the tool
# result's envelope beside its output, the model's message in the terminal text.
MUSE_SESSION='{"stream":{"kind":"session","id":"ses_oracle_muse"},"sequence":1,"payload_type":"run.model.configured","payload":{"model_id":"muse-oracle-model","source":"startup"}}'
MUSE_BASH='{"stream":{"kind":"session","id":"ses_oracle_muse"},"sequence":2,"payload_type":"tool.result","payload":{"call_id":"call_oracle1","correlation_facts":{"outcome":"success","tool_name":"bash"},"kind":"tool_result","text":"{\"chunk_id\": \"exec'"-9-9"'\", \"command\": \"ls -a /tmp/ORACLE-MUSE-SENTINEL --color=ORACLE-MUSE-COLOR\", \"description\": \"List sentinel\", \"exit_code\": 0, \"terminal_status\": \"completed\", \"output\": \"OUTPUT-SECRET-112-MUSE-BASH\\nfile1\"}"}}'
MUSE_CHUNK='{"stream":{"kind":"session","id":"ses_oracle_muse"},"sequence":3,"payload_type":"task.lifecycle.output","payload":{"event":{"chunk":"OUTPUT-SECRET-112-MUSE-CHUNK"},"kind":"task_lifecycle"}}'
MUSE_DONE='{"stream":{"kind":"session","id":"ses_oracle_muse"},"sequence":4,"payload_type":"run.terminal.completed","payload":{"terminal":"completed","text":"ORACLE-MUSE-LINE-ONE said\nORACLE-MUSE-LINE-TWO said"}}'
P4_WORDS="ORACLE-MUSE-SENTINEL ORACLE-MUSE-COLOR ORACLE-MUSE-LINE-ONE ORACLE-MUSE-LINE-TWO"

# Tool output that must stay out of the pane under every harness.
CLAUDE_RES='{"type":"user","message":{"content":[{"type":"tool_result","content":"OUTPUT-SECRET-112-CLAUDE-RESULT unimportant"}]}}'
CODEX_DONE='{"type":"item.completed","item":{"id":"c1","type":"command_execution","command":"true","aggregated_output":"OUTPUT-SECRET-112-CODEX-OUTPUT","exit_code":0,"status":"completed"}}'
P5_PART_01='OUT'; P5_PART_02='PUT'; P5_PART_03='-SE'; P5_PART_04='CRE'; P5_PART_05='T-1'; P5_PART_06='12-'; P5_PART_07='CLA'; P5_PART_08='UDE'; P5_PART_09='-RE'; P5_PART_10='SUL'; P5_PART_11='T O'; P5_PART_12='UTP'; P5_PART_13='UT-'; P5_PART_14='SEC'; P5_PART_15='RET'; P5_PART_16='-11'; P5_PART_17='2-C'; P5_PART_18='ODE'; P5_PART_19='X-O'; P5_PART_20='UTP'; P5_PART_21='UT '; P5_PART_22='OUT'; P5_PART_23='PUT'; P5_PART_24='-SE'; P5_PART_25='CRE'; P5_PART_26='T-1'; P5_PART_27='12-'; P5_PART_28='MUS'; P5_PART_29='E-C'; P5_PART_30='HUN'; P5_PART_31='K'; P5_SECRETS="${P5_PART_01}${P5_PART_02}${P5_PART_03}${P5_PART_04}${P5_PART_05}${P5_PART_06}${P5_PART_07}${P5_PART_08}${P5_PART_09}${P5_PART_10}${P5_PART_11}${P5_PART_12}${P5_PART_13}${P5_PART_14}${P5_PART_15}${P5_PART_16}${P5_PART_17}${P5_PART_18}${P5_PART_19}${P5_PART_20}${P5_PART_21}${P5_PART_22}${P5_PART_23}${P5_PART_24}${P5_PART_25}${P5_PART_26}${P5_PART_27}${P5_PART_28}${P5_PART_29}${P5_PART_30}${P5_PART_31}"

# --- probes: probe_N <script> renders fixtures and checks properties ---------
# shellcheck disable=SC2317
probe_1_multiline() {  # AC1: every line of every message shows, nothing cut
  local out; out=$(printf '%s\n' "$CODEX_MSG" "$CLAUDE_MSG" "$MIMO_HELLO" "$MIMO_MSG" | bash "$1")
  # shellcheck disable=SC2086
  words_present "$out" $P1_WORDS && no_ellipsis "$out"
}
probe_2_longline() {  # AC1: a line longer than the pane shows whole, not cut
  local out; out=$(render "$1" "$CODEX_LONG")
  # shellcheck disable=SC2086
  words_present "$out" $LONGWORDS && no_ellipsis "$out"
}
probe_3_commands() {  # AC2: each command shows in full
  local out; out=$(printf '%s\n' "$CODEX_CMD" "$MIMO_CMD_HELLO" "$MIMO_CMD" "$CLAUDE_CMD" | bash "$1")
  # shellcheck disable=SC2086
  words_present "$out" $P3_WORDS && no_ellipsis "$out"
}
probe_4_muse() {  # AC3+AC4: a muse stream shows commands and messages, not output
  local out; out=$(printf '%s\n' "$MUSE_SESSION" "$MUSE_BASH" "$MUSE_CHUNK" "$MUSE_DONE" | bash "$1")
  # shellcheck disable=SC2086
  words_present "$out" $P4_WORDS \
    && absent "$out" OUTPUT-SECRET-112-MUSE-BASH OUTPUT-SECRET-112-MUSE-CHUNK \
    && no_ellipsis "$out"
}
probe_5_quiet() {  # AC4: tool output stays out of the pane, beside a message that shows
  local out; out=$(printf '%s\n' "$CLAUDE_RES" "$CODEX_DONE" "$MUSE_CHUNK" "$CODEX_MSG" | bash "$1")
  # shellcheck disable=SC2086
  words_present "$out" ORACLE-FIRST-LINE \
    && absent "$out" $P5_SECRETS
}
probe_6_selftest() {  # AC5: the self-test passes, names the three controls, each fails pre-change
  local log=$tmp/selftest.txt
  bash "$1" --self-test >"$log" 2>&1 || return 1
  grep -qF 'every line of what the model said' "$log" \
    && grep -qF 'longer than the display width' "$log" \
    && grep -qF 'recorded stream shows its full command and message' "$log" \
    || return 1
  # each control's fixture fails on the old behaviour
  local c1 c2 c3
  c1=$(printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"The command printed 3 entries.\nMore detail."}]}}' | bash "$BASE_SCRIPT")
  case $c1 in *"More detail"*) return 1;; esac   # old renderer cuts to the first line
  c2=$(printf '{"type":"item.started","item":{"type":"command_execution","command":"%s"}}\n' "$(printf '%200s' '' | tr ' ' x)" | bash "$BASE_SCRIPT")
  case $c2 in *"…"*) : ;; *) return 1;; esac     # old renderer cuts with an ellipsis
  c3=$(printf '%s\n' "$MUSE_BASH" "$MUSE_DONE" | bash "$BASE_SCRIPT")
  case $c3 in *"ORACLE-MUSE-SENTINEL"*) return 1;; *) : ;; esac  # old pane shows a bare bash
  case $c3 in *"ORACLE-MUSE-LINE-TWO"*) return 1;; *) : ;; esac  # ... and the first line only
  return 0
}
probe_7_follow() {  # the pane path: follow mode shows full text, nothing cut
  local f=$tmp/follow.jsonl; : > "$f"
  ( printf '%s\n' "$CODEX_MSG" >>"$f"; sleep 0.3
    printf '%s\n' "$CODEX_CMD" >>"$f"; sleep 0.3 ) &
  local writer=$!
  local out; out=$(COLUMNS=60 bash "$1" --follow "$f" --pid "$writer")
  # shellcheck disable=SC2086
  words_present "$out" ORACLE-FIRST-LINE ORACLE-SECOND-LINE ORACLE-THIRD-LINE \
    ORACLE-CODEX-ENV ORACLE-CODEX-TARGET ORACLE-CODEX-TAIL \
    && no_ellipsis "$out"
}

# --- run ---------------------------------------------------------------------
new_fails=0
base_fails=0
echo "oracle-112: new script is $NEW, old behaviour is $BASE_SHA:scripts/view-stream.sh"
run_probe() {  # run_probe <n> <label> <script> <var-prefix>
  if "probe_$1" "$3"; then printf '  ok   %s on %s\n' "$2" "$4";
  else printf '  FAIL %s on %s\n' "$2" "$4"; return 1; fi
}
# the probes are named probe_1..probe_7 through aliases below
probe_1() { probe_1_multiline "$1"; }
probe_2() { probe_2_longline "$1"; }
probe_3() { probe_3_commands "$1"; }
probe_4() { probe_4_muse "$1"; }
probe_5() { probe_5_quiet "$1"; }
probe_6() { probe_6_selftest "$1"; }
probe_7() { probe_7_follow "$1"; }

for spec in "1:multiline message" "2:long line" "3:commands in full" "4:muse stream" "5:tool output stays out"; do
  n=${spec%%:*}; label=${spec#*:}
  run_probe "$n" "$label" "$NEW" new || new_fails=$((new_fails+1))
  run_probe "$n" "$label" "$BASE_SCRIPT" base >/dev/null 2>&1 \
    && base_pass="passes" || { base_pass="fails"; base_fails=$((base_fails+1)); }
  printf '       (base %s on %s)\n' "$base_pass" "$label"
done
run_probe 6 "self-test covers the three areas, each failing pre-change" "$NEW" new || new_fails=$((new_fails+1))
run_probe 7 "follow mode shows full text" "$NEW" new || new_fails=$((new_fails+1))

echo
if [ "$base_fails" -ge 4 ]; then echo "fails-before: the new behaviour fails on the old script (4 of P1-P4 fail there)";
else echo "fails-before: WEAK, only $base_fails of P1-P4 fail on the old script"; fi
[ "$new_fails" -eq 0 ] && { echo "oracle-112: all probes pass on the new script"; exit 0; }
echo "oracle-112: $new_fails probe(s) fail on the new script"; exit 1
