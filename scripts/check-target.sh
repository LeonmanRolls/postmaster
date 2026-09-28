#!/bin/sh
exec bun "$(dirname "$0")/check-target.ts" "$@"
