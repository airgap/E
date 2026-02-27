import { describe, test, expect } from 'bun:test';
import { calculateCost, getModelPricing } from '../cost-calculator';

describe('getModelPricing', () => {
  test('returns correct pricing for opus', () => {
    const p = getModelPricing('claude-opus-4-6');
    expect(p).toEqual({ input: 15.0, output: 75.0 });
  });

  test('returns correct pricing for sonnet', () => {
    const p = getModelPricing('claude-sonnet-4-5-20250929');
    expect(p).toEqual({ input: 3.0, output: 15.0 });
  });

  test('returns correct pricing for haiku', () => {
    const p = getModelPricing('claude-haiku-4-5-20251001');
    expect(p).toEqual({ input: 0.8, output: 4.0 });
  });

  test('returns default pricing for unknown model', () => {
    const p = getModelPricing('unknown-model');
    expect(p).toEqual({ input: 3.0, output: 15.0 });
  });
});

describe('calculateCost', () => {
  test('calculates cost for opus', () => {
    const cost = calculateCost('claude-opus-4-6', 1_000_000, 1_000_000);
    expect(cost).toBe(15.0 + 75.0);
  });

  test('calculates cost for sonnet', () => {
    const cost = calculateCost('claude-sonnet-4-5-20250929', 1_000_000, 1_000_000);
    expect(cost).toBe(3.0 + 15.0);
  });

  test('calculates cost for haiku', () => {
    const cost = calculateCost('claude-haiku-4-5-20251001', 1_000_000, 1_000_000);
    expect(cost).toBe(0.8 + 4.0);
  });

  test('calculates proportional cost for smaller token counts', () => {
    // Sonnet: $3/M input, $15/M output
    // 500k input = (500000/1000000)*3 = 1.50
    // 100k output = (100000/1000000)*15 = 1.50
    const cost = calculateCost('claude-sonnet-4-5-20250929', 500_000, 100_000);
    expect(cost).toBeCloseTo(3.0, 5);
  });

  test('returns 0 for zero tokens', () => {
    expect(calculateCost('claude-opus-4-6', 0, 0)).toBe(0);
  });

  test('uses default pricing for unknown model', () => {
    const known = calculateCost('claude-sonnet-4-5-20250929', 100_000, 50_000);
    const unknown = calculateCost('some-future-model', 100_000, 50_000);
    expect(unknown).toBe(known);
  });
});
