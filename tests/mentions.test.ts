// Tests for src/lib/mentions.ts — the central producer of Slack <@U...> mention syntax (FLT-05, D-03).
//
// Critical security invariant exercised here:
//   - On a users.yml map miss, mentions.resolve must return a `fallback` shape whose `text`
//     starts with a plain `@` (literal, NO Slack mention angle-bracket syntax). A fallback that
//     accidentally produced `<@unknown-dev>` would silently map to a non-existent Slack user
//     and emit no ping — strictly worse than the visible plain-text fallback.
//
// All tests are pure: no network, no fs, no real warn destination. The optional `warn`
// callback is injected via vitest's vi.fn() so we can assert call counts.

import { describe, expect, it, vi } from 'vitest';

import { resolve, resolveAll } from '../src/lib/mentions.js';
import type { UsersMap } from '../src/lib/types.js';

const usersMap: UsersMap = {
  users: {
    kai: 'U01ABCD2345',
    'dummy-reviewer': 'U01EFGH6789',
  },
};

describe('mentions.resolve', () => {
  it('returns a mapped ResolvedMention for a github login present in the users map', () => {
    const result = resolve('kai', usersMap);
    expect(result).toEqual({ kind: 'mapped', text: '<@U01ABCD2345>', login: 'kai' });
  });

  it('returns a fallback ResolvedMention with PLAIN @login text (no <@ syntax) on map miss', () => {
    const result = resolve('unknown-dev', usersMap);
    expect(result).toEqual({ kind: 'fallback', text: '@unknown-dev', login: 'unknown-dev' });
    // Defensive assertion: the fallback text MUST NOT contain the Slack mention prefix.
    // A regression that emits the angle-bracket-at form would route to a phantom Slack user.
    expect(result.text.startsWith('@')).toBe(true);
    expect(result.text).not.toMatch(/^<@/);
  });

  it('calls opts.warn exactly once with a message containing the missing login', () => {
    const warn = vi.fn();
    resolve('unknown-dev', usersMap, { warn });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('unknown-dev');
  });

  it('does NOT call opts.warn when the login resolves through the map', () => {
    const warn = vi.fn();
    resolve('kai', usersMap, { warn });
    expect(warn).not.toHaveBeenCalled();
  });

  it('omitting opts.warn is safe — no throw on map miss with the no-op default', () => {
    expect(() => resolve('unknown-dev', usersMap)).not.toThrow();
  });
});

describe('mentions.resolveAll', () => {
  it('preserves order across mixed mapped + fallback inputs', () => {
    const result = resolveAll(
      ['unknown-dev', 'kai', 'another-unknown', 'dummy-reviewer'],
      usersMap,
    );
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ kind: 'fallback', text: '@unknown-dev', login: 'unknown-dev' });
    expect(result[1]).toEqual({ kind: 'mapped', text: '<@U01ABCD2345>', login: 'kai' });
    expect(result[2]).toEqual({
      kind: 'fallback',
      text: '@another-unknown',
      login: 'another-unknown',
    });
    expect(result[3]).toEqual({
      kind: 'mapped',
      text: '<@U01EFGH6789>',
      login: 'dummy-reviewer',
    });
  });

  it('returns an empty array for empty input', () => {
    expect(resolveAll([], usersMap)).toEqual([]);
  });
});
