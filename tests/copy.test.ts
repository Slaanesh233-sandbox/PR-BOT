// Tests for src/lib/copy.ts.
//
// D-06: comment-count grammar special-cases the singular form:
//   N=1 → 'commented'  (NOT the awkward 'published 1 comments')
//   N>1 → 'published N comments'
// N≤0 is invalid; we throw RangeError to fail loudly rather than emit empty copy.
//
// REVIEW_VERDICT lookup table provides emoji + verb for each review state.

import { describe, expect, it } from 'vitest';

import { REVIEW_VERDICT, commentGrammar } from '../src/lib/copy.js';

describe('commentGrammar', () => {
  it("returns 'commented' for the singular case (N=1) — D-06 special case", () => {
    expect(commentGrammar(1)).toBe('commented');
  });

  it("returns 'published 2 comments' for N=2", () => {
    expect(commentGrammar(2)).toBe('published 2 comments');
  });

  it("returns 'published 5 comments' for N=5", () => {
    expect(commentGrammar(5)).toBe('published 5 comments');
  });

  it('throws RangeError for N=0 (invalid input per D-06)', () => {
    expect(() => commentGrammar(0)).toThrow(RangeError);
  });

  it('throws RangeError for negative or non-integer N', () => {
    expect(() => commentGrammar(-1)).toThrow(RangeError);
    expect(() => commentGrammar(1.5)).toThrow(RangeError);
    expect(() => commentGrammar(Number.NaN)).toThrow(RangeError);
  });
});

describe('REVIEW_VERDICT', () => {
  it("approved: emoji ':white_check_mark:', verb 'approved'", () => {
    expect(REVIEW_VERDICT.approved.emoji).toBe(':white_check_mark:');
    expect(REVIEW_VERDICT.approved.verb).toBe('approved');
  });

  it("changes_requested: emoji ':warning:', verb 'requested changes'", () => {
    expect(REVIEW_VERDICT.changes_requested.emoji).toBe(':warning:');
    expect(REVIEW_VERDICT.changes_requested.verb).toBe('requested changes');
  });

  it("commented: emoji ':speech_balloon:', verb 'commented'", () => {
    expect(REVIEW_VERDICT.commented.emoji).toBe(':speech_balloon:');
    expect(REVIEW_VERDICT.commented.verb).toBe('commented');
  });
});
