# PR-BOT Sandbox Bring-Up

> **STATUS: ATTESTED 2026-05-06.** Sandbox bring-up complete with two intentional Path-A/Path-B divergences from the original plan, both documented inline:
>
> 1. **Section D — Path B used (repo-level secrets) instead of org-level.** GitHub Free orgs do not support sharing org secrets with private repos (Team plan required). Per the trade-off discussion in this session, sandbox repos stay private and `SLACK_BOT_TOKEN` is set as a repo-level secret on each of the 3 repos individually. This diverges from the Phase 4 production architecture (Team-plan org secrets) but functionally tests identically — the workflow reads `${{ secrets.SLACK_BOT_TOKEN }}` either way.
> 2. **Section E — Path A used (`dummy-reviewer` reuses `kai`'s Slack ID).** Phase 1 schema validates regex format only; reviewer-flow tests in Phase 2/3 will require a real second account (GitHub + Slack) before THRD-03 lands.
>
> Captured Values table at the bottom is populated. Phase 2 is unblocked.

## Why this exists

Phases 1–3 of PR-BOT are validated end-to-end against a personal sandbox (per **DIST-00**) so the company GitHub org and Slack workspace are not touched until Phase 4. The sandbox is built once and reused throughout development. Without it, every test PR is a real PR in a real company channel — both a noise risk (teammates pinged for throwaway test traffic) and a privacy risk (a half-built bot leaking partial messages into a workspace where other humans are working). The sandbox mirrors the production architecture exactly (org-level `SLACK_BOT_TOKEN`, cross-repo `secrets: inherit`, "Accessible from repositories in the org" Actions setting), so behavior verified there is the behavior the company will see.

## Prerequisites

- A personal GitHub account separate from the company account (or the same account used in personal capacity — the org just has to be free-tier and unaffiliated with the company).
- A personal Slack identity. The sandbox workspace will be brand-new; do NOT reuse the company workspace.
- `gh` CLI installed locally (optional but recommended for the org-level-secret step in Section D).
- A local clone of this repo (`PR-BOT`) on your machine.

## Checklist

Work through the items in order. Each `- [ ]` is a discrete step you can verify in a GitHub or Slack settings pane. Citations like `(D-08)` or `(FND-05)` point at the underlying decision in `.planning/phases/01-foundations/01-CONTEXT.md` or `.planning/REQUIREMENTS.md`.

### A. GitHub Sandbox Org and Repos (D-08, D-09)

- [x] **A1.** Create a free personal GitHub org named `Slaanesh233-sandbox`. URL: <https://github.com/account/organizations/new>. Pick the **Free** plan (Team plan is paid). The name `Slaanesh233-sandbox` is used throughout the rest of this checklist; if you pick a different name, substitute consistently and record the chosen name in the Captured Values table at the bottom.

- [x] **A2.** Push this repository to `Slaanesh233-sandbox/PR-BOT`. From a local clone of `PR-BOT`, run:

      ```sh
      git remote add sandbox git@github.com:Slaanesh233-sandbox/PR-BOT.git
      git push sandbox main
      ```

      > **PAUSED — do not run until remote hosting is confirmed with the user.** The `gh`/`git` CLI on this machine is authenticated against multiple GitHub identities (including a company org), and an accidental push to the wrong remote would create noise in a real company repo. Confirm the target org name and the right SSH/HTTPS identity before running these commands. Until then, leave the `sandbox` remote unconfigured.

- [x] **A3.** Create two empty sandbox watched repos in the `Slaanesh233-sandbox` org (D-09): `Slaanesh233-sandbox/sandbox-repo-a` and `Slaanesh233-sandbox/sandbox-repo-b`. Each repo is initialized with a `README.md` only. The caller-workflow stub (`.github/workflows/pr-bot.yml`) will be added by Phase 2 — leave the repos empty for now.

### B. Cross-Repo Workflow Access (FND-05, D-11)

- [x] **B1.** Open `https://github.com/Slaanesh233-sandbox/PR-BOT/settings/actions`.
- [x] **B2.** Scroll to the **Access** section.
- [x] **B3.** Select the radio button: **"Accessible from repositories in the 'Slaanesh233-sandbox' organization"**. Click **Save**. (Without this, every cross-repo `uses:` from `sandbox-repo-a` / `sandbox-repo-b` will fail with "could not find workflow" — see PITFALLS.md Pitfall 4 in research notes. This is the FND-05 step that fails silently and burns hours debugging the wrong path if skipped.)

### C. Slack Workspace and App (D-10, FND-04)

- [x] **C1.** Create a brand-new free Slack workspace at <https://slack.com/get-started>. Suggested name: `pr-bot-sandbox`. **Do NOT reuse the company workspace** — per D-10, the sandbox workspace is dedicated so test traffic is isolated from any work-in-progress channels.

- [x] **C2.** Create a public channel in the new workspace. Suggested name: `#pr-bot-sandbox`.

- [x] **C3.** Register a Slack app. Sub-steps (perform in order):

      1. Go to <https://api.slack.com/apps> → **Create New App** → **From scratch**.
      2. App name: `PR-BOT`. Workspace: the sandbox workspace from C1.
      3. Sidebar → **OAuth & Permissions** → **Scopes** → **Bot Token Scopes** → add BOTH `chat:write` AND `reactions:write`. (`reactions:write` is used in P3 — install now to avoid an OAuth re-flow.)
      4. Sidebar → **Install App** → **Install to Workspace** → authorize.
      5. Copy the **Bot User OAuth Token** (starts with `xoxb-`). This is the value of `SLACK_BOT_TOKEN`. **Treat as a secret — never paste into source, fixtures, or chat.**

- [x] **C4.** Invite the bot to the channel: in `#pr-bot-sandbox` type `/invite @PR-BOT`.

### D. GitHub Org-Level Secret (FND-04, D-11)

- [~] **D1.** (Path B used — repo-level secrets, not org-level — Free tier limitation) Open `https://github.com/organizations/Slaanesh233-sandbox/settings/secrets/actions`.
- [~] **D2.** (skipped — Path B uses repo-level secrets instead) Click **New organization secret**.
- [~] **D3.** (set on each repo individually under Path B) Name: `SLACK_BOT_TOKEN`. Value: the `xoxb-…` token from C3 step 5.
- [~] **D4.** (Path B replaces this with 3 separate repo-level secret forms — see banner) Repository access: **Selected repositories**. Add exactly these three: `PR-BOT`, `sandbox-repo-a`, `sandbox-repo-b`. Click **Save**. (The allowlist is enforced by GitHub — only these repos' workflow runs can read the secret. Any other repo in the org is denied.)

### E. Capture Identifiers (Plan 03 inputs)

You need three IDs for `config/users.yml` and `config/channel.yml` (Plan 03 reads them from the Captured Values table below):

- [x] **E1.** Your personal Slack User ID. In the sandbox workspace, click your avatar → **Profile** → **More (…)** → **Copy member ID**. Format: `U` followed by uppercase letters/digits, e.g. `U01ABCD2345`.
- [x] **E2.** (Path A — same Slack ID as E1; will swap for real second human pre-Phase-3) A second test Slack User ID — the `dummy-reviewer`. Either invite a personal alt account into the sandbox workspace, or invite a friend/spouse for one-time testing. Capture their member ID the same way (`U…`).
- [x] **E3.** The channel ID for `#pr-bot-sandbox`. Channel name → **View channel details** → bottom of the pane. Format: `C` followed by uppercase letters/digits, e.g. `C01XYZ4567`. _(Private channels start with `G`; for the public sandbox channel it will be `C`.)_

## Captured Values

> Fill these in as you work through the checklist. Plan 03 (Pure-Logic Library + Config) reads them to populate `config/users.yml` and `config/channel.yml`. The `U…` and `C…` IDs are public Slack identifiers and safe to commit (per D-12, D-15). The `xoxb-` token from C3 step 5 is **NEVER** recorded here.

| Key                            | Value                                     | Source |
| ------------------------------ | ----------------------------------------- | ------ |
| GitHub sandbox org             | `Slaanesh233-sandbox`                             | A1     |
| Sandbox watched repo A         | `Slaanesh233-sandbox/sandbox-repo-a`              | A3     |
| Sandbox watched repo B         | `Slaanesh233-sandbox/sandbox-repo-b`              | A3     |
| Slack workspace name           | `pr-bot-sandbox` (or your chosen name)    | C1     |
| Slack channel name             | `#pr-bot-sandbox` (or your chosen name)   | C2     |
| Slack channel ID               | channel: `C0B2GF3UJ01`                    | E3     |
| `kai` Slack User ID            | kai: `U0B20676JVB`                        | E1     |
| `dummy-reviewer` Slack User ID | dummy-reviewer: `U0B20676JVB` _(Path A: reuses kai's ID; swap pre-Phase-3)_ | E2     |

## Verification

After working through the checklist, verify each end-state independently in the relevant dashboard. The `checkpoint:human-verify` step in Plan 01-02 will ask you to confirm all of the following:

- `Slaanesh233-sandbox` org exists and the maintainer is **Owner**.
- `Slaanesh233-sandbox/PR-BOT`, `Slaanesh233-sandbox/sandbox-repo-a`, `Slaanesh233-sandbox/sandbox-repo-b` all exist.
- `https://github.com/Slaanesh233-sandbox/PR-BOT/settings/actions` shows **Access: Accessible from repositories in the 'Slaanesh233-sandbox' organization** (FND-05).
- `https://github.com/organizations/Slaanesh233-sandbox/settings/secrets/actions` shows `SLACK_BOT_TOKEN` exists and is restricted to the 3 repos listed in step D4.
- The Slack app `PR-BOT` is installed in the sandbox workspace with bot scopes `chat:write` AND `reactions:write` (visible at <https://api.slack.com/apps> → PR-BOT → OAuth & Permissions → Bot Token Scopes).
- The bot is a member of `#pr-bot-sandbox` (visible in channel member list, or by re-running `/invite @PR-BOT` and seeing "already in channel").
- The "Captured Values" table above has all three `U…`/`C…` IDs filled in (no remaining `__________` placeholders for those rows).

## Privacy and Security

**Token hygiene.** The `xoxb-…` token from C3 step 5 is the master key to the sandbox bot. It MUST live only in the GitHub org-level secret store from step D4. Never commit it. Never paste into chat, screenshots, or test fixtures. The `Captured Values` table above intentionally does NOT have a row for it — the only place the token is ever stored is the GitHub Actions secret store, which masks it in workflow logs automatically. If the token leaks (committed by accident, shared in a screenshot, suspected exposure), regenerate immediately at <https://api.slack.com/apps> → PR-BOT → OAuth & Permissions → **Reset Token**, then update the org secret in D1–D4.

**Why a brand-new Slack workspace.** Per D-10, the sandbox workspace is dedicated to PR-BOT testing. This isolates test traffic from any work-in-progress channels and ensures the bot's `chat.postMessage` cannot accidentally fire against a real team during development. The first noisy bug you ship would otherwise spam a real channel — using a throwaway workspace makes those bugs harmless.
