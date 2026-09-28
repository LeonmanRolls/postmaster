#!/usr/bin/env bash
exec bun "$(dirname "$0")/view-stream.ts" "$@"
