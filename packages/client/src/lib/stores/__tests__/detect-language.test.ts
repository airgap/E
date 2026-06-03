import { describe, test, expect } from 'vitest';
import { detectLanguage } from '../../utils/detect-language';

// Regression guard: opening Parabun files (and others) must resolve to the
// language keys that language-map.ts knows how to load, or the editor falls
// back to plain text with no syntax highlighting. This broke once because
// several components carried their own stale copies of detectLanguage that
// were missing the Parabun extensions — they now all import this one.
describe('detectLanguage', () => {
  test.each([
    ['Component.pui', 'pui'],
    ['mod.pts', 'parabun-ts'],
    ['mod.ptsx', 'parabun-tsx'],
    ['mod.pjs', 'parabun-js'],
    ['mod.pjsx', 'parabun-jsx'],
    ['a.ts', 'typescript'],
    ['a.tsx', 'typescript'],
    ['App.svelte', 'svelte'],
    ['main.rs', 'rust'],
    ['s.py', 'python'],
  ])('%s -> %s', (file, lang) => {
    expect(detectLanguage(file)).toBe(lang);
  });

  test('is case-insensitive on the extension', () => {
    expect(detectLanguage('Component.PUI')).toBe('pui');
    expect(detectLanguage('MOD.PTS')).toBe('parabun-ts');
  });

  test('unknown extensions fall back to plain text', () => {
    expect(detectLanguage('notes.xyz')).toBe('text');
  });
});
