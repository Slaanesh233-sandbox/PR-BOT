// Tests for src/lib/business-days.ts — pure date arithmetic for the stale-PR
// reminder cron (STALE-01).
//
// Convention contract (mirrors the helper's header comment):
//   - All dates are ISO-8601 YYYY-MM-DD strings, interpreted as UTC midnight via
//     Date.UTC(y, m-1, d) — so the helper is deterministic across DST and runner
//     timezones.
//   - businessDaysBetween is right-exclusive: start counted, end excluded. The
//     dispatcher's "PR has been waiting through 3 business days, fire on the
//     morning of the 4th" semantics drop out of this convention naturally.
//   - Reversed args (end < start) clamp to 0 (no warning; defensive only).
//   - holidays accepts ReadonlySet<string> OR readonly string[] — both shapes
//     normalize internally to a Set for O(1) lookup.
//
// All tests are pure — no fs, no network, no Date.now().

import { describe, expect, it } from 'vitest';

import { businessDaysBetween, isBusinessDay } from '../src/lib/business-days.js';

describe('businessDaysBetween — basic ranges (no holidays)', () => {
  it('same day → 0', () => {
    expect(businessDaysBetween('2026-05-08', '2026-05-08', new Set())).toBe(0);
  });

  it('Mon → Fri same week (right-exclusive) → 4 business days (Mon, Tue, Wed, Thu)', () => {
    // 2026-05-04 (Mon) through 2026-05-08 (Fri) exclusive: Mon, Tue, Wed, Thu = 4.
    expect(businessDaysBetween('2026-05-04', '2026-05-08', new Set())).toBe(4);
  });

  it('Friday → following Monday (weekend skipped) → 1', () => {
    // 2026-05-08 (Fri) through 2026-05-11 (Mon) exclusive: Fri counts; Sat+Sun skipped.
    expect(businessDaysBetween('2026-05-08', '2026-05-11', new Set())).toBe(1);
  });

  it('Friday → following Wednesday → 3 (CONTEXT.md success criterion 3)', () => {
    // 2026-05-08 (Fri) through 2026-05-13 (Wed) exclusive:
    //   Fri, [Sat], [Sun], Mon, Tue = 3 business days.
    expect(businessDaysBetween('2026-05-08', '2026-05-13', new Set())).toBe(3);
  });

  it('Mon → following Mon (one full week) → 5', () => {
    // 2026-05-04 (Mon) through 2026-05-11 (Mon) exclusive: Mon-Fri = 5.
    expect(businessDaysBetween('2026-05-04', '2026-05-11', new Set())).toBe(5);
  });

  it('Mon → +4 weeks → 20', () => {
    // 2026-05-04 (Mon) through 2026-06-01 (Mon) exclusive: 4 full work weeks = 20.
    expect(businessDaysBetween('2026-05-04', '2026-06-01', new Set())).toBe(20);
  });
});

describe('businessDaysBetween — holidays', () => {
  it('one in-range weekday holiday subtracts 1', () => {
    // Memorial Day 2026-05-25 is a Monday. Range Mon 2026-05-25 → Mon 2026-06-01
    // exclusive without holidays = 5 (full week). With Memorial Day subtracted = 4.
    const without = businessDaysBetween('2026-05-25', '2026-06-01', new Set());
    const withMemorial = businessDaysBetween(
      '2026-05-25',
      '2026-06-01',
      new Set(['2026-05-25']),
    );
    expect(without).toBe(5);
    expect(withMemorial).toBe(4);
  });

  it('multiple in-range holidays each subtract 1', () => {
    // Thanksgiving week 2026: Thu 2026-11-26 + Fri 2026-11-27 are holidays.
    // Range Mon 2026-11-23 → Mon 2026-11-30 exclusive: Mon-Fri = 5 without
    // holidays; minus 2 holidays = 3 business days.
    expect(
      businessDaysBetween('2026-11-23', '2026-11-30', new Set(['2026-11-26', '2026-11-27'])),
    ).toBe(3);
  });

  it('holiday on a weekend is NOT double-counted', () => {
    // A "holiday" date that falls on a Saturday (2026-07-04 — Independence Day
    // actual; sample-only — the bot's v1 list uses the OBSERVED Friday 2026-07-03).
    // 2026-07-04 is a Saturday. Range Fri 2026-07-03 → Mon 2026-07-06 exclusive:
    //   Fri counts; [Sat], [Sun] skip; result = 1. Adding 2026-07-04 to the holiday
    //   set does NOT change the result (Sat was already skipped as non-business).
    expect(businessDaysBetween('2026-07-03', '2026-07-06', new Set())).toBe(1);
    expect(
      businessDaysBetween('2026-07-03', '2026-07-06', new Set(['2026-07-04'])),
    ).toBe(1);
  });

  it('holiday outside [start, end) range is ignored', () => {
    // Christmas 2026-12-25 is on a Friday; range Mon 2026-12-28 → Fri 2027-01-01
    // exclusive includes Mon-Thu = 4 business days. Adding 2026-12-25 to the
    // holiday set does NOT change the result (it falls before start).
    expect(businessDaysBetween('2026-12-28', '2027-01-01', new Set())).toBe(4);
    expect(
      businessDaysBetween('2026-12-28', '2027-01-01', new Set(['2026-12-25'])),
    ).toBe(4);
  });
});

describe('businessDaysBetween — DST transitions (helper is UTC; transitions must not skew count)', () => {
  it('DST spring-forward week 2027-03-14 (the 23-hour day in US ET; helper uses UTC, so unaffected)', () => {
    // Range Thu 2027-03-11 → Mon 2027-03-15 exclusive: Thu, Fri = 2 business days.
    // The DST jump at 2am 2027-03-14 (a Sunday in US ET) must not cause an off-by-one.
    expect(businessDaysBetween('2027-03-11', '2027-03-15', new Set())).toBe(2);
    // Same exclusive end with the 4-day window starting on the Friday: Fri, Mon = 2.
    expect(businessDaysBetween('2027-03-12', '2027-03-16', new Set())).toBe(2);
  });

  it('DST fall-back week 2026-11-01 (the 25-hour day in US ET; helper uses UTC, so unaffected)', () => {
    // Range Thu 2026-10-29 → Mon 2026-11-02 exclusive: Thu, Fri = 2 business days.
    // The DST jump at 2am 2026-11-01 (a Sunday in US ET) must not cause an off-by-one.
    expect(businessDaysBetween('2026-10-29', '2026-11-02', new Set())).toBe(2);
    expect(businessDaysBetween('2026-10-30', '2026-11-03', new Set())).toBe(2);
  });
});

describe('businessDaysBetween — defensive edge cases', () => {
  it('reversed args (end < start) clamp to 0', () => {
    expect(businessDaysBetween('2026-05-11', '2026-05-04', new Set())).toBe(0);
  });

  it('invalid date string throws RangeError with offending input in the message', () => {
    expect(() => businessDaysBetween('not-a-date', '2026-05-08', new Set())).toThrow(RangeError);
    expect(() => businessDaysBetween('2026-05-08', '2026/05/11', new Set())).toThrow(RangeError);
    expect(() => businessDaysBetween('2026-5-8', '2026-05-11', new Set())).toThrow(/2026-5-8/);
  });

  it('accepts a readonly string[] for holidays (loader returns array; dispatcher passes through)', () => {
    // Same Memorial Day fixture as above, but passing an array instead of a Set.
    expect(businessDaysBetween('2026-05-25', '2026-06-01', ['2026-05-25'])).toBe(4);
    expect(businessDaysBetween('2026-05-25', '2026-06-01', [])).toBe(5);
  });

  it('timezone independence: range result is the same regardless of host timezone', () => {
    // The helper uses Date.UTC internally — confirmed by simply running the same
    // call here (vitest may run in any timezone). No process.env.TZ tinkering
    // needed: the helper is timezone-pure by construction.
    expect(businessDaysBetween('2026-05-04', '2026-05-11', new Set())).toBe(5);
  });

  it('full month stretch July 2026 — 22 weekdays minus 1 observed holiday = 21', () => {
    // 2026-07-01 (Wed) through 2026-08-01 (Sat) exclusive. July 2026 weekdays:
    //   Wed/Thu (1-2), Fri (3 - Independence Day observed), Mon-Fri (6-10), (13-17),
    //   (20-24), (27-31) = 23 weekdays.
    // Without holiday subtraction: 23. With 2026-07-03 holiday: 22.
    expect(businessDaysBetween('2026-07-01', '2026-08-01', new Set())).toBe(23);
    expect(
      businessDaysBetween('2026-07-01', '2026-08-01', new Set(['2026-07-03'])),
    ).toBe(22);
  });
});

describe('isBusinessDay', () => {
  it('Friday 2026-05-08 with empty holidays → true', () => {
    expect(isBusinessDay('2026-05-08', new Set())).toBe(true);
  });

  it('Saturday 2026-05-09 → false (weekend)', () => {
    expect(isBusinessDay('2026-05-09', new Set())).toBe(false);
  });

  it('Sunday 2026-05-10 → false (weekend)', () => {
    expect(isBusinessDay('2026-05-10', new Set())).toBe(false);
  });

  it('Memorial Day Monday 2026-05-25 with that date in holidays → false', () => {
    expect(isBusinessDay('2026-05-25', new Set(['2026-05-25']))).toBe(false);
  });

  it('Memorial Day Monday 2026-05-25 with EMPTY holidays → true (a Monday is still a weekday)', () => {
    expect(isBusinessDay('2026-05-25', new Set())).toBe(true);
  });

  it('invalid date string throws RangeError', () => {
    expect(() => isBusinessDay('garbage', new Set())).toThrow(RangeError);
  });

  it('accepts a readonly string[] for holidays', () => {
    expect(isBusinessDay('2026-05-25', ['2026-05-25'])).toBe(false);
    expect(isBusinessDay('2026-05-25', [])).toBe(true);
  });
});
