# Spec session

The postmaster starts this interactive session when one shared spec is ready for the user's
review. The postmaster supplies `spec-session-brief.md` in the run directory. It has the ticket,
the review link and editable copy, any lane draft specs, the user's standing preferences and
this runbook's path.

1. Read the brief and the linked `WORKHORSE-SPEC.md`. Read each lane draft spec listed in the
   brief, if any, by its listed path and commit. Do not inspect lane implementation files or
   another lane's work. Read the standing preferences as context for working with the user.
2. Work with the user on the review copy. Discuss scope, the decisions that matter, the tests
   and whether every ticket criterion is covered. The spec says what to build and leaves code
   choices to the workhorses. The user may add comments as `//` lines or inside `/* ... */`;
   answer each one and revise the text. Keep the copy free of the user's identity, machine
   details and preferences.
3. When the user says the spec is ready, remove review comments and check the finished text
   against every acceptance criterion. Tell the user it is ready and ask them to tell the
   postmaster. Do not commit, approve, resume, stop or message the run or another session.

The postmaster records the user's decision. Approval commits the exact reviewed copy in the
synthesis worktree and starts implementation. Changes given to the postmaster in the user's
words go to the coachman for a revision and another review. A request to stop closes the run
without launching a workhorse.
