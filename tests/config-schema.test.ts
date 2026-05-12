// Tests for src/lib/config-loader.ts AND the on-disk config/users.yml + config/channel.yml.
//
// This is a HARD-FAIL gate (D-14, D-16, FND-02, FND-03): if any value in the on-disk
// YAMLs fails the anchored-regex check, `npm test` exits non-zero — and so does CI.
// A typo'd Slack ID can never reach production via this codepath.
//
// The negative-case tests (lowercase ID, missing key) ensure the loader THROWS rather than
// silently parsing garbage. Those throws are routed via `core.setFailed` in Phase 2 (D-17).

import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CHANNEL_REGEX,
  USERS_REGEX,
  loadChannelConfig,
  loadStaleCheckConfig,
  loadUsersMap,
} from '../src/lib/config-loader.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolvePath(here, '..');

describe('config/users.yml on-disk schema', () => {
  it('parses cleanly via loadUsersMap (FND-02)', () => {
    const yamlText = readFileSync(resolvePath(repoRoot, 'config/users.yml'), 'utf-8');
    expect(() => loadUsersMap(yamlText)).not.toThrow();
  });

  it('every Slack user ID matches USERS_REGEX (D-14)', () => {
    const yamlText = readFileSync(resolvePath(repoRoot, 'config/users.yml'), 'utf-8');
    const map = loadUsersMap(yamlText);
    for (const [login, id] of Object.entries(map.users)) {
      expect(
        USERS_REGEX.test(id),
        `users.yml: "${login}" -> "${id}" must match ${USERS_REGEX}`,
      ).toBe(true);
    }
  });

  it('contains the D-12 sandbox seed entries: the maintainer and the second-account reviewer', () => {
    // Keys are GitHub LOGINS (matching pull_request.user.login), not first names.
    // See config/users.yml header comment — original `kai` key produced a runtime
    // fallback warning during the 2026-05-06 keystone test; corrected to match
    // the actual GitHub login of the sandbox maintainer.
    // 2026-05-08: `dummy-reviewer` was retired in favor of the real second
    // account `kerwin-test` once Path-B (real second GitHub + Slack identity)
    // was set up to close the Phase 3 YELLOW-deferred reviewer-flow scenarios.
    const yamlText = readFileSync(resolvePath(repoRoot, 'config/users.yml'), 'utf-8');
    const map = loadUsersMap(yamlText);
    expect(map.users).toHaveProperty('Slaanesh233');
    expect(map.users).toHaveProperty('kerwin-test');
  });
});

describe('config/channel.yml on-disk schema', () => {
  it('parses cleanly via loadChannelConfig (FND-03)', () => {
    const yamlText = readFileSync(resolvePath(repoRoot, 'config/channel.yml'), 'utf-8');
    expect(() => loadChannelConfig(yamlText)).not.toThrow();
  });

  it('channel ID matches CHANNEL_REGEX (D-16)', () => {
    const yamlText = readFileSync(resolvePath(repoRoot, 'config/channel.yml'), 'utf-8');
    const cfg = loadChannelConfig(yamlText);
    expect(CHANNEL_REGEX.test(cfg.channel)).toBe(true);
  });
});

describe('loadUsersMap negative cases (D-14)', () => {
  it('throws when a Slack ID is lowercase, with the offending key in the message', () => {
    expect(() => loadUsersMap('users:\n  kai: u01abc\n')).toThrow(/kai/);
  });

  it('throws when the top-level "users" key is missing', () => {
    expect(() => loadUsersMap('nope: {}\n')).toThrow(/users/);
  });

  it('throws when a value is not a string (e.g. object/number)', () => {
    expect(() => loadUsersMap('users:\n  kai: 12345\n')).toThrow(/kai/);
  });

  it('throws on empty / null YAML input', () => {
    expect(() => loadUsersMap('')).toThrow(/users/);
  });
});

describe('loadChannelConfig negative cases (D-16)', () => {
  it('throws when channel value does not match CHANNEL_REGEX', () => {
    expect(() => loadChannelConfig('channel: foo\n')).toThrow(/channel/);
  });

  it('throws when top-level "channel" key is missing', () => {
    expect(() => loadChannelConfig('nope: bar\n')).toThrow(/channel/);
  });

  it('throws when channel value is non-string', () => {
    expect(() => loadChannelConfig('channel:\n  nested: yes\n')).toThrow(/channel/);
  });
});

// === Phase 3.1 — loadStaleCheckConfig schema + on-disk gate (STALE-01) ======
//
// Same HARD-FAIL pattern as loadUsersMap / loadChannelConfig: a typo or
// malformed value in config/stale-check.yml fails npm test (and therefore CI)
// rather than silently entering production. Defaults source: CONTEXT.md
// "Implementation defaults the planner should ship as-is" — 3 / 30 / 2 / 3.

describe('loadStaleCheckConfig — defaults + happy path (Plan 03.1-04 additive holidays + Plan 03.1-05 schedule defaults)', () => {
  it('empty YAML body returns locked defaults (max_age_days=30, schedule=[5,15,20]) + auto-computed US-federal holidays', () => {
    // Plan 03.1-04: holidays:` is no longer the complete list. The loader
    // unconditionally merges the auto-computed US-federal set
    // (computeUsFederalHolidays, 5 years ahead) with any YAML extras.
    // Plan 03.1-05: schedule defaults to [5, 15, 20] when absent.
    const cfg = loadStaleCheckConfig('');
    expect(cfg.maxAgeDays).toBe(30);
    expect([...cfg.pingScheduleBusinessDays]).toEqual([5, 15, 20]);
    // 11 federal holidays × 6 years (baseYear + 5 inclusive) ≈ 66 entries
    // (allow ≥ 50 to absorb boundary obs-shift effects).
    expect(cfg.holidays.length).toBeGreaterThanOrEqual(50);
    // Sanity: every entry is a strict YYYY-MM-DD string.
    for (const d of cfg.holidays) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('holidays key omitted returns the auto-computed federal list only', () => {
    const cfg = loadStaleCheckConfig('max_age_days: 30\n');
    expect(cfg.holidays.length).toBeGreaterThanOrEqual(50);
    // Sanity: every entry is a strict YYYY-MM-DD string.
    for (const d of cfg.holidays) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('YAML holidays duplicate of an auto-computed federal date is silently deduped', () => {
    // 2026-12-25 (Christmas Fri) is in the auto-computed federal list. Listing
    // it explicitly in YAML must NOT produce a duplicate in the merged result.
    const cfg = loadStaleCheckConfig('holidays:\n  - 2026-12-25\n');
    const christmasCount = cfg.holidays.filter((d) => d === '2026-12-25').length;
    expect(christmasCount).toBe(1);
  });

  it('merged result is sorted ascending and deduplicated', () => {
    const cfg = loadStaleCheckConfig(
      ['holidays:', '  - 2026-12-31', '  - 2026-12-24', '  - 2026-12-25', ''].join('\n'),
    );
    // Sorted ascending.
    expect([...cfg.holidays]).toEqual([...cfg.holidays].slice().sort());
    // Deduped.
    expect(new Set(cfg.holidays).size).toBe(cfg.holidays.length);
  });
});

describe('loadStaleCheckConfig — negative cases (HARD-FAIL on schema violations)', () => {
  it('throws when holidays is not an array', () => {
    expect(() => loadStaleCheckConfig('holidays: not-an-array\n')).toThrow(
      /stale-check\.yml schema:.*holidays/,
    );
  });

  it('throws when a holiday entry is not a string (nested map)', () => {
    expect(() => loadStaleCheckConfig('holidays:\n  - foo: bar\n')).toThrow(
      /stale-check\.yml schema/,
    );
  });

  it('throws when a holiday entry does not match strict ISO-8601 regex', () => {
    expect(() => loadStaleCheckConfig('holidays:\n  - "2026-5-8"\n')).toThrow(
      /stale-check\.yml schema/,
    );
    expect(() => loadStaleCheckConfig('holidays:\n  - "2026/05/08"\n')).toThrow(
      /stale-check\.yml schema/,
    );
    expect(() => loadStaleCheckConfig('holidays:\n  - "5/8/2026"\n')).toThrow(
      /stale-check\.yml schema/,
    );
  });

  it('throws when max_age_days is negative', () => {
    expect(() => loadStaleCheckConfig('max_age_days: -1\n')).toThrow(
      /stale-check\.yml schema.*max_age_days/,
    );
  });

  it('throws when max_age_days is 0 (still must be positive)', () => {
    expect(() => loadStaleCheckConfig('max_age_days: 0\n')).toThrow(
      /stale-check\.yml schema.*max_age_days.*positive integer/,
    );
  });
});

// === Plan 03.1-05 — ping_schedule_business_days schema migration =============
//
// The three v1 fields (stale_threshold_business_days, reping_interval_business_days,
// max_pings_per_pr) are REPLACED by a single ping_schedule_business_days array.
// Validators: array of non-negative integers, length 1..10, strictly monotonically
// increasing. Default when key absent: [5, 15, 20] (week 1 + week 3 + ~month 1).
// See .planning/phases/03.1-stale-pr-reminders/03.1-05-PLAN.md.

describe('loadStaleCheckConfig — ping_schedule_business_days validator (Plan 03.1-05 schema migration)', () => {
  it('ping_schedule_business_days absent → defaults to [5, 15, 20]', () => {
    const cfg = loadStaleCheckConfig('max_age_days: 30\n');
    expect([...cfg.pingScheduleBusinessDays]).toEqual([5, 15, 20]);
  });

  it('ping_schedule_business_days: [5, 15, 20] → returns the same array verbatim', () => {
    const cfg = loadStaleCheckConfig('ping_schedule_business_days: [5, 15, 20]\n');
    expect([...cfg.pingScheduleBusinessDays]).toEqual([5, 15, 20]);
  });

  it('ping_schedule_business_days: [0] → accepted (single-entry; first ping is final)', () => {
    const cfg = loadStaleCheckConfig('ping_schedule_business_days: [0]\n');
    expect([...cfg.pingScheduleBusinessDays]).toEqual([0]);
  });

  it('ping_schedule_business_days: [3] → accepted (single-entry; one ping only)', () => {
    const cfg = loadStaleCheckConfig('ping_schedule_business_days: [3]\n');
    expect([...cfg.pingScheduleBusinessDays]).toEqual([3]);
  });

  it('ping_schedule_business_days: [1..10] → accepted at length=10 boundary', () => {
    const cfg = loadStaleCheckConfig(
      'ping_schedule_business_days: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]\n',
    );
    expect([...cfg.pingScheduleBusinessDays]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('ping_schedule_business_days: [] → throws (length >= 1)', () => {
    expect(() => loadStaleCheckConfig('ping_schedule_business_days: []\n')).toThrow(
      /ping_schedule_business_days.*length >= 1/,
    );
  });

  it('ping_schedule_business_days length 11 → throws (length <= 10)', () => {
    expect(() =>
      loadStaleCheckConfig('ping_schedule_business_days: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]\n'),
    ).toThrow(/ping_schedule_business_days.*length <= 10/);
  });

  it('ping_schedule_business_days: "5" (string) → throws (must be an array)', () => {
    expect(() => loadStaleCheckConfig('ping_schedule_business_days: "5"\n')).toThrow(
      /ping_schedule_business_days.*must be an array/,
    );
  });

  it('ping_schedule_business_days: {a: 1} (object) → throws (must be an array)', () => {
    expect(() => loadStaleCheckConfig('ping_schedule_business_days:\n  a: 1\n')).toThrow(
      /ping_schedule_business_days.*must be an array/,
    );
  });

  it('ping_schedule_business_days: [5, 15, "20"] (string entry) → throws on entry[2]', () => {
    expect(() => loadStaleCheckConfig('ping_schedule_business_days: [5, 15, "20"]\n')).toThrow(
      /ping_schedule_business_days\[2\].*non-negative integer/,
    );
  });

  it('ping_schedule_business_days: [5, 15.5, 20] (float entry) → throws on entry[1]', () => {
    expect(() => loadStaleCheckConfig('ping_schedule_business_days: [5, 15.5, 20]\n')).toThrow(
      /ping_schedule_business_days\[1\].*non-negative integer/,
    );
  });

  it('ping_schedule_business_days: [5, .nan, 20] (NaN entry) → throws on entry[1]', () => {
    expect(() => loadStaleCheckConfig('ping_schedule_business_days: [5, .nan, 20]\n')).toThrow(
      /ping_schedule_business_days\[1\]/,
    );
  });

  it('ping_schedule_business_days: [-1] (negative) → throws on entry[0]', () => {
    expect(() => loadStaleCheckConfig('ping_schedule_business_days: [-1]\n')).toThrow(
      /ping_schedule_business_days\[0\].*non-negative integer/,
    );
  });

  it('ping_schedule_business_days: [5, 4] (decreasing) → throws strictly monotonic', () => {
    expect(() => loadStaleCheckConfig('ping_schedule_business_days: [5, 4]\n')).toThrow(
      /ping_schedule_business_days.*strictly monotonically increasing/,
    );
  });

  it('ping_schedule_business_days: [5, 5] (duplicate) → throws strictly monotonic', () => {
    expect(() => loadStaleCheckConfig('ping_schedule_business_days: [5, 5]\n')).toThrow(
      /ping_schedule_business_days.*strictly monotonically increasing/,
    );
  });

  it('ping_schedule_business_days: [5, 15, 10] (third decreases) → throws on entry[2] vs entry[1]', () => {
    expect(() => loadStaleCheckConfig('ping_schedule_business_days: [5, 15, 10]\n')).toThrow(
      /ping_schedule_business_days.*strictly monotonically increasing/,
    );
  });

  it('full-explicit YAML — ping_schedule_business_days + max_age_days + holidays → returns typed config', () => {
    const yaml = [
      'ping_schedule_business_days: [7, 14, 21]',
      'max_age_days: 45',
      'holidays:',
      '  - 2026-12-26',
      '',
    ].join('\n');
    const cfg = loadStaleCheckConfig(yaml);
    expect([...cfg.pingScheduleBusinessDays]).toEqual([7, 14, 21]);
    expect(cfg.maxAgeDays).toBe(45);
    expect(cfg.holidays).toContain('2026-12-26');
    // Auto-merged US-federal still present.
    expect(cfg.holidays).toContain('2026-12-25');
  });
});

describe('config/stale-check.yml on-disk schema (HARD-FAIL gate)', () => {
  it('parses cleanly via loadStaleCheckConfig (STALE-01)', () => {
    const yamlText = readFileSync(resolvePath(repoRoot, 'config/stale-check.yml'), 'utf-8');
    expect(() => loadStaleCheckConfig(yamlText)).not.toThrow();
  });

  it('returns the v1.1 pingScheduleBusinessDays default ([5, 15, 20]) after the schema migration', () => {
    const yamlText = readFileSync(resolvePath(repoRoot, 'config/stale-check.yml'), 'utf-8');
    const cfg = loadStaleCheckConfig(yamlText);
    expect([...cfg.pingScheduleBusinessDays]).toEqual([5, 15, 20]);
    expect(cfg.maxAgeDays).toBe(30);
    // Holidays remain auto-merged with US-federal (Plan 03.1-04 carry-forward).
    expect(cfg.holidays.length).toBeGreaterThanOrEqual(50);
    // Sanity: a known US-federal entry (Christmas 2026) is in the merged list.
    expect(cfg.holidays).toContain('2026-12-25');
  });

  it('returns the auto-computed US-federal holidays merged with any additive YAML entries (Plan 03.1-04)', () => {
    // After Plan 03.1-04, the on-disk YAML no longer carries a hard-coded
    // holiday array — US-federal holidays are auto-computed in code (5 years
    // ahead, self-extending). The on-disk `holidays:` array is now ADDITIVE
    // for company-specific dates (currently empty; admins append as needed).
    const yamlText = readFileSync(resolvePath(repoRoot, 'config/stale-check.yml'), 'utf-8');
    const cfg = loadStaleCheckConfig(yamlText);
    // 11 federal holidays × 6 years (baseYear + 5 inclusive) — expect ≥ 50.
    expect(cfg.holidays.length).toBeGreaterThanOrEqual(50);
    // Every entry is a strict YYYY-MM-DD string.
    for (const d of cfg.holidays) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // Deduplicated + sorted ascending.
    expect(new Set(cfg.holidays).size).toBe(cfg.holidays.length);
    expect([...cfg.holidays]).toEqual([...cfg.holidays].slice().sort());
  });
});
