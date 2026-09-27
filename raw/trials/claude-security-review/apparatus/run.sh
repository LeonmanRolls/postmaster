#!/usr/bin/env bash
# claude's /security-review through postmaster's own launch form, in two arms that differ only in
# the scratch: a clone cut with `cut-scratch.sh --clone <base>`, whose origin/HEAD leads back to
# the base, and a detached worktree of a repository with no origin, where origin/HEAD does not
# resolve. Both run the identical command: `launch.sh launch` on the prompt `launch.sh skill`
# prints, for one claude lane. Each arm's record keeps the fields named in method.md and nothing
# else, since a stream's init event lists the machine's own tools and connectors.
#
#   run.sh <postmaster-checkout> <out-dir> [<model>]
set -uo pipefail
ROOT=$(cd "${1:?usage: run.sh <postmaster-checkout> <out-dir> [<model>]}" && pwd -P) || exit 1
OUT=${2:?usage: run.sh <postmaster-checkout> <out-dir> [<model>]}
MODEL=${3:-claude-opus-5-5}
mkdir -p "$OUT" && OUT=$(cd "$OUT" && pwd -P) || exit 1
tmp=$(mktemp -d) && tmp=$(cd "$tmp" && pwd -P) || exit 1
trap 'rm -r -- "$tmp"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

# The fixture: a server with one safe command at the base; the change adds an endpoint whose
# name parameter reaches a shell at src/archive.js:5.
git init -q -b main "$tmp/target" && mkdir -p "$tmp/target/src" || exit 1
cat > "$tmp/target/package.json" <<'EOF'
{ "name": "reports", "version": "1.0.0", "private": true, "main": "src/server.js" }
EOF
cat > "$tmp/target/src/server.js" <<'EOF'
const http = require("node:http");
const { diskUsage } = require("./report");

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/usage") {
    diskUsage("data", (err, out) => res.end(err ? "error" : out));
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});

server.listen(8080, "127.0.0.1");
EOF
cat > "$tmp/target/src/report.js" <<'EOF'
const { execFile } = require("node:child_process");

function diskUsage(dir, done) {
  execFile("du", ["-sh", dir], (err, out) => done(err, out));
}

module.exports = { diskUsage };
EOF
git -C "$tmp/target" add -A && git -C "$tmp/target" commit -qm "Serve disk usage" || exit 1
BASE=$(git -C "$tmp/target" rev-parse HEAD)
git -C "$tmp/target" worktree add -q -b T-1 "$tmp/synthesis" || exit 1
cat > "$tmp/synthesis/src/archive.js" <<'EOF'
const { exec } = require("node:child_process");

// Pack the data directory into /tmp under the name the caller asks for.
function archive(name, done) {
  exec(`tar czf /tmp/${name}.tgz data`, (err) => done(err, `/tmp/${name}.tgz`));
}

module.exports = { archive };
EOF
python3 - "$tmp/synthesis/src/server.js" <<'EOF'
import sys
p = sys.argv[1]; s = open(p).read()
s = s.replace('const { diskUsage } = require("./report");\n',
              'const { diskUsage } = require("./report");\nconst { archive } = require("./archive");\n')
s = s.replace('  res.statusCode = 404;', '''  if (url.pathname === "/archive") {
    archive(url.searchParams.get("name") || "data", (err, path) => res.end(err ? "error" : path));
    return;
  }
  res.statusCode = 404;''')
open(p, "w").write(s)
EOF
git -C "$tmp/synthesis" add -A && git -C "$tmp/synthesis" commit -qm "Archive the data directory on request" || exit 1
SNAP=$(git -C "$tmp/synthesis" rev-parse HEAD)

printf '[lanes.sentinel]\nharness = "claude"\nmodel = "%s"\n' "$MODEL" > "$tmp/config.toml"
export POSTMASTER_CONFIG=$tmp/config.toml
"$ROOT/scripts/launch.sh" skill sentinel security-review > "$tmp/prompt.txt" || exit 1
"$ROOT/scripts/cut-scratch.sh" "$tmp/target" "$tmp/synthesis" "$tmp/target/.worktrees/T-1-rev-security-clone" "$SNAP" --clone "$BASE" >/dev/null 2>&1 || exit 1
"$ROOT/scripts/cut-scratch.sh" "$tmp/target" "$tmp/synthesis" "$tmp/target/.worktrees/T-1-rev-security-worktree" "$SNAP" >/dev/null 2>&1 || exit 1

for arm in clone worktree; do
  dest=$tmp/target/.worktrees/T-1-rev-security-$arm
  "$ROOT/scripts/launch.sh" launch sentinel "$dest" "$tmp/prompt.txt" > "$tmp/$arm.jsonl" 2> "$tmp/$arm.err"
  rc=$?
  python3 - "$tmp/$arm.jsonl" "$arm" "$rc" "$(wc -c < "$tmp/$arm.err")" "$(cat "$tmp/prompt.txt")" \
    "$(git -C "$dest" rev-parse --verify -q origin/HEAD >/dev/null && git -C "$dest" diff --name-only origin/HEAD... | tr '\n' ' ' || echo 'origin/HEAD does not resolve')" \
    "$(git --version)" "$(grep -n 'exec(' "$dest/src/archive.js")" > "$OUT/$arm.txt" <<'EOF'
import json, sys
path, arm, rc, errbytes, prompt, diff, gitv, planted = sys.argv[1:9]
ev = []
for line in open(path, encoding="utf-8", errors="replace"):
    try: ev.append(json.loads(line))
    except ValueError: pass
init = next((e for e in ev if e.get("type") == "system" and e.get("subtype") == "init"), {})
print("arm: %s" % arm)
print("prompt file: %s" % prompt)
print("planted: src/archive.js:%s" % planted.strip())
print("git: %s" % gitv)
print("diff against origin/HEAD in the scratch: %s" % diff.strip())
print("claude_code_version: %s" % init.get("claude_code_version"))
print("model: %s" % init.get("model"))
print("security-review offered: %s" % ("security-review" in (init.get("slash_commands") or [])))
print("exit: %s, stderr bytes: %s" % (rc, errbytes.strip()))
tools = {}
for e in ev:
    if e.get("type") == "assistant":
        for c in e["message"].get("content") or []:
            if c.get("type") == "tool_use":
                key = c["name"] + (" (subagent)" if e.get("parent_tool_use_id") else "")
                tools[key] = tools.get(key, 0) + 1
print("tool calls: %s" % (", ".join("%s %d" % kv for kv in sorted(tools.items())) or "none"))
results = [e for e in ev if e.get("type") == "result"]
print("result lines: %d" % len(results))
for i, r in enumerate(results, 1):
    print("result %d: subtype=%s is_error=%s num_turns=%s duration_ms=%s terminal_reason=%s" % (
        i, r.get("subtype"), r.get("is_error"), r.get("num_turns"), r.get("duration_ms"), r.get("terminal_reason")))
    print("  starts: %s" % (r.get("result") or "").strip().splitlines()[0][:100] if (r.get("result") or "").strip() else "  starts: (empty)")
print("--- the last result line's text ---")
print((results[-1].get("result") if results else None) or "(empty)")
EOF
done
echo "recorded $OUT/clone.txt and $OUT/worktree.txt"
