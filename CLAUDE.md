<!-- GSD:project-start source:PROJECT.md -->
## Project

**PR-BOT**

A Slack bot that posts high-signal notifications about pull request activity for ~10 repositories maintained by a team of ~15 people. It pings the right people when something is worth their attention (PR opened, comments, reviews, merges) and stays quiet otherwise — minimizing noise to teammates who aren't involved in a given PR.

**Core Value:** The right humans get notified about PR-worthy events; everyone else stays undisturbed. Signal over noise — if the bot becomes noisy, it's failing.

### Constraints

- **Budget:** $0 — must run on free tiers only. No paid hosting, no SaaS state stores
- **Tech stack:** GitHub Actions runtime — language is whatever runs cleanly there (TypeScript/Node, Python, or shell + `gh` CLI). Final language pick deferred to research/planning
- **Hosting model:** GitHub Actions reusable workflows. No long-lived servers, no Slack slash commands (which need a public endpoint)
- **State:** Hidden HTML marker in PR body — no external KV, no DB
- **Permissions:** Slack bot needs `chat:write` for the team channel; GitHub workflows need `pull-requests: write` to edit the PR body and `contents: read` to fetch metadata
- **Distribution:** ~10 repos must each carry one tiny caller workflow file. Updating bot logic must not require editing all 10 repos (reusable workflow with versioned ref handles this)
- **Privacy:** Bot must not echo comment or review body content into Slack — only the *fact* that an event happened plus the actor
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## TL;DR — What We're Actually Picking
## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Node.js** | 22 LTS | Action runtime | GitHub Actions runners ship Node 22; `setup-node@v6` defaults to it; `@slack/web-api@7` requires Node ≥18 |
| **TypeScript** | 6.0.3 | Language | Type-safe Octokit + Slack clients; the WebClient method types alone catch ~half the bugs you'd otherwise hit at runtime |
| **JavaScript Action** (`action.yml` with `runs.using: node20` or `node24`) | n/a | Packaging model | Inline scripts in YAML can't be unit-tested and don't get type checking; a JS action gives us a real codebase that ships as a bundle. Note: `node22` is NOT a supported `runs.using` value — the runner machine runs Node 22 LTS but the action declaration must be `node20` (deprecated track) or `node24` (current default since June 2, 2026). Verified 2026-05-06; see Phase 2 RESEARCH Pitfall 6. |
| **Reusable workflow** (`.github/workflows/notify.yml` with `on.workflow_call`) | n/a | Distribution model | Lets one repo own the logic for ten — caller workflows are 5-line stubs that pin a version |
| **Single-file bundle via `@vercel/ncc`** | 0.38.x | Build output | Avoids `npm install` on every runner invocation; ships `dist/index.js` with all deps inlined → ~3-5s startup vs 30-50s with install |
### Supporting Libraries (runtime)
| Library | Version (verified 2026-05-05) | Purpose | When to Use |
|---------|--------------------------------|---------|-------------|
| **`@slack/web-api`** | 7.15.2 | Slack Web API client | All Slack calls. Typed methods, built-in retry/queueing/rate-limit handling. `client.chat.postMessage({ channel, text })` for root, same call with `thread_ts` for replies, `client.conversations.replies` if we ever need to refetch (we shouldn't — `ts` round-trips through PR body) |
| **`@actions/github`** | 9.1.1 | Octokit client preconfigured with `GITHUB_TOKEN` | All GitHub calls — read PR (`pulls.get`), patch PR body (`pulls.update`), read review/comment payloads from `context.payload`. v9 is ESM-only; we ship as ESM bundle so this is fine |
| **`@actions/core`** | 3.0.1 | Inputs, outputs, logging, secret masking | `core.getInput()` for reusable-workflow inputs, `core.setSecret()` to mask the Slack token in logs, `core.setFailed()` to fail the job cleanly |
| **`@octokit/rest`** | 22.0.1 (transitive via `@actions/github`) | Underlying GitHub REST client | Don't depend on directly — use the instance from `getOctokit(token)` |
### Distribution / Packaging
| Component | Version | Purpose | Notes |
|-----------|---------|---------|-------|
| **`actions/checkout@v6`** | v6.0.2 | Checks out caller repo on PR event | Needed for context (the reusable workflow runs in *caller's* repo context, so `GITHUB_TOKEN` is scoped to the caller) |
| **`actions/setup-node@v6`** | v6.4.0 | Installs Node | Only needed if we *don't* commit `dist/`. Strong recommendation: commit `dist/` and skip this entirely |
| **`@vercel/ncc`** | 0.38.x | Bundles TS+deps into single `dist/index.js` | Industry standard for JS GitHub Actions; `ncc build src/index.ts -o dist --source-map --license licenses.txt` |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| **`vitest`** | 4.1.5 (verified) | Unit test runner | Native ESM + TS, ~5-8x faster than Jest, zero config with `tsconfig.json` already present. Use to test pure logic (marker parsing, mention resolution, event-to-message mapping) with mocked Octokit + Slack clients |
| **`tsx`** | 4.21.0 | Run TypeScript scripts locally | For local "what does this look like" debugging without a build step. 25× faster startup than `ts-node`; we use it only for local dev/REPL, never in CI |
| **`act`** (`nektos/act`) | latest | Run GH Actions workflows locally in Docker | Optional. Useful for end-to-end smoke tests of the workflow YAML itself; not a replacement for unit tests. Run `act pull_request -j notify --secret-file .secrets` |
| **`prettier` + `eslint` (with `@typescript-eslint`)** | latest | Formatting + lint | Keep the bar low — small codebase, default rule sets are fine |
## Installation
# Runtime deps
# Build + dev deps
## Decisions on the Five Specific Questions
### 1. Language / runtime: **TypeScript on Node, packaged as a JS Action**
| Option | Reject reason |
|--------|---------------|
| **Plain shell + `gh` + `curl`** | Patching the PR body to inject `<!-- pr-bot:thread_ts=... -->` requires JSON-safe string escaping inside a multi-line markdown body. Doable in `jq`, but error-prone, and untestable. The "fetch existing PR body, splice in marker, PUT it back" round-trip is the riskiest piece of the whole bot — it deserves a typed language with unit tests. |
| **Python (`slack_sdk` + `PyGithub`)** | Cold start on Python is *slower* than Node (interpreter boot + import graph), and adds a `setup-python` step + dep install on every event. Team hasn't expressed Python preference. No upside for this workload. |
| **Pre-built `slackapi/slack-github-action`** (v3.0.3) | This action is **send-only**. Confirmed via README: "for sending data to Slack and running commands." It can call `chat.postMessage` (with `thread_ts`) but the bot still needs to *read the PR body to extract the existing `ts`* and *patch the PR body to write a new `ts`* — that's a separate Octokit dance. Stitching `slackapi/slack-github-action` together with custom JS for the GitHub side yields *more* total YAML and split logic across two languages (YAML + JS). Worse: passing structured payloads through workflow inputs requires JSON-stringifying twice and quoting hell. |
| **`actions/github-script`** (v9.0.0) | Tempting — gives you Octokit pre-loaded inline. But: the inline script lives in YAML, can't be unit tested, and doesn't have `@slack/web-api` available without `npm install` first. Loses the "single bundled action" property that gives us a clean cold start. |
### 2. Slack SDK: **`@slack/web-api@7.15.2` (Node)**
- **Typed**: `chat.postMessage` arguments and response are typed; `thread_ts` is `string | undefined` (the float-vs-string footgun is impossible at compile time)
- **Built-in retry + rate limiting**: Slack rate limits `chat.postMessage` to ~1/sec/channel; the SDK handles 429s and Retry-After headers without us writing a retry loop
- **No need for `conversations.history` / `conversations.replies`**: because we round-trip `thread_ts` through the PR body, we never re-query Slack for it — which is good, because as of 2025-05-29 these methods are aggressively rate-limited (1 req/min for non-Marketplace apps)
### 3. GitHub API access: **`@actions/github` (Octokit), not `gh` CLI**
- The PR body patch operation is `octokit.rest.pulls.update({ owner, repo, pull_number, body: newBody })` — one typed call. With `gh` you'd do `gh api -X PATCH /repos/.../pulls/N -f body=...` and shell-quote a multi-line markdown string with backticks and emoji. That way lies madness.
- Webhook event payload (`github.context.payload`) is already a fully typed `PullRequestEvent` / `PullRequestReviewEvent` / `IssueCommentEvent` — no extra round-trip needed for most events.
- `gh` is fine for *our own* repo-admin scripts; not for in-Actions logic.
### 4. Reusable workflow patterns
# In each watched repo's caller workflow:
- All ~10 caller repos need the same secrets (`SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`). Setting them as **org-level secrets** scoped to those repos means zero per-repo setup.
- `secrets: inherit` works cross-repo *within the same org* (verified). Each caller repo automatically has access to org secrets, and `inherit` forwards them.
- Explicit `secrets:` blocks would force every caller workflow to know the secret names — fine for v1, but it means renaming a secret breaks ten repos at once.
# .github/workflows/notify.yml
| Ref style | Use case |
|-----------|----------|
| `@v1` (mutable major tag, force-pushed on each minor/patch) | What watched repos pin to. Lets us ship bug fixes without editing 10 caller files |
| `@v1.2.3` (immutable) | What we cut on each release. Available for repos that want to pin tight |
| `@<full-sha>` | Recommended by GitHub for security-sensitive workflows; for an internal bot in our own org this is overkill |
| `@main` | **Never.** A bad commit on main would break notifications for all 10 repos instantly |
# After cutting v1.2.3:
### 5. Local dev / testing: **mocked clients in Vitest, not `act`**
- `parseThreadTs(prBody)` → `string | null`
- `injectThreadTs(prBody, ts)` → `prBody'` (idempotent: re-injecting same ts is a no-op)
- `resolveMentions(githubLogins, configMap)` → `slackUserIds`
- `formatRootMessage(prEvent)`, `formatReviewReply(reviewEvent)`, etc.
- Inject `{ slack, octokit }` into a top-level `handleEvent(event, deps)` function
- Mock with Vitest's `vi.fn()`; assert the right calls were made (e.g. on `pull_request.opened`, expect `slack.chat.postMessage` called once and `octokit.rest.pulls.update` called once with body containing the new marker)
- Run `act pull_request -j notify --secret-file .secrets --eventpath fixtures/pr_opened.json`
- Useful before cutting a release; not part of CI
- `.secrets` file is git-ignored and contains a *test* Slack token/channel
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| TypeScript JS Action | `slackapi/slack-github-action` + composite YAML | If the bot were write-only (no PR-body patch, no marker round-trip), the pre-built action would be the right answer. It isn't our case |
| `@slack/web-api` | Raw HTTPS via `fetch` | If we wanted zero non-`@actions/*` runtime deps. Saves ~200KB on the bundle. Cost: hand-rolled retry on 429s and `ratelimit_reset` parsing |
| `@actions/github` (Octokit) | `gh` CLI | Repo-admin scripts run by humans (e.g. cutting a release, bulk-patching configs). Not for in-Actions logic |
| Reusable workflow | Composite action | If we needed callers to invoke it as a *step* inside their own jobs (e.g. mid-build). We don't — the bot owns its own job |
| Mutable `@v1` major tag | SHA pinning everywhere | If watched repos were external/untrusted. Internal-only org → mutable tag is fine and saves churn |
| Vitest | Jest 30 | Existing Jest codebase being migrated. Greenfield → Vitest is faster and has better TS/ESM defaults |
| Commit `dist/` bundle | `npm ci` on every run | If the action were public and we worried about "audit the YAML, not 10MB of bundled JS." For an internal bot, committed `dist/` saves ~30s per event |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **`slackapi/slack-github-action` as the *only* Slack mechanism** | Send-only; doesn't help with PR-body round-trip; payloads through YAML inputs require ugly JSON-stringification | `@slack/web-api` from inside our JS action |
| **Inline `actions/github-script` for this whole bot** | Untestable, no type-checking on Slack side, fights the "Slack SDK + Octokit together" model | Real JS action with `@actions/github` + `@slack/web-api` imported normally |
| **Python (`slack_sdk` + `PyGithub`)** | Slower cold start; extra `setup-python` + `pip install` step; no team preference | Node + TypeScript |
| **Bash + `gh` + `curl` + `jq`** | Untestable; markdown-body splicing in shell is a debugging nightmare; no type safety on Slack payloads | TS action |
| **`@slack/bolt`** | Built for receiving Slack events via Socket Mode or a server. We don't receive Slack events; we send to Slack | `@slack/web-api` (the lower-level building block Bolt uses internally) |
| **`ts-node`** | 25× slower startup than `tsx`; needs peer-installed TypeScript; we don't need its type-check-at-runtime feature in CI | `tsx` for local dev, compiled bundle for CI |
| **Jest** | Slower, awkward ESM support, more config; nothing in this codebase needs Jest-specific features | Vitest |
| **`@v1` floating tag from third-party (untrusted) actions in our reusable workflow** | Supply-chain risk; if `actions/checkout@v6` got compromised, all 10 repos run malicious code | Pin first-party actions to `@v6` major tag (acceptable trust); pin any third-party action to a SHA |
| **External KV / DB for `thread_ts`** | Violates the $0 constraint and adds a failure mode (DB outage = bot dies) | Hidden HTML marker in PR body — already the architectural decision |
| **`@main` ref in caller workflows** | A bad commit instantly breaks all watched repos | Mutable `@v1` tag, advanced via deliberate release |
## Stack Patterns by Variant
- Move the Slack-side logic to a tiny Cloudflare Worker (still free tier)
- Keep the GitHub side as Actions to avoid maintaining a webhook receiver
- This invalidates the `secrets: inherit` pattern; would need to issue caller repos a worker token
- Add a `routing.yml` to this repo mapping `repo → channel_id`
- Bot reads it via `octokit.rest.repos.getContent` from this repo (the bot's own repo)
- Still no external state needed
- First-line: more hidden markers in the PR body (cheap, durable)
- Second-line: GitHub repo variables on the bot's own repo (free, scriptable via Octokit)
- Don't reach for a KV store while the marker pattern still fits
## Version Compatibility
| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@slack/web-api@7.15.2` | Node ≥18 | Verified 2026-05-05 via `npm view`. Node 22 LTS on runners is comfortably above floor |
| `@actions/github@9.1.1` | Node ≥20, ESM-only | v9 dropped CJS support. Our bundle is ESM (set `"type": "module"` in `package.json`); `ncc` handles output |
| `@actions/core@3.0.1` | Node ≥20 | v3 published 2026; we're on the latest |
| `actions/checkout@v6` | Node 24 runner internally | Upgraded from `v5` (Node 20). v6 is current as of 2026-01-09 |
| `actions/setup-node@v6` | Defaults to latest LTS | We don't actually use this if we commit `dist/`, but list it for reference |
| `slackapi/slack-github-action@v3.0.3` | n/a (we're not using it) | Latest 2026-05-01. Listed only to confirm we evaluated and rejected the current version, not a stale one |
| TypeScript 6.0.3 | Vitest 4.1, tsx 4.21, ncc 0.38 | All compatible; TS 6.x ESM-by-default matches our setup |
## $0 Budget Interactions
| Choice | Free-tier impact |
|--------|-----------------|
| Committed `dist/` bundle, no `npm install` | Saves ~30s/event × ~500 events/month = ~250 minutes/month vs install path. Total bot usage projects to **<100 min/month** of the 2,000 free |
| `@slack/web-api` not `slackapi/slack-github-action` | No impact — both are free |
| Mutable `@v1` reusable workflow ref | No impact — no extra runs |
| Reusable workflow (vs publishing as a marketplace action) | No impact, but org-internal means no marketplace listing burden |
| `act` for local testing | Saves runner minutes during development; uses local Docker |
| Vitest for unit tests | Tests run in dev; CI test job is ~10s of runner time |
| No external state (KV, DB, etc.) | $0/month — non-negotiable per constraint |
## Sources
- [npm: @slack/web-api](https://www.npmjs.com/package/@slack/web-api) — verified v7.15.2, Node ≥18 — HIGH
- [GitHub: slackapi/node-slack-sdk releases](https://github.com/slackapi/node-slack-sdk/releases) — confirmed active maintenance — HIGH
- [npm: @actions/github](https://www.npmjs.com/package/@actions/github) — verified v9.1.1, ESM-only since v9 — HIGH
- [npm: @actions/core](https://www.npmjs.com/package/@actions/core) — verified v3.0.1 — HIGH
- [GitHub releases: slackapi/slack-github-action](https://github.com/slackapi/slack-github-action/releases) — verified v3.0.3 (2026-05-01); confirmed send-only via README — HIGH
- [GitHub releases: actions/github-script](https://github.com/actions/github-script/releases) — verified v9.0.0 (2026-04-09) — HIGH
- [GitHub releases: actions/checkout](https://github.com/actions/checkout/releases) — verified v6.0.2 — HIGH
- [GitHub releases: actions/setup-node](https://github.com/actions/setup-node/releases) — verified v6.4.0; Node 24 runner internally — HIGH
- [Slack Docs: chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/) — confirmed `thread_ts` is a string parameter — HIGH
- [Slack Docs: conversations.replies](https://docs.slack.dev/reference/methods/conversations.replies/) — confirmed rate-limit changes 2025-05-29 (1 req/min for non-Marketplace) — HIGH
- [GitHub Docs: Reuse workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows) — confirmed `workflow_call` input types (boolean, number, string) and `secrets: inherit` semantics — HIGH
- [GitHub Changelog: Simplify secrets in reusable workflows (2022-05-03)](https://github.blog/changelog/2022-05-03-github-actions-simplify-using-secrets-with-reusable-workflows/) — `secrets: inherit` documented behaviour — HIGH
- [GitHub Changelog: Actions policy SHA pinning (2025-08-15)](https://github.blog/changelog/2025-08-15-github-actions-policy-now-supports-blocking-and-sha-pinning-actions/) — context for versioning recommendation — HIGH
- [GitHub Actions pricing changes 2026](https://resources.github.com/actions/2026-pricing-changes-for-github-actions/) — confirms free quota preserved; runner price drop 2026-01-01 — HIGH
- [Vitest docs](https://vitest.dev/guide/comparisons.html) — verified v4.1.5 — HIGH
- [tsx docs](https://tsx.is/) — verified v4.21.0 — HIGH
- [nektos/act](https://github.com/nektos/act) — pattern for local workflow testing — MEDIUM (works as described; community-maintained tool)
- [`@vercel/ncc`](https://github.com/vercel/ncc) — standard JS-action bundling tool used by `actions/typescript-action` template — HIGH
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
