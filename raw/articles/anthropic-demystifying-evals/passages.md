# Passages

Quoted from the page at the url in `source.md`, retrieved 2026-10-04, read through a fetch tool
that returns the page as text. Only the passages the report relies on are kept. Each passage names
its section or page.

> A good task is one where two domain experts would independently reach the same pass/fail verdict.

Section "Going from zero to one: a roadmap to great evals for agents > Collect tasks for the initial eval dataset" (heading from one read); checked

> Everything the grader checks should be clear from the task description; agents shouldn't fail due to ambiguous specs.

Section "Going from zero to one: a roadmap to great evals for agents > Collect tasks for the initial eval dataset" (heading from one read); checked

> With frontier models, a 0% pass rate across many trials (i.e 0% pass@100) is most often a signal of a broken task, not an incapable agent, and a sign to double-check your task specification and graders.

Section "Going from zero to one: a roadmap to great evals for agents > Collect tasks for the initial eval dataset" (heading from one read); checked (fetches 1 and 3 agree; fetch 2 stopped after "agent")

> We've found this approach too rigid and results in overly brittle tests, as agents regularly find valid approaches that eval designers didn't anticipate.

Section "Going from zero to one: a roadmap to great evals for agents > Design the eval harness and graders" (heading from one read); checked. The sentence before it on the page says the common instinct is to check that agents followed very specific steps, such as a sequence of tool calls in the right order.

> So as not to unnecessarily punish creativity, it's often better to grade what the agent produced, not the path it took.

Section "Going from zero to one: a roadmap to great evals for agents > Design the eval harness and graders" (heading from one read); checked

> For each task, it's useful to create a reference solution: a known working output that passes all graders. This proves that the task is solvable and verifies graders are correctly configured.

Section "Going from zero to one: a roadmap to great evals for agents > Collect tasks for the initial eval dataset" (heading from one read); checked

> To avoid hallucinations, give the LLM a way out, like providing an instruction to return "Unknown" when it doesn't have enough information.

Section "Going from zero to one: a roadmap to great evals for agents > Design the eval harness and graders" (heading from one read); checked (fetches 3 and 4 agree, straight double quotes; fetch 2 differed only in the nested quote mark)

> For example, Opus 4.5 initially scored 42% on CORE-Bench, until an Anthropic researcher found multiple issues: rigid grading that penalized "96.12" when expecting "96.124991…", ambiguous task specs, and stochastic tasks that were impossible to reproduce exactly.

Section "Going from zero to one: a roadmap to great evals for agents > Design the eval harness and graders" (heading from one read); checked (fetches 3 and 4 agree)

> SWE-bench Verified gives agents GitHub issues from popular Python repositories and grades solutions by running the test suite; a solution passes only if it fixes the failing tests without breaking existing ones.

Section "How to evaluate AI agents > Evaluating coding agents" (heading from one read); checked (fetches 3 and 4 agree)

> Could they pass the task themselves? If not, the task needs refinement.

Section "Going from zero to one: a roadmap to great evals for agents > Collect tasks for the initial eval dataset" (heading from one read); checked (fetches 2 and 4 agree)

The page also says that after fixing bugs and using a less constrained scaffold, the CORE-Bench score of Opus 4.5 rose to 95%, and that the transcript of a failed task shows whether the agent erred or a grader rejected a valid solution; paraphrase, not quoted (one read each).
