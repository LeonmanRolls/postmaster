#!/usr/bin/env bash
sleep 60 & echo $! > "$TREE/child.pid"
wait
