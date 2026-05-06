# Phase 2 Keystone Validation

**Started:** 2026-05-06
**Plan:** 02-04
**Pre-flight state:**
- Plan 02-01 commits on local main: yes — `e298977` (feat handler) + `9505f34` (CI Gate 8 extension) + `a173523` (RED tests)
- Plan 02-02 commits on local main: yes — `9637616` (notify.yml) + `5595ef5` (examples/pr-bot.yml) + `18d08a5` (action.yml + CLAUDE.md fix)
- PR-BOT main pushed to Slaanesh233-sandbox/PR-BOT: yes — remote HEAD `18d08a5`; remote `dist/index.js` size = 2,239,668 bytes (2.24 MB; ≥400KB threshold)
- Remote `notify.yml` size = 3,636 bytes
- sandbox-repo-a onboarded: yes — `.github/workflows/pr-bot.yml` (sha `2c86bc30…`, 2090 bytes); workflow `PR-BOT` (id 272303596) registered + active
- sandbox-repo-b onboarded: yes — `.github/workflows/pr-bot.yml` (sha `2c86bc30…`, 2090 bytes; byte-identical to sandbox-repo-a); workflow `PR-BOT` (id 272304026) registered + active
- Local 8 CI gates: PASS — typecheck, 75/75 tests, lint, format:check, build, dist drift clean, broadcast scan, FLT-05 / FLT-06(a) Gate 8
- Slack workspace: pr-bot-sandbox; channel `#pr-bot-sandbox` (`C0B2GF3UJ01`); bot installed with scopes `chat:write` + `reactions:write`; invited per docs/SANDBOX.md C4
- Captured Slack identifiers: kai = `U0B20676JVB`; dummy-reviewer = `U0B20676JVB` (Path A — same as kai; pre-Phase-3 swap pending)

## Phase 2 ROADMAP success criteria → scenario map

| Criterion | Scenario | Status | Run/Message Evidence |
|-----------|----------|--------|----------------------|
| 1. Non-draft PR → 1 message + marker | Scenario 1 (happy path no reviewers) + Scenario 2 (with reviewers) | TBD | TBD |
| 2. Concurrency group + permissions declared | Scenario 5 (structural inspection) + opportunistic real-traffic obs in scenario 1 | TBD | TBD |
| 3. Re-run same event → no duplicate | Scenario 4 (idempotency) | TBD | TBD |
| 4. Drafts: zero posts; ready_for_review fires | Scenario 6 (draft handling) | TBD | TBD |
| 5. Bot self-loop defenses | Scenario 7 (self-loop check) | TBD | TBD |
| 6. Cold-start under ~5s | Scenario 8 (timing) | TBD | TBD |

## Scenario 1 — OPEN-04 happy path (no reviewers)

_Status: TBD_

## Scenario 2 — OPEN-04 with reviewers (Path A — dummy-reviewer reuses kai's Slack ID)

_Status: TBD — Note: cosmetic dupe expected (same `<@U…>` for author and reviewer)_

## Scenario 3 — Marker write captured

_Status: TBD_

## Scenario 4 — Idempotency (Re-run all jobs)

_Status: TBD_

## Scenario 5 — Concurrency group structure (inspection) + opportunistic real-traffic observation

_Status: TBD_

## Scenario 6 — Draft → ready_for_review path

_Status: TBD_

## Scenario 7 — Bot self-loop defenses (zero `event_action: edited` runs after PR-BOT's PATCH)

_Status: TBD_

## Scenario 8 — Cold-start timing

_Status: TBD_

## Deferred to Phase 3

- With-reviewers Path A → Path B swap (real second human in users.yml). Tracked in docs/SANDBOX.md banner; pre-Phase-3 task.

## Outcome

_Status: TBD — to be filled in by Task 4.10._
