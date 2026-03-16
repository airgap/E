/**
 * Text layer: syntax-colored text rendering with tab handling.
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

  for (const span of spans) {
    ctx.fillStyle = span.color;
    const chunk = text.slice(span.from, span.to);

    // Handle tabs: expand each tab to spaces up to next tab stop
    if (chunk.includes('\t')) {
      let col = computeColumn(text, span.from, tabSize);
      for (const ch of chunk) {
        if (ch === '\t') {
          const nextStop = tabSize - (col % tabSize);
          col += nextStop;
        } else {
          ctx.fillText(ch, textX + col * metrics.charWidth, y);
          col++;
        }
      }
    } else {
      // Fast path: no tabs in this span
      const col = computeColumn(text, span.from, tabSize);
      ctx.fillText(chunk, textX + col * metrics.charWidth, y);
    }
  }
}

/**
 * Compute the visual column at a given character offset,
 * accounting for tab expansion.
 */
function computeColumn(text: string, offset: number, tabSize: number): number {
  let col = 0;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 9) {
      // tab
      col += tabSize - (col % tabSize);
    } else {
      col++;
    }
  }
  return col;
}
