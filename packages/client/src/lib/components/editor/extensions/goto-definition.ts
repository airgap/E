import { EditorView } from '@codemirror/view';
import { symbolStore } from '$lib/stores/symbols.svelte';
import { editorStore } from '$lib/stores/editor.svelte';
import { lspStore } from '$lib/stores/lsp.svelte';

/**
 * CM6 extension: Ctrl+Click to jump to definition.
 * Uses LSP when connected (supports cross-file navigation),
 * falls back to tree-sitter for same-file definitions.
 */
export function gotoDefinitionExtension(fileId: string, language: string) {
  return EditorView.domEventHandlers({
    click(event: MouseEvent, view: EditorView) {
      if (!event.ctrlKey && !event.metaKey) return false;

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      const line = view.state.doc.lineAt(pos);
      const row = line.number - 1;
      const col = pos - line.from;

      if (lspStore.isConnected(language)) {
        // Use LSP for cross-file goto-definition
        lspStore
          .request(language, 'textDocument/definition', {
            textDocument: { uri: `file://${editorStore.activeTab?.filePath || ''}` },
            position: { line: row, character: col },
          })
          .then((result: any) => {
            if (!result) return;

            // Result can be a Location, Location[], or LocationLink[]
            const locations = Array.isArray(result) ? result : [result];
            if (locations.length === 0) return;

            const loc = locations[0];
            const targetUri = loc.targetUri || loc.uri || '';
            const targetRange = loc.targetRange || loc.range;
            if (!targetRange) return;

            const targetLine = targetRange.start.line;
            const targetChar = targetRange.start.character;

            // Extract file path from URI
            const targetPath = targetUri.replace(/^file:\/\//, '');
            const currentPath = editorStore.activeTab?.filePath || '';

            if (targetPath && targetPath !== currentPath) {
              // Cross-file navigation — pass goto target so CodeEditor scrolls after mount
              editorStore.openFile(targetPath, false, {
                line: targetLine + 1,
                col: targetChar + 1,
              });
            } else {
              // Same-file navigation
              const docLine = view.state.doc.line(targetLine + 1);
              view.dispatch({
                selection: { anchor: docLine.from + targetChar },
                scrollIntoView: true,
              });
              editorStore.setCursorPosition(fileId, targetLine + 1, targetChar + 1);
            }
          })
          .catch(() => {
            // Fallback to tree-sitter on LSP failure
            fallbackTreeSitter(fileId, row, col, view);
          });
      } else {
        fallbackTreeSitter(fileId, row, col, view);
      }

      return true;
    },
  });
}

function fallbackTreeSitter(fileId: string, row: number, col: number, view: EditorView) {
  symbolStore.findDefinitions(fileId, row, col).then((locations) => {
    if (locations.length === 0) return;

    const def = locations[0];
    const targetLine = view.state.doc.line(def.row + 1);
    view.dispatch({
      selection: { anchor: targetLine.from + def.col },
      scrollIntoView: true,
    });
    editorStore.setCursorPosition(fileId, def.row + 1, def.col + 1);
  });
}
