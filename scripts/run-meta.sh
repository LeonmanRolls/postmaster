#!/usr/bin/env bash
# Write a run's fixed facts to <dispatch>/run.json, once, at dispatch. Written once and never
# edited: the manifest is the run's current state, this is what the run started from.
#
#   run-meta.sh <dispatch> <repo>   <repo> is the target project's checkout
#   run-meta.sh --self-test
#
# Records when it was written; the run and project; the target repo's HEAD and branch; the
# postmaster commit that dispatched it, and whether that checkout had uncommitted changes,
# since a run keeps the runbooks it started with; the coachman contract version; the config in
# force, as it was; and the version each harness named in that config reports. Env files are
# named by the config, never read. A run.json that already exists is left alone.
#
#   exit 0  written, or already there
#   exit 1  usage, no such dispatch directory or repo, no config, or the file could not be written
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
TOOL=$(dirname "$HERE")
CONFIG=${POSTMASTER_CONFIG:-$HOME/.postmaster/config.toml}

meta() {  # meta <dispatch> <repo>
  local d=$1 repo=$2
  [ -d "$d" ] || { echo "run-meta: no such dispatch directory: $d" >&2; return 1; }
  git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || { echo "run-meta: not a git repo: $repo" >&2; return 1; }
  [ -f "$CONFIG" ] || { echo "run-meta: no config at $CONFIG" >&2; return 1; }
  [ -e "$d/run.json" ] && { echo "run-meta: $d/run.json already written; left alone"; return 0; }
  python3 - "$d" "$repo" "$TOOL" "$CONFIG" <<'PY' || { echo "run-meta: could not write $d/run.json" >&2; return 1; }
import datetime as dt, json, os, pathlib, shutil, subprocess, sys, tempfile, tomllib
d, repo, tool, config = map(pathlib.Path, sys.argv[1:5])

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
    "coachman_contract": 2,
    "project": d.resolve().parent.name,
    "run": d.resolve().name,
    "target": {"head": git(repo, "rev-parse", "HEAD"), "branch": git(repo, "symbolic-ref", "--short", "-q", "HEAD")},
    "postmaster": {"commit": git(tool, "rev-parse", "HEAD"),
                   "uncommitted_changes": bool(git(tool, "status", "--porcelain"))},
    "config": cfg,
    "harness_versions": {h: version(h) for h in sorted(harnesses)},
}
fd, tmp = tempfile.mkstemp(dir=d); os.close(fd)
with open(tmp, "w") as f:
    json.dump(record, f, indent=2, default=str); f.write("\n")
os.replace(tmp, d / "run.json")
print("run-meta: wrote %s (postmaster %s)" % (d / "run.json", (record["postmaster"]["commit"] or "?")[:12]))
PY
}

if [ "${1:-}" != "--self-test" ]; then
  [ $# -eq 2 ] || { echo "usage: run-meta.sh <dispatch> <repo> | --self-test" >&2; exit 1; }
  meta "$1" "$2"; exit $?
fi

# --- self-test ----------------------------------------------------------------------------
tmp=$(mktemp -d) || exit 1
trap 'rm -r -- "$tmp" </dev/null 2>/dev/null' EXIT
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

echo "positive controls"
meta "$d" "$repo" >/dev/null && ok "run.json is written" || fail "run.json is written"
check "it names the postmaster commit"            "r['postmaster']['commit'] == '$(git -C "$TOOL" rev-parse HEAD)'"
check "it records the current coachman contract"  "r['coachman_contract'] == 2"
check "it names the target's HEAD and branch"     "r['target'] == {'head': '$(git -C "$repo" rev-parse HEAD)', 'branch': 'main'}"
check "it keeps the config as it was"             "r['config']['lanes']['one']['model'] == 'm1' and r['config']['team']['workhorses'] == ['one','two']"
check "it records each harness's version"         "r['harness_versions']['bash'].startswith('GNU bash')"
check "a harness not installed says so"           "r['harness_versions']['no-such-harness-xyz'] == 'not on PATH'"
check "an env file is named, never read"          "r['config']['lanes']['one']['env_file'] == '~/somewhere/secret.env'"

echo "negative controls"
cp "$d/run.json" "$tmp/before.json"; sleep 1; meta "$d" "$repo" >/dev/null
cmp -s "$d/run.json" "$tmp/before.json" && ok "a second call leaves run.json alone" || fail "a second call leaves run.json alone"
rm -- "$d/run.json"; CONFIG="$tmp/none.toml"; meta "$d" "$repo" >/dev/null 2>&1; rc=$?; CONFIG=$POSTMASTER_CONFIG
[ $rc -eq 1 ] && [ ! -e "$d/run.json" ] && ok "no config is refused, and nothing is written" || fail "no config is refused, and nothing is written (exit $rc)"
meta "$d" "$tmp/not-a-repo" >/dev/null 2>&1; rc=$?
[ $rc -eq 1 ] && ok "a target that is not a repo is refused" || fail "a target that is not a repo is refused (exit $rc)"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
