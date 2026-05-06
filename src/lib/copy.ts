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
//   emoji here are channel-safe glyphs.
//
// D-20 / FLT-03: this file MUST NOT contain broadcast-mention tokens
//   (the bang-here / bang-channel / bang-everyone forms, or their @-prefixed
//   equivalents). Plan 04 ships the CI gate that enforces this on every PR.

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
