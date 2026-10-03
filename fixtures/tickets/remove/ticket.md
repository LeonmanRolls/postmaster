# Remove tasks by id

## Problem / feature

A task added by mistake stays on the list for good. The user wants to remove one task or several
by their ids and keep the remaining list unchanged.

## Acceptance criteria

1. A user can remove one task by its id. The task disappears from the list and its removal is reported.
2. A user can remove several tasks at once. Each removed task is reported once in the order given.
3. If any id is missing, nothing is removed and the first missing id is reported.
4. With no id or any invalid id, nothing changes and the correct usage is shown.
5. Remaining tasks keep their ids, text, completion state and order.
6. An id is never used twice, including after its task is removed.
7. A list written before this change still loads, and its highest id is never reused.
8. The usage message names the remove command.

## Direction

Follow the existing command style and add no dependency.

## Turnpikes

default

## For the agents

### Checks

- **C1** Run the command-line test for removing one task → it prints one removed line and exits 0.
- **C2** Run the command-line test for removing several tasks, including a repeated id → each id is printed once in the requested order.
- **C3** Run the command-line test with a missing id → nothing is removed and the first missing id is reported.
- **C4** Run the command-line tests with no id and an invalid id → the usage is printed and the list is unchanged.
- **C5** Run the list test after a removal → remaining rows preserve their ids, text, completion state and order.
- **C6** Run the add-after-remove test → the new id is greater than every id previously used.
- **C7** Load a list written before this change, remove its highest task and add a task → the new id is greater than the removed id.
- **C8** Run the no-arguments usage test → the usage names remove.

### Technical notes

- The task operations are in `src/tasks.ts`; command parsing and output are in `src/cli.ts`; file access is in `src/store.ts`. Tests are under `test/`. (C1, C2, C3, C4, C5, C6, C7, C8)

## User journey

In a directory whose list has three tasks, the user types `todo list` and sees ids 1, 2 and 3. They
type `todo remove 2` and see `removed 2`. `todo list` shows tasks 1 and 3 as they were. They type
`todo add call the bank` and see `added 4`.

```sh
$ todo add buy milk
added 1
$ todo add walk the dog
added 2
$ todo add water the plants
added 3
$ todo remove 2
removed 2
$ todo list
1 [ ] buy milk
3 [ ] water the plants
$ todo add call the bank
added 4
```

### Verified at FIXTURE_BASE

- The command implementation and its tests exist at the initial fixture commit.
