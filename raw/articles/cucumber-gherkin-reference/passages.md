# Passages

Quoted from the page at the url in `source.md`, retrieved 2026-10-04, read through a fetch tool
that returns the page as text. Only the passages the report relies on are kept. Each passage names
its section or page. The fetch tool's markdown emphasis marks (italics, bold, backticks) are dropped; the words are unchanged.

> The purpose of the Rule keyword is to represent one business rule that should be implemented.

Section "Rule"; checked (fetch 1 and fetch 2 agree word for word)

> An outcome should be on an observable output. That is, something that comes out of the system (report, user interface, message), and not a behaviour deeply buried inside the system

Section "Then"; checked up to "inside the system" (fetch 1 and fetch 3 agree; fetch 2 stopped after "message)."). Fetch 3 continued "(like a record in a database)."; that tail is not checked.

> This is a concrete example that illustrates a business rule.

Section "Example"; checked (fetch 2 and fetch 3 agree)

> A Scenario Outline must contain one or more Examples (or Scenarios) section(s).

Section "Scenario Outline"; checked (fetch 1 and fetch 2 agree)

> run the same Scenario multiple times, with different combinations of values

Section "Scenario Outline", the sentence that says what the keyword is for (fragment of a longer sentence); checked (fetch 1 and fetch 3 agree on this fragment)

> You can have as many steps as you like, but we recommend 3-5 steps per example.

Section "Example", on steps; checked (fetch 1 and fetch 2 agree)

Not on the page, as the fetch tool reported it: any sentence about universal words (all, always, never), about what a check does with an input outside the listed examples, or about how many examples are enough.
