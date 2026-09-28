#!/bin/sh
exec bun "$(dirname "$0")/wait-for-markers.ts" "$@"
