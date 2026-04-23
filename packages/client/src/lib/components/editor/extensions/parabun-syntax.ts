/**
 * CodeMirror extension for Parabun syntax highlighting.
 *
 * Adds decorations for Parabun-specific tokens that the standard JS/TS
 * Lezer grammar doesn't know about. The set mirrors
 * /raid/parabun/editors/vscode/parabun/syntaxes/*.tmLanguage.json and
 * /raid/parabun/editors/lsp/parabun-lsp.ts.
 *
 *   Keywords (kw):
 *     fun, pure, memo, signal, effect, arena, defer
 *
 *   Operators (op):
 *     ..=   await-assign / inclusive-range
 *     ..!   catch
 *     ..&   finally
 *     ..    exclusive-range  (must come after ..= / ..! / ..&)
 *     |>    pipeline
 *     ~>    reactive binding
 */

import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';

// Named alternatives — order matters for the ..= / ..! / ..& / .. family.
// Each keyword uses a lookahead so we don't decorate identifier uses like
// `const memo = 5` or `memo(x)`.
const PARABUN_RE = new RegExp(
  [
    // pure (before function / fun / async / ( / arrow) — matches `pure` alone
    String.raw`\b(pure)\s*(?=function\b|fun\b|async\b|\(|\w+\s*=>)`,
    // memo NAME( or memo async NAME(  — matches `memo` alone (and optional async)
    String.raw`\b(memo)\s+(?:async\s+)?(?=[A-Za-z_$][\w$]*\s*[(<])`,
    // fun NAME / fun*/ fun<
    String.raw`\b(fun)\b(?=\s*[A-Za-z_$*(<])`,
    // signal NAME = / , / ; / : / ! — a declaration start, not `signal()` etc.
    String.raw`\b(signal)\b(?=\s+[A-Za-z_$][\w$]*\s*[=,;:!])`,
    // effect { ... }
    String.raw`\b(effect)\b(?=\s*\{)`,
    // arena { ... }
    String.raw`\b(arena)\b(?=\s*\{)`,
    // defer EXPR  (next token must start an expression)
    String.raw`\b(defer)\b(?=\s+[A-Za-z_$])`,
    // Operators — orderable, multi-char before single-char
    String.raw`(\.\.=|\.\.!|\.\.&|\.\.|\|>|~>)`,
  ].join('|'),
  'g',
);

const KEYWORD_GROUPS = new Set([1, 2, 3, 4, 5, 6, 7]); // pure, memo, fun, signal, effect, arena, defer
const OPERATOR_GROUP = 8;

const keywordMark = Decoration.mark({ class: 'cm-parabun-keyword' });
const operatorMark = Decoration.mark({ class: 'cm-parabun-operator' });

function buildDecorations(view: EditorView): DecorationSet {
  const builder: { from: number; to: number; value: Decoration }[] = [];

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    PARABUN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;

    while ((m = PARABUN_RE.exec(text)) !== null) {
      // Find which group matched and decorate only that span.
      let kwIdx = -1;
      for (const g of KEYWORD_GROUPS) {
        if (m[g] !== undefined) {
          kwIdx = g;
          break;
        }
      }
      if (kwIdx !== -1) {
        const kw = m[kwIdx]!;
        const kwStart = from + m.index + m[0].indexOf(kw);
        builder.push({
          from: kwStart,
          to: kwStart + kw.length,
          value: keywordMark,
        });
      } else if (m[OPERATOR_GROUP] !== undefined) {
        const op = m[OPERATOR_GROUP];
        const opStart = from + m.index;
        builder.push({
          from: opStart,
          to: opStart + op.length,
          value: operatorMark,
        });
      }
    }
  }

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

/** Theme styles for Parabun tokens. Falls back to the editor's generic
 * keyword/operator colors if no parabun-specific override is defined. */
const parabunTheme = EditorView.baseTheme({
  '.cm-parabun-keyword': {
    color: 'var(--syn-parabun-keyword, var(--syn-keyword))',
    fontStyle: 'italic',
  },
  '.cm-parabun-operator': {
    color: 'var(--syn-parabun-operator, var(--syn-operator))',
    fontWeight: '600',
  },
});

/**
 * Returns CodeMirror extensions for Parabun syntax decoration.
 * Only apply to .pts / .ptsx / .pjs / .pjsx files (check language or
 * filename before using).
 */
export function parabunSyntaxExtension() {
  return [parabunPlugin, parabunTheme];
}
