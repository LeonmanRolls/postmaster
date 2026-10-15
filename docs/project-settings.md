# The .postmaster folder and project settings

A project may carry a `.postmaster/` folder. It holds the project's settings and every run's
full record (the ledger, the narrative, the cards, each lane's harness events stream and its
exported durable session) under `runs/`. The runs are never committed: the folder carries
its own `.gitignore`, so a checkout never brings another instance's ledgers, paths, ticket
text or harness sessions. The person's settings file is the exception: it is ignored only
on the user's yes during setup, so it is committed like any file, while the shared file is
committed on purpose with `git add -f` to share it. A project that has never been run
against looks exactly like one that has.

What a project may declare to everyone who works on it is one file, `.postmaster/project.toml`,
committed on purpose with `git add -f`: the checks that show a change works, the default
turnpikes, the tracker binding by name, and the risk surfaces. It names no credential, no
filesystem path, no machine name and no role assignment. This person's choices for the
project are in `.postmaster/settings.toml`, written like the global config: they override it
setting by setting, models and env files included. Share it by committing it; a tracked
file is used only after the user has accepted it. The
shapes are `project.example.toml` and `settings.example.toml`. With neither file, the flow
discovers what it can and the agent conducts the rest in conversation: a missing settings file
is never an error and never a prompt to create one.

Precedence is stated once and followed everywhere: discovery supplies defaults; the shared
file declares what the project requires; the person's settings override the global config
setting by setting for that project; the global config supplies the machine's defaults. None
of these sets a floor of turnpikes: a ticket names the turnpikes its run passes through, and
project settings only say what `default` means for that project.

Back to the [README](../README.md).
