// Blocks module — Block Kit builders for the OPEN-04 root message and thread replies.
//
// OPEN-04 root format (revised 2026-05-06):
//   With NO reviewers:    `<repo>: <author-mention> has raised a <link|PR>.`
//   With reviewers:       `<repo>: <author-mention> has raised a <link|PR>. cc <r1> <r2> …`
//
// PR title and branch refs are intentionally NOT part of the message (FLT-06(a)). The code
// structure prevents leaking them: the input args type omits the title field and both branch
// fields, so even a future careless caller cannot pipe those values through this builder. The
// allowlist on the args type below is exhaustive.
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
 * Result shape: `{ blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] }`.
 *
 * Note that no PR-title or branch-ref input is accepted by this function — see FLT-06(a).
 * The only fields that can reach Slack via this builder are `repoShortName`, `prHtmlUrl`,
 * and the `text` strings on the supplied `ResolvedMention`s.
 */
export function buildRootMessage(args: BuildRootArgs): { blocks: readonly unknown[] } {
  const link = `<${args.prHtmlUrl}|PR>`;
  let raw = `${args.repoShortName}: ${args.authorMention.text} has raised a ${link}.`;
  if (args.reviewerMentions.length > 0) {
    const cc = args.reviewerMentions.map((m) => m.text).join(' ');
    raw += ` cc ${cc}`;
  }
  return {
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: capSectionText(raw) } }],
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
 * to render strikethrough across the <link|PR> and the user mentions
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
  const link = `<${args.prHtmlUrl}|PR>`;
  let raw = `${args.repoShortName}: ${args.authorMention.text} has raised a ${link}.`;
  if (args.reviewerMentions.length > 0) {
    const cc = args.reviewerMentions.map((m) => m.text).join(' ');
    raw += ` cc ${cc}`;
  }
  const struck = `~${raw}~`;
  const capped = capSectionText(struck);
  return {
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: capped } }],
    text: capped,
  };
}
