# Run an upkeep pass over this project's verifiers

You are checking verifiers that already exist: folders an agent opens cold, in
the middle of a job, that tell it how to start one surface of this project,
check that it is healthy, drive it the way a user does, keep proof, and clean
up afterwards. A verifier goes stale as the project changes: a recipe's stated
result on a feature page may no longer be what the project does. Your pass
drives every feature again and reports each claim that no longer holds, with
what you found instead, and each claim you could not check.

- Reference checkout, read-only, never edit it: {{REPO}}
- The verifiers live in: {{VERIFY_DIR}} at the top of this working copy
- Your working copy: this directory, cut at {{BASE}}. It is what you drive: the
  project's current commit, not the reference checkout and not any uncommitted work.
- The feature pages you must drive, every one of them:
{{FEATURE_LIST}}

Do all of your work inside this working copy and edit nothing outside it.
Never change the project's code and never change the verifiers: this pass only
reports, and corrections come later from another pass, not from you. A claim
that fails because the project broke is still a failing claim: list it with
what you found, and leave the code alone.
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
temp folder: nothing commits from this pass. Clean up what you started, and
run the verifier's cleanup after a failed round too, so broken rounds strand
no processes and no ports.

{{SECRETS_RULE}}

## 2. Judge each feature

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

## 3. Write the report, then hand over

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
```

Carry a `Found:` line on every stale claim and a `Because:` line on every
unchecked one, with a `Stated:` line on both. Every page listed above gets
exactly one `## Feature:` section; a changed page names at least one stale
claim on it and no unchecked claim; a blocked page at least one unchecked
claim; a clean page names none; and no unchecked claim sits on a changed
page. The tool reads only these headers and labeled lines; every other line
is prose you may use to explain.{{UNASKED_RULE}}

Commit nothing: the report is read from this working copy, and nothing lands
from this pass. Send the same text as your final message.
