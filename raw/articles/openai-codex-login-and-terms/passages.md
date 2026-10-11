# Passages relied on: OpenAI Codex, headless logins and OpenAI's terms

Read on 2026-10-08. Each entry is the reader's note, the quotations with the mark the reader gave them (verbatim means the same words were seen in two separate reads, or in repository text; paraphrase means one read or a restatement), where each was read, and how sure the note is. Strength: stated is on the vendor's page, shown is in open-source code or a third-party copy of the page, argued is derived by the reader from the entries named, not found is a search with the searches listed. OpenAI's own policy pages answered HTTP 403 to the fetch tool, so its terms were read as the Open Terms Archive copies of the pages (a third-party capture on GitHub, with the capture date named in the entry) and, for the rest-of-world Terms of Use, through a public text converter that fetches the page; the entries say which. The Codex documentation moved from developers.openai.com/codex to learn.chatgpt.com/docs.

### OAI1 H1-codex-1 Login methods the CLI offers
- finding: `codex login` has three non-interactive credential sources besides the browser flow: `--device-auth`, `--with-api-key` (key on stdin) and `--with-access-token` (token on stdin); env vars `CODEX_API_KEY`, `OPENAI_API_KEY` and `CODEX_ACCESS_TOKEN` are read by the code.
- quote: "On a remote or headless machine? Use `codex login --device-auth` instead."   (verbatim, CLI message text in the Rust source)
- quote: "--with-access-token expects the access token on stdin. Try piping it, e.g. `printenv CODEX_ACCESS_TOKEN | codex login --with-access-token`."   (verbatim, source)
- source: codex-rs/cli/src/login.rs@2c3156a lines 122, 283, 291; codex-rs/cli/src/main.rs@2c3156a lines 515-545; env var constants codex-rs/login/src/auth/manager.rs@2c3156a lines 953-955 (`OPENAI_API_KEY`, `CODEX_API_KEY`, `CODEX_ACCESS_TOKEN`) ; read 2026-10-08
- strength: shown (open-source code)

### OAI2 H1-codex-2 Browser login needs a browser; device code is the documented headless route
- finding: The default `codex login` opens a browser and a local callback server (default localhost:1455); for headless machines the docs say prefer device code (marked beta), which must first be enabled in the ChatGPT security settings (personal) or in workspace permissions.
- quote: "In these situations, prefer device code authentication (beta)."   (verbatim: two fetches of https://learn.chatgpt.com/docs/auth)
- quote: "If device code login isn't available in your environment, use one of the fallback methods below."   (verbatim, two fetches)
- source: https://learn.chatgpt.com/docs/auth (formerly https://developers.openai.com/codex/auth, 308 redirect) ; page shows no last-updated date ; read 2026-10-08
- strength: stated

### OAI3 H1-codex-3 Copying auth.json to a headless machine is documented as a fallback (login cache file)
- finding: The docs tell the user to log in on a machine with a browser and copy `~/.codex/auth.json` to the headless machine (examples: over SSH, into a Docker container), and say to treat it like a password; they also say the method may not apply if the OS credential store is used.
- quote: "Copy `~/.codex/auth.json` to `~/.codex/auth.json` on the headless machine."   (verbatim, second fetch; first fetch gave "you can copy your cached credentials to the headless machine")
- quote: "Treat `~/.codex/auth.json` like a password: it contains access tokens."   (verbatim, two fetches, also on the CI/CD page)
- quote: "If your OS stores credentials in a credential store instead of `~/.codex/auth.json`, this method may not apply."   (verbatim, two fetches)
- source: https://learn.chatgpt.com/docs/auth ; read 2026-10-08
- strength: stated

### OAI4 H1-codex-4 Credential storage: file path, store modes, and field NAMES of auth.json
- finding: Default path is `$CODEX_HOME/auth.json` (CODEX_HOME defaults to `~/.codex`); config key `cli_auth_credentials_store` takes `file`, `keyring`, `auto` or `ephemeral`; the file is written with mode 0600 on Unix. Top-level field names: `auth_mode`, `OPENAI_API_KEY`, `tokens`, `last_refresh`, `agent_identity`, `personal_access_token`, `bedrock_api_key`, `bedrock_access_keys`. Inside `tokens`: `id_token`, `access_token`, `refresh_token`, `account_id`. (No values read or recorded.)
- quote: "Codex caches login details locally in a plaintext file at `~/.codex/auth.json` or in your OS-specific credential store."   (verbatim, two fetches)
- quote: "`ephemeral` keeps credentials in memory only for the current process."   (paraphrase of first-fetch summary; not re-read)
- source: https://learn.chatgpt.com/docs/auth ; codex-rs/login/src/auth/storage.rs@2c3156a lines 47-72 (struct `AuthDotJson`, doc comment "Expected structure for $CODEX_HOME/auth.json."), line 225 (`options.mode(0o600)`); codex-rs/login/src/token_data.rs@2c3156a lines 10-25 (`TokenData`) ; read 2026-10-08
- strength: stated (docs) and shown (code)

### OAI5 H1-codex-5 Access tokens (Business and Enterprise only) for non-interactive runs
- finding: "Codex access tokens" are ChatGPT workspace credentials scoped to Codex, created by workspace members with the permission, passed via `CODEX_ACCESS_TOKEN` (ephemeral) or `codex login --with-access-token` (stored); supported for Business and Enterprise workspaces; bounded validity (shortest custom window one day); tied to the creator. Plus and Pro are not mentioned on the page.
- quote: "Codex access tokens are currently supported for ChatGPT Business and Enterprise workspaces."   (verbatim for this one sentence: seen once in the page fetch; second read NOT yet done)
- quote: "anyone with the token can start local runs through Codex CLI or an app-server client as the token creator."   (partly verbatim; once)
- source: https://learn.chatgpt.com/docs/enterprise/access-tokens ; read 2026-10-08. Code: personal access tokens start with prefix `at-` (codex-rs/login/src/auth/access_token.rs@2c3156a line 1) and are validated by a GET to `https://auth.openai.com/api/accounts/v1/user-auth-credential/whoami` (codex-rs/login/src/auth/personal_access_token.rs@2c3156a lines 9-12, 82-100).
- strength: stated (docs) / shown (code)

### OAI6 H1-codex-6 API key route for automation
- finding: Docs say use an API key for programmatic runs; `codex exec` reuses saved CLI auth by default and `CODEX_API_KEY` sets a different key for one run.
- quote: "`codex exec` reuses saved CLI authentication by default."   (paraphrase-level: seen once, https://learn.chatgpt.com/docs/non-interactive-mode)
- quote: "API keys are the right default for automation because they are simpler to provision and rotate."   (seen once)
- source: https://learn.chatgpt.com/docs/non-interactive-mode ; read 2026-10-08
- strength: stated (second read still due)

### OAI7 H2-codex-1 Refresh cadence and where the refresh goes
- finding: The CLI refreshes a ChatGPT login in the background: when the access-token JWT expires within 5 minutes, or (if no JWT expiry) when `last_refresh` is older than 8 days; on any 401 it also tries reload-then-refresh. Refresh is a POST to `https://auth.openai.com/oauth/token` (client id constant in code), URL overridable by env `CODEX_REFRESH_TOKEN_URL_OVERRIDE`. The response can carry a new id_token, access_token and refresh_token; all three are written back to auth.json with a new `last_refresh`.
- quote: "after a successful refresh, Codex writes the new tokens and a new `last_refresh` back to `auth.json`"   (verbatim, two fetches of https://learn.chatgpt.com/docs/auth/ci-cd-auth)
- source: codex-rs/login/src/auth/manager.rs@2c3156a lines 203-204 (`TOKEN_REFRESH_INTERVAL: i64 = 8`, `CHATGPT_ACCESS_TOKEN_REFRESH_WINDOW_MINUTES: i64 = 5`), 212-214, 1600-1625 (`persist_tokens`), 1713-1717 (`struct RefreshResponse { id_token, access_token, refresh_token }`, all Option), 3001-3023 (`should_refresh_proactively`), 3090-3108 ; https://learn.chatgpt.com/docs/auth/ci-cd-auth ; read 2026-10-08
- strength: stated and shown

### OAI8 H2-codex-2 A refresh token is single-use; reuse is an error that forces a new login
- finding: The code maps the token-endpoint error codes `refresh_token_expired`, `refresh_token_reused` and `refresh_token_invalidated` to user messages; the "reused" case says the refresh token "was already used" and tells the user to log out and sign in again. Treated as permanent failure (no retry). This is the text a second copy of one login gets after the first copy has refreshed.
- quote: "Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again."   (verbatim, source)
- quote: "Your access token could not be refreshed because your refresh token has expired. Please log out and sign in again."   (verbatim, source)
- quote: "Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again."   (verbatim, source)
- source: codex-rs/login/src/auth/manager.rs@2c3156a lines 206-211 (messages), 1680-1706 (`classify_refresh_token_failure`: code `refresh_token_reused` -> reason Exhausted), 1659-1668 (permanent vs transient) ; read 2026-10-08
- strength: shown (code). Inference "refresh tokens rotate on use" is argued from the name `refresh_token_reused`, the `RefreshResponse` carrying a new `refresh_token`, and the docs' "rotated the token first" (see H2-codex-3).

### OAI9 H2-codex-3 Docs: one auth.json per runner, never shared across concurrent jobs or machines
- finding: OpenAI's own CI/CD page says exactly one machine or serialized job stream may use a given auth.json copy; sharing across concurrent jobs or machines is forbidden by that page; "another machine or concurrent job rotated the token first" is a listed reason to reseed.
- quote: "Do not share the same file across concurrent jobs or multiple machines."   (verbatim: two fetches with different prompts)
- quote: "Use one `auth.json` per runner or per serialized workflow stream."   (verbatim: appears in first fetch and is named as the closest match in the second)
- quote: "another machine or concurrent job rotated the token first"   (verbatim, two fetches; a bullet in a list of reasons to reseed)
- source: https://learn.chatgpt.com/docs/auth/ci-cd-auth (title "Maintain Codex account auth in CI/CD (advanced)") ; no last-updated date shown ; read 2026-10-08
- strength: stated

### OAI10 H2-codex-4 Within one machine: in-process lock plus reload-from-disk; no cross-process file lock found
- finding: Before refreshing, the code takes an in-process semaphore, reloads auth.json from the store, and skips its own refresh if the tokens on disk already differ from its cache (another process on the same CODEX_HOME refreshed). If the account id differs after reload it fails with "you have since logged out or signed in to another account". No cross-process file lock was found in manager.rs or storage.rs (grep for flock|fs2|lock_file|try_lock|FileLock|advisory: 0 hits in those two files; `refresh_lock` is `tokio` `Semaphore::new(1)`, a per-process object). Two machines with separate copies get no such help: the second to refresh presents an already-used refresh token.
- quote: "Skipping token refresh because auth changed after guarded reload."   (verbatim, source log message)
- quote: "Your access token could not be refreshed because you have since logged out or signed in to another account. Please sign in again."   (verbatim, source)
- source: codex-rs/login/src/auth/manager.rs@2c3156a lines 211, 2057, 2214 (`refresh_lock: Semaphore::new(1)`), 2485-2520 (`reload_if_account_id_matches`), 2845-2880 (`refresh_token`) ; read 2026-10-08
- strength: shown (code). "No cross-process lock" is argued from absence (not found: greps above, two files only).

### OAI11 H2-codex-5 Keep refreshed file; do not overwrite from the seed
- finding: The CI/CD page warns against rewriting the file from the original secret on each run because that throws away the refreshed tokens; reseed from a trusted machine only when built-in refresh stops working; the page says a refresh token can be revoked or expired.
- quote: "Do not overwrite a persistent runner's refreshed file from the original seed on every run."   (verbatim: first fetch; second fetch has "Reseed from a trusted machine if built-in refresh stops working." verbatim)
- quote: "Reseed from a trusted machine if built-in refresh stops working."   (verbatim, two fetches)
- source: https://learn.chatgpt.com/docs/auth/ci-cd-auth ; read 2026-10-08
- strength: stated

---

### OAI12 H3-codex-1 Config keys for a custom provider; only the Responses wire format is accepted
- finding: A custom endpoint is a `[model_providers.<id>]` table in `config.toml` with keys such as `name`, `base_url`, `env_key` (name of the env var that holds the key), `wire_api`, `query_params`, `http_headers`, `env_http_headers`, `request_max_retries`, `stream_max_retries`, `stream_idle_timeout_ms`, and a command-backed `[model_providers.<id>.auth]` (`command`, `args`, `timeout_ms`, `refresh_interval_ms`). The only wire format the code still accepts is `responses` (OpenAI Responses API, `/v1/responses`); `wire_api = "chat"` now fails to load with an explicit error. The built-in provider can be re-pointed with `openai_base_url`. Built-in IDs `openai`, `ollama`, `lmstudio` cannot be reused.
- quote: "`wire_api = \"chat\"` is no longer supported.\nHow to fix: set `wire_api = \"responses\"` in your provider config."   (verbatim, source constant CHAT_WIRE_API_REMOVED_ERROR)
- quote: "The Responses API exposed by OpenAI at `/v1/responses`."   (verbatim, source doc comment on `WireApi::Responses`, the enum's only variant)
- quote: "Custom providers can't reuse the reserved built-in provider IDs: `openai`, `ollama`, and `lmstudio`."   (one fetch of https://learn.chatgpt.com/docs/config-file/config-advanced)
- source: codex-rs/model-provider-info/src/lib.rs@2c3156a lines 100, 104-135 (`enum WireApi`, deserializer rejecting "chat"), 149-200 (`env_key`, `requires_openai_auth`) ; https://learn.chatgpt.com/docs/config-file/config-advanced, section "Custom model providers" ; read 2026-10-08
- strength: shown (code) and stated (docs)

### OAI13 H3-codex-2 Placeholder or injected credential
- finding: `env_key` names the environment variable that holds the key (docs examples: `env_key = "OPENAI_API_KEY"`, `"MISTRAL_API_KEY"`); the gateway's key can be injected as a header through `env_http_headers`, or fetched from a helper with `[model_providers.<id>.auth]` command; the code refuses to combine `auth` with `env_key`, `experimental_bearer_token` or `requires_openai_auth`. A provider with `requires_openai_auth = false` (default) skips Codex's own login screen.
- quote: "Don't combine `[model_providers.<id>.auth]` with `env_key`, `experimental_bearer_token`, or `requires_openai_auth`."   (one fetch of config-advanced; matches the conflict checks at model-provider-info/src/lib.rs lines 312-322 and 377-384)
- quote: "If false (the default), the login screen is skipped, and the API key (if needed) comes from the environment variable specified by `env_key`."   (verbatim, source doc comment, lib.rs lines 190-196)
- source: as above ; read 2026-10-08
- strength: shown (code) / stated (docs)

### OAI14 H3-codex-3 With a ChatGPT (subscription) login the CLI talks to the ChatGPT backend, not api.openai.com; a gateway must proxy that
- finding: When the auth mode is ChatGPT (or ChatGPT tokens, access token, agent identity, personal access token) the default base URL is `https://chatgpt.com/backend-api/codex`; with an API key it is `https://api.openai.com/v1`. A `base_url` set in config replaces either default. The enterprise page "Sign in with ChatGPT through a gateway" documents a gateway that keeps ChatGPT sign-in: `requires_openai_auth = true` in the provider block, the gateway receives the ChatGPT bearer token and account-id header, and must proxy `/models` and `/responses` to the ChatGPT backend. It sits in the Enterprise docs and names no plan.
- quote: "The gateway's Codex-compatible base URL must proxy /models and /responses to https://chatgpt.com/backend-api/codex"   (one fetch; wording partly confirmed by the code constant `CHATGPT_CODEX_BASE_URL`)
- quote: "Your gateway can see request data and both credentials."   (one fetch)
- quote: "Native gateway OAuth needs a browser and a reachable loopback callback. It has no device-code fallback."   (one fetch)
- source: https://learn.chatgpt.com/docs/enterprise/sign-in-with-chatgpt-through-a-gateway ; codex-rs/model-provider-info/src/lib.rs@2c3156a lines 80, 425-445 ; read 2026-10-08
- strength: stated (docs, single read) and shown (code)

### OAI15 H3-codex-4 Gateway compatibility page: the API/provider-credential path needs POST /v1/responses
- finding: OpenAI's gateway compatibility page for the API-key path says a gateway must accept `POST /v1/responses`; a working Chat Completions or Anthropic Messages endpoint does not establish Responses compatibility; WebSocket is optional; it does not say whether non-OpenAI models are supported, only that the upstream must support the model and the organisation must approve.
- quote: "the gateway must accept `POST /v1/responses`"   (one fetch of https://learn.chatgpt.com/docs/enterprise/gateway-compatibility)
- quote: "A working Chat Completions or Anthropic Messages endpoint doesn’t establish Responses compatibility."   (one fetch)
- source: https://learn.chatgpt.com/docs/enterprise/gateway-compatibility ; read 2026-10-08
- strength: stated (single read)

### OAI16 H3-codex-5 Amazon Bedrock lists the named models
- finding: The Codex source carries Bedrock model-id constants for the three models the study names: `openai.gpt-6-sol`, `openai.gpt-6-luna`, `openai.gpt-6-astra`, with a default base URL on `bedrock-mantle.us-east-1.api.aws`. This shows an API-billed path through AWS exists for the three models (not a login route).
- quote: "openai.gpt-6-luna"   (verbatim, constant AMAZON_BEDROCK_GPT_6_LUNA_MODEL_ID)
- source: codex-rs/model-provider-info/src/lib.rs@2c3156a lines 84-101 ; read 2026-10-08
- strength: shown (code)

### OAI17 H1-codex-7 Service accounts (Business/Enterprise "pay-as-you-go" workspaces) use the same CODEX_ACCESS_TOKEN route
- finding: A "service account" is a non-human workspace identity that owners/admins create; automation authenticates with `CODEX_ACCESS_TOKEN` and needs no browser; the page says service accounts exist only on pay-as-you-go plans, and tells CI to take the token from a secret manager. Needs Codex CLI 0.142.0 or later (paraphrase).
- quote: "Service accounts are available only on pay-as-you-go plans."   (one fetch of https://learn.chatgpt.com/docs/enterprise/service-accounts)
- quote: "On shared or temporary runners, use CODEX_ACCESS_TOKEN without saving a login."   (one fetch)
- source: https://learn.chatgpt.com/docs/enterprise/service-accounts ; no publication date (a sample table shows "Jul 23, 2026", not a page date) ; read 2026-10-08
- strength: stated (single read; the plan meaning of "pay-as-you-go plans" is not defined on the page)

### OAI18 H1-codex-8 Official "Sign in with ChatGPT" (SIWC) preview for third-party apps, including a remote-VM guide
- finding: OpenAI has a developer program, "Sign in with ChatGPT", where a third-party OPEN-SOURCE or locally hosted app can let eligible users spend their ChatGPT plan on Responses API requests (Codex app-server accepts such an OAuth access token). The docs include a page "Self-hosted VMs" for running an open-source app on a remote VM, which says to transfer protected credentials and keep a stable per-VM host id. For paid or remotely hosted apps the page points to an interest form (not a general permission). Preview limits listed: hosted tools unsupported, `store: false`, `stream: true`, no `previous_response_id`, host-specific usage attribution and revocation "not yet available". Eligibility, plans and rate limits are not stated on the pages read.
- quote: "If you're interested in offering it in a paid or remotely hosted app, complete the interest form."   (one fetch of https://developers.openai.com/siwc/token-sharing-open-source; second read due)
- quote: "Use this guide when you run an open-source app on a remote virtual machine (VM)."   (one fetch of .../self-hosted-vms)
- quote: "Host-specific usage attribution and revocation of ChatGPT plan access for transferred sessions are not yet available."   (one fetch of .../self-hosted-vms)
- source: https://developers.openai.com/siwc ; https://developers.openai.com/siwc/token-sharing-open-source ; .../self-hosted-vms ; .../preview-limitations ; .../codex-app-server ; none shows a date ; read 2026-10-08
- strength: stated (single reads)

### OAI19 H2-codex-6 Login tied to a machine, IP or device? Concurrency limit?
- finding: Nothing read ties a Codex ChatGPT login to a machine, IP or device. The CI page's rule (one auth.json per runner/serialized stream) is the only stated limit on sharing, and it is a refresh-token consequence, not a device binding. In the code, the refresh request sends only the refresh token and a client id (no device id, no IP), and `agent_identity` is a separate mode with its own runtime id and private key. No cap on concurrent Codex sessions per account was found on the pricing, usage-limit, auth or CI pages.
- quote: n/a
- source: codex-rs/login/src/auth/manager.rs@2c3156a lines 1627-1655 (refresh request body: `RefreshTokenGrant { refresh_token, resource: None }` plus client id); https://learn.chatgpt.com/docs/pricing (read twice; "does not state a number of concurrent tasks or parallel agents") ; https://learn.chatgpt.com/docs/enterprise/usage-limits (one read; automation/concurrency "NOT PRESENT") ; read 2026-10-08
- strength: not found. Searches: pricing page (2 reads) for "concurrent|parallel": 0 sentences; usage-limits page (1 read): 0 sentences; ci-cd-auth page (2 reads): no device/IP binding sentence; source grep of manager.rs for "device_id|machine_id|ip_addr": not run (the file was read around the refresh paths only).

### OAI20 H4-codex-0 openai.com policy pages are unreadable to this tool
- finding: Every openai.com/policies page I tried answered HTTP 403 to the fetch tool: terms-of-use, row-terms-of-use, eu-terms-of-use, service-terms, business-terms, services-agreement, usage-policies, and /de-DE/policies/terms-of-use. help.openai.com articles answered 403 as well (the "Using Codex with your ChatGPT plan" article and the Bedrock article). web.archive.org is blocked by the tool ("unable to fetch from web.archive.org"). Shell curl is limited to the allowlist, which has no openai.com host. So I have NO first-hand read of any OpenAI terms page. What I have: (1) the search tool result text (a search tool's summary, not the page); (2) third-party notes on GitHub that also report 403 and quote the clauses from search summaries.
- source: The fetch tool 403 on 2026-10-08 for each URL above
- strength: not found (as a read). Not proof the pages say nothing.

### OAI21 H4-codex-1 (a) subscription login from a cloud machine / CI / automated process -- what OpenAI's own Codex docs say
- finding: OpenAI's Codex CI/CD page does document running a ChatGPT-managed login (auth_mode "chatgpt") on a trusted CI/CD runner, calls it an advanced workflow for enterprise and other trusted private automation, but says API keys are the right way for automation and tells readers not to use it for public or open-source repositories. The same page says it applies "only if you specifically need to run the workflow as your Codex account". The docs do not say it is forbidden; the Terms were not read, so whether the Terms permit it is unknown to me.
- quote: "The right way to authenticate automation is with an API key."   (verbatim: two fetches, https://learn.chatgpt.com/docs/auth/ci-cd-auth)
- quote: "Use this guide only if you specifically need to run the workflow as your Codex account."   (verbatim: two fetches)
- quote: "This is an advanced workflow for enterprise and other trusted private automation."   (verbatim: two fetches)
- quote: "Do not use this workflow for public or open-source repositories."   (verbatim: two fetches of ci-cd-auth; also seen once on the non-interactive-mode page)
- source: https://learn.chatgpt.com/docs/auth/ci-cd-auth ; no date shown ; read 2026-10-08
- strength: stated. Applies to: ChatGPT subscription (managed) login. Verdict on the documents I could read: the CLI docs permit it as an advanced, trusted-runner option and discourage it; the Terms are unread.

### OAI22 H4-codex-2 What the Terms of Use say, as reported by a search tool (NOT a page read)
- finding: A search-tool summary says OpenAI's consumer Terms of Use (rest-of-world version, openai.com/policies/row-terms-of-use/) put account-sharing under "Registration and access" and list "Automatically or programmatically extract data or Output (defined below)" under "What you cannot do". Several unrelated GitHub research notes (2026-09/10) quote the same two phrases and say they too could not fetch openai.com (403).
- quote: "You may not share your account credentials or make your account available to anyone else and are responsible for all activities that occur under your account."   (paraphrase: The search tool tool's text, one query, vendor page not read)
- quote: "Automatically or programmatically extract data or Output (defined below)."   (paraphrase: The search tool tool's text; also quoted by third parties in c10dev/atc docs and others)
- source: The search tool 2026-10-08 ("OpenAI Terms of Use ... make your account available to anyone else"); the search tool said the cached results were "roughly 265 to 280 days" old and showed no effective date. Third-party: github.com/c10dev/atc docs/research/chatgpt-codex-accounts.md (2026-09-30; says wording "came through search summaries: unverified as exact text")
- strength: argued (not the vendor's page). Applies to: consumer ChatGPT accounts (Plus/Pro) per the ROW terms; the Business terms are a separate document I could not read.

### OAI23 H1-codex-9 Access tokens: Business and Enterprise only (second read agrees); what the token is in the CLI
- finding: Second fetch of the access-token page repeats the plan sentence; the page also says `codex login --with-access-token` stores an "agent identity credential" in Codex CLI auth storage, that ephemeral automation sets `CODEX_ACCESS_TOKEN`, and that public CI, forked pull requests or shared machines can expose tokens. The source has the same split: a token starting `at-` is a personal access token (validated by a whoami call), anything else is treated as an agent-identity JWT.
- quote: "Codex access tokens are currently supported for ChatGPT Business and Enterprise workspaces."   (verbatim: two fetches of https://learn.chatgpt.com/docs/enterprise/access-tokens)
- quote: "Use access tokens only on trusted runners."   (one fetch)
- quote: "public CI, forked pull requests, or shared machines can expose tokens to people outside your workspace."   (one fetch)
- source: https://learn.chatgpt.com/docs/enterprise/access-tokens ; codex-rs/login/src/auth/access_token.rs@2c3156a lines 1-14 ; read 2026-10-08
- strength: stated

### OAI24 H1-codex-10 Device-code login mechanics (code)
- finding: Device-code login asks `auth.openai.com/api/accounts/deviceauth/usercode`, shows a verification URL (`<base>/codex/device`) and a one-time code that "expires in 15 minutes", then polls `/deviceauth/token`; it gives up after 15 minutes. It needs a human to open the link in some browser (any device).
- quote: "Follow these steps to sign in with ChatGPT using device code authorization:"   (verbatim, source string)
- quote: "Enter this one-time code (expires in 15 minutes)"   (verbatim, source string, ANSI codes omitted)
- source: codex-rs/login/src/device_code_auth.rs@2c3156a lines 62-70, 100-147, 149-160 ; read 2026-10-08
- strength: shown (code)

### OAI25 H4-codex-3 (a) The Codex README itself recommends ChatGPT sign-in for plan use, and says API-key use needs extra setup
- finding: The open-source Codex README names the plans and recommends signing in with ChatGPT.
- quote: "We recommend signing into your ChatGPT account to use Codex as part of your Plus, Pro, Business, Edu, or Enterprise plan."   (verbatim, repository text)
- quote: "You can also use Codex with an API key, but this requires [additional setup]"   (verbatim, repository text)
- source: README.md@2c3156a lines 68-72 (github.com/openai/codex) ; read 2026-10-08
- strength: stated

### OAI26 H4-codex-4 (a) OpenAI's own GitHub Action for Codex supports only an API key
- finding: The README of github.com/openai/codex-action (commit bdf19a4, 2026-10-05) documents one credential input, `openai-api-key`; grep of the README and docs/security.md for "chatgpt|subscription|auth.json|sign in|login|oauth|access token" found 0 hits. The CLI docs page for the action also names only `OPENAI_API_KEY`. So OpenAI's own CI integration offers no ChatGPT-login path.
- quote: "Secret used to start the Responses API proxy when you are using OpenAI (default). Store it in `secrets`."   (verbatim, README table row for `openai-api-key`)
- source: https://github.com/openai/codex-action README.md@bdf19a4 line 103 ; https://learn.chatgpt.com/docs/github-action (one fetch) ; read 2026-10-08
- strength: shown. "not found" for subscription login in that repo: searches above, 0 hits.

### OAI27 H4-codex-5 (b) sharing a login to another machine or person, from the CLI docs
- finding: The docs treat copying `~/.codex/auth.json` to another machine as a supported fallback for one's own headless machine (H1-codex-3) but forbid sharing one copy across concurrent jobs or multiple machines (H2-codex-3), and say not to share the file in chat or tickets. The only stated reason is operational (rotation) and security, not a licensing term. Terms of Use wording on credential sharing: see H4-codex-2 (search-tool excerpt only).
- quote: "Don’t commit it, paste it into tickets, or share it in chat."   (verbatim: seen in first fetch of /docs/auth/ci-cd-auth; curly apostrophe as on the page)
- source: https://learn.chatgpt.com/docs/auth/ci-cd-auth ; read 2026-10-08
- strength: stated

### OAI28 H4-codex-6 (c) several simultaneous sessions or devices on one account
- finding: Not addressed in any Codex page read. The pricing page says the allowance is shared between local messages and cloud chats and lists "Subagents and custom agents" as a feature without a cap; weekly limits "may also apply".
- quote: "Local messages and cloud chats share your plan's usage allowance."   (verbatim: two fetches of https://learn.chatgpt.com/docs/pricing)
- source: https://learn.chatgpt.com/docs/pricing ; read 2026-10-08
- strength: not found (cap on simultaneous sessions/devices). Searches: pricing page (2 reads), usage-limits page (1 read), auth page (2 reads), CI page (2 reads): no sentence about number of simultaneous sessions or devices.

### OAI29 H5-codex-1 API key route headless
- finding: Pipe the key into the login store (`printenv OPENAI_API_KEY | codex login --with-api-key`), or set `CODEX_API_KEY` for a single `codex exec`/`codex review`/SDK run; the docs add "Do not set `OPENAI_API_KEY` or `CODEX_API_KEY` as a job-level environment variable" (sentence cut off in the summary). API keys are billed at standard API rates, work with `codex exec`, the CLI, the SDK and the IDE extension, but not with cloud features.
- quote: "To use a different API key for a single run, set `CODEX_API_KEY` inline:"   (one fetch of https://learn.chatgpt.com/docs/non-interactive-mode)
- quote: "All users may also run extra local chats using an API key, with usage charged at standard API rates."   (verbatim: two fetches of https://learn.chatgpt.com/docs/pricing)
- source: https://learn.chatgpt.com/docs/non-interactive-mode ; https://learn.chatgpt.com/docs/pricing ; codex-rs/cli/src/main.rs@2c3156a lines 520-545 ; read 2026-10-08
- strength: stated

### OAI30 H5-codex-2 API prices per 1M tokens for gpt-6-luna, gpt-6-sol, gpt-6-astra (USD; page https://developers.openai.com/api/docs/pricing; two reads agree on the shared columns; page shows no date except a note that "Priority processing was renamed Fast mode on July 30, 2026")
- finding: Text-token rates, short context (input up to 272K tokens; "Long context" is above 272K and has its own columns):
  | model | tier | input | cached input | cache writes | output |
  | gpt-6-luna | Standard | $0.10 | $0.01 | $0.125 | $0.50 |
  | gpt-6-sol | Standard | $2.00 | $0.20 | $2.50 | $10.00 |
  | gpt-6-astra | Standard | $10.00 | $1.00 | $12.50 | $50.00 |
  | gpt-6-luna | Batch / Flex (same) | $0.05 | $0.005 | $0.0625 | $0.25 |
  | gpt-6-sol | Batch / Flex | $1.00 | $0.10 | $1.25 | $5.00 |
  | gpt-6-astra | Batch / Flex | $5.00 | $0.50 | $6.25 | $25.00 |
  | gpt-6-luna | Fast (formerly Priority) | $0.20 | $0.02 | $0.25 | $1.00 |
  | gpt-6-sol | Fast | $4.00 | $0.40 | $5.00 | $20.00 |
  | gpt-6-astra | Fast | $20.00 | $2.00 | $25.00 | $100.00 |
  Long context (> 272K input tokens), Standard: luna $0.20 / $0.02 / $0.25 / $0.75; sol $4.00 / $0.40 / $5.00 / $15.00; astra $20.00 / $2.00 / $25.00 / $75.00 (input / cached / cache write / output). gpt-6.1-sol is also listed ($2.00 / $0.10 / $2.50 / $10.00 standard short context) and has an extra Ultrafast tier; the study's three models have no Ultrafast row except astra ($60 / $6 / $75 / $300 short context).
  Notes: "Regional processing (data residency) endpoints are charged a 10% uplift for models released on or after March 5, 2026." FedRAMP endpoints also 10% uplift.
- quote: "| gpt-6-luna | $0.10 | $0.01 | $0.125 | $0.50 | $0.20 | $0.02 | $0.25 | $0.75 |"   (verbatim row, second fetch, Standard tab: short input, short cached, short cache write, short output, long input, long cached, long cache write, long output)
- source: https://developers.openai.com/api/docs/pricing (platform.openai.com/docs/pricing answers 301 to it) ; read 2026-10-08 (two fetches)
- strength: stated. Caveat, RESOLVED later in this file (H5-codex-4): the API Models overview page (https://developers.openai.com/api/docs/models, one fetch) did not list gpt-6-sol, but each of the three models has its own page (.../api/docs/models/gpt-6-sol, -luna, -astra, one fetch each) and those pages give the same three prices as the pricing page.

### OAI31 H5-codex-3 Codex's own credit table (plan credits, not dollars) for the three models, per 1M tokens
- finding: Credits per 1M tokens (input | cached input | output): GPT-6 Luna 2.5 | 0.25 | 12.5; GPT-6 Sol 50 | 5 | 250; GPT-6 Astra 250 | 25 | 1,250. Price per credit is not on the page.
- quote: "GPT-6 Luna | 2.5 credits | 0.25 credits | 12.5 credits"   (verbatim: two fetches of https://learn.chatgpt.com/docs/pricing)
- source: https://learn.chatgpt.com/docs/pricing ; no date ; read 2026-10-08
- strength: stated

### OAI32 H6-codex-1 What the pricing page says per plan (all quotes verbatim, two fetches)
- finding: Plus and Standard Business: local-message estimates per five-hour period by model (GPT-6 Astra 5-45, GPT-6.1 Sol 15-160, GPT-6 Sol 15-150, GPT-6 Luna 350-3,000); Pro: no five-hour limit; weekly limits may apply; local messages and cloud chats share one allowance; cloud tasks may use more than local messages; Enterprise/Edu with flexible pricing: no fixed rate limits; without it: same per-seat limits as Plus for most features. Business/Enterprise usage-limits page: limits and spend controls apply to "eligible activity", "don't cover all Codex usage". No sentence about automated or background use limits; "Scheduled tasks" is listed as a local feature; "Codex access tokens for trusted automation" is a feature-table row.
- quote: "Pro plans currently have no five-hour limit."   (verbatim, two fetches)
- quote: "Weekly limits may also apply."   (verbatim, two fetches)
- quote: "Enterprise/Edu users with flexible pricing have no fixed rate limits."   (one fetch)
- quote: "They don't cover all Codex usage or govern OpenAI API Platform billing."   (one fetch of https://learn.chatgpt.com/docs/enterprise/usage-limits)
- source: https://learn.chatgpt.com/docs/pricing ; https://learn.chatgpt.com/docs/enterprise/usage-limits ; no dates ; read 2026-10-08
- strength: stated

### OAI33 H4-codex-2b (a)(b)(d) OpenAI consumer terms (Plus, Pro): credentials, programmatic extraction, rate limits
- finding: The consumer Terms of Use (EU text) say you may not share your credentials or make your account available to anyone else; list "Automatically or programmatically extracting data or Output" among prohibited acts; and forbid circumventing rate limits or restrictions. None of these sentences names Codex, CI, containers, several machines for one person, or ChatGPT-plan use from another tool. Section 4 of the Terms says only that Codex output "may be subject to third party licenses". The sentence on programmatic extraction is about extracting data or Output (scraping-like); whether `codex exec` in a job is within it is not answered by the page (ambiguity). The Terms point businesses to the Business Terms.
- quote: "You may not share your account credentials or make your account available to anyone else and are responsible for all activities that occur under your account."   (verbatim in the archive copy of the EU terms; same words returned by the search tool for the ROW terms)
- quote: "Automatically or programmatically extracting data or Output (defined below)."   (verbatim in the archive copy; ROW version per the search tool reads "extract")
- quote: "Interfering with or disrupting our Services, including circumventing any rate limits or restrictions or bypassing any protective measures or safety mitigations we put on our Services."   (verbatim, archive copy)
- quote: "Our Business Terms govern use of ChatGPT Enterprise, our APIs, and our other services for businesses and developers."   (verbatim, archive copy)
- source: https://openai.com/policies/eu-terms-of-use/ as captured in OpenTermsArchive/genai-contrib-versions ChatGPT/Terms of Service.md@5f624c86c2 lines 51, 68, 72 (section "Registration and access", "What you cannot do"), line 284 (section "4. Codex and Code Generation") ; read 2026-10-08
- strength: shown (third-party archive copy of the vendor page; the live page itself is unread). Applies to: consumer ChatGPT accounts (Plus, Pro) in the EEA/Switzerland/UK; the ROW version not read.

### OAI34 H4-codex-2c (a)(b)(c) OpenAI Services Agreement (API, ChatGPT Business, Enterprise): credentials not shared between users; one End User per account; no circumventing Usage Limits
- finding: The Services Agreement, which "only applies to use of OpenAI's APIs, ChatGPT Enterprise, ChatGPT Business, ChatGPT for Clinicians...", says Customer will not share account or individual login credentials between multiple users, may not resell or lease account access, each End User Account is for a single End User, and Customer may not "violate or circumvent Usage Limits". It restricts "extract data from the Services other than as permitted through the Services" and buying/selling API keys. It does not mention Codex, CI, containers or number of devices. "Usage Limits" are defined as limits "as described in the applicable Order Form or Documentation".
- quote: "Customer will not share Account access credentials or individual login credentials between multiple users. Customer may not resell or lease access to its Account or any End User Account."   (verbatim, archive copy, clause 3.1)
- quote: "End User Accounts may only be provisioned to, registered for, and used by, a single End User."   (verbatim, clause 3.2)
- quote: "(i) violate or circumvent Usage Limits or otherwise configure the Services to avoid Usage Limits."   (verbatim, clause 3.3(i); 3.3(f) "extract data from the Services other than as permitted through the Services", 3.3(g) "buy, sell, or transfer API keys from, to, or with a third party")
- quote: "“Usage Limits” means End User, messaging, token, throughput rate, or other limits on Customer’s use of the Services as described in the applicable Order Form or Documentation."   (verbatim, definition)
- source: https://openai.com/policies/services-agreement/ (403 to the fetch tool) as captured in OpenTermsArchive/genai-contrib-versions ChatGPT/Commercial Terms.md@87eaac64c1 lines 51, 53, 55, 354 ; read 2026-10-08
- strength: shown (third-party archive copy). Applies to: API keys and Business/Enterprise workspaces; not to Plus/Pro.

### OAI35 H4-codex-2d OpenAI Usage policies: circumventing restrictions (agents)
- finding: Usage policies (effective October 29, 2025) contain a short section "Circumventing Restrictions and Safeguards": "ChatGPT agent users are not allowed to bypass rate limits, restrictions, or safety measures on our services." No sentence on credentials or devices.
- quote: "ChatGPT agent users are not allowed to bypass rate limits, restrictions, or safety measures on our services."   (verbatim, archive copy, line 138)
- source: https://openai.com/policies/usage-policies/ as captured in OpenTermsArchive/genai-contrib-versions ChatGPT/Acceptable Use Policy.md ; read 2026-10-08
- strength: shown (third-party archive copy)

### OAI36 H4-codex-8 Plain verdict for the Codex side (what the documents read permit, forbid, or leave unsaid)
- permit (stated by OpenAI): copying one's own `auth.json` to one's own headless machine (docs/auth); running a ChatGPT-managed login on a trusted private CI runner as an advanced option, with one auth.json per runner (docs/auth/ci-cd-auth); Codex access tokens and service accounts for non-interactive automation on Business/Enterprise workspaces; API keys, the documented default for automation; SIWC preview for open-source apps incl. on a remote VM.
- discourage/forbid (stated by OpenAI): sharing one auth.json across concurrent jobs or machines; use of the ChatGPT-managed CI workflow for public or open-source repositories; exposing access tokens on public CI or forked pull requests; the consumer Terms bar sharing credentials with, or making the account available to, anyone else; the Services Agreement bars sharing login credentials between multiple users.
- not said in any document I could read: whether a Plus/Pro login may run in a vendor-neutral cloud container; whether one person's login may be used from several machines at once; whether `codex exec` counts as "automatically or programmatically extracting data or Output"; a cap on simultaneous sessions.
- strength: argued (summary of the entries above)

### OAI37 H3-codex-6 OpenAI ships a credential-injecting proxy for the API-key route (`codex-responses-api-proxy`)
- finding: The open-source Codex repo contains `codex-responses-api-proxy`, "a strict HTTP proxy that only forwards POST requests to /v1/responses to the OpenAI API", reading the API key from stdin and setting `Authorization: Bearer <key>` itself, so the Codex process holds no key; `--upstream-url` lets it forward elsewhere (README example: Azure). Codex is pointed at it with a `[model_providers.<id>]` block (`base_url = 'http://127.0.0.1:<port>/v1'`, `wire_api='responses'`). The OpenAI GitHub Action starts it whenever an `openai-api-key` is given. It speaks the Responses format, authenticates with a bearer API key, and is documented for the API-key route only (the README says nothing about ChatGPT-login tokens).
- quote: "A strict HTTP proxy that only forwards `POST` requests to `/v1/responses` to the OpenAI API (`https://api.openai.com`), injecting the `Authorization: Bearer $OPENAI_API_KEY` header. Everything else is rejected with `403 Forbidden`."   (verbatim, repository text; 46 words)
- quote: "`--upstream-url <URL>`: Absolute URL to forward requests to. Defaults to `https://api.openai.com/v1/responses`."   (verbatim, repository text)
- source: codex-rs/responses-api-proxy/README.md@2c3156a lines 29, 70-95 ; https://github.com/openai/codex-action README.md@bdf19a4 lines 103, 202, 212 ; read 2026-10-08
- strength: stated / shown

### OAI38 H4-codex-9 Codex app-server authentication "has never been permitted for commercial or hosted services"  (NEW, deciding sentence for (a) and (d))
- finding: The Codex App Server page, under "Auth endpoints", says apps built on app-server authentication (the login types `apiKey`, `chatgpt`, `chatgptDeviceCode` and the experimental host-supplied `chatgptAuthTokens`) may continue if they are local or open-source, that app-server authentication "has never been permitted for commercial or hosted services", and that OpenAI launched "Sign in with ChatGPT" for those cases, with a partner waitlist. Host-supplied tokens: "intended for host apps that already own the user's ChatGPT auth lifecycle"; the server may ask the host for refreshed tokens after a 401. The sentence is about authentication through the app-server, not about `codex exec`. "Hosted" is not defined on the page (ambiguity: a container on a cloud account the user owns is hosted infrastructure; whether it is a "hosted service" is not said).
- quote: "App-server authentication has never been permitted for commercial or hosted services."   (verbatim: two fetches of https://learn.chatgpt.com/docs/app-server, text offset 100000, heading "Auth endpoints")
- quote: "If you’ve built a local or open-source application using Codex app-server authentication, you can continue using it,"   (verbatim: second fetch; the tool returned the sentence in two fragments, first part shown; continues "though we recommend migrating to Sign in with ChatGPT so users have greater control over and visibility into their usage.")
- quote: "experimental and intended for host apps that already own the user's ChatGPT auth lifecycle."   (one fetch, same page)
- source: https://learn.chatgpt.com/docs/app-server (page length 140,706 characters; read in two windows) ; no date ; read 2026-10-08
- strength: stated. Applies to: ChatGPT-subscription authentication through app-server (and API-key login through app-server, per the same section).

### OAI39 H3-codex-3b / H3-codex-4b Gateway pages: second reads agree
- quote: "The gateway’s Codex-compatible base URL must proxy `/models` and `/responses` to `https://chatgpt.com/backend-api/codex`."   (verbatim, two fetches of https://learn.chatgpt.com/docs/enterprise/sign-in-with-chatgpt-through-a-gateway)
- quote: "Codex sends the ChatGPT `Authorization` header, any `ChatGPT-Account-ID` header, and the gateway header or cookie."   (verbatim, two fetches)
- quote: "Your gateway can see request data and both credentials."   (verbatim, two fetches)
- quote: "Codex does not rerun it or refresh this header; when the key expires, obtain a new key and relaunch."   (verbatim, one fetch; about the gateway-key helper)
- quote: "These requirements cover the API/provider credential path through a gateway."   (verbatim, two fetches of https://learn.chatgpt.com/docs/enterprise/gateway-compatibility)
- quote: "A working Chat Completions or Anthropic Messages endpoint doesn’t establish Responses compatibility."   (verbatim, two fetches)
- quote: "If you enable WebSocket or incremental transport, verify its previous_response_id behavior too."   (verbatim, one fetch)
- strength: stated

### OAI40 H1-codex-6b Non-interactive page: second read agrees, with the headings
- quote: "`codex exec` reuses saved CLI authentication by default. In CI, it’s common to provide credentials explicitly:"   (verbatim, two fetches; heading "Authenticate in automation")
- quote: "API keys are the right default for automation because they are simpler to provision and rotate."   (verbatim, two fetches; sits under the heading "Use ChatGPT-managed auth in CI/CD (advanced)")
- quote: "Do not set `OPENAI_API_KEY` or `CODEX_API_KEY` as a job-level environment variable"   (verbatim start of the sentence, two fetches; under "Use API key auth"; the tool truncated the rest)
- quote: "Do not use this workflow for public or open-source repositories."   (verbatim, three fetches in all)
- source: https://learn.chatgpt.com/docs/non-interactive-mode ; read 2026-10-08
- strength: stated

### OAI41 H2-codex-7 Access-token and API-key logins do not refresh; ChatGPT-managed logins do
- finding: In the Codex code a refresh request returns at once (no network call) when the current auth is an API key or a personal access token, and the agent-identity mode is also listed under "Ok(())" in `refresh_token_from_authority_impl`; only the ChatGPT-managed token pair (`auth.json` `tokens`) is refreshed against `auth.openai.com/oauth/token`. So the refresh-token conflict between copies applies to managed ChatGPT logins, not to `CODEX_API_KEY` or `CODEX_ACCESS_TOKEN`. Agent identity registers an agent runtime and a per-run task id with the auth service.
- quote: ".is_some_and(|auth| auth.is_api_key_auth() || auth.is_personal_access_token_auth())\n        {\n            return Ok(());"   (verbatim source lines 2853-2857, whitespace trimmed; the enclosing function is `refresh_token`)
- source: codex-rs/login/src/auth/manager.rs@2c3156a lines 2851-2858, 2905-2925 ; codex-rs/login/src/auth/agent_identity.rs@2c3156a lines 140-150, 344-390 ; read 2026-10-08
- strength: shown (code)

### OAI42 H2-codex-8 Argued: how the documented rules apply to several lanes
- finding: OpenAI's CI page allows one `auth.json` per runner or per serialized workflow stream, and shows that two machines that each hold a copy of one refresh-token chain collide ("another machine or concurrent job rotated the token first"). Taken together, N parallel containers each need their own login (their own refresh-token chain) or a non-refreshing credential (API key, access token). Nothing read says whether OpenAI limits how many separate `codex login` sessions one ChatGPT account may hold, or whether each `codex login` creates an independent chain; the docs are silent.
- source: argued from H2-codex-2, H2-codex-3, H2-codex-7 (documents named there)
- strength: argued

### OAI43 H4-not-found-controls Greps over the archived terms (full text) with controls
- finding: Counts of whole-text matches, case-insensitive, in the Open Terms Archive copies (OpenAI EU Terms of Use, header "Updated: 16 January 2026"; OpenAI Services Agreement "Effective: January 1, 2026"; Anthropic Consumer Terms "Effective October 8, 2025"; Anthropic Commercial Terms "Effective June 17, 2025"):
  | term | OpenAI ToU | OpenAI Services Agr. | Anthropic Consumer | Anthropic Commercial |
  | simultaneous | 0 | 0 | 0 | 0 |
  | concurrent | 0 | 1 ("concurrently", unrelated: services-term proration) | 0 | 0 |
  | device | 1 (in vitro diagnostic devices, unrelated) | 0 | 0 | 0 |
  | IP address | 0 | 0 | 0 | 0 |
  | CI/CD, continuous integration | 0 | 0 | 0 | 0 |
  | container, cloud, virtual machine | container 1, cloud 1 (both in the "Licensed Materials" clause, below), VM 0 | 0 | 0 | 0 |
  | Claude Code | 0 | 0 | 0 | 0 |
  | Codex | 3 (code-generation clause and links) | 0 | 0 | 0 |
  Positive controls through the same command: "multiple users" returns 1 in the Services Agreement (clause 3.1); "automated or non-human" returns 1 in the Anthropic Consumer Terms (item 7); "Codex" returns 3 in the OpenAI Terms of Use.
  So none of the four documents (as archived) mentions simultaneous sessions, devices, IP addresses, CI, Claude Code, or machine/cloud limits for a login. Neither Anthropic document mentions Claude Code at all; the Claude Code link to the Terms is on the Claude Code legal page.
- source: the archive copies of the four documents (OpenTermsArchive/genai-contrib-versions, commits 5f624c86c2, 87eaac64c1, 2de35b9576, 817278488c) ; read 2026-10-08
- strength: not found (as a negative result over third-party copies; the live pages themselves were read only for Anthropic)

### OAI44 H4-codex-11 OpenAI consumer terms, section "10. Licensed Materials": downloaded software may run on "private cloud infrastructure" (ambiguous relevance)
- finding: A clause in the EU Terms of Use says Services may involve downloading "software, packages, code, containers, or other modules" ("Licensed Materials") to "local machines, private cloud infrastructure, or other customer-managed systems (Customer Systems)", licensed "solely on Customer Systems", only "in connection with your permitted use of the Services". It names neither Codex nor the CLI (the Codex CLI is a separate open-source repository), so whether it governs the Codex CLI is not said.
- quote: "on local machines, private cloud infrastructure, or other customer-managed systems (“Customer Systems”)"   (verbatim, archive copy line 339)
- quote: "You may access and use the Licensed Materials solely for the purposes of using the Licensed Materials with or connecting to the Services."   (verbatim, archive copy, clause 10(b))
- source: OpenTermsArchive/genai-contrib-versions ChatGPT/Terms of Service.md@5f624c86c2 lines 335-345 (https://openai.com/policies/eu-terms-of-use/) ; read 2026-10-08
- strength: shown (third-party archive copy)

### OAI45 H2-codex-9 SIWC token lifetimes and rotation (vendor developer docs; same issuer as the Codex CLI, but a different program)
- finding: OpenAI's SIWC "Token reference" page says access tokens last one hour, refresh tokens 30 days, and "each successful refresh returns a replacement refresh token with a fresh 30-day lifetime"; the "Accounts and sessions" page says to "Store and use the latest replacement" refresh token and to serialize refreshes so "two processes do not race a rotating token". Both pages are for the SIWC client, not the Codex CLI's own client id (the CLI uses a constant client id against the same `auth.openai.com/oauth/token`); applying the lifetimes to the CLI's `auth.json` is my inference. The pages do not say whether an old refresh token stays valid after a refresh, and give no error codes for reuse.
- quote: "Access tokens are valid for one hour (`expires_in: 3600`)."   (verbatim, one fetch of https://developers.openai.com/siwc/token-sharing-open-source/token-reference)
- quote: "Each successful refresh returns a replacement refresh token with a fresh 30-day lifetime."   (verbatim, one fetch, same page)
- quote: "so two processes do not race a rotating token"   (verbatim fragment, one fetch of .../profiles-and-sessions; the page tells apps to "serialize refreshes for the same session")
- source: the two pages above ; no dates ; read 2026-10-08
- strength: stated (SIWC); argued for the Codex CLI

### OAI46 H4-codex-12 SIWC Terms (openai.com/policies/sign-in-with-chatgpt-terms/): clauses reported by a search tool, page itself 403
- finding: A search-tool summary (2026-10-08) of OpenAI's "Sign in with ChatGPT Terms" reports these clauses, all about apps built on SIWC (not about the Codex CLI's own login): a ban on "creating multiple accounts, splitting usage, rotating accounts, or otherwise bypassing usage limits"; a ban on pooling, transferring, reselling, gifting or sharing plan usage or tokens; a ban on using one user's subscription to fulfil another user's requests; requests must be for the authenticated user and arise from their activity "or expressly authorized automations or background processes", with express consent for background use; use the plan only for the application the user connected; and "Any persistent storage of Authentication Tokens must be local and under the user's control, not in a remote or managed environment." I could not read the page (HTTP 403) and the summary skips section 3, so these are search-tool paraphrases; a third-party note (aelaguiz/aimgr, 2026-09-29) quotes similar fragments and says the terms "appear to have been published on 2026-09-29".
- quote: "Any persistent storage of Authentication Tokens must be local and under the user's control, not in a remote or managed environment."   (paraphrase: search-tool summary text; page unread)
- quote: "Requests must be for the authenticated user and arise from their activity or expressly authorized automations or background processes."   (paraphrase: search-tool summary text; page unread)
- source: The search tool 2026-10-08 (query on SIWC terms, results listed https://openai.com/policies/sign-in-with-chatgpt-terms/ and help.openai.com articles 20001410 and 20001542); third party https://github.com/aelaguiz/aimgr docs/CODEX_PRO11_PRO13_DEACTIVATION_ANALYSIS_2026-09-29.md lines 36, 123-129
- strength: argued (search-tool excerpt only)

### OAI47 H4-codex-13 SIWC eligibility on the cookbook page (vendor-hosted developer page)
- finding: The OpenAI cookbook article says ChatGPT plan usage is available "to open-source projects, personal projects that run locally", that eligible Plus and Pro users can try such a tool, and that for a "paid or remotely hosted app" the developer must join a waitlist first.
- quote: "If you're building a paid or remotely hosted app, join the waitlist to request access before offering it to users."   (one fetch of https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)
- quote: "The ChatGPT plan usage integration described here is available for open-source tools and personal projects that run locally."   (one fetch)
- source: https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt ; no date shown ; read 2026-10-08
- strength: stated (single read)

### OAI48 H5-codex-4 Model pages for the three models (third read of the prices; adds endpoints and API rate limits)
- finding: Each model has a page under https://developers.openai.com/api/docs/models/<id>: context window 1,050,000 tokens and max output 128,000 tokens for all three; knowledge cutoff gpt-6-luna May 18, 2026, gpt-6-sol Apr 20, 2026, gpt-6-astra Apr 30, 2026; endpoints: Responses (`v1/responses`) and Chat Completions (`v1/chat/completions`) are both supported by the API (the Codex CLI itself accepts only the Responses format: H3-codex-1); default rate limits (Standard): gpt-6-sol and gpt-6-astra Build 5,000 RPM / 1,000,000 TPM, Launch 10,000 RPM / 4,000,000 TPM, Grow 15,000 RPM / 40,000,000 TPM; gpt-6-luna Build 5,000 RPM / 2,000,000 TPM, Launch 10,000 RPM / 10,000,000 TPM, Grow 30,000 RPM / 180,000,000 TPM. Prices on these pages equal the pricing page (luna $0.1 / $0.01 / $0.5; sol $2 / $0.20 / $10; astra $10 / $1 / $50 per 1M tokens: input / cached input / output).
- quote: "GPT-6 Sol ... Input is $2, cached input is $0.2, and output is $10."   (paraphrase of the tool's rendering of the page; the tool did not return a table row for sol's price)
- source: https://developers.openai.com/api/docs/models/gpt-6-sol ; .../gpt-6-luna ; .../gpt-6-astra ; no dates ; read 2026-10-08
- strength: stated (one fetch per page; prices now read three times across pricing page twice and model pages once)

### OAI49 H1-codex-12 Codex has a workload-identity route too (source only; docs page not found)
- finding: The Codex source reads `OPENAI_FEDERATION_RULE_ID`, `OPENAI_IDENTITY_TOKEN_FILE` and `OPENAI_WORKLOAD_IDENTITY_CONTEXT` and exchanges the identity-token file at `auth.openai.com/oauth/token`; it requires "a login policy that permits ChatGPT authentication". I found no Codex documentation page for it (learn.chatgpt.com/llms.txt filtered for workload, federation, OIDC, identity: 0 matching titles), so what it unlocks (ChatGPT-workspace access vs API) is not stated in anything I read.
- quote: "workload identity requires a login policy that permits ChatGPT authentication"   (verbatim, source error string)
- source: codex-rs/login/src/auth/workload_identity.rs@2c3156a lines 12-14, 140-160 ; codex-rs/protocol/src/shell_environment.rs@2c3156a lines 10-12 ; read 2026-10-08
- strength: shown (code); docs: not found

### OAI50 H4-codex-6b OpenAI Account Sharing Policy (help centre): several devices allowed, usage limits may apply  [search-tool summary; page 403]
- finding: The search tool's summary of the help-centre article "OpenAI Account Sharing Policy" (help.openai.com/en/articles/10471989) says an account is meant only for the person who created it, that one may use it on several devices, that "usage limits may apply depending on your account activity and subscription level", and that it found no stated cap on simultaneous sessions; for ChatGPT Business the usage terms list "Sharing your account credentials or making your account available to anyone else" as prohibited. The fetch tool gets HTTP 403 on that article and on "Can I access my ChatGPT subscription from another device?" (8980438), so the wording is the search tool's, not the page's.
- quote: "usage limits may apply depending on your account activity and subscription level"   (paraphrase: search-tool wording; page unread)
- source: The search tool 2026-10-08 (allowed_domains help.openai.com) ; https://help.openai.com/en/articles/10471989-openai-account-sharing-policy (403)
- strength: argued (search-tool summary only)

### OAI51 H4-geo Supported locations (side finding; both vendors)
- finding: Anthropic's Supported Regions Policy page says the products "are available only in the countries and regions listed below" and excludes "Use by persons while physically located in an unsupported region"; it does not mention cloud servers or VPNs (one fetch, no date, "© 2026 Anthropic PBC"). OpenAI's Services Agreement (archive copy, "Effective: January 1, 2026") says "Customer and End Users may not access or offer access to the Services outside of the Supported Countries and Territories." Neither text says where a cloud container's location counts.
- quote: "Customer and End Users may not access or offer access to the Services outside of the Supported Countries and Territories."   (verbatim, archive copy, clause 16.12)
- quote: "are available only in the countries and regions listed below."   (verbatim fragment, one fetch of https://www.anthropic.com/supported-countries)
- source: https://www.anthropic.com/supported-countries ; OpenTermsArchive/genai-contrib-versions ChatGPT/Commercial Terms.md@87eaac64c1 line 224 ; the Anthropic Consumer and Commercial Terms incorporate the policy (archive copies lines 45 and 36) ; read 2026-10-08
- strength: stated

### OAI52 H1-codex-13 Exact sentences on refresh, device code, API key and copying
- finding: The Codex authentication page states, in full sentences, that managed ChatGPT sessions refresh automatically during use, that device code login must be enabled by the user (personal) or a workspace admin, that API-key authentication is the page's advice for CI/CD, and that copying the cached credentials to a headless machine is allowed after logging in elsewhere.
- quote: "For sign in with ChatGPT sessions, Codex refreshes tokens automatically during use before they expire, so active sessions usually continue without requiring another browser login."   (verbatim, two fetches of https://learn.chatgpt.com/docs/auth; the tool returned it in two pieces both times)
- quote: "Enable device code login in your ChatGPT security settings (personal account) or ChatGPT workspace permissions (workspace admin)."   (verbatim, two fetches)
- quote: "Use API key authentication for programmatic Codex CLI workflows, such as CI/CD jobs."   (verbatim, two fetches)
- quote: "If you can complete the login flow on a machine with a browser, you can copy your cached credentials to the headless machine."   (verbatim, two fetches)
- quote: "Codex cloud requires signing in with ChatGPT."   (verbatim, two fetches)
- source: https://learn.chatgpt.com/docs/auth (formerly https://developers.openai.com/codex/auth) ; no date shown ; read 2026-10-08
- strength: stated

### OAI53 H4-codex-2e OpenAI rest-of-world Terms of Use, read through a public text converter (effective January 1, 2026)
- finding: The page openai.com/policies/row-terms-of-use answers HTTP 403 to the fetch tool. The same page, fetched through a public text converter (a third-party service that fetches the vendor's page and returns its text), was read twice with two differently worded requests, and the two reads agree on every sentence quoted below. The page shows "Effective: January 1, 2026"; the second read adds that the line links a previous version, 2024-12-11. The second read found the programmatic-extraction item the only item under "What you cannot do" that mentions extracting data, scraping, or automated or programmatic access. The Open Terms Archive copy of the EU Terms of Use (entry H4-codex-2b) reads "extracting" where this page reads "extract". Neither read was asked whether the page names Codex or command-line tools, so the entry says nothing on that. A converter is not the vendor's server, so the read is marked shown, not stated.
- quote: "Effective: January 1, 2026" (verbatim, two reads through the converter) ; "Automatically or programmatically extract data or Output (defined below)." (verbatim, same) ; "Use Output to develop models that compete with OpenAI." (paraphrase: one read) ; "Our Business Terms govern use of ChatGPT Enterprise, our APIs, and our other services for businesses and developers." (verbatim, same two reads) ; "You may not share your account credentials or make your account available to anyone else" (verbatim, same two reads; the fetch tool cut the sentence there, and both reads give its end as "and are responsible for all activities that occur under your account." outside quotation marks, so the end counts as paraphrase)
- source: the vendor's page https://openai.com/policies/row-terms-of-use/ fetched through a public text converter service (third party) ; read 2026-10-08
- strength: shown
