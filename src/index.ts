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

import * as fs from 'node:fs';

import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { WebClient } from '@slack/web-api';

import {
  buildRootMessage,
  buildStrikethroughRoot,
  buildThreadReply,
  classify,
  formatCloseReply,
  formatCommentReply,
  formatMergeReply,
  formatRequestedReviewReply,
  formatReopenReply,
  formatReviewReply,
  inject as injectMarker,
  isBotActor,
  isSilent,
  loadChannelConfig,
  loadUsersMap,
  parse as parseMarker,
  resolve as resolveMention,
  resolveAll as resolveAllMentions,
  REVIEW_REACTION,
  TERMINAL_REACTION,
  type ChannelConfig,
  type GitHubLogin,
  type IssueCommentSummary,
  type PrSummary,
  type ReopenSummary,
  type ResolvedMention,
  type ReviewCommentSummary,
  type ReviewerRequestSummary,
  type ReviewSummary,
  type RoutedEvent,
  type TerminalSummary,
  type UsersMap,
} from './lib/index.js';

// --- Public DI seam --------------------------------------------------------

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
      };
    };
  };
  readonly config: {
    readonly users: UsersMap;
    readonly channel: ChannelConfig;
  };
  readonly logger: {
    info(msg: string): void;
    warning(msg: string): void;
    setFailed(msg: string): void;
  };
  // Injectable sleep (tests pass () => {} to fast-forward retry delays).
  readonly sleep?: (ms: number) => Promise<void>;
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
  const repoShortName = event.payload.repository?.name ?? repo;
  const root = buildRootMessage({
    repoShortName,
    prHtmlUrl: routed.pr.htmlUrl,
    authorMention,
    reviewerMentions,
  });

  // Pitfall 8: plain-text fallback for accessibility / DnD push notifications.
  // Built from already-resolved ResolvedMention.text strings — no new mention syntax here.
  let fallbackText = `${repoShortName}: ${authorMention.text} has raised a PR.`;
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

  // Step 4: kind-specific dispatch — Task 2.2 + Task 2.3 fill in branches.
  // Reference the unused intermediates so TypeScript compiles cleanly while the
  // Phase-3 dispatch branches are stubbed.
  void summary;
  void threadTs;
  void formatReviewReply;
  void formatCommentReply;
  void formatRequestedReviewReply;
  void formatReopenReply;
  void formatMergeReply;
  void formatCloseReply;
  void buildThreadReply;
  void buildStrikethroughRoot;
  void REVIEW_REACTION;
  void TERMINAL_REACTION;
  // Type-level acknowledgements that the per-kind summary types are imported and
  // narrowable; the actual dispatch lives in Tasks 2.2 + 2.3.
  type _PhaseThreeSummaryUnion =
    | ReviewSummary
    | IssueCommentSummary
    | ReviewCommentSummary
    | ReviewerRequestSummary
    | TerminalSummary
    | ReopenSummary;
  const _phaseThreeSummaryAcknowledged = null as unknown as _PhaseThreeSummaryUnion | null;
  void _phaseThreeSummaryAcknowledged;
  deps.logger.info(
    `(stub) handleThreadKind dispatch reached for kind=${routed.kind} on PR #${prNumber}; Task 2.2 wires the per-kind sequence.`,
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
    const config = {
      users: loadUsersMap(usersYaml),
      channel: loadChannelConfig(channelYaml),
    };

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
        },
      },
      octokit: {
        rest: { pulls: { get: octokit.rest.pulls.get, update: octokit.rest.pulls.update } },
      } as Deps['octokit'],
      config,
      logger: {
        info: (m) => core.info(m),
        warning: (m) => core.warning(m),
        setFailed: (m) => core.setFailed(m),
      },
    };

    await handleEvent(deps, {
      event: {
        name: context.eventName,
        payload: context.payload as HandleEventCtx['event']['payload'],
        repo: context.repo,
      },
    });
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
