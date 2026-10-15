# postmaster

Postmaster takes a ticket to a reviewed, verified pull request. Most of its effort goes into two places: deciding exactly what to build before any code is written, and proving that it works once the code is there. Writing the code is the smallest slice.

## The idea

Anthropic's [AI-native SDLC playbook](https://claude.com/resources/articles/the-ai-native-sdlc-playbook) makes the case that code is no longer the bottleneck. The work moves to the steps on either side of the build: planning before it, and review and testing after it. Postmaster is built to match. The time goes into a plan you have signed off and into checking the result, so the part in the middle can be quick and its output trusted. What the project's wiki takes from the playbook is [written down there](wiki/sources/ai-native-sdlc-playbook.md).

A design goal of postmaster is not to give you a complete solution. It is to let you run experiments on different flows, so that you can find what works for your project.

## The flow

1. Plan. A booking clerk works with you on the ticket until it has acceptance criteria and, for each one, a check that shows it is met: a command, a test, or a walk through the running app. You read the ticket once and sign it off. Nothing starts before that. A run may add a library only if the ticket lists it, the clerk has vetted it and you have said yes.
2. Implement. The acceptance tests are written from the ticket's checks and committed before any of the change. The implementer then loops until every one of them passes. A check that cannot pass as written is not edited to fit; it comes back to you.
3. Review. Reviewers read the change through different lenses: style, bugs and security. They report what they find, the implementer fixes it, and they look again. The loop ends when a round finds nothing serious, and smaller findings are listed for you instead of looped on. If a third round still finds something serious, it stops and brings you what is left.
4. Verify and land. The project's checks run on the final commit, and a check that could not run counts as not run, never as a pass. The result is a pull request with a ship card that lists what was checked and the evidence for it. In a pull-request project you merge it; postmaster never does.

The reasoning behind each step is in the wiki: [the ticket](wiki/concepts/ticket-shape.md), [the review loop](wiki/concepts/review-loop.md) and [verification](wiki/concepts/verification.md).

## Verifiers

Setting up a project offers to make its verifiers, based on [pstack](https://github.com/cursor/plugins/tree/23e4138daa01c42d4969f7a5465f82704e64f798/pstack)'s create-verification and maintain-verification skills. A verifier is a small folder that tells an agent arriving cold how to start one surface of the project, drive it the way a user does, and keep proof. The clerk writes a ticket's checks through a verifier wherever a criterion drives that surface, and after a change lands postmaster checks whether any verifier has gone stale and offers to bring it up to date. [More about verifiers](docs/verifiers.md).

## Who does what

- The postmaster splits a stream of work into tickets, starts one coachman per ticket, supervises, and answers escalations.
- The booking clerk prepares one ticket with you.
- The coachman carries one ticket from plan to ship card, in two legs: implement, then review.
- The lanes are the agents that write and review code. A lane is an agent harness plus a model, and the config says which one fills each role.

One implementer can write the change, or several models can write it independently in separate worktrees while the coachman combines what each got right. [Why several models](docs/why-several-models.md). [The roles in full](docs/roles.md).

## Everything is recorded

Every action is logged as it happens, and every run can be traced from ticket to merge. What the project has learned lives in the [wiki](wiki/index.md), where each claim cites the recorded runs behind it.

## Getting started

Clone this repo, open your agent in it, and say hi. Any first message starts the flow, and `AGENTS.md` tells the agent what to do, so there is no command to learn. Setup asks one question at a time (which agents fill which role, where tickets live, who gives the merge word), then you choose the project to work on.

The rest is in short pages:

- [Getting started, with every command](docs/getting-started.md)
- [The .postmaster folder and project settings](docs/project-settings.md)
- [What it needs, and notes for macOS](docs/requirements.md)
- [Installing the skills, tickets and project configuration](docs/installing-skills.md)
- [Native sessions](docs/native-sessions.md)
- [Design principles](docs/design-principles.md)
- [Records and the wiki](docs/records-and-the-wiki.md)

See `AGENTS.md` for the full context, and `skills/postmaster/` for the runbooks and adapters.
