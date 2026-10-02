#!/usr/bin/env bash
# stub-lane.sh <tool> <root> <lane> <level> <steps.json> <port> [VAR=value...]: one run of a lane
# whose model is stub.py on 127.0.0.1:<port>, through run-lane.sh. The lane is t-pi (pi, given
# the stub in <root>/pi-agent/models.json) or t-mimostub (MiMo Code, given the stub as a provider
# in MIMOCODE_CONFIG_CONTENT, which a VAR=value may replace to add a rule). Requests are logged
# to <root>/logs/<lane>-<level>-requests.jsonl.
set -uo pipefail
tool=$1 root=$2 lane=$3 level=$4 steps=$5 port=$6; shift 6
here=$(cd "$(dirname "$0")" && pwd -P)
mkdir -p "$root/pi-agent"
printf '{"providers": {"stub": {"baseUrl": "http://127.0.0.1:%s/v1", "api": "openai-completions", "apiKey": "stub", "compat": {"supportsDeveloperRole": false, "supportsReasoningEffort": false}, "models": [{"id": "stub-model"}]}}}\n' \
  "$port" > "$root/pi-agent/models.json"
provider='"provider": {"stub": {"npm": "@ai-sdk/openai-compatible", "name": "stub", "options": {"baseURL": "http://127.0.0.1:'$port'/v1", "apiKey": "stub"}, "models": {"stub-model": {"name": "stub-model", "tool_call": true}}}}'
log=$root/logs/$lane-$level-requests.jsonl
if [ "$level" = srt ]; then
  # Inside sandbox-runtime the loopback is the sandbox's own: the shim starts the stub there,
  # logging to the lane's temp folder, and the log is moved beside the others afterwards.
  inner=$root/tmp/1-$lane-$level/requests.jsonl
  "$here/run-lane.sh" "$tool" "$root" "$lane" "$level" PI_CODING_AGENT_DIR="$root/pi-agent" \
    MIMOCODE_CONFIG_CONTENT="{$provider}" \
    STUB_CMD="python3 '$here/stub.py' $port '$root' '$lane-$level' '$inner' '$steps'" "$@"
  mv -f "$inner" "$log" 2>/dev/null
else
  python3 "$here/stub.py" "$port" "$root" "$lane-$level" "$log" "$steps" &
  stub=$!
  sleep 0.5
  "$here/run-lane.sh" "$tool" "$root" "$lane" "$level" PI_CODING_AGENT_DIR="$root/pi-agent" \
    MIMOCODE_CONFIG_CONTENT="{$provider}" "$@"
  kill "$stub" 2>/dev/null; wait "$stub" 2>/dev/null
fi
