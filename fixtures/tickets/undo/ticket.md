# Undo the last change

## Problem / feature

A mistaken add or completion change can only be put right by editing the list by hand. The user
wants to take back changes one at a time.

## Acceptance criteria

1. Undo reverts the most recent add or completion change, says what it reverted and exits 0.
2. Further undo commands revert earlier changes, reaching at least the tenth one.
3. When nothing remains to undo, the user gets a message and the list stays unchanged.
4. A failed or unchanged command does not create something new to undo.
5. Lists kept in different files have separate histories.
6. A list written before this change still loads and has nothing to undo until its next change.
7. The usage message names the undo command.

## Direction

Follow the existing command style and add no dependency.

## Turnpikes

default

## For the agents

### Checks

- **C1** Run the command-line test for undoing an add or completion change → it says what changed and exits 0.
- **C2** Run the repeated-undo test → earlier changes revert through at least the tenth.
- **C3** Run the exhausted-history test → it reports that nothing remains and leaves the list unchanged.
- **C4** Run the failed-and-unchanged-command tests → none creates a new undo entry.
- **C5** Run the separate-file histories test → undoing one list leaves the other unchanged.
- **C6** Load an older list and undo before its next change → the list loads and has nothing to undo.
- **C7** Run the no-arguments usage test → the usage names undo.

### Technical notes

- The task operations are in `src/tasks.ts`; command parsing and output are in `src/cli.ts`; file access is in `src/store.ts`. Tests are under `test/`. (C1, C2, C3, C4, C5, C6, C7)

## User journey

The user adds two tasks, marks the first done by mistake, and types undo. The list shows both tasks,
neither done. They undo again and the second task is gone. They keep undoing until the list is
empty. One more undo says there is nothing to undo.

### Verified at FIXTURE_BASE

- The command implementation and its tests exist at the initial fixture commit.
