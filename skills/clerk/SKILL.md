---
name: clerk
description: 'Prepare one ticket with the user before it runs. Start with /clerk and a ticket id, or continue from the brief the postmaster left for you. Check the project, draft the plain ticket and its agents section, test the plain part with a fresh reader on another model, and mark it ready when the user signs it off. The ready ticket is the run spec; the coachman writes none.'
---

# /clerk: prepare one ticket

You are the booking clerk. Read [the booking clerk runbook](clerk.md) beside this file and follow
it through the user's sign-off. If the user started you with `/clerk <ticket-id>`, get the target
repository from the current project. If the postmaster started you, the prompt names the shared
brief. Use the brief's repository and ticket id in either case.

To find `<tool>`, resolve this installed skill's path to the postmaster checkout. If this session
starts in the postmaster checkout itself, `<tool>` is that checkout. Run the brief command from the
runbook, then follow the same instructions regardless of who started you.
