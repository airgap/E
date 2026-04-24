import { EditorView, Decoration, ViewPlugin, type DecorationSet } from '@codemirror/view';
import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { symbolStore } from '$lib/stores/symbols.svelte';
import { editorStore } from '$lib/stores/editor.svelte';
import { lspStore } from '$lib/stores/lsp.svelte';
import { uiStore } from '$lib/stores/ui.svelte';

/**
 * Ctrl/Cmd-click to jump to definition, VS Code-style.
 *
 * - While the modifier is held we paint a blue underline on the word under
 *   the pointer and flip the cursor to `pointer`, so the user sees that
 *   their click is being treated as a navigation.
 * - `mousedown` (not click) with preventDefault when the modifier is held,
 *   so CM6's own selection-by-drag doesn't stomp on the navigation.
 * - Resolution chain: LSP `textDocument/definition` → tree-sitter worker
 *   → workspace-symbol search by word → toast explaining nothing matched.
 */

interface WordAt {
  from: number;
  to: number;
  text: string;
}

function wordAtPos(view: EditorView, pos: number): WordAt | null {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  const col = pos - line.from;
  const isWord = (ch: string) => /[A-Za-z0-9_$]/.test(ch);
  if (col >= text.length || !isWord(text[col])) {
    // Fall back: if we're one past the word, use the character to the left.
    if (col === 0 || !isWord(text[col - 1])) return null;
  }
  let s = col;
  let e = col;
  while (s > 0 && isWord(text[s - 1])) s--;
  while (e < text.length && isWord(text[e])) e++;
  if (s === e) return null;
  return { from: line.from + s, to: line.from + e, text: text.slice(s, e) };
}

// ── Hover decoration ─────────────────────────────────────────────────────
const setHoverRange = StateEffect.define<WordAt | null>();

const hoverDecoration = Decoration.mark({ class: 'cm-goto-hover' });

const hoverField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setHoverRange)) {
        if (!effect.value) {
          next = Decoration.none;
        } else {
          const builder = new RangeSetBuilder<Decoration>();
          builder.add(effect.value.from, effect.value.to, hoverDecoration);
          next = builder.finish();
        }
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const hoverTheme = EditorView.baseTheme({
  '.cm-goto-hover': {
    textDecoration: 'underline',
    textDecorationColor: 'var(--accent-primary, #60a5fa)',
    textDecorationThickness: '1.5px',
    textUnderlineOffset: '3px',
    cursor: 'pointer',
  },
  '.cm-content.cm-mod-held': {
    cursor: 'default',
  },
  '.cm-content.cm-mod-held .cm-goto-hover': {
    color: 'var(--accent-primary, #60a5fa)',
  },
});

// ── Main plugin ──────────────────────────────────────────────────────────
function makeViewPlugin(fileId: string, language: string) {
  return ViewPlugin.fromClass(
    class {
      modDown = false;
      keydown = (e: KeyboardEvent) => {
        if (e.key === 'Control' || e.key === 'Meta') {
          this.modDown = true;
          this.view.contentDOM.classList.add('cm-mod-held');
        }
      };
      keyup = (e: KeyboardEvent) => {
        if (e.key === 'Control' || e.key === 'Meta') {
          this.clearMod();
        }
      };
      blur = () => this.clearMod();
      mousemove = (e: MouseEvent) => {
        if (!this.modDown) return;
        const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos == null) {
          this.view.dispatch({ effects: setHoverRange.of(null) });
          return;
        }
        const word = wordAtPos(this.view, pos);
        this.view.dispatch({ effects: setHoverRange.of(word) });
      };

      constructor(public view: EditorView) {
        window.addEventListener('keydown', this.keydown);
        window.addEventListener('keyup', this.keyup);
        window.addEventListener('blur', this.blur);
        view.dom.addEventListener('mousemove', this.mousemove);
      }

      clearMod() {
        this.modDown = false;
        this.view.contentDOM.classList.remove('cm-mod-held');
        this.view.dispatch({ effects: setHoverRange.of(null) });
      }

      destroy() {
        window.removeEventListener('keydown', this.keydown);
        window.removeEventListener('keyup', this.keyup);
        window.removeEventListener('blur', this.blur);
        this.view.dom.removeEventListener('mousemove', this.mousemove);
      }
    },
  );
}

function mouseHandlers(fileId: string, language: string) {
  return EditorView.domEventHandlers({
    mousedown(event: MouseEvent, view: EditorView) {
      if (event.button !== 0) return false;
      if (!event.ctrlKey && !event.metaKey) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;
      event.preventDefault();
      navigate(fileId, language, view, pos);
      return true;
    },
  });
}

async function navigate(fileId: string, language: string, view: EditorView, pos: number) {
  const line = view.state.doc.lineAt(pos);
  const row = line.number - 1;
  const col = pos - line.from;
  const word = wordAtPos(view, pos);

  // 1. LSP
  if (lspStore.isConnected(language)) {
    try {
      const result: any = await lspStore.request(language, 'textDocument/definition', {
        textDocument: { uri: `file://${editorStore.activeTab?.filePath || ''}` },
        position: { line: row, character: col },
      });
      if (result && applyLspResult(fileId, view, result)) return;
    } catch {
      // fall through
    }
  }

  // 2. Tree-sitter same-file
  try {
    const locations = await symbolStore.findDefinitions(fileId, row, col);
    if (locations.length > 0) {
      const def = locations[0];
      const targetLine = view.state.doc.line(def.row + 1);
      view.dispatch({
        selection: { anchor: targetLine.from + def.col },
        scrollIntoView: true,
      });
      editorStore.setCursorPosition(fileId, def.row + 1, def.col + 1);
      return;
    }
  } catch {
    // fall through
  }

  // 3. Workspace symbols across all connected LSPs
  if (word && word.text.length >= 2) {
    try {
      const hits = await lspStore.workspaceSymbols(word.text);
      const exact = hits.find((h: any) => h.name === word.text) ?? hits[0];
      if (exact?.location) {
        const targetUri: string = exact.location.uri ?? '';
        const targetRange = exact.location.range;
        if (targetUri && targetRange) {
          const targetPath = targetUri.replace(/^file:\/\//, '');
          editorStore.openFile(targetPath, false, {
            line: targetRange.start.line + 1,
            col: targetRange.start.character + 1,
          });
          return;
        }
      }
    } catch {
      // fall through
    }
  }

  // Nothing matched — let the user know why so they don't think it's broken.
  uiStore.toast(
    word ? `No definition found for "${word.text}"` : 'No definition at that position',
    'info',
    2500,
  );
}

function applyLspResult(fileId: string, view: EditorView, result: any): boolean {
  const locations = Array.isArray(result) ? result : [result];
  if (locations.length === 0) return false;
  const loc = locations[0];
  const targetUri: string = loc.targetUri || loc.uri || '';
  const targetRange = loc.targetRange || loc.range;
  if (!targetRange) return false;

  const targetPath = targetUri.replace(/^file:\/\//, '');
  const currentPath = editorStore.activeTab?.filePath || '';
  const targetLine = targetRange.start.line;
  const targetChar = targetRange.start.character;

  if (targetPath && targetPath !== currentPath) {
    editorStore.openFile(targetPath, false, {
      line: targetLine + 1,
      col: targetChar + 1,
    });
  } else {
    const docLine = view.state.doc.line(targetLine + 1);
    view.dispatch({
      selection: { anchor: docLine.from + targetChar },
      scrollIntoView: true,
    });
    editorStore.setCursorPosition(fileId, targetLine + 1, targetChar + 1);
  }
  return true;
}

export function gotoDefinitionExtension(fileId: string, language: string) {
  return [
    hoverField,
    hoverTheme,
    makeViewPlugin(fileId, language),
    mouseHandlers(fileId, language),
  ];
}
