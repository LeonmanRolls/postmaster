#!/bin/sh
exec bun "$(dirname "$0")/runs-status.ts" "$@"
