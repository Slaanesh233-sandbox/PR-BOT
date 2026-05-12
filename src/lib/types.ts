// Pure data types — no runtime imports beyond standard lib. This module is the type root
// of `src/lib/` and must not depend on any other `src/lib/` module.
//
// Phase 1 / Plan 03a — establishes the type surface consumed by:
//   - marker.ts (this plan): ThreadTs
//   - bot-filter.ts (this plan): WebhookActor
//   - copy.ts (this plan): no type imports
//   - mentions.ts, blocks.ts, event-router.ts, config-loader.ts (Plan 03b): everything else
//
// Decisions referenced:
//   - D-02: ThreadTs is a string end-to-end; never parseFloat (FND-06).
//   - D-05: Slack ID schema regexes are anchored on both ends.
//   - D-07 SUPERSEDED 2026-05-06: PR title is NEVER rendered in any Slack message.
//     PrSummary intentionally omits title/baseRef/headRef so blocks.ts is structurally
//     prevented from echoing them (FLT-06(a)).

// Slack identifiers — anchored regex validation per D-05.
// T-01-09: anchors are load-bearing — verified by exact-substring grep in plan acceptance.
export const USERS_ID_REGEX = /^U[A-Z0-9]+$/;
export const CHANNEL_ID_REGEX = /^[CG][A-Z0-9]+$/;

export type SlackUserId = string; // brand-checked at config-load time (Plan 03b)
export type SlackChannelId = string; // brand-checked at config-load time (Plan 03b)
export type GitHubLogin = string;
export type ThreadTs = string; // CRITICAL: never parseFloat — D-02 / FND-06

export interface UsersMap {
  // Keyed by GitHubLogin; value is a validated SlackUserId.
  readonly users: Readonly<Record<GitHubLogin, SlackUserId>>;
}

export interface ChannelConfig {
  readonly channel: SlackChannelId;
}

// Mention resolution result. Two shapes (consumed by mentions.ts in Plan 03b):
//   - mapped:   real Slack-mention syntax (the angle-bracket-at-U… form) that fires a ping
//   - fallback: plain @login literal (will NOT trigger a ping; user is not in users.yml)
//
// FLT-05 invariant note: the literal Slack-mention syntax appears as a string only inside
// `mentions.ts`. This file describes the type by intent, not by example, so the FLT-05
// repo-wide grep gate stays clean.
export type ResolvedMention =
  | {
      readonly kind: 'mapped';
      readonly text: string; // produced by mentions.ts mapped path; renders to a Slack ping
      readonly login: GitHubLogin;
    }
  | {
      readonly kind: 'fallback';
      readonly text: string; // produced by mentions.ts fallback path; plain @login (no ping)
      readonly login: GitHubLogin;
    };

// Webhook actor (sender / comment.user / review.user — all share this shape from Octokit types).
export interface WebhookActor {
  readonly type?: string;
  readonly login?: string;
}

// PrSummary holds ONLY allowlisted fields (FLT-06(a) — code structure makes
// echoing PR title or branch refs into Slack impossible because those fields
// never enter this type). Adding `title`, `baseRef`, or `headRef` here is
// forbidden — see REQUIREMENTS.md FLT-06.
//
// FORBIDDEN FIELDS (do not add): title, baseRef, headRef, body. These are
// trust-boundary leaks per FLT-06(a) and D-07 (SUPERSEDED 2026-05-06).
export interface PrSummary {
  readonly number: number;
  readonly htmlUrl: string;
  readonly authorLogin: GitHubLogin;
}

// === Phase 3 — event-family allowlist summary types ====================
//
// FORBIDDEN FIELDS on every *Summary below (do not add): title, baseRef, headRef,
// body, review.body, comment.body, base.ref, head.ref. These are trust-boundary
// leaks per FLT-06(a). The CI Gate 8 grep against src/lib/blocks.ts + src/index.ts
// is the second-line defense; the type-allowlist here is the first line. Adding
// any of these fields is a trust-boundary review (and will fail typecheck on the
// type-only assertions in tests/types-shape.test.ts).
//
// `prCreatedAt` is the ISO-8601 string from payload.pull_request.created_at — the
// THRD-07 graceful-skip anchor (Pitfall 11; never use updated_at).
// `prAuthorLogin` is the original PR author — Plan 03-02 needs it for the
// strikethrough rebuild on merged/closed (the strikethrough re-renders the OPEN-04
// root line, which mentions the AUTHOR, not the merger/closer).

export interface ReviewSummary {
  // Change A 2026-05-07 — 'commented' state is router-skipped (see event-router.ts
  // classifyPullRequestReview); only approved/changes_requested reach this Summary.
  readonly state: 'approved' | 'changes_requested';
  readonly reviewerLogin: GitHubLogin;
  readonly prNumber: number;
  readonly prHtmlUrl: string;
  readonly prAuthorLogin: GitHubLogin;
  readonly prCreatedAt: string;
}

export interface IssueCommentSummary {
  readonly commenterLogin: GitHubLogin;
  readonly prNumber: number;
  readonly prHtmlUrl: string;
  readonly prAuthorLogin: GitHubLogin;
  readonly prCreatedAt: string;
}

export interface ReviewCommentSummary {
  readonly commenterLogin: GitHubLogin;
  readonly prNumber: number;
  readonly prHtmlUrl: string;
  readonly prAuthorLogin: GitHubLogin;
  readonly prCreatedAt: string;
}

export interface ReviewerRequestSummary {
  readonly requestedReviewerLogin: GitHubLogin;
  readonly requesterLogin: GitHubLogin;
  readonly prNumber: number;
  readonly prHtmlUrl: string;
  readonly prAuthorLogin: GitHubLogin;
  readonly prCreatedAt: string;
}

export interface TerminalSummary {
  // Used by both 'merged' and 'closed-without-merge' kinds. The actor login is
  // distinguished by the kind (merger on 'merged', closer on 'closed-without-merge').
  readonly actorLogin: GitHubLogin;
  readonly prNumber: number;
  readonly prHtmlUrl: string;
  readonly prAuthorLogin: GitHubLogin;
  readonly prCreatedAt: string;
  // Cumulative reviewer logins at event time; preserves order. Used by Plan 03-02
  // strikethrough rebuild to regenerate the OPEN-04 cc clause.
  readonly reviewerLogins: readonly GitHubLogin[];
}

export interface ReopenSummary {
  readonly reopenerLogin: GitHubLogin;
  readonly prNumber: number;
  readonly prHtmlUrl: string;
  readonly prAuthorLogin: GitHubLogin;
  readonly prCreatedAt: string;
  // Cumulative reviewer logins at event time; preserves order. Used by Change B
  // 2026-05-07's handleReopen to re-render the OPEN-04 cc clause inside the
  // un-struck root rebuild — parallel to TerminalSummary.reviewerLogins's role
  // in handleTerminal's strikethrough rebuild.
  readonly reviewerLogins: readonly GitHubLogin[];
}

// === Phase 3.1 — stale-check config type ====================================
//
// Validated by loadStaleCheckConfig (config-loader.ts) against config/stale-check.yml.
// Defaults applied when keys absent — see config-loader.ts JSDoc.
//
// `holidays` is the raw list from YAML; the dispatcher in Plan 03.1-02 wraps
// it (or passes through directly — the businessDaysBetween helper accepts both
// shapes via the Holidays type alias).
//
// Plan 03.1-05 schema migration (2026-05-12) — REPLACES the three v1 fields
// (staleThresholdBusinessDays, repingIntervalBusinessDays, maxPingsPerPr) with
// a single explicit per-ping schedule: pingScheduleBusinessDays. The last entry
// triggers the final-ping escalation copy (formatStaleFinalPingReply). Default
// when YAML key absent: [5, 15, 20] = week 1 + week 3 + ~month 1.
//
// FORBIDDEN FIELDS (do not add to v1; deferred per CONTEXT.md "Deferred ideas"):
//   - per_repo_overrides
//   - per_team_routing
//   - silent_PRs_list
//   - escalation_steps
//   - mute_via_comment_token
//   - staleThresholdBusinessDays (REMOVED by Plan 03.1-05; semantics subsumed
//     by pingScheduleBusinessDays[0] as the first eligibility threshold)
//   - repingIntervalBusinessDays (REMOVED by Plan 03.1-05; cooldown semantics
//     subsumed by the schedule[K-1] alignment — ping K fires when
//     businessDaysOpen >= schedule[K-1] AND currentPingCount === K-1)
//   - maxPingsPerPr (REMOVED by Plan 03.1-05; cap is now schedule.length —
//     the validator bounds the array to length 1..10)

export interface StaleCheckConfig {
  readonly holidays: readonly string[];
  readonly maxAgeDays: number;
  readonly pingScheduleBusinessDays: readonly number[];
}

// Event-router output (consumed by event-router.ts in Plan 03b): a description of what to do,
// NOT the side-effect itself.
export type RoutedEvent =
  | { readonly kind: 'open'; readonly pr: PrSummary; readonly reviewers: readonly GitHubLogin[] }
  | { readonly kind: 'thread-reply'; readonly text: string; readonly emoji?: string }
  | { readonly kind: 'skip'; readonly reason: string }
  | { readonly kind: 'review-submitted'; readonly summary: ReviewSummary }
  | { readonly kind: 'pr-comment'; readonly summary: IssueCommentSummary }
  | { readonly kind: 'review-comment'; readonly summary: ReviewCommentSummary }
  | { readonly kind: 'reviewer-requested'; readonly summary: ReviewerRequestSummary }
  | { readonly kind: 'merged'; readonly summary: TerminalSummary }
  | { readonly kind: 'closed-without-merge'; readonly summary: TerminalSummary }
  | { readonly kind: 'reopened'; readonly summary: ReopenSummary };
