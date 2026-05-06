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
