/**
 * Plugin-contributed completion source (LYK-1049).
 *
 * Returns a CompletionSource that POSTs the active editor's content +
 * cursor position to `/api/plugins/completions` and folds every plugin's
 * items into a single CompletionResult. Falls back silently when no
 * plugin contributed for the language at the active file extension —
 * registration cost is one extra HTTP call per completion, no client-
 * side dispatch table needed.
 */
import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { api } from '$lib/api/client';
import { editorStore } from '$lib/stores/editor.svelte';

const KIND_MAP: Record<string, string> = {
  function: 'function',
  method: 'method',
  variable: 'variable',
  field: 'property',
  property: 'property',
  class: 'class',
  interface: 'interface',
  module: 'namespace',
  enum: 'enum',
  keyword: 'keyword',
  constant: 'constant',
  type: 'type',
};

function toCmCompletion(c: {
  label: string;
  insertText: string;
  detail?: string;
  kind?: string;
  documentation?: string;
}): Completion {
  return {
    label: c.label,
    apply: c.insertText,
    detail: c.detail,
    type: c.kind ? (KIND_MAP[c.kind.toLowerCase()] ?? 'text') : 'text',
    info: c.documentation,
  };
}

export function pluginCompletionSource() {
  return async function (ctx: CompletionContext): Promise<CompletionResult | null> {
    const tab = editorStore.activeTab;
    if (!tab) return null;
    // Only fire when the user has actively typed something or explicitly
    // requested completions — saves a round-trip on every keystroke.
    const word = ctx.matchBefore(/[\w.]+/);
    if (!word && !ctx.explicit) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const lineNumber = line.number - 1; // 0-indexed for the server
    const character = ctx.pos - line.from;
    try {
      const res = await api.plugins.completions(tab.filePath, tab.content, lineNumber, character);
      const flat: Completion[] = [];
      for (const group of res.data?.results ?? []) {
        for (const item of group.items) flat.push(toCmCompletion(item));
      }
      if (flat.length === 0) return null;
      return {
        from: word?.from ?? ctx.pos,
        options: flat,
      };
    } catch {
      return null;
    }
  };
}
