/**
 * agent-live-edit.ts — glowing trail where the agent just edited (LYK-1092).
 *
 * When Claude writes to a file that's open in the editor, instead of silently
 * jumping the caret to the line after the tool completes, we flash a glowing
 * band over the freshly-edited lines so you can *see* the agent's hand move
 * through the buffer. Driven by a store signal (see editor store `liveEdit`);
 * the host (CodeEditor) dispatches `flashLiveEdit` with the line range.
 *
 * Flag-gated by the caller (`agentLiveEdit`), off by default.
 */
import { Decoration, type DecorationSet, EditorView, ViewPlugin } from '@codemirror/view';
import { StateEffect, StateField, type Extension } from '@codemirror/state';

/** Dispatch on the view to glow the inclusive 1-indexed line range [from, to]. */
export const flashLiveEdit = StateEffect.define<{ from: number; to: number }>();
const clearLiveEdit = StateEffect.define<null>();

const lineDeco = Decoration.line({ class: 'cm-agent-live-edit' });

const liveEditField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(clearLiveEdit)) return Decoration.none;
      if (e.is(flashLiveEdit)) {
        const doc = tr.state.doc;
        const from = Math.max(1, Math.min(e.value.from, doc.lines));
        const to = Math.max(from, Math.min(e.value.to, doc.lines));
        const marks = [];
        for (let n = from; n <= to; n++) {
          marks.push(lineDeco.range(doc.line(n).from));
        }
        return Decoration.set(marks);
      }
    }
    // Map through edits so the glow tracks the text until it's cleared.
    return decos.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Auto-clears the glow a beat after it's flashed, so the trail fades out. */
const autoClear = ViewPlugin.define((view) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    update(update) {
      const flashed = update.transactions.some((tr) => tr.effects.some((e) => e.is(flashLiveEdit)));
      if (flashed) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          view.dispatch({ effects: clearLiveEdit.of(null) });
        }, 1400);
      }
    },
    destroy() {
      if (timer) clearTimeout(timer);
    },
  };
});

const theme = EditorView.baseTheme({
  '.cm-agent-live-edit': {
    animation: 'cm-agent-live-edit-glow 1.4s ease-out forwards',
    borderRadius: '3px',
  },
  '@keyframes cm-agent-live-edit-glow': {
    '0%': {
      backgroundColor: 'color-mix(in srgb, var(--accent-primary) 38%, transparent)',
      boxShadow: 'inset 2px 0 0 var(--accent-primary)',
    },
    '100%': {
      backgroundColor: 'transparent',
      boxShadow: 'inset 2px 0 0 transparent',
    },
  },
});

export function agentLiveEditExtension(): Extension[] {
  return [liveEditField, autoClear, theme];
}
