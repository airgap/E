import { describe, test, expect } from 'vitest';
import { fuzzyScore, fuzzyScoreFields } from '../fuzzy';

describe('fuzzyScore', () => {
  test('subsequence matches score positive, non-subsequence is -1', () => {
    expect(fuzzyScore('tf', 'Toggle Follow')).toBeGreaterThan(0);
    expect(fuzzyScore('zzz', 'Toggle Follow')).toBe(-1);
  });

  test('empty query scores 0 (matches everything)', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
  });

  test('is case-insensitive', () => {
    expect(fuzzyScore('NF', 'new file')).toBeGreaterThan(0);
  });

  test('consecutive + segment-start matches rank higher', () => {
    // "open" contiguous at a word start should beat a scattered match.
    const contiguous = fuzzyScore('open', 'Open File');
    const scattered = fuzzyScore('open', 'Organize Pending Entries Now');
    expect(contiguous).toBeGreaterThan(scattered);
  });

  test('segment-start bonus after / or .', () => {
    const atStart = fuzzyScore('main', 'src/main.ts');
    const midword = fuzzyScore('main', 'remaining.ts');
    expect(atStart).toBeGreaterThan(midword);
  });
});

describe('fuzzyScoreFields', () => {
  test('returns the best score across fields', () => {
    // matches the category, not the label
    expect(fuzzyScoreFields('git', 'Commit', 'Git')).toBeGreaterThan(0);
  });
  test('-1 when no field matches', () => {
    expect(fuzzyScoreFields('xyz', 'Commit', 'Git')).toBe(-1);
  });
});
