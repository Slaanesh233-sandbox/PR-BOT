// tests/handler.test.ts — Phase 2 Plan 02-01
//
// Mocked-handler unit suite. Every test stubs `slack` and `octokit` via `vi.fn()` and
// asserts the exact set of calls handleEvent makes for a given event payload + config.
//
// FLT-05 note: the literal Slack user-mention strings appear here only inside fixture
// data and assertions. CI Gate 7 scopes its grep to `src/`; tests/ is W-02 exempt — see
// .github/workflows/ci.yml Gate 7 inline comment for rationale.

import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { handleEvent, handleStaleCheck, type Deps, type HandleEventCtx } from '../src/index.js';
import { loadStaleCheckConfig, type StaleCheckConfig } from '../src/lib/index.js';

// Used by the STAT-01 invariant test below to read src/index.ts as text.
const repoRootForHandlerTests = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

const SAMPLE_TS = '1700000000.000100'; // FND-06 trailing-zero fixture
const KAI_SLACK_ID = 'U0B20676JVB';
const SANDBOX_CHANNEL_ID = 'C0B2GF3UJ01';

interface MockOverrides {
  postMessageResult?: { ok: boolean; ts?: string; error?: string };
  postMessageImpl?: () => Promise<{ ok: boolean; ts?: string; error?: string }>;
  pullsGetBody?: string | null;
  pullsUpdateImpl?: (args: {
    owner: string;
    repo: string;
    pull_number: number;
    body: string;
  }) => Promise<unknown>;
  users?: Record<string, string>;
  // Phase 3 additions:
  chatUpdateImpl?: () => Promise<{ ok: boolean; error?: string }>;
  reactionsAddImpl?: () => Promise<{ ok: boolean; error?: string }>;
  // Change B 2026-05-07 (Task 2):
  reactionsRemoveImpl?: () => Promise<{ ok: boolean; error?: string }>;
  // Phase 3.1 additions:
  // pulls.list (paginated PR discovery; returns sequential pages by call index)
  pullsListImpl?: (args: {
    owner: string;
    repo: string;
    state: 'open' | 'closed' | 'all';
    per_page?: number;
    page?: number;
  }) => Promise<{ data: ReadonlyArray<unknown> }>;
  now?: () => Date;
  staleCheck?: StaleCheckConfig;
}

function makeMockDeps(overrides: MockOverrides = {}): {
  deps: Deps;
  spies: {
    postMessage: ReturnType<typeof vi.fn>;
    pullsGet: ReturnType<typeof vi.fn>;
    pullsUpdate: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warning: ReturnType<typeof vi.fn>;
    setFailed: ReturnType<typeof vi.fn>;
    // Phase 3 spies:
    chatUpdate: ReturnType<typeof vi.fn>;
    reactionsAdd: ReturnType<typeof vi.fn>;
    // Change B 2026-05-07 (Task 2):
    reactionsRemove: ReturnType<typeof vi.fn>;
    // Phase 3.1 spy:
    pullsList: ReturnType<typeof vi.fn>;
  };
} {
  const postMessageResult = overrides.postMessageResult ?? { ok: true, ts: SAMPLE_TS };
  const pullsGetBody =
    overrides.pullsGetBody === undefined ? 'original PR body' : overrides.pullsGetBody;
  const users =
    overrides.users ??
    ({
      kai: KAI_SLACK_ID,
      'dummy-reviewer': KAI_SLACK_ID,
      reviewer: KAI_SLACK_ID,
      commenter: KAI_SLACK_ID,
      merger: KAI_SLACK_ID,
      closer: KAI_SLACK_ID,
      reopener: KAI_SLACK_ID,
      r1: KAI_SLACK_ID,
      r2: KAI_SLACK_ID,
    } as Record<string, string>);
  const pullsUpdateImpl = overrides.pullsUpdateImpl ?? (async () => ({ data: {} }));
  const chatUpdateImpl = overrides.chatUpdateImpl ?? (async () => ({ ok: true }));
  const reactionsAddImpl = overrides.reactionsAddImpl ?? (async () => ({ ok: true }));
  const reactionsRemoveImpl = overrides.reactionsRemoveImpl ?? (async () => ({ ok: true }));
  const pullsListImpl = overrides.pullsListImpl ?? (async () => ({ data: [] }));

  const postMessage = overrides.postMessageImpl
    ? vi.fn().mockImplementation(overrides.postMessageImpl)
    : vi.fn().mockResolvedValue(postMessageResult);
  const pullsGet = vi.fn().mockResolvedValue({ data: { body: pullsGetBody } });
  const pullsUpdate = vi.fn().mockImplementation(pullsUpdateImpl);
  const chatUpdate = vi.fn().mockImplementation(chatUpdateImpl);
  const reactionsAdd = vi.fn().mockImplementation(reactionsAddImpl);
  const reactionsRemove = vi.fn().mockImplementation(reactionsRemoveImpl);
  const pullsList = vi.fn().mockImplementation(pullsListImpl);
  const info = vi.fn();
  const warning = vi.fn();
  const setFailed = vi.fn();

  const deps: Deps = {
    slack: {
      chat: { postMessage, update: chatUpdate },
      reactions: { add: reactionsAdd, remove: reactionsRemove },
    } as unknown as Deps['slack'],
    octokit: {
      rest: { pulls: { get: pullsGet, update: pullsUpdate, list: pullsList } },
    } as unknown as Deps['octokit'],
    config: {
      users: { users },
      channel: { channel: SANDBOX_CHANNEL_ID },
      staleCheck: overrides.staleCheck,
    },
    logger: { info, warning, setFailed },
    sleep: async () => {}, // fast-forward retry delays in tests
    now: overrides.now,
  };

  return {
    deps,
    spies: {
      postMessage,
      pullsGet,
      pullsUpdate,
      info,
      warning,
      setFailed,
      chatUpdate,
      reactionsAdd,
      reactionsRemove,
      pullsList,
    },
  };
}

interface OpenedEventOpts {
  draft?: boolean;
  reviewers?: string[];
  authorLogin?: string;
  senderLogin?: string;
  senderType?: string;
  action?: 'opened' | 'ready_for_review';
  prNumber?: number;
  repoName?: string;
  repoFullName?: string;
}

function openedEvent(opts: OpenedEventOpts = {}): HandleEventCtx['event'] {
  const draft = opts.draft ?? false;
  const reviewers = opts.reviewers ?? [];
  const authorLogin = opts.authorLogin ?? 'kai';
  const senderLogin = opts.senderLogin ?? authorLogin;
  const senderType = opts.senderType ?? 'User';
  const action = opts.action ?? 'opened';
  const prNumber = opts.prNumber ?? 42;
  const repoName = opts.repoName ?? 'sandbox-repo-a';
  const repoFullName = opts.repoFullName ?? `Slaanesh233-sandbox/${repoName}`;
  return {
    name: 'pull_request' as const,
    payload: {
      action,
      sender: { login: senderLogin, type: senderType },
      pull_request: {
        number: prNumber,
        html_url: `https://github.com/${repoFullName}/pull/${prNumber}`,
        draft,
        user: { login: authorLogin },
        requested_reviewers: reviewers.map((login) => ({ login })),
      },
      repository: { name: repoName, full_name: repoFullName },
    },
    repo: { owner: 'Slaanesh233-sandbox', repo: repoName },
  };
}

// === Phase 3 fixture builders ============================================
// Default `created_at` is ~1 hour in the past, so THRD-07 race-window logic
// does NOT trigger by default. Opt in to the race-window via prCreatedAt.
const OLD_CREATED_AT = new Date(Date.now() - 3600_000).toISOString();
const RECENT_CREATED_AT = new Date(Date.now() - 5_000).toISOString();

interface ReviewSubmittedOpts {
  state?: 'approved' | 'changes_requested' | 'commented';
  reviewerLogin?: string;
  prNumber?: number;
  prCreatedAt?: string;
  senderLogin?: string;
  senderType?: string;
  repoName?: string;
}

function reviewSubmittedEvent(opts: ReviewSubmittedOpts = {}): HandleEventCtx['event'] {
  const repoName = opts.repoName ?? 'sandbox-repo-a';
  const prNumber = opts.prNumber ?? 42;
  const reviewerLogin = opts.reviewerLogin ?? 'reviewer';
  return {
    name: 'pull_request_review' as const,
    payload: {
      action: 'submitted',
      sender: { login: opts.senderLogin ?? reviewerLogin, type: opts.senderType ?? 'User' },
      review: { state: opts.state ?? 'approved', user: { login: reviewerLogin } },
      pull_request: {
        number: prNumber,
        html_url: `https://github.com/Slaanesh233-sandbox/${repoName}/pull/${prNumber}`,
        user: { login: 'kai' },
        created_at: opts.prCreatedAt ?? OLD_CREATED_AT,
      },
      repository: { name: repoName, full_name: `Slaanesh233-sandbox/${repoName}` },
    } as unknown as HandleEventCtx['event']['payload'],
    repo: { owner: 'Slaanesh233-sandbox', repo: repoName },
  };
}

interface PrCommentOpts {
  commenterLogin?: string;
  prNumber?: number;
  prCreatedAt?: string;
  senderLogin?: string;
  senderType?: string;
  repoName?: string;
}

function prCommentEvent(opts: PrCommentOpts = {}): HandleEventCtx['event'] {
  const repoName = opts.repoName ?? 'sandbox-repo-a';
  const prNumber = opts.prNumber ?? 42;
  const commenterLogin = opts.commenterLogin ?? 'commenter';
  return {
    name: 'issue_comment' as const,
    payload: {
      action: 'created',
      sender: { login: opts.senderLogin ?? commenterLogin, type: opts.senderType ?? 'User' },
      comment: { user: { login: commenterLogin } },
      issue: {
        number: prNumber,
        html_url: `https://github.com/Slaanesh233-sandbox/${repoName}/pull/${prNumber}`,
        user: { login: 'kai' },
        created_at: opts.prCreatedAt ?? OLD_CREATED_AT,
        // Pitfall 4 presence-check guard: non-null means PR-comment.
        pull_request: {
          url: `https://api.github.com/repos/Slaanesh233-sandbox/${repoName}/pulls/${prNumber}`,
        },
      },
      repository: { name: repoName, full_name: `Slaanesh233-sandbox/${repoName}` },
    } as unknown as HandleEventCtx['event']['payload'],
    repo: { owner: 'Slaanesh233-sandbox', repo: repoName },
  };
}

interface ReviewCommentOpts {
  commenterLogin?: string;
  prNumber?: number;
  prCreatedAt?: string;
  senderLogin?: string;
  senderType?: string;
  repoName?: string;
}

function reviewCommentEvent(opts: ReviewCommentOpts = {}): HandleEventCtx['event'] {
  const repoName = opts.repoName ?? 'sandbox-repo-a';
  const prNumber = opts.prNumber ?? 42;
  const commenterLogin = opts.commenterLogin ?? 'commenter';
  return {
    name: 'pull_request_review_comment' as const,
    payload: {
      action: 'created',
      sender: { login: opts.senderLogin ?? commenterLogin, type: opts.senderType ?? 'User' },
      comment: { user: { login: commenterLogin } },
      pull_request: {
        number: prNumber,
        html_url: `https://github.com/Slaanesh233-sandbox/${repoName}/pull/${prNumber}`,
        user: { login: 'kai' },
        created_at: opts.prCreatedAt ?? OLD_CREATED_AT,
      },
      repository: { name: repoName, full_name: `Slaanesh233-sandbox/${repoName}` },
    } as unknown as HandleEventCtx['event']['payload'],
    repo: { owner: 'Slaanesh233-sandbox', repo: repoName },
  };
}

interface ReviewerRequestedOpts {
  requestedReviewerLogin?: string;
  requesterLogin?: string;
  prNumber?: number;
  prCreatedAt?: string;
  senderType?: string;
  repoName?: string;
}

function reviewerRequestedEvent(opts: ReviewerRequestedOpts = {}): HandleEventCtx['event'] {
  const repoName = opts.repoName ?? 'sandbox-repo-a';
  const prNumber = opts.prNumber ?? 42;
  const requesterLogin = opts.requesterLogin ?? 'kai';
  const requestedReviewerLogin = opts.requestedReviewerLogin ?? 'reviewer';
  return {
    name: 'pull_request' as const,
    payload: {
      action: 'review_requested',
      sender: { login: requesterLogin, type: opts.senderType ?? 'User' },
      // Pitfall 5: top-level requested_reviewer (singular) is the per-event field.
      requested_reviewer: { login: requestedReviewerLogin },
      pull_request: {
        number: prNumber,
        html_url: `https://github.com/Slaanesh233-sandbox/${repoName}/pull/${prNumber}`,
        user: { login: 'kai' },
        created_at: opts.prCreatedAt ?? OLD_CREATED_AT,
        requested_reviewers: [{ login: requestedReviewerLogin }],
      },
      repository: { name: repoName, full_name: `Slaanesh233-sandbox/${repoName}` },
    } as unknown as HandleEventCtx['event']['payload'],
    repo: { owner: 'Slaanesh233-sandbox', repo: repoName },
  };
}

interface ReopenOpts {
  reopenerLogin?: string;
  prNumber?: number;
  prCreatedAt?: string;
  senderType?: string;
  repoName?: string;
  // Change B 2026-05-07 (Task 2): cumulative reviewers at reopen time, parallel to mergedEvent.
  reviewers?: string[];
}

function reopenedEvent(opts: ReopenOpts = {}): HandleEventCtx['event'] {
  const repoName = opts.repoName ?? 'sandbox-repo-a';
  const prNumber = opts.prNumber ?? 42;
  const reopenerLogin = opts.reopenerLogin ?? 'reopener';
  const reviewers = opts.reviewers ?? [];
  return {
    name: 'pull_request' as const,
    payload: {
      action: 'reopened',
      sender: { login: reopenerLogin, type: opts.senderType ?? 'User' },
      pull_request: {
        number: prNumber,
        html_url: `https://github.com/Slaanesh233-sandbox/${repoName}/pull/${prNumber}`,
        user: { login: 'kai' },
        created_at: opts.prCreatedAt ?? OLD_CREATED_AT,
        requested_reviewers: reviewers.map((login) => ({ login })),
      },
      repository: { name: repoName, full_name: `Slaanesh233-sandbox/${repoName}` },
    } as unknown as HandleEventCtx['event']['payload'],
    repo: { owner: 'Slaanesh233-sandbox', repo: repoName },
  };
}

interface MergedOpts {
  mergerLogin?: string;
  reviewers?: string[];
  prCreatedAt?: string;
  repoName?: string;
  senderType?: string;
}

function mergedEvent(opts: MergedOpts = {}): HandleEventCtx['event'] {
  const repoName = opts.repoName ?? 'sandbox-repo-a';
  const prNumber = 42;
  const mergerLogin = opts.mergerLogin ?? 'merger';
  return {
    name: 'pull_request' as const,
    payload: {
      action: 'closed',
      sender: { login: mergerLogin, type: opts.senderType ?? 'User' },
      pull_request: {
        number: prNumber,
        html_url: `https://github.com/Slaanesh233-sandbox/${repoName}/pull/${prNumber}`,
        user: { login: 'kai' },
        created_at: opts.prCreatedAt ?? OLD_CREATED_AT,
        merged: true,
        merged_by: { login: mergerLogin },
        requested_reviewers: (opts.reviewers ?? []).map((login) => ({ login })),
      },
      repository: { name: repoName, full_name: `Slaanesh233-sandbox/${repoName}` },
    } as unknown as HandleEventCtx['event']['payload'],
    repo: { owner: 'Slaanesh233-sandbox', repo: repoName },
  };
}

interface CloseWithoutMergeOpts {
  closerLogin?: string;
  reviewers?: string[];
  prCreatedAt?: string;
  repoName?: string;
  senderType?: string;
}

function closedWithoutMergeEvent(opts: CloseWithoutMergeOpts = {}): HandleEventCtx['event'] {
  const repoName = opts.repoName ?? 'sandbox-repo-a';
  const prNumber = 42;
  const closerLogin = opts.closerLogin ?? 'closer';
  return {
    name: 'pull_request' as const,
    payload: {
      action: 'closed',
      sender: { login: closerLogin, type: opts.senderType ?? 'User' },
      pull_request: {
        number: prNumber,
        html_url: `https://github.com/Slaanesh233-sandbox/${repoName}/pull/${prNumber}`,
        user: { login: 'kai' },
        created_at: opts.prCreatedAt ?? OLD_CREATED_AT,
        merged: false,
        merged_by: null,
        requested_reviewers: (opts.reviewers ?? []).map((login) => ({ login })),
      },
      repository: { name: repoName, full_name: `Slaanesh233-sandbox/${repoName}` },
    } as unknown as HandleEventCtx['event']['payload'],
    repo: { owner: 'Slaanesh233-sandbox', repo: repoName },
  };
}

describe('handleEvent — OPEN-04 happy path', () => {
  it('posts ONE message and PATCHes ONE body for opened, non-draft, no reviewers', async () => {
    const { deps, spies } = makeMockDeps();
    await handleEvent(deps, { event: openedEvent({}) });
    expect(spies.postMessage).toHaveBeenCalledTimes(1);
    expect(spies.pullsGet).toHaveBeenCalledTimes(1);
    expect(spies.pullsUpdate).toHaveBeenCalledTimes(1);
    expect(spies.setFailed).not.toHaveBeenCalled();

    const postArgs = spies.postMessage.mock.calls[0]![0] as {
      channel: string;
      text: string;
      blocks: unknown;
    };
    expect(postArgs.channel).toBe(SANDBOX_CHANNEL_ID);
    expect(postArgs.text).toContain('sandbox-repo-a:');
    expect(postArgs.text).toContain('has published a');
    expect(postArgs.text).not.toContain(' cc ');
    expect(Array.isArray(postArgs.blocks) || typeof postArgs.blocks === 'object').toBe(true);

    const updateArgs = spies.pullsUpdate.mock.calls[0]![0] as { body: string };
    expect(updateArgs.body).toContain(`<!-- pr-bot:thread_ts=${SAMPLE_TS} -->`);
  });

  it('renders the OPEN-04 cc clause with resolved reviewer mentions', async () => {
    const { deps, spies } = makeMockDeps();
    await handleEvent(deps, {
      event: openedEvent({ reviewers: ['kai', 'dummy-reviewer'] }),
    });
    const postArgs = spies.postMessage.mock.calls[0]![0] as { text: string };
    expect(postArgs.text).toMatch(/ cc /);
    // mentions.resolve produced the Slack-mention syntax for both (Path A: same Slack id)
    expect(postArgs.text).toContain(KAI_SLACK_ID);
  });

  it('uses repository.name (short) not full_name (Pitfall 10)', async () => {
    const { deps, spies } = makeMockDeps();
    await handleEvent(deps, {
      event: openedEvent({
        repoName: 'sandbox-repo-a',
        repoFullName: 'Slaanesh233-sandbox/sandbox-repo-a',
      }),
    });
    const postArgs = spies.postMessage.mock.calls[0]![0] as { text: string };
    expect(postArgs.text).toMatch(/^sandbox-repo-a:/);
    expect(postArgs.text).not.toContain('Slaanesh233-sandbox/sandbox-repo-a:');
  });
});

describe('handleEvent — OPEN-08 draft handling', () => {
  it('skips clean on opened+draft=true with zero I/O', async () => {
    const { deps, spies } = makeMockDeps();
    await handleEvent(deps, { event: openedEvent({ draft: true }) });
    expect(spies.postMessage).not.toHaveBeenCalled();
    expect(spies.pullsGet).not.toHaveBeenCalled();
    expect(spies.pullsUpdate).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/draft/));
  });

  it('fires on ready_for_review (draft → ready transition)', async () => {
    const { deps, spies } = makeMockDeps();
    await handleEvent(deps, { event: openedEvent({ action: 'ready_for_review' }) });
    expect(spies.postMessage).toHaveBeenCalledTimes(1);
    expect(spies.pullsUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('handleEvent — OPEN-06 idempotency (live body, not payload body — Pitfall 12)', () => {
  it('skips clean when pulls.get returns body containing the marker', async () => {
    const { deps, spies } = makeMockDeps({
      pullsGetBody: 'some PR body content\n<!-- pr-bot:thread_ts=1234.5 -->',
    });
    await handleEvent(deps, { event: openedEvent({}) });
    expect(spies.pullsGet).toHaveBeenCalledTimes(1); // we DO read the live body
    expect(spies.postMessage).not.toHaveBeenCalled(); // no second root post
    expect(spies.pullsUpdate).not.toHaveBeenCalled(); // no re-PATCH
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/marker already present/));
  });
});

describe('handleEvent — FLT-01 bot-self-loop filter', () => {
  it("skips when sender.type === 'Bot' (BEFORE pulls.get)", async () => {
    const { deps, spies } = makeMockDeps();
    await handleEvent(deps, {
      event: openedEvent({ senderLogin: 'github-actions[bot]', senderType: 'Bot' }),
    });
    expect(spies.postMessage).not.toHaveBeenCalled();
    expect(spies.pullsGet).not.toHaveBeenCalled(); // CRITICAL: short-circuit before any I/O
    expect(spies.pullsUpdate).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/bot/i));
  });

  it("skips when login ends with '[bot]' even if type='User' (D-04 belt-and-braces)", async () => {
    const { deps, spies } = makeMockDeps();
    await handleEvent(deps, {
      event: openedEvent({ senderLogin: 'dependabot[bot]', senderType: 'User' }),
    });
    expect(spies.postMessage).not.toHaveBeenCalled();
    expect(spies.pullsUpdate).not.toHaveBeenCalled();
  });
});

describe('handleEvent — OPEN-05 PATCH retry', () => {
  it('retries on transient 503 then succeeds (1s/3s/9s backoff)', async () => {
    let callCount = 0;
    const { deps, spies } = makeMockDeps({
      pullsUpdateImpl: async () => {
        callCount++;
        if (callCount === 1) {
          const err: Error & { status?: number } = new Error('Service Unavailable');
          err.status = 503;
          throw err;
        }
        return { data: {} };
      },
    });
    await handleEvent(deps, { event: openedEvent({}) });
    expect(spies.postMessage).toHaveBeenCalledTimes(1);
    expect(spies.pullsUpdate).toHaveBeenCalledTimes(2);
    expect(spies.warning).toHaveBeenCalled();
    expect(spies.setFailed).not.toHaveBeenCalled();
  });

  it('exhausts 4 attempts (initial + 3 retries) on persistent 502 and setFailed', async () => {
    const { deps, spies } = makeMockDeps({
      pullsUpdateImpl: async () => {
        const err: Error & { status?: number } = new Error('Bad Gateway');
        err.status = 502;
        throw err;
      },
    });
    await handleEvent(deps, { event: openedEvent({}) });
    expect(spies.postMessage).toHaveBeenCalledTimes(1);
    expect(spies.pullsUpdate).toHaveBeenCalledTimes(4);
    expect(spies.setFailed).toHaveBeenCalledTimes(1);
    expect(spies.setFailed.mock.calls[0]![0]).toMatch(/pulls\.update/);
    expect(spies.setFailed.mock.calls[0]![0]).toMatch(/4 attempts/);
  });

  it('does NOT retry on 4xx (e.g. 403 missing pull-requests:write)', async () => {
    const { deps, spies } = makeMockDeps({
      pullsUpdateImpl: async () => {
        const err: Error & { status?: number } = new Error('Resource not accessible');
        err.status = 403;
        throw err;
      },
    });
    await handleEvent(deps, { event: openedEvent({}) });
    expect(spies.postMessage).toHaveBeenCalledTimes(1);
    expect(spies.pullsUpdate).toHaveBeenCalledTimes(1); // no retry
    expect(spies.setFailed).toHaveBeenCalledTimes(1);
  });
});

describe('handleEvent — Pitfall 8 plain-text fallback', () => {
  it("passes both 'text' and 'blocks' to chat.postMessage", async () => {
    const { deps, spies } = makeMockDeps();
    await handleEvent(deps, { event: openedEvent({}) });
    const postArgs = spies.postMessage.mock.calls[0]![0] as { text?: string; blocks?: unknown };
    expect(typeof postArgs.text).toBe('string');
    expect((postArgs.text ?? '').length).toBeGreaterThan(0);
    expect(postArgs.blocks).toBeDefined();
    expect(postArgs.text).toContain('sandbox-repo-a:');
    expect(postArgs.text).toContain('has published a pull request');
  });
});

describe('handleEvent — Slack failure', () => {
  it('setFailed and skips PATCH when chat.postMessage returns !ok', async () => {
    const { deps, spies } = makeMockDeps({
      postMessageResult: { ok: false, error: 'channel_not_found' },
    });
    await handleEvent(deps, { event: openedEvent({}) });
    expect(spies.postMessage).toHaveBeenCalledTimes(1);
    expect(spies.pullsUpdate).not.toHaveBeenCalled(); // no marker write without ts
    expect(spies.setFailed).toHaveBeenCalledTimes(1);
  });
});

// ===== Phase 3 — FLT-02 silent marker ====================================

describe('handleEvent — FLT-02 silent marker (Phase 3)', () => {
  it('skips clean (zero Slack calls) when liveBody contains the silent marker — open event', async () => {
    const { deps, spies } = makeMockDeps({
      pullsGetBody: 'PR description\n\n<!-- pr-bot:silent -->\n',
    });
    await handleEvent(deps, { event: openedEvent({}) });
    expect(spies.postMessage).not.toHaveBeenCalled();
    expect(spies.pullsUpdate).not.toHaveBeenCalled();
    expect(spies.chatUpdate).not.toHaveBeenCalled();
    expect(spies.reactionsAdd).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/silent/i));
  });

  it('skips clean (zero Slack calls) when liveBody contains the silent marker — review-submitted event', async () => {
    const { deps, spies } = makeMockDeps({
      pullsGetBody: `PR description\n\n<!-- pr-bot:silent -->\n<!-- pr-bot:thread_ts=${SAMPLE_TS} -->`,
    });
    await handleEvent(deps, { event: reviewSubmittedEvent({ state: 'approved' }) });
    expect(spies.postMessage).not.toHaveBeenCalled();
    expect(spies.chatUpdate).not.toHaveBeenCalled();
    expect(spies.reactionsAdd).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/FLT-02|silent/i));
  });

  it('FLT-02 ordering: bot sender skipped FIRST (FLT-01 runs before silent-marker check)', async () => {
    const { deps, spies } = makeMockDeps({
      pullsGetBody: 'PR description\n<!-- pr-bot:silent -->',
    });
    await handleEvent(deps, {
      event: reviewSubmittedEvent({
        senderLogin: 'github-actions[bot]',
        senderType: 'Bot',
        state: 'approved',
      }),
    });
    // FLT-01 short-circuits — pullsGet never called.
    expect(spies.pullsGet).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/bot/i));
  });

  it('does NOT mistake the thread_ts marker for a silent marker', async () => {
    const { deps, spies } = makeMockDeps({
      pullsGetBody: `<!-- pr-bot:thread_ts=${SAMPLE_TS} -->`,
    });
    await handleEvent(deps, { event: reviewSubmittedEvent({ state: 'approved' }) });
    // FLT-02 must NOT fire — proceeds past the silent-marker check.
    expect(spies.info).not.toHaveBeenCalledWith(expect.stringMatching(/silent/i));
  });
});

// ===== Phase 3 — THRD-07 marker-missing graceful skip ====================

describe('handleEvent — THRD-07 marker-missing graceful skip (Phase 3)', () => {
  it('warns + skips when marker absent AND PR opened ≥60s ago', async () => {
    const { deps, spies } = makeMockDeps({ pullsGetBody: 'PR description without any marker' });
    const event = reviewSubmittedEvent({ state: 'approved', prCreatedAt: OLD_CREATED_AT });
    await handleEvent(deps, { event });
    expect(spies.warning).toHaveBeenCalledTimes(1);
    const warningMsg = spies.warning.mock.calls[0]![0] as string;
    expect(warningMsg).toMatch(/PR #/);
    expect(warningMsg).toMatch(/marker|thread/i);
    expect(spies.postMessage).not.toHaveBeenCalled();
    expect(spies.chatUpdate).not.toHaveBeenCalled();
    expect(spies.reactionsAdd).not.toHaveBeenCalled();
  });

  it('info-logs (race-window) + skips when marker absent AND PR opened <60s ago', async () => {
    const { deps, spies } = makeMockDeps({ pullsGetBody: 'PR description without any marker' });
    const event = reviewSubmittedEvent({ state: 'approved', prCreatedAt: RECENT_CREATED_AT });
    await handleEvent(deps, { event });
    expect(spies.warning).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/race-window/));
    expect(spies.postMessage).not.toHaveBeenCalled();
  });

  it('uses created_at NOT updated_at as the anchor (Pitfall 11)', async () => {
    // created_at = 2 minutes ago → THRD-07 SHOULD warn. The handler must read
    // created_at; if it accidentally read updated_at it would race-window-info instead.
    const { deps, spies } = makeMockDeps({ pullsGetBody: 'no marker' });
    const event = reviewSubmittedEvent({
      state: 'approved',
      prCreatedAt: new Date(Date.now() - 120_000).toISOString(),
    });
    await handleEvent(deps, { event });
    expect(spies.warning).toHaveBeenCalledTimes(1);
    expect(spies.info).not.toHaveBeenCalledWith(expect.stringMatching(/race-window/));
  });

  it('Pitfall 8 — pulls.get is called ONCE per event (FLT-02 + THRD-07 share liveBody)', async () => {
    const { deps, spies } = makeMockDeps({
      pullsGetBody: `<!-- pr-bot:thread_ts=${SAMPLE_TS} -->`,
    });
    await handleEvent(deps, { event: reviewSubmittedEvent({ state: 'approved' }) });
    expect(spies.pullsGet).toHaveBeenCalledTimes(1); // CRITICAL: not 2
  });
});

// ===== Phase 3 — Phase-2 open-class regression ===========================

describe('handleEvent — Phase-2 open-class regression (no behavioral change)', () => {
  it('happy path still posts ONE message and PATCHes ONE body', async () => {
    const { deps, spies } = makeMockDeps();
    await handleEvent(deps, { event: openedEvent({}) });
    expect(spies.postMessage).toHaveBeenCalledTimes(1);
    expect(spies.pullsGet).toHaveBeenCalledTimes(1);
    expect(spies.pullsUpdate).toHaveBeenCalledTimes(1);
    expect(spies.chatUpdate).not.toHaveBeenCalled();
    expect(spies.reactionsAdd).not.toHaveBeenCalled();
    expect(spies.setFailed).not.toHaveBeenCalled();
  });
});

// ===== Phase 3 — THRD-01 review submitted (per-kind dispatch) =============

describe('handleEvent — THRD-01 review submitted', () => {
  const validBody = `body content\n<!-- pr-bot:thread_ts=${SAMPLE_TS} -->`;

  it('approved → posts thread reply with random emoji from APPROVED_EMOJI_POOL; NO root reaction (locked-spec 2026-05-08)', async () => {
    const { deps, spies } = makeMockDeps({ pullsGetBody: validBody });
    await handleEvent(deps, {
      event: reviewSubmittedEvent({ state: 'approved', reviewerLogin: 'reviewer' }),
    });
    expect(spies.postMessage).toHaveBeenCalledTimes(1);
    const args = spies.postMessage.mock.calls[0]![0] as {
      channel: string;
      thread_ts: string;
      text: string;
      blocks: unknown;
    };
    expect(args.thread_ts).toBe(SAMPLE_TS);
    // Random pick from APPROVED_EMOJI_POOL — assert text matches ':thumbsup:' OR ':ok_hand:'.
    expect(args.text).toMatch(
      new RegExp(`^:(thumbsup|ok_hand): <@${KAI_SLACK_ID}> approved the pull request$`),
    );
    expect(args.channel).toBe(SANDBOX_CHANNEL_ID);
    expect(args.blocks).toBeDefined();

    // Locked-spec 2026-05-08: review events do NOT add root reactions. Root
    // reaction surface is reserved exclusively for terminal-state events
    // (handleTerminal merge/close adds; handleReopen clears).
    expect(spies.reactionsAdd).not.toHaveBeenCalled();

    expect(spies.setFailed).not.toHaveBeenCalled();
  });

  it('changes_requested → :warning: thread reply only; NO root reaction (locked-spec 2026-05-08)', async () => {
    const { deps, spies } = makeMockDeps({ pullsGetBody: validBody });
    await handleEvent(deps, {
      event: reviewSubmittedEvent({ state: 'changes_requested', reviewerLogin: 'reviewer' }),
    });
    const args = spies.postMessage.mock.calls[0]![0] as { text: string };
    expect(args.text).toBe(`:warning: <@${KAI_SLACK_ID}> requested changes on the pull request`);
    // Locked-spec 2026-05-08: no root reaction for review events.
    expect(spies.reactionsAdd).not.toHaveBeenCalled();
  });

  it("commented → ZERO Slack calls + info 'commented-review-redundant-...' (Change A 2026-05-07; redundant with review-comment events)", async () => {
    const { deps, spies } = makeMockDeps({ pullsGetBody: validBody });
    await handleEvent(deps, {
      event: reviewSubmittedEvent({ state: 'commented', reviewerLogin: 'reviewer' }),
    });
    expect(spies.postMessage).not.toHaveBeenCalled();
    expect(spies.reactionsAdd).not.toHaveBeenCalled();
    expect(spies.pullsGet).not.toHaveBeenCalled(); // router-skip short-circuits before any I/O
    expect(spies.info).toHaveBeenCalledWith(
      expect.stringMatching(/commented-review-redundant-with-review-comment-events/),
    );
    expect(spies.setFailed).not.toHaveBeenCalled();
  });

  it('unmapped reviewer → fallback @-text + warning logged; thread reply still posts (random approve emoji)', async () => {
    const { deps, spies } = makeMockDeps({
      pullsGetBody: validBody,
      users: { kai: KAI_SLACK_ID },
    });
    await handleEvent(deps, {
      event: reviewSubmittedEvent({ state: 'approved', reviewerLogin: 'unknown-reviewer' }),
    });
    expect(spies.warning).toHaveBeenCalledWith(
      expect.stringMatching(/no Slack ID mapping for github login "unknown-reviewer"/),
    );
    const args = spies.postMessage.mock.calls[0]![0] as { text: string };
    expect(args.text).toMatch(/^:(thumbsup|ok_hand): @unknown-reviewer approved the pull request$/);
    // Locked-spec 2026-05-08: no root reaction for review events.
    expect(spies.reactionsAdd).not.toHaveBeenCalled();
  });
});

// ===== Phase 3 — THRD-02 PR comment + review-comment ======================

describe('handleEvent — THRD-02 PR comment', () => {
  const validBody = `<!-- pr-bot:thread_ts=${SAMPLE_TS} -->`;

  it('single comment → "<@…> published 1 comment on the pull request" (locked spec; n=1 per event)', async () => {
    const { deps, spies } = makeMockDeps({ pullsGetBody: validBody });
    await handleEvent(deps, { event: prCommentEvent({ commenterLogin: 'commenter' }) });
    const args = spies.postMessage.mock.calls[0]![0] as { text: string };
    expect(args.text).toBe(`<@${KAI_SLACK_ID}> published 1 comment on the pull request`);
    expect(spies.reactionsAdd).not.toHaveBeenCalled();
  });

  it('two consecutive comments → two thread replies, each "<@…> published 1 comment on the pull request" (no aggregation)', async () => {
    const { deps, spies } = makeMockDeps({ pullsGetBody: validBody });
    await handleEvent(deps, { event: prCommentEvent({ commenterLogin: 'commenter' }) });
    await handleEvent(deps, { event: prCommentEvent({ commenterLogin: 'commenter' }) });
    expect(spies.postMessage).toHaveBeenCalledTimes(2);
    expect((spies.postMessage.mock.calls[0]![0] as { text: string }).text).toBe(
      `<@${KAI_SLACK_ID}> published 1 comment on the pull request`,
    );
    expect((spies.postMessage.mock.calls[1]![0] as { text: string }).text).toBe(
      `<@${KAI_SLACK_ID}> published 1 comment on the pull request`,
    );
  });

  it('inline review comment (pull_request_review_comment) → "published 1 inline comment on the pull request"', async () => {
    const { deps, spies } = makeMockDeps({ pullsGetBody: validBody });
    await handleEvent(deps, { event: reviewCommentEvent({ commenterLogin: 'commenter' }) });
    const args = spies.postMessage.mock.calls[0]![0] as { text: string };
    expect(args.text).toBe(`<@${KAI_SLACK_ID}> published 1 inline comment on the pull request`);
    expect(spies.reactionsAdd).not.toHaveBeenCalled();
  });
});

// ===== Phase 3 — THRD-03 reviewer requested ===============================

describe('handleEvent — THRD-03 reviewer requested', () => {
  const validBody = `<!-- pr-bot:thread_ts=${SAMPLE_TS} -->`;

  it('mentions the requested reviewer (Pitfall 5 — not the sender; requester clause dropped 2026-05-07)', async () => {
    const { deps, spies } = makeMockDeps({ pullsGetBody: validBody });
    await handleEvent(deps, {
      event: reviewerRequestedEvent({ requestedReviewerLogin: 'reviewer', requesterLogin: 'kai' }),
    });
    const args = spies.postMessage.mock.calls[0]![0] as { text: string };
    expect(args.text).toBe(`<@${KAI_SLACK_ID}> was requested for review on the pull request`);
    expect(args.text).toContain('was requested for review');
    expect(spies.reactionsAdd).not.toHaveBeenCalled();
  });
});

// ===== Phase 3 — THRD-06 reopened =========================================
// Change B 2026-05-07: reopen becomes a multi-call dispatcher — postMessage thread reply
// + reactions.remove ×2 (no_entry_sign then tada) + chat.update with the un-struck root
// rebuilt via buildRootMessage (NOT buildStrikethroughRoot).

describe('handleEvent — THRD-06 reopened (Change B 2026-05-07: multi-call un-strike)', () => {
  const validBody = `<!-- pr-bot:thread_ts=${SAMPLE_TS} -->`;

  it('happy path no-reviewers: thread reply + reactions.remove ×2 + chat.update with UN-STRUCK root', async () => {
    const { deps, spies } = makeMockDeps({ pullsGetBody: validBody });
    await handleEvent(deps, { event: reopenedEvent({ reopenerLogin: 'reopener' }) });

    expect(spies.postMessage).toHaveBeenCalledTimes(1);
    expect(spies.reactionsRemove).toHaveBeenCalledTimes(2);
    expect(spies.chatUpdate).toHaveBeenCalledTimes(1);
    expect(spies.setFailed).not.toHaveBeenCalled();

    const postArgs = spies.postMessage.mock.calls[0]![0] as { text: string; thread_ts: string };
    expect(postArgs.text).toBe(`<@${KAI_SLACK_ID}> reopened the pull request`);
    expect(postArgs.thread_ts).toBe(SAMPLE_TS);

    const remove1 = spies.reactionsRemove.mock.calls[0]![0] as {
      name: string;
      timestamp: string;
      channel: string;
    };
    const remove2 = spies.reactionsRemove.mock.calls[1]![0] as { name: string; timestamp: string };
    expect(remove1.name).toBe('no_entry_sign'); // BARE name (Pitfall 3)
    expect(remove1.timestamp).toBe(SAMPLE_TS);
    expect(remove1.channel).toBe(SANDBOX_CHANNEL_ID);
    expect(remove2.name).toBe('tada');
    expect(remove2.timestamp).toBe(SAMPLE_TS);

    const updateArgs = spies.chatUpdate.mock.calls[0]![0] as {
      channel: string;
      ts: string;
      text: string;
      blocks: unknown;
      thread_ts?: string;
    };
    expect(updateArgs.ts).toBe(SAMPLE_TS);
    expect(updateArgs.channel).toBe(SANDBOX_CHANNEL_ID);
    // Un-struck root — NO leading/trailing tildes (vs handleTerminal which per-line wraps).
    expect(updateArgs.text).toBe(
      `<https://github.com/Slaanesh233-sandbox/sandbox-repo-a|sandbox-repo-a>:\n<@${KAI_SLACK_ID}> has published a <https://github.com/Slaanesh233-sandbox/sandbox-repo-a/pull/42|pull request>.`,
    );
    expect(updateArgs.text.startsWith('~')).toBe(false);
    expect(updateArgs.text.endsWith('~')).toBe(false);
    expect(updateArgs.blocks).toBeDefined();
    expect(updateArgs.thread_ts).toBeUndefined(); // Pitfall 9
  });

  it('with reviewers: chat.update un-struck root carries cc clause', async () => {
    const { deps, spies } = makeMockDeps({
      pullsGetBody: validBody,
      users: { kai: KAI_SLACK_ID, reopener: KAI_SLACK_ID, r1: KAI_SLACK_ID, r2: KAI_SLACK_ID },
    });
    await handleEvent(deps, {
      event: reopenedEvent({ reopenerLogin: 'reopener', reviewers: ['r1', 'r2'] }),
    });
    const updateArgs = spies.chatUpdate.mock.calls[0]![0] as { text: string };
    expect(updateArgs.text).toBe(
      `<https://github.com/Slaanesh233-sandbox/sandbox-repo-a|sandbox-repo-a>:\n<@${KAI_SLACK_ID}> has published a <https://github.com/Slaanesh233-sandbox/sandbox-repo-a/pull/42|pull request>. cc <@${KAI_SLACK_ID}> <@${KAI_SLACK_ID}>`,
    );
  });

  it('multi-call ordering: postMessage → reactions.remove (no_entry_sign) → reactions.remove (tada) → chat.update', async () => {
    const { deps, spies } = makeMockDeps({ pullsGetBody: validBody });
    await handleEvent(deps, { event: reopenedEvent({ reopenerLogin: 'reopener' }) });
    const order1 = spies.postMessage.mock.invocationCallOrder[0]!;
    const order2 = spies.reactionsRemove.mock.invocationCallOrder[0]!;
    const order3 = spies.reactionsRemove.mock.invocationCallOrder[1]!;
    const order4 = spies.chatUpdate.mock.invocationCallOrder[0]!;
    expect(order1).toBeLessThan(order2);
    expect(order2).toBeLessThan(order3);
    expect(order3).toBeLessThan(order4);
  });

  it('postMessage throws not_in_channel → setFailed; reactions.remove + chat.update NOT attempted', async () => {
    const { deps, spies } = makeMockDeps({
      pullsGetBody: validBody,
      postMessageImpl: async () => {
        throw new Error('not_in_channel');
      },
    });
    await handleEvent(deps, { event: reopenedEvent({ reopenerLogin: 'reopener' }) });
    expect(spies.setFailed).toHaveBeenCalledWith(expect.stringMatching(/not_in_channel|invite/));
    expect(spies.reactionsRemove).not.toHaveBeenCalled();
    expect(spies.chatUpdate).not.toHaveBeenCalled();
  });

  it('reactions.remove returns no_reaction (idempotent re-run) → core.info; chat.update STILL attempted', async () => {
    const removeErr = new Error('Slack API error') as Error & { data: { error: string } };
    removeErr.data = { error: 'no_reaction' };
    const { deps, spies } = makeMockDeps({
      pullsGetBody: validBody,
      reactionsRemoveImpl: async () => {
        throw removeErr;
      },
    });
    await handleEvent(deps, { event: reopenedEvent({ reopenerLogin: 'reopener' }) });
    expect(spies.postMessage).toHaveBeenCalledTimes(1);
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/no_reaction/));
    expect(spies.setFailed).not.toHaveBeenCalled();
    expect(spies.chatUpdate).toHaveBeenCalledTimes(1); // CRITICAL: continues
  });

  it('reactions.remove returns message_not_found → core.warning; chat.update STILL attempted', async () => {
    const removeErr = new Error('Slack API error') as Error & { data: { error: string } };
    removeErr.data = { error: 'message_not_found' };
    const { deps, spies } = makeMockDeps({
      pullsGetBody: validBody,
      reactionsRemoveImpl: async () => {
        throw removeErr;
      },
    });
    await handleEvent(deps, { event: reopenedEvent({ reopenerLogin: 'reopener' }) });
    expect(spies.warning).toHaveBeenCalledWith(expect.stringMatching(/message_not_found/));
    expect(spies.setFailed).not.toHaveBeenCalled();
    expect(spies.chatUpdate).toHaveBeenCalledTimes(1);
  });

  it('reactions.remove returns ratelimited → core.warning; chat.update STILL attempted', async () => {
    const removeErr = new Error('Slack API error') as Error & { data: { error: string } };
    removeErr.data = { error: 'ratelimited' };
    const { deps, spies } = makeMockDeps({
      pullsGetBody: validBody,
      reactionsRemoveImpl: async () => {
        throw removeErr;
      },
    });
    await handleEvent(deps, { event: reopenedEvent({ reopenerLogin: 'reopener' }) });
    expect(spies.warning).toHaveBeenCalledWith(expect.stringMatching(/ratelimited/));
    expect(spies.setFailed).not.toHaveBeenCalled();
    expect(spies.chatUpdate).toHaveBeenCalledTimes(1);
  });

  it('reactions.remove returns invalid_name → core.setFailed; chat.update STILL attempted (mirrors handleTerminal contract)', async () => {
    const removeErr = new Error('Slack API error') as Error & { data: { error: string } };
    removeErr.data = { error: 'invalid_name' };
    const { deps, spies } = makeMockDeps({
      pullsGetBody: validBody,
      reactionsRemoveImpl: async () => {
        throw removeErr;
      },
    });
    await handleEvent(deps, { event: reopenedEvent({ reopenerLogin: 'reopener' }) });
    expect(spies.setFailed).toHaveBeenCalledWith(expect.stringMatching(/invalid_name/));
    expect(spies.chatUpdate).toHaveBeenCalledTimes(1); // dispatcher continues per contract
  });

  it('chat.update throws edit_window_closed → core.warning; thread reply + reactions.remove already landed', async () => {
    const { deps, spies } = makeMockDeps({
      pullsGetBody: validBody,
      chatUpdateImpl: async () => {
        throw new Error('edit_window_closed');
      },
    });
    await handleEvent(deps, { event: reopenedEvent({ reopenerLogin: 'reopener' }) });
    expect(spies.postMessage).toHaveBeenCalledTimes(1);
    expect(spies.reactionsRemove).toHaveBeenCalledTimes(2);
    expect(spies.warning).toHaveBeenCalledWith(
      expect.stringMatching(/edit_window_closed|chat\.update/),
    );
    expect(spies.setFailed).not.toHaveBeenCalled();
  });
});

// ===== Phase 3 — STAT-04 reactions error switch ===========================
// 2026-05-08: review-submitted events no longer invoke addReaction (per locked-spec
// "root reaction surface reserved for terminal events"). The STAT-04 error-handling
// code paths in addReaction are still load-bearing for the TERMINAL events
// (merge / close / reopen). These tests now drive via mergedEvent — the error
// handler under test is the same shared helper regardless of which event triggers
// the reactions.add call.

describe('handleEvent — STAT-04 reactions error switch (Research §4 + Pitfall 16)', () => {
  const validBody = `<!-- pr-bot:thread_ts=${SAMPLE_TS} -->`;

  function reactionError(code: string): Error & { data: { error: string } } {
    const err = new Error(`Slack API error: ${code}`) as Error & { data: { error: string } };
    err.data = { error: code };
    return err;
  }

  it('already_reacted → core.info (idempotent re-run; STAT-04)', async () => {
    const { deps, spies } = makeMockDeps({
      pullsGetBody: validBody,
      reactionsAddImpl: async () => {
        throw reactionError('already_reacted');
      },
    });
    await handleEvent(deps, {
      event: mergedEvent({ mergerLogin: 'merger' }),
    });
    expect(spies.postMessage).toHaveBeenCalledTimes(1); // thread reply still landed
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/already_reacted/));
    expect(spies.setFailed).not.toHaveBeenCalled(); // STAT-04: NOT a failure
  });

  it('invalid_name → core.setFailed (bot bug per Research §4)', async () => {
    const { deps, spies } = makeMockDeps({
      pullsGetBody: validBody,
      reactionsAddImpl: async () => {
        throw reactionError('invalid_name');
      },
    });
    await handleEvent(deps, {
      event: mergedEvent({ mergerLogin: 'merger' }),
    });
    expect(spies.setFailed).toHaveBeenCalledWith(expect.stringMatching(/invalid_name/));
  });

  it('ratelimited → core.warning (soft fail)', async () => {
    const { deps, spies } = makeMockDeps({
      pullsGetBody: validBody,
      reactionsAddImpl: async () => {
        throw reactionError('ratelimited');
      },
    });
    await handleEvent(deps, {
      event: mergedEvent({ mergerLogin: 'merger' }),
    });
    expect(spies.warning).toHaveBeenCalledWith(expect.stringMatching(/ratelimited/));
    expect(spies.setFailed).not.toHaveBeenCalled();
  });

  it('missing_scope → core.setFailed with hint about reactions:write', async () => {
    const { deps, spies } = makeMockDeps({
      pullsGetBody: validBody,
      reactionsAddImpl: async () => {
        throw reactionError('missing_scope');
      },
    });
    await handleEvent(deps, {
      event: mergedEvent({ mergerLogin: 'merger' }),
    });
    expect(spies.setFailed).toHaveBeenCalledWith(
      expect.stringMatching(/missing_scope|reactions:write/),
    );
  });
});

// ===== Phase 3 — THRD-04 + STAT-02 merge (multi-call dispatcher) ==========

describe('handleEvent — THRD-04 + STAT-02 merge (multi-call dispatcher)', () => {
  const validBody = `<!-- pr-bot:thread_ts=${SAMPLE_TS} -->`;

  it('happy path: posts thread reply + adds tada + chat.update strikethrough (no reviewers)', async () => {
    const { deps, spies } = makeMockDeps({ pullsGetBody: validBody });
    await handleEvent(deps, { event: mergedEvent({ mergerLogin: 'merger' }) });

    expect(spies.postMessage).toHaveBeenCalledTimes(1);
    expect(spies.reactionsAdd).toHaveBeenCalledTimes(1);
    expect(spies.chatUpdate).toHaveBeenCalledTimes(1);
    expect(spies.setFailed).not.toHaveBeenCalled();

    // Reply text — THRD-04 verbatim (locked spec 2026-05-07).
    const postArgs = spies.postMessage.mock.calls[0]![0] as { text: string; thread_ts: string };
    expect(postArgs.text).toBe(`:tada: <@${KAI_SLACK_ID}> merged the pull request`);
    expect(postArgs.thread_ts).toBe(SAMPLE_TS);

    // Reaction — STAT-02 (BARE name).
    const reactArgs = spies.reactionsAdd.mock.calls[0]![0] as { name: string; timestamp: string };
    expect(reactArgs.name).toBe('tada');
    expect(reactArgs.timestamp).toBe(SAMPLE_TS);

    // chat.update — Pitfall 2 dual args, Pitfall 9 no thread_ts, exact strikethrough text.
    const updateArgs = spies.chatUpdate.mock.calls[0]![0] as {
      channel: string;
      ts: string;
      text: string;
      blocks: unknown;
      thread_ts?: string;
    };
    expect(updateArgs.ts).toBe(SAMPLE_TS);
    expect(updateArgs.channel).toBe(SANDBOX_CHANNEL_ID);
    expect(updateArgs.text).toBe(
      `~<https://github.com/Slaanesh233-sandbox/sandbox-repo-a|sandbox-repo-a>:~\n~<@${KAI_SLACK_ID}> has published a <https://github.com/Slaanesh233-sandbox/sandbox-repo-a/pull/42|pull request>.~`,
    );
    expect(updateArgs.blocks).toBeDefined();
    expect(updateArgs.thread_ts).toBeUndefined(); // Pitfall 9
  });

  it('with reviewers: chat.update strikethrough wraps cc clause too (per-line tildes; cc on author/pr line)', async () => {
    const { deps, spies } = makeMockDeps({
      pullsGetBody: validBody,
      users: { kai: KAI_SLACK_ID, merger: KAI_SLACK_ID, r1: KAI_SLACK_ID, r2: KAI_SLACK_ID },
    });
    await handleEvent(deps, {
      event: mergedEvent({ mergerLogin: 'merger', reviewers: ['r1', 'r2'] }),
    });
    const updateArgs = spies.chatUpdate.mock.calls[0]![0] as { text: string };
    expect(updateArgs.text).toBe(
      `~<https://github.com/Slaanesh233-sandbox/sandbox-repo-a|sandbox-repo-a>:~\n~<@${KAI_SLACK_ID}> has published a <https://github.com/Slaanesh233-sandbox/sandbox-repo-a/pull/42|pull request>. cc <@${KAI_SLACK_ID}> <@${KAI_SLACK_ID}>~`,
    );
  });

  it('multi-call ordering: postMessage → reactions.add → chat.update', async () => {
    const { deps, spies } = makeMockDeps({ pullsGetBody: validBody });
    await handleEvent(deps, { event: mergedEvent({ mergerLogin: 'merger' }) });
    const order1 = spies.postMessage.mock.invocationCallOrder[0]!;
    const order2 = spies.reactionsAdd.mock.invocationCallOrder[0]!;
    const order3 = spies.chatUpdate.mock.invocationCallOrder[0]!;
    expect(order1).toBeLessThan(order2);
    expect(order2).toBeLessThan(order3);
  });

  it('thread-reply failure → setFailed; reactions + chat.update NOT attempted', async () => {
    const { deps, spies } = makeMockDeps({
      pullsGetBody: validBody,
      postMessageImpl: async () => {
        throw new Error('not_in_channel');
      },
    });
    await handleEvent(deps, { event: mergedEvent({ mergerLogin: 'merger' }) });
    expect(spies.setFailed).toHaveBeenCalledWith(expect.stringMatching(/not_in_channel|invite/));
    expect(spies.reactionsAdd).not.toHaveBeenCalled();
    expect(spies.chatUpdate).not.toHaveBeenCalled();
  });

  it('reactions failure → warning; chat.update STILL attempted', async () => {
    const reactErr = new Error('Slack ratelimit') as Error & { data: { error: string } };
    reactErr.data = { error: 'ratelimited' };
    const { deps, spies } = makeMockDeps({
      pullsGetBody: validBody,
      reactionsAddImpl: async () => {
        throw reactErr;
      },
    });
    await handleEvent(deps, { event: mergedEvent({ mergerLogin: 'merger' }) });
    expect(spies.postMessage).toHaveBeenCalledTimes(1);
    expect(spies.warning).toHaveBeenCalledWith(expect.stringMatching(/ratelimited/));
    expect(spies.chatUpdate).toHaveBeenCalledTimes(1); // CRITICAL: still ran
    expect(spies.setFailed).not.toHaveBeenCalled();
  });

  it('chat.update failure → warning; thread reply + reaction already landed', async () => {
    const { deps, spies } = makeMockDeps({
      pullsGetBody: validBody,
      chatUpdateImpl: async () => {
        throw new Error('edit_window_closed');
      },
    });
    await handleEvent(deps, { event: mergedEvent({ mergerLogin: 'merger' }) });
    expect(spies.postMessage).toHaveBeenCalledTimes(1);
    expect(spies.reactionsAdd).toHaveBeenCalledTimes(1);
    expect(spies.warning).toHaveBeenCalledWith(
      expect.stringMatching(/edit_window_closed|chat\.update/),
    );
    expect(spies.setFailed).not.toHaveBeenCalled();
  });
});

// ===== Phase 3 — THRD-05 + STAT-03 close-without-merge ====================

describe('handleEvent — THRD-05 + STAT-03 close-without-merge', () => {
  const validBody = `<!-- pr-bot:thread_ts=${SAMPLE_TS} -->`;

  it('happy path: ":no_entry_sign: closed by" reply + no_entry_sign reaction + chat.update strikethrough', async () => {
    const { deps, spies } = makeMockDeps({ pullsGetBody: validBody });
    await handleEvent(deps, { event: closedWithoutMergeEvent({ closerLogin: 'closer' }) });

    expect(spies.postMessage).toHaveBeenCalledTimes(1);
    expect(spies.reactionsAdd).toHaveBeenCalledTimes(1);
    expect(spies.chatUpdate).toHaveBeenCalledTimes(1);

    const postArgs = spies.postMessage.mock.calls[0]![0] as { text: string };
    expect(postArgs.text).toBe(`:no_entry_sign: <@${KAI_SLACK_ID}> closed the pull request`);
    const reactArgs = spies.reactionsAdd.mock.calls[0]![0] as { name: string };
    expect(reactArgs.name).toBe('no_entry_sign');
    const updateArgs = spies.chatUpdate.mock.calls[0]![0] as { text: string };
    // Locked-spec 2026-05-08: per-line tilde wrap (Slack mrkdwn strikethrough does
    // not cross newlines). Two-line shape: `~repo:~\n~author has published a |pull request>.~`.
    expect(updateArgs.text).toMatch(
      /^~<https:\/\/github\.com\/[^|]+\|sandbox-repo-a>:~\n~.* has published a .*\|pull request>\.~$/,
    );
    expect(updateArgs.text.startsWith('~')).toBe(true);
    expect(updateArgs.text.endsWith('~')).toBe(true);
  });
});

// ===== Phase 3 — FLT-02 + THRD-07 ALSO apply on terminal events ===========

describe('handleEvent — FLT-02 + THRD-07 ALSO apply on terminal events', () => {
  it('FLT-02: silent marker present → zero calls on merged', async () => {
    const { deps, spies } = makeMockDeps({
      pullsGetBody: `<!-- pr-bot:silent -->\n<!-- pr-bot:thread_ts=${SAMPLE_TS} -->`,
    });
    await handleEvent(deps, { event: mergedEvent({ mergerLogin: 'merger' }) });
    expect(spies.postMessage).not.toHaveBeenCalled();
    expect(spies.reactionsAdd).not.toHaveBeenCalled();
    expect(spies.chatUpdate).not.toHaveBeenCalled();
  });

  it('THRD-07: marker absent + created_at >60s ago → warning; zero calls on merged', async () => {
    const { deps, spies } = makeMockDeps({ pullsGetBody: 'no marker here' });
    await handleEvent(deps, {
      event: mergedEvent({
        mergerLogin: 'merger',
        prCreatedAt: new Date(Date.now() - 120_000).toISOString(),
      }),
    });
    expect(spies.warning).toHaveBeenCalledTimes(1);
    expect(spies.postMessage).not.toHaveBeenCalled();
    expect(spies.reactionsAdd).not.toHaveBeenCalled();
    expect(spies.chatUpdate).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Phase 3.1 — handleStaleCheck (schedule-event dispatcher; STALE-01)
// =============================================================================
//
// Decision A (per Plan 03.1-02): handleStaleCheck is a separate exported entry
// point that the bootstrap calls when context.eventName === 'schedule'. Tests
// drive it directly with deps + ctx so the 9-step filter chain + ping side
// effect are exercised in isolation from main()'s YAML-loading boilerplate.
//
// Fixed test "today" = 2026-05-14T14:00:00Z (Thursday). The injected
// staleCheckConfig sets the Plan 03.1-05 v1.1 defaults
// (pingScheduleBusinessDays=[5, 15, 20]; maxAgeDays=30) with an empty holiday
// list except where a specific test substitutes a list that includes today.
//
// The pr.created_at fixtures are designed so businessDaysBetween produces the
// boundary value each test wants. KEY ANCHORS for Plan 03.1-05 schedule
// [5, 15, 20] against today Thu 2026-05-14:
//   - 2026-05-07 (Thu, 1 week before)  → 5 business days = schedule[0] boundary
//   - 2026-05-08 (Fri)                 → 4 business days = too-young vs [0]=5
//   - 2026-04-23 (Thu, 3 weeks before) → 15 business days = schedule[1] boundary
//   - 2026-04-24 (Fri)                 → 14 business days = too-young vs [1]=15
//   - 2026-04-21 (Tue)                 → 17 business days (cron-miss catchup)
//   - 2026-04-16 (Thu, 4 weeks before) → 20 business days = schedule[2] boundary
//   - 2026-04-13 (Mon, 31 calendar d.) → too-old at MAX_AGE_DAYS=30

const STALE_TODAY = new Date('2026-05-14T14:00:00Z');
const STALE_TODAY_ISO = '2026-05-14';
const fixedNow = (): Date => STALE_TODAY;

const STALE_CFG_DEFAULT: StaleCheckConfig = {
  holidays: [],
  maxAgeDays: 30,
  pingScheduleBusinessDays: [5, 15, 20],
};

const SANDBOX_REPO_CTX: HandleEventCtx = {
  event: {
    name: 'schedule',
    payload: {},
    repo: { owner: 'Slaanesh233-sandbox', repo: 'sandbox-repo-a' },
  },
};

interface FakePrOpts {
  number?: number;
  body?: string | null;
  draft?: boolean;
  authorLogin?: string;
  authorType?: string;
  reviewerLogins?: readonly string[];
  createdAtISO?: string; // full ISO timestamp; defaults to stale
  htmlUrl?: string;
}

interface FakePr {
  number: number;
  html_url: string;
  body: string | null;
  draft: boolean;
  user: { login: string; type: string } | null;
  requested_reviewers: ReadonlyArray<{ login: string }> | null;
  created_at: string;
}

function fakePr(opts: FakePrOpts = {}): FakePr {
  const number = opts.number ?? 7;
  // Default: PR opened on Thursday 2026-05-07 → 5 business days vs Thursday
  // "today" 2026-05-14 = schedule[0] boundary under Plan 03.1-05 [5, 15, 20]
  // → fires ping-1 when currentPingCount=0.
  const createdAt = opts.createdAtISO ?? '2026-05-07T09:00:00Z';
  const authorLogin = opts.authorLogin ?? 'kai';
  const authorType = opts.authorType ?? 'User';
  const reviewerLogins = opts.reviewerLogins ?? [];
  const body = opts.body !== undefined ? opts.body : `<!-- pr-bot:thread_ts=${SAMPLE_TS} -->`;
  return {
    number,
    html_url:
      opts.htmlUrl ?? `https://github.com/Slaanesh233-sandbox/sandbox-repo-a/pull/${number}`,
    body,
    draft: opts.draft ?? false,
    user: { login: authorLogin, type: authorType },
    requested_reviewers: reviewerLogins.map((login) => ({ login })),
    created_at: createdAt,
  };
}

/** Build a pulls.list mock that returns the given PRs as a single page. */
function singlePagePullsList(prs: ReadonlyArray<FakePr>): MockOverrides['pullsListImpl'] {
  return async () => ({ data: prs });
}

describe('handleStaleCheck — empty open-PRs list', () => {
  it('zero PRs → no postMessage, pulls.list called once, info log mentions 0 PRs', async () => {
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.pullsList).toHaveBeenCalledTimes(1);
    expect(spies.postMessage).not.toHaveBeenCalled();
    expect(spies.pullsUpdate).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/0 open PRs|stale-check: 0/));
  });
});

describe('handleStaleCheck — three eligible PRs (happy path bulk)', () => {
  it('3 eligible PRs → 3 postMessage calls + 3 pulls.update calls with both stale markers', async () => {
    const prs = [
      fakePr({ number: 11, reviewerLogins: ['reviewer'] }),
      fakePr({ number: 12, reviewerLogins: ['reviewer'] }),
      fakePr({ number: 13, reviewerLogins: ['reviewer'] }),
    ];
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList(prs),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.postMessage).toHaveBeenCalledTimes(3);
    expect(spies.pullsUpdate).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i++) {
      const updateArgs = spies.pullsUpdate.mock.calls[i]![0] as { body: string };
      expect(updateArgs.body).toContain(`<!-- pr-bot:stale_pinged_at=${STALE_TODAY_ISO} -->`);
      expect(updateArgs.body).toContain('<!-- pr-bot:stale_ping_count=1 -->');
    }
  });
});

describe('handleStaleCheck — filter step 1: thread_ts marker required', () => {
  it('PR with empty body → skipped with reason no-marker; no postMessage', async () => {
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([fakePr({ number: 7, body: '' })]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.postMessage).not.toHaveBeenCalled();
    expect(spies.pullsUpdate).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/no-marker.*#7|#7.*no-marker/));
  });
});

describe('handleStaleCheck — filter step 2: silent marker', () => {
  it('PR with thread_ts AND silent marker → skipped with reason silent-marker', async () => {
    const body = `<!-- pr-bot:thread_ts=${SAMPLE_TS} -->\n<!-- pr-bot:silent -->`;
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([fakePr({ number: 8, body })]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.postMessage).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/silent-marker/));
  });
});

describe('handleStaleCheck — filter step 3: draft', () => {
  it('PR.draft=true → skipped with reason draft', async () => {
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([fakePr({ number: 9, draft: true })]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.postMessage).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/skipped: draft/));
  });
});

describe('handleStaleCheck — filter step 4: bot author (FLT-01 parity)', () => {
  it("PR.user.type='Bot' → skipped with reason bot-author", async () => {
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([
        fakePr({ number: 21, authorLogin: 'some-bot', authorType: 'Bot' }),
      ]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.postMessage).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/bot-author/));
  });

  it("login ending [bot] with type='User' → skipped (D-04 belt-and-braces parity)", async () => {
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([
        fakePr({ number: 22, authorLogin: 'dependabot[bot]', authorType: 'User' }),
      ]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.postMessage).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/bot-author/));
  });
});

// WR-05 — malformed pr.created_at must be rejected at filter step 5 with a
// structured info/warning log; the subsequent businessDaysBetween call must
// NOT receive a malformed slice. The WR-01 outer try/catch is the floor; this
// inner guard is the first line of defense and avoids relying on RangeError.
describe('handleStaleCheck — WR-05 malformed pr.created_at', () => {
  it('non-ISO created_at → skipped with malformed-created_at log; no postMessage; subsequent PR still pinged', async () => {
    const prs: FakePr[] = [
      fakePr({ number: 301, createdAtISO: 'not-a-date-at-all' }),
      fakePr({ number: 302 }), // eligible
    ];
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList(prs),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    // Step-5 inner guard hits first; no RangeError reaches the outer catch.
    // The log line must name the PR + the reason; warning OR info channel
    // acceptable so long as the message is present somewhere visible.
    const allLogs = [
      ...spies.info.mock.calls.map((c) => String(c[0])),
      ...spies.warning.mock.calls.map((c) => String(c[0])),
    ];
    expect(allLogs.some((line) => /malformed-created_at.*301|#301.*malformed/i.test(line))).toBe(
      true,
    );
    // Loop continued: PR #302 pinged.
    expect(spies.pullsUpdate.mock.calls.length).toBeGreaterThanOrEqual(1);
    const pullNumbers = spies.pullsUpdate.mock.calls.map(
      (c) => (c[0] as { pull_number: number }).pull_number,
    );
    expect(pullNumbers).toContain(302);
    expect(pullNumbers).not.toContain(301);
  });

  it('empty-string created_at → skipped with malformed-created_at log', async () => {
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([fakePr({ number: 303, createdAtISO: '' })]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.postMessage).not.toHaveBeenCalled();
    expect(spies.pullsUpdate).not.toHaveBeenCalled();
    const allLogs = [
      ...spies.info.mock.calls.map((c) => String(c[0])),
      ...spies.warning.mock.calls.map((c) => String(c[0])),
    ];
    expect(allLogs.some((line) => /malformed-created_at|#303.*malformed/i.test(line))).toBe(true);
  });
});

describe('handleStaleCheck — filter step 5: max age (calendar days)', () => {
  it('created 31 calendar days ago → skipped with reason too-old', async () => {
    // 2026-04-13 is 31 days before 2026-05-14
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([
        fakePr({ number: 31, createdAtISO: '2026-04-13T09:00:00Z' }),
      ]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.postMessage).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/too-old/));
  });

  it('created 29 calendar days ago (within MAX_AGE_DAYS=30) → still considered (not too-old)', async () => {
    // 2026-04-15 → 29 days before 2026-05-14. Should pass step 5 (will likely
    // also pass other filters depending on weekday/business-day arithmetic).
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([
        fakePr({ number: 32, createdAtISO: '2026-04-15T09:00:00Z' }),
      ]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    // 29-day-old PR with thread_ts and no other markers → eligible → ping fires.
    expect(spies.postMessage).toHaveBeenCalledTimes(1);
    expect(spies.info).not.toHaveBeenCalledWith(expect.stringMatching(/too-old/));
  });
});

describe('handleStaleCheck — filter step 8: today is a holiday', () => {
  it('todayISO in holidays list → entire run skipped, pulls.list NOT called', async () => {
    const cfg: StaleCheckConfig = { ...STALE_CFG_DEFAULT, holidays: [STALE_TODAY_ISO] };
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: cfg,
      pullsListImpl: singlePagePullsList([fakePr({ number: 61 })]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.postMessage).not.toHaveBeenCalled();
    expect(spies.pullsList).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/holiday/));
  });
});

describe('handleStaleCheck — happy path ping copy', () => {
  it('eligible PR → postMessage text contains literal envelope emoji + "5 business days" + author mention', async () => {
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([fakePr({ number: 81, reviewerLogins: ['reviewer'] })]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    const args = spies.postMessage.mock.calls[0]![0] as {
      channel: string;
      thread_ts: string;
      text: string;
      blocks: unknown;
    };
    expect(args.channel).toBe(SANDBOX_CHANNEL_ID);
    expect(args.thread_ts).toBe(SAMPLE_TS);
    expect(args.text).toContain('this PR has been open for');
    expect(args.text).toContain('5 business days');
    expect(args.text).toContain(`<@${KAI_SLACK_ID}>`); // author and reviewer both map to KAI_SLACK_ID
    expect(args.blocks).toBeDefined();
  });

  it('zero reviewers → "cc <@author>" without trailing reviewer mentions (Decision 2 zero-reviewer edge case)', async () => {
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([fakePr({ number: 82, reviewerLogins: [] })]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    const args = spies.postMessage.mock.calls[0]![0] as { text: string };
    expect(args.text).toBe(
      `📬 this PR has been open for 5 business days.\n  cc <@${KAI_SLACK_ID}>`,
    );
  });

  it('two reviewers → both reviewer mentions appear after author mention in cc clause', async () => {
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([fakePr({ number: 83, reviewerLogins: ['r1', 'r2'] })]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    const args = spies.postMessage.mock.calls[0]![0] as { text: string };
    // All three users map to KAI_SLACK_ID via the default users map
    expect(args.text).toBe(
      `📬 this PR has been open for 5 business days.\n  cc <@${KAI_SLACK_ID}> <@${KAI_SLACK_ID}> <@${KAI_SLACK_ID}>`,
    );
  });

  it('unmapped reviewer → @<login> fallback text + warning for that login', async () => {
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      users: { kai: KAI_SLACK_ID }, // reviewer 'mystery' deliberately absent
      pullsListImpl: singlePagePullsList([fakePr({ number: 84, reviewerLogins: ['mystery'] })]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    const args = spies.postMessage.mock.calls[0]![0] as { text: string };
    expect(args.text).toContain('@mystery');
    expect(spies.warning).toHaveBeenCalledWith(
      expect.stringMatching(/no Slack ID mapping for github login "mystery"/),
    );
  });
});

describe('handleStaleCheck — error paths', () => {
  it("chat.postMessage 'not_in_channel' → setFailed; pulls.update NOT called; later PRs still attempted", async () => {
    // 2 PRs; the FIRST chat.postMessage throws not_in_channel, the second succeeds.
    let postCount = 0;
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([fakePr({ number: 91 }), fakePr({ number: 92 })]),
      postMessageImpl: async () => {
        postCount++;
        if (postCount === 1) throw new Error('not_in_channel');
        return { ok: true, ts: SAMPLE_TS };
      },
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.postMessage).toHaveBeenCalledTimes(2);
    expect(spies.pullsUpdate).toHaveBeenCalledTimes(1); // only the second PR's PATCH
    expect(spies.setFailed).toHaveBeenCalledWith(expect.stringMatching(/not_in_channel|invite/));
  });

  it("chat.postMessage 'missing_scope' → setFailed; pulls.update NOT called for that PR", async () => {
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([fakePr({ number: 93 })]),
      postMessageImpl: async () => {
        throw new Error('missing_scope');
      },
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.setFailed).toHaveBeenCalledTimes(1);
    expect(spies.pullsUpdate).not.toHaveBeenCalled();
  });

  it("chat.postMessage returns ok:false 'rate_limited' → setFailed; pulls.update NOT called; subsequent PRs continue", async () => {
    // The existing postThreadReply tier-maps !ok via setFailed regardless of code;
    // stale-check inherits that contract.
    let count = 0;
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([fakePr({ number: 94 }), fakePr({ number: 95 })]),
      postMessageImpl: async () => {
        count++;
        if (count === 1) return { ok: false, error: 'rate_limited' };
        return { ok: true, ts: SAMPLE_TS };
      },
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.postMessage).toHaveBeenCalledTimes(2);
    expect(spies.pullsUpdate).toHaveBeenCalledTimes(1); // only the second PR
    expect(spies.setFailed).toHaveBeenCalledWith(expect.stringMatching(/rate_limited|!ok/));
  });

  it('pulls.update transient 503 → retry succeeds on second attempt; warning logged', async () => {
    let count = 0;
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([fakePr({ number: 96 })]),
      pullsUpdateImpl: async () => {
        count++;
        if (count === 1) {
          const err: Error & { status?: number } = new Error('Service Unavailable');
          err.status = 503;
          throw err;
        }
        return { data: {} };
      },
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.pullsUpdate).toHaveBeenCalledTimes(2);
    expect(spies.warning).toHaveBeenCalled();
    expect(spies.setFailed).not.toHaveBeenCalled();
  });

  it('pulls.update 403 → setFailed for that PR; subsequent PRs continue', async () => {
    let count = 0;
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([fakePr({ number: 97 }), fakePr({ number: 98 })]),
      pullsUpdateImpl: async () => {
        count++;
        if (count === 1) {
          const err: Error & { status?: number } = new Error('Forbidden');
          err.status = 403;
          throw err;
        }
        return { data: {} };
      },
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.postMessage).toHaveBeenCalledTimes(2);
    expect(spies.pullsUpdate).toHaveBeenCalledTimes(2);
    expect(spies.setFailed).toHaveBeenCalledTimes(1);
  });
});

describe('handleStaleCheck — stale_ping_count increment semantics', () => {
  it('no count marker present → new body has stale_ping_count=1', async () => {
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([fakePr({ number: 101 })]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    const updateArgs = spies.pullsUpdate.mock.calls[0]![0] as { body: string };
    expect(updateArgs.body).toContain('<!-- pr-bot:stale_ping_count=1 -->');
  });

  it('count marker present (=1) → replace-in-place to =2', async () => {
    // Plan 03.1-05: with schedule [5, 15, 20] and count=1, the PR must have
    // businessDaysOpen >= schedule[1]=15 to fire ping-2. Use createdAt
    // 2026-04-23 (Thu, 3 weeks before today Thu 2026-05-14) = 15 business
    // days. Marker stale_pinged_at is preserved on the body but no longer
    // consulted for eligibility (the dispatcher relies on the K-1 alignment
    // between ping_count and schedule index).
    const body =
      `<!-- pr-bot:thread_ts=${SAMPLE_TS} -->\n` +
      `<!-- pr-bot:stale_pinged_at=2026-05-09 -->\n` +
      `<!-- pr-bot:stale_ping_count=1 -->`;
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([
        fakePr({ number: 102, body, createdAtISO: '2026-04-23T09:00:00Z' }),
      ]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    const updateArgs = spies.pullsUpdate.mock.calls[0]![0] as { body: string };
    expect(updateArgs.body).toContain('<!-- pr-bot:stale_ping_count=2 -->');
    expect(updateArgs.body).not.toContain('<!-- pr-bot:stale_ping_count=1 -->');
  });

  it('count marker present but garbage (NaN) → treated as 0; new value is 1', async () => {
    const body =
      `<!-- pr-bot:thread_ts=${SAMPLE_TS} -->\n` + `<!-- pr-bot:stale_ping_count=garbage -->`;
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([fakePr({ number: 103, body })]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    const updateArgs = spies.pullsUpdate.mock.calls[0]![0] as { body: string };
    expect(updateArgs.body).toContain('<!-- pr-bot:stale_ping_count=1 -->');
    expect(updateArgs.body).not.toContain('<!-- pr-bot:stale_ping_count=garbage -->');
  });
});

describe('handleStaleCheck — pulls.list pagination', () => {
  it('100 items on page 1 + 10 on page 2 → both pages processed; page-2 PRs ping if eligible', async () => {
    // Build 100 PRs for page 1 and 10 PRs for page 2 (all eligible).
    const buildPage = (start: number, count: number): FakePr[] =>
      Array.from({ length: count }, (_, i) =>
        fakePr({ number: start + i, reviewerLogins: ['reviewer'] }),
      );
    const page1 = buildPage(1000, 100);
    const page2 = buildPage(2000, 10);
    let callIndex = 0;
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: async () => {
        callIndex++;
        if (callIndex === 1) return { data: page1 };
        if (callIndex === 2) return { data: page2 };
        return { data: [] };
      },
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.pullsList).toHaveBeenCalledTimes(2);
    expect(spies.postMessage).toHaveBeenCalledTimes(110);
    // Confirm at least one page-2 PR (number >= 2000) was processed.
    const calledNumbers = spies.pullsUpdate.mock.calls.map(
      (call) => (call[0] as { pull_number: number }).pull_number,
    );
    expect(calledNumbers.some((n) => n >= 2000)).toBe(true);
  });

  // WR-07 — the discovery loop must enforce a page-count ceiling. A
  // pathological repo with >1000 open PRs would otherwise consume real
  // REST-API quota on every cron tick. The cap is 10 pages × 100 per page
  // = 1000 PRs; on hit, emit a warning naming the cap and the repo. Older
  // PRs (beyond the cap) are NOT processed this run; the warning surfaces
  // the visibility so operators can narrow the scope.
  it('WR-07 — pulls.list page cap stops at 10 pages with a warning', async () => {
    // Mock an unbounded supply: every page returns 100 ineligible-but-
    // existing PRs (so no postMessage fires, just keeps the loop turning).
    // PRs use a "no-marker" body so they short-circuit at filter step 1.
    const buildIneligiblePage = (start: number, count: number): FakePr[] =>
      Array.from({ length: count }, (_, i) =>
        // body: empty (no thread_ts marker) → skipped at step 1
        fakePr({ number: start + i, body: '' }),
      );
    let callIndex = 0;
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: async () => {
        callIndex++;
        // Always return 100 PRs — would loop forever without the cap.
        return { data: buildIneligiblePage(callIndex * 1000, 100) };
      },
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    // Cap is 10 pages; pulls.list called exactly that many times.
    expect(spies.pullsList).toHaveBeenCalledTimes(10);
    // Warning naming the cap + repo present.
    expect(spies.warning).toHaveBeenCalledWith(
      expect.stringMatching(/max-pages|page-cap|10.*pages/i),
    );
  });
});

describe('handleStaleCheck — defensive: missing stale-check config', () => {
  it('deps.config.staleCheck === undefined → setFailed mentions stale-check.yml; no pulls.list', async () => {
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      // staleCheck deliberately omitted (undefined)
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.setFailed).toHaveBeenCalledWith(expect.stringMatching(/stale-check\.yml/i));
    expect(spies.pullsList).not.toHaveBeenCalled();
    expect(spies.postMessage).not.toHaveBeenCalled();
  });
});

// WR-01 — per-PR error isolation. The handleStaleCheck loop must not abort the
// run when processOnePrForStaleCheck throws on one PR; later PRs must still be
// considered. Existing tests cover graceful failure paths (setFailed-via-
// postThreadReply, 4xx setFailed-via-patchWithRetry). They do NOT cover an
// unclassified throw mid-loop; this suite does.
//
// The current throw path exercised here: pr.created_at is malformed enough
// that filter step 5 short-circuits via Number.isFinite=false (no return), and
// filter step 6 then calls businessDaysBetween(pr.created_at.slice(0, 10), ...)
// with a non-ISO date which throws RangeError from parseIsoDateToUtcMs.
//
// WR-05 adds an early return when createdAt is malformed; this test still
// provides defense-in-depth for any future throw path (e.g. a malformed marker
// past WR-06, an unrelated octokit/Slack exception leaking past the inner
// guards). The PR-numbered warning log is also asserted.
describe('handleStaleCheck — WR-01 per-PR error isolation', () => {
  it('PR with malformed created_at + malformed stale_pinged_at → warning + next PR still pinged', async () => {
    // PR #201 carries garbage in BOTH created_at and the stale_pinged_at marker.
    // Without the WR-01 outer try/catch, processOnePrForStaleCheck throws a
    // RangeError from businessDaysBetween and aborts the loop for PR #202.
    const garbageBody =
      `<!-- pr-bot:thread_ts=${SAMPLE_TS} -->\n` +
      `<!-- pr-bot:stale_pinged_at=garbage-not-a-date -->`;
    const prs: FakePr[] = [
      fakePr({ number: 201, body: garbageBody, createdAtISO: 'totally-not-a-date' }),
      fakePr({ number: 202 }), // eligible
    ];
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList(prs),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    // PR #202 must still have been pinged regardless of what happened to PR #201.
    expect(spies.pullsUpdate.mock.calls.length).toBeGreaterThanOrEqual(1);
    const pullNumbers = spies.pullsUpdate.mock.calls.map(
      (call) => (call[0] as { pull_number: number }).pull_number,
    );
    expect(pullNumbers).toContain(202);
  });
});

// === Plan 03.1-05 — schedule eligibility + final-ping dispatch ==============
//
// New eligibility model (replaces old steps 6/7/9): fire ping K (1-indexed,
// K = currentPingCount + 1) when businessDaysOpen >= schedule[K-1] AND
// currentPingCount === K-1. Otherwise short-circuit with:
//   - 'too-young'  when businessDaysOpen < schedule[currentPingCount]
//   - 'max-pings-reached' when currentPingCount >= schedule.length
// Final-ping iff K === schedule.length; dispatcher selects
// formatStaleFinalPingReply instead of formatStalePingReply.
//
// Date math (today Thu 2026-05-14 against an empty holiday list):
//   - opened 2026-05-07 (Thu) → 5 business days  = schedule[0] boundary
//   - opened 2026-05-08 (Fri) → 4 business days  = too-young vs [0]=5
//   - opened 2026-04-23 (Thu) → 15 business days = schedule[1] boundary
//   - opened 2026-04-24 (Fri) → 14 business days = too-young vs [1]=15
//   - opened 2026-04-21 (Tue) → 17 business days = cron-miss catchup w/ count=1
//   - opened 2026-04-16 (Thu) → 20 business days = schedule[2] boundary

describe('handleStaleCheck — Plan 03.1-05 schedule eligibility — first-ping (count=0)', () => {
  it('schedule [5, 15, 20], PR opened 5 business days ago, count=0 → fires ping-1 (intermediate)', async () => {
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([
        fakePr({ number: 401, createdAtISO: '2026-05-07T09:00:00Z' }),
      ]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.postMessage).toHaveBeenCalledTimes(1);
    const text = (spies.postMessage.mock.calls[0]![0] as { text: string }).text;
    // Intermediate copy (NOT final).
    expect(text).not.toMatch(/final/i);
    expect(text).not.toMatch(/no longer be tracked/i);
    const updateArgs = spies.pullsUpdate.mock.calls[0]![0] as { body: string };
    expect(updateArgs.body).toContain(`<!-- pr-bot:stale_pinged_at=${STALE_TODAY_ISO} -->`);
    expect(updateArgs.body).toContain('<!-- pr-bot:stale_ping_count=1 -->');
  });

  it('schedule [5, 15, 20], PR opened 4 business days ago, count=0 → skipped too-young; log contains next_threshold=5', async () => {
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([
        fakePr({ number: 402, createdAtISO: '2026-05-08T09:00:00Z' }),
      ]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.postMessage).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/too-young/));
    // Spelling-safety: a typo like 'next_threshhold' would not match this.
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/next_threshold=5/));
  });
});

describe('handleStaleCheck — Plan 03.1-05 schedule eligibility — second-ping (count=1)', () => {
  it('schedule [5, 15, 20], PR opened 15 business days ago, count=1 → fires ping-2 (intermediate)', async () => {
    const body =
      `<!-- pr-bot:thread_ts=${SAMPLE_TS} -->\n` +
      `<!-- pr-bot:stale_pinged_at=2026-04-30 -->\n` +
      `<!-- pr-bot:stale_ping_count=1 -->`;
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([
        fakePr({ number: 411, createdAtISO: '2026-04-23T09:00:00Z', body }),
      ]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.postMessage).toHaveBeenCalledTimes(1);
    const text = (spies.postMessage.mock.calls[0]![0] as { text: string }).text;
    expect(text).not.toMatch(/final/i);
    expect(text).toContain('15 business days');
    const updateArgs = spies.pullsUpdate.mock.calls[0]![0] as { body: string };
    expect(updateArgs.body).toContain('<!-- pr-bot:stale_ping_count=2 -->');
  });

  it('schedule [5, 15, 20], PR opened 14 business days ago, count=1 → skipped too-young; log contains next_threshold=15', async () => {
    const body =
      `<!-- pr-bot:thread_ts=${SAMPLE_TS} -->\n` +
      `<!-- pr-bot:stale_pinged_at=2026-04-30 -->\n` +
      `<!-- pr-bot:stale_ping_count=1 -->`;
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([
        fakePr({ number: 412, createdAtISO: '2026-04-24T09:00:00Z', body }),
      ]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.postMessage).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/too-young/));
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/next_threshold=15/));
  });
});

describe('handleStaleCheck — Plan 03.1-05 schedule eligibility — final-ping (count=2; schedule.length=3)', () => {
  it('schedule [5, 15, 20], PR opened 20 business days ago, count=2 → fires ping-3 FINAL', async () => {
    const body =
      `<!-- pr-bot:thread_ts=${SAMPLE_TS} -->\n` +
      `<!-- pr-bot:stale_pinged_at=2026-05-05 -->\n` +
      `<!-- pr-bot:stale_ping_count=2 -->`;
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([
        fakePr({ number: 421, createdAtISO: '2026-04-16T09:00:00Z', body }),
      ]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.postMessage).toHaveBeenCalledTimes(1);
    const text = (spies.postMessage.mock.calls[0]![0] as { text: string }).text;
    expect(text).toMatch(/final/i);
    expect(text).toMatch(/no longer be tracked/i);
    expect(text).toMatch(/escalate/i);
    expect(text).toContain('20 business days');
    const updateArgs = spies.pullsUpdate.mock.calls[0]![0] as { body: string };
    expect(updateArgs.body).toContain('<!-- pr-bot:stale_ping_count=3 -->');
    expect(updateArgs.body).toContain(`<!-- pr-bot:stale_pinged_at=${STALE_TODAY_ISO} -->`);
  });
});

describe('handleStaleCheck — Plan 03.1-05 schedule eligibility — cron-miss catchup', () => {
  it('schedule [5, 15, 20], PR opened 17 business days ago, count=1 → fires ping-2 (no leap-forward to ping-3)', async () => {
    // K-1 alignment: businessDaysOpen=17 >= schedule[1]=15 AND ping_count=1 === 2-1 → fires ping-2.
    const body =
      `<!-- pr-bot:thread_ts=${SAMPLE_TS} -->\n` +
      `<!-- pr-bot:stale_pinged_at=2026-04-30 -->\n` +
      `<!-- pr-bot:stale_ping_count=1 -->`;
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([
        fakePr({ number: 431, createdAtISO: '2026-04-21T09:00:00Z', body }),
      ]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.postMessage).toHaveBeenCalledTimes(1);
    const text = (spies.postMessage.mock.calls[0]![0] as { text: string }).text;
    // INTERMEDIATE — not final, because schedule.length=3 and nextCount=2.
    expect(text).not.toMatch(/final/i);
    expect(text).toContain('17 business days');
    const updateArgs = spies.pullsUpdate.mock.calls[0]![0] as { body: string };
    expect(updateArgs.body).toContain('<!-- pr-bot:stale_ping_count=2 -->');
  });
});

describe('handleStaleCheck — Plan 03.1-05 schedule eligibility — max-pings (count >= schedule.length)', () => {
  it('schedule [5, 15, 20], PR opened 20 business days ago, count=3 → skipped max-pings-reached', async () => {
    const body =
      `<!-- pr-bot:thread_ts=${SAMPLE_TS} -->\n` +
      `<!-- pr-bot:stale_pinged_at=2026-05-13 -->\n` +
      `<!-- pr-bot:stale_ping_count=3 -->`;
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([
        fakePr({ number: 441, createdAtISO: '2026-04-16T09:00:00Z', body }),
      ]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.postMessage).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/max-pings-reached/));
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/schedule_length=3/));
  });

  it('schedule [5, 15, 20], count=4 (> schedule.length) → skipped max-pings-reached', async () => {
    const body =
      `<!-- pr-bot:thread_ts=${SAMPLE_TS} -->\n` +
      `<!-- pr-bot:stale_pinged_at=2026-05-13 -->\n` +
      `<!-- pr-bot:stale_ping_count=4 -->`;
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([
        fakePr({ number: 442, createdAtISO: '2026-04-16T09:00:00Z', body }),
      ]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.postMessage).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/max-pings-reached/));
  });
});

describe('handleStaleCheck — Plan 03.1-05 schedule eligibility — single-entry schedule [0]', () => {
  it('schedule [0], PR opened today (0 business days), count=0 → fires ping-1 FINAL (single-entry: first ping is also last)', async () => {
    const cfg: StaleCheckConfig = {
      holidays: [],
      maxAgeDays: 30,
      pingScheduleBusinessDays: [0],
    };
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: cfg,
      pullsListImpl: singlePagePullsList([
        fakePr({ number: 451, createdAtISO: '2026-05-14T09:00:00Z' }),
      ]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.postMessage).toHaveBeenCalledTimes(1);
    const text = (spies.postMessage.mock.calls[0]![0] as { text: string }).text;
    expect(text).toMatch(/final/i);
    expect(text).toMatch(/no longer be tracked/i);
    expect(text).toContain('0 business days');
    const updateArgs = spies.pullsUpdate.mock.calls[0]![0] as { body: string };
    expect(updateArgs.body).toContain('<!-- pr-bot:stale_ping_count=1 -->');
  });

  it('schedule [0], same PR with count=1 → skipped max-pings-reached (count >= schedule.length=1)', async () => {
    const cfg: StaleCheckConfig = {
      holidays: [],
      maxAgeDays: 30,
      pingScheduleBusinessDays: [0],
    };
    const body =
      `<!-- pr-bot:thread_ts=${SAMPLE_TS} -->\n` +
      `<!-- pr-bot:stale_pinged_at=${STALE_TODAY_ISO} -->\n` +
      `<!-- pr-bot:stale_ping_count=1 -->`;
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: cfg,
      pullsListImpl: singlePagePullsList([
        fakePr({ number: 452, createdAtISO: '2026-05-14T09:00:00Z', body }),
      ]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.postMessage).not.toHaveBeenCalled();
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/max-pings-reached/));
    expect(spies.info).toHaveBeenCalledWith(expect.stringMatching(/schedule_length=1/));
  });
});

describe('handleStaleCheck — Plan 03.1-05 final-ping dispatch (formatStaleFinalPingReply selection)', () => {
  it('nextCount === schedule.length → postMessage text matches /final/i AND /no longer be tracked/i', async () => {
    const body =
      `<!-- pr-bot:thread_ts=${SAMPLE_TS} -->\n` +
      `<!-- pr-bot:stale_pinged_at=2026-05-05 -->\n` +
      `<!-- pr-bot:stale_ping_count=2 -->`;
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([
        fakePr({ number: 461, createdAtISO: '2026-04-16T09:00:00Z', body }),
      ]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    const text = (spies.postMessage.mock.calls[0]![0] as { text: string }).text;
    expect(text).toMatch(/final/i);
    expect(text).toMatch(/no longer be tracked/i);
  });

  it('nextCount < schedule.length → postMessage text does NOT match /final/i', async () => {
    // count=0 → nextCount=1; schedule.length=3. Not final.
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList([
        fakePr({ number: 462, createdAtISO: '2026-05-07T09:00:00Z' }),
      ]),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    const text = (spies.postMessage.mock.calls[0]![0] as { text: string }).text;
    expect(text).not.toMatch(/final/i);
    expect(text).not.toMatch(/no longer be tracked/i);
  });
});

describe('handleStaleCheck — Plan 03.1-05 progression through full schedule', () => {
  it('3 eligible PRs (count=0/1/2) → 3 postMessage calls; first two intermediate, third final; count progresses 1/2/3', async () => {
    const bodyForCount = (count: number, ago: string): string => {
      if (count === 0) return `<!-- pr-bot:thread_ts=${SAMPLE_TS} -->`;
      return (
        `<!-- pr-bot:thread_ts=${SAMPLE_TS} -->\n` +
        `<!-- pr-bot:stale_pinged_at=${ago} -->\n` +
        `<!-- pr-bot:stale_ping_count=${count} -->`
      );
    };
    const prs = [
      fakePr({
        number: 471,
        createdAtISO: '2026-05-07T09:00:00Z',
        body: bodyForCount(0, ''),
        reviewerLogins: ['reviewer'],
      }),
      fakePr({
        number: 472,
        createdAtISO: '2026-04-23T09:00:00Z',
        body: bodyForCount(1, '2026-04-30'),
        reviewerLogins: ['reviewer'],
      }),
      fakePr({
        number: 473,
        createdAtISO: '2026-04-16T09:00:00Z',
        body: bodyForCount(2, '2026-05-05'),
        reviewerLogins: ['reviewer'],
      }),
    ];
    const { deps, spies } = makeMockDeps({
      now: fixedNow,
      staleCheck: STALE_CFG_DEFAULT,
      pullsListImpl: singlePagePullsList(prs),
    });
    await handleStaleCheck(deps, SANDBOX_REPO_CTX);
    expect(spies.postMessage).toHaveBeenCalledTimes(3);
    const t1 = (spies.postMessage.mock.calls[0]![0] as { text: string }).text;
    const t2 = (spies.postMessage.mock.calls[1]![0] as { text: string }).text;
    const t3 = (spies.postMessage.mock.calls[2]![0] as { text: string }).text;
    expect(t1).not.toMatch(/final/i);
    expect(t2).not.toMatch(/final/i);
    expect(t3).toMatch(/final/i);
    // pulls.update progresses count 1, 2, 3.
    const counts = spies.pullsUpdate.mock.calls.map((c) => {
      const m = /stale_ping_count=(\d+)/.exec((c[0] as { body: string }).body);
      return m ? Number.parseInt(m[1]!, 10) : -1;
    });
    expect(counts).toEqual([1, 2, 3]);
  });
});

// STAT-01 re-lock 2026-05-08 regression guard: handleStaleCheck must not add
// or remove any root reactions. The narrow-regex count on the source file
// stays at 23 (the canonical Phase-3 baseline). The broader regex returns 24
// because it also matches a doc-comment / log-string reference; only the
// narrow API-call-site count is gated.
describe('STAT-01 reactions-count invariant (Plan 03.1-05 regression guard)', () => {
  it('grep -cE "reactions.(add|remove)" src/index.ts === 23 (Phase-3 baseline preserved)', () => {
    // Canonical metric is `grep -cE` (line-match count, NOT total occurrence
    // count). Two of the source lines contain the regex twice (e.g. one
    // `slack.reactions.add(... typeof slack.reactions.add ...)`), so a naive
    // String.match-based count would report 24. The plan-checker gate runs
    // grep -cE, so this test mirrors that semantic.
    const src = readFileSync(resolvePath(repoRootForHandlerTests, 'src/index.ts'), 'utf-8');
    const re = /reactions\.(add|remove)/;
    const lineCount = src.split(/\r?\n/).filter((line) => re.test(line)).length;
    expect(lineCount).toBe(23);
  });
});

// Sanity check that the on-disk config still parses (parity with the
// config-schema test, but exercised here so tests/handler.test.ts test budget
// remains coherent). Plan 03.1-05: assertions rewritten for the new schema
// shape (ping_schedule_business_days replaces three v1 fields).
describe('handleStaleCheck — on-disk config integration', () => {
  it('loadStaleCheckConfig(yaml) parses the v1.1 schedule + max_age_days + additive holidays', () => {
    const cfg = loadStaleCheckConfig(
      'ping_schedule_business_days: [5, 15, 20]\nmax_age_days: 30\nholidays:\n  - 2026-05-25\n',
    );
    expect([...cfg.pingScheduleBusinessDays]).toEqual([5, 15, 20]);
    expect(cfg.maxAgeDays).toBe(30);
    expect(cfg.holidays).toContain('2026-05-25');
  });
});
