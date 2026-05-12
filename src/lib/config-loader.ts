// Config loader — strict schema validators for the two on-disk YAML files
// (`config/users.yml`, `config/channel.yml`). Both functions parse, validate
// against anchored Slack ID regexes (D-05), and either return a typed object
// or throw with a greppable message prefix.
//
// FND-02 / FND-03: schema validation runs as part of the unit-test suite and
// hard-fails CI if any value violates. A typo'd Slack ID can never reach
// production via this codepath.
//
// D-17: in the Phase 2 action handler, these throws are caught and routed to
// `core.setFailed` so the GitHub Actions run shows a red X with the schema
// error inline — the maintainer doesn't need to read the action logs to
// discover that a config edit was malformed.
//
// T-01-22: `typeof value !== 'string'` is checked BEFORE the regex test, so
// a YAML anchor or non-string value (e.g. nested map) throws clearly rather
// than crashing the regex with a non-string argument.

import { parse as parseYaml } from 'yaml';

import { computeUsFederalHolidays } from './business-days.js';
import {
  CHANNEL_ID_REGEX,
  type ChannelConfig,
  type GitHubLogin,
  type SlackChannelId,
  type SlackUserId,
  type StaleCheckConfig,
  USERS_ID_REGEX,
  type UsersMap,
} from './types.js';

// Re-exported under shorter names purely for test ergonomics.
export const USERS_REGEX = USERS_ID_REGEX;
export const CHANNEL_REGEX = CHANNEL_ID_REGEX;

/**
 * Parse + validate a `config/users.yml` text.
 *
 * Schema:
 *   - top-level mapping with exactly one required key, `users`
 *   - `users` is an object map: GitHubLogin -> SlackUserId
 *   - every value matches /^U[A-Z0-9]+$/ (anchored)
 *
 * Throws `Error` with prefix `users.yml schema:` on any violation.
 */
export function loadUsersMap(yamlText: string): UsersMap {
  const parsed = parseYaml(yamlText) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`users.yml schema: top-level must be a mapping with a "users" key`);
  }
  const root = parsed as { users?: unknown };
  if (!root.users || typeof root.users !== 'object' || Array.isArray(root.users)) {
    throw new Error(`users.yml schema: missing or invalid "users" key`);
  }
  const usersIn = root.users as Record<string, unknown>;
  const users: Record<GitHubLogin, SlackUserId> = {};
  for (const [login, value] of Object.entries(usersIn)) {
    if (typeof value !== 'string') {
      throw new Error(
        `users.yml schema: value for "${login}" must be a string, got ${typeof value}`,
      );
    }
    if (!USERS_ID_REGEX.test(value)) {
      throw new Error(
        `users.yml schema: value for "${login}" ("${value}") does not match Slack user ID regex /^U[A-Z0-9]+$/`,
      );
    }
    users[login] = value;
  }
  return { users };
}

/**
 * Parse + validate a `config/channel.yml` text.
 *
 * Schema:
 *   - top-level mapping with one required key, `channel`
 *   - value is a string matching /^[CG][A-Z0-9]+$/ (anchored — public C* and private G*)
 *
 * Throws `Error` with prefix `channel.yml schema:` on any violation.
 */
export function loadChannelConfig(yamlText: string): ChannelConfig {
  const parsed = parseYaml(yamlText) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`channel.yml schema: top-level must be a mapping with a "channel" key`);
  }
  const root = parsed as { channel?: unknown };
  if (typeof root.channel !== 'string') {
    throw new Error(`channel.yml schema: missing or non-string "channel" key`);
  }
  if (!CHANNEL_ID_REGEX.test(root.channel)) {
    throw new Error(
      `channel.yml schema: channel value ("${root.channel}") does not match Slack channel ID regex /^[CG][A-Z0-9]+$/`,
    );
  }
  return { channel: root.channel as SlackChannelId };
}

// === Phase 3.1 — stale-check config loader (STALE-01) =======================
//
// Same pattern as loadUsersMap / loadChannelConfig: parseYaml → typeof checks
// → schema checks → throw with greppable prefix on violation.
//
// Plan 03.1-05 schema migration (2026-05-12) — the v1.0 three-field shape
// (stale_threshold_business_days / reping_interval_business_days /
// max_pings_per_pr) is REPLACED by a single explicit per-ping schedule:
//   - ping_schedule_business_days: array of non-negative integers, length 1..10,
//     strictly monotonically increasing. Default when absent: [5, 15, 20]
//     (week 1 + week 3 + ~month 1). The LAST entry triggers the final-ping
//     escalation copy (formatStaleFinalPingReply).
//
// Eligibility now collapses to a single rule: fire ping K (1-indexed) when
//   businessDaysOpen >= schedule[K-1] AND currentPingCount === K-1
// — no separate cooldown or max-pings check is needed.
//
// max_age_days remains (positive integer; default 30; calendar-day cap for
// PRs that should be human-triaged rather than bot-pinged).
//
// Holidays (Plan 03.1-04 — auto-computed US-federal merge):
//   - US-federal holidays for the next 5 years (inclusive of the current UTC
//     year) are auto-computed by `computeUsFederalHolidays` in
//     business-days.ts and ALWAYS merged into the returned `holidays` array.
//   - YAML `holidays:` is purely ADDITIVE — admins list company-specific
//     dates (year-end shutdowns, founders' day) and those are merged on top.
//   - Duplicates between YAML extras and auto-computed federal dates are
//     silently deduped; result is sorted ascending in ISO-8601 order.
//   - Self-extending across the bot's lifetime; no manual annual refresh.

// Plan 03.1-04: holidays is no longer materialized as a default constant —
// it's computed at load time so the current UTC year drives the auto-computed
// US-federal window. Plan 03.1-05: max_age_days remains the only locked
// non-schedule, non-holiday default; the three obsolete fields are gone.
const STALE_CHECK_MAX_AGE_DAYS_DEFAULT = 30;

// Plan 03.1-05: default per-ping schedule when ping_schedule_business_days is
// absent from YAML. Cadence reads: week 1 + week 3 + ~month 1 (business days).
// The last entry (20) triggers the final-ping escalation copy.
const STALE_CHECK_DEFAULT_PING_SCHEDULE: readonly number[] = Object.freeze([5, 15, 20]);

// Plan 03.1-05: ping schedule array length floor (must fire at least once) and
// ceiling (operator sanity: more than ten pings on a single PR is annoyance,
// not signal). The strictly-monotonic check upstream additionally guarantees
// no duplicates and no decreasing entries.
const STALE_CHECK_PING_SCHEDULE_MAX_LENGTH = 10;

// Number of years (inclusive of baseYear) for which US-federal holidays are
// auto-computed and merged into the on-disk YAML's `holidays:` array.
// 5 years ahead means the loader generates [now, now+5] = 6 calendar years of
// federal holidays at each invocation. Self-extending; no manual annual
// refresh required.
const STALE_CHECK_HOLIDAY_YEARS_AHEAD = 5;

// Strict anchored ISO-8601 date regex. Shared with the marker validator for
// stale_pinged_at (Plan 03.1-02 import).
const STALE_CHECK_ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function requirePositiveInteger(field: string, value: unknown): number {
  if (typeof value !== 'number') {
    throw new Error(
      `stale-check.yml schema: ${field} must be a number, got ${typeof value} (${String(value)})`,
    );
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`stale-check.yml schema: ${field} must be a positive integer, got ${value}`);
  }
  return value;
}

// Plan 03.1-05: validate `ping_schedule_business_days`. The value (when
// present) must be a JS array (Array.isArray), length within [1, 10], every
// entry a non-negative integer (typeof === 'number' && Number.isInteger), and
// strictly monotonically increasing (each entry > previous, so duplicates and
// decreases are rejected). Same `stale-check.yml schema:` throw prefix as the
// surrounding loader for D-17 parity. Returns a frozen copy of the validated
// array; falls back to `fallback` when value is undefined.
//
// D-02 / FND-06 invariant: every numeric check uses Number.isInteger on a
// typeof-checked number — no parseFloat, no Number(stringValue), no +string
// coercion. YAML's parser produces native JS numbers for integer literals; a
// quoted entry like "20" comes back as a string and fails the typeof check
// with the index-anchored error message.
function parseAndValidatePingSchedule(
  value: unknown,
  fallback: readonly number[],
): readonly number[] {
  if (value === undefined) {
    return Object.freeze([...fallback]);
  }
  if (!Array.isArray(value)) {
    throw new Error(
      `stale-check.yml schema: ping_schedule_business_days must be an array, got ${typeof value}`,
    );
  }
  if (value.length === 0) {
    throw new Error(
      `stale-check.yml schema: ping_schedule_business_days must have length >= 1, got empty array`,
    );
  }
  if (value.length > STALE_CHECK_PING_SCHEDULE_MAX_LENGTH) {
    throw new Error(
      `stale-check.yml schema: ping_schedule_business_days must have length <= ${STALE_CHECK_PING_SCHEDULE_MAX_LENGTH}, got ${value.length}`,
    );
  }
  for (let i = 0; i < value.length; i += 1) {
    const entry = value[i];
    if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 0) {
      throw new Error(
        `stale-check.yml schema: ping_schedule_business_days[${i}] must be a non-negative integer, got ${String(entry)} (typeof ${typeof entry})`,
      );
    }
    if (i > 0 && entry <= (value[i - 1] as number)) {
      throw new Error(
        `stale-check.yml schema: ping_schedule_business_days must be strictly monotonically increasing; entry[${i}]=${entry} is not greater than entry[${i - 1}]=${String(value[i - 1])}`,
      );
    }
  }
  return Object.freeze([...(value as readonly number[])]);
}

/**
 * Parse + validate a `config/stale-check.yml` text. Phase 3.1 STALE-01.
 *
 * Schema (v1.1 — Plan 03.1-05 migration, 2026-05-12):
 *   - top-level mapping (object); empty/null body allowed (returns all defaults)
 *   - `holidays`: array of ISO-8601 date strings matching /^\d{4}-\d{2}-\d{2}$/.
 *     **ADDITIVE (Plan 03.1-04):** the YAML list is merged with the
 *     auto-computed US-federal-holiday set (5 years ahead, self-extending,
 *     produced by `computeUsFederalHolidays` in business-days.ts). Admins
 *     list company-specific dates only (year-end shutdown weeks, founders'
 *     day, regional office closures); duplicates with auto-computed federal
 *     dates are silently deduped. Default: [] additive entries (the
 *     auto-computed federal set is always present).
 *   - `max_age_days`: positive integer; default 30. Calendar-day cap above
 *     which a PR is exempt from stale-pings (it's human-triage territory).
 *   - `ping_schedule_business_days`: array of non-negative integers, length
 *     1..10, strictly monotonically increasing. Default when absent:
 *     [5, 15, 20] (week 1 + week 3 + ~month 1). The LAST entry triggers the
 *     final-ping escalation copy (formatStaleFinalPingReply). Eligibility:
 *     fire ping K when businessDaysOpen >= schedule[K-1] AND
 *     currentPingCount === K-1.
 *
 * Throws `Error` with prefix `stale-check.yml schema:` on any violation. The
 * dispatcher in src/index.ts catches these and routes through
 * `core.setFailed` (same D-17 pattern as loadUsersMap / loadChannelConfig).
 *
 * Plan 03.1-05 BREAKING CHANGES from v1.0:
 *   - REMOVED: stale_threshold_business_days, reping_interval_business_days,
 *     max_pings_per_pr (their semantics are subsumed by the schedule).
 *   - ADDED: ping_schedule_business_days (single source of truth for cadence
 *     and per-PR ping cap).
 */
export function loadStaleCheckConfig(yamlText: string): StaleCheckConfig {
  const parsed = parseYaml(yamlText) as unknown;

  // Auto-computed US-federal holiday set. Generated for the next
  // STALE_CHECK_HOLIDAY_YEARS_AHEAD years (inclusive of the current UTC year);
  // self-extending across the bot's lifetime so admins never need to refresh
  // this list manually.
  const autoFederal = computeUsFederalHolidays({
    yearsAhead: STALE_CHECK_HOLIDAY_YEARS_AHEAD,
  });

  // Empty / null / undefined YAML body → no YAML extras; auto-federal alone +
  // locked defaults.
  if (parsed === null || parsed === undefined) {
    return {
      holidays: Object.freeze([...autoFederal]),
      maxAgeDays: STALE_CHECK_MAX_AGE_DAYS_DEFAULT,
      pingScheduleBusinessDays: Object.freeze([...STALE_CHECK_DEFAULT_PING_SCHEDULE]),
    };
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `stale-check.yml schema: top-level must be a mapping (got ${Array.isArray(parsed) ? 'array' : typeof parsed})`,
    );
  }

  const root = parsed as {
    holidays?: unknown;
    max_age_days?: unknown;
    ping_schedule_business_days?: unknown;
  };

  // YAML holidays — additive extras. Validate strictly (same anchored ISO
  // regex as before) BEFORE merging with the auto-computed federal set, so
  // a malformed YAML entry still HARD-FAILS regardless of what auto produces.
  const yamlExtras: string[] = [];
  if (root.holidays !== undefined && root.holidays !== null) {
    if (!Array.isArray(root.holidays)) {
      throw new Error(
        `stale-check.yml schema: holidays must be an array, got ${typeof root.holidays}`,
      );
    }
    for (let i = 0; i < root.holidays.length; i += 1) {
      const entry = root.holidays[i];
      if (typeof entry !== 'string') {
        throw new Error(
          `stale-check.yml schema: holidays[${i}] must be a string, got ${typeof entry}`,
        );
      }
      if (!STALE_CHECK_ISO_DATE_REGEX.test(entry)) {
        throw new Error(
          `stale-check.yml schema: holidays[${i}] ("${entry}") does not match ISO-8601 date regex /^\\d{4}-\\d{2}-\\d{2}$/`,
        );
      }
      yamlExtras.push(entry);
    }
  }

  // Merge auto-federal + YAML extras: dedupe via Set, then sort ascending.
  // Order in the result is canonical ISO ascending — independent of input
  // ordering, so the consumer (businessDaysBetween) doesn't depend on YAML
  // declaration order.
  const merged = Object.freeze([...new Set([...autoFederal, ...yamlExtras])].sort());

  const maxAgeDays =
    root.max_age_days === undefined
      ? STALE_CHECK_MAX_AGE_DAYS_DEFAULT
      : requirePositiveInteger('max_age_days', root.max_age_days);

  const pingScheduleBusinessDays = parseAndValidatePingSchedule(
    root.ping_schedule_business_days,
    STALE_CHECK_DEFAULT_PING_SCHEDULE,
  );

  return {
    holidays: merged,
    maxAgeDays,
    pingScheduleBusinessDays,
  };
}
