# Regenerating the goldens in this folder

Each golden file carries its own regen procedure in its `_note` key:
dump the cases plus the base-side program, run the program over the
cases, store the results as truth. Regenerate only when the builders
change, and keep the `_note` of the file you regenerate.

- `text-goldens.json`: dump with
  `bun scripts/lib/text.ts --dump-golden-cases`, then run the dumped
  `prog` over `cases` with python3 (3.12.3) and store the 35099 rows as
  `truth`. (The embedded note names `./scripts/text.sh`; that wrapper
  is gone, and the `bun` command above is what its usage string means.)
- `tool-faults-parity.json`: follow its `_note` verbatim; it needs
  python3 and git with `HOME` and the git config pinned.
