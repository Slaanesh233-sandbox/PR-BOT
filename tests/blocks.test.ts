// Tests for src/lib/blocks.ts — Block Kit builders for the OPEN-04 root message
// (`<repo>: <@author> has raised a <link|PR>.` plus optional ` cc <reviewer-mentions>`)
// and thread replies.
//
// Critical invariants exercised:
//   - FLT-04: section text caps at MAX_SECTION_TEXT_LENGTH (3000). A 100-name reviewer
//     list overflows the natural copy and must be truncated rather than rejected.
//   - FLT-06(a): the OPEN-04 message intentionally does NOT include the PR title or
//     branch refs. The compile-time evidence is in `BuildRootArgs`'s shape — there is
//     no `title`, `baseRef`, or `headRef` key to pass in. Tests confirm at runtime
//     that the message string contains exactly the four fixture inputs and nothing else.
//   - FLT-05: `blocks.ts` consumes `ResolvedMention.text` already-resolved strings; it
//     never reconstructs Slack mention syntax itself.

import { describe, expect, it } from 'vitest';

import {
  MAX_SECTION_TEXT_LENGTH,
  buildRootMessage,
  buildStrikethroughRoot,
  buildThreadReply,
} from '../src/lib/blocks.js';
import type { ResolvedMention } from '../src/lib/types.js';

// Helper: extract the rendered section text from a Block Kit result. The shape is
// `{ blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '...' } }] }`.
function getSectionText(result: { blocks: readonly unknown[] }): string {
  const first = result.blocks[0] as { text: { text: string } };
  return first.text.text;
}

const authorMapped: ResolvedMention = {
  kind: 'mapped',
  text: '<@U01ABCD2345>',
  login: 'kai',
};
const reviewerMapped: ResolvedMention = {
  kind: 'mapped',
  text: '<@U01EFGH6789>',
  login: 'dummy-reviewer',
};
const reviewerFallback: ResolvedMention = {
  kind: 'fallback',
  text: '@bob',
  login: 'bob',
};

const PR_URL = 'https://github.com/x/y/pull/42';

describe('blocks.MAX_SECTION_TEXT_LENGTH', () => {
  it('equals 3000 (FLT-04 ceiling for Slack section text)', () => {
    expect(MAX_SECTION_TEXT_LENGTH).toBe(3000);
  });
});

describe('blocks.buildRootMessage', () => {
  it('produces the exact OPEN-04 string with no reviewers', () => {
    const result = buildRootMessage({
      repoShortName: 'my-pkg',
      prHtmlUrl: PR_URL,
      authorMention: authorMapped,
      reviewerMentions: [],
    });
    expect(getSectionText(result)).toBe(
      'my-pkg: <@U01ABCD2345> has raised a <https://github.com/x/y/pull/42|PR>.',
    );
  });

  it('appends " cc <r1> <r2>" with two reviewers (mixed mapped + fallback texts)', () => {
    const result = buildRootMessage({
      repoShortName: 'my-pkg',
      prHtmlUrl: PR_URL,
      authorMention: authorMapped,
      reviewerMentions: [reviewerMapped, reviewerFallback],
    });
    const text = getSectionText(result);
    // Exact suffix match — order is preserved from the input mention list.
    expect(text).toBe(
      'my-pkg: <@U01ABCD2345> has raised a <https://github.com/x/y/pull/42|PR>. cc <@U01EFGH6789> @bob',
    );
  });

  it('renders the URL inside `<URL|PR>` so the link word is exactly "PR"', () => {
    const result = buildRootMessage({
      repoShortName: 'my-pkg',
      prHtmlUrl: PR_URL,
      authorMention: authorMapped,
      reviewerMentions: [],
    });
    // Critical OPEN-04 contract: the only clickable text in the message is the word "PR".
    expect(getSectionText(result)).toContain('|PR>');
  });

  it('section text never includes any PR title or branch ref content', () => {
    // FLT-06(a): BuildRootArgs has no `title`/`baseRef`/`headRef` keys at compile time
    // (verified by the plan-level grep gate against blocks.ts source). At runtime, the
    // message can therefore only contain: repoShortName, prHtmlUrl, mention texts, and
    // the static OPEN-04 phrase. We confirm by passing fixtures that have NO overlap
    // with words like "feat:", "main", "develop", "fix-bug" and asserting the result
    // doesn't contain them.
    const result = buildRootMessage({
      repoShortName: 'my-pkg',
      prHtmlUrl: PR_URL,
      authorMention: authorMapped,
      reviewerMentions: [],
    });
    const text = getSectionText(result);
    expect(text).not.toMatch(/feat:/);
    expect(text).not.toMatch(/\bmain\b/);
    expect(text).not.toMatch(/\bdevelop\b/);
    expect(text).not.toMatch(/fix-bug/);
  });

  it('caps section text at MAX_SECTION_TEXT_LENGTH with a 100-name fallback reviewer list (FLT-04)', () => {
    const reviewerMentions: ResolvedMention[] = Array.from({ length: 100 }, (_, i) => ({
      kind: 'fallback',
      text: `@super-long-reviewer-name-number-${i.toString().padStart(4, '0')}`,
      login: `super-long-reviewer-name-number-${i.toString().padStart(4, '0')}`,
    }));
    const result = buildRootMessage({
      repoShortName: 'my-pkg',
      prHtmlUrl: PR_URL,
      authorMention: authorMapped,
      reviewerMentions,
    });
    const text = getSectionText(result);
    expect(text.length).toBeLessThanOrEqual(MAX_SECTION_TEXT_LENGTH);
  });
});

describe('blocks.buildThreadReply', () => {
  it('returns the expected Block Kit shape with mrkdwn text', () => {
    const result = buildThreadReply({ text: 'short' });
    expect(result).toEqual({
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'short' } }],
    });
  });

  it('truncates input text longer than MAX_SECTION_TEXT_LENGTH and ends with ellipsis', () => {
    const result = buildThreadReply({ text: 'x'.repeat(5000) });
    const text = getSectionText(result);
    expect(text.length).toBe(MAX_SECTION_TEXT_LENGTH);
    expect(text.endsWith('…')).toBe(true);
  });
});

describe('buildStrikethroughRoot (STAT-02 / STAT-03; Pitfall 2 dual-return)', () => {
  const author = (text: string): ResolvedMention => ({ kind: 'mapped', text, login: 'a' });
  const reviewer = (text: string): ResolvedMention => ({ kind: 'mapped', text, login: 'r' });

  it('no reviewers → wraps the full OPEN-04-shaped line in single tildes; returns blocks AND text', () => {
    const r = buildStrikethroughRoot({
      repoShortName: 'sandbox-repo-a',
      prHtmlUrl: 'https://github.com/o/r/pull/4',
      authorMention: author('<@UAUTH>'),
      reviewerMentions: [],
    });
    expect(r.text).toBe(
      '~sandbox-repo-a: <@UAUTH> has raised a <https://github.com/o/r/pull/4|PR>.~',
    );
    expect(r.blocks).toHaveLength(1);
    const block = r.blocks[0] as { type: string; text: { type: string; text: string } };
    expect(block.type).toBe('section');
    expect(block.text.type).toBe('mrkdwn');
    expect(block.text.text).toBe(r.text); // dual-return parity (Pitfall 2)
  });

  it('with reviewers → strikethrough wraps cc clause too', () => {
    const r = buildStrikethroughRoot({
      repoShortName: 'sandbox-repo-a',
      prHtmlUrl: 'https://github.com/o/r/pull/4',
      authorMention: author('<@UAUTH>'),
      reviewerMentions: [reviewer('<@UR1>'), reviewer('<@UR2>')],
    });
    expect(r.text).toBe(
      '~sandbox-repo-a: <@UAUTH> has raised a <https://github.com/o/r/pull/4|PR>. cc <@UR1> <@UR2>~',
    );
  });

  it('FLT-04: 100-reviewer cc list stays under MAX_SECTION_TEXT_LENGTH (no truncation triggered)', () => {
    const reviewers = Array.from({ length: 100 }, (_, i) =>
      reviewer(`<@U${String(i).padStart(8, '0')}>`),
    );
    const r = buildStrikethroughRoot({
      repoShortName: 'sandbox-repo-a',
      prHtmlUrl: 'https://github.com/o/r/pull/4',
      authorMention: author('<@UAUTH>'),
      reviewerMentions: reviewers,
    });
    expect(r.text.length).toBeLessThan(MAX_SECTION_TEXT_LENGTH);
    expect(r.text[0]).toBe('~');
    expect(r.text[r.text.length - 1]).toBe('~');
  });

  it('FLT-04: synthetic 4000-char repoShortName triggers capSectionText (Research §5)', () => {
    const longRepo = 'x'.repeat(4000);
    const r = buildStrikethroughRoot({
      repoShortName: longRepo,
      prHtmlUrl: 'https://github.com/o/r/pull/4',
      authorMention: author('<@UAUTH>'),
      reviewerMentions: [],
    });
    expect(r.text.length).toBe(MAX_SECTION_TEXT_LENGTH);
    expect(r.text[r.text.length - 1]).toBe('…');
  });
});

describe('buildRootMessage — FLT-04 100-reviewer happy path stays under cap (ROADMAP success criterion 5)', () => {
  const author = (text: string): ResolvedMention => ({ kind: 'mapped', text, login: 'a' });
  const reviewer = (text: string): ResolvedMention => ({ kind: 'mapped', text, login: 'r' });

  it('100 reviewers + author + repo + link → rendered text < 3000 chars', () => {
    const reviewers = Array.from({ length: 100 }, (_, i) =>
      reviewer(`<@U${String(i).padStart(8, '0')}>`),
    );
    const r = buildRootMessage({
      repoShortName: 'sandbox-repo-a',
      prHtmlUrl: 'https://github.com/o/r/pull/4',
      authorMention: author('<@UAUTH>'),
      reviewerMentions: reviewers,
    });
    const block = r.blocks[0] as { text: { text: string } };
    expect(block.text.text.length).toBeLessThan(MAX_SECTION_TEXT_LENGTH);
  });
});
