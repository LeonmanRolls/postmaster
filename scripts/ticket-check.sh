#!/usr/bin/env bash
exec bun "$(dirname "$0")/ticket-check.ts" "$@"
