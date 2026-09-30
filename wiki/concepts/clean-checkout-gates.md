---
title: clean checkout gates
type: concept
standing: claimed
sources: []
updated: 2026-09-30
---

# Clean checkout gates

The flow keeps run working copies under `.worktrees/` inside each target repository. A project
gate that walks its root can read those copies, fail on their files, or check unfinished lane
work.

After a merge, the flow runs the recorded gate from a detached checkout of the merged default
branch outside the target folder. That checkout contains the committed branch and none of the
target's run worktrees. The gate therefore cannot read files under the target's `.worktrees/`.
Fixture scoring uses the same checkout helper and prepares dependencies inside the temporary
checkout before running the fixture app's gate.

This covers gates the flow runs. A person who runs a project tool from the main checkout can
still expose `.worktrees/` to that tool. Projects do not need ignore rules for the flow's copies.
