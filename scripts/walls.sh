#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
exec bun --no-env-file --config="$HERE/../bunfig.toml" "$HERE/walls.ts" "$@"
