#!/usr/bin/env bash
exec bun "$(dirname "$0")/link-skills.ts" "$@"
