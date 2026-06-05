/**
 * Covers the deprecated re-export wrapper at src/lib/config/hyperthemes.ts
 * by importing directly from it (the main test file imports from themes.ts).
 */
import { describe, test, expect } from 'vitest';
import {
  HYPERTHEMES,
  findHypertheme,
  getDefaultHypertheme,
  THEMES,
  findTheme,
  getDefaultTheme,
  getVisualStyle,
  isImmersiveTheme,
} from '../hyperthemes';
import type { ThemeConfig, HyperthemeConfig } from '../hyperthemes';

describe('hyperthemes re-export wrapper', () => {
  test('HYPERTHEMES re-exports immersive themes', () => {
    expect(Array.isArray(HYPERTHEMES)).toBe(true);
    expect(HYPERTHEMES.length).toBeGreaterThan(0);
  });

  test('findHypertheme works through re-export', () => {
    const theme = findHypertheme('arcane');
    expect(theme).toBeDefined();
    expect(theme!.id).toBe('arcane');
  });

  test('getDefaultHypertheme works through re-export', () => {
    expect(getDefaultHypertheme().id).toBe('dark');
  });

  test('THEMES re-exports all themes', () => {
    expect(THEMES.length).toBeGreaterThan(0);
  });

  test('findTheme works through re-export', () => {
    expect(findTheme('dark')!.id).toBe('dark');
  });

  test('getDefaultTheme works through re-export', () => {
    expect(getDefaultTheme().id).toBe('dark');
  });

  test('getVisualStyle works through re-export', () => {
    expect(getVisualStyle('dark')).toBe('tech');
  });

  test('isImmersiveTheme works through re-export', () => {
    expect(isImmersiveTheme('arcane')).toBe(true);
    expect(isImmersiveTheme('dark')).toBe(false);
  });
});
