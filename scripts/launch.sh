#!/usr/bin/env bash
# Launch or resume a lane or a role by name, from the config, in the exact form harnesses.md
# records for its harness. One command for every harness, so no form is ever copied by hand;
# this script and harnesses.md must agree, and a change to one is a change to both.
#
#   launch.sh form   <name> [--leg <leg>] [--run <dispatch>]
#   launch.sh launch <name> <cwd> <prompt-file> [--leg <leg>] [--last <file>] [--run <dispatch>]
#   launch.sh resume <name> <cwd> <thread-id> <prompt-file> [--leg <leg>] [--run <dispatch>]
#   launch.sh skill  <name> <skill> [--run <dispatch>]
#   launch.sh --self-test
#
# The config is the live one, ~/.postmaster/config.toml (POSTMASTER_CONFIG overrides the path),
# unless --run names the dispatch directory of the run being served. Then it is the config that
# run recorded at dispatch, `config` in <dispatch>/run.json (scripts/run-meta.sh): the live
# config is not read at all, and a run.json that is missing or unreadable is refused. Every
# launch and resume inside a run passes --run; the postmaster's own spawn and the config check
# before dispatch do not. The checks below apply to a recorded config as to the live one.
#
# <name> is a lane from [lanes.<name>], or `coachman`, `coachman_fallback` or `postmaster`
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
# The events stream goes to stdout; the caller redirects and backgrounds. --last names the file
# a harness writes its final message to, where the harness supports it (codex -o). `skill`
# prints the prompt that invokes the lane's harness's own skill (harnesses.md, Own review
# skills); `launch` runs it like any other prompt. The one skill is security-review.
#
#   exit 0  the form or the skill's prompt was printed, or the harness exited 0
#   exit 1  usage, config or run.json missing or unreadable, unknown name, a leg that is not
#           synthesis, review or ship, the coachman launched or resumed with no --leg, a
#           coachman or fallback on a lane's model, harness not on PATH, env_file missing, a
#           form this script does not have (muse; agy resume), or a skill that is not
#           security-review
#   exit 3  skill: the lane's harness has no such skill recorded
#   else    the harness's own exit code
set -uo pipefail
CONFIG=${POSTMASTER_CONFIG:-$HOME/.postmaster/config.toml}

if [ "${1:-}" = --self-test ]; then
  # Each control runs this script on a fixture config, with stub harnesses first on PATH.
  # `form` only prints, so nothing is launched. A run's record is written from a fixture by
  # run-meta.sh, as at dispatch, so what this script reads is what that one writes.
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
  [ -x "$tmp/bin/claude" ] && [ -x "$tmp/bin/pi" ] && [ -x "$tmp/bin/codex" ] || { echo "self-test: cannot write the stub harnesses"; exit 1; }
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
  record() {  # record <run> <fixture>: $tmp/<run>/run.json, recording that fixture as at dispatch
    mkdir -p "$tmp/$1" && POSTMASTER_CONFIG="$tmp/$2.toml" PATH="$tmp/bin:$PATH" \
      "$here/run-meta.sh" "$tmp/$1" "$tmp/repo" >/dev/null \
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
  mkdir "$tmp/no-record" "$tmp/garbled" "$tmp/unrecorded"
  printf '{"config": \n' > "$tmp/garbled/run.json"
  printf '{"run": "T-1"}\n' > "$tmp/unrecorded/run.json"

  echo "positive controls"
  for k in synthesis review ship; do
    runs_on "--leg $k runs on its own [team.coachman_legs] entry" legs "$k-model" form coachman --leg "$k"
  done
  runs_on "a leg with no entry runs on team.coachman" none coach-model form coachman --leg review
  runs_on "a lane runs on its own model" legs lane-model form one
  runs_on "a lane launches on a config the coachman refuses" old-bug lane-model form one
  runs_on "a launch with --leg synthesis runs on the synthesis entry" legs synthesis-model launch coachman "$tmp/wt" "$tmp/prompt.txt" --leg synthesis
  runs_on "a resume with --leg review runs on the review entry" legs review-model resume coachman "$tmp/wt" T-1 "$tmp/prompt.txt" --leg review
  runs_on "the fallback resumes on its own model, with no --leg" legs fallback-model resume coachman_fallback "$tmp/wt" T-1 "$tmp/prompt.txt"
  runs_on "form with no --leg shows team.coachman" legs coach-model form coachman
  carries "a lane's env file reaches the harness's environment" envfile "probe=reached" launch coachman "$tmp/wt" "$tmp/prompt.txt" --leg review
  runs_on "inside a run, a resume runs on the model the run recorded, not the live config's" edited review-model resume coachman "$tmp/wt" T-1 "$tmp/prompt.txt" --leg review --run "$tmp/run"
  runs_on "outside a run, the same resume runs on the live config's model" edited edited-model resume coachman "$tmp/wt" T-1 "$tmp/prompt.txt" --leg review
  run now resume one "$tmp/wt" T-1 "$tmp/prompt.txt" --run "$tmp/run-then"
  printed "inside a run, a lane resumes on the harness, model, effort and env file the run recorded" "--resume T-1 " "--model then-model " "--effort high " "probe=then"
  run now resume one "$tmp/wt" T-1 "$tmp/prompt.txt"
  printed "outside a run, the same resume takes all four from the live config" "--mode json " "--session T-1 " "--model now-model " "--thinking low " "probe=now"
  runs_on "inside a run the live config is not read: with none at all, a launch runs on the recorded model" nowhere synthesis-model launch coachman "$tmp/wt" "$tmp/prompt.txt" --leg synthesis --run "$tmp/run"
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
  refused "resuming the coachman with no --leg is refused, and nothing runs" legs "coachman needs --leg" resume coachman "$tmp/wt" T-1 "$tmp/prompt.txt"
  refused "launching the coachman with no --leg is refused, and nothing runs" legs "coachman needs --leg" launch coachman "$tmp/wt" "$tmp/prompt.txt"
  refused "inside a run with no run.json, a resume is refused though the live config would serve, and nothing runs" legs "no run.json in $tmp/no-record" resume coachman "$tmp/wt" T-1 "$tmp/prompt.txt" --leg review --run "$tmp/no-record"
  refused "inside a run whose run.json does not parse, a launch is refused, and nothing runs" legs "cannot read $tmp/garbled/run.json" launch one "$tmp/wt" "$tmp/prompt.txt" --run "$tmp/garbled"
  refused "a run.json that records no config is refused" legs "it records no config" launch one "$tmp/wt" "$tmp/prompt.txt" --run "$tmp/unrecorded"
  refused "an empty --run is refused, never read as outside a run" legs "--run needs a dispatch directory" resume coachman "$tmp/wt" T-1 "$tmp/prompt.txt" --leg review --run ""
  refused "a recorded config naming bug is refused, though the live config passes" legs "one leg now, review" resume coachman "$tmp/wt" T-1 "$tmp/prompt.txt" --leg review --run "$tmp/run-old-bug"
  refused "a recorded leg on a lane's model is refused, though the live config passes" legs "a lane's model" resume coachman "$tmp/wt" T-1 "$tmp/prompt.txt" --leg synthesis --run "$tmp/run-onlane"
  got=$(calls "$here/../skills/postmaster/coachman.md" "$here/../skills/postmaster/postmaster.md"); rc=$?
  out=$(printf '%s\n' "$got" | grep '^unrun '); err=""
  [ $rc -eq 0 ] && [ -z "$out" ] && printf '%s\n' "$got" | grep -q '^run .*/coachman\.md: ' \
    && printf '%s\n' "$got" | grep -q '^run .*/postmaster\.md: ' \
    && ok "no launch or resume in coachman.md or postmaster.md lacks --run <dispatch>" \
    || fail "no launch or resume in coachman.md or postmaster.md lacks --run <dispatch>"

  echo "skills"
  printf '[lanes.one]\nharness = "claude"\nmodel = "lane-model"\n\n[lanes.two]\nharness = "codex"\nmodel = "other-model"\n' > "$tmp/skills.toml"
  run skills skill one security-review
  [ $rc -eq 0 ] && [ "$out" = /security-review ] && ok "a claude lane's security review skill is /security-review" || fail "a claude lane's security review skill is /security-review"
  run skills skill two security-review
  [ $rc -eq 3 ] && [ -z "$out" ] && case $err in *"no security review skill"*) true ;; *) false ;; esac \
    && ok "a harness with no security review skill is exit 3, never a prompt" || fail "a harness with no security review skill is exit 3, never a prompt"
  refused "a skill that is not recorded is refused" skills "no such skill: code-review" skill one code-review

  echo
  [ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
  echo "self-test: $fails control(s) misbehaved"; exit 1
fi

die() { echo "launch: $*" >&2; exit 1; }
[ $# -ge 2 ] || die "usage: launch.sh form|launch|resume|skill <name> ... | --self-test"
CMD=$1; NAME=$2; shift 2
LEG=""; LAST=""; RUN=""; STDIN_FILE=""; args=()
while [ $# -gt 0 ]; do
  case $1 in
    --leg) [ $# -ge 2 ] || die "--leg needs a value"; LEG=$2; shift ;;
    --last) [ $# -ge 2 ] || die "--last needs a file"; LAST=$2; shift ;;
    --run) [ $# -ge 2 ] && [ -n "$2" ] || die "--run needs a dispatch directory"; RUN=$2; shift ;;
    *) args+=("$1") ;;
  esac
  shift
done
[ "$NAME" = coachman ] && [ "$CMD" != form ] && [ -z "$LEG" ] \
  && die "coachman needs --leg synthesis, review or ship to $CMD"

if [ -n "$RUN" ]; then
  SOURCE=${RUN%/}/run.json
  [ -f "$SOURCE" ] || die "no run.json in $RUN; inside a run, a launch or resume runs only on the config the run recorded at dispatch"
else
  SOURCE=$CONFIG
  [ -f "$SOURCE" ] || die "no config at $CONFIG (POSTMASTER_CONFIG overrides the path)"
fi
python3 -c 'import tomllib' 2>/dev/null || die "python3 with tomllib (3.11 or newer) is needed to read the config"
spec=$(python3 - "$SOURCE" "$NAME" "$LEG" "${RUN:+run}" <<'PY'
import json, re, sys, tomllib, shlex
path, name, leg, recorded = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] == "run"
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
          CWD='<cwd>'; PROMPT='<prompt-file>'; THREAD='<thread-id>'; PTEXT='$(cat <prompt-file>)' ;;
  launch) [ ${#args[@]} -eq 2 ] || die "launch needs <cwd> <prompt-file>"
          CWD=${args[0]}; PROMPT=${args[1]}; prompt_text ;;
  resume) [ ${#args[@]} -eq 3 ] || die "resume needs <cwd> <thread-id> <prompt-file>"
          CWD=${args[0]}; THREAD=${args[1]}; PROMPT=${args[2]}
          [ -n "$THREAD" ] || die "resume needs a thread id, and none was given"
          prompt_text ;;
  *) die "unknown command: $CMD" ;;
esac
[ "$CMD" = form ] || [ -d "$CWD" ] || die "no such directory: $CWD"
if [ "$HARNESS" = pi ] && [ "$CMD" != form ]; then
  prompt_dir=$(CDPATH= cd -P -- "$(dirname -- "$PROMPT")" && pwd -P) || die "cannot resolve prompt file: $PROMPT"
  PROMPT=$prompt_dir/$(basename "$PROMPT")
fi

cmd=()
case $HARNESS in
  codex)
    if [ "$CMD" = resume ]; then
      cmd=(codex exec resume "$THREAD" --dangerously-bypass-approvals-and-sandbox "$PTEXT")
    else
      cmd=(codex exec -C "$CWD" --json)
      [ -n "$LAST" ] && cmd+=(-o "$LAST")
      cmd+=(-m "$MODEL")
      [ -n "${EFFORT:-}" ] && cmd+=(-c "model_reasoning_effort=\"$EFFORT\"")
      cmd+=(--dangerously-bypass-approvals-and-sandbox)
      if [ "$CMD" = launch ] && ! git -C "$CWD" symbolic-ref -q HEAD >/dev/null 2>&1; then
        cmd+=(--skip-git-repo-check)   # a detached scratch
      fi
      cmd+=("$PTEXT")
    fi ;;
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
    if [ "$CMD" = resume ]; then cmd=(claude -p --resume "$THREAD" "$PTEXT")
    else cmd=(claude -p "$PTEXT"); fi
    cmd+=(--model "$MODEL")
    [ -n "${EFFORT:-}" ] && cmd+=(--effort "$EFFORT")
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
    die "muse adapter is incomplete (stream flag, bypass form, thread id, resume form); fill harnesses.md and this script from a trial run first" ;;
  *) die "no form for harness '$HARNESS'" ;;
esac

if [ "$CMD" = form ]; then
  show() { case $1 in '<'*'>'|'$(cat <prompt-file>)') printf '%s ' "$1" ;; *) printf '%q ' "$1" ;; esac; }
  printf 'cd '; show "$CWD"; printf '&& '
  for a in "${cmd[@]}"; do show "$a"; done
  [ -n "${STDIN_FILE:-}" ] && { printf '< '; show "$STDIN_FILE"; }
  echo
  exit 0
fi

if [ "$HARNESS" = codex ] && [ "$CMD" = launch ]; then
  # Mark the worktree trusted first. The grep guard is idempotent on purpose: duplicate
  # [projects] tables are invalid TOML.
  mkdir -p "$HOME/.codex"; touch "$HOME/.codex/config.toml"
  grep -qF "[projects.\"$CWD\"]" "$HOME/.codex/config.toml" \
    || printf '\n[projects."%s"]\ntrust_level = "trusted"\n' "$CWD" >> "$HOME/.codex/config.toml"
fi
CDPATH= cd -- "$CWD" || die "cannot enter $CWD"
# A harness whose prompt arrives on stdin reads it from the file, never from an inherited pipe.
if [ -n "$STDIN_FILE" ]; then exec < "$STDIN_FILE" || die "cannot read $STDIN_FILE"; fi
# The env file reaches the harness's environment only: the command above is already built.
if [ -n "${ENV_FILE:-}" ]; then set -a; . "$ENV_FILE"; set +a; fi
unset POSTMASTER_LAUNCH_NAME   # the thread's own launches are named by their own host.sh call
exec "${cmd[@]}"
