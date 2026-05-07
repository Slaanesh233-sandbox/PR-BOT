// Tests for src/lib/copy.ts.
//
// D-06 SUPERSEDED 2026-05-07: per-event count is ALWAYS rendered as
//   `published N comment(s) on the pull request` (PR-conversation thread reply via
//   formatPrCommentReply) or
//   `published N inline comment(s) on the pull request` (review-comment thread reply
//   via formatReviewCommentReply),
//   regardless of N. The original singular special-case from D-06 is gone; `s` suffix
//   is conditional on N >= 2 only. N <= 0 / non-integer still throws RangeError to
//   fail loudly rather than emit empty copy.
//
// REVIEW_REACTION + TERMINAL_REACTION lookup tables remain (still consumed by the
// dispatcher in src/index.ts).

import { describe, expect, it } from 'vitest';

import {
  REVIEW_REACTION,
  TERMINAL_REACTION,
  formatCloseReply,
  formatMergeReply,
  formatPrCommentReply,
  formatReopenReply,
  formatRequestedReviewReply,
  formatReviewCommentReply,
  formatReviewReply,
} from '../src/lib/copy.js';
import type { ResolvedMention } from '../src/lib/types.js';

describe('REVIEW_REACTION (Pitfall 3 — bare names for reactions.add)', () => {
  it("approved is the bare name 'white_check_mark' (no colons)", () => {
    expect(REVIEW_REACTION.approved).toBe('white_check_mark');
  });
  it("changes_requested is the bare name 'warning'", () => {
    expect(REVIEW_REACTION.changes_requested).toBe('warning');
  });
  it("'commented' key is absent — Change A 2026-05-07 router-skips state==='commented' upstream so the lookup is two-state-exhaustive", () => {
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

describe('formatReviewReply (THRD-01 — actor-first, locked spec 2026-05-07)', () => {
  const m = (text: string): ResolvedMention => ({ kind: 'mapped', text, login: 'r' });
  it("approved → ':white_check_mark: <reviewer> approved the pull request'", () => {
    expect(formatReviewReply({ state: 'approved', reviewerMention: m('<@U123>') })).toBe(
      ':white_check_mark: <@U123> approved the pull request',
    );
  });
  it("changes_requested → ':warning: <reviewer> requested changes on the pull request'", () => {
    expect(formatReviewReply({ state: 'changes_requested', reviewerMention: m('<@U123>') })).toBe(
      ':warning: <@U123> requested changes on the pull request',
    );
  });
  it('fallback mention text flows through unchanged', () => {
    expect(
      formatReviewReply({
        state: 'approved',
        reviewerMention: { kind: 'fallback', text: '@unmapped', login: 'unmapped' },
      }),
    ).toBe(':white_check_mark: @unmapped approved the pull request');
  });
});

describe('formatPrCommentReply (THRD-02 PR-conversation; always explicit count — supersedes D-06)', () => {
  const m = (text: string): ResolvedMention => ({ kind: 'mapped', text, login: 'c' });
  it("n=1 → '<m> published 1 comment on the pull request'", () => {
    expect(formatPrCommentReply({ commenterMention: m('<@U123>'), n: 1 })).toBe(
      '<@U123> published 1 comment on the pull request',
    );
  });
  it("n=2 → '<m> published 2 comments on the pull request'", () => {
    expect(formatPrCommentReply({ commenterMention: m('<@U123>'), n: 2 })).toBe(
      '<@U123> published 2 comments on the pull request',
    );
  });
  it("n=5 → '<m> published 5 comments on the pull request'", () => {
    expect(formatPrCommentReply({ commenterMention: m('<@U123>'), n: 5 })).toBe(
      '<@U123> published 5 comments on the pull request',
    );
  });
  it('throws RangeError on n=0 / negative / non-integer', () => {
    expect(() => formatPrCommentReply({ commenterMention: m('x'), n: 0 })).toThrow(RangeError);
    expect(() => formatPrCommentReply({ commenterMention: m('x'), n: -1 })).toThrow(RangeError);
    expect(() => formatPrCommentReply({ commenterMention: m('x'), n: 1.5 })).toThrow(RangeError);
  });
});

describe('formatReviewCommentReply (THRD-02 inline review-comment; always explicit count)', () => {
  const m = (text: string): ResolvedMention => ({ kind: 'mapped', text, login: 'c' });
  it("n=1 → '<m> published 1 inline comment on the pull request'", () => {
    expect(formatReviewCommentReply({ commenterMention: m('<@U123>'), n: 1 })).toBe(
      '<@U123> published 1 inline comment on the pull request',
    );
  });
  it("n=2 → '<m> published 2 inline comments on the pull request'", () => {
    expect(formatReviewCommentReply({ commenterMention: m('<@U123>'), n: 2 })).toBe(
      '<@U123> published 2 inline comments on the pull request',
    );
  });
  it("n=5 → '<m> published 5 inline comments on the pull request'", () => {
    expect(formatReviewCommentReply({ commenterMention: m('<@U123>'), n: 5 })).toBe(
      '<@U123> published 5 inline comments on the pull request',
    );
  });
  it('throws RangeError on n=0 / negative / non-integer', () => {
    expect(() => formatReviewCommentReply({ commenterMention: m('x'), n: 0 })).toThrow(RangeError);
    expect(() => formatReviewCommentReply({ commenterMention: m('x'), n: -1 })).toThrow(RangeError);
    expect(() => formatReviewCommentReply({ commenterMention: m('x'), n: 1.5 })).toThrow(
      RangeError,
    );
  });
});

describe('formatRequestedReviewReply / formatReopenReply / formatMergeReply / formatCloseReply (actor-first, locked spec 2026-05-07)', () => {
  const m = (text: string): ResolvedMention => ({ kind: 'mapped', text, login: 'x' });
  it('formatRequestedReviewReply → "<reviewer> was added as a reviewer on the pull request"', () => {
    expect(
      formatRequestedReviewReply({
        requestedReviewerMention: m('<@URev>'),
      }),
    ).toBe('<@URev> was added as a reviewer on the pull request');
  });
  it("formatReopenReply → '<reopener> reopened the pull request'", () => {
    expect(formatReopenReply({ reopenerMention: m('<@UReo>') })).toBe(
      '<@UReo> reopened the pull request',
    );
  });
  it("formatMergeReply → ':tada: <merger> merged the pull request'", () => {
    expect(formatMergeReply({ mergerMention: m('<@UMerg>') })).toBe(
      ':tada: <@UMerg> merged the pull request',
    );
  });
  it("formatCloseReply → ':no_entry_sign: <closer> closed the pull request'", () => {
    expect(formatCloseReply({ closerMention: m('<@UClos>') })).toBe(
      ':no_entry_sign: <@UClos> closed the pull request',
    );
  });
});
