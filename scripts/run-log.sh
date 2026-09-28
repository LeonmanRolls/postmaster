#!/bin/sh
exec bun "$(dirname "$0")/run-log.ts" "$@"
