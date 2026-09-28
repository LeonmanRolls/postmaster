#!/bin/sh
exec bun "$(dirname "$0")/log-action.ts" "$@"
