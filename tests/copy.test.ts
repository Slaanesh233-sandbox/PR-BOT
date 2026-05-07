// Tests for src/lib/copy.ts.
//
// D-06: comment-count grammar special-cases the singular form:
//   N=1 → 'commented'  (NOT the awkward 'published 1 comments')
//   N>1 → 'published N comments'
// N≤0 is invalid; we throw RangeError to fail loudly rather than emit empty copy.
//
// REVIEW_VERDICT lookup table provides emoji + verb for each review state.

import { describe, expect, it } from 'vitest';

import {
  REVIEW_REACTION,
  REVIEW_VERDICT,
  TERMINAL_REACTION,
  commentGrammar,
  formatCloseReply,
  formatCommentReply,
  formatMergeReply,
  formatReopenReply,
  formatRequestedReviewReply,
  formatReviewReply,
} from '../src/lib/copy.js';
import type { ResolvedMention } from '../src/lib/types.js';

describe('commentGrammar', () => {
  it("returns 'commented' for the singular case (N=1) — D-06 special case", () => {
    expect(commentGrammar(1)).toBe('commented');
  });

  it("returns 'published 2 comments' for N=2", () => {
    expect(commentGrammar(2)).toBe('published 2 comments');
  });

  it("returns 'published 5 comments' for N=5", () => {
    expect(commentGrammar(5)).toBe('published 5 comments');
  });

  it('throws RangeError for N=0 (invalid input per D-06)', () => {
    expect(() => commentGrammar(0)).toThrow(RangeError);
  });

  it('throws RangeError for negative or non-integer N', () => {
    expect(() => commentGrammar(-1)).toThrow(RangeError);
    expect(() => commentGrammar(1.5)).toThrow(RangeError);
    expect(() => commentGrammar(Number.NaN)).toThrow(RangeError);
  });
});

describe('REVIEW_VERDICT', () => {
  it("approved: emoji ':white_check_mark:', verb 'approved'", () => {
    expect(REVIEW_VERDICT.approved.emoji).toBe(':white_check_mark:');
    expect(REVIEW_VERDICT.approved.verb).toBe('approved');
  });

  it("changes_requested: emoji ':warning:', verb 'requested changes'", () => {
    expect(REVIEW_VERDICT.changes_requested.emoji).toBe(':warning:');
    expect(REVIEW_VERDICT.changes_requested.verb).toBe('requested changes');
  });

  it("commented: emoji ':speech_balloon:', verb 'commented'", () => {
    expect(REVIEW_VERDICT.commented.emoji).toBe(':speech_balloon:');
    expect(REVIEW_VERDICT.commented.verb).toBe('commented');
  });
});

describe('REVIEW_REACTION (Pitfall 3 — bare names for reactions.add)', () => {
  it("approved is the bare name 'white_check_mark' (no colons)", () => {
    expect(REVIEW_REACTION.approved).toBe('white_check_mark');
  });
  it("changes_requested is the bare name 'warning'", () => {
    expect(REVIEW_REACTION.changes_requested).toBe('warning');
  });
  it("'commented' key is intentionally absent (STAT-01 — no reaction for comment-only review)", () => {
    expect((REVIEW_REACTION as { commented?: string }).commented).toBeUndefined();
  });
});

describe('TERMINAL_REACTION (Pitfall 3 — bare names)', () => {
  it("merged is 'tada'", () => {
    expect(TERMINAL_REACTION.merged).toBe('tada');
  });
  it("closed is 'no_entry_sign'", () => {
    expect(TERMINAL_REACTION.closed).toBe('no_entry_sign');
  });
});

describe('formatReviewReply (THRD-01)', () => {
  const m = (text: string): ResolvedMention => ({ kind: 'mapped', text, login: 'r' });
  it("approved → ':white_check_mark: approved by ' + reviewer mention", () => {
    expect(formatReviewReply({ state: 'approved', reviewerMention: m('<@U123>') })).toBe(
      ':white_check_mark: approved by <@U123>',
    );
  });
  it("changes_requested → ':warning: requested changes by '", () => {
    expect(
      formatReviewReply({ state: 'changes_requested', reviewerMention: m('<@U123>') }),
    ).toBe(':warning: requested changes by <@U123>');
  });
  it("commented → ':speech_balloon: commented by '", () => {
    expect(formatReviewReply({ state: 'commented', reviewerMention: m('<@U123>') })).toBe(
      ':speech_balloon: commented by <@U123>',
    );
  });
  it('fallback mention text flows through unchanged', () => {
    expect(
      formatReviewReply({
        state: 'approved',
        reviewerMention: { kind: 'fallback', text: '@unmapped', login: 'unmapped' },
      }),
    ).toBe(':white_check_mark: approved by @unmapped');
  });
});

describe('formatCommentReply (THRD-02 grammar pass-through)', () => {
  const m = (text: string): ResolvedMention => ({ kind: 'mapped', text, login: 'c' });
  it("n=1 → mention + ' commented'", () => {
    expect(formatCommentReply({ commenterMention: m('<@U123>'), n: 1 })).toBe(
      '<@U123> commented',
    );
  });
  it("n=2 → mention + ' published 2 comments'", () => {
    expect(formatCommentReply({ commenterMention: m('<@U123>'), n: 2 })).toBe(
      '<@U123> published 2 comments',
    );
  });
  it("n=5 → 'published 5 comments'", () => {
    expect(formatCommentReply({ commenterMention: m('<@U123>'), n: 5 })).toBe(
      '<@U123> published 5 comments',
    );
  });
  it('throws on n=0 (delegated to commentGrammar)', () => {
    expect(() => formatCommentReply({ commenterMention: m('x'), n: 0 })).toThrow(RangeError);
  });
});

describe('formatRequestedReviewReply / formatReopenReply / formatMergeReply / formatCloseReply', () => {
  const m = (text: string): ResolvedMention => ({ kind: 'mapped', text, login: 'x' });
  it('formatRequestedReviewReply → review requested from <reviewer> by <requester>', () => {
    expect(
      formatRequestedReviewReply({
        requestedReviewerMention: m('<@URev>'),
        requesterMention: m('<@UReq>'),
      }),
    ).toBe('review requested from <@URev> by <@UReq>');
  });
  it("formatReopenReply → mention + ' reopened'", () => {
    expect(formatReopenReply({ reopenerMention: m('<@UReo>') })).toBe('<@UReo> reopened');
  });
  it("formatMergeReply → ':tada: merged by ' + mention", () => {
    expect(formatMergeReply({ mergerMention: m('<@UMerg>') })).toBe(':tada: merged by <@UMerg>');
  });
  it("formatCloseReply → ':no_entry_sign: closed by ' + mention", () => {
    expect(formatCloseReply({ closerMention: m('<@UClos>') })).toBe(
      ':no_entry_sign: closed by <@UClos>',
    );
  });
});
