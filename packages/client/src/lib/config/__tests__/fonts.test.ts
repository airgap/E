import { describe, test, expect } from 'vitest';
import { MONO_FONTS, SANS_FONTS, buildGoogleFontsUrl, findFont } from '../fonts';
import type { FontOption } from '../fonts';

describe('MONO_FONTS', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(MONO_FONTS)).toBe(true);
    expect(MONO_FONTS.length).toBeGreaterThan(0);
  });

  test('every entry has required properties', () => {
    for (const font of MONO_FONTS) {
      expect(font.id).toBeTruthy();
      expect(font.label).toBeTruthy();
      expect(font.family).toBeTruthy();
      expect(font.category).toBe('mono');
    }
  });

  test('all ids are unique', () => {
    const ids = MONO_FONTS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('includes common coding fonts', () => {
    const ids = MONO_FONTS.map((f) => f.id);
    expect(ids).toContain('jetbrains-mono');
    expect(ids).toContain('fira-code');
    expect(ids).toContain('source-code-pro');
  });

  test('all families end with monospace fallback', () => {
    for (const font of MONO_FONTS) {
      expect(font.family).toContain('monospace');
    }
  });
});

describe('SANS_FONTS', () => {
  test('is a non-empty array', () => {
    expect(Array.isArray(SANS_FONTS)).toBe(true);
    expect(SANS_FONTS.length).toBeGreaterThan(0);
  });

  test('every entry has required properties', () => {
    for (const font of SANS_FONTS) {
      expect(font.id).toBeTruthy();
      expect(font.label).toBeTruthy();
      expect(font.family).toBeTruthy();
      expect(font.category).toBe('sans');
    }
  });

  test('all ids are unique', () => {
    const ids = SANS_FONTS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('includes Inter and Rajdhani', () => {
    const ids = SANS_FONTS.map((f) => f.id);
    expect(ids).toContain('inter');
    expect(ids).toContain('rajdhani');
  });

  test('no id collisions between mono and sans', () => {
    const monoIds = new Set(MONO_FONTS.map((f) => f.id));
    for (const font of SANS_FONTS) {
      expect(monoIds.has(font.id)).toBe(false);
    }
  });
});

describe('buildGoogleFontsUrl', () => {
  test('returns null when no fonts have googleFont', () => {
    const fonts: FontOption[] = [
      { id: 'test', label: 'Test', family: 'monospace', googleFont: null, category: 'mono' },
    ];
    expect(buildGoogleFontsUrl(fonts)).toBeNull();
  });

  test('returns null for empty array', () => {
    expect(buildGoogleFontsUrl([])).toBeNull();
  });

  test('builds URL for single font with googleFont', () => {
    const fonts: FontOption[] = [
      {
        id: 'jetbrains-mono',
        label: 'JetBrains Mono',
        family: "'JetBrains Mono', monospace",
        googleFont: 'JetBrains+Mono:wght@400;500;600;700',
        category: 'mono',
      },
    ];
    const url = buildGoogleFontsUrl(fonts);
    expect(url).toBe(
      'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap',
    );
  });

  test('builds URL for multiple fonts', () => {
    const fonts: FontOption[] = [
      {
        id: 'inter',
        label: 'Inter',
        family: "'Inter', sans-serif",
        googleFont: 'Inter:wght@400;500;600;700',
        category: 'sans',
      },
      {
        id: 'fira-code',
        label: 'Fira Code',
        family: "'Fira Code', monospace",
        googleFont: 'Fira+Code:wght@400;500;600;700',
        category: 'mono',
      },
    ];
    const url = buildGoogleFontsUrl(fonts);
    expect(url).toContain('family=Inter:wght@400;500;600;700');
    expect(url).toContain('family=Fira+Code:wght@400;500;600;700');
    expect(url).toContain('&display=swap');
  });

  test('filters out fonts without googleFont', () => {
    const fonts: FontOption[] = [
      {
        id: 'hack',
        label: 'Hack',
        family: "'Hack', monospace",
        googleFont: null,
        category: 'mono',
      },
      {
        id: 'inter',
        label: 'Inter',
        family: "'Inter', sans-serif",
        googleFont: 'Inter:wght@400;500;600;700',
        category: 'sans',
      },
    ];
    const url = buildGoogleFontsUrl(fonts);
    expect(url).not.toBeNull();
    expect(url).toContain('Inter');
    expect(url).not.toContain('Hack');
  });

  test('URL starts with Google Fonts base', () => {
    const url = buildGoogleFontsUrl(MONO_FONTS);
    if (url) {
      expect(url.startsWith('https://fonts.googleapis.com/css2?')).toBe(true);
    }
  });
});

describe('findFont', () => {
  test('finds a mono font by id', () => {
    const font = findFont('jetbrains-mono');
    expect(font).toBeDefined();
    expect(font!.id).toBe('jetbrains-mono');
    expect(font!.category).toBe('mono');
  });

  test('finds a sans font by id', () => {
    const font = findFont('inter');
    expect(font).toBeDefined();
    expect(font!.id).toBe('inter');
    expect(font!.category).toBe('sans');
  });

  test('returns undefined for non-existent id', () => {
    expect(findFont('nonexistent-font')).toBeUndefined();
  });

  test('returns undefined for empty string', () => {
    expect(findFont('')).toBeUndefined();
  });

  test('finds system-mono font', () => {
    const font = findFont('system-mono');
    expect(font).toBeDefined();
    expect(font!.googleFont).toBeNull();
  });

  test('finds system-sans font', () => {
    const font = findFont('system-sans');
    expect(font).toBeDefined();
    expect(font!.googleFont).toBeNull();
  });

  test('finds fonts with sizeAdjust', () => {
    const rajdhani = findFont('rajdhani');
    expect(rajdhani).toBeDefined();
    expect(rajdhani!.sizeAdjust).toBe(3);
  });
});
