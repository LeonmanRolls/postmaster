# Verifiers

Setting up a project offers to make its verifiers, based on
[pstack](https://github.com/cursor/plugins/tree/23e4138daa01c42d4969f7a5465f82704e64f798/pstack)'s
create- and maintain-verification skills: each verifier is a small folder that tells an agent
arriving cold how to start one surface of the project, drive it the way a user does, and keep
proof. See [#67](https://github.com/LeonmanRolls/postmaster/issues/67).

## Where the flow uses them

- Setup offers to make them, one for each surface the user names, and keeps them in the project's `.postmaster` folder unless the user asks for them in the repository, in which case they are committed on a branch and landed.
- The booking clerk writes a ticket's check through a verifier where a criterion drives that surface, naming the verifier and the feature page it uses, and runs the check at the base.
- After a change lands, postmaster checks whether any verifier has gone stale (`scripts/run verifier stale`) and offers one upkeep pass for the ones it marks.

Back to the [README](../README.md).
