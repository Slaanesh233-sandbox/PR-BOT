// Business-day arithmetic — pure date helper for the stale-PR reminder cron.
//
// STALE-01 + CONTEXT.md Decision 1 + ROADMAP success criteria 3 + 8.
//
// Convention contract:
//   - All dates are ISO-8601 YYYY-MM-DD strings, interpreted as UTC midnight via
//     `Date.UTC(year, month - 1, day)`. The helper is therefore deterministic
//     across DST transitions and across runners in different timezones — the
//     2027-03-14 spring-forward (23-hour day in US ET) and the 2026-11-01
//     fall-back (25-hour day) cannot cause an off-by-one because the iterator
//     steps by exactly 86_400_000 ms in UTC, which the DST jumps do not affect.
//
//   - businessDaysBetween is RIGHT-EXCLUSIVE: start counted, end excluded.
//     Example: businessDaysBetween('2026-05-04', '2026-05-08', ∅) === 4 because
//     we count Mon, Tue, Wed, Thu — Fri is the right-exclusive boundary so the
//     dispatcher's `>= 3` test fires once the PR has been waiting through 3
//     business days, on the morning of the 4th.
//
//   - Reversed args (end < start) clamp to 0 (no warning emitted; the
//     dispatcher in Plan 03.1-02 should never call with reversed args, so this
//     is purely defensive).
//
//   - The `holidays` parameter accepts both `ReadonlySet<string>` and
//     `readonly string[]` — internally normalized to a Set for O(1) lookup.
//     The loader returns string[]; the dispatcher passes either shape directly.
//
//   - Invalid date strings (anything not matching /^\d{4}-\d{2}-\d{2}$/) throw
//     RangeError with the offending input echoed in the message.
//
// FLT-05 invariant: this module emits no Slack mention syntax — it returns
// only `number` and `boolean`. The angle-bracket-at-U… form is owned by
// `mentions.ts` alone.

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ONE_DAY_MS = 86_400_000;

/**
 * Either a Set of ISO date strings or a readonly array of them. Internally
 * normalized to a Set for O(1) `has()` lookups.
 */
export type Holidays = ReadonlySet<string> | readonly string[];

function normalizeHolidays(holidays: Holidays): ReadonlySet<string> {
  return holidays instanceof Set ? holidays : new Set(holidays);
}

function parseIsoDateToUtcMs(date: string): number {
  if (!ISO_DATE_REGEX.test(date)) {
    throw new RangeError(`businessDaysBetween: expected YYYY-MM-DD ISO date, got "${date}"`);
  }
  // Parts already validated by regex. Use parseInt with explicit radix 10 —
  // the forbidden-coercion grep (D-02 / FND-06; see invariant section of the
  // plan) targets the literal float-coercion token AND the bare numeric-cast
  // token; parseInt with radix 10 is the standard integer parser and trips
  // neither.
  const year = parseInt(date.slice(0, 4), 10);
  const month = parseInt(date.slice(5, 7), 10);
  const day = parseInt(date.slice(8, 10), 10);
  const ms = Date.UTC(year, month - 1, day);
  // Date.UTC tolerates out-of-range fields by overflowing — reject those.
  // Cheap sanity check: round-trip the parts back through UTCDate accessors.
  const d = new Date(ms);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    throw new RangeError(`businessDaysBetween: "${date}" is not a real calendar date`);
  }
  return ms;
}

function utcMsToIsoDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Returns true iff `date` (YYYY-MM-DD) falls Mon-Fri AND is not present in
 * the holiday set.
 *
 * Throws RangeError on malformed input.
 */
export function isBusinessDay(date: string, holidays: Holidays): boolean {
  const ms = parseIsoDateToUtcMs(date);
  const dow = new Date(ms).getUTCDay(); // 0=Sun, 6=Sat
  if (dow === 0 || dow === 6) return false;
  const holidaySet = normalizeHolidays(holidays);
  return !holidaySet.has(date);
}

/**
 * Count the integer number of business days in the half-open interval
 * [start, end). A business day is a weekday (Mon-Fri) that is NOT in the
 * holiday set.
 *
 * Examples (no holidays):
 *   - same day → 0
 *   - Mon → Fri (same week) → 4 (Mon, Tue, Wed, Thu)
 *   - Fri → following Mon → 1 (Fri counts; Sat+Sun skipped)
 *
 * Reversed args clamp to 0. Invalid inputs throw RangeError.
 *
 * Both `start` and `end` are interpreted as UTC midnight — see the module
 * header comment for the DST-immunity rationale.
 */
export function businessDaysBetween(start: string, end: string, holidays: Holidays): number {
  const startMs = parseIsoDateToUtcMs(start);
  const endMs = parseIsoDateToUtcMs(end);
  if (endMs <= startMs) return 0;
  const holidaySet = normalizeHolidays(holidays);
  let count = 0;
  for (let cur = startMs; cur < endMs; cur += ONE_DAY_MS) {
    const dow = new Date(cur).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (holidaySet.has(utcMsToIsoDate(cur))) continue;
    count += 1;
  }
  return count;
}
