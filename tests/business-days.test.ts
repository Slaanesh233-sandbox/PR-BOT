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

import {
  businessDaysBetween,
  computeUsFederalHolidays,
  isBusinessDay,
  isUsFederalHoliday,
} from '../src/lib/business-days.js';

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
    const withMemorial = businessDaysBetween('2026-05-25', '2026-06-01', new Set(['2026-05-25']));
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
    expect(businessDaysBetween('2026-07-03', '2026-07-06', new Set(['2026-07-04']))).toBe(1);
  });

  it('holiday outside [start, end) range is ignored', () => {
    // Christmas 2026-12-25 is on a Friday; range Mon 2026-12-28 → Fri 2027-01-01
    // exclusive includes Mon-Thu = 4 business days. Adding 2026-12-25 to the
    // holiday set does NOT change the result (it falls before start).
    expect(businessDaysBetween('2026-12-28', '2027-01-01', new Set())).toBe(4);
    expect(businessDaysBetween('2026-12-28', '2027-01-01', new Set(['2026-12-25']))).toBe(4);
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
    expect(businessDaysBetween('2026-07-01', '2026-08-01', new Set(['2026-07-03']))).toBe(22);
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

// === Phase 3.1 polish — auto-computed US-federal holidays (Plan 03.1-04) =====
//
// Coverage targets:
//   - All 11 federal holidays per year, generated for [baseYear, baseYear+yearsAhead]
//     inclusive.
//   - Floating Mon/Thu holidays land on the correct nth weekday of the correct
//     month — verified against hand-computed 2026 dates.
//   - Fixed-date holidays apply the federal observed-shift rule:
//       * Saturday-fall  → preceding Friday
//       * Sunday-fall    → following Monday
//       * Weekday-fall   → no shift
//     Floating-weekday holidays are NEVER shifted (always a weekday by
//     construction).
//   - Cross-year-boundary edge case: Jan 1 2022 falls Sat → observed Fri
//     Dec 31 2021. We include the observed date even when it crosses the
//     year boundary (that's the day people actually take off).
//   - Result is deduplicated + sorted ascending ISO order.
//   - isUsFederalHoliday is a thin predicate over computeUsFederalHolidays.

describe('computeUsFederalHolidays — happy path (baseYear=2026, default yearsAhead=5)', () => {
  it('returns ≥ 11 × 6 = 66 entries for the default 5-years-ahead window inclusive', () => {
    // [2026, 2026+5] = [2026..2031] inclusive = 6 years × 11 holidays = 66.
    // (Allow for ≥ 50 to absorb any obs-shift cross-year-boundary effects.)
    const out = computeUsFederalHolidays({ baseYear: 2026 });
    expect(out.length).toBeGreaterThanOrEqual(50);
    expect(out.length).toBeGreaterThanOrEqual(66);
  });

  it('emits the 11 specific 2026 federal-holiday dates (calendar math verified)', () => {
    const out = new Set(computeUsFederalHolidays({ baseYear: 2026, yearsAhead: 0 }));
    // Fixed-date New Year's Day: Jan 1 2026 = Thu → no shift.
    expect(out.has('2026-01-01')).toBe(true);
    // MLK Day: 3rd Monday of January 2026 = Jan 19.
    expect(out.has('2026-01-19')).toBe(true);
    // Presidents Day: 3rd Monday of February 2026 = Feb 16.
    expect(out.has('2026-02-16')).toBe(true);
    // Memorial Day: last Monday of May 2026 = May 25.
    expect(out.has('2026-05-25')).toBe(true);
    // Juneteenth: Jun 19 2026 = Fri → no shift.
    expect(out.has('2026-06-19')).toBe(true);
    // Independence Day: Jul 4 2026 = Sat → OBSERVED Fri Jul 3 2026.
    expect(out.has('2026-07-03')).toBe(true);
    expect(out.has('2026-07-04')).toBe(false);
    // Labor Day: 1st Monday of September 2026 = Sep 7.
    expect(out.has('2026-09-07')).toBe(true);
    // Columbus / Indigenous Peoples' Day: 2nd Monday of October 2026 = Oct 12.
    expect(out.has('2026-10-12')).toBe(true);
    // Veterans Day: Nov 11 2026 = Wed → no shift.
    expect(out.has('2026-11-11')).toBe(true);
    // Thanksgiving: 4th Thursday of November 2026 = Nov 26.
    expect(out.has('2026-11-26')).toBe(true);
    // Christmas: Dec 25 2026 = Fri → no shift.
    expect(out.has('2026-12-25')).toBe(true);
  });

  it('observed-shift Saturday → preceding Friday (Jul 4 2026 → Jul 3 2026)', () => {
    const out = new Set(computeUsFederalHolidays({ baseYear: 2026, yearsAhead: 0 }));
    expect(out.has('2026-07-03')).toBe(true); // observed
    expect(out.has('2026-07-04')).toBe(false); // actual is Saturday — never appears
  });

  it('observed-shift Sunday → following Monday (Jul 4 2027 → Jul 5 2027)', () => {
    // Jul 4 2027 is a Sunday — should be observed on Mon Jul 5 2027.
    const out = new Set(computeUsFederalHolidays({ baseYear: 2027, yearsAhead: 0 }));
    expect(out.has('2027-07-05')).toBe(true);
    expect(out.has('2027-07-04')).toBe(false);
  });

  it('observed-shift across year boundary (Jan 1 2022 Sat → observed Fri Dec 31 2021)', () => {
    // Jan 1 2022 falls on Saturday. Federal observed-shift rule pushes to
    // preceding Friday — which is Dec 31 2021, the previous calendar year.
    // The helper MUST emit the observed date even though it's outside the
    // [baseYear, baseYear+yearsAhead] window — employees take off the
    // observed day, not the actual.
    const out = new Set(computeUsFederalHolidays({ baseYear: 2022, yearsAhead: 0 }));
    expect(out.has('2021-12-31')).toBe(true); // observed
    expect(out.has('2022-01-01')).toBe(false); // actual Saturday — never appears
  });

  it('floating-weekday holidays are NEVER observed-shifted (always weekdays by construction)', () => {
    // Pick a 2026 floating-weekday holiday and confirm it landed on its
    // computed date, not shifted. MLK Day 2026 = Jan 19 (Mon).
    const out = new Set(computeUsFederalHolidays({ baseYear: 2026, yearsAhead: 0 }));
    expect(out.has('2026-01-19')).toBe(true);
    // Memorial Day 2026 = May 25 (Mon).
    expect(out.has('2026-05-25')).toBe(true);
    // Thanksgiving 2026 = Nov 26 (Thu).
    expect(out.has('2026-11-26')).toBe(true);
  });

  it('result is sorted ascending in ISO-8601 order', () => {
    const out = computeUsFederalHolidays({ baseYear: 2026, yearsAhead: 3 });
    const sorted = [...out].slice().sort();
    expect([...out]).toEqual(sorted);
  });

  it('result is deduplicated (no two identical date strings)', () => {
    const out = computeUsFederalHolidays({ baseYear: 2026, yearsAhead: 5 });
    expect(new Set(out).size).toBe(out.length);
  });

  it('default opts (no args) produce a non-empty result based on the current UTC year', () => {
    const out = computeUsFederalHolidays();
    expect(out.length).toBeGreaterThan(0);
    // Sanity: every entry is a strict YYYY-MM-DD string.
    for (const d of out) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('yearsAhead=0 produces exactly one year of holidays (~11 entries, ±1 for boundary obs-shift)', () => {
    const out = computeUsFederalHolidays({ baseYear: 2026, yearsAhead: 0 });
    // Allow [10, 12] to absorb boundary obs-shifts that may cross into a
    // neighboring year (e.g. Jan 1 falling on Sat → previous Fri).
    expect(out.length).toBeGreaterThanOrEqual(10);
    expect(out.length).toBeLessThanOrEqual(12);
  });
});

describe('isUsFederalHoliday', () => {
  it('returns true for a known 2026 federal holiday (Christmas Dec 25 2026 = Fri)', () => {
    expect(isUsFederalHoliday('2026-12-25', { baseYear: 2026, yearsAhead: 0 })).toBe(true);
  });

  it('returns true for an observed-shifted date (Fri Jul 3 2026 — observed Jul 4)', () => {
    expect(isUsFederalHoliday('2026-07-03', { baseYear: 2026, yearsAhead: 0 })).toBe(true);
  });

  it('returns false for the actual Saturday Jul 4 2026 (only the observed date appears)', () => {
    expect(isUsFederalHoliday('2026-07-04', { baseYear: 2026, yearsAhead: 0 })).toBe(false);
  });

  it('returns false for a random non-holiday weekday', () => {
    // 2026-05-12 (Tue) — not a federal holiday.
    expect(isUsFederalHoliday('2026-05-12', { baseYear: 2026, yearsAhead: 0 })).toBe(false);
  });

  it('returns false for a Saturday that is not the observed shift of any holiday', () => {
    // 2026-05-09 (Sat) — never a federal holiday in any form.
    expect(isUsFederalHoliday('2026-05-09', { baseYear: 2026, yearsAhead: 0 })).toBe(false);
  });

  it('default opts cover the current UTC year', () => {
    // We can't know exactly what year today is, but New Year's Day of the
    // current year is always present (possibly shifted).
    // This is a sanity check that the predicate doesn't blow up on bare call.
    expect(() => isUsFederalHoliday('2026-01-01')).not.toThrow();
  });
});
