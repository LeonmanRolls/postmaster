#!/usr/bin/env bash
exec bun "$(dirname "$0")/runs-status.ts" "$@"
