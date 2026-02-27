import { describe, test, expect } from 'bun:test';
import { migrateVerbosity, VALID_VERBOSITY_VALUES, DEFAULT_COMMENTARY_SETTINGS } from '../projects';
import type { CommentaryVerbosity } from '../projects';

describe('migrateVerbosity', () => {
  test('maps "high" to "frequent"', () => {
    expect(migrateVerbosity('high')).toBe('frequent');
  });

  test('maps "medium" to "strategic"', () => {
    expect(migrateVerbosity('medium')).toBe('strategic');
  });

  test('maps "low" to "minimal"', () => {
    expect(migrateVerbosity('low')).toBe('minimal');
  });

  test('passes through "frequent" unchanged', () => {
    expect(migrateVerbosity('frequent')).toBe('frequent');
  });

  test('passes through "strategic" unchanged', () => {
    expect(migrateVerbosity('strategic')).toBe('strategic');
  });

  test('passes through "minimal" unchanged', () => {
    expect(migrateVerbosity('minimal')).toBe('minimal');
  });

  test('defaults to "strategic" for unknown values', () => {
    expect(migrateVerbosity('unknown')).toBe('strategic');
  });

  test('defaults to "strategic" for empty string', () => {
    expect(migrateVerbosity('')).toBe('strategic');
  });
});

describe('VALID_VERBOSITY_VALUES', () => {
  test('contains exactly three values', () => {
    expect(VALID_VERBOSITY_VALUES).toHaveLength(3);
  });

  test('contains frequent, strategic, and minimal', () => {
    expect(VALID_VERBOSITY_VALUES).toContain('frequent');
    expect(VALID_VERBOSITY_VALUES).toContain('strategic');
    expect(VALID_VERBOSITY_VALUES).toContain('minimal');
  });
});

describe('DEFAULT_COMMENTARY_SETTINGS', () => {
  test('has expected default values', () => {
    expect(DEFAULT_COMMENTARY_SETTINGS.enabled).toBe(true);
    expect(DEFAULT_COMMENTARY_SETTINGS.personality).toBe('technical_analyst');
    expect(DEFAULT_COMMENTARY_SETTINGS.verbosity).toBe('strategic');
  });
});
