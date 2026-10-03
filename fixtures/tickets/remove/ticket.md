# Remove tasks by id

## Problem / feature
A task added by mistake stays on the list for good: the only way to get rid of it is to edit
todo.json by hand. `todo remove` deletes tasks by id.

## Acceptance criteria
1. `todo remove <id>` deletes the task with that id, prints `removed <id>`, and exits 0.
2. `todo remove` takes several ids, as in `todo remove 3 1`, deletes each, and prints one
   `removed <id>` line per id in the order given. An id given more than once is deleted and
   printed once.
3. If any id given is not on the list, `todo remove` deletes nothing, prints nothing to stdout,
   prints `no task <id>` to stderr for the first such id in the order given, and exits 1.
4. `todo remove` with no id, or with any argument that is not a positive whole number, deletes
   nothing, prints nothing to stdout, prints the usage line to stderr, and exits 2, whether or
   not the other ids are on the list.
5. The tasks that remain keep their ids, their text, whether they are done, and their order in
   `todo list`.
6. An id is never used twice: a task added after a remove gets an id one higher than the
   highest id the list has ever had, counting ids since removed.
7. A todo.json written before this change still loads, and its highest id counts as one the
   list has had, so a task added after that task is removed still gets a higher id.
8. The usage line printed by `todo` with no arguments names the `remove` command.

## Decisions
- **D1 (given by the user)** The change to the list is a pure function in `src/tasks.ts`, and
  `src/cli.ts` and `src/store.ts` do the reading and writing. Why: it follows the existing split.
  Instead of: putting the logic in the CLI.

## Out of scope
- Removing every done task at once, confirmation prompts, and undo.

## Direction
Follow the existing split: the change to the list is a pure function in `src/tasks.ts`, and
`src/cli.ts` and `src/store.ts` do the reading and writing. Add no dependency. Every criterion
has a test in `test/`.

## Turnpikes
default

## For the agents

*Everything above is what the user signed off. This part follows from it and adds nothing to it.*

### Checks

- **C1** Run `todo remove <id>` and see `removed <id>` and exit 0. **At the base:** nothing.
- **C2** Run `todo remove 3 1` and see one `removed <id>` line per id in order. **At the base:** nothing.
- **C3** Run `todo remove` with a missing id and see `no task <id>` to stderr and exit 1. **At the base:** nothing.
- **C4** Run `todo remove` with no id or a bad argument and see usage and exit 2. **At the base:** nothing.
- **C5** Remove a task and `todo list`: ids, text, done and order are unchanged. **At the base:** nothing.
- **C6** Remove a task then add one: the new id is one higher than the highest ever had. **At the base:** nothing.
- **C7** Load a todo.json written before the change: the highest id counts as one the list has had. **At the base:** nothing.
- **C8** Run `todo` with no arguments and see the usage line names `remove`. **At the base:** nothing.

### Technical notes

- The change to the list is a pure function in `src/tasks.ts`. (C1, C2, C3, C4, C5, C6, D1)
- `src/cli.ts` and `src/store.ts` do the reading and writing. (C1, C3, C4, D1)
- An id is never used twice: the highest id the list has ever had is tracked across removes. (C6, C7)
- A todo.json written before this change still loads. (C7)

### Verified at 0000000

- The tasks module exists and holds the list logic.

### User journey

In a directory whose list has three tasks, the user types `todo list` and sees ids 1, 2 and 3.
They type `todo remove 2` and see `removed 2`. `todo list` shows tasks 1 and 3 as they were.
`todo add call the bank` prints `added 4`.

```
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

## Notes
Users refer to tasks by id, so a new task that took a removed task's id would make an old note
or a line in their shell history point at the wrong task.
