/**
 * Converts a VS Code theme JSON file to E CSS variable values.
 */

export interface VsCodeThemeJson {
  name?: string;
  type?: string;
  colors?: Record<string, string>;
  tokenColors?: Array<{
    scope?: string | string[];
    settings?: {
      foreground?: string;
      background?: string;
      fontStyle?: string;
    };
  }>;
}

export interface ConvertedTheme {
  id: string;
  name: string;
  type: 'dark' | 'light';
  cssVars: Record<string, string>;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Lighten a hex color by a fraction (0-1). */
function lighten(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(
    Math.min(255, Math.round(rgb.r + (255 - rgb.r) * amount)),
    Math.min(255, Math.round(rgb.g + (255 - rgb.g) * amount)),
    Math.min(255, Math.round(rgb.b + (255 - rgb.b) * amount)),
  );
}

/** Darken a hex color by a fraction (0-1). */
function darken(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return rgbToHex(
    Math.round(rgb.r * (1 - amount)),
    Math.round(rgb.g * (1 - amount)),
    Math.round(rgb.b * (1 - amount)),
  );
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Map VS Code `colors` keys to E CSS variables. */
const UI_COLOR_MAP: Record<string, string[]> = {
  'editor.background': ['--bg-code', '--bg-primary'],
  'editor.foreground': ['--text-primary'],
  'sideBar.background': ['--bg-secondary'],
  'editorGroupHeader.tabsBackground': ['--bg-tertiary'],
  'editorWidget.background': ['--bg-elevated'],
  'input.background': ['--bg-input'],
  'list.hoverBackground': ['--bg-hover'],
  'list.activeSelectionBackground': ['--bg-active'],
  'editor.selectionBackground': ['--bg-selection'],
  'panel.border': ['--border-primary'],
  focusBorder: ['--border-focus'],
  'editorLineNumber.foreground': ['--text-tertiary'],
  descriptionForeground: ['--text-secondary'],
  'textLink.foreground': ['--text-link', '--accent-primary'],
  'editorError.foreground': ['--accent-error'],
  'editorWarning.foreground': ['--accent-warning'],
  'terminal.ansiGreen': ['--accent-secondary'],
};

/**
 * Map VS Code tokenColors scopes to E `--syn-*` variables.
 * The first matching scope wins for each variable.
 */
const SCOPE_MAP: Array<{ patterns: string[]; cssVar: string }> = [
  { patterns: ['keyword', 'storage.type'], cssVar: '--syn-keyword' },
  { patterns: ['string'], cssVar: '--syn-string' },
  { patterns: ['constant.numeric'], cssVar: '--syn-number' },
  { patterns: ['entity.name.function'], cssVar: '--syn-function' },
  { patterns: ['comment'], cssVar: '--syn-comment' },
  { patterns: ['entity.name.type', 'support.type'], cssVar: '--syn-type' },
  { patterns: ['variable'], cssVar: '--syn-variable' },
  { patterns: ['keyword.operator'], cssVar: '--syn-operator' },
];

function matchesScope(tokenScope: string | string[], patterns: string[]): boolean {
  const scopes = Array.isArray(tokenScope) ? tokenScope : [tokenScope];
  return scopes.some((s) => patterns.some((p) => s === p || s.startsWith(p + '.')));
}

export function convertVsCodeTheme(json: VsCodeThemeJson): ConvertedTheme {
  const name = json.name || 'Imported Theme';
  const isDark = (json.type || 'dark') !== 'light';
  const cssVars: Record<string, string> = {};

  const colors = json.colors || {};

  // Map UI colors
  for (const [vsKey, eVars] of Object.entries(UI_COLOR_MAP)) {
    const value = colors[vsKey];
    if (value) {
      for (const v of eVars) {
        cssVars[v] = value;
      }
    }
  }

  // Map token colors (syntax highlighting)
  const tokenColors = json.tokenColors || [];
  const assignedSyntax = new Set<string>();

  for (const token of tokenColors) {
    if (!token.scope || !token.settings?.foreground) continue;
    for (const mapping of SCOPE_MAP) {
      if (assignedSyntax.has(mapping.cssVar)) continue;
      if (matchesScope(token.scope, mapping.patterns)) {
        cssVars[mapping.cssVar] = token.settings.foreground;
        assignedSyntax.add(mapping.cssVar);
      }
    }
  }

  // Generate fallback values for unmapped vars
  const bg = colors['editor.background'] || (isDark ? '#1e1e1e' : '#ffffff');
  const fg = colors['editor.foreground'] || (isDark ? '#d4d4d4' : '#333333');

  if (!cssVars['--bg-secondary'])
    cssVars['--bg-secondary'] = isDark ? darken(bg, 0.1) : darken(bg, 0.03);
  if (!cssVars['--bg-tertiary'])
    cssVars['--bg-tertiary'] = isDark ? lighten(bg, 0.08) : darken(bg, 0.06);
  if (!cssVars['--bg-elevated'])
    cssVars['--bg-elevated'] = isDark ? lighten(bg, 0.05) : lighten(bg, 0.02);
  if (!cssVars['--bg-input']) cssVars['--bg-input'] = isDark ? lighten(bg, 0.04) : darken(bg, 0.02);
  if (!cssVars['--bg-hover']) cssVars['--bg-hover'] = isDark ? lighten(bg, 0.08) : darken(bg, 0.05);
  if (!cssVars['--bg-active'])
    cssVars['--bg-active'] = isDark ? lighten(bg, 0.12) : darken(bg, 0.08);
  if (!cssVars['--bg-selection'])
    cssVars['--bg-selection'] = isDark ? lighten(bg, 0.15) : darken(bg, 0.1);
  if (!cssVars['--border-primary'])
    cssVars['--border-primary'] = isDark ? lighten(bg, 0.15) : darken(bg, 0.12);
  if (!cssVars['--border-focus'])
    cssVars['--border-focus'] = cssVars['--accent-primary'] || (isDark ? '#007acc' : '#005fcc');
  if (!cssVars['--text-primary']) cssVars['--text-primary'] = fg;
  if (!cssVars['--text-secondary'])
    cssVars['--text-secondary'] = isDark ? darken(fg, 0.3) : lighten(fg, 0.3);
  if (!cssVars['--text-tertiary'])
    cssVars['--text-tertiary'] = isDark ? darken(fg, 0.5) : lighten(fg, 0.5);

  return {
    id: `custom-${slugify(name)}`,
    name,
    type: isDark ? 'dark' : 'light',
    cssVars,
  };
}
