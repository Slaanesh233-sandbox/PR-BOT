// Bot-filter module — single function, called at action entry in Phase 2.
//
// D-04: `sender.type === 'Bot' || login.endsWith('[bot]')`. The two checks are
//   intentionally OR-ed: GitHub usually populates `sender.type === 'Bot'` for
//   app-installed bots, but historically some payloads have come through with
//   `type: 'User'` even though the login carries the `[bot]` suffix. Both
//   checks together are belt-and-braces (cf. ARCHITECTURE.md §4 / PITFALLS.md).
//
// T-01-20: explicit test cases for `dependabot[bot]`, `renovate[bot]`,
//   `github-actions[bot]` cover the spoofing surface.

import type { WebhookActor } from './types.js';

/**
 * Returns true if the actor (sender / comment.user / review.user) should be
 * treated as a bot and the event filtered out before any Slack call.
 *
 * `null` and `undefined` actors return false (defensive — the bot will then
 * fall through to other filters; no harm in not treating "unknown" as a bot).
 */
export function isBotActor(actor: WebhookActor | null | undefined): boolean {
  if (!actor) return false;
  if (actor.type === 'Bot') return true;
  if (actor.login !== undefined && actor.login.endsWith('[bot]')) return true;
  return false;
}
