/**
 * Cursor layer: blinking cursor rendering.
 *
 * `drawLineCursors` is called per-line inside the scroll-transform
 * block so cursors distort identically to text.
 */

import type { EditorView } from '@codemirror/view';
import type { LineLayout } from '../core/layout';
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
 * Draw cursors that fall on this line.
 * Called inside the per-line save/restore + transform block so the
 * cursor receives the same 3D scroll distortion as the text.
 */
export function drawLineCursors(
  ctx: CanvasRenderingContext2D,
  view: EditorView,
  line: LineLayout,
  metrics: FontMetrics,
  textX: number,
  tabSize: number,
  cursorColor: string,
  visible: boolean,
): void {
  if (!visible) return;

  const state = view.state;
  for (const range of state.selection.ranges) {
    const pos = range.head;
    // Cursor on this line? (head can be at docTo for end-of-line)
    if (pos < line.docFrom || pos > line.docTo) continue;

    const col = computeVisualColumn(line.text, pos - line.docFrom, tabSize);
    const x = textX + col * metrics.charWidth;

    ctx.fillStyle = cursorColor;
    ctx.fillRect(x, line.y, 2, line.height);
  }
}

/** Compute visual column accounting for tabs. */
export function computeVisualColumn(text: string, offset: number, tabSize: number): number {
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
