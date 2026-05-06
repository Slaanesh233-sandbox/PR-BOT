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

// Event-router output (consumed by event-router.ts in Plan 03b): a description of what to do,
// NOT the side-effect itself.
export type RoutedEvent =
  | { readonly kind: 'open'; readonly pr: PrSummary; readonly reviewers: readonly GitHubLogin[] }
  | { readonly kind: 'thread-reply'; readonly text: string; readonly emoji?: string }
  | { readonly kind: 'skip'; readonly reason: string };
