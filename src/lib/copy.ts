// Copy module — pure-string helpers for Slack message text.
//
// D-06 SUPERSEDED 2026-05-07: per-event count is ALWAYS rendered as
//   `published N comment(s) on the pull request` (PR-conversation thread reply via
//   formatPrCommentReply) or
//   `published N inline comment(s) on the pull request` (review-comment thread reply
//   via formatReviewCommentReply),
//   regardless of N. The original singular special-case from D-06 is gone; `s` suffix
//   is conditional on N >= 2 only. N <= 0 / non-integer still throws RangeError to
//   fail loudly rather than silently emit empty copy. Locked-spec source:
//   .planning/quick/20260507-001-phase-3-copy-refresh/.
//
// REVIEW_VERDICT lookup table is gone — verbs and emoji are inlined in formatReviewReply
// for clarity (each user-visible string is a locked spec; no indirection).
//
// FLT-05 invariant precondition: this file MUST NOT contain Slack user-mention
//   syntax (the angle-bracket-at-U… form) in any string literal. The actual
//   user-mention rendering happens only in `mentions.ts` (Plan 03b). Verbs and
//   emoji here are channel-safe glyphs. Phase-3 formatters take ALREADY-RESOLVED
//   ResolvedMention values and use only their `.text` property — the formatters
//   never construct mention syntax themselves.
//
// D-20 / FLT-03: this file MUST NOT contain broadcast-mention tokens
//   (the bang-here / bang-channel / bang-everyone forms, or their @-prefixed
//   equivalents). Plan 04 ships the CI gate that enforces this on every PR.

import type { ResolvedMention } from './types.js';

// === Phase 3 — bare-name reaction lookups (Pitfall 3) =====================
// Lookups carry BARE emoji names (no colons) — that's what slack.reactions.add
// expects. The colon-wrapped form (e.g. ':tada:') lives only inline in the
// formatters' user-visible message text. Mixing them yields 'invalid_name' from
// the Slack API.
//
// Locked-spec 2026-05-08: the root-message reaction surface is RESERVED EXCLUSIVELY
// for terminal-state events (merge / close-without-merge). Review-submitted events
// (approve / changes_requested) produce thread replies ONLY — no root reactions.
// This keeps the at-a-glance channel scan binary: emoji-on-root ↔ PR is in a
// terminal state. Reopen clears both terminal reactions (handleReopen ×2 calls).
// REVIEW_REACTION (the prior const mapping approved/changes_requested → bare names)
// is removed because the dispatcher no longer adds root reactions for review events.

export const TERMINAL_REACTION = {
  merged: 'tada',
  closed: 'no_entry_sign',
} as const;

// === Phase 3 — approve-state thread-reply emoji pool =======================
// Per locked-spec 2026-05-08: approved-state thread replies render with a random
// emoji prefix from this pool. The dispatcher pre-picks ONE emoji per approve
// event via pickApprovedEmoji() and passes the bare name to formatReviewReply,
// which wraps it with colons inline. This is THREAD-TEXT decoration only — no
// root reaction is ever added for review events (see comment block above).
//
// Both members render as standard Slack emoji in any workspace without custom
// emoji setup: ':thumbsup:' (👍) and ':ok_hand:' (👌).

export const APPROVED_EMOJI_POOL = ['thumbsup', 'ok_hand'] as const;
export type ApprovedEmoji = (typeof APPROVED_EMOJI_POOL)[number];

/**
 * Pick a random emoji name (BARE — no colons) from APPROVED_EMOJI_POOL.
 *
 * Accepts an optional `rng: () => number` (defaults to Math.random) so tests
 * can drive deterministic picks without monkey-patching the global.
 */
export function pickApprovedEmoji(rng: () => number = Math.random): ApprovedEmoji {
  const i = Math.floor(rng() * APPROVED_EMOJI_POOL.length);
  // Safe: i ∈ [0, pool.length); pool length is a literal 2 at the type level.
  return APPROVED_EMOJI_POOL[i]!;
}

// === Phase 3 — per-event reply-text formatters ============================
// Every formatter takes ALREADY-RESOLVED ResolvedMention objects. Their .text
// property carries the appropriate string (mapped: the Slack mention syntax that
// fires a real ping; fallback: a plain @login that does not). The formatters never
// construct mention syntax themselves — that lives only in mentions.ts (FLT-05).
//
// Locked-spec 2026-05-07: every formatter uses the actor-first pattern with the
// lowercase trailing phrase "the pull request". User-visible strings are exact and
// must not be paraphrased.

/** THRD-01 review-submitted thread reply (actor-first, locked spec 2026-05-07).
 *  Change A 2026-05-07: 'commented' state is router-skipped upstream; this
 *  function only handles the two remaining verdicts (TS exhaustive — no default).
 *
 *  Change B 2026-05-08: per locked-spec, review events produce thread reply ONLY
 *  (no root reaction — see APPROVED_EMOJI_POOL comment block). The thread-reply
 *  text emoji prefix is decorative; for `approved` state the dispatcher pre-picks
 *  via pickApprovedEmoji() and passes the bare name in `approvedEmoji`. Default
 *  fallback is 'thumbsup' so callers that omit the arg get a deterministic emoji
 *  (mostly relevant for testing — production callers always pre-pick). */
export function formatReviewReply(args: {
  readonly state: 'approved' | 'changes_requested';
  readonly reviewerMention: ResolvedMention;
  readonly approvedEmoji?: ApprovedEmoji;
}): string {
  const m = args.reviewerMention.text;
  switch (args.state) {
    case 'approved': {
      const emoji: ApprovedEmoji = args.approvedEmoji ?? 'thumbsup';
      return `:${emoji}: ${m} approved the pull request`;
    }
    case 'changes_requested':
      return `:warning: ${m} requested changes on the pull request`;
  }
}

/**
 * THRD-02 PR-conversation thread reply — always explicit count (supersedes D-06).
 *
 *   formatPrCommentReply({ ..., n: 1 }) === '<m> published 1 comment on the pull request'
 *   formatPrCommentReply({ ..., n: N }) === '<m> published N comments on the pull request' (N >= 2)
 *
 * Throws RangeError for n <= 0 or non-integer n (NaN included).
 */
export function formatPrCommentReply(args: {
  readonly commenterMention: ResolvedMention;
  readonly n: number;
}): string {
  if (!Number.isInteger(args.n) || args.n < 1) {
    throw new RangeError(`formatPrCommentReply: n must be a positive integer, got ${args.n}`);
  }
  const word = args.n === 1 ? 'comment' : 'comments';
  return `${args.commenterMention.text} published ${args.n} ${word} on the pull request`;
}

/**
 * THRD-02 inline review-comment thread reply — always explicit count.
 *
 *   formatReviewCommentReply({ ..., n: 1 }) === '<m> published 1 inline comment on the pull request'
 *   formatReviewCommentReply({ ..., n: N }) === '<m> published N inline comments on the pull request' (N >= 2)
 *
 * Two functions instead of one with a discriminator: each user-visible string is
 * locked, and collapsing into one function would put the 'inline ' | '' prefix as
 * a hidden conditional in copy.ts — exactly the kind of indirection the locked
 * spec wants to avoid. Throws RangeError for n <= 0 or non-integer n.
 */
export function formatReviewCommentReply(args: {
  readonly commenterMention: ResolvedMention;
  readonly n: number;
}): string {
  if (!Number.isInteger(args.n) || args.n < 1) {
    throw new RangeError(`formatReviewCommentReply: n must be a positive integer, got ${args.n}`);
  }
  const word = args.n === 1 ? 'inline comment' : 'inline comments';
  return `${args.commenterMention.text} published ${args.n} ${word} on the pull request`;
}

/**
 * THRD-03 review_requested thread reply — locked spec 2026-05-07 drops the
 * requester-by clause; only the requested reviewer is mentioned. (Pitfall 5: the
 * top-level `requested_reviewer` field is the per-event mention target — not the
 * sender / requester.)
 */
export function formatRequestedReviewReply(args: {
  readonly requestedReviewerMention: ResolvedMention;
}): string {
  // Locked-spec 2026-05-08: copy reads correctly for BOTH first request and
  // re-request. The `pull_request: review_requested` webhook payload is
  // identical for both cases (the GitHub UI's circular-arrow "Re-request review"
  // button fires the same event as a first-time request), so the bot cannot
  // structurally distinguish them. Earlier copy "was added as a reviewer"
  // misleads on re-request (the reviewer was already a reviewer); "was
  // requested for review" reads correctly in both cases.
  return `${args.requestedReviewerMention.text} was requested for review on the pull request`;
}

/** THRD-06 reopen thread reply (actor-first, locked spec 2026-05-07). */
export function formatReopenReply(args: { readonly reopenerMention: ResolvedMention }): string {
  return `${args.reopenerMention.text} reopened the pull request`;
}

/** THRD-04 merge thread reply (actor-first, locked spec 2026-05-07). */
export function formatMergeReply(args: { readonly mergerMention: ResolvedMention }): string {
  return `:tada: ${args.mergerMention.text} merged the pull request`;
}

/** THRD-05 close-without-merge thread reply (actor-first, locked spec 2026-05-07). */
export function formatCloseReply(args: { readonly closerMention: ResolvedMention }): string {
  return `:no_entry_sign: ${args.closerMention.text} closed the pull request`;
}

/**
 * STALE-01 stale-ping thread reply (CONTEXT.md Decision 2 — locked 2026-05-08).
 *
 * Locked copy (rendered values shown by intent, not by literal syntax — the
 * comment-token convention from Plans 01-03a / 01-03b / 02-02 keeps the
 * FLT-05 angle-bracket-at-U substring out of every file except mentions.ts):
 *
 *   line 1: 📬 this PR has been open for {N} business days.
 *   line 2: (two spaces) cc {author-mention} {reviewer1-mention} {reviewer2-mention} ...
 *
 * The leading 📬 emoji is a literal char (U+1F4EC), distinguishing stale-pings
 * from review thread replies (':thumbsup:' / ':ok_hand:' / ':warning:') and
 * terminal events (':tada:' / ':no_entry_sign:'). The newline + two-space
 * indent before 'cc' is exactly '\n  ' — same pattern as buildRootMessage's
 * OPEN-04 cc clause.
 *
 * Author is ALWAYS rendered, even when reviewerMentions is empty (zero-
 * reviewer edge case from CONTEXT.md Decision 2: cc {author-mention} alone —
 * the author at least learns their PR is stale and can find a reviewer).
 *
 * The formatter takes ALREADY-RESOLVED ResolvedMention objects and uses .text
 * only — FLT-05 invariant. Mention-syntax construction lives only in
 * `mentions.ts`. Both mapped and fallback mentions flow through unchanged
 * (mapped: real Slack ping; fallback: plain @login that does not ping).
 *
 * Throws RangeError for businessDaysOpen < 1 or non-integer (parity with
 * formatPrCommentReply / formatReviewCommentReply existing range-checks).
 * The dispatcher in Plan 03.1-02 will never pass N < 3 (the staleness
 * threshold) but the formatter is defensive.
 *
 * STAT-01 re-lock 2026-05-08 invariant: the stale-ping is a THREAD REPLY only.
 * This formatter emits TEXT only — there is no reactions-related primitive
 * that a dispatcher could mistake for a root-message reaction trigger.
 */
export function formatStalePingReply(args: {
  readonly businessDaysOpen: number;
  readonly authorMention: ResolvedMention;
  readonly reviewerMentions: readonly ResolvedMention[];
}): string {
  if (!Number.isInteger(args.businessDaysOpen) || args.businessDaysOpen < 1) {
    throw new RangeError(
      `formatStalePingReply: businessDaysOpen must be a positive integer, got ${args.businessDaysOpen}`,
    );
  }
  const ccTexts = [args.authorMention.text, ...args.reviewerMentions.map((m) => m.text)].join(' ');
  return `📬 this PR has been open for ${args.businessDaysOpen} business days.\n  cc ${ccTexts}`;
}
