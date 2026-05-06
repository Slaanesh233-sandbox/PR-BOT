// Mentions module — the SOLE producer of Slack `<@U…>` user-mention syntax in this codebase
// (FLT-05 / D-03). Every other module that wants to put a mention in a message receives a
// pre-resolved `ResolvedMention` from here and copies its `.text` field as a plain string.
//
// FLT-05 invariant (verified by Plan 03b's grep gate): the literal angle-bracket-at-U…
// substring may appear ONLY in this file across the whole `src/` tree. The grep is run as
// part of the plan's automated verification:
//
//     grep -rn '<@' src/ | grep -v 'src/lib/mentions.ts'
//
// must return zero matches. If a future caller wants to construct a Slack mention, it must
// call `resolve` / `resolveAll` here — never inline the syntax.
//
// D-03 fallback policy: on a `users.yml` map miss, return a plain-text `@<login>` (no
// angle brackets). Slack will render this as inert text — the user is informed they were
// referenced but no actual ping fires. The angle-bracket form `<@unknown-dev>` against an
// unmapped login would silently route to a phantom user (no ping AND no visible signal),
// which is strictly worse — it would be a silent failure mode with no operator surface.
//
// `opts.warn` is dependency-injected so this module stays pure. Tests pass `vi.fn()`; the
// production action handler in Phase 2 will inject `core.warning` from `@actions/core`.

import type { GitHubLogin, ResolvedMention, UsersMap } from './types.js';

export interface ResolveOpts {
  readonly warn?: (msg: string) => void;
}

const noopWarn = (_msg: string): void => {};

/**
 * Resolve a single GitHub login to a `ResolvedMention`.
 *
 * - Map hit: returns `{ kind: 'mapped', text: '<@U…>', login }`. The `text` field carries
 *   the literal Slack user-mention syntax that fires a real ping.
 * - Map miss: returns `{ kind: 'fallback', text: '@<login>', login }` with a plain `@`
 *   prefix — no Slack mention syntax. Calls `opts.warn` exactly once with a message naming
 *   the unmapped login.
 *
 * Pure function: no I/O, no global state, no exceptions in normal flow.
 */
export function resolve(
  login: GitHubLogin,
  usersMap: UsersMap,
  opts: ResolveOpts = {},
): ResolvedMention {
  const slackId = usersMap.users[login];
  if (slackId !== undefined) {
    return { kind: 'mapped', text: `<@${slackId}>`, login };
  }
  const warn = opts.warn ?? noopWarn;
  warn(
    `mentions.resolve: no Slack ID mapping for github login "${login}" — falling back to plain @${login}`,
  );
  return { kind: 'fallback', text: `@${login}`, login };
}

/**
 * Resolve a list of GitHub logins, preserving order. Useful for `requested_reviewers`
 * arrays where the rendered "cc <@r1> <@r2> …" list must mirror the webhook order.
 */
export function resolveAll(
  logins: readonly GitHubLogin[],
  usersMap: UsersMap,
  opts: ResolveOpts = {},
): readonly ResolvedMention[] {
  return logins.map((l) => resolve(l, usersMap, opts));
}
