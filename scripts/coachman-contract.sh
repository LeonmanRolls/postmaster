#!/usr/bin/env bash
exec bun --no-env-file "--config=$(dirname "$0")/../bunfig.toml" "$(dirname "$0")/coachman-contract.ts" "$@"
