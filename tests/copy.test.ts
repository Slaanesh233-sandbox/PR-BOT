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
// 2026-05-08: REVIEW_REACTION lookup table REMOVED — review-submitted events no
// longer add root reactions per locked-spec (root reaction surface reserved for
// terminal-state events). Approved-state thread-reply emoji is now picked at
// dispatch time via pickApprovedEmoji() from APPROVED_EMOJI_POOL. TERMINAL_REACTION
// remains (still consumed by handleTerminal + handleReopen in src/index.ts).

import { describe, expect, it } from 'vitest';

import {
  APPROVED_EMOJI_POOL,
  TERMINAL_REACTION,
  formatCloseReply,
  formatMergeReply,
  formatPrCommentReply,
  formatReopenReply,
  formatRequestedReviewReply,
  formatReviewCommentReply,
  formatReviewReply,
  formatStalePingReply,
  pickApprovedEmoji,
} from '../src/lib/copy.js';
import type { ResolvedMention } from '../src/lib/types.js';

describe('APPROVED_EMOJI_POOL + pickApprovedEmoji (locked-spec 2026-05-08; thread-reply text only — no root reaction)', () => {
  it("contains exactly the two locked-spec entries: 'thumbsup' and 'ok_hand'", () => {
    expect(APPROVED_EMOJI_POOL).toEqual(['thumbsup', 'ok_hand']);
  });
  it('every member is a BARE emoji name (no colons; Pitfall 3)', () => {
    for (const name of APPROVED_EMOJI_POOL) {
      expect(name.includes(':')).toBe(false);
    }
  });
  it('pickApprovedEmoji with rng → 0 returns the first pool member (thumbsup)', () => {
    expect(pickApprovedEmoji(() => 0)).toBe('thumbsup');
  });
  it('pickApprovedEmoji with rng → 0.999 returns the last pool member (ok_hand)', () => {
    expect(pickApprovedEmoji(() => 0.999)).toBe('ok_hand');
  });
  it('pickApprovedEmoji with rng → 0.5 returns the second member (Math.floor boundary)', () => {
    // Math.floor(0.5 * 2) === 1 → second member.
    expect(pickApprovedEmoji(() => 0.5)).toBe('ok_hand');
  });
  it('pickApprovedEmoji with rng → 0.499 returns the first member (Math.floor boundary)', () => {
    // Math.floor(0.499 * 2) === 0 → first member.
    expect(pickApprovedEmoji(() => 0.499)).toBe('thumbsup');
  });
  it('pickApprovedEmoji default rng returns one of the pool members', () => {
    // Smoke test: 50 calls, every result is a valid pool member.
    for (let i = 0; i < 50; i++) {
      const picked = pickApprovedEmoji();
      expect(APPROVED_EMOJI_POOL).toContain(picked);
    }
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

describe('formatReviewReply (THRD-01 — actor-first, locked spec 2026-05-07; emoji random per locked-spec 2026-05-08)', () => {
  const m = (text: string): ResolvedMention => ({ kind: 'mapped', text, login: 'r' });
  it("approved with explicit approvedEmoji='thumbsup' → ':thumbsup: <reviewer> approved the pull request'", () => {
    expect(
      formatReviewReply({
        state: 'approved',
        reviewerMention: m('<@U123>'),
        approvedEmoji: 'thumbsup',
      }),
    ).toBe(':thumbsup: <@U123> approved the pull request');
  });
  it("approved with explicit approvedEmoji='ok_hand' → ':ok_hand: <reviewer> approved the pull request'", () => {
    expect(
      formatReviewReply({
        state: 'approved',
        reviewerMention: m('<@U123>'),
        approvedEmoji: 'ok_hand',
      }),
    ).toBe(':ok_hand: <@U123> approved the pull request');
  });
  it("approved without approvedEmoji defaults to 'thumbsup' (deterministic test fallback)", () => {
    expect(formatReviewReply({ state: 'approved', reviewerMention: m('<@U123>') })).toBe(
      ':thumbsup: <@U123> approved the pull request',
    );
  });
  it("changes_requested → ':warning: <reviewer> requested changes on the pull request' (approvedEmoji ignored)", () => {
    expect(formatReviewReply({ state: 'changes_requested', reviewerMention: m('<@U123>') })).toBe(
      ':warning: <@U123> requested changes on the pull request',
    );
  });
  it('fallback mention text flows through unchanged (approve case with picked emoji)', () => {
    expect(
      formatReviewReply({
        state: 'approved',
        reviewerMention: { kind: 'fallback', text: '@unmapped', login: 'unmapped' },
        approvedEmoji: 'ok_hand',
      }),
    ).toBe(':ok_hand: @unmapped approved the pull request');
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
  it('formatRequestedReviewReply → "<reviewer> was requested for review on the pull request" (locked-spec 2026-05-08; reads correctly for first-request AND re-request)', () => {
    expect(
      formatRequestedReviewReply({
        requestedReviewerMention: m('<@URev>'),
      }),
    ).toBe('<@URev> was requested for review on the pull request');
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

describe('formatStalePingReply (STALE-01 — locked copy 2026-05-08, CONTEXT.md Decision 2)', () => {
  const mapped = (text: string, login = 'u'): ResolvedMention => ({ kind: 'mapped', text, login });
  const fallback = (text: string, login = 'u'): ResolvedMention => ({
    kind: 'fallback',
    text,
    login,
  });

  it('zero reviewers → cc clause is single author mention', () => {
    expect(
      formatStalePingReply({
        businessDaysOpen: 3,
        authorMention: mapped('<@UAuth>'),
        reviewerMentions: [],
      }),
    ).toBe('📬 this PR has been open for 3 business days.\n  cc <@UAuth>');
  });

  it('one reviewer → author + reviewer in order', () => {
    expect(
      formatStalePingReply({
        businessDaysOpen: 3,
        authorMention: mapped('<@UAuth>'),
        reviewerMentions: [mapped('<@URev1>')],
      }),
    ).toBe('📬 this PR has been open for 3 business days.\n  cc <@UAuth> <@URev1>');
  });

  it('three reviewers → all rendered in input order, single-space joined', () => {
    expect(
      formatStalePingReply({
        businessDaysOpen: 4,
        authorMention: mapped('<@UAuth>'),
        reviewerMentions: [mapped('<@URev1>'), mapped('<@URev2>'), mapped('<@URev3>')],
      }),
    ).toBe(
      '📬 this PR has been open for 4 business days.\n  cc <@UAuth> <@URev1> <@URev2> <@URev3>',
    );
  });

  it('fallback-kind author mention flows through as plain @login (FLT-05 inheritance)', () => {
    expect(
      formatStalePingReply({
        businessDaysOpen: 3,
        authorMention: fallback('@kai', 'kai'),
        reviewerMentions: [],
      }),
    ).toBe('📬 this PR has been open for 3 business days.\n  cc @kai');
  });

  it('N=8 renders as "8 business days" (no thousand-separator, no float)', () => {
    expect(
      formatStalePingReply({
        businessDaysOpen: 8,
        authorMention: mapped('<@UAuth>'),
        reviewerMentions: [],
      }),
    ).toContain('8 business days');
  });

  it('throws RangeError on N=0', () => {
    expect(() =>
      formatStalePingReply({
        businessDaysOpen: 0,
        authorMention: mapped('<@UAuth>'),
        reviewerMentions: [],
      }),
    ).toThrow(RangeError);
  });

  it('throws RangeError on non-integer N (3.5, NaN)', () => {
    expect(() =>
      formatStalePingReply({
        businessDaysOpen: 3.5,
        authorMention: mapped('<@UAuth>'),
        reviewerMentions: [],
      }),
    ).toThrow(RangeError);
    expect(() =>
      formatStalePingReply({
        businessDaysOpen: Number.NaN,
        authorMention: mapped('<@UAuth>'),
        reviewerMentions: [],
      }),
    ).toThrow(RangeError);
  });

  it('mixed mapped + fallback reviewer mentions all flow through via .text', () => {
    expect(
      formatStalePingReply({
        businessDaysOpen: 5,
        authorMention: mapped('<@UAuth>'),
        reviewerMentions: [mapped('<@UMapped>'), fallback('@unmapped', 'unmapped')],
      }),
    ).toBe(
      '📬 this PR has been open for 5 business days.\n  cc <@UAuth> <@UMapped> @unmapped',
    );
  });
});
