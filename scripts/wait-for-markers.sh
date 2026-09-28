#!/usr/bin/env bash
exec bun "$(dirname "$0")/wait-for-markers.ts" "$@"
