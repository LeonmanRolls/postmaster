#!/usr/bin/env bash
exec 9>>"$LOCKFILE" && flock 9 || exit 1
exec bun /home/brindlewick/postmaster/.worktrees/109-mimo/.port-scratch/fl/fl.mjs
