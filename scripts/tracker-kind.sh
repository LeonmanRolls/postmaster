#!/usr/bin/env bash
# The tracker kind a repository uses: local when its local ticket store exists
# (scripts/local.sh), whatever the config names; otherwise the config's [tracker] kind, github
# when it names none (skills/postmaster/trackers.md, local). This is the one place the rule
# lives: scripts/discover-project.sh reports it and scripts/ticket-check.sh reads through it.
#
#   tracker-kind.sh <repo>
#
# POSTMASTER_CONFIG overrides the config path (~/.postmaster/config.toml), and a relative one is
# read from the directory this is run in. Only local.sh's exit 3 means there is no store: any
# other failure to look is a failure here, never a fall back to the config.
#
#   exit 0  the kind, on stdout
#   exit 1  it cannot be told: local.sh could not look for a store, there is no config, or it
#           does not parse; the reason on stderr
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
CONFIG=${POSTMASTER_CONFIG:-${HOME:-}/.postmaster/config.toml}
[ $# -eq 1 ] || { echo "usage: tracker-kind.sh <repo>" >&2; exit 1; }
why=$("$HERE/local.sh" "$1" store 2>&1 >/dev/null); rc=$?
case $rc in
  0) echo local; exit 0 ;;
  3) ;;
  *) echo "tracker-kind: cannot look for a local store in $1 (local.sh exit $rc): ${why:-no message}" >&2; exit 1 ;;
esac
[ -f "$CONFIG" ] || { echo "tracker-kind: no config at $CONFIG (POSTMASTER_CONFIG overrides the path)" >&2; exit 1; }
python3 -I -c 'import tomllib' 2>/dev/null || { echo "tracker-kind: python3 3.11 or newer is needed to read $CONFIG" >&2; exit 1; }
python3 -I -c 'import sys, tomllib; print(tomllib.load(open(sys.argv[1], "rb")).get("tracker", {}).get("kind", "github"))' "$CONFIG" 2>/dev/null \
  || { echo "tracker-kind: $CONFIG does not parse" >&2; exit 1; }
