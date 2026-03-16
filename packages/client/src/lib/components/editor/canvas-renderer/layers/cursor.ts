/**
 * Cursor layer: blinking cursor rendering.
 */

import type { EditorView } from '@codemirror/view';
import type { FontMetrics } from '../core/font-metrics';

const BLINK_INTERVAL = 530; // ms per half-cycle (matches typical editor blink)

/** Track blink state across frames. */
export class CursorBlinker {
  private lastToggle = 0;
  private visible = true;
  private lastHead = -1;

  /** Call each frame. Returns whether the cursor should be drawn. */
  isVisible(now: number, cursorHead: number): boolean {
    // Reset blink on cursor movement
    if (cursorHead !== this.lastHead) {
      this.lastHead = cursorHead;
      this.visible = true;
      this.lastToggle = now;
      return true;
    }

    if (now - this.lastToggle >= BLINK_INTERVAL) {
      this.visible = !this.visible;
      this.lastToggle = now;
    }
    return this.visible;
  }
}

/**
 * Draw the cursor(s) for all selection ranges.
 * `textX` is the x offset where text begins (after gutter).
 * `tabSize` is used for column computation.
 */
export function drawCursors(
  ctx: CanvasRenderingContext2D,
  view: EditorView,
  metrics: FontMetrics,
  textX: number,
  scrollTop: number,
  tabSize: number,
  cursorColor: string,
  visible: boolean,
): void {
  if (!visible) return;

  const state = view.state;

  for (const range of state.selection.ranges) {
    const pos = range.head;
    const line = state.doc.lineAt(pos);
    const lineY = getLineY(view, line.number, scrollTop, metrics.lineHeight);
    if (lineY === null) continue;

    const col = computeVisualColumn(line.text, pos - line.from, tabSize);

    const x = textX + col * metrics.charWidth;
    const y = lineY;

    ctx.fillStyle = cursorColor;
    ctx.fillRect(x, y, 2, metrics.lineHeight);
  }
}

/** Get the Y position of a line (viewport-relative). */
function getLineY(
  view: EditorView,
  lineNumber: number,
  scrollTop: number,
  lineHeight: number,
): number | null {
  // Try to get from viewport blocks for accuracy
  const doc = view.state.doc;
  try {
    const line = doc.line(lineNumber);
    for (const block of view.viewportLineBlocks) {
      if (block.from <= line.from && block.to >= line.from) {
        return block.top - scrollTop;
      }
    }
  } catch {
    // fall through
  }
  // Estimate
  return (lineNumber - 1) * lineHeight - scrollTop;
}

/** Compute visual column accounting for tabs. */
function computeVisualColumn(text: string, offset: number, tabSize: number): number {
  let col = 0;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 9) {
      col += tabSize - (col % tabSize);
    } else {
      col++;
    }
  }
  return col;
}
