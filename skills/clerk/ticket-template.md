# The ticket shape: one document that is both the ticket and the spec

A ticket reaches a run in this shape. The booking clerk
([clerk.md](clerk.md)) prepares it with the user before dispatch. From then on it is
both the ticket and the run's spec: the user reviews it once, the coachman writes no separate spec,
and the workhorses implement from it. The request it replaces may be replaced in full.

It has two parts.

- **The plain part is what the user signs off.** It is everything above `## For the agents`. It is
  written for a person who does not know the code: what is wrong, what will be true when it is
  done, and the choices made on the way. It names no file, function, flag, command, line number or
  data shape, and it links to nothing in the code. It fits on about a page.
- **The agents' part is derived from the plain part.** It is everything under `## For the agents`:
  the checks, the technical notes and the premises verified at the base. It is for the lanes and
  the coachman. The user may read it and need not. It adds no behaviour and no decision that the
  plain part does not state. When the agents' part needs one, the plain part changes first, with
  the user.

Small gaps are for the lanes to fill, and that is what having different models is for. The plain part
still states every choice that changes what a person sees or what the flow does.

Keep the headings and their order. `<tool>/scripts/run ticket-check` requires `## Problem / feature`,
`## Acceptance criteria`, `## Direction` and `## Turnpikes`. `<tool>/scripts/run ticket-parts` checks
the rest of the shape: that the plain part is plain, and that the checks, the notes and the
decisions line up.

```markdown
## Problem / feature

<What is wrong or missing, for whom, in plain words, and what done looks like. A reader can judge
the ticket from this section alone. No design here.>

## Acceptance criteria

1. <One thing that is true when the work is done, in plain words. A sentence or two.>

## Decisions

### Not covered by the acceptance criteria

- **D1 (proposed)** <A choice whose effect no criterion states, in plain words.> Why: <the reason.> Instead of: <what it beat.>

### Covered by the acceptance criteria

Each of these is stated by a criterion above; it is here for its reason and the alternative it beat.

- **D2 (proposed)** <A choice that a criterion states, in plain words.> Why: <the reason.> Instead of: <what it beat.>

## Out of scope

- <What this ticket does not do.>

## Direction

<The few constraints that bind the work, in plain words: the platforms, whether it changes the
coachman's steps and so needs a fixture run, anything that must stay as it is, and for a check or
a guard whether it protects against accident or against a hostile lane. "None: any approach that
meets the criteria" when there are none.>

## Turnpikes

default

## For the agents

*Everything above is what the user signed off. This part follows from it and adds nothing to it.*

### Checks

- **C1** <The check for criterion 1: the command and input, or the steps through the user surface>
  → <the expected output and exit status>. **At the base:** <what it shows today.>

### Technical notes

- <The files, functions, flags, event shapes and line ranges the lanes need, linked at the base
  commit, and any hint on where to start. Evidence and links the plain part has no room for.>
  (C1, D1, D2)

### Verified at <base sha>

- <A premise the ticket relies on, and how it was checked at the base.>
```

## What each part is for

- **Acceptance criteria** are the contract, in words a person can check the result against. Each is
  one idea: one thing that is true when the work is done, in a sentence or two. An "and" that adds a
  second behaviour makes two criteria. A ticket has at most five acceptance criteria. The one asking
  for a fixture run is not counted: it goes last, in its usual words, "A fixture run dispatched from
  this change's branch scores clean."
- **A criterion must be finishable.** The run has to be able to show it met in a finite amount of
  work, and no tool can decide in general what an arbitrary command or program will do. Four shapes
  cannot be finished. Each has a bounded form to write instead.
  - *"Every", "all" or "never" about an input with no end*, such as shell commands, paths, free text
    or what another program does. Name the closed set the criterion covers, and say what the check
    does with anything outside it: it reports it as unknown and fails safe.
  - *Predicting what another program will do.* Ask for what the check can observe afterwards, such
    as a changed file, a moved branch or an exit status, and not for a forecast from the program's
    text.
  - *Exact agreement between two implementations of one decision*, such as a dry run and a real
    run. Name the cases that must agree. Any other case may differ, and the output says so.
  - *A reader that must handle any format.* Name the formats it supports, and have it report every
    other as unsupported.
- **A split** is one umbrella ticket over slice tickets. The umbrella runs nothing itself and is
  never marked ready: it holds the decisions more than one slice follows, and it has one criterion,
  that every slice it lists has landed. Each slice is a ticket of its own: it keeps its own criteria
  and the decisions only it follows, names the slices it needs, and restates in its technical notes
  the umbrella decisions that bind it.
- **Keeping more than five** is the user's word: a decision marked `(given by the user)` that says
  how many criteria it keeps and why, cited by a technical note such as `The parts check warns that
  this ticket has 7 criteria, and the user kept them. (D9)`. The parts check still warns.
- **Checks** are labelled with the id of the criterion they show: `C1` for the first criterion,
  `C2` for the second, in order, one for each. The lanes organise their work and their evidence
  around them, and the lane summary check requires one piece of evidence per criterion. A check
  shows the criterion working the way it will really be used. **At the base** exposes a check that
  passes before any work is done, or that would also pass for a workaround.
- **Decisions** are the choices the ticket makes so that the run need not ask. Each is one idea: one
  choice, the reason, and what it beat, a sentence each. The user reviews each one marked
  `(proposed)`, which are the writer's choices. A decision they gave themselves is marked
  `(given by the user)`. The mark never names a model, because the ticket is public. A decision is
  stated by what it changes for the flow or its user, not by where it is made in the code. A choice
  only the lanes care about, such as a name, a file or an order, is not a decision. Leave it to them.
  The decisions come in two parts. `### Not covered by the acceptance criteria` comes first and
  holds only the decisions whose effect no criterion states: these are the ones the user has to
  read. `### Covered by the acceptance criteria` follows and holds the rest, under one line saying
  each is stated by a criterion above and is there for its reason and the alternative it beat. A
  decision keeps its number whichever part it is in, and a part with no decisions is left out.
- **Detail** that only the implementation needs (exact cases, formats, tool names, counts, edge
  conditions, test inputs) goes under `## For the agents`, in the checks or the technical notes.
  Never drop a choice that changes what a person sees or what the flow does. Simplify the words and
  move the detail down.
- **Technical notes** each carry, in a tag group such as `(C2, D1)`, the criteria and decisions they
  follow from, where `C2` is the second criterion and `D1` the first decision. A note that follows
  from none is either a detail the lanes decide, and does not belong, or a decision the plain part
  is missing, and goes there first, with the user. Every decision is cited by at least one check or
  note.
- **Direction** says only what binds the work. The platforms and the fixture run belong here, in
  plain words. So does what a check or a guard protects against, accident or a hostile lane: a
  defect that needs hostile behaviour is not a defect of a check that guards against accident. The
  technical detail behind them goes in the technical notes.
- **Out of scope** keeps the lanes from drifting.
- **Verified at** is the base commit the ticket was checked against. Every file, function, flag,
  line range and number the technical notes rely on exists there and says what they say, and each
  check was run there and gave its **At the base** result. A ticket that waits is checked again at
  its dispatch commit before it runs.

## What the ticket leaves out

The workhorses decide which files to change and in what order, the task breakdown, the names inside
the files, and how to test beyond the criteria's checks. The ticket lists none of them. A structure
section and a task list were not used by the lanes, and the places where they were wrong cost more
than the places where they helped. A file is named only in the technical notes, as a pointer for the
lanes.
