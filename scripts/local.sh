#!/bin/sh
exec bun "$(dirname "$0")/local.ts" "$@"
