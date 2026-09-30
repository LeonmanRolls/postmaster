# Results

One row per run that reached synthesis by 2026-09-29: 16 dispatched against this repository and 9
fixture runs. Every run had the same team, per its `run.json`: the workhorse luna on codex with
`gpt-6-luna` at effort max, the workhorse mimo on MiMo Code with `mimo-v2.6-pro` at variant high,
and the coachman on Muse Code with `muse-spark-1.3-contributor`.

Where each column comes from, in the run's own dispatch directory unless said:

- *ranked*, *from the first*, *from the second*, *oracle*: the run's SYNTHESIS line in
  `run-log.md`, copied whole in [synthesis-lines.txt](synthesis-lines.txt). The phrases are the
  line's own, shortened. Scores on the blind tests come from `checkpoint-1.md`.
- *second only*: [share.md](share.md), the share of the synthesis's runs of six words found only
  in the second-ranked lane's diff, over all files and then by kind.
- *covered*: what `checkpoint-1.md` says the first lane's version got wrong or left out and the
  second lane's version had, from its reasons for each take and each rejection.
- *lane events*: each lane's outcome in `manifest.json`, and the launch, harvest, stall and resume
  lines in `run-log.md` and `actions.jsonl`. No workhorse was recorded DEGRADED in any run.

## Runs against this repository

| run | ticket | lanes | ranked | from the first | from the second | second only | covered | oracle | lane events |
|---|---|---|---|---|---|---|---|---|---|
| #18 | Per-project .postmaster/: settings and every run's logs, gitignored | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | luna, mimo | settings CLI and shapes, roles mechanism, adapter wiring, session export, fail-closed reads | prose exemption, basename identity, old-layout back-compat, one shared file, AGENTS style, wiki, tool-faults scrub fix | 19% (code 7%, docs 59%) | luna's hard refusals would fail every action of an old-layout run, and its absolute-path identity put machine paths in records | none: the design question is the interface | both killed when the machine ran out of memory, from luna's own unbounded recursion; both resumed and harvested |
| #38 | Run the bug review through each harness's own code-review skill | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | mimo, luna (the card's prose calls luna the lead horse) | review-forms list, harness tables, wiki, trial, clean phrases | launch review, events normalizer, harvest, eligible, setup source, round gate, pre-flight | 36% (code 77%, docs 11%) | mimo read an empty report as clean and left extraction to runbook prose; luna's normalizer fails closed | mimo pass, luna fail (2 faults on its committed head at the cutoff) | neither had finished at the 125-minute cutoff; mimo finished 11 minutes later; luna had no summary and was still running after the synthesis |
| #80 | Fix every finding in round 1, then review until no P1 or P2 remains | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | mimo, luna | decision script structure, round join, self-test harness, step-5 base, wiki, index | RUN/STOP/CAP format, P1-P3 definitions, verified-severity framing, AC1 ruling sentence, round lines, finding-shape pin | 7% (code 0%, docs 18%) | mimo's tree left out AC4's first sentence, on verified severity | mimo pass 14/14, luna fail 11/14 (the card reads the misses as phrasing) | none |
| #81 | A planning stage: each workhorse's spec passes the user's review before any code | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | mimo, luna | planning skeleton, spec-review verb, SPEC poll, wiki page, capture, config key | link script with 7 controls, setup validation, dispatch pre-flight, run-config note, stage negative control, index line | 25% (code 68%, docs 4%) | mimo built links in prose and left setup unvalidated | both fail 10/11 (mimo's miss is the oracle's wording, luna's a missing decision page) | luna stalled at the 90-minute cutoff and finished 80 minutes later with a summary-only commit |
| #105 | Label a run's launches in Herdr by role, lane and model, not the ticket title again | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | luna, mimo | typed name forms, legacy compat, per-leg model, run-place structure, placement-record close, test suite | `--under` nesting shape, preview-server nesting, Tests prose, role-form intent, verify-fault diagnosis | 2% (code 1%, docs 9%) | none recorded | none | both killed twice, by the machine running out of memory and by a restart, and resumed; mimo's process found stopped for 30 minutes and revived |
| #106 | Getting started tells a new user to say hi to their agent | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | mimo, luna | AGENTS.md passage, README trigger sentence, kept wording | README opener, "identical to mimo's" | 0% (docs; 63% in both) | none | both fail 2/3 (the card reads the miss as the oracle's false positive) | none |
| #108 | The session the user opens is the postmaster, unless it cannot be | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | mimo, luna | script structure, tests, repo identity, runbook shape | all-reasons output, report definitions, brief mechanics | 1% (code 0%, docs 2%) | none recorded | both pass | none |
| #109 | Rewrite the scripts in TypeScript, run by Bun | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | luna, mimo | host engine and its self-test, local store, setup stdin loop | toolchain, lib, wrappers, 36 of 38 script ports, AGENTS text | 73% (code 73%, docs 66%) | luna's turnpikes port printed only the first word of each description | both fail (luna 3/6, mimo 2/6; the misses on AC1 and AC4 were pre-registered false positives) | both killed twice and resumed; mimo's process stopped 35 minutes and revived; mimo's gate failed in a clean environment |
| #112 | A headless launch's pane shows what its agent says and runs, in full, for every harness | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | luna, mimo | textwrap engine, verify leak fix, recorded fixture, Muse event docs | Muse message facts, delta flush, read path, self-test breadth | 31% (code 29%, docs 49%) | luna dropped Muse's message deltas, which the ticket wants shown | both pass 7/7 | none; both finished before the machine ran out of memory |
| #113 | Runs may change the same files, and whichever merges second resolves the conflicts | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | mimo, luna | step-6 form, note body | note opening | 14% (docs; 44% in both) | none: the card says both lanes made the same change | both pass | mimo killed mid-gate when the machine ran out of memory, resumed later; luna had finished |
| #114 | A run uses the postmaster version it was dispatched from, so changes can merge with runs in flight | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | luna, mimo | legacy fallback, prompt expansion, release logging, tool-pins root, recorded commit binding | run-meta pin verbs, stateless scan, check before launch, flock, journey fix, self-test overrides | 65% (code 68%, docs 53%) | luna's self-tests leaked real pins, four of them; mimo also found a parallel-cut race, closed with flock | luna fail 1/12 (overruled by reading), mimo pass 12/12 | both killed twice and resumed |
| #116 | Cap each launch's memory and processes, so one lane cannot take the machine down | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | luna, mimo | transient scope, watcher, run.json snapshot, explicit role, notices, self-test structure, setup prompts | 8G/512 defaults, the Result race as a retry's basis, reset-failed, invalid-limits control, never-uncapped assertion | 1% (code 1%, docs 0%) | a race in reading the kill verdict, which mimo measured and the coachman closed | both pass | none |
| #121 | The postmaster waits for its runs with a script, not a loop each session improvises | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | mimo, luna | bash and awk design, end-to-end self-test, slept-seconds timeout, Stage D text, harnesses structure, listing rows | loud failure on an unreadable held list, config default, config-value controls | 0% (code 0%, docs 2%) | mimo's script reads an unreadable held list as empty, which would let a held run fire (its `getline` loop stops silently, read on its branch) | both pass | none |
| #122 | The watcher takes the mechanical steps itself, and wakes the postmaster only for decisions | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | luna, mimo | watcher core, held re-checks, ordering, log wakes, atomic state, stream guards, thread-id coverage | pure adapter shape, broader transient set, resume detail, Stage D structure, transient table | 24% (code 18%, docs 64%) | luna named one transient provider error where the ticket invites more | both pass 18/18 | none |
| #124 | The review leg ends with the run ready for the user's merge, with no separate ship leg | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | luna, mimo | contract version, full legacy sections, legs-derived fixture filter, note on opening the pull request | unchanged stage and card names, landing enum, fixture records, finish-record step | 27% (code 45%, docs 9%) | luna removed a leg's done marker on a failed verification, which turns the poll to REMOUNT with a hand-off present, and renamed the card and a stage | both fail, the same way (each reads a fixture with no marker as a run from before the change, which the card rules correct) | none |
| #135 | A gate check refuses any change that carries a harness session's private context | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | luna, mimo | byte-safe engine, quote-aware key spans, field-gated secrets, host validation, path redaction, dedup, no-reply rule, self-test | main-HEAD wiring, local-part no-reply set, opaque-id and UUID rules, form-based attribution, mktemp scratch, toml docs | 7% (code 6%, docs 46%) | luna's merge-base wiring would rescan commits merged from main, and its known-name attribution missed new assistants | both fail (luna 26/31, mimo 24/31) | none |

## Fixture runs

Each is ticket #1 in a repository made by `scripts/fixture.sh new`: "Undo the last change" in
todo-fixture-3, "Remove tasks by id" in the other eight.

| run | ticket | lanes | ranked | from the first | from the second | second only | covered | oracle | lane events |
|---|---|---|---|---|---|---|---|---|---|
| todo-fixture-1 | Remove tasks by id | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | luna, mimo | union removeTasks, addTask max, map validation, mark guard | highestId name, explicit records, README, usage and round-trip tests | 52% (code 17%, tests 65%) | none recorded | both pass 20/20 | none |
| todo-fixture-2 | Remove tasks by id | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | mimo, luna | required highestId, removeTasks union, raising a low mark, usage spelling, usage table | README realignment, save round-trip test, malformed-before-absent test, order and duplicate tests | 12% (code 0%, tests 14%) | mimo had no save round-trip test and never paired a malformed id with an absent one | both pass 13/13 | none |
| todo-fixture-3 | Undo the last change | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | mimo, luna | inverse-record history, Applied core, per-criterion CLI tests, file-unchanged assertions | limit of 100, undo message with the task's text, truncation on load, a process test | 10% (code 7%, tests 11%) | none recorded | both pass 11/11 | luna left a test file in the main checkout |
| todo-fixture-4 | Remove tasks by id | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | mimo, luna | nextId counter, removeTasks union, CLI flow, usage wording, three test files | map argument validation, strict counter rejection, one-line README | 2% (code 5%, tests 0%) | mimo loaded a stale stored counter silently and then issued ids 1, 5, 1 | both pass 16/16 | luna's README edit also landed in the main checkout, and was restored |
| todo-fixture-5 | Remove tasks by id | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | mimo, luna | highestId name, clamp, inline missing result, journey, order, usage and store edge tests | empty check first, explicit carry, four CLI tests, README verb | 16% (code 6%, tests 20%) | none recorded | both pass 14/14 | none |
| todo-fixture-6 | Remove tasks by id | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | mimo, luna | removeTasks shape, store parse, usage text, README, the union of tests | CLI parse idiom | 2% (code 9%, tests 0%) | none recorded | both pass 16/16 | none |
| todo-fixture-7 | Remove tasks by id | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | luna, mimo | lastId watermark, strict store validation, tagged union, explicit construction, two CLI cases | README line, usage wording, five-test removeTasks block, a no-reuse test | 19% (code 5%, tests 26%) | luna gave the new command no README line and had no test that the usage line names it | both pass 16/16 | none |
| todo-fixture-8 | Remove tasks by id | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | mimo, luna | removeTasks shape, highestId counter, lenient store, unit tests, usage and ordering tests | empty check first, README line | 2% (code 3%, tests 0%) | none recorded | both pass 19/19 | none |
| todo-fixture-9 | Remove tasks by id | luna `gpt-6-luna`; mimo `mimo-v2.6-pro` | luna, mimo | removeTasks, lastId, addTask max, strict store, unit tests | CLI validation loop, usage spelling, README, usage-matrix tests | 41% (code 12%, tests 49%) | none recorded | both pass 16/16 | luna's patch reached the main checkout's README through a path typo and was reverted at once; mimo's process sat silent about 25 minutes after its summary |

## Rank and authorship

In three runs the lane ranked second supplied most of the synthesis's code, per
[share.md](share.md). The reasons the run records give for the rank:

- #38: mimo first "on completeness-and-verification": it finished with a green gate and a
  verified summary, while luna stalled "with the better interfaces" (`handoff-1.md`).
- #109: luna first as "the only complete green branch"; mimo second, though "the source of most
  synthesis parts", for a red gate and thinner controls (`checkpoint-1.md`).
- #114: luna first as correct as shipped on every criterion, including runs already in flight;
  mimo's was "the cleaner core mechanism", taken with two defects fixed (`checkpoint-1.md`).

## Cost

No run recorded tokens or cost. Every closing record that mentions cost says it was not metered.
What the records do hold:

- Minutes from a lane's launch to its summary commit, in the eight runs here with no restart and
  no cutoff: #80 luna 24, mimo 32; #106 luna 13, mimo 48; #108 luna 19, mimo 23; #116 luna 62,
  mimo 57; #121 luna 25, mimo 33; #122 luna 68, mimo 116; #124 luna 52, mimo 67; #135 luna 70,
  mimo 34. The slower lane was mimo in six of the eight. At a cutoff: #38, mimo 131 and luna with
  no summary; #81, mimo 86 and luna 151. Fixture runs with a logged launch: 6 to 20 minutes.
- Minutes from the last harvest to the SYNTHESIS line, where no restart came between: #106 11,
  #108 13, #113 14, #122 28, #105 39, #38 40, #114 46, #124 48, #121 49, #116 56, #135 73, #81 81.
  In the fixture runs, 7 to 18.
- The coachman ran the gate 39 times on a lane's branch or a scratch of it, in 14 of the 16 runs
  against this repository: 249 minutes, 19 runs failing, mostly on the load flakes the waybills
  name.
