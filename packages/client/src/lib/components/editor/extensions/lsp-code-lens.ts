/**
 * CM6 extension for LSP Code Lens.
 *
 * Fetches `textDocument/codeLens` from the language server, resolves each lens,
 * and renders clickable reference counts (e.g. "3 references") above functions,
 * classes, and other symbols as line decorations.
 */

import {
  EditorView,
  Decoration,
  type DecorationSet,
  WidgetType,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { StateField, StateEffect, type Extension, RangeSetBuilder } from '@codemirror/state';
import { lspStore } from '$lib/stores/lsp.svelte';

// ── Types ──────────────────────────────────────────────────────────────

/** LSP CodeLens (subset of the spec) */
interface LspCodeLens {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  command?: {
    title: string;
    command: string;
    arguments?: any[];
  };
  data?: any;
}

// ── Widget ─────────────────────────────────────────────────────────────

class CodeLensWidget extends WidgetType {
  constructor(
    private items: Array<{ title: string; line: number }>,
    private editorView: EditorView,
  ) {
    super();
  }

  eq(other: CodeLensWidget): boolean {
    if (this.items.length !== other.items.length) return false;
    return this.items.every((item, i) => item.title === other.items[i].title);
  }

  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-code-lens-line';

    for (let i = 0; i < this.items.length; i++) {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'cm-code-lens-sep';
        sep.textContent = '  |  ';
        container.appendChild(sep);
      }

      const item = this.items[i];
      const span = document.createElement('span');
      span.className = 'cm-code-lens-item';
      span.textContent = item.title;
      span.title = `${item.title} (line ${item.line})`;

      // Click to trigger "find references" via LSP
      span.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Navigate to the line and trigger references
        const doc = this.editorView.state.doc;
        const lineNum = Math.min(item.line, doc.lines);
        if (lineNum >= 1) {
          const docLine = doc.line(lineNum);
          this.editorView.dispatch({
            selection: { anchor: docLine.from },
            scrollIntoView: true,
          });
        }
      });

      container.appendChild(span);
    }

    return container;
  }

  ignoreEvent(e: Event): boolean {
    return e.type !== 'mousedown';
  }
}

// ── StateEffect / StateField ───────────────────────────────────────────

const setCodeLens = StateEffect.define<DecorationSet>();

const codeLensField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(setCodeLens)) return e.value;
    }
    // Don't map through changes — just keep until next fetch
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── ViewPlugin ─────────────────────────────────────────────────────────

function createCodeLensPlugin(language: string) {
  return ViewPlugin.define((view) => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let lastFetchId = 0;
    let destroyed = false;

    function scheduleUpdate(delay = 1000) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (!destroyed) fetchCodeLens(view);
      }, delay);
    }

    async function fetchCodeLens(editorView: EditorView) {
      const conn = lspStore.connections.get(language);
      if (!conn || conn.status !== 'ready') return;

      // Check if server supports code lens
      if (!conn.capabilities?.codeLensProvider) return;

      // Get the file URI
      let uri = '';
      try {
        const { fileUriField } = await import('./file-uri-field');
        uri = editorView.state.field(fileUriField) || '';
      } catch {
        return;
      }
      if (!uri) return;

      const fetchId = ++lastFetchId;

      try {
        // Fetch code lenses
        const result = (await lspStore.request(language, 'textDocument/codeLens', {
          textDocument: { uri },
        })) as LspCodeLens[] | null;

        // Stale check
        if (fetchId !== lastFetchId || destroyed) return;

        if (!result || !Array.isArray(result) || result.length === 0) {
          editorView.dispatch({ effects: setCodeLens.of(Decoration.none) });
          return;
        }

        // Resolve code lenses that don't have a command yet
        const resolved: LspCodeLens[] = [];
        const resolvePromises: Array<Promise<void>> = [];

        for (const lens of result) {
          if (lens.command?.title) {
            resolved.push(lens);
          } else if (conn.capabilities?.codeLensProvider?.resolveProvider) {
            resolvePromises.push(
              lspStore
                .request(language, 'codeLens/resolve', lens)
                .then((r: LspCodeLens) => {
                  if (r?.command?.title) resolved.push(r);
                })
                .catch(() => {
                  // Skip unresolvable lenses
                }),
            );
          }
        }

        if (resolvePromises.length > 0) {
          await Promise.allSettled(resolvePromises);
        }

        // Stale check again after resolving
        if (fetchId !== lastFetchId || destroyed) return;

        if (resolved.length === 0) {
          editorView.dispatch({ effects: setCodeLens.of(Decoration.none) });
          return;
        }

        // Group lenses by line
        const byLine = new Map<number, Array<{ title: string; line: number }>>();
        for (const lens of resolved) {
          const line = lens.range.start.line + 1; // LSP is 0-based
          if (!byLine.has(line)) byLine.set(line, []);
          byLine.get(line)!.push({
            title: lens.command!.title,
            line,
          });
        }

        // Build decorations — code lenses appear as line decorations above the target line
        const doc = editorView.state.doc;
        const lineCount = doc.lines;
        const builder = new RangeSetBuilder<Decoration>();

        // Sort by line number (RangeSetBuilder requires ordered positions)
        const sortedLines = [...byLine.keys()].sort((a, b) => a - b);

        for (const lineNum of sortedLines) {
          if (lineNum < 1 || lineNum > lineCount) continue;

          const items = byLine.get(lineNum)!;
          const docLine = doc.line(lineNum);

          builder.add(
            docLine.from,
            docLine.from,
            Decoration.widget({
              widget: new CodeLensWidget(items, editorView),
              side: -1, // Before the line content
              block: true, // Block-level decoration (own line)
            }),
          );
        }

        editorView.dispatch({ effects: setCodeLens.of(builder.finish()) });
      } catch {
        // Silently ignore — code lens is non-critical
      }
    }

    // Initial fetch (with longer delay to let LSP initialize)
    scheduleUpdate(1500);

    return {
      update(update: ViewUpdate) {
        if (update.docChanged) {
          // Refetch after document changes
          scheduleUpdate(2000);
        }
      },
      destroy() {
        destroyed = true;
        if (debounceTimer) clearTimeout(debounceTimer);
      },
    };
  }, {});
}

// ── Public API ─────────────────────────────────────────────────────────

/** Returns CM6 extensions for LSP Code Lens rendering. */
export function lspCodeLensExtension(language: string): Extension[] {
  return [codeLensField, createCodeLensPlugin(language)];
}
