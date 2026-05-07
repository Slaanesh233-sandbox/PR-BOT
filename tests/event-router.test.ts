// Tests for src/lib/event-router.ts — pure classify() that maps a raw webhook event to a
// RoutedEvent descriptor. Phase 1 only handles the open-class subset; everything else is
// intentionally skipped with reason 'unhandled-in-p1'. Phase 3 expands the matrix.
//
// All fixtures are minimal hand-crafted objects, NOT Octokit webhook types — the router's
// input is `{ name, payload: unknown }` and it narrows internally to the handful of fields
// inside the FLT-06 allowlist.

import { describe, expect, it } from 'vitest';

import { classify } from '../src/lib/event-router.js';

function openedPayload(
  opts: {
    draft?: boolean;
    reviewers?: ReadonlyArray<{ login: string }>;
  } = {},
): unknown {
  return {
    action: 'opened',
    pull_request: {
      number: 42,
      html_url: 'https://github.com/x/y/pull/42',
      draft: opts.draft ?? false,
      user: { login: 'kai' },
      requested_reviewers: opts.reviewers ?? [],
    },
  };
}

describe('event-router.classify — open-class events', () => {
  it('pull_request:opened (non-draft) routes to kind=open with the populated PrSummary', () => {
    const result = classify({ name: 'pull_request', payload: openedPayload() });
    expect(result.kind).toBe('open');
    if (result.kind !== 'open') throw new Error('narrowing'); // type guard for TS
    expect(result.pr).toEqual({
      number: 42,
      htmlUrl: 'https://github.com/x/y/pull/42',
      authorLogin: 'kai',
    });
  });

  it('pull_request:opened (draft) routes to kind=skip with reason=draft', () => {
    const result = classify({ name: 'pull_request', payload: openedPayload({ draft: true }) });
    expect(result).toEqual({ kind: 'skip', reason: 'draft' });
  });

  it('pull_request:ready_for_review routes to kind=open (the draft-then-ready transition)', () => {
    const payload = {
      action: 'ready_for_review',
      pull_request: {
        number: 7,
        html_url: 'https://github.com/x/y/pull/7',
        draft: false,
        user: { login: 'someone' },
        requested_reviewers: [],
      },
    };
    const result = classify({ name: 'pull_request', payload });
    expect(result.kind).toBe('open');
    if (result.kind !== 'open') throw new Error('narrowing');
    expect(result.pr.number).toBe(7);
  });
});

describe('event-router.classify — skip cases', () => {
  it('pull_request:edited skips (caller workflow excludes this anyway, but defense in depth)', () => {
    const result = classify({
      name: 'pull_request',
      payload: { action: 'edited', pull_request: { number: 1 } },
    });
    expect(result).toEqual({ kind: 'skip', reason: 'unhandled-in-p1' });
  });
});

describe('event-router.classify — reviewer extraction order', () => {
  it('reviewers list preserves the requested_reviewers order', () => {
    const result = classify({
      name: 'pull_request',
      payload: openedPayload({ reviewers: [{ login: 'alice' }, { login: 'bob' }] }),
    });
    expect(result.kind).toBe('open');
    if (result.kind !== 'open') throw new Error('narrowing');
    expect(result.reviewers).toEqual(['alice', 'bob']);
  });

  it('missing requested_reviewers field yields an empty reviewer list (no throw)', () => {
    const payload = {
      action: 'opened',
      pull_request: {
        number: 1,
        html_url: 'https://example.invalid/pr/1',
        draft: false,
        user: { login: 'a' },
        // no requested_reviewers
      },
    };
    const result = classify({ name: 'pull_request', payload });
    expect(result.kind).toBe('open');
    if (result.kind !== 'open') throw new Error('narrowing');
    expect(result.reviewers).toEqual([]);
  });
});

// =====================================================================
// Phase 3 routing-matrix coverage
// =====================================================================

describe('classify — pull_request_review submitted (THRD-01)', () => {
  function reviewPayload(
    opts: {
      action?: string;
      state?: string | undefined;
      reviewerLogin?: string;
      senderLogin?: string;
    } = {},
  ): unknown {
    return {
      action: opts.action ?? 'submitted',
      review: { state: opts.state, user: { login: opts.reviewerLogin ?? 'reviewer-1' } },
      pull_request: {
        number: 7,
        html_url: 'https://github.com/o/r/pull/7',
        user: { login: 'kai' },
        created_at: '2026-01-01T00:00:00Z',
      },
      sender: { login: opts.senderLogin ?? 'reviewer-1' },
    };
  }
  for (const state of ['approved', 'changes_requested'] as const) {
    it(`state=${state} → returns review-submitted with the verdict`, () => {
      const r = classify({ name: 'pull_request_review', payload: reviewPayload({ state }) });
      expect(r.kind).toBe('review-submitted');
      if (r.kind !== 'review-submitted') throw new Error('discriminator');
      expect(r.summary.state).toBe(state);
      expect(r.summary.reviewerLogin).toBe('reviewer-1');
      expect(r.summary.prNumber).toBe(7);
      expect(r.summary.prAuthorLogin).toBe('kai');
      expect(r.summary.prCreatedAt).toBe('2026-01-01T00:00:00Z');
    });
  }
  it("state=commented → skip with reason 'commented-review-redundant-with-review-comment-events' (Change A 2026-05-07)", () => {
    const r = classify({
      name: 'pull_request_review',
      payload: reviewPayload({ state: 'commented' }),
    });
    expect(r).toEqual({
      kind: 'skip',
      reason: 'commented-review-redundant-with-review-comment-events',
    });
  });
  it('state missing → skip review-state-missing', () => {
    expect(
      classify({ name: 'pull_request_review', payload: reviewPayload({ state: undefined }) }),
    ).toEqual({ kind: 'skip', reason: 'review-state-missing' });
  });
  it('state unrecognized → skip review-state-unrecognized:<state>', () => {
    expect(
      classify({ name: 'pull_request_review', payload: reviewPayload({ state: 'foo' }) }),
    ).toEqual({ kind: 'skip', reason: 'review-state-unrecognized:foo' });
  });
  it('action != submitted → skip review-action-unhandled', () => {
    expect(
      classify({
        name: 'pull_request_review',
        payload: reviewPayload({ action: 'dismissed', state: 'approved' }),
      }),
    ).toEqual({ kind: 'skip', reason: 'review-action-unhandled' });
  });
});

describe('classify — issue_comment created on PR (THRD-02; Pitfall 4)', () => {
  function issuePayload(
    opts: { action?: string; commenterLogin?: string; isPr?: boolean } = {},
  ): unknown {
    return {
      action: opts.action ?? 'created',
      comment: { user: { login: opts.commenterLogin ?? 'commenter-1' } },
      issue: {
        number: 7,
        html_url: 'https://github.com/o/r/pull/7',
        user: { login: 'kai' },
        created_at: '2026-01-01T00:00:00Z',
        pull_request:
          opts.isPr === false ? null : { url: 'https://api.github.com/repos/o/r/pulls/7' },
      },
    };
  }
  it('PR-comment → returns pr-comment with summary', () => {
    const r = classify({ name: 'issue_comment', payload: issuePayload() });
    expect(r.kind).toBe('pr-comment');
    if (r.kind !== 'pr-comment') throw new Error('discriminator');
    expect(r.summary.commenterLogin).toBe('commenter-1');
    expect(r.summary.prNumber).toBe(7);
  });
  it('non-PR issue → skip issue-comment-not-on-pr', () => {
    expect(classify({ name: 'issue_comment', payload: issuePayload({ isPr: false }) })).toEqual({
      kind: 'skip',
      reason: 'issue-comment-not-on-pr',
    });
  });
  it('action != created → skip issue-comment-action-unhandled', () => {
    expect(
      classify({ name: 'issue_comment', payload: issuePayload({ action: 'edited' }) }),
    ).toEqual({ kind: 'skip', reason: 'issue-comment-action-unhandled' });
  });
});

describe('classify — pull_request_review_comment created (THRD-02 inline)', () => {
  function rcPayload(opts: { action?: string; commenterLogin?: string } = {}): unknown {
    return {
      action: opts.action ?? 'created',
      comment: { user: { login: opts.commenterLogin ?? 'commenter-2' } },
      pull_request: {
        number: 7,
        html_url: 'https://github.com/o/r/pull/7',
        user: { login: 'kai' },
        created_at: '2026-01-01T00:00:00Z',
      },
    };
  }
  it('created → returns review-comment with summary', () => {
    const r = classify({ name: 'pull_request_review_comment', payload: rcPayload() });
    expect(r.kind).toBe('review-comment');
    if (r.kind !== 'review-comment') throw new Error('discriminator');
    expect(r.summary.commenterLogin).toBe('commenter-2');
  });
  it('action != created → skip review-comment-action-unhandled', () => {
    expect(
      classify({
        name: 'pull_request_review_comment',
        payload: rcPayload({ action: 'edited' }),
      }),
    ).toEqual({ kind: 'skip', reason: 'review-comment-action-unhandled' });
  });
});

describe('classify — pull_request review_requested (THRD-03; Pitfalls 5+6)', () => {
  function rrPayload(
    opts: {
      hasReviewer?: boolean;
      hasTeam?: boolean;
      reviewerLogin?: string;
      senderLogin?: string;
    } = {},
  ): unknown {
    return {
      action: 'review_requested',
      sender: { login: opts.senderLogin ?? 'pr-author' },
      pull_request: {
        number: 7,
        html_url: 'https://github.com/o/r/pull/7',
        user: { login: 'kai' },
        created_at: '2026-01-01T00:00:00Z',
        // CRITICAL Pitfall 5: cumulative list — NOT what we read for THRD-03
        requested_reviewers: [{ login: 'old-reviewer' }, { login: 'new-reviewer' }],
      },
      ...(opts.hasReviewer !== false
        ? { requested_reviewer: { login: opts.reviewerLogin ?? 'new-reviewer' } }
        : {}),
      ...(opts.hasTeam ? { requested_team: { slug: 'eng-team' } } : {}),
    };
  }
  it('per-reviewer event → reads TOP-LEVEL requested_reviewer.login (Pitfall 5)', () => {
    const r = classify({ name: 'pull_request', payload: rrPayload() });
    expect(r.kind).toBe('reviewer-requested');
    if (r.kind !== 'reviewer-requested') throw new Error('discriminator');
    expect(r.summary.requestedReviewerLogin).toBe('new-reviewer');
    expect(r.summary.requesterLogin).toBe('pr-author');
    expect(r.summary.requestedReviewerLogin).not.toBe('old-reviewer'); // not from cumulative list
  });
  it('team request (requested_team set, requested_reviewer absent) → skip team-reviewer-not-supported-in-v1 (Pitfall 6)', () => {
    expect(
      classify({
        name: 'pull_request',
        payload: rrPayload({ hasReviewer: false, hasTeam: true }),
      }),
    ).toEqual({ kind: 'skip', reason: 'team-reviewer-not-supported-in-v1' });
  });
});

describe('classify — pull_request closed merged vs not (THRD-04 / THRD-05; Pitfall 7)', () => {
  function closedPayload(opts: {
    merged: boolean;
    mergerLogin?: string;
    closerLogin?: string;
    reviewers?: string[];
  }): unknown {
    return {
      action: 'closed',
      sender: { login: opts.closerLogin ?? 'closer-1' },
      pull_request: {
        number: 7,
        html_url: 'https://github.com/o/r/pull/7',
        user: { login: 'kai' },
        created_at: '2026-01-01T00:00:00Z',
        merged: opts.merged,
        merged_by: opts.merged ? { login: opts.mergerLogin ?? 'merger-1' } : null,
        requested_reviewers: (opts.reviewers ?? []).map((login) => ({ login })),
      },
    };
  }
  it('merged: true → returns merged with actorLogin from merged_by.login', () => {
    const r = classify({
      name: 'pull_request',
      payload: closedPayload({ merged: true, mergerLogin: 'merger-1', reviewers: ['r1', 'r2'] }),
    });
    expect(r.kind).toBe('merged');
    if (r.kind !== 'merged') throw new Error('discriminator');
    expect(r.summary.actorLogin).toBe('merger-1');
    expect(r.summary.reviewerLogins).toEqual(['r1', 'r2']);
  });
  it('merged: false → returns closed-without-merge with actorLogin from sender.login', () => {
    const r = classify({
      name: 'pull_request',
      payload: closedPayload({ merged: false, closerLogin: 'closer-1', reviewers: ['r1'] }),
    });
    expect(r.kind).toBe('closed-without-merge');
    if (r.kind !== 'closed-without-merge') throw new Error('discriminator');
    expect(r.summary.actorLogin).toBe('closer-1');
    expect(r.summary.reviewerLogins).toEqual(['r1']);
  });
  it('reviewerLogins preserves order (snapshot for strikethrough rebuild)', () => {
    const r = classify({
      name: 'pull_request',
      payload: closedPayload({ merged: true, reviewers: ['third', 'first', 'second'] }),
    });
    if (r.kind !== 'merged') throw new Error('discriminator');
    expect(r.summary.reviewerLogins).toEqual(['third', 'first', 'second']);
  });
});

describe('classify — pull_request reopened (THRD-06)', () => {
  it('reopened → returns reopened with reopenerLogin from sender.login (no reviewers default)', () => {
    const payload = {
      action: 'reopened',
      sender: { login: 'reopener-1' },
      pull_request: {
        number: 7,
        html_url: 'https://github.com/o/r/pull/7',
        user: { login: 'kai' },
        created_at: '2026-01-01T00:00:00Z',
      },
    };
    const r = classify({ name: 'pull_request', payload });
    expect(r.kind).toBe('reopened');
    if (r.kind !== 'reopened') throw new Error('discriminator');
    expect(r.summary.reopenerLogin).toBe('reopener-1');
    expect(r.summary.prAuthorLogin).toBe('kai');
    expect(r.summary.reviewerLogins).toEqual([]);
  });

  it('reopened with reviewers → reviewerLogins preserves order (parallel to TerminalSummary)', () => {
    const payload = {
      action: 'reopened',
      sender: { login: 'reopener-1' },
      pull_request: {
        number: 7,
        html_url: 'https://github.com/o/r/pull/7',
        user: { login: 'kai' },
        created_at: '2026-01-01T00:00:00Z',
        requested_reviewers: [{ login: 'r1' }, { login: 'r2' }],
      },
    };
    const r = classify({ name: 'pull_request', payload });
    if (r.kind !== 'reopened') throw new Error('discriminator');
    expect(r.summary.reviewerLogins).toEqual(['r1', 'r2']);
  });
});

describe('classify — regression: existing open / draft / unhandled paths still work', () => {
  it("opened non-draft still returns kind: 'open'", () => {
    const r = classify({
      name: 'pull_request',
      payload: {
        action: 'opened',
        pull_request: {
          number: 1,
          html_url: '',
          draft: false,
          user: { login: 'kai' },
          requested_reviewers: [],
        },
      },
    });
    expect(r.kind).toBe('open');
  });
  it("opened draft=true still returns skip 'draft'", () => {
    expect(
      classify({
        name: 'pull_request',
        payload: {
          action: 'opened',
          pull_request: { number: 1, html_url: '', draft: true, user: { login: 'kai' } },
        },
      }),
    ).toEqual({ kind: 'skip', reason: 'draft' });
  });
  it("unknown event name still returns skip 'unhandled-in-p1'", () => {
    expect(classify({ name: 'workflow_dispatch', payload: {} })).toEqual({
      kind: 'skip',
      reason: 'unhandled-in-p1',
    });
  });
});
