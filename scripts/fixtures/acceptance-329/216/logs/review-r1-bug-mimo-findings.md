# Bug findings, round 1, lane mimo (hand-written; normalize failed)

Raw report: `logs/review-r1-bug-mimo.jsonl` record index 98 (final text part),
extracted copy at `logs/review-r1-bug-mimo-final.txt`.
Normalize error: `review output cites host-self-test.ts:942 outside its filed findings`.
Lane reviewed `40d50ce0...HEAD` directly after its Actor call failed
(`subagent_type` must be `explore` or `general`, not `build`); it ran probes by
execution (tsc, oxlint, gate steps, individual suites).

## 1. target: scripts/landing.ts:484

- location: scripts/landing.ts:484-488
- severity: High (proposed P2)
- summary: `privateDataBlock` hardcodes held-out scores and port decisions D1/D8/D9/D19,
  freezing this ticket's evidence into every future ship card.
- evidence: "`privateDataBlock` hardcodes held-out scores `33/33 found, 2/27 raised`
  and `25/37 found, 4/23 raised`, port decisions `D1`/`D8`/`D9`/`D19`. Those decision
  ids exist nowhere else in the repo. The held-out test only asserts floors/ceilings,
  so the card can disagree with the real scanner and still pass." Verified by reading,
  with executed gate steps (`bundle-scrub --check`, `scrub-check.sh`, `tree-check.sh`
  all exit 0; `tsc` clean) as context.

## 2. target: scripts/host-self-test.ts:942

- location: scripts/host-self-test.ts:942
- severity: High (proposed P2)
- summary: Host self-test scratch lives under `scripts/` and poisons the gate; the
  suite hangs in the review scratch.
- evidence: "`mkdtempSync(join(HERE, '.host-self-test-'))`. Six leftovers are sitting
  in `scripts/` now. `bunx biome format scripts ...` exits 1 with 204 errors over
  those directories. `bun test scripts/host.test.ts`, `fixture.test.ts`, and
  `launch.test.ts` each fail to finish within 90s in this worktree." Verified by
  execution in the review scratch.

## 3. target: scripts/fixture.test.ts:0

- location: scripts/fixture.test.ts (fragmented fixture strings), scripts/host-self-test.ts
- severity: Medium (proposed P3)
- summary: Scanner false positives silenced by string-fragmenting test sources instead
  of using the `private-data:allow` marker or narrowing the rule.
- evidence: "`fixture.test.ts` turns `user.email=t@t` into `\"use\" + \"r.e\" + \"mai\" +
  \"l=t\" + \"@t\"`; `host-self-test.ts` breaks a large `printf` into dozens of pieces."
  Verified by reading.

## 4. target: scripts/raw-promote-main.ts:0

- location: scripts/raw-promote-main.ts (clean-file copy path)
- severity: Medium (proposed P3)
- summary: Promote copies clean files with source permissions (`copyFileSync` keeps
  source mode) while scrubbed writes open `0o600`.
- evidence: "Scrubbed writes open `0o600`, but a file with no findings is
  `copyFileSync`'d and keeps whatever mode the source had." Verified by reading.

## 5. target: scripts/probe-confine.test.ts:0

- location: scripts/probe-confine.test.ts (`isSecureBwrapPath("/bin/sh")`)
- severity: Medium (proposed P3)
- summary: `probe-confine.test.ts` fails on this machine (uid 65534 for /usr, /bin).
- evidence: "`isSecureBwrapPath(\"/bin/sh\")` expects true; `chainRootOwned` requires
  uid 0 and this filesystem reports uid 65534 for `/usr`, `/bin`, `/usr/bin`.
  Environmental, but it fails the suite here." Verified by execution.

## 6. target: low-hygiene (multiple)

- location: scripts/tree-check.ts:86,88; scripts/raw-promote-main.ts:200;
  scripts/scrub-check-main.ts:424; scripts/scrub-rewrite.ts:6; scripts/tree-check.ts:168;
  scripts/scrub-core.ts (`scanLine` dead `nextBySource.set`)
- severity: Low (proposed P3)
- summary: Unused bindings/imports, a redundant dynamic import, and dead code.
- evidence: "Unused `marker` bindings ... (oxlint warnings). `scrub-rewrite.ts:6`
  imports `readFileSync` unused. `tree-check.ts:168` dynamically imports
  `./scrub-core.ts` for `detectLine` while already statically importing from it.
  `scrub-core.ts` `scanLine`: `nextBySource.set(-1, ...)` after the consumer loop is
  never read." Verified by reading (oxlint clean with warnings only).
