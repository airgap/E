import { StateField } from '@codemirror/state';

/**
 * A CM6 StateField that stores the file URI for this editor instance.
 * Used by lsp-hover.ts and lsp-completions.ts to send correct document URIs.
 *
 * Usage:
 *   // At editor creation time:
 *   EditorState.create({ extensions: [fileUriField.init(() => 'file:///path/to/file.ts'), ...] })
 *
 *   // OR after creation, to update when the path changes:
 *   view.dispatch({ effects: setFileUri.of('file:///new/path.ts') })
 *
 *   // Reading:
 *   const uri = view.state.field(fileUriField);
 */
import { StateEffect } from '@codemirror/state';

export const setFileUri = StateEffect.define<string>();

export const fileUriField = StateField.define<string>({
  create: () => '',
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFileUri)) return effect.value;
    }
    return value;
  },
});
