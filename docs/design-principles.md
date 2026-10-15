# Design principles

## Lean on the harnesses

postmaster leans on the agent harnesses as much as it can. Planning, coding, reviewing and
fixing are the harnesses' work, through their own skills wherever a harness has one: a bug
review is the harness's own code-review skill, and a security review its own security-review
skill. postmaster itself is mostly plumbing between the stages. It starts each agent with the
right brief, carries the hand-off from one leg to the next, and records what happened.

That is why it has so many scripts. A check written once as a script runs the same way every
time, instead of being worked out again by a model on every run, which saves tokens. The
scripts are well tested, and when one does fail, the model running it can usually read the
error and carry on. The run records the fault, so the script gets fixed.

## Logging, auditing and tracing

These are first-class concerns in postmaster, designed in from the start rather than added
later. Several models change code in parallel, and nobody watches every step as it happens.
The record of what they did is how the work gets checked, and how the flow itself improves.

- **Every action is logged as it happens.** The postmaster and every coachman write one JSON
  line per action, to the run's own log and to the project's ledger. The actions come from a
  fixed set, so the log can be counted rather than read.
- **Every run can be traced from ticket to merge.** The waybill records what was dispatched.
  Each leg starts from the previous leg's written hand-off, and logs when it takes over and
  when it hands off. Each lane's event stream is kept with the run, along with the id of its
  harness thread. The ship card records what is proposed for merge and the evidence for it.
- **Nothing is reconstructed afterwards.** The narrative in `run-log.md` is for reading.
  Audits, and changes to the flow, work from the log.
- **Claims trace to evidence.** The [wiki](../wiki/index.md) gives every claim a standing and
  cites the recorded runs and trials behind it.
- **Checks are scripts with controls.** Anything deterministic is a script, and every count
  comes with a control that could have come out the other way, so a passing check means
  something.

## Adding a library takes the user's word

postmaster does not let agents add packages as they see fit. A run adds
only a library its ticket lists, each one vetted by the clerk before the
user signed the ticket off, and its coachman asks the postmaster, who
asks the user, before adding it. Anything else is refused before it
downloads, and the landing checks again before it merges.

## Design rules

Project files are optional and discovery remains the default; they record only project decisions
discovery cannot infer. Nothing harness-specific outside an adapter. Anything
deterministic lives in `scripts/`, because prose is re-derived, and mis-derived, on every
run. Every count carries a control that could have come out otherwise. Every action a run
takes on a project is logged as a structured event, so what the flow did can be audited and
improved from the record rather than from the narrative.

See `AGENTS.md` for the full context, and `skills/postmaster/` for the runbooks
(`postmaster.md`, `coachman.md`) and the adapters (`harnesses.md`, `hosts.md`, `trackers.md`).

Back to the [README](../README.md).
