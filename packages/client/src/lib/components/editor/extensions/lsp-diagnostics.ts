import { ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { lspStore } from '$lib/stores/lsp.svelte';

/** Map LSP DiagnosticSeverity to CM6 severity. */
function mapSeverity(severity?: number): 'error' | 'warning' | 'info' {
  switch (severity) {
    case 1:
      return 'error';
    case 2:
      return 'warning';
    default:
      return 'info';
  }
}

/**
 * CM6 extension that listens for `textDocument/publishDiagnostics` from the LSP
 * and applies them as CodeMirror lint diagnostics.
 */
export function lspDiagnosticsExtension(language: string) {
  return ViewPlugin.define((view) => {
    const unsubscribe = lspStore.onNotification(
      'textDocument/publishDiagnostics',
      (params: { uri: string; diagnostics: any[] }) => {
        const doc = view.state.doc;
        const cmDiags: Diagnostic[] = [];

        for (const d of params.diagnostics) {
          const startLine = d.range?.start?.line ?? 0;
          const endLine = d.range?.end?.line ?? startLine;
          const startChar = d.range?.start?.character ?? 0;
          const endChar = d.range?.end?.character ?? startChar;

          // Bounds check against document
          if (startLine >= doc.lines) continue;

          const fromLine = doc.line(startLine + 1);
          const toLine = endLine < doc.lines ? doc.line(endLine + 1) : fromLine;

          const from = Math.min(fromLine.from + startChar, fromLine.to);
          const to = Math.min(toLine.from + endChar, toLine.to);

          cmDiags.push({
            from,
            to: Math.max(from, to),
            severity: mapSeverity(d.severity),
            message: d.message || '',
            source: d.source || language,
          });
        }

        view.dispatch(setDiagnostics(view.state, cmDiags));
      },
    );

    return {
      update(_update: ViewUpdate) {
        // Diagnostics are pushed by the server, no polling needed
      },
      destroy() {
        unsubscribe();
        // Clear diagnostics on destroy
        view.dispatch(setDiagnostics(view.state, []));
      },
    };
  });
}
