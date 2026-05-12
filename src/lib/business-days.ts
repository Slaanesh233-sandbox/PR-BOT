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

// === Phase 3.1 polish — auto-computed US-federal holidays (Plan 03.1-04) =====
//
// Eleven federal holidays per year, generated for [baseYear, baseYear+yearsAhead]
// inclusive. The YAML `holidays:` array in `config/stale-check.yml` becomes
// ADDITIVE — admins list company-specific dates only (year-end shutdown weeks,
// founders' day, regional office closures). Auto-computed list self-extends
// every cron tick; no manual annual refresh required.
//
// Calendar rules:
//   - Fixed-date holidays (New Year's Day, Juneteenth, Independence Day,
//     Veterans Day, Christmas): the literal calendar date.
//   - Floating-weekday holidays (MLK, Presidents, Memorial, Labor, Columbus,
//     Thanksgiving): the nth occurrence (or LAST occurrence for Memorial) of
//     the named weekday in the named month.
//
// Federal observed-shift rule for FIXED-date holidays only:
//   - If the fixed date falls on Saturday → observed on the preceding Friday.
//   - If the fixed date falls on Sunday   → observed on the following Monday.
//   - Weekday-fall                        → no shift.
//
// Floating-weekday holidays NEVER need shifting (always a Mon/Thu by
// construction). The shift may cross a year boundary — e.g. Jan 1 2022 falls
// on Saturday and is therefore observed on Friday Dec 31 2021. The observed
// date is what employees actually take off, so the helper emits it even when
// it lands outside the [baseYear, baseYear+yearsAhead] window.
//
// All math is UTC-pure: Date.UTC + getUTCDay(). No locale-dependent
// toLocaleDateString. Mirrors the existing module pattern from Phase 3.1-01.

const WEEKDAY_SUN = 0;
const WEEKDAY_MON = 1;
const WEEKDAY_THU = 4;
const WEEKDAY_SAT = 6;

/**
 * Build the ISO date of the nth occurrence of `targetDow` in `year`/`month`
 * (1-indexed `month`). For example `nthWeekdayOfMonth(2026, 1, 1, 3)` is the
 * 3rd Monday of January 2026.
 */
function nthWeekdayOfMonth(year: number, month: number, targetDow: number, n: number): string {
  const firstMs = Date.UTC(year, month - 1, 1);
  const firstDow = new Date(firstMs).getUTCDay();
  // Day-of-month of the first occurrence of targetDow this month.
  const firstOccurrence = 1 + ((targetDow - firstDow + 7) % 7);
  const dayOfMonth = firstOccurrence + (n - 1) * 7;
  return utcMsToIsoDate(Date.UTC(year, month - 1, dayOfMonth));
}

/**
 * Build the ISO date of the LAST occurrence of `targetDow` in `year`/`month`.
 * Used for Memorial Day (last Monday of May).
 */
function lastWeekdayOfMonth(year: number, month: number, targetDow: number): string {
  // `month` is 1-indexed (Jan=1). Date.UTC(year, monthArg, 0) returns the
  // millisecond timestamp of "day 0 of monthArg-zero-indexed" — i.e. the last
  // day of the PREVIOUS zero-indexed month, which is exactly the last day of
  // the 1-indexed `month` parameter. So passing `month` directly as the
  // Date.UTC monthArg (since month-1+1 = month) gives the last day of the
  // 1-indexed month. Verified by unit test (Memorial Day last Mon May 2026
  // = May 25; 5/31/2026 is a Sunday → back 6 days = May 25).
  const lastMs = Date.UTC(year, month, 0);
  const lastDow = new Date(lastMs).getUTCDay();
  const lastDate = new Date(lastMs).getUTCDate();
  // Distance back to the most recent targetDow on/before the last day.
  const back = (lastDow - targetDow + 7) % 7;
  const dayOfMonth = lastDate - back;
  return utcMsToIsoDate(Date.UTC(year, month - 1, dayOfMonth));
}

/**
 * Apply the federal observed-shift rule to a fixed-date holiday.
 * Saturday → preceding Friday. Sunday → following Monday. Weekday → no shift.
 * Returns the observed ISO date (may differ in month/year from the input).
 */
function applyObservedShift(isoDate: string): string {
  const ms = parseIsoDateToUtcMs(isoDate);
  const dow = new Date(ms).getUTCDay();
  if (dow === WEEKDAY_SAT) {
    return utcMsToIsoDate(ms - ONE_DAY_MS);
  }
  if (dow === WEEKDAY_SUN) {
    return utcMsToIsoDate(ms + ONE_DAY_MS);
  }
  return isoDate;
}

/**
 * Return the current UTC year. Wrapped in a function (not a top-level const)
 * so test fixtures and time-traveling callers may pin `baseYear` explicitly
 * without baking the wall-clock year into module load.
 */
function currentUtcYear(): number {
  return new Date().getUTCFullYear();
}

/**
 * Compute the US-federal-holiday set for years [baseYear, baseYear+yearsAhead]
 * inclusive. Returns ISO-8601 date strings sorted ascending, deduplicated.
 *
 * Eleven holidays per year:
 *   - New Year's Day (Jan 1, observed-shifted)
 *   - MLK Day (3rd Monday of January)
 *   - Presidents Day (3rd Monday of February)
 *   - Memorial Day (last Monday of May)
 *   - Juneteenth (Jun 19, observed-shifted)
 *   - Independence Day (Jul 4, observed-shifted)
 *   - Labor Day (1st Monday of September)
 *   - Columbus / Indigenous Peoples' Day (2nd Monday of October)
 *   - Veterans Day (Nov 11, observed-shifted)
 *   - Thanksgiving (4th Thursday of November)
 *   - Christmas (Dec 25, observed-shifted)
 *
 * Defaults: `baseYear = currentUtcYear()`, `yearsAhead = 5`.
 *
 * Edge case: observed-shift may push a Jan-1 holiday into the previous
 * calendar year (Jan 1 Sat → preceding Fri Dec 31 of prior year). The
 * observed date is what employees actually take off, so this helper emits
 * it even though it falls outside the nominal [baseYear, baseYear+yearsAhead]
 * window. Symmetrically, a Dec-25 / Dec-31 holiday could in principle shift
 * into the following year (Dec 25 Sat → preceding Fri Dec 24 stays in year;
 * but a Jan-1-of-next-year computed at the end of the window may show up
 * via the previous-year's New-Year's-Day generation — dedup handles this).
 */
export function computeUsFederalHolidays(opts?: {
  yearsAhead?: number;
  baseYear?: number;
}): readonly string[] {
  const yearsAhead = opts?.yearsAhead ?? 5;
  const baseYear = opts?.baseYear ?? currentUtcYear();
  const out = new Set<string>();
  for (let y = baseYear; y <= baseYear + yearsAhead; y += 1) {
    // Fixed-date holidays — apply observed-shift rule.
    out.add(applyObservedShift(`${y.toString().padStart(4, '0')}-01-01`)); // New Year's Day
    out.add(applyObservedShift(`${y.toString().padStart(4, '0')}-06-19`)); // Juneteenth
    out.add(applyObservedShift(`${y.toString().padStart(4, '0')}-07-04`)); // Independence Day
    out.add(applyObservedShift(`${y.toString().padStart(4, '0')}-11-11`)); // Veterans Day
    out.add(applyObservedShift(`${y.toString().padStart(4, '0')}-12-25`)); // Christmas
    // Floating-weekday holidays — no shift (always a weekday by construction).
    out.add(nthWeekdayOfMonth(y, 1, WEEKDAY_MON, 3)); // MLK Day — 3rd Mon Jan
    out.add(nthWeekdayOfMonth(y, 2, WEEKDAY_MON, 3)); // Presidents Day — 3rd Mon Feb
    out.add(lastWeekdayOfMonth(y, 5, WEEKDAY_MON)); // Memorial Day — last Mon May
    out.add(nthWeekdayOfMonth(y, 9, WEEKDAY_MON, 1)); // Labor Day — 1st Mon Sep
    out.add(nthWeekdayOfMonth(y, 10, WEEKDAY_MON, 2)); // Columbus / Indigenous Peoples' Day — 2nd Mon Oct
    out.add(nthWeekdayOfMonth(y, 11, WEEKDAY_THU, 4)); // Thanksgiving — 4th Thu Nov
  }
  return Object.freeze([...out].sort());
}

/**
 * Returns true iff `isoDate` is in the auto-computed US-federal-holiday set
 * for the given window (default: current UTC year + 5).
 *
 * Throws RangeError on malformed input (same contract as isBusinessDay).
 */
export function isUsFederalHoliday(
  isoDate: string,
  opts?: { baseYear?: number; yearsAhead?: number },
): boolean {
  // Validate input shape eagerly — share the existing parser's error path.
  parseIsoDateToUtcMs(isoDate);
  const holidays = computeUsFederalHolidays(opts);
  return holidays.includes(isoDate);
}
