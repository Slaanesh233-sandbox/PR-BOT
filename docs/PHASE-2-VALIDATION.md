# Phase 2 Keystone Validation

**Started:** 2026-05-06
**Completed:** 2026-05-06
**Plan:** 02-04
**Final verdict:** YELLOW (PASS with one acceptable Path-A deferral on Scenario 2 — see Outcome)

## Pre-flight state

- Plan 02-01 commits on local main: yes — `e298977` (feat handler) + `9505f34` (CI Gate 8 extension) + `a173523` (RED tests)
- Plan 02-02 commits on local main: yes — `9637616` (notify.yml) + `5595ef5` (examples/pr-bot.yml) + `18d08a5` (action.yml + CLAUDE.md fix)
- PR-BOT main pushed to `Slaanesh233-sandbox/PR-BOT`: yes — initial remote HEAD `18d08a5`; remote `dist/index.js` size = 2,239,668 bytes (2.24 MB; ≥400KB threshold).
- Remote `notify.yml` size = 3,636 bytes.
- sandbox-repo-a onboarded: yes — `.github/workflows/pr-bot.yml` (2090 bytes); workflow `PR-BOT` (id 272303596) registered + active.
- sandbox-repo-b onboarded: yes — `.github/workflows/pr-bot.yml` (2090 bytes; byte-identical to sandbox-repo-a); workflow `PR-BOT` (id 272304026) registered + active.
- Local 8 CI gates: PASS — typecheck, 75/75 tests, lint, format:check, build, dist drift clean, broadcast scan, FLT-05 / FLT-06(a) Gate 8.
- Slack workspace: `pr-bot-sandbox`; channel `#pr-bot-sandbox` (`C0B2GF3UJ01`); bot installed with scopes `chat:write` + `reactions:write`; invited per docs/SANDBOX.md C4.
- Captured Slack identifiers: kai = `U0B20676JVB`; dummy-reviewer = `U0B20676JVB` (Path A — same as kai; pre-Phase-3 swap pending).

## Repository state at validation completion

| Repo                                          | HEAD       | Visibility | Notes                                                             |
| --------------------------------------------- | ---------- | ---------- | ----------------------------------------------------------------- |
| `Slaanesh233-sandbox/PR-BOT` `main`           | `d770556`  | **public** | Flipped from private after PR #2 surfaced cross-repo `actions/checkout` auth blocker. |
| `Slaanesh233-sandbox/sandbox-repo-a` `main`   | `b9a6f6c`  | private    | Caller stub gained explicit `permissions:` block after PR #1 startup_failure. |
| `Slaanesh233-sandbox/sandbox-repo-b` `main`   | `9f53d1f`  | private    | Same caller-stub permissions fix mirrored across both sandboxes.  |

## Phase 2 ROADMAP success criteria → scenario map

| Criterion                                                                  | Scenario(s)                                | Status                       | Evidence                                                                                                                                              |
| -------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Non-draft PR → 1 Block Kit message + marker                             | Scenario 1 (no reviewers) + Scenario 6     | PASS (no-reviewers); Scenario 2 reviewer-path DEFERRED to Phase 3 (Path A → Path B swap) | PR #4 run `25466097247` posted root + marker; PR #5 ready_for_review run `25466190913` posted root + marker.                                          |
| 2. concurrency group + `cancel-in-progress: false` + permissions declared  | Scenario 5 (structural)                    | PASS                         | Three load-bearing literals confirmed in remote `notify.yml`: per-PR concurrency group with OR-fallback, `cancel-in-progress: false`, `pull-requests: write` + `contents: read`. |
| 3. Re-run same event → no duplicate                                        | Scenario 4 (idempotency)                   | PASS                         | Re-ran PR #4 run `25466097247` via `gh run rerun`; log line `skipped: marker already present (idempotent re-run guard) — PR #4`; PR body marker unchanged; user confirmed zero second Slack post. |
| 4. Drafts: zero posts; ready_for_review fires exactly once                 | Scenario 6                                 | PASS                         | PR #5 draft-open run `25466183128` logged `skipped: draft` (no Slack post); `gh pr ready 5` fired run `25466190913` which logged `posted root for PR #5, thread_ts=1778108925.944089`. |
| 5. Bot self-loop defenses (no `edited`/`synchronize` runs after PATCH)     | Scenario 7                                 | PASS                         | Across all 5 sandbox PRs (#1–#5): zero workflow runs with `event_action: edited` or `event: synchronize`. Caller stub `types: [opened, reopened, ready_for_review, review_requested, closed]` excludes both event types; runtime `sender.type === 'Bot'` is the second-line filter. |
| 6. Cold-start <5s; runs from committed `dist/`                             | Scenario 8                                 | PASS                         | PR #4 run `25466097247` `Run PR-BOT` step duration: 2s. End-to-end (set up + checkout + run + post) ~4s. Well under the 5s budget on the action step itself. |

## Live-fix journey (5 attempts to reach a green keystone)

The first canonical green run was PR #4 (run `25466097247`). Three earlier attempts surfaced real defects in the distribution surface and one resolution policy decision; documenting them here so the SUMMARY can characterize the journey, and so future onboardings of additional watched repos inherit these fixes by construction.

### Attempt 1 — PR #1, run `25465345705` — `startup_failure`

- **Symptom:** workflow conclusion `startup_failure`; the reusable workflow rejected the call before any step ran.
- **Cause:** the caller stub `examples/pr-bot.yml` (and the byte-identical copies on sandbox-repo-a/b) had no `permissions:` block. Default-token `pull-requests: none` blocks the reusable workflow's downgrade-only `pull-requests: write` request — GitHub Actions refuses to start the job rather than silently downgrading.
- **Fix:** added an explicit `permissions: { pull-requests: write, contents: read }` block to the caller-stub job.
- **Remediation commits:**
  - PR-BOT `5454983` — `fix(02-02): add explicit permissions block to caller stub`
  - sandbox-repo-a `b9a6f6c`
  - sandbox-repo-b `9f53d1f`
- **Deviation classification:** Rule 1 (bug) in Plan 02-02's `examples/pr-bot.yml`. The plan's research notes mentioned reusable-workflow permission-token semantics but the `examples/pr-bot.yml` shipped without an explicit caller-side block. The fix is now committed at the source-of-truth and propagated to both sandboxes.

### Attempt 2 — PR #2, run `25465740200` — `failure` on cross-repo checkout

- **Symptom:** workflow conclusion `failure` at the `actions/checkout` step that pulls PR-BOT into the caller's runner. Error: cross-repo private read denied.
- **Cause:** PR-BOT was a **private** repo at the time. The reusable workflow's checkout-PR-BOT step uses the caller repo's `GITHUB_TOKEN`, which on the GitHub Free tier has no cross-repo private-read scope. The reusable workflow YAML resolution succeeds (different code path), but the runtime checkout of `Slaanesh233-sandbox/PR-BOT` from inside sandbox-repo-a's job fails.
- **Fix:** flipped `Slaanesh233-sandbox/PR-BOT` from private to public. Confirmed with the user that the contents are non-sensitive (no company name, generic Slack-PR-bot code). Sandbox-repo-a and sandbox-repo-b stayed private. This was an explicit user-authorized action.
- **Trade-off accepted:** the bot's logic is now public on the sandbox org. This is acceptable because (a) the source contains no secrets, no proprietary data, and no real Slack tokens (those live in repo-level secrets per Path B); (b) Phase 4 recreates the bot at the company org via fresh push anyway, where the company-side architecture supports same-org private cross-repo `uses:` resolution; (c) the threat model bias is "leak prevention is in the secret store, not the source tree."
- **Deviation classification:** Rule 4 (architectural) — the visibility flip needed user approval before execution.

### Attempt 3 — PR #3, run `25465953043` — `success`, but FLT-05 fallback on author mention

- **Symptom:** keystone fired correctly (Slack post + marker write succeeded). But the action log emitted: `mentions.resolve: no Slack ID mapping for github login "Slaanesh233"` — the FLT-05 plain-text-fallback warning.
- **Cause:** `config/users.yml` had key `kai` (the human's first name) mapped to Slack ID `U0B20676JVB`. But the GitHub webhook payload `pull_request.user.login` field is `Slaanesh233` (the actual GitHub login of the active gh CLI identity). The map lookup missed; FLT-05 fallback rendered the message with plain-text `@Slaanesh233` — which is correct safe behavior (no errant ping into Slack) but doesn't actually `<@U…>`-mention the human.
- **Fix:** renamed `kai` → `Slaanesh233` in `config/users.yml`; updated `tests/config-schema.test.ts` to reflect the new key. Rebuilt `dist/`.
- **Remediation commit:** PR-BOT `d770556` — `fix(02-04): rename users.yml key from `kai` to `Slaanesh233` (the actual GitHub login)`.
- **Deviation classification:** Rule 1 (bug) — config drift between docs/SANDBOX.md (which used the friendly name `kai`) and the GitHub login the bot actually receives. Plan 01-03b's schema-validation test passed both before and after the rename because both keys match `^[a-zA-Z0-9-]+$`; this was a *content* bug, not a *shape* bug.
- **Note for Phase 4:** the company rollout will need real GitHub login → Slack ID mappings for all ~15 humans on the team. The "key must match `pull_request.user.login` exactly" lesson is now codified in the validation log.

### Attempt 4 — PR #4, run `25466097247` — canonical green keystone

- **Symptom:** workflow `success` in 5s end-to-end (including runner provisioning + checkout). Slack message landed in `#pr-bot-sandbox` with proper `<@U0B20676JVB>` rendering as `@Slaanesh233`. Marker injected into PR body.
- **Action log key line:** `posted root for PR #4, thread_ts=1778108775.857299`.
- **PR body marker:** `<!-- pr-bot:thread_ts=1778108775.857299 -->`.
- **Marker round-trip:** the captured PR-body `thread_ts` (`1778108775.857299`) is byte-equal to the value emitted in the action log — FND-06 / D-02 string-equality preservation holds. **This is the canonical Scenario 1 evidence.**

### Attempt 5 — PR #5, runs `25466183128` + `25466190913` — Scenario 6 evidence

- **Symptom:** opening PR #5 as draft → run `25466183128` fired with `event=pull_request`, conclusion `success`, action log `skipped: draft`. **Zero** Slack message posted.
- Then `gh pr ready 5` → run `25466190913` fired with `event=pull_request`, action `ready_for_review`, conclusion `success`. Action log: `posted root for PR #5, thread_ts=1778108925.944089`. **Exactly one** Slack message posted.
- PR body now contains the marker `<!-- pr-bot:thread_ts=1778108925.944089 -->`.
- User confirmed Slack channel state: exactly one root message per ready-for-review PR; nothing posted while the PR was a draft.

## Scenario 1 — OPEN-04 happy path (no reviewers)

_Status: PASS_

- **PR opened:** #4 in `Slaanesh233-sandbox/sandbox-repo-a` (non-draft, no reviewers requested).
- **Workflow run:** `25466097247` (conclusion: success, ~5s end-to-end).
- **Action log key line:** `posted root for PR #4, thread_ts=1778108775.857299`.
- **Slack message:** confirmed by user — landed in `#pr-bot-sandbox` with the `<@U0B20676JVB>` author mention rendering as `@Slaanesh233`. Format matches the OPEN-04 contract: `sandbox-repo-a: @Slaanesh233 has raised a <link|PR>.` (no ` cc …` clause; no reviewers requested).
- **PR body marker:** `<!-- pr-bot:thread_ts=1778108775.857299 -->` — captured via `gh pr view 4 -R Slaanesh233-sandbox/sandbox-repo-a --json body`.
- **Marker round-trip check (FND-06):** action-log `thread_ts` = PR-body marker `thread_ts` = `1778108775.857299`. String equality preserved.
- **Repo short-name in message (Pitfall 10):** `sandbox-repo-a` (not `Slaanesh233-sandbox/sandbox-repo-a`) — confirmed.
- **PR title/branch absent (FLT-06(a)):** confirmed — message text has no PR title text and no branch ref.

## Scenario 2 — OPEN-04 with reviewers (Path A) — DEFERRED to Phase 3

_Status: DEFERRED (acceptable per plan)_

- **Live test deferred** because `dummy-reviewer` is not a real GitHub login, and Path A intentionally reuses kai's Slack ID for the dummy-reviewer mapping. Requesting a reviewer at PR-create requires a real GitHub user; the only real human currently in the sandbox config (`Slaanesh233`) cannot be a reviewer on their own PR.
- **Structural proof exists** in unit tests: `tests/handler.test.ts` "OPEN-04 with-reviewers" cases (3 of the 13 tests in Plan 02-01) drive the `formatRootMessage` `cc <@U…> <@U…>` rendering path against mocked deps. The handler's `mentions.resolveAll(reviewer_logins)` → `cc` clause is deterministic and fully covered by those tests.
- **Phase 3 blocker, not a Phase 2 blocker:** Path A → Path B swap is tracked in docs/SANDBOX.md banner and STATE.md Deferred Items. Pre-Phase-3 task: invite a real second human to `pr-bot-sandbox` Slack workspace, add their `<github-login> → <Slack-U-id>` to `config/users.yml`, then re-run this scenario as part of Phase 3 reviewer-flow validation (THRD-03 dependency).
- **Per the plan author's own assessment** (Plan 02-04 Task 4.4 `<how-to-verify>`): "Recommended: unless you have a second GitHub login + Slack ID that you can quickly add to `config/users.yml`, defer Scenario 2." The deferral was the plan-anticipated outcome, not a discovered failure.

## Scenario 3 — Marker write captured (FND-06 string equality)

_Status: PASS_

- Captured on PR #4: action log `thread_ts=1778108775.857299` exactly equals PR-body marker `<!-- pr-bot:thread_ts=1778108775.857299 -->`. String equality preserved through the full round-trip (Slack `chat.postMessage` response → `marker.inject(body, ts)` → `octokit.rest.pulls.update` → `gh pr view` body readback). No precision loss.
- Re-confirmed on PR #5 (Scenario 6): action log `thread_ts=1778108925.944089` exactly equals PR-body marker `<!-- pr-bot:thread_ts=1778108925.944089 -->`.
- **D-02 / Pitfall 13 invariant:** the handler does not coerce `ts` through `parseFloat` / `Number` / unary `+`; all string handling. Verified by Plan 02-01's invariant grep `parseFloat|Number\([^)]*ts` against `src/index.ts` returning 0 hits, and re-verified post-attempt-3 since `d770556` rebuilt dist/ from the same source.

## Scenario 4 — Idempotency (Re-run all jobs)

_Status: PASS_

- **Re-run trigger:** `gh run rerun 25466097247 -R Slaanesh233-sandbox/sandbox-repo-a` (PR #4's original successful keystone run).
- **Re-run conclusion:** success.
- **Re-run log key line:** `skipped: marker already present (idempotent re-run guard) — PR #4`.
- **Slack channel state:** user confirmed NO second message landed for PR #4 — only the original Scenario-1 root message remains in `#pr-bot-sandbox`.
- **Marker preserved:** PR #4 body still contains the original `<!-- pr-bot:thread_ts=1778108775.857299 -->` byte-identical to its post-Scenario-1 state.
- **Webhook-retry equivalence:** "Re-run all jobs" exercises the same handler code path that a GitHub-side webhook retry would hit — the workflow re-fires the same event payload to the same workflow without creating a second PR. The handler reads the LIVE PR body via `octokit.rest.pulls.get` (NOT the stale event payload body — Pitfall 12), sees the marker, and short-circuits before any Slack call. Plan 02-01's `tests/handler.test.ts` "OPEN-06 idempotency" case is the deterministic unit-test proof of this exact path against a synthetic re-fire fixture; this live re-run demonstrates the same guard against the real `pulls.get` → `parseMarker` → skip flow.

## Scenario 5 — Concurrency group structure (inspection)

_Status: PASS_

Three load-bearing literals verified in remote `Slaanesh233-sandbox/PR-BOT/.github/workflows/notify.yml@main`:

1. **Concurrency group expression** (with Pitfall-5 OR-fallback for issue_comment events):
   ```yaml
   concurrency:
     group: pr-bot-${{ github.repository }}-${{ github.event.pull_request.number || github.event.issue.number }}
   ```
   Verified by `grep -q "group: pr-bot-\${{ github.repository }}-\${{ github.event.pull_request.number || github.event.issue.number }}"` returning 0 (match).

2. **`cancel-in-progress: false`** — the literal value is the deterrent against a one-character flip that would leave a PR body markerless mid-flight if a second event arrived during the open-event PATCH:
   ```yaml
   concurrency:
     ...
     cancel-in-progress: false
   ```

3. **Permissions block** (downgrade-only; reusable-workflow side):
   ```yaml
   permissions:
     pull-requests: write
     contents: read
   ```

Plus the caller-side counterpart (added during Live-fix Attempt 1) in both sandbox-repo-a and sandbox-repo-b's `.github/workflows/pr-bot.yml`:
```yaml
permissions:
  pull-requests: write
  contents: read
```

Real-traffic concurrency observation was not exercised (Phase 2 doesn't yet fire two events on one PR; Phase 3 will). The structural inspection is the primary evidence per the plan's own framing: "Real-traffic concurrency observation is opportunistic in scenario 5; the structural check is mandatory."

## Scenario 6 — Draft → ready_for_review path

_Status: PASS_

- **Draft open:** `gh pr create -R Slaanesh233-sandbox/sandbox-repo-a --draft --base main --head keystone/scenario-6 --title 'test: scenario 6 draft' --body 'draft'` → PR #5 created as draft.
- **Run on draft open:** `25466183128`, event `pull_request` (action `opened`), conclusion success.
- **Action log:** contains `skipped: draft`. NO `posted root` line.
- **Slack channel state during draft:** user confirmed ZERO messages posted for PR #5 (channel quiet).
- **Promotion:** `gh pr ready 5 -R Slaanesh233-sandbox/sandbox-repo-a` → PR #5 marked ready_for_review.
- **Run on ready_for_review:** `25466190913`, event `pull_request` (action `ready_for_review`), conclusion success.
- **Action log:** `posted root for PR #5, thread_ts=1778108925.944089`.
- **Slack channel state after promotion:** user confirmed EXACTLY ONE message for PR #5 (channel got one root post; format matches OPEN-04 no-reviewer shape).
- **PR body marker after promotion:** `<!-- pr-bot:thread_ts=1778108925.944089 -->` — captured via `gh pr view 5 --json body`.
- **OPEN-08 invariant held both halves:** drafts produce zero posts; the ready_for_review transition produces exactly one post.

## Scenario 7 — Bot self-loop defenses (zero `edited`/`synchronize` runs after PATCH)

_Status: PASS_

- After every successful keystone run (PR #4, PR #5), the handler's `octokit.rest.pulls.update` PATCH writes the marker into the PR body. That PATCH would normally fire a `pull_request: edited` webhook back at the caller workflow.
- **Live observation across all 5 sandbox PRs (#1–#5):** zero workflow runs have `event_action: edited`. Inspected via `gh run list -R Slaanesh233-sandbox/sandbox-repo-a -L 30 --json event,databaseId,headBranch,createdAt`. Same zero count for sandbox-repo-b.
- **Zero `event: synchronize` runs** (push-event) — also confirmed by the same listing. The caller stub's `types: [opened, reopened, ready_for_review, review_requested, closed]` list excludes both — the structural first-line defense.
- **Second-line defense (runtime FLT-01):** the handler's `sender.type === 'Bot'` early-exit filter is unit-tested by Plan 02-01's `tests/handler.test.ts` "FLT-01 sender.type=Bot" + "FLT-01 [bot] suffix" cases. No live evidence is needed for this layer because the structural first line already prevents the runs from firing — but the runtime filter remains in place as defense-in-depth in case a future caller stub forgets to exclude `edited`.
- **Operational verdict:** the bot's own PATCH cannot self-loop into a second post. Both defenses (caller `types:` exclusion + runtime sender filter) are in place and observable.

## Scenario 8 — Cold-start timing

_Status: PASS_

PR #4 canonical run (`25466097247`) — step durations from `gh run view 25466097247 -R Slaanesh233-sandbox/sandbox-repo-a --json jobs`:

| Step                           | Duration | Notes                                                                            |
| ------------------------------ | -------- | -------------------------------------------------------------------------------- |
| Set up job                     | 1s       | Runner provisioning (excluded from the action's <5s budget).                     |
| Checkout PR-BOT                | 1s       | `actions/checkout@v6` of `Slaanesh233-sandbox/PR-BOT` into `.pr-bot/`.            |
| **Run PR-BOT**                 | **2s**   | `node .pr-bot/dist/index.js` — the bundle executes, posts to Slack, PATCHes PR.  |
| Post Checkout PR-BOT           | 0s       | Cleanup.                                                                          |

The "Run PR-BOT" step is the action's actual execution time and the cold-start budget per Phase 2 success criterion #6: **2s, well under the 5s ceiling**.

End-to-end (everything visible to the user from PR-create to Slack-message-landed): ~5s.

The 2.24 MB committed `dist/index.js` bundle (Plan 02-01 metric) is loaded from disk, not freshly installed via `npm install` — confirming OPEN-03's "ncc bundle, never `npm install` at caller-event time" invariant. Verified by absence of any `Set up Node.js` / `setup-node` / `npm install` steps in the run's job listing.

## Outcome

_Status: YELLOW (Phase 2 PASS with one acceptable Path-A deferral)_
_Validated: 2026-05-06_

### ROADMAP Phase 2 success criteria results

| Criterion                                                              | Status | Evidence                                                                                                                                            |
| ---------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Non-draft PR → 1 message + marker                                   | PASS (no-reviewers); reviewer-path DEFERRED | Scenario 1 PR #4 run `25466097247`; Scenario 6 PR #5 ready_for_review run `25466190913`. Reviewer-path tested via Plan 02-01 unit tests (Path A → Path B swap deferred to Phase 3). |
| 2. concurrency + permissions declared correctly                        | PASS   | Scenario 5 — three load-bearing literals confirmed in remote `notify.yml`; caller-side `permissions:` block also confirmed in both sandbox-repo-a/b stubs. |
| 3. Re-run does not duplicate                                           | PASS   | Scenario 4 — `gh run rerun 25466097247` → `skipped: marker already present` log line + user-confirmed zero second Slack post + marker preserved.    |
| 4. Drafts: zero posts; ready_for_review fires exactly once             | PASS   | Scenario 6 — PR #5 draft-open run `25466183128` skipped; ready_for_review run `25466190913` posted exactly one root.                                |
| 5. Bot self-loop defenses                                              | PASS   | Scenario 7 — zero `edited`/`synchronize` runs across all 5 sandbox PRs (caller `types:` first line); Plan 02-01 unit tests for runtime FLT-01 (second line). |
| 6. Cold-start under ~5s; runs from committed `dist/`                   | PASS   | Scenario 8 — `Run PR-BOT` step duration on PR #4 run `25466097247`: 2s. No `npm install` step.                                                       |

All six ROADMAP success criteria are met. Criterion 1 is met for the no-reviewer path live and for the with-reviewer path via deterministic unit tests; the live with-reviewer test is structurally blocked by Path A and is the one acceptable deferral.

### Deferred items (acknowledged, not blockers for Phase 2 closure)

- **Scenario 2 with-reviewers Path A → Path B swap.** Pre-Phase-3 task. Tracked in docs/SANDBOX.md banner and `.planning/STATE.md` Deferred Items table. Resolution: invite a real second human (e.g., a personal alt account or willing collaborator) into the `pr-bot-sandbox` Slack workspace, capture their Slack `U…` ID, and replace `dummy-reviewer: U0B20676JVB` in `config/users.yml` with `<their-github-login>: <their-Slack-id>`. Then re-run Scenario 2 as part of Phase 3 reviewer-flow validation. Unblocks: THRD-03 (post-open reviewer add).

### Pre-Phase-3 unblock checklist

- [ ] Path A → Path B swap (above): replace `dummy-reviewer` in `config/users.yml` with a real GitHub login + Slack ID before running Phase 3 reviewer-flow tests.
- [ ] (Optional, deferred to Phase 4 by design) Cut a `v1.0.0` immutable + `@v1` mutable major tag on `Slaanesh233-sandbox/PR-BOT` and update both caller stubs from `@main` to `@v1` (DIST-03). Sandbox can remain on `@main` through Phase 3 — Pitfall 3 documents this as the deliberate Phase-2 / Phase-3 sandbox-iteration choice.

### Notes on the live-fix journey (5 attempts to first green)

- **Three real defects surfaced and were fixed:** caller-stub `permissions:` block missing (Plan 02-02 oversight), PR-BOT visibility blocking cross-repo checkout on Free tier (architectural decision), `users.yml` key-vs-login mismatch (config-content drift).
- **One architectural decision required user approval:** PR-BOT visibility flip from private to public. User explicitly authorized after confirming non-sensitive contents.
- **Lesson for Phase 4:** the company-org rollout will inherit all three fixes by construction (the caller stub + the PR-BOT source). The visibility decision will be different at the company org (Team/Enterprise plans support same-org private cross-repo `uses:`), so the visibility-flip remediation does NOT carry forward — instead, Phase 4 will rely on org-level plan features.
- **Cold-start budget held:** even after the dist/ bundle grew from 311 KB to 2.24 MB (Plan 02-01 runtime imports), the `Run PR-BOT` step measured 2s on a real cold runner — well under the 5s budget.

### Recommendation

Phase 2 is complete with one acceptable Path-A deferral on Scenario 2 (with-reviewers live test). Both the structural test (Plan 02-01 unit tests) and the operational live test (Scenario 1 no-reviewer path) confirm OPEN-04 message generation works end-to-end. Close Phase 2 in ROADMAP.md and proceed to Phase 3 planning. Phase 3's first task should be the Path A → Path B swap so reviewer-flow tests (THRD-03) can run on real human-to-human reviewer mentions.

### Threat model outcomes (Plan 02-04 STRIDE register)

| Threat ID | Disposition (planned)         | Outcome                                                                                                          |
| --------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| T-02-25   | Spoofing — false PASS         | HELD. Each PASS scenario has user-confirmed Slack channel state in addition to action-log evidence.              |
| T-02-26   | Information Disclosure        | HELD. Validation log captures only PR numbers, run IDs, marker strings, and handler-emitted log lines — no PR body content, no comment text, no review text. |
| T-02-27   | Repudiation — premature close | HELD. The Outcome verdict is YELLOW (not GREEN) precisely because Scenario 2 is DEFERRED, not silently passed.   |
| T-02-28   | Tampering — real-traffic noise | NOT TRIGGERED. Sandbox is single-user; the only PRs in sandbox-repo-a/b were the 5 keystone test PRs.            |
| T-02-29   | DoS — broken sandbox mid-test | NOT TRIGGERED. The 3 mid-validation fixes (permissions block, visibility flip, users.yml rename) all completed cleanly without leaving stale workflow state. |
