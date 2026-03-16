/**
 * Line layout computation.
 *
 * For lines in CM's viewport: reads exact positions from `view.viewportLineBlocks`.
 * For lines outside (needed for 3D edge rendering): estimates using defaultLineHeight.
 */

import type { EditorView } from '@codemirror/view';

export interface LineLayout {
  lineNumber: number;
  docFrom: number;
  docTo: number;
  /** Y position relative to the scroller's visible area (scrollTop-adjusted). */
  y: number;
  height: number;
  text: string;
}

/**
 * Compute visible (and near-visible) line layouts for rendering.
 * Returns lines sorted by lineNumber.
 */
export function computeVisibleLines(view: EditorView, margin: number = 30): LineLayout[] {
  const doc = view.state.doc;
  const totalLines = doc.lines;
  const scrollTop = view.scrollDOM.scrollTop;
  const viewportH = view.scrollDOM.clientHeight;
  const lineH = view.defaultLineHeight || 20;

  // Build a map of line number → accurate position from CM's viewport blocks
  const blockMap = new Map<number, { y: number; height: number }>();
  for (const block of view.viewportLineBlocks) {
    try {
      const line = doc.lineAt(block.from);
      blockMap.set(line.number, {
        y: block.top - scrollTop,
        height: block.height,
      });
    } catch {
      // lineAt can throw for stale positions
    }
  }

  // Determine range of lines to render (generous margin for 3D edges)
  const firstEstimate = Math.floor(scrollTop / lineH) + 1;
  const lastEstimate = Math.ceil((scrollTop + viewportH) / lineH) + 1;
  const first = Math.max(1, firstEstimate - margin);
  const last = Math.min(totalLines, lastEstimate + margin);

  const lines: LineLayout[] = [];

  for (let i = first; i <= last; i++) {
    const docLine = doc.line(i);
    const block = blockMap.get(i);

    lines.push({
      lineNumber: i,
      docFrom: docLine.from,
      docTo: docLine.to,
      y: block ? block.y : (i - 1) * lineH - scrollTop,
      height: block ? block.height : lineH,
      text: docLine.text,
    });
  }

  return lines;
}
