import { describe, test, expect, vi } from 'vitest';
import { uuid } from '../uuid';

describe('uuid', () => {
  test('returns a string', () => {
    const id = uuid();
    expect(typeof id).toBe('string');
  });

  test('returns a non-empty string', () => {
    const id = uuid();
    expect(id.length).toBeGreaterThan(0);
  });

  test('returns unique values on successive calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uuid()));
    expect(ids.size).toBe(100);
  });

  test('uses crypto.randomUUID when available', () => {
    const mockUUID = '12345678-1234-4123-8123-123456789abc';
    const spy = vi
      .spyOn(crypto, 'randomUUID')
      .mockReturnValue(mockUUID as `${string}-${string}-${string}-${string}-${string}`);
    const result = uuid();
    expect(result).toBe(mockUUID);
    spy.mockRestore();
  });

  test('falls back when crypto.randomUUID throws', () => {
    const spy = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('Secure context required');
    });
    const result = uuid();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // Should contain hyphens like a UUID-ish format
    expect(result).toContain('-');
    spy.mockRestore();
  });

  test('fallback format contains a version-4 marker', () => {
    const spy = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('Secure context required');
    });
    const result = uuid();
    // The fallback format includes a '4' in the version position (third segment starts with 4)
    const segments = result.split('-');
    expect(segments.length).toBeGreaterThanOrEqual(3);
    expect(segments[2][0]).toBe('4');
    spy.mockRestore();
  });
});
