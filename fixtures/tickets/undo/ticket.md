# Undo the last change

## Problem / feature
A mistaken add or done can only be put right by editing the list by hand. Users
want to take back what they just did, and to keep taking back changes one at a time.

## Acceptance criteria
1. The undo command reverts the most recent change made by the add or done command, prints one
   line saying what it reverted, and exits 0.
2. Each further undo reverts the change before the one last reverted, back to at least
   the 10th most recent change.
3. With no change left to revert, the undo command changes nothing, prints a message to stderr, and
   exits 1.
4. A command that fails or changes nothing is not a change: listing, marking done with an id
   not on the list, and marking done on a task already done leave nothing for undo to
   revert.
5. Two lists kept in different files have separate histories: undoing in
   one never changes the other.
6. A list written before this change still loads, and has nothing to undo until its next
   change.
7. The usage line printed with no arguments names the undo command.

## Decisions
- **D1 (proposed)** How the history is kept is open: what is recorded for each change, where it
  is stored, and how much of it is kept. The workhorse chooses and gives the reason in the
  commit. Why: it is the design question here. Instead of: the ticket deciding it.

## Out of scope
- Redo, undoing an undo, and any change to what the list prints. Which id a task added after
  an undo gets is left to the implementation.

## Direction
Keep changes to the list pure functions, with the reading and writing at the edges. Add no
dependency. Every criterion has a test.

## Turnpikes
default

## For the agents

*Everything above is what the user signed off. This part follows from it and adds nothing to it.*

### Checks

- **C1** Add two tasks, mark one done, run undo, and see the confirmation and exit 0. **At the base:** nothing.
- **C2** Run undo repeatedly and see it revert changes one at a time, at least 10 deep. **At the base:** nothing.
- **C3** Run undo with no change left and see the error and exit 1. **At the base:** nothing.
- **C4** Run list, done on a missing id, done on an already-done task, then undo: it reverts the last real change. **At the base:** nothing.
- **C5** Use two list files and undo in one: the other is unchanged. **At the base:** nothing.
- **C6** Load a list written before the change and run undo: nothing to undo. **At the base:** nothing.
- **C7** Run with no arguments and see the usage line names the undo command. **At the base:** nothing.

### Technical notes

- How the history is kept is the design question; the workhorse chooses and records the reason. (C1, C2, C3, D1)
- Changes to the list are pure functions; reading and writing is at the edges. (C1, C2, C3, C4, D1)
- Every command is a separate process, so the history must outlive the command that made the change. (C2, C3)
- Two lists in different files have separate histories. (C5)
- A list written before this change has nothing to undo. (C6)

### Verified at 0000000

- The tasks module exists and holds the list logic.

### User journey

The user adds two tasks, then marks the first done by mistake. They type the undo command and see
one line saying what was undone, and the list shows both tasks, neither done. They type undo again
and the second task is gone. A third undo empties the list, and a fourth says there is nothing to
undo.
