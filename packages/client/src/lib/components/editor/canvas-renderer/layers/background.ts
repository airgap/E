/**
 * Background layer: active line highlight + selection rectangles.
 */

import type { EditorView } from '@codemirror/view';
import type { LineLayout } from '../core/layout';
import type { FontMetrics } from '../core/font-metrics';
import { computeVisualColumn } from './cursor';

/**
 * Draw active line highlight and selection rectangles for a single line.
 * Called inside the per-line save/restore + transform block.
 *
 * `textX` is the x offset where text begins (after gutter).
 * `tabSize` is needed for visual column computation (tabs).
 */
export function drawLineBackground(
  ctx: CanvasRenderingContext2D,
  view: EditorView,
  line: LineLayout,
  metrics: FontMetrics,
  canvasW: number,
  textX: number,
  tabSize: number,
  activeLineColor: string,
  selectionColor: string,
): void {
  const state = view.state;

  // Active line highlight (for primary cursor line when no selection)
  const mainSel = state.selection.main;
  const cursorLine = state.doc.lineAt(mainSel.head).number;
  if (line.lineNumber === cursorLine && mainSel.empty) {
    ctx.fillStyle = activeLineColor;
    ctx.fillRect(0, line.y, canvasW, line.height);
  }

  // Selection rectangles — draw for ALL selection ranges (multi-cursor)
  for (const sel of state.selection.ranges) {
    if (sel.empty) continue;

    const selFrom = Math.max(sel.from, line.docFrom);
    const selTo = Math.min(sel.to, line.docTo);

    if (selFrom < selTo) {
      const startVisCol = computeVisualColumn(line.text, selFrom - line.docFrom, tabSize);
      const endVisCol = computeVisualColumn(line.text, selTo - line.docFrom, tabSize);
      const x = textX + startVisCol * metrics.charWidth;
      const w = (endVisCol - startVisCol) * metrics.charWidth;
      ctx.fillStyle = selectionColor;
      ctx.fillRect(x, line.y, w, line.height);
    }

    // If selection spans past this line's end (multi-line selection),
    // highlight from end of text to edge of visible area
    if (sel.to > line.docTo && sel.from <= line.docTo) {
      const startOffset = Math.max(0, sel.from - line.docFrom);
      const lineLen = line.docTo - line.docFrom;
      const visCol = computeVisualColumn(line.text, Math.max(startOffset, lineLen), tabSize);
      const x = textX + visCol * metrics.charWidth;
      ctx.fillStyle = selectionColor;
      ctx.fillRect(x, line.y, canvasW - x, line.height);
    }
  }
}
