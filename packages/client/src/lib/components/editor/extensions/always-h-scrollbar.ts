/**
 * always-h-scrollbar.ts — keep the horizontal scrollbar always visible.
 *
 * CodeMirror sizes content to the widest currently-rendered line, so without
 * this the h-bar appears/disappears as long lines scroll in and out of view.
 * Forcing overflow-x:scroll pins it in place — stable position, no layout shift.
 * Trade-off: a (sometimes empty) h-bar is always at the bottom of the editor.
 */
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

export const alwaysHScrollbar: Extension = EditorView.baseTheme({
  '.cm-scroller': { overflowX: 'scroll' },
});
