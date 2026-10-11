# Run a correcting upkeep pass over this project's verifiers

You are correcting verifiers that already exist: folders an agent opens cold,
in the middle of a job, that tell it how to start one surface of this project,
check that it is healthy, drive it the way a user does, keep proof, and clean
up afterwards. A verifier goes stale as the project changes: a recipe's stated
result on a feature page may no longer be what the project does. Your pass
drives every feature again, corrects each claim that no longer holds, proves
each correction by driving its recipe again, and reports what it found and what
it corrected.

- Reference checkout, read-only, never edit it: {{REPO}}
- The verifiers live in: {{VERIFY_DIR}} at the top of this working copy
- Your working copy: this directory, cut at {{BASE}}. It is what you drive: the
  project's current commit, not the reference checkout and not any uncommitted work.
- The feature pages you must drive, every one of them:
{{FEATURE_LIST}}

Do all of your work inside this working copy and edit nothing outside it.
Correct only inside the verifiers' folders named above: feature pages, helpers
and index entries. Never change the project's code and never change any file
outside those folders: this pass corrects the record, not the project. A claim
that fails because the project broke is still a failing claim: list it with
what you found, correct nothing for it, and leave the code alone.
{{ASK_RULE}}

## 1. Drive every feature

Drive the pages listed above one after another, in the order listed, following
each page's own recipes: run the commands as written, read what they print and
store, and compare with the stated result. A claim is one stated result on a
feature page: an output, an exit code, a stored row, a file's content. Drive
the true user path the page shows, never a shortcut around it.

Run each verifier's health check before that verifier's first drive, and again
after any drive that failed or surprised you. When the health check itself
fails, say so in the report and keep driving: a broken project still gets its
claims listed, not a stopped pass.

Every drive gets state of its own, so no drive touches real data. Where the
verifier found two copies can run side by side, drives may run together; where
they cannot, say so in the report and run drives one at a time. Keep proof
outside this working copy, in the folder the verifier names or the system's
temp folder: proof never commits. Clean up what you started, and run the
verifier's cleanup after a failed round too, so broken rounds strand no
processes and no ports.

{{SECRETS_RULE}}

## 2. Judge each feature, then correct what no longer holds

Give every page you drove exactly one outcome:

- clean: every claim you checked holds.
- changed: at least one claim no longer holds. Quote the claim as the page
  states it, and what you found instead: the output, the exit code, the stored
  state.
- blocked: you could not check at least one claim. Say what stopped you: the
  missing command, helper, login or file, and the exact error when there is one.

A claim you could not check is unchecked, never holding: it gets its own entry
saying why, and its page is blocked. A page with both a stale claim and an
unchecked claim is blocked too: the unchecked claim means the page was not
fully driven, so list every claim of both kinds. A claim that fails because
the project broke is listed like any other failing claim, with the breakage
as the finding.

For every other stale claim, correct the verifier: reword the stated result
to what the project now does and mend the helper or recipe that produces it,
keeping the page's shape. Then prove the correction: drive the recipe again
and check the new stated result holds. A correction that is not driven again
is not a correction. Correct only what you drove: never an unchecked claim,
and never a claim the project broke to match the breakage. When the project's
own usage, options or stored rows changed, the pages that quote them change
together: a correction that fixes one page while its neighbors still quote
the old behavior is half a correction.

## 3. Confirm every verifier, then hand over

Confirm every verifier you drove at the commit you drove: {{BASE}}. In each
verifier's index entry, carry `Confirmed: {{BASE}}` beside its `Files:` list:
for a verifier with its own features index, a line of its own in that index;
for a verifier under a shared index, on that verifier's own bullet. The
confirmation says this pass drove the verifier at that commit, with
corrections or without: move it even where every claim held.

Commit the corrections and the confirmation on this branch, never UPKEEP.md:
the branch carries what the pass proposes, and the report is read from this
working copy. The branch must touch nothing outside the verifiers' folders.

Write UPKEEP.md at the top of this working copy: one `## Verifier:` section
per verifier, one `## Feature:` section per page you drove, and one
`## Claim:` section per claim that no longer holds or that you could not
check, in exactly this shape:

```
## Verifier: <name>
Folder: <the verifier's folder relative to the top of the working copy>

## Feature: <the page's path relative to the top of the working copy>
Outcome: clean | changed | blocked

## Claim: <a short name, unique in the report>
Page: <the page the claim is on>
Verdict: stale | unchecked
Stated: <the claim as the page states it>
Found: <what the drive showed instead>
Because: <why it could not be checked>
Corrected: <what you changed and what driving the recipe again showed>
```

Carry a `Found:` line on every stale claim and a `Because:` line on every
unchecked one, with a `Stated:` line on both. Carry a `Corrected:` line on
every stale claim you corrected and proved, and never on an unchecked claim
or one the project broke. Every page listed above gets exactly one
`## Feature:` section; a changed page names at least one stale claim on it
and no unchecked claim; a blocked page at least one unchecked claim; a clean
page names none; and no unchecked claim sits on a changed page. The tool reads
only these headers and labeled lines; every other line is prose you may use
to explain.{{UNASKED_RULE}}

Leave UPKEEP.md uncommitted: the report is read from this working copy, and
only the verifiers' folders land from this pass. Send the same text as your
final message.
