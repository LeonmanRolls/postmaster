# Passages

Quoted from the page at the url in `source.md`, retrieved 2026-10-04, read through a fetch tool
that returns the page as text. Only the passages the report relies on are kept. Each passage names
its section or page.

> The objective of a secure system is to prevent all unauthorized use of information, a negative kind of requirement.

Section "Design Principles" (heading as one fetch showed it); checked.

> It is hard to prove that this negative requirement has been achieved, for one must demonstrate that every possible threat has been anticipated.

Same paragraph; checked.

> Base access decisions on permission rather than exclusion.

Fail-safe default principle; checked.

> ...means that the default situation is lack of access, and the protection scheme identifies conditions under which access is permitted.

Same principle; checked (one read elides "suggested by E. Glaser in 1965" with an ellipsis, the other prints it; the words after it agree).

> Every access to every object must be checked for authority.

Complete mediation principle; checked.

> In a large system some objects will be inadequately considered, so a default of lack of permission is safer.

Same principle; checked (second and third reads).

> A design or implementation mistake in a mechanism that gives explicit permission tends to fail by refusing permission, a safe situation, since it will be quickly detected.

Same principle; checked (second and third reads).

> The alternative, in which mechanisms attempt to identify conditions under which access should be refused, presents the wrong psychological base for secure system design.

Same principle; checked (second and third reads).
