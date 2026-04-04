/**
 * CodeMirror extension for Parabun syntax highlighting.
 *
 * Adds decorations for Parabun-specific tokens that the standard JS/TS
 * Lezer grammar doesn't know about:
 *   - `pure` keyword (before function/async/arrow)
 *   - `..=`  await-assign
 *   - `..!`  catch operator
 *   - `..&`  finally operator
 *   - `|>`   pipeline operator
 */

import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';

// Matches `pure` when followed by function/async/(/identifier=>
// Also matches Parabun operators: ..= ..! ..& |>
const PARABUN_RE = /\b(pure)\s*(?=function\b|async\b|\(|\w+\s*=>)|\.\.(=|!|&)|\|>/g;

const pureMark = Decoration.mark({ class: 'cm-parabun-pure' });
const operatorMark = Decoration.mark({ class: 'cm-parabun-operator' });

function buildDecorations(view: EditorView): DecorationSet {
  const builder: { from: number; to: number; value: Decoration }[] = [];

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    PARABUN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;

    while ((m = PARABUN_RE.exec(text)) !== null) {
      const start = from + m.index;

      if (m[1] === 'pure') {
        // Only the word "pure" itself
        builder.push({ from: start, to: start + 4, value: pureMark });
      } else {
        // Operator match
        builder.push({ from: start, to: start + m[0].length, value: operatorMark });
      }
    }
  }

  // Decorations must be sorted by position
  builder.sort((a, b) => a.from - b.from);
  return Decoration.set(builder.map((d) => d.value.range(d.from, d.to)));
}

const parabunPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** Theme styles for Parabun tokens */
const parabunTheme = EditorView.baseTheme({
  '.cm-parabun-pure': {
    color: 'var(--syn-parabun-pure, var(--syn-keyword))',
    fontStyle: 'italic',
  },
  '.cm-parabun-operator': {
    color: 'var(--syn-parabun-operator, var(--syn-operator))',
    fontWeight: '600',
  },
});

/**
 * Returns CodeMirror extensions for Parabun syntax decoration.
 * Only apply to .pts / .pjs files (check language or filename before using).
 */
export function parabunSyntaxExtension() {
  return [parabunPlugin, parabunTheme];
}
