import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { lspStore } from '$lib/stores/lsp.svelte';
import { fileUriField } from './file-uri-field';

/** Map LSP CompletionItemKind to CM6 completion type. */
const KIND_MAP: Record<number, string> = {
  1: 'text', // Text
  2: 'function', // Method
  3: 'function', // Function
  4: 'function', // Constructor
  5: 'variable', // Field
  6: 'variable', // Variable
  7: 'class', // Class
  8: 'interface', // Interface
  9: 'namespace', // Module
  10: 'property', // Property
  11: 'variable', // Unit
  12: 'constant', // Value
  13: 'enum', // Enum
  14: 'keyword', // Keyword
  15: 'text', // Snippet
  16: 'constant', // Color
  17: 'text', // File
  18: 'text', // Reference
  19: 'text', // Folder
  20: 'enum', // EnumMember
  21: 'constant', // Constant
  22: 'class', // Struct
  23: 'variable', // Event
  24: 'keyword', // Operator
  25: 'type', // TypeParameter
};

/**
 * Returns a CM6 CompletionSource that queries the LSP for completions.
 */
export function lspCompletionSource(language: string) {
  return async function (ctx: CompletionContext): Promise<CompletionResult | null> {
    if (!lspStore.isConnected(language)) return null;

    const triggerChars = lspStore.getTriggerCharacters(language);
    const charBefore = ctx.state.doc.sliceString(ctx.pos - 1, ctx.pos);
    const isTriggered = triggerChars.includes(charBefore);

    // Only trigger on explicit request or trigger character or word match
    const word = ctx.matchBefore(/[\w.]+/);
    if (!word && !ctx.explicit && !isTriggered) return null;

    const line = ctx.state.doc.lineAt(ctx.pos);

    try {
      const uri = ctx.state.field(fileUriField, false) || '';
      if (!uri) return null;
      const result = await lspStore.request(language, 'textDocument/completion', {
        textDocument: { uri },
        position: {
          line: line.number - 1,
          character: ctx.pos - line.from,
        },
        context: {
          triggerKind: isTriggered ? 2 : ctx.explicit ? 1 : 1,
          triggerCharacter: isTriggered ? charBefore : undefined,
        },
      });

      if (!result) return null;

      const items: any[] = Array.isArray(result) ? result : result.items || [];
      if (items.length === 0) return null;

      const options: Completion[] = items.map((item) => {
        const insertText = item.insertText || item.label;
        const option: Completion = {
          label: item.label,
          type: KIND_MAP[item.kind] || 'text',
          detail: item.detail || undefined,
          info: item.documentation
            ? typeof item.documentation === 'string'
              ? item.documentation
              : item.documentation.value
            : undefined,
        };

        // Use textEdit if available for more accurate insertions
        if (item.textEdit) {
          const range = item.textEdit.range;
          const startPos = ctx.state.doc.line(range.start.line + 1).from + range.start.character;
          option.apply = (view, _completion, from, to) => {
            view.dispatch({
              changes: { from: startPos, to, insert: item.textEdit.newText },
            });
          };
        } else if (insertText !== item.label) {
          option.apply = insertText;
        }

        return option;
      });

      return {
        from: word?.from ?? ctx.pos,
        options,
        validFor: /^\w*$/,
      };
    } catch {
      return null;
    }
  };
}
