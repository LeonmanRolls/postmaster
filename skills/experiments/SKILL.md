---
name: experiments
description: Show a project's experiments on a private claude.ai page made for a phone. The page reads its own store each time it is opened and updates while it is open, with what is due first. Use it when the postmaster publishes the page, and after each change to the experiments. Claude Code only, until the dashboard shows them.
---

# Experiments pages

One page per project: an experiment tests one project's flow, so each project gets its own
page and its own store, and one project's rows never go to another's page. The record lives
in the project's private folder on this machine, and the page's store holds the same rows:
the command below works in every harness, and only this skill's two steps need Claude Code.
`<tool>` below is the postmaster repository: the folder two above this file once its link is
resolved.

## Publish the page once

1. Read `<tool>/skills/experiments/experiments-page.html` back for home paths, host names,
   private addresses and anything private, as the review page's skill says. The page holds no
   rows until step 2 of the next section writes them.
2. Publish it with the Artifact tool, `capabilities: {"db": {}}`, and no files. Then, at
   once, stop the watch on it (ArtifactComments, `action: watch`, `on: false`), as `AGENTS.md`
   says.
3. Give the user the link as `https://claude.ai/code/artifact/<uuid>`: read the page back
   with the Artifact tool's `read` and `path`, and take the uuid from the folder it is saved in.
4. Write the link to `<repo>/.postmaster/experiments-page.url`, one line, where `<repo>` is
   the repository the experiments belong to. The folder's ignore rule keeps it out of the
   repository; commit nothing here.
5. The page is for reading: it has no forms and writes nothing. The user answers in the chat.

## Write the rows after each change

1. Read the page's link from `<repo>/.postmaster/experiments-page.url`, where `<repo>` is
   the repository the experiments belong to, and write to that page's store. When no link
   is saved, publish the page first, as the previous section says, and never publish a
   second page for a project that has one.
2. Print the rows: `<tool>/scripts/run experiments push-docs --project <repo>`.
3. Read the collection `experiments` with ArtifactData `list`. Each document's version is what
   a write to it needs.
4. Write each row with ArtifactData `set` in `experiments`, `doc_id` the experiment's id and
   data the row as printed, in one batch: the version from the list for a document that
   exists, none for a new one. A row written while the page is open shows at once, and a
   changed row never needs a republish.

## Never

- Share a page, or publish one that holds a credential, a home path, a host name, an email
  address, a link to this machine, or a value from `~/.config`, `~/.claude` or `~/.postmaster`.
- Write one project's rows to another project's page.
- Delete a page without the user's word.
- Record a page's link in a repository.
