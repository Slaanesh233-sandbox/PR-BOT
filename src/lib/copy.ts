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
// Both lookups carry BARE emoji names (no colons) — that's what slack.reactions.add
// expects. The colon-wrapped form (e.g. ':white_check_mark:') lives only inline in
// the formatters' user-visible message text. Mixing them yields 'invalid_name' from
// the Slack API.
//
// STAT-01 explicit: comment-only review produces NO reaction — the 'commented' key
// is intentionally absent. Consumers that look up by review state must handle the
// undefined case (formatReviewReply still runs for 'commented' but Plan 03-02's
// dispatcher checks key existence before calling reactions.add).

export const REVIEW_REACTION = {
  approved: 'white_check_mark',
  changes_requested: 'warning',
  // 'commented' key intentionally absent — STAT-01: consumers check key existence
  // before calling reactions.add for a comment-only review verdict.
} as const;

export const TERMINAL_REACTION = {
  merged: 'tada',
  closed: 'no_entry_sign',
} as const;

// === Phase 3 — per-event reply-text formatters ============================
// Every formatter takes ALREADY-RESOLVED ResolvedMention objects. Their .text
// property carries the appropriate string (mapped: the Slack mention syntax that
// fires a real ping; fallback: a plain @login that does not). The formatters never
// construct mention syntax themselves — that lives only in mentions.ts (FLT-05).
//
// Locked-spec 2026-05-07: every formatter uses the actor-first pattern with the
// lowercase trailing phrase "the pull request". User-visible strings are exact and
// must not be paraphrased.

/** THRD-01 review-submitted thread reply (actor-first, locked spec 2026-05-07). */
export function formatReviewReply(args: {
  readonly state: 'approved' | 'changes_requested' | 'commented';
  readonly reviewerMention: ResolvedMention;
}): string {
  const m = args.reviewerMention.text;
  switch (args.state) {
    case 'approved':
      return `:white_check_mark: ${m} approved the pull request`;
    case 'changes_requested':
      return `:warning: ${m} requested changes on the pull request`;
    case 'commented':
      return `:speech_balloon: ${m} commented on the pull request`;
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
  return `${args.requestedReviewerMention.text} was added as a reviewer on the pull request`;
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
