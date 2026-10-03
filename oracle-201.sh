#!/usr/bin/env bash
# Oracle for #201: blind acceptance tests at the ticket's interface, written before any
# lane's diff was read. Run from the repository root: ./oracle-201.sh
#
# Ground truth on this machine (established 2026-10-01 by running, not reading): Ubuntu
# 24.04, bwrap/socat/rg all installed, /etc/apparmor.d/bwrap present, and Bubblewrap
# starts (`bwrap --ro-bind / / --dev /dev --proc /proc -- true` exits 0), so confinement
# CAN run here and the probe must say `ready`. Branches this machine cannot reach
# (restricted namespaces, missing packages, macOS, unavailable) are SKIPs: the probe's
# own stubbed controls (AC7) cover them, and the synthesis checks them by running those.
#
# Fixed at synthesis (all three failures below were the oracle's, failing both lanes
# identically): the verdict is read from the `lane confinement:` footer line, since the
# approved spec requires the footer to explain all three words; the checked-tools grep
# accepts `bubblewrap`; and the stub set matches the setup self-test's (no `bash` stub,
# which silenced the wrapper through its shebang).
set -uo pipefail
fails=0
ok()   { printf '  ok   %s\n' "$1"; }
fail() { printf '  FAIL %s\n' "$1"; fails=$((fails+1)); }
skip() { printf '  SKIP %s (%s)\n' "$1" "$2"; }

[ -f scripts/probe-confine.sh ] || { fail "AC1: scripts/probe-confine.sh exists"; echo; echo "oracle-201: $fails failure(s)"; exit 1; }

# AC1: the probe exits 0 and prints ready (this machine's truth), not partial/unavailable.
out=$(scripts/probe-confine.sh 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "AC1: probe exits 0" || fail "AC1: probe exits 0 (got $rc): $out"
echo "$out" | grep -q "^  lane confinement: ready$" && ok "AC1: probe says ready on this machine" \
  || fail "AC1: probe says ready on this machine; got: $out"
echo "$out" | grep -qE "^  lane confinement: (partial|unavailable)$" \
  && fail "AC1: probe names no other verdict on this machine; got: $out" \
  || ok "AC1: probe names no other verdict on this machine"
echo "$out" | grep -qiE "bwrap|bubblewrap" && ok "AC1: probe output names what it checked" \
  || fail "AC1: probe output names what it checked"

# AC2/AC3: unreachable branches on this machine (namespaces work, nothing missing).
if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = "1" ] \
   && ! bwrap --ro-bind / / --dev /dev --proc /proc -- true >/dev/null 2>&1; then
  echo "$out" | grep -q "AppArmor" && ok "AC2: restricted machine names the AppArmor rule" \
    || fail "AC2: restricted machine names the AppArmor rule"
else
  skip "AC2: AppArmor rule naming" "Bubblewrap starts on this machine; covered by the probe's stubbed controls"
fi
missing=""; for t in bwrap socat rg; do command -v "$t" >/dev/null 2>&1 || missing="$missing $t"; done
if [ -n "$missing" ]; then
  echo "$out" | grep -qE "apt|dnf|pacman|brew" && ok "AC3: missing package names an install command" \
    || fail "AC3: missing package names an install command"
else
  skip "AC3: missing-package install command" "nothing missing on this machine; covered by the probe's stubbed controls"
fi
[ "$(uname -s)" = "Darwin" ] \
  && { echo "$out" | grep -qi "not been tried" && ok "AC4: macOS output says untried" || fail "AC4: macOS output says untried"; } \
  || skip "AC4: macOS verdict" "this machine is $(uname -s)"

# AC5: setup has the confine key, writes on/off, refuses anything else.
scripts/setup.sh --keys 2>/dev/null | grep -q "^confine" \
  && ok "AC5: setup --keys lists confine" || fail "AC5: setup --keys lists confine"
tmp=$(mktemp -d) || exit 1
trap 'rm -rf -- "$tmp"' EXIT
mkdir "$tmp/bin"
for h in claude codex grok agy muse mimo pi; do printf '#!/bin/sh\nexit 0\n' > "$tmp/bin/$h"; chmod +x "$tmp/bin/$h"; done
mkanswers() {  # mkanswers <name> <confine value>: full answer set, bash standing in for every harness
  { printf '%s\n' "lanes=alpha, beta" "lane.alpha.harness=bash" "lane.alpha.model=m1" \
      "lane.beta.harness=bash" "lane.beta.model=m2" "workhorses=alpha, beta" \
      "coachman.harness=bash" "coachman.model=judge" "fallback.harness=bash" "fallback.model=spare" \
      "postmaster.harness=bash" "postmaster.model=pm" "confine=$1"; } > "$tmp/$2.answers"
}
for v in on off; do
  mkanswers "$v" "$v"
  if PATH="$tmp/bin:$PATH" scripts/setup.sh --answers "$tmp/$v.answers" --config "$tmp/$v.toml" >"$tmp/$v.out" 2>&1; then
    grep -q "^confine = \"$v\"" "$tmp/$v.toml" && ok "AC5: confine=$v is written to the config" \
      || fail "AC5: confine=$v is written to the config"
  else
    fail "AC5: confine=$v is accepted (exit $?)"
  fi
done
mkanswers "maybe" "bogus"
if PATH="$tmp/bin:$PATH" scripts/setup.sh --answers "$tmp/bogus.answers" --config "$tmp/bogus.toml" >"$tmp/bogus.out" 2>&1; then
  fail "AC5: confine=maybe is refused"
else
  [ ! -e "$tmp/bogus.toml" ] && ok "AC5: confine=maybe is refused, nothing written" \
    || fail "AC5: confine=maybe is refused, nothing written"
fi
skip "AC5: on refused when unavailable" "probe says ready on this machine; covered by the setup tests"
grep -q "^confine" config.example.toml && ok "AC5: config.example.toml carries the confine key" \
  || fail "AC5: config.example.toml carries the confine key"
grep -q "probe-confine" AGENTS.md && ok "AC5: the setup conversation names the probe" \
  || fail "AC5: the setup conversation names the probe"

# AC6: the launch card says whether lanes run confined.
grep -qi "confin" skills/postmaster/SKILL.md \
  && ok "AC6: the launch card says whether lanes run confined" \
  || fail "AC6: the launch card says whether lanes run confined"

# AC7: the probe's self-test exists and passes (its stubbed ready/partial/unavailable controls).
[ -f scripts/probe-confine.test.ts ] && ok "AC7: scripts/probe-confine.test.ts exists" \
  || fail "AC7: scripts/probe-confine.test.ts exists"
if bun test scripts/probe-confine.test.ts >/dev/null 2>&1; then
  ok "AC7: the probe's tests pass"
else
  fail "AC7: the probe's tests pass"
fi

echo
[ "$fails" -eq 0 ] && { echo "oracle-201: all controls behaved"; exit 0; }
echo "oracle-201: $fails control(s) misbehaved"; exit 1
