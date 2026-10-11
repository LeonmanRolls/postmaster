# Where the late severe findings sit

The 99 severe findings of review rounds 4 and later in the nine runs that had any ([#57](https://github.com/brindlewick/postmaster/issues/57), [#109](https://github.com/brindlewick/postmaster/issues/109), [#110](https://github.com/brindlewick/postmaster/issues/110), [#122](https://github.com/brindlewick/postmaster/issues/122), [#124](https://github.com/brindlewick/postmaster/issues/124), [#135](https://github.com/brindlewick/postmaster/issues/135), [#163](https://github.com/brindlewick/postmaster/issues/163), [#179](https://github.com/brindlewick/postmaster/issues/179), [#202](https://github.com/brindlewick/postmaster/issues/202)), tagged by mechanism. Round 4 is the first round past the flow's cap of three, so each of these rounds ran on the user's ruling. For [#135](https://github.com/brindlewick/postmaster/issues/135) the 12 lines of rounds 4 and 5 are included, 11 of them gating lines with no severity. The tags are defined in [the method](../method.md). Each finding was tagged from its logged text alone, in a shuffled list without run, round or ticket, by three readers: this session and two further readers.

## Counts

| Tag | Findings (majority of three) | Share |
| --- | --- | --- |
| M1 reads or classifies an open input | 32 | 32% |
| M2 differs from another implementation | 27 | 27% |
| M3 forecasts what a command will do | 8 | 8% |
| M4 state, ordering or concurrency | 18 | 18% |
| M5 other | 14 | 14% |
| M1, M2 and M3 together | 67 | 68% |

Agreement of the three readers: all three gave the same tag on 82 of 99 findings, at least two on 99. Pairwise agreement on 87, 87 and 89 of 99; Cohen's kappa 0.84, 0.84 and 0.87 (this session with the first reader, with the second, and the two readers with each other). Where the three differ, the majority tag is used; no finding had three different tags.

## What is not in the list

Findings with no logged text. [#124](https://github.com/brindlewick/postmaster/issues/124) has finding lines for rounds 4, 19 and 20 only; its own review checkpoint lists 67 more severe findings in rounds 5 to 18, by count and by the fixes made, and none has a text of its own, so none can be tagged. [#109](https://github.com/brindlewick/postmaster/issues/109) has none for rounds 7 and 11, about 7 severe findings by its checkpoint. [#135](https://github.com/brindlewick/postmaster/issues/135)'s round 4 has 11 gating lines with no severity, which are in the list. The list is therefore the findings the coachman logged one by one, and it under-counts the late findings of the runs that logged them as a batch.

## By run

| Run | Late severe findings | M1 | M2 | M3 | M4 | M5 |
| --- | --- | --- | --- | --- | --- | --- |
| [#57](https://github.com/brindlewick/postmaster/issues/57) | 5 | 0 | 0 | 0 | 4 | 1 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 37 | 4 | 25 | 0 | 1 | 7 |
| [#110](https://github.com/brindlewick/postmaster/issues/110) | 2 | 0 | 1 | 0 | 0 | 1 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | 18 | 15 | 0 | 0 | 2 | 1 |
| [#124](https://github.com/brindlewick/postmaster/issues/124) | 5 | 0 | 0 | 0 | 5 | 0 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | 12 | 10 | 0 | 0 | 1 | 1 |
| [#163](https://github.com/brindlewick/postmaster/issues/163) | 3 | 1 | 0 | 0 | 1 | 1 |
| [#179](https://github.com/brindlewick/postmaster/issues/179) | 2 | 0 | 1 | 0 | 1 | 0 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | 15 | 2 | 0 | 8 | 3 | 2 |

## The control: round 1 of the same runs

If the late findings sat in these mechanisms only because these runs' code is full of them, round 1 would show the same mix. The 92 severe findings of round 1 of the same nine runs were tagged in the same way, in a shuffled list without run or ticket, by this session and by one further reader. They agree on 61 of 92 (kappa 0.54, against 0.84 to 0.87 for the late findings), mostly at the boundary between a reader of command text (M1) and a forecast of what a command will do (M3) in [#202](https://github.com/brindlewick/postmaster/issues/202), and on the contract map of [#163](https://github.com/brindlewick/postmaster/issues/163).

| Tag | Round 1, this session | Round 1, reader | Rounds 4 and later, majority of three |
| --- | --- | --- | --- |
| M1 reads or classifies an open input | 26 (28%) | 18 (20%) | 32 (32%) |
| M2 differs from another implementation | 11 (12%) | 6 (7%) | 27 (27%) |
| M3 forecasts what a command will do | 2 (2%) | 11 (12%) | 8 (8%) |
| M4 state, ordering or concurrency | 17 (18%) | 19 (21%) | 18 (18%) |
| M5 other | 36 (39%) | 38 (41%) | 14 (14%) |
| M1, M2 and M3 together | 39 (42%) | 35 (38%) | 67 (68%) |

Findings in a reader of open input, in a difference from a reference or in a forecast are 38% to 42% of round 1 and 68% of the late rounds. Plain defects, M5, fall from about 40% to 14%. Two cautions. Three runs supply 70 of the 99 late findings ([#109](https://github.com/brindlewick/postmaster/issues/109), [#122](https://github.com/brindlewick/postmaster/issues/122) and [#202](https://github.com/brindlewick/postmaster/issues/202)), and [#124](https://github.com/brindlewick/postmaster/issues/124)'s 67 late findings could not be tagged. And whatever a ticket asked for, the defects that survive early rounds are the ones hard to enumerate, so the late mix would lean this way for any ticket; this is consistent with the shapes being where loops fail to converge, and is not evidence for the rules by itself.

## Every finding

| Run | Round | Sev. | Target | Finding as logged | This session | Reader 1 | Reader 2 | Majority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [#57](https://github.com/brindlewick/postmaster/issues/57) | 4 | P2 | scripts/runs-status.sh | bug mimo+luna execution: gap detector blind to intent-without-phase, stale NEXT buries refused resume | M4 | M4 | M4 | M4 |
| [#57](https://github.com/brindlewick/postmaster/issues/57) | 4 | P2 | scripts/host.sh | bug mimo execution: unrecorded STARTED later launch ignored, earlier attempt steals its thread | M4 | M4 | M4 | M4 |
| [#57](https://github.com/brindlewick/postmaster/issues/57) | 4 | P2 | skills/postmaster/postmaster.md | bug mimo reading: leg retry runs from live tool, not the run pinned checkout | M5 | M5 | M5 | M5 |
| [#57](https://github.com/brindlewick/postmaster/issues/57) | 4 | P2 | scripts/host.sh | bug luna execution: stale done marker finishes a gap-B attempt, skips hand-off completion | M4 | M4 | M4 | M4 |
| [#57](https://github.com/brindlewick/postmaster/issues/57) | 5 | P1 | scripts/runs-status.sh | bug mimo+luna execution: incomplete outcome beats spec-review-ready, planning pause reads RESUME never SPEC | M4 | M4 | M4 | M4 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 4 | P2 | scripts/launch.ts | bug/luna: resume export check sources the env file before entering CWD;  | M4 | M4 | M4 | M4 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 4 | P1 | scripts/launch.ts | bug/luna+bug/mimo: env-file stdout parsed as the env dump, NUL-injected vars, streams swallowed;  | M1 | M1 | M1 | M1 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 4 | P2 | scripts/launch.ts | bug/mimo: dumponuke control asserts the ENOENT rc, never the handed-on env, and its unset-everything premise still dumps SHLVL;  | M5 | M5 | M5 | M5 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 4 | P2 | scripts/launch.ts | bug/mimo: dump spawn has no maxBuffer, a 1.2MB env self-SIGTERMs the launch (rc 143);  | M5 | M5 | M5 | M5 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 4 | P2 | scripts/local.ts | bug/luna: ticket load replaces bad bytes (rc 0 + U+FFFD), BASE refuses the ticket (rc 1);  | M2 | M2 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 4 | P1 | scripts/launch.ts | bug/luna+bug/mimo: exit-0/exec-true before the dump launches on an emptied env (rc 1), BASE exits 0 without launching;  | M2 | M2 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 5 | P2 | scripts/launch.ts | bug/mimo: prompt/stdin bytes decoded utf8 (U+FFFD), BASE passes raw;  | M2 | M2 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 5 | P2 | scripts/verify.ts | bug/mimo: journey-path dispatch dir interpolated into bash -c, payload executes, BASE literal;  | M5 | M5 | M2 | M5 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 5 | P1 | scripts/launch.ts | bug/mimo+bug/luna: no-env-file launch hands stale caller PWD (or unset), BASE hands the worktree;  | M2 | M2 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 5 | P1 | scripts/launch.ts | bug/mimo: harness name interpolated into sh -c via JSON quoting, payload executes, BASE literal;  | M5 | M5 | M2 | M5 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 6 | P2 | scripts/verify-examples.ts | bug/luna: shebang split breaks quoted args, BASE shlex keeps them;  | M2 | M2 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 6 | P2 | scripts/fixture.ts | bug/luna: appFiles ignores git exit code, BASE check=True fails; + reading | M2 | M5 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 6 | P2 | scripts/launch.ts | bug/mimo: file-as-CWD says cannot-enter + writes codex trust, BASE says no-such-directory untouched;  | M2 | M2 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 6 | P2 | scripts/plane.ts | bug/luna: fetch has no 30s deadline, BASE urlopen timeout=30;  | M2 | M5 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 6 | P2 | scripts/fixture.ts | bug/luna: score sh() has no 1200s timeout, BASE aborts with message; + mechanism | M2 | M5 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 6 | P2 | scripts/launch.ts | bug/mimo: export check sees stale PWD/OLDPWD/SHLVL, BASE cds first;  | M2 | M2 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 6 | P1 | scripts/launch.ts | bug/mimo: harnessData key is *31 + lexical resolve, BASE is cksum + pwd -P; resume misses BASE-laid sessions;  | M2 | M2 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 6 | P2 | scripts/verify-examples.ts | bug/luna: example shells have no 60s timeout, BASE reports timeout; + mechanism | M2 | M5 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 8 | P2 | scripts/local.ts | bug/luna: gate executes python3 via extracted BASE (39 execs in local+launch self-tests) and fails closed without it; oracle AC1 blind; ; conflicts with r8 finding-1 BASE | M5 | M5 | M5 | M5 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 8 | P2 | scripts/tool-faults.ts | bug/mimo: safe.key toLowerCase + ASCII word class vs BASE casefold + Unicode; fault ids split on non-ASCII failed text (harvest e2e: tf-d298976d vs tf-ef295d74);  | M2 | M2 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 9 | P2 | scripts/fixture.ts | security/opus: sectionOf $ vs BASE \Z returns first line only, mis-matching checkHidden; on the repo tickets | M2 | M2 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 9 | P2 | scripts/tool-faults.ts | coachman: IPV4_RE ASCII \w lookbehind + \d vs BASE Unicode; over-withholds after non-ASCII, publishes Arabic-digit IP raw; , both harvest CLIs | M2 | M2 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 9 | P2 | scripts/tool-faults.ts | bug/luna+mimo security/opus: EMAIL_RE ASCII \w vs BASE Unicode \w; non-ASCII addresses leak through publish (BASE [address]); , both harvest CLIs | M2 | M2 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 9 | P2 | scripts/tool-faults.ts | bug/luna+mimo: sameRepo toLowerCase vs BASE casefold; Strasse remotes rejected; , real functions over real git | M2 | M2 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 9 | P2 | scripts/tool-faults.ts | bug/luna: isdigit sites ASCII \d vs BASE str.isdigit + Unicode \d (WTOK/TICKS/looks/key-tail/names-filter); Arabic digits mishandled;  | M2 | M2 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 9 | P2 | scripts/tool-faults.ts | bug/luna+mimo: FAULT_ID_RE ASCII \b vs BASE Unicode \b; id split + held verbatim in publish; HEX_RE same flaw, no end-to-end bite;  | M2 | M2 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 9 | P2 | scripts/tool-faults.ts | bug/luna: names gi vs BASE re.I; ſ-name missed, grouping splits; , both harvest CLIs | M2 | M2 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 9 | P2 | scripts/tool-faults.ts | bug/mimo: KEY_RE ASCII-\w lookbehind vs BASE Unicode; false ticket key after non-ASCII letters; , both harvest CLIs | M2 | M2 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 10 | P1 | scripts/lib/text.ts | bun run check exits 1 at HEAD (noUnreachable + wiki-lint format); luna mimo | M5 | M5 | M5 | M5 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 10 | P2 | scripts/lib/text.ts | Nd match/convert skew U+10D40 (ICU17 matches, U15 table throws; BASE rejects); luna | M2 | M2 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 10 | P2 | scripts/lib/text.ts | guard slips 5 forms (string-shield, space, multiline, alias, indirect); mimo luna | M1 | M1 | M1 | M1 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 10 | P2 | scripts/verify-journey.ts | split-newline vs splitlines (2 sites); in-class, overturns card vj-lines; mimo | M2 | M2 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 10 | P2 | oracle-109.sh | AC1 classifier FP on comment+test-python, FN on execFileSync; luna | M1 | M1 | M1 | M1 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 12 | P1 | scripts/runs-watch.ts | bug/luna+mimo: watchHost omits --under, host refuses every automatic dispatch/remount; INTENDED divergence, BASE watch_host needs the same line; , negative control refuse | M5 | M5 | M5 | M5 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 12 | P2 | scripts/launch.ts | bug/luna+mimo: MESSAGE_KEYS capital Detail never matches the lowercased lookup, detail-held transient prose misclassifies not-transient; , 2 controls fail before pass aft | M1 | M1 | M1 | M1 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 12 | P2 | scripts/verify-examples.ts | security/opus near-miss, fidelity: fence open/close exactly-3 vs BASE 3+, longer runs misread; , 3 controls plus python cross-check agree | M2 | M2 | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 12 | P2 | scripts/runs-watch.ts | security/opus near-miss, fidelity: repoFromBrief m-flag anchors match after U+2028/29 vs BASE re.M newline-only; , control plus python cross-check agree, PY_M_START now,  | M2 | M2 | M2 | M2 |
| [#110](https://github.com/brindlewick/postmaster/issues/110) | 4 | P2 | scripts/clean-checkout.ts | bug luna: gate commands run with no timeout and no process-group containment (probe: helper waits on sleep 60 past 10s unbounded; child alive throughout), while verify.sh | M5 | M5 | M2 | M5 |
| [#110](https://github.com/brindlewick/postmaster/issues/110) | 4 | P2 | scripts/discover-project.sh | bug mimo: gate runner still collapses to pnpm-or-npm while install= follows pm() order (probe: yarn.lock gets yarn install + npm run check), so Yarn Berry PnP (no node_mo | M2 | M2 | M2 | M2 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | 4 | P2 | scripts/launch.sh | bug luna mimo wall-matcher-misses-natural-provider-phrasings | M1 | M1 | M1 | M1 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | 5 | P2 | scripts/launch.sh | bug mimo structured-wall-types-miss-common-names-consumed-before-prose | M1 | M1 | M1 | M1 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | 5 | P2 | scripts/launch.sh | bug mimo wall-span-three-words-misses-real-quota-text | M1 | M1 | M1 | M1 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | 5 | P2 | scripts/launch.sh | bug mimo wall-trailing-boundary-misses-snake-case-suffix | M1 | M1 | M1 | M1 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | 6 | P2 | scripts/launch.sh | bug luna mimo stream-veto-windowed-to-100-lines-early-wall-missed | M1 | M1 | M1 | M1 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | 6 | P2 | scripts/launch.sh | bug mimo stemless-slow-down-wall-text-resumes | M1 | M1 | M1 | M1 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | 7 | P2 | scripts/launch.sh | bug mimo digit-stems-match-inside-ordinary-numbers | M1 | M1 | M1 | M1 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | 7 | P2 | scripts/launch.sh | bug luna unknown-structured-outside-window-missed | M1 | M1 | M1 | M1 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | 7 | P1 | scripts/launch.sh | bug mimo raw-line-veto-matches-json-keys-usage-kills-auto-resume | M1 | M1 | M1 | M1 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | 8 | P2 | scripts/launch.sh | bug mimo luna veto-key-allowlist-misses-wall-fields | M1 | M1 | M1 | M1 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | 9 | P2 | scripts/runs-watch.sh | bug mimo unvalidated-manifest-leg-misdispatches-or-kills-watcher | M5 | M5 | M5 | M5 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | 9 | P2 | scripts/launch.sh | bug luna uncapped-host-notice-vetoes-every-uncapped-launch | M1 | M1 | M1 | M1 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | 9 | P2 | scripts/launch.sh | bug mimo marked-gate-misses-attested-error-shapes | M1 | M1 | M1 | M1 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | 10 | P2 | scripts/launch.sh | bug mimo marked-gate-one-level-deep-misses-nested-error-records | M1 | M1 | M1 | M1 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | 10 | P2 | scripts/runs-watch.sh | bug mimo refused-resume-logged-as-success-no-same-look-wake | M4 | M4 | M4 | M4 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | 11 | P2 | scripts/runs-watch.sh | bug mimo refusal_since-misses-refusals-after-production-err-truncate | M1 | M4 | M4 | M4 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | 11 | P2 | scripts/launch.sh | bug mimo numeric-2xx-3xx-status-blocks-auto-resume | M1 | M1 | M1 | M1 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | 12 | P2 | scripts/launch.sh | bug luna tool-subtree-503-authorizes-remount | M1 | M1 | M1 | M1 |
| [#124](https://github.com/brindlewick/postmaster/issues/124) | 4 | P2 | skills/postmaster/postmaster.md | lens bug lanes mimo card comparison cannot decide unlogged checks | M4 | M4 | M4 | M4 |
| [#124](https://github.com/brindlewick/postmaster/issues/124) | 4 | P1 | skills/postmaster/postmaster.md | lens bug lanes luna skip fires on empty branch once main moves | M4 | M4 | M4 | M4 |
| [#124](https://github.com/brindlewick/postmaster/issues/124) | 4 | P2 | skills/postmaster/postmaster.md | lens bug lanes mimo applied versus closed conflated without explicit final states | M4 | M4 | M4 | M4 |
| [#124](https://github.com/brindlewick/postmaster/issues/124) | 19 | P2 | scripts/landing.sh | lens bug lanes luna unresolvable --pr-head exits 1, deadlocks the pruned-branch report path | M4 | M4 | M4 | M4 |
| [#124](https://github.com/brindlewick/postmaster/issues/124) | 20 | P2 | skills/postmaster/postmaster.md | lens bug lanes luna,mimo step-3 re-verify covers only the ticket-moved cause, restore-branch loops on a reported another head | M4 | M4 | M4 | M4 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | 4 | - | O1 P1 PEM body survives scrub | opus execution: promote replaces header only, body+END land in raw/, gates pass | M1 | M1 | M1 | M1 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | 4 | - | O2 P2 JSON-escaped ANSI never stripped | opus execution: literal backslash-u001b wrap silent, raw ESC wrap flags | M1 | M1 | M1 | M1 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | 4 | - | O6 P2 key formats undetected | opus execution: PGP/PuTTY/SSH2/age silent | M1 | M1 | M1 | M1 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | 4 | - | L2 P2 OSC escapes unstriped | luna execution: CSI-split key flags, OSC-split silent | M1 | M1 | M1 | M1 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | 4 | - | O8 P2 partial overlap leaks | opus execution: user@domain home keeps @domain tail, report claims both scrubbed, recheck clean | M1 | M1 | M1 | M1 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | 4 | - | O4 P2 in-string next-line marker silences next record | opus execution: record-1 marker suppresses record-2 email, copied verbatim, logged via marker | M1 | M1 | M1 | M1 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | 4 | - | O7 P2 stage-3 merge on main unscanned | opus execution: main..HEAD empty after dirty merge; voided round-2 disposition challenged | M4 | M4 | M4 | M4 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | 4 | - | O3 P2 single-level JSON decode | opus execution: depth-2 silent, depth-1 flags, promote copies depth-2 identical | M1 | M1 | M1 | M1 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | 4 | - | M1 P2 rewrite cannot plan redacted paths | mimo execution: [redacted]:0 -> scan unreadable exit 2, line-0 and shaped-path findings unremediable | M5 | M1 | M1 | M1 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | 4 | - | O5 P2 compound secret names pass | opus execution: aws_secret_access_key/db_password/POSTGRES_PASSWORD silent, password: flags; M2 duplicate | M1 | M1 | M1 | M1 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | 4 | - | L1 P2 DISABLED reaches gate via env | luna execution+reading: var blinds scanner exit 0, verify inherits os.environ, notice only in per-check log | M5 | M5 | M5 | M5 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | 5 | - | scripts/scrub-check.sh F1-F8 | coachman execution: round-5 P2 fixes ANSI strip, merge names, tree -m, dotenv+alphabet, PuTTY v3, host-pathed homes, pass names+suffixes, scratch-tail span; suite control | M1 | M1 | M1 | M1 |
| [#163](https://github.com/brindlewick/postmaster/issues/163) | 4 | P2 | skills/postmaster/postmaster.md | bug luna introduction branch moving post-score hits contradictory clauses, repeat demands running a BASE copy that does not exist | M4 | M4 | M4 | M4 |
| [#163](https://github.com/brindlewick/postmaster/issues/163) | 4 | P2 | docs/coachman-contract.toml | bug luna marker lifecycle transitions the definition requires are unmapped; edits to the card-ready retouch and removal sentences classify exit 0 | M1 | M4 | M1 | M1 |
| [#163](https://github.com/brindlewick/postmaster/issues/163) | 5 | P2 | scripts/coachman-contract.sh | bug luna git show failure returns None for any reason, so a corrupt index blob at both revs reports no contract change instead of erroring | M5 | M5 | M5 | M5 |
| [#179](https://github.com/brindlewick/postmaster/issues/179) | 4 | P2 | scripts/summary-evidence.ts | bug mimo execution: bare hash heading ends the section in the oracle but not here; control reads 1 criterion, script reads [1,2] | M2 | M2 | M2 | M2 |
| [#179](https://github.com/brindlewick/postmaster/issues/179) | 4 | P2 | skills/postmaster/coachman.md | bug mimo execution: transcript citation has no legal home when all criteria are not-shown; mixes on an entry, not-in-ticket as a new one | M5 | M4 | M4 | M4 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | 4 | P1 | scripts/reach.ts | bug-mimo glob-unresolved-var-reads-clean  | M3 | M3 | M3 | M3 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | 4 | P1 | scripts/reach.ts | bug-mimo redirect-substitution-demoted-to-read  | M3 | M3 | M3 | M3 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | 5 | P2 | scripts/reach.ts | bug-luna bare-write-operand-dropped  | M3 | M3 | M3 | M3 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | 5 | P2 | scripts/reach.ts | bug-mimo file-tool-unresolved-dropped  | M1 | M3 | M3 | M3 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | 5 | P2 | skills/postmaster/coachman.md | bug-mimo restore-ungated-on-fault  | M4 | M4 | M5 | M4 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | 5 | P2 | scripts/landing.ts | bug-luna card-prints-raw-notchecked  | M5 | M5 | M5 | M5 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | 6 | P2 | scripts/reach.ts | bug-mimo nonpath-args-notchecked  | M1 | M3 | M3 | M3 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | 7 | P2 | scripts/reach.ts | bug-mimo cp-roles-subst  | M3 | M3 | M3 | M3 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | 7 | P2 | scripts/reach.ts | bug-mimo sed-long-inplace  | M3 | M3 | M3 | M3 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | 7 | P2 | scripts/reach.ts | bug-luna restore-deleted-ref  | M4 | M4 | M4 | M4 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | 7 | P1 | scripts/reach.ts | bug-mimo subst-split-hides-write  | M3 | M3 | M3 | M3 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | 7 | P2 | scripts/reach.ts | bug-luna spaced-repo-fault  | M5 | M1 | M1 | M1 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | 8 | P2 | scripts/landing.ts | bug-53 the card prints unresolved non-absolute paths verbatim (security lens) | M5 | M5 | M5 | M5 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | 9 | P2 | scripts/reach.ts | bug-58 only the first tied reviewer is voided | M4 | M4 | M5 | M4 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | 9 | P2 | scripts/reach.ts | bug-57 the synthesis guard passes a symlinked worktree, restore then resets the main checkout | M5 | M1 | M1 | M1 |

## Every round-1 finding of the same runs

| Run | Sev. | Target | Finding as logged | This session | Reader |
| --- | --- | --- | --- | --- | --- |
| [#57](https://github.com/brindlewick/postmaster/issues/57) | P2 | scripts/runs-status.sh | bug luna bug mimo execution: status side of the ownerless-lock wedge, active lock without exited reads WAIT; filed with host.sh:1909 as one defect | M4 | M4 |
| [#57](https://github.com/brindlewick/postmaster/issues/57) | P2 | scripts/host.sh | bug mimo execution: corrupt JSONL drops all records, retry crashes unbound variable | M1 | M4 |
| [#57](https://github.com/brindlewick/postmaster/issues/57) | P2 | scripts/runs-status.sh | style luna execution: status trusts records[-1] with no currency check, stale finished dispatches | M4 | M4 |
| [#57](https://github.com/brindlewick/postmaster/issues/57) | P2 | scripts/launch.sh | security opus execution: POSTMASTER_ATTEMPT_PHASE leaks to harness, later launch.sh overwrites refused | M5 | M4 |
| [#57](https://github.com/brindlewick/postmaster/issues/57) | P2 | skills/postmaster/postmaster.md | style luna bug luna reading: ASK never calls leg waiting add/remove, list omits ASK runs | M4 | M4 |
| [#57](https://github.com/brindlewick/postmaster/issues/57) | P2 | scripts/host.sh | style luna bug mimo execution: resume rescans prior attempts wall events, retry loops walled | M4 | M4 |
| [#57](https://github.com/brindlewick/postmaster/issues/57) | P2 | scripts/host.sh | bug luna reading: real cap kill takes the record writer, attempt unrecorded | M4 | M4 |
| [#57](https://github.com/brindlewick/postmaster/issues/57) | P2 | scripts/host.sh | bug mimo execution: classifier crashes on unparseable run.json, no record | M1 | M4 |
| [#57](https://github.com/brindlewick/postmaster/issues/57) | P2 | scripts/host.sh | bug mimo execution: wall terms match prose and cap wording, false walls | M1 | M1 |
| [#57](https://github.com/brindlewick/postmaster/issues/57) | P2 | scripts/host.sh | style luna bug mimo execution: concurrent starts both run, steal rmdir/mkdir race plus fresh-lock removal | M4 | M4 |
| [#57](https://github.com/brindlewick/postmaster/issues/57) | P2 | scripts/host.sh | bug luna bug mimo execution: lock without exited wedges WAIT and refuses recovery | M4 | M4 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | P2 | scripts/lib/proc.ts | style luna spawnSync error dropped, nonexistent command returns code 1 silent (bash 127 + diagnostic) | M2 | M5 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | P1 | scripts/launch.ts | bug mimo env_file parsed, not sourced as shell (export/quotes/comments diverge); resume :552 same class | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | P2 | oracle-109.sh | style luna bug luna style mimo bug mimo AC1 python grep flags INTERPRETERS vocabulary string (same vocabulary in BASE), not executable code | M1 | M1 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | P2 | scripts/wait-for-markers.ts | bug mimo 'lands during the wait' marker pre-exists (spawnSync waits for bg job); clock-jump control is a plain timeout | M4 | M5 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | P2 | scripts/ticket-check.ts | bug mimo title word-check ASCII-only, Japanese title reads missing (BASE accepts) | M2 | M1 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | P2 | scripts/log-action.ts | bug mimo legitimate U+FFFD dropped from detail (BASE keeps it) | M2 | M1 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | P2 | scripts/verify-library.ts | style mimo same URL.pathname SELF defect as verify-journey.ts:307 (spaced path) | M5 | M1 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | P2 | scripts/turnpikes.ts | bug luna mimo --list controls check names/marks/legs only, truncation to first word still exits 0 | M5 | M5 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | P2 | scripts/verify-journey.ts | style mimo SELF via URL.pathname percent-encodes (spaced path -> 127); use scriptsDir | M5 | M1 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | P2 | scripts/host.ts | bug mimo readSpec filter(Boolean) drops interior empty argv elements the writer preserves | M5 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | P2 | oracle-109.sh | style luna bug luna style mimo bug mimo AC4 import regex scans raw text, flags fixture template strings (sample-lib) and prose | M1 | M1 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | P1 | scripts/launch.ts | bug mimo relative env_file resolves against run.json dir under --run, BASE uses live config dir | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | P2 | scripts/verify-examples.ts | style mimo same URL.pathname SELF defect as verify-journey.ts:307 (spaced path) | M5 | M1 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | P2 | scripts/style-findings.ts | style mimo timeout 120s passed as any is dropped by run() (sleep 5 + timeout 200 runs full 5s) | M5 | M5 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | P2 | scripts/turnpikes.ts | bug mimo Cf approx misses U+2066-U+2069, U+00AD and more (BASE strips all Cf) | M2 | M1 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | P2 | scripts/local.ts | bug mimo legitimate U+FFFD title rejected as not UTF-8 (BASE creates it) | M2 | M1 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | P1 | scripts/stage.ts | bug mimo stage duration always NaNs (appends Z to a ts that has one); self-test :235 asserts only 'after' | M5 | M5 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | P2 | scripts/launch.ts | bug mimo bypass negative controls vacuous (stripped copies crash on missing lib, rc=1 for the wrong reason) | M5 | M5 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | P1 | scripts/verify.ts | bug mimo replace(" /g") no-op logs result=not run, unreadable by DETAIL_RE | M5 | M5 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | P2 | scripts/launch.ts | bug mimo PTEXT keeps trailing newlines (BASE strips via command substitution); self-test strips both sides | M2 | M2 |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | P2 | scripts/local.ts | bug luna mimo lock reaped by 60s mtime even when owner pid is alive (BASE flock holds) | M2 | M4 |
| [#110](https://github.com/brindlewick/postmaster/issues/110) | P2 | scripts/clean-checkout.ts | bug luna: git worktree add leaves submodules unpopulated, so a gate reading submodule contents fails though it passes in the main checkout; (probe: vendor/ empty in check | M5 | M5 |
| [#110](https://github.com/brindlewick/postmaster/issues/110) | P2 | skills/postmaster/coachman.md | style luna + bug mimo: step 6 quotes the gate in double quotes, expanding $f/$n and consuming quote structure; (probe: recorded gate wrapped per the step corrupts to 'bas | M5 | M5 |
| [#110](https://github.com/brindlewick/postmaster/issues/110) | P2 | skills/postmaster/coachman.md | bug mimo: clean checkout holds committed files only and <build> && <gate> installs nothing, so the step fails for install-needing projects including the fixture app itsel | M5 | M5 |
| [#110](https://github.com/brindlewick/postmaster/issues/110) | P2 | scripts/clean-checkout.ts | bug luna: helper runs the gate with plain bash -c while the check contract runs bash -e -o pipefail (project.example.toml, verify.sh:310), so a compound gate can pass her | M2 | M2 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | P2 | scripts/runs-watch.sh | style bug mimo mid-step-hold-strands-run-silent | M4 | M4 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | P2 | scripts/launch.sh | style luna stale-stream-overrides-current-err | M4 | M4 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | P2 | scripts/runs-watch.sh | security opus repo-parse-keeps-rest-of-one-line-profile | M1 | M1 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | P2 | scripts/runs-watch.sh | bug mimo harvest-loop-breaks-iteration-0 | M5 | M5 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | P2 | scripts/runs-watch.sh | bug luna resume-held-gap-before-count-and-launch | M4 | M4 |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | P2 | scripts/runs-watch.sh | style bug mimo partial-step-wake-invites-reentry-dispatch-and-resume | M4 | M4 |
| [#124](https://github.com/brindlewick/postmaster/issues/124) | P2 | skills/postmaster/postmaster.md | lens style lanes luna new tracker writes omit ticket-comment and ticket-state log lines | M5 | M5 |
| [#124](https://github.com/brindlewick/postmaster/issues/124) | P2 | skills/postmaster/coachman.md | lens bug lanes luna,mimo card drops Style residue count and journey path | M5 | M5 |
| [#124](https://github.com/brindlewick/postmaster/issues/124) | P2 | oracle-124.sh | lens security lanes opus BASE script run without bash so negative controls exit 126 vacuously | M5 | M5 |
| [#124](https://github.com/brindlewick/postmaster/issues/124) | P2 | scripts/fixture.sh | lens bug lanes luna record splits stages evenly so leg attribution is fictional and contract-2 shipped is coachman-set | M5 | M5 |
| [#124](https://github.com/brindlewick/postmaster/issues/124) | P2 | skills/postmaster/postmaster.md | lens bug lanes luna,mimo correction resume leaves done marker polling DISPATCH with no action | M4 | M4 |
| [#124](https://github.com/brindlewick/postmaster/issues/124) | P2 | skills/postmaster/postmaster.md | lens bug lanes mimo PR step 3 trigger unstated | M4 | M5 |
| [#124](https://github.com/brindlewick/postmaster/issues/124) | P2 | skills/postmaster/postmaster.md | lens bug lanes mimo local landing drops ready-to-merge tracker comment | M5 | M5 |
| [#124](https://github.com/brindlewick/postmaster/issues/124) | P2 | skills/postmaster/postmaster.md | lens bug lanes mimo card-ready never removed on success so restart re-lands | M4 | M4 |
| [#124](https://github.com/brindlewick/postmaster/issues/124) | P2 | scripts/turnpikes.sh | lens bug lanes luna,mimo null/true/2.0/1.0 read as valid contract markers | M1 | M1 |
| [#124](https://github.com/brindlewick/postmaster/issues/124) | P2 | scripts/stage.sh | lens bug lanes luna,mimo shipped settable by coachman on contract 2 | M5 | M4 |
| [#124](https://github.com/brindlewick/postmaster/issues/124) | P1 | skills/postmaster/postmaster.md | coachman verification local path never removes waiting-on-user so run stalls at USER after merge | M4 | M4 |
| [#124](https://github.com/brindlewick/postmaster/issues/124) | P2 | skills/postmaster/postmaster.md | lens bug,security lanes mimo,opus Stage F drops default-turnpike ledger check | M5 | M5 |
| [#124](https://github.com/brindlewick/postmaster/issues/124) | P2 | skills/postmaster/postmaster.md | lens bug lanes mimo Stage F drops under-no-other-lens and other-turnpike record checks | M5 | M5 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | P2 | scripts/scrub-check.sh | bug+luna dotenv quoted value with trailing comment missed | M1 | M1 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | P2 | scripts/raw-promote.sh | security+opus bug+mimo unexpected scrub exit treated as clean, copies unscanned | M5 | M5 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | P2 | scripts/raw-promote.sh | style+luna style+mimo bug+luna bug+mimo ruled reason verbatim to wiki/log.md, newlines forge headers | M5 | M5 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | P2 | scripts/wiki-lint.sh | security+opus unexpected scrub exit treated as clean | M5 | M5 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | P2 | scripts/tree-check.sh | style+mimo add-then-delete .postmaster invisible to tip-only collection | M5 | M5 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | P2 | scripts/tree-check.sh | security+opus bug+mimo unexpected scrub exit treated as clean | M5 | M5 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | P2 | scripts/raw-promote.sh | style+luna bug+luna unchecked mkdir cp log-append exit 0 | M5 | M5 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | P2 | scripts/wiki-lint.sh | bug+luna raw filename with value printed in diagnostics | M5 | M5 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | P2 | scripts/tree-check.sh | bug+mimo staged deletion of .postmaster file faults with wrong label | M5 | M5 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | P2 | scripts/tree-check.sh | bug+luna staged raw scan reads worktree not blob | M5 | M5 |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | P2 | scripts/tree-check.sh | style+luna fault and cannot-read paths printed unredacted | M5 | M5 |
| [#163](https://github.com/brindlewick/postmaster/issues/163) | P2 | scripts/coachman-contract.sh | bug,style luna,mimo fixture-detector region excludes classification helpers; weakened region() flips a marker rename to exit 0 and the weakening itself is unflagged | M1 | M5 |
| [#163](https://github.com/brindlewick/postmaster/issues/163) | P2 | docs/coachman-contract.toml | bug luna markers mapping covers watch_exit def but not its call at host.sh:1185 | M1 | M5 |
| [#163](https://github.com/brindlewick/postmaster/issues/163) | P2 | skills/postmaster/postmaster.md | bug mimo fixture-card runs <tool> (live main) while the definition says pinned tool; for a change adding the checker neither copy is reliable, must run the final branch c | M5 | M5 |
| [#163](https://github.com/brindlewick/postmaster/issues/163) | P2 | scripts/runs-status.sh | bug luna completion-poll region excludes the newest/idle_min calc the 30-minute INSPECT rule rests on | M1 | M5 |
| [#163](https://github.com/brindlewick/postmaster/issues/163) | P2 | scripts/coachman-contract.sh | security opus git diff without --text; a NUL byte makes a mapped file binary and hides an in-region change as exit 0 | M1 | M1 |
| [#163](https://github.com/brindlewick/postmaster/issues/163) | P2 | scripts/stage.sh | bug luna,mimo stage-rules region ends before the leave-guard (old in done/abandoned, exit 3) the definition names as contract | M1 | M5 |
| [#163](https://github.com/brindlewick/postmaster/issues/163) | P2 | scripts/handoff-check.sh | bug luna handoff-completion region ends before the pass/fail branch (exit 2/0) | M1 | M5 |
| [#163](https://github.com/brindlewick/postmaster/issues/163) | P2 | scripts/turnpikes.sh | bug luna leg-rules region ends before the legs dispatch that invokes legs() | M1 | M5 |
| [#179](https://github.com/brindlewick/postmaster/issues/179) | P2 | skills/postmaster/coachman.md | security opus execution: harvest runs the check without --ticket against the lane-writable armed copy; dropping a criterion passes, --ticket closes it | M5 | M5 |
| [#179](https://github.com/brindlewick/postmaster/issues/179) | P2 | scripts/summary-evidence.ts | bug luna execution: criteria loop counts numbered lines inside multi-line HTML comments; ticket-check control reads 1, script reads [1,2] | M1 | M1 |
| [#179](https://github.com/brindlewick/postmaster/issues/179) | P2 | scripts/summary-evidence.ts | style luna execution: evidence loop parses fenced numbered lines, so an example counts as evidence (lane probe re-run) | M1 | M1 |
| [#179](https://github.com/brindlewick/postmaster/issues/179) | P2 | scripts/summary-evidence.ts | style mimo execution: criteria indent rule is === base where ticket-check uses <= base+2; control reads 3, script reads [1,2]; header claim false | M2 | M2 |
| [#179](https://github.com/brindlewick/postmaster/issues/179) | P2 | scripts/summary-evidence.ts | bug mimo execution: bare-token fallback reads slash prose as paths; not-shown reason with CLI/iOS fails as mixes, bare and/or invented as outside | M1 | M1 |
| [#179](https://github.com/brindlewick/postmaster/issues/179) | P2 | scripts/summary-evidence.ts | bug luna execution: evidence loop parses entries inside HTML comments, so hidden claims satisfy the check | M1 | M1 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | P2 | scripts/reach.ts | bug-mimo bare-cd-ignored  | M1 | M3 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | P1 | scripts/reach.ts | security-opus restore-resets-unmoved  | M4 | M3 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | P2 | scripts/reach.ts | security-opus refs-in-reads-count-as-writes  | M3 | M3 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | P2 | scripts/reach.ts | security-opus reset-climbs-without-git  | M5 | M3 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | P2 | scripts/reach.ts | bug-luna outside-reads-not-exempt  | M1 | M3 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | P1 | scripts/reach.ts | bug-mimo newline-not-split  | M1 | M3 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | P2 | scripts/reach.ts | bug-mimo expected-rewritten-to-note  | M1 | M3 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | P2 | scripts/reach.ts | security-opus git-config-value-not-skipped  | M1 | M3 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | P2 | scripts/reach.ts | bug-mimo style-mimo git-block-misses-escapes  | M1 | M3 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | P1 | scripts/reach.ts | bug-luna style-mimo refusal-demotion-hides-write  | M3 | M3 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | P2 | scripts/landing.ts | bug-luna card-markdown-escape  | M5 | M5 |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | P2 | scripts/reach.ts | style-luna quoted-text-as-redirect  | M1 | M3 |
