## Problem / feature
Agents publish pages to claude.ai for the user: spec documents (#211), and, from #214's research, review pages and code viewer pages. A published page goes to an external service that may keep a copy even after a delete, and nothing checks it first: only the publishing agent's care keeps private data off it. A page is held to stricter rules than a commit. #216, "The private-data check is TypeScript run by Bun, and flags little of the project's own code", lets private context such as home paths and host names into commits by the user's word on 2026-10-02, while a page must hold none of it. #214 set the rules for a page: nothing #216's check would refuse in a commit, no credential or configuration value, no machine path or host name, no email address, no link to this machine, and every page private to the user's account unless the user says otherwise.

## Acceptance criteria
1. A script checks a page and every file published with it before the publish, and refuses, naming the file, the line and the rule, any of these cases: anything #216's check refuses in a commit; an absolute path under the user's home directory; this machine's host name, its tailnet name or address, or a private network address; an email address outside the reserved example domains (`example.com`, `example.org`, `example.net`, and names ending `.invalid`, `.test` or `.example`); a value from `~/.postmaster/config.toml` whose key names a token, a key, a secret or an env file, or the path of an env file; and a link to this machine, such as a code-server address. Check: a page planted with one instance of each case is refused once per case, through the same command (positive control), and the three review pages of #214's trial pass clean (negative control).
2. Every runbook step that publishes a page runs the check first and does not publish on a refusal: the spec session's and any later page's. Check: each such step in `skills/postmaster/` names the check before its publish, and `scripts/skill-refs.sh` passes.
3. The check reads this machine's names at run time and holds none of them. Check: the script and its tests carry no host name, home path or address of this machine.

## Direction
Patterns only, with no model, as the user ruled for #216 on 2026-10-03; reuse #216's patterns for personal data and secrets rather than writing them twice. TypeScript run by Bun, with its tests beside it, as #109 made every script. The check refuses; it does not rewrite a page. Nothing repo-specific or machine-specific goes in the tool.

## Turnpikes
default

## Notes
From #214, "Research: review a change in an artifact page instead of in code-server", whose criterion 4 asks for this script as a proposed ticket. Depends on #216 for the commit check's patterns. Related: #211 and #229.
