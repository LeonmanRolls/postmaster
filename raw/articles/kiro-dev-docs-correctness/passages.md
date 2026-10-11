# Passages

Quoted from the page at the url in `source.md`, retrieved 2026-10-04, read through a fetch tool
that returns the page as text. Only the passages the report relies on are kept. Each passage names
its section or page.

> A property is a universal statement about how your system should behave.

Page text, section on what a property is; checked

> For any authenticated user and any active listing, the user can view that listing.

The example property on the page; checked

> the tool generates hundreds or thousands of random inputs to try to violate it

Section "Concepts"; checked (the full sentence begins "Instead of listing examples, you state a general rule that must always hold, and"; that start was in one read only)

> It provides evidence of correctness, not a proof. It is not formal verification, so passing tests raise confidence but do not guarantee the absence of bugs.

Section "Strengths and limitations"; checked

> Not every requirement maps cleanly to a property.

Section "Strengths and limitations"; checked

> Requirements that depend heavily on external services or non-deterministic behavior may need mocking, or may be better covered by example-based tests.

Section "Strengths and limitations"; checked

> When it finds a violation, Kiro can automatically update your implementation or surface options to fix the spec, implementation, or test itself.

Section on how property-based testing works; checked (two reads gave the same sentence)

The same section also says that a property that is too weak, or that states the wrong invariant, will pass while the real behavior is still wrong; paraphrase, not quoted (one read). One read also said Kiro extracts properties from EARS requirements and determines which of them can be logically tested; paraphrase, not quoted.
