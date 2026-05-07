// tests/types-shape.test.ts — Phase 3 Plan 03-01
//
// Type-only structural tests. The runtime body is trivial; the failure mode is
// `npm run typecheck` failing if any *Summary type is widened to include a
// forbidden field (FLT-06(a) type-allowlist). The // @ts-expect-error comments
// flip the failure mode — they expect the NEXT line to fail typecheck. If the
// underlying type ever widens, those lines stop failing and tsc emits an error.

import { describe, expect, it } from 'vitest';
import type {
  ReviewSummary,
  IssueCommentSummary,
  ReviewCommentSummary,
  ReviewerRequestSummary,
  TerminalSummary,
  ReopenSummary,
  RoutedEvent,
} from '../src/lib/types.js';

describe('types — RoutedEvent discriminator coverage', () => {
  it('has every Phase-3 kind literal in the union', () => {
    const sentinels = [
      { kind: 'open', pr: { number: 1, htmlUrl: '', authorLogin: '' }, reviewers: [] },
      { kind: 'thread-reply', text: '' },
      { kind: 'skip', reason: '' },
      {
        kind: 'review-submitted',
        summary: {
          state: 'approved',
          reviewerLogin: '',
          prNumber: 1,
          prHtmlUrl: '',
          prAuthorLogin: '',
          prCreatedAt: '',
        },
      },
      {
        kind: 'pr-comment',
        summary: {
          commenterLogin: '',
          prNumber: 1,
          prHtmlUrl: '',
          prAuthorLogin: '',
          prCreatedAt: '',
        },
      },
      {
        kind: 'review-comment',
        summary: {
          commenterLogin: '',
          prNumber: 1,
          prHtmlUrl: '',
          prAuthorLogin: '',
          prCreatedAt: '',
        },
      },
      {
        kind: 'reviewer-requested',
        summary: {
          requestedReviewerLogin: '',
          requesterLogin: '',
          prNumber: 1,
          prHtmlUrl: '',
          prAuthorLogin: '',
          prCreatedAt: '',
        },
      },
      {
        kind: 'merged',
        summary: {
          actorLogin: '',
          prNumber: 1,
          prHtmlUrl: '',
          prAuthorLogin: '',
          prCreatedAt: '',
          reviewerLogins: [],
        },
      },
      {
        kind: 'closed-without-merge',
        summary: {
          actorLogin: '',
          prNumber: 1,
          prHtmlUrl: '',
          prAuthorLogin: '',
          prCreatedAt: '',
          reviewerLogins: [],
        },
      },
      {
        kind: 'reopened',
        summary: {
          reopenerLogin: '',
          prNumber: 1,
          prHtmlUrl: '',
          prAuthorLogin: '',
          prCreatedAt: '',
        },
      },
    ] satisfies readonly RoutedEvent[];
    expect(sentinels.length).toBe(10);
  });
});

describe('types — FLT-06 forbidden-fields allowlist (compile-time)', () => {
  it('ReviewSummary does NOT have body / title fields', () => {
    const sample: ReviewSummary = {
      state: 'approved',
      reviewerLogin: 'kai',
      prNumber: 1,
      prHtmlUrl: '',
      prAuthorLogin: 'kai',
      prCreatedAt: '2026-01-01T00:00:00Z',
    };
    // @ts-expect-error — body must NOT be present on ReviewSummary (FLT-06)
    void sample.body;
    // @ts-expect-error — title must NOT be present on ReviewSummary (FLT-06)
    void sample.title;
    expect(sample.state).toBe('approved');
  });

  it('IssueCommentSummary does NOT have body field', () => {
    const sample: IssueCommentSummary = {
      commenterLogin: 'kai',
      prNumber: 1,
      prHtmlUrl: '',
      prAuthorLogin: 'kai',
      prCreatedAt: '2026-01-01T00:00:00Z',
    };
    // @ts-expect-error — body must NOT be present (FLT-06)
    void sample.body;
    expect(sample.commenterLogin).toBe('kai');
  });

  it('ReviewCommentSummary does NOT have body field', () => {
    const sample: ReviewCommentSummary = {
      commenterLogin: 'kai',
      prNumber: 1,
      prHtmlUrl: '',
      prAuthorLogin: 'kai',
      prCreatedAt: '2026-01-01T00:00:00Z',
    };
    // @ts-expect-error — body must NOT be present (FLT-06)
    void sample.body;
    expect(sample.commenterLogin).toBe('kai');
  });

  it('ReviewerRequestSummary, TerminalSummary, ReopenSummary lock their shapes', () => {
    const a: ReviewerRequestSummary = {
      requestedReviewerLogin: 'r',
      requesterLogin: 's',
      prNumber: 1,
      prHtmlUrl: '',
      prAuthorLogin: 'kai',
      prCreatedAt: '2026-01-01T00:00:00Z',
    };
    const b: TerminalSummary = {
      actorLogin: 'm',
      prNumber: 1,
      prHtmlUrl: '',
      prAuthorLogin: 'kai',
      prCreatedAt: '2026-01-01T00:00:00Z',
      reviewerLogins: [],
    };
    const c: ReopenSummary = {
      reopenerLogin: 'k',
      prNumber: 1,
      prHtmlUrl: '',
      prAuthorLogin: 'kai',
      prCreatedAt: '2026-01-01T00:00:00Z',
    };
    // @ts-expect-error — title field forbidden (FLT-06)
    void a.title;
    // @ts-expect-error — title field forbidden (FLT-06)
    void b.title;
    // @ts-expect-error — body field forbidden (FLT-06)
    void c.body;
    expect(a.requestedReviewerLogin).toBe('r');
    expect(b.actorLogin).toBe('m');
    expect(c.reopenerLogin).toBe('k');
  });
});
