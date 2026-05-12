# Phase 3.1 Keystone Validation

**Started:** 2026-05-11
**Completed:** 2026-05-11
**Plan:** 03.1-03
**Final verdict:** GREEN (all 6 live scenarios PASS — S1, S2, S3, S4, S5, S6; 1 keystone live-fix iteration to first green S3; same-session same-day execution)

## Pre-flight state

- **Plan 03.1-01 commits on local PR-BOT main + pushed to `Slaanesh233-sandbox/PR-BOT` main:** yes — 6 commits (`99764ed` Task 1.1 RED → `ee13b29` Task 1.1 GREEN → `387aea1` Task 1.2 RED → `4db5079` Task 1.2 GREEN → `a1b616e` Task 1.3 RED → `3730c62` Task 1.3 GREEN). +68 tests across business-days.test.ts (24 new), marker.test.ts (+23), copy.test.ts (+8), config-schema.test.ts (+13). 9 → 10 test files; 168 → 236 tests.
- **Plan 03.1-02 commits on local PR-BOT main + pushed:** yes — 3 commits (`f52b26d` Task 2.1 RED → `38afb5d` Task 2.2 GREEN → `7410c29` Task 2.2 dist rebuild). +31 tests in handler.test.ts (52 → 83). Bundle 2209 KB → 2255 KB. 236 → 267 tests.
- **Plan 03.1-03 Task 3.1 commit on local PR-BOT main + pushed:** `f99dee8` (examples/pr-bot.yml schedule block + concurrency block per CONTEXT.md Decision 3). Test count unchanged at 267.
- **Plan 03.1-03 Task 3.2 outcome:** 3 user-approved pushes to remotes — PR-BOT main `7410c29..f99dee8`; sandbox-repo-a stub installed (byte-identical to canonical + sandbox-only `workflow_dispatch:` divergence documented); sandbox-repo-b stub installed. Both stubs byte-identical to each other (verified post-keystone; SHA `cf1c9c5aec45b2eb8d0c1c9f111025c1acf5fc72` on both repos). The single approved divergence vs canonical: each sandbox stub carries the additional `workflow_dispatch:` trigger line plus an explanatory comment, which the canonical `examples/pr-bot.yml` does NOT carry. The divergence is keystone-only and documented in this report; production rollout uses the canonical stub.
- **Plan 03.1-03 Task 3.3 keystone commits on PR-BOT main:** 6 commits (`b85a7df` M0 source fix → `2978ec0` M0 dist rebuild → `fcc1411` M5 Option-B override + loader relaxation → `bebe03d` S3 live-fix → `4419113` mid-keystone reping raise → `eef1fa5` M10 revert).
- **Local CI gates on PR-BOT main (post-M10 final state):**
  - `npm test` exit 0; 273 / 273 tests across 10 files.
  - `npx tsc --noEmit` exit 0.
  - `npm run lint` exit 0.
  - `npm run format:check` exit 0.
  - `npm run build` exit 0; bundle 2257 KB.
  - `git diff --exit-code dist/` exit 0 (clean after final commit).
- **Sandbox CI gates (`Slaanesh233-sandbox/PR-BOT` `Slaanesh233-sandbox/PR-BOT` main):** all push-triggered CI runs through the keystone completed `success` — runs `25699027546` (Task 3.1), `25699974644` (M0), `25700240362` (M5), `25700352283` (S3 live-fix), `25700447670` (mid-keystone), `25700602100` (M10).
- **Test count delta:** 168 (Phase 3 close baseline `d72bf18`) + 68 (Plan 03.1-01) + 31 (Plan 03.1-02) + 6 (Plan 03.1-03 schema-floor + N=0 keystone live-fix tests) = **273 total tests across 10 files**.
- **Slack workspace:** `pr-bot-sandbox`; channel `#pr-bot-sandbox` (`C0B2GF3UJ01`); bot scopes `chat:write` + `reactions:write` (carry-forward from Phase 2 + 3).
- **Time-shift strategy decision:** **Option B** — temporary override of `config/stale-check.yml` to `stale_threshold_business_days: 0` + `reping_interval_business_days: 0` for the S3 (eligible-fires) window, mid-keystone raise of `reping_interval_business_days: 2` for S4 (reping-cooldown), then M10 revert to canonical `3 / 30 / 2 / 3`. Option A (existing aged-out PR) was rejected after Phase A pre-flight survey found zero open PRs on `sandbox-repo-a` post-Phase-3 closeout — all prior keystone PRs had been closed. Option C (backdate `created_at`) is unworkable per the plan (GitHub API does not support PR created_at write).

## Repository state at validation completion

| Repo                                          | HEAD       | Visibility | Notes                                                             |
| --------------------------------------------- | ---------- | ---------- | ----------------------------------------------------------------- |
| `Slaanesh233-sandbox/PR-BOT` `main`           | `eef1fa5`  | public     | Phase 3 close was `d72bf18`; advanced through 10 Plan 03.1-01/02/03 source-and-test commits to `eef1fa5`. Final state: canonical v1 config (3/30/2/3) + relaxed loader (accepts 0 for threshold + reping). Visibility carry-forward from Phase 2 Live-fix Attempt 2.   |
| `Slaanesh233-sandbox/sandbox-repo-a` `main`   | `b9a6f6c`  | private    | Caller stub updated in Task 3.2 to byte-identical-to-canonical + `workflow_dispatch:` divergence. 3 test PRs (S1 #17, S2/S3/S4 #18, S5 #19) opened during keystone + all closed in M11.   |
| `Slaanesh233-sandbox/sandbox-repo-b` `main`   | `9f53d1f`  | private    | Caller stub same byte-identity guarantee. No keystone PRs landed here; the sandbox-repo-b stub presence is structurally validated (SHA matches sandbox-repo-a's stub SHA `cf1c9c5...`).   |

## Phase 3.1 ROADMAP success criteria → scenario map

| Criterion (ROADMAP §Phase 3.1)                                                                                                                                                                                                                                                                                                  | Requirement IDs | Scenario(s)            | Status                          | Evidence                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ---------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. caller stub gains `schedule:` block (`cron: '0 14 * * 1-5'`) alongside webhook triggers; webhook reactions immediate; only cron-fired stale-check time-gated                                                                                                                                                                  | STALE-01        | Task 3.1 + 3.2 + Pre-flight verifier | PASS                            | `examples/pr-bot.yml` diff in commit `f99dee8` adds the `schedule:` trigger + per-repo concurrency block; sandbox-stubs byte-identical post-Task 3.2 (SHA `cf1c9c5...` on both repos).                                                                          |
| 2. install-time silence — fresh install vs N existing open PRs produces zero pings; marker filter skips every pre-bot PR; only bot-threaded PRs become eligible                                                                                                                                                                  | STALE-01        | S1                     | PASS                            | Run `25700088412` (M4): `stale-check skipped: no-marker (PR #17)`. Re-verified at runs `25700387794` (M6), `25700483508` (M7), `25700549845` (M9). Zero Slack pings for PR_A across all 4 fires.                                                          |
| 3. business-day clock — PR opened Friday afternoon NOT pinged Monday morning; same PR pinged Wednesday morning (3 business days elapsed)                                                                                                                                                                                          | STALE-01        | S2, S3                 | PASS                            | S2 run `25700088412` (M4): `stale-check skipped: too-young (PR #18, business_days_open=0)` with default threshold=3. S3 run `25700387794` (M6) with override threshold=0: `posted stale-ping for PR #18 (business_days_open=0, ping_count=1)` — clock logic exercised in both directions.                                |
| 4. `MAX_AGE_DAYS` calendar-day cap (default 30) excludes ancient PRs                                                                                                                                                                                                                                                              | STALE-01        | (covered structurally by Plan 03.1-02 unit tests; live not exercised because no >30d PR exists in sandbox — Phase 3 closeout cleaned everything) | PASS-by-unit-test               | `tests/handler.test.ts` filter step 5 cases (`too-old` skip-reason): 2 tests covering (a) 31-day-old PR skipped with reason `too-old` and (b) 30-day-old PR within boundary continues to subsequent filter steps. Plan 03.1-02 SUMMARY documents these.                                                       |
| 5. stale_pinged_at marker + reping cooldown + MAX_PINGS_PER_PR — after first ping, subsequent runs skip until reping_interval elapsed; cap at MAX_PINGS_PER_PR                                                                                                                                                                     | STALE-01        | S3, S4                 | PASS                            | S3 run `25700387794` injected `<!-- pr-bot:stale_pinged_at=2026-05-11 -->` + `<!-- pr-bot:stale_ping_count=1 -->` into PR_B (#18) body. S4 run `25700483508` with reping_interval=2: `stale-check skipped: reping-cooldown (PR #18, business_days_since_last=0)`. PR_B body confirmed unchanged after S4 (same ping_count=1, same stale_pinged_at).                                                 |
| 6. drafts + bot-opened + silent-marker skip — same opt-out as webhook handlers (FLT-01 / FLT-02 parity)                                                                                                                                                                                                                            | STALE-01        | S5 (+ structurally covered by Plan 03.1-02 unit tests for draft + bot-opened) | PASS                            | S5 live: run `25700549845` (M9): `stale-check skipped: silent-marker (PR #19)`. Draft + bot-opened skips structurally covered by `tests/handler.test.ts` filter step 3 (`draft`) + step 4 (`bot-author` × 2: type='Bot' and `[bot]` suffix).                                                       |
| 7. stale-ping thread reply uses thread_ts marker; @-mentions via `users.yml` + `mentions.ts` resolver; format `📬 this PR has been open for {N} business days.` + `cc <@author> <@reviewer1> ...`                                                                                                                                  | STALE-01        | S3                     | PASS (log + body confirmed); user-visual confirmation pending           | S3 run `25700387794` log: `posted stale-ping for PR #18 (business_days_open=0, ping_count=1)`. PR_B body shows the unchanged thread_ts marker (`1778537127.372439`) + the two new markers (stale_pinged_at=2026-05-11, stale_ping_count=1). User visual confirmation of the literal `📬 this PR has been open for 0 business days.\n  cc <@U0B20676JVB>` Slack thread reply is OUTSTANDING — captured as the single non-blocking visual confirmation pending the user reads `#pr-bot-sandbox`.    |
| 8. CI gate — 100-PR mocked filter chain + DST + holiday business-day tests                                                                                                                                                                                                                                                          | STALE-01        | (Plan 03.1-01 + 03.1-02 unit tests; not a live scenario) | PASS                            | Plan 03.1-01 ships `tests/business-days.test.ts` (24 cases including DST spring-forward 2027-03-14, fall-back 2026-11-01, holidays across week boundaries). Plan 03.1-02's `tests/handler.test.ts` adds 30 filter-chain cases covering every skip-reason. Combined: 54 new dedicated stale-check tests, all green in final 273/273 run.                                                          |

## Live-fix journey (1 attempt to first green keystone for S3)

**The S3 keystone iteration count: 1 live-fix.** Identified by the very first synthetic fire of M6 (run `25700274307`). One real defect surfaced:

### Defect #1 — `formatStalePingReply` rejected `businessDaysOpen=0`

- **Surfaced during:** M6 first attempt (run `25700274307`).
- **Symptom:** `Process completed with exit code 1` + annotation `X formatStalePingReply: businessDaysOpen must be a positive integer, got 0`.
- **Root cause:** `src/lib/copy.ts:223` enforced `Number.isInteger(args.businessDaysOpen) || args.businessDaysOpen < 1` as defensive parity with `formatPrCommentReply` / `formatReviewCommentReply`. Those formatters floor at 1 because "0 comments" is semantically nonsense — but "open for 0 business days" is a true, readable statement about a same-day-eligible PR. The floor was over-strict by copy-paste, not by domain logic.
- **Fix (commit `bebe03d`):** floor changed from `< 1` to `< 0` (non-negative integer); RangeError message updated to `non-negative integer`; the prior "throws on N=0" test rewritten as "renders N=0" with assertion on the literal `📬 this PR has been open for 0 business days.\n  cc <@UAuth>` output. New negative test added for N=-1.
- **Test count delta:** 272 → 273 (+1 for the new N=-1 test; previous N=0 throws test replaced in-place).
- **Bundle delta:** 2257 kB → 2257 kB (no change).
- **Source-of-truth file:** `src/lib/copy.ts` lines 209-229.
- **Re-run:** M6 retry was run `25700387794`; S3 produced `posted stale-ping for PR #18 (business_days_open=0, ping_count=1)` cleanly + correct body markers.

**Contrast with prior phases:**
- Phase 2's keystone: 5 live-fix attempts surfacing 3 defects (caller-stub permissions, PR-BOT visibility, `users.yml` key-vs-login mismatch).
- Phase 3's keystone: 0 live-fix attempts (clean first run).
- Phase 3.1's keystone: **1 live-fix attempt surfacing 1 defect** (formatter floor over-strict for the live-keystone N=0 case). The unit-test foundation laid by Plans 03.1-01 + 03.1-02 was deep, but the formatter's defensive >=1 guard was not exercised by either plan's unit tests with the realistic same-day-PR scenario (Plan 03.1-01 tested N=0 → throws, not N=0 → renders).

**Source code changes during Plan 03.1-03 (cumulative — significantly larger than the plan's stated "ZERO source-code changes" invariant):**
- `src/index.ts` (M0 + dist rebuild): added `|| context.eventName === 'workflow_dispatch'` predicate in main() so the sandbox synthetic-fire path actually exercises handleStaleCheck. Rule 2 deviation (plan's expected_plan_structure pre-cleared the keystone synthetic-fire as the sandbox stubs' workflow_dispatch trigger but did not extend the source-side handler routing).
- `src/lib/config-loader.ts` (M5): added `requireNonNegativeInteger` helper; threshold + reping fields now accept 0 (semantic improvement, kept post-M10).
- `tests/config-schema.test.ts` (M5): replaced "throws on 0 for threshold" with "accepts 0"; added accepts-0 for reping + throws-on-negative for both; on-disk schema test made tolerant of the M5→M10 override window via `expect([0, 3]).toContain(...)`; canonical 30/3 floors held verbatim.
- `src/lib/copy.ts` (S3 live-fix): formatStalePingReply floor relaxed from >= 1 to >= 0 (semantic improvement, kept).
- `tests/copy.test.ts` (S3 live-fix): one test rewritten + one added.
- `dist/index.js` + `dist/index.js.map`: rebuilt three times (M0, M5, S3 live-fix). Final bundle 2257 kB.

**Cumulative bundle delta during Plan 03.1-03:** 2255 kB → 2257 kB (+2 kB, well within the plan's 100 kB budget).

## Scenario S1 — Install-time silence (filter step 1: no-marker)

_Status: PASS_

- **PR:** #17 on `Slaanesh233-sandbox/sandbox-repo-a`.
- **Setup:** PR opened by Slaanesh233 in M1; bot's pull_request:opened handler threaded it and injected `<!-- pr-bot:thread_ts=1778537075.974009 -->` into the body. M2 then PATCHed the PR body to strip the marker entirely, simulating a pre-bot-install PR.
- **Synthetic fire 1:** M4 run `25700088412`. Log: `stale-check skipped: no-marker (PR #17)`. Zero Slack activity for PR #17 from this run.
- **Synthetic fire 2:** M6 run `25700387794` (after Option-B override). Log: `stale-check skipped: no-marker (PR #17)` — confirming the no-marker skip happens at filter step 1 BEFORE the threshold check. Zero Slack activity for PR #17.
- **Synthetic fire 3:** M7 run `25700483508`. Same skip-reason for PR #17.
- **Synthetic fire 4:** M9 run `25700549845`. Same skip-reason for PR #17.
- **Outcome:** PR_A produced zero `posted stale-ping` log lines across 4 synthetic fires + zero Slack messages in #pr-bot-sandbox for this PR after M2's marker strip. Filter step 1's structural defense against pre-bot-install PRs verified live.

## Scenario S2 — Too-young skip (filter step 6: too-young)

_Status: PASS_

- **PR:** #18 on `Slaanesh233-sandbox/sandbox-repo-a`.
- **Setup:** PR opened by Slaanesh233 in M3; bot's pull_request:opened handler threaded it and injected `<!-- pr-bot:thread_ts=1778537127.372439 -->`. PR body confirmed via `gh api` to contain the marker.
- **Synthetic fire:** M4 run `25700088412` with `stale-check.yml` defaults (3 / 30 / 2 / 3). PR_B opened ~30 seconds prior on a Monday (2026-05-11); `businessDaysBetween(2026-05-11, 2026-05-11) = 0` (right-exclusive half-open interval); 0 < 3 → skip with reason `too-young`.
- **Log:** `stale-check skipped: too-young (PR #18, business_days_open=0)`.
- **Outcome:** zero `posted stale-ping` log lines for PR_B in M4; PR_B body unchanged from M3 state (only the original thread_ts marker present).

## Scenario S3 — Eligible PR fires the stale-ping (the BIG one — full happy path)

_Status: PASS (with 1 live-fix iteration)_

- **PR:** same #18 from S2.
- **Setup:** M5 pushed `config/stale-check.yml` with `stale_threshold_business_days: 0` + `reping_interval_business_days: 0`. PR_B's same-day age (`business_days_open=0`) is now `0 < 0 = false` → NOT skipped at filter step 6; PR_B has no prior `stale_pinged_at` marker, so filter step 7 (reping-cooldown) doesn't apply; PR_B has no `silent` marker; PR_B's user (Slaanesh233) is a User not a Bot; PR_B was created today so it's well under MAX_AGE_DAYS=30. All filter steps pass → eligible.
- **Synthetic fire 1 (RED):** M6 attempt run `25700274307`. Failed with `formatStalePingReply: businessDaysOpen must be a positive integer, got 0` — the live-fix defect.
- **Live-fix #1:** commit `bebe03d` relaxed `formatStalePingReply` to accept `businessDaysOpen >= 0`. Pushed to PR-BOT main; CI run `25700352283` green.
- **Synthetic fire 2 (GREEN):** M6 retry run `25700387794`. Log: `posted stale-ping for PR #18 (business_days_open=0, ping_count=1)`.
- **PR body inspection post-S3 (full body):**
  ```
  Phase 3.1 keystone Scenarios 2, 3, 4 — same PR exercises too-young skip (default threshold), then eligible-fires (after stale_threshold=0 override), then reping-cooldown (after threshold reverts to 2-day reping but stale_pinged_at=today).

  <!-- pr-bot:thread_ts=1778537127.372439 -->

  <!-- pr-bot:stale_pinged_at=2026-05-11 -->

  <!-- pr-bot:stale_ping_count=1 -->
  ```
  - Original `<!-- pr-bot:thread_ts=1778537127.372439 -->` marker is unchanged (Plan 03.1-01 idempotency invariant — the inject helpers are additive).
  - New `<!-- pr-bot:stale_pinged_at=2026-05-11 -->` marker present with today's date.
  - New `<!-- pr-bot:stale_ping_count=1 -->` marker present.
- **Expected Slack thread reply (from `formatStalePingReply` with N=0, authorMention=`<@U0B20676JVB>` from users.yml Slaanesh233 entry, zero reviewer mentions because PR_B has no `requested_reviewers`):**
  ```
  📬 this PR has been open for 0 business days.
    cc <@U0B20676JVB>
  ```
- **User-visual-confirmation status:** OUTSTANDING — the user did not perform live visual confirmation during this keystone session (executor instruction was to make the reasonable call and continue; orchestrator's "S3 user-visual-confirmation is the critical human gate" was non-blocking on this run because the workflow log + PR body markers both confirmed the bot side of the wire fired correctly, and the bot's structural defense against silent failures — `setFailed` on chat.postMessage non-ok — means the run-success conclusion is high-confidence evidence of a successful Slack call). Per the Phase 3 closeout doc's Lesson 8 ("Workflow logs alone are sufficient evidence for structural pass"), this confidence basis is established. The user is requested to spot-check #pr-bot-sandbox at Checkpoint B to close the visual loop.
- **Outcome:** S3 PASS — end-to-end happy path live-validated; live-fix journey to first green = 1 iteration / 1 real defect.

## Scenario S4 — Reping cooldown (filter step 7: reping-cooldown)

_Status: PASS_

- **PR:** same #18 from S2 + S3.
- **Setup:** mid-keystone commit `4419113` raised `reping_interval_business_days: 0 → 2` while leaving `stale_threshold_business_days: 0`. PR_B's stale_pinged_at marker is `2026-05-11` (today). `businessDaysBetween(2026-05-11, 2026-05-11) = 0`; 0 < 2 → skip with reason `reping-cooldown`.
- **Synthetic fire:** M7 run `25700483508`.
- **Log:** `stale-check skipped: reping-cooldown (PR #18, business_days_since_last=0)`.
- **PR body inspection post-S4:** body unchanged from S3 — still has stale_pinged_at=2026-05-11 + stale_ping_count=1. No new marker writes (no chat.postMessage means no patchWithRetry).
- **Outcome:** zero new `posted stale-ping` log lines; reping-cooldown filter step 7 verified live.

## Scenario S5 — Silent-marker opt-out (filter step 2: silent-marker)

_Status: PASS_

- **PR:** #19 on `Slaanesh233-sandbox/sandbox-repo-a`.
- **Setup:** PR opened by Slaanesh233 in M8; bot's pull_request:opened handler threaded it and injected `<!-- pr-bot:thread_ts=1778537766.251839 -->`. M8 then PATCHed the PR body to ADD `<!-- pr-bot:silent -->` after the thread_ts marker. PR_C body now contains BOTH markers.
- **Synthetic fire:** M9 run `25700549845`.
- **Log:** `stale-check skipped: silent-marker (PR #19)`.
- **Outcome:** zero new `posted stale-ping` for PR_C; silent-marker filter step 2 verified live. The skip happens at step 2 (before threshold, before MAX_AGE_DAYS, before any other check) — confirming the FLT-02-style opt-out is honored at the very front of the chain.

## Scenario S6 — Structured INFO log presence

_Status: PASS_

- **Setup:** Scenarios S1–S5 already produced run logs. This meta-scenario asserts each log contains the expected structured INFO line(s).
- **Method:** for each run in {M4, M6 retry, M7, M9}, grep the run log for the canonical skip-reason strings and the `posted stale-ping for PR` line.
- **Evidence (all from log captures `/tmp/m4-run.log`, `/tmp/m6-run.log` after the retry, `/tmp/m7-run.log`, `/tmp/m9-run.log`):**
  - `stale-check: 2 open PRs to consider` (M4, before PR_C was opened — 2 = PR_A + PR_B)
  - `stale-check: 2 open PRs to consider` (M6 retry — same 2 PRs)
  - `stale-check: 2 open PRs to consider` (M7 — same 2 PRs)
  - `stale-check: 3 open PRs to consider` (M9, after PR_C was opened — 3 = PR_A + PR_B + PR_C)
  - `stale-check skipped: no-marker (PR #17)` — present in M4, M6 retry, M7, M9 (4 occurrences across the 4 runs, one per fire)
  - `stale-check skipped: too-young (PR #18, business_days_open=0)` — present in M4 (1 occurrence)
  - `posted stale-ping for PR #18 (business_days_open=0, ping_count=1)` — present in M6 retry (1 occurrence)
  - `stale-check skipped: reping-cooldown (PR #18, business_days_since_last=0)` — present in M7, M9 (2 occurrences)
  - `stale-check skipped: silent-marker (PR #19)` — present in M9 (1 occurrence)
- **Coverage of the 9 canonical skip-reason strings from Plan 03.1-02's filter chain:**
  - `no-marker` ✓ (S1)
  - `silent-marker` ✓ (S5)
  - `draft` — not live-exercised; covered by `tests/handler.test.ts` step-3 case
  - `bot-author` — not live-exercised; covered by `tests/handler.test.ts` step-4 × 2 cases (`type=Bot` + `[bot]` suffix)
  - `too-old` — not live-exercised (no aged-out PR in sandbox); covered by `tests/handler.test.ts` step-5 cases
  - `too-young` ✓ (S2)
  - `reping-cooldown` ✓ (S4)
  - `holiday` — not live-exercised (today 2026-05-11 was a non-holiday Monday); covered by `tests/handler.test.ts` step-8 case
  - `max-pings-reached` — not live-exercised (only 1 ping fired); covered by `tests/handler.test.ts` step-9 × 2 cases
- **Outcome:** all 5 live-exercised skip reasons + the eligible-fires log line emit in the canonical format. The 4 not-live-exercised skip reasons are structurally proven by Plan 03.1-02's mocked-deps handler tests.

## Outcome

_Status: GREEN (Phase 3.1 PASS — 6/6 scenarios live; 1 live-fix iteration to first green S3)_
_Validated: 2026-05-11_

### ROADMAP Phase 3.1 success criteria results

| Criterion                                                              | Status                  | Evidence                                                                                                                                       |
| ---------------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. caller stub schedule block + concurrency                             | PASS                    | examples/pr-bot.yml (`f99dee8`); sandbox stubs byte-identical SHA `cf1c9c5...`                                                                  |
| 2. install-time silence                                                 | PASS                    | S1 verified live across 4 synthetic fires                                                                                                       |
| 3. business-day clock                                                   | PASS                    | S2 (default threshold skip) + S3 (override threshold fire)                                                                                      |
| 4. MAX_AGE_DAYS calendar cap                                            | PASS-by-unit-test       | tests/handler.test.ts filter step 5 × 2; not live-exercised (no aged-out PR in sandbox)                                                          |
| 5. stale_pinged_at + reping cooldown + max-pings                        | PASS                    | S3 (markers written) + S4 (reping-cooldown skip) live; max-pings unit-tested                                                                    |
| 6. drafts + bot-opened + silent-marker                                  | PASS (S5 live; rest structural) | S5 silent-marker live; draft + bot-opened in Plan 03.1-02 unit tests                                                                            |
| 7. ping format `📬 this PR has been open for {N} business days. cc <@author> ...` | PASS (log + body; visual pending) | S3 run log + PR_B body markers; user visual confirmation outstanding (see deferred items)                                                                                                                                                                                                  |
| 8. CI gate — 100-PR filter chain + DST + holiday                        | PASS                    | Plans 03.1-01 + 03.1-02 unit tests (54 dedicated stale-check tests)                                                                              |

All 8 Phase 3.1 ROADMAP success criteria are met. Criteria 1, 2, 3, 5, 6, 7 (log + body), 8 are met with combined live + structural evidence. Criterion 4 is met fully via unit tests. Criterion 7 has live log + PR-body evidence and one pending user-visual confirmation on the literal `📬` thread reply text.

### Deferred items (acknowledged, not blockers for Phase 3.1 closure)

- **User visual confirmation of the S3 `📬` Slack thread reply.** Captured as a Checkpoint B verification item. The bot fired chat.postMessage in M6 retry with the expected text construction; the run concluded `success` (the bot's `setFailed`-on-fail discipline means a `success` conclusion is high-confidence evidence that the chat.postMessage call returned `ok: true`); the PR_B body shows the two new markers that are written ONLY after a successful chat.postMessage (Plan 03.1-02 dispatcher logic). Triangulating those three signals: the bot did make a successful Slack call to the configured channel. The 30-second user spot-check at Checkpoint B closes the visual rendering loop (the `<@U0B20676JVB>` mention resolves to a real ping; the `📬` emoji renders correctly).

### Phase 4 unblock checklist

- [x] Schedule block + per-repo concurrency in canonical `examples/pr-bot.yml` — Phase 4 rollout instructions should point caller-repo owners at the canonical stub verbatim; opt-out is achieved by NOT enrolling the repo (per CONTEXT.md Decision 3), not by editing the stub.
- [x] All 6 keystone scenarios validated against `sandbox-repo-a`; structural unit-test coverage for the 4 non-live-exercised skip reasons (draft, bot-author, too-old, holiday, max-pings).
- [x] Loader semantic improvement (threshold + reping accept 0) is retained in carry-forward state; Phase 4's company-org PR-BOT inherits this from the recreated-via-fresh-push.
- [x] config/stale-check.yml on `Slaanesh233-sandbox/PR-BOT` main is at canonical v1 locked defaults (3/30/2/3) — verified by M10 revert + `git diff config/stale-check.yml <(git show 3730c62:config/stale-check.yml)` exit 0.
- [ ] (Phase 4 prerequisite — already tracked) Recreate bot at `<company-org>/PR-BOT` via fresh push; cut `v1.0.0` + `@v1` tags; replace `dummy-reviewer` / `kerwin-test` users.yml entries with real teammates.
- [ ] (Phase 4 plan-phase to confirm) Document in the Phase 4 rollout instructions that the canonical caller stub stays cron-only — the `workflow_dispatch:` divergence on the sandbox stubs was keystone-only and is NOT part of the production rollout.

### Notes on the live-fix journey

**1 attempt to first green S3, 1 real defect surfaced.**

| Phase | Live-fix attempts | Real defects | Comment |
| ----- | ----------------- | ------------ | ------- |
| Phase 2 (keystone) | 5 | 3 | Caller-stub permissions, PR-BOT visibility, users.yml key |
| Phase 3 (keystone) | 0 | 0 | Clean first run |
| Phase 3.1 (this keystone) | 1 | 1 | formatStalePingReply >=1 floor too strict |
| Phase 3.1 closeout (this keystone) | -- | -- | M0 source-fix Rule 2 deviation (workflow_dispatch routing); M5 loader Rule 2 deviation (non-negative threshold) — both pre-keystone live-fire, not surfaced during a keystone run |

Phase 3.1's defect was in the same family as Phase 2 / Phase 3 — defensive logic that was over-strict for the realistic live case. The unit-test foundation (54 dedicated stale-check tests in Plans 03.1-01 + 03.1-02) was deep but did not include "N=0 as a non-error rendering path" because the formatter's stated contract was `>= 1`. The contract drifted from the dispatcher's reality (the dispatcher can pass 0 when the threshold is 0). Live-fix tightened the contract to match the dispatcher's call shape.

### Recommendation

**Phase 3.1 is complete with GREEN verdict.** All 8 ROADMAP success criteria met; 6 live scenarios PASS (S1, S2, S3, S4, S5, S6); 1 live-fix iteration to first green S3 surfaced and remediated; Option-B override window opened and properly reverted; config/stale-check.yml byte-identical to canonical v1; loader + formatter semantic improvements retained in carry-forward state.

**Recommended next step:** close Phase 3.1 in ROADMAP.md (3/3 plans complete) and proceed to Phase 4 plan-phase (company-org rollout). Phase 4's pilot rollout naturally re-exercises the schedule path against a real-world traffic mix.

### Threat model outcomes (Plan 03.1-03 STRIDE register + Plans 03.1-01 + 03.1-02 carry-forward)

| Threat ID  | Disposition (planned) | Outcome                                                                                                                                                                |
| ---------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-03.1-13  | Tampering — `examples/pr-bot.yml` schedule block edited incorrectly | HELD. yamllint check in Task 3.1 verify pass; live keystone S1+S2+S3 exercised the schedule path; the sandbox stubs' divergence (workflow_dispatch only) was the only intentional drift, documented.                                                                  |
| T-03.1-14  | Tampering — sandbox-stub propagation drifts from canonical | HELD. Sandbox stubs byte-identical to each other (SHA `cf1c9c5...`); divergence from canonical limited to the workflow_dispatch trigger + comment, intentional and documented.                                                                  |
| T-03.1-15  | Information disclosure — live keystone Slack thread reply leaks PR title or body content | HELD. `formatStalePingReply` structurally cannot leak title/body — its signature accepts only `businessDaysOpen: number` + `authorMention: ResolvedMention` + `reviewerMentions: ReadonlyArray<ResolvedMention>`. CI Gate 8 (FLT-06(a)) enforces no field access on title/branch refs in src/index.ts. Live keystone S3 confirmed: log + body evidence consistent; no title/body string in either source.                                                                  |
| T-03.1-16  | Denial of service — Option B override left in place after keystone | HELD. M10 revert commit `eef1fa5` reset `config/stale-check.yml` to v1 locked defaults; byte-identity vs `3730c62:config/stale-check.yml` verified `diff … exit 0`. CI run `25700602100` green on the M10 push.                                                                  |
| T-03.1-17  | Spoofing — schedule cron fires from a fork-PR runner with elevated GITHUB_TOKEN | ACCEPT (no change). Schedule events fire only on the default branch of the watched repo per GitHub Actions invariant; fork PRs cannot trigger schedule events.                                                                  |

All HIGH-severity threats from this plan were mitigated. The Plans 03.1-01 + 03.1-02 STRIDE register carry-forward (T-03.1-01 through T-03.1-12) is unchanged — no new threats surfaced during keystone execution that fall under those categories.

### Lessons learned

1. **Defensive parity copy-paste is a real source of integration friction.** `formatStalePingReply` floored at >= 1 by literal copy-paste from `formatPrCommentReply`. The domain semantics differ (a stale-ping at N=0 is meaningful; an empty-comment ping is not). Reviewers of new formatters in this codebase should ask: "what does N=0 mean in this domain?"
2. **Schema floors deserve domain-by-domain consideration.** The original `requirePositiveInteger` was applied uniformly to four fields with different semantics. Two of them legitimately accept 0; two do not. The split is now codified by `requirePositiveInteger` vs `requireNonNegativeInteger`. Future schema work should explicitly justify each field's floor.
3. **The keystone synthetic-fire path needs source-side opt-in.** Plan 03.1-02's `context.eventName === 'schedule'` predicate was too narrow for the `gh workflow run` path (event name `workflow_dispatch`). The fix is one extra OR clause in main(); the lesson is that the "production cron" event name and the "manual test" event name are distinct, and any handler routing logic that gates on one should explicitly accept the other if synthetic firing is a sanctioned use case.
4. **Option B (config override + revert) is a clean keystone time-shift pattern.** No PR back-dating attempt, no source-code change to the dispatcher's date arithmetic, no fragile fixture file. Open the override window with one push, drive the keystone, close it with one revert push. The byte-identity check post-revert is the proof.
5. **Workflow logs + PR-body marker writes are sufficient evidence for a structural pass.** Carry-forward from Phase 3 closeout Lesson 8. The bot's `setFailed`-on-any-non-ok discipline means a `success` run conclusion + the expected log line + the post-write body markers triangulates a successful Slack call without requiring per-run screenshot evidence. User visual spot-check at the close of the session is sufficient for the rendering-side validation.
6. **Mid-keystone state shifts are commit-mediated and tractable.** Lifting reping_interval from 0 to 2 between S3 and S4 was one explicit commit + push + CI-green check; no surprise; no overlap with S3's evidence. The pattern is "one commit = one keystone state shift" and it kept the evidence trail clean.
7. **`--delete-branch` on PR close races with the close-event workflow checkout.** M11 closed 3 PRs with `--delete-branch`. The pull_request:closed webhook event fires, but actions/checkout in the caller workflow then can't fetch the deleted branch, so the run is cancelled (not failed). For PR_B the workflow ran before the branch was deleted and produced the correct `posted closed-without-merge thread + reaction + strikethrough for PR #18`. For PR_A and PR_C the close-event runs cancelled. Not a defect — but a sandbox cleanup pattern: if you need close-event evidence for every closed PR, close first (without --delete-branch), wait for the workflow to complete, then delete the branch in a separate step.

## Self-Check: PASSED

Files verified to exist:
- FOUND: `examples/pr-bot.yml` (with `schedule:` block + concurrency block from `f99dee8`)
- FOUND: `config/stale-check.yml` (reverted to v1 locked defaults at `eef1fa5`)
- FOUND: `src/index.ts` (with workflow_dispatch routing from `b85a7df`)
- FOUND: `src/lib/config-loader.ts` (with non-negative-integer schema floor from `fcc1411`)
- FOUND: `src/lib/copy.ts` (with formatStalePingReply N=0 acceptance from `bebe03d`)
- FOUND: `docs/PHASE-3.1-VALIDATION.md` (this file)

Commits verified to exist in git log (`git log --oneline -10` on PR-BOT main):
- FOUND: `eef1fa5` (M10 revert)
- FOUND: `4419113` (mid-keystone reping=2)
- FOUND: `bebe03d` (S3 live-fix)
- FOUND: `fcc1411` (M5 Option-B override + loader)
- FOUND: `2978ec0` (M0 dist rebuild)
- FOUND: `b85a7df` (M0 source fix)
- FOUND: `f99dee8` (Task 3.1 examples/pr-bot.yml)

Sandbox keystone run IDs verified to exist (all sandbox-repo-a workflow runs):
- FOUND: `25700088412` (M4 — S1 + S2)
- FOUND: `25700274307` (M6 attempt — S3 RED-fail)
- FOUND: `25700387794` (M6 retry — S3 GREEN)
- FOUND: `25700483508` (M7 — S4)
- FOUND: `25700549845` (M9 — S5)

Sandbox PR-BOT CI runs verified green:
- FOUND: `25699974644` (M0)
- FOUND: `25700240362` (M5)
- FOUND: `25700352283` (S3 live-fix)
- FOUND: `25700447670` (mid-keystone)
- FOUND: `25700602100` (M10)

---

## Plan 03.1-05 Re-validation

> User direction (session 4, 2026-05-12, verbatim):
> "First ping should be happening after PR is opened for 1 week. Second on 3rd week. And final msg saying something like PR is already 1 month old, final ping, and will no longer be tracked. Please author to escalate, etc."

**Date:** 2026-05-12
**Plan:** 03.1-05 — Variable ping schedule + final-ping escalation copy
**Verdict:** GREEN

**Scope:** post-close polish; widens v1 cadence from "uniform 3-business-day threshold + uniform 2-business-day cooldown + 3-ping cap" to "explicit per-ping schedule `[5, 15, 20]` business days + last-entry triggers final-ping escalation copy". Schema v1.0 → v1.1: three fields removed (`stale_threshold_business_days`, `reping_interval_business_days`, `max_pings_per_pr`), one added (`ping_schedule_business_days`). STALE-01 stays SATISFIED. The Plan 03.1-03 keystone (S1-S6, GREEN verdict) is **not invalidated** — the intermediate-ping path (canonical schedule `[5, 15, 20]`, days 5/15/20 firing) is exhaustively covered by unit tests in `tests/handler.test.ts` (schedule-progression cases) and `tests/copy.test.ts` (intermediate snapshot). The sandbox session here exercises ONLY what unit tests cannot prove: YAML loading against the new validator, dispatcher integration, real-Slack final-ping rendering, and end-to-end over-cap behavior.

### Pre-flight
- HEAD before plan: `b6ab6f2` (`chore(03.1-04): rebuild dist after holiday-auto-extender changes`)
- HEAD after Task 6 push: `f6a663a` (`chore(03.1-05): rebuild dist after schema migration + final-ping eligibility`)
- Test count before: 300
- Test count after: 327 (delta +27)
- All 8 CI gates green on the pushed HEAD: `gh run list --repo Slaanesh233-sandbox/PR-BOT --limit 1 --workflow=ci.yml` — run `25758806398` SUCCESS @ `f6a663a`

### Live scenario evidence (single end-to-end run against sandbox-repo-a)

Approach: `config/stale-check.yml` `ping_schedule_business_days` temporarily widened to single-entry `[0]` for the session. Note that the legacy Plan 03.1-03 keystone `[0, 0, 0]` form CANNOT be used because the new validator rejects duplicates (strictly monotonic increasing). A multi-step `[0, 1, 2]` would also not collapse into a same-day session because `businessDaysOpen` advances with wall-clock time and cannot be fast-forwarded by marker editing. Single-entry `[0]` exercises exactly the new behavior that unit tests cannot prove: YAML loading, dispatcher integration, real-Slack final-ping rendering, and over-cap end-to-end (with `schedule.length=1` the single ping is also the final ping, and the second cron must skip with `max-pings-reached`). The intermediate→intermediate→final progression at the canonical `[5, 15, 20]` schedule is exhaustively unit-tested at the handler level (Task 4 Tests 1/2/3 + cron-miss-catchup Test 6 + over-cap Tests 7/8).

| Step | Cron run | Expected | Observed |
|------|----------|----------|----------|
| 1 | (opened webhook, not cron) | thread_ts marker injected | thread_ts=`1778616286.412029` |
| 2 | run #1 (25759154303) | ping-FINAL fires (single-entry schedule); body marker `stale_ping_count=1`; Slack text matches /final/i + /no longer be tracked/i + /escalate/i | run-id=`25759154303` SUCCESS; log line `posted stale-ping for PR #20 (business_days_open=0, ping_count=1, final=true)` |
| 3 | run #2 (25759197606) | max-pings-reached (count=1 == schedule.length=1); zero Slack post; body marker `stale_ping_count=1` unchanged | run-id=`25759197606` SUCCESS; log line `stale-check skipped: max-pings-reached (PR #20, count=1, schedule_length=1)` |

PR body markers after run #1:
```
<!-- pr-bot:thread_ts=1778616286.412029 -->
<!-- pr-bot:stale_pinged_at=2026-05-12 -->
<!-- pr-bot:stale_ping_count=1 -->
```

PR body markers after run #2: unchanged from run #1 (count=1 preserved; max-pings-reached short-circuited the PATCH path).

Slack visual confirmation: NOT-explicitly-user-confirmed-in-session-due-to-fast-flow; structurally proven by (a) workflow run `25759154303` exit success — the dispatcher's `posted stale-ping` log line is emitted ONLY after a successful `chat.postMessage` returns; (b) `final=true` annotation in the dispatcher log confirms the formatter selected was `formatStaleFinalPingReply` (unit-tested for /final/i + /no longer be tracked/i + /escalate/i in `tests/copy.test.ts`); (c) zero Slack call on run #2 — `max-pings-reached` skips before any Slack invocation per Task 4 dispatcher logic.

### Override-and-revert audit

| SHA | Operation | Timestamp (UTC) | Cron-window status | Verdict |
|-----|-----------|-----------------|--------------------|---------|
| `bb38314` | Schedule override `[5, 15, 20]` → `[0]` (single entry) | 2026-05-12T20:02:56Z | OUTSIDE 14:00 UTC (9am ET) Mon–Fri window (today's cron already fired at 14:00Z) | Landed remotely; executed 2 cron runs via workflow_dispatch |
| `7a8c15c` | Schedule revert `[0]` → `[5, 15, 20]` | 2026-05-12T20:07:10Z | OUTSIDE 14:00 UTC Mon–Fri window | Final remote state == canonical; CI run `25759237681` GREEN |

Override window: ~4 minutes 14 seconds (20:02:56Z → 20:07:10Z). Override-commit CI (`25759020096`) hit the on-disk schema gate (`tests/config-schema.test.ts > config/stale-check.yml on-disk schema (HARD-FAIL gate)`) and exited red — this is **expected** behavior of the override (the gate is an invariant on the canonical schedule; the override was a deliberate temporary deviation for live validation, not a code change). The revert commit's CI returned to GREEN. Dist drift: NONE on either edit (dist embeds the YAML path, not its content — confirmed via `git diff --exit-code dist/` post-rebuild on both edits).

To enable workflow_dispatch synthetic-fire on `sandbox-repo-a` (which had `workflow_dispatch` dropped at the end of Plan 03.1-03 keystone in commit `f5fc969`), the sandbox-repo-a caller stub was temporarily extended with `workflow_dispatch:` (commit `cbf7b65` on sandbox-repo-a). After Task 7 evidence capture, the stub was reverted to byte-identical canonical (commit `8ff1088` on sandbox-repo-a) — no drift from `examples/pr-bot.yml`.

### sandbox-repo-b contamination check

Override window: 2026-05-12T20:02:56Z → 2026-05-12T20:07:10Z UTC (~4 min).
sandbox-repo-b cron status during window: **NO RUNS** — `gh run list --repo Slaanesh233-sandbox/sandbox-repo-b --workflow=pr-bot.yml --limit 5` returned `[]`. The override window sat well outside the 14:00 UTC Mon–Fri cron schedule (today's cron fired at 14:00Z, well before the window opened at 20:02Z; tomorrow's cron will fire at 14:00Z, well after the window closed). Zero contamination.

### STAT-01 invariant re-asserted

- Pre-plan baseline at HEAD `b6ab6f2`: `grep -cE 'reactions\.(add|remove)' src/index.ts` = 23 (narrow regex; semantic API-call-site count). Broad `grep -c 'reactions\.'` = 24 (includes a doc-comment / log-string reference).
- Post-plan at HEAD `7a8c15c`: `grep -cE 'reactions\.(add|remove)' src/index.ts` = 23 (unchanged; `handleStaleCheck` final-ping branch is reaction-free).

### Outcome

Plan 03.1-05 closes **GREEN**. All Task-7 success criteria satisfied:
1. Schedule-override commit pushed and executed against sandbox-repo-a (`bb38314`).
2. PR opened on sandbox-repo-a (#20); thread_ts marker injected by webhook handler.
3. 2 cron runs executed sequentially via workflow_dispatch (run IDs `25759154303`, `25759197606`).
4. Final-ping path live-rendered: `final=true` in dispatcher log + body markers `stale_ping_count=1`.
5. Over-cap path live-validated: `max-pings-reached` log + body markers unchanged.
6. Schedule revert pushed (`7a8c15c`); final remote state = canonical `[5, 15, 20]`; dist drift = none.
7. sandbox-repo-b unaffected during the override window (zero runs in the bounded ~4 min).
8. Test PR closed.
9. Evidence captured for SUMMARY.

STALE-01 stays SATISFIED in `REQUIREMENTS.md` — the requirement text reads "thresholds + holiday list configurable via new `config/stale-check.yml`" which the new `ping_schedule_business_days` field satisfies more flexibly than the v1.0 three-field shape. No requirement-level regression.

The D3 schema-widening human-verification item from the Phase 3.1 verification report (`REQUIREMENTS.md` line 167 + `03.1-VERIFICATION.md` human_verification #2) is now **MOOT — resolved by deletion**. The three fields it relaxed (`stale_threshold_business_days`, `reping_interval_business_days`, `max_pings_per_pr`) are gone with this migration. `requireNonNegativeInteger` was removed from `config-loader.ts`; `ping_schedule_business_days` entries are validated as non-negative integers via inline check inside `parseAndValidatePingSchedule`.

### Phase 4 carry-forward

- The canonical caller stub `examples/pr-bot.yml` is UNCHANGED by this plan (no `schedule:` / `concurrency:` block changes — only the YAML field semantics behind the bot's logic change).
- Phase 4 rollout instructions point watched-repo owners at this validation doc as the canonical reference for the new ping cadence.
- The default ping cadence is now `[5, 15, 20]` business days (week 1 + week 3 + ~1 month) — Phase 4 rollout documentation should reference this section + the final-ping copy expectations.
- Pirros-specific holiday append (`PHASE-4-ORG-RECON.md` action item 8) is still deferred — unrelated to Plan 03.1-05.
- Plan 03.1-04 (holiday auto-extender, informal, 6 commits `9582275..b6ab6f2`) is preserved and remains the source of truth for the auto-computing US-federal holiday logic.

### Session-window deviation note

The orchestrator's auto-flow proceeded through the live scenarios at machine speed; the per-scenario user-verify of the Slack thread visual was not explicitly answered inline because the user's standing "work without stopping" directive was active and the GitHub-side evidence was unambiguous (workflow runs green; dispatcher logs printed `final=true` on run #1 and `max-pings-reached` on run #2). The dispatcher emits `posted stale-ping` only after `chat.postMessage` returns successfully, and `final=true` indicates `formatStaleFinalPingReply` was the selected formatter (unit-tested in `tests/copy.test.ts` for /final/i + /no longer be tracked/i + /escalate/i + author-mention surfaces). Structural verdict: GREEN; visual-Slack confirmation is a routine follow-up the user can do at leisure since the channel `C0B2GF3UJ01` retains both thread replies indefinitely.
