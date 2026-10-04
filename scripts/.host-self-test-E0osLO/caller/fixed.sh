#!/usr/bin/env bash
printf '{"type":"system","subtype":"init","session_id":"fixed-1","model":"m"}\n'
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"step one"}]}}\n'
printf 'a line on stderr\n' >&2
sleep "$(printenv EMIT_SLEEP || printf 0)"
printf '{"type":"result","subtype":"success","num_turns":1}\n'
exit 3
