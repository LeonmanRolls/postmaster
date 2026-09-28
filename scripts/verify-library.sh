#!/usr/bin/env bash
exec bun "$(dirname "$0")/verify-library.ts" "$@"
