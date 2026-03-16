/**
 * Gutter layer: line numbers + gutter background strip.
 */

import type { EditorView } from '@codemirror/view';
import type { LineLayout } from '../core/layout';
import type { FontMetrics } from '../core/font-metrics';

/** Width of the gutter in pixels — derived from max line number width + padding. */
export function computeGutterWidth(totalLines: number, metrics: FontMetrics): number {
  const digits = String(totalLines).length;
  // padding: 16px left, 12px right, plus digit width
  return 16 + digits * metrics.charWidth + 12;
}

/**
 * Draw the full-height gutter background (not scroll-transformed).
 * Call this once per frame before any per-line rendering.
 */
export function drawGutterBackground(
  ctx: CanvasRenderingContext2D,
  gutterW: number,
  canvasH: number,
  bgColor: string,
  borderColor: string,
): void {
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, gutterW, canvasH);
  // Right border
  ctx.fillStyle = borderColor;
  ctx.fillRect(gutterW - 1, 0, 1, canvasH);
}

/**
 * Draw a single line number.
 * Called inside the per-line save/restore + transform block.
 */
export function drawLineNumber(
  ctx: CanvasRenderingContext2D,
  view: EditorView,
  line: LineLayout,
  metrics: FontMetrics,
  gutterW: number,
  color: string,
  activeColor: string,
): void {
  const sel = view.state.selection.main;
  const cursorLine = view.state.doc.lineAt(sel.head).number;
  const isActive = line.lineNumber === cursorLine;

  ctx.fillStyle = isActive ? activeColor : color;
  const num = String(line.lineNumber);
  // Right-align in gutter: gutterW - rightPad - numWidth
  const x = gutterW - 12 - num.length * metrics.charWidth;
  ctx.fillText(num, x, line.y + metrics.baseline);
}
