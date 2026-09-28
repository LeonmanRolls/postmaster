#!/bin/sh
exec bun "$(dirname "$0")/discover-project.ts" "$@"
