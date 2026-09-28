#!/bin/sh
exec bun "$(dirname "$0")/find-projects.ts" "$@"
