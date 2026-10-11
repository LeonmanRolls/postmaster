---
title: The flow could run on Cloudflare as a control plane and one container per launch, but not on a Worker, and not yet on subscription logins
type: concept
standing: claimed
sources: [articles/cloudflare-containers-sandboxes, articles/cloudflare-containers-issue-reports, articles/cloudflare-control-plane, articles/cloudflare-ai-gateway, articles/openai-codex-login-and-terms, articles/anthropic-claude-code-login-and-terms, articles/meta-muse-code-login-and-terms, articles/xiaomi-mimo-code-login-and-terms, articles/other-harnesses-login-and-terms, articles/model-api-prices, articles/on-demand-containers-and-sandboxes, articles/on-demand-virtual-machines, articles/ci-runners-free-tiers-and-phones, trials/2026-10-08-cloudflare-run-cost, trials/2026-10-03-lane-audit]
updated: 2026-10-09
---

# Running the flow on Cloudflare

**Claim.** The flow could run on Cloudflare with Workers, Durable Objects and Workflows as the control plane and one
container for each lane, reviewer and coachman leg. It would be an option that a ticket chooses beside local runs, never a
replacement ([#362, A ticket can name where its lanes run, on this machine or in a remote sandbox, starting with a spike on
Cloudflare and Vercel](https://github.com/brindlewick/postmaster/issues/362) is the ticket for it). A Worker alone cannot run a lane. Cloudflare's own tutorials run
Claude Code, Codex and Pi headless in a container with the model key held in the Worker. They use API credentials; an
earlier example in Cloudflare's sandbox repository held a Claude subscription token the same way, and is gone from the
current examples. Whether a Worker may hold a subscription login and use it from a vendor-neutral cloud container is not
settled by any vendor's words: each documents a login on its own runner, and the terms leave the rest open. The Cloudflare
bill is container time, with the control plane at cents: about $1 to $4.50 for a typical run, and up to about $4 to $7 for
the average run. Cloudflare is not the cheapest place to buy that compute. Priced on the same two kinds of hour, five other
container platforms come to less for a typical run, by $0.25 to $0.59, and the platforms built for agent sandboxes come to
more. Virtual machines billed by the hour land inside Cloudflare's range, except spot, on a size that holds neither the gate nor
a 16 GiB coachman ([Other on-demand providers](#other-on-demand-providers)). The model bill is the same on any host,
so it is a side note at the end of [Cost](#cost).
[Issue #341](https://github.com/brindlewick/postmaster/issues/341), "Research: could postmaster's
flow run on Cloudflare, with Workers as the control plane and Containers for the lanes?", asks the question.

**Standing: claimed.** Everything below about Cloudflare and the vendors is what their documents, code and
changelogs say on 2026-10-08, and on 2026-10-09 for the other providers' prices. Nothing was run on Cloudflare or on any other
provider: no account, no deploy, no instance. The counts made from
this fleet's records are arithmetic on the lane audit's times and tokens, on the uptime of each coachman's last process and
the tokens of each launch's own stream, and a scan of the flow's scripts
[@trials/2026-10-08-cloudflare-run-cost/method.md]. Their [controls](../../raw/trials/2026-10-08-cloudflare-run-cost/results/controls.md)
show the code applies each rule the same way to cases that must read non-zero and cases that must read zero. They
cannot show that Cloudflare behaves as documented. By [the schema](../schema.md) outside documents do not move a
standing.

## The answer

1. **A Worker cannot run a lane.** It has 128 MB of memory, `node:child_process` is a non-working stub, and its
   filesystem is held in that memory [@articles/cloudflare-control-plane/passages.md] (B1, B3, B4).
2. **A container can.** "Each instance is a microVM with its own kernel and network, so no other workload shares it."
   The largest self-serve size is 4 vCPU, 12 GiB and 20 GB, and Cloudflare says to ask for larger ones
   [@articles/cloudflare-containers-sandboxes/passages.md] (A6.2, A3.1).
   Cloudflare publishes a runnable tutorial for Claude Code, Codex, Pi and OpenCode (A7). Three of those are among
   the flow's seven harnesses.
3. **Cloudflare's current material shows the model key staying outside the sandbox for API credentials.** The sandbox holds a
   placeholder; the Worker adds the real key, through AI Gateway credits or a stored provider key. No page of the Sandbox,
   Containers, Agents or AI Gateway documentation shows a subscription login
   [@articles/cloudflare-containers-sandboxes/passages.md] (A7.6) [@articles/cloudflare-ai-gateway/passages.md] (B12, B13, B21;
   a search of those folders for a subscription login found none). Cloudflare's sandbox repository did, for Claude Code: from
   2026-04-20 until 2026-09-02 an example let a Claude subscription token sit in the Worker and sent the container a placeholder
   `CLAUDE_CODE_OAUTH_TOKEN`, and a contributor wrote that it worked. The folder went in a commit that changed 300 files, and
   the current examples have no such route; no reason is given (A7.7). That shows a mechanism, not that any vendor allows it.
4. **The vendors' words leave a subscription login open.** OpenAI says "The right way to authenticate automation is
   with an API key", documents a ChatGPT login on a trusted private runner as an advanced option, and says not to share
   one `auth.json` across concurrent jobs or machines. Anthropic documents a one-year token for CI, requires its Commercial
   Terms for Claude Code run "in hosted sandboxes or other agent infrastructure", and bars third-party developers from
   routing or intermediating plan credentials. Meta limits a subscription credential to its own harness. Xiaomi limits a
   Token Plan to programming tools and gives "automated scripts" as an example of a use it bars. Details in
   [Logins and terms](#logins-and-terms).
5. **The Cloudflare bill is container time, and it is small.** A typical (median) real run, with every launch in a
   container of its own, costs $0.98 to $2.68 on 2 vCPU, 8 GiB machines and $1.61 to $4.43 on 4 vCPU, 12 GiB machines, with a
   quarter of the CPU busy; over every size and CPU use the extremes are $0.50 and $9.60. The average run costs more, up to
   about $4 or $7, because a few long runs dominate, and the 18 audited runs together, which span 2026-09-28 to 2026-10-03,
   would have cost $26 to $123 with a quarter of the CPU busy. The widest uncertainty is the coachman's process time, which the records bracket at
   3.6 to 18.8 hours. The control plane is cents, and the plan is $5 a month
   [@trials/2026-10-08-cloudflare-run-cost/results/cost.md]. The model bill is the same on any host and is a side note.
6. **Cloudflare is in the middle on price, not the cheapest.** The same two kinds of hour, a gate hour (4 vCPU and 12 GiB, every
   vCPU busy) and a waiting-agent hour (1 vCPU and 4 GiB, a fifth busy), were priced from each provider's own page. For a typical
   run Northflank, Modal Functions, AWS Fargate, Azure Container Instances and Fly.io Machines come to $0.75 to $1.88 and
   Cloudflare to $1.32 to $2.13; Google Cloud Run comes to $1.44 to $2.87 and the agent-sandbox products, Modal Sandboxes and
   Vercel, to $2.46 to $5.00. Cloudflare's waiting-agent hour, $0.053, is within a cent of the lowest. Its gate hour, $0.401, is
   not, because it charges $0.072 for each busy vCPU-hour where the platforms with a cheaper gate hour charge $0.017 to $0.065
   for every vCPU-hour, busy or not. A virtual machine of 4 vCPU and 8 GiB billed by the hour for a run's whole life comes to
   $1.04 (Azure Spot) to $2.02 (Linode) at the median run life of 28 hours, and $3.77 on AWS on demand, but that size holds neither
   the 12 GiB gate nor a 16 GiB coachman. E2B and Daytona cap a sandbox below the gate's 12 GiB. The figures rest on two profiles
   that were not measured ([Other on-demand providers](#other-on-demand-providers)).
7. **The machine's cores are the limit a cloud lifts. The model providers' usage windows and the user's rulings are not.**
   [#362](https://github.com/brindlewick/postmaster/issues/362) reports a load of 30 to 40 on 18 cores with ten runs in flight,
   and the shared machine's memory cap and one launch's signal to every process each stopped launches. A container has its own
   CPU, memory and process space. A usage limit on a model account, an overloaded model host and the wait for a spec review
   travel with the run to any host ([Concurrency](#what-limits-concurrency-and-what-a-cloud-would-lift)).
8. **A container per lane would stop every reach the isolation scan found inside the machine**, by the documented design
   (argued, not tried), and leaves open the destinations the network handler allows, the git remote, the hand-back of work and
   where the blind tests live ([Isolation](#isolation)).
9. **What breaks is mostly the single-machine assumptions.** Code in a container is not "activity" to the platform, the
   control plane must keep it alive and poll it, the disk is ephemeral, the scheduling policy the documentation lists as
   best for sandboxes, which Sandbox SDK 1.0 uses, is in public beta, and the scripts lean on one machine's files and
   processes ([What breaks](#what-breaks-or-must-be-ported)).
10. **The first step is a spike of one fixture lane in a Cloudflare Sandbox and in a Vercel Sandbox, with a measurement beside it.**
    It needs the $5 Cloudflare plan, Vercel's Pro plan at $20 a month, which carries a $20 credit, and a few dollars of model
    credit. The measurement prices the idle compute ([The spike](#the-spike-and-the-measurement-beside-it)).

## The map

Each row sets a part of the flow against what Cloudflare offers for it. Every Cloudflare page below was read on
2026-10-08, as repository text of the documentation at commit 6e1b964, and for the claims that decide most also on the
published page [@articles/cloudflare-containers-sandboxes/source.md] [@articles/cloudflare-control-plane/source.md].

| Part of the flow | Today | What Cloudflare offers | Fit |
| --- | --- | --- | --- |
| Dispatch, rulings, tracker calls | Scripts the postmaster runs | Workers: 128 MB, up to 5 minutes of CPU a request, no limit on a request whose client stays connected; Queues (128 KB a message) for events | Fits (B1, B2, B20) |
| Postmaster and booking clerk | Interactive sessions that poll files, run scripts, call the tracker and merge | A Durable Object per project for state, an Agents SDK `Agent` (a Durable Object with state, schedules and WebSockets), and Workflows for supervision, with waits of up to 365 days, up to 25,000 steps and events from outside. The SDK's Pi harness (beta) runs the pi agent loop in a Durable Object and is not the pi program. The session itself needs a shell, so a container, reached by a browser terminal over WebSocket and tmux | The control plane fits (B5, B9, B10, A5.12). The session is a harness process and needs a container |
| Coachman leg | A headless harness session of hours that reads and writes the run folder, starts lanes, runs the gate | A container started from a Durable Object, kept alive by an alarm, its session store saved by a snapshot or a directory backup | Fits with work: lifetime, 12 GiB ceiling, resume (A1.15, A2.2, A2.4) |
| Workhorse lanes | A headless harness in a worktree | A container each, microVM isolated; the model key held by the Worker | Fits; shown by the Claude Code, Codex and Pi tutorials (A7.1 to A7.4) |
| Reviewers | A headless harness in a detached scratch worktree, or in a shared clone for the security review | A container each | Fits, as lanes do |
| The gate | The project's checks, a median 12 minutes, run in the coachman's worktree | Inside the coachman's container, or a fresh one to run in parallel; at most 4 vCPU and 20 GB; the image must carry the target's toolchain | Unknown speed. Not measured here |
| Scripts | TypeScript on Bun that read and write files and start processes | Run unchanged in a Linux amd64 container | A port: 69 scripts of the flow, 44 import the shared process helpers, 10 name marker, pid or lock files ([script table](../../raw/trials/2026-10-08-cloudflare-run-cost/results/script-primitives.md)) |
| Run records, action log, event streams | Files under the project's run folder, appended by several processes | R2 for blobs (strongly consistent, no append call listed, one write a second to a key); Durable Object SQLite for the ledger (10 GB an object); D1 for queries across runs; Queues for fan-in (128 KB a message). A bucket mount is not a local disk: "File locks, hard links, ownership, permissions, and atomic replacement do not work as they do on a local filesystem" | A port (B18 to B20, A2.5) |
| Session host and dashboard | Herdr or tmux panes, a read-only page over Tailscale | A browser terminal on tmux is a documented pattern; Workers with Access could serve a dashboard; nothing like Herdr. Herdr has plugins that run a pane in a provider's sandbox: Vercel Labs, Fly.io and E2B publish them, and none for Cloudflare was found [@articles/on-demand-containers-and-sandboxes/passages.md] (CNT94 to CNT98, CNT129) | A fourth host to write. The Vercel Labs plugin shows the shape, an interactive pane with the results returned as a patch; a launch's marker and output files would stay in the sandbox (argued) ([Other on-demand providers](#other-on-demand-providers)) |
| Model access | Each harness's own login or key | AI Gateway: stored keys (Beta), Cloudflare credits with a 5% fee, spend limits (Beta), logs, a scan for secrets | Covers API credentials (B12 to B17, B22) |
| Tracker and git | GitHub | Unchanged; a container reaches GitHub over HTTPS through a Worker handler that adds the token | Fits; SSH cannot be intercepted (A4.5, A6.4) |

Two things in the ticket's own text are corrected by the pages. A Worker does have a filesystem, held in memory. And the
ten idle minutes are the `Container` class's default `sleepAfter`, not a platform rule: the Durable Object Container API
has no default timeout, and its maximum is six hours. A rollout that sends SIGTERM and then SIGKILL after fifteen minutes
replaces instances only under the `default` scheduling policy; the `durable_object` policy, which the documentation lists
as best for sandboxes and agent environments and which Sandbox SDK 1.0 uses, takes no part in rollouts. The same
fifteen-minute drain also precedes a host move under either policy (A1.6, A1.18).

## Logins and terms

### What each harness needs to log in and run headless

The seven harnesses are in [the adapter file](../../skills/postmaster/harnesses.md). Four ran in the audited runs (codex,
mimo, claude, muse). The table says what each takes, whether it can be pointed at another base URL with a placeholder
credential (the Cloudflare pattern), and whether Cloudflare shows it.

| Harness | Headless routes | Another base URL, placeholder key | Cloudflare shows it | Pattern covers |
| --- | --- | --- | --- | --- |
| codex | `CODEX_API_KEY`; `codex login --device-auth`; a copied `auth.json`; access tokens on Business and Enterprise | A custom provider with `base_url` and `env_key`; only the Responses API | AI Gateway page and sandbox tutorial | API key: yes. A ChatGPT login: OpenAI documents a gateway for it on its Enterprise pages, Cloudflare does not show it |
| claude | `ANTHROPIC_API_KEY`; `CLAUDE_CODE_OAUTH_TOKEN`, a one-year token from `claude setup-token` | `ANTHROPIC_BASE_URL` and a custom header | AI Gateway page and sandbox tutorial | API key: yes. A subscription login: Anthropic's gateway page says a gateway can carry it if it forwards the `anthropic-beta` header. Cloudflare's current pages do not show it; its retired sandbox example did, with the token held in the Worker (A7.7) |
| muse | `META_API_KEY`; a stored key; a browser login | No documented setting. Meta's own SDK quickstart writes `endpoint_transport.base_url` into `settings.json` | No | An API key only through that undocumented setting |
| mimo | `XIAOMI_API_KEY`; `auth.json`; the whole file in `MIMOCODE_AUTH_CONTENT` | Documented: `baseURL` and `apiKey` with `{env:NAME}` | No (AI Gateway custom providers, Beta, could front it) | API key: yes |
| pi | The provider's own variable; `/login` | `models.json` `baseUrl`, and a built-in AI Gateway provider | AI Gateway page and sandbox tutorial | API key: yes |
| grok | `XAI_API_KEY`; `grok login --device-auth` | `[model.<id>]` with `base_url` and `env_key` | No | API key: technically |
| agy | A cached Google sign-in; `GEMINI_API_KEY` with `GOOGLE_GEMINI_BASE_URL` | `GOOGLE_GEMINI_BASE_URL`, for the key route | No | API key: technically |

Sources: [@articles/openai-codex-login-and-terms/passages.md] [@articles/anthropic-claude-code-login-and-terms/passages.md]
[@articles/meta-muse-code-login-and-terms/passages.md] [@articles/xiaomi-mimo-code-login-and-terms/passages.md]
[@articles/other-harnesses-login-and-terms/passages.md] and the Cloudflare pages above.

Two facts about a copied login. A ChatGPT login refreshes itself, and the refresh token is used once: Codex's own
message for the second copy to refresh is "Your access token could not be refreshed because your refresh token was
already used. Please log out and sign in again." [@articles/openai-codex-login-and-terms/passages.md] (H2-codex-2, from
the Codex source). So parallel containers cannot share one `auth.json`; each would need its own chain, or the Worker would
be the only holder. By the comments in pi's code (a third party's account of Meta's behaviour, not Meta's own words), a
login to Meta's Muse subscription gives an identity token that cannot be renewed and is exchanged for a key that lives about
a day and is minted again from the token; how long the token itself lasts is not stated anywhere read, and a person must
repeat the device login when it is rejected [@articles/other-harnesses-login-and-terms/passages.md] (H1 pi, about Meta).
Meta's contributor tier is also limited to 100 requests a minute and 3,000,000 tokens a minute for a whole team, which a
fleet of parallel lanes would share [@articles/meta-muse-code-login-and-terms/passages.md].

### What the vendors' terms say

The deciding sentences, with the document that holds each. "Not said" means the documents were read for it and are
silent; silence is not read as permission.

| Vendor | Documents allow | Documents bar or discourage | Not said |
| --- | --- | --- | --- |
| OpenAI (Codex) | Copying your own `auth.json` to your own headless machine. A ChatGPT-managed login on a trusted private CI runner, "an advanced workflow for enterprise and other trusted private automation". API keys, the documented default for automation | "Do not share the same file across concurrent jobs or multiple machines." "Do not use this workflow for public or open-source repositories." The consumer terms bar sharing credentials or making the account "available to anyone else"; the Services Agreement for Business and Enterprise bars sharing login credentials between users and gives each account one end user. "App-server authentication has never been permitted for commercial or hosted services." (about app-server sign-in, not `codex exec`) | Whether a Plus or Pro login may run in a vendor-neutral cloud container. Whether "Automatically or programmatically extract data or Output" reaches `codex exec` |
| Anthropic (Claude Code) | `claude setup-token` and `CLAUDE_CODE_OAUTH_TOKEN` "for CI pipelines and scripts"; the same token as a GitHub Actions secret on Pro, Max, Team and Enterprise. Not barred: an end user signing in to "the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code", under the conditions on the next column | Running Claude Code "in hosted sandboxes or other agent infrastructure" "requires agreeing to our Commercial Terms of Service", on conditions: the binary unmodified, and "Each end user must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential", with no paying for, reselling or intermediating usage on end users' behalf. Third-party developers may not "route requests through Free, Pro, or Max plan credentials on behalf of their users" and "may not collect, store, or intermediate Claude.ai credentials or session tokens". The consumer terms bar automated or non-human access "except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it". A usage policy page dated to take effect 2026-11-12 bars to "Resell, proxy, or otherwise provide access to Claude through unauthorized means, including services that route requests through consumer subscriptions or misrepresent the product or client being used"; "unauthorized" is not defined on the page | Whether one person's own agents in their own container count as offering Claude Code "in your products or services". Whether the user's own CI job on a rented machine is "automated or non-human means" or is access Anthropic has explicitly permitted. Whether a Worker that holds the user's own token is an "intermediary". Whether the November bullet reaches a person's own automation. A cap on concurrent sessions |
| Meta (Muse Code) | Pay-as-you-go keys in the applications its Terms let you build, and in the configurations its pages publish for OpenCode, Codex and Claude Code. `muse exec` in CI with `META_API_KEY`. `--yolo` "in a disposable, isolated container" | A subscription credential "is for use only with the coding harness under your Coding Harness Subscription". Keys may not be shared with a third party, including through "any model aggregator, API gateway, proxy, or similar offering". The binary may not be modified to run with a model not provided by Meta. Access is limited to the jurisdictions Meta has enabled | Whether baking the binary into an image is to "make available any Downloadable Materials to any third party". Whether your own egress proxy is a third party's. Whether a container's location counts as access from there |
| Xiaomi (MiMo Code) | MiMo Code is a listed tool; the same package works in several tools | "The quota of the Token Plan package is only available for use in programming tools ... and it is prohibited to use it in the form of API calls for request behaviors in obvious non-coding scenarios such as automated scripts and custom application backends." | Whether an unattended coding agent in a container is on either side. The user agreement could not be read |
| xAI (grok), Google (agy) | Headless is a feature of each; API keys | Google: "Using third party software, tools, or services to access the Service (e.g. using OpenClaw with Antigravity OAuth) is a breach of this Agreement" | xAI's terms returned 403; Google's say nothing on CI or cloud machines |

OpenAI's own policy pages answered 403 to the fetch tool. The consumer terms were read as Open Terms Archive copies, a
third party's capture of the vendor's pages, and the rest-of-world Terms of Use through a public text converter that
fetches the vendor's page; both are marked in the entries, which also note that the archive's EU copy says "extracting"
where the rest-of-world page says "extract" [@articles/openai-codex-login-and-terms/passages.md] (H4-codex-2b, H4-codex-2e).

What the Cloudflare pattern changes (argued, not tried). A Worker that holds one OAuth token and injects it would be the only
refresher, so OpenAI's single-use refresh problem would not arise. It would also make the Worker a store and intermediary of
subscription tokens, which is the thing Anthropic's page bars third-party developers from and OpenAI's app-server page calls
never permitted for hosted services. The vendors' own gateway pages do not describe that arrangement: OpenAI's has Codex
send its ChatGPT credentials to a gateway that can see them, and Anthropic's keeps the saved login on the client and asks
the gateway to forward the `anthropic-beta` header (H3-codex-3, H3-claude-3). Anthropic's compliance page also says that
running Claude Code in hosted sandboxes needs its Commercial Terms and that each end user authenticate with their own
credentials (H4-claude-2); whether one person's own sandbox counts as "offering" it is not defined. For a person's own
account the pages do not say. This is an ambiguity to take to the vendors in writing, and not one to settle by inference.

Two more facts that bear on a choice. Meta's `muse-spark-1.3-contributor` is the discounted tier "in exchange for
permission to use your prompts and completions to train future Meta models"; its terms bar submitting "sensitive,
confidential, or personal information" to it, including code a user must keep confidential, and a subscription gives no
discount for choosing it. And
Anthropic's own sanctioned cloud routes exist: cloud sessions on Pro, Max, Team and Enterprise with premium seats, and
self-hosted environments (public beta) on Team and Enterprise
[@articles/anthropic-claude-code-login-and-terms/passages.md] (H6-claude-3, H1-claude-8).

## Cost

### What Cloudflare would charge

The model bill is left out here; it is the same on any host and is at the end of this section. What Cloudflare itself
charges, at list rates read on 2026-10-08:

| Part | What it charges | What it comes to |
| --- | --- | --- |
| Plan | Workers Paid, $5 a month. It includes 25 GiB-hours of container memory, 375 vCPU-minutes and 200 GB-hours of disk, which is 2 to 3 container-hours (A10.1, B7) | $5 a month; list rates apply from the first run |
| Containers | Memory and disk as the instance type provisions them, for as long as the instance runs, idle or not, and CPU for active use only, in 10 ms steps (A10.1) | nearly all of the bill, below |
| Durable Object in front of a container | 128 MB for each active second, $12.50 per million GB-s with 400,000 GB-s a month included; each request or alarm is a billed request, $0.15 per million after the first million (A8.5) | $0.0056 an hour while active, about $0.13 for 24 hours |
| Workers and Workflows | Workers: 10 million requests a month then $0.30 per million, 30 million CPU ms then $0.02 per million. Workflows: 500,000 steps then $0.80 per 100,000 (B6, B7) | cents at this scale; request counts were not measured |
| R2, D1, Queues | Read for limits, not priced here (B18 to B20) | argued to be cents: a few JSON-lines segments a run |
| Egress | 1 TB a month included in North America and Europe (A10.1) | far below it (argued) |
| AI Gateway | Core features are free; a 5% fee applies only to credits bought through Cloudflare (B14, B17) | none with your own keys |

### Container time

Every launch in a container of its own, from the lane audit's times
[@trials/2026-10-08-cloudflare-run-cost/results/instance-time.md]. A launch is one lane, one reviewer or one coachman
leg.

| Role (18 real runs) | Launches | Total hours | Median run, hours | Median launch, minutes |
| --- | --- | --- | --- | --- |
| Workhorse lanes | 36 | 65.8 | 2.1 (both lanes) | 64 |
| Reviewers | 289 | 122.3 | 3.1 | 17 |
| Coachman, floor (last process of each thread, 14 runs with session exports) | | | 3.6 | |
| Coachman, ceiling over the same 14 runs (every stage a leg can run in) | 14 runs | | 18.8 | |
| Coachman, ceiling over all 18 runs | 18 runs | 476.5 | 23.8 | |
| Gate runs on lane branches, inside the coachman | 36 | 6.5 | 0.4 | 12 |
| Gate runs on the synthesis, inside the coachman | 260 | 43.5 | 2.1 | 12 |

The coachman is bracketed because the records do not hold its process time for every leg. The floor leaves out earlier
processes of a resumed thread, and the ceiling counts the user's wait for a spec review. The four runs without session
exports are the longest by stage seconds (39.6 to 68.2 hours), so the floor and its ceiling describe the shorter runs; the
table below uses both over the same 14 runs, and with the 18-run ceiling its largest cell would read $12, not $9.60. The
reviewer row covers the 289 reviewers that have a recorded time; the model bill below counts 308 reviewer launches, and
the 19 others have none, so reviewer hours read low. Lanes ran longer than an hour in
22 of 36 launches, longer than two hours in 5 and longer than six in 2, the longest 15 hours with restarts.

Cloudflare bills memory and disk for what the instance type provisions, for as long as it runs, and CPU for active use
only [@articles/cloudflare-containers-sandboxes/passages.md] (A10.1). One standard-4 hour is $0.113 with the CPU idle
and $0.401 with all four vCPUs busy; the audit has no CPU measurement, so the table brackets it. The Workers Paid plan,
$5 a month, includes 25 GiB-hours of memory, a little over two standard-4 hours.

| Scenario for the median real run | Container time, $ (CPU 0% busy) | (CPU 25% busy) | (CPU 100% busy) |
| --- | --- | --- | --- |
| Everything on standard-2 (1 vCPU, 6 GiB) | 0.50 to 1.37 | 0.65 to 1.80 | 1.12 to 3.09 |
| Everything on standard-3 (2 vCPU, 8 GiB) | 0.66 to 1.82 | 0.98 to 2.68 | 1.92 to 5.27 |
| Everything on standard-4 (4 vCPU, 12 GiB) | 0.98 to 2.71 | 1.61 to 4.43 | 3.49 to 9.60 |

Each cell runs from the coachman at its floor (3.6 hours) to the coachman at its ceiling (18.8 hours). That bracket is the
widest spread in the table: at standard-2 with the CPU idle it alone takes a cell from $0.50 to $1.37. Controls: the audit's published gate totals
come out of the new code unchanged (36 lane-branch runs and 6.5 hours, 260 synthesis runs and 43.5 hours); a lane's
2001 seconds are recomputed from its two timestamps; the same lane priced by hand ($0.0628314) matches; a run with
nothing in it reads zero everywhere. A second reader's arithmetic for one standard-4 hour agrees: $0.40104 busy and
$0.18504 at a quarter (A10.3). The Durable Object in front of a container adds $0.0056 an hour while it stays in
memory (A8.5). Egress is well under the 1 TB included: all input tokens of the 18 runs come to about 12 GB at four bytes a
token (argued).

The machine's own limits point the other way for sizing. The host capped a launch at 8 GiB, and a coachman was killed at that
cap and the cap raised to 16 GiB [@trials/2026-10-03-lane-audit/results/incidents.md]. The largest self-serve Cloudflare
instance has 12 GiB, so the standard-2 and standard-3 rows, at 6 and 8 GiB, may not fit a coachman or a gate.
Whether either fits was not measured.

### All 18 audited runs together

The 18 runs' records span 2026-09-28 to 2026-10-03. Together they hold 188 hours of lanes and reviewers and 48 to 477
hours of coachman: 48 is the floor over the 14 runs with session exports, and 477 is every stage hour of all 18. At list
rates, with no allowance taken off [@trials/2026-10-08-cloudflare-run-cost/results/cost.md]:

| Size | CPU busy | All 18 runs | Average run |
| --- | --- | --- | --- |
| standard-3 (2 vCPU, 8 GiB) | none | $18 to $51 | $2.81 |
| standard-3 | a quarter | $26 to $74 | $4.14 |
| standard-3 | all | $52 to $146 | $8.12 |
| standard-4 (4 vCPU, 12 GiB) | none | $27 to $75 | $4.17 |
| standard-4 | a quarter | $44 to $123 | $6.83 |
| standard-4 | all | $95 to $267 | $15 |

The low end leaves out the coachman of the four runs with no session export. The average run is the high end divided by
18. It is above the median run's cost because a few long runs dominate: the four longest by coachman stage time run 40 to
68 hours. CPU use was not measured. An agent that mostly waits on a model is likely nearer a quarter busy than all busy,
which is argued, not measured. The results file also has standard-2 (1 vCPU, 6 GiB), which may not fit a coachman. The
totals agree to a cent when summed from hours and when summed run by run, and read zero for no runs
([controls](../../raw/trials/2026-10-08-cloudflare-run-cost/results/controls.md), C21 to C23).

### Against a flat monthly price

A machine billed by the month costs the same however many runs it does. Cloudflare costs the $5 plan fee plus the average
run's cost for each run, which is $4.14 on standard-3 and $6.83 on standard-4 with a quarter of the CPU busy. The runs a
month at which the two cost the same, for example prices that a reader's own price replaces:

| Flat price a month | Runs a month, standard-3 | Runs a month, standard-4 |
| --- | --- | --- |
| $25 | 5 | 3 |
| $50 | 11 | 7 |
| $100 | 23 | 14 |
| $200 | 47 | 29 |

Below that many runs a month Cloudflare is cheaper, because idle time costs nothing; above it the flat machine is. The
table assumes the flat machine is big enough for the work, and this trial did not size that: the most launches running at
once was not measured. Cost is not the only difference. A flat machine runs the scripts as they are, has no 12 GiB ceiling
and needs none of the port work under [What breaks](#what-breaks-or-must-be-ported). Subscription logins sit on that one
machine, as they do today; the terms table's question about a cloud machine applies to it as it does to a container, but
the question of a Worker holding the token does not arise.

### Other on-demand providers

Is there somewhere cheaper than Cloudflare to buy this compute only while it is used? Providers in two groups were priced from
their own pages on 2026-10-08 and 2026-10-09 [@articles/on-demand-containers-and-sandboxes/passages.md]
[@articles/on-demand-virtual-machines/passages.md] [@trials/2026-10-08-cloudflare-run-cost/results/providers.md]. The first
group sells a container or a sandbox by the second. The second sells a virtual machine that stays up for a run's whole life.
Each rate is a list price, entered by hand with its page, its date and a mark for how well it was checked. "Two reads" means two
reads of the page agreed. Both came through a fetch tool that returns a summary of a page, so they count as one check. A rate
that could only be had from a search answer or from a third party is left out.

Two kinds of hour are priced, because a run does two kinds of work. A **gate hour** is 4 vCPU and 12 GiB with every vCPU busy.
A **waiting-agent hour** is 1 vCPU and 4 GiB with a fifth of the CPU busy, the rest spent waiting for a model. Neither profile
was measured; [#363](https://github.com/brindlewick/postmaster/issues/363) would. A typical run, built as in the cost tables above
from the median hours of each role, is 6.2 to 21.5 waiting-agent hours, with the coachman at its floor and at its ceiling, and 2.5
gate hours, which are carved out of the coachman's hours. Cloudflare's row sizes the agents to a custom 1 vCPU and 4 GiB and the
gate to a standard-4, so it differs from the cost tables above, which put every launch on one standard size. The container rows
include a disk where the provider charges for it by the hour, 20 GB for a gate and 10 GB for an agent, and leave out egress and
plan fees. A provider whose longest session is under 19 hours, about the coachman's median ceiling over a whole run, is left
out.

| Provider | Agent hour, $ | Gate hour, $ | One run, low to high, $ | Checked | Longest session |
| --- | --- | --- | --- | --- | --- |
| Northflank | 0.052 | 0.171 | 0.747 to 1.54 | two reads | none stated |
| Modal Functions | 0.056 | 0.190 | 0.818 to 1.66 | two reads | 24 h |
| AWS Fargate (Linux x86, US East) | 0.058 | 0.215 | 0.896 to 1.78 | two reads | none stated |
| Azure Container Instances (Linux, East US) | 0.058 | 0.215 | 0.897 to 1.79 | one read | none stated |
| Fly.io Machines, performance CPUs | 0.063 | 0.217 | 0.927 to 1.88 | two reads | none stated |
| Cloudflare Containers | 0.053 | 0.401 | 1.32 to 2.13 | two reads | none stated |
| Google Cloud Run jobs (instance-based) | 0.094 | 0.346 | 1.44 to 2.87 | two reads | 168 h |
| Fly.io Sprites | 0.095 | 0.416 | 1.63 to 3.08 | two reads | none stated |
| Modal Sandboxes | 0.167 | 0.572 | 2.46 to 5.00 | two reads | 24 h |
| Vercel Sandbox (Pro) | 0.110 | 0.766 | 2.59 to 4.27 | two reads | 24 h |
| E2B (Pro) | 0.115 | over the size limit | n/a | two reads | 24 h |
| Daytona | 0.116 | over the size limit | n/a | two reads | none stated |

Cloudflare's waiting-agent hour is within a cent of the cheapest. Its gate hour is not. It charges $0.072 for each busy vCPU-hour
and nothing for an idle one. The platforms with a cheaper gate hour charge every vCPU, busy or not: Northflank $0.017 an hour,
Modal Functions $0.024, Fargate and Azure Container Instances $0.040, Fly.io $0.046 with 2 GB of memory included (the table
splits it into $0.029 for the vCPU and $0.008 for each GiB of memory) and Cloud Run $0.065. A waiting agent leaves the CPU idle
four hours in five and a gate keeps it busy, so the order changes between the two. If the agents are busier than a fifth, the
agent hour rises with the CPU on Cloudflare, Vercel and Sprites, which charge CPU by use, and does not on the others; #363
measures it. Seven of the ten products that can hold the gate come to under $3 for a typical run, so what separates them is less
the price than what stands in the way of a launch:

| Provider | What stands in the way, or is not known |
| --- | --- |
| Northflank | No maximum job time is stated (a 2021 changelog says "Unlimited execution time"), so a job of a coachman's length is neither confirmed nor ruled out. No predefined plan has 4 vCPU and 12 GB, so the gate row applies the per-unit rates to a custom size. A command run from an agent with no terminal can have its output silently discarded unless it gets a pseudo-terminal (CNT78, CNT79, CNT84). |
| Modal | A Function can be preempted, more likely the longer it runs. A Sandbox is not, and costs about three times as much a second. Both stop at 24 hours. Whether a Function's CPU is billed on the request or the use was not read (CNT63, CNT65, CNT77). |
| AWS Fargate | The default quota is 6 vCPUs at once in a Region, and a new account may start lower. The shell's idle timeout is 20 minutes and cannot be changed. No maximum task time is stated on the pages read, and AWS retires platform revisions and stops standalone tasks after notice. The Spot rate could not be confirmed, only "up to 70%" off (CNT42, CNT33, CNT70). |
| Azure Container Instances | The rate comes from the retail price API alone, one read, because the pricing page showed no rates (CNT28, CNT23). |
| Fly.io Machines | The documentation page builds its price table in the browser and prints no performance-4x row. Fly's pricing page prints $0.1833 an hour for it, and a figure given elsewhere for that size was 2.72 times too high. Shared CPUs cost less, but a shared vCPU gets 5 ms in every 80 ms, with a burst balance that starts at 5 s and is capped at 500 s (CNT4, CNT7, CNT99 to CNT101). |
| Google Cloud Run jobs | A task may run 168 hours, but the container's file system is memory, so a clone and a build count against it. A job execution takes overridden arguments, and the Admin API's Task resource has an exit-code field; a command override is not documented. The pricing page could not be read (CNT16, CNT75, CNT133, CNT73). |
| Fly.io Sprites | CPU time and memory are billed as used; the row counts the full shape, an upper bound. A Sprite has 8 vCPUs and memory the platform manages; a staff post says 8 GB by default and 16 GB on request, so whether a 12 GiB gate fits is not known, and the row counts it as fitting. One page puts the idle window at about 30 seconds and lists output to an attached session, an open connection and a task as activity. No page says whether a call out to a model counts, so whether an agent that only waits on a model stays awake is open (argued from the lifecycle pages), and a task or a service is the documented way to keep it awake. Two Fly pages disagree on plans (CNT109 to CNT111, CNT114, CNT122, CNT128). |
| Vercel Sandbox | Memory is 2 GB for each vCPU, so the gate takes 6 vCPU, which Pro allows (8 vCPU and 16 GB at most). Only active CPU is billed, not time spent waiting for a model. Pro is $20 a month with a $20 credit. Vercel's page says sandboxes are not designed to run continuously. Rates were read for one region (CNT51, CNT88 to CNT93). |
| E2B | A sandbox is 1 to 8 vCPU and 1 to 8 GiB, so the gate needs a request to E2B. Hobby ends a session at one hour; Pro ends it at 24 and costs $150 a month (CNT104, CNT120). |
| Daytona | An organisation's sandbox is at most 4 vCPU, 8 GB and 10 GB of disk; nothing read says the limit can be raised (CNT106). |
| Koyeb | Eco is $0.0576 an hour for 4 vCPU and 8 GB. Koyeb's December 2023 launch post says Eco is for development and non-production, and no page says whether the vCPU is shared. Koyeb announced on 2026-02-17 that it is joining Mistral AI; its pricing page now shows Pro and above, and the February post says Starter "will soon be removed" (CNT22, CNT52, CNT67, CNT68, CNT80). |
| Railway, Render | Not priced. Railway says it charges "for the resources you actually use" and does not say whether memory is counted as used or as reserved. Render's pricing pages could not be read; its Workflows documents list fixed plans at $1.00 an hour for 4 vCPU and 8 GB (CNT20, CNT31, CNT21, CNT37). |

The flow's launches need to start a command, stream its output and read its exit code. Vercel Sandbox, Modal Sandboxes, Daytona,
AWS Fargate (a command override, logs in CloudWatch and the exit code in the task description), Northflank (through its
JavaScript client), Koyeb Sandboxes and Cloudflare (`exec()`, from the Worker that owns the container) document all three. So do
Fly.io's Sprites, whose WebSocket exec endpoint sends output frames and an exit code, and E2B, though its exit-code field was not
shown. Fly.io's Machines API returns the output and the exit code in one response and does not say whether it streams. Cloud Run
jobs take overridden arguments, stream logs and report an exit code on the Task resource (CNT72, CNT75, CNT79, CNT81, CNT131,
CNT133, CNT134).

**Virtual machines.** A virtual machine kept up for a run's whole life costs its hourly price for all of it, busy or not. The
median run's life is 27.7 hours and the mean 33.3, from the first to the last timestamp in its record, waits included. The shape
is 4 vCPU and 8 GiB, the common small plan, and it was not chosen for the work: it holds neither the 12 GiB gate nor the 16 GiB
the host's memory cap was raised to for a coachman, so a machine that holds a whole run would be bigger. On Hetzner's list the
next size up, 8 vCPU and 16 GB, costs EUR 0.1114 an hour against EUR 0.0569, about twice (VMS1). Euro prices are converted at 1.18
dollars to the euro, the rate Hetzner's own two price columns imply, except Hetzner's, which are in its dollar column. The
"All 18 runs" column adds up each run's cost, rounding each up to a whole hour where the provider bills by the hour.

| Machine | $ an hour | Median run | All 18 runs | $ a month, kept up | Median runs a month that cost that | Stopped machine billed | Checked |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Azure Spot, F4s v2 (East US) | 0.037 | 1.04 | 22.6 | not entered | n/a | no | two reads |
| Scaleway DEV1-L (Paris) | 0.051 | 1.42 | 30.8 | not entered | n/a | no | one read |
| Oracle Arm A1, pay-as-you-go (4 OCPU, 8 GB) | 0.052 | 1.44 | 31.2 | not entered | n/a | no | two reads |
| Vultr vc2-4c-8gb | 0.055 | 1.54 | 33.5 | 40.0 | 26 | yes | two reads |
| Koyeb Eco, eco-xlarge (4 vCPU, 8 GB) | 0.058 | 1.60 | 34.6 | 42.9 | 27 | no | two reads |
| Hetzner CPX32 (Germany, Finland) | 0.067 | 1.88 | 41.0 | 42.0 | 22 | yes | two reads |
| DigitalOcean Basic, 4 vCPU and 8 GiB | 0.071 | 1.98 | 42.9 | 48.0 | 24 | yes | two reads |
| Linode 8 GB | 0.072 | 2.02 | 43.8 | 48.0 | 24 | yes | one read |
| AWS On-Demand, c6g.xlarge (US East) | 0.136 | 3.77 | 81.6 | not entered | n/a | no | one read |
| Hetzner CCX23 (4 dedicated vCPU, 16 GB) | 0.163 | 4.55 | 99.0 | 101.5 | 22 | yes | two reads |

AWS Spot is not in the table. The one figure read, $0.0513 an hour for a c7i.xlarge, came from an undated file whose region is
argued, and AWS's Spot Advisor file gives 61% savings for that type where the figure implies 71%, which would make it about
$0.070 an hour (VMS26, VMS45). A Spot price moves with the day and the Region.

- Hetzner, Vultr and Linode bill by the whole hour. DigitalOcean bills by the second after a 60-second minimum, since 2026-01-01.
  All four go on billing a powered-off machine until it is deleted, so a machine made for a run has to be deleted when the run
  ends (VMS5, VMS16, VMS20, VMS23).
- Spot machines are reclaimed, with two minutes' notice on AWS and 30 seconds' on Azure, both best effort, and Azure gives no
  SLA. Whether a coachman could resume after that was not examined (VMS27, VMS34). The Azure Spot row does not say how it bills a
  part hour, so it is rounded up.
- Hetzner raised the price of its CPX32 plan by 154% in euro on 2026-06-15, for new orders and rescales, and lists its cheapest
  plans as not available (VMS2, VMS4, VMS40). Mirrors of its status notice say it is restricting the creation of new cloud
  servers for new customers; the official status page shows only the notice's title and start (VMS7).
- A new AWS account's default quota is 5 vCPUs a Region, for on-demand and for Spot: one 4-vCPU machine until usage or a request
  raises it (VMS36).

The table's last two columns answer the other half of the question, whether a machine made for each run beats a rented month. A
machine of this size kept up all month costs $40 on Vultr, $42 on Hetzner, $48 on DigitalOcean and Linode. That is the price of
22 to 26 median runs on the same machine. Below that many runs a month, a machine made for each run is cheaper. Above it the
rented month could be, but 26 runs of 27.7 hours fill a 720-hour month, so a single machine of this size can do about that many
one after another and no more; a rented month wins only when runs share a machine at the same time, which needs a bigger machine
than this one. Vultr bills up to 672 hours a month, and 672 hours at $0.055 is $36.96, which would make its break-even 24 runs
(VMS43, argued). The 18 audited runs fall between 2026-09-28 and 2026-10-03, a faster pace than that, though one burst is not a
month, and at their peak 12 lanes, reviewers and gate runs ran at once.

**The Herdr plugin.** Vercel Labs publishes a Herdr plugin that gives each pane its own Vercel Sandbox (CNT94 to CNT98, CNT125,
CNT132). Starting a pane creates a persistent sandbox, uploads a filtered copy of the worktree, installs the agent and attaches
the pane with `vercel sandbox exec --interactive`; the changes come back as a Git patch that the user applies locally. It needs
the Vercel CLI logged in and linked to a team and project, and a Pro plan for sessions over 45 minutes. It is not Herdr's. The
repository was created on 2026-08-01 and has no licence file, and Herdr says it does not review or sandbox plugin code. Its
README says agent authentication happens inside the sandbox and that the plugin does not copy coding-agent credentials from the
host. Fly.io's and E2B's own organisations publish Herdr plugins as well, and none for Cloudflare was found (CNT129). Fly.io's
README says that for a standard `claude` or `codex` command, setup transfers the local login into the Sprite once, before the
first launch, so a provider's own plugin already puts a subscription login into its sandbox. E2B's README describes a run action
that reports outcomes such as `agent-failed` for a non-zero exit, and a fleet mode that races several agents. So Herdr already
has a way to run a pane in a sandbox, and the plugins differ on logins. The Vercel plugin is a precedent for a host adapter, not
a shortcut for the flow's headless launches. Its pane is a terminal for a person. A program driving it through Herdr is shown
prompting, waiting until idle and reading the screen, and no exit code is named, although the plugin's bridge passes the remote
exit status to the pane's process, and whether Herdr exposes it to a driver is not shown. The files a launch writes would stay in
the sandbox, which returns only a patch (argued from the plugin's design, not tried).

**Controls.** Cloudflare's row recomputes the cost module's standard-4 hour to a millionth of a dollar, and its waiting-agent
hour matches arithmetic by hand. The waiting-agent and gate hours of the 18 runs add up to the same hours as every launch.
Fly.io's performance-4x price, built from the per-vCPU and per-GiB rates in the table, equals the $0.1833 an hour that Fly's
pricing page prints and the per-second figure from its documentation's constants times 3600, and an unchecked figure for it fails
that comparison by a factor of 2.72. Daytona's size limit rejects the 12 GiB gate and accepts the waiting agent. Every row of
the two tables names its page, the day it was read and how it was checked. The break-even for Vultr equals $40 over a 28-hour
run at $0.055, and a machine with no monthly price has none. The longest coachman stage and the count of stages over 24 hours
agree between the rebuilt intervals and the audit's own stage seconds, a stage of exactly 24 hours is not counted, and the most
launches at once inside one run is no more than the most across all runs
([controls](../../raw/trials/2026-10-08-cloudflare-run-cost/results/controls.md), C27 to C37).

**Limits.** The two profiles are assumptions. The run hours are the audit's, and they include the coachman's waits. If the
coachman keeps its own container while a gate runs in another, add about 2.5 waiting-agent hours, about $0.13 a run on Cloudflare
or Northflank. List prices leave out tax, egress and plan fees, and the machine rows leave out disks and addresses; prices
change. The virtual machine rows are one shape for a whole run, not a design. Nothing was ordered or run, and no account was
opened.

### The model bill, a side note

The same tokens cost the same on any host, so this does not bear on a comparison of Cloudflare with a flat-priced machine.
It is here because it is the larger figure. From the audit's token counts, split by kind from each launch's own stream, at each vendor's published price
[@trials/2026-10-08-cloudflare-run-cost/results/model-bill.md] [@articles/model-api-prices/passages.md]. About 95% of input
is cache reads, so the price of a cache read matters more than the plain input price.

| Role and model (18 real runs) | Launches | Dollars as measured | If no cache hit |
| --- | --- | --- | --- |
| Opus security review (`claude-opus-5-5`, the harness's own figure at list price) | 71 | 644 | 2,909 |
| Coachman (`muse-spark-1.3-contributor`, one row per run) | 14 runs | 11.75 | 149 |
| Codex lanes and reviewers (`gpt-6-luna`, `-sol`, `-astra`) | 137 | 28.3 | 186 |
| MiMo lanes and reviewers (`mimo-v2.6-pro`, pay-as-you-go price) | 136 | 19.6 | 321 |
| **All** | | **704** | |

Per run: mean $39.10, median $16.13, most $301. The Opus security review is 92% of the dollars: $35.79 a run on average,
$14.56 at the median. Everything else is $3.31 a run on average, $2.12 at the median. So the line that API credentials
would make costly is the Opus security review. The lanes cost little at API prices because their input is almost all cache
reads, at 1% to 10% of the plain input price. Whether the security review runs on a flat plan today is not in the records.

The coachman's price is the other lever. The table puts it on Meta's contributor tier ($0.10 / $0.002 / $0.20 per million
tokens: input, cached input, output), which lets Meta train on what is sent. On the standard tier ($1.25 / $0.15 / $4.25)
the coachman's tokens cost $331, not $11.75; the mean run is then $56.83 and the median $34.63, the Opus security
review is 63% of the dollars, and everything else is $19.05 a run at the median, not $2.12
[@trials/2026-10-08-cloudflare-run-cost/results/model-bill.md].

Controls: the token totals by role reproduce the audit's published ones (coachman 1478M in and 5253k out; codex
reviewers 119 launches and 240M in; codex workhorses 18 launches and 438M in; Opus 71 launches and $644.17). MiMo's output is
larger than the audit's because reasoning tokens, which MiMo reports apart, are counted as output; how Xiaomi bills
them is not stated, so that is an assumption. Claude Code's
reported dollars are list price: recomputed from each launch's own per-model tokens at the Opus 5.5 prices they fall inside
the bracket from all cache writes at five minutes to all at one hour for 61 of 61 launches that used only that model, and for
0 launches at Opus 4.1's prices. The audit's own token counts leave out cache reads for Claude Code and MiMo Code, so they
could not be priced as they stood. The standard-tier figure agrees to a cent whether it is summed launch by launch or
recomputed from the summed tokens, and re-pricing a model no launch used moves nothing
([controls](../../raw/trials/2026-10-08-cloudflare-run-cost/results/controls.md), C19 and C20).

Limits. The audited runs were not billed at these prices, so this is the price of the alternative and not a bill anyone
paid. The contributor model gives no discount under a subscription. Four of the 18 runs have no coachman session export. A
fixture lane's tokens were not measured; the audit's medians are 0.8M in and 20k out per workhorse.

## Isolation

The [lane isolation scan](../../raw/trials/2026-10-05-lane-isolation-scan/results.md)
(pull request 285, merged) read 60 workhorse-lane streams in 30 runs; the coachman, the reviewers and the postmaster
were not read. Nothing there is retested. This table sets what it found against what a container per lane is documented
to isolate. Whether each reach would really be stopped is argued from the documented design, not tried.

| Reach the scan found | Streams | A container per lane, with a clone of the base only | What stays open |
| --- | --- | --- | --- |
| A lane read the other lane's plan commit through `git log --all` | 1 | Stopped: no object store is shared | If lanes push to one remote, a lane that can fetch it can read the others' branches |
| The run's shared worktree reached, with the blind tests inside | 2 | Stopped: the container holds no shared worktree | The tests are safe only if they are on no ref the container can fetch, and are run by the coachman in another container |
| Other branches and worktrees listed or searched | 8 | Stopped for any branch not in the clone | A clone of the whole remote shows every remote branch |
| The machine config, the run's records, the agent's private memory read | 6 | Stopped: none is on the container's disk unless copied in | What is copied in, the ticket, the brief, the harness's own login, is readable |
| The other lane's launch command seen in a process list (not a reach) | 6 | Stopped: the instance is a microVM with its own process space | |
| A review lane is said to have signalled every process of the session on 2026-10-01 (an incident; the cause is the ticket's account, unverified, and the audit's, not the scan's) | | Stopped: a signal reaches only the instance | |

What no container changes. Inside a deployed container "every process has the same Linux capabilities as `root`", so the
container is the smallest unit of trust, and one container per lane, not one per tool call [@articles/cloudflare-containers-sandboxes/passages.md]
(A5.6, A6.2). Anything put in a sandbox, a key or a file, "all the code there can read ... and send it anywhere the
sandbox can reach" (A6.3). The pages disagree on the network default: the Sandbox 1.0 pages say a container has no
Internet unless `start()` passes `enableInternet: true`, and the `Container` class page says the option defaults to `true`,
so a design passes it explicitly. Either way a handler can intercept HTTP and HTTPS, not SSH or other ports (A4.1, A4.5,
A4.12). A clone can be limited to one repository by
a Worker gateway that allows `git-upload-pack` for it alone, so a push from the sandbox fails with 403 (A6.4); that
limits the repository, and a limit by branch is not shown (A6.6). Handing work back is the part the lane cannot be trusted
with: the documented way is a `git diff` read with `exec` (A6.5); a bundle or a patch could be made and read the same way, and
a container can reach an R2 bucket through a virtual host the Worker resolves (A4.8), though no page does either for a lane.
Whatever the lane writes there is its own word.

A local route to most of this exists without Cloudflare. [#203, Cut each lane as a shared clone of the repository, so it cannot
read another lane's commits](https://github.com/brindlewick/postmaster/issues/203) and [#221, Run every lane with only the
files, hosts and sockets it needs, on Linux and macOS](https://github.com/brindlewick/postmaster/issues/221) are filed and
open, and [#342, Every reviewer works in its own copy of the repository](https://github.com/brindlewick/postmaster/issues/342)
has landed (closed 2026-10-09). [The confinement page](lane-confinement.md) records that a sandbox around the harness stopped every reach in its trial. A
virtual machine per lane on any provider gives the same isolation properties; nothing in this section is special to Cloudflare.

## What limits concurrency, and what a cloud would lift

Four limits were asked about: the machine's cores, the model providers' usage windows, the user's rulings and cost. The
records name two more, GitHub's request budget and merge conflicts between runs. Each is set against what a container
for every launch would change.

| Limit | What the records show | Does a cloud lift it? |
| --- | --- | --- |
| The machine's CPU and memory | [#362](https://github.com/brindlewick/postmaster/issues/362) says that with ten runs in flight the load is 30 to 40 on 18 cores. Over the 18 audited runs the launches running at once were few: 2.0 on average and 12 at most (lanes, reviewers and gate runs), with 5 or more for 13% of the time and 10 or more for 2%. At most 7 gate runs ran at once, and a gate is the CPU-heavy launch [@trials/2026-10-08-cloudflare-run-cost/results/concurrency.md]. The shared machine also cost launches: its 8G memory cap killed a reviewer, and later a coachman and a lane (I3, I10), and one launch's script signalled every process of the session, which stopped every agent in eight runs (I1, by the cause ticket #200 gives) [@trials/2026-10-03-lane-audit/results/incidents.md]. | Yes. Each launch has its own CPU and memory, up to 4 vCPU and 12 GiB self-serve, and a signal reaches only its instance. The 12 GiB ceiling is below the 16 GiB the cap was raised to for a coachman. |
| The model providers' usage windows | Two codex usage limits on 2026-10-03 left a lane with no implementation or no summary (I6, I7); an overload response from the Opus provider meant a review did nothing (I8); a codex login was revoked (I14). [#237, A lane that hits a provider limit pauses its run and tells the user at once](https://github.com/brindlewick/postmaster/issues/237) was filed for it. | No. A container runs the same harness on the same account. With an API key instead of a login the window becomes a spend limit and the bill in the model-bill note. |
| The user's rulings | A run waits for the user at spec review. The audit's median planning stage, which includes that wait, is 3 h 51 m, against 1 h 35 m for the lanes running [@trials/2026-10-03-lane-audit/results/time.md]. The cap on runs for a project (`team.max_runs`) and each merge are the user's decisions. | No. More compute lets more runs be in flight while specs wait; it does not shorten the wait. |
| Cost | The machine is paid for all month, idle or not (#362). A container is paid for while it runs. [#363, A run records what each launch used, so the run can be priced on demand](https://github.com/brindlewick/postmaster/issues/363) measures what each launch used. | It swaps a fixed cost for a per-use one; the break-even is in the cost section. |
| GitHub's request budget | One ticket creation cost 415 of the 5,000 points GitHub allows each hour to all tools and agents together, and the hour's budget ran out once ([#284, The GitHub adapter reads one ticket without reading the whole project board](https://github.com/brindlewick/postmaster/issues/284)). | No. The budget belongs to the account. |
| Runs that change the same files | The second of two such runs to merge resolves the conflicts at its merge (the repository's check of the parallel-runs rules). | No. |

A cloud account has a ceiling of its own, and on some providers the first one is low. Cloudflare's published limit is 1,500
vCPU at once, which is 375 standard-4 instances, and under the `default` scheduling policy an application's `max_instances`
defaults to 20; the `durable_object` policy has none [@articles/cloudflare-containers-sandboxes/passages.md] (A3.2, A3.7, A3.9).
AWS Fargate's default quota is 6 vCPUs running at once in a Region, and a new account may start lower. A new AWS account's
quotas for EC2 are 5 vCPUs on demand and 5 for Spot, so one gate at 4 vCPU nearly fills them until usage or a request raises them
[@articles/on-demand-containers-and-sandboxes/passages.md] [@articles/on-demand-virtual-machines/passages.md] (CNT42, VMS36).

With the cores out of the way, the next limits are the usage windows and the spec-review queue. A cloud lets more runs be
in flight; it does not make each finish sooner. The launch counts are the audited runs alone: fixture runs, other
projects and the user's own sessions shared the machine and are not in them. The results table also has a row that adds the
coachman's stages, at most 24 at once and 6.1 on average, which counts the user's waits as running and so is an upper bound.
Inside any one audited run, at most 5 lanes, reviewers and gate runs ran at once, and 6 with the coachman. The longest single
coachman stage is 63.4 hours, waits included, and 7 stages ran longer than 24 hours, so a session cap of 24 hours needs the
coachman to resume.

## Other places to run a ticket

A ticket could name a place other than this machine or a Cloudflare container, and the flow's host layer already keeps where a
launch runs apart from what a launch is ([the host adapter file](../../skills/postmaster/hosts.md)). What was read about the
others, on 2026-10-09 [@articles/ci-runners-free-tiers-and-phones/passages.md]:

- **Machines reachable over SSH, such as the ones on a tailnet.** This is the subject of [#136, Design: run tickets on any
  machine on the tailnet, so adding a machine adds capacity](https://github.com/brindlewick/postmaster/issues/136), and this
  research did not widen it. Tailscale's free plan allows up to 6 users and unlimited devices and lists Basic Tailscale SSH for
  up to 5 hosts. Auth keys expire after 1 to 90 days and node keys after 180 days unless expiry is disabled (CIP25, CIP26, CIP29).
- **A self-hosted GitHub runner on a machine the user owns or rents.** GitHub does not charge for the runner, a job may run 5
  days, the docs list only outbound HTTPS (443) as a requirement, so no inbound port is needed (argued), and a
  `workflow_dispatch` call can start a job on it. GitHub announced a charge of $0.002 a minute for self-hosted runners and
  postponed it, with no new date given (CIP5, CIP7, CIP8).
- **GitHub-hosted runners and Codespaces.** A hosted runner for a private repository costs $0.36 an hour for 2 vCPU, 8 GB and 14
  GB of disk, below the 20 GB the workload needs. The 4 vCPU, 16 GB runner at $0.72 is a larger runner, open only to
  organisations on the Team or Enterprise Cloud plan, and included minutes do not cover it. A job on a hosted runner stops after 6
  hours, and the coachman runs 4 to 19 hours, so it cannot hold one. Codespaces cost $0.09 a core-hour, $0.18 for 2 cores and
  $0.36 for 4, and stop a session after 12 hours. GitHub's terms for Actions and Codespaces bear on running coding agents there
  ("develop and test your application(s)"), and whether they allow it was not asked of GitHub (CIP1, CIP2, CIP3, CIP5, CIP10,
  CIP11, CIP13, CIP14, CIP48).
- **Oracle's Arm machines.** Pay-as-you-go is $0.01 per OCPU-hour and $0.0015 per GB-hour, $0.052 an hour for 4 vCPU and 8 GB,
  the Oracle row of the machine table above. The Always Free Arm allowance is now 2 OCPUs and 12 GB by Oracle's documentation,
  while its price data still shows the old 4 OCPUs and 24 GB, and no Oracle statement settles which governs. Idle Always Free
  instances may be reclaimed. Oracle's FAQ is reported, in two search-tool summaries because the page itself answered 403, to say
  that an account idle for 30 days or more may be treated as abandoned (CIP16, CIP18, CIP21, CIP23, CIP44).
- **Owned hardware.** A Mac mini with an M6 chip and 16 GB starts at $899, and a Raspberry Pi 5 with 8 GB is $175 by the sum of
  the maker's three price posts. At 18.31 cents a kilowatt-hour a Mac mini at its 70 W maximum costs about 1.3 cents an hour to
  run, the reader's arithmetic from Apple's power figure (CIP39 to CIP43).
- **A phone.** Claude Code's setup page lists no Android or iOS. Users report it broken on Termux since v2.1.113, a community
  build reported working on one Android 11 phone, and Codex's login failing on native Termux. An Anthropic collaborator replied
  that Android "may" be added. Bun has no official Android build. Android 12 and later kills phantom (child) processes beyond 32,
  across all apps together, and an unplugged phone in Doze loses network access outside short windows (CIP31 to CIP38, CIP47). A
  phone is a place to read and answer sessions from, not to run a gate.

The hosted runners and Codespaces cost more an hour than the hourly virtual machines in the table above and stop before a long
coachman does. Oracle's Always Free allowance and hardware the user already owns cost less an hour, and a self-hosted runner adds
no GitHub charge to either; each needs the user to set a machine up. Nothing was ordered, opened or run for any of these.

## What breaks or must be ported

- **Instance lifetime.** "Code that runs inside the instance does not count as activity." A lane in a container is not
  alive to the platform unless a request, an alarm or a held-open call keeps its Durable Object active. The inactivity
  timeout is at most 6 hours. The documented fix is an alarm every minute that checks the work (A1.15, A7.1). When no client
  stays connected, each pending call keeps a Durable Object in memory for at most 15 minutes, so a held-open call alone is
  not enough; while a connected client's request is open the object stays active, which is argued, not stated, for `exec()`
  (A1.13, A1.25). Cloudflare "does not guarantee that any container instance will run for a set period", and a stop for a
  host move gives `SIGTERM`, up to 15 minutes, then `SIGKILL` (A1.5, A1.6); after an inactivity timeout every process in the
  instance gets `SIGTERM` and the instance stops "shortly after", whether or not the processes exit (A1.26). A lane must be
  resumable, and the flow's lanes already commit and resume.
- **The runtime does not tell the control plane when a container stops**, and the handle `exec()` returns dies with the
  request that made it. The pattern is `setsid`, a pid file, an exit-code file and polling (A1.22, A5.3, A5.4). The
  exception is `monitor()`, which reports the main process's exit while the Durable Object is in memory (A1.10).
- **Deploys.** The sequence of SIGTERM, up to 15 minutes, then SIGKILL is for `default`-policy rollouts, and for host
  moves under either policy. Under the `durable_object` policy, which the documentation lists as best for sandboxes and
  agent environments, "A running instance keeps running" through a deploy; the restarted Durable Object
  loses its timeout and must set it again (A1.17). That policy and snapshots are in public beta, Sandbox SDK 1.0 runs only
  on them (the SDK itself is "available"), and the policy has no `max_instances` and no placement constraints (A9.1,
  A3.7). In AI Gateway, stored keys and spend limits are badged Beta, and Unified Billing sits in a Beta-badged sidebar
  group (B13, B22). Containers and Sandboxes were announced generally
  available on 2026-04-13. Users report a rollout shown complete while the old image served, capacity errors on start,
  and a Worker deleted with its container application still billing (A-TP.2, A-TP.3, A-TP.6, in
  [@articles/cloudflare-containers-issue-reports/passages.md]).
- **The disk is ephemeral**, 20 GB at most. A stop, a sleep or a host move loses it. A snapshot (beta) keeps the root
  filesystem, not processes, 20 GB at most for 30 days; a directory backup to R2 is documented. The harnesses' session
  stores must survive for a resume, and for Muse Code and MiMo Code the flow checks that a thread is in the launch's own
  data directory before it resumes (A2.1 to A2.4; [the adapter file](../../skills/postmaster/harnesses.md)).
- **The gate.** A median 12 minutes and at most 21 in the audit's 296 runs, on the shared machine. A container has its own CPU, up to 4
  vCPU and 12 GiB. The speed there was not measured. The target's toolchain must be in an image, and the image counts
  against 50 GB of image storage.
- **The scripts.** Of the 69 scripts of the flow, 44 import the shared process helpers, 18 read the home directory or
  `~/.postmaster`, 13 start processes directly, 10 name marker, pid or lock files, 6 run `git worktree`, 6 signal
  processes, 5 read `/proc`, 2 make symbolic links, 2 use `bwrap` or `sandbox-exec` (one to wrap a harness, one to probe
  for them), 1 uses systemd scopes and 1 drives Herdr or tmux. The seven scripts that test the flow itself are not counted.
  They assume the roles share one filesystem and one process table. In containers each role has a private disk, so the
  run folder needs a store the roles reach over the network ([the script table](../../raw/trials/2026-10-08-cloudflare-run-cost/results/script-primitives.md),
  which names the files behind each count).
- **Event streams and the action log.** Several processes append to a JSON-lines file. No append call is listed for R2,
  which takes one write a second to a key, and a bucket mount renames by copying and has no locks (B18, A2.5). Segments in
  R2 or rows in Durable Object SQLite fit; a shared file does not.
- **The host.** Herdr and tmux have no counterpart. A browser terminal over WebSocket on a tmux session is documented.
  [#332, Sessions the flow opens for the user run the harness as the pane's own process, so the chat app lists
  them](https://github.com/brindlewick/postmaster/issues/332) shows the user's chat app lists a session by the process that
  leads its pane; a terminal in a container would have to meet the same rule (unverified).
- **Bubblewrap and systemd inside the instance.** Whether user namespaces, `bwrap` or cgroups work inside a container is
  undocumented (A3.5). The flow's `confine` setting would not be needed there. Muse Code's own sandbox needs bubblewrap
  unless `--yolo` is passed, and the flow passes it.
- **Self-updating harnesses and first downloads.** Muse Code downloads its binary from its vendor's hosts at first use and
  updates itself unless told not to; an image would pin versions. Muse's terms do not say whether putting the binary in an
  image is making it available to a third party.
- **Concurrency and accounts.** An account may run 1,500 vCPU at once, which is 375 standard-4 instances or 750 standard-3
  (argued from A3.2), against a peak of 5 lanes, reviewers and gate runs at once inside one audited run, 6 with its coachman
  [@trials/2026-10-08-cloudflare-run-cost/results/concurrency.md]. The cap on runs is the user's, not the platform's.

## The spike, and the measurement beside it

[#362](https://github.com/brindlewick/postmaster/issues/362) is the spike, on two providers, and
[#363](https://github.com/brindlewick/postmaster/issues/363) the measurement. This research runs neither.

**The spike.** One lane of one fixture run in a Cloudflare Sandbox and the same lane in a Vercel Sandbox, with everything else
local: a clone at the base commit and the lane's prompt go in, the harness runs headless, its events and its done marker come
back, and its commits arrive in the local repository as `wb/<run>-<lane>`. The coachman, the reviewers, the gate and any control
plane are out of scope, and the remote host sits behind an adapter that does not tie the runbooks to either provider. What it
would show:

1. A harness runs headless in a sandbox from an image to the end of a fixture lane (a median 7 minutes in the audit).
2. The model key never enters the sandbox. On Cloudflare the lane sends a placeholder and the Worker adds the key. On Vercel the
   firewall can add the key as a header to requests for listed domains. On both the sandbox reaches only the model host and
   github.com.
3. The lane's commits come back and the run scores the same on the fixture's hidden tests as a local run did: every one of the
   44 fixture lane branches that could be scored passed all of them
   [@trials/2026-10-03-lane-audit/results/workhorses-fixture.md].
4. For each provider, the cold start, the lane's time, the cost lines on its usage page, whether a resume works after the
   sandbox stopped (the session files are the risk), and what broke.

What the pages already say about Vercel Sandbox, which the spike would check [@articles/on-demand-containers-and-sandboxes/passages.md]:

- A sandbox is a Firecracker microVM with root access. Persistent sandboxes are the default: stopping one snapshots its file
  system, not its processes, and a later call starts a new session from the snapshot with a fresh session timeout, 24 hours on
  Pro. While stopped, only snapshot storage is charged. Vercel's page also says sandboxes are not designed to run continuously
  (CNT51, CNT24, CNT93).
- A program can start a command, stream its logs and read its exit code (CNT131).
- The firewall has three policies, `allow-all` by default, `deny-all` and a list of allowed domains. A rule can add or replace
  headers for a domain, so the secret sits outside the sandbox. It depends on the server name in the TLS handshake, a request to
  a literal IP address in an allowed range bypasses it, and a connection with no detectable domain, such as SSH, passes
  unmodified under a catch-all rule. The page does not say whether it can carry a subscription login, which the spike would try
  (CNT135).
- Vercel's own Herdr plugin keeps agent authentication inside the sandbox, and Fly.io's plugin copies the local login into its
  sandbox (CNT96, CNT129). The ticket notes that a login made inside a sandbox sits on its file system, where a lane in bypass mode
  can read it (argued).
- The priced hours are $0.110 for a waiting agent and $0.766 for a gate, on Pro in region iad1. At the audit's fixture median of
  7 minutes a lane costs about a cent of sandbox time (CNT88 to CNT93).

Prerequisites that are the user's to decide: a Cloudflare account on the Workers Paid plan ($5 a month) and a Vercel account on
Pro ($20 a month, with a $20 usage credit), a model credential (in AI Gateway on Cloudflare, where credits carry a 5% fee on what
is bought), and which harness. Of the audited lanes whose harness Cloudflare has a tutorial for (claude and codex), the cheapest
is codex on `gpt-6-luna`, at $0.10 per million input tokens and $0.01 cached; the Muse contributor and MiMo flash lanes cost less
per token and have no tutorial. At the audit's fixture medians a lane's sandbox time is cents on both providers, so the cost of
the spike is the two plan fees and cents. The model spend for one lane is a few cents more, paid from a few dollars of credit or
on the user's own key. The effort to build it was not estimated.

It would not show parallel lanes, a coachman, a lane over an hour, a forced deploy or the gate on 4 vCPU. A second spike would
cover a 90-minute lane and a deploy during it, which is what Cloudflare's lifetime pages say matters. The Vercel half would show
whether the firewall can carry a subscription login, which no page settles.

**The measurement.** Whether it pays to buy compute only while it is used depends on how much of a launch's provisioned time
is spent waiting for a model. The records cannot say: they hold no CPU measurement, and the cost tables bracket CPU use at none,
a quarter and all busy. #363 keeps each launch's wall seconds, CPU seconds and peak memory from its systemd scope, prices the
next 20 or so real runs at on-demand rates and reports how much of the provisioned time was waiting. It settles two things:

- **What not paying for idle compute is worth on Cloudflare.** Memory and disk are charged while an instance runs and CPU only
  when busy. For a waiting agent (1 vCPU, 4 GiB, a fifth of the CPU busy) an hour is $0.053, of which memory is $0.036; if the
  CPU were charged as provisioned the hour would be $0.111. So charging CPU by use halves the waiting agent's hour. The larger
  saving is against a machine that is paid for all month, and that is the one the measurement prices. The profile is an
  assumption until it is measured.
- **The break-even against the local machine.** The machine's monthly cost over the runs it does in a month, against the
  Cloudflare plan fee plus the cost of a run. With agents sized to what they use, the 18 audited runs average $2.92 each, so a
  flat $50 a month costs the same as Cloudflare at 15 runs a month and $100 at 33. With every launch a standard-4 they average
  $6.83, and the same points are 7 and 14 runs [@trials/2026-10-08-cloudflare-run-cost/results/providers.md].

## What was not checked

- Nothing was run on Cloudflare. Every Cloudflare finding is what the documents, the changelog, open-source code and
  issue reports say. Whether a lane fits 12 GiB, how fast the gate runs on 4 vCPU, how often a platform stop happens,
  and whether `bwrap` works inside an instance are not known.
- Dynamic Workers, Workers Logs pricing, Secrets Store, whether each intercepted request is billed as a Worker request, and
  any SLA outside the Containers and Sandbox pages.
- The Wrangler configuration reference was read only through the fetch tool, and the tool did not read its last 3,261
  characters [@articles/cloudflare-containers-sandboxes/passages.md] (A-NOTCHECKED).
- The documentation text was read as a repository checkout. Ten claims were also read on the published pages
  (A-CHECK), and for the control-plane pages B1, B2, B3, B5 and B12 to B14 were (B-SECOND); the rest were not
  [@articles/cloudflare-control-plane/passages.md] (B-NOTCHECKED). Fetch-tool answers are cut at about 125 characters, so
  long quotations were compared against the repository text instead
  ([quote check](../../raw/trials/2026-10-08-cloudflare-run-cost/results/quote-check.md)).
- Vendor terms: OpenAI's policy pages were read as third-party copies. xAI's terms returned 403. Xiaomi's user agreement is
  rendered by script and was not read. Anthropic's Commercial Terms were read in one pass. The 2026-11-12 usage policy
  page has no announcement anywhere that was found. OpenAI's and Anthropic's plan prices were not gathered; Meta's and
  Xiaomi's are in the captures.
- The lane isolation scan was read and not re-run. The coachman's process time, the CPU use of any
  launch and the gate's speed in a container are bracketed or unknown.
- Whether a subscription login held in a Worker and injected in place of a placeholder works for Codex or Claude Code at
  all was not tried. The vendors' gateway pages describe a gateway that forwards a login the client holds; Cloudflare's
  retired example, whose contributor wrote that it worked, covers Claude Code only, and nothing found shows Codex.
- Other providers: no account was opened and nothing was ordered or run. Every rate is a list price read from a page,
  mostly in two reads through a fetch tool that returns a summary, which count as one check
  [@articles/on-demand-containers-and-sandboxes/passages.md] (CNT-NOTCHECKED)
  [@articles/on-demand-virtual-machines/passages.md] (VMS-NOTCHECKED) [@articles/ci-runners-free-tiers-and-phones/passages.md]
  (CIP-NOTCHECKED). Not read: Google Cloud Run's pricing page (the rates come from Google's discount page), Render's pricing
  pages, Azure's pricing page (the rates come from its price API), AWS's Spot rates, Modal's basis for a Function's CPU charge,
  Railway's metering basis, Northflank's longest job, whether Koyeb's Eco vCPU is shared, Vercel's rates outside one region,
  E2B's ceiling above 8 vCPU and 8 GiB, and Google Compute Engine's own prices (a third-party mirror gave them, so none is
  used). Also open: whether an outbound call to a model keeps a Fly.io Sprite awake and whether a 12 GiB gate fits one; whether a
  new Hetzner account can create a server today; which of Oracle's two Always Free allowances governs; whether GitHub's terms
  allow coding agents in Actions or Codespaces; whether a personal GitHub account can use larger runners; and whether the
  firewall of Vercel Sandbox can carry a subscription login. Whether the flow's launches would behave on any of these platforms
  was not tried.
- The two profiles behind the provider comparison, a gate hour of 4 vCPU and 12 GiB with every vCPU busy and a
  waiting-agent hour of 1 vCPU and 4 GiB with a fifth busy, are assumptions until #363 measures them.

## What would change the answer

- The spike in #362 running a fixture lane to a passing score with the key outside the sandbox: toward supported for the
  lane. A spike that cannot keep a 90-minute lane alive through a deploy, or resume after a sandbox slept, names what the
  lifetime pages lack.
- The measurement in #363: if a run's launches are busy for much more of their time than the waiting-agent profile assumes,
  the pay-for-use saving on Cloudflare shrinks and the break-even against a flat monthly price moves. It also reorders the
  providers: Cloudflare charges for busy CPU and most of the others charge for every vCPU, so the busier the agents, the
  better the others look against it.
- A provider's size or session limit changing: E2B's and Daytona's caps below 12 GiB, Vercel's 24-hour sessions, Fargate's
  quota for a new account. A price change moves the table, and Hetzner's rose 154% in euro on 2026-06-15.
- The Vercel half of #362 finding that the sandbox firewall can carry a subscription login: that would answer the question
  the terms leave open for one provider, and a failure would leave API credentials as the only route there.
- A vendor's written answer on a subscription login in a cloud container, for Anthropic or OpenAI. Either answer
  changes what the lanes' model access costs, and whether the Cloudflare pattern can carry a subscription login at all,
  more than any other fact here.
- The `durable_object` policy and snapshots leaving beta, or Cloudflare adding an SSH egress proxy or placement
  constraints for that policy.

## Proposed tickets

Two are already filed: [#362, A ticket can name where its lanes run, on this machine or in a remote sandbox, starting with a
spike on Cloudflare and Vercel](https://github.com/brindlewick/postmaster/issues/362), and [#363, A run records what each launch
used, so the run can be priced on demand](https://github.com/brindlewick/postmaster/issues/363). This research files none. Titles
below are in the form the repository uses. The provider comparison supports #362's choice of two providers behind one adapter:
Vercel Sandbox, Modal Sandboxes, Daytona, AWS Fargate, Northflank, Koyeb Sandboxes and Fly.io's Sprites document starting a
command, streaming its output and reading its exit code, as Cloudflare's `exec()` does, so a third provider could follow.

1. **A run's launches can run on virtual machines that are made for one ticket and deleted after it.** Hourly-billed virtual
   machines cost $0.037 to $0.072 an hour for 4 vCPU and 8 GiB on all the providers priced but AWS on demand, which is $0.136,
   and only deleting one stops the charge on Hetzner, Vultr, Linode and DigitalOcean. It is its own ticket, separate from [#136,
   Design: run tickets on any machine on the tailnet, so adding a machine adds
   capacity](https://github.com/brindlewick/postmaster/issues/136), which is about machines reachable over SSH, and from
   #362, which is about a remote sandbox for a lane. A rented month of the same size costs the same as 22 to 26 median runs, and
   one machine of that size can do about that many one after another, so the ticket is worth doing only if runs are few or the
   machine must not be shared (argued from the break-even).
2. **A run's records are kept behind one store that roles on different machines can reach.** The run folder as a service
   (an action log, event streams, markers), before a whole run moves off the machine it runs on. #362's spike moves only a
   lane and needs none of it.
3. **A run chooses, for each role, a subscription login or an API key, and the choice is checked before the run starts.**
   The decision the terms leave open, made visible. This is model-side, the same on any host. The Opus security review is
   the line that decides it, at $14.56 to $35.79 a run at API prices.
4. **The security review runs only where a change touches a risk surface.** From the lane audit's candidate list, now
   with a price (model-side, the same on any host): 92% of the model dollars at list price while the coachman is on Meta's
   contributor tier, 63% on its standard tier.
5. **The gate is timed on a machine with 4 vCPU and nothing else running.** Any cloud machine will do. It separates the
   gate's own time from the machine's load. #362 times a lane, not the gate.
6. **Not new: finish #203 and #221.** They give most of the isolation locally and are filed and open; #342 has landed.

Not a ticket: ask Anthropic and OpenAI, in writing, whether a person's own subscription login may be held by their
own Worker and used from their own containers. Only the user can ask.

## Evidence

[@trials/2026-10-08-cloudflare-run-cost/method.md] and its results; the captures
[@articles/cloudflare-containers-sandboxes/source.md], [@articles/cloudflare-containers-issue-reports/source.md],
[@articles/cloudflare-control-plane/source.md], [@articles/cloudflare-ai-gateway/source.md],
[@articles/openai-codex-login-and-terms/source.md], [@articles/anthropic-claude-code-login-and-terms/source.md],
[@articles/meta-muse-code-login-and-terms/source.md], [@articles/xiaomi-mimo-code-login-and-terms/source.md],
[@articles/other-harnesses-login-and-terms/source.md], [@articles/model-api-prices/source.md],
[@articles/on-demand-containers-and-sandboxes/source.md], [@articles/on-demand-virtual-machines/source.md],
[@articles/ci-runners-free-tiers-and-phones/source.md]; the audit it builds on,
[@trials/2026-10-03-lane-audit/method.md]. See also [several lanes](several-lanes.md), [lane confinement](lane-confinement.md)
and [the adapter files](../../skills/postmaster/harnesses.md).
