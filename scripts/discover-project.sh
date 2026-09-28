#!/usr/bin/env bash
# Work out what a target project needs, rather than demanding it be configured.
# Prints key=value lines. Empty value means "could not determine, ask the user". Each check a
# change is verified by is a `check.<name>=<where it came from>: <what it shows>` line: declared in
# the project's .postmaster/project.toml, or a default and which one (scripts/verify.sh).
# postmaster_dir says whether the target carries its own .postmaster/ settings, and
# postmaster_shared / postmaster_local say which files: a waybill can then say which facts
# were discovered and which were declared. A project without a .postmaster/ is the normal
# case, and is never an error.
set -uo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_NAMESPACE
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
T=${1:?usage: discover-project.sh <path>}
# The tracker kind, before the cd, so a relative path or config is read from the caller's directory.
kind=$("$HERE/tracker-kind.sh" "$T" 2>/dev/null) || kind=""
CDPATH= cd -P -- "$T" 2>/dev/null || { echo "cannot enter $T" >&2; exit 1; }

gate=""
[ -f package.json ] && ! command -v jq >/dev/null 2>&1 && echo "warn=jq not installed: package.json scripts were not read" >&2
if [ -f package.json ] && command -v jq >/dev/null 2>&1; then
  for s in check ci verify test lint; do
    jq -e --arg s "$s" '.scripts[$s]' package.json >/dev/null 2>&1 && { gate="$s"; break; }
  done
  [ -n "$gate" ] && gate="$( [ -f pnpm-lock.yaml ] && echo pnpm || echo npm ) run $gate"
fi
[ -z "$gate" ] && [ -f Makefile ] && grep -qE '^(check|test):' Makefile && gate="make check"
[ -z "$gate" ] && [ -f Cargo.toml ] && gate="cargo test"

docs=$(ls AGENTS.md CLAUDE.md README.md CONTRIBUTING.md 2>/dev/null | tr '\n' ' ')
dirs=$(ls -d wiki docs .github 2>/dev/null | tr '\n' ' ')

# Does the target carry its own .postmaster/ settings, and which files? A waybill says which
# facts were discovered and which were declared. A missing folder is the normal case.
settings=$("$HERE/project-settings.sh" . has 2>/dev/null) || settings="shared=no
local=no
any=no"
shared=$(printf '%s\n' "$settings" | sed -n 's/^shared=//p')
localset=$(printf '%s\n' "$settings" | sed -n 's/^local=//p')

# The tracker is visible in how the project already writes commits; nothing to configure.
tracker=$(git log --oneline -200 2>/dev/null \
          | grep -oE '\b[A-Z][A-Z0-9]{1,9}-[0-9]+\b' | sed 's/-[0-9]*$//' \
          | sort | uniq -c | sort -rn | head -1 | awk '{print $2}')

# The checks, declared or found as defaults; a declared gate is the gate.
out=$("$HERE/verify.sh" checks . --gate "$gate" --lines 2>&1); rc=$?
if [ $rc -eq 0 ]; then
  checks=$(printf '%s\n' "$out" | awk -F'\t' 'NF >= 4')
  gate=$(printf '%s\n' "$checks" | awk -F'\t' '$1 == "gate" {print $3}')
  printf '%s\n' "$out" | awk -F'\t' 'NF < 4' | sed -n 's/^verify: warn: /warn=checks: /p' >&2
else
  checks=""
  echo "warn=checks: $(printf '%s\n' "$out" | sed 's/^verify: //' | paste -sd' ' -)" >&2
fi

echo "gate=$gate"
echo "docs=$(echo "$docs$dirs" | sed 's/ *$//')"
echo "tracker=$kind"
echo "tracker_prefix=$tracker"
echo "ambient_context=$( [ -f AGENTS.md ] && echo AGENTS.md || echo NONE )"
echo "postmaster_dir=$( { [ "${shared:-no}" = yes ] || [ "${localset:-no}" = yes ]; } && echo yes || echo no )"
echo "postmaster_shared=${shared:-no}"
echo "postmaster_local=${localset:-no}"
printf '%s\n' "$checks" | awk -F'\t' 'NF >= 4 {print "check." $1 "=" $2 ": " $4}'
[ -f AGENTS.md ] || echo "warn=no AGENTS.md: lanes that read no ambient file will start blind" >&2
[ "$kind" = github ] && ! git remote get-url origin >/dev/null 2>&1 \
  && echo "warn=no origin remote, so no github board: with the user's word, scripts/local.sh <repo> store init gives it a local store" >&2
exit 0
