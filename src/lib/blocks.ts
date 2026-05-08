// Blocks module — Block Kit builders for the OPEN-04 root message and thread replies.
//
// OPEN-04 root format (locked spec 2026-05-08; supersedes the 2026-05-07 single-line
// phrasing — the colon-then-newline split makes the channel scan easier to parse:
// the repo header sits on its own line; the author + pr-link line reads like a one-line
// summary below it).
// Every emitted root post — whether the live OPEN-04 root or the STAT-02/STAT-03
// strikethrough rebuild — follows this template:
//
//   With NO reviewers:    `<repoUrl|repoShortName>:\n
//                          <author-mention> has published a <prHtmlUrl|pull request>.`
//   With reviewers:       same, plus ` cc <r1> <r2> …` after the trailing period
//                          (cc clause stays on the same line as the author/pr summary).
//
// Strikethrough form (STAT-02/STAT-03): Slack mrkdwn `~text~` strikethrough does NOT
// cross newline boundaries — `~A\nB~` would render literal tildes. So
// buildStrikethroughRoot splits on `\n` and wraps each line individually:
//   `~<repoUrl|repoShortName>:~\n~<author-mention> has published a <prHtmlUrl|pull request>.~`
// Each line gets its own `~ ... ~` wrap. handleReopen still rebuilds the un-struck form
// via buildRootMessage, so the same multi-line shape carries through both paths.
//
// Two Slack mrkdwn link forms appear in the output:
//   - Repo home link: built from `<args.repoUrl|args.repoShortName>` (repo home URL,
//     not branch / not tree).
//   - PR link: built from `<args.prHtmlUrl|pull request>` (the literal text "pull
//     request" is the user-visible click target — not a PR title, not a branch ref).
//
// Both are plain mrkdwn links (no `@` after `<`), so FLT-05's user-mention substring
// gate is unaffected by construction.
//
// PR title and branch refs are intentionally NOT part of the message (FLT-06(a)). The
// code structure prevents leaking them: the input args type omits the title field and
// both branch fields, so even a future careless caller cannot pipe those values through
// this builder. The allowlist on the args type below is exhaustive — `repoUrl` is a URL
// field structurally distinct from title/branch refs.
//
// FLT-04 ceiling: every section's text field caps at MAX_SECTION_TEXT_LENGTH = 3000 chars.
// Overflow truncates to ceiling-1 chars and appends a single-character ellipsis glyph.
//
// FLT-05 invariant: this module receives `ResolvedMention.text` strings (already-resolved
// by `mentions.ts`) and concatenates them as-is. It does NOT construct Slack mention
// syntax itself. Verified by the plan's grep gate against this file.
//
// D-20 / FLT-03 invariant: this module contains zero broadcast-mention tokens (no
// here/channel/everyone forms in any of the supported syntaxes). Plan 04 ships the
// CI gate; the comments here describe intent without using the literal tokens.

import type { ResolvedMention } from './types.js';

export const MAX_SECTION_TEXT_LENGTH = 3000;

const ELLIPSIS = '…';

/**
 * Cap section text at MAX_SECTION_TEXT_LENGTH, replacing the last character with a
 * single ellipsis glyph to make truncation visually apparent. Strings shorter than
 * the ceiling are returned unchanged.
 */
function capSectionText(raw: string): string {
  return raw.length > MAX_SECTION_TEXT_LENGTH
    ? raw.slice(0, MAX_SECTION_TEXT_LENGTH - 1) + ELLIPSIS
    : raw;
}

export interface BuildRootArgs {
  /** `event.repository.name` — short repo name, e.g. `my-pkg` (no owner prefix). Per OPEN-04. */
  readonly repoShortName: string;
  /**
   * Repo home URL — `https://github.com/{owner}/{repo}`. Used to render the leading
   * repo name as a Slack mrkdwn link. Must be the repo home URL, not a branch/tree
   * URL. (Locked spec 2026-05-07.)
   */
  readonly repoUrl: string;
  /** `pull_request.html_url` — the only PR field that flows into the message body. */
  readonly prHtmlUrl: string;
  /** Author mention, already resolved by `mentions.resolve`. */
  readonly authorMention: ResolvedMention;
  /** Requested-reviewer mentions, already resolved by `mentions.resolveAll` (order preserved). */
  readonly reviewerMentions: readonly ResolvedMention[];
}

/**
 * Build the OPEN-04 root message Block Kit payload.
 *
 * Result shape: `{ blocks, text }`. The `text` field is the un-wrapped mrkdwn-link
 * form of the section text — same composition as `buildStrikethroughRoot.text` but
 * WITHOUT the surrounding tildes. Both fields run through `capSectionText` so
 * FLT-04's 3000-char ceiling is enforced on either consumer (blocks-only or
 * blocks+text).
 *
 * Returning text alongside blocks is required by Change B 2026-05-07's handleReopen
 * dispatcher, which calls `chat.update({ ..., text, blocks })` (Pitfall 2: passing
 * text without blocks REPLACES the previous blocks with plain text). handleOpen
 * still uses only `.blocks` and is unaffected by the widening.
 *
 * Note that no PR-title or branch-ref input is accepted by this function — see FLT-06(a).
 * The only fields that can reach Slack via this builder are `repoShortName`, `repoUrl`,
 * `prHtmlUrl`, and the `text` strings on the supplied `ResolvedMention`s.
 */
export function buildRootMessage(args: BuildRootArgs): {
  readonly blocks: readonly unknown[];
  readonly text: string;
} {
  const repoLink = `<${args.repoUrl}|${args.repoShortName}>`;
  const prLink = `<${args.prHtmlUrl}|pull request>`;
  let raw = `${repoLink}:\n${args.authorMention.text} has published a ${prLink}.`;
  if (args.reviewerMentions.length > 0) {
    const cc = args.reviewerMentions.map((m) => m.text).join(' ');
    raw += ` cc ${cc}`;
  }
  const capped = capSectionText(raw);
  return {
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: capped } }],
    text: capped,
  };
}

export interface BuildReplyArgs {
  readonly text: string;
}

/**
 * Build a Block Kit thread-reply payload around an already-composed `text` string.
 * Truncates to MAX_SECTION_TEXT_LENGTH if necessary (FLT-04).
 */
export function buildThreadReply(args: BuildReplyArgs): { blocks: readonly unknown[] } {
  return {
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: capSectionText(args.text) } }],
  };
}

/**
 * STAT-02 / STAT-03 strikethrough rebuild of the OPEN-04 root message.
 *
 * Same typed args as buildRootMessage (FLT-06(a) — title and branch refs
 * structurally absent). Wraps the entire rendered text in single tildes (~...~)
 * to render strikethrough across both mrkdwn links and the user mentions
 * (Research §1b — A2 in Assumptions Log; Plan 03-03 captures the screenshot).
 *
 * Returns BOTH blocks AND text because chat.update needs both: providing text
 * without blocks REPLACES the previous blocks with plain text (Pitfall 2). The
 * handler dispatcher in Plan 03-02 calls
 *   slack.chat.update({ channel, ts: rootTs, blocks: r.blocks, text: r.text }).
 *
 * Both fields run through capSectionText so FLT-04 still applies after the wrap.
 */
export function buildStrikethroughRoot(args: BuildRootArgs): {
  readonly blocks: readonly unknown[];
  readonly text: string;
} {
  const repoLink = `<${args.repoUrl}|${args.repoShortName}>`;
  const prLink = `<${args.prHtmlUrl}|pull request>`;
  let raw = `${repoLink}:\n${args.authorMention.text} has published a ${prLink}.`;
  if (args.reviewerMentions.length > 0) {
    const cc = args.reviewerMentions.map((m) => m.text).join(' ');
    raw += ` cc ${cc}`;
  }
  // Slack mrkdwn `~text~` strikethrough does NOT cross newlines; wrap each line
  // individually so both lines render with the strike applied.
  const struck = raw
    .split('\n')
    .map((line) => `~${line}~`)
    .join('\n');
  const capped = capSectionText(struck);
  return {
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: capped } }],
    text: capped,
  };
}
