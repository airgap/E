/**
 * site-md-editor.ts — bundled with `bun build` into site/md-editor.js.
 *
 * Mounts a real CodeMirror 6 editor in the marketing site using E's own
 * Typora-style live-markdown extension, so the site's .md "files" are WYSIWYG
 * editable in the browser (edits live in the in-browser virtual FS). Exposes
 * window.EMarkdownEditor.mount(parent, doc, { onChange, onNavigate }).
 */
import { EditorView, keymap, drawSelection, highlightActiveLine } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { wysiwygMarkdownExtension } from '../src/lib/components/editor/extensions/wysiwyg-markdown';

const siteTheme = EditorView.theme(
  {
    '&': {
      color: 'var(--ink, #c8dce8)',
      background: 'transparent',
      fontSize: '1.02rem',
    },
    '.cm-content': {
      fontFamily: "'Hanken Grotesk', ui-sans-serif, sans-serif",
      lineHeight: '1.7',
      padding: '4px 0 60px',
      caretColor: 'var(--accent, #00b4ff)',
      maxWidth: '760px',
    },
    '.cm-line': { padding: '0' },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor': { borderLeftColor: 'var(--accent, #00b4ff)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      background: 'rgba(0,180,255,0.18)',
    },
    '&.cm-focused .cm-activeLine': { background: 'rgba(0,180,255,0.05)' },
    '&:not(.cm-focused) .cm-activeLine': { background: 'transparent' },
  },
  { dark: true },
);

interface MountOpts {
  onChange?: (text: string) => void;
  onNavigate?: (href: string) => void;
}

function mount(parent: HTMLElement, doc: string, opts: MountOpts = {}) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        history(),
        drawSelection(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        wysiwygMarkdownExtension(),
        EditorView.lineWrapping,
        siteTheme,
        EditorView.updateListener.of((u) => {
          if (u.docChanged && opts.onChange) opts.onChange(u.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          mousedown(e, v) {
            // click a rendered link → navigate (internal file or external URL)
            if (!opts.onNavigate) return false;
            const pos = v.posAtCoords({ x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY });
            if (pos == null) return false;
            let node: any = syntaxTree(v.state).resolveInner(pos, 1);
            while (node) {
              if (node.name === 'Link' || node.name === 'URL') {
                const urlNode = node.name === 'URL' ? node : node.getChild?.('URL');
                if (urlNode) {
                  const href = v.state.doc.sliceString(urlNode.from, urlNode.to);
                  e.preventDefault();
                  opts.onNavigate(href);
                  return true;
                }
              }
              node = node.parent;
            }
            return false;
          },
        }),
      ],
    }),
  });
  return view;
}

(window as unknown as { EMarkdownEditor: unknown }).EMarkdownEditor = { mount };
window.dispatchEvent(new Event('emd-ready'));
