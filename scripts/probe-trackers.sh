#!/usr/bin/env bash
exec bun "$(dirname "$0")/probe-trackers.ts" "$@"
