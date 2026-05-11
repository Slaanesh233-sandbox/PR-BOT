// Marker module — the durable per-PR Slack thread_ts state surface.
//
// D-02: marker format is `<!-- pr-bot:thread_ts=<TS> -->`. <TS> is treated as
//   STRING end-to-end. NEVER use float coercion (parseF***t / Number / +ts) —
//   Slack thread_ts values like '1700000000.000100' lose the trailing zero(s)
//   under float and the thread can no longer be re-located.
// FND-06: parse(serialize(ts)) === ts (string equality) for ts strings with
//   significant trailing zeros. Asserted by tests/marker.test.ts.
// FLT-02: SILENT_MARKER + isSilent are exact-match (no regex, no case-fold) —
//   leniency creates ambiguity (Pitfall 17). Same prefix and trailing
//   space-dash-dash-gt closer as the thread_ts marker for visual consistency.
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

/**
 * FLT-02 silent-opt-out marker. Exact case-sensitive substring; no whitespace
 * tolerance, no regex (Pitfall 17 — leniency creates ambiguity). Matches D-02's
 * marker-shape convention (the `<!-- pr-bot:<token> -->` shape) — same prefix
 * and same trailing closer.
 */
export const SILENT_MARKER = '<!-- pr-bot:silent -->';

/**
 * Returns true if `body` contains the FLT-02 silent-opt-out marker. Exact
 * substring check, NOT regex — case-sensitive AND whitespace-strict by intent.
 */
export function isSilent(body: string): boolean {
  return body.includes(SILENT_MARKER);
}

// === Phase 3.1 — stale-PR marker shapes (parallel to Phase-1 thread_ts) =====
//
// Two new marker shapes ride on the same `<!-- pr-bot:<token>=<value> -->`
// convention as the Phase-1 thread_ts marker. Same idempotency invariants
// (D-02 / FND-06): values are STRINGS end-to-end; serialize/parse round-trip
// preserves byte equality; inject is idempotent on same value and
// replace-in-place on different.
//
//   - stale_pinged_at: ISO-8601 date (YYYY-MM-DD), no time / timezone. Keeps
//     the marker idempotent across runners (no DST footgun inside the marker
//     itself; the surrounding businessDaysBetween helper already handles DST
//     via UTC midnight interpretation).
//
//   - stale_ping_count: positive-integer STRING (e.g. '1', '2', '3'). The
//     dispatcher in Plan 03.1-02 parses this to an integer ONCE at the
//     comparison site against MAX_PINGS_PER_PR (via parseInt(., 10), with
//     NaN -> 0 fallback for paranoia). Inside this module the count is an
//     opaque text token — D-02 / FND-06 parity with thread_ts. No float
//     coercion anywhere in this file (the forbidden-coercion grep gate
//     enforces this on every CI run).
//
// FLT-02 / Pitfall 17 parity: regex matching is whitespace-tolerant inside
// the comment (same `\s*` pattern as MARKER_REGEX) but token-strict — the
// `stale_pinged_at` / `stale_ping_count` substrings are case-sensitive.

/**
 * Matches `<!-- pr-bot:stale_pinged_at=<DATE> -->` (with optional surrounding
 * whitespace inside the comment). Non-greedy `\S+?` capture; no `g` flag.
 */
export const STALE_PINGED_AT_REGEX = /<!--\s*pr-bot:stale_pinged_at=(\S+?)\s*-->/;

/**
 * Matches `<!-- pr-bot:stale_ping_count=<N> -->` (same shape). Non-greedy
 * `\S+?` capture; no `g` flag.
 */
export const STALE_PING_COUNT_REGEX = /<!--\s*pr-bot:stale_ping_count=(\S+?)\s*-->/;

/**
 * Anchored ISO-8601 date shape — same /^\d{4}-\d{2}-\d{2}$/ pattern used by
 * the holiday loader in src/lib/config-loader.ts (STALE_CHECK_ISO_DATE_REGEX).
 * WR-06 — parseStalePingedAt validates the captured value against this regex
 * and treats any non-conforming marker as if it were absent (returns null).
 * The captured value flows directly into businessDaysBetween arithmetic at
 * the stale-check call site; a non-ISO value would throw RangeError, and PR
 * bodies are human-editable.
 */
const STALE_PINGED_AT_VALUE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Extract the embedded `stale_pinged_at` ISO date. Returns `null` if absent
 * OR if the marker's value does not match the anchored YYYY-MM-DD shape.
 * A malformed value is silently treated as absent so the stale-check loop
 * does not abort on a bad PR-body edit.
 */
export function parseStalePingedAt(body: string): string | null {
  const m = body.match(STALE_PINGED_AT_REGEX);
  if (!m || m[1] === undefined) return null;
  if (!STALE_PINGED_AT_VALUE_SHAPE.test(m[1])) return null;
  return m[1];
}

/** Render a stale_pinged_at marker. Output: `<!-- pr-bot:stale_pinged_at=${date} -->`. */
export function serializeStalePingedAt(date: string): string {
  return `<!-- pr-bot:stale_pinged_at=${date} -->`;
}

/**
 * Idempotent marker write — same semantics as Phase-1 `inject`:
 *   - same value already present → return body unchanged
 *   - different value present    → replace in place
 *   - no marker present          → append with `\n\n` separator
 */
export function injectStalePingedAt(body: string, date: string): string {
  if (STALE_PINGED_AT_REGEX.test(body)) {
    const existing = parseStalePingedAt(body);
    if (existing === date) return body;
    return body.replace(STALE_PINGED_AT_REGEX, serializeStalePingedAt(date));
  }
  if (body.length === 0) return serializeStalePingedAt(date);
  const sep = body.endsWith('\n\n') ? '' : body.endsWith('\n') ? '\n' : '\n\n';
  return `${body}${sep}${serializeStalePingedAt(date)}`;
}

/** Extract the embedded `stale_ping_count` integer-string. Returns `null` if absent. */
export function parseStalePingCount(body: string): string | null {
  const m = body.match(STALE_PING_COUNT_REGEX);
  return m && m[1] !== undefined ? m[1] : null;
}

/** Render a stale_ping_count marker. Output: `<!-- pr-bot:stale_ping_count=${count} -->`. */
export function serializeStalePingCount(count: string): string {
  return `<!-- pr-bot:stale_ping_count=${count} -->`;
}

/** Idempotent marker write — same semantics as `injectStalePingedAt`. */
export function injectStalePingCount(body: string, count: string): string {
  if (STALE_PING_COUNT_REGEX.test(body)) {
    const existing = parseStalePingCount(body);
    if (existing === count) return body;
    return body.replace(STALE_PING_COUNT_REGEX, serializeStalePingCount(count));
  }
  if (body.length === 0) return serializeStalePingCount(count);
  const sep = body.endsWith('\n\n') ? '' : body.endsWith('\n') ? '\n' : '\n\n';
  return `${body}${sep}${serializeStalePingCount(count)}`;
}
