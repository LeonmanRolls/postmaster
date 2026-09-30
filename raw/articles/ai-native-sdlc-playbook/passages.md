# Passages

Quoted from the page at the url in `source.md`, retrieved 2026-09-29. Only the passages the
wiki relies on are kept. Nothing else is changed. Each passage names the section it comes from.

> A stage ends by committing an artifact with the commit initiating the next stage. An accepted `intent.md` triggers the requirements and design pass, an approved `spec.md` triggers plan mode, a merged PR triggers the pipeline, and a breached control band in production writes the next `intent.md` and so the loop continues.

Plays.

> First, you prompt each step by hand with the end state being a loop in which each accepted artifact fires the next gate. Human attention concentrates at the gates, reviewing what the agent flagged rather than starting each stage from scratch.

Plays.

> The product owner reviews that spec, but doesn't write it. The goal of this process is to create a spec the engineering team can plan against, with flagged areas of concern.

Stage 2 — Design, Requirements and design.

> The product owner decides whether the spec and intent progress to build, consulting a technical lead for anything the organization classes as higher risk. A human team mate always makes this call, and accepting the spec is what starts the plan mode play in Stage 3: Build.

Stage 2 — Design, Requirements and design.

> Nothing is implemented without an accepted plan. Institutional knowledge becomes files the agent reads, and the guardrails run as code rather than as habits.

Stage 3 — Build.

> AI-native: Work starts with a written plan that Claude produces in plan mode, where it can read the codebase without changing anything. The engineer corrects the plan before code is written, and the approved version is committed as `plan.md` for later stages to check against.

Stage 3 — Build, Claude Code plan mode as the default starting point.

> Design review happens before any code is generated, when changing course is still a matter of editing a document. Plan mode enforces this itself, since Claude cannot edit files until the engineer accepts the plan. The plan and its revisions are logged along with who accepted it. Routine changes are approved by the engineer, and anything the organization classes as higher risk goes to a tech lead or architect.

Stage 3 — Build, Governance considerations.
