# Passages relied on: user reports in Cloudflare repositories' issue trackers

Read on 2026-10-08 through the GitHub REST API. These are reports by users of what they hit, not statements by the vendor. Each entry is the reader's note and the words quoted from the issue.

### A-TP.1 Long-running work killed by the idle timer
- finding: cloudflare/containers issue #138 (open; opened 2026-01-09): a user running FFmpeg reports the container "receives SIGTERM and exits after ~8-10 minutes of active work, regardless of job progress." The only reply (user, not maintainer) explains it as the `sleepAfter` activity timeout (10 minutes) and recommends client pings that call `renewActivityTimeout()` and a manual `stop()`. This matches the docs: process activity does not count.
- quote: "the container receives SIGTERM and exits after ~8-10 minutes of active work, regardless of job progress" (verbatim, issue body)
- source: https://github.com/cloudflare/containers/issues/138 ; read 2026-10-08 via https://api.github.com/repos/cloudflare/containers/issues/138
- strength: shown (user report)

### A-TP.2 Rollout reported complete while the old image kept serving
- finding: cloudflare/containers issue #233 (open; 2026-07-10): on a `default`-policy app addressed by a single DO via `getByName`, the rollouts API reported the rollout completed (default two-step and `--containers-rollout=immediate`, grace period 0) yet "The running instance kept serving the old image for over an hour"; the workaround that worked was `wrangler containers delete <APP_ID>` then redeploy. One report, not confirmed by the vendor in the thread.
- quote: "The running instance kept serving the **old image** for over an hour" (verbatim, issue body, including its markdown bold markers)
- source: https://github.com/cloudflare/containers/issues/233 ; read 2026-10-08
- strength: shown (single user report)

### A-TP.3 Capacity errors on start in production
- finding: cloudflare/containers issue #45 (open since 2025-07-07, last comment 2026-08-09, 9 comments): "There is no container instance that can be provided to this Durable Object, try again later". Early reports were traced by a CONTRIBUTOR to `max_instances` defaulting to 0; later comments (2026-08-06 and 2026-08-09, containers 0.3.7, Wrangler 4.114.0) report the same error on production-only placement for several apps in one account with explicit `max_instances`. Related: #70 (2025-08 state mismatch: requests sent to a stopped container the DO believed running) and #232 (2026-07: "Container reported not-running / crashed while genuinely alive during slow startup").
- quote: "There is no container instance that can be provided to this Durable Object, try again later" (verbatim, error text in issue title)
- source: https://github.com/cloudflare/containers/issues/45 ; https://github.com/cloudflare/containers/issues/70 ; https://github.com/cloudflare/containers/issues/232 ; read 2026-10-08
- strength: shown (user reports; some unresolved)

### A-TP.4 Activity-tracking bugs in the Container class
- finding: Open issues: #147 (WebSocket connections did not renew the activity timeout; the library source I read now renews on WebSocket messages, so the state of that issue is unclear), #241/#242 (2026-08: `inflightRequests` leaks when a client aborts, so the container "never stops and bills indefinitely"; no fix seen in the 2026-08-24 source I read, where `isActivityExpired()` still renews while `inflightRequests > 0`). For a design: a leaked in-flight counter keeps a `Container`-class instance and its billing alive.
- quote: "container never stops and bills indefinitely" (verbatim, title of issue #241)
- source: https://github.com/cloudflare/containers/issues/241 ; https://github.com/cloudflare/containers/issues/242 ; https://github.com/cloudflare/containers/issues/147 ; read 2026-10-08
- strength: shown (user reports); the code reading is mine

### A-TP.5 Placement constraints rejected for the `durable_object` policy (early adopter, reproduced by the repo's automated triage)
- finding: workers-sdk issue #15995 (opened 2026-10-01, closed 2026-10-06 after a member transferred it) reports that Wrangler 4.146.0 rejects `constraints` on a `durable_object` container with the error text `Unsupported fields for Durable Object-managed Containers in containers: "constraints".` The repository's automated triage comment says the error was reproduced. The transferred copy is cloudflare/sandbox-sdk issue #936 (open on 2026-10-08). This agrees with the migration page's table ("Placement constraints ... Not supported on the replacement application"). A data-residency requirement therefore cannot be met by constraints on this policy today; the reporter also notes that a DO jurisdiction does not pin the container ("the container isn't guaranteed to run where the DO is").
- quote: "Unsupported fields for Durable Object-managed Containers in containers: \"constraints\"." (verbatim, error text quoted in the issue)
- source: https://github.com/cloudflare/workers-sdk/issues/15995 ; https://github.com/cloudflare/sandbox-sdk/issues/936 ; docs/containers/guides/migrate-to-durable-object-scheduling-policy.mdx@6e1b964 line 52 ; read 2026-10-08
- strength: shown (user report plus bot reproduction); consistent with the stated docs

### A-TP.6 `wrangler delete` leaves the Containers application running and billing
- finding: workers-sdk issue #16008 (open; 2026-10-01): a user reports that deleting a Worker with `wrangler delete` does not delete its Containers application, which "keeps running and billing" (they saw `active=1` in `containers applications list` after the Worker was gone, across five spike deployments); cleanup needs `wrangler containers delete <id>`. The docs say the same about removing a config entry ("Removing the entry from Wrangler configuration does not delete the existing Container application") and that deleting an application deletes its instances. A single user report on the Worker-delete path.
- quote: "Removing the entry from Wrangler configuration does not delete the existing Container application." (verbatim, vendor docs)
- source: docs/containers/guides/migrate-to-durable-object-scheduling-policy.mdx@6e1b964 line 207 ; https://github.com/cloudflare/workers-sdk/issues/16008 ; read 2026-10-08
- strength: stated (config-removal case); shown (Worker-delete case, one user report)

### A-TP.7 `Files.readFile()` can hang in `@cloudflare/sandbox` 1.0.0
- finding: sandbox-sdk issue #935 (open; 2026-10-04; no replies): a user with code analysis reports that `Files.readFile()` in 1.0.0 can hang forever because it waits for a stderr control header before reading stdout. `lstat`, `writeFile` and `mkdir` are said to be unaffected. Relevant to any design that returns lane results through `Files`; `exec()` plus `cat` or `git diff` avoids that class, as the runner tutorial does for the diff.
- quote: "`Files.readFile()` can hang forever." (verbatim, issue body)
- source: https://github.com/cloudflare/sandbox-sdk/issues/935 ; read 2026-10-08
- strength: shown (single unconfirmed user report)
