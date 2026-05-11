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

describe('loadStaleCheckConfig — defaults + happy path (CONTEXT.md Implementation defaults)', () => {
  it('empty YAML body returns the four locked defaults + empty holidays', () => {
    const cfg = loadStaleCheckConfig('');
    expect(cfg.staleThresholdBusinessDays).toBe(3);
    expect(cfg.maxAgeDays).toBe(30);
    expect(cfg.repingIntervalBusinessDays).toBe(2);
    expect(cfg.maxPingsPerPr).toBe(3);
    expect(cfg.holidays).toEqual([]);
  });

  it('full-explicit YAML returns the parsed values verbatim', () => {
    const yaml = [
      'stale_threshold_business_days: 5',
      'max_age_days: 45',
      'reping_interval_business_days: 3',
      'max_pings_per_pr: 4',
      'holidays:',
      '  - 2026-12-25',
      '  - 2027-01-01',
      '',
    ].join('\n');
    const cfg = loadStaleCheckConfig(yaml);
    expect(cfg.staleThresholdBusinessDays).toBe(5);
    expect(cfg.maxAgeDays).toBe(45);
    expect(cfg.repingIntervalBusinessDays).toBe(3);
    expect(cfg.maxPingsPerPr).toBe(4);
    expect(cfg.holidays).toEqual(['2026-12-25', '2027-01-01']);
  });

  it('holidays key omitted returns empty holidays array', () => {
    const cfg = loadStaleCheckConfig('max_age_days: 30\n');
    expect(cfg.holidays).toEqual([]);
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

  it('throws when stale_threshold_business_days is 0 (must be positive)', () => {
    expect(() => loadStaleCheckConfig('stale_threshold_business_days: 0\n')).toThrow(
      /stale-check\.yml schema.*stale_threshold_business_days/,
    );
  });

  it('throws when stale_threshold_business_days is a string', () => {
    expect(() => loadStaleCheckConfig('stale_threshold_business_days: "3"\n')).toThrow(
      /stale-check\.yml schema/,
    );
  });

  it('throws when max_age_days is negative', () => {
    expect(() => loadStaleCheckConfig('max_age_days: -1\n')).toThrow(
      /stale-check\.yml schema.*max_age_days/,
    );
  });

  it('throws when max_pings_per_pr is a float (non-integer)', () => {
    expect(() => loadStaleCheckConfig('max_pings_per_pr: 3.5\n')).toThrow(
      /stale-check\.yml schema.*max_pings_per_pr/,
    );
  });
});

describe('config/stale-check.yml on-disk schema (HARD-FAIL gate)', () => {
  it('parses cleanly via loadStaleCheckConfig (STALE-01)', () => {
    const yamlText = readFileSync(resolvePath(repoRoot, 'config/stale-check.yml'), 'utf-8');
    expect(() => loadStaleCheckConfig(yamlText)).not.toThrow();
  });

  it('ships exactly the 12 US federal holidays from CONTEXT.md Decision 1', () => {
    const yamlText = readFileSync(resolvePath(repoRoot, 'config/stale-check.yml'), 'utf-8');
    const cfg = loadStaleCheckConfig(yamlText);
    expect(cfg.holidays).toHaveLength(12);
    // Spot-check a few known dates from the locked list.
    expect(cfg.holidays).toContain('2026-05-25'); // Memorial Day
    expect(cfg.holidays).toContain('2026-12-25'); // Christmas
    expect(cfg.holidays).toContain('2027-01-01'); // New Year's Day
    expect(cfg.holidays).toContain('2027-05-31'); // Memorial Day 2027
  });

  it('ships the four locked thresholds: 3 / 30 / 2 / 3', () => {
    const yamlText = readFileSync(resolvePath(repoRoot, 'config/stale-check.yml'), 'utf-8');
    const cfg = loadStaleCheckConfig(yamlText);
    expect(cfg.staleThresholdBusinessDays).toBe(3);
    expect(cfg.maxAgeDays).toBe(30);
    expect(cfg.repingIntervalBusinessDays).toBe(2);
    expect(cfg.maxPingsPerPr).toBe(3);
  });
});
