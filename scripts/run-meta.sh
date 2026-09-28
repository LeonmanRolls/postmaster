#!/usr/bin/env bash
# Write a run's fixed facts to <dispatch>/run.json, once, at dispatch, and pin the run to the
# postmaster commit it was dispatched from. Written once and never edited: the manifest is the
# run's current state, this is what the run started from and the checkout it runs on.
#
#   run-meta.sh <dispatch> <repo>   <repo> is the target project's checkout; also cuts the pin
#   run-meta.sh pin <repo> <commit> a shared checkout of <repo> at <commit> under $POSTMASTER_TOOLS
#   run-meta.sh path <dispatch>     print the run's pinned postmaster checkout
#   run-meta.sh check <dispatch>    the pin still serves the versions of its dispatch commit
#   run-meta.sh release <dispatch>  drop this run's claim; remove the pin when no run is in flight
#   run-meta.sh --self-test
#
# Records when it was written; the run and project; the target repo's HEAD and branch; the
# postmaster commit that dispatched it, and whether that checkout had uncommitted changes,
# since a run keeps the runbooks it started with; the pinned checkout of that commit, which
# every leg launch, resume and takeover runs from (the waybill's `tool:`); the config in force,
# as it was; and the version each harness named in that config reports. Env files are named by
# the config, never read. A run.json that already exists is left alone.
#
# The pin is a detached worktree of the postmaster repo at the dispatch commit, under
# $POSTMASTER_TOOLS (default ~/.postmaster/tools), one directory per commit so every run
# dispatched at that commit shares it. It is the run's `<tool>`: its host.sh, its launch.sh and
# the runbooks its prompts name. The live checkout still serves the front door and the
# postmaster's own supervision.
#
# check is the control that a run still runs on its own versions after main has moved on: it
# reads the pin's HEAD and tree against the commit run.json records. release removes the pin
# only when no run whose run.json names it is still in flight (manifest stage other than done
# or abandoned). The postmaster releases after it closes or abandons a run, never before the
# last leg's process has exited. A run with no checkout recorded (an old unpinned waybill) is
# left alone by path, check and release.
#
#   exit 0  written, already there, a pin made or reused, path printed, the pin still serves
#           its commit, or the pin was released or kept as the in-flight runs require
#   exit 1  usage, no such dispatch directory or repo or commit, no config, the file could not
#           be written, no pin or it does not serve its commit, or git could not make or remove it
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
TOOL=$(dirname "$HERE")
CONFIG=${POSTMASTER_CONFIG:-$HOME/.postmaster/config.toml}
TOOLS=${POSTMASTER_TOOLS:-$HOME/.postmaster/tools}

pin() {  # pin <repo> <commit>: a checkout of <repo> at <commit> under $TOOLS, shared per commit
  local repo=$1 want=$2 commit dest
  commit=$(git -C "$repo" rev-parse --verify -q "$want^{commit}") \
    || { echo "run-meta: no such commit in $repo: $want" >&2; return 1; }
  dest="$TOOLS/$commit"
  mkdir -p "$TOOLS" || { echo "run-meta: could not make $TOOLS" >&2; return 1; }
  # git worktree add locks the repo, so concurrent cuts of one commit must take turns.
  (
    exec 9>"$TOOLS/.pin.lock" && flock 9 || { echo "run-meta: could not lock $TOOLS" >&2; exit 1; }
    if [ -e "$dest" ]; then
      at=$(git -C "$dest" rev-parse --verify -q HEAD 2>/dev/null) \
        || { echo "run-meta: $dest exists but is not a git checkout; left alone" >&2; exit 1; }
      [ "$at" = "$commit" ] \
        || { echo "run-meta: $dest is at ${at:0:12}, not ${commit:0:12}; left alone" >&2; exit 1; }
      common=$(git -C "$dest" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || common=""
      want_common=$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || want_common=""
      [ -n "$common" ] && [ -n "$want_common" ] && [ "$common" = "$want_common" ] \
        || { echo "run-meta: $dest is not a checkout of $repo; left alone" >&2; exit 1; }
      printf '%s\n' "$dest"
      exit 0
    fi
    git -C "$repo" worktree add --detach "$dest" "$commit" >/dev/null 2>&1 \
      || { echo "run-meta: git could not create $dest at $commit" >&2; exit 1; }
    printf '%s\n' "$dest"
  )
}

field() {  # field <run.json> <key>  the postmaster.<key> of a run.json
  python3 -c 'import json,sys; r=json.load(open(sys.argv[1])).get("postmaster") or {}; print(r.get(sys.argv[2]) or "")' \
    "$1" "$2" 2>/dev/null
}

path_of() {  # path_of <dispatch>: the pinned checkout run.json records
  local d=$1 checkout
  [ -f "$d/run.json" ] || { echo "run-meta: no run.json in $d" >&2; return 1; }
  checkout=$(field "$d/run.json" checkout) \
    || { echo "run-meta: could not read $d/run.json" >&2; return 1; }
  [ -n "$checkout" ] || { echo "run-meta: $d/run.json records no pinned checkout" >&2; return 1; }
  printf '%s\n' "$checkout"
}

check_pin() {  # check_pin <dispatch>: the pin still serves the versions of its dispatch commit
  local d=$1 checkout commit at dirty
  checkout=$(path_of "$d") || return 1
  commit=$(field "$d/run.json" commit) || return 1
  [ -n "$commit" ] || { echo "run-meta: $d/run.json records no postmaster commit" >&2; return 1; }
  [ -d "$checkout" ] || { echo "run-meta: no pinned checkout at $checkout" >&2; return 1; }
  at=$(git -C "$checkout" rev-parse --verify -q HEAD 2>/dev/null) \
    || { echo "run-meta: $checkout is not a git checkout" >&2; return 1; }
  [ "$at" = "$commit" ] \
    || { echo "run-meta: $checkout is at ${at:0:12}, not the recorded ${commit:0:12}" >&2; return 1; }
  dirty=$(git -C "$checkout" status --porcelain 2>/dev/null) \
    || { echo "run-meta: could not read $checkout" >&2; return 1; }
  [ -z "$dirty" ] \
    || { echo "run-meta: $checkout is not clean at ${commit:0:12}; it does not serve that commit's versions" >&2; return 1; }
  return 0
}

in_flight() {  # in_flight <runs-root> <checkout>: yes when some run still uses this pin
  local root=$1 checkout=$2 d stage
  for d in "$root"/*/*/; do
    [ -f "$d/run.json" ] || continue
    [ "$(field "$d/run.json" checkout)" = "$checkout" ] || continue
    stage=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("stage") or "")' \
      "$d/manifest.json" 2>/dev/null) || stage=""
    case $stage in
      done|abandoned) ;;
      *) return 0 ;;
    esac
  done
  return 1
}

release_pin() {  # release_pin <dispatch>: remove the pin when no run in flight uses it
  local d=$1 checkout root common tools
  [ -f "$d/run.json" ] || { echo "run-meta: no run.json in $d" >&2; return 1; }
  checkout=$(field "$d/run.json" checkout) || return 1
  [ -n "$checkout" ] || { echo "run-meta: $d/run.json records no pinned checkout; nothing to release"; return 0; }
  [ -d "$checkout" ] || { echo "run-meta: no pinned checkout at $checkout; nothing to release"; return 0; }
  tools=$(CDPATH= cd -P -- "$TOOLS" 2>/dev/null && pwd -P) || tools="$TOOLS"
  case $checkout in
    "$tools"/*) ;;
    *) echo "run-meta: $checkout is not a pin under $TOOLS; left alone"; return 1 ;;
  esac
  root=$(CDPATH= cd -P -- "$d/../.." 2>/dev/null && pwd -P) || root=""
  if [ -n "$root" ] && in_flight "$root" "$checkout"; then
    echo "run-meta: kept $checkout; another run in flight still uses it"
    return 0
  fi
  common=$(git -C "$checkout" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) \
    || { echo "run-meta: could not read $checkout" >&2; return 1; }
  (
    exec 9>"$TOOLS/.pin.lock" && flock 9 || { echo "run-meta: could not lock $TOOLS" >&2; exit 1; }
    git --git-dir="$common" worktree remove "$checkout" >/dev/null 2>&1 \
      || { echo "run-meta: git could not remove $checkout" >&2; exit 1; }
    echo "run-meta: removed $checkout"
  )
}

meta() {  # meta <dispatch> <repo>
  local d=$1 repo=$2 commit checkout
  [ -d "$d" ] || { echo "run-meta: no such dispatch directory: $d" >&2; return 1; }
  git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || { echo "run-meta: not a git repo: $repo" >&2; return 1; }
  [ -f "$CONFIG" ] || { echo "run-meta: no config at $CONFIG" >&2; return 1; }
  [ -e "$d/run.json" ] && { echo "run-meta: $d/run.json already written; left alone"; return 0; }
  commit=$(git -C "$TOOL" rev-parse HEAD) || { echo "run-meta: no commit in $TOOL" >&2; return 1; }
  checkout=$(pin "$TOOL" "$commit") || return 1
  python3 - "$d" "$repo" "$TOOL" "$CONFIG" "$checkout" <<'PY' || { echo "run-meta: could not write $d/run.json" >&2; return 1; }
import datetime as dt, json, os, pathlib, shutil, subprocess, sys, tempfile, tomllib
d, repo, tool, config, checkout = map(pathlib.Path, sys.argv[1:6])

def git(where, *args):
    r = subprocess.run(["git", "-C", str(where), *args], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None

def version(harness):
    if not shutil.which(harness):
        return "not on PATH"
    try:
        r = subprocess.run([harness, "--version"], capture_output=True, text=True, timeout=15)
        out = (r.stdout or r.stderr).strip().splitlines()
        return out[0] if out else "no version output"
    except (subprocess.TimeoutExpired, OSError) as e:
        return "no version: %s" % type(e).__name__

cfg = tomllib.load(open(config, "rb"))
harnesses = set()
for lane in (cfg.get("lanes") or {}).values():
    if lane.get("harness"): harnesses.add(lane["harness"])
team = cfg.get("team") or {}
for role in ("coachman", "coachman_fallback", "postmaster"):
    if isinstance(team.get(role), dict) and team[role].get("harness"): harnesses.add(team[role]["harness"])
for leg in (team.get("coachman_legs") or {}).values():
    if isinstance(leg, dict) and leg.get("harness"): harnesses.add(leg["harness"])

record = {
    "written": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "project": d.resolve().parent.name,
    "run": d.resolve().name,
    "target": {"head": git(repo, "rev-parse", "HEAD"), "branch": git(repo, "symbolic-ref", "--short", "-q", "HEAD")},
    "postmaster": {"commit": git(tool, "rev-parse", "HEAD"),
                   "uncommitted_changes": bool(git(tool, "status", "--porcelain")),
                   "checkout": str(checkout)},
    "config": cfg,
    "harness_versions": {h: version(h) for h in sorted(harnesses)},
}
fd, tmp = tempfile.mkstemp(dir=d); os.close(fd)
with open(tmp, "w") as f:
    json.dump(record, f, indent=2, default=str); f.write("\n")
os.replace(tmp, d / "run.json")
print("run-meta: wrote %s (postmaster %s, pinned at %s)" % (d / "run.json", (record["postmaster"]["commit"] or "?")[:12], checkout))
PY
}

usage() { echo "usage: run-meta.sh <dispatch> <repo> | pin <repo> <commit> | path <dispatch> | check <dispatch> | release <dispatch> | --self-test" >&2; exit 1; }
case "${1:-}" in
  --self-test) [ $# -eq 1 ] || usage ;;
  pin)     [ $# -eq 3 ] || usage; pin "$2" "$3"; exit $? ;;
  path)    [ $# -eq 2 ] || usage; path_of "$2"; exit $? ;;
  check)   [ $# -eq 2 ] || usage; check_pin "$2"; exit $? ;;
  release) [ $# -eq 2 ] || usage; release_pin "$2"; exit $? ;;
  *)       [ $# -eq 2 ] || usage; meta "$1" "$2"; exit $? ;;
esac

# --- self-test ----------------------------------------------------------------------------
tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
export POSTMASTER_TOOLS="$tmp/tools"; TOOLS=$POSTMASTER_TOOLS
d="$tmp/project/RUN-1"; repo="$tmp/target"; mkdir -p "$d" "$repo"
git -C "$repo" init -q -b main && git -C "$repo" -c user.name=t -c user.email=t@t commit -q --allow-empty -m first
cat > "$tmp/config.toml" <<'EOF'
[lanes.one]
harness = "bash"
model = "m1"
env_file = "~/somewhere/secret.env"
[lanes.two]
harness = "no-such-harness-xyz"
model = "m2"
[team]
workhorses = ["one", "two"]
coachman = { harness = "bash", model = "judge" }
EOF
export POSTMASTER_CONFIG="$tmp/config.toml"; CONFIG=$POSTMASTER_CONFIG
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; fails=$((fails+1)); }
check() { python3 -c "import json,sys; r=json.load(open('$d/run.json')); sys.exit(0 if ($2) else 1)" 2>/dev/null && ok "$1" || fail "$1"; }
try() { out=$("$0" "$@" 2>&1); rc=$?; }

echo "positive controls"
meta "$d" "$repo" >/dev/null && ok "run.json is written" || fail "run.json is written"
check "it names the postmaster commit"            "r['postmaster']['commit'] == '$(git -C "$TOOL" rev-parse HEAD)'"
check "it names the target's HEAD and branch"     "r['target'] == {'head': '$(git -C "$repo" rev-parse HEAD)', 'branch': 'main'}"
check "it keeps the config as it was"             "r['config']['lanes']['one']['model'] == 'm1' and r['config']['team']['workhorses'] == ['one','two']"
check "it records each harness's version"         "r['harness_versions']['bash'].startswith('GNU bash')"
check "a harness not installed says so"           "r['harness_versions']['no-such-harness-xyz'] == 'not on PATH'"
check "an env file is named, never read"          "r['config']['lanes']['one']['env_file'] == '~/somewhere/secret.env'"
check "it names the pinned checkout"              "r['postmaster']['checkout'] == '$TOOLS/$(git -C "$TOOL" rev-parse HEAD)'"
try path "$d"
[ $rc -eq 0 ] && [ "$out" = "$TOOLS/$(git -C "$TOOL" rev-parse HEAD)" ] && ok "path prints the pin" \
  || fail "path prints the pin" "$out"
try check "$d"
[ $rc -eq 0 ] && ok "check passes a pin that serves its commit" || fail "check passes a pin that serves its commit" "$out"
shared="$tmp/project/RUN-2"; mkdir -p "$shared"
meta "$shared" "$repo" >/dev/null
try path "$shared"
[ $rc -eq 0 ] && [ "$out" = "$TOOLS/$(git -C "$TOOL" rev-parse HEAD)" ] \
  && ok "a second run at the same commit shares the pin" || fail "a second run at the same commit shares the pin" "$out"

# AC3: a run dispatched at one commit still serves its versions after main moves on.
# The identical command is `check`; the versions themselves are read with one file read.
fake=$tmp/fake-tool
git -C "$tmp" init -q -b main "$fake"
git -C "$fake" config user.name t; git -C "$fake" config user.email t@t
mkdir -p "$fake/skills/postmaster" "$fake/scripts"
printf '# coachman MARKER=A\n' > "$fake/skills/postmaster/coachman.md"
printf '# foo MARKER=A\n' > "$fake/scripts/foo.sh"
git -C "$fake" add -A && git -C "$fake" commit -qm A
commitA=$(git -C "$fake" rev-parse HEAD)
pinA=$(pin "$fake" "$commitA") || fail "a pin of a tool repo at A is cut"
printf '# coachman MARKER=B\n' > "$fake/skills/postmaster/coachman.md"
printf '# foo MARKER=B\n' > "$fake/scripts/foo.sh"
git -C "$fake" add -A && git -C "$fake" commit -qm B
run_pinned="$tmp/project/RUN-PINNED"; run_live="$tmp/project/RUN-LIVE"
mkdir -p "$run_pinned" "$run_live"
for pair in "$run_pinned:$pinA:$commitA" "$run_live:$fake:$commitA"; do
  dd=${pair%%:*}; rest=${pair#*:}; co=${rest%%:*}; cm=${rest#*:}
  printf '{"postmaster": {"commit": "%s", "checkout": "%s"}, "stage": "synthesis"}\n' "$cm" "$co" > "$dd/run.json"
  printf '{"stage": "synthesis"}\n' > "$dd/manifest.json"
done
marker_of() { grep -o 'MARKER=.' "$1/skills/postmaster/coachman.md" | head -1; }
got=$(marker_of "$pinA"); want=$(marker_of "$fake")
[ "$got" = "MARKER=A" ] && [ "$want" = "MARKER=B" ] \
  && ok "after main moved on, the pin still reads A while main reads B (marker_of)" \
  || fail "after main moved on, the pin still reads A while main reads B (marker_of)" "pin=$got main=$want"
try check "$run_pinned"
[ $rc -eq 0 ] && ok "check passes the run pinned at A" || fail "check passes the run pinned at A" "$out"
try check "$run_live"
[ $rc -eq 1 ] && ok "check fails the run pointed at main after it moved on (identical command)" \
  || fail "check fails the run pointed at main after it moved on (identical command)" "$out"
printf 'drift\n' >> "$pinA/skills/postmaster/coachman.md"
try check "$run_pinned"
[ $rc -eq 1 ] && ok "check fails a pin that no longer serves its commit" \
  || fail "check fails a pin that no longer serves its commit" "$out"
git -C "$pinA" checkout -q -- skills/postmaster/coachman.md

echo "negative controls"
cp "$d/run.json" "$tmp/before.json"; sleep 1; meta "$d" "$repo" >/dev/null
cmp -s "$d/run.json" "$tmp/before.json" && ok "a second call leaves run.json alone" || fail "a second call leaves run.json alone"
rm -- "$d/run.json"; CONFIG="$tmp/none.toml"; meta "$d" "$repo" >/dev/null 2>&1; rc=$?; CONFIG=$POSTMASTER_CONFIG
[ $rc -eq 1 ] && [ ! -e "$d/run.json" ] && ok "no config is refused, and nothing is written" || fail "no config is refused, and nothing is written (exit $rc)"
meta "$d" "$tmp/not-a-repo" >/dev/null 2>&1; rc=$?
[ $rc -eq 1 ] && ok "a target that is not a repo is refused" || fail "a target that is not a repo is refused (exit $rc)"
try path "$tmp/project/no-such-run"
[ $rc -eq 1 ] && ok "path on a run with no run.json is refused" || fail "path on a run with no run.json is refused" "$out"
try pin "$fake" no-such-commit
[ $rc -eq 1 ] && ok "a commit the repo does not have is refused, and no pin is cut" \
  || fail "a commit the repo does not have is refused, and no pin is cut" "$out"
mkdir -p "$tmp/tools/$commitA-taken" && printf 'keep\n' > "$tmp/tools/$commitA-taken/mine.txt"
# AC4: release keeps a pin another in-flight run uses, and removes it once none does.
# RUN-PINNED and a third run share pinA; RUN-LIVE is the negative control that already moved.
run_third="$tmp/project/RUN-THIRD"; mkdir -p "$run_third"
printf '{"postmaster": {"commit": "%s", "checkout": "%s"}}\n' "$commitA" "$pinA" > "$run_third/run.json"
printf '{"stage": "shipping"}\n' > "$run_third/manifest.json"
try release "$run_pinned"
[ $rc -eq 0 ] && grep -q "kept" <<<"$out" && [ -d "$pinA" ] \
  && ok "release keeps the pin while another run in flight still uses it" || fail "release keeps the pin while another run in flight still uses it" "$out"
printf '{"stage": "done"}\n' > "$run_third/manifest.json"
try release "$run_pinned"
[ $rc -eq 0 ] && grep -q "kept" <<<"$out" && [ -d "$pinA" ] \
  && ok "release keeps the pin while its own run is still in flight" || fail "release keeps the pin while its own run is still in flight" "$out"
printf '{"stage": "done"}\n' > "$run_pinned/manifest.json"
try release "$run_pinned"
[ $rc -eq 0 ] && grep -q "removed" <<<"$out" && [ ! -e "$pinA" ] \
  && ok "release removes the pin once no run in flight uses it" || fail "release removes the pin once no run in flight uses it" "$out"
try release "$run_pinned"
[ $rc -eq 0 ] && ok "release again is a no-op" || fail "release again is a no-op" "$out"
noco="$tmp/project/RUN-OLD"; mkdir -p "$noco"
printf '{"postmaster": {"commit": "abc"}}\n' > "$noco/run.json"
try release "$noco"
[ $rc -eq 0 ] && ok "release of a run with no pinned checkout is a no-op" \
  || fail "release of a run with no pinned checkout is a no-op" "$out"
meta "$d" "$repo" >/dev/null
try check "$d"
[ $rc -eq 0 ] && ok "check still passes the run that shares the live tool pin" \
  || fail "check still passes the run that shares the live tool pin" "$out"
# Concurrent cuts of one commit share one pin; the loser reuses the winner's checkout.
race="$tmp/tools/$commitA"
rm -rf "$race"
( pin "$fake" "$commitA" >/dev/null 2>&1 ) &
( pin "$fake" "$commitA" >/dev/null 2>&1 ) &
wait
[ -d "$race" ] && [ "$(git -C "$race" rev-parse HEAD 2>/dev/null)" = "$commitA" ] \
  && ok "two concurrent cuts of one commit end with one shared pin" \
  || fail "two concurrent cuts of one commit end with one shared pin"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
