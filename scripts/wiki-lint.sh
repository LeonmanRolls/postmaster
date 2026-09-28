#!/usr/bin/env bash
exec bun "$(dirname "$0")/wiki-lint.ts" "$@"
