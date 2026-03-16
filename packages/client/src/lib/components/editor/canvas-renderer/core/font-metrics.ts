/**
 * Font measurement cache for the canvas code renderer.
 * Reads font metrics from the CM6 EditorView's computed styles.
 */

import type { EditorView } from '@codemirror/view';

export interface FontMetrics {
  font: string;
  charWidth: number;
  lineHeight: number;
  baseline: number; // offset from top of line to text baseline
}

let cached: FontMetrics | null = null;
let cacheKey = '';

/**
 * Measure font metrics from the CM EditorView.
 * Cached — call `invalidateFontMetrics()` on theme/font change.
 */
export function measureFontMetrics(view: EditorView): FontMetrics {
  const style = getComputedStyle(view.contentDOM);
  const key = `${style.font}|${style.fontSize}|${style.lineHeight}`;
  if (cached && cacheKey === key) return cached;

  const font = style.font || '13px monospace';

  // Measure char width via canvas
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  const charWidth = ctx.measureText('M').width || 8;

  // Line height from CM's default (accounts for lineHeight: 1.6 in theme)
  const lineHeight = view.defaultLineHeight || 20;

  // Baseline is approximately 80% of line height for most monospace fonts
  // More precisely, (lineHeight - fontSize) / 2 + ascent
  const fontSize = parseFloat(style.fontSize) || 13;
  const baseline = (lineHeight - fontSize) / 2 + fontSize * 0.82;

  cached = { font, charWidth, lineHeight, baseline };
  cacheKey = key;
  return cached;
}

/** Invalidate the font metrics cache (call on theme/font changes). */
export function invalidateFontMetrics(): void {
  cached = null;
  cacheKey = '';
}
