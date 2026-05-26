/**
 * stable-hscroll.ts — keep the horizontal scroll extent stable across vertical
 * scroll.
 *
 * CodeMirror sizes the content to the widest line it has CURRENTLY RENDERED, so
 * as a long line scrolls out of view the content shrinks and the horizontal
 * scrollbar disappears/reappears depending on vertical position. We floor the
 * content's min-width to the WHOLE document's widest line, so the horizontal
 * extent reflects the file, not the viewport — the scrollbar is then present iff
 * the file actually has a line wider than the editor.
 */
import { ViewPlugin, EditorView, type ViewUpdate } from '@codemirror/view';
import { type Text, type Extension } from '@codemirror/state';

/**
 * Longest line length (in chars) across `doc`. Returns -1 when the doc exceeds
 * `cap` lines (caller skips — a full scan per keystroke would be too costly).
 * Pure + tested. (Char count is a monospace-accurate proxy for width.)
 */
export function maxLineLength(doc: Text, cap = 20000): number {
  if (doc.lines > cap) return -1;
  let max = 0;
  for (const line of doc.iterLines()) {
    if (line.length > max) max = line.length;
  }
  return max;
}

export function stableHScrollExtension(): Extension {
  return ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        this.apply(view);
      }
      update(u: ViewUpdate) {
        // docChanged: line widths changed. geometryChanged: char width/font changed.
        if (u.docChanged || u.geometryChanged) this.apply(u.view);
      }
      apply(view: EditorView) {
        const max = maxLineLength(view.state.doc);
        const cw = view.defaultCharacterWidth;
        if (max <= 0 || cw <= 0) {
          view.contentDOM.style.minWidth = '';
          return;
        }
        // +1 char of slack so the final glyph isn't clipped at the scroll end.
        view.contentDOM.style.minWidth = `${Math.ceil((max + 1) * cw)}px`;
      }
      destroy() {
        // contentDOM is torn down by the view; nothing to clean up.
      }
    },
  );
}
