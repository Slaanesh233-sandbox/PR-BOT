// Tests for src/lib/marker.ts — the durable per-PR state read/write surface.
//
// Critical regression: FND-06 requires `parse(serialize(ts)) === ts` for the FULL string,
// including trailing zeros that would be silently truncated by parseFloat. This is exercised
// directly with the realistic Slack ts fixture '1700000000.000100'.
//
// All tests are pure — no network, no fs, no I/O. Bodies are passed in as strings.

import { describe, expect, it } from 'vitest';

import {
  MARKER_REGEX,
  SILENT_MARKER,
  STALE_PINGED_AT_REGEX,
  STALE_PING_COUNT_REGEX,
  inject,
  injectStalePingCount,
  injectStalePingedAt,
  isSilent,
  parse,
  parseStalePingCount,
  parseStalePingedAt,
  serialize,
  serializeStalePingCount,
  serializeStalePingedAt,
  strip,
} from '../src/lib/marker.js';

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
    const body = [
      '## Heading',
      '',
      'Body text.',
      '<!-- pr-bot:thread_ts=1700000000.000100 -->',
    ].join('\n');
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

describe('SILENT_MARKER + isSilent (FLT-02; Pitfall 17 — exact match, no leniency)', () => {
  it("SILENT_MARKER literal === '<!-- pr-bot:silent -->'", () => {
    expect(SILENT_MARKER).toBe('<!-- pr-bot:silent -->');
  });
  it('isSilent returns true when SILENT_MARKER substring is present', () => {
    expect(isSilent('some PR description\n\n<!-- pr-bot:silent -->\n\nrest of body')).toBe(true);
  });
  it('isSilent returns false when SILENT_MARKER is absent', () => {
    expect(isSilent('some PR description with no marker')).toBe(false);
    expect(isSilent('')).toBe(false);
  });
  it('case sensitivity (Pitfall 17): uppercase variants do NOT match', () => {
    expect(isSilent('<!-- PR-BOT:silent -->')).toBe(false);
    expect(isSilent('<!-- pr-bot:Silent -->')).toBe(false);
  });
  it('whitespace strictness (Pitfall 17): variant whitespace does NOT match', () => {
    expect(isSilent('<!--pr-bot:silent-->')).toBe(false);
    expect(isSilent('<!-- pr-bot: silent -->')).toBe(false);
    expect(isSilent('<!--  pr-bot:silent  -->')).toBe(false);
  });
  it('does NOT collide with the thread_ts marker', () => {
    expect(isSilent('<!-- pr-bot:thread_ts=1700000000.000100 -->')).toBe(false);
  });
});

// === Phase 3.1 — stale-PR marker shapes (parallel to D-02 thread_ts) ========
//
// Two new marker shapes ride on the same `<!-- pr-bot:<token>=<value> -->`
// convention as the Phase-1 thread_ts marker:
//   - stale_pinged_at: ISO-8601 date (YYYY-MM-DD), no time / timezone
//   - stale_ping_count: positive-integer STRING (parsed to integer only at the
//     dispatcher comparison site in Plan 03.1-02)
// Same string-end-to-end + idempotent invariants as the Phase-1 marker.

const STALE_DATE_FIXTURE = '2026-05-08';
const STALE_DATE_FIXTURE_2 = '2026-05-11';
const STALE_COUNT_FIXTURE = '3';
const STALE_COUNT_FIXTURE_2 = '7';

describe('marker.parseStalePingedAt', () => {
  it('returns the date when the marker is the only content of the body', () => {
    const body = `<!-- pr-bot:stale_pinged_at=${STALE_DATE_FIXTURE} -->`;
    expect(parseStalePingedAt(body)).toBe(STALE_DATE_FIXTURE);
  });

  it('returns null when no marker is present', () => {
    expect(parseStalePingedAt('')).toBeNull();
    expect(parseStalePingedAt('Just a body.')).toBeNull();
    // Phase-1 thread_ts marker must NOT match the stale_pinged_at regex.
    expect(parseStalePingedAt('<!-- pr-bot:thread_ts=1700000000.000100 -->')).toBeNull();
  });

  it('returns the date when the marker is embedded in markdown', () => {
    const body = [
      '## What this PR does',
      '',
      'Some prose.',
      `<!-- pr-bot:stale_pinged_at=${STALE_DATE_FIXTURE} -->`,
      'More prose.',
    ].join('\n');
    expect(parseStalePingedAt(body)).toBe(STALE_DATE_FIXTURE);
  });

  // WR-06 — parseStalePingedAt must NOT return arbitrary \S+ tokens; the
  // captured value flows directly into businessDaysBetween arithmetic, where
  // a non-ISO date throws RangeError. PR bodies are human-editable, so a
  // typo or a stale value from another system using the same comment prefix
  // is a realistic attack surface. Treat any marker whose value is not a
  // strictly anchored YYYY-MM-DD as if the marker were absent (return null).
  describe('WR-06 — value-shape validation', () => {
    it('returns null for malformed-date marker value (garbage-not-a-date)', () => {
      expect(
        parseStalePingedAt('<!-- pr-bot:stale_pinged_at=garbage-not-a-date -->'),
      ).toBeNull();
    });

    it('returns null for partial-ISO marker value (missing day component)', () => {
      expect(parseStalePingedAt('<!-- pr-bot:stale_pinged_at=2026-05 -->')).toBeNull();
    });

    it('returns null for ISO-shaped value with the wrong separators', () => {
      expect(parseStalePingedAt('<!-- pr-bot:stale_pinged_at=2026/05/08 -->')).toBeNull();
      expect(parseStalePingedAt('<!-- pr-bot:stale_pinged_at=2026-5-8 -->')).toBeNull();
    });

    it('returns null for trailing-garbage values that share an ISO prefix', () => {
      // The anchored shape /^\d{4}-\d{2}-\d{2}$/ rejects appended chars too —
      // ambiguity here would let a manual edit smuggle in extra tokens.
      expect(parseStalePingedAt('<!-- pr-bot:stale_pinged_at=2026-05-08T09:00:00Z -->')).toBeNull();
    });

    it('still returns valid ISO-8601 date values', () => {
      expect(parseStalePingedAt('<!-- pr-bot:stale_pinged_at=2026-05-08 -->')).toBe('2026-05-08');
      expect(parseStalePingedAt('<!-- pr-bot:stale_pinged_at=2099-12-31 -->')).toBe('2099-12-31');
    });
  });
});

describe('marker.serializeStalePingedAt + round-trip', () => {
  it('produces the exact marker string', () => {
    expect(serializeStalePingedAt(STALE_DATE_FIXTURE)).toBe(
      `<!-- pr-bot:stale_pinged_at=${STALE_DATE_FIXTURE} -->`,
    );
  });

  it('round-trip: parseStalePingedAt(serializeStalePingedAt(d)) === d (string equality)', () => {
    expect(parseStalePingedAt(serializeStalePingedAt(STALE_DATE_FIXTURE))).toBe(STALE_DATE_FIXTURE);
  });
});

describe('marker.injectStalePingedAt', () => {
  it('appends the marker to a body that has none, preserving content', () => {
    const body = '## PR\n\nSome body.';
    const result = injectStalePingedAt(body, STALE_DATE_FIXTURE);
    expect(result).toContain('## PR');
    expect(result).toContain('Some body.');
    expect(parseStalePingedAt(result)).toBe(STALE_DATE_FIXTURE);
  });

  it('is idempotent: re-injecting the same date is a no-op', () => {
    const body = 'Original body.';
    const once = injectStalePingedAt(body, STALE_DATE_FIXTURE);
    const twice = injectStalePingedAt(once, STALE_DATE_FIXTURE);
    expect(twice).toBe(once);
  });

  it('replaces an existing marker in place when called with a different date', () => {
    const body = `Body.\n<!-- pr-bot:stale_pinged_at=${STALE_DATE_FIXTURE} -->\nTail.`;
    const result = injectStalePingedAt(body, STALE_DATE_FIXTURE_2);
    expect(parseStalePingedAt(result)).toBe(STALE_DATE_FIXTURE_2);
    expect(result).not.toContain(STALE_DATE_FIXTURE);
    expect(result).toContain('Body.');
    expect(result).toContain('Tail.');
  });

  it('handles an empty body', () => {
    const result = injectStalePingedAt('', STALE_DATE_FIXTURE);
    expect(parseStalePingedAt(result)).toBe(STALE_DATE_FIXTURE);
  });

  it('coexists with the thread_ts marker (does not disturb it)', () => {
    const body = '<!-- pr-bot:thread_ts=1700000000.000100 -->';
    const result = injectStalePingedAt(body, STALE_DATE_FIXTURE);
    expect(parse(result)).toBe('1700000000.000100');
    expect(parseStalePingedAt(result)).toBe(STALE_DATE_FIXTURE);
  });
});

describe('marker.parseStalePingCount + serialize + inject', () => {
  it('parse returns the count string when present', () => {
    expect(parseStalePingCount(`<!-- pr-bot:stale_ping_count=${STALE_COUNT_FIXTURE} -->`)).toBe(
      STALE_COUNT_FIXTURE,
    );
  });

  it('parse returns null when absent', () => {
    expect(parseStalePingCount('')).toBeNull();
    expect(parseStalePingCount('no marker here')).toBeNull();
    // stale_pinged_at marker must NOT match the count regex.
    expect(parseStalePingCount(`<!-- pr-bot:stale_pinged_at=${STALE_DATE_FIXTURE} -->`)).toBeNull();
  });

  it('serialize produces the exact marker string', () => {
    expect(serializeStalePingCount(STALE_COUNT_FIXTURE)).toBe(
      `<!-- pr-bot:stale_ping_count=${STALE_COUNT_FIXTURE} -->`,
    );
  });

  it('round-trip: parseStalePingCount(serializeStalePingCount(n)) === n (string equality)', () => {
    expect(parseStalePingCount(serializeStalePingCount(STALE_COUNT_FIXTURE))).toBe(
      STALE_COUNT_FIXTURE,
    );
  });

  it('inject is idempotent on same value', () => {
    const body = 'Body text.';
    const once = injectStalePingCount(body, STALE_COUNT_FIXTURE);
    const twice = injectStalePingCount(once, STALE_COUNT_FIXTURE);
    expect(twice).toBe(once);
  });

  it('inject replaces an existing marker in place when called with a different count', () => {
    const body = `Body.\n<!-- pr-bot:stale_ping_count=${STALE_COUNT_FIXTURE} -->\nTail.`;
    const result = injectStalePingCount(body, STALE_COUNT_FIXTURE_2);
    expect(parseStalePingCount(result)).toBe(STALE_COUNT_FIXTURE_2);
    expect(result).not.toContain(`stale_ping_count=${STALE_COUNT_FIXTURE} `);
  });
});

describe('marker — cross-marker coexistence (Phase-1 + Phase-3.1 markers share one body)', () => {
  it('three markers (thread_ts, stale_pinged_at, stale_ping_count) all parse correctly when present', () => {
    const body = [
      'Body text.',
      `<!-- pr-bot:thread_ts=1700000000.000100 -->`,
      `<!-- pr-bot:stale_pinged_at=${STALE_DATE_FIXTURE} -->`,
      `<!-- pr-bot:stale_ping_count=${STALE_COUNT_FIXTURE} -->`,
    ].join('\n');
    expect(parse(body)).toBe('1700000000.000100');
    expect(parseStalePingedAt(body)).toBe(STALE_DATE_FIXTURE);
    expect(parseStalePingCount(body)).toBe(STALE_COUNT_FIXTURE);
  });

  it('injecting all three onto an empty body yields all three parseable', () => {
    let body = inject('', '1700000000.000100');
    body = injectStalePingedAt(body, STALE_DATE_FIXTURE);
    body = injectStalePingCount(body, STALE_COUNT_FIXTURE);
    expect(parse(body)).toBe('1700000000.000100');
    expect(parseStalePingedAt(body)).toBe(STALE_DATE_FIXTURE);
    expect(parseStalePingCount(body)).toBe(STALE_COUNT_FIXTURE);
  });

  it('strip() (Phase-1 thread_ts strip) leaves stale_* markers alone', () => {
    // The Phase-1 strip helper is scoped to the thread_ts marker only.
    // Plan 03.1-02 dispatcher only injects stale_* markers, never strips them,
    // so a no-strip decision here is fine; this test pins that behavior.
    const body = [
      `<!-- pr-bot:thread_ts=1700000000.000100 -->`,
      `<!-- pr-bot:stale_pinged_at=${STALE_DATE_FIXTURE} -->`,
      `<!-- pr-bot:stale_ping_count=${STALE_COUNT_FIXTURE} -->`,
    ].join('\n');
    const stripped = strip(body);
    expect(stripped).not.toContain('thread_ts=');
    expect(stripped).toContain(`stale_pinged_at=${STALE_DATE_FIXTURE}`);
    expect(stripped).toContain(`stale_ping_count=${STALE_COUNT_FIXTURE}`);
  });
});

describe('STALE_PINGED_AT_REGEX + STALE_PING_COUNT_REGEX (case-strict; Pitfall 17 parity with SILENT_MARKER)', () => {
  it('STALE_PINGED_AT_REGEX matches the lower-case canonical shape', () => {
    expect(
      STALE_PINGED_AT_REGEX.test(`<!-- pr-bot:stale_pinged_at=${STALE_DATE_FIXTURE} -->`),
    ).toBe(true);
  });

  it('STALE_PINGED_AT_REGEX does NOT match upper-case variants', () => {
    expect(
      STALE_PINGED_AT_REGEX.test(`<!-- pr-bot:STALE_PINGED_AT=${STALE_DATE_FIXTURE} -->`),
    ).toBe(false);
    expect(
      STALE_PINGED_AT_REGEX.test(`<!-- PR-BOT:stale_pinged_at=${STALE_DATE_FIXTURE} -->`),
    ).toBe(false);
  });

  it('STALE_PING_COUNT_REGEX matches the canonical shape', () => {
    expect(
      STALE_PING_COUNT_REGEX.test(`<!-- pr-bot:stale_ping_count=${STALE_COUNT_FIXTURE} -->`),
    ).toBe(true);
  });

  it('STALE_PING_COUNT_REGEX does NOT match upper-case variants', () => {
    expect(
      STALE_PING_COUNT_REGEX.test(`<!-- pr-bot:STALE_PING_COUNT=${STALE_COUNT_FIXTURE} -->`),
    ).toBe(false);
  });
});
