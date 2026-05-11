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
// Locked defaults from CONTEXT.md "Implementation defaults the planner should
// ship as-is":
//   - stale_threshold_business_days = 3
//   - max_age_days = 30
//   - reping_interval_business_days = 2
//   - max_pings_per_pr = 3
//
// holidays defaults to [] when absent (the cron's Mon-Fri schedule restriction
// + business-day filter cover the baseline; admins append company-specific
// days as needed).

const STALE_CHECK_DEFAULTS: StaleCheckConfig = {
  holidays: [],
  staleThresholdBusinessDays: 3,
  maxAgeDays: 30,
  repingIntervalBusinessDays: 2,
  maxPingsPerPr: 3,
};

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

// Non-negative-integer variant. Semantically zero is a valid setting for
// stale_threshold_business_days (treat every eligible PR as stale on day 0)
// and reping_interval_business_days (no cooldown between pings). Both fields
// are configured numerically — 0 is meaningful, not a sentinel for "absent".
// The Phase 3.1 keystone (Plan 03.1-03 M5 → M10 Option-B override window)
// relies on this — without it, the keystone cannot exercise S3 (eligible-fires)
// on a same-day PR, since GitHub does not allow backdating created_at.
function requireNonNegativeInteger(field: string, value: unknown): number {
  if (typeof value !== 'number') {
    throw new Error(
      `stale-check.yml schema: ${field} must be a number, got ${typeof value} (${String(value)})`,
    );
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `stale-check.yml schema: ${field} must be a non-negative integer, got ${value}`,
    );
  }
  return value;
}

/**
 * Parse + validate a `config/stale-check.yml` text. Phase 3.1 STALE-01.
 *
 * Schema:
 *   - top-level mapping (object); empty/null body allowed (returns all defaults)
 *   - `holidays`: array of ISO-8601 date strings matching /^\d{4}-\d{2}-\d{2}$/.
 *     Default: [] (no extra holidays beyond the cron's Mon-Fri restriction).
 *   - `stale_threshold_business_days`: non-negative integer (0 = every
 *     eligible PR is stale immediately, no minimum-age window); default 3.
 *     The D3 relaxation from positive-integer is required by the Phase 3.1
 *     keystone (Plan 03.1-03 M5 → M10 Option-B override window) so a
 *     same-day PR can exercise the eligible-fires path.
 *   - `max_age_days`: positive integer; default 30
 *   - `reping_interval_business_days`: non-negative integer (0 = no cooldown
 *     between pings on the same PR — every cron run will re-ping eligible
 *     PRs, capped only by `max_pings_per_pr`); default 2. PRODUCTION SAFETY:
 *     setting this to 0 in production is risky; WR-04 adds a runtime warning
 *     when the loaded value is 0.
 *   - `max_pings_per_pr`: positive integer; default 3
 *
 * Throws `Error` with prefix `stale-check.yml schema:` on any violation. The
 * dispatcher in Plan 03.1-02 catches these and routes through `core.setFailed`
 * (same D-17 pattern as loadUsersMap / loadChannelConfig).
 *
 * Defaults source: CONTEXT.md "Implementation defaults the planner should
 * ship as-is" section.
 */
export function loadStaleCheckConfig(yamlText: string): StaleCheckConfig {
  const parsed = parseYaml(yamlText) as unknown;

  // Empty / null / undefined YAML → all defaults. Treat the file as an empty
  // mapping so omitted-key paths below resolve uniformly.
  if (parsed === null || parsed === undefined) {
    return STALE_CHECK_DEFAULTS;
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `stale-check.yml schema: top-level must be a mapping (got ${Array.isArray(parsed) ? 'array' : typeof parsed})`,
    );
  }

  const root = parsed as {
    holidays?: unknown;
    stale_threshold_business_days?: unknown;
    max_age_days?: unknown;
    reping_interval_business_days?: unknown;
    max_pings_per_pr?: unknown;
  };

  // holidays — array of ISO date strings; default [].
  let holidays: readonly string[] = STALE_CHECK_DEFAULTS.holidays;
  if (root.holidays !== undefined && root.holidays !== null) {
    if (!Array.isArray(root.holidays)) {
      throw new Error(
        `stale-check.yml schema: holidays must be an array, got ${typeof root.holidays}`,
      );
    }
    const out: string[] = [];
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
      out.push(entry);
    }
    holidays = out;
  }

  const staleThresholdBusinessDays =
    root.stale_threshold_business_days === undefined
      ? STALE_CHECK_DEFAULTS.staleThresholdBusinessDays
      : requireNonNegativeInteger(
          'stale_threshold_business_days',
          root.stale_threshold_business_days,
        );

  const maxAgeDays =
    root.max_age_days === undefined
      ? STALE_CHECK_DEFAULTS.maxAgeDays
      : requirePositiveInteger('max_age_days', root.max_age_days);

  const repingIntervalBusinessDays =
    root.reping_interval_business_days === undefined
      ? STALE_CHECK_DEFAULTS.repingIntervalBusinessDays
      : requireNonNegativeInteger(
          'reping_interval_business_days',
          root.reping_interval_business_days,
        );

  const maxPingsPerPr =
    root.max_pings_per_pr === undefined
      ? STALE_CHECK_DEFAULTS.maxPingsPerPr
      : requirePositiveInteger('max_pings_per_pr', root.max_pings_per_pr);

  return {
    holidays,
    staleThresholdBusinessDays,
    maxAgeDays,
    repingIntervalBusinessDays,
    maxPingsPerPr,
  };
}
