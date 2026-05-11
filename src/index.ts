// PR-BOT action handler — Phase 2 Plan 02-01 + Phase 3 Plan 03-02.
//
// Phase 2 (Plan 02-01) shipped the keystone open-class flow: filter bots → classify
// → idempotency check → resolve mentions → build OPEN-04 root → chat.postMessage →
// marker.inject → pulls.update (with bounded retry).
//
// Phase 3 (Plan 03-02) extends the dispatcher with thread-class events: review
// verdicts, PR comments, inline review comments, reviewer requests, reopens, and
// terminal merge / close-without-merge (multi-call serial best-effort: thread reply
// → reactions.add → chat.update strikethrough). All Slack and GitHub I/O happens
// through dependency-injected clients so tests/handler.test.ts can drive every
// branch with vi.fn() mocks.
//
// Phase 3 copy refresh (locked spec 2026-05-07; quick task 20260507-001):
//   - Root post and strikethrough rebuild now render the linked repo home
//     `<repoUrl|repoShortName>` and the linked literal "pull request" via
//     `<prHtmlUrl|pull request>`. The plain-text fallback mirrors the new copy.
//     `repoUrl` is derived per-event from `event.repo` as
//     `https://github.com/${owner}/${repo}` and passed through to the blocks
//     builders. (Note: the new repo-URL link is a plain `<url|text>` mrkdwn
//     link — NOT a user mention — so FLT-05's substring grep is unaffected by
//     construction.)
//   - D-06 SUPERSEDED 2026-05-07: the per-event count is ALWAYS rendered as
//     `published N comment(s) on the pull request` (PR-conversation thread reply
//     via formatPrCommentReply) or `published N inline comment(s) on the pull
//     request` (review-comment thread reply via formatReviewCommentReply).
//     The pr-comment vs review-comment dispatch paths are split here so each
//     calls its dedicated formatter.
//   - formatRequestedReviewReply now takes only `requestedReviewerMention` (the
//     locked spec drops the "by <requester>" clause). The requester login is no
//     longer rendered, so the requester unmapped-warn is no longer emitted from
//     this dispatcher (per Pitfall 5: the requested reviewer is the per-event
//     mention target — the requester is the sender, not user-visible in the
//     refreshed copy).
//
// Invariants this file MUST satisfy (also enforced by CI gates):
//   - FLT-05 (Gate 7): the literal Slack user-mention substring does not appear here.
//     All Slack mention syntax originates from `mentions.resolve` / `mentions.resolveAll`.
//   - FLT-06(a) (Gate 8 extended in Plan 02-01 Task 1.3): no field access on
//     pull_request title or branch refs. The narrowed RoutedEvent from event-router
//     does not even surface those names; the grep is defense-in-depth.
//   - D-02 / FND-06: thread_ts is an opaque string. No numeric coercion anywhere.
//   - D-04 / FLT-01: bot-filter runs first, before any Octokit call.
//   - OPEN-06 / Pitfall 12: idempotency uses the LIVE PR body from pulls.get, not
//     the body in the webhook payload (which is stale on re-runs).
//   - OPEN-05: PATCH retries 1s/3s/9s on transient 5xx; 4xx fails fast.
//   - Pitfall 8: chat.postMessage receives both `text` (plain fallback) and `blocks`.
//   - Pitfall 8 (handler-side): pulls.get is called ONCE per event; the live body is
//     reused for FLT-02 + THRD-07 + thread_ts retrieval.
//   - Pitfall 10: repo short name comes from `payload.repository.name`, not full_name.
//   - FLT-02: isSilent(liveBody) is checked BEFORE per-kind dispatch (Research §7).
//     Both the open-class branch and the thread-class branch honor the silent marker.
//   - THRD-07: created_at + 60s is the marker-missing anchor (Pitfall 11; never
//     updated_at — the bot's own marker PATCH shifts updated_at and would silently
//     widen the race window).
//   - Pitfall 2 (Plan 03-02): chat.update receives BOTH text and blocks; sending
//     only one would replace the other.
//   - Pitfall 9 (Plan 03-02): chat.update never receives thread_ts; that argument
//     is only valid on chat.postMessage thread replies.
//
// Phase 3 UX fix Change B 2026-05-07: pull_request: reopened becomes the THIRD
// multi-call event class. handleReopen mirrors handleTerminal's shape (4 sequential
// Slack calls: thread reply LOUD-fail, then reactions.remove ×2 soft-fail, then
// chat.update soft-fail) but inverts the strikethrough — re-renders the live root
// via buildRootMessage (NOT buildStrikethroughRoot). Both terminal reactions
// (no_entry_sign AND tada) are removed because the bot does not track which
// terminal reaction was previously added; reactions.remove tolerates the
// no_reaction code (the unique-to-remove parallel of add's already_reacted).
// See removeReaction + handleReactionRemovalError for the error tier mapping.

import * as fs from 'node:fs';

import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { WebClient } from '@slack/web-api';

import {
  buildRootMessage,
  buildStrikethroughRoot,
  buildThreadReply,
  businessDaysBetween,
  classify,
  formatCloseReply,
  formatMergeReply,
  formatPrCommentReply,
  formatRequestedReviewReply,
  formatReopenReply,
  formatReviewCommentReply,
  formatReviewReply,
  formatStalePingReply,
  inject as injectMarker,
  injectStalePingCount,
  injectStalePingedAt,
  isBotActor,
  isSilent,
  loadChannelConfig,
  loadStaleCheckConfig,
  loadUsersMap,
  parse as parseMarker,
  parseStalePingCount,
  parseStalePingedAt,
  pickApprovedEmoji,
  resolve as resolveMention,
  resolveAll as resolveAllMentions,
  TERMINAL_REACTION,
  type ChannelConfig,
  type GitHubLogin,
  type PrSummary,
  type ReopenSummary,
  type ResolvedMention,
  type RoutedEvent,
  type StaleCheckConfig,
  type TerminalSummary,
  type UsersMap,
} from './lib/index.js';

// --- Public DI seam --------------------------------------------------------

// Phase 3.1 — narrow list-item shape returned by octokit.rest.pulls.list. We
// deliberately enumerate only the fields handleStaleCheck reads. FLT-06(a)
// discipline: pull-request title and branch refs (head.ref / base.ref) are
// intentionally absent — the dispatcher must not access them.
export interface PullListItem {
  readonly number: number;
  readonly html_url: string;
  readonly body: string | null;
  readonly draft: boolean;
  readonly user: { readonly login: string; readonly type: string } | null;
  readonly requested_reviewers: ReadonlyArray<{ readonly login: string }> | null;
  readonly created_at: string;
}

export interface Deps {
  readonly slack: {
    readonly chat: {
      postMessage(args: {
        channel: string;
        text?: string;
        blocks?: unknown;
        thread_ts?: string;
      }): Promise<{ ok: boolean; ts?: string; channel?: string; error?: string }>;
      // Phase 3 — STAT-02 / STAT-03 strikethrough on root.
      // Pitfall 2: callers MUST pass BOTH text and blocks; passing text alone
      // replaces blocks.
      // Pitfall 9: thread_ts is NOT a valid argument here.
      update(args: {
        channel: string;
        ts: string;
        text?: string;
        blocks?: unknown;
      }): Promise<{ ok: boolean; error?: string }>;
    };
    // Phase 3 — STAT-01 / STAT-02 / STAT-03 reactions.
    // Pitfall 3: `name` is the BARE emoji name (no colons).
    readonly reactions: {
      add(args: {
        channel: string;
        timestamp: string;
        name: string;
      }): Promise<{ ok: boolean; error?: string }>;
      // Change B 2026-05-07 — Pitfall 3 applies (BARE emoji name).
      remove(args: {
        channel: string;
        timestamp: string;
        name: string;
      }): Promise<{ ok: boolean; error?: string }>;
    };
  };
  readonly octokit: {
    readonly rest: {
      readonly pulls: {
        get(args: {
          owner: string;
          repo: string;
          pull_number: number;
        }): Promise<{ data: { body: string | null } }>;
        update(args: {
          owner: string;
          repo: string;
          pull_number: number;
          body: string;
        }): Promise<unknown>;
        // Phase 3.1 — paginated PR discovery for the schedule-event path.
        list(args: {
          owner: string;
          repo: string;
          state: 'open' | 'closed' | 'all';
          per_page?: number;
          page?: number;
        }): Promise<{ data: ReadonlyArray<PullListItem> }>;
      };
    };
  };
  readonly config: {
    readonly users: UsersMap;
    readonly channel: ChannelConfig;
    // Phase 3.1 — optional so existing tests (and the webhook path) don't need
    // to populate it. Schedule-event execution requires it; handleStaleCheck
    // defensively setFailed's if missing.
    readonly staleCheck?: StaleCheckConfig;
  };
  readonly logger: {
    info(msg: string): void;
    warning(msg: string): void;
    setFailed(msg: string): void;
  };
  // Injectable sleep (tests pass () => {} to fast-forward retry delays).
  readonly sleep?: (ms: number) => Promise<void>;
  // Phase 3.1 — injectable clock (tests pass a fixed-date thunk so business-day
  // arithmetic is deterministic). Defaults to () => new Date() at runtime.
  readonly now?: () => Date;
  // Phase 3.1 — schedule-event fallback owner/repo when ctx is absent. Webhook
  // path reads ctx.event.repo; schedule path can use either ctx or this.
  readonly repo?: { readonly owner: string; readonly repo: string };
}

export interface HandleEventCtx {
  readonly event: {
    readonly name: string;
    readonly payload: {
      readonly action?: string;
      readonly sender?: { readonly login?: string; readonly type?: string };
      readonly pull_request?: unknown; // narrowed by event-router.classify
      readonly repository?: { readonly name?: string; readonly full_name?: string };
    };
    readonly repo: { readonly owner: string; readonly repo: string };
  };
}

// --- Core handler ----------------------------------------------------------

const PATCH_RETRY_DELAYS_MS: ReadonlyArray<number> = [0, 1000, 3000, 9000]; // initial + 3 retries

export async function handleEvent(deps: Deps, ctx: HandleEventCtx): Promise<void> {
  const { event } = ctx;
  const sender = event.payload.sender ?? null;

  // FLT-01: bot-filter runs FIRST, before any I/O. (PRESERVED — Phase 2)
  if (isBotActor(sender)) {
    deps.logger.info(`skipped: sender is bot (${sender?.login ?? 'unknown'})`);
    return;
  }

  // Classify via Phase 1/3 event-router. (PRESERVED — extended in Plan 03-01.)
  const routed = classify({ name: event.name, payload: event.payload });
  if (routed.kind === 'skip') {
    deps.logger.info(`skipped: ${routed.reason}`);
    return;
  }
  if (routed.kind === 'thread-reply') {
    // Legacy unused Phase-1 variant; the Phase-3 classifier never produces it.
    // Keep the skip branch for back-compat with the type union shape.
    deps.logger.info(`skipped: legacy thread-reply variant not produced by classifier`);
    return;
  }

  if (routed.kind === 'open') {
    return handleOpen(deps, ctx, routed);
  }

  // All other variants are Phase-3 thread-class events. They share the FLT-02 +
  // THRD-07 prelude (Research §7), then dispatch per-kind.
  return handleThreadKind(deps, ctx, routed);
}

// === Phase 2 open-class flow (extracted from the Plan 02-01 keystone) ======

async function handleOpen(
  deps: Deps,
  ctx: HandleEventCtx,
  routed: {
    readonly kind: 'open';
    readonly pr: PrSummary;
    readonly reviewers: readonly GitHubLogin[];
  },
): Promise<void> {
  const { event } = ctx;
  const { owner, repo } = event.repo;

  // OPEN-06 / Pitfall 12: idempotency check against LIVE body, not payload body.
  let liveBody = '';
  try {
    const prGet = await deps.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: routed.pr.number,
    });
    liveBody = prGet.data.body ?? '';
  } catch (err) {
    deps.logger.setFailed(
      `pulls.get failed for PR #${routed.pr.number}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  // FLT-02 — silent-marker opt-out. The open-class branch honors it too: a PR
  // body that already contains the silent marker should not produce a root post,
  // even on the first opened event. Operators who want to suppress the bot for a
  // specific PR can pre-write `<!-- pr-bot:silent -->` into the description.
  if (isSilent(liveBody)) {
    deps.logger.info(
      `FLT-02: PR opted out via silent marker — PR #${routed.pr.number}; skipping open event`,
    );
    return;
  }

  if (parseMarker(liveBody) !== null) {
    deps.logger.info(
      `skipped: marker already present (idempotent re-run guard) — PR #${routed.pr.number}`,
    );
    return;
  }

  // FLT-05: mention resolution is the SOLE producer of Slack user-mention syntax.
  const warn = (msg: string): void => deps.logger.warning(msg);
  const authorMention: ResolvedMention = resolveMention(routed.pr.authorLogin, deps.config.users, {
    warn,
  });
  const reviewerMentions: readonly ResolvedMention[] = resolveAllMentions(
    routed.reviewers as readonly GitHubLogin[],
    deps.config.users,
    { warn },
  );

  // OPEN-04: build root via blocks.buildRootMessage. Only allowlisted fields enter.
  // Pitfall 10: repo SHORT name from payload.repository.name (fallback to context.repo.repo).
  // Locked spec 2026-05-07: repoUrl is the repo home URL — used to render the leading
  // repo name as a Slack mrkdwn link (`<repoUrl|repoShortName>`).
  const repoShortName = event.payload.repository?.name ?? repo;
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const root = buildRootMessage({
    repoShortName,
    repoUrl,
    prHtmlUrl: routed.pr.htmlUrl,
    authorMention,
    reviewerMentions,
  });

  // Pitfall 8: plain-text fallback for accessibility / DnD push notifications.
  // Built from already-resolved ResolvedMention.text strings — no new mention syntax here.
  // Mirrors the locked-spec mrkdwn root copy: colon-then-newline split between the
  // repo header and the author/pr-summary line (matches buildRootMessage's
  // `${repoLink}:\n${authorMention.text} has published a ${prLink}.` shape).
  let fallbackText = `${repoShortName}:\n${authorMention.text} has published a pull request.`;
  if (reviewerMentions.length > 0) {
    fallbackText += ` cc ${reviewerMentions.map((m) => m.text).join(' ')}`;
  }

  // Slack post.
  let postResult: { ok: boolean; ts?: string; error?: string };
  try {
    postResult = await deps.slack.chat.postMessage({
      channel: deps.config.channel.channel,
      text: fallbackText,
      blocks: root.blocks,
    });
  } catch (err) {
    // Pitfall 14: catch SDK errors specifically (not_in_channel etc.) with actionable text.
    const message = err instanceof Error ? err.message : String(err);
    if (/not_in_channel/.test(message)) {
      deps.logger.setFailed(
        `Slack chat.postMessage failed: PR-BOT is not a member of channel ${deps.config.channel.channel}. Run /invite @PR-BOT in the target channel.`,
      );
    } else {
      deps.logger.setFailed(`Slack chat.postMessage threw: ${message}`);
    }
    return;
  }
  if (!postResult.ok || typeof postResult.ts !== 'string' || postResult.ts.length === 0) {
    deps.logger.setFailed(
      `Slack chat.postMessage returned !ok or no ts: ${JSON.stringify(postResult)}`,
    );
    return;
  }
  // CRITICAL D-02 / FND-06: ts is a STRING. No coercion.
  const threadTs: string = postResult.ts;

  // OPEN-05: marker.inject is idempotent on identical ts; PATCH with retry.
  const newBody = injectMarker(liveBody, threadTs);
  await patchWithRetry(deps, owner, repo, routed.pr.number, newBody);

  deps.logger.info(`posted root for PR #${routed.pr.number}, thread_ts=${threadTs}`);
}

// === Phase 3 thread-class flow =============================================

async function handleThreadKind(
  deps: Deps,
  ctx: HandleEventCtx,
  routed: Exclude<RoutedEvent, { kind: 'open' | 'skip' | 'thread-reply' }>,
): Promise<void> {
  const { event } = ctx;
  const { owner, repo } = event.repo;
  const summary = routed.summary;
  const prNumber = summary.prNumber;

  // Step 1: pulls.get → liveBody (single fetch; Pitfall 8 — Phase 2 invariant
  // preserved).
  let liveBody = '';
  try {
    const prGet = await deps.octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
    liveBody = prGet.data.body ?? '';
  } catch (err) {
    deps.logger.setFailed(
      `pulls.get failed for PR #${prNumber}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  // Step 2: FLT-02 — silent-opt-out marker. Forward suppression only (Research §7).
  if (isSilent(liveBody)) {
    deps.logger.info(
      `FLT-02: PR opted out via silent marker — PR #${prNumber}; skipping ${routed.kind} event`,
    );
    return;
  }

  // Step 3: THRD-07 — graceful skip when marker absent.
  // Anchor is created_at (Pitfall 11), NOT updated_at (which the bot's own
  // marker PATCH shifts).
  const threadTs = parseMarker(liveBody);
  if (threadTs === null) {
    const createdAtMs = new Date(summary.prCreatedAt).getTime();
    const ageSec = Number.isFinite(createdAtMs)
      ? Math.round((Date.now() - createdAtMs) / 1000)
      : -1;
    if (Number.isFinite(createdAtMs) && Date.now() - createdAtMs >= 60_000) {
      deps.logger.warning(
        `THRD-07: thread-reply event arrived for PR #${prNumber} opened ${ageSec}s ago with no thread_ts marker — skipping. PR may have been created outside the bot's flow, or the bot's PR-opened run failed (check the PR's Actions tab).`,
      );
    } else {
      deps.logger.info(
        `race-window: PR #${prNumber} opened <60s ago, marker not yet present; skipping ${routed.kind} event`,
      );
    }
    return;
  }

  // Step 4: kind-specific dispatch — see <dispatch_matrix> in plan.
  const channel = deps.config.channel.channel;
  const warn = (msg: string): void => deps.logger.warning(msg);

  switch (routed.kind) {
    case 'review-submitted': {
      const s = routed.summary;
      const reviewerMention = resolveMention(s.reviewerLogin, deps.config.users, { warn });
      // Locked-spec 2026-05-08: review-submitted produces thread reply ONLY.
      // The root-message reaction surface is reserved for terminal-state events
      // (merge / close-without-merge) so the at-a-glance channel scan stays
      // binary: emoji-on-root iff the PR is in a terminal state. Reopen
      // (handleReopen) clears both terminal reactions to flip back to "alive".
      //
      // Approved-state thread-reply text uses a random emoji from
      // APPROVED_EMOJI_POOL — pick once per event, embed in the reply text.
      // No reactions.add call here.
      const approvedEmoji = s.state === 'approved' ? pickApprovedEmoji() : undefined;
      const replyText = formatReviewReply({ state: s.state, reviewerMention, approvedEmoji });
      const reply = buildThreadReply({ text: replyText });
      const postOk = await postThreadReply(
        deps,
        channel,
        threadTs,
        reply.blocks,
        replyText,
        prNumber,
      );
      if (!postOk) return;
      const emojiSuffix = approvedEmoji !== undefined ? `, emoji=${approvedEmoji}` : '';
      deps.logger.info(
        `posted review-submitted reply for PR #${prNumber} (state=${s.state}${emojiSuffix})`,
      );
      return;
    }
    case 'pr-comment': {
      // PR-conversation comment thread reply — locked spec 2026-05-07 always uses
      // the explicit count via formatPrCommentReply (supersedes D-06's singular
      // special-case). n=1 per event — the bot has no aggregation (ROADMAP success
      // criterion 2; V2-AGG-01 owns debounce). Two consecutive comments produce
      // two events, each n=1 → "published 1 comment on the pull request" twice.
      const s = routed.summary;
      const commenterMention = resolveMention(s.commenterLogin, deps.config.users, { warn });
      const replyText = formatPrCommentReply({ commenterMention, n: 1 });
      const reply = buildThreadReply({ text: replyText });
      const postOk = await postThreadReply(
        deps,
        channel,
        threadTs,
        reply.blocks,
        replyText,
        prNumber,
      );
      if (!postOk) return;
      deps.logger.info(`posted pr-comment reply for PR #${prNumber}`);
      return;
    }
    case 'review-comment': {
      // Inline review-comment thread reply — distinct user-visible string from
      // pr-comment ("inline comment" vs "comment"); see formatReviewCommentReply.
      // Always-explicit-count grammar (locked spec 2026-05-07).
      const s = routed.summary;
      const commenterMention = resolveMention(s.commenterLogin, deps.config.users, { warn });
      const replyText = formatReviewCommentReply({ commenterMention, n: 1 });
      const reply = buildThreadReply({ text: replyText });
      const postOk = await postThreadReply(
        deps,
        channel,
        threadTs,
        reply.blocks,
        replyText,
        prNumber,
      );
      if (!postOk) return;
      deps.logger.info(`posted review-comment reply for PR #${prNumber}`);
      return;
    }
    case 'reviewer-requested': {
      // Locked spec 2026-05-07: reply mentions only the requested reviewer
      // (Pitfall 5 — the per-event mention target — never the sender / requester).
      // The "by <requester>" clause is gone, so the requester login is not resolved
      // here and the requester unmapped-warn no longer fires from this dispatcher.
      const s = routed.summary;
      const requestedReviewerMention = resolveMention(s.requestedReviewerLogin, deps.config.users, {
        warn,
      });
      const replyText = formatRequestedReviewReply({ requestedReviewerMention });
      const reply = buildThreadReply({ text: replyText });
      const postOk = await postThreadReply(
        deps,
        channel,
        threadTs,
        reply.blocks,
        replyText,
        prNumber,
      );
      if (!postOk) return;
      deps.logger.info(`posted reviewer-requested reply for PR #${prNumber}`);
      return;
    }
    case 'reopened':
      // Change B 2026-05-07 — multi-call un-strike dispatcher (third multi-call event class
      // alongside merge + close-without-merge). See handleReopen below.
      return handleReopen(deps, ctx, routed, threadTs);
    case 'merged':
    case 'closed-without-merge':
      // Task 2.3 owns the multi-call dispatcher for these kinds.
      return handleTerminal(deps, ctx, routed, threadTs);
    default: {
      // Exhaustive check — TypeScript's never narrowing catches missing branches.
      const _exhaustive: never = routed;
      void _exhaustive;
      deps.logger.info(`(unreachable) unhandled routed kind`);
      return;
    }
  }
}

// === Phase 3 multi-call helpers =============================================

/**
 * Post a Slack thread reply. Returns true on success (so callers can chain).
 *
 * Failure handling mirrors the Phase-2 chat.postMessage-throw pattern at
 * handleOpen lines: not_in_channel surfaces with actionable text; everything
 * else surfaces with the SDK message. Both paths go through core.setFailed
 * because the thread reply is the user-visible signal — losing it loses the
 * record of the event in Slack.
 */
async function postThreadReply(
  deps: Deps,
  channel: string,
  threadTs: string,
  blocks: readonly unknown[],
  text: string,
  prNumber: number,
): Promise<boolean> {
  let result: { ok: boolean; ts?: string; error?: string };
  try {
    result = await deps.slack.chat.postMessage({ channel, thread_ts: threadTs, blocks, text });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not_in_channel/.test(message)) {
      deps.logger.setFailed(
        `Slack chat.postMessage (thread reply) failed for PR #${prNumber}: PR-BOT is not a member of channel ${channel}. Run /invite @PR-BOT in the target channel.`,
      );
    } else {
      deps.logger.setFailed(
        `Slack chat.postMessage (thread reply) threw for PR #${prNumber}: ${message}`,
      );
    }
    return false;
  }
  if (!result.ok) {
    deps.logger.setFailed(
      `Slack chat.postMessage (thread reply) returned !ok for PR #${prNumber}: ${
        result.error ?? 'unknown'
      }`,
    );
    return false;
  }
  return true;
}

/**
 * STAT-01 / STAT-02 / STAT-03 — add a reaction to a Slack message.
 *
 * Error disposition follows Research §4 (reactions.add error table) +
 * Pitfall 16 (already_reacted vs invalid_name distinction):
 *   - already_reacted: STAT-04 idempotent re-run guard → core.info, return clean.
 *   - invalid_name / bad_timestamp / no_item_specified: bot bug → core.setFailed.
 *   - missing_scope / not_in_channel: hard config error → core.setFailed with
 *     actionable hint.
 *   - all other errors (is_archived, message_not_found, ratelimited,
 *     thread_locked, too_many_emoji, too_many_reactions, edit_window_closed,
 *     etc.): soft-fail → core.warning (the canonical signal — the thread
 *     reply — already landed).
 *
 * `name` MUST be the BARE emoji name (no colons) — the colon-wrapped form is
 * for inline message text only. Pitfall 3.
 */
async function addReaction(
  deps: Deps,
  channel: string,
  ts: string,
  name: string,
  prNumber: number,
): Promise<void> {
  try {
    const r = await deps.slack.reactions.add({ channel, timestamp: ts, name });
    if (!r.ok) {
      // Defensively handle the !ok-without-throw shape (the SDK normally throws on !ok).
      const code = r.error ?? 'unknown';
      handleReactionError(deps, code, prNumber, name);
    }
  } catch (err) {
    const code =
      (err as { data?: { error?: string } } | null)?.data?.error ??
      (err instanceof Error ? err.message : 'unknown');
    handleReactionError(deps, code, prNumber, name);
  }
}

function handleReactionError(deps: Deps, code: string, prNumber: number, name: string): void {
  if (code === 'already_reacted') {
    deps.logger.info(
      `reactions.add: already_reacted (PR #${prNumber}, ${name}) — idempotent re-run`,
    );
    return;
  }
  if (code === 'invalid_name' || code === 'bad_timestamp' || code === 'no_item_specified') {
    deps.logger.setFailed(
      `reactions.add hard-failed (${code}) for PR #${prNumber}, ${name} — bot bug`,
    );
    return;
  }
  if (code === 'not_in_channel') {
    deps.logger.setFailed(
      `reactions.add failed (not_in_channel) for PR #${prNumber}, ${name}: PR-BOT is not a member of channel ${deps.config.channel.channel}. Run /invite @PR-BOT in the target channel.`,
    );
    return;
  }
  if (code === 'missing_scope') {
    deps.logger.setFailed(
      `reactions.add failed (missing_scope) for PR #${prNumber}, ${name}: PR-BOT app needs reactions:write scope.`,
    );
    return;
  }
  // All other codes (ratelimited / is_archived / message_not_found / thread_locked /
  // too_many_emoji / too_many_reactions / channel_not_found / token_expired / etc.)
  deps.logger.warning(
    `reactions.add soft-failed (${code}) for PR #${prNumber}, ${name}; thread reply still landed`,
  );
}

/**
 * THRD-04 + STAT-02 (merge); THRD-05 + STAT-03 (close-without-merge).
 *
 * Multi-call serial best-effort dispatcher per Research §8 + Pitfalls 2 / 9 / 10.
 * Three Slack calls in order:
 *   1. chat.postMessage thread reply (LOUD-fail — most user-visible signal)
 *   2. reactions.add on root (soft-fail with STAT-04 already_reacted tolerance)
 *   3. chat.update strikethrough on root (soft-fail; Pitfall 2 — both text+blocks;
 *      Pitfall 9 — never thread_ts)
 *
 * Idempotency note (Research §8): re-running a terminal event would post a
 * duplicate thread reply (signal noise) but reactions.add returns
 * already_reacted (tolerated) and chat.update is structurally idempotent.
 * Per-terminal-event idempotency is deferred to V2 unless plan 03-03 keystone
 * surfaces a real duplicate.
 */
async function handleTerminal(
  deps: Deps,
  ctx: HandleEventCtx,
  routed: { readonly kind: 'merged' | 'closed-without-merge'; readonly summary: TerminalSummary },
  threadTs: string,
): Promise<void> {
  const channel = deps.config.channel.channel;
  const summary = routed.summary;
  const prNumber = summary.prNumber;
  const warn = (msg: string): void => deps.logger.warning(msg);

  // Resolve mentions for the reply (actor) and the strikethrough rebuild
  // (author + reviewers).
  const actorMention = resolveMention(summary.actorLogin, deps.config.users, { warn });
  const authorMention = resolveMention(summary.prAuthorLogin, deps.config.users, { warn });
  const reviewerMentions = resolveAllMentions(
    summary.reviewerLogins as readonly GitHubLogin[],
    deps.config.users,
    { warn },
  );

  // Compose reply text + reaction name per kind.
  const replyText =
    routed.kind === 'merged'
      ? formatMergeReply({ mergerMention: actorMention })
      : formatCloseReply({ closerMention: actorMention });
  const reactionName: string = TERMINAL_REACTION[routed.kind === 'merged' ? 'merged' : 'closed'];

  // Compose strikethrough rebuild — Plan 03-01 buildStrikethroughRoot uses the
  // same BuildRootArgs that built the original OPEN-04 root (author + reviewers,
  // NOT the actor login). Locked spec 2026-05-07: repoUrl is now part of the args
  // so the repo name renders as a `<repoUrl|repoShortName>` mrkdwn link inside
  // the strikethrough tildes, matching the live root.
  const repoShortName = ctx.event.payload.repository?.name ?? ctx.event.repo.repo;
  const repoUrl = `https://github.com/${ctx.event.repo.owner}/${ctx.event.repo.repo}`;
  const struck = buildStrikethroughRoot({
    repoShortName,
    repoUrl,
    prHtmlUrl: summary.prHtmlUrl,
    authorMention,
    reviewerMentions,
  });

  // === Call 1: thread reply (LOUD-fail) ===
  const reply = buildThreadReply({ text: replyText });
  const postOk = await postThreadReply(deps, channel, threadTs, reply.blocks, replyText, prNumber);
  if (!postOk) {
    // setFailed already logged inside postThreadReply.
    return;
  }

  // === Call 2: root reaction (soft-fail with STAT-04 tolerance) ===
  await addReaction(deps, channel, threadTs, reactionName, prNumber);

  // === Call 3: chat.update strikethrough (soft-fail) ===
  // Pitfall 2: both text AND blocks. Pitfall 9: NO thread_ts.
  try {
    const r = await deps.slack.chat.update({
      channel,
      ts: threadTs,
      text: struck.text,
      blocks: struck.blocks,
    });
    if (!r.ok) {
      deps.logger.warning(
        `chat.update (${routed.kind} strikethrough) returned !ok for PR #${prNumber}: ${
          r.error ?? 'unknown'
        }; thread reply + reaction already landed`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger.warning(
      `chat.update (${routed.kind} strikethrough) threw for PR #${prNumber}: ${message}; thread reply + reaction already landed`,
    );
  }

  deps.logger.info(`posted ${routed.kind} thread + reaction + strikethrough for PR #${prNumber}`);
}

/**
 * Change B 2026-05-07 — multi-call un-strike dispatcher for pull_request: reopened.
 *
 * Mirrors handleTerminal's shape (4 sequential Slack calls) but inverts the
 * strikethrough: re-renders the live root via buildRootMessage instead of
 * buildStrikethroughRoot, so the channel-glance signal accurately reflects the
 * PR's reopened state.
 *
 * Calls in order:
 *   1. chat.postMessage thread reply (LOUD-fail)
 *   2. reactions.remove on root with name 'no_entry_sign' (soft-fail; tolerates
 *      no_reaction, message_not_found, ratelimited, etc. via warning)
 *   3. reactions.remove on root with name 'tada' (soft-fail; same tier)
 *   4. chat.update with un-struck root (soft-fail; Pitfall 2 dual args; Pitfall 9
 *      no thread_ts)
 *
 * Both terminal reactions are removed because the bot does not track which one
 * was previously added — the close path adds 'no_entry_sign' and the merge path
 * adds 'tada'; reopen handles both. The no_reaction tolerated error covers the
 * "never had a terminal reaction" case (defensive — the reopened event should
 * never fire on a never-closed PR, but defense in depth).
 */
async function handleReopen(
  deps: Deps,
  ctx: HandleEventCtx,
  routed: { readonly kind: 'reopened'; readonly summary: ReopenSummary },
  threadTs: string,
): Promise<void> {
  const channel = deps.config.channel.channel;
  const summary = routed.summary;
  const prNumber = summary.prNumber;
  const warn = (msg: string): void => deps.logger.warning(msg);

  const reopenerMention = resolveMention(summary.reopenerLogin, deps.config.users, { warn });
  const authorMention = resolveMention(summary.prAuthorLogin, deps.config.users, { warn });
  const reviewerMentions = resolveAllMentions(
    summary.reviewerLogins as readonly GitHubLogin[],
    deps.config.users,
    { warn },
  );

  const replyText = formatReopenReply({ reopenerMention });

  const repoShortName = ctx.event.payload.repository?.name ?? ctx.event.repo.repo;
  const repoUrl = `https://github.com/${ctx.event.repo.owner}/${ctx.event.repo.repo}`;
  const root = buildRootMessage({
    repoShortName,
    repoUrl,
    prHtmlUrl: summary.prHtmlUrl,
    authorMention,
    reviewerMentions,
  });

  // === Call 1: thread reply (LOUD-fail) ===
  const reply = buildThreadReply({ text: replyText });
  const postOk = await postThreadReply(deps, channel, threadTs, reply.blocks, replyText, prNumber);
  if (!postOk) return;

  // === Call 2 + 3: reactions.remove for both terminal reactions (soft-fail) ===
  await removeReaction(deps, channel, threadTs, TERMINAL_REACTION.closed, prNumber);
  await removeReaction(deps, channel, threadTs, TERMINAL_REACTION.merged, prNumber);

  // === Call 4: chat.update with un-struck root (soft-fail) ===
  // Pitfall 2: both text AND blocks. Pitfall 9: NO thread_ts.
  try {
    const r = await deps.slack.chat.update({
      channel,
      ts: threadTs,
      text: root.text,
      blocks: root.blocks,
    });
    if (!r.ok) {
      deps.logger.warning(
        `chat.update (reopen un-strikethrough) returned !ok for PR #${prNumber}: ${
          r.error ?? 'unknown'
        }; thread reply + reactions removed already landed`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.logger.warning(
      `chat.update (reopen un-strikethrough) threw for PR #${prNumber}: ${message}; thread reply + reactions removed already landed`,
    );
  }

  deps.logger.info(
    `posted reopened thread + un-strikethrough + reactions removed for PR #${prNumber}`,
  );
}

/**
 * Change B 2026-05-07 — parallel to addReaction. Removes a reaction from a Slack
 * message; routes errors through handleReactionRemovalError (paralleling
 * handleReactionError but with the reactions.remove-specific tier mapping).
 *
 * The unique tolerated code is no_reaction (the user/bot hasn't reacted with this
 * emoji on this message — idempotent re-remove or never-was-present). All other
 * codes follow the same tier mapping as reactions.add (setFailed for bot bugs,
 * setFailed-with-hint for config bugs, warning for transient/out-of-band).
 */
async function removeReaction(
  deps: Deps,
  channel: string,
  ts: string,
  name: string,
  prNumber: number,
): Promise<void> {
  try {
    const r = await deps.slack.reactions.remove({ channel, timestamp: ts, name });
    if (!r.ok) {
      const code = r.error ?? 'unknown';
      handleReactionRemovalError(deps, code, prNumber, name);
    }
  } catch (err) {
    const code =
      (err as { data?: { error?: string } } | null)?.data?.error ??
      (err instanceof Error ? err.message : 'unknown');
    handleReactionRemovalError(deps, code, prNumber, name);
  }
}

function handleReactionRemovalError(
  deps: Deps,
  code: string,
  prNumber: number,
  name: string,
): void {
  if (code === 'no_reaction') {
    deps.logger.info(
      `removeReaction: no_reaction (PR #${prNumber}, ${name}) — idempotent re-run / never-present`,
    );
    return;
  }
  if (code === 'message_not_found') {
    deps.logger.warning(
      `removeReaction: message_not_found (PR #${prNumber}, ${name}); thread reply still landed`,
    );
    return;
  }
  if (code === 'invalid_name' || code === 'bad_timestamp' || code === 'no_item_specified') {
    deps.logger.setFailed(
      `removeReaction hard-failed (${code}) for PR #${prNumber}, ${name} — bot bug`,
    );
    return;
  }
  if (code === 'not_in_channel') {
    deps.logger.setFailed(
      `removeReaction failed (not_in_channel) for PR #${prNumber}, ${name}: PR-BOT is not a member of channel ${deps.config.channel.channel}. Run /invite @PR-BOT in the target channel.`,
    );
    return;
  }
  if (code === 'missing_scope') {
    deps.logger.setFailed(
      `removeReaction failed (missing_scope) for PR #${prNumber}, ${name}: PR-BOT app needs reactions:write scope.`,
    );
    return;
  }
  // All other codes (ratelimited / is_archived / thread_locked / channel_not_found /
  // token_expired / etc.) — soft-fail so the dispatcher continues to chat.update.
  deps.logger.warning(
    `removeReaction soft-failed (${code}) for PR #${prNumber}, ${name}; thread reply still landed`,
  );
}

// --- PATCH retry helper (OPEN-05; Pitfall 7) -------------------------------

async function patchWithRetry(
  deps: Deps,
  owner: string,
  repo: string,
  pull_number: number,
  body: string,
): Promise<void> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastErr: unknown = null;
  for (let i = 0; i < PATCH_RETRY_DELAYS_MS.length; i++) {
    const delay = PATCH_RETRY_DELAYS_MS[i] ?? 0;
    if (delay > 0) await sleep(delay);
    try {
      await deps.octokit.rest.pulls.update({ owner, repo, pull_number, body });
      return;
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number } | null)?.status;
      if (status !== undefined && status >= 400 && status < 500) {
        // Hard failure (e.g. 403 missing pull-requests:write). Do NOT retry.
        deps.logger.setFailed(
          `pulls.update failed with status ${status}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
      deps.logger.warning(
        `pulls.update attempt ${i + 1} failed (${status ?? 'network'}); retrying`,
      );
    }
  }
  deps.logger.setFailed(
    `pulls.update failed after ${PATCH_RETRY_DELAYS_MS.length} attempts: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
  // Note: OBS-04 (Phase 5) will add a visible Slack message when this happens.
}

// === Phase 3.1 — schedule-event handler (STALE-01) =========================
//
// handleStaleCheck is dispatched by main() when context.eventName === 'schedule'.
// The webhook event router (handleEvent) is untouched — schedule events do not
// carry a webhook payload, so the dispatcher takes a different shape (no PR in
// payload; PRs discovered via octokit.rest.pulls.list).
//
// The 9-step filter chain mirrors REQUIREMENTS.md STALE-01 canonical order:
//   1. thread_ts marker required  (no-marker)
//   2. silent opt-out             (silent-marker)
//   3. not draft                  (draft)
//   4. not bot author             (bot-author)        — FLT-01 parity via isBotActor
//   5. not too old                (too-old)           — calendar days
//   6. stale enough               (too-young)         — business days
//   7. reping cooldown elapsed    (reping-cooldown)   — business days since last ping
//   8. today not a holiday        (holiday)           — checked once at run start
//   9. ping budget remaining      (max-pings-reached)
//
// Eligible PRs receive a thread-reply ping + PR-body PATCH (stale_pinged_at +
// stale_ping_count markers). Failures on one PR do not abort the loop — each
// PR is independent. STAT-01 re-lock invariant: handleStaleCheck does NOT call
// the Slack reaction-add or reaction-remove APIs (the new code path is
// reaction-free; root reactions remain reserved for terminal-state events).
const PULLS_LIST_PAGE_SIZE = 100;

export async function handleStaleCheck(deps: Deps, ctx?: HandleEventCtx): Promise<void> {
  const cfg = deps.config.staleCheck;
  if (!cfg) {
    deps.logger.setFailed(
      'handleStaleCheck: deps.config.staleCheck not loaded (config/stale-check.yml — see Plan 03.1-01)',
    );
    return;
  }

  const eventRepo = ctx?.event.repo ?? deps.repo;
  if (!eventRepo) {
    deps.logger.setFailed(
      'handleStaleCheck: no owner/repo available (provide ctx.event.repo or deps.repo)',
    );
    return;
  }
  const { owner, repo } = eventRepo;
  const now = (deps.now ?? (() => new Date()))();
  const todayISO = now.toISOString().slice(0, 10);
  const holidaysSet = new Set(cfg.holidays);

  // Filter step 8 — short-circuits the WHOLE run before any I/O when today
  // itself is a holiday (extra safety guard beyond the cron's Mon-Fri pattern).
  if (holidaysSet.has(todayISO)) {
    deps.logger.info(`stale-check: today (${todayISO}) is a holiday; entire run skipped`);
    return;
  }

  // Discover candidate PRs via paginated pulls.list.
  const allPrs: PullListItem[] = [];
  let page = 1;
  while (true) {
    let resp: { data: ReadonlyArray<PullListItem> };
    try {
      resp = await deps.octokit.rest.pulls.list({
        owner,
        repo,
        state: 'open',
        per_page: PULLS_LIST_PAGE_SIZE,
        page,
      });
    } catch (err) {
      deps.logger.setFailed(
        `stale-check: pulls.list failed at page ${page}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }
    const batch = resp.data ?? [];
    if (batch.length === 0) break;
    allPrs.push(...batch);
    if (batch.length < PULLS_LIST_PAGE_SIZE) break;
    page++;
  }
  deps.logger.info(`stale-check: ${allPrs.length} open PRs to consider`);

  for (const pr of allPrs) {
    // WR-01 per-PR error isolation — every iteration is independent. An
    // unexpected throw from processOnePrForStaleCheck (e.g. a future-API
    // contract change yielding a malformed pr.created_at, a manually-edited
    // marker carrying a non-ISO value past the parse-time guard, an
    // unclassified octokit exception) must not abort the rest of the run.
    // Inner guards (WR-05 malformed-created_at, WR-06 malformed-marker)
    // handle the known throw paths; this outer catch is the belt-and-braces
    // floor. The source-comment claim at lines 993-994 ("Failures on one PR
    // do not abort the loop — each PR is independent") is now enforced.
    try {
      await processOnePrForStaleCheck(deps, owner, repo, pr, cfg, holidaysSet, todayISO, now);
    } catch (err) {
      deps.logger.warning(
        `stale-check: PR #${pr.number} threw unexpectedly; continuing to next PR. ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

async function processOnePrForStaleCheck(
  deps: Deps,
  owner: string,
  repo: string,
  pr: PullListItem,
  cfg: StaleCheckConfig,
  holidays: ReadonlySet<string>,
  todayISO: string,
  now: Date,
): Promise<void> {
  const body = pr.body ?? '';
  const prNumber = pr.number;

  // Filter step 1: thread_ts marker required (bot doesn't own pre-install PRs).
  const threadTs = parseMarker(body);
  if (threadTs === null) {
    deps.logger.info(`stale-check skipped: no-marker (PR #${prNumber})`);
    return;
  }

  // Filter step 2: silent opt-out (FLT-02 parity).
  if (isSilent(body)) {
    deps.logger.info(`stale-check skipped: silent-marker (PR #${prNumber})`);
    return;
  }

  // Filter step 3: drafts.
  if (pr.draft === true) {
    deps.logger.info(`stale-check skipped: draft (PR #${prNumber})`);
    return;
  }

  // Filter step 4: bot author (FLT-01 parity — isBotActor handles both
  // type='Bot' and the login-suffix belt-and-braces case).
  if (isBotActor(pr.user)) {
    deps.logger.info(`stale-check skipped: bot-author (PR #${prNumber})`);
    return;
  }

  // Filter step 5: too old (calendar days).
  const createdAtMs = new Date(pr.created_at).getTime();
  if (Number.isFinite(createdAtMs)) {
    const ageDays = (now.getTime() - createdAtMs) / (24 * 60 * 60 * 1000);
    if (ageDays > cfg.maxAgeDays) {
      deps.logger.info(
        `stale-check skipped: too-old (PR #${prNumber}, age=${Math.round(ageDays)}d)`,
      );
      return;
    }
  }

  // Filter step 6: too young (business days).
  const createdAtISO = pr.created_at.slice(0, 10);
  const businessDaysOpen = businessDaysBetween(createdAtISO, todayISO, holidays);
  if (businessDaysOpen < cfg.staleThresholdBusinessDays) {
    deps.logger.info(
      `stale-check skipped: too-young (PR #${prNumber}, business_days_open=${businessDaysOpen})`,
    );
    return;
  }

  // Filter step 7: reping cooldown.
  const lastPinged = parseStalePingedAt(body);
  if (lastPinged !== null) {
    const sinceLastPing = businessDaysBetween(lastPinged, todayISO, holidays);
    if (sinceLastPing < cfg.repingIntervalBusinessDays) {
      deps.logger.info(
        `stale-check skipped: reping-cooldown (PR #${prNumber}, business_days_since_last=${sinceLastPing})`,
      );
      return;
    }
  }

  // Filter step 8 already handled at the run-level; per-PR is a no-op here.

  // Filter step 9: max pings reached. Marker value is a STRING (D-02 / FND-06
  // parity); integer-parse exactly once via Number.parseInt with explicit
  // radix and NaN-fallback to 0.
  const countStr = parseStalePingCount(body);
  const parsedCount = countStr === null ? 0 : Number.parseInt(countStr, 10);
  const safeCurrentCount = Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : 0;
  if (safeCurrentCount >= cfg.maxPingsPerPr) {
    deps.logger.info(
      `stale-check skipped: max-pings-reached (PR #${prNumber}, count=${safeCurrentCount})`,
    );
    return;
  }

  // Eligible — fire the ping (thread reply only; root-reaction-free per
  // STAT-01 re-lock 2026-05-08).
  const warn = (msg: string): void => deps.logger.warning(msg);
  const authorLogin = pr.user?.login ?? '';
  const authorMention = resolveMention(authorLogin, deps.config.users, { warn });
  const reviewerLogins: GitHubLogin[] = (pr.requested_reviewers ?? [])
    .map((r) => r.login)
    .filter((l): l is string => typeof l === 'string' && l.length > 0);
  const reviewerMentions = resolveAllMentions(reviewerLogins, deps.config.users, { warn });

  const replyText = formatStalePingReply({ businessDaysOpen, authorMention, reviewerMentions });
  const reply = buildThreadReply({ text: replyText });
  const channel = deps.config.channel.channel;

  const postOk = await postThreadReply(deps, channel, threadTs, reply.blocks, replyText, prNumber);
  if (!postOk) return; // postThreadReply already tier-mapped the error.

  // Increment count + write both new markers via the existing patchWithRetry.
  const nextCount = safeCurrentCount + 1;
  const newBody = injectStalePingCount(injectStalePingedAt(body, todayISO), String(nextCount));
  await patchWithRetry(deps, owner, repo, prNumber, newBody);

  deps.logger.info(
    `posted stale-ping for PR #${prNumber} (business_days_open=${businessDaysOpen}, ping_count=${nextCount})`,
  );
}

// --- Bootstrap (only runs in production; test envs short-circuit) ----------

export async function main(): Promise<void> {
  try {
    const slackToken = process.env.SLACK_BOT_TOKEN ?? '';
    if (slackToken.length === 0) {
      core.setFailed('SLACK_BOT_TOKEN is not set');
      return;
    }
    core.setSecret(slackToken); // mask in logs

    const githubToken =
      process.env.GITHUB_TOKEN ?? core.getInput('github-token', { required: false });
    if (githubToken.length === 0) {
      core.setFailed('GITHUB_TOKEN is not set');
      return;
    }

    const usersYaml = fs.readFileSync('config/users.yml', 'utf8');
    const channelYaml = fs.readFileSync('config/channel.yml', 'utf8');
    // Phase 3.1 — stale-check config is optional at file level so local dev
    // and ad-hoc test environments don't crash if the YAML is absent. In
    // production, tests/config-schema.test.ts enforces the on-disk shape; an
    // absent file in production is a setup bug surfaced by the defensive
    // setFailed inside handleStaleCheck.
    //
    // WR-02 — distinguish ENOENT (file absent → benign, leave staleCheck
    // undefined and let webhook events proceed; the schedule path's
    // defensive setFailed inside handleStaleCheck will fire if a cron run
    // happens with no config) from schema violations (malformed YAML or
    // failing requireNonNegativeInteger etc. → loud-fail per D-17 invariant,
    // surface the loader's exact error message in the Actions run as a red X).
    let staleCheck: StaleCheckConfig | undefined;
    try {
      const staleCheckYaml = fs.readFileSync('config/stale-check.yml', 'utf8');
      staleCheck = loadStaleCheckConfig(staleCheckYaml);
    } catch (err) {
      const isMissingFile = (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';
      if (!isMissingFile) {
        core.setFailed(
          `config/stale-check.yml schema error: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
      staleCheck = undefined;
    }
    const config = {
      users: loadUsersMap(usersYaml),
      channel: loadChannelConfig(channelYaml),
      staleCheck,
    };

    // WR-04 — production safety guard. The D3 relaxation makes
    // reping_interval_business_days=0 a valid schema value (the Phase 3.1
    // keystone needs it). In production with a frequent cron, however, 0
    // disables the per-PR cooldown — every run re-pings eligible PRs, capped
    // only by max_pings_per_pr. That cap can be exhausted in a single
    // afternoon. Surface a startup warning so operators see the risk in the
    // Actions run; one-time log (not per-PR). This is intentional permissive
    // mode — we DO NOT setFailed because the keystone path is legitimate.
    if (staleCheck !== undefined && staleCheck.repingIntervalBusinessDays === 0) {
      core.warning(
        'config/stale-check.yml: reping_interval_business_days=0 disables the stale-check cooldown — every cron run will re-ping eligible PRs, capped only by max_pings_per_pr. Set to >=1 for production.',
      );
    }

    const slack = new WebClient(slackToken);
    const octokit = getOctokit(githubToken);

    const deps: Deps = {
      slack: {
        chat: {
          postMessage: (args) =>
            slack.chat.postMessage(
              args as Parameters<typeof slack.chat.postMessage>[0],
            ) as ReturnType<Deps['slack']['chat']['postMessage']>,
          update: (args) =>
            slack.chat.update(args as Parameters<typeof slack.chat.update>[0]) as ReturnType<
              Deps['slack']['chat']['update']
            >,
        },
        reactions: {
          add: (args) =>
            slack.reactions.add(args as Parameters<typeof slack.reactions.add>[0]) as ReturnType<
              Deps['slack']['reactions']['add']
            >,
          // Change B 2026-05-07 — wired alongside reactions.add for the new
          // handleReopen multi-call dispatcher (un-strikes the root by removing
          // both terminal reactions).
          remove: (args) =>
            slack.reactions.remove(
              args as Parameters<typeof slack.reactions.remove>[0],
            ) as ReturnType<Deps['slack']['reactions']['remove']>,
        },
      },
      octokit: {
        rest: {
          pulls: {
            get: octokit.rest.pulls.get,
            update: octokit.rest.pulls.update,
            // Phase 3.1 — pulls.list for the schedule-event PR-discovery loop.
            list: octokit.rest.pulls.list,
          },
        },
      } as Deps['octokit'],
      config,
      logger: {
        info: (m) => core.info(m),
        warning: (m) => core.warning(m),
        setFailed: (m) => core.setFailed(m),
      },
      repo: context.repo,
    };

    // Phase 3.1 — schedule events do not carry a webhook payload; route to the
    // dedicated stale-check entry point BEFORE the webhook dispatcher. Webhook
    // events fall through to handleEvent as before.
    //
    // The workflow_dispatch synonym exists exclusively to support the Phase 3.1
    // sandbox keystone synthetic-fire path: `gh workflow run pr-bot.yml` sets
    // context.eventName to 'workflow_dispatch' (NOT 'schedule'), so without
    // accepting it here the keystone cannot exercise handleStaleCheck on demand.
    // The canonical examples/pr-bot.yml stays cron-only; only the sandbox stubs
    // add the `workflow_dispatch:` trigger (and only for keystone validation).
    // Both event names route to the same handleStaleCheck dispatch — there is
    // no behavioral divergence between them.
    if (context.eventName === 'schedule' || context.eventName === 'workflow_dispatch') {
      await handleStaleCheck(deps, {
        event: {
          name: 'schedule',
          payload: {},
          repo: context.repo,
        },
      });
    } else {
      await handleEvent(deps, {
        event: {
          name: context.eventName,
          payload: context.payload as HandleEventCtx['event']['payload'],
          repo: context.repo,
        },
      });
    }
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

// Fire main() only when running on the GitHub Actions runner. Tests import handleEvent
// directly; setting NODE_ENV=test or simply importing this module from Vitest does not
// invoke main(). The check below is the conventional ESM-friendly idiom.
if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
  void main();
}
