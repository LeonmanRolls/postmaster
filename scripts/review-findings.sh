#!/usr/bin/env bash
# Shell entry point for normalizing native bug-review reports and harvesting Claude task logs.
set -uo pipefail
HERE=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd -P)
exec python3 "$HERE/review-findings.py" "$@"
