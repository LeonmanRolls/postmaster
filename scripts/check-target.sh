#!/usr/bin/env bash
exec bun "$(dirname "$0")/check-target.ts" "$@"
