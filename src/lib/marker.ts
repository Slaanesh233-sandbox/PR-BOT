// Marker module — the durable per-PR Slack thread_ts state surface.
//
// D-02: marker format is `<!-- pr-bot:thread_ts=<TS> -->`. <TS> is treated as
//   STRING end-to-end. NEVER use float coercion (parseF***t / Number / +ts) —
//   Slack thread_ts values like '1700000000.000100' lose the trailing zero(s)
//   under float and the thread can no longer be re-located.
// FND-06: parse(serialize(ts)) === ts (string equality) for ts strings with
//   significant trailing zeros. Asserted by tests/marker.test.ts.
// T-01-12: enforced via the plan's CI grep that asserts no float-coercion
//   call site exists in this file.

import type { ThreadTs } from './types.js';

/**
 * Matches `<!-- pr-bot:thread_ts=<TS> -->` (with optional surrounding whitespace
 * inside the comment). The non-greedy `\S+?` capture group is the `ts`. Designed
 * to be safe to call twice (no `g` flag) — `parse` returns first match; `inject`
 * uses `replace` which only touches the first match without `g`.
 */
export const MARKER_REGEX = /<!--\s*pr-bot:thread_ts=(\S+?)\s*-->/;

/**
 * Extract the embedded `thread_ts` from a PR body. Returns `null` if no marker
 * is present. If the body contains multiple markers, returns the FIRST one.
 *
 * The capture group is returned as-is — no numeric coercion (D-02 / FND-06).
 */
export function parse(body: string): ThreadTs | null {
  const m = body.match(MARKER_REGEX);
  return m && m[1] !== undefined ? m[1] : null;
}

/**
 * Render a marker comment for a given `ts`. Output shape is exactly:
 *   `<!-- pr-bot:thread_ts=${ts} -->`
 * No leading or trailing whitespace; the surrounding markdown context decides spacing.
 */
export function serialize(ts: ThreadTs): string {
  return `<!-- pr-bot:thread_ts=${ts} -->`;
}

/**
 * Idempotent marker write:
 *   - If `body` already contains a marker for the SAME `ts` → returns `body` unchanged.
 *   - If `body` contains a marker for a DIFFERENT `ts` → replaces in place.
 *   - Otherwise → appends `\n\n${serialize(ts)}` (preserving existing content + spacing).
 *
 * The "same ts is a no-op" branch matters for OPEN-06 (idempotency on retry / re-run).
 */
export function inject(body: string, ts: ThreadTs): string {
  if (MARKER_REGEX.test(body)) {
    const existing = parse(body);
    if (existing === ts) return body;
    return body.replace(MARKER_REGEX, serialize(ts));
  }
  // Append, separated from existing body by a blank line. Empty bodies get the marker alone.
  if (body.length === 0) return serialize(ts);
  const sep = body.endsWith('\n\n') ? '' : body.endsWith('\n') ? '\n' : '\n\n';
  return `${body}${sep}${serialize(ts)}`;
}

/**
 * Remove any pr-bot:thread_ts marker from `body` and tidy up consecutive blank
 * lines that the removal may have left behind. Trailing whitespace is trimmed.
 */
export function strip(body: string): string {
  if (!MARKER_REGEX.test(body)) return body;
  return body
    .replace(MARKER_REGEX, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}
