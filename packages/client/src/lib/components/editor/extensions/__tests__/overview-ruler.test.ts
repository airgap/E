import { describe, test, expect } from 'vitest';
import { severityRank, severityColor, overviewTop } from '../overview-ruler';

describe('severityRank', () => {
  test('orders error > warning > info > hint', () => {
    expect(severityRank('error')).toBeGreaterThan(severityRank('warning'));
    expect(severityRank('warning')).toBeGreaterThan(severityRank('info'));
    expect(severityRank('info')).toBeGreaterThan(severityRank('hint'));
  });
  test('unknown severity ranks lowest', () => {
    expect(severityRank('whatever')).toBe(0);
  });
});

describe('severityColor', () => {
  test('error is the danger token, unknown falls back to hint', () => {
    expect(severityColor('error')).toContain('--danger');
    expect(severityColor('nope')).toBe(severityColor('hint'));
  });
});

describe('overviewTop', () => {
  test('maps line fraction to strip height', () => {
    // line 50 of 100 on a 200px strip → ~ (49.5/100)*200 = 99
    expect(overviewTop(50, 100, 200)).toBeCloseTo(99, 0);
  });
  test('first line near the top, last line near the bottom', () => {
    expect(overviewTop(1, 100, 200)).toBeLessThan(overviewTop(100, 100, 200));
    expect(overviewTop(1, 100, 200)).toBeLessThan(5);
  });
  test('clamps within [0, height - markH]', () => {
    expect(overviewTop(100, 100, 200)).toBeLessThanOrEqual(198);
    expect(overviewTop(100, 100, 200)).toBeGreaterThanOrEqual(0);
  });
  test('handles a zero/empty document without NaN', () => {
    expect(Number.isFinite(overviewTop(1, 0, 200))).toBe(true);
  });
});
