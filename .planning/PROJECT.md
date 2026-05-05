# PR-BOT

## What This Is

A Slack bot that posts high-signal notifications about pull request activity for ~10 repositories maintained by a team of ~15 people. It pings the right people when something is worth their attention (PR opened, comments, reviews, merges) and stays quiet otherwise — minimizing noise to teammates who aren't involved in a given PR.

## Core Value

The right humans get notified about PR-worthy events; everyone else stays undisturbed. Signal over noise — if the bot becomes noisy, it's failing.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. -->

- [ ] When a PR is opened in a watched repo, post a single message to the team Slack channel that @-mentions the author and any reviewers, with a link to the PR
- [ ] When a reviewer is added to a PR after open, post a thread reply that @-mentions the new reviewer
- [ ] When a human (non-bot) leaves a comment on a PR, post a thread reply formatted as `@<author> published <N> comments` — without quoting the comment body
- [ ] When a human submits a review (approve / request changes / comment), post a thread reply summarizing the review state
- [ ] When a PR is merged, post a thread reply confirming the merge
- [ ] When a PR is closed without merging, post a thread reply confirming the close
- [ ] Filter out bot-authored comments using GitHub's `actor.type == 'Bot'` so CI / dependabot / renovate / the bot itself never trigger replies
- [ ] Resolve GitHub usernames to real Slack `@-mentions` via a static `github_username → slack_user_id` config maintained in this repo
- [ ] Persist the Slack `thread_ts` for each PR by embedding a hidden HTML marker in the PR body, so subsequent thread replies land under the original message (no external state store)
- [ ] Run on GitHub Actions free tier — zero hosting cost. Logic lives in this repo as a reusable workflow (`.github/workflows/notify.yml`); each watched repo adds a tiny caller workflow that invokes it
- [ ] Operate without long-lived servers, external KV stores, or paid services

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Multi-channel routing (per-repo, per-team, etc.) — single team channel covers v1; routing adds config + testing surface for no clear win at this team size
- Self-service `/link` Slack slash command — static config is fine for 15 people; slash commands need a long-lived endpoint, breaking the zero-hosting constraint
- Quoting or summarizing comment bodies in thread replies — the explicit user requirement is *only* that someone commented, not what they said. Surfacing comment text becomes noise
- Cross-repo / org-wide watching — limited to the team's hardcoded ~10 repo list
- Paid hosting or SaaS dependencies — must remain $0 to operate
- Repeated `@`-mentions for the same user across thread replies — the `@<author> published N comments` format mentions once per event; not a pinging firehose
- Direct messages or private notifications — public team-channel only

## Context

- **Team size:** ~15 people, one team
- **Watched repos:** ~10 packages/repos maintained by this team
- **Slack target:** a single team channel
- **Authoring model:** GitHub Actions reusable workflow. PR-BOT repo holds the logic; each watched repo opts in by adding a small `.github/workflows/pr-bot.yml` that calls the reusable workflow with `secrets: inherit`
- **Identity:** GitHub Actions runs with the repo's built-in `GITHUB_TOKEN`; Slack credentials provided as org-level secrets so all 10 repos share them without per-repo setup
- **State:** No external store. Per-PR Slack `thread_ts` is round-tripped through a hidden HTML comment in the PR body (e.g. `<!-- pr-bot:thread_ts=1700000000.000100 -->`). The bot reads it on subsequent events to thread under the original message
- **Bot detection:** GitHub webhook payloads include `sender.type` / `actor.type`; filter on `Bot` to skip automated comments

## Constraints

- **Budget:** $0 — must run on free tiers only. No paid hosting, no SaaS state stores
- **Tech stack:** GitHub Actions runtime — language is whatever runs cleanly there (TypeScript/Node, Python, or shell + `gh` CLI). Final language pick deferred to research/planning
- **Hosting model:** GitHub Actions reusable workflows. No long-lived servers, no Slack slash commands (which need a public endpoint)
- **State:** Hidden HTML marker in PR body — no external KV, no DB
- **Permissions:** Slack bot needs `chat:write` for the team channel; GitHub workflows need `pull-requests: write` to edit the PR body and `contents: read` to fetch metadata
- **Distribution:** ~10 repos must each carry one tiny caller workflow file. Updating bot logic must not require editing all 10 repos (reusable workflow with versioned ref handles this)
- **Privacy:** Bot must not echo comment or review body content into Slack — only the *fact* that an event happened plus the actor

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Host on GitHub Actions (reusable workflow) | $0 budget; events are PR-driven so a webhook server isn't needed; reusable workflows let one repo own the logic for ten | — Pending |
| Store Slack `thread_ts` in a hidden HTML marker in the PR body | Avoids any external state store while remaining durable across runs; the PR body is the canonical place to attach PR-scoped metadata | — Pending |
| Static `github_username → slack_user_id` config in this repo | 15 people; trivial to maintain; no slash command means no need for a long-lived endpoint | — Pending |
| Single team Slack channel for v1 | Matches team size; per-repo routing is added complexity for no current need | — Pending |
| Filter via `actor.type == 'Bot'` rather than a denylist | Self-maintaining; covers dependabot, renovate, codecov, and our own bot without manual upkeep | — Pending |
| Comment thread replies say `@<author> published N comments` and never quote bodies | The user's explicit signal-over-noise rule; quoting comment text would re-introduce the noise the bot exists to suppress | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-05 after initialization*
