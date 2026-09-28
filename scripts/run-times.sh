#!/usr/bin/env bash
exec bun "$(dirname "$0")/run-times.ts" "$@"
