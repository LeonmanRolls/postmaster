#!/usr/bin/env bash
# Decide whether the current session can be the postmaster for the selected project.
# The session reports its harness, model, working directory and terminal presence; the
# configured postmaster and the two repository roots are checked here.
#
#   postmaster-route.sh <harness> <model> <working-directory> <person-at-terminal> <target>
#   postmaster-route.sh --self-test
#
# person-at-terminal is `yes` or `no`. The optional POSTMASTER_CONFIG environment variable
# selects the config, as it does for the other scripts; otherwise ~/.postmaster/config.toml
# is read.
#
#   exit 0  `self: ...` or `spawn: ...` printed to stdout
#   exit 1  the session report, git repositories, or config could not be read
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
SELF="$HERE/postmaster-route.sh"
CONFIG=${POSTMASTER_CONFIG:-${HOME:-}/.postmaster/config.toml}

route() {
  [ $# -eq 5 ] || { echo "usage: postmaster-route.sh <harness> <model> <working-directory> <person-at-terminal> <target> | --self-test" >&2; return 2; }
  [ -n "$1" ] && [ -n "$2" ] && [ -n "$3" ] && [ -n "$5" ] \
    || { echo "postmaster-route: harness, model, working directory and target must be non-empty" >&2; return 1; }
  case $4 in yes|no) ;; *) echo "postmaster-route: person-at-terminal must be yes or no" >&2; return 1 ;; esac
  [ -f "$CONFIG" ] || { echo "postmaster-route: no config at $CONFIG" >&2; return 1; }
  python3 -I -c 'import tomllib' 2>/dev/null || { echo "postmaster-route: python3 3.11 or newer is needed to read $CONFIG" >&2; return 1; }
  python3 -I - "$CONFIG" "$1" "$2" "$3" "$4" "$5" <<'PY'
import pathlib
import subprocess
import sys
import tomllib

config, reported_harness, reported_model, working_dir, terminal, target = sys.argv[1:]
try:
    with open(config, "rb") as f:
        cfg = tomllib.load(f)
except (OSError, tomllib.TOMLDecodeError) as e:
    print(f"postmaster-route: cannot read config {config}: {e}", file=sys.stderr)
    sys.exit(1)

team = cfg.get("team", {})
if not isinstance(team, dict):
    print("postmaster-route: config [team] value is not a table", file=sys.stderr)
    sys.exit(1)
postmaster = team.get("postmaster")
if not isinstance(postmaster, dict):
    print("postmaster-route: config has no [team].postmaster table", file=sys.stderr)
    sys.exit(1)
configured_harness = postmaster.get("harness")
configured_model = postmaster.get("model")
if not isinstance(configured_harness, str) or not configured_harness.strip():
    print("postmaster-route: team.postmaster.harness is missing or empty", file=sys.stderr)
    sys.exit(1)
if not isinstance(configured_model, str) or not configured_model.strip():
    print("postmaster-route: team.postmaster.model is missing or empty", file=sys.stderr)
    sys.exit(1)

def repository_root(path, label):
    try:
        resolved = pathlib.Path(path).expanduser().resolve(strict=True)
    except OSError as e:
        print(f"postmaster-route: cannot resolve {label}: {e}", file=sys.stderr)
        sys.exit(1)
    if not resolved.is_dir():
        print(f"postmaster-route: {label} is not a directory", file=sys.stderr)
        sys.exit(1)
    try:
        result = subprocess.run(
            ["git", "-C", str(resolved), "rev-parse", "--show-toplevel"],
            check=True, capture_output=True, text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        print(f"postmaster-route: {label} is not inside a readable git repository", file=sys.stderr)
        sys.exit(1)
    try:
        return pathlib.Path(result.stdout.strip()).resolve(strict=True)
    except OSError as e:
        print(f"postmaster-route: cannot resolve the repository for {label}: {e}", file=sys.stderr)
        sys.exit(1)

working_root = repository_root(working_dir, "working directory")
target_root = repository_root(target, "target")
reasons = []
if reported_harness != configured_harness:
    reasons.append("session harness differs from team.postmaster")
if reported_model != configured_model:
    reasons.append("session model differs from team.postmaster")
if working_root != target_root:
    reasons.append("target is a different repository from the session")
if terminal != "yes":
    reasons.append("no person is at the terminal")

if reasons:
    print("spawn: " + "; ".join(reasons))
else:
    print("self: harness and model match team.postmaster; target is this repository; a person is at the terminal")
PY
}

if [ "${1:-}" != --self-test ]; then
  route "$@"
  exit $?
fi
[ $# -eq 1 ] || { echo "usage: postmaster-route.sh --self-test" >&2; exit 2; }

# --- self-test -----------------------------------------------------------------------------
tmp=$(mktemp -d "$HERE/.postmaster-route.XXXXXX") || exit 1
cleanup() {
  rm -f -- "$tmp/config.toml" "$tmp/stderr" "$tmp/bin/git"
  rmdir -- "$tmp/repo/subdir" "$tmp/repo" "$tmp/other" "$tmp/bin" "$tmp" 2>/dev/null || true
}
trap cleanup EXIT
mkdir -p "$tmp/repo/subdir" "$tmp/other" "$tmp/bin" || exit 1
cat > "$tmp/config.toml" <<'EOF'
[team]
postmaster = { harness = "codex", model = "model-good" }
EOF
cat > "$tmp/bin/git" <<'EOF'
#!/usr/bin/env bash
set -eu
[ "${1:-}" = -C ] && [ "${3:-}" = rev-parse ] && [ "${4:-}" = --show-toplevel ] || exit 2
case $2 in
  "$FIXTURE_ROOT/repo"|"$FIXTURE_ROOT/repo/subdir") printf '%s\n' "$FIXTURE_ROOT/repo" ;;
  "$FIXTURE_ROOT/other") printf '%s\n' "$FIXTURE_ROOT/other" ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$tmp/bin/git" || exit 1

fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; [ -z "${2:-}" ] || printf '%s\n' "$2" | sed 's/^/         /'; fails=$((fails+1)); }
expect() {  # expect <label> <expected line> <harness> <model> <cwd> <terminal> <target>
  local label=$1 expected=$2 out rc
  shift 2
  out=$(FIXTURE_ROOT="$tmp" PATH="$tmp/bin:$PATH" POSTMASTER_CONFIG="$tmp/config.toml" \
    "$SELF" "$@" 2>"$tmp/stderr"); rc=$?
  if [ $rc -eq 0 ] && [ "$out" = "$expected" ]; then ok "$label"; else fail "$label (exit $rc)" "$out $(cat "$tmp/stderr")"; fi
}

echo "positive and negative controls for each spawn reason"
expect "harness mismatch triggers its reason" \
  "spawn: session harness differs from team.postmaster" \
  other model-good "$tmp/repo/subdir" yes "$tmp/repo"
expect "matching harness does not trigger its reason" \
  "self: harness and model match team.postmaster; target is this repository; a person is at the terminal" \
  codex model-good "$tmp/repo/subdir" yes "$tmp/repo"
expect "model mismatch triggers its reason" \
  "spawn: session model differs from team.postmaster" \
  codex other-model "$tmp/repo/subdir" yes "$tmp/repo"
expect "matching model does not trigger its reason" \
  "self: harness and model match team.postmaster; target is this repository; a person is at the terminal" \
  codex model-good "$tmp/repo/subdir" yes "$tmp/repo"
expect "different target triggers its reason" \
  "spawn: target is a different repository from the session" \
  codex model-good "$tmp/repo/subdir" yes "$tmp/other"
expect "same target does not trigger its reason, including from a subdirectory" \
  "self: harness and model match team.postmaster; target is this repository; a person is at the terminal" \
  codex model-good "$tmp/repo/subdir" yes "$tmp/repo"
expect "no person at terminal triggers its reason" \
  "spawn: no person is at the terminal" \
  codex model-good "$tmp/repo/subdir" no "$tmp/repo"
expect "a person at terminal does not trigger its reason" \
  "self: harness and model match team.postmaster; target is this repository; a person is at the terminal" \
  codex model-good "$tmp/repo/subdir" yes "$tmp/repo"
expect "every failed condition is reported" \
  "spawn: session harness differs from team.postmaster; session model differs from team.postmaster; target is a different repository from the session; no person is at the terminal" \
  other other-model "$tmp/repo/subdir" no "$tmp/other"
out=$(POSTMASTER_CONFIG="$tmp/config.toml" "$SELF" codex model-good "$HERE/.." yes "$HERE/.." 2>"$tmp/stderr"); rc=$?
[ $rc -eq 0 ] && [ "$out" = "self: harness and model match team.postmaster; target is this repository; a person is at the terminal" ] \
  && ok "the real git repository root is read successfully" || fail "the real git repository root is read successfully (exit $rc)" "$out $(cat "$tmp/stderr")"

echo
[ "$fails" -eq 0 ] && { echo "self-test: all controls behaved"; exit 0; }
echo "self-test: $fails control(s) misbehaved"; exit 1
