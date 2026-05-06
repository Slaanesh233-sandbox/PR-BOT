// Tests for src/lib/event-router.ts — pure classify() that maps a raw webhook event to a
// RoutedEvent descriptor. Phase 1 only handles the open-class subset; everything else is
// intentionally skipped with reason 'unhandled-in-p1'. Phase 3 expands the matrix.
//
// All fixtures are minimal hand-crafted objects, NOT Octokit webhook types — the router's
// input is `{ name, payload: unknown }` and it narrows internally to the handful of fields
// inside the FLT-06 allowlist.

import { describe, expect, it } from 'vitest';

import { classify } from '../src/lib/event-router.js';

function openedPayload(opts: {
  draft?: boolean;
  reviewers?: ReadonlyArray<{ login: string }>;
} = {}): unknown {
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
  it('pull_request:reopened skips with reason=unhandled-in-p1 (P3 will route this)', () => {
    const result = classify({
      name: 'pull_request',
      payload: { action: 'reopened', pull_request: { number: 1 } },
    });
    expect(result).toEqual({ kind: 'skip', reason: 'unhandled-in-p1' });
  });

  it('pull_request:edited skips (caller workflow excludes this anyway, but defense in depth)', () => {
    const result = classify({
      name: 'pull_request',
      payload: { action: 'edited', pull_request: { number: 1 } },
    });
    expect(result).toEqual({ kind: 'skip', reason: 'unhandled-in-p1' });
  });

  it('pull_request_review:submitted skips with unhandled-in-p1', () => {
    const result = classify({
      name: 'pull_request_review',
      payload: { action: 'submitted', review: { state: 'approved' } },
    });
    expect(result).toEqual({ kind: 'skip', reason: 'unhandled-in-p1' });
  });

  it('issue_comment:created skips with unhandled-in-p1', () => {
    const result = classify({
      name: 'issue_comment',
      payload: { action: 'created', comment: { body: 'hi' } },
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
