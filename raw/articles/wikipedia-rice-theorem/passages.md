# Passages

Quoted from the page at the url in `source.md`, retrieved 2026-10-04, read through a fetch tool
that returns the page as text. Only the passages the report relies on are kept. Each passage names
its section or page. The fetch tool draws italics and inner quotation marks differently from one
read to the next; the words are the same.

> In computability theory, Rice's theorem states that all non-trivial semantic properties of programs are undecidable.

Lead, first sentence; checked (three reads agree word for word).

> A semantic property is one about the program's behavior (for instance, "does the program terminate for all inputs?"), unlike a syntactic property (for instance, "does the program contain an if-then-else statement?").

Lead; checked (two reads agree word for word).

> A non-trivial property is one that is neither true for every program, nor false for every program.

Lead; checked (two reads agree word for word).

> The theorem generalizes the undecidability of the halting problem.

Lead; checked (two reads agree word for word).

> it is possible to implement a tool that always overestimates or always underestimates, so in practice one has to decide what is less of a problem

Lead, in the parenthesis of the sentence that follows the one above and the one on feasibility of static analysis; checked (two reads agree on the whole sentence, which is longer than 40 words, so only this excerpt is kept).

> Rice's theorem asserts that it is impossible to decide a property of programs that depends only on the semantics and not on the syntax, unless the property is trivial (true of all programs, or false of all programs).

Introduction, first paragraph; checked (second and third reads by a helper, and one by the session).

> By Rice's theorem, it is impossible to write a program that automatically verifies for the absence of bugs in other programs, taking a program and a specification as input, and checking whether the program satisfies the specification.

Introduction, second paragraph; checked (second and third reads by a helper, and one by the session).

> This does not imply an impossibility to prevent certain types of bugs.

Introduction; checked (first and second reads by a helper, and two by the session).

> Another way of working around Rice's theorem is to search for methods that catch many bugs, without being complete.

Introduction; checked (second and third reads by a helper, and one by the session). The next sentence, "This is the theory of abstract interpretation.", was given by one read of the session and by the helper's reads.

> Yet another direction for verification is model checking, which can only apply to finite-state programs, not to Turing-complete languages.

Introduction; checked (all three reads by a helper).

Paraphrase, not quoted: the formal statement. Let phi be an admissible numbering of the partial computable functions and P a set of indices that is non-trivial (neither empty nor all the natural numbers) and extensional (if two indices compute the same function, either both are in P or neither is); then P is undecidable. Only the opening ("Let φ be an admissible numbering") and the ending ("Then P is undecidable") were given by two reads; the middle by one.

Paraphrase, not quoted: the page says that although one cannot algorithmically check whether any given program satisfies a specification, one can require programs to carry annotations that prove them correct, or to be written in a restricted form that makes verification possible, and accept only programs verified that way (one read; not checked).
