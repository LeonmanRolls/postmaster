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
#   launch.sh --self-test
#
# The config is the live one, ~/.postmaster/config.toml (POSTMASTER_CONFIG overrides the path),
# unless --run names the dispatch directory of the run being served. Then it is the config that
# run recorded at dispatch, `config` in <dispatch>/run.json (scripts/run-meta.sh): the live
# config is not read at all, and a run.json that is missing or unreadable is refused. Every
# launch and resume inside a run passes --run; the postmaster's own spawn and the config check
# before dispatch do not. A run launch exports its durable session beside the events stream;
# a launch whose export fails says so loudly and still exits with the harness's status.
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
#   exit 0  the forms or the skill's prompt were printed, or the harness exited 0
#   exit 1  usage, config or run.json missing or unreadable, unknown name, a leg that is not
#           synthesis, review or ship, the coachman launched or resumed with no --leg, a
#           coachman or fallback on a lane's model, harness not on PATH, env_file missing, a
#           form this script does not have (agy resume), a skill that is not security-review,
#           or a muse or mimo resume of a thread the launch's data directory does not hold
#   exit 3  skill or review: the lane's harness has no such review form recorded
#   else    the harness's own exit code
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
CONFIG=${POSTMASTER_CONFIG:-$HOME/.postmaster/config.toml}

if [ "${1:-}" = --self-test ]; then
  # Each control runs this script on a fixture config, with stub harnesses first on PATH.
  # `form` only prints, so nothing is launched. A run's record is written from a fixture by
  # run-meta.sh, as at dispatch, so what this script reads is what that one writes.
  unset POSTMASTER_LAUNCH_NAME   # a gate run through host.sh run inherits one; a control that needs one sets its own
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
  POSTMASTER_EVENT_STREAM="$agy_events" POSTMASTER_CONFIG="$tmp/agy-run.toml" PATH="$tmp/bin:$PATH" \
    "$self" launch g "$tmp/wt" "$tmp/prompt.txt" --run "$agy_dispatch" >"$agy_events" 2>"$tmp/err"; rc=$?; err=$(cat "$tmp/err"); out=$(cat "$agy_events")
  [ "$rc" -eq 0 ] && [ "$out" = '{"conversationId":"thread-agy"}' ] \
    && cmp -s "$agy_events" "$agy_dispatch/sessions/g/thread-agy.events.jsonl" \
    && ok "a run launch exports its durable session beside the harness event stream" \
    || fail "a run launch exports its durable session beside the harness event stream"
  sessions_before=$(ls "$agy_dispatch/sessions/g" | wc -l)
  printf '#!/bin/sh\nexit 0\n' > "$tmp/bin/agy"; chmod +x "$tmp/bin/agy"
  empty_events=$agy_dispatch/logs/g-empty.jsonl; : > "$empty_events"
  POSTMASTER_EVENT_STREAM="$empty_events" POSTMASTER_CONFIG="$tmp/agy-run.toml" PATH="$tmp/bin:$PATH" \
    "$self" launch g "$tmp/wt" "$tmp/prompt.txt" --run "$agy_dispatch" >"$empty_events" 2>"$tmp/err"; rc=$?; err=$(cat "$tmp/err")
  [ "$rc" -eq 0 ] && [ ! -s "$empty_events" ] && printf '%s' "$err" | grep -q "its session was not exported" \
    && [ "$(ls "$agy_dispatch/sessions/g" | wc -l)" = "$sessions_before" ] \
    && ok "an empty event stream is a loud missed export, not a silent skip" \
    || fail "an empty event stream is a loud missed export, not a silent skip (exit $rc)" "$err"
  printf '#!/bin/sh\nprintf "{\\"nope\\":1}\\n"\nexit 0\n' > "$tmp/bin/agy"; chmod +x "$tmp/bin/agy"
  POSTMASTER_EVENT_STREAM="$agy_events" POSTMASTER_CONFIG="$tmp/agy-run.toml" PATH="$tmp/bin:$PATH" \
    "$self" launch g "$tmp/wt" "$tmp/prompt.txt" --run "$agy_dispatch" >"$agy_events" 2>"$tmp/err"; rc=$?; err=$(cat "$tmp/err")
  [ "$rc" -eq 0 ] && printf '%s' "$err" | grep -q "its session was not exported" \
    && ok "a failed export still exits with the harness's status" \
    || fail "a failed export still exits with the harness's status (exit $rc)" "$err"
  printf '#!/bin/sh\nprintf "{\\"conversationId\\":\\"thread-rc\\"}\\n"\nexit 3\n' > "$tmp/bin/agy"; chmod +x "$tmp/bin/agy"
  rc_events=$agy_dispatch/logs/g-rc.jsonl
  POSTMASTER_EVENT_STREAM="$rc_events" POSTMASTER_CONFIG="$tmp/agy-run.toml" PATH="$tmp/bin:$PATH" \
    "$self" launch g "$tmp/wt" "$tmp/prompt.txt" --run "$agy_dispatch" >"$rc_events" 2>"$tmp/err"; rc=$?
  [ "$rc" -eq 3 ] && cmp -s "$rc_events" "$agy_dispatch/sessions/g/thread-rc.events.jsonl" \
    && ok "a harness failure keeps its exit when the export succeeds" \
    || fail "a harness failure keeps its exit when the export succeeds (exit $rc)" "$(cat "$tmp/err")"
  printf '[lanes.g]\nharness = "agy"\nmodel = "agy-model"\nenv_file = "%s"\n' "$tmp/poison.env" > "$tmp/agy-env.toml"
  record run-agy-env agy-env
  env_dispatch=$tmp/repo/.postmaster/runs/run-agy-env
  mkdir -p "$env_dispatch/logs"
  printf '{"conversationId":"thread-decoy"}\n' > "$env_dispatch/logs/g-decoy.jsonl"
  printf 'POSTMASTER_EVENT_STREAM="%s"\n' "$env_dispatch/logs/g-decoy.jsonl" > "$tmp/poison.env"
  printf '#!/bin/sh\nprintf "{\\"conversationId\\":\\"thread-real\\"}\\n"\nexit 0\n' > "$tmp/bin/agy"; chmod +x "$tmp/bin/agy"
  real_events=$env_dispatch/logs/g-real.jsonl
  POSTMASTER_EVENT_STREAM="$real_events" POSTMASTER_CONFIG="$tmp/agy-env.toml" PATH="$tmp/bin:$PATH" \
    "$self" launch g "$tmp/wt" "$tmp/prompt.txt" --run "$env_dispatch" >"$real_events" 2>"$tmp/err"; rc=$?
  [ "$rc" -eq 0 ] && cmp -s "$real_events" "$env_dispatch/sessions/g/thread-real.events.jsonl" \
    && [ ! -e "$env_dispatch/sessions/g/thread-decoy.events.jsonl" ] \
    && ok "a lane env file cannot redirect the session export" \
    || fail "a lane env file cannot redirect the session export (exit $rc)" "$(cat "$tmp/err")"
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
  [ $rc -eq 0 ] && [ -z "$out" ] && printf '%s\n' "$got" | grep -q '^run .*/coachman\.md: ' \
    && printf '%s\n' "$got" | grep -q '^run .*/postmaster\.md: ' \
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
[ $# -ge 2 ] || die "usage: launch.sh form|launch|review|resume|skill <name> ... | --self-test"
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
  set -a; . "$ENV_FILE"; set +a
  POSTMASTER_EVENT_STREAM=$saved_event_stream
fi
unset POSTMASTER_LAUNCH_NAME   # the thread's own launches are named by their own host.sh call
"${cmd[@]}"
rc=$?
# The session export is attempted on every run launch with a stream, including an
# empty one: a missing session is loud on stderr, never a silent skip. The launch
# still exits with the harness's status: a lane that did the work must not look
# failed because its session could not be retained.
if [ -n "$RUN" ] && [ -n "${POSTMASTER_EVENT_STREAM:-}" ]; then
  "$HERE/export-session.sh" "$RUN" "$NAME" "$HARNESS" "$CWD" "$POSTMASTER_EVENT_STREAM" "${DATA:-}" \
    || echo "launch: the harness exited $rc but its session was not exported" >&2
fi
exit "$rc"
