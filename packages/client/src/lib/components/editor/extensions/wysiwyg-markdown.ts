/**
 * wysiwyg-markdown.ts — Typora-style live-preview markdown (LYK-1114).
 *
 * Renders markdown formatting inline in the editable buffer — headings sized,
 * bold / italic / code / strikethrough styled, links coloured, blockquotes and
 * rules drawn — and hides the raw syntax markers (hashes, asterisks, backticks,
 * angle-quotes, link brackets) on every line except the one the cursor is on.
 * Put the caret on a line and its source reveals; move away and it re-renders.
 * The document stays plain markdown — fully editable, no separate preview pane.
 *
 * Enabled per-editor via the CodeEditor `wysiwyg` prop (EditorPane toggles it
 * for .md tabs). Requires the markdown language (syntax tree).
 */
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { type Extension, type Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

const hide = Decoration.replace({});
const mark = (cls: string) => Decoration.mark({ class: cls });
const strong = mark('cm-md-strong');
const em = mark('cm-md-em');
const inlineCode = mark('cm-md-code');
const strike = mark('cm-md-strike');
const link = mark('cm-md-link');
const listMark = mark('cm-md-listmark');
const headingLine = (lvl: number) => Decoration.line({ class: `cm-md-h cm-md-h${lvl}` });
const quoteLine = Decoration.line({ class: 'cm-md-quote' });
const hrLine = Decoration.line({ class: 'cm-md-hr' });
const fenceLine = Decoration.line({ class: 'cm-md-fence' });

function activeLineNumbers(view: EditorView): Set<number> {
  const s = new Set<number>();
  const doc = view.state.doc;
  for (const r of view.state.selection.ranges) {
    const a = doc.lineAt(r.from).number;
    const b = doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) s.add(n);
  }
  return s;
}

function build(view: EditorView): DecorationSet {
  const doc = view.state.doc;
  const tree = syntaxTree(view.state);
  // Only reveal raw markdown on the cursor's line while the editor is focused.
  // Unfocused, every line renders clean — so the default view looks fully
  // formatted (no stray '#'/'**') and editing reveals source on click.
  const active = view.hasFocus ? activeLineNumbers(view) : new Set<number>();
  const isActive = (pos: number) => active.has(doc.lineAt(pos).number);
  const decos: Range<Decoration>[] = [];
  const add = (from: number, to: number, value: Decoration) => decos.push(value.range(from, to));

  // collapse a marker (and an immediately-following space) when its line is idle
  const hideMarker = (from: number, to: number, eatSpace = false) => {
    if (isActive(from)) return;
    let end = to;
    if (eatSpace && doc.sliceString(end, end + 1) === ' ') end++;
    add(from, end, hide);
  };
  const lineDeco = (pos: number, value: Decoration) => {
    const line = doc.lineAt(pos);
    add(line.from, line.from, value);
  };

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (n) => {
        const name = n.name;
        const h = /^ATXHeading([1-6])$/.exec(name);
        if (h) {
          lineDeco(n.from, headingLine(+h[1]));
          return;
        }
        switch (name) {
          case 'HeaderMark':
            hideMarker(n.from, n.to, true);
            break;
          case 'StrongEmphasis':
            add(n.from, n.to, strong);
            break;
          case 'Emphasis':
            add(n.from, n.to, em);
            break;
          case 'InlineCode':
            add(n.from, n.to, inlineCode);
            break;
          case 'Strikethrough':
            add(n.from, n.to, strike);
            break;
          case 'EmphasisMark':
          case 'CodeMark':
          case 'CodeInfo':
          case 'StrikethroughMark':
            hideMarker(n.from, n.to);
            break;
          case 'FencedCode': {
            let p = n.from;
            while (p <= n.to) {
              const ln = doc.lineAt(p);
              lineDeco(ln.from, fenceLine);
              if (ln.to + 1 > doc.length) break;
              p = ln.to + 1;
            }
            break;
          }
          case 'Link':
          case 'Image':
            add(n.from, n.to, link);
            break;
          case 'LinkMark':
          case 'URL':
            hideMarker(n.from, n.to);
            break;
          case 'ListMark':
            add(n.from, n.to, listMark);
            break;
          case 'QuoteMark':
            hideMarker(n.from, n.to, true);
            break;
          case 'Blockquote': {
            let p = n.from;
            while (p <= n.to) {
              const ln = doc.lineAt(p);
              lineDeco(ln.from, quoteLine);
              if (ln.to + 1 > doc.length) break;
              p = ln.to + 1;
            }
            break;
          }
          case 'HorizontalRule':
            lineDeco(n.from, hrLine);
            hideMarker(n.from, n.to);
            break;
        }
      },
    });
  }

  // RangeSetBuilder needs strict (from, startSide) order — sort our collected ranges.
  decos.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  return Decoration.set(decos, true);
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const theme = EditorView.baseTheme({
  '.cm-md-h': { fontFamily: 'var(--ff-display, inherit)', fontWeight: '700', lineHeight: '1.35' },
  '.cm-md-h1': { fontSize: '1.9em' },
  '.cm-md-h2': { fontSize: '1.55em' },
  '.cm-md-h3': { fontSize: '1.3em' },
  '.cm-md-h4': { fontSize: '1.15em' },
  '.cm-md-h5': { fontSize: '1.05em' },
  '.cm-md-h6': { fontSize: '1em', color: 'var(--text-secondary)' },
  '.cm-md-strong': { fontWeight: '700' },
  '.cm-md-em': { fontStyle: 'italic' },
  '.cm-md-strike': { textDecoration: 'line-through', opacity: '0.7' },
  '.cm-md-code': {
    fontFamily: 'var(--ff-mono, monospace)',
    fontSize: '0.92em',
    background: 'var(--bg-tertiary, rgba(0,180,255,0.08))',
    borderRadius: '4px',
    padding: '0.1em 0.3em',
  },
  '.cm-md-link': {
    color: 'var(--accent-primary, #00b4ff)',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
  },
  '.cm-md-listmark': { color: 'var(--accent-primary, #00b4ff)' },
  '.cm-md-quote': {
    borderLeft: '3px solid var(--accent-primary, #00b4ff)',
    paddingLeft: '12px',
    color: 'var(--text-secondary)',
    fontStyle: 'italic',
  },
  '.cm-md-hr': {
    borderBottom: '1px solid var(--border-primary, rgba(0,180,255,0.2))',
    height: '0.8em',
  },
  '.cm-md-fence': {
    fontFamily: 'var(--ff-mono, monospace)',
    fontSize: '0.92em',
    background: 'var(--bg-tertiary, rgba(0,180,255,0.06))',
  },
});

export function wysiwygMarkdownExtension(): Extension[] {
  return [plugin, theme];
}
