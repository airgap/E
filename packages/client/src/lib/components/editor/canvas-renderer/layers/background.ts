/**
 * Background layer: active line highlight + selection rectangles.
 */

import type { EditorView } from '@codemirror/view';
import type { LineLayout } from '../core/layout';
import type { FontMetrics } from '../core/font-metrics';
import type { ScrollTransform } from '../core/scroll-effect';

/**
 * Draw active line highlight and selection rectangles for a single line.
 * Called inside the per-line save/restore + transform block.
 */
export function drawLineBackground(
  ctx: CanvasRenderingContext2D,
  view: EditorView,
  line: LineLayout,
  metrics: FontMetrics,
  canvasW: number,
  activeLineColor: string,
  selectionColor: string,
): void {
  const state = view.state;
  const sel = state.selection.main;

  // Active line highlight
  const cursorLine = state.doc.lineAt(sel.head).number;
  if (line.lineNumber === cursorLine && sel.empty) {
    ctx.fillStyle = activeLineColor;
    ctx.fillRect(0, line.y, canvasW, line.height);
  }

  // Selection rectangles
  if (!sel.empty) {
    const selFrom = Math.max(sel.from, line.docFrom);
    const selTo = Math.min(sel.to, line.docTo);
    if (selFrom < selTo) {
      const startCol = selFrom - line.docFrom;
      const endCol = selTo - line.docFrom;
      // Account for gutter width — selection starts at text area
      // We let the caller handle gutter offset via ctx transform
      const x = startCol * metrics.charWidth;
      const w = (endCol - startCol) * metrics.charWidth;
      ctx.fillStyle = selectionColor;
      ctx.fillRect(x, line.y, w, line.height);
    }
    // If selection spans past this line's end (multi-line selection),
    // highlight to end of visible area
    if (sel.to > line.docTo && sel.from <= line.docTo) {
      const startCol = Math.max(0, sel.from - line.docFrom);
      const lineLen = line.docTo - line.docFrom;
      const x = Math.max(startCol, lineLen) * metrics.charWidth;
      ctx.fillStyle = selectionColor;
      ctx.fillRect(x, line.y, canvasW - x, line.height);
    }
  }
}
