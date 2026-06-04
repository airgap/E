/**
 * fisheye.ts — degree-of-interest line scaling (LYK-1090 / LYK-1113).
 *
 * Scales each line's font-size by its distance from the cursor line: the line
 * you're on is largest, and lines fall off with distance. Because it changes
 * font-size (not transform), lines genuinely reflow — the editor stays fully
 * editable. Pairs with the CSS-perspective 3D editor (Editor3DView), where the
 * tilt adds depth and this adds focus.
 *
 * Enabled per-editor via the CodeEditor `fisheye` prop; off by default.
 */
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder, type Extension } from '@codemirror/state';

// Scale curve: cursor line a touch larger than base, falling to a floor.
function scaleFor(distance: number): number {
  return Math.max(0.5, 1.15 - distance * 0.055);
}

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const cursorLine = doc.lineAt(view.state.selection.main.head).number;
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      const s = scaleFor(Math.abs(line.number - cursorLine));
      builder.add(
        line.from,
        line.from,
        Decoration.line({ attributes: { style: `font-size:${s.toFixed(3)}em` } }),
      );
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      // Rebuild on edits, cursor moves, and scroll — but NOT geometryChanged,
      // which our own font-size changes trigger (that would loop).
      if (u.docChanged || u.selectionSet || u.viewportChanged) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const theme = EditorView.baseTheme({
  '.cm-line': { transition: 'font-size 90ms ease' },
});

export function fisheyeExtension(): Extension[] {
  return [plugin, theme];
}
