# Make a verifier for one surface of this project

You are writing a verifier: a folder an agent opens cold, in the middle of a job,
that tells it how to start one surface of this project, check that it is healthy,
drive it the way a user does, keep proof, and clean up afterwards. The shape follows
pstack's create-verification-skill, read at cursor/plugins commit 23e4138
(https://github.com/cursor/plugins/blob/23e4138daa01c42d4969f7a5465f82704e64f798/pstack/skills/create-verification-skill/SKILL.md),
restated here in this tool's own words. Where the two disagree, these instructions win.

- Reference checkout, read-only, never edit it: {{REPO}}
- Surface: {{SURFACE_PROSE}} ({{SURFACE}})
- Write the verifier to: {{VERIFY_DIR}}/ at the top of this working copy
- Your working copy: this directory, cut from {{BASE}}. It may differ from the
  reference checkout; the working copy is what you verify.

Do all of your work inside this working copy and edit nothing outside it.
{{ASK_RULE}}

## 1. Learn the surface from the working copy

Answer every question below from the code, the docs and the commands in this
working copy:

- Start: how does the surface start here? Prefer the project's own documented way in
  (its scripts, its make targets, its README quickstart). Note ports, environment
  variables, seed data and logins.
- Drive: how can an agent operate it without a screen? Reach for what the project
  already has first — its browser specs, its scripted clients, its helpers — and only
  then fall back to a plain recipe for the surface.
- Proof: what can be kept afterwards? Terminal transcripts, screenshots, replies, logs,
  exit codes, stored rows.
- Side by side: can two copies run next to each other (ports, data folders, profiles)?
  If not, say so in the verifier: declining a second copy beats wrecking the first.

When the working copy does not build or start as it stands, mend that first, or
report exactly what is broken, before writing anything: a verifier written while
the base is broken learns every step wrong. Never mend the reference checkout.
When some side file the surface never touches blocks startup, the verifier may
lay it down, marked plainly as scaffolding for verification, and take it away
again in cleanup.

{{SECRETS_RULE}}

## 2. Write the verifier

Write {{VERIFY_DIR}}/README.md with exactly these sections, each one grounded in what
step 1 found, with no placeholders left behind:

- Launch: the exact command that starts the surface for verification, and the sign it
  is ready (a log line, an answering port, a prompt). Include the teardown. Where the
  surface is short-lived commands, no server stays up: launch means a one-time prepare,
  then giving every drive state of its own.
- Health check: one read-only check answering whether this copy is worth driving — the
  process up, the right build, the port ours, the login valid. Run it first whenever
  anything looks wrong.
- Drive: the operating recipe, with the real commands and handles from this project,
  never examples. Prefer handles that survive redesign (labels, names, route paths)
  over screen positions and tab order.
- Evidence: what a proof keeps and where it goes. The standards: drive the true user
  path, never private hooks or test-only doors; keep the action and the state it left,
  not only the last screen; check side effects (files written, rows stored, messages
  sent) beside what is visible; stand-ins only where the project already walls the
  outside system off. Where the safe road is a dry run or a test mode, watch what it
  truly skips (files, network, refs) instead of trusting its name: some dry runs still
  reach the network or start a browser.
- Cleanup: taking down what the run started. Never stop a process by its name;
  stop what you started. Cleanup takes away copies and scratch state, never the proof:
  proof outlives the teardown, in a place the verifier names.
- Helpers: any script the verifier ships runs as shown, and the body shows how to call
  it. A helper the reader must take apart to use is no helper.

Every drive gets state of its own, so no drive touches real data. Where step 1
found two copies can run side by side, drives may run together; where they
cannot, say so plainly and run drives one at a time. The proof folder is set
by whoever drives the verifier, through an environment variable the verifier
names, defaulting to the system's temp folder. Run the project's formatter
over every file you add, and leave its checks passing.

## 3. Map three to five features

Write {{VERIFY_DIR}}/features/README.md, an index of the surface's user-facing features,
plus one page per feature for three to five of them, chosen from the routes, commands,
menus and docs. Each page carries an H1 naming the feature with one paragraph saying
what a user sees, then exactly these four H2 sections, in this order:

- Sub-features
- How a user reaches it
- Driving it
- Traps

Carry one line starting with `Files:` in features/README.md, naming the project
files and folders whose change can break this verifier's claims,
comma-separated, each relative to the top of the working copy. Name files and
folders both; write only paths that exist at the commit you prove, and check
each one is there before you write the line.

Say what the feature is, every way a user reaches it, how to drive each way, and what
observable state proves it worked. The map is the maintained source: driving one handy
entry while the map lists others is half a proof.

## 4. Prove the verifier once, then hand over

Run your own instructions end to end one time: launch, the health check, drive a
single mapped feature (one suffices; the map stands so that later runs cover the
rest), keep the proof, clean up. After cleanup, confirm the proof is still at the named place:
proof gone after cleanup fails this step. Mend what fails, and run your own cleanup
after every failed round too, so broken rounds strand no processes and no ports. A
verifier nobody has run is a draft, not a handover.

Once the proof holds, carry `Confirmed: {{PROVED}}` in features/README.md beside
the `Files:` line: the confirmation says this verifier was proved at that
commit, and a verifier without one reads as possibly stale.

Commit the verifier on this branch. {{HANDOVER_RULE}}{{HANDOVER_UNASKED}}
