import { describe, test, expect } from 'vitest';
import { convertVsCodeTheme } from '../vscode-theme-converter';
import type { VsCodeThemeJson } from '../vscode-theme-converter';

describe('convertVsCodeTheme', () => {
  test('returns default values for empty theme json', () => {
    const result = convertVsCodeTheme({});
    expect(result.id).toBe('custom-imported-theme');
    expect(result.name).toBe('Imported Theme');
    expect(result.type).toBe('dark');
    expect(result.cssVars).toBeDefined();
  });

  test('uses theme name for id and display name', () => {
    const result = convertVsCodeTheme({ name: 'My Cool Theme' });
    expect(result.id).toBe('custom-my-cool-theme');
    expect(result.name).toBe('My Cool Theme');
  });

  test('slugifies name with special characters', () => {
    const result = convertVsCodeTheme({ name: 'Theme @ 2.0 (Beta!)' });
    expect(result.id).toBe('custom-theme-2-0-beta');
  });

  test('detects dark theme type', () => {
    const result = convertVsCodeTheme({ type: 'dark' });
    expect(result.type).toBe('dark');
  });

  test('detects light theme type', () => {
    const result = convertVsCodeTheme({ type: 'light' });
    expect(result.type).toBe('light');
  });

  test('defaults to dark when type is missing', () => {
    const result = convertVsCodeTheme({});
    expect(result.type).toBe('dark');
  });

  test('maps editor.background to --bg-code and --bg-primary', () => {
    const theme: VsCodeThemeJson = {
      colors: {
        'editor.background': '#1a1b26',
      },
    };
    const result = convertVsCodeTheme(theme);
    expect(result.cssVars['--bg-code']).toBe('#1a1b26');
    expect(result.cssVars['--bg-primary']).toBe('#1a1b26');
  });

  test('maps editor.foreground to --text-primary', () => {
    const theme: VsCodeThemeJson = {
      colors: {
        'editor.foreground': '#c0caf5',
      },
    };
    const result = convertVsCodeTheme(theme);
    expect(result.cssVars['--text-primary']).toBe('#c0caf5');
  });

  test('maps sideBar.background to --bg-secondary', () => {
    const theme: VsCodeThemeJson = {
      colors: {
        'sideBar.background': '#16161e',
      },
    };
    const result = convertVsCodeTheme(theme);
    expect(result.cssVars['--bg-secondary']).toBe('#16161e');
  });

  test('maps textLink.foreground to --text-link and --accent-primary', () => {
    const theme: VsCodeThemeJson = {
      colors: {
        'textLink.foreground': '#7aa2f7',
      },
    };
    const result = convertVsCodeTheme(theme);
    expect(result.cssVars['--text-link']).toBe('#7aa2f7');
    expect(result.cssVars['--accent-primary']).toBe('#7aa2f7');
  });

  test('maps token colors to syntax variables', () => {
    const theme: VsCodeThemeJson = {
      tokenColors: [
        {
          scope: 'keyword',
          settings: { foreground: '#bb9af7' },
        },
        {
          scope: 'string',
          settings: { foreground: '#9ece6a' },
        },
        {
          scope: 'constant.numeric',
          settings: { foreground: '#ff9e64' },
        },
        {
          scope: 'entity.name.function',
          settings: { foreground: '#7aa2f7' },
        },
        {
          scope: 'comment',
          settings: { foreground: '#565f89' },
        },
      ],
    };
    const result = convertVsCodeTheme(theme);
    expect(result.cssVars['--syn-keyword']).toBe('#bb9af7');
    expect(result.cssVars['--syn-string']).toBe('#9ece6a');
    expect(result.cssVars['--syn-number']).toBe('#ff9e64');
    expect(result.cssVars['--syn-function']).toBe('#7aa2f7');
    expect(result.cssVars['--syn-comment']).toBe('#565f89');
  });

  test('handles array scopes in token colors', () => {
    const theme: VsCodeThemeJson = {
      tokenColors: [
        {
          scope: ['keyword', 'storage.type'],
          settings: { foreground: '#c792ea' },
        },
      ],
    };
    const result = convertVsCodeTheme(theme);
    expect(result.cssVars['--syn-keyword']).toBe('#c792ea');
  });

  test('first matching scope wins for each syntax variable', () => {
    const theme: VsCodeThemeJson = {
      tokenColors: [
        {
          scope: 'keyword',
          settings: { foreground: '#ff0000' },
        },
        {
          scope: 'keyword.control',
          settings: { foreground: '#00ff00' },
        },
      ],
    };
    const result = convertVsCodeTheme(theme);
    // The first 'keyword' match should win
    expect(result.cssVars['--syn-keyword']).toBe('#ff0000');
  });

  test('skips token entries with no foreground', () => {
    const theme: VsCodeThemeJson = {
      tokenColors: [
        {
          scope: 'keyword',
          settings: { fontStyle: 'italic' },
        },
        {
          scope: 'keyword',
          settings: { foreground: '#bb9af7' },
        },
      ],
    };
    const result = convertVsCodeTheme(theme);
    expect(result.cssVars['--syn-keyword']).toBe('#bb9af7');
  });

  test('skips token entries with no scope', () => {
    const theme: VsCodeThemeJson = {
      tokenColors: [
        {
          settings: { foreground: '#ffffff' },
        },
      ],
    };
    const result = convertVsCodeTheme(theme);
    // Should not crash; no syntax vars assigned from scopeless entries
    expect(result.cssVars['--syn-keyword']).toBeUndefined();
  });

  test('generates fallback values for unmapped variables (dark theme)', () => {
    const theme: VsCodeThemeJson = {
      type: 'dark',
      colors: {
        'editor.background': '#1e1e1e',
        'editor.foreground': '#d4d4d4',
      },
    };
    const result = convertVsCodeTheme(theme);
    // Fallback vars should be generated
    expect(result.cssVars['--bg-tertiary']).toBeDefined();
    expect(result.cssVars['--bg-elevated']).toBeDefined();
    expect(result.cssVars['--bg-input']).toBeDefined();
    expect(result.cssVars['--bg-hover']).toBeDefined();
    expect(result.cssVars['--bg-active']).toBeDefined();
    expect(result.cssVars['--bg-selection']).toBeDefined();
    expect(result.cssVars['--border-primary']).toBeDefined();
    expect(result.cssVars['--border-focus']).toBeDefined();
    expect(result.cssVars['--text-secondary']).toBeDefined();
    expect(result.cssVars['--text-tertiary']).toBeDefined();
  });

  test('generates fallback values for light theme', () => {
    const theme: VsCodeThemeJson = {
      type: 'light',
      colors: {
        'editor.background': '#ffffff',
        'editor.foreground': '#333333',
      },
    };
    const result = convertVsCodeTheme(theme);
    expect(result.type).toBe('light');
    expect(result.cssVars['--bg-tertiary']).toBeDefined();
    expect(result.cssVars['--text-secondary']).toBeDefined();
  });

  test('does not overwrite explicitly mapped vars with fallbacks', () => {
    const theme: VsCodeThemeJson = {
      colors: {
        'editor.background': '#1e1e1e',
        'sideBar.background': '#252526',
        'editorGroupHeader.tabsBackground': '#2d2d2d',
      },
    };
    const result = convertVsCodeTheme(theme);
    // These were explicitly mapped, should not be overwritten
    expect(result.cssVars['--bg-secondary']).toBe('#252526');
    expect(result.cssVars['--bg-tertiary']).toBe('#2d2d2d');
  });

  test('fallback --border-focus uses --accent-primary if available', () => {
    const theme: VsCodeThemeJson = {
      colors: {
        'textLink.foreground': '#ff00ff',
      },
    };
    const result = convertVsCodeTheme(theme);
    expect(result.cssVars['--accent-primary']).toBe('#ff00ff');
    expect(result.cssVars['--border-focus']).toBe('#ff00ff');
  });

  test('returns valid hex colors in css vars', () => {
    const theme: VsCodeThemeJson = {
      type: 'dark',
      colors: {
        'editor.background': '#1a1b26',
        'editor.foreground': '#c0caf5',
      },
    };
    const result = convertVsCodeTheme(theme);
    // All generated fallback vars should be valid hex colors
    for (const [key, value] of Object.entries(result.cssVars)) {
      if (key.startsWith('--bg-') || key.startsWith('--text-') || key.startsWith('--border-')) {
        expect(value).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  test('handles a complete real-world theme', () => {
    const tokyoNight: VsCodeThemeJson = {
      name: 'Tokyo Night',
      type: 'dark',
      colors: {
        'editor.background': '#1a1b26',
        'editor.foreground': '#a9b1d6',
        'sideBar.background': '#16161e',
        'editorGroupHeader.tabsBackground': '#16161e',
        'panel.border': '#101014',
        'textLink.foreground': '#7aa2f7',
        'editorError.foreground': '#db4b4b',
        'editorWarning.foreground': '#e0af68',
        'terminal.ansiGreen': '#9ece6a',
      },
      tokenColors: [
        { scope: 'keyword', settings: { foreground: '#bb9af7' } },
        { scope: 'string', settings: { foreground: '#9ece6a' } },
        { scope: 'constant.numeric', settings: { foreground: '#ff9e64' } },
        { scope: 'entity.name.function', settings: { foreground: '#7aa2f7' } },
        { scope: 'comment', settings: { foreground: '#565f89' } },
        { scope: 'entity.name.type', settings: { foreground: '#2ac3de' } },
        { scope: 'variable', settings: { foreground: '#c0caf5' } },
      ],
    };
    const result = convertVsCodeTheme(tokyoNight);
    expect(result.id).toBe('custom-tokyo-night');
    expect(result.name).toBe('Tokyo Night');
    expect(result.type).toBe('dark');
    expect(result.cssVars['--bg-primary']).toBe('#1a1b26');
    expect(result.cssVars['--syn-keyword']).toBe('#bb9af7');
    expect(result.cssVars['--syn-string']).toBe('#9ece6a');
    expect(result.cssVars['--syn-function']).toBe('#7aa2f7');
    expect(result.cssVars['--accent-error']).toBe('#db4b4b');
    expect(result.cssVars['--accent-warning']).toBe('#e0af68');
  });
});
