/**
 * Text layer: syntax-colored text rendering with tab handling.
 *
 * Each character is drawn at its independently computed column position
 * (col * charWidth) so spacing is always correct regardless of font
 * rounding or loading state.
 */

import type { EditorState } from '@codemirror/state';
import type { LineLayout } from '../core/layout';
import type { FontMetrics } from '../core/font-metrics';
import { getLineColors } from '../core/syntax-colors';

/**
 * Draw a single line of syntax-highlighted text.
 * Called inside the per-line save/restore + transform block.
 * `textX` is the x offset where text begins (after gutter).
 */
export function drawLineText(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  line: LineLayout,
  metrics: FontMetrics,
  textX: number,
  defaultColor: string,
  tabSize: number,
): void {
  if (line.text.length === 0) return;

  const spans = getLineColors(state, line.docFrom, line.docTo, defaultColor);
  const y = line.y + metrics.baseline;
  const text = line.text;
  const cw = metrics.charWidth;

  // Build a column→color map, then draw contiguous same-color runs
  // character by character at exact column positions.

  // First pass: compute visual column for each character offset
  const len = text.length;
  const cols = new Float64Array(len + 1);
  let col = 0;
  for (let i = 0; i < len; i++) {
    cols[i] = col;
    if (text.charCodeAt(i) === 9) {
      col += tabSize - (col % tabSize);
    } else {
      col++;
    }
  }
  cols[len] = col;

  // Second pass: draw each span character by character
  for (const span of spans) {
    ctx.fillStyle = span.color;
    for (let i = span.from; i < span.to; i++) {
      const ch = text.charCodeAt(i);
      if (ch === 9 || ch === 32) continue; // skip tabs and spaces (invisible)
      ctx.fillText(text[i], textX + cols[i] * cw, y);
    }
  }
}
