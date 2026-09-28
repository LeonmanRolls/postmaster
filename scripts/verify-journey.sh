#!/usr/bin/env bash
exec bun "$(dirname "$0")/verify-journey.ts" "$@"
