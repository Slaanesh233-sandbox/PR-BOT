// Tests for src/lib/marker.ts — the durable per-PR state read/write surface.
//
// Critical regression: FND-06 requires `parse(serialize(ts)) === ts` for the FULL string,
// including trailing zeros that would be silently truncated by parseFloat. This is exercised
// directly with the realistic Slack ts fixture '1700000000.000100'.
//
// All tests are pure — no network, no fs, no I/O. Bodies are passed in as strings.

import { describe, expect, it } from 'vitest';

import { MARKER_REGEX, inject, parse, serialize, strip } from '../src/lib/marker.js';

describe('marker.parse', () => {
  it('returns the ts when the marker is the only content of the body', () => {
    const body = '<!-- pr-bot:thread_ts=1700000000.000100 -->';
    expect(parse(body)).toBe('1700000000.000100');
  });

  it('returns the ts when the marker is embedded in markdown with code blocks and other HTML comments', () => {
    const body = [
      '## What this PR does',
      '',
      'It refactors the doohickey.',
      '',
      '```ts',
      "const x: string = 'not a marker';",
      '```',
      '',
      '<!-- some unrelated HTML comment -->',
      'More body text.',
      '<!-- pr-bot:thread_ts=1700000123.456700 -->',
      '',
      '<!-- another unrelated comment -->',
    ].join('\n');
    expect(parse(body)).toBe('1700000123.456700');
  });

  it('returns null when no marker is present', () => {
    expect(parse('Just an ordinary PR body with no marker.')).toBeNull();
    expect(parse('')).toBeNull();
    // Look-alike that should NOT match (different prefix):
    expect(parse('<!-- pr-other:thread_ts=1700000000.000100 -->')).toBeNull();
  });

  it('returns the FIRST ts when two markers are present', () => {
    const body = [
      '<!-- pr-bot:thread_ts=1700000000.000100 -->',
      'middle',
      '<!-- pr-bot:thread_ts=1800000000.999999 -->',
    ].join('\n');
    expect(parse(body)).toBe('1700000000.000100');
  });
});

describe('marker.serialize', () => {
  it("produces '<!-- pr-bot:thread_ts=1700000000.000100 -->' for the realistic Slack ts fixture", () => {
    expect(serialize('1700000000.000100')).toBe('<!-- pr-bot:thread_ts=1700000000.000100 -->');
  });

  it('FND-06 round-trip: parse(serialize(ts)) preserves trailing zeros (string equality, not float)', () => {
    // This is the test that catches the parseFloat footgun: '1700000000.000100' would
    // become 1700000000.0001 if any layer ever coerced it through Number/parseFloat.
    const ts = '1700000000.000100';
    expect(parse(serialize(ts))).toBe(ts);
  });
});

describe('marker.inject', () => {
  it('appends a marker to a body that has none, preserving the original content', () => {
    const body = '## My PR\n\nDoes things.';
    const result = inject(body, '1700000000.000100');
    expect(result).toContain('## My PR');
    expect(result).toContain('Does things.');
    expect(parse(result)).toBe('1700000000.000100');
  });

  it('is idempotent: re-injecting the same ts is a no-op', () => {
    const body = 'Original body content.';
    const once = inject(body, '1700000000.000100');
    const twice = inject(once, '1700000000.000100');
    expect(twice).toBe(once);
  });

  it('replaces an existing marker in place when called with a different ts', () => {
    const body = [
      'Original content.',
      '<!-- pr-bot:thread_ts=1700000000.000100 -->',
      'More content.',
    ].join('\n');
    const result = inject(body, '1800000000.999999');
    // The new ts is present.
    expect(parse(result)).toBe('1800000000.999999');
    // The old ts is gone (no second marker, no leftover string).
    expect(result).not.toContain('1700000000.000100');
    // Pre-marker and post-marker content survives.
    expect(result).toContain('Original content.');
    expect(result).toContain('More content.');
  });

  it('handles an empty body', () => {
    const result = inject('', '1700000000.000100');
    expect(parse(result)).toBe('1700000000.000100');
  });
});

describe('marker.strip', () => {
  it('removes the marker and leaves the rest of the body intact', () => {
    const body = ['## Heading', '', 'Body text.', '<!-- pr-bot:thread_ts=1700000000.000100 -->'].join(
      '\n',
    );
    const result = strip(body);
    expect(result).not.toContain('pr-bot:thread_ts');
    expect(result).toContain('## Heading');
    expect(result).toContain('Body text.');
  });

  it('is a no-op on a body with no marker', () => {
    const body = '## Heading\n\nBody text.';
    expect(strip(body)).toBe(body);
  });
});

describe('marker.MARKER_REGEX', () => {
  it('matches the literal marker shape', () => {
    expect(MARKER_REGEX.test('<!-- pr-bot:thread_ts=1700000000.000100 -->')).toBe(true);
    expect(MARKER_REGEX.test('not a marker')).toBe(false);
  });
});
