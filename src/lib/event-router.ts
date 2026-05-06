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
//
// FLT-06(a): the narrow `PrPayload` interface deliberately omits `pull_request.title`,
// `pull_request.base.ref`, and `pull_request.head.ref`. Those fields exist on the wire
// but are NOT named here, so the typed snapshot below cannot carry them, so blocks.ts
// cannot render them. The allowlist is exhaustive — adding a new field here is a
// trust-boundary review.

import type { GitHubLogin, PrSummary, RoutedEvent } from './types.js';

interface PrPayload {
  readonly action: string;
  readonly pull_request?: {
    readonly number?: number;
    readonly html_url?: string;
    readonly draft?: boolean;
    readonly user?: { readonly login?: string };
    readonly requested_reviewers?: ReadonlyArray<{ readonly login?: string }>;
  };
}

/**
 * Classify a raw webhook event into a RoutedEvent descriptor. Pure: no I/O.
 *
 * The input is intentionally typed as `unknown` payload — webhook payloads come from
 * `github.context.payload` which is `any` in practice; we narrow internally to a small
 * allowlisted shape (`PrPayload`) that includes only the fields we actually use.
 */
export function classify(event: { readonly name: string; readonly payload: unknown }): RoutedEvent {
  if (event.name !== 'pull_request') {
    return { kind: 'skip', reason: 'unhandled-in-p1' };
  }
  const p = event.payload as PrPayload;
  const isOpenLike = p.action === 'opened' || p.action === 'ready_for_review';
  if (!isOpenLike) {
    return { kind: 'skip', reason: 'unhandled-in-p1' };
  }
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
