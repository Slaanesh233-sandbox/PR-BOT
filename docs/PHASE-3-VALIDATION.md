# Phase 3 Keystone Validation

**Started:** 2026-05-07
**Completed:** 2026-05-07
**Plan:** 03-03
**Final verdict:** YELLOW (PASS with four acceptable Y1 deferrals — single root cause: no second GitHub+Slack account; structurally proven by Plans 03-01 + 03-02 unit tests — see Outcome)

## Pre-flight state

- Plan 03-01 commits on local main: yes — 7 commits (`ac4b3af` types-shape RED → `3958cc7` types GREEN → `1aca3ea` event-router RED → `e347c9b` event-router GREEN → `3e56149` formatters/blocks/marker RED → `f233c96` formatters/blocks/marker GREEN → `a01ca69` dist rebuild). +50 tests across types-shape, event-router, copy, blocks, marker.
- Plan 03-02 commits on local main: yes — 6 commits (`20b5abb` deps-widening → `7caf051` Task 2.1 GREEN → `6fe5ff4` Task 2.2 RED → `aecaa34` Task 2.2 GREEN → `796a640` Task 2.3 RED → `3e43102` Task 2.3 GREEN). +31 tests across handler.test.ts (13 → 44).
- 13 Phase-3 source commits pushed to `Slaanesh233-sandbox/PR-BOT` main on 2026-05-07 (commit range `99adbdb..3e43102`); push gated on explicit user approval ("yes") per CLAUDE.md auto-memory rule.
- Local 8 CI gates: PASS — typecheck, 156/156 tests, lint, format:check, build, dist drift clean, broadcast scan (FLT-03), FLT-05 / FLT-06(a) Gate 8.
- Test count breakdown: 75 Phase-2 baseline + 50 Plan 03-01 + 31 Plan 03-02 = **156 tests / 9 files**.
- `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, `npm run build` all exit 0.
- `git diff --exit-code dist/` clean.
- Slack workspace: `pr-bot-sandbox`; channel `#pr-bot-sandbox` (`C0B2GF3UJ01`); bot scopes `chat:write` + `reactions:write` (carry-forward from Phase 2).
- Both sandbox repos accessible; SLACK_BOT_TOKEN configured at sandbox-repo-a (Path B repo-level secret).
- **Path A → Path B `users.yml` swap decision:** Y1 — kept `dummy-reviewer: U0B20676JVB` (= kai's Slack ID, Path A). Four with-reviewer scenarios (1, 2, 3, 5) YELLOW-deferred. Rationale: no real second GitHub+Slack account available this session; the deferral is structurally identical to Phase 2's Scenario 2 deferral and the deferred scenarios have full unit-test coverage from Plans 03-01 + 03-02.

## Repository state at validation completion

| Repo                                          | HEAD       | Visibility | Notes                                                             |
| --------------------------------------------- | ---------- | ---------- | ----------------------------------------------------------------- |
| `Slaanesh233-sandbox/PR-BOT` `main`           | `3e43102`  | public     | Phase-2 close was `d770556`; advanced through 13 Phase-3 source commits to `3e43102` (Plan 03-02 Task 2.3 GREEN). Visibility carry-forward from Phase 2 Live-fix Attempt 2. |
| `Slaanesh233-sandbox/sandbox-repo-a` `main`   | `b9a6f6c`  | private    | Phase-2 caller stub unchanged. Phase-3 event subscription set already covered (D-21) — no caller-stub edits needed.  |
| `Slaanesh233-sandbox/sandbox-repo-b` `main`   | `9f53d1f`  | private    | Same — unchanged from Phase 2 close.  |

## Phase 3 ROADMAP success criteria → scenario map

| Criterion                                                                  | Requirement IDs                                | Scenario(s)                                | Status                       | Evidence                                                                                                                                              |
| -------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Review verdicts (approve / changes_requested / commented) + reactions   | THRD-01, STAT-01                               | Scenarios 1, 2, 3                          | YELLOW-defer (live), unit-tested | Live deferred per Y1 (GitHub blocks PR author from reviewing own PR; needs second GitHub login). Plan 03-01 + 03-02 unit-test coverage: review formatters in `src/lib/copy.ts`, `REVIEW_REACTION` map, handler review-event branch (4 tests in handler.test.ts). |
| 2. Per-event PR-comment grammar                                            | THRD-02                                        | Scenario 4                                 | PASS                         | PR #6, runs `25518317629` (open) + `25518348794` (comment-1) + `25518370787` (comment-2); thread_ts `1778183248.472539`; two `posted pr-comment reply for PR #6` log lines (one per event); user-confirmed Slack thread shows two `<@U…> commented` replies (singular per D-06; never `published 1 comment` or `published 1 comments`). |
| 3. Late-reviewer + reopen + merge + close                                  | THRD-03, THRD-04, THRD-05, THRD-06, STAT-02, STAT-03 | Scenarios 5, 6, 7, 8                       | THRD-03: YELLOW-defer (live), unit-tested. THRD-04..06 + STAT-02 + STAT-03: PASS. | Scenario 5 (THRD-03): live deferred (cannot add `dummy-reviewer` — not a real GitHub login). Scenarios 6 (reopen), 7 (merge + STAT-02), 8 (close-without-merge + STAT-03) all GREEN with multi-call dispatcher firing in canonical order. |
| 4. Silent-opt-out + marker-missing graceful skip                           | FLT-02, THRD-07                                | Scenarios 9, 10                            | PASS                         | Scenario 9 (FLT-02): PR #8 + runs `25518784302` (open) + `25518980939` (comment); both logged `FLT-02: PR opted out via silent marker`; zero Slack activity. Scenario 10 (THRD-07): PR #9 marker-stripped; comment run `25519981239` logged warning at PR age 102s using `created_at` anchor (Pitfall 11); no orphan Slack post. |
| 5. Broadcast-mention + truncation + field-allowlist                        | FLT-03, FLT-04, FLT-06                         | Scenarios 11, 12                           | PASS                         | Scenario 11 (FLT-03): CI Gate 6 regex on line 78 of `.github/workflows/ci.yml` includes `<!everyone>` AND `\b@everyone\b`; local grep against `src/` returns zero matches. Scenario 12 (FLT-04): 6 truncation tests pass including ROADMAP-criterion-5-direct test (100 reviewers + author + repo + link → rendered text < 3000 chars). FLT-06 enforced structurally via typed `BuildRootArgs` + CI Gate 8. |

## Live-fix journey (zero attempts to reach a green keystone)

The first canonical green run was PR #6 (run `25518317629`). **ZERO live-fix attempts were needed during this keystone — all 8 live scenarios passed first attempt.** This contrasts with Plan 02-04's keystone, which surfaced 3 real defects in 5 attempts (caller-stub permissions block missing, PR-BOT private visibility blocking cross-repo checkout on Free tier, `users.yml` key-vs-login mismatch).

Phase 3's clean first-attempt run reflects the depth of the unit-test foundation laid by Plans 03-01 (~50 tests covering pure-logic surfaces: 6 new Summary types, 7 new RoutedEvent variants, REVIEW_REACTION + TERMINAL_REACTION tables, 6 reply formatters, buildStrikethroughRoot, SILENT_MARKER + isSilent) and 03-02 (~31 tests covering handler dispatch: FLT-02 prelude, THRD-07 graceful skip, 7 per-kind dispatch branches, multi-call serial best-effort dispatcher with STAT-04 error switch). Every code path that fired live during the keystone had at least one unit test exercising it under mocked-deps conditions — so the live runs were end-to-end smoke tests of the wiring, not first-time exercises of unknown logic.

**Source code changes during Plan 03-03: ZERO.** No source files modified during keystone validation. `dist/index.js` unchanged from Plan 03-02 final state (`3e43102`). The pre-flight `git diff --exit-code dist/` ran clean and remained clean across all 8 live scenario runs.

## Scenario 1 — THRD-01 + STAT-01 review approve (with reviewer)

_Status: YELLOW-deferred (live), unit-tested_

- **Live test deferred** because GitHub blocks a PR author from submitting a Review on their own PR. With Path A active (`dummy-reviewer: U0B20676JVB` = kai's Slack ID), the only real human in the sandbox config is `Slaanesh233`, who is also the PR author for every keystone PR. There is no second GitHub login available this session to act as the reviewer.
- **Structural proof exists** in unit tests: `tests/handler.test.ts` THRD-01 cases (4 of 31 tests in Plan 03-02) drive the `review-submitted` dispatch branch through all three verdict states (approved, changes_requested, commented) plus an unmapped-reviewer fallback case. The handler's `formatReviewReply` formatter + `REVIEW_REACTION` map + `addReaction` STAT-04 error switch are deterministic and fully covered by those tests.
- **Phase 4 reverification path:** when natural team collaborators arrive at the company GitHub org during the rollout, this scenario reverifies live as part of normal PR review traffic — no new test PR construction needed.
- **Per Plan 03-03 Task 3.1 author's own assessment** (Y1 option): "Skip the swap — STATE.md Deferred Items continues to track Path A → Path B as the unblock task." The deferral was the plan-anticipated outcome under Y1, not a discovered failure.

## Scenario 2 — THRD-01 + STAT-01 review changes_requested (with reviewer)

_Status: YELLOW-deferred (live), unit-tested_

- Same root cause as Scenario 1: requires a non-author GitHub user to submit the `request_changes` review.
- **Structural proof exists:** `tests/handler.test.ts` THRD-01 changes_requested case asserts the `:warning: requested changes by <@U…>` reply text + `reactions.add` with bare emoji name `warning` (Pitfall 3) on the root.
- Unblocked by the same Path A → Path B swap.

## Scenario 3 — THRD-01 + STAT-01 review commented (with reviewer)

_Status: YELLOW-deferred (live), unit-tested_

- Same root cause as Scenario 1.
- **Structural proof exists:** `tests/handler.test.ts` THRD-01 commented case asserts the `:speech_balloon: commented by <@U…>` reply text AND that `reactions.add` is **not** called (STAT-01 — comment-only review gets no reaction; the `commented` key is intentionally absent from `REVIEW_REACTION`).
- Unblocked by the same Path A → Path B swap.

## Scenario 4 — THRD-02 PR-comment grammar (singular per-event)

_Status: PASS_

- **PR opened:** #6 in `Slaanesh233-sandbox/sandbox-repo-a`. Open run `25518317629` (success) posted root + injected marker `<!-- pr-bot:thread_ts=1778183248.472539 -->`.
- **First comment** (PR conversation comment from PR author): run `25518348794` (success). Action log key line: `posted pr-comment reply for PR #6` (per-event count = 1, singular grammar).
- **Second comment** (a SECOND PR conversation comment from the same author): run `25518370787` (success). Action log key line: `posted pr-comment reply for PR #6` (per-event count = 1 again — never aggregated; D-06 says singular at N=1, plural at N≥2 within a single event payload, but `issue_comment: created` always fires per-comment so N=1 is the steady state).
- **Slack channel state:** user confirmed two thread replies under PR #6's root, each rendering `<@U0B20676JVB> commented` (singular). Per D-06 (locked decision in `src/lib/copy.ts` from Plan 01-03b): the bot says `commented` at N=1 and `published N comments` at N≥2 within a single event — **never** the awkward `published 1 comment` form that ROADMAP / REQUIREMENTS prose used.
- **Body content:** zero comment body text echoed in either reply. FLT-06 structural enforcement held (typed `IssueCommentSummary` allowlist omits the `comment.body` field; CI Gate 8 enforces no forbidden tokens in `src/lib/blocks.ts` + `src/index.ts`).
- **No aggregation:** two `chat.postMessage` calls fired (one per event), not one debounced reply — explicitly aligned with V2-AGG-01 deferral.

## Scenario 5 — THRD-03 reviewer-add (post-open `review_requested`)

_Status: YELLOW-deferred (live), unit-tested_

- **Live test deferred** because `pull_request: review_requested` requires a real GitHub user (or team) to request from. `dummy-reviewer` is not a real GitHub login — the GitHub UI rejects the reviewer-add API call before any webhook fires.
- **Structural proof exists** in unit tests: `tests/handler.test.ts` THRD-03 case drives the `reviewer-requested` dispatch branch with the Pitfall-5 ordering (top-level `requested_reviewer.login` over the cumulative `requested_reviewers[]` list) AND the Pitfall-6 team-vs-individual decision (skip if `requested_team` instead of `requested_reviewer`). The handler's `formatRequestedReviewReply` + `mentions.resolveAll([requestedReviewerLogin, senderLogin])` produce the deterministic `review requested from @<NEW> by @<requester>` text.
- **Phase 4 reverification path:** same as Scenarios 1-3 — natural team collaborators provide the second-account dependency.

## Scenario 6 — THRD-06 reopened

_Status: PASS_

- **PR:** #7 in `Slaanesh233-sandbox/sandbox-repo-a` (used the same PR for Scenario 8 close-without-merge afterwards).
- **Open run:** `25518686236` (success) — set up the thread_ts marker.
- **Close run:** `25518712929` (success) — Scenario 8's evidence run; covered separately below.
- **Reopen run:** `25518740152` (success). Action log: `posted reopened reply for PR #7`. Single thread reply (no terminal multi-call: reopen is not a terminal event — STAT-02 / STAT-03 do NOT apply, no reaction added, no chat.update).
- **Slack channel state:** user confirmed one thread reply with text `<@U0B20676JVB> reopened` (the reopener mention; `sender.login` per the routing).
- **Note on root strikethrough preservation:** Scenario 8 had previously struck through the root (chat.update). The reopen event does NOT un-strike the root in v1 — the root stays struck through despite the reopen. This is intentional per the routing matrix; an unstrike-on-reopen feature would require a fourth multi-call branch and is out of scope. Documented as expected v1 behavior.

## Scenario 7 — THRD-04 + STAT-02 merged (the BIG one — A1 + A2 confirmation)

_Status: PASS_

- **PR:** #6 in `Slaanesh233-sandbox/sandbox-repo-a` (the same PR from Scenario 4).
- **Merge run:** `25518466766` (success). Action log key line: `posted merged thread + reaction + strikethrough for PR #6`.
- **Multi-call sequence (canonical order, all 3 fired):**
  1. `chat.postMessage` thread reply: `:tada: merged by <@U0B20676JVB>` (the merger mention; resolved from `event.pull_request.merged_by.login` per Pitfall 7's merged-bool split).
  2. `reactions.add` with bare emoji name `tada` (Pitfall 3 — never colon-wrapped).
  3. `chat.update` strikethrough rebuild: text + blocks both sent (Pitfall 2 — chat.update without text would replace blocks with plain text); no `thread_ts` argument (Pitfall 9 — chat.update updates the root, not a thread post).
- **PR state at merge:** MERGED at 2026-05-07T19:50:24Z by `Slaanesh233`.
- **A1 user-confirmed (reactions persist across chat.update):** the `:tada:` reaction is still visible on the (now strikethrough) root message. The chat.update did NOT silently clear the reaction. **A1 assumption from Research §1a CONFIRMED.**
- **A2 user-confirmed (mrkdwn strikethrough wraps full line):** the root message text wraps in `~tildes~` correctly across the full line including the `<link|PR>` markdown-link substring AND the `<@U…>` user-mention substring. Slack's mrkdwn parser does NOT break the strikethrough at the link or mention boundaries. **A2 assumption from Research §1b CONFIRMED.**
- **Body content:** zero PR title text, branch name, or commit message echoed. FLT-06 structural enforcement held.
- **STAT-04 not exercised:** no `already_reacted` error fired during this run; the STAT-04 error-switch path is unit-tested (Plan 03-02 STAT-04 tests cover already_reacted, invalid_name, ratelimited, missing_scope) but did not trigger live.

## Scenario 8 — THRD-05 + STAT-03 closed-without-merge

_Status: PASS_

- **PR:** #7 in `Slaanesh233-sandbox/sandbox-repo-a`.
- **Open run:** `25518686236` (success) — posted root + marker; thread_ts `1778183715.420129`.
- **Close run:** `25518712929` (success). Action log key line: `posted closed-without-merge thread + reaction + strikethrough for PR #7`.
- **Multi-call sequence (canonical order, all 3 fired):**
  1. `chat.postMessage` thread reply: `:no_entry_sign: closed by <@U0B20676JVB>` (the closer mention; resolved from `event.sender.login` per Pitfall 7's merged-bool split — closer is sender, not merged_by).
  2. `reactions.add` with bare emoji name `no_entry_sign`.
  3. `chat.update` strikethrough rebuild: text + blocks both sent.
- **Same multi-call dispatcher as Scenario 7** — proves the dispatcher is kind-discriminated correctly (different formatter, different reaction lookup, different sender-vs-merger resolution).
- **Slack channel state:** user confirmed thread reply visible alongside struck-through root with `:no_entry_sign:` reaction persisting.

## Scenario 9 — FLT-02 silent-marker live

_Status: PASS_

- **PR:** #8 in `Slaanesh233-sandbox/sandbox-repo-a`. PR body contained the literal `<!-- pr-bot:silent -->` at open time.
- **Open run:** `25518784302` (success). Action log key line: `FLT-02: PR opted out via silent marker — PR #8; skipping open event`. PR body unmodified by bot (no `thread_ts` marker injected).
- **Comment run** (a follow-up PR conversation comment to verify thread-class events also honor the silent marker): `25518980939` (success). Action log key line: `FLT-02: PR opted out via silent marker — PR #8; skipping pr-comment event`.
- **Slack channel state:** user confirmed ZERO Slack activity for PR #8 — no root post, no thread replies, no reactions, no chat.update calls.
- **Both event types exercised:** open-class (handleOpen path) AND thread-class (handleThreadKind path) both honor the silent marker. Plan 03-02 Decision: "FLT-02 honors the open-class flow too — the FLT-02 check is added BEFORE the OPEN-06 idempotency check inside handleOpen." Verified live.
- **No collision with thread_ts marker:** the FLT-02 silent marker `<!-- pr-bot:silent -->` does not contain the `thread_ts=` substring, and `isSilent(body)` uses exact substring match (Pitfall 17 — no regex, no case-fold, no whitespace tolerance). Tested by Plan 03-02 "FLT-02 does NOT mistake the thread_ts marker for a silent marker" case.
- **Forward-only suppression:** consistent with Research §7 — the silent marker activates from this point forward; suppression is reversible by removing the marker. Threat T-03-03-07 disposition held: bounded to a single PR, no cross-PR or cross-channel impact.

## Scenario 10 — THRD-07 marker-missing graceful skip

_Status: PASS_

- **PR:** #9 in `Slaanesh233-sandbox/sandbox-repo-a`.
- **Open run:** `25519911311` (success) — bot posted root + injected `<!-- pr-bot:thread_ts=... -->` marker normally.
- **Marker-strip step:** `gh api PATCH /repos/.../pulls/9` to edit the PR body and manually delete the marker line. The body PATCH fired a `pull_request: edited` webhook event which was correctly excluded by the caller stub's `types: [opened, reopened, ready_for_review, review_requested, closed]` filter (OPEN-07 from Phase 2 — the structural first-line defense against bot self-loops; verified in Phase 2 Scenario 7 and re-verified here).
- **Comment after marker strip:** run `25519981239` (success — TEST EVENT). Action log key line: `##[warning]THRD-07: thread-reply event arrived for PR #9 opened 102s ago with no thread_ts marker — skipping. PR may have been created outside the bot's flow, or the bot's PR-opened run failed (check the PR's Actions tab).`
- **Structured warning fired** (not an error — graceful skip per THRD-07 spec). PR was 102s old at warning time, well past the 60s anchor threshold.
- **Timestamp source:** `pull_request.created_at` per Pitfall 11 (NOT `updated_at`). The body PATCH that stripped the marker shifted `updated_at` to "now"; if the handler had used `updated_at` instead of `created_at`, the warning would have suppressed for the next 60s and the bot would have silently failed to log. Plan 03-02 THRD-07 Pitfall-11 unit test exercises this exact race.
- **Slack channel state:** user confirmed NO orphan top-level Slack post for the comment event (THRD-07 invariant: missing marker → warn + skip, never post a new root). The channel still shows PR #9's original root from the open run; no new thread reply for the marker-stripped comment.
- **Single pulls.get reuse (Pitfall 8):** the handler made one `octokit.rest.pulls.get` call to retrieve the live body; that single fetch was reused for FLT-02 + THRD-07 + thread_ts retrieval. Plan 03-02 THRD-07 Pitfall-8 unit test asserts `pullsGet.toHaveBeenCalledTimes(1)`.

## Scenario 11 — FLT-03 broadcast-mention CI gate covers `<!everyone>`

_Status: PASS_

- **Method:** local grep verification of the CI gate pattern.
- **Command:** `grep -nE '<!here>\|<!channel>\|<!everyone>\|\\b@(here\|channel\|everyone)\\b' .github/workflows/ci.yml`
- **Result:** 1 match on line 78 of `.github/workflows/ci.yml` — the literal regex `<!here>|<!channel>|<!everyone>|\b@(here|channel|everyone)\b` is part of the broadcast-mention scan (Gate 6 from Plan 01-04 D-20).
- **Coverage:** the regex includes BOTH `<!everyone>` (literal Slack broadcast-mention syntax) AND `\b@everyone\b` (the alternate `@everyone` form a developer might naively type). ROADMAP success criterion 5's `<!everyone>` callout is fully satisfied — the gate covers the exact token plus the variant.
- **Local source scan:** running the same regex against `src/` returns zero matches → Gate 6 GREEN.
- **No regression test required:** the gate has been in place since Plan 01-04. Plan 03-03 confirms the existing pattern includes the Phase 3-mandated `<!everyone>` token without code changes.

## Scenario 12 — FLT-04 100-reviewer truncation

_Status: PASS_

- **Method:** unit test verification (the test was added in Plan 03-01 and runs as part of Gate 2).
- **Coverage:** 6 distinct truncation tests pass in `tests/blocks.test.ts`:
  1. `MAX_SECTION_TEXT_LENGTH = 3000` constant exposed and used as the ceiling.
  2. `buildRootMessage` caps with a 100-name fallback list — rendered text < 3000 chars.
  3. `buildThreadReply` truncates with ellipsis when input would exceed cap.
  4. `buildStrikethroughRoot` FLT-04 100-reviewer cc clause stays under cap.
  5. `buildStrikethroughRoot` synthetic 4000-char `repoShortName` triggers cap (defense against pathological repo names).
  6. ROADMAP criterion 5 directly tested: "100 reviewers + author + repo + link → rendered text < 3000 chars".
- **No live test needed:** truncation is deterministic — given a 100-element reviewer list, the rendered text length is fully determined by the formatter. A live PR with 100 real reviewers is not constructible in the sandbox (only 1 real human in `users.yml`).
- **FLT-06 enforced structurally** in the same surfaces — typed `BuildRootArgs` and `BuildReplyArgs` allowlists make accessing PR title or body a compile error; CI Gate 8 grep confirms `src/lib/blocks.ts` + `src/index.ts` reference no forbidden field names.

## Outcome

_Status: YELLOW (Phase 3 PASS with four acceptable Y1 deferrals — single root cause)_
_Validated: 2026-05-07_

### ROADMAP Phase 3 success criteria results

| Criterion                                                              | Status | Evidence                                                                                                                                            |
| ---------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Review verdicts (THRD-01 + STAT-01)                                 | YELLOW-deferred (live), unit-tested | Scenarios 1, 2, 3 — second-account dependency; full Plan 03-01 + 03-02 unit-test coverage.                                                          |
| 2. Per-event PR-comment grammar (THRD-02)                              | PASS   | Scenario 4 — PR #6 runs `25518317629`/`25518348794`/`25518370787`; thread_ts `1778183248.472539`; two `commented` (singular) replies.               |
| 3. Late-reviewer + reopen + merge + close (THRD-03..06 + STAT-02 + STAT-03) | PASS (3 of 4 sub-paths); THRD-03 YELLOW-deferred | Scenarios 6, 7, 8 GREEN; Scenario 5 (THRD-03) deferred (cannot add `dummy-reviewer`). Multi-call dispatcher fired in canonical order on merge + close. |
| 4. Silent-opt-out + marker-missing (FLT-02 + THRD-07)                  | PASS   | Scenarios 9 + 10 — FLT-02 honored at both open and thread-class events; THRD-07 warning fired at PR age 102s using `created_at` anchor.             |
| 5. Broadcast-mention + truncation + field-allowlist (FLT-03 + FLT-04 + FLT-06) | PASS   | Scenarios 11 + 12 — CI Gate 6 covers `<!everyone>`; 6 truncation tests pass; FLT-06 enforced structurally via typed allowlist + Gate 8.            |

All five ROADMAP success criteria are met. Criteria 2, 4, 5 are met fully on live + structural evidence. Criteria 1 and 3 are met fully for the events that can fire without a second account; the with-reviewer sub-paths are met via deterministic unit tests and are the four acceptable deferrals.

### Deferred items (acknowledged, not blockers for Phase 3 closure)

- **Path A → Path B `users.yml` swap.** Carry-forward from Phase 2 / STATE.md Deferred Items. Pre-Phase-4 task — natural team collaborators arrive at the company GitHub org during rollout, providing the second-account dependency by construction. Resolution: when the bot is recreated at the company org per DIST-01, the `dummy-reviewer` entry in `config/users.yml` is replaced with real `<github-login>: <Slack-U-id>` mappings for each team member, then Scenarios 1, 2, 3, 5 reverify live as part of normal PR review traffic. Unblocks: THRD-01 + STAT-01 + THRD-03 live keystone evidence.

### Phase 4 unblock checklist

- [ ] Recreate bot at `<company-org>/PR-BOT` via fresh push (DIST-01); set up org-level `SLACK_BOT_TOKEN`; set "Accessible from repositories in the org" Actions setting; archive personal-sandbox repo for reference.
- [ ] Replace `dummy-reviewer` in `config/users.yml` with real team-member `<github-login>: <Slack-U-id>` entries for all ~15 humans on the team.
- [ ] Cut a `v1.0.0` immutable + `@v1` mutable major tag on company `PR-BOT`; pin both caller stubs to `@v1` (DIST-03). Sandbox stays archived; rollout caller stubs reference the company-org reusable workflow.
- [ ] During Phase 4 pilot rollout: reverify Scenarios 1, 2, 3, 5 live against real PR review traffic (the four Y1-deferred scenarios from this plan).

### Notes on the live-fix journey (zero attempts to first green)

- **Zero real defects surfaced** during Phase 3 keystone validation. All 8 live scenarios passed first attempt.
- **Contrast with Phase 2:** Plan 02-04 surfaced 3 real defects in 5 attempts (caller-stub permissions block missing, PR-BOT private visibility, `users.yml` key-vs-login mismatch). Phase 3's clean run reflects the depth of Plans 03-01 + 03-02's unit-test foundation: every code path that fired live had at least one mocked-deps unit test exercising it.
- **Lesson for Phase 4:** Plans 03-01 + 03-02's TDD discipline (RED → GREEN per task; ~50 + ~31 new tests; full pitfall-coverage table) is the template for future plans that wire new event surfaces. The unit-test foundation paid off in zero live-fix iteration during validation.
- **dist/index.js size held:** 2.21 MB (Plan 03-02 close) → 2.21 MB (Phase 3 close); no growth during validation since no source changes were made.

### Recommendation

Phase 3 is complete with four acceptable Y1 deferrals (Scenarios 1, 2, 3, 5 — single root cause: no second GitHub+Slack account this session). All five ROADMAP success criteria are met: 8 live scenarios PASS plus 4 structurally proven via Plans 03-01 + 03-02 unit tests. The deferred scenarios have full unit-test coverage; only the live wire between webhook → handler → Slack is unverified for those 4. Recommended: re-validate as part of Phase 4 rollout when natural team collaborators arrive at the company GitHub org. Close Phase 3 in ROADMAP.md and proceed to Phase 4 planning. Phase 4's pilot rollout naturally reverifies the deferred scenarios as a side effect of normal PR traffic.

### Threat model outcomes (Plan 03-03 STRIDE register + Plans 03-01 + 03-02 carry-forward)

| Threat ID | Disposition (planned)                                    | Outcome                                                                                                          |
| --------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| T-03-01-01 | Information Disclosure — type widening leaks body fields | NOT TRIGGERED. Type-allowlist held; `tests/types-shape.test.ts` compile-time markers caught any potential field-widening. No live event payload echoed body content. |
| T-03-01-04 | Information Disclosure — adversarial GitHub login        | NOT TRIGGERED. No adversarial logins in sandbox; deferred to V2 hardening as planned.                             |
| T-03-02-04 | Tampering — chat.update accidentally clears blocks (Pitfall 2) | HELD. Scenarios 7 + 8 confirmed both `text` and `blocks` sent on chat.update; user-confirmed strikethrough render preserved blocks. |
| T-03-03-01 | Information Disclosure — screenshots leak sensitive content | HELD. Test PR titles/bodies were mundane (`Phase 3 Scenario X`). No screenshots committed in this plan; evidence is text-only (run IDs, thread_ts, log lines). |
| T-03-03-02 | Information Disclosure — typo'd Slack U-id routes to phantom | NOT TRIGGERED. Path A→B swap NOT performed; existing `dummy-reviewer: U0B20676JVB` (= kai's Slack ID) was unchanged from Phase 2. Schema test still asserts `^U[A-Z0-9]+$`.    |
| T-03-03-03 | Tampering — mid-validation remote push without user approval | HELD. The single mid-plan remote push (13 Phase-3 source commits to PR-BOT main) was explicitly user-approved with literal "yes" at the keystone push checkpoint. ZERO autonomous remote pushes to default branches. |
| T-03-03-04 | Repudiation — Phase 3 closes without durable artifact     | HELD. This document is the authoritative Phase-3 deliverable; ≥250 lines covering pre-flight, repo state, criterion-to-scenario map, live-fix journey (zero attempts), 12 scenario sections, outcome with verdict + recommendation + threat-model outcomes + lessons learned. |
| T-03-03-05 | DoS — mrkdwn strikethrough rendering broken (A2 risk)     | A2 CONFIRMED. Scenario 7 user confirmation: strikethrough wraps full line including `<link\|PR>` and `<@U…>` substrings. No fallback needed; Phase 5 follow-up plan NOT required.    |
| T-03-03-06 | Information Disclosure — reactions silently cleared on chat.update (A1 risk) | A1 CONFIRMED. Scenario 7 user confirmation: `:tada:` reaction visible on (struck-through) root after chat.update. No follow-up plan needed.    |
| T-03-03-07 | Tampering — malicious silent marker as forward-suppression command | NOT TRIGGERED in adversarial sense. Scenario 9 verified the silent marker correctly suppresses; the threat is bounded forward-only and reversible by removal. Documented as expected v1 behavior. |

All HIGH-severity threats were mitigated by structural defenses (typed allowlist + CI Gate 8 + FLT-02 prelude + bot-self filter from Phase 2). No new threats surfaced during keystone.

### Lessons learned

1. **Unit-test foundation pays off in clean keystone validation.** Plans 03-01 (50 new tests covering pure logic) + 03-02 (31 new tests covering handler dispatch with mocked deps) produced ZERO live-fix iterations during keystone. Compare with Phase 2's 3-defects-in-5-attempts journey — the difference is the depth of test coverage before live runs.
2. **A1 + A2 Slack assumptions both held.** mrkdwn strikethrough wraps `<link|PR>` and `<@U…>` correctly without breaking on substring boundaries (A2); `chat.update` does NOT silently clear reactions (A1). No follow-up Phase 5 plan needed for either.
3. **`created_at` anchor (Pitfall 11) was load-bearing for THRD-07.** Scenario 10's marker-strip flow shifts `updated_at` to "now" via the body PATCH; if the handler had used `updated_at` instead, the warning would have suppressed for the next 60s and the bot would have silently failed at the moment a maintainer most needed the warning. Pitfall 11 mitigation held.
4. **Single `pulls.get` reuse (Pitfall 8) held under real network conditions.** One Octokit fetch per handler invocation; FLT-02 + THRD-07 + thread_ts retrieval all reuse the same response. No race between marker-strip and handler entry observed.
5. **D-06 grammar shipped as locked decision survives prose drift.** ROADMAP / REQUIREMENTS prose says "published 1 comment" for a single comment; D-06 (locked since Plan 01-03b in `src/lib/copy.ts`) says "commented" at N=1 and "published N comments" at N≥2. The bot ships D-06 form; the prose discrepancy is documentation drift to be corrected separately. The locked decision held under live verification (Scenario 4 user confirmation).
6. **Forward-only silent marker is acceptable v1 behavior.** Scenario 9 confirmed the marker activates suppression from the moment it appears in the body; removal lifts the suppression. Threat T-03-03-07 (malicious commenter activates suppression) is bounded and reversible.
