# The three runs the rules were written from

Facts from each run's action log, escalation notes and review checkpoint, read on 2026-10-04 between 22:10 and 22:25 UTC. The run folders are not promoted. Counts are from [severe-by-round.md](severe-by-round.md) and the [controls](controls.md).

## [#202](https://github.com/brindlewick/postmaster/issues/202), check for a lane's reach outside its own worktree

- **What the ticket asked for.** Criterion 5: after the workhorses and after each round, "the check lists every place outside a lane's folder that the lane read or wrote, from the lane's own record", and criterion 7 made a write there a finding and a read a note. Criteria 3, 4 and 6 asked for observed changes: files in the main checkout, the branch it is on, and the run's own branches before and after a round.
- **Rounds and findings.** Nine rounds. Severe findings in rounds 1 to 9: 12, 4, 3, 2, 4, 1, 5, 1, 2. Rounds 4 to 9 each ran on the user's ruling after an escalation, since the flow's cap is three.
- **Where the findings sat.** Of the 51 gating findings of any severity in rounds 1 to 7, 29 sit in the code that reads shell command text and decides whether a command reads or writes ([run-202-gating.tsv](run-202-gating.tsv)); 25 to 29 depending on four boundary findings. Of the 31 severe ones, 19.
- **The user's rescope.** At 2026-10-04 10:32, after round 7, the user ruled "option E": findings come only from observed changes, what a lane's commands name outside its folder is a note, and the command classifier is removed. Rounds 8 and 9 then had 1 and 2 severe findings, and none was in a reader of command text: the card printed unresolved paths, a symlinked synthesis worktree passed a guard, and only the first of several tied reviewers was voided. The user ruled that no round 10 would run, and three fixes shipped as not re-reviewed.

## [#216](https://github.com/brindlewick/postmaster/issues/216), the private-data check

- **What the ticket asked for.** Among 29 criteria: criterion 3, "It reads every file as a person would see it"; criterion 10, "No message a person reads shows a finding's value, even when the value is in a file name"; criterion 8, "This run scans main's whole history once, from its first commit, and finds at most 50 suspects, each judged made-up or real".
- **The number.** The run's census of main's history found 265 lines, 255 judged made-up and 10 real. The coachman escalated at 2026-10-04 03:13 with "census 265 over 50 with no rule weakened", and the user's earlier decision D12 says no secret rule is weakened to meet the limit of 50. At the round cap the escalation still says "Census 236 vs ticket 50".
- **Rounds and findings.** Three rounds had reported when the record was read: severe findings 5, 1 and 4. Round 4 had been launched at 22:14 and had not reported. The same hole was found in different places: an ambient variable that disables the check was found in two places in round 1 (the card scan and the rewrite parser) and in four more in round 3 (the promote scrub, the tree check's entry, the gate chain and the runbook's scan commands).

## [#252](https://github.com/brindlewick/postmaster/issues/252), cleaning up after a run is one script

- **What the ticket asked for.** Criterion 3, "A dry run shows every action the command would take, in order, and changes nothing", and decision D9, "The dry run makes the real run's checks, prints its plan, flags included, and ends with the real run's exit status".
- **Rounds and findings.** Three rounds had reported: severe findings 5, 5 and 4. The coachman's own reading at the cap: "the repeated class is dry-run/real-run parity". Round 1 found "the tracker-kind exit divergence", round 2 "the live-preview hold and the locked worktree", round 3 "the locked pin". The coachman added that "the dry run re-implements every real-run decision inline, so each new refusal the real run grows needs its own predicted twin".
- **The user's change.** At 2026-10-04 22:01 (the log's time) the postmaster edited criterion 3 and D9 on the user's word: the dry run is a best-effort preview. Round 4 had not reported when the record was read.
