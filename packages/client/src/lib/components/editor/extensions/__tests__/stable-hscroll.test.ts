import { describe, test, expect } from 'vitest';
import { Text } from '@codemirror/state';
import { maxLineLength } from '../stable-hscroll';

describe('maxLineLength', () => {
  test('returns the longest line length in chars', () => {
    expect(maxLineLength(Text.of(['ab', 'cdef', 'x']))).toBe(4);
  });
  test('empty doc is 0', () => {
    expect(maxLineLength(Text.of(['']))).toBe(0);
  });
  test('ignores line count, measures width', () => {
    expect(maxLineLength(Text.of(['', '', 'longest-line', '']))).toBe('longest-line'.length);
  });
  test('returns -1 above the line cap (skip the scan)', () => {
    expect(maxLineLength(Text.of(Array(11).fill('x')), 10)).toBe(-1);
  });
});
