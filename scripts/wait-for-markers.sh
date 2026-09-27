#!/usr/bin/env bash
# Block until <count> files matching <glob> exist directly under <dir>, or <timeout> seconds
# pass. The wait goes in the SAME command as the launch that will produce the markers; a turn
# that ends between launching a round and collecting it is a round nobody collects.
#
#   wait-for-markers.sh <dir> <glob> <count> <timeout-seconds>
#
#   exit 0  all markers present
#   exit 3  timeout; the matches that did arrive are listed
#   exit 1  usage, or the reader failed its own control
#
# Control: before polling, the reader is proved both ways through the identical find. It must
# count a marker this script plants (positive control) and count zero for a pattern that cannot
# match (negative control). A poller that can only ever say 0 is indistinguishable from lanes
# that are still working, so it reads as patience rather than as a broken instrument.
set -uo pipefail
DIR=${1:?usage: wait-for-markers.sh <dir> <glob> <count> <timeout-seconds>}
GLOB=${2:?}
COUNT=${3:?}
TIMEOUT=${4:?}

DIR=$(CDPATH= cd -P -- "$DIR" 2>/dev/null && pwd -P) || { echo "wait-for-markers: no such dir: $1" >&2; exit 1; }
count() { find "$DIR" -maxdepth 1 -name "$1" 2>/dev/null | wc -l | tr -d ' '; }

probe="$DIR/.wait-for-markers-control.$$"
: > "$probe"
pos=$(count ".wait-for-markers-control.$$")
neg=$(count ".wait-for-markers-impossible-$$-*")
rm -f "$probe"
[ "$pos" -eq 1 ] && [ "$neg" -eq 0 ] \
  || { echo "wait-for-markers: reader failed its control (positive=$pos negative=$neg)" >&2; exit 1; }

deadline=$(( $(date +%s) + TIMEOUT ))
while [ "$(count "$GLOB")" -lt "$COUNT" ]; do
  if [ "$(date +%s)" -gt "$deadline" ]; then
    echo "WAIT-TIMEOUT after ${TIMEOUT}s: $(count "$GLOB") of $COUNT markers matching $GLOB"
    find "$DIR" -maxdepth 1 -name "$GLOB" 2>/dev/null | sed 's/^/  present: /'
    exit 3
  fi
  sleep 20
done
echo "all $COUNT markers present"
exit 0
