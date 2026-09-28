#!/bin/sh
exec bun "$(dirname "$0")/probe-trackers.ts" "$@"
