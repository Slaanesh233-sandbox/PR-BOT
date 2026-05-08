// tests/handler.test.ts — Phase 2 Plan 02-01
//
// Mocked-handler unit suite. Every test stubs `slack` and `octokit` via `vi.fn()` and
// asserts the exact set of calls handleEvent makes for a given event payload + config.
//
// FLT-05 note: the literal Slack user-mention strings appear here only inside fixture
// data and assertions. CI Gate 7 scopes its grep to `src/`; tests/ is W-02 exempt — see
// .github/workflows/ci.yml Gate 7 inline comment for rationale.

import { describe, expect, it, vi } from 'vitest';

import { handleEvent, type Deps, type HandleEventCtx } from '../src/index.js';

const SAMPLE_TS = '1700000000.000100'; // FND-06 trailing-zero fixture
const KAI_SLACK_ID = 'U0B20676JVB';
const SANDBOX_CHANNEL_ID = 'C0B2GF3UJ01';

interface MockOverrides {
  postMessageResult?: { ok: boolean; ts?: string; error?: string };
  postMessageImpl?: () => Promise<{ ok: boolean; ts?: string; error?: string }>;
  pullsGetBody?: string | null;
  pullsUpdateImpl?: () => Promise<unknown>;
  users?: Record<string, string>;
  // Phase 3 additions:
  chatUpdateImpl?: () => Promise<{ ok: boolean; error?: string }>;
  reactionsAddImpl?: () => Promise<{ ok: boolean; error?: string }>;
  // Change B 2026-05-07 (Task 2):
  reactionsRemoveImpl?: () => Promise<{ ok: boolean; error?: string }>;
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

  const postMessage = overrides.postMessageImpl
    ? vi.fn().mockImplementation(overrides.postMessageImpl)
    : vi.fn().mockResolvedValue(postMessageResult);
  const pullsGet = vi.fn().mockResolvedValue({ data: { body: pullsGetBody } });
  const pullsUpdate = vi.fn().mockImplementation(pullsUpdateImpl);
  const chatUpdate = vi.fn().mockImplementation(chatUpdateImpl);
  const reactionsAdd = vi.fn().mockImplementation(reactionsAddImpl);
  const reactionsRemove = vi.fn().mockImplementation(reactionsRemoveImpl);
  const info = vi.fn();
  const warning = vi.fn();
  const setFailed = vi.fn();

  const deps: Deps = {
    slack: {
      chat: { postMessage, update: chatUpdate },
      reactions: { add: reactionsAdd, remove: reactionsRemove },
    } as unknown as Deps['slack'],
    octokit: {
      rest: { pulls: { get: pullsGet, update: pullsUpdate } },
    } as unknown as Deps['octokit'],
    config: {
      users: { users },
      channel: { channel: SANDBOX_CHANNEL_ID },
    },
    logger: { info, warning, setFailed },
    sleep: async () => {}, // fast-forward retry delays in tests
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
    expect(args.text).toBe(`<@${KAI_SLACK_ID}> was added as a reviewer on the pull request`);
    expect(args.text).toContain('was added as a reviewer');
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
