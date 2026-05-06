// tests/handler.test.ts — Phase 2 Plan 02-01
//
// Mocked-handler unit suite. Every test stubs `slack` and `octokit` via `vi.fn()` and
// asserts the exact set of calls handleEvent makes for a given event payload + config.
//
// FLT-05 note: the literal Slack user-mention strings appear here only inside fixture
// data and assertions. CI Gate 7 scopes its grep to `src/`; tests/ is W-02 exempt — see
// .github/workflows/ci.yml Gate 7 inline comment for rationale.

import { describe, expect, it, vi } from 'vitest';

import { handleEvent, type Deps } from '../src/index.js';

const SAMPLE_TS = '1700000000.000100'; // FND-06 trailing-zero fixture
const KAI_SLACK_ID = 'U0B20676JVB';
const SANDBOX_CHANNEL_ID = 'C0B2GF3UJ01';

interface MockOverrides {
  postMessageResult?: { ok: boolean; ts?: string; error?: string };
  postMessageImpl?: () => Promise<{ ok: boolean; ts?: string; error?: string }>;
  pullsGetBody?: string | null;
  pullsUpdateImpl?: () => Promise<unknown>;
  users?: Record<string, string>;
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
  };
} {
  const postMessageResult = overrides.postMessageResult ?? { ok: true, ts: SAMPLE_TS };
  const pullsGetBody =
    overrides.pullsGetBody === undefined ? 'original PR body' : overrides.pullsGetBody;
  const users = overrides.users ?? { kai: KAI_SLACK_ID, 'dummy-reviewer': KAI_SLACK_ID };
  const pullsUpdateImpl = overrides.pullsUpdateImpl ?? (async () => ({ data: {} }));

  const postMessage = overrides.postMessageImpl
    ? vi.fn().mockImplementation(overrides.postMessageImpl)
    : vi.fn().mockResolvedValue(postMessageResult);
  const pullsGet = vi.fn().mockResolvedValue({ data: { body: pullsGetBody } });
  const pullsUpdate = vi.fn().mockImplementation(pullsUpdateImpl);
  const info = vi.fn();
  const warning = vi.fn();
  const setFailed = vi.fn();

  const deps: Deps = {
    slack: { chat: { postMessage } } as unknown as Deps['slack'],
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

  return { deps, spies: { postMessage, pullsGet, pullsUpdate, info, warning, setFailed } };
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

function openedEvent(opts: OpenedEventOpts = {}): {
  name: 'pull_request';
  payload: unknown;
  repo: { owner: string; repo: string };
} {
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
    expect(postArgs.text).toContain('has raised a');
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
    expect(postArgs.text).toContain('has raised a PR');
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
