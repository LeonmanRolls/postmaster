---
title: A project's .postmaster/ holds its settings and every run's record
type: concept
standing: claimed
sources: []
updated: 2026-09-28
---

# A project's .postmaster/ holds its settings and every run's record

**Claim.** Everything the flow learns about a project, and everything a run against it
produces, belongs under the project's own `.postmaster/`. The folder is optional, gitignored
whole, and sharing is one narrow file a project chooses to commit. The machine's
`~/.postmaster/` stays the machine's own.

**Standing: claimed.** This is a decision taken in
[issue #18](https://github.com/brindlewick/postmaster/issues/18), before any run bears on it.

## The reasoning

- **Discovery cannot infer every decision, and the machine config is the wrong place for
  the rest.** Which harness suits a project's lanes, what `default` turnpikes mean here,
  which board its tickets live on, what its risk surfaces are: these belong to the project,
  not to the machine. Held at machine level they travel with the machine, so a project worked
  on from two machines gets a different answer each time.
- **Run artifacts belong with the run's target.** Keying a run's home on the repo's basename
  under `~/.postmaster/runs/` made two projects named `widgets` share a ledger, silently.
  Keying it on the project's own path removes that by construction.
- **Nothing is committed by default, settings included.** The folder carries a `.gitignore`
  covering the whole of it, so a checkout never brings another instance's ledgers, paths,
  ticket text, harness sessions or choices. A project that has never been run against looks
  exactly like one that has.
- **Sharing is opt-in and narrow.** One file, `project.toml`, holds what the project requires
  of a run: the checks, the default turnpikes, the tracker binding by name, the risk
  surfaces. It carries no credential, no filesystem path, no machine name and no role
  assignment — those are properties of a person's machine. Local `settings.toml` holds the
  role assignments and never travels.
- **The normal case is no file at all.** With nothing shared and nothing local, the flow
  discovers what it can and the agent conducts the rest in conversation. A missing settings
  file is never an error and never a prompt to create one.
- **Precedence is stated once.** Discovery supplies defaults; the shared file declares what
  the project requires; local settings are this person's choices on this machine; the
  machine config supplies what is machine-specific and is never overridden by a project.
  None of these sets a floor of turnpikes: a ticket names its own turnpikes
  ([#40](https://github.com/brindlewick/postmaster/issues/40)), and project settings only
  say what `default` means for that project.
- **It softens design rule 1 deliberately.** The rule says the flow discovers what a project
  needs and does not demand configuration, and that stays true. What the folder adds is a
  place for a decision discovery cannot make and a correction where discovery guessed wrong,
  so a correction survives the run that made it.

## What it costs

- A run already in flight under the old `~/.postmaster/runs/<basename>/` layout is not
  migrated. It finishes where it started.
- Two settings files with a precedence between them is one more thing to get wrong. The
  reader is one script (`scripts/run project-settings`) that enforces the shape and the
  no-path/no-credential rule, so a mistake is named rather than silently honoured.

## What would change it

- Runs whose postmaster wrote a project setting mid-stream and then hit a discovery
  disagreement: if corrections are common and material, the folder earns its place. If most
  projects never write one, the shared file is doing too little to justify the schema.
- Two checkouts of the same project name working side by side: the path-keyed run root is
  what removes their collision. A ledger that still merges them would reopen this.

## What changed because of it

`scripts/run project-settings` reads and writes the two files and refuses a credential or a
path in either. `scripts/run turnpikes` expands `default` from a project's declared set.
`scripts/run discover-project` reports whether the target has one. Run artifacts live at
`<project>/.postmaster/runs/`, and `run log-action` names the project from its root.
`settings.example.toml` and `project.example.toml` document the shapes. The setup
conversation offers a project decision for `.postmaster/` and says which file it proposes.
A run resolves the target's local roles at dispatch, and every run launch's durable session
is exported into the run record beside its event stream.
This repo carries its own `.postmaster/` as the first test of it.
