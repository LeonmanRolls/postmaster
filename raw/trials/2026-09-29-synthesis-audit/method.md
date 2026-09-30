---
kind: trial
subject: what each workhorse contributed to 25 syntheses, from the runs' own records and a count of six-word runs in git
date: 2026-09-29
---

# Method

**Question.** When two workhorses implement one ticket and the coachman composes the synthesis,
does it take work from both, and is the second-ranked lane's part substantive or trivial?
[Combining models](../../../wiki/concepts/combining-models.md) states the first half as H1, and
said it would be settled from the coachman's own record of what it took. This trial reads that
record for every run that reached synthesis by 2026-09-29, and measures the same thing in git.
Ticket #157 asked for it.

**Runs.** 25. Sixteen were dispatched against this repository: #18, #38, #80, #81, #105, #106,
#108, #109, #112, #113, #114, #116, #121, #122, #124 and #135. Nine are fixture runs,
todo-fixture-1 to todo-fixture-9, each ticket #1 of a repository made by `scripts/fixture.sh
new`: "Undo the last change" in todo-fixture-3 and "Remove tasks by id" in the other eight. No
run that reached synthesis was left out; #57 and #85 had not reached it. Every run had the same
team, per its `run.json`: luna on codex with `gpt-6-luna` at effort max, mimo on MiMo Code with
`mimo-v2.6-pro` at variant high, and the coachman on Muse Code with `muse-spark-1.3-contributor`.

**Records read,** in each run's dispatch directory:

- `run-log.md`: the SYNTHESIS line, which ranks the lanes, names what was taken from each and
  what was rejected, and gives each lane's result on the coachman's blind tests; and the lines
  on launches, harvests, stalls and resumes. The SYNTHESIS lines are copied in
  [synthesis-lines.txt](synthesis-lines.txt), with only the time of day in front removed.
- `checkpoint-1.md`: the synthesis card, with each workhorse's outcome, the reason for each take
  and rejection, the scores on the blind tests, and the commits it names.
- `handoff-1.md`, where the card's words about the ranking needed checking (#38).
- `brief.md`: the ticket's title.
- `card.md`, where the run had shipped, for what it says about cost.
- `manifest.json`: each workhorse's outcome.
- `run.json`: the team, under `config.lanes` and `config.team`.
- `actions.jsonl`: the harvest, resume, synthesize and verify lines.
- `audit/<lane>.md`: each workhorse's head at harvest.

Besides these, the lane and synthesis branches in git, and `skills/postmaster/coachman.md`, the
runbook the SYNTHESIS line is written under. No harness transcript or events stream was read,
and none is recorded here. [results.md](results.md) holds one row per run.

**Commits.** For each run `measure.py` pins the run's base, the synthesis the checkpoint 1 card
names, each workhorse's head at harvest, and the commit that added the blind tests. The synthesis
range starts after the blind tests and after any commit that was not the run's own work: main's
fixes for #117 and #119, which were applied to several branches by hand during the runs, sit
below it. Where a lane branch has those fixes on top of the lane's own last commit, as on #18,
#105, #112, #113 and #114, the lane's head is the commit before them. Three runs are measured on
something other than the card's own commits:

- #38: its first synthesis branch was rebuilt twice, to take out private data that a trial
  record on it carried. The trial measures the rebuilt equivalents of the card's commits,
  `5e249e71a813` to `e355a28830d5`, which differ from them only in the scrubbed trial files.
  luna's head there is its branch's last commit. It holds what luna had left uncommitted at the
  cutoff, which the card says the synthesis took from, and two commits made after the harvest.
- #81: luna's head is the commit it had reached at the cutoff, which the synthesis used; its
  later commit only adds its summary, which the count leaves out anyway.
- #135: the synthesis as it stood before the coachman extended it for #21's criteria, work no
  lane wrote.

**The count.** For each run, the lines the synthesis adds, from the start of its range to the
card's commit, and the lines each workhorse adds, from the base to its head. Each file's added
lines are joined and cut into runs of six consecutive words, a word being anything between
whitespace. Each run of six words in the synthesis is then *first only* when the first-ranked
lane's diff holds it and the second's does not, *second only* the reverse, *both*, or *neither*:
written in the synthesis itself, by the coachman. A run of words is counted once for each place
it occurs in the synthesis. Left out on every side: the files the blind-tests commit added, and
any path naming `WORKHORSE-SPEC.md`, `WORKHORSE-SUMMARY.md`, `BASE-CONTROLS`, `oracle` or
`acceptance`, which are a lane's own records and the run's blind tests. Each count is also split
by kind: *docs*, meaning `.md` and `.txt` files and anything under `wiki/` or `raw/`; *tests*,
files under a `test/` or `tests/` folder or named `*.test.*` or `*.spec.*`, which only the
fixture runs have; and *code*, the rest. A script's `--self-test` is part of the script, so it
counts as code.

Runs of six words rather than whole lines, because a first count by lines missed prose that the
coachman re-wrapped: in #106 the README sentence both lanes wrote the same way sits on different
lines in each, and a line count credits it to nobody.

**Controls.** `measure.py --self-test` checks the pure core on literal input. `measure.py
--controls` measures each workhorse's own diff through the same code as a synthesis, with the
same exclusions: the other lane's only share and *neither* must read 0, and the lane's own only
share above 0. Every control behaved, in all 25 runs: [controls.md](controls.md). They show the
count is applied the same way to a synthesis and to a lane. They cannot show that a pinned commit
is the right one; that rests on the cards and the audits.

**Versions.** Python 3.12.3 and git 2.43.0, with `measure.py` as recorded here. It uses the
standard library only.

**To repeat.** From a checkout of this repository that holds the lane branches:

```
python3 raw/trials/2026-09-29-synthesis-audit/measure.py \
  --fixture todo-fixture-1=<repo> ... --fixture todo-fixture-9=<repo>
```

with each fixture repository the run was dispatched against. It reads git and writes nothing.
The lane branches were never pushed, the fixture repositories live only where they were made,
and eight synthesis branches (#38, #81, #106, #109, #114, #122, #124 and #135) were not pushed
by 2026-09-29. So the count repeats only where those commits are, and [share.md](share.md) is
the record of it.

**Limits.**

- Every SYNTHESIS line names something taken from each lane, and it cannot do otherwise:
  `coachman.md` requires `took=` to name a contribution from every lane that produced work, or
  to say why a lane contributed nothing, and has since the repository's first commit, 67a66b7.
  Counting takes cannot tell complementary lanes from a coachman obeying its runbook.
- Runs of six words count text, not ideas. Where the coachman rewrote a lane's idea in its own
  words, the count credits *neither*: #116's race, #121's held-list guard and todo-fixture-4's
  counter check each read 2% or less for the lane they came from. *Neither* holds the coachman's
  own writing and the ideas it rewrote, and the two cannot be told apart here. Boilerplate that
  both lanes write the same way lands in *both*.
- A lane's head can hold text the coachman never saw, as luna's does on #38.
- No run shipped a lane alone, and the fixture runs' hidden tests were not run on the lane
  branches, so nothing here says whether a synthesis did better than the better lane.
- One coachman model ranked and composed every run, and it knew which lane was which. The blind
  tests are the only field of the SYNTHESIS line no model decided, and they told the two lanes
  apart in 3 of the 25 runs.
- *Covered* in [results.md](results.md) is the card's own account of what the first lane's
  version got wrong or lacked; only #121's was checked against the lane's code.
- This is a trial over the runs' records. No run is promoted to `raw/runs/`, so it cannot move
  a standing on whether combining models works; it settles what the records say and what the
  count found.
