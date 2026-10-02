#!/usr/bin/env bash
# confine-shims.sh <tool> <root> srt|landlock: <root>/shims-<backend>/<harness> for codex, claude,
# muse, mimo and pi, and <root>/shell-<backend>/bash for a plain shell. Each runs the real program
# confined to what a lane needs. Put the shims folder first on PATH and scripts/launch.sh runs
# unchanged: its final exec reaches the shim, which confines the harness at the point a confine
# step in launch.sh would. The shell stays out of that folder, since everything a harness runs
# would otherwise reach it, and every shim names its interpreter by path for the same reason.
#
# What a lane may reach, the same under both backends:
#   read only     the system; the harness installs; git's user config; the tool's own repo and
#                 the skills folder that links into it
#   read, write   the lane's worktree (the directory the harness starts in); the repository's git
#                 directory, where a worktree commits; a temp folder of the lane's own (TMPDIR);
#                 npm's cache; the harness's own config and state
#   nothing else  in the home directory: other lanes' worktrees, the main checkout, other
#                 harnesses' logins, keys
#
# srt (sandbox-runtime, Bubblewrap on Linux and Seatbelt on macOS) hides the home directory and
# re-opens those paths, allows writes only to the read-write ones, blocks Unix sockets, and
# lets the network reach only the hosts listed for the harness, the npm registry and GitHub.
# landlock (landlock.py, Linux only, no root) allows only those paths and leaves the network,
# Unix sockets and signals as they are.
set -euo pipefail
tool=$(cd "$1" && pwd -P) root=$2 backend=$3
here=$(cd "$(dirname "$0")" && pwd -P)
case $backend in
  srt) srt=$root/srt/node_modules/.bin/srt; [ -x "$srt" ] || { echo "no srt at $srt" >&2; exit 1; } ;;
  landlock) ;;
  *) echo "usage: confine-shims.sh <tool> <root> srt|landlock" >&2; exit 1 ;;
esac
mkdir -p "$root/shims-$backend" "$root/shell-$backend" "$root/tmp"
plain_path=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v "^$root/shims-" | paste -sd:)
for h in codex claude muse mimo pi bash; do
  real=$(PATH=$plain_path command -v "$h")
  dir=$root/shims-$backend; [ "$h" = bash ] && dir=$root/shell-$backend
  cat > "$dir/$h" <<EOF
#!/bin/bash
set -uo pipefail
H=\$HOME
wt=\$(pwd -P)
common=\$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
lane_tmp='$root/tmp'/\$(basename "\$wt"); mkdir -p "\$lane_tmp"; export TMPDIR=\$lane_tmp
ro=("\$H/.local/bin" "\$H/.local/lib" "\$H/.local/opt" "\$H/.local/share/claude" "\$H/.local/share/pi"
    "\$H/.gitconfig" "\$H/.config/git" "\$H/.agents" '$tool')
[ '$backend' = srt ] && ro+=('$root/srt')   # srt runs its seccomp helper from inside the sandbox
rw=("\$wt" "\$lane_tmp" "\$H/.npm")
[ -n "\$common" ] && rw+=("\$common")
# A shared clone (git clone --shared, as a security reviewer's scratch is cut) borrows the objects
# of the repository it was cloned from: those stay readable, never writable.
alternates=\$(git rev-parse --path-format=absolute --git-path objects/info/alternates 2>/dev/null || true)
[ -n "\$alternates" ] && [ -f "\$alternates" ] && while IFS= read -r a; do [ -n "\$a" ] && ro+=("\$a"); done < "\$alternates"
hosts=("registry.npmjs.org" "github.com")
# The files a launch names outside the worktree are the lane's own: the prompt a harness reads
# from a file (--prompt-file), and the final message codex writes (-o). They are opened inside.
prev=""
for a in "\$@"; do
  case \$prev in
    --prompt-file) ro+=("\$a") ;;
    -o) touch "\$a" 2>/dev/null; rw+=("\$a") ;;
  esac
  prev=\$a
done
case $h in
  codex)  rw+=("\$H/.codex"); hosts+=("chatgpt.com" "*.chatgpt.com" "*.openai.com") ;;
  claude) rw+=("\$H/.claude" "\$H/.claude.json"); hosts+=("api.anthropic.com" "*.anthropic.com" "claude.ai" "platform.claude.com") ;;
  muse)   rw+=("\$H/.config/muse"); [ -n "\${XDG_DATA_HOME:-}" ] && rw+=("\$XDG_DATA_HOME")
          hosts+=("api.meta.ai" "*.meta.ai" "auth.meta.com") ;;
  mimo)   rw+=("\$H/.cache/mimocode" "\$H/.local/state/mimocode"); [ -n "\${XDG_DATA_HOME:-}" ] && rw+=("\$XDG_DATA_HOME")
          ro+=("\$H/.config/mimocode" "\$H/.mimocode" "\$H/.claude/CLAUDE.md" "\$H/.claude.json")
          hosts+=("*.xiaomimimo.com" "mimo.xiaomi.com") ;;
  pi)     rw+=("\${PI_CODING_AGENT_DIR:-\$H/.pi/agent}") ;;
esac
EOF
  if [ "$backend" = srt ]; then
    cat >> "$dir/$h" <<EOF
# srt hands the sandboxed command TMPDIR=/tmp/claude, which it neither creates nor needs to,
# unless CLAUDE_CODE_TMPDIR names another; the lane's own temp folder is already writable.
export CLAUDE_CODE_TMPDIR=\$lane_tmp
settings=\$lane_tmp/srt-settings.json
python3 - "\$settings" "\$H" <<'PY' "\${ro[@]}" -- "\${rw[@]}" -- "\${hosts[@]}"
import json, sys
out, home, rest = sys.argv[1], sys.argv[2], sys.argv[3:]
cut1 = rest.index("--"); ro = rest[:cut1]; rest = rest[cut1 + 1:]
cut2 = rest.index("--"); rw = rest[:cut2]; hosts = rest[cut2 + 1:]
json.dump({"filesystem": {"denyRead": [home], "allowRead": ro + rw, "allowWrite": rw, "denyWrite": []},
           "network": {"allowedDomains": hosts, "deniedDomains": []}}, open(out, "w"), indent=1)
PY
# A trial's stand-in provider listens on loopback, which the sandbox's network cannot reach from
# outside, so STUB_CMD starts it inside, beside the harness.
if [ -n "\${STUB_CMD:-}" ]; then
  exec '$srt' --settings "\$settings" -- /bin/bash -c 'eval "\$STUB_CMD" & sleep 0.5; exec "\$0" "\$@"' '$real' "\$@"
fi
exec '$srt' --settings "\$settings" -- '$real' "\$@"
EOF
  else
    cat >> "$dir/$h" <<EOF
sys_ro=(/usr /bin /sbin /lib /lib32 /lib64 /etc /opt /proc /sys /run/systemd/resolve)
args=()
for p in "\${sys_ro[@]}" "\${ro[@]}"; do args+=(--ro "\$p"); done
for p in /dev "\${rw[@]}"; do args+=(--rw "\$p"); done
exec python3 '$here/landlock.py' "\${args[@]}" -- '$real' "\$@"
EOF
  fi
  chmod +x "$dir/$h"
done
echo "shims in $root/shims-$backend, shell in $root/shell-$backend"
