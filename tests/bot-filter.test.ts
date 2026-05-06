// Tests for src/lib/bot-filter.ts.
//
// D-04: bot filter implements `sender.type === 'Bot' || login.endsWith('[bot]')`.
// The suffix check is belt-and-braces — historically some bots have come through
// with `type: 'User'` despite being app-installed, hence the explicit
// `dependabot[bot]`, `renovate[bot]`, `github-actions[bot]` test cases.

import { describe, expect, it } from 'vitest';

import { isBotActor } from '../src/lib/bot-filter.js';

describe('isBotActor', () => {
  it("returns true for actor with type === 'Bot'", () => {
    expect(isBotActor({ type: 'Bot' })).toBe(true);
    expect(isBotActor({ type: 'Bot', login: 'some-bot-login' })).toBe(true);
  });

  it('returns true for dependabot[bot] (login suffix), regardless of type field', () => {
    expect(isBotActor({ login: 'dependabot[bot]' })).toBe(true);
    // Even if type comes through as 'User' (the pathological case D-04 guards against):
    expect(isBotActor({ type: 'User', login: 'dependabot[bot]' })).toBe(true);
  });

  it('returns true for renovate[bot] and github-actions[bot] (suffix)', () => {
    expect(isBotActor({ login: 'renovate[bot]' })).toBe(true);
    expect(isBotActor({ type: 'User', login: 'renovate[bot]' })).toBe(true);
    expect(isBotActor({ login: 'github-actions[bot]' })).toBe(true);
    expect(isBotActor({ type: 'User', login: 'github-actions[bot]' })).toBe(true);
  });

  it("returns false for a normal human user (type 'User', no [bot] suffix)", () => {
    expect(isBotActor({ type: 'User', login: 'kai' })).toBe(false);
    expect(isBotActor({ type: 'User', login: 'alice' })).toBe(false);
    // A login that merely contains "bot" but does NOT end with "[bot]" is still a human:
    expect(isBotActor({ type: 'User', login: 'robotech-fan' })).toBe(false);
    expect(isBotActor({ type: 'User', login: 'bot-builder' })).toBe(false);
  });

  it('returns false for null, undefined, or empty actor objects', () => {
    expect(isBotActor(null)).toBe(false);
    expect(isBotActor(undefined)).toBe(false);
    expect(isBotActor({})).toBe(false);
    // Only `type` set, but not 'Bot':
    expect(isBotActor({ type: 'User' })).toBe(false);
    // Only `login` set, but no [bot] suffix:
    expect(isBotActor({ login: 'kai' })).toBe(false);
  });
});
