// Copy module — pure-string helpers for Slack message text.
//
// D-06: comment-count grammar special-cases the singular form. Spec only
//   handles N >= 1; N <= 0 is an invalid state — we throw RangeError to fail
//   loudly rather than silently emit empty copy that would surface as an
//   awkward "@author " in the channel.
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

/**
 * Render the verb phrase that follows the actor's @-mention in a Slack thread
 * reply for a comment event.
 *
 *   commentGrammar(1) === 'commented'
 *   commentGrammar(N >= 2) === 'published N comments'
 *
 * Throws RangeError for N <= 0 or non-integer N (NaN included). Per D-06 the
 * spec only defines behavior for positive integers.
 */
export function commentGrammar(n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`commentGrammar: n must be a positive integer, got ${n}`);
  }
  if (n === 1) return 'commented';
  return `published ${n} comments`;
}

/**
 * Lookup table for review-submission verdict copy: emoji + verb pair indexed
 * by GitHub's review state (`approved` / `changes_requested` / `commented`).
 * Consumed by blocks.ts and event-router.ts in Plan 03b.
 *
 * `as const` makes both keys and values literal types so consumers get exact
 * string types (e.g. `:white_check_mark:`) rather than widened `string`.
 */
export const REVIEW_VERDICT = {
  approved: { emoji: ':white_check_mark:', verb: 'approved' },
  changes_requested: { emoji: ':warning:', verb: 'requested changes' },
  commented: { emoji: ':speech_balloon:', verb: 'commented' },
} as const;

// === Phase 3 — bare-name reaction lookups (Pitfall 3) =====================
// Both lookups carry BARE emoji names (no colons) — that's what slack.reactions.add
// expects. The colon-wrapped form (e.g. ':white_check_mark:') lives only on
// REVIEW_VERDICT for inline message text. Mixing them yields 'invalid_name' from
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

/** THRD-01 review-submitted thread reply (verb pulled from REVIEW_VERDICT). */
export function formatReviewReply(args: {
  readonly state: 'approved' | 'changes_requested' | 'commented';
  readonly reviewerMention: ResolvedMention;
}): string {
  const v = REVIEW_VERDICT[args.state];
  return `${v.emoji} ${v.verb} by ${args.reviewerMention.text}`;
}

/** THRD-02 PR-comment / review-comment thread reply with comment-count grammar. */
export function formatCommentReply(args: {
  readonly commenterMention: ResolvedMention;
  readonly n: number;
}): string {
  return `${args.commenterMention.text} ${commentGrammar(args.n)}`;
}

/** THRD-03 review_requested thread reply (mentions the requested reviewer, NOT the requester — Pitfall 5). */
export function formatRequestedReviewReply(args: {
  readonly requestedReviewerMention: ResolvedMention;
  readonly requesterMention: ResolvedMention;
}): string {
  return `review requested from ${args.requestedReviewerMention.text} by ${args.requesterMention.text}`;
}

/** THRD-06 reopen thread reply. */
export function formatReopenReply(args: { readonly reopenerMention: ResolvedMention }): string {
  return `${args.reopenerMention.text} reopened`;
}

/** THRD-04 merge thread reply. */
export function formatMergeReply(args: { readonly mergerMention: ResolvedMention }): string {
  return `:tada: merged by ${args.mergerMention.text}`;
}

/** THRD-05 close-without-merge thread reply. */
export function formatCloseReply(args: { readonly closerMention: ResolvedMention }): string {
  return `:no_entry_sign: closed by ${args.closerMention.text}`;
}
