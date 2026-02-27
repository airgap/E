import { describe, test, expect } from 'vitest';
import {
  THEMES,
  findTheme,
  getDefaultTheme,
  getVisualStyle,
  isImmersiveTheme,
  // Backward compat re-exports
  HYPERTHEMES,
  findHypertheme,
  getDefaultHypertheme,
} from '../themes';
import type { ThemeConfig, HyperthemeConfig } from '../themes';

// ═══════════════════════════════════════════════════════════════════════════
// Unified THEMES array
// ═══════════════════════════════════════════════════════════════════════════

describe('THEMES', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(THEMES)).toBe(true);
    expect(THEMES.length).toBeGreaterThan(0);
  });

  test('all entries have required properties', () => {
    for (const t of THEMES) {
      expect(t.id).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.category).toMatch(/^(standard|immersive)$/);
      expect(t.type).toMatch(/^(dark|light)$/);
      expect(t.cssVars).toBeDefined();
      expect(typeof t.cssVars).toBe('object');
      expect(t.suggestedMonoFont).toBeTruthy();
      expect(t.suggestedSansFont).toBeTruthy();
    }
  });

  test('all ids are unique', () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('dark is the first entry (default)', () => {
    expect(THEMES[0].id).toBe('dark');
    expect(THEMES[0].category).toBe('standard');
  });

  test('standard themes come before immersive themes', () => {
    const categories = THEMES.map((t) => t.category);
    const lastStandard = categories.lastIndexOf('standard');
    const firstImmersive = categories.indexOf('immersive');
    expect(firstImmersive).toBeGreaterThan(lastStandard);
  });

  test('standard themes have no colorOverrides', () => {
    const standard = THEMES.filter((t) => t.category === 'standard');
    expect(standard.length).toBeGreaterThan(0);
    for (const t of standard) {
      expect(t.colorOverrides).toBeUndefined();
    }
  });

  test('immersive themes have colorOverrides', () => {
    const immersive = THEMES.filter((t) => t.category === 'immersive');
    expect(immersive.length).toBeGreaterThan(0);
    for (const t of immersive) {
      expect(t.colorOverrides).toBeDefined();
      expect(Object.keys(t.colorOverrides!).length).toBeGreaterThan(0);
    }
  });

  test('immersive themes have icons', () => {
    const immersive = THEMES.filter((t) => t.category === 'immersive');
    for (const t of immersive) {
      expect(t.icon).toBeTruthy();
    }
  });

  test('immersive themes have descriptions', () => {
    const immersive = THEMES.filter((t) => t.category === 'immersive');
    for (const t of immersive) {
      expect(t.description).toBeTruthy();
    }
  });

  test('contains known standard theme ids', () => {
    const ids = THEMES.map((t) => t.id);
    expect(ids).toContain('dark');
    expect(ids).toContain('light');
    expect(ids).toContain('monokai');
    expect(ids).toContain('dracula');
    expect(ids).toContain('nord');
  });

  test('contains known immersive theme ids', () => {
    const ids = THEMES.map((t) => t.id);
    expect(ids).toContain('arcane');
    expect(ids).toContain('ethereal');
    expect(ids).toContain('study');
    expect(ids).toContain('astral');
    expect(ids).toContain('astral-midnight');
    expect(ids).toContain('goth');
    expect(ids).toContain('magic-forest');
  });

  test('all cssVars keys start with --ht-', () => {
    for (const t of THEMES) {
      for (const key of Object.keys(t.cssVars)) {
        expect(key.startsWith('--ht-')).toBe(true);
      }
    }
  });

  test('all themes share the same set of cssVars keys', () => {
    const firstKeys = Object.keys(THEMES[0].cssVars).sort();
    for (const t of THEMES.slice(1)) {
      const keys = Object.keys(t.cssVars).sort();
      expect(keys).toEqual(firstKeys);
    }
  });

  test('colorOverrides keys start with -- (CSS custom property)', () => {
    for (const t of THEMES) {
      if (t.colorOverrides) {
        for (const key of Object.keys(t.colorOverrides)) {
          expect(key.startsWith('--')).toBe(true);
        }
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// findTheme
// ═══════════════════════════════════════════════════════════════════════════

describe('findTheme', () => {
  test('finds standard theme by id', () => {
    const theme = findTheme('dark');
    expect(theme).toBeDefined();
    expect(theme!.id).toBe('dark');
    expect(theme!.category).toBe('standard');
  });

  test('finds light theme', () => {
    const theme = findTheme('light');
    expect(theme).toBeDefined();
    expect(theme!.type).toBe('light');
  });

  test('finds immersive theme by id', () => {
    const theme = findTheme('arcane');
    expect(theme).toBeDefined();
    expect(theme!.id).toBe('arcane');
    expect(theme!.category).toBe('immersive');
  });

  test('finds study theme', () => {
    const theme = findTheme('study');
    expect(theme).toBeDefined();
    expect(theme!.id).toBe('study');
    expect(theme!.suggestedPersonality).toBe('wizard');
  });

  test('finds goth theme', () => {
    const theme = findTheme('goth');
    expect(theme).toBeDefined();
    expect(theme!.id).toBe('goth');
    expect(theme!.label).toBe('Redrum');
  });

  test('returns undefined for non-existent id', () => {
    expect(findTheme('nonexistent')).toBeUndefined();
  });

  test('returns undefined for empty string', () => {
    expect(findTheme('')).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getDefaultTheme
// ═══════════════════════════════════════════════════════════════════════════

describe('getDefaultTheme', () => {
  test('returns the dark theme', () => {
    const defaultTheme = getDefaultTheme();
    expect(defaultTheme.id).toBe('dark');
    expect(defaultTheme.label).toBe('Dark');
  });

  test('returns a complete ThemeConfig', () => {
    const defaultTheme = getDefaultTheme();
    expect(defaultTheme.id).toBeTruthy();
    expect(defaultTheme.label).toBeTruthy();
    expect(defaultTheme.category).toBe('standard');
    expect(defaultTheme.cssVars).toBeDefined();
    expect(defaultTheme.suggestedMonoFont).toBeTruthy();
    expect(defaultTheme.suggestedSansFont).toBeTruthy();
  });

  test('default theme has no colorOverrides', () => {
    const defaultTheme = getDefaultTheme();
    expect(defaultTheme.colorOverrides).toBeUndefined();
  });

  test('returns the same object as THEMES[0]', () => {
    expect(getDefaultTheme()).toBe(THEMES[0]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getVisualStyle
// ═══════════════════════════════════════════════════════════════════════════

describe('getVisualStyle', () => {
  test('standard themes return "tech"', () => {
    expect(getVisualStyle('dark')).toBe('tech');
    expect(getVisualStyle('light')).toBe('tech');
    expect(getVisualStyle('monokai')).toBe('tech');
    expect(getVisualStyle('dracula')).toBe('tech');
  });

  test('immersive themes return their own id', () => {
    expect(getVisualStyle('arcane')).toBe('arcane');
    expect(getVisualStyle('ethereal')).toBe('ethereal');
    expect(getVisualStyle('study')).toBe('study');
    expect(getVisualStyle('astral')).toBe('astral');
    expect(getVisualStyle('astral-midnight')).toBe('astral-midnight');
    expect(getVisualStyle('goth')).toBe('goth');
    expect(getVisualStyle('magic-forest')).toBe('magic-forest');
  });

  test('unknown themes return "tech"', () => {
    expect(getVisualStyle('nonexistent')).toBe('tech');
    expect(getVisualStyle('')).toBe('tech');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// isImmersiveTheme
// ═══════════════════════════════════════════════════════════════════════════

describe('isImmersiveTheme', () => {
  test('returns true for immersive themes', () => {
    expect(isImmersiveTheme('arcane')).toBe(true);
    expect(isImmersiveTheme('ethereal')).toBe(true);
    expect(isImmersiveTheme('study')).toBe(true);
    expect(isImmersiveTheme('astral')).toBe(true);
    expect(isImmersiveTheme('goth')).toBe(true);
    expect(isImmersiveTheme('magic-forest')).toBe(true);
  });

  test('returns false for standard themes', () => {
    expect(isImmersiveTheme('dark')).toBe(false);
    expect(isImmersiveTheme('light')).toBe(false);
    expect(isImmersiveTheme('monokai')).toBe(false);
  });

  test('returns false for unknown ids', () => {
    expect(isImmersiveTheme('nonexistent')).toBe(false);
    expect(isImmersiveTheme('')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Backward compatibility (deprecated exports)
// ═══════════════════════════════════════════════════════════════════════════

describe('backward compatibility', () => {
  test('HYPERTHEMES contains only immersive themes', () => {
    expect(Array.isArray(HYPERTHEMES)).toBe(true);
    expect(HYPERTHEMES.length).toBeGreaterThan(0);
    for (const ht of HYPERTHEMES) {
      expect(ht.category).toBe('immersive');
    }
  });

  test('HYPERTHEMES contains known immersive theme ids', () => {
    const ids = HYPERTHEMES.map((ht) => ht.id);
    expect(ids).toContain('arcane');
    expect(ids).toContain('ethereal');
    expect(ids).toContain('study');
    expect(ids).toContain('astral');
    expect(ids).toContain('astral-midnight');
    expect(ids).toContain('goth');
    expect(ids).toContain('magic-forest');
  });

  test('findHypertheme finds themes by id', () => {
    const theme = findHypertheme('arcane');
    expect(theme).toBeDefined();
    expect(theme!.id).toBe('arcane');
  });

  test('findHypertheme returns undefined for non-existent', () => {
    expect(findHypertheme('nonexistent')).toBeUndefined();
  });

  test('getDefaultHypertheme returns the default theme', () => {
    const defaultTheme = getDefaultHypertheme();
    expect(defaultTheme.id).toBe('dark');
  });

  test('HyperthemeConfig type is the same as ThemeConfig', () => {
    // TypeScript structural check — if this compiles, the types match
    const t: ThemeConfig = getDefaultTheme();
    const ht: HyperthemeConfig = t;
    expect(ht.id).toBe(t.id);
  });
});
