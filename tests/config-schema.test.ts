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

  it('contains the D-12 sandbox seed entries: kai and dummy-reviewer', () => {
    const yamlText = readFileSync(resolvePath(repoRoot, 'config/users.yml'), 'utf-8');
    const map = loadUsersMap(yamlText);
    expect(map.users).toHaveProperty('kai');
    expect(map.users).toHaveProperty('dummy-reviewer');
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
