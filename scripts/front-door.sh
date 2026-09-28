#!/bin/sh
exec bun "$(dirname "$0")/front-door.ts" "$@"
