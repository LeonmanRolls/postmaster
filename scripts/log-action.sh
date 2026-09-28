#!/usr/bin/env bash
exec bun "$(dirname "$0")/log-action.ts" "$@"
