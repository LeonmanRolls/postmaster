#!/bin/sh
exec bun "$(dirname "$0")/stage.ts" "$@"
