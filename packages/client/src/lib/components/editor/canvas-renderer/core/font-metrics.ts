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
let fontLoadListenerAdded = false;

/**
 * Measure font metrics from the CM EditorView.
 * Cached — call `invalidateFontMetrics()` on theme/font change.
 */
export function measureFontMetrics(view: EditorView): FontMetrics {
  // Invalidate cache when web fonts finish loading
  if (!fontLoadListenerAdded && typeof document !== 'undefined') {
    fontLoadListenerAdded = true;
    document.fonts.ready.then(() => invalidateFontMetrics());
    document.fonts.addEventListener('loadingdone', () => invalidateFontMetrics());
  }

  const style = getComputedStyle(view.contentDOM);
  const key = `${style.font}|${style.fontSize}|${style.lineHeight}`;
  if (cached && cacheKey === key) return cached;

  const font = style.font || '13px monospace';

  // Measure char width via canvas — use a 10-char sample for accuracy
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  const charWidth = ctx.measureText('0000000000').width / 10 || 8;

  // Line height from CM's default (accounts for lineHeight: 1.6 in theme)
  const lineHeight = view.defaultLineHeight || 20;

  // Baseline: (lineHeight - fontSize) / 2 + ascent
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
