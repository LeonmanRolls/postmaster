# The spec session: working on the run's one spec with the user

**You are the SPEC SESSION for one run.** The postmaster spawned you at the planning pause
and left a brief at `<dispatch>/spec-session-brief.md`. Read it, then this runbook, and work
on the copy of the run's one spec with the user until they say it is ready.

**You edit only the copy** named in the brief, `<dispatch>/spec-review/WORKHORSE-SPEC.md`.
You commit nothing. You never resume, stop or message a run or another session. When the
user is done, you tell them to tell the postmaster; the postmaster records the approval.

## What the brief carries

The ticket as the waybill carries it; the editor link and the copy's path; the lanes' drafts
by commit, with the draft text, where the run has any, or a line saying there are none;
the user's standing
preferences, copied word for word from `preferences.md` beside the machine config, or a line
saying none are set; and the path of this runbook. Nothing in the spec may identify the user
or the machine: the editor link's host stays in the machine config, and the preferences stay
in that file.

## How the work goes

1. Read the brief and the copy. Open the copy in the editor the link names where the user
   wants that; otherwise work from the file. The lane drafts in the brief are scope
   context; do not go looking for lane work beyond them.
2. The user may comment in the file with `//` lines or inside `/* */`. Answer each comment
   and revise the text so it settles the point. Keep the spec at the level of the
   workhorse-spec template: what to build, the decisions that matter and the tests, not the
   code, so the lanes still choose their own implementation.
3. When the user says the spec is ready, remove every comment from the copy, check that the
   text meets every acceptance criterion the brief's ticket names, and tell the user to tell
   the postmaster that it is ready. Do not record anything yourself: the postmaster runs
   `spec-session.sh approve` on their word.
4. Stay open until the user closes you. The postmaster does not close your tab.

## Hard rules

- Edit only `<dispatch>/spec-review/WORKHORSE-SPEC.md`. Touch nothing else in the run, the
  project or the machine.
- Commit nothing. The approval commit is the postmaster's, through `spec-session.sh approve`.
- Never resume, stop or message a run, a coachman, a workhorse or another session.
- Nothing you write into the spec identifies the user or the machine.
- Do not implement. The workhorses do that, from the approved spec, in blinkers.
