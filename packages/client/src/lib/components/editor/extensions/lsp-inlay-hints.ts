/**
 * CM6 extension for LSP Inlay Hints.
 *
 * Fetches `textDocument/inlayHint` from the language server for the visible
 * range, debounced on scroll and edit. Renders hints as inline Decoration.widget().
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

/** LSP InlayHint (subset of the spec) */
interface LspInlayHint {
  position: { line: number; character: number };
  label: string | Array<{ value: string; tooltip?: string }>;
  kind?: 1 | 2; // 1 = Type, 2 = Parameter
  paddingLeft?: boolean;
  paddingRight?: boolean;
}

// ── Widget ─────────────────────────────────────────────────────────────

class InlayHintWidget extends WidgetType {
  constructor(
    private text: string,
    private kind: 'type' | 'parameter' | 'other',
    private padLeft: boolean,
    private padRight: boolean,
  ) {
    super();
  }

  eq(other: InlayHintWidget): boolean {
    return this.text === other.text && this.kind === other.kind;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = `cm-inlay-hint cm-inlay-hint-${this.kind}`;
    span.textContent = this.text;
    if (this.padLeft) span.style.marginLeft = '2px';
    if (this.padRight) span.style.marginRight = '2px';
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// ── StateEffect / StateField ───────────────────────────────────────────

const setInlayHints = StateEffect.define<DecorationSet>();

const inlayHintField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(setInlayHints)) return e.value;
    }
    return decos.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── Hint label extraction ──────────────────────────────────────────────

function getHintLabel(hint: LspInlayHint): string {
  if (typeof hint.label === 'string') return hint.label;
  if (Array.isArray(hint.label)) return hint.label.map((p) => p.value).join('');
  return '';
}

function getHintKind(hint: LspInlayHint): 'type' | 'parameter' | 'other' {
  if (hint.kind === 1) return 'type';
  if (hint.kind === 2) return 'parameter';
  return 'other';
}

// ── ViewPlugin ─────────────────────────────────────────────────────────

function createInlayHintPlugin(language: string) {
  return ViewPlugin.define((view) => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let lastFetchId = 0;
    let destroyed = false;

    function scheduleUpdate(delay = 500) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (!destroyed) fetchHints(view);
      }, delay);
    }

    async function fetchHints(editorView: EditorView) {
      const conn = lspStore.connections.get(language);
      if (!conn || conn.status !== 'ready') return;

      // Check if server supports inlay hints
      if (!conn.capabilities?.inlayHintProvider) return;

      // Get the file URI from the fileUriField
      const doc = editorView.state.doc;

      // Build file URI from document — we need to get it from the field
      // We can access it via the state field
      let uri = '';
      try {
        const { fileUriField } = await import('./file-uri-field');
        uri = editorView.state.field(fileUriField) || '';
      } catch {
        return;
      }
      if (!uri) return;

      const fetchId = ++lastFetchId;

      // Visible range
      const visibleRanges = editorView.visibleRanges;
      const startLine = doc.lineAt(visibleRanges[0]?.from ?? 0);
      const endLine = doc.lineAt(visibleRanges[visibleRanges.length - 1]?.to ?? doc.length);

      try {
        const result = (await lspStore.request(language, 'textDocument/inlayHint', {
          textDocument: { uri },
          range: {
            start: { line: startLine.number - 1, character: 0 },
            end: { line: endLine.number - 1, character: endLine.length },
          },
        })) as LspInlayHint[] | null;

        // Stale check
        if (fetchId !== lastFetchId || destroyed) return;

        if (!result || !Array.isArray(result) || result.length === 0) {
          editorView.dispatch({ effects: setInlayHints.of(Decoration.none) });
          return;
        }

        // Build decorations
        const builder = new RangeSetBuilder<Decoration>();
        const lineCount = doc.lines;

        // Sort by position for the RangeSetBuilder (must be in order)
        const sorted = [...result].sort((a, b) => {
          if (a.position.line !== b.position.line) return a.position.line - b.position.line;
          return a.position.character - b.position.character;
        });

        for (const hint of sorted) {
          const line = hint.position.line + 1; // LSP is 0-based
          if (line < 1 || line > lineCount) continue;

          const docLine = doc.line(line);
          const charOffset = Math.min(hint.position.character, docLine.length);
          const pos = docLine.from + charOffset;

          const label = getHintLabel(hint);
          if (!label) continue;

          const kind = getHintKind(hint);

          builder.add(
            pos,
            pos,
            Decoration.widget({
              widget: new InlayHintWidget(
                label,
                kind,
                hint.paddingLeft ?? false,
                hint.paddingRight ?? false,
              ),
              side: 1, // After the character
            }),
          );
        }

        editorView.dispatch({ effects: setInlayHints.of(builder.finish()) });
      } catch {
        // Silently ignore — inlay hints are non-critical
      }
    }

    // Initial fetch
    scheduleUpdate(200);

    return {
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          scheduleUpdate(update.docChanged ? 500 : 300);
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

/** Returns CM6 extensions for LSP inlay hints rendering. */
export function lspInlayHintsExtension(language: string): Extension[] {
  return [inlayHintField, createInlayHintPlugin(language)];
}
