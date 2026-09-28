#!/bin/sh
exec bun "$(dirname "$0")/handoff-check.ts" "$@"
