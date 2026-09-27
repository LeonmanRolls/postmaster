#!/usr/bin/env bash
# Which ticket sources this machine can reach, detected without assuming any particular
# agent harness. The user chooses; this reports what is genuinely available so the
# choice is informed rather than aspirational.
#
#   exit 0 always; the table is the result
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
CONFIG=${POSTMASTER_CONFIG:-$HOME/.postmaster/config.toml}
row() { printf '  %-12s %-12s %s\n' "$1" "$2" "$3"; }
row TRACKER AVAILABLE "HOW IT IS REACHED"
row ------- --------- ------------------

# GitHub Issues on a Projects board: gh logged in, and the token carrying the project scope,
# which `gh auth login` does not grant by default.
if ! command -v gh >/dev/null 2>&1; then row github no "gh not installed"
elif ! gh auth status >/dev/null 2>&1; then row github partial "gh installed but not logged in; the user runs: gh auth login"
elif ! gh auth status 2>&1 | grep -qE "Token scopes:.*'project'"; then
  row github partial "gh logged in without the project scope; the user runs: gh auth refresh -s project"
else row github yes "gh CLI, logged in, project scope (the default)"; fi

# Plane: an instance and workspace in the config and a key in the env file. The only proof
# is a listing, so the probe asks for one when all three are present.
plane_env=$(python3 -c '
import sys, tomllib
try: t = tomllib.load(open(sys.argv[1], "rb")).get("tracker", {})
except Exception: t = {}
print(t.get("env_file") or "~/.postmaster/plane.env"); print(t.get("url", "")); print(t.get("workspace", ""))' "$CONFIG" 2>/dev/null)
env_file=$(printf '%s\n' "$plane_env" | sed -n 1p); env_file=${env_file/#\~/$HOME}
plane_url=$(printf '%s\n' "$plane_env" | sed -n 2p); plane_ws=$(printf '%s\n' "$plane_env" | sed -n 3p)
if [ -z "$plane_url" ] || [ -z "$plane_ws" ]; then
  row plane setup "needs [tracker] url and workspace in the config and PLANE_API_KEY in ~/.postmaster/plane.env"
elif [ -z "${PLANE_API_KEY:-}" ] && [ ! -f "$env_file" ]; then
  row plane partial "url and workspace set; no key at $env_file"
elif out=$(POSTMASTER_CONFIG="$CONFIG" "$HERE/plane.sh" projects 2>&1); then
  row plane yes "$plane_url, workspace $plane_ws, $(printf '%s\n' "$out" | grep -c .) projects"
else
  row plane no "$(printf '%s' "$out" | head -1)"
fi

# Local: tickets in each repository's own git directory, through scripts/local.sh. There is
# nothing to reach and no login; it needs only git and python3 with the modules it imports.
if command -v git >/dev/null 2>&1 && python3 -c 'import fcntl, json' 2>/dev/null; then
  row local yes "no service, no login; a repo's store is made with: scripts/local.sh <repo> store init"
else row local no "needs git and python3"; fi

# Hosted and self-hosted trackers are reached through whatever tooling the user's agent
# provides (an MCP server, a CLI). That is a property of their agent setup, not of this
# machine, and this script deliberately does not read any one harness's config to guess at it.
row other "ask" "any tracker reached through your agent's own tooling; needs the service reachable"
echo
echo "  GitHub Issues is the default: the tickets sit on a GitHub Projects board the user"
echo "  can open. \"partial\" names the one command the user runs to finish it. \"ask\""
echo "  means this script cannot tell, so the user must say: an MCP being registered is"
echo "  not the same as the service being up. A repo whose local store exists uses local,"
echo "  whatever the config names."
