// Event router — pure classify(event) that maps an inbound webhook payload to a
// RoutedEvent descriptor. The router does NOT call out to Slack, GitHub, mentions,
// or any other side-effectful module — it only describes what to do. Phase 2's action
// handler is the sole executor of those descriptors.
//
// Phase 1 stub set:
//   - { name: 'pull_request', action: 'opened', draft: false }   -> { kind: 'open', pr, reviewers }
//   - { name: 'pull_request', action: 'opened', draft: true }    -> { kind: 'skip', reason: 'draft' }
//   - { name: 'pull_request', action: 'ready_for_review' }       -> { kind: 'open', pr, reviewers }
//   - everything else                                            -> { kind: 'skip', reason: 'unhandled-in-p1' }
// Phase 3 expands the matrix to cover review verdicts, comments, reopen/merge/close.
// Per-event details are documented inline by intent (Pitfall 12 — the comment-token
// convention forbids spelling broadcast-mention literals here). The four router
// pitfalls handled below: payload presence-check guard for issue_comment-on-PR
// (Pitfall 4); top-level singular reviewer field for review_requested vs the
// cumulative list (Pitfall 5); team-reviewer skip path (Pitfall 6); merged-bool
// split between merged_by.login and sender.login on closed (Pitfall 7).
//
// FLT-06(a): the narrow `*Payload` interfaces deliberately omit `pull_request.title`,
// `pull_request.base.ref`, `pull_request.head.ref`, `review.body`, `comment.body`.
// Those fields exist on the wire but are NOT named here, so the typed snapshot below
// cannot carry them, so blocks.ts cannot render them. The allowlist is exhaustive —
// adding a new field here is a trust-boundary review.

import type {
  GitHubLogin,
  IssueCommentSummary,
  PrSummary,
  ReopenSummary,
  ReviewCommentSummary,
  ReviewerRequestSummary,
  ReviewSummary,
  RoutedEvent,
  TerminalSummary,
} from './types.js';

interface PrPayload {
  readonly action: string;
  readonly pull_request?: {
    readonly number?: number;
    readonly html_url?: string;
    readonly draft?: boolean;
    readonly user?: { readonly login?: string };
    readonly requested_reviewers?: ReadonlyArray<{ readonly login?: string }>;
    // Phase 3 additions:
    readonly merged?: boolean;
    readonly merged_by?: { readonly login?: string } | null;
    readonly created_at?: string;
  };
  // Phase 3 additions (top-level fields on review_requested / closed / reopened):
  readonly requested_reviewer?: { readonly login?: string };
  readonly requested_team?: { readonly slug?: string };
  readonly sender?: { readonly login?: string };
}

interface ReviewPayload {
  readonly action: string;
  readonly review?: {
    readonly state?: string;
    readonly user?: { readonly login?: string };
    // NOTE: review.body is intentionally absent (FLT-06).
  };
  readonly pull_request?: {
    readonly number?: number;
    readonly html_url?: string;
    readonly user?: { readonly login?: string };
    readonly created_at?: string;
  };
  readonly sender?: { readonly login?: string };
}

interface IssueCommentPayload {
  readonly action: string;
  readonly comment?: {
    readonly user?: { readonly login?: string };
    // NOTE: comment.body is intentionally absent (FLT-06).
  };
  readonly issue?: {
    readonly number?: number;
    readonly html_url?: string;
    readonly user?: { readonly login?: string };
    readonly created_at?: string;
    // pull_request is the PRESENCE-CHECK guard for Pitfall 4 — non-null means PR-comment.
    // Octokit puts a { url, ... } object here on PR comments; we never read its contents.
    readonly pull_request?: unknown;
  };
}

interface ReviewCommentPayload {
  readonly action: string;
  readonly comment?: {
    readonly user?: { readonly login?: string };
    // NOTE: comment.body is intentionally absent (FLT-06).
  };
  readonly pull_request?: {
    readonly number?: number;
    readonly html_url?: string;
    readonly user?: { readonly login?: string };
    readonly created_at?: string;
  };
}

/**
 * Classify a raw webhook event into a RoutedEvent descriptor. Pure: no I/O.
 *
 * The input is intentionally typed as `unknown` payload — webhook payloads come from
 * `github.context.payload` which is `any` in practice; we narrow internally to small
 * allowlisted shapes (`*Payload`) that include only the fields we actually use.
 */
export function classify(event: { readonly name: string; readonly payload: unknown }): RoutedEvent {
  if (event.name === 'pull_request') {
    return classifyPullRequest(event.payload as PrPayload);
  }
  if (event.name === 'pull_request_review') {
    return classifyPullRequestReview(event.payload as ReviewPayload);
  }
  if (event.name === 'issue_comment') {
    return classifyIssueComment(event.payload as IssueCommentPayload);
  }
  if (event.name === 'pull_request_review_comment') {
    return classifyReviewComment(event.payload as ReviewCommentPayload);
  }
  return { kind: 'skip', reason: 'unhandled-in-p1' };
}

function classifyPullRequest(p: PrPayload): RoutedEvent {
  // Phase-1/2 'open' / 'draft' / 'ready_for_review' — preserved verbatim.
  const isOpenLike = p.action === 'opened' || p.action === 'ready_for_review';
  if (isOpenLike) {
    if (p.action === 'opened' && p.pull_request?.draft === true) {
      return { kind: 'skip', reason: 'draft' };
    }
    const pr: PrSummary = {
      number: p.pull_request?.number ?? 0,
      htmlUrl: p.pull_request?.html_url ?? '',
      authorLogin: p.pull_request?.user?.login ?? '',
    };
    const reviewers: readonly GitHubLogin[] = (p.pull_request?.requested_reviewers ?? [])
      .map((r) => r.login)
      .filter((l): l is string => typeof l === 'string');
    return { kind: 'open', pr, reviewers };
  }

  // Phase 3 branches — common PR snapshot fields used by every Phase-3 kind.
  const prNumber = p.pull_request?.number ?? 0;
  const prHtmlUrl = p.pull_request?.html_url ?? '';
  const prAuthorLogin = p.pull_request?.user?.login ?? '';
  const prCreatedAt = p.pull_request?.created_at ?? '';

  if (p.action === 'review_requested') {
    // Pitfall 5/6 — read TOP-LEVEL requested_reviewer (the per-event singular field).
    // Skip when requested_team is set instead (team-reviewer not supported in v1).
    const requestedReviewerLogin = p.requested_reviewer?.login;
    if (requestedReviewerLogin === undefined) {
      return { kind: 'skip', reason: 'team-reviewer-not-supported-in-v1' };
    }
    const summary: ReviewerRequestSummary = {
      requestedReviewerLogin,
      requesterLogin: p.sender?.login ?? '',
      prNumber,
      prHtmlUrl,
      prAuthorLogin,
      prCreatedAt,
    };
    return { kind: 'reviewer-requested', summary };
  }

  if (p.action === 'closed') {
    // Pitfall 7 — split on merged true vs false; merged_by.login on merge,
    // sender.login on close-without-merge.
    const merged = p.pull_request?.merged === true;
    const reviewerLogins: readonly GitHubLogin[] = (p.pull_request?.requested_reviewers ?? [])
      .map((r) => r.login)
      .filter((l): l is string => typeof l === 'string');
    if (merged) {
      const summary: TerminalSummary = {
        actorLogin: p.pull_request?.merged_by?.login ?? '',
        prNumber,
        prHtmlUrl,
        prAuthorLogin,
        prCreatedAt,
        reviewerLogins,
      };
      return { kind: 'merged', summary };
    }
    const summary: TerminalSummary = {
      actorLogin: p.sender?.login ?? '',
      prNumber,
      prHtmlUrl,
      prAuthorLogin,
      prCreatedAt,
      reviewerLogins,
    };
    return { kind: 'closed-without-merge', summary };
  }

  if (p.action === 'reopened') {
    // Change B 2026-05-07 — populate reviewerLogins from the cumulative
    // requested_reviewers list so handleReopen can re-render the OPEN-04 cc
    // clause inside the un-struck root rebuild. Same source/order-preserving
    // filter pattern as the closed/merged branches.
    const reviewerLogins: readonly GitHubLogin[] = (p.pull_request?.requested_reviewers ?? [])
      .map((r) => r.login)
      .filter((l): l is string => typeof l === 'string');
    const summary: ReopenSummary = {
      reopenerLogin: p.sender?.login ?? '',
      prNumber,
      prHtmlUrl,
      prAuthorLogin,
      prCreatedAt,
      reviewerLogins,
    };
    return { kind: 'reopened', summary };
  }

  return { kind: 'skip', reason: 'unhandled-in-p1' };
}

function classifyPullRequestReview(p: ReviewPayload): RoutedEvent {
  if (p.action !== 'submitted') {
    return { kind: 'skip', reason: 'review-action-unhandled' };
  }
  const state = p.review?.state;
  if (state === undefined) {
    return { kind: 'skip', reason: 'review-state-missing' };
  }
  if (state !== 'approved' && state !== 'changes_requested' && state !== 'commented') {
    return { kind: 'skip', reason: `review-state-unrecognized:${state}` };
  }
  // Change A 2026-05-07 — drop the commented-review handler. GitHub fires both a
  // pull_request_review:submitted (state='commented') AND a pull_request_review_comment:created
  // event for a single inline review-comment user action; the bot would post twice
  // to Slack ("commented on the pull request" + "published 1 inline comment on the pull request").
  // The implicit-review wrapper is the noisy duplicate; the inline-comment event carries
  // the actual signal. Standalone summary-only reviews (no inline comments) also fire
  // this state but are low-frequency in practice — accepted trade-off per D-22.
  if (state === 'commented') {
    return { kind: 'skip', reason: 'commented-review-redundant-with-review-comment-events' };
  }
  const summary: ReviewSummary = {
    state,
    reviewerLogin: p.review?.user?.login ?? '',
    prNumber: p.pull_request?.number ?? 0,
    prHtmlUrl: p.pull_request?.html_url ?? '',
    prAuthorLogin: p.pull_request?.user?.login ?? '',
    prCreatedAt: p.pull_request?.created_at ?? '',
  };
  return { kind: 'review-submitted', summary };
}

function classifyIssueComment(p: IssueCommentPayload): RoutedEvent {
  if (p.action !== 'created') {
    return { kind: 'skip', reason: 'issue-comment-action-unhandled' };
  }
  // Pitfall 4 — issue.pull_request is the PRESENCE-CHECK guard. Non-null means
  // this is a PR comment; null means it's a regular issue comment we ignore.
  if (p.issue?.pull_request == null) {
    return { kind: 'skip', reason: 'issue-comment-not-on-pr' };
  }
  const summary: IssueCommentSummary = {
    commenterLogin: p.comment?.user?.login ?? '',
    prNumber: p.issue?.number ?? 0,
    prHtmlUrl: p.issue?.html_url ?? '',
    prAuthorLogin: p.issue?.user?.login ?? '',
    prCreatedAt: p.issue?.created_at ?? '',
  };
  return { kind: 'pr-comment', summary };
}

function classifyReviewComment(p: ReviewCommentPayload): RoutedEvent {
  if (p.action !== 'created') {
    return { kind: 'skip', reason: 'review-comment-action-unhandled' };
  }
  const summary: ReviewCommentSummary = {
    commenterLogin: p.comment?.user?.login ?? '',
    prNumber: p.pull_request?.number ?? 0,
    prHtmlUrl: p.pull_request?.html_url ?? '',
    prAuthorLogin: p.pull_request?.user?.login ?? '',
    prCreatedAt: p.pull_request?.created_at ?? '',
  };
  return { kind: 'review-comment', summary };
}
