#!/usr/bin/env bash
exec bun "$(dirname "$0")/tool-faults.ts" "$@"
