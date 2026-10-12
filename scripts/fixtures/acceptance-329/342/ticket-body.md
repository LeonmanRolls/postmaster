## Problem / feature

Reviewers under the style and bug lenses work in folders that share the project's repository, so a reviewer's git commands can move the run's own branches, which the reach check from [#202, After the workhorses and after each review round, check for a lane's reach outside its own worktree](https://github.com/brindlewick/postmaster/issues/202) then has to find and put back. The security reviewers already work in copies of their own, which borrow the project's history and keep their own commits.

Done: every reviewer works in such a copy. This is the first slice of [#203, Cut each lane as a shared clone of the repository, so it cannot read another lane's commits](https://github.com/brindlewick/postmaster/issues/203), which holds the decisions it follows.

## Acceptance criteria

1. Each reviewer, under each lens the run names, works in its own copy of the project's repository, at the commit it reviews.
2. A fixture run dispatched from this change's branch scores clean.

## Out of scope

- The workhorses' folders, which the second and third slices of #203 change.

## Direction

It depends on no other slice of #203. It changes the coachman's steps, so it lands only after a fixture run from its branch scores clean. The copies guard against accident, a reviewer moving the run's branches while it uses git in its own folder, not against a hostile reviewer. Linux and macOS.

## Turnpikes

default

## For the agents

*Everything above is what the user signed off. This part follows from it and adds nothing to it.*

### Checks

- **C1** The review step's cut, run for a style, a bug and a security reviewer on a scratch repository whose synthesis worktree `.worktrees/T` is on branch `T`: each folder `<repo>/.worktrees/T-rev-<lens>-<lane>` is a repository of its own (`git -C <f> rev-parse --absolute-git-dir` equals `git -C <f> rev-parse --path-format=absolute --git-common-dir`), its `objects/info/alternates` names `<repo>/.git/objects`, `git -C <f> config remote.origin.url` is `<repo>`, and `git -C <f> rev-parse HEAD` prints the snapshot with no branch checked out; `run review-round teardown` removes each. In round 1 of the fixture run in C2 the same holds for every reviewer folder while its reviewer runs. **At the base:** the cut passes `--clone <BASE>` only when the lens is `security`, so the style and bug folders are detached worktrees, for which `scripts/run cut-scratch --kind` prints `worktree <repo>`.
- **C2** `scripts/run fixture new` makes a fixture repository and a run is dispatched against it from this change's branch; `scripts/run fixture score <dispatch> <repo>` on the same branch exits 0, and C1's fixture condition holds for it. `scripts/run coachman-contract` names this change a contract change. **At the base:** not run; it needs the change.

### Technical notes

Links are at the base, [8baf5af](https://github.com/brindlewick/postmaster/commit/8baf5af9a13cae1dd788cc85b0bc0a30a501a396).

- Decisions of #203 that bind this slice: D3, reviewers work in copies under every lens, not only security; D2, it lands when its run is ready, even with other runs in flight. (C1, C2)
- The review cut and its check pass `--clone <BASE>` under security only, [coachman.md#L905-L913](https://github.com/brindlewick/postmaster/blob/8baf5af9a13cae1dd788cc85b0bc0a30a501a396/skills/postmaster/coachman.md#L905-L913) and [coachman.md#L935-L943](https://github.com/brindlewick/postmaster/blob/8baf5af9a13cae1dd788cc85b0bc0a30a501a396/skills/postmaster/coachman.md#L935-L943), and the paths table describes the folders, [coachman.md#L43](https://github.com/brindlewick/postmaster/blob/8baf5af9a13cae1dd788cc85b0bc0a30a501a396/skills/postmaster/coachman.md#L43). The security skill needs `origin/HEAD`, [harnesses.md#L514-L521](https://github.com/brindlewick/postmaster/blob/8baf5af9a13cae1dd788cc85b0bc0a30a501a396/skills/postmaster/harnesses.md#L514-L521); the bug lens's form names its range, [harnesses.md#L526-L534](https://github.com/brindlewick/postmaster/blob/8baf5af9a13cae1dd788cc85b0bc0a30a501a396/skills/postmaster/harnesses.md#L526-L534), whose text calls a review scratch a detached worktree; the style brief diffs `<BASE>...HEAD`, [coachman.md#L784-L786](https://github.com/brindlewick/postmaster/blob/8baf5af9a13cae1dd788cc85b0bc0a30a501a396/skills/postmaster/coachman.md#L784-L786). The merge-base refusal of `cut-scratch --clone`, [cut-scratch.ts#L138-L168](https://github.com/brindlewick/postmaster/blob/8baf5af9a13cae1dd788cc85b0bc0a30a501a396/scripts/cut-scratch.ts#L138-L168), is the security lens's need only. (C1)
- The rest of the round already serves a copy: the check of each folder's tracked changes, [coachman.md#L1044-L1048](https://github.com/brindlewick/postmaster/blob/8baf5af9a13cae1dd788cc85b0bc0a30a501a396/skills/postmaster/coachman.md#L1044-L1048); the round's teardown through `cut-scratch --remove`, which takes a clone as it takes a worktree, [coachman.md#L1049-L1060](https://github.com/brindlewick/postmaster/blob/8baf5af9a13cae1dd788cc85b0bc0a30a501a396/skills/postmaster/coachman.md#L1049-L1060); the reach check, which finds a reviewer's folder by its path, `roundOwnFolder()`, [reach.ts#L814-L816](https://github.com/brindlewick/postmaster/blob/8baf5af9a13cae1dd788cc85b0bc0a30a501a396/scripts/reach.ts#L814-L816); and the cleanup after the merge, which reads any clone as a scratch, `classify()`, [aftercare.ts#L756-L783](https://github.com/brindlewick/postmaster/blob/8baf5af9a13cae1dd788cc85b0bc0a30a501a396/scripts/aftercare.ts#L756-L783). (C1)
- The contract: coachman.md is listed in [docs/coachman-contract.toml](https://github.com/brindlewick/postmaster/blob/8baf5af9a13cae1dd788cc85b0bc0a30a501a396/docs/coachman-contract.toml). (C2)

### Verified at 8baf5af9a13cae1dd788cc85b0bc0a30a501a396

- Every file, function and line range above, read at this commit.
- With this commit's tool, `cut-scratch <repo> <synthesis-wt> <dest> BASE --clone BASE` made a clone that `cut-scratch --kind` reads as `clone <repo>`, and `cut-scratch --remove` removed it.

