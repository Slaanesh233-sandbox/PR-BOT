// PR-BOT action handler — Phase 2 Plan 02-01.
//
// Replaces the Plan 01-01 placeholder. Composes the Phase 1 lib modules into the
// keystone end-to-end flow: filter bots → classify → idempotency check → resolve
// mentions → build OPEN-04 root → chat.postMessage → marker.inject → pulls.update
// (with bounded retry). All Slack and GitHub I/O happens through dependency-injected
// clients so tests/handler.test.ts can drive every branch with vi.fn() mocks.
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
//   - Pitfall 10: repo short name comes from `payload.repository.name`, not full_name.

import * as fs from 'node:fs';

import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { WebClient } from '@slack/web-api';

import {
  buildRootMessage,
  classify,
  inject as injectMarker,
  isBotActor,
  loadChannelConfig,
  loadUsersMap,
  parse as parseMarker,
  resolve as resolveMention,
  resolveAll as resolveAllMentions,
  type ChannelConfig,
  type GitHubLogin,
  type ResolvedMention,
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

  // FLT-01: bot-filter runs FIRST, before any I/O.
  if (isBotActor(sender)) {
    deps.logger.info(`skipped: sender is bot (${sender?.login ?? 'unknown'})`);
    return;
  }

  // Classify via Phase 1 event-router.
  const routed = classify({ name: event.name, payload: event.payload });
  if (routed.kind === 'skip') {
    deps.logger.info(`skipped: ${routed.reason}`);
    return;
  }
  if (routed.kind !== 'open') {
    // Phase 1 only emits 'open' or 'skip' for the open-class; this guard exists for
    // future-phase RoutedEvent variants (thread-reply etc.) which the open-class
    // handler does not service.
    deps.logger.info(`skipped: not an open-class event (kind=${routed.kind})`);
    return;
  }

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
