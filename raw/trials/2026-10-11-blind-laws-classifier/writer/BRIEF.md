# Brief: write laws for the shell-command part of a check

You write property-based tests, called laws here, for one piece of code, working from its
specification alone. A law is a statement that must hold for every input of a kind, checked
on many generated inputs.

## What is in this folder, and all you may use

- `ticket-202.md`: the ticket the code was written to. It describes the reach check, which
  reads the records of AI coding agents (lanes) after they work and reports where, outside
  its own folder, each lane read or wrote. Part of it reads the shell commands a lane ran and
  decides which files and branches each command reads or writes. That part is your subject.
- `signatures.ts`: the declarations of that part's functions and the types they use, as they
  stand in the code. The bodies are not given.
- `classifier.ts`: a stand-in with the same exports. It does nothing: every function returns
  an empty answer. Import the functions and types from `./classifier.ts`.
- `sandbox.ts`: `sandboxed(argv, dir, env?)` runs a real program, such as git or sh, where
  only `dir` can be written and the network is off. It returns null where no sandbox can
  start, and a law that needs it then skips that program.
- `node_modules`: fast-check 4.10.2. Bun 1.4.2 runs TypeScript directly, without a type check.

Work only inside this folder. Do not read, list or search any other path on this machine. Do
not use git history or any repository, and do not use the web. Everything you need is here.

## What to write

- `laws.ts`, exporting `laws`: an array of at most ten entries of the shape
  `{ name: string; statement: string; check: () => void }`. `statement` is the law in one
  plain sentence. `check` runs it with fast-check, `fc.assert(fc.property(...))`, and throws
  when the law fails.
- Each law states something the ticket requires of the shell-command part, for every input
  of a kind, with a generator that makes many such inputs. A law may compare the part's answer
  with what a real program does, run through `sandboxed` in a fresh temporary folder.
- Choose the laws you judge most likely to catch a defect in code written to this ticket.
- A law makes whatever folders and records it needs (a repository, its `.worktrees`, a lane's
  folder, a home folder and so on) inside a fresh temporary folder, and removes them after.
- `LAWS.md`: one entry per law, with its name, its statement and the words of the ticket it
  rests on.
- TypeScript only: no `any` (use `unknown`), no unused variables or imports, and no file name
  ending in `.test.ts`.

## The one rule about running

You may run your laws only against the stand-in in this folder, to check that they load and
that their generators work: `bun run-stub.ts` runs them all and prints each result. Against the
stand-in many laws fail or pass trivially, and that says nothing about the real code. Never
run them against any other code. When you are done, stop. The laws are then locked and run by
someone else, unchanged.

## When you finish

Reply with the list of laws, each with its name and statement, and anything in the ticket you
found unclear.
