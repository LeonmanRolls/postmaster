#!/usr/bin/env bash
trap 'echo term >> "$TREE/term"; exit 0' TERM
setsid sleep 120 & echo $! > "$TREE/escapee.pid"
sh -c 'trap "" TERM; while :; do sleep 1; done' & echo $! > "$TREE/deaf.pid"
sleep 120 & wait
