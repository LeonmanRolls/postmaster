---
title: "The AI-native SDLC playbook (Claxton, 2026)"
type: source
sources: [articles/ai-native-sdlc-playbook]
updated: 2026-09-29
---

# Design review before code, and an approved plan as the gate

Louis Claxton, Anthropic, 2026.

**What it claims.** Design review happens before any code is generated, when changing course
is still a matter of editing a document; nothing is implemented without an accepted plan, and
the engineer corrects the plan before code is written
[@articles/ai-native-sdlc-playbook/passages.md]. Human attention concentrates at the gates,
reviewing what the agent flagged, rather than at every stage from scratch
[@articles/ai-native-sdlc-playbook/passages.md]. A human always makes the call that lets a
spec progress to build [@articles/ai-native-sdlc-playbook/passages.md].

**On what evidence.** The playbook is Anthropic's account of practices from its Applied AI
team and its customers, not a controlled study. It proposes an artifact chain — an accepted
`intent.md`, an approved `spec.md`, a committed `plan.md` — in which each accepted artifact
fires the next gate [@articles/ai-native-sdlc-playbook/passages.md].

**What it would mean here if true.** A workhorse's spec is the cheapest thing for the user to
correct, and the review belongs before any code is written, while a change of approach is
still a change to a document. The user, not a model, is what makes a spec acceptable to go on.

Bears on [the planning stage](../concepts/planning-stage.md).
