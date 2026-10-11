# Whether each ticket asked for something unbounded

Each ticket as the workhorses first received it ([method](../method.md)), labelled `yes`, `partly` or `no` against the four shapes by 3 readers. **This session** labelled with the audit's round counts and many finding lines already seen, so it is not blind; its labels were written down before the other readers' came back (v2: 2026-10-04 22:30 UTC, with one correction at 22:36 for [#135](https://github.com/brindlewick/postmaster/issues/135)). **Reader 1 and Reader 2** were each given the 21 texts in a shuffled order under neutral names, the rubric and nothing else.

## Labels

| Run | Ticket | This session | Reader 1 | Reader 2 |
| --- | --- | --- | --- | --- |
| [#57](https://github.com/brindlewick/postmaster/issues/57) | A leg's launch, resume and takeover are run by a script that records how each ended | no | no | no |
| [#75](https://github.com/brindlewick/postmaster/issues/75) | Dispatch refuses a run directory or branch that already exists | no | no | no |
| [#98](https://github.com/brindlewick/postmaster/issues/98) | A fixture run's postmaster runs headless, so it never stops at a trust prompt | no | no | partly |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | Rewrite the scripts in TypeScript, run by Bun | partly | partly | partly |
| [#110](https://github.com/brindlewick/postmaster/issues/110) | A project's gate never sees the run's own working copies | partly | partly | partly |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | The watcher takes the mechanical steps itself, and wakes the postmaster only for decisions | no | no | no |
| [#124](https://github.com/brindlewick/postmaster/issues/124) | The review leg ends with the run ready for the user's merge, with no separate ship leg | partly | no | no |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | A gate check refuses any change that carries personal data or a secret | yes | partly | yes |
| [#158](https://github.com/brindlewick/postmaster/issues/158) | Measure each lane's share of the shipped synthesis from git, beside the coachman's own account | no | no | no |
| [#159](https://github.com/brindlewick/postmaster/issues/159) | A fixture run scores each lane's own branch against the hidden tests | no | no | no |
| [#160](https://github.com/brindlewick/postmaster/issues/160) | Record each launch's tokens and cost where its harness reports them | no | no | no |
| [#163](https://github.com/brindlewick/postmaster/issues/163) | The coachman contract is defined in one place, and a script decides whether a change touches it | yes | no | partly |
| [#165](https://github.com/brindlewick/postmaster/issues/165) | A finished launch's tab closes, and teardown closes every space a run opened | no | partly | partly |
| [#170](https://github.com/brindlewick/postmaster/issues/170) | The coachman writes one spec that every workhorse implements, and the user reviews it once | partly | no | no |
| [#179](https://github.com/brindlewick/postmaster/issues/179) | A workhorse shows every acceptance criterion working, and keeps at it until it can | no | no | no |
| [#182](https://github.com/brindlewick/postmaster/issues/182) | A fixture run runs every agent at its harness's lowest effort | no | no | no |
| [#200](https://github.com/brindlewick/postmaster/issues/200) | Run every lane in its own process space, so it cannot kill processes it did not start | partly | partly | partly |
| [#201](https://github.com/brindlewick/postmaster/issues/201) | Setup and the probe say whether lane confinement can run on this machine, and what finishes it | no | no | no |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | After the workhorses and after each review round, check for a lane's reach outside its own worktree | yes | partly | partly |
| [#216](https://github.com/brindlewick/postmaster/issues/216) | The private-data check is TypeScript run by Bun, and flags little of the project's own code | yes | partly | partly |
| [#252](https://github.com/brindlewick/postmaster/issues/252) | Cleaning up after a run is one script, with a dry run and clear errors | yes | partly | partly |

## Agreement

| Pair | Same label of 3 | kappa | Same on flagged (yes or partly) against no | kappa |
| --- | --- | --- | --- | --- |
| This session and Reader 1 | 13 of 21 | 0.35 | 17 of 21 | 0.61 |
| This session and Reader 2 | 13 of 21 | 0.38 | 17 of 21 | 0.62 |
| Reader 1 and Reader 2 | 18 of 21 | 0.72 | 19 of 21 | 0.81 |

**Consensus** below means flagged (`yes` or `partly`) by at least two of the 3 readers.

## The controls

| Control | Tickets | This session | Reader 1 | Reader 2 |
| --- | --- | --- | --- | --- |
| Positive: the three runs the rules were written from | [#202](https://github.com/brindlewick/postmaster/issues/202), [#216](https://github.com/brindlewick/postmaster/issues/216), [#252](https://github.com/brindlewick/postmaster/issues/252) | yes, yes, yes | partly, partly, partly | partly, partly, partly |
| Negative: tickets that ask for a measurement or a named check | [#158](https://github.com/brindlewick/postmaster/issues/158), [#159](https://github.com/brindlewick/postmaster/issues/159), [#160](https://github.com/brindlewick/postmaster/issues/160) | no, no, no | no, no, no | no, no, no |

The three positives are the cases the rules were written from, so flagging them tests only that the rubric finds what it was written from. The other 18 runs are out of sample.

## What the labels say about rounds and severe findings

Severe findings are counted by `finding` lines ([severe-by-round.md](severe-by-round.md)), and again with [#124](https://github.com/brindlewick/postmaster/issues/124) and [#109](https://github.com/brindlewick/postmaster/issues/109) taken from their own checkpoints. A rank test of the flagged against the not-flagged runs is given as a rough guide only: the labels are judgements, the runs differ in size and in flow version, and 21 runs cannot separate the shape from the size of the ticket.

### By finding lines

| Labels | Flagged | Not flagged | Rounds, median (range) | Severe findings in all | In round 1 | In round 4 on | Rank test p, rounds | Rank test p, severe | Runs past round 3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| This session | 10 | 11 | 5 (3-20) against 3 (2-13) | 14.5 (3-68) against 4 (1-30) | 6.5 (2-21) against 3 (1-11) | 1.5 (0-37) against 0 (0-18) | 0.033 | 0.015 | 7 of 10 against 4 of 11 |
| Reader 1 | 8 | 13 | 4.5 (3-13) against 3 (2-20) | 12.5 (7-68) against 4 (1-30) | 5.5 (4-21) against 3 (1-13) | 0.5 (0-37) against 0 (0-18) | 0.117 | 0.025 | 6 of 8 against 5 of 13 |
| Reader 2 | 10 | 11 | 4.5 (2-13) against 3 (2-20) | 12.5 (3-68) against 4 (1-30) | 5.5 (3-21) against 2 (1-13) | 0.5 (0-37) against 0 (0-18) | 0.216 | 0.047 | 7 of 10 against 4 of 11 |
| Consensus | 9 | 12 | 5 (3-13) against 3 (2-20) | 14 (7-68) against 3.5 (1-30) | 6 (4-21) against 2.5 (1-13) | 1 (0-37) against 0 (0-18) | 0.079 | 0.016 | 7 of 9 against 4 of 12 |

### With [#124](https://github.com/brindlewick/postmaster/issues/124) and [#109](https://github.com/brindlewick/postmaster/issues/109) from their checkpoints

| Labels | Flagged | Not flagged | Rounds, median (range) | Severe findings in all | In round 1 | In round 4 on | Rank test p, rounds | Rank test p, severe | Runs past round 3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| This session | 10 | 11 | 5 (3-20) against 3 (2-13) | 14.5 (3-94) against 4 (1-30) | 6.5 (2-21) against 3 (1-11) | 1.5 (0-72) against 0 (0-18) | 0.033 | 0.013 | 7 of 10 against 4 of 11 |
| Reader 1 | 8 | 13 | 4.5 (3-13) against 3 (2-20) | 12.5 (7-75) against 4 (1-94) | 5.5 (4-21) against 3 (1-11) | 0.5 (0-44) against 0 (0-72) | 0.117 | 0.042 | 6 of 8 against 5 of 13 |
| Reader 2 | 10 | 11 | 4.5 (2-13) against 3 (2-20) | 12.5 (3-75) against 4 (1-94) | 5.5 (3-21) against 2 (1-11) | 0.5 (0-44) against 0 (0-72) | 0.216 | 0.073 | 7 of 10 against 4 of 11 |
| Consensus | 9 | 12 | 5 (3-13) against 3 (2-20) | 14 (7-75) against 3.5 (1-94) | 6 (4-21) against 2.5 (1-11) | 1 (0-44) against 0 (0-72) | 0.079 | 0.028 | 7 of 9 against 4 of 12 |

Each cell reads: median (range) of the flagged runs against median (range) of the others. The rank test is a one-sided exact permutation test of a Mann-Whitney statistic, the chance of a difference this large if the labels were drawn at random from the 21 runs. [#216](https://github.com/brindlewick/postmaster/issues/216) and [#252](https://github.com/brindlewick/postmaster/issues/252) were still running, so their counts are floors.

## Every run

| Run | Rounds | Severe, finding lines | Round 1 | Round 4 on | This session | Reader 1 | Reader 2 | Consensus |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [#57](https://github.com/brindlewick/postmaster/issues/57) | 6 | 24 | 11 | 5 | no | no | no | no |
| [#75](https://github.com/brindlewick/postmaster/issues/75) | 3 | 4 | 2 | 0 | no | no | no | no |
| [#98](https://github.com/brindlewick/postmaster/issues/98) | 2 | 3 | 3 | 0 | no | no | partly | no |
| [#109](https://github.com/brindlewick/postmaster/issues/109) | 13 | 68 | 21 | 37 | partly | partly | partly | flag |
| [#110](https://github.com/brindlewick/postmaster/issues/110) | 5 | 11 | 4 | 2 | partly | partly | partly | flag |
| [#122](https://github.com/brindlewick/postmaster/issues/122) | 13 | 30 | 6 | 18 | no | no | no | no |
| [#124](https://github.com/brindlewick/postmaster/issues/124) | 20 | 28 | 13 | 5 | partly | no | no | no |
| [#135](https://github.com/brindlewick/postmaster/issues/135) | 5 | 32 | 11 | 1 | yes | partly | yes | flag |
| [#158](https://github.com/brindlewick/postmaster/issues/158) | 3 | 5 | 3 | 0 | no | no | no | no |
| [#159](https://github.com/brindlewick/postmaster/issues/159) | 2 | 2 | 2 | 0 | no | no | no | no |
| [#160](https://github.com/brindlewick/postmaster/issues/160) | 2 | 1 | 1 | 0 | no | no | no | no |
| [#163](https://github.com/brindlewick/postmaster/issues/163) | 5 | 15 | 8 | 3 | yes | no | partly | flag |
| [#165](https://github.com/brindlewick/postmaster/issues/165) | 4 | 10 | 6 | 0 | no | partly | partly | flag |
| [#170](https://github.com/brindlewick/postmaster/issues/170) | 3 | 3 | 2 | 0 | partly | no | no | no |
| [#179](https://github.com/brindlewick/postmaster/issues/179) | 5 | 17 | 6 | 2 | no | no | no | no |
| [#182](https://github.com/brindlewick/postmaster/issues/182) | 2 | 1 | 1 | 0 | no | no | no | no |
| [#200](https://github.com/brindlewick/postmaster/issues/200) | 4 | 7 | 4 | 0 | partly | partly | partly | flag |
| [#201](https://github.com/brindlewick/postmaster/issues/201) | 3 | 3 | 2 | 0 | no | no | no | no |
| [#202](https://github.com/brindlewick/postmaster/issues/202) | 9 | 34 | 12 | 15 | yes | partly | partly | flag |
| [#216](https://github.com/brindlewick/postmaster/issues/216) | 3+ | 10 | 5 | 0 | yes | partly | partly | flag |
| [#252](https://github.com/brindlewick/postmaster/issues/252) | 3+ | 14 | 5 | 0 | yes | partly | partly | flag |

## What each reader said, run by run

Criteria that matched, the shape, a short reason and the bounded form the ticket names, as each reader gave them. Where this session's reason is shown, it is the one written at the time.

### [#57](https://github.com/brindlewick/postmaster/issues/57)

- **This session, no** (medium): criteria 2,4, shape -. names a fixed set of five outcomes; the ticket itself diagnoses "anything else: resume" and writes the bounded form
- **Reader 1, no** (medium): criteria -, shape -. How an attempt ended is "one of a fixed set" of five outcomes with a positive and a negative control for each, so the ways of failing are closed.
- **Reader 2, no** (high): criteria -, shape -. How an attempt ended is "one of a fixed set" named in criterion 2, and every control ranges over that set.

### [#75](https://github.com/brindlewick/postmaster/issues/75)

- **This session, no** (high): criteria -, shape -. refuse when a named directory or branch exists; every criterion has a named check
- **Reader 1, no** (high): criteria -, shape -. Two refusals defined by an existing run folder and by branch names read from git, each with a self-test control.
- **Reader 2, no** (high): criteria -, shape -. The refusals cover the run directory and the branches the repository holds, each shown by a self-test.

### [#98](https://github.com/brindlewick/postmaster/issues/98)

- **This session, no** (high): criteria -, shape -. one named decision for a fixture copy, one for any other target, each with a control
- **Reader 1, no** (medium): criteria -, shape -. Every criterion is a specific check or a decision with a control, and for other targets "its decision is as it was" is a branch on the mark that criterion 5 tests.
- **Reader 2, partly** (low): criteria 2, shape S3. Criterion 2 requires the decision "for any other target" to be "as it was", an old-against-new agreement over open-ended targets.

### [#109](https://github.com/brindlewick/postmaster/issues/109)

- **This session, partly** (medium): criteria 2,3, shape S3. same arguments, output formats and exit codes for 38 scripts (agreement with the old scripts) without naming cases
- **Reader 1, partly** (medium): criteria 2, shape S3. Criterion 2 asks each script after the port to keep its interface, one that "prints the same output formats and exits with the same codes", exact agreement between old program and port.
- **Reader 2, partly** (medium): criteria 2, shape S3. Every ported script "prints the same output formats and exits with the same codes" as the bash it replaces.

### [#110](https://github.com/brindlewick/postmaster/issues/110)

- **This session, partly** (medium): criteria 1, shape S1,S2. the gate "never reads" a run's working copies, about any project's own tools
- **Reader 1, partly** (medium): criteria 1, shape S1. Criterion 1 says the gate "never reads a run's working copies", a never about what a project's own tools do, which the ticket bounds by a mechanism and a control pair.
- **Reader 2, partly** (high): criteria 1, shape S2. Criterion 1 says the project's gate, an arbitrary tool, "never reads a run's working copies", a forecast about another program.

### [#122](https://github.com/brindlewick/postmaster/issues/122)

- **This session, no** (low): criteria 2,3, shape -. a closed list (the adapter names the errors) and a catch-all that wakes the postmaster; the reading of provider text is not named as a hard part
- **Reader 1, no** (medium): criteria -, shape -. "Every" and "everything" range over lists the ticket names: errors the harness adapter names, a list of held runs, and wake causes with a catch-all for any step the watcher could not complete.
- **Reader 2, no** (medium): criteria -, shape -. The watcher takes two named steps, and criterion 3 lists what wakes the postmaster, ending with "any step the watcher could not complete".

### [#124](https://github.com/brindlewick/postmaster/issues/124)

- **This session, partly** (low): criteria 4, shape S3. "does the aftercare and teardown the ship leg does today" (agreement with an existing implementation)
- **Reader 1, no** (high): criteria -, shape -. Legs, markers, scripts and a card list are named, "it merges nothing" is an observable, and runs from before the change have their own controls.
- **Reader 2, no** (high): criteria -, shape -. The criteria name the legs, list the card's contents and give controls for two-, one- and three-leg runs.

### [#135](https://github.com/brindlewick/postmaster/issues/135)

- **This session, yes** (medium): criteria 1, shape S1,S4. "anything that looks like private data" and "text that reads like a private instructions file", in every commit; the kinds are listed, what looks like one is open, and nothing says what happens to what is not listed
- **Reader 1, partly** (medium): criteria 1, 2, shape S1. Criterion 1 asks for "anything that looks like private data" in every commit and criterion 2 says "No file anywhere" lists the values, both about open-ended text and files.
- **Reader 2, yes** (medium): criteria 1, 2, shape S1. Criterion 1 scans for "anything that looks like private data", including "text that reads like a private instructions file".

### [#158](https://github.com/brindlewick/postmaster/issues/158)

- **This session, no** (high): criteria -, shape -. a measurement from git with four named controls
- **Reader 1, no** (high): criteria -, shape -. A measurement of text shares from git with four named controls, and no criterion makes a claim over an open input.
- **Reader 2, no** (high): criteria -, shape -. Every criterion is a measurement from git or a named control, such as "a synthesis taken wholly from one lane".

### [#159](https://github.com/brindlewick/postmaster/issues/159)

- **This session, no** (high): criteria -, shape -. run hidden tests per lane branch; named controls
- **Reader 1, no** (high): criteria -, shape -. Three named cases (passing, failing, missing branch) are tested, and "never as a pass" applies only to a missing or unbuilt branch.
- **Reader 2, no** (high): criteria -, shape -. A missing or failed lane branch is a named case reported "never as a pass", with three named controls.

### [#160](https://github.com/brindlewick/postmaster/issues/160)

- **This session, no** (high): criteria -, shape -. record what each harness reports; per-harness controls
- **Reader 1, no** (medium): criteria -, shape -. Usage is read from each harness's own stream with a control per harness, and a harness that reports nothing is named and not zeroed, so the formats are the project's own closed list.
- **Reader 2, no** (high): criteria -, shape -. Usage is read per harness behind the adapter, with "one that reports usage, and one that does not".

### [#163](https://github.com/brindlewick/postmaster/issues/163)

- **This session, yes** (high): criteria 1,2, shape S1,S4. "every part it covers" of the contract, and the file and line that touched it; the direction asks to mark exactly which parts are contract; no closed set
- **Reader 1, no** (medium): criteria -, shape -. The contract is whatever criterion 1's definition marks, so "every part it covers" and the diff check range over a closed list, with named yes and no controls in criterion 4.
- **Reader 2, partly** (medium): criteria 2, shape S1, S2. Criterion 2 asks a script, given any base and head, to answer "whether the change touches the contract".

### [#165](https://github.com/brindlewick/postmaster/issues/165)

- **This session, no** (medium): criteria 2,3, shape -. closes by what the host recorded of its own launches; "never closed" is bounded by that record
- **Reader 1, partly** (medium): criteria 2, shape S1. Criterion 2 says a pane or tab host.sh did not open "is never closed", a never over whatever panes a user has open, which the ticket bounds by recorded launches and one control.
- **Reader 2, partly** (medium): criteria 2, shape S1. Criterion 2 says a pane host.sh "did not open for this run is never closed", a never over any pane.

### [#170](https://github.com/brindlewick/postmaster/issues/170)

- **This session, partly** (low): criteria 3, shape S1. "never another lane's work" restates the existing separation by worktree
- **Reader 1, no** (low): criteria -, shape -. Specs, packages and runs from before the change are named with controls, and "never another lane's work" restates the existing blinkers instead of adding an open-ended claim.
- **Reader 2, no** (high): criteria -, shape -. One spec, a named review flow and controls for named cases; criterion 4 sets a level of detail, not an open input.

### [#179](https://github.com/brindlewick/postmaster/issues/179)

- **This session, no** (low): criteria -, shape -. loop until each criterion's check shows it working; named kinds of evidence and named tests
- **Reader 1, no** (medium): criteria -, shape -. Evidence is a file that exists or a `not shown` line, held to that shape by a script with four named test summaries, and "never drop or weaken one the spec specifies" is a brief rule checked against that evidence.
- **Reader 2, no** (medium): criteria -, shape -. The criteria ask for brief and template text, a summary-shape script and four named test cases.

### [#182](https://github.com/brindlewick/postmaster/issues/182)

- **This session, no** (high): criteria -, shape -. one table of efforts, named cases for the controls
- **Reader 1, no** (high): criteria -, shape -. A closed effort table with a warning for harnesses outside it, and controls for named launch kinds in fixture and ticket runs, so nothing asks for a claim over an open set.
- **Reader 2, no** (medium): criteria -, shape -. Efforts come from one named table with a stated fallback, and criterion 5 names the controls for both kinds of run.

### [#200](https://github.com/brindlewick/postmaster/issues/200)

- **This session, partly** (medium): criteria 2,3, shape S1,S2. "can do its work as before" and "cannot signal a process it did not start" (about any process)
- **Reader 1, partly** (medium): criteria 3, shape S1. Criterion 3, "A confined lane cannot signal a process it did not start", is a never over all processes, which the ticket bounds by a named mechanism and a control pair.
- **Reader 2, partly** (medium): criteria 3, shape S1. "A confined lane cannot signal a process it did not start" covers any command a lane might run.

### [#201](https://github.com/brindlewick/postmaster/issues/201)

- **This session, no** (high): criteria -, shape -. probe results for named platforms and named stubs
- **Reader 1, no** (high): criteria -, shape -. Each result is defined by named conditions (Ubuntu 24.04 restriction, missing package, macOS tools), an unknown package manager gives `unavailable`, and each result has a stub control.
- **Reader 2, no** (medium): criteria -, shape -. The probe has three named results on named platforms, and a package manager it does not know gives "unavailable".

### [#202](https://github.com/brindlewick/postmaster/issues/202)

- **This session, yes** (high): criteria 5,7,12, shape S1,S2,S4. "every place outside a lane's folder that the lane read or wrote", from the lane's own record, then a finding for a write and a note for a read; the observed-change checks (3,4,6) are bounded but the findings rest on the classification
- **Reader 1, partly** (medium): criteria 5, 7, shape S1, S4. Criterion 5 asks for "every place outside a lane's folder that the lane read or wrote" from arbitrary shell commands and lane records, which the ticket bounds by closed lists and named readers.
- **Reader 2, partly** (medium): criteria 5, 7, 12, shape S1, S2. Criterion 5 lists "every place outside a lane's folder that the lane read or wrote" from command text.

### [#216](https://github.com/brindlewick/postmaster/issues/216)

- **This session, yes** (high): criteria 3,8,10, shape S4,S1. "reads every file as a person would see it"; "no message a person reads shows a finding's value"; "at most 50 suspects" on data nobody had measured
- **Reader 1, partly** (medium): criteria 3, 10, 25, 27, 28, D2, shape S4, S1, S3. Several criteria are universal over open inputs, for example "It reads every file as a person would see it", but each is tied to named formats, named test lines, a measured limit or recorded outputs.
- **Reader 2, partly** (medium): criteria 3, 4, 7, 10, 20, 25, 27, 28, shape S4 (3, 20), S1 (7, 10, 27, 28), S3 (4, 25). Criterion 3 reads "every file as a person would see it", and others cover any private name, message or line.

### [#252](https://github.com/brindlewick/postmaster/issues/252)

- **This session, yes** (high): criteria 3,D9, shape S3. the dry run "makes the real run's checks" and "ends with the real run's exit status": agreement with the real run, no cases named
- **Reader 1, partly** (medium): criteria 3, 4, 12, shape S3, S1. Criterion 3's dry run "shows every action the command would take" and criterion 12 says "nothing ends silently", agreement with the real run and a claim over every way of failing.
- **Reader 2, partly** (high): criteria 3, 12, 14, shape S3 (3), S1 (12, 14). A dry run "shows every action the command would take", and "nothing ends silently" covers every way of failing.

## What each reader found hard

The readers' own notes on the tickets they found hard to label, with the neutral file names replaced by run numbers.

### Reader 1

- [#98](https://github.com/brindlewick/postmaster/issues/98): Criterion 2's clause that any other target keeps its decision "as it was" reads like S3 over an open set of targets. I took it as a branch on the mark with a control in criterion 5, not two implementations that must agree, so a reader who counts it as S3 would say `partly`.
- [#163](https://github.com/brindlewick/postmaster/issues/163): Whether a change touches the contract could be read as S2, since a change elsewhere may alter how completion is detected. I labelled it `no` because criterion 1 and the direction make the contract a marked, closed list, which makes the script's question syntactic.
- [#110](https://github.com/brindlewick/postmaster/issues/110): Criterion 1 is a never about what a project's tools read. The ticket gives a mechanism and a control pair rather than a closed set, so `no` is arguable.
- [#165](https://github.com/brindlewick/postmaster/issues/165): Criterion 2 restates an existing rule, and the new automatic closing is what puts it at risk. The direction's by-record rule and one negative control give it a finite form, so `no` is arguable.
- [#57](https://github.com/brindlewick/postmaster/issues/57): The fixed set of outcomes is named, but the ticket does not say how "walled" is recognised without reading error text. I treated the set as closed because "exited without its hand-off" catches the rest.
- [#216](https://github.com/brindlewick/postmaster/issues/216): Nearly every universal clause has a named form beside it, so `no` is arguable. I used `partly` because criteria 3, 10, 27 and 28 match S4 and S1 by their words.
- [#202](https://github.com/brindlewick/postmaster/issues/202): Same pattern as t08: closed lists, named readers and out-of-scope lines sit beside criteria 5 and 7, so `no` is arguable. I used `partly` because those criteria are about arbitrary shell commands and lane records.
- [#170](https://github.com/brindlewick/postmaster/issues/170): Criterion 3's "never another lane's work" is a never about what lanes see. I read it as the existing blinkers invariant that this change does not touch, so it adds no new obligation, but a reader could call it S1 and say `partly`.
- [#200](https://github.com/brindlewick/postmaster/issues/200): Criterion 3 is a never over all processes and signals, and one signal control does not prove it; the named mechanism carries the guarantee. `yes` is possible if a mechanism is not counted as a bounded form.
- [#135](https://github.com/brindlewick/postmaster/issues/135): Only per-kind controls and a method clause bound "anything that looks like private data" and "No file anywhere", and the kind "text that reads like a private instructions file" has no pattern. `yes` is possible.
- [#109](https://github.com/brindlewick/postmaster/issues/109): This is the old-program-and-port shape. The BASE controls give a finite check, but the ticket never says that other cases may differ, so `yes` is possible.
- [#252](https://github.com/brindlewick/postmaster/issues/252): Criterion 3 is the dry-run and real-run shape, bounded by D9 and named cases, and criterion 12 ranges over ways of failing, bounded by D11 and the named stops. I chose `partly` over `yes` because both have named forms.

### Reader 2

- [#98](https://github.com/brindlewick/postmaster/issues/98): Criterion 2 could be read as a named decision with a control (`no`) rather than an old-against-new agreement over any target (`partly`). Criterion 4, "Nothing writes any harness's trust setting", could be read as a forecast about the harnesses (which would make it `yes`), but I took it as a limit on the change's own code.
- [#216](https://github.com/brindlewick/postmaster/issues/216): Several of its bounded forms appear only under "For the agents" (the decoded formats, the host suffixes, fixed error text), and the brief's `partly` list does not name that part. The ticket does name them, so it is not `yes`.
- [#179](https://github.com/brindlewick/postmaster/issues/179): Criterion 3 asks workhorses to drive any project's own browser library, which is open-ended. What the run must show is the brief's text and the summary script, so I did not count it as S4.
- [#202](https://github.com/brindlewick/postmaster/issues/202): Bounded forms are named, but D17 treats an unknown command as a read rather than as unknown, and the agents' part skips paths that need a variable or a glob. So the closed set does not fail safe on writes outside the main checkout and the run's branches.
- [#201](https://github.com/brindlewick/postmaster/issues/201): Criterion 3 covers any machine's package manager, but its own "or says unavailable when it knows none" bounds it. I labelled it `no` rather than `partly`.
- [#135](https://github.com/brindlewick/postmaster/issues/135): Criterion 6's per-kind controls could be read as named cases that make it `partly`. I labelled it `yes` because several kinds ("keys such as", "text that reads like a private instructions file") have no closed shape, and nothing says what happens outside them. Criterion 2's "No file anywhere, in the repository or outside it" is also open, though its second clause turns it into a property of the script.
- [#182](https://github.com/brindlewick/postmaster/issues/182): "its reviews run exactly as they do today" reads like S3. But the agreement is on one recorded effort over a closed set of harnesses, with controls in criterion 5, so I labelled it `no`.

