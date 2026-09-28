#!/bin/sh
exec bun "$(dirname "$0")/run-meta.ts" "$@"
