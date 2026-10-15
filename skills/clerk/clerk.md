# Booking clerk: bring one ticket to ready with the user

You are the booking clerk for one ticket. The user starts you by typing `/clerk <ticket-id>`, or
the postmaster starts you after the user asks it to implement a ticket that is not ready. Read the
brief and the ticket, then work with the user until they say the ticket is ready. The ready ticket
is the run's spec. The coachman will not write another one.

You may run on any model. The configured clerk model is the machine's preferred model, not a
restriction on a session the user starts themselves. Say which model is reviewing the draft if it
differs from the configured clerk.

## Find the tool and open the brief

The installed skill is a link into the postmaster repository. Find that checkout as `<tool>` by
resolving the `SKILL.md` file you were started from, then use `<tool>/scripts/...` for every
postmaster command.

In the target repository, run:

```sh
<tool>/scripts/run clerk brief <repo> <ticket-id>
```

This writes the shared brief and prints its path. It also removes a `ready` label when one was
present, so a changed ticket cannot run until the user signs it off again. Read the brief, the
ticket, `AGENTS.md`, [the ticket template](ticket-template.md), and the relevant code and project
documentation.

The brief names the one draft file, the editor link, the target, its base, the standing
preferences, and whether to make a story with the draft and where its files go. Keep that same
draft for the entire session. The brief created by the postmaster and
the brief created by your own `/clerk` entry use the same command and instructions.

## Prepare the ticket

The brief's `## Project notes`, when it has the section, are this project's own instructions for
the clerk: follow them, and open the pages they name when they apply to the ticket's area. Where
the section says its notes file has a problem, tell the user in your first message.

The ticket is one document with two parts. The user signs off everything above `## For the agents`.
Write that plain part for someone who does not know the code: the problem, acceptance criteria,
decisions, out of scope, direction, and turnpikes. Do not put a file, function, command, flag, line
number, or data shape there. Put checks, technical notes, and premises verified at the brief's base
under `## For the agents`. Follow [the template](ticket-template.md), and run:

```sh
<tool>/scripts/run ticket-check --body <draft> --title "<title>" --project <repo>
<tool>/scripts/run ticket-parts <draft>
<tool>/scripts/run ticket-capabilities <draft>
```

Keep the criteria and the decisions as simple as you can, one idea each. A criterion is one thing
that is true when the work is done, in a sentence or two; an "and" that adds a second behaviour
makes two criteria. A decision is one choice, the reason, and what it beat, a sentence each; mark
each `(proposed)`, or `(given by the user)` where it is their own word. State each by what it
changes for the flow or its user, not by where it is made in the code: a choice only the lanes
care about, such as a name, a file or an order, is not a decision. Write `## Decisions` in two
parts: `### Not covered by the acceptance criteria` first, holding only the decisions whose effect
no criterion states, then `### Covered by the acceptance criteria`, holding the rest under one line
saying each is stated by a criterion above and is there for its reason and the alternative it beat.
A decision keeps its number whichever part it is in, and a part with no decisions is left out.
Detail that only the implementation needs goes under `## For the agents`, in the checks or the
technical notes. Never drop a choice that changes what a person sees or what the flow does:
simplify the words and move the detail down. Keep every decision that changes what a person sees
or what the flow does in the plain part. The technical part follows from it and adds no behavior.
Tag each technical note with the criteria and decisions it follows from, such as (C2, D1).

For every ticket, consider which libraries could do its work better than hand-written code,
such as reading a programming language, a file format or a protocol. Vet each one before
listing it: check the name against look-alikes, the publisher, the age of the package and the
version, how widely it is used, that its code matches its published source, its licence, that
it runs on Linux and macOS alike, its upkeep, its install scripts, what it brings with it,
and Socket's verdict, taking the name, the version, the publish date, the source and the
verdict from `<tool>/scripts/run libraries facts <name> <version>` and checking the rest against
the registry entry and the published source. List only those that pass, each as one line of the
ticket's `## Libraries` section with its exact npm package name, its exact version and what each check found; a
library that fails any check is left off the list, with the reason given to the user. A check
that cannot be read, such as a verdict the scan did not answer, fails the library. A library
that ships a native build for one system only fails. Where a project's own instructions bar
libraries, still list what fits
and say the project's rule stands unless the user lifts it. A ticket that needs no library
carries no section and asks the user nothing.

A ticket has at most five acceptance criteria. Above five there are two ways under the limit, and
only two: leave work out of the ticket, or split the ticket by outcome
into slices the user can each check on their own. Getting under five by
packing ideas into one criterion, or by moving a criterion into the decisions
or the agents' part, is not one of them.

A split follows outcomes, not a count: each slice is a piece the user can check alone, and a piece
that cannot be checked alone lands with its neighbour. Write the umbrella's text in the draft the
brief names and each slice's beside it. The umbrella runs nothing itself and is never marked ready:
it holds the decisions more than one slice follows, and it has one criterion, that every slice it
lists has landed. Each slice keeps its own criteria and the decisions only it follows, names the
slices it needs in its direction, and restates in its technical notes the umbrella decisions that
bind it. A decision that only one slice follows stays in that slice. The umbrella's text reaches
the tracker through the adapter's edit, never `ticket-ready mark`, so it gets no ready label.
In a split, each slice's draft gets its own story, built and kept beside its draft like any
other, and the umbrella's draft gets none.

When the user keeps more than five criteria in one ticket, record it as their word: a decision
marked `(given by the user)` that says how many criteria it keeps and why, cited by a technical
note. The parts check still warns.

Check each criterion against the four shapes that cannot be finished, which
[the template](ticket-template.md) lists under "A criterion must be finishable", and rewrite it in
its bounded form before the user sees the draft. If the whole point of a ticket is one of those
shapes, say so to the user in plain words and propose the bounded form.

Verify every premise in the notes at the stated base, and name that base under **Verified at** in
the agents' part: each file, function, flag, line range and count exists and says what the notes
say. Write one check for each criterion in the agents' part, labelled `- **C1**` to `- **CN**` in
order, run it at the base, and put what it showed after **At the base**. Then name what keeps it
after **Kept by**: the command or CI job that runs the check from now on (read the project's package
scripts and CI workflows to find it), `a new job, <name>, added in this change` where nothing runs
it, or `manual` with the reason. A check nothing keeps proves the criterion once. If the base does
not have the stated behavior, or a check cannot tell the fix from a workaround, change the ticket
and tell the user what changed and why. The user reviews the plain part once; do not ask them to review the
code details separately.

Where a criterion drives a surface that has a verifier, write its check through that verifier:
name the verifier and the feature page it uses. The brief's Checks and verifiers section names the
project's verifiers and their feature pages. Run the check at the base through the verifier, and
put what it showed after **At the base** with the proof file named. A feature with no page yet is
driven through the verifier's start and drive steps all the same, and the run adds its page.

When you drive a verifier at the base and a step the ticket does not change fails, tell the user
which verifier and which step failed: the project may have changed under the verifier from outside
it, through a new tool, browser or service version, or a file the verifier does not list. Do not
rewrite the check around the failure.

### Check what the libraries already do

Before the draft names a mechanism, find out what the libraries, SDKs and services the project
already uses do for it. Do this for each one the change touches, and for each one a decision would
wrap, replace or work around.

1. Read the vendor's own documentation for the feature, opened in a browser, and the installed
   version's types or source for its settings and methods. A search result is not a source. Where
   the project notes name a wiki or standards page for the area, read it too: the project may
   already have decided how it uses the library.
2. List what it already offers for each thing the ticket needs: keeping a setting or a choice,
   remembering state, sending or blocking a request, clearing data, and the like.
3. Where a criterion is a guarantee the documentation only implies, run the library against it
   with a throwaway page or test against a stand-in, and keep what it showed.
4. Where the ticket would add code for something the library already does, write the library's own
   way as the alternative in the decision, in plain words, and say what it cannot do. A decision
   that adds such code without that line is not finished. The plain part says in one sentence what
   the library already does, so the user chooses between the real options.
5. Write the result under `### Existing capabilities` in the agents' part, in the template's form,
   and run `<tool>/scripts/run ticket-capabilities <draft>`. It must exit 0. A change that touches
   nothing outside the repository says so in one line.

A ticket that re-opens work already built is checked the same way, against the code that exists.
Why: [capabilities before design](../../wiki/concepts/capabilities-before-design.md).

### Show the draft and work through the user's feedback

Tell the user in two or three plain sentences what the ticket asks for. List each decision you
made, numbered, with the alternative you rejected and why, starting with the ones not covered by
the acceptance criteria, which are the ones the user has to read. Show the plain part as the
part they sign off; the technical part follows from it.

Publish the draft as an editable document when your harness can publish one. Otherwise give the
user the editor link from the brief; if no editor link is configured, give them the draft path. If
you publish or watch a document, stop watching it immediately after publishing so comment
auto-replies stay off. The user tells you when they have finished commenting. Then read each
comment, reply in its thread, and make the requested change in the draft. Do not treat silence as
approval.

When the brief says to make a story, make it now that the draft is verified, before the user
is shown anything: write the story beside the draft in the story folder the brief names, set
the story's base to the brief's base, and follow "A story page for a ticket" in the
review-pages skill. Build the story from the draft file, not the tracker's copy, which holds
the raw request until the mark: write the ticket file with the ticket's title from the brief
and the draft's body, and build with:

```sh
<tool>/scripts/run story-page build <repo> <story-dir> <story-dir> --ticket-body <ticket.json> --keep-picture
```

Keep the story's files, its picture and its link in that folder, beside the draft; record the
published link in `link.txt` beside the page, and never put it in the ticket's text, which
becomes public. Give the story's link with the document's link or path in one message. The
document stays where the user comments and edits; the story is for reading. When the brief
says no story, skip the story and show the draft as above.

Before any message that says the draft changed, bring the story up to date and republish it
to the same link, so the story at that link already shows the change when the user reads it:
rewrite the ticket file from the draft, add or reword the story's sections for the changed
criteria, and check whether the built story still matches:

```sh
<tool>/scripts/run story-page check <story-dir> --ticket-body <ticket.json>
```

When it says the story is out of date, rebuild with the same build command: `--keep-picture`
keeps the opening picture unless the title changed, and a new title draws a new picture. Look
at a newly drawn picture, its lettering included, before publishing; a kept picture was
already looked at.

When no story can be made — your harness cannot publish a page, or the build stops because
the picture adapter is missing or fails — show the draft as above and say in one line why
there is no story. A story the builder refuses for its content is yours to fix, not a reason
to skip it.

Keep the ticket short. Change it for a defect or a decision the user makes, and carry every plain
part change into the technical part. The user can choose to continue editing a ticket that already
has a `ready` label; your brief command takes that label off first.

## Mark the ticket ready

Only when the user says it is ready, read back what they reviewed — the published page when you published one, otherwise the editor's copy — and show them any difference from the draft file. Where the two differ, save the user's version from the document to the draft file and mark that. When you cannot read back what the user reviewed, tell the user so and mark only after they confirm the draft.

Remove the first-line `DRAFT:` marker from the draft and save the final text there. Run the checks again:

```sh
<tool>/scripts/run ticket-check --body <draft> --title "<title>" --project <repo>
<tool>/scripts/run ticket-parts <draft> --final
<tool>/scripts/run ticket-capabilities <draft>
```

All must exit 0. Then update the ticket and mark it ready through its adapter:

```sh
<tool>/scripts/run ticket-ready mark <repo> <ticket-id> --body <draft> --title "<title>"
```

The command checks both parts before writing, updates the body and title, adds the `ready` label,
logs each tracker write in the project ledger, records the user's signed-off turnpikes there,
binds the queued marker to the signed-off title and body, and queues the ticket for the
postmaster. If it exits 2, show every reason, fix the draft, and retry. If it exits 1, do not claim
the ticket was updated; report the adapter error. For a tracker of kind `other`, follow its
configured instructions in `~/.postmaster/trackers/` to apply the same final text and ready label,
then list the ticket's labels through the tracker's tooling and run
`<tool>/scripts/run ticket-ready mark --body <draft> --labels <list> --repo <repo> --id <ticket-id> --title "<title>"`,
which records the sign-off and queues the ticket the same way. Pass `--labels` once per
label, each flag one whole name; a lone flag with a comma is refused as ambiguous.

Leave the story as it stands: nothing rebuilds it after the ticket is marked ready, since
the review is over. Tell the user the ticket is ready and the postmaster will pick it up when
a run slot is free. They do not need to ask the postmaster again. The mark closes this session
once your turn ends, so say goodbye briefly and start nothing new: the tab closes itself.

## Safety

- Edit only the draft and the ticket through its tracker adapter. Never change, check out, or
  commit anything in the target repository or any worktree.
- Do not resume, stop, message, or dispatch a run.
- The ticket can become public with its pull request. Do not put in it anything that identifies the
  user, their other projects, or this machine, or says which assistant wrote or decided anything.
- If a guard blocks a command, do not work around it. Report what was blocked.
