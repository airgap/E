/**
 * motion.ts — editor motion polish (LYK-1086).
 *
 * Two flag-gated, self-contained motion features that lean on E owning its
 * renderer:
 *   - motionFocusPulse (LYK-1109): pulse the target line on jump-to-def and a
 *     soft, rounded, morphing selection instead of a hard rectangle.
 *   - motionCursor     (LYK-1107): ease the caret between positions with a faint
 *     glow trail instead of teleporting.
 *
 * Both respect `prefers-reduced-motion` (the animations collapse to no-ops).
 * Gated by the caller (CodeEditor); reopen the file to apply after toggling.
 */
import { Decoration, type DecorationSet, EditorView, ViewPlugin } from '@codemirror/view';
import { StateEffect, StateField, type Extension } from '@codemirror/state';

// ── Focus pulse ─────────────────────────────────────────────────────────────

/** Dispatch on the view to pulse a 1-indexed line (e.g. after jump-to-def). */
export const pulseLine = StateEffect.define<number>();
const clearPulse = StateEffect.define<null>();

const pulseDeco = Decoration.line({ class: 'cm-focus-pulse' });

const pulseField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(clearPulse)) return Decoration.none;
      if (e.is(pulseLine)) {
        const n = Math.max(1, Math.min(e.value, tr.state.doc.lines));
        return Decoration.set([pulseDeco.range(tr.state.doc.line(n).from)]);
      }
    }
    return decos.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

const pulseAutoClear = ViewPlugin.define((view) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    update(update) {
      if (update.transactions.some((tr) => tr.effects.some((e) => e.is(pulseLine)))) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => view.dispatch({ effects: clearPulse.of(null) }), 900);
      }
    },
    destroy() {
      if (timer) clearTimeout(timer);
    },
  };
});

const focusPulseTheme = EditorView.baseTheme({
  '.cm-focus-pulse': {
    animation: 'cm-focus-pulse-kf 0.9s ease-out forwards',
    borderRadius: '3px',
  },
  '@keyframes cm-focus-pulse-kf': {
    '0%': { backgroundColor: 'color-mix(in srgb, var(--accent-primary) 42%, transparent)' },
    '100%': { backgroundColor: 'transparent' },
  },
  // Soft, rounded, morphing selection instead of a hard rectangle.
  '.cm-selectionBackground': {
    borderRadius: '4px',
    transition: 'all 90ms ease',
  },
  '@media (prefers-reduced-motion: reduce)': {
    '.cm-focus-pulse': { animation: 'none' },
    '.cm-selectionBackground': { transition: 'none' },
  },
});

/** Pulse-on-jump + soft morphing selection. */
export function focusPulseExtension(): Extension[] {
  return [pulseField, pulseAutoClear, focusPulseTheme];
}

// ── Eased cursor ──────────────────────────────────────────────────────────────

const cursorTheme = EditorView.baseTheme({
  '.cm-cursor, .cm-dropCursor': {
    transition: 'left 90ms ease, top 90ms ease',
    boxShadow: '0 0 6px color-mix(in srgb, var(--accent-primary) 70%, transparent)',
  },
  '@media (prefers-reduced-motion: reduce)': {
    '.cm-cursor, .cm-dropCursor': { transition: 'none' },
  },
});

/** Ease the caret between positions with a faint glow trail. */
export function motionCursorExtension(): Extension[] {
  return [cursorTheme];
}
