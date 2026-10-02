#!/usr/bin/env bash
# shell-probe.sh <root> <level> <sockdir> [<bash>]: a lane's work and its reaches, from a plain
# shell and no model, run in a fresh worktree of <root>/app by <bash>: a shell folder's bash to run
# it confined, or plain bash, the default. One line per check: what a lane needs to do, then what
# it must not reach. A Unix socket in <sockdir>, a folder outside the home directory that no
# sandbox here hides, stands in for a session host's socket, and a process started outside the
# lane for another lane's. Writes <root>/logs/shell-<level>.txt.
set -uo pipefail
root=$1 level=$2 sockdir=$3 shell=${4:-bash}
wt=$root/app/.worktrees/1-shell-$level
git -C "$root/app" worktree add -q "$wt" -b "wb/1-shell-$level" main || exit 1
mkdir -p "$sockdir"; rm -f "$sockdir/s.sock"
( cd "$sockdir" && python3 -c '
import os, socket, sys
s = socket.socket(socket.AF_UNIX); s.bind("s.sock"); s.listen(4)
if os.fork(): os._exit(0)
os.setsid()
while True:
    c, _ = s.accept(); c.sendall(b"REACHED"); c.close()' </dev/null >/dev/null 2>&1 )
sleep 600 </dev/null >/dev/null 2>&1 & other=$!
export ROOT=$root OTHER=$other SOCKDIR=$sockdir
probe='
say() { printf "%-34s %s\n" "$1" "$2"; }
npm ci >/dev/null 2>&1; say "npm ci" "exit $?"
npm run check >/dev/null 2>&1; say "npm run check (the gate)" "exit $?"
{ echo INSIDE > inside.txt && git add inside.txt && git -c user.name=t -c user.email=t@example.invalid commit -q -m "trial: inside"; } >/dev/null 2>&1 \
  && say "write and commit in own worktree" worked || say "write and commit in own worktree" failed
(echo OUTSIDE > "$ROOT/app/outside-shell.txt") 2>/dev/null && say "write into the main checkout" worked || say "write into the main checkout" refused
cat "$ROOT/app/.worktrees/other/draft.txt" >/dev/null 2>&1 && say "read the other lane worktree" worked || say "read the other lane worktree" refused
cat "$ROOT/home/note.txt" >/dev/null 2>&1 && say "read elsewhere in home" worked || say "read elsewhere in home" refused
git show wb/1-other:other.txt >/dev/null 2>&1 && say "read the other lane commit via git" worked || say "read the other lane commit via git" refused
(cd "$SOCKDIR" && python3 -c "import socket,sys; c=socket.socket(socket.AF_UNIX); c.connect(\"s.sock\"); sys.exit(0 if c.recv(9)==b\"REACHED\" else 1)") 2>/dev/null \
  && say "connect to a Unix socket outside" worked || say "connect to a Unix socket outside" refused
kill -0 "$OTHER" 2>/dev/null && say "signal a process outside" worked || say "signal a process outside" refused
'
cd "$wt" || exit 1
{ "$shell" -c "$probe"; echo "exit $?"; } > "$root/logs/shell-$level.txt" 2>&1
kill "$other" 2>/dev/null
# A write a sandbox sends to a throwaway layer reports success inside and never reaches the disk,
# so the main checkout is read from outside.
if [ -e "$root/app/outside-shell.txt" ]; then on_disk=yes; rm -f "$root/app/outside-shell.txt"; else on_disk=no; fi
printf '%-34s %s\n' "main checkout file on disk after" "$on_disk" >> "$root/logs/shell-$level.txt"
cat "$root/logs/shell-$level.txt"
