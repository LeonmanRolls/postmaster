# Passages

Quoted from the page at the url in `source.md`, retrieved 2026-10-04, read through a fetch tool
that returns the page as text. Only the passages the report relies on are kept. Each passage names
its section or page.

> Claude stops when the work looks done. Without a check it can run, "looks done" is the only signal available, and you become the verification loop: every mistake waits for you to notice it.

Section "Give Claude a way to verify its work"; checked (two fetches returned the same page text)

> The check is anything that returns a signal Claude can read in the conversation: a test suite, a build exit code, a linter, a script that diffs output against a fixture, or a browser screenshot compared against a design.

Section "Give Claude a way to verify its work"; checked

> write a validateEmail function. example test cases: user@example.com is true, invalid is false, user@.com is false. run the tests after implementing

Section "Give Claude a way to verify its work", table row "Provide verification criteria", After column; checked. The Before column is "implement a function that validates email addresses". The page shows the two addresses as links, so the text is as it reads after the page's link markup is removed.

> The most useful specs are self-contained: they name the files and interfaces involved, state what is out of scope, and end with an end-to-end verification step that proves the feature works.

Section "Communicate effectively", subsection "Let Claude interview you"; checked

> A reviewer prompted to find gaps will usually report some, even when the work is sound, because that is what it was asked to do.

Section "Automate and scale", subsection "Add an adversarial review step", callout; checked

> Tell the reviewer to flag only gaps that affect correctness or the stated requirements, and treat the rest as optional.

Same callout; checked

> Unlike CLAUDE.md instructions which are advisory, hooks are deterministic and guarantee the action happens.

Section "Configure your environment", subsection "Set up hooks"; checked

> Always provide verification (tests, scripts, screenshots). If you can't verify it, don't ship it.

Section "Avoid common failure patterns", bullet "The trust-then-verify gap" (its problem line is "Claude produces a plausible-looking implementation that doesn't handle edge cases"); checked
