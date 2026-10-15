# A sample of the findings the readers mark differently on `ticket_open`

37 findings differ between yes and not yes; 24 are drawn with seed 400.

## 105.4.1
Round 4, `scripts/host.sh:380`.
Text: failed root tag plus failed or id-less create leaves an untagged pane so close refuses the marked space
- A: **yes**, state: Ticket states no failed-tag or failed-create handling; leaving a closeable space is a choice.
- B: **no**, state: Ticket does not reach this failure path; leaving an untagged pane that close refuses is wrong anyway.

## 109.3.2
Round 3, `scripts/discover-project.ts:91`.
Text: discover runs verify.sh inside the target so its bunfig.toml preload executes and its .env loads as the user pre-confirmation; BASE ran python3 -I and nothing; overturns round-1 below-bar on wrapper loading
- A: **yes**, other: Criteria never say whether wrappers load the target's bunfig and .env; finding overturns round-1's below-bar call.
- B: **no**, other: BASE ran nothing from the target; running its preload and env file differs from BASE, overturning round 1.

## 110.4.1
Round 4, `scripts/clean-checkout.ts:120`.
Text: gate commands run with no timeout and no process-group containment (probe: helper waits on sleep 60 past 10s unbounded; child alive throughout), while verify.sh enforces 1800s with killpg and fixture sh() 1200s; a hanging gate wedges the ship leg; verified by execution+reading
- A: **no**, site: Missing guard; verify.sh already bounds gates at 1800s, so mirroring it is the sane answer.
- B: **yes**, site: Ticket never says what happens when the gate hangs; the timeout value and containment were chosen by the fix.

## 112.4.2
Round 4, `scripts/view-stream.sh:210`.
Text: fix, suppress restated result text)
- A: **yes**, input: Ticket never says whether a result event restating the last message prints; several behaviours are reasonable.
- B: **unclear**, input: Text is only a disposition fragment; it does not state what the finding claims.

## 122.7.1
Round 7, `scripts/launch.sh:907`.
Text: raw line veto matches json keys usage kills auto resume
- A: **no**, input: Criterion 2 resumes transient endings; veto matching JSON keys blocks every resume.
- B: **yes**, input: Ticket never says what the veto scans; ruling chose raw lines anywhere, finding objects, JSON keys then excluded.

## 122.7.2
Round 7, `scripts/launch.sh:763`.
Text: digit stems match inside ordinary numbers
- A: **no**, input: Criterion 2 resumes transient endings; digit stems wrongly match inside ordinary numbers.
- B: **yes**, input: Ticket never says how digit stems are bounded; the ruling's no-boundary choice lets ordinary numbers veto.

## 124.2.4
Round 2, `skills/postmaster/postmaster.md:221`.
Text: DISPATCH cannot tell post-landing crash from interrupted correction
- A: **yes**, state: Ticket never says how a restart tells a post-landing crash from an interrupted correction.
- B: **no**, state: The dispatcher must tell two states apart after a crash; one sane answer, nothing to choose.

## 124.2.5
Round 2, `skills/postmaster/postmaster.md:313`.
Text: pre-removal crash re-runs landing from the start
- A: **yes**, state: Ticket never says what a crash between landing and marker removal does on restart.
- B: **no**, state: A crash before marker removal must not redo landing; the one sane answer is an idempotent resume.

## 135.3.6
Round 3, `scripts/scrub-check.sh:571`.
Text: valid markers remove matches before logging, suppressed detections never reach the log
- A: **no**, state: Criterion 4 wants the allowance record reviewable; suppression leaving no trace defeats it.
- B: **yes**, other: Ticket asks only for a reviewable allow record; whether suppressed detections must also be logged is unstated.

## 135.4.3
Round 4, `L2 P2 OSC escapes unstriped`.
Text: CSI-split key flags, OSC-split silent
- A: **no**, input: Criterion 1 covers keys; CSI-split keys flag, so an OSC-split one has one sane answer.
- B: **yes**, input: Ticket says common shapes and calls the scan a backstop; how far escape sequences are looked through is unstated.

## 135.4.4
Round 4, `M1 P2 rewrite cannot plan redacted paths`.
Text: [redacted]:0 -> scan unreadable exit 2, line-0 and shaped-path findings unremediable
- A: **no**, contract: Criterion 3 has the user rule each suspect scrubbed or allowed; unremediable findings contradict that.
- B: **yes**, contract: Criterion 3 lists suspects by file and line without values; reporting a private-shaped path or line 0 is unstated.

## 135.4.5
Round 4, `O2 P2 JSON-escaped ANSI never stripped`.
Text: literal backslash-u001b wrap silent, raw ESC wrap flags
- A: **no**, input: Criterion 1 covers keys; the raw form flags, so the escaped form needs the same.
- B: **yes**, input: Ticket does not say which escape encodings are decoded before matching; raw versus JSON-escaped handling is a choice.

## 135.4.6
Round 4, `O3 P2 single-level JSON decode`.
Text: depth-2 silent, depth-1 flags, promote copies depth-2 identical
- A: **no**, input: The ticket's origin is a transcript; depth-1 flags, so depth-2 silent has one sane answer.
- B: **yes**, input: Ticket does not say how deeply nested JSON encodings are decoded; any bound is a choice.

## 163.2.2
Round 2, `skills/postmaster/postmaster.md:336`.
Text: detector file ambiguous across three mappings and read from branch-controlled tip, which can redirect to any BASE file; definition names it without a directory (exit 128)
- A: **yes**, contract: Ticket never says which copy or location names the detector file, or whose version is trusted.
- B: **no**, contract: Ambiguous detector name and a path without a directory (exit 128); wording defects with one sane fix.

## 201.2.1
Round 2, `scripts/probe-confine.ts:149`.
Text: Refuse AppArmor rules for user-writable Bubblewrap paths: On Ubuntu 24.04+ when `bwrap` is found in a user-writable directory such as `<path>, this condition offers a root-run AppArmor rule for that path. The user can then replace the executable, so the rule's `userns` permission is no longer limited to Bubblewrap. Resolve the executable and verify that it and its parent directories are not user-writable before offe…
- A: **no**, input: Criterion 2 names a rule that lets only Bubblewrap create namespaces; a user-writable path breaks that.
- B: **yes**, input: Ticket never says what the probe does when bwrap is in a user-writable directory; several reasonable handlings exist.

## 202.5.2
Round 5, `scripts/reach.ts:415`.
Text: Treat bare write operands as paths: When a lane runs `cd <path> && touch newfile` or `mkdir newdir`, the new basename is neither an existing path nor slash- or extension-shaped, so this predicate drops it and records no write. Because the path is outside the target repository, the main-checkout scan cannot catch it, and the point can be logged clean. Treat non-option operands of known write commands as paths, or fai…
- A: **no**, input: D8 makes any outside write a finding; the named operand of touch is missed.
- B: **yes**, input: Ticket does not say which command operands count as paths; an earlier fix narrowed this and the finding widens it.

## 266.3.1
Round 3, `scripts/host.ts:2873`.
Text: stop-pidfile exits 0 leaving orphaned group members; verified by execution
- A: **no**, state: AC6 requires the same stops as the removed code; orphaned group members are left running.
- B: **yes**, state: Ticket never says what stop does when the leader is gone but members remain; fix chose identity checking.

## 268.4.1
Round 4, `scripts/lib/switch-offs.ts:677`.
Text: Give identical suppressions distinct approval identities: When two identical directives in the same file cover identical code windows, these hash inputs are identical, so both entries receive the same ID. Approving one then marks both approved, allowing the branch to land without the user's decision on the second suppression. Include a stable per-occurrence discriminator that survives line moves.
- A: **no**, input: Criterion 6 says each switch-off approved; identical ones sharing one identity breaks it.
- B: **yes**, input: Criterion 6 says approve each one but D8 identifies by comment and code; identical duplicates are unspecified.

## 323.3.1
Round 3, `scripts/verifier.ts:543`.
Text: cleanup runs even when the stop failed, deleting a possibly live session checkout and branch
- A: **yes**, state: Ticket states no failure cleanup policy; deleting after a failed stop is a choice among policies.
- B: **no**, state: Deleting a possibly live session checkout is a missing guard; one sane answer is not to clean up.

## 335.7.1
Round 7, `scripts/lib/effective-config.ts:1105`.
Text: A global config path that exists but is not a regular file (a directory or dangling symlink) is treated as absent, with no error.: <path> is a dangling symlink and the project has a complete settings.toml. effectiveConfigForProject sets global to null, returns the project-only config with exit 0 and no notice, and the launch or front-door decision runs without the machine's team, limits and tracker defaults. Without…
- A: **no**, input: Run line calls it a regression from the base; silently dropping the machine's config has one sane answer.
- B: **yes**, input: Ticket says complete project settings need no global config, not what happens when that path exists but is unreadable.

## 335.7.2
Round 7, `scripts/launch.ts:140`.
Text: In `--run` mode, and `scripts/launch.ts:240-241` get no project base.: So the same setting names `<project>/x.env` for a `--project` launch, such as the postmaster or the clerk, and a file beside the global config for a `--run` launch.
- A: **yes**, site: Ticket never says what a relative env_file is relative to; the same choice must reach --run launches.
- B: **no**, input: The same setting resolves differently for project and run launches; one sane answer is a shared base.

## 38.6.2
Round 6, `skills/postmaster/coachman.md:628`.
Text: non-zero-exit rule has no mechanism
- A: **no**, contract: Sentence promises behaviour no script provides; any reading requires fixing the words or the code.
- B: **yes**, contract: Ticket does not say what a non-zero review exit means; fix chose between implementing the rule and dropping it.

## 38.8.2
Round 8, `scripts/review-findings.py:417`.
Text: word:number prose filed as junk finding
- A: **no**, input: AC7 requires loud failure on unparseable output; prose word:number read as a location is a plain bug.
- B: **yes**, input: Ticket does not say which location shapes count; tightening trades against names like Makefile:8.

## 57.2.4
Round 2, `scripts/host.sh:2006`.
Text: stderr gate misses bare wall wordings, HTTP status and bare API terms
- A: **no**, input: Criterion 5 requires walls caught before the first event; missed wordings are a defect.
- B: **yes**, input: Ticket makes walled an outcome but never says which stderr wordings or status numbers count as a wall.

