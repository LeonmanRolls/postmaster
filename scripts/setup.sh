#!/usr/bin/env bash
if [ "${1:-}" = --self-test ]; then
  exec bun --no-env-file "--config=$(dirname "$0")/../bunfig.toml" test "$(dirname "$0")/setup.test.ts"
fi
exec bun --no-env-file "--config=$(dirname "$0")/../bunfig.toml" "$(dirname "$0")/setup.ts" "$@"
