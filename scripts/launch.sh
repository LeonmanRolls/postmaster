#!/usr/bin/env bash
# Launch or resume a lane or a role by name, from the config, in the exact form harnesses.md
# records for its harness. One command for every harness, so no form is ever copied by hand;
# this script and harnesses.md must agree, and a change to one is a change to both.
#
#   launch.sh form   <name> [--leg <leg>] [--run <dispatch>] [--project <repo>]
#   launch.sh launch <name> <cwd> <prompt-file> [--leg <leg>] [--last <file>] [--run <dispatch>]
#   launch.sh review <lane> <cwd> <base> [--last <file>] [--run <dispatch>]
#   launch.sh resume <name> <cwd> <thread-id> <prompt-file> [--leg <leg>] [--last <file>]
#                    [--run <dispatch>]
#   launch.sh skill  <name> <skill> [--run <dispatch>]
#   launch.sh thread-id <events-file>       the thread id a stream records, from its shape
#   launch.sh transient <err-file> [<stream-file> [<skip-lines>]]
#                                           exit 0 when a leg's end is a transient provider
#                                           error this adapter names (harnesses.md)
#   launch.sh wall-tokens                   the wall token stems transient vetoes on, one per line
#   launch.sh wall-quotes                   the quote corpus, one wall phrasing per line
#   launch.sh --self-test
#
# The config is the live one, ~/.postmaster/config.toml (POSTMASTER_CONFIG overrides the path),
# unless --run names the dispatch directory of the run being served. Then it is the config that
# run recorded at dispatch, `config` in <dispatch>/run.json (scripts/run-meta.sh): the live
# config is not read at all, and a run.json that is missing or unreadable is refused. Every
# launch and resume inside a run passes --run; the postmaster's own spawn and the config check
# before dispatch do not. A run launch exports its durable session beside the events stream,
# then records usage from the stream or session record beside it. The host passes its explicit
# role in POSTMASTER_LAUNCH_ROLE; this script knows the lane or coachman leg. Export and usage
# recording failures are loud and leave the harness's exit status alone.
# The checks below apply to a recorded config as to the live one.
#
# A form with --project resolves the target's local role choices. <name> is a lane from
# [lanes.<name>], or `coachman`, `coachman_fallback` or `postmaster`
# from [team]. <leg> is synthesis, review or ship, and with --leg, [team.coachman_legs.<leg>]
# overrides the coachman for that leg. Launching or resuming `coachman` needs --leg; `form`
# without it shows team.coachman. The coachman is refused when [team.coachman_legs] names any
# other leg or holds an entry that is not a table, and the coachman and the fallback are
# refused on a lane's model, a model id's bracketed suffixes aside. HARNESS, MODEL, EFFORT and
# ENV_FILE come from the config alone, never from the environment. A lane's env_file is how a
# harness reaches an alternate backend: a file outside this repo, never a value in the config,
# and a relative path is read from the live config's directory, under --run too. It is shell,
# sourced last, once the command, its directory and its stdin are fixed, so its assignments
# reach the harness and not this script's choices; it runs as code, and is the user's to write.
# The events stream goes to stdout; the caller redirects and backgrounds. `review` invokes a
# lane's own bug-review form against <base>...HEAD, at the harness's top level. --last names the
# file a harness writes its final message to, where the harness supports it (codex -o). `skill`
# prints the prompt that invokes the lane's harness's own skill (harnesses.md, Own review
# skills); `launch` runs it like any other prompt. The one skill is security-review. `form`
# prints two lines: `launch: ` and the launch form, then `resume: ` and the resume form, or
# `resume: none: ` and why there is none.
#
# thread-id reads an events stream and prints the first thread id its shape carries (codex
# thread_id, claude session_id, grok session id, agy conversationId, pi session id, muse
# stream.id, mimo sessionID); it is how a launch's id is recorded after the stream has
# started. transient names the provider errors that are worth resuming on rather than
# escalating: a model stream idle timeout, a gateway failure, a stream drop. The set is here
# and in harnesses.md, never in the watcher. It is matched against the leg's durable record:
# its .err file and the error records in its stream tail, never a prompt or a user message.
# The tail starts after skip-lines, the lines an earlier launch wrote: a resumed stream
# keeps its history, and an old error must not classify the current end. A launch refusal,
# and a quota, payment, usage or rate wall, are never transient and take precedence over
# any transient signature.
#
#   exit 0  the forms or the skill's prompt were printed, or the harness exited 0; thread-id
#           found an id; transient matched a named provider error; wall-tokens or wall-quotes
#           listed their lines
#   exit 1  usage, config or run.json missing or unreadable, unknown name, a leg that is not
#           synthesis, review or ship, the coachman launched or resumed with no --leg, a
#           coachman or fallback on a lane's model, harness not on PATH, env_file missing, a
#           form this script does not have (agy resume), a skill that is not security-review,
#           a muse or mimo resume of a thread the launch's data directory does not hold,
#           thread-id with no id in the stream, or transient with a record that is not named
#   exit 3  skill or review: the lane's harness has no such review form recorded
#   else    the harness's own exit code
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
CONFIG=${POSTMASTER_CONFIG:-$HOME/.postmaster/config.toml}
LAUNCH_ROLE=${POSTMASTER_LAUNCH_ROLE:-}

if [ "${1:-}" = --self-test ]; then
  # Each control runs this script on a fixture config, with stub harnesses first on PATH.
  # `form` only prints, so nothing is launched. A run's record is written from a fixture by
  # run-meta.sh, as at dispatch, so what this script reads is what that one writes.
  unset POSTMASTER_LAUNCH_NAME   # a gate run through host.sh run inherits one; a control that needs one sets its own
  unset POSTMASTER_LAUNCH_ROLE
  self=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)/$(basename -- "$0")
  here=$(dirname "$self")
  tmp=$(mktemp -d) || exit 1
  trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
  # A stub prints its arguments and PROBE, which an env file may set, so a launch or a resume
  # shows the harness, model, effort and env file it would run on.
  mkdir "$tmp/bin" "$tmp/wt"
  for h in claude pi codex; do
    printf '#!/bin/sh\necho "$@ probe=${PROBE:-}"\n' > "$tmp/bin/$h" && chmod +x "$tmp/bin/$h"
  done
  # The muse and mimo stubs also print what arrived on their stdin. Their export finds a thread
  # only where a file of its name sits in their XDG_DATA_HOME.
  printf '#!/bin/sh\n[ "$1" = export ] && { [ -e "$XDG_DATA_HOME/$2" ] && exit 0; echo "Session not found: $2" >&2; exit 1; }\nprintf "%%s probe=%%s stdin=%%s import-off=%%s data=%%s\\n" "$*" "${PROBE:-}" "$(cat)" "${MIMOCODE_DISABLE_CLAUDE_IMPORT:-}" "${XDG_DATA_HOME:-}"\n' > "$tmp/bin/mimo" && chmod +x "$tmp/bin/mimo"
  printf '#!/bin/sh\n[ "$1" = export ] && { [ -e "$XDG_DATA_HOME/$3" ] && : > "$5" && exit 0; echo "no retained session log found for session $3" >&2; exit 1; }\nprintf "%%s probe=%%s stdin=%%s data=%%s\\n" "$*" "${PROBE:-}" "$(cat)" "${XDG_DATA_HOME:-}"\n' > "$tmp/bin/muse" && chmod +x "$tmp/bin/muse"
  [ -x "$tmp/bin/claude" ] && [ -x "$tmp/bin/pi" ] && [ -x "$tmp/bin/codex" ] && [ -x "$tmp/bin/muse" ] \
    || { echo "self-test: cannot write the stub harnesses"; exit 1; }
  printf 'Continue.\n' > "$tmp/prompt.txt"
  fixture() {  # fixture <name> [<key>...]; each key in [team.coachman_legs] runs on <key>-model
    local name=$1 k; shift
    { printf '[lanes.one]\nharness = "claude"\nmodel = "lane-model"\n\n[team]\n'
      printf 'coachman = { harness = "claude", model = "coach-model" }\n'
      printf 'coachman_fallback = { harness = "claude", model = "fallback-model" }\n\n[team.coachman_legs]\n'
      for k in "$@"; do printf '%s = { harness = "claude", model = "%s-model" }\n' "$k" "$k"; done
    } > "$tmp/$name.toml"
  }
  rawfix() {  # rawfix <name> <[team.coachman_legs] body, \n-separated>
    fixture "$1"; printf '%b' "$2" >> "$tmp/$1.toml"
  }
  # The codex forms: a codex stub that prints the directory it runs in and then each argument
  # on its own line, lane one and the coachman on codex, a repo with a branch and a detached
  # worktree of it, and a check on the stub's exact output, since the form is what is tested.
  printf '#!/bin/sh\nprintf "%%s\\n" "$PWD" "$@"\n' > "$tmp/bin/codex" && chmod +x "$tmp/bin/codex"
  codexfix() {  # codexfix <name> <lane one's keys, \n-separated>
    { printf '[lanes.one]\nharness = "codex"\n%b\n\n[team]\n' "$2"
      printf 'coachman = { harness = "codex", model = "coach-model" }\n\n[team.coachman_legs]\n'
      printf 'review = { harness = "codex", model = "review-model", effort = "medium" }\n'
    } > "$tmp/$1.toml"
  }
  codexfix codex 'model = "lane-model"\neffort = "high"'
  codexfix codex-noeffort 'model = "lane-model"'
  codexfix codex-nomodel 'effort = "high"'
  codexfix review-codex 'model = "lane-model"\neffort = "low"'
  printf -- '- Keep going, then stop.\n' > "$tmp/ruling.txt"
  printf 'Keep going, then stop.\n' > "$tmp/brief.txt"
  git init -q -b main "$tmp/cx" && git -C "$tmp/cx" -c user.name=t -c user.email=t@example.invalid \
    commit -q --allow-empty -m init && git -C "$tmp/cx" worktree add -q --detach "$tmp/cx-detached" \
    || { echo "self-test: cannot make the codex fixture repo"; exit 1; }
  lines() { printf '%s\n' "$@"; }
  runs_as() {  # runs_as <label> <fixture> <the stub's exact output> <args...>
    local label=$1 f=$2 want=$3; shift 3; run "$f" "$@"
    [ $rc -eq 0 ] && [ "$out" = "$want" ] && ok "$label" || fail "$label"
  }
  CODEX_BYPASS=--dangerously-bypass-approvals-and-sandbox
  CODEX_HIGH='model_reasoning_effort="high"'
  fixture legs synthesis review ship
  fixture none
  for k in style bug security; do fixture "old-$k" review "$k"; done
  fixture typo revue
  rawfix onlane 'review = { harness = "claude", model = "lane-model" }\n'
  rawfix notable 'review = "claude"\n'
  rawfix dup 'review = { harness = "claude", model = "a" }\nreview = { harness = "claude", model = "b" }\n'
  rawfix suffix 'review = { harness = "claude", model = "lane-model[1m]" }\n'
  rawfix suffixes 'review = { harness = "claude", model = "lane-model[1m][2m]" }\n'
  mkdir "$tmp/elsewhere"; printf 'PROBE=config-dir\n' > "$tmp/rel.env"; printf 'PROBE=worktree\n' > "$tmp/wt/rel.env"
  : > "$tmp/empty.txt"; printf 'x\n' > "$tmp/unreadable.txt"; chmod 000 "$tmp/unreadable.txt"
  rawfix emptyleg 'synthesis = {}\n'
  head='[lanes.one]\nharness = "claude"\nmodel = "lane-model"\n\n[team]\n'
  printf "$head"'coachman = { harness = "claude", model = "lane-model" }\n' > "$tmp/coachlane.toml"
  printf "$head"'coachman = { harness = "claude", model = "coach-model" }\ncoachman_fallback = { harness = "claude", model = "lane-model" }\n' > "$tmp/fblane.toml"
  printf '[lanes.one]\nharness = "claude"\n\n[team]\ncoachman = { harness = "claude" }\n' > "$tmp/bare.toml"
  printf 'MODEL=lane-model\nHARNESS=nope\nPROBE=reached\n' > "$tmp/over.env"
  printf "$head"'coachman = { harness = "claude", model = "coach-model", env_file = "%s" }\n' "$tmp/over.env" > "$tmp/envfile.toml"
  printf "$head"'coachman = { harness = "claude", model = "coach-model", env_file = "rel.env" }\n' > "$tmp/relenv.toml"
  rawfix edited 'review = { harness = "claude", model = "edited-model" }\n'
  # One lane as dispatched, and as edited since: every field a launch takes differs.
  printf 'PROBE=then\n' > "$tmp/then.env"; printf 'PROBE=now\n' > "$tmp/now.env"
  printf '[lanes.one]\nharness = "claude"\nmodel = "then-model"\neffort = "high"\nenv_file = "%s"\n' "$tmp/then.env" > "$tmp/then.toml"
  printf '[lanes.one]\nharness = "pi"\nmodel = "now-model"\neffort = "low"\nenv_file = "%s"\n' "$tmp/now.env" > "$tmp/now.toml"
  out="" err="" rc=0 fails=0 envx=""
  run() {  # run <fixture> <args...>; $envx is extra environment for the run
    local f=$1; shift
    out=$(env $envx POSTMASTER_CONFIG="$tmp/$f.toml" PATH="$tmp/bin:$PATH" "$self" "$@" 2>"$tmp/err"); rc=$?
    err=$(cat "$tmp/err")
  }
  ok()   { printf '  ok   %s\n' "$1"; }
  fail() { printf '  FAIL %s (exit %s)\n' "$1" "$rc"; printf '%s\n' "$out$err" | sed 's/^/         /'; fails=$((fails+1)); }
  runs_on() {  # runs_on <label> <fixture> <model> <args...>: the printed form runs on <model>
    local label=$1 f=$2 m=$3; shift 3; run "$f" "$@"
    [ $rc -eq 0 ] && case $out in *"--model $m "*) true ;; *) false ;; esac && ok "$label" || fail "$label"
  }
  refused() {  # refused <label> <fixture> <text the message must carry> <args...>
    local label=$1 f=$2 want=$3; shift 3; run "$f" "$@"
    [ $rc -eq 1 ] && [ -z "$out" ] && case $err in *"$want"*) true ;; *) false ;; esac && ok "$label" || fail "$label"
  }
  carries() {  # carries <label> <fixture> <text the output must carry> <args...>
    local label=$1 f=$2 want=$3; shift 3; run "$f" "$@"
    [ $rc -eq 0 ] && case $out in *"$want"*) true ;; *) false ;; esac && ok "$label" || fail "$label"
  }
  lacks() {  # lacks <label> <fixture> <text the output must not carry> <args...>
    local label=$1 f=$2 bad=$3; shift 3; run "$f" "$@"
    [ $rc -eq 0 ] && case $out in *"$bad"*) false ;; *) true ;; esac && ok "$label" || fail "$label"
  }
  printed() {  # printed <label> <text>...: the last run exited 0 and printed every <text>
    local label=$1 t; shift
    for t in "$@"; do case $out in *"$t"*) ;; *) fail "$label"; return ;; esac; done
    [ $rc -eq 0 ] && ok "$label" || fail "$label"
  }
  record() {  # record <run> <fixture>: $tmp/repo/.postmaster/runs/<run>/run.json, recording that fixture as at dispatch
    mkdir -p "$tmp/repo/.postmaster/runs/$1" && POSTMASTER_CONFIG="$tmp/$2.toml" POSTMASTER_TOOL_PINS="$tmp/tools" PATH="$tmp/bin:$PATH" \
      "$here/run-meta.sh" "$tmp/repo/.postmaster/runs/$1" "$tmp/repo" >/dev/null \
      || { printf '  FAIL run-meta.sh records %s as run %s\n' "$2" "$1"; fails=$((fails+1)); }
  }
  calls() {  # calls <runbook>...: each launch and resume in them, one per line, marked run or unrun
    python3 - "$@" <<'PY'
import re, sys
CALL = re.compile(r"scripts/launch\.sh\s+(?:launch|resume)\b")
FENCE = re.compile(r"^([ \t]*```.*?^[ \t]*```)", re.S | re.M)
for path in sys.argv[1:]:
    cmds = []
    for i, part in enumerate(FENCE.split(open(path, encoding="utf-8").read())):
        if i % 2:   # a fenced block: a command is its line, once continuations are joined
            cmds += [line[m.start():] for line in re.sub(r"\\\n\s*", " ", part).splitlines()
                     for m in CALL.finditer(line)]
        else:       # prose: a command is an inline code span, which may cross a line break
            cmds += [span[m.start():] for span in re.findall(r"`([^`]+)`", part)
                     for m in CALL.finditer(span)]
    for c in cmds:
        print("%s %s: %s" % ("run" if "--run <dispatch>" in c else "unrun", path, " ".join(c.split())))
PY
  }
  printf '%s\n' 'Fenced, with no --run:' '' '```sh' '( scripts/launch.sh launch a <wt> <prompt-file> \' \
    '    > <dispatch>/logs/a-events.jsonl ) &' '```' '' 'Fenced and indented, with it:' '' '   ```sh' \
    '   ( scripts/launch.sh launch b <wt> <prompt-file> \' '       --run <dispatch> > <dispatch>/logs/b-events.jsonl ) &' \
    '   ```' '' 'Inline, with no --run: `scripts/launch.sh resume c <wt> <thread-id> <prompt-file>`. Inline and' \
    'across a line break, with it: `<tool>/scripts/launch.sh resume d <wt> <thread-id>' '<prompt-file> --run <dispatch>`.' \
    > "$tmp/runbook.md"
  git init -q "$tmp/repo" >/dev/null 2>&1
  record run legs
  record run-then then
  record run-old-bug old-bug
  record run-onlane onlane
  printf '[lanes.g]\nharness = "agy"\nmodel = "agy-model"\n' > "$tmp/agy-run.toml"
  cat > "$tmp/bin/agy" <<'EOF'
#!/bin/sh
printf '{"conversationId":"thread-agy"}\n'
EOF
  chmod +x "$tmp/bin/agy"
  record run-agy agy-run
  agy_dispatch=$tmp/repo/.postmaster/runs/run-agy
  agy_events=$agy_dispatch/logs/g-events.jsonl
  mkdir -p "$(dirname "$agy_events")"
  POSTMASTER_LAUNCH_ROLE=lane POSTMASTER_EVENT_STREAM="$agy_events" POSTMASTER_CONFIG="$tmp/agy-run.toml" PATH="$tmp/bin:$PATH" \
    "$self" launch g "$tmp/wt" "$tmp/prompt.txt" --run "$agy_dispatch" >"$agy_events" 2>"$tmp/err"; rc=$?; err=$(cat "$tmp/err"); out=$(cat "$agy_events")
  [ "$rc" -eq 0 ] && [ "$out" = '{"conversationId":"thread-agy"}' ] \
    && cmp -s "$agy_events" "$agy_dispatch/sessions/g/thread-agy.events.jsonl" \
    && ok "a run launch exports its durable session beside the harness event stream" \
    || fail "a run launch exports its durable session beside the harness event stream"
  python3 - "$agy_dispatch/logs/g-events-usage.json" <<'PY'
import json, sys
record = json.load(open(sys.argv[1]))
assert record["role"] == "workhorse" and record["lane"] == "g" and record["harness"] == "agy"
assert "input_tokens" not in record and "output_tokens" not in record and "cost_usd" not in record
PY
  [ $? -eq 0 ] && ok "a run launch records its explicit role and lane without inventing figures" \
    || fail "a run launch records its explicit role and lane without inventing figures"
  printf '[lanes.g]\nharness = "agy"\nmodel = "agy-model"\n\n[team]\ncoachman = { harness = "agy", model = "coach-model" }\ncoachman_fallback = { harness = "agy", model = "fallback-model" }\n' > "$tmp/agy-roles.toml"
  record run-agy-roles agy-roles
  roles_dispatch=$tmp/repo/.postmaster/runs/run-agy-roles
  mkdir -p "$roles_dispatch/logs"
  reviewer_events=$roles_dispatch/logs/reviewer-events.jsonl
  POSTMASTER_LAUNCH_ROLE=reviewer POSTMASTER_EVENT_STREAM="$reviewer_events" POSTMASTER_CONFIG="$tmp/agy-roles.toml" PATH="$tmp/bin:$PATH" \
    "$self" launch g "$tmp/wt" "$tmp/prompt.txt" --run "$roles_dispatch" >"$reviewer_events" 2>"$tmp/err"; rc=$?
  python3 - "$roles_dispatch/logs/reviewer-events-usage.json" reviewer g <<'PY'
import json, sys
record = json.load(open(sys.argv[1]))
assert (record["role"], record["lane"]) == (sys.argv[2], sys.argv[3])
PY
  check_rc=$?
  [ "$rc" -eq 0 ] && [ "$check_rc" -eq 0 ] && ok "a reviewer launch records its reviewer lane" \
    || fail "a reviewer launch records its reviewer lane"
  coachman_events=$roles_dispatch/logs/coachman-events.jsonl
  POSTMASTER_LAUNCH_ROLE=coachman POSTMASTER_EVENT_STREAM="$coachman_events" POSTMASTER_CONFIG="$tmp/agy-roles.toml" PATH="$tmp/bin:$PATH" \
    "$self" launch coachman "$tmp/wt" "$tmp/prompt.txt" --leg synthesis --run "$roles_dispatch" >"$coachman_events" 2>"$tmp/err"; rc=$?
  python3 - "$roles_dispatch/logs/coachman-events-usage.json" coachman synthesis <<'PY'
import json, sys
record = json.load(open(sys.argv[1]))
assert (record["role"], record["lane"]) == (sys.argv[2], sys.argv[3])
PY
  check_rc=$?
  [ "$rc" -eq 0 ] && [ "$check_rc" -eq 0 ] && ok "a coachman launch records its leg" \
    || fail "a coachman launch records its leg"
  fallback_events=$roles_dispatch/logs/fallback-events.jsonl
  POSTMASTER_LAUNCH_ROLE=coachman POSTMASTER_EVENT_STREAM="$fallback_events" POSTMASTER_CONFIG="$tmp/agy-roles.toml" PATH="$tmp/bin:$PATH" \
    "$self" launch coachman_fallback "$tmp/wt" "$tmp/prompt.txt" --leg ship --run "$roles_dispatch" >"$fallback_events" 2>"$tmp/err"; rc=$?
  python3 - "$roles_dispatch/logs/fallback-events-usage.json" coachman ship <<'PY'
import json, sys
record = json.load(open(sys.argv[1]))
assert (record["role"], record["lane"]) == (sys.argv[2], sys.argv[3])
PY
  check_rc=$?
  [ "$rc" -eq 0 ] && [ "$check_rc" -eq 0 ] && ok "a fallback coachman launch records its leg" \
    || fail "a fallback coachman launch records its leg"
  sessions_before=$(ls "$agy_dispatch/sessions/g" | wc -l)
  printf '#!/bin/sh\nexit 0\n' > "$tmp/bin/agy"; chmod +x "$tmp/bin/agy"
  empty_events=$agy_dispatch/logs/g-empty.jsonl; : > "$empty_events"
  POSTMASTER_LAUNCH_ROLE=lane POSTMASTER_EVENT_STREAM="$empty_events" POSTMASTER_CONFIG="$tmp/agy-run.toml" PATH="$tmp/bin:$PATH" \
    "$self" launch g "$tmp/wt" "$tmp/prompt.txt" --run "$agy_dispatch" >"$empty_events" 2>"$tmp/err"; rc=$?; err=$(cat "$tmp/err")
  [ "$rc" -eq 0 ] && [ ! -s "$empty_events" ] && grep -q "its session was not exported" <<<"$err" \
    && [ "$(ls "$agy_dispatch/sessions/g" | wc -l)" = "$sessions_before" ] \
    && ok "an empty event stream is a loud missed export, not a silent skip" \
    || fail "an empty event stream is a loud missed export, not a silent skip (exit $rc)" "$err"
  printf '#!/bin/sh\nprintf "{\\"nope\\":1}\\n"\nexit 0\n' > "$tmp/bin/agy"; chmod +x "$tmp/bin/agy"
  POSTMASTER_LAUNCH_ROLE=lane POSTMASTER_EVENT_STREAM="$agy_events" POSTMASTER_CONFIG="$tmp/agy-run.toml" PATH="$tmp/bin:$PATH" \
    "$self" launch g "$tmp/wt" "$tmp/prompt.txt" --run "$agy_dispatch" >"$agy_events" 2>"$tmp/err"; rc=$?; err=$(cat "$tmp/err")
  [ "$rc" -eq 0 ] && grep -q "its session was not exported" <<<"$err" \
    && ok "a failed export still exits with the harness's status" \
    || fail "a failed export still exits with the harness's status (exit $rc)" "$err"
  printf '#!/bin/sh\nprintf "{\\"conversationId\\":\\"thread-rc\\"}\\n"\nexit 3\n' > "$tmp/bin/agy"; chmod +x "$tmp/bin/agy"
  rc_events=$agy_dispatch/logs/g-rc.jsonl
  POSTMASTER_LAUNCH_ROLE=lane POSTMASTER_EVENT_STREAM="$rc_events" POSTMASTER_CONFIG="$tmp/agy-run.toml" PATH="$tmp/bin:$PATH" \
    "$self" launch g "$tmp/wt" "$tmp/prompt.txt" --run "$agy_dispatch" >"$rc_events" 2>"$tmp/err"; rc=$?
  [ "$rc" -eq 3 ] && cmp -s "$rc_events" "$agy_dispatch/sessions/g/thread-rc.events.jsonl" \
    && ok "a harness failure keeps its exit when the export succeeds" \
    || fail "a harness failure keeps its exit when the export succeeds (exit $rc)" "$(cat "$tmp/err")"
  printf '[lanes.g]\nharness = "agy"\nmodel = "agy-model"\nenv_file = "%s"\n' "$tmp/poison.env" > "$tmp/agy-env.toml"
  record run-agy-env agy-env
  env_dispatch=$tmp/repo/.postmaster/runs/run-agy-env
  mkdir -p "$env_dispatch/logs"
  printf '{"conversationId":"thread-decoy"}\n' > "$env_dispatch/logs/g-decoy.jsonl"
  printf 'POSTMASTER_EVENT_STREAM="%s"\nPOSTMASTER_LAUNCH_ROLE=reviewer\n' "$env_dispatch/logs/g-decoy.jsonl" > "$tmp/poison.env"
  printf '#!/bin/sh\nprintf "{\\"conversationId\\":\\"thread-real\\"}\\n"\nexit 0\n' > "$tmp/bin/agy"; chmod +x "$tmp/bin/agy"
  real_events=$env_dispatch/logs/g-real.jsonl
  POSTMASTER_LAUNCH_ROLE=lane POSTMASTER_EVENT_STREAM="$real_events" POSTMASTER_CONFIG="$tmp/agy-env.toml" PATH="$tmp/bin:$PATH" \
    "$self" launch g "$tmp/wt" "$tmp/prompt.txt" --run "$env_dispatch" >"$real_events" 2>"$tmp/err"; rc=$?
  [ "$rc" -eq 0 ] && cmp -s "$real_events" "$env_dispatch/sessions/g/thread-real.events.jsonl" \
    && [ ! -e "$env_dispatch/sessions/g/thread-decoy.events.jsonl" ] \
    && ok "a lane env file cannot redirect the session export" \
    || fail "a lane env file cannot redirect the session export (exit $rc)" "$(cat "$tmp/err")"
  python3 - "$env_dispatch/logs/g-real-usage.json" <<'PY'
import json, sys
assert json.load(open(sys.argv[1]))["role"] == "workhorse"
PY
  [ $? -eq 0 ] && ok "a lane env file cannot change the recorded role" \
    || fail "a lane env file cannot change the recorded role"
  mkdir -p "$tmp/repo/.postmaster/runs/no-record" "$tmp/repo/.postmaster/runs/garbled" "$tmp/repo/.postmaster/runs/unrecorded"
  printf '{"config": \n' > "$tmp/repo/.postmaster/runs/garbled/run.json"
  printf '{"run": "T-1"}\n' > "$tmp/repo/.postmaster/runs/unrecorded/run.json"

  echo "positive controls"
  for k in synthesis review ship; do
    runs_on "--leg $k runs on its own [team.coachman_legs] entry" legs "$k-model" form coachman --leg "$k"
  done
  runs_on "a leg with no entry runs on team.coachman" none coach-model form coachman --leg review
  runs_on "a lane runs on its own model" legs lane-model form one
  runs_on "a lane launches on a config the coachman refuses" old-bug lane-model form one
  runs_on "a launch with --leg synthesis runs on the synthesis entry" legs synthesis-model launch coachman "$tmp/wt" "$tmp/prompt.txt" --leg synthesis
  runs_on "a resume with --leg review runs on the review entry" legs review-model resume coachman "$tmp/wt" T-1 "$tmp/prompt.txt" --leg review
  runs_as "a codex resume runs in its worktree on its lane's model and effort, streams JSON, writes -o, and passes a prompt that starts with -" codex \
    "$(lines "$tmp/wt" exec resume T-1 --json -o "$tmp/last.md" -m lane-model -c "$CODEX_HIGH" "$CODEX_BYPASS" -- '- Keep going, then stop.')" \
    resume one "$tmp/wt" T-1 "$tmp/ruling.txt" --last "$tmp/last.md"
  runs_as "a codex coachman resumes with --leg review on the review entry's model and effort" codex \
    "$(lines "$tmp/wt" exec resume T-1 --json -m review-model -c 'model_reasoning_effort="medium"' "$CODEX_BYPASS" -- '- Keep going, then stop.')" \
    resume coachman "$tmp/wt" T-1 "$tmp/ruling.txt" --leg review
  envx="HOME=$tmp/home"   # a codex launch marks its worktree trusted in $HOME/.codex
  runs_as "a codex launch on a branch runs with -C and --json, and no --skip-git-repo-check" codex \
    "$(lines "$tmp/cx" exec -C "$tmp/cx" --json -m lane-model -c "$CODEX_HIGH" "$CODEX_BYPASS" 'Keep going, then stop.')" \
    launch one "$tmp/cx" "$tmp/brief.txt"
  runs_as "a codex launch in a detached worktree adds --skip-git-repo-check" codex \
    "$(lines "$tmp/cx-detached" exec -C "$tmp/cx-detached" --json -m lane-model -c "$CODEX_HIGH" "$CODEX_BYPASS" --skip-git-repo-check 'Keep going, then stop.')" \
    launch one "$tmp/cx-detached" "$tmp/brief.txt"
  envx=""
  runs_as "form shows the codex launch and resume" codex \
    "$(lines "launch: cd <cwd> && codex exec -C <cwd> --json -m lane-model -c model_reasoning_effort=\\\"high\\\" $CODEX_BYPASS \$(cat <prompt-file>) " \
             "resume: cd <cwd> && codex exec resume <thread-id> --json -m lane-model -c model_reasoning_effort=\\\"high\\\" $CODEX_BYPASS -- \$(cat <prompt-file>) ")" \
    form one
  runs_on "the fallback resumes on its own model, with no --leg" legs fallback-model resume coachman_fallback "$tmp/wt" T-1 "$tmp/prompt.txt"
  runs_on "form with no --leg shows team.coachman" legs coach-model form coachman
  carries "a lane's env file reaches the harness's environment" envfile "probe=reached" launch coachman "$tmp/wt" "$tmp/prompt.txt" --leg review
  runs_on "inside a run, a resume runs on the model the run recorded, not the live config's" edited review-model resume coachman "$tmp/wt" T-1 "$tmp/prompt.txt" --leg review --run "$tmp/repo/.postmaster/runs/run"
  runs_on "outside a run, the same resume runs on the live config's model" edited edited-model resume coachman "$tmp/wt" T-1 "$tmp/prompt.txt" --leg review
  run now resume one "$tmp/wt" T-1 "$tmp/prompt.txt" --run "$tmp/repo/.postmaster/runs/run-then"
  printed "inside a run, a lane resumes on the harness, model, effort and env file the run recorded" "--resume T-1 " "--model then-model " "--effort high " "probe=then"
  run now resume one "$tmp/wt" T-1 "$tmp/prompt.txt"
  printed "outside a run, the same resume takes all four from the live config" "--mode json " "--session T-1 " "--model now-model " "--thinking low " "probe=now"
  runs_on "inside a run the live config is not read: with none at all, a launch runs on the recorded model" nowhere synthesis-model launch coachman "$tmp/wt" "$tmp/prompt.txt" --leg synthesis --run "$tmp/repo/.postmaster/runs/run"
  out=$(calls "$tmp/runbook.md"); rc=$?; err=""
  got=$(printf '%s\n' "$out" | sed -E 's/^([a-z]+) .*launch\.sh (launch|resume) ([a-z]) .*/\1 \3/' | tr '\n' ,)
  [ "$got" = "unrun a,run b,unrun c,run d," ] && ok "a runbook launch or resume with no --run is found, fenced or inline" \
    || fail "a runbook launch or resume with no --run is found, fenced or inline"

  echo "negative controls"
  for k in style bug security; do
    refused "a config naming $k is refused, and the message names review" "old-$k" "one leg now, review" form coachman --leg review
  done
  refused "a key that is no leg is refused" typo "no such leg: revue" form coachman --leg review
  refused "a leg entry on a lane's model is refused" onlane "a lane's model" form coachman --leg synthesis
  refused "a leg entry that is not a table is refused" notable "is not a table" form coachman --leg synthesis
  envx="HARNESS=claude MODEL=env-model"
  refused "a config that does not parse is refused, and the environment's HARNESS and MODEL go unused" dup "cannot read" launch one "$tmp/wt" "$tmp/prompt.txt"
  envx=""
  refused "a parse error names the file and where it breaks" dup "launch: cannot read $tmp/dup.toml: " form coachman --leg review
  refused "a leg entry on a lane's model with a bracketed suffix is refused" suffix "a lane's model" form coachman --leg synthesis
  refused "team.coachman on a lane's model is refused" coachlane "a lane's model" form coachman --leg synthesis
  refused "the fallback on a lane's model is refused" fblane "a lane's model" form coachman_fallback
  refused "a leg entry with no harness or model is refused" emptyleg "needs a harness and a model" form coachman --leg synthesis
  refused "a coachman with no model is refused by name" bare "coachman has no model" form coachman --leg review
  runs_on "an env file cannot put the coachman on another model" envfile coach-model launch coachman "$tmp/wt" "$tmp/prompt.txt" --leg review
  envx="STDIN_FILE=$tmp/prompt.txt"
  lacks "a STDIN_FILE from the environment is not used" legs "< " form one
  refused "a leg entry on a lane's model with stacked suffixes is refused" suffixes "a lane's model" form coachman --leg synthesis
  cd "$tmp/elsewhere" || exit 1
  carries "a relative env file is read from the config's directory, never the worktree" relenv "probe=config-dir" launch coachman "$tmp/wt" "$tmp/prompt.txt" --leg review
  cd - >/dev/null || exit 1
  refused "an empty prompt file is refused, and nothing runs" legs "prompt file missing, unreadable or empty" launch one "$tmp/wt" "$tmp/empty.txt"
  if [ -r "$tmp/unreadable.txt" ]; then
    printf '  ok   %s\n' "an unreadable prompt file is refused (skipped: this user reads every file)"
  else
    refused "an unreadable prompt file is refused, and nothing runs" legs "prompt file missing, unreadable or empty" launch one "$tmp/wt" "$tmp/unreadable.txt"
  fi
  envx=""
  refused "a resume with no thread id is refused, and nothing runs" legs "launch: resume needs a thread id" resume one "$tmp/wt" "" "$tmp/prompt.txt"
  refused "an argument launch.sh does not know is refused" legs "launch needs <cwd> <prompt-file>" launch one "$tmp/wt" "$tmp/prompt.txt" --leg=review
  for k in style bug security; do
    refused "--leg $k is refused" legs "no such leg: --leg $k" form coachman --leg "$k"
  done
  refused "a codex lane with no model is refused, and nothing resumes on codex's default" codex-nomodel "has no model" resume one "$tmp/wt" T-1 "$tmp/prompt.txt"
  runs_as "a codex resume with no effort and no --last passes neither -c nor -o" codex-noeffort \
    "$(lines "$tmp/wt" exec resume T-1 --json -m lane-model "$CODEX_BYPASS" -- '- Keep going, then stop.')" \
    resume one "$tmp/wt" T-1 "$tmp/ruling.txt"
  refused "resuming the coachman with no --leg is refused, and nothing runs" legs "coachman needs --leg" resume coachman "$tmp/wt" T-1 "$tmp/prompt.txt"
  refused "launching the coachman with no --leg is refused, and nothing runs" legs "coachman needs --leg" launch coachman "$tmp/wt" "$tmp/prompt.txt"
  refused "inside a run with no run.json, a resume is refused though the live config would serve, and nothing runs" legs "no run.json in $tmp/repo/.postmaster/runs/no-record" resume coachman "$tmp/wt" T-1 "$tmp/prompt.txt" --leg review --run "$tmp/repo/.postmaster/runs/no-record"
  refused "inside a run whose run.json does not parse, a launch is refused, and nothing runs" legs "cannot read $tmp/repo/.postmaster/runs/garbled/run.json" launch one "$tmp/wt" "$tmp/prompt.txt" --run "$tmp/repo/.postmaster/runs/garbled"
  refused "a run.json that records no config is refused" legs "it records no config" launch one "$tmp/wt" "$tmp/prompt.txt" --run "$tmp/repo/.postmaster/runs/unrecorded"
  refused "an empty --run is refused, never read as outside a run" legs "--run needs a dispatch directory" resume coachman "$tmp/wt" T-1 "$tmp/prompt.txt" --leg review --run ""
  refused "a recorded config naming bug is refused, though the live config passes" legs "one leg now, review" resume coachman "$tmp/wt" T-1 "$tmp/prompt.txt" --leg review --run "$tmp/repo/.postmaster/runs/run-old-bug"
  refused "a recorded leg on a lane's model is refused, though the live config passes" legs "a lane's model" resume coachman "$tmp/wt" T-1 "$tmp/prompt.txt" --leg synthesis --run "$tmp/repo/.postmaster/runs/run-onlane"
  got=$(calls "$here/../skills/postmaster/coachman.md" "$here/../skills/postmaster/postmaster.md"); rc=$?
  out=$(printf '%s\n' "$got" | grep '^unrun '); err=""
  [ $rc -eq 0 ] && [ -z "$out" ] && grep -q '^run .*/coachman\.md: ' <<<"$got" \
    && grep -q '^run .*/postmaster\.md: ' <<<"$got" \
    && ok "no launch or resume in coachman.md or postmaster.md lacks --run <dispatch>" \
    || fail "no launch or resume in coachman.md or postmaster.md lacks --run <dispatch>"

  echo "muse"
  printf '[lanes.m]\nharness = "muse"\nmodel = "muse-model"\neffort = "max"\nenv_file = "%s"\n\n[lanes.n]\nharness = "muse"\nmodel = "muse-model"\n\n[team]\ncoachman = { harness = "muse", model = "coach-muse" }\ncoachman_fallback = { harness = "claude", model = "fallback-model" }\n' "$tmp/over.env" > "$tmp/muse.toml"
  printf '[lanes.m]\nharness = "muse"\nmodel = "muse-model"\n' > "$tmp/muse-bare.toml"
  mkdir -p "$tmp/wt/sub" && cp "$tmp/prompt.txt" "$tmp/wt/sub/p.txt"
  hd=$tmp/harness-data
  mrun() {  # mrun <fixture> <args...>: the harness data root in the test's own folder, stdin a pipe that carries a line
    local f=$1; shift
    out=$(printf 'leak\n' | env POSTMASTER_HARNESS_DATA="$hd" POSTMASTER_CONFIG="$tmp/$f.toml" PATH="$tmp/bin:$PATH" "$self" "$@" 2>"$tmp/err"); rc=$?
    err=$(cat "$tmp/err")
  }
  data_of() { printf '%s\n' "$out" | sed -n 's/.* data=//p'; }
  mrefused() {  # mrefused <label> <fixture> <text the message must carry> <args...>: refused under mrun
    local label=$1 f=$2 want=$3; shift 3; mrun "$f" "$@"
    [ $rc -eq 1 ] && [ -z "$out" ] && case $err in *"$want"*) true ;; *) false ;; esac && ok "$label" || fail "$label"
  }
  mrun muse launch m "$tmp/wt" "$tmp/prompt.txt"; a=$(data_of)
  [ $rc -eq 0 ] && [ "$out" = "exec --json --prompt-file $tmp/prompt.txt --model muse-model --reasoning-effort max --yolo probe=reached stdin= data=$a" ] \
    && case $a in "$hd"/muse/?*) true ;; *) false ;; esac && [ -d "$a" ] \
    && ok "a muse launch: JSON events, the prompt file, model, effort, bypass form and env file, nothing on stdin, and its own data directory" \
    || fail "a muse launch: JSON events, the prompt file, model, effort, bypass form and env file, nothing on stdin, and its own data directory"
  : > "$a/01a0-sess"   # the launch's thread, in its data directory
  mrun muse resume m "$tmp/wt" 01a0-sess "$tmp/prompt.txt"; b=$(data_of)
  [ $rc -eq 0 ] && case $out in "exec --json --prompt-file $tmp/prompt.txt --session-id 01a0-sess --model muse-model --reasoning-effort max --yolo "*) true ;; *) false ;; esac \
    && [ "$b" = "$a" ] && ok "a muse resume names the session, keeps the model and effort, and finds the launch's data directory" \
    || fail "a muse resume names the session, keeps the model and effort, and finds the launch's data directory"
  mrun muse launch n "$tmp/wt" "$tmp/prompt.txt"; c=$(data_of)
  mrun muse launch coachman "$tmp/wt" "$tmp/prompt.txt" --leg synthesis; d=$(data_of)
  mrun muse launch coachman "$tmp/wt" "$tmp/prompt.txt" --leg review; e=$(data_of)
  mrun muse launch m "$tmp/elsewhere" "$tmp/prompt.txt"; f=$(data_of)
  [ -n "$c" ] && [ -n "$d" ] && [ -n "$e" ] && [ -n "$f" ] && [ "$(printf '%s\n' "$a" "$c" "$d" "$e" "$f" | sort -u | wc -l | tr -d ' ')" -eq 5 ] \
    && ok "another lane, each coachman leg, and the same lane elsewhere each get a data directory of their own" \
    || fail "another lane, each coachman leg, and the same lane elsewhere each get a data directory of their own"
  out=$(cd "$tmp/wt" && env POSTMASTER_HARNESS_DATA="$hd" POSTMASTER_CONFIG="$tmp/muse-bare.toml" PATH="$tmp/bin:$PATH" "$self" launch m "$tmp/elsewhere" sub/p.txt 2>"$tmp/err" </dev/null); rc=$?; err=$(cat "$tmp/err")
  [ $rc -eq 0 ] && case $out in "exec --json --prompt-file $tmp/wt/sub/p.txt --model muse-model --yolo "*) true ;; *) false ;; esac \
    && ok "a relative prompt file is made absolute before the cd, and no effort means no effort flag" \
    || fail "a relative prompt file is made absolute before the cd, and no effort means no effort flag"
  carries "the muse form shows its data directory, the bypass form and an empty stdin" muse \
    "env XDG_DATA_HOME=<harness-data>/muse/<key> muse exec --json --prompt-file <prompt-file> --model muse-model --reasoning-effort max --yolo < /dev/null" form m
  mrefused "a muse resume of a thread its data directory does not hold is refused, and nothing runs" muse \
    "no muse thread 01a0-none in this launch's data directory" resume m "$tmp/wt" 01a0-none "$tmp/prompt.txt"
  mrefused "a muse resume from another directory is refused: the thread is in its launch's data directory" muse \
    "no muse thread 01a0-sess in this launch's data directory" resume m "$tmp/elsewhere" 01a0-sess "$tmp/prompt.txt"
  : > "$d/01a0-coach"   # the synthesis leg's thread
  mrun muse resume coachman "$tmp/wt" 01a0-coach "$tmp/prompt.txt" --leg synthesis
  [ $rc -eq 0 ] && [ "$(data_of)" = "$d" ] && ok "a muse coachman resumes its thread on the leg it was launched on" \
    || fail "a muse coachman resumes its thread on the leg it was launched on"
  mrefused "a muse coachman resumed on another leg is refused, and nothing runs" muse \
    "no muse thread 01a0-coach in this launch's data directory" resume coachman "$tmp/wt" 01a0-coach "$tmp/prompt.txt" --leg review

  echo "mimo"
  printf '[lanes.x]\nharness = "mimo"\nmodel = "prov/mimo-model"\neffort = "high"\nenv_file = "%s"\n\n[lanes.y]\nharness = "mimo"\nmodel = "prov/mimo-model"\n' "$tmp/over.env" > "$tmp/mimo.toml"
  printf '[lanes.x]\nharness = "mimo"\nmodel = "prov/mimo-model"\n' > "$tmp/mimo-bare.toml"
  mrun mimo launch x "$tmp/wt" "$tmp/prompt.txt"; a=$(data_of)
  [ $rc -eq 0 ] && [ "$out" = "run --format json -m prov/mimo-model --variant high --dangerously-skip-permissions probe=reached stdin=Continue. import-off=1 data=$a" ] \
    && case $a in "$hd"/mimo/?*) true ;; *) false ;; esac && [ -d "$a" ] \
    && ok "a mimo launch: JSON events, model, variant, bypass form, env file, the prompt on stdin, its own data directory, and no history import" \
    || fail "a mimo launch: JSON events, model, variant, bypass form, env file, the prompt on stdin, its own data directory, and no history import"
  : > "$a/ses_01a0"   # the launch's thread, in its data directory
  mrun mimo resume x "$tmp/wt" ses_01a0 "$tmp/prompt.txt"; b=$(data_of)
  [ $rc -eq 0 ] && case $out in "run --format json -m prov/mimo-model -s ses_01a0 --variant high --dangerously-skip-permissions probe=reached stdin=Continue. "*) true ;; *) false ;; esac \
    && [ "$b" = "$a" ] && ok "a mimo resume names the session, keeps the model and the variant, and finds the launch's data directory" \
    || fail "a mimo resume names the session, keeps the model and the variant, and finds the launch's data directory"
  mrun mimo launch y "$tmp/wt" "$tmp/prompt.txt"; c=$(data_of)
  [ -n "$c" ] && [ "$c" != "$a" ] && ok "another mimo lane in the same directory gets a data directory of its own" \
    || fail "another mimo lane in the same directory gets a data directory of its own"
  out=$(cd "$tmp/wt" && env POSTMASTER_HARNESS_DATA="$hd" POSTMASTER_LAUNCH_NAME="#7, a run" POSTMASTER_CONFIG="$tmp/mimo-bare.toml" PATH="$tmp/bin:$PATH" "$self" launch x "$tmp/elsewhere" sub/p.txt 2>"$tmp/err" </dev/null); rc=$?; err=$(cat "$tmp/err")
  [ $rc -eq 0 ] && case $out in "run --format json -m prov/mimo-model --title #7, a run --dangerously-skip-permissions probe= stdin=Continue. "*) true ;; *) false ;; esac \
    && ok "a relative prompt file is read after the cd, no effort means no variant, and a launch is titled after its run" \
    || fail "a relative prompt file is read after the cd, no effort means no variant, and a launch is titled after its run"
  carries "the mimo form shows its data directory, the import switch and the prompt file on stdin" mimo \
    "env XDG_DATA_HOME=<harness-data>/mimo/<key> MIMOCODE_DISABLE_CLAUDE_IMPORT=1 mimo run --format json -m prov/mimo-model --variant high --dangerously-skip-permissions < <prompt-file>" form x
  run mimo skill x security-review
  [ $rc -eq 3 ] && [ -z "$out" ] && ok "a mimo lane has no security review skill: exit 3" || fail "a mimo lane has no security review skill: exit 3"
  mrefused "a mimo resume of a thread its data directory does not hold is refused, and nothing runs" mimo \
    "no mimo thread ses_none in this launch's data directory" resume x "$tmp/wt" ses_none "$tmp/prompt.txt"
  mrefused "a mimo resume from another directory is refused: the thread is in its launch's data directory" mimo \
    "no mimo thread ses_01a0 in this launch's data directory" resume x "$tmp/elsewhere" ses_01a0 "$tmp/prompt.txt"

  echo "the coachman on muse, a workhorse on mimo: both forms, each with its bypass flag"
  printf '[lanes.w]\nharness = "mimo"\nmodel = "prov/mimo-model"\neffort = "low"\n\n[lanes.v]\nharness = "claude"\nmodel = "lane-model"\n\n[team]\nworkhorses = ["w", "v"]\ncoachman = { harness = "muse", model = "coach-muse", effort = "max" }\n' > "$tmp/team.toml"
  # Copies of this script with each bypass flag gone, and with it gone from resumes only.
  sed -e 's/cmd+=(--yolo)/cmd+=()/' -e 's/cmd+=(--dangerously-skip-permissions)$/cmd+=()/' "$self" > "$tmp/nobypass.sh"
  sed -e 's/cmd+=(--yolo)/[ "$CMD" = resume ] || cmd+=(--yolo)/' \
    -e 's/cmd+=(--dangerously-skip-permissions)$/[ "$CMD" = resume ] || cmd+=(--dangerously-skip-permissions)/' "$self" > "$tmp/launchonly.sh"
  chmod +x "$tmp/nobypass.sh" "$tmp/launchonly.sh"
  bypassed() {  # bypassed <script> <flag> <form args...>: exit 0, and a launch line and a resume line each carry <flag>
    local script=$1 flag=$2 l n=0; shift 2
    out=$(POSTMASTER_CONFIG="$tmp/team.toml" PATH="$tmp/bin:$PATH" "$script" form "$@" 2>&1); rc=$?
    while IFS= read -r l; do
      case $l in launch:*|resume:*) case "$l " in *" $flag "*) n=$((n+1)) ;; esac ;; esac
    done <<< "$out"
    [ $rc -eq 0 ] && [ $n -eq 2 ]
  }
  for f in "coachman --yolo --leg review" "w --dangerously-skip-permissions"; do
    set -- $f; name=$1 flag=$2; shift 2
    bypassed "$self" "$flag" "$name" "$@" && ok "$name: the launch and resume forms both carry $flag" \
      || fail "$name: the launch and resume forms both carry $flag"
    printf '%s\n' "$out" | sed 's/^/         /'
    bypassed "$tmp/nobypass.sh" "$flag" "$name" "$@" && fail "$name: a form without $flag fails this check" \
      || ok "$name: a form without $flag fails this check"
    bypassed "$tmp/launchonly.sh" "$flag" "$name" "$@" && fail "$name: a resume form without $flag fails this check" \
      || ok "$name: a resume form without $flag fails this check"
  done
  run legs form one
  printed "a claude lane's form shows a resume form too" "launch: cd <cwd> && claude -p " "resume: cd <cwd> && claude -p --resume <thread-id> "
  printf '[lanes.g]\nharness = "agy"\nmodel = "agy-model"\n' > "$tmp/agy.toml"; printf '#!/bin/sh\n' > "$tmp/bin/agy"; chmod +x "$tmp/bin/agy"
  run agy form g
  printed "an agy lane's form says it has no resume form, and still exits 0" "launch: cd <cwd> && agy -p " "resume: none: agy resume form is not recorded"

  echo "skills"
  printf '[lanes.one]\nharness = "claude"\nmodel = "lane-model"\n\n[lanes.two]\nharness = "codex"\nmodel = "other-model"\n\n[lanes.three]\nharness = "muse"\nmodel = "muse-model"\n' > "$tmp/skills.toml"
  run skills skill one security-review
  [ $rc -eq 0 ] && [ "$out" = /security-review ] && ok "a claude lane's security review skill is /security-review" || fail "a claude lane's security review skill is /security-review"
  run skills skill two security-review
  [ $rc -eq 3 ] && [ -z "$out" ] && case $err in *"no security review skill"*) true ;; *) false ;; esac \
    && ok "a harness with no security review skill is exit 3, never a prompt" || fail "a harness with no security review skill is exit 3, never a prompt"
  refused "a skill that is not recorded is refused" skills "no such skill: code-review" skill one code-review
  run skills skill three security-review
  [ $rc -eq 3 ] && [ -z "$out" ] && ok "a muse lane has no security review skill: exit 3" || fail "a muse lane has no security review skill: exit 3"

  echo "thread-id: the id a stream records, from its shape"
  tid() {  # tid <label> <want> <events-text>
    printf '%s\n' "$3" > "$tmp/events.jsonl"
    out=$("$self" thread-id "$tmp/events.jsonl" 2>"$tmp/err"); rc=$?
    [ $rc -eq 0 ] && [ "$out" = "$2" ] && ok "$1" || fail "$1 (got '$out', exit $rc)"
  }
  tid "codex: thread_id on thread.started" "0199a213-81c0" \
    '{"type":"thread.started","thread_id":"0199a213-81c0"}'
  tid "claude: session_id on system/init" "a99db1c7-9178" \
    '{"type":"system","subtype":"init","session_id":"a99db1c7-9178","model":"claude-haiku-4-5"}'
  tid "grok: id on a session record" "fixture-grok" \
    '{"type":"session","id":"fixture-grok"}'
  tid "agy: conversationId" "fixture-agy" \
    '{"conversationId":"fixture-agy"}'
  tid "pi: id on session" "sess-pi-1" \
    '{"type":"session","id":"sess-pi-1"}'
  tid "muse: stream.id on the first record" "mu-2222" \
    '{"payload_type":"session","stream":{"kind":"session","id":"mu-2222"},"sequence":1}'
  tid "mimo: sessionID on any event" "mi-3333" \
    '{"type":"step_start","sessionID":"mi-3333","part":{"type":"step_start"}}'
  tid "the first id in the stream wins" "first-1" \
    '{"type":"thread.started","thread_id":"first-1"}
{"type":"thread.started","thread_id":"second-2"}'
  printf '%s\n' '{"type":"result","subtype":"success"}' > "$tmp/events.jsonl"
  out=$("$self" thread-id "$tmp/events.jsonl" 2>"$tmp/err"); rc=$?
  [ $rc -eq 1 ] && [ -z "$out" ] && ok "a stream with no id is exit 1" || fail "a stream with no id is exit 1 (exit $rc)"
  printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool-9","name":"Bash"}]}}' > "$tmp/events.jsonl"
  out=$("$self" thread-id "$tmp/events.jsonl" 2>"$tmp/err"); rc=$?
  [ $rc -eq 1 ] && [ -z "$out" ] && ok "a tool payload id is not the thread" || fail "a tool payload id is not the thread (exit $rc)"
  out=$("$self" thread-id "$tmp/no-such-events" 2>"$tmp/err"); rc=$?
  [ $rc -eq 1 ] && case $(cat "$tmp/err") in *"no such events file"*) true ;; *) false ;; esac \
    && ok "a missing events file is refused" || fail "a missing events file is refused (exit $rc)"

  echo "transient: a provider error worth resuming on"
  is_transient() {  # is_transient <label> <want-exit> <err-text> [<stream-text>]
    local label=$1 want=$2 errtxt=$3 streamtxt=${4:-}
    printf '%s\n' "$errtxt" > "$tmp/leg.err"
    if [ -n "$streamtxt" ]; then
      printf '%s\n' "$streamtxt" > "$tmp/leg-events.jsonl"
      out=$("$self" transient "$tmp/leg.err" "$tmp/leg-events.jsonl" 2>"$tmp/err"); rc=$?
    else
      out=$("$self" transient "$tmp/leg.err" 2>"$tmp/err"); rc=$?
    fi
    [ $rc -eq "$want" ] && ok "$label" || fail "$label (exit $rc, wanted $want)"
  }
  is_transient "a model stream idle timeout is transient" 0 "API Error: model stream idle timeout"
  is_transient "a stream idle timeout alone is transient" 0 "stream idle timeout after 300s"
  is_transient "a bad gateway is transient" 0 "502 Bad Gateway"
  is_transient "an overloaded response is transient" 0 "529 overloaded"
  is_transient "a service outage is transient" 0 "503 Service Unavailable"
  is_transient "a stream disconnect is transient" 0 "stream disconnected"
  is_transient "a connection reset is transient" 0 "read: connection reset by peer"
  is_transient "a broken pipe is transient" 0 "write: broken pipe"
  is_transient "a transient error in the stream tail counts" 0 "the leg ended" '{"type":"error","message":"model stream idle timeout"}'
  is_transient "a harness failure subtype in the stream tail is inspected" 0 "the leg ended" '{"type":"result","subtype":"error_during_execution","message":"model stream idle timeout"}'
  is_transient "timeout text in a user prompt is not a provider error" 1 "the leg ended" '{"type":"error","message":"provider request failed","prompt":{"text":"model stream idle timeout"}}'
  is_transient "a launch refusal is never transient" 1 "launch: resume needs a thread id"
  is_transient "a quota wall takes precedence over a transient signature" 1 "quota exceeded: model stream idle timeout"
  is_transient "a quota wall is not transient" 1 "402 Payment Required: out of credit"
  is_transient "a usage limit is not transient" 1 "usage limit reached for this month"
  is_transient "a rate limit is not transient" 1 "rate limit exceeded, retry later"
  is_transient "a provider wall is not transient" 1 "provider wall: model capacity exhausted"
  is_transient "a generic timeout is not transient" 1 "request timeout"
  is_transient "an ordinary model error is not transient" 1 "Error: something went wrong"
  is_transient "an empty record is not transient" 1 ""
  is_transient "a bare quota mention wakes" 1 "checking quota status before proceeding"
  is_transient "a quota remainder wakes" 1 "quota remaining: 0 of 100"
  is_transient "quota exhausted is a provider wall" 1 "quota exhausted for this key"
  stale_stream='{"type":"error","message":"model stream idle timeout"}
{"type":"assistant","message":"continued"}'
  printf '%s\n' 'AssertionError: something the lane did wrong' > "$tmp/leg.err"
  printf '%s\n' "$stale_stream" > "$tmp/leg-events.jsonl"
  out=$("$self" transient "$tmp/leg.err" "$tmp/leg-events.jsonl" 1 2>"$tmp/err"); rc=$?
  [ $rc -eq 1 ] && [ "$out" = not-transient ] \
    && ok "an old transient error before the skip does not classify the current end" \
    || fail "an old transient error before the skip does not classify the current end (exit $rc, $out)"
  out=$("$self" transient "$tmp/leg.err" "$tmp/leg-events.jsonl" 0 2>"$tmp/err"); rc=$?
  [ $rc -eq 0 ] \
    && ok "a zero skip keeps the whole stream, proving the control above is not vacuous" \
    || fail "a zero skip keeps the whole stream, proving the control above is not vacuous (exit $rc)"
  printf '%s\n' 'the leg ended' > "$tmp/leg.err"
  printf '%s\n' "$stale_stream" '{"type":"error","message":"502 Bad Gateway"}' > "$tmp/leg-events.jsonl"
  out=$("$self" transient "$tmp/leg.err" "$tmp/leg-events.jsonl" 2 2>"$tmp/err"); rc=$?
  [ $rc -eq 0 ] && [ "$out" = "gateway failure" ] \
    && ok "a transient error after the skip still counts" \
    || fail "a transient error after the skip still counts (exit $rc, $out)"
  out=$("$self" transient "$tmp/leg.err" "$tmp/leg-events.jsonl" 99 2>"$tmp/err"); rc=$?
  [ $rc -eq 1 ] && [ "$out" = not-transient ] \
    && ok "a skip past the end reads the .err alone" \
    || fail "a skip past the end reads the .err alone (exit $rc, $out)"
  out=$("$self" transient "$tmp/leg.err" "$tmp/leg-events.jsonl" soon 2>"$tmp/err"); rc=$?
  [ $rc -eq 1 ] && case $(cat "$tmp/err") in *"whole number"*) true ;; *) false ;; esac \
    && ok "a skip that is not a number is refused" || fail "a skip that is not a number is refused (exit $rc)"
  is_transient "an underscore quota wall takes precedence" 1 "quota_exhausted: model stream idle timeout"
  is_transient "a bare provider-wall mention without a stem is not a veto" 0 "provider_wall: stream disconnected"
  is_transient "an underscore resource wall takes precedence" 1 "resource_exhausted: bad gateway"
  is_transient "a hyphen quota wall takes precedence" 1 "quota-exceeded: model stream idle timeout"
  printf 'host: launch running uncapped (no supported per-launch limits available)\nlaunch: no such lane\n' > "$tmp/leg.err"
  out=$("$self" transient "$tmp/leg.err" 2>"$tmp/err"); rc=$?
  [ $rc -eq 1 ] && [ "$out" = launch-refusal ] \
    && ok "a refusal past a host notice is still a refusal" \
    || fail "a refusal past a host notice is still a refusal (exit $rc, $out)"
  printf 'host: memory cap reached (MemoryMax=64M)\nlaunch: resume needs a thread id\n' > "$tmp/leg.err"
  out=$("$self" transient "$tmp/leg.err" 2>"$tmp/err"); rc=$?
  [ $rc -eq 1 ] && [ "$out" = launch-refusal ] \
    && ok "a refusal past a cap notice is still a refusal" \
    || fail "a refusal past a cap notice is still a refusal (exit $rc, $out)"
  printf 'host: launch running uncapped\nlaunch: stream idle timeout on resume\n' > "$tmp/leg.err"
  out=$("$self" transient "$tmp/leg.err" 2>"$tmp/err"); rc=$?
  [ $rc -eq 1 ] && [ "$out" = launch-refusal ] \
    && ok "a refusal wins over transient text on its own line" \
    || fail "a refusal wins over transient text on its own line (exit $rc, $out)"
  echo "vetoes: any wall token anywhere in an ending wakes, beside every transient"
  check_cell() {  # check_cell <label> <want-exit> <want-out> <err-text>
    printf '%s\n' "$4" > "$tmp/cell.err"
    out=$("$self" transient "$tmp/cell.err" 2>"$tmp/err"); rc=$?
    [ $rc -eq "$2" ] && [ "$out" = "$3" ] \
      || { fail "veto cover [$1]: got exit $rc $out"; matrix_fail=1; }
  }
  check_pair() {  # check_pair <label> <want-exit> <want-out> <err-text> <stream-text>
    printf '%s\n' "$4" > "$tmp/cell.err"
    printf '%s\n' "$5" > "$tmp/cell-events.jsonl"
    out=$("$self" transient "$tmp/cell.err" "$tmp/cell-events.jsonl" 2>"$tmp/err"); rc=$?
    [ $rc -eq "$2" ] && [ "$out" = "$3" ] \
      || { fail "veto cover [$1]: got exit $rc $out"; matrix_fail=1; }
  }
  "$self" wall-tokens > "$tmp/tokens.txt"; rc=$?
  [ $rc -eq 0 ] && [ -s "$tmp/tokens.txt" ] \
    && ok "wall-tokens lists the adapter's wall token stems" \
    || fail "wall-tokens lists the adapter's wall token stems (exit $rc)"
  printf '%s\n' \
    "model stream idle timeout" \
    "stream idle timeout" \
    "502 Bad Gateway" \
    "503 Service Unavailable" \
    "529 overloaded" \
    "stream disconnected" \
    "SSE error" \
    "connection reset by peer" \
    "connection aborted" \
    "broken pipe" > "$tmp/transients.txt"
  transient_verdict() {  # transient_verdict <exemplar>: the verdict a lone exemplar prints
    case $1 in
      *idle*timeout*) printf 'model stream idle timeout' ;;
      502*|503*|529*) printf 'gateway failure' ;;
      *) printf 'stream drop' ;;
    esac
  }
  matrix_fail=0; cells=0
  while IFS= read -r sig; do
    [ -n "$sig" ] || continue
    check_cell "lone [$sig] resumes" 0 "$(transient_verdict "$sig")" "$sig"
    while IFS= read -r tok; do
      [ -n "$tok" ] || continue
      cells=$((cells + 1))
      check_cell "[$tok] vetoes [$sig]" 1 provider-wall "$sig [$tok]"
    done < "$tmp/tokens.txt"
  done < "$tmp/transients.txt"
  [ "$cells" -gt 0 ] && [ "$matrix_fail" -eq 0 ] \
    && ok "every token vetoes every transient ($cells cells)" \
    || fail "token veto matrix misclassifies or is empty"
  matrix_fail=0
  for tok in quota limit exhaust exceed throttl bill budget credit payment usage slow quick toomany 429 402; do
    check_cell "lone stem [$tok] vetoes" 1 provider-wall "witness $tok here"
  done
  [ "$matrix_fail" -eq 0 ] \
    && ok "every pinned stem vetoes alone" \
    || fail "a pinned stem does not veto alone"
  [ "$(tr '\n' ' ' < "$tmp/tokens.txt")" = "quota limit exhaust exceed throttl bill budget credit payment usage slow quick toomany 429 402 " ] \
    && ok "wall-tokens lists exactly the pinned stems" \
    || fail "wall-tokens lists exactly the pinned stems"
  printf '%s\n' '{"type":"error","message":"quota exceeded for this key"}' > "$tmp/long-events.jsonl"
  i=2; while [ "$i" -lt 101 ]; do
    printf '%s\n' '{"type":"step","status":"flying"}' >> "$tmp/long-events.jsonl"; i=$((i + 1))
  done
  printf '%s\n' '{"type":"error","message":"model stream idle timeout"}' >> "$tmp/long-events.jsonl"
  printf '%s\n' "the leg ended" > "$tmp/long.err"
  out=$("$self" transient "$tmp/long.err" "$tmp/long-events.jsonl" 2>"$tmp/err"); rc=$?
  [ $rc -eq 1 ] && [ "$out" = provider-wall ] \
    && ok "a wall 100 lines back still vetoes" \
    || fail "a wall 100 lines back still vetoes (exit $rc, $out)"
  check_cell "try-again-later beside transient resumes" 0 "model stream idle timeout" \
    "try again later: model stream idle timeout"
  check_cell "server-busy beside transient resumes" 0 "model stream idle timeout" \
    "the server is busy, please retry: model stream idle timeout"
  echo "realistic streams: usage-bearing harness streams resume on a transient end"
  # Built from this run's own logs: a codex turn.completed usage record and a
  # claude task_progress usage record (whose uuid also holds 429), each ending
  # in a known transient. Both must resume; both vetoed before the values veto.
  # They join the corpus as the durable realistic fixtures: the P1 shipped
  # because every earlier fixture was thread.started plus .err only.
  codex_usage='{"type": "turn.completed", "usage": {"input_tokens": 3072288, "cached_input_tokens": 2910208, "cache_write_input_tokens": 0, "output_tokens": 50050, "reasoning_output_tokens": 44266}}'
  claude_usage='{"type":"system","subtype":"task_progress","task_id":"ac8fe1ebf375eff4d","tool_use_id":"toolu_013hqT2oMy1VXLYEaky3ttuc","description":"Reading scripts/runs-watch.sh","subagent_type":"general-purpose","usage":{"total_tokens":30007,"tool_uses":1,"duration_ms":4119},"last_tool_name":"Read","uuid":"c4295b17-b348-4933-8a1e-7dfe07cfb78e","session_id":"7449d3c5-8a18-45ba-aa72-1f0ae0ea8a30"}'
  realistic_tail='{"type":"error","message":"model stream idle timeout"}'
  realistic_wall='{"type":"error","message":"quota exceeded for this key"}'
  printf '%s\n' "the leg ended" > "$tmp/real.err"
  printf '%s\n' "$codex_usage" "$realistic_tail" > "$tmp/real-events.jsonl"
  out=$("$self" transient "$tmp/real.err" "$tmp/real-events.jsonl" 2>"$tmp/err"); rc=$?
  [ $rc -eq 0 ] && [ "$out" = "model stream idle timeout" ] \
    && ok "a codex stream with usage records resumes on a transient end" \
    || fail "a codex stream with usage records resumes on a transient end (exit $rc, $out)"
  printf '%s\n' "$codex_usage" "$realistic_tail" "$realistic_wall" > "$tmp/real-events.jsonl"
  out=$("$self" transient "$tmp/real.err" "$tmp/real-events.jsonl" 2>"$tmp/err"); rc=$?
  [ $rc -eq 1 ] && [ "$out" = provider-wall ] \
    && ok "the same codex stream with a wall message wakes" \
    || fail "the same codex stream with a wall message wakes (exit $rc, $out)"
  printf '%s\n' "$claude_usage" "$realistic_tail" > "$tmp/real-events.jsonl"
  out=$("$self" transient "$tmp/real.err" "$tmp/real-events.jsonl" 2>"$tmp/err"); rc=$?
  [ $rc -eq 0 ] && [ "$out" = "model stream idle timeout" ] \
    && ok "a claude stream with usage records resumes on a transient end" \
    || fail "a claude stream with usage records resumes on a transient end (exit $rc, $out)"
  printf '%s\n' "$claude_usage" "$realistic_tail" "$realistic_wall" > "$tmp/real-events.jsonl"
  out=$("$self" transient "$tmp/real.err" "$tmp/real-events.jsonl" 2>"$tmp/err"); rc=$?
  [ $rc -eq 1 ] && [ "$out" = provider-wall ] \
    && ok "the same claude stream with a wall message wakes" \
    || fail "the same claude stream with a wall message wakes (exit $rc, $out)"
  echo "error records: every value counts inside one, nothing outside one vetoes"
  matrix_fail=0
  check_pair "wall under msg in an error record wakes" 1 provider-wall \
    "model stream idle timeout" '{"type":"error","msg":"quota exceeded"}'
  check_pair "wall under chunk in an error record wakes" 1 provider-wall \
    "model stream idle timeout" '{"type":"error","chunk":"command failed: quota exceeded"}'
  check_pair "wall under output in an error record wakes" 1 provider-wall \
    "model stream idle timeout" '{"type":"error","output":"402 Payment Required"}'
  check_pair "wall under body in an error record wakes" 1 provider-wall \
    "model stream idle timeout" '{"type":"error","body":"budget exhausted"}'
  check_pair "wall under error_message in an error record wakes" 1 provider-wall \
    "model stream idle timeout" '{"type":"error","error_message":"usage limit reached"}'
  check_pair "a bare prompt string in an error record wakes" 1 provider-wall \
    "model stream idle timeout" '{"type":"error","message":"model stream idle timeout","prompt":"check quota"}'
  check_pair "wall words in an ordinary assistant message resume" 0 "model stream idle timeout" \
    "model stream idle timeout" '{"type":"assistant","message":"quota exceeded for this key"}'
  check_pair "wall words in tool output resume" 0 "model stream idle timeout" \
    "model stream idle timeout" '{"type":"assistant","message":{"content":[{"type":"tool_result","text":"quota exceeded"}]}}'
  check_cell "the uncapped notice plus a transient resumes" 0 "model stream idle timeout" \
    $'host: launch running uncapped (no supported per-launch limits available)\nmodel stream idle timeout'
  check_cell "the uncapped notice plus a wall wakes" 1 provider-wall \
    $'host: launch running uncapped (no supported per-launch limits available)\nquota exceeded for this key'
  check_pair "wall in a claude result.is_error wakes" 1 provider-wall \
    "model stream idle timeout" '{"type":"result","is_error":true,"result":"quota exceeded"}'
  check_pair "wall in a codex nested error item wakes" 1 provider-wall \
    "model stream idle timeout" '{"type":"item.completed","item":{"type":"error","message":"quota exceeded"}}'
  check_pair "wall in a muse outcome:error payload wakes" 1 provider-wall \
    "model stream idle timeout" '{"payload_type":"tool.result","payload":{"outcome":"error","result":"quota exceeded"}}'
  check_pair "wall in a marked mimo part wakes" 1 provider-wall \
    "model stream idle timeout" '{"type":"error","id":"prt_x","messageID":"msg_x","sessionID":"ses_x","text":"quota exceeded"}'
  check_pair "wall words in an unmarked mimo text part resume" 0 "model stream idle timeout" \
    "model stream idle timeout" '{"type":"text","id":"prt_x","messageID":"msg_x","sessionID":"ses_x","text":"quota exceeded"}'
  check_pair "wall words in a claude tool_result error resume" 0 "model stream idle timeout" \
    "model stream idle timeout" '{"type":"user","message":{"content":[{"type":"tool_result","is_error":true,"content":"quota exceeded"}]}}'
  check_pair "wall words in a pi tool error resume" 0 "model stream idle timeout" \
    "model stream idle timeout" '{"type":"tool_execution_end","isError":true,"errorMessage":"quota exceeded"}'
  [ "$matrix_fail" -eq 0 ] \
    && ok "the veto reads error records whole and nothing else" \
    || fail "the veto misreads error records"
  echo "marked at any depth: error keys nest, tool results stay excluded"
  matrix_fail=0
  check_pair "wall in result.error wakes" 1 provider-wall \
    "model stream idle timeout" '{"result":{"error":"usage limits reached"}}'
  check_pair "wall in payload.error wakes" 1 provider-wall \
    "model stream idle timeout" '{"payload":{"error":{"message":"quota exceeded"}}}'
  check_pair "wall in a twice-nested outcome:error wakes" 1 provider-wall \
    "model stream idle timeout" '{"payload":{"inner":{"outcome":"error","detail":"quota exceeded"}}}'
  check_pair "wall in a twice-nested item type:error wakes" 1 provider-wall \
    "model stream idle timeout" '{"item":{"nested":{"type":"error","message":"quota exceeded"}}}'
  check_pair "wall under error_message in a nested item wakes" 1 provider-wall \
    "model stream idle timeout" '{"type":"item.completed","item":{"type":"other","error_message":"quota exceeded"}}'
  check_pair "wall under an error key at depth five wakes" 1 provider-wall \
    "model stream idle timeout" '{"a":{"b":{"c":{"d":{"error":"quota exceeded"}}}}}'
  check_pair "wall in result.error nested in a claude tool_result resumes" 0 "model stream idle timeout" \
    "model stream idle timeout" '{"type":"tool_result","result":{"error":"usage limits reached"}}'
  check_pair "wall in payload error nested in a pi tool subtree resumes" 0 "model stream idle timeout" \
    "model stream idle timeout" '{"type":"tool_execution_end","payload":{"error":{"message":"quota exceeded"}}}'
  check_pair "wall in a tool_result nested in message content resumes" 0 "model stream idle timeout" \
    "model stream idle timeout" '{"type":"user","message":{"content":[{"type":"tool_result","result":{"error":"quota exceeded"}}]}}'
  check_pair "null error at depth resumes" 0 "model stream idle timeout" \
    "model stream idle timeout" '{"result":{"error":null},"note":"all good"}'
  check_pair "false error at depth resumes" 0 "model stream idle timeout" \
    "model stream idle timeout" '{"result":{"error":false},"note":"all good"}'
  check_pair "empty error object at depth resumes" 0 "model stream idle timeout" \
    "model stream idle timeout" '{"result":{"error":{}},"note":"all good"}'
  [ "$matrix_fail" -eq 0 ] \
    && ok "error keys mark at any depth and tool results stay excluded" \
    || fail "depth marking misreads error keys or tool results"
  matrix_fail=0
  check_cell "1429 beside transient resumes" 0 "model stream idle timeout" \
    "input_tokens 1429: model stream idle timeout"
  check_cell "4020 beside transient resumes" 0 "model stream idle timeout" \
    "took 4020ms: model stream idle timeout"
  check_cell "429ms beside transient resumes" 0 "model stream idle timeout" \
    "took 429ms: model stream idle timeout"
  check_cell "a UUID holding 429 beside transient resumes" 0 "model stream idle timeout" \
    "id c4295b17-b348-4933: model stream idle timeout"
  check_pair "a 1429 token count in the stream resumes" 0 "model stream idle timeout" \
    "model stream idle timeout" '{"type":"progress","input_tokens":1429}'
  [ "$matrix_fail" -eq 0 ] \
    && ok "bare digits never veto" \
    || fail "bare digits vetoed"
  printf '%s\n' '{"type":"error","status":418}' > "$tmp/far-events.jsonl"
  i=2; while [ "$i" -lt 101 ]; do
    printf '%s\n' '{"type":"step","status":"flying"}' >> "$tmp/far-events.jsonl"; i=$((i + 1))
  done
  printf '%s\n' '{"type":"error","message":"stream disconnected"}' >> "$tmp/far-events.jsonl"
  out=$("$self" transient "$tmp/real.err" "$tmp/far-events.jsonl" 2>"$tmp/err"); rc=$?
  [ $rc -eq 1 ] && [ "$out" = not-transient ] \
    && ok "an unknown status 100 lines back still wakes" \
    || fail "an unknown status 100 lines back still wakes (exit $rc, $out)"
  echo "structured values: known transients resume, anything else wakes"
  is_transient "a 429 status code is a wall" 1 "the leg ended" '{"type":"error","status":429}'
  is_transient "a 402 status code is a wall" 1 "the leg ended" '{"type":"error","code":402}'
  is_transient "a string 429 code is a wall" 1 "the leg ended" '{"type":"error","status_code":"429"}'
  is_transient "an insufficient_quota error code is a wall" 1 "the leg ended" '{"type":"error","error":{"code":"insufficient_quota"}}'
  is_transient "a RateLimitError type is a wall" 1 "the leg ended" '{"type":"error","name":"RateLimitError"}'
  is_transient "a 503 status code is transient" 0 "the leg ended" '{"type":"error","status":503}'
  is_transient "an ECONNRESET code is transient" 0 "the leg ended" '{"type":"error","code":"ECONNRESET"}'
  is_transient "an overloaded_error type is transient" 0 "the leg ended" '{"type":"error","error":{"type":"overloaded_error"}}'
  is_transient "a structured wall beats prose transient" 1 "model stream idle timeout" '{"type":"error","code":429}'
  is_transient "a prose wall beats a structured transient" 1 "quota exceeded, slow down" '{"type":"error","status":503}'
  is_transient "a completed status is not a signal" 1 "the leg ended" '{"type":"error","status":"completed"}'
  is_transient "an exit code is not a status code" 1 "the leg ended" '{"type":"error","code":1}'
  is_transient "an exit code does not veto a transient end" 0 "model stream idle timeout" '{"type":"error","code":1}'
  is_transient "a timeout type is not a transient type" 1 "the leg ended" '{"type":"error","code":"ETIMEDOUT"}'
  matrix_fail=0
  check_pair "a rate_limit_event slowdown does not veto a transient end" 0 "model stream idle timeout" \
    "model stream idle timeout" '{"type":"error","event":"rate_limit_event","message":"model stream idle timeout"}'
  check_pair "a rate_limit_event alone is not a wall" 1 not-transient \
    "the leg ended" '{"type":"error","event":"rate_limit_event"}'
  check_cell "a rate_limit_event in .err does not veto" 0 "model stream idle timeout" \
    "model stream idle timeout (rate_limit_event seen earlier)"
  check_pair "an unknown error code wakes" 1 not-transient \
    "model stream idle timeout" '{"type":"error","code":"WIDGET_7","message":"model stream idle timeout"}'
  check_pair "an unknown status wakes" 1 not-transient \
    "model stream idle timeout" '{"type":"error","status":418,"message":"model stream idle timeout"}'
  check_pair "a 200 status does not block a transient end" 0 "model stream idle timeout" \
    "model stream idle timeout" '{"type":"progress","status":200}'
  check_pair "a 301 status does not block a transient end" 0 "model stream idle timeout" \
    "model stream idle timeout" '{"type":"progress","httpStatus":301}'
  check_pair "a 503 in a tool_result wakes and does not remount" 1 not-transient \
    "the leg ended" '{"type":"user","message":{"content":[{"type":"tool_result","status":503}]}}'
  check_pair "a 429 in a tool_result does not veto a transient end" 0 "model stream idle timeout" \
    "model stream idle timeout" '{"type":"user","message":{"content":[{"type":"tool_result","status":429}]}}'
  check_pair "an unknown status in a tool_result does not wake a transient end" 0 "model stream idle timeout" \
    "model stream idle timeout" '{"type":"user","message":{"content":[{"type":"tool_result","status":418}]}}'
  check_pair "an unknown error type wakes" 1 not-transient \
    "model stream idle timeout" '{"type":"error","errortype":"SomethingNew","message":"model stream idle timeout"}'
  check_pair "a wall-like code wakes as a wall" 1 provider-wall \
    "model stream idle timeout" '{"type":"error","code":"too_many_requests","message":"model stream idle timeout"}'
  check_pair "a 429 on a non-error record still vetoes" 1 provider-wall \
    "model stream idle timeout" '{"type":"response","status":429,"message":"model stream idle timeout"}'
  check_pair "an unknown value on a non-error record is progress noise" 0 "model stream idle timeout" \
    "model stream idle timeout" '{"type":"response","status":"flying"}'
  check_pair "a non-JSON wall line vetoes" 1 provider-wall \
    "model stream idle timeout" 'Error: quota exceeded'
  check_pair "a wall token in a prompt vetoes" 1 provider-wall \
    "model stream idle timeout" '{"type":"error","message":"model stream idle timeout","prompt":{"text":"check quota"}}'
  check_pair "a bare tool name is a label, not a classification" 0 "model stream idle timeout" \
    "model stream idle timeout" '{"type":"error","name":"Bash","message":"model stream idle timeout"}'
  check_pair "an empty code value is noise" 0 "model stream idle timeout" \
    "model stream idle timeout" '{"type":"error","code":"","message":"model stream idle timeout"}'
  [ "$matrix_fail" -eq 0 ] \
    && ok "structured and veto edge controls all behaved" \
    || fail "structured and veto edge controls misclassified"
  echo "quote corpus: real wall phrasings wake, alone and beside every transient"
  quotes=0; matrix_fail=0
  while IFS= read -r quote; do
    [ -n "$quote" ] || continue
    quotes=$((quotes + 1))
    check_cell "corpus [$quote]" 1 provider-wall "$quote"
    while IFS= read -r sig; do
      [ -n "$sig" ] || continue
      check_cell "corpus [$quote] beside [$sig]" 1 provider-wall "$quote: $sig"
    done < "$tmp/transients.txt"
  done < <("$self" wall-quotes)
  [ "$quotes" -gt 0 ] && [ "$matrix_fail" -eq 0 ] \
    && ok "quote corpus: $quotes phrasings wake alone and beside every transient" \
    || fail "quote corpus misclassifies or is empty"
  out=$("$self" transient "$tmp/no-such.err" 2>"$tmp/err"); rc=$?
  [ $rc -eq 1 ] && case $(cat "$tmp/err") in *"no such error file"*) true ;; *) false ;; esac \
    && ok "a missing error file is refused" || fail "a missing error file is refused (exit $rc)"

  echo "bug review forms"
  base=$(git -C "$tmp/cx" rev-parse HEAD) || exit 1
  printf '[lanes.one]\nharness = "claude"\nmodel = "claude-model"\neffort = "low"\n\n[team]\ncoachman = { harness = "claude", model = "coach-model" }\n' > "$tmp/review-claude.toml"
  printf '[lanes.one]\nharness = "mimo"\nmodel = "prov/mimo-model"\neffort = "low"\n\n[team]\ncoachman = { harness = "mimo", model = "coach-model" }\n' > "$tmp/review-mimo.toml"
  printf '[lanes.one]\nharness = "pi"\nmodel = "pi-model"\n\n[team]\ncoachman = { harness = "pi", model = "coach-model" }\n' > "$tmp/review-pi.toml"
  runs_as "claude review names the range and runs /code-review at max" review-claude \
    "-p /code-review max $base...HEAD --model claude-model --effort max --output-format stream-json --verbose --dangerously-skip-permissions probe=" \
    review one "$tmp/cx-detached" "$base"
  runs_as "codex review uses --base, --last, max effort and the lane model" review-codex \
    "$(lines "$tmp/cx-detached" exec review --base "$base" --json -o "$tmp/review-last.md" -m lane-model -c 'model_reasoning_effort="max"' "$CODEX_BYPASS" --skip-git-repo-check)" \
    review one "$tmp/cx-detached" "$base" --last "$tmp/review-last.md"
  printf 'stale from an earlier attempt\n' > "$tmp/review-last.md"
  run review-codex review one "$tmp/cx-detached" "$base" --last "$tmp/review-last.md"
  [ $rc -eq 0 ] && [ ! -e "$tmp/review-last.md" ] \
    && ok "a review launch removes a stale --last file before the harness runs" \
    || fail "a review launch removes a stale --last file before the harness runs"
  record review-run review-codex
  runs_as "codex review in a run uses the recorded config and the same top level" review-codex \
    "$(lines "$tmp/cx-detached" exec review --base "$base" --json -m lane-model -c 'model_reasoning_effort="max"' "$CODEX_BYPASS" --skip-git-repo-check)" \
    review one "$tmp/cx-detached" "$base" --run "$tmp/repo/.postmaster/runs/review-run"
  mrun review-mimo review one "$tmp/cx-detached" "$base"
  case $out in *"--command review"*"--variant high"*"stdin=$base...HEAD"*) true ;; *) false ;; esac \
    && [ $rc -eq 0 ] && ok "mimo review uses --command review, the prompt file range and high variant" \
    || fail "mimo review uses --command review, the prompt file range and high variant"
  [ -z "$(find "$tmp/cx-detached" -maxdepth 1 -name '.postmaster-review-*' -print -quit)" ] \
    && ok "mimo's temporary range prompt is removed after launch" || fail "mimo's temporary range prompt is removed after launch"
  rel_pwd=$(pwd -P) && cd "$tmp" || { echo "self-test: cannot enter $tmp"; exit 1; }
  run review-mimo review one "cx-detached" "$base"
  cd "$rel_pwd" || exit 1
  case $out in *"--command review"*) ran=true ;; *) ran=false ;; esac
  [ $rc -eq 0 ] && $ran && [ -z "$(find "$tmp/cx-detached" -maxdepth 1 -name '.postmaster-review-*' -print -quit)" ] \
    && ok "mimo's temporary range prompt is removed after a relative-cwd launch" \
    || fail "mimo's temporary range prompt is removed after a relative-cwd launch"
  run review-pi review one "$tmp/cx-detached" "$base"
  [ $rc -eq 3 ] && [ -z "$out" ] && case $err in *"has no bug code-review form"*) true ;; *) false ;; esac \
    && ok "pi has no bug review form: exit 3" || fail "pi has no bug review form: exit 3"
  printf '[lanes.one]\nharness = "not-installed"\nmodel = "model"\n' > "$tmp/review-unsupported.toml"
  run review-unsupported review one "$tmp/cx-detached" "$base"
  [ $rc -eq 3 ] && [ -z "$out" ] && case $err in *"has no bug code-review form"*) true ;; *) false ;; esac \
    && ok "a harness without a review form exits 3 even when its CLI is absent" \
    || fail "a harness without a review form exits 3 even when its CLI is absent"
  git -C "$tmp/cx" worktree add -q --detach "$tmp/cx-dirty" \
    || { echo "self-test: cannot make the dirty review fixture"; exit 1; }
  printf 'v1\n' > "$tmp/cx-dirty/tracked.txt"
  git -C "$tmp/cx-dirty" -c user.name=t -c user.email=t@example.invalid add tracked.txt \
    && git -C "$tmp/cx-dirty" -c user.name=t -c user.email=t@example.invalid commit -q -m tracked \
    || { echo "self-test: cannot commit the dirty review fixture"; exit 1; }
  dirty_base=$(git -C "$tmp/cx-dirty" rev-parse HEAD) || exit 1
  printf 'v2\n' > "$tmp/cx-dirty/tracked.txt"
  run review-codex review one "$tmp/cx-dirty" "$dirty_base"
  [ $rc -eq 1 ] && [ -z "$out" ] && case $err in *"would widen the review past"*) true ;; *) false ;; esac \
    && ok "a review on a dirty scratch is refused before the harness runs" \
    || fail "a review on a dirty scratch is refused before the harness runs"
  git -C "$tmp/cx-dirty" checkout -q -- tracked.txt || exit 1
  printf 'untracked\n' > "$tmp/cx-dirty/untracked.txt"
  run review-codex review one "$tmp/cx-dirty" "$dirty_base"
  [ $rc -eq 0 ] && case $out in *"$dirty_base"*) true ;; *) false ;; esac \
    && ok "untracked scratch files do not block a review" \
    || fail "untracked scratch files do not block a review"

  echo
  [ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
  echo "self-test: $fails control(s) misbehaved"; exit 1
fi

die() { echo "launch: $*" >&2; exit 1; }
# --- thread-id: the id a stream records, from its own shape ---------------------------------
# Harness-specific event shapes live here and in harnesses.md, not in whoever records the id.
# Pure: no config, no harness lookup. Events are read top-down and the first id wins; keys
# are matched anywhere in an event but bare `id` only on a session record, so a tool payload
# that happens to carry an id never resolves as the thread.
thread_id() {  # thread_id <events-file>
  [ $# -eq 1 ] || die "usage: launch.sh thread-id <events-file>"
  [ -f "$1" ] || die "no such events file: $1"
  python3 - "$1" <<'PY'
import json, sys
path = sys.argv[1]
try:
    f = open(path, encoding="utf-8", errors="replace")
except OSError as e:
    print("launch: cannot read %s: %s" % (path, e.strerror), file=sys.stderr); raise SystemExit(1)
KEYS = ("thread_id", "session_id", "sessionID", "sessionId",
        "conversationId", "conversation_id")
def walk(obj):
    if isinstance(obj, dict):
        for key, value in obj.items():
            yield key, value
            yield from walk(value)
    elif isinstance(obj, list):
        for value in obj:
            yield from walk(value)
for line in f:
    line = line.strip()
    if not line:
        continue
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if not isinstance(e, dict):
        continue
    # muse: stream.id on a session record
    stream = e.get("stream")
    if isinstance(stream, dict) and stream.get("kind") == "session":
        value = stream.get("id")
        if isinstance(value, str) and value.strip():
            print(value.strip()); raise SystemExit(0)
    # pi and grok: id on a session record
    if e.get("type") == "session" and isinstance(e.get("id"), str) and e["id"].strip():
        print(e["id"].strip()); raise SystemExit(0)
    for key, value in walk(e):
        if key in KEYS and isinstance(value, str) and value.strip():
            print(value.strip()); raise SystemExit(0)
print("launch: no thread id in %s" % path, file=sys.stderr); raise SystemExit(1)
PY
}

# --- transient: a provider error worth resuming on ------------------------------------------
# The set is enumerated here and documented in harnesses.md; the watcher only asks. Matched
# against the leg's .err and the error records in its stream tail, never a prompt or a user
# message. Prints the canonical class on a match. A launch refusal and a quota, payment,
# usage or rate wall are checked first and are never transient.
# The wall phrases live here once: transient builds its matcher from them and the
# self-test builds its coverage matrix from them, so a phrase added here is matched
# and covered with no other edit.
wall_tokens() {  # wall_tokens: the adapter's wall token stems, one per line; any of these anywhere in an ending vetoes an automatic resume
  printf '%s\n' \
    quota \
    limit \
    exhaust \
    exceed \
    throttl \
    bill \
    budget \
    credit \
    payment \
    usage \
    slow \
    quick \
    toomany \
    429 \
    402
}
# The stems are deliberately broad and matched as substrings on
# separator-stripped text, with no span limit and no word boundary: a false veto
# is a wake, which costs the postmaster one look, while a missed wall is an
# automatic remount against a wall. The one exclusion is Claude's
# rate_limit_event slowdown notice, which is stripped before the veto scan.

# The quote corpus: wall phrasings as runs met them, verbatim with provenance.
# The token matrix covers the veto set by construction; the corpus covers the
# wild, each quote alone and beside every transient exemplar. When a run meets a
# wall phrasing, append it here verbatim with where it was found. No wall
# verbatim was found in run logs through 2026-09-29 (legs hit transient
# timeouts, never walls), so the seeds below are probe-attested: round-4
# through round-6 review probes, the oracle wall probe, and the HTTP status
# lines. The round-2 provider_wall seed carries no stem, so it reads here in
# its capacity-exhausted control form; a bare provider-wall mention without a
# stem wakes as not-transient, which is still a wake.
wall_quotes() {  # wall_quotes: real wall phrasings, one per line; the corpus control wakes on each alone and beside every transient exemplar
  printf '%s\n' \
    "You exceeded your current quota, please check your plan and billing details." \
    "quota was exceeded for this key" \
    "Error: insufficient_quota" \
    "You have been throttled. Slow down." \
    "ratelimited: please back off and retry" \
    "HTTP 429: Too Many Requests" \
    "budget exhausted for this billing period" \
    "quota exceeded: monthly spend budget exhausted" \
    "Error: quota_exhausted" \
    "provider wall: model capacity exhausted" \
    "resource_exhausted: try again later" \
    "You have been rate limited. Slow down." \
    "usage limits reached for this account" \
    "RateLimitError: slow down" \
    "429 Too Many Requests" \
    "402 Payment Required" \
    "Resource has been exhausted (e.g. check quota)" \
    "Error: rate_limit_exceeded" \
    "Error: usage_limit_reached" \
    "quota for this project was finally exceeded" \
    "budget for the current month has been exhausted" \
    "Please slow down, you're sending requests too quickly." \
    "You are sending requests too quickly. Slow down."
}

transient() {  # transient <err-file> [<stream-file> [<skip-lines>]]
  [ $# -ge 1 ] && [ $# -le 3 ] || die "usage: launch.sh transient <err-file> [<stream-file> [<skip-lines>]]"
  [ -f "$1" ] || die "no such error file: $1"
  python3 - "$1" "${2:-}" "${3:-0}" "$(wall_tokens)" <<'PY'
import collections, itertools, json, re, sys
err_path, stream_path, skip_arg, token_text = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
tokens = [re.sub(r"[^a-z0-9]", "", t.lower()) for t in token_text.split()]
tokens = [t for t in tokens if t]
if not tokens:
    print("launch: no wall tokens: refusing to classify with an empty veto set", file=sys.stderr)
    raise SystemExit(1)
text_stems = [t for t in tokens if not t.isdigit()]
digit_stems = [t for t in tokens if t.isdigit()]
code_re = re.compile(r"\b(?:" + "|".join(digit_stems) + r")\b") if digit_stems else None
try:
    skip = int(skip_arg)
    if skip < 0: raise ValueError("negative")
except ValueError:
    print("launch: skip-lines is a whole number from 0: %s" % skip_arg, file=sys.stderr)
    raise SystemExit(1)
try:
    with open(err_path, encoding="utf-8", errors="replace") as f:
        err = f.read()
except OSError as e:
    print("launch: cannot read %s: %s" % (err_path, e), file=sys.stderr)
    raise SystemExit(1)
# The classifier answers one question: may the watcher resume this ending by itself?
# The answer is positive and narrow. An ending resumes only when it carries a known
# transient signature and no wall-like token anywhere in what it says; everything
# else wakes the postmaster. A false veto is a wake, which costs one look; a missed
# wall is an automatic remount against a wall. The transient set below is closed;
# the veto set is token stems (argv, printed by `launch.sh wall-tokens`).
#
# The veto reads message text only: the .err lines, non-JSON stream lines (stderr
# chunks), and every string value of the ending's error records — the records the
# adapter recognises as errors or terminal failures (harnesses.md names them per
# harness). Inside an error record every value counts, under any key, except
# inside a tool-result subtree, which stays excluded whatever it nests; JSON keys,
# field names and numeric payloads are structure, not text, and never count — a
# "usage" key, a rate_limit key, a token count of 1429 and a UUID holding 429 are
# not walls. Text stems match as substrings on separator-stripped text, so no
# spelling, span or boundary can hide a wall; digit stems count only
# status-shaped, as whole numbers in text. An assistant's ordinary messages and
# tool output are not error records and veto nothing: agents write limit, usage,
# quota and exceed in working prose all day, and a veto over those would leave
# auto-resume never firing. Prompt values inside error records veto in the safe
# direction, as since round 6; prompt text can never authorize a resume, below.
# The first skip-lines lines are an earlier launch's: a resumed stream keeps its history
# while .err holds only the current launch, so without the skip an old transient error
# would classify a later unrelated failure as transient, and an old wall would veto a
# later transient end.
#
# Only error fields on error records contribute positive transient prose, windowed to
# the last 100 post-skip lines: a missed transient is the safe direction, it wakes.
# User and prompt fields are excluded there, so prompt text can never make a process
# eligible for an automatic remount.
#
# Structured values come in three classes, read over every post-skip line. A status
# code or error type in the known-transient set is a resume signal, on any record. A
# known-harness-internal value (a completed status, a rate_limit_event slowdown, a
# 2xx/3xx status, an exit code, a generic timeout) is ignored. Any other numeric
# status under a code key
# wakes wherever it sits; any other string under a code or error-name key wakes on an
# error record, while on a non-error record it is progress noise: an unknown
# classification is a wake, never a fall-through. Bare record-shape keys (type, name)
# are labels, not classifications: a transient-set member there still signals,
# anything else is ignored. An int outside the 100-999 status shape is an exit code,
# not a status.
CODE_KEYS = {"status", "statuscode", "code", "errorcode", "errcode", "httpstatus"}
NAME_KEYS = {"errortype", "errorname"}
SHAPE_KEYS = {"type", "name"}
MESSAGE_KEYS = {"error", "errors", "message", "detail", "reason", "description", "text"}
PROMPT_KEYS = {"user", "prompt", "input", "transcript", "request"}
TRANSIENT_CODES = {502, 503, 504, 529}
WALL_CODES = {int(t) for t in digit_stems}
TRANSIENT_TYPES = {"econnreset", "econnaborted", "overloaded", "overloadederror"}
INTERNAL = {"completed", "ratelimitevent", "etimedout"}
structured_transient = None
structured_wall = False
unknown_structured = False
def note_structured(key, value, marked):
    global structured_transient, structured_wall, unknown_structured
    nk = re.sub(r"[^a-z0-9]", "", key.lower())
    if isinstance(value, bool) or value is None:
        return
    if isinstance(value, float):
        if value.is_integer():
            value = int(value)
        else:
            return
    if isinstance(value, int):
        if nk in CODE_KEYS:
            if value in TRANSIENT_CODES:
                if structured_transient is None:
                    structured_transient = "gateway failure"
            elif value in WALL_CODES:
                structured_wall = True
            elif 200 <= value <= 399:
                pass  # success and redirect statuses are harness-internal, like completed
            elif 100 <= value <= 999:
                unknown_structured = True
            # else an exit code, not a status: harness-internal, ignored
        return
    if not isinstance(value, str):
        return
    text = value.strip()
    if not text:
        return
    if nk in CODE_KEYS and text.isascii() and text.isdigit():
        note_structured(key, int(text), marked)
        return
    nv = re.sub(r"[^a-z0-9]", "", text.lower())
    if not nv:
        return
    if nk in CODE_KEYS or nk in NAME_KEYS or nk in SHAPE_KEYS:
        if nv in TRANSIENT_TYPES:
            if structured_transient is None:
                structured_transient = "stream drop" if nv.startswith("econn") else "gateway failure"
            return
    if marked and (nk in CODE_KEYS or nk in NAME_KEYS):
        if nv not in INTERNAL:
            unknown_structured = True
    # A bare type or name outside the transient set is a record label: ignored.
    # A string on a non-error record is progress noise unless it signals.
NOTICE = "ratelimitevent"  # Claude's slowdown notice: not an ending, never a veto
def vetoed(text):
    norm = re.sub(r"[^a-z0-9]", "", text.lower()).replace(NOTICE, " ")
    if any(tok in norm for tok in text_stems):
        return True
    if code_re is not None:
        if code_re.search(re.sub(r"[\s_-]+", " ", text)):
            return True
    return False
def norm_key(key):
    return re.sub(r"[^a-z0-9]", "", str(key).lower())
# A subtree is a tool's result when its type or name says so, or when it sits
# under a tool-result key: claude's tool_result, pi's tool_execution_end, and
# any other harness's tool-result shape the adapter identifies (harnesses.md
# names them). A failed tool call's text is the tool's, not the provider's — a
# failing gate prints cap and limit words all day — and a provider wall still
# ends the turn through the harness's own error record. The exclusion holds at
# every depth, in every read — marking, the veto, transient prose and
# structured signals alike: a tool's subtree contributes nothing anywhere,
# whatever it nests. It is deliberately narrow: only tool_result and
# tool_execution_end as
# a type, a name, or a key exclude — a payload_type of tool.result (muse
# outcome:error payloads) is an error record, not a tool's.
TOOL_RESULT_NAMES = {"toolresult", "toolexecutionend"}
def is_tool_result(node):
    if not isinstance(node, dict):
        return False
    for key, child in node.items():
        if norm_key(key) in ("type", "name") and norm_key(child) in TOOL_RESULT_NAMES:
            return True
    return False
# Error-indicating keys, normalised: a truthy value under one of these at any
# depth marks the record — error_message rejoined from the round-8 allowlist,
# since a wall under an error-message key is a wall in an error field. Only a
# truthy value marks: null, false and empty values never do.
ERROR_KEYS = {"error", "errors", "iserror", "errormessage"}
# Classifier keys whose value names the record's kind: error, fail or exception
# in one marks, at any depth.
KIND_KEYS = ("type", "event", "kind", "payload_type", "subtype", "status")
def values_vetoed(value):
    if isinstance(value, str):
        return vetoed(value)
    if isinstance(value, dict):
        if is_tool_result(value):
            return False
        for key, child in value.items():
            if norm_key(key) in TOOL_RESULT_NAMES and isinstance(child, (dict, list)):
                continue
            if values_vetoed(child):
                return True
        return False
    if isinstance(value, list):
        return any(values_vetoed(child) for child in value)
    return False
def is_marked(event):
    found = False
    def visit(node):
        nonlocal found
        if found or is_tool_result(node):
            return
        if isinstance(node, dict):
            kind = " ".join(str(node.get(k, "")) for k in KIND_KEYS).lower()
            if "error" in kind or "fail" in kind or "exception" in kind:
                found = True
                return
            for key, child in node.items():
                nk = norm_key(key)
                if nk in TOOL_RESULT_NAMES and isinstance(child, (dict, list)):
                    continue
                if nk in ERROR_KEYS and bool(child):
                    found = True
                    return
                if nk == "outcome" and str(child).lower() == "error":
                    found = True
                    return
                visit(child)
        elif isinstance(node, list):
            for child in node:
                visit(child)
    visit(event)
    return found
def note_record(value, marked):
    if isinstance(value, dict):
        if is_tool_result(value):
            return
        for key, child in value.items():
            kl = str(key).lower()
            if kl in PROMPT_KEYS:
                continue
            if norm_key(key) in TOOL_RESULT_NAMES and isinstance(child, (dict, list)):
                continue
            note_structured(str(key), child, marked)
            note_record(child, marked)
    elif isinstance(value, list):
        for child in value:
            note_record(child, marked)
error_text = []
veto_hit = False
if stream_path:
    try:
        f = open(stream_path, encoding="utf-8", errors="replace")
    except OSError:
        f = []
    # The veto and the structured read cover every post-skip line: a missed wall or
    # an unknown status would resume, so no window may hide one. Prose collection
    # below stays windowed to the last 100 post-skip lines: a missed transient is
    # the safe direction, it wakes.
    window = collections.deque(maxlen=100)
    for line in itertools.islice(f, skip, None):
        try:
            event = json.loads(line)
        except ValueError:
            if not veto_hit and vetoed(line):
                veto_hit = True
            continue
        if not isinstance(event, dict):
            continue
        marked = is_marked(event)
        if marked and not veto_hit and values_vetoed(event):
            veto_hit = True
        note_record(event, marked)
        window.append(event)
    for event in window:
        if not is_marked(event):
            continue
        def collect(value, parent=""):
            if isinstance(value, str):
                if parent in MESSAGE_KEYS:
                    error_text.append(value)
                return
            if isinstance(value, dict):
                if is_tool_result(value):
                    return
                for key, child in value.items():
                    if str(key).lower() in PROMPT_KEYS:
                        continue
                    if norm_key(key) in TOOL_RESULT_NAMES and isinstance(child, (dict, list)):
                        continue
                    collect(child, str(key).lower())
            elif isinstance(value, list):
                for child in value:
                    collect(child, parent)
        collect(event)
all_errors = err + "\n" + "\n".join(error_text)
# host.sh's own notices (uncapped, cap reached) precede the child's stderr, so a
# refusal is a launch: line past any leading host: lines, not offset 0.
if re.sub(r"^(?:host:[^\n]*\n)+", "", err).startswith("launch:"):
    print("launch-refusal")
    raise SystemExit(1)
# The veto reads past host: lines everywhere in .err, as the refusal check does
# for its leading block: host notices ("no supported per-launch limits") are the
# host's words, and "limits" must not veto the child's transient end.
err_prose = "\n".join(line for line in err.split("\n") if not line.startswith("host:"))
if veto_hit or vetoed(err_prose) or structured_wall:
    print("provider-wall")
    raise SystemExit(1)
if unknown_structured:
    print("not-transient")
    raise SystemExit(1)
if structured_transient is not None:
    print(structured_transient)
    raise SystemExit(0)
sep = r"[\s_-]+"
idle = re.compile(r"\b(?:model%sstream%sidle%stimeout|stream%sidle%stimeout)\b" % (sep, sep, sep, sep, sep), re.I)
if idle.search(all_errors):
    print("model stream idle timeout")
    raise SystemExit(0)
gateway = re.compile(r"\b(?:bad%sgateway|service%sunavailable|gateway%stimeout|overloaded|50[234]|529)\b" % (sep, sep, sep), re.I)
if gateway.search(all_errors):
    print("gateway failure")
    raise SystemExit(0)
drop = re.compile(r"\b(?:stream%sdisconnected|sse%serror|connection%s(?:reset|aborted)|broken%spipe)\b" % (sep, sep, sep, sep), re.I)
if drop.search(all_errors):
    print("stream drop")
    raise SystemExit(0)
print("not-transient")
raise SystemExit(1)
PY
}

case ${1:-} in
  thread-id) shift; thread_id "$@"; exit $? ;;
  transient) shift; transient "$@"; exit $? ;;
  wall-tokens) shift; [ $# -eq 0 ] || die "usage: launch.sh wall-tokens"; wall_tokens; exit 0 ;;
  wall-quotes) shift; [ $# -eq 0 ] || die "usage: launch.sh wall-quotes"; wall_quotes; exit 0 ;;
esac

[ $# -ge 2 ] || die "usage: launch.sh form|launch|review|resume|skill <name> ... | thread-id <events-file> | transient <err-file> [<stream-file> [<skip-lines>]] | wall-tokens | wall-quotes | --self-test"
CMD=$1; NAME=$2; shift 2
LEG=""; LAST=""; RUN=""; BASE=""; PROJECT=""; PTEXT=""; STDIN_FILE=""; REVIEW_PROMPT=""; args=()
while [ $# -gt 0 ]; do
  case $1 in
    --leg) [ $# -ge 2 ] || die "--leg needs a value"; LEG=$2; shift ;;
    --last) [ $# -ge 2 ] || die "--last needs a file"; LAST=$2; shift ;;
    --run) [ $# -ge 2 ] && [ -n "$2" ] || die "--run needs a dispatch directory"; RUN=$2; shift ;;
    --project) [ $# -ge 2 ] && [ -n "$2" ] || die "--project needs a project directory"; PROJECT=$2; shift ;;
    *) args+=("$1") ;;
  esac
  shift
done
[ "$NAME" = coachman ] && [ "$CMD" != form ] && [ -z "$LEG" ] \
  && die "coachman needs --leg synthesis, review or ship to $CMD"

if [ -n "$RUN" ]; then
  [ -z "$PROJECT" ] || die "use --run or --project, not both"
  SOURCE=${RUN%/}/run.json
  [ -f "$SOURCE" ] || die "no run.json in $RUN; inside a run, a launch or resume runs only on the config the run recorded at dispatch"
else
  SOURCE=$CONFIG
  [ -f "$SOURCE" ] || die "no config at $CONFIG (POSTMASTER_CONFIG overrides the path)"
fi
python3 -c 'import tomllib' 2>/dev/null || die "python3 with tomllib (3.11 or newer) is needed to read the config"
spec=$(python3 - "$SOURCE" "$NAME" "$LEG" "${RUN:+run}" "$PROJECT" "$HERE" <<'PY'
import json, re, sys, tomllib, shlex
path, name, leg, recorded, project, here = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "run", sys.argv[5], sys.argv[6]
def die(msg):
    print("die %s" % shlex.quote(msg)); sys.exit(0)
def table(v, what):
    if not isinstance(v, dict):
        die("%s in %s is not a table" % (what, path))
    return v
try:
    with open(path, "rb") as f:
        cfg = json.load(f) if recorded else tomllib.load(f)
except (OSError, ValueError) as e:
    die("cannot read %s: %s" % (path, e))
if recorded:
    # run.json is the run's whole record; its config is the one field run-meta.sh wrote as parsed.
    cfg = cfg.get("config") if isinstance(cfg, dict) else None
    if not isinstance(cfg, dict):
        die("cannot read %s: it records no config" % path)
elif project:
    import subprocess
    try:
        tomllib.load(open(path, "rb"))
    except (OSError, tomllib.TOMLDecodeError) as e:
        die("cannot read %s: %s" % (path, e))
    r = subprocess.run([here + "/project-settings.sh", "effective", project, path],
                       capture_output=True, text=True)
    if r.returncode:
        die(r.stderr.strip() or "cannot resolve project role choices")
    try:
        cfg = json.loads(r.stdout)
    except ValueError as e:
        die("project settings gave no effective config: %s" % e)
LEGS = ("synthesis", "review", "ship")
if leg and leg not in LEGS:
    die("no such leg: --leg %s; the legs are synthesis, review and ship" % leg)
lanes = table(cfg.get("lanes", {}), "[lanes]")
def base(model):  # a model id without its bracketed suffixes: same[1m] is same
    return re.sub(r"(\[[^\]]*\])+$", "", str(model))
lane_models = {base(v["model"]) for v in lanes.values() if isinstance(v, dict) and v.get("model")}
def not_a_lane(spec, what):
    if isinstance(spec, dict) and spec.get("model") and base(spec["model"]) in lane_models:
        die("%s in %s runs on %s, a lane's model, and a coachman never does" % (what, path, spec["model"]))
if name == "coachman":
    team = table(cfg.get("team", {}), "[team]")
    legs = table(team.get("coachman_legs", {}), "[team.coachman_legs]")
    merged = [k for k in legs if k in ("style", "bug", "security")]
    if merged:
        die("[team.coachman_legs] in %s names %s: style, bug and security are one leg now, review; "
            "give review one entry instead" % (path, ", ".join(merged)))
    unknown = [k for k in legs if k not in LEGS]
    if unknown:
        die("[team.coachman_legs] in %s names no such leg: %s; the legs are synthesis, review and ship"
            % (path, ", ".join(unknown)))
    for k, v in legs.items():
        table(v, "[team.coachman_legs] %s" % k)
        if not v.get("harness") or not v.get("model"):
            die("[team.coachman_legs] %s in %s needs a harness and a model" % (k, path))
        not_a_lane(v, "[team.coachman_legs] %s" % k)
    not_a_lane(team.get("coachman"), "team.coachman")
    spec = (legs.get(leg) if leg else None) or team.get("coachman")
elif name == "coachman_fallback":
    spec = table(cfg.get("team", {}), "[team]").get("coachman_fallback")
    not_a_lane(spec, "team.coachman_fallback")
elif name == "postmaster":
    spec = table(cfg.get("team", {}), "[team]").get("postmaster")
else:
    spec = lanes.get(name)
if not spec:
    die("no such lane or role in %s: %s" % (path, name))
table(spec, name)
for k in ("harness", "model", "effort", "env_file"):
    v = spec.get(k)   # JSON can say null where TOML says nothing; both are unset
    print("%s=%s" % (k.upper(), shlex.quote("" if v is None else str(v))))
PY
) && [ -n "$spec" ] || die "cannot read the config at $SOURCE"
eval "$spec"
[ -n "${HARNESS:-}" ] || die "$NAME has no harness in $SOURCE"
[ -n "${MODEL:-}" ] || die "$NAME has no model in $SOURCE"
if [ "$CMD" = review ]; then
  FORMS=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)/review-forms.sh
  "$FORMS" has "$HARNESS" >/dev/null 2>&1 \
    || { echo "launch: $NAME runs on $HARNESS, which has no bug code-review form recorded in harnesses.md" >&2; exit 3; }
fi
command -v "$HARNESS" >/dev/null 2>&1 || die "harness '$HARNESS' is not on PATH"
if [ -n "${ENV_FILE:-}" ]; then
  ENV_FILE=${ENV_FILE/#\~/$HOME}
  case $ENV_FILE in /*) ;; *) ENV_FILE=$(CDPATH= cd -P -- "$(dirname -- "$CONFIG")" && pwd -P)/$ENV_FILE ;; esac
  [ -f "$ENV_FILE" ] && [ -r "$ENV_FILE" ] || die "env_file for $NAME not found or not readable: $ENV_FILE"
fi

if [ "$CMD" = skill ]; then  # the prompt that invokes the lane's harness's own skill
  [ ${#args[@]} -eq 1 ] || die "skill needs <skill>"
  case $HARNESS:${args[0]} in
    claude:security-review) echo /security-review; exit 0 ;;
    *:security-review) echo "launch: $NAME runs on $HARNESS, which has no security review skill recorded in harnesses.md" >&2; exit 3 ;;
    *) die "no such skill: ${args[0]}; the one skill is security-review" ;;
  esac
fi

prompt_text() {  # the prompt file's text; a missing, unreadable or empty file is refused
  [ -f "$PROMPT" ] && [ -r "$PROMPT" ] && [ -s "$PROMPT" ] || die "prompt file missing, unreadable or empty: $PROMPT"
  PTEXT=$(cat "$PROMPT") || die "cannot read the prompt file: $PROMPT"
}
case $CMD in
  form)   [ ${#args[@]} -eq 0 ] || die "form takes no argument but --leg and --run"
          CWD='<cwd>'; PROMPT='<prompt-file>'; THREAD='<thread-id>'; BASE='<base>'; PTEXT='$(cat <prompt-file>)' ;;
  launch) [ ${#args[@]} -eq 2 ] || die "launch needs <cwd> <prompt-file>"
          CWD=${args[0]}; PROMPT=${args[1]}; prompt_text ;;
  review) [ ${#args[@]} -eq 2 ] || die "review needs <cwd> <base>"
          CWD=${args[0]}; BASE=${args[1]}; PROMPT='<review-prompt-file>' ;;
  resume) [ ${#args[@]} -eq 3 ] || die "resume needs <cwd> <thread-id> <prompt-file>"
          CWD=${args[0]}; THREAD=${args[1]}; PROMPT=${args[2]}
          [ -n "$THREAD" ] || die "resume needs a thread id, and none was given"
          prompt_text ;;
  *) die "unknown command: $CMD" ;;
esac
[ "$CMD" = form ] || [ -d "$CWD" ] || die "no such directory: $CWD"
if [ "$CMD" = review ]; then
  git -C "$CWD" rev-parse --verify "$BASE^{commit}" >/dev/null 2>&1 \
    || die "review base is not a commit in $CWD: $BASE"
  git -C "$CWD" diff --quiet HEAD -- 2>/dev/null \
    || die "review scratch is dirty, which would widen the review past $BASE...HEAD: $CWD"
  if [ "$HARNESS" = mimo ]; then
    REVIEW_PROMPT=$(mktemp "$CWD/.postmaster-review-XXXXXX") || die "cannot create the MiMo review prompt in $CWD"
    # Absolute at creation: the cd below would re-resolve a relative path, and the
    # removal after it, and the EXIT trap, would miss while rm -f still exits 0.
    prompt_dir=$(CDPATH= cd -P -- "$(dirname -- "$REVIEW_PROMPT")" && pwd -P) || die "cannot resolve the MiMo review prompt in $CWD"
    REVIEW_PROMPT=$prompt_dir/$(basename -- "$REVIEW_PROMPT")
    printf '%s...HEAD\n' "$BASE" > "$REVIEW_PROMPT" || die "cannot write the MiMo review prompt in $CWD"
    PROMPT=$REVIEW_PROMPT
    trap 'rm -f -- "$REVIEW_PROMPT"' EXIT
  fi
fi
case $HARNESS in pi|muse|mimo) [ "$CMD" != form ] ;; *) false ;; esac && {   # read after the cd
  prompt_dir=$(CDPATH= cd -P -- "$(dirname -- "$PROMPT")" && pwd -P) || die "cannot resolve prompt file: $PROMPT"
  PROMPT=$prompt_dir/$(basename "$PROMPT")
}

harness_data() {  # harness_data <harness>: this launch's own data directory, for a harness that keeps
  # state between sessions. Keyed by run, directory, name and leg, so a resume finds its session
  # and no lane, leg or run finds another's through the harness's own memory. It is not a
  # sandbox: a lane can still read files elsewhere on the machine.
  if [ "$CMD" = form ]; then echo "<harness-data>/$1/<key>"; return 0; fi
  printf '%s/%s/%s\n' "${POSTMASTER_HARNESS_DATA:-$HOME/.postmaster/harness-data}" "$1" \
    "$(printf '%s|%s|%s|%s' "$RUN" "$(CDPATH= cd -P -- "$CWD" && pwd -P)" "$NAME" "$LEG" | cksum | tr ' ' '-')"
}
forms() {  # the command for $CMD in cmd, its data directory in DATA, the file its stdin reads in STDIN_FILE
DATA=""
cmd=()
case $HARNESS in
  codex)
    # A resume takes the launch's flags but -C and --skip-git-repo-check, and runs in the
    # directory this script enters. Without -m and the effort it runs on codex's configured
    # default, not on the thread's own model. `--` stops a prompt that starts with - from being
    # read as a flag.
    if [ "$CMD" = review ]; then cmd=(codex exec review --base "$BASE" --json)
    elif [ "$CMD" = resume ]; then cmd=(codex exec resume "$THREAD" --json)
    else cmd=(codex exec -C "$CWD" --json); fi
    [ -n "$LAST" ] && cmd+=(-o "$LAST")
    cmd+=(-m "$MODEL")
    if [ "$CMD" = review ]; then cmd+=(-c 'model_reasoning_effort="max"')
    elif [ -n "${EFFORT:-}" ]; then cmd+=(-c "model_reasoning_effort=\"$EFFORT\""); fi
    cmd+=(--dangerously-bypass-approvals-and-sandbox)
    if { [ "$CMD" = launch ] || [ "$CMD" = review ]; } \
      && ! git -C "$CWD" symbolic-ref -q HEAD >/dev/null 2>&1; then
      cmd+=(--skip-git-repo-check)   # a detached scratch
    fi
    if [ "$CMD" = resume ]; then cmd+=(--); fi
    [ "$CMD" = review ] || cmd+=("$PTEXT") ;;
  grok)
    if [ "$CMD" = resume ]; then cmd=(grok --resume "$THREAD" -p "$PTEXT")
    else cmd=(grok --prompt-file "$PROMPT"); fi
    cmd+=(-m "$MODEL")
    [ -n "${EFFORT:-}" ] && cmd+=(--reasoning-effort "$EFFORT")
    cmd+=(--max-turns 1000 --always-approve --output-format streaming-json) ;;
  agy)
    [ "$CMD" = resume ] && die "agy resume form is not recorded; relaunch against its conversationId by hand (harnesses.md)"
    cmd=(agy -p "$PTEXT" --model "$MODEL" --output-format stream-json --dangerously-skip-permissions --add-dir "$CWD") ;;
  claude)
    if [ "$CMD" = review ]; then PTEXT="/code-review max $BASE...HEAD"; cmd=(claude -p "$PTEXT")
    elif [ "$CMD" = resume ]; then cmd=(claude -p --resume "$THREAD" "$PTEXT")
    else cmd=(claude -p "$PTEXT"); fi
    cmd+=(--model "$MODEL")
    if [ "$CMD" = review ]; then cmd+=(--effort max)
    elif [ -n "${EFFORT:-}" ]; then cmd+=(--effort "$EFFORT"); fi
    # POSTMASTER_LAUNCH_NAME, set by scripts/host.sh, names the thread in the harness's own store.
    [ -n "${POSTMASTER_LAUNCH_NAME:-}" ] && cmd+=(--name "$POSTMASTER_LAUNCH_NAME")
    cmd+=(--output-format stream-json --verbose --dangerously-skip-permissions) ;;
  pi)
    # The prompt goes in on stdin. An `@file` argument is an attachment, and pi sends it as
    # <file name="..."> ... </file> with no instruction around it, which is not the same
    # message every other harness gets. pi also reads stdin to EOF before it starts in every
    # mode but rpc, so the redirect is what keeps an inherited pipe from hanging the launch.
    # `--mode json` already selects non-interactive, so no --print.
    cmd=(pi --mode json --approve)
    [ "$CMD" = resume ] && cmd+=(--session "$THREAD")
    cmd+=(--model "$MODEL")
    [ -n "${EFFORT:-}" ] && cmd+=(--thinking "$EFFORT")
    [ -n "${POSTMASTER_LAUNCH_NAME:-}" ] && cmd+=(--name "$POSTMASTER_LAUNCH_NAME")
    STDIN_FILE=$PROMPT ;;
  muse)
    # --yolo is the bypass form: it turns off approval and the sandbox, which needs unprivileged
    # user namespaces, and trusts the workspace for the run. A resume is a launch that names the
    # session. The prompt comes from its file, so stdin carries nothing. Muse Code keeps its
    # sessions and a memory that outlives them under XDG_DATA_HOME, so each launch has its own.
    DATA=$(harness_data muse)
    cmd=(env "XDG_DATA_HOME=$DATA" muse exec --json --prompt-file "$PROMPT")
    [ "$CMD" = resume ] && cmd+=(--session-id "$THREAD")
    cmd+=(--model "$MODEL")
    [ -n "${EFFORT:-}" ] && cmd+=(--reasoning-effort "$EFFORT")
    cmd+=(--yolo)
    STDIN_FILE=/dev/null ;;
  mimo)
    # MiMo Code reads its prompt from stdin, which it reads to the end, so the prompt file is its
    # stdin and an inherited pipe never is. --dangerously-skip-permissions is the bypass form: it
    # approves whatever no rule denies. A resume is the launch form naming the session, with the
    # model and the variant passed again; --title names a launch's session after the run. MiMo
    # Code keeps its sessions and a memory tool's notes under XDG_DATA_HOME, so each launch has
    # its own. In a new one it would copy Claude Code's session history in first, which the launch
    # turns off; the instruction files it reads from Claude Code are kept.
    DATA=$(harness_data mimo)
    cmd=(env "XDG_DATA_HOME=$DATA" MIMOCODE_DISABLE_CLAUDE_IMPORT=1 mimo run --format json -m "$MODEL")
    [ "$CMD" = review ] && cmd+=(--command review)
    [ "$CMD" = resume ] && cmd+=(-s "$THREAD")
    if [ "$CMD" = review ]; then cmd+=(--variant high)
    elif [ -n "${EFFORT:-}" ]; then cmd+=(--variant "$EFFORT"); fi
    [ "$CMD" = launch ] && [ -n "${POSTMASTER_LAUNCH_NAME:-}" ] && cmd+=(--title "$POSTMASTER_LAUNCH_NAME")
    cmd+=(--dangerously-skip-permissions)
    STDIN_FILE=$PROMPT ;;
  *) die "no form for harness '$HARNESS'" ;;
esac
}
forms

[ -n "$DATA" ] && [ "$CMD" != form ] && { mkdir -p "$DATA" || die "cannot create $DATA"; }
if [ "$CMD" = form ]; then
  show() { case $1 in '<'*'>'|*'=<'*'>'|'$(cat <prompt-file>)') printf '%s ' "$1" ;; *) printf '%q ' "$1" ;; esac; }
  put_form() {
    printf 'cd '; show "$CWD"; printf '&& '
    for a in "${cmd[@]}"; do show "$a"; done
    [ -n "${STDIN_FILE:-}" ] && { printf '< '; show "$STDIN_FILE"; }
    echo
  }
  printf 'launch: '; put_form
  if resume=$(CMD=resume; STDIN_FILE=""; harness_data() { echo "<harness-data>/$1/<key>"; }
              forms 2>&1 && put_form); then printf 'resume: %s\n' "$resume"
  else printf 'resume: none: %s\n' "${resume#launch: }"; fi
  exit 0
fi

# muse opens a new thread under an id it does not hold, and mimo exits 0 having run nothing
# (harnesses.md). So a resume on either is refused unless the harness's own export finds the
# thread in this launch's data directory, which is its launch's only from the same directory,
# name, leg and run.
if [ "$CMD" = resume ] && [ -n "$DATA" ]; then
  held=$(mktemp -d) || die "cannot make a temporary directory"
  ( CDPATH= cd -- "$CWD" || exit 1
    if [ -n "${ENV_FILE:-}" ]; then set -a; . "$ENV_FILE"; set +a; fi
    export XDG_DATA_HOME=$DATA MIMOCODE_DISABLE_CLAUDE_IMPORT=1
    if [ "$HARNESS" = muse ]; then muse export --session "$THREAD" --out "$held/thread.json"
    else mimo export "$THREAD" > "$held/thread.json"; fi ) </dev/null >/dev/null 2>"$held/err"
  found=$?; why=$(sed 's/\x1b\[[0-9;]*m//g' "$held/err" | tr '\n' ' ' | cut -c1-300); rm -r -- "$held"
  [ $found -eq 0 ] || die "no $HARNESS thread $THREAD in this launch's data directory, so nothing was resumed; resume from the directory, --leg and --run it was launched with (its export: ${why:-no message})"
fi

if [ "$HARNESS" = codex ] && [ "$CMD" = launch ]; then
  # Mark the worktree trusted first. The grep guard is idempotent on purpose: duplicate
  # [projects] tables are invalid TOML.
  mkdir -p "$HOME/.codex"; touch "$HOME/.codex/config.toml"
  grep -qF "[projects.\"$CWD\"]" "$HOME/.codex/config.toml" \
    || printf '\n[projects."%s"]\ntrust_level = "trusted"\n' "$CWD" >> "$HOME/.codex/config.toml"
fi
CWD=$(CDPATH= cd -P -- "$CWD" && pwd -P) || die "cannot resolve $CWD"
CDPATH= cd -- "$CWD" || die "cannot enter $CWD"
# A harness whose prompt arrives on stdin reads it from the file, never from an inherited pipe.
if [ -n "$STDIN_FILE" ]; then exec < "$STDIN_FILE" || die "cannot read $STDIN_FILE"; fi
if [ -n "$REVIEW_PROMPT" ]; then
  rm -f -- "$REVIEW_PROMPT" || die "cannot remove the temporary MiMo review prompt: $REVIEW_PROMPT"
  REVIEW_PROMPT=""; trap - EXIT
fi
if [ "$CMD" = review ] && [ "$HARNESS" = codex ] && [ -n "$LAST" ]; then
  # Codex writes -o only on success, so a stale file from an earlier attempt is
  # removed after the cd, where a relative path resolves as the harness sees it.
  rm -f -- "$LAST" || die "cannot clear the codex review output file: $LAST"
fi
# The env file reaches the harness's environment only: the command above is already built.
# The host-provided event-stream path is not the env file's to change: it decides which
# session the export hook retains, so it is restored after sourcing.
if [ -n "${ENV_FILE:-}" ]; then
  saved_event_stream=${POSTMASTER_EVENT_STREAM:-}
  saved_launch_role=$LAUNCH_ROLE
  set -a; . "$ENV_FILE"; set +a
  POSTMASTER_EVENT_STREAM=$saved_event_stream
  LAUNCH_ROLE=$saved_launch_role
  export -n LAUNCH_ROLE
fi
unset POSTMASTER_LAUNCH_NAME POSTMASTER_LAUNCH_ROLE   # launch identity stays with postmaster, never the model
"${cmd[@]}"
rc=$?
# The session export is attempted on every run launch with a stream, including an
# empty one: a missing session is loud on stderr, never a silent skip. The launch
# still exits with the harness's status: a lane that did the work must not look
# failed because its session could not be retained.
if [ -n "$RUN" ] && [ -n "${POSTMASTER_EVENT_STREAM:-}" ]; then
  "$HERE/export-session.sh" "$RUN" "$NAME" "$HARNESS" "$CWD" "$POSTMASTER_EVENT_STREAM" "${DATA:-}" \
    || echo "launch: the harness exited $rc but its session was not exported" >&2
  record_role="" record_lane=""
  case $LAUNCH_ROLE in
    lane) record_role=workhorse; record_lane=$NAME ;;
    reviewer) record_role=reviewer; record_lane=$NAME ;;
    coachman)
      record_role=coachman
      record_lane=$LEG
      if [ -z "$record_lane" ] && [ "$NAME" != coachman_fallback ]; then record_lane=$NAME; fi
      ;;
  esac
  if [ -n "$record_role" ] && [ -n "$record_lane" ]; then
    bun "$HERE/usage.ts" record "$POSTMASTER_EVENT_STREAM" "$HARNESS" "$NAME" "$RUN" \
      --role "$record_role" --lane "$record_lane" \
      || echo "launch: the harness exited $rc but its usage was not recorded" >&2
  else
    echo "launch: the harness exited $rc but its usage was not recorded; launch role or lane is missing" >&2
  fi
fi
exit "$rc"
